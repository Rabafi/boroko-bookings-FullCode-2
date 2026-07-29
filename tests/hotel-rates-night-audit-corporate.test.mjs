import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MIGRATION = 'supabase/migrations/20260711190000_hotel_rates_night_audit_corporate.sql'

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('Hotel rates, night audit, corporate settlement', () => {
  it('prices stays with night-level rate plans and overrides', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('create or replace function public.room_booking_expected_total'))
    assert.ok(sql.includes('rate_plans'))
    assert.ok(sql.includes('room_rate_overrides'))
    assert.ok(sql.includes('quote_room_stay'))
    assert.ok(sql.includes('p_corporate_account_id'))
  })

  it('hardens night audit close against double-close and critical exceptions', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('already_closed'))
    assert.ok(sql.includes('p_force boolean'))
    assert.ok(sql.includes("status = 'no_show'"))
    assert.ok(sql.includes('open_hotel_folios'))
  })

  it('settles corporate charges against booking payment + optional folio', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('charge_to_corporate_account'))
    assert.ok(sql.includes("method, type, paid_at"))
    assert.ok(sql.includes("'corporate'"))
    assert.ok(sql.includes('corporate_account_id = p_account_id'))
    assert.ok(sql.includes('add_folio_payment'))
  })

  it('desktop booking create uses server quote_room_stay', () => {
    const js = read('src/main/domains/bookings.js')
    assert.match(js, /rpc\([^\n]*'quote_room_stay'/)
    assert.ok(js.includes('p_corporate_account_id'))
  })

  it('night audit close supports force flag', () => {
    const js = read('src/main/domains/nightAudit.js')
    assert.ok(js.includes('p_force'))
    const preload = read('src/preload/index.js')
    assert.ok(preload.includes('nightAudit:close'))
  })

  it('does not grant a non-existent 5-arg corporate charge overload', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('charge_to_corporate_account(uuid, uuid, uuid, numeric, text, boolean)'))
    assert.ok(!sql.includes('grant execute on function public.charge_to_corporate_account(uuid, uuid, uuid, numeric, text) to'))
  })

  it('enterprise night audit UI is routed and uses operational API', () => {
    const ui = read('src/renderer/src/components/NightAuditEnterprise.jsx')
    assert.ok(ui.includes('window.api.nightAudit.runChecks'))
    assert.ok(ui.includes('window.api.nightAudit.close'))
    assert.ok(ui.includes('Force close') || ui.includes('force close') || ui.includes('setForce'))
    const app = read('src/renderer/src/App.jsx')
    assert.ok(app.includes('NightAuditEnterprise'))
    assert.ok(app.includes('path="night-audit-enterprise"'))
    assert.ok(!app.includes('path="night-audit-enterprise" element={<Navigate to="/audit"'))
  })

  it('corporate billing charge requires booking and allows full-balance settle', () => {
    const ui = read('src/renderer/src/components/CorporateBilling.jsx')
    assert.ok(ui.includes('Booking ID is required'))
    assert.ok(ui.includes('remaining balance') || ui.includes('full balance'))
  })

  it('overload repair keeps a single room_booking_expected_total and run_night_audit_checks signature', () => {
    const sql = read('supabase/migrations/20260711191000_hotel_rate_night_audit_overload_repair.sql')
    assert.ok(sql.includes('drop function if exists public.room_booking_expected_total(uuid, uuid, date, date)'))
    assert.ok(sql.includes('drop function if exists public.run_night_audit_checks(uuid)'))
    assert.ok(sql.includes('p_business_date date default current_date'))
    assert.ok(sql.includes('p_corporate_account_id uuid default null'))
  })
})
