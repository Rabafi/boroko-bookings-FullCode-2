/**
 * Finite, source-backed desktop IPC result descriptions shared by main,
 * preload and renderer. These declarations describe contracts; they do not
 * validate values crossing Electron IPC or Supabase/cache boundaries.
 */
/**
 * A main-process read helper's array after it has added its transport metadata.
 * The array container is known, but its row values and source label remain
 * unvalidated. `_complete` is guaranteed boolean because the helper normalizes
 * it with `complete === true` before defining the property.
 */
export type ReadMetadataRows = unknown[] & {
  readonly _source: unknown;
  readonly _complete: boolean;
};

/**
 * Outer result constructed by the main POS read-failure helper. The error text
 * and empty rows are transported as-is; this type does not validate upstream
 * cache/RPC data or make an empty success result authoritative.
 */
export interface UnavailablePosRead {
  _available: false;
  _source: 'unavailable';
  _label: string;
  _error: unknown;
  rows: unknown[];
}


export type AuthLoginResult =
  | { ok: true; code: null; user: unknown; mode: unknown; warning: unknown }
  | { ok: false; code: unknown; error: unknown; memberships?: unknown };

export type AuthLogoutResult = { ok: true };

export interface ProductInfo {
  id: string;
  name: string;
  brandName: string;
  shortName: string;
  businessNoun: string;
  businessNounTitle: string;
  businessNounPlural: string;
  tagline: string;
  loginTagline: string;
  allowedPropertyTypes: readonly string[];
  hospitalityModes: readonly string[];
  allowedRoutePrefixes: readonly string[];
  defaultHome: string;
  theme: unknown;
  releaseRepo: string;
}

/** Array membership is guarded by the main handler; item records remain unknown. */
export interface InventoryItemsReadStatus {
  items: unknown[];
  source: unknown;
  complete: boolean;
}

export interface AdminNotificationsReadResult {
  count: unknown;
}

/** Main returns numeric sums from the database query or the same zero summary in its catch branch. */
export interface BookingCollectionsSummary {
  count: number;
  amount: number;
}

/**
 * Expected profile data returned by the local profile registry. The registry
 * originates in JSON and is normalized by the main profile producer; this
 * declaration does not validate values at the IPC boundary.
 */
export interface DesktopProfileReadView {
  lodge_id: string;
  label: string;
  status: string;
  created_at: unknown;
  last_used_at: unknown;
}

export interface DesktopProfileListReadView extends DesktopProfileReadView {
  active: boolean;
}

export interface DesktopProfileSettingsReadView {
  lodge_id: string | null;
}

export type DesktopProfileSelectionDataReadView =
  | (DesktopProfileReadView & { settings: DesktopProfileSettingsReadView })
  | { settings: DesktopProfileSettingsReadView };

export type DesktopProfileSelectResult =
  | { success: true; data: DesktopProfileSelectionDataReadView }
  | { success: false; error: unknown };

export type DesktopProfileCreateDraftResult =
  | { success: true; data: DesktopProfileReadView }
  | { success: false; error: unknown };

export type DesktopProfileRemoveDraftResult =
  | {
      success: true;
      active_profile: DesktopProfileReadView | null;
      profiles: DesktopProfileListReadView[];
    }
  | { success: false; code: unknown; error: unknown };

/** Expected mapped booking projection; its Supabase/cache origin is not validated here. */
export interface PendingOnlineBookingReadView extends Record<string, unknown> {
  id: string;
  source?: string | null | undefined;
  status?: string | null | undefined;
  customer_name?: unknown;
  customer_phone?: unknown;
  customer_email?: unknown;
  room_number?: unknown;
  room_type?: unknown;
}

/** Expected open-shift row from the existing query/cache producer; no IPC validation is implied. */
export interface DesktopPosCurrentShiftReadView extends Record<string, unknown> {
  id: string;
  status?: string | null;
  cashier_name?: string | null;
  opened_at?: string | null;
  opening_float?: unknown;
}

/** Backup policy fields produced by normalizeManagedBackupPolicy/buildManagedBackupStatus. */
export interface ManagedBackupStatusReadView {
  enabled: boolean;
  target_dir: string;
  export_json: boolean;
  export_excel: boolean;
  frequency_days: number;
  last_run_at: unknown;
  last_success_at: unknown;
  last_error: string;
  last_json_path: string;
  last_excel_path: string;
  enforcement_level: 'reminder' | 'warning' | 'strict';
  next_due_at: string | null;
  overdue: boolean | null;
  requires_setup: boolean;
  has_recent_success: boolean;
  compliance_state: 'setup_required' | 'overdue' | 'healthy' | 'pending_first_run' | 'disabled';
}

/** The backup handler returns local file metadata and normalized policy, or its capability-failure empty envelope. */
export type BackupInfoReadResult =
  | {
      backupDir: string;
      backups: Array<{ name: string; size: number; created: string }>;
      policy: ManagedBackupStatusReadView;
    }
  | { backupDir: null; backups: []; policy?: undefined };

/** The external URL handler reports a protocol rejection or successful shell call. */
export type ShellOpenExternalResult =
  | { success: false; error: string }
  | { success: true };

export interface SyncGroupedCounts {
  missing_parent: number;
  blocked_dependencies: number;
  financial_risk_items: number;
  failed_items: number;
  pending_items: number;
}

/**
 * Main sync:retryFailed success fields are built by retrySyncItems; failures
 * preserve the existing IPC catch message. This describes the producer shape
 * and does not validate values transported through Electron IPC.
 */
export type SyncRetryResult =
  | { success: true; retried: number; remaining: number }
  | { success: false; error: unknown };

/**
 * Main sync:clearFailed success fields are built by clearSyncFailed; failures
 * preserve the existing IPC catch message. This describes the producer shape
 * and does not validate values transported through Electron IPC.
 */
export type SyncClearFailedResult =
  | { success: true; removed: number; financialCleared: number; integrityAlertsRecorded: number; remaining: number }
  | { success: false; error: unknown };

/** `enabled` and `reason` are normalized; persisted timestamps/path stay unknown. */
export type SyncOfflineModeSnapshot =
  | {
      enabled: false;
      reason: '';
      startedAt: null;
      endedAt: null;
      acknowledgedRisksAt: null;
      lastBackupAt: null;
      lastBackupPath: null;
    }
  | {
      enabled: boolean;
      reason: string;
      startedAt: unknown;
      endedAt: unknown;
      acknowledgedRisksAt: unknown;
      lastBackupAt: unknown;
      lastBackupPath: unknown;
      updatedAt: unknown;
      updatedBy: unknown;
    };

/** Summary counters are constructed; parsed event/operation values remain unknown. */
export interface SyncOperationJournalSummary {
  total: number;
  truncated: boolean;
  limit: number;
  fileSizeBytes: number | null;
  oldestAt: unknown;
  newestAt: unknown;
  byEvent: Record<string, unknown>;
  byOperation: Record<string, unknown>;
  file: string | null;
}

/** Constructed outer snapshot; queue IDs and persisted metadata remain unvalidated. */
export interface FullSyncStatusSnapshot {
  pending: number;
  failed: number;
  currentQueueLength: number;
  currentDeadLetterWrites: number;
  isOnline: boolean;
  syncInProgress: boolean;
  replayAuthReady: boolean;
  failedBookingIds: unknown[];
  financialPendingBookingIds: unknown[];
  financialFailedBookingIds: unknown[];
  financialPendingCount: number;
  financialFailedCount: number;
  groupedCounts: SyncGroupedCounts;
  offlineMode: SyncOfflineModeSnapshot;
  operationJournal: SyncOperationJournalSummary;
  lastSuccessfulSyncAt: unknown;
  syncMeta: {
    lastSyncStartedAt: unknown;
    lastSyncFinishedAt: unknown;
    lastSyncOutcome: unknown;
    lastSyncError: unknown;
    replayAuthNotReadyAt: unknown;
  };
  faults: unknown[];
  cacheStale: {
    active: boolean;
    names: unknown[];
    attempts: number;
    lastError: unknown;
    lastFailedAt: unknown;
  };
  mesh: unknown;
}

/** The main handler's error fallback intentionally omits snapshot-only fields. */
export type SyncStatusSnapshot = FullSyncStatusSnapshot | { pending: number; failed: number; isOnline: false };

/** Main handler returns the constructed state/journal or its explicit access/error fallback. */
export type SyncOfflineModeResult =
  | (SyncOfflineModeSnapshot & { operationJournal: SyncOperationJournalSummary })
  | { enabled: false; error: unknown };

/** State write adds updatedAt while preserving the normalized offline-mode projection. */
export type SyncOfflineModeWriteSnapshot = SyncOfflineModeSnapshot & { updatedAt: unknown };

export type SyncOfflineModeWriteResult =
  | { success: true; offlineMode: SyncOfflineModeWriteSnapshot }
  | { success: false; error: unknown };

/** Constructed aggregate from locally persisted queues; individual entries remain raw. */
export interface SyncDetailsSnapshot {
  isOnline: boolean;
  syncInProgress: boolean;
  replayAuthReady: boolean;
  pendingCount: number;
  failedCount: number;
  lastSuccessfulSyncAt: unknown;
  syncMeta: {
    lastSyncStartedAt: unknown;
    lastSyncFinishedAt: unknown;
    lastSyncOutcome: unknown;
    lastSyncError: unknown;
  };
  financialPendingBookingIds: unknown[];
  financialFailedBookingIds: unknown[];
  unresolvedLocal: {
    total: number;
    length: number;
    bookings: { count: number; ids: unknown[] };
    customers: { count: number; ids: unknown[] };
    rooms: { count: number; ids: unknown[] };
    users: { count: number; ids: unknown[] };
    quotations: { count: number; ids: unknown[] };
    posOrders: { count: number; ids: unknown[] };
    conferenceBookings: { count: number; ids: unknown[] };
    poolDayUse: { count: number; ids: unknown[] };
    inventoryItems: { count: number; ids: unknown[] };
  };
  financialPendingCount: number;
  financialFailedCount: number;
  groupedCounts: SyncGroupedCounts;
  pending: unknown[];
  failed: unknown[];
  faults: unknown[];
  offlineMode: SyncOfflineModeSnapshot;
  operationJournal: SyncOperationJournalSummary;
  cacheFreshness: Record<string, unknown>;
  cacheStale: {
    active: boolean;
    names: unknown[];
    attempts: number;
    lastError: unknown;
    lastFailedAt: unknown;
  };
}

/** The main handler returns only queue arrays when access or snapshot production fails. */
export type SyncDetailsResult = SyncDetailsSnapshot | { pending: unknown[]; failed: unknown[] };

/** Fixed settings projection from the local cache; values copied with `||` stay unknown. */
export interface PosHardwareSettings {
  receipt_printer_name: unknown;
  receipt_paper_width: unknown;
  receipt_print_mode: unknown;
  auto_print_receipts: boolean;
  receipt_cut_enabled: boolean;
  cash_drawer_enabled: boolean;
  cash_drawer_manual: boolean;
  cash_drawer_command: unknown;
  cash_drawer_open_on_cash: boolean;
  cash_drawer_open_timing: unknown;
  cash_drawer_pin: unknown;
  cash_drawer_pulse_on_ms: unknown;
  cash_drawer_pulse_off_ms: unknown;
  escpos_enabled: boolean;
  escpos_connection_type: unknown;
  escpos_network_host: unknown;
  escpos_network_port: unknown;
  escpos_printer_path: unknown;
  escpos_codepage: unknown;
  escpos_timeout_ms: unknown;
  payment_terminal_provider: unknown;
  payment_terminal_name: unknown;
  payment_terminal_mode: unknown;
  payment_terminal_bridge_url: unknown;
  payment_terminal_timeout_ms: unknown;
  barcode_scanner_enabled: boolean;
  barcode_scanner_min_length: number;
  barcode_scanner_max_length: number;
  barcode_scanner_inter_key_ms: number;
  barcode_scanner_idle_complete_ms: number;
  barcode_scanner_accept_enter: boolean;
  barcode_scanner_accept_tab: boolean;
  barcode_scanner_prefix: string;
  barcode_scanner_suffix: string;
  barcode_scanner_sound_enabled: boolean;
  scanner_last_verified_at: unknown;
  scanner_last_terminator: string | null;
  scanner_last_character_count: number | null;
  scanner_last_average_inter_key_ms: number | null;
  hardware_last_test_at: unknown;
  hardware_last_test_kind: string;
  hardware_last_test_success: boolean;
  customer_display_enabled: boolean;
  display_welcome_message: string;
  display_customer_display_id: string;
  display_bar_display_id: string;
  display_kitchen_display_id: string;
  display_customer_auto_open: boolean;
  updated_at: unknown;
}

export type BarcodeScannerVerificationFailureCode =
  | 'scanner_disabled'
  | 'empty_scan'
  | 'scan_too_short'
  | 'scan_too_long'
  | 'invalid_characters';

/** The scanner verifier hashes the barcode and returns normalized verification metadata only. */
export type BarcodeScannerVerificationResult =
  | { success: false; error: unknown; code?: BarcodeScannerVerificationFailureCode }
  | {
      success: true;
      settings: PosHardwareSettings;
      verification: {
        verified_at: string;
        character_count: number;
        terminator: string | null;
        average_inter_key_ms: number | null;
      };
    };

/** The handler's error branch returns an empty object, with no settings fields. */
export type PosHardwareSettingsResult = PosHardwareSettings | (object & {
  [Key in keyof PosHardwareSettings]?: never;
});

/** Outer result built by createDailyChecklist or its SQL RPC; this contract does not validate checklist/cache data. */
export type PosChecklistCreateResult =
  | { success: true; offline: true; queued: true; id: string }
  | { success: true; checklist_id: string }
  | { success: false; error: unknown };

/** Result envelopes returned by the alert RPCs and main-process error branches; no row data is validated here. */
export type PosAlertRecordResult =
  | { success: true; alert_id: string; category: string; alert_type: string; outlet_id: string | null; created_by: string }
  | { success: false; error: unknown };
export type PosAlertResolutionResult =
  | { success: true; alert_id: string; resolved_by: string; resolved_at: string; operation_id: string; replayed?: boolean; error?: never }
  | { success: false; error: unknown; conflict?: boolean };

/** Summary fields emitted by generate_owner_digest. The values remain expected JSON data, not runtime-validated values. */
export interface PosOwnerDigestSummaryExpectedView {
  date: string;
  total_revenue: unknown;
  total_orders: number | string;
  avg_order?: unknown;
  pending_orders?: number | string;
  active_alerts: number | string;
  low_stock_items: number | string;
  open_checklists?: number | string;
}
export type PosOwnerDigestResult =
  | { success: true; digest: PosOwnerDigestSummaryExpectedView }
  | { success: false; error: unknown };

/** Metadata keys emitted by settings persistence; values are not runtime-validated. */
export interface SettingsSaveMetaExpectedView {
  persistence: unknown;
  online: unknown;
  pending: unknown;
  skippedColumns: unknown;
  warnings: unknown;
}
/** Outer result shape built by the settings:save IPC handler; saved settings and metadata contents remain unvalidated. */
export type SettingsSaveIpcResult =
  | { success: true; data: unknown; meta: SettingsSaveMetaExpectedView }
  | { success: false; error: unknown };

/** Successful branches constructed by refundBooking; RPC/cache identifiers and result payloads remain unvalidated. */
export type BookingRefundSuccessResult =
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
    };

export type AdminNotificationsCleanupResult =
  | { ok: true; count: unknown }
  | { ok: false; count: 0; error: unknown };

/**
 * Known channel results are finite and tied to handlers that construct these
 * outer shapes. The generic lookup below only indexes this map; it does not
 * assert that an arbitrary IPC/JSON value has been validated.
 */
export interface DesktopIpcResultContracts {
  'auth:login': AuthLoginResult;
  'auth:logout': AuthLogoutResult;
  'app:getVersion': string;
  'app:getProduct': ProductInfo;
  'inventory:getItemsWithReadStatus': InventoryItemsReadStatus;
  'bookings:getCollectionsSummary': BookingCollectionsSummary;
  'profiles:list': DesktopProfileListReadView[];
  'profiles:getActive': DesktopProfileReadView | null;
  'profiles:select': DesktopProfileSelectResult;
  'profiles:createDraft': DesktopProfileCreateDraftResult;
  'profiles:removeDraft': DesktopProfileRemoveDraftResult;
  'bookings:getPendingOnline': PendingOnlineBookingReadView[];
  'pos:getCurrentShift': DesktopPosCurrentShiftReadView | null;
  'backup:getInfo': BackupInfoReadResult;
  'admin:markNotificationsRead': AdminNotificationsReadResult;
  'admin:cleanupNotifications': AdminNotificationsCleanupResult;
  'shell:openExternal': ShellOpenExternalResult;
  'sync:getStatus': SyncStatusSnapshot;
  'sync:getDetails': SyncDetailsResult;
  'sync:getOfflineMode': SyncOfflineModeResult;
  'sync:setOfflineMode': SyncOfflineModeWriteResult;
  'sync:retryFailed': SyncRetryResult;
  'sync:clearFailed': SyncClearFailedResult;
  'pos:getHardwareSettings': PosHardwareSettingsResult;
  'pos:verifyBarcodeScanner': BarcodeScannerVerificationResult;
  'pos:createChecklist': PosChecklistCreateResult;
  'pos:recordAlert': PosAlertRecordResult;
  'pos:resolveAlert': PosAlertResolutionResult;
  'pos:generateOwnerDigest': PosOwnerDigestResult;
  'settings:save': SettingsSaveIpcResult;
  /** Raw JSONB from the global-search RPC; shape is not validated in main. */
  'admin:globalSearch': unknown;
  /** The AI turn may wrap unvalidated model/tool/RPC data in several branches. */
  'ai:turn': unknown;
}

export type DesktopIpcChannel = keyof DesktopIpcResultContracts;
export type DesktopIpcResult<Channel extends DesktopIpcChannel> = DesktopIpcResultContracts[Channel];
