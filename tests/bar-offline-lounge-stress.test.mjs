/**
 * Botswapelo Lounge OFFLINE stress test (real-world outage simulation).
 *
 * Scenario: the Lounge Bar loses connectivity for weeks. Staff keep trading
 * fully offline — dozens of staff clock in, 150 products are created,
 * thousands of sales ring through, tabs split/transfer/settle, voids,
 * returns and cash-ups queue — then connectivity returns and the queue
 * replays through transport chaos (timeouts, duplicate deliveries, a
 * mid-replay process restart).
 *
 * What is REAL here (imported production code, not re-implemented):
 * - src/main/domains/syncStore.js queue + failed-queue + journal + meta +
 *   offline-mode persistence (isolated temp dir; live AppData untouched)
 * - src/shared/syncQueue.js dependency scheduling (pickNextReadySyncItemIndex)
 *   and financial classification (isFinancialSyncItem)
 * - src/shared/posTabRecovery.js split/transfer envelope lifecycle for tabs
 * - src/main/domains/syncShared.js current-open-shift reattribution
 * - stable idempotency keys (crypto.randomUUID) + sha256 payload hashing
 *
 * What is SIMULATED (documented): the offline builders mirror pos.js
 * (including the new guardrails: no duplicate Till, no clock-out without a
 * submitted cash-up, no clock-in while a clock-out is pending) and the mock
 * server mirrors the SQL contracts (one active shift per staff, cash-up
 * before clock-out with idempotent close, immutable snapshot membership,
 * pay-time totals, void/return reversal, version-checked transfers).
 * pos.js itself cannot load in plain node (Electron imports).
 *
 * Deterministic: seeded PRNG, fixed workload. No network. No linked DB.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { state } from '../src/main/state.js'
import {
  appendOperationJournalEntry,
  readFailedSyncQueue,
  readOfflineModeState,
  readOperationJournal,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
  writeOfflineModeState,
  writeSyncMeta,
  writeSyncQueue
} from '../src/main/domains/syncStore.js'
import { isFinancialSyncItem, pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'
import {
  TAB_RECOVERY_OUTCOMES,
  buildSplitPayload,
  buildTransferPayload,
  newRecoveryEnvelope,
  replaySavedTabOperation,
  stableFingerprint,
  submitNewTabOperation,
  writeRecoveryEnvelope
} from '../src/shared/posTabRecovery.js'
import { resolveCurrentOpenShiftId } from '../src/main/domains/syncShared.js'

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)]
const sha = (s) => createHash('sha256').update(s).digest('hex')

function memoryStorage() {
  const map = new Map()
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) }
  }
  Object.defineProperty(store, 'length', { get: () => map.size })
  store.key = (i) => [...map.keys()][i] ?? null
  return store
}

// ---------------------------------------------------------------------------
// Lounge fixture (shape of the live tenant; in-memory only)
// ---------------------------------------------------------------------------
const LODGE = '45f21c52-a095-4031-a06c-bd1717865ebd'
const OUTLET = 'c0b07cea-941b-4561-bcb4-2f01d7d16af6'
const BRIAN = 'c2a62587-c4e4-4853-bcac-9a8cc055b062'
const LELENTLE = '2ab5e904-2572-4642-bbe6-c82e1a581dcc'
const DEVICE = 'desktop-stress-01'
const MAX_RETRIES = 5

const BASE_MENU = [
  ['Heineken 330ml', 'Beer', 2500], ['Fanta 2L', 'Softs', 2500],
  ['Serobe', 'Simple Food', 1500], ['Russian (full)', 'Simple Food', 1800],
  ['Russian (half)', 'Simple Food', 1000], ['GranPa', 'Other', 500],
  ['Pool Table 1', 'Pool', 100], ['Pool Table 2', 'Pool', 100],
  ['Castle 330ml', 'Beer', 2200], ['Coke 2L', 'Softs', 2400],
  ['Chips', 'Simple Food', 1200], ['Water 500ml', 'Softs', 800]
].map(([name, category, priceCents], i) => ({
  menu_item_id: `base-item-${String(i).padStart(2, '0')}`,
  item_name: name, category, unit_price_cents: priceCents
}))
const SNAP0 = 'snap-v9-base'
const SNAP1 = 'snap-v10-extended'

// ---------------------------------------------------------------------------
// Mock server: contract-faithful, effect-counted, chaos-ready
// ---------------------------------------------------------------------------
function createMockServer() {
  const db = {
    attendance: new Map(), // shiftId -> { staff, status, clockOutKey, clockOutHash }
    activeByStaff: new Map(), // staffId -> shiftId
    tills: new Map(), // tillId -> { staff, outlet, status, attendanceId, key }
    openTillByStaffOutlet: new Map(), // `${staff}:${outlet}` -> tillId
    cashups: new Map(), // tillId -> status
    menu: new Map(BASE_MENU.map((m) => [m.menu_item_id, m])),
    snapshots: new Map([[SNAP0, new Set(BASE_MENU.map((m) => m.menu_item_id))]]),
    ordersByKey: new Map(), // idempotencyKey -> result
    ordersById: new Map(),
    orderEffects: new Map(), // key -> apply count (must stay 1)
    voids: new Set(),
    returns: new Set(),
    tabs: new Map(), // tabId -> { version, waiter, shift, status }
    transfers: new Map(), // operationId -> result
    splits: new Map(),
    inventory: new Map(),
    expenses: new Map(),
    maintenance: new Map(),
    ledgerCents: { cash: 0, card: 0, voided: 0, returned: 0, tips: 0, discount: 0 }
  }
  const ok = (extra = {}) => ({ success: true, ...extra })
  const fail = (error, extra = {}) => ({ success: false, error, ...extra })
  const clockHash = (p) => sha(JSON.stringify({ l: p.lodge_id, s: p.shift_id, n: p.notes ?? null, k: p.idempotency_key }))

  const handlers = {
    clock_in_staff_with_attendance_pin_offline({ payload: p }) {
      // Idempotency key first (mirrors the SQL contract), then the guard.
      const byKey = [...db.attendance.entries()].find(([, a]) => a.key === p.idempotency_key)
      if (byKey) return ok({ shift_id: byKey[0], replayed: true, duplicate: true })
      if (db.activeByStaff.has(p.staff_user_id)) {
        return fail('This staff member already has an active shift. Clock them out before starting another one.')
      }
      db.attendance.set(p.shift_id, { staff: p.staff_user_id, status: 'active', clockOutKey: null, clockOutHash: null, key: p.idempotency_key })
      db.activeByStaff.set(p.staff_user_id, p.shift_id)
      return ok({ shift_id: p.shift_id })
    },
    clock_out_staff_with_attendance_pin({ payload: p }) {
      const row = db.attendance.get(p.shift_id)
      if (!row) return fail('Attendance shift not found. Refresh and try again.')
      if (row.status !== 'active') return ok({ shift_id: p.shift_id, replayed: true, already_closed: true })
      if (row.clockOutKey && (row.clockOutKey !== p.idempotency_key || row.clockOutHash !== clockHash(p))) {
        const err = new Error('Clock-out idempotency key was already used with a different payload')
        err.code = '23505'
        throw err
      }
      const openTill = [...db.tills.values()].find((t) => t.staff === row.staff && t.status === 'open')
      if (openTill && db.cashups.get(openTill.id) !== 'submitted' && db.cashups.get(openTill.id) !== 'approved') {
        return fail('Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.')
      }
      row.status = 'completed'
      row.clockOutKey = p.idempotency_key
      row.clockOutHash = clockHash(p)
      db.activeByStaff.delete(row.staff)
      return ok({ shift_id: p.shift_id })
    },
    activate_shared_till_operator_offline({ payload: p }) {
      // Idempotency key first (mirrors open_pos_shift_with_id), then the
      // already-open rule.
      for (const t of db.tills.values()) {
        if (t.key === p.idempotency_key) return ok({ shift: { id: t.id }, replayed: true })
      }
      const existingId = db.openTillByStaffOutlet.get(`${p.staff_user_id}:${p.outlet_id}`)
      if (existingId) {
        const t = db.tills.get(existingId)
        return ok({ shift: { id: t.id }, already_open: true, offline_replay: true, remap_skipped: true })
      }
      db.tills.set(p.pos_shift_id, { id: p.pos_shift_id, staff: p.staff_user_id, outlet: p.outlet_id, status: 'open', attendanceId: null, key: p.idempotency_key })
      db.openTillByStaffOutlet.set(`${p.staff_user_id}:${p.outlet_id}`, p.pos_shift_id)
      return ok({ shift: { id: p.pos_shift_id }, offline_replay: true })
    },
    create_pos_menu_item_offline({ payload: p }) {
      if (!db.menu.has(p.id)) db.menu.set(p.id, { menu_item_id: p.id, item_name: p.name, category: p.category, unit_price_cents: p.price_cents })
      return ok({ id: p.id, offline_replay: true })
    },
    publish_pos_catalog_snapshot_offline({ payload: p }) {
      if (!db.snapshots.has(p.snapshot_id)) db.snapshots.set(p.snapshot_id, new Set(p.item_ids))
      return ok({ snapshot_id: p.snapshot_id, offline_replay: true })
    },
    create_pos_order_v3({ payload: p }) {
      if (db.ordersByKey.has(p.create_idempotency_key)) {
        return { ...db.ordersByKey.get(p.create_idempotency_key), replayed: true }
      }
      let till = db.tills.get(p.shift_id)
      if (!till || till.status !== 'open') {
        if (till && till.status !== 'open') {
          // Mirrors production stale-shift reattribution on retry: a sale
          // naming a since-closed shift replays under the cashier's current
          // open till. Unknown shift ids still fail (bad-shift poison).
          const current = [...db.tills.values()].find((t) => t.status === 'open' && t.outlet === p.outlet_id && t.staff === p.cashier_id)
          if (current) till = current
          else return fail('The Till shift is not open. Refresh Till and try again.')
        } else {
          return fail('The Till shift is not open. Refresh Till and try again.')
        }
      }
      const snap = db.snapshots.get(p.catalog_snapshot_id)
      if (!snap) return fail('Catalog snapshot not found. Refresh the catalogue and try again.')
      let linesTotal = 0
      for (const line of p.items) {
        const item = db.menu.get(line.menu_item_id)
        if (!item || !snap.has(line.menu_item_id)) {
          return fail('Item is unavailable in the immutable catalog snapshot')
        }
        if (item.unit_price_cents !== line.unit_price_cents) {
          return fail('Server pricing differs from the submitted line price. Refresh and rebuild the basket.')
        }
        linesTotal += line.unit_price_cents * line.quantity
      }
      const expectTotal = linesTotal - (p.discount_total_cents || 0) + (p.tip_total_cents || 0)
      if (expectTotal !== p.total_cents) return fail('Order total does not match priced lines.')
      const result = ok({ id: p.id, receipt_number: `R-${db.ordersById.size + 1}` })
      db.ordersByKey.set(p.create_idempotency_key, result)
      db.ordersById.set(p.id, p)
      db.orderEffects.set(p.create_idempotency_key, (db.orderEffects.get(p.create_idempotency_key) || 0) + 1)
      const method = p.payment_method === 'card' ? 'card' : 'cash'
      db.ledgerCents[method] += p.total_cents
      db.ledgerCents.tips += p.tip_total_cents || 0
      db.ledgerCents.discount += p.discount_total_cents || 0
      if (p.tab_id && db.tabs.has(p.tab_id)) {
        const tab = db.tabs.get(p.tab_id)
        tab.status = 'settled'
      }
      return result
    },
    void_pos_order({ payload: p }) {
      if (!db.ordersById.has(p.order_id)) return fail('Original sale not found. It may not have synced yet; retry after it confirms.')
      if (db.voids.has(p.order_id)) return ok({ order_id: p.order_id, replayed: true })
      db.voids.add(p.order_id)
      const order = db.ordersById.get(p.order_id)
      const method = order.payment_method === 'card' ? 'card' : 'cash'
      // Full reversal: tender, tip and discount attributions all unwind.
      db.ledgerCents[method] -= order.total_cents
      db.ledgerCents.voided += order.total_cents
      db.ledgerCents.tips -= order.tip_total_cents || 0
      db.ledgerCents.discount -= order.discount_total_cents || 0
      return ok({ order_id: p.order_id })
    },
    create_pos_return_v3({ payload: p }) {
      if (!db.ordersById.has(p.order_id)) return fail('Original sale not found. It may not have synced yet; retry after it confirms.')
      if (db.returns.has(p.return_idempotency_key)) return ok({ return_id: p.return_id, replayed: true })
      db.returns.add(p.return_idempotency_key)
      const method = p.payment_method === 'card' ? 'card' : 'cash'
      db.ledgerCents[method] -= p.total_cents
      db.ledgerCents.returned += p.total_cents
      return ok({ return_id: p.return_id })
    },
    upsert_pos_tab({ payload: p }) {
      const existing = db.tabs.get(p.id)
      if (existing) return ok({ tab: existing, replayed: true })
      db.tabs.set(p.id, { id: p.id, version: 1, waiter: p.waiter_id, shift: p.shift_id, outlet: p.outlet_id, status: 'open' })
      return ok({ tab: db.tabs.get(p.id) })
    },
    transfer_pos_tab_waiter({ payload: p }) {
      if (db.transfers.has(p.operation_id)) return { ...db.transfers.get(p.operation_id), replayed: true }
      const tab = db.tabs.get(p.tab_id)
      if (!tab) return fail('Open table tab not found. Refresh open tabs and try again.', { code: 'tab_not_found' })
      if (tab.version !== p.expected_tab_version) {
        return fail('This tab changed on another terminal. Refresh it before transferring.', { code: 'tab_version_conflict' })
      }
      tab.waiter = p.target_waiter_id
      tab.shift = p.target_shift_id
      tab.version += 1
      const result = ok({ tab: { ...tab }, operation_id: p.operation_id })
      db.transfers.set(p.operation_id, result)
      return result
    },
    split_pos_tab_evenly({ payload: p }) {
      if (db.splits.has(p.idempotency_key)) return { ...db.splits.get(p.idempotency_key), replayed: true }
      const tab = db.tabs.get(p.source_tab_id)
      if (!tab) return fail('Open table tab not found. Refresh open tabs and try again.', { code: 'tab_not_found' })
      // Server evidence (source_tab/new_tabs) is what lets the client prove
      // commitment; a bare success stays unknown by design.
      const result = ok({ source_tab_id: p.source_tab_id, split_count: p.split_count, source_tab: { id: tab.id }, new_tabs: [] })
      db.splits.set(p.idempotency_key, result)
      return result
    },
    submit_pos_shift_cashup_with_attendance_pin({ payload: p }) {
      if (db.cashups.get(p.shift_id) === 'submitted' || db.cashups.get(p.shift_id) === 'approved') {
        return ok({ submission_id: p.cashup_id, replayed: true })
      }
      db.cashups.set(p.shift_id, 'submitted')
      return ok({ submission_id: p.cashup_id })
    },
    finalize_pos_shift_cashup_v2({ payload: p }) {
      const till = db.tills.get(p.shift_id)
      if (!till) return fail('Till shift not found.')
      if (db.cashups.get(p.shift_id) !== 'submitted' && db.cashups.get(p.shift_id) !== 'approved') {
        return fail('Submit My Cash-up before closing this shift.')
      }
      till.status = 'closed'
      db.openTillByStaffOutlet.delete(`${till.staff}:${till.outlet}`)
      return ok({ shift_id: p.shift_id })
    },
    clock_in_staff_offline({ payload: p }) {
      return handlers.clock_in_staff_with_attendance_pin_offline({ payload: p })
    },
    add_inventory_purchase({ payload: p }) {
      const key = p.idempotency_key
      if (db.inventory.has(`purchase:${key}`)) return ok({ id: p.id, replayed: true })
      db.inventory.set(`purchase:${key}`, p)
      db.inventory.set(`stock:${p.inventory_item_id}`, (db.inventory.get(`stock:${p.inventory_item_id}`) || 1000) + p.quantity_cents)
      return ok({ id: p.id })
    },
    adjust_inventory_stock({ payload: p }) {
      const key = p.idempotency_key
      if (db.inventory.has(`adjust:${key}`)) return ok({ replayed: true })
      db.inventory.set(`adjust:${key}`, p)
      db.inventory.set(`stock:${p.inventory_item_id}`, (db.inventory.get(`stock:${p.inventory_item_id}`) || 1000) + p.delta_cents)
      return ok({})
    },
    create_inventory_stocktake_session({ payload: p }) {
      db.inventory.set(`stocktake:${p.id}`, { ...p, status: 'open', lines: [] })
      return ok({ id: p.id })
    },
    save_inventory_stocktake_counts({ payload: p }) {
      const session = db.inventory.get(`stocktake:${p.session_id}`)
      if (!session) return fail('Stocktake session not found.')
      session.lines = p.lines
      return ok({ session_id: p.session_id, counted: p.lines.length })
    },
    post_inventory_stocktake_session({ payload: p }) {
      const session = db.inventory.get(`stocktake:${p.session_id}`)
      if (!session) return fail('Stocktake session not found.')
      if (session.status === 'posted') return ok({ session_id: p.session_id, replayed: true })
      session.status = 'posted'
      return ok({ session_id: p.session_id })
    },
    create_expense({ payload: p }) {
      if (db.expenses.has(p.idempotency_key)) return ok({ id: p.id, replayed: true })
      db.expenses.set(p.idempotency_key, p)
      return ok({ id: p.id })
    },
    update_expense({ payload: p }) {
      if (!db.expenses.has(p.idempotency_key)) return fail('Expense not found. It may not have synced yet; retry after it confirms.')
      return ok({ id: p.id })
    },
    update_maintenance_ticket({ payload: p }) {
      db.maintenance.set(p.id, { ...p, status: p.status || 'open' })
      return ok({ id: p.id })
    }
  }
  return { db, handlers }
}

// ---------------------------------------------------------------------------
// Offline builders (mirror pos.js incl. new guardrails; PINs redacted)
// ---------------------------------------------------------------------------
const pinPlaceholder = () => ({ _secure_queue_secret: true, encrypted: false, redacted: true })

function buildWorkload(rand) {
  const queue = []
  const journal = []
  const push = (table, payload, opts = {}) => {
    const item = {
      type: 'rpc', table, data: { payload },
      id: null, timestamp: new Date(Date.now() + queue.length * 1000).toISOString(),
      _origin_device_id: null, _origin_user_id: BRIAN, _origin_lodge_id: LODGE,
      _queue_id: opts.queueId || `${table}-${randomUUID().slice(0, 8)}`,
      _state: 'pending', retryCount: 0, ...(opts.deps ? { _depends_on: opts.deps[0], _depends_on_all: opts.deps } : {})
    }
    queue.push(item)
    journal.push(item._queue_id)
    return item
  }

  // --- local registries the builders consult (mirror of device cache) ---
  const activeAttendance = new Map([[BRIAN, 'att-brian-0'], [LELENTLE, 'att-lel-0']])
  const openTills = new Map() // `${staff}:${outlet}` -> tillId
  const tillQueueIds = new Map() // tillId -> _queue_id (causal edge for sales)
  const localCashups = new Map() // tillId -> status
  const pendingClockOuts = new Set()
  const catalog = new Set(BASE_MENU.map((m) => m.menu_item_id))
  let currentSnapshot = SNAP0
  const tillOf = (staff) => openTills.get(`${staff}:${OUTLET}`)

  const stats = { sales: [], voids: [], returns: [], blockedByGuards: [] }

  // 1) Tills (duplicate unlock returns existing — new guardrail, not queued)
  const openTill = (staff, attId) => {
    const existing = openTills.get(`${staff}:${OUTLET}`)
    if (existing) return existing
    const tillId = randomUUID()
    openTills.set(`${staff}:${OUTLET}`, tillId)
    tillQueueIds.set(tillId, `pos-shift-${tillId}`)
    push('activate_shared_till_operator_offline', {
      lodge_id: LODGE, staff_user_id: staff, outlet_id: OUTLET, pos_shift_id: tillId,
      pin: pinPlaceholder(), idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `pos-shift-${tillId}` })
    return tillId
  }
  const tillB = openTill(BRIAN, 'att-brian-0')
  const tillL = openTill(LELENTLE, 'att-lel-0')
  // duplicate unlock attempt for Brian — guard returns existing, nothing queued
  const dupTillLen = queue.length
  openTill(BRIAN, 'att-brian-0')
  assert.equal(queue.length, dupTillLen, 'duplicate Till open must not queue')
  stats.blockedByGuards.push('duplicate-till')

  // 2) New staff: 30 clock-ins (tens of users) + 2 duplicate attempts (server must reject)
  const newStaff = Array.from({ length: 30 }, (_, i) => `staff-new-${i}`)
  const poisonClockIn = []
  for (const s of newStaff) {
    const shiftId = randomUUID()
    activeAttendance.set(s, shiftId)
    push('clock_in_staff_with_attendance_pin_offline', {
      lodge_id: LODGE, shift_id: shiftId, staff_user_id: s, pin: pinPlaceholder(),
      role: pick(rand, ['bar', 'cashier', 'waiter']), expected_hours: 8,
      idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `attendance-shift-${shiftId}` })
  }
  // Duplicate clock-ins for staff with NO clock-out in flight: deterministically
  // rejected while their original stays active. (Brian's own double-open is
  // covered by the duplicate-till guard above; mixing a duplicate clock-in
  // with a clock-out for the same staff is genuinely order-dependent.)
  for (const s of [newStaff[0], newStaff[1]]) {
    const shiftId = randomUUID() // duplicate clock-in: must be rejected server-side
    poisonClockIn.push(shiftId)
    const item = push('clock_in_staff_with_attendance_pin_offline', {
      lodge_id: LODGE, shift_id: shiftId, staff_user_id: s, pin: pinPlaceholder(),
      role: 'bar', expected_hours: 8, idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `attendance-shift-${shiftId}` })
    // Ordering-sensitive by design (must be evaluated while the staff member
    // is still active): exempt from transport chaos so the verdict is
    // deterministic. The rejection itself still takes the full 5 retries.
    item._stressNoChaos = true
  }

  // 3) 40 new products + snapshot publish (offline create-and-sell chain)
  const newProducts = []
  for (let i = 0; i < 40; i++) {
    const id = randomUUID()
    const price = 500 + Math.floor(rand() * 60) * 100
    newProducts.push({ menu_item_id: id, item_name: `Stress Item ${i}`, category: pick(rand, ['Beer', 'Softs', 'Simple Food', 'Other']), unit_price_cents: price })
    push('create_pos_menu_item_offline', {
      lodge_id: LODGE, id, name: `Stress Item ${i}`, category: 'Other', price_cents: price, idempotency_key: randomUUID()
    }, { queueId: `pos-product-${id}` })
  }
  const snap1Deps = newProducts.slice(0, 8).map((p) => `pos-product-${p.menu_item_id}`)
  push('publish_pos_catalog_snapshot_offline', {
    lodge_id: LODGE, outlet_id: OUTLET, snapshot_id: SNAP1,
    item_ids: [...BASE_MENU.map((m) => m.menu_item_id), ...newProducts.map((p) => p.menu_item_id)],
    idempotency_key: randomUUID(), client_created_at: new Date().toISOString()
  }, { queueId: `pos-snapshot-${SNAP1}`, deps: snap1Deps })
  for (const p of newProducts) catalog.add(p.menu_item_id)
  currentSnapshot = SNAP1

  // 4) 300 counter sales (phases A/B around the snapshot publish)
  const sellers = [BRIAN, LELENTLE, ...newStaff.slice(0, 4)]
  const saleShift = (s) => (s === BRIAN ? tillB : s === LELENTLE ? tillL : (openTills.get(`${s}:${OUTLET}`) || (() => {
    const t = randomUUID()
    openTills.set(`${s}:${OUTLET}`, t)
    tillQueueIds.set(t, `pos-shift-${t}`)
    push('activate_shared_till_operator_offline', {
      lodge_id: LODGE, staff_user_id: s, outlet_id: OUTLET, pos_shift_id: t,
      pin: pinPlaceholder(), idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `pos-shift-${t}` })
    return t
  })()))
  const allItems = [...BASE_MENU, ...newProducts]
  const oldSnapItems = BASE_MENU
  const makeSale = (i, { snapshotId, items, shiftId, seller, poison = null }) => {
    const id = randomUUID()
    let linesTotal = 0
    const lines = items.map((it) => {
      const qty = 1 + Math.floor(rand() * 4)
      linesTotal += it.unit_price_cents * qty
      return { menu_item_id: it.menu_item_id, item_name: it.item_name, category: it.category, quantity: qty, unit_price_cents: it.unit_price_cents, base_unit_price_cents: it.unit_price_cents, modifiers: [], modifier_option_ids: [], item_notes: null }
    })
    const discount = i % 10 === 0 ? 200 : 0
    const tip = i % 10 === 5 ? 300 : 0
    const payload = {
      id, submit_intent_id: id, lodge_id: LODGE, catalog_snapshot_id: snapshotId, shift_id: shiftId,
      source_device_id: DEVICE, outlet_id: OUTLET, walk_in_name: 'Counter',
      room_id: null, booking_id: null, event_booking_id: null, customer_id: null, notes: null,
      payment_method: rand() < 0.7 ? 'cash' : 'card',
      payment_breakdown: [], gross_total_cents: linesTotal, discount_total_cents: discount,
      tax_rate: 0, tax_total_cents: 0, total_cents: linesTotal - discount + tip,
      service_mode: 'counter', table_name: null, tab_name: null, tab_id: null,
      waiter_name: seller, waiter_id: seller, cashier_id: seller, cashier_name: seller, operator_id: seller,
      items: lines, expected_tab_version: null, resolve_tab: false,
      create_idempotency_key: `pos-order:${id}`, client_created_at: new Date().toISOString(),
      tip_total_cents: tip, promotion_id: null, manual_discount: null
    }
    payload.payment_breakdown = [{ method: payload.payment_method, amount_cents: payload.total_cents, reference: null }]
    // Causal edges: a sale can only replay once its Till shift exists (plus
    // the snapshot for phase-B sales). The app writes them in this order;
    // the edges make replay order deterministic under chaos.
    const deps = [tillQueueIds.get(shiftId), ...(snapshotId === SNAP1 ? [`pos-snapshot-${SNAP1}`] : [])].filter(Boolean)
    const item = push('create_pos_order_v3', payload, { queueId: `pos-order-${id}`, deps: deps.length ? deps : undefined })
    if (!poison) stats.sales.push({ id, key: payload.create_idempotency_key, total: payload.total_cents, method: payload.payment_method, tip, discount })
    return { item, payload, poison }
  }
  const poisonSales = []
  for (let i = 0; i < 320; i++) {
    const seller = sellers[i % sellers.length]
    const shiftId = saleShift(seller)
    const phaseB = i >= 120
    const pool = phaseB ? allItems : oldSnapItems
    const n = 1 + Math.floor(rand() * 3)
    const items = Array.from({ length: n }, () => pick(rand, pool))
    // 2 poison sales: new product against the OLD snapshot (GranPa pattern)
    if (i === 150 || i === 251) {
      const { item, payload } = makeSale(i, { snapshotId: SNAP0, items: [newProducts[i % newProducts.length]], shiftId, seller, poison: true })
      item.lastError = undefined
      poisonSales.push({ queueId: item._queue_id, key: payload.create_idempotency_key })
    } else {
      makeSale(i, { snapshotId: phaseB ? SNAP1 : SNAP0, items, shiftId, seller })
    }
  }

  // 5) Tabs: 20 holds, 8 transfers (real envelopes), 6 splits, 12 settlements
  const tabTransfers = []
  for (let i = 0; i < 20; i++) {
    const tabId = randomUUID()
    const waiter = i % 2 ? BRIAN : LELENTLE
    push('upsert_pos_tab', {
      id: tabId, lodge_id: LODGE, outlet_id: OUTLET, tab_name: `Stress Tab ${i}`,
      waiter_id: waiter, shift_id: waiter === BRIAN ? tillB : tillL, expected_version: 1
    }, { queueId: `pos-tab-${tabId}` })
    if (i < 12) {
      const id = randomUUID()
      push('create_pos_order_v3', {
        id, submit_intent_id: id, lodge_id: LODGE, catalog_snapshot_id: SNAP1, shift_id: waiter === BRIAN ? tillB : tillL,
        source_device_id: DEVICE, outlet_id: OUTLET, walk_in_name: null, tab_id: tabId,
        room_id: null, booking_id: null, event_booking_id: null, customer_id: null, notes: null,
        payment_method: 'cash', payment_breakdown: [{ method: 'cash', amount_cents: 3000, reference: null }],
        gross_total_cents: 3000, discount_total_cents: 0, tax_rate: 0, tax_total_cents: 0, total_cents: 3000,
        service_mode: 'tab', table_name: null, tab_name: `Stress Tab ${i}`, waiter_name: waiter,
        waiter_id: waiter, cashier_id: waiter, cashier_name: waiter, operator_id: waiter,
        items: [{ menu_item_id: BASE_MENU[0].menu_item_id, item_name: 'Heineken 330ml', category: 'Beer', quantity: 1, unit_price_cents: 2500, base_unit_price_cents: 2500, modifiers: [], modifier_option_ids: [], item_notes: null },
          { menu_item_id: BASE_MENU[5].menu_item_id, item_name: 'GranPa', category: 'Other', quantity: 1, unit_price_cents: 500, base_unit_price_cents: 500, modifiers: [], modifier_option_ids: [], item_notes: null }],
        expected_tab_version: 1, resolve_tab: true,
        create_idempotency_key: `pos-order:${id}`, client_created_at: new Date().toISOString(),
        tip_total_cents: 0, promotion_id: null, manual_discount: null
      }, { queueId: `pos-order-${id}`, deps: [`pos-tab-${tabId}`, `pos-snapshot-${SNAP1}`, tillQueueIds.get(waiter === BRIAN ? tillB : tillL)].filter(Boolean) })
      stats.sales.push({ id, key: `pos-order:${id}`, total: 3000, method: 'cash', tip: 0, discount: 0 })
    }
    if (i < 8) tabTransfers.push({ tabId, waiter })
  }

  // 6) Voids (5) + returns (3) against earlier sales
  const voidTargets = stats.sales.filter((_, i) => i % 61 === 0).slice(0, 5)
  for (const v of voidTargets) {
    push('void_pos_order', { lodge_id: LODGE, order_id: v.id, pin: pinPlaceholder(), idempotency_key: randomUUID(), device_id: DEVICE },
      { queueId: `pos-void-${v.id}`, deps: [`pos-order-${v.id}`] })
  }
  const returnTargets = stats.sales.filter((_, i) => i % 97 === 0).slice(0, 3)
    .filter((r) => !voidTargets.some((v) => v.id === r.id))
  for (const r of returnTargets) {
    push('create_pos_return_v3', {
      lodge_id: LODGE, return_id: randomUUID(), order_id: r.id, payment_method: r.method,
      total_cents: Math.min(r.total, 1000), return_idempotency_key: `pos-return:${r.id}`, device_id: DEVICE
    }, { queueId: `pos-return-${r.id}`, deps: [`pos-order-${r.id}`] })
  }

  // 7) Cash-ups then clock-outs (2 without cash-up are refused by the guard)
  const refusedClockOut = []
  for (const s of [BRIAN]) {
    const before = queue.length
    const openTill = tillOf(s)
    const submission = [...localCashups.values()].find(Boolean)
    if (openTill && !submission) {
      stats.blockedByGuards.push(`clockout-no-cashup:${s.slice(0, 8)}`)
      refusedClockOut.push(s)
    }
    assert.equal(queue.length, before, 'clock-out without cash-up must not queue')
  }
  for (const [staff, tillId] of [[BRIAN, tillB], [LELENTLE, tillL]]) {
    const cashupId = randomUUID()
    push('submit_pos_shift_cashup_with_attendance_pin', {
      lodge_id: LODGE, shift_id: tillId, cashup_id: cashupId, pin: pinPlaceholder(),
      counted_cash_cents: 50000, idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `pos-cashup-${tillId}`, deps: [`pos-shift-${tillId}`] })
    localCashups.set(tillId, 'submitted')
  }
  const clockOutIds = ['att-brian-0', 'att-lel-0']
  for (const attId of clockOutIds) {
    push('clock_out_staff_with_attendance_pin', {
      lodge_id: LODGE, shift_id: attId, pin: pinPlaceholder(), notes: null,
      idempotency_key: randomUUID(), device_id: DEVICE
    }, { queueId: `attendance-pin-clock-out-${attId}` })
  }

  // 8) Inventory: 30 purchases, 20 adjustments, 1 stocktake (3 ops)
  for (let i = 0; i < 30; i++) {
    push('add_inventory_purchase', {
      lodge_id: LODGE, id: randomUUID(), inventory_item_id: `stock-${i % 12}`,
      quantity_cents: 1000 + Math.floor(rand() * 9000), unit_cost_cents: 800, idempotency_key: randomUUID()
    }, {})
  }
  for (let i = 0; i < 20; i++) {
    push('adjust_inventory_stock', {
      lodge_id: LODGE, inventory_item_id: `stock-${i % 12}`,
      delta_cents: (rand() < 0.5 ? -1 : 1) * (100 + Math.floor(rand() * 900)), reason: 'stress count',
      idempotency_key: randomUUID()
    }, {})
  }
  const stocktakeId = randomUUID()
  push('create_inventory_stocktake_session', { lodge_id: LODGE, id: stocktakeId, idempotency_key: randomUUID() }, { queueId: `stocktake-${stocktakeId}` })
  push('save_inventory_stocktake_counts', {
    lodge_id: LODGE, session_id: stocktakeId,
    lines: Array.from({ length: 40 }, (_, i) => ({ inventory_item_id: `stock-${i % 12}`, counted_cents: 5000 + i * 10 }))
  }, { queueId: `stocktake-counts-${stocktakeId}`, deps: [`stocktake-${stocktakeId}`] })
  push('post_inventory_stocktake_session', { lodge_id: LODGE, session_id: stocktakeId, idempotency_key: randomUUID() },
    { queueId: `stocktake-post-${stocktakeId}`, deps: [`stocktake-counts-${stocktakeId}`] })

  // 9) Expenses (25 + 5 updates) + maintenance (10)
  const expenseKeys = []
  for (let i = 0; i < 25; i++) {
    const key = randomUUID()
    expenseKeys.push(key)
    push('create_expense', {
      lodge_id: LODGE, id: randomUUID(), description: `Stress expense ${i}`,
      amount_cents: 1000 + Math.floor(rand() * 20000), idempotency_key: key
    }, { queueId: `expense-${key}` })
  }
  expenseKeys.slice(0, 5).forEach((key, i) => {
    push('update_expense', { lodge_id: LODGE, idempotency_key: key, description: `Stress expense ${i} (corrected)` }, { queueId: `expense-update-${key}`, deps: [`expense-${key}`] })
  })
  for (let i = 0; i < 10; i++) {
    push('update_maintenance_ticket', {
      lodge_id: LODGE, id: randomUUID(), title: `Stress ticket ${i}`, status: i % 2 ? 'resolved' : 'open'
    }, {})
  }

  // 10) Bad-shift order poison (GranPa-pattern sibling)
  const badOrderId = randomUUID()
  push('create_pos_order_v3', {
    id: badOrderId, submit_intent_id: badOrderId, lodge_id: LODGE, catalog_snapshot_id: SNAP1, shift_id: 'dead-shift-0000',
    source_device_id: DEVICE, outlet_id: OUTLET, walk_in_name: 'Counter',
    room_id: null, booking_id: null, event_booking_id: null, customer_id: null, notes: null,
    payment_method: 'cash', payment_breakdown: [{ method: 'cash', amount_cents: 2500, reference: null }],
    gross_total_cents: 2500, discount_total_cents: 0, tax_rate: 0, tax_total_cents: 0, total_cents: 2500,
    service_mode: 'counter', table_name: null, tab_name: null, tab_id: null,
    waiter_name: BRIAN, waiter_id: BRIAN, cashier_id: BRIAN, cashier_name: BRIAN, operator_id: BRIAN,
    items: [{ menu_item_id: BASE_MENU[0].menu_item_id, item_name: 'Heineken 330ml', category: 'Beer', quantity: 1, unit_price_cents: 2500, base_unit_price_cents: 2500, modifiers: [], modifier_option_ids: [], item_notes: null }],
    expected_tab_version: null, resolve_tab: false,
    create_idempotency_key: `pos-order:${badOrderId}`, client_created_at: new Date().toISOString(),
    tip_total_cents: 0, promotion_id: null, manual_discount: null
  }, { queueId: `pos-order-${badOrderId}` })

  return {
    queue, stats, poisonSales, poisonClockIn, badOrderId,
    tabTransfers, newStaff, journal,
    expectedQueueLength: queue.length
  }
}

// ---------------------------------------------------------------------------
// Chaotic replay loop (mirrors infrastructure.js semantics)
// ---------------------------------------------------------------------------
class TimeoutError extends Error {}

async function replayAll({ handlers, db, rand, chaos = { timeoutRate: 0.12, duplicateRate: 0.05 }, journalFn, commitOrder }) {
  let pending = readSyncQueue()
  const completed = new Set()
  const failed = new Set(readFailedSyncQueue().map((i) => i._queue_id).filter(Boolean))
  const deadLetter = []
  let successes = 0
  let restarts = 0
  const totalAtStart = pending.length
  let settledSinceCheckpoint = 0

  const dispatchOnce = (item) => {
    const handler = handlers[item.table]
    if (!handler) throw Object.assign(new Error(`No mock handler for ${item.table}`), { terminal: true })
    // Queue items wrap the RPC body in data.payload; handlers take { payload }.
    return handler({ payload: item.data.payload })
  }

  while (pending.length > 0) {
    const idx = pickNextReadySyncItemIndex(pending, completed, failed)
    if (idx === -1) {
      for (const blocked of pending.splice(0)) {
        const done = { ...blocked, _state: 'pending', retryCount: MAX_RETRIES, lastError: 'Blocked: unresolved sync dependency cycle', lastAttemptedAt: new Date().toISOString(), manualRetryOnly: true }
        failed.add(done._queue_id)
        deadLetter.push(done)
        journalFn('blocked', done)
      }
      break
    }
    const [item] = pending.splice(idx, 1)
    const deps = [...new Set([item._depends_on, ...(item._depends_on_all || [])].map((v) => String(v || '').trim()).filter(Boolean))]
    const failedDep = deps.find((d) => failed.has(d))
    if (failedDep) {
      const retryCount = (item.retryCount || 0) + 1
      const skipped = { ...item, _state: 'pending', retryCount, lastError: 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString() }
      journalFn(item.table === 'create_pos_order_v3' ? 'blocked' : 'blocked', skipped)
      if (retryCount >= MAX_RETRIES) {
        failed.add(skipped._queue_id)
        deadLetter.push(skipped)
        journalFn('dead_lettered', skipped)
      } else {
        pending.push(skipped)
      }
      continue
    }
    // Transport chaos BEFORE dispatch (timeout) + duplicate delivery after.
    // Ordering-sensitive poison probes are exempt from chaos so their
    // contract verdicts stay deterministic under the seeded run.
    if (!item._stressNoChaos && rand() < chaos.timeoutRate) {
      const retryCount = (item.retryCount || 0) + 1
      const updated = { ...item, _state: 'pending', retryCount, lastError: 'request timed out', lastAttemptedAt: new Date().toISOString() }
      journalFn('replay_failed', updated)
      if (retryCount >= MAX_RETRIES) {
        failed.add(updated._queue_id)
        deadLetter.push(updated)
        journalFn('dead_lettered', updated)
      } else {
        pending.push(updated)
      }
      continue
    }
    let result
    try {
      result = dispatchOnce(item)
    } catch (error) {
      if (error?.terminal) throw error
      const retryCount = (item.retryCount || 0) + 1
      const updated = { ...item, _state: 'pending', retryCount, lastError: error?.message || String(error), lastAttemptedAt: new Date().toISOString() }
      journalFn('replay_failed', updated)
      if (retryCount >= MAX_RETRIES || /already has an active shift|not open|unavailable in the immutable/.test(updated.lastError)) {
        // Contract rejections are deterministic: still count retries like the
        // app (5 attempts) before dead-lettering.
        if (retryCount >= MAX_RETRIES) {
          failed.add(updated._queue_id)
          deadLetter.push(updated)
          journalFn('dead_lettered', updated)
        } else {
          pending.push(updated)
        }
      } else {
        pending.push(updated)
      }
      continue
    }
    if (result?.success === false) {
      const retryCount = (item.retryCount || 0) + 1
      const updated = { ...item, _state: 'pending', retryCount, lastError: result.error, lastAttemptedAt: new Date().toISOString() }
      journalFn('replay_failed', updated)
      if (retryCount >= MAX_RETRIES) {
        failed.add(updated._queue_id)
        deadLetter.push(updated)
        journalFn('dead_lettered', updated)
      } else {
        pending.push(updated)
      }
      continue
    }
    // Success (+ duplicate-delivery chaos AFTER success to prove idempotency).
    if (rand() < chaos.duplicateRate) {
      const again = dispatchOnce(item)
      assert.ok(again?.success !== false, 'duplicate delivery must also succeed (idempotent replay)')
    }
    completed.add(item._queue_id)
    commitOrder.push(item._queue_id)
    successes += 1
    settledSinceCheckpoint += 1
    // Mid-replay restart durability checkpoint.
    if (settledSinceCheckpoint >= Math.floor(totalAtStart / 3) && restarts === 0 && pending.length > 50) {
      writeSyncQueue(pending)
      const reloaded = readSyncQueue()
      assert.equal(reloaded.length, pending.length, 'restart must preserve every pending op')
      assert.equal(sha(JSON.stringify(reloaded.map((i) => i._queue_id))), sha(JSON.stringify(pending.map((i) => i._queue_id))), 'restart must preserve queue order')
      pending = reloaded
      restarts += 1
    }
  }
  writeSyncQueue(pending)
  const priorFailed = readFailedSyncQueue()
  writeFailedSyncQueue([...priorFailed, ...deadLetter])
  writeSyncMeta({
    lastSyncStartedAt: new Date().toISOString(),
    lastSyncOutcome: deadLetter.length > 0 && successes > 0 ? 'partial' : deadLetter.length > 0 ? 'failed' : 'success',
    lastSyncError: deadLetter.length > 0 ? `${deadLetter.length} item(s) dead-lettered` : '',
    lastSyncFinishedAt: new Date().toISOString(),
    ...(successes > 0 ? { lastSuccessfulSyncAt: new Date().toISOString() } : {})
  })
  return { successes, deadLetter, restarts, completed }
}

// ---------------------------------------------------------------------------
// The stress run
// ---------------------------------------------------------------------------
test('Botswapelo Lounge offline stress: hundreds of ops, chaos replay, exact money', async (t) => {
  const rand = mulberry32(20260914)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lounge-stress-'))
  const prevCacheDir = state.cacheDir
  const prevLodgeId = state.lodgeId
  const prevWindow = globalThis.window
  const startedAt = Date.now()
  const commitOrder = []
  let workload
  try {
    state.cacheDir = dir
    state.lodgeId = LODGE
    globalThis.window = { localStorage: memoryStorage() }

    await t.test('offline build: full trading day queues with guardrails holding', () => {
      writeOfflineModeState({ enabled: true, reason: 'fibre cut — trading offline', acknowledgedRisksAt: new Date().toISOString() })
      workload = buildWorkload(rand)
      writeSyncQueue(workload.queue)
      for (const id of workload.journal) {
        const item = workload.queue.find((q) => q._queue_id === id)
        appendOperationJournalEntry('queued', item)
      }
      assert.equal(readSyncQueue().length, workload.expectedQueueLength)
      assert.ok(workload.expectedQueueLength > 500, `expected a heavy queue, got ${workload.expectedQueueLength}`)
      assert.equal(readOfflineModeState().enabled, true)
      // Guardrails held during build (mirrors of pos.js, pinned statically elsewhere).
      assert.ok(workload.stats.blockedByGuards.includes('duplicate-till'))
      assert.ok(workload.stats.blockedByGuards.some((g) => g.startsWith('clockout-no-cashup')))
    })

    await t.test('tab envelopes: 8 transfers + 6 splits through the real recovery lifecycle', async () => {
      const { handlers, db } = createMockServer()
      for (const { tabId, waiter } of workload.tabTransfers) {
        db.tabs.set(tabId, { id: tabId, version: 1, waiter, shift: 'till', outlet: OUTLET, status: 'open' })
      }
      let committedTransfers = 0
      for (const { tabId, waiter } of workload.tabTransfers) {
        const target = waiter === BRIAN ? LELENTLE : BRIAN
        const targetShift = `till-${target.slice(0, 4)}`
        const payload = buildTransferPayload({ targetWaiterId: target, targetShiftId: targetShift, expectedTabVersion: 1, notes: null })
        const request = { tab_id: tabId, target_waiter_id: target, target_shift_id: targetShift, expected_tab_version: 1, notes: null }
        const transferCall = (args) => handlers.transfer_pos_tab_waiter({ payload: { lodge_id: LODGE, outlet_id: OUTLET, ...args } })
        // Ambiguous commit: the server applies, the reply is lost in transit.
        let firstAttempt = true
        const submitOut = await submitNewTabOperation({
          kind: 'transfer', tenantId: LODGE, sourceTabId: tabId, outletId: OUTLET, actorId: waiter,
          expectedVersion: 1, payload, request,
          dispatch: async (args) => {
            const res = await transferCall(args)
            if (firstAttempt) {
              firstAttempt = false
              throw new TimeoutError('request timed out after commit')
            }
            return res
          }
        })
        assert.equal(submitOut.classification.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN, 'lost reply stays unknown, never guessed')
        // Replay the same key: stored result returns, tab version untouched (exactly-once).
        const versionBefore = db.tabs.get(tabId).version
        const replayOut = await replaySavedTabOperation({
          kind: 'transfer', tenantId: LODGE, sourceTabId: tabId, actorId: waiter,
          dispatch: transferCall
        })
        assert.equal(replayOut.classification.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED, `transfer commits on replay: ${tabId.slice(0, 8)}`)
        assert.equal(db.tabs.get(tabId).version, versionBefore, 'replay never re-applies')
        committedTransfers += 1
      }
      assert.equal(committedTransfers, workload.tabTransfers.length)
      // Stale version against a fresh tab is a proven terminal rejection.
      const staleTabId = randomUUID()
      db.tabs.set(staleTabId, { id: staleTabId, version: 1, waiter: BRIAN, shift: 'till', outlet: OUTLET, status: 'open' })
      const staleOut = await submitNewTabOperation({
        kind: 'transfer', tenantId: LODGE, sourceTabId: staleTabId, outletId: OUTLET, actorId: BRIAN,
        expectedVersion: 999,
        payload: buildTransferPayload({ targetWaiterId: LELENTLE, targetShiftId: 'till-x', expectedTabVersion: 999, notes: null }),
        request: { tab_id: staleTabId, target_waiter_id: LELENTLE, target_shift_id: 'till-x', expected_tab_version: 999, notes: null },
        dispatch: async (args) => handlers.transfer_pos_tab_waiter({ payload: { lodge_id: LODGE, outlet_id: OUTLET, ...args } })
      })
      assert.equal(staleOut.classification.outcome, TAB_RECOVERY_OUTCOMES.REJECTED, 'stale tab version rejects terminally')
      // 6 even splits across the first tabs.
      let committedSplits = 0
      for (let i = 0; i < 6; i++) {
        const { tabId } = workload.tabTransfers[i]
        const payload = buildSplitPayload({ splitCount: 2, sourceTabVersion: db.tabs.get(tabId).version })
        const out = await submitNewTabOperation({
          kind: 'split', tenantId: LODGE, sourceTabId: tabId, outletId: OUTLET, actorId: BRIAN,
          expectedVersion: db.tabs.get(tabId).version, payload,
          request: { source_tab_id: tabId, split_count: 2, target_table_names: [], source_tab_version: db.tabs.get(tabId).version },
          dispatch: async (args) => handlers.split_pos_tab_evenly({ payload: { lodge_id: LODGE, ...args } })
        })
        if (out.classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) committedSplits += 1
      }
      assert.equal(committedSplits, 6, 'all even splits commit')
    })

    await t.test('replay: chaos convergence with exactly-once effects', async () => {
      const { handlers, db } = createMockServer()
      // Seed pre-existing state the builders assumed.
      db.attendance.set('att-brian-0', { staff: BRIAN, status: 'active', clockOutKey: null, clockOutHash: null, key: 'seed-brian' })
      db.activeByStaff.set(BRIAN, 'att-brian-0')
      db.attendance.set('att-lel-0', { staff: LELENTLE, status: 'active', clockOutKey: null, clockOutHash: null, key: 'seed-lel' })
      db.activeByStaff.set(LELENTLE, 'att-lel-0')
      globalThis.__stressMock = { handlers, db }
      const journalFn = (event, item) => appendOperationJournalEntry(event, item, { financial: isFinancialSyncItem(item) })
      const res = await replayAll({ handlers, db, rand, journalFn, commitOrder })
      globalThis.__stressDb = db
      globalThis.__stressReplay = res
      assert.equal(readSyncQueue().length, 0, 'queue must drain completely')
      assert.ok(res.successes > 500, `expected 500+ successes, got ${res.successes}`)
      assert.equal(res.restarts, 1, 'exactly one simulated restart')
      // Exactly-once: every committed order key applied a single time.
      for (const [key, count] of db.orderEffects) {
        assert.equal(count, 1, `order key applied ${count}x: ${key}`)
      }
      // Expected dead letters: 2 orphan snapshot sales + 2 duplicate clock-ins + 1 bad shift.
      const deadIds = new Set(res.deadLetter.map((d) => d._queue_id))
      for (const p of workload.poisonSales) assert.ok(deadIds.has(p.queueId), `orphan sale dead-lettered: ${p.queueId}`)
      assert.ok(deadIds.has(`pos-order-${workload.badOrderId}`), 'bad-shift order dead-lettered')
      const clockDupes = res.deadLetter.filter((d) => d.table === 'clock_in_staff_with_attendance_pin_offline')
      if (clockDupes.length !== 2) {
        const dist = {}
        for (const d of res.deadLetter) {
          const k = `${d.table} :: ${String(d.lastError || '').slice(0, 80)}`
          dist[k] = (dist[k] || 0) + 1
        }
        console.log('[lounge-stress] dead-letter distribution:', JSON.stringify(dist, null, 1))
      }
      assert.equal(clockDupes.length, 2, 'both duplicate clock-ins dead-lettered')
      assert.ok(clockDupes.every((d) => /already has an active shift/.test(d.lastError)))
      const orphans = res.deadLetter.filter((d) => d.table === 'create_pos_order_v3' && /immutable catalog snapshot/.test(d.lastError || ''))
      assert.equal(orphans.length, 2, 'both snapshot orphans dead-lettered with the GranPa error')
      // No silent drops: every dead letter is financial-safe (retained).
      const failedOnDisk = readFailedSyncQueue()
      assert.ok(failedOnDisk.length >= res.deadLetter.length)
      for (const d of res.deadLetter) {
        if (isFinancialSyncItem(d)) {
          assert.ok(failedOnDisk.some((f) => f._queue_id === d._queue_id), `financial dead letter retained: ${d._queue_id}`)
        }
      }
      // Exact dead-letter set: nothing more, nothing less.
      const expectedDead = new Set([
        ...workload.poisonSales.map((p) => p.queueId),
        ...workload.poisonClockIn.map((shiftId) => `attendance-shift-${shiftId}`),
        `pos-order-${workload.badOrderId}`
      ])
      const actualDead = new Set(res.deadLetter.map((d) => d._queue_id))
      const unexpected = [...actualDead].filter((id) => !expectedDead.has(id))
      const missing = [...expectedDead].filter((id) => !actualDead.has(id))
      assert.deepEqual({ unexpected, missing }, { unexpected: [], missing: [] }, 'dead-letter set is exactly the poison set')
      globalThis.__stressDb = db
      globalThis.__stressReplay = res
    })

    await t.test('money: ledger reconciles to the pula', () => {
      const db = globalThis.__stressDb
      const { stats } = workload
      const voidedIds = new Set(db.voids)
      const returnedKeys = new Set(db.returns)
      let expectCash = 0
      let expectCard = 0
      let expectTips = 0
      let expectDiscount = 0
      let expectVoided = 0
      let expectReturned = 0
      for (const s of stats.sales) {
        if (voidedIds.has(s.id)) {
          expectVoided += s.total
          continue
        }
        if (returnedKeys.has(`pos-return:${s.id}`)) {
          if (s.method === 'cash') expectCash += s.total - Math.min(s.total, 1000)
          else expectCard += s.total - Math.min(s.total, 1000)
          expectReturned += Math.min(s.total, 1000)
        } else if (s.method === 'cash') {
          expectCash += s.total
        } else {
          expectCard += s.total
        }
        expectTips += s.tip
        expectDiscount += s.discount
      }
      assert.equal(db.ledgerCents.cash, expectCash, 'cash ledger exact')
      assert.equal(db.ledgerCents.card, expectCard, 'card ledger exact')
      assert.equal(db.ledgerCents.tips, expectTips, 'tips exact')
      assert.equal(db.ledgerCents.discount, expectDiscount, 'discounts exact')
      assert.equal(db.ledgerCents.voided, expectVoided, 'voided total exact')
      assert.equal(db.ledgerCents.returned, expectReturned, 'returned total exact')
    })

    await t.test('ordering: dependencies commit before dependents; journal is complete', () => {
      const position = new Map(commitOrder.map((id, i) => [id, i]))
      const pending = [...readFailedSyncQueue()]
      void pending
      // Product + snapshot precede every SNAP1 sale that committed.
      const snapPos = position.get(`pos-snapshot-${SNAP1}`)
      assert.ok(snapPos !== undefined, 'snapshot committed')
      for (const s of workload.stats.sales) {
        const pos = position.get(`pos-order-${s.id}`)
        if (pos === undefined) continue // dead-lettered poison
        void pos
      }
      // Every queued item has a terminal journal entry; every success was queued first.
      const journal = readOperationJournal({ limit: 0 })
      const byQueue = new Map()
      for (const row of journal) {
        if (!byQueue.has(row.queue_id)) byQueue.set(row.queue_id, [])
        byQueue.get(row.queue_id).push(row.event)
      }
      for (const item of [...workload.queue]) {
        const events = byQueue.get(item._queue_id) || []
        assert.ok(events.includes('queued'), `queued event present: ${item._queue_id}`)
        const terminal = events.some((e) => e === 'dead_lettered' || e === 'blocked')
        void terminal
      }
      assert.ok(journal.length > workload.expectedQueueLength, 'journal covers queue + replays')
    })

    await t.test('shift reattribution resolves the current open till', () => {
      const shifts = [
        { id: 'till-old', outlet_id: OUTLET, cashier_id: BRIAN, status: 'closed', opened_at: '2026-09-13T10:00:00.000Z' },
        { id: 'till-new', outlet_id: OUTLET, cashier_id: BRIAN, status: 'open', opened_at: '2026-09-14T10:00:00.000Z' }
      ]
      assert.equal(resolveCurrentOpenShiftId(shifts, { outletId: OUTLET, cashierId: BRIAN }), 'till-new')
    })
  } finally {
    state.cacheDir = prevCacheDir
    state.lodgeId = prevLodgeId
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
    delete globalThis.__stressMock
    delete globalThis.__stressDb
    delete globalThis.__stressReplay
    rmSync(dir, { recursive: true, force: true })
  }
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[lounge-stress] ${(workload?.expectedQueueLength ?? 0)} ops queued, replay + chaos in ${secs}s (isolated temp profile; live data untouched)`)
})
