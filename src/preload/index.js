import { contextBridge, ipcRenderer } from 'electron'

const api = {
  auth: {
    login: (email, password) => ipcRenderer.invoke('auth:login', email, password)
  },
  users: {
    getAll: () => ipcRenderer.invoke('users:getAll'),
    create: (data) => ipcRenderer.invoke('users:create', data),
    update: (id, data) => ipcRenderer.invoke('users:update', id, data),
    delete: (id) => ipcRenderer.invoke('users:delete', id)
  },
  rooms: {
    getAll: () => ipcRenderer.invoke('rooms:getAll'),
    create: (data) => ipcRenderer.invoke('rooms:create', data),
    update: (id, data) => ipcRenderer.invoke('rooms:update', id, data),
    delete: (id) => ipcRenderer.invoke('rooms:delete', id),
    updateHousekeeping: (id, status, notes) =>
      ipcRenderer.invoke('rooms:updateHousekeeping', id, status, notes)
  },
  customers: {
    getAll: () => ipcRenderer.invoke('customers:getAll'),
    create: (data) => ipcRenderer.invoke('customers:create', data),
    update: (id, data) => ipcRenderer.invoke('customers:update', id, data),
    updateBlacklist: (id, is_blacklisted, reason) =>
      ipcRenderer.invoke('customers:updateBlacklist', id, is_blacklisted, reason),
    getBookings: (id) => ipcRenderer.invoke('customers:getBookings', id),
    updateIdPhoto: (id, photo) => ipcRenderer.invoke('customers:updateIdPhoto', id, photo)
  },
  charges: {
    getByBooking: (bookingId) => ipcRenderer.invoke('charges:getByBooking', bookingId),
    add: (bookingId, data) => ipcRenderer.invoke('charges:add', bookingId, data),
    delete: (id) => ipcRenderer.invoke('charges:delete', id)
  },
  rateOverrides: {
    getAll: () => ipcRenderer.invoke('rateOverrides:getAll'),
    create: (data) => ipcRenderer.invoke('rateOverrides:create', data),
    update: (id, data) => ipcRenderer.invoke('rateOverrides:update', id, data),
    delete: (id) => ipcRenderer.invoke('rateOverrides:delete', id),
    getApplicable: (roomId, checkIn, checkOut) =>
      ipcRenderer.invoke('rateOverrides:getApplicable', roomId, checkIn, checkOut)
  },
  expenses: {
    getAll: (start, end) => ipcRenderer.invoke('expenses:getAll', start, end),
    create: (data) => ipcRenderer.invoke('expenses:create', data),
    update: (id, data) => ipcRenderer.invoke('expenses:update', id, data),
    delete: (id) => ipcRenderer.invoke('expenses:delete', id)
  },
  maintenance: {
    getAll: () => ipcRenderer.invoke('maintenance:getAll'),
    create: (data) => ipcRenderer.invoke('maintenance:create', data),
    update: (id, data) => ipcRenderer.invoke('maintenance:update', id, data),
    resolve: (id, roomId) => ipcRenderer.invoke('maintenance:resolve', id, roomId)
  },
  receipts: {
    savePDF: (guestName) => ipcRenderer.invoke('receipts:savePDF', guestName)
  },
  bookings: {
    getAll: () => ipcRenderer.invoke('bookings:getAll'),
    getByDateRange: (start, end) => ipcRenderer.invoke('bookings:getByDateRange', start, end),
    create: (data) => ipcRenderer.invoke('bookings:create', data),
    update: (id, data) => ipcRenderer.invoke('bookings:update', id, data),
    updateStatus: (id, status) => ipcRenderer.invoke('bookings:updateStatus', id, status),
    updatePayment: (id, payment_status, amount_paid, payment_method) =>
      ipcRenderer.invoke('bookings:updatePayment', id, payment_status, amount_paid, payment_method),
    createEvent: (data) => ipcRenderer.invoke('bookings:createEvent', data)
  },
  reports: {
    occupancy: (start, end) => ipcRenderer.invoke('reports:occupancy', start, end),
    revenue: (start, end) => ipcRenderer.invoke('reports:revenue', start, end),
    savePDF: () => ipcRenderer.invoke('reports:savePDF'),
    saveExcel: (data) => ipcRenderer.invoke('reports:saveExcel', data),
    posSales: (start, end) => ipcRenderer.invoke('reports:posSales', start, end),
    inventorySpend: (start, end) => ipcRenderer.invoke('reports:inventorySpend', start, end),
    supplySpend: (start, end) => ipcRenderer.invoke('reports:supplySpend', start, end),
    nightAudit: (date) => ipcRenderer.invoke('reports:nightAudit', date),
    profitLoss: (start, end) => ipcRenderer.invoke('reports:profitLoss', start, end)
  },
  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats'),
    forecast: (days) => ipcRenderer.invoke('dashboard:forecast', days)
  },
  notifications: {
    today: () => ipcRenderer.invoke('notifications:today'),
    upcoming: () => ipcRenderer.invoke('notifications:upcoming')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  activity: {
    getAll: () => ipcRenderer.invoke('activity:getAll'),
    clear: () => ipcRenderer.invoke('activity:clear')
  },
  backup: {
    getInfo: () => ipcRenderer.invoke('backup:getInfo'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data)
  },
  trial: {
    getStatus: (lodgeId) => ipcRenderer.invoke('trial:getStatus', lodgeId),
    activateKey: (lodgeId, key) => ipcRenderer.invoke('trial:activateKey', lodgeId, key),
    getInvoices: (lodgeId) => ipcRenderer.invoke('trial:getInvoices', lodgeId)
  },
  updates: {
    onAvailable: (cb) => ipcRenderer.on('update:available', (_, info) => cb(info)),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_, p) => cb(p)),
    onReady: (cb) => ipcRenderer.on('update:ready', (_, info) => cb(info)),
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  pos: {
    getMenuItems: () => ipcRenderer.invoke('pos:getMenuItems'),
    createMenuItem: (data) => ipcRenderer.invoke('pos:createMenuItem', data),
    updateMenuItem: (id, data) => ipcRenderer.invoke('pos:updateMenuItem', id, data),
    deleteMenuItem: (id) => ipcRenderer.invoke('pos:deleteMenuItem', id),
    getOrders: (start, end) => ipcRenderer.invoke('pos:getOrders', start, end),
    createOrder: (data) => ipcRenderer.invoke('pos:createOrder', data),
    voidOrder: (id) => ipcRenderer.invoke('pos:voidOrder', id),
    getActiveBookingForRoom: (roomId) => ipcRenderer.invoke('pos:getActiveBookingForRoom', roomId)
  },
  inventory: {
    getItems: () => ipcRenderer.invoke('inventory:getItems'),
    createItem: (data) => ipcRenderer.invoke('inventory:createItem', data),
    updateItem: (id, data) => ipcRenderer.invoke('inventory:updateItem', id, data),
    deleteItem: (id) => ipcRenderer.invoke('inventory:deleteItem', id),
    addPurchase: (data) => ipcRenderer.invoke('inventory:addPurchase', data),
    getPurchases: (itemId) => ipcRenderer.invoke('inventory:getPurchases', itemId),
    adjustStock: (itemId, delta, notes) => ipcRenderer.invoke('inventory:adjustStock', itemId, delta, notes),
    getLowStock: () => ipcRenderer.invoke('inventory:getLowStock')
  },
  supplies: {
    getItems: () => ipcRenderer.invoke('supplies:getItems'),
    createItem: (data) => ipcRenderer.invoke('supplies:createItem', data),
    updateItem: (id, data) => ipcRenderer.invoke('supplies:updateItem', id, data),
    deleteItem: (id) => ipcRenderer.invoke('supplies:deleteItem', id),
    addPurchase: (data) => ipcRenderer.invoke('supplies:addPurchase', data),
    getPurchases: (itemId) => ipcRenderer.invoke('supplies:getPurchases', itemId),
    saveAllocations: (weekStart, allocations) =>
      ipcRenderer.invoke('supplies:saveAllocations', weekStart, allocations),
    getAllocations: (start, end) => ipcRenderer.invoke('supplies:getAllocations', start, end),
    getWeekAllocations: (weekStart) => ipcRenderer.invoke('supplies:getWeekAllocations', weekStart)
  },
  admin: {
    exists: () => ipcRenderer.invoke('admin:exists'),
    setup: (name, email, password) => ipcRenderer.invoke('admin:setup', name, email, password),
    getCompanies: () => ipcRenderer.invoke('admin:getCompanies'),
    getLicenses: () => ipcRenderer.invoke('admin:getLicenses'),
    createLicense: (data) => ipcRenderer.invoke('admin:createLicense', data),
    updateLicense: (id, updates) => ipcRenderer.invoke('admin:updateLicense', id, updates),
    deleteLicense: (id) => ipcRenderer.invoke('admin:deleteLicense', id),
    // Broadcasts
    getBroadcasts: () => ipcRenderer.invoke('admin:getBroadcasts'),
    getActiveBroadcasts: () => ipcRenderer.invoke('admin:getActiveBroadcasts'),
    createBroadcast: (data) => ipcRenderer.invoke('admin:createBroadcast', data),
    updateBroadcast: (id, data) => ipcRenderer.invoke('admin:updateBroadcast', id, data),
    deleteBroadcast: (id) => ipcRenderer.invoke('admin:deleteBroadcast', id),
    // Feature flags
    getLodgeFeatures: (lodgeId) => ipcRenderer.invoke('admin:getLodgeFeatures', lodgeId),
    setLodgeFeature: (lodgeId, name, enabled) => ipcRenderer.invoke('admin:setLodgeFeature', lodgeId, name, enabled),
    getAllLodgeFeatures: () => ipcRenderer.invoke('admin:getAllLodgeFeatures'),
    // Support tickets
    getSupportTickets: (filters) => ipcRenderer.invoke('admin:getSupportTickets', filters),
    createSupportTicket: (data) => ipcRenderer.invoke('admin:createSupportTicket', data),
    updateSupportTicket: (id, updates) => ipcRenderer.invoke('admin:updateSupportTicket', id, updates),
    deleteSupportTicket: (id) => ipcRenderer.invoke('admin:deleteSupportTicket', id),
    // Activity logs
    getActivityLogs: (filters) => ipcRenderer.invoke('admin:getActivityLogs', filters),
    // Company stats
    getCompanyStats: (lodgeId) => ipcRenderer.invoke('admin:getCompanyStats', lodgeId),
    // Billing
    updateLicenseBilling: (id, data) => ipcRenderer.invoke('admin:updateLicenseBilling', id, data),
    getOverdueLicenses: () => ipcRenderer.invoke('admin:getOverdueLicenses'),
    // Invoices
    getNextInvoiceNumber: () => ipcRenderer.invoke('admin:getNextInvoiceNumber'),
    createInvoice: (data) => ipcRenderer.invoke('admin:createInvoice', data),
    getInvoices: (filters) => ipcRenderer.invoke('admin:getInvoices', filters),
    getInvoicesByLodge: (lodgeId) => ipcRenderer.invoke('admin:getInvoicesByLodge', lodgeId),
    updateInvoice: (id, data) => ipcRenderer.invoke('admin:updateInvoice', id, data),
    deleteInvoice: (id) => ipcRenderer.invoke('admin:deleteInvoice', id),
    getInvoiceSummary: () => ipcRenderer.invoke('admin:getInvoiceSummary'),
    sendInvoiceEmail: (payload) => ipcRenderer.invoke('admin:sendInvoiceEmail', payload)
  },
  conference: {
    getAll: (start, end) => ipcRenderer.invoke('conference:getAll', start, end),
    create: (data) => ipcRenderer.invoke('conference:create', data),
    update: (id, data) => ipcRenderer.invoke('conference:update', id, data),
    delete: (id) => ipcRenderer.invoke('conference:delete', id)
  },
  import: {
    parseExcel: () => ipcRenderer.invoke('import:parseExcel'),
    execute: (rows) => ipcRenderer.invoke('import:execute', rows)
  },
  data: {
    exportAll: () => ipcRenderer.invoke('data:exportAll')
  },
  dayuse: {
    getAll: (start, end) => ipcRenderer.invoke('dayuse:getAll', start, end),
    add: (data) => ipcRenderer.invoke('dayuse:add', data),
    delete: (id) => ipcRenderer.invoke('dayuse:delete', id),
    summary: (date) => ipcRenderer.invoke('dayuse:summary', date)
  },
  email: {
    getConfig: () => ipcRenderer.invoke('email:getConfig'),
    saveConfig: (config) => ipcRenderer.invoke('email:saveConfig', config),
    test: (config) => ipcRenderer.invoke('email:test', config),
    sendLicense: (payload) => ipcRenderer.invoke('email:sendLicense', payload)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
