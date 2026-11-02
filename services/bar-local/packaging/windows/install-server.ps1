#Requires -Version 5.1
<#
.SYNOPSIS
End-to-end install for one Windows Bar server (PostgreSQL 17 + local Bar service).

.DESCRIPTION
Validates prerequisites, copies the built service, creates a dedicated
PostgreSQL cluster and Windows service, writes a protected service.env,
provisions the database roles and schema with scripts/provision-local.mjs,
installs the Bar Windows service and registers the encrypted backup task.

All paths are parameterised. No hosted/cloud database operation is performed.
Re-running against a populated PostgreSQL data directory requires -Upgrade.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [Parameter(Mandatory = $true)][string]$PgBin,
    [Parameter(Mandatory = $true)][string]$PgDataDir,
    [Parameter(Mandatory = $true)][int]$DbPort,
    [string]$HttpHost = '127.0.0.1',
    [Parameter(Mandatory = $true)][int]$HttpPort,
    [string]$TlsCertFile = '',
    [string]$TlsKeyFile = '',
    [string]$PgTlsCertFile = '',
    [string]$PgTlsKeyFile = '',
    [string]$BackupDir = '',
    [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
    [System.Security.SecureString]$ServiceAccountPassword,
    [string]$NodePath = '',
    [string]$ServiceRoot = '',
    [string]$DbName = 'bar_local',
    [string]$PgServiceName = 'BarLocalPostgreSQL',
    [string]$PgServiceAccount = 'NT AUTHORITY\NetworkService',
    [System.Security.SecureString]$PgServiceAccountPassword,
    [string]$BootstrapUser = 'postgres',
    [System.Security.SecureString]$BootstrapPassword,
    [string]$BootstrapPasswordFile = '',
    [string]$SetupSecretFile = '',
    [string]$BackupKeyFile = '',
    [string]$BackupTaskStateFile = '',
    [string]$ReplicationPasswordFile = '',
    [string[]]$AllowedCidrs = @('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'),
    [string]$DbListenAddresses = 'localhost',
    [string]$AllowedOrigins = '',
    [switch]$InitDb,
    [switch]$Upgrade,
    [switch]$SkipFirewall,
    [switch]$LoopbackDatabase,
    [switch]$RequirePrivateFirewall,
    [switch]$SkipBackupTask,
    [switch]$SkipServiceStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

$programDataRoot = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal'
$envFile = Join-Path $programDataRoot 'service.env'
$logDir = Join-Path $programDataRoot 'logs'
$backupTaskStateFile = Join-Path $programDataRoot 'backup-task-state.json'
$runtimeRole = 'bar_local_runtime'
$migratorRole = 'bar_local_migrator'
$replicationRole = 'bar_local_replicator'

function Assert-Node20 {
    param([string]$Path)
    $versionOutput = & $Path --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Could not run '$Path --version'." }
    $text = ($versionOutput | Out-String).Trim()
    $match = [regex]::Match($text, '^v(\d+)\.')
    if (-not $match.Success -or [int]$match.Groups[1].Value -lt 20) {
        throw "Node.js 20 LTS or newer is required; $Path reports '$text'."
    }
}

function Assert-Postgres17 {
    param([string]$Bin)
    foreach ($name in @('postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'psql.exe', 'pg_dump.exe', 'pg_isready.exe', 'pg_basebackup.exe')) {
        $file = Join-Path $Bin $name
        if (-not (Test-Path -LiteralPath $file)) {
            throw "PostgreSQL 17 binary was not found: $file. Point -PgBin at the PostgreSQL 17 bin directory."
        }
    }
    $versionOutput = & (Join-Path $Bin 'postgres.exe') '--version' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Could not run postgres.exe --version from $Bin." }
    $text = ($versionOutput | Out-String).Trim()
    if ($text -notmatch 'PostgreSQL\) 17\.') {
        throw "PostgreSQL 17 is required; $Bin reports '$text'."
    }
}

function Invoke-Robocopy {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$Extra = @()
    )
    $arguments = @($Source, $Destination, '/E', '/XJ', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $Extra
    & robocopy.exe @arguments | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "robocopy failed copying '$Source' to '$Destination' (exit code $code)."
    }
}

function Copy-ServiceTree {
    param([string]$Source, [string]$Destination)
    if (Test-PathEqual -Left $Source -Right $Destination) {
        Write-Note 'Service source and install directory are the same; skipping the copy.'
        return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Source 'dist\server.js'))) {
        throw "The built service was not found at $(Join-Path $Source 'dist\server.js'). Build services/bar-local before installing."
    }
    [void][System.IO.Directory]::CreateDirectory($Destination)
    foreach ($directory in @('dist', 'db', 'scripts', 'packaging')) {
        $from = Join-Path $Source $directory
        if (Test-Path -LiteralPath $from) {
            Invoke-Robocopy -Source $from -Destination (Join-Path $Destination $directory) -Extra @('/XD', (Join-Path $Source '.local'), (Join-Path $Source 'tests'))
        }
    }
    foreach ($file in @('package.json', 'package-lock.json')) {
        $from = Join-Path $Source $file
        if (Test-Path -LiteralPath $from) {
            Copy-Item -LiteralPath $from -Destination (Join-Path $Destination $file) -Force
        }
    }

    $nodeModules = Join-Path $Source 'node_modules'
    $destinationNodeModules = Join-Path $Destination 'node_modules'
    if (Test-Path -LiteralPath $nodeModules) {
        Invoke-Robocopy -Source $nodeModules -Destination $destinationNodeModules
    }

    $repoRoot = Split-Path -Parent (Split-Path -Parent $Source)
    $contracts = Join-Path $repoRoot 'packages\bar-contracts'
    $contractsDestination = Join-Path $destinationNodeModules '@tsa-bonno\bar-contracts'
    if (Test-Path -LiteralPath $contracts) {
        Invoke-Robocopy -Source $contracts -Destination $contractsDestination -Extra @('/XD', (Join-Path $contracts 'node_modules'), (Join-Path $contracts 'tests'))
    }
    elseif (-not (Test-Path -LiteralPath (Join-Path $contractsDestination 'package.json'))) {
        throw "The @tsa-bonno/bar-contracts dependency was not found. Build the contracts package and copy it under node_modules/@tsa-bonno/bar-contracts."
    }

    foreach ($developmentOnly in @('typescript', '@types')) {
        $remove = Join-Path $destinationNodeModules $developmentOnly
        if (Test-Path -LiteralPath $remove) {
            Remove-Item -LiteralPath $remove -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Note "Copied the built service to $Destination (development-only type packages removed)."
}

function Read-SecretFile {
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

function Get-OrCreateSecretFile {
    param([string]$Path, [int]$Bytes, [string]$Name)
    if (Test-Path -LiteralPath $Path) {
        return Read-SecretFile -Path $Path -Name $Name
    }
    $value = New-RandomHex -Bytes $Bytes
    Write-TextFileAtomic -Path $Path -Content ($value + "`n")
    return $value
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

function Assert-PgServiceAccount {
    param([string]$Name, [string]$DataDirectory, [string]$Account)
    if (-not (Test-PgServiceOwnership -Name $Name -DataDirectory $DataDirectory)) { return }
    $existingAccount = Get-WindowsServiceAccount -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($existingAccount) -and
        -not [string]::Equals((ConvertTo-NormalizedServiceAccount -Account $existingAccount), (ConvertTo-NormalizedServiceAccount -Account $Account), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PostgreSQL service $Name already runs as '$existingAccount', but -PgServiceAccount is '$Account'. Pass the existing account so its data-directory permissions are not removed."
    }
}

function Register-PostgresService {
    param(
        [string]$Bin,
        [string]$DataDirectory,
        [string]$Name,
        [string]$Account,
        [System.Security.SecureString]$Password
    )
    if (Test-PgServiceOwnership -Name $Name -DataDirectory $DataDirectory) {
        Assert-PgServiceAccount -Name $Name -DataDirectory $DataDirectory -Account $Account
        Write-Note "PostgreSQL service $Name already references this data directory."
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
    Write-Note "Registered PostgreSQL service $Name (data directory $DataDirectory)."
}

function Wait-PostgresReady {
    param([string]$Bin, [string]$HostName, [int]$Port)
    $isReady = Join-Path $Bin 'pg_isready.exe'
    $probeHost = $HostName
    if ([string]::IsNullOrWhiteSpace($probeHost) -or $probeHost -eq '*') { $probeHost = '127.0.0.1' }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & $isReady '-h' $probeHost '-p' ([string]$Port) '-q' | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL did not accept connections at $probeHost`:$Port within 30 seconds."
}

function Set-PgOwnedFileAcl {
    param([string]$Path, [string]$Account)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $rights = @{}
    $rights[$Account] = 'Read'
    $rights['BUILTIN\Administrators'] = 'FullControl'
    $rights['NT AUTHORITY\SYSTEM'] = 'FullControl'
    Set-PathAcl -Path $Path -RightsByAccount $rights -NoInherit
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

function Set-TlsDirectoryAcl {
    param([string]$Path, [string]$ServiceAccount, [string]$PgAccount)
    [void][System.IO.Directory]::CreateDirectory($Path)
    $rights = @{}
    $rights[$ServiceAccount] = 'ReadAndExecute'
    $rights[$PgAccount] = 'ReadAndExecute'
    $rights['BUILTIN\Administrators'] = 'FullControl'
    $rights['NT AUTHORITY\SYSTEM'] = 'FullControl'
    Set-PathAcl -Path $Path -RightsByAccount $rights -Container -NoInherit
}

function Invoke-Provisioning {
    param(
        [string]$Node,
        [string]$Script,
        [hashtable]$Environment
    )
    $cleared = @(
        'DATABASE_URL',
        'SUPABASE_DB_URL',
        'SUPABASE_POOLER_URL',
        'PGHOST',
        'PGPASSWORD',
        'BAR_LOCAL_TEST_DB',
        'BAR_LOCAL_BOOTSTRAP_PASSWORD',
        'BAR_LOCAL_SETUP_SECRET',
        'BAR_LOCAL_BACKUP_KEY',
        'BAR_LOCAL_REPLICATION_PASSWORD',
        'BAR_LOCAL_PROVISION_UPGRADE',
        'BAR_LOCAL_ALLOW_TEST_DB'
    )
    $saved = @{}
    foreach ($name in $cleared) {
        $saved[$name] = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        [System.Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    try {
        $result = Invoke-WithEnvironment -Environment $Environment -ScriptBlock {
            $output = & $Node $Script 2>&1
            return [pscustomobject]@{ Code = $LASTEXITCODE; Output = @($output) }
        }
    }
    finally {
        foreach ($name in $cleared) {
            [System.Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
    foreach ($line in $result.Output) {
        Write-Note ([string]$line)
    }
    if ($result.Code -ne 0) {
        throw "Database provisioning failed with exit code $($result.Code). Correct the reported issue before starting the Bar service."
    }
}

function New-ServiceEnvContent {
    param([hashtable]$Values)
    $order = @(
        'BAR_LOCAL_DB_HOST',
        'BAR_LOCAL_DB_PORT',
        'BAR_LOCAL_DB_NAME',
        'BAR_LOCAL_RUNTIME_USER',
        'BAR_LOCAL_RUNTIME_PASSWORD',
        'BAR_LOCAL_MIGRATOR_USER',
        'BAR_LOCAL_MIGRATOR_PASSWORD',
        'BAR_LOCAL_HTTP_HOST',
        'BAR_LOCAL_HTTP_PORT',
        'BAR_LOCAL_TLS_CERT_FILE',
        'BAR_LOCAL_TLS_KEY_FILE',
        'BAR_LOCAL_ALLOWED_ORIGINS',
        'BAR_LOCAL_SETUP_SECRET_FILE',
        'BAR_LOCAL_BACKUP_DIR',
        'BAR_LOCAL_BACKUP_KEY_FILE',
        'BAR_LOCAL_BACKUP_RETENTION_HOURLY',
        'BAR_LOCAL_BACKUP_RETENTION_DAILY',
        'BAR_LOCAL_BACKUP_RETENTION_WEEKLY',
        'BAR_LOCAL_PG_BIN',
        'BAR_LOCAL_PG_DATA_DIR',
        'BAR_LOCAL_NODE_PATH',
        'BAR_LOCAL_DATA_DIR',
        'BAR_LOCAL_LOG_DIR',
        'BAR_LOCAL_NETWORK_ROLE',
        'BAR_LOCAL_REPLICATION_COORDINATOR'
    )
    $builder = New-Object System.Text.StringBuilder
    foreach ($key in $order) {
        $value = ''
        if ($Values.ContainsKey($key)) { $value = [string]$Values[$key] }
        if ($value -match "`r|`n") { throw "Environment value for $key contains a newline." }
        [void]$builder.Append($key + '=' + $value + "`n")
    }
    if ($Values.ContainsKey('BAR_LOCAL_BACKUP_COPY_TO')) {
        $copyTo = [string]$Values['BAR_LOCAL_BACKUP_COPY_TO']
        if ($copyTo -match "`r|`n") { throw 'Environment value for BAR_LOCAL_BACKUP_COPY_TO contains a newline.' }
        if (-not [string]::IsNullOrWhiteSpace($copyTo)) {
            [void]$builder.Append('BAR_LOCAL_BACKUP_COPY_TO=' + $copyTo + "`n")
        }
    }
    return $builder.ToString()
}

Assert-Elevated
$InstallDir = Resolve-AbsolutePath -Path $InstallDir -Name 'InstallDir'
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
$PgBin = Resolve-AbsolutePath -Path $PgBin -Name 'PgBin'
$PgDataDir = Resolve-AbsolutePath -Path $PgDataDir -Name 'PgDataDir'
if (-not [string]::IsNullOrWhiteSpace($BackupTaskStateFile)) {
    $backupTaskStateFile = Resolve-AbsolutePath -Path $BackupTaskStateFile -Name 'BackupTaskStateFile'
}

$existingEnvironment = @{}
if (Test-Path -LiteralPath $envFile) {
    $existingEnvironment = Read-EnvFile -Path $envFile
}

$backupDirWasSupplied = $PSBoundParameters.ContainsKey('BackupDir') -and -not [string]::IsNullOrWhiteSpace($BackupDir)
if (-not $backupDirWasSupplied) {
    $existingBackup = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_BACKUP_DIR'
    if (-not [string]::IsNullOrWhiteSpace($existingBackup)) {
        $BackupDir = $existingBackup
    }
    else {
        $BackupDir = Join-Path $DataDir 'backups'
    }
}
$BackupDir = Resolve-AbsolutePath -Path $BackupDir -Name 'BackupDir'
$backupCopyToDir = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_BACKUP_COPY_TO'
if (-not [string]::IsNullOrWhiteSpace($backupCopyToDir)) {
    $backupCopyToDir = Resolve-AbsolutePath -Path $backupCopyToDir -Name 'BackupCopyToDir'
    Assert-DedicatedDirectory -Path $backupCopyToDir -Name 'BackupCopyToDir'
    foreach ($protectedPath in @(
        @{ Name = 'BackupDir'; Path = $BackupDir },
        @{ Name = 'PgDataDir'; Path = $PgDataDir },
        @{ Name = 'DataDir'; Path = $DataDir },
        @{ Name = 'InstallDir'; Path = $InstallDir }
    )) {
        Assert-DistinctPaths -FirstName $protectedPath.Name -FirstPath $protectedPath.Path -SecondName 'BackupCopyToDir' -SecondPath $backupCopyToDir
        if ((Test-PathWithin -Child $backupCopyToDir -Parent $protectedPath.Path) -or
            (Test-PathWithin -Child $protectedPath.Path -Parent $backupCopyToDir)) {
            throw "BackupCopyToDir must not overlap $($protectedPath.Name); choose a separate dedicated destination."
        }
    }
}
Assert-DedicatedDirectory -Path $InstallDir -Name 'InstallDir'
Assert-DedicatedDirectory -Path $DataDir -Name 'DataDir'
Assert-DedicatedDirectory -Path $PgDataDir -Name 'PgDataDir'
Assert-DedicatedDirectory -Path $BackupDir -Name 'BackupDir'
Assert-DedicatedDirectory -Path $logDir -Name 'LogDir'
if ([string]::IsNullOrWhiteSpace($BootstrapPasswordFile)) { $BootstrapPasswordFile = Join-Path $DataDir 'secrets\postgres-bootstrap.txt' }
if ([string]::IsNullOrWhiteSpace($SetupSecretFile)) { $SetupSecretFile = Join-Path $DataDir 'setup-secret.txt' }
if ([string]::IsNullOrWhiteSpace($BackupKeyFile)) { $BackupKeyFile = Join-Path $DataDir 'secrets\backup.key' }
if ([string]::IsNullOrWhiteSpace($ReplicationPasswordFile)) { $ReplicationPasswordFile = Join-Path $DataDir 'secrets\replication-password.txt' }
$BootstrapPasswordFile = Resolve-AbsolutePath -Path $BootstrapPasswordFile -Name 'BootstrapPasswordFile'
$SetupSecretFile = Resolve-AbsolutePath -Path $SetupSecretFile -Name 'SetupSecretFile'
$BackupKeyFile = Resolve-AbsolutePath -Path $BackupKeyFile -Name 'BackupKeyFile'
$ReplicationPasswordFile = Resolve-AbsolutePath -Path $ReplicationPasswordFile -Name 'ReplicationPasswordFile'

if ($HttpPort -lt 1 -or $HttpPort -gt 65535) { throw 'HttpPort must be between 1 and 65535.' }
if ($DbPort -lt 1024 -or $DbPort -gt 65535) { throw 'DbPort must be between 1024 and 65535.' }
if ([string]::IsNullOrWhiteSpace($ServiceAccount)) { throw 'ServiceAccount must not be empty.' }
if ([string]::IsNullOrWhiteSpace($PgServiceAccount)) { throw 'PgServiceAccount must not be empty.' }
if ($DbPort -eq 5432) { throw 'DbPort must not be the default PostgreSQL port 5432. Use a dedicated Bar instance port.' }
if ($DbName -notmatch '^bar_local(?:_|$)') { throw "DbName must begin with bar_local; received '$DbName'." }
if ($DbName -match '^bar_local_test(?:_|$)') { throw 'DbName must not be a bar_local_test database.' }
if ($BootstrapUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'BootstrapUser must be a valid unquoted PostgreSQL identifier.' }
if ([string]::IsNullOrWhiteSpace($HttpHost)) { throw 'HttpHost must not be empty.' }
$HttpHost = $HttpHost.Trim()
if ($HttpHost -match '[\x00-\x1F]') { throw 'HttpHost must not contain control characters.' }
if ($AllowedOrigins -match "`r|`n") { throw 'AllowedOrigins must be a single line.' }
if ([string]::IsNullOrWhiteSpace($DbListenAddresses)) { throw 'DbListenAddresses must not be empty and must include localhost.' }
if ($DbListenAddresses -notmatch '(^|,)\s*(localhost|127\.0\.0\.1|\*)\s*(,|$)') {
    throw 'DbListenAddresses must include localhost (or *) because the Bar service connects over loopback.'
}

Assert-DistinctPaths -FirstName 'InstallDir' -FirstPath $InstallDir -SecondName 'PgDataDir' -SecondPath $PgDataDir
Assert-DistinctPaths -FirstName 'DataDir' -FirstPath $DataDir -SecondName 'PgDataDir' -SecondPath $PgDataDir
Assert-DistinctPaths -FirstName 'InstallDir' -FirstPath $InstallDir -SecondName 'DataDir' -SecondPath $DataDir
Assert-DistinctPaths -FirstName 'BackupDir' -FirstPath $BackupDir -SecondName 'PgDataDir' -SecondPath $PgDataDir
Assert-DistinctPaths -FirstName 'BackupDir' -FirstPath $BackupDir -SecondName 'InstallDir' -SecondPath $InstallDir
Assert-DistinctPaths -FirstName 'BackupDir' -FirstPath $BackupDir -SecondName 'DataDir' -SecondPath $DataDir
if (Test-PathWithin -Child $DataDir -Parent $BackupDir) {
    throw 'DataDir must not be nested under BackupDir; backup retention must never be able to reach service data.'
}
if (Test-PathWithin -Child $DataDir -Parent $PgDataDir) {
    throw 'DataDir must not be nested under PgDataDir; service secrets and backups must stay outside the PostgreSQL cluster.'
}
if (Test-PathWithin -Child $PgDataDir -Parent $BackupDir) {
    throw 'PgDataDir must not be nested under BackupDir; backup retention must never be able to reach the PostgreSQL cluster.'
}
if (Test-PathWithin -Child $BackupDir -Parent $PgDataDir) {
    throw 'BackupDir must not be nested under PgDataDir; PostgreSQL must never treat backup files as part of its cluster.'
}
if (Test-PathWithin -Child $InstallDir -Parent $BackupDir) {
    throw 'InstallDir must not be nested under BackupDir; backup retention must never be able to reach service binaries.'
}
if (Test-PathWithin -Child $BackupDir -Parent $InstallDir) {
    throw 'BackupDir must not be nested under InstallDir; uninstall must never remove backup files with the binaries.'
}
if (Test-PathWithin -Child $InstallDir -Parent $PgDataDir) {
    throw 'InstallDir must not be nested under PgDataDir; service binaries must stay outside the PostgreSQL cluster.'
}
if (Test-PathWithin -Child $PgDataDir -Parent $InstallDir) {
    throw 'PgDataDir must not be nested under InstallDir; the service update copy must never overwrite the PostgreSQL cluster.'
}
if (Test-PathWithin -Child $InstallDir -Parent $DataDir) {
    throw 'InstallDir must not be nested under DataDir; service binaries must stay separate from protected service data.'
}
if (Test-PathWithin -Child $DataDir -Parent $InstallDir) {
    throw 'DataDir must not be nested under InstallDir; service data must survive binary replacement.'
}

if ($LoopbackDatabase) { $AllowedCidrs = @(); $DbListenAddresses = 'localhost' }
$tlsFilesSupplied = -not [string]::IsNullOrWhiteSpace($TlsCertFile) -or -not [string]::IsNullOrWhiteSpace($TlsKeyFile)
if (-not $tlsFilesSupplied) {
    $existingCert = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_TLS_CERT_FILE'
    $existingKey = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_TLS_KEY_FILE'
    if (-not [string]::IsNullOrWhiteSpace($existingCert) -and -not [string]::IsNullOrWhiteSpace($existingKey) -and
        (Test-Path -LiteralPath $existingCert) -and (Test-Path -LiteralPath $existingKey)) {
        $TlsCertFile = $existingCert
        $TlsKeyFile = $existingKey
        $tlsFilesSupplied = $true
    }
}
$httpIsLoopback = Test-LoopbackHost -HostName $HttpHost
if ($RequirePrivateFirewall -and -not $httpIsLoopback -and ($SkipFirewall -or $null -eq (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue))) {
    throw 'Secure automatic LAN setup requires Windows NetSecurity firewall controls. Restore that Windows component and retry; a public or unscoped firewall rule is not supported.'
}
$hasTls = $tlsFilesSupplied
if (-not $httpIsLoopback -and -not $hasTls) {
    throw 'A non-loopback HTTP bind requires -TlsCertFile and -TlsKeyFile.'
}
if ($hasTls) {
    if ([string]::IsNullOrWhiteSpace($TlsCertFile) -or [string]::IsNullOrWhiteSpace($TlsKeyFile)) {
        throw 'TlsCertFile and TlsKeyFile must be supplied together.'
    }
    $TlsCertFile = Resolve-AbsolutePath -Path $TlsCertFile -Name 'TlsCertFile'
    $TlsKeyFile = Resolve-AbsolutePath -Path $TlsKeyFile -Name 'TlsKeyFile'
    if (-not (Test-Path -LiteralPath $TlsCertFile)) { throw "TLS certificate was not found: $TlsCertFile" }
    if (-not (Test-Path -LiteralPath $TlsKeyFile)) { throw "TLS private key was not found: $TlsKeyFile" }
}

$pgTlsRequested = -not [string]::IsNullOrWhiteSpace($PgTlsCertFile) -or -not [string]::IsNullOrWhiteSpace($PgTlsKeyFile)
if (-not $pgTlsRequested) {
    $existingPgCert = Join-Path $DataDir 'tls\postgres.crt'
    $existingPgKey = Join-Path $DataDir 'tls\postgres.key'
    if ((Test-Path -LiteralPath $existingPgCert) -and (Test-Path -LiteralPath $existingPgKey)) {
        $PgTlsCertFile = $existingPgCert
        $PgTlsKeyFile = $existingPgKey
        $pgTlsRequested = $true
    }
    elseif ($hasTls -and $AllowedCidrs.Count -gt 0) {
        $PgTlsCertFile = $TlsCertFile
        $PgTlsKeyFile = $TlsKeyFile
        $pgTlsRequested = $true
    }
}
if ($pgTlsRequested) {
    if ([string]::IsNullOrWhiteSpace($PgTlsCertFile) -or [string]::IsNullOrWhiteSpace($PgTlsKeyFile)) {
        throw 'PgTlsCertFile and PgTlsKeyFile must be supplied together.'
    }
    $PgTlsCertFile = Resolve-AbsolutePath -Path $PgTlsCertFile -Name 'PgTlsCertFile'
    $PgTlsKeyFile = Resolve-AbsolutePath -Path $PgTlsKeyFile -Name 'PgTlsKeyFile'
    if (-not (Test-Path -LiteralPath $PgTlsCertFile)) { throw "PostgreSQL TLS certificate was not found: $PgTlsCertFile" }
    if (-not (Test-Path -LiteralPath $PgTlsKeyFile)) { throw "PostgreSQL TLS private key was not found: $PgTlsKeyFile" }
}
if ($null -eq $AllowedCidrs) { $AllowedCidrs = @() }
if (-not $pgTlsRequested -and $AllowedCidrs.Count -gt 0) {
    Write-Warning 'No PostgreSQL TLS certificate is available; private-LAN PostgreSQL access will not be enabled. Pass -PgTlsCertFile/-PgTlsKeyFile (or HTTP TLS files) to allow it.'
    $AllowedCidrs = @()
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { throw 'node.exe was not found on PATH. Install Node.js 20 LTS or newer and pass -NodePath.' }
    $NodePath = $nodeCommand.Source
}
if (Test-Path -LiteralPath $NodePath -PathType Container) { $NodePath = Join-Path $NodePath 'node.exe' }
$NodePath = Resolve-AbsolutePath -Path $NodePath -Name 'NodePath'
if (-not (Test-Path -LiteralPath $NodePath)) { throw "node.exe was not found at $NodePath." }
Assert-Node20 -Path $NodePath
Assert-Postgres17 -Bin $PgBin

if ([string]::IsNullOrWhiteSpace($ServiceRoot)) {
    $ServiceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
}
$ServiceRoot = Resolve-AbsolutePath -Path $ServiceRoot -Name 'ServiceRoot'
if (-not (Test-Path -LiteralPath (Join-Path $ServiceRoot 'dist\server.js')) -and
    -not (Test-Path -LiteralPath (Join-Path $InstallDir 'dist\server.js'))) {
    throw "No built service was found. Supply -ServiceRoot pointing at a built services/bar-local tree, or pre-copy dist to $InstallDir."
}

# The owner setup wrapper measures the exact verified payload before it copies
# Node/PostgreSQL/service files and reserves 1 GiB for initial database/schema
# setup. Recheck that working reserve on each destination volume here; do not
# impose repeated arbitrary multi-GiB thresholds on one shared volume.
Assert-FreeSpace -Path $InstallDir -MinimumGB 1 -Name 'InstallDir working reserve'
Assert-FreeSpace -Path $DataDir -MinimumGB 1 -Name 'DataDir working reserve'
Assert-FreeSpace -Path $PgDataDir -MinimumGB 1 -Name 'PgDataDir working reserve'
Assert-FreeSpace -Path $BackupDir -MinimumGB 1 -Name 'BackupDir initial snapshot reserve'

$pgInitialized = Test-Path -LiteralPath (Join-Path $PgDataDir 'PG_VERSION')
if ($pgInitialized -and -not $Upgrade) {
    throw "The PostgreSQL data directory is already populated: $PgDataDir. Re-run with -Upgrade only after reviewing the upgrade and taking a verified backup."
}
if (-not $pgInitialized) {
    if (-not $InitDb) {
        throw "PostgreSQL is not initialised at $PgDataDir. Pass -InitDb for a fresh cluster, or supply an existing empty data directory with -InitDb."
    }
    if (Test-Path -LiteralPath $PgDataDir) {
        $existing = Get-ChildItem -LiteralPath $PgDataDir -Force -ErrorAction SilentlyContinue
        if ($null -ne $existing -and @($existing).Count -gt 0) {
            throw "Refusing to initialise over a non-empty directory: $PgDataDir. The directory must be empty or absent."
        }
    }
}
if ($Upgrade -and -not $pgInitialized) {
    throw "-Upgrade was supplied but no PostgreSQL cluster exists at $PgDataDir."
}

if ([string]::IsNullOrWhiteSpace($AllowedOrigins)) {
    $AllowedOrigins = [string](Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_ALLOWED_ORIGINS' -Default '')
}

$migratorPassword = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_MIGRATOR_PASSWORD'
if ([string]::IsNullOrWhiteSpace($migratorPassword)) { $migratorPassword = New-RandomHex -Bytes 32 }
$runtimePassword = Get-EnvValue -Values $existingEnvironment -Name 'BAR_LOCAL_RUNTIME_PASSWORD'
if ([string]::IsNullOrWhiteSpace($runtimePassword)) { $runtimePassword = New-RandomHex -Bytes 32 }

Assert-AccountExists -Account $ServiceAccount -Name 'ServiceAccount'
Assert-AccountExists -Account $PgServiceAccount -Name 'PgServiceAccount'
Assert-PgServiceAccount -Name $PgServiceName -DataDirectory $PgDataDir -Account $PgServiceAccount

[void][System.IO.Directory]::CreateDirectory($DataDir)
[void][System.IO.Directory]::CreateDirectory((Join-Path $DataDir 'secrets'))
[void][System.IO.Directory]::CreateDirectory((Join-Path $DataDir 'tls'))
[void][System.IO.Directory]::CreateDirectory($logDir)
[void][System.IO.Directory]::CreateDirectory($BackupDir)
[void][System.IO.Directory]::CreateDirectory($PgDataDir)

$stoppedExistingBarService = $false
$existingBarService = Get-Service -Name 'BarLocalService' -ErrorAction SilentlyContinue
if ($null -ne $existingBarService -and $existingBarService.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped -and -not $Upgrade) {
    throw "Bar service 'BarLocalService' is running. Use -Upgrade or stop it before installing."
}

Write-Step 'Preparing protected service secrets'
$setupSecret = Get-OrCreateSecretFile -Path $SetupSecretFile -Bytes 32 -Name 'setup secret'
$backupKey = Get-OrCreateSecretFile -Path $BackupKeyFile -Bytes 32 -Name 'backup encryption key'
$replicationPassword = Get-OrCreateSecretFile -Path $ReplicationPasswordFile -Bytes 32 -Name 'replication password'
$walArchiveDir = Join-Path $BackupDir 'wal-archive'
$walKeyFile = Join-Path $DataDir 'secrets\wal.key'
$walKey = Get-OrCreateSecretFile -Path $walKeyFile -Bytes 32 -Name 'WAL recovery encryption key'
Set-SecretFileAcl -Path $SetupSecretFile -ServiceAccount $ServiceAccount
Set-SecretFileAcl -Path $BackupKeyFile -ServiceAccount $ServiceAccount
Set-SecretFileAcl -Path $ReplicationPasswordFile -ServiceAccount $ServiceAccount
Set-SecretFileAcl -Path $walKeyFile -ServiceAccount $ServiceAccount -AdditionalAccount @($PgServiceAccount)
Set-ServiceDirectoryAcl -Path (Join-Path $DataDir 'secrets') -ServiceAccount $ServiceAccount -NoInherit -AdditionalAccount @($PgServiceAccount)
Set-ServiceDirectoryAcl -Path $BackupDir -ServiceAccount $ServiceAccount -Modify -NoInherit -AdditionalAccount @($PgServiceAccount)
Set-ServiceDirectoryAcl -Path $walArchiveDir -ServiceAccount $ServiceAccount -Modify -NoInherit -AdditionalAccount @($PgServiceAccount) -AdditionalRights 'Modify'

$bootstrapPlain = $null
if ($null -ne $BootstrapPassword) {
    $bootstrapPlain = ConvertTo-PlainText -SecureString $BootstrapPassword
    if (Test-Path -LiteralPath $BootstrapPasswordFile) {
        $existingBootstrap = Read-SecretFile -Path $BootstrapPasswordFile -Name 'bootstrap password file'
        if ($existingBootstrap -ne $bootstrapPlain) {
            throw "A bootstrap password file already exists at $BootstrapPasswordFile with different content. Refusing to change the PostgreSQL superuser password implicitly."
        }
    }
    else {
        Write-TextFileAtomic -Path $BootstrapPasswordFile -Content ($bootstrapPlain + "`n")
    }
}
elseif (Test-Path -LiteralPath $BootstrapPasswordFile) {
    $bootstrapPlain = Read-SecretFile -Path $BootstrapPasswordFile -Name 'bootstrap password file'
}
elseif ($InitDb -and -not $pgInitialized) {
    $bootstrapPlain = New-RandomHex -Bytes 32
    Write-TextFileAtomic -Path $BootstrapPasswordFile -Content ($bootstrapPlain + "`n")
}
else {
    throw "A PostgreSQL bootstrap password is required for this install. Supply -BootstrapPassword or an existing -BootstrapPasswordFile."
}
Set-AdminOnlyFileAcl -Path $BootstrapPasswordFile

$serviceCert = $null
$serviceKey = $null
$pgCert = $null
$pgKey = $null
$tlsDirectory = Join-Path $DataDir 'tls'
if ($hasTls -or $pgTlsRequested) {
    Set-TlsDirectoryAcl -Path $tlsDirectory -ServiceAccount $ServiceAccount -PgAccount $PgServiceAccount
}
if ($hasTls) {
    $serviceCert = Join-Path $tlsDirectory 'service.crt'
    $serviceKey = Join-Path $tlsDirectory 'service.key'
    if (-not (Test-PathEqual -Left $TlsCertFile -Right $serviceCert)) {
        Copy-Item -LiteralPath $TlsCertFile -Destination $serviceCert -Force
    }
    if (-not (Test-PathEqual -Left $TlsKeyFile -Right $serviceKey)) {
        Copy-Item -LiteralPath $TlsKeyFile -Destination $serviceKey -Force
    }
    Set-SecretFileAcl -Path $serviceCert -ServiceAccount $ServiceAccount
    Set-SecretFileAcl -Path $serviceKey -ServiceAccount $ServiceAccount
}
if ($pgTlsRequested) {
    $pgCert = Join-Path $tlsDirectory 'postgres.crt'
    $pgKey = Join-Path $tlsDirectory 'postgres.key'
    if (-not (Test-PathEqual -Left $PgTlsCertFile -Right $pgCert)) {
        Copy-Item -LiteralPath $PgTlsCertFile -Destination $pgCert -Force
    }
    if (-not (Test-PathEqual -Left $PgTlsKeyFile -Right $pgKey)) {
        Copy-Item -LiteralPath $PgTlsKeyFile -Destination $pgKey -Force
    }
    Set-PgOwnedFileAcl -Path $pgCert -Account $PgServiceAccount
    Set-PgOwnedFileAcl -Path $pgKey -Account $PgServiceAccount
}

try {
    Write-Step 'Copying the built service'
    if ($null -ne $existingBarService -and $existingBarService.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        Write-Step 'Stopping the existing Bar service before the upgrade copy'
        Stop-Service -Name 'BarLocalService' -Force
        $existingBarService.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
        $stoppedExistingBarService = $true
        Write-Note 'Existing Bar service stopped for the upgrade.'
    }
    Copy-ServiceTree -Source $ServiceRoot -Destination $InstallDir
    # PostgreSQL's archiver executes the protected Node/CLI payload. It receives
    # read/execute access only; it must not be able to replace service binaries.
    Set-ServiceDirectoryAcl -Path $InstallDir -ServiceAccount $ServiceAccount -NoInherit -AdditionalAccount @($PgServiceAccount)
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'scripts\provision-local.mjs'))) {
        throw "scripts/provision-local.mjs was not copied to $InstallDir. Check -ServiceRoot."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'scripts\bar-operations.mjs'))) {
        throw "scripts/bar-operations.mjs was not copied to $InstallDir. Check -ServiceRoot."
    }
}
catch {
    if ($stoppedExistingBarService) {
        Write-Warning 'The pre-existing Bar service was stopped for the upgrade and remains stopped. Restore its files before restarting it.'
    }
    throw
}

$pgServiceCreated = $false
$firstListenAddress = ($DbListenAddresses -split ',')[0].Trim()
$pgReadyHost = '127.0.0.1'
if ($firstListenAddress -ne '*' -and $firstListenAddress -ne '0.0.0.0' -and $firstListenAddress -ne '::' -and $DbListenAddresses -notmatch 'localhost|127\.0\.0\.1') {
    $pgReadyHost = $firstListenAddress
}

try {
    if (-not $pgInitialized) {
        Write-Step "Initialising PostgreSQL 17 at $PgDataDir"
        Set-PgDataDirectoryAcl -Path $PgDataDir -Account $PgServiceAccount
        $initPasswordFile = Join-Path $DataDir 'secrets\initdb-password.tmp'
        Write-TextFileAtomic -Path $initPasswordFile -Content ($bootstrapPlain + "`n")
        Set-AdminOnlyFileAcl -Path $initPasswordFile
        try {
            $initdbArgs = @(
                '-D', $PgDataDir,
                '-U', $BootstrapUser,
                ('--pwfile=' + $initPasswordFile),
                '--auth-host=scram-sha-256',
                '--auth-local=scram-sha-256',
                '--encoding=UTF8',
                '--locale=C',
                '--data-checksums'
            )
            & (Join-Path $PgBin 'initdb.exe') @initdbArgs | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE." }
        }
        finally {
            if (Test-Path -LiteralPath $initPasswordFile) { Remove-Item -LiteralPath $initPasswordFile -Force }
        }
        Write-Note 'PostgreSQL cluster initialised with UTF8 encoding and data checksums.'
    }

    Set-PgDataDirectoryAcl -Path $PgDataDir -Account $PgServiceAccount

    Write-Step "Registering PostgreSQL service $PgServiceName"
    $pgServiceExisted = $null -ne (Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue)
    Register-PostgresService -Bin $PgBin -DataDirectory $PgDataDir -Name $PgServiceName -Account $PgServiceAccount -Password $PgServiceAccountPassword
    if (-not $pgServiceExisted) { $pgServiceCreated = $true }

    Write-Step 'Writing strict PostgreSQL configuration'
    $configureArguments = @{
        PgBin = $PgBin
        PgDataDir = $PgDataDir
        DbPort = $DbPort
        ListenAddresses = $DbListenAddresses
        AllowedCidrs = $AllowedCidrs
        PgServiceName = $PgServiceName
        ReplicationUser = $replicationRole
        WalArchiveDir = $walArchiveDir
        WalKeyFile = $walKeyFile
        WalNodePath = $NodePath
        WalScriptPath = (Join-Path $InstallDir 'scripts\wal-archive.mjs')
    }
    if ($pgTlsRequested) {
        $configureArguments['TlsCertFile'] = $pgCert
        $configureArguments['TlsKeyFile'] = $pgKey
    }
    & (Join-Path $PSScriptRoot 'configure-postgres.ps1') @configureArguments

    $pgService = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
    if ($null -ne $pgService -and $pgService.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
        Start-Service -Name $PgServiceName
    }
    Wait-PostgresReady -Bin $PgBin -HostName $pgReadyHost -Port $DbPort
    Write-Note "PostgreSQL is accepting connections on $pgReadyHost`:$DbPort."

    Write-Step 'Provisioning the production local Bar database'
    $provisionEnvironment = @{
        BAR_LOCAL_PROVISION = '1'
        BAR_LOCAL_DB_HOST = '127.0.0.1'
        BAR_LOCAL_DB_PORT = [string]$DbPort
        BAR_LOCAL_DB_NAME = $DbName
        BAR_LOCAL_MIGRATOR_USER = $migratorRole
        BAR_LOCAL_MIGRATOR_PASSWORD = $migratorPassword
        BAR_LOCAL_RUNTIME_USER = $runtimeRole
        BAR_LOCAL_RUNTIME_PASSWORD = $runtimePassword
        BAR_LOCAL_REPLICATION_USER = $replicationRole
        BAR_LOCAL_REPLICATION_PASSWORD = $replicationPassword
        BAR_LOCAL_PG_DATA_DIR = $PgDataDir
        BAR_LOCAL_SETUP_SECRET_FILE = $SetupSecretFile
        BAR_LOCAL_BOOTSTRAP_USER = $BootstrapUser
        BAR_LOCAL_BOOTSTRAP_PASSWORD_FILE = $BootstrapPasswordFile
    }
    if ($Upgrade) { $provisionEnvironment['BAR_LOCAL_PROVISION_UPGRADE'] = '1' }
    Invoke-Provisioning -Node $NodePath -Script (Join-Path $InstallDir 'scripts\provision-local.mjs') -Environment $provisionEnvironment

    Write-Step 'Writing protected service.env'
    $envValues = @{
        BAR_LOCAL_DB_HOST = '127.0.0.1'
        BAR_LOCAL_DB_PORT = [string]$DbPort
        BAR_LOCAL_DB_NAME = $DbName
        # The service needs a loopback-only administrative connection for
        # authenticated backups, isolated restore drills and update checkpoint
        # creation. service.env is ACL-protected to administrators and the Bar
        # service account; this URL is never written to the installer log.
        BAR_LOCAL_ADMIN_DATABASE_URL = ('postgresql://' + [uri]::EscapeDataString($BootstrapUser) + ':' + [uri]::EscapeDataString($bootstrapPlain) + '@127.0.0.1:' + [string]$DbPort + '/' + [uri]::EscapeDataString($DbName))
        BAR_LOCAL_RUNTIME_USER = $runtimeRole
        BAR_LOCAL_RUNTIME_PASSWORD = $runtimePassword
        BAR_LOCAL_MIGRATOR_USER = $migratorRole
        BAR_LOCAL_MIGRATOR_PASSWORD = $migratorPassword
        BAR_LOCAL_HTTP_HOST = $HttpHost
        BAR_LOCAL_HTTP_PORT = [string]$HttpPort
        BAR_LOCAL_TLS_CERT_FILE = if ($hasTls) { $serviceCert } else { '' }
        BAR_LOCAL_TLS_KEY_FILE = if ($hasTls) { $serviceKey } else { '' }
        BAR_LOCAL_ALLOWED_ORIGINS = $AllowedOrigins
        BAR_LOCAL_SETUP_SECRET_FILE = $SetupSecretFile
        BAR_LOCAL_BACKUP_DIR = $BackupDir
        BAR_LOCAL_BACKUP_KEY_FILE = $BackupKeyFile
        BAR_LOCAL_PHYSICAL_RECOVERY_ENABLED = '1'
        BAR_LOCAL_WAL_ARCHIVE_DIR = $walArchiveDir
        BAR_LOCAL_WAL_KEY_FILE = $walKeyFile
        BAR_LOCAL_RECOVERY_REPLICATION_USER = $replicationRole
        BAR_LOCAL_RECOVERY_REPLICATION_PASSWORD_FILE = $ReplicationPasswordFile
        BAR_LOCAL_BACKUP_TASK_STATE_FILE = $backupTaskStateFile
        BAR_LOCAL_RESTORE_DRILL_DIR = (Join-Path $DataDir 'restore-drills')
        BAR_LOCAL_BACKUP_RETENTION_HOURLY = '24'
        BAR_LOCAL_BACKUP_RETENTION_DAILY = '7'
        BAR_LOCAL_BACKUP_RETENTION_WEEKLY = '4'
        BAR_LOCAL_PG_BIN = $PgBin
        BAR_LOCAL_PG_DATA_DIR = $PgDataDir
        BAR_LOCAL_NODE_PATH = $NodePath
        BAR_LOCAL_DATA_DIR = $DataDir
        BAR_LOCAL_LOG_DIR = $logDir
        BAR_LOCAL_NETWORK_ROLE = 'single_host'
        BAR_LOCAL_REPLICATION_COORDINATOR = 'manual'
    }
    if (-not [string]::IsNullOrWhiteSpace($backupCopyToDir)) { $envValues['BAR_LOCAL_BACKUP_COPY_TO'] = $backupCopyToDir }
    Assert-FreeSpace -Path $BackupDir -MinimumGB 1 -Name 'BackupDir initial snapshot reserve'
    Write-TextFileAtomic -Path $envFile -Content (New-ServiceEnvContent -Values $envValues)
    Set-SecretFileAcl -Path $envFile -ServiceAccount $ServiceAccount

    Write-Step 'Installing the Bar Windows service'
    $installServiceArguments = @{
        ServiceName = 'BarLocalService'
        InstallDir = $InstallDir
        DataDir = $DataDir
        EnvFile = $envFile
        LogDir = $logDir
        NodePath = $NodePath
        ServiceAccount = $ServiceAccount
        PgServiceAccount = $PgServiceAccount
    }
    if ($null -ne $ServiceAccountPassword) { $installServiceArguments['ServiceAccountPassword'] = $ServiceAccountPassword }
    $installServiceArguments['NoStart'] = [bool]$SkipServiceStart
    & (Join-Path $PSScriptRoot 'install-service.ps1') @installServiceArguments

    if (-not $SkipFirewall) {
        Write-Step 'Configuring the HTTP firewall rule'
        if ($httpIsLoopback) {
            Write-Note 'HTTP binds loopback only; no inbound firewall rule is required.'
        }
        else {
            if ($null -eq (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) {
                Write-Warning 'New-NetFirewallRule is unavailable. Add a scoped inbound rule for the Bar HTTP port manually.'
            }
            else {
                $ruleName = 'Tsa Bonno BarLocal HTTP ' + [string]$HttpPort
                $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
                if ($null -eq $existingRule) {
                    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $HttpPort -Program $NodePath -Action Allow -Profile Private -RemoteAddress LocalSubnet -Description 'Tsa Bonno local Bar API (private profile, local subnet only).' | Out-Null
                }
                else {
                    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private -Action Allow -RemoteAddress LocalSubnet -ErrorAction Stop
                    Get-NetFirewallRule -DisplayName $ruleName | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $HttpPort -ErrorAction Stop
                    Get-NetFirewallRule -DisplayName $ruleName | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $NodePath -ErrorAction Stop
                }
                Write-Note "Firewall rule '$ruleName' allows TCP $HttpPort on the Private profile from LocalSubnet only."
            }
        }
    }
    else {
        Write-Note 'Firewall configuration skipped (-SkipFirewall).'
    }

    if (-not $SkipBackupTask) {
        Write-Step 'Registering the encrypted backup task'
        $backupArguments = @{
            InstallDir = $InstallDir
            DataDir = $DataDir
            EnvFile = $envFile
            LogDir = $logDir
            StateFile = $backupTaskStateFile
            ServiceAccount = $ServiceAccount
            RetentionHourly = 24
            RetentionDaily = 7
            RetentionWeekly = 4
            HourlyEveryHours = 1
        }
        if ($null -ne $ServiceAccountPassword) { $backupArguments['ServiceAccountPassword'] = $ServiceAccountPassword }
        & (Join-Path $PSScriptRoot 'install-backup-task.ps1') @backupArguments
    }
    else {
        Write-Note 'Backup task registration skipped (-SkipBackupTask).'
    }
}
catch {
    $failure = $_.Exception.Message
    Write-Warning "Installation failed: $failure"
    $service = Get-Service -Name 'BarLocalService' -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
        try { Stop-Service -Name 'BarLocalService' -Force } catch { }
    }
    if ($null -ne $service) {
        Write-Warning 'The Bar service remains registered but stopped so its logs can be inspected.'
    }
    elseif ($stoppedExistingBarService) {
        Write-Warning 'The pre-existing Bar service was stopped for the upgrade and remains stopped. Restore its files before restarting it.'
    }
    if ($pgServiceCreated -or $null -ne (Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue)) {
        Write-Warning "The PostgreSQL service $PgServiceName remains registered. Its data directory was not deleted."
    }
    Write-Warning "Rollback did not delete the PostgreSQL data directory $PgDataDir. Review logs under $logDir before retrying."
    throw
}
finally {
    $bootstrapPlain = $null
    $migratorPassword = $null
    $runtimePassword = $null
    $replicationPassword = $null
    $backupKey = $null
    $setupSecret = $null
}

Write-Host ''
Write-Host 'Local Bar server installation complete.' -ForegroundColor Green
Write-Note "InstallDir:          $InstallDir"
Write-Note "DataDir:             $DataDir"
Write-Note "PostgreSQL data:     $PgDataDir"
Write-Note "PostgreSQL service:  $PgServiceName (port $DbPort)"
Write-Note "Bar service:         BarLocalService"
Write-Note "HTTP bind:           $HttpHost`:$HttpPort (TLS: $hasTls)"
Write-Note "Env file:            $envFile"
Write-Note "Setup secret file:   $SetupSecretFile (the secret itself was not printed)"
Write-Note "Backup destination:  $BackupDir"
Write-Note "Backup key file:     $BackupKeyFile (the key itself was not printed)"
Write-Note "Logs:                $logDir"
Write-Note 'PowerShell rollback restored PostgreSQL configuration files if a configuration step failed.'
Write-Note 'Physical Windows service, PostgreSQL, TLS, firewall, backup and replication behaviour is NOT qualified by this install.'
