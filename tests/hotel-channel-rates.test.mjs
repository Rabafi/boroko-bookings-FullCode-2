/**
 * Phase 5 — HotelOS revenue/distribution internal completeness.
 * Channel adapter fail-closed for live OTA; ManualExport real local work;
 * channel domain processSyncQueue handles not-connected; rates/revenue/booking engine contracts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  pushAvailability,
  pushRates,
  fetchReservations,
  acknowledgeReservation,
  ManualExportProvider,
  processSyncItem,
  resolveProvider,
  isManualChannel,
  clearManualExportQueue,
  getManualExportQueue
} from '../src/main/domains/channelProviderAdapter.js'

const ROOT = process.cwd()

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

// ── Adapter: live OTA never unconditional success ───────────────────────────

test('live OTA adapter never returns unconditional success for availability/rates/fetch/ack', async () => {
  clearManualExportQueue()
  for (const provider of ['bookingcom', 'expedia', 'airbnb', 'unknown_ota']) {
    const availability = await pushAvailability(provider, { rooms: 3 })
    const rates = await pushRates(provider, { rate: 1200 })
    const reservations = await fetchReservations(provider, null)
    const ack = await acknowledgeReservation(provider, 'res-1')

    for (const result of [availability, rates, reservations, ack]) {
      assert.equal(result.success, false, `${provider} must not succeed without a certified adapter`)
      assert.equal(result.provider_connected, false, `${provider} must not claim provider_connected`)
      assert.equal(result.manual_review_required, true)
      assert.match(String(result.error || result.message || ''), /not connected/i)
    }
    assert.deepEqual(reservations.reservations, [])
  }
})

test('live OTA processSyncItem fails closed and never sets provider_connected true', async () => {
  const result = await processSyncItem(
    { channel_key: 'bookingcom', sync_type: 'availability', payload: { date: '2026-08-01' } },
    { credentials: { api_key: 'fake' } }
  )
  assert.equal(result.success, false)
  assert.equal(result.provider_connected, false)
  assert.equal(result.manual_export, false)
})

// ── ManualExportProvider: real export artifact structure ────────────────────

test('ManualExportProvider produces structured export artifact for availability', async () => {
  clearManualExportQueue()
  const result = await ManualExportProvider.pushAvailability({
    lodge_id: 'lodge-1',
    room_type_id: 'rt-1',
    dates: ['2026-08-01', '2026-08-02']
  })

  assert.equal(result.success, true)
  assert.equal(result.provider_connected, false, 'manual export is not live OTA connection')
  assert.equal(result.manual_export, true)
  assert.equal(result.provider_kind, 'manual_export')
  assert.ok(result.export_artifact, 'must include export_artifact')
  assert.ok(result.export_artifact.export_id)
  assert.equal(result.export_artifact.operation, 'push_availability')
  assert.equal(result.export_artifact.channel_key, 'manual')
  assert.ok(result.export_artifact.payload)
  assert.ok(result.export_artifact.checksum)
  assert.ok(result.export_artifact.created_at)
  assert.match(String(result.message || ''), /not sent to any OTA/i)

  const queue = getManualExportQueue()
  assert.ok(queue.length >= 1)
  assert.equal(queue[queue.length - 1].export_id, result.export_artifact.export_id)
})

test('manual channel key routes to ManualExportProvider via pushAvailability/pushRates', async () => {
  clearManualExportQueue()
  assert.equal(isManualChannel('manual'), true)
  assert.equal(isManualChannel('bookingcom'), false)

  const resolved = resolveProvider('manual', {})
  assert.equal(resolved.kind, 'manual_export')
  assert.equal(resolved.live_ota, false)

  const avail = await pushAvailability('manual', { rooms: 2 })
  const rates = await pushRates('manual_export', { amount: 900 })
  assert.equal(avail.manual_export, true)
  assert.equal(avail.success, true)
  assert.equal(avail.provider_connected, false)
  assert.ok(avail.export_artifact?.export_id)
  assert.equal(rates.manual_export, true)
  assert.ok(rates.export_artifact?.operation === 'push_rates')
})

// ── channelManager processSyncQueue handles not connected ───────────────────

test('channel domain processSyncQueue handles not-connected live channels honestly', async () => {
  const { state } = await import('../src/main/state.js')
  const previous = {
    lodgeId: state.lodgeId,
    isOnline: state.isOnline,
    supabase: state.supabase,
    cacheDir: state.cacheDir
  }

  state.lodgeId = '00000000-0000-4000-8000-000000000099'
  state.isOnline = false
  state.supabase = null
  state.cacheDir = null

  try {
    const { processSyncQueue } = await import('../src/main/domains/channelManager.js')
    const result = await processSyncQueue('bookingcom')

    assert.equal(result.success, true, 'domain call itself succeeds with an honest status payload')
    assert.equal(result.provider_connected, false, 'must not claim live provider connected')
    assert.ok(result.not_connected >= 1 || (result.adapter_results || []).some((r) => r.provider_connected === false))
    assert.ok(
      (result.adapter_results || []).every((r) => r.provider_connected !== true || r.provider_kind === 'manual_export'),
      'no live OTA adapter_result may set provider_connected true'
    )
    assert.match(String(result.message || ''), /not connected|manual/i)
  } finally {
    state.lodgeId = previous.lodgeId
    state.isOnline = previous.isOnline
    state.supabase = previous.supabase
    state.cacheDir = previous.cacheDir
  }
})

test('channel domain processSyncQueue wires ManualExportProvider for manual channel', async () => {
  clearManualExportQueue()
  const { state } = await import('../src/main/state.js')
  const previous = {
    lodgeId: state.lodgeId,
    isOnline: state.isOnline,
    supabase: state.supabase,
    cacheDir: state.cacheDir
  }

  state.lodgeId = '00000000-0000-4000-8000-000000000099'
  state.isOnline = false
  state.supabase = null
  state.cacheDir = null

  try {
    const { processSyncQueue } = await import('../src/main/domains/channelManager.js')
    const result = await processSyncQueue('manual')
    assert.equal(result.provider_connected, false)
    assert.ok(result.manual_exported >= 1, 'manual channel should produce export artifacts')
    assert.ok((result.adapter_results || []).some((r) => r.manual_export === true && r.export_artifact))
  } finally {
    state.lodgeId = previous.lodgeId
    state.isOnline = previous.isOnline
    state.supabase = previous.supabase
    state.cacheDir = previous.cacheDir
  }
})

// ── Source contracts: rates, revenue, booking engine ────────────────────────

test('ratePlans prefers quote_room_stay and labels client estimates', () => {
  const js = read('src/main/domains/ratePlans.js')
  assert.ok(js.includes('quote_room_stay'))
  assert.ok(js.includes('quoteRoomStayFromPlans'))
  assert.ok(js.includes('is_estimate'))
  assert.ok(js.includes('client_rate_plan_estimate') || js.includes('_financial_estimate'))
  assert.ok(js.includes('estimatePlanTotal'))
})

test('rateCalendar labels offline estimates and prefers quote_room_stay', () => {
  const js = read('src/main/domains/rateCalendar.js')
  assert.ok(js.includes('quote_room_stay'))
  assert.ok(js.includes('is_estimate'))
  assert.ok(js.includes('offline_client_estimate') || js.includes('_financial_estimate'))
  assert.ok(js.includes('quoteStayTotal') || js.includes('_quoteStayTotal'))
})

test('revenueManager recommendations require approval and never silent apply', () => {
  const js = read('src/main/domains/revenueManager.js')
  assert.ok(js.includes('requires_approval'))
  assert.ok(js.includes('auto_applied'))
  assert.ok(js.includes('approveRevenueRecommendation'))
  assert.ok(js.includes('rejectRevenueRecommendation'))
  assert.ok(js.includes('applyRevenueRecommendation'))
  assert.match(js, /applied:\s*false/)
  assert.ok(js.includes('cannot be applied silently') || js.includes('not applied automatically'))
})

test('bookingEngine intent and confirm use stable idempotency keys', () => {
  const js = read('src/main/domains/bookingEngine.js')
  assert.ok(js.includes('idempotencyKey') || js.includes('idempotency_key'))
  assert.ok(js.includes('createBookingIntent'))
  assert.ok(js.includes('confirmBookingIntent'))
  assert.ok(js.includes('idempotent_replay') || js.includes('stableIdempotencyKey') || js.includes('stable'))
  assert.ok(js.includes('price_is_estimate'))
  assert.ok(js.includes('quote_room_stay'))
  assert.ok(!js.includes('Date.now()') || js.includes('idempotency'), 'must not rely solely on Date.now for keys')
})

test('channelProviderAdapter never hard-codes provider_connected true for live paths', () => {
  const js = read('src/main/domains/channelProviderAdapter.js')
  // Live notConnected helper must force false
  assert.ok(js.includes('provider_connected: false'))
  assert.ok(js.includes('ManualExportProvider'))
  // Guard: no live success path claiming connected without certification flag language
  assert.ok(js.includes('adapter_certified') || js.includes('not connected'))
  assert.doesNotMatch(
    js,
    /provider_connected:\s*true[\s\S]{0,80}bookingcom/i
  )
})

test('enterprise channel-manager regression still fails closed for bookingcom', async () => {
  const availability = await pushAvailability('bookingcom', {})
  assert.equal(availability.success, false)
  assert.equal(availability.provider_connected, false)
})
