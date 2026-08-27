import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'
import { getFeatureRequiredPlan } from '../src/shared/subscriptionPlans.js'
import { getCommercialOffer, getCommercialOffers } from '../src/shared/commercialEntitlements.js'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'
import { getModuleByKey } from '../src/shared/moduleCatalog.js'

const staff = readFileSync('src/renderer/src/components/Staff.jsx', 'utf8')
const nav = readFileSync('src/renderer/src/navigation/desktopNav.js', 'utf8')
const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260824060000_starter_users_access_lite.sql', 'utf8')
const authUsers = readFileSync('src/main/domains/authUsers.js', 'utf8')
const auth = readFileSync('src/main/domains/auth.js', 'utf8')
const admin = readFileSync('src/main/domains/admin.js', 'utf8')
const activation = readFileSync('supabase/migrations/20260816090000_command_central_subscription_truth_hardening.sql', 'utf8')
const catalogueBackfill = migration.slice(0, migration.indexOf('-- Commercial subscription activation'))

test('Starter exposes Users & Access as a separate feature boundary', () => {
  assert.equal(getFeatureRequiredPlan('staff_basic'), 'Starter')
  const basicModule = getModuleByKey('staff_basic')
  const fullModule = getModuleByKey('staff')
  assert.equal(basicModule.label, 'Users & Access')
  assert.equal(basicModule.requiredPlan, 'Starter')
  assert.deepEqual(basicModule.routes, ['/staff'])
  assert.deepEqual(basicModule.capabilities, ['staff.view', 'staff.manage'])
  assert.equal(fullModule.label, 'Staff Management')
  assert.equal(fullModule.requiredPlan, 'Standard')
  assert.ok(fullModule.routes.includes('/staff'))
  assert.ok(fullModule.capabilities.includes('staff.permissions'))
  assert.notEqual(basicModule.key, fullModule.key)
  assert.equal(
    basicModule.routes[0],
    fullModule.routes[0],
    'key-based catalogue resolution must preserve the intentional shared /staff route'
  )
  const starter = getCommercialOffer('lodge-camp', 'starter')
  const standard = getCommercialOffer('lodge-camp', 'standard')
  assert.ok(starter.includedFeatures.includes('staff_basic'))
  assert.ok(!starter.includedFeatures.includes('staff'))
  assert.ok(standard.includedFeatures.includes('staff_basic'))
  assert.ok(standard.includedFeatures.includes('staff'))
  const commercialOffers = [
    ...getCommercialOffers('lodge-camp'),
    ...getCommercialOffers('hotel'),
    ...getCommercialOffers('hospitality-pos')
  ]
  for (const offer of commercialOffers.filter(({ includedFeatures }) => includedFeatures.includes('staff'))) {
    assert.ok(
      offer.includedFeatures.includes('staff_basic'),
      `${offer.productId}/${offer.commercialPackageKey} must retain staff_basic with full staff`
    )
  }
  assert.match(nav, /feature: 'staff_basic'/)
  assert.match(nav, /feature: 'staff_basic'[\s\S]*moduleKey: 'staff_basic'/)
  assert.match(app, /UpgradeWall feature="staff_basic"/)
})

test('catalogue backfill explicitly grants accommodation account access and preserves full-Staff packages', () => {
  assert.match(catalogueBackfill, /included_features[\s\S]*\? 'staff'/)
  assert.match(catalogueBackfill, /product_id = 'lodge-camp'[\s\S]*commercial_package_key in \('starter', 'standard', 'pro'\)/)
  assert.match(catalogueBackfill, /product_id = 'hotel'[\s\S]*commercial_package_key = 'hotel_core'/)
  assert.match(catalogueBackfill, /Every package that already carries[\s\S]*Hospitality POS[\s\S]*staff_basic/)
  assert.match(catalogueBackfill, /commercial_package_entitlements/)
})

test('offline and fallback entitlement maps preserve both Starter boundaries', () => {
  for (const plan of ['Starter', 'Standard', 'Pro', 'Enterprise']) {
    const features = getPlanFeatureMap(plan)
    assert.equal(features.basic_reports, true)
    assert.equal(features.staff_basic, true)
  }
  assert.equal(getPlanFeatureMap('Starter', { expired: true }).basic_reports, false)
  assert.equal(getPlanFeatureMap('Starter', { expired: true }).staff_basic, false)
  assert.equal(getPlanFeatureMap('Starter', { trial: true }).basic_reports, true)
  assert.equal(getPlanFeatureMap('Starter', { trial: true }).staff_basic, true)
})

test('Starter role snapshots allow account management but not custom permission control', () => {
  const features = { staff_basic: true, staff: false }
  const admin = buildCapabilitySnapshot({ role: 'admin', features })
  const manager = buildCapabilitySnapshot({ role: 'manager', features })
  assert.equal(admin.capabilities['staff.view'], true)
  assert.equal(admin.capabilities['staff.manage'], true)
  assert.equal(admin.capabilities['staff.permissions'], false)
  assert.equal(manager.capabilities['staff.manage'], true)
  assert.equal(manager.capabilities['staff.permissions'], false)
})

test('Starter UI visibly limits users to fixed templates and account controls', () => {
  assert.match(staff, /starterAccessLite/)
  assert.match(staff, /Users & Access/)
  assert.match(staff, /Receptionist.*Operations|receptionist.*operations/s)
  assert.match(staff, /Starter uses fixed role templates/)
  assert.match(staff, /Suspend/)
  assert.match(staff, /Restore Active/)
  assert.match(staff, /sendInvite/)
  assert.match(staff, /resetPassword/)
  assert.match(staff, /!starterAccessLite && \(rolePreview/)
})

test('Starter users are guarded server-side with concurrency, scope, and retry-safe boundaries', () => {
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /v_existing_count >= 2/)
  assert.match(migration, /v_existing_count = 0 and v_role <> 'admin'/)
  assert.match(migration, /receptionist.*operations/s)
  assert.match(migration, /capability_overrides/)
  assert.match(migration, /pwa_enabled/)
  assert.match(migration, /allowed_outlet_ids/)
  assert.match(migration, /aaa_starter_users_access_lite_guard/)
  assert.match(migration, /commercial_package_prices/)
  assert.match(migration, /commercial_package_entitlements/)
  assert.match(authUsers, /assertStarterUsersAccessLite/)
  assert.match(authUsers, /await assertStarterUsersAccessLite\(\{ data, hasExistingUsers/)
  assert.match(authUsers, /data\?\._delete === true/)
  assert.match(authUsers, /data\?\._audit === true/)
  assert.match(authUsers, /!existingUser && !hasExistingUsers && requestedRole !== 'admin'/)
  assert.match(auth, /sendUserInviteOrReset[\s\S]*assertStarterUsersAccessLite/)
})

test('every authoritative Starter activation path converges on the guarded license table', () => {
  assert.match(activation, /activate_subscription_request[\s\S]*update public\.licenses set[\s\S]*subscription_plan = v_package\.internal_plan[\s\S]*is_active = true/)
  assert.match(admin, /from\('licenses'\)\.insert/)
  assert.match(admin, /update_subscription_contract/)
  assert.match(admin, /from\('licenses'\)\.update/)
  assert.match(migration, /before insert or update of lodge_id, product_id, subscription_plan, is_active on public\.licenses/)
  assert.match(migration, /aaa_starter_license_user_transition_guard/)
  assert.match(migration, /admin_governed_assign_commercial_subscription[\s\S]*sqlerrm like 'Cannot activate Starter:%'/)
  assert.match(migration, /admin_governed_activate_subscription_request[\s\S]*sqlerrm like 'Cannot activate Starter:%'/)
})

test('Starter transition guard rejects noncompliant downgrades without rewriting legacy rows', () => {
  assert.match(migration, /v_new_is_starter boolean := lower\(btrim\(coalesce\(new\.subscription_plan, ''\)\)\) in \('starter', 'basic'\)/)
  assert.match(migration, /new\.product_id[\s\S]*lodge-camp/)
  assert.match(migration, /if v_user_count = 0 then[\s\S]*return new/)
  assert.match(migration, /v_user_count > 2/)
  assert.match(migration, /v_admin_count <> 1 or v_active_admin_count <> 1/)
  assert.match(migration, /v_unsafe_role_count > 0/)
  assert.match(migration, /v_override_count > 0/)
  assert.match(migration, /v_pwa_count > 0/)
  assert.match(migration, /v_outlet_scope_count > 0/)
  assert.match(migration, /CREATE TRIGGER does not scan or rewrite historical rows/)
  assert.match(migration, /ordinary billing\/note updates do not fire this trigger/)
  assert.doesNotMatch(migration, /update public\.users\s+set/i)
  assert.doesNotMatch(migration, /delete from public\.users/i)
})
