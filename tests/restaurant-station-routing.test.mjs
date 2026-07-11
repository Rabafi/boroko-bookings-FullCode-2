import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

const POS_JS = 'src/main/domains/pos.js'
const STATION_ROUTING_MIGRATION = 'supabase/migrations/20260710170000_pos_kitchen_station_routing.sql'
const POS_JSX = 'src/renderer/src/components/POS.jsx'
const PRELOAD = 'src/preload/index.js'
const INDEX = 'src/main/index.js'
const DATABASE = 'src/main/database.js'
const RESTAURANT_STATIONS = 'src/renderer/src/components/restaurant/RestaurantStations.jsx'

describe('Restaurant Station Routing', () => {

  describe('Station CRUD (server-backed)', () => {
    it('pos.js getPosStations calls server RPC when online', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function getPosStations')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes("'get_pos_kitchen_stations'"), 'calls get_pos_kitchen_stations RPC')
      assert.ok(fnBody.includes('writePosStations'), 'caches results locally')
    })

    it('pos.js getPosStations returns default stations when cache is empty', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function getPosStations')
      const fnBody = js.slice(fnIdx, fnIdx + 1200)
      assert.ok(fnBody.includes("'kitchen'"), 'has kitchen default')
      assert.ok(fnBody.includes("'bar'"), 'has bar default')
    })

    it('pos.js savePosStation rejects offline edits', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function savePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 400)
      assert.ok(fnBody.includes('requires an internet connection'), 'rejects offline edits')
    })

    it('pos.js savePosStation calls upsert_pos_kitchen_station RPC', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function savePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes("'upsert_pos_kitchen_station'"), 'calls upsert RPC')
    })

    it('pos.js savePosStation validates station name', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function savePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 400)
      assert.ok(fnBody.includes('Station name is required'), 'validates name')
    })

    it('pos.js deletePosStation rejects offline deletions', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function deletePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 400)
      assert.ok(fnBody.includes('requires an internet connection'), 'rejects offline')
    })

    it('pos.js deletePosStation calls delete_pos_kitchen_station RPC', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function deletePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 600)
      assert.ok(fnBody.includes("'delete_pos_kitchen_station'"), 'calls delete RPC')
    })
  })

  describe('Station Routing in Ticket Creation', () => {
    it('buildPrepTicketsForOrder uses configured stations', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('function buildPrepTicketsForOrder')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('readPosStations'), 'reads configured stations')
    })

    it('buildPrepTicketsForOrder checks item.kitchen_station_id', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('function buildPrepTicketsForOrder')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('kitchen_station_id'), 'checks kitchen_station_id on item')
    })

    it('buildPrepTicketsForOrder maps station_key to station id', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('function buildPrepTicketsForOrder')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('stationKeyToId'), 'maps station keys to IDs')
    })

    it('buildPrepTicketsForOrder falls back to kitchen/bar by category', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('function buildPrepTicketsForOrder')
      const fnBody = js.slice(fnIdx, fnIdx + 1000)
      assert.ok(fnBody.includes("'bar'"), 'falls back to bar for drink categories')
      assert.ok(fnBody.includes("'kitchen'"), 'falls back to kitchen for food categories')
    })
  })

  describe('Menu Item Station Assignment (client)', () => {
    it('POS.jsx menuForm includes kitchen_station_id', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('kitchen_station_id'), 'menuForm has kitchen_station_id')
    })

    it('POS.jsx openCreateMenu resets kitchen_station_id', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const openCreateMenu =')
      const fnBody = jsx.slice(fnIdx, fnIdx + 500)
      assert.ok(fnBody.includes("kitchen_station_id: ''"), 'resets to empty string')
    })

    it('POS.jsx openEditMenu loads kitchen_station_id from item', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const openEditMenu =')
      const fnBody = jsx.slice(fnIdx, fnIdx + 900)
      assert.ok(fnBody.includes('item.kitchen_station_id'), 'loads from item')
    })

    it('POS.jsx addToOrder includes kitchen_station_id in order line', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const addToOrder =')
      const fnBody = jsx.slice(fnIdx, fnIdx + 900)
      assert.ok(fnBody.includes('kitchen_station_id: item.kitchen_station_id'), 'passes station to order line')
    })

    it('POS.jsx menu editor renders Kitchen Station selector dropdown', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('Kitchen Station'), 'has Kitchen Station label')
      assert.ok(jsx.includes('menuForm.kitchen_station_id'), 'dropdown bound to form state')
      assert.ok(jsx.includes('kitchenStations'), 'loads station list for dropdown')
    })

    it('POS.jsx loads stations via loadPosOperations', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('getStations'), 'calls getStations in loadPosOperations')
      assert.ok(jsx.includes('setKitchenStations'), 'sets kitchenStations state')
    })

    it('POS.jsx tickets tab uses dynamic station list from kitchenStations', () => {
      const jsx = read(POS_JSX)
      const ticketsIdx = jsx.indexOf("tab === 'tickets' && (")
      assert.ok(ticketsIdx > 0, 'tickets tab section exists')
      const nearby = jsx.slice(ticketsIdx, ticketsIdx + 500)
      assert.ok(nearby.includes('kitchenStations'), 'uses dynamic kitchenStations for ticket tabs')
    })
  })

  describe('Backend Migration (station routing)', () => {
    it('creates pos_kitchen_stations table', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('create table if not exists public.pos_kitchen_stations'), 'creates stations table')
    })

    it('enables RLS on pos_kitchen_stations', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('enable row level security'), 'enables RLS')
      assert.ok(sql.includes('pos_kitchen_stations_lodge_isolation'), 'has lodge isolation policy')
    })

    it('adds kitchen_station_id column to pos_menu_items', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('add column if not exists kitchen_station_id'), 'adds column to menu items')
      assert.ok(sql.includes('on delete set null'), 'cascade delete sets null')
    })

    it('get_pos_kitchen_stations RPC exists with REVOKE/GRANT', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('function public.get_pos_kitchen_stations'), 'function exists')
      assert.ok(sql.includes('revoke all on function public.get_pos_kitchen_stations'), 'revokes public access')
      assert.ok(sql.includes('grant execute on function public.get_pos_kitchen_stations'), 'grants to authenticated and service_role')
    })

    it('upsert_pos_kitchen_station RPC validates inputs', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('function public.upsert_pos_kitchen_station'), 'function exists')
      assert.ok(sql.includes('station_type must be'), 'validates station_type')
      assert.ok(sql.includes('station_key, and name are required'), 'validates required fields')
    })

    it('upsert_pos_kitchen_station requires manager/admin role', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const fnIdx = sql.indexOf('function public.upsert_pos_kitchen_station')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes("array['manager', 'admin', 'super_admin']"), 'requires elevated role')
    })

    it('delete_pos_kitchen_station RPC exists with REVOKE/GRANT', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('function public.delete_pos_kitchen_station'), 'function exists')
      assert.ok(sql.includes('revoke all on function public.delete_pos_kitchen_station'), 'revokes public access')
      assert.ok(sql.includes('grant execute on function public.delete_pos_kitchen_station'), 'grants to authenticated and service_role')
    })

    it('create_pos_menu_item accepts kitchen_station_id with validation', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const fnIdx = sql.indexOf('function public.create_pos_menu_item')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('kitchen_station_id'), 'accepts kitchen_station_id')
      assert.ok(fnBody.includes('Station does not belong to this lodge'), 'validates station ownership')
      assert.ok(fnBody.includes('Station is disabled or does not serve this outlet'), 'validates station enabled and outlet match')
    })

    it('update_pos_menu_item accepts kitchen_station_id with validation', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const fnIdx = sql.indexOf('function public.update_pos_menu_item')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('kitchen_station_id'), 'accepts kitchen_station_id')
      assert.ok(fnBody.includes('Station does not belong to this lodge'), 'validates station ownership')
      assert.ok(fnBody.includes('Station is disabled or does not serve this outlet'), 'validates station enabled and outlet match')
    })

    it('pos_kitchen_stations FK references settings(lodge_id) not settings(id)', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      assert.ok(sql.includes('references public.settings(lodge_id)'), 'FK uses settings(lodge_id)')
      assert.ok(!sql.includes('references public.settings(id)'), 'does not reference settings(id)')
    })

    it('create_pos_order_v3 is replaced with item-grouped station routing', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const upperSql = sql.toUpperCase()
      const fnIdx = upperSql.indexOf('CREATE OR REPLACE FUNCTION PUBLIC.CREATE_POS_ORDER_V3')
      assert.ok(fnIdx > 0, 'create_pos_order_v3 exists in station routing migration')
      const fnBody = sql.slice(fnIdx, fnIdx + 25000)
      assert.ok(fnBody.includes('station_key'), 'has station_key variable')
      assert.ok(fnBody.includes('pos_kitchen_stations'), 'joins pos_kitchen_stations for routing')
      assert.ok(fnBody.includes('kitchen_station_id'), 'reads kitchen_station_id from menu items')
    })

    it('create_pos_order_v3 inserts one prep ticket per station group', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const upperSql = sql.toUpperCase()
      const fnIdx = upperSql.indexOf('CREATE OR REPLACE FUNCTION PUBLIC.CREATE_POS_ORDER_V3')
      const fnBody = sql.slice(fnIdx, fnIdx + 25000)
      assert.ok(fnBody.includes("insert into public.pos_prep_tickets"), 'inserts prep tickets')
      assert.ok(fnBody.includes('v_station_groups'), 'groups items by station')
      assert.ok(fnBody.includes('v_tickets_created'), 'collects created tickets')
      assert.ok(fnBody.includes("'tickets', v_tickets_created"), 'returns tickets in result')
    })

    it('create_pos_order_v3 resolves default station from outlet type', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const upperSql = sql.toUpperCase()
      const fnIdx = upperSql.indexOf('CREATE OR REPLACE FUNCTION PUBLIC.CREATE_POS_ORDER_V3')
      const fnBody = upperSql.slice(fnIdx, fnIdx + 25000)
      assert.ok(fnBody.includes("V_DEFAULT_STATION TEXT := 'KITCHEN'"), 'defaults to kitchen')
      assert.ok(fnBody.includes("'BEVERAGE'"), 'checks for beverage outlet type')
      assert.ok(fnBody.includes("V_DEFAULT_STATION := 'BAR'"), 'switches to bar for beverage')
    })

    it('publish_pos_catalog_snapshot includes kitchen_station_id in items', () => {
      const sql = read(STATION_ROUTING_MIGRATION)
      const upperSql = sql.toUpperCase()
      const fnIdx = upperSql.indexOf('CREATE OR REPLACE FUNCTION PUBLIC.PUBLISH_POS_CATALOG_SNAPSHOT')
      assert.ok(fnIdx > 0, 'publish_pos_catalog_snapshot exists in migration')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes("'kitchen_station_id', m.kitchen_station_id"), 'includes kitchen_station_id in snapshot items')
    })
  })

  describe('Client Plumbing', () => {
    it('pos.js createPosMenuItem includes kitchen_station_id', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function createPosMenuItem')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('kitchen_station_id: data.kitchen_station_id'), 'creates with station')
    })

    it('pos.js updatePosMenuItem includes kitchen_station_id', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosMenuItem')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('kitchen_station_id'), 'updates with station')
    })

    it('pos.js offline order includes kitchen_station_id in items', () => {
      const js = read(POS_JS)
      const offlineIdx = js.indexOf('_sync_created_offline: true')
      const nearby = js.slice(offlineIdx, offlineIdx + 1000)
      assert.ok(nearby.includes('kitchen_station_id'), 'offline order items include station')
    })

    it('database.js exports station functions', () => {
      const db = read(DATABASE)
      assert.ok(db.includes('getPosStations'), 'exports getPosStations')
      assert.ok(db.includes('savePosStation'), 'exports savePosStation')
      assert.ok(db.includes('deletePosStation'), 'exports deletePosStation')
    })

    it('preload.js has station methods', () => {
      const pl = read(PRELOAD)
      assert.ok(pl.includes('getStations'), 'getStations preload')
      assert.ok(pl.includes('saveStation'), 'saveStation preload')
      assert.ok(pl.includes('deleteStation'), 'deleteStation preload')
    })

    it('index.js has station IPC handlers', () => {
      const idx = read(INDEX)
      assert.ok(idx.includes('pos:getStations'), 'getStations handler')
      assert.ok(idx.includes('pos:saveStation'), 'saveStation handler')
      assert.ok(idx.includes('pos:deleteStation'), 'deleteStation handler')
    })

    it('RestaurantStations.jsx shows offline indicator', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('WifiOff'), 'imports WifiOff icon')
      assert.ok(comp.includes('isOffline'), 'tracks offline state')
      assert.ok(comp.includes('requires an internet connection'), 'shows offline warning')
    })

    it('RestaurantStations.jsx disables actions when offline', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('disabled={isOffline}'), 'disables buttons offline')
    })

    it('RestaurantStations.jsx displays save error state', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('saveError'), 'has saveError state')
    })

    it('RestaurantStations.jsx shows last saved timestamp', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('lastSavedAt'), 'has lastSavedAt state')
      assert.ok(comp.includes('Last saved'), 'shows last saved text')
    })

    it('pos.js _getPosMenuItems select includes kitchen_station_id', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('async function _getPosMenuItems')
      const fnBody = js.slice(fnIdx, fnIdx + 600)
      assert.ok(fnBody.includes('kitchen_station_id'), 'menu item select includes kitchen_station_id')
    })

    it('pos.js offline order items include kitchen_station_id', () => {
      const js = read(POS_JS)
      const offlineIdx = js.indexOf('_sync_created_offline: true')
      const nearby = js.slice(offlineIdx, offlineIdx + 1000)
      assert.ok(nearby.includes('kitchen_station_id'), 'offline order items include station')
    })

    it('pos.js updatePosTicketStatus blocks offline updates', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function updatePosTicketStatus')
      const fnBody = js.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('Ticket status updates require an internet connection'), 'blocks offline')
      assert.ok(!fnBody.includes('offline: true'), 'no longer returns offline: true')
    })

    it('pos.js online order uses server tickets from RPC result', () => {
      const js = read(POS_JS)
      const idx = js.indexOf('Use server-created tickets from the RPC result')
      assert.ok(idx > 0, 'has server tickets comment')
      const nearby = js.slice(idx, idx + 500)
      assert.ok(nearby.includes('result.tickets'), 'uses tickets from RPC result')
      assert.ok(nearby.includes('serverTickets.length > 0'), 'checks for server tickets')
    })
  })
})
