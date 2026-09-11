// V03 behavioral regression: tenant identity is required, bound, or refused.
// Exercises the REAL validator, the REAL fetch-time binder, and the REAL
// offline legacy adapter (Electron stubbed, fs caches seeded per test).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isCommercialEntitlementContextValid,
  isCommercialFeatureIncluded
} from '../src/shared/commercialAccess.js'
import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptRpcSuccess
} from './helpers/domain-test-setup.mjs'

const entitlements = await importDomain('entitlements.js')
const { state, resetState } = await importState()

// Unique lodges per test: the module-level entitlement cache is keyed by
// lodge and shared across files in one gate process.
let lodgeSeq = 0
const uniqLodge = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(100000000000 + (lodgeSeq++)).slice(-12)}`
const LODGE_A = uniqLodge()
const LODGE_B = uniqLodge()
const future = () => new Date(Date.now() + 3600_000).toISOString()

function barEntitlement(extra = {}) {
  return {
    product_id: 'hospitality-pos',
    lodge_id: LODGE_A,
    status: 'licensed',
    subscription_state: 'active',
    expired: false,
    commercial_package_key: 'bar_pos',
    enterprise_addons: [],
    offline_valid_until: future(),
    commercial_overrides: { features: { restaurant_accounting: true } },
    ...extra
  }
}

function stubUserDataDir() {
  return path.join(os.tmpdir(), 'tsa-bonno-electron-stub')
}

function seedRegistry(profiles) {
  const dir = stubUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'profiles.json'),
    JSON.stringify({ active_lodge_id: profiles[0]?.lodge_id || null, profiles })
  )
}

function clearRegistry() {
  try { fs.unlinkSync(path.join(stubUserDataDir(), 'profiles.json')); } catch {}
}

function seedTrialCache(cacheDir, value) {
  fs.writeFileSync(path.join(cacheDir, 'trial_status.json'), JSON.stringify(value))
}

test('validator rejects missing and blank tenant identity when expected', () => {
  // Independent verification repro: no lodge_id + expected lodge was accepted.
  const legacy = barEntitlement()
  delete legacy.lodge_id
  assert.equal(isCommercialEntitlementContextValid(legacy, 'hospitality-pos', 'bar_pos', LODGE_A), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], legacy, LODGE_A), false)
  assert.equal(isCommercialEntitlementContextValid({ ...barEntitlement(), lodge_id: '   ' }, 'hospitality-pos', 'bar_pos', LODGE_A), false)
  // Matching identity still passes; wrong tenant still fails.
  assert.equal(isCommercialEntitlementContextValid(barEntitlement(), 'hospitality-pos', 'bar_pos', LODGE_A), true)
  assert.equal(isCommercialEntitlementContextValid(barEntitlement(), 'hospitality-pos', 'bar_pos', LODGE_B), false)
  assert.equal(isCommercialFeatureIncluded('hospitality-pos', 'bar_pos', 'restaurant_accounting', [], barEntitlement(), LODGE_A), true)
})

test('fetch binder stamps the requested lodge and refuses foreign answers', () => {
  const { coerceEntitlementResponseForTenant: coerce } = entitlements
  const bound = coerce({ status: 'trial', subscription_state: 'trial', plan: 'Trial' }, LODGE_A)
  assert.equal(bound.lodge_id, LODGE_A)
  const kept = coerce({ ...bound, lodge_id: LODGE_A }, LODGE_A)
  assert.equal(kept.lodge_id, LODGE_A)
  assert.equal(coerce({ status: 'licensed', lodge_id: LODGE_B }, LODGE_A), null)
  assert.equal(coerce(null, LODGE_A), null)
})

test('authoritative fetch binds lodge-less server answers to the requested tenant', async () => {
  const A = uniqLodge()
  const B = uniqLodge()
  resetState()
  state.isOnline = true
  state.lodgeId = A
  state.cacheDir = makeTempCacheDir('v03-auth')
  state.supabase = scriptRpcSuccess({
    get_lodge_entitlement: { status: 'licensed', subscription_state: 'active', plan: 'Pro', product_id: 'hospitality-pos', commercial_package_key: 'bar_pos' }
  })
  const result = await entitlements.getAuthoritativeTrialStatus(A)
  assert.equal(result.lodge_id, A)

  resetState()
  state.isOnline = true
  state.lodgeId = A
  state.cacheDir = makeTempCacheDir('v03-auth-foreign')
  state.supabase = scriptRpcSuccess({
    get_lodge_entitlement: { status: 'licensed', subscription_state: 'active', lodge_id: B }
  })
  await assert.rejects(entitlements.getAuthoritativeTrialStatus(A), /different tenant|invalid/i)
})

test('offline legacy snapshot binds on single-profile devices only', async () => {
  process.env.BOROKO_TEST_FORCE_OFFLINE = 'true'
  try {
    const A = uniqLodge()
    const B = uniqLodge()
    // Single profile + valid lease: bound, stamped, and written back.
    const cacheDir = makeTempCacheDir('v03-legacy-single')
    seedRegistry([{ lodge_id: A }])
    seedTrialCache(cacheDir, { status: 'trial', subscription_state: 'trial', plan: 'Trial', offline_valid_until: future() })
    resetState()
    state.isOnline = false
    state.lodgeId = A
    state.cacheDir = cacheDir
    const bound = await entitlements.getTrialStatus(A)
    assert.equal(bound.lodge_id, A)
    assert.equal(bound.status, 'trial')
    const written = JSON.parse(fs.readFileSync(path.join(cacheDir, 'trial_status.json'), 'utf8'))
    assert.equal(written.lodge_id, A)

    // Multi-profile device: the same snapshot must NOT be bound to a guess.
    const cacheDir2 = makeTempCacheDir('v03-legacy-multi')
    seedRegistry([{ lodge_id: A }, { lodge_id: B }])
    seedTrialCache(cacheDir2, { status: 'trial', subscription_state: 'trial', plan: 'Trial', offline_valid_until: future() })
    resetState()
    state.isOnline = false
    state.lodgeId = B
    state.cacheDir = cacheDir2
    const refused = await entitlements.getTrialStatus(B)
    assert.equal(refused.expired, true)
    assert.equal(refused.subscription_state, 'offline_lease_expired')
  } finally {
    delete process.env.BOROKO_TEST_FORCE_OFFLINE
    clearRegistry()
  }
})

test('offline stamped cache from another tenant is never reused', async () => {
  process.env.BOROKO_TEST_FORCE_OFFLINE = 'true'
  try {
    const A = uniqLodge()
    const B = uniqLodge()
    const cacheDir = makeTempCacheDir('v03-xtenant')
    seedRegistry([{ lodge_id: A }])
    seedTrialCache(cacheDir, { status: 'licensed', subscription_state: 'active', lodge_id: B, offline_valid_until: future() })
    resetState()
    state.isOnline = false
    state.lodgeId = A
    state.cacheDir = cacheDir
    const result = await entitlements.getTrialStatus(A)
    assert.notEqual(result.lodge_id, B)
    assert.equal(result.expired, true)
  } finally {
    delete process.env.BOROKO_TEST_FORCE_OFFLINE
    clearRegistry()
  }
})
