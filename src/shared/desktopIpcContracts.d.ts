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
  'admin:markNotificationsRead': AdminNotificationsReadResult;
  'admin:cleanupNotifications': AdminNotificationsCleanupResult;
  'shell:openExternal': ShellOpenExternalResult;
  'sync:getStatus': SyncStatusSnapshot;
  'sync:getDetails': SyncDetailsResult;
  'sync:getOfflineMode': SyncOfflineModeResult;
  'sync:setOfflineMode': SyncOfflineModeWriteResult;
  'pos:getHardwareSettings': PosHardwareSettingsResult;
  'pos:verifyBarcodeScanner': BarcodeScannerVerificationResult;
  /** Raw JSONB from the global-search RPC; shape is not validated in main. */
  'admin:globalSearch': unknown;
  /** The AI turn may wrap unvalidated model/tool/RPC data in several branches. */
  'ai:turn': unknown;
}

export type DesktopIpcChannel = keyof DesktopIpcResultContracts;
export type DesktopIpcResult<Channel extends DesktopIpcChannel> = DesktopIpcResultContracts[Channel];
