/** Renderer-facing shape of the literal API exposed by src/preload/index.js.
 * IPC and cache results stay unknown until the receiving consumer validates or narrows them.
 * Argument scalar types follow the preload formal parameter and live caller usage; object payloads stay unknown.
 */
import type { AdminExportApi } from './admin-export.js';
import type {
  DesktopIpcResult,
  ShellOpenExternalResult,
} from '../../../shared/desktopIpcContracts.js';
import type { BarcodeScannerVerificationResult, PosHardwareSettingsResult, SyncDetailsResult, SyncStatusSnapshot } from '../../../shared/desktopIpcContracts.js';
export type {
  AdminNotificationsCleanupResult,
  AdminNotificationsReadResult,
  AuthLoginResult,
  AuthLogoutResult,
  UnavailablePosRead,
  InventoryItemsReadStatus,
  ProductInfo,
  ShellOpenExternalResult,
  FullSyncStatusSnapshot,
  SyncGroupedCounts,
  SyncStatusSnapshot,
  SyncDetailsSnapshot,
  SyncDetailsResult,
  PosHardwareSettings,
  PosHardwareSettingsResult,
  BarcodeScannerVerificationResult,
} from '../../../shared/desktopIpcContracts.js';

export type IpcFailure = { success: false; error: unknown; code?: unknown };

/**
 * Expected SQL projection for `get_admin_notifications`; the IPC/RPC result
 * remains unknown until the renderer validates it.
 */
export type AdminNotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  lodge_id: string | null;
  lodge_name: string | null;
  action_url: string | null;
  actor_email: string | null;
  read_at: string | null;
  created_at: string;
};

export type BookingPaymentResult =
  | { success: true; offline: true; queued?: true }
  | (Record<string, unknown> & { success: unknown; offline: unknown })
  | IpcFailure;

export type BookingRefundResult =
  | {
      success: true;
      offline: true;
      pending_approval: true;
      booking_id: unknown;
      request_id: string;
      request: unknown;
      refund_amount: number;
      retained_amount: number;
      retained_percent: number;
      method: string;
      proof_reference: string;
      notes: string;
    }
  | {
      success: true;
      booking_id: unknown;
      refund_amount: number;
      retained_amount: number;
      retained_percent: number;
      approved_by: unknown;
      approved_by_name: unknown;
      credit_transfer: boolean;
      credit_entry_id: unknown;
      credit_balance: unknown;
    }
  | IpcFailure;
export type InventoryAdjustmentResult =
  | { success: true; offline: true; new_stock: number }
  | { success: true; new_stock: unknown }
  | IpcFailure;

/** Main returns the provisional offline envelope unchanged; online RPC fields remain unvalidated. */
export type PosCreateOrderResult =
  | { success: true; id: string; offline: true; provisional: true; receipt_number: string; order: Record<string, unknown>; tab_close_warning?: unknown }
  | (Record<string, unknown> & { success: unknown })
  | IpcFailure;

export type SyncRetryResult =
  | { success: true; retried: number; remaining: number }
  | IpcFailure;

export type SyncClearFailedResult =
  | { success: true; removed: number; financialCleared: number; integrityAlertsRecorded: number; remaining: number }
  | IpcFailure;

export interface IpcMetadataRowsEnvelope {
  __rowsTransport: true;
  rows: unknown[];
  _source?: unknown;
  _complete?: unknown;
  _tender_complete?: unknown;
  _item_detail_complete?: unknown;
  _available?: unknown;
}

export type IpcMetadataRows = unknown[] | IpcMetadataRowsEnvelope;

/** Inventory history metadata comes from the handler's object envelope; row payloads remain unvalidated. */
export interface InventoryMovementsReadStatus {
  rows: unknown[];
  source: unknown;
  complete: boolean;
}

/** Expected output columns of get_bar_stock_aging; the main handler checks only the array envelope, not row values. */
export interface BarStockAgingRow {
  item_id: string;
  item_name: string;
  category: string;
  unit: string;
  outlet_id: string | null;
  current_stock: number;
  reorder_level: number;
  latest_unit_cost: number;
  last_received_at: string | null;
  last_sold_at: string | null;
  days_since_receipt: number | null;
  days_since_sale: number | null;
  age_bucket: string;
}

/** Positional tuples follow the 102 actual DB functions in main's allowlisted accounting operation registry. */
export type RestaurantAccountingArguments = {
  getAccounts: [];
  exportChart: [filters?: unknown];
  createAccount: [data: unknown];
  updateAccount: [id: string, data: unknown];
  setCashFlow: [id: string, classification: unknown];
  deleteAccount: [id: string];
  seedAccounts: [];
  postOpeningBalance: [data: unknown];
  getLedger: [filters?: unknown];
  getLedgerPage: [filters?: unknown];
  exportLedger: [filters?: unknown];
  exportLedgerReport: [filters?: unknown];
  createJournal: [data: unknown];
  createManualJournalDraft: [data: unknown];
  createAndSubmitManualJournal: [data: unknown];
  getManualJournalSubmissionStatus: [operationId: string];
  submitLegacyJournal: [id: string];
  submitManualJournal: [id: string];
  approveManualJournal: [id: string];
  postManualJournal: [id: string];
  reverseJournal: [data: unknown];
  getPosMappings: [];
  setPosMapping: [data: unknown];
  setEffectivePosMapping: [data: unknown];
  postPosOrder: [orderId: string];
  getAp: [];
  exportAp: [filters?: unknown];
  getApSupplierStatement: [supplierName: string, startDate?: string, endDate?: string];
  setApSettings: [data: unknown];
  createBill: [data: unknown];
  submitBill: [billId: string];
  approveBill: [billId: string, operationKey: string];
  payBill: [data: unknown];
  createCreditNote: [data: unknown];
  submitCreditNote: [creditNoteId: string];
  approveCreditNote: [creditNoteId: string, operationKey: string];
  saveBankAccount: [data: unknown];
  getBank: [bankAccountId?: string];
  exportBank: [filters?: unknown];
  importBank: [data: unknown];
  getBankCandidates: [bankTransactionId: string];
  proposeBankAllocation: [data: unknown];
  reviewBankAllocation: [allocationId: string, approve: unknown, reason?: string];
  exceptBank: [transactionId: string, reason: string];
  createReconciliation: [data: unknown];
  completeReconciliation: [id: string, notes: unknown];
  getBankPacket: [id: string];
  matchSettlementToBank: [data: unknown];
  getTax: [];
  getTaxAdjustments: [];
  exportTax: [filters?: unknown];
  setTaxConfig: [data: unknown];
  generateTax: [data: unknown];
  createTaxAmendment: [data: unknown];
  generateTaxAmendment: [data: unknown];
  recordTaxAdjustment: [data: unknown];
  approveTaxAdjustment: [adjustmentId: string];
  reviewTax: [id: string];
  approveTax: [id: string];
  fileTax: [id: string, reference: string, notes: unknown];
  getTaxPacket: [id: string];
  getBudgets: [year: number];
  exportBudgets: [year: number, filters?: unknown];
  saveBudgets: [year: number, entries: unknown, operationKey: string];
  approveBudgetVersion: [versionId: string];
  createBudgetTemplate: [data: unknown];
  applyBudgetTemplate: [data: unknown];
  getStatements: [startDate: string, endDate: string];
  exportStatements: [startDate: string, endDate: string, filters?: unknown];
  getPayroll: [];
  exportPayrollRegister: [periodId: string, filters?: unknown];
  getPayrollRecords: [periodId: string];
  getPayrollReadiness: [periodId: string];
  setPayrollTerms: [data: unknown];
  setPayrollConfig: [data: unknown];
  createPayPeriod: [data: unknown];
  setPayrollTime: [data: unknown];
  approvePayrollTime: [id: string];
  calculatePayroll: [id: string];
  approvePayroll: [id: string, operationKey: string];
  exportPayroll: [id: string, operationKey: string, debitAccountId: string, reason?: string];
  setPayrollGl: [data: unknown];
  postPayroll: [id: string];
  settlePayroll: [id: string, operationKey: string, settlementDate: string, reference: string];
  reconcilePayrollSettlement: [id: string, operationKey: string, bankReference: unknown];
  closePayroll: [id: string, operationKey: string];
  setPayrollAttendanceDisposition: [data: unknown];
  getPayrollAttendanceReconciliation: [periodId: string];
  getReadiness: [];
  getActivationState: [];
  prepareHistoricalCutover: [data: unknown];
  approveCutover: [data: unknown];
  getCutoverBatches: [limit?: number];
  getCutoverBatch: [batchId: string];
  applyCutover: [batchId: string];
  activateAccounting: [data: unknown];
  suspendAccounting: [reason: string];
  getSourceCoverage: [startDate: string, endDate: string];
  getPeriodClose: [periodStart: unknown, periodEnd: unknown];
  preparePeriodClose: [data: unknown];
  approvePeriodClose: [periodCloseId: string];
  reopenPeriodClose: [periodCloseId: string, reason: string];
};

/**
 * Expected renderer read views of the desktop auto-updater producer in
 * `src/main/index.js` (`updateState`, `setUpdateState`, and update IPC). The
 * preload forwards these values unchanged; these declarations do not add
 * runtime validation.
 */
export type DesktopUpdateProgressReadView = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type DesktopUpdateStateReadView = {
  phase: 'idle' | 'checking' | 'available' | 'uptodate' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  version: string | null;
  releaseName: string;
  releaseDate: string;
  releaseNotes: string;
  progress: DesktopUpdateProgressReadView | null;
  error: string;
};

export type DesktopUpdateProgressEventReadView = DesktopUpdateStateReadView & DesktopUpdateProgressReadView;
export type DesktopUpdateErrorEventReadView = DesktopUpdateStateReadView & { message: string };

export type DesktopUpdateCheckReadResult =
  | { success: true; updateAvailable: false; dev: true }
  | {
      success: true;
      updateAvailable: string | boolean;
      dev?: undefined;
      latestVersion: string;
      releaseName: string;
      releaseDate: string;
      releaseNotes: string;
      state: DesktopUpdateStateReadView;
    }
  | {
      success: true;
      updateAvailable: undefined;
      dev?: undefined;
      latestVersion: undefined;
      releaseName: '';
      releaseDate: '';
      releaseNotes: '';
      state: DesktopUpdateStateReadView;
    }
  | { success: true; updateAvailable: false; dev?: undefined; gated: true; state: DesktopUpdateStateReadView }
  | { success: false; dev?: undefined; error: unknown };

export type DesktopUpdateDownloadReadResult =
  | { success: true; dev: true }
  | { success: true }
  | { success: false; error: unknown };

export interface DesktopApi {
  auth: {
    login(email: string, password: string, selectedLodgeId?: string | null): Promise<DesktopIpcResult<'auth:login'>>;
    getStatus(email: string): Promise<unknown>;
    healthCheck(email: string): Promise<unknown>;
    sendPasswordReset(email: string): Promise<unknown>;
    restoreSession(nonce: string): Promise<unknown>;
    restoreCurrentSession(): Promise<unknown>;
    restoreSavedSession(email: string, password: string): Promise<unknown>;
    validateSession(): Promise<unknown>;
    logout(): Promise<DesktopIpcResult<'auth:logout'>>;
  };
  profiles: {
    list(): Promise<unknown>;
    getActive(): Promise<unknown>;
    select(lodgeId: string): Promise<unknown>;
    createDraft(): Promise<unknown>;
    removeDraft(lodgeId: string): Promise<unknown>;
  };
  setup: {
    initializeCompany(payload: unknown): Promise<unknown>;
  };
  users: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    changeOwnPin(data: unknown): Promise<unknown>;
    getAccessAudit(): Promise<unknown>;
    resetPassword(id: string, password: string): Promise<unknown>;
    sendInvite(id: string): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  staffScheduling: {
    getSchedule(date: string): Promise<unknown>;
    getScheduleRange(startDate: string, endDate: string): Promise<unknown>;
    upsertSchedule(staffId: string, scheduleDate: string, shiftLabel: unknown, startTime: string, endTime: string, roleAtShift: unknown, notes: unknown): Promise<unknown>;
    deleteEntry(id: string): Promise<unknown>;
    getAttendanceToday(): Promise<unknown>;
    getAttendanceRange(startDate: string, endDate: string, staffId: string): Promise<unknown>;
    getAttendanceDashboard(): Promise<unknown>;
    clockIn(staffId: string, shiftLabel: unknown, notes: unknown): Promise<unknown>;
    clockOut(attendanceId: string, notes: unknown): Promise<unknown>;
    getLeaveRequests(status: string, staffId: string): Promise<unknown>;
    requestLeave(staffId: string, leaveType: unknown, startDate: string, endDate: string, reason: string): Promise<unknown>;
    approveLeave(id: string, status: string, rejectionReason: string): Promise<unknown>;
  };
  staffOperations: {
    getStaffDepartments(): Promise<unknown>;
    createStaffDepartment(name: string, description: unknown, color: unknown): Promise<unknown>;
    updateStaffDepartment(id: string, payload: unknown): Promise<unknown>;
    deleteStaffDepartment(id: string): Promise<unknown>;
    getShiftTemplates(departmentId: string): Promise<unknown>;
    createShiftTemplate(payload: unknown): Promise<unknown>;
    updateShiftTemplate(id: string, payload: unknown): Promise<unknown>;
    deleteShiftTemplate(id: string): Promise<unknown>;
    getTaskCategories(): Promise<unknown>;
    createTaskCategory(name: string, color: unknown): Promise<unknown>;
    getTaskAssignments(staffId: string, status: string, date: string): Promise<unknown>;
    createTaskAssignment(payload: unknown): Promise<unknown>;
    updateTaskAssignment(id: string, payload: unknown): Promise<unknown>;
    completeTaskAssignment(id: string, notes: unknown): Promise<unknown>;
    getTrainingChecklists(departmentId: string): Promise<unknown>;
    createTrainingChecklist(payload: unknown): Promise<unknown>;
    recordTrainingCompletion(staffId: string, checklistId: string, notes: unknown): Promise<unknown>;
    getTrainingRecords(staffId: string): Promise<unknown>;
    createShiftHandover(payload: unknown): Promise<unknown>;
    getShiftHandovers(date: string): Promise<unknown>;
    getStaffProductivityDashboard(startDate: string, endDate: string): Promise<unknown>;
    publishWeeklySchedule(weekStart: unknown): Promise<unknown>;
    getScheduleConflicts(weekStart: unknown): Promise<unknown>;
  };
  rooms: {
    getAll(): Promise<unknown>;
    getCached(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    updateHousekeeping(id: string, status: string, notes: unknown): Promise<unknown>;
  };
  customers: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    updateBlacklist(id: string, is_blacklisted: unknown, reason: string): Promise<unknown>;
    getBookings(id: string): Promise<unknown>;
    updateIdPhoto(id: string, photo: unknown): Promise<unknown>;
  };
  charges: {
    getByBooking(bookingId: string): Promise<unknown>;
    add(bookingId: string, data: unknown): Promise<unknown>;
    delete(id: string, reason: string): Promise<unknown>;
  };
  rateOverrides: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    getApplicable(roomId: string, checkIn: unknown, checkOut: unknown): Promise<unknown>;
  };
  expenses: {
    getAll(start: unknown, end: unknown, outletId: string): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string, operationId: string): Promise<unknown>;
    submit(id: string, payload: unknown, operationId: string): Promise<unknown>;
    approve(id: string, payload: unknown, operationId: string): Promise<unknown>;
    post(id: string, payload: unknown, operationId: string): Promise<unknown>;
    pay(id: string, payload: unknown, operationId: string): Promise<unknown>;
    void(id: string, payload: unknown, operationId: string): Promise<unknown>;
    reverse(id: string, payload: unknown, operationId: string): Promise<unknown>;
  };
  maintenance: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    resolve(id: string, roomId: string): Promise<unknown>;
  };
  receipts: {
    savePDF(payload: unknown): Promise<unknown>;
    listPrinters(): Promise<unknown>;
    printCurrent(options: unknown): Promise<unknown>;
  };
  quotations: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    convert(quotationId: string, depositAmount: unknown, method: string): Promise<unknown>;
    savePDF(quotationId: string, quotationNumber: unknown, customerName: string): Promise<unknown>;
    duplicate(id: string): Promise<unknown>;
  };
  bookings: {
    getAll(): Promise<unknown>;
    getCachedByDateRange(start: unknown, end: unknown): Promise<unknown>;
    getByDateRange(start: unknown, end: unknown): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    createMultiRoom(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    updateStatus(id: string, status: string): Promise<unknown>;
    updatePayment(id: string, amount: number, method: string, intentKey: string): Promise<unknown>;
    updateGroupPayment(groupId: string, amount: number, method: string, intentKey: string): Promise<unknown>;
    getPayments(bookingId: string): Promise<unknown>;
    refundGroup(groupId: string, payload: unknown): Promise<unknown>;
    refund(bookingId: string, payload: unknown): Promise<unknown>;
    createEvent(data: unknown): Promise<unknown>;
    getPendingOnline(): Promise<unknown>;
    reschedule(bookingId: string, data: unknown): Promise<unknown>;
  };
  customerCredit: {
    getBalance(customerId: string): Promise<unknown>;
    getHistory(customerId: string, limit: number, offset: number): Promise<unknown>;
    getSummary(search: string, limit: number, offset: number): Promise<unknown>;
    record(data: unknown): Promise<unknown>;
    applyToBooking(data: unknown): Promise<unknown>;
    refund(data: unknown): Promise<unknown>;
    reverse(data: unknown): Promise<unknown>;
  };
  prepayments: {
    getPortfolio(asOf: unknown): Promise<unknown>;
    getAging(asOf: unknown): Promise<unknown>;
    getReconciliation(startAt: string, endAt: string): Promise<unknown>;
    getMatchingSuggestions(limit: number): Promise<unknown>;
    getConfig(): Promise<unknown>;
    setConfig(payload: unknown): Promise<unknown>;
    export(startAt: string, endAt: string): Promise<unknown>;
  };
  invoices: {
    getBookingInvoices(): Promise<unknown>;
    sendBookingInvoiceEmail(invoice: unknown): Promise<unknown>;
    recordDelivery(payload: unknown): Promise<unknown>;
  };
  reports: {
    basicSummary(rangeDays?: unknown): Promise<unknown>;
    basicSavePDF(payload: unknown): Promise<unknown>;
    basicPrint(payload: unknown): Promise<unknown>;
    occupancy(start: unknown, end: unknown): Promise<unknown>;
    revenue(start: unknown, end: unknown): Promise<unknown>;
    snapshot(today: unknown): Promise<unknown>;
    invoiceDeliveryHistory(payload: unknown): Promise<unknown>;
    financialAudit(payload: unknown): Promise<unknown>;
    financialReconciliation(): Promise<unknown>;
    financialValidation(): Promise<unknown>;
    financialValidationRuns(limit: number): Promise<unknown>;
    financialValidationAlerts(limit: number): Promise<unknown>;
    criticalErrors(limit: number): Promise<unknown>;
    clearCriticalErrors(): Promise<unknown>;
    saveSupportBundle(limit: number): Promise<unknown>;
    getSupportBundle(limit: number): Promise<unknown>;
    runFinancialValidation(): Promise<unknown>;
    retryFinancialValidationRun(runId: string): Promise<unknown>;
    savePDF(payload: unknown): Promise<unknown>;
    printCurrent(): Promise<unknown>;
    saveExcel(data: unknown): Promise<unknown>;
    exportDetailedExcel(payload: unknown): Promise<unknown>;
    exportDetailedPDF(payload: unknown): Promise<unknown>;
    posSales(start: unknown, end: unknown, outletId: string): Promise<unknown>;
    inventorySpend(start: unknown, end: unknown, outletId: string): Promise<unknown>;
    supplySpend(start: unknown, end: unknown): Promise<unknown>;
    nightAudit(date: string): Promise<unknown>;
    saveNightAuditExcel(payload: unknown): Promise<unknown>;
    profitLoss(start: unknown, end: unknown): Promise<unknown>;
    maintenanceRows(start: unknown, end: unknown): Promise<unknown>;
    outletProfitLoss(start: unknown, end: unknown): Promise<unknown>;
    roomProfitability(start: unknown, end: unknown): Promise<unknown>;
    exportOfflineSafetyManifest(): Promise<unknown>;
  };
  dashboard: {
    stats(): Promise<unknown>;
    forecast(days: number): Promise<unknown>;
    bookingPaymentsToday(): Promise<unknown>;
  };
  fnb: {
    getModulePreferences(): Promise<unknown>;
    getCachedModulePreferences(): Promise<unknown>;
    setModulePreference(moduleKey: string, enabled: boolean, expectedVersion: unknown): Promise<unknown>;
    getToday(outletId: string | null): Promise<unknown>;
    getConsolidatedReport(start: unknown, end: unknown, outletId: string): Promise<unknown>;
    createRoomServiceOrder(payload: unknown, operationId: string): Promise<unknown>;
    updateRoomServiceStatus(orderId: string, toStatus: string, payload: unknown, operationId: string): Promise<unknown>;
    getRoomServiceQueue(outletId: string, includeClosed: unknown): Promise<unknown>;
    createMealEntitlement(payload: unknown, operationId: string): Promise<unknown>;
    redeemMeal(entitlementId: string, payload: unknown, operationId: string): Promise<unknown>;
    getMealEntitlements(includeDepleted: unknown): Promise<unknown>;
    createTemperatureLog(payload: unknown, operationId: string): Promise<unknown>;
    closeCorrectiveAction(actionId: string, closeNote: unknown, operationId: string): Promise<unknown>;
    getFoodSafetyTemplates(): Promise<unknown>;
    getCorrectiveQueue(includeClosed: unknown): Promise<unknown>;
    createFoodSafetyTemplate(payload: unknown, operationId: string): Promise<unknown>;
    captureSupplierInvoice(payload: unknown, operationId: string): Promise<unknown>;
    approveInvoiceMatch(invoiceId: string, approve: unknown, note: unknown, operationId: string): Promise<unknown>;
    handoffInvoiceToAccounting(invoiceId: string, operationId: string): Promise<unknown>;
    getSupplierInvoices(): Promise<unknown>;
    getDemandRecommendations(date: string, outletId: string): Promise<unknown>;
    approveDemandRecommendation(recommendationKey: string, action: string, payload: unknown, operationId: string): Promise<unknown>;
  };
  requests: {
    getAll(limit: number): Promise<unknown>;
    update(id: string, updates: unknown): Promise<unknown>;
    markRead(id: string, audience: unknown, messageId: string): Promise<unknown>;
    addMessage(id: string, payload: unknown): Promise<unknown>;
  };
  notifications: {
    today(): Promise<unknown>;
    upcoming(): Promise<unknown>;
  };
  shell: {
    openExternal(url: string): Promise<ShellOpenExternalResult>;
  };
  barGuides: {
    getManifest(): Promise<unknown>;
    open(documentId: string): Promise<unknown>;
    save(documentId: string): Promise<unknown>;
  };
  window: {
    repairInputFocus(reason: string): Promise<unknown>;
    onFocusRecovery(cb: (value: unknown) => unknown): () => unknown;
  };
  app: {
    getVersion(): Promise<DesktopIpcResult<'app:getVersion'>>;
    getProduct(): Promise<DesktopIpcResult<'app:getProduct'>>;
    notify(payload: unknown): Promise<unknown>;
    logRendererError(payload: unknown): Promise<unknown>;
    getRendererErrors(limit: number): Promise<unknown>;
    clearRendererErrors(): Promise<unknown>;
    setTestOfflineMode(forceOffline: unknown): Promise<unknown>;
    showTouchKeyboard(): Promise<unknown>;
  };
  activity: {
    getAll(): Promise<unknown>;
    clear(): Promise<unknown>;
  };
  backup: {
    getInfo(): Promise<unknown>;
    starterExport(options: unknown): Promise<unknown>;
    starterHistory(): Promise<unknown>;
    starterVerify(options: unknown): Promise<unknown>;
    starterOpenFolder(options: unknown): Promise<unknown>;
    starterCopy(options: unknown): Promise<unknown>;
    starterRestoreRehearsal(options: unknown): Promise<unknown>;
    recoveryBegin(payload: unknown): Promise<unknown>;
    recoveryChoosePackage(): Promise<unknown>;
    recoveryStage(payload: unknown): Promise<unknown>;
    recoverySeal(payload: unknown): Promise<unknown>;
    recoveryPreview(operationId: string): Promise<unknown>;
    recoveryApprove(payload: unknown): Promise<unknown>;
    recoveryExecute(payload: unknown): Promise<unknown>;
    recoveryDiscard(operationId: string): Promise<unknown>;
    recoveryGet(operationId: string): Promise<unknown>;
    recoveryList(): Promise<unknown>;
    recoveryVerify(operationId: string): Promise<unknown>;
    automationStatus(): Promise<unknown>;
    automationConfigure(payload: unknown): Promise<unknown>;
    automationDisable(): Promise<unknown>;
    automationSnooze(): Promise<unknown>;
    automationClearSnooze(): Promise<unknown>;
    automationRunNow(payload: unknown): Promise<unknown>;
    chooseStarterAutomationFolder(): Promise<unknown>;
    chooseTargetFolder(): Promise<unknown>;
    savePolicy(updates: unknown): Promise<unknown>;
    runManagedNow(): Promise<unknown>;
    createManual(): Promise<unknown>;
    verify(name: string): Promise<unknown>;
    previewRestore(name: string): Promise<unknown>;
    createRestoreRehearsal(name: string): Promise<unknown>;
    openFolder(): Promise<unknown>;
    openManagedFolder(): Promise<unknown>;
  };
  settings: {
    get(): Promise<unknown>;
    getOutletContext(): Promise<unknown>;
    save(data: unknown): Promise<unknown>;
    updateOperatingProfile(profile: unknown): Promise<unknown>;
    previewPropertyTypeChange(targetType: unknown): Promise<unknown>;
    commitPropertyTypeChange(payload: unknown): Promise<unknown>;
    getPropertyTypeTransitionStatus(idempotencyKey: string): Promise<unknown>;
    refreshSettingsFromServer(): Promise<unknown>;
    getDiagnostics(expectedLodgeId: string): Promise<unknown>;
    getSystemHealth(options: unknown): Promise<unknown>;
    relinkLodge(lodgeId: string): Promise<unknown>;
    resetToNewLodge(): Promise<unknown>;
  };
  sync: {
    getStatus(): Promise<SyncStatusSnapshot>;
    getDetails(): Promise<SyncDetailsResult>;
    getOfflineMode(): Promise<import('../../../shared/desktopIpcContracts.js').SyncOfflineModeResult>;
    setOfflineMode(payload: unknown): Promise<import('../../../shared/desktopIpcContracts.js').SyncOfflineModeWriteResult>;
    exportOfflineOperations(): Promise<unknown>;
    retryFailed(queueIds?: string[]): Promise<unknown>;
    clearFailed(queueIds?: string[]): Promise<unknown>;
    runNow(): Promise<unknown>;
    clearHealthFault(id: string): Promise<unknown>;
    getDeviceHealthRollup(): Promise<unknown>;
    onStatusChanged(cb: (value: import('../../../shared/desktopIpcContracts.js').FullSyncStatusSnapshot) => unknown): () => unknown;
    onBookingConflict(cb: (value: unknown) => unknown): () => unknown;
  };
  mesh: {
    lockRoom(roomId: string, startDate: string, endDate: string): Promise<unknown>;
    unlockRoom(lockId: string): Promise<unknown>;
    lockTab(tabId: string, operatorLabel: unknown): Promise<unknown>;
    unlockTab(lockId: string): Promise<unknown>;
    getDiagnostics(): Promise<unknown>;
    refreshDiscovery(): Promise<unknown>;
    connectManualPeer(address: unknown, port: unknown): Promise<unknown>;
    onConflictDetected(cb: (value: unknown) => unknown): () => unknown;
  };
  trial: {
    getStatus(lodgeId: string, options: unknown): Promise<unknown>;
    activateKey(lodgeId: string, key: string): Promise<unknown>;
    getInvoices(lodgeId: string): Promise<unknown>;
    getCommercialInvoices(lodgeId: string, options: unknown): Promise<unknown>;
    getCommercialBillingHistory(lodgeId: string, productId: string): Promise<unknown>;
  };
  usage: {
    getSnapshot(options: unknown): Promise<unknown>;
  };
  updates: {
    onAvailable(cb: (value: DesktopUpdateStateReadView) => unknown): () => unknown;
    onNotAvailable(cb: (value: DesktopUpdateStateReadView) => unknown): () => unknown;
    onProgress(cb: (value: DesktopUpdateProgressEventReadView) => unknown): () => unknown;
    onReady(cb: (value: DesktopUpdateStateReadView) => unknown): () => unknown;
    onError(cb: (value: DesktopUpdateErrorEventReadView) => unknown): () => unknown;
    install(): Promise<unknown>;
    check(): Promise<DesktopUpdateCheckReadResult>;
    download(): Promise<DesktopUpdateDownloadReadResult>;
    getState(): Promise<DesktopUpdateStateReadView>;
    getVersion(): Promise<DesktopIpcResult<'app:getVersion'>>;
  };
  outlets: {
    getAll(): Promise<unknown>;
  };
  pos: {
    /** Successful cache/RPC rows stay unknown; failures use the main UnavailablePosRead envelope. */
    getMenuItems(): Promise<unknown>;
    createMenuItem(data: unknown): Promise<unknown>;
    updateMenuItem(id: string, data: unknown): Promise<unknown>;
    deleteMenuItem(id: string): Promise<unknown>;
    setBarPackTemplate(data: unknown): Promise<unknown>;
    saveBarProductWithPacks(data: unknown): Promise<unknown>;
    saveBarProductWithStock(data: unknown): Promise<unknown>;
    retryProductRequest(operationKey: string): Promise<unknown>;
    discardProductRequest(operationKey: string): Promise<unknown>;
    getProductRequestStatus(): Promise<unknown>;
    getMenuStockReadiness(): Promise<unknown>;
    /** Bar trading recovery backups (queues, journals, tabs, cash-ups, drafts). */
    getTradingBackupStatus(): Promise<unknown>;
    configureTradingBackup(data: unknown): Promise<unknown>;
    disableTradingBackup(): Promise<unknown>;
    snoozeTradingBackup(): Promise<unknown>;
    clearTradingBackupSnooze(): Promise<unknown>;
    runTradingBackupNow(): Promise<unknown>;
    listTradingBackupPackages(): Promise<unknown>;
    verifyTradingBackupPackage(data: unknown): Promise<unknown>;
    stageTradingBackupRestore(data: unknown): Promise<unknown>;
    activateTradingBackupRestore(data: unknown): Promise<unknown>;
    onTradingBackupCollectState(cb: (requestId: unknown) => unknown): () => unknown;
    replyTradingBackupState(requestId: unknown, payload: unknown): Promise<unknown>;
    processPendingPublications(outletIds: unknown): Promise<unknown>;
    getOrders(start: unknown, end: unknown): Promise<unknown>;
    getCertifiedReportHistory(start: unknown, end: unknown): Promise<unknown>;
    getMyOrders(start: unknown, end: unknown): Promise<unknown>;
    getVoidHistory(start: unknown, end: unknown): Promise<unknown>;
    discardLocalVoidRecord(overrideId: string, options: unknown): Promise<unknown>;
    exportHistoryExcel(filters: unknown): Promise<unknown>;
    exportHistoryPdf(filters: unknown): Promise<unknown>;
    exportDeviceRecordsExcel(filters: unknown): Promise<unknown>;
    exportDeviceRecordsPdf(filters: unknown): Promise<unknown>;
    exportDailyCloseSummaryPdf(payload: unknown): Promise<unknown>;
    createOrder(data: unknown): Promise<unknown>;
    getPendingPosSubmitAttempt(): Promise<unknown>;
    voidOrder(id: string): Promise<unknown>;
    approveVoidWithPin(data: unknown): Promise<unknown>;
    approveDiscountWithPin(data: unknown): Promise<unknown>;
    createPartialReturnWithPin(data: unknown): Promise<unknown>;
    getCashupSummary(filters: unknown): Promise<unknown>;
    getCashups(limit: number, filters: unknown): Promise<unknown>;
    createCashup(data: unknown): Promise<unknown>;
    submitCashup(data: unknown): Promise<unknown>;
    submitCashupWithAttendancePin(data: unknown): Promise<unknown>;
    getMyCashupSubmission(shiftId: string): Promise<unknown>;
    getPendingCashupSubmissions(): Promise<unknown>;
    reviewCashupSubmission(data: unknown): Promise<unknown>;
    openDrawerPeriod(data: unknown): Promise<unknown>;
    recordCashMovement(data: unknown): Promise<unknown>;
    recordCashCount(data: unknown): Promise<unknown>;
    submitDrawerPeriodCashup(data: unknown): Promise<unknown>;
    reviewDrawerPeriodCashup(data: unknown): Promise<unknown>;
    getDrawerPeriodState(outletId: string): Promise<unknown>;
    setOutletCashModel(outletId: string, cashModel: unknown): Promise<unknown>;
    getTabs(filters: unknown): Promise<unknown>;
    saveTab(data: unknown): Promise<unknown>;
    closeTab(id: string): Promise<unknown>;
    updateTabStatus(id: string, status: string): Promise<unknown>;
    transferTabWaiter(data: unknown): Promise<unknown>;
    overrideTableTab(data: unknown): Promise<unknown>;
    splitBillByItems(data: unknown): Promise<unknown>;
    splitBillEvenly(data: unknown): Promise<unknown>;
    getTablesWithStatus(outletId: string): Promise<unknown>;
    getActiveTableTab(tableName: string, outletId: string): Promise<unknown>;
    openTableSession(data: unknown): Promise<unknown>;
    getTables(): Promise<unknown>;
    saveTable(data: unknown): Promise<unknown>;
    deleteTable(id: string): Promise<unknown>;
    getStations(): Promise<unknown>;
    saveStation(data: unknown): Promise<unknown>;
    deleteStation(id: string): Promise<unknown>;
    getTickets(filters: unknown): Promise<unknown>;
    updateTicketStatus(id: string, status: string): Promise<unknown>;
    updateTicketStatusWithOperation(id: string, status: string, operationId: string): Promise<unknown>;
    getVoidReasonTemplates(): Promise<unknown>;
    saveVoidReasonTemplate(data: unknown): Promise<unknown>;
    getShiftHandoverNotes(shiftId: string): Promise<unknown>;
    saveShiftHandoverNote(data: unknown): Promise<unknown>;
    attachCashupProof(data: unknown): Promise<unknown>;
    getCashupProofAttachments(submissionId: string): Promise<unknown>;
    createCashupProofSignedUrl(submissionId: string, attachmentId: string): Promise<unknown>;
    getCurrentShift(outletId: string, cashierId: string): Promise<unknown>;
    getStaffOpenShift(staffId: string): Promise<unknown>;
    getStaffCashupSubmission(shiftId: string): Promise<unknown>;
    activateSharedTillOperator(data: unknown): Promise<unknown>;
    getSharedTillOperatorSession(data: unknown): Promise<unknown>;
    touchSharedTillOperator(data: unknown): Promise<unknown>;
    getSharedTillHistory(start: unknown, end: unknown, options: unknown): Promise<unknown>;
    lockSharedTillOperator(): Promise<unknown>;
    linkMyShiftAttendance(data: unknown): Promise<unknown>;
    openShift(data: unknown): Promise<unknown>;
    closeShift(data: unknown): Promise<unknown>;
    getUnconfirmedPosUsage(): Promise<unknown>;
    getHardwareSettings(): Promise<PosHardwareSettingsResult>;
    saveHardwareSettings(data: unknown): Promise<unknown>;
    testHardware(kind: unknown): Promise<unknown>;
    verifyBarcodeScanner(data: unknown): Promise<BarcodeScannerVerificationResult>;
    openCashDrawer(data: unknown): Promise<unknown>;
    getStaff(): Promise<unknown>;
    selectStaffWithPin(data: unknown): Promise<unknown>;
    verifyManagerPin(data: unknown): Promise<unknown>;
    getModifierGroups(): Promise<unknown>;
    saveModifierGroup(data: unknown): Promise<unknown>;
    getPromotions(): Promise<unknown>;
    savePromotion(data: unknown): Promise<unknown>;
    getFloorLayout(): Promise<unknown>;
    saveFloorLayout(data: unknown): Promise<unknown>;
    updateCustomerDisplay(data: unknown): Promise<unknown>;
    getCustomerDisplay(): Promise<unknown>;
    openDisplay(kind: unknown, options: unknown): Promise<unknown>;
    listDisplays(): Promise<unknown>;
    scanNetworkPrinters(): Promise<unknown>;
    sendPaymentTerminalTotal(data: unknown): Promise<unknown>;
    getAuditLog(limit: number): Promise<unknown>;
    getActiveBookingForRoom(roomId: string): Promise<unknown>;
    getActiveEvents(): Promise<unknown>;
    getRecipes(): Promise<unknown>;
    saveRecipe(data: unknown): Promise<unknown>;
    deleteRecipe(recipeId: string): Promise<unknown>;
    getCustomers(): Promise<unknown>;
    saveCustomer(data: unknown): Promise<unknown>;
    awardLoyalty(data: unknown): Promise<unknown>;
    queueLoyaltyRepair(data: unknown): Promise<unknown>;
    redeemLoyalty(data: unknown): Promise<unknown>;
    chargeCustomerAccount(data: unknown): Promise<unknown>;
    redeemVoucher(code: string, amount: number): Promise<unknown>;
    recordDelivery(data: unknown): Promise<unknown>;
    clockInStaff(data: unknown): Promise<unknown>;
    clockInSelfForPos(data: unknown): Promise<unknown>;
    clockInStaffWithAttendancePin(data: unknown): Promise<unknown>;
    clockOutStaff(data: unknown): Promise<unknown>;
    clockOutStaffWithAttendancePin(data: unknown): Promise<unknown>;
    getActiveShifts(): Promise<unknown>;
    getBarActiveShifts(): Promise<unknown>;
    getRestaurantShiftPlans(startDate: string, endDate: string): Promise<unknown>;
    saveRestaurantShiftPlan(data: unknown): Promise<unknown>;
    deleteRestaurantShiftPlan(id: string): Promise<unknown>;
    openCashDrawerSession(data: unknown): Promise<unknown>;
    closeCashDrawerSession(data: unknown): Promise<unknown>;
    getOpenCashDrawer(): Promise<unknown>;
    getSuppliers(): Promise<unknown>;
    createSupplier(data: unknown): Promise<unknown>;
    updateSupplier(supplierId: string, data: unknown): Promise<unknown>;
    createPurchaseOrder(data: unknown): Promise<unknown>;
    updatePurchaseOrderDraft(orderId: string, data: unknown): Promise<unknown>;
    savePurchaseOrderPdf(orderId: string): Promise<unknown>;
    sendPurchaseOrderEmail(orderId: string): Promise<unknown>;
    approvePurchaseOrder(orderId: string): Promise<unknown>;
    receivePurchaseOrder(orderId: string, stockLocationId: string): Promise<unknown>;
    createStockTransfer(data: unknown): Promise<unknown>;
    createChecklist(data: unknown): Promise<unknown>;
    completeChecklistItem(data: unknown): Promise<unknown>;
    getActiveAlerts(filters: unknown): Promise<unknown>;
    getAlertHistory(filters: unknown): Promise<unknown>;
    recordAlert(data: unknown): Promise<unknown>;
    acknowledgeAlert(alertId: string, reason: string, operationId: string): Promise<unknown>;
    resolveAlert(alertId: string, reason: string, operationId: string): Promise<unknown>;
    getPurchaseOrders(startDate: string, endDate: string): Promise<unknown>;
    getPurchasingSnapshot(): Promise<unknown>;
    getShiftHistory(startDate: string, endDate: string): Promise<unknown>;
    getCashDrawerSessions(startDate: string, endDate: string): Promise<unknown>;
    getChecklists(): Promise<unknown>;
    seedBarChecklistTemplates(): Promise<unknown>;
    getBarChecklistTemplates(): Promise<unknown>;
    createBarChecklistFromTemplate(data: unknown): Promise<unknown>;
    getExceptionAlerts(): Promise<unknown>;
    generateOwnerDigest(): Promise<unknown>;
    getRestaurantReservations(startDate: string, endDate: string, outletId: string): Promise<unknown>;
    createRestaurantReservation(data: unknown): Promise<unknown>;
    updateRestaurantReservation(id: string, data: unknown): Promise<unknown>;
    cancelRestaurantReservation(id: string, reason: string): Promise<unknown>;
    seatRestaurantReservation(id: string, tableId: string): Promise<unknown>;
    markRestaurantReservationNoShow(id: string, reason: string): Promise<unknown>;
    getRestaurantWaitlist(outletId: string, includeReservationWaitlist: unknown): Promise<unknown>;
    createRestaurantWaitlistEntry(data: unknown): Promise<unknown>;
    updateRestaurantWaitlistEntry(id: string, data: unknown): Promise<unknown>;
    removeRestaurantWaitlistEntry(id: string, reason: string): Promise<unknown>;
    seatRestaurantWaitlistEntry(id: string, tableId: string): Promise<unknown>;
    serviceRestaurantReservationAction(id: string, action: string, tableIds: unknown): Promise<unknown>;
    getRestaurantCombos(outletId: string): Promise<unknown>;
    saveRestaurantCombo(data: unknown): Promise<unknown>;
    deleteRestaurantCombo(comboId: string): Promise<unknown>;
    getRecipeVarianceReport(startDate: string, endDate: string, outletId: string): Promise<unknown>;
    getRecipePreparationLosses(startDate: string, endDate: string, outletId: string): Promise<unknown>;
    getRecipePreparationLossIngredientSummary(startDate: string, endDate: string, outletId: string): Promise<unknown>;
    getRestaurantPrepItems(): Promise<unknown>;
    saveRestaurantPrepItem(data: unknown): Promise<unknown>;
    getRestaurantPrepBatches(startDate: string, endDate: string, outletId: string): Promise<unknown>;
    createRestaurantPrepBatch(data: unknown): Promise<unknown>;
    postRestaurantPrepBatch(batchId: string): Promise<unknown>;
    recordTicketStatusEvent(data: unknown): Promise<unknown>;
    getKitchenTimingReport(startDate: string, endDate: string, outletId: string, station: unknown): Promise<unknown>;
    getLowStockPurchaseSuggestions(outletId: string): Promise<unknown>;
    setPreferredSupplierForInventoryItem(inventoryItemId: string, supplierId: string, lastUnitCost: unknown): Promise<unknown>;
    convertPurchaseSuggestionsToPo(supplierId: string, suggestions: unknown, notes: unknown): Promise<unknown>;
    recordSettlement(data: unknown): Promise<unknown>;
    getSettlementBankAccounts(): Promise<unknown>;
    getSettlements(businessDate: string): Promise<unknown>;
    getSettlementExpectedTotal(startDate: string, endDate: string, channel: string): Promise<unknown>;
    recordReservationDeposit(data: unknown): Promise<unknown>;
    getReservationDeposits(days: number): Promise<unknown>;
    getRestaurantOutletControls(): Promise<unknown>;
    getRestaurantStockLocations(): Promise<unknown>;
    getRestaurantStockLocationBalances(): Promise<unknown>;
    createRestaurantStockLocation(data: unknown): Promise<unknown>;
    updateRestaurantStockLocation(locationId: string, data: unknown): Promise<unknown>;
    deleteRestaurantStockLocation(locationId: string): Promise<unknown>;
    setRestaurantOutletStockLocation(outletId: string, stockLocationId: string): Promise<unknown>;
    createRestaurantOutlet(data: unknown): Promise<unknown>;
    updateRestaurantOutlet(outletId: string, data: unknown): Promise<unknown>;
    recordFeedback(data: unknown): Promise<unknown>;
    submitStaffFeedback(data: unknown): Promise<unknown>;
    getFeedback(days: number): Promise<unknown>;
    getSetupProgress(): Promise<unknown>;
    getSetupProgressWithReadStatus(): Promise<unknown>;
    setSetupStage(data: unknown): Promise<unknown>;
    createGiftCard(data: unknown): Promise<unknown>;
    recordTipPayout(data: unknown): Promise<unknown>;
    getTipPayouts(days: number): Promise<unknown>;
    getTipBalances(days: number): Promise<unknown>;
    saveReservationPolicy(data: unknown): Promise<unknown>;
    recordInventoryLot(data: unknown): Promise<unknown>;
    updateInventoryLotExpiry(lotId: string, data: unknown): Promise<unknown>;
    writeOffExpiredInventoryLot(lotId: string, data: unknown): Promise<unknown>;
    getExpiryLots(days: number): Promise<unknown>;
  };
  inventory: {
    getItems(): Promise<unknown>;
    getItemsWithReadStatus(): Promise<DesktopIpcResult<'inventory:getItemsWithReadStatus'>>;
    getBarStockAging(outletId: string | null): Promise<unknown>;
    postBarPhysicalCount(payload: unknown): Promise<unknown>;
    postBarSimpleDelivery(payload: unknown): Promise<unknown>;
    getBarStockCountHistory(outletId: string, limit: number): Promise<unknown>;
    findByBarcode(barcode: string, outletId: string): Promise<unknown>;
    printBarcodeLabels(labels: unknown): Promise<unknown>;
    createItem(data: unknown): Promise<unknown>;
    updateItem(id: string, data: unknown): Promise<unknown>;
    deleteItem(id: string): Promise<unknown>;
    addPurchase(data: unknown): Promise<unknown>;
    getPurchases(itemId: string): Promise<unknown>;
    adjustStock(itemId: string, delta: number, notes: string | null, managerPin: string, adjustmentId: string): Promise<unknown>;
    getMovements(filters: unknown): Promise<unknown>;
    getMovementsWithReadStatus(filters: unknown): Promise<unknown>;
    getLowStock(): Promise<unknown>;
    getStocktakes(limit: number): Promise<unknown>;
    getRestaurantStockSnapshot(movementDate: string): Promise<unknown>;
    createStocktake(data: unknown): Promise<unknown>;
    getStocktake(stocktakeId: string): Promise<unknown>;
    saveStocktakeCounts(stocktakeId: string, lines: unknown): Promise<unknown>;
    postStocktake(stocktakeId: string, notes: unknown): Promise<unknown>;
    discardDraft(id: string): Promise<unknown>;
  };
  supplies: {
    getItems(): Promise<unknown>;
    createItem(data: unknown): Promise<unknown>;
    updateItem(id: string, data: unknown): Promise<unknown>;
    deleteItem(id: string): Promise<unknown>;
    addPurchase(data: unknown): Promise<unknown>;
    getPurchases(itemId: string): Promise<unknown>;
    adjustStock(itemId: string, delta: number, notes: unknown, managerPin: unknown): Promise<unknown>;
    getRoomStock(): Promise<unknown>;
    loadToRoom(data: unknown): Promise<unknown>;
    useInRoom(data: unknown): Promise<unknown>;
    returnFromRoom(data: unknown): Promise<unknown>;
    getMovements(limit: number): Promise<unknown>;
    saveAllocations(weekStart: unknown, allocations: unknown): Promise<unknown>;
    getAllocations(start: unknown, end: unknown): Promise<unknown>;
    getWeekAllocations(weekStart: unknown): Promise<unknown>;
    exportReport(payload: unknown): Promise<unknown>;
    exportReportPdf(payload: unknown): Promise<unknown>;
    getStocktakes(limit: number): Promise<unknown>;
    createStocktake(data: unknown): Promise<unknown>;
    getStocktake(stocktakeId: string): Promise<unknown>;
    saveStocktakeCounts(stocktakeId: string, lines: unknown): Promise<unknown>;
    postStocktake(stocktakeId: string, notes: unknown): Promise<unknown>;
    getRoomStocktakes(limit: number): Promise<unknown>;
    createRoomStocktake(data: unknown): Promise<unknown>;
    getRoomStocktake(stocktakeId: string): Promise<unknown>;
    saveRoomStocktakeCounts(stocktakeId: string, lines: unknown): Promise<unknown>;
    postRoomStocktake(stocktakeId: string, notes: unknown): Promise<unknown>;
    addRoomStocktakeLine(stocktakeId: string, data: unknown): Promise<unknown>;
  };
  admin: AdminExportApi & {
    getCommandCentralReauthStatus(): Promise<unknown>;
    reauthenticateCommandCentral(password: string): Promise<unknown>;
    exists(): Promise<unknown>;
    setup(name: string, email: string, password: string): Promise<unknown>;
    getCompanies(): Promise<unknown>;
    getLicenses(): Promise<unknown>;
    createLicense(data: unknown): Promise<unknown>;
    issueSubscriptionContract(payload: unknown): Promise<unknown>;
    assignCommercialSubscription(payload: unknown): Promise<unknown>;
    updateLicense(id: string, updates: unknown): Promise<unknown>;
    deleteLicense(id: string): Promise<unknown>;
    getBroadcasts(): Promise<unknown>;
    getActiveBroadcasts(): Promise<unknown>;
    createBroadcast(data: unknown): Promise<unknown>;
    updateBroadcast(id: string, data: unknown): Promise<unknown>;
    deleteBroadcast(id: string): Promise<unknown>;
    getLodgeFeatures(lodgeId: string): Promise<unknown>;
    setLodgeFeature(lodgeId: string, name: string, enabled: boolean, metadata?: unknown): Promise<unknown>;
    clearLodgeFeature(lodgeId: string, name: string): Promise<unknown>;
    getCommercialEntitlementOverrides(lodgeId: string, productId: string): Promise<unknown>;
    getCommercialTransitionPreview(lodgeId: string, productId: string, targetPackageKey: string, referenceDate: string): Promise<unknown>;
    setCommercialEntitlementOverride(payload: unknown): Promise<unknown>;
    revokeCommercialEntitlementOverride(payload: unknown): Promise<unknown>;
    applyCommercialUserRemediation(payload: unknown): Promise<unknown>;
    getAllLodgeFeatures(): Promise<unknown>;
    getTestDataResetPreview(lodgeId: string, payload: unknown): Promise<unknown>;
    runTestDataReset(lodgeId: string, payload: unknown): Promise<unknown>;
    getTestDataResetAudit(lodgeId: string, limit: number): Promise<unknown>;
    getSupportTickets(filters: unknown): Promise<unknown>;
    createSupportTicket(data: unknown): Promise<unknown>;
    updateSupportTicket(id: string, updates: unknown): Promise<unknown>;
    addSupportTicketMessage(id: string, payload: unknown): Promise<unknown>;
    deleteSupportTicket(id: string): Promise<unknown>;
    getActivityLogs(filters: unknown): Promise<unknown>;
    getAuditSummary(filters: unknown): Promise<unknown>;
    getCompanyStats(lodgeId: string): Promise<unknown>;
    updateLicenseBilling(id: string, data: unknown): Promise<unknown>;
    getOverdueLicenses(): Promise<unknown>;
    getNextInvoiceNumber(): Promise<unknown>;
    createInvoice(data: unknown): Promise<unknown>;
    getInvoices(filters: unknown): Promise<unknown>;
    getInvoicesByLodge(lodgeId: string): Promise<unknown>;
    getClientBookingInvoices(lodgeId: string): Promise<unknown>;
    updateInvoice(id: string, data: unknown): Promise<unknown>;
    deleteInvoice(id: string): Promise<unknown>;
    getInvoiceSummary(): Promise<unknown>;
    sendInvoiceEmail(payload: unknown): Promise<unknown>;
    updateCompany(lodgeId: string, updates: unknown): Promise<unknown>;
    getCompanyUsers(lodgeId: string): Promise<unknown>;
    resetCompanyUserPassword(lodgeId: string, userId: string, password: string): Promise<unknown>;
    resetCompanyUserPin(lodgeId: string, userId: string, pin: unknown): Promise<unknown>;
    updateCompanyUserPwaAccess(lodgeId: string, userId: string, payload: unknown): Promise<unknown>;
    archiveCompany(lodgeId: string): Promise<unknown>;
    restoreCompany(lodgeId: string): Promise<unknown>;
    applyCompanyLifecycle(payload: unknown): Promise<unknown>;
    permanentlyDeleteCompany(lodgeId: string): Promise<unknown>;
    repairDuplicateEventBookings(lodgeId: string): Promise<unknown>;
    getExpenses(): Promise<unknown>;
    createExpense(data: unknown): Promise<unknown>;
    updateExpense(id: string, data: unknown): Promise<unknown>;
    deleteExpense(id: string): Promise<unknown>;
    getMarketingLeads(filters: unknown): Promise<unknown>;
    updateMarketingLeadStatus(id: string, status: string): Promise<unknown>;
    updateLeadCrm(id: string, fields: unknown): Promise<unknown>;
    getSalesPipelineSummary(): Promise<unknown>;
    exportExcel(payload: import('./admin-export.js').AdminExportExcelRequest): Promise<unknown>;
    exportPdf(payload: import('./admin-export.js').AdminExportPdfRequest): Promise<unknown>;
    createNotification(payload: unknown): Promise<unknown>;
    getNotifications(filters: unknown): Promise<unknown>;
    getUnreadCount(): Promise<unknown>;
    markNotificationsRead(ids: string[] | null): Promise<DesktopIpcResult<'admin:markNotificationsRead'>>;
    cleanupNotifications(days: number): Promise<DesktopIpcResult<'admin:cleanupNotifications'>>;
    getFleetHealthRollup(): Promise<unknown>;
    getFleetHealthSummary(): Promise<unknown>;
    recordCommandCentralHealthRun(payload: unknown): Promise<unknown>;
    listCommandCentralHealthRuns(limit: number): Promise<unknown>;
    getScheduledReleases(): Promise<unknown>;
    expireOverdueFeatures(): Promise<unknown>;
    getNotificationRules(): Promise<unknown>;
    upsertNotificationRule(rule: unknown): Promise<unknown>;
    evaluateRule(ruleKey: string): Promise<unknown>;
    evaluateAllRules(): Promise<unknown>;
    getNotificationEvents(opts: unknown): Promise<unknown>;
    getNotificationEventSummary(): Promise<unknown>;
    markEventsDispatched(eventIds: unknown): Promise<unknown>;
    getMrrSummary(): Promise<unknown>;
    getRevenueSummary(days: number): Promise<unknown>;
    getLodgeFinancialSummary(): Promise<unknown>;
    getCollectionsQueue(): Promise<unknown>;
    getRevenueByMethod(days: number): Promise<unknown>;
    generateCommercialInvoice(payload: unknown): Promise<unknown>;
    recordCommercialPayment(payload: unknown): Promise<unknown>;
    getCommercialInvoices(filters: unknown): Promise<unknown>;
    getCommercialBillingSummary(): Promise<unknown>;
    getAdminToday(): Promise<unknown>;
    globalSearch(query: string, limit?: number): Promise<DesktopIpcResult<'admin:globalSearch'>>;
    bulkUpdateStatus(entityType: unknown, entityIds: unknown, newStatus: string): Promise<unknown>;
    bulkDelete(entityType: unknown, entityIds: unknown): Promise<unknown>;
    bulkNotify(entityType: unknown, entityIds: unknown, message: string): Promise<unknown>;
    pushUpdateNotification(version: string, message: string, force: boolean): Promise<unknown>;
    getSyncQueueStatus(): Promise<unknown>;
    createRelease(release: unknown): Promise<unknown>;
    updateRelease(version: number, updates: unknown): Promise<unknown>;
    checkUpdateAvailability(currentVersion: unknown, deviceId: string): Promise<unknown>;
    getReleases(productId: string): Promise<unknown>;
    getSurfaceIntelligence(): Promise<unknown>;
  };
  conference: {
    getAll(start?: unknown, end?: unknown): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    updatePayment(id: string, amount: number, method: string, intentKey: string): Promise<unknown>;
  };
  events: {
    getAll(start: unknown, end: unknown): Promise<unknown>;
    getById(id: string): Promise<unknown>;
    getDetails(id: string): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    cancel(id: string, reason: string, cancelLinkedRooms: unknown): Promise<unknown>;
    addLineItem(data: unknown): Promise<unknown>;
    voidLineItem(lineItemId: string, reason: string): Promise<unknown>;
    updatePayment(id: string, amount: number, method: string, type: string, intentKey: string): Promise<unknown>;
    checkAvailability(resourceKey: string, startAt: string, endAt: string, excludeEventId: string): Promise<unknown>;
    getVenuePackages(category: string, activeOnly: unknown): Promise<unknown>;
    createVenuePackage(data: unknown): Promise<unknown>;
    updateVenuePackage(id: string, data: unknown): Promise<unknown>;
    deleteVenuePackage(id: string): Promise<unknown>;
    applyPackage(packageId: string, eventBookingId: string, quantity: number, intentKey: string): Promise<unknown>;
  };
  venueManagement: {
    getEventLeads(status: string): Promise<unknown>;
    createEventLead(data: unknown): Promise<unknown>;
    updateEventLead(id: string, data: unknown): Promise<unknown>;
    convertLeadToBooking(leadId: string): Promise<unknown>;
    getVenueAvailabilityRules(resourceKey: string): Promise<unknown>;
    upsertVenueAvailabilityRule(data: unknown): Promise<unknown>;
    getVenueAvailabilityCalendar(resourceKey: string, startDate: string, endDate: string): Promise<unknown>;
    getRunSheet(eventBookingId: string): Promise<unknown>;
    createRunSheet(data: unknown): Promise<unknown>;
    updateRunSheet(id: string, data: unknown): Promise<unknown>;
    finalizeRunSheet(id: string): Promise<unknown>;
    executeRunSheet(id: string): Promise<unknown>;
    getEventSuppliers(eventBookingId: string): Promise<unknown>;
    createSupplierEntry(data: unknown): Promise<unknown>;
    updateSupplierEntry(id: string, data: unknown): Promise<unknown>;
    updateSupplierStatus(id: string, status: string, actualAmount: unknown): Promise<unknown>;
    getDepositMilestones(eventBookingId: string): Promise<unknown>;
    createDepositMilestone(data: unknown): Promise<unknown>;
    markMilestonePaid(id: string, paidDate: string, method: string, reference: string): Promise<unknown>;
    waiveMilestone(id: string, reason: string): Promise<unknown>;
    settleEvent(eventBookingId: string, idempotencyKey: string, adjustmentAmount: unknown, adjustmentType: unknown, adjustmentReason: string, notes: unknown): Promise<unknown>;
    getEventProfitability(eventBookingId: string): Promise<unknown>;
    getVenueProfitabilityReport(startDate: string, endDate: string): Promise<unknown>;
  };
  ai: {
    turn(payload: unknown): Promise<DesktopIpcResult<'ai:turn'>>;
    catalog(): Promise<unknown>;
    execute(payload: unknown): Promise<unknown>;
    collections: {
      preview(payload: unknown): Promise<unknown>;
      execute(payload: unknown): Promise<unknown>;
      onProgress(cb: (value: unknown) => unknown): () => unknown;
    };
    overdue: {
      preview(payload: unknown): Promise<unknown>;
      execute(payload: unknown): Promise<unknown>;
      onProgress(cb: (value: unknown) => unknown): () => unknown;
    };
    onAlert(cb: (value: unknown) => unknown): () => unknown;
  };
  import: {
    parseExcel(filePath: string): Promise<unknown>;
    getDroppedFilePath(file: File & { path?: string }): string;
    exportErrors(payload: unknown): Promise<unknown>;
    execute(rows: unknown, filename: string, type: string): Promise<unknown>;
    dryRun(rows: unknown, type: string): Promise<unknown>;
    getTypes(): Promise<unknown>;
    checkDuplicates(rows: unknown): Promise<unknown>;
    undoBatch(batchId: string): Promise<unknown>;
    getBatches(): Promise<unknown>;
    downloadTemplate(type: string): Promise<unknown>;
    onProgress(cb: (value: unknown) => unknown): () => unknown;
  };
  data: {
    exportAll(options: unknown): Promise<unknown>;
    onExportProgress(cb: (value: unknown) => unknown): () => unknown;
  };
  dayuse: {
    getAll(start: unknown, end: unknown): Promise<unknown>;
    add(data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    updateStatus(id: string, status: string): Promise<unknown>;
    settleBalance(id: string, method: string, markCompleted?: boolean): Promise<unknown>;
    summary(date: string): Promise<unknown>;
    getInventoryItems(): Promise<unknown>;
    getConfig(): Promise<unknown>;
    saveConfig(data: unknown): Promise<unknown>;
  };
  email: {
    getConfig(): Promise<unknown>;
    saveConfig(config: unknown): Promise<unknown>;
    test(config: unknown): Promise<unknown>;
    sendLicense(payload: unknown): Promise<unknown>;
  };
  hotel: {
    getDashboardStats(): Promise<unknown>;
    getArrivals(): Promise<unknown>;
    getDepartures(): Promise<unknown>;
    getInHouse(): Promise<unknown>;
    getNoShows(): Promise<unknown>;
    getKpis(days: number): Promise<unknown>;
    getApplicableRoomRate(roomId: string, date: string, corporateAccountId: string): Promise<unknown>;
    quoteRoomStay(roomId: string, checkIn: unknown, checkOut: unknown, corporateAccountId: string): Promise<unknown>;
  };
  roomTypes: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  roomAttributes: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  floorSections: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  folios: {
    getAll(): Promise<unknown>;
    getEntries(bookingId: string): Promise<unknown>;
    postCharge(bookingId: string, data: unknown): Promise<unknown>;
  };
  folioLedger: {
    getFolios(bookingId: string): Promise<unknown>;
    getLineItems(folioId: string): Promise<unknown>;
    createFolio(bookingId: string, guestId: string, type: string, label: string, intentId: string): Promise<unknown>;
    addCharge(folioId: string, amount: number, description: unknown, refType: unknown, refId: string, intentId: string): Promise<unknown>;
    addPayment(folioId: string, amount: number, description: unknown, intentId: string): Promise<unknown>;
    transferCharge(srcFolioId: string, tgtFolioId: string, amount: number, description: unknown, intentId: string): Promise<unknown>;
    splitFolio(srcFolioId: string, tgtType: unknown, tgtLabel: unknown, amount: number, description: unknown, intentId: string): Promise<unknown>;
    voidLineItem(lineItemId: string, reason: string, intentId: string): Promise<unknown>;
    closeFolio(folioId: string, intentId: string): Promise<unknown>;
    reopenFolio(folioId: string, intentId: string): Promise<unknown>;
    lockFolio(folioId: string, intentId: string): Promise<unknown>;
    getBalance(folioId: string): Promise<unknown>;
    getPendingIntentRecovery(): Promise<unknown>;
    retryIntent(intentId: string): Promise<unknown>;
  };
  roomMoves: {
    getAvailable(currentRoomId: string, checkIn: unknown, checkOut: unknown): Promise<unknown>;
    execute(bookingId: string, targetRoomId: string, reason: string, actorName: string): Promise<unknown>;
  };
  corporateAccounts: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  corporateBilling: {
    charge(accountId: string, bookingId: string, amount: number, description: unknown, intentId: string): Promise<unknown>;
    getOutstanding(accountId: string): Promise<unknown>;
    recordPayment(accountId: string, invoiceIds: unknown, amount: number, method: string, reference: string, intentId: string): Promise<unknown>;
    getStatement(accountId: string, start: unknown, end: unknown): Promise<unknown>;
    checkCreditLimit(accountId: string, pendingAmount: unknown): Promise<unknown>;
    suspend(accountId: string, reason: string): Promise<unknown>;
    reactivate(accountId: string): Promise<unknown>;
  };
  ratePlans: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    quoteRoomStay(roomId: string, checkIn: unknown, checkOut: unknown, corporateAccountId: string): Promise<unknown>;
  };
  rateCalendar: {
    get(roomTypeId: string, startDate: string, endDate: string): Promise<unknown>;
    setEntry(roomTypeId: string, date: string, amount: number, currency: string): Promise<unknown>;
    setBulk(entries: unknown): Promise<unknown>;
    setRestriction(roomTypeId: string, date: string, restrictions: unknown): Promise<unknown>;
    getConflicts(roomTypeId: string, startDate: string, endDate: string): Promise<unknown>;
    getApplicableRate(roomTypeId: string, date: string): Promise<unknown>;
    quoteStayTotal(roomId: string, checkIn: unknown, checkOut: unknown, corporateAccountId: string): Promise<unknown>;
    getYieldRules(): Promise<unknown>;
    createYieldRule(data: unknown): Promise<unknown>;
    updateYieldRule(id: string, data: unknown): Promise<unknown>;
    deleteYieldRule(id: string): Promise<unknown>;
    getApplicableYieldAdjustment(date: string, currentOccupancyPct: unknown): Promise<unknown>;
    calculateOccupancyBasedRate(baseRate: unknown, date: string, roomTypeId: string): Promise<unknown>;
    getOccupancyForecast(startDate: string, endDate: string): Promise<unknown>;
  };
  promoCodes: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    validate(code: string, roomTypeId: string, nights: unknown): Promise<unknown>;
  };
  seasonLabels: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  revenueManager: {
    getForecast(startDate: string, endDate: string): Promise<unknown>;
    upsertForecast(date: string, occupancyPct: unknown, adr: unknown, notes: unknown): Promise<unknown>;
    getCompetitorNotes(): Promise<unknown>;
    createCompetitorNote(competitorName: string, roomTypeId: string, notedRate: unknown, notes: unknown): Promise<unknown>;
    getDemandEvents(startDate: string, endDate: string): Promise<unknown>;
    createDemandEvent(eventName: string, eventDate: string, expectedImpact: unknown, notes: unknown): Promise<unknown>;
    getRecommendations(): Promise<unknown>;
    approveRecommendation(recommendation: unknown, notes: unknown): Promise<unknown>;
    rejectRecommendation(recommendation: unknown, reason: string): Promise<unknown>;
    applyRecommendation(recommendation: unknown): Promise<unknown>;
  };
  advancedReports: {
    getOccupancy(start: unknown, end: unknown): Promise<unknown>;
    getPace(start: unknown, end: unknown): Promise<unknown>;
    getPickup(start: unknown, end: unknown): Promise<unknown>;
    getChannelSource(start: unknown, end: unknown): Promise<unknown>;
    getDebtorAging(): Promise<unknown>;
    getRatePerformance(start: unknown, end: unknown): Promise<unknown>;
    getHousekeepingProductivity(start: unknown, end: unknown): Promise<unknown>;
    getRoomDowntime(start: unknown, end: unknown): Promise<unknown>;
    getGroupPickup(start: unknown, end: unknown): Promise<unknown>;
    getCancellationNoShow(start: unknown, end: unknown): Promise<unknown>;
    getTaxVat(start: unknown, end: unknown): Promise<unknown>;
    getDepositLiability(): Promise<unknown>;
    getFolioExceptions(): Promise<unknown>;
  };
  payments: {
    getProviderConfig(provider?: string | null, lodgeId?: string | null): Promise<unknown>;
    saveProviderConfig(payload: unknown, lodgeId?: string | null): Promise<unknown>;
    getPaymentDashboard(lodgeId?: string | null): Promise<unknown>;
    verifyWebhookSignature(provider: string, signature: unknown, payloadRaw: unknown): Promise<unknown>;
  };
  subscriptionRequests: {
    submit(request: unknown): Promise<unknown>;
    getAll(status: string, limit: number, offset: number): Promise<unknown>;
    getById(requestId: string): Promise<unknown>;
    updateStatus(requestId: string, status: string, reviewedBy: string, rejectionReason: string): Promise<unknown>;
    createDocument(requestId: string, type: string, documentInput: unknown): Promise<unknown>;
    exportDocumentPdf(documentPayload: unknown): Promise<unknown>;
    activate(requestId: string, activatedBy: string, activationPayload: unknown): Promise<unknown>;
  };
  groupBlocks: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  masterFolios: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    getDebtorAging(caId: string): Promise<unknown>;
    checkCreditLimit(caId: string, amt: unknown): Promise<unknown>;
    generateStatement(caId: string, s: unknown, e: unknown): Promise<unknown>;
  };
  roomingLists: {
    getAll(): Promise<unknown>;
    process(entries: unknown, caId: string, gbId: string, name: string): Promise<unknown>;
    parseCSV(csvText: unknown): Promise<unknown>;
  };
  groupOperations: {
    getAll(): Promise<unknown>;
    checkinBlock(blockId: string): Promise<unknown>;
    checkoutBlock(blockId: string): Promise<unknown>;
    getPickup(blockId: string): Promise<unknown>;
    releaseUnsold(blockId: string): Promise<unknown>;
    createFromRoomingList(listId: string): Promise<unknown>;
  };
  multiProperty: {
    getAllGroups(): Promise<unknown>;
    createGroup(data: unknown): Promise<unknown>;
    updateGroup(id: string, data: unknown): Promise<unknown>;
    deleteGroup(id: string): Promise<unknown>;
    getProperties(groupId: string): Promise<unknown>;
    addProperty(groupId: string, lodgeId: string, role: string): Promise<unknown>;
    removeProperty(groupId: string, lodgeId: string): Promise<unknown>;
    getConsolidatedDashboard(groupId: string): Promise<unknown>;
    getConsolidatedOccupancy(groupId: string, start: unknown, end: unknown): Promise<unknown>;
    getConsolidatedFinancial(groupId: string, start: unknown, end: unknown): Promise<unknown>;
    switchProperty(lodgeId: string): Promise<unknown>;
    getGroupSettings(groupId: string): Promise<unknown>;
    updateGroupSettings(groupId: string, key: string, value: unknown): Promise<unknown>;
    getSharedGuestProfiles(groupId: string): Promise<unknown>;
    shareGuestProfile(groupId: string, guestId: string, notes: unknown): Promise<unknown>;
    unshareGuestProfile(groupId: string, guestId: string): Promise<unknown>;
    getSharedBlacklist(groupId: string): Promise<unknown>;
    addBlacklistEntry(groupId: string, guestId: string, email: string, phone: unknown, reason: string): Promise<unknown>;
    removeBlacklistEntry(groupId: string, entryId: string): Promise<unknown>;
    getSharedCorporateAccounts(groupId: string): Promise<unknown>;
    shareCorporateAccount(groupId: string, corporateAccountId: string, shareLevel: unknown): Promise<unknown>;
    unshareCorporateAccount(groupId: string, corporateAccountId: string): Promise<unknown>;
    getGroupMemberLodges(groupId: string): Promise<unknown>;
  };
  enterpriseOperations: {
    getRecords(workflowKey: string, lodgeId: string): Promise<unknown>;
    upsertRecord(workflowKey: string, record: unknown, lodgeId: string): Promise<unknown>;
    appendEvent(workflowKey: string, event: unknown, lodgeId: string): Promise<unknown>;
    createPaymentLinkRequest(payload: unknown): Promise<unknown>;
    createChannelSyncItem(payload: unknown): Promise<unknown>;
    createDocument(payload: unknown): Promise<unknown>;
  };
  lostFound: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
  };
  housekeepingCommandCenter: {
    getDashboard(date: string): Promise<unknown>;
    createAssignment(roomId: string, assignedTo: unknown, date: string, shift: unknown): Promise<unknown>;
    updateAssignmentStatus(id: string, status: string, notes: unknown): Promise<unknown>;
    createInspection(roomId: string, inspectedBy: string, checklistResults: unknown): Promise<unknown>;
    startTurnaround(bookingId: string): Promise<unknown>;
    completeTurnaround(turnaroundId: string): Promise<unknown>;
    getTurnaroundTimes(startDate: string, endDate: string): Promise<unknown>;
    getProductivity(startDate: string, endDate: string): Promise<unknown>;
    getChecklistItems(): Promise<unknown>;
    createChecklistItem(data: unknown): Promise<unknown>;
    updateChecklistItem(id: string, data: unknown): Promise<unknown>;
    deleteChecklistItem(id: string): Promise<unknown>;
  };
  maintenanceEnterprise: {
    getAllPreventiveSchedules(): Promise<unknown>;
    createPreventiveSchedule(data: unknown): Promise<unknown>;
    updatePreventiveSchedule(id: string, data: unknown): Promise<unknown>;
    deletePreventiveSchedule(id: string): Promise<unknown>;
    getDuePreventive(date: string): Promise<unknown>;
    completePreventive(id: string, completedBy: string, notes: unknown): Promise<unknown>;
    setRoomOutOfOrder(roomId: string, startDate: string, reason: string, endDate: string, ticketId: string): Promise<unknown>;
    setRoomOutOfService(roomId: string, startDate: string, reason: string, endDate: string, ticketId: string): Promise<unknown>;
    returnRoomToService(downtimeId: string): Promise<unknown>;
    getRoomDowntimeHistory(roomId: string): Promise<unknown>;
    getMaintenanceDashboard(): Promise<unknown>;
    getDowntimeReport(startDate: string, endDate: string): Promise<unknown>;
  };
  assetRegistry: {
    getAssets(assetType: unknown, status: string): Promise<unknown>;
    createAsset(data: unknown): Promise<unknown>;
    updateAsset(id: string, data: unknown): Promise<unknown>;
    deleteAsset(id: string): Promise<unknown>;
    getMaintenanceHistory(assetId: string): Promise<unknown>;
    logMaintenance(assetId: string, ticketId: string, description: unknown, cost: unknown, vendorId: string): Promise<unknown>;
    getVendors(specialisation: unknown): Promise<unknown>;
    createVendor(data: unknown): Promise<unknown>;
    updateVendor(id: string, data: unknown): Promise<unknown>;
    deleteVendor(id: string): Promise<unknown>;
  };
  assetManagement: {
    getAssetCategories(): Promise<unknown>;
    createAssetCategory(data: unknown): Promise<unknown>;
    updateAssetCategory(id: string, data: unknown): Promise<unknown>;
    deleteAssetCategory(id: string): Promise<unknown>;
    getAssetWarranties(assetId: string): Promise<unknown>;
    createAssetWarranty(data: unknown): Promise<unknown>;
    updateAssetWarranty(id: string, data: unknown): Promise<unknown>;
    deleteAssetWarranty(id: string): Promise<unknown>;
    getAssetInspections(assetId: string): Promise<unknown>;
    createAssetInspection(data: unknown): Promise<unknown>;
    deleteAssetInspection(id: string): Promise<unknown>;
    getAssetAttachments(assetId: string): Promise<unknown>;
    createAssetAttachment(data: unknown): Promise<unknown>;
    deleteAssetAttachment(id: string): Promise<unknown>;
    getAssetCosts(assetId: string): Promise<unknown>;
    recordAssetCost(data: unknown): Promise<unknown>;
    getAssetCostSummary(startDate: string, endDate: string): Promise<unknown>;
    getPreventiveTemplates(categoryId: string): Promise<unknown>;
    createPreventiveTemplate(data: unknown): Promise<unknown>;
    updatePreventiveTemplate(id: string, data: unknown): Promise<unknown>;
    deletePreventiveTemplate(id: string): Promise<unknown>;
    getPreventiveAssignments(assetId: string, status: string): Promise<unknown>;
    createPreventiveAssignment(data: unknown): Promise<unknown>;
    completePreventiveAssignment(id: string, notes: unknown): Promise<unknown>;
    skipPreventiveAssignment(id: string, notes: unknown): Promise<unknown>;
    generatePreventiveAssignments(): Promise<unknown>;
    getAssetDashboard(): Promise<unknown>;
    setAssetRoomSellability(assetId: string, affectsSellability: unknown, sellabilityNotes: unknown): Promise<unknown>;
  };
  operationsCompliance: {
    createLinenStocktake(items: unknown): Promise<unknown>;
    getLinenDashboard(): Promise<unknown>;
    reportDamagedLinen(itemId: string, quantity: number, reason: string): Promise<unknown>;
    chargeDamagedLinen(bookingId: string, linenItemId: string, quantity: number, amount: number): Promise<unknown>;
    claimLostFoundItem(itemId: string, claimerName: string, claimerContact: unknown, disposition: unknown): Promise<unknown>;
    getLostFoundDashboard(): Promise<unknown>;
    resolveIncident(id: string, resolution: unknown, resolvedBy: string): Promise<unknown>;
    getIncidentDashboard(): Promise<unknown>;
    getVisitorDashboard(): Promise<unknown>;
    getVisitorHistory(startDate: string, endDate: string): Promise<unknown>;
    getEvacuationList(): Promise<unknown>;
    exportEvacuationReport(): Promise<unknown>;
    createShiftHandover(data: unknown): Promise<unknown>;
    completeShiftHandover(id: string): Promise<unknown>;
    getShiftHandoverHistory(): Promise<unknown>;
  };
  incidents: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
  };
  visitors: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    checkout(id: string): Promise<unknown>;
  };
  linen: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    getBatches(): Promise<unknown>;
    createBatch(data: unknown): Promise<unknown>;
  };
  channelManager: {
    getDashboard(): Promise<unknown>;
    getMappings(): Promise<unknown>;
    createMapping(channelKey: string, sourceType: unknown, localId: string, channelCode: string, channelName: string): Promise<unknown>;
    updateMapping(id: string, channelCode: string, channelName: string): Promise<unknown>;
    deleteMapping(id: string): Promise<unknown>;
    getConfigs(): Promise<unknown>;
    createConfig(channelKey: string, channelLabel: unknown, enabled: boolean, syncAvailability: unknown, syncRates: unknown, importReservations: unknown): Promise<unknown>;
    updateConfig(id: string, payload: unknown): Promise<unknown>;
    enableChannel(channelKey: string): Promise<unknown>;
    disableChannel(channelKey: string): Promise<unknown>;
    processSyncQueue(channelKey: string): Promise<unknown>;
    pushAvailability(channelKey: string, payload: unknown): Promise<unknown>;
    pushRates(channelKey: string, payload: unknown): Promise<unknown>;
    fetchReservations(channelKey: string, since: unknown): Promise<unknown>;
    importReservation(payload: unknown): Promise<unknown>;
    confirmImport(importId: string): Promise<unknown>;
    rejectImport(importId: string, reason: string): Promise<unknown>;
  };
  documentSystem: {
    getTemplates(): Promise<unknown>;
    createTemplate(templateKey: string, name: string, documentType: unknown, contentTemplate: unknown, variables: unknown, branding: unknown, numberingPrefix: unknown): Promise<unknown>;
    updateTemplate(id: string, payload: unknown): Promise<unknown>;
    deleteTemplate(id: string): Promise<unknown>;
    renderDocument(templateKey: string, subjectType: unknown, subjectId: string): Promise<unknown>;
    publishDocument(documentId: string): Promise<unknown>;
    getDocumentHistory(subjectType: unknown, subjectId: string): Promise<unknown>;
    getDocumentDashboard(): Promise<unknown>;
  };
  hotelRoles: {
    getTemplates(): Promise<unknown>;
    getRoleCapabilities(roleKey: string): Promise<unknown>;
  };
  guestMessaging: {
    getTemplates(): Promise<unknown>;
    createTemplate(data: unknown): Promise<unknown>;
    updateTemplate(id: string, data: unknown): Promise<unknown>;
    deleteTemplate(id: string): Promise<unknown>;
    getTriggers(): Promise<unknown>;
    createTrigger(data: unknown): Promise<unknown>;
    updateTrigger(id: string, data: unknown): Promise<unknown>;
    deleteTrigger(id: string): Promise<unknown>;
    renderTemplate(templateId: string, variables: unknown): Promise<unknown>;
    getDeliveryStatus(status: string): Promise<unknown>;
    getChannelReadiness(channel: string): Promise<unknown>;
    dispatchMessage(messageId: string, options: unknown): Promise<unknown>;
  };
  guestPortal: {
    getConfig(): Promise<unknown>;
    updateConfig(config: unknown): Promise<unknown>;
    createSession(email: string, bookingRef: unknown): Promise<unknown>;
    validateSession(token: string): Promise<unknown>;
    getPendingRequests(): Promise<unknown>;
  };
  guestCRM: {
    getProfile(customerId: string): Promise<unknown>;
    updateProfile(customerId: string, data: unknown): Promise<unknown>;
    setVipLevel(customerId: string, level: unknown): Promise<unknown>;
    addPreference(customerId: string, key: string, value: unknown): Promise<unknown>;
    setBlacklist(customerId: string, blacklisted: unknown, reason: string): Promise<unknown>;
    getStayHistory(customerId: string): Promise<unknown>;
    recordConsent(customerId: string, consentType: unknown, granted: unknown): Promise<unknown>;
    search(query: string): Promise<unknown>;
    getVipList(): Promise<unknown>;
    listNotes(customerId: string): Promise<unknown>;
    addNote(customerId: string, noteText: unknown, noteType: unknown): Promise<unknown>;
  };
  nightAudit: {
    runChecks(): Promise<unknown>;
    close(closedBy: string, notes: unknown, force?: unknown): Promise<unknown>;
    reopen(closeId: string, reopenedBy: string, reason: string): Promise<unknown>;
    getSummary(date: string): Promise<unknown>;
    getHistory(limit: number): Promise<unknown>;
    resolveException(exceptionId: string, resolvedBy: string, notes: unknown): Promise<unknown>;
  };
  checkinWorkflow: {
    getChecklist(bookingId: string): Promise<unknown>;
    completeStep(stepId: string, completedBy: string, data: unknown): Promise<unknown>;
    resetStep(stepId: string): Promise<unknown>;
    getConfig(): Promise<unknown>;
    updateConfig(config: unknown): Promise<unknown>;
    completeHotelCheckin(bookingId: string): Promise<unknown>;
    completeHotelCheckinWithOverride(bookingId: string, overrideReason: string): Promise<unknown>;
  };
  checkoutWorkflow: {
    getChecklist(bookingId: string): Promise<unknown>;
    completeStep(stepId: string, completedBy: string, data: unknown): Promise<unknown>;
    resetStep(stepId: string): Promise<unknown>;
    completeHotelCheckout(bookingId: string): Promise<unknown>;
  };
  earlyLateCheckout: {
    getEarlyPolicies(): Promise<unknown>;
    createEarlyPolicy(data: unknown): Promise<unknown>;
    updateEarlyPolicy(id: string, data: unknown): Promise<unknown>;
    deleteEarlyPolicy(id: string): Promise<unknown>;
    getLatePolicies(): Promise<unknown>;
    createLatePolicy(data: unknown): Promise<unknown>;
    updateLatePolicy(id: string, data: unknown): Promise<unknown>;
    deleteLatePolicy(id: string): Promise<unknown>;
    getEarlyRequests(): Promise<unknown>;
    createEarlyRequest(bookingId: string, policyId: string, time: string): Promise<unknown>;
    approveEarlyRequest(id: string): Promise<unknown>;
    rejectEarlyRequest(id: string): Promise<unknown>;
    getLateRequests(): Promise<unknown>;
    createLateRequest(bookingId: string, policyId: string, time: string): Promise<unknown>;
    approveLateRequest(id: string): Promise<unknown>;
    rejectLateRequest(id: string): Promise<unknown>;
    calculateEarlyFee(bookingId: string, time: string): Promise<unknown>;
    calculateLateFee(bookingId: string, time: string): Promise<unknown>;
  };
  cancellationPolicies: {
    getAll(): Promise<unknown>;
    create(data: unknown): Promise<unknown>;
    update(id: string, data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    calculateFee(bookingId: string, reason: string): Promise<unknown>;
    process(requestId: string, approvedBy: string): Promise<unknown>;
    getRequests(): Promise<unknown>;
    approve(requestId: string, approvedBy: string): Promise<unknown>;
  };
  bookingEngine: {
    calculatePrice(roomTypeId: string, checkIn: unknown, checkOut: unknown, numGuests: unknown): Promise<unknown>;
    checkAvailability(roomTypeId: string, checkIn: unknown, checkOut: unknown, numRooms: unknown): Promise<unknown>;
    getUpsells(roomTypeId: string, checkIn: unknown, checkOut: unknown, numGuests: unknown): Promise<unknown>;
    createIntent(roomTypeId: string, checkIn: unknown, checkOut: unknown, numGuests: unknown, priceEstimate: unknown, options: unknown): Promise<unknown>;
    confirmIntent(intentOrId: string, confirmation: unknown): Promise<unknown>;
    getRules(): Promise<unknown>;
    createRule(data: unknown): Promise<unknown>;
    updateRule(id: string, data: unknown): Promise<unknown>;
    deleteRule(id: string): Promise<unknown>;
    getUpsellsList(): Promise<unknown>;
    createUpsell(data: unknown): Promise<unknown>;
    updateUpsell(id: string, data: unknown): Promise<unknown>;
    deleteUpsell(id: string): Promise<unknown>;
  };
  restaurantAccountingV2: {
    invoke<K extends keyof RestaurantAccountingArguments>(operation: K, ...args: RestaurantAccountingArguments[K]): Promise<unknown>;
    exportFile(payload: unknown): Promise<unknown>;
  };
  abandonedPayments: {
    logSession(bookingId: string, amount: number, provider: string, sessionToken: string, expiresAt: string): Promise<unknown>;
    getSessions(statusFilter: unknown): Promise<unknown>;
    recoverSession(sessionToken: string): Promise<unknown>;
    expireSessions(): Promise<unknown>;
    getPendingRecovery(): Promise<unknown>;
  };
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
