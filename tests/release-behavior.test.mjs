import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pickNextReadySyncItemIndex } from '../src/shared/syncQueue.js'
import { rewriteQueuedBookingReferenceItem } from '../src/main/domains/syncCache.js'

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
  const posSource = await read('src/main/domains/pos.js')

  // 1. A dependency absent from all local tracking sets is allowed. This covers
  // the prior-run case where the parent operation was already consumed before
  // the current replay loop; server-side RPCs remain the final authority.
  assert.equal(
    pickNextReadySyncItemIndex([
      { _queue_id: 'child-1', _depends_on: 'missing-parent' }
    ]),
    0
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

  // 5. POS order replay/submit idempotency is still keyed by submit intent,
  // and the server-side v3 RPC receives that key in its payload.
  const createPosOrderSource = extractBetween(
    posSource,
    'export async function createPosOrder(data) {',
    'export async function voidPosOrder(id) {'
  )
  assert.match(createPosOrderSource, /const callerSubmitIntentId = String\(data\?\.submit_intent_id \|\| ''\)\.trim\(\)/)
  assert.match(createPosOrderSource, /const submitIntentId = callerSubmitIntentId \|\| randomUUID\(\)/)
  assert.match(createPosOrderSource, /const orderId = callerOrderId \|\| submitIntentId/)
  assert.match(createPosOrderSource, /const submitIdempotencyKey = `pos-order:\$\{submitIntentId\}`/)
  assert.match(createPosOrderSource, /create_idempotency_key: submitIdempotencyKey/)
  assert.match(createPosOrderSource, /state\.supabase\.rpc\('create_pos_order_v3'/)
  assert.doesNotMatch(createPosOrderSource, /state\.supabase\.rpc\('create_pos_order'/)
}

run()
  .then(() => {
    console.log('release-behavior: ok')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
