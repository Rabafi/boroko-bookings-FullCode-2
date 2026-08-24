import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Bar setup completion timestamps are returned from source evidence and may remain null', () => {
  const migration = read('supabase/migrations/20260820130000_bar_setup_alert_checklist_controls.sql')
  const screen = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  assert.match(migration, /'completed_at',case when v_settings is not null then v_business_at else null end/)
  assert.match(migration, /staff_access_audit/)
  assert.match(migration, /greatest\(v_export_at, v_sale_at, v_drawer_at, v_cashup_at, v_digest_at\)/)
  assert.match(screen, /Authoritative evidence completed/)
  assert.match(screen, /completion time is not available from the source record/)
  assert.doesNotMatch(screen, /completed_at: new Date\(\)/)
})

test('Bar alert lifecycle is scoped, category-filterable and append-only audited', () => {
  const migration = read('supabase/migrations/20260820130000_bar_setup_alert_checklist_controls.sql')
  const domain = read('src/main/domains/pos.js')
  const control = read('src/renderer/src/components/hospitality-pos/HposControl.jsx')
  assert.match(migration, /restaurant_alert_events/)
  assert.match(migration, /acknowledge_exception_alert/)
  assert.match(migration, /resolved_reason text/)
  assert.match(migration, /p_alert_category text default null/)
  assert.match(migration, /stock.*financial.*operational.*compliance/)
  assert.match(migration, /v_category text/)
  assert.match(migration, /app_require_pos_outlet_access/)
  assert.match(migration, /p_outlet_id is not null and \(a0\.outlet_id is null or a0\.outlet_id = p_outlet_id\)/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /different payload/)
  assert.match(migration, /sha256/)
  assert.match(migration, /length\(v_message\) > 2000/)
  assert.match(migration, /length\(v_entity_type\) > 100/)
  assert.match(migration, /length\(v_reason\) > 500/)
  assert.match(migration, /nullif\(payload->>'alert_id', ''\)::uuid/)
  assert.match(migration, /custom alerts must declare a high-level category/i)
  assert.match(migration, /revoke all on table public\.restaurant_alerts from public, anon, authenticated/)
  assert.match(domain, /get_restaurant_alert_history/)
  assert.match(domain, /acknowledge_exception_alert/)
  assert.match(control, /AlertToolbar/)
  assert.match(control, /alertSeverity/)
  assert.match(control, /AlertCategoryIcon/)
  assert.match(control, /Acknowledge/)
  assert.match(control, /Resolved alert history/)
  assert.match(control, /alertOperationIds/)
  assert.match(control, /window\.prompt\('Why is this alert being resolved/)
  const legacyPos = read('src/renderer/src/components/POS.jsx')
  assert.match(legacyPos, /pos-alert-resolve:\$\{a\.id\}/)
  assert.match(legacyPos, /!result\?\.success \|\| !result\.resolved_at/)
  assert.match(legacyPos, /setActiveAlerts\(\(previous\) => previous\.filter/)
  const restaurantAlerts = read('src/renderer/src/components/restaurant/RestaurantAlerts.jsx')
  assert.match(restaurantAlerts, /getAlertHistory\(\{ includeResolved: true \}\)/)
  assert.match(restaurantAlerts, /restaurant-alert-resolve:\$\{alertId\}/)
  assert.match(restaurantAlerts, /result\?\.success !== true \|\| !result\.resolved_at/)
  assert.doesNotMatch(control, /resolved_at: new Date\(\)/)
})

test('Bar checklist templates seed idempotently and instantiate through server contracts', () => {
  const migration = read('supabase/migrations/20260820130000_bar_setup_alert_checklist_controls.sql')
  const domain = read('src/main/domains/pos.js')
  const preload = read('src/preload/index.js')
  assert.match(migration, /restaurant_checklist_templates/)
  assert.match(migration, /bar_opening/)
  assert.match(migration, /bar_closing/)
  assert.match(migration, /bar_end_of_shift/)
  assert.match(migration, /bar_weekly_deep_clean/)
  assert.match(migration, /on conflict \(lodge_id, template_key\) do nothing/i)
  assert.match(migration, /create_bar_checklist_from_template/)
  assert.match(migration, /stable checklist operation ID/)
  assert.match(migration, /restaurant_checklists_lodge_operation_uidx/)
  assert.match(migration, /different template or outlet/)
  assert.match(migration, /payload_hash text/)
  assert.match(domain, /seed_bar_checklist_templates/)
  assert.match(domain, /create_bar_checklist_from_template/)
  assert.match(domain, /operation_id: operationId \|\| randomUUID\(\)/)
  assert.match(preload, /createBarChecklistFromTemplate/)
})

test('Bar checklist creation targets the deployed partial operation index', () => {
  const repair = read('supabase/migrations/20260820160000_bar_checklist_operation_conflict_target_repair.sql')
  assert.match(
    repair,
    /on conflict \(lodge_id, operation_id\) where operation_id is not null do nothing/i,
    'checklist retries must match the nullable operation_id partial unique index',
  )
  assert.doesNotMatch(
    repair,
    /on conflict \(lodge_id, operation_id\) do nothing/i,
    'an unqualified conflict target cannot infer the deployed partial index',
  )
  const source = read('supabase/migrations/20260820130000_bar_setup_alert_checklist_controls.sql')
  assert.match(source, /restaurant_checklists_lodge_operation_uidx/)
  assert.match(repair, /create or replace function public\.create_bar_checklist_from_template/)
})
