import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, mkdtemp, mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertRestoreAuthorization,
  assertRestoreTargetEmpty,
  assertRestoreVerification,
  assertVerificationTarget,
  applyRetention,
  buildRuntimeSecurityStatements,
  copyBackupPackage,
  createEncryptedBackup,
  decryptFile,
  encryptFile,
  loadEncryptionKey,
  probeRuntimeSecurity,
  readBackupManifest,
  restoreBackupPackageToDatabase,
  selectRetentionEntries,
  spawnCommand,
  verifyBackupPackage,
  verifyRuntimeSecurity
} from '../dist/operations/backup.js'
import {
  applyStagedUpdate,
  assertDiskSpace,
  assertUpgradeVersion,
  createEd25519UpdateTrust,
  executeUninstall,
  parseUpdateManifest,
  planUninstall,
  updateSigningPayloadSha256,
  validateUpdatePackage
} from '../dist/operations/updates.js'
import {
  buildNetworkStatus,
  classifyBindHost,
  parseNetworkRole,
  probeService,
  resolveWriteAuthority
} from '../dist/operations/network.js'

const HEADER_BYTES = 54

async function temporaryDirectory(t, prefix = 'bar-operations-test-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const TEST_TRUST_KEY_ID = 'test-release-key'

function testTrust(overrides = {}) {
  return {
    keyId: TEST_TRUST_KEY_ID,
    verify: async () => true,
    ...overrides
  }
}

function rawKey(byte = '11') {
  return loadEncryptionKey({ env: { BAR_LOCAL_BACKUP_KEY: byte.repeat(32) } })
}

function updateManifest(overrides = {}) {
  return {
    format: 'bar-local-update',
    format_version: 1,
    package: { name: 'bar-local-service', version: '1.1.0' },
    compatibility: {
      schema: { min: 18, max: 20 },
      contract: { min: 1, max: 1 },
      service: { min: '1.0.0', max: '2.0.0' }
    },
    files: [{ source: 'payload/app', target: 'app', sha256: 'a'.repeat(64), bytes: 1 }],
    requires: { min_free_bytes: 0, extra_free_bytes: 0 },
    created_at: '2026-01-01T00:00:00.000Z',
    notes: 'test package',
    signature: { algorithm: 'ed25519', key_id: TEST_TRUST_KEY_ID, value: 'A'.repeat(64) },
    ...overrides
  }
}

async function writeUpdatePackage(t, files, manifestOverrides = {}) {
  const root = await temporaryDirectory(t, 'bar-update-package-')
  const manifestFiles = []
  for (const file of files) {
    const sourcePath = path.join(root, ...file.source.split('/'))
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, file.bytes)
    manifestFiles.push({
      source: file.source,
      target: file.target,
      sha256: sha256(file.bytes),
      bytes: Buffer.byteLength(file.bytes),
      ...(file.mode === undefined ? {} : { mode: file.mode })
    })
  }
  const manifest = updateManifest({ ...manifestOverrides, files: manifestFiles })
  const manifestPath = path.join(root, 'update-manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, manifestPath, manifest }
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.resolve(import.meta.dirname, '../scripts/bar-operations.mjs'), ...args],
      { cwd: path.resolve(import.meta.dirname, '..') },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr })
      }
    )
  })
}

test('AES-256-GCM backup encryption round-trips and detects tampering', async (t) => {
  const directory = await temporaryDirectory(t)
  const key = rawKey()
  const inputPath = path.join(directory, 'dump.pgcustom')
  const encryptedPath = path.join(directory, 'dump.blb')
  const decryptedPath = path.join(directory, 'restored.pgcustom')
  const plaintext = Buffer.from('PGDMP-fake-custom-format-content', 'utf8')
  await writeFile(inputPath, plaintext)

  const encrypted = await encryptFile({ inputPath, outputPath: encryptedPath, key })
  assert.equal(encrypted.plaintextBytes, plaintext.length)
  assert.equal(encrypted.plaintextSha256, sha256(plaintext))
  assert.equal(encrypted.bytes, HEADER_BYTES + plaintext.length)
  assert.equal((await readFile(encryptedPath)).subarray(0, 8).toString('ascii'), 'BLBKUP01')

  const decrypted = await decryptFile({
    encryptedPath,
    outputPath: decryptedPath,
    key,
    expectedSha256: encrypted.sha256,
    expectedPlaintextSha256: encrypted.plaintextSha256
  })
  assert.equal(decrypted.plaintextBytes, plaintext.length)
  assert.deepEqual(await readFile(decryptedPath), plaintext)

  const tamperedPath = path.join(directory, 'tampered.blb')
  const tampered = Buffer.from(await readFile(encryptedPath))
  tampered[HEADER_BYTES + 1] ^= 0xff
  await writeFile(tamperedPath, tampered)
  await assert.rejects(
    decryptFile({
      encryptedPath: tamperedPath,
      outputPath: path.join(directory, 'should-not-exist'),
      key,
      expectedSha256: encrypted.sha256
    }),
    (error) => error.code === 'BACKUP_TAMPERED'
  )

  await assert.rejects(
    decryptFile({
      encryptedPath: tamperedPath,
      outputPath: path.join(directory, 'still-not-there'),
      key
    }),
    (error) => error.code === 'BACKUP_DECRYPT_FAILED'
  )

  await assert.rejects(
    decryptFile({
      encryptedPath,
      outputPath: path.join(directory, 'wrong-key'),
      key: rawKey('22')
    }),
    (error) => error.code === 'BACKUP_DECRYPT_FAILED'
  )

  const passphrase = loadEncryptionKey({ env: { BAR_LOCAL_BACKUP_KEY: 'another sufficiently long local passphrase' } })
  const scryptEncryptedPath = path.join(directory, 'scrypt.blb')
  const scryptDecryptedPath = path.join(directory, 'scrypt.pgcustom')
  const scryptProof = await encryptFile({ inputPath, outputPath: scryptEncryptedPath, key: passphrase })
  const scryptPlain = await decryptFile({
    encryptedPath: scryptEncryptedPath,
    outputPath: scryptDecryptedPath,
    key: passphrase,
    expectedSha256: scryptProof.sha256,
    expectedPlaintextSha256: scryptProof.plaintextSha256
  })
  assert.equal(scryptPlain.plaintextBytes, plaintext.length)
  assert.deepEqual(await readFile(scryptDecryptedPath), plaintext)
  await assert.rejects(
    decryptFile({ encryptedPath: scryptEncryptedPath, outputPath: path.join(directory, 'wrong-type'), key }),
    (error) => error.code === 'BACKUP_KEY_MISMATCH'
  )
})

test('key loading accepts raw hex, raw base64 and passphrases without exposing material', async (t) => {
  const directory = await temporaryDirectory(t)
  const hex = rawKey('ab')
  assert.equal(hex.kdf, 'raw')
  assert.equal(hex.material.length, 32)
  assert.equal(hex.fingerprint.length, 32)

  const base64Value = Buffer.alloc(32, 7).toString('base64')
  const base64Key = loadEncryptionKey({ env: { BAR_LOCAL_BACKUP_KEY: base64Value } })
  assert.equal(base64Key.kdf, 'raw')
  assert.deepEqual(base64Key.material, Buffer.alloc(32, 7))

  const passphraseKey = loadEncryptionKey({ env: { BAR_LOCAL_BACKUP_KEY: 'a sufficiently long local bar passphrase' } })
  assert.equal(passphraseKey.kdf, 'scrypt')

  const keyFile = path.join(directory, 'backup.key')
  await writeFile(keyFile, `${'cd'.repeat(32)}\n`)
  const fileKey = loadEncryptionKey({ keyFile, env: {} })
  assert.equal(fileKey.kdf, 'raw')
  assert.equal(JSON.stringify({ fingerprint: fileKey.fingerprint }).includes('cd'.repeat(32)), false)

  assert.throws(
    () => loadEncryptionKey({ env: {} }),
    (error) => error.code === 'ENCRYPTION_KEY_MISSING'
  )
})

test('backup command produces a manifest and copy without leaking the password or key', async (t) => {
  const directory = await temporaryDirectory(t)
  const copyDirectory = path.join(directory, 'secondary')
  const destination = path.join(directory, 'primary')
  const password = 'super-secret-password-value'
  const key = rawKey('a1')
  const target = {
    host: '127.0.0.1',
    port: 55432,
    database: 'bar_local_main',
    user: 'bar_local_service',
    password
  }
  const report = await createEncryptedBackup({
    target,
    destinationDir: destination,
    encryptionKey: key,
    label: 'unit test',
    command: {
      command: process.execPath,
      args: ['-e', "process.stdout.write('PGDMP-unit-test-payload')"]
    }
  })

  assert.equal(report.ok, true)
  assert.equal(report.tool.exit_code, 0)
  assert.equal(report.encryption.kdf, 'raw')
  assert.equal(report.backup.bytes, HEADER_BYTES + Buffer.byteLength('PGDMP-unit-test-payload'))
  const manifest = await readBackupManifest(report.backup.manifest_path)
  assert.equal(manifest.source.database, 'bar_local_main')
  assert.equal(manifest.kind, 'postgres_custom_dump')
  assert.match(manifest.verification.message, /does not include a WAL\/PITR archive chain/)
  assert.equal(manifest.verification.restore_verified, false)
  const verified = await verifyBackupPackage(report.backup.manifest_path)
  assert.equal(verified.sha256, report.backup.sha256)

  const serializedReport = JSON.stringify(report)
  const serializedManifest = JSON.stringify(manifest)
  assert.equal(serializedReport.includes(key.material.toString('hex')), false)
  assert.equal(serializedReport.includes(password), false)
  assert.equal(serializedManifest.includes(password), false)
  assert.equal(serializedReport.includes('a1'.repeat(32)), false)

  const copied = await copyBackupPackage({
    manifestPath: report.backup.manifest_path,
    destinationDir: copyDirectory
  })
  assert.equal(copied.already_present, false)
  assert.equal(await stat(copied.file_path).then((value) => value.isFile()), true)
  const copiedAgain = await copyBackupPackage({
    manifestPath: report.backup.manifest_path,
    destinationDir: copyDirectory
  })
  assert.equal(copiedAgain.already_present, true)
})

test('backup command failure and timeout propagate without printing secrets', async () => {
  const failed = spawnCommand({
    command: process.execPath,
    args: ['-e', "process.stderr.write('token=abc123'); process.exit(3)"]
  })
  failed.stdout.resume()
  await assert.rejects(
    failed.completion,
    (error) => error.code === 'BACKUP_COMMAND_FAILED'
      && error.message.includes('token=[redacted]')
      && !error.message.includes('abc123')
  )

  const missing = spawnCommand({ command: 'bar-local-command-that-does-not-exist', args: [] })
  missing.stdout.resume()
  await assert.rejects(missing.completion, (error) => error.code === 'BACKUP_COMMAND_FAILED')

  const timedOut = spawnCommand({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 30000)'],
    timeoutMs: 100
  })
  timedOut.stdout.resume()
  await assert.rejects(timedOut.completion, (error) => error.code === 'BACKUP_COMMAND_TIMEOUT')
})

test('restore targets reject live, non-loopback, default-port and source databases', () => {
  const valid = {
    host: '127.0.0.1',
    port: 55432,
    database: 'bar_local_test_restore',
    user: 'bar_local_migrator',
    testOptIn: true,
    sourceDatabase: 'bar_local_main'
  }
  assert.doesNotThrow(() => assertVerificationTarget(valid))
  assert.throws(
    () => assertVerificationTarget({ ...valid, testOptIn: false }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, host: 'db.example.com' }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, port: 5432 }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, database: 'bar_local_main' }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, sourceDatabase: 'bar_local_test_restore' }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, liveDatabases: ['bar_local_test_restore'] }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
  assert.throws(
    () => assertVerificationTarget({ ...valid, user: 'service_role' }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
})

test('restore refuses a mismatched connection target before reading the manifest', async () => {
  const key = rawKey()
  await assert.rejects(
    restoreBackupPackageToDatabase({
      manifestPath: path.join(os.tmpdir(), 'definitely-missing-manifest.json'),
      encryptionKey: key,
      target: { host: '127.0.0.1', port: 55432, database: 'bar_local_live', user: 'bar_local_migrator' },
      verification: {
        host: '127.0.0.1',
        port: 55432,
        database: 'bar_local_test_restore',
        user: 'bar_local_migrator',
        testOptIn: true
      }
    }),
    (error) => error.code === 'RESTORE_TARGET_REJECTED'
  )
})

test('restore verification assertion fails closed', () => {
  assert.throws(
    () => assertRestoreVerification({
      ok: false,
      status: 'failed',
      failures: ['journal_entries_balanced']
    }),
    (error) => error.code === 'RESTORE_VERIFICATION_FAILED'
  )
})

function fakeVerificationClient({ violations = {}, hasSchema = false } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('check:restore_target_empty')) {
        return { rows: [{ has_schema: hasSchema, has_migrations: false, has_authority: false, has_sales: false }] }
      }
      const match = /\/\* check:([a-z_]+) \*\//.exec(sql)
      if (match) {
        return { rows: [{ violations: violations[match[1]] ?? 0 }] }
      }
      return { rows: [] }
    }
  }
}

function fakeRuntimeProbeClient() {
  return {
    query: async (sql) => {
      if (sql.includes('current_user') && sql.includes('service_authority')) {
        return {
          rows: [{
            current_user: 'bar_local_runtime',
            authority: {
              authority_id: '00000000-0000-0000-0000-000000000001',
              business_id: '00000000-0000-0000-0000-000000000002',
              authority_epoch: '1'
            }
          }]
        }
      }
      if (sql.includes('cmd_sale_commit')) {
        const error = new Error('invalid session')
        error.code = 'BL001'
        error.detail = 'AUTH_INVALID'
        throw error
      }
      if (sql.includes('sha256_hex') || sql.includes('CREATE TABLE') || sql.includes('INSERT INTO') || sql.includes('FROM bar_local.sales')) {
        const error = new Error('permission denied for this operation')
        error.code = '42501'
        throw error
      }
      return { rows: [] }
    },
    end: async () => {}
  }
}

function fakeRuntimeProbe() {
  return { connect: async () => fakeRuntimeProbeClient() }
}

test('restore requires explicit owner intent bound to the target database', () => {
  const valid = {
    authorized_by: 'owner',
    reason: 'Disaster recovery rehearsal',
    target_database: 'bar_local_test_restore',
    confirmed: true
  }
  assert.deepEqual(assertRestoreAuthorization(valid, 'bar_local_test_restore'), valid)
  assert.throws(
    () => assertRestoreAuthorization(null, 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_AUTHORIZATION_REQUIRED'
  )
  assert.throws(
    () => assertRestoreAuthorization({ ...valid, authorized_by: ' ' }, 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_AUTHORIZATION_REQUIRED'
  )
  assert.throws(
    () => assertRestoreAuthorization({ ...valid, confirmed: false }, 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_AUTHORIZATION_REQUIRED'
  )
  assert.throws(
    () => assertRestoreAuthorization({ ...valid, target_database: 'bar_local_main' }, 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_AUTHORIZATION_MISMATCH'
  )
})

test('restore refuses an occupied target and fails closed when preflight cannot inspect it', async () => {
  await assert.doesNotReject(() => assertRestoreTargetEmpty(fakeVerificationClient(), 'bar_local_test_restore'))
  await assert.rejects(
    () => assertRestoreTargetEmpty(fakeVerificationClient({ hasSchema: true }), 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_TARGET_NOT_EMPTY'
  )
  await assert.rejects(
    () => assertRestoreTargetEmpty({ query: async () => { throw new Error('connection lost') } }, 'bar_local_test_restore'),
    (error) => error.code === 'RESTORE_TARGET_PREFLIGHT_FAILED'
  )
})

test('restore requires a preflight and security client before reading the manifest', async () => {
  const key = rawKey()
  const target = { host: '127.0.0.1', port: 55432, database: 'bar_local_test_restore', user: 'bar_local_migrator' }
  const verification = {
    host: '127.0.0.1',
    port: 55432,
    database: 'bar_local_test_restore',
    user: 'bar_local_migrator',
    testOptIn: true,
    sourceDatabase: 'bar_local_main'
  }
  const authorization = {
    authorized_by: 'owner',
    reason: 'Disaster recovery rehearsal',
    target_database: 'bar_local_test_restore',
    confirmed: true
  }
  await assert.rejects(
    restoreBackupPackageToDatabase({
      manifestPath: path.join(os.tmpdir(), 'definitely-missing-manifest.json'),
      encryptionKey: key,
      target,
      verification
    }),
    (error) => error.code === 'RESTORE_AUTHORIZATION_REQUIRED'
  )
  await assert.rejects(
    restoreBackupPackageToDatabase({
      manifestPath: path.join(os.tmpdir(), 'definitely-missing-manifest.json'),
      encryptionKey: key,
      target,
      verification,
      authorization
    }),
    (error) => error.code === 'RESTORE_PREFLIGHT_REQUIRED'
  )
  await assert.rejects(
    restoreBackupPackageToDatabase({
      manifestPath: path.join(os.tmpdir(), 'definitely-missing-manifest.json'),
      encryptionKey: key,
      target,
      verification,
      authorization,
      preflightClient: fakeVerificationClient()
    }),
    (error) => error.code === 'RESTORE_SECURITY_REQUIRED'
  )
})

test('runtime security SQL revokes broad access and grants only allowlisted functions', () => {
  const statements = buildRuntimeSecurityStatements({
    migrationOwner: 'bar_local_migrator',
    runtimeRole: 'bar_local_runtime'
  }).join('\n')
  assert.match(statements, /REVOKE ALL ON SCHEMA "bar_local" FROM PUBLIC/)
  assert.match(statements, /REVOKE ALL ON ALL TABLES IN SCHEMA "bar_local" FROM "bar_local_runtime"/)
  assert.match(statements, /REVOKE CREATE ON SCHEMA "bar_local" FROM "bar_local_runtime"/)
  assert.match(statements, /GRANT USAGE ON SCHEMA "bar_local" TO "bar_local_runtime"/)
  assert.match(statements, /runtime_function_allowlist/)
  assert.match(statements, /GRANT CONNECT ON DATABASE %I TO %I/)
  assert.doesNotMatch(statements, /'reverse_sale'/)
  assert.throws(
    () => buildRuntimeSecurityStatements({ runtimeRole: 'bar_local_runtime; DROP SCHEMA bar_local' }),
    (error) => error.code === 'RESTORE_SECURITY_INVALID'
  )
  assert.throws(
    () => buildRuntimeSecurityStatements({ migrationOwner: 'bar_local_runtime' }),
    (error) => error.code === 'RESTORE_SECURITY_INVALID'
  )
})

test('runtime security verification reports privilege regressions', async () => {
  const healthy = await verifyRuntimeSecurity(fakeVerificationClient(), { runtimeProbe: fakeRuntimeProbe() })
  assert.equal(healthy.every((check) => check.status === 'pass'), true)
  const probeOnly = await verifyRuntimeSecurity(fakeVerificationClient())
  const unproven = probeOnly.filter((check) => check.name === 'runtime_authenticated_connectivity')
  assert.equal(unproven.length, 1)
  assert.equal(unproven[0].status, 'fail')
  const regressed = await verifyRuntimeSecurity(fakeVerificationClient({
    violations: { runtime_helper_function_denied: 2 }
  }), { runtimeProbe: fakeRuntimeProbe() })
  const failed = regressed.filter((check) => check.status === 'fail')
  assert.deepEqual(failed.map((check) => check.name), ['runtime_helper_function_denied'])
  assert.equal(failed[0].violations, 2)
})

test('runtime probe fails closed when the runtime role keeps elevated attributes or direct access', async () => {
  const connect = async () => ({
    query: async (sql) => {
      if (sql.includes('current_user') && sql.includes('service_authority')) {
        return {
          rows: [{
            current_user: 'bar_local_runtime',
            authority: {
              authority_id: '00000000-0000-0000-0000-000000000001',
              business_id: '00000000-0000-0000-0000-000000000002',
              authority_epoch: '1'
            }
          }]
        }
      }
      if (sql.includes('cmd_sale_commit')) {
        const error = new Error('permission denied for function cmd_sale_commit')
        error.code = '42501'
        throw error
      }
      if (sql.includes('FROM bar_local.sales') || sql.includes('sha256_hex') || sql.includes('CREATE TABLE')) {
        return { rows: [] }
      }
      return { rows: [] }
    },
    end: async () => {}
  })
  const checks = await probeRuntimeSecurity(connect)
  const failed = checks.filter((check) => check.status === 'fail').map((check) => check.name).sort()
  assert.deepEqual(failed, [
    'runtime_allowlisted_command_access',
    'runtime_ddl_denied',
    'runtime_helper_function_denied_live',
    'runtime_table_read_denied',
    'runtime_table_write_denied_live'
  ])
})

test('runtime probe reports authentication failure without leaking credentials', async () => {
  const checks = await probeRuntimeSecurity(async () => { throw new Error('password authentication failed for user "bar_local_runtime"') })
  assert.equal(checks.length, 1)
  assert.equal(checks[0].name, 'runtime_authenticated_connectivity')
  assert.equal(checks[0].status, 'fail')
})

function retentionEntry(name, createdAt) {
  return {
    manifestPath: `/backups/${name}.manifest.json`,
    backupPath: `/backups/${name}.blb`,
    fileName: `${name}.blb`,
    createdAt: new Date(createdAt)
  }
}

test('retention always keeps the newest package and respects hourly, daily and weekly buckets', () => {
  const now = new Date('2026-01-08T12:00:00.000Z')
  const entries = [
    retentionEntry('newest', '2026-01-08T11:59:00.000Z'),
    retentionEntry('older-hour', '2026-01-08T10:30:00.000Z'),
    retentionEntry('older-day', '2026-01-07T11:00:00.000Z'),
    retentionEntry('older-week', '2025-12-29T11:00:00.000Z'),
    retentionEntry('too-old', '2025-10-01T11:00:00.000Z')
  ]
  const kept = selectRetentionEntries(entries, { hourly: 2, daily: 2, weekly: 2 }, now)
  assert.equal(kept.has('/backups/newest.manifest.json'), true)
  assert.equal(kept.has('/backups/older-hour.manifest.json'), true)
  assert.equal(kept.has('/backups/older-day.manifest.json'), true)
  assert.equal(kept.has('/backups/older-week.manifest.json'), true)
  assert.equal(kept.has('/backups/too-old.manifest.json'), false)
})

test('retention preserves all recovery points when a package is corrupt or ambiguous', async (t) => {
  const directory = await temporaryDirectory(t, 'bar-retention-')
  const target = { host: '127.0.0.1', port: 55432, database: 'bar_local_main', user: 'bar_local_service' }
  const create = (date) => createEncryptedBackup({
    target, destinationDir: directory, encryptionKey: rawKey(), now: new Date(date),
    command: { command: process.execPath, args: ['-e', "process.stdout.write('PGDMP-payload')"] }
  })
  const old = await create('2026-01-01T00:00:00Z')
  const recent = await create('2026-01-02T00:00:00Z')
  const original = await readFile(recent.backup.file_path)
  const damaged = Buffer.from(original)
  damaged[damaged.length - 1] ^= 1
  await writeFile(recent.backup.file_path, damaged)
  const options = { directory, policy: { hourly: 0, daily: 0, weekly: 0 }, now: new Date('2026-01-03T00:00:00Z') }
  const corrupt = await applyRetention(options)
  assert.equal(corrupt.ok, false)
  assert.deepEqual(corrupt.deleted, [])
  assert.match(corrupt.errors.join(' '), /Cannot verify/)
  assert.equal((await stat(old.backup.file_path)).isFile(), true)
  await writeFile(recent.backup.file_path, original)
  const duplicate = path.join(directory, 'duplicate.manifest.json')
  await writeFile(duplicate, await readFile(recent.backup.manifest_path))
  const ambiguous = await applyRetention(options)
  assert.equal(ambiguous.ok, false)
  assert.deepEqual(ambiguous.deleted, [])
  assert.match(ambiguous.errors.join(' '), /multiple manifests/)
  await rm(duplicate)
  const other = await createEncryptedBackup({
    target: { ...target, database: 'bar_local_other' }, destinationDir: directory, encryptionKey: rawKey(),
    command: { command: process.execPath, args: ['-e', "process.stdout.write('PGDMP-payload')"] }
  })
  const mixed = await applyRetention(options)
  assert.equal(mixed.ok, false)
  assert.deepEqual(mixed.deleted, [])
  assert.match(mixed.errors.join(' '), /multiple source databases/)
  await rm(other.backup.file_path)
  await rm(other.backup.manifest_path)
  const healthy = await applyRetention(options)
  assert.equal(healthy.ok, true)
  assert.deepEqual(healthy.deleted, [path.basename(old.backup.manifest_path)])
  assert.equal((await stat(recent.backup.file_path)).isFile(), true)
  assert.equal((await applyRetention({ ...options, directory: path.join(directory, 'missing') })).ok, false)
})

test('update manifest validation rejects downgrade, traversal, duplicate and remote artifacts', () => {
  const parsed = parseUpdateManifest(updateManifest())
  assert.equal(parsed.package.version, '1.1.0')
  assert.equal(parsed.requires.min_free_bytes, 0)

  assert.throws(
    () => parseUpdateManifest(updateManifest({ package: { name: 'bar-local-service', version: '1.1' } })),
    (error) => error.code === 'UPDATE_VERSION_INVALID'
  )
  assert.throws(
    () => parseUpdateManifest(updateManifest({ files: [{ source: 'payload/app', target: '../app', sha256: 'a'.repeat(64), bytes: 1 }] })),
    (error) => error.code === 'UPDATE_MANIFEST_INVALID'
  )
  assert.throws(
    () => parseUpdateManifest(updateManifest({ files: [{ source: 'https://example.com/app', target: 'app', sha256: 'a'.repeat(64), bytes: 1 }] })),
    (error) => error.code === 'UPDATE_DOWNLOAD_BLOCKED'
  )
  assert.throws(
    () => parseUpdateManifest(updateManifest({
      files: [
        { source: 'one', target: 'app', sha256: 'a'.repeat(64), bytes: 1 },
        { source: 'two', target: 'app', sha256: 'b'.repeat(64), bytes: 1 }
      ]
    })),
    (error) => error.code === 'UPDATE_MANIFEST_INVALID'
  )
  assert.throws(
    () => parseUpdateManifest(updateManifest({ unexpected: true })),
    (error) => error.code === 'UPDATE_MANIFEST_INVALID'
  )
  assert.throws(
    () => assertUpgradeVersion('1.1.0', '1.1.0'),
    (error) => error.code === 'UPDATE_VERSION_NOT_NEWER'
  )
  assert.throws(
    () => assertUpgradeVersion('1.0.9', '1.1.0'),
    (error) => error.code === 'UPDATE_DOWNGRADE_BLOCKED'
  )
})

test('update validation enforces compatibility, artifact hashes and disk space', async (t) => {
  const payload = Buffer.from('new service artifact', 'utf8')
  const packageRoot = await temporaryDirectory(t, 'bar-update-package-')
  await mkdir(path.join(packageRoot, 'payload'), { recursive: true })
  await writeFile(path.join(packageRoot, 'payload', 'app.txt'), payload)
  const manifest = updateManifest({
    files: [{
      source: 'payload/app.txt',
      target: 'app.txt',
      sha256: sha256(payload),
      bytes: payload.length
    }]
  })
  const manifestPath = path.join(packageRoot, 'update-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const diskDir = await temporaryDirectory(t, 'bar-update-disk-')

  const report = await validateUpdatePackage({
    manifestPath,
    packageRoot,
    installedVersion: '1.0.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    currentServiceVersion: '1.4.0',
    diskDir,
    trust: testTrust(),
    statfsFn: async () => 1024n * 1024n * 1024n
  })
  assert.equal(report.ok, true)
  assert.equal(report.files[0].target, 'app.txt')

  await assert.rejects(
    validateUpdatePackage({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 2,
      currentServiceVersion: '1.4.0',
      diskDir,
      trust: testTrust(),
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    (error) => error.code === 'UPDATE_INCOMPATIBLE_SCHEMA'
  )

  await assert.rejects(
    validateUpdatePackage({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '3.0.0',
      diskDir,
      trust: testTrust(),
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    (error) => error.code === 'UPDATE_INCOMPATIBLE_SERVICE'
  )

  await assert.rejects(
    validateUpdatePackage({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '1.4.0',
      diskDir,
      trust: testTrust(),
      statfsFn: async () => 1n
    }),
    (error) => error.code === 'UPDATE_DISK_SPACE_INSUFFICIENT'
  )

  await writeFile(path.join(packageRoot, 'payload', 'app.txt'), Buffer.alloc(payload.length, 0x78))
  await assert.rejects(
    validateUpdatePackage({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '1.4.0',
      diskDir,
      trust: testTrust(),
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    (error) => error.code === 'UPDATE_ARTIFACT_HASH_MISMATCH'
  )
})

test('update validation fails closed without a trusted manifest signature', async (t) => {
  const payload = Buffer.from('signed payload', 'utf8')
  const { root, manifestPath, manifest } = await writeUpdatePackage(t, [
    { source: 'payload/app.txt', target: 'app.txt', bytes: payload }
  ])
  const base = {
    manifestPath,
    packageRoot: root,
    installedVersion: '1.0.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    currentServiceVersion: '1.4.0',
    diskDir: root,
    trust: testTrust(),
    statfsFn: async () => 1024n * 1024n * 1024n
  }
  const report = await validateUpdatePackage(base)
  assert.equal(report.signature.verified, true)
  assert.equal(report.signature.key_id, TEST_TRUST_KEY_ID)

  await assert.rejects(
    validateUpdatePackage({ ...base, trust: null }),
    (error) => error.code === 'UPDATE_SIGNING_UNAVAILABLE'
  )
  await assert.rejects(
    validateUpdatePackage({ ...base, trust: { keyId: 'other-key', verify: async () => true } }),
    (error) => error.code === 'UPDATE_SIGNATURE_KEY_UNKNOWN'
  )
  await assert.rejects(
    validateUpdatePackage({ ...base, trust: testTrust({ verify: async () => false }) }),
    (error) => error.code === 'UPDATE_SIGNATURE_INVALID'
  )
  await writeFile(manifestPath, JSON.stringify({ ...manifest, signature: null }))
  await assert.rejects(
    validateUpdatePackage(base),
    (error) => error.code === 'UPDATE_SIGNATURE_MISSING'
  )
})

test('offline update manifests verify real Ed25519 signatures over the non-self-referential canonical payload', async (t) => {
  const payload = Buffer.from('release payload', 'utf8')
  const { root, manifestPath, manifest } = await writeUpdatePackage(t, [
    { source: 'payload/app.txt', target: 'app.txt', bytes: payload }
  ])
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const digest = updateSigningPayloadSha256(manifest)
  const signed = {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      key_id: TEST_TRUST_KEY_ID,
      value: sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64')
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(signed, null, 2)}\n`)
  const publicKeyPath = path.join(root, 'trusted-release-key.pem')
  await writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))

  const trust = createEd25519UpdateTrust(TEST_TRUST_KEY_ID, publicKey.export({ type: 'spki', format: 'pem' }).toString())
  const report = await validateUpdatePackage({
    manifestPath,
    packageRoot: root,
    installedVersion: '1.0.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    currentServiceVersion: '1.4.0',
    diskDir: root,
    trust,
    statfsFn: async () => 1024n * 1024n * 1024n
  })
  assert.equal(report.signature.verified, true)
  assert.equal(report.signature.algorithm, 'ed25519')

  const serviceDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const cliPath = path.join(serviceDirectory, 'scripts', 'bar-operations.mjs')
  const cliResult = await new Promise((resolve, reject) => {
    execFile(process.execPath, [
      cliPath,
      'check-update',
      '--manifest', manifestPath,
      '--package-root', root,
      '--installed-version', '1.0.0',
      '--schema-version', '19',
      '--contract-version', '1',
      '--service-version', '1.4.0',
      '--disk-dir', root
    ], {
      cwd: serviceDirectory,
      env: {
        ...process.env,
        BAR_LOCAL_UPDATE_TRUST_KEY_ID: TEST_TRUST_KEY_ID,
        BAR_LOCAL_UPDATE_TRUST_PUBLIC_KEY_FILE: publicKeyPath
      },
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
  const cliReport = JSON.parse(cliResult.stdout)
  assert.equal(cliReport.signature.verified, true)
  assert.equal(cliReport.signature.key_id, TEST_TRUST_KEY_ID)

  await writeFile(manifestPath, `${JSON.stringify({ ...signed, notes: 'tampered after signing' }, null, 2)}\n`)
  await assert.rejects(
    validateUpdatePackage({
      manifestPath,
      packageRoot: root,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '1.4.0',
      diskDir: root,
      trust,
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    (error) => error.code === 'UPDATE_SIGNATURE_INVALID'
  )
})

test('staged update refuses missing, mismatched or transient checkpoint evidence', async (t) => {
  const installDir = await temporaryDirectory(t, 'bar-install-')
  const stagingDir = await temporaryDirectory(t, 'bar-staging-')
  await writeFile(path.join(installDir, 'app.txt'), 'old')
  const payload = Buffer.from('new', 'utf8')
  const { root, manifestPath } = await writeUpdatePackage(t, [
    { source: 'payload/app.txt', target: 'app.txt', bytes: payload }
  ])
  const base = {
    manifestPath,
    packageRoot: root,
    installedVersion: '1.0.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    currentServiceVersion: '1.4.0',
    diskDir: stagingDir,
    installDir,
    stagingDir,
    trust: testTrust(),
    statfsFn: async () => 1024n * 1024n * 1024n
  }

  await assert.rejects(
    applyStagedUpdate({
      ...base,
      checkpoint: async () => ({ path: path.join(stagingDir, 'missing-checkpoint.json') })
    }),
    (error) => error.code === 'UPDATE_CHECKPOINT_MISSING'
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'old')

  const checkpointPath = path.join(stagingDir, 'checkpoint.json')
  await writeFile(checkpointPath, '{"checkpoint":true}\n')
  await assert.rejects(
    applyStagedUpdate({
      ...base,
      checkpoint: async () => ({ path: checkpointPath, sha256: 'b'.repeat(64) })
    }),
    (error) => error.code === 'UPDATE_CHECKPOINT_MISMATCH'
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'old')

  await assert.rejects(
    applyStagedUpdate({
      ...base,
      checkpoint: async () => {
        const entries = await readdir(stagingDir)
        const stage = entries.find((entry) => entry.startsWith('update-'))
        const transient = path.join(stagingDir, stage, 'checkpoint.json')
        await writeFile(transient, '{"checkpoint":"transient"}\n')
        return { path: transient }
      }
    }),
    (error) => error.code === 'UPDATE_CHECKPOINT_LOCATION_INVALID'
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'old')
})

test('network write authority ignores internet state and blocks non-authority roles', () => {
  const authority = {
    authority_id: '11111111-1111-4111-8111-111111111111',
    authority_epoch: '3',
    business_id: '22222222-2222-4222-8222-222222222222',
    commissioned_at: '2026-01-01T00:00:00.000Z'
  }
  const service = { requested: true, reachable: true, live: true, readiness: 'ready' }
  const available = resolveWriteAuthority({
    role: 'single_host',
    authority,
    databaseReachable: true,
    service,
    internetState: 'available'
  })
  const offline = resolveWriteAuthority({
    role: 'single_host',
    authority,
    databaseReachable: true,
    service,
    internetState: 'unavailable'
  })
  assert.equal(available.granted, true)
  assert.deepEqual(offline, { ...available, internet_state: 'unavailable' })
  assert.equal(available.internet_influences_authority, false)
  assert.equal(available.basis, 'single_host_commissioned_authority')

  for (const role of ['client', 'replica', 'voter']) {
    const report = resolveWriteAuthority({
      role,
      authority,
      databaseReachable: true,
      service,
      internetState: 'available'
    })
    assert.equal(report.granted, false)
    assert.equal(report.internet_influences_authority, false)
  }
  const noDatabase = resolveWriteAuthority({
    role: 'single_host',
    authority,
    databaseReachable: false,
    service,
    internetState: 'available'
  })
  assert.equal(noDatabase.granted, false)
  assert.match(noDatabase.blockers[0], /AUTHORITY_DATABASE_UNREACHABLE/)
  const noService = resolveWriteAuthority({
    role: 'single_host',
    authority,
    databaseReachable: true,
    service: null,
    internetState: 'available'
  })
  assert.equal(noService.granted, false)
  assert.match(noService.blockers[0], /AUTHORITY_SERVICE_UNVERIFIED/)
  const uncommissioned = resolveWriteAuthority({
    role: 'single_host',
    authority: { ...authority, commissioned_at: null },
    databaseReachable: true,
    service,
    internetState: 'available'
  })
  assert.equal(uncommissioned.granted, false)
  assert.equal(uncommissioned.basis, 'single_host_with_uncommissioned_authority')
  assert.match(uncommissioned.blockers[0], /AUTHORITY_NOT_COMMISSIONED/)
})

test('network CLI exits nonzero when write authority is required but not proven', async () => {
  const result = await runCli([
    'network-status',
    '--role', 'client',
    '--host', '127.0.0.1',
    '--port', '8787',
    '--internet-state', 'available',
    '--require-write-authority'
  ])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /NETWORK_WRITE_AUTHORITY_NOT_GRANTED/)
})

test('disk-space precondition fails before staging', async () => {
  await assert.rejects(
    assertDiskSpace(10n, os.tmpdir(), async () => 9n),
    (error) => error.code === 'UPDATE_DISK_SPACE_INSUFFICIENT'
  )
})

test('staged update applies atomically and preserves protected data directories', async (t) => {
  const installDir = await temporaryDirectory(t, 'bar-install-')
  const stagingDir = await temporaryDirectory(t, 'bar-staging-')
  const dataDir = path.join(installDir, 'data')
  await mkdir(dataDir, { recursive: true })
  await writeFile(path.join(installDir, 'app.txt'), 'old')
  await writeFile(path.join(dataDir, 'trading.db'), 'preserve-me')
  const newPayload = Buffer.from('new', 'utf8')
  const packageRoot = await temporaryDirectory(t, 'bar-update-package-')
  await mkdir(path.join(packageRoot, 'payload'), { recursive: true })
  await writeFile(path.join(packageRoot, 'payload', 'app.txt'), newPayload)
  const manifest = updateManifest({
    files: [{
      source: 'payload/app.txt',
      target: 'app.txt',
      sha256: sha256(newPayload),
      bytes: newPayload.length
    }]
  })
  const manifestPath = path.join(packageRoot, 'update-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  let checkpointCalled = false
  const checkpointPath = path.join(stagingDir, 'checkpoint.manifest.json')
  await writeFile(checkpointPath, '{"format":"bar-local-backup-checkpoint"}\n')
  const checkpointSha256 = sha256(await readFile(checkpointPath))
  const report = await applyStagedUpdate({
    manifestPath,
    packageRoot,
    installedVersion: '1.0.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    currentServiceVersion: '1.4.0',
    diskDir: stagingDir,
    trust: testTrust(),
    installDir,
    stagingDir,
    dataDirs: [dataDir],
    checkpoint: async () => {
      checkpointCalled = true
      return { path: checkpointPath, sha256: checkpointSha256 }
    },
    statfsFn: async () => 1024n * 1024n * 1024n
  })
  assert.equal(checkpointCalled, true)
  assert.equal(report.status, 'applied')
  assert.equal(report.checkpoint_sha256, checkpointSha256)
  assert.equal(report.signature_key_id, TEST_TRUST_KEY_ID)
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'new')
  assert.equal(await readFile(path.join(dataDir, 'trading.db'), 'utf8'), 'preserve-me')
  assert.deepEqual(report.data_dirs_preserved, [dataDir])
})

test('staged update refuses to overwrite protected data and does not call the checkpoint', async (t) => {
  const installDir = await temporaryDirectory(t, 'bar-install-')
  const stagingDir = await temporaryDirectory(t, 'bar-staging-')
  const dataDir = path.join(installDir, 'data')
  await mkdir(dataDir, { recursive: true })
  await writeFile(path.join(dataDir, 'trading.db'), 'preserve-me')
  const payload = Buffer.from('bad', 'utf8')
  const packageRoot = await temporaryDirectory(t, 'bar-update-package-')
  await mkdir(path.join(packageRoot, 'payload'), { recursive: true })
  await writeFile(path.join(packageRoot, 'payload', 'trading.db'), payload)
  const manifest = updateManifest({
    files: [{
      source: 'payload/trading.db',
      target: 'data/trading.db',
      sha256: sha256(payload),
      bytes: payload.length
    }]
  })
  const manifestPath = path.join(packageRoot, 'update-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  let checkpointCalled = false
  await assert.rejects(
    applyStagedUpdate({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '1.4.0',
      diskDir: stagingDir,
      trust: testTrust(),
      installDir,
      stagingDir,
      dataDirs: [dataDir],
      checkpoint: async () => {
        checkpointCalled = true
        return { path: path.join(stagingDir, 'checkpoint.manifest.json') }
      },
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    (error) => error.code === 'UPDATE_DATA_DIR_CONFLICT'
  )
  assert.equal(checkpointCalled, false)
  assert.equal(await readFile(path.join(dataDir, 'trading.db'), 'utf8'), 'preserve-me')
})

test('staged update rolls back when a checkpoint fails before promotion', async (t) => {
  const installDir = await temporaryDirectory(t, 'bar-install-')
  const stagingDir = await temporaryDirectory(t, 'bar-staging-')
  await writeFile(path.join(installDir, 'app.txt'), 'old')
  const payload = Buffer.from('new', 'utf8')
  const packageRoot = await temporaryDirectory(t, 'bar-update-package-')
  await mkdir(path.join(packageRoot, 'payload'), { recursive: true })
  await writeFile(path.join(packageRoot, 'payload', 'app.txt'), payload)
  const manifest = updateManifest({
    files: [{
      source: 'payload/app.txt',
      target: 'app.txt',
      sha256: sha256(payload),
      bytes: payload.length
    }]
  })
  const manifestPath = path.join(packageRoot, 'update-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(
    applyStagedUpdate({
      manifestPath,
      packageRoot,
      installedVersion: '1.0.0',
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      currentServiceVersion: '1.4.0',
      diskDir: stagingDir,
      trust: testTrust(),
      installDir,
      stagingDir,
      checkpoint: async () => {
        throw new Error('backup checkpoint unavailable')
      },
      statfsFn: async () => 1024n * 1024n * 1024n
    }),
    /backup checkpoint unavailable/
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'old')
})

test('uninstall removes managed files but preserves trading data', async (t) => {
  const installDir = await temporaryDirectory(t, 'bar-install-')
  const dataDir = path.join(installDir, 'data')
  await mkdir(dataDir, { recursive: true })
  await writeFile(path.join(installDir, 'app.txt'), 'app')
  await writeFile(path.join(installDir, 'unused.txt'), 'unused')
  await writeFile(path.join(dataDir, 'trading.db'), 'preserve-me')

  const plan = await planUninstall({
    installDir,
    managedFiles: ['app.txt', 'missing.txt'],
    dataDirs: [dataDir]
  })
  assert.deepEqual(plan.files, ['app.txt'])
  assert.deepEqual(plan.missing, ['missing.txt'])
  assert.deepEqual(plan.data_dirs_preserved, [dataDir])

  const report = await executeUninstall({
    installDir,
    managedFiles: ['app.txt', 'missing.txt'],
    dataDirs: [dataDir]
  })
  assert.deepEqual(report.removed, ['app.txt'])
  assert.equal(await stat(path.join(installDir, 'app.txt')).then(() => true, () => false), false)
  assert.equal(await readFile(path.join(dataDir, 'trading.db'), 'utf8'), 'preserve-me')

  await assert.rejects(
    planUninstall({ installDir, managedFiles: ['app.txt'], dataDirs: [dataDir], purgeData: true }),
    (error) => error.code === 'UNINSTALL_DATA_PURGE_REFUSED'
  )
})

test('network status reports loopback honestly and refuses unencrypted LAN binds', async () => {
  assert.equal(classifyBindHost('127.0.0.1'), 'loopback')
  assert.equal(classifyBindHost('192.168.1.20'), 'private')
  assert.equal(classifyBindHost('0.0.0.0'), 'wildcard')
  assert.equal(classifyBindHost('8.8.8.8'), 'public')
  assert.equal(parseNetworkRole('single_host'), 'single_host')
  assert.throws(() => parseNetworkRole('coordinator'), (error) => error.code === 'NETWORK_ROLE_INVALID')

  const loopback = await buildNetworkStatus({
    role: 'single_host',
    bindHost: '127.0.0.1',
    port: 8787
  })
  assert.equal(loopback.status, 'unverified')
  assert.equal(loopback.tls.enabled, false)
  assert.equal(loopback.capabilities.automatic_failover.status, 'unavailable')
  assert.equal(loopback.limitations.some((line) => line.includes('No home-grown consensus')), true)

  await assert.rejects(
    buildNetworkStatus({
      role: 'client',
      bindHost: '192.168.1.20',
      port: 8787
    }),
    (error) => error.code === 'NETWORK_TLS_REQUIRED'
  )
})

test('service readiness is probed and auth-required is not reported as ready', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/health/live') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'live', version: '0.1.0' }))
      return
    }
    if (request.url === '/v1/health/ready') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}`
  const probe = await probeService({ serviceUrl: url, timeoutMs: 2000 })
  assert.equal(probe.reachable, true)
  assert.equal(probe.live, true)
  assert.equal(probe.service_version, '0.1.0')
  assert.equal(probe.readiness, 'auth_required')

  const report = await buildNetworkStatus({
    role: 'single_host',
    bindHost: '127.0.0.1',
    port: 8787,
    serviceUrl: url,
    authority: {
      authority_id: '11111111-1111-4111-8111-111111111111',
      authority_epoch: '1',
      business_id: '22222222-2222-4222-8222-222222222222'
    },
    database: { reachable: true }
  })
  assert.equal(report.service.live, true)
  assert.equal(report.database.status, 'reachable')
  assert.equal(report.authority.authority_epoch, '1')
})
