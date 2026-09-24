import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('desktop allows only one copy so two windows cannot erase each other queue', () => {
  const main = read('src/main/index.js')
  assert.match(main, /app\.requestSingleInstanceLock\(\)/, 'Main app must lock to one copy like Legacy POS')
  assert.match(main, /second-instance/, 'Second copy must bring the first window forward')
  assert.match(main, /if \(!hasSingleInstanceLock\) return/, 'Second copy must not boot the main window')
})

test('firm server refusals park for review instead of retrying forever', () => {
  const infra = read('src/main/domains/infrastructure.js')
  assert.match(infra, /catalog_refresh_required/, 'Trading-window refusals must be recognised')
  assert.match(infra, /manual_review_required === true/, 'Server firm-no flag must be honoured')
  assert.match(infra, /shouldManualReviewSyncItem\(item, errorMessage, supabaseError\)/, 'Retry decision must see the server flags, not only the message')
})

test('catch-up pauses when the link drops instead of burning retries', () => {
  const infra = read('src/main/domains/infrastructure.js')
  assert.match(infra, /replay_paused_offline/, 'Offline pause must be journalled')
  assert.match(infra, /if \(state\.isOnline === false\)/, 'Drain must check the link before each item')
})

test('status counts build their id sets once', () => {
  const status = read('src/main/domains/syncStatus.js')
  assert.match(status, /Build id sets once per status computation/, 'Status must not rebuild sets per item')
  const sync = read('src/main/domains/sync.js')
  assert.match(sync, /prebuilt Sets/, 'Details must reuse one set build')
})

test('operating profile save warns when it stays on one computer', () => {
  const main = read('src/main/index.js')
  assert.match(main, /settings:updateOperatingProfile/, 'IPC handler must exist')
  assert.match(main, /device_only/, 'Offline profile save must say it stayed on this computer')
  assert.match(main, /Save again when back online/, 'Operator must get a recovery step')
})

test('stock counts queue offline from last-known baselines', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /stockCountsQueueable/, 'Counts must allow queueing from cached baselines')
  assert.match(stock, /Offline count: queued with last-known expected quantities/, 'Single count must say it queued')
  assert.match(stock, /Offline Count All: lines carry last-known expected quantities/, 'Count All must say it queued')
})

test('phone app pushes its queue on start and names items needing review', () => {
  const app = read('manager-pwa/src/App.jsx')
  assert.match(app, /Push once on mount/, 'Startup flush must be pinned')
  assert.match(app, /need.*review in Support inbox/, 'Unresolved phone items must be visible')
})

test('Bar lease migration keeps Bar at 365 days and others at 30', () => {
  const migration = read('supabase/migrations/20260923000001_bar_offline_lease_365.sql')
  assert.match(migration, /least\(coalesce\(p_lease_days, 7\), 365\)/, 'Absolute ceiling must move to 365')
  assert.match(migration, /hospitality_mode.*bar_only/, 'Bar branch must be Bar-only')
  assert.match(migration, /least\(coalesce\(v_license\.offline_lease_days, 7\), 365\)/, 'Reader must keep Bar stored values to 365')
  assert.match(migration, /least\(coalesce\(v_license\.offline_lease_days, 7\), 30\)/, 'Reader must keep others at 30')
  assert.match(migration, /least\(coalesce\(nullif\(p_payload->>'offline_lease_days', ''\)::integer, 7\), 365\)/, 'Writer must store Bar values to 365')
  assert.doesNotMatch(migration, /revoke all on function/, 'OR REPLACE must preserve ACLs without re-granting')
})

test('Bar trading-window migration removes the age limit for Bar only', () => {
  const migration = read('supabase/migrations/20260923000002_bar_offline_window_unlimited.sql')
  assert.match(migration, /pos_offline_trading_hours := 87600/, 'Bar floor must move to 87600h')
  assert.match(migration, /hospitality_mode.*bar_only/, 'Backfill must touch Bar rows only')
})

test('business_date migration prefers the original sale day', () => {
  const migration = read('supabase/migrations/20260923000003_pos_business_date_sale_day.sql')
  assert.match(migration, /new\.client_created_at/, 'Trigger must read the sale-time field')
  assert.match(migration, /now\(\) \+ interval '5 minutes'/, 'Future guard must match the order RPC')
  assert.match(migration, /coalesce\(\s*new\.business_date/, 'Explicit business_date must still win')
})

test('legacy POS single-instance lock stays pinned', () => {
  const legacy = read('legacy-pos/src/main/index.js')
  assert.match(legacy, /app\.requestSingleInstanceLock\(\)/, 'Legacy POS must keep its lock')
})

test('sync status reads only the tail of the history log', async () => {
  const { state } = await import('../src/main/state.js')
  const store = await import('../src/main/domains/syncStore.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-journal-cap-'))
  const previous = state.cacheDir
  try {
    state.cacheDir = dir
    for (let i = 0; i < 600; i += 1) {
      store.appendOperationJournalEntry('queued', { _queue_id: `q-${i}`, table: 'create_booking', type: 'rpc', data: {} })
    }
    const summary = store.getOperationJournalSummary()
    assert.equal(summary.total, 600)
    assert.equal(summary.truncated, true)
    assert.equal(summary.limit, store.OPERATION_JOURNAL_SUMMARY_LIMIT)
    assert.ok(summary.fileSizeBytes > 0)
    // Full read stays available for explicit support exports.
    const full = store.getOperationJournalSummary({ limit: 0 })
    assert.equal(full.total, 600)
    assert.equal(full.truncated, false)
    assert.equal(Object.values(full.byEvent).reduce((a, b) => a + b, 0), 600)
  } finally {
    state.cacheDir = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('history log trims itself when too big and keeps sales safe', async () => {
  const { state } = await import('../src/main/state.js')
  const store = await import('../src/main/domains/syncStore.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-journal-trim-'))
  const previous = state.cacheDir
  try {
    state.cacheDir = dir
    store.appendOperationJournalEntry('queued', { _queue_id: 'small-1', table: 'x', type: 'rpc', data: {} })
    assert.equal(store.pruneOperationJournalIfNeeded(), null)
    // Build a file just over the 5MB trim line.
    const bigPayload = 'x'.repeat(2000)
    const lines = []
    for (let i = 0; i < 3000; i += 1) {
      lines.push(JSON.stringify({ schemaVersion: 1, event: 'queued', at: new Date().toISOString(), queue_id: `q-${i}`, operation: 'x', payload: bigPayload }))
    }
    fs.writeFileSync(path.join(dir, 'offline-operation-log.jsonl'), `${lines.join('\n')}\n`, 'utf-8')
    const before = fs.statSync(path.join(dir, 'offline-operation-log.jsonl')).size
    assert.ok(before > 5 * 1024 * 1024)
    const result = store.pruneOperationJournalIfNeeded()
    assert.ok(result && result.trimmed > 0)
    const afterLines = fs.readFileSync(path.join(dir, 'offline-operation-log.jsonl'), 'utf-8').split(/\r?\n/).filter(Boolean)
    assert.equal(afterLines.length, 2000)
  } finally {
    state.cacheDir = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function installPwaStorage() {
  const values = new Map()
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
    key: (i) => [...values.keys()][i] || null,
    get length() { return values.size; },
  }
  Object.defineProperty(storage, '__values', { value: values })
  global.window = { localStorage: storage, dispatchEvent: () => {} }
  global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  // localStorage global used by getPwaDeviceId fallback paths.
  global.localStorage = storage
  return storage
}

test('phone app explains full storage and offers export plus blocked clear', async () => {
  installPwaStorage()
  const runtime = await import('../manager-pwa/src/lib/runtime.js')
  assert.equal(runtime.isPwaStorageFullError(new Error('quota exceeded')), true)
  assert.equal(runtime.isPwaStorageFullError({ name: 'QuotaExceededError' }), true)
  const friendly = runtime.friendlyPwaQueueError(new Error('quota exceeded'), 'Save ticket')
  assert.match(String(friendly.message), /storage is full/i)
  assert.match(String(friendly.message), /Export/i)

  const lodge = 'lodge-scale-test'
  runtime.setOfflineQueue(lodge, [])
  assert.equal(runtime.getPwaStorageHealth(lodge).warn, false)
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `op-${i}`, type: 'support/create', label: 'x', payload: { i }, createdAt: new Date().toISOString() }))
  runtime.setOfflineQueue(lodge, many)
  assert.equal(runtime.getPwaStorageHealth(lodge).warn, true)
  const exported = runtime.exportPwaOfflineQueue(lodge)
  assert.equal(exported.count, 200)
  assert.match(exported.filename, /pwa-offline-queue/)
  assert.ok(JSON.parse(exported.json).items.length === 200)

  const withBlocked = [...many, { id: 'blocked-1', type: 'quotation/create', label: 'q', blocked: true, payload: {}, createdAt: new Date().toISOString() }]
  runtime.setOfflineQueue(lodge, withBlocked)
  const cleared = runtime.clearPwaBlockedOperations(lodge)
  assert.equal(cleared.removed, 1)
  assert.equal(runtime.getOfflineQueue(lodge).length, 200)
})
