// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/** @param {any} bridge @param {{outletId?: string|null, staffId?: string|null}} scope */
export function createLocalHposMySalesApi(bridge, scope = {}) {
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : ''
  const staffId = typeof scope.staffId === 'string' ? scope.staffId : ''
  if (!bridge || typeof bridge.query !== 'function' || !outletId || !staffId) {
    throw new Error('Your local staff and outlet scope is unavailable. Sign in again before viewing My Sales.')
  }
  return {
    async list({ from, to }) {
      const rows = await loadCompleteBarList(async (name, filters) => {
        const result = await bridge.query(name, filters)
        if (!isRecord(result?.scope) || result.scope.outlet_id !== outletId || result.scope.actor_staff_id !== staffId) {
          throw new Error('The local receipt query belongs to a different business outlet or operator. Sign in again before viewing history.')
        }
        return result
      }, 'sales.mine', { from, to, limit: 200 })
      return rows.map((row) => {
        if (!isRecord(row) || row.actor_staff_id !== staffId || !nonEmpty(row.id)
          || typeof row.receipt_number !== 'string' || !/^[1-9]\d{0,18}$/.test(row.receipt_number) || !nonEmpty(row.business_date)
          || !['completed', 'voided', 'returned'].includes(row.status)
          || !Array.isArray(row.payment_breakdown) || !Array.isArray(row.pos_order_items)) {
          throw new Error('The local service returned an invalid or foreign receipt. Refresh before relying on this history.')
        }
        return { ...row, outlet_id: outletId, transaction_type: row.transaction_type || (row.status === 'returned' ? 'return' : null) }
      })
    }
  }
}
