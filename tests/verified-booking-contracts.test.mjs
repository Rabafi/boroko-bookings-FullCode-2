import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBookingFinancialView, isPendingBookingFinancial, bookingPaymentStatusLabel } from '../src/shared/bookingFinancials.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing section start: ${start}`)
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1
  return source.slice(startIndex, endIndex === -1 ? undefined : endIndex)
}

test('forward SQL migration contains atomic booking status/import/group/public contracts', () => {
  const sql = read('supabase/migrations/20260904090000_verified_booking_contracts.sql')
  assert.match(sql, /create or replace function public\.update_booking_status\(/)
  assert.match(sql, /paid_cancellation_requires_refund/)
  assert.match(sql, /checkout_balance_due/)
  assert.match(sql, /financial_audit_log/)
  assert.match(sql, /create or replace function public\.import_booking_row\(/)
  assert.match(sql, /update_booking_payment/)
  assert.match(sql, /create or replace function public\.update_campsite_booking\(/)
  assert.match(sql, /create or replace function public\.reschedule_accommodation_booking\(/)
  assert.match(sql, /set_config\('app\.campsite_tents'/)
  assert.match(sql, /create table if not exists public\.booking_group_idempotency/)
  assert.match(sql, /create or replace function public\.create_multi_room_booking\(/)
  assert.match(sql, /booking_invoice_group_lines/)
  assert.match(sql, /for update/)
  assert.match(sql, /order by value->>'room_id'/)
  assert.match(sql, /'booking_group_created'/)
  assert.match(sql, /quote_changed/)
  assert.match(sql, /create_online_booking_legacy/)
  assert.match(sql, /create table if not exists public\.public_booking_idempotency/)
  assert.match(sql, /idempotency_conflict/)
  assert.match(sql, /all_cancelled/)
  assert.match(sql, /v_legacy_fallback_key/)
  assert.match(sql, /v_key := v_hash/)
})

test('bulk booking import uses one authoritative row RPC and preserves per-row errors', () => {
  const source = read('src/main/domains/misc.js')
  const importer = between(source, 'export async function bulkImportBookings', 'async function createImportedEntity')
  assert.match(importer, /state\.supabase\.rpc\('import_booking_row'/)
  assert.match(importer, /p_amount_paid: amountPaid/)
  assert.match(importer, /p_target_status: targetStatus \|\| 'confirmed'/)
  assert.match(importer, /const importBookingId = randomUUID\(\)/)
  assert.match(importer, /p_booking_id: importBookingId/)
  assert.match(importer, /importedResult/)
  assert.match(importer, /errors\.push\(/)
  assert.doesNotMatch(importer, /from\('bookings'\)\s*\.\s*update/)
  assert.doesNotMatch(importer, /updateBookingPayment/)
})

test('desktop multi-room booking is one online RPC or one offline group intent', () => {
  const source = read('src/main/domains/bookings.js')
  const group = between(source, 'export async function createMultiRoomBooking', 'export async function updateBooking')
  assert.match(group, /rpc\('create_multi_room_booking'/)
  assert.match(group, /queueOperation\('rpc', 'create_multi_room_booking'/)
  assert.match(group, /_local_booking_ids/)
  assert.match(group, /p_total_amount: null/)
  assert.match(group, /tents/)
  assert.match(group, /vehicles/)
  assert.equal((group.match(/queueOperation\(/g) || []).length, 1, 'offline group must not emit child queue operations')
  assert.ok(group.indexOf("queueOperation('rpc', 'create_multi_room_booking'") < group.indexOf("writeCache('bookings'"), 'group intent must be durable before optimistic children are exposed')
  assert.doesNotMatch(group, /createBooking\(/)
})

test('offline booking money remains an explicitly labelled estimate', () => {
  const source = read('src/main/domains/bookings.js')
  assert.match(source, /_estimated_total_amount/)
  assert.match(source, /_estimated_amount_paid/)
  assert.match(source, /_estimated_payment_status/)
  assert.match(source, /getBookingFinancialView\(/)
  const pending = {
    total_amount: 0,
    amount_paid: 0,
    _estimated_total_amount: 120,
    _estimated_amount_paid: 20,
    _estimated_payment_status: 'partial',
    _financial_estimate: true
  }
  assert.equal(isPendingBookingFinancial(pending), true)
  assert.deepEqual(getBookingFinancialView(pending), {
    pending: true,
    authoritative: false,
    total: 120,
    charges: 0,
    grandTotal: 120,
    amountPaid: 20,
    outstanding: 100,
    paymentStatus: 'partial',
    statusLabel: 'Pending confirmation'
  })
  assert.equal(bookingPaymentStatusLabel(pending), 'Pending confirmation')
  assert.equal(getBookingFinancialView({ total_amount: 120, amount_paid: 20, payment_status: 'partial' }).authoritative, true)
})

test('update and reschedule pricing use server quote contracts and offline estimate fields', () => {
  const source = read('src/main/domains/bookings.js')
  const update = between(source, 'export async function updateBooking', 'export async function updateBookingStatus')
  const reschedule = between(source, 'export async function rescheduleBooking', 'async function getNextBookingInvoiceNumber')
  assert.match(update, /quote_room_stay/)
  assert.match(update, /accommodation_booking_expected_total/)
  assert.match(update, /update_campsite_booking/)
  assert.match(update, /Could not verify the booking quote/)
  assert.match(update, /_pricing_estimate: true/)
  assert.match(reschedule, /reschedule_accommodation_booking/)
  assert.match(reschedule, /_estimated_total_amount/)
  assert.match(reschedule, /estimated: true/)
})

test('public form persists a UUID key for retries and clears it only after success', () => {
  const source = read('booking-site/src/pages/BookingPage.jsx')
  assert.match(source, /BOOKING_IDEMPOTENCY_KEY/)
  assert.match(source, /readSessionState\(BOOKING_IDEMPOTENCY_KEY\)/)
  assert.match(source, /idempotency_key: idempotencyKey/)
  assert.match(source, /clearSessionState\(BOOKING_IDEMPOTENCY_KEY\)/)
  const submit = between(source, 'async function handleSubmit', '  // Focus heading on mount')
  assert.ok(submit.indexOf('clearSessionState(BOOKING_IDEMPOTENCY_KEY)') > submit.indexOf('if (rpcError || !data?.success)'))
})

test('PWA entitlement and queue persistence fail closed and verify durable writes', () => {
  const api = read('manager-pwa/src/lib/api.js')
  const access = read('manager-pwa/src/lib/access.js')
  const runtime = read('manager-pwa/src/lib/runtime.js')
  assert.match(api, /entitlement_unverified: true/)
  assert.match(api, /enqueueOfflineOperationVerified/)
  assert.match(access, /offline_valid_until/)
  assert.doesNotMatch(access, /cached_at.*DEFAULT_OFFLINE_LEASE_DAYS/)
  assert.match(runtime, /writeLocalJsonVerified/)
  assert.match(runtime, /readLocalJsonVerified\(key\)/)
})

test('group replay marks every local child on failure and maps server IDs on success', () => {
  const source = read('src/main/domains/infrastructure.js')
  const queueContract = read('src/shared/syncQueue.js')
  assert.match(source, /'create_multi_room_booking'/)
  assert.match(source, /_local_booking_ids/)
  assert.match(source, /function patchQueuedBookingSyncStates/)
  assert.match(source, /serverBookingIds/)
  assert.match(source, /sync-conflict/)
  assert.match(source, /booking-invoice-groups/)
  assert.match(queueContract, /'create_multi_room_booking'/)
  assert.match(queueContract, /'update_campsite_booking'/)
  assert.match(queueContract, /'reschedule_accommodation_booking'/)
})

test('explicit public keys never become fresh operations after cancellation', () => {
  const sql = read('supabase/migrations/20260904090000_verified_booking_contracts.sql')
  assert.match(sql, /v_client_key_provided boolean/)
  assert.match(sql, /if v_client_key_provided or not v_all_cancelled then/)
})

test('invoice max+1 lookup is hard-gated', () => {
  const source = read('src/main/domains/finance.js')
  assert.match(source, /allowUnsafeLookup = false/)
  assert.match(source, /lookup fallback is disabled/)
  const bookings = read('src/main/domains/bookings.js')
  assert.doesNotMatch(bookings, /getNextInvoiceNumberByLookup/)
})
