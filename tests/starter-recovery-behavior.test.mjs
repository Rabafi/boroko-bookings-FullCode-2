import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { state, resetState } from '../src/main/state.js'
import { createStarterBackupPackage } from '../src/main/domains/starterBackup.js'
import {
  beginStarterRecoveryOperation,
  stageStarterRecoveryPackage,
  sealAndValidateStarterRecovery,
  previewStarterRecovery,
  approveStarterRecovery,
  executeStarterRecovery,
  verifyStarterRecoveryOperation,
  discardStarterRecoveryOperation,
  getStarterRecoveryOperation,
  cleanupExpiredStagedOperations
} from '../src/main/domains/starterRecovery.js'

const lodgeId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const actorEmail = 'admin@example.com'

function packagePayload() {
  return {
    schema: 'tsa-bonno-starter-backup/v1',
    app_version: '1.5.6',
    generated_at: '2026-08-25T10:00:00.000Z',
    lodge_id: lodgeId,
    recovery: { restore_mode: 'support-led', live_restore_available: false },
    privacy: { contains_personal_data: true },
    completeness: { complete: true, warnings: [], tables: [{ table: 'settings', count: 1, complete: true }] },
    tables: {
      settings: [{ id: 's-a', lodge_id: lodgeId, lodge_name: 'Test Lodge', slug: 'test-lodge', public_offer_campsites: false, operating_profile: { kind: 'lodge' } }],
      rooms: [{ id: 'r-a', lodge_id: lodgeId, room_number: '101', room_type: 'standard', rate_per_night: 100, max_occupancy: 2, accommodation_kind: 'campsite', capacity_adults: 2, capacity_children: 1, max_tents: 2, max_vehicles: 1, is_powered: true, site_surface: 'gravel', shared_facilities: true, rate_mode: 'composite', rate_per_person: 20, rate_per_tent: 30, rate_per_vehicle: 10 }],
      customers: [{ id: 'c-a', lodge_id: lodgeId, name: 'Guest', email: 'guest@example.com' }],
      bookings: [{ id: 'b-a', lodge_id: lodgeId, room_id: 'r-a', customer_id: 'c-a', check_in: '2026-08-20', check_out: '2026-08-22', status: 'confirmed', total_amount: 200, charges_total: 20, payment_method: 'card', invoice_number: 'INV-1001', tents_count: 2, vehicles_count: 1, accommodation_kind: 'campsite', booking_accommodation_details: { booking_id: 'b-a', lodge_id: lodgeId, accommodation_kind: 'campsite', adults: 2, children: 1, tents: 2, vehicles: 1, rate_mode: 'composite', pricing_snapshot: { nights: 2, site_rate: 100, person_rate: 20, tent_rate: 30, vehicle_rate: 10, people: 3, tents: 2, vehicles: 1, calculated_total: 220 }, created_at: '2026-08-20T09:00:00.000Z' } }],
      quotations: [{ id: 'q-a', lodge_id: lodgeId, customer_id: 'c-a', total_amount: 150, quotation_type: 'room', accommodation_lines: [{ room_id: 'r-a', nights: 2 }] }],
      signed_payment_ledger: [{ id: 'p-a', lodge_id: lodgeId, booking_id: 'b-a', amount: 100, method: 'cash', type: 'payment', paid_at: '2026-08-20' }],
      maintenance: [{ id: 'm-a', lodge_id: lodgeId, room_id: 'r-a', title: 'Leak', description: 'Leak', priority: 'medium', status: 'open', reported_date: '2026-08-25' }]
    }
  }
}

function setupWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-recovery-behavior-'))
  resetState()
  state.cacheRootDir = root
  state.lodgeId = lodgeId
  state.isOnline = false
  state.currentUser = { id: actorId, email: actorEmail, isMasterAdmin: true }
  return root
}

function cleanupWorkspace(root) {
  resetState()
  fs.rmSync(root, { recursive: true, force: true })
}

async function prepareApproved(root, operationId = randomUUID()) {
  const source = path.join(root, 'source.tbbackup')
  fs.writeFileSync(source, createStarterBackupPackage(packagePayload()).bytes)
  const begun = beginStarterRecoveryOperation({ operation_id: operationId, lodge_id: lodgeId, reason: 'Customer recovery test', ticket_ref: 'SUP-100' })
  const staged = stageStarterRecoveryPackage(operationId, source)
  const sealed = sealAndValidateStarterRecovery(operationId)
  previewStarterRecovery(operationId)
  const approved = approveStarterRecovery(operationId)
  return { source, begun, staged, sealed, approved }
}

function createFakeRecoveryClient() {
  const behavior = { executeError: null, executeErrorAfterCommit: null, verifyOverride: null }
  const calls = []
  let acceptedPayload = null

  function ledgerFor(payload) {
    const payments = payload.tables.signed_payment_ledger || []
    return {
      payment_count: payments.length,
      gross_positive: payments.filter((row) => Number(row.amount) > 0).reduce((sum, row) => sum + Number(row.amount), 0),
      refund_negative: payments.filter((row) => Number(row.amount) < 0).reduce((sum, row) => sum + Number(row.amount), 0),
      net_delta: payments.reduce((sum, row) => sum + Number(row.amount), 0)
    }
  }

  function verificationFor(payload) {
    return {
      success: true,
      status: 'verified',
      operation_id: payload.operation_id,
      source_lodge_id: payload.source_lodge_id,
      recovery_lodge_id: payload.recovery_lodge_id,
      actor_id: payload.actor_id,
      actor_email: payload.actor_email,
      target_mode: 'disposable',
      quarantined: true,
      isolation_ok: true,
      counts: payload.counts,
      manifest_counts: payload.counts,
      counts_match: true,
      ledger_reconciliation: ledgerFor(payload),
      package_sha256: payload.package_sha256,
      package_bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      payload_sha256: 'a'.repeat(64),
      per_table_hashes: payload.per_table_hashes,
      idempotency: { operation_id: payload.operation_id, payload_sha256: 'a'.repeat(64), replay_is_safe: true }
    }
  }

  return {
    behavior,
    calls,
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) })
      if (name === 'admin_execute_starter_disposable_restore') {
        if (behavior.executeError) return { data: null, error: { message: behavior.executeError } }
        const payload = args.p_payload
        const idempotent = acceptedPayload !== null
        acceptedPayload = structuredClone(payload)
        if (behavior.executeErrorAfterCommit) return { data: null, error: { message: behavior.executeErrorAfterCommit } }
        return {
          data: {
            success: true,
            idempotent,
            operation_id: payload.operation_id,
            source_lodge_id: payload.source_lodge_id,
            recovery_lodge_id: payload.recovery_lodge_id,
            actor_id: payload.actor_id,
            actor_email: payload.actor_email,
            target_mode: 'disposable',
            quarantined: true,
            package_sha256: payload.package_sha256,
            payload_sha256: 'a'.repeat(64),
            table_counts: payload.counts,
            ledger_reconciliation: ledgerFor(payload)
          },
          error: null
        }
      }
      if (name === 'admin_verify_starter_disposable_restore') {
        if (!acceptedPayload) return { data: null, error: { message: 'Recovery operation was not found.' } }
        const verified = verificationFor(acceptedPayload)
        return { data: behavior.verifyOverride ? { ...verified, ...behavior.verifyOverride } : verified, error: null }
      }
      return { data: null, error: { message: `Unexpected RPC ${name}` } }
    }
  }
}

test('server execute and verify are authoritative, replay is idempotent, and PII/old IDs are not persisted in reports', async () => {
  const root = setupWorkspace()
  try {
    const operationId = '00000000-0000-4000-a000-000000000001'
    const prepared = await prepareApproved(root, operationId)
    assert.equal(prepared.staged.staged_path.startsWith(path.join(root, 'starter-recovery-operations')), true)
    assert.notEqual(prepared.staged.staged_path, prepared.source)
    assert.equal(prepared.sealed.manifest_summary.complete, true)
    assert.deepEqual(prepared.sealed.manifest_summary.warnings, [])

    const client = createFakeRecoveryClient()
    const result = await executeStarterRecovery(operationId, { adminClient: client, isOnline: true })
    assert.equal(result.status, 'verified')
    assert.equal(result.execution_mode, 'server_disposable_restore')
    assert.equal(result.server_verification_confirmed, true)
    assert.equal(result.supabase_restored, true)
    assert.equal(result.restore_persistence, 'quarantined_disposable_lodge')
    assert.match(result.recovery_lodge_id, /^[0-9a-f-]{36}$/)
    assert.deepEqual(client.calls.map((call) => call.name), [
      'admin_execute_starter_disposable_restore',
      'admin_verify_starter_disposable_restore'
    ])

    const serverPayload = client.calls[0].args.p_payload
    assert.equal(serverPayload.target_mode, 'disposable')
    assert.equal(serverPayload.actor_id, actorId)
    assert.equal(serverPayload.actor_email, actorEmail)
    assert.equal(serverPayload.tables.settings[0].public_offer_campsites, false)
    assert.deepEqual(serverPayload.tables.settings[0].operating_profile, { kind: 'lodge' })
    assert.equal(serverPayload.tables.rooms[0].accommodation_kind, 'campsite')
    assert.equal(serverPayload.tables.rooms[0].rate_mode, 'composite')
    assert.equal(serverPayload.tables.rooms[0].rate_per_tent, 30)
    assert.equal(serverPayload.tables.bookings[0].payment_method, 'card')
    assert.equal(serverPayload.tables.bookings[0].invoice_number, 'INV-1001')
    assert.equal(serverPayload.tables.bookings[0].tents_count, 2)
    assert.equal(serverPayload.tables.bookings[0].vehicles_count, 1)
    assert.equal(serverPayload.tables.bookings[0].accommodation_kind, 'campsite')
    assert.equal(serverPayload.tables.bookings[0].booking_accommodation_details.booking_id, serverPayload.tables.bookings[0].id)
    assert.equal(serverPayload.tables.bookings[0].booking_accommodation_details.lodge_id, result.recovery_lodge_id)
    assert.equal(serverPayload.tables.bookings[0].booking_accommodation_details.tents, 2)
    assert.equal(serverPayload.tables.bookings[0].booking_accommodation_details.vehicles, 1)
    assert.deepEqual(serverPayload.tables.bookings[0].booking_accommodation_details.pricing_snapshot, packagePayload().tables.bookings[0].booking_accommodation_details.pricing_snapshot)
    assert.equal(serverPayload.tables.quotations[0].quotation_type, 'room')
    assert.deepEqual(serverPayload.tables.quotations[0].accommodation_lines, [{ room_id: serverPayload.tables.rooms[0].id, nights: 2 }])
    assert.notEqual(serverPayload.tables.customers[0].id, 'c-a')
    assert.notEqual(serverPayload.tables.bookings[0].id, 'b-a')
    assert.equal(Object.hasOwn(serverPayload.tables.customers[0], '_source_id'), false)
    assert.equal(Object.hasOwn(serverPayload.tables.bookings[0], 'amount_paid'), false)
    assert.equal(Object.hasOwn(serverPayload.tables.bookings[0], 'payment_status'), false)

    const verification = await verifyStarterRecoveryOperation(operationId, { adminClient: client, isOnline: true })
    assert.equal(verification.success, true)
    assert.equal(verification.server_checks.quarantined, true)
    assert.equal(verification.server_checks.isolation_ok, true)
    assert.equal(verification.local_supplemental.success, true)

    const callsBeforeReplay = client.calls.length
    const replay = await executeStarterRecovery(operationId, { adminClient: client, isOnline: true })
    assert.equal(replay.server_verification_confirmed, true)
    assert.equal(client.calls.length, callsBeforeReplay)

    const operationPath = path.join(root, 'starter-recovery-operations', `${operationId}.json`)
    const reportPath = path.join(result.rehearsal_directory, 'restore-report.json')
    const persistedText = `${fs.readFileSync(operationPath, 'utf8')}\n${fs.readFileSync(reportPath, 'utf8')}`
    assert.match(persistedText, new RegExp(actorId))
    assert.match(persistedText, new RegExp(actorEmail.replace('.', '\\.')))
    assert.doesNotMatch(persistedText, /"name"\s*:\s*"Guest"|guest@example\.com|"c-a"|"b-a"|_source_id|identity-map\.json/i)
    assert.equal(fs.existsSync(path.join(result.rehearsal_directory, 'identity-map.json')), false)
  } finally {
    cleanupWorkspace(root)
  }
})

test('an execute RPC failure preserves approval and stable request identity for a safe retry', async () => {
  const root = setupWorkspace()
  try {
    const operationId = '00000000-0000-4000-a000-000000000002'
    await prepareApproved(root, operationId)
    const client = createFakeRecoveryClient()
    client.behavior.executeError = 'temporary service failure'

    await assert.rejects(
      () => executeStarterRecovery(operationId, { adminClient: client, isOnline: true }),
      /not confirmed by the server.*Retry this same operation/i
    )
    const retryable = getStarterRecoveryOperation(operationId)
    assert.equal(retryable.status, 'approved')
    assert.equal(retryable.server_verification_confirmed, undefined)
    assert.match(retryable.recovery_lodge_id, /^[0-9a-f-]{36}$/)
    assert.match(retryable.server_request_binding, /^[0-9a-f]{64}$/)
    assert.match(retryable.server_payload_binding, /^[0-9a-f]{64}$/)
    const failedPayload = client.calls[0].args.p_payload

    client.behavior.executeError = null
    const recovered = await executeStarterRecovery(operationId, { adminClient: client, isOnline: true })
    assert.equal(recovered.status, 'verified')
    assert.equal(recovered.recovery_lodge_id, retryable.recovery_lodge_id)
    const executeCalls = client.calls.filter((call) => call.name === 'admin_execute_starter_disposable_restore')
    assert.equal(executeCalls.length, 2)
    assert.deepEqual(executeCalls[1].args.p_payload, failedPayload)
  } finally {
    cleanupWorkspace(root)
  }
})

test('failed server isolation verification never produces false success and a changed request cannot replay', async () => {
  const root = setupWorkspace()
  try {
    const operationId = '00000000-0000-4000-a000-000000000003'
    await prepareApproved(root, operationId)
    const client = createFakeRecoveryClient()
    client.behavior.verifyOverride = { success: false, isolation_ok: false }

    await assert.rejects(
      () => executeStarterRecovery(operationId, { adminClient: client, isOnline: true }),
      /did not confirm quarantine.*lodge isolation/i
    )
    const unverified = getStarterRecoveryOperation(operationId)
    assert.equal(unverified.status, 'approved')
    assert.notEqual(unverified.server_verification_confirmed, true)
    assert.notEqual(unverified.supabase_restored, true)
    const verification = await verifyStarterRecoveryOperation(operationId, { adminClient: client, isOnline: true })
    assert.equal(verification.success, false)
    assert.equal(getStarterRecoveryOperation(operationId).status, 'approved')

    const operationPath = path.join(root, 'starter-recovery-operations', `${operationId}.json`)
    const changed = JSON.parse(fs.readFileSync(operationPath, 'utf8'))
    changed.approval_reason = 'Changed after the first server request'
    fs.writeFileSync(operationPath, JSON.stringify(changed))
    const callsBeforeMismatch = client.calls.length
    await assert.rejects(
      () => executeStarterRecovery(operationId, { adminClient: client, isOnline: true }),
      /approved recovery request changed|request changed/i
    )
    assert.equal(client.calls.length, callsBeforeMismatch)
  } finally {
    cleanupWorkspace(root)
  }
})

test('online state is required, operation IDs are strict UUID v4 values, and stale execute locks recover', async () => {
  const root = setupWorkspace()
  try {
    assert.throws(() => beginStarterRecoveryOperation({ operation_id: '../escape', lodge_id: lodgeId, reason: 'Customer recovery test', ticket_ref: 'SUP-100' }), /UUID v4/i)
    const operationId = '00000000-0000-4000-a000-000000000004'
    await prepareApproved(root, operationId)
    const client = createFakeRecoveryClient()
    await assert.rejects(() => executeStarterRecovery(operationId, { adminClient: client, isOnline: false }), /requires an online/i)
    assert.equal(getStarterRecoveryOperation(operationId).status, 'approved')

    state.currentUser = { id: 'not-a-uuid', email: actorEmail, isMasterAdmin: true }
    await assert.rejects(() => executeStarterRecovery(operationId, { adminClient: client, isOnline: true }), /valid user UUID/i)
    assert.equal(client.calls.length, 0)
    state.currentUser = { id: actorId, email: actorEmail, isMasterAdmin: true }

    const lockPath = path.join(root, 'starter-recovery-operations', `${operationId}.lock`)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, JSON.stringify({ operation_id: operationId, token: 'active', pid: process.pid, started_at: new Date().toISOString() }))
    await assert.rejects(() => executeStarterRecovery(operationId, { adminClient: client, isOnline: true }), /already executing/i)
    fs.writeFileSync(lockPath, JSON.stringify({ operation_id: operationId, token: 'stale', pid: 999999999, started_at: new Date(0).toISOString() }))
    const recovered = await executeStarterRecovery(operationId, { adminClient: client, isOnline: true })
    assert.equal(recovered.status, 'verified')
  } finally {
    cleanupWorkspace(root)
  }
})

test('discarded and expired operations do not permanently consume recovery capacity', () => {
  const root = setupWorkspace()
  try {
    const first = beginStarterRecoveryOperation({ operation_id: randomUUID(), lodge_id: lodgeId, reason: 'Customer recovery test', ticket_ref: 'SUP-100' })
    const operationPath = path.join(root, 'starter-recovery-operations', `${first.operation_id}.json`)
    const expired = JSON.parse(fs.readFileSync(operationPath, 'utf8'))
    expired.expires_at = new Date(0).toISOString()
    fs.writeFileSync(operationPath, JSON.stringify(expired))
    cleanupExpiredStagedOperations()
    assert.equal(getStarterRecoveryOperation(first.operation_id).status, 'discarded')

    for (let index = 0; index < 50; index += 1) {
      beginStarterRecoveryOperation({ operation_id: randomUUID(), lodge_id: lodgeId, reason: `Customer recovery test ${index}`, ticket_ref: `SUP-${index + 101}` })
    }
    assert.throws(() => beginStarterRecoveryOperation({ operation_id: randomUUID(), lodge_id: lodgeId, reason: 'Customer recovery capacity', ticket_ref: 'SUP-999' }), /Too many active/i)
    const active = fs.readdirSync(path.join(root, 'starter-recovery-operations')).find((name) => name.endsWith('.json') && name !== `${first.operation_id}.json`)
    const activeId = path.basename(active, '.json')
    discardStarterRecoveryOperation(activeId)
    const replacement = beginStarterRecoveryOperation({ operation_id: randomUUID(), lodge_id: lodgeId, reason: 'Customer recovery replacement', ticket_ref: 'SUP-1000' })
    assert.equal(replacement.status, 'draft')
  } finally {
    cleanupWorkspace(root)
  }
})
