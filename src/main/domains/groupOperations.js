// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'
import { getAllGroupBlocks } from './groupBlocks.js'

const CACHE_KEY = 'group-operations'

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve the existing unguarded RPC dereference if session/client setup is absent.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} message @returns {Error} */
function errorWithUnknownMessage(message) {
  // Reflect.construct uses Error's existing native message coercion with the
  // original unknown value; it avoids falsely declaring arbitrary thrown data a string.
  return Reflect.construct(Error, [message])
}

/** @param {unknown} error @returns {unknown} */
function readErrorMessage(error) {
  if (error === null || error === undefined) return undefined
  // This is a type-only view of the same native property read: inherited
  // properties, primitive boxing, and accessors retain their prior semantics.
  return /** @type {Record<string, unknown>} */ (error).message
}

/**
 * List group blocks available for operations.
 * Uses the group blocks contract (not the single-block pickup RPC).
 */
/** @returns {Promise<unknown>} */
async function _getAllGroupOperations() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const rows = await getAllGroupBlocks()
    const list = Array.isArray(rows) ? rows : []
    writeCache(CACHE_KEY, list)
    return list
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = errorWithUnknownMessage(readErrorMessage(e) || 'Failed to load group blocks; showing cached data')
      const staleError = /** @type {Error & {code: string, cached: unknown[]}} */ (err)
      staleError.code = 'STALE_CACHE'
      staleError.cached = /** @type {unknown[]} */ (cached)
      throw staleError
    }
    throw e
  }
}

/** @param {...unknown} args @returns {Promise<unknown>} */
export const getAllGroupOperations = (...args) => dedupePromise('getAllGroupOperations', () => _getAllGroupOperations())

/** @param {unknown} data @param {string} fallbackMessage @returns {unknown} */
function assertRpcSuccess(data, fallbackMessage) {
  if (data && typeof data === 'object') {
    // This view types the two existing envelope reads after the existing
    // object guard; it does not claim the RPC payload was validated.
    const envelope = /** @type {Record<string, unknown>} */ (data)
    if (envelope.success === false) throw errorWithUnknownMessage(envelope.error || fallbackMessage)
  }
  return data
}

/** @param {unknown} blockId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function checkinGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await supabaseForDomainRpc().rpc('checkin_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not check in group block')
}

/** @param {unknown} blockId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function checkoutGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await supabaseForDomainRpc().rpc('checkout_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not check out group block')
}

/** @param {unknown} blockId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function getGroupBlockPickup(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await supabaseForDomainRpc().rpc('get_group_block_pickup', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not load group pickup')
}

/** @param {unknown} blockId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function releaseUnsoldGroupRooms(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await supabaseForDomainRpc().rpc('release_unsold_group_rooms', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not release unsold rooms')
}

/** @param {unknown} listId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createBookingsFromRoomingList(listId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!listId) throw new Error('Rooming list id is required')
  const { data, error } = await supabaseForDomainRpc().rpc('create_bookings_from_rooming_list', {
    p_list_id: listId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not create bookings from rooming list')
}
