import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiPath = path.join(repoRoot, 'manager-pwa/src/lib/api.js')
const storage = new Map()
const calls = []
const queryData = new Map()
const queryErrors = new Map()
const rpcHandlers = new Map()
const effects = []
let api
let baselineApi
let server
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null },
  setItem(key, value) { effects.push(['storage.setItem', key, String(value)]); storage.set(key, String(value)) },
  removeItem(key) { effects.push(['storage.removeItem', key]); storage.delete(key) },
  key(index) { return [...storage.keys()][index] ?? null },
  get length() { return storage.size }
}

globalThis.window = {
  localStorage,
  sessionStorage: localStorage,
  dispatchEvent() { return true },
  addEventListener() {},
  removeEventListener() {}
}
globalThis.localStorage = localStorage
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true }
})

function makeQuery(table) {
  let pageRange = null
  const query = {
    select() { return query },
    eq() { return query },
    neq() { return query },
    not() { return query },
    order() { return query },
    limit() { return query },
    gte() { return query },
    lte() { return query },
    lt() { return query },
    in() { return query },
    range(from, to) { pageRange = [from, to]; return query },
    then(resolve, reject) {
      if (queryErrors.has(table)) {
        return Promise.resolve({ data: null, error: queryErrors.get(table) }).then(resolve, reject)
      }
      const rows = queryData.get(table) ?? []
      const data = pageRange ? rows.slice(pageRange[0], pageRange[1] + 1) : rows
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
  }
  return query
}

const supabase = new Proxy({}, {
  get(_target, key) {
    if (key === 'from') return (table) => makeQuery(table)
    if (key === 'rpc') return async (name, args) => {
      calls.push({ name, args })
      effects.push(['rpc', name, args])
      const handler = rpcHandlers.get(name)
      if (handler) return handler(args)
      if (name === 'get_reports_snapshot') {
        return { data: { occupancy: 3, server_marker: 'synthetic-rpc' }, error: null }
      }
      return { data: { success: true }, error: null }
    }
    return undefined
  }
})

before(async () => {
  const stubs = {
    './supabase': `
      export const supabase = new Proxy({}, { get(_target, key) { return globalThis.__l01Supabase[key] } })
      export const signInWithSupabaseAuth = async () => ({})
    `,
    './access': `
      export const assertCapability = () => {}
      export const getStoredEntitlement = () => null
      export const normalizeSessionUser = (value) => value
      export const storeEntitlement = () => {}
    `,
    '@shared/supportThreads': 'export const normalizeSupportTickets = (value) => value',
  }
  globalThis.__l01Supabase = supabase
  const baselineApiPath = '\0l02:baseline-api'
  const baselineApiSource = readFileSync(path.join(repoRoot, 'docs/engineering/typescript-migration/evidence/L02-preimages-workerA-2026-10-14/api.js'), 'utf8')
  server = await createServer({
    configFile: false,
    root: repoRoot,
    logLevel: 'silent',
    resolve: { alias: { '@shared': path.join(repoRoot, 'src/shared') } },
    plugins: [{
      name: 'manager-l01-boundary-behavior',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === baselineApiPath) return baselineApiPath
        if (importer?.includes('baseline-api') && Object.hasOwn(stubs, id)) return `\0l01:${id}`
        if (importer?.includes('baseline-api') && id.startsWith('./')) return path.join(repoRoot, 'manager-pwa/src/lib', `${id.slice(2)}.js`)
        if (importer?.includes('baseline-api') && id.startsWith('@shared/')) return path.join(repoRoot, 'src/shared', id.slice('@shared/'.length))
        if ((importer?.includes('/manager-pwa/src/lib/api.js') || importer?.includes('baseline-api')) && Object.hasOwn(stubs, id)) return `\0l01:${id}`
      },
      load(id) {
        if (id.startsWith('\0l01:')) return stubs[id.slice(5)]
        if (id === baselineApiPath) return baselineApiSource
      }
    }]
  })
  api = await server.ssrLoadModule(apiPath)
  baselineApi = await server.ssrLoadModule(baselineApiPath)
})

after(async () => {
  await server?.close()
  delete globalThis.__l01Supabase
  delete globalThis.window
  delete globalThis.localStorage
  if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  else delete globalThis.navigator
})

function clearSyntheticState() {
  storage.clear()
  calls.length = 0
  effects.length = 0
  queryData.clear()
  queryErrors.clear()
  rpcHandlers.clear()
}

async function runBoundaryScenario(candidate) {
  clearSyntheticState()
  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  const snapshots = []
  const lodgeId = 'synthetic-equivalence'

  // Malformed persisted data remains an unchecked runtime value, including its old output shape.
  localStorage.setItem('boroko_pwa_queue:synthetic-equivalence:items', JSON.stringify({ unexpected: 'object' }))
  snapshots.push(['malformed-queue-status', candidate.getQueueStatus(lodgeId)])
  globalThis.navigator.onLine = false
  try {
    snapshots.push(['malformed-queue-flush', await candidate.flushOfflineQueue(lodgeId)])
  } finally {
    globalThis.navigator.onLine = true
  }
  try {
    await candidate.flushOfflineQueue(lodgeId)
  } catch (error) {
    snapshots.push(['malformed-queue-online-error', { name: error.name, message: error.message }])
  }

  clearSyntheticState()
  queryData.set('maintenance_tickets', [
    { id: 'm1', reported_date: '2026-10-02', total_cost: 15 },
    { id: 'm2', reported_date: '2026-09-30', total_cost: 900 }
  ])
  rpcHandlers.set('get_reports_snapshot', async (args) => {
    effects.push(['rpc-result', 'get_reports_snapshot', args.p_lodge_id])
    return { data: { occupancy: 3, server_marker: 'synthetic-rpc' }, error: null }
  })
  snapshots.push(['report', await candidate.getReportsSnapshot(lodgeId, { today: '2026-10-14', forceFresh: true })])

  clearSyntheticState()
  const initial = [
    { id: 'adjust-op-7', type: 'inventory/adjust', payload: { id: 'item-1', lodge_id: lodgeId, delta: -2 } },
    { id: 'blocked-op-8', type: 'booking/create', payload: { lodge_id: lodgeId } },
    { id: 'failed-op-9', type: 'maintenance/resolve', payload: { id: 'ticket-1', lodge_id: lodgeId } }
  ]
  runtime.setOfflineQueue(lodgeId, initial)
  rpcHandlers.set('adjust_inventory_stock', async (args) => {
    runtime.setOfflineQueue(lodgeId, [...runtime.getOfflineQueue(lodgeId), {
      id: 'arrived-during-flush', type: 'maintenance/resolve', payload: { id: 'ticket-2', lodge_id: lodgeId }
    }])
    return { data: { success: true }, error: null }
  })
  rpcHandlers.set('resolve_maintenance_ticket', async (args) => args.p_id === 'ticket-1'
    ? { data: null, error: new Error('synthetic RPC failure') }
    : { data: { success: true }, error: null })
  snapshots.push(['flush', await candidate.flushOfflineQueue(lodgeId)])
  snapshots.push(['remaining', runtime.getOfflineQueue(lodgeId)])
  return { snapshots, calls: [...calls], effects: [...effects] }
}

function normalizeTimeValues(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<runtime-timestamp>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<runtime-id>')
  }
  if (Array.isArray(value)) return value.map(normalizeTimeValues)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeTimeValues(nested)]))
  }
  return value
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('actual runtime cache preserves fresh fetch, forceFresh in-flight deduplication, and stale-on-error behavior', async () => {
  clearSyntheticState()
  const lodgeId = 'synthetic-cache-contract'
  queryData.set('bookings', [{ id: 'fresh-booking', status: 'confirmed' }])
  const first = api.listBookings(lodgeId, { forceFresh: true })
  const second = api.listBookings(lodgeId, { forceFresh: true })
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a.map((row) => row.id), ['fresh-booking'])
  assert.deepEqual(b, a)
  assert.equal(calls.length, 0)

  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  runtime.writeCacheEntry(lodgeId, 'bookings', [{ id: 'stale-booking', status: 'confirmed' }])
  queryErrors.set('bookings', new Error('synthetic transport failure'))
  const staleFromApi = await api.listBookings(lodgeId, { forceFresh: true })
  assert.deepEqual(staleFromApi.map((row) => row.id), ['stale-booking'])
  const stale = await runtime.queryWithCache({
    lodgeId,
    key: 'bookings',
    forceFresh: true,
    fetcher: async () => { throw new Error('synthetic transport failure') }
  })
  assert.deepEqual(stale, [{ id: 'stale-booking', status: 'confirmed' }])

  const forceFreshCalls = []
  const deferredFetch = deferred()
  const inFlight = runtime.queryWithCache({ lodgeId, key: 'shared-flight', forceFresh: true, fetcher: () => {
    forceFreshCalls.push('first')
    return deferredFetch.promise
  } })
  const joined = runtime.queryWithCache({ lodgeId, key: 'shared-flight', forceFresh: true, fetcher: async () => {
    forceFreshCalls.push('second')
    return ['should-not-run']
  } })
  deferredFetch.resolve(['one shared fresh result'])
  assert.deepEqual(await inFlight, ['one shared fresh result'])
  assert.deepEqual(await joined, ['one shared fresh result'])
  assert.deepEqual(forceFreshCalls, ['first'])
})

test('actual runtime keeps malformed persisted JSON fallback and does not validate parsed queue values', async () => {
  clearSyntheticState()
  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  const key = 'boroko_pwa_queue:synthetic-malformed:items'
  localStorage.setItem(key, '{not-json')
  assert.deepEqual(runtime.getOfflineQueue('synthetic-malformed'), [])
  localStorage.setItem(key, JSON.stringify({ unexpected: 'object' }))
  assert.deepEqual(runtime.getOfflineQueue('synthetic-malformed'), { unexpected: 'object' })

  // API-side expected-shape JSDoc assertions are compile-time assumptions only:
  // fresh cache and queue objects still pass through with their old behavior.
  runtime.writeCacheEntry('synthetic-malformed-cache', 'bookings', { unexpected: 'object' })
  assert.deepEqual(await api.listBookings('synthetic-malformed-cache'), { unexpected: 'object' })
  assert.deepEqual(api.getQueueStatus('synthetic-malformed'), {
    count: undefined,
    items: { unexpected: 'object' }
  })
  globalThis.navigator.onLine = false
  try {
    assert.deepEqual(await api.flushOfflineQueue('synthetic-malformed'), {
      processed: 0,
      remaining: undefined
    })
  } finally {
    globalThis.navigator.onLine = true
  }
})

test('actual API report calculation combines the RPC result with selected maintenance rows', async () => {
  clearSyntheticState()
  queryData.set('maintenance_tickets', [
    { id: 'm1', reported_date: '2026-10-02', total_cost: 15 },
    { id: 'm2', reported_date: '2026-09-30', total_cost: 900 }
  ])
  const report = await api.getReportsSnapshot('synthetic-report', { today: '2026-10-14', forceFresh: true })
  assert.equal(report.server_marker, 'synthetic-rpc')
  assert.equal(report.source, 'server')
  assert.equal(report.maintenanceCosts, 15)
  assert.ok(calls.some((call) => call.name === 'get_reports_snapshot' && call.args.p_lodge_id === 'synthetic-report'))
})

async function runLegacyCacheFallback(candidate, surface, malformed, malformedMaintenance = false) {
  clearSyntheticState()
  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  const lodgeId = `synthetic-${surface}-${malformed ? 'malformed' : 'stale'}`
  const bookingRows = malformed
    ? [null]
    : [{
        id: 'booking-cached',
        guest_name: 'Cache Guest',
        room_number: 'A1',
        check_in: '2026-10-14',
        check_out: '2026-10-15',
        status: 'confirmed',
        payment_status: 'unpaid',
        amount_paid: 0,
        total_amount: 125,
        charges_total: 0,
        invoice_number: 'INV-CACHED',
        source: 'front_desk',
        created_at: '2026-10-10T08:00:00Z'
      }]
  runtime.writeCacheEntry(lodgeId, 'bookings', bookingRows)
  runtime.writeCacheEntry(lodgeId, 'maintenance', malformed || malformedMaintenance ? [null] : [{
    id: 'maintenance-cached',
    reported_date: '2026-10-14',
    status: 'open',
    priority: 'normal',
    total_cost: 15,
    created_at: '2026-10-14T08:00:00Z'
  }])
  queryErrors.set('bookings', new Error('synthetic bookings unavailable'))
  queryErrors.set('maintenance_tickets', new Error('synthetic maintenance unavailable'))
  rpcHandlers.set('get_manager_dashboard_snapshot', async () => ({ data: null, error: new Error('synthetic dashboard RPC unavailable') }))
  rpcHandlers.set('get_night_audit_summary', async () => ({ data: null, error: new Error('synthetic audit RPC unavailable') }))
  rpcHandlers.set('get_invoice_summary', async () => ({ data: null, error: new Error('synthetic invoice RPC unavailable') }))
  rpcHandlers.set('get_customer_credit_cash_flow', async () => ({ data: [], error: null }))

  try {
    const value = surface === 'dashboard'
      ? await candidate.getDashboardSnapshot(lodgeId)
      : surface === 'night-audit'
        ? await candidate.getNightAudit(lodgeId, '2026-10-14')
        : await candidate.listInvoices(lodgeId, { forceFresh: true })
    return { value, error: null, effects: effects.slice() }
  } catch (error) {
    return { value: null, error: { name: error.name, message: error.message }, effects: effects.slice() }
  }
}

test('legacy dashboard, night-audit, and invoice fallbacks preserve valid stale and malformed cache behavior', async () => {
  for (const surface of ['dashboard', 'night-audit', 'invoice-summary']) {
    for (const malformed of [false, true]) {
      const baseline = await runLegacyCacheFallback(baselineApi, surface, malformed)
      const current = await runLegacyCacheFallback(api, surface, malformed)
      assert.deepEqual(normalizeTimeValues(current), normalizeTimeValues(baseline), `${surface}, malformed=${malformed}`)
      if (!malformed) assert.equal(current.error, null, `${surface} should preserve valid stale-cache fallback`)
      else assert.notEqual(current.error, null, `${surface} should preserve malformed-row failure`)
    }
  }

  const malformedMaintenanceBaseline = await runLegacyCacheFallback(baselineApi, 'dashboard', false, true)
  const malformedMaintenanceCurrent = await runLegacyCacheFallback(api, 'dashboard', false, true)
  assert.deepEqual(
    normalizeTimeValues(malformedMaintenanceCurrent),
    normalizeTimeValues(malformedMaintenanceBaseline),
    'dashboard, malformed maintenance row'
  )
  assert.notEqual(malformedMaintenanceCurrent.error, null, 'dashboard should preserve malformed maintenance-row failure')
})

test('actual API optimistic maintenance write retains queued record in the actual runtime cache', async () => {
  clearSyntheticState()
  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  runtime.writeCacheEntry('synthetic-optimistic', 'maintenance', [{ id: 'existing', title: 'existing' }])
  globalThis.navigator.onLine = false
  try {
    const queued = await api.createMaintenance('synthetic-optimistic', { id: 'new-ticket', title: 'door repair' })
    assert.equal(queued.queued, true)
    const cached = runtime.readCacheEntry('synthetic-optimistic', 'maintenance')
    assert.deepEqual(cached.data.map((row) => row.id), ['new-ticket', 'existing'])
    assert.equal(cached.data[0].queued_offline, true)
  } finally {
    globalThis.navigator.onLine = true
  }
})

test('actual queue flush preserves operation IDs, blocked and failed work, and a queue item added during RPC', async () => {
  clearSyntheticState()
  const runtime = await server.ssrLoadModule(path.join(repoRoot, 'manager-pwa/src/lib/runtime.js'))
  const lodgeId = 'synthetic-flush-contract'
  const original = [
    { id: 'adjust-op-7', type: 'inventory/adjust', payload: { id: 'item-1', lodge_id: lodgeId, delta: -2 } },
    { id: 'blocked-op-8', type: 'booking/create', payload: { lodge_id: lodgeId } },
    { id: 'failed-op-9', type: 'maintenance/resolve', payload: { id: 'ticket-1', lodge_id: lodgeId } }
  ]
  runtime.setOfflineQueue(lodgeId, original)
  globalThis.navigator.onLine = true

  rpcHandlers.set('adjust_inventory_stock', async (args) => {
    assert.equal(args.p_adjustment_id, 'adjust-op-7')
    runtime.setOfflineQueue(lodgeId, [...runtime.getOfflineQueue(lodgeId), {
      id: 'arrived-during-flush', type: 'maintenance/resolve', payload: { id: 'ticket-2', lodge_id: lodgeId }
    }])
    return { data: { success: true }, error: null }
  })
  rpcHandlers.set('resolve_maintenance_ticket', async (args) => {
    if (args.p_id === 'ticket-1') return { data: null, error: new Error('synthetic RPC failure') }
    return { data: { success: true }, error: null }
  })

  const result = await api.flushOfflineQueue(lodgeId)
  const remaining = runtime.getOfflineQueue(lodgeId)
  assert.equal(result.processed, 1)
  assert.equal(result.remaining, 3)
  assert.equal(remaining.some((item) => item.id === 'blocked-op-8' && item.blocked === true), true)
  assert.equal(remaining.some((item) => item.id === 'failed-op-9' && String(item.lastError).includes('synthetic RPC failure')), true)
  assert.equal(remaining.some((item) => item.id === 'arrived-during-flush'), true)
})

test('typed API paths preserve baseline outputs, errors, malformed values, and side-effect order', async () => {
  const baseline = await runBoundaryScenario(baselineApi)
  const current = await runBoundaryScenario(api)
  assert.deepEqual(normalizeTimeValues(current), normalizeTimeValues(baseline))
  assert.deepEqual(current.snapshots[0], ['malformed-queue-status', { count: undefined, items: { unexpected: 'object' } }])
  assert.deepEqual(current.snapshots[1], ['malformed-queue-flush', { processed: 0, remaining: undefined }])
  assert.equal(current.snapshots[2][1].name, baseline.snapshots[2][1].name)
  assert.equal(current.snapshots[2][1].message, baseline.snapshots[2][1].message)
  assert.equal(current.snapshots[3][1].maintenanceCosts, 15)
  assert.equal(current.snapshots[4][1].processed, 1)
  assert.deepEqual(current.snapshots[5][1].map((item) => item.id), ['blocked-op-8', 'failed-op-9', 'arrived-during-flush'])
  assert.deepEqual(current.calls.map(({ name }) => name), [
    'adjust_inventory_stock',
    'resolve_maintenance_ticket'
  ])
})
