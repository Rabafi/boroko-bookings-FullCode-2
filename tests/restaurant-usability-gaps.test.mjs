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

const POS_JSX = 'src/renderer/src/components/POS.jsx'
const POS_JS = 'src/main/domains/pos.js'
const PRELOAD = 'src/preload/index.js'
const INDEX = 'src/main/index.js'
const DATABASE = 'src/main/database.js'
const RESTAURANT_TABLES = 'src/renderer/src/components/restaurant/RestaurantTables.jsx'
const RESTAURANT_STATIONS = 'src/renderer/src/components/restaurant/RestaurantStations.jsx'
const RESTAURANT_WORKSPACE = 'src/renderer/src/components/restaurant/RestaurantWorkspace.jsx'
const EVEN_SPLIT_MIGRATION = 'supabase/migrations/20260710160000_pos_even_split_atomic.sql'

describe('Phase 6: Restaurant Usability Gaps', () => {

  describe('6.1 Bill Split Evenly', () => {
    it('POS.jsx has splitMode state for toggling split modes', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes("splitMode"), 'has splitMode state')
      assert.ok(jsx.includes("'items'"), 'has items mode')
      assert.ok(jsx.includes("'even'"), 'has even mode')
    })

    it('POS.jsx has splitEvenCount state for number of splits', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('splitEvenCount'), 'has splitEvenCount state')
    })

    it('POS.jsx has splitEvenNames state for naming split tabs', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('splitEvenNames'), 'has splitEvenNames state')
    })

    it('POS.jsx split modal has mode toggle (Split by Items / Split Evenly)', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('Split by Items'), 'has Split by Items button')
      assert.ok(jsx.includes('Split Evenly'), 'has Split Evenly button')
    })

    it('POS.jsx even split shows count selector with increment/decrement', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('setSplitEvenCount'), 'has setSplitEvenCount')
      assert.ok(jsx.includes('splitEvenCount'), 'has splitEvenCount in JSX')
    })

    it('POS.jsx even split shows per-split amount preview', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('each'), 'shows per-split amount')
    })

    it('POS.jsx even split allows naming each split tab', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('Tab names (optional)'), 'has tab name inputs for splits')
    })

    it('POS.jsx executeSplitBill handles both modes', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const executeSplitBill = async')
      const fnBody = jsx.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes("splitMode === 'even'"), 'handles even mode')
      assert.ok(fnBody.includes("splitMode === 'items'"), 'handles items mode')
      assert.ok(fnBody.includes('splitBillEvenly'), 'calls splitBillEvenly for even mode')
      assert.ok(fnBody.includes('splitBillByItems'), 'calls splitBillByItems for items mode')
    })

    it('POS.jsx openSplitModal resets split mode state', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const openSplitModal =')
      const fnBody = jsx.slice(fnIdx, fnIdx + 400)
      assert.ok(fnBody.includes("setSplitMode('items')"), 'resets to items mode')
      assert.ok(fnBody.includes('setSplitEvenCount(2)'), 'resets split count to 2')
      assert.ok(fnBody.includes('setSplitEvenNames([])'), 'resets split names')
    })

    it('splitBillEvenly exists in pos.js', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function splitBillEvenly'), 'function exists')
    })

    it('splitBillEvenly validates split count 2-10', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function splitBillEvenly')
      const fnBody = js.slice(fnIdx, fnIdx + 1000)
      assert.ok(fnBody.includes('numSplits < 2'), 'validates minimum')
      assert.ok(fnBody.includes('numSplits > 10'), 'validates maximum')
    })

    it('splitBillEvenly delegates the whole operation to the atomic server RPC', () => {
      const js = read(POS_JS)
      assert.ok(js.includes("rpc('split_pos_tab_evenly'"), 'uses server transaction')
      assert.ok(js.includes('Bill splits require a live connection'), 'does not invent offline tab state')
    })

    it('atomic split migration closes the source and records an idempotent audit trail', () => {
      const sql = read(EVEN_SPLIT_MIGRATION)
      assert.ok(sql.includes('create table if not exists public.pos_tab_split_operations'), 'stores replay result')
      assert.ok(sql.includes("status = 'closed'"), 'closes source only within transaction')
      assert.ok(sql.includes('pos_bill_split_evenly'), 'writes server audit')
      assert.ok(sql.includes('unique (lodge_id, idempotency_key)'), 'prevents duplicate retries')
    })

    it('atomic split RPC locks, scopes, and validates the source tab', () => {
      const sql = read(EVEN_SPLIT_MIGRATION)
      assert.ok(sql.includes('for update'), 'locks the source tab')
      assert.ok(sql.includes('app_require_lodge_role'), 'requires a permitted role')
      assert.ok(sql.includes('app_require_pos_outlet_access'), 'enforces outlet access')
    })

    it('splitBillEvenly is in database.js re-exports', () => {
      const db = read(DATABASE)
      assert.ok(db.includes('splitBillEvenly'), 'exported from database.js')
    })

    it('splitBillEvenly has IPC handler in index.js', () => {
      const idx = read(INDEX)
      assert.ok(idx.includes('pos:splitBillEvenly'), 'IPC handler exists')
      assert.ok(idx.includes('db.splitBillEvenly'), 'calls db.splitBillEvenly')
    })

    it('splitBillEvenly has preload method', () => {
      const pl = read(PRELOAD)
      assert.ok(pl.includes('splitBillEvenly'), 'preload method exists')
    })
  })

  describe('6.2 Kitchen Station Configuration', () => {
    it('pos.js has getPosStations function', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function getPosStations'), 'getPosStations exists')
    })

    it('pos.js has savePosStation function', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function savePosStation'), 'savePosStation exists')
    })

    it('pos.js has deletePosStation function', () => {
      const js = read(POS_JS)
      assert.ok(js.includes('export async function deletePosStation'), 'deletePosStation exists')
    })

    it('pos.js getPosStations returns defaults when empty', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function getPosStations')
      const fnBody = js.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes("'kitchen'"), 'has kitchen default')
      assert.ok(fnBody.includes("'bar'"), 'has bar default')
    })

    it('pos.js savePosStation validates station name', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function savePosStation')
      const fnBody = js.slice(fnIdx, fnIdx + 800)
      assert.ok(fnBody.includes('Station name is required'), 'validates name')
    })

    it('pos.js buildPrepTicketsForOrder uses configured stations', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('function buildPrepTicketsForOrder')
      const fnBody = js.slice(fnIdx, fnIdx + 600)
      assert.ok(fnBody.includes('readPosStations'), 'reads configured stations')
      assert.ok(fnBody.includes('item.station'), 'checks item station field')
    })

    it('database.js exports station functions', () => {
      const db = read(DATABASE)
      assert.ok(db.includes('getPosStations'), 'exports getPosStations')
      assert.ok(db.includes('savePosStation'), 'exports savePosStation')
      assert.ok(db.includes('deletePosStation'), 'exports deletePosStation')
    })

    it('index.js has station IPC handlers', () => {
      const idx = read(INDEX)
      assert.ok(idx.includes('pos:getStations'), 'getStations handler')
      assert.ok(idx.includes('pos:saveStation'), 'saveStation handler')
      assert.ok(idx.includes('pos:deleteStation'), 'deleteStation handler')
    })

    it('preload.js has station methods', () => {
      const pl = read(PRELOAD)
      assert.ok(pl.includes('getStations'), 'getStations preload')
      assert.ok(pl.includes('saveStation'), 'saveStation preload')
      assert.ok(pl.includes('deleteStation'), 'deleteStation preload')
    })

    it('RestaurantStations.jsx component exists', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.length > 100, 'component file exists')
    })

    it('RestaurantStations.jsx allows creating stations', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('saveStation'), 'calls saveStation')
      assert.ok(comp.includes('New Station'), 'has new station UI')
    })

    it('RestaurantStations.jsx shows station types (kitchen, bar, prep, other)', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('kitchen'), 'kitchen type')
      assert.ok(comp.includes('bar'), 'bar type')
      assert.ok(comp.includes('prep'), 'prep type')
      assert.ok(comp.includes('other'), 'other type')
    })

    it('RestaurantStations.jsx allows enable/disable stations', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('toggleEnabled'), 'toggle enable/disable')
      assert.ok(comp.includes('Enable'), 'enable button')
      assert.ok(comp.includes('Disable'), 'disable button')
    })

    it('RestaurantStations.jsx allows deleting stations', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('deleteStation'), 'delete station')
    })

    it('RestaurantWorkspace.jsx includes Stations tab in kitchen workspace', () => {
      const ws = read(RESTAURANT_WORKSPACE)
      assert.ok(ws.includes("key: 'stations'"), 'stations tab exists')
      assert.ok(ws.includes('RestaurantStations'), 'imports RestaurantStations')
    })
  })

  describe('6.3 Table Layout Visual Enhancement', () => {
    it('RestaurantTables.jsx has viewMode state', () => {
      const comp = read(RESTAURANT_TABLES)
      assert.ok(comp.includes('viewMode'), 'has viewMode state')
    })

    it('RestaurantTables.jsx has grid and area view modes', () => {
      const comp = read(RESTAURANT_TABLES)
      assert.ok(comp.includes("'grid'"), 'grid view mode')
      assert.ok(comp.includes("'area'"), 'area view mode')
    })

    it('RestaurantTables.jsx groups tables by area', () => {
      const comp = read(RESTAURANT_TABLES)
      assert.ok(comp.includes('tablesByArea'), 'tablesByArea computed')
      assert.ok(comp.includes('area || '), 'uses area field with fallback')
    })

    it('RestaurantTables.jsx shows view toggle buttons', () => {
      const comp = read(RESTAURANT_TABLES)
      assert.ok(comp.includes('Grid'), 'Grid button')
      assert.ok(comp.includes('By Area'), 'By Area button')
    })

    it('RestaurantTables.jsx area view shows area headers with LayoutGrid icon', () => {
      const comp = read(RESTAURANT_TABLES)
      assert.ok(comp.includes('LayoutGrid'), 'LayoutGrid icon imported')
      assert.ok(comp.includes('areaTables.length'), 'shows table count per area')
    })
  })

  describe('6.5 Split Evenly Fix Pass', () => {
    it('POS.jsx split modal has splitError state for server error display', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('splitError'), 'has splitError state')
    })

    it('POS.jsx executeSplitBill sets error state instead of alert', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const executeSplitBill = async')
      const fnBody = jsx.slice(fnIdx, fnIdx + 1200)
      assert.ok(fnBody.includes('setSplitError'), 'sets error state')
      assert.ok(!fnBody.includes('alert('), 'does not use alert for errors')
    })

    it('POS.jsx split modal displays error from server', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('splitError &&'), 'conditionally renders error')
      assert.ok(jsx.includes('bg-red-50'), 'renders error styling')
    })

    it('POS.jsx even split shows pre-payment warning copy', () => {
      const jsx = read(POS_JSX)
      assert.ok(jsx.includes('before taking any payments'), 'shows pre-payment warning')
    })

    it('POS.jsx openSplitModal clears splitError', () => {
      const jsx = read(POS_JSX)
      const fnIdx = jsx.indexOf('const openSplitModal =')
      const fnBody = jsx.slice(fnIdx, fnIdx + 400)
      assert.ok(fnBody.includes("setSplitError('')"), 'clears error on open')
    })

    it('split_pos_tab_evenly migration has pre-payment check', () => {
      const sql = read(EVEN_SPLIT_MIGRATION)
      assert.ok(sql.includes('pos_payments'), 'checks for existing payments')
      assert.ok(sql.includes('Void the payment before splitting'), 'error message about voiding payment')
    })

    it('split_pos_tab_evenly migration has enriched before_snapshot', () => {
      const sql = read(EVEN_SPLIT_MIGRATION)
      assert.ok(sql.includes("'source_items'"), 'includes source items in snapshot')
      assert.ok(sql.includes("'source_status'"), 'includes source status in snapshot')
      assert.ok(sql.includes("'source_table_name'"), 'includes source table name')
    })

    it('pos.js splitBillEvenly has no dead code after RPC return', () => {
      const js = read(POS_JS)
      const fnIdx = js.indexOf('export async function splitBillEvenly')
      const fnEnd = js.indexOf('\n}', fnIdx + 500)
      const fnBody = js.slice(fnIdx, fnEnd + 1)
      const returnIdx = fnBody.indexOf('return { success: false, error:', fnBody.indexOf("rpc('split_pos_tab_evenly'"))
      assert.ok(returnIdx > 0, 'has return after RPC path')
      const afterReturn = fnBody.slice(returnIdx + 50)
      assert.ok(!afterReturn.includes('const rows = readPosTabs'), 'no dead offline fallback code')
    })
  })

  describe('6.6 Station UI Fix Pass', () => {
    it('RestaurantStations.jsx has saveError state', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('saveError'), 'has saveError state')
    })

    it('RestaurantStations.jsx has isOffline state from navigator.onLine', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('isOffline'), 'has isOffline state')
      assert.ok(comp.includes('navigator.onLine'), 'initializes from navigator.onLine')
    })

    it('RestaurantStations.jsx has lastSavedAt timestamp', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('lastSavedAt'), 'has lastSavedAt state')
    })

    it('RestaurantStations.jsx disables create/edit/delete/toggle when offline', () => {
      const comp = read(RESTAURANT_STATIONS)
      const offlineButtons = comp.match(/disabled=\{isOffline\}/g)
      assert.ok(offlineButtons && offlineButtons.length >= 4, 'disables at least 4 actions when offline')
    })

    it('RestaurantStations.jsx catches and displays save errors', () => {
      const comp = read(RESTAURANT_STATIONS)
      assert.ok(comp.includes('catch (err)'), 'catches errors')
      assert.ok(comp.includes('setSaveError'), 'sets save error state')
    })
  })
})
