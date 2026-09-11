import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthContext, SettingsContext, AccessContext, FeaturesContext } from '../../../src/renderer/src/app-context.jsx'
import HposTerminal from '../../../src/renderer/src/components/hospitality-pos/HposTerminal.jsx'
import HposMenu from '../../../src/renderer/src/components/hospitality-pos/HposMenu.jsx'
import HposStock from '../../../src/renderer/src/components/hospitality-pos/HposStock.jsx'
import HposCashClose from '../../../src/renderer/src/components/hospitality-pos/HposCashClose.jsx'
import HposOpenChecks from '../../../src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx'
import HposManageHub from '../../../src/renderer/src/components/hospitality-pos/HposManageHub.jsx'
import HposLayout from '../../../src/renderer/src/components/hospitality-pos/HposLayout.jsx'
import HposMyShift from '../../../src/renderer/src/components/hospitality-pos/HposMyShift.jsx'
import HposMyCashup from '../../../src/renderer/src/components/hospitality-pos/HposMyCashup.jsx'
import HposMySales from '../../../src/renderer/src/components/hospitality-pos/HposMySales.jsx'
import HposReports from '../../../src/renderer/src/components/hospitality-pos/HposReports.jsx'
import HposCustomers from '../../../src/renderer/src/components/hospitality-pos/HposCustomers.jsx'
import HposExpenses from '../../../src/renderer/src/components/hospitality-pos/HposExpenses.jsx'
import '../../../src/renderer/src/styles/hospitality-pos.css'
const query = new URLSearchParams(location.search)
const page = query.get('page') || 'sell'
const mode = query.get('mode') || ''
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OUTLET = 'outlet-1'
const STAFF = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Mpho K.', email: 'mpho@example.test', role: 'manager', lodge_id: TENANT, has_pin: true }
const STAFF2 = { id: 'staff-2', name: 'Kabelo M.', email: 'kabelo@example.test', role: 'cashier', lodge_id: TENANT, has_pin: true }
const SHIFT = { id: 'shift-1', status: 'open', outlet_id: OUTLET, outlet_name: 'Main Bar', cashier_id: STAFF.id, cashier_name: STAFF2.name, opened_at: '2026-09-08T06:30:00Z', opening_float: 500 }
const OUTLETS = [{ id: OUTLET, name: 'Main Bar', type: 'beverage', is_active: true }]
const STOCK = [
  { id: 'stock-1', name: 'River Lager 330ml', category: 'Beer', unit: 'bottle', barcode: '600100000001', current_stock: 46, quantity_on_hand: 46, reorder_level: 24, unit_cost: 8.5, outlet_id: OUTLET, updated_at: '2026-09-08T12:00:00Z', is_active: true },
  { id: 'stock-2', name: 'Savanna Cider', category: 'Cider', unit: 'bottle', barcode: '600100000002', current_stock: 18, quantity_on_hand: 18, reorder_level: 24, unit_cost: 10, outlet_id: OUTLET, updated_at: '2026-09-08T12:00:00Z', is_active: true },
  { id: 'stock-3', name: 'Tonic Water', category: 'Mixer', unit: 'can', barcode: '600100000003', current_stock: 72, quantity_on_hand: 72, reorder_level: 24, unit_cost: 4.5, outlet_id: OUTLET, updated_at: '2026-09-08T12:00:00Z', is_active: true },
]
const MENU = [
  { id: 'menu-1', name: 'River Lager', category: 'Beer', price: 28, barcode: '600100000001', inventory_item_id: 'stock-1', depletion_qty: 1, stock_method: 'direct', is_available: true, available: true },
  { id: 'menu-2', name: 'Savanna Cider', category: 'Cider', price: 32, barcode: '600100000002', inventory_item_id: 'stock-2', depletion_qty: 1, stock_method: 'direct', is_available: true, available: true },
  { id: 'menu-3', name: 'Classic Gin & Tonic', category: 'Cocktails', price: 55, barcode: '600100000003', inventory_item_id: 'stock-3', depletion_qty: 1, stock_method: 'direct', is_available: true, available: true },
  { id: 'menu-4', name: 'Bar Snack Bowl', category: 'Snacks', price: 35, inventory_item_id: 'stock-3', depletion_qty: 1, stock_method: 'direct', is_available: false, available: false },
]
const TABS = [{ id: 'tab-1', tab_name: 'Thabo', table_name: null, tab_version: 4, waiter_id: STAFF.id, waiter_name: STAFF.name, outlet_id: OUTLET, shift_id: SHIFT.id, total: 143, financial_complete: true, status: 'open', created_at: '2026-09-08T12:40:00Z', updated_at: '2026-09-08T12:55:00Z', items: [{ item_name: 'River Lager', unit_price: 28, quantity: 2, line_total: 56 }, { item_name: 'Classic Gin & Tonic', unit_price: 55, quantity: 1, line_total: 55 }, { item_name: 'Bar Snack Bowl', unit_price: 32, quantity: 1, line_total: 32 }] }]
const ORDERS = [{ id: 'order-18', receipt_number: 'R-2026-0018', order_number: '18', status: 'completed', transaction_type: 'sale', service_mode: 'Counter', total: 111, created_at: '2026-09-08T14:20:00Z', business_date: '2026-09-08', outlet_id: OUTLET, shift_id: SHIFT.id, cashier_name: STAFF2.name, payment_method: 'cash', payment_breakdown: [{ method: 'cash', amount: 111 }], pos_order_items: [{ id: 'line-1', item_name: 'River Lager', quantity: 2, net_subtotal: 56 }, { id: 'line-2', item_name: 'Classic Gin & Tonic', quantity: 1, net_subtotal: 55 }] }]
const CASHUPS = [{ id: 'cashup-1', status: 'submitted', cashier_name: STAFF2.name, outlet_name: 'Main Bar', submitted_at: '2026-09-08T22:12:00Z', expected_cash_drawer: 2840, counted_by_method: { cash: 2820 }, cash_tips_retained: 0, notes: 'Short by P20 - recount completed.' }]
const CUSTOMERS = [{ id: 'customer-1', name: 'Naledi M.', phone: '+267 71 000 111', email: 'naledi@example.test', loyalty_points: 240, account_status: 'active', outstanding_balance: 0, available_credit: 0, notes: 'Prefers the lounge counter.' }]
const EXPENSES = [{ id: 'expense-1', date: '2026-09-08', category: 'Food & beverage', description: 'Ice delivery', amount: 180, notes: 'Morning delivery', evidence_ref: 'INV-104', reference_number: 'INV-104', payment_method: 'cash', status: 'submitted' }]
const settings = { property_type: 'bar', hospitality_mode: 'bar_only', lodge_id: TENANT, currency: 'P', timezone: 'Africa/Gaborone', business_name: 'Tsa Bonno Demo Bar', company_name: 'Tsa Bonno Demo Bar', business_date_cutoff: '04:00', operating_profile: { till_operator_policy: { mode: 'shift', inactivity_minutes: 30 } } }
const entitlement = { product_id: 'hospitality-pos', lodge_id: TENANT, enterprise_addons: ['bar_stock_purchasing_pro', 'bar_accounting_workforce', 'bar_growth_multi_outlet'], commercial_package_key: 'bar_pos' }
const access = { role: 'manager', allowedOutletIds: null, entitlement, refreshEntitlement: async () => ({ success: true }), capabilities: new Proxy({}, { get: () => true }) }
const reportEnvelope = { orders: ORDERS, source: 'server', complete: true, tender_complete: true, item_detail_complete: true, refreshed: true, control_totals: {} }
const fallback = (namespace, method, args = []) => {
  if (namespace === 'pos') {
    if (method === 'getMenuItems') return MENU
    if (method === 'getMenuStockReadiness') return { success: true, rows: MENU.map((item) => ({ menu_item_id: item.id, readiness: 'direct' })) }
    if (method === 'getModifierGroups' || method === 'getRecipes' || method === 'getPromotions') return []
    if (method === 'getCustomers') return CUSTOMERS
    if (method === 'getTabs') return TABS
    if (method === 'getStaff') return [STAFF, STAFF2]
    if (method === 'getCurrentShift' || method === 'getStaffOpenShift') return mode === 'start-shift' ? null : SHIFT
    if (method === 'getSharedTillOperatorSession') return mode === 'unlock' ? null : { success: true, session: { staffId: STAFF.id, staffName: STAFF.name, outletId: OUTLET, shiftId: SHIFT.id, expiresAt: '2026-09-08T14:30:00Z' } }
    if (method === 'getBarActiveShifts' || method === 'getActiveShifts') return [{ staff_user_id: STAFF2.id, staff_name: STAFF2.name, pos_shift_id: 'shift-2' }]
    if (method === 'getTablesWithStatus') return []
    if (method === 'getPendingPosSubmitAttempt') return null
    if (method === 'createOrder') return { success: true, id: 'order-19', receipt_number: 'R-2026-0019', created_at: '2026-09-08T14:25:00Z', total: 111, payment_method: 'cash', payment_breakdown: [{ method: 'cash', amount: 111 }], items: [{ item_name: 'River Lager', quantity: 2, unit_price: 28, net_subtotal: 56 }, { item_name: 'Classic Gin & Tonic', quantity: 1, unit_price: 55, net_subtotal: 55 }] }
    if (method === 'getHardwareSettings') return { receipt_printer_name: 'Demo Receipt Printer', cash_drawer_enabled: true, scanner_mode: 'keyboard_wedge' }
    if (method === 'getPendingCashupSubmissions') return { success: true, complete: true, offline: false, submissions: CASHUPS }
    if (method === 'getSetupProgressWithReadStatus') return { source: 'server', complete: true, online: true, rows: [{ stage_key: 'business_identity', detected: true }, { stage_key: 'bar_outlet', detected: true }, { stage_key: 'products', detected: true }, { stage_key: 'stock', detected: true }, { stage_key: 'staff', detected: true }, { stage_key: 'receipt_hardware', detected: true }] }
    if (method === 'getCertifiedReportHistory' || method === 'getSharedTillHistory') return reportEnvelope
    if (method === 'getMyOrders') return { __rowsTransport: true, rows: ORDERS, _source: 'server', _complete: true, _tender_complete: true, _item_detail_complete: true }
    if (method === 'getVoidHistory') return []
    if (method === 'getMyCashupSubmission') return { success: true, submission: null }
    if (method === 'getStaffCashupSubmission') return { success: true, submission: null }
    if (method === 'getChecklists') return []
    if (method === 'exportDailyCloseSummaryPdf') return { success: true, filePath: 'C:/Demo/Tsa-Bonno-Daily-Close.pdf' }
    if (method === 'reviewCashupSubmission') return { success: true }
    if (method.startsWith('get') || method.startsWith('load')) return []
    return { success: true, shift: SHIFT }
  }
  if (namespace === 'inventory') {
    if (method === 'getItemsWithReadStatus') return { items: STOCK, complete: true, source: 'server', online: true }
    if (method === 'getItems') return STOCK
    if (method === 'getBarStockAging') return []
    if (method === 'getMovementsWithReadStatus') return { rows: [], complete: true, source: 'server' }
    if (method === 'getBarStockCountHistory') return { success: true, rows: [] }
    if (method.startsWith('get')) return []
    return { success: true }
  }
  if (namespace === 'expenses') return { __rowsTransport: true, rows: EXPENSES, _source: 'server', _complete: true }
  if (namespace === 'outlets' && method === 'getAll') return OUTLETS
  if (namespace === 'users' && method === 'getAll') return [STAFF, STAFF2]
  if (namespace === 'settings') return settings
  if (namespace === 'sync' && method === 'getStatus') return { online: true, pending: 0 }
  return { success: true }
}
const makeNamespace = (namespace) => new Proxy({}, { get: (_target, method) => (...args) => Promise.resolve(fallback(namespace, String(method), args)) })
window.api = { pos: makeNamespace('pos'), inventory: makeNamespace('inventory'), outlets: makeNamespace('outlets'), users: makeNamespace('users'), settings: makeNamespace('settings'), expenses: makeNamespace('expenses'), backup: makeNamespace('backup'), activity: makeNamespace('activity'), health: makeNamespace('health'), sync: makeNamespace('sync') }
function Screen() {
  if (page === 'products') return <HposMenu />
  if (page === 'stock') return <HposStock />
  if (page === 'cash') return <HposCashClose />
  if (page === 'my-cashup') return <HposMyCashup />
  if (page === 'my-sales') return <HposMySales />
  if (page === 'sale-correction') return <HposReports correctionMode />
  if (page === 'tabs') return <HposOpenChecks />
  if (page === 'manage') return <HposManageHub />
  if (page === 'shift') return <HposMyShift />
  if (page === 'reports') return <HposReports />
  if (page === 'customers') return <HposCustomers />
  if (page === 'expenses') return <HposExpenses />
  return <HposTerminal />
}
const currentUser = ['sell', 'my-cashup', 'my-sales', 'sale-correction'].includes(page) ? { ...STAFF2, role: 'cashier' } : STAFF
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{ user: currentUser }}><SettingsContext.Provider value={{ settings }}><AccessContext.Provider value={access}><FeaturesContext.Provider value={{}}><MemoryRouter initialEntries={[`/hpos/${page === 'sell' || page === 'unlock' ? 'pos' : page === 'tabs' ? 'checks' : page}`]}><Routes><Route element={<HposLayout />}><Route path='*' element={<Screen />} /></Route></Routes></MemoryRouter></FeaturesContext.Provider></AccessContext.Provider></SettingsContext.Provider></AuthContext.Provider>)
