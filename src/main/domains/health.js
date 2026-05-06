import { app } from 'electron';
import crypto, { randomUUID } from 'crypto';
import { state } from '../state.js';

import {
  getFinancialReconciliation,
  getFinancialValidationSummary,
  getFinancialValidationRuns,
  getFinancialValidationAlerts
} from './finance.js';
import { createBookingIdempotencyKey } from './bookings.js';
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
  checkOnline,
  readCache
} from './infrastructure.js';
import { getLodgeDiagnostics } from './settings.js';

import {
  getSyncStatus,
  getSyncDetails
} from './sync.js';

function normalizeRpcProbeEnvelope(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
}

function isReplayContractProbeFailure(message = '') {
  return /PGRST202|42883|could not find the function|function.*does not exist|function.*not.*found|schema cache|structure of query does not match|returned record type does not match expected record type|unexpected parameter|missing required|has no parameter named|column .* does not exist/i.test(String(message || ''));
}

async function probeRpc(name, args = {}, options = {}) {
  const { expectSuccessEnvelope = true } = options;
  try {
    const { data, error } = await state.supabase.rpc(name, args);
    if (error) {
      const message = error.message || 'Unknown error';
      if (isReplayContractProbeFailure(message) || error.code === 'PGRST202') {
        return { ok: false, message: `${name} contract mismatch — ${message}` };
      }
      return { ok: true, message: `${name} is callable (probe reached runtime validation).`, responseShapeVerified: false };
    }

    if (!expectSuccessEnvelope) {
      return { ok: true, message: `${name} is available.`, responseShapeVerified: false };
    }

    const envelope = normalizeRpcProbeEnvelope(data);
    if (!envelope || typeof envelope !== 'object' || !Object.prototype.hasOwnProperty.call(envelope, 'success')) {
      return { ok: false, message: `${name} returned an unexpected response shape.` };
    }
    return { ok: true, message: `${name} returned the expected response shape.`, responseShapeVerified: true };
  } catch (e) {
    return { ok: false, message: `${name} probe threw: ${e.message}` };
  }
}

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

export async function getSystemHealth() {
  const diagnostics = await getLodgeDiagnostics(state.lodgeId || '').catch((error) => ({ error: error.message }));
  const sync = getSyncStatus();
  const backups = getBackupInfoForHealth();
  const backup_health = getBackupHealthSummary(backups);
  const faults = readHealthFaults();
  const finance = {
    payments_rpc: { ok: false, message: 'Offline or not checked yet.' },
    contract: { ok: false, probes: {}, allOk: false, message: 'Not checked yet.' }
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

    // P0-7: probe all replay-critical RPCs
    const probeBookingId = randomUUID();
    const probeCustomerId = randomUUID();
    const probeRoomId = randomUUID();
    const probeChargeId = randomUUID();
    const probePosOrderId = randomUUID();
    const probeNow = new Date().toISOString();
    const probeInvoiceNumber = `PROBE-${Date.now()}`;
    const probeBookingPayload = {
      id: probeBookingId,
      customer_id: probeCustomerId,
      room_id: probeRoomId,
      check_in: '2099-12-01',
      check_out: '2099-12-02',
      adults: 1,
      children: 0,
      total_amount: 1,
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_paid: 0,
      deposit_amount: 0,
      payment_method: null,
      invoice_number: probeInvoiceNumber,
      notes: 'contract probe',
      created_by: state.currentUser?.id || null,
      lodge_id: state.lodgeId,
      deposit_method: null,
      create_idempotency_key: createBookingIdempotencyKey(probeBookingId)
    };
    const rpcProbes = await Promise.all([
    probeRpc('create_booking', {
      p_lodge_id: state.lodgeId,
      p_customer_id: probeCustomerId,
      p_room_id: probeRoomId,
      p_check_in: probeBookingPayload.check_in,
      p_check_out: probeBookingPayload.check_out,
      p_adults: probeBookingPayload.adults,
      p_children: probeBookingPayload.children,
      p_total_amount: probeBookingPayload.total_amount,
      p_invoice_number: probeInvoiceNumber,
      p_notes: probeBookingPayload.notes,
      p_created_by: state.currentUser?.id || null,
      p_deposit_amount: 0,
      p_booking_id: probeBookingId,
      p_idempotency_key: createBookingIdempotencyKey(probeBookingId),
      p_deposit_method: null,
      p_allow_total_override: false
    }).then((r) => ['create_booking', r]),
    probeRpc('create_booking_record', {
      payload: probeBookingPayload
    }).then((r) => ['create_booking_record', r]),
    probeRpc('update_booking', {
      p_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      payload: {
        notes: 'contract probe',
        expected_updated_at: probeNow
      },
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking', r]),
    probeRpc('update_booking_status', {
      p_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_status: 'confirmed',
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking_status', r]),
    probeRpc('update_booking_payment', {
      p_booking_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_amount: 1,
      p_method: 'cash',
      p_type: 'payment',
      p_idempotency_key: `probe:payment:${probeBookingId}`,
      p_recorded_by: state.currentUser?.id || null,
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking_payment', r]),
    probeRpc('create_pos_order', {
      payload: {
        lodge_id: state.lodgeId,
        id: probePosOrderId,
        room_id: probeRoomId,
        booking_id: null,
        walk_in_name: 'Contract Probe',
        total: 1,
        notes: 'contract probe',
        payment_method: 'folio',
        outlet_id: null,
        create_idempotency_key: `probe:pos:${probePosOrderId}`,
        created_at_client: probeNow,
        items: [
        { menu_item_id: null, item_name: 'Contract Probe', quantity: 1, unit_price: 1 }]

      }
    }).then((r) => ['create_pos_order', r]),
    probeRpc('add_booking_charge', {
      p_booking_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_description: 'Contract probe',
      p_category: 'other',
      p_quantity: 1,
      p_unit_price: 1,
      p_outlet_id: null,
      p_expected_updated_at: probeNow
    }).then((r) => ['add_booking_charge', r]),
    probeRpc('delete_booking_charge', {
      p_charge_id: probeChargeId,
      p_lodge_id: state.lodgeId,
      p_reason: 'contract probe',
      p_expected_booking_updated_at: probeNow
    }).then((r) => ['delete_booking_charge', r])]
    );
    const probesObj = Object.fromEntries(rpcProbes);
    const allOk = Object.values(probesObj).every((p) => p.ok);
    const missing = Object.entries(probesObj).filter(([, p]) => !p.ok).map(([name]) => name);
    finance.contract = {
      ok: allOk,
      probes: probesObj,
      allOk,
      message: allOk ?
      'All replay-critical RPCs are available.' :
      `Missing RPCs: ${missing.join(', ')} — run the latest migrations before trusting replay.`
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
