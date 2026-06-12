import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'marketing-site', 'assets', 'screenshots')

const pwaBase = process.env.PWA_URL || 'http://127.0.0.1:5174'
const bookingBase = process.env.BOOKING_URL || 'http://127.0.0.1:5175'
const mediaBase = process.env.MEDIA_URL || 'http://127.0.0.1:4173'
const desktopBase = process.env.DESKTOP_RENDERER_URL || 'http://127.0.0.1:5176'

const lodgeId = '00000000-0000-4000-8000-000000000001'
const today = new Date()
const iso = (offset) => {
  const value = new Date(today)
  value.setDate(value.getDate() + offset)
  return value.toISOString().slice(0, 10)
}

const rooms = [
  { id: 'r1', lodge_id: lodgeId, room_number: '101', room_type: 'Garden Suite', rate_per_night: 920, max_occupancy: 2, housekeeping_status: 'clean' },
  { id: 'r2', lodge_id: lodgeId, room_number: '102', room_type: 'Family Room', rate_per_night: 1250, max_occupancy: 4, housekeeping_status: 'dirty' },
  { id: 'r3', lodge_id: lodgeId, room_number: '103', room_type: 'Executive Room', rate_per_night: 1100, max_occupancy: 2, housekeeping_status: 'clean' },
  { id: 'r4', lodge_id: lodgeId, room_number: '104', room_type: 'Twin Room', rate_per_night: 780, max_occupancy: 2, housekeeping_status: 'in_progress' },
  { id: 'r5', lodge_id: lodgeId, room_number: '105', room_type: 'Poolside Chalet', rate_per_night: 1450, max_occupancy: 3, housekeeping_status: 'clean' },
  { id: 'r6', lodge_id: lodgeId, room_number: '106', room_type: 'Standard Room', rate_per_night: 680, max_occupancy: 2, housekeeping_status: 'out_of_service' }
]

const bookings = [
  { id: 'b1', lodge_id: lodgeId, room_id: 'r1', guest_name: 'Naledi M.', customer_name: 'Naledi M.', room_number: '101', room_type: 'Garden Suite', guests: 2, check_in: iso(0), check_out: iso(2), total_amount: 1840, amount_paid: 920, charges_total: 280, payment_status: 'partial', status: 'checked_in', source: 'front_desk' },
  { id: 'b2', lodge_id: lodgeId, room_id: 'r2', guest_name: 'Kabelo Family', customer_name: 'Kabelo Family', room_number: '102', room_type: 'Family Room', guests: 4, check_in: iso(0), check_out: iso(3), total_amount: 3750, amount_paid: 0, charges_total: 0, payment_status: 'unpaid', status: 'confirmed', source: 'front_desk' },
  { id: 'b3', lodge_id: lodgeId, room_id: 'r3', guest_name: 'Amantle P.', customer_name: 'Amantle P.', room_number: '103', room_type: 'Executive Room', guests: 1, check_in: iso(-3), check_out: iso(-1), total_amount: 2200, amount_paid: 1100, charges_total: 430, payment_status: 'partial', status: 'checked_in', source: 'front_desk' },
  { id: 'b4', lodge_id: lodgeId, room_id: 'r5', guest_name: 'Thato S.', customer_name: 'Thato S.', room_number: '105', room_type: 'Poolside Chalet', guests: 2, check_in: iso(1), check_out: iso(4), total_amount: 4350, amount_paid: 1500, charges_total: 0, payment_status: 'partial', status: 'pending', source: 'online' },
  { id: 'b5', lodge_id: lodgeId, room_id: 'r4', guest_name: 'Mpho & Neo', customer_name: 'Mpho & Neo', room_number: '104', room_type: 'Twin Room', guests: 2, check_in: iso(2), check_out: iso(5), total_amount: 2340, amount_paid: 2340, charges_total: 160, payment_status: 'paid', status: 'confirmed', source: 'front_desk' }
]

const maintenance = [
  { id: 'm1', room_id: 'r3', title: 'Aircon needs checking', issue: 'Aircon needs checking', status: 'open', priority: 'urgent', created_at: new Date().toISOString() },
  { id: 'm2', room_id: 'r6', title: 'Shower pressure low', issue: 'Shower pressure low', status: 'open', priority: 'medium', created_at: new Date().toISOString() }
]

const invoices = [
  { invoice_number: 'INV-1042', customer_name: 'Naledi M.', booking_id: 'b1', total_amount: 2120, balance_due: 1200, payment_status: 'partial', issued_at: new Date().toISOString() },
  { invoice_number: 'INV-1043', customer_name: 'Amantle P.', booking_id: 'b3', total_amount: 2630, balance_due: 1530, payment_status: 'partial', issued_at: new Date().toISOString() },
  { invoice_number: 'INV-1044', customer_name: 'Kabelo Family', booking_id: 'b2', total_amount: 3750, balance_due: 3750, payment_status: 'unpaid', issued_at: new Date().toISOString() }
]

const expenses = [
  { id: 'e1', category: 'Kitchen supplies', description: 'Breakfast stock top-up', amount: 680, date: iso(0) },
  { id: 'e2', category: 'Maintenance', description: 'Plumbing repair callout', amount: 420, date: iso(0) },
  { id: 'e3', category: 'Laundry', description: 'Linen service', amount: 310, date: iso(-1) }
]

const inventory = [
  { id: 'i1', name: 'Still water 500ml', category: 'Bar', current_stock: 11, reorder_level: 24 },
  { id: 'i2', name: 'Bath towels', category: 'Rooms', current_stock: 8, reorder_level: 18 },
  { id: 'i3', name: 'Breakfast coffee', category: 'Kitchen', current_stock: 4, reorder_level: 8 }
]

const customers = [
  { id: 'c1', name: 'Naledi M.', phone: '+267 71 234 567', email: 'naledi@example.com', nationality: 'Botswana', id_number: 'BN123456' },
  { id: 'c2', name: 'Kabelo Family', phone: '+267 72 345 678', email: 'kabelo@example.com', nationality: 'Botswana', id_number: 'BN654321' },
  { id: 'c3', name: 'Amantle P.', phone: '+267 73 456 789', email: 'amantle@example.com', nationality: 'Botswana', id_number: 'BN789012' }
]

const outlets = [
  { id: 'front-desk', name: 'Front Desk', type: 'accommodation' },
  { id: 'kitchen', name: 'Kitchen', type: 'food' },
  { id: 'bar', name: 'Bar', type: 'beverage' }
]

const menuItems = [
  { id: 'mi1', name: 'English Breakfast', category: 'Food', price: 95, outlet_id: 'kitchen', is_available: true },
  { id: 'mi2', name: 'Grilled Chicken Basket', category: 'Food', price: 145, outlet_id: 'kitchen', is_available: true },
  { id: 'mi3', name: 'Still Water 500ml', category: 'Drinks', price: 18, outlet_id: 'bar', inventory_item_id: 'i1', depletion_qty: 1, is_available: true },
  { id: 'mi4', name: 'House Coffee', category: 'Drinks', price: 32, outlet_id: 'kitchen', inventory_item_id: 'i3', depletion_qty: 1, is_available: true }
]

const dashboard = {
  occupancyPercent: 50,
  occupied: 3,
  totalRooms: 6,
  outstandingTotal: 6480,
  openMaintenanceCount: 2,
  urgentMaintenanceCount: 1,
  lowStockCount: 3,
  unpaidCount: 3,
  topBalances: invoices.map((invoice) => ({
    id: invoice.booking_id,
    guest_name: invoice.customer_name,
    balance: invoice.balance_due,
    check_in: iso(0)
  })),
  lowStock: inventory,
  source: 'marketing-demo'
}

const desktopSettings = {
  lodge_id: lodgeId,
  lodge_name: 'Safari Sands Lodge',
  company_name: 'Safari Sands Lodge',
  currency: 'P',
  subscription_plan: 'Pro',
  room_count: rooms.length,
  city: 'Maun',
  country: 'Botswana',
  email: 'reservations@safarisands.example',
  phone: '+267 72 789 415'
}

function desktopStats() {
  return {
    arrivals_today: 2,
    departures_today: 1,
    online_requests: 1,
    outstanding_balance: 6480,
    low_stock_count: inventory.length,
    cash_today: 4160,
    occupancy_rate: 50,
    occupied_rooms: 3,
    total_rooms: rooms.length,
    upcoming_bookings: 5,
    plan: 'Pro'
  }
}

function reportRows() {
  return [
    { date: iso(0), bookings: 4, revenue: 4160, occupancy: 50 },
    { date: iso(-1), bookings: 3, revenue: 3720, occupancy: 66 },
    { date: iso(-2), bookings: 5, revenue: 5980, occupancy: 83 }
  ]
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff'
  }[ext] || 'application/octet-stream'
}

function startStaticServer(staticRoot, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      let filePath = path.join(staticRoot, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname))
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(staticRoot, 'index.html')
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        res.writeHead(200, { 'Content-Type': mimeType(filePath) })
        res.end(data)
      })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
    server.on('error', reject)
  })
}

function cacheEntry(data) {
  return JSON.stringify({ updatedAt: new Date().toISOString(), data })
}

function scoped(prefix, key) {
  return `${prefix}:${lodgeId}:${key}`
}

async function preparePwa(page) {
  await page.route('https://**/*', (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/rpc/get_lodge_entitlement')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          status: 'active',
          expired: false,
          plan: 'Pro',
          lodge_id: lodgeId,
          lodge_name: 'Safari Sands Lodge',
          effective_features: {
            reports: true,
            expenses: true,
            staff: true,
            pwa: true,
            audit: true,
            conference: true,
            pool: true,
            import: true,
            pos: true,
            inventory: true,
            supplies: true
          }
        })
      })
    }
    if (url.includes('/rest/v1/rpc/refresh_pwa_app_session') || url.includes('/rest/v1/rpc/validate_app_session')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'manager-demo',
          name: 'Boitumelo Manager',
          email: 'manager@example.com',
          role: 'admin',
          lodge_id: lodgeId,
          lodge_display_name: 'Safari Sands Lodge',
          pwa_enabled: true,
          pwa_feature_enabled: true,
          plan: 'Pro',
          session_token: 'demo-token',
          session_expires_at: new Date(Date.now() + 86400000).toISOString()
        })
      })
    }
    if (url.includes('/rest/v1/rpc/get_manager_dashboard_snapshot')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) })
    }
    if (url.includes('/rest/v1/rpc/get_invoice_summary')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invoices) })
    }
    if (url.includes('/rest/v1/rpc/get_night_audit_summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ gross_collected: 4160, pos_revenue: 980, outstanding_total: 6480 })
      })
    }
    if (url.includes('/rest/v1/rpc/get_lodge_support_tickets')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    }
    if (url.includes('/rest/v1/bookings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bookings) })
    }
    if (url.includes('/rest/v1/rooms')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rooms) })
    }
    if (url.includes('/rest/v1/maintenance_tickets')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(maintenance) })
    }
    if (url.includes('/rest/v1/inventory_items')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inventory) })
    }
    if (url.includes('/rest/v1/quotations')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'q1', customer_name: 'Pula Tours', status: 'sent', total_amount: 5400 },
          { id: 'q2', customer_name: 'Corporate retreat', status: 'draft', total_amount: 8900 }
        ])
      })
    }
    if (url.includes('/rest/v1/expenses')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expenses) })
    }
    if (url.includes('/rest/v1/broadcasts') || url.includes('/rest/v1/rejected_online_bookings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    }
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline demo' }) })
  })

  await page.addInitScript(({ lodgeId, rooms, bookings, maintenance, invoices, expenses, inventory, dashboard }) => {
    const now = new Date().toISOString()
    const session = {
      id: 'manager-demo',
      name: 'Boitumelo Manager',
      email: 'manager@example.com',
      role: 'admin',
      lodge_id: lodgeId,
      lodge_display_name: 'Safari Sands Lodge',
      pwa_enabled: true,
      pwa_feature_enabled: true,
      plan: 'Pro',
      session_token: 'demo-token',
      session_expires_at: new Date(Date.now() + 86400000).toISOString(),
      trusted_device: true,
      trusted_until: new Date(Date.now() + 365 * 86400000).toISOString(),
      started_at: now
    }
    const features = {
      reports: true,
      expenses: true,
      staff: true,
      pwa: true,
      audit: true,
      conference: true,
      pool: true,
      import: true,
      pos: true,
      inventory: true,
      supplies: true
    }
    const entitlement = {
      success: true,
      status: 'active',
      expired: false,
      plan: 'Pro',
      lodge_id: lodgeId,
      lodge_name: 'Safari Sands Lodge',
      effective_features: features
    }
    const entry = (data) => JSON.stringify({ updatedAt: now, data })
    const key = (prefix, cacheKey) => `${prefix}:${lodgeId}:${cacheKey}`
    localStorage.setItem('boroko_pwa_theme', 'light')
    localStorage.setItem('boroko_manager_session', JSON.stringify(session))
    localStorage.setItem(key('boroko_pwa_cache', 'entitlement'), entry(entitlement))
    localStorage.setItem(key('boroko_pwa_cache', 'dashboard'), entry(dashboard))
    localStorage.setItem(key('boroko_pwa_cache', 'rooms'), entry(rooms))
    localStorage.setItem(key('boroko_pwa_cache', 'bookings'), entry(bookings))
    localStorage.setItem(key('boroko_pwa_cache', 'maintenance'), entry(maintenance))
    localStorage.setItem(key('boroko_pwa_cache', 'invoice_summary_v2'), entry(invoices))
    localStorage.setItem(key('boroko_pwa_cache', 'quotations'), entry([
      { id: 'q1', customer_name: 'Pula Tours', status: 'sent', total_amount: 5400 },
      { id: 'q2', customer_name: 'Corporate retreat', status: 'draft', total_amount: 8900 }
    ]))
    localStorage.setItem(key('boroko_pwa_cache', `expenses:${now.slice(0, 7)}-01:${now.slice(0, 10)}`), entry(expenses))
    localStorage.setItem(key('boroko_pwa_cache', 'inventory'), entry(inventory))
    localStorage.setItem(key('boroko_pwa_cache', `night_audit:${now.slice(0, 10)}`), entry({
      gross_collected: 4160,
      pos_revenue: 980,
      outstanding_total: 6480
    }))
  }, { lodgeId, rooms, bookings, maintenance, invoices, expenses, inventory, dashboard })
}

async function capturePwa(page, route, fileName) {
  await page.goto(`${pwaBase}/#${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 15000 })
  await page.waitForTimeout(2200)
  await page.screenshot({ path: path.join(outDir, fileName), fullPage: false })
}

async function prepareDesktop(page) {
  await page.addInitScript(({ lodgeId, rooms, bookings, maintenance, invoices, expenses, inventory, customers, outlets, menuItems, settings, reportData }) => {
    const user = {
      id: 'desktop-demo-user',
      name: 'Boitumelo Manager',
      email: 'manager@example.com',
      role: 'admin',
      lodge_id: lodgeId,
      isMasterAdmin: false,
      allowed_outlet_ids: null
    }
    const activeProfile = {
      lodge_id: lodgeId,
      lodge_name: settings.lodge_name,
      label: settings.lodge_name,
      status: 'ready',
      active: true
    }
    const entitlement = {
      status: 'active',
      plan: 'Pro',
      expired: false,
      daysLeft: 365,
      lodge_id: lodgeId,
      effective_features: {
        reports: true,
        expenses: true,
        staff: true,
        pwa: true,
        audit: true,
        conference: true,
        pool: true,
        import: true,
        pos: true,
        inventory: true,
        supplies: true
      }
    }
    const ok = (value) => Promise.resolve(value)
    const success = (data = null) => Promise.resolve({ success: true, data })
    const noOpUnsubscribe = () => () => {}
    const financialRows = [
      { category: 'Room revenue', amount: 4160 },
      { category: 'POS revenue', amount: 980 },
      { category: 'Outstanding balances', amount: 6480 }
    ]
    const reportSummary = {
      source: 'server',
      as_of: new Date().toISOString(),
      revenue: 4160,
      cash_collected: 4160,
      outstanding_total: 6480,
      occupancy: 50
    }
    const api = {
      app: { showTouchKeyboard: () => ok(null) },
      shell: { openExternal: () => ok(null) },
      updates: {
        getState: () => ok({ phase: 'uptodate' }),
        onAvailable: noOpUnsubscribe,
        onProgress: noOpUnsubscribe,
        onReady: noOpUnsubscribe,
        onError: noOpUnsubscribe,
        download: () => success(),
        check: () => success(),
        install: () => success()
      },
      auth: {
        restoreCurrentSession: () => ok({ success: true, user }),
        validateSession: () => ok({ success: true, user }),
        logout: () => success()
      },
      profiles: {
        list: () => ok([activeProfile]),
        getActive: () => ok(activeProfile),
        select: () => success(activeProfile),
        createDraft: () => success(activeProfile),
        removeDraft: () => success()
      },
      settings: { get: () => ok(settings), save: (value) => ok(value) },
      trial: { getStatus: () => ok(entitlement) },
      sync: {
        getStatus: () => ok({ isOnline: true, connected: true, pendingCount: 0, failedCount: 0, lastSyncAt: new Date().toISOString() }),
        onStatusChanged: noOpUnsubscribe,
        onBookingConflict: noOpUnsubscribe
      },
      mesh: { onConflictDetected: noOpUnsubscribe, lockRoom: () => success({ lockId: 'demo-lock' }), unlockRoom: () => success() },
      admin: { getActiveBroadcasts: () => ok([]), createSupportTicket: () => success() },
      dashboard: {
        stats: () => ok({
          arrivals_today: 2,
          departures_today: 1,
          online_requests: 1,
          balances_due: 6480,
          outstanding_balance: 6480,
          low_stock_count: inventory.length,
          cash_today: 4160,
          occupancy_rate: 50,
          occupied_rooms: 3,
          total_rooms: rooms.length,
          upcoming_bookings: 5,
          plan: 'Pro'
        }),
        forecast: () => ok(Array.from({ length: 30 }, (_, index) => ({
          date: new Date(Date.now() + index * 86400000).toISOString().slice(0, 10),
          occupancy: 45 + (index % 5) * 8,
          revenue: 1800 + index * 120
        }))),
        bookingPaymentsToday: () => ok({ total_collected: 4160, gross_collected: 4460, refunds_issued: 300, by_method: { Cash: 1200, Card: 2160, Mobile: 800 }, payment_count: 7, date: new Date().toISOString().slice(0, 10) })
      },
      notifications: { upcoming: () => ok({ today: bookings.slice(0, 2), tomorrow: bookings.slice(3, 4), dayAfter: bookings.slice(4, 5) }) },
      rooms: { getAll: () => ok(rooms), getCached: () => ok(rooms) },
      bookings: {
        getAll: () => ok(bookings),
        getCachedByDateRange: () => ok(bookings),
        getByDateRange: () => ok(bookings),
        getPendingOnline: () => ok(bookings.filter((booking) => booking.source === 'online')),
        getPayments: () => ok([{ id: 'pay1', amount: 920, payment_method: 'Card', created_at: new Date().toISOString() }]),
        updateStatus: () => success(),
        updatePayment: () => success(),
        refund: () => success()
      },
      customers: { getAll: () => ok(customers), getBookings: () => ok(bookings), create: (value) => success(value), update: (id, value) => success(value), updateIdPhoto: () => success(), updateBlacklist: () => success() },
      invoices: { getBookingInvoices: () => ok(invoices) },
      charges: { getByBooking: () => ok({ success: true, items: [] }), add: () => success(), delete: () => success() },
      outlets: { getAll: () => ok(outlets) },
      inventory: { getLowStock: () => ok(inventory), getItems: () => ok(inventory), getAll: () => ok(inventory) },
      expenses: { getAll: () => ok(expenses) },
      users: { getAll: () => ok([user, { id: 'u2', name: 'Front Desk', role: 'staff' }]) },
      rateOverrides: { getAll: () => ok([]), getApplicable: () => ok(null) },
      usage: { getSnapshot: () => ok({ plan: 'Pro', usage: { monthlyBookings: 18, rooms: rooms.length, users: 4 }, statuses: {}, recommendation: null }) },
      conference: { getAll: () => ok([]) },
      backup: { getInfo: () => ok({ enabled: true, lastBackupAt: new Date().toISOString() }) },
      requests: { getAll: () => ok([{ id: 'req1', title: 'Confirm online request', status: 'open', priority: 'high', created_at: new Date().toISOString(), messages: [] }]), addMessage: () => success() },
      reports: {
        occupancy: () => ok(reportData),
        revenue: () => ok(reportData),
        snapshot: () => ok(reportSummary),
        roomProfitability: () => ok(rooms.map((room) => ({ room_number: room.room_number, revenue: 1200, occupancy: 58, source: 'server' }))),
        maintenanceRows: () => ok(maintenance),
        posSales: () => ok(financialRows),
        inventorySpend: () => ok(financialRows),
        supplySpend: () => ok(financialRows),
        profitLoss: () => ok({ source: 'server', rows: financialRows, revenue: 4160, expenses: 1410, profit: 2750 }),
        outletProfitLoss: () => ok({ source: 'server', rows: financialRows }),
        financialAudit: () => ok([]),
        invoiceDeliveryHistory: () => ok([]),
        saveExcel: () => success(),
        savePDF: () => success(),
        criticalErrors: () => ok([])
      },
      pos: {
        getMenuItems: () => ok(menuItems),
        getOrders: () => ok([{ id: 'ord1', order_number: 'POS-1042', total_amount: 275, payment_method: 'Cash', status: 'paid', created_at: new Date().toISOString() }]),
        getVoidHistory: () => ok([]),
        getCashupSummary: () => ok({ by_method: { Cash: 1200, Card: 2160 }, total: 3360 }),
        getCashups: () => ok([]),
        getTabs: () => ok([]),
        getTickets: () => ok([]),
        getCurrentShift: () => ok({ id: 'shift1', opened_at: new Date().toISOString(), opening_float: 500 }),
        getHardwareSettings: () => ok({}),
        getStaff: () => ok([{ id: 'u1', name: 'Boitumelo Manager', role: 'admin' }]),
        getModifierGroups: () => ok([]),
        getPromotions: () => ok([]),
        getFloorLayout: () => ok({ areas: [] }),
        getAuditLog: () => ok([]),
        getTablesWithStatus: () => ok([]),
        getTables: () => ok([]),
        updateCustomerDisplay: () => ok(null),
        getActiveBookingForRoom: () => ok(bookings[0]),
        createOrder: () => success(),
        selectStaffWithPin: () => success({ id: 'u1', name: 'Boitumelo Manager' }),
        openShift: () => success(),
        closeShift: () => success()
      },
      receipts: { listPrinters: () => ok([]) }
    }
    window.localStorage.setItem('bb_user', JSON.stringify(user))
    window.localStorage.setItem('bb_user_scope', lodgeId)
    window.localStorage.setItem('boroko_theme_mode', 'light')
    window.api = api
  }, { lodgeId, rooms, bookings, maintenance, invoices, expenses, inventory, customers, outlets, menuItems, settings: desktopSettings, reportData: reportRows() })
}

async function captureDesktop(page, route, fileName) {
  await page.goto(`${desktopBase}/#${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 20000 })
  await page.waitForTimeout(2600)
  await page.screenshot({ path: path.join(outDir, fileName), fullPage: false })
}

function lodgeShell() {
  return {
    found: true,
    id: 'booking-demo-lodge',
    slug: 'safari-sands',
    lodge_name: 'Safari Sands Lodge',
    city: 'Maun',
    country: 'Botswana',
    currency: 'P',
    phone: '+267 72 789 415',
    email: 'reservations@safarisands.example',
    whatsapp_number: '+26772789415',
    website: 'https://safarisands.example',
    booking_tagline: 'Direct stays near the delta',
    booking_description: 'Choose calm rooms, breakfast-ready mornings, and a front desk that confirms your stay directly.',
    booking_payment_terms: 'A deposit may be requested after the lodge confirms your reservation.',
    booking_cancellation_policy: 'Contact the lodge early if travel plans change.',
    booking_house_rules: 'Quiet hours from 22:00. No smoking inside rooms.',
    booking_check_in_from: '14:00',
    booking_check_out_until: '10:00',
    hero_image: `${mediaBase}/assets/photos/lodge-exterior.jpg`,
    logo: ''
  }
}

function publicRooms() {
  return [
    {
      id: 'public-r1',
      room_number: 'Garden Suite',
      room_type: 'Queen Suite',
      rate_per_night: 920,
      total_price: 1840,
      nights: 2,
      max_occupancy: 2,
      amenities: ['Breakfast', 'Wi-Fi', 'Garden view', 'Air conditioning'],
      description: 'A calm suite for couples or business travellers who want a quiet, comfortable stay.',
      photo: `${mediaBase}/assets/photos/guest-room.jpg`,
      photos: [`${mediaBase}/assets/photos/guest-room.jpg`, `${mediaBase}/assets/photos/lodge-lounge.jpg`],
      photo_count: 2
    },
    {
      id: 'public-r2',
      room_number: 'Family Chalet',
      room_type: 'Family Room',
      rate_per_night: 1250,
      total_price: 2500,
      nights: 2,
      max_occupancy: 4,
      amenities: ['Family friendly', 'Breakfast', 'Pool access', 'Hot shower'],
      description: 'A bigger room for families who need space and direct lodge contact before arrival.',
      photo: `${mediaBase}/assets/photos/lodge-lounge.jpg`,
      photos: [`${mediaBase}/assets/photos/lodge-lounge.jpg`, `${mediaBase}/assets/photos/restaurant.jpg`],
      photo_count: 2
    }
  ]
}

async function prepareBooking(page) {
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url()
    const body = JSON.parse(route.request().postData() || '{}')
    if (url.includes('get_lodge_public_profile_shell') || url.includes('get_lodge_public_profile') || url.includes('get_lodge_public_media')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lodgeShell()) })
    }
    if (url.includes('get_available_rooms')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          check_in: body.p_check_in,
          check_out: body.p_check_out,
          rooms: publicRooms()
        })
      })
    }
    if (url.includes('create_online_booking')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          booking_id: 'online-demo-1',
          reference: 'BB-DEMO-1042',
          lodge_name: 'Safari Sands Lodge',
          room_number: 'Garden Suite',
          total_amount: 1840
        })
      })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'demo rpc missing' }) })
  })
}

async function captureBooking(page) {
  await page.goto(`${bookingBase}/safari-sands`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 15000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(outDir, 'booking-site-lodge.png'), fullPage: false })

  await page.fill('input[type="date"]', iso(7))
  const dateInputs = await page.$$('input[type="date"]')
  if (dateInputs[1]) await dateInputs[1].fill(iso(9))
  await page.getByRole('button', { name: /search rooms/i }).click()
  await page.waitForSelector('text=room ready for your dates, text=rooms ready for your dates', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)

  const requestButton = page.locator('button:has-text("Request This Room")').first()
  if (await requestButton.count()) {
    await Promise.all([
      page.waitForURL(/\/book/, { timeout: 8000 }).catch(() => null),
      requestButton.click({ force: true })
    ])
  } else {
    await page.getByText(/Garden Suite|Queen Suite/).first().click()
  }
  await page.waitForSelector('form, h1', { timeout: 15000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(outDir, 'booking-site-book.png'), fullPage: false })
}

async function main() {
  const desktopUrl = new URL(desktopBase)
  const pwaUrl = new URL(pwaBase)
  const bookingUrl = new URL(bookingBase)
  const mediaUrl = new URL(mediaBase)
  const desktopServer = await startStaticServer(path.join(root, 'out', 'renderer'), Number(desktopUrl.port || 5176))
  const pwaServer = await startStaticServer(path.join(root, 'manager-pwa', 'dist'), Number(pwaUrl.port || 5174))
  const bookingServer = await startStaticServer(path.join(root, 'booking-site', 'dist'), Number(bookingUrl.port || 5175))
  const mediaServer = await startStaticServer(path.join(root, 'marketing-site'), Number(mediaUrl.port || 4173))
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1920, height: 993 },
      deviceScaleFactor: 1
    })
    const desktop = await desktopContext.newPage()
    await prepareDesktop(desktop)
    await captureDesktop(desktop, '/', 'desktop-dashboard.png')
    await captureDesktop(desktop, '/bookings', 'desktop-bookings.png')
    await captureDesktop(desktop, '/roomgrid', 'desktop-room-grid.png')
    await captureDesktop(desktop, '/invoices', 'desktop-invoices.png')
    await captureDesktop(desktop, '/guests', 'desktop-guests.png')
    await captureDesktop(desktop, '/reports', 'desktop-reports.png')
    await captureDesktop(desktop, '/pos', 'desktop-pos.png')
    await desktopContext.close()

    const pwaContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block'
    })
    const pwa = await pwaContext.newPage()
    await preparePwa(pwa)
    await capturePwa(pwa, '/', 'pwa-dashboard.png')
    await capturePwa(pwa, '/bookings', 'pwa-bookings.png')
    await capturePwa(pwa, '/rooms', 'pwa-rooms.png')
    await capturePwa(pwa, '/money', 'pwa-money.png')
    await capturePwa(pwa, '/alerts', 'pwa-alerts.png')
    await pwaContext.close()

    const bookingContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1
    })
    const booking = await bookingContext.newPage()
    await prepareBooking(booking)
    await captureBooking(booking)
    await bookingContext.close()

    console.log('Captured real app screenshots for marketing assets.')
  } finally {
    await browser.close()
    desktopServer.close()
    pwaServer.close()
    bookingServer.close()
    mediaServer.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
