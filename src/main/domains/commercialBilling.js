import { state } from '../state.js'
import { requireAdmin } from './infrastructure.js'

function requireOnline() {
  if (!state.isOnline) throw new Error('Commercial billing requires an online connection')
}

function assertBillingPayload(payload, action) {
  if (!payload || typeof payload !== 'object') throw new Error(`${action} payload is required`)
  if (!String(payload.operation_id || '').trim()) throw new Error('A stable operation ID is required for retry-safe billing')
  if (String(payload.reason || '').trim().length < 8) throw new Error('Provide a reason of at least 8 characters')
}

async function callBillingRpc(name, payload) {
  const { data, error } = await requireAdmin().rpc(name, { p_payload: payload })
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Commercial billing operation failed')
  return data
}

/** Posts a subscription invoice from the canonical license price snapshot. */
export async function generateCommercialInvoice(payload) {
  requireOnline()
  assertBillingPayload(payload, 'Commercial invoice')
  return callBillingRpc('admin_generate_commercial_invoice', payload)
}

/** Records one allocation against one posted commercial invoice. */
export async function recordCommercialPayment(payload) {
  requireOnline()
  assertBillingPayload(payload, 'Commercial payment')
  return callBillingRpc('admin_record_commercial_payment', payload)
}

export async function listCommercialInvoices({ lodgeId = null, productId = null, status = null, limit = 200, offset = 0 } = {}) {
  requireOnline()
  const { data, error } = await requireAdmin().rpc('admin_list_commercial_invoices', {
    p_lodge_id: lodgeId || null,
    p_product_id: productId || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset
  })
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Commercial invoices are unavailable')
  return data
}

export async function getCommercialBillingSummary() {
  requireOnline()
  const { data, error } = await requireAdmin().rpc('admin_get_commercial_billing_summary')
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Commercial billing summary is unavailable')
  return data
}
