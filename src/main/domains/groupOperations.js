import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'
import { getAllGroupBlocks } from './groupBlocks.js'

const CACHE_KEY = 'group-operations'

/**
 * List group blocks available for operations.
 * Uses the group blocks contract (not the single-block pickup RPC).
 */
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
      const err = new Error(e?.message || 'Failed to load group blocks; showing cached data')
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

export const getAllGroupOperations = (...args) => dedupePromise('getAllGroupOperations', () => _getAllGroupOperations(...args))

function assertRpcSuccess(data, fallbackMessage) {
  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(data.error || fallbackMessage)
  }
  return data
}

export async function checkinGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await state.supabase.rpc('checkin_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not check in group block')
}

export async function checkoutGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await state.supabase.rpc('checkout_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not check out group block')
}

export async function getGroupBlockPickup(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await state.supabase.rpc('get_group_block_pickup', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not load group pickup')
}

export async function releaseUnsoldGroupRooms(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!blockId) throw new Error('Group block id is required')
  const { data, error } = await state.supabase.rpc('release_unsold_group_rooms', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not release unsold rooms')
}

export async function createBookingsFromRoomingList(listId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!listId) throw new Error('Rooming list id is required')
  const { data, error } = await state.supabase.rpc('create_bookings_from_rooming_list', {
    p_list_id: listId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return assertRpcSuccess(data, 'Could not create bookings from rooming list')
}
