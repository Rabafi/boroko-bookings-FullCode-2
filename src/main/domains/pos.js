import { createHash, randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { state } from '../state.js'
import {
  POS_HISTORICAL_REPLAY_RPC,
  buildHistoricalReplayRequest,
  classifySaleReplayRoute,
  isHistoricalReplayContractMissing
} from './syncShared.js'
import { withNetworkTimeout, broadcastSyncStatus } from './connectivity.js'
import { getActiveBookingForRoom } from './bookings.js'
import { getLocalDateKey, recordCriticalError } from './operationalLog.js'
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js'
import { appendHealthFault, appendOperationJournalEntry } from './syncStore.js'
import { patchCachedPosOrderSyncState } from './syncCache.js'
import {
  applyOfflinePosInventoryReservation,
  ensureDir,
  getOfflinePosInventoryReservation,
  queueOperation,
  readCache,
  readSyncQueue,
  readFailedSyncQueue,
  writeSyncQueue,
  readLocalPosVoidHistory,
  patchLocalPosVoidHistory,
  refreshCache,
  upsertLocalPosVoidHistory,
  removeLocalPosVoidHistory,
  writeCache,
  dedupePromise
} from './infrastructure.js'
import {
  resolvePosSubmitAttempt,
  commitPosSubmitAttempt,
  markPosSubmitAttemptProvisional,
  hasPosSubmitAttempt,
  getPosSubmitAttempt,
  countPendingPosSubmitAttempts as countPendingSubmitAttemptRecords,
  getPendingPosSubmitAttempt as getPendingSubmitAttemptRecord,
  clearPosSubmitAttempt as clearPosSubmitAttemptRecord
} from './posSubmitJournal.js'
import { classifyAuthoritativeShiftClose } from './posShiftClose.js'
import { getTrialStatus } from './entitlements.js'
import { subscriptionAllowsAccess } from './subscriptionState.js'
import { isCommercialFeatureIncluded } from '../../shared/commercialAccess.js'
import { isBarOnlyMode } from '../../shared/propertyTypes.js'
import { validateSaleModifierRequirements } from '../../shared/modifierRequirements.js'
import { createProductSaveFlow } from '../../shared/productSaveFlow.js'
import { isDefinitiveProductRejection, isMissingRpcError } from '../../shared/productRequest.js'
import { runPublicationSweep, summarizePublication } from '../../shared/catalogPublication.js'
import { upsertLocalInventoryMovement } from './inventory.js'
import { applyOptionalV3TabFields, isPositiveTabVersion } from '../../shared/posV3TabFields.js'

const POS_REMOTE_READ_TTL_MS = 2_500;
const POS_TICKET_SELECT = 'id, lodge_id, order_id, outlet_id, station, status, service_mode, table_name, tab_name, waiter_name, room_id, notes, items, created_at, updated_at';
const POS_TAB_SELECT = 'id, lodge_id, outlet_id, table_name, tab_name, customer_name, waiter_name, waiter_id, shift_id, room_id, booking_id, items, notes, status, opened_by, opened_by_name, created_at, updated_at, closed_at, tab_version, financial_snapshot';
const ACTIVE_PREP_TICKET_STATUSES = Object.freeze(['new', 'pending', 'preparing', 'ready']);
/** @typedef {{value: unknown, expiresAt: number, request: Promise<unknown> | null}} PosRemoteReadCacheEntry */
/**
 * Expected row fields used by POS history readers and local cache merges. The
 * SELECT and queue/cache producers provide these fields; this view does not
 * validate persisted or RPC data.
 * @typedef {Record<string, unknown> & {business_date?: unknown, outlet_id?: string | null, created_at?: unknown}} PosOrderExpectedData
 */
/** @typedef {PosOrderExpectedData[] & {_source: unknown, _complete: boolean, _tender_complete: boolean, _item_detail_complete: boolean}} PosOrderReadRows */
/** @typedef {{orders: PosOrderExpectedData[], source: 'local_cache', refreshed: false, complete: false} | {orders: PosOrderExpectedData[], source: 'server', refreshed: true, complete: boolean, tender_complete: boolean, item_detail_complete: boolean}} SharedTillPosOrdersResult */
/** Partial-return request fields produced by the POS history dialog; the IPC payload is not runtime-validated here.
 * @typedef {{order_id?: string | null, pin?: string | null, reason?: string | null, lines?: Array<{line_id?: string | null, id?: string | null, quantity?: number | string | null}> | null, cashier_user_id?: string | null, outlet_id?: string | null, payment_method?: string | null, shift_id?: string | null, return_order_id?: string, created_at?: string, approver_id?: string | null, override_log_id?: string}} PosPartialReturnRequest
 */
/** Expected source line fields selected with pos_orders.pos_order_items(*) or retained in the local POS order cache; the view does not validate either source.
 * @typedef {{id: string, quantity: number | string, unit_price: number | string, item_name?: string | null, menu_item_id?: string | null, inventory_item_id?: string | null, depletion_qty?: number | string | null}} PosPartialReturnSourceLine
 */
/** Expected order row read by the partial-return flow from POS order cache or its explicit order/items query; this is not runtime validation.
 * @typedef {{id: string, status?: string | null, outlet_id?: string | null, walk_in_name?: string | null, _pending_sync?: boolean, pos_order_items?: unknown, items?: unknown}} PosPartialReturnSourceOrder
 */
/** Locally calculated return line sent to create_pos_return_v3 and written as a provisional cached return row.
 * @typedef {{original_order_item_id: string, menu_item_id: string | null, inventory_item_id: string | null, depletion_qty: number, item_name: string, quantity: number, unit_price: number}} PosPartialReturnLine
 */
/** @typedef {Record<string, unknown>} PosSettingsExpectedData */
/** @typedef {Error & {code?: unknown}} PosCodedError */
/** @typedef {{message?: unknown} | null | undefined} PosThrownMessageReadView */
/** @typedef {{success?: unknown, error?: unknown}} PosOperationResultExpectedData */
/** Expected POS shift fields produced by pos_shifts queries and the local shift writer; cache/RPC rows are not runtime-validated.
 * @typedef {Record<string, unknown> & {id: string, lodge_id?: string|null, outlet_id?: string|null, cashier_id?: string|null, cashier_name?: string|null, status?: string|null, opened_at?: string|null, closed_at?: string|null, opening_float?: unknown, notes?: string|null, attendance_shift_id?: string|null, _pending_sync?: unknown, _queue_id?: unknown}} PosStaffShiftExpectedData
 */
/** Expected attendance fields written by the attendance RPC/cache paths; persisted JSON is not runtime-validated.
 * @typedef {Record<string, unknown> & {id: string, lodge_id?: string|null, staff_user_id?: string|null, staff_name?: string|null, role?: string|null, expected_hours?: unknown, clock_in?: string|null, status?: string|null, clock_out?: string|null, idempotency_key?: string|null, _pending_sync?: unknown, _queue_id?: unknown}} PosAttendanceShiftExpectedData
 */
/** Cached users rows are populated by the existing team refresh; this expected-data view does not validate cache contents.
 * @typedef {Record<string, unknown> & {id: string, lodge_id?: string|null, status?: string|null, pin_hash?: string|null, name?: string|null, email?: string|null, role?: string|null, allowed_outlet_ids?: string[]|null}} PosCachedStaffExpectedData
 */
/** @typedef {{success: false, error: string}|{success: true, staff: {id: string, name: string|null, email: string|null, role: string|null, allowed_outlet_ids: string[]}}} PosCachedStaffPinResult */
/** POS shift-open fields sent by the main IPC caller; IPC data is not runtime-validated here.
 * @typedef {{id?: string|null, outlet_id?: string|null, cashier_id?: string|null, cashier_name?: string|null, opening_float?: number|string|null, notes?: string|null, create_idempotency_key?: string|null, idempotency_key?: string|null} | Record<string, undefined>} PosOpenShiftRequest
 */
/** Shared Till unlock fields provided by the main IPC caller; aliases and fallback semantics are preserved.
 * @typedef {{staff_id?: string|null, staffId?: string|null, outlet_id?: string|null, outletId?: string|null, pin?: string|null, idempotency_key?: string|null, idempotencyKey?: string|null} | Record<string, undefined>} PosSharedTillOperatorRequest
 */
/** Attendance PIN clock-in fields provided by the manager renderer through IPC; the request is not runtime-validated here.
 * @typedef {{staff_user_id?: string|null, staffUserId?: string|null, pin?: string|null, role?: string|null, expected_hours?: number|string|null, expectedHours?: number|string|null, idempotency_key?: string|null, idempotencyKey?: string|null} | Record<string, undefined>} PosAttendancePinClockInRequest
 */
/** Queue fields read by offline duplicate guards; persisted queue JSON is not runtime-validated.
 * @typedef {Record<string, unknown> & {table?: unknown, data?: {payload?: {lodge_id?: unknown, staff_user_id?: unknown, shift_id?: unknown, pos_shift_id?: unknown, outlet_id?: unknown}}}} PosStaffShiftQueueExpectedData
 */
/** Request fields provided by POS.jsx; the empty variant preserves the existing default argument path.
 * @typedef {{shift_id: string|null, outlet_id: string|null, cashier_id: string|null, cashier_name: string|null, closing_cash: number, cashup_id?: string, idempotency_key?: string, notes?: string|null} | Record<string, undefined>} PosCloseShiftRequest
 */
/** @typedef {{shift_id: string, cashup_id: string, idempotency_key: string, fingerprint: string, created_at: string}} PosShiftCloseAttemptExpectedData */
/** @typedef {Record<string, unknown> & {_queue_id?: unknown, table?: unknown, data?: {payload?: {shift_id?: unknown}}}} PosShiftCloseQueueReadView */
/** SQL envelope for finalize_pos_shift_cashup_v2. Financial JSON values remain unknown.
 * @typedef {{success: true, cashup_id: string, counted_by_method: {cash?: unknown}, expected_cash_drawer?: unknown, variance_by_method?: unknown, error?: undefined} | {success: false, error: unknown, code?: unknown, cashup_id?: unknown, counted_by_method?: unknown, expected_cash_drawer?: unknown, variance_by_method?: unknown}} PosShiftCloseRpcResultExpectedData
 */
/** Expected JSONB branches returned by get_pos_shift_close_resolution; this is not validation.
 * @typedef {{success: true, exists: false, status: string, shift_id: string} | {success: true, exists: true, status: string, finalized: boolean, close_idempotency_key: string|null, shift: Record<string, unknown>, cashup_session: Record<string, unknown>|null} | {success: false, exists?: false, status?: string, code: string, error: string}} PosShiftCloseResolutionExpectedData
 */
/**
 * Expected input for the Bar pack product IPC save. HposMenu supplies the
 * product and pack fields; the optional menu metadata fields are also read by
 * the offline row writer and use the same defaults as create/update menu item.
 * IPC data is not runtime-validated by this expected-data view.
 * @typedef {{
 *   name: string,
 *   category: string,
 *   price: number,
 *   barcode: string | null,
 *   stock_method: 'direct' | 'recipe' | 'non_stock',
 *   is_available: boolean,
 *   inventory_item_id: string | null,
 *   depletion_qty: number | null,
 *   menu_item_id: string | null,
 *   operation_key: string,
 *   pack6: boolean,
 *   pack12: boolean,
 *   pack24: boolean,
 *   pack6Barcode: string | null,
 *   pack12Barcode: string | null,
 *   pack24Barcode: string | null,
 *   outlet_id?: string | null,
 *   dietary_flags?: string[],
 *   prep_time_minutes?: number,
 *   is_popular?: boolean,
 *   kitchen_station_id?: string | null
 * }} HposBarPosProductWithPacksRequest
 * @typedef {HposBarPosProductWithPacksRequest | Record<string, undefined>} BarPosProductWithPacksRequest
 */
/** @typedef {6 | 12 | 24} BarPackSize */
/**
 * Expected cache rows written by POS catalog reads/writes; persisted JSON is
 * not parsed or validated by these views.
 * @typedef {Record<string, unknown> & {id: string, inventory_item_id?: string | null, template_kind?: string | null, template_pack_size?: number | string | null, outlet_id?: string | null}} PosCachedMenuItem
 */
/**
 * Expected inventory cache row fields produced by inventory refresh and used
 * by the existing offline POS catalog projection; not runtime validation.
 * @typedef {Record<string, unknown> & {id: string, name: string, selling_price?: number | null, outlet_id?: string | null, _pending_sync?: boolean}} PosCachedInventoryItem
 */
/** @typedef {{inventory_item_id: string, pack_size: BarPackSize, enabled: boolean, menu_item_id?: string, barcode?: string | null}} BarPackTemplateRequest */
/** @type {Map<string, PosRemoteReadCacheEntry>} */
const posRemoteReadCache = new Map();

/**
 * Settings writers persist a one-row cache array. This expected-data view
 * preserves the prior indexed read and does not validate cached JSON.
 * @returns {PosSettingsExpectedData | null}
 */
function getCachedPosSettings() {
  const rows = /** @type {unknown[] | null | undefined} */ (readCache('settings'));
  return /** @type {PosSettingsExpectedData | null} */ (rows?.[0] || null);
}

/** @param {string} [scope] */
function invalidatePosRemoteReads(scope = '') {
  for (const key of posRemoteReadCache.keys()) {
    if (!scope || key.startsWith(`${scope}:`)) posRemoteReadCache.delete(key);
  }
}

/** @param {string} key @param {() => Promise<unknown>} fetcher @returns {Promise<unknown>} */
async function readPosRemoteCached(key, fetcher) {
  const cached = posRemoteReadCache.get(key);
  if (cached?.request) return cached.request;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const request = Promise.resolve()
    .then(fetcher)
    .then((value) => {
      posRemoteReadCache.set(key, {
        value,
        expiresAt: Date.now() + POS_REMOTE_READ_TTL_MS,
        request: null
      });
      return value;
    })
    .catch((error) => {
      if (posRemoteReadCache.get(key)?.request === request) posRemoteReadCache.delete(key);
      throw error;
    });
  posRemoteReadCache.set(key, { value: null, expiresAt: 0, request });
  return request;
}

function getDesktopPosDeviceId() {
  const source = state.cacheDir || state.lodgeId || 'boroko-desktop-pos';
  return `desktop-${createHash('sha256').update(String(source)).digest('hex').slice(0, 24)}`;
}

// Provisional receipt numbers for offline sales. Display-only: the server
// issues the authoritative receipt_number on replay and it replaces this
// value. The provisional number lets the customer receipt, My Sales and
// Sales history show a real receipt reference and full prices while offline
// instead of "UNAVAILABLE". Format TILL-YYYYMMDD-NNNN, sequenced per outlet
// per business day on this device.
/** @param {string | null} [outletId] */
function nextOfflineReceiptNumber(outletId = null) {
  const businessDate = getLocalDateKey();
  const compactDate = String(businessDate || '').replaceAll('-', '') || '00000000';
  const cacheKey = 'pos-offline-receipt-counters';
  /** @type {Record<string, unknown>} */
  let counters = {};
  try {
    const raw = readCache(cacheKey);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      // Existing cache guard establishes the record container. Values remain
      // unknown because the persisted counter JSON is not schema-validated.
      counters = /** @type {Record<string, unknown>} */ (raw);
    }
  } catch {
    counters = {};
  }
  const key = `${businessDate || 'nodate'}:${outletId || 'nooutlet'}`;
  const next = Number(counters[key] || 0) + 1;
  counters[key] = next;
  try {
    writeCache(cacheKey, counters);
  } catch {
    /* receipt sequencing is best-effort; uniqueness still holds via the order id */
  }
  return `TILL-${compactDate}-${String(next).padStart(4, '0')}`;
}

/**
 * Reads the same `.message` property that optional property access did before
 * this helper was typed. `Object(value)` preserves JavaScript ToObject lookup
 * for every non-null thrown value; the view does not validate the thrown data.
 * @param {unknown} error
 */
function getThrownMessageOrValue(error) {
  const message = error == null
    ? undefined
    : /** @type {{message?: unknown}} */ (Object(error)).message;
  return String(message || error || '').toLowerCase();
}

/** @param {unknown} error */
function isReadOnlySessionTouchError(error) {
  const message = getThrownMessageOrValue(error);
  return message.includes('read-only transaction') && message.includes('update');
}

/** @param {unknown} error */
function isNetworkError(error) {
  const message = getThrownMessageOrValue(error);
  return message.includes('fetch') || message.includes('network') || message.includes('failed to fetch') ||
    message.includes('ERR_CONNECTION') || message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT');
}

function buildReadOnlySessionTouchMessage(featureLabel = 'This screen') {
  return `${featureLabel} is hitting an older database read path that still tries to write during a SELECT. Apply the latest session and entitlement read-only SQL fixes in Supabase, then reload the app.`;
}

/** @typedef {Record<string, unknown> & {outlet_id?: string}} PosMenuCatalogExpectedRow */

/**
 * `rows` is the existing expected catalogue shape from the POS RPC/cache. The
 * assertion only describes that input view; it intentionally adds no runtime
 * validation and preserves the existing `.filter` failure for malformed data.
 * @param {unknown} rows
 * @param {string[] | null} [outletFilter]
 * @returns {PosMenuCatalogExpectedRow[]}
 */
function applyPosMenuOutletFilter(rows = [], outletFilter = null) {
  if (outletFilter !== null && outletFilter.length === 0) return [];
  const menuRows = /** @type {PosMenuCatalogExpectedRow[]} */ (rows || []);
  if (outletFilter !== null) {
    return menuRows.filter((item) => !item.outlet_id || outletFilter.includes(item.outlet_id));
  }
  return menuRows;
}

/**
 * @param {unknown} rows Expected POS SELECT/cache rows; no runtime validation is performed.
 * @param {string | null | undefined} startDate
 * @param {string | null | undefined} endDate
 * @param {string[] | string | null} [outletFilter]
 * @returns {PosOrderExpectedData[]}
 */
function applyPosOrderFilters(rows = [], startDate, endDate, outletFilter = null) {
  let filtered = /** @type {PosOrderExpectedData[]} */ (rows || []);
  if (startDate) {
    filtered = filtered.filter((order) => String(order.business_date || '').slice(0, 10) >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter((order) => String(order.business_date || '').slice(0, 10) <= endDate);
  }
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) {
    filtered = filtered.filter((order) => !order.outlet_id || outletFilter.includes(order.outlet_id));
  }
  return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** @param {Record<string, unknown>} payload @param {unknown[]} paymentBreakdown @param {unknown} paymentMethod */
async function enforceBarBaseTenderBoundary(payload = {}, paymentBreakdown = [], paymentMethod = 'cash') {
  const items = /** @type {Record<string, unknown>[]} */ (Array.isArray(payload?.items) ? payload.items : []);
  const hasPoolLines = items.some((item) => String(item?.category || item?.menu_category || '').trim().toLowerCase() === 'pool')
  if (hasPoolLines) {
    const method = String(paymentMethod || '').trim().toLowerCase()
    const tenders = (Array.isArray(paymentBreakdown) ? /** @type {Record<string, unknown>[]} */ (paymentBreakdown) : []).map((tender) => String(tender?.method || '').trim().toLowerCase()).filter(Boolean)
    const singleCash = method === 'cash' && tenders.length === 1 && tenders[0] === 'cash'
    const hasAccountCharge = payload?.customer_account_charge !== null && payload?.customer_account_charge !== undefined && payload?.customer_account_charge !== '' && payload?.customer_account_charge !== false
    const tip = payload?.tip_total === null || payload?.tip_total === undefined || payload?.tip_total === '' ? 0 : Number(payload.tip_total)
    if (!singleCash || hasAccountCharge || !(tip === 0)) {
      throw new Error('Pool tables pay Cash only. Remove card, mobile money, split and account charge from this sale.')
    }
    return
  }
  const settings = getCachedPosSettings()
  if (!isBarOnlyMode(settings)) return
  const hasVoucher = String(paymentMethod || '').toLowerCase() === 'voucher' || /** @type {Record<string, unknown>[]} */ (paymentBreakdown).some((tender) => String(tender?.method || '').toLowerCase() === 'voucher')
  const tip = payload?.tip_total === null || payload?.tip_total === undefined || payload?.tip_total === '' ? 0 : Number(payload.tip_total)
  if (!Number.isFinite(tip)) throw new Error('Tip tender is invalid and has been blocked.')
  if (!hasVoucher && tip === 0) return
  const entitlement = await getTrialStatus(state.lodgeId)
  const productId = entitlement?.product_id || null
  const packageKey = entitlement?.commercial_package_key || null
  const addonKeys = entitlement?.enterprise_addons || []
  if (!productId || !packageKey) throw new Error('Bar POS commercial entitlement could not be verified. Tender is blocked until the package context is available.')
  if (hasVoucher && !isCommercialFeatureIncluded(productId, packageKey, 'vouchers', addonKeys, entitlement, state.lodgeId)) {
    throw new Error('Voucher tender is not included in the current Bar POS commercial entitlement.')
  }
  if (tip !== 0 && !isCommercialFeatureIncluded(productId, packageKey, 'tips_payouts', addonKeys, entitlement, state.lodgeId)) {
    throw new Error('Tip tender is not included in the current Bar POS commercial entitlement.')
  }
}

// Fail-closed subscription gate for new sales. Expired, suspended,
// cancelled, inactive, or offline-lease-expired licences must not sell:
// the Till blocks the sale with a clear recovery message while read-only
// reporting stays available. Trial/active/grace-period licences pass.
export async function assertPosSubscriptionAllowsSale() {
  const entitlement = await getTrialStatus(state.lodgeId).catch(() => null);
  const subscriptionState = String(entitlement?.subscription_state || '').trim().toLowerCase();
  const status = String(entitlement?.status || '').trim().toLowerCase();
  const expiredFlag = entitlement?.expired === true;
  if (!entitlement) {
    const blocked = /** @type {PosCodedError} */ (new Error('POS sales are blocked: subscription could not be verified (code subscription_unverified). Reconnect and retry; read-only reports remain available.'));
    blocked.code = 'subscription_unverified';
    throw blocked;
  }
  let allows = false;
  try {
    allows = subscriptionAllowsAccess(subscriptionState);
  } catch {
    allows = ['active', 'grace_period', 'trial'].includes(subscriptionState);
  }
  // Trial licences without a subscription_state (status trial) still sell.
  if (!subscriptionState && (status === 'trial' || status === 'licensed') && !expiredFlag) {
    allows = true;
  }
  if (!allows || expiredFlag || status === 'expired') {
    const label = subscriptionState || status || 'expired';
    const blocked = /** @type {PosCodedError} */ (new Error(`POS sales are blocked: subscription is ${label} (code subscription_expired). Renew the licence to resume selling. Read-only reports remain available.`));
    blocked.code = 'subscription_expired';
    throw blocked;
  }
}

// Best-effort cache refresh after a committed financial write. A failed
// refresh must never silently pass: log it, raise a health fault so the
// operator health badge/toast surfaces it, and return a warning the caller
// attaches to its result.
/**
 * @param {string[]} [cacheKeys]
 * @param {string} [context]
 * @returns {Promise<string | null>}
 */
export async function refreshPosCachesBestEffort(cacheKeys = [], context = 'pos-refresh') {
  try {
    await refreshCache(...cacheKeys);
    return null;
  } catch (refreshError) {
    // Catch values remain unvalidated; this view preserves the existing
    // optional `.message` read for errors, primitives, and nullish values.
    const message = /** @type {PosThrownMessageReadView} */ (refreshError)?.message || String(refreshError || 'refresh failed');
    try {
      recordCriticalError(`pos.cache-refresh.${context}`, refreshError, { cache_keys: cacheKeys });
    } catch { /* logging must never break the sale */ }
    try {
      appendHealthFault({
        type: 'pos_cache_refresh_failed',
        scope: Array.isArray(cacheKeys) ? cacheKeys.join(',') : String(cacheKeys),
        message: `Showing last saved data — ${context} refresh failed: ${message}. Reopen the view to retry.`,
        at: new Date().toISOString()
      });
    } catch { /* health fault must never break the sale */ }
    try { broadcastSyncStatus(); } catch { /* ignore */ }
    try { console.warn(`[POS] ${context} cache refresh failed:`, message); } catch { /* ignore */ }
    return `Showing last saved data — ${context} refresh failed. Reopen the view to retry.`;
  }
}

const POS_ATTENDANCE_CACHE = 'restaurant-shifts'
const POS_CASHUP_SUBMISSION_CACHE = 'pos-cashup-submissions'

// Operator-facing PIN guidance: a wrong Till/attendance/cash-up PIN must tell
// bartenders, cashiers and everyone else to ask an admin for a reset instead
// of retrying blindly. The Manage PIN dialog keeps its own support-ticket help
// flow, so this hint is for operator PINs only.
const OPERATOR_PIN_RESET_HINT = ' If you forgot it, ask an admin to reset it in Staff Management.';

/** @param {unknown} message @returns {string} */
function withOperatorPinResetHint(message) {
  const text = String(message || '');
  if (!text) return text;
  if (text.includes('ask an admin to reset it')) return text;
  if (/incorrect staff pin|invalid pin/i.test(text)) {
    return `${text.replace(/\s+$/, '')}${OPERATOR_PIN_RESET_HINT}`;
  }
  return text;
}

/**
 * @param {unknown} result
 * @returns {unknown}
 */
function withOperatorPinResult(result) {
  // PIN RPC results use this expected property view; malformed values retain
  // the old property-read and spread behavior and are not validated here.
  if (!result) return result;
  const resultData = /** @type {PosOperationResultExpectedData} */ (result);
  if (resultData.success !== false) return result;
  if (!resultData.error) return result;
  return { ...resultData, error: withOperatorPinResetHint(resultData.error) };
}

// PostgREST surfaces a missing EXECUTE grant as a bare "permission denied
// for function ..." which tells the operator nothing to do. Map it to the
// recovery path: the shift stays open, cash-up is kept, no repeat tapping.
// The raw detail stays in the main-process log for support.
/** @param {unknown} rawMessage @param {'in' | 'out'} action @returns {string} */
function withAttendancePermissionGuidance(rawMessage, action) {
  const message = String(rawMessage || '');
  if (!/permission denied for function/i.test(message)) return message;
  return `Clock ${action} was refused by the database permission check. Your shift stays open and any cash-up is kept — do not tap repeatedly. Ask a manager to update the database permissions, then relaunch and try again.`;
}

/** @param {string|null} userId @returns {PosCachedStaffExpectedData|null} */
function getCachedPosUser(userId) {
  // The team refresh writes these fields; this is an expected-data assertion, not cache validation.
  return /** @type {PosCachedStaffExpectedData[]} */ (readCache('users') || []).find((row) =>
    row?.id === userId &&
    (!row?.lodge_id || row.lodge_id === state.lodgeId)
  ) || null
}

const MANAGER_MANAGE_UNLOCK_ROLES = Object.freeze(['manager', 'admin', 'super_admin']);

// Transport failures mean the server verdict is unknown (cable unplugged,
// router down, fetch aborted, statement timed out). Those must fall back to
// the trusted offline PIN cache so Manage/Till unlock keeps working offline.
// Anything else (permission denied, RLS, validation, server PIN rejection in
// result.success === false) is an authoritative answer and must fail closed.
//
// Tightened classifier: only true transport signals fall back. Server denials
// (wrong PIN, permission denied, statement timeout wording, RLS/JWT, PIN
// throttling) never trigger fallback, even when their wording contains
// "timeout" or "connection".
export function isPosPinTransportFailure(error) {
  if (!error) return false;
  if (error?.code === 'network_read_timeout') return true;
  const rawMessage = String(error?.message || error || '');
  // Fail closed first: authoritative server answers must never look like
  // transport failures, even when they mention timeout/connection words.
  if (/permission denied|invalid pin|incorrect|unauthorized|row-level security|\brls\b|jwt|too many failed|statement timeout|canceling statement|cancelled statement|query.*timeout|57014|42501|PGRST|permission denied for function|invalid pin or unauthorized/i.test(rawMessage)) {
    return false;
  }
  // Explicit HTTP status check: 0/408/502/503/504 are transport; any other
  // 4xx/5xx is an authoritative server answer.
  const statusCandidate = error?.status ?? error?.statusCode ?? error?.cause?.status;
  const status = Number(statusCandidate);
  if (Number.isFinite(status) && statusCandidate !== null && statusCandidate !== undefined && String(statusCandidate).trim() !== '') {
    if (status === 0 || status === 408 || status === 502 || status === 503 || status === 504) return true;
    if (status >= 400 && status < 600) return false;
  }
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ERR_NETWORK', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_CLOSED', 'ERR_INTERNET_DISCONNECTED', 'ERR_TIMED_OUT', 'ERR_ABORTED', 'FETCH_FAILED'].includes(code)) {
    return true;
  }
  if (String(error?.name || '').toLowerCase() === 'aborterror') return true;
  const causeMessage = String(error?.cause?.message || '');
  if (causeMessage && /fetch failed|failed to fetch|enotfound|econnreset|econnrefused|etimedout/i.test(causeMessage)) {
    return true;
  }
  const message = rawMessage.toLowerCase();
  if (/fetch failed|failed to fetch|network request failed|networkerror|err_network|err_connection|err_internet_disconnected|\benotfound\b|\beconnreset\b|\beconnrefused\b|\betimedout\b|\beai_again\b|\benetunreach\b|\behostunreach\b/.test(message)) {
    return true;
  }
  // Our own withNetworkTimeout waiter ("... timed out after 12000ms") and
  // Node fetch timeouts are transport. Bare "timeout" alone is not enough
  // because Postgres statement timeouts contain that word.
  if (/timed out after \d+ms|timeout of \d+ms exceeded|network.*timed? ?out|fetch.*timed? ?out/i.test(rawMessage)) {
    return true;
  }
  // Offline signals from the platform/probe path.
  if (/\bnavi?gator\b.*\boffline\b|\boffline\b.*\bfetch\b|fetch.*\boffline\b|^offline$|\bnetwork is offline\b|\bno internet\b/i.test(rawMessage)) {
    return true;
  }
  return false;
}

function resolveOfflineManageUnlock(staff, pin) {
  const verified = validateCachedPosPin(staff.id, pin, { manager: true });
  if (!verified.success) return verified;
  const role = String(verified.staff?.role || staff.role || '').toLowerCase();
  if (!MANAGER_MANAGE_UNLOCK_ROLES.includes(role)) {
    return { success: false, error: 'A manager PIN is required to open Manage.' };
  }
  appendPosAudit('manager_manage_unlocked_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
  return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
}

/** @param {string|null} userId @param {string|null|undefined} pin @param {{manager?: boolean}} [options] @returns {PosCachedStaffPinResult} */
function validateCachedPosPin(userId, pin, { manager = false } = {}) {
  const user = getCachedPosUser(userId)
  if (!user || String(user.status || 'active').toLowerCase() !== 'active') {
    return { success: false, error: 'This staff account is not available in the trusted offline cache. Connect once and refresh the team list.' }
  }
  if (manager && !['supervisor', 'manager', 'admin', 'super_admin'].includes(String(user.role || '').toLowerCase())) {
    return { success: false, error: 'This cached staff account cannot approve manager actions.' }
  }
  if (!user.pin_hash) {
    return { success: false, error: 'This staff PIN was not prepared on this computer. Connect once and refresh staff access.' }
  }
  if (!String(pin || '').trim() || !bcrypt.compareSync(String(pin).trim(), user.pin_hash)) {
    return { success: false, error: `Incorrect staff PIN.${OPERATOR_PIN_RESET_HINT}` }
  }
  return {
    success: true,
    staff: {
      id: user.id,
      name: user.name || null,
      email: user.email || null,
      role: user.role || null,
      allowed_outlet_ids: user.allowed_outlet_ids || []
    }
  }
}

/** @returns {PosAttendanceShiftExpectedData[]} */
function readAttendanceShifts() {
  const rows = readCache(POS_ATTENDANCE_CACHE)
  // These fields are written by the attendance queue/cache paths; persisted JSON is not validated here.
  return Array.isArray(rows) ? /** @type {PosAttendanceShiftExpectedData[]} */ (rows) : []
}

/** @param {PosAttendanceShiftExpectedData[]} [rows] */
function writeAttendanceShifts(rows = []) {
  writeCache(POS_ATTENDANCE_CACHE, rows.slice(0, 500))
}

/** @param {PosAttendanceShiftExpectedData} [row] */
function upsertAttendanceShift(row = {}) {
  writeAttendanceShifts([row, ...readAttendanceShifts().filter((entry) => entry.id !== row.id)])
  return row
}

function readPosCashupSubmissions() {
  const rows = readCache(POS_CASHUP_SUBMISSION_CACHE)
  return Array.isArray(rows) ? rows : []
}

function writePosCashupSubmissions(rows = []) {
  writeCache(POS_CASHUP_SUBMISSION_CACHE, rows.slice(0, 500))
}

function upsertPosCashupSubmission(row = {}) {
  writePosCashupSubmissions([row, ...readPosCashupSubmissions().filter((entry) => entry.id !== row.id)])
  return row
}

/** @param {unknown} outletId @param {string} [snapshotId] */
function buildLocalPosCatalogSnapshot(outletId = null, snapshotId = randomUUID()) {
  const settings = getCachedPosSettings() || {}
  const items = (readCache('pos-menu-items') || [])
    .filter((item) => !item?.archived_at && (
      (outletId == null && item?.outlet_id == null) ||
      item?.outlet_id == null ||
      item?.outlet_id === outletId
    ))
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      price: Number(item.price || 0),
      is_available: item.is_available !== false,
      inventory_item_id: item.inventory_item_id || null,
      depletion_qty: normalizePositiveQty(item.depletion_qty, 1),
      outlet_id: item.outlet_id || null,
      barcode: item.barcode || null,
      kitchen_station_id: item.kitchen_station_id || null
    }))
  const payload = {
    items,
    modifier_groups: (readPosModifierGroups() || []).filter((group) => group?.active !== false),
    promotions: (readPosPromotions() || []).filter((promotion) => promotion?.active !== false),
    vat_enabled: settings.vat_enabled === true,
    vat_rate: Number(settings.vat_rate || 0)
  }
  const createdAt = new Date().toISOString()
  return {
    success: true,
    snapshot_id: snapshotId,
    outlet_id: outletId || null,
    payload,
    payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    item_count: items.length,
    created_at: createdAt,
    _pending_sync: true,
    _sync_state: 'pending'
  }
}

/** @param {unknown} outletId @param {unknown} [dependsOn] */
function queueLocalPosCatalogSnapshot(outletId = null, dependsOn = null) {
  const snapshot = buildLocalPosCatalogSnapshot(outletId)
  const queueId = `pos-catalog-snapshot-${snapshot.snapshot_id}`
  snapshot._queue_id = queueId
  writeCache('pos-catalog-snapshots', [
    snapshot,
    ...(readCache('pos-catalog-snapshots') || []).filter((entry) => (entry?.outlet_id || null) !== (outletId || null))
  ])
  queueOperation('rpc', 'publish_pos_catalog_snapshot_offline', {
    payload: {
      lodge_id: state.lodgeId,
      outlet_id: outletId || null,
      snapshot_id: snapshot.snapshot_id,
      client_created_at: snapshot.created_at,
      idempotency_key: `pos-catalog:${snapshot.snapshot_id}`
    }
  }, null, {
    _queue_id: queueId,
    ...(dependsOn ? { _depends_on: dependsOn } : {})
  })
  return snapshot
}

/** @param {unknown} value */
function hasFiniteRecordedMoney(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

/** @typedef {{method?: unknown, type?: unknown, amount?: unknown}} PosTenderExpectedData */
/** @typedef {Record<string, unknown> & {gross_subtotal?: unknown, gross?: unknown, subtotal?: unknown, net_subtotal?: unknown, net?: unknown}} PosOrderItemExpectedData */

/** @param {PosOrderExpectedData} [order] */
function hasRecordedPosTenderEnvelope(order = {}) {
  const breakdown = parseJsonField(order.payment_breakdown, null);
  if (!Array.isArray(breakdown) || breakdown.length === 0) return false;
  // Persisted tender JSON is only viewed as the existing row shape here; it is
  // not validated or rewritten by this read-certification check.
  const tenderRows = /** @type {PosTenderExpectedData[]} */ (breakdown);
  if (tenderRows.some((row) => !row || !String(row.method || row.type || '').trim() || !hasFiniteRecordedMoney(row.amount))) return false;
  const expected = Math.round(Number(order.total) * 100) / 100;
  const actual = Math.round(tenderRows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
  return Number.isFinite(expected) && Math.abs(expected - actual) <= 0.005;
}

/** @param {PosOrderExpectedData} [order] */
function hasIncompletePosItemDetail(order = {}) {
  const items = Array.isArray(order.pos_order_items)
    ? /** @type {PosOrderItemExpectedData[]} */ (order.pos_order_items)
    : Array.isArray(order.items)
      ? /** @type {PosOrderItemExpectedData[]} */ (order.items)
      : [];
  if (items.length === 0) return true;
  return items.some((item) => {
    const gross = ['gross_subtotal', 'gross', 'subtotal'].some((key) => hasFiniteRecordedMoney(item?.[key]));
    const net = ['net_subtotal', 'net', 'subtotal'].some((key) => hasFiniteRecordedMoney(item?.[key]));
    return !gross || !net;
  });
}

/**
 * @param {unknown} rows Expected history array produced by the query/merge or cache.
 * @param {unknown} source
 * @param {unknown} complete
 * @param {{tenderComplete?: unknown, itemDetailComplete?: unknown}} [metadata]
 * @returns {PosOrderReadRows}
 */
function withPosReadMetadata(rows, source, complete, metadata = {}) {
  // This expected-data view keeps the old trust boundary: malformed truthy
  // inputs are not normalized and native Object.defineProperties behavior stays.
  const result = /** @type {PosOrderExpectedData[]} */ (rows || []);
  Object.defineProperties(result, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete === true, enumerable: true, configurable: true },
    _tender_complete: { value: metadata.tenderComplete === true, enumerable: true, configurable: true },
    _item_detail_complete: { value: metadata.itemDetailComplete === true, enumerable: true, configurable: true }
  });
  return /** @type {PosOrderReadRows} */ (result);
}

/** @param {PosOrderExpectedData[]} [rows] */
function hasUnresolvedPosRows(rows = []) {
  return rows.some((order) => order?._pending_sync === true
    || ['pending', 'failed', 'manual_review_required'].includes(String(order?._sync_state || '').toLowerCase())
    || !['completed', 'settled', 'voided', 'cancelled'].includes(String(order?.status || '').toLowerCase())
    || (['completed', 'settled'].includes(String(order?.status || '').toLowerCase())
      && (!hasFiniteRecordedMoney(order?.total) || !hasRecordedPosTenderEnvelope(order))));
}

/** @param {PosOrderExpectedData[]} [rows] */
function hasUnresolvedPosTenderRows(rows = []) {
  return rows.some((order) => ['completed', 'settled'].includes(String(order?.status || '').toLowerCase()) && !hasRecordedPosTenderEnvelope(order));
}

/** @param {PosOrderExpectedData[]} [rows] */
function hasIncompletePosItemRows(rows = []) {
  return rows.some((order) => ['completed', 'settled'].includes(String(order?.status || '').toLowerCase()) && hasIncompletePosItemDetail(order));
}

/** @param {unknown} value @returns {string | null} */
function normalizeInclusiveDateEnd(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999`).toISOString();
  return raw;
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** @param {unknown} value @returns {number} */
function normalizeMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

/** @param {unknown} value @returns {number} */
function normalizePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

/** @param {unknown} value @param {unknown} fallback @returns {unknown} */
function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

/** @typedef {{order_id: unknown, menu_item_id: unknown, inventory_item_id: unknown, depletion_qty: unknown, item_name: unknown, quantity: unknown, unit_price: unknown, subtotal: unknown}} PosOrderItemProjection */
/** @typedef {{method: unknown, amount: number, reference: string | null, customer_id?: unknown, voucher_id?: unknown, code?: string}} PosPaymentRow */
/** @typedef {{method: unknown, reference: unknown}} PosPaymentReferenceView */

/** @param {unknown} payments @param {unknown} fallbackMethod @param {unknown} total @returns {PosPaymentRow[]} */
function normalizePaymentBreakdown(payments = [], fallbackMethod = 'cash', total = 0) {
  // The caller supplies the existing payment breakdown view; individual raw
  // fields remain unknown until the normalization expressions below handle them.
  const rows = /** @type {Record<string, unknown>[]} */ (Array.isArray(payments) ? payments : []);
  const normalized = rows.
  map((row) => ({
    method: String(row?.method || fallbackMethod || 'cash').trim().toLowerCase() || 'cash',
    amount: normalizeMoney(row?.amount),
    reference: String(row?.reference || '').trim() || null,
    ...(row?.customer_id ? { customer_id: row.customer_id } : {}),
    ...(row?.voucher_id ? { voucher_id: row.voucher_id } : {}),
    ...(row?.code ? { code: String(row.code).trim().toUpperCase() } : {}),
  })).
  filter((row) => row.amount !== 0);
  if (normalized.length === 0 && normalizeMoney(total) !== 0) {
    normalized.push({ method: fallbackMethod || 'cash', amount: normalizeMoney(total), reference: null });
  }
  return normalized;
}

/** @param {unknown} paymentBreakdown @param {unknown} fallbackMethod @returns {unknown} */
function validateProviderPaymentReferences(paymentBreakdown = [], fallbackMethod = 'cash') {
  // This private helper receives rows produced by normalizePaymentBreakdown;
  // it relies only on method/reference and makes no amount claim.
  const rows = Array.isArray(paymentBreakdown) && paymentBreakdown.length > 0
    ? /** @type {PosPaymentReferenceView[]} */ (paymentBreakdown)
    : [{ method: fallbackMethod, amount: 0, reference: null }];
  // Card and mobile-money references are optional on the restaurant bar
  // POS: a provider tender without a reference remains valid. A supplied
  // reference is length-guarded so it stays usable as audit evidence.
  const invalid = rows.filter((row) => {
    const method = String(row?.method || fallbackMethod || 'cash').trim().toLowerCase();
    if (method !== 'card' && method !== 'mobile_money') return false;
    return String(row?.reference || '').trim().length > 120;
  });
  if (invalid.length > 0) {
    const labels = [...new Set(invalid.map((row) => String(row?.method || fallbackMethod || 'cash').trim().toLowerCase() === 'mobile_money' ? 'mobile money' : 'card'))];
    throw new Error(`The ${labels.join(' and ')} reference must be 120 characters or fewer`);
  }
  return paymentBreakdown;
}

/** @param {Record<string, unknown>} order @returns {PosPaymentRow[]} */
function getOrderPaymentRows(order = {}) {
  const breakdown = parseJsonField(order.payment_breakdown, null);
  // An order-level payment_method is only a label. It cannot certify a
  // tender allocation for cash-up or financial reporting.
  if (Array.isArray(breakdown) && breakdown.length > 0) {
    return /** @type {Record<string, unknown>[]} */ (breakdown)
      .map((row) => ({
        method: String(row?.method || row?.type || '').trim().toLowerCase(),
        amount: Number(row?.amount),
        reference: String(row?.reference || '').trim() || null
      }))
      .filter((row) => row.method && Number.isFinite(row.amount) && row.amount !== 0);
  }
  return [];
}

/** @typedef {{name: unknown, qty: number, revenue: number, cost?: number, margin?: number}} PosRevenueItemAggregate */

/** Expected item projection from the SQL report's `items` JSON array; values are not validated here. @typedef {{item_name: string, name?: string|null, quantity: unknown, net?: unknown, subtotal?: unknown, gross?: unknown}} PosCertifiedRevenueItemExpectedData */
/** Expected row projection from get_pos_financial_report_export_v2; RPC JSON is not runtime-validated. @typedef {Record<string, unknown> & {classification: string, total: unknown, payment_method: string|null, cashier_name: string|null, cashier_id: string|null, business_date: string|null, items: unknown}} PosCertifiedRevenueRowExpectedData */
/** @typedef {{completed_sale_count: unknown, return_count: unknown, net_recorded_sales: unknown, gross_sales: unknown, discounts: unknown, returns: unknown, tax: unknown, tips: unknown, tender_totals: unknown}} PosCertifiedRevenueControlTotals */
/** Expected SQL JSON envelope; rows and controls remain unvalidated RPC data. @typedef {Record<string, unknown> & {rows: unknown, control_totals: unknown, report_run_id?: unknown, dataset_hash?: unknown, dataset_status?: unknown, source_coverage_complete?: unknown, row_count?: unknown, source_manifest?: Record<string, unknown>|null}} PosCertifiedRevenueExportEnvelope */
/**
 * @param {PosCertifiedRevenueExportEnvelope | Record<string, undefined>} [envelope]
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} [outletId]
 */
function buildCertifiedPosRevenueSummary(envelope = {}, startDate, endDate, outletId = 'all') {
  const rows = Array.isArray(envelope.rows) ? /** @type {PosCertifiedRevenueRowExpectedData[]} */ (envelope.rows) : [];
  const controls = /** @type {PosCertifiedRevenueControlTotals} */ (envelope.control_totals || {});
  /** @param {unknown} value @param {number} [fallback] @returns {number} */
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  /** @param {unknown} value @returns {number} */
  const round = (value) => Math.round(numeric(value) * 100) / 100;
  /** @type {Record<string, number>} */
  const byCashier = {};
  /** @type {Record<string, number>} */
  const daily = {};
  /** @type {Record<string, PosRevenueItemAggregate>} */
  const items = {};
  let folioRevenue = 0;
  for (const row of rows) {
    const classification = String(row.classification || '').toLowerCase();
    if (!['sale', 'return'].includes(classification)) continue;
    const signedTotal = classification === 'return' ? -Math.abs(numeric(row.total)) : numeric(row.total);
    if (String(row.payment_method || '').trim().toLowerCase() === 'folio') {
      folioRevenue = round(folioRevenue + signedTotal);
    }
    const cashier = row.cashier_name || row.cashier_id || 'Unassigned';
    byCashier[cashier] = round((byCashier[cashier] || 0) + signedTotal);
    const day = String(row.business_date || '').slice(0, 10);
    if (day) daily[day] = round((daily[day] || 0) + signedTotal);
    for (const item of Array.isArray(row.items) ? /** @type {PosCertifiedRevenueItemExpectedData[]} */ (row.items) : []) {
      const name = item.item_name || item.name || 'Unknown item';
      const entry = items[name] || { name, qty: 0, revenue: 0 };
      entry.qty += numeric(item.quantity);
      const lineAmount = item.net ?? item.subtotal ?? item.gross;
      entry.revenue = round(entry.revenue + (classification === 'return' ? -Math.abs(numeric(lineAmount)) : numeric(lineAmount)));
      items[name] = entry;
    }
  }
  const totalOrders = numeric(controls.completed_sale_count) + numeric(controls.return_count);
  const totalRevenue = numeric(controls.net_recorded_sales);
  return {
    total_revenue: round(totalRevenue),
    gross_revenue: round(controls.gross_sales),
    discount_total: round(controls.discounts),
    returns_total: round(controls.returns),
    tax_total: round(controls.tax),
    tip_total: round(controls.tips),
    net_revenue: round(totalRevenue),
    folio_revenue: round(folioRevenue),
    direct_revenue: round(totalRevenue - folioRevenue),
    total_orders: totalOrders,
    avg_order: numeric(controls.completed_sale_count) > 0 ? round(totalRevenue / numeric(controls.completed_sale_count)) : 0,
    by_payment: controls.tender_totals && typeof controls.tender_totals === 'object' ? controls.tender_totals : {},
    by_cashier: byCashier,
    top_items: Object.values(items).sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total })),
    source: 'server',
    complete: true,
    financial_truth: 'server_confirmed',
    dataset_status: 'certified',
    report_run_id: envelope.report_run_id || null,
    dataset_hash: envelope.dataset_hash || null,
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId
  };
}

/**
 * Expected request projection passed from createPosOrder. IPC item values
 * remain unvalidated; the existing numeric normalization below is unchanged.
 * @param {PosCreateOrderItemRequest[]} [items]
 * @param {Pick<PosCreateOrderRequest, 'gross_total' | 'discount_total' | 'tax_rate' | 'tax_total' | 'tip_total' | 'total'>} [data]
 */
function buildPosTotals(items = [], data = {}) {
  const itemSubtotal = (items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const grossFromItems = (items || []).reduce((sum, item) => {
    const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
    return lineTotal > 0 ? sum + lineTotal : sum;
  }, 0);
  const gross = normalizeMoney(data.gross_total ?? grossFromItems);
  const discount = normalizeMoney(data.discount_total ?? Math.max(0, gross - itemSubtotal));
  const taxableBase = Math.max(0, gross - discount);
  const taxRate = normalizePercent(data.tax_rate);
  const tax = normalizeMoney(data.tax_total ?? (taxRate > 0 ? taxableBase * taxRate / 100 : 0));
  const tip = normalizeMoney(data.tip_total || 0);
  const net = normalizeMoney(data.total ?? (itemSubtotal + tax + tip));
  return {
    gross_total: gross,
    discount_total: discount,
    tax_rate: taxRate,
    tax_total: tax,
    tip_total: tip,
    net_total: net,
    total: net
  };
}

/** @returns {import('../../shared/desktopIpcContracts.js').PosHardwareSettings} */
function readPosHardwareSettings() {
  const rows = readCache('pos-hardware-settings');
  const current = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const barcodeMinLength = Math.max(1, Math.min(128, Number(current.barcode_scanner_min_length) || 4));
  const barcodeMaxLength = Math.max(barcodeMinLength, Math.min(128, Number(current.barcode_scanner_max_length) || 128));
  return {
    receipt_printer_name: current.receipt_printer_name || '',
    receipt_paper_width: current.receipt_paper_width || '80mm',
    receipt_print_mode: current.receipt_print_mode || (current.escpos_enabled === true ? 'escpos' : 'windows'),
    auto_print_receipts: current.auto_print_receipts === true,
    receipt_cut_enabled: current.receipt_cut_enabled !== false,
    cash_drawer_enabled: current.cash_drawer_enabled === true,
    cash_drawer_manual: current.cash_drawer_manual === true,
    cash_drawer_command: current.cash_drawer_command || 'ESC/POS kick',
    cash_drawer_open_on_cash: current.cash_drawer_open_on_cash === true,
    cash_drawer_open_timing: current.cash_drawer_open_timing || 'after_payment',
    cash_drawer_pin: current.cash_drawer_pin || '0',
    cash_drawer_pulse_on_ms: current.cash_drawer_pulse_on_ms || 50,
    cash_drawer_pulse_off_ms: current.cash_drawer_pulse_off_ms || 250,
    escpos_enabled: current.escpos_enabled === true,
    escpos_connection_type: current.escpos_connection_type || 'network',
    escpos_network_host: current.escpos_network_host || '',
    escpos_network_port: current.escpos_network_port || 9100,
    escpos_printer_path: current.escpos_printer_path || '',
    escpos_codepage: current.escpos_codepage || 'cp437',
    escpos_timeout_ms: current.escpos_timeout_ms || 8000,
    payment_terminal_provider: current.payment_terminal_provider || '',
    payment_terminal_name: current.payment_terminal_name || '',
    payment_terminal_mode: current.payment_terminal_mode || 'manual',
    payment_terminal_bridge_url: current.payment_terminal_bridge_url || '',
    payment_terminal_timeout_ms: current.payment_terminal_timeout_ms || 8000,
    barcode_scanner_enabled: current.barcode_scanner_enabled !== false,
    barcode_scanner_min_length: barcodeMinLength,
    barcode_scanner_max_length: barcodeMaxLength,
    barcode_scanner_inter_key_ms: Number.isFinite(Number(current.barcode_scanner_inter_key_ms)) ? Number(current.barcode_scanner_inter_key_ms) : 120,
    barcode_scanner_idle_complete_ms: Number.isFinite(Number(current.barcode_scanner_idle_complete_ms)) ? Number(current.barcode_scanner_idle_complete_ms) : 180,
    barcode_scanner_accept_enter: current.barcode_scanner_accept_enter !== false,
    barcode_scanner_accept_tab: current.barcode_scanner_accept_tab !== false,
    barcode_scanner_prefix: String(current.barcode_scanner_prefix || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16),
    barcode_scanner_suffix: String(current.barcode_scanner_suffix || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16),
    barcode_scanner_sound_enabled: current.barcode_scanner_sound_enabled !== false,
    scanner_last_verified_at: current.scanner_last_verified_at || null,
    scanner_last_terminator: String(current.scanner_last_terminator || '').replace(/[\u0000-\u001f\u007f]/g, ''),
    scanner_last_character_count: Number.isFinite(Number(current.scanner_last_character_count)) ? Number(current.scanner_last_character_count) : null,
    scanner_last_average_inter_key_ms: Number.isFinite(Number(current.scanner_last_average_inter_key_ms)) ? Number(current.scanner_last_average_inter_key_ms) : null,
    hardware_last_test_at: current.hardware_last_test_at || null,
    hardware_last_test_kind: String(current.hardware_last_test_kind || '').replace(/[\u0000-\u001f\u007f]/g, ''),
    hardware_last_test_success: current.hardware_last_test_success === true,
    customer_display_enabled: current.customer_display_enabled === true,
    display_welcome_message: String(current.display_welcome_message || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 140),
    display_customer_display_id: String(current.display_customer_display_id || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
    display_bar_display_id: String(current.display_bar_display_id || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
    display_kitchen_display_id: String(current.display_kitchen_display_id || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64),
    display_customer_auto_open: current.display_customer_auto_open === true,
    updated_at: current.updated_at || null
  };
}

function writePosHardwareSettings(settings = {}) {
  const row = {
    ...readPosHardwareSettings(),
    ...settings,
    updated_at: new Date().toISOString()
  };
  writeCache('pos-hardware-settings', [row]);
  return row;
}

function readPosCashups() {
  const rows = readCache('pos-cashups');
  return Array.isArray(rows) ? rows : [];
}

function writePosCashups(rows = []) {
  writeCache('pos-cashups', rows.slice(0, 500));
}

function upsertLocalPosCashup(row = {}) {
  const normalized = {
    ...row,
    id: row.id || randomUUID(),
    lodge_id: row.lodge_id || state.lodgeId,
    created_by: row.created_by || state.currentUser?.id || null,
    created_by_name: row.created_by_name || state.currentUser?.name || null,
    created_at: row.created_at || new Date().toISOString()
  };
  const next = [
    normalized,
    ...readPosCashups().filter((entry) => entry.id !== normalized.id)
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  writePosCashups(next);
  return normalized;
}

function readPosModifierGroups() {
  const rows = readCache('pos-modifier-groups');
  return Array.isArray(rows) ? rows : [];
}

function writePosModifierGroups(rows = []) {
  writeCache('pos-modifier-groups', rows.slice(0, 500));
  // Freshness marker: an absent marker means requirements are UNKNOWN
  // (never confuse with known-empty). Domain pre-checks skip without it;
  // the server trigger remains the authoritative backstop.
  writeCache('pos-modifier-groups-meta', { fetchedAt: new Date().toISOString() });
}

/**
 * Domain pre-dispatch check for required modifier choices. Runs before
 * checkout and tab-hold payloads leave this process (online and offline
 * queue building alike). Skips only when group definitions were never
 * loaded here — the server trigger still enforces at insert.
 */
export function assertSaleModifierRequirements(items) {
  const meta = readCache('pos-modifier-groups-meta');
  if (!meta || typeof meta !== 'object' || !meta.fetchedAt) return;
  const check = validateSaleModifierRequirements(items, readPosModifierGroups(), true);
  if (!check.ok) throw new Error(check.error);
}

function readPosPromotions() {
  const rows = readCache('pos-promotions');
  return Array.isArray(rows) ? rows : [];
}

function writePosPromotions(rows = []) {
  writeCache('pos-promotions', rows.slice(0, 500));
}

function readPosAuditLog() {
  const rows = readCache('pos-audit-log');
  return Array.isArray(rows) ? rows : [];
}

function writePosAuditLog(rows = []) {
  writeCache('pos-audit-log', rows.slice(0, 2000));
}

function appendPosAudit(action, details = {}) {
  const row = {
    id: details.id || randomUUID(),
    lodge_id: state.lodgeId,
    action,
    entity_type: details.entity_type || null,
    entity_id: details.entity_id || null,
    staff_id: details.staff_id || state.currentUser?.id || null,
    staff_name: details.staff_name || state.currentUser?.name || state.currentUser?.email || null,
    details: details.details || details,
    created_at: details.created_at || new Date().toISOString()
  };
  writePosAuditLog([row, ...readPosAuditLog()]);
  if (state.isOnline && state.supabase) {
    Promise.resolve(state.supabase.rpc('append_pos_audit_log', { payload: row })).catch(() => {});
  }
  return row;
}

function readPosFloorLayout() {
  const value = readCache('pos-floor-layout');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { areas: [] };
}

function writePosFloorLayout(layout = {}) {
  const normalized = {
    areas: Array.isArray(layout.areas) ? layout.areas.slice(0, 50) : [],
    updated_at: new Date().toISOString()
  };
  writeCache('pos-floor-layout', normalized);
  return normalized;
}

function writeCustomerDisplaySnapshot(snapshot = {}) {
  const row = {
    ...snapshot,
    lodge_id: state.lodgeId,
    updated_at: new Date().toISOString()
  };
  writeCache('pos-customer-display', row);
  return row;
}

const POS_MENU_VERIFICATION_CACHE_KEY = 'pos-menu-verification';
const POS_MENU_READ_TIMEOUT_MS = 12000;
const POS_MENU_FINGERPRINT_RPC = 'get_pos_menu_catalog_fingerprint_v1';
// WP D measured request deadlines: reads fail fast to cache, while a financial
// submit gets a longer but still bounded window before the waiter abandons the
// unanswered request. Abandoning never clears the submit journal, so recovery
// reuses the exact same operation key. Tests may shrink the deadline through
// state.posSubmitDeadlineMs so fault behavior is exercised without waiting.
const POS_SUBMIT_TIMEOUT_MS = 20000;

function posSubmitDeadlineMs() {
  const override = Number(state.posSubmitDeadlineMs);
  return Number.isFinite(override) && override > 0 ? override : POS_SUBMIT_TIMEOUT_MS;
}

function readPosMenuVerification() {
  const value = readCache(POS_MENU_VERIFICATION_CACHE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isMissingMenuFingerprintRpc(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  if (!/get_pos_menu_catalog_fingerprint_v1/i.test(message)) return false;
  if (code === 'PGRST202' || code === 'PGRST203' || code === '42883' || code === '404') return true;
  return /could not find the function|does not exist|schema cache|not found/i.test(message);
}

// R8 completeness contract: the staff read must prove it returned the caller's
// whole catalogue before it may replace a catalogue that was already verified
// complete. The fingerprint RPC is absent on older servers, so an unverified
// read is only persisted when there is no verified catalogue to protect.
async function readPosMenuFingerprint(rows) {
  const checkedAt = new Date().toISOString();
  const base = { schema: 1, lodge_id: state.lodgeId, returned_count: rows.length, checked_at: checkedAt };
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc(POS_MENU_FINGERPRINT_RPC, { p_lodge_id: state.lodgeId }),
      POS_MENU_READ_TIMEOUT_MS,
      'Menu completeness'
    );
    if (error) throw error;
    const fingerprint = data && typeof data === 'object' ? data : null;
    if (!fingerprint) throw new Error('The catalogue fingerprint response was empty.');
    if (fingerprint.success !== true || !Number.isInteger(fingerprint.item_count)) {
      throw new Error('The catalogue fingerprint response was not usable.');
    }
    return {
      ...base,
      outcome: fingerprint.item_count === rows.length ? 'verified' : 'incomplete',
      source: 'fingerprint',
      item_count: fingerprint.item_count,
      outlet_scoped: fingerprint.outlet_scoped === true
    };
  } catch (error) {
    if (isMissingMenuFingerprintRpc(error)) {
      return { ...base, outcome: 'unverifiable', source: 'legacy_server', message: 'The completeness fingerprint RPC is not deployed yet.' };
    }
    return {
      ...base,
      outcome: 'unverifiable',
      source: 'fingerprint_error',
      message: String(error?.message || error || 'Completeness could not be verified.')
    };
  }
}

// outletFilter: null = all outlets, [] = no access, [uuid1,...] = restrict to these outlet IDs
async function _getPosMenuItems(outletFilter = null) {
  if (state.isOnline) {
    try {
      const { data, error } = await withNetworkTimeout(
        state.supabase.rpc('get_pos_menu_items_for_staff_v1', { p_lodge_id: state.lodgeId }),
        POS_MENU_READ_TIMEOUT_MS,
        'Menu list'
      );
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : [];
      const verification = await readPosMenuFingerprint(rows);
      if (verification.outcome === 'verified') {
        writeCache('pos-menu-items', rows);
        writeCache(POS_MENU_VERIFICATION_CACHE_KEY, verification);
        return applyPosMenuOutletFilter(rows, outletFilter);
      }
      // This read cannot prove completeness or scope. Serve the previously
      // verified catalogue when one exists; never overwrite it with a partial,
      // wrong-scope or unverifiable read.
      const cached = readCache('pos-menu-items');
      const cachedRows = Array.isArray(cached) ? cached : null;
      const verifiedCatalogue = Boolean(cachedRows) && readPosMenuVerification()?.outcome === 'verified';
      if (verification.outcome === 'incomplete' || verifiedCatalogue) {
        if (cachedRows && (cachedRows.length || verifiedCatalogue)) {
          return applyPosMenuOutletFilter(cachedRows, outletFilter);
        }
        const detail = verification.outcome === 'incomplete'
          ? `the server reported ${verification.item_count} products but returned ${rows.length}`
          : 'its completeness could not be verified';
        const incomplete = /** @type {PosCodedError} */ (new Error(`The sellable product list could not be verified as complete (${detail}). Reconnect and refresh before selling.`));
        incomplete.code = 'pos_menu_read_incomplete';
        throw incomplete;
      }
      // No verified catalogue exists yet (fresh install or an earlier
      // unverified read): persist this read so the till can open, and record
      // that completeness is unproven so later reads can upgrade it.
      writeCache('pos-menu-items', rows);
      writeCache(POS_MENU_VERIFICATION_CACHE_KEY, verification);
      return applyPosMenuOutletFilter(rows, outletFilter);
    } catch (error) {
      // Keep a previously verified catalogue usable during a transient outage
      // (a verified empty catalogue is a legitimate empty menu). With no
      // verified catalogue, report the failed read instead of presenting an
      // empty response that operators could mistake for a valid empty menu.
      const cached = readCache('pos-menu-items');
      const verifiedCatalogue = Array.isArray(cached) && readPosMenuVerification()?.outcome === 'verified';
      if (Array.isArray(cached) && (cached.length || verifiedCatalogue)) {
        return applyPosMenuOutletFilter(cached, outletFilter);
      }
      if (error?.code === 'pos_menu_read_incomplete') throw error;
      const detail = String(error?.message || '').trim();
      const unavailable = /** @type {PosCodedError} */ (new Error(detail
        ? 'The sellable product list could not be verified. ' + detail
        : 'The sellable product list could not be verified. Reconnect and refresh before selling.'));
      unavailable.code = error?.code || 'pos_menu_read_unavailable';
      throw unavailable;
    }
  }
  return applyPosMenuOutletFilter(readCache('pos-menu-items'), outletFilter);
}

export function getPosMenuItems(outletFilter = null) {
  return dedupePromise(`getPosMenuItems:${JSON.stringify(outletFilter)}`, () => _getPosMenuItems(outletFilter));
}

async function _getActivePosCatalogSnapshot(outletId = null) {
  const readCachedSnapshot = () => {
    const cached = readCache('pos-catalog-snapshots');
    const rows = Array.isArray(cached) ? cached : [];
    return rows.find((entry) =>
      entry?.success === true &&
      entry?.snapshot_id &&
      (entry?.outlet_id || null) === (outletId || null)
    ) || null;
  };

  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase.rpc('get_active_pos_catalog_snapshot', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'No active catalog snapshot. Publish a catalog before trading.');
    const rows = readCache('pos-catalog-snapshots');
    const next = [
      data,
      ...(Array.isArray(rows) ? rows : []).filter((entry) =>
        (entry?.outlet_id || null) !== (outletId || null)
      )
    ];
    writeCache('pos-catalog-snapshots', next);
    return data;
  }
  const cached = readCachedSnapshot();
  if (cached) return cached;
  throw new Error('No catalog snapshot available. Connect to the internet and publish a catalog.');
}

/** @param {string | null} [outletId] */
export function getActivePosCatalogSnapshot(outletId = null) {
  return dedupePromise(`getActivePosCatalogSnapshot:${outletId || 'all'}`, () => _getActivePosCatalogSnapshot(outletId));
}

export async function publishPosCatalogSnapshot(outletId = null) {
  if (!state.isOnline) {
    const snapshot = queueLocalPosCatalogSnapshot(outletId)
    return { ...snapshot, offline: true, queued: true }
  }
  const { data, error } = await state.supabase.rpc('publish_pos_catalog_snapshot', {
    p_lodge_id: state.lodgeId,
    p_outlet_id: outletId || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not publish catalog snapshot');
  return _getActivePosCatalogSnapshot(outletId);
}

async function publishPosCatalogSnapshotsForChange(outletIds = []) {
  const requested = [...new Set(outletIds.map((value) => value || null))];
  const targets = new Set(requested);
  if (requested.includes(null)) {
    const outlets = await getOutlets();
    for (const outlet of outlets || []) {
      if (outlet?.id) targets.add(outlet.id);
    }
  }
  for (const outletId of targets) {
    await publishPosCatalogSnapshot(outletId);
  }
}

export async function getPosMenuItemById(id) {
  if (!id) return null;
  try {
    const rows = await getPosMenuItems(null);
    return Array.isArray(rows) ? rows.find((item) => String(item?.id) === String(id)) || null : null;
  } catch {
    return readCache('pos-menu-items').find((item) => item.id === id) || null;
  }
}

export async function createPosMenuItem(data) {
  const localId = data.id || randomUUID();
  const item = {
    id: localId,
    lodge_id: state.lodgeId,
    name: data.name,
    category: data.category || 'Other',
    price: Number(data.price) || 0,
    is_available: data.is_available !== false,
    barcode: data.barcode || null,
    stock_method: data.stock_method || (data.inventory_item_id ? 'direct' : 'recipe'),
    inventory_item_id: data.inventory_item_id || null,
    // Keep measured pours (for example 0.05 bottles/litres) intact while
    // failing closed to one stock unit for invalid client payloads. The
    // authoritative catalog/order contracts apply the same positive-quantity
    // rule when this value reaches the database.
    depletion_qty: data.inventory_item_id ? normalizePositiveQty(data.depletion_qty, 1) : null,
    outlet_id: data.outlet_id || null,
    dietary_flags: Array.isArray(data.dietary_flags) ? data.dietary_flags : [],
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    is_popular: data.is_popular === true,
    kitchen_station_id: data.kitchen_station_id || null
  };
    if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_pos_menu_item', { payload: item });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item');
    await publishPosCatalogSnapshotsForChange([item.outlet_id]).catch((error) => {
      throw new Error(`Menu item was saved, but catalog publication failed: ${error.message}`);
    });
    return { success: true, id: result?.id };
  }
  const pending = { ...item, _pending_sync: true, _sync_state: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const queueId = `pos-menu-item-${localId}`;
  // Tag offline creates so the Till names them provisional (sellable offline
  // at the entered price, blocked once the server is reachable but the sync
  // is still outstanding) and replays can pair them if ever needed.
  pending._operation_key = queueId;
  writeCache('pos-menu-items', [pending, ...(readCache('pos-menu-items') || []).filter((row) => row.id !== localId)]);
  const inventory = item.inventory_item_id ? (readCache('inventory-items') || []).find((row) => row.id === item.inventory_item_id) : null;
  queueOperation('rpc', 'create_pos_menu_item_offline', { payload: item }, null, {
    _queue_id: queueId,
    ...(inventory?._pending_sync ? { _depends_on: `inventory-item-${inventory.id}` } : {})
  });
  const snapshot = queueLocalPosCatalogSnapshot(item.outlet_id, queueId);
  return { success: true, id: localId, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
}

export async function updatePosMenuItem(id, data) {
  const existing = await getPosMenuItemById(id).catch(() => null);
  const operationKey = data?.operation_key || data?.operationKey || randomUUID();
  const update = {
    name: data.name,
    category: data.category,
    price: Number(data.price),
    is_available: data.is_available,
    barcode: data.barcode || null,
    stock_method: data.stock_method || existing?.stock_method || (data.inventory_item_id ? 'direct' : 'recipe'),
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? normalizePositiveQty(data.depletion_qty, 1) : null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}),
    dietary_flags: Array.isArray(data.dietary_flags) ? data.dietary_flags : [],
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    is_popular: data.is_popular === true,
    kitchen_station_id: data.kitchen_station_id || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_pos_menu_item', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item');
    await publishPosCatalogSnapshotsForChange([
      existing?.outlet_id || null,
      update.outlet_id ?? existing?.outlet_id ?? null
    ]).catch((publishError) => {
      throw new Error(`Menu item was saved, but catalog publication failed: ${publishError.message}`);
    });
    return { success: true };
  }
  if (!existing) throw new Error('Menu item not found in the offline cache.');
  writeCache('pos-menu-items', (readCache('pos-menu-items') || []).map((row) => row.id === id ? {
    ...row, ...update, _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString()
  } : row));
  const queueId = `pos-menu-item-update-${id}-${operationKey}`;
  queueOperation('rpc', 'update_pos_menu_item_offline', { payload: {
    ...update,
    lodge_id: state.lodgeId,
    menu_item_id: id,
    operation_key: operationKey
  } }, null, { _queue_id: queueId });
  const snapshot = queueLocalPosCatalogSnapshot(update.outlet_id ?? existing.outlet_id ?? null, queueId);
  return { success: true, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
}

export async function deletePosMenuItem(id) {
  const existing = await getPosMenuItemById(id).catch(() => null);
  if (!state.isOnline) {
    if (!existing) throw new Error('Menu item not found in the offline cache.');
    writeCache('pos-menu-items', (readCache('pos-menu-items') || []).map((row) => row.id === id ? {
      ...row, archived_at: new Date().toISOString(), is_available: false,
      _pending_sync: true, _sync_state: 'pending'
    } : row));
    const queueId = `pos-menu-item-delete-${id}-${Date.now()}`;
    queueOperation('rpc', 'delete_pos_menu_item', { p_id: id, p_lodge_id: state.lodgeId }, null, { _queue_id: queueId });
    const snapshot = queueLocalPosCatalogSnapshot(existing.outlet_id || null, queueId);
    return { success: true, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
  }
  const { data: result, error } = await state.supabase.rpc('delete_pos_menu_item', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item');
  await publishPosCatalogSnapshotsForChange([existing?.outlet_id || null]).catch((publishError) => {
    throw new Error(`Menu item was deleted, but catalog publication failed: ${publishError.message}`);
  });
  // Pass the server outcome flags through (soft_deleted/already_deleted/
  // stock_delisted) so surfaces can tell the operator exactly what happened.
  return { ...result, success: true };
}

/** @param {BarPackTemplateRequest} data */
export async function setBarPosPackTemplate(data) {
  const rawBarcode = data?.barcode == null ? '' : String(data.barcode).trim();
  if (rawBarcode.length > 128 || /[\u0000-\u001f\u007f]/.test(rawBarcode)) {
    throw new Error('Pack barcode must be 128 characters or fewer and contain no control characters.');
  }
  const payload = {
    lodge_id: state.lodgeId,
    inventory_item_id: data.inventory_item_id,
    pack_size: Number(data.pack_size),
    enabled: data.enabled === true,
    menu_item_id: data.menu_item_id || randomUUID(),
    ...(Object.prototype.hasOwnProperty.call(data || {}, 'barcode') ? { barcode: rawBarcode || null } : {})
  };
  if (!state.isOnline) {
    const inventory = /** @type {PosCachedInventoryItem[]} */ (readCache('inventory-items') || []).find((row) => row.id === payload.inventory_item_id);
    if (!inventory) throw new Error('Bar inventory product not found in the offline cache.');
    const existing = /** @type {PosCachedMenuItem[]} */ (readCache('pos-menu-items') || []).find((row) =>
      row.inventory_item_id === payload.inventory_item_id &&
      row.template_kind === 'bar_pack' &&
      Number(row.template_pack_size) === payload.pack_size
    );
    const menuItemId = existing?.id || payload.menu_item_id;
    payload.menu_item_id = menuItemId;
    const row = {
      ...(existing || {}), id: menuItemId, lodge_id: state.lodgeId,
      name: payload.pack_size === 24 ? `${inventory.name} Case (24)` : `${inventory.name} ${payload.pack_size} Pack`,
      category: 'Drinks', price: Number(inventory.selling_price || 0) * payload.pack_size,
      is_available: payload.enabled, barcode: rawBarcode || existing?.barcode || null,
      inventory_item_id: inventory.id, depletion_qty: payload.pack_size,
      outlet_id: inventory.outlet_id || null, template_kind: 'bar_pack', template_pack_size: payload.pack_size,
      _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString()
    };
    writeCache('pos-menu-items', [row, .../** @type {PosCachedMenuItem[]} */ (readCache('pos-menu-items') || []).filter((entry) => entry.id !== menuItemId)]);
    const queueId = `bar-pack-${payload.inventory_item_id}-${payload.pack_size}-${Date.now()}`;
    queueOperation('rpc', 'set_bar_pos_pack_template_offline', { payload }, null, {
      _queue_id: queueId,
      ...(inventory._pending_sync ? { _depends_on: `inventory-item-${inventory.id}` } : {})
    });
    const snapshot = queueLocalPosCatalogSnapshot(inventory.outlet_id || null, queueId);
    return { success: true, id: menuItemId, outlet_id: inventory.outlet_id || null, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
  }
  const { data: result, error } = await state.supabase.rpc('set_bar_pos_pack_template', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update Bar POS template');
  await publishPosCatalogSnapshotsForChange([result?.outlet_id || null]).catch((publishError) => {
    throw new Error(`Pack template was saved, but catalog publication failed: ${publishError.message}`);
  });
  return { ...result, success: true };
}

/** @param {BarPosProductWithPacksRequest} [data] */
export async function saveBarPosProductWithPacks(data = {}) {
  const rawBarcode = data?.barcode == null ? '' : String(data.barcode).trim();
  if (rawBarcode.length > 128 || /[\u0000-\u001f\u007f]/.test(rawBarcode)) throw new Error('Product barcode must be 128 characters or fewer and contain no control characters.');
  const cachedMenu = /** @type {PosCachedMenuItem[]} */ (readCache('pos-menu-items') || []);
  const packs = /** @type {BarPackSize[]} */ ([6, 12, 24]).map((packSize) => ({
    pack_size: packSize,
    enabled: data[/** @type {'pack6' | 'pack12' | 'pack24'} */ (`pack${packSize}`)] === true,
    barcode: data[/** @type {'pack6Barcode' | 'pack12Barcode' | 'pack24Barcode'} */ (`pack${packSize}Barcode`)] || null,
    menu_item_id: cachedMenu.find((row) => row.inventory_item_id === data.inventory_item_id && row.template_kind === 'bar_pack' && Number(row.template_pack_size) === packSize)?.id || randomUUID()
  }));
  const localMenuItemId = data.menu_item_id || randomUUID();
  const payload = {
    lodge_id: state.lodgeId,
    menu_item_id: data.menu_item_id || null,
    id: localMenuItemId,
    operation_key: data.operation_key || randomUUID(),
    name: data.name,
    category: data.category || 'Drinks',
    price: Number(data.price) || 0,
    is_available: data.is_available !== false,
    barcode: rawBarcode || null,
    stock_method: data.stock_method || 'direct',
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? normalizePositiveQty(data.depletion_qty, 1) : null,
    outlet_id: data.outlet_id || null,
    dietary_flags: Array.isArray(data.dietary_flags) ? data.dietary_flags : [],
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    is_popular: data.is_popular === true,
    kitchen_station_id: data.kitchen_station_id || null,
    packs
  };
  if (!state.isOnline) {
    const inventory = /** @type {PosCachedInventoryItem[]} */ (readCache('inventory-items') || []).find((row) => row.id === payload.inventory_item_id);
    if (payload.inventory_item_id && !inventory) throw new Error('The linked stock item is not available in the offline cache.');
    const baseRow = {
      ...(cachedMenu.find((row) => row.id === localMenuItemId) || {}),
      id: localMenuItemId, lodge_id: state.lodgeId, name: payload.name, category: payload.category,
      price: payload.price, is_available: payload.is_available, barcode: payload.barcode,
      stock_method: payload.stock_method, inventory_item_id: payload.inventory_item_id,
      depletion_qty: payload.depletion_qty, outlet_id: payload.outlet_id,
      dietary_flags: payload.dietary_flags, prep_time_minutes: payload.prep_time_minutes,
      is_popular: payload.is_popular, kitchen_station_id: payload.kitchen_station_id,
      _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString()
    };
    const packRows = packs.filter((pack) => pack.enabled).map((pack) => ({
      id: pack.menu_item_id, lodge_id: state.lodgeId,
      name: pack.pack_size === 24 ? `${payload.name} Case (24)` : `${payload.name} ${pack.pack_size} Pack`,
      category: 'Drinks', price: Number(inventory?.selling_price || payload.price || 0) * pack.pack_size,
      is_available: true, barcode: pack.barcode || null, inventory_item_id: payload.inventory_item_id,
      depletion_qty: pack.pack_size, outlet_id: payload.outlet_id || inventory?.outlet_id || null,
      template_kind: 'bar_pack', template_pack_size: pack.pack_size,
      _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString()
    }));
    const replacedIds = new Set([localMenuItemId, ...packs.map((pack) => pack.menu_item_id)]);
    writeCache('pos-menu-items', [baseRow, ...packRows, ...cachedMenu.filter((row) => !replacedIds.has(row.id))]);
    const queueId = `bar-product-${payload.operation_key}`;
    queueOperation('rpc', 'save_bar_pos_product_with_packs_offline', { payload }, null, {
      _queue_id: queueId,
      ...(inventory?._pending_sync ? { _depends_on: `inventory-item-${inventory.id}` } : {})
    });
    const snapshot = queueLocalPosCatalogSnapshot(payload.outlet_id || inventory?.outlet_id || null, queueId);
    return { success: true, id: localMenuItemId, menu_item_id: localMenuItemId, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
  }
  const { data: result, error } = await state.supabase.rpc('save_bar_pos_product_with_packs', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save Bar product and packs');
  await publishPosCatalogSnapshotsForChange([payload.outlet_id]).catch((publishError) => { throw new Error(`Product was saved, but catalog publication failed: ${publishError.message}`); });
  return { ...result, success: true };
}

/**
 * Expected row shape written by createProductSaveFlow. Cache JSON remains
 * unvalidated; callers keep their existing guards before consuming fields.
 * @typedef {Record<string, unknown> & {operation_key: string, payload: unknown, state: 'unsent'|'queued'|'unknown'|'pending-upgrade'|'committed'|'rejected', created_at: string, result?: unknown, error?: unknown, entity_ids?: unknown, publication?: unknown}} ProductSaveRequestCacheRow
 * @typedef {Record<string, unknown> & {
 *   operation_key: string,
 *   menu_item_id: string|null,
 *   inventory_item_id: string,
 *   product: Record<string, unknown> & {name: string, category: string, price: number, barcode: string|null, depletion_qty: number, is_available: boolean},
 *   stock: Record<string, unknown> & {mode: 'link'|'create', name: string, category: string, unit: string, barcode: string|null, outlet_id: unknown, opening_stock: number, reorder_level: number, unit_cost: number, selling_price: number},
 *   packs: Array<{pack_size: number, enabled: boolean, barcode: unknown}>
 * }} ProductSaveRequestPayloadReadView
 * @typedef {Partial<Pick<ProductSaveRequestPayloadReadView['product'], 'name'|'category'|'price'|'is_available'|'barcode'|'depletion_qty'>>} ProductSaveOfflineProductReadView
 * @typedef {Partial<Pick<ProductSaveRequestPayloadReadView['stock'], 'mode'|'name'|'category'|'unit'|'outlet_id'|'opening_stock'|'reorder_level'>>} ProductSaveOfflineStockReadView
 * @typedef {Record<string, unknown> & {menu_item_id?: unknown, inventory_item_id?: unknown, outlet_ids?: unknown}} ProductSaveRpcResultReadView
 * @typedef {{menu_item_id?: unknown, inventory_item_id?: unknown}} ProductSaveEntityIdsReadView
 * @typedef {Record<string, unknown> & {id?: unknown, _operation_key?: unknown}} ProductSaveCachedRowReadView
 */
/** @returns {ProductSaveRequestCacheRow[]} */
function readProductRequests() {
  const rows = readCache('product-requests');
  return Array.isArray(rows) ? /** @type {ProductSaveRequestCacheRow[]} */ (rows) : [];
}

/** @param {unknown} rows */
function writeProductRequests(rows) {
  writeCache('product-requests', Array.isArray(rows) ? rows : []);
}

/** @param {unknown} operationKey @param {Record<string, unknown>} patch */
function markProductRequest(operationKey, patch) {
  writeProductRequests(
    readProductRequests().map((entry) =>
      entry?.operation_key === operationKey ? { ...entry, ...patch } : entry,
    ),
  );
}

// Single module-scope flow so concurrent clicks single-flight on the key.
const productSaveFlow = createProductSaveFlow({
  readRequest: (key) => readProductRequests().find((entry) => entry?.operation_key === key) || null,
  listRequests: () => readProductRequests(),
  writeRequest: (entry) => {
    writeProductRequests([
      ...readProductRequests().filter((row) => row?.operation_key !== entry?.operation_key),
      entry,
    ]);
  },
  removeRequest: (key) => {
    writeProductRequests(readProductRequests().filter((row) => row?.operation_key !== key));
  },
  queueOffline: async (entry) => {
    queueOperation("rpc", "save_bar_product_with_stock", { payload: entry.payload }, null, {
      _queue_id: `bar-product-stock-${entry.operation_key}`,
    });
    // Queue a local catalog snapshot behind the product replay so offline
    // sales of this product resolve server pricing at replay time. The
    // snapshot carries the entered prices; the server rebuilds it from the
    // live catalog (including this product) when it replays.
    // Optimistic provisional rows so an offline save stays visible (marked
    // pending) instead of "disappearing" until the replay lands. Creates use
    // provisional `pending:` ids the Till sells offline at the entered price
    // (clearly marked provisional); the replay rewrites them to the real
    // server ids and purges them by operation key on success. Edits update
    // the cached row in place and keep selling.
    try {
      // This journal/cache-derived payload is not runtime-validated. These
      // expected-data views retain the existing property reads and fallbacks.
      const product = /** @type {ProductSaveOfflineProductReadView} */ (
        /** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.product || {}
      );
      const stock = /** @type {ProductSaveOfflineStockReadView} */ (
        /** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.stock || {}
      );
      const nowIso = new Date().toISOString();
      const isCreate = !/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.menu_item_id;
      const menuId = /** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.menu_item_id || `pending:${entry.operation_key}`;
      const cachedMenu = /** @type {ProductSaveCachedRowReadView[]} */ (readCache('pos-menu-items') || []);
      const menuRow = {
        ...(cachedMenu.find((row) => row?.id === menuId) || {}),
        id: menuId,
        lodge_id: state.lodgeId,
        name: product.name || 'Product',
        category: product.category || 'Drinks',
        price: Number(product.price) || 0,
        is_available: product.is_available !== false,
        barcode: product.barcode || null,
        stock_method: 'direct',
        inventory_item_id: stock.mode === 'link'
          ? (/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.inventory_item_id || null)
          : (`pending:${entry.operation_key}:stock`),
        depletion_qty: Number(product.depletion_qty) || 1,
        outlet_id: stock.outlet_id || null,
        updated_at: nowIso,
        ...(cachedMenu.some((row) => row?.id === menuId) ? {} : { created_at: nowIso }),
        _pending_sync: true,
        _sync_state: 'pending',
        ...(isCreate ? { _operation_key: entry.operation_key } : {}),
      };
      writeCache('pos-menu-items', [menuRow, ...cachedMenu.filter((row) => row?.id !== menuId)]);
      if (stock.mode !== 'link') {
        const stockId = /** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.inventory_item_id || `pending:${entry.operation_key}:stock`;
        const cachedStock = /** @type {ProductSaveCachedRowReadView[]} */ (readCache('inventory-items') || []);
        const stockRow = {
          ...(cachedStock.find((row) => row?.id === stockId) || {}),
          id: stockId,
          lodge_id: state.lodgeId,
          name: stock.name || product.name || 'Stock item',
          category: stock.category || 'Bar',
          unit: stock.unit || 'unit',
          current_stock: Number(stock.opening_stock) || 0,
          reorder_level: Number(stock.reorder_level) || 0,
          outlet_id: stock.outlet_id || null,
          is_active: true,
          updated_at: nowIso,
          ...(cachedStock.some((row) => row?.id === stockId) ? {} : { created_at: nowIso }),
          _pending_sync: true,
          _sync_state: 'pending',
          ...(isCreate ? { _operation_key: entry.operation_key } : {}),
        };
        writeCache('inventory-items', [stockRow, ...cachedStock.filter((row) => row?.id !== stockId)]);
      }
    } catch {
      /* Provisional display must never fail the queued save. */
    }
    try {
      queueLocalPosCatalogSnapshot((/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload))?.stock?.outlet_id || null, `bar-product-stock-${entry.operation_key}`);
    } catch {
      /* Snapshot queueing must never fail the queued save. */
    }
  },
  dispatchOnline: async (payload) => {
    const { data: rpcData, error } = await state.supabase.rpc("save_bar_product_with_stock", { payload });
    if (error) {
      if (isMissingRpcError(error)) return { transported: true, missing: true, error };
      // Definitive business refusals (validation 22023 / conflict 23505, e.g.
      // duplicate names, barcode conflicts, stale versions) can never succeed
      // by retrying identical bytes: mark them terminal-rejected so recovery
      // stops re-dispatching instead of duplicating work under new keys.
      if (isDefinitiveProductRejection(error)) return { transported: true, rejected: true, error };
      throw error;
    }
    if (!rpcData?.success) return { transported: true, rejected: true, result: rpcData };
    return { transported: true, result: rpcData };
  },
  finalizeCommitted: async (entry, result) => {
    // Entry is already committed by the flow before this runs; this handles
    // idempotent side effects only (movement once, publication sweep).
    const entityIds = {
      menu_item_id: (/** @type {ProductSaveRpcResultReadView|null|undefined} */ (result))?.menu_item_id || (/** @type {ProductSaveEntityIdsReadView|null|undefined} */ (entry.entity_ids))?.menu_item_id || null,
      inventory_item_id: (/** @type {ProductSaveRpcResultReadView|null|undefined} */ (result))?.inventory_item_id || (/** @type {ProductSaveEntityIdsReadView|null|undefined} */ (entry.entity_ids))?.inventory_item_id || null,
    };
    if ((/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload))?.stock?.mode === "create" && Number((/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)).stock.opening_stock || 0) > 0) {
      try {
        upsertLocalInventoryMovement({
          item_id: entityIds.inventory_item_id,
          movement_type: "opening_stock",
          quantity: Number((/** @type {ProductSaveRequestPayloadReadView} */ (entry.payload)).stock.opening_stock || 0),
          notes: "Opening stock recorded when the product was created",
          reference_type: "inventory_item",
          reference_id: entityIds.inventory_item_id,
          source: "inventory",
        });
      } catch {
        /* Local movement aid must never fail a committed save. */
      }
    }
    const expectedOutlets = Array.isArray((/** @type {ProductSaveRpcResultReadView|null|undefined} */ (result))?.outlet_ids)
      ? /** @type {string[]} */ ((/** @type {ProductSaveRpcResultReadView|null|undefined} */ (result))?.outlet_ids).filter(Boolean)
      : [];
    let publication = expectedOutlets.length ? "pending" : "published";
    if (expectedOutlets.length) {
      try {
        const sweep = await processPendingPublicationJobs(expectedOutlets);
        const summary = summarizePublication(expectedOutlets, sweep.outlets);
        if (summary.every((row) => row.status === "published")) publication = "published";
        else if (summary.some((row) => row.status === "failed")) publication = "failed";
      } catch {
        /* Pending stays retryable; never reported as published. */
      }
    }
    markProductRequest(entry.operation_key, { publication });
    return { publication };
  },
  isOnline: () => state.isOnline === true,
  newId: () => randomUUID(),
});

/**
 * Unified product + stock + packs save (wizard contract), orchestrated by
 * the shared persist-once flow: the normalized request is verified-persisted
 * before dispatch; retries replay identical bytes under the same key (server
 * dedupes by key); changed payloads under a reused key are rejected; storage
 * failure blocks dispatch; transport failures stay retryable (unknown) while
 * business refusals are terminal (rejected). Concurrent clicks single-flight
 * on the operation key.
 */
export async function saveBarProductWithStock(data = {}) {
  const minted = {
    inventoryItemId: String(data?.inventory_item_id || "").trim() || randomUUID(),
  };
  return productSaveFlow.save(data, state.lodgeId, minted);
}

/** Explicit retry of a stored product request (recovery UI, startup sweep). */
export async function retryProductRequest(operationKey) {
  const outcome = await productSaveFlow.retry(operationKey);
  // A committed entry replays verbatim, which never touches catalog
  // publication — so without this sweep the Products banner's retry could
  // never clear a stuck pending-publication notice.
  try {
    const entry = /** @type {ProductSaveRequestCacheRow[]} */ (productSaveFlow.list()).find((row) => row?.operation_key === String(operationKey || ""));
    if (entry?.state === "committed" && entry?.publication && entry.publication !== "published") {
      const outletIds = [...new Set([/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload)?.stock?.outlet_id].filter(Boolean))];
      if (outletIds.length && state.isOnline) {
        const sweep = await processPendingPublicationJobs(outletIds);
        const summary = summarizePublication(outletIds, sweep.outlets);
        const publication = summary.every((row) => row.status === "published")
          ? "published"
          : summary.some((row) => row.status === "failed") ? "failed" : "pending";
        markProductRequest(entry.operation_key, { publication });
        return { .../** @type {Record<string, unknown>} */ (outcome), publication };
      }
    }
  } catch {
    /* The banner stays retryable; never report published on a failed sweep. */
  }
  return outcome;
}

/** Actionable stored requests for the Products recovery banner. */
export function getProductRequestStatus() {
  return /** @type {ProductSaveRequestCacheRow[]} */ (productSaveFlow.list())
    .filter((entry) => {
      if (!entry?.operation_key) return false;
      if (productSaveFlow.ACTIONABLE.has(entry.state)) return true;
      // Definitively rejected saves need an explicit manager discard (which
      // also retires their provisional rows); hiding them strands orphans.
      if (entry.state === "rejected") return true;
      return (
        entry.state === "committed" &&
        entry.publication &&
        entry.publication !== "published"
      );
    })
    .map((entry) => ({
      operation_key: entry.operation_key,
      name: (/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload))?.product?.name || "Product",
      state: entry.state,
      publication: entry.publication || null,
      error: entry.error || null,
      outlet_id: (/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload))?.stock?.outlet_id || null,
      saved_at: entry.created_at || null,
    }));
}

/** Retire a terminally rejected request key. */
export function discardProductRequest(operationKey) {
  const key = String(operationKey || "");
  if (!key) throw new Error("A product request is required.");
  const entry = /** @type {ProductSaveRequestCacheRow|null|undefined} */ (productSaveFlow.status(key));
  if (entry && entry.state !== "rejected") {
    throw new Error("Only definitively rejected saves can be discarded. Retry this save instead.");
  }
  productSaveFlow.discard(key);
  // Retiring the key must also retire its provisional shelf presence:
  // rejected saves never replay, so their pending menu/stock rows would
  // otherwise sit in the caches forever (blocking certified stock reads).
  const purged = purgeProvisionalProductRows(key);
  appendOperationJournalEntry("provisional_product_purged", {
    type: "rpc",
    table: "save_bar_product_with_stock",
    _queue_id: `bar-product-stock-${key}`,
    data: { payload: { operation_key: key } },
  }, {
    financial: false,
    message: `Provisional menu/stock rows retired with discarded product request ${key} (menu: ${purged.menu}, stock: ${purged.stock}).`,
  });
  return { success: true, purged };
}

// Remove provisional cache rows minted for one offline product save.
// Only rows carrying that save's operation key are touched, so server
// rows and other saves are never affected. Idempotent and safe to rerun.
export function purgeProvisionalProductRows(operationKey) {
  const key = String(operationKey || "");
  if (!key) return { menu: 0, stock: 0 };
  let menu = 0;
  let stock = 0;
  try {
    const menuRows = /** @type {ProductSaveCachedRowReadView[]} */ (readCache("pos-menu-items") || []);
    const keptMenu = menuRows.filter((row) => row?._operation_key !== key);
    menu = menuRows.length - keptMenu.length;
    if (menu > 0) writeCache("pos-menu-items", keptMenu);
  } catch { /* purge is best-effort; caches reconverge on refresh */ }
  try {
    const stockRows = /** @type {ProductSaveCachedRowReadView[]} */ (readCache("inventory-items") || []);
    const keptStock = stockRows.filter((row) => row?._operation_key !== key);
    stock = stockRows.length - keptStock.length;
    if (stock > 0) writeCache("inventory-items", keptStock);
  } catch { /* purge is best-effort; caches reconverge on refresh */ }
  return { menu, stock };
}

/** Crash/startup recovery: re-dispatch actionable stored requests, then sweep their outlets. */
export async function recoverPendingProductRequests() {
  const acted = await productSaveFlow.recover();
  const outletIds = [
    ...new Set(
      /** @type {ProductSaveRequestCacheRow[]} */ (productSaveFlow.list())
        .filter((entry) => entry?.state === "committed" && entry?.publication && entry.publication !== "published")
        .map((entry) => (/** @type {ProductSaveRequestPayloadReadView|null|undefined} */ (entry.payload))?.stock?.outlet_id)
        .filter(Boolean),
    ),
  ];
  /** @type {{outlets: Array<{outlet_id?: unknown, status: string, job_id?: unknown, attempts?: number, error?: unknown, note?: string}>}} */
  let sweep = { outlets: [] };
  if (outletIds.length && state.isOnline) {
    try {
      sweep = await processPendingPublicationJobs(outletIds);
    } catch {
      /* Recovery is best-effort; requests remain retryable. */
    }
  }
  // Backfill: rejected saves never replay, so any provisional rows they
  // minted are orphans by definition. Purge them so retired test/failed
  // saves stop blocking certified stock reads. The requests themselves stay
  // listed until a manager explicitly discards them.
  let purged = { menu: 0, stock: 0 };
  try {
    for (const entry of /** @type {ProductSaveRequestCacheRow[]} */ (productSaveFlow.list())) {
      if (entry?.state !== "rejected" || !entry?.operation_key) continue;
      const counts = purgeProvisionalProductRows(entry.operation_key);
      purged.menu += counts.menu;
      purged.stock += counts.stock;
    }
  } catch {
    /* Purge is best-effort; explicit discards converge the rest. */
  }
  return { requests: acted, publication: sweep.outlets || [], purged };
}

/**
 * Desktop-claimed publication worker over the shared sweep machine:
 * per-outlet published | pending | failed | no-job results. An empty sweep
 * is never publication proof — callers map expected outlets explicitly.
 * Pauses when all desktops are closed (stated limitation); pending jobs
 * survive restarts and are reclaimed by the next run.
 */
/** @param {string[]} [outletIds] */
export async function processPendingPublicationJobs(outletIds = []) {
  const targets = [...new Set((Array.isArray(outletIds) ? outletIds : []).filter(Boolean))].slice(0, 20);
  if (!state.isOnline || !state.supabase) {
    return {
      success: false,
      offline: true,
      outlets: targets.map((outletId) => ({ outlet_id: outletId, status: "pending", error: "Publication requires a live connection." })),
    };
  }
  const rpc = async (name, args) => {
    const { data, error } = await state.supabase.rpc(name, args);
    if (error) throw error;
    return data;
  };
  const outlets = await runPublicationSweep({
    outlets: targets,
    claim: async (outletId) => {
      const claimed = await rpc("claim_catalog_publication_job", {
        p_lodge_id: state.lodgeId,
        p_outlet_id: outletId,
        p_lease_seconds: 300,
      });
      if (!claimed?.success || !claimed?.claimed) return null;
      return {
        job: {
          job_id: claimed.job_id,
          claim_token: claimed.claim_token,
          outlet_id: outletId,
          version: claimed.version,
          attempts: claimed.attempts,
        },
      };
    },
    publish: async (outletId) => {
      await publishPosCatalogSnapshot(outletId);
    },
    complete: async (job) => {
      const done = await rpc("complete_catalog_publication_job", {
        p_job_id: job.job_id,
        p_claim_token: job.claim_token,
      });
      if (!done?.success) return { completed: false, error: done?.error || "Completion rejected" };
      if (done?.superseded) return { completed: true, superseded: true };
      return { completed: done?.published === true };
    },
    release: async (job, error, permanent) => {
      await rpc("fail_catalog_publication_job", {
        p_job_id: job.job_id,
        p_claim_token: job.claim_token,
        p_error: error,
        p_permanent: permanent === true,
      });
    },
  });
  return {
    success: outlets.every((row) => row.status === "published" || row.status === "no-job"),
    outlets,
  };
}

/**
 * Server-authoritative stock readiness per sellable item (outcome only, no
 * recipe disclosure). Base Till users can read this without recipe rights.
 * Offline or failed reads are explicit, never an empty/ready catalogue.
 */
export async function getMenuStockReadiness() {
  // Offline-first: only the background connectivity probe checks the
  // connection. A direct probe here would hold the Till for the full probe
  // timeout on every load; the cached readiness fallback in the renderer
  // covers stale-flag windows after reconnect.
  if (!state.isOnline || !state.supabase) {
    return { success: false, code: "offline", error: 'Stock status needs a live connection. Refresh when online.' };
  }
  try {
    const { data, error } = await state.supabase.rpc('get_pos_menu_stock_readiness', { p_lodge_id: state.lodgeId });
    if (error) {
      if (isMissingRpcError(error)) {
        return { success: false, code: 'backend-update-required', error: 'Stock status needs the latest till update. Selling continues on last verified data where available.' };
      }
      throw new Error(error.message);
    }
    if (!data?.success) throw new Error(data?.error || 'Stock status could not be verified.');
    return { success: true, rows: Array.isArray(data.rows) ? data.rows : [] };
  } catch (error) {
    if (isMissingRpcError(error)) {
      return { success: false, code: 'backend-update-required', error: 'Stock status needs the latest till update. Selling continues on last verified data where available.' };
    }
    return { success: false, error: error?.message || 'Stock status could not be verified.' };
  }
}

/**
 * Unsent sales sitting in this computer's sync queue: own queued sales plus
 * sales imported from the other till over mesh. Server-confirmed sales are
 * never here — success removes queue rows — so every row below is still
 * unconfirmed and the server counts may not include it yet. Deliveries
 * received on either till but not yet confirmed add stock back the same way.
 * Physical counts are point-in-time truths that reconcile at replay and stay
 * out of this ledger.
 *
 * The Till subtracts this usage from its stock counts so two tills selling
 * the last bottles fail closed early ("Finished") instead of
 * over-selling. Voids/returns add stock back best-effort via the cached
 * original order; when the order is not cached they reconcile at replay and
 * the Pay-time server check remains the backstop.
 */
export function getUnconfirmedPosUsage() {
  const usage = {};
  let orderCount = 0;
  let meshOrderCount = 0;
  let meshDeliveryCount = 0;
  const seenIntents = new Set();
  const ordersById = new Map((readCache('pos-orders') || []).map((row) => [String(row?.id || ''), row]));
  const menuByInventory = new Map();
  for (const menu of readCache('pos-menu-items') || []) {
    const inventoryId = String(menu?.inventory_item_id || '').trim();
    if (!inventoryId) continue;
    if (!menuByInventory.has(inventoryId)) menuByInventory.set(inventoryId, []);
    menuByInventory.get(inventoryId).push(menu);
  }
  for (const item of readSyncQueue()) {
    if (item?.type !== 'rpc') continue;
    const table = String(item.table || '');
    if (!['create_pos_order', 'create_pos_order_v3', 'create_pos_return_v3', 'approve_pos_void_with_pin', 'post_bar_simple_delivery'].includes(table)) continue;
    const payload = item.data?.payload || item.data || {};
    const payloadLodge = payload.lodge_id || payload.p_lodge_id || null;
    if (payloadLodge && payloadLodge !== state.lodgeId) continue;
    const intent = String(item.intentId || payload.operation_id || payload.p_operation_id || payload.id || payload.return_idempotency_key || item._queue_id || '').trim();
    if (intent && seenIntents.has(intent)) continue;
    if (intent) seenIntents.add(intent);
    const addUsage = (menuItemId, units) => {
      const id = String(menuItemId || '').trim();
      if (!id || !Number.isFinite(units) || units === 0) return false;
      usage[id] = (usage[id] || 0) + units;
      return true;
    };
    let counted = false;
    if (table === 'post_bar_simple_delivery') {
      // Incoming stock in inventory units; every linked menu counts in the
      // same units (the Till divides by depletion at sale time).
      for (const line of Array.isArray(payload.p_lines) ? payload.p_lines : []) {
        const incoming = Number(line?.quantity || 0);
        if (!Number.isFinite(incoming) || incoming <= 0) continue;
        for (const menu of menuByInventory.get(String(line?.item_id || '')) || []) {
          if (addUsage(menu?.id, -incoming)) counted = true;
        }
      }
    } else if (table === 'create_pos_order' || table === 'create_pos_order_v3') {
      for (const line of Array.isArray(payload.items) ? payload.items : []) {
        const perSale = Number(line?.depletion_qty);
        if (addUsage(line?.menu_item_id, Number(line?.quantity || 0) * (Number.isFinite(perSale) && perSale > 0 ? perSale : 1))) counted = true;
      }
    } else {
      // Returns and voids hand stock back: resolve their lines through the
      // cached original order. Unknown orders reconcile at replay instead.
      const order = ordersById.get(String(payload.order_id || ''));
      const orderLines = Array.isArray(order?.pos_order_items) ? order.pos_order_items : Array.isArray(order?.items) ? order.items : [];
      const linesById = new Map(orderLines.map((line) => [String(line?.id || ''), line]));
      const returned = table === 'create_pos_return_v3' && Array.isArray(payload.lines) ? payload.lines : orderLines.map((line) => ({ line_id: line?.id }));
      for (const entry of returned) {
        const original = linesById.get(String(entry?.line_id || ''));
        if (!original) continue;
        const qty = table === 'create_pos_return_v3' ? Math.abs(Number(entry?.quantity ?? original.quantity ?? 0)) : Number(original.quantity || 0);
        const perSale = Number(original?.depletion_qty);
        if (addUsage(original?.menu_item_id, -(qty * (Number.isFinite(perSale) && perSale > 0 ? perSale : 1)))) counted = true;
      }
    }
    if (counted) {
      orderCount += 1;
      if (item._mesh_imported === true) {
        meshOrderCount += 1;
        if (table === 'post_bar_simple_delivery') meshDeliveryCount += 1;
      }
    }
  }
  return { usage, orderCount, meshOrderCount, meshDeliveryCount };
}

// outletFilter: null = all, [] = no access, [uuid1,...] = restrict to these outlet IDs
async function fetchAllPosRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; from < 100000; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

/**
 * @param {string | null | undefined} startDate
 * @param {string | null | undefined} endDate
 * @param {string[] | string | null} [outletFilter]
 * @returns {Promise<PosOrderReadRows>}
 */
async function _getPosOrders(startDate, endDate, outletFilter = null) {
  if (state.isOnline) {
    const cachedOrders = readCache('pos-orders');
    let data = null;
    let error = null;
    try {
      ({ data, error } = await withNetworkTimeout(fetchAllPosRows(() => {
        let query = state.supabase.
        from('pos_orders').
        select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, receipt_number, order_number, daily_order_number, business_date, transaction_type, original_order_id, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)').
        eq('lodge_id', state.lodgeId);
        if (startDate) query = query.gte('business_date', startDate);
        if (endDate) query = query.lte('business_date', endDate);
        return query.order('created_at', { ascending: false }).order('id', { ascending: false });
      }), 8000, 'Sales history'));
    } catch (timeoutError) {
      // A stalled network must not trap Sales/Reports: serve this device's
      // saved sales instantly and let the next refresh repair them.
      console.warn('getPosOrders falling back to cache:', timeoutError?.message || timeoutError);
      return withPosReadMetadata(applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter), 'cache', false);
    }

    if (error) {
      if (isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter);
        if (filteredCached.length > 0) {
          console.warn('getPosOrders using cache because the database session touch fix has not been applied yet:', error.message);
          return withPosReadMetadata(filteredCached, 'cache', false);
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'));
      }

      const fallback = await fetchAllPosRows(() => {
        let fallbackQuery = state.supabase.
        from('pos_orders').
        select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, receipt_number, order_number, daily_order_number, business_date, transaction_type, original_order_id, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*)').
        eq('lodge_id', state.lodgeId);
        if (startDate) fallbackQuery = fallbackQuery.gte('business_date', startDate);
        if (endDate) fallbackQuery = fallbackQuery.lte('business_date', endDate);
        return fallbackQuery.order('created_at', { ascending: false }).order('id', { ascending: false });
      });
      data = fallback.data || [];
      error = fallback.error || null;
      if (error && isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter);
        if (filteredCached.length > 0) {
          console.warn('getPosOrders fallback using cache because the database session touch fix has not been applied yet:', error.message);
          return withPosReadMetadata(filteredCached, 'cache', false);
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'));
      }
      if (!error) {
        const outletMap = new Map((readCache('outlets') || []).map((outlet) => [outlet.id, outlet]));
        data = (data || []).map((order) => ({
          ...order,
          outlets: order.outlet_id ? { name: outletMap.get(order.outlet_id)?.name || null } : null
        }));
      }
    }

    if (error) throw new Error(error.message);
    const mergedLiveRows = mergeRemotePosOrdersWithLocalState(data || [], cachedOrders);
    writeCache('pos-orders', mergedLiveRows);
    const filteredLiveRows = applyPosOrderFilters(mergedLiveRows, startDate, endDate, outletFilter);
    return withPosReadMetadata(
      filteredLiveRows,
      'server',
      !hasUnresolvedPosRows(filteredLiveRows),
      {
        tenderComplete: !hasUnresolvedPosTenderRows(filteredLiveRows),
        itemDetailComplete: !hasIncompletePosItemRows(filteredLiveRows)
      }
    );
  }
  return withPosReadMetadata(applyPosOrderFilters(readCache('pos-orders'), startDate, endDate, outletFilter), 'offline-cache', false);
}

/**
 * @param {string | null | undefined} startDate
 * @param {string | null | undefined} endDate
 * @param {string[] | string | null} [outletFilter]
 * @returns {Promise<PosOrderReadRows>}
 * The shared promise is the exact result from this reader; this assertion only
 * carries its declared query/cache result through the generic dedupe helper.
 */
export function getPosOrders(startDate, endDate, outletFilter = null) {
  return /** @type {Promise<PosOrderReadRows>} */ (dedupePromise(`getPosOrders:${startDate}:${endDate}:${JSON.stringify(outletFilter)}`, () => _getPosOrders(startDate, endDate, outletFilter)));
}

// A shared Till keeps a device session open for speed, but history must remain
// scoped to the PIN-verified operator.  The local POS cache gives the screen an
// immediate result; the caller can then request the server refresh.
/**
 * @param {string | null | undefined} startDate
 * @param {string | null | undefined} endDate
 * @param {string[] | string | null} outletFilter
 * @param {unknown} operatorId
 * @param {{refresh?: boolean}} [options]
 * @returns {Promise<SharedTillPosOrdersResult>}
 */
export async function getSharedTillOperatorOrders(startDate, endDate, outletFilter, operatorId, { refresh = false } = {}) {
  // Match the PIN-verified operator across cashier, waiter and operator
  // attribution. The server persists the Till operator as cashier_id; local
  // pending rows additionally carry waiter_id/operator_id, and tab
  // settlements can attribute waiter and cashier differently. Without this,
  // a waiter's own offline sales disappeared from My Sales.
  const belongsToOperator = (order) => !operatorId || order?.cashier_id === operatorId || order?.waiter_id === operatorId || order?.operator_id === operatorId;
  const cached = applyPosOrderFilters(readCache('pos-orders'), startDate, endDate, outletFilter).filter(belongsToOperator);
  if (!refresh || !state.isOnline) return { orders: cached, source: 'local_cache', refreshed: false, complete: false };
  const live = await getPosOrders(startDate, endDate, outletFilter);
  const orders = (live || []).filter(belongsToOperator);
  const unresolved = hasUnresolvedPosRows(orders);
  return {
    orders,
    source: 'server',
    refreshed: true,
    complete: live?._complete === true && live?._source === 'server' && !unresolved,
    tender_complete: live?._tender_complete === true,
    item_detail_complete: live?._item_detail_complete === true
  };
}

/** @param {string} startDate @param {string} endDate @param {string[] | null} [outletFilter=null] */
export async function getPosVoidHistory(startDate, endDate, outletFilter = null) {
  const applyVoidFilters = (rows = []) => {
    let filtered = rows || [];
    const inclusiveEndDate = normalizeInclusiveDateEnd(endDate);
    if (startDate) filtered = filtered.filter((row) => String(row.created_at || '') >= startDate);
    if (inclusiveEndDate) filtered = filtered.filter((row) => String(row.created_at || '') <= inclusiveEndDate);
    if (outletFilter !== null && outletFilter.length === 0) return [];
    if (outletFilter !== null) filtered = filtered.filter((row) => !row.outlet_id || outletFilter.includes(row.outlet_id));
    return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  };

  const attachApproverNames = (rows = [], userRows = readCache('users')) => {
    const userMap = new Map((userRows || []).map((user) => [user?.id, user?.name]).filter(([id]) => !!id));
    return (rows || []).map((row) => ({
      ...row,
      approver_name: row?.approver_name || userMap.get(row?.approved_by) || null
    }));
  };

  const localRows = applyVoidFilters(attachApproverNames(readLocalPosVoidHistory()));

  if (!state.isOnline) return localRows;

  let query = state.supabase.
  from('pos_override_log').
  select('id, order_id, action, requested_by, approved_by, reason, outlet_id, created_at').
  eq('lodge_id', state.lodgeId).
  eq('action', 'void');

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', normalizeInclusiveDateEnd(endDate));
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) query = query.in('outlet_id', outletFilter);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const approvedByIds = [...new Set((data || []).map((row) => row?.approved_by).filter(Boolean))];
  let remoteUsers = readCache('users');
  if (approvedByIds.length > 0) {
    const { data: usersData } = await state.supabase.
    from('users').
    select('id, name').
    in('id', approvedByIds).
    eq('lodge_id', state.lodgeId);
    if (usersData) remoteUsers = usersData;
  }

  const remoteRows = attachApproverNames(data || [], remoteUsers);
  const remoteIds = new Set(remoteRows.map((row) => row?.id).filter(Boolean));
  const pendingLocalRows = localRows.filter((row) =>
  row?._pending_sync || row?._sync_state === 'pending' || !remoteIds.has(row?.id)
  );
  return applyVoidFilters([...pendingLocalRows.filter((row) => !remoteIds.has(row?.id)), ...remoteRows]);
}

// Eligibility for discarding an orphaned local void-history row. Pure: every
// input is passed in, so the matrix is unit-testable without a database.
// A discard only ever removes an UNCONFIRMED local request record after a
// manager decision — server-confirmed voids resolve to synced instead, and
// rows still backed by a live queue/failed item must go through the queue
// Retry/Clear path so their audit trail stays intact.
export function resolveLocalVoidDiscardEligibility({
  localRow = null,
  queueRefs = [],
  failedRefs = [],
  serverOverrideById = null,
  serverOrder = null,
  serverVoidsForOrder = []
} = {}) {
  if (!localRow) {
    return { ok: false, code: 'not_found', error: 'This void record is no longer on this computer. Refresh and try again.' };
  }
  const unsynced = localRow?._pending_sync === true
    || ['pending', 'failed', 'manual_review_required'].includes(String(localRow?._sync_state || ''));
  if (!unsynced) {
    return { ok: false, code: 'already_synced', error: 'This void is already confirmed. Refresh instead of discarding.' };
  }
  if ((queueRefs || []).length > 0 || (failedRefs || []).length > 0) {
    return { ok: false, code: 'queue_backed', error: 'This void is still in the sync queue — Retry or Clear it in System Health instead of discarding the record.' };
  }
  if (serverOverrideById) {
    return { ok: false, code: 'server_confirmed', resolve: 'synced', error: 'The server already recorded this void. It will be marked confirmed instead.' };
  }
  if (!serverOrder) {
    return {
      ok: true,
      disposition: 'orphan',
      confirmCopy: 'The order no longer exists on the server, so there is nothing real to void. Discarding removes only this computer\u2019s unfulfilled request record.'
    };
  }
  const voidedServerSide = String(serverOrder.status || '').toLowerCase() === 'voided' || (serverVoidsForOrder || []).length > 0;
  if (voidedServerSide) {
    return {
      ok: true,
      disposition: 'superseded',
      confirmCopy: 'The server already voids this order under a different record. Discarding removes only the duplicate local request.'
    };
  }
  const total = Number(serverOrder.total);
  return {
    ok: true,
    disposition: 'order_stands',
    confirmCopy: `Order ${String(serverOrder.id || '').slice(0, 8)} still stands ${String(serverOrder.status || 'completed')}${Number.isFinite(total) ? ` for ${total.toFixed(2)}` : ''} on the server. Discarding keeps the sale and drops only the unfulfilled void request. Re-void at the Till with a supervisor PIN if the sale should not stand.`
  };
}

// Manager-reviewed discard of an orphaned local void record that can never
// sync (e.g. its queue item was cleared, or its order never committed).
// Fail-closed: offline refuses (the server must confirm there is nothing to
// lose), server-confirmed voids resolve to synced, queue-backed rows refuse.
export async function discardLocalPosVoidRecord(overrideId, { reason = '' } = {}) {
  const id = String(overrideId || '').trim();
  if (!id) throw new Error('A void record is required.');
  if (!state.lodgeId) throw new Error('Select a business profile first.');
  const localRow = readLocalPosVoidHistory().find((row) => String(row?.id || '') === id) || null;
  if (!localRow) throw new Error('This void record is no longer on this computer. Refresh and try again.');
  const matchesRef = (item) => String(item?.data?.payload?.override_log_id || '') === id;
  const queueRefs = [...readSyncQueue(), ...readFailedSyncQueue()].filter(matchesRef);
  const unsynced = localRow?._pending_sync === true
    || ['pending', 'failed', 'manual_review_required'].includes(String(localRow?._sync_state || ''));
  if (!unsynced) throw new Error('This void is already confirmed. Refresh instead of discarding.');
  if (queueRefs.length > 0) throw new Error('This void is still in the sync queue — Retry or Clear it in System Health instead of discarding the record.');
  if (!state.isOnline || !state.supabase) {
    throw new Error('Reconnect before discarding a void record — the server must confirm there is nothing to lose. The record was kept.');
  }
  const orderId = localRow?.order_id || null;
  const [overrideRead, orderRead] = await Promise.all([
    state.supabase.from('pos_override_log').select('id, order_id, action').eq('id', id).eq('lodge_id', state.lodgeId).maybeSingle(),
    orderId
      ? state.supabase.from('pos_orders').select('id, status, total').eq('id', orderId).eq('lodge_id', state.lodgeId).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (overrideRead?.error) throw new Error(`Server void check failed (${overrideRead.error.message}). Reconnect and try again — the record was kept.`);
  if (orderRead?.error) throw new Error(`Server order check failed (${orderRead.error.message}). Reconnect and try again — the record was kept.`);
  const serverOrder = orderRead?.data || null;
  let serverVoidsForOrder = [];
  if (serverOrder) {
    const voidsRead = await state.supabase.from('pos_override_log').select('id').eq('lodge_id', state.lodgeId).eq('order_id', serverOrder.id).eq('action', 'void');
    if (voidsRead?.error) throw new Error(`Server void check failed (${voidsRead.error.message}). Reconnect and try again — the record was kept.`);
    serverVoidsForOrder = Array.isArray(voidsRead?.data) ? voidsRead.data : [];
  }
  const eligibility = resolveLocalVoidDiscardEligibility({
    localRow,
    queueRefs: [],
    failedRefs: [],
    serverOverrideById: overrideRead?.data || null,
    serverOrder,
    serverVoidsForOrder
  });
  if (!eligibility.ok && eligibility.resolve === 'synced') {
    patchLocalPosVoidHistory(id, { _pending_sync: false, _sync_state: 'synced', _sync_error: null, _synced_at: new Date().toISOString() });
    broadcastSyncStatus();
    return { success: true, resolved: 'synced', overrideId: id };
  }
  if (!eligibility.ok) throw new Error(eligibility.error || 'This void record cannot be discarded.');
  const removed = removeLocalPosVoidHistory([id]);
  if (removed === 0) throw new Error('This void record is no longer on this computer. Refresh and try again.');
  const at = new Date().toISOString();
  const auditMessage = `Local void record ${id} (order ${String(orderId || '').slice(0, 8) || 'unknown'}) discarded by manager review without server confirmation [${eligibility.disposition}]${reason ? `: ${String(reason).slice(0, 200)}` : ''}. Verify manually that this was handled.`;
  appendHealthFault({
    type: 'financial_void_record_discarded',
    scope: `pos-void:${id}`,
    severity: 'error',
    message: auditMessage,
    at,
    context: { override_id: id, order_id: orderId, disposition: eligibility.disposition }
  });
  appendOperationJournalEntry('void_record_discarded', {
    type: 'rpc',
    table: 'approve_pos_void_with_pin',
    _queue_id: `pos-void-${orderId || id}`,
    data: { payload: { override_log_id: id, order_id: orderId } }
  }, { financial: true, message: auditMessage });
  broadcastSyncStatus();
  return { success: true, discarded: id, disposition: eligibility.disposition, orderId };
}

async function _getOutlets() {
  const normalizeOutletRows = (rows = []) => {
    const seen = new Set();
    return (rows || []).
    filter(Boolean).
    filter((row) => row.is_active !== false).
    map((row, index) => ({
      ...row,
      id: row.id ?? null,
      name: row.name || `Outlet ${index + 1}`,
      type: row.type || 'accommodation',
      sort_order: Number(row.sort_order ?? index)
    })).
    filter((row) => {
      // A stale local cache must not create duplicate Kitchen/Bar choices.
      const key = row.id || `${String(row.type).toLowerCase()}:${String(row.name).trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).
    sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  };

  const buildVirtualOutlets = () => [
  { id: null, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
  { id: null, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
  { id: null, name: 'Others', type: 'accommodation', sort_order: 3, _virtual: true }];

  // Offline-first: when the background connectivity probe has already marked
  // the app offline, serve the trusted cache instantly. Only the background
  // probe checks the connection; reads never probe here.
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    const cachedOffline = readCache('outlets');
    if (Array.isArray(cachedOffline) && cachedOffline.length > 0) return normalizeOutletRows(cachedOffline);
    return buildVirtualOutlets();
  }

  try {
    let { data, error } = await withNetworkTimeout(state.supabase.
    from('outlets').
    select('id, name, type, sort_order, cash_model').
    eq('lodge_id', state.lodgeId).
    eq('is_active', true).
    order('sort_order'), 5000, 'Outlet list');
    if (error) {
      const fallback = await withNetworkTimeout(state.supabase.
      from('outlets').
      select('id, name, type, is_active').
      eq('lodge_id', state.lodgeId), undefined, 'Outlet list');
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;

    const normalized = normalizeOutletRows(data || []);
    const cached = readCache('outlets');
    if (normalized.length === 0 && cached.length > 0) {
      console.warn('getOutlets received empty live result; using cached outlets instead');
      return cached;
    }
    if (normalized.length === 0) {
      const virtual = buildVirtualOutlets();
      writeCache('outlets', virtual);
      return virtual;
    }
    writeCache('outlets', normalized);
    return normalized;
  } catch (error) {
    const cached = readCache('outlets');
    if (cached.length > 0) {
      console.warn('getOutlets falling back to cache:', error?.message || error);
      return cached;
    }
    if (!state.isOnline) return buildVirtualOutlets();
    console.warn('getOutlets falling back to virtual outlets:', error?.message || error);
    const virtual = buildVirtualOutlets();
    writeCache('outlets', virtual);
    return virtual;
  }
}

export function getOutlets() {
  return dedupePromise('getOutlets', _getOutlets);
}

export async function getPosOrderById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('pos_orders').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return readCache('pos-orders').find((order) => order.id === id) || null;
}

// Renderer reload recovery: return the newest unresolved order attempt for this
// lodge/user so the Till can offer to retry the original sale. If the order was
// already recorded (for example by an earlier offline replay), the attempt is
// settled and cleared instead of surfacing a stale interruption.
/** @typedef {Record<string, unknown> & {_pending_sync?: unknown}} PosSubmitRecoveryOrderReadView */
/** @param {{lodgeId?: unknown, userId?: unknown}} [scope] */
export async function getPendingPosSubmitAttempt({ lodgeId, userId } = {}) {
  const attempt = /** @type {PosCreateOrderAttemptExpectedData | null} */ (getPendingSubmitAttemptRecord({ lodgeId, userId }));
  if (!attempt?.orderId) return null;
  if (state.isOnline) {
    // Recovery must distinguish a confirmed absence from a failed/unauthorized
    // lookup. Treating either error as "not found" would let an operator retry
    // an order whose original server outcome was never actually checked.
    const { data: existing, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
    from('pos_orders').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', attempt.orderId).
    maybeSingle();
    if (error) {
      return {
        success: false,
        code: 'pos_submit_recovery_server_check_failed',
        error: `The server could not verify whether sale attempt ${attempt.submitIntentId} was recorded. Do not retry or enter a replacement sale until this check succeeds.`
      };
    }
    // RPC data is unvalidated; only the existing pending-sync property read is typed.
    if (existing && !/** @type {PosSubmitRecoveryOrderReadView} */ (existing)._pending_sync) {
      clearPosSubmitAttemptRecord(attempt.submitIntentId);
      return {
        success: true,
        resolved: true,
        replayed: true,
        already_exists: true,
        submitIntentId: attempt.submitIntentId,
        orderId: attempt.orderId,
        order: existing,
        message: 'The original sale was already recorded. The recovery journal is settled safely.'
      };
    }
  }
  return {
    submitIntentId: attempt.submitIntentId,
    orderId: attempt.orderId,
    createdAtClient: attempt.createdAtClient,
    payload: attempt.payload,
    status: attempt.status,
    pendingCount: countPendingSubmitAttemptRecords({ lodgeId, userId })
  };
}

async function getPosOrderWithItemsById(id) {
  const cached = readCache('pos-orders').find((order) => order.id === id);
  if (cached && (Array.isArray(cached.pos_order_items) || Array.isArray(cached.items))) return cached;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const current = readCache('pos-orders');
      writeCache('pos-orders', [data, ...current.filter((order) => order.id !== id)]);
    }
    return data || null;
  }
  return cached || null;
}

// Shared-drawer sale gate: every sale must land inside one open drawer
// period, or it belongs to no review window (expectations are computed per
// period from opened_at). The period read is cached for seconds, not minutes:
// Till selling speed matters, and a stale-open view can only admit sales
// seconds past a close, which still reconcile inside that window.
const DRAWER_SALE_GATE_TTL_MS = 20000;
const drawerSaleGateCache = new Map();

async function findSaleDrawerPeriod(outletId) {
  const cacheKey = String(outletId || '');
  const cached = drawerSaleGateCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < DRAWER_SALE_GATE_TTL_MS && cached.period) return cached.period;
  let period = null;
  if (state.isOnline && state.supabase) {
    try {
      const fetched = await withNetworkTimeout(getDrawerPeriodState(outletId), undefined, 'Drawer check');
      period = fetched?.period || null;
    } catch {
      period = null;
    }
  }
  if (!period) period = findLocalOpenDrawerPeriod(outletId);
  if (period) drawerSaleGateCache.set(cacheKey, { period, checkedAt: Date.now() });
  else drawerSaleGateCache.delete(cacheKey);
  return period;
}

/**
 * Expected Till submission fields from POS.jsx / HposTerminal and the
 * main-process shared-Till payload projection. The request is not validated
 * here; SQL remains authoritative for prices and the journal preserves the
 * exact submitted envelope for retries.
 * @typedef {Object} PosCreateOrderItemRequest
 * @property {unknown} quantity
 * @property {unknown} [menu_item_id]
 * @property {unknown} [inventory_item_id]
 * @property {unknown} [item_name]
 * @property {unknown} [category]
 * @property {unknown} [unit_price]
 * @property {unknown} [base_unit_price]
 * @property {unknown} [depletion_qty]
 * @property {unknown} [modifiers]
 * @property {unknown} [modifier_option_ids]
 * @property {unknown} [item_notes]
 * @property {unknown} [id]
 * @property {unknown} [kitchen_station_id]
 */
/**
 * @typedef {Object} PosCreateOrderRequest
 * @property {PosCreateOrderItemRequest[]} items
 * @property {string} [id]
 * @property {string} [submit_intent_id]
 * @property {string} [created_at_client]
 * @property {string|null} [client_created_at]
 * @property {string|null} [room_id]
 * @property {string|null} [booking_id]
 * @property {string|null} [event_booking_id]
 * @property {string|null} [outlet_id]
 * @property {string|null} [outletId]
 * @property {string|null} [shift_id]
 * @property {string|null} [catalog_snapshot_id]
 * @property {string|null} [tab_id]
 * @property {string|null} [tab_name]
 * @property {number|null} [expected_tab_version]
 * @property {string|null} [service_mode]
 * @property {string|null} [table_name]
 * @property {string|null} [walk_in_name]
 * @property {string|null} [customer_id]
 * @property {string|null} [notes]
 * @property {string|null} [payment_method]
 * @property {unknown} [payment_breakdown]
 * @property {unknown} [payments]
 * @property {unknown} [gross_total]
 * @property {unknown} [discount_total]
 * @property {unknown} [tax_rate]
 * @property {unknown} [tax_total]
 * @property {unknown} [tip_total]
 * @property {unknown} [total]
 * @property {unknown} [promotion_id]
 * @property {unknown} [manual_discount]
 * @property {string|null} [delivery_address]
 * @property {string|null} [delivery_notes]
 * @property {string|null} [waiter_id]
 * @property {string|null} [waiter_name]
 * @property {string|null} [cashier_id]
 * @property {string|null} [cashier_name]
 * @property {string|null} [operator_id]
 * @property {string|null} [operator_name]
 * @property {unknown} [customer_account_charge]
 * @property {unknown} [customer_segment]
 * @property {string|null} [ticket_status]
 * @property {boolean} [resolve_tab]
 * @property {string|null} [_operator_proof]
 */
/**
 * Expected booking row fields from cacheRefresh's BOOKING_LIST_SELECT and the
 * offline create-booking writer. The live list projection omits lodge_id,
 * while offline rows include it. The cache is persisted JSON and is not
 * validated by this view; the original `.find` calls retain malformed-row
 * behavior.
 * @typedef {{id: string, lodge_id?: string|null, room_id: string|null, status: string|null, check_in: string, check_out: string, _pending_sync?: boolean}} PosCreateOrderBookingExpectedData
 */
/**
 * Expected catalog snapshot row written by buildLocalPosCatalogSnapshot or
 * cached after the guarded get_active_pos_catalog_snapshot read. Persisted
 * cache JSON is not validated here; queue metadata is present only for local
 * pending snapshots.
 * @typedef {{success: true, snapshot_id: string, outlet_id: string|null, _pending_sync?: true, _queue_id?: string}} PosCreateOrderCatalogSnapshotExpectedData
 */
/**
 * JSON-backed persisted journal payload; its actual parsed value is untrusted
 * and can be malformed, so it remains unknown until a guarded consumer reads it.
 * @typedef {{submitIntentId: string, orderId: string|null, lodgeId: string|null, userId: string|null, createdAtClient: unknown, digest: string, payload: unknown, status: string, firstAttemptAt: string, lastAttemptAt: string}} PosCreateOrderAttemptExpectedData
 */
/** Expected fields consumed from the original RPC envelope. The journal does not validate JSON shape. @typedef {Record<string, unknown> & {items?: unknown, client_created_at?: unknown}} PosCreateOrderRpcEnvelopeExpectedData */
/** @typedef {{conflict: true, error: string, code?: string, reused?: false}|{conflict: false, attempt: PosCreateOrderAttemptExpectedData, reused: boolean, error: null}} PosCreateOrderAttemptResolution */
/** @typedef {{success: false, code: string, error: string}} PosCreateOrderAttemptError */
/** @typedef {{conflict: true, resolution: Extract<PosCreateOrderAttemptResolution, {conflict: true}>, attempt: null, error: PosCreateOrderAttemptError}|{conflict: false, resolution: Extract<PosCreateOrderAttemptResolution, {conflict: false}>, attempt: PosCreateOrderAttemptExpectedData, error: null}} PosCreateOrderRecordAttemptResult */
/** @param {PosCreateOrderRequest} data */
export async function createPosOrder(data) {
  try {
    const operatorProof = String(data?._operator_proof || '').trim() || null;
    data = { ...(data || {}) };
    delete data._operator_proof;
    // Bar tab sales queue offline behind their tab create (unlocked Till is
    // the trust root, same as counter sales). The version guard below still
    // applies, and replay order is enforced through queue dependencies.
    const items = data.items || [];
    const totals = buildPosTotals(items, data);
    const total = totals.total;
    const paymentBreakdown = normalizePaymentBreakdown(data.payment_breakdown || data.payments, data.payment_method || 'cash', total);
    const paymentMethod = data.payment_method || (paymentBreakdown.length > 1 ? 'split' : paymentBreakdown[0]?.method || 'cash');
    await enforceBarBaseTenderBoundary(data, paymentBreakdown, paymentMethod);
    // Expired/trial-ended licences must not sell (fail closed with a clear
    // code). Read-only reporting stays available; only new sales block.
    await assertPosSubscriptionAllowsSale();
    validateProviderPaymentReferences(paymentBreakdown, paymentMethod);
    // Shared drawers reconcile every sale inside one open period: without it
    // the sale belongs to no review window. Fail closed here (before any
    // journal residue) for shared outlets only; personal outlets and unknown
    // models keep the old path. A submitted period is frozen for review, so
    // only open (or rejected, back for correction) periods admit sales.
    const saleOutletId = data.outlet_id || data.outletId || null;
    if (saleOutletId && getOutletCashModel(saleOutletId) === 'shared_drawer') {
      const salePeriod = await findSaleDrawerPeriod(saleOutletId);
      if (!salePeriod) {
        throw new Error('Open the drawer in Staff shift close before selling — cash sales have nowhere to reconcile without an open drawer period.');
      }
      if (!['open', 'rejected'].includes(String(salePeriod.status || ''))) {
        throw new Error('The drawer close is submitted and awaiting manager review. Review it in Cash & close before selling on.');
      }
    }
    const callerOrderId = String(data?.id || '').trim();
    const callerSubmitIntentId = String(data?.submit_intent_id || '').trim();
    const submitIntentId = callerSubmitIntentId || randomUUID();
    const orderId = callerOrderId || submitIntentId;
    const submitIdempotencyKey = `pos-order:${submitIntentId}`;
    // client_created_at participates in the server request hash. Materialise
    // it before journalling the attempt so a retry cannot silently change the
    // business payload after a timeout or renderer interruption.
    const stableCreatedAtClient = String(data?.created_at_client || data?.client_created_at || '').trim() || new Date().toISOString();
    data = { ...data, id: orderId, submit_intent_id: submitIntentId, created_at_client: stableCreatedAtClient };

    // The attempt is journalled only after the exact v3 RPC envelope has been
    // resolved (catalog snapshot, booking linkage, payment breakdown, item
    // selections and stable client timestamp included). This keeps the main
    // process journal digest byte-equivalent to the server request hash.
    let replayHistoricalSale = false;
    /**
     * Journal the already-built RPC envelope. The journal stores its payload
     * as JSON and does not validate it when reading it back.
     * @param {PosCreateOrderRpcEnvelopeExpectedData} rpcPayload
     * @returns {PosCreateOrderRecordAttemptResult}
     */
    const recordAttempt = (rpcPayload) => {
      const resolution = /** @type {PosCreateOrderAttemptResolution} */ (resolvePosSubmitAttempt({
        submitIntentId,
        orderId,
        lodgeId: state.lodgeId,
        userId: state.currentUser?.id || null,
        payload: rpcPayload
      }));
      if (resolution.conflict) return {
        conflict: true,
        resolution,
        attempt: null,
        error: { success: false, code: resolution.code || 'idempotency_conflict', error: resolution.error }
      };
      return { conflict: false, resolution, attempt: resolution.attempt, error: null };
    };

    // Restaurant mode guard: reject room/event/folio charges
    const cachedSettings = getCachedPosSettings() || {};
    const propertyType = cachedSettings.property_type || cachedSettings.business_type || 'lodge';
    const isRestaurantMode = propertyType === 'restaurant' || propertyType === 'pos_only';
    if (isRestaurantMode && (data.room_id || data.booking_id || data.event_booking_id || paymentMethod === 'folio')) {
      throw new Error('Room charges, booking charges, and folio payments are not available in restaurant mode.');
    }
    const today = getLocalDateKey();
    // This cache is populated by the bookings read producer; existing lookup
    // behavior intentionally keeps native failures for malformed truthy rows.
    const cachedBookings = /** @type {PosCreateOrderBookingExpectedData[]} */ (readCache('bookings'));
    const cachedBooking = data.booking_id ?
    cachedBookings.find((entry) => entry?.id === data.booking_id && entry?.lodge_id === state.lodgeId) :
    cachedBookings.find((entry) =>
    entry?.lodge_id === state.lodgeId &&
    entry?.room_id === data.room_id &&
    ['confirmed', 'checked_in'].includes(String(entry?.status || '').toLowerCase()) &&
    entry?.check_in <= today &&
    entry?.check_out > today
    );
    let bookingId = cachedBooking?.id || data.booking_id || null;
    const eventBookingId = data.event_booking_id || null;

    if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId && data.room_id && state.isOnline) {
      const liveBooking = await getActiveBookingForRoom(data.room_id).catch(() => null);
      bookingId = liveBooking?.id || null;
    }

    if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId) {
      throw new Error('Folio charge requires an active booking or an active event.');
    }

    // Offline path: queue v3 payload (server resolves prices from catalog on replay)
    if (!state.isOnline) {
      // If a booking_id was explicitly provided, verify it exists in cache
      if (data.booking_id && !cachedBooking) {
        throw new Error(`Booking ${data.booking_id} not found locally. Sync the latest bookings and try again.`);
      }
      // For folio charges, ensure we have a valid booking (same as online check above, but explicit)
      if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId) {
        throw new Error('Folio charge requires an active booking or an active event.');
      }
      if (!data.shift_id) {
        throw new Error('shift_id is mandatory. Open a shift before creating orders.');
      }
      // Resolve catalog snapshot for offline (from cache)
      let offlineCatalogSnapshotId = data.catalog_snapshot_id || null;
      let offlineCatalogSnapshot = null;
      if (!offlineCatalogSnapshotId) {
        const cachedSnapshots = /** @type {PosCreateOrderCatalogSnapshotExpectedData[]} */ (readCache('pos-catalog-snapshots'));
        offlineCatalogSnapshot = (Array.isArray(cachedSnapshots) ? cachedSnapshots : []).find((entry) =>
          entry?.success === true &&
          (entry?.outlet_id || null) === (data.outlet_id || null)
        );
        offlineCatalogSnapshotId = offlineCatalogSnapshot?.snapshot_id || null;
      } else {
        offlineCatalogSnapshot = /** @type {PosCreateOrderCatalogSnapshotExpectedData[]} */ (readCache('pos-catalog-snapshots') || []).find((entry) => entry?.snapshot_id === offlineCatalogSnapshotId) || null;
      }
      if (!offlineCatalogSnapshotId) {
        throw new Error('No catalog snapshot available offline. Connect to the internet, publish a catalog, then retry.');
      }

      const id = orderId;
      const createdAt = data.created_at_client || data.client_created_at || stableCreatedAtClient;
      const idempotencyKey = submitIdempotencyKey;
      const inventoryReservations = getOfflinePosInventoryReservation(items);

      // v3 offline payload: only item selections, no client-computed prices
      const v3OfflineItems = items.map((item) => ({
        menu_item_id: item.menu_item_id || null,
        item_name: item.item_name || null,
        category: item.category || null,
        quantity: normalizePositiveQty(item.quantity, 1),
        unit_price: Number(item.unit_price || 0),
        base_unit_price: Number(item.base_unit_price || item.unit_price || 0),
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        modifier_option_ids: Array.isArray(item.modifier_option_ids)
          ? item.modifier_option_ids
        : (Array.isArray(item.modifiers) ? /** @type {unknown[]} */ (item.modifiers) : [])
            .map((modifier) => typeof modifier === 'string' ? modifier : /** @type {{id?: unknown} | null | undefined} */ (modifier)?.id)
            .filter(Boolean),
        item_notes: item.item_notes || null
      }));

      const v3OfflinePayload = {
        id,
        submit_intent_id: submitIntentId,
        lodge_id: state.lodgeId,
        catalog_snapshot_id: offlineCatalogSnapshotId,
        shift_id: data.shift_id,
        source_device_id: getDesktopPosDeviceId(),
        outlet_id: data.outlet_id || null,
        walk_in_name: data.walk_in_name || null,
        room_id: data.room_id || null,
        booking_id: bookingId || null,
        event_booking_id: eventBookingId || null,
        customer_id: data.customer_id || null,
        notes: data.notes || null,
        payment_method: paymentMethod,
        payment_breakdown: paymentBreakdown,
        gross_total: totals.gross_total,
        discount_total: totals.discount_total,
        tax_rate: totals.tax_rate,
        tax_total: totals.tax_total,
        total,
        service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
        table_name: data.table_name || null,
        tab_name: data.tab_name || null,
        tab_id: data.tab_id || null,
        delivery_address: data.delivery_address || null,
        delivery_notes: data.delivery_notes || null,
        waiter_name: data.waiter_name || null,
        waiter_id: data.waiter_id || null,
        cashier_id: data.cashier_id || null,
        cashier_name: data.cashier_name || null,
        operator_id: data.cashier_id || data.operator_id || null,
        customer_account_charge: data.customer_account_charge || null,
        customer_segment: data.customer_segment || null,
        ticket_status: data.ticket_status || 'new',
        create_idempotency_key: idempotencyKey,
        client_created_at: createdAt,
        tip_total: totals.tip_total,
        promotion_id: data.promotion_id || null,
        manual_discount: data.manual_discount || null,
        items: v3OfflineItems
      };
      // Optional tab-identity fields travel only when the caller sent them,
      // so a rebuilt retry hashes byte-equivalently to its journal entry.
      applyOptionalV3TabFields(v3OfflinePayload, data);

      // Fail closed before journaling: a brand-new tab_id settlement without
      // a version must never enter the journal. Replays reuse their
      // journalled bytes (guard skipped when this intent already exists).
      if (data.tab_id && !isPositiveTabVersion(data.expected_tab_version) && !hasPosSubmitAttempt(submitIntentId)) {
        throw new Error('This sale is missing its tab version. Refresh the open check before taking payment.');
      }

      // Record the exact offline RPC envelope, not the renderer's richer
      // pre-resolution cart object. Queue replay and renderer recovery then
      // use the same order ID, key, timestamp, snapshot and item payload.
      const offlineAttempt = recordAttempt(v3OfflinePayload);
      if (offlineAttempt.conflict) return offlineAttempt.error;
      const effectiveOfflinePayload = offlineAttempt.resolution.reused && offlineAttempt.attempt.payload
        ? /** @type {PosCreateOrderRpcEnvelopeExpectedData} */ (offlineAttempt.attempt.payload)
        : v3OfflinePayload;
      // Required choices are checked for fresh attempts only: a journalled
      // replay reuses its original bytes, and a committed attempt must never
      // be blocked by changed modifier configuration (the server replays
      // committed work first).
      if (!offlineAttempt.resolution.reused) assertSaleModifierRequirements(effectiveOfflinePayload.items);

      const cachedShift = readPosShifts().find((shift) => shift.id === data.shift_id) || null;
      // Provisional products (created offline) must replay before this sale:
      // their queue ids join the dependency chain so the runner creates the
      // products (and their catalog snapshot) first, then rewrites this
      // payload to the real server ids on product success. Atomic-path rows
      // use `pending:<operation_key>` ids; legacy-path rows use their local
      // UUID while still marked pending in cache.
      const menuCacheById = new Map((/** @type {Array<{id?: unknown, _pending_sync?: boolean}>} */ (readCache('pos-menu-items') || [])).map((row) => [String(row?.id || ''), row]));
      const provisionalProductDeps = [...new Set(
        (/** @type {PosCreateOrderItemRequest[]} */ (effectiveOfflinePayload.items || [])).flatMap((line) => {
          const menuId = String(line?.menu_item_id || '');
          if (menuId.startsWith('pending:')) return [`bar-product-stock-${menuId.slice('pending:'.length)}`];
          if (menuId && menuCacheById.get(menuId)?._pending_sync === true) return [`pos-menu-item-${menuId}`];
          return [];
        })
      )];
      const orderDependencies = [
        offlineCatalogSnapshot?._pending_sync ? offlineCatalogSnapshot._queue_id : null,
        cachedShift?._pending_sync ? (cachedShift._queue_id || `pos-shift-${cachedShift.id}`) : null,
        cachedBooking?._pending_sync ? `booking-${cachedBooking.id}` : null,
        ...provisionalProductDeps,
        // A tab settle replays only after its tab exists server-side. Absent
        // parents resolve immediately, so synced tabs pay no penalty.
        ...(data.tab_id ? [`pos-tab-${data.tab_id}`] : [])
      ].filter(Boolean);
      queueOperation('rpc', 'create_pos_order_v3', {
        payload: {
          ...effectiveOfflinePayload,
          client_created_at: effectiveOfflinePayload.client_created_at || stableCreatedAtClient
        }
      }, null, {
        _queue_id: `pos-order-${id}`,
        ...(orderDependencies[0] ? { _depends_on: orderDependencies[0], _depends_on_all: orderDependencies } : {})
      });
      // Recorded locally and queued: the outcome is no longer unknown, so the
      // attempt leaves 'pending' for 'provisional'. Recovery banners and the
      // new-sale block ignore it while the queue owns it; replay success
      // commits it and dead-letter reopens it.
      markPosSubmitAttemptProvisional(submitIntentId, `pos-order-${id}`);

      // Recipe stock depletion is server-authoritative inside create_pos_order_v3
      // (see 20260805090000_pos_recipe_stock_depletion_server_atomic.sql). New
      // offline orders must not queue a separate depletion operation; the
      // trigger writes movements atomically when the order replays. Legacy
      // queued depletion operations remain compatible through the rewritten
      // record_recipe_stock_depletion replay RPC.

      // Offline attribution must follow the PIN-verified Till operator, not the
      // device login: My Sales / Sales history filter by cashier, so stamping
      // the manager account here hid offline sales from the waiter who took
      // them. business_date is mandatory for the same reason — date-filtered
      // history excluded every offline row without one.
      const offlineCashierId = data.cashier_id || data.operator_id || state.currentUser?.id || null;
      const offlineCashierName = data.cashier_name || data.operator_name || state.currentUser?.name || state.currentUser?.email || null;
      const offlineReceiptNumber = nextOfflineReceiptNumber(data.outlet_id || null);
      const orderRow = {
        id,
        lodge_id: state.lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingId,
        event_booking_id: eventBookingId || null,
        walk_in_name: data.walk_in_name || null,
        outlet_id: data.outlet_id || null,
        notes: data.notes || null,
        payment_method: paymentMethod,
        payment_breakdown: paymentBreakdown,
        total,
        gross_total: totals.gross_total,
        discount_total: totals.discount_total,
        tax_rate: totals.tax_rate,
        tax_total: totals.tax_total,
        tip_total: totals.tip_total,
        status: 'pending',
        receipt_number: offlineReceiptNumber,
        business_date: getLocalDateKey(),
        service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
        table_name: data.table_name || null,
        tab_name: data.tab_name || null,
        waiter_id: data.waiter_id || null,
        waiter_name: data.waiter_name || null,
        cashier_id: offlineCashierId,
        cashier_name: offlineCashierName,
        operator_id: offlineCashierId,
        shift_id: data.shift_id || null,
        ticket_status: data.ticket_status || 'new',
        catalog_snapshot_id: effectiveOfflinePayload.catalog_snapshot_id || offlineCatalogSnapshotId,
        created_at: effectiveOfflinePayload.client_created_at || createdAt,
        _pending_sync: true,
        _provisional_receipt: true,
        _sync_state: 'pending',
        _sync_error: null,
        _idempotency_key: idempotencyKey,
        _sync_created_offline: true,
        pos_order_items: items.map((item) => {
          const lineQty = normalizePositiveQty(item.quantity, 1);
          const lineUnit = Number(item.unit_price || 0);
          const lineSubtotal = lineQty * lineUnit;
          return {
            id: randomUUID(),
            order_id: id,
            lodge_id: state.lodgeId,
            menu_item_id: item.menu_item_id || null,
            inventory_item_id: item.inventory_item_id || null,
            depletion_qty: normalizePositiveQty(item.depletion_qty, 1),
            item_name: item.item_name,
            category: item.category || null,
            modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
            item_notes: item.item_notes || null,
            quantity: lineQty,
            unit_price: lineUnit,
            // The receipt renders net_subtotal ?? subtotal ?? gross_subtotal
            // and never estimates; persist all three so offline receipts,
            // My Sales and history always show real line prices.
            subtotal: lineSubtotal,
            net_subtotal: lineSubtotal,
            gross_subtotal: lineSubtotal,
            kitchen_station_id: item.kitchen_station_id || null
          };
        })
      };

      const cachedOrders = /** @type {Record<string, unknown>[]} */ (readCache('pos-orders'));
      cachedOrders.unshift(orderRow);
      writeCache('pos-orders', cachedOrders);

      const cachedLineItems = /** @type {unknown[]} */ (readCache('pos-order-items'));
      writeCache('pos-order-items', [...orderRow.pos_order_items, ...cachedLineItems]);
      applyOfflinePosInventoryReservation(inventoryReservations);
      appendPrepTickets(orderRow, orderRow.pos_order_items);
      appendPosAudit('order_completed_offline', { entity_type: 'pos_order', entity_id: id, details: { total, outlet_id: data.outlet_id || null, table_name: data.table_name || null, catalog_snapshot_id: offlineCatalogSnapshotId, v3: true } });
      let tabCloseWarning = null;
      if (data.tab_id) {
        // The server closes the tab atomically when this sale replays, so no
        // separate close is queued here (it would race the settlement into a
        // spurious already-settled dead-letter). The local row is marked
        // closed-pending for display; a dead-lettered replay reopens it.
      const localTab = /** @type {(PosTabExpectedData & {_pending_settlement?: boolean})[]} */ (readPosTabs()).find((row) => row.id === data.tab_id) || null;
        if (localTab && localTab.status !== 'closed') {
          upsertLocalPosTab({ ...localTab, status: 'closed', updated_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending', _pending_settlement: true });
        }
      }

      return { success: true, id, offline: true, provisional: true, receipt_number: offlineReceiptNumber, order: orderRow, ...(tabCloseWarning ? { tab_close_warning: tabCloseWarning } : {}) };
    }

    // Resolve booking ID before entering the transaction (read-only, safe outside)
    let bookingIdForRpc = bookingId;
    if (data.room_id && !bookingIdForRpc) {
      const booking = await getActiveBookingForRoom(data.room_id);
      bookingIdForRpc = booking?.id || null;
    }

    // Resolve catalog snapshot (mandatory for v3)
    let catalogSnapshotId = data.catalog_snapshot_id || null;
    if (!catalogSnapshotId) {
      try {
        const snapshot = /** @type {PosCreateOrderCatalogSnapshotExpectedData} */ (await getActivePosCatalogSnapshot(data.outlet_id || null));
        catalogSnapshotId = snapshot?.snapshot_id || null;
      } catch (snapErr) {
        throw new Error(`Catalog snapshot required: ${/** @type {{message: unknown}} */ (snapErr).message}`);
      }
    }
    if (!catalogSnapshotId) {
      throw new Error('catalog_snapshot_id is mandatory. Publish a catalog before trading.');
    }
    if (!data.shift_id) {
      throw new Error('shift_id is mandatory. Open a shift before creating orders.');
    }

    // v3 RPC: server resolves all prices from catalog snapshot.
    // Client sends only item selections (menu_item_id, quantity, item_name, category, modifiers).
    // Server ignores any client-supplied unit_price.
    let v3Payload = {
      id: orderId,
      submit_intent_id: submitIntentId,
      lodge_id: state.lodgeId,
      catalog_snapshot_id: catalogSnapshotId,
      shift_id: data.shift_id,
      source_device_id: getDesktopPosDeviceId(),
      outlet_id: data.outlet_id || null,
      walk_in_name: data.walk_in_name || null,
      room_id: data.room_id || null,
      booking_id: bookingIdForRpc || null,
      event_booking_id: eventBookingId || null,
      customer_id: data.customer_id || null,
      notes: data.notes || null,
      payment_method: paymentMethod,
      payment_breakdown: paymentBreakdown,
      gross_total: totals.gross_total,
      discount_total: totals.discount_total,
      tax_rate: totals.tax_rate,
      tax_total: totals.tax_total,
      total,
      service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
      table_name: data.table_name || null,
      tab_name: data.tab_name || null,
      tab_id: data.tab_id || null,
      delivery_address: data.delivery_address || null,
      delivery_notes: data.delivery_notes || null,
      waiter_name: data.waiter_name || null,
      waiter_id: data.waiter_id || null,
      cashier_id: data.cashier_id || null,
      cashier_name: data.cashier_name || null,
      operator_id: data.cashier_id || data.operator_id || null,
      customer_account_charge: data.customer_account_charge || null,
      customer_segment: data.customer_segment || null,
      ticket_status: data.ticket_status || 'new',
      create_idempotency_key: submitIdempotencyKey,
      client_created_at: stableCreatedAtClient,
      tip_total: totals.tip_total,
      promotion_id: data.promotion_id || null,
      manual_discount: data.manual_discount || null,
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id || null,
        item_name: i.item_name || null,
        category: i.category || null,
        quantity: i.quantity,
        unit_price: Number(i.unit_price || 0),
        base_unit_price: Number(i.base_unit_price || i.unit_price || 0),
        modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
        modifier_option_ids: Array.isArray(i.modifier_option_ids)
          ? i.modifier_option_ids
        : (Array.isArray(i.modifiers) ? /** @type {unknown[]} */ (i.modifiers) : [])
            .map((modifier) => typeof modifier === 'string' ? modifier : /** @type {{id?: unknown} | null | undefined} */ (modifier)?.id)
            .filter(Boolean),
        item_notes: i.item_notes || null
      }))
    };

    // The journal digest is based on the exact payload sent to
    // create_pos_order_v3. On a retry, replace the newly rebuilt envelope
    // with the originally journalled one before issuing the RPC.
    //
    // Optional tab-identity fields travel only when the caller sent them
    // (byte-equivalent retries), then brand-new version-less tab_id
    // settlements fail closed before journaling. Replays reuse their
    // journalled bytes: the server replays committed work first and
    // definitively rejects uncommitted work so the attempt can be cleared.
    applyOptionalV3TabFields(v3Payload, data);
    if (data.tab_id && !isPositiveTabVersion(data.expected_tab_version) && !hasPosSubmitAttempt(submitIntentId)) {
      throw new Error('This sale is missing its tab version. Refresh the open check before taking payment.');
    }
      // Retry byte-equivalence (mirrors the offline path): the journal digest
      // covers the exact RPC envelope, and a rebuilt envelope after catalog or
      // shift changes never hashes equal to the original — tripping the
      // changed-payload conflict on a legitimate same-intent retry. Swap in
      // the journalled bytes BEFORE recording so the retry reuses its
      // envelope (idempotent under the original operation key) instead of
      // conflicting with itself. Genuinely new intents are unaffected, and a
      // changed sale still gets a fresh intent id upstream.
      if (hasPosSubmitAttempt(submitIntentId)) {
        const storedRetry = /** @type {PosCreateOrderAttemptExpectedData|null} */ (getPosSubmitAttempt(submitIntentId));
        if (storedRetry?.payload) {
          // The persisted journal payload stays unknown; this view only types
          // the existing retry spread and does not validate its JSON shape.
          // The journal payload remains unvalidated; this expected-data view
          // matches the envelope already built above and preserves the spread.
          v3Payload = { .../** @type {typeof v3Payload} */ (storedRetry.payload) };
        }
      }
      const onlineAttempt = recordAttempt(v3Payload);
      if (onlineAttempt.conflict) return onlineAttempt.error;
      if (onlineAttempt.resolution.reused && onlineAttempt.attempt.payload) {
        // Reused journal payload is unvalidated; keep the original spread and
        // type only the expected shape of the exact envelope produced here.
        v3Payload = { .../** @type {typeof v3Payload} */ (onlineAttempt.attempt.payload) };
      // A retry replays the original journalled bytes under the original
      // operation key. The server claims the financial operation before it
      // checks the shift, so an already committed sale reconciles from its
      // stored receipt even after that shift closed. An uncommitted sale whose
      // originating shift has since closed is routed through the reviewed
      // historical-sale contract with its ORIGINAL shift, operator and
      // business date. It is never reattributed to today's open shift: that
      // either conflicts with the committed receipt hash or silently moves
      // revenue into the wrong cash-up. When the contract is not deployed the
      // retry fails closed with an actionable message and the journal stays
      // pending so the same operation key is retried unchanged later.
        replayHistoricalSale = classifySaleReplayRoute(readCache('pos-shifts'), v3Payload) === 'historical';
      }
    // Fresh attempts only (see offline path): replays reuse journalled bytes
    // so configuration changes can never block committed work.
    if (!onlineAttempt.resolution.reused) assertSaleModifierRequirements(v3Payload.items);

    // All DB writes are delegated to a single Postgres transaction via RPC.
    // If any step fails, Postgres rolls back the entire operation automatically.
    // The historical route forwards the identical payload bytes through the
    // reviewed wrapper, which reconciles the exact committed receipt first.
    const replayEnvelope = replayHistoricalSale
      ? buildHistoricalReplayRequest({ _queue_id: submitIntentId }, v3Payload)
      : (operatorProof ? { ...v3Payload, _operator_proof: operatorProof } : v3Payload);
    // Measured request deadline (WP D): a submit that never answers must not
    // hold the Till hostage, and a late completion must never run the success
    // path after the winner was chosen. The waiter abandons the unanswered
    // request; the journal stays pending, so any retry or recovery reuses the
    // exact same operation key and receipt. A timed-out submit is never
    // re-keyed and is never treated as proof that nothing committed.
    const submitRequest = replayHistoricalSale
      ? /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc(POS_HISTORICAL_REPLAY_RPC, replayEnvelope)
      : /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_pos_order_v3', replayEnvelope);
    const submitDeadlineMs = posSubmitDeadlineMs();
    let submitOutcome;
    try {
      submitOutcome = await withNetworkTimeout(submitRequest, submitDeadlineMs, 'Sale submit');
    } catch (deadlineError) {
      // Only the measured deadline itself is rewritten. Any other rejection
      // (definite client-side or transport failure) keeps its own error so a
      // failure that provably never reached the server is never mislabelled
      // as "may already be recorded".
      if (/** @type {{code?: unknown}} */ (deadlineError)?.code !== 'network_read_timeout') throw deadlineError;
      const timedOut = /** @type {Error & {code?: string, timeout_ms?: number}} */ (new Error('The sale submit did not answer in time. The sale is saved on this till and may already be recorded; it will be reconciled with the same receipt before anything is rung again. Do not start a new sale for it.'));
      timedOut.code = 'pos_submit_timeout';
      timedOut.timeout_ms = submitDeadlineMs;
      timedOut.cause = deadlineError;
      throw timedOut;
    }
    const { data: result, error } = /** @type {{data: {success?: boolean, id?: string, total?: unknown, tickets?: unknown[], tab_close_warning?: unknown, code?: string, error?: unknown} | null, error: {message: string, code?: string} | null}} */ (submitOutcome);

    if (error) {
      if (replayHistoricalSale && isHistoricalReplayContractMissing(error)) {
      const contractError = /** @type {Error & {code?: string}} */ (new Error('This sale is waiting for the historical replay contract, which is not deployed on the server yet. It stays saved and will resume automatically after deployment; do not ring it again.'));
        contractError.code = 'historical_replay_contract_missing';
        throw contractError;
      }
      throw new Error(error.message);
    }
    if (result?.success) {
      const serverTotal = result.total === null || result.total === undefined || result.total === ''
        ? null
        : normalizeMoney(result.total);
      // Use server-created tickets from the RPC result (item-grouped by station)
      const serverTickets = Array.isArray(result.tickets) ? result.tickets : [];
      if (serverTickets.length > 0) {
        writePosTickets([...serverTickets, ...readPosTickets()]);
      } else {
        // Fallback: fetch tickets if RPC didn't return them
        try {
        const { data: fetchedTickets } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
            .from('pos_prep_tickets')
            .select('*')
            .eq('lodge_id', state.lodgeId)
            .eq('order_id', result.id || orderId);
          if (Array.isArray(fetchedTickets) && fetchedTickets.length > 0) {
            writePosTickets([...fetchedTickets, ...readPosTickets()]);
          }
        } catch (ticketErr) {
          console.warn('[POS] Could not fetch server tickets:', /** @type {{message?: unknown} | null | undefined} */ (ticketErr)?.message || ticketErr);
        }
      }
      appendPosAudit('order_completed', { entity_type: 'pos_order', entity_id: result.id || orderId, details: { total: serverTotal, outlet_id: data.outlet_id || null, table_name: data.table_name || null, catalog_snapshot_id: catalogSnapshotId, v3: true, ticket_count: serverTickets.length } });
      // Tab settlement is atomic inside create_pos_order_v3 (resolve, record,
      // close in one transaction); the result already carries tab_closed /
      // tab_close_warning. No client-side follow-up close: a second RPC could
      // neither observe nor repair a crash consistently.
      commitPosSubmitAttempt(submitIntentId);
      // Recipe stock depletion is written atomically inside create_pos_order_v3
      // (server trigger), so no follow-up call is needed here.
    }
    if (result?.success === false) {
      const resultCode = String(result?.code || '');
      const outcomeMayStillBeAmbiguous =
        resultCode.startsWith('till_operator_') ||
        resultCode === 'till_shift_closed' ||
        resultCode === 'shift_not_open' ||
        resultCode === 'tab_already_settled' ||
        resultCode === 'tab_not_owned' ||
        resultCode === 'tab_version_conflict' ||
        resultCode === 'tab_version_required' ||
        resultCode === 'pos_submit_recovery_required' ||
        resultCode === 'idempotency_conflict' ||
        resultCode === 'idempotency_expired';
      if (!outcomeMayStillBeAmbiguous) {
        // A structured server rejection is authoritative proof that this
        // attempt did not commit. Only then may the operator correct the
        // cart and begin a genuinely new sale.
        clearPosSubmitAttemptRecord(submitIntentId);
      }
    }
    return result;
  } catch (error) {
    recordCriticalError('pos.order.create', error, {
      room_id: data?.room_id || null,
      booking_id: data?.booking_id || null,
      outlet_id: data?.outlet_id || null,
      payment_method: data?.payment_method || 'cash'
    });
    throw error;
  }
}

export async function voidPosOrder(id) {
  return {
    success: false,
    error: 'POS voids require supervisor, manager, or admin PIN approval.'
  };
}

export async function approvePosVoidWithPin(payload) {
  const { order_id, pin, reason, cashier_user_id, outlet_id } = payload || {};

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'A void reason is required' };
  }

  const cachedOrders = readCache('pos-orders');
  const cachedOrder = cachedOrders.find((order) => order?.id === order_id);
  if (!cachedOrder && !state.isOnline) {
    return { success: false, error: 'Order not found on this computer' };
  }

  const logId = payload?.override_log_id || randomUUID();
  const createdAt = payload?.created_at || new Date().toISOString();
  const rpcPayload = {
    order_id,
    lodge_id: state.lodgeId,
    requested_by: cashier_user_id || null,
    approved_by: payload?.approver_id || null,
    pin: String(pin).trim(),
    device_id: getDesktopPosDeviceId(),
    reason: String(reason).trim(),
    direct_stock_disposition: payload?.direct_stock_disposition || 'return_to_stock',
    outlet_id: outlet_id || cachedOrder?.outlet_id || null,
    override_log_id: logId,
    created_at: createdAt
  };

  const queuePendingVoid = () => {
    if (cachedOrder?.status === 'voided') {
      return { success: false, error: 'Order is already voided' };
    }

    const queueMeta = {
      _queue_id: `pos-void-${order_id}`,
      ...(cachedOrder?._pending_sync || cachedOrder?._sync_created_offline ? { _depends_on: `pos-order-${order_id}` } : {})
    };
    queueOperation('rpc', 'approve_pos_void_with_pin', {
      payload: rpcPayload
    }, null, queueMeta);

    patchCachedPosOrderSyncState(order_id, {
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      _pending_void: true,
      _void_reason: String(reason).trim()
    });
    upsertLocalPosVoidHistory({
      id: logId,
      order_id,
      action: 'void',
      requested_by: cashier_user_id || null,
      approved_by: null,
      approver_name: 'Pending server validation',
      reason: String(reason).trim(),
      direct_stock_disposition: rpcPayload.direct_stock_disposition,
      outlet_id: outlet_id || cachedOrder?.outlet_id || null,
      created_at: createdAt,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    return {
      success: true,
      offline: true,
      provisional: true,
      override_log_id: logId,
      reason: String(reason).trim()
    };
  };

  if (!state.isOnline) {
    return queuePendingVoid();
  }

  try {
    const { data: result, error } = await state.supabase.rpc('approve_pos_void_with_pin', {
      payload: rpcPayload
    });

    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not void order' };
    upsertLocalPosVoidHistory({
      id: result.override_log_id || logId,
      order_id,
      action: 'void',
      requested_by: cashier_user_id || null,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      reason: String(reason).trim(),
      direct_stock_disposition: rpcPayload.direct_stock_disposition,
      outlet_id: outlet_id || cachedOrder?.outlet_id || null,
      created_at: createdAt,
      _pending_sync: false,
      _sync_state: 'synced'
    });
    const voidRefreshWarning = await refreshPosCachesBestEffort(['pos-orders', 'inventory-items', 'inventory-purchases'], 'void');
    if (voidRefreshWarning) return { ...result, refresh_warning: voidRefreshWarning };
    return result;
  } catch (error) {
    if (isNetworkError(error) && cachedOrder) {
      return queuePendingVoid();
    }
    throw error;
  }
}

/** @param {PosPartialReturnRequest} [payload] */
export async function createPosPartialReturnWithPin(payload = {}) {
  const {
    order_id,
    pin,
    reason,
    lines = [],
    cashier_user_id,
    outlet_id,
    payment_method,
    shift_id
  } = payload || {};

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'Reason is required' };
  }
  if (!shift_id) {
    return { success: false, error: 'Open shift is required for returns' };
  }

  // This expected-data view is backed by the cache row and `pos_orders` plus
  // `pos_order_items(*)` reader; it does not validate either returned value.
  const originalOrder = /** @type {PosPartialReturnSourceOrder | null} */ (await getPosOrderWithItemsById(order_id));
  if (!originalOrder) return { success: false, error: 'Original order not found' };
  if (originalOrder.status === 'voided') return { success: false, error: 'Cannot return items from a voided order' };

  const originalLines = Array.isArray(originalOrder.pos_order_items) ?
  /** @type {PosPartialReturnSourceLine[]} */ (originalOrder.pos_order_items) :
  Array.isArray(originalOrder.items) ?
  /** @type {PosPartialReturnSourceLine[]} */ (originalOrder.items) :
  [];
  const requestedByLine = new Map((lines || []).
  map((line) => /** @type {[string, number]} */ ([String(line.line_id || line.id || '').trim(), Number(line.quantity || 0)])).
  filter(([lineId, quantity]) => lineId && Number.isFinite(quantity) && quantity > 0));
  /** @type {PosPartialReturnLine[]} */
  const returnLines = [];

  for (const line of originalLines) {
    const lineId = String(line.id || '').trim();
    const requestedQty = requestedByLine.get(lineId) || 0;
    if (!(requestedQty > 0)) continue;
    const originalQty = Number(line.quantity || 0);
    const unitPrice = Number(line.unit_price || 0);
    if (!(originalQty > 0) || unitPrice < 0) continue;
    if (!Number.isInteger(requestedQty)) {
      return { success: false, error: 'Return quantities must be whole numbers.' };
    }
    if (requestedQty > originalQty) {
      return { success: false, error: `Return quantity exceeds the sold quantity for ${line.item_name || 'an item'}.` };
    }
    const returnQty = requestedQty;
    returnLines.push({
      original_order_item_id: lineId,
      menu_item_id: line.menu_item_id || null,
      inventory_item_id: line.inventory_item_id || null,
      depletion_qty: normalizePositiveQty(line.depletion_qty, 1),
      item_name: `Return: ${line.item_name || 'POS item'}`,
      quantity: -returnQty,
      unit_price: unitPrice
    });
  }

  if (returnLines.length === 0) {
    return { success: false, error: 'Select at least one item quantity to return.' };
  }

  const returnId = payload.return_order_id || randomUUID();
  const createdAt = payload.created_at || new Date().toISOString();
  const total = returnLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const notes = [
  `Partial return for POS order ${String(order_id).slice(0, 8)}`,
  String(reason || '').trim()]
  .filter(Boolean).
  join(' · ');

  // P0-4: Use database-authoritative return RPC
  const rpcPayload = {
    order_id,
    lodge_id: state.lodgeId,
    return_order_id: returnId,
    return_idempotency_key: `pos-return:${returnId}`,
    shift_id,
    approval_pin: String(pin).trim(),
    approver_id: payload?.approver_id || null,
    device_id: getDesktopPosDeviceId(),
    reason: String(reason).trim(),
    requested_by: cashier_user_id || null,
    outlet_id: outlet_id || originalOrder.outlet_id || null,
    override_log_id: payload.override_log_id || randomUUID(),
    created_at: createdAt,
    lines: returnLines.map((line) => ({
      line_id: line.original_order_item_id,
      quantity: Math.abs(Number(line.quantity) || 0)
    }))
  };

  const queuePendingReturn = () => {
    queueOperation('rpc', 'create_pos_return_v3', { payload: rpcPayload }, returnId, {
      _queue_id: `pos-return-${returnId}`,
      ...(originalOrder._pending_sync ? { _depends_on: `pos-order-${order_id}` } : {})
    });
    const orderRow = {
      id: returnId,
      lodge_id: state.lodgeId,
      order_id,
      items: returnLines,
      total,
      gross_total: total,
      // A queued return has no server-confirmed tender envelope yet. Do not
      // inherit the original sale's tender and present it as a real payment.
      payment_method: payment_method || null,
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      walk_in_name: `Return: ${originalOrder.walk_in_name || 'Guest'}`,
      notes,
      status: 'pending',
      created_at: createdAt,
      _pending_sync: true,
      _sync_state: 'pending',
      _pending_return: true,
      _sync_created_offline: true,
      pos_order_items: returnLines.map((line) => ({
        id: randomUUID(),
        order_id: returnId,
        lodge_id: state.lodgeId,
        ...line,
        subtotal: Number(line.quantity || 0) * Number(line.unit_price || 0)
      }))
    };
    // The cache writer stores POS order rows in this list; keep the native
    // unshift failure behavior for malformed persisted cache values.
    const cachedOrders = /** @type {PosPartialReturnSourceOrder[]} */ (readCache('pos-orders'));
    cachedOrders.unshift(orderRow);
    writeCache('pos-orders', cachedOrders);
    upsertLocalPosVoidHistory({
      id: rpcPayload.override_log_id,
      order_id,
      action: 'partial_return',
      requested_by: cashier_user_id || null,
      approved_by: null,
      approver_name: 'Pending server validation',
      reason: String(reason).trim(),
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      created_at: createdAt,
      return_order_id: returnId,
      return_total: total,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    return { success: true, id: returnId, total, offline: true, provisional: true };
  };

  if (!state.isOnline || !state.supabase) return queuePendingReturn();

  try {
    const { data: result, error } = await state.supabase.rpc('create_pos_return_v3', { payload: rpcPayload });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Return failed' };
    upsertLocalPosVoidHistory({
      id: rpcPayload.override_log_id,
      order_id,
      action: 'partial_return',
      requested_by: cashier_user_id || null,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      reason: String(reason).trim(),
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      created_at: createdAt,
      return_order_id: result.id || returnId,
      return_total: result.total,
      _pending_sync: false,
      _sync_state: 'synced'
    });
    const returnRefreshWarning = await refreshPosCachesBestEffort(['pos-orders', 'inventory-items', 'inventory-purchases'], 'partial-return');
    if (returnRefreshWarning) return { ...result, refresh_warning: returnRefreshWarning };
    return result;
  } catch (error) {
    if (isNetworkError(error)) return queuePendingReturn();
    throw error;
  }
}

export async function approvePosDiscountWithPin(payload = {}) {
  const { pin, discount_type, discount_value, reason, cashier_user_id, outlet_id, order_total } = payload || {};

  if (!pin) {
    return { success: false, error: 'Manager PIN is required to approve discounts.' };
  }
  if (!discount_value || Number(discount_value) <= 0) {
    return { success: false, error: 'Discount value must be greater than zero.' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'A reason for the discount is required.' };
  }

  const discountAmount = discount_type === 'percent'
    ? (Number(order_total || 0) * Math.min(Number(discount_value), 100) / 100)
    : Number(discount_value);

  const approvalId = randomUUID();
  const createdAt = new Date().toISOString();

  const rpcPayload = {
    lodge_id: state.lodgeId,
    pin: String(pin).trim(),
    device_id: getDesktopPosDeviceId(),
    action: 'discount',
    discount_type: discount_type || 'amount',
    discount_value: Number(discount_value),
    discount_amount: Math.round(discountAmount * 100) / 100,
    reason: String(reason).trim(),
    requested_by: cashier_user_id || null,
    outlet_id: outlet_id || null,
    approval_id: approvalId,
    created_at: createdAt
  };

  if (!state.isOnline || !state.supabase) {
    return {
      success: false,
      error: 'Discount approval requires an internet connection so the manager PIN can be verified.'
    };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('approve_pos_discount_with_pin', {
      payload: rpcPayload
    });

    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not approve discount.' };

    appendPosAudit('pos:discount_approved', {
      approval_id: result.approval_id || approvalId,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      discount_type: discount_type || 'amount',
      discount_value: Number(discount_value),
      discount_amount: result.discount_amount || Math.round(discountAmount * 100) / 100,
      reason: String(reason).trim()
    });

    return result;
  } catch (error) {
    if (isNetworkError(error)) {
      return {
        success: false,
        error: 'Discount approval could not be verified. Check the connection and try again.'
      };
    }
    throw error;
  }
}

/** @param {PosOrderExpectedData[]} [orders] @param {{openingFloat?: number}} [options] */
function summarizeCashupOrders(orders = [], { openingFloat = 0 } = {}) {
  const completed = (orders || []).filter((order) => order?.status === 'completed');
  const voided = (orders || []).filter((order) => order?.status === 'voided');
  /** @type {Record<string, number>} */
  const byMethod = {};
  let grossSales = 0;
  let returnTotal = 0;
  let pendingCount = 0;

  for (const order of completed) {
    const total = normalizeMoney(order.total);
    const orderSign = total >= 0 ? 1 : -1;
    // A partial breakdown is not a cash-up expectation. Keep the cached row
    // visible for investigation, but do not let it create a partial drawer
    // variance or tender total.
    for (const payment of (hasRecordedPosTenderEnvelope(order) ? getOrderPaymentRows(order) : [])) {
      const amount = Number(payment.amount || 0);
      const signedAmount = orderSign < 0 ? -Math.abs(amount) : Math.abs(amount);
      // getOrderPaymentRows normalizes and filters method to a non-empty string.
      byMethod[/** @type {string} */ (payment.method)] = normalizeMoney((byMethod[/** @type {string} */ (payment.method)] || 0) + signedAmount);
    }
    if (total >= 0) grossSales = normalizeMoney(grossSales + total);
    else returnTotal = normalizeMoney(returnTotal + Math.abs(total));
    if (order._pending_sync || order._sync_state === 'pending') pendingCount += 1;
  }

  const netSales = normalizeMoney(completed.reduce((sum, order) => sum + normalizeMoney(order.total), 0));
  const cashSales = normalizeMoney(byMethod.cash || 0);
  return {
    orders_count: completed.length,
    void_count: voided.length,
    pending_count: pendingCount,
    gross_sales: grossSales,
    returns_total: returnTotal,
    net_sales: netSales,
    by_method: byMethod,
    expected_cash_sales: cashSales,
    expected_cash_drawer: normalizeMoney(openingFloat + cashSales)
  };
}

/**
 * The POS cash-up view and create-session summary call pass this filter shape;
 * the empty default is retained. IPC values are not runtime-validated here.
 * @typedef {{shift_id: string|null, date: string|null|undefined, outlet_id: string|null, outlet_filter: string[]|null, opening_float: unknown, cashier_id: string|null, cashier_name: string|null} | Record<string, undefined>} PosCashupSummaryFilters
 */
/** @typedef {{cashier_id: string|null} | Record<string, undefined>} PosCashupHistoryFilters */
/**
 * Expected row shape from `pos_cashup_sessions` (`select('*, outlets(name)')`)
 * and the local `pos-cashups` cache. Money and JSON columns remain unknown;
 * this view does not validate database or cache rows.
 * @typedef {Record<string, unknown> & {id: string, lodge_id: string, date: string, outlet_id: string|null, shift_id: string|null, created_by: string|null, cashier_id: string|null, created_at: string, outlets?: {name: string|null}|null}} PosCashupHistoryRow
 */
/**
 * Request produced by the POS cash-up form, with the existing empty-default
 * path and legacy counted-value aliases retained. Raw counts stay unknown
 * until the existing normalizeMoney calls consume them.
 * @typedef {{shift_id: string|null, date: string, outlet_id: string|null, opening_float: unknown, counted: Record<string, unknown>, notes: string|null, cashier_id: string|null, cashier_name: string|null, created_by?: string|null, created_by_name?: string|null, outlet_filter?: string[]|null, id?: string, idempotency_key?: string, counted_cash?: unknown, counted_card?: unknown, counted_bank_transfer?: unknown, counted_orange_money?: unknown, counted_myzaka?: unknown, counted_smega?: unknown, counted_other?: unknown} | Record<string, undefined>} PosCashupCreateRequest
 */
/** @param {PosCashupSummaryFilters} [filters] */
export async function getPosCashupSummary(filters = {}) {
  if (state.isOnline && state.supabase && filters.shift_id) {
    const { data, error } = await state.supabase.rpc('get_pos_shift_cashup_preview_v2', {
      p_shift_id: filters.shift_id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not load the shift cash-up preview');
    return {
      ...data,
      date: data.business_date,
      outlet_id: filters.outlet_id || null,
      orders_count: data.order_count || 0,
      returns_total: data.returns || 0,
      by_method: data.expected_by_method || {},
      pending_count: 0,
      closed_cashups: readPosCashups().filter((row) => row.shift_id === filters.shift_id)
    };
  }

  const date = filters.date || getLocalDateKey();
  const outletId = filters.outlet_id && filters.outlet_id !== 'all' ? filters.outlet_id : null;
  const outletFilter = outletId ? [outletId] : Array.isArray(filters.outlet_filter) ? filters.outlet_filter : null;
  const operatorId = filters.cashier_id || null;
  const operatorName = filters.cashier_name || null;
  const orders = await getPosOrders(date, date, outletFilter);
  const scopedOrders = orders.filter((order) => {
    if (outletId && order.outlet_id !== outletId) return false;
    if (operatorId) return order.cashier_id === operatorId || (!order.cashier_id && order.cashier_name === operatorName);
    return true;
  });
  const openingFloat = normalizeMoney(filters.opening_float || 0);
  return {
    date,
    outlet_id: outletId,
    cashier_id: operatorId,
    cashier_name: operatorName,
    opening_float: openingFloat,
    ...summarizeCashupOrders(scopedOrders, { openingFloat }),
    closed_cashups: readPosCashups().filter((row) =>
      row.date === date &&
      (!outletId || row.outlet_id === outletId) &&
      (!operatorId || row.created_by === operatorId || row.cashier_id === operatorId)
    )
  };
}

/**
 * @param {number} [limit]
 * @param {string[]|null} [outletFilter]
 * @param {PosCashupHistoryFilters} [filters]
 */
export async function getPosCashups(limit = 30, outletFilter = null, filters = {}) {
  const max = Math.max(1, Math.min(200, Number(limit || 30)));
  const operatorId = filters?.cashier_id || null;
  /** @param {PosCashupHistoryRow[]} [rows] @returns {PosCashupHistoryRow[]} */
  const applyCashupOutletFilter = (rows = []) => {
    if (outletFilter !== null && outletFilter.length === 0) return [];
    const outletRows = outletFilter !== null ? rows.filter((row) => !row.outlet_id || outletFilter.includes(row.outlet_id)) : rows;
    if (!operatorId) return outletRows;
    return outletRows.filter((row) => row.created_by === operatorId || row.cashier_id === operatorId);
  };
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.
      from('pos_cashup_sessions').
      select('*, outlets(name)').
      eq('lodge_id', state.lodgeId).
      order('created_at', { ascending: false }).
      limit(max);
      if (error) throw error;
      const rows = /** @type {PosCashupHistoryRow[]} */ ((data || []).map((/** @type {PosCashupHistoryRow} */ row) => ({
        ...row,
        outlet_name: row.outlets?.name || null
      })));
      if (rows.length > 0) writePosCashups(rows);
      return applyCashupOutletFilter(rows.length > 0 ? rows : readPosCashups()).slice(0, max);
    } catch {
      return applyCashupOutletFilter(readPosCashups()).slice(0, max);
    }
  }
  return applyCashupOutletFilter(readPosCashups()).slice(0, max);
}

/** @param {PosCashupCreateRequest} [payload] */
export async function createPosCashupSession(payload = {}) {
  const id = payload.id || randomUUID();
  if (!payload.shift_id) {
    return { success: false, error: 'An open shift is required before cash-up can be finalized.' };
  }

  const openingFloat = normalizeMoney(payload.opening_float || 0);
  const operatorId = payload.cashier_id || payload.created_by || state.currentUser?.id || null;
  const operatorName = payload.cashier_name || payload.created_by_name || state.currentUser?.name || state.currentUser?.email || null;
  const summary = await getPosCashupSummary({
    shift_id: payload.shift_id,
    date: payload.date,
    outlet_id: payload.outlet_id || null,
    outlet_filter: payload.outlet_filter || null,
    opening_float: openingFloat,
    cashier_id: operatorId,
    cashier_name: operatorName
  });
  const counted = {
    cash: normalizeMoney(payload.counted?.cash ?? payload.counted_cash ?? 0),
    card: normalizeMoney(payload.counted?.card ?? payload.counted_card ?? 0),
    bank_transfer: normalizeMoney(payload.counted?.bank_transfer ?? payload.counted_bank_transfer ?? 0),
    orange_money: normalizeMoney(payload.counted?.orange_money ?? 0),
    myzaka: normalizeMoney(payload.counted?.myzaka ?? 0),
    smega: normalizeMoney(payload.counted?.smega ?? 0),
    other: normalizeMoney(payload.counted?.other ?? 0)
  };
  const varianceByMethod = Object.fromEntries(Object.entries(counted).map(([method, amount]) => {
    const expected = method === 'cash'
      ? summary.expected_cash_drawer
      : normalizeMoney(summary.by_method?.[method] || 0);
    return [method, normalizeMoney(amount - expected)];
  }));
  const idempotencyKey = payload.idempotency_key || `pos-cashup:${id}`;
  const rpcPayload = {
    lodge_id: state.lodgeId,
    shift_id: payload.shift_id,
    cashup_id: id,
    idempotency_key: idempotencyKey,
    counted_by_method: counted,
    notes: payload.notes || null
  };
  const row = {
    id,
    lodge_id: state.lodgeId,
    date: summary.date,
    outlet_id: summary.outlet_id || null,
    opening_float: openingFloat,
    expected_cash_drawer: summary.expected_cash_drawer,
    expected_by_method: summary.by_method,
    counted_by_method: counted,
    variance_by_method: varianceByMethod,
    cash_over_short: varianceByMethod.cash || 0,
    orders_count: summary.orders_count,
    void_count: summary.void_count,
    pending_count: summary.pending_count,
    gross_sales: summary.gross_sales,
    returns_total: summary.returns_total,
    net_sales: summary.net_sales,
    notes: payload.notes || null,
    created_by: operatorId,
    created_by_name: operatorName,
    cashier_id: operatorId,
    cashier_name: operatorName,
    shift_id: payload.shift_id,
    idempotency_key: idempotencyKey,
    created_at: new Date().toISOString(),
    _pending_sync: !state.isOnline,
    _sync_state: state.isOnline ? 'synced' : 'pending'
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('finalize_pos_shift_cashup_v2', { payload: rpcPayload });
    if (error) throw new Error(error.message);
    if (!data?.success) return { success: false, error: data?.error || 'Could not finalize cash-up' };
    const saved = upsertLocalPosCashup({
      ...row,
      id: data.cashup_id || id,
      expected_cash_drawer: Number(data.expected_cash_drawer || 0),
      expected_by_method: data.expected_by_method || {},
      counted_by_method: data.counted_by_method || counted,
      variance_by_method: data.variance_by_method || {},
      _pending_sync: false,
      _sync_state: 'synced'
    });
    const cashupRefreshWarning = await refreshPosCachesBestEffort(['pos-orders'], 'cashup');
    if (cashupRefreshWarning) return { success: true, id: saved.id, row: saved, refresh_warning: cashupRefreshWarning };
    return { success: true, id: saved.id, row: saved };
  }

  const cashupDependencies = [
    ...(readSyncQueue().filter((item) => item?.table === 'create_pos_order_v3' && item?.data?.payload?.shift_id === payload.shift_id).map((item) => item._queue_id)),
    ...(readPosShifts().find((shift) => shift.id === payload.shift_id)?._pending_sync ? [`pos-shift-${payload.shift_id}`] : [])
  ];
  queueOperation('rpc', 'finalize_pos_shift_cashup_v2', { payload: rpcPayload }, null, {
    _queue_id: `pos-cashup-${id}`,
    ...(cashupDependencies[0] ? { _depends_on: cashupDependencies[0], _depends_on_all: cashupDependencies } : {})
  });
  const saved = upsertLocalPosCashup({ ...row, _pending_sync: true, _sync_state: 'pending' });
  return { success: true, id: saved.id, row: saved, offline: true, provisional: true };
}

/**
 * Expected local cache / `pos_tabs` row view. JSON cache rows and PostgREST
 * JSON payloads are not runtime-validated by these annotations.
 * @typedef {Object} PosTabExpectedData
 * @property {string} id
 * @property {string | null} lodge_id
 * @property {string | null} outlet_id
 * @property {string | null} [table_name]
 * @property {string | null} [tab_name]
 * @property {string | null} [customer_name]
 * @property {string | null} [waiter_name]
 * @property {string | null} [waiter_id]
 * @property {string | null} [shift_id]
 * @property {string | null} [room_id]
 * @property {string | null} [booking_id]
 * @property {unknown} items
 * @property {string | null} [notes]
 * @property {string} [status]
 * @property {string | null} [opened_by]
 * @property {string | null} [opened_by_name]
 * @property {string} created_at
 * @property {string} updated_at
 * @property {number | null} [expected_version]
 * @property {number | null} [tab_version]
 * @property {number | null} [version]
 * @property {string | null} [closed_at]
 * @property {boolean} [_pending_sync]
 * @property {boolean} [_pending_settlement]
 * @property {string} [_sync_state]
 * @property {string} [_queue_id]
 * @property {unknown} [financial_snapshot]
 * @property {boolean} [financial_complete]
 * @property {boolean} [_financial_complete]
 */

/** @typedef {{status?: string, outletId?: string|null, outlet_id?: string|null} | Record<string, undefined>} PosTabFilters */
/** @typedef {{items: unknown[], status: string, outlet_id?: string|null, table_name?: string|null, tab_name?: string|null, customer_name?: string|null, customer_id?: string|null, waiter_name?: string|null, waiter_id?: string|null, shift_id?: string|null, room_id?: string|null, booking_id?: string|null, notes?: string|null, id?: string, expected_version?: number|null, tab_version?: number|null, service_mode?: string, delivery_address?: string|null, delivery_notes?: string|null, created_at?: string, _operator_proof?: string|null} | Record<string, undefined>} PosTabSaveRequest */
/** @typedef {{notes?: string|null, _operator_proof?: string|null} | Record<string, undefined>} PosTabStatusExtras */
/** @typedef {{tab_id?: string, id?: string, target_waiter_id: string, target_shift_id: string, operation_id?: string, expected_tab_version?: number|null, tab_version?: number|null, notes?: string|null, _operator_proof?: string|null, is_replay?: boolean} | Record<string, undefined>} PosTabWaiterTransferRequest */
/** @typedef {{action: 'close'|'deliver'|'transfer'|'merge', source_tab_id?: string, id?: string, target_table_name?: string|null, reason?: string|null, waiter_name?: string|null, _operator_proof?: string|null} | Record<string, undefined>} PosTabOverrideRequest */
/** @typedef {{source_tab_id: string, item_indices: number[], target_table_name?: string|null} | Record<string, undefined>} PosTabItemSplitRequest */
/** @typedef {{source_tab_id: string, split_count: number, target_table_names?: string[], source_tab_version?: number|null, idempotency_key?: string, _operator_proof?: string|null} | Record<string, undefined>} PosTabEvenSplitRequest */
/** @typedef {{message?: string|null}} PosTabErrorMessageView */
/** @typedef {{code?: string|null, sqlState?: string|null, message?: string|null}} PosTabRpcErrorExpectedData */
/**
 * Expected SQL JSONB result from split_pos_tab_evenly; RPC row values are not
 * runtime-validated. Its success flag distinguishes the documented result shapes.
 * @typedef {Record<string, unknown> & (
 *   {success: false, error: string, code?: 'tab_version_conflict'|'operator_proof_invalid'|'tab_not_owned'|'waiter_shift_required', tab?: PosTabExpectedData} |
 *   {success: true, source_tab: PosTabExpectedData, new_tabs: PosTabExpectedData[], source: 'server-authoritative-tab-split', replayed?: true}
 * )} PosTabSplitRpcExpectedData
 */

/** @returns {PosTabExpectedData[]} */
function readPosTabs() {
  const rows = readCache('pos-tabs');
  // The shape is expected from the POS cache and `pos_tabs` producer; this is not row validation.
  return Array.isArray(rows) ? /** @type {PosTabExpectedData[]} */ (rows) : [];
}

/** @param {PosTabExpectedData[]} [rows] @param {{invalidate?: boolean}} [options] */
function writePosTabs(rows = [], { invalidate = true } = {}) {
  if (invalidate) {
    invalidatePosRemoteReads('tabs');
    invalidatePosRemoteReads('floor');
  }
  writeCache('pos-tabs', rows.slice(0, 500));
}

const ACTIVE_TABLE_TAB_STATUSES = new Set(['open', 'running', 'ready', 'delivered']);

// A named bar tab is a POS tab even when it is not attached to a physical
// table. Keep this operational status predicate separate from the table-only
// helper below: table occupancy must still require table_name, while Open
// Tabs must include both table checks and named tabs.
// A missing or unknown status is NOT active: normalizeTabStatus falls back to
// 'open', which previously resurrected settled rows with no status as ~10
// phantom open tabs on every offline read. Genuine pending-sync estimates
// without a server status still show.
/** @param {PosTabExpectedData | Record<string, undefined>} [row] */
function isActivePosTab(row = {}) {
  const raw = String(row?.status || '').trim().toLowerCase();
  if (ACTIVE_TABLE_TAB_STATUSES.has(raw)) return true;
  if (row?._pending_sync === true && (raw === '' || raw === 'open')) return true;
  return false;
}

/** @param {unknown} value */
function normalizeTableName(value) {
  return String(value || '').trim();
}

function getCachedTabScope() {
  const cached = readCache('settings');
  const settings = Array.isArray(cached) ? cached[0] : cached;
  if (!settings || typeof settings !== 'object') return { known: false, isBar: false };
  return {
    known: true,
    isBar: isBarOnlyMode(settings) || settings.operating_profile?.commercial_package_key === 'bar_pos'
  };
}

function isBarTabScopeCached() {
  return getCachedTabScope().isBar;
}

function isTabScopeUnknown() {
  return !getCachedTabScope().known;
}

/** @param {unknown} value @param {string} [fallback] */
function normalizeTabStatus(value, fallback = 'open') {
  const status = String(value || '').trim().toLowerCase();
  return ['open', 'running', 'ready', 'delivered', 'closed', 'cancelled'].includes(status) ? status : fallback;
}

/** @param {PosTabExpectedData | Record<string, undefined>} [row] */
function isActiveTableTab(row = {}) {
  if (!normalizeTableName(row.table_name)) return false;
  const raw = String(row?.status || '').trim().toLowerCase();
  if (ACTIVE_TABLE_TAB_STATUSES.has(raw)) return true;
  if (row?._pending_sync === true && (raw === '' || raw === 'open')) return true;
  return false;
}

/** @param {unknown} a @param {unknown} b */
function sameOutlet(a, b) {
  return String(a || '') === String(b || '');
}

/** @param {PosTabExpectedData[]} [rows] @param {string|null|undefined} tableName @param {string|null} [outletId] @param {string|null} [excludeId] @returns {PosTabExpectedData|null} */
function findActiveTableTab(rows = [], tableName, outletId = null, excludeId = null) {
  const targetName = normalizeTableName(tableName).toLowerCase();
  if (!targetName) return null;
  return (rows || []).find((row) =>
    isActiveTableTab(row) &&
    normalizeTableName(row.table_name).toLowerCase() === targetName &&
    sameOutlet(row.outlet_id || null, outletId || null) &&
    (!excludeId || row.id !== excludeId)
  ) || null;
}

/** @param {PosTabExpectedData} row @returns {PosTabExpectedData} */
function upsertLocalPosTab(row = {}) {
  const next = [
    row,
    ...readPosTabs().filter((entry) => entry.id !== row.id)
  ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  writePosTabs(next);
  return row;
}

/** @param {PosTabExpectedData[]} [rows] @returns {Array<PosTabExpectedData & {_source: string, financial_complete: false, _financial_complete: false}>} */
function markCachedPosTabsUncertified(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    _source: 'local_cache',
    financial_complete: false,
    _financial_complete: false,
    financial_snapshot: row?.financial_snapshot && typeof row.financial_snapshot === 'object'
      ? { ...row.financial_snapshot, financial_complete: false }
      : row?.financial_snapshot || null
  }));
}

/** @param {PosTabExpectedData[]} [rows] @param {PosTabFilters} [filters] */
function applyPosTabFilters(rows = [], filters = {}) {
  const outletId = filters.outletId || filters.outlet_id || null;
  const status = String(filters.status || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (outletId && row?.outlet_id !== outletId) return false;
    if (!status) return true;
    if (status === 'active') return isActivePosTab(row);
    return String(row?.status || '').trim().toLowerCase() === status;
  });
}

/** @param {PosTabFilters} [filters] @returns {Promise<PosTabExpectedData[]|null>} */
async function fetchRemotePosTabs(filters = {}) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return null;
  const status = String(filters.status || '').trim().toLowerCase();
  const outletId = filters.outletId || filters.outlet_id || null;
  const key = `tabs:${state.lodgeId}:${outletId || 'all'}:${status || 'all'}`;
  return readPosRemoteCached(key, async () => {
    const { data: rpcResult, error } = await state.supabase.rpc('get_restaurant_pos_tabs_financial_truth', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId,
      p_status: status || null,
    });
    if (error) throw new Error(error.message);
    if (rpcResult?.success === false) throw new Error(rpcResult.error || 'The server could not read open tabs.');
    const rows = Array.isArray(rpcResult?.data) ? /** @type {PosTabExpectedData[]} */ (rpcResult.data) : Array.isArray(rpcResult) ? /** @type {PosTabExpectedData[]} */ (rpcResult) : [];
    if (rpcResult?.complete !== true) throw new Error('The server returned an incomplete tab snapshot.');
    return rows;
  });
}

/** @param {PosTabFilters} [filters] @returns {Promise<PosTabExpectedData[]>} */
export async function getPosTabs(filters = {}) {
  try {
    const remote = await fetchRemotePosTabs(filters);
    if (remote) {
      if (String(filters.status || '').trim().toLowerCase() === 'active') {
        const pendingLocal = applyPosTabFilters(readPosTabs(), filters).filter((row) => row?._pending_sync === true);
        const remoteIds = new Set(remote.map((row) => row.id));
        const activeRows = [
          ...remote,
          ...markCachedPosTabsUncertified(pendingLocal.filter((row) => !remoteIds.has(row.id)))
        ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        // Self-heal stale cache (2026-09-24): any cached ACTIVE tab (named bar
        // tab or table check) that is neither on the server nor a genuine
        // pending-sync estimate is dropped here, not retained. The old
        // table-only predicate kept active rows without table_name as
        // "history", so offline reads (which use the wider active predicate)
        // resurrected ~10 settled tabs whenever the link flapped.
        const retainedHistory = readPosTabs().filter((row) => !isActivePosTab(row) && !remoteIds.has(row.id));
        writePosTabs([...activeRows, ...retainedHistory], { invalidate: false });
        return activeRows;
      }
      const merged = [
        ...remote,
        ...markCachedPosTabsUncertified(applyPosTabFilters(readPosTabs(), filters).filter((local) => !remote.some((row) => row.id === local.id)))
      ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      writePosTabs(merged, { invalidate: false });
      return merged;
    }
  } catch (error) {
      console.warn('[POS TABS] Remote tab refresh unavailable:', (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || error);
  }
  return markCachedPosTabsUncertified(applyPosTabFilters(readPosTabs(), filters)).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

/** @param {PosTabSaveRequest} [data] */
export async function savePosTab(data = {}) {
  const operatorProof = String(data?._operator_proof || '').trim() || null;
  data = { ...data };
  delete data._operator_proof;
  const hasExistingId = Boolean(data.id);
  const suppliedVersion = data.tab_version ?? data.expected_version;
  const parsedVersion = suppliedVersion == null || suppliedVersion === '' ? null : Number(suppliedVersion);
  // Existing tabs must carry the version read from the server. Without this
  // guard a reopened check could be cached/queued as version 1 and later
  // overwrite a concurrent edit when the server contract is unavailable.
  if (hasExistingId && (!Number.isInteger(parsedVersion) || parsedVersion <= 0)) {
    return { success: false, code: 'tab_version_required', error: 'This open check is missing its version. Refresh it before saving.' };
  }
  const status = normalizeTabStatus(data.status, normalizeTableName(data.table_name) ? 'running' : 'open');
  if (ACTIVE_TABLE_TAB_STATUSES.has(status) && (!data.waiter_id || !normalizeTableName(data.waiter_name) || !data.shift_id)) {
    return { success: false, error: 'Unlock Till with the serving staff PIN and start their shift before holding an open check.' };
  }
  const id = data.id || randomUUID();
  const now = new Date().toISOString();
  const localRowsBeforeSave = readPosTabs();
  const previousLocalTab = hasExistingId
    ? localRowsBeforeSave.find((entry) => entry.id === id) || null
    : null;
  const previousLocalTabIndex = previousLocalTab
    ? localRowsBeforeSave.findIndex((entry) => entry.id === id)
    : -1;
  const tableName = normalizeTableName(data.table_name) || null;
  const outletId = data.outlet_id || null;
  const existingActive = findActiveTableTab(readPosTabs(), tableName, outletId, id);
  if (existingActive) {
    return {
      success: true,
      already_open: true,
      error: `${tableName} is already running. Loaded the existing table tab instead.`,
      tab: existingActive
    };
  }
  const row = {
    id,
    lodge_id: state.lodgeId,
    outlet_id: outletId,
    table_name: tableName,
    tab_name: String(data.tab_name || '').trim() || null,
    customer_name: String(data.customer_name || '').trim() || null,
    waiter_name: String(data.waiter_name || '').trim() || null,
    room_id: data.room_id || null,
    booking_id: data.booking_id || null,
    items: Array.isArray(data.items) ? data.items : [],
    notes: data.notes || null,
    status,
    waiter_id: data.waiter_id || null,
    shift_id: data.shift_id || null,
    opened_by: data.opened_by || state.currentUser?.id || null,
    opened_by_name: data.opened_by_name || state.currentUser?.name || state.currentUser?.email || null,
    created_at: data.created_at || now,
    updated_at: now,
    expected_version: hasExistingId ? parsedVersion : null,
    tab_version: hasExistingId ? parsedVersion : 1
  };
  try {
    assertSaleModifierRequirements(row.items);
  } catch (error) {
    return { success: false, error: (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || 'Complete the required choices before holding this check.' };
  }
  upsertLocalPosTab(row);
  const restoreLocalTabAfterRejectedSave = () => {
    const currentRows = readPosTabs().filter((entry) => entry.id !== id);
    if (previousLocalTab) {
      const insertAt = previousLocalTabIndex < 0
        ? currentRows.length
        : Math.min(previousLocalTabIndex, currentRows.length);
      currentRows.splice(insertAt, 0, previousLocalTab);
    }
    writePosTabs(currentRows);
  };

  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('upsert_pos_tab', { payload: operatorProof ? { ...row, _operator_proof: operatorProof } : row });
      if (error) throw new Error(error.message);
      if (!rpcData?.success) {
        restoreLocalTabAfterRejectedSave();
        return { success: false, error: rpcData?.error || 'Could not hold this open check.' };
      }
      const remoteRow = rpcData?.tab || rpcData?.row || null;
      if (remoteRow?.id) upsertLocalPosTab(remoteRow);
      if (rpcData?.already_open) {
        writePosTabs(readPosTabs().filter((entry) => entry.id !== row.id || entry.id === remoteRow?.id));
        return {
          success: true,
          already_open: true,
          error: `${remoteRow?.table_name || tableName} is already running. Loaded the existing table tab instead.`,
          tab: remoteRow || existingActive || row
        };
      }
      return { success: true, tab: remoteRow || row };
    } catch (error) {
      // While the terminal reports online, never present an unconfirmed tab as
      // valid. The server owns staff/shift attribution and has the audit trail.
      restoreLocalTabAfterRejectedSave();
      return { success: false, error: (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || 'Could not confirm the open check. Check the Till unlock and shift, then try again.' };
    }
  } else {
    // Offline tabs for Bar: the unlocked Till (PIN-verified session) is the
    // trust root, same as offline counter sales. The row is stored locally
    // (never inventing a version) and the identical RPC replays later;
    // version conflicts dead-letter visibly instead of overwriting.
    const pending = { ...row, _pending_sync: true, _sync_state: 'pending' };
    // Last-writer-wins per tab: same-queue-id pushes are skipped by the
    // queue, so refresh the queued payload in place when this tab already
    // has a save queued. Otherwise later holds would replay stale lines.
    const tabQueueId = `pos-tab-${id}`;
    const queuedTabs = readSyncQueue();
    const queuedTabIndex = queuedTabs.findIndex((entry) => entry?._queue_id === tabQueueId);
    if (queuedTabIndex >= 0) {
      queuedTabs[queuedTabIndex] = { ...queuedTabs[queuedTabIndex], data: { payload: row }, timestamp: new Date().toISOString() };
      writeSyncQueue(queuedTabs);
    } else {
      queueOperation('rpc', 'upsert_pos_tab', { payload: row }, null, {
        _queue_id: tabQueueId
      });
    }
    upsertLocalPosTab(pending);
    appendPosAudit('tab_saved', { entity_type: 'pos_tab', entity_id: row.id, details: { table_name: row.table_name, status: row.status, waiter_name: row.waiter_name, source: 'offline_queue' } });
    return { success: true, tab: pending, offline: true, queued: true };
  }

  appendPosAudit('tab_saved', { entity_type: 'pos_tab', entity_id: row.id, details: { table_name: row.table_name, status: row.status, waiter_name: row.waiter_name } });
  return { success: true, tab: row, offline: true };
}

/** @param {string} id @param {string} [status] @param {PosTabStatusExtras} [extra] */
export async function updatePosTabStatus(id, status = 'closed', extra = {}) {
  const nextStatus = normalizeTabStatus(status, 'closed');
  const now = new Date().toISOString();
  const current = readPosTabs().find((row) => row.id === id) || null;
  if (!current) return { success: false, error: 'Open table tab not found.' };
  const updated = { ...current, ...extra, status: nextStatus, updated_at: now };
  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('update_pos_tab_status', {
        p_tab_id: id,
        p_status: nextStatus,
        p_notes: extra.notes || null,
        p_operator_proof: extra._operator_proof || null
      });
      if (error) throw new Error(error.message);
      if (rpcData?.success === false) throw new Error(rpcData.error || 'The server rejected this tab status change.');
      const remoteRow = rpcData?.tab || rpcData?.row || null;
      upsertLocalPosTab(remoteRow?.id ? { ...updated, ...remoteRow, _pending_sync: false } : { ...updated, _pending_sync: false });
      appendPosAudit('tab_status_updated', { entity_type: 'pos_tab', entity_id: id, details: { status: nextStatus, table_name: updated.table_name || null, source: 'server' } });
      return { success: true, tab: remoteRow?.id ? { ...updated, ...remoteRow } : updated };
    } catch (error) {
      // An online failure is not a local success. Do not close or otherwise
      // mutate the cached tab because doing so could make an unposted state
      // look server-confirmed. The operator can retry the same action.
      return { success: false, error: (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || 'Could not confirm the tab status change with the server.' };
    }
  } else {
    // Offline status changes queue behind the tab create so the replay order
    // stays create-then-status. Same trust root as offline counter sales.
    const pending = { ...updated, _pending_sync: true, financial_complete: false, _financial_complete: false };
    queueOperation('rpc', 'update_pos_tab_status', {
      p_tab_id: id,
      p_status: nextStatus,
      p_notes: extra.notes || null
    }, null, {
      _queue_id: `pos-tab-status-${id}-${nextStatus}`,
      ...(current?._pending_sync ? { _depends_on: `pos-tab-${id}` } : {})
    });
    upsertLocalPosTab(pending);
    appendPosAudit('tab_status_updated', { entity_type: 'pos_tab', entity_id: id, details: { status: nextStatus, table_name: updated.table_name || null, source: 'offline_queue' } });
    return { success: true, tab: pending, offline: true, pending: true };
  }
}

/** @param {PosTabWaiterTransferRequest} [data] */
export async function transferPosTabWaiter(data = {}) {
  const tabId = String(data.tab_id || data.id || '').trim();
  const targetWaiterId = String(data.target_waiter_id || '').trim();
  const targetShiftId = String(data.target_shift_id || '').trim();
  const operationId = String(data.operation_id || randomUUID()).trim();
  // Replays resubmit the immutable saved request verbatim. Local pre-checks
  // that compare against the (possibly refreshed) cache must not block them:
  // the server authoritatively replays the stored result or rejects with its
  // own current-state code. Fresh attempts keep every local guard.
  const isReplay = data.is_replay === true;
  const current = readPosTabs().find((row) => row.id === tabId) || null;
  // A missing local cache row must not block recovery of an already-sent
  // operation: the server remains authoritative and replays the stored result
  // for the original key. Only brand-new attempts without a resolvable tab
  // fail closed locally.
  const isReplayWithoutCache = !current && Boolean(data.operation_id);
  if (!current && !isReplayWithoutCache) return { success: false, code: 'tab_not_found', provenance: 'local-validation', error: 'Open table tab not found. Refresh open tabs and try again.' };
  if (!isReplay && current && !current.waiter_id) {
    return { success: false, code: 'invalid_transfer', provenance: 'local-validation', error: 'This tab has no assigned waiter. Refresh open tabs and assign a serving waiter first.' };
  }
  if (!isReplay && current && (!targetWaiterId || !targetShiftId || targetWaiterId === current.waiter_id)) {
    return { success: false, code: 'invalid_transfer', provenance: 'local-validation', error: 'Choose another active waiter and their current Till shift.' };
  }
  if (!isReplayWithoutCache && (!targetWaiterId || !targetShiftId)) {
    return { success: false, code: 'invalid_transfer', provenance: 'local-validation', error: 'Choose another active waiter and their current Till shift.' };
  }
  const expectedVersion = Number(data.expected_tab_version ?? data.tab_version ?? current?.tab_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { success: false, code: 'tab_version_required', provenance: 'local-validation', error: 'Refresh this tab before transferring it so its current version can be confirmed.' };
  }
  const rpcArgs = {
    p_tab_id: tabId,
    p_target_waiter_id: targetWaiterId,
    p_target_shift_id: targetShiftId,
    p_operation_id: operationId,
    p_expected_tab_version: expectedVersion,
    p_notes: data.notes ? String(data.notes).trim() : null,
    p_operator_proof: data._operator_proof || null
  };
  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('transfer_pos_tab_waiter', rpcArgs);
      if (error) {
        const sqlState = (/** @type {PosTabRpcErrorExpectedData} */ (error)).code || (/** @type {PosTabRpcErrorExpectedData} */ (error)).sqlState || null;
        const conflict = /already used for different|different payload/i.test((/** @type {PosTabRpcErrorExpectedData} */ (error)).message || '');
        return {
          success: false,
          code: conflict ? 'idempotency_conflict' : (sqlState || 'unknown_transfer_error'),
          sqlState,
          provenance: 'transport-error',
          error: (/** @type {PosTabRpcErrorExpectedData} */ (error)).message || 'Could not confirm the waiter transfer with the server. Retry with the same transfer key.',
          operation_id: operationId,
          outcome: 'unknown'
        };
      }
      if (rpcData?.success === false) return { ...rpcData, provenance: 'server-rpc-response', operation_id: operationId, outcome: rpcData.code === 'idempotency_conflict' ? 'needs_review' : 'rejected' };
      const remoteRow = rpcData?.tab || null;
      // Post-commit cache reconciliation must never convert a commit into a
      // failure: the server already wrote. A sync warning is recorded instead.
      let cacheSyncWarning = null;
      if (remoteRow?.id) {
        try {
          upsertLocalPosTab({ ...remoteRow, _pending_sync: false, _sync_state: 'synced' });
        } catch (cacheError) {
          cacheSyncWarning = (/** @type {PosTabErrorMessageView|null|undefined} */ (cacheError))?.message || 'Local tab cache could not be refreshed after a committed transfer.';
        }
      }
      return { ...(rpcData || {}), success: true, tab: remoteRow || current, operation_id: operationId, outcome: 'committed', provenance: 'server-rpc-response', ...(cacheSyncWarning ? { cacheSyncWarning } : {}) };
    } catch (error) {
      return { success: false, code: 'unknown_transfer_error', provenance: 'transport-error', error: (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || 'Could not confirm the waiter transfer with the server. Retry with the same transfer key.', operation_id: operationId, outcome: 'unknown' };
    }
  }

  return { success: false, code: 'offline_transfer_blocked', provenance: 'local-validation', error: 'Bar waiter transfers require a live connection so ownership, target attendance, and the active Till shift can be confirmed.' };
}

/** @param {string} id @param {string} [status] @param {PosTabStatusExtras} [extra] */
export async function closePosTab(id, status = 'closed', extra = {}) {
  return updatePosTabStatus(id, status, extra);
}

/** @param {PosTabOverrideRequest} [data] */
export async function overridePosTableTab(data = {}) {
  const action = String(data.action || '').trim().toLowerCase();
  const sourceId = data.source_tab_id || data.id || null;
  const targetTableName = normalizeTableName(data.target_table_name);
  const now = new Date().toISOString();
  const rows = readPosTabs();
  const source = rows.find((row) => row.id === sourceId);
  if (!source) return { success: false, error: 'Open table tab not found.' };

  if ((isBarTabScopeCached() || isTabScopeUnknown()) && (action === 'transfer' || action === 'merge')) {
    return { success: false, error: 'Client-side table transfer/merge is disabled until the package scope is confirmed. Use the server-authoritative waiter transfer action.' };
  }

  if (action === 'close') {
    return updatePosTabStatus(sourceId, 'closed', {
      notes: [source.notes, data.reason || 'Assigned waiter closed table'].filter(Boolean).join('\n'),
      _operator_proof: data._operator_proof || null
    });
  }

  if (action === 'deliver') {
    return updatePosTabStatus(sourceId, 'delivered', { _operator_proof: data._operator_proof || null });
  }

  if (action === 'transfer') {
    if (!targetTableName) return { success: false, error: 'Target table is required.' };
    const existingTarget = findActiveTableTab(rows, targetTableName, source.outlet_id || null, sourceId);
    if (existingTarget) return { success: false, error: `${targetTableName} is already running. Use Merge instead.` };
    const updated = {
      ...source,
      table_name: targetTableName,
      tab_name: targetTableName,
      waiter_name: normalizeTableName(data.waiter_name) || source.waiter_name || null,
      status: 'running',
      updated_at: now
    };
    upsertLocalPosTab(updated);
    if (state.isOnline && state.supabase) {
      try { await state.supabase.rpc('upsert_pos_tab', { payload: updated }); } catch (error) { console.warn('[POS TABS] Transfer sync unavailable:', (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || error); }
    }
    return { success: true, tab: updated };
  }

  if (action === 'merge') {
    if (!targetTableName) return { success: false, error: 'Target table is required.' };
    const target = findActiveTableTab(rows, targetTableName, source.outlet_id || null, sourceId);
    if (!target) return { success: false, error: `${targetTableName} is not running. Use Transfer instead.` };
    const merged = {
      ...target,
      items: [...(Array.isArray(target.items) ? target.items : []), ...(Array.isArray(source.items) ? source.items : [])],
      notes: [target.notes, source.notes, `Merged from ${source.table_name || source.tab_name || 'another tab'}`].filter(Boolean).join('\n'),
      waiter_name: target.waiter_name || source.waiter_name || null,
      status: normalizeTabStatus(target.status, 'running'),
      updated_at: now
    };
    const closedSource = {
      ...source,
      status: 'closed',
      notes: [source.notes, `Merged into ${target.table_name || target.tab_name || targetTableName}`].filter(Boolean).join('\n'),
      updated_at: now
    };
    writePosTabs([merged, closedSource, ...rows.filter((row) => row.id !== merged.id && row.id !== closedSource.id)]);
    if (state.isOnline && state.supabase) {
      try {
        await state.supabase.rpc('upsert_pos_tab', { payload: merged });
        await state.supabase.rpc('update_pos_tab_status', { p_tab_id: closedSource.id, p_status: 'closed', p_notes: closedSource.notes || null });
      } catch (error) {
        console.warn('[POS TABS] Merge sync unavailable:', (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || error);
      }
    }
    return { success: true, tab: merged, closed_tab: closedSource };
  }

  return { success: false, error: 'Choose a valid manager override action.' };
}

/** @param {PosTabItemSplitRequest} [data] */
export async function splitBillByItems(data = {}) {
  if (isBarTabScopeCached() || isTabScopeUnknown()) return { success: false, error: 'Item splits require the server-authoritative split contract; client-side tab composition is disabled until package scope is confirmed.' };
  const { source_tab_id, item_indices, target_table_name } = data || {};
  if (!source_tab_id) return { success: false, error: 'Source tab is required.' };
  if (!Array.isArray(item_indices) || item_indices.length === 0) return { success: false, error: 'Select at least one item to split.' };

  const rows = readPosTabs();
  const source = rows.find((row) => row.id === source_tab_id);
  if (!source) return { success: false, error: 'Source tab not found.' };

  const sourceItems = Array.isArray(source.items) ? source.items : [];
  if (item_indices.some((idx) => idx < 0 || idx >= sourceItems.length)) {
    return { success: false, error: 'One or more item indices are out of range.' };
  }

  const now = new Date().toISOString();
  const splitItems = item_indices.sort((a, b) => b - a);
  const itemsToSplit = [];
  const remainingItems = [...sourceItems];

  for (const idx of splitItems) {
    itemsToSplit.unshift(remainingItems.splice(idx, 1)[0]);
  }

  const targetName = normalizeTableName(target_table_name);
  const existingTarget = targetName
    ? findActiveTableTab(rows, targetName, source.outlet_id || null, source.id)
    : null;
  const targetTabName = targetName || `${source.table_name || source.tab_name || 'Tab'} (split)`;

  const targetTab = existingTarget ? {
    ...existingTarget,
    items: [...(Array.isArray(existingTarget.items) ? existingTarget.items : []), ...itemsToSplit],
    notes: [existingTarget.notes, `Split ${itemsToSplit.length} item(s) from ${source.table_name || source.tab_name || 'original tab'}`].filter(Boolean).join('\n'),
    waiter_name: existingTarget.waiter_name || source.waiter_name || null,
    status: normalizeTabStatus(existingTarget.status, 'running'),
    updated_at: now
  } : {
    id: randomUUID(),
    lodge_id: source.lodge_id,
    outlet_id: source.outlet_id || null,
    table_name: targetName || null,
    tab_name: targetTabName,
    customer_name: source.customer_name || null,
    waiter_name: source.waiter_name || null,
    items: itemsToSplit,
    notes: `Split from ${source.table_name || source.tab_name || 'original tab'}`,
    status: 'running',
    opened_by: source.opened_by || null,
    opened_by_name: source.opened_by_name || null,
    created_at: now,
    updated_at: now
  };

  const updatedSource = {
    ...source,
    items: remainingItems,
    notes: [source.notes, `Split ${itemsToSplit.length} item(s) to ${targetTabName}`].filter(Boolean).join('\n'),
    status: remainingItems.length === 0 ? 'closed' : normalizeTabStatus(source.status, 'running'),
    updated_at: now,
    closed_at: remainingItems.length === 0 ? now : undefined
  };

  writePosTabs([targetTab, updatedSource, ...rows.filter((row) => row.id !== targetTab.id && row.id !== updatedSource.id)]);

  if (state.isOnline && state.supabase) {
    try {
      await state.supabase.rpc('upsert_pos_tab', { payload: targetTab });
      await state.supabase.rpc('upsert_pos_tab', { payload: updatedSource });
    } catch (error) {
      console.warn('[POS TABS] Split bill sync unavailable:', (/** @type {PosTabErrorMessageView|null|undefined} */ (error))?.message || error);
    }
  }

  appendPosAudit('pos:bill_split', {
    source_tab_id,
    target_tab_id: targetTab.id,
    new_tab_id: existingTarget ? null : targetTab.id,
    used_existing_target: !!existingTarget,
    items_split: itemsToSplit.length,
    items_remaining: remainingItems.length,
    target_table_name: targetName || null
  });

  return {
    success: true,
    source_tab: updatedSource,
    target_tab: targetTab,
    new_tab: existingTarget ? null : targetTab
  };
}

/** @param {PosTabEvenSplitRequest} [data] */
export async function splitBillEvenly(data = {}) {
  const { source_tab_id, split_count, target_table_names, source_tab_version } = data || {};
  if (!source_tab_id) return { success: false, code: 'invalid_split', provenance: 'local-validation', error: 'Source tab is required.' };
  const numSplits = Number(split_count);
  if (!Number.isInteger(numSplits) || numSplits < 2 || numSplits > 10) {
    return { success: false, code: 'invalid_split', provenance: 'local-validation', error: 'Split count must be between 2 and 10.' };
  }
  const idempotencyKey = data.idempotency_key || randomUUID();
  // A split closes one tab and opens/updates several others. Never emulate that
  // financial/operational transition offline or with client-side upsert loops.
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, code: 'offline_split_blocked', provenance: 'local-validation', error: 'Bill splits require a live connection so every tab is updated together.', idempotency_key: idempotencyKey, outcome: 'rejected' };
  }
  // Expected SQL JSONB response shape; this does not validate the RPC response at runtime.
  /** @type {PosTabSplitRpcExpectedData|null} */
  let rpcData = null;
  let rpcError = null;
  try {
    ({ data: rpcData, error: rpcError } = await state.supabase.rpc('split_pos_tab_evenly', {
      payload: {
        lodge_id: state.lodgeId,
        source_tab_id,
        split_count: numSplits,
        target_table_names: Array.isArray(target_table_names) ? target_table_names : [],
        source_tab_version: source_tab_version == null ? null : Number(source_tab_version),
        idempotency_key: idempotencyKey,
        _operator_proof: data._operator_proof || null
      }
    }));
  } catch (thrown) {
    // A thrown transport error carries no server response at all: it can
    // never prove a terminal rejection. Report unknown with the key so the
    // original operation can be replayed.
    return {
      success: false,
      code: 'unknown_split_error',
      provenance: 'transport-error',
      error: thrown?.message || 'Could not split the bill.',
      idempotency_key: idempotencyKey,
      outcome: 'unknown'
    };
  }
  if (rpcError) {
    const sqlState = (/** @type {PosTabRpcErrorExpectedData} */ (rpcError)).code || (/** @type {PosTabRpcErrorExpectedData} */ (rpcError)).sqlState || null;
    // Only explicit conflict evidence counts: SQLSTATE 22000 is the broad
    // data_exception class, so it decides nothing without the conflict text
    // from the split key-mismatch raise.
    const conflict = /different payload|already used/i.test((/** @type {PosTabRpcErrorExpectedData} */ (rpcError)).message || '');
    return {
      success: false,
      code: conflict ? 'idempotency_conflict' : (sqlState || 'unknown_split_error'),
      sqlState,
      provenance: 'transport-error',
      error: (/** @type {PosTabRpcErrorExpectedData} */ (rpcError)).message || 'Could not split the bill.',
      idempotency_key: idempotencyKey,
      outcome: conflict ? 'needs_review' : 'unknown'
    };
  }
  // Expected JSONB response follows split_pos_tab_evenly; this assertion does not validate the RPC payload.
  if (rpcData?.success === false) return { ...rpcData, provenance: 'server-rpc-response', idempotency_key: idempotencyKey, outcome: rpcData.code === 'idempotency_conflict' ? 'needs_review' : 'rejected' };
  if (rpcData?.success) {
    // Post-commit cache reconciliation must never convert a commit into a
    // failure: the server already wrote. A sync warning is recorded instead.
    let cacheSyncWarning = null;
    try {
      const updated = [
        ...(Array.isArray(rpcData.new_tabs) ? rpcData.new_tabs : []),
        ...(rpcData.source_tab ? [rpcData.source_tab] : []),
        ...readPosTabs().filter((row) => row.id !== rpcData.source_tab?.id && !(rpcData.new_tabs || []).some((tab) => tab.id === row.id))
      ];
      writePosTabs(updated);
    } catch (cacheError) {
      cacheSyncWarning = (/** @type {PosTabErrorMessageView|null|undefined} */ (cacheError))?.message || 'Local tab cache could not be refreshed after a committed split.';
    }
    return { ...rpcData, provenance: 'server-rpc-response', idempotency_key: idempotencyKey, outcome: 'committed', ...(cacheSyncWarning ? { cacheSyncWarning } : {}) };
  }
  return { success: false, code: 'unknown_split_error', provenance: 'transport-error', error: 'Could not split the bill.', idempotency_key: idempotencyKey, outcome: 'unknown' };
}

function getPosCashupQueueDependencies(shift) {
  const dependencies = new Set();
  if (shift._pending_sync) dependencies.add(shift._queue_id || `pos-shift-${shift.id}`);
  const orders = new Map(readCache('pos-orders').map((row) => [row.id, row]));
  for (const item of [...readSyncQueue(), ...readFailedSyncQueue()]) {
    if (item?.type !== 'rpc') continue;
    const payload = item.data?.payload || {};
    if (payload.lodge_id && payload.lodge_id !== state.lodgeId) continue;
    let affectsShift = false;
    if (['create_pos_order_v3', 'create_pos_return_v3'].includes(item.table)) {
      affectsShift = payload.shift_id === shift.id;
    } else if (item.table === 'approve_pos_void_with_pin') {
      const order = orders.get(payload.order_id);
      if (order?.lodge_id && order.lodge_id !== state.lodgeId) continue;
      affectsShift = order?.shift_id
        ? order.shift_id === shift.id
        : !payload.outlet_id || payload.outlet_id === shift.outlet_id;
    }
    if (!affectsShift) continue;
    if (!item._queue_id) throw new Error('A pending cash transaction has no retry reference. Ask a manager to resolve it in System Health before submitting cash-up.');
    dependencies.add(item._queue_id);
  }
  return [...dependencies];
}

export async function submitPosCashup(payload = {}) {
  if (!state.isOnline || !state.supabase) {
    const shift = readPosShifts().find((row) => row.id === payload.shift_id);
    if (!shift || shift.status !== 'open') return { success: false, error: 'An open Till shift is required before cash-up can be submitted.' };
    const key = payload.idempotency_key || `pos-cashup-submit:${randomUUID()}`;
    const existing = readPosCashupSubmissions().find((row) => row.idempotency_key === key);
    if (existing) return { success: true, submission_id: existing.id, status: existing.status, replayed: true, offline: true };
    const submission = upsertPosCashupSubmission({
      id: randomUUID(), lodge_id: state.lodgeId, shift_id: shift.id, outlet_id: shift.outlet_id || null,
      cashier_id: shift.cashier_id || state.currentUser?.id || null,
      cashier_name: shift.cashier_name || state.currentUser?.name || state.currentUser?.email || null,
      counted_by_method: { cash: normalizeMoney(payload.counted_by_method?.cash || 0) },
      expected_cash_drawer: null, expected_by_method: null, notes: payload.notes || null,
      submitted_by: state.currentUser?.id || null, idempotency_key: key, status: 'submitted',
      submitted_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending',
      _queue_id: `pos-cashup-submission-${key}`
    });
    const dependencies = getPosCashupQueueDependencies(shift);
    queueOperation('rpc', 'submit_pos_shift_cashup', { payload: { ...payload, lodge_id: state.lodgeId, idempotency_key: key } }, null, {
      _queue_id: submission._queue_id,
      ...(dependencies[0] ? { _depends_on: dependencies[0], _depends_on_all: dependencies } : {})
    });
    return { success: true, submission_id: submission.id, status: 'submitted', submission, offline: true, queued: true, provisional: true };
  }
  const { data, error } = await state.supabase.rpc('submit_pos_shift_cashup', {
    payload: { ...payload, lodge_id: state.lodgeId }
  });
  if (error) throw new Error(error.message);
  return data || { success: false, error: 'Could not submit cash-up.' };
}

export async function submitPosCashupWithAttendancePin(payload = {}) {
  if (!state.isOnline || !state.supabase) {
    const shift = readPosShifts().find((row) => row.id === payload.shift_id);
    if (!shift || shift.status !== 'open') return { success: false, error: 'This staff member has no open Till shift.' };
    const verified = validateCachedPosPin(shift.cashier_id, payload.pin);
    if (!verified.success) return verified;
    const key = payload.idempotency_key || `pos-shared-cashup:${randomUUID()}`;
    const existing = readPosCashupSubmissions().find((row) => row.idempotency_key === key);
    if (existing) return { success: true, submission_id: existing.id, status: existing.status, replayed: true, offline: true };
    const submission = upsertPosCashupSubmission({
      id: randomUUID(), lodge_id: state.lodgeId, shift_id: shift.id, outlet_id: shift.outlet_id || null,
      cashier_id: shift.cashier_id, cashier_name: shift.cashier_name || verified.staff.name,
      counted_by_method: { cash: normalizeMoney(payload.counted_by_method?.cash || 0) },
      expected_cash_drawer: null, expected_by_method: null, notes: payload.notes || null,
      submitted_by: shift.cashier_id, idempotency_key: key, status: 'submitted',
      submitted_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending',
      _queue_id: `pos-cashup-submission-${key}`
    });
    const dependencies = getPosCashupQueueDependencies(shift);
    queueOperation('rpc', 'submit_pos_shift_cashup_with_attendance_pin', { payload: {
      ...payload, lodge_id: state.lodgeId, idempotency_key: key, device_id: getDesktopPosDeviceId()
    } }, null, {
      _queue_id: submission._queue_id,
      ...(dependencies[0] ? { _depends_on: dependencies[0], _depends_on_all: dependencies } : {})
    });
    return { success: true, submission_id: submission.id, status: 'submitted', submission, offline: true, queued: true, provisional: true };
  }
  const { data, error } = await state.supabase.rpc('submit_pos_shift_cashup_with_attendance_pin', { payload: { ...payload, lodge_id: state.lodgeId, device_id: getDesktopPosDeviceId() } });
  if (error) throw new Error(error.message);
  if (data && data.success === false) return withOperatorPinResult(data);
  return data || { success: false, error: 'Could not submit the shared-terminal cash-up.' };
}

export async function getMyPosCashupSubmission(shiftId) {
  if (!shiftId) return { success: true, submission: null };
  if (!state.isOnline || !state.supabase) {
    return { success: true, submission: readPosCashupSubmissions().find((row) => row.shift_id === shiftId) || null, offline: true };
  }
  let data = null;
  try {
    const response = await withNetworkTimeout(
      state.supabase.rpc('get_my_pos_cashup_submission', {
        p_lodge_id: state.lodgeId, p_shift_id: shiftId
      }),
      5000,
      'My cash-up'
    );
    data = response?.data ?? null;
    const error = response?.error ?? null;
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn('[POS CASHUP] My submission lookup failed; using local cache:', error?.message || error);
    return { success: true, submission: readPosCashupSubmissions().find((row) => row.shift_id === shiftId) || null, offline: true };
  }
  // Keep the renderer blind even when it is connected to an older linked
  // database that still returns legacy expected/variance fields. Manager
  // review uses the separate pending-submissions contract.
  if (data?.submission) {
    return {
      ...data,
      submission: {
        id: data.submission.id,
        status: data.submission.status,
        counted_by_method: { cash: data.submission.counted_by_method?.cash },
        submitted_at: data.submission.submitted_at,
        notes: data.submission.notes,
        review_notes: data.submission.review_notes,
        idempotency_key: data.submission.idempotency_key,
      },
    };
  }
  return data || { success: true, submission: null };
}

export async function getPendingPosCashupSubmissions() {
  if (!state.isOnline || !state.supabase) {
    return { success: true, submissions: readPosCashupSubmissions().filter((row) => row.status === 'submitted'), offline: true, complete: false };
  }
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_pending_pos_cashup_submissions', { p_lodge_id: state.lodgeId }),
      5000,
      'Cash-up review'
    );
    if (error) throw new Error(error.message);
    const result = data || { success: true, submissions: [] };
    if (Array.isArray(result.submissions)) writePosCashupSubmissions(result.submissions);
    return result;
  } catch (error) {
    // A stalled network must not block manager review: fall back to this
    // device's submitted cash-ups as provisional review, same as offline.
    console.warn('[POS CASHUP] Pending review lookup failed; using local cache:', error?.message || error);
    return { success: true, submissions: readPosCashupSubmissions().filter((row) => row.status === 'submitted'), offline: true, complete: false };
  }
}

// ---- Village drawer periods (shared-drawer cash model) ----
// One shared drawer gets one reconciliation. Movements change balances;
// handover/closing counts are observations only. Local provisional rows live
// in pos-drawer-periods / pos-cash-movements / pos-cash-counts caches and
// replay through the same RPC names. Expected cash is never computed here.

/** @typedef {Record<string, undefined>} DrawerEmptyRequest */
/** @typedef {Record<string, unknown> & {id: string, lodge_id?: string | null, outlet_id?: string | null, status?: string, _pending_sync?: boolean, _queue_id?: string | null}} DrawerPeriodExpectedData */
/** @typedef {Record<string, unknown> & {id: string, lodge_id?: string | null, outlet_id?: string | null, period_id?: string | null, _pending_sync?: boolean, _queue_id?: string}} DrawerMovementExpectedData */
/** @typedef {Record<string, unknown> & {id: string, lodge_id?: string | null, period_id?: string | null, _pending_sync?: boolean, _queue_id?: string}} DrawerCountExpectedData */
/** @typedef {'drop_to_safe' | 'paid_out' | 'float_topup' | 'pouch_to_drawer' | 'drawer_to_pouch'} DrawerMovementType */
/** Expected request shapes for current renderer callers plus accepted camel-case aliases; not IPC validation. */
/** @typedef {({outlet_id?: string | null, outletId?: string | null, opening_float?: number | string | null, openingFloat?: number | string | null, notes?: string | null, idempotency_key?: string, idempotencyKey?: string, device_id?: string} & ({outlet_id: string, opening_float: number | string} | {outletId: string, openingFloat: number | string})) | DrawerEmptyRequest} OpenDrawerPeriodRequest */
/** @typedef {({outlet_id?: string | null, outletId?: string | null, movement_type?: DrawerMovementType, movementType?: DrawerMovementType, amount?: number | string, operator_id?: string | null, operatorId?: string | null, notes?: string | null, pin?: string | null, idempotency_key?: string, idempotencyKey?: string, device_id?: string} & ({outlet_id: string, movement_type: DrawerMovementType, amount: number | string} | {outletId: string, movementType: DrawerMovementType, amount: number | string})) | DrawerEmptyRequest} RecordCashMovementRequest */
/** @typedef {({period_id?: string, periodId?: string, count_type?: 'handover', countType?: 'handover', counted_cash?: number | string | null, countedCash?: number | string | null, operator_id?: string | null, operatorId?: string | null, notes?: string | null, pin?: string | null, idempotency_key?: string, idempotencyKey?: string, device_id?: string} & ({period_id: string, count_type: 'handover', counted_cash: number | string} | {periodId: string, countType: 'handover', countedCash: number | string})) | DrawerEmptyRequest} RecordCashCountRequest */
/** @typedef {({period_id?: string, periodId?: string, counted_cash?: number | string | null, countedCash?: number | string | null, actor_id?: string | null, operator_id?: string | null, operatorId?: string | null, notes?: string | null, pin?: string | null, idempotency_key?: string, idempotencyKey?: string, device_id?: string} & ({period_id: string, counted_cash: number | string} | {periodId: string, countedCash: number | string})) | DrawerEmptyRequest} SubmitDrawerPeriodCashupRequest */
/** Expected JSON results from the four drawer RPC definitions in village_cash_containers.sql; assertions at these calls do not validate server data. */
/** @typedef {{success: true, error?: string, period_id?: string, movement_id?: string, count_id?: string, business_date?: string | null, opening_float?: number | null} | {success: false, error: string, period_id?: string, movement_id?: string, count_id?: string, business_date?: string | null, opening_float?: number | null}} DrawerRpcExpectedResult */
/** @typedef {{data: DrawerRpcExpectedResult | null, error: {message: string} | null}} DrawerRpcExpectedResponse */

/** @returns {DrawerPeriodExpectedData[]} */
function readDrawerPeriods() {
  return /** @type {DrawerPeriodExpectedData[]} */ (readCache('pos-drawer-periods') || []);
}

/** @param {DrawerPeriodExpectedData[]} rows */
function writeDrawerPeriods(rows) {
  writeCache('pos-drawer-periods', Array.isArray(rows) ? rows : []);
}

/** @param {DrawerPeriodExpectedData} row @returns {DrawerPeriodExpectedData} */
function upsertDrawerPeriod(row) {
  const rows = readDrawerPeriods();
  const next = { ...row, lodge_id: row.lodge_id || state.lodgeId };
  const index = rows.findIndex((item) => String(item?.id || '') === String(next.id || ''));
  if (index >= 0) rows[index] = { ...rows[index], ...next };
  else rows.unshift(next);
  writeDrawerPeriods(rows);
  return rows[index >= 0 ? index : 0];
}

/** @returns {DrawerMovementExpectedData[]} */
function readCashMovements() {
  return /** @type {DrawerMovementExpectedData[]} */ (readCache('pos-cash-movements') || []);
}

/** @param {DrawerMovementExpectedData[]} rows */
function writeCashMovements(rows) {
  writeCache('pos-cash-movements', Array.isArray(rows) ? rows : []);
}

/** @param {DrawerMovementExpectedData} row @returns {DrawerMovementExpectedData} */
function upsertCashMovement(row) {
  const rows = readCashMovements();
  const next = { ...row, lodge_id: row.lodge_id || state.lodgeId };
  const index = rows.findIndex((item) => String(item?.id || '') === String(next.id || ''));
  if (index >= 0) rows[index] = { ...rows[index], ...next };
  else rows.unshift(next);
  writeCashMovements(rows);
  return rows[index >= 0 ? index : 0];
}

/** @returns {DrawerCountExpectedData[]} */
function readCashCounts() {
  return /** @type {DrawerCountExpectedData[]} */ (readCache('pos-cash-counts') || []);
}

/** @param {DrawerCountExpectedData[]} rows */
function writeCashCounts(rows) {
  writeCache('pos-cash-counts', Array.isArray(rows) ? rows : []);
}

/** @param {DrawerCountExpectedData} row @returns {DrawerCountExpectedData} */
function upsertCashCount(row) {
  const rows = readCashCounts();
  const next = { ...row, lodge_id: row.lodge_id || state.lodgeId };
  const index = rows.findIndex((item) => String(item?.id || '') === String(next.id || ''));
  if (index >= 0) rows[index] = { ...rows[index], ...next };
  else rows.unshift(next);
  writeCashCounts(rows);
  return rows[index >= 0 ? index : 0];
}

// Unknown or missing model fails closed to the long-standing personal rules.
/** @param {string | null | undefined} outletId */
function getOutletCashModel(outletId) {
  // Expected outlet cache projection only; readCache JSON remains unvalidated.
  const outlets = /** @type {Array<Record<string, unknown> & {id: string, cash_model?: string | null}>} */ (readCache('outlets') || []);
  const row = outlets.find((item) => String(item?.id || '') === String(outletId || ''));
  return row?.cash_model === 'shared_drawer' ? 'shared_drawer' : 'personal_bank';
}

/** @param {string | null | undefined} outletId @returns {DrawerPeriodExpectedData | null} */
function findLocalOpenDrawerPeriod(outletId) {
  return readDrawerPeriods().find((row) =>
    String(row?.outlet_id || '') === String(outletId || '') &&
    ['open', 'submitted', 'rejected'].includes(String(row?.status || ''))) || null;
}

// Drawer writes must never hang the terminal on "Recording…": a stalled
// connection rejects after the standard read timeout with an explicitly
// ambiguous message. Retrying is safe — every drawer write carries a stable
// per-attempt key, so a retry replays instead of recording twice.
/** @param {string} label @returns {(timeoutError: {code?: unknown} | null | undefined) => never} */
function drawerWriteTimeout(label) {
  return (timeoutError) => {
    if (timeoutError?.code === 'network_read_timeout') {
      throw new Error(`${label} timed out — it may already be recorded. Refresh the drawer list; if it is missing, retry and the same retry key replays instead of recording twice.`);
    }
    throw timeoutError;
  };
}

/** @param {OpenDrawerPeriodRequest} [request] */
export async function openDrawerPeriod({ outlet_id, outletId, opening_float, openingFloat, notes, idempotency_key, idempotencyKey, device_id } = {}) {
  const resolvedOutlet = outlet_id || outletId || null;
  const key = idempotency_key || idempotencyKey || `pos-drawer-open:${resolvedOutlet || 'unknown'}:${randomUUID()}`;
  const payload = {
    lodge_id: state.lodgeId, outlet_id: resolvedOutlet,
    opening_float: opening_float ?? openingFloat ?? null,
    notes: notes || null, idempotency_key: key, device_id: device_id || getDesktopPosDeviceId()
  };
  if (!state.isOnline || !state.supabase) {
    if (payload.opening_float === null || payload.opening_float === '' || !Number.isFinite(Number(payload.opening_float)) || Number(payload.opening_float) < 0) {
      return { success: false, error: 'Count the starting change and enter it before opening the drawer (0.00 starts empty).' };
    }
    const existing = resolvedOutlet ? findLocalOpenDrawerPeriod(resolvedOutlet) : null;
    if (existing) return { success: true, period_id: existing.id, already_open: true, offline: true };
    const queueId = `pos-drawer-period-${key}`;
    const period = upsertDrawerPeriod({
      id: randomUUID(), outlet_id: resolvedOutlet, business_date: getLocalDateKey ? getLocalDateKey() : null,
      status: 'open', opening_float: Number(payload.opening_float), opened_by: state.currentUser?.id || null,
      opened_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'open_pos_drawer_period', { payload }, null, { _queue_id: queueId });
    return { success: true, period_id: period.id, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = /** @type {DrawerRpcExpectedResponse} */ (await withNetworkTimeout(
    state.supabase.rpc('open_pos_drawer_period', { payload }),
    undefined,
    'Drawer open'
  ).catch(drawerWriteTimeout('Drawer open')));
  if (error) throw new Error(error.message);
  if (result?.success && result?.period_id) {
    upsertDrawerPeriod({ id: result.period_id, outlet_id: resolvedOutlet, business_date: result.business_date || null, status: 'open', opening_float: result.opening_float ?? null, _sync_state: 'synced' });
  }
  return result || { success: false, error: 'Could not open the drawer period.' };
}

/** @param {RecordCashMovementRequest} [request] */
export async function recordCashMovement({ outlet_id, outletId, movement_type, movementType, amount, operator_id, operatorId, notes, pin, idempotency_key, idempotencyKey, device_id } = {}) {
  const resolvedOutlet = outlet_id || outletId || null;
  const resolvedType = movement_type || movementType || null;
  const key = idempotency_key || idempotencyKey || `pos-cash-movement:${resolvedOutlet || 'unknown'}:${randomUUID()}`;
  const payload = {
    lodge_id: state.lodgeId, outlet_id: resolvedOutlet, movement_type: resolvedType,
    amount: amount ?? null, operator_id: operator_id || operatorId || null,
    notes: notes || null, pin: pin || null, idempotency_key: key, device_id: device_id || getDesktopPosDeviceId()
  };
  if (!state.isOnline || !state.supabase) {
    if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
      return { success: false, error: 'Enter the amount of cash moved.' };
    }
    if (resolvedType === 'paid_out' && !String(payload.notes || '').trim()) {
      return { success: false, error: 'Say what the paid-out cash was for.' };
    }
    const period = resolvedOutlet ? findLocalOpenDrawerPeriod(resolvedOutlet) : null;
    const queueId = `pos-cash-movement-${key}`;
    const row = upsertCashMovement({
      id: randomUUID(), outlet_id: resolvedOutlet, period_id: period?.id || null,
      movement_type: resolvedType, amount: Number(payload.amount),
      operator_id: payload.operator_id || state.currentUser?.id || null,
      actor_id: state.currentUser?.id || null, notes: payload.notes || null,
      idempotency_key: key, created_at: new Date().toISOString(),
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'record_pos_cash_movement', { payload }, null, {
      _queue_id: queueId,
      ...(period?._pending_sync && period?._queue_id ? { _depends_on: period._queue_id } : {})
    });
    return { success: true, movement_id: row.id, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = /** @type {DrawerRpcExpectedResponse} */ (await withNetworkTimeout(
    state.supabase.rpc('record_pos_cash_movement', { payload }),
    undefined,
    'Cash movement'
  ).catch(drawerWriteTimeout('Cash movement')));
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not record the cash movement.' };
}

/** @param {RecordCashCountRequest} [request] */
export async function recordCashCount({ period_id, periodId, count_type, countType, counted_cash, countedCash, operator_id, operatorId, notes, pin, idempotency_key, idempotencyKey, device_id } = {}) {
  const resolvedPeriod = period_id || periodId || null;
  const resolvedType = count_type || countType || null;
  const key = idempotency_key || idempotencyKey || `pos-cash-count:${resolvedPeriod || 'unknown'}:${randomUUID()}`;
  const payload = {
    lodge_id: state.lodgeId, period_id: resolvedPeriod, count_type: resolvedType,
    counted_cash: counted_cash ?? countedCash ?? null,
    operator_id: operator_id || operatorId || null,
    notes: notes || null, pin: pin || null, idempotency_key: key, device_id: device_id || getDesktopPosDeviceId()
  };
  if (resolvedType !== 'handover') {
    return { success: false, error: 'Choose a handover count. Opening counts happen when the drawer opens; closing counts happen at cash-up.' };
  }
  if (!state.isOnline || !state.supabase) {
    const period = (readDrawerPeriods() || []).find((row) => String(row?.id || '') === String(resolvedPeriod || ''));
    if (!period) return { success: false, error: 'Open the drawer period first — count the starting change, then record counts.' };
    if (String(period.status || '') !== 'open') {
      return { success: false, error: 'This drawer period is already submitted. A manager reviews it in Cash & close.' };
    }
    if (payload.counted_cash === null || payload.counted_cash === '' || !Number.isFinite(Number(payload.counted_cash)) || Number(payload.counted_cash) < 0) {
      return { success: false, error: 'Count the drawer and enter what is in it.' };
    }
    const queueId = `pos-cash-count-${key}`;
    const row = upsertCashCount({
      id: randomUUID(), period_id: resolvedPeriod, count_type: resolvedType,
      counted_cash: Number(payload.counted_cash),
      operator_id: payload.operator_id || state.currentUser?.id || null,
      actor_id: state.currentUser?.id || null, notes: payload.notes || null,
      idempotency_key: key, created_at: new Date().toISOString(),
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'record_pos_cash_count', { payload }, null, {
      _queue_id: queueId,
      ...(period?._pending_sync && period?._queue_id ? { _depends_on: period._queue_id } : {})
    });
    return { success: true, count_id: row.id, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = /** @type {DrawerRpcExpectedResponse} */ (await withNetworkTimeout(
    state.supabase.rpc('record_pos_cash_count', { payload }),
    undefined,
    'Handover count'
  ).catch(drawerWriteTimeout('Handover count')));
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not record the count.' };
}

/** @param {SubmitDrawerPeriodCashupRequest} [request] */
export async function submitDrawerPeriodCashup({ period_id, periodId, counted_cash, countedCash, notes, operator_id, operatorId, pin, idempotency_key, idempotencyKey, device_id } = {}) {
  const resolvedPeriod = period_id || periodId || null;
  const key = idempotency_key || idempotencyKey || `pos-drawer-submit:${resolvedPeriod || 'unknown'}:${randomUUID()}`;
  const payload = {
    lodge_id: state.lodgeId, period_id: resolvedPeriod,
    counted_cash: counted_cash ?? countedCash ?? null,
    notes: notes || null, operator_id: operator_id || operatorId || null,
    pin: pin || null, idempotency_key: key, device_id: device_id || getDesktopPosDeviceId()
  };
  if (!state.isOnline || !state.supabase) {
    const period = (readDrawerPeriods() || []).find((row) => String(row?.id || '') === String(resolvedPeriod || ''));
    if (!period) return { success: false, error: 'This drawer period was not found on this device. Refresh and try again.' };
    if (String(period.status || '') !== 'open' && String(period.status || '') !== 'rejected') {
      return { success: false, error: 'This cash-up is already submitted. A manager reviews it in Cash & close.' };
    }
    if (payload.counted_cash === null || payload.counted_cash === '' || !Number.isFinite(Number(payload.counted_cash)) || Number(payload.counted_cash) < 0) {
      return { success: false, error: 'Count the drawer and enter what is in it.' };
    }
    const queueId = `pos-drawer-submit-${key}`;
    const updated = upsertDrawerPeriod({
      ...period, status: 'submitted', counted_cash: Number(payload.counted_cash),
      submit_notes: payload.notes || null, submitted_by: payload.operator_id || state.currentUser?.id || null,
      submitted_at: new Date().toISOString(), submit_idempotency_key: key,
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    upsertCashCount({
      id: randomUUID(), period_id: resolvedPeriod, count_type: 'closing',
      counted_cash: Number(payload.counted_cash),
      operator_id: payload.operator_id || state.currentUser?.id || null,
      actor_id: state.currentUser?.id || null, notes: payload.notes || null,
      idempotency_key: `${key}:closing`, created_at: new Date().toISOString(),
      _pending_sync: true, _sync_state: 'pending'
    });
    queueOperation('rpc', 'submit_pos_drawer_period_cashup', { payload }, null, {
      _queue_id: queueId,
      ...(period?._pending_sync && period?._queue_id && period._queue_id !== queueId ? { _depends_on: period._queue_id } : {})
    });
    return { success: true, period_id: updated.id, status: 'submitted', offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = /** @type {DrawerRpcExpectedResponse} */ (await withNetworkTimeout(
    state.supabase.rpc('submit_pos_drawer_period_cashup', { payload }),
    undefined,
    'Drawer cash-up submit'
  ).catch(drawerWriteTimeout('Drawer cash-up submit')));
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not submit the drawer cash-up.' };
}

export async function reviewDrawerPeriodCashup({ period_id, periodId, decision, notes, manager_pin, managerPin } = {}) {
  const payload = {
    period_id: period_id || periodId || null,
    decision: String(decision || '').toLowerCase(),
    notes: notes || null, manager_pin: manager_pin || managerPin || null
  };
  if (!state.isOnline || !state.supabase) {
    const period = (readDrawerPeriods() || []).find((row) => String(row?.id || '') === String(payload.period_id || ''));
    if (!period) return { success: false, error: 'Drawer period not found in the offline cache.' };
    const verified = validateCachedPosPin(state.currentUser?.id, payload.manager_pin, { manager: true });
    if (!verified.success) return verified;
    if (!['approve', 'reject'].includes(payload.decision)) {
      return { success: false, error: 'Choose approve or return for correction.' };
    }
    if (payload.decision === 'reject' && !String(payload.notes || '').trim()) {
      return { success: false, error: 'Enter a correction note before returning this cash-up.' };
    }
    // The Till keeps trading on a shared drawer, so — unlike a personal
    // cash-up — review never closes local Till shifts. The server resolves
    // shift closure authoritatively at replay.
    const updated = upsertDrawerPeriod({
      ...period, status: payload.decision === 'approve' ? 'approved' : 'rejected',
      review_notes: payload.notes || null, reviewed_at: new Date().toISOString(),
      reviewed_by: state.currentUser?.id || null,
      _pending_sync: true, _sync_state: 'pending'
    });
    const queueId = `pos-drawer-review-${period.id}-${payload.decision}`;
    queueOperation('rpc', 'review_pos_drawer_period_cashup', { payload: {
      lodge_id: state.lodgeId, period_id: period.id, decision: payload.decision,
      notes: payload.notes || null, manager_pin: payload.manager_pin,
      device_id: getDesktopPosDeviceId()
    } }, null, {
      _queue_id: queueId,
      ...(period?._pending_sync && period?._queue_id ? { _depends_on: period._queue_id } : {})
    });
    return { success: true, period_id: updated.id, status: updated.status, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = await withNetworkTimeout(
    state.supabase.rpc('review_pos_drawer_period_cashup', {
      payload: { ...payload, lodge_id: state.lodgeId, device_id: getDesktopPosDeviceId() }
    }),
    undefined,
    'Drawer cash-up review'
  ).catch(drawerWriteTimeout('Drawer cash-up review'));
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not review the drawer cash-up.' };
}

export async function getDrawerPeriodState(outlet_id, outletId) {
  const resolvedOutlet = outlet_id || outletId || null;
  if (!state.isOnline || !state.supabase) {
    const period = resolvedOutlet ? findLocalOpenDrawerPeriod(resolvedOutlet) : null;
    if (!period) return { success: true, period: null, movements: [], counts: [], offline: true };
    return {
      success: true, period,
      movements: readCashMovements().filter((row) => String(row?.period_id || '') === String(period.id)),
      counts: readCashCounts().filter((row) => String(row?.period_id || '') === String(period.id)),
      offline: true
    };
  }
  try {
    const { data, error } = await withNetworkTimeout(state.supabase.rpc('get_pos_drawer_period_state', {
      payload: { lodge_id: state.lodgeId, outlet_id: resolvedOutlet }
    }), 5000, 'Drawer period');
    if (error) throw new Error(error.message);
    return data || { success: false, error: 'Could not load the drawer period.' };
  } catch (error) {
    const period = resolvedOutlet ? findLocalOpenDrawerPeriod(resolvedOutlet) : null;
    if (!period) throw error;
    return {
      success: true, period,
      movements: readCashMovements().filter((row) => String(row?.period_id || '') === String(period.id)),
      counts: readCashCounts().filter((row) => String(row?.period_id || '') === String(period.id)),
      offline: true, degraded: true
    };
  }
}

export async function setOutletCashModel(outletId, cashModel) {
  if (!state.isOnline || !state.supabase) throw new Error('Changing how cash is counted requires an online connection');
  const { data: result, error } = await state.supabase.rpc('set_outlet_cash_model', {
    p_lodge_id: state.lodgeId, p_outlet_id: outletId, p_cash_model: cashModel
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not change how cash is counted.');
  return result;
}

export async function reviewPosCashupSubmission(payload = {}) {
  if (!state.isOnline || !state.supabase) {
    const submission = readPosCashupSubmissions().find((row) => row.id === payload.submission_id);
    if (!submission) return { success: false, error: 'Cash-up submission not found in the offline cache.' };
    const verified = validateCachedPosPin(state.currentUser?.id, payload.manager_pin, { manager: true });
    if (!verified.success) return verified;
    const decision = String(payload.decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(decision)) return { success: false, error: 'Choose approve or return for correction.' };
    if (decision === 'reject' && !String(payload.notes || '').trim()) return { success: false, error: 'A correction note is required.' };
    const updated = upsertPosCashupSubmission({
      ...submission, status: decision === 'approve' ? 'approved' : 'rejected',
      review_notes: payload.notes || null, reviewed_at: new Date().toISOString(), reviewed_by: state.currentUser?.id || null,
      _pending_sync: true, _sync_state: 'pending'
    });
    if (decision === 'approve') {
      writePosShifts(readPosShifts().map((row) => row.id === submission.shift_id ? {
        ...row, status: 'closed', closed_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending'
      } : row));
    }
    const queueId = `pos-cashup-review-${submission.id}-${decision}`;
    queueOperation('rpc', 'review_pos_cashup_submission_offline', { payload: {
      lodge_id: state.lodgeId, submission_id: submission._pending_sync ? null : submission.id,
      submission_idempotency_key: submission.idempotency_key || null,
      decision, notes: payload.notes || null, manager_pin: payload.manager_pin,
      idempotency_key: payload.idempotency_key || queueId, device_id: getDesktopPosDeviceId()
    } }, null, {
      _queue_id: queueId,
      ...(submission._pending_sync ? { _depends_on: submission._queue_id } : {})
    });
    return { success: true, submission: updated, offline: true, queued: true, provisional: true };
  }
  const { data, error } = await state.supabase.rpc('review_pos_cashup_submission', {
    payload: { ...payload, lodge_id: state.lodgeId, device_id: getDesktopPosDeviceId() }
  });
  if (error) throw new Error(error.message);
  return data || { success: false, error: 'Could not review cash-up.' };
}

function updateTableTabStatusByTicket(ticket = {}, status = 'running') {
  if (!ticket.table_name) return;
  const mappedStatus = status === 'served' ? 'delivered' : status === 'ready' ? 'ready' : status === 'cancelled' ? 'closed' : 'running';
  const rows = readPosTabs();
  const matching = findActiveTableTab(rows, ticket.table_name, ticket.outlet_id || null, null);
  if (matching) {
    updatePosTabStatus(matching.id, mappedStatus).catch(() => {});
  }
}

export function getPosTableStatuses(outletId = null, reservationOccupancy = []) {
  const rows = readPosTabs();
  const occupiedByReservation = new Map(
    (Array.isArray(reservationOccupancy) ? reservationOccupancy : [])
      .filter((row) => row?.table_id)
      .map((row) => [String(row.table_id), row]),
  );
  const tables = readPosTables().filter((table) =>
    table.active !== false && (!outletId || !table.outlet_id || table.outlet_id === outletId)
  );
  return tables.map((table) => {
    const activeTab = findActiveTableTab(rows, table.name, table.outlet_id || outletId || null, null);
    const reservation = occupiedByReservation.get(String(table.id)) || null;
    return {
      ...table,
      tab: activeTab || null,
      reservation,
      status: activeTab ? normalizeTabStatus(activeTab.status, 'running') : reservation ? 'occupied' : 'available'
    };
  });
}

export async function getPosTablesWithStatus(outletId = null) {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const key = `floor:${state.lodgeId}:${outletId || 'all'}`;
      const snapshot = await readPosRemoteCached(key, async () => {
        const { data, error } = await state.supabase.rpc('get_pos_floor_snapshot', {
          p_lodge_id: state.lodgeId,
          p_outlet_id: outletId || null
        });
        if (error) throw new Error(error.message);
        return data && typeof data === 'object' ? data : null;
      });
      if (snapshot) {
        const tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : [];
        const tables = Array.isArray(snapshot.tables) ? snapshot.tables : [];
        const occupancy = Array.isArray(snapshot.occupancy) ? snapshot.occupancy : [];
        const activeIds = new Set(tabs.map((row) => row.id));
        writePosTabs([
          ...tabs,
          ...readPosTabs().filter((row) => !isActiveTableTab(row) && !activeIds.has(row.id))
        ], { invalidate: false });
        writePosTables(tables, { invalidate: false });
        return getPosTableStatuses(outletId, occupancy);
      }
    } catch (error) {
      if (!/get_pos_floor_snapshot|schema cache|PGRST202|does not exist/i.test(String(error?.message || ''))) {
        console.warn('[POS FLOOR] Combined floor snapshot unavailable:', error?.message || error);
      }
    }
  }
  const [, , occupancyResult] = await Promise.allSettled([
    getPosTabs({ status: 'active', outletId }),
    getPosTables(),
    state.isOnline && state.supabase && state.lodgeId
      ? state.supabase.rpc('get_restaurant_floor_occupancy', { p_lodge_id: state.lodgeId })
      : Promise.resolve({ data: [] }),
  ]);
  const occupancy = occupancyResult.status === 'fulfilled' && !occupancyResult.value?.error
    ? occupancyResult.value?.data
    : [];
  return getPosTableStatuses(outletId, occupancy);
}

export async function getActivePosTableTab(tableName, outletId = null) {
  await getPosTabs().catch(() => []);
  return findActiveTableTab(readPosTabs(), tableName, outletId, null);
}

export async function openPosTableSession(data = {}) {
  const tableName = normalizeTableName(data.table_name);
  if (!tableName) return { success: false, error: 'Select a table first.' };
  if (!normalizeTableName(data.waiter_name)) return { success: false, error: 'Served-by staff is required before opening a table.' };
  const existing = findActiveTableTab(readPosTabs(), tableName, data.outlet_id || null, null);
  if (existing) return { success: true, tab: existing, already_open: true };
  return savePosTab({
    ...data,
    table_name: tableName,
    tab_name: data.tab_name || tableName,
    items: Array.isArray(data.items) ? data.items : [],
    status: 'running'
  });
}

function readPosTables() {
  const rows = readCache('pos-tables');
  return Array.isArray(rows) ? rows : [];
}

function writePosTables(rows = [], { invalidate = true } = {}) {
  if (invalidate) invalidatePosRemoteReads('floor');
  writeCache('pos-tables', rows.slice(0, 500));
}

export async function getPosTables() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase
        .from('pos_tables')
        .select('*')
        .eq('lodge_id', state.lodgeId)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        const merged = [
          ...data,
          ...readPosTables().filter((local) => !data.some((row) => row.id === local.id))
        ];
        writePosTables(merged, { invalidate: false });
        return merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      }
    } catch (error) {
      console.warn('[POS TABLES] Remote table refresh unavailable:', error?.message || error);
    }
  }
  return readPosTables().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function savePosTable(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) return { success: false, error: 'Table name is required.' };
  if (!state.cacheDir) return { success: false, error: 'Choose a lodge profile before saving POS tables.' };
  ensureDir(state.cacheDir);
  const id = data.id || randomUUID();
  const row = {
    id,
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    name,
    area: String(data.area || '').trim() || null,
    seats: Math.max(0, Number(data.seats || 0)),
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  try {
    writePosTables([row, ...readPosTables().filter((entry) => entry.id !== id)]);
  } catch (error) {
    return { success: false, error: error?.message || 'Could not save table.' };
  }

  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('upsert_pos_table', { payload: row });
      if (error) throw new Error(error.message);
      if (rpcData?.success === false) return rpcData;
      const remoteTable = rpcData?.table || null;
      if (remoteTable?.id) {
        writePosTables([
          remoteTable,
          ...readPosTables().filter((entry) =>
            entry.id !== remoteTable.id &&
            !(
              String(entry.outlet_id || '') === String(remoteTable.outlet_id || '') &&
              normalizeTableName(entry.name).toLowerCase() === normalizeTableName(remoteTable.name).toLowerCase()
            )
          )
        ]);
      }
      return { success: true, table: remoteTable || row };
    } catch (error) {
      console.warn('[POS TABLES] Remote table save unavailable; kept local table:', error?.message || error);
    }
  } else {
    queueOperation('rpc', 'upsert_pos_table', { payload: row }, null, {
      _queue_id: `pos-table-${id}`
    });
  }

  return { success: true, table: row, offline: true };
}

export async function deletePosTable(id) {
  const existing = readPosTables().find((row) => row.id === id);
  if (!existing) return { success: false, error: 'Table not found.' };
  return savePosTable({ ...existing, active: false });
}

function readPosStations() {
  const rows = readCache('pos-stations');
  return Array.isArray(rows) ? rows : [];
}

function writePosStations(rows = []) {
  writeCache('pos-stations', rows.slice(0, 50));
}

export async function getPosStations() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('get_pos_kitchen_stations', {
        p_lodge_id: state.lodgeId
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        const merged = data.map((s) => ({
          id: s.id,
          station_key: s.station_key,
          name: s.name,
          type: s.station_type,
          enabled: s.enabled,
          sort_order: s.sort_order || 0,
          outlet_id: s.outlet_id || null
        }));
        writePosStations(merged);
        return merged;
      }
    } catch (error) {
      console.warn('[POS STATIONS] Remote station refresh unavailable:', error?.message || error);
    }
  }
  const cached = readPosStations();
  if (cached.length === 0) {
    return [
      { id: 'kitchen', station_key: 'kitchen', name: 'Kitchen', type: 'kitchen', enabled: true, sort_order: 0 },
      { id: 'bar', station_key: 'bar', name: 'Bar', type: 'bar', enabled: true, sort_order: 1 }
    ];
  }
  return cached;
}

export async function savePosStation(data = {}) {
  const { id, name, type, enabled, station_key, outlet_id } = data || {};
  if (!name?.trim()) return { success: false, error: 'Station name is required.' };
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, error: 'Station configuration requires an internet connection.' };
  }
  const key = station_key || name.trim().toLowerCase().replace(/\s+/g, '_');
  const { data: result, error } = await state.supabase.rpc('upsert_pos_kitchen_station', {
    payload: {
      lodge_id: state.lodgeId,
      id: id || null,
      outlet_id: outlet_id || null,
      station_key: key,
      name: name.trim(),
      station_type: type || 'kitchen',
      enabled: enabled !== false
    }
  });
  if (error) return { success: false, error: error.message };
  if (result?.success === false) return result;
  if (result?.success && result?.station) {
    const stations = readPosStations();
    const existing = stations.findIndex((s) => s.id === result.station.id);
    const updated = { ...result.station, type: result.station.station_type };
    const next = existing >= 0 ? stations.map((s, i) => i === existing ? updated : s) : [...stations, updated];
    writePosStations(next);
    return { success: true, station: updated };
  }
  return { success: false, error: 'Could not save station.' };
}

export async function deletePosStation(id) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, error: 'Station deletion requires an internet connection.' };
  }
  const { data: result, error } = await state.supabase.rpc('delete_pos_kitchen_station', {
    p_lodge_id: state.lodgeId,
    p_station_id: id
  });
  if (error) return { success: false, error: error.message };
  if (result?.success === false) return result;
  writePosStations(readPosStations().filter((s) => s.id !== id));
  return { success: true };
}

function readPosTickets() {
  const rows = readCache('pos-tickets');
  return Array.isArray(rows) ? rows : [];
}

function writePosTickets(rows = [], { invalidate = true } = {}) {
  if (invalidate) invalidatePosRemoteReads('tickets');
  writeCache('pos-tickets', rows.slice(0, 1000));
}

function buildPrepTicketsForOrder(order = {}, items = []) {
  const grouped = new Map();
  const stations = readPosStations().filter((s) => s.enabled !== false);
  const stationKeyToId = new Map(stations.map((s) => [s.station_key || s.id, s.id]));
  for (const item of items || []) {
    if (!item?.item_name || Number(item.quantity || 0) <= 0 || Number(item.unit_price || 0) < 0) continue;
    let stationKey = item.station || item.kitchen_station_id || null;
    if (stationKey && stationKeyToId.has(stationKey)) {
      stationKey = stationKeyToId.get(stationKey);
    }
    if (!stationKey || !stations.some((s) => s.id === stationKey || s.station_key === stationKey)) {
      stationKey = /bar|drink|beverage/i.test(`${item.category || ''} ${order.outlet_name || ''}`) ? 'bar' : 'kitchen';
    }
    if (!grouped.has(stationKey)) grouped.set(stationKey, []);
    grouped.get(stationKey).push(item);
  }
  const now = new Date().toISOString();
  return [...grouped.entries()].map(([station, stationItems]) => ({
    id: randomUUID(),
    lodge_id: state.lodgeId,
    order_id: order.id,
    outlet_id: order.outlet_id || null,
    station,
    service_mode: order.service_mode || (order.tab_id || order.tab_name ? 'tab' : 'counter'),
    status: 'new',
    table_name: order.table_name || null,
    tab_name: order.tab_name || null,
    waiter_name: order.waiter_name || null,
    room_id: order.room_id || null,
    notes: order.notes || null,
    items: stationItems,
    created_at: now,
    updated_at: now
  }));
}

function appendPrepTickets(order = {}, items = []) {
  const tickets = buildPrepTicketsForOrder(order, items);
  if (tickets.length > 0) writePosTickets([...tickets, ...readPosTickets()]);
  return tickets;
}

export async function getPosTickets(filters = {}) {
  const station = filters.station || 'all';
  const status = String(filters.status || '').trim().toLowerCase();
  const createdFrom = filters.createdFrom || filters.created_from || null;
  const createdTo = filters.createdTo || filters.created_to || null;
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const key = `tickets:${state.lodgeId}:${station}:${status || 'all'}:${createdFrom || ''}:${createdTo || ''}`;
      const data = await readPosRemoteCached(key, async () => {
        let query = state.supabase
          .from('pos_prep_tickets')
          .select(POS_TICKET_SELECT)
          .eq('lodge_id', state.lodgeId)
          .order('created_at', { ascending: false })
          .limit(1000);
        if (station !== 'all') query = query.eq('station', station);
        if (status === 'active') query = query.in('status', ACTIVE_PREP_TICKET_STATUSES);
        else if (status) query = query.eq('status', status);
        if (createdFrom) query = query.gte('created_at', createdFrom);
        if (createdTo) query = query.lt('created_at', createdTo);
        const result = await query;
        if (result.error) throw new Error(result.error.message);
        return Array.isArray(result.data) ? result.data : [];
      });
      if (Array.isArray(data)) {
        const remoteIds = new Set(data.map((ticket) => ticket.id));
        writePosTickets([...data, ...readPosTickets().filter((ticket) => !remoteIds.has(ticket.id))], { invalidate: false });
        return data;
      }
    } catch (error) {
      console.warn('[POS TICKETS] Remote refresh unavailable:', error?.message || error);
    }
  }
  return readPosTickets()
    .filter((ticket) => {
      if (station !== 'all' && ticket.station !== station) return false;
      if (status === 'active' && !ACTIVE_PREP_TICKET_STATUSES.includes(String(ticket.status || '').toLowerCase())) return false;
      if (status && status !== 'active' && String(ticket.status || '').toLowerCase() !== status) return false;
      const createdAt = String(ticket.created_at || '');
      if (createdFrom && createdAt < createdFrom) return false;
      if (createdTo && createdAt >= createdTo) return false;
      return true;
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export async function updatePosTicketStatus(id, status) {
  const allowed = new Set(['new', 'preparing', 'ready', 'served', 'cancelled']);
  const nextStatus = allowed.has(status) ? status : 'new';
  const operationId = `ticket:${id}:${nextStatus}`;
  const previousTickets = readPosTickets();
  const previousTicket = previousTickets.find((t) => t.id === id);

  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('update_pos_prep_ticket_status', {
        p_ticket_id: id,
        p_status: nextStatus,
        p_lodge_id: state.lodgeId,
        p_operation_id: operationId
      });
      if (error) throw new Error(error.message);
      if (data?.success === false) {
        return data;
      }
      if (data?.ticket?.id) {
        const updatedTicket = data.ticket;
        writePosTickets(readPosTickets().map((ticket) => ticket.id === id ? updatedTicket : ticket));
        updateTableTabStatusByTicket(updatedTicket, nextStatus);
        appendPosAudit('ticket_status_updated', {
          entity_type: 'pos_ticket', entity_id: id,
          details: { status: nextStatus, station: updatedTicket.station, table_name: updatedTicket.table_name || null }
        });
        return { success: true, ticket: updatedTicket };
      }
      return { success: true };
    } catch (error) {
      writePosTickets(previousTickets);
      throw error;
    }
  }

  // Offline ticket status updates are blocked to prevent server-client state
  // mismatch. Ticket status is an operational concern, not financial, and
  // untracked offline changes can create ghost states after reconnect.
  return { success: false, error: 'Ticket status updates require an internet connection.' };
}

/** @returns {PosStaffShiftExpectedData[]} */
function readPosShifts() {
  const rows = readCache('pos-shifts');
  // Fields are supplied by pos_shifts reads and the local shift writer; persisted JSON is not validated here.
  return Array.isArray(rows) ? /** @type {PosStaffShiftExpectedData[]} */ (rows) : [];
}

/** @param {PosStaffShiftExpectedData[]} [rows] */
function writePosShifts(rows = []) {
  writeCache('pos-shifts', rows.slice(0, 500));
}

export async function getCurrentPosShift(outletId = null, cashierId = null) {
  const operatorId = cashierId || state.currentUser?.id || null;
  // An open cash shift is server truth. The local cache is still useful when
  // offline, but it must not hide a real server-backed shift (including an
  // imported/demo shift) from the service terminal.
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      let query = state.supabase
        .from('pos_shifts')
        .select('*')
        .eq('lodge_id', state.lodgeId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(10);
      if (outletId) query = query.eq('outlet_id', outletId);
      if (operatorId) query = query.eq('cashier_id', operatorId);
      const { data, error } = await withNetworkTimeout(query, 5000, 'Current shift');
      if (error) throw error;
      const active = Array.isArray(data) ? data[0] : null;
      if (active) {
        const cached = readPosShifts().filter((row) => row.id !== active.id);
        writePosShifts([active, ...cached]);
        return active;
      }
      // A successful server read with no matching open shift is authoritative.
      // Do not fall through to a stale local "open" shift after cash-up has
      // closed it, otherwise the staff member is blocked from clocking out.
      writePosShifts(readPosShifts().filter((row) => !(
        row.status === 'open' &&
        (!outletId || row.outlet_id === outletId) &&
        (!operatorId || row.cashier_id === operatorId)
      )));
      return null;
    } catch (error) {
      console.warn('[POS SHIFT] Server lookup failed; using local shift cache:', error?.message || error);
    }
  }
  return readPosShifts().find((row) =>
    row.status === 'open' &&
    (!outletId || row.outlet_id === outletId) &&
    (!operatorId || !row.cashier_id || row.cashier_id === operatorId)
  ) || null;
}

/** @param {PosOpenShiftRequest} [data] */
export async function openPosShift(data = {}) {
  const operatorId = data.cashier_id || state.currentUser?.id || null;
  const operatorName = data.cashier_name || state.currentUser?.name || state.currentUser?.email || null;
  const existing = await getCurrentPosShift(data.outlet_id || null, operatorId);
  if (existing) return { success: true, shift: existing, already_open: true };
  const now = new Date().toISOString();
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    cashier_id: operatorId,
    cashier_name: operatorName,
    opening_float: normalizeMoney(data.opening_float),
    status: 'open',
    opened_at: now,
    closed_at: null,
    notes: data.notes || null
  };

  if (state.isOnline && state.supabase && state.lodgeId) {
    const { data: result, error } = await state.supabase.rpc('open_pos_shift_with_id', {
      payload: {
        shift_id: row.id,
        lodge_id: state.lodgeId,
        outlet_id: row.outlet_id,
        cashier_id: row.cashier_id,
        cashier_name: row.cashier_name,
        opening_float: row.opening_float,
        notes: row.notes,
        create_idempotency_key: data.create_idempotency_key || data.idempotency_key || row.id
      }
    });
    if (error) throw new Error(error.message || 'Could not open this shift.');
    if (result?.success === false) return result;
    const confirmed = result?.shift || row;
    writePosShifts([confirmed, ...readPosShifts().filter((shift) => shift.id !== confirmed.id)]);
    return { success: true, shift: confirmed, already_open: result?.already_open === true };
  }

  const queueId = `pos-shift-${row.id}`;
  const attendance = readAttendanceShifts().find((entry) =>
    entry.staff_user_id === operatorId && entry.status === 'active'
  ) || null;
  const pendingRow = {
    ...row,
    attendance_shift_id: attendance?.id || null,
    _pending_sync: true,
    _sync_state: 'pending',
    _queue_id: queueId
  };
  writePosShifts([pendingRow, ...readPosShifts().filter((shift) => shift.id !== row.id)]);
  queueOperation('rpc', 'open_pos_shift_with_id', {
    payload: {
      shift_id: row.id,
      lodge_id: state.lodgeId,
      outlet_id: row.outlet_id,
      cashier_id: row.cashier_id,
      cashier_name: row.cashier_name,
      opening_float: row.opening_float,
      notes: row.notes,
      attendance_shift_id: attendance?.id || null,
      create_idempotency_key: data.create_idempotency_key || data.idempotency_key || row.id
    }
  }, null, {
    _queue_id: queueId,
    ...(attendance?._pending_sync ? { _depends_on: attendance._queue_id || `attendance-shift-${attendance.id}` } : {})
  });
  return { success: true, shift: pendingRow, offline: true, queued: true, provisional: true };
}

export async function updatePosTicketStatusWithOperation(id, status, operationId) {
  const nextStatus = String(status || 'new').trim().toLowerCase();
  const key = String(operationId || '').trim();
  if (!id || !key) return { success: false, error: 'A stable ticket operation key is required.' };
  if (!state.isOnline || !state.supabase || !state.lodgeId) return { success: false, error: 'Ticket status updates require an internet connection.' };
  const { data, error } = await state.supabase.rpc('update_pos_prep_ticket_status', {
    p_ticket_id: id,
    p_status: nextStatus,
    p_lodge_id: state.lodgeId,
    p_operation_id: key
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) return data;
  if (data?.ticket?.id) {
    writePosTickets(readPosTickets().map((ticket) => ticket.id === id ? data.ticket : ticket));
    updateTableTabStatusByTicket(data.ticket, nextStatus);
  }
  return data || { success: false, error: 'Could not update this ticket.' };
}

export async function getPosVoidReasonTemplates() {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return [];
  const { data, error } = await state.supabase.rpc('get_pos_void_reason_templates', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function savePosVoidReasonTemplate(data = {}) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return { success: false, error: 'Void-reason templates require an internet connection.' };
  const operationId = String(data.idempotency_key || data.operation_id || randomUUID()).trim();
  const { data: result, error } = await state.supabase.rpc('save_pos_void_reason_template', {
    payload: { ...data, lodge_id: state.lodgeId, idempotency_key: operationId }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not save void-reason template.' };
}

export async function getPosShiftHandoverNotes(shiftId = null) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return [];
  const { data, error } = await state.supabase.rpc('get_pos_shift_handover_notes', { p_lodge_id: state.lodgeId, p_shift_id: shiftId || null });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function savePosShiftHandoverNote(data = {}) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return { success: false, error: 'Handover notes require an internet connection so the shared team sees one authoritative record.' };
  const operationId = String(data.operation_id || data.idempotency_key || randomUUID()).trim();
  const { data: result, error } = await state.supabase.rpc('upsert_pos_shift_handover_note', {
    payload: { ...data, lodge_id: state.lodgeId, operation_id: operationId }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not save handover note.' };
}

export async function attachPosCashupProof(data = {}) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return { success: false, error: 'Cash-up proof attachments require a live connection.' };
  const submissionId = String(data.submission_id || '').trim();
  const mimeType = String(data.mime_type || '').trim().toLowerCase();
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png']);
  if (!submissionId || !/^[0-9a-f-]{36}$/i.test(submissionId)) return { success: false, error: 'Cash-up submission identity is invalid.' };
  if (!allowed.has(mimeType)) return { success: false, error: 'Choose a PDF, JPG or PNG proof.' };
  const source = data.file_bytes || data.bytes || data.file_buffer;
  if (!(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) return { success: false, error: 'Proof bytes must be supplied as an ArrayBuffer.' };
  const view = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const bytes = Buffer.from(view);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return { success: false, error: 'Proof files must be between 1 byte and 8 MB.' };
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const suppliedHash = String(data.sha256 || expectedHash).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(suppliedHash) || suppliedHash !== expectedHash) return { success: false, error: 'The proof file hash could not be verified.' };
  const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  const operationId = String(data.idempotency_key || data.operation_id || `cashup-proof:${submissionId}:${suppliedHash}`).trim();
  const objectKey = createHash('sha256').update(operationId).digest('hex').slice(0, 32);
  const storagePath = `${state.lodgeId}/cashups/${submissionId}/${objectKey}.${extension}`;
  const upload = await state.supabase.storage.from('private-cashup-proofs').upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (upload.error && !/already exists|duplicate|409/i.test(String(upload.error.message || upload.error))) return { success: false, error: 'Durable proof storage is unavailable. The cash-up was not changed.' };
  try {
    const { data: result, error } = await state.supabase.rpc('attach_pos_cashup_proof', {
      payload: {
        lodge_id: state.lodgeId,
        submission_id: submissionId,
        storage_path: storagePath,
        file_name: String(data.file_name || `cashup-proof.${extension}`).replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 120) || `cashup-proof.${extension}`,
        mime_type: mimeType,
        byte_count: bytes.length,
        sha256: suppliedHash,
        idempotency_key: operationId
      }
    });
    if (error) throw new Error(error.message);
    if (result?.success === false) return result;
    return result || { success: false, error: 'The uploaded proof could not be recorded.' };
  } catch (error) {
    throw new Error(`${error?.message || 'Cash-up proof metadata could not be recorded.'} Durable upload remains unregistered for supervisor recovery.`);
  }
}

export async function getPosCashupProofAttachments(submissionId) {
  if (!state.isOnline || !state.supabase || !state.lodgeId || !submissionId) throw new Error('Cash-up proof metadata requires a live authorized connection.');
  const { data, error } = await state.supabase.rpc('get_pos_cashup_proof_attachments', { p_lodge_id: state.lodgeId, p_submission_id: submissionId });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Cash-up proof metadata is unavailable.');
  return Array.isArray(data?.attachments) ? data.attachments : [];
}

export async function createPosCashupProofSignedUrl(submissionId, attachmentId) {
  const attachments = await getPosCashupProofAttachments(submissionId);
  const attachment = attachments.find((row) => row.id === attachmentId);
  if (!attachment?.storage_path || !attachment.storage_bucket) throw new Error('Cash-up proof is not available for this authorized submission.');
  const { data, error } = await state.supabase.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'A short-lived proof read could not be created.');
  return { success: true, signed_url: data.signedUrl, expires_in_seconds: 60, attachment: { id: attachment.id, file_name: attachment.file_name, sha256: attachment.sha256, created_at: attachment.created_at } };
}

export async function getStaffOpenPosShift(staffId) {
  if (!staffId) return null;
  if (!state.isOnline || !state.supabase) {
    return readPosShifts().find((row) => row.cashier_id === staffId && row.status === 'open') || null;
  }
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_staff_open_pos_shift', { p_lodge_id: state.lodgeId, p_staff_id: staffId }),
      5000,
      'Staff shift'
    );
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Could not load the staff Till shift.');
    return data?.shift || null;
  } catch (error) {
    console.warn('[POS SHIFT] Staff shift lookup failed; using local shift cache:', error?.message || error);
    return readPosShifts().find((row) => row.cashier_id === staffId && row.status === 'open') || null;
  }
}

export async function getStaffPosCashupSubmission(shiftId) {
  if (!shiftId) return { success: true, submission: null };
  if (!state.isOnline || !state.supabase) {
    return { success: true, submission: readPosCashupSubmissions().find((row) => row.shift_id === shiftId) || null, offline: true };
  }
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_staff_pos_cashup_submission', { p_lodge_id: state.lodgeId, p_shift_id: shiftId }),
      5000,
      'Cash-up status'
    );
    if (error) throw new Error(error.message);
    return data || { success: true, submission: null };
  } catch (error) {
    console.warn('[POS CASHUP] Staff submission lookup failed; using local cache:', error?.message || error);
    return { success: true, submission: readPosCashupSubmissions().find((row) => row.shift_id === shiftId) || null, offline: true };
  }
}

/** @param {PosSharedTillOperatorRequest} [request] */
export async function activateSharedTillOperator({ staff_id, staffId, outlet_id, outletId, pin, idempotency_key, idempotencyKey } = {}) {
  const resolvedStaffId = staff_id || staffId || null;
  const resolvedOutletId = outlet_id || outletId || null;
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  if (!state.isOnline || !state.supabase) {
    const verified = validateCachedPosPin(resolvedStaffId, pin);
    if (!verified.success) return verified;
    if (!resolvedOutletId) return { success: false, error: 'Choose an outlet before unlocking Till.' };
    // Guardrail: never queue a duplicate Till open while one is already open
    // for the same staff + outlet. The server keeps one open shift per
    // outlet/cashier (`open_pos_shift_with_id` returns already_open); a
    // second queued open dead-letters on the proof FK / remap path.
    const existingOpenTill = readPosShifts().find((row) =>
      String(row?.status || '').toLowerCase() === 'open' &&
      !row?.closed_at &&
      String(row?.outlet_id || '') === String(resolvedOutletId || '') &&
      String(row?.cashier_id || '') === String(resolvedStaffId || '')
    ) || null;
    if (existingOpenTill) {
      return {
        success: true, staff: verified.staff, shift: existingOpenTill,
        attendance_shift_id: existingOpenTill.attendance_shift_id || null,
        already_open: true, offline: true, queued: false, provisional: !!existingOpenTill._pending_sync
      };
    }
    try {
      const queuedTill = /** @type {PosStaffShiftQueueExpectedData[]} */ (readSyncQueue() || []).find((item) =>
        item?.table === 'activate_shared_till_operator_offline' &&
        String(item?.data?.payload?.staff_user_id || '') === String(resolvedStaffId || '') &&
        String(item?.data?.payload?.outlet_id || '') === String(resolvedOutletId || '')
      ) || null;
      if (queuedTill?.data?.payload?.pos_shift_id) {
        const queuedShift = readPosShifts().find((row) => String(row?.id || '') === String(queuedTill.data.payload.pos_shift_id)) || null;
        if (queuedShift) {
          return {
            success: true, staff: verified.staff, shift: queuedShift,
            attendance_shift_id: queuedShift.attendance_shift_id || null,
            already_open: true, offline: true, queued: false, provisional: true
          };
        }
      }
    } catch {
      /* Queue guard is best-effort; fall through to normal offline open. */
    }
    let attendance = readAttendanceShifts().find((row) => row.staff_user_id === resolvedStaffId && row.status === 'active') || null;
    if (!attendance) {
      const attendanceId = randomUUID();
      const attendanceQueueId = `attendance-shift-${attendanceId}`;
      attendance = upsertAttendanceShift({
        id: attendanceId, lodge_id: state.lodgeId, staff_user_id: resolvedStaffId,
        staff_name: verified.staff.name || verified.staff.email, role: verified.staff.role || 'bar',
        clock_in: new Date().toISOString(), status: 'active', idempotency_key: `${resolvedKey}:attendance`,
        _pending_sync: true, _sync_state: 'pending', _queue_id: attendanceQueueId
      });
      queueOperation('rpc', 'clock_in_staff_with_attendance_pin_offline', {
        payload: {
          lodge_id: state.lodgeId, shift_id: attendanceId, staff_user_id: resolvedStaffId,
          pin, role: verified.staff.role || 'bar', idempotency_key: `${resolvedKey}:attendance`,
          device_id: getDesktopPosDeviceId()
        }
      }, null, { _queue_id: attendanceQueueId });
    }
    const shiftId = randomUUID();
    const shiftQueueId = `pos-shift-${shiftId}`;
    const shift = {
      id: shiftId, lodge_id: state.lodgeId, outlet_id: resolvedOutletId,
      cashier_id: resolvedStaffId, cashier_name: verified.staff.name || verified.staff.email,
      opening_float: 0, status: 'open', opened_at: new Date().toISOString(), closed_at: null,
      attendance_shift_id: attendance.id, _pending_sync: true, _sync_state: 'pending', _queue_id: shiftQueueId
    };
    writePosShifts([shift, ...readPosShifts().filter((row) => row.id !== shiftId)]);
    queueOperation('rpc', 'activate_shared_till_operator_offline', {
      payload: {
        lodge_id: state.lodgeId, staff_user_id: resolvedStaffId, outlet_id: resolvedOutletId,
        pos_shift_id: shiftId, pin, idempotency_key: resolvedKey, device_id: getDesktopPosDeviceId()
      }
    }, null, {
      _queue_id: shiftQueueId,
      ...(attendance?._pending_sync ? { _depends_on: attendance._queue_id || `attendance-shift-${attendance.id}` } : {})
    });
    appendPosAudit('shared_till_unlocked_offline', { entity_type: 'pos_shift', entity_id: shiftId, details: { staff_id: resolvedStaffId, outlet_id: resolvedOutletId } });
    return {
      success: true, staff: verified.staff, shift, attendance_shift_id: attendance.id,
      session: { outlet_id: resolvedOutletId, last_activity_at: Date.now() },
      offline: true, queued: true, provisional: true
    };
  }
  const { data: result, error } = await state.supabase.rpc('activate_shared_till_operator', {
    payload: {
      lodge_id: state.lodgeId,
      staff_user_id: resolvedStaffId,
      outlet_id: resolvedOutletId,
      pin: String(pin || ''),
      idempotency_key: resolvedKey,
      device_id: getDesktopPosDeviceId()
    }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return withOperatorPinResult(result);
  return result || { success: false, error: 'Could not unlock Till.' };
}

export async function touchSharedTillOperatorProof({ outlet_id, outletId, staff_id, staffId, shift_id, shiftId, operator_proof } = {}) {
  if (!state.isOnline || !state.supabase) return { success: true, offline: true };
  const { data, error } = await state.supabase.rpc('touch_pos_till_operator_proof', {
    payload: {
      lodge_id: state.lodgeId,
      outlet_id: outlet_id || outletId || null,
      staff_id: staff_id || staffId || null,
      shift_id: shift_id || shiftId || null,
      operator_proof: operator_proof || null
    }
  });
  if (error) throw new Error(error.message);
  return data || { success: false, error: 'The shared Till proof could not be renewed.' };
}

export async function linkMyPosShiftToAttendance({ pos_shift_id, attendance_shift_id } = {}) {
  if (!state.isOnline || !state.supabase) {
    const shift = readPosShifts().find((row) => row.id === pos_shift_id);
    const attendance = readAttendanceShifts().find((row) => row.id === attendance_shift_id);
    if (!shift || !attendance) return { success: false, error: 'The local Till or attendance shift could not be found.' };
    writePosShifts(readPosShifts().map((row) => row.id === pos_shift_id ? { ...row, attendance_shift_id, _pending_sync: true } : row));
    const queueId = `pos-shift-attendance-link-${pos_shift_id}`;
    queueOperation('rpc', 'link_my_pos_shift_to_attendance', {
      payload: { lodge_id: state.lodgeId, pos_shift_id, attendance_shift_id }
    }, null, {
      _queue_id: queueId,
      _depends_on: shift._queue_id || `pos-shift-${pos_shift_id}`,
      _depends_on_all: [shift._queue_id || `pos-shift-${pos_shift_id}`, attendance._queue_id || `attendance-shift-${attendance_shift_id}`]
    });
    return { success: true, offline: true, queued: true, provisional: true };
  }
  const { data, error } = await state.supabase.rpc('link_my_pos_shift_to_attendance', { payload: { lodge_id: state.lodgeId, pos_shift_id, attendance_shift_id } });
  if (error) throw new Error(error.message); return data || { success: false };
}

/** @param {string} shiftId @param {string|null} [idempotencyKey] @returns {Promise<PosShiftCloseResolutionExpectedData|{success: false, code: string, error: string}>} */
async function readAuthoritativeShiftClose(shiftId, idempotencyKey = null) {
  // This private reader is called only from closePosShift's online path (or
  // its state.supabase-guarded recovery branch).
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_pos_shift_close_resolution', {
    p_lodge_id: state.lodgeId,
    p_shift_id: shiftId,
    p_close_idempotency_key: idempotencyKey
  });
  if (error) throw new Error(error.message);
  return /** @type {PosShiftCloseResolutionExpectedData} */ (data) || { success: false, code: 'shift_close_unresolved', error: 'The server returned no shift-close evidence.' };
}

/** @param {PosCloseShiftRequest} [data] */
export async function closePosShift(data = {}) {
  if (!state.isOnline || !state.supabase) {
    const shift = data.shift_id
      ? readPosShifts().find((row) => row.id === data.shift_id)
      : readPosShifts().find((row) => row.status === 'open' && (!data.outlet_id || row.outlet_id === data.outlet_id));
    if (!shift) return { success: false, error: 'No open Till shift is available in the offline cache.' };
    const cashupId = data.cashup_id || randomUUID();
    const idempotencyKey = data.idempotency_key || `pos-cashup-close:${shift.id}`;
    const queueId = `pos-cashup-close-${shift.id}`;
    const dependencies = [
      shift._pending_sync ? (shift._queue_id || `pos-shift-${shift.id}`) : null,
      .../** @type {PosShiftCloseQueueReadView[]} */ (readSyncQueue()).filter((item) => item?.table === 'create_pos_order_v3' && item?.data?.payload?.shift_id === shift.id).map((item) => item._queue_id)
    ].filter(Boolean);
    const payload = {
      lodge_id: state.lodgeId, shift_id: shift.id, cashup_id: cashupId,
      idempotency_key: idempotencyKey,
      counted_by_method: { cash: normalizeMoney(data.closing_cash || 0) },
      notes: data.notes || null
    };
    queueOperation('rpc', 'finalize_pos_shift_cashup_v2', { payload }, null, {
      _queue_id: queueId,
      ...(dependencies[0] ? { _depends_on: dependencies[0], _depends_on_all: dependencies } : {})
    });
    const closed = {
      ...shift, status: 'closed', closing_cash: payload.counted_by_method.cash,
      closed_at: new Date().toISOString(), close_notes: payload.notes,
      _pending_sync: true, _sync_state: 'pending', _server_closed: false, _queue_id: queueId
    };
    writePosShifts([closed, ...readPosShifts().filter((row) => row.id !== shift.id)]);
    appendPosAudit('shift_close_queued_offline', { entity_type: 'pos_shift', entity_id: shift.id, details: { cashup_id: cashupId, outlet_id: shift.outlet_id || null } });
    return { success: true, shift: closed, cashup_id: cashupId, offline: true, queued: true, provisional: true };
  }

  let shift = data.shift_id
    ? readPosShifts().find((row) => row.id === data.shift_id)
    : await getCurrentPosShift(data.outlet_id || null, data.cashier_id || null);

  // A missing cache row is not proof that the shift is missing. Resolve the
  // exact server row first, and only then allow the authoritative finalizer to
  // proceed or reconcile an already-finalized close.
  if (!shift && data.shift_id) {
    try {
      const resolution = await readAuthoritativeShiftClose(data.shift_id);
      const resolved = classifyAuthoritativeShiftClose(resolution);
      if (resolved.success) {
        const mirrored = { ...(resolved.shift || {}), status: 'closed', _server_closed: true };
        writePosShifts([mirrored, ...readPosShifts().filter((row) => row.id !== data.shift_id)]);
        return { ...resolved, shift: mirrored, resolved_authoritatively: true };
      }
      if (resolution?.exists === true && String(resolution.status || '').toLowerCase() === 'open') {
        shift = resolution.shift || { id: data.shift_id, status: 'open' };
      } else {
        return { success: false, code: resolved.code, error: resolved.error };
      }
    } catch (error) {
      return { success: false, code: 'shift_close_resolution_unavailable', error: `Could not verify the exact shift on the server. Keep it open and ask a manager to review. ${error.message}` };
    }
  }
  if (!shift) return { success: false, code: 'shift_missing', error: 'No shift could be verified on the server. Manager review is required.' };

  const closeAttemptCacheKey = 'pos-shift-close-attempts';
  let closeAttempts = readCache(closeAttemptCacheKey);
  let closeAttempt = null;
  try {
    const countedByMethod = { cash: normalizeMoney(data.closing_cash || 0) };
    const closeFingerprint = JSON.stringify({
      lodge_id: state.lodgeId,
      shift_id: shift.id,
      cashier_id: shift.cashier_id || data.cashier_id || null,
      counted_by_method: countedByMethod,
      notes: data.notes || null
    });
    // Persisted cache JSON is unvalidated; this expected row view mirrors the
    // local writer and reads below while preserving malformed rows at runtime.
    const existingCloseAttempt = (Array.isArray(closeAttempts) ? /** @type {PosShiftCloseAttemptExpectedData[]} */ (closeAttempts) : [])
      .find((attempt) => attempt?.shift_id === shift.id);
    if (existingCloseAttempt && existingCloseAttempt.fingerprint !== closeFingerprint) {
      return {
        success: false,
        code: 'idempotency_conflict',
        error: 'This shift-close attempt is still unresolved. Reconnect and retry the original cash count and notes before changing the close.'
      };
    }
    const replayingExistingAttempt = Boolean(existingCloseAttempt);
    closeAttempt = existingCloseAttempt || {
      shift_id: shift.id,
      cashup_id: randomUUID(),
      idempotency_key: `pos-cashup-close:${shift.id}`,
      fingerprint: closeFingerprint,
      created_at: new Date().toISOString()
    };
    if (!existingCloseAttempt) {
      closeAttempts = Array.isArray(closeAttempts) ? /** @type {PosShiftCloseAttemptExpectedData[]} */ (closeAttempts) : [];
      writeCache(closeAttemptCacheKey, [closeAttempt, ...closeAttempts]);
    }
    const idempotencyKey = closeAttempt.idempotency_key;
    const payload = {
      lodge_id: state.lodgeId,
      shift_id: shift.id,
      cashup_id: closeAttempt.cashup_id,
      idempotency_key: idempotencyKey,
      counted_by_method: countedByMethod,
      notes: data.notes || null
    };

    /** @type {PosShiftCloseRpcResultExpectedData|null|undefined} */
    let result;
    let rpcError = null;
    try {
      const response = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('finalize_pos_shift_cashup_v2', { payload });
      // Expected SQL envelope only; response data is not runtime-validated.
      result = /** @type {PosShiftCloseRpcResultExpectedData|null|undefined} */ (response.data);
      rpcError = response.error;
    } catch (error) {
      rpcError = error;
    }

    if (rpcError || !result?.success) {
      let resolution;
      try {
        resolution = await readAuthoritativeShiftClose(shift.id, idempotencyKey);
      } catch (resolutionError) {
        return {
          success: false,
          code: 'shift_close_resolution_unavailable',
          error: `${(/** @type {PosThrownMessageReadView} */ (rpcError))?.message || result?.error || 'The shift close result is uncertain.'} Keep the shift open; authoritative reconciliation is unavailable until the connection or migration is restored.`
        };
      }
      const reconciled = classifyAuthoritativeShiftClose(resolution, idempotencyKey);
      if (!reconciled.success) {
        return { success: false, code: reconciled.code, error: result?.error || (/** @type {PosThrownMessageReadView} */ (rpcError))?.message || reconciled.error };
      }
      const closed = { ...(reconciled.shift || shift), status: 'closed', _server_closed: true };
      writePosShifts([closed, ...readPosShifts().filter((row) => row.id !== shift.id)]);
      writeCache(closeAttemptCacheKey, (Array.isArray(closeAttempts) ? closeAttempts : []).filter((attempt) => attempt?.shift_id !== shift.id));
      const reconciledRefreshWarning = await refreshPosCachesBestEffort(['pos-shifts'], 'shift-close-reconciled');
      if (reconciledRefreshWarning) return { ...reconciled, shift: closed, resolved_authoritatively: true, refresh_warning: reconciledRefreshWarning };
      return { ...reconciled, shift: closed, resolved_authoritatively: true };
    }

    const closed = {
      ...shift,
      status: 'closed',
      closing_cash: normalizeMoney(result.counted_by_method?.cash ?? payload.counted_by_method.cash),
      closed_at: new Date().toISOString(),
      close_notes: payload.notes,
      _server_closed: true
    };
    writePosShifts([closed, ...readPosShifts().filter((row) => row.id !== shift.id)]);
    writeCache(closeAttemptCacheKey, (Array.isArray(closeAttempts) ? closeAttempts : []).filter((attempt) => attempt?.shift_id !== shift.id));
    // A persisted close attempt means this was a replay after an interrupted
    // response. The server already wrote its audit, so do not append a second
    // local close audit for that same finalized operation.
    if (!replayingExistingAttempt) {
      appendPosAudit('shift_closed', {
        entity_type: 'pos_shift',
        entity_id: shift.id,
        details: {
          cashup_id: result.cashup_id,
          expected_cash_drawer: result.expected_cash_drawer,
          variance_by_method: result.variance_by_method,
          outlet_id: shift.outlet_id || null
        }
      });
    }
    const shiftCloseRefreshWarning = await refreshPosCachesBestEffort(['pos-orders'], 'shift-close');
    return {
      success: true,
      shift: closed,
      cashup_id: result.cashup_id || closeAttempt.cashup_id,
      expected_cash_drawer: result.expected_cash_drawer,
      variance_by_method: result.variance_by_method,
      replayed: replayingExistingAttempt,
      ...(shiftCloseRefreshWarning ? { refresh_warning: shiftCloseRefreshWarning } : {})
    };
  } catch (e) {
    if (closeAttempt?.shift_id && state.supabase) {
      try {
        const resolution = await readAuthoritativeShiftClose(closeAttempt.shift_id, closeAttempt.idempotency_key);
        const reconciled = classifyAuthoritativeShiftClose(resolution, closeAttempt.idempotency_key);
        if (reconciled.success) {
          const closed = { ...(reconciled.shift || shift), status: 'closed', _server_closed: true };
          writePosShifts([closed, ...readPosShifts().filter((row) => row.id !== shift.id)]);
          writeCache(closeAttemptCacheKey, (Array.isArray(closeAttempts) ? closeAttempts : []).filter((attempt) => attempt?.shift_id !== shift.id));
          return { ...reconciled, shift: closed, resolved_authoritatively: true };
        }
      } catch { /* keep the unresolved close attempt for retry/reconciliation */ }
    }
    return { success: false, code: 'shift_close_unresolved', error: (/** @type {PosThrownMessageReadView} */ (e)).message };
  }
}

/** @returns {Promise<import('../../shared/desktopIpcContracts.js').PosHardwareSettings>} */
export async function getPosHardwareSettings() {
  return readPosHardwareSettings();
}

export async function savePosHardwareSettings(data = {}) {
  // Verification fields are written only by the trusted main-process hardware
  // test event below. Renderer-provided settings must never self-attest setup.
  const {
    hardware_last_test_at: _ignoredAt,
    hardware_last_test_kind: _ignoredKind,
    hardware_last_test_success: _ignoredSuccess,
    ...hardwareSettings
  } = data || {};
  return { success: true, settings: writePosHardwareSettings(hardwareSettings) };
}

export async function testPosHardware(kind = 'receipt') {
  const settings = readPosHardwareSettings();
  if (kind === 'drawer' && !settings.cash_drawer_enabled) {
    return { success: false, error: 'Cash drawer is not enabled in POS hardware settings.' };
  }
  if (kind === 'escpos' && !settings.escpos_enabled) {
    return { success: false, error: 'ESC/POS direct mode is not enabled yet.' };
  }
  if (kind === 'payment-terminal' && settings.payment_terminal_mode === 'manual') {
    return { success: true, kind, message: 'Payment terminal is in manual mode. Enter approval/reference numbers after charging the card machine.' };
  }
  return {
    success: true,
    kind,
    message: kind === 'drawer'
      ? 'Cash drawer test command queued. Direct drawer kick requires ESC/POS driver/device support.'
      : kind === 'escpos'
        ? 'ESC/POS test command prepared. Install a supported direct-print bridge before live drawer kicks.'
        : 'Receipt printer test is ready. Use the test receipt print button.'
  };
}

function normalizeBarcodeScannerVerification(data = {}, settings = {}) {
  const barcode = String(data.barcode || '').trim();
  const minLength = Math.max(1, Math.min(128, Number(settings.barcode_scanner_min_length) || 4));
  const maxLength = Math.max(minLength, Math.min(128, Number(settings.barcode_scanner_max_length) || 128));
  if (settings.barcode_scanner_enabled === false) return { success: false, error: 'Barcode scanner verification is disabled for this POS computer.', code: 'scanner_disabled' };
  if (!barcode) return { success: false, error: 'Scan a barcode before confirming verification.', code: 'empty_scan' };
  if (barcode.length < minLength) return { success: false, error: `The scanned barcode is too short (minimum ${minLength} characters).`, code: 'scan_too_short' };
  if (barcode.length > maxLength) return { success: false, error: `The scanned barcode is too long (maximum ${maxLength} characters).`, code: 'scan_too_long' };
  for (let index = 0; index < barcode.length; index += 1) {
    const code = barcode.charCodeAt(index);
    if (code < 32 || code === 127) return { success: false, error: 'The scanned barcode contains unsupported control characters.', code: 'invalid_characters' };
  }
  const averageInterKeyMs = Number(data.averageInterKeyMs ?? data.average_inter_key_ms);
  const characterCount = Number(data.characterCount ?? data.character_count);
  return {
    success: true,
    barcode,
    terminator: String(data.terminator || '').trim().slice(0, 32) || null,
    characterCount: Number.isFinite(characterCount) ? Math.max(0, Math.min(maxLength, Math.round(characterCount))) : barcode.length,
    averageInterKeyMs: Number.isFinite(averageInterKeyMs) ? Math.max(0, Math.min(10000, Math.round(averageInterKeyMs * 10) / 10)) : null
  };
}

/** @returns {Promise<import('../../shared/desktopIpcContracts.js').BarcodeScannerVerificationResult>} */
export async function verifyPosBarcodeScanner(data = {}) {
  const current = readPosHardwareSettings();
  const normalized = normalizeBarcodeScannerVerification(data, current);
  if (!normalized.success) return normalized;

  const verifiedAt = new Date().toISOString();
  const barcodeHash = createHash('sha256').update(normalized.barcode).digest('hex');
  const settings = writePosHardwareSettings({
    scanner_last_verified_at: verifiedAt,
    scanner_last_terminator: normalized.terminator,
    scanner_last_character_count: normalized.characterCount,
    scanner_last_average_inter_key_ms: normalized.averageInterKeyMs
  });
  appendPosAudit('barcode_scanner_verified', {
    entity_type: 'pos_hardware',
    details: {
      verification: 'keyboard_wedge_scan',
      barcode_sha256: barcodeHash,
      character_count: normalized.characterCount,
      terminator: normalized.terminator,
      average_inter_key_ms: normalized.averageInterKeyMs,
      verified_at: verifiedAt
    }
  });
  return {
    success: true,
    settings,
    verification: {
      verified_at: verifiedAt,
      character_count: normalized.characterCount,
      terminator: normalized.terminator,
      average_inter_key_ms: normalized.averageInterKeyMs
    }
  };
}

export async function recordPosHardwareEvent(action = 'hardware_event', details = {}) {
  if (action === 'hardware_test') {
    writePosHardwareSettings({
      hardware_last_test_at: new Date().toISOString(),
      hardware_last_test_kind: String(details.kind || 'receipt').slice(0, 64),
      hardware_last_test_success: details.success === true
    });
  }
  return appendPosAudit(action, {
    entity_type: details.entity_type || 'pos_hardware',
    entity_id: details.entity_id || null,
    details
  });
}

export async function recordPosAudit(action = 'pos_audit', details = {}) {
  return appendPosAudit(action, details);
}

export async function getPosStaff() {
  if (state.isOnline && state.supabase) {
    try {
      const { data, error } = await withNetworkTimeout(
        state.supabase.rpc('pos_get_safe_staff', { p_lodge_id: state.lodgeId }),
        5000,
        'Staff list'
      );
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? data : [];
      writeCache('pos-staff', rows);
      return rows;
    } catch {
      // Unlock Till must never wait on a dead network: team list comes from
      // cache and PIN checks fall back to the cached verifier below.
      const cached = readCache('pos-staff');
      return Array.isArray(cached) ? cached : [];
    }
  }
  const cached = readCache('pos-staff');
  return Array.isArray(cached) ? cached : [];
}

export async function selectPosStaffWithPin(data = {}) {
  const pin = String(data.pin || '').trim();
  const staffRows = await getPosStaff();
  const staff = staffRows.find((user) => user.id === data.staff_id);
  if (!staff) return { success: false, error: 'Staff member not found.' };
  if (!staff.has_pin) return { success: false, error: 'This staff member does not have a POS PIN set.' };
  if (!pin) return { success: false, error: 'Staff PIN is required.' };
  if (!state.isOnline || !state.supabase) {
    const verified = validateCachedPosPin(staff.id, pin);
    if (!verified.success) return verified;
    appendPosAudit('staff_selected_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
    return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
  }
  let result = null;
  let error = null;
  try {
    const response = await withNetworkTimeout(
      state.supabase.rpc('pos_validate_pin', {
        p_lodge_id: state.lodgeId,
        p_staff_id: staff.id,
        p_pin: pin,
        p_required_capability: 'pos.manage',
        p_device_id: getDesktopPosDeviceId()
      }),
      undefined,
      'Staff PIN check'
    ).catch((transportError) => {
      // A dead network must not trap the Till at unlock: fall back to the
      // cached PIN verifier exactly as the offline path does below.
      if (isPosPinTransportFailure(transportError)) {
        return { data: { timedOut: true }, error: null };
      }
      throw transportError;
    });
    result = response?.data ?? null;
    error = response?.error ?? null;
  } catch (transportError) {
    if (isPosPinTransportFailure(transportError)) {
      const verified = validateCachedPosPin(staff.id, pin);
      if (!verified.success) return verified;
      appendPosAudit('staff_selected_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
      return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
    }
    throw transportError;
  }
  if (error && isPosPinTransportFailure(error)) {
    const verified = validateCachedPosPin(staff.id, pin);
    if (!verified.success) return verified;
    appendPosAudit('staff_selected_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
    return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
  }
  if (error) throw new Error(error.message);
  if (result?.timedOut || result === null) {
    const verified = validateCachedPosPin(staff.id, pin);
    if (!verified.success) return verified;
    appendPosAudit('staff_selected_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
    return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
  }
  if (!result?.success) return withOperatorPinResult({ success: false, error: result?.error || 'Incorrect staff PIN.' });
  appendPosAudit('staff_selected', {
    staff_id: result.staff?.id,
    staff_name: result.staff?.name,
    entity_type: 'pos_staff'
  });
  return result;
}

/**
 * Verify a manager PIN to unlock the Manage workspace (Stock, Cash & close,
 * Sales and the hub itself). Server-enforced via pos_validate_pin with the
 * manager-only pos.menu_manage capability (the server's PIN capability
 * allowlist in 20260618210000 only knows pos.* / sync.manage /
 * settings.manage_general — staff.manage is unknown there and would reject
 * every PIN); offline falls back to the cached PIN verifier with a
 * manager-only role check. Supervisors and cashiers can never unlock, even
 * with a correct PIN — the server capability check and the offline role check
 * both fail closed. Audit-logged either way on success.
 */
export async function verifyManagerPinForManage(data = {}) {
  const pin = String(data.pin || '').trim();
  const staffId = String(data.staff_id || '').trim();
  if (!staffId) return { success: false, error: 'Staff session is required to unlock Manage.' };
  if (!pin) return { success: false, error: 'Manager PIN is required.' };
  const staffRows = await getPosStaff();
  const staff = staffRows.find((user) => user.id === staffId);
  if (!staff) return { success: false, error: 'Staff member not found.' };
  if (!staff.has_pin) return { success: false, error: 'This staff member does not have a POS PIN set.' };
  if (!state.isOnline || !state.supabase) {
    const verified = validateCachedPosPin(staff.id, pin, { manager: true });
    if (!verified.success) return verified;
    const role = String(verified.staff?.role || staff.role || '').toLowerCase();
    if (!MANAGER_MANAGE_UNLOCK_ROLES.includes(role)) {
      return { success: false, error: 'A manager PIN is required to open Manage.' };
    }
    appendPosAudit('manager_manage_unlocked_offline', { staff_id: staff.id, staff_name: staff.name, entity_type: 'pos_staff' });
    return { success: true, staff: { ...staff, ...verified.staff }, offline: true, provisional: true };
  }
  let result = null;
  let error = null;
  try {
    const response = await withNetworkTimeout(
      state.supabase.rpc('pos_validate_pin', {
        p_lodge_id: state.lodgeId,
        p_staff_id: staff.id,
        p_pin: pin,
        p_required_capability: 'pos.menu_manage',
        p_device_id: getDesktopPosDeviceId()
      }),
      undefined,
      'Manager PIN check'
    ).catch((transportError) => {
      // Offline-first Manage unlock: a dead network (fetch failed, abort,
      // timeout) falls back to the trusted cached PIN verifier. Any other
      // failure rethrows and fails closed below.
      if (isPosPinTransportFailure(transportError)) {
        return { data: { timedOut: true }, error: null };
      }
      throw transportError;
    });
    result = response?.data ?? null;
    error = response?.error ?? null;
  } catch (transportError) {
    if (isPosPinTransportFailure(transportError)) {
      return resolveOfflineManageUnlock(staff, pin);
    }
    throw transportError;
  }
  if (error && isPosPinTransportFailure(error)) {
    return resolveOfflineManageUnlock(staff, pin);
  }
  if (error) throw new Error(error.message);
  if (result?.timedOut || result === null) {
    return resolveOfflineManageUnlock(staff, pin);
  }
  if (!result?.success) return { success: false, error: result?.error || 'Invalid PIN or unauthorized staff member' };
  appendPosAudit('manager_manage_unlocked', {
    staff_id: result.staff?.id,
    staff_name: result.staff?.name,
    entity_type: 'pos_staff'
  });
  return result;
}

export async function getPosModifierGroups() {
  if (state.isOnline && state.supabase) {
    try {
      // Supabase list results have the expected data/error envelope here; row
      // contents remain unvalidated and are written through unchanged.
      const { data, error } = /** @type {{data: unknown[] | null, error: {message: string} | null}} */ (await withNetworkTimeout(state.supabase
        .from('pos_modifier_groups')
        .select('id, lodge_id, name, applies_to_categories, min_selections, max_selections, options, active, updated_at')
        .eq('lodge_id', state.lodgeId)
        .order('name'), 5000, 'Modifier options'));
      if (error) throw new Error(error.message);
      writePosModifierGroups(data || []);
      return data || [];
    } catch (error) {
      // The Till loads these right after menu/stock/team; a stalled network
      // must fall back to the saved options instead of hanging the Till.
      console.warn('[POS] Modifier groups falling back to cache:', (/** @type {{message?: unknown} | null | undefined} */ (error))?.message || error);
      return readPosModifierGroups();
    }
  }
  return readPosModifierGroups();
}

/**
 * Renderer forms send partial modifier-group fields; the domain preserves its
 * existing coercions and array checks. These values are expected-data views,
 * not IPC validation.
 * @typedef {Partial<{id: unknown, name: unknown, applies_to_categories: unknown, options: unknown, min_selections: unknown, max_selections: unknown, active: unknown}>} PosModifierGroupSaveInputExpectedData
 * @typedef {{id?: unknown, name?: unknown, price_delta?: unknown}} PosModifierOptionSaveInputExpectedData
 * @typedef {{id?: unknown}} PosModifierGroupCacheIdReadView
 */

/** @param {PosModifierGroupSaveInputExpectedData} [data] */
export async function savePosModifierGroup(data = {}) {
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    name: String(data.name || '').trim(),
    applies_to_categories: Array.isArray(data.applies_to_categories) ? data.applies_to_categories : [],
    options: Array.isArray(data.options) ? data.options.map((/** @type {unknown} */ option) => ({
      id: (/** @type {PosModifierOptionSaveInputExpectedData} */ (option)).id || randomUUID(),
      name: String((/** @type {PosModifierOptionSaveInputExpectedData} */ (option)).name || '').trim(),
      price_delta: normalizeMoney((/** @type {PosModifierOptionSaveInputExpectedData} */ (option)).price_delta || 0)
    })).filter((option) => option.name) : [],
    min_selections: Math.max(0, Number(data.min_selections || 0)),
    max_selections: Math.max(0, Number(data.max_selections || 0)),
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  if (!row.name) return { success: false, error: 'Modifier group name is required.' };
  if (!state.isOnline || !state.supabase) {
    const rows = [row, .../** @type {PosModifierGroupCacheIdReadView[]} */ (readPosModifierGroups()).filter((entry) => entry.id !== row.id)];
    writePosModifierGroups(rows);
    const queueId = `pos-modifier-groups-${row.id}-${Date.now()}`;
    queueOperation('rpc', 'upsert_pos_modifier_groups', { payload: { lodge_id: state.lodgeId, groups: rows } }, null, { _queue_id: queueId });
    const snapshot = queueLocalPosCatalogSnapshot(null, queueId);
    appendPosAudit('modifier_group_saved_offline', { entity_type: 'pos_modifier_group', entity_id: row.id, details: row });
    return { success: true, group: { ...row, _pending_sync: true }, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
  }
  const rows = [row, .../** @type {PosModifierGroupCacheIdReadView[]} */ (readPosModifierGroups()).filter((entry) => entry.id !== row.id)];
  const { data: result, error } = await state.supabase.rpc('upsert_pos_modifier_groups', {
    payload: { lodge_id: state.lodgeId, groups: rows }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Could not save modifier group.' };
  writePosModifierGroups(rows);
  await publishPosCatalogSnapshotsForChange([null]);
  appendPosAudit('modifier_group_saved', { entity_type: 'pos_modifier_group', entity_id: row.id, details: row });
  return { success: true, group: row };
}

export async function getPosPromotions() {
  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase
      .from('pos_promotions')
      .select('id, lodge_id, name, discount_type, discount_value, applies_to_category, active, starts_at, ends_at, minimum_spend, customer_segment, updated_at')
      .eq('lodge_id', state.lodgeId)
      .order('name');
    if (error) throw new Error(error.message);
    writePosPromotions(data || []);
    return data || [];
  }
  return readPosPromotions();
}

/**
 * Renderer promotion forms send partial fields. Values remain unknown until
 * the existing normalization/coercion expressions handle them.
 * @typedef {Partial<{id: unknown, name: unknown, discount_type: unknown, discount_value: unknown, applies_to_category: unknown, active: unknown, starts_at: unknown, ends_at: unknown, minimum_spend: unknown, customer_segment: unknown}>} PosPromotionSaveInputExpectedData
 * @typedef {{id?: unknown}} PosPromotionCacheIdReadView
 */

/** @param {PosPromotionSaveInputExpectedData} [data] */
export async function savePosPromotion(data = {}) {
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    name: String(data.name || '').trim(),
    discount_type: data.discount_type === 'percent' ? 'percent' : 'amount',
    discount_value: normalizeMoney(data.discount_value || 0),
    applies_to_category: String(data.applies_to_category || '').trim() || 'All',
    active: data.active !== false,
    starts_at: data.starts_at || null,
    ends_at: data.ends_at || null,
    minimum_spend: normalizeMoney(data.minimum_spend || 0),
    customer_segment: String(data.customer_segment || '').trim() || null,
    updated_at: new Date().toISOString()
  };
  if (!row.name) return { success: false, error: 'Promotion name is required.' };
  if (!(row.discount_value > 0)) return { success: false, error: 'Promotion discount must be above zero.' };
  if (!state.isOnline || !state.supabase) {
    const rows = [row, .../** @type {PosPromotionCacheIdReadView[]} */ (readPosPromotions()).filter((entry) => entry.id !== row.id)];
    writePosPromotions(rows);
    const queueId = `pos-promotions-${row.id}-${Date.now()}`;
    queueOperation('rpc', 'upsert_pos_promotions', { payload: { lodge_id: state.lodgeId, promotions: rows } }, null, { _queue_id: queueId });
    const snapshot = queueLocalPosCatalogSnapshot(null, queueId);
    appendPosAudit('promotion_saved_offline', { entity_type: 'pos_promotion', entity_id: row.id, details: row });
    return { success: true, promotion: { ...row, _pending_sync: true }, offline: true, queued: true, catalog_snapshot_id: snapshot.snapshot_id };
  }
  const rows = [row, .../** @type {PosPromotionCacheIdReadView[]} */ (readPosPromotions()).filter((entry) => entry.id !== row.id)];
  const { data: result, error } = await state.supabase.rpc('upsert_pos_promotions', {
    payload: { lodge_id: state.lodgeId, promotions: rows }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Could not save promotion.' };
  writePosPromotions(rows);
  await publishPosCatalogSnapshotsForChange([null]);
  appendPosAudit('promotion_saved', { entity_type: 'pos_promotion', entity_id: row.id, details: row });
  return { success: true, promotion: row };
}

export async function getPosFloorLayout() {
  return readPosFloorLayout();
}

export async function savePosFloorLayout(layout = {}) {
  const saved = writePosFloorLayout(layout);
  appendPosAudit('floor_layout_saved', { entity_type: 'pos_floor_layout', details: saved });
  return { success: true, layout: saved };
}

export async function updatePosCustomerDisplay(snapshot = {}) {
  const saved = writeCustomerDisplaySnapshot(snapshot);
  return { success: true, display: saved };
}

export async function getPosCustomerDisplay() {
  const value = readCache('pos-customer-display');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function sendPaymentTerminalTotal(data = {}) {
  const settings = readPosHardwareSettings();
  appendPosAudit('payment_terminal_send_total', {
    entity_type: 'payment_terminal',
    details: {
      provider: settings.payment_terminal_provider || null,
      mode: settings.payment_terminal_mode || 'manual',
      amount: normalizeMoney(data.amount || 0),
      reference: data.reference || null
    }
  });
  if (!settings.payment_terminal_provider || settings.payment_terminal_mode === 'manual') {
    return {
      success: false,
      manual: true,
      error: 'No live payment terminal integration is configured. Charge the card machine manually and enter the approval code.'
    };
  }
  return {
    success: false,
    error: `Provider ${settings.payment_terminal_provider} is saved, but its device API is not connected in this build.`
  };
}

export async function getPosAuditLog(limit = 100) {
  return readPosAuditLog().slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
}

/** Expected POS report query/cache projections; these views do not validate RPC or persisted rows. */
/** @typedef {PosOrderExpectedData & {id: string, created_at: unknown, status?: string|null, outlet_id?: string|null, total?: unknown, gross_total?: unknown, discount_total?: unknown, tax_total?: unknown, tip_total?: unknown, payment_method?: string|null, payment_breakdown?: unknown, cashier_name?: string|null, cashier_id?: string|null, pos_order_items?: PosRevenueOrderItemExpectedData[]}} PosRevenueOrderExpectedData */
/** @typedef {Record<string, unknown> & {order_id: string, menu_item_id: string|null, inventory_item_id: string|null, item_name: string, quantity: unknown, subtotal: unknown}} PosRevenueOrderItemExpectedData */
/** @typedef {Record<string, unknown> & {id: string, name: string, inventory_item_id?: string|null, depletion_qty?: unknown, template_kind?: string|null, template_pack_size?: unknown}} PosRevenueMenuItemExpectedData */
/** @typedef {Record<string, unknown> & {id: string, name: string, latest_unit_cost?: unknown}} PosRevenueInventoryItemExpectedData */
/** Expected arguments forwarded by `reports:posSales`; IPC values are not runtime-validated here.
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} [outletId]
 */
export async function getPosRevenueSummary(startDate, endDate, outletId = 'all') {
  if (state.isOnline) {
    try {
      const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_pos_sales_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_outlet_selector: outletId || 'all'
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        if (data.complete === true && data.financial_truth === 'server_confirmed') {
          return { ...data, source: 'server', complete: true, financial_truth: 'server_confirmed', as_of_range: { start: startDate, end: endDate }, outlet_selector: outletId || 'all' };
        }

        // The historical summary RPC does not carry a certification envelope
        // and older versions synthesized tenders from payment_method. Never
        // promote that response to a financial report. Use the report-run
        // export contract when the filter can be represented by its UUID API.
        if (outletId !== 'unassigned') {
          try {
            const { data: exportResponse, error: exportError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_pos_financial_report_export_v2', {
              p_lodge_id: state.lodgeId,
              p_start_date: startDate,
              p_end_date: endDate,
              p_outlet_id: outletId && outletId !== 'all' ? outletId : null
            });
            if (exportError) throw exportError;
            // Expected response view from the report RPC wrapper; certification checks below remain the runtime gate.
            const envelope = /** @type {PosCertifiedRevenueExportEnvelope} */ (exportResponse?.data || exportResponse);
            if (envelope?.dataset_status === 'certified' && envelope?.source_coverage_complete === true) {
              return buildCertifiedPosRevenueSummary(envelope, startDate, endDate, outletId || 'all');
            }
            return {
              source: 'server',
              complete: false,
              financial_truth: 'server_incomplete',
              dataset_status: envelope?.dataset_status || 'incomplete',
              unresolved_rows: envelope?.row_count ?? null,
              unresolved_status_rows: envelope?.source_manifest?.unresolved_status_rows ?? null,
              unresolved_amount_rows: envelope?.source_manifest?.unresolved_amount_rows ?? null,
              unresolved_tender_rows: envelope?.source_manifest?.unresolved_tender_rows ?? null,
              unresolved_item_rows: envelope?.source_manifest?.unresolved_item_rows ?? null,
              as_of_range: { start: startDate, end: endDate },
              outlet_selector: outletId || 'all'
            };
          } catch (exportError) {
            recordCriticalError('reports.pos_sales.authoritative_export', exportError, {
              startDate,
              endDate,
              outletId: outletId || 'all'
            }, { level: 'warn', limit: 120 });
          }
        }
      }
      throw new Error('POS sales summary was empty.');
    } catch (error) {
      recordCriticalError('reports.pos_sales', error, {
        startDate,
        endDate,
        outletId: outletId || 'all',
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  // Preserve the existing direct .filter receiver behavior for malformed cache values.
  const cachedOrders = /** @type {PosRevenueOrderExpectedData[]} */ (readCache('pos-orders')).filter((order) => {
    const createdAt = String(order.created_at || '');
    const orderDate = createdAt.split('T')[0];
    return (
      (order.status || '') === 'completed' && (
      !startDate || orderDate >= startDate) && (
      !endDate || orderDate <= endDate) && (

      !outletId ||
      outletId === 'all' || (
      outletId === 'unassigned' ? !order.outlet_id : order.outlet_id === outletId)));


  });
  /** @type {PosRevenueOrderExpectedData[]} */
  let orders = [];
  /** @type {PosRevenueMenuItemExpectedData[]} */
  let currentMenuItems = [];
  /** @type {Map<string, string>} */
  let inventoryNameMap = new Map();

  try {
    let posQuery = state.supabase.
    from('pos_orders').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('status', 'completed').
    gte('created_at', `${startDate}T00:00:00`).
    lte('created_at', `${endDate}T23:59:59`);
    if (outletId && outletId !== 'all') {
      if (outletId === 'unassigned') posQuery = posQuery.is('outlet_id', null);else
      posQuery = posQuery.eq('outlet_id', outletId);
    }
    const { data: liveOrders, error: ordersError } = await posQuery;
    if (ordersError) throw ordersError;
    const fetchedOrders = /** @type {PosRevenueOrderExpectedData[]} */ ((liveOrders || []).length === 0 && cachedOrders.length > 0 ?
    cachedOrders :
    liveOrders || []);

    // Write online results to cache so offline fallback stays fresh
    if ((liveOrders || []).length > 0) {
      writeCache('pos-orders', liveOrders);
    }

    // Fetch order items separately — failure here only affects top_items, not revenue totals
    /** @type {PosRevenueOrderItemExpectedData[]} */
    let liveItems = [];
    const orderIds = fetchedOrders.map((o) => o.id).filter(Boolean);
    if (orderIds.length > 0) {
      const { data: itemRows, error: itemsError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
      from('pos_order_items').
      select('order_id, menu_item_id, inventory_item_id, depletion_qty, item_name, quantity, unit_price, subtotal').
      in('order_id', orderIds);
      if (!itemsError) liveItems = /** @type {PosRevenueOrderItemExpectedData[]} */ (itemRows || []);
    }
    // Attach items back onto each order
    /** @type {Record<string, PosRevenueOrderItemExpectedData[]>} */
    const itemsByOrder = {};
    for (const item of liveItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }
    orders = fetchedOrders.map((o) => ({ ...o, pos_order_items: itemsByOrder[o.id] || o.pos_order_items || [] }));

    const { data: liveMenuItems, error: menuError } = await state.supabase.
    from('pos_menu_items').
    select('id, name, inventory_item_id, depletion_qty, template_kind, template_pack_size, kitchen_station_id').
    eq('lodge_id', state.lodgeId);
    if (menuError) throw menuError;
    currentMenuItems = /** @type {PosRevenueMenuItemExpectedData[]} */ ((liveMenuItems || []).length === 0 ?
    readCache('pos-menu-items') :
    liveMenuItems || []);

    const inventoryIds = [...new Set(
      currentMenuItems.
      map((item) => item.inventory_item_id).
      filter(Boolean)
    )];
    if (inventoryIds.length > 0) {
      const { data: inventoryRows, error: inventoryError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
      from('inventory_items').
      select('id, name').
      eq('lodge_id', state.lodgeId).
      in('id', inventoryIds);
      if (inventoryError) throw inventoryError;
      inventoryNameMap = new Map(/** @type {PosRevenueInventoryItemExpectedData[]} */ (inventoryRows || []).map((row) => [row.id, row.name]));
    }
  } catch (error) {
    orders = cachedOrders;
    currentMenuItems = /** @type {PosRevenueMenuItemExpectedData[]} */ (readCache('pos-menu-items'));
    const inventoryRows = /** @type {PosRevenueInventoryItemExpectedData[]} */ (readCache('inventory-items'));
    inventoryNameMap = new Map((inventoryRows || []).map((row) => [row.id, row.name]));
    if (!orders.length && !currentMenuItems.length && state.isOnline) {
      throw new Error((/** @type {PosThrownMessageReadView} */ (error))?.message || 'Failed to load POS revenue summary');
    }
  }

  const menuItemMap = new Map((currentMenuItems || []).map((item) => [item.id, item]));

  const total_revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const gross_revenue = orders.reduce((s, o) => s + normalizeMoney(o.gross_total ?? (Number(o.total || 0) > 0 ? Number(o.total || 0) : 0)), 0);
  const discount_total = orders.reduce((s, o) => s + normalizeMoney(o.discount_total || 0), 0);
  const tax_total = orders.reduce((s, o) => s + normalizeMoney(o.tax_total || 0), 0);
  const tip_total = orders.reduce((s, o) => s + normalizeMoney(o.tip_total || 0), 0);
  const returns_total = orders.reduce((s, o) => s + (Number(o.total || 0) < 0 ? Math.abs(Number(o.total || 0)) : 0), 0);
  const folio_revenue = orders.reduce(
    (sum, order) => sum + ((order.payment_method || '') === 'folio' ? Number(order.total || 0) : 0),
    0
  );
  const direct_revenue = total_revenue - folio_revenue;
  const total_orders = orders.length;
  const avg_order = total_orders > 0 ? total_revenue / total_orders : 0;

  // Breakdown by payment method
  /** @type {Record<string, number>} */
  const by_payment = {};
  for (const o of orders) {
    for (const payment of getOrderPaymentRows(o)) {
      by_payment[payment.method] = normalizeMoney((by_payment[payment.method] || 0) + Number(payment.amount || 0));
    }
  }

  /** @type {Record<string, number>} */
  const by_cashier = {};
  for (const o of orders) {
    const key = o.cashier_name || o.cashier_id || 'Unassigned';
    by_cashier[key] = normalizeMoney((by_cashier[key] || 0) + Number(o.total || 0));
  }

  // Top items aggregated across all line items
  /** @type {Record<string, PosRevenueItemAggregate>} */
  const itemMap = {};
  for (const o of orders) {
    for (const li of o.pos_order_items || []) {
      const menuItem = menuItemMap.get(li.menu_item_id);
      const depletionQty = Number(
        menuItem?.template_pack_size ||
        menuItem?.depletion_qty ||
        1
      );
      const quantity = Number(li.quantity || 0);
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      const menuItemName = menuItem?.name || li.item_name;
      const itemName = menuItem?.inventory_item_id ?
      inventoryNameMap.get(menuItem.inventory_item_id) || menuItemName :
      menuItemName;

      if (!itemMap[itemName]) itemMap[itemName] = { name: itemName, qty: 0, revenue: 0 };
      itemMap[itemName].qty += quantity * depletionQty;
      itemMap[itemName].revenue += Number(li.subtotal || 0);
      const inventoryId = li.inventory_item_id || menuItem?.inventory_item_id || null;
      if (inventoryId) {
        const inventoryCost = Number((/** @type {PosRevenueInventoryItemExpectedData[]} */ (readCache('inventory-items') || [])).find((item) => item.id === inventoryId)?.latest_unit_cost || 0);
        itemMap[itemName].cost = Number(itemMap[itemName].cost || 0) + Math.max(0, quantity) * depletionQty * inventoryCost;
        itemMap[itemName].margin = Number(itemMap[itemName].revenue || 0) - Number(itemMap[itemName].cost || 0);
      }
    }
  }
  const top_items = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15);

  // Daily totals
  /** @type {Record<string, number>} */
  const dailyMap = {};
  for (const o of orders) {
    const date = (o.created_at || '').split('T')[0];
    if (date) dailyMap[date] = (dailyMap[date] || 0) + Number(o.total || 0);
  }
  const daily = Object.entries(dailyMap).
  map(([date, total]) => ({ date, total })).
  sort((a, b) => a.date.localeCompare(b.date));

  return {
    total_revenue,
    gross_revenue,
    discount_total,
    returns_total,
    tax_total,
    tip_total,
    net_revenue: total_revenue,
    folio_revenue,
    direct_revenue,
    total_orders,
    avg_order,
    by_payment,
    by_cashier,
    top_items,
    daily,
    source: 'local',
    complete: false,
    financial_truth: 'cache_estimate',
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  };
}

// ── Restaurant Recipes ──────────────────────────────────────────────────────

const POS_RECIPE_CACHE_KEY = 'pos-recipes';

function readPosRecipes() {
  const rows = readCache(POS_RECIPE_CACHE_KEY);
  return Array.isArray(rows) ? rows : [];
}

function writePosRecipes(rows = []) {
  writeCache(POS_RECIPE_CACHE_KEY, rows.slice(0, 1000));
}

export async function getPosRecipes() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('get_restaurant_recipes', {
        p_lodge_id: state.lodgeId
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        writePosRecipes(data);
        return data;
      }
    } catch (error) {
      console.warn('[POS RECIPES] Remote recipe refresh unavailable:', error?.message || error);
    }
  }
  return readPosRecipes();
}

export async function savePosRecipe(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) return { success: false, error: 'Recipe name is required.' };
  if (!state.cacheDir) return { success: false, error: 'Choose a lodge profile before saving recipes.' };
  ensureDir(state.cacheDir);

  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Recipe changes require an internet connection.' };
  }

  const ingredients = Array.isArray(data.ingredients) ? data.ingredients.map((ing) => ({
    id: ing.id || randomUUID(),
    inventory_item_id: ing.inventory_item_id,
    quantity: Number(ing.quantity || 0),
    unit: String(ing.unit || 'each').trim(),
    waste_percent: Math.max(0, Number(ing.waste_percent || 0)),
    sort_order: Number(ing.sort_order || 0)
  })).filter((ing) => ing.inventory_item_id && ing.quantity > 0) : [];

  const payload = {
    lodge_id: state.lodgeId,
    recipe_id: data.id || undefined,
    menu_item_id: data.menu_item_id || undefined,
    name,
    version: Number(data.version || 1),
    serving_size: Number(data.serving_size || 1),
    active: data.active !== false,
    ingredients
  };

  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_recipe', {
      payload
    });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not save recipe.' };

    const recipe = {
      id: result.recipe_id || data.id || randomUUID(),
      lodge_id: state.lodgeId,
      menu_item_id: data.menu_item_id || null,
      name,
      version: Number(data.version || 1),
      serving_size: Number(data.serving_size || 1),
      active: data.active !== false,
      ingredients,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const cached = readPosRecipes();
    const idx = cached.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...recipe };
    } else {
      cached.unshift(recipe);
    }
    writePosRecipes(cached);

    appendPosAudit('recipe_saved', { entity_type: 'restaurant_recipe', entity_id: recipe.id, details: { name } });
    return { success: true, recipe };
  } catch (error) {
    throw error;
  }
}

export async function deletePosRecipe(recipeId) {
  if (!recipeId) return { success: false, error: 'Recipe ID is required.' };
  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Recipe deletion requires an internet connection.' };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('delete_restaurant_recipe', {
      p_recipe_id: recipeId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not delete recipe.' };

    const cached = readPosRecipes().filter((r) => r.id !== recipeId);
    writePosRecipes(cached);

    appendPosAudit('recipe_deleted', { entity_type: 'restaurant_recipe', entity_id: recipeId });
    return { success: true };
  } catch (error) {
    throw error;
  }
}

export async function recordRecipeStockDepletion(orderId, items = [], outletId = null) {
  if (!orderId || !Array.isArray(items) || items.length === 0) return { success: true, movements_created: 0 };

  if (!state.isOnline || !state.supabase) {
    // Offline: depletion is queued as dependent operation in createPosOrder
    console.warn('[POS RECIPES] Stock depletion queued for offline replay:', orderId);
    return { success: true, movements_created: 0, queued: true };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('record_recipe_stock_depletion', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId,
        outlet_id: outletId,
        items: items.map((item) => ({
          menu_item_id: item.menu_item_id || null,
          order_item_id: item.id || null,
          quantity: Number(item.quantity || 1)
        }))
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: true, movements_created: 0 };
  } catch (error) {
    console.error('[POS RECIPES] Stock depletion failed:', error?.message || error);
    throw error;
  }
}

// ── Phase 4: Customer & Growth ──────────────────────────────

const CUSTOMERS_CACHE_KEY = 'pos-customers';

function readCachedCustomers() {
  return readCache(CUSTOMERS_CACHE_KEY);
}

function writeCachedCustomers(customers) {
  writeCache(CUSTOMERS_CACHE_KEY, customers);
}

export async function getPosCustomers() {
  if (!state.isOnline || !state.supabase) return readCachedCustomers();

  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_customer_account_dto', {
      p_lodge_id: state.lodgeId,
      p_customer_id: null
    });
    if (error) throw new Error(error.message);
    const customers = (Array.isArray(data) ? data : []).map((row) => ({
      ...row,
      // Compatibility for older terminal renderers. New code must use the
      // explicitly named DTO fields below.
      account_balance: Number(row.outstanding_balance || 0)
    }));
    writeCachedCustomers(customers);
    return customers;
  } catch (error) {
    // Older deployments may not yet have the DTO migration. Keep the read
    // compatible, but never relabel outstanding debt as available credit.
    try {
      const { data, error: fallbackError } = await state.supabase.rpc('get_restaurant_customers', {
        p_lodge_id: state.lodgeId
      });
      if (fallbackError) throw fallbackError;
      const customers = (Array.isArray(data) ? data : []).map((row) => ({
        ...row,
        outstanding_balance: Number(row.outstanding_balance ?? row.account_balance ?? 0),
        credit_limit: Number(row.credit_limit || 0),
        available_credit: Math.max(0, Number(row.credit_limit || 0) - Number(row.outstanding_balance ?? row.account_balance ?? 0)),
        account_status: row.account_status || 'active',
        account_balance: Number(row.outstanding_balance ?? row.account_balance ?? 0)
      }));
      writeCachedCustomers(customers);
      return customers;
    } catch (fallbackError) {
      console.error('[POS CUSTOMERS] Load failed:', error?.message || fallbackError?.message || fallbackError);
      return readCachedCustomers();
    }
  }
}

export async function savePosCustomer(customerData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save customer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_customer', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerData.id || null,
        name: customerData.name,
        email: customerData.email || null,
        phone: customerData.phone || null,
        notes: customerData.notes || null,
        marketing_opt_in: customerData.marketing_opt_in || false
      }
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Failed to save customer');

    appendPosAudit('customer_saved', { entity_type: 'restaurant_customer', entity_id: result.customer_id });
    return result;
  } catch (error) {
    console.error('[POS CUSTOMERS] Save failed:', error?.message || error);
    throw error;
  }
}

export async function awardLoyaltyPoints({ customerId, orderId, points, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot award loyalty offline');

  try {
    const { data: result, error } = await state.supabase.rpc('award_restaurant_loyalty', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        points,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS LOYALTY] Award failed:', error?.message || error);
    throw error;
  }
}

export async function queueLoyaltyRepair({ customerId, orderId, points, description, operationId }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot queue loyalty repair offline');
  const { data: result, error } = await state.supabase.rpc('queue_restaurant_loyalty_repair', {
    payload: {
      lodge_id: state.lodgeId,
      customer_id: customerId,
      order_id: orderId || null,
      points,
      description: description || null,
      operation_id: operationId
    }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not queue loyalty repair');
  return result;
}

export async function redeemLoyaltyPoints({ customerId, orderId, points, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot redeem loyalty offline');

  try {
    const { data: result, error } = await state.supabase.rpc('redeem_restaurant_loyalty', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        points,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS LOYALTY] Redeem failed:', error?.message || error);
    throw error;
  }
}

export async function chargeCustomerAccount({ customerId, orderId, amount, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot charge account offline');

  try {
    const { data: result, error } = await state.supabase.rpc('charge_restaurant_account', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        amount,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ACCOUNT] Charge failed:', error?.message || error);
    throw error;
  }
}

export async function redeemVoucher(code, amount) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot redeem voucher offline');

  try {
    const { data: result, error } = await state.supabase.rpc('redeem_restaurant_voucher', {
      payload: {
        lodge_id: state.lodgeId,
        code,
        amount
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS VOUCHER] Redeem failed:', error?.message || error);
    throw error;
  }
}

export async function recordDelivery(deliveryData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record delivery offline');

  try {
    const { data: result, error } = await state.supabase.rpc('record_restaurant_delivery', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: deliveryData.order_id || null,
        customer_id: deliveryData.customer_id || null,
        platform: deliveryData.platform || null,
        platform_commission: deliveryData.platform_commission || 0,
        platform_order_id: deliveryData.platform_order_id || null,
        delivery_fee: deliveryData.delivery_fee || 0,
        driver_name: deliveryData.driver_name || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS DELIVERY] Record failed:', error?.message || error);
    throw error;
  }
}

// ── Phase 5: Restaurant Operating System ─────────────────────

export async function clockInStaff({ staff_user_id, staffUserId, role, expected_hours, expectedHours, idempotency_key, idempotencyKey } = {}) {
  const resolvedStaffId = staff_user_id || staffUserId || null;
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  if (!state.isOnline || !state.supabase) {
    const staff = getCachedPosUser(resolvedStaffId);
    if (!staff || String(staff.status || 'active').toLowerCase() !== 'active') return { success: false, error: 'Active staff member not found in the offline cache.' };
    const existing = readAttendanceShifts().find((row) => row.staff_user_id === resolvedStaffId && row.status === 'active');
    if (existing) return { success: true, shift_id: existing.id, already_active: true, offline: true };
    const shiftId = randomUUID();
    const queueId = `attendance-shift-${shiftId}`;
    upsertAttendanceShift({
      id: shiftId, lodge_id: state.lodgeId, staff_user_id: resolvedStaffId,
      staff_name: staff.name || staff.email, role: role || 'cashier', expected_hours: expected_hours ?? expectedHours ?? null,
      clock_in: new Date().toISOString(), status: 'active', idempotency_key: resolvedKey,
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'clock_in_staff_offline', { payload: {
      lodge_id: state.lodgeId, shift_id: shiftId, staff_user_id: resolvedStaffId,
      role: role || 'cashier', expected_hours: expected_hours ?? expectedHours ?? null, idempotency_key: resolvedKey
    } }, null, { _queue_id: queueId });
    return { success: true, shift_id: shiftId, offline: true, queued: true, provisional: true };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('clock_in_staff', {
      payload: {
        lodge_id: state.lodgeId,
        staff_user_id: staff_user_id || staffUserId || null,
        role: role || 'cashier',
        expected_hours: expected_hours ?? expectedHours ?? null,
        idempotency_key: idempotency_key || idempotencyKey || randomUUID()
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS STAFF] Clock in failed:', error?.message || error);
    throw error;
  }
}

/** @param {PosAttendancePinClockInRequest} [request] */
export async function clockInStaffWithAttendancePin({ staff_user_id, staffUserId, pin, role, expected_hours, expectedHours, idempotency_key, idempotencyKey } = {}) {
  const resolvedStaffId = staff_user_id || staffUserId || null;
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  if (!state.isOnline || !state.supabase) {
    const verified = validateCachedPosPin(resolvedStaffId, pin);
    if (!verified.success) return verified;
    const existing = readAttendanceShifts().find((row) => row.staff_user_id === resolvedStaffId && row.status === 'active');
    if (existing) return { success: true, shift_id: existing.id, already_active: true, offline: true };
    // Guardrail: an optimistic local clock-out still pending sync means the
    // server still holds this staff member active. Queuing a new clock-in
    // would dead-letter with "already has an active shift".
    try {
      const queue = /** @type {PosStaffShiftQueueExpectedData[]} */ (readSyncQueue() || []);
      const pendingClockOut = queue.find((item) =>
        item?.table === 'clock_out_staff_with_attendance_pin' &&
        String(item?.data?.payload?.lodge_id || '') === String(state.lodgeId || '')
      ) || null;
      if (pendingClockOut) {
        const pendingShiftId = String(pendingClockOut?.data?.payload?.shift_id || '');
        const pendingShift = pendingShiftId ? readAttendanceShifts().find((row) => String(row?.id || '') === pendingShiftId) : null;
        if (pendingShift && String(pendingShift?.staff_user_id || '') === String(resolvedStaffId || '')) {
          return { success: false, code: 'clockout_pending', error: 'A clock-out for this staff member is still syncing. Wait for sync before clocking in again.' };
        }
      }
      const pendingClockIn = queue.find((item) =>
        (item?.table === 'clock_in_staff_with_attendance_pin_offline' || item?.table === 'clock_in_staff_offline') &&
        String(item?.data?.payload?.staff_user_id || '') === String(resolvedStaffId || '')
      ) || null;
      if (pendingClockIn?.data?.payload?.shift_id) {
        return { success: true, shift_id: pendingClockIn.data.payload.shift_id, already_active: true, offline: true, queued: true, provisional: true };
      }
    } catch {
      /* Queue guard is best-effort; fall through to normal offline clock-in. */
    }
    const shiftId = randomUUID();
    const queueId = `attendance-shift-${shiftId}`;
    upsertAttendanceShift({
      id: shiftId, lodge_id: state.lodgeId, staff_user_id: resolvedStaffId,
      staff_name: verified.staff.name || verified.staff.email, role: role || 'bar', expected_hours: expected_hours ?? expectedHours ?? null,
      clock_in: new Date().toISOString(), status: 'active', idempotency_key: resolvedKey,
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'clock_in_staff_with_attendance_pin_offline', { payload: {
      lodge_id: state.lodgeId, shift_id: shiftId, staff_user_id: resolvedStaffId, pin: String(pin || ''),
      role: role || 'bar', expected_hours: expected_hours ?? expectedHours ?? null,
      idempotency_key: resolvedKey, device_id: getDesktopPosDeviceId()
    } }, null, { _queue_id: queueId });
    return { success: true, shift_id: shiftId, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = await state.supabase.rpc('clock_in_staff_with_attendance_pin', {
    payload: { lodge_id: state.lodgeId, staff_user_id: staff_user_id || staffUserId || null, pin: String(pin || ''), role, expected_hours: expected_hours ?? expectedHours ?? null, idempotency_key: idempotency_key || idempotencyKey || randomUUID(), device_id: getDesktopPosDeviceId() }
  });
  if (error) throw new Error(withAttendancePermissionGuidance(error.message, 'in'));
  if (result && result.success === false) return withOperatorPinResult(result);
  return result || { success: false, error: 'Clock-in failed.' };
}

export async function clockInSelfForPos({ role, idempotency_key, idempotencyKey } = {}) {
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  if (!state.isOnline || !state.supabase) {
    const staffId = state.currentUser?.id || null;
    const existing = readAttendanceShifts().find((row) => row.staff_user_id === staffId && row.status === 'active');
    if (existing) return { success: true, shift_id: existing.id, already_active: true, offline: true };
    const shiftId = randomUUID();
    const queueId = `attendance-shift-${shiftId}`;
    upsertAttendanceShift({
      id: shiftId, lodge_id: state.lodgeId, staff_user_id: staffId,
      staff_name: state.currentUser?.name || state.currentUser?.email, role: role || 'bar', expected_hours: 8,
      clock_in: new Date().toISOString(), status: 'active', idempotency_key: resolvedKey,
      _pending_sync: true, _sync_state: 'pending', _queue_id: queueId
    });
    queueOperation('rpc', 'clock_in_self_for_pos_offline', { payload: {
      lodge_id: state.lodgeId, shift_id: shiftId, role: role || 'bar', idempotency_key: resolvedKey
    } }, null, { _queue_id: queueId });
    return { success: true, shift_id: shiftId, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = await state.supabase.rpc('clock_in_self_for_pos', {
    payload: { lodge_id: state.lodgeId, role: role || 'waiter', idempotency_key: idempotency_key || idempotencyKey || randomUUID() }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not start attendance.' };
}

export async function clockOutStaff({ shiftId, notes, idempotency_key, idempotencyKey } = {}) {
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  const payload = {
    lodge_id: state.lodgeId,
    shift_id: shiftId,
    notes: notes || null,
    idempotency_key: resolvedKey,
    device_id: getDesktopPosDeviceId()
  };
  if (!state.isOnline || !state.supabase) {
    const shift = readAttendanceShifts().find((row) => row.id === shiftId);
    if (!shift) return { success: false, error: 'Attendance shift not found in the offline cache.' };
    upsertAttendanceShift({ ...shift, status: 'completed', clock_out: new Date().toISOString(), notes: notes || shift.notes || null, _pending_sync: true, _sync_state: 'pending' });
    const queueId = `attendance-clock-out-${shiftId}-${resolvedKey}`;
    queueOperation('rpc', 'clock_out_staff_offline', { payload }, null, {
      _queue_id: queueId,
      ...(shift._pending_sync ? { _depends_on: shift._queue_id || `attendance-shift-${shiftId}` } : {})
    });
    return { success: true, offline: true, queued: true, provisional: true };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('clock_out_staff_offline', { payload });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS STAFF] Clock out failed:', error?.message || error);
    throw error;
  }
}

export async function getActiveShifts() {
  if (!state.isOnline || !state.supabase) return readAttendanceShifts().filter((row) => row.status === 'active');

  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_active_shifts', {
        p_lodge_id: state.lodgeId
      }),
      5000,
      'Active shifts'
    );
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    writeAttendanceShifts(rows);
    return rows;
  } catch (error) {
    // Offline or stalled network: the unlock list and cash-up dropdowns must
    // fall back to the last saved attendance, never to an empty list that
    // reads as "no one is clocked in".
    console.error('[POS STAFF] Load shifts failed; using cached attendance:', error?.message || error);
    return readAttendanceShifts().filter((row) => row.status === 'active');
  }
}

export async function getPosBarActiveShifts() {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return readAttendanceShifts().filter((row) => row.status === 'active');
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_pos_bar_active_shifts', { p_lodge_id: state.lodgeId }),
      5000,
      'Bar active shifts'
    );
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS STAFF] Load bar shifts failed; using cached attendance:', error?.message || error);
    return readAttendanceShifts().filter((row) => row.status === 'active');
  }
}

export async function openCashDrawerSession({ openingFloat }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot open cash drawer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('open_cash_drawer_session', {
      payload: {
        lodge_id: state.lodgeId,
        opening_float: openingFloat || 0
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CASH] Open drawer failed:', error?.message || error);
    throw error;
  }
}

export async function closeCashDrawerSession({ sessionId, closingTotal, declaredTotal, notes }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot close cash drawer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('close_cash_drawer_session', {
      payload: {
        lodge_id: state.lodgeId,
        session_id: sessionId,
        closing_total: closingTotal || 0,
        declared_total: declaredTotal || null,
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CASH] Close drawer failed:', error?.message || error);
    throw error;
  }
}

export async function getOpenCashDrawer() {
  if (!state.isOnline || !state.supabase) return null;

  try {
    const { data, error } = await state.supabase.rpc('get_open_cash_drawer', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return data && typeof data === 'object' && data.id ? data : null;
  } catch (error) {
    console.error('[POS CASH] Load drawer failed:', error?.message || error);
    return null;
  }
}

const SUPPLIERS_CACHE_KEY = 'pos-suppliers';

function readCachedSuppliers() {
  return readCache(SUPPLIERS_CACHE_KEY);
}

function writeCachedSuppliers(suppliers) {
  writeCache(SUPPLIERS_CACHE_KEY, suppliers);
}

export async function getPosSuppliers() {
  if (!state.isOnline || !state.supabase) return readCachedSuppliers();

  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_suppliers', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    const suppliers = Array.isArray(data) ? data : [];
    writeCachedSuppliers(suppliers);
    return suppliers;
  } catch (error) {
    console.error('[POS SUPPLIERS] Load failed:', error?.message || error);
    return readCachedSuppliers();
  }
}

export async function createPosSupplier(supplierData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create supplier offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_supplier', {
      payload: {
        lodge_id: state.lodgeId,
        name: supplierData.name,
        contact_person: supplierData.contact_person || null,
        email: supplierData.email || null,
        phone: supplierData.phone || null,
        address: supplierData.address || null,
        payment_terms: supplierData.payment_terms || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS SUPPLIERS] Create failed:', error?.message || error);
    throw error;
  }
}

export async function updatePosSupplier(supplierId, supplierData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot update supplier offline');

  try {
    const { data: result, error } = await state.supabase.rpc('update_restaurant_supplier', {
      payload: {
        lodge_id: state.lodgeId,
        supplier_id: supplierId,
        name: supplierData.name,
        contact_person: supplierData.contact_person || null,
        email: supplierData.email || null,
        phone: supplierData.phone || null,
        address: supplierData.address || null,
        payment_terms: supplierData.payment_terms || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS SUPPLIERS] Update failed:', error?.message || error);
    throw error;
  }
}

export async function clockOutStaffWithAttendancePin({ shiftId, pin, notes, idempotency_key, idempotencyKey } = {}) {
  const resolvedKey = idempotency_key || idempotencyKey || randomUUID();
  // Cash-up before clock-out, enforced for every clock-out path (Till,
  // team list, kiosk): an open POS shift without a submitted or approved
  // cash-up blocks the clock-out with guidance. No open shift means nothing
  // to cash up, so the clock-out proceeds.
  const attendanceRow = readAttendanceShifts().find((row) => row.id === shiftId) || null;
  if (attendanceRow?.staff_user_id) {
    let openShift = null;
    try {
      openShift = await withNetworkTimeout(
        getStaffOpenPosShift(attendanceRow.staff_user_id),
        undefined,
        'Shift check'
      );
    } catch {
      openShift = readPosShifts().find((row) => row.cashier_id === attendanceRow.staff_user_id && row.status === 'open') || null;
    }
    if (openShift?.id && getOutletCashModel(openShift.outlet_id) !== 'shared_drawer') {
      let submission = null;
      try {
        const fetched = await withNetworkTimeout(
          getStaffPosCashupSubmission(openShift.id),
          undefined,
          'Cash-up check'
        );
        submission = fetched?.submission || null;
      } catch {
        submission = readPosCashupSubmissions().find((row) => row.shift_id === openShift.id) || null;
      }
      if (!['submitted', 'approved'].includes(submission?.status)) {
        return { success: false, code: 'cashup_required', error: 'Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.' };
      }
    }
  }
  if (!state.isOnline || !state.supabase) {
    const shift = readAttendanceShifts().find((row) => row.id === shiftId);
    if (!shift) return { success: false, error: 'Active attendance shift not found in the offline cache.' };
    const verified = validateCachedPosPin(shift.staff_user_id, pin);
    if (!verified.success) return verified;
    // Offline fail-closed mirror of the server cash-up guard: never queue a
    // clock-out (and never flip the local row to completed) while a local
    // open Till for this staff member lacks a submitted/approved cash-up.
    // Queuing it would dead-letter with "Submit My Cash-up before clocking
    // out" and poison a subsequent clock-in via optimistic completion.
    const localOpenTill = readPosShifts().find((row) =>
      String(row?.status || '').toLowerCase() === 'open' &&
      !row?.closed_at &&
      (String(row?.attendance_shift_id || '') === String(shiftId || '') ||
        String(row?.cashier_id || '') === String(shift?.staff_user_id || ''))
    ) || null;
    // Shared-drawer outlets reconcile collectively at period close, so the
    // queued replay enforces the same rule server-side. Unknown models keep
    // the old guard (fail closed).
    const localTillModel = localOpenTill?.outlet_id ? getOutletCashModel(localOpenTill.outlet_id) : 'personal_bank';
    // Replay ordering: a provisional cash-up queued just before this clock-out
    // must commit first. Without an explicit dependency the clock-out could
    // replay first and dead-letter with "Submit My Cash-up before clocking
    // out" while its own cash-up still waits in the queue.
    let provisionalCashupQueueId = null;
    if (localOpenTill?.id && localTillModel !== 'shared_drawer') {
      const localSubmission = readPosCashupSubmissions().find((row) => String(row?.shift_id || '') === String(localOpenTill.id)) || null;
      if (!['submitted', 'approved'].includes(localSubmission?.status)) {
        return { success: false, code: 'cashup_required', error: 'Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.' };
      }
      if (localSubmission?._pending_sync && localSubmission?._queue_id) provisionalCashupQueueId = localSubmission._queue_id;
    }
    upsertAttendanceShift({ ...shift, status: 'completed', clock_out: new Date().toISOString(), notes: notes || shift.notes || null, _pending_sync: true, _sync_state: 'pending' });
    const queueId = `attendance-pin-clock-out-${shiftId}-${resolvedKey}`;
    const clockOutShiftDep = shift._pending_sync ? (shift._queue_id || `attendance-shift-${shiftId}`) : null;
    const clockOutOrderedDeps = [clockOutShiftDep, provisionalCashupQueueId].filter(Boolean);
    queueOperation('rpc', 'clock_out_staff_with_attendance_pin', { payload: {
      lodge_id: state.lodgeId, shift_id: shiftId, pin: String(pin || ''), notes: notes || null,
      idempotency_key: resolvedKey, device_id: getDesktopPosDeviceId()
    } }, null, {
      _queue_id: queueId,
      ...(clockOutOrderedDeps[0] ? { _depends_on: clockOutOrderedDeps[0] } : {}),
      ...(clockOutOrderedDeps.length > 1 ? { _depends_on_all: clockOutOrderedDeps } : {})
    });
    return { success: true, offline: true, queued: true, provisional: true };
  }
  const { data: result, error } = await state.supabase.rpc('clock_out_staff_with_attendance_pin', {
    payload: { lodge_id: state.lodgeId, shift_id: shiftId, pin: String(pin || ''), notes: notes || null, idempotency_key: idempotency_key || idempotencyKey || randomUUID(), device_id: getDesktopPosDeviceId() }
  });
  if (error) throw new Error(withAttendancePermissionGuidance(error.message, 'out'));
  if (result && result.success === false) return withOperatorPinResult(result);
  return result || { success: false, error: 'Clock-out failed.' };
}

export async function createPurchaseOrder(orderData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        supplier_id: orderData.supplier_id || null,
        stock_location_id: orderData.stock_location_id || null,
        expected_delivery: orderData.expected_delivery || null,
        notes: orderData.notes || null,
        items: orderData.items || []
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Create failed:', error?.message || error);
    throw error;
  }
}

export async function approvePurchaseOrder(orderId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot approve purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('approve_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Approve failed:', error?.message || error);
    throw error;
  }
}

export async function receivePurchaseOrder(orderId, stockLocationId = null) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot receive purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('receive_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId,
        stock_location_id: stockLocationId || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Receive failed:', error?.message || error);
    throw error;
  }
}

export async function createStockTransfer(transferData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create stock transfer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_stock_transfer', {
      payload: {
        lodge_id: state.lodgeId,
        id: transferData.id || null,
        from_stock_location_id: transferData.from_stock_location_id || null,
        to_stock_location_id: transferData.to_stock_location_id || null,
        from_outlet_id: transferData.from_outlet_id || null,
        to_outlet_id: transferData.to_outlet_id || null,
        inventory_item_id: transferData.inventory_item_id || null,
        quantity: transferData.quantity || 0,
        notes: transferData.notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS TRANSFER] Create failed:', error?.message || error);
    throw error;
  }
}

export async function createDailyChecklist({ checklistType, items }) {
  if (!state.isOnline || !state.supabase) {
    const row = {
      id: randomUUID(),
      lodge_id: state.lodgeId,
      checklist_type: checklistType || 'daily_opening',
      status: 'open',
      items: (Array.isArray(items) ? items : []).map((label) => ({
        id: randomUUID(),
        item_label: String(label?.item_label || label || ''),
        is_completed: false,
      })),
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending',
    };
    const queueId = `pos-checklist-${row.id}`;
    row._queue_id = queueId;
    writeCache('pos-checklists', [row, ...(readCache('pos-checklists') || []).filter((entry) => entry?.id !== row.id)]);
    queueOperation('rpc', 'create_daily_checklist', {
      payload: { lodge_id: state.lodgeId, checklist_type: row.checklist_type, items: row.items.map((entry) => ({ label: entry.item_label })) },
    }, null, { _queue_id: queueId });
    return { success: true, offline: true, queued: true, id: row.id };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('create_daily_checklist', {
      payload: {
        lodge_id: state.lodgeId,
        checklist_type: checklistType || 'daily_opening',
        items: items || []
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CHECKLIST] Create failed:', error?.message || error);
    throw error;
  }
}

export async function completeChecklistItem({ itemId, notes }) {
  if (!state.isOnline || !state.supabase) {
    // Check-offs are idempotent (SET is_completed=true): queue the same RPC
    // with a stable per-item queue id and mark the cached row ticked so the
    // state survives restarts until the replay lands.
    const cached = readCache('pos-checklists') || [];
    writeCache('pos-checklists', cached.map((entry) => ({
      ...entry,
      items: (Array.isArray(entry.items) ? entry.items : []).map((line) =>
        String(line?.id || '') === String(itemId || '') ? { ...line, is_completed: true, notes: notes || line?.notes || null, _pending_sync: true } : line,
      ),
    })));
    queueOperation('rpc', 'complete_checklist_item', {
      payload: { lodge_id: state.lodgeId, item_id: itemId, notes: notes || null },
    }, null, { _queue_id: `checklist-item-${itemId}` });
    return { success: true, offline: true, queued: true };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('complete_checklist_item', {
      payload: {
        lodge_id: state.lodgeId,
        item_id: itemId,
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CHECKLIST] Complete item failed:', error?.message || error);
    throw error;
  }
}

/**
 * These views describe property reads at existing boundaries only. Main IPC
 * data and RPC rows remain unvalidated; values are intentionally unknown.
 * @typedef {{category?: unknown, outletId?: unknown, limit?: unknown}} PosAlertReadFiltersExpectedData
 * @typedef {{alertType?: unknown, alert_type?: unknown, category?: unknown, severity?: unknown, message?: unknown, entityType?: unknown, entity_type?: unknown, entityId?: unknown, entity_id?: unknown, outletId?: unknown, outlet_id?: unknown}} PosRecordAlertInputExpectedData
 * @typedef {{message?: unknown}} PosAlertCaughtValueExpectedData
 */

/** @param {PosAlertReadFiltersExpectedData} [filters] */
export async function getActiveAlerts(filters = {}) {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_alert_history', {
      p_lodge_id: state.lodgeId,
      p_alert_category: filters.category || null,
      p_outlet_id: filters.outletId || null,
      p_include_resolved: false,
      p_limit: Number(filters.limit || 100),
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS ALERTS] Load failed:', /** @type {PosAlertCaughtValueExpectedData} */ (error)?.message || error);
    return [];
  }
}

/** @param {PosRecordAlertInputExpectedData} payload */
export async function recordExceptionAlert({ alertType, category, severity, message, entityType, entityId, outletId }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record alert offline');

  try {
    const { data: result, error } = await state.supabase.rpc('record_exception_alert', {
      payload: {
        lodge_id: state.lodgeId,
        alert_type: alertType || 'custom',
        category: category || null,
        severity: severity || 'info',
        message: message || '',
        entity_type: entityType || null,
        entity_id: entityId || null,
        outlet_id: outletId || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ALERTS] Record failed:', /** @type {PosAlertCaughtValueExpectedData} */ (error)?.message || error);
    throw error;
  }
}

/** @param {unknown} alertId */
export async function resolveExceptionAlert(alertId, reason = 'Resolved from the Bar control board.', operationId = randomUUID()) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot resolve alert offline');

  try {
    const { data: result, error } = await state.supabase.rpc('resolve_exception_alert', {
      payload: {
        lodge_id: state.lodgeId,
        alert_id: alertId,
        reason,
        operation_id: operationId
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ALERTS] Resolve failed:', /** @type {PosAlertCaughtValueExpectedData} */ (error)?.message || error);
    throw error;
  }
}

export async function getPosPurchaseOrders(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);

  try {
    let query = state.supabase
      .from('restaurant_purchase_orders')
      .select('id, order_date, expected_delivery, status, total, notes, created_at, updated_at, stock_location_id, stock_location:restaurant_stock_locations(name), supplier:restaurant_suppliers(name, contact_person, phone, email), items:restaurant_purchase_order_items(id, inventory_item_id, description, quantity, unit_cost, total)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    // Return an explicitly plain payload across the Electron IPC boundary.
    return withPosReadMetadata(Array.isArray(data) ? data.map((order) => ({
      id: order.id,
      order_date: order.order_date || null,
      expected_delivery: order.expected_delivery || null,
      status: order.status || 'draft',
      total: Number(order.total || 0),
      notes: order.notes || null,
      created_at: order.created_at || null,
      updated_at: order.updated_at || null,
      stock_location_id: order.stock_location_id || null,
      stock_location_name: order.stock_location?.name || 'Shared business stock',
      supplier: order.supplier ? {
        name: order.supplier.name || null,
        contact_person: order.supplier.contact_person || null,
        phone: order.supplier.phone || null
      } : null,
      items: Array.isArray(order.items) ? order.items.map((item) => ({
        id: item.id,
        inventory_item_id: item.inventory_item_id || null,
        description: item.description || item.inventory?.name || 'Stock item',
        quantity: Number(item.quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
        total: Number(item.total || 0),
        unit: item.inventory?.unit || null
      })) : []
    })) : [], 'server', true);
  } catch (error) {
    console.error('[POS PURCHASE] List failed:', error?.message || error);
    throw error;
  }
}

/** @param {unknown} alertId */
export async function acknowledgeExceptionAlert(alertId, reason = 'Acknowledged from the Bar control board.', operationId = randomUUID()) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot acknowledge alert offline');
  const { data: result, error } = await state.supabase.rpc('acknowledge_exception_alert', {
    payload: { lodge_id: state.lodgeId, alert_id: alertId, reason, operation_id: operationId },
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Unknown error' };
}

/** @param {PosAlertReadFiltersExpectedData & {includeResolved?: unknown}} [filters] */
export async function getAlertHistory(filters = {}) {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_alert_history', {
    p_lodge_id: state.lodgeId,
    p_alert_category: filters.category || null,
    p_outlet_id: filters.outletId || null,
    p_include_resolved: filters.includeResolved !== false,
    p_limit: Number(filters.limit || 200),
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getShiftHistory(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);

  try {
    let query = state.supabase
      .from('restaurant_shifts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('clock_in', { ascending: false });
    if (startDate) query = query.gte('clock_in', startDate);
    if (endDate) query = query.lte('clock_in', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
  } catch (error) {
    console.error('[POS SHIFTS] History failed:', error?.message || error);
    throw error;
  }
}

export async function getCashDrawerSessions(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);

  try {
    let query = state.supabase
      .from('restaurant_cash_drawer_sessions')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
  } catch (error) {
    console.error('[POS CASH] Sessions list failed:', error?.message || error);
    throw error;
  }
}

export async function getChecklists() {
  if (!state.isOnline || !state.supabase) return readCache('pos-checklists') || [];

  try {
    const { data, error } = await withNetworkTimeout(state.supabase
      .from('restaurant_checklists')
      .select('*, items:restaurant_checklist_items(*)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false }), undefined, 'Checklists');
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    writeCache('pos-checklists', rows.slice(0, 200));
    return rows;
  } catch (error) {
    console.error('[POS CHECKLISTS] List failed:', error?.message || error);
    return readCache('pos-checklists') || [];
  }
}

export async function getExceptionAlerts() {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase
      .from('restaurant_alerts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS ALERTS] List failed:', error?.message || error);
    return [];
  }
}

export async function generateOwnerDigest() {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot generate digest offline');

  try {
    const { data: result, error } = await state.supabase.rpc('generate_owner_digest', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS DIGEST] Generate failed:', error?.message || error);
    throw error;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: Restaurant Differentiators
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Required fields supplied by RestaurantReservations and HposServiceReservations.
 * These are IPC/RPC request views, not runtime validation.
 * @typedef {{customer_name: string, customer_phone: string|null, party_size: number, reservation_date: string, reservation_time: string, duration_minutes: number, source: string, notes: string|null}} RestaurantReservationCreateRequest
 * @typedef {{status: string}} RestaurantReservationStatusUpdateRequest
 * @typedef {{customer_name: string, customer_phone: string|null, party_size: number, quoted_wait_minutes: number|null, notes: string|null}} RestaurantLiveWaitlistRequest
 * @typedef {{customer_name: string, customer_phone: string|null, party_size: number, notes: string|null, waitlist_type: 'reservation', requested_reservation_date: string, requested_reservation_time: string, requested_duration_minutes: number}} RestaurantReservationWaitlistRequest
 * @typedef {RestaurantLiveWaitlistRequest|RestaurantReservationWaitlistRequest} RestaurantWaitlistRequest
 * @typedef {{message?: unknown}|null|undefined} PosCaughtMessageExpectedData
 */

// 6.1 Reservations
/** @param {string|null|undefined} [startDate] @param {string|null|undefined} [endDate] @param {string|null|undefined} [outletId] */
export async function getRestaurantReservations(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_reservations', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? /** @type {unknown[]} */ (data) : [];
  } catch (error) {
    console.error('[POS RESERVATIONS] Get failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    return [];
  }
}

/** @param {RestaurantReservationCreateRequest} data */
export async function createRestaurantReservation(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_reservation', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('reservation_created', { entity_type: 'restaurant_reservation', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Create failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

/** @param {string} id @param {RestaurantReservationStatusUpdateRequest} data */
export async function updateRestaurantReservation(id, data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot update reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('update_restaurant_reservation', {
      payload: { ...data, id, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Update failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

/** @param {string} id @param {string|null|undefined} reason */
export async function cancelRestaurantReservation(id, reason) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot cancel reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('cancel_restaurant_reservation', {
      p_id: id, p_lodge_id: state.lodgeId, p_reason: reason || null
    });
    if (error) throw new Error(error.message);
    appendPosAudit('reservation_cancelled', { entity_type: 'restaurant_reservation', entity_id: id });
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Cancel failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

/** @param {string} id @param {string|string[]} tableIds */
export async function seatRestaurantReservation(id, tableIds) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot seat reservation offline');
  try {
    const normalizedTableIds = (Array.isArray(tableIds) ? tableIds : [tableIds])
      .filter(Boolean);
    const { data: result, error } = await state.supabase.rpc('seat_restaurant_reservation', {
      payload: { id, lodge_id: state.lodgeId, table_ids: normalizedTableIds }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Seat failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

/** @param {string} id @param {string|null|undefined} reason */
export async function markRestaurantReservationNoShow(id, reason) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot mark no-show offline');
  try {
    const { data: result, error } = await state.supabase.rpc('mark_restaurant_reservation_no_show', {
      p_id: id, p_lodge_id: state.lodgeId, p_reason: reason || null
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] No-show failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

// Waitlist
/** @param {string|null|undefined} [outletId] @param {boolean} [includeReservationWaitlist] */
export async function getRestaurantWaitlist(outletId, includeReservationWaitlist = false) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_waitlist', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? /** @type {unknown[]} */ (data) : [];
  } catch (error) {
    console.error('[POS WAITLIST] Get failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    return [];
  }
}

/** @param {RestaurantWaitlistRequest} data */
export async function createRestaurantWaitlistEntry(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot add to waitlist offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_waitlist_entry', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS WAITLIST] Create failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

/** @param {string} id @param {string} tableId */
export async function seatRestaurantWaitlistEntry(id, tableId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot seat waitlist offline');
  try {
    const { data: result, error } = await state.supabase.rpc('seat_restaurant_waitlist_entry', {
      p_id: id, p_lodge_id: state.lodgeId, p_table_id: tableId
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS WAITLIST] Seat failed:', (/** @type {PosCaughtMessageExpectedData} */ (error))?.message || error);
    throw error;
  }
}

// 6.2 Combos
export async function getRestaurantCombos(outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_combos', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS COMBOS] Get failed:', error?.message || error);
    return [];
  }
}

export async function saveRestaurantCombo(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save combo offline');
  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_combo', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('combo_saved', { entity_type: 'restaurant_combo', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS COMBOS] Save failed:', error?.message || error);
    throw error;
  }
}

export async function deleteRestaurantCombo(comboId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot delete combo offline');
  try {
    const { data: result, error } = await state.supabase.rpc('delete_restaurant_combo', {
      p_combo_id: comboId, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    appendPosAudit('combo_deleted', { entity_type: 'restaurant_combo', entity_id: comboId });
    return result;
  } catch (error) {
    console.error('[POS COMBOS] Delete failed:', error?.message || error);
    throw error;
  }
}

// 6.3 Recipe Variance
export async function getRecipeVarianceReport(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);
  try {
    const { data, error } = await state.supabase.rpc('get_recipe_variance_report', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
  } catch (error) {
    console.error('[POS VARIANCE] Get failed:', error?.message || error);
    return withPosReadMetadata([], 'error', false);
  }
}

// 6.5 Prep Batches
export async function getRestaurantPrepItems() {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_prep_items', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS PREP] Get items failed:', error?.message || error);
    return [];
  }
}

export async function saveRestaurantPrepItem(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save prep item offline');
  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_prep_item', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS PREP] Save item failed:', error?.message || error);
    throw error;
  }
}

export async function getRestaurantPrepBatches(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_prep_batches', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS PREP] Get batches failed:', error?.message || error);
    return [];
  }
}

export async function createRestaurantPrepBatch(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create prep batch offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_prep_batch', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('prep_batch_created', { entity_type: 'restaurant_prep_batch', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS PREP] Create batch failed:', error?.message || error);
    throw error;
  }
}

export async function postRestaurantPrepBatch(batchId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot post prep batch offline');
  try {
    const { data: result, error } = await state.supabase.rpc('post_restaurant_prep_batch', {
      p_batch_id: batchId, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    appendPosAudit('prep_batch_posted', { entity_type: 'restaurant_prep_batch', entity_id: batchId });
    return result;
  } catch (error) {
    console.error('[POS PREP] Post batch failed:', error?.message || error);
    throw error;
  }
}

// 6.6 Kitchen Timing
export async function recordTicketStatusEvent(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record ticket event offline');
  try {
    const { data: result, error } = await state.supabase.rpc('record_ticket_status_event', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS KITCHEN] Record event failed:', error?.message || error);
    throw error;
  }
}

export async function getKitchenTimingReport(startDate, endDate, outletId, station) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_kitchen_timing_report', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null,
      p_station: station || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS KITCHEN] Get report failed:', error?.message || error);
    return [];
  }
}

// 6.7 Purchase Suggestions
export async function getLowStockPurchaseSuggestions(outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_low_stock_purchase_suggestions', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS SUGGESTIONS] Get failed:', error?.message || error);
    return [];
  }
}

/** @param {string} id @param {RestaurantWaitlistRequest} data */
export async function updateRestaurantWaitlistEntry(id, data) {
  if (!state.isOnline || !state.supabase) throw new Error('Waitlist edits require an online connection');
  const { data: result, error } = await state.supabase.rpc('update_restaurant_waitlist_entry', { payload: { ...data, id, lodge_id: state.lodgeId } });
  if (error) throw new Error(error.message);
  return result;
}

/** @param {string} id @param {string} reason */
export async function removeRestaurantWaitlistEntry(id, reason) {
  if (!state.isOnline || !state.supabase) throw new Error('Removing a waitlist entry requires an online connection');
  const { data: result, error } = await state.supabase.rpc('remove_restaurant_waitlist_entry', { p_id: id, p_lodge_id: state.lodgeId, p_reason: reason });
  if (error) throw new Error(error.message);
  return result;
}

/** @param {string} id @param {string} action @param {string[]} [tableIds] */
export async function serviceRestaurantReservationAction(id, action, tableIds = []) {
  if (!state.isOnline || !state.supabase) throw new Error('Reservation service actions require an online connection');
  const { data: result, error } = await state.supabase.rpc('service_restaurant_reservation_action', { payload: { id, action, table_ids: tableIds, lodge_id: state.lodgeId } });
  if (error) throw new Error(error.message);
  return result;
}

// Prepared recipe items remain consumed after a financial void.  This is an
// operational loss report, sourced from the immutable void audit and frozen
// recipe movement cost rather than a current recipe estimate.
export async function getRecipePreparationLosses(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);
  try {
    const { data, error } = await state.supabase.rpc('get_recipe_preparation_losses', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
  } catch (error) {
    console.error('[POS PREPARATION LOSS] Get failed:', error?.message || error);
    return withPosReadMetadata([], 'error', false);
  }
}

export async function getRecipePreparationLossIngredientSummary(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);
  try {
    const { data, error } = await state.supabase.rpc('get_recipe_preparation_loss_ingredient_summary', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
  } catch (error) {
    console.error('[POS PREPARATION LOSS] Ingredient summary failed:', error?.message || error);
    return withPosReadMetadata([], 'error', false);
  }
}

export async function updatePurchaseOrderDraft(orderId, orderData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot edit a purchase order offline');
  const { data: result, error } = await state.supabase.rpc('update_purchase_order_draft', {
    payload: { lodge_id: state.lodgeId, order_id: orderId, ...orderData }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Unknown error' };
}

export async function setPreferredSupplierForInventoryItem(inventoryItemId, supplierId, lastUnitCost = null) {
  if (!state.isOnline || !state.supabase) throw new Error('Assigning a preferred supplier requires an online connection');
  const { data: result, error } = await state.supabase.rpc('set_restaurant_preferred_supplier_item', {
    payload: {
      lodge_id: state.lodgeId,
      inventory_item_id: inventoryItemId,
      supplier_id: supplierId,
      last_unit_cost: lastUnitCost
    }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not set the preferred supplier');
  return result;
}

export async function convertPurchaseSuggestionsToPo(supplierId, suggestions, notes) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot convert suggestions offline');
  try {
    const { data: result, error } = await state.supabase.rpc('convert_purchase_suggestions_to_po', {
      payload: {
        lodge_id: state.lodgeId,
        supplier_id: supplierId,
        suggestions: suggestions.map(s => ({
          id: s.id,
          inventory_item_id: s.inventory_item_id,
          quantity: s.suggested_quantity,
          unit_cost: s.last_unit_cost || 0
        })),
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('po_created_from_suggestions', { entity_type: 'restaurant_purchase_order', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS SUGGESTIONS] Convert failed:', error?.message || error);
    throw error;
  }
}

export async function getRestaurantShiftPlans(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_shift_plans', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate || getLocalDateKey(),
    p_end_date: endDate || getLocalDateKey(new Date(Date.now() + 14 * 86400000))
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function saveRestaurantShiftPlan(data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Shift planning requires an online connection');
  const { data: result, error } = await state.supabase.rpc('upsert_restaurant_shift_plan', {
    payload: { ...data, lodge_id: state.lodgeId }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save shift plan');
  appendPosAudit('shift_plan_saved', { entity_type: 'restaurant_shift_plan', entity_id: result.plan?.id || data.id || null, details: { staff_name: data.staff_name, shift_date: data.shift_date } });
  return result;
}

export async function deleteRestaurantShiftPlan(id) {
  if (!state.isOnline || !state.supabase) throw new Error('Shift planning requires an online connection');
  const { data: result, error } = await state.supabase.rpc('delete_restaurant_shift_plan', { p_lodge_id: state.lodgeId, p_id: id });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete shift plan');
  appendPosAudit('shift_plan_deleted', { entity_type: 'restaurant_shift_plan', entity_id: id });
  return result;
}

// Phase 7: sellability controls. These are deliberately online-only because a
// settlement or reservation deposit must never be represented as final cash by
// a device-local queue.
export async function recordRestaurantSettlement(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Settlement reconciliation requires an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_settlement', {
    p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() }
  });
  if (error) throw new Error(error.message);
  appendPosAudit('settlement_recorded', { entity_type: 'restaurant_settlement', entity_id: result?.id, details: { channel: data.channel } });
  return result;
}

export async function seedBarChecklistTemplates() {
  if (!state.isOnline || !state.supabase) throw new Error('Bar checklist templates require an online connection');
  const { data: result, error } = await state.supabase.rpc('seed_bar_checklist_templates', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not seed Bar checklist templates.' };
}

export async function getBarChecklistTemplates() {
  if (!state.isOnline || !state.supabase) return readCache('bar-checklist-templates') || [];
  try {
    const { data, error } = await withNetworkTimeout(
      state.supabase.rpc('get_bar_checklist_templates', { p_lodge_id: state.lodgeId }),
      undefined,
      'Checklist templates'
    );
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    writeCache('bar-checklist-templates', rows);
    return rows;
  } catch (error) {
    console.error('[POS CHECKLISTS] Templates failed:', error?.message || error);
    return readCache('bar-checklist-templates') || [];
  }
}

export async function createBarChecklistFromTemplate({ templateKey, outletId, operationId } = {}) {
  if (!state.isOnline || !state.supabase) {
    const stableOperationId = String(operationId || '').trim() || randomUUID();
    const template = (readCache('bar-checklist-templates') || [])
      .find((entry) => String(entry?.template_key || '') === String(templateKey || ''));
    const row = {
      id: randomUUID(),
      lodge_id: state.lodgeId,
      template_key: templateKey || null,
      checklist_type: template?.checklist_type || 'daily_opening',
      outlet_id: outletId || null,
      status: 'open',
      operation_id: stableOperationId,
      items: (Array.isArray(template?.items) ? template.items : []).map((label) => ({
        id: randomUUID(),
        item_label: String(label?.label || label || ''),
        is_completed: false,
      })),
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending',
    };
    const queueId = `bar-checklist-${stableOperationId}`;
    row._queue_id = queueId;
    writeCache('pos-checklists', [row, ...(readCache('pos-checklists') || []).filter((entry) => entry?.id !== row.id)]);
    queueOperation('rpc', 'create_bar_checklist_from_template', {
      p_payload: { lodge_id: state.lodgeId, template_key: templateKey, outlet_id: outletId || null, operation_id: stableOperationId },
    }, null, { _queue_id: queueId });
    return { success: true, offline: true, queued: true, operation_id: stableOperationId, id: row.id };
  }
  const { data: result, error } = await state.supabase.rpc('create_bar_checklist_from_template', {
    p_payload: { lodge_id: state.lodgeId, template_key: templateKey, outlet_id: outletId || null, operation_id: operationId || randomUUID() },
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not create the Bar checklist.' };
}

export async function getRestaurantSettlementBankAccounts() {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_settlement_bank_accounts', {
    p_lodge_id: state.lodgeId,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not load settlement bank accounts');
  return Array.isArray(data.data) ? data.data : [];
}

export async function getRestaurantSettlements(businessDate) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);
  const { data, error } = await state.supabase.rpc('get_restaurant_settlements', { p_lodge_id: state.lodgeId, p_business_date: businessDate || null });
  if (error) throw new Error(error.message);
  return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
}

export async function getRestaurantSettlementExpectedTotal(startDate, endDate, channel) {
  if (!state.isOnline || !state.supabase) throw new Error('Settlement reconciliation requires an online connection');
  const { data, error } = await state.supabase.rpc('get_restaurant_settlement_expected_total', {
    p_lodge_id: state.lodgeId, p_start_date: startDate, p_end_date: endDate, p_channel: channel,
  });
  if (error) throw new Error(error.message);
  return data || { success: false, error: 'Could not calculate the expected POS total.' };
}

export async function recordRestaurantReservationDeposit(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Reservation deposits require an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_reservation_deposit', {
    p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() }
  });
  if (error) throw new Error(error.message);
  appendPosAudit('reservation_deposit_held', { entity_type: 'restaurant_reservation', entity_id: data.reservation_id });
  return result;
}

export async function getRestaurantReservationDeposits(days = 90) {
  if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false);
  const { data, error } = await state.supabase.rpc('get_restaurant_reservation_deposits', {
    p_lodge_id: state.lodgeId,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true);
}

export async function getRestaurantOutletControls() {
  if (!state.isOnline || !state.supabase) throw new Error('Outlet control requires an online connection');
  const { data, error } = await state.supabase.rpc('get_restaurant_outlet_controls', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getRestaurantStockLocations() {
  if (!state.isOnline || !state.supabase) throw new Error('Stock location setup requires an online connection');
  const { data, error } = await state.supabase.rpc('get_restaurant_stock_locations', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getRestaurantStockLocationBalances() {
  if (!state.isOnline || !state.supabase) throw new Error('Stock balances require an online connection');
  const { data, error } = await state.supabase.rpc('get_restaurant_stock_location_balances', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function createRestaurantStockLocation(data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Stock location setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('create_restaurant_stock_location', { p_lodge_id: state.lodgeId, p_payload: data });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not create stock location.' };
}

export async function updateRestaurantStockLocation(locationId, data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Stock location setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('update_restaurant_stock_location', { p_lodge_id: state.lodgeId, p_location_id: locationId, p_payload: data });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not update stock location.' };
}

export async function deleteRestaurantStockLocation(locationId) {
  if (!state.isOnline || !state.supabase) throw new Error('Stock location setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('delete_restaurant_stock_location', { p_lodge_id: state.lodgeId, p_location_id: locationId });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not delete stock location.' };
}

export async function setRestaurantOutletStockLocation(outletId, stockLocationId) {
  if (!state.isOnline || !state.supabase) throw new Error('Stock location setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('set_restaurant_outlet_stock_location', { p_lodge_id: state.lodgeId, p_outlet_id: outletId, p_stock_location_id: stockLocationId });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not update the outlet stock source.' };
}

export async function createRestaurantOutlet(data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Outlet setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('create_restaurant_outlet', {
    p_lodge_id: state.lodgeId,
    p_payload: data,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not create outlet');
  appendPosAudit('restaurant_outlet_created', { entity_type: 'outlet', entity_id: result?.outlet?.id, details: { name: data.name, type: data.type } });
  return result;
}

export async function updateRestaurantOutlet(outletId, data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Outlet setup requires an online connection');
  const { data: result, error } = await state.supabase.rpc('update_restaurant_outlet', {
    p_lodge_id: state.lodgeId,
    p_outlet_id: outletId,
    p_payload: data,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update outlet');
  appendPosAudit('restaurant_outlet_updated', { entity_type: 'outlet', entity_id: outletId, details: { name: data.name, active: data.is_active } });
  return result;
}

export async function recordRestaurantFeedback(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Customer feedback requires an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_feedback', { p_payload: { ...data, lodge_id: state.lodgeId } });
  if (error) throw new Error(error.message);
  appendPosAudit('customer_feedback_recorded', { entity_type: 'restaurant_feedback', entity_id: result?.id });
  return result;
}

export async function getRestaurantFeedback(days = 30) {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_feedback', { p_lodge_id: state.lodgeId, p_days: days });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getRestaurantSetupProgress() {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_setup_progress', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

// Keep the historical array-returning method above for existing callers, but
// expose read provenance separately so setup UI cannot mistake an offline or
// failed read for an empty (not configured) venue.
export async function getRestaurantSetupProgressWithReadStatus() {
  const unavailable = (message, online = Boolean(state.isOnline)) => ({
    source: 'unavailable',
    complete: false,
    online,
    rows: [],
    error: message
  });
  if (!state.isOnline || !state.supabase) {
    return unavailable('Setup evidence is unavailable while offline. Reconnect before relying on readiness.', false);
  }
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_setup_progress', { p_lodge_id: state.lodgeId });
    if (error) return unavailable(`Setup evidence could not be verified from the server: ${error.message || 'read failed'}.`, true);
    if (!Array.isArray(data)) return unavailable('Setup evidence returned an incomplete server response. Refresh while online before relying on readiness.', true);
    return { source: 'server', complete: true, online: true, rows: data, error: null };
  } catch (error) {
    return unavailable(`Setup evidence could not be verified from the server: ${error?.message || 'read failed'}.`, true);
  }
}

export async function setRestaurantSetupStage(data = {}) {
  if (!state.isOnline || !state.supabase) throw new Error('Setup progress requires an online connection');
  const { data: result, error } = await state.supabase.rpc('set_restaurant_setup_stage', {
    p_payload: { ...data, lodge_id: state.lodgeId }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not update setup progress.' };
}

export async function recordRestaurantSetupEvidence(data = {}) {
  if (!state.isOnline || !state.supabase) return { success: false, error: 'Setup evidence requires an online connection' };
  const { data: result, error } = await state.supabase.rpc('record_restaurant_setup_evidence', {
    p_payload: { ...data, lodge_id: state.lodgeId }
  });
  if (error) throw new Error(error.message);
  return result || { success: false, error: 'Could not record setup evidence.' };
}

export async function createRestaurantGiftCard(data) { if (!state.isOnline || !state.supabase) throw new Error('Gift cards require an online connection'); const { data: result, error } = await state.supabase.rpc('create_restaurant_gift_card', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function recordRestaurantTipPayout(data) { if (!state.isOnline || !state.supabase) throw new Error('Tip payouts require an online connection'); const { data: result, error } = await state.supabase.rpc('record_restaurant_tip_payout', { p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() } }); if (error) throw new Error(error.message); return result }
export async function getRestaurantTipPayouts(days = 30) { if (!state.isOnline || !state.supabase) return []; const { data, error } = await state.supabase.rpc('get_restaurant_tip_payouts', { p_lodge_id: state.lodgeId, p_days: days }); if (error) throw new Error(error.message); return Array.isArray(data) ? data : [] }
export async function getRestaurantTipBalances(days = 30) { if (!state.isOnline || !state.supabase) return withPosReadMetadata([], 'offline-cache', false); const { data, error } = await state.supabase.rpc('get_restaurant_tip_balances', { p_lodge_id: state.lodgeId, p_days: days }); if (error) throw new Error(error.message); return withPosReadMetadata(Array.isArray(data) ? data : [], 'server', true) }
export async function saveRestaurantReservationPolicy(data) { if (!state.isOnline || !state.supabase) throw new Error('Reservation policy requires an online connection'); const { data: result, error } = await state.supabase.rpc('upsert_restaurant_reservation_policy', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function recordRestaurantInventoryLot(data) { if (!state.isOnline || !state.supabase) throw new Error('Inventory lots require an online connection'); const { data: result, error } = await state.supabase.rpc('record_restaurant_inventory_lot', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function updateRestaurantInventoryLotExpiry(lotId, data) { if (!state.isOnline || !state.supabase) throw new Error('Inventory lots require an online connection'); const { data: result, error } = await state.supabase.rpc('update_restaurant_inventory_lot_expiry', { p_payload: { ...data, lot_id: lotId, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function writeOffExpiredRestaurantInventoryLot(lotId, data) { if (!state.isOnline || !state.supabase) throw new Error('Expired-lot write-offs require an online connection'); const { data: result, error } = await state.supabase.rpc('write_off_expired_restaurant_inventory_lot', { p_payload: { ...data, lot_id: lotId, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() } }); if (error) throw new Error(error.message); return result }
export async function getRestaurantExpiryLots(days = 14) { if (!state.isOnline || !state.supabase) return []; const { data, error } = await state.supabase.rpc('get_restaurant_expiry_lots', { p_lodge_id: state.lodgeId, p_days: days }); if (error) throw new Error(error.message); return Array.isArray(data) ? data : [] }
