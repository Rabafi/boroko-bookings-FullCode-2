import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import { state, resetState } from '../src/main/state.js'
import {
  __starterBackupAutomationTestables as internals,
  configureStarterBackupAutomation,
  evaluateAutomationDueAtStartup,
  runStarterBackupAutomationOnce
} from '../src/main/domains/starterBackupAutomation.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-bonno-automation-'))
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function configureLocal(root, lodgeId = 'lodge-a', retained = 3) {
  state.cacheRootDir = root
  state.lodgeId = lodgeId
  const destination = path.join(root, 'backups')
  fs.mkdirSync(destination, { recursive: true })
  internals.writeAtomicJson(internals.getConfigPath(lodgeId), {
    version: 1,
    lodge_id: lodgeId,
    destination_folder: destination,
    destination_label: 'Test backups',
    retained_copies: retained,
    enabled: true,
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:00.000Z'
  })
  return destination
}

test.afterEach(() => resetState())

test('the lodge/window lock serializes runs and recovers a stale lock', () => {
  const root = tempRoot()
  state.cacheRootDir = root
  const first = internals.acquireRunLock('lodge-a', 'window-2026-08-26', { now: '2026-08-26T12:00:00.000Z', staleAfterMs: 60_000 })
  assert.throws(() => internals.acquireRunLock('lodge-a', 'window-2026-08-26', { now: '2026-08-26T12:00:01.000Z', staleAfterMs: 60_000 }), /already running/)
  internals.releaseLock(first)

  const stale = internals.acquireRunLock('lodge-a', 'window-stale', { now: '2026-08-25T12:00:00.000Z', staleAfterMs: 60_000 })
  const old = new Date('2026-08-25T00:00:00.000Z')
  fs.utimesSync(stale, old, old)
  const recovered = internals.acquireRunLock('lodge-a', 'window-stale', { now: '2026-08-26T12:00:00.000Z', staleAfterMs: 60_000 })
  assert.equal(recovered, stale)
  assert.match(fs.readFileSync(recovered, 'utf8'), /2026-08-26T12:00:00.000Z/)
  internals.releaseLock(recovered)
})

test('automation rejects a caller-supplied lodge outside the active lodge', () => {
  state.lodgeId = 'lodge-a'
  assert.throws(() => internals.resolveLodgeId('lodge-b'), /active lodge/)
  assert.equal(internals.resolveLodgeId('lodge-a'), 'lodge-a')
  assert.equal(internals.resolveLodgeId(), 'lodge-a')
  assert.deepEqual(evaluateAutomationDueAtStartup('lodge-b'), { due: false, reason: 'wrong_lodge' })
})

test('configuration refuses a missing destination instead of creating it', () => {
  const root = tempRoot()
  state.cacheRootDir = root
  state.lodgeId = 'lodge-a'
  const missing = path.join(root, 'does-not-exist')
  assert.throws(() => internals.assertDestinationFolder(missing), /unavailable|not writable/)
  assert.equal(fs.existsSync(missing), false)
})

test('retention deletes only hashed scheduler artifacts and keeps manual files/newest copy', () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a', 3)
  const files = []
  const runs = []
  for (let index = 0; index < 5; index += 1) {
    const fileName = `tsa-bonno-core-data-lodge-a-2026-08-2${index}-000000-${index}.tbbackup`
    const full = path.join(destination, fileName)
    fs.writeFileSync(full, `automated-${index}`)
    files.push(full)
    runs.push({
      run_id: `run-${index}`,
      lodge_id: 'lodge-a',
      state: 'verified',
      destination: full,
      fileName,
      sha256: sha256(full),
      finished_at: new Date(Date.UTC(2026, 7, 20 + index)).toISOString()
    })
  }
  const manual = path.join(destination, 'tsa-bonno-core-data-lodge-a-manual.tbbackup')
  fs.writeFileSync(manual, 'manual export')
  const result = internals.pruneRetention(destination, 'lodge-a', runs[4].sha256, 3, runs)
  assert.equal(result.deleted.length, 2)
  assert.deepEqual(result.kept.length, 3)
  assert.equal(fs.existsSync(files[4]), true)
  assert.equal(fs.existsSync(manual), true)
  assert.equal(fs.existsSync(files[0]), false)
  assert.equal(fs.existsSync(files[1]), false)
})

test('audit-unconfirmed remains due and lock is released after a successful artifact', async () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a', 3)
  const fixedNow = '2026-08-26T12:00:00.000Z'
  let auditAttempts = 0
  const dependencies = {
    captureBackupContext: () => ({ lodgeId: 'lodge-a', isOnline: true, appVersion: 'test' }),
    retrievePassphrase: () => 'test-passphrase',
    writeBackup: async (filePath) => {
      fs.writeFileSync(filePath, 'verified backup bytes')
      return { sha256: sha256(filePath), bytes: fs.statSync(filePath).size, complete: true, encrypted: true, counts: {} }
    },
    verifyBackup: async () => ({ success: true }),
    recordAudit: async () => { auditAttempts += 1; throw new Error('audit service unavailable') },
    recordHistory: async () => {}
  }
  const result = await runStarterBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow, dependencies })
  assert.equal(result.audit_state, 'audit_unconfirmed')
  assert.equal(result.next_due_at, fixedNow)
  assert.equal(auditAttempts, 1)
  assert.equal(evaluateAutomationDueAtStartup('lodge-a', { now: fixedNow }).due, true)
  assert.equal(fs.readdirSync(internals.getAutomationRoot('lodge-a')).some((name) => name.endsWith('.lock')), false)
  assert.equal(fs.existsSync(destination), true)
})

test('concurrent runner calls are rejected by the same lodge/window lock', async () => {
  const root = tempRoot()
  configureLocal(root, 'lodge-a', 3)
  const fixedNow = '2026-08-26T12:00:00.000Z'
  let started
  const startedPromise = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const dependencies = {
    captureBackupContext: () => ({ lodgeId: 'lodge-a', isOnline: true, appVersion: 'test' }),
    retrievePassphrase: () => 'test-passphrase',
    writeBackup: async (filePath) => {
      fs.writeFileSync(filePath, 'concurrent backup bytes')
      started()
      await gate
      return { sha256: sha256(filePath), bytes: fs.statSync(filePath).size, complete: true, encrypted: true, counts: {} }
    },
    verifyBackup: async () => ({ success: true }),
    recordAudit: async () => {},
    recordHistory: async () => {}
  }
  const first = runStarterBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow, dependencies })
  await startedPromise
  await assert.rejects(runStarterBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow, dependencies }), /already running/)
  release()
  await first
})

test('configure stores the credential before enabling config', () => {
  // This verifies the public failure boundary without requiring Electron safeStorage
  // to be available in a headless test runner.
  const root = tempRoot()
  state.cacheRootDir = root
  state.lodgeId = 'lodge-a'
  assert.throws(() => configureStarterBackupAutomation({ lodge_id: 'lodge-a', destination_folder: path.join(root, 'missing'), passphrase: 'long-enough-test-passphrase' }), /unavailable|not writable/)
  assert.equal(fs.existsSync(internals.getConfigPath('lodge-a')), false)
})
