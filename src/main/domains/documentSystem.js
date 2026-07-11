import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './cacheStore.js'

const CACHE_KEY = 'document-system'

function cacheKey(subKey) {
  return `${CACHE_KEY}:${subKey}`
}

async function callDocumentRpc(fn, args) {
  const { data, error } = await state.supabase.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Document system operation failed')
  return data
}

async function _getAllTemplates() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase
      .from('document_templates')
      .select('*')
      .eq('lodge_id', currentLodgeId)
      .order('name')
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(cacheKey('templates'), rows)
    return rows
  } catch (error) {
    const cached = readCache(cacheKey('templates'))
    return Array.isArray(cached) ? cached : []
  }
}

export function getAllTemplates() {
  return dedupePromise('documentTemplates:getAll', () => _getAllTemplates())
}

export async function createTemplate(templateKey, name, documentType, contentTemplate = {}, variables = [], branding = {}, numberingPrefix = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callDocumentRpc('create_document_template', {
    p_lodge_id: currentLodgeId,
    p_template_key: templateKey,
    p_name: name,
    p_document_type: documentType,
    p_content_template: contentTemplate,
    p_variables: variables,
    p_branding: branding,
    p_numbering_prefix: numberingPrefix
  })
  writeCache(cacheKey('templates'), [])
  return result
}

export async function updateTemplate(templateId, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callDocumentRpc('update_document_template', {
    p_lodge_id: currentLodgeId,
    p_template_id: templateId,
    p_payload: payload
  })
  writeCache(cacheKey('templates'), [])
  return result
}

export async function deleteTemplate(templateId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callDocumentRpc('delete_document_template', {
    p_lodge_id: currentLodgeId,
    p_template_id: templateId
  })
  writeCache(cacheKey('templates'), [])
  return result
}

export async function renderDocument(templateKey, subjectType, subjectId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callDocumentRpc('render_document', {
    p_template_key: templateKey,
    p_lodge_id: currentLodgeId,
    p_subject_type: subjectType,
    p_subject_id: subjectId
  })
}

export async function publishDocument(documentId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callDocumentRpc('publish_document', {
    p_document_id: documentId,
    p_lodge_id: currentLodgeId
  })
}

export async function getDocumentHistory(subjectType, subjectId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const data = await callDocumentRpc('get_document_history', {
      p_lodge_id: currentLodgeId,
      p_subject_type: subjectType,
      p_subject_id: subjectId
    })
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function _getDocumentDashboard() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const data = await callDocumentRpc('get_document_dashboard', { p_lodge_id: currentLodgeId })
    writeCache(cacheKey('dashboard'), data)
    return data
  } catch (error) {
    const cached = readCache(cacheKey('dashboard'))
    return cached || null
  }
}

export function getDocumentDashboard() {
  return dedupePromise('documentDashboard:get', () => _getDocumentDashboard())
}
