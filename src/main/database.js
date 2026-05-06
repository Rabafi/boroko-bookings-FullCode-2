export {
  getSystemHealth,
  getSupportBundle,
  getOfflineSafetyData,
  publishDeviceHealth,
  getDeviceHealthRollup
} from './domains/health.js'

// FACADE ONLY.
// Business logic lives in src/main/domains/.
// Do not add new logic here.

export {
  initDatabase
} from './domains/infrastructure.js'
export {
  getProfiles,
  getActiveProfile,
  selectProfile,
  createDraftProfile,
  removeDraftProfile
} from './domains/profiles.js'
export {
  clearBackendSession,
  getUserPosOutletFilter,
  setCurrentUser,
  getCurrentUser,
  logoutCurrentUser,
  restoreUserSession,
  restoreSavedTrustedSession,
  validateCurrentSession,
  createSessionNonce,
  sendPasswordResetEmail,
  sendUserInviteOrReset,
  loginUser,
  getAllUsers,
  getUsers,
  getUserById,
  runAuthHealthCheck,
  createUser,
  updateUser,
  resetUserPassword,
  getAuthStatus,
  deleteUser
} from './domains/auth.js'
export {
  getSyncStatus,
  clearHealthFault,
  getSyncDetails,
  retrySyncItems,
  clearSyncFailed,
  runSyncNow
} from './domains/sync.js'
export {
  getAllRooms,
  getRoomById,
  createRoom,
  updateRoom,
  updateRoomHousekeeping,
  deleteRoom
} from './domains/rooms.js'
export {
  getAllCustomers,
  createCustomer,
  updateCustomerBlacklist,
  getCustomerBookings,
  updateCustomer,
  updateCustomerIdPhoto,
  getCustomerById
} from './domains/customers.js'
export {
  getInventoryItems,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  addInventoryPurchase,
  getInventoryPurchases,
  getAllInventoryPurchases,
  adjustInventoryStock,
  getInventoryStocktakes,
  createInventoryStocktakeSession,
  getInventoryStocktakeSession,
  getInventoryStocktakeById,
  saveInventoryStocktakeCounts,
  postInventoryStocktakeSession,
  getInventorySpend,
  getLowStockItems
} from './domains/inventory.js'
export {
  getAllBookings,
  getBookingById,
  getPendingOnlineBookings,
  getBookingsByDateRange,
  createBooking,
  updateBooking,
  updateBookingStatus,
  updateBookingPayment,
  getBookingPayments,
  refundBooking,
  createEventBooking,
  getBookingCharges,
  getBookingChargeById,
  addBookingCharge,
  deleteBookingCharge,
  getRateOverrides,
  getRateOverrideById,
  createRateOverride,
  updateRateOverride,
  deleteRateOverride,
  getApplicableRate,
  getActiveBookingForRoom,
  getBookingInvoices,
  getAllQuotations,
  createQuotation,
  updateQuotation,
  markQuotationSent,
  duplicateQuotation,
  getQuotationById,
  convertQuotationToBooking
} from './domains/bookings.js'
export {
  getExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getAdminExpenses,
  createAdminExpense,
  updateAdminExpense,
  deleteAdminExpense
} from './domains/expenses.js'
export {
  getMaintenanceTickets,
  getMaintenanceTicketById,
  createMaintenanceTicket,
  updateMaintenanceTicket,
  resolveMaintenanceTicket,
  getMaintenanceRowsForPeriod
} from './domains/maintenance.js'
export {
  getPosMenuItems,
  getPosMenuItemById,
  createPosMenuItem,
  updatePosMenuItem,
  deletePosMenuItem,
  setBarPosPackTemplate,
  getPosOrders,
  getPosVoidHistory,
  getOutlets,
  getPosOrderById,
  createPosOrder,
  voidPosOrder,
  approvePosVoidWithPin,
  getPosRevenueSummary
} from './domains/pos.js'
export {
  getSupplyItems,
  getSupplyItemById,
  createSupplyItem,
  updateSupplyItem,
  deleteSupplyItem,
  addSupplyPurchase,
  getSupplyPurchases,
  getAllSupplyPurchases,
  saveRoomSupplyAllocations,
  getRoomSupplyAllocations,
  getSupplyAllocationsForWeek,
  adjustSupplyStock,
  getRoomSupplyStock,
  loadSupplyToRoom,
  useSupplyInRoom,
  returnSupplyFromRoom,
  getSupplyMovements,
  getSupplyStocktakes,
  getRoomSupplyStocktakes,
  createSupplyStocktakeSession,
  createRoomSupplyStocktakeSession,
  getSupplyStocktakeSession,
  getSupplyStocktakeById,
  getRoomSupplyStocktakeSession,
  getRoomSupplyStocktakeById,
  saveSupplyStocktakeCounts,
  saveRoomSupplyStocktakeCounts,
  postSupplyStocktakeSession,
  postRoomSupplyStocktakeSession,
  addRoomSupplyStocktakeLine,
  getSupplySpend
} from './domains/supplies.js'
export {
  getOccupancyReport,
  getRevenueReport,
  getTodayBookingPaymentMix,
  getProfitLoss,
  getReportsSnapshot,
  getOutletProfitLoss,
  getDashboardStats,
  getTodayActivity,
  getUpcomingCheckins,
  getForecast,
  getRoomProfitabilityReport,
  getNightAudit
} from './domains/reports.js'
export {
  getSettings,
  getLodgeDiagnostics,
  relinkLodge,
  resetToNewLodge,
  saveSettings,
  initializeCompanySetup
} from './domains/settings.js'
export {
  getUsageLimitSnapshot,
  getTrialStatus,
  activateLicenseKey
} from './domains/subscriptions.js'
export {
  getConferenceBookings,
  getConferenceBookingById,
  createConferenceBooking,
  updateConferenceBooking,
  updateConferenceBookingPayment,
  deleteConferenceBooking
} from './domains/conference.js'
export {
  getPoolDayUse,
  getPoolDayUseById,
  addPoolDayUse,
  deletePoolDayUse,
  getPoolDayUseSummary
} from './domains/pool.js'
export {
  checkMasterAdmin,
  masterAdminExists,
  createMasterAdmin,
  getAllCompanies,
  updateCompany,
  archiveCompany,
  restoreCompany,
  permanentlyDeleteCompany,
  repairDuplicateEventBookings,
  getCompanyUsers,
  resetCompanyUserPassword,
  updateCompanyUserPwaAccess,
  getLicenses,
  createLicense,
  issueSubscriptionContract,
  updateLicense,
  deleteLicense,
  getBroadcasts,
  getActiveBroadcasts,
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
  getLodgeFeatures,
  setLodgeFeature,
  clearLodgeFeature,
  getAllLodgeFeatures,
  getTestDataResetPreview,
  runTestDataReset,
  getTestDataResetAudit,
  getSupportTickets,
  createSupportTicket,
  getLodgeSupportTickets,
  getLodgeSupportTicketById,
  updateLodgeSupportTicket,
  updateSupportTicket,
  deleteSupportTicket,
  getActivityLogs,
  getCompanyStats,
  updateLicenseBilling,
  getOverdueLicenses
} from './domains/admin.js'
export {
  getFinancialAuditLog,
  getFinancialReconciliation,
  getFinancialValidationSummary,
  recordInvoiceDelivery,
  getInvoiceDeliveryHistory,
  runFinancialValidation,
  getFinancialValidationAlerts,
  getFinancialValidationRuns,
  runScheduledFinancialValidation,
  getNextInvoiceNumber,
  createInvoice,
  getInvoices,
  getInvoicesByLodge,
  updateInvoice,
  deleteInvoice,
  getInvoiceSummary
} from './domains/finance.js'
export {
  recordActivity,
  getActivityLog,
  clearActivityLog,
  getManagedBackupPolicy,
  saveManagedBackupPolicy,
  recordManagedBackupRun,
  getBackupInfo,
  verifyLocalBackup,
  previewLocalBackupRestore,
  createRestoreRehearsalPackage,
  writeExpandedBackupToPath,
  createManualBackup,
  getCriticalErrorLog,
  clearCriticalErrorLog,
  getSupportedImportTypes,
  generateImportTemplate,
  checkImportDuplicates,
  dryRunBookingImport,
  dryRunImport,
  bulkImportBookings,
  bulkImportTyped,
  getImportBatches,
  undoImportBatch
} from './domains/misc.js'
