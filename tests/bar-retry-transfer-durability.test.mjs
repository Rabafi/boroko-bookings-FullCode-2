import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { state } from '../src/main/state.js'
import * as store from '../src/main/domains/syncStore.js'
import * as shared from '../src/main/domains/syncShared.js'

// Execute the actual production function bodies with real durable stores.
// Only Electron/cache notifications and the remote replay are substituted.
// This is a transfer/crash test, not proof of server financial reconciliation.
function loadRetry(mode, overrides = {}) {
  const file = mode === 'auto' ? 'infrastructure' : 'sync'
  const name = mode === 'auto' ? 'requeueEligibleFailedSyncItems' : 'retrySyncItems'
  const source = fs.readFileSync(new URL(`../src/main/domains/${file}.js`, import.meta.url), 'utf8')
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0)
  const end = source.indexOf('\nexport ', start + 1)
  assert.ok(end > start)
  const dependencies = {
    ...store,
    ...shared,
    state,
    isFinancialSyncItem: () => true,
    patchCachedPosOrderSyncState: () => {},
    patchCachedInventoryItemSyncState: () => {},
    patchCachedDayUseSyncState: () => {},
    broadcastSyncStatus: () => {},
    processSyncQueue: async () => {},
    console: { log() {}, warn() {} },
    ...overrides
  }
  return new Function(...Object.keys(dependencies), `${source.slice(start, end).replace('export ', '')}; return ${name}`)(...Object.values(dependencies))
}

async function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-retry-transfer-'))
  const previous = { cacheDir: state.cacheDir, isOnline: state.isOnline }
  state.cacheDir = dir
  state.isOnline = true
  try { await run() } finally {
    Object.assign(state, previous)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const sale = (id, extra = {}) => ({
  _queue_id: `pos-order-${id}`,
  type: 'rpc', table: 'create_pos_order_v3',
  data: { payload: {
    id, create_idempotency_key: `sale-key-${id}`, submit_intent_id: `intent-${id}`,
    lodge_id: 'bar-a', outlet_id: 'outlet-a', shift_id: 'original-shift',
    cashier_id: 'cashier-a', client_created_at: '2026-09-15T12:00:00.000Z',
    total: 40, payment_breakdown: [{ method: 'cash', amount: 40 }],
    items: [{ menu_item_id: 'beer', quantity: 2, unit_price: 20 }]
  } },
  retryCount: 5, lastError: 'fetch failed',
  lastAttemptedAt: '2026-09-15T12:00:00.000Z',
  _depends_on_all: ['original-shift-open', 'catalog-publication'],
  ...extra
})

for (const mode of ['auto', 'manual']) {
  test(`${mode} retry retains failed work when the destination cannot be saved`, () => isolated(async () => {
    const original = sale('disk-full')
    store.writeSyncQueue([])
    store.writeFailedSyncQueue([original])
    let sourceWrites = 0
    let replayCalls = 0
    const retry = loadRetry(mode, {
      writeSyncQueue() { throw new Error('injected disk full') },
      writeFailedSyncQueue(rows) { sourceWrites++; store.writeFailedSyncQueue(rows) },
      async processSyncQueue() { replayCalls++ }
    })
    await assert.rejects(retry(), /injected disk full/)
    assert.equal(sourceWrites, 0, 'the only durable recovery copy must survive')
    assert.equal(replayCalls, 0, 'never dispatch after an incomplete transfer')
    assert.deepEqual(store.readFailedSyncQueue(), [original])
    assert.deepEqual(store.readSyncQueue(), [])
  }))

  test(`${mode} retry converges after a crash between destination and source writes`, () => isolated(async () => {
    const original = sale('power-cut')
    const other = sale('already-pending')
    store.writeSyncQueue([other])
    store.writeFailedSyncQueue([original])
    const interrupted = loadRetry(mode, {
      writeFailedSyncQueue() { throw new Error('injected power cut') }
    })
    await assert.rejects(interrupted(), /injected power cut/)
    assert.deepEqual(store.readFailedSyncQueue(), [original])
    assert.equal(store.readSyncQueue().filter(row => row._queue_id === original._queue_id).length, 1)

    // New function instance and fresh on-disk reads represent the restarted app.
    const resumed = await loadRetry(mode)()
    assert.equal(resumed.retried, 1)
    const pending = store.readSyncQueue()
    assert.equal(pending.length, 2)
    assert.deepEqual(pending.find(row => row._queue_id === other._queue_id), other)
    const recovered = pending.find(row => row._queue_id === original._queue_id)
    assert.deepEqual(recovered.data, original.data, 'money, identity, date, actor and shift are unchanged')
    assert.deepEqual(recovered._depends_on_all, original._depends_on_all)
    assert.equal(recovered._queue_id, original._queue_id)
    assert.equal(recovered._state, 'pending')
    assert.deepEqual(store.readFailedSyncQueue(), [])
    assert.equal((await loadRetry(mode)()).retried, 0)
  }))
}

test('automatic retry leaves manager-only, fresh and future-dated failures alone', () => isolated(async () => {
  const rows = [
    sale('review', { manualRetryOnly: true }),
    sale('recent', { lastAttemptedAt: new Date().toISOString() }),
    sale('future', { lastAttemptedAt: new Date(Date.now() + 86400000).toISOString() })
  ]
  store.writeFailedSyncQueue(rows)
  store.writeSyncQueue([])
  assert.deepEqual(await loadRetry('auto')(), { retried: 0, remaining: 3 })
  assert.deepEqual(store.readFailedSyncQueue(), rows)
  assert.deepEqual(store.readSyncQueue(), [])
}))

test('manager retry transfers only the selected operation and replays after both writes', () => isolated(async () => {
  const selected = sale('selected', { manualRetryOnly: true })
  const kept = sale('kept', { manualRetryOnly: true })
  store.writeFailedSyncQueue([selected, kept])
  store.writeSyncQueue([])
  let calls = 0
  await loadRetry('manual', {
    async processSyncQueue() {
      calls++
      assert.deepEqual(store.readFailedSyncQueue(), [kept])
      assert.equal(store.readSyncQueue()[0]._queue_id, selected._queue_id)
    }
  })([selected._queue_id])
  assert.equal(calls, 1)
}))

test('automatic recovery transfers a 20000-sale backlog without dropping or changing operation payloads', () => isolated(async () => {
  const rows = Array.from({ length: 20000 }, (_, i) => sale(`volume-${i}`))
  store.writeSyncQueue([])
  store.writeFailedSyncQueue(rows)
  const result = await loadRetry('auto', { appendOperationJournalEntry() {} })()
  assert.equal(result.retried, rows.length)
  const pending = store.readSyncQueue()
  assert.equal(new Set(pending.map(row => row._queue_id)).size, rows.length)
  assert.equal(pending.length, rows.length)
  for (let i = 0; i < rows.length; i++) {
    assert.deepEqual(pending[i].data, rows[i].data)
    assert.deepEqual(pending[i]._depends_on_all, rows[i]._depends_on_all)
  }
  assert.equal(store.readFailedSyncQueue().length, 0)
}))
