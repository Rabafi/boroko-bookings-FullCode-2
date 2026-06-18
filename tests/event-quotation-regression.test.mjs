import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function run() {
  const migration = await read('supabase/migrations/20260618180000_event_lodge_quotations.sql')
  const bookings = await read('src/main/domains/bookings.js')
  const desktop = await read('src/renderer/src/components/Quotations.jsx')
  const email = await read('src/main/emailNotifications.js')
  const pwaApi = await read('manager-pwa/src/lib/api.js')
  const pwaPage = await read('manager-pwa/src/pages/Quotations.jsx')

  assert.match(migration, /add column if not exists quotation_type text not null default 'room'/)
  assert.match(migration, /check \(quotation_type in \('room', 'exclusive_event'\)\)/)
  assert.match(migration, /create or replace function public\.normalize_quotation_booking_type/)
  assert.match(migration, /new\.subtotal := round\(\(new\.event_daily_rate \* v_nights\)/)
  assert.match(migration, /new\.total_amount := new\.subtotal/)

  assert.match(migration, /create or replace function public\.guard_exclusive_event_overlap/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /the lodge already has bookings during these dates/i)
  assert.match(migration, /fully reserved for an exclusive event/i)

  assert.match(migration, /create or replace function public\.convert_quotation_to_booking/)
  assert.match(migration, /v_is_event := v_q\.quotation_type = 'exclusive_event'/)
  assert.match(migration, /is_exclusive_event, event_daily_rate, create_idempotency_key/)
  assert.match(migration, /'quotation-conversion:' \|\| p_quotation_id::text/)
  assert.match(migration, /public\.update_booking_payment\(/)
  assert.doesNotMatch(migration, /update\s+public\.bookings[\s\S]{0,300}amount_paid\s*=/i)

  assert.match(bookings, /function isExclusiveEventQuotation/)
  assert.match(bookings, /quotation_type:\s*quotationType/)
  assert.match(bookings, /is_exclusive_event:\s*isEvent/)
  assert.match(bookings, /queueOperation\('rpc', 'convert_quotation_to_booking'/)
  assert.match(bookings, /buildQuotationEventNotes\(quotation, eventRooms\.length\)/)

  assert.match(desktop, /Event \/ Full Lodge/)
  assert.match(desktop, /event_daily_rate/)
  assert.match(desktop, /Reserve Full Lodge/)
  assert.match(desktop, /Booking queued offline/)
  assert.match(email, /exclusive event and full-lodge reservation/)

  assert.match(pwaApi, /quotation_type, event_name, event_daily_rate/)
  assert.match(pwaPage, /quotation\.quotation_type === 'exclusive_event'/)
  assert.match(pwaPage, /Full Lodge/)

  console.log('event-quotation-regression: ok')
}

run().catch((error) => {
  console.error('event-quotation-regression: failed')
  console.error(error?.stack || error)
  process.exitCode = 1
})
