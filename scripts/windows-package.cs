using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

internal static partial class WindowsPackage
{
    const string Product = "XJTLU-MCP";
    const string App = Product + ".exe";
    const string Uninstaller = "Uninstall.exe";
    const string FileList = "xjtlu-package-files.txt";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\XJTLU-MCP";
    static readonly string Source = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "XJTLU-MCP-AMS");
    static readonly string StartLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product + ".lnk");
    static readonly string DesktopLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product + ".lnk");

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
            if (args.Length == 2 && args[0] == "--write-files")
            {
                RequireAdministrator();
                WriteProgramFiles(ValidateInstallFolder(args[1]));
                return 0;
            }
            Setup();
#else
            if (args.Length == 2 && args[0] == "--remove-files")
            {
                RequireAdministrator();
                CheckFolderAncestors(args[1]);
                RemoveWithRetry(args[1], ReadManifest(args[1]));
            }
            else if (args.Length == 3 && args[0] == "--finish") FinishRemove(args[1], args[2] == "delete");
            else BeginRemove();
#endif
            return 0;
        }
        catch (Exception error)
        {
            if (args.Length > 0 && args[0] == "--layout") Console.Error.WriteLine(error.Message);
            else
            {
                string target = args.Length == 2 && (args[0] == "--write-files" || args[0] == "--remove-files")
                    ? "目标目录\r\n" + args[1] + "\r\n\r\n" : "";
                MessageBox.Show(target + error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
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
        if (segments.Any(part => String.IsNullOrWhiteSpace(part) || part.EndsWith(".") || part.EndsWith(" ")
            || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || part.Contains("\\")))
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

    static bool ShortcutTargets(string shortcut, string folder)
    {
        if (!File.Exists(shortcut)) return false;
        try
        {
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            string target = shell.CreateShortcut(shortcut).TargetPath;
            return !String.IsNullOrWhiteSpace(target) && Same(target, Path.Combine(folder, App));
        }
        catch (Exception) { return false; }
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

    static Tuple<int, string> Maintenance(string folder, string action, string runtimeFolder = null)
    {
        var script = PackagePath(folder, "resources/app/out/main/maintenance.js");
        var start = new ProcessStartInfo(Path.Combine(runtimeFolder ?? folder, App), Quote(script) + " " + action) {
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
    static readonly string DefaultInstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product);

    sealed class InstallOptions
    {
        public string Folder { get; private set; }
        public bool DesktopShortcut { get; private set; }
        public InstallOptions(string folder, bool desktopShortcut) { Folder = folder; DesktopShortcut = desktopShortcut; }
    }

    static string ValidateInstallFolder(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || !Path.GetPathRoot(path).EndsWith("\\"))
            throw new IOException("请选择完整的安装路径，例如 D:\\Apps\\XJTLU-MCP。");
        string folder = Full(path);
        if (Same(folder, Path.GetPathRoot(folder)) || Same(folder, Data) ||
            folder.StartsWith(Full(Data) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new IOException("请选择独立的程序目录。");
        CheckFolderAncestors(folder);
        if (File.Exists(DiskPath(folder))) throw new IOException("安装路径指向了文件，请选择一个目录。");
        return folder;
    }

    static string ValidateRegisteredFolder(string path)
    {
        try
        {
            string folder = ValidateInstallFolder(path);
            ReadManifest(folder);
            if (File.Exists(PackagePath(folder, "resources/app/package.json"))) return folder;
        }
        catch (Exception)
        {
            // A damaged registration is never treated as a fresh install.
        }
        throw new IOException("无法确认已登记的 XJTLU-MCP 安装路径。请恢复原目录后再升级。\r\n\r\n" + path);
    }

    static InstallOptions ChooseInstallation()
    {
        using (var installed = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            if (installed != null)
            {
#if LITE
                string folder;
                try { folder = ValidateRegisteredFolder(installed.GetValue("InstallLocation") as string); }
                catch (IOException) { throw new IOException(LiteNeedsSetup); }
                ValidateLiteRuntime(folder);
#else
                string folder = ValidateRegisteredFolder(installed.GetValue("InstallLocation") as string);
#endif
                var confirm = MessageBox.Show("将在原目录升级 XJTLU-MCP。\r\n\r\n" + folder +
                    "\r\n\r\n账号、会话和 Agent 配对设置将保留。", Product, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                return confirm == DialogResult.OK ? new InstallOptions(folder, ShortcutTargets(DesktopLink, folder)) : null;
            }
        }
#if LITE
        throw new IOException(LiteNeedsSetup);
#else
        using (var form = new Form { Text = "安装 XJTLU-MCP", Width = 610, Height = 235,
            StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
        {
            var heading = new Label { Text = "选择安装位置", AutoSize = true, Left = 18, Top = 18 };
            var location = new TextBox { Text = DefaultInstallDir, Left = 18, Top = 52, Width = 460, AccessibleName = "安装路径" };
            var browse = new Button { Text = "浏览…", Left = 488, Top = 49, Width = 83 };
            var desktop = new CheckBox { Text = "在桌面创建快捷方式", AutoSize = true, Left = 18, Top = 94 };
            var install = new Button { Text = "安装", Left = 385, Top = 140, Width = 86 };
            var cancel = new Button { Text = "取消", Left = 485, Top = 140, Width = 86, DialogResult = DialogResult.Cancel };
            InstallOptions selected = null;
            browse.Click += delegate {
                using (var picker = new FolderBrowserDialog { Description = "请选择 XJTLU-MCP 的程序目录", ShowNewFolderButton = true })
                {
                    if (Directory.Exists(location.Text)) picker.SelectedPath = location.Text;
                    if (picker.ShowDialog(form) == DialogResult.OK) location.Text = picker.SelectedPath;
                }
            };
            install.Click += delegate {
                try
                {
                    var folder = ValidateInstallFolder(location.Text.Trim());
                    selected = new InstallOptions(folder, desktop.Checked);
                    form.DialogResult = DialogResult.OK;
                }
                catch (Exception error) { MessageBox.Show(form, error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            form.Controls.AddRange(new Control[] { heading, location, browse, desktop, install, cancel });
            form.AcceptButton = install;
            form.CancelButton = cancel;
            return form.ShowDialog() == DialogResult.OK ? selected : null;
        }
#endif
    }

    static void Setup()
    {
        var options = ChooseInstallation();
        if (options == null) return;
        string folder = options.Folder;
        CheckShortcut(StartLink, folder);
        if (options.DesktopShortcut) CheckShortcut(DesktopLink, folder);
        bool installed = Busy("正在更新 XJTLU-MCP 程序文件…", () => {
            bool elevate = NeedsProgramFileElevation(folder);
            string staging = Path.Combine(Path.GetTempPath(), Product + "-setup-" + Guid.NewGuid().ToString("N"));
            try
            {
                Extract(staging);
                string runtime = IsLite ? folder : staging;
                StopWorkbench(runtime);
                if (elevate)
                {
                    if (!RunElevated("--write-files", folder)) return false;
                }
                else WriteProgramFiles(folder);
                var migrated = Maintenance(staging, "register-upgrade", runtime);
                if (migrated.Item1 != 0) throw new IOException("Codex 插件目录未能迁移。请退出 Codex 并重试。");
                Register(options);
                return true;
            }
            finally { if (Directory.Exists(staging)) Directory.Delete(DiskPath(staging), true); }
        });
        if (installed) MessageBox.Show("安装完成。可以从开始菜单打开 XJTLU-MCP。", Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void CheckShortcut(string shortcut, string folder)
    {
        if (File.Exists(shortcut) && !ShortcutTargets(shortcut, folder))
            throw new IOException("已有同名快捷方式指向其他位置。请重命名该快捷方式后重试。\r\n\r\n" + shortcut);
    }

    static void SaveShortcut(string shortcut, string folder)
    {
        CheckShortcut(shortcut, folder);
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        dynamic link = shell.CreateShortcut(shortcut);
        link.TargetPath = Path.Combine(folder, App);
        link.WorkingDirectory = folder;
        link.Save();
    }

    static void Register(InstallOptions options)
    {
        string folder = options.Folder;
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Product);
            key.SetValue("DisplayVersion", FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).ProductVersion);
            key.SetValue("InstallLocation", folder);
            key.SetValue("DisplayIcon", Path.Combine(folder, App));
            key.SetValue("UninstallString", Quote(Path.Combine(folder, Uninstaller)));
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
        }
        SaveShortcut(StartLink, folder);
        if (options.DesktopShortcut) SaveShortcut(DesktopLink, folder);
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
        if (NeedsProgramFileRemovalElevation(folder, files))
        {
            if (!RunElevated("--remove-files", folder)) return;
        }
        else RemoveWithRetry(folder, files);
        if (deleteData && Directory.Exists(Data)) EraseData(Data);
        if (registryMatches)
        {
            if (ShortcutTargets(StartLink, folder)) File.Delete(StartLink);
            if (ShortcutTargets(DesktopLink, folder)) File.Delete(DesktopLink);
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        }
        MessageBox.Show("已移除 XJTLU-MCP 程序及核对通过的校园 Agent 接入。\r\n"
            + (deleteData ? "已删除本机数据。" : "已保留本机数据。")
            + "\r\n若在豆包中手动添加过 xjtlu，请在豆包「管理 → 连接器」移除。",
            Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static void RemoveWithRetry(string folder, string[] files)
    {
        // The original process can still be leaving the directory when its temporary copy starts.
        for (int attempt = 1; ; attempt++)
        {
            try { RemoveKnownFiles(folder, files); return; }
            catch (IOException) { if (attempt == 20) throw; Thread.Sleep(200); }
        }
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
