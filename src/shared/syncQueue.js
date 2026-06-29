export const FINANCIAL_SYNC_TABLES = new Set([
  'create_booking',
  'create_booking_record',
  'update_booking',
  'update_booking_status',
  'update_booking_payment',
  'convert_quotation_to_booking',
  'add_booking_charge',
  'delete_booking_charge',
  'approve_booking_refund',
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
