import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { discoverRestaurantSuites } from './run-restaurant-suite.mjs'

const read = (path) => readFileSync(resolve(path), 'utf8')
const domain = read('src/main/domains/pos.js')
const migration = read('supabase/migrations/20261010010000_pos_staff_menu_read_rpc.sql')
const appSessionMigration = read('supabase/migrations/20261010020000_pos_menu_read_app_session_contract.sql')
const start = domain.indexOf('async function _getPosMenuItems(')
const end = domain.indexOf('\nexport function getPosMenuItems', start)
const onlineRead = domain.slice(start, end)

test('POS online menu reads use the staff RPC while retaining the offline cache fallback', () => {
  assert.match(onlineRead, /rpc\('get_pos_menu_items_for_staff_v1',\s*\{\s*p_lodge_id:\s*state\.lodgeId\s*\}\)/)
  assert.match(onlineRead, /writeCache\('pos-menu-items',\s*rows\)/)
  assert.match(onlineRead, /POS_MENU_VERIFICATION_CACHE_KEY/)
  assert.match(onlineRead, /applyPosMenuOutletFilter\(readCache\('pos-menu-items'\),\s*outletFilter\)/)
  assert.doesNotMatch(onlineRead, /from\('pos_menu_items'\)/)
  const lookupStart = domain.indexOf('export async function getPosMenuItemById(')
  const lookupEnd = domain.indexOf('export async function createPosMenuItem(', lookupStart)
  const itemLookup = domain.slice(lookupStart, lookupEnd)
  assert.match(itemLookup, /getPosMenuItems\(null\)/)
  assert.doesNotMatch(itemLookup, /from\('pos_menu_items'\)/)
})

test('server read is bound to an active desktop app session or Supabase Auth user in the requested lodge', () => {
  const appSessionMigration = read('supabase/migrations/20261010020000_pos_menu_read_app_session_contract.sql')
  assert.match(migration, /security definer/i)
  assert.match(appSessionMigration, /public\.app_get_actor_user_id\(\)/)
  assert.match(appSessionMigration, /public\.app_current_lodge_id\(\)\s+is distinct from p_lodge_id/)
  assert.match(appSessionMigration, /auth\.uid\(\)/)
  assert.match(appSessionMigration, /u\.auth_user_id\s*=\s*v_auth_actor/)
  assert.match(appSessionMigration, /u\.lodge_id\s*=\s*p_lodge_id/)
  assert.match(appSessionMigration, /lower\(coalesce\(u\.status,\s*'active'\)\)\s*=\s*'active'/)
  assert.match(appSessionMigration, /when no_data_found then[\s\S]*?using errcode = '42501'/i)
})

test('server read enforces pos.view and explicit deny overrides', () => {
  assert.match(migration, /->\s*'pos\.view'/)
  assert.match(migration, /if not coalesce\(v_can_view, false\) then/i)
  assert.match(migration, /'cashier',\s*'supervisor',\s*'manager',\s*'admin',\s*'super_admin'/)
})

test('server read constrains outlet-scoped users and keeps deterministic bounded ordering', () => {
  assert.match(appSessionMigration, /m\.outlet_id is null or m\.outlet_id = any\(coalesce\(v_user\.allowed_outlet_ids, '\{\}'::uuid\[\]\)\)/)
  assert.match(appSessionMigration, /cardinality\(coalesce\(v_user\.allowed_outlet_ids, '\{\}'::uuid\[\]\)\) = 0 then[\s\S]*?return;/i)
  assert.match(migration, /order by m\.category, m\.name, m\.id\s+limit 500/i)
})

test('function execute is limited to the desktop session RPC and adds no direct table grants', () => {
  assert.match(appSessionMigration, /revoke all on function public\.get_pos_menu_items_for_staff_v1\(uuid\) from public, anon, authenticated, service_role/i)
  assert.match(appSessionMigration, /grant execute on function public\.get_pos_menu_items_for_staff_v1\(uuid\) to anon, authenticated/i)
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+(table\s+)?public\.pos_menu_items/i)
  assert.ok(discoverRestaurantSuites().includes('restaurant-pos-menu-read-contract.test.mjs'))
})

test('unavailable online catalog reads never masquerade as a valid empty menu', () => {
  const menuUi = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  const tillUi = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const legacyPosUi = read('src/renderer/src/components/POS.jsx')
  assert.match(onlineRead, /POS_MENU_READ_TIMEOUT_MS/)
  assert.match(onlineRead, /Array\.isArray\(cached\) && \(cached\.length \|\| verifiedCatalogue\)/)
  assert.match(onlineRead, /throw unavailable/)
  assert.match(menuUi, /menuData\?\._available === false/)
  assert.match(tillUi, /!Array\.isArray\(data\) && menuReadStatus\?\._available === false && menuReadStatus\._source === 'unavailable'[\s\S]*?new Error\(`\$\{readError \|\|/)
  assert.match(legacyPosUi, /!Array\.isArray\(data\) && menuReadStatus\?\._available === false && menuReadStatus\._source === 'unavailable'[\s\S]*?typeof readError === 'string' && readError[\s\S]*?setMenuReadError\(/)
  const menuLoadStart = legacyPosUi.indexOf('const loadMenu =')
  const menuLoadEnd = legacyPosUi.indexOf('const loadInventoryItems =', menuLoadStart)
  const legacyMenuLoad = legacyPosUi.slice(menuLoadStart, menuLoadEnd)
  assert.match(legacyMenuLoad, /setMenuItems\(\[\]\)/)
  assert.match(legacyMenuLoad, /setMenuItems\([\s\S]*?data \|\| \[\]\)/)
  assert.match(legacyPosUi, /menuReadError && \([\s\S]*?<ErrorNotice[\s\S]*?\{menuReadError\}/)
})
