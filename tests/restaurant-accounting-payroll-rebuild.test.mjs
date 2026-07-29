import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql=fs.readFileSync(new URL('../supabase/migrations/20260720080000_restaurant_accounting_payroll_rebuild.sql',import.meta.url),'utf8')

test('uses effective-dated employment terms instead of users hourly rate',()=>{assert.match(sql,/restaurant_payroll_employment_terms/);assert.match(sql,/effective_from/);assert.doesNotMatch(sql,/users\.hourly_rate/)})
test('keeps regular and overtime input separate with maker-checker approval',()=>{assert.match(sql,/regular_hours/);assert.match(sql,/overtime_hours/);assert.match(sql,/Time-input maker cannot approve the same input/)})
test('versions statutory rules and snapshots each calculation',()=>{assert.match(sql,/restaurant_payroll_statutory_configurations/);assert.match(sql,/rule_version/);assert.match(sql,/calculation_snapshot_hash/)})
test('calculates progressive tax from configured brackets',()=>{assert.match(sql,/_restaurant_payroll_tax/);assert.match(sql,/jsonb_array_elements\(p_brackets\)/);assert.match(sql,/Invalid progressive tax bracket/)})
test('requires independent pay-run approval and unchanged snapshot',()=>{assert.match(sql,/Payroll preparer cannot approve the same run/);assert.match(sql,/Payroll calculation snapshot changed before approval/)})
test('exports immutable payment instructions without claiming payment',()=>{assert.match(sql,/on conflict\(lodge_id,pay_period_id,payload_hash\)do nothing/);assert.match(sql,/'exported_not_paid'/);assert.doesNotMatch(sql,/set status='paid'/)})
test('validates lodge payroll GL settings and posts a balanced immutable journal',()=>{assert.match(sql,/set_restaurant_payroll_gl_settings/);assert.match(sql,/post_restaurant_payroll_to_gl_v2/);assert.match(sql,/_restaurant_post_journal/);assert.match(sql,/'payroll:'\|\|p_pay_period_id/);assert.match(sql,/'payment_status','not_paid'/)})
test('separates payroll privacy view from payroll management',()=>{assert.match(sql,/_restaurant_require_capability\(p_lodge_id,'accounting\.payroll_view'\)/);assert.match(sql,/_restaurant_require_capability\(p_lodge_id,'accounting\.payroll_manage'\)/)})
test('keeps all payroll rebuild RPCs service-role only before restoration',()=>{assert.doesNotMatch(sql,/grant execute[\s\S]*to authenticated/i);assert.match(sql,/revoke all on function %s from public,anon,authenticated/)})

