using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Text;

// Only a read-only postgres -C probe. Never starts/stops a database and never
// raises privileges: removes admin/power-user group rights and privileges.
public static class BarRestrictedPostgresValidation {
    [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int cb; public string reserved; public string desktop; public string title;
        public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reservedSize;
        public IntPtr reservedBytes,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint count,SidAttributes[] disabled,uint deleteCount,IntPtr deleted,uint restrictCount,IntPtr restricted,out IntPtr result);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr info,int length,out int required);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,IntPtr info,int length);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUser(IntPtr token,string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
    static IntPtr Sid(string value) {
        var sid=new SecurityIdentifier(value); var bytes=new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes,0);
        var address=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,address,bytes.Length); return address;
    }
    static string Quote(string value) {
        var result=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) {
            if(c=='\\') { slashes++; continue; }
            if(c=='"') { result.Append('\\',slashes*2+1); result.Append(c); slashes=0; continue; }
            result.Append('\\',slashes); slashes=0; result.Append(c);
        }
        result.Append('\\',slashes*2); return result.Append('"').ToString();
    }
    static void PreserveUserDefaultDacl(IntPtr token) {
        // As in PostgreSQL's own restricted launcher, keep the current user's
        // access to objects created by its child. This changes only the new
        // token's default DACL, never filesystem ACLs or machine policy.
        int length;
        GetTokenInformation(token,6,IntPtr.Zero,0,out length);
        if(length<=0) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr info=Marshal.AllocHGlobal(length),binary=IntPtr.Zero;
        try {
            if(!GetTokenInformation(token,6,info,length,out length)) throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr pointer=Marshal.ReadIntPtr(info);
            if(pointer==IntPtr.Zero) throw new InvalidOperationException("Restricted token has no explicit default DACL.");
            int size=(ushort)Marshal.ReadInt16(pointer,2); var old=new byte[size]; Marshal.Copy(pointer,old,0,size);
            var acl=new RawAcl(old,0);
            acl.InsertAce(acl.Count,new CommonAce(AceFlags.None,AceQualifier.AccessAllowed,0x10000000,WindowsIdentity.GetCurrent().User,false,null));
            var bytes=new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes,0);
            binary=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,binary,bytes.Length); Marshal.WriteIntPtr(info,binary);
            if(!SetTokenInformation(token,6,info,IntPtr.Size)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { if(binary!=IntPtr.Zero) Marshal.FreeHGlobal(binary); Marshal.FreeHGlobal(info); }
    }
    public static int Validate(string executable,string dataDirectory) {
        if(!Path.IsPathRooted(executable)||!Path.IsPathRooted(dataDirectory)||
           !String.Equals(Path.GetFileName(executable),"postgres.exe",StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Only the fixed PostgreSQL configuration probe is permitted.");
        IntPtr original=IntPtr.Zero,restricted=IntPtr.Zero,admin=IntPtr.Zero,power=IntPtr.Zero;
        ProcessInfo child=new ProcessInfo();
        try {
            if(!OpenProcessToken(GetCurrentProcess(),0x000B|0x0080,out original)) throw new Win32Exception(Marshal.GetLastWin32Error());
            admin=Sid("S-1-5-32-544"); power=Sid("S-1-5-32-547");
            var disabled=new[]{new SidAttributes{Sid=admin},new SidAttributes{Sid=power}};
            if(!CreateRestrictedToken(original,1,2,disabled,0,IntPtr.Zero,0,IntPtr.Zero,out restricted)) throw new Win32Exception(Marshal.GetLastWin32Error());
            PreserveUserDefaultDacl(restricted);
            var startup=new Startup(); startup.cb=Marshal.SizeOf(typeof(Startup));
            var command=new StringBuilder(Quote(executable)+" -D "+Quote(dataDirectory)+" -C wal_level");
            if(!CreateProcessAsUser(restricted,executable,command,IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,Path.GetDirectoryName(executable),ref startup,out child)) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint wait=WaitForSingleObject(child.process,30000);
            if(wait==258) { TerminateProcess(child.process,124); throw new TimeoutException("Read-only PostgreSQL configuration validation timed out; the database service was not touched."); }
            if(wait!=0) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint code; if(!GetExitCodeProcess(child.process,out code)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return unchecked((int)code);
        } finally {
            if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
            if(child.process!=IntPtr.Zero) CloseHandle(child.process);
            if(restricted!=IntPtr.Zero) CloseHandle(restricted);
            if(original!=IntPtr.Zero) CloseHandle(original);
            if(admin!=IntPtr.Zero) Marshal.FreeHGlobal(admin);
            if(power!=IntPtr.Zero) Marshal.FreeHGlobal(power);
        }
    }
}
