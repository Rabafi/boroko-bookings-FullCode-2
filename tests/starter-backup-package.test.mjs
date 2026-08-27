import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {
  createStarterBackupPackage,
  validateStarterBackupPackage,
  reconstructBookingLedger,
  buildTableSnapshotCoherence,
  buildStarterBackupPayload,
  writeStarterBackupPackageBytes,
  verifyStarterBackupAtPath,
  createStarterRestoreRehearsal,
  recordStarterBackupHistory,
  getStarterBackupReminder
} from '../src/main/domains/starterBackup.js'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function payload() {
  return {
    schema: 'tsa-bonno-starter-backup/v1', app_version: '1.5.6', generated_at: '2026-08-25T10:00:00.000Z', lodge_id: 'lodge-a', mode: 'starter-core-data-export',
    recovery: { restore_mode: 'support-led', live_restore_available: false }, privacy: { contains_personal_data: true },
    completeness: { complete: true, warnings: [], tables: [{ table: 'settings', count: 1, complete: true }] },
    tables: { settings: [{ id: 'settings-a', lodge_id: 'lodge-a', lodge_name: 'Test Lodge', public_offer_campsites: false, operating_profile: { accommodation: 'mixed' } }], rooms: [], customers: [{ id: 'guest-a', lodge_id: 'lodge-a', name: 'Guest' }], bookings: [], quotations: [], signed_payment_ledger: [], maintenance: [] }
  }
}

test('Starter .tbbackup package round-trips canonical JSON with manifest, exclusions and full checksums', () => {
  const packaged = createStarterBackupPackage(payload(), { appVersion: '1.5.6' })
  const verified = validateStarterBackupPackage(packaged.bytes)
  assert.equal(verified.success, true)
  assert.equal(verified.manifest.format, 'tsa-bonno-starter-backup-package/v3')
  assert.equal(verified.perTableHashesVerified, true)
  assert.equal(verified.manifest.app_version, '1.5.6')
  assert.ok(verified.manifest.included_categories.includes('bookings'))
  assert.ok(verified.manifest.excluded_categories.includes('staff accounts and credentials'))
  assert.equal(verified.counts.customers, 1)
  assert.equal(verified.sanitizedTables.settings[0].public_offer_campsites, false)
  assert.deepEqual(verified.sanitizedTables.settings[0].operating_profile, { accommodation: 'mixed' })
  assert.equal(verified.coreDataSha256, packaged.coreDataSha256)
})

test('v3 per-table hashes are recomputed and sidecar tampering is rejected; v2 remains importable', () => {
  const packaged = createStarterBackupPackage(payload())
  const tampered = JSON.parse(packaged.bytes.toString('utf8'))
  tampered.manifest.per_table_hashes.customers = '0'.repeat(64)
  tampered.files['manifest.json'] = `${JSON.stringify(tampered.manifest, null, 2)}\n`
  tampered.checksums['manifest.json'] = sha256(tampered.files['manifest.json'])
  assert.throws(() => validateStarterBackupPackage(Buffer.from(JSON.stringify(tampered))), /per-table hash does not match/i)

  const legacy = createStarterBackupPackage(payload(), { useV3: false })
  const legacyVerified = validateStarterBackupPackage(legacy.bytes)
  assert.equal(legacy.manifest.format, 'tsa-bonno-starter-backup-package/v2')
  assert.equal(legacyVerified.success, true)
  assert.equal(legacyVerified.perTableHashesVerified, false)
  assert.equal(Object.keys(legacyVerified.perTableHashes).length, 7)

  const undefinedValue = payload()
  undefinedValue.tables.customers[0].optional_legacy_field = undefined
  assert.equal(validateStarterBackupPackage(createStarterBackupPackage(undefinedValue).bytes).success, true)
})

test('ledger validation requires production transaction types and signs, references real bookings, and exposes advisory derivation', () => {
  const source = payload()
  source.tables.bookings = [{ id: 'booking-a', lodge_id: 'lodge-a', total_amount: 100, charges_total: 0, status: 'confirmed' }]
  source.tables.signed_payment_ledger = [
    { id: 'payment-a', lodge_id: 'lodge-a', booking_id: 'booking-a', amount: 100, method: 'cash', type: 'payment' },
    { id: 'refund-a', lodge_id: 'lodge-a', booking_id: 'booking-a', amount: -20, method: 'cash', type: 'refund' }
  ]
  const verified = validateStarterBackupPackage(createStarterBackupPackage(source).bytes)
  assert.equal(verified.success, true)
  const ledger = reconstructBookingLedger(source.tables)
  assert.equal(ledger.advisory, true)
  assert.equal(ledger.authoritative, false)
  assert.equal(ledger.bookingResults[0].derived_amount_paid, 80)
  assert.equal(ledger.bookingResults[0].derived_payment_status, 'partial')

  const orphanSource = structuredClone(source.tables)
  orphanSource.signed_payment_ledger.push({ id: 'orphan', lodge_id: 'lodge-a', booking_id: 'missing', amount: 5, method: 'cash', type: 'payment' })
  assert.throws(() => reconstructBookingLedger(orphanSource), /not included/i)
  assert.equal(reconstructBookingLedger(orphanSource, { strict: false }).orphanPayments.length, 1)

  for (const invalid of [
    { amount: 20, type: 'refund', message: /refund.*negative/i },
    { amount: -20, type: 'payment', message: /positive.*payment/i },
    { amount: 20, type: 'cash', message: /unsupported transaction type/i },
    { amount: 20, type: 'payment', booking_id: 'missing', message: /not included/i }
  ]) {
    const invalidSource = payload()
    invalidSource.tables.bookings = source.tables.bookings
    invalidSource.tables.signed_payment_ledger = [{ id: 'invalid', lodge_id: 'lodge-a', ...invalid }]
    assert.throws(() => validateStarterBackupPackage(createStarterBackupPackage(invalidSource).bytes), invalid.message)
  }
})

test('campsite booking scalars and nested accommodation details survive the DTO and validate strictly', () => {
  const source = payload()
  source.tables.bookings = [{
    id: 'booking-campsite',
    lodge_id: 'lodge-a',
    total_amount: 220,
    tents_count: 2,
    vehicles_count: 1,
    accommodation_kind: 'campsite',
    booking_accommodation_details: {
      booking_id: 'booking-campsite',
      lodge_id: 'lodge-a',
      accommodation_kind: 'campsite',
      adults: 2,
      children: 1,
      tents: 2,
      vehicles: 1,
      rate_mode: 'composite',
      pricing_snapshot: { nights: 2, tents: 2, vehicles: 1, calculated_total: 220 },
      created_at: '2026-08-25T10:00:00.000Z',
      unsupported_nested_field: 'stripped',
      pricing_snapshot_unknown: 'not-in-snapshot'
    }
  }]
  const packaged = createStarterBackupPackage(source)
  const verified = validateStarterBackupPackage(packaged.bytes)
  const booking = verified.sanitizedTables.bookings[0]
  assert.equal(booking.tents_count, 2)
  assert.equal(booking.vehicles_count, 1)
  assert.equal(booking.accommodation_kind, 'campsite')
  assert.equal(booking.booking_accommodation_details.unsupported_nested_field, undefined)
  assert.deepEqual(booking.booking_accommodation_details.pricing_snapshot, { nights: 2, tents: 2, vehicles: 1, calculated_total: 220 })

  for (const [field, value] of [['tents', -1], ['vehicles', 1.5], ['adults', '2']]) {
    const invalid = structuredClone(source)
    invalid.tables.bookings[0].booking_accommodation_details[field] = value
    assert.throws(() => validateStarterBackupPackage(createStarterBackupPackage(invalid).bytes), /non-negative 32-bit integer/i)
  }
  const wrongReference = structuredClone(source)
  wrongReference.tables.bookings[0].booking_accommodation_details.lodge_id = 'other-lodge'
  assert.throws(() => validateStarterBackupPackage(createStarterBackupPackage(wrongReference).bytes), /detail lodge_id/i)
  const wrongCounts = structuredClone(source)
  wrongCounts.tables.bookings[0].tents_count = 3
  assert.throws(() => validateStarterBackupPackage(createStarterBackupPackage(wrongCounts).bytes), /tents_count disagrees/i)
})

test('snapshot disclosure remains non-transactional even when count rechecks find no drift', () => {
  const tables = { settings: [], rooms: [], customers: [], bookings: [], quotations: [], signed_payment_ledger: [], maintenance: [] }
  const disclosure = buildTableSnapshotCoherence(tables, [], false)
  assert.equal(disclosure.snapshot_coherent, false)
  assert.equal(disclosure.transactional_snapshot, false)
  assert.equal(disclosure.drift_status, 'not_detected_by_count_recheck')
  assert.equal(disclosure.per_table.bookings.read_consistency, 'individual_read_only')
})

test('offline payload discloses per-table reads and strips identity/media artifacts before packaging', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-starter-payload-'))
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify([{ id: 'settings-a', lodge_id: 'lodge-a', lodge_name: 'Test', logo: 'data:image/png' }]))
  fs.writeFileSync(path.join(directory, 'customers.json'), JSON.stringify([{ id: 'customer-a', lodge_id: 'lodge-a', name: 'Guest', id_photo: 'data:image/png' }]))
  const built = await buildStarterBackupPayload({ lodgeId: 'lodge-a', isOnline: false, cacheDir: directory })
  assert.equal(built.completeness.complete, false)
  assert.equal(built.completeness.snapshot_coherence.snapshot_coherent, false)
  assert.equal(built.tables.settings[0].logo, undefined)
  assert.equal(built.tables.customers[0].id_photo, undefined)
  assert.equal(built.completeness.dto_sanitization.per_table.settings.fields.logo, 1)
  assert.equal(built.completeness.dto_sanitization.per_table.customers.fields.id_photo, 1)
})

test('package construction excludes protected identity/media fields before support-led recovery', () => {
  const source = payload()
  source.tables.bookings.push({ id: 'booking-derived', lodge_id: 'lodge-a', total_amount: 10, payment_status: 'paid', amount_paid: 10 })
  source.tables.settings[0].logo = 'data:image/png;base64,large-image'
  source.tables.settings[0].lodge_mesh_secret = 'must-not-ship'
  source.tables.customers[0].id_photo = 'data:image/png;base64,identity-photo'
  const packaged = createStarterBackupPackage(source)
  const verified = validateStarterBackupPackage(packaged.bytes)
  assert.equal(verified.success, true)
  assert.equal(verified.payload.tables.settings[0].logo, undefined)
  assert.equal(verified.payload.tables.settings[0].lodge_mesh_secret, undefined)
  assert.equal(verified.payload.tables.customers[0].id_photo, undefined)
  assert.equal(verified.payload.tables.bookings[0].payment_status, undefined)
  assert.equal(verified.payload.tables.bookings[0].amount_paid, undefined)
  assert.equal(verified.dtoSanitization.stripped_field_count, 5)
})

test('package validation requires lodge identity on every non-settings record', () => {
  const source = payload()
  delete source.tables.customers[0].lodge_id
  const packaged = createStarterBackupPackage(source)
  assert.throws(() => validateStarterBackupPackage(packaged.bytes), /without the active lodge identity/i)
})

test('tampering with a package is detected before support-led recovery', () => {
  const packaged = createStarterBackupPackage(payload())
  const tampered = JSON.parse(packaged.bytes.toString('utf8'))
  tampered.files['core-data.json'] = tampered.files['core-data.json'].replace('Test Lodge', 'Tampered Lodge')
  assert.throws(() => validateStarterBackupPackage(Buffer.from(JSON.stringify(tampered))), /checksum/i)
})

test('atomic package writes clean up temporary files and never replace a directory target', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-starter-atomic-'))
  const target = path.join(directory, 'recovery.tbbackup')
  fs.mkdirSync(target)
  assert.throws(() => writeStarterBackupPackageBytes(target, Buffer.from('package')), /writ|EISDIR|EPERM|existing/i)
  assert.deepEqual(fs.readdirSync(directory), ['recovery.tbbackup'])
})

test('encrypted package round-trips, rejects wrong passwords, and never stores the passphrase', () => {
  const passphrase = 'correct horse battery staple'
  const packaged = createStarterBackupPackage(payload(), { passphrase })
  assert.equal(packaged.encrypted, true)
  assert.equal(packaged.bytes.toString('utf8').includes(passphrase), false)
  assert.equal(validateStarterBackupPackage(packaged.bytes, { passphrase }).success, true)
  assert.throws(() => validateStarterBackupPackage(packaged.bytes, { passphrase: 'wrong password completely' }), /decrypt|passphrase/i)
  const tampered = JSON.parse(packaged.bytes.toString('utf8'))
  tampered.ciphertext = `${tampered.ciphertext.slice(0, -2)}AA`
  assert.throws(() => validateStarterBackupPackage(Buffer.from(JSON.stringify(tampered)), { passphrase }), /changed|incomplete|decrypt/i)
  const headerTampered = JSON.parse(packaged.bytes.toString('utf8'))
  headerTampered.lodge_id = 'another-lodge'
  assert.throws(() => validateStarterBackupPackage(Buffer.from(JSON.stringify(headerTampered)), { passphrase }), /header and manifest identity/i)
})

test('support verifier and disposable restore rehearsal validate without live overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-starter-rehearsal-'))
  const source = path.join(directory, 'recovery.tbbackup')
  const packaged = createStarterBackupPackage(payload(), { passphrase: 'correct horse battery staple' })
  fs.writeFileSync(source, packaged.bytes)
  const verified = verifyStarterBackupAtPath(source, { passphrase: 'correct horse battery staple', expectedLodgeId: 'lodge-a' })
  assert.equal(verified.success, true)
  const rehearsal = createStarterRestoreRehearsal(source, path.join(directory, 'rehearsals'), { passphrase: 'correct horse battery staple', expectedLodgeId: 'lodge-a' })
  assert.equal(rehearsal.success, true)
  assert.equal(rehearsal.canRestoreLive, false)
  const report = JSON.parse(fs.readFileSync(path.join(rehearsal.rehearsalDirectory, 'restore-report.json'), 'utf8'))
  assert.equal(report.validation, 'passed')
  assert.equal(report.writes_personal_data, false)
  assert.equal(report.restored_tables.customers.count, 1)
  assert.equal(fs.existsSync(path.join(rehearsal.rehearsalDirectory, 'core-data.json')), false)
  assert.throws(() => validateStarterBackupPackage(packaged.bytes, { passphrase: 'correct horse battery staple', expectedLodgeId: 'other-lodge' }), /different lodge/i)
})

test('Starter history records the last export and gives a seven-day reminder without managed-backup entitlements', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-starter-history-'))
  const historyPath = path.join(directory, 'starter-backup-history.json')
  recordStarterBackupHistory(historyPath, { lodgeId: 'lodge-a', fileName: 'recovery.tbbackup', destination: path.join(directory, 'recovery.tbbackup'), at: '2026-08-01T10:00:00.000Z', sha256: 'abc', complete: true })
  const reminder = getStarterBackupReminder(historyPath, { lodgeId: 'lodge-a', now: '2026-08-10T10:00:00.000Z' })
  assert.equal(reminder.state, 'due')
  assert.equal(reminder.lastBackupFileName, 'recovery.tbbackup')
})
