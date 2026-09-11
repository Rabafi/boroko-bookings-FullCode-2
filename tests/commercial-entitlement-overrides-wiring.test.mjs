import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')
const admin = read('src/main/domains/admin.js')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const database = read('src/main/database.js')
const workbench = read('src/renderer/src/components/LicensingWorkbench.jsx')
const entitlements = read('src/main/domains/entitlements.js')
const migration = read('supabase/migrations/20260829110000_commercial_entitlement_overrides.sql')

test('Command Central commercial override RPCs are wired through the trusted main-process boundary', () => {
  for (const name of [
    'getCommercialEntitlementOverrides',
    'getCommercialTransitionPreview',
    'setCommercialEntitlementOverride',
    'revokeCommercialEntitlementOverride',
    'applyCommercialUserRemediation'
  ]) {
    assert.match(admin, new RegExp(`export async function ${name}`))
    assert.match(database, new RegExp(name))
    assert.match(preload, new RegExp(name))
    assert.match(main, new RegExp(`admin:${name}`))
  }
  assert.match(main, /fresh_auth_at: new Date\(\)\.toISOString\(\)/)
  assert.match(main, /command_central\.licensing\.manage/)
})

test('Command Central shows product-scoped feature and numeric override controls', () => {
  assert.match(workbench, /Commercial Entitlement Control/)
  assert.match(workbench, /Every Product Feature/)
  assert.match(workbench, /Numeric Allowances/)
  assert.match(workbench, /setCommercialEntitlementOverride/)
  assert.match(workbench, /revokeCommercialEntitlementOverride/)
  assert.match(workbench, /Active users to 3/)
  assert.match(workbench, /reason of at least 8 characters/i)
})

test('pending user remediation requires explicit account selection and never deletes users', () => {
  assert.match(workbench, /Choose the \{pendingUserRemediation\.limit\} account\(s\) that remain active/)
  assert.match(workbench, /applyCommercialUserRemediation/)
  assert.match(migration, /create or replace function public\.admin_apply_commercial_user_remediation/)
  assert.match(migration, /set status = 'suspended', pwa_enabled = false/)
  assert.match(migration, /update public\.app_sessions set revoked_at = now\(\)/)
  assert.doesNotMatch(migration, /delete from public\.users/i)
})

test('desktop entitlement reads are tied to the executable product with a safe staged fallback', () => {
  assert.match(entitlements, /p_product_id: productId/)
  assert.match(entitlements, /productId === 'lodge-camp'/)
  assert.match(entitlements, /licenseQuery\.eq\('product_id', productId\)/)
})

test('effective capacity checks count active accounts so suspended overflow resolves the transition', () => {
  assert.match(migration, /count\(\*\) filter \(where lower\(coalesce\(status, 'active'\)\) = 'active'\)/)
  assert.match(migration, /lower\(coalesce\(u\.status, 'active'\)\) = 'active'/)
  assert.doesNotMatch(migration, /v_user_count > 2/)
})
