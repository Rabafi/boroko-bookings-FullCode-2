import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isManageHubPath,
  isManagerGatedPath,
  requiresManagePinForSearch,
  HPOS_MANAGER_GATED_ROUTES,
} from '../src/shared/barModeProfile.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Till wrong PIN tells every operator to ask an admin for a reset', () => {
  const posDomain = read('src/main/domains/pos.js')
  assert.match(posDomain, /OPERATOR_PIN_RESET_HINT/, 'Main must hold one shared operator PIN-reset hint')
  assert.match(posDomain, /ask an admin to reset it in Staff Management/, 'Hint must name the admin reset path')
  assert.match(posDomain, /Incorrect staff PIN\.\$\{OPERATOR_PIN_RESET_HINT\}/, 'Cached verifier must append the hint to wrong-PIN failures')
  assert.match(posDomain, /withOperatorPinResult/, 'Server-returned PIN failures must be wrapped with the hint')
  assert.match(posDomain, /activateSharedTillOperator[\s\S]*withOperatorPinResult/, 'Till unlock must not return a bare wrong-PIN message')
  assert.match(posDomain, /clock_in_staff_with_attendance_pin[\s\S]*withOperatorPinResult/, 'Attendance clock-in must carry the same guidance')
  assert.match(posDomain, /clock_out_staff_with_attendance_pin[\s\S]*withOperatorPinResult/, 'Attendance clock-out must carry the same guidance')

  const dialog = read('src/renderer/src/components/hospitality-pos/HposTillOperatorDialog.jsx')
  assert.match(dialog, /ask an admin to reset it in Staff Management/, 'Till dialog must show the admin-reset path on wrong PIN')
  assert.match(dialog, /displayError/, 'Dialog must defensively append the hint for older main builds')
})

test('Operators can set their own PIN from their personal account; admin override stays', () => {
  const migration = read('supabase/migrations/20260916000000_self_service_staff_pin.sql')
  assert.match(migration, /change_own_staff_pin/, 'Self-service must live in one atomic server RPC')
  assert.match(migration, /4.*6.*digits|4–6 digits/, 'Server must enforce the 4–6 digit contract')
  assert.match(migration, /app_require_lodge_role/, 'Server must enforce lodge membership')
  assert.match(migration, /app_current_user_id/, 'Server must force the target to the signed-in operator')
  assert.match(migration, /ask an admin to reset it in Staff Management/, 'Forgotten-current-PIN failures must point to the admin reset')
  assert.match(migration, /grant execute on function public\.change_own_staff_pin\(jsonb\) to anon, authenticated, service_role/, 'Desktop (anon) and signed-in operators must reach the RPC')

  const authUsers = read('src/main/domains/authUsers.js')
  assert.match(authUsers, /changeOwnStaffPin/, 'Main must expose a self-service PIN changer')
  assert.match(authUsers, /state\.currentUser\?\.id/, 'Self-service target must be the current user, never a passed-in id')
  assert.match(authUsers, /Connect to the internet to change your Staff PIN/, 'Self-service must fail closed offline with reconnect guidance')
  assert.match(authUsers, /change_own_staff_pin/, 'Main must call the authoritative RPC, not write pin_hash directly')

  const preload = read('src/preload/index.js')
  assert.match(preload, /changeOwnPin/, 'Renderer must reach self-service through preload')

  const main = read('src/main/index.js')
  assert.match(main, /users:changeOwnPin/, 'Main must handle the self-service IPC')
  assert.match(main, /requireCapability\('pos\.view'\)/, 'Self-service must not require staff.manage')
  const changeOwnPinAt = main.indexOf("users:changeOwnPin")
  const changeOwnPinBlock = main.slice(changeOwnPinAt, changeOwnPinAt + 800)
  assert.doesNotMatch(changeOwnPinBlock, /requireCapability\('staff\.manage'\)/, 'Self-service IPC must not gate on staff.manage')

  const myShift = read('src/renderer/src/components/hospitality-pos/HposMyShift.jsx')
  assert.match(myShift, /My Staff PIN/, 'Personal shift page must host the self-service PIN card')
  assert.match(myShift, /changeOwnPin/, 'PIN card must call the self-service IPC')
  assert.match(myShift, /ask an admin to reset it/, 'PIN card must point forgotten-PIN operators to the admin reset')
  assert.match(myShift, /Admins keep the right to reset it/, 'PIN card must state the admin override is retained')

  const nav = read('src/renderer/src/components/hospitality-pos/HposNav.jsx')
  assert.match(nav, /My Staff PIN/, 'Profile menu must link to the personal PIN card')

  // Admin override is unchanged: Staff Management keeps its PIN field behind staff.manage.
  const staff = read('src/renderer/src/components/Staff.jsx')
  assert.match(staff, /pin/, 'Staff Management must keep its PIN field for admin override')
  assert.match(main, /users:update/, 'Admin update IPC must remain')
})

test('Global search gates Manage-hub pages with the same PIN unlock', () => {
  // Page-level gate stays limited to the hub + three moved pages.
  assert.deepEqual([...HPOS_MANAGER_GATED_ROUTES], ['/hpos/manage', '/hpos/stock', '/hpos/cash', '/hpos/reports'])
  assert.equal(isManagerGatedPath('/hpos/stock'), true)
  assert.equal(isManagerGatedPath('/hpos/team'), false, 'Team stays page-ungated; search still gates it')

  // Hub detection covers both modes and strips query strings.
  assert.equal(isManageHubPath('/staff'), true, '/staff lives under Manage')
  assert.equal(isManageHubPath('/settings'), true, '/settings lives under Manage')
  assert.equal(isManageHubPath('/hpos/system-health?tab=audit'), true, 'Query-string hub routes must match')
  assert.equal(isManageHubPath('/restaurant/inventory'), true, 'Restaurant hub routes count as Manage pages')
  assert.equal(isManageHubPath('/hpos/my-shift'), false, 'Personal shift must never require the manager PIN')
  assert.equal(isManageHubPath('/hpos/pos'), false, 'Till must never require the manager PIN')

  assert.equal(requiresManagePinForSearch('/hpos/stock'), true, 'Already-gated pages still gate via search')
  assert.equal(requiresManagePinForSearch('/staff'), true, 'Hub pages gate via search with the same unlock')
  assert.equal(requiresManagePinForSearch('/settings?tab=license'), true, 'Hub query routes gate via search')
  assert.equal(requiresManagePinForSearch('/hpos/my-shift'), false, 'Personal pages stay ungated in search')
  assert.equal(requiresManagePinForSearch('/hpos/pos'), false, 'Till stays ungated in search')

  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  assert.match(layout, /requiresManagePinForSearch/, 'Search selection must go through the Manage-hub gate')
  assert.match(layout, /requestManageAccess\(command\.route\)/, 'Gated search selections must reuse the same unlock flow')

  const profile = read('src/shared/barModeProfile.js')
  assert.match(profile, /requiresManagePinForSearch/, 'Shared profile must own the search-gate decision')
  assert.match(profile, /isManageHubPath/, 'Hub membership must be a shared, tested helper')
})
