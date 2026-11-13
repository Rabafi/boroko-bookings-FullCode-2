import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  importDomain,
  importState,
  makeTempCacheDir
} from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const bookings = await importDomain('bookings.js')

test('paid event parent with no total is projected as requiring reconciliation', async (t) => {
  const stateKeys = ['cacheDir', 'lodgeId', 'supabase', 'isOnline']
  const previous = Object.fromEntries(stateKeys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('booking-invoice-parent-reconciliation')
  const lodgeId = '11111111-1111-4111-8111-111111111111'
  const eventId = '22222222-2222-4222-8222-222222222222'

  Object.assign(state, {
    cacheDir,
    lodgeId,
    supabase: null,
    isOnline: false
  })

  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })

  infrastructure.writeCache('bookings', [{
    id: eventId,
    booking_id: eventId,
    lodge_id: lodgeId,
    is_exclusive_event: true,
    notes: `[GROUP:event:${eventId}]`,
    invoice_number: 'EV-PAID-001',
    check_in: '2026-11-12',
    check_out: '2026-11-13',
    created_at: '2026-11-12T00:00:00.000Z',
    status: 'confirmed',
    total_amount: 0,
    amount_paid: 0,
    charges_total: 0
  }])
  infrastructure.writeCache('customers', [])
  infrastructure.writeCache('rooms', [])
  infrastructure.writeCache('conference-bookings', [{
    id: eventId,
    lodge_id: lodgeId,
    event_name: 'Synthetic paid parent',
    status: 'confirmed',
    total_amount: 0,
    amount_paid: 125
  }])
  infrastructure.writeCache('event-booking-rooms', [])
  infrastructure.writeCache('booking-invoice-groups', [])
  infrastructure.writeCache('booking-invoice-group-lines', [])

  const invoices = await bookings.getBookingInvoices()
  const invoice = invoices.find((row) => row.event_id === eventId)

  assert.ok(invoice, 'the existing event-invoice projection should return the synthetic invoice')
  assert.equal(invoice.reconciliation_required, true)
  assert.equal(invoice.balance_due, null)
  assert.equal(invoice.payment_status, 'reconciliation_required')
  assert.equal(invoice.total_is_estimate, true)
})
