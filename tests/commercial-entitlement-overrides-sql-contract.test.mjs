import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const migration = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20260829110000_commercial_entitlement_overrides.sql'), 'utf8')

test('commercial overrides are product-scoped, auditable, expiring, and soft-revocable', () => {
  assert.match(migration, /create table if not exists public\.commercial_entitlement_overrides/i)
  assert.match(migration, /product_id text not null check \(product_id in \('lodge-camp', 'hotel', 'hospitality-pos'\)\)/i)
  assert.match(migration, /reason text not null check \(length\(btrim\(reason\)\) >= 8\)/i)
  assert.match(migration, /created_by uuid not null/i)
  assert.match(migration, /expires_at timestamptz/i)
  assert.match(migration, /revoked_at timestamptz/i)
  assert.match(migration, /commercial_entitlement_override_one_value/i)
  assert.match(migration, /commercial_entitlement_override_revoke_check/i)
  assert.match(migration, /'monthly_bookings_grace'/i)
})

test('effective entitlement and all usage guards consume active override values', () => {
  assert.match(migration, /get_lodge_entitlement\(\s*p_lodge_id uuid,\s*p_product_id text\s*\)/i)
  assert.match(migration, /'effective_limits', v_effective_limits/i)
  assert.match(migration, /_commercial_active_override_snapshot\(p_lodge_id, v_product\)/i)
  assert.match(migration, /_commercial_target_limits\(new\.lodge_id, 'lodge-camp', 'Starter'\)/i)
  assert.match(migration, /v_user_limit is not null and v_user_count > v_user_limit/i)
  assert.match(migration, /v_user_limit is not null and v_existing_count >= v_user_limit/i)
  assert.match(migration, /v_booking_limit := nullif\(v_limits->>'monthly_bookings'/i)
  assert.doesNotMatch(migration, /if v_user_count > 2 then/i)
  assert.doesNotMatch(migration, /if v_existing_count >= 2 then/i)
  assert.match(migration, /'users', 25,\s*'rooms', 100,\s*'monthly_bookings', 2000,\s*'booking_grace', 50/i)
})

test('feature overrides retain product identity and security boundaries', () => {
  assert.match(migration, /_commercial_non_overridable_feature/i)
  assert.match(migration, /_license_plan_features\('Pro', false, false\)->>r\.feature_key/i)
  assert.match(migration, /_commercial_feature_allowed/i)
  assert.match(migration, /That feature is not part of the selected product catalogue/i)
  assert.match(migration, /Numeric usage allowances are not applicable to this product catalogue/i)
  assert.match(migration, /commercial_package_prices package_price/i)
  assert.match(migration, /if v_product = 'lodge-camp' then/i)
  assert.match(migration, /Security, tenancy, product identity, audit, idempotency, and financial controls cannot be overridden/i)
  assert.match(migration, /feature_key = 'pwa' and v_product = 'lodge-camp'/i)
  assert.match(migration, /_commercial_target_feature_map\(new\.lodge_id, 'lodge-camp', 'Standard'/i)
})

test('preview and governed assignment expose pending remediation without mutation', () => {
  assert.match(migration, /create or replace function public\.get_commercial_transition_preview/i)
  assert.match(migration, /'ready_to_activate', jsonb_array_length\(v_blockers\) = 0/i)
  assert.match(migration, /'pending_remediation', jsonb_array_length\(v_blockers\) > 0/i)
  assert.match(migration, /commercial_subscription_pending_remediation/i)
  assert.match(migration, /subscription_request_pending_remediation/i)
  assert.match(migration, /'data_policy', 'No users, rooms, bookings, financial records, or feature data are deleted automatically/i)
})

test('override mutations require a fresh active master-admin identity and governed operation', () => {
  assert.match(migration, /_command_central_require_fresh_master_admin/i)
  assert.match(migration, /p_fresh_auth_at < now\(\) - interval '15 minutes'/i)
  assert.match(migration, /from public\.master_admins admin/i)
  assert.match(migration, /command_central_claim_operation\(v_operation_id, 'commercial_entitlement_override\.(set|revoke)'/i)
  assert.match(migration, /commercial_entitlement_override_set/i)
  assert.match(migration, /commercial_entitlement_override_revoked/i)
})
