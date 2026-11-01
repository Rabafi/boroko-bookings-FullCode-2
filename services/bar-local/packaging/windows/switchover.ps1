#Requires -Version 5.1
<#
.SYNOPSIS
Run the reviewed manual Bar-local switchover with preflight checks.

.DESCRIPTION
Uses scripts/bar-replication.mjs status to verify that the configured primary is
writable, the standby is in recovery and streaming, and at least one standby is
caught up. It then invokes the existing switchover contract, which fences the old
primary through PostgreSQL SQL and promotes the standby. The script never
rewrites service.env or client configuration; the operator must repoint clients
manually after a successful promotion.

Both administrative URLs must be loopback because the service deliberately
refuses remote administrative targets. Use local tunnels when the two clusters
are on different hosts.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$PrimaryPort,
    [Parameter(Mandatory = $true)][int]$StandbyPort,
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'Tsa Bonno\BarLocal'),
    [string]$DataDir = '',
    [string]$EnvFile = '',
    [string]$NodePath = '',
    [string]$PgBin = '',
    [string]$PgDataDir = '',
    [string]$DbName = '',
    [string]$AdminUser = '',
    [string]$PrimaryAdminPasswordFile = '',
    [string]$StandbyAdminPasswordFile = '',
    [string]$PrimaryAdminHost = '127.0.0.1',
    [string]$StandbyAdminHost = '127.0.0.1',
    [int]$PrimaryAdminPort = 0,
    [int]$StandbyAdminPort = 0,
    [string]$PrimaryAdminDatabase = '',
    [string]$StandbyAdminDatabase = '',
    [string]$ConfirmText = '',
    [string]$Reason = '',
    [string]$LocalBarServiceName = 'BarLocalService',
    [switch]$StopLocalBarService,
    [switch]$DryRun
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

function ConvertTo-StatusReport {
    param([pscustomobject]$Result, [string]$Label)
    if (-not [string]::IsNullOrWhiteSpace($Result.Text)) {
        foreach ($line in ($Result.Text -split "`r?`n")) {
            if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Note (Protect-Text $line) }
        }
    }
    if ($Result.Code -ne 0) {
        throw "$Label status failed with exit code $($Result.Code). Do not proceed with a switchover."
    }
    try {
        return $Result.Text | ConvertFrom-Json
    }
    catch {
        throw "$Label status returned unparseable output. Treat the switchover as unverified."
    }
}

function Get-PrimaryStatus {
    param([hashtable]$BaseEnvironment, [string]$Node, [string]$Script, [string]$Url)
    $environment = @{}
    foreach ($key in $BaseEnvironment.Keys) { $environment[$key] = $BaseEnvironment[$key] }
    $environment['BAR_LOCAL_ADMIN_DATABASE_URL'] = $Url
    $result = Invoke-NodeCli -Node $Node -Script $Script -Arguments @('status') -Environment $environment
    return ConvertTo-StatusReport -Result $result -Label 'Primary'
}

function Get-StandbyStatus {
    param([hashtable]$BaseEnvironment, [string]$Node, [string]$Script, [string]$Url)
    $environment = @{}
    foreach ($key in $BaseEnvironment.Keys) { $environment[$key] = $BaseEnvironment[$key] }
    $environment['BAR_LOCAL_ADMIN_DATABASE_URL'] = $Url
    $result = Invoke-NodeCli -Node $Node -Script $Script -Arguments @('status') -Environment $environment
    return ConvertTo-StatusReport -Result $result -Label 'Standby'
}

Assert-Elevated
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
    Write-Warning "No service.env was found at $EnvFile; falling back to explicit parameters. Supply -NodePath and protected administrative password files."
}

if ([string]::IsNullOrWhiteSpace($DataDir)) {
    $DataDir = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_DATA_DIR' -Default '')
    if ([string]::IsNullOrWhiteSpace($DataDir)) { $DataDir = $programDataRoot }
}
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
if ($PrimaryPort -lt 1 -or $PrimaryPort -gt 65535) { throw 'PrimaryPort must be between 1 and 65535.' }
if ($StandbyPort -lt 1 -or $StandbyPort -gt 65535) { throw 'StandbyPort must be between 1 and 65535.' }
if ($PrimaryPort -eq 5432 -or $StandbyPort -eq 5432) { throw 'Bar-local PostgreSQL ports must not be the default 5432.' }
if ([string]::IsNullOrWhiteSpace($DbName)) {
    $DbName = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_DB_NAME' -Default 'bar_local')
}
if ($DbName -notmatch '^bar_local(?:_|$)') { throw "DbName must begin with bar_local; received '$DbName'." }
if ($DbName -match '^bar_local_test(?:_|$)') { throw 'DbName must not be a bar_local_test database.' }
if ([string]::IsNullOrWhiteSpace($PgBin)) {
    $PgBin = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_PG_BIN' -Default '')
}
if ([string]::IsNullOrWhiteSpace($PgDataDir)) {
    $PgDataDir = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_PG_DATA_DIR' -Default '')
}
if ([string]::IsNullOrWhiteSpace($PgDataDir)) { $PgDataDir = Join-Path $DataDir 'pgdata' }
$PgDataDir = Resolve-AbsolutePath -Path $PgDataDir -Name 'PgDataDir'
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

if ([string]::IsNullOrWhiteSpace($AdminUser)) {
    $AdminUser = [string](Get-EnvValue -Values $serviceEnvironment -Name 'BAR_LOCAL_BOOTSTRAP_USER' -Default '')
    if ([string]::IsNullOrWhiteSpace($AdminUser)) { $AdminUser = 'postgres' }
}
if ($AdminUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'AdminUser must be a valid unquoted PostgreSQL identifier.' }
$PrimaryAdminHost = $PrimaryAdminHost.Trim()
$StandbyAdminHost = $StandbyAdminHost.Trim()
if (-not (Test-LoopbackHost -HostName $PrimaryAdminHost) -or -not (Test-LoopbackHost -HostName $StandbyAdminHost)) {
    throw 'Both administrative hosts must be loopback. The Bar service refuses remote administrative targets; use local tunnels and re-run this command.'
}
if ([string]::IsNullOrWhiteSpace($PrimaryAdminPasswordFile)) { $PrimaryAdminPasswordFile = Join-Path $DataDir 'secrets\postgres-bootstrap.txt' }
if ([string]::IsNullOrWhiteSpace($StandbyAdminPasswordFile)) { $StandbyAdminPasswordFile = Join-Path $DataDir 'secrets\postgres-bootstrap.txt' }
$PrimaryAdminPasswordFile = Resolve-AbsolutePath -Path $PrimaryAdminPasswordFile -Name 'PrimaryAdminPasswordFile'
$StandbyAdminPasswordFile = Resolve-AbsolutePath -Path $StandbyAdminPasswordFile -Name 'StandbyAdminPasswordFile'
if (-not (Test-Path -LiteralPath $PrimaryAdminPasswordFile)) {
    throw "The primary administrative password file was not found: $PrimaryAdminPasswordFile. Supply -PrimaryAdminPasswordFile."
}
if (-not (Test-Path -LiteralPath $StandbyAdminPasswordFile)) {
    throw "The standby administrative password file was not found: $StandbyAdminPasswordFile. Supply -StandbyAdminPasswordFile."
}
$primaryPassword = Read-SecretText -Path $PrimaryAdminPasswordFile -Name 'primary administrative password file'
$standbyPassword = Read-SecretText -Path $StandbyAdminPasswordFile -Name 'standby administrative password file'
if ([string]::IsNullOrWhiteSpace($PrimaryAdminDatabase)) { $PrimaryAdminDatabase = $DbName }
if ([string]::IsNullOrWhiteSpace($StandbyAdminDatabase)) { $StandbyAdminDatabase = $DbName }
if (-not [string]::Equals($PrimaryAdminDatabase, $StandbyAdminDatabase, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "PrimaryAdminDatabase and StandbyAdminDatabase must identify the same Bar database; received '$PrimaryAdminDatabase' and '$StandbyAdminDatabase'."
}
if ($PrimaryAdminPort -eq 0) { $PrimaryAdminPort = $PrimaryPort }
if ($StandbyAdminPort -eq 0) { $StandbyAdminPort = $StandbyPort }
if ($PrimaryAdminPort -lt 1 -or $PrimaryAdminPort -gt 65535) { throw 'PrimaryAdminPort must be between 1 and 65535.' }
if ($StandbyAdminPort -lt 1 -or $StandbyAdminPort -gt 65535) { throw 'StandbyAdminPort must be between 1 and 65535.' }
if ($PrimaryAdminPort -eq $StandbyAdminPort) {
    throw 'PrimaryAdminHost:PrimaryAdminPort and StandbyAdminHost:StandbyAdminPort must identify different PostgreSQL endpoints. Both administrative hosts are loopback, so the ports must differ.'
}
$primaryUrl = New-PgAdminUrl -User $AdminUser -Password $primaryPassword -HostName $PrimaryAdminHost -Port $PrimaryAdminPort -Database $PrimaryAdminDatabase
$standbyUrl = New-PgAdminUrl -User $AdminUser -Password $standbyPassword -HostName $StandbyAdminHost -Port $StandbyAdminPort -Database $StandbyAdminDatabase

$baseEnvironment = @{
    BAR_LOCAL_DB_HOST = '127.0.0.1'
    BAR_LOCAL_DB_PORT = [string]$PrimaryPort
    BAR_LOCAL_DB_NAME = $DbName
    BAR_LOCAL_PG_BIN = $PgBin
    BAR_LOCAL_PG_DATA_DIR = $PgDataDir
    BAR_LOCAL_NETWORK_ROLE = 'single_host'
    BAR_LOCAL_REPLICATION_COORDINATOR = 'manual'
}

Write-Step 'Preflight: primary and standby replication status'
$primaryStatus = Get-PrimaryStatus -BaseEnvironment $baseEnvironment -Node $NodePath -Script $replicationScript -Url $primaryUrl
$standbyStatus = Get-StandbyStatus -BaseEnvironment $baseEnvironment -Node $NodePath -Script $replicationScript -Url $standbyUrl
if ($null -eq $primaryStatus -or $primaryStatus.ok -ne $true) { throw 'The primary status response was not successful.' }
if ($null -eq $standbyStatus -or $standbyStatus.ok -ne $true) { throw 'The standby status response was not successful.' }
if ($primaryStatus.replication.role -ne 'primary') {
    throw "The configured primary reports role '$($primaryStatus.replication.role)', not primary. Refusing to continue."
}
if ($standbyStatus.replication.role -ne 'standby' -or $standbyStatus.replication.in_recovery -ne $true) {
    throw "The configured standby reports role '$($standbyStatus.replication.role)' with in_recovery='$($standbyStatus.replication.in_recovery)'. Refusing to continue."
}
if ([int]$primaryStatus.replication.caught_up_standbys -lt 1) {
    throw 'No caught-up streaming standby is visible from the primary. Refusing a switchover that could lose committed Bar data.'
}
Write-Note "Primary role:       $($primaryStatus.replication.role), LSN $($primaryStatus.replication.current_lsn), synchronous_commit $($primaryStatus.replication.synchronous_commit)"
Write-Note "Standby role:       $($standbyStatus.replication.role), receive $($standbyStatus.replication.receive_lsn), replay $($standbyStatus.replication.replay_lsn), lag $($standbyStatus.replication.replay_lag_bytes) bytes"
Write-Note "Caught-up standbys: $($primaryStatus.replication.caught_up_standbys)"
Write-Note "Coordinator:        manual (no automatic failover is implemented)"

if ($DryRun) {
    Write-Note 'DryRun was set. No fencing, promotion or client repoint was performed.'
    return
}

if ($ConfirmText -ne 'SWITCHOVER') {
    throw 'A switchover requires -ConfirmText SWITCHOVER after reviewing the preflight output.'
}
if ([string]::IsNullOrWhiteSpace($Reason) -or $Reason.Length -lt 3 -or $Reason.Length -gt 500) {
    throw 'A switchover requires -Reason between 3 and 500 characters.'
}
if ($Reason -match "`r|`n" -or $Reason.StartsWith('--')) {
    throw 'The switchover reason must be a single line and must not begin with --.'
}

$switchoverEnvironment = @{}
foreach ($key in $baseEnvironment.Keys) { $switchoverEnvironment[$key] = $baseEnvironment[$key] }
$switchoverEnvironment['BAR_LOCAL_ADMIN_DATABASE_URL'] = $primaryUrl
$switchoverEnvironment['BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL'] = $standbyUrl

Write-Step 'Fencing the primary and promoting the standby'
$result = Invoke-NodeCli -Node $NodePath -Script $replicationScript -Arguments @('switchover', '--confirm', 'SWITCHOVER', '--reason', $Reason) -Environment $switchoverEnvironment
if (-not [string]::IsNullOrWhiteSpace($result.Text)) {
    foreach ($line in ($result.Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Note (Protect-Text $line) }
    }
}
if ($result.Code -ne 0) {
    throw "Switchover failed with exit code $($result.Code). The old primary may or may not be fenced; inspect both clusters before any client repoint."
}
$report = $null
try {
    $report = $result.Text | ConvertFrom-Json
}
catch {
    throw 'Switchover returned unparseable output. Treat both clusters as unverified and do not redirect clients.'
}
if ($null -eq $report) { throw 'Switchover returned no report. Do not redirect clients.' }
if ($report.ok -ne $true) {
    $code = 'UNKNOWN'
    $message = 'The switchover report did not confirm promotion.'
    if ($null -ne $report.error) {
        if ($null -ne $report.error.code) { $code = [string]$report.error.code }
        if ($null -ne $report.error.message) { $message = [string]$report.error.message }
    }
    if ($report.authority_state -eq 'fence_failed') {
        throw "Switchover did not fence the old primary ($code): $message Do not redirect clients and do not start the Bar service on any host until fencing is verified."
    }
    if ($report.authority_state -eq 'fenced_no_promotion') {
        throw "The old primary was fenced read-only but the standby was not promoted ($code): $message Do not redirect clients. Recover the old primary or promote only under a reviewed recovery procedure."
    }
    throw "Switchover failed ($code): $message Do not redirect clients."
}
if ($report.authority_state -ne 'promoted' -or $null -eq $report.promoted) {
    throw "Switchover did not report a verified promotion. State: '$($report.authority_state)'. Do not redirect clients."
}

Write-Step 'Post-promotion verification'
$newPrimaryStatus = Get-PrimaryStatus -BaseEnvironment $baseEnvironment -Node $NodePath -Script $replicationScript -Url $standbyUrl
if ($null -eq $newPrimaryStatus -or $newPrimaryStatus.ok -ne $true -or $newPrimaryStatus.replication.role -ne 'primary' -or $newPrimaryStatus.replication.in_recovery -ne $false) {
    throw 'The promoted standby does not report a writable primary. Do not start the Bar service or redirect clients until the promotion is independently verified.'
}
Write-Note "New primary role:   $($newPrimaryStatus.replication.role), LSN $($newPrimaryStatus.replication.current_lsn)"

if ($StopLocalBarService) {
    $service = Get-Service -Name $LocalBarServiceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        Write-Note "No local Bar service named $LocalBarServiceName was found; nothing to stop."
    }
    elseif ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        Write-Step "Stopping local Bar service $LocalBarServiceName"
        try {
            Stop-Service -Name $LocalBarServiceName -Force
            $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
            Write-Note "Stopped $LocalBarServiceName."
        }
        catch {
            Write-Warning "Promotion succeeded, but the local Bar service $LocalBarServiceName could not be stopped: $($_.Exception.Message). Stop it manually before repointing clients; the fenced database remains read-only."
        }
    }
}

$fencedAt = 'unknown'
if ($null -ne $report.fenced -and $null -ne $report.fenced.at) { $fencedAt = [string]$report.fenced.at }
$promotedAt = 'unknown'
if ($null -ne $report.promoted -and $null -ne $report.promoted.at) { $promotedAt = [string]$report.promoted.at }
$promotedLsn = 'unknown'
if ($null -ne $report.promoted -and $null -ne $report.promoted.lsn) { $promotedLsn = [string]$report.promoted.lsn }

Write-Host ''
Write-Host 'Switchover complete.' -ForegroundColor Green
Write-Note "Authority state:    $($report.authority_state)"
Write-Note "Fenced at:          $fencedAt"
Write-Note "Promoted at:        $promotedAt"
Write-Note "Promoted LSN:       $promotedLsn"
Write-Note 'Client repoint is required. This script did not modify service.env or any client configuration.'
Write-Note 'Manual next steps:'
Write-Note '  1. Keep the old primary stopped or read-only; do not start the Bar service there.'
Write-Note '  2. Start the Bar service on the promoted host only after confirming its local TLS, PostgreSQL, firewall and staged service.env/secret configuration.'
Write-Note '  3. Repoint Bar clients and the Manager PWA/desktop configuration to the promoted host.'
Write-Note '  4. Rebuild the old primary as a standby under a separate reviewed procedure before treating it as redundancy.'
