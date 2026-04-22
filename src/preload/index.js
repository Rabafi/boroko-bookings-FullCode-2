import { contextBridge, ipcRenderer } from 'electron'

const api = {
  auth: {
    login:          (email, password) => ipcRenderer.invoke('auth:login', email, password),
    getStatus:      (email)           => ipcRenderer.invoke('auth:status', email),
    healthCheck:    (email)           => ipcRenderer.invoke('auth:healthCheck', email),
    sendPasswordReset: (email)         => ipcRenderer.invoke('auth:sendPasswordReset', email),
    restoreSession: (nonce)           => ipcRenderer.invoke('auth:restoreSession', nonce),
    restoreSavedSession: (email, password) => ipcRenderer.invoke('auth:restoreSavedSession', email, password),
    validateSession: ()               => ipcRenderer.invoke('auth:validateSession'),
    logout:         ()                => ipcRenderer.invoke('auth:logout')
  },
  profiles: {
    list:       ()              => ipcRenderer.invoke('profiles:list'),
    getActive:  ()              => ipcRenderer.invoke('profiles:getActive'),
    select:     (lodgeId)       => ipcRenderer.invoke('profiles:select', lodgeId),
    createDraft: ()             => ipcRenderer.invoke('profiles:createDraft'),
    removeDraft: (lodgeId)      => ipcRenderer.invoke('profiles:removeDraft', lodgeId)
  },
  setup: {
    initializeCompany: (payload)      => ipcRenderer.invoke('setup:initializeCompany', payload)
  },
  users: {
    getAll: () => ipcRenderer.invoke('users:getAll'),
    create: (data) => ipcRenderer.invoke('users:create', data),
    update: (id, data) => ipcRenderer.invoke('users:update', id, data),
    resetPassword: (id, password) => ipcRenderer.invoke('users:resetPassword', id, password),
    sendInvite: (id) => ipcRenderer.invoke('users:sendInvite', id),
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
    delete: (id, reason) => ipcRenderer.invoke('charges:delete', id, reason)
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
    getAll: (start, end, outletId) => ipcRenderer.invoke('expenses:getAll', start, end, outletId),
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
    savePDF: (payload) => ipcRenderer.invoke('receipts:savePDF', payload)
  },
  quotations: {
    getAll:     ()                                      => ipcRenderer.invoke('quotations:getAll'),
    create:     (data)                                  => ipcRenderer.invoke('quotations:create', data),
    update:     (id, data)                              => ipcRenderer.invoke('quotations:update', id, data),
    convert:    (quotationId, depositAmount, method)    => ipcRenderer.invoke('quotations:convert', quotationId, depositAmount, method),
    savePDF:    (quotationId, quotationNumber, customerName) => ipcRenderer.invoke('quotations:savePDF', quotationId, quotationNumber, customerName),
    duplicate:  (id)                                    => ipcRenderer.invoke('quotations:duplicate', id)
  },
  bookings: {
    getAll: () => ipcRenderer.invoke('bookings:getAll'),
    getByDateRange: (start, end) => ipcRenderer.invoke('bookings:getByDateRange', start, end),
    create: (data) => ipcRenderer.invoke('bookings:create', data),
    update: (id, data) => ipcRenderer.invoke('bookings:update', id, data),
    updateStatus: (id, status) => ipcRenderer.invoke('bookings:updateStatus', id, status),
    updatePayment: (id, amount, method, intentKey) =>
      ipcRenderer.invoke('bookings:updatePayment', id, amount, method, intentKey),
    getPayments: (bookingId) => ipcRenderer.invoke('bookings:getPayments', bookingId),
    refund: (bookingId, payload) => ipcRenderer.invoke('bookings:refund', bookingId, payload),
    createEvent: (data) => ipcRenderer.invoke('bookings:createEvent', data),
    getPendingOnline: () => ipcRenderer.invoke('bookings:getPendingOnline')
  },
  invoices: {
    getBookingInvoices: () => ipcRenderer.invoke('invoices:getBookingInvoices'),
    sendBookingInvoiceEmail: (invoice) => ipcRenderer.invoke('invoices:sendBookingInvoiceEmail', invoice),
    recordDelivery: (payload) => ipcRenderer.invoke('invoices:recordDelivery', payload)
  },
  reports: {
    occupancy: (start, end) => ipcRenderer.invoke('reports:occupancy', start, end),
    revenue: (start, end) => ipcRenderer.invoke('reports:revenue', start, end),
    snapshot: (today) => ipcRenderer.invoke('reports:snapshot', today),
    invoiceDeliveryHistory: (payload) => ipcRenderer.invoke('reports:invoiceDeliveryHistory', payload),
    financialAudit: (payload) => ipcRenderer.invoke('reports:financialAudit', payload),
    financialReconciliation: () => ipcRenderer.invoke('reports:financialReconciliation'),
    financialValidation: () => ipcRenderer.invoke('reports:financialValidation'),
    financialValidationRuns: (limit) => ipcRenderer.invoke('reports:financialValidationRuns', limit),
    financialValidationAlerts: (limit) => ipcRenderer.invoke('reports:financialValidationAlerts', limit),
    criticalErrors: (limit) => ipcRenderer.invoke('reports:criticalErrors', limit),
    clearCriticalErrors: () => ipcRenderer.invoke('reports:clearCriticalErrors'),
    saveSupportBundle: (limit) => ipcRenderer.invoke('reports:saveSupportBundle', limit),
    runFinancialValidation: () => ipcRenderer.invoke('reports:runFinancialValidation'),
    savePDF: () => ipcRenderer.invoke('reports:savePDF'),
    saveExcel: (data) => ipcRenderer.invoke('reports:saveExcel', data),
    posSales: (start, end, outletId) => ipcRenderer.invoke('reports:posSales', start, end, outletId),
    inventorySpend: (start, end, outletId) => ipcRenderer.invoke('reports:inventorySpend', start, end, outletId),
    supplySpend: (start, end) => ipcRenderer.invoke('reports:supplySpend', start, end),
    nightAudit: (date) => ipcRenderer.invoke('reports:nightAudit', date),
    profitLoss: (start, end) => ipcRenderer.invoke('reports:profitLoss', start, end),
    outletProfitLoss: (start, end) => ipcRenderer.invoke('reports:outletProfitLoss', start, end),
    roomProfitability: (start, end) => ipcRenderer.invoke('reports:roomProfitability', start, end),
    exportOfflineSafetyManifest: () => ipcRenderer.invoke('reports:exportOfflineSafetyManifest')
  },
  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats'),
    forecast: (days) => ipcRenderer.invoke('dashboard:forecast', days),
    bookingPaymentsToday: () => ipcRenderer.invoke('dashboard:bookingPaymentsToday')
  },
  requests: {
    getAll: (limit) => ipcRenderer.invoke('requests:getAll', limit),
    update: (id, updates) => ipcRenderer.invoke('requests:update', id, updates)
  },
  notifications: {
    today: () => ipcRenderer.invoke('notifications:today'),
    upcoming: () => ipcRenderer.invoke('notifications:upcoming')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  window: {
    onFocusRecovery: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('window:focus-recovery', listener)
      return () => ipcRenderer.off('window:focus-recovery', listener)
    }
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    logRendererError: (payload) => ipcRenderer.invoke('app:logRendererError', payload),
    getRendererErrors: (limit) => ipcRenderer.invoke('app:getRendererErrors', limit),
    clearRendererErrors: () => ipcRenderer.invoke('app:clearRendererErrors'),
    setTestOfflineMode: (forceOffline) => ipcRenderer.invoke('app:setTestOfflineMode', forceOffline),
    showTouchKeyboard: () => ipcRenderer.invoke('app:showTouchKeyboard')
  },
  activity: {
    getAll: () => ipcRenderer.invoke('activity:getAll'),
    clear: () => ipcRenderer.invoke('activity:clear')
  },
  backup: {
    getInfo: () => ipcRenderer.invoke('backup:getInfo'),
    chooseTargetFolder: () => ipcRenderer.invoke('backup:chooseTargetFolder'),
    savePolicy: (updates) => ipcRenderer.invoke('backup:savePolicy', updates),
    runManagedNow: () => ipcRenderer.invoke('backup:runManagedNow'),
    createManual: () => ipcRenderer.invoke('backup:createManual'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
    openManagedFolder: () => ipcRenderer.invoke('backup:openManagedFolder')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data),
    getDiagnostics: (expectedLodgeId) => ipcRenderer.invoke('settings:getDiagnostics', expectedLodgeId),
    getSystemHealth: () => ipcRenderer.invoke('settings:getSystemHealth'),
    relinkLodge: (lodgeId) => ipcRenderer.invoke('settings:relinkLodge', lodgeId),
    resetToNewLodge: () => ipcRenderer.invoke('settings:resetToNewLodge')
  },
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    getDetails: () => ipcRenderer.invoke('sync:getDetails'),
    retryFailed: (queueIds) => ipcRenderer.invoke('sync:retryFailed', queueIds),
    clearFailed: (queueIds) => ipcRenderer.invoke('sync:clearFailed', queueIds),
    runNow: () => ipcRenderer.invoke('sync:runNow'),
    clearHealthFault: (id) => ipcRenderer.invoke('sync:clearHealthFault', id),
    getDeviceHealthRollup: () => ipcRenderer.invoke('sync:getDeviceHealthRollup'),
    onStatusChanged: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('sync:status-changed', listener)
      return () => ipcRenderer.off('sync:status-changed', listener)
    },
    onBookingConflict: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('booking:sync-conflict', listener)
      return () => ipcRenderer.off('booking:sync-conflict', listener)
    }
  },
  trial: {
    getStatus: (lodgeId) => ipcRenderer.invoke('trial:getStatus', lodgeId),
    activateKey: (lodgeId, key) => ipcRenderer.invoke('trial:activateKey', lodgeId, key),
    getInvoices: (lodgeId) => ipcRenderer.invoke('trial:getInvoices', lodgeId)
  },
  updates: {
    onAvailable: (cb) => ipcRenderer.on('update:available', (_, info) => cb(info)),
    onNotAvailable: (cb) => ipcRenderer.on('update:not-available', (_, info) => cb(info)),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_, p) => cb(p)),
    onReady: (cb) => ipcRenderer.on('update:ready', (_, info) => cb(info)),
    onError: (cb) => ipcRenderer.on('update:error', (_, info) => cb(info)),
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  outlets: {
    getAll: () => ipcRenderer.invoke('outlets:getAll')
  },
  pos: {
    getMenuItems: () => ipcRenderer.invoke('pos:getMenuItems'),
    createMenuItem: (data) => ipcRenderer.invoke('pos:createMenuItem', data),
    updateMenuItem: (id, data) => ipcRenderer.invoke('pos:updateMenuItem', id, data),
    deleteMenuItem: (id) => ipcRenderer.invoke('pos:deleteMenuItem', id),
    setBarPackTemplate: (data) => ipcRenderer.invoke('pos:setBarPackTemplate', data),
    getOrders: (start, end) => ipcRenderer.invoke('pos:getOrders', start, end),
    getVoidHistory: (start, end) => ipcRenderer.invoke('pos:getVoidHistory', start, end),
    createOrder: (data) => ipcRenderer.invoke('pos:createOrder', data),
    voidOrder: (id) => ipcRenderer.invoke('pos:voidOrder', id),
    approveVoidWithPin: (data) => ipcRenderer.invoke('pos:approveVoidWithPin', data),
    getActiveBookingForRoom: (roomId) => ipcRenderer.invoke('pos:getActiveBookingForRoom', roomId)
  },
  inventory: {
    getItems: () => ipcRenderer.invoke('inventory:getItems'),
    createItem: (data) => ipcRenderer.invoke('inventory:createItem', data),
    updateItem: (id, data) => ipcRenderer.invoke('inventory:updateItem', id, data),
    deleteItem: (id) => ipcRenderer.invoke('inventory:deleteItem', id),
    addPurchase: (data) => ipcRenderer.invoke('inventory:addPurchase', data),
    getPurchases: (itemId) => ipcRenderer.invoke('inventory:getPurchases', itemId),
    adjustStock: (itemId, delta, notes, managerPin) => ipcRenderer.invoke('inventory:adjustStock', itemId, delta, notes, managerPin),
    getLowStock: () => ipcRenderer.invoke('inventory:getLowStock'),
    getStocktakes: (limit) => ipcRenderer.invoke('inventory:getStocktakes', limit),
    createStocktake: (data) => ipcRenderer.invoke('inventory:createStocktake', data),
    getStocktake: (stocktakeId) => ipcRenderer.invoke('inventory:getStocktake', stocktakeId),
    saveStocktakeCounts: (stocktakeId, lines) => ipcRenderer.invoke('inventory:saveStocktakeCounts', stocktakeId, lines),
    postStocktake: (stocktakeId, notes) => ipcRenderer.invoke('inventory:postStocktake', stocktakeId, notes)
  },
  supplies: {
    getItems: () => ipcRenderer.invoke('supplies:getItems'),
    createItem: (data) => ipcRenderer.invoke('supplies:createItem', data),
    updateItem: (id, data) => ipcRenderer.invoke('supplies:updateItem', id, data),
    deleteItem: (id) => ipcRenderer.invoke('supplies:deleteItem', id),
    addPurchase: (data) => ipcRenderer.invoke('supplies:addPurchase', data),
    getPurchases: (itemId) => ipcRenderer.invoke('supplies:getPurchases', itemId),
    adjustStock: (itemId, delta, notes, managerPin) => ipcRenderer.invoke('supplies:adjustStock', itemId, delta, notes, managerPin),
    getRoomStock: () => ipcRenderer.invoke('supplies:getRoomStock'),
    loadToRoom: (data) => ipcRenderer.invoke('supplies:loadToRoom', data),
    useInRoom: (data) => ipcRenderer.invoke('supplies:useInRoom', data),
    returnFromRoom: (data) => ipcRenderer.invoke('supplies:returnFromRoom', data),
    getMovements: (limit) => ipcRenderer.invoke('supplies:getMovements', limit),
    saveAllocations: (weekStart, allocations) =>
      ipcRenderer.invoke('supplies:saveAllocations', weekStart, allocations),
    getAllocations: (start, end) => ipcRenderer.invoke('supplies:getAllocations', start, end),
    getWeekAllocations: (weekStart) => ipcRenderer.invoke('supplies:getWeekAllocations', weekStart),
    exportReport: (payload) => ipcRenderer.invoke('supplies:exportReport', payload),
    getStocktakes: (limit) => ipcRenderer.invoke('supplies:getStocktakes', limit),
    createStocktake: (data) => ipcRenderer.invoke('supplies:createStocktake', data),
    getStocktake: (stocktakeId) => ipcRenderer.invoke('supplies:getStocktake', stocktakeId),
    saveStocktakeCounts: (stocktakeId, lines) => ipcRenderer.invoke('supplies:saveStocktakeCounts', stocktakeId, lines),
    postStocktake: (stocktakeId, notes) => ipcRenderer.invoke('supplies:postStocktake', stocktakeId, notes),
    getRoomStocktakes: (limit) => ipcRenderer.invoke('supplies:getRoomStocktakes', limit),
    createRoomStocktake: (data) => ipcRenderer.invoke('supplies:createRoomStocktake', data),
    getRoomStocktake: (stocktakeId) => ipcRenderer.invoke('supplies:getRoomStocktake', stocktakeId),
    saveRoomStocktakeCounts: (stocktakeId, lines) => ipcRenderer.invoke('supplies:saveRoomStocktakeCounts', stocktakeId, lines),
    postRoomStocktake: (stocktakeId, notes) => ipcRenderer.invoke('supplies:postRoomStocktake', stocktakeId, notes),
    addRoomStocktakeLine: (stocktakeId, data) => ipcRenderer.invoke('supplies:addRoomStocktakeLine', stocktakeId, data)
  },
  admin: {
    exists: () => ipcRenderer.invoke('admin:exists'),
    setup: (name, email, password) => ipcRenderer.invoke('admin:setup', name, email, password),
    getCompanies: () => ipcRenderer.invoke('admin:getCompanies'),
    getLicenses: () => ipcRenderer.invoke('admin:getLicenses'),
    createLicense: (data) => ipcRenderer.invoke('admin:createLicense', data),
    issueSubscriptionContract: (payload) => ipcRenderer.invoke('admin:issueSubscriptionContract', payload),
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
    setLodgeFeature: (lodgeId, name, enabled, metadata) => ipcRenderer.invoke('admin:setLodgeFeature', lodgeId, name, enabled, metadata),
    clearLodgeFeature: (lodgeId, name) => ipcRenderer.invoke('admin:clearLodgeFeature', lodgeId, name),
    getAllLodgeFeatures: () => ipcRenderer.invoke('admin:getAllLodgeFeatures'),
    getTestDataResetPreview: (lodgeId, payload) => ipcRenderer.invoke('admin:getTestDataResetPreview', lodgeId, payload),
    runTestDataReset: (lodgeId, payload) => ipcRenderer.invoke('admin:runTestDataReset', lodgeId, payload),
    getTestDataResetAudit: (lodgeId, limit) => ipcRenderer.invoke('admin:getTestDataResetAudit', lodgeId, limit),
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
    sendInvoiceEmail: (payload) => ipcRenderer.invoke('admin:sendInvoiceEmail', payload),
    updateCompany: (lodgeId, updates) => ipcRenderer.invoke('admin:updateCompany', lodgeId, updates),
    getCompanyUsers: (lodgeId) => ipcRenderer.invoke('admin:getCompanyUsers', lodgeId),
    resetCompanyUserPassword: (lodgeId, userId, password) => ipcRenderer.invoke('admin:resetCompanyUserPassword', lodgeId, userId, password),
    updateCompanyUserPwaAccess: (lodgeId, userId, payload) => ipcRenderer.invoke('admin:updateCompanyUserPwaAccess', lodgeId, userId, payload),
    // Lifecycle
    archiveCompany: (lodgeId) => ipcRenderer.invoke('admin:archiveCompany', lodgeId),
    restoreCompany: (lodgeId) => ipcRenderer.invoke('admin:restoreCompany', lodgeId),
    permanentlyDeleteCompany: (lodgeId) => ipcRenderer.invoke('admin:permanentlyDeleteCompany', lodgeId),
    repairDuplicateEventBookings: (lodgeId) => ipcRenderer.invoke('admin:repairDuplicateEventBookings', lodgeId),
    // Expenses
    getExpenses: () => ipcRenderer.invoke('admin:getExpenses'),
    createExpense: (data) => ipcRenderer.invoke('admin:createExpense', data),
    updateExpense: (id, data) => ipcRenderer.invoke('admin:updateExpense', id, data),
    deleteExpense: (id) => ipcRenderer.invoke('admin:deleteExpense', id)
  },
  conference: {
    getAll: (start, end) => ipcRenderer.invoke('conference:getAll', start, end),
    create: (data) => ipcRenderer.invoke('conference:create', data),
    update: (id, data) => ipcRenderer.invoke('conference:update', id, data),
    delete: (id) => ipcRenderer.invoke('conference:delete', id)
  },
  import: {
    parseExcel: () => ipcRenderer.invoke('import:parseExcel'),
    execute: (rows, filename) => ipcRenderer.invoke('import:execute', rows, filename),
    checkDuplicates: (rows) => ipcRenderer.invoke('import:checkDuplicates', rows),
    undoBatch: (batchId) => ipcRenderer.invoke('import:undoBatch', batchId),
    getBatches: () => ipcRenderer.invoke('import:getBatches'),
    downloadTemplate: () => ipcRenderer.invoke('import:downloadTemplate'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('import:progress', handler)
      return () => ipcRenderer.removeListener('import:progress', handler)
    }
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
