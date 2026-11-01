#Requires -Version 5.1
<#
.SYNOPSIS
Installs (or updates) the Tsa Bonno local Bar Windows service.

.DESCRIPTION
Compiles the in-box C# service wrapper with the .NET Framework csc.exe, creates
or reconfigures the Windows service, grants the service account least privilege,
configures restart recovery, and starts the service.

This script does not create or modify PostgreSQL and never writes secrets to the
console. Run install-server.ps1 for a complete single-host install.
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'BarLocalService',
    [string]$DisplayName = 'Tsa Bonno Bar Local Service',
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'Tsa Bonno\BarLocal'),
    [string]$DataDir = (Join-Path $env:ProgramData 'Tsa Bonno\BarLocal'),
    [string]$EnvFile = '',
    [string]$LogDir = '',
    [string]$NodePath = '',
    [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
    [System.Security.SecureString]$ServiceAccountPassword,
    [string]$PgServiceAccount = 'NT AUTHORITY\NetworkService',
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

function Stop-ExistingService {
    param([string]$Name)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $service) { return }
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        Write-Note "Stopping existing service $Name."
        Stop-Service -Name $Name -Force
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }
}

function Assert-Node20 {
    param([string]$Path)
    $versionOutput = & $Path --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not run '$Path --version'. Supply -NodePath to a Node.js 20 LTS or newer node.exe."
    }
    $text = ($versionOutput | Out-String).Trim()
    $match = [regex]::Match($text, '^v(\d+)\.')
    if (-not $match.Success) {
        throw "Could not parse the Node.js version from '$text'."
    }
    $major = [int]$match.Groups[1].Value
    if ($major -lt 20) {
        throw "Node.js 20 LTS or newer is required; $Path reports $text."
    }
}

function Find-CSharpCompiler {
    $candidates = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'The .NET Framework C# compiler csc.exe was not found. Install the .NET Framework 4.x targeting/runtime files on this Windows host.'
}

function Compile-Service {
    param(
        [string]$Source,
        [string]$Output,
        [string]$Compiler
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "The service wrapper source was not found: $Source"
    }
    $frameworkDir = Split-Path -Parent $Compiler
    $references = @(
        (Join-Path $frameworkDir 'System.dll'),
        (Join-Path $frameworkDir 'System.Core.dll'),
        (Join-Path $frameworkDir 'System.ServiceProcess.dll')
    )
    foreach ($reference in $references) {
        if (-not (Test-Path -LiteralPath $reference)) {
            throw "The .NET Framework reference assembly was not found: $reference"
        }
    }
    [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $Output))
    $arguments = @(
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        ('/out:' + $Output),
        ('/r:' + $references[0]),
        ('/r:' + $references[1]),
        ('/r:' + $references[2]),
        $Source
    )
    Write-Note "Compiling service wrapper with $Compiler"
    $compilerOutput = & $Compiler @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("The service wrapper failed to compile:`n" + (($compilerOutput | ForEach-Object { [string]$_ }) -join "`n"))
    }
    if (-not (Test-Path -LiteralPath $Output)) {
        throw "The compiler reported success but $Output was not created."
    }
}

function Set-ServiceAccount {
    param(
        [string]$Name,
        [string]$Account,
        [System.Security.SecureString]$Password
    )
    $builtIn = @(
        'localsystem',
        'nt authority\system',
        'localservice',
        'nt authority\localservice',
        'networkservice',
        'nt authority\networkservice'
    ) -contains $Account.ToLowerInvariant()

    if ($builtIn) {
        Invoke-External -FilePath 'sc.exe' -ArgumentList @('config', $Name, 'obj=', $Account) -FailureMessage "Could not set the service account to $Account" | Out-Null
        return
    }

    if ($null -eq $Password) {
        if ($Account.EndsWith('$') -or $Account.ToLowerInvariant().StartsWith('nt service\')) {
            Invoke-External -FilePath 'sc.exe' -ArgumentList @('config', $Name, 'obj=', $Account) -FailureMessage "Could not set the service account to $Account" | Out-Null
            return
        }
        throw "A dedicated service account requires -ServiceAccountPassword. Supply a SecureString password, or use -ServiceAccount 'NT AUTHORITY\LocalService' for a built-in least-privilege account."
    }
    $plain = ConvertTo-PlainText -SecureString $Password
    try {
        Invoke-External -FilePath 'sc.exe' -ArgumentList @('config', $Name, 'obj=', $Account, 'password=', $plain) -FailureMessage "Could not set the service account to $Account" | Out-Null
    }
    finally {
        $plain = $null
    }
}

function Protect-ServiceSecrets {
    param(
        [string]$Root,
        [string]$Account
    )
    $candidates = @(
        (Join-Path $Root 'setup-secret.txt'),
        (Join-Path $Root 'secrets\backup.key'),
        (Join-Path $Root 'tls\service.crt'),
        (Join-Path $Root 'tls\service.key')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            Set-SecretFileAcl -Path $candidate -ServiceAccount $Account
        }
    }
}

function Start-BarService {
    param([string]$Name, [string]$LogDirectory)
    Start-Service -Name $Name
    $service = Get-Service -Name $Name
    try {
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
    }
    catch {
        $status = (Get-Service -Name $Name).Status
        throw "The service $Name did not reach Running (current status: $status). Inspect $LogDirectory\service.log, stdout.log and stderr.log, then correct the configuration and retry."
    }
    Write-Host "Service $Name is running." -ForegroundColor Green
}

Assert-Elevated
$InstallDir = Resolve-AbsolutePath -Path $InstallDir -Name 'InstallDir'
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal\service.env'
}
if ([string]::IsNullOrWhiteSpace($LogDir)) {
    $LogDir = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal\logs'
}
$EnvFile = Resolve-AbsolutePath -Path $EnvFile -Name 'EnvFile'
$LogDir = Resolve-AbsolutePath -Path $LogDir -Name 'LogDir'
Assert-DedicatedDirectory -Path $InstallDir -Name 'InstallDir'
Assert-DedicatedDirectory -Path $DataDir -Name 'DataDir'
Assert-DedicatedDirectory -Path $LogDir -Name 'LogDir'
if (Test-PathWithin -Child $DataDir -Parent $InstallDir) {
    throw 'DataDir must not be nested under InstallDir; uninstall must never remove service data with the binaries.'
}
if (Test-PathWithin -Child $InstallDir -Parent $DataDir) {
    throw 'InstallDir must not be nested under DataDir; service binaries must stay separate from protected service data.'
}
if (Test-PathWithin -Child $LogDir -Parent $InstallDir) {
    throw 'LogDir must not be nested under InstallDir; uninstall must not remove service logs with the binaries.'
}
if ([string]::IsNullOrWhiteSpace($ServiceAccount)) { throw 'ServiceAccount must not be empty.' }
if ([string]::IsNullOrWhiteSpace($PgServiceAccount)) { throw 'PgServiceAccount must not be empty.' }
Assert-AccountExists -Account $ServiceAccount -Name 'ServiceAccount'
Assert-AccountExists -Account $PgServiceAccount -Name 'PgServiceAccount'

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw 'node.exe was not found on PATH. Install Node.js 20 LTS or newer and pass -NodePath explicitly.'
    }
    $NodePath = $command.Source
}
if (Test-Path -LiteralPath $NodePath -PathType Container) {
    $NodePath = Join-Path $NodePath 'node.exe'
}
$NodePath = Resolve-AbsolutePath -Path $NodePath -Name 'NodePath'
if (-not (Test-Path -LiteralPath $NodePath)) {
    throw "node.exe was not found at $NodePath."
}
if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'dist\server.js'))) {
    throw "The compiled service was not found at $(Join-Path $InstallDir 'dist\server.js'). Run install-server.ps1 with a built -ServiceRoot, or copy dist before installing the service."
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "The service environment file was not found: $EnvFile. Run install-server.ps1 to create it before installing the service."
}
if (Test-PathEqual -Left $InstallDir -Right $DataDir) {
    throw 'InstallDir and DataDir must not be the same directory.'
}

Assert-Node20 -Path $NodePath
[void][System.IO.Directory]::CreateDirectory($DataDir)
[void][System.IO.Directory]::CreateDirectory($LogDir)

$compiler = Find-CSharpCompiler
$serviceExe = Join-Path $InstallDir 'service\BarLocalService.exe'
Stop-ExistingService -Name $ServiceName
Compile-Service -Source (Join-Path $PSScriptRoot 'service\BarLocalService.cs') -Output $serviceExe -Compiler $compiler

Write-Step "Configuring Windows service $ServiceName"
$quotedExe = '"' + $serviceExe + '"'
$binaryPath = $quotedExe + ' --install-dir="' + $InstallDir + '" --node-path="' + $NodePath + '" --env-file="' + $EnvFile + '" --log-dir="' + $LogDir + '" --data-dir="' + $DataDir + '"'

$serviceCreated = $false
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -eq $existing) {
    New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName $DisplayName -StartupType Automatic | Out-Null
    $serviceCreated = $true
    Write-Note "Created service $ServiceName."
}
else {
    Invoke-External -FilePath 'sc.exe' -ArgumentList @('config', $ServiceName, 'binPath=', $binaryPath, 'start=', 'auto', 'DisplayName=', $DisplayName) -FailureMessage "Could not update service $ServiceName" | Out-Null
    Write-Note "Updated existing service $ServiceName."
}
Invoke-External -FilePath 'sc.exe' -ArgumentList @('description', $ServiceName, 'Tsa Bonno local Bar authority service (PostgreSQL-backed).') -FailureMessage "Could not set the description for $ServiceName" | Out-Null

try {
    Set-ServiceAccount -Name $ServiceName -Account $ServiceAccount -Password $ServiceAccountPassword
    Grant-ServiceLogonRight -Account $ServiceAccount
}
catch {
    if ($serviceCreated) {
        $deleteOutput = & sc.exe delete $ServiceName 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Could not remove the newly created service ${ServiceName}: $deleteOutput"
        }
        else {
            Write-Warning "Removed the newly created service $ServiceName because its account could not be configured."
        }
    }
    throw
}

Write-Step 'Applying least-privilege permissions'
Set-ServiceDirectoryAcl -Path $InstallDir -ServiceAccount $ServiceAccount -NoInherit
Set-ServiceDirectoryAcl -Path $DataDir -ServiceAccount $ServiceAccount -NoInherit -AdditionalAccount @($PgServiceAccount)
$tempDir = Join-Path $DataDir 'temp'
[void][System.IO.Directory]::CreateDirectory($tempDir)
Set-ServiceDirectoryAcl -Path $tempDir -ServiceAccount $ServiceAccount -Modify -NoInherit
Set-ServiceDirectoryAcl -Path $LogDir -ServiceAccount $ServiceAccount -Modify -NoInherit
Set-SecretFileAcl -Path $EnvFile -ServiceAccount $ServiceAccount
Protect-ServiceSecrets -Root $DataDir -Account $ServiceAccount
$dataSecrets = Join-Path $DataDir 'secrets'
if (Test-Path -LiteralPath $dataSecrets) {
    Set-ServiceDirectoryAcl -Path $dataSecrets -ServiceAccount $ServiceAccount -NoInherit
}
$tlsSecrets = Join-Path $DataDir 'tls'
if (Test-Path -LiteralPath $tlsSecrets) {
    Set-ServiceDirectoryAcl -Path $tlsSecrets -ServiceAccount $ServiceAccount -NoInherit -AdditionalAccount @($PgServiceAccount)
}

Write-Step 'Configuring failure recovery'
Invoke-External -FilePath 'sc.exe' -ArgumentList @('failure', $ServiceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/10000/restart/30000') -FailureMessage "Could not configure restart recovery for $ServiceName" | Out-Null
Invoke-External -FilePath 'sc.exe' -ArgumentList @('failureflag', $ServiceName, '1') -FailureMessage "Could not enable failure actions for $ServiceName" | Out-Null

try {
    if (-not [System.Diagnostics.EventLog]::SourceExists($ServiceName)) {
        New-EventLog -LogName Application -Source $ServiceName -ErrorAction Stop
    }
}
catch {
    Write-Note "Could not register the '$ServiceName' event log source; file logs remain authoritative. $($_.Exception.Message)"
}

if (-not $NoStart) {
    Write-Step "Starting $ServiceName"
    Start-BarService -Name $ServiceName -LogDirectory $LogDir
}
else {
    Write-Note "Service installed but not started (-NoStart)."
}

Write-Host ''
Write-Host 'Service installation complete.' -ForegroundColor Green
Write-Note "Service:   $ServiceName"
Write-Note "Executable: $serviceExe"
Write-Note "InstallDir: $InstallDir"
Write-Note "Env file:   $EnvFile"
Write-Note "Logs:       $LogDir"
Write-Note "Account:    $ServiceAccount"
