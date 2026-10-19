// Agent C: configured-service/menu alignment contract.
//
// Pins that valid configured+entitled conference (Events & Venues), pool
// (Day Use), pos and inventory services REMAIN accessible for guest_house/bnb
// across same-product type changes: catalog defaults must not remove them.
// Plan/role/capability locks still apply — visibility never grants access.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODULE_VISIBILITY_STATES,
  canAccessModule,
  getModuleByKey,
  resolveModuleVisibility
} from '../src/shared/moduleCatalog.js'

const GUEST_TYPES = ['guest_house', 'bnb']

for (const propertyType of GUEST_TYPES) {
  test(`entitled conference stays visible for ${propertyType} on Standard`, () => {
    assert.equal(resolveModuleVisibility('conference', propertyType, 'Standard'), MODULE_VISIBILITY_STATES.visible)
  })

  test(`entitled day-use (pool) stays visible for ${propertyType} on Standard`, () => {
    assert.equal(resolveModuleVisibility('pool', propertyType, 'Standard'), MODULE_VISIBILITY_STATES.visible)
  })

  test(`entitled POS stays visible for ${propertyType} on Pro`, () => {
    assert.equal(resolveModuleVisibility('pos', propertyType, 'Pro'), MODULE_VISIBILITY_STATES.visible)
  })

  test(`entitled inventory stays visible for ${propertyType} on Pro`, () => {
    assert.equal(resolveModuleVisibility('inventory', propertyType, 'Pro'), MODULE_VISIBILITY_STATES.visible)
  })

  test(`unentitled ${propertyType} stays locked (never visible) on Starter`, () => {
    // property_type_relevant modules below plan resolve to locked (upsell),
    // never to visible. Locked is not access: canAccessModule still denies.
    for (const moduleKey of ['conference', 'pool', 'pos', 'inventory']) {
      const visibility = resolveModuleVisibility(moduleKey, propertyType, 'Starter')
      assert.equal(visibility, MODULE_VISIBILITY_STATES.locked, `${moduleKey} should be locked, got ${visibility}`)
      assert.equal(canAccessModule(moduleKey, propertyType, 'Starter', [], ['*']), false)
    }
  })

  test(`Pro-gated modules stay locked (not visible) for ${propertyType} on Standard`, () => {
    for (const moduleKey of ['pos', 'inventory']) {
      assert.equal(resolveModuleVisibility(moduleKey, propertyType, 'Standard'), MODULE_VISIBILITY_STATES.locked)
    }
  })

  test(`capability gate still enforced for ${propertyType} conference (visible != authorized)`, () => {
    assert.equal(
      resolveModuleVisibility('conference', propertyType, 'Standard'),
      MODULE_VISIBILITY_STATES.visible
    )
    assert.equal(canAccessModule('conference', propertyType, 'Standard', [], []), false)
    assert.equal(
      canAccessModule('conference', propertyType, 'Standard', [], ['conference.view']),
      true
    )
  })

  test(`capability gate still enforced for ${propertyType} POS (visible != authorized)`, () => {
    assert.equal(resolveModuleVisibility('pos', propertyType, 'Pro'), MODULE_VISIBILITY_STATES.visible)
    assert.equal(canAccessModule('pos', propertyType, 'Pro', [], []), false)
    assert.equal(canAccessModule('pos', propertyType, 'Pro', [], ['pos.view']), true)
  })
}

test('lodge/camp keep existing conference/pool/pos/inventory eligibility (no regression)', () => {
  for (const propertyType of ['lodge', 'camp']) {
    assert.equal(resolveModuleVisibility('conference', propertyType, 'Standard'), MODULE_VISIBILITY_STATES.visible)
    assert.equal(resolveModuleVisibility('pool', propertyType, 'Standard'), MODULE_VISIBILITY_STATES.visible)
    assert.equal(resolveModuleVisibility('pos', propertyType, 'Pro'), MODULE_VISIBILITY_STATES.visible)
    assert.equal(resolveModuleVisibility('inventory', propertyType, 'Pro'), MODULE_VISIBILITY_STATES.visible)
  }
})

test('motel keeps POS/inventory eligibility; conference/pool scope unchanged', () => {
  // Agent C scope is guest_house/bnb only: motel conference/pool exclusion is
  // preserved as-is and pinned here so a future change is deliberate.
  assert.equal(resolveModuleVisibility('pos', 'motel', 'Pro'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility('inventory', 'motel', 'Pro'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility('conference', 'motel', 'Standard'), MODULE_VISIBILITY_STATES.hidden)
  assert.equal(resolveModuleVisibility('pool', 'motel', 'Standard'), MODULE_VISIBILITY_STATES.hidden)
})

test('catalog entries still require their plan and expose capability lists', () => {
  const expectations = {
    conference: { requiredPlan: 'Standard', capabilities: ['conference.view'] },
    pool: { requiredPlan: 'Standard', capabilities: ['pool.view'] },
    pos: { requiredPlan: 'Pro', capabilities: ['pos.view'] },
    inventory: { requiredPlan: 'Pro', capabilities: ['inventory.view'] }
  }
  for (const [key, expected] of Object.entries(expectations)) {
    const module = getModuleByKey(key)
    assert.ok(module, `${key} must exist in the catalog`)
    assert.equal(module.requiredPlan, expected.requiredPlan)
    assert.deepEqual([...module.capabilities], expected.capabilities)
    assert.ok(module.allowedPropertyTypes.includes('guest_house'), `${key} must allow guest_house`)
    assert.ok(module.allowedPropertyTypes.includes('bnb'), `${key} must allow bnb`)
  }
})
