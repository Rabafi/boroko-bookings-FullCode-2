import { contextBridge, ipcRenderer } from 'electron';

/** IPC event payloads cross an unvalidated boundary and remain unknown. The
 * listener still forwards the exact value and returns off's actual result. */
/** @param {string} channel @param {(value: unknown) => void} cb */
const onIpc = (channel, cb) => {
  /** @param {import('electron').IpcRendererEvent} _event @param {unknown} value */
  const listener = (_event, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

/** @type {import('../shared/legacyApiContract.js').LegacyPosApi} */
const posAPI = {
  // Auth
  login: (/** @type {string} */ email, /** @type {string} */ password, /** @type {string|null} */ lodgeId = null) => ipcRenderer.invoke('pos:auth-login', { email, password, lodgeId }),
  restoreSession: (/** @type {unknown} */ credentials) => ipcRenderer.invoke('pos:auth-restore', credentials),
  hasTrustedSession: (/** @type {string} */ email) => ipcRenderer.invoke('pos:auth-has-trusted-session', email),
  logout: () => ipcRenderer.invoke('pos:auth-logout'),
  getConfig: () => ipcRenderer.invoke('pos:config'),
  saveConfig: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:save-config', data),
  barLocal: {
    getStatus: () => ipcRenderer.invoke('pos:bar-local:get-status'),
    selectCloudWorkspace: () => ipcRenderer.invoke('pos:bar-local:select-cloud-workspace'),
    pairDevice: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:pair-device', request),
    reconnectServer: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:reconnect-server', request),
    resumeProvisioning: () => ipcRenderer.invoke('pos:bar-local:resume-provisioning'),
    login: (staffId, pin) => ipcRenderer.invoke('pos:bar-local:login', staffId, pin),
    logout: () => ipcRenderer.invoke('pos:bar-local:logout'),
    startPairing: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:start-pairing', request),
    adminStatus: () => ipcRenderer.invoke('pos:bar-local:admin-status'),
    adminBackups: () => ipcRenderer.invoke('pos:bar-local:admin-backups'),
    adminRunBackup: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-run-backup', request),
    adminVerifyBackup: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-verify-backup', request),
    adminRestoreDrill: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-restore-drill', request),
    adminReplicationStatus: () => ipcRenderer.invoke('pos:bar-local:admin-replication-status'),
    adminSetDurability: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-set-durability', request),
    adminSwitchover: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-switchover', request),
    adminUpdateStatus: () => ipcRenderer.invoke('pos:bar-local:admin-update-status'),
    adminCloudSyncStatus: () => ipcRenderer.invoke('pos:bar-local:admin-cloud-sync-status'),
    adminCloudSyncConfig: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-cloud-sync-config', request),
    adminCloudSyncRun: (/** @type {unknown} */ request) => ipcRenderer.invoke('pos:bar-local:admin-cloud-sync-run', request),
    query: (/** @type {string} */ name, /** @type {unknown} */ filters) => ipcRenderer.invoke('pos:bar-local:query', name, filters),
    events: (/** @type {unknown} */ after, /** @type {number} */ limit) => ipcRenderer.invoke('pos:bar-local:events', after, limit),
    requestApproval: (/** @type {string} */ command, /** @type {unknown} */ payload, /** @type {string} */ pin, /** @type {unknown} */ options) => ipcRenderer.invoke('pos:bar-local:request-approval', command, payload, pin, options),
    command: (/** @type {string} */ command, /** @type {unknown} */ payload, /** @type {unknown} */ options) => ipcRenderer.invoke('pos:bar-local:command', command, payload, options),
    retry: (/** @type {string} */ operationId) => ipcRenderer.invoke('pos:bar-local:retry', operationId),
    getOpenIntents: () => ipcRenderer.invoke('pos:bar-local:get-open-intents'),
    getOperation: (/** @type {string} */ operationId) => ipcRenderer.invoke('pos:bar-local:get-operation', operationId),
    resolveOperation: (/** @type {string} */ operationId) => ipcRenderer.invoke('pos:bar-local:resolve-operation', operationId),
    refreshReadiness: () => ipcRenderer.invoke('pos:bar-local:refresh-readiness'),
    printReceipt: (/** @type {string} */ saleId) => ipcRenderer.invoke('pos:bar-local:print-receipt', saleId)
  },

  // Connection
  goOnline: () => ipcRenderer.invoke('pos:go-online'),
  goOffline: () => ipcRenderer.invoke('pos:go-offline'),
  getIsOnline: () => ipcRenderer.invoke('pos:get-is-online'),

  // Menu Items
  getMenuItems: () => ipcRenderer.invoke('pos:get-menu-items'),
  getMenuItemById: (/** @type {string} */ id) => ipcRenderer.invoke('pos:get-menu-item-by-id', id),
  createMenuItem: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:create-menu-item', data),
  updateMenuItem: (/** @type {string} */ id, /** @type {unknown} */ data) => ipcRenderer.invoke('pos:update-menu-item', id, data),
  deleteMenuItem: (/** @type {string} */ id) => ipcRenderer.invoke('pos:delete-menu-item', id),
  setBarPackTemplate: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:set-bar-pack-template', data),

  // Orders
  createOrder: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:create-order', data),
  getOrders: (/** @type {unknown} */ filters) => ipcRenderer.invoke('pos:get-orders', filters),
  voidOrder: (/** @type {unknown} */ payload) => ipcRenderer.invoke('pos:void-order', payload),
  partialReturn: (/** @type {unknown} */ payload) => ipcRenderer.invoke('pos:partial-return', payload),

  // Cash-Up
  createCashup: (/** @type {unknown} */ payload) => ipcRenderer.invoke('pos:create-cashup', payload),
  getCashups: (/** @type {unknown} */ filters) => ipcRenderer.invoke('pos:get-cashups', filters),
  getCashupSummary: (/** @type {unknown} */ filters) => ipcRenderer.invoke('pos:get-cashup-summary', filters),

  // Outlets
  getOutlets: () => ipcRenderer.invoke('pos:get-outlets'),

  // Staff
  getStaff: () => ipcRenderer.invoke('pos:get-staff'),
  getApproverCandidates: () => ipcRenderer.invoke('pos:get-approver-candidates'),

  // Inventory
  getInventory: () => ipcRenderer.invoke('pos:get-inventory'),

  // Rooms & Bookings
  getRooms: () => ipcRenderer.invoke('pos:get-rooms'),
  getBookings: () => ipcRenderer.invoke('pos:get-bookings'),
  getEvents: () => ipcRenderer.invoke('pos:get-events'),

  // Tables & Tabs
  getTables: () => ipcRenderer.invoke('pos:get-tables'),
  saveTable: (/** @type {unknown} */ table) => ipcRenderer.invoke('pos:save-table', table),
  getTabs: () => ipcRenderer.invoke('pos:get-tabs'),
  saveTab: (/** @type {unknown} */ tab) => ipcRenderer.invoke('pos:save-tab', tab),
  updateTabStatus: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:update-tab-status', data),
  transferTabWaiter: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:transfer-tab-waiter', data),

  // Prep Tickets
  getTickets: (/** @type {unknown} */ filters) => ipcRenderer.invoke('pos:get-tickets', filters),
  updateTicketStatus: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:update-ticket-status', data),

  // Hardware
  getHardwareSettings: () => ipcRenderer.invoke('pos:get-hardware-settings'),
  saveHardwareSettings: (/** @type {unknown} */ settings) => ipcRenderer.invoke('pos:save-hardware-settings', settings),
  printReceipt: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:print-receipt', data),
  openCashDrawer: (/** @type {unknown} */ settings) => ipcRenderer.invoke('pos:open-cash-drawer', settings),
  testHardware: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:test-hardware', data),
  sendPaymentTerminalTotal: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:send-payment-terminal-total', data),
  getReceiptPrinters: () => ipcRenderer.invoke('pos:get-receipt-printers'),
  getDisplays: () => ipcRenderer.invoke('pos:get-displays'),

  // Customer Display
  openCustomerDisplay: () => ipcRenderer.invoke('pos:open-customer-display'),
  closeCustomerDisplay: () => ipcRenderer.invoke('pos:close-customer-display'),
  updateCustomerDisplay: (/** @type {unknown} */ snapshot) => ipcRenderer.invoke('pos:update-customer-display', snapshot),
  getCustomerDisplay: () => ipcRenderer.invoke('pos:get-customer-display'),

  // Kitchen Display
  openKitchenDisplay: () => ipcRenderer.invoke('pos:open-kitchen-display'),
  closeKitchenDisplay: () => ipcRenderer.invoke('pos:close-kitchen-display'),

  // Shifts
  getShifts: () => ipcRenderer.invoke('pos:get-shifts'),
  openShift: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:open-shift', data),
  closeShift: (/** @type {unknown} */ data) => ipcRenderer.invoke('pos:close-shift', data),

  // Modifier Groups
  getModifierGroups: () => ipcRenderer.invoke('pos:get-modifier-groups'),
  saveModifierGroups: (/** @type {unknown} */ groups) => ipcRenderer.invoke('pos:save-modifier-groups', groups),

  // Promotions
  getPromotions: () => ipcRenderer.invoke('pos:get-promotions'),
  savePromotions: (/** @type {unknown} */ promos) => ipcRenderer.invoke('pos:save-promotions', promos),

  // Floor Layout
  getFloorLayout: () => ipcRenderer.invoke('pos:get-floor-layout'),
  saveFloorLayout: (/** @type {unknown} */ layout) => ipcRenderer.invoke('pos:save-floor-layout', layout),

  // Export
  exportHistory: (/** @type {unknown} */ filters) => ipcRenderer.invoke('pos:export-history', filters),

  // Sync
  getSyncStatus: () => ipcRenderer.invoke('pos:get-sync-status'),
  getSyncQueueDetail: () => ipcRenderer.invoke('pos:get-sync-queue-detail'),
  syncRetry: () => ipcRenderer.invoke('pos:sync-retry'),

  // Settings
  getSettings: () => ipcRenderer.invoke('pos:get-settings'),
  getUserPosAccess: () => ipcRenderer.invoke('pos:get-user-pos-access'),
  getAppVersion: () => ipcRenderer.invoke('pos:get-app-version'),
  getLowResourceConfig: () => ipcRenderer.invoke('pos:get-low-resource-config'),

  // App Updates
  updates: {
    onAvailable: (/** @type {(value: unknown) => void} */ cb) => onIpc('pos:update-available', cb),
    onNotAvailable: (/** @type {(value: unknown) => void} */ cb) => onIpc('pos:update-not-available', cb),
    onProgress: (/** @type {(value: unknown) => void} */ cb) => onIpc('pos:update-progress', cb),
    onReady: (/** @type {(value: unknown) => void} */ cb) => onIpc('pos:update-ready', cb),
    onError: (/** @type {(value: unknown) => void} */ cb) => onIpc('pos:update-error', cb),
    check: () => ipcRenderer.invoke('pos:update-check'),
    download: () => ipcRenderer.invoke('pos:update-download'),
    install: (options) => ipcRenderer.invoke('pos:update-install', options || {}),
    getState: () => ipcRenderer.invoke('pos:update-get-state'),
    getInstallSafety: () => ipcRenderer.invoke('pos:update-get-install-safety')
  },
  mesh: {
    getStatus: () => ipcRenderer.invoke('pos:get-mesh-status'),
    syncNow: () => ipcRenderer.invoke('pos:mesh-sync-now'),
    refreshDiscovery: () => ipcRenderer.invoke('pos:mesh-refresh-discovery'),
    connectManual: (/** @type {string} */ address) => ipcRenderer.invoke('pos:mesh-connect-manual', address)
  },

  // Bootstrap & Window
  bootstrapReferenceData: () => ipcRenderer.invoke('pos:bootstrap-reference-data'),
  getWindowState: () => ipcRenderer.invoke('pos:get-window-state'),
  toggleFullscreen: () => ipcRenderer.invoke('pos:toggle-fullscreen'),
  getInventoryDiagnostics: () => ipcRenderer.invoke('pos:get-inventory-diagnostics')
};

contextBridge.exposeInMainWorld('api', { pos: posAPI, barLocal: posAPI.barLocal });

ipcRenderer.on('display:update', (_event, snapshot) => {
  window.dispatchEvent(new CustomEvent('customer-display-update', { detail: snapshot }));
});
