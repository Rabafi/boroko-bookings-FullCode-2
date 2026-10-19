import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import { state, resetState } from '../src/main/state.js'
import {
  __barTradingBackupAutomationTestables as internals,
  configureBarTradingBackupAutomation,
  disableBarTradingBackupAutomation,
  snoozeBarTradingBackupAutomation,
  clearBarTradingBackupAutomationSnooze,
  getBarTradingBackupAutomationStatus,
  evaluateBarTradingBackupAutomationDueAtStartup,
  runBarTradingBackupAutomationOnce
} from '../src/main/domains/barTradingBackupAutomation.js'

const PASS = 'correct horse battery staple'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-bonno-trading-automation-'))
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function configureLocal(root, lodgeId = 'lodge-a', overrides = {}) {
  state.cacheRootDir = root
  state.lodgeId = lodgeId
  const destination = overrides.destination || path.join(root, 'trading-backups')
  fs.mkdirSync(destination, { recursive: true })
  internals.writeAtomicJson(internals.getConfigPath(lodgeId), {
    version: 1,
    lodge_id: lodgeId,
    destination_folder: destination,
    destination_label: 'Test trading backups',
    interval_hours: overrides.interval_hours || 24,
    retention_hourly: overrides.retention_hourly || 24,
    retention_daily: overrides.retention_daily || 7,
    retention_weekly: overrides.retention_weekly || 4,
    enabled: true,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z'
  })
  return destination
}

function seedCache(cacheDir, name, content) {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, name), content)
}

function fakeSnapshot(lodgeId, overrides = {}) {
  return {
    schema: 'tsa-bonno-bar-trading-snapshot/v1',
    lodge_id: lodgeId,
    captured_at: '2026-10-17T12:00:00.000Z',
    complete: true,
    warnings: [],
    missing: [],
    drift: [],
    unresolved: { count: 0, digest: 'x', identities: [], by_store: {} },
    withheld: {},
    stores: {},
    renderer_state: { captured: true, expected: true, store: 'renderer-durable-state.json' },
    recovery_limits: [],
    ...overrides
  }
}

function fakeWriter(record = {}) {
  return (filePath, snapshot) => {
    fs.writeFileSync(filePath, `artifact:${path.basename(filePath)}`)
    record.writes = (record.writes || 0) + 1
    return {
      success: true,
      destination: filePath,
      fileName: path.basename(filePath),
      sha256: sha256(filePath),
      lodgeId: snapshot.lodge_id,
      complete: snapshot.complete === true,
      unresolvedCount: snapshot.unresolved?.count || 0
    }
  }
}

test.afterEach(() => resetState())

test('the lodge/window lock serializes runs and recovers a stale lock', () => {
  const root = tempRoot()
  state.cacheRootDir = root
  const first = internals.acquireRunLock('lodge-a', 'window-2026-10-17T12', { now: '2026-10-17T12:00:00.000Z', staleAfterMs: 60_000 })
  assert.throws(() => internals.acquireRunLock('lodge-a', 'window-2026-10-17T12', { now: '2026-10-17T12:00:01.000Z', staleAfterMs: 60_000 }), /already running/)
  internals.releaseLock(first)

  const stale = internals.acquireRunLock('lodge-a', 'window-stale', { now: '2026-10-17T12:00:00.000Z', staleAfterMs: 60_000 })
  const old = new Date('2026-10-16T00:00:00.000Z')
  fs.utimesSync(stale, old, old)
  const recovered = internals.acquireRunLock('lodge-a', 'window-stale', { now: '2026-10-17T12:00:00.000Z', staleAfterMs: 60_000 })
  assert.equal(recovered, stale)
  assert.match(fs.readFileSync(recovered, 'utf8'), /2026-10-17T12:00:00.000Z/)
  internals.releaseLock(recovered)
})

test('automation rejects a caller-supplied lodge outside the active lodge and a missing destination', () => {
  const root = tempRoot()
  state.cacheRootDir = root
  state.lodgeId = 'lodge-a'
  assert.throws(() => internals.resolveLodgeId('lodge-b'), /active lodge/)
  assert.equal(internals.resolveLodgeId('lodge-a'), 'lodge-a')
  assert.deepEqual(evaluateBarTradingBackupAutomationDueAtStartup('lodge-b'), { due: false, reason: 'wrong_lodge' })
  const missing = path.join(root, 'does-not-exist')
  assert.throws(() => internals.assertDestinationFolder(missing), /unavailable|not writable/)
  assert.equal(fs.existsSync(missing), false)
})

test('configuration fails closed without OS secure storage and never enables a config without a credential', () => {
  const root = tempRoot()
  state.cacheRootDir = root
  state.lodgeId = 'lodge-a'
  const destination = path.join(root, 'backups')
  fs.mkdirSync(destination, { recursive: true })
  // Headless test runner: safeStorage is unavailable, so configuration must
  // refuse rather than persist a passphrase it cannot protect.
  assert.throws(
    () => configureBarTradingBackupAutomation({ lodge_id: 'lodge-a', destination_folder: destination, passphrase: PASS }),
    /secure storage is unavailable/i
  )
  assert.equal(fs.existsSync(internals.getConfigPath('lodge-a')), false)
  assert.equal(fs.existsSync(internals.getCredentialPath('lodge-a')), false)
})

test('an unlocked run captures stores, verifies the archive, records status and becomes not-yet-due', async () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a')
  const cacheDir = path.join(root, 'cache')
  seedCache(cacheDir, 'sync-queue.json', JSON.stringify([{ id: 'q1', operation: 'pos_create_order' }]))
  seedCache(cacheDir, 'pos-submit-attempts.json', JSON.stringify({ 'attempt-1': { status: 'pending' } }))
  state.cacheDir = cacheDir
  const fixedNow = '2026-10-17T12:00:00.000Z'
  const result = await runBarTradingBackupAutomationOnce({
    lodgeId: 'lodge-a',
    force: true,
    now: fixedNow,
    isOnline: true,
    appVersion: 'test',
    dependencies: {
      retrievePassphrase: () => PASS,
      collectRendererState: () => ({ drafts: { 'hpos-basket-draft:x': '{"lines":[]}' } })
    }
  })
  assert.equal(result.success, true)
  assert.equal(result.complete, true)
  assert.equal(result.unresolved_count >= 1, true)
  assert.equal(result.captured_offline, false)
  assert.equal(fs.existsSync(result.destination), true)
  assert.equal(path.extname(result.destination), '.tbtrading')
  assert.equal(result.sha256, sha256(result.destination))
  const status = getBarTradingBackupAutomationStatus('lodge-a', { now: '2026-10-17T12:00:30.000Z' })
  assert.equal(status.status.state, 'current')
  assert.equal(status.status.last_complete, true)
  assert.equal(status.status.last_success_sha256, result.sha256)
  assert.equal(status.status.next_due_at, '2026-10-18T12:00:00.000Z')
  assert.equal(status.latest_run.state, 'verified')
  assert.equal(evaluateBarTradingBackupAutomationDueAtStartup('lodge-a', { now: '2026-10-17T12:00:30.000Z' }).due, false)
  assert.equal(evaluateBarTradingBackupAutomationDueAtStartup('lodge-a', { now: '2026-10-18T12:00:01.000Z' }).due, true)
  assert.equal(fs.readdirSync(internals.getAutomationRoot('lodge-a')).some((name) => name.endsWith('.lock')), false)
})

test('a missing renderer seam produces a disclosed incomplete archive instead of a silent complete claim', async () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a')
  const cacheDir = path.join(root, 'cache')
  seedCache(cacheDir, 'sync-queue.json', '[]')
  state.cacheDir = cacheDir
  const result = await runBarTradingBackupAutomationOnce({
    lodgeId: 'lodge-a',
    force: true,
    now: '2026-10-17T12:00:00.000Z',
    isOnline: true,
    dependencies: { retrievePassphrase: () => PASS }
  })
  assert.equal(result.success, true)
  assert.equal(result.complete, false)
  const status = getBarTradingBackupAutomationStatus('lodge-a')
  assert.equal(status.status.last_complete, false)
  assert.equal(status.health.state, 'current')
  assert.equal(status.health.warnings.some((warning) => /incomplete/i.test(warning)), true)
  assert.equal(fs.existsSync(destination), true)
})

test('permanent drift fails the window closed, records a retryable failure, and leaves no artifact', async () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a')
  state.cacheDir = path.join(root, 'cache')
  fs.mkdirSync(state.cacheDir, { recursive: true })
  const fixedNow = '2026-10-17T12:00:00.000Z'
  await assert.rejects(
    runBarTradingBackupAutomationOnce({
      lodgeId: 'lodge-a',
      force: true,
      now: fixedNow,
      dependencies: {
        retrievePassphrase: () => PASS,
        buildSnapshot: () => fakeSnapshot('lodge-a', { drift: ['sync-queue'], complete: false })
      }
    }),
    /not coherent/
  )
  const status = getBarTradingBackupAutomationStatus('lodge-a', { now: fixedNow })
  assert.equal(status.status.state, 'due')
  assert.match(status.status.last_failure_reason, /not coherent/)
  assert.equal(status.latest_run.state, 'failed')
  assert.equal(fs.readdirSync(destination).filter((name) => name.endsWith('.tbtrading')).length, 0)
  assert.equal(fs.readdirSync(internals.getAutomationRoot('lodge-a')).some((name) => name.endsWith('.lock')), false)
})

test('transient drift is retried once with a fresh snapshot before succeeding', async () => {
  const root = tempRoot()
  configureLocal(root, 'lodge-a')
  state.cacheDir = path.join(root, 'cache')
  fs.mkdirSync(state.cacheDir, { recursive: true })
  let calls = 0
  const result = await runBarTradingBackupAutomationOnce({
    lodgeId: 'lodge-a',
    force: true,
    now: '2026-10-17T12:00:00.000Z',
    dependencies: {
      retrievePassphrase: () => PASS,
      buildSnapshot: () => {
        calls += 1
        return calls === 1 ? fakeSnapshot('lodge-a', { drift: ['sync-queue'], complete: false }) : fakeSnapshot('lodge-a')
      },
      writePackage: fakeWriter()
    }
  })
  assert.equal(calls, 2)
  assert.equal(result.success, true)
})

test('a write failure keeps the failure visible and retryable and releases the lock', async () => {
  const root = tempRoot()
  configureLocal(root, 'lodge-a')
  state.cacheDir = path.join(root, 'cache')
  fs.mkdirSync(state.cacheDir, { recursive: true })
  const fixedNow = '2026-10-17T12:00:00.000Z'
  await assert.rejects(
    runBarTradingBackupAutomationOnce({
      lodgeId: 'lodge-a',
      force: true,
      now: fixedNow,
      dependencies: {
        retrievePassphrase: () => PASS,
        buildSnapshot: () => fakeSnapshot('lodge-a'),
        writePackage: () => { throw new Error('EACCES: the destination disappeared during the write') }
      }
    }),
    /EACCES/
  )
  const status = getBarTradingBackupAutomationStatus('lodge-a', { now: fixedNow })
  assert.equal(status.status.state, 'due')
  assert.equal(status.status.next_due_at, fixedNow)
  assert.match(status.status.last_failure_reason, /EACCES/)
  assert.equal(fs.readdirSync(internals.getAutomationRoot('lodge-a')).some((name) => name.endsWith('.lock')), false)
})

test('snooze and disable gate runs, and a missing credential fails closed when enabled', async () => {
  const root = tempRoot()
  configureLocal(root, 'lodge-a')
  state.cacheDir = path.join(root, 'cache')
  fs.mkdirSync(state.cacheDir, { recursive: true })
  const fixedNow = '2026-10-17T12:00:00.000Z'
  snoozeBarTradingBackupAutomation('lodge-a', { now: fixedNow })
  await assert.rejects(
    runBarTradingBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow, dependencies: { retrievePassphrase: () => PASS } }),
    /snoozed/
  )
  assert.equal(evaluateBarTradingBackupAutomationDueAtStartup('lodge-a', { now: fixedNow }).reason, 'snoozed')
  clearBarTradingBackupAutomationSnooze('lodge-a')
  // Enabled config but no credential and no injected passphrase: safeStorage is
  // unavailable in the headless runner, so the run must fail closed.
  await assert.rejects(
    runBarTradingBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow }),
    /secure storage is unavailable/i
  )
  disableBarTradingBackupAutomation('lodge-a')
  assert.equal(getBarTradingBackupAutomationStatus('lodge-a').enabled, false)
  await assert.rejects(
    runBarTradingBackupAutomationOnce({ lodgeId: 'lodge-a', force: true, now: fixedNow, dependencies: { retrievePassphrase: () => PASS } }),
    /not enabled/
  )
})

test('retention keeps the newest verified generation and the only copy of unresolved work', async () => {
  const root = tempRoot()
  const destination = configureLocal(root, 'lodge-a', { retention_hourly: 1, retention_daily: 1, retention_weekly: 1 })
  state.cacheDir = path.join(root, 'cache')
  fs.mkdirSync(state.cacheDir, { recursive: true })
  const seededRuns = []
  const seededFiles = []
  for (let index = 0; index < 4; index += 1) {
    const fileName = `tsa-bonno-bar-trading-lodge-a-2026-10-17T10-0${index}-00-000${index}.tbtrading`
    const full = path.join(destination, fileName)
    fs.writeFileSync(full, `seeded-${index}`)
    seededFiles.push(full)
    seededRuns.push({
      run_id: `seed-${index}`,
      lodge_id: 'lodge-a',
      state: 'verified',
      destination: full,
      fileName,
      sha256: sha256(full),
      finished_at: `2026-10-17T10:0${index}:00.000Z`,
      unresolved_ids: index === 0 ? ['sync-queue:q9'] : []
    })
  }
  internals.writeAtomicJson(internals.getRunsPath('lodge-a'), seededRuns)
  const result = await runBarTradingBackupAutomationOnce({
    lodgeId: 'lodge-a',
    force: true,
    now: '2026-10-17T12:00:00.000Z',
    dependencies: {
      retrievePassphrase: () => PASS,
      buildSnapshot: () => fakeSnapshot('lodge-a'),
      writePackage: fakeWriter()
    }
  })
  // Tiers keep only the newest generation; the seed holding the only copy of
  // q9 is protected because the new archive does not supersede it.
  assert.equal(fs.existsSync(seededFiles[0]), true, 'unresolved evidence copy is never pruned')
  assert.equal(fs.existsSync(seededFiles[1]), false)
  assert.equal(fs.existsSync(seededFiles[2]), false)
  assert.equal(fs.existsSync(seededFiles[3]), false)
  assert.equal(fs.existsSync(result.destination), true)
  assert.equal(result.retention.deleted.length, 3)
})

test('retention configuration is bounded and defaults are applied', () => {
  assert.deepEqual(internals.normalizeRetention({ retention_hourly: 0, retention_daily: -3, retention_weekly: 1.9 }), { hourly: 1, daily: 1, weekly: 1 })
  assert.deepEqual(internals.normalizeRetention({}), { hourly: 24, daily: 7, weekly: 4 })
  assert.equal(internals.normalizeIntervalHours(undefined), 24)
  assert.equal(internals.normalizeIntervalHours(0), 1)
  assert.equal(internals.normalizeIntervalHours(9999), 168)
})
