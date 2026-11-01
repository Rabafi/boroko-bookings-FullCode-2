import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildAdminStatus } from '../dist/admin.js'
import { loadConfig } from '../dist/config.js'

function statusQuery() {
  return async (sql) => {
    if (sql.includes('pg_is_in_recovery')) return { rows: [{ in_recovery: false, receive_lsn: null, replay_lsn: null, last_replay: null }] }
    if (sql.includes('current_setting')) return { rows: [{ synchronous_commit: 'on', synchronous_standby_names: '' }] }
    if (sql.includes('pg_stat_replication')) return { rows: [] }
    if (sql.includes('pg_current_wal_lsn')) return { rows: [{ current_lsn: '0/1' }] }
    if (sql.includes('service_admin_status')) return { rows: [{ result: { schema_migration: '0075_post_close_corrections', devices: { count: 1, active: 1 } } }] }
    if (sql.includes('SELECT 1')) return { rows: [{ reachable: 1 }] }
    throw new Error(`Unexpected status SQL: ${sql}`)
  }
}

function fixture(name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `bar-local-backup-health-${name}-`))
  const backups = path.join(root, 'backups')
  const logs = path.join(root, 'logs')
  mkdirSync(backups, { recursive: true })
  mkdirSync(logs, { recursive: true })
  const stateFile = path.join(root, 'backup-task-state.json')
  const config = loadConfig({
    BAR_LOCAL_BACKUP_DIR: backups,
    BAR_LOCAL_BACKUP_TASK_STATE_FILE: stateFile,
    BAR_LOCAL_LOG_DIR: logs
  }, { root })
  return { root, backups, logs, stateFile, config }
}

function writeMarker(stateFile, overrides = {}) {
  writeFileSync(stateFile, JSON.stringify({
    format: 'bar-local-backup-task-v1',
    task_name: 'BarLocalBackup',
    registered_at: '2026-10-29T06:00:00.000Z',
    runner_path: 'C:\\Bar\\run-backup.ps1',
    env_file: 'C:\\Bar\\service.env',
    log_dir: path.join(path.dirname(stateFile), 'logs'),
    backup_dir: 'C:\\Bar\\backups',
    hourly_every_hours: 1,
    daily_at: '02:00',
    service_account: 'NT AUTHORITY\\LocalService',
    task_state: 'Ready',
    ...overrides
  }), 'utf8')
}

test('admin backup health reports an installed schedule honestly and warns it is not PITR', async () => {
  const f = fixture('installed')
  writeMarker(f.stateFile)
  writeFileSync(path.join(f.logs, 'backup.log'), '2026-10-29T07:00:00.000Z backup starting\n2026-10-29T07:00:09.000Z backup complete\n', 'utf8')
  const status = await buildAdminStatus(f.config, { query: statusQuery(), now: new Date('2026-10-29T08:00:00.000Z') })
  const backup = status.status.backup
  assert.equal(backup.schedule_installed, true)
  assert.equal(backup.schedule.health, 'never')
  assert.equal(backup.schedule.last_run_result, 'ok')
  assert.equal(backup.schedule.last_run_at, '2026-10-29T07:00:09.000Z')
  assert.equal(backup.schedule.task_name, 'BarLocalBackup')
  assert.equal(backup.schedule.pitr_available, false)
  assert.match(backup.schedule.warning, /not WAL archiving or point-in-time recovery/)
})

test('admin backup health fails closed when the last scheduled run failed', async () => {
  const f = fixture('failed')
  writeMarker(f.stateFile)
  writeFileSync(path.join(f.logs, 'backup.log'), '2026-10-29T07:00:00.000Z backup starting\n2026-10-29T07:00:09.000Z backup failed: destination unavailable\n', 'utf8')
  const status = await buildAdminStatus(f.config, { query: statusQuery(), now: new Date('2026-10-29T08:00:00.000Z') })
  assert.equal(status.status.backup.schedule.health, 'failed')
  assert.equal(status.status.backup.schedule.last_run_result, 'failed')
  assert.match(status.status.backup.schedule.last_run_message, /destination unavailable/)
})

test('admin backup health reports a missing or unreadable marker instead of pretending a schedule exists', async () => {
  const missing = fixture('missing')
  const missingStatus = await buildAdminStatus(missing.config, { query: statusQuery(), now: new Date('2026-10-29T08:00:00.000Z') })
  assert.equal(missingStatus.status.backup.schedule_installed, false)
  assert.equal(missingStatus.status.backup.schedule.health, 'schedule_missing')
  assert.match(missingStatus.status.backup.schedule.schedule_message, /No scheduled backup task|not installed/)

  const unreadable = fixture('unreadable')
  writeFileSync(unreadable.stateFile, '{not-json', 'utf8')
  const unreadableStatus = await buildAdminStatus(unreadable.config, { query: statusQuery(), now: new Date('2026-10-29T08:00:00.000Z') })
  assert.equal(unreadableStatus.status.backup.schedule_installed, false)
  assert.equal(unreadableStatus.status.backup.schedule.health, 'schedule_missing')
  assert.match(unreadableStatus.status.backup.schedule.schedule_message, /could not be read/)
})
