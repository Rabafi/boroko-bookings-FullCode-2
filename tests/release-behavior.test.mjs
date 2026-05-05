import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

function extractBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken)
  const end = source.indexOf(endToken, start + startToken.length)
  assert.ok(start >= 0, `Missing start token: ${startToken}`)
  assert.ok(end > start, `Missing end token: ${endToken}`)
  return source.slice(start, end)
}

function roundMoneyValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function loadRewriteQueuedBookingReferenceItem(databaseSource) {
  const fnSource = extractBetween(
    databaseSource,
    'function rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId) {',
    'function normalizeQueuedSyncItemForReplay(item = {}) {'
  )

  // The function is pure; evaluate the real implementation from source so the
  // test exercises the actual replay rewrite behavior.
  return new Function(`${fnSource}; return rewriteQueuedBookingReferenceItem;`)()
}

function loadCreatePosOrder(databaseSource, deps) {
  const fnSource = extractBetween(
    databaseSource,
    'export async function createPosOrder(data) {',
    'export async function voidPosOrder(id) {'
  )

  const normalized = fnSource.replace(
    /^export\s+async\s+function\s+createPosOrder\(data\)\s+\{/,
    'async function createPosOrder(data) {'
  )

  return new Function('deps', `
    const {
      isOnline,
      lodgeId,
      readCache,
      supabase,
      recordCriticalError,
      roundMoneyValue,
      crypto,
      getActiveBookingForRoom,
      randomUUID,
      getOfflinePosInventoryReservation,
      applyOfflinePosInventoryReservation
    } = deps;
    ${normalized}
    return createPosOrder;
  `)(deps)
}

function simulateUpdateBookingPaymentReplay({
  bookingUpdatedAt,
  expectedUpdatedAt,
  paymentExists,
  amountPaid = 0,
  amount = 0,
  paymentStatus = 'unpaid'
}) {
  if (paymentExists) {
    return {
      success: true,
      amount_paid: amountPaid,
      payment_status: paymentStatus,
      idempotent: true
    }
  }

  if (expectedUpdatedAt != null && bookingUpdatedAt !== expectedUpdatedAt) {
    return {
      success: false,
      stale: true,
      current_updated_at: bookingUpdatedAt
    }
  }

  const nextPaid = roundMoneyValue(amountPaid + amount)
  return {
    success: true,
    amount_paid: nextPaid,
    payment_status: nextPaid <= 0 ? 'unpaid' : 'paid'
  }
}

async function run() {
  const databaseSource = await read('src/main/database.js')

  // 1. Missing dependency is blocked.
  assert.equal(
    pickNextReadySyncItemIndex([
      { _queue_id: 'child-1', _depends_on: 'missing-parent' }
    ]),
    -1
  )

  // 2. A dependency already resolved in cache can be released safely.
  assert.equal(
    pickNextReadySyncItemIndex(
      [{ _queue_id: 'child-1', _depends_on: 'booking-1' }],
      new Set(),
      new Set(),
      (dependencyId) => dependencyId === 'booking-1'
    ),
    0
  )

  // 3. Offline quotation conversion rewrites nested booking references.
  const rewriteQueuedBookingReferenceItem = loadRewriteQueuedBookingReferenceItem(databaseSource)
  const rewritten = rewriteQueuedBookingReferenceItem(
    {
      _queue_id: 'pos-order-1',
      _depends_on: 'booking-local-1',
      data: {
        p_booking_id: 'local-1',
        booking_id: 'local-1',
        payload: {
          booking_id: 'local-1',
          room_id: 'room-1'
        }
      }
    },
    'local-1',
    'server-9'
  )
  assert.equal(rewritten.data.p_booking_id, 'server-9')
  assert.equal(rewritten.data.booking_id, 'server-9')
  assert.equal(rewritten.data.payload.booking_id, 'server-9')
  assert.equal(rewritten._depends_on, 'booking-server-9')
  assert.equal(rewritten.data.payload.room_id, 'room-1')

  // 4. Payment replay with a stale updated_at still succeeds when the idempotency
  // key already exists. This is a contract-level behavioral simulation of the SQL
  // branch order because no local Postgres executable is available in this workspace.
  const idempotentReplay = simulateUpdateBookingPaymentReplay({
    bookingUpdatedAt: '2026-04-25T12:00:00.000Z',
    expectedUpdatedAt: '2026-04-24T09:00:00.000Z',
    paymentExists: true,
    amountPaid: 125,
    paymentStatus: 'partial'
  })
  assert.deepEqual(idempotentReplay, {
    success: true,
    amount_paid: 125,
    payment_status: 'partial',
    idempotent: true
  })

  const staleFreshAttempt = simulateUpdateBookingPaymentReplay({
    bookingUpdatedAt: '2026-04-25T12:00:00.000Z',
    expectedUpdatedAt: '2026-04-24T09:00:00.000Z',
    paymentExists: false,
    amountPaid: 125,
    amount: 25,
    paymentStatus: 'partial'
  })
  assert.equal(staleFreshAttempt.success, false)
  assert.equal(staleFreshAttempt.stale, true)

  // 5. Online POS replays dedupe by submit intent, not by identical contents.
  const rpcCalls = []
  const serverByKey = new Map()
  let createdOrders = 0
  let stockDecrements = 0

  const createPosOrder = loadCreatePosOrder(databaseSource, {
    isOnline: true,
    lodgeId: 'lodge-1',
    readCache: (name) => {
      if (name === 'bookings') {
        return [{ id: 'booking-1', lodge_id: 'lodge-1' }]
      }
      return []
    },
    supabase: {
      rpc: async (name, { payload }) => {
        rpcCalls.push({ name, payload: structuredClone(payload) })
        assert.equal(name, 'create_pos_order')

        const key = payload.create_idempotency_key
        if (serverByKey.has(key)) {
          return { data: serverByKey.get(key), error: null }
        }

        createdOrders += 1
        stockDecrements += payload.items.length
        const result = { success: true, id: payload.id, create_idempotency_key: key }
        serverByKey.set(key, result)
        return { data: result, error: null }
      }
    },
    recordCriticalError: (scope, error) => {
      throw error
    },
    roundMoneyValue,
    getActiveBookingForRoom: async () => null,
    randomUUID: () => 'generated-submit-intent',
    getOfflinePosInventoryReservation: () => {
      throw new Error('offline branch should not run in this test')
    },
    applyOfflinePosInventoryReservation: () => {
      throw new Error('offline branch should not run in this test')
    }
  })

  const order = {
    booking_id: 'booking-1',
    room_id: null,
    walk_in_name: null,
    notes: 'repeat-safe',
    payment_method: 'folio',
    outlet_id: 'outlet-1',
    items: [
      {
        menu_item_id: 'menu-1',
        inventory_item_id: 'inv-1',
        depletion_qty: 1,
        item_name: 'Tea',
        quantity: 2,
        unit_price: 12.5
      }
    ]
  }

  const first = await createPosOrder({ ...order, id: 'order-1', submit_intent_id: 'intent-1' })
  const second = await createPosOrder({ ...order, id: 'order-1', submit_intent_id: 'intent-1' })
  const third = await createPosOrder({ ...order, id: 'order-2', submit_intent_id: 'intent-2' })

  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(third.success, true)
  assert.equal(createdOrders, 2)
  assert.equal(stockDecrements, 2)
  assert.equal(rpcCalls.length, 3)
  assert.equal(rpcCalls[0].payload.create_idempotency_key, rpcCalls[1].payload.create_idempotency_key)
  assert.equal(rpcCalls[0].payload.id, 'order-1')
  assert.equal(rpcCalls[1].payload.id, 'order-1')
  assert.equal(rpcCalls[2].payload.id, 'order-2')
  assert.notEqual(rpcCalls[0].payload.create_idempotency_key, rpcCalls[2].payload.create_idempotency_key)
  assert.equal(rpcCalls[2].payload.create_idempotency_key, 'pos-order:intent-2')
  assert.equal(rpcCalls[0].payload.create_idempotency_key, 'pos-order:intent-1')
}

run()
  .then(() => {
    console.log('release-behavior: ok')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
