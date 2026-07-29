import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './cacheStore.js'

const CACHE_KEY = 'document-system'

/** Schema-backed hotel operational document types (document_templates.check). */
export const HOTEL_DOCUMENT_TYPES = [
  'folio',
  'invoice',
  'registration_card',
  'statement',
  'receipt',
  'contract',
  'cancellation_note'
]

/** Alias for Hotel Core operational document coverage checks. */
export const HOTEL_CORE_DOCUMENT_TYPES = HOTEL_DOCUMENT_TYPES

function cacheKey(subKey) {
  return `${CACHE_KEY}:${subKey}`
}

function requireOnline(operation) {
  if (state.isOnline === false) {
    const err = new Error(
      `${operation} requires an internet connection and cannot be completed offline.`
    )
    err.onlineOnly = true
    throw err
  }
}

async function callDocumentRpc(fn, args) {
  if (!state.supabase) {
    throw new Error('Database client is not available')
  }
  const { data, error } = await state.supabase.rpc(fn, args)
  if (error) throw new Error(error.message || `${fn} failed`)
  if (data?.success === false) {
    throw new Error(data.error || `${fn} failed`)
  }
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

export async function createTemplate(
  templateKey,
  name,
  documentType,
  contentTemplate = {},
  variables = [],
  branding = {},
  numberingPrefix = null
) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnline('Create document template')
  if (!HOTEL_DOCUMENT_TYPES.includes(documentType)) {
    throw new Error(
      `Unsupported document type "${documentType}". Allowed: ${HOTEL_DOCUMENT_TYPES.join(', ')}`
    )
  }
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
  requireOnline('Update document template')
  if (payload?.document_type && !HOTEL_DOCUMENT_TYPES.includes(payload.document_type)) {
    throw new Error(
      `Unsupported document type "${payload.document_type}". Allowed: ${HOTEL_DOCUMENT_TYPES.join(', ')}`
    )
  }
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
  requireOnline('Delete document template')
  const result = await callDocumentRpc('delete_document_template', {
    p_lodge_id: currentLodgeId,
    p_template_id: templateId
  })
  writeCache(cacheKey('templates'), [])
  return result
}

/**
 * Renders a draft document via authoritative RPC (server numbering + row insert).
 * Draft render is online-only in the current contract (not offline-queueable).
 */
export async function renderDocument(templateKey, subjectType, subjectId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnline('Render document draft')
  return callDocumentRpc('render_document', {
    p_template_key: templateKey,
    p_lodge_id: currentLodgeId,
    p_subject_type: subjectType,
    p_subject_id: subjectId
  })
}

/**
 * Publish is ONLINE-ONLY (docs/OFFLINE_MATRIX.md). Must never be queued offline.
 */
export async function publishDocument(documentId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnline('Publish document')
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
