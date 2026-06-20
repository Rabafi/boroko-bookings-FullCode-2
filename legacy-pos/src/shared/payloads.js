import { normalizeMoney, normalizePercent, normalizePositiveQty, buildPosTotals } from './totals.js';

function randomUUID() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function normalizePaymentBreakdown(payments = [], fallbackMethod = 'cash', total = 0) {
  const rows = Array.isArray(payments) ? payments : [];
  const normalized = rows
    .map((row) => ({
      method: String(row?.method || fallbackMethod || 'cash').trim() || 'cash',
      amount: normalizeMoney(row?.amount),
      reference: String(row?.reference || '').trim() || null
    }))
    .filter((row) => row.amount !== 0);
  if (normalized.length === 0 && normalizeMoney(total) !== 0) {
    normalized.push({ method: fallbackMethod || 'cash', amount: normalizeMoney(total), reference: null });
  }
  return normalized;
}

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

export function buildCreatePosOrderPayloadV3(input = {}) {
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
          .map((modifier) => typeof modifier === 'string' ? modifier : modifier?.id)
          .filter(Boolean),
      item_notes: item.item_notes || null
    }))
  };
}

export function buildVoidPayload(input = {}) {
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

export function buildReturnPayloadV3(input = {}) {
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

export function buildFinalizeCashupPayloadV2(input = {}) {
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

export function buildCashupPayload(input = {}) {
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
