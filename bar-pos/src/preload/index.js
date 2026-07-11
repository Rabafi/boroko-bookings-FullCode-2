import { contextBridge, ipcRenderer } from 'electron'

const barAPI = {
  // Config
  getConfig: () => ipcRenderer.invoke('bar:get-config'),

  // Auth
  login: (email, password) => ipcRenderer.invoke('bar:login', { email, password }),
  restoreSession: () => ipcRenderer.invoke('bar:restore-session'),
  logout: (userId) => ipcRenderer.invoke('bar:logout', userId),
  getUsers: () => ipcRenderer.invoke('bar:get-users'),
  createUser: (data) => ipcRenderer.invoke('bar:create-user', data),

  // Settings
  getSettings: () => ipcRenderer.invoke('bar:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('bar:save-settings', settings),

  // Menu Items
  getMenuItems: () => ipcRenderer.invoke('bar:get-menu-items'),
  getMenuItemById: (id) => ipcRenderer.invoke('bar:get-menu-item-by-id', id),
  createMenuItem: (data) => ipcRenderer.invoke('bar:create-menu-item', data),
  updateMenuItem: (id, data) => ipcRenderer.invoke('bar:update-menu-item', id, data),
  deleteMenuItem: (id) => ipcRenderer.invoke('bar:delete-menu-item', id),

  // Inventory
  getInventory: () => ipcRenderer.invoke('bar:get-inventory'),
  createInventoryItem: (data) => ipcRenderer.invoke('bar:create-inventory-item', data),
  updateInventoryItem: (id, data) => ipcRenderer.invoke('bar:update-inventory-item', id, data),
  adjustStock: (id, delta, reason) => ipcRenderer.invoke('bar:adjust-stock', { id, delta, reason }),

  // Orders
  createOrder: (data) => ipcRenderer.invoke('bar:create-order', data),
  getOrders: (filters) => ipcRenderer.invoke('bar:get-orders', filters),
  getOrderById: (id) => ipcRenderer.invoke('bar:get-order-by-id', id),
  voidOrder: (id, reason, voidedBy) => ipcRenderer.invoke('bar:void-order', { id, reason, voidedBy }),
  getTodaySales: () => ipcRenderer.invoke('bar:get-today-sales'),

  // Cash Up
  createCashup: (data) => ipcRenderer.invoke('bar:create-cashup', data),
  getCashups: (filters) => ipcRenderer.invoke('bar:get-cashups', filters),
  getLastCashup: (outletId) => ipcRenderer.invoke('bar:get-last-cashup', outletId),

  // Staff / Shifts
  getShifts: () => ipcRenderer.invoke('bar:get-shifts'),
  getActiveShifts: () => ipcRenderer.invoke('bar:get-active-shifts'),
  clockIn: (userId, outletId) => ipcRenderer.invoke('bar:clock-in', { userId, outletId }),
  clockOut: (shiftId) => ipcRenderer.invoke('bar:clock-out', shiftId),

  // Sync / Status
  getIsOnline: () => ipcRenderer.invoke('bar:get-is-online'),
  getDbStats: () => ipcRenderer.invoke('bar:get-db-stats'),
  getSyncQueue: () => ipcRenderer.invoke('bar:get-sync-queue'),
}

contextBridge.exposeInMainWorld('barAPI', barAPI)
