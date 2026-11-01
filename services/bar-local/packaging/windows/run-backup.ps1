#Requires -Version 5.1
<#
.SYNOPSIS
Runs one encrypted Bar local backup using service.env, for the scheduled task.

.DESCRIPTION
The scheduled task never contains passwords or key material. This runner reads
the protected service.env file, validates the backup destination and key file,
invokes the existing scripts/bar-operations.mjs backup command, and appends the
result to a rotating log. Secrets are never written to the log or task args.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [string]$EnvFile = '',
    [string]$LogDir = '',
    [int]$RetentionHourly = -1,
    [int]$RetentionDaily = -1,
    [int]$RetentionWeekly = -1,
    [string]$Label = 'scheduled'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

function Add-BackupLog {
    param([string]$LogPath, [string]$Line)
    [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $LogPath))
    if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 10MB)) {
        $rotated = $LogPath + '.1'
        if (Test-Path -LiteralPath $rotated) { Remove-Item -LiteralPath $rotated -Force }
        Move-Item -LiteralPath $LogPath -Destination $rotated -Force
    }
    $text = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + ' ' + $Line
    Add-Content -LiteralPath $LogPath -Value $text -Encoding UTF8
}

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
$logPath = Join-Path $LogDir 'backup.log'

$exitCode = 1
$nodePath = $null
$password = $null
try {
    $environment = Read-EnvFile -Path $EnvFile
    $hostName = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_DB_HOST'
    $portText = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_DB_PORT'
    $database = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_DB_NAME'
    $migrator = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_MIGRATOR_USER'
    $password = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_MIGRATOR_PASSWORD'
    $backupDir = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_DIR'
    $keyFile = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_KEY_FILE'
    $pgBin = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_PG_BIN'
    $nodeFromEnv = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_NODE_PATH'
    $copyTo = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_COPY_TO'

    if ($null -eq $hostName -or $null -eq $portText -or $null -eq $database -or $null -eq $migrator -or $null -eq $password) {
        throw 'service.env is missing the database host, port, name, migrator user or migrator password.'
    }
    if ($null -eq $backupDir) { throw 'service.env is missing BAR_LOCAL_BACKUP_DIR.' }
    if ($null -eq $keyFile) { throw 'service.env is missing BAR_LOCAL_BACKUP_KEY_FILE.' }
    $backupDir = Resolve-AbsolutePath -Path $backupDir -Name 'BackupDir'
    Assert-DedicatedDirectory -Path $backupDir -Name 'BackupDir'
    if (Test-PathWithin -Child $backupDir -Parent $InstallDir) {
        throw 'BackupDir must not be nested under InstallDir; uninstall must never remove backup files with the binaries.'
    }
    if (Test-PathWithin -Child $InstallDir -Parent $backupDir) {
        throw 'InstallDir must not be nested under BackupDir; backup retention must never be able to reach service binaries.'
    }
    $keyFile = Resolve-AbsolutePath -Path $keyFile -Name 'BackupKeyFile'
    if (-not (Test-Path -LiteralPath $keyFile)) { throw "The encrypted backup key file was not found: $keyFile" }
    [void][System.IO.Directory]::CreateDirectory($backupDir)

    $script = Join-Path $InstallDir 'scripts\bar-operations.mjs'
    if (-not (Test-Path -LiteralPath $script)) { throw "The backup runner was not found: $script" }

    if (-not [string]::IsNullOrWhiteSpace($nodeFromEnv)) {
        $nodePath = $nodeFromEnv
    }
    else {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) { throw 'node.exe was not found. Set BAR_LOCAL_NODE_PATH in service.env.' }
        $nodePath = $nodeCommand.Source
    }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw "node.exe was not found at $nodePath" }

    if (-not [string]::IsNullOrWhiteSpace($pgBin)) {
        $pgDump = Join-Path $pgBin 'pg_dump.exe'
    }
    else {
        $dumpCommand = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
        if ($null -eq $dumpCommand) { throw 'pg_dump.exe was not found. Set BAR_LOCAL_PG_BIN in service.env.' }
        $pgDump = $dumpCommand.Source
    }
    if (-not (Test-Path -LiteralPath $pgDump)) { throw "pg_dump.exe was not found at $pgDump" }

    if ($RetentionHourly -lt 0) { $RetentionHourly = [int](Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_RETENTION_HOURLY' -Default '24') }
    if ($RetentionDaily -lt 0) { $RetentionDaily = [int](Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_RETENTION_DAILY' -Default '7') }
    if ($RetentionWeekly -lt 0) { $RetentionWeekly = [int](Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_RETENTION_WEEKLY' -Default '4') }

    $arguments = @(
        $script,
        'backup',
        '--host', $hostName,
        '--port', $portText,
        '--database', $database,
        '--user', $migrator,
        '--password-env', 'BAR_LOCAL_MIGRATOR_PASSWORD',
        '--key-file', $keyFile,
        '--destination', $backupDir,
        '--pg-dump', $pgDump,
        '--label', $Label,
        '--retention-hourly', [string]$RetentionHourly,
        '--retention-daily', [string]$RetentionDaily,
        '--retention-weekly', [string]$RetentionWeekly
    )
    if (-not [string]::IsNullOrWhiteSpace($copyTo)) {
        $arguments += @('--copy-to', $copyTo)
    }

    Add-BackupLog -LogPath $logPath -Line 'backup starting'
    [System.Environment]::SetEnvironmentVariable('BAR_LOCAL_MIGRATOR_PASSWORD', $password, 'Process')
    try {
        $output = & $nodePath @arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        [System.Environment]::SetEnvironmentVariable('BAR_LOCAL_MIGRATOR_PASSWORD', $null, 'Process')
    }
    foreach ($entry in $output) {
        Add-BackupLog -LogPath $logPath -Line ([string]$entry)
    }
    if ($exitCode -ne 0) {
        throw "scripts/bar-operations.mjs backup failed with exit code $exitCode. Preserve the existing backup chain and correct the destination/key before retrying."
    }
    Add-BackupLog -LogPath $logPath -Line 'backup complete'
}
catch {
    $message = $_.Exception.Message
    try { Add-BackupLog -LogPath $logPath -Line ('backup failed: ' + $message) } catch { }
    Write-Error $message
    $exitCode = 1
}
finally {
    $password = $null
}

exit $exitCode
