import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const TEMPLATES_CACHE = 'guest-message-templates'
const TRIGGERS_CACHE = 'guest-message-triggers'

async function _getAllTemplates() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_guest_message_templates', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(TEMPLATES_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(TEMPLATES_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllTemplates = (...args) => dedupePromise('getAllTemplates', () => _getAllTemplates(...args))

export async function createTemplate(data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_message_template', {
    p_lodge_id: currentLodgeId,
    p_template_key: data.template_key,
    p_name: data.name,
    p_subject_template: data.subject_template || '',
    p_body_template: data.body_template || '',
    p_channel: data.channel || 'email',
    p_variables: data.variables || [],
    p_category: data.category || 'custom'
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not create template')
  return result
}

export async function updateTemplate(id, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_message_template', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_data: data
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update template')
  return result
}

export async function deleteTemplate(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_message_template', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not delete template')
  return result
}

async function _getAllTriggers() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_guest_message_triggers', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(TRIGGERS_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(TRIGGERS_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllTriggers = (...args) => dedupePromise('getAllTriggers', () => _getAllTriggers(...args))

export async function createTrigger(data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_message_trigger', {
    p_lodge_id: currentLodgeId,
    p_trigger_event: data.trigger_event,
    p_template_id: data.template_id,
    p_delay_minutes: data.delay_minutes || 0,
    p_channel: data.channel || 'email'
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not create trigger')
  return result
}

export async function updateTrigger(id, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_message_trigger', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_data: data
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update trigger')
  return result
}

export async function deleteTrigger(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_message_trigger', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not delete trigger')
  return result
}

export async function renderTemplate(templateId, variables) {
  const { data, error } = await state.supabase.rpc('render_message_template', {
    p_template_id: templateId,
    p_variables: variables || {}
  })
  if (error) throw error
  return data
}

export async function queueTriggeredMessages(triggerEvent, variables) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('queue_triggered_messages', {
    p_lodge_id: currentLodgeId,
    p_trigger_event: triggerEvent,
    p_variables: variables || {}
  })
  if (error) throw error
  return data
}

export async function getDeliveryStatus(status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_message_delivery_status', {
    p_lodge_id: currentLodgeId,
    p_status: status || null
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
