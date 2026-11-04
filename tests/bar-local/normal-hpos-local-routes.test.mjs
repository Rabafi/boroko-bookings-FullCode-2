import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const shell = read('src/renderer/src/components/hospitality-pos/LocalBarHposShell.jsx')
const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
const nav = read('src/renderer/src/components/hospitality-pos/HposNav.jsx')
const app = read('src/renderer/src/App.jsx')
const nativeMenu = read('src/renderer/src/components/hospitality-pos/BarLocalNativeMenu.jsx')

const routePanels = [
  ['hpos/pos', 'counter'], ['hpos/menu', 'menu'], ['hpos/stock', 'stock'],
  ['hpos/checks', 'tabs'], ['hpos/cash', 'drawer'], ['hpos/my-cashup', 'cashup'],
  ['hpos/shared-cashup', 'cashup'], ['hpos/shift-close', 'cashup'],
  ['hpos/my-shift', 'operations'], ['hpos/attendance', 'operations'], ['hpos/team', 'operations'],
  ['hpos/my-sales', 'reports'], ['hpos/sale-correction', 'returns'],
  ['hpos/reports', 'reports'], ['hpos/expenses', 'operations'], ['hpos/customers', 'operations'],
  ['hpos/growth-tools', 'operations'], ['hpos/control', 'operations'],
  ['hpos/business-control', 'reports'], ['hpos/manage', 'operations'],
  ['hpos/system-health', 'admin'], ['hpos/setup-readiness', 'admin'], ['settings', 'settings'],
]

test('configured local Bar uses the shared login and binds its profile/providers to authenticated local bootstrap data', () => {
  assert.match(app, /<LocalBarHposShell status=\{currentAuthority\}/)
  assert.match(shell, /<Login \/>/)
  assert.match(read('src/renderer/src/components/Login.jsx'), /if \(localBarAuthority\)[\s\S]*?window\.api\.barLocal\.login\(\{ email: email\.trim\(\)\.toLowerCase\(\), password \}\)/)
  assert.match(read('src/renderer/src/components/Login.jsx'), /window\.api\.barLocal\.login\(\{ staff_id: staffId\.trim\(\), pin: staffPin \}\)/)
  assert.match(read('src/renderer/src/components/Login.jsx'), /Staff PIN/)
  assert.match(shell, /window\.api\.barLocal\.query\('bootstrap', \{\}\)/)
  assert.match(shell, /authority_mode: 'bar_local'/)
  assert.match(shell, /activeProfile: localProfile/)
  assert.match(shell, /bootstrap\?\.authority\?\.entitlement_features/)
  for (const [route, panel] of routePanels.filter(([route]) => route !== 'hpos/menu')) {
    assert.match(shell, new RegExp(`<Route path="${route}" element=\\{<BarLocalWorkspace[^\\n]*embeddedPanel="${panel}"`), `${route} must use its local workflow panel`)
  }
  assert.match(shell, /<Route path="hpos\/menu" element=\{<BarLocalNativeMenu \/>\}/)
  assert.match(shell, /<Route path="\*" element=\{<LocalBarRouteUnavailable \/>\}/)
  assert.match(shell, /localAuthority: true/)
})

test('regular Bar menu adapter reads and mutates through the local authority only', () => {
  assert.match(nativeMenu, /loadCompleteBarList\(verifiedQuery, 'menu\.list', \{ include_inactive: true \}\)/)
  assert.match(nativeMenu, /loadCompleteBarList\(verifiedQuery, 'menu\.availability', \{ include_inactive: true \}\)/)
  assert.match(nativeMenu, /window\.api\.barLocal\.command\(\{ command, payload, operation_id: operationId \}\)/)
  assert.match(nativeMenu, /window\.api\.barLocal\.retryOperation\(operationId\)/)
  assert.match(nativeMenu, /catalogue\.availability\.set/)
  assert.match(nativeMenu, /catalogue\.upsert/)
  assert.doesNotMatch(nativeMenu, /window\.api\.(?:pos|inventory)\./)
})

test('authority chooser hides cached cloud identity without deleting Restaurant offline-session state', () => {
  const marker = "if (!authority || authority.authority_mode === 'bar_local' || authority.workspace_choice_required === true)"
  const start = app.indexOf(marker)
  const chooserStartup = app.slice(start, app.indexOf('setLocalAuthorityState(authority)', start))
  assert.match(chooserStartup, /setUser\(null\)/)
  assert.doesNotMatch(chooserStartup, /localStorage\.removeItem\(['"]bb_user|localStorage\.removeItem\(USER_SCOPE_KEY/)
})

test('local Hpos layout never polls cloud POS or sync and bypasses cloud PIN/support gating', () => {
  assert.match(layout, /if \(isLocalBarAuthority\) return;/)
  assert.match(layout, /if \(isLocalBarAuthority\) \{\s*navigate\(route\);\s*return;/)
  assert.match(layout, /if \(isLocalBarAuthority\) return;\s*if \(isGatedManageRoute/)
  assert.match(layout, /isGatedManageRoute && !isLocalBarAuthority && !isManageUnlocked/)
  assert.match(layout, /!isLocalBarAuthority && syncStatus\?\.isOnline === false/)
  assert.match(nav, /localAuthority\s*=\s*false/)
  assert.match(nav, /Bar transactions are stored on this local database/)
  assert.match(layout, /if \(isLocalBarAuthority\) \{\s*return \[/)
  assert.match(layout, /Data, imports & backups/)
  assert.match(layout, /!isLocalBarAuthority && canAccessCapability\(access, 'data.import'\)/)
  assert.match(shell, /embeddedOperationsTab="accounting"/)
  assert.match(shell, /embeddedOperationsTab="workforce"/)
})
