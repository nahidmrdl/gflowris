using System;
using System.IO;
using System.Diagnostics;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Threading;

// Chrome inherits binary stdio handles. Never write diagnostics to standard output.
class Launcher {
    static async Task Relay(Stream input, Stream output) {
        var buffer = new byte[8192];
        int count;
        while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) > 0) {
            await output.WriteAsync(buffer, 0, count);
            await output.FlushAsync();
        }
    }
    static void Trace(string message) {
        try { File.AppendAllText(Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "native-launch.log"), DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine); } catch {}
    }
    static int Main(string[] args) {
        try {
            // Chrome may reconnect automatically while setup is replacing files.
            try { using (Mutex.OpenExisting(@"Local\gflowris.Maintenance")) { return 3; } }
            catch (WaitHandleCannotBeOpenedException) {}
            Trace("Started; arguments="+args.Length);
            if (args.Length < 1) return 2;
            var folder = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            var config = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(folder,"runtime.json")));
            var node = (string)config["nodeExe"];
            var script = Path.Combine((string)config["projectRoot"], "src", "native-host.mjs");
            var info = new ProcessStartInfo(node, "\""+script+"\" \""+args[0]+"\"") {
                UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput=true,
                RedirectStandardOutput=true, RedirectStandardError=true, WorkingDirectory=folder
            };
            info.EnvironmentVariables["FLOW_PROTO_STATE_DIR"] = (string)config["stateRoot"];
            using (var process = Process.Start(info)) {
                Trace("Node started");
                var input = Console.OpenStandardInput();
                var output = Console.OpenStandardOutput();
                var copyIn = Task.Run(async () => { await Relay(input, process.StandardInput.BaseStream); process.StandardInput.Close(); });
                var copyOut = Relay(process.StandardOutput.BaseStream, output);
                var errors = process.StandardError.ReadToEndAsync();
                process.WaitForExit(); copyOut.Wait();
                Trace("Node exited "+process.ExitCode+" "+errors.Result);
                return process.ExitCode;
            }
        } catch (Exception error) { Trace(error.GetType().Name+": "+error.Message); return 1; }
    }
}
