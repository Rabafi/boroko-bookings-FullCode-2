// @ts-check
import { normalizeMoney, normalizePercent, normalizePositiveQty, buildPosTotals } from './totals.js';

/** @typedef {Record<string, unknown>} PosOrderItemInput */

/** @typedef {unknown} ModifierInput */

/** @typedef {Record<string, unknown> & import('./totals.js').PosTotalOverrides & {items?: PosOrderItemInput[]}} CreateOrderInput */
/** @typedef {object} VoidInput
 * @property {unknown} order_id @property {unknown} [lodge_id]
 * @property {unknown} [requested_by] @property {unknown} [approved_by]
 * @property {unknown} [pin] @property {unknown} [reason]
 * @property {unknown} [device_id] @property {unknown} [outlet_id]
 * @property {unknown} [override_log_id] @property {unknown} [created_at]
 */
/** @typedef {object} ReturnInput
 * @property {unknown} order_id @property {unknown} [lodge_id]
 * @property {unknown} return_order_id @property {unknown} shift_id
 * @property {unknown} [return_idempotency_key] @property {unknown} [pin]
 * @property {unknown} [approval_pin] @property {unknown} [approver_id]
 * @property {unknown} [device_id] @property {unknown} [reason]
 * @property {unknown} [override_log_id]
 * @property {Record<string, unknown>[]} [lines]
 */
/** @typedef {object} FinalizeCashupInput
 * @property {unknown} [cashup_id] @property {unknown} [id]
 * @property {unknown} lodge_id @property {unknown} shift_id
 * @property {unknown} [idempotency_key] @property {unknown} [counted_by_method]
 * @property {unknown} [notes]
 */
/** @typedef {object} CashupInput
 * @property {unknown} [id] @property {unknown} lodge_id
 * @property {unknown} date @property {unknown} [outlet_id]
 * @property {unknown} [opening_float] @property {unknown} [expected_cash_drawer]
 * @property {unknown} [expected_by_method] @property {unknown} [counted_by_method]
 * @property {unknown} [variance_by_method] @property {unknown} [cash_over_short]
 * @property {unknown} [orders_count] @property {unknown} [void_count]
 * @property {unknown} [pending_count] @property {unknown} [gross_sales]
 * @property {unknown} [returns_total] @property {unknown} [net_sales]
 * @property {unknown} [notes] @property {unknown} [created_by]
 * @property {unknown} [created_by_name] @property {unknown} [cashier_id]
 * @property {unknown} [cashier_name] @property {unknown} [created_at]
 */

/**
 * @typedef {object} PaymentBreakdownRow
 * @property {unknown} method
 * @property {number} amount
 * @property {string | null} reference
 * @property {unknown} [customer_id]
 * @property {unknown} [voucher_id]
 * @property {string} [code]
 */

/**
 * @typedef {object} CreatePosOrderPayload
 * @property {string} id
 * @property {unknown} lodge_id
 * @property {unknown} room_id
 * @property {unknown} booking_id
 * @property {unknown} event_booking_id
 * @property {unknown} walk_in_name
 * @property {number} total
 * @property {number} gross_total
 * @property {number} discount_total
 * @property {number} tax_rate
 * @property {number} tax_total
 * @property {number} tip_total
 * @property {unknown} notes
 * @property {unknown} payment_method
 * @property {PaymentBreakdownRow[]} payment_breakdown
 * @property {unknown} outlet_id
 * @property {unknown} service_mode
 * @property {unknown} table_name
 * @property {unknown} tab_name
 * @property {unknown} waiter_name
 * @property {unknown} cashier_id
 * @property {unknown} cashier_name
 * @property {unknown} shift_id
 * @property {unknown} ticket_status
 * @property {string} create_idempotency_key
 * @property {unknown} created_at_client
 * @property {Array<{menu_item_id: unknown, inventory_item_id: unknown, depletion_qty: number, item_name: unknown, category: unknown, modifiers: unknown[], item_notes: unknown, quantity: unknown, unit_price: unknown}>} items
 */

/**
 * @typedef {object} CreatePosOrderPayloadV3
 * @property {string} id
 * @property {unknown} lodge_id
 * @property {unknown} catalog_snapshot_id
 * @property {unknown} shift_id
 * @property {unknown} source_device_id
 * @property {unknown} outlet_id
 * @property {unknown} room_id
 * @property {unknown} booking_id
 * @property {unknown} event_booking_id
 * @property {unknown} walk_in_name
 * @property {unknown} customer_id
 * @property {unknown} customer_account_charge
 * @property {unknown} notes
 * @property {unknown} payment_method
 * @property {PaymentBreakdownRow[]} payment_breakdown
 * @property {unknown} service_mode
 * @property {unknown} table_name
 * @property {unknown} tab_name
 * @property {unknown} waiter_name
 * @property {unknown} ticket_status
 * @property {string} create_idempotency_key
 * @property {unknown} client_created_at
 * @property {number} tip_total
 * @property {unknown} promotion_id
 * @property {unknown} manual_discount
 * @property {Array<{menu_item_id: unknown, quantity: number, modifier_option_ids: unknown[], item_notes: unknown}>} items
 */

/** @typedef {object} VoidPayload
 * @property {unknown} order_id @property {unknown} lodge_id
 * @property {unknown} requested_by @property {unknown} approved_by
 * @property {string} pin @property {unknown} reason
 * @property {unknown} device_id @property {unknown} outlet_id
 * @property {unknown} override_log_id @property {unknown} created_at
 */

/** @typedef {object} ReturnPayloadV3
 * @property {unknown} order_id @property {unknown} lodge_id
 * @property {unknown} return_order_id @property {unknown} shift_id
 * @property {unknown} return_idempotency_key @property {string} approval_pin
 * @property {unknown} approver_id @property {unknown} device_id
 * @property {string} reason @property {unknown} override_log_id
 * @property {Array<{line_id: unknown, quantity: number}>} lines
 */

/** @typedef {object} FinalizeCashupPayloadV2
 * @property {unknown} lodge_id @property {unknown} shift_id
 * @property {unknown} cashup_id @property {unknown} idempotency_key
 * @property {unknown} counted_by_method @property {unknown} notes
 */

/** @typedef {object} CashupPayload
 * @property {unknown} id @property {unknown} lodge_id @property {unknown} date
 * @property {unknown} outlet_id @property {unknown} opening_float
 * @property {unknown} expected_cash_drawer @property {unknown} expected_by_method
 * @property {unknown} counted_by_method @property {unknown} variance_by_method
 * @property {unknown} cash_over_short @property {unknown} orders_count
 * @property {unknown} void_count @property {unknown} pending_count
 * @property {unknown} gross_sales @property {unknown} returns_total
 * @property {unknown} net_sales @property {unknown} notes
 * @property {unknown} created_by @property {unknown} created_by_name
 * @property {unknown} cashier_id @property {unknown} cashier_name
 * @property {unknown} created_at
 */

function randomUUID() {
  // Electron 22's Node runtime exposes this Web Crypto API; this Legacy
  // module's ES2020-only type profile intentionally excludes Node/DOM globals.
  /** @type {typeof globalThis & {crypto?: {randomUUID?: () => string}}} */
  const runtimeGlobal = globalThis;
  if (typeof runtimeGlobal.crypto !== 'undefined' && runtimeGlobal.crypto.randomUUID) {
    return runtimeGlobal.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) return undefined;
  // Preserve optional property access for untrusted values, including getter
  // receivers when the value is a primitive.
  return Reflect.get(Object(value), key, value);
}

/** @param {unknown} [payments] @param {unknown} [fallbackMethod] @param {unknown} [total] @returns {PaymentBreakdownRow[]} */
export function normalizePaymentBreakdown(payments = [], fallbackMethod = 'cash', total = 0) {
  const rows = Array.isArray(payments) ? /** @type {unknown[]} */ (payments) : [];
  /** @type {PaymentBreakdownRow[]} */
  const normalized = rows
    .map((row) => {
      // The array may contain arbitrary values; direct optional property
      // reads remain unvalidated and preserve the historical fallback.
      return {
        method: String(readField(row, 'method') || fallbackMethod || 'cash').trim() || 'cash',
        amount: normalizeMoney(readField(row, 'amount')),
        reference: String(readField(row, 'reference') || '').trim() || null,
        ...(readField(row, 'customer_id') ? { customer_id: readField(row, 'customer_id') } : {}),
        ...(readField(row, 'voucher_id') ? { voucher_id: readField(row, 'voucher_id') } : {}),
        ...(readField(row, 'code') ? { code: String(readField(row, 'code')).trim().toUpperCase() } : {})
      };
    })
    .filter((row) => row.amount !== 0);
  if (normalized.length === 0 && normalizeMoney(total) !== 0) {
    normalized.push({ method: fallbackMethod || 'cash', amount: normalizeMoney(total), reference: null });
  }
  return normalized;
}

/** @param {unknown} [paymentBreakdown] @param {unknown} [fallbackMethod] @returns {unknown} */
export function validateProviderPaymentReferences(paymentBreakdown = [], fallbackMethod = 'cash') {
  const rows = Array.isArray(paymentBreakdown) && paymentBreakdown.length > 0
    ? /** @type {unknown[]} */ (paymentBreakdown)
    : [{ method: fallbackMethod, amount: 0, reference: null }];
  const missing = rows.filter((row) => {
    const method = String(readField(row, 'method') || fallbackMethod || 'cash').trim().toLowerCase();
    if (!['card', 'mobile_money'].includes(method)) return false;
    const reference = String(readField(row, 'reference') || '').trim();
    return !reference || reference.length > 120;
  });
  if (missing.length > 0) {
    const labels = [...new Set(missing.map((row) => {
      return String(readField(row, 'method') || fallbackMethod || 'cash').trim().toLowerCase() === 'mobile_money' ? 'mobile money' : 'card';
    }))];
    throw new Error(`Enter the ${labels.join(' and ')} transaction or approval reference before recording payment.`);
  }
  return paymentBreakdown;
}

/** @param {CreateOrderInput} [input] @returns {CreatePosOrderPayload} */
export function buildCreatePosOrderPayload(input = {}) {
  const items = input.items || [];
  const totals = buildPosTotals(items, input);
  const total = totals.total;
  const paymentBreakdown = normalizePaymentBreakdown(
    input.payment_breakdown || input.payments,
    input.payment_method || 'cash',
    total
  );
  const paymentMethod = input.payment_method ||
    (paymentBreakdown.length > 1 ? 'split' : paymentBreakdown[0]?.method || 'cash');

  const callerOrderId = String(input?.id || '').trim();
  const callerSubmitIntentId = String(input?.submit_intent_id || '').trim();
  const submitIntentId = callerSubmitIntentId || randomUUID();
  const orderId = callerOrderId || submitIntentId;

  return {
    id: orderId,
    lodge_id: input.lodge_id,
    room_id: input.room_id || null,
    booking_id: input.booking_id || null,
    event_booking_id: input.event_booking_id || null,
    walk_in_name: input.walk_in_name || null,
    total,
    gross_total: totals.gross_total,
    discount_total: totals.discount_total,
    tax_rate: totals.tax_rate,
    tax_total: totals.tax_total,
    tip_total: totals.tip_total,
    notes: input.notes || null,
    payment_method: paymentMethod,
    payment_breakdown: paymentBreakdown,
    outlet_id: input.outlet_id || null,
    service_mode: input.service_mode ||
      (input.table_name ? 'table' : input.room_id ? 'room' : 'takeaway'),
    table_name: input.table_name || null,
    tab_name: input.tab_name || null,
    waiter_name: input.waiter_name || null,
    cashier_id: input.cashier_id || null,
    cashier_name: input.cashier_name || null,
    shift_id: input.shift_id || null,
    ticket_status: input.ticket_status || 'new',
    create_idempotency_key: `pos-order:${submitIntentId}`,
    created_at_client: input.created_at_client || new Date().toISOString(),
    items: items.map((i) => ({
      menu_item_id: i.menu_item_id || null,
      inventory_item_id: i.inventory_item_id || null,
      depletion_qty: normalizePositiveQty(i.depletion_qty, 1),
      item_name: i.item_name,
      category: i.category || null,
      modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
      item_notes: i.item_notes || null,
      quantity: i.quantity,
      unit_price: i.unit_price
    }))
  };
}

/** @typedef {CreateOrderInput & {
 * catalog_snapshot_id: unknown,
 * shift_id: unknown,
 * lodge_id: unknown,
 * source_device_id?: unknown,
 * customer_id?: unknown,
 * customer_account_charge?: unknown,
 * promotion_id?: unknown,
 * manual_discount?: unknown
 * }} CreateOrderV3Input */

// The empty defaults remain so omitted legacy calls hit the same runtime
// validation below. These assertions describe only that internal fallback;
// overloads require the presence-only fields for a successful call.
/** @overload @param {CreateOrderV3Input} input @returns {CreatePosOrderPayloadV3} */
/** @overload @returns {never} */
/** @param {CreateOrderV3Input | undefined} [input] @returns {CreatePosOrderPayloadV3} */
export function buildCreatePosOrderPayloadV3(input = /** @type {CreateOrderV3Input} */ ({})) {
  const legacy = buildCreatePosOrderPayload(input);
  if (!legacy.id || !legacy.lodge_id || !input.catalog_snapshot_id || !input.shift_id) {
    throw new Error('Order, lodge, catalog snapshot, and open shift are required.');
  }
  return {
    id: legacy.id,
    lodge_id: legacy.lodge_id,
    catalog_snapshot_id: input.catalog_snapshot_id,
    shift_id: input.shift_id,
    source_device_id: input.source_device_id || 'legacy-pos',
    outlet_id: legacy.outlet_id,
    room_id: legacy.room_id,
    booking_id: legacy.booking_id,
    event_booking_id: legacy.event_booking_id,
    walk_in_name: legacy.walk_in_name,
    customer_id: input.customer_id || null,
    customer_account_charge: input.customer_account_charge || null,
    notes: legacy.notes,
    payment_method: legacy.payment_method,
    payment_breakdown: legacy.payment_breakdown,
    service_mode: legacy.service_mode,
    table_name: legacy.table_name,
    tab_name: legacy.tab_name,
    waiter_name: legacy.waiter_name,
    ticket_status: legacy.ticket_status,
    create_idempotency_key: legacy.create_idempotency_key,
    client_created_at: legacy.created_at_client,
    tip_total: legacy.tip_total,
    promotion_id: input.promotion_id || null,
    manual_discount: input.manual_discount || null,
    items: (input.items || []).map((item) => ({
      menu_item_id: item.menu_item_id || null,
      quantity: normalizePositiveQty(item.quantity, 1),
      modifier_option_ids: Array.isArray(item.modifier_option_ids)
        ? item.modifier_option_ids
        : (Array.isArray(item.modifiers) ? item.modifiers : [])
      .map((modifier) => typeof modifier === 'string' ? modifier : readField(modifier, 'id'))
          .filter(Boolean),
      item_notes: item.item_notes || null
    }))
  };
}

// Compatibility adapter for queued v3 orders created before account identity
// was part of payment_breakdown.  It is deliberately narrow: new envelopes
// and non-account tenders are left untouched, while an old account intent is
// promoted to the authoritative tender row before replay.
/** @param {unknown} [payload] @returns {unknown} */
export function adaptLegacyPosOrderFinancialPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const legacyCharge = readField(payload, 'customer_account_charge');
  if (!readField(legacyCharge, 'customer_id')) return payload;
  const paymentBreakdown = readField(payload, 'payment_breakdown');
  const breakdown = Array.isArray(paymentBreakdown) ? paymentBreakdown : [];
  if (breakdown.some((rawRow) => {
    return String(readField(rawRow, 'method') || '').trim().toLowerCase() === 'account';
  })) return payload;
  const amount = Number(readField(legacyCharge, 'amount') ?? readField(payload, 'total') ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return payload;
  return {
    ...Object(payload),
    payment_method: 'account',
    payment_breakdown: [{
      method: 'account',
      amount: Math.round(amount * 100) / 100,
      customer_id: readField(legacyCharge, 'customer_id'),
      reference: null
    }]
  };
}

/** @overload @param {VoidInput} input @returns {VoidPayload} */
/** @overload @returns {never} */
/** @param {VoidInput | undefined} [input] @returns {VoidPayload} */
export function buildVoidPayload(input = /** @type {VoidInput} */ ({})) {
  const orderId = input.order_id;
  if (!orderId) throw new Error('order_id is required for void');
  return {
    order_id: orderId,
    lodge_id: input.lodge_id,
    requested_by: input.requested_by || null,
    approved_by: input.approved_by,
    pin: String(input.pin || '').trim(),
    reason: input.reason || null,
    device_id: input.device_id || 'legacy-pos',
    outlet_id: input.outlet_id || null,
    override_log_id: input.override_log_id || randomUUID(),
    created_at: input.created_at || new Date().toISOString()
  };
}

/** @overload @param {ReturnInput} input @returns {ReturnPayloadV3} */
/** @overload @returns {never} */
/** @param {ReturnInput | undefined} [input] @returns {ReturnPayloadV3} */
export function buildReturnPayloadV3(input = /** @type {ReturnInput} */ ({})) {
  if (!input.order_id || !input.return_order_id || !input.shift_id) {
    throw new Error('Order, return order, and open shift are required.');
  }
  return {
    order_id: input.order_id,
    lodge_id: input.lodge_id,
    return_order_id: input.return_order_id,
    shift_id: input.shift_id,
    return_idempotency_key: input.return_idempotency_key || `pos-return:${input.return_order_id}`,
    approval_pin: String(input.pin || input.approval_pin || '').trim(),
    approver_id: input.approver_id || null,
    device_id: input.device_id || 'legacy-pos',
    reason: String(input.reason || '').trim(),
    override_log_id: input.override_log_id || randomUUID(),
    lines: (input.lines || []).map((line) => ({
      line_id: line.line_id || line.id || null,
      quantity: Math.abs(Number(line.quantity) || 0)
    }))
  };
}

/** @overload @param {FinalizeCashupInput} input @returns {FinalizeCashupPayloadV2} */
/** @overload @returns {never} */
/** @param {FinalizeCashupInput | undefined} [input] @returns {FinalizeCashupPayloadV2} */
export function buildFinalizeCashupPayloadV2(input = /** @type {FinalizeCashupInput} */ ({})) {
  const cashupId = input.cashup_id || input.id || randomUUID();
  if (!input.lodge_id || !input.shift_id) {
    throw new Error('Lodge and open shift are required for cash-up.');
  }
  return {
    lodge_id: input.lodge_id,
    shift_id: input.shift_id,
    cashup_id: cashupId,
    idempotency_key: input.idempotency_key || `pos-cashup:${cashupId}`,
    counted_by_method: input.counted_by_method || {},
    notes: input.notes || null
  };
}

// The required input shape describes callers supplying a cash-up record. The
// legacy empty default stays for runtime compatibility and still passes
// missing lodge/date through as undefined if invoked without an argument.
// Omitting input historically returns an envelope with undefined lodge/date;
// retain that call shape while requiring those presence-only fields whenever
// a caller supplies a cash-up record.
/** @overload @param {CashupInput} input @returns {CashupPayload} */
/** @overload @returns {CashupPayload} */
/** @param {CashupInput | undefined} [input] @returns {CashupPayload} */
export function buildCashupPayload(input = /** @type {CashupInput} */ ({})) {
  return {
    id: input.id || randomUUID(),
    lodge_id: input.lodge_id,
    date: input.date,
    outlet_id: input.outlet_id || null,
    opening_float: input.opening_float || 0,
    expected_cash_drawer: input.expected_cash_drawer || 0,
    expected_by_method: input.expected_by_method || {},
    counted_by_method: input.counted_by_method || {},
    variance_by_method: input.variance_by_method || {},
    cash_over_short: input.cash_over_short || 0,
    orders_count: input.orders_count || 0,
    void_count: input.void_count || 0,
    pending_count: input.pending_count || 0,
    gross_sales: input.gross_sales || 0,
    returns_total: input.returns_total || 0,
    net_sales: input.net_sales || 0,
    notes: input.notes || null,
    created_by: input.created_by || null,
    created_by_name: input.created_by_name || null,
    cashier_id: input.cashier_id || null,
    cashier_name: input.cashier_name || null,
    created_at: input.created_at || new Date().toISOString()
  };
}
