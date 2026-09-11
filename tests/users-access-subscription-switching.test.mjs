import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'
import { getCommercialOffer } from '../src/shared/commercialEntitlements.js'
import { getModuleByKey } from '../src/shared/moduleCatalog.js'

const staff = readFileSync('src/renderer/src/components/Staff.jsx', 'utf8')
const authUsers = readFileSync('src/main/domains/authUsers.js', 'utf8')
const entitlements = readFileSync('src/main/domains/entitlements.js', 'utf8')
const migration = readFileSync('supabase/migrations/20260828091000_users_access_subscription_guards.sql', 'utf8')
const plans = readFileSync('src/shared/subscriptionPlans.js', 'utf8')

test('Users & Access keeps Manager Mobile App Pro-only in every entitlement map', () => {
  assert.equal(getPlanFeatureMap('Standard').pwa, false)
  assert.equal(getPlanFeatureMap('Pro').pwa, true)
  assert.equal(getCommercialOffer('lodge-camp', 'standard').includedFeatures.includes('pwa'), false)
  assert.equal(getCommercialOffer('lodge-camp', 'pro').includedFeatures.includes('pwa'), true)
  assert.equal(getModuleByKey('pwa').requiredPlan, 'Pro')
  assert.match(plans, /Standard:[\s\S]*Manager Mobile App/)
})

test('Staff mobile status and form are gated by the PWA entitlement', () => {
  assert.match(staff, /const pwaFeatureEnabled = features\?\.pwa === true/)
  assert.match(staff, /\{pwaFeatureEnabled && pwaEligible && \(/)
  assert.match(staff, /\{pwaFeatureEnabled && isPwaEligibleRole\(form\.role\) && \(/)
  assert.match(staff, /Manager mobile app access is available on Pro\./)
  assert.doesNotMatch(staff, /mobile access, and outlet assignments are available on Standard/)
})

test('desktop Users & Access rejects PWA enablement before mutating or queueing', () => {
  assert.match(authUsers, /async function assertPwaEntitlementForUpdate\(enabled\)/)
  assert.match(authUsers, /if \(state\.isOnline !== true\)[\s\S]*Pro entitlement can be verified/)
  assert.match(authUsers, /getAuthoritativeTrialStatus\(state\.lodgeId\)/)
  assert.match(entitlements, /export async function getAuthoritativeTrialStatus\(lodgeId\)/)
  assert.match(entitlements, /without any disk, legacy-query, or trial[\s\S]*fallback/)
  assert.match(entitlements, /supabaseRpcWithTimeout\(state\.supabase, 'get_lodge_entitlement'/)
  assert.match(authUsers, /effective_features\?\.pwa !== true/)
  assert.match(authUsers, /const pwaAccess = resolvePwaAccessUpdate\(\{\}, data\);[\s\S]*await assertPwaEntitlementForUpdate\(pwaAccess\.enabled\)/)
  assert.match(authUsers, /const pwaAccess = resolvePwaAccessUpdate\(existingUser, buildPwaAccessInput\(data\)\);[\s\S]*await assertPwaEntitlementForUpdate\(pwaAccess\.enabled\)/)
})

test('server PWA mutation is fail-closed for every caller', () => {
  assert.match(migration, /if p_enabled then[\s\S]*get_lodge_entitlement\(p_lodge_id\)/)
  assert.doesNotMatch(migration, /p_enabled and not public\.app_is_service_role/)
  assert.match(migration, /get_lodge_entitlement\(p_lodge_id\)/)
  assert.match(migration, /Manager mobile app access is not included in this subscription\. Upgrade to Pro/)
  assert.match(migration, /if not p_enabled then[\s\S]*update public\.app_sessions[\s\S]*session_type = 'pwa'/)
})

test('every active Standard assignment rejects existing PWA users or active sessions without rewriting users', () => {
  assert.match(migration, /create or replace function public\.enforce_pro_standard_pwa_transition\(\)/)
  assert.match(migration, /v_target_standard boolean[\s\S]*subscription_plan[\s\S]*= 'standard'/)
  assert.match(migration, /v_pwa_user_count/)
  assert.match(migration, /v_active_pwa_session_count/)
  assert.match(migration, /Cannot activate Standard:/)
  assert.match(migration, /active mobile session\(s\) remain/)
  assert.match(migration, /aaa_pro_standard_pwa_transition_guard/)
  assert.doesNotMatch(migration, /if not v_previous_pro/)
  assert.doesNotMatch(migration, /update public\.users\s+set[\s\S]{0,160}subscription_plan/i)
})

test('governed subscription wrappers preserve the actionable downgrade error', () => {
  assert.match(migration, /admin_governed_assign_commercial_subscription[\s\S]*Cannot activate Standard:/)
  assert.match(migration, /admin_governed_activate_subscription_request[\s\S]*Cannot activate Standard:/)
})
