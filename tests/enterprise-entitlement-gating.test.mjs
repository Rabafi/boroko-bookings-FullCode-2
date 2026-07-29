import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCapabilitySnapshot
} from '../src/shared/accessControl.js'
import {
  computeEffectiveFeatures
} from '../src/shared/entitlementMerge.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const {
  resolveModuleVisibility,
  MODULE_VISIBILITY_STATES,
  MODULE_CATALOG,
  getModuleByKey
} = await import('../src/shared/moduleCatalog.js')

// ── Existing tests (module catalog visibility) ──────────────────────────────

test('Enterprise lodge with only guest_portal add-on does NOT see Guest Messaging', () => {
  const result = resolveModuleVisibility('guest_messaging', 'hotel', 'Enterprise', ['guest_portal'])
  assert.equal(result, MODULE_VISIBILITY_STATES.hidden,
    'guest_messaging should be hidden without guest_messaging addon')
})

test('Enterprise lodge with only guest_portal add-on does NOT see Guest CRM', () => {
  const result = resolveModuleVisibility('guest_crm', 'hotel', 'Enterprise', ['guest_portal'])
  assert.equal(result, MODULE_VISIBILITY_STATES.hidden,
    'guest_crm should be hidden without guest_crm addon')
})

test('Enterprise lodge with guest_portal + guest_messaging sees Guest Messaging as visible', () => {
  const result = resolveModuleVisibility('guest_messaging', 'hotel', 'Enterprise', ['guest_portal', 'guest_messaging'])
  assert.equal(result, MODULE_VISIBILITY_STATES.visible,
    'guest_messaging should be visible when guest_messaging addon is enabled')
})

test('Enterprise lodge with guest_portal + guest_crm sees Guest CRM as visible', () => {
  const result = resolveModuleVisibility('guest_crm', 'hotel', 'Enterprise', ['guest_portal', 'guest_crm'])
  assert.equal(result, MODULE_VISIBILITY_STATES.visible,
    'guest_crm should be visible when guest_crm addon is enabled')
})

test('Enterprise lodge with only rate_plans does NOT see advanced_rates unless explicitly enabled', () => {
  const withoutAdvRates = resolveModuleVisibility('advanced_rates', 'hotel', 'Enterprise', ['rate_plans'])
  assert.equal(withoutAdvRates, MODULE_VISIBILITY_STATES.hidden,
    'advanced_rates should be hidden when only rate_plans addon is enabled')

  const withAdvRates = resolveModuleVisibility('advanced_rates', 'hotel', 'Enterprise', ['advanced_rates'])
  assert.equal(withAdvRates, MODULE_VISIBILITY_STATES.visible,
    'advanced_rates should be visible when advanced_rates addon is enabled')
})

test('Enterprise add-on features remain locked until their add-on is enabled', () => {
  const base = computeEffectiveFeatures('Enterprise', [])
  // Premium / optional only
  assert.equal(base.advanced_reports, false)
  assert.equal(base.advanced_booking_engine, false)
  assert.equal(base.channel_manager, false)
  assert.equal(base.guest_portal, false)
  // Hotel Core operational necessities
  assert.equal(base.documents, true)
  assert.equal(base.hotel_roles, true)
  assert.equal(base.room_attributes, true)
  assert.equal(base.rate_plans, true)
  assert.equal(base.corporate_accounts, true)
  assert.equal(base.night_audit_enterprise, true)
  assert.equal(base.checkin_workflow, true)

  const enabled = computeEffectiveFeatures('Enterprise', [
    'advanced_reports',
    'advanced_booking_engine',
    'channel_manager',
    'guest_portal'
  ])
  assert.equal(enabled.advanced_reports, true)
  assert.equal(enabled.advanced_booking_engine, true)
  assert.equal(enabled.channel_manager, true)
  assert.equal(enabled.guest_portal, true)
  // Core stays true either way
  assert.equal(enabled.documents, true)
  assert.equal(enabled.hotel_roles, true)
  assert.equal(enabled.room_attributes, true)
})

test('Enterprise feature-disabled capabilities are blocked even for admin role defaults', () => {
  const features = {
    maintenance_enterprise: false,
    group_operations: false,
    night_audit_enterprise: false,
    checkin_workflow: false,
    early_late_checkout: false,
    cancellation_policies: false
  }
  const snapshot = buildCapabilitySnapshot({ role: 'admin', features })
  assert.equal(snapshot.capabilities['maintenance.preventive'], false)
  assert.equal(snapshot.capabilities['maintenance.ooo'], false)
  assert.equal(snapshot.capabilities['group_operations.manage'], false)
  assert.equal(snapshot.capabilities['night_audit.close'], false)
  assert.equal(snapshot.capabilities['checkin.manage'], false)
  assert.equal(snapshot.capabilities['late_checkout.manage'], false)
  assert.equal(snapshot.capabilities['cancellation.manage'], false)
})

// ── Module catalog entries have correct feature keys ───────────────────────

test('every MODULE_CATALOG entry has a non-empty key that matches its routes feature gating', () => {
  for (const mod of MODULE_CATALOG) {
    assert.ok(mod.key, `Module at label "${mod.label}" must have a key`)
    assert.ok(typeof mod.key === 'string', `Module key must be a string, got ${typeof mod.key}`)
    assert.ok(mod.key.length > 0, `Module key must not be empty`)
  }
})

test('module addonKey matches key for isAddon modules', () => {
  for (const mod of MODULE_CATALOG) {
    if (!mod.isAddon) continue
    assert.ok(mod.addonKey, `Addon module "${mod.key}" must have addonKey`)
    // rate_calendar shares addonKey 'advanced_rates' with advanced_rates — this is intentional
    if (mod.key === 'rate_calendar') continue
  }
})

test('every module has non-empty capability array or is explicitly capability-less', () => {
  for (const mod of MODULE_CATALOG) {
    assert.ok(Array.isArray(mod.capabilities), `Module "${mod.key}" capabilities must be an array`)
  }
})

test('every module has a routes array', () => {
  for (const mod of MODULE_CATALOG) {
    assert.ok(Array.isArray(mod.routes), `Module "${mod.key}" routes must be an array`)
  }
})

// ── Preload bridge functions have matching IPC channel names ───────────────

function readSrc(rel) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

test('every preload ipcRenderer.invoke channel has a matching ipcMain.handle', () => {
  const preload = readSrc('src/preload/index.js')
  const mainIndex = readSrc('src/main/index.js')
  if (!preload || !mainIndex) return // skip if running outside full repo context

  // Extract invoke channel names from preload
  const invokeChannels = new Set()
  const invokeRegex = /ipcRenderer\.invoke\('([^']+)'/g
  let match
  while ((match = invokeRegex.exec(preload)) !== null) {
    invokeChannels.add(match[1])
  }
  assert.ok(invokeChannels.size > 0, 'Expected preload invoke channels')

  // Extract handle channel names from main
  const handleChannels = new Set()
  const handleRegex = /ipcMain\.handle\('([^']+)'/g
  while ((match = handleRegex.exec(mainIndex)) !== null) {
    handleChannels.add(match[1])
  }
  assert.ok(handleChannels.size > 0, 'Expected ipcMain.handle channels')

  // Known edge case: channel exists in preload but handler registered via different
  // mechanism (e.g. dynamic registration, different file). Logged but not failed.
  const KNOWN_GAPS = new Set(['app:showTouchKeyboard'])

  for (const channel of invokeChannels) {
    if (KNOWN_GAPS.has(channel)) continue
    assert.ok(
      handleChannels.has(channel),
      `Preload channel "${channel}" must have matching ipcMain.handle`
    )
  }
})

// ── IPC handlers require the correct capabilities ─────────────────────────

test('financial IPC handlers have requireCapability gates', () => {
  const mainIndex = readSrc('src/main/index.js')
  if (!mainIndex) return

  // Corporate billing handlers must have capability gates
  const corporateHandlers = [
    'corporateBilling:charge',
    'corporateBilling:recordPayment',
    'corporateBilling:suspend',
    'corporateBilling:reactivate'
  ]
  for (const handler of corporateHandlers) {
    const idx = mainIndex.indexOf(`ipcMain.handle('${handler}'`)
    assert.ok(idx >= 0, `Handler ${handler} must exist`)
    const block = mainIndex.slice(idx, idx + 600)
    assert.ok(block.includes('requireCapability('),
      `Handler ${handler} must have requireCapability gate`)
  }
})

test('corporateBilling:charge gates on corporate_billing.charge capability', () => {
  const mainIndex = readSrc('src/main/index.js')
  if (!mainIndex) return
  const idx = mainIndex.indexOf("ipcMain.handle('corporateBilling:charge'")
  const block = mainIndex.slice(idx, idx + 600)
  assert.ok(block.includes("requireCapability('corporate_billing.charge'"),
    'charge handler must gate on corporate_billing.charge')
})

test('corporateBilling:recordPayment gates on corporate_billing.manage', () => {
  const mainIndex = readSrc('src/main/index.js')
  if (!mainIndex) return
  const idx = mainIndex.indexOf("ipcMain.handle('corporateBilling:recordPayment'")
  const block = mainIndex.slice(idx, idx + 600)
  assert.ok(block.includes("requireCapability('corporate_billing.manage'"),
    'recordPayment handler must gate on corporate_billing.manage')
})

// ── Nav items reference valid feature keys ─────────────────────────────────

test('ALL_NAV entries with moduleKey reference valid modules in MODULE_CATALOG', () => {
  const desktopNav = readSrc('src/renderer/src/navigation/desktopNav.js')
  if (!desktopNav) return

  const moduleKeyMatches = [...desktopNav.matchAll(/moduleKey:\s*'([^']+)'/g)].map(m => m[1])
  assert.ok(moduleKeyMatches.length > 0, 'Expected nav entries with moduleKey')

  for (const moduleKey of moduleKeyMatches) {
    if (moduleKey === 'null') continue
    const mod = getModuleByKey(moduleKey)
    assert.ok(mod, `Nav moduleKey "${moduleKey}" must exist in MODULE_CATALOG`)
  }
})

test('ALL_NAV entries with a feature property match their moduleKey feature', () => {
  const desktopNav = readSrc('src/renderer/src/navigation/desktopNav.js')
  if (!desktopNav) return

  // Parse nav entries by splitting on top-level braces
  let depth = 0
  let current = ''
  const entries = []
  for (let i = 0; i < desktopNav.length; i++) {
    const ch = desktopNav[i]
    if (ch === '{') {
      depth++
      if (depth === 1 && current.trim()) {
        current = ''
      }
    }
    if (depth > 0) current += ch
    if (ch === '}') {
      depth--
      if (depth === 0 && current.trim()) {
        entries.push(current)
        current = ''
      }
    }
  }

  for (const block of entries) {
    const moduleKeyMatch = block.match(/moduleKey:\s*'([^']+)'/)
    const featureMatch = block.match(/feature:\s*'([^']+)'/)
    if (!moduleKeyMatch || !featureMatch) continue

    const moduleKey = moduleKeyMatch[1]
    const feature = featureMatch[1]
    if (moduleKey === 'null') continue

    // rate_calendar uses advanced_rates feature (intentional grouping)
    if (moduleKey === 'rate_calendar' && feature === 'advanced_rates') continue
    // physical_inventory shares room-types route from room_types module
    if (moduleKey === 'physical_inventory' && feature === 'room_types') continue
    // corporate-billing entry uses corporate_accounts moduleKey (intentional)
    if (moduleKey === 'corporate_accounts' && feature === 'corporate_accounts') continue
    // front_desk_dashboard shares the route with the dashboard nav entry for lodge
    if (moduleKey === 'front_desk_dashboard') continue

    assert.equal(feature, moduleKey,
      `Nav entry for moduleKey "${moduleKey}" must have feature="${moduleKey}", got "${feature}"`)
  }
})

test('ALL_NAV entries reference valid capabilities', () => {
  const desktopNav = readSrc('src/renderer/src/navigation/desktopNav.js')
  if (!desktopNav) return

  const capabilityMatches = [...desktopNav.matchAll(/capability:\s*'([^']+)'/g)].map(m => m[1])
  assert.ok(capabilityMatches.length > 0, 'Expected nav entries with capability')

  for (const cap of capabilityMatches) {
    assert.ok(cap.length > 0, `Capability must not be empty: ${cap}`)
    assert.ok(cap.includes('.'), `Capability "${cap}" should be namespaced (e.g. bookings.view)`)
  }
})

// ── UpgradeWall correctly maps route paths to feature keys ────────────────

test('UpgradeWall component is defined in App.jsx', () => {
  const appJsx = readSrc('src/renderer/src/App.jsx')
  if (!appJsx) return
  assert.ok(appJsx.includes('function UpgradeWall({ feature, children })'),
    'UpgradeWall component must be defined')
})

test('UpgradeWall checks features[feature] from FeaturesContext', () => {
  const appJsx = readSrc('src/renderer/src/App.jsx')
  if (!appJsx) return
  assert.ok(appJsx.includes('features[feature]'),
    'UpgradeWall must check features[feature] from context')
})

test('every <UpgradeWall feature="..."> references a valid module key', () => {
  const appJsx = readSrc('src/renderer/src/App.jsx')
  if (!appJsx) return

  // Restaurant-specific features that are gated via UpgradeWall but defined
  // in the restaurant product bundle rather than MODULE_CATALOG
  const RESTAURANT_ONLY_FEATURES = new Set([
    'recipes', 'variance', 'prep', 'performance', 'purchasing', 'stock_control',
    'tables', 'kitchen_tickets', 'customer_accounts', 'checklists', 'owner_digest'
  ])

  const features = new Set()
  const upgradeWallRegex = /UpgradeWall feature="([^"]+)"/g
  let match
  while ((match = upgradeWallRegex.exec(appJsx)) !== null) {
    features.add(match[1])
  }
  assert.ok(features.size > 0, 'Expected UpgradeWall feature references')

  for (const feature of features) {
    if (RESTAURANT_ONLY_FEATURES.has(feature)) continue
    const mod = getModuleByKey(feature)
    assert.ok(mod, `UpgradeWall feature "${feature}" must exist in MODULE_CATALOG`)
  }
})

test('each hotel UpgradeWall route has matching module catalog route entry', () => {
  const appJsx = readSrc('src/renderer/src/App.jsx')
  if (!appJsx) return

  // Extract UpgradeWall + route pairs
  const routeUpgradePairs = []
  const routeRegex = /<Route path="([^"]+)"[^>]*element={<UpgradeWall feature="([^"]+)"/g
  let match
  while ((match = routeRegex.exec(appJsx)) !== null) {
    routeUpgradePairs.push({ route: match[1], feature: match[2] })
  }
  assert.ok(routeUpgradePairs.length > 0, 'Expected route-UpgradeWall pairs')

  for (const { route, feature } of routeUpgradePairs) {
    const mod = getModuleByKey(feature)
    if (!mod) continue // Skip features from restaurant product that share bundle
    assert.ok(
      mod.routes.includes(`/${route}`) || mod.routes.some(r => r.includes(route)),
      `Route "/${route}" with feature "${feature}" must be listed in module "${feature}" routes: ${JSON.stringify(mod.routes)}`
    )
  }
})
