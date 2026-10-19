// @ts-check
import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'enterprise-operations'
const VALID_WORKFLOWS = new Set([
  'custom_website',
  'payment_gateway',
  'channel_manager',
  'guest_messaging',
  'guest_portal',
  'multi_property',
  'revenue_manager',
  'advanced_reporting',
  'guest_crm',
  'operations_compliance',
  'multi_outlet_pos'
])

/** @typedef {Record<string, unknown>} EnterprisePropertyView */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // RPC clients are produced by authClients.applyBackendSession or
  // infrastructure.initializeSupabase; preserve the current unguarded failure if absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} workflowKey @returns {string} */
function assertWorkflow(workflowKey) {
  const key = String(workflowKey || '').trim()
  if (!VALID_WORKFLOWS.has(key)) throw new Error('Unknown Enterprise workflow')
  return key
}

/** @param {string} workflowKey @param {unknown} lodgeId */
function cacheKey(workflowKey, lodgeId) {
  return `${CACHE_KEY}:${lodgeId}:${workflowKey}`
}

/** @param {string} fn @param {Record<string, unknown>} args @returns {Promise<unknown>} */
async function callEnterpriseRpc(fn, args) {
  // Supabase RPC response data is supplied by the SDK as any; keep its JSON result unknown here.
  const { data, error } = await supabaseForDomainRpc().rpc(fn, args)
  if (error) throw error
  const response = /** @type {EnterprisePropertyView | null | undefined} */ (data)
  if (response?.success === false) throw new Error(String(response.error || 'Enterprise operation failed'))
  return data
}

/** @param {unknown} workflowKey @param {unknown} [lodgeIdArg] @returns {Promise<unknown[]>} */
async function _getEnterpriseWorkflowRecords(workflowKey, lodgeIdArg = null) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return []

  try {
    const data = await callEnterpriseRpc('get_enterprise_workflow_records', {
      p_lodge_id: currentLodgeId,
      p_workflow_key: key
    })
    const rows = Array.isArray(data) ? /** @type {unknown[]} */ (data) : []
    writeCache(cacheKey(key, currentLodgeId), rows)
    return rows
  } catch (error) {
    if (lodgeIdArg) throw error
    const cached = readCache(cacheKey(key, currentLodgeId))
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {unknown} workflowKey @param {unknown} [lodgeIdArg] */
export function getEnterpriseWorkflowRecords(workflowKey, lodgeIdArg = null) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  return dedupePromise(`enterpriseWorkflow:${currentLodgeId}:${workflowKey}`, () => _getEnterpriseWorkflowRecords(workflowKey, lodgeIdArg))
}

/** @param {unknown} workflowKey @param {unknown} [record] @param {unknown} [lodgeIdArg] */
export async function upsertEnterpriseWorkflowRecord(workflowKey, record = {}, lodgeIdArg = null) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // Preserve the existing property reads without claiming that the RPC payload was validated.
  const recordView = /** @type {EnterprisePropertyView} */ (record)

  return callEnterpriseRpc('upsert_enterprise_workflow_record', {
    p_lodge_id: currentLodgeId,
    p_workflow_key: key,
    p_record_key: String(recordView.record_key || recordView.key || randomUUID()),
    p_payload: record
  })
}

/** @param {unknown} workflowKey @param {unknown} [event] @param {unknown} [lodgeIdArg] */
export async function appendEnterpriseWorkflowEvent(workflowKey, event = {}, lodgeIdArg = null) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const eventView = /** @type {EnterprisePropertyView} */ (event)

  return callEnterpriseRpc('append_enterprise_workflow_event', {
    p_lodge_id: currentLodgeId,
    p_workflow_key: key,
    p_event_type: String(eventView.event_type || eventView.type || 'note'),
    p_payload: event
  })
}

/** @param {unknown} [payload] */
export async function createPaymentLinkRequest(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_payment_link_request', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}

/** @param {unknown} [payload] */
export async function createChannelSyncItem(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_channel_sync_item', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}

/** @param {unknown} [payload] */
export async function createEnterpriseDocument(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_enterprise_document', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}
