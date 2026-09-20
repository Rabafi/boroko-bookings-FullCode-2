import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync('supabase/migrations/20260918000000_village_cash_containers.sql', 'utf8')
const auditFix = readFileSync('supabase/migrations/20260920000000_outlet_audit_cash_model_action.sql', 'utf8')

test('outlets carry a cash model that defaults to existing personal behavior', () => {
  assert.match(migration, /add column if not exists cash_model/)
  assert.match(migration, /default 'personal_bank'/)
  assert.match(migration, /check \(cash_model in \('shared_drawer', 'personal_bank'\)\)/)
})

test('containers, periods, movements and counts exist with one-live-period protection', () => {
  for (const table of ['pos_cash_containers', 'pos_cash_periods', 'pos_cash_movements', 'pos_cash_counts']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} created`)
  }
  assert.match(migration, /pos_cash_periods_one_live_per_container/)
  assert.match(migration, /where status in \('open', 'submitted', 'rejected'\)/)
  assert.match(migration, /pos_cash_movements_key_uniq/)
  assert.match(migration, /pos_cash_counts_key_uniq/)
  assert.match(migration, /pos_cash_periods_submit_key_uniq/)
  assert.match(migration, /alter table public\.pos_cash_containers enable row level security/)
  assert.match(migration, /alter table public\.pos_cash_periods enable row level security/)
  assert.match(migration, /alter table public\.pos_cash_movements enable row level security/)
  assert.match(migration, /alter table public\.pos_cash_counts enable row level security/)
})

test('counts are observations: handovers never move money', () => {
  assert.match(migration, /count_type in \('opening', 'handover', 'closing'\)/)
  assert.match(migration, /handover[\s\S]{0,200}never move money/i)
  assert.match(migration, /movement_type in \('drop_to_safe', 'paid_out', 'float_topup', 'pouch_to_drawer', 'drawer_to_pouch'\)/)
  assert.doesNotMatch(migration, /'handover'[^;]*movement_type|movement_type[^;]*'handover'/)
})

test('paid-outs require a reason and operator money needs a PIN', () => {
  assert.match(migration, /Say what the paid-out cash was for\./)
  assert.match(migration, /_restaurant_validate_attendance_pin/)
  assert.match(migration, /_restaurant_validate_manager_cashup_pin/)
})

test('submit responses stay blind; expectations appear only at review', () => {
  const submitBody = migration.slice(
    migration.indexOf('create or replace function public.submit_pos_drawer_period_cashup'),
    migration.indexOf('create or replace function public.review_pos_drawer_period_cashup')
  )
  assert.doesNotMatch(submitBody, /expected_cash_drawer/)
  assert.doesNotMatch(submitBody, /variance/)
  assert.match(migration, /self_reviewed/)
})

test('review needs a correction note on return and closes only untouched shifts', () => {
  assert.match(migration, /Enter a correction note before returning this cash-up\./)
  assert.match(migration, /Closed by drawer period close\./)
  assert.match(migration, /not exists \(select 1 from public\.pos_orders o/)
})

test('operators get metadata while managers get evidence', () => {
  assert.match(migration, /v_role in \('manager', 'admin', 'super_admin'\)/)
  assert.match(migration, /count_type.*operator_id.*created_at.*notes/)
})

test('desktop sessions can call the new RPCs; internals stay hidden', () => {
  for (const fn of [
    'open_pos_drawer_period(jsonb)',
    'record_pos_cash_movement(jsonb)',
    'record_pos_cash_count(jsonb)',
    'submit_pos_drawer_period_cashup(jsonb)',
    'review_pos_drawer_period_cashup(jsonb)',
    'get_pos_drawer_period_state(jsonb)',
    'set_outlet_cash_model(uuid, uuid, text)',
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, (c) => `\\${c}`)} to anon, authenticated, service_role`), `${fn} granted`)
  }
  assert.match(migration, /revoke all on function public\.pos_drawer_period_expected\(uuid, uuid, timestamptz\) from public/)
})

test('cash-model switches are admin-only, blocked by open activity, and audited', () => {
  assert.match(migration, /array\['admin', 'super_admin'\]/)
  assert.match(migration, /Close every open Till shift in this outlet/)
  assert.match(migration, /Finish the open drawer period in this outlet/)
  assert.match(migration, /Review every submitted cash-up in this outlet/)
  assert.match(migration, /cash_model_changed/)
  assert.match(migration, /restaurant_outlet_control_audit/)
})

test('the outlet audit action check admits the cash-model switch', () => {
  // The village migration inserts 'cash_model_changed' into the outlet audit,
  // whose check (20260716) only admitted the four legacy actions — every
  // switch aborted live on the audit insert and the outlet never changed.
  // The fix widens the check forward-only, keeping every legacy action.
  assert.match(auditFix, /restaurant_outlet_control_audit_action_check/)
  assert.match(auditFix, /'cash_model_changed'/)
  for (const action of ['created', 'updated', 'activated', 'deactivated']) {
    assert.match(auditFix, new RegExp(`'${action}'`), `legacy action ${action} kept`)
  }
  assert.doesNotMatch(auditFix, /insert into|update |delete from/i)
})

test('clock-out keeps personal guards and releases shared drawers only', () => {
  assert.match(migration, /Submit My Cash-up before clocking out\./)
  assert.match(migration, /still needs a submitted cash-up before clocking out\./)
  assert.match(migration, /coalesce\(\(select o\.cash_model from public\.outlets o join public\.pos_shifts p on p\.outlet_id = o\.id where p\.id = v_pos\), 'personal_bank'\) = 'shared_drawer'/)
  assert.match(migration, /<> 'shared_drawer'/)
})

test('the retired drawer-close contract is not revived', () => {
  assert.doesNotMatch(migration, /create or replace function public\.close_cash_drawer_session/i)
  assert.doesNotMatch(migration, /create or replace function public\.open_cash_drawer_session/i)
})

test('drawer opens replay exactly and record a conflicting float as a conflict', () => {
  assert.match(migration, /open_idempotency_key/)
  assert.match(migration, /pos_cash_periods_open_key_uniq/)
  assert.match(migration, /already used to open the drawer with a different starting float/)
  assert.match(migration, /'replayed', true/)
})
