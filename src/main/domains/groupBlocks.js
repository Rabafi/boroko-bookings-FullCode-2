import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'group-blocks'

async function _getAllGroupBlocks() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('rpc', { fn: 'get_group_blocks', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllGroupBlocks = (...args) => dedupePromise('getAllGroupBlocks', () => _getAllGroupBlocks(...args))

export async function createGroupBlock(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_group_block', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function updateGroupBlock(id, payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('update_group_block', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function deleteGroupBlock(id, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('delete_group_block', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  return data
}
