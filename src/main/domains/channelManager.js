import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './cacheStore.js'
import {
  isManualChannel,
  processSyncItem,
  resolveProvider,
  pushAvailability,
  pushRates,
  fetchReservations
} from './channelProviderAdapter.js'

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
    // Dashboard may return channels only; mappings may be nested or separate.
    const rows = Array.isArray(data?.mappings)
      ? data.mappings
      : Array.isArray(data)
        ? data
        : []
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

function configByChannel(configs, channelKey) {
  const key = String(channelKey || '').toLowerCase()
  return (configs || []).find((c) => String(c.channel_key || '').toLowerCase() === key) || null
}

/**
 * Process the channel sync queue.
 * - Manual channel: ManualExportProvider writes real local export artifacts.
 * - Live OTA: adapter fails closed; server RPC (when online) keeps items in manual review.
 * Never reports provider_connected:true for uncertified live OTAs.
 */
export async function processSyncQueue(channelKey = null) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')

  let configs = []
  let pendingItems = []
  try {
    const dashboard = await _getChannelDashboard()
    configs = Array.isArray(dashboard?.channels) ? dashboard.channels : await _getAllConfigs()
    pendingItems = Array.isArray(dashboard?.pending_sync_items) ? dashboard.pending_sync_items : []
  } catch {
    configs = await _getAllConfigs().catch(() => [])
  }

  if (channelKey) {
    pendingItems = pendingItems.filter(
      (item) => String(item.channel_key || '').toLowerCase() === String(channelKey).toLowerCase()
    )
  }

  const adapterResults = []
  let manualExported = 0
  let notConnectedCount = 0
  let deadLettered = 0
  let retried = 0

  // When no pending items are visible (e.g. offline cache), still probe the
  // requested channel so UI/tests see honest not-connected / manual export status.
  const probeKeys = channelKey
    ? [channelKey]
    : [...new Set((configs || []).map((c) => c.channel_key).filter(Boolean))]

  if (pendingItems.length === 0 && probeKeys.length > 0) {
    for (const key of probeKeys) {
      const cfg = configByChannel(configs, key)
      const resolved = resolveProvider(key, cfg)
      if (resolved.kind === 'manual_export') {
        const result = await processSyncItem(
          { channel_key: key, sync_type: 'availability', payload: { probe: true, lodge_id: currentLodgeId } },
          cfg
        )
        adapterResults.push({ channel_key: key, ...result })
        if (result.success && result.manual_export) manualExported += 1
      } else {
        const result = await pushAvailability(key, { probe: true })
        adapterResults.push({ channel_key: key, ...result })
        if (!result.provider_connected) notConnectedCount += 1
      }
    }
  }

  for (const item of pendingItems) {
    const cfg = configByChannel(configs, item.channel_key)
    const result = await processSyncItem(item, cfg)
    const retryCount = Number(item.retry_count ?? item.retries ?? 0)
    const maxRetries = Number(item.max_retries ?? 3)
    const isDeadLetter =
      item.status === 'dead_letter' ||
      item.dead_lettered === true ||
      (retryCount >= maxRetries && !result.success)

    if (isDeadLetter) {
      deadLettered += 1
      adapterResults.push({
        item_id: item.id,
        channel_key: item.channel_key,
        dead_letter: true,
        retry_count: retryCount,
        ...result
      })
      continue
    }

    if (retryCount > 0) retried += 1

    adapterResults.push({
      item_id: item.id,
      channel_key: item.channel_key,
      retry_count: retryCount,
      ...result
    })

    if (result.manual_export && result.success) {
      manualExported += 1
    } else if (result.provider_connected !== true) {
      notConnectedCount += 1
    }
  }

  // Authoritative server pass: fail-closed manual review for live queue items.
  // Manual export artifacts above are local work; server still owns queue status.
  let serverResult = null
  if (state.isOnline && state.supabase) {
    try {
      serverResult = await callChannelRpc('process_channel_sync_queue', {
        p_lodge_id: currentLodgeId,
        p_channel_key: channelKey
      })
    } catch (err) {
      serverResult = {
        success: false,
        error: err?.message || 'process_channel_sync_queue failed',
        provider_connected: false
      }
    }
  }

  const anyLiveConnected = adapterResults.some((r) => r.provider_connected === true && r.provider_kind === 'live_ota')
  const serverConnected = serverResult?.provider_connected === true

  return {
    success: true,
    processed: Number(serverResult?.processed || 0),
    failed: Number(serverResult?.failed || 0),
    manual_review_required: Number(serverResult?.manual_review_required || notConnectedCount || 0),
    manual_exported: manualExported,
    not_connected: notConnectedCount,
    dead_lettered: deadLettered,
    retried,
    provider_connected: Boolean(anyLiveConnected || serverConnected),
    adapter_results: adapterResults,
    server: serverResult,
    message:
      manualExported > 0 && notConnectedCount === 0
        ? `Manual export produced ${manualExported} artifact(s); live OTA delivery was not claimed.`
        : serverResult?.message ||
          (notConnectedCount > 0
            ? 'Live OTA provider adapter is not connected; items require manual review.'
            : 'Channel sync queue processed.')
  }
}

/** Push availability for a channel via the adapter boundary. */
export async function pushChannelAvailability(channelKey, payload = {}) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  if (isManualChannel(channelKey)) {
    return pushAvailability(channelKey, { ...payload, lodge_id: state.lodgeId })
  }
  return pushAvailability(channelKey, payload)
}

/** Push rates for a channel via the adapter boundary. */
export async function pushChannelRates(channelKey, payload = {}) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  if (isManualChannel(channelKey)) {
    return pushRates(channelKey, { ...payload, lodge_id: state.lodgeId })
  }
  return pushRates(channelKey, payload)
}

/** Fetch reservations for a channel via the adapter boundary. */
export async function fetchChannelReservations(channelKey, since = null) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  return fetchReservations(channelKey, since)
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
