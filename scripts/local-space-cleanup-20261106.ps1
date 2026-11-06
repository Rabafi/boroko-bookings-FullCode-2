$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$prefix = $root + [IO.Path]::DirectorySeparatorChar
$tracked = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
git -C $root ls-files | ForEach-Object { [void]$tracked.Add($_.Replace('\','/')) }
if ($LASTEXITCODE -ne 0) { throw 'Unable to inventory tracked files' }
$cutoff = [datetime]'2026-11-04T00:00:00'
$targets = [Collections.Generic.List[string]]::new()
Get-ChildItem -LiteralPath (Join-Path $root '.tmp') -Directory | Where-Object { $_.Name -match '^(pr-|sr-|dbg-bundle|esbuild-check$|electron-download-cache$|bar-lan-proof-)' } | ForEach-Object { $targets.Add($_.FullName) }
Get-ChildItem -LiteralPath (Join-Path $root 'tmp') -Directory | Where-Object { $_.Name -match '^(bar-guide-|l01-deno-|typecheck-deno-)' } | ForEach-Object { $targets.Add($_.FullName) }
Get-ChildItem -LiteralPath (Join-Path $root 'build') -Directory | Where-Object { $_.Name -like 'bar-local-server-before-*' } | ForEach-Object { $targets.Add($_.FullName) }
$targets.Add((Join-Path $root 'dist/hospitality-pos/win-unpacked'))
$records = [Collections.Generic.List[object]]::new()
$skipped = [Collections.Generic.List[string]]::new()
$activePaths = @(Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch {} })
foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $full = (Resolve-Path -LiteralPath $target).Path
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $full" }
    $items = @(Get-ChildItem -LiteralPath $full -Recurse -Force -ErrorAction Stop)
    $rel = $full.Substring($prefix.Length).Replace('\','/')
    $hasTracked = @($tracked | Where-Object { $_ -eq $rel -or $_.StartsWith($rel + '/', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    $active = @($activePaths | Where-Object { $_ -and $_.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    $isUnpacked = $rel -eq 'dist/hospitality-pos/win-unpacked'
    $unsafe = $hasTracked -or $active -or ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint) -or @($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -eq 'postmaster.pid' -or ((-not $isUnpacked) -and (-not $_.PSIsContainer) -and $_.LastWriteTime -ge $cutoff) }).Count -gt 0
    if ($unsafe) { $skipped.Add($rel); continue }
    $bytes = ($items | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum
    Remove-Item -LiteralPath $full -Recurse -Force
    $records.Add([pscustomobject]@{Path=$rel;Bytes=[long]$bytes;Kind='disposable-directory'})
}
# Retain scripts, manifests, approved documents and the newest v12 candidate.
$previewRoots = @('docs/bar-manual/build','docs/audits/2026-10-09/bar-v10-continuation')
foreach ($previewRoot in $previewRoots) {
    $base = Join-Path $root $previewRoot
    $files = @(Get-ChildItem -LiteralPath $base -File -Recurse -Force)
    foreach ($file in $files) {
        $full = $file.FullName
        if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid preview path' }
        $rel = $full.Substring($prefix.Length).Replace('\','/')
        if ($tracked.Contains($rel) -or $file.LastWriteTime -ge $cutoff) { continue }
        if ($file.Extension -notmatch '^\.(pdf|png|jpg|jpeg|webp|pyc)$') { continue }
        if ($rel -like '*2026-10-13-v12/*') { continue }
        if ($rel -notmatch '/remediation-candidate-' -and $rel -notmatch '/draft[^/]*/') { continue }
        $parent = $file.Directory
        $linked = $false
        while ($parent -and $parent.FullName.Length -ge $base.Length) { if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { $linked=$true;break }; $parent=$parent.Parent }
        if ($linked) { continue }
        Remove-Item -LiteralPath $full -Force
        $records.Add([pscustomobject]@{Path=$rel;Bytes=$file.Length;Kind='superseded-preview'})
    }
}
$report = Join-Path $root 'output/space-cleanup-2026-11-06.json'
[IO.Directory]::CreateDirectory((Split-Path $report)) | Out-Null
@{Deleted=@($records);Skipped=@($skipped);BytesRemoved=($records | Measure-Object Bytes -Sum).Sum;ManualImpact='No manual update required: obsolete local artifacts only; approved guides and current candidate retained.'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report
[pscustomobject]@{RemovedGiB=[math]::Round(($records | Measure-Object Bytes -Sum).Sum/1GB,3);Entries=$records.Count;Skipped=@($skipped);Report=$report} | ConvertTo-Json -Depth 3
