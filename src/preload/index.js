import electron from 'electron'

const { contextBridge, ipcRenderer, webUtils } = electron

const onIpc = (channel, cb) => {
  const listener = (_, value) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  auth: {
    login:          (email, password, selectedLodgeId = null) => ipcRenderer.invoke('auth:login', email, password, selectedLodgeId),
    getStatus:      (email)           => ipcRenderer.invoke('auth:status', email),
    healthCheck:    (email)           => ipcRenderer.invoke('auth:healthCheck', email),
    sendPasswordReset: (email)         => ipcRenderer.invoke('auth:sendPasswordReset', email),
    restoreSession: (nonce)           => ipcRenderer.invoke('auth:restoreSession', nonce),
    restoreCurrentSession: ()          => ipcRenderer.invoke('auth:restoreCurrentSession'),
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
    getAccessAudit: () => ipcRenderer.invoke('users:getAccessAudit'),
    resetPassword: (id, password) => ipcRenderer.invoke('users:resetPassword', id, password),
    sendInvite: (id) => ipcRenderer.invoke('users:sendInvite', id),
    delete: (id) => ipcRenderer.invoke('users:delete', id)
  },
  staffScheduling: {
    getSchedule: (date) => ipcRenderer.invoke('staffScheduling:getSchedule', date),
    getScheduleRange: (startDate, endDate) => ipcRenderer.invoke('staffScheduling:getScheduleRange', startDate, endDate),
    upsertSchedule: (staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes) => ipcRenderer.invoke('staffScheduling:upsertSchedule', staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes),
    deleteEntry: (id) => ipcRenderer.invoke('staffScheduling:deleteEntry', id),
    getAttendanceToday: () => ipcRenderer.invoke('staffScheduling:getAttendanceToday'),
    getAttendanceRange: (startDate, endDate, staffId) => ipcRenderer.invoke('staffScheduling:getAttendanceRange', startDate, endDate, staffId),
    getAttendanceDashboard: () => ipcRenderer.invoke('staffScheduling:getAttendanceDashboard'),
    clockIn: (staffId, shiftLabel, notes) => ipcRenderer.invoke('staffScheduling:clockIn', staffId, shiftLabel, notes),
    clockOut: (attendanceId, notes) => ipcRenderer.invoke('staffScheduling:clockOut', attendanceId, notes),
    getLeaveRequests: (status, staffId) => ipcRenderer.invoke('staffScheduling:getLeaveRequests', status, staffId),
    requestLeave: (staffId, leaveType, startDate, endDate, reason) => ipcRenderer.invoke('staffScheduling:requestLeave', staffId, leaveType, startDate, endDate, reason),
    approveLeave: (id, status, rejectionReason) => ipcRenderer.invoke('staffScheduling:approveLeave', id, status, rejectionReason)
  },
  staffOperations: {
    getStaffDepartments:        ()                                    => ipcRenderer.invoke('staffOperations:getStaffDepartments'),
    createStaffDepartment:      (name, description, color)            => ipcRenderer.invoke('staffOperations:createStaffDepartment', name, description, color),
    updateStaffDepartment:      (id, payload)                        => ipcRenderer.invoke('staffOperations:updateStaffDepartment', id, payload),
    deleteStaffDepartment:      (id)                                 => ipcRenderer.invoke('staffOperations:deleteStaffDepartment', id),
    getShiftTemplates:          (departmentId)                        => ipcRenderer.invoke('staffOperations:getShiftTemplates', departmentId),
    createShiftTemplate:        (payload)                            => ipcRenderer.invoke('staffOperations:createShiftTemplate', payload),
    updateShiftTemplate:        (id, payload)                        => ipcRenderer.invoke('staffOperations:updateShiftTemplate', id, payload),
    deleteShiftTemplate:        (id)                                 => ipcRenderer.invoke('staffOperations:deleteShiftTemplate', id),
    getTaskCategories:          ()                                    => ipcRenderer.invoke('staffOperations:getTaskCategories'),
    createTaskCategory:         (name, color)                        => ipcRenderer.invoke('staffOperations:createTaskCategory', name, color),
    getTaskAssignments:         (staffId, status, date)               => ipcRenderer.invoke('staffOperations:getTaskAssignments', staffId, status, date),
    createTaskAssignment:       (payload)                            => ipcRenderer.invoke('staffOperations:createTaskAssignment', payload),
    updateTaskAssignment:       (id, payload)                        => ipcRenderer.invoke('staffOperations:updateTaskAssignment', id, payload),
    completeTaskAssignment:     (id, notes)                          => ipcRenderer.invoke('staffOperations:completeTaskAssignment', id, notes),
    getTrainingChecklists:      (departmentId)                        => ipcRenderer.invoke('staffOperations:getTrainingChecklists', departmentId),
    createTrainingChecklist:    (payload)                            => ipcRenderer.invoke('staffOperations:createTrainingChecklist', payload),
    recordTrainingCompletion:   (staffId, checklistId, notes)        => ipcRenderer.invoke('staffOperations:recordTrainingCompletion', staffId, checklistId, notes),
    getTrainingRecords:         (staffId)                             => ipcRenderer.invoke('staffOperations:getTrainingRecords', staffId),
    createShiftHandover:        (payload)                            => ipcRenderer.invoke('staffOperations:createShiftHandover', payload),
    getShiftHandovers:          (date)                                => ipcRenderer.invoke('staffOperations:getShiftHandovers', date),
    getStaffProductivityDashboard: (startDate, endDate)              => ipcRenderer.invoke('staffOperations:getStaffProductivityDashboard', startDate, endDate),
    publishWeeklySchedule:      (weekStart)                          => ipcRenderer.invoke('staffOperations:publishWeeklySchedule', weekStart),
    getScheduleConflicts:       (weekStart)                           => ipcRenderer.invoke('staffOperations:getScheduleConflicts', weekStart)
  },
  rooms: {
    getAll: () => ipcRenderer.invoke('rooms:getAll'),
    getCached: () => ipcRenderer.invoke('rooms:getCached'),
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
    savePDF: (payload) => ipcRenderer.invoke('receipts:savePDF', payload),
    listPrinters: () => ipcRenderer.invoke('receipts:listPrinters'),
    printCurrent: (options) => ipcRenderer.invoke('receipts:printCurrent', options)
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
    getCachedByDateRange: (start, end) => ipcRenderer.invoke('bookings:getCachedByDateRange', start, end),
    getByDateRange: (start, end) => ipcRenderer.invoke('bookings:getByDateRange', start, end),
    create: (data) => ipcRenderer.invoke('bookings:create', data),
    createMultiRoom: (data) => ipcRenderer.invoke('bookings:createMultiRoom', data),
    update: (id, data) => ipcRenderer.invoke('bookings:update', id, data),
    updateStatus: (id, status) => ipcRenderer.invoke('bookings:updateStatus', id, status),
    updatePayment: (id, amount, method, intentKey) =>
      ipcRenderer.invoke('bookings:updatePayment', id, amount, method, intentKey),
    updateGroupPayment: (groupId, amount, method, intentKey) =>
      ipcRenderer.invoke('bookings:updateGroupPayment', groupId, amount, method, intentKey),
    getPayments: (bookingId) => ipcRenderer.invoke('bookings:getPayments', bookingId),
    refundGroup: (groupId, payload) => ipcRenderer.invoke('bookings:refundGroup', groupId, payload),
    refund: (bookingId, payload) => ipcRenderer.invoke('bookings:refund', bookingId, payload),
    createEvent: (data) => ipcRenderer.invoke('bookings:createEvent', data),
    getPendingOnline: () => ipcRenderer.invoke('bookings:getPendingOnline'),
    reschedule: (bookingId, data) => ipcRenderer.invoke('bookings:reschedule', bookingId, data)
  },
  customerCredit: {
    getBalance: (customerId) => ipcRenderer.invoke('customerCredit:getBalance', customerId),
    getHistory: (customerId, limit, offset) => ipcRenderer.invoke('customerCredit:getHistory', customerId, limit, offset),
    getSummary: (search, limit, offset) => ipcRenderer.invoke('customerCredit:getSummary', search, limit, offset),
    record: (data) => ipcRenderer.invoke('customerCredit:record', data),
    applyToBooking: (data) => ipcRenderer.invoke('customerCredit:applyToBooking', data),
    refund: (data) => ipcRenderer.invoke('customerCredit:refund', data),
    reverse: (data) => ipcRenderer.invoke('customerCredit:reverse', data)
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
    getSupportBundle: (limit) => ipcRenderer.invoke('reports:getSupportBundle', limit),
    runFinancialValidation: () => ipcRenderer.invoke('reports:runFinancialValidation'),
    savePDF: (payload) => ipcRenderer.invoke('reports:savePDF', payload),
    printCurrent: () => ipcRenderer.invoke('reports:printCurrent'),
    saveExcel: (data) => ipcRenderer.invoke('reports:saveExcel', data),
    exportDetailedExcel: (payload) => ipcRenderer.invoke('reports:exportDetailedExcel', payload),
    exportDetailedPDF: (payload) => ipcRenderer.invoke('reports:exportDetailedPDF', payload),
    posSales: (start, end, outletId) => ipcRenderer.invoke('reports:posSales', start, end, outletId),
    inventorySpend: (start, end, outletId) => ipcRenderer.invoke('reports:inventorySpend', start, end, outletId),
    supplySpend: (start, end) => ipcRenderer.invoke('reports:supplySpend', start, end),
    nightAudit: (date) => ipcRenderer.invoke('reports:nightAudit', date),
    saveNightAuditExcel: (payload) => ipcRenderer.invoke('reports:saveNightAuditExcel', payload),
    profitLoss: (start, end) => ipcRenderer.invoke('reports:profitLoss', start, end),
    maintenanceRows: (start, end) => ipcRenderer.invoke('reports:maintenanceRows', start, end),
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
    update: (id, updates) => ipcRenderer.invoke('requests:update', id, updates),
    markRead: (id, audience, messageId) => ipcRenderer.invoke('requests:markRead', id, audience, messageId),
    addMessage: (id, payload) => ipcRenderer.invoke('requests:addMessage', id, payload)
  },
  notifications: {
    today: () => ipcRenderer.invoke('notifications:today'),
    upcoming: () => ipcRenderer.invoke('notifications:upcoming')
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  window: {
    repairInputFocus: (reason) => ipcRenderer.invoke('window:repairInputFocus', reason),
    onFocusRecovery: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('window:focus-recovery', listener)
      return () => ipcRenderer.off('window:focus-recovery', listener)
    }
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getProduct: () => ipcRenderer.invoke('app:getProduct'),
    notify: (payload) => ipcRenderer.invoke('app:notify', payload),
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
    verify: (name) => ipcRenderer.invoke('backup:verify', name),
    previewRestore: (name) => ipcRenderer.invoke('backup:previewRestore', name),
    createRestoreRehearsal: (name) => ipcRenderer.invoke('backup:createRestoreRehearsal', name),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
    openManagedFolder: () => ipcRenderer.invoke('backup:openManagedFolder')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data),
    updateOperatingProfile: (profile) => ipcRenderer.invoke('settings:updateOperatingProfile', profile),
    getDiagnostics: (expectedLodgeId) => ipcRenderer.invoke('settings:getDiagnostics', expectedLodgeId),
    getSystemHealth: (options) => ipcRenderer.invoke('settings:getSystemHealth', options),
    relinkLodge: (lodgeId) => ipcRenderer.invoke('settings:relinkLodge', lodgeId),
    resetToNewLodge: () => ipcRenderer.invoke('settings:resetToNewLodge')
  },
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    getDetails: () => ipcRenderer.invoke('sync:getDetails'),
    getOfflineMode: () => ipcRenderer.invoke('sync:getOfflineMode'),
    setOfflineMode: (payload) => ipcRenderer.invoke('sync:setOfflineMode', payload),
    exportOfflineOperations: () => ipcRenderer.invoke('sync:exportOfflineOperations'),
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
  mesh: {
    lockRoom: (roomId, startDate, endDate) => ipcRenderer.invoke('mesh:lockRoom', roomId, startDate, endDate),
    unlockRoom: (lockId) => ipcRenderer.invoke('mesh:unlockRoom', lockId),
    getDiagnostics: () => ipcRenderer.invoke('mesh:getDiagnostics'),
    refreshDiscovery: () => ipcRenderer.invoke('mesh:refreshDiscovery'),
    connectManualPeer: (address, port) => ipcRenderer.invoke('mesh:connectManualPeer', address, port || null),
    onConflictDetected: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('mesh:conflict-detected', listener)
      return () => ipcRenderer.off('mesh:conflict-detected', listener)
    }
  },
  trial: {
    getStatus: (lodgeId) => ipcRenderer.invoke('trial:getStatus', lodgeId),
    activateKey: (lodgeId, key) => ipcRenderer.invoke('trial:activateKey', lodgeId, key),
    getInvoices: (lodgeId) => ipcRenderer.invoke('trial:getInvoices', lodgeId)
  },
  usage: {
    getSnapshot: (options) => ipcRenderer.invoke('usage:getSnapshot', options)
  },
  updates: {
    onAvailable: (cb) => onIpc('update:available', cb),
    onNotAvailable: (cb) => onIpc('update:not-available', cb),
    onProgress: (cb) => onIpc('update:progress', cb),
    onReady: (cb) => onIpc('update:ready', cb),
    onError: (cb) => onIpc('update:error', cb),
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    getState: () => ipcRenderer.invoke('update:getState'),
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
    getMyOrders: (start, end) => ipcRenderer.invoke('pos:getMyOrders', start, end),
    getVoidHistory: (start, end) => ipcRenderer.invoke('pos:getVoidHistory', start, end),
    exportHistoryExcel: (filters) => ipcRenderer.invoke('pos:exportHistoryExcel', filters),
    exportHistoryPdf: (filters) => ipcRenderer.invoke('pos:exportHistoryPdf', filters),
    createOrder: (data) => ipcRenderer.invoke('pos:createOrder', data),
    voidOrder: (id) => ipcRenderer.invoke('pos:voidOrder', id),
    approveVoidWithPin: (data) => ipcRenderer.invoke('pos:approveVoidWithPin', data),
    approveDiscountWithPin: (data) => ipcRenderer.invoke('pos:approveDiscountWithPin', data),
    createPartialReturnWithPin: (data) => ipcRenderer.invoke('pos:createPartialReturnWithPin', data),
    getCashupSummary: (filters) => ipcRenderer.invoke('pos:getCashupSummary', filters),
    getCashups: (limit, filters) => ipcRenderer.invoke('pos:getCashups', limit, filters),
    createCashup: (data) => ipcRenderer.invoke('pos:createCashup', data),
    submitCashup: (data) => ipcRenderer.invoke('pos:submitCashup', data),
    submitCashupWithAttendancePin: (data) => ipcRenderer.invoke('pos:submitCashupWithAttendancePin', data),
    getMyCashupSubmission: (shiftId) => ipcRenderer.invoke('pos:getMyCashupSubmission', shiftId),
    getPendingCashupSubmissions: () => ipcRenderer.invoke('pos:getPendingCashupSubmissions'),
    reviewCashupSubmission: (data) => ipcRenderer.invoke('pos:reviewCashupSubmission', data),
    getTabs: (filters) => ipcRenderer.invoke('pos:getTabs', filters),
    saveTab: (data) => ipcRenderer.invoke('pos:saveTab', data),
    closeTab: (id) => ipcRenderer.invoke('pos:closeTab', id),
    updateTabStatus: (id, status) => ipcRenderer.invoke('pos:updateTabStatus', id, status),
    overrideTableTab: (data) => ipcRenderer.invoke('pos:overrideTableTab', data),
    splitBillByItems: (data) => ipcRenderer.invoke('pos:splitBillByItems', data),
    splitBillEvenly: (data) => ipcRenderer.invoke('pos:splitBillEvenly', data),
    getTablesWithStatus: (outletId) => ipcRenderer.invoke('pos:getTablesWithStatus', outletId),
    getActiveTableTab: (tableName, outletId) => ipcRenderer.invoke('pos:getActiveTableTab', tableName, outletId),
    openTableSession: (data) => ipcRenderer.invoke('pos:openTableSession', data),
    getTables: () => ipcRenderer.invoke('pos:getTables'),
    saveTable: (data) => ipcRenderer.invoke('pos:saveTable', data),
    deleteTable: (id) => ipcRenderer.invoke('pos:deleteTable', id),
    getStations: () => ipcRenderer.invoke('pos:getStations'),
    saveStation: (data) => ipcRenderer.invoke('pos:saveStation', data),
    deleteStation: (id) => ipcRenderer.invoke('pos:deleteStation', id),
    getTickets: (filters) => ipcRenderer.invoke('pos:getTickets', filters),
    updateTicketStatus: (id, status) => ipcRenderer.invoke('pos:updateTicketStatus', id, status),
    getCurrentShift: (outletId, cashierId) => ipcRenderer.invoke('pos:getCurrentShift', outletId, cashierId),
    getStaffOpenShift: (staffId) => ipcRenderer.invoke('pos:getStaffOpenShift', staffId),
    getStaffCashupSubmission: (shiftId) => ipcRenderer.invoke('pos:getStaffCashupSubmission', shiftId),
    activateSharedTillOperator: (data) => ipcRenderer.invoke('pos:activateSharedTillOperator', data),
    getSharedTillHistory: (start, end, options) => ipcRenderer.invoke('pos:getSharedTillHistory', start, end, options),
    lockSharedTillOperator: () => ipcRenderer.invoke('pos:lockSharedTillOperator'),
    linkMyShiftAttendance: (data) => ipcRenderer.invoke('pos:linkMyShiftAttendance', data),
    openShift: (data) => ipcRenderer.invoke('pos:openShift', data),
    closeShift: (data) => ipcRenderer.invoke('pos:closeShift', data),
    getHardwareSettings: () => ipcRenderer.invoke('pos:getHardwareSettings'),
    saveHardwareSettings: (data) => ipcRenderer.invoke('pos:saveHardwareSettings', data),
    testHardware: (kind) => ipcRenderer.invoke('pos:testHardware', kind),
    verifyBarcodeScanner: (data) => ipcRenderer.invoke('pos:verifyBarcodeScanner', data),
    openCashDrawer: (data) => ipcRenderer.invoke('pos:openCashDrawer', data),
    getStaff: () => ipcRenderer.invoke('pos:getStaff'),
    selectStaffWithPin: (data) => ipcRenderer.invoke('pos:selectStaffWithPin', data),
    getModifierGroups: () => ipcRenderer.invoke('pos:getModifierGroups'),
    saveModifierGroup: (data) => ipcRenderer.invoke('pos:saveModifierGroup', data),
    getPromotions: () => ipcRenderer.invoke('pos:getPromotions'),
    savePromotion: (data) => ipcRenderer.invoke('pos:savePromotion', data),
    getFloorLayout: () => ipcRenderer.invoke('pos:getFloorLayout'),
    saveFloorLayout: (data) => ipcRenderer.invoke('pos:saveFloorLayout', data),
    updateCustomerDisplay: (data) => ipcRenderer.invoke('pos:updateCustomerDisplay', data),
    getCustomerDisplay: () => ipcRenderer.invoke('pos:getCustomerDisplay'),
    openDisplay: (kind, options) => ipcRenderer.invoke('pos:openDisplay', kind, options),
    listDisplays: () => ipcRenderer.invoke('pos:listDisplays'),
    sendPaymentTerminalTotal: (data) => ipcRenderer.invoke('pos:sendPaymentTerminalTotal', data),
    getAuditLog: (limit) => ipcRenderer.invoke('pos:getAuditLog', limit),
    getActiveBookingForRoom: (roomId) => ipcRenderer.invoke('pos:getActiveBookingForRoom', roomId),
    getActiveEvents: () => ipcRenderer.invoke('pos:getActiveEvents'),
    getRecipes: () => ipcRenderer.invoke('pos:getRecipes'),
    saveRecipe: (data) => ipcRenderer.invoke('pos:saveRecipe', data),
    deleteRecipe: (recipeId) => ipcRenderer.invoke('pos:deleteRecipe', recipeId),
    getCustomers: () => ipcRenderer.invoke('pos:getCustomers'),
    saveCustomer: (data) => ipcRenderer.invoke('pos:saveCustomer', data),
    awardLoyalty: (data) => ipcRenderer.invoke('pos:awardLoyalty', data),
    redeemLoyalty: (data) => ipcRenderer.invoke('pos:redeemLoyalty', data),
    chargeCustomerAccount: (data) => ipcRenderer.invoke('pos:chargeCustomerAccount', data),
    redeemVoucher: (code, amount) => ipcRenderer.invoke('pos:redeemVoucher', code, amount),
    recordDelivery: (data) => ipcRenderer.invoke('pos:recordDelivery', data),
    clockInStaff: (data) => ipcRenderer.invoke('pos:clockInStaff', data),
    clockInSelfForPos: (data) => ipcRenderer.invoke('pos:clockInSelfForPos', data),
    clockInStaffWithAttendancePin: (data) => ipcRenderer.invoke('pos:clockInStaffWithAttendancePin', data),
    clockOutStaff: (data) => ipcRenderer.invoke('pos:clockOutStaff', data),
    clockOutStaffWithAttendancePin: (data) => ipcRenderer.invoke('pos:clockOutStaffWithAttendancePin', data),
    getActiveShifts: () => ipcRenderer.invoke('pos:getActiveShifts'),
    getRestaurantShiftPlans: (startDate, endDate) => ipcRenderer.invoke('pos:getRestaurantShiftPlans', startDate, endDate),
    saveRestaurantShiftPlan: (data) => ipcRenderer.invoke('pos:saveRestaurantShiftPlan', data),
    deleteRestaurantShiftPlan: (id) => ipcRenderer.invoke('pos:deleteRestaurantShiftPlan', id),
    openCashDrawerSession: (data) => ipcRenderer.invoke('pos:openCashDrawerSession', data),
    closeCashDrawerSession: (data) => ipcRenderer.invoke('pos:closeCashDrawerSession', data),
    getOpenCashDrawer: () => ipcRenderer.invoke('pos:getOpenCashDrawer'),
    getSuppliers: () => ipcRenderer.invoke('pos:getSuppliers'),
    createSupplier: (data) => ipcRenderer.invoke('pos:createSupplier', data),
    updateSupplier: (supplierId, data) => ipcRenderer.invoke('pos:updateSupplier', supplierId, data),
    createPurchaseOrder: (data) => ipcRenderer.invoke('pos:createPurchaseOrder', data),
    updatePurchaseOrderDraft: (orderId, data) => ipcRenderer.invoke('pos:updatePurchaseOrderDraft', orderId, data),
    savePurchaseOrderPdf: (orderId) => ipcRenderer.invoke('pos:savePurchaseOrderPdf', orderId),
    sendPurchaseOrderEmail: (orderId) => ipcRenderer.invoke('pos:sendPurchaseOrderEmail', orderId),
    approvePurchaseOrder: (orderId) => ipcRenderer.invoke('pos:approvePurchaseOrder', orderId),
    receivePurchaseOrder: (orderId, stockLocationId) => ipcRenderer.invoke('pos:receivePurchaseOrder', orderId, stockLocationId),
    createStockTransfer: (data) => ipcRenderer.invoke('pos:createStockTransfer', data),
    createChecklist: (data) => ipcRenderer.invoke('pos:createChecklist', data),
    completeChecklistItem: (data) => ipcRenderer.invoke('pos:completeChecklistItem', data),
    getActiveAlerts: () => ipcRenderer.invoke('pos:getActiveAlerts'),
    recordAlert: (data) => ipcRenderer.invoke('pos:recordAlert', data),
    resolveAlert: (alertId) => ipcRenderer.invoke('pos:resolveAlert', alertId),
    getPurchaseOrders: (startDate, endDate) => ipcRenderer.invoke('pos:getPurchaseOrders', startDate, endDate),
    getPurchasingSnapshot: () => ipcRenderer.invoke('pos:getPurchasingSnapshot').then((payload) => JSON.parse(payload)),
    getShiftHistory: (startDate, endDate) => ipcRenderer.invoke('pos:getShiftHistory', startDate, endDate),
    getCashDrawerSessions: (startDate, endDate) => ipcRenderer.invoke('pos:getCashDrawerSessions', startDate, endDate),
    getChecklists: () => ipcRenderer.invoke('pos:getChecklists'),
    getExceptionAlerts: () => ipcRenderer.invoke('pos:getExceptionAlerts'),
    generateOwnerDigest: () => ipcRenderer.invoke('pos:generateOwnerDigest'),
    // Phase 6.1 Reservations
    getRestaurantReservations: (startDate, endDate, outletId) => ipcRenderer.invoke('pos:getRestaurantReservations', startDate, endDate, outletId),
    createRestaurantReservation: (data) => ipcRenderer.invoke('pos:createRestaurantReservation', data),
    updateRestaurantReservation: (id, data) => ipcRenderer.invoke('pos:updateRestaurantReservation', id, data),
    cancelRestaurantReservation: (id, reason) => ipcRenderer.invoke('pos:cancelRestaurantReservation', id, reason),
    seatRestaurantReservation: (id, tableId) => ipcRenderer.invoke('pos:seatRestaurantReservation', id, tableId),
    markRestaurantReservationNoShow: (id, reason) => ipcRenderer.invoke('pos:markRestaurantReservationNoShow', id, reason),
    getRestaurantWaitlist: (outletId, includeReservationWaitlist) => ipcRenderer.invoke('pos:getRestaurantWaitlist', outletId, includeReservationWaitlist),
    createRestaurantWaitlistEntry: (data) => ipcRenderer.invoke('pos:createRestaurantWaitlistEntry', data),
    updateRestaurantWaitlistEntry: (id, data) => ipcRenderer.invoke('pos:updateRestaurantWaitlistEntry', id, data),
    removeRestaurantWaitlistEntry: (id, reason) => ipcRenderer.invoke('pos:removeRestaurantWaitlistEntry', id, reason),
    seatRestaurantWaitlistEntry: (id, tableId) => ipcRenderer.invoke('pos:seatRestaurantWaitlistEntry', id, tableId),
    serviceRestaurantReservationAction: (id, action, tableIds) => ipcRenderer.invoke('pos:serviceRestaurantReservationAction', id, action, tableIds),
    // Phase 6.2 Combos
    getRestaurantCombos: (outletId) => ipcRenderer.invoke('pos:getRestaurantCombos', outletId),
    saveRestaurantCombo: (data) => ipcRenderer.invoke('pos:saveRestaurantCombo', data),
    deleteRestaurantCombo: (comboId) => ipcRenderer.invoke('pos:deleteRestaurantCombo', comboId),
    // Phase 6.3 Recipe Variance
    getRecipeVarianceReport: (startDate, endDate, outletId) => ipcRenderer.invoke('pos:getRecipeVarianceReport', startDate, endDate, outletId),
    getRecipePreparationLosses: (startDate, endDate, outletId) => ipcRenderer.invoke('pos:getRecipePreparationLosses', startDate, endDate, outletId),
    getRecipePreparationLossIngredientSummary: (startDate, endDate, outletId) => ipcRenderer.invoke('pos:getRecipePreparationLossIngredientSummary', startDate, endDate, outletId),
    // Phase 6.5 Prep Batches
    getRestaurantPrepItems: () => ipcRenderer.invoke('pos:getRestaurantPrepItems'),
    saveRestaurantPrepItem: (data) => ipcRenderer.invoke('pos:saveRestaurantPrepItem', data),
    getRestaurantPrepBatches: (startDate, endDate, outletId) => ipcRenderer.invoke('pos:getRestaurantPrepBatches', startDate, endDate, outletId),
    createRestaurantPrepBatch: (data) => ipcRenderer.invoke('pos:createRestaurantPrepBatch', data),
    postRestaurantPrepBatch: (batchId) => ipcRenderer.invoke('pos:postRestaurantPrepBatch', batchId),
    // Phase 6.6 Kitchen Timing
    recordTicketStatusEvent: (data) => ipcRenderer.invoke('pos:recordTicketStatusEvent', data),
    getKitchenTimingReport: (startDate, endDate, outletId, station) => ipcRenderer.invoke('pos:getKitchenTimingReport', startDate, endDate, outletId, station),
    // Phase 6.7 Purchase Suggestions
    getLowStockPurchaseSuggestions: (outletId) => ipcRenderer.invoke('pos:getLowStockPurchaseSuggestions', outletId),
    setPreferredSupplierForInventoryItem: (inventoryItemId, supplierId, lastUnitCost) => ipcRenderer.invoke('pos:setPreferredSupplierForInventoryItem', inventoryItemId, supplierId, lastUnitCost),
    convertPurchaseSuggestionsToPo: (supplierId, suggestions, notes) => ipcRenderer.invoke('pos:convertPurchaseSuggestionsToPo', supplierId, suggestions, notes),
    recordSettlement: (data) => ipcRenderer.invoke('pos:recordSettlement', data),
    getSettlements: (businessDate) => ipcRenderer.invoke('pos:getSettlements', businessDate),
    getSettlementExpectedTotal: (startDate, endDate, channel) => ipcRenderer.invoke('pos:getSettlementExpectedTotal', startDate, endDate, channel),
    recordReservationDeposit: (data) => ipcRenderer.invoke('pos:recordReservationDeposit', data),
    getReservationDeposits: (days) => ipcRenderer.invoke('pos:getReservationDeposits', days),
    getRestaurantOutletControls: () => ipcRenderer.invoke('pos:getRestaurantOutletControls'),
    getRestaurantStockLocations: () => ipcRenderer.invoke('pos:getRestaurantStockLocations'),
    getRestaurantStockLocationBalances: () => ipcRenderer.invoke('pos:getRestaurantStockLocationBalances'),
    createRestaurantStockLocation: (data) => ipcRenderer.invoke('pos:createRestaurantStockLocation', data),
    updateRestaurantStockLocation: (locationId, data) => ipcRenderer.invoke('pos:updateRestaurantStockLocation', locationId, data),
    deleteRestaurantStockLocation: (locationId) => ipcRenderer.invoke('pos:deleteRestaurantStockLocation', locationId),
    setRestaurantOutletStockLocation: (outletId, stockLocationId) => ipcRenderer.invoke('pos:setRestaurantOutletStockLocation', outletId, stockLocationId),
    createRestaurantOutlet: (data) => ipcRenderer.invoke('pos:createRestaurantOutlet', data),
    updateRestaurantOutlet: (outletId, data) => ipcRenderer.invoke('pos:updateRestaurantOutlet', outletId, data),
    recordFeedback: (data) => ipcRenderer.invoke('pos:recordFeedback', data),
    submitStaffFeedback: (data) => ipcRenderer.invoke('pos:submitStaffFeedback', data),
    getFeedback: (days) => ipcRenderer.invoke('pos:getFeedback', days),
    getSetupProgress: () => ipcRenderer.invoke('pos:getSetupProgress'),
    setSetupStage: (data) => ipcRenderer.invoke('pos:setSetupStage', data)
    ,createGiftCard: (data) => ipcRenderer.invoke('pos:createGiftCard', data)
    ,recordTipPayout: (data) => ipcRenderer.invoke('pos:recordTipPayout', data)
    ,getTipPayouts: (days) => ipcRenderer.invoke('pos:getTipPayouts', days)
    ,getTipBalances: (days) => ipcRenderer.invoke('pos:getTipBalances', days)
    ,saveReservationPolicy: (data) => ipcRenderer.invoke('pos:saveReservationPolicy', data)
    ,recordInventoryLot: (data) => ipcRenderer.invoke('pos:recordInventoryLot', data)
    ,updateInventoryLotExpiry: (lotId, data) => ipcRenderer.invoke('pos:updateInventoryLotExpiry', lotId, data)
    ,writeOffExpiredInventoryLot: (lotId, data) => ipcRenderer.invoke('pos:writeOffExpiredInventoryLot', lotId, data)
    ,getExpiryLots: (days) => ipcRenderer.invoke('pos:getExpiryLots', days)
  },
  inventory: {
    getItems: () => ipcRenderer.invoke('inventory:getItems'),
    getBarStockAging: (outletId) => ipcRenderer.invoke('inventory:getBarStockAging', outletId || null),
    createItem: (data) => ipcRenderer.invoke('inventory:createItem', data),
    updateItem: (id, data) => ipcRenderer.invoke('inventory:updateItem', id, data),
    deleteItem: (id) => ipcRenderer.invoke('inventory:deleteItem', id),
    addPurchase: (data) => ipcRenderer.invoke('inventory:addPurchase', data),
    getPurchases: (itemId) => ipcRenderer.invoke('inventory:getPurchases', itemId),
    adjustStock: (itemId, delta, notes, managerPin, adjustmentId) => ipcRenderer.invoke('inventory:adjustStock', itemId, delta, notes, managerPin, adjustmentId),
    getMovements: (filters) => ipcRenderer.invoke('inventory:getMovements', filters),
    getLowStock: () => ipcRenderer.invoke('inventory:getLowStock'),
    getStocktakes: (limit) => ipcRenderer.invoke('inventory:getStocktakes', limit),
    getRestaurantStockSnapshot: (movementDate) => ipcRenderer.invoke('inventory:getRestaurantStockSnapshot', movementDate).then((payload) => JSON.parse(payload)),
    createStocktake: (data) => ipcRenderer.invoke('inventory:createStocktake', data),
    getStocktake: (stocktakeId) => ipcRenderer.invoke('inventory:getStocktake', stocktakeId),
    saveStocktakeCounts: (stocktakeId, lines) => ipcRenderer.invoke('inventory:saveStocktakeCounts', stocktakeId, lines),
    postStocktake: (stocktakeId, notes) => ipcRenderer.invoke('inventory:postStocktake', stocktakeId, notes),
    discardDraft: (id) => ipcRenderer.invoke('inventory:discardDraft', id)
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
    exportReportPdf: (payload) => ipcRenderer.invoke('supplies:exportReportPdf', payload),
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
    getCommandCentralReauthStatus: () => ipcRenderer.invoke('admin:getCommandCentralReauthStatus'),
    reauthenticateCommandCentral: (password) => ipcRenderer.invoke('admin:reauthenticateCommandCentral', password),
    exists: () => ipcRenderer.invoke('admin:exists'),
    setup: (name, email, password) => ipcRenderer.invoke('admin:setup', name, email, password),
    getCompanies: () => ipcRenderer.invoke('admin:getCompanies'),
    getLicenses: () => ipcRenderer.invoke('admin:getLicenses'),
    createLicense: (data) => ipcRenderer.invoke('admin:createLicense', data),
    issueSubscriptionContract: (payload) => ipcRenderer.invoke('admin:issueSubscriptionContract', payload),
    assignCommercialSubscription: (payload) => ipcRenderer.invoke('admin:assignCommercialSubscription', payload),
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
    addSupportTicketMessage: (id, payload) => ipcRenderer.invoke('admin:addSupportTicketMessage', id, payload),
    deleteSupportTicket: (id) => ipcRenderer.invoke('admin:deleteSupportTicket', id),
    // Activity logs
    getActivityLogs: (filters) => ipcRenderer.invoke('admin:getActivityLogs', filters),
    getAuditSummary: (filters) => ipcRenderer.invoke('admin:getAuditSummary', filters),
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
    getClientBookingInvoices: (lodgeId) => ipcRenderer.invoke('admin:getClientBookingInvoices', lodgeId),
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
    applyCompanyLifecycle: (payload) => ipcRenderer.invoke('admin:applyCompanyLifecycle', payload),
    permanentlyDeleteCompany: (lodgeId) => ipcRenderer.invoke('admin:permanentlyDeleteCompany', lodgeId),
    repairDuplicateEventBookings: (lodgeId) => ipcRenderer.invoke('admin:repairDuplicateEventBookings', lodgeId),
    // Expenses
    getExpenses: () => ipcRenderer.invoke('admin:getExpenses'),
    createExpense: (data) => ipcRenderer.invoke('admin:createExpense', data),
    updateExpense: (id, data) => ipcRenderer.invoke('admin:updateExpense', id, data),
    deleteExpense: (id) => ipcRenderer.invoke('admin:deleteExpense', id),
    getMarketingLeads: (filters) => ipcRenderer.invoke('admin:getMarketingLeads', filters),
    updateMarketingLeadStatus: (id, status) => ipcRenderer.invoke('admin:updateMarketingLeadStatus', id, status),
    updateLeadCrm: (id, fields) => ipcRenderer.invoke('admin:updateLeadCrm', id, fields),
    getSalesPipelineSummary: () => ipcRenderer.invoke('admin:getSalesPipelineSummary'),
    exportExcel: (payload) => ipcRenderer.invoke('admin:exportExcel', payload),
    exportPdf: (payload) => ipcRenderer.invoke('admin:exportPdf', payload),
    createNotification: (payload) => ipcRenderer.invoke('admin:createNotification', payload),
    getNotifications: (filters) => ipcRenderer.invoke('admin:getNotifications', filters),
    getUnreadCount: () => ipcRenderer.invoke('admin:getUnreadCount'),
    markNotificationsRead: (ids) => ipcRenderer.invoke('admin:markNotificationsRead', ids),
    cleanupNotifications: (days) => ipcRenderer.invoke('admin:cleanupNotifications', days),
    getFleetHealthRollup: () => ipcRenderer.invoke('admin:getFleetHealthRollup'),
    getFleetHealthSummary: () => ipcRenderer.invoke('admin:getFleetHealthSummary'),
    recordCommandCentralHealthRun: (payload) => ipcRenderer.invoke('admin:recordCommandCentralHealthRun', payload),
    listCommandCentralHealthRuns: (limit) => ipcRenderer.invoke('admin:listCommandCentralHealthRuns', limit),
    getScheduledReleases: () => ipcRenderer.invoke('admin:getScheduledReleases'),
    expireOverdueFeatures: () => ipcRenderer.invoke('admin:expireOverdueFeatures'),
    // Notification Automation
    getNotificationRules: () => ipcRenderer.invoke('admin:getNotificationRules'),
    upsertNotificationRule: (rule) => ipcRenderer.invoke('admin:upsertNotificationRule', rule),
    evaluateRule: (ruleKey) => ipcRenderer.invoke('admin:evaluateRule', ruleKey),
    evaluateAllRules: () => ipcRenderer.invoke('admin:evaluateAllRules'),
    getNotificationEvents: (opts) => ipcRenderer.invoke('admin:getNotificationEvents', opts),
    getNotificationEventSummary: () => ipcRenderer.invoke('admin:getNotificationEventSummary'),
    markEventsDispatched: (eventIds) => ipcRenderer.invoke('admin:markEventsDispatched', eventIds),
    // Accounting
    getMrrSummary: () => ipcRenderer.invoke('admin:getMrrSummary'),
    getRevenueSummary: (days) => ipcRenderer.invoke('admin:getRevenueSummary', days),
    getLodgeFinancialSummary: () => ipcRenderer.invoke('admin:getLodgeFinancialSummary'),
    getCollectionsQueue: () => ipcRenderer.invoke('admin:getCollectionsQueue'),
    getRevenueByMethod: (days) => ipcRenderer.invoke('admin:getRevenueByMethod', days),
    generateCommercialInvoice: (payload) => ipcRenderer.invoke('admin:generateCommercialInvoice', payload),
    recordCommercialPayment: (payload) => ipcRenderer.invoke('admin:recordCommercialPayment', payload),
    getCommercialInvoices: (filters) => ipcRenderer.invoke('admin:getCommercialInvoices', filters),
    getCommercialBillingSummary: () => ipcRenderer.invoke('admin:getCommercialBillingSummary'),
    // Task Center
    getAdminToday: () => ipcRenderer.invoke('admin:getAdminToday'),
    // Global Search
    globalSearch: (query, limit) => ipcRenderer.invoke('admin:globalSearch', query, limit),
    // Bulk Actions
    bulkUpdateStatus: (entityType, entityIds, newStatus) => ipcRenderer.invoke('admin:bulkUpdateStatus', entityType, entityIds, newStatus),
    bulkDelete: (entityType, entityIds) => ipcRenderer.invoke('admin:bulkDelete', entityType, entityIds),
    bulkNotify: (entityType, entityIds, message) => ipcRenderer.invoke('admin:bulkNotify', entityType, entityIds, message),
    // Deep Fleet Health + App Update Control
    pushUpdateNotification: (version, message, force) => ipcRenderer.invoke('admin:pushUpdateNotification', version, message, force),
    getSyncQueueStatus: () => ipcRenderer.invoke('admin:getSyncQueueStatus'),
    // Release Rollout Control
    createRelease: (release) => ipcRenderer.invoke('admin:createRelease', release),
    updateRelease: (version, updates) => ipcRenderer.invoke('admin:updateRelease', version, updates),
    checkUpdateAvailability: (currentVersion, deviceId) => ipcRenderer.invoke('admin:checkUpdateAvailability', currentVersion, deviceId),
    getReleases: (productId) => ipcRenderer.invoke('admin:getReleases', productId),
    getSurfaceIntelligence: () => ipcRenderer.invoke('admin:getSurfaceIntelligence')
  },
  conference: {
    getAll: (start, end) => ipcRenderer.invoke('conference:getAll', start, end),
    create: (data) => ipcRenderer.invoke('conference:create', data),
    update: (id, data) => ipcRenderer.invoke('conference:update', id, data),
    delete: (id) => ipcRenderer.invoke('conference:delete', id),
    updatePayment: (id, amount, method, intentKey) => ipcRenderer.invoke('conference:updatePayment', id, amount, method, intentKey)
  },
  events: {
    getAll: (start, end) => ipcRenderer.invoke('events:getAll', start, end),
    getById: (id) => ipcRenderer.invoke('events:getById', id),
    getDetails: (id) => ipcRenderer.invoke('events:getDetails', id),
    create: (data) => ipcRenderer.invoke('events:create', data),
    update: (id, data) => ipcRenderer.invoke('events:update', id, data),
    cancel: (id, reason, cancelLinkedRooms) => ipcRenderer.invoke('events:cancel', id, reason, cancelLinkedRooms),
    addLineItem: (data) => ipcRenderer.invoke('events:addLineItem', data),
    voidLineItem: (lineItemId, reason) => ipcRenderer.invoke('events:voidLineItem', lineItemId, reason),
    updatePayment: (id, amount, method, type, intentKey) => ipcRenderer.invoke('events:updatePayment', id, amount, method, type, intentKey),
    checkAvailability: (resourceKey, startAt, endAt, excludeEventId) => ipcRenderer.invoke('events:checkAvailability', resourceKey, startAt, endAt, excludeEventId),
    getVenuePackages: (category, activeOnly) => ipcRenderer.invoke('events:getVenuePackages', category, activeOnly),
    createVenuePackage: (data) => ipcRenderer.invoke('events:createVenuePackage', data),
    updateVenuePackage: (id, data) => ipcRenderer.invoke('events:updateVenuePackage', id, data),
    deleteVenuePackage: (id) => ipcRenderer.invoke('events:deleteVenuePackage', id),
    applyPackage: (packageId, eventBookingId, quantity, intentKey) => ipcRenderer.invoke('events:applyPackage', packageId, eventBookingId, quantity, intentKey)
  },
  venueManagement: {
    getEventLeads:                 (status)                                           => ipcRenderer.invoke('venueManagement:getEventLeads', status),
    createEventLead:               (data)                                             => ipcRenderer.invoke('venueManagement:createEventLead', data),
    updateEventLead:               (id, data)                                         => ipcRenderer.invoke('venueManagement:updateEventLead', id, data),
    convertLeadToBooking:          (leadId)                                           => ipcRenderer.invoke('venueManagement:convertLeadToBooking', leadId),
    getVenueAvailabilityRules:     (resourceKey)                                      => ipcRenderer.invoke('venueManagement:getVenueAvailabilityRules', resourceKey),
    upsertVenueAvailabilityRule:    (data)                                             => ipcRenderer.invoke('venueManagement:upsertVenueAvailabilityRule', data),
    getVenueAvailabilityCalendar:   (resourceKey, startDate, endDate)                  => ipcRenderer.invoke('venueManagement:getVenueAvailabilityCalendar', resourceKey, startDate, endDate),
    getRunSheet:                   (eventBookingId)                                   => ipcRenderer.invoke('venueManagement:getRunSheet', eventBookingId),
    createRunSheet:                (data)                                             => ipcRenderer.invoke('venueManagement:createRunSheet', data),
    updateRunSheet:                (id, data)                                         => ipcRenderer.invoke('venueManagement:updateRunSheet', id, data),
    finalizeRunSheet:              (id)                                               => ipcRenderer.invoke('venueManagement:finalizeRunSheet', id),
    executeRunSheet:               (id)                                               => ipcRenderer.invoke('venueManagement:executeRunSheet', id),
    getEventSuppliers:             (eventBookingId)                                   => ipcRenderer.invoke('venueManagement:getEventSuppliers', eventBookingId),
    createSupplierEntry:           (data)                                             => ipcRenderer.invoke('venueManagement:createSupplierEntry', data),
    updateSupplierEntry:           (id, data)                                         => ipcRenderer.invoke('venueManagement:updateSupplierEntry', id, data),
    updateSupplierStatus:          (id, status, actualAmount)                         => ipcRenderer.invoke('venueManagement:updateSupplierStatus', id, status, actualAmount),
    getDepositMilestones:          (eventBookingId)                                   => ipcRenderer.invoke('venueManagement:getDepositMilestones', eventBookingId),
    createDepositMilestone:        (data)                                             => ipcRenderer.invoke('venueManagement:createDepositMilestone', data),
    markMilestonePaid:             (id, paidDate, method, reference)                  => ipcRenderer.invoke('venueManagement:markMilestonePaid', id, paidDate, method, reference),
    waiveMilestone:                (id, reason)                                       => ipcRenderer.invoke('venueManagement:waiveMilestone', id, reason),
    settleEvent:                   (eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes) => ipcRenderer.invoke('venueManagement:settleEvent', eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes),
    getEventProfitability:         (eventBookingId)                                   => ipcRenderer.invoke('venueManagement:getEventProfitability', eventBookingId),
    getVenueProfitabilityReport:   (startDate, endDate)                               => ipcRenderer.invoke('venueManagement:getVenueProfitabilityReport', startDate, endDate)
  },
  ai: {
    turn: (payload) => ipcRenderer.invoke('ai:turn', payload),
    catalog: () => ipcRenderer.invoke('ai:catalog'),
    execute: (payload) => ipcRenderer.invoke('ai:execute', payload),
    collections: {
      preview: (payload) => ipcRenderer.invoke('ai:collections:preview', payload),
      execute: (payload) => ipcRenderer.invoke('ai:collections:execute', payload),
      onProgress: (cb) => {
        const listener = (_, data) => cb(data)
        ipcRenderer.on('ai:collections:progress', listener)
        return () => ipcRenderer.off('ai:collections:progress', listener)
      }
    },
    overdue: {
      preview: (payload) => ipcRenderer.invoke('ai:overdue:preview', payload),
      execute: (payload) => ipcRenderer.invoke('ai:overdue:execute', payload),
      onProgress: (cb) => {
        const listener = (_, data) => cb(data)
        ipcRenderer.on('ai:overdue:progress', listener)
        return () => ipcRenderer.off('ai:overdue:progress', listener)
      }
    },
    onAlert: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('ai:alert', listener)
      return () => ipcRenderer.off('ai:alert', listener)
    }
  },
  import: {
    parseExcel: (filePath) => ipcRenderer.invoke('import:parseExcel', filePath),
    getDroppedFilePath: (file) => webUtils?.getPathForFile?.(file) || file?.path || '',
    exportErrors: (payload) => ipcRenderer.invoke('import:exportErrors', payload),
    execute: (rows, filename, type) => ipcRenderer.invoke('import:execute', rows, filename, type),
    dryRun: (rows, type) => ipcRenderer.invoke('import:dryRun', rows, type),
    getTypes: () => ipcRenderer.invoke('import:getTypes'),
    checkDuplicates: (rows) => ipcRenderer.invoke('import:checkDuplicates', rows),
    undoBatch: (batchId) => ipcRenderer.invoke('import:undoBatch', batchId),
    getBatches: () => ipcRenderer.invoke('import:getBatches'),
    downloadTemplate: (type) => ipcRenderer.invoke('import:downloadTemplate', type),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('import:progress', handler)
      return () => ipcRenderer.removeListener('import:progress', handler)
    }
  },
  data: {
    exportAll: (options) => ipcRenderer.invoke('data:exportAll', options),
    onExportProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('data:exportProgress', handler)
      return () => ipcRenderer.removeListener('data:exportProgress', handler)
    }
  },
  dayuse: {
    getAll: (start, end) => ipcRenderer.invoke('dayuse:getAll', start, end),
    add: (data) => ipcRenderer.invoke('dayuse:add', data),
    delete: (id) => ipcRenderer.invoke('dayuse:delete', id),
    updateStatus: (id, status) => ipcRenderer.invoke('dayuse:updateStatus', id, status),
    settleBalance: (id, method, markCompleted = true) => ipcRenderer.invoke('dayuse:settleBalance', id, method, markCompleted),
    summary: (date) => ipcRenderer.invoke('dayuse:summary', date),
    getInventoryItems: () => ipcRenderer.invoke('dayuse:getInventoryItems'),
    getConfig: () => ipcRenderer.invoke('dayuse:getConfig'),
    saveConfig: (data) => ipcRenderer.invoke('dayuse:saveConfig', data)
  },
  email: {
    getConfig: () => ipcRenderer.invoke('email:getConfig'),
    saveConfig: (config) => ipcRenderer.invoke('email:saveConfig', config),
    test: (config) => ipcRenderer.invoke('email:test', config),
    sendLicense: (payload) => ipcRenderer.invoke('email:sendLicense', payload)
  },
  hotel: {
    getDashboardStats: () => ipcRenderer.invoke('hotel:getDashboardStats'),
    getArrivals:      () => ipcRenderer.invoke('hotel:getArrivals'),
    getDepartures:    () => ipcRenderer.invoke('hotel:getDepartures'),
    getInHouse:       () => ipcRenderer.invoke('hotel:getInHouse'),
    getNoShows:       () => ipcRenderer.invoke('hotel:getNoShows'),
    getKpis:          (days) => ipcRenderer.invoke('hotel:getKpis', days),
    getApplicableRoomRate: (roomId, date, corporateAccountId) =>
      ipcRenderer.invoke('hotel:getApplicableRoomRate', roomId, date, corporateAccountId),
    quoteRoomStay: (roomId, checkIn, checkOut, corporateAccountId) =>
      ipcRenderer.invoke('hotel:quoteRoomStay', roomId, checkIn, checkOut, corporateAccountId)
  },
  roomTypes: {
    getAll:  ()                    => ipcRenderer.invoke('roomTypes:getAll'),
    create:  (data)               => ipcRenderer.invoke('roomTypes:create', data),
    update:  (id, data)           => ipcRenderer.invoke('roomTypes:update', id, data),
    delete:  (id)                 => ipcRenderer.invoke('roomTypes:delete', id)
  },
  roomAttributes: {
    getAll:  ()                    => ipcRenderer.invoke('roomAttributes:getAll'),
    create:  (data)               => ipcRenderer.invoke('roomAttributes:create', data),
    update:  (id, data)           => ipcRenderer.invoke('roomAttributes:update', id, data),
    delete:  (id)                 => ipcRenderer.invoke('roomAttributes:delete', id)
  },
  floorSections: {
    getAll:  ()                    => ipcRenderer.invoke('floorSections:getAll'),
    create:  (data)               => ipcRenderer.invoke('floorSections:create', data),
    update:  (id, data)           => ipcRenderer.invoke('floorSections:update', id, data),
    delete:  (id)                 => ipcRenderer.invoke('floorSections:delete', id)
  },
  folios: {
    getAll:      ()             => ipcRenderer.invoke('folios:getAll'),
    getEntries:  (bookingId)    => ipcRenderer.invoke('folios:getEntries', bookingId),
    postCharge:  (bookingId, data) => ipcRenderer.invoke('folios:postCharge', bookingId, data)
  },
  folioLedger: {
    getFolios:      (bookingId)                    => ipcRenderer.invoke('folioLedger:getFolios', bookingId),
    getLineItems:   (folioId)                      => ipcRenderer.invoke('folioLedger:getLineItems', folioId),
    createFolio:    (bookingId, guestId, type, label, intentId) => ipcRenderer.invoke('folioLedger:createFolio', bookingId, guestId, type, label, intentId),
    addCharge:      (folioId, amount, description, refType, refId, intentId) => ipcRenderer.invoke('folioLedger:addCharge', folioId, amount, description, refType, refId, intentId),
    addPayment:     (folioId, amount, description, intentId) => ipcRenderer.invoke('folioLedger:addPayment', folioId, amount, description, intentId),
    transferCharge: (srcFolioId, tgtFolioId, amount, description, intentId) => ipcRenderer.invoke('folioLedger:transferCharge', srcFolioId, tgtFolioId, amount, description, intentId),
    splitFolio:     (srcFolioId, tgtType, tgtLabel, amount, description, intentId) => ipcRenderer.invoke('folioLedger:splitFolio', srcFolioId, tgtType, tgtLabel, amount, description, intentId),
    voidLineItem:   (lineItemId, reason, intentId)            => ipcRenderer.invoke('folioLedger:voidLineItem', lineItemId, reason, intentId),
    closeFolio:     (folioId, intentId)                       => ipcRenderer.invoke('folioLedger:closeFolio', folioId, intentId),
    reopenFolio:    (folioId, intentId)                       => ipcRenderer.invoke('folioLedger:reopenFolio', folioId, intentId),
    lockFolio:      (folioId, intentId)                       => ipcRenderer.invoke('folioLedger:lockFolio', folioId, intentId),
    getBalance:     (folioId)                       => ipcRenderer.invoke('folioLedger:getBalance', folioId)
  },
  roomMoves: {
    getAvailable: (currentRoomId, checkIn, checkOut) => ipcRenderer.invoke('roomMoves:getAvailable', currentRoomId, checkIn, checkOut),
    execute:      (bookingId, targetRoomId, reason, actorName) => ipcRenderer.invoke('roomMoves:execute', bookingId, targetRoomId, reason, actorName)
  },
  corporateAccounts: {
    getAll:  ()        => ipcRenderer.invoke('corporateAccounts:getAll'),
    create:  (data)    => ipcRenderer.invoke('corporateAccounts:create', data),
    update:  (id, data) => ipcRenderer.invoke('corporateAccounts:update', id, data),
    delete:  (id)      => ipcRenderer.invoke('corporateAccounts:delete', id)
  },
  corporateBilling: {
    charge:          (accountId, bookingId, amount, description, intentId) => ipcRenderer.invoke('corporateBilling:charge', accountId, bookingId, amount, description, intentId),
    getOutstanding:  (accountId)                                  => ipcRenderer.invoke('corporateBilling:getOutstanding', accountId),
    recordPayment:   (accountId, invoiceIds, amount, method, reference, intentId) => ipcRenderer.invoke('corporateBilling:recordPayment', accountId, invoiceIds, amount, method, reference, intentId),
    getStatement:    (accountId, start, end)                      => ipcRenderer.invoke('corporateBilling:getStatement', accountId, start, end),
    checkCreditLimit:(accountId, pendingAmount)                    => ipcRenderer.invoke('corporateBilling:checkCreditLimit', accountId, pendingAmount),
    suspend:         (accountId, reason)                           => ipcRenderer.invoke('corporateBilling:suspend', accountId, reason),
    reactivate:      (accountId)                                   => ipcRenderer.invoke('corporateBilling:reactivate', accountId)
  },
  ratePlans: {
    getAll:  ()        => ipcRenderer.invoke('ratePlans:getAll'),
    create:  (data)    => ipcRenderer.invoke('ratePlans:create', data),
    update:  (id, data) => ipcRenderer.invoke('ratePlans:update', id, data),
    delete:  (id)      => ipcRenderer.invoke('ratePlans:delete', id),
    quoteRoomStay: (roomId, checkIn, checkOut, corporateAccountId) =>
      ipcRenderer.invoke('ratePlans:quoteRoomStay', roomId, checkIn, checkOut, corporateAccountId)
  },
  rateCalendar: {
    get: (roomTypeId, startDate, endDate) => ipcRenderer.invoke('rateCalendar:get', roomTypeId, startDate, endDate),
    setEntry: (roomTypeId, date, amount, currency) => ipcRenderer.invoke('rateCalendar:setEntry', roomTypeId, date, amount, currency),
    setBulk: (entries) => ipcRenderer.invoke('rateCalendar:setBulk', entries),
    setRestriction: (roomTypeId, date, restrictions) => ipcRenderer.invoke('rateCalendar:setRestriction', roomTypeId, date, restrictions),
    getConflicts: (roomTypeId, startDate, endDate) => ipcRenderer.invoke('rateCalendar:getConflicts', roomTypeId, startDate, endDate),
    getApplicableRate: (roomTypeId, date) => ipcRenderer.invoke('rateCalendar:getApplicableRate', roomTypeId, date),
    quoteStayTotal: (roomId, checkIn, checkOut, corporateAccountId) =>
      ipcRenderer.invoke('rateCalendar:quoteStayTotal', roomId, checkIn, checkOut, corporateAccountId),
    getYieldRules: () => ipcRenderer.invoke('rateCalendar:getYieldRules'),
    createYieldRule: (data) => ipcRenderer.invoke('rateCalendar:createYieldRule', data),
    updateYieldRule: (id, data) => ipcRenderer.invoke('rateCalendar:updateYieldRule', id, data),
    deleteYieldRule: (id) => ipcRenderer.invoke('rateCalendar:deleteYieldRule', id),
    getApplicableYieldAdjustment: (date, currentOccupancyPct) => ipcRenderer.invoke('rateCalendar:getApplicableYieldAdjustment', date, currentOccupancyPct),
    calculateOccupancyBasedRate: (baseRate, date, roomTypeId) => ipcRenderer.invoke('rateCalendar:calculateOccupancyBasedRate', baseRate, date, roomTypeId),
    getOccupancyForecast: (startDate, endDate) => ipcRenderer.invoke('rateCalendar:getOccupancyForecast', startDate, endDate)
  },
  promoCodes: {
    getAll: () => ipcRenderer.invoke('promoCodes:getAll'),
    create: (data) => ipcRenderer.invoke('promoCodes:create', data),
    update: (id, data) => ipcRenderer.invoke('promoCodes:update', id, data),
    delete: (id) => ipcRenderer.invoke('promoCodes:delete', id),
    validate: (code, roomTypeId, nights) => ipcRenderer.invoke('promoCodes:validate', code, roomTypeId, nights)
  },
  seasonLabels: {
    getAll: () => ipcRenderer.invoke('seasonLabels:getAll'),
    create: (data) => ipcRenderer.invoke('seasonLabels:create', data),
    update: (id, data) => ipcRenderer.invoke('seasonLabels:update', id, data),
    delete: (id) => ipcRenderer.invoke('seasonLabels:delete', id)
  },
  revenueManager: {
    getForecast: (startDate, endDate) => ipcRenderer.invoke('revenueManager:getForecast', startDate, endDate),
    upsertForecast: (date, occupancyPct, adr, notes) => ipcRenderer.invoke('revenueManager:upsertForecast', date, occupancyPct, adr, notes),
    getCompetitorNotes: () => ipcRenderer.invoke('revenueManager:getCompetitorNotes'),
    createCompetitorNote: (competitorName, roomTypeId, notedRate, notes) => ipcRenderer.invoke('revenueManager:createCompetitorNote', competitorName, roomTypeId, notedRate, notes),
    getDemandEvents: (startDate, endDate) => ipcRenderer.invoke('revenueManager:getDemandEvents', startDate, endDate),
    createDemandEvent: (eventName, eventDate, expectedImpact, notes) => ipcRenderer.invoke('revenueManager:createDemandEvent', eventName, eventDate, expectedImpact, notes),
    getRecommendations: () => ipcRenderer.invoke('revenueManager:getRecommendations'),
    approveRecommendation: (recommendation, notes) => ipcRenderer.invoke('revenueManager:approveRecommendation', recommendation, notes),
    rejectRecommendation: (recommendation, reason) => ipcRenderer.invoke('revenueManager:rejectRecommendation', recommendation, reason),
    applyRecommendation: (recommendation) => ipcRenderer.invoke('revenueManager:applyRecommendation', recommendation)
  },
  advancedReports: {
    getOccupancy: (start, end) => ipcRenderer.invoke('advancedReports:getOccupancy', start, end),
    getPace: (start, end) => ipcRenderer.invoke('advancedReports:getPace', start, end),
    getPickup: (start, end) => ipcRenderer.invoke('advancedReports:getPickup', start, end),
    getChannelSource: (start, end) => ipcRenderer.invoke('advancedReports:getChannelSource', start, end),
    getDebtorAging: () => ipcRenderer.invoke('advancedReports:getDebtorAging'),
    getRatePerformance: (start, end) => ipcRenderer.invoke('advancedReports:getRatePerformance', start, end),
    getHousekeepingProductivity: (start, end) => ipcRenderer.invoke('advancedReports:getHousekeepingProductivity', start, end),
    getRoomDowntime: (start, end) => ipcRenderer.invoke('advancedReports:getRoomDowntime', start, end),
    getGroupPickup: (start, end) => ipcRenderer.invoke('advancedReports:getGroupPickup', start, end),
    getCancellationNoShow: (start, end) => ipcRenderer.invoke('advancedReports:getCancellationNoShow', start, end),
    getTaxVat: (start, end) => ipcRenderer.invoke('advancedReports:getTaxVat', start, end),
    getDepositLiability: () => ipcRenderer.invoke('advancedReports:getDepositLiability'),
    getFolioExceptions: () => ipcRenderer.invoke('advancedReports:getFolioExceptions')
  },
  payments: {
    getProviderConfig:  (provider, lodgeId)       => ipcRenderer.invoke('payments:getProviderConfig', provider, lodgeId),
    saveProviderConfig: (payload, lodgeId)        => ipcRenderer.invoke('payments:saveProviderConfig', payload, lodgeId)
  },
  subscriptionRequests: {
    submit: (request) => ipcRenderer.invoke('subscriptionRequests:submit', request),
    getAll: (status, limit, offset) => ipcRenderer.invoke('subscriptionRequests:getAll', status, limit, offset),
    getById: (requestId) => ipcRenderer.invoke('subscriptionRequests:getById', requestId),
    updateStatus: (requestId, status, reviewedBy, rejectionReason) => ipcRenderer.invoke('subscriptionRequests:updateStatus', requestId, status, reviewedBy, rejectionReason),
    createDocument: (requestId, type, documentInput) => ipcRenderer.invoke('subscriptionRequests:createDocument', requestId, type, documentInput),
    exportDocumentPdf: (documentPayload) => ipcRenderer.invoke('subscriptionRequests:exportDocumentPdf', documentPayload),
    activate: (requestId, activatedBy, activationPayload) => ipcRenderer.invoke('subscriptionRequests:activate', requestId, activatedBy, activationPayload)
  },
  groupBlocks: {
    getAll:  ()          => ipcRenderer.invoke('groupBlocks:getAll'),
    create:  (data)      => ipcRenderer.invoke('groupBlocks:create', data),
    update:  (id, data)  => ipcRenderer.invoke('groupBlocks:update', id, data),
    delete:  (id)        => ipcRenderer.invoke('groupBlocks:delete', id)
  },
  masterFolios: {
    getAll:  ()                      => ipcRenderer.invoke('masterFolios:getAll'),
    create:  (data)                  => ipcRenderer.invoke('masterFolios:create', data),
    getDebtorAging: (caId)           => ipcRenderer.invoke('masterFolios:getDebtorAging', caId),
    checkCreditLimit: (caId, amt)    => ipcRenderer.invoke('masterFolios:checkCreditLimit', caId, amt),
    generateStatement: (caId, s, e)  => ipcRenderer.invoke('masterFolios:generateStatement', caId, s, e)
  },
  roomingLists: {
    getAll:    ()                                  => ipcRenderer.invoke('roomingLists:getAll'),
    process:   (entries, caId, gbId, name)         => ipcRenderer.invoke('roomingLists:process', entries, caId, gbId, name),
    parseCSV:  (csvText)                           => ipcRenderer.invoke('roomingLists:parseCSV', csvText)
  },
  groupOperations: {
    getAll:               ()                        => ipcRenderer.invoke('groupOperations:getAll'),
    checkinBlock:         (blockId)                 => ipcRenderer.invoke('groupOperations:checkinBlock', blockId),
    checkoutBlock:        (blockId)                 => ipcRenderer.invoke('groupOperations:checkoutBlock', blockId),
    getPickup:            (blockId)                 => ipcRenderer.invoke('groupOperations:getPickup', blockId),
    releaseUnsold:        (blockId)                 => ipcRenderer.invoke('groupOperations:releaseUnsold', blockId),
    createFromRoomingList:(listId)                  => ipcRenderer.invoke('groupOperations:createFromRoomingList', listId)
  },
  multiProperty: {
    getAllGroups:              ()                           => ipcRenderer.invoke('multiProperty:getAllGroups'),
    createGroup:               (data)                       => ipcRenderer.invoke('multiProperty:createGroup', data),
    updateGroup:               (id, data)                   => ipcRenderer.invoke('multiProperty:updateGroup', id, data),
    deleteGroup:               (id)                         => ipcRenderer.invoke('multiProperty:deleteGroup', id),
    getProperties:             (groupId)                    => ipcRenderer.invoke('multiProperty:getProperties', groupId),
    addProperty:               (groupId, lodgeId, role)     => ipcRenderer.invoke('multiProperty:addProperty', groupId, lodgeId, role),
    removeProperty:            (groupId, lodgeId)           => ipcRenderer.invoke('multiProperty:removeProperty', groupId, lodgeId),
    getConsolidatedDashboard:  (groupId)                    => ipcRenderer.invoke('multiProperty:getConsolidatedDashboard', groupId),
    getConsolidatedOccupancy:  (groupId, start, end)        => ipcRenderer.invoke('multiProperty:getConsolidatedOccupancy', groupId, start, end),
    getConsolidatedFinancial:  (groupId, start, end)        => ipcRenderer.invoke('multiProperty:getConsolidatedFinancial', groupId, start, end),
    switchProperty:            (lodgeId)                    => ipcRenderer.invoke('multiProperty:switchProperty', lodgeId),
    getGroupSettings:          (groupId)                    => ipcRenderer.invoke('multiProperty:getGroupSettings', groupId),
    updateGroupSettings:       (groupId, key, value)        => ipcRenderer.invoke('multiProperty:updateGroupSettings', groupId, key, value),
    getSharedGuestProfiles:    (groupId)                    => ipcRenderer.invoke('multiProperty:getSharedGuestProfiles', groupId),
    shareGuestProfile:         (groupId, guestId, notes)    => ipcRenderer.invoke('multiProperty:shareGuestProfile', groupId, guestId, notes),
    unshareGuestProfile:       (groupId, guestId)           => ipcRenderer.invoke('multiProperty:unshareGuestProfile', groupId, guestId),
    getSharedBlacklist:        (groupId)                    => ipcRenderer.invoke('multiProperty:getSharedBlacklist', groupId),
    addBlacklistEntry:         (groupId, guestId, email, phone, reason) => ipcRenderer.invoke('multiProperty:addBlacklistEntry', groupId, guestId, email, phone, reason),
    removeBlacklistEntry:      (groupId, entryId)           => ipcRenderer.invoke('multiProperty:removeBlacklistEntry', groupId, entryId),
    getSharedCorporateAccounts:(groupId)                    => ipcRenderer.invoke('multiProperty:getSharedCorporateAccounts', groupId),
    shareCorporateAccount:     (groupId, corporateAccountId, shareLevel) => ipcRenderer.invoke('multiProperty:shareCorporateAccount', groupId, corporateAccountId, shareLevel),
    unshareCorporateAccount:   (groupId, corporateAccountId) => ipcRenderer.invoke('multiProperty:unshareCorporateAccount', groupId, corporateAccountId),
    getGroupMemberLodges:      (groupId)                    => ipcRenderer.invoke('multiProperty:getGroupMemberLodges', groupId)
  },
  enterpriseOperations: {
    getRecords:      (workflowKey, lodgeId)         => ipcRenderer.invoke('enterpriseOperations:getRecords', workflowKey, lodgeId),
    upsertRecord:    (workflowKey, record, lodgeId) => ipcRenderer.invoke('enterpriseOperations:upsertRecord', workflowKey, record, lodgeId),
    appendEvent:     (workflowKey, event, lodgeId)  => ipcRenderer.invoke('enterpriseOperations:appendEvent', workflowKey, event, lodgeId),
    createPaymentLinkRequest: (payload)    => ipcRenderer.invoke('enterpriseOperations:createPaymentLinkRequest', payload),
    createChannelSyncItem:    (payload)    => ipcRenderer.invoke('enterpriseOperations:createChannelSyncItem', payload),
    createDocument:           (payload)    => ipcRenderer.invoke('enterpriseOperations:createDocument', payload)
  },
  lostFound: {
    getAll:  ()        => ipcRenderer.invoke('lostFound:getAll'),
    create:  (data)    => ipcRenderer.invoke('lostFound:create', data),
    update:  (id, data) => ipcRenderer.invoke('lostFound:update', id, data),
    delete:  (id)      => ipcRenderer.invoke('lostFound:delete', id)
  },
  housekeepingCommandCenter: {
    getDashboard: (date) => ipcRenderer.invoke('housekeepingCommandCenter:getDashboard', date),
    createAssignment: (roomId, assignedTo, date, shift) => ipcRenderer.invoke('housekeepingCommandCenter:createAssignment', roomId, assignedTo, date, shift),
    updateAssignmentStatus: (id, status, notes) => ipcRenderer.invoke('housekeepingCommandCenter:updateAssignmentStatus', id, status, notes),
    createInspection: (roomId, inspectedBy, checklistResults) => ipcRenderer.invoke('housekeepingCommandCenter:createInspection', roomId, inspectedBy, checklistResults),
    startTurnaround: (bookingId) => ipcRenderer.invoke('housekeepingCommandCenter:startTurnaround', bookingId),
    completeTurnaround: (turnaroundId) => ipcRenderer.invoke('housekeepingCommandCenter:completeTurnaround', turnaroundId),
    getTurnaroundTimes: (startDate, endDate) => ipcRenderer.invoke('housekeepingCommandCenter:getTurnaroundTimes', startDate, endDate),
    getProductivity: (startDate, endDate) => ipcRenderer.invoke('housekeepingCommandCenter:getProductivity', startDate, endDate),
    getChecklistItems: () => ipcRenderer.invoke('housekeepingCommandCenter:getChecklistItems'),
    createChecklistItem: (data) => ipcRenderer.invoke('housekeepingCommandCenter:createChecklistItem', data),
    updateChecklistItem: (id, data) => ipcRenderer.invoke('housekeepingCommandCenter:updateChecklistItem', id, data),
    deleteChecklistItem: (id) => ipcRenderer.invoke('housekeepingCommandCenter:deleteChecklistItem', id)
  },
  maintenanceEnterprise: {
    getAllPreventiveSchedules: () => ipcRenderer.invoke('maintenanceEnterprise:getAllPreventiveSchedules'),
    createPreventiveSchedule: (data) => ipcRenderer.invoke('maintenanceEnterprise:createPreventiveSchedule', data),
    updatePreventiveSchedule: (id, data) => ipcRenderer.invoke('maintenanceEnterprise:updatePreventiveSchedule', id, data),
    deletePreventiveSchedule: (id) => ipcRenderer.invoke('maintenanceEnterprise:deletePreventiveSchedule', id),
    getDuePreventive: (date) => ipcRenderer.invoke('maintenanceEnterprise:getDuePreventive', date),
    completePreventive: (id, completedBy, notes) => ipcRenderer.invoke('maintenanceEnterprise:completePreventive', id, completedBy, notes),
    setRoomOutOfOrder: (roomId, startDate, reason, endDate, ticketId) => ipcRenderer.invoke('maintenanceEnterprise:setRoomOutOfOrder', roomId, startDate, reason, endDate, ticketId),
    setRoomOutOfService: (roomId, startDate, reason, endDate, ticketId) => ipcRenderer.invoke('maintenanceEnterprise:setRoomOutOfService', roomId, startDate, reason, endDate, ticketId),
    returnRoomToService: (downtimeId) => ipcRenderer.invoke('maintenanceEnterprise:returnRoomToService', downtimeId),
    getRoomDowntimeHistory: (roomId) => ipcRenderer.invoke('maintenanceEnterprise:getRoomDowntimeHistory', roomId),
    getMaintenanceDashboard: () => ipcRenderer.invoke('maintenanceEnterprise:getMaintenanceDashboard'),
    getDowntimeReport: (startDate, endDate) => ipcRenderer.invoke('maintenanceEnterprise:getDowntimeReport', startDate, endDate)
  },
  assetRegistry: {
    getAssets: (assetType, status) => ipcRenderer.invoke('assetRegistry:getAssets', assetType, status),
    createAsset: (data) => ipcRenderer.invoke('assetRegistry:createAsset', data),
    updateAsset: (id, data) => ipcRenderer.invoke('assetRegistry:updateAsset', id, data),
    deleteAsset: (id) => ipcRenderer.invoke('assetRegistry:deleteAsset', id),
    getMaintenanceHistory: (assetId) => ipcRenderer.invoke('assetRegistry:getMaintenanceHistory', assetId),
    logMaintenance: (assetId, ticketId, description, cost, vendorId) => ipcRenderer.invoke('assetRegistry:logMaintenance', assetId, ticketId, description, cost, vendorId),
    getVendors: (specialisation) => ipcRenderer.invoke('assetRegistry:getVendors', specialisation),
    createVendor: (data) => ipcRenderer.invoke('assetRegistry:createVendor', data),
    updateVendor: (id, data) => ipcRenderer.invoke('assetRegistry:updateVendor', id, data),
    deleteVendor: (id) => ipcRenderer.invoke('assetRegistry:deleteVendor', id)
  },
  assetManagement: {
    getAssetCategories:            ()                                      => ipcRenderer.invoke('assetManagement:getAssetCategories'),
    createAssetCategory:           (data)                                  => ipcRenderer.invoke('assetManagement:createAssetCategory', data),
    updateAssetCategory:           (id, data)                              => ipcRenderer.invoke('assetManagement:updateAssetCategory', id, data),
    deleteAssetCategory:           (id)                                    => ipcRenderer.invoke('assetManagement:deleteAssetCategory', id),
    getAssetWarranties:            (assetId)                               => ipcRenderer.invoke('assetManagement:getAssetWarranties', assetId),
    createAssetWarranty:           (data)                                  => ipcRenderer.invoke('assetManagement:createAssetWarranty', data),
    updateAssetWarranty:           (id, data)                              => ipcRenderer.invoke('assetManagement:updateAssetWarranty', id, data),
    deleteAssetWarranty:           (id)                                    => ipcRenderer.invoke('assetManagement:deleteAssetWarranty', id),
    getAssetInspections:           (assetId)                               => ipcRenderer.invoke('assetManagement:getAssetInspections', assetId),
    createAssetInspection:         (data)                                  => ipcRenderer.invoke('assetManagement:createAssetInspection', data),
    deleteAssetInspection:         (id)                                    => ipcRenderer.invoke('assetManagement:deleteAssetInspection', id),
    getAssetAttachments:           (assetId)                               => ipcRenderer.invoke('assetManagement:getAssetAttachments', assetId),
    createAssetAttachment:         (data)                                  => ipcRenderer.invoke('assetManagement:createAssetAttachment', data),
    deleteAssetAttachment:         (id)                                    => ipcRenderer.invoke('assetManagement:deleteAssetAttachment', id),
    getAssetCosts:                 (assetId)                               => ipcRenderer.invoke('assetManagement:getAssetCosts', assetId),
    recordAssetCost:               (data)                                  => ipcRenderer.invoke('assetManagement:recordAssetCost', data),
    getAssetCostSummary:           (startDate, endDate)                    => ipcRenderer.invoke('assetManagement:getAssetCostSummary', startDate, endDate),
    getPreventiveTemplates:        (categoryId)                            => ipcRenderer.invoke('assetManagement:getPreventiveTemplates', categoryId),
    createPreventiveTemplate:      (data)                                  => ipcRenderer.invoke('assetManagement:createPreventiveTemplate', data),
    updatePreventiveTemplate:      (id, data)                              => ipcRenderer.invoke('assetManagement:updatePreventiveTemplate', id, data),
    deletePreventiveTemplate:      (id)                                    => ipcRenderer.invoke('assetManagement:deletePreventiveTemplate', id),
    getPreventiveAssignments:      (assetId, status)                       => ipcRenderer.invoke('assetManagement:getPreventiveAssignments', assetId, status),
    createPreventiveAssignment:    (data)                                  => ipcRenderer.invoke('assetManagement:createPreventiveAssignment', data),
    completePreventiveAssignment:  (id, notes)                             => ipcRenderer.invoke('assetManagement:completePreventiveAssignment', id, notes),
    skipPreventiveAssignment:      (id, notes)                             => ipcRenderer.invoke('assetManagement:skipPreventiveAssignment', id, notes),
    generatePreventiveAssignments: ()                                      => ipcRenderer.invoke('assetManagement:generatePreventiveAssignments'),
    getAssetDashboard:             ()                                      => ipcRenderer.invoke('assetManagement:getAssetDashboard'),
    setAssetRoomSellability:       (assetId, affectsSellability, sellabilityNotes) => ipcRenderer.invoke('assetManagement:setAssetRoomSellability', assetId, affectsSellability, sellabilityNotes)
  },
  operationsCompliance: {
    createLinenStocktake: (items) => ipcRenderer.invoke('operationsCompliance:createLinenStocktake', items),
    getLinenDashboard: () => ipcRenderer.invoke('operationsCompliance:getLinenDashboard'),
    reportDamagedLinen: (itemId, quantity, reason) => ipcRenderer.invoke('operationsCompliance:reportDamagedLinen', itemId, quantity, reason),
    chargeDamagedLinen: (bookingId, linenItemId, quantity, amount) => ipcRenderer.invoke('operationsCompliance:chargeDamagedLinen', bookingId, linenItemId, quantity, amount),
    claimLostFoundItem: (itemId, claimerName, claimerContact, disposition) => ipcRenderer.invoke('operationsCompliance:claimLostFoundItem', itemId, claimerName, claimerContact, disposition),
    getLostFoundDashboard: () => ipcRenderer.invoke('operationsCompliance:getLostFoundDashboard'),
    resolveIncident: (id, resolution, resolvedBy) => ipcRenderer.invoke('operationsCompliance:resolveIncident', id, resolution, resolvedBy),
    getIncidentDashboard: () => ipcRenderer.invoke('operationsCompliance:getIncidentDashboard'),
    getVisitorDashboard: () => ipcRenderer.invoke('operationsCompliance:getVisitorDashboard'),
    getVisitorHistory: (startDate, endDate) => ipcRenderer.invoke('operationsCompliance:getVisitorHistory', startDate, endDate),
    getEvacuationList: () => ipcRenderer.invoke('operationsCompliance:getEvacuationList'),
    exportEvacuationReport: () => ipcRenderer.invoke('operationsCompliance:exportEvacuationReport'),
    createShiftHandover: (data) => ipcRenderer.invoke('operationsCompliance:createShiftHandover', data),
    completeShiftHandover: (id) => ipcRenderer.invoke('operationsCompliance:completeShiftHandover', id),
    getShiftHandoverHistory: () => ipcRenderer.invoke('operationsCompliance:getShiftHandoverHistory')
  },
  incidents: {
    getAll:  ()        => ipcRenderer.invoke('incidents:getAll'),
    create:  (data)    => ipcRenderer.invoke('incidents:create', data),
    update:  (id, data) => ipcRenderer.invoke('incidents:update', id, data)
  },
  visitors: {
    getAll:    ()      => ipcRenderer.invoke('visitors:getAll'),
    create:    (data)  => ipcRenderer.invoke('visitors:create', data),
    checkout:  (id)    => ipcRenderer.invoke('visitors:checkout', id)
  },
  linen: {
    getAll:      ()    => ipcRenderer.invoke('linen:getAll'),
    create:      (data) => ipcRenderer.invoke('linen:create', data),
    getBatches:  ()    => ipcRenderer.invoke('linen:getBatches'),
    createBatch: (data) => ipcRenderer.invoke('linen:createBatch', data)
  },
  channelManager: {
    getDashboard:     ()                                          => ipcRenderer.invoke('channelManager:getDashboard'),
    getMappings:      ()                                          => ipcRenderer.invoke('channelManager:getMappings'),
    createMapping:    (channelKey, sourceType, localId, channelCode, channelName) => ipcRenderer.invoke('channelManager:createMapping', channelKey, sourceType, localId, channelCode, channelName),
    updateMapping:    (id, channelCode, channelName)              => ipcRenderer.invoke('channelManager:updateMapping', id, channelCode, channelName),
    deleteMapping:    (id)                                        => ipcRenderer.invoke('channelManager:deleteMapping', id),
    getConfigs:       ()                                          => ipcRenderer.invoke('channelManager:getConfigs'),
    createConfig:     (channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations) => ipcRenderer.invoke('channelManager:createConfig', channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations),
    updateConfig:     (id, payload)                               => ipcRenderer.invoke('channelManager:updateConfig', id, payload),
    enableChannel:    (channelKey)                                => ipcRenderer.invoke('channelManager:enableChannel', channelKey),
    disableChannel:   (channelKey)                                => ipcRenderer.invoke('channelManager:disableChannel', channelKey),
    processSyncQueue: (channelKey)                                => ipcRenderer.invoke('channelManager:processSyncQueue', channelKey),
    pushAvailability: (channelKey, payload)                       => ipcRenderer.invoke('channelManager:pushAvailability', channelKey, payload),
    pushRates:        (channelKey, payload)                       => ipcRenderer.invoke('channelManager:pushRates', channelKey, payload),
    fetchReservations:(channelKey, since)                         => ipcRenderer.invoke('channelManager:fetchReservations', channelKey, since),
    importReservation:  (payload)                                 => ipcRenderer.invoke('channelManager:importReservation', payload),
    confirmImport:    (importId)                                  => ipcRenderer.invoke('channelManager:confirmImport', importId),
    rejectImport:     (importId, reason)                          => ipcRenderer.invoke('channelManager:rejectImport', importId, reason)
  },
  documentSystem: {
    getTemplates:       ()                                            => ipcRenderer.invoke('documentSystem:getTemplates'),
    createTemplate:     (templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix) => ipcRenderer.invoke('documentSystem:createTemplate', templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix),
    updateTemplate:     (id, payload)                                 => ipcRenderer.invoke('documentSystem:updateTemplate', id, payload),
    deleteTemplate:     (id)                                          => ipcRenderer.invoke('documentSystem:deleteTemplate', id),
    renderDocument:     (templateKey, subjectType, subjectId)         => ipcRenderer.invoke('documentSystem:renderDocument', templateKey, subjectType, subjectId),
    publishDocument:    (documentId)                                  => ipcRenderer.invoke('documentSystem:publishDocument', documentId),
    getDocumentHistory: (subjectType, subjectId)                      => ipcRenderer.invoke('documentSystem:getDocumentHistory', subjectType, subjectId),
    getDocumentDashboard: ()                                          => ipcRenderer.invoke('documentSystem:getDocumentDashboard')
  },
  hotelRoles: {
    getTemplates:       ()                           => ipcRenderer.invoke('hotelRoles:getTemplates'),
    getRoleCapabilities: (roleKey)                   => ipcRenderer.invoke('hotelRoles:getRoleCapabilities', roleKey)
  },
  payments: {
    getProviderConfig:   (provider, lodgeId)                  => ipcRenderer.invoke('payments:getProviderConfig', provider, lodgeId),
    saveProviderConfig:  (payload, lodgeId)                   => ipcRenderer.invoke('payments:saveProviderConfig', payload, lodgeId),
    getPaymentDashboard:  (lodgeId)                           => ipcRenderer.invoke('payments:getPaymentDashboard', lodgeId),
    verifyWebhookSignature: (provider, signature, payloadRaw) => ipcRenderer.invoke('payments:verifyWebhookSignature', provider, signature, payloadRaw)
  },
  guestMessaging: {
    getTemplates:       ()                                    => ipcRenderer.invoke('guestMessaging:getTemplates'),
    createTemplate:     (data)                                => ipcRenderer.invoke('guestMessaging:createTemplate', data),
    updateTemplate:     (id, data)                            => ipcRenderer.invoke('guestMessaging:updateTemplate', id, data),
    deleteTemplate:     (id)                                  => ipcRenderer.invoke('guestMessaging:deleteTemplate', id),
    getTriggers:        ()                                    => ipcRenderer.invoke('guestMessaging:getTriggers'),
    createTrigger:      (data)                                => ipcRenderer.invoke('guestMessaging:createTrigger', data),
    updateTrigger:      (id, data)                            => ipcRenderer.invoke('guestMessaging:updateTrigger', id, data),
    deleteTrigger:      (id)                                  => ipcRenderer.invoke('guestMessaging:deleteTrigger', id),
    renderTemplate:     (templateId, variables)               => ipcRenderer.invoke('guestMessaging:renderTemplate', templateId, variables),
    getDeliveryStatus:  (status)                              => ipcRenderer.invoke('guestMessaging:getDeliveryStatus', status),
    getChannelReadiness:(channel)                             => ipcRenderer.invoke('guestMessaging:getChannelReadiness', channel),
    dispatchMessage:    (messageId, options)                  => ipcRenderer.invoke('guestMessaging:dispatchMessage', messageId, options)
  },
  guestPortal: {
    getConfig:          ()                                    => ipcRenderer.invoke('guestPortal:getConfig'),
    updateConfig:       (config)                              => ipcRenderer.invoke('guestPortal:updateConfig', config),
    createSession:      (email, bookingRef)                   => ipcRenderer.invoke('guestPortal:createSession', email, bookingRef),
    validateSession:    (token)                               => ipcRenderer.invoke('guestPortal:validateSession', token),
    getPendingRequests: ()                                    => ipcRenderer.invoke('guestPortal:getPendingRequests')
  },
  guestCRM: {
    getProfile:      (customerId)                             => ipcRenderer.invoke('guestCRM:getProfile', customerId),
    updateProfile:   (customerId, data)                       => ipcRenderer.invoke('guestCRM:updateProfile', customerId, data),
    setVipLevel:     (customerId, level)                      => ipcRenderer.invoke('guestCRM:setVipLevel', customerId, level),
    addPreference:   (customerId, key, value)                 => ipcRenderer.invoke('guestCRM:addPreference', customerId, key, value),
    setBlacklist:    (customerId, blacklisted, reason)        => ipcRenderer.invoke('guestCRM:setBlacklist', customerId, blacklisted, reason),
    getStayHistory:  (customerId)                             => ipcRenderer.invoke('guestCRM:getStayHistory', customerId),
    recordConsent:   (customerId, consentType, granted)       => ipcRenderer.invoke('guestCRM:recordConsent', customerId, consentType, granted),
    search:          (query)                                  => ipcRenderer.invoke('guestCRM:search', query),
    getVipList:      ()                                       => ipcRenderer.invoke('guestCRM:getVipList'),
    listNotes:       (customerId)                             => ipcRenderer.invoke('guestCRM:listNotes', customerId),
    addNote:         (customerId, noteText, noteType)         => ipcRenderer.invoke('guestCRM:addNote', customerId, noteText, noteType)
  },
  nightAudit: {
    runChecks: () => ipcRenderer.invoke('nightAudit:runChecks'),
    close: (closedBy, notes, force = false) => ipcRenderer.invoke('nightAudit:close', closedBy, notes, force),
    reopen: (closeId, reopenedBy, reason) => ipcRenderer.invoke('nightAudit:reopen', closeId, reopenedBy, reason),
    getSummary: (date) => ipcRenderer.invoke('nightAudit:summary', date),
    getHistory: (limit) => ipcRenderer.invoke('nightAudit:history', limit),
    resolveException: (exceptionId, resolvedBy, notes) => ipcRenderer.invoke('nightAudit:resolveException', exceptionId, resolvedBy, notes)
  },
  checkinWorkflow: {
    getChecklist: (bookingId) => ipcRenderer.invoke('checkinWorkflow:getChecklist', bookingId),
    completeStep: (stepId, completedBy, data) => ipcRenderer.invoke('checkinWorkflow:completeStep', stepId, completedBy, data),
    resetStep: (stepId) => ipcRenderer.invoke('checkinWorkflow:resetStep', stepId),
    getConfig: () => ipcRenderer.invoke('checkinWorkflow:getConfig'),
    updateConfig: (config) => ipcRenderer.invoke('checkinWorkflow:updateConfig', config),
    completeHotelCheckin: (bookingId) => ipcRenderer.invoke('checkinWorkflow:completeHotelCheckin', bookingId),
    completeHotelCheckinWithOverride: (bookingId, overrideReason) =>
      ipcRenderer.invoke('checkinWorkflow:completeHotelCheckinWithOverride', bookingId, overrideReason)
  },
  checkoutWorkflow: {
    getChecklist: (bookingId) => ipcRenderer.invoke('checkoutWorkflow:getChecklist', bookingId),
    completeStep: (stepId, completedBy, data) => ipcRenderer.invoke('checkoutWorkflow:completeStep', stepId, completedBy, data),
    resetStep: (stepId) => ipcRenderer.invoke('checkoutWorkflow:resetStep', stepId),
    completeHotelCheckout: (bookingId) => ipcRenderer.invoke('checkoutWorkflow:completeHotelCheckout', bookingId)
  },
  earlyLateCheckout: {
    getEarlyPolicies: () => ipcRenderer.invoke('earlyLateCheckout:getEarlyPolicies'),
    createEarlyPolicy: (data) => ipcRenderer.invoke('earlyLateCheckout:createEarlyPolicy', data),
    updateEarlyPolicy: (id, data) => ipcRenderer.invoke('earlyLateCheckout:updateEarlyPolicy', id, data),
    deleteEarlyPolicy: (id) => ipcRenderer.invoke('earlyLateCheckout:deleteEarlyPolicy', id),
    getLatePolicies: () => ipcRenderer.invoke('earlyLateCheckout:getLatePolicies'),
    createLatePolicy: (data) => ipcRenderer.invoke('earlyLateCheckout:createLatePolicy', data),
    updateLatePolicy: (id, data) => ipcRenderer.invoke('earlyLateCheckout:updateLatePolicy', id, data),
    deleteLatePolicy: (id) => ipcRenderer.invoke('earlyLateCheckout:deleteLatePolicy', id),
    getEarlyRequests: () => ipcRenderer.invoke('earlyLateCheckout:getEarlyRequests'),
    createEarlyRequest: (bookingId, policyId, time) => ipcRenderer.invoke('earlyLateCheckout:createEarlyRequest', bookingId, policyId, time),
    approveEarlyRequest: (id) => ipcRenderer.invoke('earlyLateCheckout:approveEarlyRequest', id),
    rejectEarlyRequest: (id) => ipcRenderer.invoke('earlyLateCheckout:rejectEarlyRequest', id),
    getLateRequests: () => ipcRenderer.invoke('earlyLateCheckout:getLateRequests'),
    createLateRequest: (bookingId, policyId, time) => ipcRenderer.invoke('earlyLateCheckout:createLateRequest', bookingId, policyId, time),
    approveLateRequest: (id) => ipcRenderer.invoke('earlyLateCheckout:approveLateRequest', id),
    rejectLateRequest: (id) => ipcRenderer.invoke('earlyLateCheckout:rejectLateRequest', id),
    calculateEarlyFee: (bookingId, time) => ipcRenderer.invoke('earlyLateCheckout:calculateEarlyFee', bookingId, time),
    calculateLateFee: (bookingId, time) => ipcRenderer.invoke('earlyLateCheckout:calculateLateFee', bookingId, time)
  },
  cancellationPolicies: {
    getAll: () => ipcRenderer.invoke('cancellationPolicies:getAll'),
    create: (data) => ipcRenderer.invoke('cancellationPolicies:create', data),
    update: (id, data) => ipcRenderer.invoke('cancellationPolicies:update', id, data),
    delete: (id) => ipcRenderer.invoke('cancellationPolicies:delete', id),
    calculateFee: (bookingId, reason) => ipcRenderer.invoke('cancellationPolicies:calculateFee', bookingId, reason),
    process: (requestId, approvedBy) => ipcRenderer.invoke('cancellationPolicies:process', requestId, approvedBy),
    getRequests: () => ipcRenderer.invoke('cancellationPolicies:getRequests'),
    approve: (requestId, approvedBy) => ipcRenderer.invoke('cancellationPolicies:approve', requestId, approvedBy)
  },
  bookingEngine: {
    calculatePrice: (roomTypeId, checkIn, checkOut, numGuests) => ipcRenderer.invoke('bookingEngine:calculatePrice', roomTypeId, checkIn, checkOut, numGuests),
    checkAvailability: (roomTypeId, checkIn, checkOut, numRooms) => ipcRenderer.invoke('bookingEngine:checkAvailability', roomTypeId, checkIn, checkOut, numRooms),
    getUpsells: (roomTypeId, checkIn, checkOut, numGuests) => ipcRenderer.invoke('bookingEngine:getUpsells', roomTypeId, checkIn, checkOut, numGuests),
    createIntent: (roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options) =>
      ipcRenderer.invoke('bookingEngine:createIntent', roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options),
    confirmIntent: (intentOrId, confirmation) =>
      ipcRenderer.invoke('bookingEngine:confirmIntent', intentOrId, confirmation),
    getRules: () => ipcRenderer.invoke('bookingEngine:getRules'),
    createRule: (data) => ipcRenderer.invoke('bookingEngine:createRule', data),
    updateRule: (id, data) => ipcRenderer.invoke('bookingEngine:updateRule', id, data),
    deleteRule: (id) => ipcRenderer.invoke('bookingEngine:deleteRule', id),
    getUpsellsList: () => ipcRenderer.invoke('bookingEngine:getUpsellsList'),
    createUpsell: (data) => ipcRenderer.invoke('bookingEngine:createUpsell', data),
    updateUpsell: (id, data) => ipcRenderer.invoke('bookingEngine:updateUpsell', id, data),
    deleteUpsell: (id) => ipcRenderer.invoke('bookingEngine:deleteUpsell', id)
  },
  restaurantAccountingV2: {
    invoke: (operation, ...args) => ipcRenderer.invoke('restaurantAccountingV2:invoke', operation, args)
  },
  abandonedPayments: {
    logSession: (bookingId, amount, provider, sessionToken, expiresAt) =>
      ipcRenderer.invoke('abandonedPayments:logSession', bookingId, amount, provider, sessionToken, expiresAt),
    getSessions: (statusFilter) =>
      ipcRenderer.invoke('abandonedPayments:getSessions', statusFilter),
    recoverSession: (sessionToken) =>
      ipcRenderer.invoke('abandonedPayments:recoverSession', sessionToken),
    expireSessions: () =>
      ipcRenderer.invoke('abandonedPayments:expireSessions'),
    getPendingRecovery: () =>
      ipcRenderer.invoke('abandonedPayments:getPendingRecovery')
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
