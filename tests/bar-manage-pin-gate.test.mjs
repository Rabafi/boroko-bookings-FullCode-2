import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getHposDockItems,
  getHposMoreItems,
  HPOS_MANAGER_GATED_ROUTES,
  HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS,
  isManagerGatedPath,
} from '../src/shared/barModeProfile.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const barSettings = {
  property_type: 'restaurant',
  operating_profile: { hospitality_mode: 'bar_only' },
}
const restaurantSettings = {
  property_type: 'restaurant',
  operating_profile: { hospitality_mode: 'restaurant_bar' },
}

test('Stock, Cash & close and Sales leave the primary rail on both modes', () => {
  const barRoutes = getHposDockItems(barSettings).map((item) => item.route)
  assert.deepEqual(barRoutes, ['/hpos/pos', '/hpos/checks', '/hpos/menu'])

  const restaurantRoutes = getHposDockItems(restaurantSettings).map((item) => item.route)
  assert.deepEqual(restaurantRoutes, [
    '/hpos/pos',
    '/hpos/checks',
    '/hpos/floor',
    '/hpos/kitchen',
    '/hpos/menu',
  ])

  for (const routes of [barRoutes, restaurantRoutes]) {
    assert.ok(!routes.includes('/hpos/stock'), 'Stock must not stay on the rail')
    assert.ok(!routes.includes('/hpos/cash'), 'Cash & close must not stay on the rail')
  }
  assert.ok(!barRoutes.includes('/hpos/reports'), 'Sales must not stay on the Bar rail')
})

test('Stock, Cash & close and Sales remain reachable under Manage on both modes', () => {
  const barMore = getHposMoreItems(barSettings).map((item) => item.route)
  for (const route of ['/hpos/menu', '/hpos/stock', '/hpos/cash', '/hpos/reports']) {
    assert.ok(barMore.includes(route), `${route} must stay in Bar Manage`)
  }

  const restaurantMore = getHposMoreItems(restaurantSettings).map((item) => item.route)
  for (const route of ['/hpos/stock', '/hpos/cash', '/hpos/reports']) {
    assert.ok(restaurantMore.includes(route), `${route} must be listed in Restaurant Manage`)
  }
})

test('Manager-gated routes cover the hub and the three moved pages with a session timeout', () => {
  assert.deepEqual([...HPOS_MANAGER_GATED_ROUTES], [
    '/hpos/manage',
    '/hpos/stock',
    '/hpos/cash',
    '/hpos/reports',
  ])
  assert.equal(HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS, 15 * 60 * 1000)

  for (const route of ['/hpos/manage', '/hpos/stock', '/hpos/cash', '/hpos/reports', '/hpos/manage?tab=audit', '/hpos/cash/summary']) {
    assert.equal(isManagerGatedPath(route), true, route)
  }
  for (const route of ['/hpos/pos', '/hpos/checks', '/hpos/menu', '/hpos/team', '/']) {
    assert.equal(isManagerGatedPath(route), false, route)
  }
})

test('Manage entry and gated routes require a server-checked manager PIN, never a stored PIN', () => {
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  assert.match(layout, /isManagerGatedPath/, 'Rail must know which routes are manager-gated')
  assert.match(layout, /HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS/, 'Unlock must expire on a shared timeout')
  assert.match(layout, /requestManageAccess/, 'Manage button must go through the PIN gate')
  assert.match(layout, /verifyManagerPin/, 'PIN must be verified through the manager IPC')
  assert.match(layout, /hpos-manage-unlock-at/, 'Unlock must be session-scoped, not a stored PIN')
  assert.match(layout, /Unlock Manage/, 'Gate must offer an explicit unlock action')
  assert.match(layout, /manager PIN/, 'Gate must name the manager PIN requirement')
  assert.match(layout, /Only managers and admins can unlock/, 'Gate must state the manager-only boundary')
  assert.match(layout, /cannot check the manager PIN yet/, 'Gate must tell the operator to relaunch when the unlock build is not loaded, never report it as an incorrect PIN')
  assert.match(layout, /hpos-manage-locked/, 'Gated deep links must render a locked placeholder, not the page')

  const posDomain = read('src/main/domains/pos.js')
  assert.match(posDomain, /verifyManagerPinForManage/, 'Main process must expose a manager unlock verifier')
  assert.match(posDomain, /p_required_capability: 'pos\.menu_manage'/, 'Online verification must require the manager-only capability the server enforces')
  assert.match(posDomain, /manager_manage_unlocked/, 'Successful unlocks must leave audit evidence')
  assert.match(posDomain, /A manager PIN is required to open Manage/, 'Supervisors and cashiers must fail closed with guidance')

  const preload = read('src/preload/index.js')
  assert.match(preload, /verifyManagerPin/, 'Renderer must reach the manager verifier through preload')

  const main = read('src/main/index.js')
  assert.match(main, /pos:verifyManagerPin/, 'Main process must handle the manager PIN IPC')
  assert.match(main, /verifyManagerPinForManage/, 'IPC handler must call the manager verifier')

  const database = read('src/main/database.js')
  assert.match(database, /verifyManagerPinForManage/, 'Facade must re-export the manager verifier')
})

test('Direct URLs for the moved pages keep working behind the same unlock', () => {
  const app = read('src/renderer/src/App.jsx')
  for (const route of ['hpos/stock', 'hpos/cash', 'hpos/reports', 'hpos/manage']) {
    assert.match(app, new RegExp(`path="${route.replace('/', '\\/')}"`), `${route} must remain a reachable URL`)
  }

  const hub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')
  for (const route of ["'/hpos/stock'", "'/hpos/cash'", "'/hpos/reports'"]) {
    assert.ok(hub.includes(route), `${route} must keep a Manage hub description`)
  }
})
