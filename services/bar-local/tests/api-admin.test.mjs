import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createApiHarness } from './api-harness.mjs'
import { sha256Text, TEST_SETUP_SECRET } from './harness.mjs'
import { connectionConfig, loadTarget } from '../scripts/lib/db-target.mjs'
import { listMigrations } from '../scripts/lib/migrate.mjs'

const { Client } = pg
const pgBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.local', 'pg17runtime', 'pgsql', 'bin')
const pgDump = path.join(pgBin, 'pg_dump.exe')
const backupDatabase = `bar_local_admin_backup_${process.pid}`

async function withMaintenance(action) {
  const target = loadTarget({ maintenance: true })
  const client = new Client(connectionConfig({ ...target, database: 'postgres', user: 'postgres' }))
  await client.connect()
  try {
    return await action(client)
  } finally {
    await client.end()
  }
}

test('admin HTTP routes enforce capability, expose honest status and create verifiable backups', async (t) => {
  const migrations = await listMigrations()
  const expectedSchemaVersion = Number(migrations.at(-1).slice(0, 4))
  assert.equal(existsSync(pgDump), true, `pg_dump not found at ${pgDump}`)
  const backupDir = mkdtempSync(path.join(os.tmpdir(), 'bar-local-admin-api-'))
  const backupCopyDir = mkdtempSync(path.join(os.tmpdir(), 'bar-local-admin-api-copy-'))
  const backupKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const previousBackupKey = process.env.BAR_LOCAL_BACKUP_KEY
  process.env.BAR_LOCAL_BACKUP_KEY = backupKey
  t.after(() => {
    if (previousBackupKey === undefined) delete process.env.BAR_LOCAL_BACKUP_KEY
    else process.env.BAR_LOCAL_BACKUP_KEY = previousBackupKey
  })

  await withMaintenance(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${backupDatabase} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${backupDatabase}`)
  })
  t.after(async () => {
    rmSync(backupDir, { recursive: true, force: true })
    rmSync(backupCopyDir, { recursive: true, force: true })
    await withMaintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${backupDatabase} WITH (FORCE)`)
    })
  })

  const backupClient = new Client(connectionConfig({
    host: '127.0.0.1',
    port: Number(process.env.BAR_LOCAL_DB_PORT),
    database: backupDatabase,
    user: 'postgres'
  }))
  await backupClient.connect()
  await backupClient.query('CREATE TABLE admin_backup_probe (id integer PRIMARY KEY, note text NOT NULL)')
  await backupClient.query("INSERT INTO admin_backup_probe VALUES (1, 'api admin backup')")
  await backupClient.end()

  const h = await createApiHarness(t, {
    env: {
      BAR_LOCAL_ADMIN_DATABASE_URL: `postgresql://postgres@127.0.0.1:${process.env.BAR_LOCAL_DB_PORT}/${backupDatabase}`,
      BAR_LOCAL_BACKUP_DIR: backupDir,
      BAR_LOCAL_BACKUP_COPY_TO: backupCopyDir,
      BAR_LOCAL_BACKUP_KEY: backupKey,
      BAR_LOCAL_BACKUP_RETENTION_HOURLY: '2',
      BAR_LOCAL_BACKUP_RETENTION_DAILY: '2',
      BAR_LOCAL_BACKUP_RETENTION_WEEKLY: '2',
      BAR_LOCAL_PG_DUMP: pgDump
    }
  })

  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Admin API Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner Admin',
      pin: '1234',
      device_name: 'Till Admin',
      device_platform: 'modern'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const deviceId = setup.body.device_id

  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { staff_id: setup.body.owner_staff_id, pin: '1234' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const ownerToken = login.body.session_token
  const auth = { token: ownerToken, deviceId }
  const adminGet = (route) => h.request(route, { method: 'GET', ...auth })

  const unauthenticated = await h.request('/v1/admin/status', { method: 'GET' })
  assert.equal(unauthenticated.status, 401)

  const limited = await h.migrator.query(
    `INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
     VALUES ($1, 'Limited Admin', 'cashier', ARRAY['pos.view'], 'unused', 'unused', 100000) RETURNING id`,
    [setup.body.business_id]
  )
  const limitedToken = `bls_${process.pid}_limited_admin`
  await h.migrator.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [
    limited.rows[0].id, deviceId, setup.body.outlet_id, sha256Text(limitedToken)
  ])
  const denied = await h.request('/v1/admin/status', { method: 'GET', token: limitedToken, deviceId })
  assert.equal(denied.status, 403)
  assert.equal(denied.body.code, 'CAPABILITY_DENIED')
  const deniedBackup = await h.request('/v1/admin/backup', { method: 'GET', token: limitedToken, deviceId })
  assert.equal(deniedBackup.status, 403)

  const status = await adminGet('/v1/admin/status')
  assert.equal(status.status, 200, JSON.stringify(status.body))
  assert.equal(status.body.ok, true)
  assert.equal(status.body.status.replication.role, 'primary')
  assert.equal(status.body.status.replication.replay_lag_bytes, null)
  assert.equal(status.body.status.replication.automatic_failover.verified, false)
  assert.equal(status.body.status.update.schema_version, expectedSchemaVersion)
  assert.equal(status.body.status.backup.key_configured, true)
  assert.equal(status.body.status.backup.destination, backupDir)
  assert.equal(status.body.status.backup.copy_destination, backupCopyDir)
  assert.equal(status.body.status.backup.copy_destination_status, 'available')
  assert.equal(status.body.status.database.reachable, true)

  const replication = await adminGet('/v1/admin/replication')
  assert.equal(replication.status, 200, JSON.stringify(replication.body))
  assert.equal(replication.body.replication.role, 'primary')
  assert.equal(replication.body.replication.replay_lag_bytes, null)
  assert.equal(replication.body.replication.caught_up_standbys, 0)
  assert.ok(replication.body.replication.limitations.some((value) => value.includes('automatic failover')))

  const update = await adminGet('/v1/admin/update')
  assert.equal(update.status, 200)
  assert.equal(update.body.schema_version, expectedSchemaVersion)
  assert.equal(update.body.status, 'idle')
  assert.equal(update.body.availability_checked, false)
  assert.equal(update.body.automatic_install_supported, false)
  assert.equal(update.body.apply_enabled, false)
  assert.deepEqual(update.body.inbox, [])
  assert.equal(update.body.trust.configured, false)
  assert.match(update.body.message, /No verified update package is staged/)

  const emptyList = await adminGet('/v1/admin/backup')
  assert.equal(emptyList.status, 200, JSON.stringify(emptyList.body))
  assert.equal(emptyList.body.configured, true)
  assert.deepEqual(emptyList.body.packages, [])
  assert.deepEqual(emptyList.body.copy_packages, [])
  assert.equal(emptyList.body.copy_destination_status, 'available')

  const created = await h.request('/v1/admin/backup', { ...auth, body: { label: 'API package' } })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.match(created.body.backup.file_name, /\.blb$/)
  assert.equal(created.body.backup.bytes > 0, true)
  assert.equal(created.body.source.database, backupDatabase)
  assert.equal(created.body.encryption.algorithm, 'aes-256-gcm')
  assert.equal(created.body.copy.directory, backupCopyDir)
  assert.equal(created.body.copy.already_present, false)

  const listed = await adminGet('/v1/admin/backup')
  assert.equal(listed.status, 200)
  assert.equal(listed.body.packages.length, 1)
  assert.equal(listed.body.packages[0].file_name, created.body.backup.file_name)
  assert.equal(listed.body.copy_packages.length, 1)
  assert.equal(listed.body.copy_packages[0].file_name, created.body.backup.file_name)

  const verified = await h.request('/v1/admin/backup/verify', {
    ...auth,
    body: { file_name: created.body.backup.file_name }
  })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.integrity_verified, true)
  assert.equal(verified.body.checksum_verified, true)
  assert.equal(verified.body.authenticated, true)
  assert.equal(verified.body.restore_verified, false)
  assert.equal(verified.body.file_name, created.body.backup.file_name)

  const traversal = await h.request('/v1/admin/backup/verify', { ...auth, body: { file_name: '../escape.blb' } })
  assert.equal(traversal.status, 400)
  assert.equal(traversal.body.code, 'VALIDATION_FAILED')

  const missing = await h.request('/v1/admin/backup/verify', { ...auth, body: { file_name: 'missing.blb' } })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'BACKUP_FILE_MISSING')

  const backupPath = path.join(backupDir, created.body.backup.file_name)
  const manifestPath = path.join(backupDir, listed.body.packages[0].manifest_name)
  const originalPackage = readFileSync(backupPath)
  const corruptedPackage = Buffer.from(originalPackage)
  corruptedPackage[Math.floor(corruptedPackage.length / 2)] ^= 1
  writeFileSync(backupPath, corruptedPackage)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.file.sha256 = createHash('sha256').update(corruptedPackage).digest('hex')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const unauthenticatedPackage = await h.request('/v1/admin/backup/verify', {
    ...auth,
    body: { file_name: created.body.backup.file_name }
  })
  assert.equal(unauthenticatedPackage.status, 409, JSON.stringify(unauthenticatedPackage.body))
  assert.equal(unauthenticatedPackage.body.code, 'BACKUP_DECRYPT_FAILED')

  const durability = await h.request('/v1/admin/replication/durability', {
    ...auth,
    body: { profile: 'synchronous_one_standby' }
  })
  assert.equal(durability.status, 409, JSON.stringify(durability.body))
  assert.equal(durability.body.code, 'REPLICATION_STANDBY_REQUIRED')

  const switchover = await h.request('/v1/admin/replication/switchover', {
    ...auth,
    body: { confirm: 'SWITCHOVER', reason: 'API fail-closed check' }
  })
  assert.equal(switchover.status, 409, JSON.stringify(switchover.body))
  assert.equal(switchover.body.code, 'COORDINATOR_UNVERIFIED')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'admin.%' ORDER BY action`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'admin.backup.create_started',
    'admin.backup.created',
    'admin.backup.verified',
    'admin.replication.durability_started',
    'admin.replication.switchover_started'
  ])
})
