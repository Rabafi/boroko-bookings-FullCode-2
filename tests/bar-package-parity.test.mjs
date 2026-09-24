import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BAR_POS_ADDON_CATALOG,
  COMMERCIAL_PRODUCT_IDS,
  getCommercialOffer,
} from '../src/shared/commercialEntitlements.js'
import {
  isRestaurantOnly,
  normalizePropertyType,
  propertyTypeToBusinessType,
  getHiddenModules,
} from '../src/shared/propertyTypes.js'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const PARITY_MIGRATION = 'supabase/migrations/20260921000000_bar_entitlement_parity.sql'
const BASE_MIGRATION = 'supabase/migrations/20260723010000_bar_product_bundles.sql'

function extractJsonArray(sql, marker) {
  // The parity migration sets included_features before its WHERE marker, so
  // scan all JSON array literals and return the Bar base set (the one that
  // contains incident_log). Fails loudly if the canonical list is absent.
  assert.ok(sql.includes(marker), `marker not found: ${marker}`)
  const matches = [...sql.matchAll(/'(\[.*?\])'::jsonb/gs)].map((m) => m[1])
  assert.ok(matches.length > 0, 'no JSON arrays found in migration')
  for (const literal of matches) {
    try {
      const parsed = JSON.parse(literal)
      if (Array.isArray(parsed) && parsed.includes('incident_log') && parsed.includes('pos')) return parsed
    } catch { /* try next */ }
  }
  assert.fail('Bar base included_features JSON array not found in migration')
}

test('Bar POS base features: JS catalogue matches the DB parity migration (fails on drift)', () => {
  const offer = getCommercialOffer(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos')
  assert.ok(offer, 'bar_pos offer must exist')
  const jsFeatures = [...offer.includedFeatures].sort()

  // Canonical 25-feature Bar base set (counter, stock, cash, staff, reports,
  // PWA, display, board, controls, incidents).
  const expected = [
    'pos', 'bar_counter_sales', 'bar_product_list', 'modifiers', 'tabs', 'receipts',
    'bar_pack_stock', 'inventory', 'bar_stock_basic', 'low_stock_alerts',
    'cash_drawer', 'cash_up', 'staff', 'staff_basic', 'bar_staff_basic', 'staff_shifts',
    'reports', 'bar_reports_basic', 'audit', 'pwa', 'customer_display', 'bar_board',
    'checklists', 'alerts', 'incident_log',
  ].sort()
  assert.deepEqual(jsFeatures, expected, 'JS BAR_POS_FEATURES must be the canonical 25')

  const paritySql = read(PARITY_MIGRATION)
  const sqlFeatures = extractJsonArray(paritySql, 'commercial_package_key = \'bar_pos\'').sort()
  assert.deepEqual(sqlFeatures, expected, 'parity migration must carry the full 25-feature set')
  assert.deepEqual(jsFeatures, sqlFeatures, 'JS vs SQL Bar base features must not drift')

  // The historic base bundle alone is NOT the authority (it lacked staff_basic
  // at inception); the parity migration is the correction. Document the drift
  // so a future edit to either source without the other fails loudly above.
  const baseSql = read(BASE_MIGRATION)
  assert.ok(!baseSql.includes('"staff_basic"'), 'historic base migration predates staff_basic (parity migration corrects it)')
  assert.ok(paritySql.includes('"staff_basic"'), 'parity migration must include staff_basic')
  for (const key of ['"modifiers"', '"tabs"', '"receipts"', '"pwa"', '"incident_log"']) {
    assert.ok(paritySql.includes(key), `parity migration must include ${key}`)
  }
})

test('Bar add-ons: JS eligibility (restaurant+bar) matches DB parity migration', () => {
  assert.equal(BAR_POS_ADDON_CATALOG.length, 3)
  for (const addon of BAR_POS_ADDON_CATALOG) {
    assert.deepEqual([...addon.eligiblePropertyTypes].sort(), ['bar', 'restaurant'], `${addon.addonKey} must allow bar+restaurant`)
    assert.deepEqual([...addon.eligibleOperatingProfiles], ['bar_only'])
    assert.deepEqual([...addon.eligiblePackageKeys], ['bar_pos'])
  }
  const paritySql = read(PARITY_MIGRATION)
  assert.match(paritySql, /array\['restaurant','bar'\]/, 'parity migration must grant bar eligibility')
  for (const key of ['bar_stock_purchasing_pro', 'bar_accounting_workforce', 'bar_growth_multi_outlet']) {
    assert.ok(paritySql.includes(key), `parity migration must cover ${key}`)
  }
  // Guardrail list in the migration must name all three add-ons.
  assert.match(paritySql, /bar_stock_purchasing_pro.*bar_accounting_workforce.*bar_growth_multi_outlet/s)
})

test('Business type bar is first-class (never normalizes to lodge)', () => {
  assert.equal(normalizePropertyType('bar'), 'bar')
  assert.equal(normalizePropertyType('BAR'), 'bar')
  assert.equal(normalizePropertyType('restaurant'), 'restaurant')
  assert.equal(normalizePropertyType('pos_only'), 'restaurant')
  assert.equal(normalizePropertyType(''), 'lodge')
  assert.equal(isRestaurantOnly('bar'), true)
  assert.equal(isRestaurantOnly('restaurant'), true)
  assert.equal(isRestaurantOnly('lodge'), false)
  assert.equal(propertyTypeToBusinessType('bar'), 'bar')
  assert.equal(propertyTypeToBusinessType('restaurant'), 'restaurant')
  assert.equal(propertyTypeToBusinessType('lodge'), 'lodge')
  // Bar hides accommodation modules like restaurant (never shows lodge rooms).
  const hidden = getHiddenModules('bar', 'Pro')
  for (const mod of ['bookings', 'rooms', 'guests', 'housekeeping', 'maintenance']) {
    assert.ok(hidden.includes(mod), `bar must hide ${mod}`)
  }
  // Desktop shells reuse the restaurant rail for bar (lodge nav untouched).
  const layout = read('src/renderer/src/components/Layout.jsx')
  assert.match(layout, /isRestaurantOnly\(propertyType\)/)
  const desktopNav = read('src/renderer/src/navigation/desktopNav.js')
  assert.match(desktopNav, /normalizedPropertyType === 'restaurant' \|\| normalizedPropertyType === 'bar'/)
  assert.match(desktopNav, /bizType === 'bar' \? 'restaurant'/)
  // Subscription panel never falls back to lodge wording for a bar.
  const panel = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')
  assert.match(panel, /getHospitalityMode\(settings\) === 'bar_only' \? 'bar' : 'lodge'/)
  assert.ok(!panel.includes("settings?.property_type || settings?.business_type || 'lodge'"), 'bare lodge fallback must be gone')
})

test('Entitlement feature maps fail closed (unknown defaults to false)', () => {
  const source = read('src/main/domains/subscriptionState.js')
  assert.match(source, /map\[feature\] === true/, 'cloneFeatureMap must default missing to false')
  assert.doesNotMatch(source, /map\[feature\] !== false/, 'fail-open default must be gone')
  // Explicit boundaries still hold.
  assert.equal(getPlanFeatureMap('Starter').reports, false)
  assert.equal(getPlanFeatureMap('Starter').basic_reports, true)
  assert.equal(getPlanFeatureMap('Pro').pos, true)
  assert.equal(getPlanFeatureMap('Enterprise').hotel_mode, true)
  assert.equal(getPlanFeatureMap('Enterprise').channel_manager, false)
})

test('Bar upgrade nudge points to real Bar add-ons (never a hidden restaurant package)', () => {
  const offer = getCommercialOffer(COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS, 'bar_pos')
  assert.equal(offer.upgradeTarget, null, 'bar_pos has no higher Bar package; growth is via add-ons')
  const packages = read('src/shared/commercialPackages.js')
  assert.match(packages, /Bar POS is the Bar package\. Extend it with Stock & Purchasing Pro/)
  assert.match(packages, /commercialPackageKey === 'bar_pos'/)
  // The panel filters to the current operating profile so a bar never sees
  // restaurant packages (the quote RPC would refuse them).
  const panel = read('src/renderer/src/components/SubscriptionAccessPanel.jsx')
  assert.match(panel, /visibleCommercialPackages/)
  assert.match(panel, /eligibleOperatingProfiles/)
  assert.match(panel, /Showing.*packages for this/)
  // Lodge wording is gone from Bar surfaces.
  const hub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')
  assert.doesNotMatch(hub, /lodge-scoped/)
  assert.match(hub, /business-scoped accounts/)
})

test('Incident log stays reachable in bar mode without breaking lodge nav', () => {
  // Base-visible board now carries an Incidents tab gated only on
  // incident_log.view (Growth BusinessControl stays Growth-gated).
  const control = read('src/renderer/src/components/hospitality-pos/HposControl.jsx')
  assert.match(control, /Incidents <span>\{incidents\.length\}<\/span>/)
  assert.match(control, /incident_log\.view/)
  assert.match(control, /IncidentLogModal/)
  assert.match(control, /Base Bar POS includes the incident log/)
  // Hub copy and search both surface the base board.
  const hub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')
  assert.match(hub, /base incident log/)
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  assert.match(layout, /Incident log/)
  assert.match(layout, /incident_log\.view/)
  // BusinessControl keeps its Control & safety tab (Growth analytics home).
  const businessControl = read('src/renderer/src/components/hospitality-pos/HposBusinessControl.jsx')
  assert.match(businessControl, /Control & safety/)
  assert.match(businessControl, /incident_log\.view/)
  // Lodge nav: bar reuses the restaurant rail; lodge entries unchanged.
  const desktopNav = read('src/renderer/src/navigation/desktopNav.js')
  assert.match(desktopNav, /types: \['lodge', 'restaurant'\]/)
})

test('Recipes copy says Included with Stock add-on (no base/add-on double-list)', () => {
  const menu = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.match(menu, /Included with Stock add-on/)
  assert.match(menu, /Stock & Purchasing Pro.*required/)
  assert.doesNotMatch(menu, /Recipe method — Stock & Purchasing Pro required[^)]*$/, 'bare double-list copy must be gone')
  const wizard = read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
  assert.match(wizard, /Included with Stock add-on/)
})
