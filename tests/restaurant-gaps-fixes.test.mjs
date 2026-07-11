import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'fs/promises'

// ── DataManagement ExportTab receives props ────────────────────────
test('DataManagement ExportTab accepts restaurantMode, EXPORT_PRESETS, EXPORT_SECTIONS as props', async () => {
  const src = await readFile('src/renderer/src/components/DataManagement.jsx', 'utf8')
  assert.ok(src.includes('function ExportTab({ restaurantMode, EXPORT_PRESETS, EXPORT_SECTIONS })'), 'ExportTab must accept props')
  assert.ok(src.includes('<ExportTab restaurantMode={restaurantMode} EXPORT_PRESETS={EXPORT_PRESETS} EXPORT_SECTIONS={EXPORT_SECTIONS} />'), 'Parent must pass props to ExportTab')
})

test('DataManagement ExportTab does not reference undefined variables', async () => {
  const src = await readFile('src/renderer/src/components/DataManagement.jsx', 'utf8')
  // ExportTab should only use props, not closure variables
  const exportTabMatch = src.match(/function ExportTab\(\{[^}]+\}\) \{([\s\S]*?)^\}/m)
  assert.ok(exportTabMatch, 'ExportTab function body must exist')
  const body = exportTabMatch[1]
  assert.ok(!body.includes('const restaurantMode'), 'ExportTab must not define its own restaurantMode')
  assert.ok(!body.includes('const EXPORT_PRESETS'), 'ExportTab must not define its own EXPORT_PRESETS')
  assert.ok(!body.includes('const EXPORT_SECTIONS'), 'ExportTab must not define its own EXPORT_SECTIONS')
})

// ── Cash Drawer uses declaredTotal camelCase ──────────────────────
test('RestaurantCashDrawer uses declaredTotal not declared_total', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('Number(declaredTotal)'), 'Must use Number(declaredTotal)')
  assert.ok(!src.includes('Number(declared_total)'), 'Must NOT use Number(declared_total)')
})

test('RestaurantCashDrawer sends camelCase payload to openCashDrawerSession', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('openingFloat:'), 'Must send openingFloat (camelCase)')
  assert.ok(!src.includes('opening_float:'), 'Must NOT send opening_float (snake_case)')
})

test('RestaurantCashDrawer sends camelCase payload to closeCashDrawerSession', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  assert.ok(src.includes('sessionId:'), 'Must send sessionId')
  assert.ok(src.includes('closingTotal:'), 'Must send closingTotal')
  assert.ok(src.includes('declaredTotal:'), 'Must send declaredTotal')
  assert.ok(!src.includes('session_id:'), 'Must NOT send session_id')
  assert.ok(!src.includes('closing_total:'), 'Must NOT send closing_total')
})

// ── Shifts sends shiftId ─────────────────────────────────────────
test('RestaurantShifts clockOutStaff sends shiftId not shift_id', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantShifts.jsx', 'utf8')
  assert.ok(src.includes('shiftId'), 'Must use shiftId')
  assert.ok(!src.includes('shift_id'), 'Must NOT use shift_id')
})

// ── Purchasing sends raw orderId ──────────────────────────────────
test('RestaurantPurchasing approvePurchaseOrder sends raw orderId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantPurchasing.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.approvePurchaseOrder(orderId)'), 'Must send raw orderId')
  assert.ok(!src.includes('approvePurchaseOrder({'), 'Must NOT send object with order_id')
})

test('RestaurantPurchasing receivePurchaseOrder sends raw orderId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantPurchasing.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.receivePurchaseOrder(orderId)'), 'Must send raw orderId')
  assert.ok(!src.includes('receivePurchaseOrder({'), 'Must NOT send object with order_id')
})

// ── Alerts sends raw alertId ──────────────────────────────────────
test('RestaurantAlerts resolveAlert sends raw alertId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantAlerts.jsx', 'utf8')
  assert.ok(src.includes('await window.api.pos.resolveAlert(alertId)'), 'Must send raw alertId')
  assert.ok(!src.includes('resolveAlert({'), 'Must NOT send object with alert_id')
})

// ── Checklists sends camelCase payloads ───────────────────────────
test('RestaurantChecklists sends camelCase checklistType and itemId', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantChecklists.jsx', 'utf8')
  assert.ok(src.includes('checklistType: newType'), 'Must send checklistType')
  assert.ok(!src.includes('checklist_type: newType'), 'Must NOT send checklist_type')
  assert.ok(src.includes('{ itemId }'), 'Must send { itemId }')
  assert.ok(!src.includes('{ item_id:'), 'Must NOT send { item_id: }')
})

// ── Preload exports exist ─────────────────────────────────────────
test('Preload exposes getPurchaseOrders, getShiftHistory, getCashDrawerSessions, getChecklists, getExceptionAlerts', async () => {
  const src = await readFile('src/preload/index.js', 'utf8')
  assert.ok(src.includes('getPurchaseOrders:'), 'getPurchaseOrders must be exposed')
  assert.ok(src.includes('getShiftHistory:'), 'getShiftHistory must be exposed')
  assert.ok(src.includes('getCashDrawerSessions:'), 'getCashDrawerSessions must be exposed')
  assert.ok(src.includes('getChecklists:'), 'getChecklists must be exposed')
  assert.ok(src.includes('getExceptionAlerts:'), 'getExceptionAlerts must be exposed')
})

// ── IPC handlers exist ────────────────────────────────────────────
test('IPC handlers exist for new pos routes', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes("pos:getPurchaseOrders"), 'pos:getPurchaseOrders handler must exist')
  assert.ok(src.includes("pos:getShiftHistory"), 'pos:getShiftHistory handler must exist')
  assert.ok(src.includes("pos:getCashDrawerSessions"), 'pos:getCashDrawerSessions handler must exist')
  assert.ok(src.includes("pos:getChecklists"), 'pos:getChecklists handler must exist')
  assert.ok(src.includes("pos:getExceptionAlerts"), 'pos:getExceptionAlerts handler must exist')
})

// ── Domain functions exist in pos.js ──────────────────────────────
test('pos.js exports getPosPurchaseOrders, getShiftHistory, getCashDrawerSessions, getChecklists, getExceptionAlerts', async () => {
  const src = await readFile('src/main/domains/pos.js', 'utf8')
  assert.ok(src.includes('export async function getPosPurchaseOrders('), 'getPosPurchaseOrders must exist')
  assert.ok(src.includes('export async function getShiftHistory('), 'getShiftHistory must exist')
  assert.ok(src.includes('export async function getCashDrawerSessions('), 'getCashDrawerSessions must exist')
  assert.ok(src.includes('export async function getChecklists('), 'getChecklists must exist')
  assert.ok(src.includes('export async function getExceptionAlerts('), 'getExceptionAlerts must exist')
})

// ── database.js re-exports exist ──────────────────────────────────
test('database.js re-exports new pos functions', async () => {
  const src = await readFile('src/main/database.js', 'utf8')
  assert.ok(src.includes('getPosPurchaseOrders'), 'getPosPurchaseOrders must be re-exported')
  assert.ok(src.includes('getShiftHistory'), 'getShiftHistory must be re-exported')
  assert.ok(src.includes('getCashDrawerSessions'), 'getCashDrawerSessions must be re-exported')
  assert.ok(src.includes('getChecklists'), 'getChecklists must be re-exported')
  assert.ok(src.includes('getExceptionAlerts'), 'getExceptionAlerts must be re-exported')
})

// ── Export function uses correct names ─────────────────────────────
test('Export function in index.js uses getShiftHistory not getShifts', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes('db.getShiftHistory'), 'Must use db.getShiftHistory')
  assert.ok(!src.includes('db.getShifts?.'), 'Must NOT use db.getShifts')
})

test('Export function passes date range to getPosPurchaseOrders', async () => {
  const src = await readFile('src/main/index.js', 'utf8')
  assert.ok(src.includes('db.getPosPurchaseOrders?.(normalized.startDate, normalized.endDate)'), 'Must pass dates to getPosPurchaseOrders')
})

// ── RestaurantKitchen updateTicketStatus uses positional args ──────
test('RestaurantKitchen updateTicketStatus sends (id, status) not object', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantKitchen.jsx', 'utf8')
  assert.ok(src.includes('updateTicketStatus(ticketId, newStatus)'), 'Must send positional args')
  assert.ok(!src.includes('updateTicketStatus({'), 'Must NOT send object')
})

// ── Checklists item field names match SQL schema ──────────────────
test('RestaurantChecklists uses is_completed and item_label field names', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantChecklists.jsx', 'utf8')
  assert.ok(src.includes('is_completed'), 'Must use is_completed (matches SQL)')
  assert.ok(src.includes('item_label'), 'Must use item_label (matches SQL)')
})

// ── No references to undefined declared_total variable ─────────────
test('RestaurantCashDrawer has no reference to undefined declared_total variable', async () => {
  const src = await readFile('src/renderer/src/components/restaurant/RestaurantCashDrawer.jsx', 'utf8')
  // Check for standalone declared_total (not as property key in object)
  const lines = src.split('\n')
  const badLines = lines.filter(l => l.trim().startsWith('declared_total') && !l.includes("'declared_total'") && !l.includes('"declared_total"'))
  assert.equal(badLines.length, 0, `Found lines with undefined declared_total: ${badLines.join('; ')}`)
})
