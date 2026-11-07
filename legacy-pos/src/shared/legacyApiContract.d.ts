/**
 * The Legacy preload's concrete contextBridge surface. IPC results remain
 * unknown here because structured cloning does not validate handler data.
 */
export interface LegacyBarOwnerCredentialsExpectedView {
  email: string;
  password: string;
}

export interface LegacyBarLocalApi {
  getStatus(): Promise<unknown>;
  selectCloudWorkspace(): Promise<unknown>;
  pairDevice(request: unknown): Promise<unknown>;
  reconnectServer(request: unknown): Promise<unknown>;
  resumeProvisioning(): Promise<unknown>;
  login(staffId: string | LegacyBarOwnerCredentialsExpectedView, pin?: string): Promise<unknown>;
  logout(): Promise<unknown>;
  startPairing(request: unknown): Promise<unknown>;
  adminStatus(): Promise<unknown>;
  adminBackups(): Promise<unknown>;
  adminRunBackup(request: unknown): Promise<unknown>;
  adminVerifyBackup(request: unknown): Promise<unknown>;
  adminRestoreDrill(request: unknown): Promise<unknown>;
  adminReplicationStatus(): Promise<unknown>;
  adminSetDurability(request: unknown): Promise<unknown>;
  adminSwitchover(request: unknown): Promise<unknown>;
  adminUpdateStatus(): Promise<unknown>;
  adminCloudSyncStatus(): Promise<unknown>;
  adminCloudSyncConfig(request: unknown): Promise<unknown>;
  adminCloudSyncRun(request: unknown): Promise<unknown>;
  query(name: string, filters: unknown): Promise<unknown>;
  events(after: unknown, limit: number): Promise<unknown>;
  requestApproval(command: string, payload: unknown, pin: string, options: unknown): Promise<unknown>;
  command(command: string, payload: unknown, options: unknown): Promise<unknown>;
  retry(operationId: string): Promise<unknown>;
  getOpenIntents(): Promise<unknown>;
  getOperation(operationId: string): Promise<unknown>;
  resolveOperation(operationId: string): Promise<unknown>;
  refreshReadiness(): Promise<unknown>;
  printReceipt(saleId: string): Promise<unknown>;
}

export interface LegacyUpdateEventsApi {
  onAvailable(callback: (value: unknown) => void): () => unknown;
  onNotAvailable(callback: (value: unknown) => void): () => unknown;
  onProgress(callback: (value: unknown) => void): () => unknown;
  onReady(callback: (value: unknown) => void): () => unknown;
  onError(callback: (value: unknown) => void): () => unknown;
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  install(options?: unknown): Promise<unknown>;
  getState(): Promise<unknown>;
  getInstallSafety(): Promise<unknown>;
}

export interface LegacyMeshApi {
  getStatus(): Promise<unknown>;
  syncNow(): Promise<unknown>;
  refreshDiscovery(): Promise<unknown>;
  connectManual(address: string): Promise<unknown>;
}

export interface LegacyPosApi {
  login(email: string, password: string, lodgeId?: string | null): Promise<unknown>;
  restoreSession(credentials: unknown): Promise<unknown>;
  hasTrustedSession(email: string): Promise<unknown>;
  logout(): Promise<unknown>;
  getConfig(): Promise<unknown>;
  saveConfig(data: unknown): Promise<unknown>;
  barLocal: LegacyBarLocalApi;
  goOnline(): Promise<unknown>;
  goOffline(): Promise<unknown>;
  getIsOnline(): Promise<unknown>;
  getMenuItems(): Promise<unknown>;
  getMenuItemById(id: string): Promise<unknown>;
  createMenuItem(data: unknown): Promise<unknown>;
  updateMenuItem(id: string, data: unknown): Promise<unknown>;
  deleteMenuItem(id: string): Promise<unknown>;
  setBarPackTemplate(data: unknown): Promise<unknown>;
  createOrder(data: unknown): Promise<unknown>;
  getOrders(filters: unknown): Promise<unknown>;
  voidOrder(payload: unknown): Promise<unknown>;
  partialReturn(payload: unknown): Promise<unknown>;
  createCashup(payload: unknown): Promise<unknown>;
  getCashups(filters: unknown): Promise<unknown>;
  getCashupSummary(filters: unknown): Promise<unknown>;
  getOutlets(): Promise<unknown>;
  getStaff(): Promise<unknown>;
  getApproverCandidates(): Promise<unknown>;
  getInventory(): Promise<unknown>;
  getRooms(): Promise<unknown>;
  getBookings(): Promise<unknown>;
  getEvents(): Promise<unknown>;
  getTables(): Promise<unknown>;
  saveTable(table: unknown): Promise<unknown>;
  getTabs(): Promise<unknown>;
  saveTab(tab: unknown): Promise<unknown>;
  updateTabStatus(data: unknown): Promise<unknown>;
  transferTabWaiter(data: unknown): Promise<unknown>;
  getTickets(filters: unknown): Promise<unknown>;
  updateTicketStatus(data: unknown): Promise<unknown>;
  getHardwareSettings(): Promise<unknown>;
  saveHardwareSettings(settings: unknown): Promise<unknown>;
  printReceipt(data: unknown): Promise<unknown>;
  openCashDrawer(settings: unknown): Promise<unknown>;
  testHardware(data: unknown): Promise<unknown>;
  sendPaymentTerminalTotal(data: unknown): Promise<unknown>;
  getReceiptPrinters(): Promise<unknown>;
  getDisplays(): Promise<unknown>;
  openCustomerDisplay(): Promise<unknown>;
  closeCustomerDisplay(): Promise<unknown>;
  updateCustomerDisplay(snapshot: unknown): Promise<unknown>;
  getCustomerDisplay(): Promise<unknown>;
  openKitchenDisplay(): Promise<unknown>;
  closeKitchenDisplay(): Promise<unknown>;
  getShifts(): Promise<unknown>;
  openShift(data: unknown): Promise<unknown>;
  closeShift(data: unknown): Promise<unknown>;
  getModifierGroups(): Promise<unknown>;
  saveModifierGroups(groups: unknown): Promise<unknown>;
  getPromotions(): Promise<unknown>;
  savePromotions(promos: unknown): Promise<unknown>;
  getFloorLayout(): Promise<unknown>;
  saveFloorLayout(layout: unknown): Promise<unknown>;
  exportHistory(filters: unknown): Promise<unknown>;
  getSyncStatus(): Promise<unknown>;
  getSyncQueueDetail(): Promise<unknown>;
  syncRetry(): Promise<unknown>;
  getSettings(): Promise<unknown>;
  getUserPosAccess(): Promise<unknown>;
  getAppVersion(): Promise<unknown>;
  getLowResourceConfig(): Promise<unknown>;
  updates: LegacyUpdateEventsApi;
  mesh: LegacyMeshApi;
  bootstrapReferenceData(): Promise<unknown>;
  getWindowState(): Promise<unknown>;
  toggleFullscreen(): Promise<unknown>;
  getInventoryDiagnostics(): Promise<unknown>;
}

export interface LegacyWindowApi {
  pos: LegacyPosApi;
  barLocal: LegacyBarLocalApi;
}

declare global {
  interface Window {
    api: LegacyWindowApi;
  }
}
