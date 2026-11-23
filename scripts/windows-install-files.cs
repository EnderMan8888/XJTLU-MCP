using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

internal static partial class WindowsPackage
{
    const uint WriteData = 0x0002;
    const uint AddDirectory = 0x0004;
    const uint DeleteAccess = 0x00010000;
    const uint ShareAll = 7;
    const uint OpenExisting = 3;
    const uint BackupSemantics = 0x02000000;
    const uint OpenReparsePoint = 0x00200000;

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle OpenPath(string name, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool ReplacePath(string source, string destination, uint flags);

    static void CheckFolderAncestors(string folder)
    {
        for (var path = new DirectoryInfo(folder); path != null; path = path.Parent) CheckLink(path.FullName);
    }

    static bool CanAccessPath(string path, uint access)
    {
        CheckLink(path);
        using (var handle = OpenPath(DiskPath(path), access, ShareAll, IntPtr.Zero, OpenExisting,
            BackupSemantics | OpenReparsePoint, IntPtr.Zero))
        {
            if (!handle.IsInvalid) return true;
            int error = Marshal.GetLastWin32Error();
            if (error == 5) return false;
            if (error == 32 || error == 33) return true; // Rechecked after the workbench is stopped.
            throw new IOException("无法检查目录或文件的访问权限。\r\n" + path + "\r\n" + new Win32Exception(error).Message);
        }
    }

    static void RequireAdministrator()
    {
        using (var identity = WindowsIdentity.GetCurrent())
            if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                throw new UnauthorizedAccessException("管理员权限未获批准。");
    }

    static bool RunElevated(string operation, string folder)
    {
        // The child only touches program files. Its source is the original package or uninstaller.
        try
        {
            using (var child = Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,
                operation + " " + Quote(folder)) { Verb = "runas", UseShellExecute = true, WorkingDirectory = Environment.SystemDirectory }))
            {
                child.WaitForExit();
                return child.ExitCode == 0;
            }
        }
        catch (Win32Exception error)
        {
            var explanation = error.NativeErrorCode == 1223 ? "已取消管理员权限请求。" : "无法启动管理员文件操作。\r\n" + error.Message;
            throw new IOException(explanation + "\r\n\r\n目标目录\r\n" + folder);
        }
    }

#if SETUP
#if LITE
    const bool IsLite = true;
    const string LiteNeedsSetup = "需要完整安装版，请下载同版本的 Setup.exe。";
#else
    const bool IsLite = false;
#endif

    static ZipArchive OpenPayload()
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload.zip");
        if (stream == null) throw new IOException("安装包缺少程序文件。");
        try { return new ZipArchive(stream, ZipArchiveMode.Read); }
        catch { stream.Dispose(); throw; }
    }

    static Dictionary<string, ZipArchiveEntry> PayloadEntries(ZipArchive archive)
    {
        string version = FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).ProductVersion;
        string root = Product + "-" + version + "-win-x64/";
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries)
        {
            if (entry.Name.Length == 0) continue;
            string name = entry.FullName.Replace('\\', '/');
            if (!name.StartsWith(root, StringComparison.Ordinal)) throw new IOException("安装包目录名无效。");
            entries.Add(name.Substring(root.Length), entry);
        }
        return entries;
    }

    static void CopyEntry(string folder, string relative, ZipArchiveEntry entry, bool overwrite)
    {
        string path = PackagePath(folder, relative);
        Directory.CreateDirectory(DiskPath(Path.GetDirectoryName(path)));
        using (var input = entry.Open())
        {
            if (overwrite) WriteReplacement(path, output => input.CopyTo(output));
            else using (var output = new FileStream(DiskPath(path), FileMode.CreateNew)) input.CopyTo(output);
        }
    }

    static void WriteReplacement(string path, Action<Stream> write)
    {
        // Replace the directory entry instead of opening an existing file for writing.
        var temporary = DiskPath(Path.Combine(Path.GetDirectoryName(path), ".xjtlu-" + Guid.NewGuid().ToString("N")));
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write)) write(stream);
            CheckLink(path);
            if (!ReplacePath(temporary, DiskPath(path), 1))
                throw new IOException("无法替换程序文件。\r\n" + path + "\r\n" + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    static void WriteManifest(string path, IEnumerable<string> lines)
    {
        WriteReplacement(path, output => {
            using (var writer = new StreamWriter(output, Encoding.UTF8))
                foreach (string line in lines) writer.WriteLine(line);
        });
    }

    static void Extract(string folder)
    {
        CheckFolderAncestors(folder);
        using (var archive = OpenPayload())
            foreach (var item in PayloadEntries(archive)) CopyEntry(folder, item.Key, item.Value, false);
    }

    static string[] ReadLines(Stream stream)
    {
        using (var reader = new StreamReader(stream, Encoding.UTF8))
        {
            var lines = new List<string>();
            for (string line = reader.ReadLine(); line != null; line = reader.ReadLine()) lines.Add(line);
            return lines.ToArray();
        }
    }

#if LITE
    static void ValidateLiteRuntime(string folder)
    {
        try
        {
            if (!Environment.Is64BitOperatingSystem ||
                FileVersionInfo.GetVersionInfo(PackagePath(folder, App)).ProductVersion != PackageVersion.Electron)
                throw new IOException(LiteNeedsSetup);
            using (var sha = SHA256.Create())
            foreach (var line in ReadLines(Assembly.GetExecutingAssembly().GetManifestResourceStream("Runtime.sha256")))
            {
                var fields = line.Split('\t');
                using (var file = File.OpenRead(DiskPath(PackagePath(folder, fields[1]))))
                {
                    var digest = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "");
                    if (!String.Equals(digest, fields[0], StringComparison.OrdinalIgnoreCase)) throw new IOException(LiteNeedsSetup);
                }
            }
        }
        catch (Exception)
        {
            throw new IOException(LiteNeedsSetup + "\r\n\r\n预期的 Electron 版本 " + PackageVersion.Electron + "\r\n" + folder);
        }
    }
#endif

    sealed class InstallPlan
    {
        internal readonly Dictionary<string, ZipArchiveEntry> Write;
        internal readonly string[] Manifest;
        internal readonly string[] Obsolete;
        internal InstallPlan(Dictionary<string, ZipArchiveEntry> entries, string[] manifest, string[] obsolete)
        {
            Write = entries;
            Manifest = manifest;
            Obsolete = obsolete;
        }
    }

    static InstallPlan PlanInstall(string folder, ZipArchive archive)
    {
        CheckFolderAncestors(folder);
        var entries = PayloadEntries(archive);
        var files = ReadLines(entries[FileList].Open());
        foreach (var file in files) PackagePath(folder, file);
        var previous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (Directory.Exists(DiskPath(folder)))
        {
            if (File.Exists(PackagePath(folder, FileList)))
            {
                previous.UnionWith(ReadManifest(folder));
                if (!File.Exists(PackagePath(folder, "resources/app/package.json")) && !previous.SetEquals(files))
                    throw new IOException("无法核对安装目录，请确认其中的 XJTLU-MCP 安装。\r\n" + folder);
            }
            else if (Directory.EnumerateFileSystemEntries(DiskPath(folder)).Any())
                throw new IOException("所选目录已有其他文件。请选择空目录或 XJTLU-MCP 程序目录。\r\n" + folder);
        }
        foreach (var file in entries.Keys)
        {
            string destination = DiskPath(PackagePath(folder, file));
            if (Directory.Exists(destination) || (File.Exists(destination) && !previous.Contains(file)))
                throw new IOException("安装目录有同名的用户文件，请移出后重试。\r\n" + folder + "\r\n" + file);
        }
        var obsolete = previous.Except(files, StringComparer.OrdinalIgnoreCase).ToArray();
        // Retain previously owned files outside the application directory if this release does not replace them.
        var retired = obsolete.Where(file => file.StartsWith("resources/app/", StringComparison.OrdinalIgnoreCase)).ToArray();
        return new InstallPlan(entries, files.Concat(obsolete.Except(retired)).ToArray(), retired);
    }

    static bool NeedsProgramFileElevation(string folder)
    {
        using (var archive = OpenPayload())
        {
            var plan = PlanInstall(folder, archive);
            var checkedDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in plan.Write.Keys)
            {
                string path = PackagePath(folder, name);
                if (File.Exists(DiskPath(path)) && !CanAccessPath(path, DeleteAccess)) return true;
                string parent = Path.GetDirectoryName(path);
                uint access = WriteData; // FILE_ADD_FILE for an existing folder.
                while (!Directory.Exists(DiskPath(parent)))
                {
                    parent = Path.GetDirectoryName(parent);
                    if (parent == null) throw new DirectoryNotFoundException("无法找到安装盘。\r\n" + folder);
                    access = AddDirectory;
                }
                if (checkedDirectories.Add(parent + "|" + access) && !CanAccessPath(parent, access)) return true;
            }
            return NeedsProgramFileRemovalElevation(folder, plan.Obsolete);
        }
    }

    static void WriteProgramFiles(string folder)
    {
#if LITE
        ValidateLiteRuntime(folder);
#endif
        using (var archive = OpenPayload())
        {
            var plan = PlanInstall(folder, archive);
            if (NeedsProgramFileElevation(folder))
                throw new UnauthorizedAccessException("当前权限无法写入目标目录。\r\n" + folder);
            Directory.CreateDirectory(DiskPath(folder));
            string manifest = PackagePath(folder, FileList);
            WriteManifest(manifest, plan.Manifest.Concat(plan.Obsolete));
            foreach (var item in plan.Write.Where(item => item.Key != FileList))
                CopyEntry(folder, item.Key, item.Value, true);
            RemoveKnownFiles(folder, plan.Obsolete);
            WriteManifest(manifest, plan.Manifest);
        }
    }
#endif

    static bool NeedsProgramFileRemovalElevation(string folder, IEnumerable<string> files)
    {
        CheckFolderAncestors(folder);
        foreach (string name in files)
        {
            string path = PackagePath(folder, name);
            if (File.Exists(DiskPath(path)) && !CanAccessPath(path, DeleteAccess)) return true;
        }
        return false;
    }
}
