import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ExportBundleIntegrityError,
  ExportIntegrationDisabledError,
  buildExportBundle,
  canonicalJson,
  createFakeExportReceiver,
  hashExportEvent,
  hashExportManifest,
  sha256Hex,
  signExportBundle,
  verifyExportBundle
} from '../dist/export.js'

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_BATCH_ID = '99999999-9999-4999-8999-999999999999'
const AUTHORITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BUSINESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OUTLET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FIRST_EVENT_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_EVENT_ID = '33333333-3333-4333-8333-333333333333'
function event(overrides = {}) {
  const value = {
    event_id: FIRST_EVENT_ID,
    commit_sequence: 5,
    event_index: 0,
    event_type: 'sale.committed',
    operation_id: '44444444-4444-4444-8444-444444444444',
    authority_epoch: 1,
    payload: { z: 2, a: 1 },
    created_at: '2026-10-20T10:00:00.000Z',
    ...overrides
  }
  return { ...value, payload_hash: hashExportEvent(value) }
}

function input(overrides = {}) {
  return {
    batch_id: BATCH_ID,
    authority_id: AUTHORITY_ID,
    authority_epoch: 1,
    business_id: BUSINESS_ID,
    outlet_id: OUTLET_ID,
    from_sequence: 5,
    to_sequence: 6,
    checkpoint: 6,
    created_at: '2026-10-20T10:01:00.000Z',
    events: [event()],
    ...overrides
  }
}

test('canonical JSON sorts object keys, preserves arrays and produces the standard SHA-256 digest', () => {
  assert.equal(canonicalJson({ b: 1, a: ['x', true, null] }), '{"a":["x",true,null],"b":1}')
  assert.equal(canonicalJson({ 'é': 1, z: 2 }), '{"z":2,"é":1}')
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.throws(() => canonicalJson({ bad: Number.NaN }), ExportBundleIntegrityError)
  assert.throws(() => canonicalJson({ bad: undefined }), ExportBundleIntegrityError)
  assert.throws(() => canonicalJson([, 1]), /sparse array/)
  assert.throws(() => canonicalJson([undefined]), ExportBundleIntegrityError)
  assert.throws(() => canonicalJson(new Date()), ExportBundleIntegrityError)
})

test('an export preserves earlier event epochs across authority recovery', () => {
  const bundle = buildExportBundle(input({ authority_epoch: 2, events: [event({ authority_epoch: 1 })] }))
  assert.equal(bundle.authority_epoch, 2)
  assert.equal(bundle.events[0].authority_epoch, 1)
  verifyExportBundle(bundle)
})

test('export bundles are deterministic, sorted, hash-verified and explicitly unsigned', () => {
  const bundle = buildExportBundle(input({
    events: [
      event({ commit_sequence: 6, event_id: SECOND_EVENT_ID, event_index: 1 }),
      event()
    ]
  }))
  assert.equal(bundle.status, 'integration_disabled')
  assert.equal(bundle.signature, null)
  assert.equal(bundle.signature_key_id, null)
  assert.equal(bundle.signature_status, 'unavailable')
  assert.equal(bundle.event_count, 2)
  assert.deepEqual(bundle.events.map((item) => item.commit_sequence), [5, 6])
  assert.match(bundle.manifest_hash, /^[0-9a-f]{64}$/)
  const {
    manifest_hash,
    status,
    signature,
    signature_key_id,
    signature_status,
    transport_status,
    ...manifest
  } = bundle
  assert.equal(manifest_hash, hashExportManifest(manifest))
  verifyExportBundle(bundle)

  const tampered = {
    ...bundle,
    events: [{ ...bundle.events[0], payload: { changed: true } }, bundle.events[1]]
  }
  assert.throws(() => verifyExportBundle(tampered), ExportBundleIntegrityError)

  assert.throws(() => buildExportBundle(input({
    events: [event(), event({ commit_sequence: 6 })]
  })), ExportBundleIntegrityError)
  const badPayloadHash = event()
  badPayloadHash.payload_hash = 'a'.repeat(64)
  assert.throws(() => buildExportBundle(input({ events: [badPayloadHash] })), /payload_hash does not match its payload/)
})

test('the signing boundary fails closed and the fake receiver is idempotent', async () => {
  const bundle = buildExportBundle(input())
  await assert.rejects(() => signExportBundle(bundle), ExportIntegrationDisabledError)
  await assert.rejects(() => signExportBundle(bundle, {
    keyId: 'test-key',
    algorithm: 'ed25519',
    sign: async () => 'fake'
  }), ExportBundleIntegrityError)

  const receiver = createFakeExportReceiver()
  const first = await receiver.receive(bundle)
  assert.equal(first.accepted, true)
  assert.equal(first.idempotent, false)
  assert.equal(receiver.received.length, 1)

  const replay = await receiver.receive(bundle)
  assert.equal(replay.accepted, true)
  assert.equal(replay.idempotent, true)
  assert.equal(receiver.received.length, 1)

  const overlap = buildExportBundle(input({ batch_id: SECOND_BATCH_ID }))
  const duplicate = await receiver.receive(overlap)
  assert.equal(duplicate.accepted, false)
  assert.match(duplicate.reason, /^duplicate_event:/)
  assert.equal(receiver.received.length, 1)
})

test('test receiver rejects changed payload under the same batch identity and snapshots accepted data', async () => {
  const receiver = createFakeExportReceiver()
  const original = buildExportBundle(input())
  assert.equal((await receiver.receive(original)).accepted,true)
  const changed = buildExportBundle(input({events:[event({payload:{changed:true}})]}))
  const conflict = await receiver.receive(changed)
  assert.equal(conflict.accepted,false)
  assert.equal(conflict.reason,'batch_payload_conflict')
  original.events[0].payload.a = 500
  assert.equal(receiver.received[0].events[0].payload.a,1)
  const snapshot=receiver.received
  snapshot[0].events[0].payload.a=900
  assert.equal(receiver.received[0].events[0].payload.a,1)
  assert.equal((await receiver.receive(buildExportBundle(input()))).idempotent,true)
})
