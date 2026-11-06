import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateEventFeed,
  validateOperationStatus,
  validateQueryResult,
  validateReadiness
} from '@tsa-bonno/bar-contracts'

const valid = {
  data: { receipt_number: 'R-1' },
  pagination: { next_cursor: null, has_more: false },
  snapshot_watermark: 3,
  scope: {
    business_id: '00000000-0000-4000-8000-000000000001',
    outlet_id: '00000000-0000-4000-8000-000000000002',
    actor_staff_id: '00000000-0000-4000-8000-000000000003',
    role: 'owner',
    device_id: '00000000-0000-4000-8000-000000000004'
  },
  as_of: '2026-10-20T10:00:00.000Z',
  complete: true,
  unavailable: []
}

test('query results expose required snapshot metadata', () => {
  assert.equal(validateQueryResult(valid).snapshot_watermark, 3)
  assert.equal(validateQueryResult({ ...valid, data: [] }).complete, true)
})

test('only the no-open-shift query may return a null singular record', () => {
  assert.equal(validateQueryResult({ ...valid, data: null }, { allowNullData: true }).data, null)
  assert.throws(() => validateQueryResult({ ...valid, data: null }), /data must be an object/)
  assert.throws(() => validateQueryResult({ ...valid, data: null }, { allowNullData: false }), /data must be an object/)
})

test('query results reject malformed snapshot metadata', () => {
  assert.throws(
    () => validateQueryResult({ ...valid, pagination: { next_cursor: null, has_more: true } }),
    /next_cursor must be present when has_more is true/
  )
  assert.throws(
    () => validateQueryResult({ ...valid, snapshot_watermark: -1 }),
    /snapshot_watermark/
  )
  assert.throws(
    () => validateQueryResult({ ...valid, scope: { ...valid.scope, outlet_id: 'not-a-uuid' } }),
    /outlet_id must be a UUID/
  )
  assert.throws(
    () => validateQueryResult({ ...valid, data: 42 }),
    /data must be an object/
  )
  assert.throws(
    () => validateQueryResult({ ...valid, unavailable: [42] }),
    /unavailable\[0\] must be a string/
  )
})

const eventFeed = {
  events: [
    {
      commit_sequence: 4,
      event_index: 0,
      event_type: 'sale.committed',
      operation_id: '00000000-0000-4000-8000-000000000010',
      payload: { sale_id: '00000000-0000-4000-8000-000000000011' },
      payload_hash: '0'.repeat(64),
      created_at: '2026-10-20T10:00:00.123456+00:00'
    },
    {
      commit_sequence: 4,
      event_index: 1,
      event_type: 'stock.moved',
      operation_id: '00000000-0000-4000-8000-000000000010',
      payload: { product_id: '00000000-0000-4000-8000-000000000012' },
      payload_hash: '1'.repeat(64),
      created_at: '2026-10-20T10:00:00.123456+00:00'
    }
  ],
  event_count: 2,
  next_cursor: 4,
  latest_commit_sequence: 4,
  latest_event_sequence: 4,
  retention_floor_sequence: null,
  gap_detected: false,
  complete: true,
  scope: {
    business_id: '00000000-0000-4000-8000-000000000001',
    outlet_id: '00000000-0000-4000-8000-000000000002',
    device_id: '00000000-0000-4000-8000-000000000004'
  }
}

test('event feeds expose ordered, complete replay metadata', () => {
  assert.equal(validateEventFeed(eventFeed).event_count, 2)
  assert.throws(
    () => validateEventFeed({ ...eventFeed, event_count: 1 }),
    /event_count must equal/
  )
  assert.throws(
    () => validateEventFeed({ ...eventFeed, complete: false }),
    /complete must reflect/
  )
  assert.throws(
    () => validateEventFeed({ ...eventFeed, events: [...eventFeed.events].reverse(), next_cursor: 4 }),
    /must be ordered/
  )
})

test('an empty event outbox has a zero event watermark and an unchanged cursor', () => {
  const empty = {
    events: [], event_count: 0, next_cursor: 0, latest_commit_sequence: 7,
    latest_event_sequence: 0, retention_floor_sequence: null, gap_detected: false,
    complete: true, scope: eventFeed.scope
  }
  assert.equal(validateEventFeed(empty).latest_event_sequence, 0)
  assert.equal(validateEventFeed(empty).next_cursor, 0)
  assert.equal(validateEventFeed({ ...empty, latest_event_sequence: null }).latest_event_sequence, 0)
  assert.throws(() => validateEventFeed({ ...empty, events: [eventFeed.events[0]], event_count: 1, latest_event_sequence: null }), /latest_event_sequence/)
})

const operationStatus = {
  operation_id: '00000000-0000-4000-8000-000000000010',
  command: 'sale.commit',
  status: 'committed',
  outcome: 'committed_local',
  receipt: {
    operation_id: '00000000-0000-4000-8000-000000000010',
    outcome: 'committed_local',
    authority_id: '00000000-0000-4000-8000-000000000020',
    authority_epoch: 1,
    business_id: '00000000-0000-4000-8000-000000000001',
    outlet_id: '00000000-0000-4000-8000-000000000002',
    device_id: '00000000-0000-4000-8000-000000000004',
    actor_staff_id: '00000000-0000-4000-8000-000000000003',
    commit_sequence: 4,
    business_date: '2026-10-20',
    server_committed_at: '2026-10-20T10:00:00.123Z',
    cloud_status: 'integration_disabled'
  },
  result: { sale_id: '00000000-0000-4000-8000-000000000011' },
  error: null,
  commit_sequence: 4,
  business_date: '2026-10-20',
  created_at: '2026-10-20T09:59:59.123456+00:00',
  committed_at: '2026-10-20T10:00:00.123456+00:00',
  refused_at: null
}

test('operation status is internally consistent', () => {
  assert.equal(validateOperationStatus(operationStatus).status, 'committed')
  assert.throws(
    () => validateOperationStatus({ ...operationStatus, receipt: null }),
    /receipt must be present/
  )
  assert.throws(
    () => validateOperationStatus({ ...operationStatus, outcome: 'refused' }),
    /outcome must be committed_local/
  )
  assert.throws(
    () => validateOperationStatus({
      ...operationStatus,
      operation_id: '00000000-0000-4000-8000-000000000099'
    }),
    /receipt.operation_id must match/
  )
})

const readiness = {
  ready: false,
  authority_epoch: 1,
  authority_id: '00000000-0000-4000-8000-000000000020',
  business_id: '00000000-0000-4000-8000-000000000001',
  outlet_id: '00000000-0000-4000-8000-000000000002',
  schema_version: '0008_device_admin',
  commit_sequence: 4,
  blockers: ['empty_catalogue'],
  cloud_export: 'integration_disabled'
}

test('readiness blocks commits with explicit unavailable reasons', () => {
  assert.deepEqual(validateReadiness(readiness).blockers, ['empty_catalogue'])
  assert.throws(
    () => validateReadiness({ ...readiness, ready: true }),
    /ready must reflect/
  )
  assert.throws(
    () => validateReadiness({ ...readiness, blockers: ['empty_catalogue', 'empty_catalogue'] }),
    /must not contain duplicates/
  )
  assert.throws(
    () => validateReadiness({ ...readiness, cloud_export: 'enabled' }),
    /cloud_export must be integration_disabled/
  )
})
