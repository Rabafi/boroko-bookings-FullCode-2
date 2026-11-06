import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBookingDisplayName,
  resolveCustomerDisplayName,
  summarizeEventInvoiceGroup
} from '../src/main/domains/bookingInvoiceModel.js'
import { sortBookingRows } from '../src/renderer/src/utils/bookingSort.js'

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
