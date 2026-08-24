import electron from 'electron'

const { contextBridge, ipcRenderer, webUtils } = electron

// The main process wraps arrays that carry metadata (`_source`, `_complete`,
// ...) in plain envelopes because Electron IPC drops array own properties.
// The envelope must pass through the contextBridge untouched: the renderer
// bootstraps an unpack that rebuilds the array in the renderer's main world,
// because the bridge strips array own properties a second time.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const onIpc = (channel, cb) => {
  const listener = (_, value) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  auth: {
    login:          (email, password, selectedLodgeId = null) => invoke('auth:login', email, password, selectedLodgeId),
    getStatus:      (email)           => invoke('auth:status', email),
    healthCheck:    (email)           => invoke('auth:healthCheck', email),
    sendPasswordReset: (email)         => invoke('auth:sendPasswordReset', email),
    restoreSession: (nonce)           => invoke('auth:restoreSession', nonce),
    restoreCurrentSession: ()          => invoke('auth:restoreCurrentSession'),
    restoreSavedSession: (email, password) => invoke('auth:restoreSavedSession', email, password),
    validateSession: ()               => invoke('auth:validateSession'),
    logout:         ()                => invoke('auth:logout')
  },
  profiles: {
    list:       ()              => invoke('profiles:list'),
    getActive:  ()              => invoke('profiles:getActive'),
    select:     (lodgeId)       => invoke('profiles:select', lodgeId),
    createDraft: ()             => invoke('profiles:createDraft'),
    removeDraft: (lodgeId)      => invoke('profiles:removeDraft', lodgeId)
  },
  setup: {
    initializeCompany: (payload)      => invoke('setup:initializeCompany', payload)
  },
  users: {
    getAll: () => invoke('users:getAll'),
    create: (data) => invoke('users:create', data),
    update: (id, data) => invoke('users:update', id, data),
    getAccessAudit: () => invoke('users:getAccessAudit'),
    resetPassword: (id, password) => invoke('users:resetPassword', id, password),
    sendInvite: (id) => invoke('users:sendInvite', id),
    delete: (id) => invoke('users:delete', id)
  },
  staffScheduling: {
    getSchedule: (date) => invoke('staffScheduling:getSchedule', date),
    getScheduleRange: (startDate, endDate) => invoke('staffScheduling:getScheduleRange', startDate, endDate),
    upsertSchedule: (staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes) => invoke('staffScheduling:upsertSchedule', staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes),
    deleteEntry: (id) => invoke('staffScheduling:deleteEntry', id),
    getAttendanceToday: () => invoke('staffScheduling:getAttendanceToday'),
    getAttendanceRange: (startDate, endDate, staffId) => invoke('staffScheduling:getAttendanceRange', startDate, endDate, staffId),
    getAttendanceDashboard: () => invoke('staffScheduling:getAttendanceDashboard'),
    clockIn: (staffId, shiftLabel, notes) => invoke('staffScheduling:clockIn', staffId, shiftLabel, notes),
    clockOut: (attendanceId, notes) => invoke('staffScheduling:clockOut', attendanceId, notes),
    getLeaveRequests: (status, staffId) => invoke('staffScheduling:getLeaveRequests', status, staffId),
    requestLeave: (staffId, leaveType, startDate, endDate, reason) => invoke('staffScheduling:requestLeave', staffId, leaveType, startDate, endDate, reason),
    approveLeave: (id, status, rejectionReason) => invoke('staffScheduling:approveLeave', id, status, rejectionReason)
  },
  staffOperations: {
    getStaffDepartments:        ()                                    => invoke('staffOperations:getStaffDepartments'),
    createStaffDepartment:      (name, description, color)            => invoke('staffOperations:createStaffDepartment', name, description, color),
    updateStaffDepartment:      (id, payload)                        => invoke('staffOperations:updateStaffDepartment', id, payload),
    deleteStaffDepartment:      (id)                                 => invoke('staffOperations:deleteStaffDepartment', id),
    getShiftTemplates:          (departmentId)                        => invoke('staffOperations:getShiftTemplates', departmentId),
    createShiftTemplate:        (payload)                            => invoke('staffOperations:createShiftTemplate', payload),
    updateShiftTemplate:        (id, payload)                        => invoke('staffOperations:updateShiftTemplate', id, payload),
    deleteShiftTemplate:        (id)                                 => invoke('staffOperations:deleteShiftTemplate', id),
    getTaskCategories:          ()                                    => invoke('staffOperations:getTaskCategories'),
    createTaskCategory:         (name, color)                        => invoke('staffOperations:createTaskCategory', name, color),
    getTaskAssignments:         (staffId, status, date)               => invoke('staffOperations:getTaskAssignments', staffId, status, date),
    createTaskAssignment:       (payload)                            => invoke('staffOperations:createTaskAssignment', payload),
    updateTaskAssignment:       (id, payload)                        => invoke('staffOperations:updateTaskAssignment', id, payload),
    completeTaskAssignment:     (id, notes)                          => invoke('staffOperations:completeTaskAssignment', id, notes),
    getTrainingChecklists:      (departmentId)                        => invoke('staffOperations:getTrainingChecklists', departmentId),
    createTrainingChecklist:    (payload)                            => invoke('staffOperations:createTrainingChecklist', payload),
    recordTrainingCompletion:   (staffId, checklistId, notes)        => invoke('staffOperations:recordTrainingCompletion', staffId, checklistId, notes),
    getTrainingRecords:         (staffId)                             => invoke('staffOperations:getTrainingRecords', staffId),
    createShiftHandover:        (payload)                            => invoke('staffOperations:createShiftHandover', payload),
    getShiftHandovers:          (date)                                => invoke('staffOperations:getShiftHandovers', date),
    getStaffProductivityDashboard: (startDate, endDate)              => invoke('staffOperations:getStaffProductivityDashboard', startDate, endDate),
    publishWeeklySchedule:      (weekStart)                          => invoke('staffOperations:publishWeeklySchedule', weekStart),
    getScheduleConflicts:       (weekStart)                           => invoke('staffOperations:getScheduleConflicts', weekStart)
  },
  rooms: {
    getAll: () => invoke('rooms:getAll'),
    getCached: () => invoke('rooms:getCached'),
    create: (data) => invoke('rooms:create', data),
    update: (id, data) => invoke('rooms:update', id, data),
    delete: (id) => invoke('rooms:delete', id),
    updateHousekeeping: (id, status, notes) =>
      invoke('rooms:updateHousekeeping', id, status, notes)
  },
  customers: {
    getAll: () => invoke('customers:getAll'),
    create: (data) => invoke('customers:create', data),
    update: (id, data) => invoke('customers:update', id, data),
    updateBlacklist: (id, is_blacklisted, reason) =>
      invoke('customers:updateBlacklist', id, is_blacklisted, reason),
    getBookings: (id) => invoke('customers:getBookings', id),
    updateIdPhoto: (id, photo) => invoke('customers:updateIdPhoto', id, photo)
  },
  charges: {
    getByBooking: (bookingId) => invoke('charges:getByBooking', bookingId),
    add: (bookingId, data) => invoke('charges:add', bookingId, data),
    delete: (id, reason) => invoke('charges:delete', id, reason)
  },
  rateOverrides: {
    getAll: () => invoke('rateOverrides:getAll'),
    create: (data) => invoke('rateOverrides:create', data),
    update: (id, data) => invoke('rateOverrides:update', id, data),
    delete: (id) => invoke('rateOverrides:delete', id),
    getApplicable: (roomId, checkIn, checkOut) =>
      invoke('rateOverrides:getApplicable', roomId, checkIn, checkOut)
  },
  expenses: {
    getAll: (start, end, outletId) => invoke('expenses:getAll', start, end, outletId),
    create: (data) => invoke('expenses:create', data),
    update: (id, data) => invoke('expenses:update', id, data),
    delete: (id, operationId) => invoke('expenses:delete', id, operationId),
    submit: (id, payload, operationId) => invoke('expenses:submit', id, payload, operationId),
    approve: (id, payload, operationId) => invoke('expenses:approve', id, payload, operationId),
    post: (id, payload, operationId) => invoke('expenses:post', id, payload, operationId),
    pay: (id, payload, operationId) => invoke('expenses:pay', id, payload, operationId),
    void: (id, payload, operationId) => invoke('expenses:void', id, payload, operationId),
    reverse: (id, payload, operationId) => invoke('expenses:reverse', id, payload, operationId)
  },
  maintenance: {
    getAll: () => invoke('maintenance:getAll'),
    create: (data) => invoke('maintenance:create', data),
    update: (id, data) => invoke('maintenance:update', id, data),
    resolve: (id, roomId) => invoke('maintenance:resolve', id, roomId)
  },
  receipts: {
    savePDF: (payload) => invoke('receipts:savePDF', payload),
    listPrinters: () => invoke('receipts:listPrinters'),
    printCurrent: (options) => invoke('receipts:printCurrent', options)
  },
  quotations: {
    getAll:     ()                                      => invoke('quotations:getAll'),
    create:     (data)                                  => invoke('quotations:create', data),
    update:     (id, data)                              => invoke('quotations:update', id, data),
    convert:    (quotationId, depositAmount, method)    => invoke('quotations:convert', quotationId, depositAmount, method),
    savePDF:    (quotationId, quotationNumber, customerName) => invoke('quotations:savePDF', quotationId, quotationNumber, customerName),
    duplicate:  (id)                                    => invoke('quotations:duplicate', id)
  },
  bookings: {
    getAll: () => invoke('bookings:getAll'),
    getCachedByDateRange: (start, end) => invoke('bookings:getCachedByDateRange', start, end),
    getByDateRange: (start, end) => invoke('bookings:getByDateRange', start, end),
    create: (data) => invoke('bookings:create', data),
    createMultiRoom: (data) => invoke('bookings:createMultiRoom', data),
    update: (id, data) => invoke('bookings:update', id, data),
    updateStatus: (id, status) => invoke('bookings:updateStatus', id, status),
    updatePayment: (id, amount, method, intentKey) =>
      invoke('bookings:updatePayment', id, amount, method, intentKey),
    updateGroupPayment: (groupId, amount, method, intentKey) =>
      invoke('bookings:updateGroupPayment', groupId, amount, method, intentKey),
    getPayments: (bookingId) => invoke('bookings:getPayments', bookingId),
    refundGroup: (groupId, payload) => invoke('bookings:refundGroup', groupId, payload),
    refund: (bookingId, payload) => invoke('bookings:refund', bookingId, payload),
    createEvent: (data) => invoke('bookings:createEvent', data),
    getPendingOnline: () => invoke('bookings:getPendingOnline'),
    reschedule: (bookingId, data) => invoke('bookings:reschedule', bookingId, data)
  },
  customerCredit: {
    getBalance: (customerId) => invoke('customerCredit:getBalance', customerId),
    getHistory: (customerId, limit, offset) => invoke('customerCredit:getHistory', customerId, limit, offset),
    getSummary: (search, limit, offset) => invoke('customerCredit:getSummary', search, limit, offset),
    record: (data) => invoke('customerCredit:record', data),
    applyToBooking: (data) => invoke('customerCredit:applyToBooking', data),
    refund: (data) => invoke('customerCredit:refund', data),
    reverse: (data) => invoke('customerCredit:reverse', data)
  },
  invoices: {
    getBookingInvoices: () => invoke('invoices:getBookingInvoices'),
    sendBookingInvoiceEmail: (invoice) => invoke('invoices:sendBookingInvoiceEmail', invoice),
    recordDelivery: (payload) => invoke('invoices:recordDelivery', payload)
  },
  reports: {
    basicSummary: (rangeDays = 1) => invoke('reports:basicSummary', rangeDays),
    occupancy: (start, end) => invoke('reports:occupancy', start, end),
    revenue: (start, end) => invoke('reports:revenue', start, end),
    snapshot: (today) => invoke('reports:snapshot', today),
    invoiceDeliveryHistory: (payload) => invoke('reports:invoiceDeliveryHistory', payload),
    financialAudit: (payload) => invoke('reports:financialAudit', payload),
    financialReconciliation: () => invoke('reports:financialReconciliation'),
    financialValidation: () => invoke('reports:financialValidation'),
    financialValidationRuns: (limit) => invoke('reports:financialValidationRuns', limit),
    financialValidationAlerts: (limit) => invoke('reports:financialValidationAlerts', limit),
    criticalErrors: (limit) => invoke('reports:criticalErrors', limit),
    clearCriticalErrors: () => invoke('reports:clearCriticalErrors'),
    saveSupportBundle: (limit) => invoke('reports:saveSupportBundle', limit),
    getSupportBundle: (limit) => invoke('reports:getSupportBundle', limit),
    runFinancialValidation: () => invoke('reports:runFinancialValidation'),
    savePDF: (payload) => invoke('reports:savePDF', payload),
    printCurrent: () => invoke('reports:printCurrent'),
    saveExcel: (data) => invoke('reports:saveExcel', data),
    exportDetailedExcel: (payload) => invoke('reports:exportDetailedExcel', payload),
    exportDetailedPDF: (payload) => invoke('reports:exportDetailedPDF', payload),
    posSales: (start, end, outletId) => invoke('reports:posSales', start, end, outletId),
    inventorySpend: (start, end, outletId) => invoke('reports:inventorySpend', start, end, outletId),
    supplySpend: (start, end) => invoke('reports:supplySpend', start, end),
    nightAudit: (date) => invoke('reports:nightAudit', date),
    saveNightAuditExcel: (payload) => invoke('reports:saveNightAuditExcel', payload),
    profitLoss: (start, end) => invoke('reports:profitLoss', start, end),
    maintenanceRows: (start, end) => invoke('reports:maintenanceRows', start, end),
    outletProfitLoss: (start, end) => invoke('reports:outletProfitLoss', start, end),
    roomProfitability: (start, end) => invoke('reports:roomProfitability', start, end),
    exportOfflineSafetyManifest: () => invoke('reports:exportOfflineSafetyManifest')
  },
  dashboard: {
    stats: () => invoke('dashboard:stats'),
    forecast: (days) => invoke('dashboard:forecast', days),
    bookingPaymentsToday: () => invoke('dashboard:bookingPaymentsToday')
  },
  requests: {
    getAll: (limit) => invoke('requests:getAll', limit),
    update: (id, updates) => invoke('requests:update', id, updates),
    markRead: (id, audience, messageId) => invoke('requests:markRead', id, audience, messageId),
    addMessage: (id, payload) => invoke('requests:addMessage', id, payload)
  },
  notifications: {
    today: () => invoke('notifications:today'),
    upcoming: () => invoke('notifications:upcoming')
  },
  shell: {
    openExternal: (url) => invoke('shell:openExternal', url)
  },
  window: {
    repairInputFocus: (reason) => invoke('window:repairInputFocus', reason),
    onFocusRecovery: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('window:focus-recovery', listener)
      return () => ipcRenderer.off('window:focus-recovery', listener)
    }
  },
  app: {
    getVersion: () => invoke('app:getVersion'),
    getProduct: () => invoke('app:getProduct'),
    notify: (payload) => invoke('app:notify', payload),
    logRendererError: (payload) => invoke('app:logRendererError', payload),
    getRendererErrors: (limit) => invoke('app:getRendererErrors', limit),
    clearRendererErrors: () => invoke('app:clearRendererErrors'),
    setTestOfflineMode: (forceOffline) => invoke('app:setTestOfflineMode', forceOffline),
    showTouchKeyboard: () => invoke('app:showTouchKeyboard')
  },
  activity: {
    getAll: () => invoke('activity:getAll'),
    clear: () => invoke('activity:clear')
  },
  backup: {
    getInfo: () => invoke('backup:getInfo'),
    chooseTargetFolder: () => invoke('backup:chooseTargetFolder'),
    savePolicy: (updates) => invoke('backup:savePolicy', updates),
    runManagedNow: () => invoke('backup:runManagedNow'),
    createManual: () => invoke('backup:createManual'),
    verify: (name) => invoke('backup:verify', name),
    previewRestore: (name) => invoke('backup:previewRestore', name),
    createRestoreRehearsal: (name) => invoke('backup:createRestoreRehearsal', name),
    openFolder: () => invoke('backup:openFolder'),
    openManagedFolder: () => invoke('backup:openManagedFolder')
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (data) => invoke('settings:save', data),
    updateOperatingProfile: (profile) => invoke('settings:updateOperatingProfile', profile),
    getDiagnostics: (expectedLodgeId) => invoke('settings:getDiagnostics', expectedLodgeId),
    getSystemHealth: (options) => invoke('settings:getSystemHealth', options),
    relinkLodge: (lodgeId) => invoke('settings:relinkLodge', lodgeId),
    resetToNewLodge: () => invoke('settings:resetToNewLodge')
  },
  sync: {
    getStatus: () => invoke('sync:getStatus'),
    getDetails: () => invoke('sync:getDetails'),
    getOfflineMode: () => invoke('sync:getOfflineMode'),
    setOfflineMode: (payload) => invoke('sync:setOfflineMode', payload),
    exportOfflineOperations: () => invoke('sync:exportOfflineOperations'),
    retryFailed: (queueIds) => invoke('sync:retryFailed', queueIds),
    clearFailed: (queueIds) => invoke('sync:clearFailed', queueIds),
    runNow: () => invoke('sync:runNow'),
    clearHealthFault: (id) => invoke('sync:clearHealthFault', id),
    getDeviceHealthRollup: () => invoke('sync:getDeviceHealthRollup'),
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
    lockRoom: (roomId, startDate, endDate) => invoke('mesh:lockRoom', roomId, startDate, endDate),
    unlockRoom: (lockId) => invoke('mesh:unlockRoom', lockId),
    getDiagnostics: () => invoke('mesh:getDiagnostics'),
    refreshDiscovery: () => invoke('mesh:refreshDiscovery'),
    connectManualPeer: (address, port) => invoke('mesh:connectManualPeer', address, port || null),
    onConflictDetected: (cb) => {
      const listener = (_, payload) => cb(payload)
      ipcRenderer.on('mesh:conflict-detected', listener)
      return () => ipcRenderer.off('mesh:conflict-detected', listener)
    }
  },
  trial: {
    getStatus: (lodgeId) => invoke('trial:getStatus', lodgeId),
    activateKey: (lodgeId, key) => invoke('trial:activateKey', lodgeId, key),
    getInvoices: (lodgeId) => invoke('trial:getInvoices', lodgeId)
  },
  usage: {
    getSnapshot: (options) => invoke('usage:getSnapshot', options)
  },
  updates: {
    onAvailable: (cb) => onIpc('update:available', cb),
    onNotAvailable: (cb) => onIpc('update:not-available', cb),
    onProgress: (cb) => onIpc('update:progress', cb),
    onReady: (cb) => onIpc('update:ready', cb),
    onError: (cb) => onIpc('update:error', cb),
    install: () => invoke('update:install'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    getState: () => invoke('update:getState'),
    getVersion: () => invoke('app:getVersion')
  },
  outlets: {
    getAll: () => invoke('outlets:getAll')
  },
  pos: {
    getMenuItems: () => invoke('pos:getMenuItems'),
    createMenuItem: (data) => invoke('pos:createMenuItem', data),
    updateMenuItem: (id, data) => invoke('pos:updateMenuItem', id, data),
    deleteMenuItem: (id) => invoke('pos:deleteMenuItem', id),
    setBarPackTemplate: (data) => invoke('pos:setBarPackTemplate', data),
    saveBarProductWithPacks: (data) => invoke('pos:saveBarProductWithPacks', data),
    getOrders: (start, end) => invoke('pos:getOrders', start, end),
    getCertifiedReportHistory: (start, end) => invoke('pos:getCertifiedReportHistory', start, end),
    getMyOrders: (start, end) => invoke('pos:getMyOrders', start, end),
    getVoidHistory: (start, end) => invoke('pos:getVoidHistory', start, end),
    exportHistoryExcel: (filters) => invoke('pos:exportHistoryExcel', filters),
    exportHistoryPdf: (filters) => invoke('pos:exportHistoryPdf', filters),
    exportDailyCloseSummaryPdf: (payload) => invoke('pos:exportDailyCloseSummaryPdf', payload),
    createOrder: (data) => invoke('pos:createOrder', data),
    getPendingPosSubmitAttempt: () => invoke('pos:getPendingPosSubmitAttempt'),
    voidOrder: (id) => invoke('pos:voidOrder', id),
    approveVoidWithPin: (data) => invoke('pos:approveVoidWithPin', data),
    approveDiscountWithPin: (data) => invoke('pos:approveDiscountWithPin', data),
    createPartialReturnWithPin: (data) => invoke('pos:createPartialReturnWithPin', data),
    getCashupSummary: (filters) => invoke('pos:getCashupSummary', filters),
    getCashups: (limit, filters) => invoke('pos:getCashups', limit, filters),
    createCashup: (data) => invoke('pos:createCashup', data),
    submitCashup: (data) => invoke('pos:submitCashup', data),
    submitCashupWithAttendancePin: (data) => invoke('pos:submitCashupWithAttendancePin', data),
    getMyCashupSubmission: (shiftId) => invoke('pos:getMyCashupSubmission', shiftId),
    getPendingCashupSubmissions: () => invoke('pos:getPendingCashupSubmissions'),
    reviewCashupSubmission: (data) => invoke('pos:reviewCashupSubmission', data),
    getTabs: (filters) => invoke('pos:getTabs', filters),
    saveTab: (data) => invoke('pos:saveTab', data),
    closeTab: (id) => invoke('pos:closeTab', id),
    updateTabStatus: (id, status) => invoke('pos:updateTabStatus', id, status),
    transferTabWaiter: (data) => invoke('pos:transferTabWaiter', data),
    overrideTableTab: (data) => invoke('pos:overrideTableTab', data),
    splitBillByItems: (data) => invoke('pos:splitBillByItems', data),
    splitBillEvenly: (data) => invoke('pos:splitBillEvenly', data),
    getTablesWithStatus: (outletId) => invoke('pos:getTablesWithStatus', outletId),
    getActiveTableTab: (tableName, outletId) => invoke('pos:getActiveTableTab', tableName, outletId),
    openTableSession: (data) => invoke('pos:openTableSession', data),
    getTables: () => invoke('pos:getTables'),
    saveTable: (data) => invoke('pos:saveTable', data),
    deleteTable: (id) => invoke('pos:deleteTable', id),
    getStations: () => invoke('pos:getStations'),
    saveStation: (data) => invoke('pos:saveStation', data),
    deleteStation: (id) => invoke('pos:deleteStation', id),
    getTickets: (filters) => invoke('pos:getTickets', filters),
    updateTicketStatus: (id, status) => invoke('pos:updateTicketStatus', id, status),
    updateTicketStatusWithOperation: (id, status, operationId) => invoke('pos:updateTicketStatusWithOperation', id, status, operationId),
    getVoidReasonTemplates: () => invoke('pos:getVoidReasonTemplates'),
    saveVoidReasonTemplate: (data) => invoke('pos:saveVoidReasonTemplate', data),
    getShiftHandoverNotes: (shiftId) => invoke('pos:getShiftHandoverNotes', shiftId),
    saveShiftHandoverNote: (data) => invoke('pos:saveShiftHandoverNote', data),
    attachCashupProof: (data) => invoke('pos:attachCashupProof', data),
    getCashupProofAttachments: (submissionId) => invoke('pos:getCashupProofAttachments', submissionId),
    createCashupProofSignedUrl: (submissionId, attachmentId) => invoke('pos:createCashupProofSignedUrl', submissionId, attachmentId),
    getCurrentShift: (outletId, cashierId) => invoke('pos:getCurrentShift', outletId, cashierId),
    getStaffOpenShift: (staffId) => invoke('pos:getStaffOpenShift', staffId),
    getStaffCashupSubmission: (shiftId) => invoke('pos:getStaffCashupSubmission', shiftId),
    activateSharedTillOperator: (data) => invoke('pos:activateSharedTillOperator', data),
    getSharedTillOperatorSession: (data) => invoke('pos:getSharedTillOperatorSession', data),
    touchSharedTillOperator: (data) => invoke('pos:touchSharedTillOperator', data),
    getSharedTillHistory: (start, end, options) => invoke('pos:getSharedTillHistory', start, end, options),
    lockSharedTillOperator: () => invoke('pos:lockSharedTillOperator'),
    linkMyShiftAttendance: (data) => invoke('pos:linkMyShiftAttendance', data),
    openShift: (data) => invoke('pos:openShift', data),
    closeShift: (data) => invoke('pos:closeShift', data),
    getHardwareSettings: () => invoke('pos:getHardwareSettings'),
    saveHardwareSettings: (data) => invoke('pos:saveHardwareSettings', data),
    testHardware: (kind) => invoke('pos:testHardware', kind),
    verifyBarcodeScanner: (data) => invoke('pos:verifyBarcodeScanner', data),
    openCashDrawer: (data) => invoke('pos:openCashDrawer', data),
    getStaff: () => invoke('pos:getStaff'),
    selectStaffWithPin: (data) => invoke('pos:selectStaffWithPin', data),
    getModifierGroups: () => invoke('pos:getModifierGroups'),
    saveModifierGroup: (data) => invoke('pos:saveModifierGroup', data),
    getPromotions: () => invoke('pos:getPromotions'),
    savePromotion: (data) => invoke('pos:savePromotion', data),
    getFloorLayout: () => invoke('pos:getFloorLayout'),
    saveFloorLayout: (data) => invoke('pos:saveFloorLayout', data),
    updateCustomerDisplay: (data) => invoke('pos:updateCustomerDisplay', data),
    getCustomerDisplay: () => invoke('pos:getCustomerDisplay'),
    openDisplay: (kind, options) => invoke('pos:openDisplay', kind, options),
    listDisplays: () => invoke('pos:listDisplays'),
    sendPaymentTerminalTotal: (data) => invoke('pos:sendPaymentTerminalTotal', data),
    getAuditLog: (limit) => invoke('pos:getAuditLog', limit),
    getActiveBookingForRoom: (roomId) => invoke('pos:getActiveBookingForRoom', roomId),
    getActiveEvents: () => invoke('pos:getActiveEvents'),
    getRecipes: () => invoke('pos:getRecipes'),
    saveRecipe: (data) => invoke('pos:saveRecipe', data),
    deleteRecipe: (recipeId) => invoke('pos:deleteRecipe', recipeId),
    getCustomers: () => invoke('pos:getCustomers'),
    saveCustomer: (data) => invoke('pos:saveCustomer', data),
    awardLoyalty: (data) => invoke('pos:awardLoyalty', data),
    queueLoyaltyRepair: (data) => invoke('pos:queueLoyaltyRepair', data),
    redeemLoyalty: (data) => invoke('pos:redeemLoyalty', data),
    chargeCustomerAccount: (data) => invoke('pos:chargeCustomerAccount', data),
    redeemVoucher: (code, amount) => invoke('pos:redeemVoucher', code, amount),
    recordDelivery: (data) => invoke('pos:recordDelivery', data),
    clockInStaff: (data) => invoke('pos:clockInStaff', data),
    clockInSelfForPos: (data) => invoke('pos:clockInSelfForPos', data),
    clockInStaffWithAttendancePin: (data) => invoke('pos:clockInStaffWithAttendancePin', data),
    clockOutStaff: (data) => invoke('pos:clockOutStaff', data),
    clockOutStaffWithAttendancePin: (data) => invoke('pos:clockOutStaffWithAttendancePin', data),
    getActiveShifts: () => invoke('pos:getActiveShifts'),
    getBarActiveShifts: () => invoke('pos:getBarActiveShifts'),
    getRestaurantShiftPlans: (startDate, endDate) => invoke('pos:getRestaurantShiftPlans', startDate, endDate),
    saveRestaurantShiftPlan: (data) => invoke('pos:saveRestaurantShiftPlan', data),
    deleteRestaurantShiftPlan: (id) => invoke('pos:deleteRestaurantShiftPlan', id),
    openCashDrawerSession: (data) => invoke('pos:openCashDrawerSession', data),
    closeCashDrawerSession: (data) => invoke('pos:closeCashDrawerSession', data),
    getOpenCashDrawer: () => invoke('pos:getOpenCashDrawer'),
    getSuppliers: () => invoke('pos:getSuppliers'),
    createSupplier: (data) => invoke('pos:createSupplier', data),
    updateSupplier: (supplierId, data) => invoke('pos:updateSupplier', supplierId, data),
    createPurchaseOrder: (data) => invoke('pos:createPurchaseOrder', data),
    updatePurchaseOrderDraft: (orderId, data) => invoke('pos:updatePurchaseOrderDraft', orderId, data),
    savePurchaseOrderPdf: (orderId) => invoke('pos:savePurchaseOrderPdf', orderId),
    sendPurchaseOrderEmail: (orderId) => invoke('pos:sendPurchaseOrderEmail', orderId),
    approvePurchaseOrder: (orderId) => invoke('pos:approvePurchaseOrder', orderId),
    receivePurchaseOrder: (orderId, stockLocationId) => invoke('pos:receivePurchaseOrder', orderId, stockLocationId),
    createStockTransfer: (data) => invoke('pos:createStockTransfer', data),
    createChecklist: (data) => invoke('pos:createChecklist', data),
    completeChecklistItem: (data) => invoke('pos:completeChecklistItem', data),
    getActiveAlerts: (filters) => invoke('pos:getActiveAlerts', filters),
    getAlertHistory: (filters) => invoke('pos:getAlertHistory', filters),
    recordAlert: (data) => invoke('pos:recordAlert', data),
    acknowledgeAlert: (alertId, reason, operationId) => invoke('pos:acknowledgeAlert', alertId, reason, operationId),
    resolveAlert: (alertId, reason, operationId) => invoke('pos:resolveAlert', alertId, reason, operationId),
    getPurchaseOrders: (startDate, endDate) => invoke('pos:getPurchaseOrders', startDate, endDate),
    getPurchasingSnapshot: () => invoke('pos:getPurchasingSnapshot').then((payload) => JSON.parse(payload)),
    getShiftHistory: (startDate, endDate) => invoke('pos:getShiftHistory', startDate, endDate),
    getCashDrawerSessions: (startDate, endDate) => invoke('pos:getCashDrawerSessions', startDate, endDate),
    getChecklists: () => invoke('pos:getChecklists'),
    seedBarChecklistTemplates: () => invoke('pos:seedBarChecklistTemplates'),
    getBarChecklistTemplates: () => invoke('pos:getBarChecklistTemplates'),
    createBarChecklistFromTemplate: (data) => invoke('pos:createBarChecklistFromTemplate', data),
    getExceptionAlerts: () => invoke('pos:getExceptionAlerts'),
    generateOwnerDigest: () => invoke('pos:generateOwnerDigest'),
    // Phase 6.1 Reservations
    getRestaurantReservations: (startDate, endDate, outletId) => invoke('pos:getRestaurantReservations', startDate, endDate, outletId),
    createRestaurantReservation: (data) => invoke('pos:createRestaurantReservation', data),
    updateRestaurantReservation: (id, data) => invoke('pos:updateRestaurantReservation', id, data),
    cancelRestaurantReservation: (id, reason) => invoke('pos:cancelRestaurantReservation', id, reason),
    seatRestaurantReservation: (id, tableId) => invoke('pos:seatRestaurantReservation', id, tableId),
    markRestaurantReservationNoShow: (id, reason) => invoke('pos:markRestaurantReservationNoShow', id, reason),
    getRestaurantWaitlist: (outletId, includeReservationWaitlist) => invoke('pos:getRestaurantWaitlist', outletId, includeReservationWaitlist),
    createRestaurantWaitlistEntry: (data) => invoke('pos:createRestaurantWaitlistEntry', data),
    updateRestaurantWaitlistEntry: (id, data) => invoke('pos:updateRestaurantWaitlistEntry', id, data),
    removeRestaurantWaitlistEntry: (id, reason) => invoke('pos:removeRestaurantWaitlistEntry', id, reason),
    seatRestaurantWaitlistEntry: (id, tableId) => invoke('pos:seatRestaurantWaitlistEntry', id, tableId),
    serviceRestaurantReservationAction: (id, action, tableIds) => invoke('pos:serviceRestaurantReservationAction', id, action, tableIds),
    // Phase 6.2 Combos
    getRestaurantCombos: (outletId) => invoke('pos:getRestaurantCombos', outletId),
    saveRestaurantCombo: (data) => invoke('pos:saveRestaurantCombo', data),
    deleteRestaurantCombo: (comboId) => invoke('pos:deleteRestaurantCombo', comboId),
    // Phase 6.3 Recipe Variance
    getRecipeVarianceReport: (startDate, endDate, outletId) => invoke('pos:getRecipeVarianceReport', startDate, endDate, outletId),
    getRecipePreparationLosses: (startDate, endDate, outletId) => invoke('pos:getRecipePreparationLosses', startDate, endDate, outletId),
    getRecipePreparationLossIngredientSummary: (startDate, endDate, outletId) => invoke('pos:getRecipePreparationLossIngredientSummary', startDate, endDate, outletId),
    // Phase 6.5 Prep Batches
    getRestaurantPrepItems: () => invoke('pos:getRestaurantPrepItems'),
    saveRestaurantPrepItem: (data) => invoke('pos:saveRestaurantPrepItem', data),
    getRestaurantPrepBatches: (startDate, endDate, outletId) => invoke('pos:getRestaurantPrepBatches', startDate, endDate, outletId),
    createRestaurantPrepBatch: (data) => invoke('pos:createRestaurantPrepBatch', data),
    postRestaurantPrepBatch: (batchId) => invoke('pos:postRestaurantPrepBatch', batchId),
    // Phase 6.6 Kitchen Timing
    recordTicketStatusEvent: (data) => invoke('pos:recordTicketStatusEvent', data),
    getKitchenTimingReport: (startDate, endDate, outletId, station) => invoke('pos:getKitchenTimingReport', startDate, endDate, outletId, station),
    // Phase 6.7 Purchase Suggestions
    getLowStockPurchaseSuggestions: (outletId) => invoke('pos:getLowStockPurchaseSuggestions', outletId),
    setPreferredSupplierForInventoryItem: (inventoryItemId, supplierId, lastUnitCost) => invoke('pos:setPreferredSupplierForInventoryItem', inventoryItemId, supplierId, lastUnitCost),
    convertPurchaseSuggestionsToPo: (supplierId, suggestions, notes) => invoke('pos:convertPurchaseSuggestionsToPo', supplierId, suggestions, notes),
    recordSettlement: (data) => invoke('pos:recordSettlement', data),
    getSettlementBankAccounts: () => invoke('pos:getSettlementBankAccounts'),
    getSettlements: (businessDate) => invoke('pos:getSettlements', businessDate),
    getSettlementExpectedTotal: (startDate, endDate, channel) => invoke('pos:getSettlementExpectedTotal', startDate, endDate, channel),
    recordReservationDeposit: (data) => invoke('pos:recordReservationDeposit', data),
    getReservationDeposits: (days) => invoke('pos:getReservationDeposits', days),
    getRestaurantOutletControls: () => invoke('pos:getRestaurantOutletControls'),
    getRestaurantStockLocations: () => invoke('pos:getRestaurantStockLocations'),
    getRestaurantStockLocationBalances: () => invoke('pos:getRestaurantStockLocationBalances'),
    createRestaurantStockLocation: (data) => invoke('pos:createRestaurantStockLocation', data),
    updateRestaurantStockLocation: (locationId, data) => invoke('pos:updateRestaurantStockLocation', locationId, data),
    deleteRestaurantStockLocation: (locationId) => invoke('pos:deleteRestaurantStockLocation', locationId),
    setRestaurantOutletStockLocation: (outletId, stockLocationId) => invoke('pos:setRestaurantOutletStockLocation', outletId, stockLocationId),
    createRestaurantOutlet: (data) => invoke('pos:createRestaurantOutlet', data),
    updateRestaurantOutlet: (outletId, data) => invoke('pos:updateRestaurantOutlet', outletId, data),
    recordFeedback: (data) => invoke('pos:recordFeedback', data),
    submitStaffFeedback: (data) => invoke('pos:submitStaffFeedback', data),
    getFeedback: (days) => invoke('pos:getFeedback', days),
    getSetupProgress: () => invoke('pos:getSetupProgress'),
    getSetupProgressWithReadStatus: () => invoke('pos:getSetupProgressWithReadStatus'),
    setSetupStage: (data) => invoke('pos:setSetupStage', data)
    ,createGiftCard: (data) => invoke('pos:createGiftCard', data)
    ,recordTipPayout: (data) => invoke('pos:recordTipPayout', data)
    ,getTipPayouts: (days) => invoke('pos:getTipPayouts', days)
    ,getTipBalances: (days) => invoke('pos:getTipBalances', days)
    ,saveReservationPolicy: (data) => invoke('pos:saveReservationPolicy', data)
    ,recordInventoryLot: (data) => invoke('pos:recordInventoryLot', data)
    ,updateInventoryLotExpiry: (lotId, data) => invoke('pos:updateInventoryLotExpiry', lotId, data)
    ,writeOffExpiredInventoryLot: (lotId, data) => invoke('pos:writeOffExpiredInventoryLot', lotId, data)
    ,getExpiryLots: (days) => invoke('pos:getExpiryLots', days)
  },
  inventory: {
    getItems: () => invoke('inventory:getItems'),
    getItemsWithReadStatus: () => invoke('inventory:getItemsWithReadStatus'),
    getBarStockAging: (outletId) => invoke('inventory:getBarStockAging', outletId || null),
    postBarPhysicalCount: (payload) => invoke('inventory:postBarPhysicalCount', payload),
    postBarSimpleDelivery: (payload) => invoke('inventory:postBarSimpleDelivery', payload),
    getBarStockCountHistory: (outletId, limit) => invoke('inventory:getBarStockCountHistory', outletId || null, limit),
    findByBarcode: (barcode, outletId) => invoke('inventory:findByBarcode', barcode, outletId || null),
    printBarcodeLabels: (labels) => invoke('inventory:printBarcodeLabels', labels),
    createItem: (data) => invoke('inventory:createItem', data),
    updateItem: (id, data) => invoke('inventory:updateItem', id, data),
    deleteItem: (id) => invoke('inventory:deleteItem', id),
    addPurchase: (data) => invoke('inventory:addPurchase', data),
    getPurchases: (itemId) => invoke('inventory:getPurchases', itemId),
    adjustStock: (itemId, delta, notes, managerPin, adjustmentId) => invoke('inventory:adjustStock', itemId, delta, notes, managerPin, adjustmentId),
    getMovements: (filters) => invoke('inventory:getMovements', filters),
    getMovementsWithReadStatus: (filters) => invoke('inventory:getMovementsWithReadStatus', filters),
    getLowStock: () => invoke('inventory:getLowStock'),
    getStocktakes: (limit) => invoke('inventory:getStocktakes', limit),
    getRestaurantStockSnapshot: (movementDate) => invoke('inventory:getRestaurantStockSnapshot', movementDate).then((payload) => JSON.parse(payload)),
    createStocktake: (data) => invoke('inventory:createStocktake', data),
    getStocktake: (stocktakeId) => invoke('inventory:getStocktake', stocktakeId),
    saveStocktakeCounts: (stocktakeId, lines) => invoke('inventory:saveStocktakeCounts', stocktakeId, lines),
    postStocktake: (stocktakeId, notes) => invoke('inventory:postStocktake', stocktakeId, notes),
    discardDraft: (id) => invoke('inventory:discardDraft', id)
  },
  supplies: {
    getItems: () => invoke('supplies:getItems'),
    createItem: (data) => invoke('supplies:createItem', data),
    updateItem: (id, data) => invoke('supplies:updateItem', id, data),
    deleteItem: (id) => invoke('supplies:deleteItem', id),
    addPurchase: (data) => invoke('supplies:addPurchase', data),
    getPurchases: (itemId) => invoke('supplies:getPurchases', itemId),
    adjustStock: (itemId, delta, notes, managerPin) => invoke('supplies:adjustStock', itemId, delta, notes, managerPin),
    getRoomStock: () => invoke('supplies:getRoomStock'),
    loadToRoom: (data) => invoke('supplies:loadToRoom', data),
    useInRoom: (data) => invoke('supplies:useInRoom', data),
    returnFromRoom: (data) => invoke('supplies:returnFromRoom', data),
    getMovements: (limit) => invoke('supplies:getMovements', limit),
    saveAllocations: (weekStart, allocations) =>
      invoke('supplies:saveAllocations', weekStart, allocations),
    getAllocations: (start, end) => invoke('supplies:getAllocations', start, end),
    getWeekAllocations: (weekStart) => invoke('supplies:getWeekAllocations', weekStart),
    exportReport: (payload) => invoke('supplies:exportReport', payload),
    exportReportPdf: (payload) => invoke('supplies:exportReportPdf', payload),
    getStocktakes: (limit) => invoke('supplies:getStocktakes', limit),
    createStocktake: (data) => invoke('supplies:createStocktake', data),
    getStocktake: (stocktakeId) => invoke('supplies:getStocktake', stocktakeId),
    saveStocktakeCounts: (stocktakeId, lines) => invoke('supplies:saveStocktakeCounts', stocktakeId, lines),
    postStocktake: (stocktakeId, notes) => invoke('supplies:postStocktake', stocktakeId, notes),
    getRoomStocktakes: (limit) => invoke('supplies:getRoomStocktakes', limit),
    createRoomStocktake: (data) => invoke('supplies:createRoomStocktake', data),
    getRoomStocktake: (stocktakeId) => invoke('supplies:getRoomStocktake', stocktakeId),
    saveRoomStocktakeCounts: (stocktakeId, lines) => invoke('supplies:saveRoomStocktakeCounts', stocktakeId, lines),
    postRoomStocktake: (stocktakeId, notes) => invoke('supplies:postRoomStocktake', stocktakeId, notes),
    addRoomStocktakeLine: (stocktakeId, data) => invoke('supplies:addRoomStocktakeLine', stocktakeId, data)
  },
  admin: {
    getCommandCentralReauthStatus: () => invoke('admin:getCommandCentralReauthStatus'),
    reauthenticateCommandCentral: (password) => invoke('admin:reauthenticateCommandCentral', password),
    exists: () => invoke('admin:exists'),
    setup: (name, email, password) => invoke('admin:setup', name, email, password),
    getCompanies: () => invoke('admin:getCompanies'),
    getLicenses: () => invoke('admin:getLicenses'),
    createLicense: (data) => invoke('admin:createLicense', data),
    issueSubscriptionContract: (payload) => invoke('admin:issueSubscriptionContract', payload),
    assignCommercialSubscription: (payload) => invoke('admin:assignCommercialSubscription', payload),
    updateLicense: (id, updates) => invoke('admin:updateLicense', id, updates),
    deleteLicense: (id) => invoke('admin:deleteLicense', id),
    // Broadcasts
    getBroadcasts: () => invoke('admin:getBroadcasts'),
    getActiveBroadcasts: () => invoke('admin:getActiveBroadcasts'),
    createBroadcast: (data) => invoke('admin:createBroadcast', data),
    updateBroadcast: (id, data) => invoke('admin:updateBroadcast', id, data),
    deleteBroadcast: (id) => invoke('admin:deleteBroadcast', id),
    // Feature flags
    getLodgeFeatures: (lodgeId) => invoke('admin:getLodgeFeatures', lodgeId),
    setLodgeFeature: (lodgeId, name, enabled, metadata) => invoke('admin:setLodgeFeature', lodgeId, name, enabled, metadata),
    clearLodgeFeature: (lodgeId, name) => invoke('admin:clearLodgeFeature', lodgeId, name),
    getAllLodgeFeatures: () => invoke('admin:getAllLodgeFeatures'),
    getTestDataResetPreview: (lodgeId, payload) => invoke('admin:getTestDataResetPreview', lodgeId, payload),
    runTestDataReset: (lodgeId, payload) => invoke('admin:runTestDataReset', lodgeId, payload),
    getTestDataResetAudit: (lodgeId, limit) => invoke('admin:getTestDataResetAudit', lodgeId, limit),
    // Support tickets
    getSupportTickets: (filters) => invoke('admin:getSupportTickets', filters),
    createSupportTicket: (data) => invoke('admin:createSupportTicket', data),
    updateSupportTicket: (id, updates) => invoke('admin:updateSupportTicket', id, updates),
    addSupportTicketMessage: (id, payload) => invoke('admin:addSupportTicketMessage', id, payload),
    deleteSupportTicket: (id) => invoke('admin:deleteSupportTicket', id),
    // Activity logs
    getActivityLogs: (filters) => invoke('admin:getActivityLogs', filters),
    getAuditSummary: (filters) => invoke('admin:getAuditSummary', filters),
    // Company stats
    getCompanyStats: (lodgeId) => invoke('admin:getCompanyStats', lodgeId),
    // Billing
    updateLicenseBilling: (id, data) => invoke('admin:updateLicenseBilling', id, data),
    getOverdueLicenses: () => invoke('admin:getOverdueLicenses'),
    // Invoices
    getNextInvoiceNumber: () => invoke('admin:getNextInvoiceNumber'),
    createInvoice: (data) => invoke('admin:createInvoice', data),
    getInvoices: (filters) => invoke('admin:getInvoices', filters),
    getInvoicesByLodge: (lodgeId) => invoke('admin:getInvoicesByLodge', lodgeId),
    getClientBookingInvoices: (lodgeId) => invoke('admin:getClientBookingInvoices', lodgeId),
    updateInvoice: (id, data) => invoke('admin:updateInvoice', id, data),
    deleteInvoice: (id) => invoke('admin:deleteInvoice', id),
    getInvoiceSummary: () => invoke('admin:getInvoiceSummary'),
    sendInvoiceEmail: (payload) => invoke('admin:sendInvoiceEmail', payload),
    updateCompany: (lodgeId, updates) => invoke('admin:updateCompany', lodgeId, updates),
    getCompanyUsers: (lodgeId) => invoke('admin:getCompanyUsers', lodgeId),
    resetCompanyUserPassword: (lodgeId, userId, password) => invoke('admin:resetCompanyUserPassword', lodgeId, userId, password),
    updateCompanyUserPwaAccess: (lodgeId, userId, payload) => invoke('admin:updateCompanyUserPwaAccess', lodgeId, userId, payload),
    // Lifecycle
    archiveCompany: (lodgeId) => invoke('admin:archiveCompany', lodgeId),
    restoreCompany: (lodgeId) => invoke('admin:restoreCompany', lodgeId),
    applyCompanyLifecycle: (payload) => invoke('admin:applyCompanyLifecycle', payload),
    permanentlyDeleteCompany: (lodgeId) => invoke('admin:permanentlyDeleteCompany', lodgeId),
    repairDuplicateEventBookings: (lodgeId) => invoke('admin:repairDuplicateEventBookings', lodgeId),
    // Expenses
    getExpenses: () => invoke('admin:getExpenses'),
    createExpense: (data) => invoke('admin:createExpense', data),
    updateExpense: (id, data) => invoke('admin:updateExpense', id, data),
    deleteExpense: (id) => invoke('admin:deleteExpense', id),
    getMarketingLeads: (filters) => invoke('admin:getMarketingLeads', filters),
    updateMarketingLeadStatus: (id, status) => invoke('admin:updateMarketingLeadStatus', id, status),
    updateLeadCrm: (id, fields) => invoke('admin:updateLeadCrm', id, fields),
    getSalesPipelineSummary: () => invoke('admin:getSalesPipelineSummary'),
    exportExcel: (payload) => invoke('admin:exportExcel', payload),
    exportPdf: (payload) => invoke('admin:exportPdf', payload),
    createNotification: (payload) => invoke('admin:createNotification', payload),
    getNotifications: (filters) => invoke('admin:getNotifications', filters),
    getUnreadCount: () => invoke('admin:getUnreadCount'),
    markNotificationsRead: (ids) => invoke('admin:markNotificationsRead', ids),
    cleanupNotifications: (days) => invoke('admin:cleanupNotifications', days),
    getFleetHealthRollup: () => invoke('admin:getFleetHealthRollup'),
    getFleetHealthSummary: () => invoke('admin:getFleetHealthSummary'),
    recordCommandCentralHealthRun: (payload) => invoke('admin:recordCommandCentralHealthRun', payload),
    listCommandCentralHealthRuns: (limit) => invoke('admin:listCommandCentralHealthRuns', limit),
    getScheduledReleases: () => invoke('admin:getScheduledReleases'),
    expireOverdueFeatures: () => invoke('admin:expireOverdueFeatures'),
    // Notification Automation
    getNotificationRules: () => invoke('admin:getNotificationRules'),
    upsertNotificationRule: (rule) => invoke('admin:upsertNotificationRule', rule),
    evaluateRule: (ruleKey) => invoke('admin:evaluateRule', ruleKey),
    evaluateAllRules: () => invoke('admin:evaluateAllRules'),
    getNotificationEvents: (opts) => invoke('admin:getNotificationEvents', opts),
    getNotificationEventSummary: () => invoke('admin:getNotificationEventSummary'),
    markEventsDispatched: (eventIds) => invoke('admin:markEventsDispatched', eventIds),
    // Accounting
    getMrrSummary: () => invoke('admin:getMrrSummary'),
    getRevenueSummary: (days) => invoke('admin:getRevenueSummary', days),
    getLodgeFinancialSummary: () => invoke('admin:getLodgeFinancialSummary'),
    getCollectionsQueue: () => invoke('admin:getCollectionsQueue'),
    getRevenueByMethod: (days) => invoke('admin:getRevenueByMethod', days),
    generateCommercialInvoice: (payload) => invoke('admin:generateCommercialInvoice', payload),
    recordCommercialPayment: (payload) => invoke('admin:recordCommercialPayment', payload),
    getCommercialInvoices: (filters) => invoke('admin:getCommercialInvoices', filters),
    getCommercialBillingSummary: () => invoke('admin:getCommercialBillingSummary'),
    // Task Center
    getAdminToday: () => invoke('admin:getAdminToday'),
    // Global Search
    globalSearch: (query, limit) => invoke('admin:globalSearch', query, limit),
    // Bulk Actions
    bulkUpdateStatus: (entityType, entityIds, newStatus) => invoke('admin:bulkUpdateStatus', entityType, entityIds, newStatus),
    bulkDelete: (entityType, entityIds) => invoke('admin:bulkDelete', entityType, entityIds),
    bulkNotify: (entityType, entityIds, message) => invoke('admin:bulkNotify', entityType, entityIds, message),
    // Deep Fleet Health + App Update Control
    pushUpdateNotification: (version, message, force) => invoke('admin:pushUpdateNotification', version, message, force),
    getSyncQueueStatus: () => invoke('admin:getSyncQueueStatus'),
    // Release Rollout Control
    createRelease: (release) => invoke('admin:createRelease', release),
    updateRelease: (version, updates) => invoke('admin:updateRelease', version, updates),
    checkUpdateAvailability: (currentVersion, deviceId) => invoke('admin:checkUpdateAvailability', currentVersion, deviceId),
    getReleases: (productId) => invoke('admin:getReleases', productId),
    getSurfaceIntelligence: () => invoke('admin:getSurfaceIntelligence')
  },
  conference: {
    getAll: (start, end) => invoke('conference:getAll', start, end),
    create: (data) => invoke('conference:create', data),
    update: (id, data) => invoke('conference:update', id, data),
    delete: (id) => invoke('conference:delete', id),
    updatePayment: (id, amount, method, intentKey) => invoke('conference:updatePayment', id, amount, method, intentKey)
  },
  events: {
    getAll: (start, end) => invoke('events:getAll', start, end),
    getById: (id) => invoke('events:getById', id),
    getDetails: (id) => invoke('events:getDetails', id),
    create: (data) => invoke('events:create', data),
    update: (id, data) => invoke('events:update', id, data),
    cancel: (id, reason, cancelLinkedRooms) => invoke('events:cancel', id, reason, cancelLinkedRooms),
    addLineItem: (data) => invoke('events:addLineItem', data),
    voidLineItem: (lineItemId, reason) => invoke('events:voidLineItem', lineItemId, reason),
    updatePayment: (id, amount, method, type, intentKey) => invoke('events:updatePayment', id, amount, method, type, intentKey),
    checkAvailability: (resourceKey, startAt, endAt, excludeEventId) => invoke('events:checkAvailability', resourceKey, startAt, endAt, excludeEventId),
    getVenuePackages: (category, activeOnly) => invoke('events:getVenuePackages', category, activeOnly),
    createVenuePackage: (data) => invoke('events:createVenuePackage', data),
    updateVenuePackage: (id, data) => invoke('events:updateVenuePackage', id, data),
    deleteVenuePackage: (id) => invoke('events:deleteVenuePackage', id),
    applyPackage: (packageId, eventBookingId, quantity, intentKey) => invoke('events:applyPackage', packageId, eventBookingId, quantity, intentKey)
  },
  venueManagement: {
    getEventLeads:                 (status)                                           => invoke('venueManagement:getEventLeads', status),
    createEventLead:               (data)                                             => invoke('venueManagement:createEventLead', data),
    updateEventLead:               (id, data)                                         => invoke('venueManagement:updateEventLead', id, data),
    convertLeadToBooking:          (leadId)                                           => invoke('venueManagement:convertLeadToBooking', leadId),
    getVenueAvailabilityRules:     (resourceKey)                                      => invoke('venueManagement:getVenueAvailabilityRules', resourceKey),
    upsertVenueAvailabilityRule:    (data)                                             => invoke('venueManagement:upsertVenueAvailabilityRule', data),
    getVenueAvailabilityCalendar:   (resourceKey, startDate, endDate)                  => invoke('venueManagement:getVenueAvailabilityCalendar', resourceKey, startDate, endDate),
    getRunSheet:                   (eventBookingId)                                   => invoke('venueManagement:getRunSheet', eventBookingId),
    createRunSheet:                (data)                                             => invoke('venueManagement:createRunSheet', data),
    updateRunSheet:                (id, data)                                         => invoke('venueManagement:updateRunSheet', id, data),
    finalizeRunSheet:              (id)                                               => invoke('venueManagement:finalizeRunSheet', id),
    executeRunSheet:               (id)                                               => invoke('venueManagement:executeRunSheet', id),
    getEventSuppliers:             (eventBookingId)                                   => invoke('venueManagement:getEventSuppliers', eventBookingId),
    createSupplierEntry:           (data)                                             => invoke('venueManagement:createSupplierEntry', data),
    updateSupplierEntry:           (id, data)                                         => invoke('venueManagement:updateSupplierEntry', id, data),
    updateSupplierStatus:          (id, status, actualAmount)                         => invoke('venueManagement:updateSupplierStatus', id, status, actualAmount),
    getDepositMilestones:          (eventBookingId)                                   => invoke('venueManagement:getDepositMilestones', eventBookingId),
    createDepositMilestone:        (data)                                             => invoke('venueManagement:createDepositMilestone', data),
    markMilestonePaid:             (id, paidDate, method, reference)                  => invoke('venueManagement:markMilestonePaid', id, paidDate, method, reference),
    waiveMilestone:                (id, reason)                                       => invoke('venueManagement:waiveMilestone', id, reason),
    settleEvent:                   (eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes) => invoke('venueManagement:settleEvent', eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes),
    getEventProfitability:         (eventBookingId)                                   => invoke('venueManagement:getEventProfitability', eventBookingId),
    getVenueProfitabilityReport:   (startDate, endDate)                               => invoke('venueManagement:getVenueProfitabilityReport', startDate, endDate)
  },
  ai: {
    turn: (payload) => invoke('ai:turn', payload),
    catalog: () => invoke('ai:catalog'),
    execute: (payload) => invoke('ai:execute', payload),
    collections: {
      preview: (payload) => invoke('ai:collections:preview', payload),
      execute: (payload) => invoke('ai:collections:execute', payload),
      onProgress: (cb) => {
        const listener = (_, data) => cb(data)
        ipcRenderer.on('ai:collections:progress', listener)
        return () => ipcRenderer.off('ai:collections:progress', listener)
      }
    },
    overdue: {
      preview: (payload) => invoke('ai:overdue:preview', payload),
      execute: (payload) => invoke('ai:overdue:execute', payload),
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
    parseExcel: (filePath) => invoke('import:parseExcel', filePath),
    getDroppedFilePath: (file) => webUtils?.getPathForFile?.(file) || file?.path || '',
    exportErrors: (payload) => invoke('import:exportErrors', payload),
    execute: (rows, filename, type) => invoke('import:execute', rows, filename, type),
    dryRun: (rows, type) => invoke('import:dryRun', rows, type),
    getTypes: () => invoke('import:getTypes'),
    checkDuplicates: (rows) => invoke('import:checkDuplicates', rows),
    undoBatch: (batchId) => invoke('import:undoBatch', batchId),
    getBatches: () => invoke('import:getBatches'),
    downloadTemplate: (type) => invoke('import:downloadTemplate', type),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('import:progress', handler)
      return () => ipcRenderer.removeListener('import:progress', handler)
    }
  },
  data: {
    exportAll: (options) => invoke('data:exportAll', options),
    onExportProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('data:exportProgress', handler)
      return () => ipcRenderer.removeListener('data:exportProgress', handler)
    }
  },
  dayuse: {
    getAll: (start, end) => invoke('dayuse:getAll', start, end),
    add: (data) => invoke('dayuse:add', data),
    delete: (id) => invoke('dayuse:delete', id),
    updateStatus: (id, status) => invoke('dayuse:updateStatus', id, status),
    settleBalance: (id, method, markCompleted = true) => invoke('dayuse:settleBalance', id, method, markCompleted),
    summary: (date) => invoke('dayuse:summary', date),
    getInventoryItems: () => invoke('dayuse:getInventoryItems'),
    getConfig: () => invoke('dayuse:getConfig'),
    saveConfig: (data) => invoke('dayuse:saveConfig', data)
  },
  email: {
    getConfig: () => invoke('email:getConfig'),
    saveConfig: (config) => invoke('email:saveConfig', config),
    test: (config) => invoke('email:test', config),
    sendLicense: (payload) => invoke('email:sendLicense', payload)
  },
  hotel: {
    getDashboardStats: () => invoke('hotel:getDashboardStats'),
    getArrivals:      () => invoke('hotel:getArrivals'),
    getDepartures:    () => invoke('hotel:getDepartures'),
    getInHouse:       () => invoke('hotel:getInHouse'),
    getNoShows:       () => invoke('hotel:getNoShows'),
    getKpis:          (days) => invoke('hotel:getKpis', days),
    getApplicableRoomRate: (roomId, date, corporateAccountId) =>
      invoke('hotel:getApplicableRoomRate', roomId, date, corporateAccountId),
    quoteRoomStay: (roomId, checkIn, checkOut, corporateAccountId) =>
      invoke('hotel:quoteRoomStay', roomId, checkIn, checkOut, corporateAccountId)
  },
  roomTypes: {
    getAll:  ()                    => invoke('roomTypes:getAll'),
    create:  (data)               => invoke('roomTypes:create', data),
    update:  (id, data)           => invoke('roomTypes:update', id, data),
    delete:  (id)                 => invoke('roomTypes:delete', id)
  },
  roomAttributes: {
    getAll:  ()                    => invoke('roomAttributes:getAll'),
    create:  (data)               => invoke('roomAttributes:create', data),
    update:  (id, data)           => invoke('roomAttributes:update', id, data),
    delete:  (id)                 => invoke('roomAttributes:delete', id)
  },
  floorSections: {
    getAll:  ()                    => invoke('floorSections:getAll'),
    create:  (data)               => invoke('floorSections:create', data),
    update:  (id, data)           => invoke('floorSections:update', id, data),
    delete:  (id)                 => invoke('floorSections:delete', id)
  },
  folios: {
    getAll:      ()             => invoke('folios:getAll'),
    getEntries:  (bookingId)    => invoke('folios:getEntries', bookingId),
    postCharge:  (bookingId, data) => invoke('folios:postCharge', bookingId, data)
  },
  folioLedger: {
    getFolios:      (bookingId)                    => invoke('folioLedger:getFolios', bookingId),
    getLineItems:   (folioId)                      => invoke('folioLedger:getLineItems', folioId),
    createFolio:    (bookingId, guestId, type, label, intentId) => invoke('folioLedger:createFolio', bookingId, guestId, type, label, intentId),
    addCharge:      (folioId, amount, description, refType, refId, intentId) => invoke('folioLedger:addCharge', folioId, amount, description, refType, refId, intentId),
    addPayment:     (folioId, amount, description, intentId) => invoke('folioLedger:addPayment', folioId, amount, description, intentId),
    transferCharge: (srcFolioId, tgtFolioId, amount, description, intentId) => invoke('folioLedger:transferCharge', srcFolioId, tgtFolioId, amount, description, intentId),
    splitFolio:     (srcFolioId, tgtType, tgtLabel, amount, description, intentId) => invoke('folioLedger:splitFolio', srcFolioId, tgtType, tgtLabel, amount, description, intentId),
    voidLineItem:   (lineItemId, reason, intentId)            => invoke('folioLedger:voidLineItem', lineItemId, reason, intentId),
    closeFolio:     (folioId, intentId)                       => invoke('folioLedger:closeFolio', folioId, intentId),
    reopenFolio:    (folioId, intentId)                       => invoke('folioLedger:reopenFolio', folioId, intentId),
    lockFolio:      (folioId, intentId)                       => invoke('folioLedger:lockFolio', folioId, intentId),
    getBalance:     (folioId)                       => invoke('folioLedger:getBalance', folioId)
  },
  roomMoves: {
    getAvailable: (currentRoomId, checkIn, checkOut) => invoke('roomMoves:getAvailable', currentRoomId, checkIn, checkOut),
    execute:      (bookingId, targetRoomId, reason, actorName) => invoke('roomMoves:execute', bookingId, targetRoomId, reason, actorName)
  },
  corporateAccounts: {
    getAll:  ()        => invoke('corporateAccounts:getAll'),
    create:  (data)    => invoke('corporateAccounts:create', data),
    update:  (id, data) => invoke('corporateAccounts:update', id, data),
    delete:  (id)      => invoke('corporateAccounts:delete', id)
  },
  corporateBilling: {
    charge:          (accountId, bookingId, amount, description, intentId) => invoke('corporateBilling:charge', accountId, bookingId, amount, description, intentId),
    getOutstanding:  (accountId)                                  => invoke('corporateBilling:getOutstanding', accountId),
    recordPayment:   (accountId, invoiceIds, amount, method, reference, intentId) => invoke('corporateBilling:recordPayment', accountId, invoiceIds, amount, method, reference, intentId),
    getStatement:    (accountId, start, end)                      => invoke('corporateBilling:getStatement', accountId, start, end),
    checkCreditLimit:(accountId, pendingAmount)                    => invoke('corporateBilling:checkCreditLimit', accountId, pendingAmount),
    suspend:         (accountId, reason)                           => invoke('corporateBilling:suspend', accountId, reason),
    reactivate:      (accountId)                                   => invoke('corporateBilling:reactivate', accountId)
  },
  ratePlans: {
    getAll:  ()        => invoke('ratePlans:getAll'),
    create:  (data)    => invoke('ratePlans:create', data),
    update:  (id, data) => invoke('ratePlans:update', id, data),
    delete:  (id)      => invoke('ratePlans:delete', id),
    quoteRoomStay: (roomId, checkIn, checkOut, corporateAccountId) =>
      invoke('ratePlans:quoteRoomStay', roomId, checkIn, checkOut, corporateAccountId)
  },
  rateCalendar: {
    get: (roomTypeId, startDate, endDate) => invoke('rateCalendar:get', roomTypeId, startDate, endDate),
    setEntry: (roomTypeId, date, amount, currency) => invoke('rateCalendar:setEntry', roomTypeId, date, amount, currency),
    setBulk: (entries) => invoke('rateCalendar:setBulk', entries),
    setRestriction: (roomTypeId, date, restrictions) => invoke('rateCalendar:setRestriction', roomTypeId, date, restrictions),
    getConflicts: (roomTypeId, startDate, endDate) => invoke('rateCalendar:getConflicts', roomTypeId, startDate, endDate),
    getApplicableRate: (roomTypeId, date) => invoke('rateCalendar:getApplicableRate', roomTypeId, date),
    quoteStayTotal: (roomId, checkIn, checkOut, corporateAccountId) =>
      invoke('rateCalendar:quoteStayTotal', roomId, checkIn, checkOut, corporateAccountId),
    getYieldRules: () => invoke('rateCalendar:getYieldRules'),
    createYieldRule: (data) => invoke('rateCalendar:createYieldRule', data),
    updateYieldRule: (id, data) => invoke('rateCalendar:updateYieldRule', id, data),
    deleteYieldRule: (id) => invoke('rateCalendar:deleteYieldRule', id),
    getApplicableYieldAdjustment: (date, currentOccupancyPct) => invoke('rateCalendar:getApplicableYieldAdjustment', date, currentOccupancyPct),
    calculateOccupancyBasedRate: (baseRate, date, roomTypeId) => invoke('rateCalendar:calculateOccupancyBasedRate', baseRate, date, roomTypeId),
    getOccupancyForecast: (startDate, endDate) => invoke('rateCalendar:getOccupancyForecast', startDate, endDate)
  },
  promoCodes: {
    getAll: () => invoke('promoCodes:getAll'),
    create: (data) => invoke('promoCodes:create', data),
    update: (id, data) => invoke('promoCodes:update', id, data),
    delete: (id) => invoke('promoCodes:delete', id),
    validate: (code, roomTypeId, nights) => invoke('promoCodes:validate', code, roomTypeId, nights)
  },
  seasonLabels: {
    getAll: () => invoke('seasonLabels:getAll'),
    create: (data) => invoke('seasonLabels:create', data),
    update: (id, data) => invoke('seasonLabels:update', id, data),
    delete: (id) => invoke('seasonLabels:delete', id)
  },
  revenueManager: {
    getForecast: (startDate, endDate) => invoke('revenueManager:getForecast', startDate, endDate),
    upsertForecast: (date, occupancyPct, adr, notes) => invoke('revenueManager:upsertForecast', date, occupancyPct, adr, notes),
    getCompetitorNotes: () => invoke('revenueManager:getCompetitorNotes'),
    createCompetitorNote: (competitorName, roomTypeId, notedRate, notes) => invoke('revenueManager:createCompetitorNote', competitorName, roomTypeId, notedRate, notes),
    getDemandEvents: (startDate, endDate) => invoke('revenueManager:getDemandEvents', startDate, endDate),
    createDemandEvent: (eventName, eventDate, expectedImpact, notes) => invoke('revenueManager:createDemandEvent', eventName, eventDate, expectedImpact, notes),
    getRecommendations: () => invoke('revenueManager:getRecommendations'),
    approveRecommendation: (recommendation, notes) => invoke('revenueManager:approveRecommendation', recommendation, notes),
    rejectRecommendation: (recommendation, reason) => invoke('revenueManager:rejectRecommendation', recommendation, reason),
    applyRecommendation: (recommendation) => invoke('revenueManager:applyRecommendation', recommendation)
  },
  advancedReports: {
    getOccupancy: (start, end) => invoke('advancedReports:getOccupancy', start, end),
    getPace: (start, end) => invoke('advancedReports:getPace', start, end),
    getPickup: (start, end) => invoke('advancedReports:getPickup', start, end),
    getChannelSource: (start, end) => invoke('advancedReports:getChannelSource', start, end),
    getDebtorAging: () => invoke('advancedReports:getDebtorAging'),
    getRatePerformance: (start, end) => invoke('advancedReports:getRatePerformance', start, end),
    getHousekeepingProductivity: (start, end) => invoke('advancedReports:getHousekeepingProductivity', start, end),
    getRoomDowntime: (start, end) => invoke('advancedReports:getRoomDowntime', start, end),
    getGroupPickup: (start, end) => invoke('advancedReports:getGroupPickup', start, end),
    getCancellationNoShow: (start, end) => invoke('advancedReports:getCancellationNoShow', start, end),
    getTaxVat: (start, end) => invoke('advancedReports:getTaxVat', start, end),
    getDepositLiability: () => invoke('advancedReports:getDepositLiability'),
    getFolioExceptions: () => invoke('advancedReports:getFolioExceptions')
  },
  payments: {
    getProviderConfig:  (provider, lodgeId)       => invoke('payments:getProviderConfig', provider, lodgeId),
    saveProviderConfig: (payload, lodgeId)        => invoke('payments:saveProviderConfig', payload, lodgeId)
  },
  subscriptionRequests: {
    submit: (request) => invoke('subscriptionRequests:submit', request),
    getAll: (status, limit, offset) => invoke('subscriptionRequests:getAll', status, limit, offset),
    getById: (requestId) => invoke('subscriptionRequests:getById', requestId),
    updateStatus: (requestId, status, reviewedBy, rejectionReason) => invoke('subscriptionRequests:updateStatus', requestId, status, reviewedBy, rejectionReason),
    createDocument: (requestId, type, documentInput) => invoke('subscriptionRequests:createDocument', requestId, type, documentInput),
    exportDocumentPdf: (documentPayload) => invoke('subscriptionRequests:exportDocumentPdf', documentPayload),
    activate: (requestId, activatedBy, activationPayload) => invoke('subscriptionRequests:activate', requestId, activatedBy, activationPayload)
  },
  groupBlocks: {
    getAll:  ()          => invoke('groupBlocks:getAll'),
    create:  (data)      => invoke('groupBlocks:create', data),
    update:  (id, data)  => invoke('groupBlocks:update', id, data),
    delete:  (id)        => invoke('groupBlocks:delete', id)
  },
  masterFolios: {
    getAll:  ()                      => invoke('masterFolios:getAll'),
    create:  (data)                  => invoke('masterFolios:create', data),
    getDebtorAging: (caId)           => invoke('masterFolios:getDebtorAging', caId),
    checkCreditLimit: (caId, amt)    => invoke('masterFolios:checkCreditLimit', caId, amt),
    generateStatement: (caId, s, e)  => invoke('masterFolios:generateStatement', caId, s, e)
  },
  roomingLists: {
    getAll:    ()                                  => invoke('roomingLists:getAll'),
    process:   (entries, caId, gbId, name)         => invoke('roomingLists:process', entries, caId, gbId, name),
    parseCSV:  (csvText)                           => invoke('roomingLists:parseCSV', csvText)
  },
  groupOperations: {
    getAll:               ()                        => invoke('groupOperations:getAll'),
    checkinBlock:         (blockId)                 => invoke('groupOperations:checkinBlock', blockId),
    checkoutBlock:        (blockId)                 => invoke('groupOperations:checkoutBlock', blockId),
    getPickup:            (blockId)                 => invoke('groupOperations:getPickup', blockId),
    releaseUnsold:        (blockId)                 => invoke('groupOperations:releaseUnsold', blockId),
    createFromRoomingList:(listId)                  => invoke('groupOperations:createFromRoomingList', listId)
  },
  multiProperty: {
    getAllGroups:              ()                           => invoke('multiProperty:getAllGroups'),
    createGroup:               (data)                       => invoke('multiProperty:createGroup', data),
    updateGroup:               (id, data)                   => invoke('multiProperty:updateGroup', id, data),
    deleteGroup:               (id)                         => invoke('multiProperty:deleteGroup', id),
    getProperties:             (groupId)                    => invoke('multiProperty:getProperties', groupId),
    addProperty:               (groupId, lodgeId, role)     => invoke('multiProperty:addProperty', groupId, lodgeId, role),
    removeProperty:            (groupId, lodgeId)           => invoke('multiProperty:removeProperty', groupId, lodgeId),
    getConsolidatedDashboard:  (groupId)                    => invoke('multiProperty:getConsolidatedDashboard', groupId),
    getConsolidatedOccupancy:  (groupId, start, end)        => invoke('multiProperty:getConsolidatedOccupancy', groupId, start, end),
    getConsolidatedFinancial:  (groupId, start, end)        => invoke('multiProperty:getConsolidatedFinancial', groupId, start, end),
    switchProperty:            (lodgeId)                    => invoke('multiProperty:switchProperty', lodgeId),
    getGroupSettings:          (groupId)                    => invoke('multiProperty:getGroupSettings', groupId),
    updateGroupSettings:       (groupId, key, value)        => invoke('multiProperty:updateGroupSettings', groupId, key, value),
    getSharedGuestProfiles:    (groupId)                    => invoke('multiProperty:getSharedGuestProfiles', groupId),
    shareGuestProfile:         (groupId, guestId, notes)    => invoke('multiProperty:shareGuestProfile', groupId, guestId, notes),
    unshareGuestProfile:       (groupId, guestId)           => invoke('multiProperty:unshareGuestProfile', groupId, guestId),
    getSharedBlacklist:        (groupId)                    => invoke('multiProperty:getSharedBlacklist', groupId),
    addBlacklistEntry:         (groupId, guestId, email, phone, reason) => invoke('multiProperty:addBlacklistEntry', groupId, guestId, email, phone, reason),
    removeBlacklistEntry:      (groupId, entryId)           => invoke('multiProperty:removeBlacklistEntry', groupId, entryId),
    getSharedCorporateAccounts:(groupId)                    => invoke('multiProperty:getSharedCorporateAccounts', groupId),
    shareCorporateAccount:     (groupId, corporateAccountId, shareLevel) => invoke('multiProperty:shareCorporateAccount', groupId, corporateAccountId, shareLevel),
    unshareCorporateAccount:   (groupId, corporateAccountId) => invoke('multiProperty:unshareCorporateAccount', groupId, corporateAccountId),
    getGroupMemberLodges:      (groupId)                    => invoke('multiProperty:getGroupMemberLodges', groupId)
  },
  enterpriseOperations: {
    getRecords:      (workflowKey, lodgeId)         => invoke('enterpriseOperations:getRecords', workflowKey, lodgeId),
    upsertRecord:    (workflowKey, record, lodgeId) => invoke('enterpriseOperations:upsertRecord', workflowKey, record, lodgeId),
    appendEvent:     (workflowKey, event, lodgeId)  => invoke('enterpriseOperations:appendEvent', workflowKey, event, lodgeId),
    createPaymentLinkRequest: (payload)    => invoke('enterpriseOperations:createPaymentLinkRequest', payload),
    createChannelSyncItem:    (payload)    => invoke('enterpriseOperations:createChannelSyncItem', payload),
    createDocument:           (payload)    => invoke('enterpriseOperations:createDocument', payload)
  },
  lostFound: {
    getAll:  ()        => invoke('lostFound:getAll'),
    create:  (data)    => invoke('lostFound:create', data),
    update:  (id, data) => invoke('lostFound:update', id, data),
    delete:  (id)      => invoke('lostFound:delete', id)
  },
  housekeepingCommandCenter: {
    getDashboard: (date) => invoke('housekeepingCommandCenter:getDashboard', date),
    createAssignment: (roomId, assignedTo, date, shift) => invoke('housekeepingCommandCenter:createAssignment', roomId, assignedTo, date, shift),
    updateAssignmentStatus: (id, status, notes) => invoke('housekeepingCommandCenter:updateAssignmentStatus', id, status, notes),
    createInspection: (roomId, inspectedBy, checklistResults) => invoke('housekeepingCommandCenter:createInspection', roomId, inspectedBy, checklistResults),
    startTurnaround: (bookingId) => invoke('housekeepingCommandCenter:startTurnaround', bookingId),
    completeTurnaround: (turnaroundId) => invoke('housekeepingCommandCenter:completeTurnaround', turnaroundId),
    getTurnaroundTimes: (startDate, endDate) => invoke('housekeepingCommandCenter:getTurnaroundTimes', startDate, endDate),
    getProductivity: (startDate, endDate) => invoke('housekeepingCommandCenter:getProductivity', startDate, endDate),
    getChecklistItems: () => invoke('housekeepingCommandCenter:getChecklistItems'),
    createChecklistItem: (data) => invoke('housekeepingCommandCenter:createChecklistItem', data),
    updateChecklistItem: (id, data) => invoke('housekeepingCommandCenter:updateChecklistItem', id, data),
    deleteChecklistItem: (id) => invoke('housekeepingCommandCenter:deleteChecklistItem', id)
  },
  maintenanceEnterprise: {
    getAllPreventiveSchedules: () => invoke('maintenanceEnterprise:getAllPreventiveSchedules'),
    createPreventiveSchedule: (data) => invoke('maintenanceEnterprise:createPreventiveSchedule', data),
    updatePreventiveSchedule: (id, data) => invoke('maintenanceEnterprise:updatePreventiveSchedule', id, data),
    deletePreventiveSchedule: (id) => invoke('maintenanceEnterprise:deletePreventiveSchedule', id),
    getDuePreventive: (date) => invoke('maintenanceEnterprise:getDuePreventive', date),
    completePreventive: (id, completedBy, notes) => invoke('maintenanceEnterprise:completePreventive', id, completedBy, notes),
    setRoomOutOfOrder: (roomId, startDate, reason, endDate, ticketId) => invoke('maintenanceEnterprise:setRoomOutOfOrder', roomId, startDate, reason, endDate, ticketId),
    setRoomOutOfService: (roomId, startDate, reason, endDate, ticketId) => invoke('maintenanceEnterprise:setRoomOutOfService', roomId, startDate, reason, endDate, ticketId),
    returnRoomToService: (downtimeId) => invoke('maintenanceEnterprise:returnRoomToService', downtimeId),
    getRoomDowntimeHistory: (roomId) => invoke('maintenanceEnterprise:getRoomDowntimeHistory', roomId),
    getMaintenanceDashboard: () => invoke('maintenanceEnterprise:getMaintenanceDashboard'),
    getDowntimeReport: (startDate, endDate) => invoke('maintenanceEnterprise:getDowntimeReport', startDate, endDate)
  },
  assetRegistry: {
    getAssets: (assetType, status) => invoke('assetRegistry:getAssets', assetType, status),
    createAsset: (data) => invoke('assetRegistry:createAsset', data),
    updateAsset: (id, data) => invoke('assetRegistry:updateAsset', id, data),
    deleteAsset: (id) => invoke('assetRegistry:deleteAsset', id),
    getMaintenanceHistory: (assetId) => invoke('assetRegistry:getMaintenanceHistory', assetId),
    logMaintenance: (assetId, ticketId, description, cost, vendorId) => invoke('assetRegistry:logMaintenance', assetId, ticketId, description, cost, vendorId),
    getVendors: (specialisation) => invoke('assetRegistry:getVendors', specialisation),
    createVendor: (data) => invoke('assetRegistry:createVendor', data),
    updateVendor: (id, data) => invoke('assetRegistry:updateVendor', id, data),
    deleteVendor: (id) => invoke('assetRegistry:deleteVendor', id)
  },
  assetManagement: {
    getAssetCategories:            ()                                      => invoke('assetManagement:getAssetCategories'),
    createAssetCategory:           (data)                                  => invoke('assetManagement:createAssetCategory', data),
    updateAssetCategory:           (id, data)                              => invoke('assetManagement:updateAssetCategory', id, data),
    deleteAssetCategory:           (id)                                    => invoke('assetManagement:deleteAssetCategory', id),
    getAssetWarranties:            (assetId)                               => invoke('assetManagement:getAssetWarranties', assetId),
    createAssetWarranty:           (data)                                  => invoke('assetManagement:createAssetWarranty', data),
    updateAssetWarranty:           (id, data)                              => invoke('assetManagement:updateAssetWarranty', id, data),
    deleteAssetWarranty:           (id)                                    => invoke('assetManagement:deleteAssetWarranty', id),
    getAssetInspections:           (assetId)                               => invoke('assetManagement:getAssetInspections', assetId),
    createAssetInspection:         (data)                                  => invoke('assetManagement:createAssetInspection', data),
    deleteAssetInspection:         (id)                                    => invoke('assetManagement:deleteAssetInspection', id),
    getAssetAttachments:           (assetId)                               => invoke('assetManagement:getAssetAttachments', assetId),
    createAssetAttachment:         (data)                                  => invoke('assetManagement:createAssetAttachment', data),
    deleteAssetAttachment:         (id)                                    => invoke('assetManagement:deleteAssetAttachment', id),
    getAssetCosts:                 (assetId)                               => invoke('assetManagement:getAssetCosts', assetId),
    recordAssetCost:               (data)                                  => invoke('assetManagement:recordAssetCost', data),
    getAssetCostSummary:           (startDate, endDate)                    => invoke('assetManagement:getAssetCostSummary', startDate, endDate),
    getPreventiveTemplates:        (categoryId)                            => invoke('assetManagement:getPreventiveTemplates', categoryId),
    createPreventiveTemplate:      (data)                                  => invoke('assetManagement:createPreventiveTemplate', data),
    updatePreventiveTemplate:      (id, data)                              => invoke('assetManagement:updatePreventiveTemplate', id, data),
    deletePreventiveTemplate:      (id)                                    => invoke('assetManagement:deletePreventiveTemplate', id),
    getPreventiveAssignments:      (assetId, status)                       => invoke('assetManagement:getPreventiveAssignments', assetId, status),
    createPreventiveAssignment:    (data)                                  => invoke('assetManagement:createPreventiveAssignment', data),
    completePreventiveAssignment:  (id, notes)                             => invoke('assetManagement:completePreventiveAssignment', id, notes),
    skipPreventiveAssignment:      (id, notes)                             => invoke('assetManagement:skipPreventiveAssignment', id, notes),
    generatePreventiveAssignments: ()                                      => invoke('assetManagement:generatePreventiveAssignments'),
    getAssetDashboard:             ()                                      => invoke('assetManagement:getAssetDashboard'),
    setAssetRoomSellability:       (assetId, affectsSellability, sellabilityNotes) => invoke('assetManagement:setAssetRoomSellability', assetId, affectsSellability, sellabilityNotes)
  },
  operationsCompliance: {
    createLinenStocktake: (items) => invoke('operationsCompliance:createLinenStocktake', items),
    getLinenDashboard: () => invoke('operationsCompliance:getLinenDashboard'),
    reportDamagedLinen: (itemId, quantity, reason) => invoke('operationsCompliance:reportDamagedLinen', itemId, quantity, reason),
    chargeDamagedLinen: (bookingId, linenItemId, quantity, amount) => invoke('operationsCompliance:chargeDamagedLinen', bookingId, linenItemId, quantity, amount),
    claimLostFoundItem: (itemId, claimerName, claimerContact, disposition) => invoke('operationsCompliance:claimLostFoundItem', itemId, claimerName, claimerContact, disposition),
    getLostFoundDashboard: () => invoke('operationsCompliance:getLostFoundDashboard'),
    resolveIncident: (id, resolution, resolvedBy) => invoke('operationsCompliance:resolveIncident', id, resolution, resolvedBy),
    getIncidentDashboard: () => invoke('operationsCompliance:getIncidentDashboard'),
    getVisitorDashboard: () => invoke('operationsCompliance:getVisitorDashboard'),
    getVisitorHistory: (startDate, endDate) => invoke('operationsCompliance:getVisitorHistory', startDate, endDate),
    getEvacuationList: () => invoke('operationsCompliance:getEvacuationList'),
    exportEvacuationReport: () => invoke('operationsCompliance:exportEvacuationReport'),
    createShiftHandover: (data) => invoke('operationsCompliance:createShiftHandover', data),
    completeShiftHandover: (id) => invoke('operationsCompliance:completeShiftHandover', id),
    getShiftHandoverHistory: () => invoke('operationsCompliance:getShiftHandoverHistory')
  },
  incidents: {
    getAll:  ()        => invoke('incidents:getAll'),
    create:  (data)    => invoke('incidents:create', data),
    update:  (id, data) => invoke('incidents:update', id, data)
  },
  visitors: {
    getAll:    ()      => invoke('visitors:getAll'),
    create:    (data)  => invoke('visitors:create', data),
    checkout:  (id)    => invoke('visitors:checkout', id)
  },
  linen: {
    getAll:      ()    => invoke('linen:getAll'),
    create:      (data) => invoke('linen:create', data),
    getBatches:  ()    => invoke('linen:getBatches'),
    createBatch: (data) => invoke('linen:createBatch', data)
  },
  channelManager: {
    getDashboard:     ()                                          => invoke('channelManager:getDashboard'),
    getMappings:      ()                                          => invoke('channelManager:getMappings'),
    createMapping:    (channelKey, sourceType, localId, channelCode, channelName) => invoke('channelManager:createMapping', channelKey, sourceType, localId, channelCode, channelName),
    updateMapping:    (id, channelCode, channelName)              => invoke('channelManager:updateMapping', id, channelCode, channelName),
    deleteMapping:    (id)                                        => invoke('channelManager:deleteMapping', id),
    getConfigs:       ()                                          => invoke('channelManager:getConfigs'),
    createConfig:     (channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations) => invoke('channelManager:createConfig', channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations),
    updateConfig:     (id, payload)                               => invoke('channelManager:updateConfig', id, payload),
    enableChannel:    (channelKey)                                => invoke('channelManager:enableChannel', channelKey),
    disableChannel:   (channelKey)                                => invoke('channelManager:disableChannel', channelKey),
    processSyncQueue: (channelKey)                                => invoke('channelManager:processSyncQueue', channelKey),
    pushAvailability: (channelKey, payload)                       => invoke('channelManager:pushAvailability', channelKey, payload),
    pushRates:        (channelKey, payload)                       => invoke('channelManager:pushRates', channelKey, payload),
    fetchReservations:(channelKey, since)                         => invoke('channelManager:fetchReservations', channelKey, since),
    importReservation:  (payload)                                 => invoke('channelManager:importReservation', payload),
    confirmImport:    (importId)                                  => invoke('channelManager:confirmImport', importId),
    rejectImport:     (importId, reason)                          => invoke('channelManager:rejectImport', importId, reason)
  },
  documentSystem: {
    getTemplates:       ()                                            => invoke('documentSystem:getTemplates'),
    createTemplate:     (templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix) => invoke('documentSystem:createTemplate', templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix),
    updateTemplate:     (id, payload)                                 => invoke('documentSystem:updateTemplate', id, payload),
    deleteTemplate:     (id)                                          => invoke('documentSystem:deleteTemplate', id),
    renderDocument:     (templateKey, subjectType, subjectId)         => invoke('documentSystem:renderDocument', templateKey, subjectType, subjectId),
    publishDocument:    (documentId)                                  => invoke('documentSystem:publishDocument', documentId),
    getDocumentHistory: (subjectType, subjectId)                      => invoke('documentSystem:getDocumentHistory', subjectType, subjectId),
    getDocumentDashboard: ()                                          => invoke('documentSystem:getDocumentDashboard')
  },
  hotelRoles: {
    getTemplates:       ()                           => invoke('hotelRoles:getTemplates'),
    getRoleCapabilities: (roleKey)                   => invoke('hotelRoles:getRoleCapabilities', roleKey)
  },
  payments: {
    getProviderConfig:   (provider, lodgeId)                  => invoke('payments:getProviderConfig', provider, lodgeId),
    saveProviderConfig:  (payload, lodgeId)                   => invoke('payments:saveProviderConfig', payload, lodgeId),
    getPaymentDashboard:  (lodgeId)                           => invoke('payments:getPaymentDashboard', lodgeId),
    verifyWebhookSignature: (provider, signature, payloadRaw) => invoke('payments:verifyWebhookSignature', provider, signature, payloadRaw)
  },
  guestMessaging: {
    getTemplates:       ()                                    => invoke('guestMessaging:getTemplates'),
    createTemplate:     (data)                                => invoke('guestMessaging:createTemplate', data),
    updateTemplate:     (id, data)                            => invoke('guestMessaging:updateTemplate', id, data),
    deleteTemplate:     (id)                                  => invoke('guestMessaging:deleteTemplate', id),
    getTriggers:        ()                                    => invoke('guestMessaging:getTriggers'),
    createTrigger:      (data)                                => invoke('guestMessaging:createTrigger', data),
    updateTrigger:      (id, data)                            => invoke('guestMessaging:updateTrigger', id, data),
    deleteTrigger:      (id)                                  => invoke('guestMessaging:deleteTrigger', id),
    renderTemplate:     (templateId, variables)               => invoke('guestMessaging:renderTemplate', templateId, variables),
    getDeliveryStatus:  (status)                              => invoke('guestMessaging:getDeliveryStatus', status),
    getChannelReadiness:(channel)                             => invoke('guestMessaging:getChannelReadiness', channel),
    dispatchMessage:    (messageId, options)                  => invoke('guestMessaging:dispatchMessage', messageId, options)
  },
  guestPortal: {
    getConfig:          ()                                    => invoke('guestPortal:getConfig'),
    updateConfig:       (config)                              => invoke('guestPortal:updateConfig', config),
    createSession:      (email, bookingRef)                   => invoke('guestPortal:createSession', email, bookingRef),
    validateSession:    (token)                               => invoke('guestPortal:validateSession', token),
    getPendingRequests: ()                                    => invoke('guestPortal:getPendingRequests')
  },
  guestCRM: {
    getProfile:      (customerId)                             => invoke('guestCRM:getProfile', customerId),
    updateProfile:   (customerId, data)                       => invoke('guestCRM:updateProfile', customerId, data),
    setVipLevel:     (customerId, level)                      => invoke('guestCRM:setVipLevel', customerId, level),
    addPreference:   (customerId, key, value)                 => invoke('guestCRM:addPreference', customerId, key, value),
    setBlacklist:    (customerId, blacklisted, reason)        => invoke('guestCRM:setBlacklist', customerId, blacklisted, reason),
    getStayHistory:  (customerId)                             => invoke('guestCRM:getStayHistory', customerId),
    recordConsent:   (customerId, consentType, granted)       => invoke('guestCRM:recordConsent', customerId, consentType, granted),
    search:          (query)                                  => invoke('guestCRM:search', query),
    getVipList:      ()                                       => invoke('guestCRM:getVipList'),
    listNotes:       (customerId)                             => invoke('guestCRM:listNotes', customerId),
    addNote:         (customerId, noteText, noteType)         => invoke('guestCRM:addNote', customerId, noteText, noteType)
  },
  nightAudit: {
    runChecks: () => invoke('nightAudit:runChecks'),
    close: (closedBy, notes, force = false) => invoke('nightAudit:close', closedBy, notes, force),
    reopen: (closeId, reopenedBy, reason) => invoke('nightAudit:reopen', closeId, reopenedBy, reason),
    getSummary: (date) => invoke('nightAudit:summary', date),
    getHistory: (limit) => invoke('nightAudit:history', limit),
    resolveException: (exceptionId, resolvedBy, notes) => invoke('nightAudit:resolveException', exceptionId, resolvedBy, notes)
  },
  checkinWorkflow: {
    getChecklist: (bookingId) => invoke('checkinWorkflow:getChecklist', bookingId),
    completeStep: (stepId, completedBy, data) => invoke('checkinWorkflow:completeStep', stepId, completedBy, data),
    resetStep: (stepId) => invoke('checkinWorkflow:resetStep', stepId),
    getConfig: () => invoke('checkinWorkflow:getConfig'),
    updateConfig: (config) => invoke('checkinWorkflow:updateConfig', config),
    completeHotelCheckin: (bookingId) => invoke('checkinWorkflow:completeHotelCheckin', bookingId),
    completeHotelCheckinWithOverride: (bookingId, overrideReason) =>
      invoke('checkinWorkflow:completeHotelCheckinWithOverride', bookingId, overrideReason)
  },
  checkoutWorkflow: {
    getChecklist: (bookingId) => invoke('checkoutWorkflow:getChecklist', bookingId),
    completeStep: (stepId, completedBy, data) => invoke('checkoutWorkflow:completeStep', stepId, completedBy, data),
    resetStep: (stepId) => invoke('checkoutWorkflow:resetStep', stepId),
    completeHotelCheckout: (bookingId) => invoke('checkoutWorkflow:completeHotelCheckout', bookingId)
  },
  earlyLateCheckout: {
    getEarlyPolicies: () => invoke('earlyLateCheckout:getEarlyPolicies'),
    createEarlyPolicy: (data) => invoke('earlyLateCheckout:createEarlyPolicy', data),
    updateEarlyPolicy: (id, data) => invoke('earlyLateCheckout:updateEarlyPolicy', id, data),
    deleteEarlyPolicy: (id) => invoke('earlyLateCheckout:deleteEarlyPolicy', id),
    getLatePolicies: () => invoke('earlyLateCheckout:getLatePolicies'),
    createLatePolicy: (data) => invoke('earlyLateCheckout:createLatePolicy', data),
    updateLatePolicy: (id, data) => invoke('earlyLateCheckout:updateLatePolicy', id, data),
    deleteLatePolicy: (id) => invoke('earlyLateCheckout:deleteLatePolicy', id),
    getEarlyRequests: () => invoke('earlyLateCheckout:getEarlyRequests'),
    createEarlyRequest: (bookingId, policyId, time) => invoke('earlyLateCheckout:createEarlyRequest', bookingId, policyId, time),
    approveEarlyRequest: (id) => invoke('earlyLateCheckout:approveEarlyRequest', id),
    rejectEarlyRequest: (id) => invoke('earlyLateCheckout:rejectEarlyRequest', id),
    getLateRequests: () => invoke('earlyLateCheckout:getLateRequests'),
    createLateRequest: (bookingId, policyId, time) => invoke('earlyLateCheckout:createLateRequest', bookingId, policyId, time),
    approveLateRequest: (id) => invoke('earlyLateCheckout:approveLateRequest', id),
    rejectLateRequest: (id) => invoke('earlyLateCheckout:rejectLateRequest', id),
    calculateEarlyFee: (bookingId, time) => invoke('earlyLateCheckout:calculateEarlyFee', bookingId, time),
    calculateLateFee: (bookingId, time) => invoke('earlyLateCheckout:calculateLateFee', bookingId, time)
  },
  cancellationPolicies: {
    getAll: () => invoke('cancellationPolicies:getAll'),
    create: (data) => invoke('cancellationPolicies:create', data),
    update: (id, data) => invoke('cancellationPolicies:update', id, data),
    delete: (id) => invoke('cancellationPolicies:delete', id),
    calculateFee: (bookingId, reason) => invoke('cancellationPolicies:calculateFee', bookingId, reason),
    process: (requestId, approvedBy) => invoke('cancellationPolicies:process', requestId, approvedBy),
    getRequests: () => invoke('cancellationPolicies:getRequests'),
    approve: (requestId, approvedBy) => invoke('cancellationPolicies:approve', requestId, approvedBy)
  },
  bookingEngine: {
    calculatePrice: (roomTypeId, checkIn, checkOut, numGuests) => invoke('bookingEngine:calculatePrice', roomTypeId, checkIn, checkOut, numGuests),
    checkAvailability: (roomTypeId, checkIn, checkOut, numRooms) => invoke('bookingEngine:checkAvailability', roomTypeId, checkIn, checkOut, numRooms),
    getUpsells: (roomTypeId, checkIn, checkOut, numGuests) => invoke('bookingEngine:getUpsells', roomTypeId, checkIn, checkOut, numGuests),
    createIntent: (roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options) =>
      invoke('bookingEngine:createIntent', roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options),
    confirmIntent: (intentOrId, confirmation) =>
      invoke('bookingEngine:confirmIntent', intentOrId, confirmation),
    getRules: () => invoke('bookingEngine:getRules'),
    createRule: (data) => invoke('bookingEngine:createRule', data),
    updateRule: (id, data) => invoke('bookingEngine:updateRule', id, data),
    deleteRule: (id) => invoke('bookingEngine:deleteRule', id),
    getUpsellsList: () => invoke('bookingEngine:getUpsellsList'),
    createUpsell: (data) => invoke('bookingEngine:createUpsell', data),
    updateUpsell: (id, data) => invoke('bookingEngine:updateUpsell', id, data),
    deleteUpsell: (id) => invoke('bookingEngine:deleteUpsell', id)
  },
  restaurantAccountingV2: {
    invoke: (operation, ...args) => invoke('restaurantAccountingV2:invoke', operation, args),
    exportFile: (payload) => invoke('restaurantAccountingV2:exportFile', payload)
  },
  abandonedPayments: {
    logSession: (bookingId, amount, provider, sessionToken, expiresAt) =>
      invoke('abandonedPayments:logSession', bookingId, amount, provider, sessionToken, expiresAt),
    getSessions: (statusFilter) =>
      invoke('abandonedPayments:getSessions', statusFilter),
    recoverSession: (sessionToken) =>
      invoke('abandonedPayments:recoverSession', sessionToken),
    expireSessions: () =>
      invoke('abandonedPayments:expireSessions'),
    getPendingRecovery: () =>
      invoke('abandonedPayments:getPendingRecovery')
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
