import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installer = readFileSync(path.join(root, 'packaging/windows/install-backup-task.ps1'), 'utf8')
const serverInstaller = readFileSync(path.join(root, 'packaging/windows/install-server.ps1'), 'utf8')

test('Windows backup task schedules hourly snapshots as well as daily and startup runs', () => {
  assert.match(installer, /HourlyEveryHours\s*=\s*1/)
  assert.match(installer, /24 % \$HourlyEveryHours/)
  assert.match(installer, /for \(\$hour = 0; \$hour -lt 24; \$hour \+= \$HourlyEveryHours\)/)
  assert.match(installer, /New-ScheduledTaskTrigger\s+-Daily\s+-At\s+\(\[datetime\]::Today\.AddHours\(\$hour\)\)\s+-DaysInterval\s+1/)
  assert.match(installer, /\$taskTriggers = @\(\$hourlyTriggers\) \+ @\(\$dailyTrigger, \$startupTrigger\)/)
  assert.equal((installer.match(/-Trigger \$taskTriggers/g) || []).length, 3)
  assert.match(serverInstaller, /HourlyEveryHours\s*=\s*1/)
  assert.match(installer, /Hourly full backups\s+are local snapshots; they are not WAL archiving/)
})

test('Windows setup refuses a secondary backup-copy directory that overlaps live or primary data', () => {
  assert.match(serverInstaller, /BAR_LOCAL_BACKUP_COPY_TO/)
  assert.match(serverInstaller, /Assert-DistinctPaths[^\r\n]*BackupCopyToDir/)
  assert.match(serverInstaller, /BackupCopyToDir must not overlap/)
})
