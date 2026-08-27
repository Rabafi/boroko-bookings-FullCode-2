import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import {
  createStarterBackupPackage,
  validateStarterBackupPackage,
  STARTER_BACKUP_PACKAGE_SCHEMA,
  STARTER_BACKUP_PACKAGE_SCHEMA_V3,
  RESTORE_FIELD_ALLOWLIST,
  reconstructBookingLedger,
  buildTableSnapshotCoherence,
  buildRecoveryIdentityMap,
  remapPayloadForRecovery,
  writeStarterBackupPackageBytes
} from '../src/main/domains/starterBackup.js'

function payload() {
  return {
    schema: 'tsa-bonno-starter-backup/v1', app_version: '1.5.6', generated_at: '2026-08-25T10:00:00.000Z', lodge_id: 'lodge-a',
    recovery: { restore_mode: 'support-led', live_restore_available: false }, privacy: { contains_personal_data: true },
    completeness: { complete: true, warnings: [], tables: [{ table: 'settings', count: 1, complete: true }] },
    tables: {
      settings: [{ id: 's-a', lodge_id: 'lodge-a', lodge_name: 'Test Lodge', slug: 'test-lodge' }],
      rooms: [{ id: 'r-a', lodge_id: 'lodge-a', room_number: '101', price_per_night: 100 }],
      customers: [{ id: 'c-a', lodge_id: 'lodge-a', name: 'Guest', email: 'guest@example.com' }],
      bookings: [{ id: 'b-a', lodge_id: 'lodge-a', room_id: 'r-a', customer_id: 'c-a', check_in: '2026-08-20', check_out: '2026-08-22', status: 'confirmed', total_amount: 200, charges_total: 20 }],
      quotations: [{ id: 'q-a', lodge_id: 'lodge-a', customer_id: 'c-a', total_amount: 150 }],
      signed_payment_ledger: [
        { id: 'p-a', lodge_id: 'lodge-a', booking_id: 'b-a', amount: 100, method: 'cash', type: 'payment', paid_at: '2026-08-20' },
        { id: 'p-b', lodge_id: 'lodge-a', booking_id: 'b-a', amount: -20, method: 'cash', type: 'refund', paid_at: '2026-08-21' }
      ],
      maintenance: [{ id: 'm-a', lodge_id: 'lodge-a', room_id: 'r-a', issue: 'Leak', status: 'open' }]
    }
  }
}

test('DTO allowlist strips unknown fields and import ceiling is enforced on validated packages', () => {
  const source = payload()
  source.tables.customers[0].rogue_field = 'should be stripped'
  source.tables.bookings[0].rogue_field = 'strip me'
  const pkg = createStarterBackupPackage(source)
  const result = validateStarterBackupPackage(pkg.bytes)
  assert.equal(result.success, true)
  assert.equal(result.sanitizedTables.customers[0].rogue_field, undefined)
  assert.equal(result.sanitizedTables.bookings[0].rogue_field, undefined)
  // Protected and unknown fields are excluded from the restore DTO and the
  // package records the omission for support review.
  const bad = payload()
  bad.tables.customers[0].lodge_mesh_secret = 'secret'
  const badPkg = createStarterBackupPackage(bad)
  const badResult = validateStarterBackupPackage(badPkg.bytes)
  assert.equal(badResult.success, true)
  assert.equal(badResult.sanitizedTables.customers[0].lodge_mesh_secret, undefined)
  assert.equal(badResult.dtoSanitization.per_table.customers.fields.lodge_mesh_secret, 1)
  // Row ceiling on import: validate must reject over-limit packages
  const large = payload()
  large.tables.customers = Array.from({ length: 100001 }, (_, i) => ({ id: `c-${i}`, lodge_id: 'lodge-a', name: `Guest ${i}` }))
  const largePkg = createStarterBackupPackage(large)
  assert.throws(() => validateStarterBackupPackage(largePkg.bytes), /exceeds the 100,000 record ceiling/i)
  // Package size ceiling: >256MB envelope must be rejected
  const bigBuffer = Buffer.alloc(257 * 1024 * 1024, 'x')
  assert.throws(() => validateStarterBackupPackage(bigBuffer), /too large|not a valid/i)
})

test('Restore DTO preserves current core schema fields while excluding uploaded room media', () => {
  const source = payload()
  Object.assign(source.tables.rooms[0], {
    rate_per_night: 125,
    max_occupancy: 3,
    housekeeping_status: 'clean',
    housekeeping_notes: 'Inspected',
    amenities: ['wifi'],
    accommodation_kind: 'room',
    capacity_adults: 2,
    capacity_children: 1,
    rate_mode: 'site',
    photo: 'data:image/png;base64,photo',
    photos: ['data:image/png;base64,photo']
  })
  Object.assign(source.tables.customers[0], { notes: 'Returning guest' })
  Object.assign(source.tables.bookings[0], {
    adults: 2,
    children: 1,
    deposit_amount: 50,
    payment_method: 'cash',
    booking_number: 1001,
    invoice_number: 'INV-1001',
    is_exclusive_event: false,
    vat_enabled: true,
    vat_rate: 14,
    cancel_reason: null,
    cancelled_at: null
  })
  Object.assign(source.tables.quotations[0], {
    quotation_number: 'Q-1001',
    customer_name: 'Guest',
    customer_phone: '+26770000000',
    room_name: '101',
    adults: 2,
    children: 1,
    subtotal: 131.58,
    tax_amount: 18.42,
    currency: 'BWP',
    created_by: 'staff-a',
    quotation_type: 'room',
    accommodation_lines: [{ room_id: 'r-a', nights: 2 }]
  })
  Object.assign(source.tables.maintenance[0], {
    title: 'Leaking tap',
    description: 'Bathroom tap leaks',
    reported_date: '2026-08-20',
    notes: 'Call plumber',
    labour_cost: 10,
    parts_cost: 5,
    total_cost: 15,
    vendor_name: 'Plumber',
    cost_notes: 'Paid on completion'
  })
  const packaged = createStarterBackupPackage(source)
  const result = validateStarterBackupPackage(packaged.bytes)
  assert.equal(result.success, true)
  assert.equal(result.sanitizedTables.rooms[0].rate_per_night, 125)
  assert.equal(result.sanitizedTables.rooms[0].max_occupancy, 3)
  assert.equal(result.sanitizedTables.rooms[0].housekeeping_status, 'clean')
  assert.deepEqual(result.sanitizedTables.rooms[0].amenities, ['wifi'])
  assert.equal(result.sanitizedTables.rooms[0].photo, undefined)
  assert.equal(result.sanitizedTables.rooms[0].photos, undefined)
  assert.equal(result.sanitizedTables.customers[0].notes, 'Returning guest')
  assert.equal(result.sanitizedTables.bookings[0].adults, 2)
  assert.equal(result.sanitizedTables.bookings[0].deposit_amount, 50)
  assert.equal(result.sanitizedTables.bookings[0].invoice_number, 'INV-1001')
  assert.equal(result.sanitizedTables.quotations[0].quotation_number, 'Q-1001')
  assert.equal(result.sanitizedTables.quotations[0].customer_phone, '+26770000000')
  assert.deepEqual(result.sanitizedTables.quotations[0].accommodation_lines, [{ room_id: 'r-a', nights: 2 }])
  assert.equal(result.sanitizedTables.maintenance[0].reported_date, '2026-08-20')
  assert.equal(result.sanitizedTables.maintenance[0].total_cost, 15)
  assert.equal(result.dtoSanitization.per_table.rooms.fields.photo, 1)
  assert.equal(result.dtoSanitization.per_table.rooms.fields.photos, 1)
})

test('v3 manifest carries per-table canonical hashes and v2 adapts via backend-normalized hashes', () => {
  // v3 is the production default and its sidecar is verified against a fresh
  // canonical hash of the sanitized DTO.
  const v3 = createStarterBackupPackage(payload())
  const v3Result = validateStarterBackupPackage(v3.bytes)
  assert.equal(v3Result.format, STARTER_BACKUP_PACKAGE_SCHEMA_V3)
  assert.equal(v3Result.perTableHashesVerified, true)
  assert.ok(v3Result.perTableHashes.rooms)
  // Tampering with a per-table hash must fail for v3 (either checksum or hash mismatch — both are closed)
  const tampered = JSON.parse(v3.bytes.toString('utf8'))
  if (tampered.manifest?.per_table_hashes) {
    tampered.manifest.per_table_hashes.rooms = 'deadbeef'.repeat(8)
    assert.throws(() => validateStarterBackupPackage(Buffer.from(JSON.stringify(tampered))), /checksum|per-table hash|manifest copies/i)
  }
  // v2 is an explicit legacy export/import adapter. Hashes are recomputed,
  // but a v2 package without a sidecar cannot claim sidecar verification.
  const v2 = createStarterBackupPackage(payload(), { useV3: false })
  const v2Result = validateStarterBackupPackage(v2.bytes)
  assert.equal(v2Result.format, STARTER_BACKUP_PACKAGE_SCHEMA)
  assert.ok(v2Result.perTableHashes)
  assert.equal(v2Result.perTableHashesVerified, false)
})

test('Financial ledger reconstruction exposes advisory totals/status and fails closed on invalid ledger rows', () => {
  const tables = payload().tables
  const ledger = reconstructBookingLedger(tables)
  assert.equal(ledger.advisory, true)
  assert.equal(ledger.authoritative, false)
  assert.match(ledger.authority_note, /advisory|production database/i)
  assert.equal(ledger.totals.gross_collections, 100)
  assert.equal(ledger.totals.refunds, 20)
  assert.equal(ledger.totals.net_paid, 80)
  assert.equal(ledger.bookingResults.length, 1)
  assert.equal(ledger.bookingResults[0].derived_amount_paid, 80)
  assert.equal(ledger.bookingResults[0].derived_payment_status, 'partial')
  assert.equal(ledger.bookingResults[0].gross_total, 220)
  assert.match(ledger.missing_lineage_disclosure, /idempotency keys.*not part/i)
  // Orphans are not accepted by the restore contract. An explicit diagnostic
  // mode may disclose them without presenting them as restored money.
  const withOrphan = payload().tables
  withOrphan.signed_payment_ledger.push({ id: 'p-orphan', lodge_id: 'lodge-a', booking_id: 'missing', amount: 50, method: 'card', type: 'payment' })
  assert.throws(() => reconstructBookingLedger(withOrphan), /not included|orphaned/i)
  const ledger2 = reconstructBookingLedger(withOrphan, { strict: false })
  assert.equal(ledger2.orphanPayments.length, 1)
  assert.equal(ledger2.orphanPayments[0].id, 'p-orphan')
  for (const [amount, type, message] of [
    [20, 'refund', /refund.*negative/i],
    [-20, 'payment', /positive.*payment/i]
  ]) {
    const invalid = structuredClone(tables)
    invalid.signed_payment_ledger[0] = { ...invalid.signed_payment_ledger[0], amount, type }
    assert.throws(() => reconstructBookingLedger(invalid), message)
  }
  // Paid booking: full payment
  const paidPayload = payload()
  paidPayload.tables.bookings[0].total_amount = 100
  paidPayload.tables.bookings[0].charges_total = 0
  paidPayload.tables.signed_payment_ledger = [{ id: 'p-1', lodge_id: 'lodge-a', booking_id: 'b-a', amount: 100, method: 'cash', type: 'payment' }]
  const ledger3 = reconstructBookingLedger(paidPayload.tables)
  assert.equal(ledger3.bookingResults[0].derived_payment_status, 'paid')
})

test('Identity remapping is deterministic and preserves provenance while rewriting lodge scope', () => {
  const source = payload()
  const operationId = '00000000-0000-4000-a000-000000000001'
  const recoveryLodgeId = '11111111-1111-4111-8111-111111111111'
  const map1 = buildRecoveryIdentityMap(source, { operationId, recoveryLodgeId })
  const map2 = buildRecoveryIdentityMap(source, { operationId, recoveryLodgeId })
  assert.deepEqual(map1, map2)
  // Same seed produces same IDs; different seed produces different IDs
  const mapOther = buildRecoveryIdentityMap(source, { operationId: '00000000-0000-4000-a000-000000000002', recoveryLodgeId })
  assert.notEqual(map1.rooms['r-a'], mapOther.rooms['r-a'])
  // Remapped payload writes to recovery lodge, never to source lodge
  const remapped = remapPayloadForRecovery(source, map1)
  assert.equal(remapped.lodge_id, recoveryLodgeId)
  assert.equal(remapped.tables.rooms[0].lodge_id, recoveryLodgeId)
  assert.equal(remapped.tables.rooms[0]._source_id, 'r-a')
  assert.notEqual(remapped.tables.rooms[0].id, 'r-a')
  assert.equal(remapped.tables.bookings[0].room_id, map1.rooms['r-a'])
  assert.equal(remapped.tables.bookings[0].customer_id, map1.customers['c-a'])
  assert.equal(remapped.tables.signed_payment_ledger[0].booking_id, map1.bookings['b-a'])
  assert.match(remapped.tables.settings[0].slug, /-recovery-11111111/)
  assert.equal(remapped._recovery_provenance.source_lodge_id, 'lodge-a')
  // Conference references are marked unresolved, not silently kept
  const confSource = payload()
  confSource.tables.signed_payment_ledger[0].conference_booking_id = 'conf-123'
  const remappedConf = remapPayloadForRecovery(confSource, map1)
  assert.equal(remappedConf.tables.signed_payment_ledger[0]._unresolved_conference_ref, 'conf-123')
})

test('RESTORE_FIELD_ALLOWLIST is explicit and does not include protected secrets', () => {
  for (const table of ['settings', 'rooms', 'customers', 'bookings', 'quotations', 'signed_payment_ledger', 'maintenance']) {
    assert.ok(RESTORE_FIELD_ALLOWLIST[table] instanceof Set, `${table} allowlist exists`)
    assert.equal(RESTORE_FIELD_ALLOWLIST[table].has('lodge_mesh_secret'), false)
    assert.equal(RESTORE_FIELD_ALLOWLIST[table].has('idempotency_key'), false)
  }
  assert.ok(RESTORE_FIELD_ALLOWLIST.settings.has('slug'))
  assert.ok(RESTORE_FIELD_ALLOWLIST.signed_payment_ledger.has('amount'))
  assert.equal(RESTORE_FIELD_ALLOWLIST.customers.has('id_photo'), false)
  assert.equal(RESTORE_FIELD_ALLOWLIST.bookings.has('payment_status'), false)
  assert.equal(RESTORE_FIELD_ALLOWLIST.rooms.has('photo'), false)
  assert.equal(RESTORE_FIELD_ALLOWLIST.rooms.has('photos'), false)
})

test('Atomic write uses temp+rename with fsync and cleanup of temp files', () => {
  const domain = fs.readFileSync('src/main/domains/starterBackup.js', 'utf8')
  assert.match(domain, /writeFileSync\(temporaryPath, bytes, \{ flag: 'wx' \}\)/)
  assert.match(domain, /renameSync\(temporaryPath, filePath\)/)
  assert.match(domain, /fsyncFileSync|fsyncSync/)
  assert.match(domain, /fsyncDirSync/)
  // Verify actual atomic behavior in temp dir
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'))
  const target = path.join(dir, 'a.tbbackup')
  writeStarterBackupPackageBytes(target, Buffer.from('hello'))
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello')
  // Second write to same file should have used temp+rename; no .tmp remains
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))
  assert.equal(files.length, 0)
})

test('Immutable backup context and snapshot coherence are recorded', () => {
  const domain = fs.readFileSync('src/main/domains/starterBackup.js', 'utf8')
  assert.match(domain, /captureBackupContext/)
  assert.match(domain, /snapshot_coherent/)
  assert.match(domain, /Independent reads; not a coherent|independent_read_non_transactional/)
  assert.doesNotMatch(domain, /snapshot_coherent:\s*true/)
  const source = payload()
  const pkg = createStarterBackupPackage(source)
  validateStarterBackupPackage(pkg.bytes)
  assert.match(domain, /snapshot_coherence: snapshotCoherence/)
  const disclosure = buildTableSnapshotCoherence(source.tables, [], false)
  assert.equal(disclosure.snapshot_coherent, false)
  assert.equal(disclosure.transactional_snapshot, false)
  assert.equal(disclosure.per_table.bookings.read_consistency, 'individual_read_only')
})

test('Recovery workspace: decryption never reaches SQL and scaling guard is 256MB', () => {
  const recovery = fs.readFileSync('src/main/domains/starterRecovery.js', 'utf8')
  // Passphrase must never be a SQL RPC parameter. The file may mention 'passphrase to SQL' in a comment explaining it is NOT done.
  assert.doesNotMatch(recovery, /p_passphrase/)
  // But the implementation must document that decryption stays in main process
  assert.match(recovery, /decrypt in main process only|Passphrase.*never.*persisted|never store.*passphrase/i)
  assert.match(recovery, /MAX_STAGED_BYTES = 256 \* 1024 \* 1024/)
  for (const status of ['draft', 'staging', 'sealed', 'preview_ready', 'approved', 'executing', 'verified', 'discarded']) {
    assert.match(recovery, new RegExp(status))
  }
  assert.match(recovery, /disposable_recovery_directory/)
  assert.match(recovery, /Live-lodge replacement is not available/)
  // Ensure audit redaction strips passphrase
  assert.match(recovery, /delete entry\.details\.passphrase/)
})

test('Decryption uses Node scrypt/AES in main process, not pgcrypto', () => {
  const backup = fs.readFileSync('src/main/domains/starterBackup.js', 'utf8')
  assert.match(backup, /scryptSync/)
  assert.match(backup, /aes-256-gcm/)
  const migration = fs.readFileSync('supabase/migrations/20260826000000_starter_recovery_and_automation.sql', 'utf8')
  assert.doesNotMatch(migration, /pgcrypto|decrypt.*passphrase|p_passphrase/i)
  assert.match(migration, /passphrase never reaches PostgreSQL/)
})

test('Automation: durable per-lodge window, crash-recovery lock, and audit states', () => {
  const auto = fs.readFileSync('src/main/domains/starterBackupAutomation.js', 'utf8')
  assert.match(auto, /run_id.*window_id|window_id.*run_id/i)
  assert.match(auto, /acquireRunLock|run-.*\.lock/)
  assert.match(auto, /EEXIST.*already running/i)
  assert.match(auto, /starter-backup-automation.*safeLodge|lodgeId.*automation/i)
  assert.match(auto, /audit_unconfirmed|verified.*audit/i)
  assert.match(auto, /recordStarterArtifactAudit/)
  assert.match(auto, /snoozeStarterBackupAutomation|snoozed_until/)
  assert.match(auto, /captureBackupContext/)
  assert.match(auto, /pruneRetention|AUTOMATION_MAX_RETAINED/)
  assert.match(auto, /positively identified.*scheduler-owned|Keep.*positively identified|pruneRetention/i)
  assert.match(auto, /fsyncFile|fsyncDir|writeAtomicJson/)
  assert.match(auto, /starter_backup_automation/)
  assert.match(auto, /safeStorage.*isEncryptionAvailable|canUseSafeStorage/)
})

test('Automation retention and managed-backup separation', () => {
  const auto = fs.readFileSync('src/main/domains/starterBackupAutomation.js', 'utf8')
  const ent = fs.readFileSync('supabase/migrations/20260826000000_starter_recovery_and_automation.sql', 'utf8')
  assert.match(auto, /We do not enter the managed-backup path|do not enter the managed/i)
  assert.match(ent, /starter_backup_automation/)
  assert.doesNotMatch(ent, /hospitality-pos|bar_pos/)
  assert.match(auto, /getAutomationRoot.*lodgeId|starter-backup-automation.*safeLodge/)
  assert.match(auto, /getHistoryPath.*lodgeId|starter-backup-history\.json/)
})

test('Backup reads use immutable context, not mutable globals per table', () => {
  const backup = fs.readFileSync('src/main/domains/starterBackup.js', 'utf8')
  assert.match(backup, /captureBackupContext/)
  assert.match(backup, /_backupContext/)
  assert.match(backup, /loadLodgeRowsForBackup.*context/)
  // Ensure the old pattern of reading state.lodgeId inside the loop is gone from load path
  // The new function should capture lodgeId from context, not re-read state each iteration
  assert.match(backup, /const lodgeId = effectiveContext\.lodgeId/)
  assert.match(backup, /const supabaseClient = effectiveContext\.supabaseClient/)
})

test('IPC and preload expose recovery and automation without leaking passphrase', () => {
  const preload = fs.readFileSync('src/preload/index.js', 'utf8')
  const main = fs.readFileSync('src/main/index.js', 'utf8')
  const db = fs.readFileSync('src/main/database.js', 'utf8')
  const access = fs.readFileSync('src/shared/accessControl.js', 'utf8')
  assert.match(preload, /recoveryBegin.*invoke\('backup:recoveryBegin'/)
  assert.match(preload, /automationStatus.*invoke\('backup:automationStatus'/)
  assert.match(main, /ipcMain\.handle\('backup:recoveryBegin'/)
  assert.match(main, /ipcMain\.handle\('backup:automationStatus'/)
  assert.match(main, /requireCapability\('command_central\.recovery\.manage'\)/)
  assert.match(main, /requireCapability\('backup\.starter_automation'\)/)
  assert.match(db, /beginStarterRecoveryOperation/)
  assert.match(db, /getStarterBackupAutomationStatus/)
  assert.match(access, /backup\.starter_automation/)
  assert.match(access, /command_central\.recovery\.manage/)
  assert.match(access, /starter_backup_automation/)
  // Preload must not expose raw passphrase in logs
  assert.doesNotMatch(preload, /passphrase.*log|console\.log.*passphrase/i)
})
