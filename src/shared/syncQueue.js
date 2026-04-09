export function pickNextReadySyncItemIndex(pending = [], completedQueueIds = new Set(), failedQueueIds = new Set()) {
  const pendingIds = new Set(pending.map((item) => item?._queue_id).filter(Boolean))
  return pending.findIndex((item) => {
    const dependencyId = String(item?._depends_on || '').trim()
    if (!dependencyId) return true
    if (failedQueueIds.has(dependencyId)) return true
    if (completedQueueIds.has(dependencyId)) return true
    return !pendingIds.has(dependencyId)
  })
}

export function isFinancialSyncItem(item = {}) {
  const table = String(item?.table || '').trim()
  return new Set([
    'create_booking',
    'create_booking_record',
    'update_booking',
    'update_booking_status',
    'update_booking_payment',
    'add_booking_charge',
    'delete_booking_charge',
    'create_pos_order',
    'void_pos_order',
    'approve_booking_refund'
  ]).has(table)
}
