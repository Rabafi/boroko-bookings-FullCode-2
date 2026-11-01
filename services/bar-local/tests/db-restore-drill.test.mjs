import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHarness } from './harness.mjs'
import { loadTarget } from '../scripts/lib/db-target.mjs'
import { loadConfig } from '../dist/config.js'
import { createEncryptedBackup, createPgDumpSpec, loadEncryptionKey } from '../dist/operations/backup.js'
import { runRestoreDrill } from '../dist/operations/restoreDrill.js'

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

/**
 * The drill reads the backup key from the service environment, exactly like the
 * running service does. The isolated test runner does not provide one, so this
 * test installs a key for its own duration and restores the prior value.
 */
function withBackupKey(t) {
  const previousKey = process.env.BAR_LOCAL_BACKUP_KEY
  const previousKeyFile = process.env.BAR_LOCAL_BACKUP_KEY_FILE
  delete process.env.BAR_LOCAL_BACKUP_KEY_FILE
  process.env.BAR_LOCAL_BACKUP_KEY = KEY
  t.after(() => {
    if (previousKey === undefined) delete process.env.BAR_LOCAL_BACKUP_KEY
    else process.env.BAR_LOCAL_BACKUP_KEY = previousKey
    if (previousKeyFile !== undefined) process.env.BAR_LOCAL_BACKUP_KEY_FILE = previousKeyFile
  })
}

test('a same-PC restore drill restores into a disposable cluster, verifies it and cleans up', async (t) => {
  await createHarness(t)
  withBackupKey(t)
  const target = loadTarget()
  const root = mkdtempSync(path.join(os.tmpdir(), 'bar-local-drill-'))
  const backupDir = path.join(root, 'backups')
  const drillRoot = path.join(root, 'drills')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config = loadConfig({
    ...process.env,
    BAR_LOCAL_BACKUP_DIR: backupDir,
    BAR_LOCAL_RESTORE_DRILL_DIR: drillRoot,
    BAR_LOCAL_BACKUP_KEY: KEY,
    BAR_LOCAL_ALLOW_TEST_DB: '1'
  })
  assert.equal(Boolean(config.backup.pgBin), true)
  assert.equal(existsSync(config.backup.pgInitdb), true)
  assert.equal(existsSync(config.backup.pgCtl), true)

  const dumpSpec = createPgDumpSpec({ ...target, user: process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator' }, { command: config.backup.pgDump })
  const env = { ...(dumpSpec.env ?? process.env) }
  for (const name of ['BAR_LOCAL_ADMIN_DATABASE_URL', 'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL', 'BAR_LOCAL_REPLICATION_PASSWORD', 'BAR_LOCAL_SETUP_SECRET']) delete env[name]
  const created = await createEncryptedBackup({
    target: { ...target, user: process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator' },
    destinationDir: backupDir,
    encryptionKey: loadEncryptionKey({ env: { BAR_LOCAL_BACKUP_KEY: KEY } }),
    label: 'restore drill source',
    command: { ...dumpSpec, env },
    allowTestDatabase: true,
    now: new Date()
  })

  const report = await runRestoreDrill({
    config,
    fileName: created.backup.file_name,
    authorizedBy: 'Owner Drill',
    reason: 'Verify the latest encrypted package on this PC'
  })
  assert.equal(report.ok, true)
  assert.equal(report.status, 'verified')
  assert.equal(report.checks.failed, 0)
  assert.equal(report.checks.total > 0, true)
  assert.equal(report.cleanup.cluster_stopped, true)
  assert.equal(report.cleanup.data_removed, true)
  assert.equal(report.pitr_available, false)
  assert.match(report.message, /not an off-site recovery or point-in-time recovery test/)
  assert.equal(existsSync(report.evidence_path), true)
  assert.deepEqual(readdirSync(drillRoot).filter((name) => name.startsWith('drill-')), [])
  assert.equal(existsSync(path.join(drillRoot, 'restore-drill.lock')), false)
})

test('a restore drill refuses to start while another drill lock is held', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bar-local-drill-lock-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const drillRoot = path.join(root, 'drills')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(drillRoot, { recursive: true })
  writeFileSync(path.join(drillRoot, 'restore-drill.lock'), '{"pid":1}', 'utf8')
  const config = loadConfig({
    ...process.env,
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups'),
    BAR_LOCAL_RESTORE_DRILL_DIR: drillRoot,
    BAR_LOCAL_BACKUP_KEY: KEY,
    BAR_LOCAL_ALLOW_TEST_DB: '1'
  })
  await assert.rejects(
    runRestoreDrill({ config, fileName: 'any.blbkup', authorizedBy: 'Owner Drill', reason: 'Verify the latest package' }),
    (error) => error?.code === 'RESTORE_DRILL_IN_PROGRESS'
  )
})
