import type { AdminNotificationRecord, DesktopApi, IpcFailure } from '../../../src/renderer/src/types/desktop-api';

declare const api: DesktopApi;

api.updates.onProgress((progress) => {
  // @ts-expect-error -- updater progress counters are numbers from the main event producer.
  const invalidProgressCounter: string = progress.bytesPerSecond;
  void invalidProgressCounter;
});

// @ts-expect-error -- payment IPC requires all four positional arguments.
api.bookings.updatePayment('booking-1', 10, 'cash');
// @ts-expect-error -- stock delta is a number, not a formatted string.
api.inventory.adjustStock('item-1', '-1', 'count correction', '1234', 'adjust-op-1');
// @ts-expect-error -- only registered accounting operations are accepted.
api.restaurantAccountingV2.invoke('unregisteredMutation');
// @ts-expect-error -- an accounting operation must use its registered tuple.
api.restaurantAccountingV2.invoke('getManualJournalSubmissionStatus');

const badVersion: number = api.app.getVersion();
void badVersion;

declare const ipcFailure: IpcFailure;
// @ts-expect-error -- caught error messages are unknown until narrowed.
const failureMessage: string = ipcFailure.error;
void failureMessage;

// @ts-expect-error -- payment results forwarded from the database/RPC remain unknown.
const paymentRows: Promise<AdminNotificationRecord[]> = api.bookings.updatePayment('booking-1', 10, 'cash', 'payment-op-1');
// @ts-expect-error -- raw notification RPC rows require runtime validation before use.
const notificationRows: Promise<AdminNotificationRecord[]> = api.admin.getNotifications({});
// @ts-expect-error -- the count RPC is unvalidated and may not be a number.
const unreadCount: Promise<number> = api.admin.getUnreadCount();
// @ts-expect-error -- dropped-file path lookup requires an actual File-compatible browser object.
api.import.getDroppedFilePath({ path: 'C:/tmp/report.csv' });
// @ts-expect-error -- both preload aliases share the same exact app-version producer result.
const badUpdateVersion: Promise<number> = api.updates.getVersion();
void paymentRows;
void notificationRows;
void unreadCount;
void badUpdateVersion;

// @ts-expect-error -- update notification version is a PostgreSQL text value.
api.admin.pushUpdateNotification(1, 'Maintenance release', false);
// @ts-expect-error -- update notification p_force is a PostgreSQL boolean.
api.admin.pushUpdateNotification('1.2.3', 'Maintenance release', 1);

type HardwareSettingsResult = Awaited<ReturnType<typeof api.pos.getHardwareSettings>>;
// @ts-expect-error -- hardware IPC returns a constructed record or its empty-object catch fallback.
const numericHardwareResult: HardwareSettingsResult = 42;
// @ts-expect-error -- the empty-object catch fallback does not admit primitive strings.
const stringHardwareResult: HardwareSettingsResult = 'not a settings object';
type OfflineModeResult = Awaited<ReturnType<typeof api.sync.getOfflineMode>>;
// @ts-expect-error -- the offline-mode IPC result must include its exact state/journal or catch fallback.
const incompleteOfflineModeResult: OfflineModeResult = { enabled: true };
type ShellOpenExternalResult = Awaited<ReturnType<typeof api.shell.openExternal>>;
// @ts-expect-error -- success response has no error field; rejection carries a string error.
const malformedShellResult: ShellOpenExternalResult = { success: true, error: 'unexpected' };
void incompleteOfflineModeResult;
void malformedShellResult;
declare const barcodeScannerResult: Awaited<ReturnType<typeof api.pos.verifyBarcodeScanner>>;
if (!barcodeScannerResult.success) {
  // @ts-expect-error -- scanner IPC errors remain unknown until narrowed.
  const unvalidatedScannerError: string = barcodeScannerResult.error;
  void unvalidatedScannerError;
}
void numericHardwareResult;
void stringHardwareResult;

declare const syncDetailsResult: Awaited<ReturnType<typeof api.sync.getDetails>>;
// @ts-expect-error -- queue rows remain unknown until the consumer validates them.
const unvalidatedQueueRow: string = syncDetailsResult.pending[0];
void unvalidatedQueueRow;

declare const syncStatusResult: Awaited<ReturnType<typeof api.sync.getStatus>>;
if ('financialPendingBookingIds' in syncStatusResult) {
  // @ts-expect-error -- IDs selected from persisted queue data remain unknown.
  const unvalidatedBookingId: string = syncStatusResult.financialPendingBookingIds[0];
  void unvalidatedBookingId;
}

// @ts-expect-error -- Node globals are excluded from the browser renderer profile.
const processVersion = process.version;
// @ts-expect-error -- Node globals are excluded from the browser renderer profile.
const bufferValue = Buffer.from('renderer');
// @ts-expect-error -- Electron IPC objects are not exposed in renderer code.
ipcRenderer.invoke('auth:login', 'operator@example.test', 'secret');
void processVersion;
void bufferValue;
