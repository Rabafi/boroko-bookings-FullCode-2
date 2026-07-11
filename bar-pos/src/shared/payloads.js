export function buildBarOrderPayload({ items, payments, total, serviceMode, customerName, outletId, lodgeId, userId }) {
  return { items: (items || []).map(i => ({ menu_item_id: i.menu_item_id || null, inventory_item_id: i.inventory_item_id || null, item_name: String(i.item_name || '').trim(), quantity: Number(i.quantity || 0), unit_price: Number(i.unit_price || 0), depletion_qty: Number(i.depletion_qty || 1) })), payments: (payments || []).map(p => ({ method: p.method, amount: Number(p.amount || 0) })), total: Number(total || 0), service_mode: serviceMode || 'counter', customer_name: customerName || null, outlet_id: outletId || null, lodge_id: lodgeId, created_by: userId }
}

export function buildVoidPayload({ orderId, reason, voidedBy, lodgeId }) {
  return { order_id: orderId, reason: String(reason || '').trim(), voided_by: voidedBy, lodge_id: lodgeId, created_at: new Date().toISOString() }
}

export function buildCashUpPayload({ floatAmount, countedAmount, declaredAmount, expectedAmount, variances, notes, outletId, lodgeId, userId }) {
  return { float_amount: Number(floatAmount || 0), counted_amount: Number(countedAmount || 0), declared_amount: Number(declaredAmount || 0), expected_amount: Number(expectedAmount || 0), variances: variances || [], notes: notes || null, outlet_id: outletId, lodge_id: lodgeId, closed_by: userId, closed_at: new Date().toISOString() }
}

export function buildStockAdjustmentPayload({ inventoryItemId, quantity, reason, lodgeId, userId }) {
  return { inventory_item_id: inventoryItemId, quantity: Number(quantity || 0), reason: String(reason || '').trim(), lodge_id: lodgeId, adjusted_by: userId, created_at: new Date().toISOString() }
}
