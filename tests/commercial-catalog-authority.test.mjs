import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMMERCIAL_PRODUCT_IDS,
  getCommercialAddonOffers,
  getCommercialOffers,
  getCommercialOffer,
  isCommercialSelectionEligible
} from '../src/shared/commercialEntitlements.js'
import { isCommercialFeatureIncluded } from '../src/shared/commercialAccess.js'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'
import { buildCommercialOfferSnapshot } from '../src/shared/commercialPackages.js'

const migration = readFileSync(resolve('supabase/migrations/20260712170000_commercial_catalog_quote_authority.sql'), 'utf8')
const entitlementBoundaryMigration = readFileSync(resolve('supabase/migrations/20260712174000_commercial_pos_entitlement_boundary.sql'), 'utf8')
const entitlementIdentityMigration = readFileSync(resolve('supabase/migrations/20260712175000_entitlement_rpc_commercial_identity.sql'), 'utf8')
const quoteFunction = readFileSync(resolve('marketing-site/netlify/functions/quote-download.js'), 'utf8')
const accessPanel = readFileSync(resolve('src/renderer/src/components/SubscriptionAccessPanel.jsx'), 'utf8')
const upgradePrompt = readFileSync(resolve('src/renderer/src/components/shared/UsageUpgradePrompt.jsx'), 'utf8')
const mainIndex = readFileSync(resolve('src/main/index.js'), 'utf8')

test('commercial catalog exposes the approved product offers', () => {
  assert.deepEqual(getCommercialOffers(COMMERCIAL_PRODUCT_IDS.LODGE_CAMP).map((offer) => offer.commercialPackageKey), ['starter', 'standard', 'pro'])
  assert.deepEqual(getCommercialOffers(COMMERCIAL_PRODUCT_IDS.LODGE_CAMP).map((offer) => offer.priceBwp), [8999, 12999, 18999])
  assert.equal(getCommercialOffer(COMMERCIAL_PRODUCT_IDS.HOTEL, 'hotel_core').displayName, 'Hotel Core')
  assert.equal(getCommercialOffer(COMMERCIAL_PRODUCT_IDS.HOTEL, 'hotel_core').priceBwp, 37998)
  assert.deepEqual(getCommercialOffers(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS).map((offer) => offer.commercialPackageKey), [
    'bar_pos', 'restaurant_service', 'restaurant_control', 'restaurant_growth'
  ])
  assert.deepEqual(getCommercialOffers(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS).map((offer) => offer.priceBwp), [4500, 8999, 12999, 18999])
})

test('Hotel and POS offers do not inherit Lodge usage limits', () => {
  for (const offer of [...getCommercialOffers(COMMERCIAL_PRODUCT_IDS.HOTEL), ...getCommercialOffers(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS)]) {
    assert.equal(offer.hasUsageLimits, false)
  }
})

test('POS package keys are unique and persist independently of the Pro compatibility plan', () => {
  const offers = getCommercialOffers(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS)
  assert.deepEqual(offers.map((offer) => offer.internalPlan), ['Pro', 'Pro', 'Pro', 'Pro'])
  assert.equal(new Set(offers.map((offer) => offer.commercialPackageKey)).size, 4)
  assert.deepEqual(offers.map((offer) => offer.displayName), [
    'Bar POS', 'Restaurant Service', 'Restaurant Control', 'Restaurant Growth'
  ])
  assert.ok(accessPanel.includes('value={requestedPackageKey}'))
  assert.ok(accessPanel.includes('commercial_package_key: selectedCommercialPackage.commercialPackageKey'))
  assert.ok(accessPanel.includes('key={plan.commercialPackageKey}'))
  assert.ok(!accessPanel.includes('value={plan.internalPlan}'))
})

test('POS package boundaries block higher workflows at runtime', () => {
  const productId = COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_service', 'tables'), true)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_service', 'stock_control'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_service', 'recipes'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_service', 'loyalty'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_control', 'stock_control'), true)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_control', 'recipes'), true)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_control', 'loyalty'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'restaurant_growth', 'loyalty'), true)
  assert.equal(isCommercialFeatureIncluded(productId, 'bar_pos', 'inventory'), true)
  assert.equal(isCommercialFeatureIncluded(productId, 'bar_pos', 'tables'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'bar_pos', 'recipes'), false)
  assert.equal(isCommercialFeatureIncluded(productId, 'bar_pos', 'kitchen_tickets'), false)

  const serviceAccess = buildCapabilitySnapshot({
    role: 'admin',
    productId,
    commercialPackageKey: 'restaurant_service',
    features: { pos: true, inventory: true, reports: true, staff: true }
  })
  const controlAccess = buildCapabilitySnapshot({
    role: 'admin',
    productId,
    commercialPackageKey: 'restaurant_control',
    features: { pos: true, inventory: true, reports: true, staff: true }
  })
  assert.equal(serviceAccess.capabilities['pos.view'], true)
  assert.equal(serviceAccess.capabilities['inventory.view'], false)
  assert.equal(controlAccess.capabilities['inventory.view'], true)
})

test('desktop main capability snapshot preserves add-ons and user overrides', () => {
  assert.match(mainIndex, /commercialAddonKeys:\s*entitlement\?\.enterprise_addons\s*\|\|\s*\[\]/)
  assert.match(mainIndex, /capabilityOverrides:\s*user\?\.capability_overrides\s*\|\|\s*\{\}/)
  assert.match(mainIndex, /isCommercialFeatureIncluded\(productId, commercialPackageKey, featureKey, commercialAddonKeys\)/)
})

test('POS operating profiles and invalid package/add-on combinations are enforced locally', () => {
  assert.equal(isCommercialSelectionEligible({ productId: 'hospitality-pos', commercialPackageKey: 'bar_pos', operatingProfile: 'bar_only' }), true)
  assert.equal(isCommercialSelectionEligible({ productId: 'hospitality-pos', commercialPackageKey: 'bar_pos', operatingProfile: 'restaurant_bar' }), false)
  assert.throws(() => buildCommercialOfferSnapshot({ productId: 'hospitality-pos', commercialPackageKey: 'bar_pos', operatingProfile: 'restaurant_bar' }), /not available/)
  assert.throws(() => buildCommercialOfferSnapshot({ productId: 'hotel', commercialPackageKey: 'hotel_core', addonKeys: ['channel_manager'], propertyType: 'hotel' }), /Invalid add-on/)
})

test('Hotel quote lines separate core, one-time add-on, and recurring add-on amounts', () => {
  const quote = buildCommercialOfferSnapshot({
    productId: 'hotel',
    commercialPackageKey: 'hotel_core',
    addonKeys: ['payment_gateway'],
    propertyType: 'hotel'
  })
  assert.equal(quote.lines[0].label, 'Hotel Core')
  assert.equal(quote.lines[0].amount_due_now, 37998)
  assert.equal(quote.lines[1].one_time_amount, 6000)
  assert.equal(quote.lines[1].recurring_amount, 9000)
  assert.equal(quote.totals.total_due_now, 43998)
  assert.equal(quote.totals.recurring_annual, 9000)
})

test('server migration owns totals, immutable snapshots, expiring tokens, and activation boundaries', () => {
  for (const required of [
    'commercial_catalog_versions',
    'commercial_package_prices',
    'commercial_addon_prices',
    'commercial_package_entitlements',
    'calculate_commercial_quote',
    'submit_public_commercial_quote_request',
    'submit_authenticated_commercial_quote_request',
    'get_public_quote_download',
    'canonical_pricing_snapshot',
    'quote_access_token_hash',
    'prevent_commercial_quote_snapshot_mutation',
    'admin_notifications',
    'Selected license does not belong to the selected company',
    'Product does not match the commercial quote'
  ]) {
    assert.ok(migration.includes(required), `${required} must be present in the authoritative migration`)
  }
  assert.ok(!migration.includes('p_pricing_snapshot') || migration.includes('calculate_commercial_quote'), 'browser pricing must not be the only quote authority')
})

test('server activation resets non-included POS features before granting the selected package', () => {
  for (const required of [
    'Commercial package boundary',
    'select distinct jsonb_array_elements_text(included_features)',
    "commercial_package_key in ('restaurant_control', 'restaurant_growth')"
  ]) {
    assert.ok(entitlementBoundaryMigration.includes(required), `${required} must be present in the POS entitlement boundary migration`)
  }
  assert.ok(accessPanel.includes('Commercial POS packages do not inherit Lodge &amp; Camp usage caps.'))
  assert.ok(upgradePrompt.includes('Feature bundle access with no Lodge & Camp capacity limits') || upgradePrompt.includes('feature-bundle based'))
  assert.ok(!upgradePrompt.includes('Next package limits:') || upgradePrompt.includes('IS_CAPACITYLESS_PRODUCT'))
  for (const required of ["'product_id', v_license.product_id", "'commercial_package_key', v_license.commercial_package_key"]) {
    assert.ok(entitlementIdentityMigration.includes(required), `${required} must be returned by the online entitlement RPC`)
  }
})

test('public quote PDF endpoint is token-scoped and does not use service credentials', () => {
  assert.ok(quoteFunction.includes('export default async'), 'Netlify function must use the modern default export')
  assert.ok(quoteFunction.includes("path: '/api/quote-download'"), 'quote endpoint must have a stable path')
  assert.ok(quoteFunction.includes('get_public_quote_download'), 'PDF endpoint must retrieve the canonical quote by token')
  assert.ok(quoteFunction.includes('application/pdf'), 'endpoint must return a PDF')
  assert.ok(quoteFunction.includes('private, no-store'), 'quote PDF must not be cached publicly')
  assert.ok(!quoteFunction.includes('SUPABASE_SERVICE_ROLE_KEY'), 'service-role credentials must not be used by the public endpoint')
})
