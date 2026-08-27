import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve('supabase/migrations/20260826000000_starter_recovery_and_automation.sql')
const sql = fs.readFileSync(migrationPath, 'utf8')

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} is defined`)
  const end = sql.indexOf('\n$$;', start)
  assert.notEqual(end, -1, `${name} has a closed body`)
  return sql.slice(start, end)
}

test('starter recovery SQL has an honest bounded transport and least-privilege RPC surface', () => {
  assert.match(sql, /8 MiB server payload limit/i)
  assert.match(sql, /pg_column_size\(p_payload\) > 8388608/)
  assert.match(sql, /package_bytes.*between 1 and 8388608/si)
  assert.doesNotMatch(sql, /starter_recovery_staging_chunks/)
  assert.doesNotMatch(sql, /app_is_master_admin\(\)/)
  assert.match(sql, /command_central\.recovery\.manage/)
  assert.match(sql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/)
  assert.match(sql, /grant execute on function public\.admin_execute_starter_disposable_restore\(jsonb\)\s+to service_role/i)
  assert.match(sql, /grant execute on function public\.admin_verify_starter_disposable_restore\(text\)\s+to service_role/i)
  assert.match(sql, /revoke all on function public\.admin_execute_starter_disposable_restore\(jsonb\)\s+from public, anon, authenticated/i)
  assert.match(sql, /revoke all on function public\.admin_verify_starter_disposable_restore\(text\)\s+from public, anon, authenticated/i)
})

test('starter recovery SQL maps only authoritative current core columns', () => {
  const roomsInsert = sql.match(/insert into public\.rooms\s*\(([^)]*)\)/i)?.[1] || ''
  const maintenanceInsert = sql.match(/insert into public\.maintenance_tickets\s*\(([^)]*)\)/i)?.[1] || ''
  const validator = functionBody('_starter_recovery_validate_payload')
  assert.match(roomsInsert, /rate_per_night/)
  assert.match(roomsInsert, /max_occupancy/)
  for (const field of [
    'room_type_id', 'floor_section_id', 'accommodation_kind', 'capacity_adults',
    'capacity_children', 'max_tents', 'max_vehicles', 'is_powered',
    'site_surface', 'shared_facilities', 'rate_mode', 'rate_per_person',
    'rate_per_tent', 'rate_per_vehicle'
  ]) {
    assert.match(roomsInsert, new RegExp(`\\b${field}\\b`), `rooms inserts ${field}`)
    assert.match(validator, new RegExp(`'${field}'`), `validator allows ${field}`)
  }
  assert.match(sql, /public_offer_rooms/)
  assert.match(sql, /public_offer_campsites/)
  assert.match(sql, /operating_profile/)
  assert.doesNotMatch(roomsInsert, /\bfloor\b|\bcapacity\b|\bprice_per_night\b/)
  assert.doesNotMatch(roomsInsert, /\bphoto\b|\bphotos\b/)
  const execute = functionBody('admin_execute_starter_disposable_restore')
  assert.match(execute, /null::uuid,\s*null::uuid,\s*coalesce\(elem->>'accommodation_kind'/)
  assert.doesNotMatch(execute, /from public\.(room_types|floor_sections)/i)
  assert.match(execute, /unresolved_room_type_refs/)
  assert.match(execute, /unresolved_floor_section_refs/)
  assert.match(execute, /dimension_rows_not_in_package/)
  assert.match(maintenanceInsert, /\btitle\b/)
  assert.match(maintenanceInsert, /\breported_date\b/)
  assert.doesNotMatch(maintenanceInsert, /\breported_by\b|\bissue\b|\bresolved_at\b/)
  assert.match(sql, /quotation_number/)
  assert.match(sql, /customer_name/)
  assert.match(sql, /Booking quotation_id is intentionally NULL/i)
})

test('starter recovery SQL protects financial truth and validates signed deltas', () => {
  const bookingInsert = sql.match(/insert into public\.bookings\s*\(([^)]*)\)/i)?.[1] || ''
  const paymentInsert = sql.match(/insert into public\.payments\s*\(([^)]*)\)/i)?.[1] || ''
  assert.doesNotMatch(bookingInsert, /amount_paid|payment_status|create_idempotency_key/i)
  assert.doesNotMatch(paymentInsert, /idempotency_key/i)
  assert.match(sql, /v_type = 'refund' and v_amount >= 0/)
  assert.match(sql, /v_type <> 'refund' and v_amount <= 0/)
  assert.match(sql, /public\.compute_payment_status\(t\.amount_paid, t\.total_amount, t\.charges_total\)/)
  assert.match(sql, /Protected field % is not accepted/i)
  assert.match(sql, /passphrase|password|private[_ ]key|service[_ ]role[_ ]key/i)
  assert.match(sql, /conference payment references are outside/i)
})

test('starter recovery SQL is atomic, idempotent by payload, quarantined, and verifiable', () => {
  const execute = functionBody('admin_execute_starter_disposable_restore')
  const verify = functionBody('admin_verify_starter_disposable_restore')
  assert.match(execute, /pg_advisory_xact_lock\(hashtextextended\(v_operation_id, 0\)\)/)
  assert.match(execute, /Operation ID was reused with a different payload/i)
  assert.match(execute, /v_existing\.payload_sha256 is distinct from v_payload_sha256/)
  assert.match(execute, /status = 'verified'/)
  assert.match(execute, /is_disposable_recovery/)
  assert.match(execute, /Do not add an EXCEPTION handler here/i)
  assert.doesNotMatch(execute, /exception\s+when\s+others/i)
  assert.match(sql, /starter_recovery_audit_immutable/)
  assert.match(sql, /starter_recovery_audit_secret_guard/)
  assert.match(sql, /append-only/i)
  assert.match(verify, /counts_match/)
  assert.match(verify, /isolation_ok/)
  assert.match(verify, /ledger_reconciliation/)
  assert.match(verify, /unresolved_room_type_references/)
  assert.match(verify, /unresolved_floor_section_references/)
  assert.match(verify, /replay_is_safe/)
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, 'SQL dollar-quoted bodies are balanced')
})

test('post-deploy recovery guardrails are the latest forward definitions', () => {
  const migrationsDir = path.resolve('supabase/migrations')
  const recoveryMigrations = fs.readdirSync(migrationsDir)
    .filter((name) => /^202608\d+.*starter_recovery.*\.sql$/i.test(name))
    .sort()
  const postDeployName = '20260827010000_starter_recovery_postdeploy_guardrails.sql'
  assert.ok(recoveryMigrations.includes(postDeployName), 'post-deploy guardrail migration is present')
  const latest = fs.readFileSync(path.join(migrationsDir, postDeployName), 'utf8')

  const latestBody = (name) => {
    const start = latest.indexOf(`create or replace function public.${name}`)
    assert.notEqual(start, -1, `${name} is redefined in the forward migration`)
    const end = latest.indexOf('\n$$;', start)
    assert.notEqual(end, -1, `${name} has a closed forward body`)
    return latest.slice(start, end)
  }

  const validator = latestBody('_starter_recovery_validate_payload')
  const execute = latestBody('admin_execute_starter_disposable_restore')
  const verify = latestBody('admin_verify_starter_disposable_restore')
  assert.match(validator, /nullif\(btrim\(p_payload->>'operation_id'\), ''\) is null/)
  assert.match(validator, /A UUID v4 operation ID is required/)
  assert.match(execute, /pg_advisory_xact_lock\(hashtextextended\(v_operation_id, 0\)\)/)
  assert.match(execute, /v_existing\.recovery_lodge_id is distinct from v_recovery_lodge_id/)
  assert.match(execute, /v_existing\.actor_id is distinct from v_actor/)
  assert.match(execute, /v_existing\.actor_email is distinct from v_actor_email/)
  assert.match(execute, /v_result := public\._starter_recovery_execute_v1\(p_payload\)/)
  assert.ok(execute.indexOf("if v_existing.status = 'verified'") < execute.indexOf('public._starter_recovery_execute_v1'), 'verified replay is checked before delegated target rejection')
  assert.match(latest, /update public\.settings\s+set deleted = true/i)
  assert.match(execute, /coalesce\(is_disposable_recovery, false\) = true/)
  assert.match(verify, /coalesce\(s\.is_disposable_recovery, false\).*coalesce\(s\.deleted, false\)/s)
  assert.match(verify, /quarantine_complete/)
  assert.match(latest, /grant execute on function public\.admin_execute_starter_disposable_restore\(jsonb\)\s+to service_role/i)
  assert.match(latest, /grant execute on function public\.admin_verify_starter_disposable_restore\(text\)\s+to service_role/i)
  assert.equal((latest.match(/\$\$/g) || []).length % 2, 0, 'forward SQL dollar-quoted bodies are balanced')
})

test('latest recovery forward migration preserves campsite booking detail atomically', () => {
  const migrationsDir = path.resolve('supabase/migrations')
  const latestName = fs.readdirSync(migrationsDir)
    .filter((name) => /^202608\d+.*starter_recovery.*\.sql$/i.test(name))
    .sort()
    .at(-1)
  const latest = fs.readFileSync(path.join(migrationsDir, latestName), 'utf8')
  const executeStart = latest.indexOf('create or replace function public.admin_execute_starter_disposable_restore')
  const executeEnd = latest.indexOf('\n$$;', executeStart)
  const execute = latest.slice(executeStart, executeEnd)
  const validatorStart = latest.indexOf('create or replace function public._starter_recovery_validate_payload')
  const validatorEnd = latest.indexOf('\n$$;', validatorStart)
  const validator = latest.slice(validatorStart, validatorEnd)
  const verifyStart = latest.indexOf('create or replace function public.admin_verify_starter_disposable_restore')
  const verifyEnd = latest.indexOf('\n$$;', verifyStart)
  const verify = latest.slice(verifyStart, verifyEnd)

  assert.equal(latestName, '20260827020000_starter_recovery_campsite_booking_completeness.sql')
  for (const field of ['tents_count', 'vehicles_count', 'accommodation_kind', 'booking_accommodation_details']) {
    assert.match(validator, new RegExp(`'${field}'`), `validator recognizes ${field}`)
    assert.match(execute, new RegExp(field), `execute handles ${field}`)
  }
  assert.match(validator, /booking_id must equal its containing booking ID/i)
  assert.match(validator, /lodge_id must equal the recovery lodge/i)
  assert.match(validator, /pricing_snapshot must be a bounded JSON object/i)
  assert.match(validator, /cannot be negative/i)
  assert.match(execute, /_starter_recovery_strip_campsite_booking_fields/)
  assert.match(execute, /payload_sha256 = v_full_payload_sha256/)
  assert.match(execute, /insert into public\.booking_accommodation_details/i)
  assert.match(execute, /expected_campsite_detail_count/)
  assert.match(execute, /actual_campsite_detail_count/)
  assert.ok(execute.indexOf('v_result := public._starter_recovery_execute_v2(v_base_payload)') > 0)
  assert.ok(execute.indexOf('if v_existing.status = \'verified\'') < execute.indexOf('public._starter_recovery_execute_v2'), 'full-payload replay is checked before delegation')
  assert.match(verify, /booking_accommodation_details/)
  assert.match(verify, /expected_campsite_detail_count/)
  assert.match(verify, /actual_campsite_detail_count/)
  assert.match(execute, /coalesce\(s\.deleted, false\)/i)
  assert.match(execute, /coalesce\(s\.is_disposable_recovery, false\)/i)
  assert.match(latest, /grant execute on function public\.admin_execute_starter_disposable_restore\(jsonb\)\s+to service_role/i)
  assert.match(latest, /grant execute on function public\.admin_verify_starter_disposable_restore\(text\)\s+to service_role/i)
  assert.equal((latest.match(/\$\$/g) || []).length % 2, 0, 'latest forward SQL dollar-quoted bodies are balanced')
})
