import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { getDesktopNavItems } = await import('../src/renderer/src/navigation/desktopNav.js')
const { isRestaurantOnly } = await import('../src/shared/propertyTypes.js')

const posUi = await readFile(new URL('../src/renderer/src/components/POS.jsx', import.meta.url), 'utf8')
const dashboardUi = await readFile(new URL('../src/renderer/src/components/Dashboard.jsx', import.meta.url), 'utf8')
const staffUi = await readFile(new URL('../src/renderer/src/components/Staff.jsx', import.meta.url), 'utf8')

const fullAccess = {
  allowedByRole: new Proxy({}, { get: () => true })
}

const enabledEnterpriseAddons = [
  'corporate_accounts',
  'rate_plans',
  'payment_gateway',
  'channel_manager',
  'guest_messaging',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'advanced_reports',
  'multi_outlet_pos',
  'guest_crm',
  'operations_compliance',
  'documents',
  'hotel_roles',
  'advanced_booking_engine',
  'room_attributes'
]

function restaurantLabels() {
  return getDesktopNavItems('restaurant', fullAccess, 'restaurant', 'Pro', [])
    .map((item) => item.label)
}

function lodgeLabels() {
  return getDesktopNavItems('lodge', fullAccess, 'lodge', 'Pro', [])
    .map((item) => item.label)
}

function hotelLabels() {
  return getDesktopNavItems('lodge', fullAccess, 'hotel', 'Enterprise', enabledEnterpriseAddons)
    .map((item) => item.label)
}

test('isRestaurantOnly identifies restaurant property type', () => {
  assert.equal(isRestaurantOnly('restaurant'), true)
  assert.equal(isRestaurantOnly('pos_only'), true)
  assert.equal(isRestaurantOnly('lodge'), false)
  assert.equal(isRestaurantOnly('hotel'), false)
  assert.equal(isRestaurantOnly('guest_house'), false)
})

test('restaurant + Pro nav includes required restaurant modules', () => {
  const labels = restaurantLabels()

  for (const requiredLabel of [
    'Dashboard',
    'POS',
    'Inventory',
    'Reports',
    'Expenses',
    'Staff',
    'Settings'
  ]) {
    assert.equal(labels.includes(requiredLabel), true, `${requiredLabel} should be visible in restaurant mode`)
  }
})

test('restaurant navigation uses consolidated workspaces', () => {
  const labels = restaurantLabels()
  for (const label of ['Floor & Service', 'Kitchen', 'Menu & Production', 'Stock & Purchasing', 'Team', 'Cash & Close', 'Control']) {
    assert.equal(labels.includes(label), true, `${label} should be visible in restaurant mode`)
  }
})

test('restaurant navigation does not expose duplicate low-frequency pages', () => {
  const labels = restaurantLabels()
  for (const label of ['Tables', 'Kitchen Display', 'Menu & Modifiers', 'Recipes & Costing', 'Stock Control', 'Purchasing', 'Shifts', 'Cash Drawer', 'Daily Close', 'Checklists', 'Alerts', 'Owner Digest', 'Reservations', 'Combos', 'Recipe Variance', 'Prep Batches', 'Purchase Suggestions', 'Staff Performance', 'Kitchen Analytics']) {
    assert.equal(labels.includes(label), false, `${label} should be represented inside a workspace`)
  }
})

test('restaurant + Pro nav excludes accommodation modules', () => {
  const labels = restaurantLabels()

  for (const hiddenLabel of [
    'Bookings',
    'Rooms',
    'Guests',
    'Housekeeping',
    'Maintenance',
    'Folios',
    'Hotel Dashboard',
    'Hotel KPIs',
    'Channel Manager',
    'Rate Plans',
    'Guest Portal',
    'Guest CRM',
    'Conference',
    'Day Use',
    'Room Board',
    'Planning',
    'Quotations',
    'Invoices',
    'Prepayments',
    'Room Supplies',
    'Room Moves',
    'Corporate Accounts',
    'Events & Venues'
  ]) {
    assert.equal(labels.includes(hiddenLabel), false, `${hiddenLabel} should NOT appear in restaurant mode sidebar`)
  }
})

test('lodge + Pro still includes accommodation navigation', () => {
  const labels = lodgeLabels()

  for (const requiredLabel of [
    'Dashboard',
    'Bookings',
    'Rooms',
    'Guests',
    'Reports',
    'Expenses',
    'Staff',
    'Settings'
  ]) {
    assert.equal(labels.includes(requiredLabel), true, `${requiredLabel} should be visible in lodge mode`)
  }
})

test('hotel + Enterprise includes hotel modules when entitled', () => {
  const labels = hotelLabels()

  for (const requiredLabel of [
    'Dashboard',
    'Bookings',
    'Rooms',
    'Guests',
    'Housekeeping',
    'Maintenance',
    'Folios',
    'Rate Plans',
    'Channel Manager',
    'Guest Portal'
  ]) {
    assert.equal(labels.includes(requiredLabel), true, `${requiredLabel} should be visible in hotel + Enterprise mode`)
  }
})

test('restaurant mode navigation has no Front Desk or Property groups', () => {
  const items = getDesktopNavItems('restaurant', fullAccess, 'restaurant', 'Pro', [])
  const groups = [...new Set(items.map((item) => item.group).filter(Boolean))]

  assert.equal(groups.includes('Front Desk'), false, 'Front Desk group should not exist in restaurant mode')
  assert.equal(groups.includes('Property'), false, 'Property group should not exist in restaurant mode')
})

test('restaurant mode has Finance group with restaurant-relevant items', () => {
  const items = getDesktopNavItems('restaurant', fullAccess, 'restaurant', 'Pro', [])
  const financeItems = items.filter((item) => item.group === 'Finance').map((item) => item.label)

  assert.ok(financeItems.includes('Expenses'), 'Expenses should be in Finance group')
  assert.ok(financeItems.includes('Reports'), 'Reports should be in Finance group')
  assert.ok(financeItems.includes('POS'), 'POS should be in Finance group')
  assert.ok(financeItems.includes('Inventory'), 'Inventory should be in Finance group')
})

test('restaurant mode has Team group with Staff', () => {
  const items = getDesktopNavItems('restaurant', fullAccess, 'restaurant', 'Pro', [])
  const teamItems = items.filter((item) => item.group === 'Team').map((item) => item.label)

  assert.ok(teamItems.includes('Staff'), 'Staff should be in Team group')
})

test('POS.jsx has restaurantMode guard for room/booking/folio paths', () => {
  // Must import isRestaurantOnly
  assert.match(posUi, /import.*isRestaurantOnly.*from.*propertyTypes/)
  // Must compute restaurantMode
  assert.match(posUi, /const restaurantMode = isRestaurantOnly\(propertyType\)/)
  // Room service mode button must be conditional on !restaurantMode (restaurant gets delivery instead)
  assert.match(posUi, /restaurantMode \? \['takeaway', 'table', 'delivery'\] : \['takeaway', 'table', 'room'\]/)
  // Charge to Room button must be conditional
  assert.match(posUi, /\!restaurantMode &&/)
  // Server-side guard must exist in createPosOrder
})

test('POS.jsx does not render room/booking/folio UI unconditionally in restaurant mode', () => {
  // The "Charge to Room" and "Event Folio" buttons must be wrapped in {!restaurantMode && ...}
  const customerTypeIdx = posUi.indexOf('{/* Customer type */}')
  const customerTypeSection = posUi.slice(customerTypeIdx, customerTypeIdx + 800)
  assert.match(customerTypeSection, /\!restaurantMode/, 'Charge to Room must be guarded by !restaurantMode')
})

test('POS.jsx uses restaurant-safe terminology', () => {
  // Customer name placeholder should be used in restaurant mode
  assert.match(posUi, /restaurantMode \? "Customer name/,'Customer name placeholder must be restaurant-aware')
})

test('Dashboard.jsx has restaurantMode guards for accommodation sections', () => {
  // Must import isRestaurantOnly
  assert.match(dashboardUi, /import.*isRestaurantOnly/)
  // Must compute restaurantMode
  assert.match(dashboardUi, /const restaurantMode = isRestaurantOnly\(propertyType\)/)
  // Booking Cash Today must be guarded
  assert.match(dashboardUi, /\!restaurantMode && paymentMixToday/)
  // Balance Collection Queue must be guarded
  assert.match(dashboardUi, /\!restaurantMode && overdueBalances/)
  // Day Use Follow-up must be guarded
  assert.match(dashboardUi, /\!restaurantMode && dayUseCollectionQueue/)
  // Occupancy Forecast must be guarded
  assert.match(dashboardUi, /\!restaurantMode && forecast/)
})

test('Dashboard.jsx Recent Bookings and Upcoming Check-ins are guarded in restaurant mode', () => {
  // The grid containing Recent Bookings and Upcoming Check-ins must be wrapped
  assert.match(dashboardUi, /\{!restaurantMode && \(\s*<div className="grid grid-cols-1 gap-6 xl:grid-cols-5">/)
})

test('Dashboard.jsx skips loading accommodation data in restaurant mode', () => {
  assert.match(dashboardUi, /const accomCalls = restaurantMode \? \[\] : \[/)
  assert.match(dashboardUi, /const restaurantCalls = restaurantMode \?/)
  assert.match(dashboardUi, /const \[s, ls, paymentMix, lodgeRequests, users, usage, backups, \.\.\.restResults\]/)
})

test('Dashboard.jsx defines restaurant dashboard counts before card arrays use them', () => {
  const openTableDefinition = dashboardUi.indexOf('const openTableCount =')
  const pendingTicketDefinition = dashboardUi.indexOf('const pendingTicketCount =')
  const drawerOpenDefinition = dashboardUi.indexOf('const drawerOpen =')
  const todayQueueDefinition = dashboardUi.indexOf('const todayQueue =')

  assert.ok(openTableDefinition > -1, 'openTableCount should be defined')
  assert.ok(pendingTicketDefinition > -1, 'pendingTicketCount should be defined')
  assert.ok(drawerOpenDefinition > -1, 'drawerOpen should be defined')
  assert.ok(todayQueueDefinition > -1, 'todayQueue should be defined')
  assert.ok(openTableDefinition < todayQueueDefinition, 'openTableCount must be initialized before todayQueue')
  assert.ok(pendingTicketDefinition < todayQueueDefinition, 'pendingTicketCount must be initialized before todayQueue')
  assert.ok(drawerOpenDefinition < todayQueueDefinition, 'drawerOpen must be initialized before todayQueue')
})

test('Staff.jsx defines restaurant labels inside StaffMembers', () => {
  const staffMembersStart = staffUi.indexOf('function StaffMembers()')
  const staffMembersEnd = staffUi.indexOf('const [users, setUsers]', staffMembersStart)
  const setupBlock = staffUi.slice(staffMembersStart, staffMembersEnd)

  assert.match(setupBlock, /const propertyType = settings\?\.property_type \|\| settings\?\.business_type \|\| 'lodge'/)
  assert.match(setupBlock, /const restaurantMode = isRestaurantOnly\(propertyType\)/)
  assert.match(setupBlock, /const propertyLabel = restaurantMode \? 'restaurant' : 'lodge'/)
})

test('Dashboard.jsx Online Booking Requests section is guarded', () => {
  assert.match(dashboardUi, /\!restaurantMode && onlineRequests\.length > 0/)
})

test('Dashboard.jsx Running Specials section is guarded', () => {
  assert.match(dashboardUi, /\!restaurantMode && \(\s*<section className="bb-card p-5">[\s\S]*?Running Specials/)
})

test('Dashboard.jsx restaurant cockpit has 8 command-center cards', () => {
  const cardLabels = [
    'Today Sales', 'Open Tables', 'Kitchen Pending', 'Cash Drawer',
    'Low Stock', 'Staff On Shift', 'Alerts', 'Daily Close'
  ]
  for (const label of cardLabels) {
    assert.ok(dashboardUi.includes(`'${label}'`), `Cockpit card "${label}" should exist in restaurant dashboard`)
  }
})

test('Dashboard.jsx restaurant shortcuts use consolidated workspaces', () => {
  const requiredModules = [
    '/restaurant/floor', '/restaurant/kitchen-workspace', '/restaurant/menu-production',
    '/restaurant/stock-purchasing', '/restaurant/team', '/restaurant/cash-close',
    '/restaurant/customers', '/restaurant/control'
  ]
  for (const route of requiredModules) {
    assert.ok(dashboardUi.includes(`'${route}'`), `Dashboard shortcuts should include route ${route}`)
  }
})

test('Dashboard.jsx restaurant loads POS operations data', () => {
  assert.match(dashboardUi, /const restaurantCalls = restaurantMode \?/)
  assert.match(dashboardUi, /getTablesWithStatus/)
  assert.match(dashboardUi, /getTickets/)
  assert.match(dashboardUi, /getActiveShifts/)
  assert.match(dashboardUi, /getOpenCashDrawer/)
  assert.match(dashboardUi, /getActiveAlerts/)
})

test('Dashboard.jsx restaurant onboarding has more than 3 actions', () => {
  const onboardingIdx = dashboardUi.indexOf('const onboardingActions = restaurantMode')
  const onboardingSection = dashboardUi.slice(onboardingIdx, onboardingIdx + 2000)
  assert.ok(onboardingSection.includes("'tables'"), 'Onboarding should include tables setup')
  assert.ok(onboardingSection.includes("'menu'"), 'Onboarding should include menu setup')
  assert.ok(onboardingSection.includes("'recipes'"), 'Onboarding should include recipes setup')
  assert.ok(onboardingSection.includes("'staff'"), 'Onboarding should include staff setup')
})

test('Dashboard.jsx restaurant cockpit grid supports 8 cards', () => {
  assert.match(dashboardUi, /grid grid-cols-2 gap-3 lg:grid-cols-4/)
})

test('POS.jsx restaurant mode keeps Setup focused on device configuration', () => {
  assert.match(posUi, /restaurantMode && \([\s\S]*?POS setup is for device configuration/)
  assert.match(posUi, /restaurantMode \? \[\s*\['displays', 'Displays'\],\s*\['hardware', 'Hardware'\]/)
})

test('POS.jsx restaurant standalone sections have blue notes', () => {
  const standaloneSections = ['staff', 'cashdrawer', 'suppliers', 'checklist', 'alerts', 'digest', 'recipes']
  for (const section of standaloneSections) {
    const sectionRegex = new RegExp(`setupSection === '${section}'[\\s\\S]*?Also available at`)
    assert.match(posUi, sectionRegex, `${section} section should have a standalone module note`)
  }
})

test('Reports.jsx restaurant tabs hide bookings/prepayments/hotel KPIs', async () => {
  const reportsPath = new URL('../src/renderer/src/components/Reports.jsx', import.meta.url)
  const reportsUi = await readFile(reportsPath, 'utf8')
  assert.match(reportsUi, /const restaurantTabs = useMemo/)
  assert.match(reportsUi, /restaurantMode \? restaurantTabs : accommodationTabs/)
})

test('Settings.jsx hides booking emails and online booking site in restaurant mode', async () => {
  const settingsPath = new URL('../src/renderer/src/components/Settings.jsx', import.meta.url)
  const settingsUi = await readFile(settingsPath, 'utf8')
  assert.match(settingsUi, /\{!restaurantMode && \([\s\S]*?auto_send_booking_confirmation/)
  assert.match(settingsUi, /\{!restaurantMode && \([\s\S]*?Online Booking Site/)
})

test('Expenses.jsx has separate restaurant and lodge categories', async () => {
  const expensesPath = new URL('../src/renderer/src/components/Expenses.jsx', import.meta.url)
  const expensesUi = await readFile(expensesPath, 'utf8')
  assert.match(expensesUi, /const RESTAURANT_CATEGORIES/)
  assert.match(expensesUi, /const LODGE_CATEGORIES/)
  assert.match(expensesUi, /restaurantMode \? RESTAURANT_CATEGORIES : LODGE_CATEGORIES/)
})

test('Staff.jsx uses restaurant-appropriate default role', () => {
  assert.match(staffUi, /restaurantMode \? 'cashier' : 'receptionist'/)
})

test('DataManagement.jsx has restaurant-specific tabs', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  assert.match(dmUi, /const RESTAURANT_TABS/)
  assert.match(dmUi, /restaurantMode \? RESTAURANT_TABS : LODGE_TABS/)
})

test('DataManagement.jsx imports and uses isRestaurantOnly', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  assert.match(dmUi, /import.*isRestaurantOnly.*from/)
  assert.match(dmUi, /const restaurantMode = isRestaurantOnly\(propertyType\)/)
})

test('DataManagement.jsx restaurant export presets have 7 entries', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  const presetKeys = ['restaurant_full', 'restaurant_dailyClose', 'restaurant_sales', 'restaurant_stock', 'restaurant_purchasing', 'restaurant_staff', 'restaurant_customers']
  for (const key of presetKeys) {
    assert.ok(dmUi.includes(`key: '${key}'`), `RESTAURANT_EXPORT_PRESETS should include ${key}`)
  }
})

test('DataManagement.jsx restaurant presets do not include booking/guest/room sections', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  const restaurantPresetBlock = dmUi.slice(dmUi.indexOf('RESTAURANT_EXPORT_PRESETS'), dmUi.indexOf('LODGE_EXPORT_SECTIONS'))
  assert.doesNotMatch(restaurantPresetBlock, /bookingGuest/, 'Restaurant presets should not include bookingGuest')
  assert.doesNotMatch(restaurantPresetBlock, /bookings.*guests.*quotations/, 'Restaurant presets should not include booking/guest sections')
})

test('DataManagement.jsx restaurant export sections include all required categories', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  const sections = ['POS Sales', 'Expenses', 'Inventory', 'Recipes', 'Staff', 'Shifts', 'Cash Drawer', 'Purchasing', 'Customers', 'Alerts', 'Checklists']
  for (const section of sections) {
    assert.ok(dmUi.includes(`'${section}'`), `RESTAURANT_EXPORT_SECTIONS should include "${section}"`)
  }
})

test('DataManagement.jsx restaurant export sections do not include lodge-specific items', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  const restaurantSectionBlock = dmUi.slice(dmUi.indexOf('RESTAURANT_EXPORT_SECTIONS'), dmUi.indexOf('function ExportTab'))
  assert.doesNotMatch(restaurantSectionBlock, /Bookings/, 'Restaurant sections should not include Bookings')
  assert.doesNotMatch(restaurantSectionBlock, /Guests/, 'Restaurant sections should not include Guests')
  assert.doesNotMatch(restaurantSectionBlock, /Rooms/, 'Restaurant sections should not include Rooms')
  assert.doesNotMatch(restaurantSectionBlock, /Quotations/, 'Restaurant sections should not include Quotations')
})

test('DataManagement.jsx privacy mode says customer in restaurant mode', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  assert.match(dmUi, /restaurantMode \? 'customer' : 'guest'/)
})

test('DataImport.jsx imports isRestaurantOnly and useSettings', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  assert.match(diUi, /import.*isRestaurantOnly.*from/)
  assert.match(diUi, /import.*useSettings.*from/)
})

test('DataImport.jsx has restaurant-specific IMPORT_FIELD_SETS', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  const restaurantTypes = ['menu_items', 'customers', 'ingredients', 'recipes', 'suppliers', 'staff']
  for (const type of restaurantTypes) {
    assert.ok(diUi.includes(`${type}:`), `IMPORT_FIELD_SETS should include ${type}`)
  }
})

test('DataImport.jsx filters import types based on restaurantMode', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  assert.ok(diUi.includes('LODGE_ONLY_TYPES'), 'Should define LODGE_ONLY_TYPES')
  assert.ok(diUi.includes('RESTAURANT_TYPES'), 'Should define RESTAURANT_TYPES')
  assert.ok(diUi.includes('restaurantMode') && diUi.includes('RESTAURANT_TYPES'), 'Should filter types based on restaurantMode')
})

test('DataImport.jsx restaurant header says Restaurant Data Import', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  assert.ok(diUi.includes('Restaurant Data Import'), 'Should have restaurant-specific header')
})

test('DataImport.jsx undo confirmation is restaurant-aware', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  assert.match(diUi, /restaurantMode[\s\S]*?permanently delete all imported records/)
})

test('DataImport.jsx restaurant tips do not mention room numbers', async () => {
  const diPath = new URL('../src/renderer/src/components/DataImport.jsx', import.meta.url)
  const diUi = await readFile(diPath, 'utf8')
  const tipsBlock = diUi.slice(diUi.indexOf('Tips for best results'))
  assert.ok(tipsBlock.includes('restaurantMode'), 'Tips section should be restaurant-aware')
})

test('Backend EXPORT_PRESETS includes restaurant presets', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  const restaurantPresetKeys = ['restaurant_full', 'restaurant_dailyClose', 'restaurant_sales', 'restaurant_stock', 'restaurant_purchasing', 'restaurant_staff', 'restaurant_customers']
  for (const key of restaurantPresetKeys) {
    assert.ok(indexUi.includes(`${key}:`), `EXPORT_PRESETS should include ${key}`)
  }
})

test('Backend EXPORT_SECTION_LABELS includes restaurant sections', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  const restaurantSections = ['menuItems', 'recipes', 'suppliers', 'purchaseOrders', 'stockMovements', 'shifts', 'cashDrawerSessions', 'checklists', 'alerts']
  for (const section of restaurantSections) {
    assert.ok(indexUi.includes(`${section}:`), `EXPORT_SECTION_LABELS should include ${section}`)
  }
})

test('Backend collectFullExportData fetches restaurant data', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  const restaurantDataVars = ['menuItems', 'recipes', 'suppliers', 'purchaseOrders', 'stockMovements', 'shifts', 'cashDrawerSessions', 'checklists', 'alerts']
  for (const v of restaurantDataVars) {
    assert.ok(indexUi.includes(`const ${v} =`), `collectFullExportData should fetch ${v}`)
  }
})

test('Backend buildFullExportWorkbook creates restaurant sheets', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  const restaurantSheets = ['Menu Items', 'Recipes', 'Suppliers', 'Purchase Orders', 'Stock Movements', 'Shifts', 'Cash Drawer', 'Checklists', 'Alerts']
  for (const sheet of restaurantSheets) {
    assert.ok(indexUi.includes(`'${sheet}'`), `buildFullExportWorkbook should create "${sheet}" sheet`)
  }
})

test('Backend misc.js has restaurant import types', async () => {
  const miscPath = new URL('../src/main/domains/misc.js', import.meta.url)
  const miscUi = await readFile(miscPath, 'utf8')
  const restaurantTypes = ['menu_items', 'customers', 'ingredients', 'recipes', 'suppliers', 'staff']
  for (const type of restaurantTypes) {
    assert.ok(miscUi.includes(`key: '${type}'`), `getSupportedImportTypes should include ${type}`)
  }
})

test('Backend misc.js IMPORT_TEMPLATES has restaurant templates', async () => {
  const miscPath = new URL('../src/main/domains/misc.js', import.meta.url)
  const miscUi = await readFile(miscPath, 'utf8')
  const restaurantTemplates = ['menu_items', 'customers', 'ingredients', 'recipes', 'suppliers', 'staff']
  for (const t of restaurantTemplates) {
    assert.ok(miscUi.includes(`${t}:`), `IMPORT_TEMPLATES should include ${t}`)
  }
})

test('Backend downloadTemplate has restaurant sample data', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  assert.ok(indexUi.includes("'Classic Burger'"), 'Template sample should include Classic Burger')
  assert.ok(indexUi.includes("'Beef Patty'"), 'Template sample should include Beef Patty')
  assert.ok(indexUi.includes("'Fresh Farms'"), 'Template sample should include Fresh Farms')
  assert.ok(indexUi.includes("'Neo Dube'"), 'Template sample should include Neo Dube')
})

test('Lodge mode bookings template still available', async () => {
  const miscPath = new URL('../src/main/domains/misc.js', import.meta.url)
  const miscUi = await readFile(miscPath, 'utf8')
  assert.ok(miscUi.includes("key: 'bookings'"), 'Lodge bookings import type should still exist')
  assert.ok(miscUi.includes("key: 'guests'"), 'Lodge guests import type should still exist')
  assert.ok(miscUi.includes("key: 'rooms'"), 'Lodge rooms import type should still exist')
})

test('Lodge EXPORT_PRESETS still includes bookingGuest', async () => {
  const indexPath = new URL('../src/main/index.js', import.meta.url)
  const indexUi = await readFile(indexPath, 'utf8')
  assert.ok(indexUi.includes('bookingGuest:'), 'Lodge bookingGuest preset should still exist')
})

test('DataManagement.jsx export tab description is restaurant-aware', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  assert.match(dmUi, /restaurantMode \? 'restaurant' : 'lodge'/)
})

test('DataManagement.jsx backup description is restaurant-aware', async () => {
  const dmPath = new URL('../src/renderer/src/components/DataManagement.jsx', import.meta.url)
  const dmUi = await readFile(dmPath, 'utf8')
  assert.match(dmUi, /restaurantMode \? 'restaurant' : 'lodge'/)
  assert.match(dmUi, /restaurantMode \? 'sales, stock, and operational' : 'transactions, guests, and operational'/)
})
