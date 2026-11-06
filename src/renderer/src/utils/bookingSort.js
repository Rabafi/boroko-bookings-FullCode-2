/** @typedef {{created_at?: string|null, check_in?: string|null, room_number?: string|number|null, invoice_number?: string|null, _local_invoice_number?: string|null, id?: string|null}} BookingSortRow */

/** @param {string|null|undefined} value */
function timestamp(value) {
  const parsed = value ? new Date(value).getTime() : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/** @param {unknown} value */
function safeText(value) {
  return String(value || '')
}

/**
 * Sort booking rows by the selected primary field. Tied rows use their issued
 * invoice number (natural numeric order), then immutable booking ID so results
 * do not depend on backend/input order.
 * @param {BookingSortRow[]} rows
 * @param {string} sortBy
 */
export function sortBookingRows(rows, sortBy) {
  const primary = (left, right) => {
    switch (sortBy) {
      case 'created_asc':
        return timestamp(left.created_at) - timestamp(right.created_at)
      case 'check_in_asc':
        return timestamp(left.check_in) - timestamp(right.check_in)
      case 'check_in_desc':
        return timestamp(right.check_in) - timestamp(left.check_in)
      case 'room_asc':
        return safeText(left.room_number).localeCompare(safeText(right.room_number), undefined, { numeric: true, sensitivity: 'base' })
      case 'created_desc':
      default:
        return timestamp(right.created_at) - timestamp(left.created_at)
    }
  }

  return [...rows].sort((left, right) => {
    const primaryOrder = primary(left, right)
    if (primaryOrder) return primaryOrder
    const leftInvoice = safeText(left.invoice_number || left._local_invoice_number)
    const rightInvoice = safeText(right.invoice_number || right._local_invoice_number)
    const invoiceOrder = leftInvoice.localeCompare(rightInvoice, undefined, { numeric: true, sensitivity: 'base' })
    if (invoiceOrder) return invoiceOrder
    return safeText(left.id).localeCompare(safeText(right.id), undefined, { numeric: true, sensitivity: 'base' })
  })
}
