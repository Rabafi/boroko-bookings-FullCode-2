#Requires -Version 5.1
<#
.SYNOPSIS
Registers hourly, daily and on-start Bar local encrypted backup runs.

.DESCRIPTION
The task runs run-backup.ps1, which reads service.env itself. Passwords and key
material never appear in the scheduled task arguments. The task runs under the
Bar service account with limited privileges, starts when available to recover a
missed run, and appends output to the service log directory. Hourly full backups
are local snapshots; they are not WAL archiving or point-in-time recovery.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [string]$EnvFile = '',
    [string]$LogDir = '',
    [string]$RunnerPath = '',
    [string]$StateFile = '',
    [string]$TaskName = 'BarLocalBackup',
    [string]$DailyAt = '02:00',
    [ValidateRange(1, 24)][int]$HourlyEveryHours = 1,
    [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
    [System.Security.SecureString]$ServiceAccountPassword,
    [int]$RetentionHourly = 24,
    [int]$RetentionDaily = 7,
    [int]$RetentionWeekly = 4,
    [string]$Label = 'scheduled',
    [switch]$RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')
Import-Module ScheduledTasks -ErrorAction Stop

Assert-Elevated
$InstallDir = Resolve-AbsolutePath -Path $InstallDir -Name 'InstallDir'
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal\service.env'
}
if ([string]::IsNullOrWhiteSpace($LogDir)) {
    $LogDir = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal\logs'
}
if ([string]::IsNullOrWhiteSpace($StateFile)) {
    $StateFile = Join-Path $env:ProgramData 'Tsa Bonno\BarLocal\backup-task-state.json'
}
$EnvFile = Resolve-AbsolutePath -Path $EnvFile -Name 'EnvFile'
$LogDir = Resolve-AbsolutePath -Path $LogDir -Name 'LogDir'
$StateFile = Resolve-AbsolutePath -Path $StateFile -Name 'StateFile'
if ([string]::IsNullOrWhiteSpace($RunnerPath)) {
    $candidate = Join-Path $PSScriptRoot 'run-backup.ps1'
    if (Test-Path -LiteralPath $candidate) {
        $RunnerPath = $candidate
    }
    else {
        $RunnerPath = Join-Path $InstallDir 'packaging\windows\run-backup.ps1'
    }
}
$RunnerPath = Resolve-AbsolutePath -Path $RunnerPath -Name 'RunnerPath'
if (-not (Test-Path -LiteralPath $RunnerPath)) {
    throw "The backup runner was not found: $RunnerPath"
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "The service environment file was not found: $EnvFile"
}
foreach ($value in @($RetentionHourly, $RetentionDaily, $RetentionWeekly)) {
    if ($value -lt 0) { throw 'Retention values must be zero or positive.' }
}
$dailyTime = $null
try {
    $dailyTime = [datetime]::ParseExact($DailyAt, 'HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
}
catch {
    throw "DailyAt must use 24-hour HH:mm format (for example 02:00). Received '$DailyAt'."
}
if ((24 % $HourlyEveryHours) -ne 0) {
    throw 'HourlyEveryHours must divide evenly into 24 so the schedule has no longer gap at midnight.'
}

$environment = Read-EnvFile -Path $EnvFile
$backupDir = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_DIR'
$keyFile = Get-EnvValue -Values $environment -Name 'BAR_LOCAL_BACKUP_KEY_FILE'
if ([string]::IsNullOrWhiteSpace($backupDir)) {
    throw 'service.env does not define BAR_LOCAL_BACKUP_DIR.'
}
$backupDir = Resolve-AbsolutePath -Path $backupDir -Name 'BackupDir'
Assert-DedicatedDirectory -Path $backupDir -Name 'BackupDir'
if (Test-PathWithin -Child $backupDir -Parent $InstallDir) {
    throw 'BackupDir must not be nested under InstallDir; uninstall must never remove backup files with the binaries.'
}
if (Test-PathWithin -Child $InstallDir -Parent $backupDir) {
    throw 'InstallDir must not be nested under BackupDir; backup retention must never be able to reach service binaries.'
}
if ([string]::IsNullOrWhiteSpace($keyFile)) {
    throw 'service.env does not define BAR_LOCAL_BACKUP_KEY_FILE.'
}
$keyFile = Resolve-AbsolutePath -Path $keyFile -Name 'BackupKeyFile'
if (-not (Test-Path -LiteralPath $keyFile)) {
    throw "The backup key file configured in service.env was not found: $keyFile"
}
Assert-AccountExists -Account $ServiceAccount -Name 'ServiceAccount'
[void][System.IO.Directory]::CreateDirectory($backupDir)
Set-ServiceDirectoryAcl -Path $backupDir -ServiceAccount $ServiceAccount -Modify -NoInherit

$quotedRunner = '"' + $RunnerPath + '"'
$actionArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $quotedRunner +
    ' -InstallDir "' + $InstallDir + '"' +
    ' -DataDir "' + $DataDir + '"' +
    ' -EnvFile "' + $EnvFile + '"' +
    ' -LogDir "' + $LogDir + '"' +
    ' -RetentionHourly ' + [string]$RetentionHourly +
    ' -RetentionDaily ' + [string]$RetentionDaily +
    ' -RetentionWeekly ' + [string]$RetentionWeekly +
    ' -Label "' + $Label + '"'

$powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powerShellExe)) {
    throw "Windows PowerShell was not found at $powerShellExe"
}

$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $actionArguments
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $dailyTime
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$hourlyTriggers = @()
for ($hour = 0; $hour -lt 24; $hour += $HourlyEveryHours) {
    $hourlyTriggers += New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($hour)) -DaysInterval 1
}
$taskTriggers = @($hourlyTriggers) + @($dailyTrigger, $startupTrigger)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$description = 'Tsa Bonno local Bar encrypted backup. Reads protected service.env at run time; no secrets are stored in task arguments.'

Grant-ServiceLogonRight -Account $ServiceAccount

$builtIn = @(
    'localsystem',
    'nt authority\system',
    'localservice',
    'nt authority\localservice',
    'networkservice',
    'nt authority\networkservice'
) -contains $ServiceAccount.ToLowerInvariant()

Write-Step "Registering scheduled task $TaskName"
if ($builtIn) {
    $principal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType ServiceAccount -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $taskTriggers -Settings $settings -Description $description -Principal $principal -Force | Out-Null
}
elseif ($null -ne $ServiceAccountPassword) {
    $plain = ConvertTo-PlainText -SecureString $ServiceAccountPassword
    try {
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $taskTriggers -Settings $settings -Description $description -User $ServiceAccount -Password $plain -RunLevel Limited -Force | Out-Null
    }
    finally {
        $plain = $null
    }
}
else {
    $principal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $taskTriggers -Settings $settings -Description $description -Principal $principal -Force | Out-Null
}

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
$stateMarker = [ordered]@{
    format              = 'bar-local-backup-task-v1'
    task_name           = $TaskName
    registered_at        = [datetime]::UtcNow.ToString('o')
    runner_path         = $RunnerPath
    env_file            = $EnvFile
    log_dir             = $LogDir
    backup_dir          = $backupDir
    hourly_every_hours  = $HourlyEveryHours
    daily_at            = $DailyAt
    service_account     = $ServiceAccount
    task_state           = [string]$task.State
}
Write-TextFileAtomic -Path $StateFile -Content ($stateMarker | ConvertTo-Json -Compress)
Set-SecretFileAcl -Path $StateFile -ServiceAccount $ServiceAccount
Write-Host ''
Write-Host 'Backup task registered.' -ForegroundColor Green
Write-Note "Task:        $TaskName"
Write-Note "Hourly:      every $HourlyEveryHours hour(s), on evenly spaced daily triggers"
Write-Note "Daily at:    $DailyAt local time plus at startup"
Write-Note "Runner:      $RunnerPath"
Write-Note "Destination: $backupDir"
Write-Note "Key file:    $keyFile (not logged)"
Write-Note "State:       $($task.State)"
Write-Note "Log:         $(Join-Path $LogDir 'backup.log')"
Write-Note "State file:  $StateFile"
Write-Note "Next run:    $($info.NextRunTime)"

if ($RunNow) {
    Write-Step "Starting $TaskName now"
    Start-ScheduledTask -TaskName $TaskName
    Write-Note 'The task was started. Verify backup.log and the destination before treating the backup as valid.'
}
