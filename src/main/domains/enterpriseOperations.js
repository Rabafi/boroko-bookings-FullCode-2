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

function assertWorkflow(workflowKey) {
  const key = String(workflowKey || '').trim()
  if (!VALID_WORKFLOWS.has(key)) throw new Error('Unknown Enterprise workflow')
  return key
}

function cacheKey(workflowKey) {
  return `${CACHE_KEY}:${workflowKey}`
}

async function callEnterpriseRpc(fn, args) {
  const { data, error } = await state.supabase.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Enterprise operation failed')
  return data
}

async function _getEnterpriseWorkflowRecords(workflowKey) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []

  try {
    const data = await callEnterpriseRpc('get_enterprise_workflow_records', {
      p_lodge_id: currentLodgeId,
      p_workflow_key: key
    })
    const rows = Array.isArray(data) ? data : []
    writeCache(cacheKey(key), rows)
    return rows
  } catch (error) {
    const cached = readCache(cacheKey(key))
    return Array.isArray(cached) ? cached : []
  }
}

export function getEnterpriseWorkflowRecords(workflowKey) {
  return dedupePromise(`enterpriseWorkflow:${workflowKey}`, () => _getEnterpriseWorkflowRecords(workflowKey))
}

export async function upsertEnterpriseWorkflowRecord(workflowKey, record = {}) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('upsert_enterprise_workflow_record', {
    p_lodge_id: currentLodgeId,
    p_workflow_key: key,
    p_record_key: String(record.record_key || record.key || randomUUID()),
    p_payload: record
  })
}

export async function appendEnterpriseWorkflowEvent(workflowKey, event = {}) {
  const key = assertWorkflow(workflowKey)
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('append_enterprise_workflow_event', {
    p_lodge_id: currentLodgeId,
    p_workflow_key: key,
    p_event_type: String(event.event_type || event.type || 'note'),
    p_payload: event
  })
}

export async function createPaymentLinkRequest(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_payment_link_request', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}

export async function createChannelSyncItem(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_channel_sync_item', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}

export async function createEnterpriseDocument(payload = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  return callEnterpriseRpc('create_enterprise_document', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}
