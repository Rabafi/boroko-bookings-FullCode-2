#Requires -Version 5.1
<#
.SYNOPSIS
Writes a validated, idempotent Bar-local PostgreSQL configuration.

.DESCRIPTION
Backs up postgresql.conf and pg_hba.conf, replaces only the Tsa Bonno managed
blocks, rejects trust authentication outside the managed block, validates the
result, applies reload/restart, and rolls back both files if validation or the
apply fails.

The script configures durability and physical replication but does not create
replication slots or promote standbys.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PgBin,
    [Parameter(Mandatory = $true)][string]$PgDataDir,
    [Parameter(Mandatory = $true)][int]$DbPort,
    [string]$ListenAddresses = 'localhost',
    [string[]]$AllowedCidrs = @('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'),
    [string]$TlsCertFile = '',
    [string]$TlsKeyFile = '',
    [string]$PgServiceName = 'BarLocalPostgreSQL',
    [string]$ReplicationUser = 'bar_local_replicator',
    [string]$WalArchiveDir = '',
    [string]$WalKeyFile = '',
    [string]$WalNodePath = '',
    [string]$WalScriptPath = '',
    [switch]$ReloadOnly,
    [switch]$NoApply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

$StartMarker = '# >>> Tsa Bonno BarLocal managed settings >>>'
$EndMarker = '# <<< Tsa Bonno BarLocal managed settings <<<'

function Get-ManagedBlockPattern {
    return '(?s)' + [regex]::Escape($StartMarker) + '.*?' + [regex]::Escape($EndMarker) + '\r?\n?'
}

function Remove-ManagedBlock {
    param([string]$Text)
    return [regex]::Replace($Text, (Get-ManagedBlockPattern), '')
}

function Set-AppendManagedBlock {
    param([string]$Text, [string]$Block)
    $remaining = (Remove-ManagedBlock -Text $Text).TrimEnd("`r", "`n")
    if ($remaining.Length -gt 0) { $remaining += "`n" }
    return $remaining + $Block + "`n"
}

function Set-PrependManagedBlock {
    param([string]$Text, [string]$Block)
    $remaining = (Remove-ManagedBlock -Text $Text).TrimStart("`r", "`n")
    return $Block + "`n" + $remaining
}

function ConvertTo-PostgresLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function ConvertTo-PostgresPath {
    param([string]$Value)
    return $Value.Replace('\', '/')
}

function Get-UnmanagedConfigValue {
    param([string]$Text, [string]$Key)
    $result = $null
    foreach ($line in ($Text -split "`r?`n")) {
        $clean = $line.Trim()
        if ($clean.StartsWith('#')) { continue }
        if ($clean -match ('^\s*' + [regex]::Escape($Key) + '\s*=\s*(.+)$')) {
            $result = $Matches[1].Trim()
        }
    }
    return $result
}

function Assert-NoTrustAuthentication {
    param([string]$Text)
    $inManaged = $false
    $lineNumber = 0
    foreach ($line in ($Text -split "`r?`n")) {
        $lineNumber++
        $clean = $line.Trim()
        if ($clean -eq $StartMarker) { $inManaged = $true; continue }
        if ($clean -eq $EndMarker) { $inManaged = $false; continue }
        if ($inManaged) { continue }
        if ($clean.Length -eq 0 -or $clean.StartsWith('#')) { continue }
        if ($clean -match '^\s*(include|include_if_exists|include_dir)\s') {
            throw "pg_hba.conf line $lineNumber uses an include directive. Refusing to validate indirect authentication rules; inline the reviewed rules before running this script."
        }
        $fields = $clean -split '\s+'
        if ($fields.Length -ge 1) {
            $method = $fields[$fields.Length - 1].ToLowerInvariant()
            if ($method -eq 'trust') {
                throw "pg_hba.conf line $lineNumber grants trust authentication outside the managed block. Remove it and use scram-sha-256 before running this script."
            }
        }
    }
}

function Assert-NoAutoConfOverrides {
    param([string]$DataDirectory)
    $autoConf = Join-Path $DataDirectory 'postgresql.auto.conf'
    if (-not (Test-Path -LiteralPath $autoConf)) { return }
    $text = [System.IO.File]::ReadAllText($autoConf, (New-Object System.Text.UTF8Encoding($false)))
    foreach ($key in @('port', 'listen_addresses', 'ssl', 'ssl_cert_file', 'ssl_key_file', 'wal_level', 'fsync', 'synchronous_commit', 'full_page_writes', 'password_encryption')) {
        if ($text -match ('(?m)^\s*' + [regex]::Escape($key) + '\s*=')) {
            throw "postgresql.auto.conf overrides '$key'. Remove the conflicting ALTER SYSTEM entry before running this script so the managed configuration is authoritative."
        }
    }
}

function Backup-ConfigFiles {
    param([string]$DataDirectory, [string]$PostgresConf, [string]$HbaConf)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $backupRoot = Join-Path $DataDirectory 'bar-local-config-backup'
    $target = Join-Path $backupRoot ($stamp + '-' + (New-RandomHex -Bytes 3))
    [void][System.IO.Directory]::CreateDirectory($target)
    Copy-Item -LiteralPath $PostgresConf -Destination (Join-Path $target 'postgresql.conf') -Force
    Copy-Item -LiteralPath $HbaConf -Destination (Join-Path $target 'pg_hba.conf') -Force
    $existing = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if ($null -ne $existing) {
        $existing | Select-Object -Skip 10 | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    return $target
}

function Test-PostgresConfig {
    param([string]$Bin, [string]$DataDirectory)
    $postgres = Join-Path $Bin 'postgres.exe'
    $output = & $postgres '-D' $DataDirectory '-C' 'wal_level' 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("PostgreSQL rejected the new configuration: " + (($output | ForEach-Object { [string]$_ }) -join ' '))
    }
}

function Apply-PostgresConfig {
    param(
        [string]$Bin,
        [string]$DataDirectory,
        [int]$Port,
        [string]$ServiceName,
        [switch]$ReloadOnlyMode
    )
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service) {
        if ($ReloadOnlyMode) {
            if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
                throw "Cannot reload because service $ServiceName is not running."
            }
            & (Join-Path $Bin 'pg_ctl.exe') 'reload' '-D' $DataDirectory | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'pg_ctl reload failed.' }
        }
        else {
            if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
                Restart-Service -Name $ServiceName -Force
            }
            else {
                Start-Service -Name $ServiceName
            }
            $service = Get-Service -Name $ServiceName
            $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
        }
    }
    else {
        $pgCtl = Join-Path $Bin 'pg_ctl.exe'
        if ($ReloadOnlyMode) {
            & $pgCtl 'reload' '-D' $DataDirectory | Out-Null
        }
        else {
            & $pgCtl 'status' '-D' $DataDirectory | Out-Null
            if ($LASTEXITCODE -eq 0) {
                & $pgCtl 'restart' '-D' $DataDirectory '-m' 'fast' '-w' | Out-Null
            }
            else {
                & $pgCtl 'start' '-D' $DataDirectory '-w' | Out-Null
            }
        }
        if ($LASTEXITCODE -ne 0) { throw 'pg_ctl failed to apply the configuration.' }
    }

    if (-not $ReloadOnlyMode) {
        $isReady = Join-Path $Bin 'pg_isready.exe'
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            & $isReady '-h' '127.0.0.1' '-p' ([string]$Port) '-q' | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) {
            throw "PostgreSQL did not accept loopback connections on port $Port after the configuration restart."
        }
    }
}

function Restore-OriginalFiles {
    param(
        [string]$PostgresConf,
        [string]$HbaConf,
        [string]$OriginalPostgres,
        [string]$OriginalHba
    )
    Write-TextFileAtomic -Path $PostgresConf -Content $OriginalPostgres
    Write-TextFileAtomic -Path $HbaConf -Content $OriginalHba
}

Assert-Elevated
if ($null -eq $AllowedCidrs) { $AllowedCidrs = @() }
$normalizedCidrs = @()
foreach ($cidr in $AllowedCidrs) {
    if ([string]::IsNullOrWhiteSpace($cidr)) { continue }
    $slash = $cidr.LastIndexOf('/')
    if ($slash -le 0 -or $slash -eq ($cidr.Length - 1)) {
        throw "AllowedCidrs entry must be an IP address and prefix length: '$cidr'."
    }
    $ipText = $cidr.Substring(0, $slash).Trim()
    $prefixText = $cidr.Substring($slash + 1).Trim()
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($ipText, [ref]$ip)) {
        throw "AllowedCidrs entry has an invalid IP address: '$cidr'."
    }
    $prefix = 0
    if (-not [int]::TryParse($prefixText, [ref]$prefix)) {
        throw "AllowedCidrs entry has an invalid prefix length: '$cidr'."
    }
    $maxPrefix = 128
    if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) { $maxPrefix = 32 }
    if ($prefix -lt 0 -or $prefix -gt $maxPrefix) {
        throw "AllowedCidrs entry has a prefix length outside 0..${maxPrefix}: '$cidr'."
    }
    $normalizedCidrs += ($ip.ToString() + '/' + [string]$prefix)
}
$AllowedCidrs = $normalizedCidrs
$PgBin = Resolve-AbsolutePath -Path $PgBin -Name 'PgBin'
$PgDataDir = Resolve-AbsolutePath -Path $PgDataDir -Name 'PgDataDir'
Assert-DedicatedDirectory -Path $PgDataDir -Name 'PgDataDir'
if ($DbPort -lt 1 -or $DbPort -gt 65535) {
    throw 'DbPort must be between 1 and 65535.'
}
if ($DbPort -eq 5432) {
    Write-Warning 'DbPort 5432 is the PostgreSQL default. A dedicated Bar instance should use a distinct port.'
}
$postgresConf = Join-Path $PgDataDir 'postgresql.conf'
$hbaConf = Join-Path $PgDataDir 'pg_hba.conf'
if (-not (Test-Path -LiteralPath $postgresConf)) { throw "postgresql.conf was not found: $postgresConf" }
if (-not (Test-Path -LiteralPath $hbaConf)) { throw "pg_hba.conf was not found: $hbaConf" }
if (-not (Test-Path -LiteralPath (Join-Path $PgBin 'postgres.exe'))) { throw "postgres.exe was not found under PgBin: $PgBin" }
if (-not (Test-Path -LiteralPath (Join-Path $PgBin 'pg_ctl.exe'))) { throw "pg_ctl.exe was not found under PgBin: $PgBin" }

$hasTls = -not [string]::IsNullOrWhiteSpace($TlsCertFile) -or -not [string]::IsNullOrWhiteSpace($TlsKeyFile)
if ($hasTls) {
    if ([string]::IsNullOrWhiteSpace($TlsCertFile) -or [string]::IsNullOrWhiteSpace($TlsKeyFile)) {
        throw 'TlsCertFile and TlsKeyFile must be supplied together.'
    }
    $TlsCertFile = Resolve-AbsolutePath -Path $TlsCertFile -Name 'TlsCertFile'
    $TlsKeyFile = Resolve-AbsolutePath -Path $TlsKeyFile -Name 'TlsKeyFile'
    if (-not (Test-Path -LiteralPath $TlsCertFile)) { throw "PostgreSQL TLS certificate was not found: $TlsCertFile" }
    if (-not (Test-Path -LiteralPath $TlsKeyFile)) { throw "PostgreSQL TLS private key was not found: $TlsKeyFile" }
}
if (-not $hasTls -and $AllowedCidrs.Count -gt 0) {
    throw 'Private-LAN PostgreSQL access requires TLS. Supply -TlsCertFile and -TlsKeyFile, or pass -AllowedCidrs @() for a loopback-only instance.'
}
if (-not [string]::IsNullOrWhiteSpace($ReplicationUser) -and $ReplicationUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw 'ReplicationUser must be a valid unquoted PostgreSQL identifier.'
}
if ([string]::IsNullOrWhiteSpace($ListenAddresses)) {
    throw 'ListenAddresses must not be empty. Use localhost for a loopback-only instance.'
}
if ($ListenAddresses -match "`r|`n") {
    throw 'ListenAddresses must be a single line of comma-separated addresses.'
}
foreach ($address in $ListenAddresses.Split(',')) {
    $candidate = $address.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate -notmatch '^(\*|[A-Za-z0-9_.:-]+)$') {
        throw "ListenAddresses contains an invalid entry: '$address'."
    }
}

$originalConf = ([System.IO.File]::ReadAllText($postgresConf, (New-Object System.Text.UTF8Encoding($false)))).TrimStart([char]0xFEFF)
$originalHba = ([System.IO.File]::ReadAllText($hbaConf, (New-Object System.Text.UTF8Encoding($false)))).TrimStart([char]0xFEFF)
Assert-NoTrustAuthentication -Text $originalHba
Assert-NoAutoConfOverrides -DataDirectory $PgDataDir

$newPortSetting = [string]$DbPort
$newListenSetting = ConvertTo-PostgresLiteral -Value $ListenAddresses
$oldPort = Get-UnmanagedConfigValue -Text $originalConf -Key 'port'
$oldListen = Get-UnmanagedConfigValue -Text $originalConf -Key 'listen_addresses'
$oldSsl = Get-UnmanagedConfigValue -Text $originalConf -Key 'ssl'
$newSsl = if ($hasTls) { 'on' } else { 'off' }
if ($ReloadOnly) {
    $oldArchiveMode = Get-UnmanagedConfigValue -Text $originalConf -Key 'archive_mode'
    if ($WalArchiveDir -and ($null -eq $oldArchiveMode -or $oldArchiveMode.Trim("'") -ne 'on')) {
        throw 'Enabling archive_mode requires a PostgreSQL restart, not -ReloadOnly.'
    }
    if ($null -ne $oldPort -and $oldPort -ne $newPortSetting) {
        throw "Changing port from $oldPort to $newPortSetting requires a restart, not -ReloadOnly."
    }
    if ($null -ne $oldListen -and $oldListen -ne $newListenSetting) {
        throw 'Changing listen_addresses requires a restart, not -ReloadOnly.'
    }
    if ($null -ne $oldSsl -and $oldSsl.Trim("'") -ne $newSsl) {
        throw 'Changing ssl requires a restart, not -ReloadOnly.'
    }
}

$confLines = New-Object System.Collections.Generic.List[string]
$confLines.Add($StartMarker)
$confLines.Add('# Managed by packaging/windows/configure-postgres.ps1. Do not edit this block by hand.')
$confLines.Add('port = ' + $newPortSetting)
$confLines.Add('listen_addresses = ' + $newListenSetting)
$confLines.Add("password_encryption = 'scram-sha-256'")
$confLines.Add("wal_level = 'replica'")
$confLines.Add('max_wal_senders = 10')
$confLines.Add('max_replication_slots = 10')
$confLines.Add("synchronous_commit = 'on'")
$confLines.Add('full_page_writes = on')
$confLines.Add('fsync = on')
$confLines.Add('wal_compression = on')
$confLines.Add('wal_log_hints = on')
$confLines.Add('hot_standby = on')
if (-not [string]::IsNullOrWhiteSpace($WalArchiveDir)) {
    foreach ($value in @($WalArchiveDir, $WalKeyFile, $WalNodePath, $WalScriptPath)) {
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match '[%"!&|<>^\r\n]') { throw 'WAL recovery paths are incomplete or contain unsafe command characters.' }
    }
    foreach ($file in @($WalKeyFile, $WalNodePath, $WalScriptPath)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'A required WAL recovery file is missing.' }
    }
    Assert-DistinctPaths -FirstPath $WalArchiveDir -SecondPath $PgDataDir -FirstName 'WalArchiveDir' -SecondName 'PgDataDir'
    if ((Test-PathWithin -Child $WalArchiveDir -Parent $PgDataDir) -or (Test-PathWithin -Child $PgDataDir -Parent $WalArchiveDir)) { throw 'WAL archives and PostgreSQL data must be separate.' }
    $archiveCommand = '"' + (ConvertTo-PostgresPath $WalNodePath) + '" "' + (ConvertTo-PostgresPath $WalScriptPath) + '" archive --wal-name "%f" --archive-dir "' + (ConvertTo-PostgresPath $WalArchiveDir) + '" --key-file "' + (ConvertTo-PostgresPath $WalKeyFile) + '" --source "%p"'
    $confLines.Add("archive_mode = 'on'")
    $confLines.Add("archive_timeout = '60s'")
    $confLines.Add('archive_command = ' + (ConvertTo-PostgresLiteral $archiveCommand))
}
$confLines.Add('ssl = ' + $newSsl)
if ($hasTls) {
    $confLines.Add('ssl_cert_file = ' + (ConvertTo-PostgresLiteral -Value (ConvertTo-PostgresPath -Value $TlsCertFile)))
    $confLines.Add('ssl_key_file = ' + (ConvertTo-PostgresLiteral -Value (ConvertTo-PostgresPath -Value $TlsKeyFile)))
    $confLines.Add("ssl_min_protocol_version = 'TLSv1.2'")
}
$confLines.Add($EndMarker)
$newConfBlock = ($confLines -join "`n")

$hbaLines = New-Object System.Collections.Generic.List[string]
$hbaLines.Add($StartMarker)
$hbaLines.Add('# Managed by packaging/windows/configure-postgres.ps1. These rules are evaluated first.')
$hbaLines.Add('host all all 127.0.0.1/32 scram-sha-256')
$hbaLines.Add('host all all ::1/128 scram-sha-256')
if (-not [string]::IsNullOrWhiteSpace($ReplicationUser)) {
    $hbaLines.Add('host replication ' + $ReplicationUser + ' 127.0.0.1/32 scram-sha-256')
    $hbaLines.Add('host replication ' + $ReplicationUser + ' ::1/128 scram-sha-256')
}
foreach ($cidr in $AllowedCidrs) {
    if ([string]::IsNullOrWhiteSpace($cidr)) { continue }
    $hbaLines.Add('hostssl all all ' + $cidr + ' scram-sha-256')
    if (-not [string]::IsNullOrWhiteSpace($ReplicationUser)) {
        $hbaLines.Add('hostssl replication ' + $ReplicationUser + ' ' + $cidr + ' scram-sha-256')
    }
}
$hbaLines.Add($EndMarker)
$newHbaBlock = ($hbaLines -join "`n")

$newConf = Set-AppendManagedBlock -Text $originalConf -Block $newConfBlock
$newHba = Set-PrependManagedBlock -Text $originalHba -Block $newHbaBlock

$postgresWasRunning = $false
$existingService = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
if ($null -ne $existingService) {
    $postgresWasRunning = $existingService.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running
}
else {
    & (Join-Path $PgBin 'pg_ctl.exe') 'status' '-D' $PgDataDir | Out-Null
    $postgresWasRunning = $LASTEXITCODE -eq 0
}

$backupDir = Backup-ConfigFiles -DataDirectory $PgDataDir -PostgresConf $postgresConf -HbaConf $hbaConf
$applied = $false
try {
    Write-TextFileAtomic -Path $postgresConf -Content $newConf
    Write-TextFileAtomic -Path $hbaConf -Content $newHba
    Test-PostgresConfig -Bin $PgBin -DataDirectory $PgDataDir
    if (-not $NoApply) {
        Apply-PostgresConfig -Bin $PgBin -DataDirectory $PgDataDir -Port $DbPort -ServiceName $PgServiceName -ReloadOnlyMode:$ReloadOnly
    }
    $applied = $true
}
catch {
    $failure = $_.Exception.Message
    Restore-OriginalFiles -PostgresConf $postgresConf -HbaConf $hbaConf -OriginalPostgres $originalConf -OriginalHba $originalHba
    try {
        if (-not $NoApply -and $postgresWasRunning) {
            Apply-PostgresConfig -Bin $PgBin -DataDirectory $PgDataDir -Port $DbPort -ServiceName $PgServiceName -ReloadOnlyMode:$ReloadOnly
        }
        elseif (-not $NoApply) {
            $runningService = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
            if ($null -ne $runningService -and $runningService.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
                Stop-Service -Name $PgServiceName -Force
            }
            else {
                & (Join-Path $PgBin 'pg_ctl.exe') 'stop' '-D' $PgDataDir '-m' 'fast' '-w' | Out-Null
            }
        }
    }
    catch {
        Write-Warning "Configuration rollback also failed: $($_.Exception.Message)"
    }
    throw "PostgreSQL configuration failed and the previous files were restored from $backupDir. Cause: $failure"
}

Write-Host ''
Write-Host 'PostgreSQL configuration applied.' -ForegroundColor Green
Write-Note "Data directory: $PgDataDir"
Write-Note "Port:           $DbPort"
Write-Note "Listen:         $ListenAddresses"
Write-Note "TLS:            $hasTls"
Write-Note "Backup:         $backupDir"
Write-Note "Replication:    $ReplicationUser (slot/promotion is not configured by this script)"
if (-not $applied) {
    Write-Note 'NoApply was set; files were validated but not loaded.'
}
