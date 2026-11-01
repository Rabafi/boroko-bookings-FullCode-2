import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildAdminStatus } from '../dist/admin.js'
import { loadConfig } from '../dist/config.js'
import { enrollStandby, inspectReplication, setDurability, switchover } from '../dist/operations/replication.js'

function configFor(name, createBackupDirectory = true) {
  const root = path.join(os.tmpdir(), `bar-local-${name}-${process.pid}-${Date.now()}`)
  if (createBackupDirectory) mkdirSync(path.join(root, 'backups'), { recursive: true })
  return loadConfig({
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups'),
    BAR_LOCAL_BACKUP_RETENTION_HOURLY: '12',
    BAR_LOCAL_BACKUP_RETENTION_DAILY: '5',
    BAR_LOCAL_BACKUP_RETENTION_WEEKLY: '3'
  }, { root })
}

function statusQuery() {
  return async (sql) => {
    if (sql.includes('pg_is_in_recovery')) {
      return { rows: [{ in_recovery: false, receive_lsn: null, replay_lsn: null, last_replay: null }] }
    }
    if (sql.includes('current_setting')) {
      return { rows: [{ synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' }] }
    }
    if (sql.includes('pg_stat_replication')) {
      return {
        rows: [{
          application_name: 'standby-a',
          state: 'streaming',
          sync_state: 'sync',
          sent_lsn: '0/200',
          flush_lsn: '0/200',
          replay_lsn: '0/200',
          replay_lag_bytes: '0'
        }]
      }
    }
    if (sql.includes('pg_current_wal_lsn')) {
      return { rows: [{ current_lsn: '0/200', replay_lag_bytes: '0' }] }
    }
    if (sql.includes('service_admin_status')) {
      return { rows: [{ result: { schema_migration: '0040_admin_status_metadata', devices: { count: 3, active: 2 } } }] }
    }
    if (sql.includes('SELECT 1')) {
      return { rows: [{ reachable: 1 }] }
    }
    throw new Error(`Unexpected status SQL: ${sql}`)
  }
}

test('admin status reports honest replication, update and device shape', async () => {
  const config = configFor('status')
  const status = await buildAdminStatus(config, {
    query: statusQuery(),
    now: new Date('2026-10-22T10:00:00.000Z'),
    uptimeSeconds: 42
  })
  assert.equal(status.ok, true)
  const body = status.status
  assert.equal(body.service.uptime_seconds, 42)
  assert.equal(body.replication.role, 'primary')
  assert.equal(body.replication.replay_lag_bytes, null)
  assert.equal(body.replication.caught_up_standbys, 1)
  assert.equal(body.replication.automatic_failover.verified, false)
  assert.equal(body.network.role, 'single_host')
  assert.equal(body.database.reachable, true)
  assert.deepEqual(body.devices, { count: 3, active: 2 })
  assert.equal(body.update.schema_version, 40)
  assert.equal(body.update.schema_migration, '0040_admin_status_metadata')
  assert.equal(body.update.contract_version, 1)
  assert.equal(body.backup.destination, path.join(config.service.root, 'backups'))
  assert.deepEqual(body.backup.retention, { hourly: 12, daily: 5, weekly: 3 })
  assert.equal(body.backup.schedule_installed, false)
  assert.equal(body.backup.copy_destination_status, 'not_configured')
})

test('admin status fails closed when the database cannot be checked', async () => {
  const config = configFor('status-db-unavailable')
  await assert.rejects(
    buildAdminStatus(config, { query: async () => { throw new Error('connection refused') } }),
    (error) => error?.code === 'ADMIN_DATABASE_UNAVAILABLE' && error?.httpStatus === 503
  )
})

test('admin status labels a missing backup destination unavailable instead of empty', async () => {
  const config = configFor('status-backup-unavailable', false)
  const status = await buildAdminStatus(config, {
    query: statusQuery(),
    now: new Date('2026-10-22T10:00:00.000Z')
  })
  assert.equal(status.ok, true)
  assert.equal(status.status.backup.destination_status, 'unavailable')
  assert.equal(status.status.backup.destination_error, 'BACKUP_DIRECTORY_UNAVAILABLE')
  assert.equal(status.status.backup.latest, null)
})

test('admin status reports a configured secondary backup copy destination unavailable when it cannot be read', async () => {
  const root = path.join(os.tmpdir(), `bar-local-copy-status-${process.pid}-${Date.now()}`)
  mkdirSync(path.join(root, 'backups'), { recursive: true })
  const config = loadConfig({
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups'),
    BAR_LOCAL_BACKUP_COPY_TO: path.join(root, 'detached-copy')
  }, { root })
  const status = await buildAdminStatus(config, { query: statusQuery() })
  assert.equal(status.status.backup.copy_destination_status, 'unavailable')
  assert.equal(status.status.backup.copy_destination_error, 'BACKUP_DIRECTORY_UNAVAILABLE')
  assert.equal(status.status.backup.copy_latest, null)
})

test('backup copy destinations cannot overlap the primary backup or PostgreSQL data directories', () => {
  const root = path.join(os.tmpdir(), `bar-local-copy-config-${process.pid}-${Date.now()}`)
  const backupDir = path.join(root, 'backups')
  assert.throws(() => loadConfig({
    BAR_LOCAL_BACKUP_DIR: backupDir,
    BAR_LOCAL_BACKUP_COPY_TO: path.join(backupDir, 'copy')
  }, { root }), /must be separate directories with no nesting/)
  assert.throws(() => loadConfig({
    BAR_LOCAL_BACKUP_DIR: backupDir,
    BAR_LOCAL_PG_DATA_DIR: path.join(root, 'pgdata'),
    BAR_LOCAL_BACKUP_COPY_TO: path.join(root, 'pgdata', 'copy')
  }, { root }), /must be separate directories with no nesting/)
})

test('backup directory separation resolves Windows junctions before comparing paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), `bar-local-copy-junction-${process.pid}-`))
  const backupDir = path.join(root, 'backups')
  const aliasDir = path.join(root, 'backup-alias')
  mkdirSync(backupDir, { recursive: true })
  symlinkSync(backupDir, aliasDir, 'junction')
  assert.throws(() => loadConfig({
    BAR_LOCAL_BACKUP_DIR: backupDir,
    BAR_LOCAL_BACKUP_COPY_TO: path.join(aliasDir, 'nested-copy')
  }, { root }), /must be separate directories with no nesting/)
})

function clientWith(handler) {
  return {
    query: async (sql, params) => handler(sql, params),
    end: async () => undefined
  }
}

test('replication inspection never claims unverified automatic failover', async () => {
  const config = configFor('inspect')
  const report = await inspectReplication({ query: statusQuery() }, { ...config.replication, coordinator: 'automatic' })
  assert.equal(report.role, 'primary')
  assert.equal(report.automatic_failover.verified, false)
  assert.ok(report.limitations.some((value) => value.includes('automatic failover remains unverified')))
})

test('synchronous one-standby durability refuses to downgrade without a standby', async () => {
  const config = configFor('durability')
  const statements = []
  const client = clientWith(async (sql) => {
    statements.push(sql)
    if (sql.includes('pg_is_in_recovery')) {
      return { rows: [{ in_recovery: false, receive_lsn: null, replay_lsn: null, last_replay: null }] }
    }
    if (sql.includes('current_setting')) {
      return { rows: [{ synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' }] }
    }
    if (sql.includes('pg_stat_replication')) {
      return { rows: [] }
    }
    throw new Error(`Unexpected durability SQL: ${sql}`)
  })
  await assert.rejects(
    setDurability({ ...config.replication, adminDatabaseUrl: 'postgresql://bar_local_runtime@127.0.0.1:5432/bar_local' }, 'synchronous_one_standby', {
      connect: async () => client
    }),
    (error) => error?.code === 'REPLICATION_STANDBY_REQUIRED'
  )
  assert.equal(statements.some((sql) => /ALTER SYSTEM/i.test(sql)), false)
})

function switchoverSettings() {
  return {
    role: 'single_host',
    coordinator: 'manual',
    adminDatabaseUrl: 'postgresql://bar_local_runtime@127.0.0.1:5432/bar_local',
    standbyAdminDatabaseUrl: 'postgresql://bar_local_runtime@127.0.0.1:5433/bar_local',
    pgDataDir: '',
    pgBin: null,
    pgDump: 'pg_dump',
    pgRestore: 'pg_restore'
  }
}

function switchoverClients(options = {}) {
  const order = []
  let promoted = false
  const primary = clientWith(async (sql) => {
    if (sql.includes('pg_control_system')) return { rows: [{ id: '123456789' }] }
    if (sql.includes('FROM bar_local.authority WHERE singleton')) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', epoch: '1' }] }
    if (sql.includes('pg_prepared_xacts')) return { rows: [{ count: 0 }] }
    if (sql.includes('SELECT rolcanlogin')) return { rows: [{ rolcanlogin: false }] }
    if (sql.includes('authority_fenced()')) return { rows: [{ fenced: true }] }
    if (sql.includes('service_failover_fence') || sql.includes('ALTER ROLE')) { order.push(`primary:${sql}`); return { rows: [{}] } }
    if (sql.includes('$1::pg_lsn')) return { rows: [{ lag_bytes: '0' }] }
    if (sql.includes("current_setting('default_transaction_read_only')")) {
      return { rows: [{ read_only: options.fenceFails ? 'off' : 'on' }] }
    }
    if (sql.includes('pg_is_in_recovery')) {
      return { rows: [{ in_recovery: false, receive_lsn: null, replay_lsn: null, last_replay: null }] }
    }
    if (sql.includes('current_setting')) {
      return { rows: [{ synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' }] }
    }
    if (sql.includes('pg_stat_replication')) {
      return {
        rows: [{
          application_name: 'standby-a',
          state: 'streaming',
          sync_state: 'sync',
          sent_lsn: '0/200',
          flush_lsn: '0/200',
          replay_lsn: '0/200',
          replay_lag_bytes: '0'
        }]
      }
    }
    if (sql.includes('pg_current_wal_lsn')) {
      return { rows: [{ current_lsn: '0/200', lsn: '0/200', replay_lag_bytes: '0' }] }
    }
    if (sql.includes('count(*)::int AS writers')) return { rows: [{ writers: 0 }] }
    if (/ALTER SYSTEM|ALTER DATABASE|pg_reload_conf|pg_terminate_backend/.test(sql)) {
      order.push(`primary:${sql}`)
      return { rows: [{}] }
    }
    throw new Error(`Unexpected primary SQL: ${sql}`)
  })
  const standby = clientWith(async (sql) => {
    if (sql.includes('pg_control_system')) return { rows: [{ id: options.wrongCluster ? '987654321' : '123456789' }] }
    if (sql.includes('service_failover_promote')) { order.push('standby:advance_epoch'); return { rows: [{ result: { authority_epoch: 2 } }] } }
    if (sql.includes('ALTER ROLE') || sql.includes('SET default_transaction_read_only')) { order.push(`standby:${sql}`); return { rows: [{}] } }
    if (sql.includes('pg_stat_wal_receiver')) return { rows: [{ status: 'streaming' }] }
    if (sql.includes("current_setting('default_transaction_read_only')")) {
      return { rows: [{ read_only: options.promotionFails && promoted ? 'on' : 'off' }] }
    }
    if (sql.includes('pg_is_in_recovery')) {
      return { rows: [{ in_recovery: !promoted, receive_lsn: '0/200', replay_lsn: '0/200', last_replay: null }] }
    }
    if (sql.includes('current_setting')) {
      return { rows: [{ synchronous_commit: 'on', synchronous_standby_names: options.standbyMismatch ? '' : 'ANY 1 (*)' }] }
    }
    if (sql.includes('pg_wal_lsn_diff') && !sql.includes('$1::pg_lsn')) {
      return { rows: [{ replay_lsn: '0/200', replay_lag_bytes: '0' }] }
    }
    if (sql.includes('pg_promote')) {
      order.push('standby:pg_promote')
      promoted = true
      return { rows: [{ promoted: true }] }
    }
    if (sql.includes('pg_current_wal_lsn')) {
      return { rows: [{ lsn: '0/300' }] }
    }
    if (/ALTER SYSTEM|ALTER DATABASE|pg_reload_conf|SET synchronous_commit/.test(sql)) {
      order.push(`standby:${sql}`)
      return { rows: [{}] }
    }
    throw new Error(`Unexpected standby SQL: ${sql}`)
  })
  return {
    order,
    connect: async (url) => (url.includes(':5433') ? standby : primary)
  }
}

test('switchover fences the primary before promoting the standby', async () => {
  const clients = switchoverClients()
  const report = await switchover(switchoverSettings(), {
    connect: clients.connect,
    sleep: async () => undefined,
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    catchupTimeoutMs: 1000,
    promoteTimeoutSeconds: 5
  })
  assert.equal(report.ok, true)
  assert.equal(report.authority_state, 'promoted')
  assert.equal(report.client_repoint_required, true)
  assert.equal(report.fenced?.verified, true)
  assert.equal(report.promoted?.verified, true)
  const promoteIndex = clients.order.findIndex((entry) => entry === 'standby:pg_promote')
  const fenceIndexes = clients.order
    .map((entry, index) => (/ALTER SYSTEM SET default_transaction_read_only = on|pg_terminate_backend/.test(entry) ? index : -1))
    .filter((index) => index >= 0)
  assert.ok(promoteIndex > Math.max(...fenceIndexes))
  assert.ok(clients.order.findIndex(entry => entry.includes('NOLOGIN')) < promoteIndex)
  assert.ok(clients.order.findIndex(entry => entry.includes('service_failover_fence')) < promoteIndex)
  assert.ok(clients.order.indexOf('standby:advance_epoch') > promoteIndex)
  assert.ok(clients.order.findIndex(entry => entry === 'standby:ALTER ROLE bar_local_runtime LOGIN') > clients.order.indexOf('standby:advance_epoch'))
})

test('replacement refuses an unrelated physical cluster before fencing either host', async () => {
  const clients = switchoverClients({ wrongCluster: true })
  await assert.rejects(switchover(switchoverSettings(), { connect: clients.connect }), error => error.code === 'REPLICATION_ROLE_UNVERIFIED')
  assert.deepEqual(clients.order, [])
})

test('switchover reports irreversible promotion even when post-promotion configuration fails', async () => {
  const clients = switchoverClients({ promotionFails: true })
  const report = await switchover(switchoverSettings(), {
    connect: clients.connect,
    sleep: async () => undefined,
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    catchupTimeoutMs: 1000,
    promoteTimeoutSeconds: 5
  })
  assert.equal(report.ok, false)
  assert.equal(report.authority_state, 'promoted')
  assert.equal(report.client_repoint_required, true)
  assert.equal(report.fenced?.verified, true)
  assert.equal(report.promoted?.verified, true)
  assert.equal(report.error?.code, 'REPLICATION_PROMOTION_FAILED')
  assert.ok(clients.order.some((entry) => entry.includes('pg_terminate_backend')))
})

test('switchover refuses a candidate whose local durability configuration would downgrade writes', async () => {
  const clients = switchoverClients({ standbyMismatch: true })
  await assert.rejects(switchover(switchoverSettings(), { connect: clients.connect }),
    (error) => error.code === 'REPLICATION_DURABILITY_FAILED')
  assert.equal(clients.order.length, 0, 'refusal must happen before primary fencing or promotion')
})

test('switchover refuses to promote when primary fencing cannot be verified', async () => {
  const clients = switchoverClients({ fenceFails: true })
  const report = await switchover(switchoverSettings(), {
    connect: clients.connect,
    sleep: async () => undefined,
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    catchupTimeoutMs: 1000,
    promoteTimeoutSeconds: 5,
    fenceTimeoutMs: 0
  })
  assert.equal(report.ok, false)
  assert.equal(report.authority_state, 'fence_failed')
  assert.equal(report.client_repoint_required, false)
  assert.equal(report.fenced, null)
  assert.equal(report.promoted, null)
  assert.equal(report.error?.code, 'REPLICATION_FENCE_FAILED')
  assert.equal(clients.order.includes('standby:pg_promote'), false)
})

test('switchover fails closed on an unverified coordinator before connecting', async () => {
  let connections = 0
  await assert.rejects(
    switchover({ ...switchoverSettings(), coordinator: 'automatic' }, {
      connect: async () => {
        connections += 1
        throw new Error('must not connect')
      }
    }),
    (error) => error?.code === 'COORDINATOR_UNVERIFIED'
  )
  assert.equal(connections, 0)
})

test('standby enrollment refuses public primaries, non-empty directories and missing confirmation', async () => {
  let commands = 0
  const runCommand = async () => {
    commands += 1
    return { exit_code: 0, stderr: '' }
  }
  const base = {
    standbyDataDir: path.join(os.tmpdir(), `bar-local-enroll-${process.pid}-${Date.now()}`),
    primaryPort: 5432,
    replicationUser: 'bar_local_replicator',
    standbyDatabaseUrl: 'postgresql://bar_local_runtime@127.0.0.1:5433/bar_local',
    confirm: true
  }
  await assert.rejects(
    enrollStandby({ ...base, primaryHost: '8.8.8.8' }, { pgBin: null }, { runCommand }),
    (error) => error?.code === 'REPLICATION_PRIMARY_HOST_REFUSED'
  )
  const occupied = mkdtempSync(path.join(os.tmpdir(), 'bar-local-enroll-occupied-'))
  writeFileSync(path.join(occupied, 'PG_VERSION'), '17\n')
  await assert.rejects(
    enrollStandby({ ...base, standbyDataDir: occupied, primaryHost: '127.0.0.1' }, { pgBin: null }, { runCommand }),
    (error) => error?.code === 'REPLICATION_DATA_DIR_NOT_EMPTY'
  )
  await assert.rejects(
    enrollStandby({ ...base, primaryHost: '127.0.0.1', confirm: false }, { pgBin: null }, { runCommand }),
    (error) => error?.code === 'REPLICATION_CONFIRMATION_REQUIRED'
  )
  assert.equal(commands, 0)
})

test('standby enrollment runs pg_basebackup, pg_ctl and streaming verification in order', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'bar-local-enroll-order-'))
  const commands = []
  const runCommand = async (command, args) => {
    commands.push({ command, args })
    return { exit_code: 0, stderr: '' }
  }
  const standby = {
    query: async (sql) => {
      if (sql.includes('pg_is_in_recovery')) return { rows: [{ in_recovery: true }] }
      if (sql.includes('pg_stat_wal_receiver')) return { rows: [{ status: 'streaming' }] }
      throw new Error(`Unexpected enroll SQL: ${sql}`)
    },
    end: async () => undefined
  }
  const report = await enrollStandby({
    standbyDataDir: dataDir,
    primaryHost: '127.0.0.1',
    primaryPort: 5432,
    replicationUser: 'bar_local_replicator',
    standbyDatabaseUrl: 'postgresql://bar_local_runtime@127.0.0.1:5433/bar_local',
    confirm: true,
    timeoutMs: 5000
  }, { pgBin: null }, {
    runCommand,
    connect: async () => standby,
    sleep: async () => undefined
  })
  assert.equal(report.ok, true)
  assert.equal(report.streaming_verified, true)
  assert.equal(commands.length, 2)
  assert.match(commands[0].command, /pg_basebackup/)
  assert.ok(commands[0].args.includes('-R'))
  assert.ok(commands[0].args.includes('--checkpoint=fast'))
  assert.match(commands[1].command, /pg_ctl/)
  assert.ok(commands[1].args.includes('start'))
})
