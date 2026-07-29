# Boroko Bookings recovery bundle

`boroko-bookings-2026-07-29.zip` is a deletion-safety archive of the accidental
`C:\Users\Botswapelo Studios\Documents\Work\Boroko Bookings` working tree.

It includes every tracked modification and every untracked non-ignored file
reported by Git at capture time. Ignored secrets, dependencies, build output,
and nested stale worktrees are excluded.

Verify the archive from PowerShell:

```powershell
$expected = (Get-Content .\recovery\boroko-bookings-2026-07-29.zip.sha256).Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 .\recovery\boroko-bookings-2026-07-29.zip).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Recovery archive checksum mismatch.' }
```

After extraction:

- `metadata/repository.txt` identifies the source repository and HEAD.
- `metadata/status.txt` records the original dirty status.
- `metadata/manifest.csv` contains per-file hashes.
- `metadata/tracked-working-tree.patch` preserves the tracked patch.
- `files/` contains exact copies of all 71 dirty files.

See `docs/WRONG_FOLDER_RECOVERY_2026-07-29.md` for the integration and
compatibility decisions. The archive is evidence/recovery material; its Phase
1–8 SQL and old POS code must not be activated wholesale.
