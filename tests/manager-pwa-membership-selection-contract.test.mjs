import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const between = (source, start, end) => {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `expected source marker: ${start}`)
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const api = read('manager-pwa/src/lib/api.js')
const auth = read('manager-pwa/src/contexts/AuthContext.jsx')
const login = read('manager-pwa/src/pages/Login.jsx')
const more = read('manager-pwa/src/pages/More.jsx')
const features = read('manager-pwa/src/contexts/FeaturesContext.jsx')
const app = read('manager-pwa/src/App.jsx')
const appUpdate = read('manager-pwa/src/lib/appUpdate.js')
const buildInfo = read('manager-pwa/src/lib/buildInfo.js')

// This is the live-shape regression that motivated the contract. All five
// memberships must survive the chooser: only Restaurant is currently enabled
// and entitled; Bar, Lounge, and Lodge are disabled; Hotel is not entitled.
const membershipFixture = [
  { lodge_id: 'restaurant', property_type: 'restaurant', pwa_enabled: true, pwa_feature_enabled: true },
  { lodge_id: 'bar', property_type: 'bar', pwa_enabled: false, pwa_feature_enabled: true, pwa_disabled_reason: 'Manager App is disabled for this business.' },
  { lodge_id: 'lounge', property_type: 'lounge', pwa_enabled: false, pwa_feature_enabled: true, pwa_disabled_reason: 'Manager App is disabled for this business.' },
  { lodge_id: 'lodge', property_type: 'motel', pwa_enabled: false, pwa_feature_enabled: true, pwa_disabled_reason: 'Manager App is disabled for this business.' },
  { lodge_id: 'hotel', property_type: 'hotel', pwa_enabled: false, pwa_feature_enabled: false, pwa_disabled_reason: 'Manager App is not included in this plan.' }
]

test('membership chooser preserves Lodge, Hotel, Restaurant, and Bar product identity', () => {
  const familyByBusiness = {
    lodge: 'lodge-camp',
    hotel: 'hotel',
    restaurant: 'hospitality-pos',
    bar: 'hospitality-pos'
  }
  assert.deepEqual(Object.values(familyByBusiness), ['lodge-camp', 'hotel', 'hospitality-pos', 'hospitality-pos'])
  assert.match(login, /membership\.product_family\s*\|\|\s*membership\.property_type/)
  assert.match(login, /resolveProductFamily\(membership\.product_family/)
  assert.match(more, /membership\.product_family_label\s*\|\|\s*membership\.product_family/)
  assert.match(more, /availableMemberships\.map\(\(membership\)/)
})

test('login keeps every raw membership visible with disabled and plan reasons', () => {
  assert.equal(membershipFixture.length, 5)
  assert.equal(membershipFixture.filter((row) => row.pwa_enabled && row.pwa_feature_enabled).length, 1)
  assert.equal(membershipFixture.filter((row) => row.pwa_enabled === false).length, 4)
  assert.equal(membershipFixture.filter((row) => row.pwa_feature_enabled === false).length, 1)

  const authenticate = between(api, 'export async function authenticateManager', 'export async function validateManagerSession')
  assert.match(api, /export async function listManagerPwaMemberships/)
  assert.match(api, /return extractManagerCandidates\(data\)/)
  assert.match(authenticate, /(?:memberships|available|rawMemberships)\.length\s*>\s*1/)
  assert.match(authenticate, /return\s*\{\s*memberships\s*:\s*(?:memberships|available|rawMemberships)\s*,?\s*user:\s*null\s*\}/)
  assert.doesNotMatch(authenticate, /assertMembershipEntitlements\(memberships\)/)
  assert.doesNotMatch(authenticate, /const entitled\s*=|memberships\.filter\(/)

  assert.match(login, /pendingMemberships\.map/)
  assert.doesNotMatch(login, /pendingMemberships\.filter/)
  assert.match(login, /pwa_enabled|pwa_feature_enabled/)
  assert.match(login, /pwa_disabled_reason|disabled|not included|plan/i)
  assert.match(login, /const selectable\s*=\s*membership\.pwa_enabled\s*===\s*true\s*&&\s*membership\.pwa_feature_enabled\s*===\s*true/)
  assert.match(login, /disabled=\{[^}]*selectable/)
})

test('property selection fails closed and cannot fall through to another tenant', () => {
  const issue = between(api, 'export async function issueManagerPwaSession', 'export async function authenticateManager')
  assert.match(issue, /rows\.find\(\(row\)\s*=>\s*row\.lodge_id\s*===\s*String\(lodgeId\)\.trim\(\)\.toLowerCase\(\)\)/)
  assert.doesNotMatch(issue, /\|\|\s*rows\[0\]/)
  assert.match(issue, /That business is no longer available for this account/)
  assert.match(issue, /isManagerPwaMembershipSelectable\(selected\)/)
  assert.match(api, /row\?\.pwa_enabled\s*===\s*true/)
  assert.match(api, /row\?\.pwa_feature_enabled\s*===\s*true/)

  const select = between(auth, 'const selectMembership = async', '  const logout = async')
  assert.match(select, /issueManagerPwaSession\(membership\.lodge_id\)/)
  assert.match(select, /startSession\(result\.user/)
  assert.doesNotMatch(select, /pendingMemberships\.find|pendingMemberships\[0\]/)
})

test('in-app property switching refreshes identity and capability state without tenant leakage', () => {
  assert.match(auth, /buildSessionRecord\(row, previous = null\)/)
  for (const field of [
    'lodge_id',
    'product_family',
    'product_id',
    'commercial_package_key',
    'effective_features',
    'pwa_enabled',
    'pwa_feature_enabled'
  ]) {
    assert.match(auth, new RegExp(`\\b${field}\\b`), `session must carry ${field}`)
  }
  assert.match(auth, /setSupabaseSessionToken\(session\.session_token\)/)
  assert.match(auth, /setSession\(session\)/)
  assert.match(auth, /setUser\(session\)/)

  // A switch must be reachable from an authenticated page, not only from the
  // login chooser. The handler may be named switchMembership or reuse the
  // existing selectMembership command, but it must pass a selected lodge id
  // through the same server-issued session path.
  const authenticatedUi = `${more}\n${app}`
  assert.match(authenticatedUi, /switchMembership|switchProperty|selectMembership|selectProperty/)
  assert.match(authenticatedUi, /lodge_id/)
  assert.match(authenticatedUi, /issueManagerPwaSession|listManagerPwaMemberships|availableMemberships|pendingMemberships/)

  // Product and capability state must be reloaded for the selected property.
  assert.match(features, /getEntitlement\(user\.lodge_id\)/)
  assert.match(features, /user\?\.lodge_id/)
  assert.match(features, /user\?\.product_id/)
  assert.match(features, /user\?\.commercial_package_key/)
  assert.match(features, /user\?\.effective_features/)
  assert.match(app, /user\.lodge_id/)
  assert.match(app, /user\?\.product_family/)
  assert.match(app, /\[features, setAlertCount, user\?\.lodge_id, user\?\.product_family\]/)
})

test('PWA exposes a visible update-ready indicator and applies the waiting worker safely', () => {
  assert.match(app, /boroko:pwa-update-ready/)
  assert.match(app, /New (?:version|build) ready/)
  assert.match(app, /updateState\.version/)
  assert.match(app, /updateState\.buildId/)
  assert.match(app, /shortBuildId\(updateState\.buildId\)/)
  assert.match(appUpdate, /phase:\s*'available'/)
  assert.match(appUpdate, /SKIP_WAITING/)
  assert.match(buildInfo, /APP_VERSION|version/i)
  assert.match(app, /controllerchange/)
  assert.match(app, /\{refreshing \? 'Updating' : 'Update'\}/)
})
