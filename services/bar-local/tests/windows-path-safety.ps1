# Windows-only filesystem test for protected Bar service path comparisons.
$ErrorActionPreference = 'Stop'
$common = Join-Path $PSScriptRoot '..\packaging\windows\lib\BarLocalCommon.ps1'
. (Resolve-Path -LiteralPath $common)

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$root = Join-Path $repoRoot ('.tmp\bar-local-path-safety-' + [guid]::NewGuid().ToString('N'))
$protected = Join-Path $root 'protected'
$alias = Join-Path $root 'alias'
New-Item -ItemType Directory -Path $protected -Force | Out-Null
try {
    New-Item -ItemType Junction -Path $alias -Target $protected | Out-Null
    if (-not (Test-PathEqual -Left $alias -Right $protected)) {
        throw 'Test-PathEqual did not resolve the Windows junction target.'
    }
    if (-not (Test-PathWithin -Child (Join-Path $alias 'nested\backup') -Parent $protected)) {
        throw 'Test-PathWithin did not resolve the Windows junction ancestor.'
    }
    if (Test-PathWithin -Child $protected -Parent (Join-Path $root 'other')) {
        throw 'Test-PathWithin reported an unrelated path as nested.'
    }
    Write-Output 'Windows junction path safety passed.'
}
finally {
    if (Test-Path -LiteralPath $alias) { Remove-Item -LiteralPath $alias -Force }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
