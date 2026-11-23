using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class WindowsPackage
{
    const string Product = "XJTLU-MCP";
    const string App = Product + ".exe";
    const string Uninstaller = "Uninstall.exe";
    const string FileList = "xjtlu-package-files.txt";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\XJTLU-MCP";
    static readonly string Source = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "XJTLU-MCP-AMS");
    static readonly string StartLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product + ".lnk");
    static readonly string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product);

    [STAThread]
    static int Main(string[] args)
    {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
#if SETUP
            if (args.Length == 2 && args[0] == "--layout") { Extract(args[1]); return 0; }
            Setup();
#else
            if (args.Length == 3 && args[0] == "--finish") FinishRemove(args[1], args[2] == "delete");
            else BeginRemove();
#endif
            return 0;
        }
        catch (Exception error)
        {
            if (args.Length > 0 && args[0] == "--layout") Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static string Quote(string value) { return "\"" + value + "\""; }
    static string Full(string path) { return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar); }
    static bool Same(string a, string b) { return String.Equals(Full(a), Full(b), StringComparison.OrdinalIgnoreCase); }
    static string DiskPath(string path)
    {
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) return path;
        var absolute = Path.GetFullPath(path);
        return absolute.StartsWith(@"\\", StringComparison.Ordinal)
            ? @"\\?\UNC\" + absolute.Substring(2)
            : @"\\?\" + absolute;
    }

    static string PackagePath(string folder, string relative)
    {
        var segments = relative.Split('/');
        if (segments.Any(part => String.IsNullOrWhiteSpace(part) || part == "." || part == ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || part.Contains("\\")))
            throw new IOException("安装包文件路径无效。");
        string current = Full(folder);
        CheckLink(current);
        foreach (string segment in segments)
        {
            current = Path.Combine(current, segment);
            CheckLink(current);
        }
        return current;
    }

    static void CheckLink(string path)
    {
        try
        {
            if ((File.GetAttributes(DiskPath(path)) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("该路径包含链接，无法安全操作。\r\n" + path);
        }
        catch (FileNotFoundException) { }
        catch (DirectoryNotFoundException) { }
    }

    static string[] ReadManifest(string folder)
    {
        var files = File.ReadAllLines(PackagePath(folder, FileList), Encoding.UTF8);
        if (!files.Contains(App) || !files.Contains(FileList) || !files.Contains(Uninstaller))
            throw new IOException("未找到有效的 XJTLU-MCP 程序文件清单。");
        foreach (var relative in files) PackagePath(folder, relative);
        return files;
    }

    static T Busy<T>(string label, Func<T> operation)
    {
        T result = default(T);
        Exception failure = null;
        using (var form = new Form { Text = Product, Width = 420, Height = 110, ControlBox = false, StartPosition = FormStartPosition.CenterScreen })
        {
            form.Controls.Add(new Label { Text = label, AutoSize = true, Left = 16, Top = 17 });
            form.Controls.Add(new ProgressBar { Style = ProgressBarStyle.Marquee, Left = 16, Top = 43, Width = 368 });
            form.Shown += async delegate {
                try { result = await Task.Run(operation); }
                catch (Exception error) { failure = error; }
                finally { form.Close(); }
            };
            form.ShowDialog();
        }
        if (failure != null) throw failure;
        return result;
    }

    static void StopWorkbench(string folder)
    {
        using (var command = Process.Start(new ProcessStartInfo(Path.Combine(folder, App), "--quit-for-maintenance")
            { UseShellExecute = false, CreateNoWindow = true }))
            if (!command.WaitForExit(10000))
                throw new IOException("无法停止工作台。请从系统托盘退出后重试。");
        for (int attempt = 0; attempt < 15; attempt++)
        {
            using (var check = Process.Start(new ProcessStartInfo(Path.Combine(folder, App), "--check-for-maintenance")
                { UseShellExecute = false, CreateNoWindow = true }))
                if (check.WaitForExit(2000) && check.ExitCode == 0) return;
            Thread.Sleep(200);
        }
        throw new IOException("请从系统托盘完全退出 XJTLU-MCP，再重试。");
    }

    static Tuple<int, string> Maintenance(string folder, string action)
    {
        var script = PackagePath(folder, "resources/app/out/main/maintenance.js");
        var start = new ProcessStartInfo(Path.Combine(folder, App), Quote(script) + " " + action) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
            RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
        };
        start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        using (var process = Process.Start(start))
        {
            var output = process.StandardOutput.ReadToEndAsync();
            var diagnostic = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(250000)) { process.Kill(); throw new IOException("客户端处理超时。请完全退出客户端后重试。"); }
            Task.WaitAll(output, diagnostic);
            return Tuple.Create(process.ExitCode, output.Result.Trim());
        }
    }

#if SETUP
    static void Extract(string folder)
    {
        Directory.CreateDirectory(folder);
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload.zip"))
        {
            if (payload == null) throw new IOException("安装包缺少程序文件。");
            // ZIP offsets are relative to the beginning of the standalone resource.
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            foreach (var entry in zip.Entries)
            {
                if (entry.Name.Length == 0) continue;
                string root = Product + "-" + FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).ProductVersion + "-win-x64/";
                string entryName = entry.FullName.Replace('\\', '/');
                if (!entryName.StartsWith(root, StringComparison.Ordinal)) throw new IOException("安装包目录名无效。");
                string path = PackagePath(folder, entryName.Substring(root.Length));
                Directory.CreateDirectory(DiskPath(Path.GetDirectoryName(path)));
                using (var input = entry.Open())
                using (var output = new FileStream(DiskPath(path), FileMode.CreateNew))
                    input.CopyTo(output);
            }
        }
    }

    static void Setup()
    {
        if (MessageBox.Show("安装 " + Product + " 到当前 Windows 用户\r\n\r\n" + InstallDir +
                "\r\n\r\n安装会沿用现有本机数据和 Agent 接入。", Product,
                MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
        Busy("正在安装 XJTLU-MCP…", () => {
            string staging = Path.Combine(Path.GetTempPath(), Product + "-setup-" + Guid.NewGuid().ToString("N"));
            try
            {
                Extract(staging);
                string[] files = ReadManifest(staging);
                var prior = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                CheckLink(InstallDir);
                if (Directory.Exists(InstallDir))
                {
                    if (!File.Exists(Path.Combine(InstallDir, FileList)) && Directory.EnumerateFileSystemEntries(InstallDir).Any())
                        throw new IOException("安装目录已有文件。请将原解压版移到其他目录后重试。");
                    if (File.Exists(Path.Combine(InstallDir, FileList))) prior.UnionWith(ReadManifest(InstallDir));
                    foreach (var relative in files)
                        if (File.Exists(DiskPath(PackagePath(InstallDir, relative))) && !prior.Contains(relative))
                            throw new IOException("安装目录有同名的用户文件，请先移出该文件。\r\n" + relative);
                }
                StopWorkbench(staging);
                var migrated = Maintenance(staging, "register-upgrade");
                if (migrated.Item1 != 0) throw new IOException("Codex 插件目录未能迁移。请退出 Codex 并重试。");
                Directory.CreateDirectory(InstallDir);
                File.WriteAllLines(PackagePath(InstallDir, FileList), prior.Union(files).ToArray(), Encoding.UTF8);
                foreach (var relative in files.Where(name => name != FileList))
                {
                    string destination = PackagePath(InstallDir, relative);
                    Directory.CreateDirectory(DiskPath(Path.GetDirectoryName(destination)));
                    File.Copy(DiskPath(PackagePath(staging, relative)), DiskPath(destination), true);
                }
                RemoveKnownFiles(InstallDir, prior.Except(files, StringComparer.OrdinalIgnoreCase));
                File.Copy(PackagePath(staging, FileList), PackagePath(InstallDir, FileList), true);
                Register();
                return true;
            }
            finally { if (Directory.Exists(staging)) Directory.Delete(DiskPath(staging), true); }
        });
        MessageBox.Show("安装完成。可以从开始菜单打开 XJTLU-MCP。", Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void Register()
    {
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Product);
            key.SetValue("DisplayVersion", FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).ProductVersion);
            key.SetValue("InstallLocation", InstallDir);
            key.SetValue("DisplayIcon", Path.Combine(InstallDir, App));
            key.SetValue("UninstallString", Quote(Path.Combine(InstallDir, Uninstaller)));
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
        }
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        dynamic link = shell.CreateShortcut(StartLink);
        link.TargetPath = Path.Combine(InstallDir, App);
        link.WorkingDirectory = InstallDir;
        link.Save();
    }
#else
    static void BeginRemove()
    {
        ReadManifest(Source);
        var detected = Busy("正在核对校园 Agent 接入…", () => Maintenance(Source, "inspect"));
        if (detected.Item1 != 0) throw new IOException(detected.Item2.Length == 0 ? "无法读取卸载状态。" : detected.Item2);
        if (MessageBox.Show("将移除此处的 XJTLU-MCP 和工作台安装的校园 Agent 接入。\r\n" + Full(Source) +
            "\r\n\r\n" + detected.Item2, Product, MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
        var choice = MessageBox.Show("是否保留本机数据？\r\n\r\n是（默认） · 保留学校账号、会话、设置和缓存\r\n否 · 删除上述数据和本机访问密钥\r\n取消 · 返回\r\n\r\n数据目录（同一用户下的所有程序副本共用）\r\n" + Data,
            Product, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1);
        if (choice == DialogResult.Cancel) return;
        while (true)
        {
            var result = Busy("正在停止工作台并清理校园 Agent 接入…", () => {
                StopWorkbench(Source);
                return Maintenance(Source, "remove");
            });
            if (result.Item1 == 0)
            {
                var staged = Path.Combine(Path.GetTempPath(), Product + "-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Assembly.GetExecutingAssembly().Location, staged);
                Process.Start(new ProcessStartInfo(staged, "--finish " + Quote(Full(Source)) + (choice == DialogResult.No ? " delete" : " keep")) { UseShellExecute = false });
                return;
            }
            var retry = MessageBox.Show((result.Item2.Length == 0 ? "未完成清理。请退出 Agent 客户端后重试。" : result.Item2) +
                "\r\n\r\n取消可保留卸载入口，稍后重试。", Product, MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
            if (retry != DialogResult.Retry) return;
        }
    }

    static void FinishRemove(string folder, bool deleteData)
    {
        string[] files = ReadManifest(folder);
        bool registryMatches = false;
        using (var registry = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            var location = registry == null ? null : registry.GetValue("InstallLocation") as string;
            if (location != null && Same(location, folder))
            {
                registryMatches = true;
            }
        }
        if (deleteData && Directory.Exists(Data)) EraseData(Data);
        // The first process may still be leaving the directory when this copy starts.
        for (int attempt = 1; ; attempt++)
        {
            try { RemoveKnownFiles(folder, files); break; }
            catch (IOException) { if (attempt == 20) throw; Thread.Sleep(200); }
        }
        if (registryMatches)
        {
            File.Delete(StartLink);
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        }
        MessageBox.Show("已移除 XJTLU-MCP 程序及核对通过的校园 Agent 接入。\r\n"
            + (deleteData ? "已删除本机数据。" : "已保留本机数据。")
            + "\r\n若在豆包中手动添加过 xjtlu，请在豆包「管理 → 连接器」移除。",
            Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void EraseData(string directory)
    {
        CheckLink(directory);
        foreach (var path in Directory.EnumerateFileSystemEntries(DiskPath(directory)))
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.Directory) == 0) File.Delete(path);
            else if ((attributes & FileAttributes.ReparsePoint) != 0) Directory.Delete(path);
            else EraseData(path);
        }
        Directory.Delete(DiskPath(directory));
    }
#endif

    static void RemoveKnownFiles(string folder, IEnumerable<string> files)
    {
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var relative in files.OrderBy(name => name == FileList).ThenBy(name => name != Uninstaller))
        {
            string file = PackagePath(folder, relative);
            if (File.Exists(DiskPath(file))) File.Delete(DiskPath(file));
            for (var parent = Path.GetDirectoryName(file); !Same(parent, folder); parent = Path.GetDirectoryName(parent))
                directories.Add(parent);
        }
        foreach (var directory in directories.OrderByDescending(path => path.Length).Concat(new[] { Full(folder) }))
            if (Directory.Exists(DiskPath(directory)) && !Directory.EnumerateFileSystemEntries(DiskPath(directory)).Any())
                Directory.Delete(DiskPath(directory));
    }
}
