import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const sql = readFileSync('supabase/migrations/20260729140000_cashup_idempotency_payload_guard.sql', 'utf8')
const attendanceSessionGrantSql = readFileSync('supabase/migrations/20260816190000_attendance_pin_custom_session_grant.sql', 'utf8')

test('cash-up idempotency locks and validates the cashier payload', () => {
  assert.match(sql, /submit_pos_shift_cashup\(jsonb\)\s+rename to _submit_pos_shift_cashup_v1/i)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_lodge_id::text \|\| ':' \|\| v_key/i)
  assert.match(sql, /where lodge_id = v_lodge_id and idempotency_key = v_key\s+for update/i)
  assert.match(sql, /v_existing\.shift_id is distinct from v_shift_id/)
  assert.match(sql, /v_existing\.cashier_id is distinct from v_shift\.cashier_id/)
  assert.match(sql, /v_existing\.submitted_by is distinct from v_actor/)
  assert.match(sql, /v_existing\.notes is distinct from v_notes/)
  assert.match(sql, /'code', 'idempotency_conflict'/)
  assert.match(sql, /'replayed', true/)
})

test('shared attendance-PIN cash-up validates the manager actor and staff payload', () => {
  assert.match(sql, /submit_pos_shift_cashup_with_attendance_pin\(jsonb\)\s+rename to _submit_pos_shift_cashup_with_attendance_pin_v1/i)
  assert.match(sql, /_restaurant_validate_attendance_pin\(v_lodge_id,v_shift\.cashier_id,v_pin/i)
  assert.match(sql, /v_existing_actor is distinct from v_actor/)
  assert.match(sql, /action='cashup_submitted_shared_terminal'/)
  assert.match(sql, /v_existing\.submitted_by is distinct from v_shift\.cashier_id/)
})

test('desktop application sessions may use protected attendance-PIN clock-in and clock-out', () => {
  assert.match(attendanceSessionGrantSql, /revoke all on function public\.clock_in_staff_with_attendance_pin\(jsonb\) from public/i)
  assert.match(attendanceSessionGrantSql, /revoke all on function public\.clock_out_staff_with_attendance_pin\(jsonb\) from public/i)
  assert.match(attendanceSessionGrantSql, /grant execute on function public\.clock_in_staff_with_attendance_pin\(jsonb\)\s+to anon, authenticated, service_role/i)
  assert.match(attendanceSessionGrantSql, /grant execute on function public\.clock_out_staff_with_attendance_pin\(jsonb\)\s+to anon, authenticated, service_role/i)
})
