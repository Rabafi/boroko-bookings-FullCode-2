const fs = require('fs');

const infraPath = 'src/main/domains/infrastructure.js';
let content = fs.readFileSync(infraPath, 'utf8');

content = content.replace("const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';", "export const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';");
content = content.replace("const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift'];", "export const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift'];");
content = content.replace("function readHealthFaults() {", "export function readHealthFaults() {");
content = content.replace("function getBackupInfoForHealth() {", "export function getBackupInfoForHealth() {");
content = content.replace("function getBackupHealthSummary(backupsInfo = getBackupInfoForHealth()) {", "export function getBackupHealthSummary(backupsInfo = getBackupInfoForHealth()) {");
content = content.replace("async function probeRpc(name, args = {}, options = {}) {", "export async function probeRpc(name, args = {}, options = {}) {");
content = content.replace("async function getLodgeDiagnostics(expectedLodgeId = '') {", "export async function getLodgeDiagnostics(expectedLodgeId = '') {");

const systemHealthStart = content.indexOf('export async function getSystemHealth() {');
const systemHealthEnd = content.indexOf('// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────');
const systemHealthBlock = content.slice(systemHealthStart, systemHealthEnd);
content = content.replace(systemHealthBlock, '');

const stubsStart = content.indexOf("async function getFinancialReconciliation(...args) {");
const stubsEnd = content.indexOf("// ─── CONFERENCE BOOKINGS ───────────────────────────────────────────────────────");
const remainingBlock = content.slice(stubsStart, stubsEnd);
content = content.replace(remainingBlock, '');

fs.writeFileSync(infraPath, content, 'utf8');

const healthContent = `import { app } from 'electron';
import crypto, { randomUUID } from 'crypto';
import { state } from '../state.js';

import {
  getFinancialReconciliation,
  getFinancialValidationSummary,
  getFinancialValidationRuns,
  getFinancialValidationAlerts
} from './finance.js';

import {
  checkOnline,
  getSyncStatus,
  getSyncDetails,
  readSyncMeta,
  SYNC_DRIFT_FAULT_TYPES,
  getBackupInfoForHealth,
  getBackupHealthSummary,
  readHealthFaults,
  createBookingIdempotencyKey,
  probeRpc,
  getLocalDateKey,
  LOCAL_TIME_ZONE,
  addDays,
  readCache,
  getLodgeDiagnostics,
  readAuxiliaryLog,
  CRITICAL_ERROR_LOG_FILE,
  isNonCriticalOperationalError
} from './infrastructure.js';

// --- Dynamic Stubs for getOfflineSafetyData ---
async function getAllBookings(...args) {
  return (await import('./' + 'bookings.js')).getAllBookings(...args);
}
async function getAllRooms(...args) {
  return (await import('./' + 'rooms.js')).getAllRooms(...args);
}
async function getAllCustomers(...args) {
  return (await import('./' + 'customers.js')).getAllCustomers(...args);
}
async function getInventoryItems(...args) {
  return (await import('./' + 'inventory.js')).getInventoryItems(...args);
}

// ─── HEALTH DIAGNOSTICS & OFFLINE SAFETY ───────────────────────────────────────

${systemHealthBlock}
function getCriticalErrorLogForSupport(limit = 100) {
  return readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).
  filter((entry) => !isNonCriticalOperationalError(entry?.scope, entry?.message)).
  slice(0, limit);
}

export async function getSupportBundle(limit = 20) {
  const systemHealth = await getSystemHealth().catch((error) => ({ error: error?.message || String(error) }));
  const syncStatus = getSyncStatus();
  const syncDetails = getSyncDetails();
  const reconciliation = await getFinancialReconciliation().catch((error) => ({ error: error?.message || String(error) }));
  const validation = await getFinancialValidationSummary().catch((error) => ({ error: error?.message || String(error) }));
  const validationRuns = await getFinancialValidationRuns(limit).catch(() => []);
  const validationAlerts = await getFinancialValidationAlerts(limit).catch(() => []);
  const criticalErrors = getCriticalErrorLogForSupport(limit);
  const syncMeta = readSyncMeta();
  const healthFaults = readHealthFaults().slice(0, Math.max(1, Number(limit) || 20));

  return {
    generated_at: new Date().toISOString(),
    lodge_id: state.lodgeId || null,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name || null,
    app_online: state.isOnline,
    system_health: systemHealth,
    sync_status: syncStatus,
    sync_details: syncDetails,
    syncMeta,
    healthFaults,
    financial_reconciliation: reconciliation,
    financial_validation: validation,
    financial_validation_runs: validationRuns,
    financial_validation_alerts: validationAlerts,
    critical_errors: criticalErrors
  };
}

export async function getOfflineSafetyData() {
  const today = getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
  const tomorrow = getLocalDateKey(addDays(new Date(), 1), LOCAL_TIME_ZONE);
  const bookings = await getAllBookings().catch(() => readCache('bookings'));
  const rooms = await getAllRooms().catch(() => readCache('rooms'));
  const customers = await getAllCustomers().catch(() => readCache('customers'));
  const inventoryItems = await getInventoryItems().catch(() => readCache('inventory-items'));

  const roomById = new Map((rooms || []).map((room) => [room.id, room]));
  const customerById = new Map((customers || []).map((customer) => [customer.id, customer]));
  const activeBookings = (bookings || []).filter((booking) => String(booking?.status || '').toLowerCase() !== 'cancelled');
  const enrichBooking = (booking) => {
    const room = roomById.get(booking.room_id) || {};
    const customer = customerById.get(booking.customer_id) || {};
    const total = Number(booking.total_amount || 0) + Number(booking.charges_total || 0);
    const paid = Number(booking.amount_paid || 0);
    return {
      booking_id: booking.id,
      booking_number: booking.booking_number || booking.invoice_number || '',
      guest_name: booking.customer_name || customer.name || '',
      room_number: booking.room_number || room.room_number || '',
      check_in: booking.check_in || '',
      check_out: booking.check_out || '',
      status: booking.status || '',
      payment_status: booking.payment_status || '',
      balance: Math.max(0, total - paid)
    };
  };

  return {
    generated_at: new Date().toISOString(),
    lodge_id: state.lodgeId || null,
    source: state.isOnline ? 'online' : 'offline-cache',
    arrivals: activeBookings.filter((booking) => booking.check_in === today).map(enrichBooking),
    departures: activeBookings.filter((booking) => booking.check_out === today).map(enrichBooking),
    in_house: activeBookings.filter((booking) => booking.check_in <= today && booking.check_out > today).map(enrichBooking),
    due_tomorrow: activeBookings.filter((booking) => booking.check_in === tomorrow || booking.check_out === tomorrow).map(enrichBooking),
    unpaid: activeBookings.
    filter((booking) => ['partial', 'unpaid', ''].includes(String(booking.payment_status || '').toLowerCase())).
    map(enrichBooking).
    filter((booking) => booking.balance > 0),
    low_stock: (inventoryItems || []).
    filter((item) => Number(item.reorder_level || 0) > 0 && Number(item.current_stock || 0) <= Number(item.reorder_level || 0)).
    map((item) => ({
      item_id: item.id,
      name: item.name || item.item_name || '',
      category: item.category || '',
      current_stock: Number(item.current_stock || 0),
      reorder_level: Number(item.reorder_level || 0),
      unit: item.unit || ''
    }))
  };
}

function getDesktopDeviceId() {
  try {
    const source = app?.getPath?.('userData') || state.cacheRootDir || 'boroko-desktop';
    return crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 24);
  } catch {
    return 'desktop-unknown';
  }
}

export async function publishDeviceHealth() {
  if (!state.isOnline || !state.lodgeId) return { success: false, skipped: true, error: 'Offline or lodge not selected.' };
  const details = getSyncDetails();
  const faults = readHealthFaults();
  const reconciliation = await getFinancialReconciliation().catch(() => ({ state: 'unknown' }));
  const topFaultTypes = [...new Set(faults.map((fault) => fault?.type).filter(Boolean))].slice(0, 10);
  const { data, error } = await state.supabase.rpc('upsert_device_health', {
    p_lodge_id: state.lodgeId,
    p_device_id: getDesktopDeviceId(),
    p_client_type: 'desktop',
    p_pending_queue_count: details.pendingCount || 0,
    p_failed_queue_count: details.failedCount || 0,
    p_unresolved_local_count: details.unresolvedLocal?.length || 0,
    p_replay_auth_ready: !!state.replayAuthReady,
    p_last_successful_sync_at: details.lastSuccessfulSyncAt || null,
    p_reconciliation_state: reconciliation?.state || 'unknown',
    p_top_fault_types: topFaultTypes,
    p_raw_summary: {
      pendingCount: details.pendingCount || 0,
      failedCount: details.failedCount || 0,
      unresolvedLocalCount: details.unresolvedLocal?.length || 0,
      driftFaultTypes: SYNC_DRIFT_FAULT_TYPES
    }
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not publish device health');
  return { success: true };
}

export async function getDeviceHealthRollup() {
  if (!state.isOnline || !state.lodgeId) return { available: false, devices: [] };
  await publishDeviceHealth().catch(() => {});
  const { data, error } = await state.supabase.rpc('get_device_health_rollup', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return { available: true, devices: Array.isArray(data) ? data : [] };
}
`;

fs.writeFileSync('src/main/domains/health.js', healthContent, 'utf8');

const miscPath = 'src/main/domains/misc.js';
let miscContent = fs.readFileSync(miscPath, 'utf8');
miscContent = miscContent.replace(/  getSystemHealth,\r?\n/, '');
fs.writeFileSync(miscPath, miscContent, 'utf8');

const financePath = 'src/main/domains/finance.js';
let financeContent = fs.readFileSync(financePath, 'utf8');
financeContent = financeContent.replace(/  getSupportBundle,\r?\n/, '');
financeContent = financeContent.replace(/  getOfflineSafetyData,\r?\n/, '');
financeContent = financeContent.replace(/  publishDeviceHealth,\r?\n/, '');
financeContent = financeContent.replace(/  getDeviceHealthRollup\r?\n/, '');
financeContent = financeContent.replace(/  getDeviceHealthRollup,\r?\n/, '');
fs.writeFileSync(financePath, financeContent, 'utf8');

const dbPath = 'src/main/database.js';
let dbContent = fs.readFileSync(dbPath, 'utf8');
dbContent = dbContent.replace(/  getSupportBundle,\r?\n/, '');
dbContent = dbContent.replace(/  getOfflineSafetyData,\r?\n/, '');
dbContent = dbContent.replace(/  publishDeviceHealth,\r?\n/, '');
dbContent = dbContent.replace(/  getDeviceHealthRollup,\r?\n/, '');
dbContent = dbContent.replace(/  getSystemHealth,\r?\n/, '');

const healthExport = `export {
  getSystemHealth,
  getSupportBundle,
  getOfflineSafetyData,
  publishDeviceHealth,
  getDeviceHealthRollup
} from './domains/health.js'

`;
dbContent = healthExport + dbContent;
fs.writeFileSync(dbPath, dbContent, 'utf8');

console.log("Refactoring completed successfully.");
