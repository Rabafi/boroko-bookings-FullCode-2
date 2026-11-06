// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'

/**
 * Adapter for the established Open Checks screen when Bar local authority is
 * active. It returns only server-authoritative tab projections and refuses
 * mutations whose established UI payload has no equivalent local contract.
 * @param {{query: (name: string, filters?: Record<string, unknown>) => Promise<any>}} bridge
 * @param {{outletId?: string|null}} [scope]
 */
export function createLocalHposOpenChecksApi(bridge, scope = {}) {
  if (!bridge || typeof bridge.query !== 'function') throw new TypeError('The local Bar query bridge is required.')
  return {
    async listActiveTabs() {
      const rows = await loadCompleteBarList((name, filters) => bridge.query(name, filters), 'tabs.list', { status: 'open' })
      const outletId = typeof scope.outletId === 'string' ? scope.outletId : null
      if (!outletId) throw new Error('The local outlet scope is unavailable. Refresh before continuing.')
      return rows.map((row) => {
        if (!row || typeof row.tab_id !== 'string' || !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 1) {
          throw new Error('The local Bar service returned an incomplete tab record. Refresh before continuing.')
        }
        return {
          id: row.tab_id,
          outlet_id: outletId,
          table_name: row.table_label || null,
          tab_name: row.table_label || null,
          waiter_id: row.owner_staff_id || null,
          waiter_name: row.owner_name || null,
          status: row.status,
          tab_version: Number(row.version),
          version: Number(row.version),
          created_at: row.opened_at,
          updated_at: row.opened_at,
          total: row.gross_total,
          financial_complete: true,
          line_count: Number(row.line_count || 0),
          items: []
        }
      })
    },
    async splitBillEvenly() {
      throw new Error('Splitting checks is unavailable in this local build because its original even-split action does not yet have a matching local atomic command. No change was made.')
    },
    async transferTabWaiter() {
      throw new Error('Waiter transfers are unavailable in this local build because manager approval and the original transfer contract are not yet connected to the local authority. No change was made.')
    }
  }
}
