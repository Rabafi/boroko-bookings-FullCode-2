// Channel Manager Provider Adapter Boundary
// Live OTA providers fail closed until real credentials and a certified adapter exist.
// ManualExportProvider performs real local export-queue work — it must never claim live OTA delivery.

import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'

export const MANUAL_CHANNEL_KEYS = new Set(['manual', 'manual_export', 'file_export', 'csv_export'])

const LIVE_OTA_KEYS = new Set([
  'bookingcom',
  'booking.com',
  'expedia',
  'airbnb',
  'agoda',
  'hotels.com',
  'tripadvisor',
  'google_hotel',
  'ical',
  'siteminder',
  'cloudbeds'
])

/** In-memory export queue for tests and session-local inspection. */
const exportQueue = []

function notConnected(operation, provider = null) {
  return {
    success: false,
    provider_connected: false,
    provider_kind: 'live_ota',
    provider: provider || null,
    manual_review_required: true,
    manual_export: false,
    error: `Live OTA provider adapter is not connected; ${operation} was not sent to a live channel.`,
    message: `Provider adapter not connected - ${operation} requires manual review.`
  }
}

export function isManualChannel(channelKeyOrProvider) {
  const key = String(channelKeyOrProvider || '').trim().toLowerCase()
  return MANUAL_CHANNEL_KEYS.has(key)
}

export function isLiveOtaChannel(channelKeyOrProvider) {
  const key = String(channelKeyOrProvider || '').trim().toLowerCase()
  if (!key || isManualChannel(key)) return false
  if (LIVE_OTA_KEYS.has(key)) return true
  // Unknown non-manual keys are treated as live OTA candidates and fail closed.
  return true
}

/**
 * Resolve which adapter implementation handles a channel key / config.
 * Live providers stay "not connected" until credentials + a real adapter exist.
 */
export function resolveProvider(channelKey, config = null) {
  const key = String(channelKey || config?.channel_key || '').trim().toLowerCase()
  if (isManualChannel(key)) {
    return {
      kind: 'manual_export',
      channel_key: key || 'manual',
      connected: true, // local manual export capability is available
      live_ota: false,
      credentials_configured: false
    }
  }

  const credentials = config?.credentials && typeof config.credentials === 'object' ? config.credentials : {}
  const hasCredentials = Boolean(
    credentials.api_key ||
    credentials.apiKey ||
    credentials.username ||
    credentials.password ||
    credentials.token ||
    credentials.hotel_id ||
    credentials.hotelId
  )

  // Even with credentials present we do not claim a live OTA adapter is wired.
  // Certification of a real provider client is still required.
  return {
    kind: 'live_ota',
    channel_key: key || null,
    connected: false,
    live_ota: true,
    credentials_configured: hasCredentials,
    adapter_certified: false
  }
}

function exportDir() {
  const base = state.cacheDir || state.cacheRootDir || null
  if (!base) return null
  return path.join(base, 'channel-exports')
}

function ensureExportDir() {
  const dir = exportDir()
  if (!dir) return null
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function buildExportArtifact(operation, channelKey, payload = {}) {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const body = {
    export_id: id,
    operation,
    channel_key: channelKey || 'manual',
    provider_kind: 'manual_export',
    created_at: createdAt,
    lodge_id: state.lodgeId || null,
    payload: payload && typeof payload === 'object' ? payload : { value: payload },
    delivery: 'local_file_or_queue',
    note: 'Manual export artifact for operator delivery. Not transmitted to any OTA.'
  }
  const checksum = createHash('sha256').update(JSON.stringify(body.payload)).digest('hex').slice(0, 32)
  body.checksum = checksum
  return body
}

function writeExportArtifact(artifact) {
  const dir = ensureExportDir()
  let filePath = null
  if (dir) {
    filePath = path.join(dir, `${artifact.export_id}-${artifact.operation}.json`)
    fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), 'utf-8')
  }
  const queueEntry = {
    ...artifact,
    file_path: filePath,
    queued_at: artifact.created_at
  }
  exportQueue.push(queueEntry)
  // Bound memory for long-running sessions
  if (exportQueue.length > 500) {
    exportQueue.splice(0, exportQueue.length - 500)
  }
  return queueEntry
}

/**
 * ManualExportProvider — real local export work for the "manual" channel.
 * Produces a structured queue/result object; does not claim OTA delivery.
 */
export const ManualExportProvider = {
  kind: 'manual_export',

  async pushAvailability(payload = {}) {
    const artifact = buildExportArtifact('push_availability', 'manual', payload)
    const written = writeExportArtifact(artifact)
    return {
      success: true,
      provider_connected: false,
      provider_kind: 'manual_export',
      manual_export: true,
      manual_review_required: false,
      export_artifact: written,
      message: 'Availability export artifact written for manual delivery; not sent to any OTA.'
    }
  },

  async pushRates(payload = {}) {
    const artifact = buildExportArtifact('push_rates', 'manual', payload)
    const written = writeExportArtifact(artifact)
    return {
      success: true,
      provider_connected: false,
      provider_kind: 'manual_export',
      manual_export: true,
      manual_review_required: false,
      export_artifact: written,
      message: 'Rate export artifact written for manual delivery; not sent to any OTA.'
    }
  },

  async fetchReservations(since = null) {
    // Manual channel does not pull OTA reservations; operators import files separately.
    return {
      success: true,
      provider_connected: false,
      provider_kind: 'manual_export',
      manual_export: true,
      reservations: [],
      since: since || null,
      message: 'Manual channel does not fetch OTA reservations; use import workflow for external files.'
    }
  },

  async acknowledgeReservation(reservationId) {
    const artifact = buildExportArtifact('acknowledge_reservation', 'manual', { reservation_id: reservationId })
    const written = writeExportArtifact(artifact)
    return {
      success: true,
      provider_connected: false,
      provider_kind: 'manual_export',
      manual_export: true,
      export_artifact: written,
      message: 'Reservation acknowledgement recorded as local export artifact only.'
    }
  }
}

export function getManualExportQueue() {
  return exportQueue.slice()
}

export function clearManualExportQueue() {
  exportQueue.length = 0
}

export async function pushAvailability(provider, payload) {
  if (isManualChannel(provider)) {
    return ManualExportProvider.pushAvailability(payload)
  }
  return notConnected('availability sync', provider)
}

export async function pushRates(provider, payload) {
  if (isManualChannel(provider)) {
    return ManualExportProvider.pushRates(payload)
  }
  return notConnected('rate sync', provider)
}

export async function fetchReservations(provider, since) {
  if (isManualChannel(provider)) {
    return ManualExportProvider.fetchReservations(since)
  }
  return {
    ...notConnected('reservation fetch', provider),
    reservations: []
  }
}

export async function acknowledgeReservation(provider, reservationId) {
  if (isManualChannel(provider)) {
    return ManualExportProvider.acknowledgeReservation(reservationId)
  }
  return notConnected('reservation acknowledgement', provider)
}

/**
 * Process a single sync-queue item through the correct provider.
 * Never marks live OTA work as completed without a certified adapter.
 */
export async function processSyncItem(item = {}, config = null) {
  const channelKey = item.channel_key || config?.channel_key || null
  const resolved = resolveProvider(channelKey, config)
  const syncType = String(item.sync_type || item.operation || 'availability').toLowerCase()
  const payload = item.payload || item

  if (resolved.kind === 'manual_export') {
    if (syncType.includes('rate')) {
      return ManualExportProvider.pushRates(payload)
    }
    if (syncType.includes('reserv') || syncType.includes('fetch') || syncType.includes('import')) {
      return ManualExportProvider.fetchReservations(payload?.since || null)
    }
    if (syncType.includes('ack')) {
      return ManualExportProvider.acknowledgeReservation(payload?.reservation_id || item.source_key)
    }
    return ManualExportProvider.pushAvailability(payload)
  }

  // Live / unknown: fail closed. Never success + provider_connected.
  if (syncType.includes('rate')) {
    return notConnected('rate sync', channelKey)
  }
  if (syncType.includes('reserv') || syncType.includes('fetch')) {
    return {
      ...notConnected('reservation fetch', channelKey),
      reservations: []
    }
  }
  return notConnected('availability sync', channelKey)
}
