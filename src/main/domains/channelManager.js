import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './cacheStore.js'

const CACHE_KEY = 'channel-manager'

function cacheKey(subKey) {
  return `${CACHE_KEY}:${subKey}`
}

async function callChannelRpc(fn, args) {
  const { data, error } = await state.supabase.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Channel manager operation failed')
  return data
}

async function _getAllMappings() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const data = await callChannelRpc('get_channel_dashboard', { p_lodge_id: currentLodgeId })
    const rows = Array.isArray(data) ? data : []
    writeCache(cacheKey('mappings'), rows)
    return rows
  } catch (error) {
    const cached = readCache(cacheKey('mappings'))
    return Array.isArray(cached) ? cached : []
  }
}

export function getAllMappings() {
  return dedupePromise('channelMappings:getAll', () => _getAllMappings())
}

export async function createMapping(channelKey, sourceType, localId, channelCode = null, channelName = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('create_channel_mapping', {
    p_lodge_id: currentLodgeId,
    p_channel_key: channelKey,
    p_source_type: sourceType,
    p_local_id: localId,
    p_channel_code: channelCode,
    p_channel_name: channelName
  })
  writeCache(cacheKey('mappings'), [])
  return result
}

export async function updateMapping(mappingId, channelCode = null, channelName = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('update_channel_mapping', {
    p_lodge_id: currentLodgeId,
    p_mapping_id: mappingId,
    p_channel_code: channelCode,
    p_channel_name: channelName
  })
  writeCache(cacheKey('mappings'), [])
  return result
}

export async function deleteMapping(mappingId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('delete_channel_mapping', {
    p_lodge_id: currentLodgeId,
    p_mapping_id: mappingId
  })
  writeCache(cacheKey('mappings'), [])
  return result
}

async function _getAllConfigs() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const data = await callChannelRpc('get_channel_dashboard', { p_lodge_id: currentLodgeId })
    const channels = Array.isArray(data?.channels) ? data.channels : []
    writeCache(cacheKey('configs'), channels)
    return channels
  } catch (error) {
    const cached = readCache(cacheKey('configs'))
    return Array.isArray(cached) ? cached : []
  }
}

export function getAllConfigs() {
  return dedupePromise('channelConfigs:getAll', () => _getAllConfigs())
}

export async function createConfig(channelKey, channelLabel = null, enabled = true, syncAvailability = true, syncRates = false, importReservations = false, credentials = {}, settings = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('create_channel_config', {
    p_lodge_id: currentLodgeId,
    p_channel_key: channelKey,
    p_channel_label: channelLabel,
    p_enabled: enabled,
    p_sync_availability: syncAvailability,
    p_sync_rates: syncRates,
    p_import_reservations: importReservations,
    p_credentials: credentials,
    p_settings: settings
  })
  writeCache(cacheKey('configs'), [])
  return result
}

export async function updateConfig(configId, payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('update_channel_config', {
    p_lodge_id: currentLodgeId,
    p_config_id: configId,
    p_payload: payload
  })
  writeCache(cacheKey('configs'), [])
  return result
}

export async function enableChannel(channelKey) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('enable_channel', {
    p_lodge_id: currentLodgeId,
    p_channel_key: channelKey
  })
  writeCache(cacheKey('configs'), [])
  return result
}

export async function disableChannel(channelKey) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const result = await callChannelRpc('disable_channel', {
    p_lodge_id: currentLodgeId,
    p_channel_key: channelKey
  })
  writeCache(cacheKey('configs'), [])
  return result
}

async function _getChannelDashboard() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const data = await callChannelRpc('get_channel_dashboard', { p_lodge_id: currentLodgeId })
    writeCache(cacheKey('dashboard'), data)
    return data
  } catch (error) {
    const cached = readCache(cacheKey('dashboard'))
    return cached || null
  }
}

export function getChannelDashboard() {
  return dedupePromise('channelDashboard:get', () => _getChannelDashboard())
}

export async function processSyncQueue(channelKey = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callChannelRpc('process_channel_sync_queue', {
    p_lodge_id: currentLodgeId,
    p_channel_key: channelKey
  })
}

export async function importReservation(payload) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callChannelRpc('import_channel_reservation', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
}

export async function confirmImport(importId) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callChannelRpc('confirm_channel_import', {
    p_import_id: importId,
    p_lodge_id: currentLodgeId
  })
}

export async function rejectImport(importId, reason = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callChannelRpc('reject_channel_import', {
    p_import_id: importId,
    p_lodge_id: currentLodgeId,
    p_reason: reason
  })
}
