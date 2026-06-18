import { contextBridge, ipcRenderer } from 'electron';

const onIpc = (channel, cb) => {
  const listener = (_event, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

const posAPI = {
  // Auth
  login: (email, password) => ipcRenderer.invoke('pos:auth-login', { email, password }),
  restoreSession: (credentials) => ipcRenderer.invoke('pos:auth-restore', credentials),
  hasTrustedSession: (email) => ipcRenderer.invoke('pos:auth-has-trusted-session', email),
  logout: () => ipcRenderer.invoke('pos:auth-logout'),
  getConfig: () => ipcRenderer.invoke('pos:config'),
  saveConfig: (data) => ipcRenderer.invoke('pos:save-config', data),

  // Connection
  goOnline: () => ipcRenderer.invoke('pos:go-online'),
  goOffline: () => ipcRenderer.invoke('pos:go-offline'),
  getIsOnline: () => ipcRenderer.invoke('pos:get-is-online'),

  // Menu Items
  getMenuItems: () => ipcRenderer.invoke('pos:get-menu-items'),
  getMenuItemById: (id) => ipcRenderer.invoke('pos:get-menu-item-by-id', id),
  createMenuItem: (data) => ipcRenderer.invoke('pos:create-menu-item', data),
  updateMenuItem: (id, data) => ipcRenderer.invoke('pos:update-menu-item', id, data),
  deleteMenuItem: (id) => ipcRenderer.invoke('pos:delete-menu-item', id),
  setBarPackTemplate: (data) => ipcRenderer.invoke('pos:set-bar-pack-template', data),

  // Orders
  createOrder: (data) => ipcRenderer.invoke('pos:create-order', data),
  getOrders: (filters) => ipcRenderer.invoke('pos:get-orders', filters),
  voidOrder: (payload) => ipcRenderer.invoke('pos:void-order', payload),
  partialReturn: (payload) => ipcRenderer.invoke('pos:partial-return', payload),

  // Cash-Up
  createCashup: (payload) => ipcRenderer.invoke('pos:create-cashup', payload),
  getCashups: (filters) => ipcRenderer.invoke('pos:get-cashups', filters),
  getCashupSummary: (filters) => ipcRenderer.invoke('pos:get-cashup-summary', filters),

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

  // Tables & Tabs
  getTables: () => ipcRenderer.invoke('pos:get-tables'),
  saveTable: (table) => ipcRenderer.invoke('pos:save-table', table),
  getTabs: () => ipcRenderer.invoke('pos:get-tabs'),
  saveTab: (tab) => ipcRenderer.invoke('pos:save-tab', tab),
  updateTabStatus: (data) => ipcRenderer.invoke('pos:update-tab-status', data),

  // Prep Tickets
  getTickets: (filters) => ipcRenderer.invoke('pos:get-tickets', filters),
  updateTicketStatus: (data) => ipcRenderer.invoke('pos:update-ticket-status', data),

  // Hardware
  getHardwareSettings: () => ipcRenderer.invoke('pos:get-hardware-settings'),
  saveHardwareSettings: (settings) => ipcRenderer.invoke('pos:save-hardware-settings', settings),
  printReceipt: (data) => ipcRenderer.invoke('pos:print-receipt', data),
  openCashDrawer: (settings) => ipcRenderer.invoke('pos:open-cash-drawer', settings),
  testHardware: (data) => ipcRenderer.invoke('pos:test-hardware', data),
  sendPaymentTerminalTotal: (data) => ipcRenderer.invoke('pos:send-payment-terminal-total', data),
  getReceiptPrinters: () => ipcRenderer.invoke('pos:get-receipt-printers'),
  getDisplays: () => ipcRenderer.invoke('pos:get-displays'),

  // Customer Display
  openCustomerDisplay: () => ipcRenderer.invoke('pos:open-customer-display'),
  closeCustomerDisplay: () => ipcRenderer.invoke('pos:close-customer-display'),
  updateCustomerDisplay: (snapshot) => ipcRenderer.invoke('pos:update-customer-display', snapshot),
  getCustomerDisplay: () => ipcRenderer.invoke('pos:get-customer-display'),

  // Kitchen Display
  openKitchenDisplay: () => ipcRenderer.invoke('pos:open-kitchen-display'),
  closeKitchenDisplay: () => ipcRenderer.invoke('pos:close-kitchen-display'),

  // Shifts
  getShifts: () => ipcRenderer.invoke('pos:get-shifts'),
  openShift: (data) => ipcRenderer.invoke('pos:open-shift', data),
  closeShift: (data) => ipcRenderer.invoke('pos:close-shift', data),

  // Modifier Groups
  getModifierGroups: () => ipcRenderer.invoke('pos:get-modifier-groups'),
  saveModifierGroups: (groups) => ipcRenderer.invoke('pos:save-modifier-groups', groups),

  // Promotions
  getPromotions: () => ipcRenderer.invoke('pos:get-promotions'),
  savePromotions: (promos) => ipcRenderer.invoke('pos:save-promotions', promos),

  // Floor Layout
  getFloorLayout: () => ipcRenderer.invoke('pos:get-floor-layout'),
  saveFloorLayout: (layout) => ipcRenderer.invoke('pos:save-floor-layout', layout),

  // Export
  exportHistory: (filters) => ipcRenderer.invoke('pos:export-history', filters),

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
    onAvailable: (cb) => onIpc('pos:update-available', cb),
    onNotAvailable: (cb) => onIpc('pos:update-not-available', cb),
    onProgress: (cb) => onIpc('pos:update-progress', cb),
    onReady: (cb) => onIpc('pos:update-ready', cb),
    onError: (cb) => onIpc('pos:update-error', cb),
    check: () => ipcRenderer.invoke('pos:update-check'),
    download: () => ipcRenderer.invoke('pos:update-download'),
    install: (options) => ipcRenderer.invoke('pos:update-install', options || {}),
    getState: () => ipcRenderer.invoke('pos:update-get-state'),
    getInstallSafety: () => ipcRenderer.invoke('pos:update-get-install-safety')
  },

  // Bootstrap & Window
  bootstrapReferenceData: () => ipcRenderer.invoke('pos:bootstrap-reference-data'),
  getWindowState: () => ipcRenderer.invoke('pos:get-window-state'),
  toggleFullscreen: () => ipcRenderer.invoke('pos:toggle-fullscreen'),
  getInventoryDiagnostics: () => ipcRenderer.invoke('pos:get-inventory-diagnostics')
};

contextBridge.exposeInMainWorld('api', { pos: posAPI });

ipcRenderer.on('display:update', (_event, snapshot) => {
  window.dispatchEvent(new CustomEvent('customer-display-update', { detail: snapshot }));
});
