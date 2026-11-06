import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261022090000_lodgingos_public_booking_server_group_and_child_tokens.sql'), 'utf8')
const acceptance = fs.readFileSync(path.join(root, 'tests/public-tent-booking-acceptance.sql'), 'utf8')
const transitionRunner = fs.readFileSync(path.join(root, 'scripts/verify-property-transitions-disposable.mjs'), 'utf8')
const publicRunner = fs.readFileSync(path.join(root, 'scripts/verify-public-booking-disposable.mjs'), 'utf8')

test('public multi-unit child tokens remain unique while the lead token remains the response token', () => {
  assert.match(migration, /array_length\(v_booking_ids, 1\) is null then v_confirmation_token[\s\S]*?gen_random_uuid\(\)::text/i)
  assert.match(migration, /Child-token patch expected one booking insert token/)
  const envelope = fs.readFileSync(path.join(root, 'supabase/migrations/20261005050000_luna_booking_public_group_envelopes.sql'), 'utf8')
  assert.match(envelope, /'booking_id',v_booking_ids\[1\]/, 'the persisted receipt remains paired to the first booking')

  const bookingPage = fs.readFileSync(path.join(root, 'booking-site/src/pages/BookingPage.jsx'), 'utf8')
  assert.match(bookingPage, /confirmation_token: data\.confirmation_token/)
  const emailFunction = fs.readFileSync(path.join(root, 'supabase/functions/send-booking-confirmation/index.ts'), 'utf8')
  assert.match(emailFunction, /const \{ booking_id, guest_email, confirmation_token \}/)
  assert.match(emailFunction, /online_confirmation_token[\s\S]*?requestedToken !== storedToken/)
})

test('public invoice helper is server-only, envelope-bound, exact-line validated, and atomic', () => {
  const helper = migration.slice(migration.indexOf('create or replace function public._create_public_booking_invoice_group'), migration.indexOf('revoke all on function public._create_public_booking_invoice_group'))
  assert.match(helper, /security definer/i)
  assert.match(helper, /public_booking_idempotency[\s\S]*?idempotency_key = p_operation_key[\s\S]*?for update/i)
  assert.match(helper, /v_envelope\.result is not null/)
  assert.match(helper, /v_envelope\.original_request->'payload'/)
  assert.match(helper, /array_agg\(b\.id order by r\.ordinality\)/)
  assert.match(helper, /create_idempotency_key is not distinct from case[\s\S]*?when r\.ordinality = 1 then p_operation_key[\s\S]*?else p_operation_key \|\| ':' \|\| b\.room_id::text/)
  assert.match(helper, /coalesce\(v_payload->>'guest_email', ''\)/)
  assert.match(helper, /public-invoice-group:' \|\| p_lodge_id::text \|\| ':' \|\| p_operation_key/)
  assert.match(helper, /b\.tents_count is not distinct from greatest\(0, coalesce\(nullif\(r\.value->>'tents'/)
  assert.match(helper, /b\.vehicles_count is not distinct from greatest\(0, coalesce\(nullif\(r\.value->>'vehicles'/)
  assert.match(helper, /booking_invoice_group_lines l where l\.booking_id = any\(p_booking_ids\)/)
  assert.match(migration, /revoke all on function public\._create_public_booking_invoice_group[\s\S]*?from public, anon, authenticated/i)
  assert.match(migration, /public\._create_public_booking_invoice_group\([\s\S]*?v_idem_key/)
  assert.match(migration, /v_group_key := ''online-'' \|\| substring\(encode\(sha256\(convert_to\(''public-invoice-group:'' \|\| v_lodge_id::text \|\| '':'' \|\| v_idem_key/)
})

test('staff invoice RPC keeps anon-key custom-session transport and in-body authorization', () => {
  assert.match(migration, /grant execute on function public\.create_booking_invoice_group\([\s\S]*?to anon, authenticated/i)
  assert.doesNotMatch(migration, /revoke all on function public\.create_booking_invoice_group\([\s\S]*?from public, anon/i)
  assert.match(fs.readFileSync(path.join(root, 'supabase/migrations/20260703133000_accommodation_group_invoices.sql'), 'utf8'), /app_require_lodge_role\(p_lodge_id/)
  assert.match(fs.readFileSync(path.join(root, 'supabase/migrations/20260703133000_accommodation_group_invoices.sql'), 'utf8'), /app_reject_pwa_financial_mutation\(\)/)
})

test('disposable public acceptance covers anonymous group receipts, replay, rollback, and preservation', () => {
  assert.match(acceptance, /luna_remediation_db_marker[\s\S]*?Refusing public booking acceptance/)
  assert.match(acceptance, /create function pg_temp\.luna_create_online_booking_as_anon[\s\S]*?set local role anon[\s\S]*?set_config\('app\.session_token', '', true\)[\s\S]*?public\.create_online_booking/)
  assert.match(acceptance, /online_confirmation_token/)
  assert.match(acceptance, /booking_id'[\s\S]*?v_group_ids\[1\]/)
  assert.match(acceptance, /exact group replay did not return its original ordered lead-bound receipt/)
  assert.match(acceptance, /invalid second line left a partial booking, detail, invoice or group record/)
  assert.match(acceptance, /booking_type', 'room'[\s\S]*?v_room2/)
  assert.match(acceptance, /NULL capacity fields mean uncapped/)
  assert.match(acceptance, /vehicle rate mode accepted a zero-vehicle stay/)
  assert.match(acceptance, /total_adults[\s\S]*?total_vehicles[\s\S]*?adults=3, children=1, tents=2, vehicles=0/)
  assert.match(acceptance, /v_preserved_rows_before[\s\S]*?v_preserved_rows_after[\s\S]*?jsonb_agg\(to_jsonb\(b\) order by b\.id\)/)
  assert.match(acceptance, /has_function_privilege\('anon', 'public\._create_public_booking_invoice_group/)
  assert.match(acceptance, /guest_email[\s\S]*?first child keeps the bare operation key/i)
  assert.match(acceptance, /authorized desktop staff grouping via anon transport/)
  assert.match(acceptance, /unauthenticated anon staff grouping is denied/)
  assert.match(acceptance, /substituted\/reordered public child IDs were not rejected/)
  assert.match(acceptance, /substituted public customer was not rejected/)
  assert.match(acceptance, /wrong-lodge public group call was not rejected/)
  assert.match(acceptance, /setup_complete[\s\S]*?true/)
  assert.match(acceptance, /has_function_privilege\('anon', 'public\.create_booking_invoice_group\([\s\S]*?EXECUTE'\) is not true/)
  assert.match(acceptance, /rollback;/i)
})

test('property-transition DB acceptance matches deployed RPC and request-role contracts', () => {
  assert.match(transitionRunner, /pg_get_functiondef\(t\.tgfoid\)[\s\S]*?from pg_trigger[\s\S]*?settings_property_transition_guard/)
  assert.doesNotMatch(transitionRunner, /classification_locked[\s\S]{0,80}commitDefinition/)
  assert.match(transitionRunner, /updated_at::text as updated_at/)
  assert.match(transitionRunner, /for \(const from of SUPPORTED_TYPES\)[\s\S]*?await setupReclassify\(from\)[\s\S]*?expected\.property_type[\s\S]*?expected\.updated_at/)
  assert.match(transitionRunner, /savepoint mismatch_reuse[\s\S]*?rollback to savepoint mismatch_reuse[\s\S]*?release savepoint mismatch_reuse/)
  assert.match(transitionRunner, /Private ledger inspection uses the verified test connection[\s\S]*?wrong-lodge-no-write/)
  assert.match(transitionRunner, /verify_classification_guard[\s\S]*?classification_guard_probe[\s\S]*?rollback to savepoint classification_guard_probe/)
  assert.match(transitionRunner, /No migrations are reapplied|never reapplies migrations/i)
})

test('property-transition runner imports the domain test helper through its own module URL', async () => {
  const runnerUrl = new URL('../scripts/verify-property-transitions-disposable.mjs', import.meta.url)
  const helperUrl = new URL('../tests/helpers/domain-test-setup.mjs', runnerUrl)
  const helpers = await import(helperUrl.href)
  assert.equal(typeof helpers.importState, 'function')
  assert.match(transitionRunner, /new URL\('\.\.\/tests\/helpers\/domain-test-setup\.mjs', import\.meta\.url\)/)
  assert.doesNotMatch(transitionRunner, /pathToFileURL/)
})

test('public SQL runner requires verified disposable identity and executes the rollback suite', () => {
  assert.match(publicRunner, /connectVerifiedDisposableDatabase\(\)/)
  assert.match(publicRunner, /DisposableDatabaseBlocked[\s\S]*?process\.exit\(2\)/)
  assert.match(publicRunner, /public-tent-booking-acceptance\.sql/)
  assert.match(publicRunner, /await client\.query\(sql\)/)
  assert.match(publicRunner, /row\.suite === 'public-tent-booking'/)
  assert.match(publicRunner, /the suite rolled back/)
  assert.doesNotMatch(publicRunner, /migrations\/.*\.sql|supabase db push/i)
})
