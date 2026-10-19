// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'group-blocks'

/** @returns {Promise<unknown[]>} */
async function _getAllGroupBlocks() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    // This existing call is unconditional; the type-only view preserves its native failure if initialization has not provided a client.
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('rpc', { fn: 'get_group_blocks', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    // Supabase SDK RPC data is upstream any; rows have no local runtime validator.
    const rows = /** @type {unknown[]} */ (Array.isArray(data) ? data : [])
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    // The cache reader is untrusted; preserve the existing array-only fallback.
    return Array.isArray(cached) ? /** @type {unknown[]} */ (cached) : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown[]>} */
export const getAllGroupBlocks = (...args) => {
  // This dedicated key's factory returns [] or array-only RPC/cache rows.
  return /** @type {Promise<unknown[]>} */ (dedupePromise('getAllGroupBlocks', () => _getAllGroupBlocks()))
}

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createGroupBlock(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // The type-only client view preserves this unconditional property access.
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_group_block', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function updateGroupBlock(id, payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // The type-only client view preserves this unconditional property access.
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_group_block', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} id @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function deleteGroupBlock(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // The type-only client view preserves this unconditional property access.
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('delete_group_block', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}
