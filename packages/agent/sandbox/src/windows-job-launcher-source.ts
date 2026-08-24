/* Embeds the trusted Windows launcher compiled on demand for AppContainer + Job Object startup. */

export const WINDOWS_JOB_LAUNCHER_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

// Supports restricted AppContainer and unrestricted Job-only execution.
public static class MegumiSandboxLauncher {
  const int STARTF_USESTDHANDLES = 0x00000100;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const int PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
  const int PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectExtendedLimitInformation = 9;
  const uint INFINITE = 0xffffffff;
  const int STD_INPUT_HANDLE = -10;
  const int STD_OUTPUT_HANDLE = -11;
  const int STD_ERROR_HANDLE = -12;
  const uint DDD_RAW_TARGET_PATH = 0x00000001;
  const uint DDD_REMOVE_DEFINITION = 0x00000002;
  const uint DDD_EXACT_MATCH_ON_REMOVE = 0x00000004;
  const uint DDD_NO_BROADCAST_SYSTEM = 0x00000008;

  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES {
    public IntPtr AppContainerSid;
    public IntPtr Capabilities;
    public uint CapabilityCount;
    public uint Reserved;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
    public int dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInfo);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DefineDosDevice(uint flags, string deviceName, string targetPath);

  public static int Main(string[] args) {
    if (args.Length < 11 || args[0] != "--isolation" || args[2] != "--workspace" || args[4] != "--cwd" || args[6] != "--drive" || args[8] != "--max-processes") return Fail("INVALID_ARGUMENTS", "Launcher arguments are invalid.");
    bool restricted = args[1] == "restricted";
    if (!restricted && args[1] != "unrestricted") return Fail("INVALID_ARGUMENTS", "Isolation mode is invalid.");
    string workspace = Path.GetFullPath(args[3]);
    string cwd = Path.GetFullPath(args[5]);
    string drive = args[7];
    uint maxProcesses;
    if (!UInt32.TryParse(args[9], out maxProcesses) || maxProcesses < 2) return Fail("INVALID_ARGUMENTS", "Process limit is invalid.");
    string program = Path.GetFullPath(args[10]);
    string[] programArgs = new string[args.Length - 11];
    Array.Copy(args, 11, programArgs, 0, programArgs.Length);
    string moniker = "Megumi.Sandbox." + Guid.NewGuid().ToString("N");
    IntPtr sid = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero;
    FileSystemAccessRule accessRule = null;
    string driveTarget = @"\??\" + workspace;
    try {
      if (restricted) {
        int hr = CreateAppContainerProfile(moniker, "Megumi Sandbox", "Megumi command execution scope", IntPtr.Zero, 0, out sid);
        if (hr != 0) throw new Win32Exception(hr & 0xffff, "CreateAppContainerProfile failed");
        SecurityIdentifier identity = new SecurityIdentifier(sid);
        DirectorySecurity security = Directory.GetAccessControl(workspace);
        accessRule = new FileSystemAccessRule(identity, FileSystemRights.Modify | FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow);
        security.AddAccessRule(accessRule);
        Directory.SetAccessControl(workspace, security);
        if (!DefineDosDevice(DDD_RAW_TARGET_PATH | DDD_NO_BROADCAST_SYSTEM, drive, driveTarget)) ThrowLast("Workspace drive mapping failed");
      }
      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) ThrowLast("CreateJobObject failed");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
      limits.BasicLimitInformation.ActiveProcessLimit = maxProcesses;
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) ThrowLast("SetInformationJobObject failed");

      IntPtr size = IntPtr.Zero;
      int attributeCount = restricted ? 2 : 1;
      InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
      attributes = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(attributes, attributeCount, 0, ref size)) ThrowLast("InitializeProcThreadAttributeList failed");
      SECURITY_CAPABILITIES capabilities = new SECURITY_CAPABILITIES { AppContainerSid=sid, Capabilities=IntPtr.Zero, CapabilityCount=0, Reserved=0 };
      IntPtr capabilitiesPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
      IntPtr jobPtr = Marshal.AllocHGlobal(IntPtr.Size);
      try {
        Marshal.StructureToPtr(capabilities, capabilitiesPtr, false);
        Marshal.WriteIntPtr(jobPtr, job);
        if (restricted && !UpdateProcThreadAttribute(attributes, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capabilitiesPtr, (IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)), IntPtr.Zero, IntPtr.Zero)) ThrowLast("AppContainer attribute failed");
        if (!UpdateProcThreadAttribute(attributes, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_JOB_LIST, jobPtr, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) ThrowLast("Job list attribute failed");
        STARTUPINFOEX startup = new STARTUPINFOEX();
        startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        startup.lpAttributeList = attributes;
        PROCESS_INFORMATION process;
        StringBuilder commandLine = new StringBuilder(BuildCommandLine(program, programArgs));
        string currentDirectory = restricted ? drive + @"\" : cwd;
        if (!CreateProcess(program, commandLine, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, currentDirectory, ref startup, out process)) ThrowLast("CreateProcess failed");
        CloseHandle(process.hThread);
        try {
          if (WaitForSingleObject(process.hProcess, INFINITE) != 0) ThrowLast("WaitForSingleObject failed");
          uint exitCode;
          if (!GetExitCodeProcess(process.hProcess, out exitCode)) ThrowLast("GetExitCodeProcess failed");
          return unchecked((int)exitCode);
        } finally { CloseHandle(process.hProcess); }
      } finally { Marshal.FreeHGlobal(capabilitiesPtr); Marshal.FreeHGlobal(jobPtr); }
    } catch (Exception error) {
      return Fail("SANDBOX_SETUP_FAILED", error.Message);
    } finally {
      if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
      if (job != IntPtr.Zero) CloseHandle(job);
      if (restricted) DefineDosDevice(DDD_REMOVE_DEFINITION | DDD_EXACT_MATCH_ON_REMOVE | DDD_NO_BROADCAST_SYSTEM, drive, driveTarget);
      if (accessRule != null && sid != IntPtr.Zero) {
        try { DirectorySecurity security = Directory.GetAccessControl(workspace); security.RemoveAccessRuleSpecific(accessRule); Directory.SetAccessControl(workspace, security); } catch { }
      }
      if (sid != IntPtr.Zero) FreeSid(sid);
      if (restricted) DeleteAppContainerProfile(moniker);
    }
  }

  static string BuildCommandLine(string program, string[] args) {
    StringBuilder output = new StringBuilder(Quote(program));
    foreach (string arg in args) output.Append(' ').Append(Quote(arg));
    return output.ToString();
  }
  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new char[] {' ', '\t', '"'}) < 0) return value;
    StringBuilder output = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { output.Append('\\', slashes * 2 + 1).Append(c); slashes = 0; continue; }
      output.Append('\\', slashes).Append(c); slashes = 0;
    }
    output.Append('\\', slashes * 2).Append('"'); return output.ToString();
  }
  static void ThrowLast(string message) { int code = Marshal.GetLastWin32Error(); throw new Exception(message + " (" + code + "): " + new Win32Exception(code).Message); }
  static int Fail(string code, string message) {
    string safe = message.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
    Console.Error.WriteLine("MEGUMI_SANDBOX_ERROR:{\"code\":\"" + code + "\",\"message\":\"" + safe + "\"}");
    return 125;
  }
}
`;