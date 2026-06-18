import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Manager PWA reads only real columns and resolves booking relations', async () => {
  const [api, app] = await Promise.all([
    read('manager-pwa/src/lib/api.js'),
    read('manager-pwa/src/App.jsx')
  ])

  assert.doesNotMatch(api, /conference_bookings'\)\.select\([^)]*updated_at/)
  assert.doesNotMatch(api, /maintenance_tickets'\)[\s\S]{0,250}\.select\([^)]*(?:issue|completed_at|updated_at)/)
  assert.doesNotMatch(api, /bookings'\)\.select\('id,\s*guest_name,\s*room_number/)
  assert.doesNotMatch(app, /inventory_items'\)\.select\('[^']*\bquantity\b/)

  assert.match(api, /customer:customers\(name\)/)
  assert.match(api, /room:rooms\(room_number\)/)
  assert.match(api, /CONFERENCE_BOOKING_SELECT[\s\S]*created_at,\s*lodge_id/)
  assert.match(api, /safeQuotationSelect/)
})

test('database migration repairs stale Manager PWA RPC contracts', async () => {
  const migration = await read('supabase/migrations/20260618200000_pwa_schema_contract_repair.sql')

  assert.match(migration, /create or replace function public\.get_manager_dashboard_snapshot/)
  assert.match(migration, /create or replace function public\.get_invoice_summary/)
  assert.match(migration, /create or replace function public\.get_night_audit_summary/)
  assert.match(migration, /left join public\.rooms r/)
  assert.match(migration, /coalesce\(c\.name, 'Guest'\)/)
  assert.match(migration, /select coalesce\(sum\(total\), 0\)[\s\S]*from public\.pool_day_use/)
  assert.match(migration, /'openMaintenanceCount'/)
  assert.match(migration, /'urgentMaintenanceCount'/)

  assert.doesNotMatch(migration, /\bb\.guest_name\b/)
  assert.doesNotMatch(migration, /\bb\.room_number\b/)
  assert.doesNotMatch(migration, /from public\.quotations[\s\S]{0,250}\bcharges_total\b/)
})
