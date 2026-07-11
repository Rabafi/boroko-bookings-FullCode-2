import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
const restaurantDirectory = new URL('src/renderer/src/components/restaurant/', root)

test('restaurant workspaces expose a focused tab set with a recovery boundary', () => {
  for (const workspaceName of ['floor', 'kitchen', 'menu', 'stock', 'team', 'close', 'control']) assert.match(workspace, new RegExp(`${workspaceName}:\\s*\\{`))
  assert.match(workspace, /RestaurantWorkspaceErrorBoundary/)
  assert.match(workspace, /No sale or stock change was made/)
  assert.match(workspace, /<ActiveComponent workspace=\{workspace\} tabKey=\{activeTab.key\}/)
})

test('growth controls do not duplicate unrelated management forms across tabs', () => {
  const growth = read('src/renderer/src/components/restaurant/RestaurantGrowthControls.jsx')
  for (const gate of ['showGift', 'showTips', 'showLots', 'showPolicy']) assert.match(growth, new RegExp(`\\{${gate} &&`))
  assert.match(growth, /const title = showLots/)
})

test('restaurant components remain isolated from accommodation APIs', () => {
  const files = readdirSync(restaurantDirectory).filter((file) => file.endsWith('.jsx'))
  for (const file of files) {
    const source = read(`src/renderer/src/components/restaurant/${file}`)
    assert.doesNotMatch(source, /window\.api\.(bookings|rooms|guests|housekeeping|conference|dayuse)/, `${file} must not call accommodation APIs`)
  }
})

test('irreversible floor actions and reservation errors are visible to operators', () => {
  const tables = read('src/renderer/src/components/restaurant/RestaurantTables.jsx')
  const reservations = read('src/renderer/src/components/restaurant/RestaurantReservations.jsx')
  assert.match(tables, /window\.confirm\(`Force-close/)
  assert.match(tables, /Could not close the table/)
  assert.match(reservations, /Could not update reservation/)
  assert.match(reservations, /\['booked', 'confirmed'\]\.includes\(r\.status\)/)
})
