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
  const cancellationCreditMigration = await read('supabase/migrations/20260625120000_booking_refund_to_customer_credit.sql')

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
  assert.match(cancellationCreditMigration, /v_method = 'customer_credit_transfer'/, 'Cancellation settlement must support customer-credit transfer')
  assert.match(cancellationCreditMigration, /public\.record_booking_refund/, 'Cancellation credit transfer must reuse the booking refund RPC path')
  assert.match(cancellationCreditMigration, /insert into public\.customer_credit_ledger/, 'Cancellation credit transfer must create a customer-credit ledger entry server-side')
  assert.match(cancellationCreditMigration, /'adjustment_in'/, 'Cancellation credit transfer must increase available customer credit')
  assert.match(cancellationCreditMigration, /v_refund_idempotency_key \|\| ':credit'/, 'Cancellation credit transfer must use a stable child idempotency key')
  assert.match(cancellationCreditMigration, /'customer_credit_adjusted'/, 'Cancellation credit transfer must write financial audit context')

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
  assert.match(bookings, /export async function createMultiRoomBooking/, 'bookings.js must export accommodation multi-room booking creation')
  assert.match(bookings, /createBookingInvoiceGroup/, 'Multi-room booking must create a group invoice wrapper')
  assert.match(bookings, /export async function updateGroupInvoicePayment/, 'Group invoice payments must allocate through booking payment ledgers')
  assert.match(bookings, /export async function refundGroupInvoice/, 'Group invoice refunds must be available as one grouped approval action')
  assert.match(bookings, /normalizeQuotationAccommodationLines/, 'Quotations must preserve multi-room accommodation lines')
  assert.match(bookings, /const multiRoomResult = await convertMultiRoomQuotation/, 'Multi-room quotations must convert through the grouped accommodation booking path')
  assert.match(bookings, /\[STAY_GROUP:\$\{groupId\}\]/, 'Multi-room accommodation must use stay-group metadata, not event group metadata')
  assert.match(bookings, /await createBooking\(\{[\s\S]*room_id: plan\.room_id/, 'Multi-room accommodation must create normal per-room booking records')
  assert.match(bookings, /\.rpc\('reschedule_booking'/, 'rescheduleBooking must use RPC')
  assert.match(bookings, /refund_approval_log/, 'Booking rows must load refund settlement state from refund approval log')
  assert.match(bookings, /refund_settled: Boolean\(settlement\)/, 'Booking rows must expose explicit refund settlement state')
  assert.match(bookings, /customer_credit_transfer/, 'booking refund domain must pass through customer-credit transfer method')
  assert.match(bookings, /credit_transfer: data\?\.credit_transfer === true/, 'booking refund domain must return credit-transfer result to UI')
  assert.match(bookings, /booking-refund-requests/, 'Offline refund preparation must persist pending approval requests locally')
  assert.match(bookings, /appendOperationJournalEntry\('refund_request_saved'/, 'Offline refund preparation must be journaled')
  assert.match(bookings, /supabase\.rpc\('verify_refund_approver_pin'/, 'Formal refund approval must still verify a live manager PIN')
  assert.doesNotMatch(bookings, /queueOperation\('rpc',\s*'approve_booking_refund'/, 'Formal refund approvals must not be queued offline')

  // ── database.js exports ───────────────────────────────────────────────
  const database = await read('src/main/database.js')
  assert.match(database, /createMultiRoomBooking/, 'database.js must export createMultiRoomBooking')
  assert.match(database, /updateGroupInvoicePayment/, 'database.js must export group invoice payment allocation')
  assert.match(database, /refundGroupInvoice/, 'database.js must export group invoice refund approval')
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
  assert.match(preload, /createMultiRoom/, 'preload must expose multi-room booking creation')
  assert.match(preload, /updateGroupPayment/, 'preload must expose group invoice payment allocation')
  assert.match(preload, /refundGroup/, 'preload must expose group invoice refund approval')

  // ── IPC handler normalizes payload ────────────────────────────────────
  const mainIndex = await read('src/main/index.js')
  assert.match(mainIndex, /bookings:createMultiRoom/, 'IPC must expose multi-room booking creation')
  assert.match(mainIndex, /db\.createMultiRoomBooking/, 'IPC must call the domain multi-room booking creator')
  assert.match(mainIndex, /bookings:updateGroupPayment/, 'IPC must expose group invoice payment allocation')
  assert.match(mainIndex, /bookings:refundGroup/, 'IPC must expose group invoice refund approval')

  const groupInvoiceMigration = await read('supabase/migrations/20260703133000_accommodation_group_invoices.sql')
  assert.match(groupInvoiceMigration, /create table if not exists public\.booking_invoice_groups/, 'Group invoice migration must create invoice group table')
  assert.match(groupInvoiceMigration, /create table if not exists public\.booking_invoice_group_lines/, 'Group invoice migration must create invoice group line table')
  assert.match(groupInvoiceMigration, /create or replace function public\.create_booking_invoice_group/, 'Group invoice migration must create authoritative RPC')
  const quotationLinesMigration = await read('supabase/migrations/20260703143000_quotation_accommodation_lines.sql')
  assert.match(quotationLinesMigration, /add column if not exists accommodation_lines jsonb/, 'Quotation migration must store accommodation room lines')
  assert.match(quotationLinesMigration, /jsonb_typeof\(payload->'accommodation_lines'\) = 'array'/, 'Quotation RPCs must persist only array room lines')
  const publicBookingOffersMigration = await read('supabase/migrations/20260703153000_public_booking_offers.sql')
  assert.match(publicBookingOffersMigration, /public_offer_multi_room/, 'Public booking settings must expose multi-room offer controls')
  assert.match(publicBookingOffersMigration, /public_offer_full_lodge/, 'Public booking settings must expose full-lodge offer controls')
  assert.match(publicBookingOffersMigration, /public_offer_day_use/, 'Public booking settings must expose day-use offer controls')
  assert.match(publicBookingOffersMigration, /public_offer_events/, 'Public booking settings must expose event and venue offer controls')
  assert.match(publicBookingOffersMigration, /create or replace function public\.get_public_booking_offers/, 'Public booking site must have an offers RPC')
  assert.match(publicBookingOffersMigration, /v_booking_type not in \('room', 'multi_room', 'full_lodge'\)/, 'Public booking RPC must explicitly constrain supported booking types')
  assert.match(publicBookingOffersMigration, /create_booking_invoice_group/, 'Public multi-room bookings must create the same group invoice wrapper')
  assert.match(publicBookingOffersMigration, /exit when v_booking_type = 'full_lodge'/, 'Full-lodge public booking must create one exclusive booking, not overlapping exclusive room bookings')
  assert.match(mainIndex, /new_room_id.*newRoomId/, 'IPC handler must normalize snake_case to camelCase for reschedule')
  assert.match(mainIndex, /new_check_in.*newCheckIn/, 'IPC handler must normalize check-in payload')

  // ── syncShared must handle new RPCs ───────────────────────────────────
  const syncShared = await read('src/main/domains/syncShared.js')
  assert.match(syncShared, /reschedule_booking/, 'syncShared must handle reschedule_booking sync')
  assert.match(syncShared, /record_customer_credit/, 'syncShared must handle record_customer_credit sync')
  const syncQueue = await read('src/shared/syncQueue.js')
  assert.match(syncQueue, /'reschedule_booking'/, 'Reschedule replay must be financially tracked')
  assert.match(syncQueue, /'record_customer_credit'/, 'Advance payment replay must be financially tracked')

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
  assert.match(desktopBookings, /function bookingRefundPending/, 'Desktop Bookings must use a refund-pending predicate')
  assert.match(desktopBookings, /refund_settled !== true/, 'Refund visibility must depend on refund settlement state')
  assert.doesNotMatch(desktopBookings, /status === 'cancelled' && Number\(b\.amount_paid \|\| 0\) > 0\.01 && b\.payment_status !== 'paid'/, 'Paid cancelled bookings must still expose refund actions before settlement')

  // Credit must be alternative payment (not secondary action)
  assert.match(desktopBookings, /creditAllocation\.enabled.*creditAllocation\.amount/, 'Credit must be checked as alternative')
  assert.match(desktopBookings, /customerCredit\.applyToBooking/, 'Desktop Bookings must call customerCredit.applyToBooking')

  // Reason must be required
  assert.match(desktopBookings, /required/, 'Reschedule reason must be required')

  // ── Complete desktop prepayment workspace ─────────────────────────────
  const prepayments = await read('src/renderer/src/components/Prepayments.jsx')
  const desktopGuests = await read('src/renderer/src/components/Guests.jsx')
  const bookingInvoices = await read('src/renderer/src/components/BookingInvoices.jsx')
  const desktopQuotations = await read('src/renderer/src/components/Quotations.jsx')
  const publicLodgePage = await read('booking-site/src/pages/LodgePage.jsx')
  const publicBookingPage = await read('booking-site/src/pages/BookingPage.jsx')
  const publicSuccessPage = await read('booking-site/src/pages/SuccessPage.jsx')
  assert.match(desktopQuotations, /accommodation_lines/, 'Desktop quotations must capture multi-room accommodation lines')
  assert.match(desktopQuotations, /Add Room/, 'Desktop quotations must expose room line entry')
  assert.match(desktopQuotations, /quotationRoomLines/, 'Desktop quotations must render multi-room quotation summaries')
  assert.match(desktopQuotations, /function QuotationPreview[\s\S]*const roomLines = quotationRoomLines\(q\)[\s\S]*roomLines\.length > 1/, 'Quotation preview must define roomLines before rendering multi-room line details')
  assert.match(publicLodgePage, /get_public_booking_offers/, 'Public lodge page must read lodge-specific online offer configuration')
  assert.match(publicLodgePage, /selectedRoomIds/, 'Public lodge page must support selecting multiple rooms')
  assert.match(publicLodgePage, /handleBookSelected\(\{ fullLodge: true \}\)/, 'Public lodge page must expose full-lodge requests when enabled')
  assert.doesNotMatch(publicLodgePage, /event_request/, 'Event and venue offers must not submit through the accommodation booking RPC')
  assert.match(publicBookingPage, /booking_type: effectiveBookingType/, 'Public booking form must submit the selected booking type')
  assert.match(publicBookingPage, /rooms: roomLines/, 'Public booking form must submit per-room lines for server conflict checks')
  assert.match(publicSuccessPage, /room_count/, 'Public success page must render grouped room or full-lodge summaries')
  assert.match(bookingInvoices, /window\.api\.bookings\.refundGroup/, 'Booking invoices must refund grouped invoices through the grouped refund API')
  const desktopNav = await read('src/renderer/src/navigation/desktopNav.js')
  const app = await read('src/renderer/src/App.jsx')
  assert.match(desktopNav, /to:\s*['"]\/prepayments['"]/, 'Desktop navigation must expose Prepayments')
  assert.match(app, /path="prepayments"/, 'Desktop router must expose the prepayments workspace')
  assert.match(desktopGuests, /loadCreditSummaryRows/, 'Guests tab must load customer-credit balances')
  assert.match(desktopGuests, /customerCredit\.getSummary\(null, 100, offset\)/, 'Guests tab must page customer-credit summary rows')
  assert.match(desktopGuests, /credit_balance/, 'Guests tab must show customer-credit balance for each guest')
  assert.match(desktopGuests, /navigate\('\/prepayments'[\s\S]*customerId: customer\.id[\s\S]*openReceive/, 'Guests tab must shortcut selected guests to Prepayments')
  assert.match(desktopGuests, /Prepay/, 'Guests tab must expose add-prepayment shortcut')
  assert.match(desktopGuests, /Ledger/, 'Guests tab must expose credit ledger shortcut')
  assert.match(prepayments, /location\.state\?\.customerId/, 'Prepayments workspace must accept selected guest navigation state')
  assert.match(prepayments, /setReceiveOpen\(true\)/, 'Prepayments shortcut must be able to open the receive-prepayment modal')
  assert.match(prepayments, /Credit from cancelled booking/, 'Prepayments ledger must label cancellation credit transfers clearly')
  assert.match(prepayments, /viewBookingId: bookingId/, 'Prepayments ledger must link booking-backed credit entries to invoices')
  assert.match(prepayments, /customerCredit\.record/, 'Prepayments workspace must record advance payments')
  assert.match(prepayments, /customerCredit\.getHistory/, 'Prepayments workspace must show the credit ledger')
  assert.match(prepayments, /customerCredit\.applyToBooking/, 'Prepayments workspace must allocate credit to bookings')
  assert.match(prepayments, /customerCredit\.refund/, 'Prepayments workspace must support refunds')
  assert.match(prepayments, /customerCredit\.reverse/, 'Prepayments workspace must support compensating reversals')
  assert.match(prepayments, /does not reserve accommodation or guarantee room availability/i, 'Advance receipt must carry the non-reservation warning')
  assert.match(prepayments, /receipts\.printCurrent/, 'Advance receipt must support printing')
  assert.match(prepayments, /receipts\.savePDF/, 'Advance receipt must support PDF export')
  assert.match(prepayments, /id="printable-receipt"/, 'Advance receipt must use the printable A4 receipt surface')
  assert.match(prepayments, /Open receipt/, 'Posted prepayment receipts must be reopenable from ledger history')
  assert.match(prepayments, /receipt_number/, 'Prepayment receipts must use server-issued receipt numbers')
  assert.match(mainIndex, /buildPrepaymentReceiptPdfHtml/, 'Prepayment PDF must render from a dedicated A4 HTML document')
  assert.match(mainIndex, /renderHtmlToPdfBuffer\(/, 'Prepayment PDF must not depend on printing the whole application window')

  assert.match(mainIndex, /customerCredit:record[\s\S]{0,160}payments\.record/, 'Receiving prepayments must require payments.record capability')
  assert.match(mainIndex, /customerCredit:refund[\s\S]{0,160}payments\.refund/, 'Refunding prepayments must require payments.refund capability')
  assert.match(bookingInvoices, /settlement_mode: 'external_refund'/, 'Refund modal must default to existing external refund behavior')
  assert.match(bookingInvoices, /_accommodation_group/, 'Invoice workbench must support accommodation group invoice rows')
  assert.match(bookingInvoices, /GroupPaymentModal/, 'Invoice workbench must support group invoice payment allocation')
  assert.match(bookingInvoices, /function invoiceRefundPending/, 'Invoices must use a refund-pending predicate')
  assert.match(bookingInvoices, /refund_settled !== true/, 'Invoice refund visibility must depend on refund settlement state')
  assert.doesNotMatch(bookingInvoices, /status === 'cancelled' && Number\(invoice\.amount_paid \|\| 0\) > 0\.01 && invoice\.payment_status !== 'paid'/, 'Paid cancelled invoices must still expose refund actions before settlement')
  assert.match(bookingInvoices, /settlement_mode: 'customer_credit'/, 'Refund modal must expose customer-credit settlement mode')
  assert.match(bookingInvoices, /No cash leaves the (lodge|property)/, 'Credit-transfer mode must clearly distinguish credit from external refunds')
  assert.match(bookingInvoices, /method: transferToCredit \? 'customer_credit_transfer' : form\.method/, 'Refund modal must send customer-credit transfer method when selected')
  assert.match(bookingInvoices, /result\?\.pending_approval/, 'Refund modal must keep offline refund requests separate from approved refunds')
  assert.match(bookingInvoices, /required=\{!isOffline\}/, 'Refund modal must require manager PIN only for live approval')
  assert.match(bookingInvoices, /refundRequestPending/, 'Invoice UI must visibly distinguish saved refund requests')
  assert.match(bookingInvoices, /credit_transfer === true/, 'Refund completion must acknowledge customer-credit transfer results')
  assert.match(bookingInvoices, /CreditTransferReceipt/, 'Cancellation-to-credit must produce a printable credit memo')
  assert.match(bookingInvoices, /Customer Credit Memo/, 'Credit-transfer receipt must be labelled as a customer credit memo')
  assert.match(bookingInvoices, /viewBookingId/, 'Booking invoices must support ledger deep links')

  // ── PWA Money ─────────────────────────────────────────────────────────
  const pwaMoney = await read('manager-pwa/src/pages/Money.jsx')
  assert.match(pwaMoney, /customerCredit/, 'PWA Money must have customerCredit state')
  assert.match(desktopBookings, /customerCredit\.getBalance/, 'Booking payment modal must load available customer credit')
  assert.match(desktopBookings, /payment_status === 'partial' && !creditAllocation\.enabled/, 'Credit-only payments must not require a separate cash amount')
  assert.match(desktopBookings, /financialAudit\(\{ bookingId/, 'Booking history must load authoritative reschedule audit rows')
  const desktopReports = await read('src/renderer/src/components/Reports.jsx')
  assert.match(desktopReports, /Customer-credit liability/, 'Desktop reports must expose outstanding customer-credit liability')
  assert.match(pwaMoney, /getCustomerCreditSummaryPwa/, 'PWA Money must call getCustomerCreditSummaryPwa')
  assert.match(pwaMoney, /Customer Credit/, 'PWA Money must display customer credit label')

  console.log('customer-credit-reschedule-regression: ok')
}

run().catch((error) => {
  console.error('customer-credit-reschedule-regression: failed')
  console.error(error?.stack || error)
  process.exitCode = 1
})
