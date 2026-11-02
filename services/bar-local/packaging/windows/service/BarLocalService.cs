// Tsa Bonno HospitalityOS - local Bar Windows service wrapper.
//
// Runs node.exe <InstallDir>\dist\server.js as a child process, loads the
// service environment from a UTF-8 KEY=VALUE file, writes rotating logs under
// ProgramData, restarts the child with capped exponential backoff after an
// unexpected exit, and performs a bounded best-effort graceful stop.
//
// No NuGet packages. Built with the in-box .NET Framework csc.exe.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TsaBonno.BarLocal
{
    public sealed class BarLocalService : ServiceBase
    {
        private const string EventSource = "BarLocalService";
        private readonly string[] _configuredArguments;
        private ServiceHost _host;

        public BarLocalService(string[] configuredArguments)
        {
            ServiceName = "BarLocalService";
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
            _configuredArguments = configuredArguments ?? new string[0];
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                // ServiceBase.OnStart receives arguments passed to StartService,
                // not the options embedded in this service's ImagePath. Keep the
                // process arguments supplied to Main for the installed service.
                ServiceOptions options = ServiceOptions.Parse(_configuredArguments);
                _host = new ServiceHost(options);
                _host.Start();
            }
            catch (Exception error)
            {
                SafeEventLog("Bar local service failed to start: " + error.Message, EventLogEntryType.Error);
                throw;
            }
        }

        protected override void OnStop()
        {
            if (_host != null)
            {
                _host.Stop(TimeSpan.FromSeconds(20));
                _host = null;
            }
        }

        protected override void OnShutdown()
        {
            if (_host != null)
            {
                _host.Stop(TimeSpan.FromSeconds(25));
                _host = null;
            }
        }

        public static void Main(string[] args)
        {
            if (Environment.UserInteractive && HasFlag(args, "--console"))
            {
                RunConsole(args);
                return;
            }
            ServiceBase.Run(new BarLocalService(args));
        }

        private static bool HasFlag(string[] args, string flag)
        {
            foreach (string value in args)
            {
                if (string.Equals(value, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void RunConsole(string[] args)
        {
            ServiceHost host = new ServiceHost(ServiceOptions.Parse(args));
            ManualResetEvent stop = new ManualResetEvent(false);
            ConsoleCancelEventHandler handler = delegate(object sender, ConsoleCancelEventArgs eventArgs)
            {
                eventArgs.Cancel = true;
                stop.Set();
            };
            Console.CancelKeyPress += handler;
            try
            {
                host.Start();
                Console.WriteLine("Bar local service running in console mode. Press Ctrl+C to stop.");
                stop.WaitOne();
            }
            finally
            {
                Console.CancelKeyPress -= handler;
                host.Stop(TimeSpan.FromSeconds(20));
            }
        }

        public static void SafeEventLog(string message, EventLogEntryType type)
        {
            try
            {
                EventLog.WriteEntry(EventSource, message, type, 100);
            }
            catch
            {
                // The service account may not be able to write to the event log.
                // File logs remain the authoritative operational record.
            }
        }
    }

    internal sealed class ServiceOptions
    {
        public string InstallDir;
        public string NodePath;
        public string ServerJs;
        public string EnvFile;
        public string LogDir;
        public string DataDir;
        public string ProgramDataRoot;

        public static ServiceOptions Parse(string[] args)
        {
            Dictionary<string, string> map = ParseArguments(args);
            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Tsa Bonno",
                "BarLocal");

            ServiceOptions options = new ServiceOptions();
            options.ProgramDataRoot = Path.GetFullPath(root);
            options.InstallDir = RequiredAbsolute(map, "install-dir", "The --install-dir argument is required.");
            options.NodePath = RequiredAbsolute(map, "node-path", "The --node-path argument is required.");
            if (Directory.Exists(options.NodePath))
            {
                options.NodePath = Path.Combine(options.NodePath, "node.exe");
            }
            options.EnvFile = OptionalAbsolute(map, "env-file", Path.Combine(options.ProgramDataRoot, "service.env"));
            options.LogDir = OptionalAbsolute(map, "log-dir", Path.Combine(options.ProgramDataRoot, "logs"));
            options.DataDir = OptionalAbsolute(map, "data-dir", options.ProgramDataRoot);
            options.ServerJs = Path.Combine(options.InstallDir, "dist", "server.js");

            if (!Directory.Exists(options.InstallDir))
            {
                throw new DirectoryNotFoundException("The Bar local install directory does not exist: " + options.InstallDir);
            }
            if (!File.Exists(options.ServerJs))
            {
                throw new FileNotFoundException("The compiled Bar local service was not found at " + options.ServerJs + ". Build and copy dist before installing the service.", options.ServerJs);
            }
            if (!File.Exists(options.NodePath))
            {
                throw new FileNotFoundException("node.exe was not found at " + options.NodePath + ". Supply --node-path from the installer.", options.NodePath);
            }
            if (!File.Exists(options.EnvFile))
            {
                throw new FileNotFoundException("The service environment file was not found at " + options.EnvFile + ". Run install-server.ps1 to create it.", options.EnvFile);
            }
            return options;
        }

        private static Dictionary<string, string> ParseArguments(string[] args)
        {
            Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < args.Length; index++)
            {
                string token = args[index];
                if (token == null || !token.StartsWith("--", StringComparison.Ordinal)) continue;
                string body = token.Substring(2);
                int separator = body.IndexOf('=');
                if (separator >= 0)
                {
                    map[body.Substring(0, separator)] = body.Substring(separator + 1);
                    continue;
                }
                if (index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    map[body] = args[index + 1];
                    index++;
                }
                else
                {
                    map[body] = "true";
                }
            }
            return map;
        }

        private static string RequiredAbsolute(Dictionary<string, string> map, string name, string message)
        {
            string value;
            if (!map.TryGetValue(name, out value) || String.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException(message);
            }
            return EnsureAbsolute(value, name);
        }

        private static string OptionalAbsolute(Dictionary<string, string> map, string name, string fallback)
        {
            string value;
            if (!map.TryGetValue(name, out value) || String.IsNullOrWhiteSpace(value)) return Path.GetFullPath(fallback);
            return EnsureAbsolute(value, name);
        }

        private static string EnsureAbsolute(string value, string name)
        {
            string trimmed = value.Trim().Trim('"');
            if (!Path.IsPathRooted(trimmed))
            {
                throw new ArgumentException("--" + name + " must be an absolute path.");
            }
            return Path.GetFullPath(trimmed);
        }
    }

    internal sealed class ServiceHost
    {
        private readonly ServiceOptions _options;
        private readonly object _gate = new object();
        private readonly RotatingLog _serviceLog;
        private readonly RotatingLog _stdoutLog;
        private readonly RotatingLog _stderrLog;
        private Process _child;
        private DateTime _childStartedUtc;
        private Timer _restartTimer;
        private bool _stopping;
        private int _restartAttempt;
        private Dictionary<string, string> _environment;

        public ServiceHost(ServiceOptions options)
        {
            _options = options;
            Directory.CreateDirectory(options.LogDir);
            Directory.CreateDirectory(options.DataDir);
            _serviceLog = new RotatingLog(Path.Combine(options.LogDir, "service.log"), 10 * 1024 * 1024, 10);
            _stdoutLog = new RotatingLog(Path.Combine(options.LogDir, "stdout.log"), 10 * 1024 * 1024, 10);
            _stderrLog = new RotatingLog(Path.Combine(options.LogDir, "stderr.log"), 10 * 1024 * 1024, 10);
        }

        public void Start()
        {
            _environment = LoadEnvironment(_options.EnvFile);
            _serviceLog.Write("service starting install_dir=" + _options.InstallDir + " node=" + _options.NodePath);
            BarLocalService.SafeEventLog("Bar local service starting.", EventLogEntryType.Information);
            StartChild();
        }

        public void Stop(TimeSpan timeout)
        {
            Process child = null;
            lock (_gate)
            {
                if (_stopping) return;
                _stopping = true;
                if (_restartTimer != null)
                {
                    _restartTimer.Dispose();
                    _restartTimer = null;
                }
                child = _child;
            }
            _serviceLog.Write("service stopping");
            BarLocalService.SafeEventLog("Bar local service stopping.", EventLogEntryType.Information);
            if (child != null && !HasExited(child))
            {
                TryGracefulBreak(child);
                if (!WaitForExit(child, timeout))
                {
                    _serviceLog.Write("child did not stop within " + timeout.TotalSeconds + "s; terminating");
                    try
                    {
                        if (!HasExited(child)) child.Kill();
                    }
                    catch (Exception error)
                    {
                        _serviceLog.Write("child kill failed: " + error.Message);
                    }
                    if (!WaitForExit(child, TimeSpan.FromSeconds(5)))
                    {
                        KillProcessTree(child);
                    }
                }
            }
            _serviceLog.Write("service stopped");
        }

        private void StartChild()
        {
            lock (_gate)
            {
                if (_stopping) return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = _options.NodePath;
            startInfo.Arguments = QuoteArgument(_options.ServerJs);
            startInfo.WorkingDirectory = _options.InstallDir;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = false;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.RedirectStandardInput = false;
            startInfo.StandardOutputEncoding = new UTF8Encoding(false);
            startInfo.StandardErrorEncoding = new UTF8Encoding(false);

            ApplyEnvironment(startInfo);

            Process process = new Process();
            process.StartInfo = startInfo;
            process.EnableRaisingEvents = true;
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null) _stdoutLog.Write(eventArgs.Data);
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (eventArgs.Data != null) _stderrLog.Write(eventArgs.Data);
            };
            process.Exited += OnChildExited;

            try
            {
                if (!process.Start())
                {
                    throw new InvalidOperationException("Process.Start returned false for node.exe.");
                }
            }
            catch (Exception error)
            {
                _serviceLog.Write("child start failed: " + error.Message);
                BarLocalService.SafeEventLog("Bar local node process failed to start: " + error.Message, EventLogEntryType.Error);
                ScheduleRestart();
                return;
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            lock (_gate)
            {
                if (_stopping)
                {
                    try { process.Kill(); } catch { }
                    return;
                }
                _child = process;
                _childStartedUtc = DateTime.UtcNow;
            }
            _serviceLog.Write("child started pid=" + process.Id.ToString(CultureInfo.InvariantCulture));
            BarLocalService.SafeEventLog("Bar local node process started with pid " + process.Id.ToString(CultureInfo.InvariantCulture) + ".", EventLogEntryType.Information);
        }

        private void OnChildExited(object sender, EventArgs eventArgs)
        {
            Process process = sender as Process;
            int exitCode = -1;
            try
            {
                if (process != null) exitCode = process.ExitCode;
            }
            catch
            {
            }

            bool unexpected = false;
            lock (_gate)
            {
                if (process == null || !Object.ReferenceEquals(process, _child)) return;
                _child = null;
                if (!_stopping)
                {
                    unexpected = true;
                    if ((DateTime.UtcNow - _childStartedUtc) > TimeSpan.FromSeconds(60)) _restartAttempt = 0;
                    _restartAttempt++;
                }
            }

            if (!unexpected) return;
            _serviceLog.Write("child exited unexpectedly code=" + exitCode.ToString(CultureInfo.InvariantCulture));
            BarLocalService.SafeEventLog("Bar local node process exited unexpectedly with code " + exitCode.ToString(CultureInfo.InvariantCulture) + ".", EventLogEntryType.Warning);
            ScheduleRestart();
        }

        private void ScheduleRestart()
        {
            lock (_gate)
            {
                if (_stopping) return;
                int exponent = Math.Min(Math.Max(_restartAttempt - 1, 0), 5);
                int delaySeconds = (int)Math.Min(60, Math.Pow(2, exponent) * 2);
                if (_restartTimer != null) _restartTimer.Dispose();
                _restartTimer = new Timer(RestartTick, null, TimeSpan.FromSeconds(delaySeconds), Timeout.InfiniteTimeSpan);
                _serviceLog.Write("restart scheduled in " + delaySeconds.ToString(CultureInfo.InvariantCulture) + "s attempt=" + _restartAttempt.ToString(CultureInfo.InvariantCulture));
            }
        }

        private void RestartTick(object state)
        {
            lock (_gate)
            {
                if (_stopping) return;
                if (_restartTimer != null)
                {
                    _restartTimer.Dispose();
                    _restartTimer = null;
                }
            }
            try
            {
                StartChild();
            }
            catch (Exception error)
            {
                _serviceLog.Write("restart failed: " + error.Message);
                BarLocalService.SafeEventLog("Bar local node restart failed: " + error.Message, EventLogEntryType.Error);
                ScheduleRestart();
            }
        }

        private void ApplyEnvironment(ProcessStartInfo startInfo)
        {
            startInfo.EnvironmentVariables.Clear();
            startInfo.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
            startInfo.EnvironmentVariables["WINDIR"] = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows";
            startInfo.EnvironmentVariables["PATH"] = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows", "System32");
            startInfo.EnvironmentVariables["TEMP"] = Path.Combine(_options.DataDir, "temp");
            startInfo.EnvironmentVariables["TMP"] = Path.Combine(_options.DataDir, "temp");
            startInfo.EnvironmentVariables["USERPROFILE"] = _options.DataDir;
            Directory.CreateDirectory(Path.Combine(_options.DataDir, "temp"));

            foreach (KeyValuePair<string, string> entry in _environment)
            {
                startInfo.EnvironmentVariables[entry.Key] = entry.Value;
            }
            if (!startInfo.EnvironmentVariables.ContainsKey("NODE_ENV"))
            {
                startInfo.EnvironmentVariables["NODE_ENV"] = "production";
            }
        }

        private static Dictionary<string, string> LoadEnvironment(string file)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string[] lines = File.ReadAllLines(file, new UTF8Encoding(false, true));
            for (int index = 0; index < lines.Length; index++)
            {
                string line = lines[index];
                if (line == null) continue;
                string trimmed = line.Trim();
                if (trimmed.Length == 0 || trimmed.StartsWith("#", StringComparison.Ordinal)) continue;
                int separator = line.IndexOf('=');
                if (separator <= 0)
                {
                    throw new FormatException("service.env line " + (index + 1).ToString(CultureInfo.InvariantCulture) + " is not KEY=VALUE.");
                }
                string key = line.Substring(0, separator).Trim();
                string value = line.Substring(separator + 1).Trim();
                if (!Regex.IsMatch(key, "^[A-Za-z_][A-Za-z0-9_]*$"))
                {
                    throw new FormatException("service.env line " + (index + 1).ToString(CultureInfo.InvariantCulture) + " has an invalid variable name.");
                }
                values[key] = value;
            }
            return values;
        }

        private static bool HasExited(Process process)
        {
            try
            {
                return process.HasExited;
            }
            catch
            {
                return true;
            }
        }

        private static bool WaitForExit(Process process, TimeSpan timeout)
        {
            try
            {
                return process.WaitForExit((int)Math.Max(0, timeout.TotalMilliseconds));
            }
            catch
            {
                return false;
            }
        }

        private static void TryGracefulBreak(Process process)
        {
            try
            {
                if (!AttachConsole((uint)process.Id)) return;
                try
                {
                    SetConsoleCtrlHandler(IntPtr.Zero, true);
                    GenerateConsoleCtrlEvent(1, 0);
                    Thread.Sleep(500);
                }
                finally
                {
                    FreeConsole();
                }
            }
            catch
            {
            }
        }

        private static void KillProcessTree(Process process)
        {
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows", "System32", "taskkill.exe");
                startInfo.Arguments = "/PID " + process.Id.ToString(CultureInfo.InvariantCulture) + " /T /F";
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                using (Process taskkill = Process.Start(startInfo))
                {
                    if (taskkill != null) taskkill.WaitForExit(10000);
                }
            }
            catch
            {
            }
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FreeConsole();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetConsoleCtrlHandler(IntPtr handlerRoutine, bool add);
    }

    internal sealed class RotatingLog
    {
        private readonly string _path;
        private readonly string _directory;
        private readonly string _stem;
        private readonly long _maxBytes;
        private readonly int _maxFiles;
        private readonly object _gate = new object();

        public RotatingLog(string path, long maxBytes, int maxFiles)
        {
            _path = Path.GetFullPath(path);
            _directory = Path.GetDirectoryName(_path);
            _stem = Path.GetFileNameWithoutExtension(_path);
            _maxBytes = maxBytes;
            _maxFiles = Math.Max(2, maxFiles);
            Directory.CreateDirectory(_directory);
        }

        public void Write(string line)
        {
            lock (_gate)
            {
                try
                {
                    if (File.Exists(_path) && new FileInfo(_path).Length >= _maxBytes) Roll();
                    string entry = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) + " " + line + Environment.NewLine;
                    File.AppendAllText(_path, entry, new UTF8Encoding(false));
                }
                catch
                {
                    // Logging must never crash the service.
                }
            }
        }

        private void Roll()
        {
            try
            {
                for (int index = _maxFiles - 1; index >= 1; index--)
                {
                    string source = FileFor(index);
                    if (!File.Exists(source)) continue;
                    string target = FileFor(index + 1);
                    if (File.Exists(target)) File.Delete(target);
                    File.Move(source, target);
                }
                string first = FileFor(1);
                if (File.Exists(first)) File.Delete(first);
                File.Move(_path, first);
            }
            catch
            {
            }
        }

        private string FileFor(int index)
        {
            return Path.Combine(_directory, _stem + "." + index.ToString(CultureInfo.InvariantCulture) + ".log");
        }
    }
}
