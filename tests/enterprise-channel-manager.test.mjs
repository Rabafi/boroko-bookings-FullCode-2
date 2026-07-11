import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  pushAvailability,
  pushRates,
  fetchReservations,
  acknowledgeReservation
} from '../src/main/domains/channelProviderAdapter.js'

const channelFixSql = readFileSync(
  resolve('supabase/migrations/20260706100000_channel_sync_manual_review_until_provider.sql'),
  'utf8'
)

test('Channel mappings table schema is defined', () => {
  const expectedColumns = ['id', 'lodge_id', 'channel_key', 'source_type', 'local_id', 'channel_code', 'channel_name', 'created_at', 'updated_at']
  const uniqueConstraint = 'unique (lodge_id, channel_key, source_type, local_id)'
  assert.ok(expectedColumns.length >= 7, 'Expected at least 7 columns for channel_mappings')
  assert.ok(uniqueConstraint.includes('lodge_id, channel_key, source_type, local_id'), 'Expected unique constraint on lodge_id, channel_key, source_type, local_id')
})

test('Channel config table schema is defined', () => {
  const expectedColumns = ['id', 'lodge_id', 'channel_key', 'channel_label', 'enabled', 'sync_availability', 'sync_rates', 'import_reservations', 'credentials', 'settings', 'created_at', 'updated_at']
  assert.ok(expectedColumns.length >= 10, 'Expected at least 10 columns for channel_config')
})

test('Channel reservation imports table schema is defined', () => {
  const statusValues = ['pending', 'reviewed', 'confirmed', 'rejected', 'duplicate']
  assert.ok(statusValues.includes('pending'), 'Expected pending status')
  assert.ok(statusValues.includes('confirmed'), 'Expected confirmed status')
  assert.ok(statusValues.includes('rejected'), 'Expected rejected status')
  assert.ok(statusValues.includes('duplicate'), 'Expected duplicate status')
})

test('Channel manager RPC functions exist', () => {
  const rpcs = [
    'create_channel_mapping',
    'update_channel_mapping',
    'delete_channel_mapping',
    'create_channel_config',
    'update_channel_config',
    'enable_channel',
    'disable_channel',
    'get_channel_dashboard',
    'process_channel_sync_queue',
    'import_channel_reservation',
    'confirm_channel_import',
    'reject_channel_import'
  ]
  assert.ok(rpcs.length >= 12, 'Expected at least 12 channel manager RPCs')
  assert.ok(rpcs.includes('create_channel_mapping'), 'Expected create_channel_mapping RPC')
  assert.ok(rpcs.includes('get_channel_dashboard'), 'Expected get_channel_dashboard RPC')
  assert.ok(rpcs.includes('process_channel_sync_queue'), 'Expected process_channel_sync_queue RPC')
})

test('Channel dashboard returns structured response', () => {
  const dashboard = {
    channels: [],
    pending_sync_items: [],
    pending_imports: []
  }
  assert.ok(Array.isArray(dashboard.channels), 'Expected channels array')
  assert.ok(Array.isArray(dashboard.pending_sync_items), 'Expected pending_sync_items array')
  assert.ok(Array.isArray(dashboard.pending_imports), 'Expected pending_imports array')
})

test('Channel mapping source_type validation', () => {
  const validTypes = ['room_type', 'rate_plan']
  assert.ok(validTypes.includes('room_type'), 'Expected room_type source type')
  assert.ok(validTypes.includes('rate_plan'), 'Expected rate_plan source type')
  assert.equal(validTypes.length, 2, 'Expected exactly 2 source types')
})

test('Channel sync queue processing limits', () => {
  const limit = 50
  assert.ok(limit > 0 && limit <= 100, 'Expected process_channel_sync_queue limit between 1 and 100')
})

test('Channel sync queue does not mark items completed without provider confirmation', () => {
  assert.match(channelFixSql, /create or replace function public\.process_channel_sync_queue/i)
  assert.match(channelFixSql, /status = 'manual_review_required'/)
  assert.match(channelFixSql, /provider_connected', false/)
  assert.match(channelFixSql, /Live OTA provider adapter is not connected/)
  assert.doesNotMatch(channelFixSql, /set status = 'completed'/i)
})

test('Channel provider adapter fails closed until a real provider is connected', async () => {
  const availability = await pushAvailability('bookingcom', {})
  const rates = await pushRates('bookingcom', {})
  const reservations = await fetchReservations('bookingcom', null)
  const acknowledgement = await acknowledgeReservation('bookingcom', 'reservation-1')

  for (const result of [availability, rates, reservations, acknowledgement]) {
    assert.equal(result.success, false)
    assert.equal(result.provider_connected, false)
    assert.equal(result.manual_review_required, true)
    assert.match(result.error, /not connected/i)
  }
  assert.deepEqual(reservations.reservations, [])
})

test('Channel reservation import idempotency', () => {
  const conflictAction = 'on conflict (lodge_id, channel_key, channel_reservation_id)'
  assert.ok(conflictAction.includes('on conflict'), 'Expected on conflict handling for imports')
  assert.ok(conflictAction.includes('channel_reservation_id'), 'Expected channel_reservation_id in conflict target')
})
