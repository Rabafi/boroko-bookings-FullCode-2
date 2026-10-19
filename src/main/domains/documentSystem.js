// @ts-check
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

/** @param {string} subKey */
function cacheKey(subKey) {
  return `${CACHE_KEY}:${subKey}`
}

/** @param {string} operation */
function requireOnline(operation) {
  if (state.isOnline === false) {
    const err = /** @type {Error & {onlineOnly: boolean}} */ (new Error(
      `${operation} requires an internet connection and cannot be completed offline.`
    ))
    err.onlineOnly = true
    throw err
  }
}

/** @param {string} fn @param {Record<string, unknown>} args @returns {Promise<unknown>} */
async function callDocumentRpc(fn, args) {
  if (!state.supabase) {
    throw new Error('Database client is not available')
  }
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc(fn, args)
  if (error) throw new Error(error.message || `${fn} failed`)
  // Supabase's generated RPC result is upstream any; this view does not validate it.
  const response = /** @type {unknown} */ (data)
  const responseView = /** @type {Record<string, unknown> | null | undefined} */ (response)
  if (responseView?.success === false) {
    throw new Error(/** @type {string} */ (responseView.error || `${fn} failed`))
  }
  return response
}

/** @returns {Promise<unknown[]>} */
async function _getAllTemplates() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
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

/** @param {unknown} templateKey @param {unknown} name @param {unknown} documentType @param {unknown} [contentTemplate] @param {unknown} [variables] @param {unknown} [branding] @param {unknown} [numberingPrefix] */
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
  if (!HOTEL_DOCUMENT_TYPES.includes(/** @type {string} */ (documentType))) {
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

/** @param {unknown} templateId @param {unknown} payload */
export async function updateTemplate(templateId, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnline('Update document template')
  const payloadView = /** @type {Record<string, unknown> | null | undefined} */ (payload)
  if (payloadView?.document_type && !HOTEL_DOCUMENT_TYPES.includes(/** @type {string} */ (payloadView.document_type))) {
    throw new Error(
      `Unsupported document type "${payloadView.document_type}". Allowed: ${HOTEL_DOCUMENT_TYPES.join(', ')}`
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

/** @param {unknown} templateId */
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
/** @param {unknown} templateKey @param {unknown} subjectType @param {unknown} subjectId */
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
/** @param {unknown} documentId */
export async function publishDocument(documentId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  requireOnline('Publish document')
  return callDocumentRpc('publish_document', {
    p_document_id: documentId,
    p_lodge_id: currentLodgeId
  })
}

/** @param {unknown} subjectType @param {unknown} subjectId @returns {Promise<unknown[]>} */
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

/** @returns {Promise<unknown | null>} */
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
