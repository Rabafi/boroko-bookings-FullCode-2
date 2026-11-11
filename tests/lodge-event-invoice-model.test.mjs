import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveBookingDisplayName,
  resolveCustomerDisplayName,
  summarizeEventInvoiceGroup
} from '../src/main/domains/bookingInvoiceModel.js'
import { sortBookingRows } from '../src/renderer/src/utils/bookingSort.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paymentVoidSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111010000_lodge_cash_neutral_duplicate_payment_voids.sql'), 'utf8')
const paymentVoidAuditSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111020000_lodge_duplicate_payment_void_audit_action.sql'), 'utf8')
const paymentReaderParitySql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111030000_lodge_voided_payment_reader_parity.sql'), 'utf8')
const paymentReportRewriteSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111040000_lodge_voided_payment_report_rewrite_fix.sql'), 'utf8')
const paymentBookingLockSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111050000_lodge_duplicate_payment_void_booking_lock.sql'), 'utf8')
const identityAuditSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111060000_lodge_invoice_identity_audit_action.sql'), 'utf8')
const paymentReportClosureSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111070000_lodge_voided_payment_report_and_recalc_closure.sql'), 'utf8')
const invoiceGroupAuditSql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/20261111080000_lodge_event_invoice_group_audit_action.sql'), 'utf8')
const bookingInvoicesUi = fs.readFileSync(path.join(repoRoot, 'src/renderer/src/components/BookingInvoices.jsx'), 'utf8')
const managerInvoicesUi = fs.readFileSync(path.join(repoRoot, 'manager-pwa/src/pages/Invoices.jsx'), 'utf8')
const mainReports = fs.readFileSync(path.join(repoRoot, 'src/main/domains/reports.js'), 'utf8')
const managerApi = fs.readFileSync(path.join(repoRoot, 'manager-pwa/src/lib/api.js'), 'utf8')

test('booking created-date ties sort naturally by issued invoice without changing the date sort', () => {
  const sameCreatedAt = '2026-11-05T08:18:14.763111+00:00'
  const rows = [
    { id: 'room-11', created_at: sameCreatedAt, invoice_number: 'INV-0262' },
    { id: 'newer-date', created_at: '2026-11-06T08:18:14.763111+00:00', invoice_number: 'INV-0250' },
    { id: 'room-8', created_at: sameCreatedAt, invoice_number: 'INV-0259' },
    { id: 'room-9', created_at: sameCreatedAt, invoice_number: 'INV-0260' },
    { id: 'room-10', created_at: sameCreatedAt, invoice_number: 'INV-0261' }
  ]

  assert.deepEqual(sortBookingRows(rows, 'created_desc').map((row) => row.id), [
    'newer-date', 'room-8', 'room-9', 'room-10', 'room-11'
  ])
  assert.deepEqual(sortBookingRows(rows, 'created_asc').map((row) => row.id), [
    'room-8', 'room-9', 'room-10', 'room-11', 'newer-date'
  ])
})

test('booking sort uses immutable ID when tied rows have no invoice number', () => {
  const rows = [
    { id: 'booking-b', created_at: '2026-11-05T08:18:14Z' },
    { id: 'booking-a', created_at: '2026-11-05T08:18:14Z' }
  ]
  assert.deepEqual(sortBookingRows(rows, 'created_desc').map((row) => row.id), ['booking-a', 'booking-b'])
})

test('event title never replaces the customer/contact identity', () => {
  assert.equal(resolveCustomerDisplayName({ customerName: '', snapshotName: 'Customer Contact', eventName: 'Wedding Title' }), 'Customer Contact')
  assert.equal(resolveCustomerDisplayName({ customerName: '', snapshotName: '', eventName: 'Wedding Title' }), 'Wedding Title')
})

test('event invoice producer prefers the parent contact and keeps event title separate', () => {
  const invoice = summarizeEventInvoiceGroup({
    event: {
      id: 'event-identity',
      event_name: 'Smith Wedding',
      client_name: 'Doofy Mokoka',
      total_amount: 100,
      amount_paid: 0
    },
    roomRows: [{ booking_id: 'room-identity', total_amount: 400, amount_paid: 0 }]
  })
  assert.equal(invoice.customer_name, 'Doofy Mokoka')
  assert.equal(invoice.display_notes, 'Smith Wedding')
})

test('legacy EVENT note resolves only through a verified parent event', () => {
  const eventId = '3f591487-99d1-40f5-9e91-74886c68107d'
  const eventParentById = new Map([[eventId, { client_name: 'Doofy Mokoka', event_name: 'Birthday Celebration' }]])
  assert.equal(resolveBookingDisplayName({
    notes: `[EVENT:${eventId}] Doofy Mokoka`,
    eventParentById
  }), 'Doofy Mokoka')
  assert.equal(resolveBookingDisplayName({
    notes: '[EVENT:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa] Arbitrary note guest',
    eventParentById
  }), '')
})

test('event POS charges already included in the event total are not counted twice', () => {
  const invoice = summarizeEventInvoiceGroup({
    event: { id: 'event-1', event_name: 'Conference', client_name: 'Customer', total_amount: 1100, charges_total: 100, amount_paid: 0 },
    roomRows: [{ booking_id: 'room-1', total_amount: 500, amount_paid: 0, charges_total: 0, check_in: '2026-12-01', check_out: '2026-12-02' }]
  })
  assert.equal(invoice.total_amount, 1600)
  assert.equal(invoice.charges_total, 0)
  assert.equal(invoice.balance_due, 1600)
})

test('exclusive event projection does not add the same accommodation amount twice', () => {
  const invoice = summarizeEventInvoiceGroup({
    event: {
      id: 'event-exclusive',
      reservation_scope: 'exclusive_lodge',
      total_amount: 5000,
      charges_total: 300,
      amount_paid: 1000
    },
    roomRows: [{ booking_id: 'room-a', total_amount: 4700, charges_total: 100, amount_paid: 0 }]
  })
  assert.equal(invoice.total_amount, 5000)
  assert.equal(invoice.charges_total, 100)
  assert.equal(invoice.balance_due, 4100)
})

test('Doofy-shaped mixed event and room receipts are held for reconciliation', () => {
  const invoice = summarizeEventInvoiceGroup({
    event: { id: 'event-2', event_name: 'Doofy Mokoka', client_name: 'Doofy Mokoka', total_amount: 0, amount_paid: 2000 },
    roomRows: Array.from({ length: 11 }, (_, index) => ({
      booking_id: `room-${index + 1}`,
      total_amount: index === 0 ? 1150 : 360,
      amount_paid: index === 0 ? 500 : index === 3 ? 400 : 0,
      check_in: '2026-11-05',
      check_out: '2026-11-06'
    }))
  })
  assert.equal(invoice.total_amount, 4750)
  assert.equal(invoice.amount_paid, 2900)
  assert.equal(invoice.reconciliation_required, true)
  assert.equal(invoice.balance_due, null)
  assert.equal(invoice.payment_status, 'reconciliation_required')
})

test('zero-price exclusive event with a deposit is visible as unresolved', () => {
  const invoice = summarizeEventInvoiceGroup({
    event: { id: 'event-3', event_name: 'Mr Montsheng', client_name: 'Mr Montsheng', total_amount: 0, amount_paid: 2500 },
    roomRows: []
  })
  assert.equal(invoice.amount_paid, 2500)
  assert.equal(invoice.reconciliation_required, true)
  assert.equal(invoice.balance_due, null)
})

test('event duplicate correction retains both receipt rows and writes no cash movement', () => {
  assert.match(paymentVoidSql, /create or replace function public\.void_duplicate_event_payment\(/i)
  assert.match(paymentVoidSql, /set voided_at = now\(\), void_reason = v_reason, voided_by = v_actor/i)
  assert.match(paymentVoidSql, /voided_as_duplicate_of = p_original_payment_id/i)
  assert.match(paymentVoidSql, /'cash_movement', 0/i)
  assert.match(paymentVoidSql, /'finance', 'manager', 'admin', 'super_admin'/i)
  assert.match(paymentVoidSql, /Correction idempotency key was already used for a different operation/i)
  assert.match(paymentVoidSql, /Duplicate corrections would exceed the source event deposit/i)
  assert.match(paymentVoidSql, /perform public\.recalculate_event_totals\(p_event_id\)/i)
  assert.doesNotMatch(paymentVoidSql, /delete\s+from\s+public\.payments/i)
  assert.match(paymentVoidAuditSql, /event_duplicate_payment_voided/i)
  assert.match(identityAuditSql, /event_invoice_identity_repaired/i)
  assert.match(invoiceGroupAuditSql, /event_invoice_group_created/i)
  assert.match(bookingInvoicesUi, /Voided duplicate/)
  assert.match(bookingInvoicesUi, /receipt retained/)
})

test('voided duplicates are excluded from payment reports and marked in event ledger history', () => {
  assert.match(paymentVoidSql, /create or replace view public\.payment_reporting_active as\s+select \* from public\.payments where voided_at is null/i)
  assert.match(paymentVoidSql, /public\.get_payment_transaction_report\(uuid,date,date\)/i)
  assert.match(paymentVoidSql, /public\.get_reconciliation_controls_report\(uuid,date,date\)/i)
  assert.match(paymentVoidSql, /from public\.payment_reporting_active/i)
  assert.match(paymentReaderParitySql, /public\.get_financial_reconciliation_v1\(uuid\)/i)
  assert.match(paymentReaderParitySql, /public\.get_guest_lifetime_summary\(uuid,text,integer,integer\)/i)
  assert.match(paymentReaderParitySql, /public\.get_manager_dashboard_snapshot\(uuid,date\)/i)
  assert.match(paymentReportRewriteSql, /payment_reporting_active p/i)
  assert.match(paymentBookingLockSql, /where b\.id = v_duplicate\.booking_id and b\.lodge_id = p_lodge_id\s+for update/i)
  assert.match(paymentReportClosureSql, /get_outstanding_balance_report\(uuid,date,date\)/i)
  assert.match(paymentReportClosureSql, /reschedule_booking\(uuid,uuid,uuid,date,date,text,text,text,boolean,numeric,timestamp with time zone,uuid\)/i)
  assert.match(paymentReportClosureSql, /get_event_booking_details\(uuid,uuid\)/i)
  assert.match(paymentReportClosureSql, /voided_as_duplicate_of/i)
  assert.equal((mainReports.match(/is\('voided_at', null\)/g) || []).length, 2)
  assert.equal((managerApi.match(/from\('payments'\)[^\n]*is\('voided_at', null\)/g) || []).length, 3)
  assert.match(paymentVoidSql, /create function public\.get_event_invoice_payments[\s\S]*?voided_as_duplicate_of uuid[\s\S]*?from public\.payments p/i)
  assert.match(bookingInvoicesUi, /payment\.voided_at \? \(/)
  assert.match(bookingInvoicesUi, /payment\.voided_as_duplicate_of/)
  assert.match(managerInvoicesUi, /payment\.voided_at \? 'Voided duplicate'/)
  assert.match(managerInvoicesUi, /Cash-neutral duplicate correction/)
})
