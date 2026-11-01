#Requires -Version 5.1
<#
.SYNOPSIS
Enrol a standby PostgreSQL 17 host for the local Bar authority.

.DESCRIPTION
Runs the existing scripts/bar-replication.mjs enroll command with the protected
replication password, verifies the standby is streaming, writes a protected
pgpass file for restart-safe WAL streaming, and optionally registers the standby
as a Windows service. It never starts the Bar application service on the standby
and never modifies a client or service.env file.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PrimaryHost,
    [Parameter(Mandatory = $true)][int]$PrimaryPort,
    [Parameter(Mandatory = $true)][string]$StandbyDataDir,
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'Tsa Bonno\BarLocal'),
    [string]$DataDir = '',
    [string]$EnvFile = '',
    [string]$NodePath = '',
    [string]$PgBin = '',
    [string]$PgDataDir = '',
    [string]$DbName = '',
    [string]$ReplicationUser = '',
    [string]$ReplicationPasswordFile = '',
    [string]$AdminUser = '',
    [string]$StandbyAdminPasswordFile = '',
    [string]$StandbyAdminDatabase = '',
    [string]$StandbyAdminHost = '127.0.0.1',
    [int]$StandbyAdminPort = 0,
    [int]$TimeoutMs = 900000,
    [switch]$AllowPrivatePrimary,
    [switch]$RegisterPgService,
    [string]$PgServiceName = 'BarLocalPostgreSQLStandby',
    [string]$PgServiceAccount = 'NT AUTHORITY\NetworkService',
    [System.Security.SecureString]$PgServiceAccountPassword,
    [switch]$Confirm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

$programDataRoot = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal'

function Read-SecretText {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Name was not found: $Path"
    }
    $value = ([System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is empty: $Path"
    }
    return $value
}

function Protect-Text {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $safe = [regex]::Replace($Text, '(postgres(?:ql)?://)[^@\s/@]+@', '$1***@')
    $safe = [regex]::Replace($safe, '(?i)(password\s*=\s*)[^\s;]+', '$1***')
    return $safe
}

function New-PgAdminUrl {
    param(
        [string]$User,
        [string]$Password,
        [string]$HostName,
        [int]$Port,
        [string]$Database
    )
    if ([string]::IsNullOrWhiteSpace($User)) { throw 'The administrative PostgreSQL user must not be empty.' }
    if ([string]::IsNullOrWhiteSpace($Database) -or $Database -notmatch '^bar_local(?:_|$)') {
        throw "The administrative database must be a bar_local database; received '$Database'."
    }
    if ($Database -match '^bar_local_test(?:_|$)') {
        throw "The administrative database must not be a bar_local_test database; received '$Database'."
    }
    $hostPart = $HostName
    if ($HostName -eq '::1') { $hostPart = '[::1]' }
    $encodedUser = [uri]::EscapeDataString($User)
    $encodedPassword = [uri]::EscapeDataString($Password)
    $encodedDatabase = [uri]::EscapeDataString($Database)
    return ('postgresql://' + $encodedUser + ':' + $encodedPassword + '@' + $hostPart + ':' + [string]$Port + '/' + $encodedDatabase)
}

function New-PgPassField {
    param([string]$Value)
    return $Value.Replace('\', '\\').Replace(':', '\:')
}

function Invoke-NodeCli {
    param(
        [string]$Node,
        [string]$Script,
        [string[]]$Arguments,
        [hashtable]$Environment
    )
    $cleared = @(
        'DATABASE_URL',
        'SUPABASE_DB_URL',
        'SUPABASE_POOLER_URL',
        'PGHOST',
        'PGPASSWORD',
        'PGSSLMODE',
        'BAR_LOCAL_TEST_DB',
        'BAR_LOCAL_ALLOW_TEST_DB',
        'BAR_LOCAL_BOOTSTRAP_PASSWORD',
        'BAR_LOCAL_SETUP_SECRET',
        'BAR_LOCAL_BACKUP_KEY',
        'BAR_LOCAL_ADMIN_DATABASE_URL',
        'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL',
        'BAR_LOCAL_REPLICATION_PASSWORD'
    )
    $saved = @{}
    foreach ($name in $cleared) {
        $saved[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        [System.Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    try {
        $result = Invoke-WithEnvironment -Environment $Environment -ScriptBlock {
            $output = & $Node $Script @Arguments 2>&1
            return [pscustomobject]@{ Code = $LASTEXITCODE; Output = @($output) }
        }
    }
    finally {
        foreach ($name in $cleared) {
            [System.Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
    $text = (($result.Output | ForEach-Object { [string]$_ }) -join "`n")
    return [pscustomobject]@{ Code = $result.Code; Text = $text }
}

function Assert-PgTool {
    param([string]$Bin, [string]$Name)
    $path = Join-Path $Bin $Name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "$Name was not found under -PgBin: $Bin"
    }
}

function Invoke-PgCtl {
    param(
        [string]$Bin,
        [string[]]$ArgumentList,
        [string]$FailureMessage
    )
    & (Join-Path $Bin 'pg_ctl.exe') @ArgumentList | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

function Wait-PgReady {
    param([string]$Bin, [string]$HostName, [int]$Port)
    $isReady = Join-Path $Bin 'pg_isready.exe'
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & $isReady '-h' $HostName '-p' ([string]$Port) '-q' | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL did not accept connections at $HostName`:$Port within 60 seconds."
}

function Invoke-PsqlScalar {
    param(
        [string]$Bin,
        [string]$HostName,
        [int]$Port,
        [string]$User,
        [string]$Password,
        [string]$Database,
        [string]$Sql
    )
    $environment = @{
        PGPASSWORD = $Password
        PGSSLMODE = 'disable'
    }
    $result = Invoke-WithEnvironment -Environment $environment -ScriptBlock {
        $output = & (Join-Path $Bin 'psql.exe') '-X' '-q' '-A' '-t' '-v' 'ON_ERROR_STOP=1' '-h' $HostName '-p' ([string]$Port) '-U' $User '-d' $Database '-c' $Sql 2>&1
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = @($output) }
    }
    if ($result.Code -ne 0) {
        $detail = Protect-Text ((($result.Output | ForEach-Object { [string]$_ }) -join ' ').Trim())
        throw "psql verification failed: $detail"
    }
    return ((($result.Output | ForEach-Object { [string]$_ }) -join "`n").Trim())
}

function Update-StandbyConninfo {
    param(
        [string]$DataDirectory,
        [string]$PassfilePath
    )
    $autoConf = Join-Path $DataDirectory 'postgresql.auto.conf'
    if (-not (Test-Path -LiteralPath $autoConf)) {
        throw "postgresql.auto.conf was not found after pg_basebackup: $autoConf"
    }
    $text = ([System.IO.File]::ReadAllText($autoConf, (New-Object System.Text.UTF8Encoding($false)))).TrimStart([char]0xFEFF)
    if ($PassfilePath -match "'|\r|\n") {
        throw 'The generated pgpass path contains an unsupported quote or newline.'
    }
    $normalizedPassfile = $PassfilePath.Replace('\', '/')
    $pattern = "(?m)^(\s*primary_conninfo\s*=\s*')(.*)('\s*)$"
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        throw 'pg_basebackup did not write a single-line primary_conninfo into postgresql.auto.conf. Refusing to guess how to add the protected passfile.'
    }
    $value = [regex]::Replace($match.Groups[2].Value, "\s*passfile='[^']*'", '')
    $value = $value.TrimEnd()
    $value = $value + " passfile='" + $normalizedPassfile + "'"
    $updated = $text.Substring(0, $match.Index) + $match.Groups[1].Value + $value + $match.Groups[3].Value + $text.Substring($match.Index + $match.Length)
    Write-TextFileAtomic -Path $autoConf -Content ($updated + "`n")
    $verify = [System.IO.File]::ReadAllText($autoConf, (New-Object System.Text.UTF8Encoding($false)))
    if ($verify -notmatch [regex]::Escape("passfile='" + $normalizedPassfile + "'")) {
        throw 'The protected passfile could not be verified in postgresql.auto.conf.'
    }
}

function Write-StandbyPgPass {
    param(
        [string]$Path,
        [string]$Password
    )
    $line = '*:*:*:*:' + (New-PgPassField -Value $Password) + "`n"
    Write-TextFileAtomic -Path $Path -Content $line
}

function Set-PgDataDirectoryAcl {
    param([string]$Path, [string]$Account)
    [void][System.IO.Directory]::CreateDirectory($Path)
    $effectiveAccount = $Account.Trim()
    switch ($effectiveAccount.ToLowerInvariant()) {
        'localsystem' { $effectiveAccount = 'NT AUTHORITY\SYSTEM' }
        'localservice' { $effectiveAccount = 'NT AUTHORITY\LocalService' }
        'networkservice' { $effectiveAccount = 'NT AUTHORITY\NetworkService' }
    }
    $rights = @{}
    $rights['BUILTIN\Administrators'] = 'FullControl'
    $rights['NT AUTHORITY\SYSTEM'] = 'FullControl'
    $rights[$effectiveAccount] = 'FullControl'
    Set-PathAcl -Path $Path -RightsByAccount $rights -Container -NoInherit
    & icacls.exe $Path /grant ($effectiveAccount + ':(OI)(CI)F') /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not grant the PostgreSQL account recursive access to $Path (icacls exit code $LASTEXITCODE)."
    }
}

function Test-PgServiceOwnership {
    param([string]$Name, [string]$DataDirectory)
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $service) { return $false }
    $query = (& sc.exe qc $Name 2>&1 | Out-String)
    $ownershipPattern = '(?i)(?:^|[\s"])' + [regex]::Escape($DataDirectory) + '(?:[\s"]|$)'
    if ($query -notmatch $ownershipPattern) {
        throw "A Windows service named $Name already exists but does not reference $DataDirectory. Refusing to reuse or overwrite an unrelated PostgreSQL service."
    }
    return $true
}

function Get-WindowsServiceAccount {
    param([string]$Name)
    $escaped = $Name.Replace("'", "''")
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$escaped'" -ErrorAction Stop
    if ($null -eq $service) { return $null }
    return [string]$service.StartName
}

function ConvertTo-NormalizedServiceAccount {
    param([string]$Account)
    $value = $Account.Trim().ToLowerInvariant()
    switch ($value) {
        'localsystem' { return 'localsystem' }
        'nt authority\system' { return 'localsystem' }
        'localservice' { return 'nt authority\localservice' }
        'networkservice' { return 'nt authority\networkservice' }
    }
    return $value
}

function Assert-StandbyPgServiceAccount {
    param([string]$Name, [string]$DataDirectory, [string]$Account)
    if (-not (Test-PgServiceOwnership -Name $Name -DataDirectory $DataDirectory)) { return }
    $existingAccount = Get-WindowsServiceAccount -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($existingAccount) -and
        -not [string]::Equals((ConvertTo-NormalizedServiceAccount -Account $existingAccount), (ConvertTo-NormalizedServiceAccount -Account $Account), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PostgreSQL service $Name already runs as '$existingAccount', but -PgServiceAccount is '$Account'. Pass the existing account so its standby data-directory permissions are not removed."
    }
}

function Register-StandbyService {
    param(
        [string]$Bin,
        [string]$DataDirectory,
        [string]$Name,
        [string]$Account,
        [System.Security.SecureString]$Password
    )
    if (Test-PgServiceOwnership -Name $Name -DataDirectory $DataDirectory) {
        Write-Note "PostgreSQL service $Name already references this standby data directory."
        return
    }
    $arguments = @('register', '-N', $Name, '-D', $DataDirectory, '-S', 'auto', '-U', $Account)
    $plain = $null
    try {
        if ($null -ne $Password) {
            $plain = ConvertTo-PlainText -SecureString $Password
            $arguments += @('-P', $plain)
        }
        & (Join-Path $Bin 'pg_ctl.exe') @arguments | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "pg_ctl register failed with exit code $LASTEXITCODE for service $Name."
        }
    }
    finally {
        $plain = $null
    }
    Grant-ServiceLogonRight -Account $Account
    Write-Note "Registered standby PostgreSQL service $Name."
}

Assert-Elevated
if (-not $Confirm) {
    throw 'Standby enrollment requires -Confirm after reviewing the primary host, ports, data directory and replication role.'
}
$PrimaryHost = $PrimaryHost.Trim()
if ([string]::IsNullOrWhiteSpace($PrimaryHost)) { throw 'PrimaryHost must not be empty.' }
if ($PrimaryPort -lt 1 -or $PrimaryPort -gt 65535) { throw 'PrimaryPort must be between 1 and 65535.' }
if ($PrimaryPort -eq 5432) { throw 'PrimaryPort must not be the default PostgreSQL port 5432. The Bar instance uses a dedicated port.' }
if ($TimeoutMs -lt 10000 -or $TimeoutMs -gt 86400000) { throw 'TimeoutMs must be between 10000 and 86400000.' }
$StandbyDataDir = Resolve-AbsolutePath -Path $StandbyDataDir -Name 'StandbyDataDir'
Assert-DedicatedDirectory -Path $StandbyDataDir -Name 'StandbyDataDir'
$envFileWasSupplied = $PSBoundParameters.ContainsKey('EnvFile')
if ([string]::IsNullOrWhiteSpace($EnvFile)) { $EnvFile = Join-Path $programDataRoot 'service.env' }
$EnvFile = Resolve-AbsolutePath -Path $EnvFile -Name 'EnvFile'
$serviceEnvironment = @{}
if (Test-Path -LiteralPath $EnvFile) {
    $serviceEnvironment = Read-EnvFile -Path $EnvFile
}
elseif ($envFileWasSupplied) {
    throw "The supplied service.env was not found: $EnvFile"
}
else {
    Write-Warning "No service.env was found at $EnvFile; falling back to explicit parameters. Supply -PgBin, -ReplicationPasswordFile and -StandbyAdminPasswordFile on a standby host."
}

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_DATA_DIR' -Default '')
    if ([string]::IsNullOrWhiteSpace($DataDir)) { $DataDir = $programDataRoot }
}
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
Assert-DedicatedDirectory -Path $DataDir -Name 'DataDir'
if (Test-PathEqual -Left $StandbyDataDir -Right $DataDir) {
    throw 'StandbyDataDir must not be the primary service data directory.'
}
if ([string]::IsNullOrWhiteSpace($DbName)) {
    $DbName = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_DB_NAME' -Default 'bar_local')
}
if ($DbName -notmatch '^bar_local(?:_|$)') { throw "DbName must begin with bar_local; received '$DbName'." }
if ($DbName -match '^bar_local_test(?:_|$)') { throw 'DbName must not be a bar_local_test database.' }
if ([string]::IsNullOrWhiteSpace($PgBin)) {
    $PgBin = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_PG_BIN' -Default '')
}
if ([string]::IsNullOrWhiteSpace($PgBin)) {
    $pgTool = Get-Command pg_basebackup.exe -ErrorAction SilentlyContinue
    if ($null -eq $pgTool) { throw 'pg_basebackup.exe was not found on PATH. Pass -PgBin pointing at the PostgreSQL 17 bin directory.' }
    $PgBin = Split-Path -Parent $pgTool.Source
}
$PgBin = Resolve-AbsolutePath -Path $PgBin -Name 'PgBin'
foreach ($tool in @('pg_basebackup.exe', 'pg_ctl.exe', 'pg_isready.exe', 'psql.exe', 'postgres.exe')) {
    Assert-PgTool -Bin $PgBin -Name $tool
}
$pgVersionOutput = & (Join-Path $PgBin 'postgres.exe') '--version' 2>&1
if ($LASTEXITCODE -ne 0 -or (($pgVersionOutput | Out-String).Trim() -notmatch 'PostgreSQL\) 17\.')) {
    throw "PostgreSQL 17 is required on the standby; $PgBin reports '$(($pgVersionOutput | Out-String).Trim())'."
}
if ([string]::IsNullOrWhiteSpace($PgDataDir)) {
    $PgDataDir = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_PG_DATA_DIR' -Default '')
}
if ([string]::IsNullOrWhiteSpace($PgDataDir)) { $PgDataDir = Join-Path $DataDir 'pgdata' }
$PgDataDir = Resolve-AbsolutePath -Path $PgDataDir -Name 'PgDataDir'
Assert-DedicatedDirectory -Path $PgDataDir -Name 'PgDataDir'
if (Test-PathEqual -Left $StandbyDataDir -Right $PgDataDir) {
    throw 'StandbyDataDir must not be the primary PostgreSQL data directory.'
}
if (Test-PathWithin -Child $StandbyDataDir -Parent $DataDir) {
    throw 'StandbyDataDir must not be nested under the primary service DataDir.'
}
if (Test-PathWithin -Child $DataDir -Parent $StandbyDataDir) {
    throw 'The primary service DataDir must not be nested under StandbyDataDir.'
}
if (Test-PathWithin -Child $StandbyDataDir -Parent $PgDataDir) {
    throw 'StandbyDataDir must not be nested under the primary PostgreSQL data directory.'
}
if (Test-PathWithin -Child $PgDataDir -Parent $StandbyDataDir) {
    throw 'The primary PostgreSQL data directory must not be nested under StandbyDataDir.'
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) { throw 'InstallDir must not be empty.' }
$InstallDir = Resolve-AbsolutePath -Path $InstallDir -Name 'InstallDir'
$replicationScript = Join-Path $InstallDir 'scripts\bar-replication.mjs'
if (-not (Test-Path -LiteralPath $replicationScript)) {
    throw "scripts/bar-replication.mjs was not found under InstallDir: $InstallDir"
}
if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'dist\operations\replication.js'))) {
    throw "The compiled replication module was not found under InstallDir: $InstallDir"
}
if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $NodePath = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_NODE_PATH' -Default '')
}
if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { throw 'node.exe was not found on PATH. Pass -NodePath.' }
    $NodePath = $nodeCommand.Source
}
$NodePath = Resolve-AbsolutePath -Path $NodePath -Name 'NodePath'
if (-not (Test-Path -LiteralPath $NodePath)) { throw "node.exe was not found at $NodePath." }
$versionOutput = & $NodePath --version 2>&1
if ($LASTEXITCODE -ne 0 -or (($versionOutput | Out-String).Trim() -notmatch '^v(2[0-9]|[3-9][0-9])\.')) {
    throw "Node.js 20 LTS or newer is required; $NodePath reports '$(($versionOutput | Out-String).Trim())'."
}

if ([string]::IsNullOrWhiteSpace($ReplicationUser)) {
    $ReplicationUser = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_REPLICATION_USER' -Default '')
    if ([string]::IsNullOrWhiteSpace($ReplicationUser)) { $ReplicationUser = 'bar_local_replicator' }
}
if ($ReplicationUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'ReplicationUser must be a valid unquoted PostgreSQL identifier.' }
if ([string]::IsNullOrWhiteSpace($ReplicationPasswordFile)) {
    $ReplicationPasswordFile = Join-Path $DataDir 'secrets\replication-password.txt'
}
$ReplicationPasswordFile = Resolve-AbsolutePath -Path $ReplicationPasswordFile -Name 'ReplicationPasswordFile'
if (-not (Test-Path -LiteralPath $ReplicationPasswordFile)) {
    throw "The replication password file was not found: $ReplicationPasswordFile. Supply -ReplicationPasswordFile with a protected copy from the primary."
}
$replicationPassword = Read-SecretText -Path $ReplicationPasswordFile -Name 'replication password file'
if ($replicationPassword.Length -lt 24) { throw 'The replication password must contain at least 24 characters.' }

if ([string]::IsNullOrWhiteSpace($AdminUser)) {
    $AdminUser = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_BOOTSTRAP_USER' -Default '')
    if ([string]::IsNullOrWhiteSpace($AdminUser)) { $AdminUser = 'postgres' }
}
if ($AdminUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'AdminUser must be a valid unquoted PostgreSQL identifier.' }
if ([string]::IsNullOrWhiteSpace($StandbyAdminPasswordFile)) {
    $StandbyAdminPasswordFile = Join-Path $DataDir 'secrets\postgres-bootstrap.txt'
}
$StandbyAdminPasswordFile = Resolve-AbsolutePath -Path $StandbyAdminPasswordFile -Name 'StandbyAdminPasswordFile'
if (-not (Test-Path -LiteralPath $StandbyAdminPasswordFile)) {
    throw "The standby administrative password file was not found: $StandbyAdminPasswordFile. Supply -StandbyAdminPasswordFile with a protected copy of the primary bootstrap password."
}
$adminPassword = Read-SecretText -Path $StandbyAdminPasswordFile -Name 'standby administrative password file'
if ([string]::IsNullOrWhiteSpace($StandbyAdminDatabase)) { $StandbyAdminDatabase = $DbName }
if (-not [string]::Equals($StandbyAdminDatabase, $DbName, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "StandbyAdminDatabase must equal DbName ($DbName); received '$StandbyAdminDatabase'."
}
$StandbyAdminHost = $StandbyAdminHost.Trim()
if ($StandbyAdminPort -eq 0) { $StandbyAdminPort = $PrimaryPort }
if ($StandbyAdminPort -ne $PrimaryPort) {
    throw "StandbyAdminPort must equal PrimaryPort ($PrimaryPort) because pg_basebackup copies the primary postgresql.conf port onto the standby."
}
if (-not (Test-LoopbackHost -HostName $StandbyAdminHost)) {
    throw 'StandbyAdminHost must be loopback. Use a local tunnel if the standby administrative connection is not local.'
}
$standbyAdminUrl = New-PgAdminUrl -User $AdminUser -Password $adminPassword -HostName $StandbyAdminHost -Port $StandbyAdminPort -Database $StandbyAdminDatabase

if (Test-LoopbackHost -HostName $PrimaryHost) {
    Write-Warning 'The primary host is loopback. A standby on the same host will conflict with the primary port copied from postgresql.conf; use a separate host for a real standby.'
}

$environment = @{
    BAR_LOCAL_DB_HOST = '127.0.0.1'
    BAR_LOCAL_DB_PORT = [string]$PrimaryPort
    BAR_LOCAL_DB_NAME = $DbName
    BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL = $standbyAdminUrl
    BAR_LOCAL_REPLICATION_PASSWORD = $replicationPassword
    BAR_LOCAL_PG_BIN = $PgBin
    BAR_LOCAL_PG_DATA_DIR = $PgDataDir
    BAR_LOCAL_NETWORK_ROLE = 'replica'
    BAR_LOCAL_REPLICATION_COORDINATOR = 'manual'
}
$arguments = @(
    'enroll',
    '--standby-data-dir', $StandbyDataDir,
    '--primary-host', $PrimaryHost,
    '--primary-port', [string]$PrimaryPort,
    '--replication-user', $ReplicationUser,
    '--confirm'
)
if ($AllowPrivatePrimary) { $arguments += '--allow-private-primary' }
$arguments += @('--timeout-ms', [string]$TimeoutMs)

$pgAccount = $PgServiceAccount
if ([string]::IsNullOrWhiteSpace($pgAccount)) { $pgAccount = 'NT AUTHORITY\NetworkService' }
Assert-AccountExists -Account $pgAccount -Name 'PgServiceAccount'
Assert-StandbyPgServiceAccount -Name $PgServiceName -DataDirectory $StandbyDataDir -Account $pgAccount

Write-Step "Enrolling standby at $StandbyDataDir from $PrimaryHost`:$PrimaryPort"
$result = Invoke-NodeCli -Node $NodePath -Script $replicationScript -Arguments $arguments -Environment $environment
if (-not [string]::IsNullOrWhiteSpace($result.Text)) {
    foreach ($line in ($result.Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Note (Protect-Text $line) }
    }
}
if ($result.Code -ne 0) {
    throw "Standby enrollment failed with exit code $($result.Code). The standby is not safe to use; inspect the reported pg_basebackup/pg_ctl error."
}
$report = $null
try {
    $report = $result.Text | ConvertFrom-Json
}
catch {
    throw 'Standby enrollment returned unparseable output. Treat the standby as unverified.'
}
if ($null -eq $report -or $report.ok -ne $true -or $report.streaming_verified -ne $true) {
    throw 'Standby enrollment did not report a verified streaming standby. Do not treat this host as a standby.'
}

Set-PgDataDirectoryAcl -Path $StandbyDataDir -Account $pgAccount

Write-Step 'Writing a protected pgpass file for restart-safe WAL streaming'
$pgPassPath = Join-Path $StandbyDataDir 'replication.pgpass'
try {
    Write-StandbyPgPass -Path $pgPassPath -Password $replicationPassword
    Set-PathAcl -Path $pgPassPath -RightsByAccount @{
        'BUILTIN\Administrators' = 'FullControl'
        'NT AUTHORITY\SYSTEM' = 'FullControl'
        $pgAccount = 'Read'
    } -NoInherit
    Update-StandbyConninfo -DataDirectory $StandbyDataDir -PassfilePath $pgPassPath
    Set-PathAcl -Path (Join-Path $StandbyDataDir 'postgresql.auto.conf') -RightsByAccount @{
        'BUILTIN\Administrators' = 'FullControl'
        'NT AUTHORITY\SYSTEM' = 'FullControl'
        $pgAccount = 'FullControl'
    } -NoInherit
    if (-not (Test-Path -LiteralPath (Join-Path $StandbyDataDir 'standby.signal'))) {
        throw 'standby.signal was not created by pg_basebackup -R.'
    }
}
catch {
    Write-Warning "The standby could not be made restart-safe: $($_.Exception.Message)"
    try {
        Invoke-PgCtl -Bin $PgBin -ArgumentList @('stop', '-D', $StandbyDataDir, '-m', 'fast', '-w') -FailureMessage 'Could not stop the unverified standby'
    }
    catch {
        Write-Warning "The unverified standby may still be running. Stop PostgreSQL manually for $StandbyDataDir before retrying."
    }
    throw
}

$streaming = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $inRecovery = Invoke-PsqlScalar -Bin $PgBin -HostName $StandbyAdminHost -Port $StandbyAdminPort -User $AdminUser -Password $adminPassword -Database $StandbyAdminDatabase -Sql 'SELECT pg_is_in_recovery()::text'
    $receiver = Invoke-PsqlScalar -Bin $PgBin -HostName $StandbyAdminHost -Port $StandbyAdminPort -User $AdminUser -Password $adminPassword -Database $StandbyAdminDatabase -Sql 'SELECT COALESCE((SELECT status FROM pg_stat_wal_receiver LIMIT 1), '''')'
    if ($inRecovery -eq 'true' -and $receiver -eq 'streaming') { $streaming = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $streaming) {
    throw 'The standby is not reporting a streaming WAL receiver. Do not treat this host as a standby.'
}

if ($RegisterPgService) {
    Write-Step "Registering standby PostgreSQL service $PgServiceName"
    Invoke-PgCtl -Bin $PgBin -ArgumentList @('stop', '-D', $StandbyDataDir, '-m', 'fast', '-w') -FailureMessage 'Could not stop the pg_ctl-managed standby before service registration'
    Set-PgDataDirectoryAcl -Path $StandbyDataDir -Account $pgAccount
    Register-StandbyService -Bin $PgBin -DataDirectory $StandbyDataDir -Name $PgServiceName -Account $pgAccount -Password $PgServiceAccountPassword
    $service = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
    if ($null -eq $service) { throw "The standby service $PgServiceName was not created." }
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
        Start-Service -Name $PgServiceName
    }
    Wait-PgReady -Bin $PgBin -HostName $StandbyAdminHost -Port $StandbyAdminPort
    $streaming = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $inRecovery = Invoke-PsqlScalar -Bin $PgBin -HostName $StandbyAdminHost -Port $StandbyAdminPort -User $AdminUser -Password $adminPassword -Database $StandbyAdminDatabase -Sql 'SELECT pg_is_in_recovery()::text'
        $receiver = Invoke-PsqlScalar -Bin $PgBin -HostName $StandbyAdminHost -Port $StandbyAdminPort -User $AdminUser -Password $adminPassword -Database $StandbyAdminDatabase -Sql 'SELECT COALESCE((SELECT status FROM pg_stat_wal_receiver LIMIT 1), '''')'
        if ($inRecovery -eq 'true' -and $receiver -eq 'streaming') { $streaming = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $streaming) {
        try { Stop-Service -Name $PgServiceName -Force } catch { }
        throw 'The registered standby service is running but not streaming. The service was stopped; correct the replication connection before starting it again.'
    }
}

Write-Host ''
Write-Host 'Standby enrollment complete.' -ForegroundColor Green
Write-Note "Standby data:       $StandbyDataDir"
Write-Note "Primary:            $PrimaryHost`:$PrimaryPort"
Write-Note "Replication user:   $ReplicationUser"
Write-Note "Standby service:    $(if ($RegisterPgService) { $PgServiceName } else { 'pg_ctl-managed (not registered; will not start automatically after reboot)' })"
Write-Note 'The standby is in recovery and is not a writable Bar authority.'
Write-Note 'No Bar application service was installed or started here, and no service.env/client configuration was modified.'
Write-Note 'Before any promotion, stage the Bar application, service.env, secrets and TLS for this host under a reviewed procedure, then run the reviewed switchover.'
