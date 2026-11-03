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

test('configured local Bar starts in the normal Hpos shell and maps approved routes to local panels', () => {
  assert.match(app, /<LocalBarHposShell status=\{currentAuthority\}/)
  for (const [route, panel] of routePanels) {
    assert.match(shell, new RegExp(`<Route path="${route}" element=\\{<BarLocalWorkspace[^\\n]*embeddedPanel="${panel}"`), `${route} must use its local workflow panel`)
  }
  assert.match(shell, /<Route path="\*" element=\{<LocalBarRouteUnavailable \/>\}/)
  assert.match(shell, /localAuthority: true/)
  assert.match(shell, /APP_FEATURES\.map\(\(feature\) => \[feature, false\]\)/)
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
