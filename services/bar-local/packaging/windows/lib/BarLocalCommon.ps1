# Shared helpers for the Tsa Bonno local Bar Windows packaging scripts.
# PowerShell 5.1 compatible. No external modules.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($null -eq ('BarLocalFinalPathHandle' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class BarLocalFinalPathHandle {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);

    public static string Resolve(string path) {
        using (SafeFileHandle handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            StringBuilder buffer = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
            return buffer.ToString(0, (int)length);
        }
    }
}
'@
}

function Resolve-PathThroughExistingAncestors {
    param([Parameter(Mandatory = $true)][string]$Path)
    $cursor = [System.IO.Path]::GetFullPath($Path)
    $suffix = New-Object System.Collections.Generic.List[string]
    while (-not [System.IO.Directory]::Exists($cursor) -and -not [System.IO.File]::Exists($cursor)) {
        $parent = [System.IO.Path]::GetDirectoryName($cursor)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $suffix.Insert(0, [System.IO.Path]::GetFileName($cursor))
        $cursor = $parent
    }
    $canonical = [BarLocalFinalPathHandle]::Resolve($cursor)
    if ($canonical.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
        $canonical = '\\' + $canonical.Substring(8)
    }
    elseif ($canonical.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
        $canonical = $canonical.Substring(4)
    }
    foreach ($part in $suffix) { $canonical = [System.IO.Path]::Combine($canonical, $part) }
    return [System.IO.Path]::GetFullPath($canonical)
}

function Assert-Elevated {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run from an elevated PowerShell session (Run as administrator).'
    }
}

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Name must be a non-empty absolute path."
    }
    if ($Path -match '[\x00-\x1F]') {
        throw "$Name must not contain control characters."
    }
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "$Name must be an absolute path. Received '$Path'."
    }
    try {
        return [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        throw "$Name is not a valid path: $Path"
    }
}

function Test-PathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )
    $normalize = {
        param($value)
        return (Resolve-PathThroughExistingAncestors -Path $value).TrimEnd('\', '/')
    }
    $a = & $normalize $Left
    $b = & $normalize $Right
    return [string]::Equals($a, $b, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Child,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    $normalize = {
        param($value)
        return (Resolve-PathThroughExistingAncestors -Path $value).TrimEnd('\', '/')
    }
    $childPath = (& $normalize $Child) + [System.IO.Path]::DirectorySeparatorChar
    $parentPath = (& $normalize $Parent) + [System.IO.Path]::DirectorySeparatorChar
    return $childPath.StartsWith($parentPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-DedicatedDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if ($full -match '^[A-Za-z]:$' -or $full -match '^\\\\[^\\]+\\[^\\]+$') {
        throw "$Name must be a dedicated directory, not a drive or share root: '$Path'."
    }
    $protected = @(
        $env:SystemRoot,
        (Join-Path $env:SystemDrive 'Users'),
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        $env:ProgramData,
        $env:USERPROFILE,
        $env:LOCALAPPDATA,
        $env:APPDATA,
        $env:PUBLIC
    )
    foreach ($candidate in $protected) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-PathEqual -Left $full -Right $candidate) {
            throw "$Name must be a dedicated directory beneath a protected location, not '$candidate'."
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:SystemRoot) -and (Test-PathWithin -Child $full -Parent $env:SystemRoot)) {
        throw "$Name must not be inside the Windows directory: '$Path'."
    }
}

function Assert-DistinctPaths {
    param(
        [Parameter(Mandatory = $true)][string]$FirstName,
        [Parameter(Mandatory = $true)][string]$FirstPath,
        [Parameter(Mandatory = $true)][string]$SecondName,
        [Parameter(Mandatory = $true)][string]$SecondPath
    )
    if (Test-PathEqual -Left $FirstPath -Right $SecondPath) {
        throw "$FirstName and $SecondName must be different directories. Both resolve to '$FirstPath'."
    }
}

function Assert-FreeSpace {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$MinimumGB,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $probe = $Path
    while (-not (Test-Path -LiteralPath $probe)) {
        $parent = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($parent)) { break }
        $probe = $parent
    }
    if (-not (Test-Path -LiteralPath $probe)) {
        throw "Cannot determine free space for $Name because no parent of '$Path' exists."
    }
    $root = [System.IO.Path]::GetPathRoot($probe)
    if ([string]::IsNullOrWhiteSpace($root)) {
        throw "Cannot determine the volume for $Name at '$Path'."
    }
    $drive = New-Object System.IO.DriveInfo($root)
    $required = [int64]$MinimumGB * 1GB
    if ($drive.AvailableFreeSpace -lt $required) {
        $availableGB = [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
        throw "$Name requires at least $MinimumGB GB free on $root; only $availableGB GB is available."
    }
}

function New-RandomHex {
    param([Parameter(Mandatory = $true)][int]$Bytes)
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    }
    finally {
        $generator.Dispose()
    }
    $builder = New-Object System.Text.StringBuilder
    foreach ($value in $buffer) {
        [void]$builder.Append($value.ToString('x2'))
    }
    return $builder.ToString()
}

function Read-EnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "The environment file was not found: $Path"
    }
    $values = @{}
    $lines = [System.IO.File]::ReadAllLines($Path, (New-Object System.Text.UTF8Encoding($false)))
    for ($index = 0; $index -lt $lines.Length; $index++) {
        $line = $lines[$index]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) {
            throw "service.env line $($index + 1) is not KEY=VALUE."
        }
        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "service.env line $($index + 1) has an invalid variable name."
        }
        $values[$key] = $value
    }
    return $values
}

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = $null
    )
    if ($Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
        return [string]$Values[$Name]
    }
    return $Default
}

function Write-TextFileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )
    $directory = [System.IO.Path]::GetDirectoryName($Path)
    if ([string]::IsNullOrWhiteSpace($directory)) {
        throw "Cannot write a file without a parent directory: $Path"
    }
    [void][System.IO.Directory]::CreateDirectory($directory)
    $temporary = Join-Path $directory ([System.IO.Path]::GetRandomFileName())
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporary, $Content, $encoding)
        if (Test-Path -LiteralPath $Path) {
            [System.IO.File]::Replace($temporary, $Path, $null)
        }
        else {
            [System.IO.File]::Move($temporary, $Path)
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function ConvertTo-PlainText {
    param([Parameter(Mandatory = $true)][System.Security.SecureString]$SecureString)
    $pointer = [System.IntPtr]::Zero
    try {
        $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        if ($pointer -ne [System.IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function Assert-AccountExists {
    param([string]$Account, [string]$Name)
    if ([string]::IsNullOrWhiteSpace($Account)) {
        throw "$Name must not be empty."
    }
    $resolvedAccount = $Account.Trim()
    switch ($resolvedAccount.ToLowerInvariant()) {
        'localsystem' { $resolvedAccount = 'NT AUTHORITY\SYSTEM' }
        'localservice' { $resolvedAccount = 'NT AUTHORITY\LocalService' }
        'networkservice' { $resolvedAccount = 'NT AUTHORITY\NetworkService' }
    }
    try {
        $null = (New-Object System.Security.Principal.NTAccount($resolvedAccount)).Translate([System.Security.Principal.SecurityIdentifier])
    }
    catch {
        throw "$Name '$Account' could not be resolved on this host: $($_.Exception.Message)"
    }
}

function Set-PathAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$RightsByAccount,
        [switch]$NoInherit,
        [switch]$Container
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot set permissions because the path does not exist: $Path"
    }
    if ($RightsByAccount.Count -eq 0) {
        throw 'Cannot set permissions because no accounts were supplied.'
    }
    foreach ($account in $RightsByAccount.Keys) {
        $resolvedAccount = $account
        switch ($account.Trim().ToLowerInvariant()) {
            'localsystem' { $resolvedAccount = 'NT AUTHORITY\SYSTEM' }
            'localservice' { $resolvedAccount = 'NT AUTHORITY\LocalService' }
            'networkservice' { $resolvedAccount = 'NT AUTHORITY\NetworkService' }
        }
        try {
            $null = (New-Object System.Security.Principal.NTAccount($resolvedAccount)).Translate([System.Security.Principal.SecurityIdentifier])
        }
        catch {
            throw "Cannot set permissions because account '$account' could not be resolved: $($_.Exception.Message)"
        }
    }
    $acl = Get-Acl -LiteralPath $Path
    if ($NoInherit) {
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) {
            [void]$acl.RemoveAccessRule($rule)
        }
    }
    foreach ($account in $RightsByAccount.Keys) {
        $rights = $RightsByAccount[$account]
        $resolvedAccount = $account
        switch ($account.Trim().ToLowerInvariant()) {
            'localsystem' { $resolvedAccount = 'NT AUTHORITY\SYSTEM' }
            'localservice' { $resolvedAccount = 'NT AUTHORITY\LocalService' }
            'networkservice' { $resolvedAccount = 'NT AUTHORITY\NetworkService' }
        }
        if ($Container) {
            $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
            $propagation = [System.Security.AccessControl.PropagationFlags]::None
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($resolvedAccount, $rights, $inheritance, $propagation, 'Allow')
        }
        else {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($resolvedAccount, $rights, 'Allow')
        }
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-ServiceDirectoryAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ServiceAccount,
        [switch]$Modify,
        [switch]$NoInherit,
        [string[]]$AdditionalAccount = @(),
        [string]$AdditionalRights = 'ReadAndExecute'
    )
    Assert-AccountExists -Account $ServiceAccount -Name 'ServiceAccount'
    foreach ($account in $AdditionalAccount) {
        if (-not [string]::IsNullOrWhiteSpace($account)) {
            Assert-AccountExists -Account $account -Name 'AdditionalAccount'
        }
    }
    [void][System.IO.Directory]::CreateDirectory($Path)
    $rights = @{}
    if ($Modify) {
        $rights[$ServiceAccount] = 'Modify'
    }
    else {
        $rights[$ServiceAccount] = 'ReadAndExecute'
    }
    foreach ($account in $AdditionalAccount) {
        if ([string]::IsNullOrWhiteSpace($account)) { continue }
        $normalized = $account.ToLowerInvariant()
        if ($normalized -eq 'administrators' -or $normalized -eq 'builtin\administrators' -or $normalized -eq 'system' -or $normalized -eq 'nt authority\system') {
            continue
        }
        if (-not $rights.ContainsKey($account)) {
            $rights[$account] = $AdditionalRights
        }
    }
    $rights['BUILTIN\Administrators'] = 'FullControl'
    $rights['NT AUTHORITY\SYSTEM'] = 'FullControl'
    if ($NoInherit) {
        Set-PathAcl -Path $Path -RightsByAccount $rights -Container -NoInherit
    }
    else {
        Set-PathAcl -Path $Path -RightsByAccount $rights -Container
    }
}

function Set-SecretFileAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ServiceAccount,
        [string[]]$AdditionalAccount = @()
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot protect a missing file: $Path"
    }
    $rights = @{}
    $rights['BUILTIN\Administrators'] = 'FullControl'
    $rights[$ServiceAccount] = 'Read'
    foreach ($account in $AdditionalAccount) {
        if (-not [string]::IsNullOrWhiteSpace($account)) { $rights[$account] = 'Read' }
    }
    Set-PathAcl -Path $Path -RightsByAccount $rights -NoInherit
}

function Set-AdminOnlyFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot protect a missing file: $Path"
    }
    $rights = @{}
    $rights['BUILTIN\Administrators'] = 'FullControl'
    Set-PathAcl -Path $Path -RightsByAccount $rights -NoInherit
}

function Test-LoopbackHost {
    param([Parameter(Mandatory = $true)][string]$HostName)
    return @('127.0.0.1', '::1', 'localhost') -contains $HostName.ToLowerInvariant()
}

function Test-TcpReachable {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutMilliseconds = 2000
    )
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Invoke-WithEnvironment {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Environment,
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
    )
    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
        [System.Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }
    try {
        & $ScriptBlock
    }
    finally {
        foreach ($key in $Environment.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
        }
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$FailureMessage,
        [switch]$AllowFailure,
        [hashtable]$Environment = @{}
    )
    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
        [System.Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }
    try {
        & $FilePath @ArgumentList
        $code = $LASTEXITCODE
    }
    finally {
        foreach ($key in $Environment.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
        }
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "$FailureMessage (exit code $code)."
    }
    return $code
}

if (-not ('TsaBonno.BarLocal.LsaRights' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace TsaBonno.BarLocal
{
    public static class LsaRights
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct LSA_UNICODE_STRING
        {
            public ushort Length;
            public ushort MaximumLength;
            public IntPtr Buffer;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LSA_OBJECT_ATTRIBUTES
        {
            public int Length;
            public IntPtr RootDirectory;
            public IntPtr ObjectName;
            public int Attributes;
            public IntPtr SecurityDescriptor;
            public IntPtr SecurityQualityOfService;
        }

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint LsaOpenPolicy(ref LSA_UNICODE_STRING systemName, ref LSA_OBJECT_ATTRIBUTES objectAttributes, uint desiredAccess, out IntPtr policyHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint LsaAddAccountRights(IntPtr policyHandle, byte[] accountSid, LSA_UNICODE_STRING[] userRights, uint countOfRights);

        [DllImport("advapi32.dll")]
        private static extern uint LsaClose(IntPtr handle);

        [DllImport("advapi32.dll")]
        private static extern uint LsaNtStatusToWinError(uint status);

        public static void AddServiceLogonRight(string account)
        {
            NTAccount ntAccount = new NTAccount(account);
            SecurityIdentifier sid = (SecurityIdentifier)ntAccount.Translate(typeof(SecurityIdentifier));
            byte[] sidBytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(sidBytes, 0);

            LSA_UNICODE_STRING right = new LSA_UNICODE_STRING();
            right.Buffer = Marshal.StringToHGlobalUni("SeServiceLogonRight");
            right.Length = (ushort)(("SeServiceLogonRight".Length) * 2);
            right.MaximumLength = (ushort)(right.Length + 2);

            LSA_OBJECT_ATTRIBUTES attributes = new LSA_OBJECT_ATTRIBUTES();
            attributes.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));

            LSA_UNICODE_STRING systemName = new LSA_UNICODE_STRING();
            IntPtr policy = IntPtr.Zero;
            try
            {
                uint openStatus = LsaOpenPolicy(ref systemName, ref attributes, 0x00000010, out policy);
                if (openStatus != 0) throw new System.ComponentModel.Win32Exception((int)LsaNtStatusToWinError(openStatus));

                uint addStatus = LsaAddAccountRights(policy, sidBytes, new LSA_UNICODE_STRING[] { right }, 1);
                if (addStatus != 0) throw new System.ComponentModel.Win32Exception((int)LsaNtStatusToWinError(addStatus));
            }
            finally
            {
                if (right.Buffer != IntPtr.Zero) Marshal.FreeHGlobal(right.Buffer);
                if (policy != IntPtr.Zero) LsaClose(policy);
            }
        }
    }
}
'@
}

function Grant-ServiceLogonRight {
    param([Parameter(Mandatory = $true)][string]$Account)
    $normalized = $Account.ToLowerInvariant()
    if ($normalized -eq 'localsystem' -or $normalized -eq 'nt authority\system' -or
        $normalized -eq 'localservice' -or $normalized -eq 'nt authority\localservice' -or
        $normalized -eq 'networkservice' -or $normalized -eq 'nt authority\networkservice' -or
        $normalized.StartsWith('nt service\')) {
        return
    }
    if ($normalized.EndsWith('$')) {
        return
    }
    [TsaBonno.BarLocal.LsaRights]::AddServiceLogonRight($Account)
}

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ""
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Write-Note {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "   $Message"
}
