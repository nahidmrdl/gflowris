using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Reflection;
[assembly: AssemblyTitle("gflowris")]
[assembly: AssemblyProduct("gflowris")]
[assembly: AssemblyCompany("gflowris contributors")]
class AppLauncher {
    [STAThread]
    static int Main(string[] args) {
        try {
            var root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var python = Path.Combine(root, "runtime", "python", "pythonw.exe");
            var script = Path.Combine(root, "scripts", "launch.py");
            var flags = args.Length == 1 && args[0] == "--register-only" ? " --register-only" : "";
            var info = new ProcessStartInfo(python, "-B \""+script+"\""+flags) {
                UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=root
            };
            info.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1";
            Process.Start(info);
            return 0;
        } catch {
            MessageBox.Show("gflowris could not start. Extract the complete portable folder or reinstall the app.", "gflowris", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
