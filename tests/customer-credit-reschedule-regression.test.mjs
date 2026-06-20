import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function read(path) {
  return readFile(join(__dirname, '..', path), 'utf8')
}

async function run() {
  const migration = await read('supabase/migrations/20260620100000_customer_credit_and_booking_reschedule.sql')

  // ── Table and schema ──────────────────────────────────────────────────
  assert.match(migration, /customer_credit_ledger/, 'Migration must create customer_credit_ledger table')
  assert.match(migration, /entry_type.*check/i, 'Ledger must have entry_type CHECK constraint')
  assert.match(migration, /amount.*not null/i, 'Ledger must have amount NOT NULL')
  assert.match(migration, /enable row level security/i, 'Ledger must have RLS enabled')

  // ── UUID actor safety ─────────────────────────────────────────────────
  assert.doesNotMatch(migration, /p_recorded_by\s+or\s+v_actor/, 'Must not use OR on UUIDs — use coalesce()')
  assert.doesNotMatch(migration, /p_approved_by\s+or\s+v_actor/, 'Must not use OR on UUIDs for approved_by')
  assert.doesNotMatch(migration, /p_actor_id\s+or\s+v_actor/, 'Must not use OR on UUIDs for actor_id')
  assert.doesNotMatch(migration, /v_effective_actor\s*:=\s*coalesce\(p_(?:recorded_by|approved_by|actor_id)/, 'Client actor UUIDs must not override authenticated audit identity')
  assert.match(migration, /v_effective_actor\s*:=\s*v_actor/, 'Authenticated session actor must be authoritative')

  // ── Advisory locks ────────────────────────────────────────────────────
  assert.match(migration, /pg_advisory_xact_lock/, 'Must use advisory locks for concurrency')
  assert.match(migration, /hashtextextended/, 'Must use hashtextextended for customer-level locking')

  // ── Payment type compliance ───────────────────────────────────────────
  // Reschedule transfer must use type='refund' (valid per payments_type_check), NOT 'credit_transfer'
  assert.doesNotMatch(migration, /type,\s*'credit_transfer'/, 'Must not use type credit_transfer (not in payments_type_check)')
  assert.match(migration, /'customer_credit_transfer',\s*'refund'/, 'Reschedule transfer must use type=refund with method=customer_credit_transfer')

  // ── Function definitions ──────────────────────────────────────────────
  assert.match(migration, /customer_credit_balance.*\(/i, 'Migration must define customer_credit_balance function')
  assert.match(migration, /record_customer_credit.*\(/i, 'Migration must define record_customer_credit RPC')
  assert.match(migration, /apply_customer_credit_to_booking.*\(/i, 'Migration must define apply_customer_credit_to_booking RPC')
  assert.match(migration, /refund_customer_credit.*\(/i, 'Migration must define refund_customer_credit RPC')
  assert.match(migration, /reverse_customer_credit_entry.*\(/i, 'Migration must define reverse_customer_credit_entry RPC')
  assert.match(migration, /reschedule_booking.*\(/i, 'Migration must define reschedule_booking RPC')

  // ── Read RPCs with access checks ──────────────────────────────────────
  assert.match(migration, /get_customer_credit_balance.*\(/i, 'Migration must define get_customer_credit_balance read RPC')
  assert.match(migration, /get_customer_credit_history.*\(/i, 'Migration must define get_customer_credit_history read RPC')
  assert.match(migration, /get_customer_credit_summary.*\(/i, 'Migration must define get_customer_credit_summary read RPC')

  // Read RPCs must verify lodge access
  assert.match(migration, /app_lodge_access\(p_lodge_id\)/, 'Read RPCs must verify lodge access')

  // Pagination validation
  assert.match(migration, /greatest\(1,\s*least/, 'Must validate limit: 1-100')
  assert.match(migration, /greatest\(0,\s*coalesce\(p_offset/, 'Must validate offset: >= 0')

  // ── customer_credit_balance must NOT be exposed to clients ─────────────
  assert.match(migration, /revoke all on function public\.customer_credit_balance/, 'customer_credit_balance must be revoked from all client roles')
  assert.doesNotMatch(migration, /grant execute on function public\.customer_credit_balance.*to anon/, 'customer_credit_balance must NOT be granted to anon')

  // ── Constraints ───────────────────────────────────────────────────────
  assert.match(migration, /alloc_requires_booking_chk/, 'Allocation must require booking_id and payment_id')
  assert.match(migration, /receipt_refund_requires_method_chk/, 'Receipt/refund must require method')
  assert.match(migration, /reversal_requires_link_chk/, 'Reversal must require reverses_entry_id')
  assert.doesNotMatch(migration, /constraint[\s\S]{0,100}check\s*\([\s\S]{0,100}select\s+1\s+from/i, 'CHECK constraints must not contain PostgreSQL-forbidden subqueries')
  assert.match(migration, /enforce_customer_credit_ledger_links/, 'Cross-table lodge/customer/payment consistency must use a trigger')

  // ── Reversal hardening ────────────────────────────────────────────────
  assert.match(migration, /reversal entries cannot be reversed/i, 'Must prevent reversing reversal entries')
  // Allocation reversal must update booking payments and status
  assert.ok(migration.includes("booking_allocation") && migration.includes("'reversal_in'"), 'Allocation reversal must produce reversal_in type')
  assert.ok(migration.includes('amount_paid') && migration.includes('sum(amount)'), 'Allocation reversal must recalculate amount_paid from payments')
  assert.ok(migration.includes('compute_payment_status') && migration.includes('sum(amount)'), 'Allocation reversal must recompute payment_status from payments')
  assert.match(migration, /booking_allocation[\s\S]*?for update/i, 'Allocation reversal must lock its booking before compensating payment changes')

  // Allocation amount and resulting booking paid total must remain separate.
  assert.match(migration, /v_new_amount_paid numeric/, 'Allocation RPC must use a separate resulting amount-paid variable')
  assert.doesNotMatch(migration, /into v_allocation[\s\S]{0,120}from public\.bookings/, 'Allocation amount must not be overwritten with booking amount_paid')

  // ── Exclusive event checks ────────────────────────────────────────────
  assert.match(migration, /is_exclusive_event/, 'Must check exclusive event flag')
  assert.match(migration, /id != p_booking_id/, 'Reschedule must exclude current booking from conflict checks')

  // ── Audit constraint ──────────────────────────────────────────────────
  assert.match(migration, /drop constraint.*financial_audit_log_action_check/i, 'Migration must drop old audit constraint')
  assert.match(migration, /record_customer_credit/, 'Audit constraint must include record_customer_credit action')
  assert.match(migration, /apply_customer_credit/, 'Audit constraint must include apply_customer_credit action')
  assert.match(migration, /refund_customer_credit/, 'Audit constraint must include refund_customer_credit action')
  assert.match(migration, /reverse_customer_credit/, 'Audit constraint must include reverse_customer_credit action')
  assert.match(migration, /reschedule_booking/, 'Audit constraint must include reschedule_booking action')

  // ── Electron backend ──────────────────────────────────────────────────
  const customerCredit = await read('src/main/domains/customerCredit.js')
  assert.match(customerCredit, /export.*function.*getCustomerCreditBalance/, 'customerCredit.js must export getCustomerCreditBalance')
  assert.match(customerCredit, /export.*function.*recordCustomerCredit/, 'customerCredit.js must export recordCustomerCredit')
  assert.match(customerCredit, /export.*function.*applyCustomerCreditToBooking/, 'customerCredit.js must export applyCustomerCreditToBooking')
  assert.match(customerCredit, /export.*function.*refundCustomerCredit/, 'customerCredit.js must export refundCustomerCredit')
  assert.match(customerCredit, /export.*function.*reverseCustomerCreditEntry/, 'customerCredit.js must export reverseCustomerCreditEntry')

  // Must use RPC for mutations
  assert.match(customerCredit, /\.rpc\('record_customer_credit'/, 'recordCustomerCredit must use RPC')
  assert.match(customerCredit, /\.rpc\('apply_customer_credit_to_booking'/, 'applyCustomerCreditToBooking must use RPC')
  assert.match(customerCredit, /\.rpc\('refund_customer_credit'/, 'refundCustomerCredit must use RPC')
  assert.match(customerCredit, /\.rpc\('reverse_customer_credit_entry'/, 'reverseCustomerCreditEntry must use RPC')

  // Must not have direct table mutations
  assert.doesNotMatch(customerCredit, /\.from\('customer_credit_ledger'\)\.insert/, 'Must not insert directly into customer_credit_ledger')
  assert.doesNotMatch(customerCredit, /\.from\('customer_credit_ledger'\)\.update/, 'Must not update customer_credit_ledger directly')

  // ── bookings.js ───────────────────────────────────────────────────────
  const bookings = await read('src/main/domains/bookings.js')
  assert.match(bookings, /export.*function.*rescheduleBooking/, 'bookings.js must export rescheduleBooking')
  assert.match(bookings, /\.rpc\('reschedule_booking'/, 'rescheduleBooking must use RPC')

  // ── database.js exports ───────────────────────────────────────────────
  const database = await read('src/main/database.js')
  assert.match(database, /rescheduleBooking/, 'database.js must export rescheduleBooking')
  assert.match(database, /getCustomerCreditBalance/, 'database.js must export getCustomerCreditBalance')
  assert.match(database, /recordCustomerCredit/, 'database.js must export recordCustomerCredit')
  assert.match(database, /applyCustomerCreditToBooking/, 'database.js must export applyCustomerCreditToBooking')
  assert.match(database, /refundCustomerCredit/, 'database.js must export refundCustomerCredit')
  assert.match(database, /reverseCustomerCreditEntry/, 'database.js must export reverseCustomerCreditEntry')

  // ── Preload API ───────────────────────────────────────────────────────
  const preload = await read('src/preload/index.js')
  assert.match(preload, /customerCredit.*getBalance/, 'preload must expose customerCredit.getBalance')
  assert.match(preload, /customerCredit.*record/, 'preload must expose customerCredit.record')
  assert.match(preload, /customerCredit.*applyToBooking/, 'preload must expose customerCredit.applyToBooking')
  assert.match(preload, /customerCredit.*refund/, 'preload must expose customerCredit.refund')
  assert.match(preload, /customerCredit.*reverse/, 'preload must expose customerCredit.reverse')
  assert.match(preload, /bookings.*reschedule/, 'preload must expose bookings.reschedule')

  // ── IPC handler normalizes payload ────────────────────────────────────
  const mainIndex = await read('src/main/index.js')
  assert.match(mainIndex, /new_room_id.*newRoomId/, 'IPC handler must normalize snake_case to camelCase for reschedule')
  assert.match(mainIndex, /new_check_in.*newCheckIn/, 'IPC handler must normalize check-in payload')

  // ── syncShared must handle new RPCs ───────────────────────────────────
  const syncShared = await read('src/main/domains/syncShared.js')
  assert.match(syncShared, /reschedule_booking/, 'syncShared must handle reschedule_booking sync')
  assert.match(syncShared, /record_customer_credit/, 'syncShared must handle record_customer_credit sync')

  // ── PWA api.js ────────────────────────────────────────────────────────
  const pwaApi = await read('manager-pwa/src/lib/api.js')
  assert.match(pwaApi, /getCustomerCreditSummaryPwa/, 'PWA api.js must export getCustomerCreditSummaryPwa')
  assert.match(pwaApi, /get_customer_credit_summary/, 'PWA api.js must call get_customer_credit_summary RPC')
  assert.match(pwaApi, /get_customer_credit_cash_flow/, 'PWA cash reporting must use the secured credit cash-flow RPC')
  assert.match(pwaApi, /customer_credit_transfer/, 'PWA reports must exclude internal credit transfers from external refunds')

  const reports = await read('src/main/domains/reports.js')
  assert.match(reports, /get_customer_credit_cash_flow/, 'Desktop cash reporting must load advance receipts and credit refunds')
  assert.match(reports, /method === 'customer_credit'/, 'Desktop cash reporting must exclude credit allocations from fresh cash')

  // ── Desktop UI ────────────────────────────────────────────────────────
  const desktopBookings = await read('src/renderer/src/components/Bookings.jsx')
  assert.match(desktopBookings, /rescheduleBooking/, 'Desktop Bookings must have rescheduleBooking state')
  assert.match(desktopBookings, /handleRescheduleSave/, 'Desktop Bookings must have handleRescheduleSave handler')
  assert.match(desktopBookings, /openReschedule/, 'Desktop Bookings must have openReschedule function')
  assert.match(desktopBookings, /CalendarClock/, 'Desktop Bookings must import CalendarClock icon')

  // Credit must be alternative payment (not secondary action)
  assert.match(desktopBookings, /creditAllocation\.enabled.*creditAllocation\.amount/, 'Credit must be checked as alternative')
  assert.match(desktopBookings, /customerCredit\.applyToBooking/, 'Desktop Bookings must call customerCredit.applyToBooking')

  // Reason must be required
  assert.match(desktopBookings, /required/, 'Reschedule reason must be required')

  // ── Complete desktop prepayment workspace ─────────────────────────────
  const prepayments = await read('src/renderer/src/components/Prepayments.jsx')
  const desktopNav = await read('src/renderer/src/navigation/desktopNav.js')
  const app = await read('src/renderer/src/App.jsx')
  assert.match(desktopNav, /to:\s*['"]\/prepayments['"]/, 'Desktop navigation must expose Prepayments')
  assert.match(app, /path="prepayments"/, 'Desktop router must expose the prepayments workspace')
  assert.match(prepayments, /customerCredit\.record/, 'Prepayments workspace must record advance payments')
  assert.match(prepayments, /customerCredit\.getHistory/, 'Prepayments workspace must show the credit ledger')
  assert.match(prepayments, /customerCredit\.applyToBooking/, 'Prepayments workspace must allocate credit to bookings')
  assert.match(prepayments, /customerCredit\.refund/, 'Prepayments workspace must support refunds')
  assert.match(prepayments, /customerCredit\.reverse/, 'Prepayments workspace must support compensating reversals')
  assert.match(prepayments, /does not reserve accommodation or guarantee room availability/i, 'Advance receipt must carry the non-reservation warning')
  assert.match(prepayments, /receipts\.printCurrent/, 'Advance receipt must support printing')
  assert.match(prepayments, /receipts\.savePDF/, 'Advance receipt must support PDF export')

  assert.match(mainIndex, /customerCredit:record[\s\S]{0,160}payments\.record/, 'Receiving prepayments must require payments.record capability')
  assert.match(mainIndex, /customerCredit:refund[\s\S]{0,160}payments\.refund/, 'Refunding prepayments must require payments.refund capability')

  // ── PWA Money ─────────────────────────────────────────────────────────
  const pwaMoney = await read('manager-pwa/src/pages/Money.jsx')
  assert.match(pwaMoney, /customerCredit/, 'PWA Money must have customerCredit state')
  assert.match(pwaMoney, /getCustomerCreditSummaryPwa/, 'PWA Money must call getCustomerCreditSummaryPwa')
  assert.match(pwaMoney, /Customer Credit/, 'PWA Money must display customer credit label')

  console.log('customer-credit-reschedule-regression: ok')
}

run().catch((error) => {
  console.error('customer-credit-reschedule-regression: failed')
  console.error(error?.stack || error)
  process.exitCode = 1
})
