// @ts-check
import { state } from '../state.js'
import { requireAdmin } from './infrastructure.js'
import { getRuntimeProductId } from '../../shared/productIdentity.js'

function requireOnline() {
  if (!state.isOnline) throw new Error('Commercial billing requires an online connection')
}

/** @param {unknown} payload @param {string} action */
function assertBillingPayload(payload, action) {
  if (!payload || typeof payload !== 'object') throw new Error(`${action} payload is required`)
  // This view names only the two properties this existing validator reads;
  // missing values still follow the same validation failures below.
  const fields = /** @type {{operation_id?: unknown, reason?: unknown}} */ (payload)
  if (!String(fields.operation_id || '').trim()) throw new Error('A stable operation ID is required for retry-safe billing')
  if (String(fields.reason || '').trim().length < 8) throw new Error('Provide a reason of at least 8 characters')
}

/** @param {string} name @param {unknown} payload @returns {Promise<unknown>} */
async function callBillingRpc(name, payload) {
  const { data, error } = await requireAdmin().rpc(name, { p_payload: payload })
  if (error) throw new Error(error.message)
  // Supabase's rpc data is upstream SDK `any`; preserve the existing result
  // reads without declaring that remote JSON has been validated.
  if (!data?.success) throw new Error(data?.error || 'Commercial billing operation failed')
  return data
}

/** Posts a subscription invoice from the canonical license price snapshot. */
/** @param {unknown} payload @returns {Promise<unknown>} */
export async function generateCommercialInvoice(payload) {
  requireOnline()
  assertBillingPayload(payload, 'Commercial invoice')
  return callBillingRpc('admin_generate_commercial_invoice', payload)
}

/** Records one allocation against one posted commercial invoice. */
/** @param {unknown} payload @returns {Promise<unknown>} */
export async function recordCommercialPayment(payload) {
  requireOnline()
  assertBillingPayload(payload, 'Commercial payment')
  return callBillingRpc('admin_record_commercial_payment', payload)
}

/** @param {{lodgeId?: unknown, productId?: unknown, status?: unknown, limit?: unknown, offset?: unknown}} [filters] @returns {Promise<unknown>} */
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

/**
 * Reads the signed-in property's own subscription ledger through the
 * client-safe RPC.  This deliberately uses the session-bound anon client,
 * never the Command Central service-role client, and returns the structured
 * availability/source metadata so a caller can distinguish an empty ledger
 * from an unavailable authoritative read.
 */
/** @param {unknown} [lodgeId] @param {{lodgeId?: unknown, limit?: unknown, offset?: unknown}} [options] @returns {Promise<unknown>} */
export async function getClientCommercialInvoices(lodgeId = state.lodgeId, options = {}) {
  requireOnline()
  // Accept both the positional lodge-id form used by the IPC facade and the
  // object form used by newer domain callers.
  if (lodgeId && typeof lodgeId === 'object') {
    // Type-only view of the existing object overload; do not treat it as input validation.
    options = /** @type {{lodgeId?: unknown, limit?: unknown, offset?: unknown}} */ (lodgeId)
    lodgeId = options.lodgeId || state.lodgeId
  }
  const { limit = 100, offset = 0 } = options || {}
  const requestedLodgeId = String(lodgeId || '').trim()
  const currentLodgeId = String(state.lodgeId || '').trim()
  if (!requestedLodgeId || !currentLodgeId || requestedLodgeId.toLowerCase() !== currentLodgeId.toLowerCase()) {
    throw new Error('Subscription billing history is limited to the active company.')
  }
  if (!state.supabase) {
    throw new Error('Subscription billing history is unavailable until you sign in again.')
  }

  const { data, error } = await state.supabase.rpc('get_client_commercial_invoices', {
    p_lodge_id: requestedLodgeId,
    p_product_id: getRuntimeProductId(),
    p_limit: limit,
    p_offset: offset
  })
  if (error) {
    throw new Error(`Subscription billing history is unavailable: ${error.message || 'authoritative read failed'}`)
  }
  if (!data || data.success !== true || data.available !== true || !Array.isArray(data.rows)) {
    throw new Error(data?.error || 'Subscription billing history is unavailable.')
  }
  return data
}

/** @returns {Promise<unknown>} */
export async function getCommercialBillingSummary() {
  requireOnline()
  const { data, error } = await requireAdmin().rpc('admin_get_commercial_billing_summary')
  if (error) throw new Error(error.message)
  if (!data?.success) throw new Error(data?.error || 'Commercial billing summary is unavailable')
  return data
}
