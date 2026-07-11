import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'group-operations'

async function _getAllGroupOperations() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('rpc', { fn: 'get_group_block_pickup', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllGroupOperations = (...args) => dedupePromise('getAllGroupOperations', () => _getAllGroupOperations(...args))

export async function checkinGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('checkin_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return data
}

export async function checkoutGroupBlock(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('checkout_group_block', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return data
}

export async function getGroupBlockPickup(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('get_group_block_pickup', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}

export async function releaseUnsoldGroupRooms(blockId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('release_unsold_group_rooms', {
    p_block_id: blockId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return data
}

export async function createBookingsFromRoomingList(listId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_bookings_from_rooming_list', {
    p_list_id: listId,
    p_lodge_id: currentLodgeId,
    p_actor_id: state.user?.id || null
  })
  if (error) throw error
  return data
}
