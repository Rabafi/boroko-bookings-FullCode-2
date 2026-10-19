// @ts-check
import { app } from 'electron';
import crypto, { randomUUID } from 'crypto';
import { state } from '../state.js';

import {
  getFinancialReconciliation,
  getFinancialValidationSummary,
  getFinancialValidationRuns,
  getFinancialValidationAlerts
} from './finance.js';
import {
  CRITICAL_ERROR_LOG_FILE,
  getLocalDateKey,
  isNonCriticalOperationalError,
  LOCAL_TIME_ZONE,
  readAuxiliaryLog
} from './operationalLog.js';
import { addDays } from './subscriptionState.js';

import {
  getBackupHealthSummary,
  getBackupInfoForHealth
} from './backupHealth.js';
import {
  SYNC_DRIFT_FAULT_TYPES,
  readHealthFaults,
  readSyncMeta
} from './syncStore.js';

import {
  readCache
} from './infrastructure.js';
import { checkOnline } from './connectivity.js';
import { getLodgeDiagnostics } from './settings.js';

import {
  getSyncStatus,
  getSyncDetails
} from './sync.js';

import { getAllBookings } from './bookings.js';
import { getAllRooms } from './rooms.js';
import { getAllCustomers } from './customers.js';
import { getInventoryItems } from './inventory.js';
import { getRuntimeProductId } from '../../shared/productIdentity.js';
import { scrubSupportBundleValue } from '../../shared/supportBundleScrub.js';

const DEVICE_HEALTH_MAX_HEARTBEAT_MS = 20 * 60_000;
let lastDeviceHealthLocalFingerprint = '';
let lastDeviceHealthPublishedAt = 0;

// ─── HEALTH DIAGNOSTICS & OFFLINE SAFETY ───────────────────────────────────────

export async function getSystemHealth(options = {}) {
  const includeMutationProbes = options?.includeMutationProbes === true;
  const diagnostics = await getLodgeDiagnostics(state.lodgeId || '').catch((error) => ({ error: error.message }));
  const sync = getSyncStatus();
  const backups = getBackupInfoForHealth();
  const backup_health = getBackupHealthSummary(backups);
  const faults = readHealthFaults();
  const finance = {
    payments_rpc: { ok: false, message: 'Offline or not checked yet.' },
    contract: { ok: false, probes: {}, allOk: false, skipped: true, message: 'Replay-critical mutation contracts were not verified in this health check.' }
  };

  await checkOnline();
  if (state.isOnline && state.lodgeId) {
    // Existing payment ledger check
    try {
      const { error } = await state.supabase.rpc('get_booking_payments', {
        p_booking_id: randomUUID(),
        p_lodge_id: state.lodgeId
      });
      if (error) throw error;
      finance.payments_rpc = { ok: true, message: 'Booking payment ledger RPC is available.' };
    } catch (e) {
      finance.payments_rpc = {
        ok: false,
        message: /get_booking_payments/i.test(e.message || '') ?
        'Booking payment ledger RPC is missing. Run the latest checked-in finance migration.' :
        e.message || 'Could not verify booking payment ledger RPC.'
      };
    }

    if (!includeMutationProbes) {
      finance.contract = {
        ok: false,
        probes: {},
        allOk: false,
        skipped: true,
        message: 'Replay-critical mutation contracts were not verified. Run an explicitly authorized deep health check before treating them as ready.'
      };
      return {
        checked_at: new Date().toISOString(),
        lodge_id: state.lodgeId,
        online: state.isOnline,
        replayAuthReady: state.replayAuthReady,
        sync,
        backups,
        backup_health,
        diagnostics,
        finance,
        faults
      };
    }

    // Mutative probes cannot safely use an installed operator database. A
    // returned business rejection may itself create an immutable intent row.
    // Exercise these contracts only in the guarded disposable database suite.
    const mutationProbeNames = [
      'create_booking',
      'create_booking_record',
      'update_booking',
      'update_booking_status',
      'update_booking_payment',
      'create_pos_order',
      'approve_pos_void_with_pin',
      'adjust_inventory_stock',
      'upsert_pos_cashup',
      'add_booking_charge',
      'delete_booking_charge'
    ];
    const probesObj = Object.fromEntries(mutationProbeNames.map((name) => [name, {
      ok: false,
      skipped: true,
      message: 'Not invoked against an installed operator database; use the verified disposable contract suite.'
    }]));
    finance.contract = {
      ok: false,
      probes: probesObj,
      allOk: false,
      skipped: true,
      message: 'Mutation contracts were not executed from this installed application. Run the verified disposable database suite before treating replay as ready.'
    };
  }

  return {
    checked_at: new Date().toISOString(),
    lodge_id: state.lodgeId,
    online: state.isOnline,
    replayAuthReady: state.replayAuthReady,
    sync,
    backups,
    backup_health,
    diagnostics,
    finance,
    faults
  };
}


function getCriticalErrorLogForSupport(limit = 100) {
  return readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).
  filter((entry) => !isNonCriticalOperationalError(entry?.scope, entry?.message)).
  slice(0, limit);
}

// Support-bundle scrubbing lives in the shared dependency-free helper so it
// stays unit-testable outside the Electron main process. Re-exported here for
// existing callers.
export { scrubSupportBundleValue } from '../../shared/supportBundleScrub.js';
import { shapeSupportBundle } from '../../shared/supportBundleScrub.js';

function getBundleProductId() {
  try {
    // Product-scoped helper keeps the bundle identity aligned with the
    // running executable (lodge-camp, hotel, hospitality-pos).
    if (typeof getRuntimeProductId === 'function') return getRuntimeProductId();
  } catch {}
  return 'unknown';
}

function getBundleAppVersion() {
  try {
    const version = app?.getVersion?.();
    if (version) return String(version);
  } catch {}
  return 'unknown';
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

  // The allowlisted schema bounds what leaves the device: unknown sections
  // are dropped and nested bodies are reduced before export.
  return shapeSupportBundle({
    generated_at: new Date().toISOString(),
    product: getBundleProductId(),
    app_version: getBundleAppVersion(),
    lodge_id: state.lodgeId || null,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name || null,
    app_online: state.isOnline,
    pending_operations: {
      pending: Number(syncDetails?.pendingCount ?? syncStatus?.remaining ?? 0) || 0,
      failed: Number(syncDetails?.failedCount ?? 0) || 0
    },
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
  });
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

export async function publishDeviceHealth(options = {}) {
  if (!state.isOnline || !state.lodgeId) return { success: false, skipped: true, error: 'Offline or lodge not selected.' };
  const details = getSyncDetails();
  const faults = readHealthFaults();
  const topFaultTypes = [...new Set(faults.map((fault) => fault?.type).filter(Boolean))].slice(0, 10);
  const localFingerprint = JSON.stringify({
    lodgeId: state.lodgeId,
    pendingCount: details.pendingCount || 0,
    failedCount: details.failedCount || 0,
    unresolvedLocalCount: details.unresolvedLocal?.length || 0,
    replayAuthReady: !!state.replayAuthReady,
    lastSuccessfulSyncAt: details.lastSuccessfulSyncAt || null,
    topFaultTypes
  });
  const heartbeatDue = Date.now() - lastDeviceHealthPublishedAt >= DEVICE_HEALTH_MAX_HEARTBEAT_MS;
  if (options.force !== true && !heartbeatDue && localFingerprint === lastDeviceHealthLocalFingerprint) {
    return { success: true, skipped: true, reason: 'unchanged' };
  }

  const reconciliation = await getFinancialReconciliation().catch(() => ({ state: 'unknown' }));
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
  lastDeviceHealthLocalFingerprint = localFingerprint;
  lastDeviceHealthPublishedAt = Date.now();
  return { success: true };
}

export async function getDeviceHealthRollup() {
  if (!state.isOnline || !state.lodgeId) return { available: false, devices: [] };
  await publishDeviceHealth({ force: true }).catch(() => {});
  const { data, error } = await state.supabase.rpc('get_device_health_rollup', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return { available: true, devices: Array.isArray(data) ? data : [] };
}

// ── Fleet Health (cross-lodge) ────────────────────────────────────────────────
export async function getFleetHealthRollup() {
  if (!state.isOnline) throw new Error('Fleet health requires an internet connection')
  if (!state.adminDb) throw new Error('Command Central admin access is unavailable')
  const { data, error } = await state.adminDb.rpc('get_fleet_health_rollup')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getFleetHealthSummary() {
  if (!state.isOnline) throw new Error('Fleet health requires an internet connection')
  if (!state.adminDb) throw new Error('Command Central admin access is unavailable')
  const { data, error } = await state.adminDb.rpc('get_fleet_health_summary')
  if (error) throw new Error(error.message)
  return data?.[0] || null
}
