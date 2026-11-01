#Requires -Version 5.1
<#
.SYNOPSIS
Removes the Tsa Bonno local Bar Windows service registration.

.DESCRIPTION
Stops and deletes the service. Data, PostgreSQL data, backups, installation
binaries and certificates are preserved unless the corresponding explicit
switch is supplied. -PurgeData removes the service data directory, including
its TLS copies, setup secret and backup/replication keys; it never removes the
PostgreSQL cluster or the backup destination.
#>
[CmdletBinding()]
param(
    [string]$ServiceName = 'BarLocalService',
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'Tsa Bonno\BarLocal'),
    [string]$DataDir = (Join-Path $env:ProgramData 'Tsa Bonno\BarLocal'),
    [string]$TaskName = 'BarLocalBackup',
    [switch]$PurgeData,
    [switch]$RemoveInstall,
    [switch]$KeepBackupTask
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\BarLocalCommon.ps1')

function Assert-SafeRemovalPath {
    param([string]$Path, [string]$Name)
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $root = [System.IO.Path]::GetPathRoot($full).TrimEnd('\', '/')
    if ([string]::Equals($full, $root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove $Name at the volume root: $full"
    }
    $protected = @($env:ProgramData, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:WINDIR)
    foreach ($value in $protected) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if ([string]::Equals($full, [System.IO.Path]::GetFullPath($value).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove the protected directory $full."
        }
    }
}

Assert-Elevated
$InstallDir = Resolve-AbsolutePath -Path $InstallDir -Name 'InstallDir'
$DataDir = Resolve-AbsolutePath -Path $DataDir -Name 'DataDir'
Assert-DedicatedDirectory -Path $InstallDir -Name 'InstallDir'
Assert-DedicatedDirectory -Path $DataDir -Name 'DataDir'
if (Test-PathWithin -Child $DataDir -Parent $InstallDir) {
    throw 'DataDir must not be nested under InstallDir; refusing an uninstall that could remove service data with the binaries.'
}
if (Test-PathWithin -Child $InstallDir -Parent $DataDir) {
    throw 'InstallDir must not be nested under DataDir; refusing an uninstall with ambiguous ownership.'
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
    Write-Step "Stopping and deleting service $ServiceName"
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        Stop-Service -Name $ServiceName -Force
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }
    Invoke-External -FilePath 'sc.exe' -ArgumentList @('delete', $ServiceName) -FailureMessage "Could not delete service $ServiceName" | Out-Null
    Write-Note "Service $ServiceName deleted."
}
else {
    Write-Note "Service $ServiceName is not registered."
}

if (-not $KeepBackupTask) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Note "Scheduled task $TaskName removed."
    }
}

try {
    if ([System.Diagnostics.EventLog]::SourceExists($ServiceName)) {
        Remove-EventLog -Source $ServiceName
        Write-Note "Event log source $ServiceName removed."
    }
}
catch {
    Write-Note "Could not remove the event log source: $($_.Exception.Message)"
}

if ($RemoveInstall) {
    if (Test-Path -LiteralPath $InstallDir) {
        Assert-SafeRemovalPath -Path $InstallDir -Name 'InstallDir'
        Write-Step "Removing installation binaries at $InstallDir"
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Note 'Installation binaries removed.'
    }
}

if ($PurgeData) {
    if (Test-Path -LiteralPath $DataDir) {
        Assert-SafeRemovalPath -Path $DataDir -Name 'DataDir'
        Write-Warning "PurgeData permanently removes service data at $DataDir (including setup secret and backup/replication keys). PostgreSQL data and the backup destination are NOT removed."
        Remove-Item -LiteralPath $DataDir -Recurse -Force
        Write-Note 'Service data directory removed.'
    }
    else {
        Write-Note "Service data directory was already absent: $DataDir"
    }
}
else {
    Write-Note "Data preserved at $DataDir. Use -PurgeData only after confirming recovery material is retained elsewhere."
}

Write-Host ''
Write-Host 'Uninstall complete.' -ForegroundColor Green
Write-Note 'PostgreSQL service, PostgreSQL data directory and backup destination were left untouched.'
if ($PurgeData) {
    Write-Note 'Service data, including local TLS copies and keys, was removed by -PurgeData.'
}
else {
    Write-Note 'Service data and local TLS copies were preserved.'
}
