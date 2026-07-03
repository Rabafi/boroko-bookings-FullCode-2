export const FINANCIAL_SYNC_TABLES = new Set([
  'create_booking',
  'create_booking_invoice_group',
  'create_booking_record',
  'reschedule_booking',
  'update_booking',
  'update_booking_status',
  'update_booking_payment',
  'convert_quotation_to_booking',
  'add_booking_charge',
  'delete_booking_charge',
  'create_room_rate_override',
  'update_room_rate_override',
  'delete_room_rate_override',
  'approve_booking_refund',
  'record_customer_credit',
  'apply_customer_credit_to_booking',
  'refund_customer_credit',
  'reverse_customer_credit_entry',
  'create_pos_order',
  'create_pos_order_v3',
  'create_pos_partial_return_with_pin',
  'create_pos_return_v3',
  'void_pos_order',
  'approve_pos_void_with_pin',
  'upsert_pos_cashup',
  'finalize_pos_shift_cashup_v2',
  'create_conference_booking',
  'update_conference_booking',
  'update_conference_booking_payment',
  'delete_conference_booking',
  'create_event_booking',
  'update_event_booking',
  'update_event_payment',
  'cancel_event_booking',
  'add_event_line_item',
  'void_event_line_item',
  'create_expense',
  'update_expense',
  'delete_expense',
  'create_inventory_item',
  'update_inventory_item',
  'delete_inventory_item',
  'add_inventory_purchase',
  'adjust_inventory_stock',
  'create_inventory_stocktake_session',
  'save_inventory_stocktake_counts',
  'post_inventory_stocktake_session',
  'create_supply_item',
  'update_supply_item',
  'delete_supply_item',
  'add_supply_purchase',
  'adjust_supply_stock',
  'save_room_supply_allocations',
  'load_supply_to_room',
  'use_room_supply_stock',
  'return_room_supply_to_store',
  'create_supply_stocktake_session',
  'create_room_supply_stocktake_session',
  'save_supply_stocktake_counts',
  'save_room_supply_stocktake_counts',
  'post_supply_stocktake_session',
  'post_room_supply_stocktake_session',
  'create_room_supply_stocktake_line',
  'update_maintenance_ticket',
  'resolve_maintenance_ticket',
  'add_pool_day_use',
  'update_pool_day_use',
  'delete_pool_day_use'
])

export function pickNextReadySyncItemIndex(
  pending = [],
  completedQueueIds = new Set(),
  failedQueueIds = new Set(),
  isDependencyResolved = null
) {
  const pendingIds = new Set(pending.map((item) => item?._queue_id).filter(Boolean))
  return pending.findIndex((item) => {
    const dependencyId = String(item?._depends_on || '').trim()
    if (!dependencyId) return true
    if (failedQueueIds.has(dependencyId)) return true
    if (completedQueueIds.has(dependencyId)) return true
    if (pendingIds.has(dependencyId)) return false
    // Parent absent from all tracking sets (pending, completed, failed).
    // Consumed in a prior sync run — treat dependency as resolved.
    // Server-side RPC enforces correctness; no need to gate on cache state.
    return true
  })
}

export function isFinancialSyncItem(item = {}) {
  const table = String(item?.table || '').trim()
  return FINANCIAL_SYNC_TABLES.has(table)
}
