// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

/** @typedef {(...args: unknown[]) => Promise<unknown>} NoArgListReader */

// ── Lost & Found ──────────────────────────────────────────────────────────
const LOST_FOUND_CACHE = 'lost-found-items'

/** @returns {Promise<unknown[]>} */
async function _getAllLostFoundItems() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_lost_found_items', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(LOST_FOUND_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(LOST_FOUND_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllLostFoundItems = (...args) => dedupePromise('getAllLostFoundItems', () => /** @type {NoArgListReader} */ (_getAllLostFoundItems)(...args))

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createLostFoundItem(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_lost_found_item', { p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function updateLostFoundItem(id, payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_lost_found_item', { p_id: id, p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function deleteLostFoundItem(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('delete_lost_found_item', { p_id: id, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

// ── Incident Log ──────────────────────────────────────────────────────────
const INCIDENT_CACHE = 'incident-logs'

/** @returns {Promise<unknown[]>} */
async function _getAllIncidents() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_incident_logs', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(INCIDENT_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(INCIDENT_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllIncidents = (...args) => dedupePromise('getAllIncidents', () => /** @type {NoArgListReader} */ (_getAllIncidents)(...args))

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createIncident(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_incident_log', { p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function updateIncident(id, payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('update_incident_log', { p_id: id, p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

// ── Visitor Register ──────────────────────────────────────────────────────
const VISITOR_CACHE = 'visitor-registrations'

/** @returns {Promise<unknown[]>} */
async function _getAllVisitors() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_visitor_registrations', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(VISITOR_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(VISITOR_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllVisitors = (...args) => dedupePromise('getAllVisitors', () => /** @type {NoArgListReader} */ (_getAllVisitors)(...args))

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createVisitor(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_visitor_registration', { p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function checkoutVisitor(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('checkout_visitor', { p_id: id, p_lodge_id: currentLodgeId })
  if (error) throw error
  return data
}

// ── Linen & Laundry ───────────────────────────────────────────────────────
const LINEN_CACHE = 'linen-items'
const LINEN_BATCH_CACHE = 'linen-laundry-batches'

/** @returns {Promise<unknown[]>} */
async function _getAllLinenItems() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_linen_items', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(LINEN_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(LINEN_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllLinenItems = (...args) => dedupePromise('getAllLinenItems', () => /** @type {NoArgListReader} */ (_getAllLinenItems)(...args))

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createLinenItem(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_linen_item', { p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}

/** @returns {Promise<unknown[]>} */
async function _getAllLinenBatches() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('get_linen_laundry_batches', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(LINEN_BATCH_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(LINEN_BATCH_CACHE)
    return Array.isArray(cached) ? cached : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllLinenBatches = (...args) => dedupePromise('getAllLinenBatches', () => /** @type {NoArgListReader} */ (_getAllLinenBatches)(...args))

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createLinenBatch(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('create_linen_laundry_batch', { p_lodge_id: currentLodgeId, p_payload: payload })
  if (error) throw error
  return data
}
