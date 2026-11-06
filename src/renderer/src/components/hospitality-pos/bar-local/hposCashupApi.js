// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * Local adapter for the established Cash & Close page. Review approval and
 * the decision are bound to one stable operation and committed atomically by
 * the local authority.
 * @param {any} bridge
 * @param {{outletId?: string|null, outletName?: string|null}} [scope]
 */
export function createLocalHposCashupApi(bridge, scope = {}) {
  if (!bridge || typeof bridge.query !== 'function' || typeof bridge.command !== 'function' || typeof bridge.requestApprovalForCommand !== 'function') {
    throw new TypeError('The local Bar cash-up bridge is incomplete.')
  }
  const outletId = typeof scope.outletId === 'string' ? scope.outletId : null
  const attempted = new Set()
  const confirmed = (result, operationId) => {
    if (result?.outcome !== 'committed_local') {
      const message = result?.error?.message || result?.error?.safe_message || 'The local Bar service did not confirm the cash-up review. Retry the saved review before starting another decision.'
      throw Object.assign(new Error(message), { outcome: result?.outcome || 'unknown', operationId })
    }
    return result
  }
  return {
    async listRecovery() {
      const records = await bridge.getOpenIntents()
      if (!Array.isArray(records)) throw new Error('Saved local reviews could not be checked. Restore the operation journal before reviewing cash-ups.')
      return records.filter((record) => record.command === 'cashup.review')
    },
    async recover(operationId) {
      return confirmed(await bridge.retryOperation(operationId), operationId)
    },
    async listPending() {
      if (!outletId) throw new Error('The local outlet scope is unavailable. Refresh before reviewing cash-ups.')
      const rows = await loadCompleteBarList((name, filters) => bridge.query(name, filters), 'cashup.pending', { outlet_id: outletId })
      return rows.map((row) => {
        if (!row || !nonEmpty(row.cashup_id) || !nonEmpty(row.shift_id) || !nonEmpty(row.staff_id)
          || !nonEmpty(row.counted_cash) || !nonEmpty(row.expected_cash) || row.status !== 'submitted') {
          throw new Error('The local Bar service returned an incomplete submitted cash-up. Refresh before reviewing it.')
        }
        return {
          id: row.cashup_id,
          shift_id: row.shift_id,
          staff_id: row.staff_id,
          cashier_name: row.cashier_name || 'Till operator',
          outlet_id: outletId,
          outlet_name: scope.outletName || 'Service outlet',
          submitted_at: row.submitted_at,
          expected_cash_drawer: row.expected_cash,
          counted_by_method: { cash: row.counted_cash, card: row.counted_card ?? null },
          notes: row.notes || null,
          status: row.status,
          business_date: row.business_date,
          proof_refs: Array.isArray(row.proof_refs) ? row.proof_refs : []
        }
      })
    },
    async review({ cashupId, decision, reason, pin, operationId }) {
      if (!outletId) throw new Error('The local outlet scope is unavailable. Refresh before reviewing cash-ups.')
      if (!nonEmpty(cashupId) || !['approved', 'rejected'].includes(decision) || !nonEmpty(operationId)) {
        throw new Error('The cash-up decision is incomplete. Refresh and try again.')
      }
      if (decision === 'rejected' && !nonEmpty(reason)) throw new Error('Enter a correction note before returning this cash-up.')
      // A second approval would change approval_id in the durable payload.
      // Recover the exact saved envelope once dispatch has been attempted.
      if (attempted.has(operationId)) return confirmed(await bridge.retryOperation(operationId), operationId)
      const open = await bridge.getOpenIntents()
      if (!Array.isArray(open)) throw new Error('Saved local operations could not be checked. Restore the operation journal before reviewing cash-ups.')
      if (open.some((record) => record.operation_id === operationId)) return confirmed(await bridge.retryOperation(operationId), operationId)
      if (open.length) throw new Error('Resolve the earlier saved local operation before starting another cash-up decision.')
      if (!/^\d{4,12}$/.test(String(pin || ''))) throw new Error('Enter the reviewing manager PIN.')
      const payload = { cashup_id: cashupId, decision, reason: String(reason || '').trim() || null }
      let approval
      try {
        approval = await bridge.requestApprovalForCommand({
          command: 'cashup.review', payload, pin: String(pin), operation_id: operationId
        })
        if (!nonEmpty(approval?.approval_id)) throw new Error('Manager approval was not confirmed. Nothing was submitted.')
      } catch (cause) {
        throw Object.assign(new Error(cause?.message || 'Manager approval could not be checked. Nothing was submitted.'), { outcome: 'not_sent', operationId })
      }
      attempted.add(operationId)
      let result
      try {
        result = await bridge.command({
          command: 'cashup.review', payload: { ...payload, approval_id: approval.approval_id }, operation_id: operationId
        })
      } catch (cause) {
        const records = await bridge.getOpenIntents()
        if (Array.isArray(records) && !records.some((record) => record.operation_id === operationId)) {
          attempted.delete(operationId)
          throw Object.assign(new Error(cause?.message || 'The local cash-up review was not dispatched.'), { outcome: 'not_sent', operationId })
        }
        throw cause
      }
      return confirmed(result, operationId)
    }
  }
}

/** Blind-count adapter for the existing My Cash-up page. */
export function createLocalHposMyCashupApi(bridge, scope) {
  const committed = (result, operationId) => {
    if (result?.outcome !== 'committed_local') {
      throw Object.assign(new Error(result?.error?.message || 'The cash-up handover is not confirmed. Recover its saved operation before submitting again.'), {
        outcome: result?.outcome || 'unknown', operationId
      })
    }
    return result
  }
  return {
    async openOperations() {
      const records = await bridge.getOpenIntents()
      if (!Array.isArray(records)) throw new Error('Saved local operations could not be checked. Restore the operation journal before submitting your count.')
      return records
    },
    async readMine() {
      if (!scope.outletId || !scope.staffId) throw new Error('Your local staff or outlet scope is unavailable. Sign in again before counting.')
      const result = await bridge.query('cashup.mine', { outlet_id: scope.outletId })
      if (result?.complete !== true || !result.data || typeof result.data !== 'object'
        || result.pagination?.has_more === true || result.scope?.outlet_id !== scope.outletId
        || result.scope?.actor_staff_id !== scope.staffId) {
        throw new Error('Your local cash-up state is incomplete or belongs to a different session. Refresh before submitting a count.')
      }
      const { shift, submission } = result.data
      if (shift && (shift.staff_id !== scope.staffId || !Number.isSafeInteger(shift.version) || shift.version < 1)) {
        throw new Error('Your local shift identity or version is invalid. Refresh before counting.')
      }
      return { shift: shift || null, submission: submission || null }
    },
    async submit({ shiftId, shiftVersion, countedCash, notes, operationId }) {
      const open = await this.openOperations()
      if (open.some((record) => record.operation_id === operationId)) return this.recover(operationId)
      if (open.length) throw new Error('Resolve the earlier saved local operation before submitting another cash-up.')
      if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(String(countedCash))) throw new Error('Enter a non-negative physical cash count with up to two decimal places.')
      return committed(await bridge.command({ command: 'cashup.handover', operation_id: operationId, payload: {
        shift_id: shiftId, expected_shift_version: shiftVersion, counted_cash: String(countedCash), notes: String(notes || '').trim() || null
      } }), operationId)
    },
    async recover(operationId) {
      return committed(await bridge.retryOperation(operationId), operationId)
    }
  }
}
