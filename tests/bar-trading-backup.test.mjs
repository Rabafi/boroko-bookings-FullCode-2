import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { importDomain, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const {
  buildBarTradingSnapshot,
  createBarTradingPackage,
  validateBarTradingPackage,
  writeBarTradingPackageToPath,
  verifyBarTradingPackageAtPath,
  planBarTradingRetention,
  applyBarTradingRetention,
  getBarTradingBackupHealth,
  configureBarTradingBackupTarget,
  readBarTradingBackupTarget,
  stageBarTradingRestore,
  activateStagedBarTradingRestore,
  BAR_TRADING_STORE_SPECS,
  PACKAGE_SCHEMA,
  PACKAGE_EXTENSION
} = await importDomain('barTradingBackup.js')

const PASS = 'correct horse battery staple'
const LODGE = 'lodge-recovery-a'

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2))
}

function seedSourceCache() {
  const dir = makeTempCacheDir('bar-trading-source')
  writeJson(dir, 'sync-queue.json', [
    { _queue_id: 'q1', table: 'pos_orders', data: { id: 'order-1' } },
    { _queue_id: 'q2', table: 'pos_orders', data: { id: 'order-2' } }
  ])
  writeJson(dir, 'sync-queue.json.tmp', [
    { _queue_id: 'q-tmp', table: 'pos_orders', data: { id: 'order-tmp' } }
  ])
  writeJson(dir, 'sync-failed.json', [
    { _queue_id: 'f1', table: 'pos_orders', data: { id: 'order-failed' }, manualRetryOnly: false }
  ])
  fs.writeFileSync(path.join(dir, 'offline-operation-log.jsonl'), [
    JSON.stringify({ event: 'queued', id: 'op-1' }),
    JSON.stringify({ event: 'queued', id: 'op-2' })
  ].join('\n') + '\n')
  writeJson(dir, 'pos-submit-attempts.json', {
    'attempt-1': { status: 'committed', payloadHash: 'a'.repeat(64) },
    'attempt-2': { status: 'pending', payloadHash: 'b'.repeat(64) }
  })
  writeJson(dir, 'pos-submit-attempts.blocked.json', { reason: 'corrupt journal', detectedAt: '2026-10-18T00:00:00.000Z' })
  writeJson(dir, 'pos-orders.json', [{ id: 'order-1', total: 100 }])
  writeJson(dir, 'settings.json', [{ id: 'settings-1', lodge_id: LODGE, lodge_name: 'Recovery Lodge', lodge_mesh_secret: 'super-secret-value', slug: 'recovery-lodge' }])
  writeJson(dir, 'users.json', [{ id: 'user-1', email: 'staff@example.com', password_hash: 'pbkdf2-hash' }])
  writeJson(dir, 'trial_status.json', { status: 'licensed', offline_valid_until: '2035-01-01T00:00:00.000Z' })
  return dir
}

function buildCompleteSnapshot(cacheDir, options = {}) {
  return buildBarTradingSnapshot({
    cacheDir,
    lodgeId: LODGE,
    appVersion: 'test',
    expectRendererState: true,
    rendererState: { drafts: [{ key: 'draft-1', lines: [] }], holdIntents: [] },
    ...options
  })
}

function testEncryptInner(inner) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(PASS, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(inner), 'utf8'))
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const envelope = {
    format: PACKAGE_SCHEMA,
    encrypted: true,
    created_at: inner.manifest.generated_at,
    lodge_id: inner.manifest.lodge_id,
    app_version: inner.manifest.app_version,
    encryption: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      kdf_params: { N: 32768, r: 8, p: 1 },
      compression: 'gzip',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
      ciphertext_sha256: crypto.createHash('sha256').update(ciphertext).digest('hex')
    },
    ciphertext: ciphertext.toString('base64')
  }
  return Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
}

function decryptInner(bytes) {
  const envelope = JSON.parse(bytes.toString('utf8'))
  const key = crypto.scryptSync(PASS, Buffer.from(envelope.encryption.salt, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.encryption.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.encryption.auth_tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
  return JSON.parse(zlib.gunzipSync(plaintext).toString('utf8'))
}

test('snapshot captures trading stores, scrubs secrets, withholds credentials and reports unresolved operations', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.stores['sync-queue'].sha256.length, 64)
  assert.ok(snapshot.stores['sync-queue-generation'], 'interrupted generation is captured')
  assert.equal(snapshot.stores.settings.scrubbed_fields, 1)
  assert.ok(!snapshot.stores.settings.content.includes('super-secret-value'), 'mesh secret is scrubbed')
  assert.equal(snapshot.withheld.users.present, true)
  assert.equal(snapshot.withheld.users.classification, 'secret-bearing')
  assert.ok(!JSON.stringify(snapshot.stores).includes('password_hash'), 'credential store is never packaged')
  assert.equal(snapshot.withheld['trial-status'].classification, 'authorization-lease')
  assert.equal(snapshot.renderer_state.captured, true)
  // q1,q2,q-tmp,f1,journal-events:2,attempt-2,blocked-marker
  assert.equal(snapshot.unresolved.count, 7)
  assert.equal(snapshot.unresolved.by_store['sync-queue'].count, 2)
  assert.equal(snapshot.unresolved.by_store['pos-submit-attempts'].count, 1)
})

test('package round-trips, verifies before usable, and rejects the wrong key, wrong lodge, corruption and old formats', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const packaged = createBarTradingPackage(snapshot, { passphrase: PASS })
  const verified = validateBarTradingPackage(packaged.bytes, { passphrase: PASS, expectedLodgeId: LODGE })
  assert.equal(verified.success, true)
  assert.equal(verified.complete, true)
  assert.equal(verified.unresolved.count, 7)
  assert.equal(verified.manifest.store_hashes['sync-queue'], snapshot.stores['sync-queue'].sha256)
  assert.ok(!packaged.bytes.toString('utf8').includes(LODGE + 'super-secret'), 'secrets are not present in the envelope')

  assert.throws(() => validateBarTradingPackage(packaged.bytes, { passphrase: 'wrong-passphrase-123' }), /could not be decrypted/i)
  assert.throws(() => validateBarTradingPackage(packaged.bytes, { passphrase: PASS, expectedLodgeId: 'other-lodge' }), /different lodge/i)

  const tampered = JSON.parse(packaged.bytes.toString('utf8'))
  const ciphertext = Buffer.from(tampered.ciphertext, 'base64')
  ciphertext[10] = ciphertext[10] ^ 0xff
  tampered.ciphertext = ciphertext.toString('base64')
  assert.throws(() => validateBarTradingPackage(Buffer.from(JSON.stringify(tampered)), { passphrase: PASS }), /changed or is incomplete/i)

  const reauthored = JSON.parse(packaged.bytes.toString('utf8'))
  const flip = Buffer.from(reauthored.ciphertext, 'base64')
  flip[11] = flip[11] ^ 0xff
  reauthored.ciphertext = flip.toString('base64')
  reauthored.encryption.ciphertext_sha256 = crypto.createHash('sha256').update(flip).digest('hex')
  assert.throws(() => validateBarTradingPackage(Buffer.from(JSON.stringify(reauthored)), { passphrase: PASS }), /could not be decrypted/i)

  assert.throws(() => validateBarTradingPackage(Buffer.from(JSON.stringify({ format: 'tsa-bonno-bar-trading-package/v0', encrypted: true })), { passphrase: PASS }), /Unsupported or outdated/i)
  assert.throws(() => validateBarTradingPackage(Buffer.from(JSON.stringify({ format: PACKAGE_SCHEMA, encrypted: false })), { passphrase: PASS }), /must be encrypted/i)

  const dir = makeTempCacheDir('bar-trading-verify')
  const target = path.join(dir, `snap${PACKAGE_EXTENSION}`)
  const bytes = packaged.bytes
  fs.writeFileSync(target, bytes.subarray(0, Math.floor(bytes.length / 2)))
  const partial = verifyBarTradingPackageAtPath(target, { passphrase: PASS })
  assert.equal(partial.success, false)
  fs.writeFileSync(target, bytes)
  assert.equal(verifyBarTradingPackageAtPath(target, { passphrase: PASS }).success, true)
})

test('tampered snapshot checksums, store hashes, traversal file names and unresolved disclosure are rejected', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const packaged = createBarTradingPackage(snapshot, { passphrase: PASS })
  const inner = decryptInner(packaged.bytes)

  const brokenChecksum = structuredClone(inner)
  brokenChecksum.files['snapshot.json'] = `${brokenChecksum.files['snapshot.json']} `
  assert.throws(() => validateBarTradingPackage(testEncryptInner(brokenChecksum), { passphrase: PASS }), /snapshot checksum does not match/i)

  const traversal = structuredClone(inner)
  const traversalSnapshot = JSON.parse(traversal.files['snapshot.json'])
  traversalSnapshot.stores['sync-queue'].file = '..\\..\\evil.json'
  traversal.files['snapshot.json'] = `${JSON.stringify(traversalSnapshot, null, 2)}\n`
  traversal.checksums['snapshot.json'] = crypto.createHash('sha256').update(traversal.files['snapshot.json']).digest('hex')
  assert.throws(() => validateBarTradingPackage(testEncryptInner(traversal), { passphrase: PASS }), /invalid file name/i)

  const disclosure = structuredClone(inner)
  const disclosureSnapshot = JSON.parse(disclosure.files['snapshot.json'])
  disclosureSnapshot.stores['pos-submit-attempts'].content = JSON.stringify(
    JSON.parse(disclosureSnapshot.stores['pos-submit-attempts'].content)['attempt-2']
      ? { 'attempt-1': { status: 'committed', payloadHash: 'a'.repeat(64) }, 'attempt-2': { status: 'committed', payloadHash: 'b'.repeat(64) } }
      : {}
  )
  const newHash = crypto.createHash('sha256').update(Buffer.from(disclosureSnapshot.stores['pos-submit-attempts'].content, 'utf8')).digest('hex')
  disclosureSnapshot.stores['pos-submit-attempts'].sha256 = newHash
  disclosure.files['snapshot.json'] = `${JSON.stringify(disclosureSnapshot, null, 2)}\n`
  disclosure.checksums['snapshot.json'] = crypto.createHash('sha256').update(disclosure.files['snapshot.json']).digest('hex')
  disclosure.manifest.store_hashes['pos-submit-attempts'] = newHash
  disclosure.files['manifest.json'] = `${JSON.stringify(disclosure.manifest, null, 2)}\n`
  disclosure.checksums['manifest.json'] = crypto.createHash('sha256').update(disclosure.files['manifest.json']).digest('hex')
  assert.throws(() => validateBarTradingPackage(testEncryptInner(disclosure), { passphrase: PASS }), /unresolved-operation disclosure does not match/i)
})

test('concurrent writes (drift) fail the snapshot closed and block a normal export', () => {
  const cacheDir = seedSourceCache()
  const originalRead = fs.readFileSync
  let flip = false
  fs.readFileSync = function patchedRead(filePath, ...rest) {
    if (String(filePath).endsWith('sync-queue.json')) {
      flip = !flip
      return Buffer.from(JSON.stringify({ _queue_id: flip ? 'q1' : 'q2' }))
    }
    return originalRead.call(this, filePath, ...rest)
  }
  try {
    const snapshot = buildCompleteSnapshot(cacheDir)
    assert.equal(snapshot.complete, false)
    assert.ok(snapshot.drift.includes('sync-queue'))
    assert.equal(snapshot.stores['sync-queue'], undefined)
    const dir = makeTempCacheDir('bar-trading-drift')
    assert.throws(
      () => writeBarTradingPackageToPath(path.join(dir, `snap${PACKAGE_EXTENSION}`), snapshot, { passphrase: PASS }),
      /not coherent/i
    )
    const diagnosticFile = path.join(dir, `diagnostic${PACKAGE_EXTENSION}`)
    const written = writeBarTradingPackageToPath(diagnosticFile, snapshot, { passphrase: PASS, allowIncomplete: true })
    assert.equal(written.success, true)
    assert.equal(written.complete, false)
  } finally {
    fs.readFileSync = originalRead
  }
})

test('missing destination folders fail closed and write failures leave no partial package', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const dir = makeTempCacheDir('bar-trading-target')
  const missingDir = path.join(dir, 'unplugged-drive')
  assert.throws(
    () => writeBarTradingPackageToPath(path.join(missingDir, `snap${PACKAGE_EXTENSION}`), snapshot, { passphrase: PASS }),
    /destination is missing/i
  )
  assert.equal(fs.existsSync(missingDir), false, 'missing destination is never silently created')

  const originalWrite = fs.writeFileSync
  fs.writeFileSync = function patchedWrite(filePath, ...rest) {
    if (String(filePath).endsWith('.tmp')) {
      const error = new Error('ENOSPC: no space left on device')
      error.code = 'ENOSPC'
      throw error
    }
    return originalWrite.call(this, filePath, ...rest)
  }
  try {
    const target = path.join(dir, `snap${PACKAGE_EXTENSION}`)
    assert.throws(() => writeBarTradingPackageToPath(target, snapshot, { passphrase: PASS }), /could not be written/i)
    assert.equal(fs.existsSync(target), false)
  } finally {
    fs.writeFileSync = originalWrite
  }
})

test('retention keeps hourly/daily/weekly tiers, always protects the last copy of unresolved work, and only deletes owned files', () => {
  const dir = makeTempCacheDir('bar-trading-retention')
  const names = {
    superseded: `tsa-bonno-bar-trading-lodge_a-2026-10-01-00-00-00-aaaa${PACKAGE_EXTENSION}`,
    protectedCopy: `tsa-bonno-bar-trading-lodge_a-2026-10-02-00-00-00-bbbb${PACKAGE_EXTENSION}`,
    newest: `tsa-bonno-bar-trading-lodge_a-2026-10-18-10-00-00-cccc${PACKAGE_EXTENSION}`,
    foreign: `customer-manual-export${PACKAGE_EXTENSION}`
  }
  for (const name of Object.values(names)) fs.writeFileSync(path.join(dir, name), 'archive-bytes')
  const entries = [
    { fileName: names.superseded, path: path.join(dir, names.superseded), createdAt: '2026-10-01T00:00:00.000Z', bytes: 10, verified: true, unresolvedIds: ['sync-queue:q1'] },
    { fileName: names.protectedCopy, path: path.join(dir, names.protectedCopy), createdAt: '2026-10-02T00:00:00.000Z', bytes: 10, verified: true, unresolvedIds: ['sync-queue:q7'] },
    { fileName: names.newest, path: path.join(dir, names.newest), createdAt: '2026-10-18T10:00:00.000Z', bytes: 10, verified: true, unresolvedIds: ['sync-queue:q1', 'sync-queue:q2'] },
    { fileName: names.foreign, path: path.join(dir, names.foreign), createdAt: '2026-10-01T00:00:00.000Z', bytes: 10, verified: true, unresolvedIds: [] }
  ]
  const plan = planBarTradingRetention(entries, { now: '2026-10-18T12:00:00.000Z', hourly: 1, daily: 1, weekly: 1 })
  assert.ok(plan.protected.includes(names.protectedCopy), 'an unresolved identity with no newer superset copy is protected')
  assert.ok(plan.keep.includes(names.newest))
  assert.ok(!plan.keep.includes(names.superseded), 'superseded unresolved generation may be removed once a newer verified copy contains it')
  const applied = applyBarTradingRetention(dir, entries, { now: '2026-10-18T12:00:00.000Z', hourly: 1, daily: 1, weekly: 1, diskBudgetBytes: 10 })
  assert.ok(applied.deleted.includes(names.superseded))
  assert.ok(!applied.deleted.includes(names.protectedCopy), 'protected unresolved copy survives a tiny disk budget')
  assert.ok(!applied.deleted.includes(names.foreign), 'foreign files are never deleted')
  assert.equal(applied.over_budget.length, 1, 'over-budget is disclosed rather than deleting protected archives')
  assert.ok(fs.existsSync(path.join(dir, names.foreign)))
  assert.ok(fs.existsSync(path.join(dir, names.protectedCopy)))
})

test('staged restore resumes after interruption, replaces only on request, and reports reconciliation and limits', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const packageDir = makeTempCacheDir('bar-trading-package')
  const packagePath = path.join(packageDir, `snap${PACKAGE_EXTENSION}`)
  writeBarTradingPackageToPath(packagePath, snapshot, { passphrase: PASS })

  const targetRoot = makeTempCacheDir('bar-trading-staging')
  const liveCacheDir = makeTempCacheDir('bar-trading-live')
  writeJson(liveCacheDir, 'sync-queue.json', [{ _queue_id: 'q1', table: 'pos_orders', data: { id: 'order-1' } }])
  writeJson(liveCacheDir, 'pos-submit-attempts.json', { 'attempt-1': { status: 'committed', payloadHash: 'a'.repeat(64) } })
  writeJson(liveCacheDir, 'users.json', [{ id: 'user-live', password_hash: 'keep-me' }])

  const operationId = '11111111-1111-4111-8111-111111111111'
  const staged = stageBarTradingRestore(packagePath, { passphrase: PASS, operationId, targetRoot, liveCacheDir, expectedLodgeId: LODGE })
  assert.equal(staged.success, true)
  assert.equal(staged.newerUnresolvedLocalWork, false)
  assert.equal(staged.report.device_identity.cloned, false)
  assert.equal(staged.report.reconciliation['sync-queue'].only_in_live_count, 0)
  assert.equal(staged.report.reconciliation['sync-queue'].only_in_archive, 1)
  assert.ok(staged.report.recovery_limits.some((limit) => /Device identity is never archived/.test(limit)))

  // Interruption: a staged store disappears before the progress file caught up.
  const stagedFile = path.join(staged.stagingDirectory, 'stores', 'pos-orders.json')
  fs.unlinkSync(stagedFile)
  const progressPath = path.join(staged.stagingDirectory, 'stage-progress.json')
  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'))
  delete progress.stores['pos-orders']
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
  const resumed = stageBarTradingRestore(packagePath, { passphrase: PASS, operationId, targetRoot, liveCacheDir, expectedLodgeId: LODGE })
  assert.equal(resumed.success, true)
  assert.equal(fs.existsSync(stagedFile), true, 'resumed staging completes missing stores')

  // A same-package re-run resumes; a different package for the same operation
  // id is refused until an operator explicitly replaces the staged restore.
  const secondSnapshot = buildCompleteSnapshot(cacheDir, { now: '2026-10-18T12:00:00.000Z' })
  const secondPackagePath = path.join(packageDir, `snap2${PACKAGE_EXTENSION}`)
  writeBarTradingPackageToPath(secondPackagePath, secondSnapshot, { passphrase: PASS })
  assert.throws(
    () => stageBarTradingRestore(secondPackagePath, { passphrase: PASS, operationId, targetRoot, liveCacheDir, expectedLodgeId: LODGE }),
    /already exists/i
  )
  const replaced = stageBarTradingRestore(secondPackagePath, { passphrase: PASS, operationId, targetRoot, liveCacheDir, expectedLodgeId: LODGE, replaceExisting: true })
  assert.equal(replaced.success, true)
  const previousDirs = fs.readdirSync(targetRoot).filter((name) => name.includes('.previous-'))
  assert.equal(previousDirs.length >= 1, true, 'prior staging generation is preserved on replace')
})

test('activation refuses newer unresolved local work and unauthorized calls, and preserves prior state on success', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const packageDir = makeTempCacheDir('bar-trading-package')
  const packagePath = path.join(packageDir, `snap${PACKAGE_EXTENSION}`)
  writeBarTradingPackageToPath(packagePath, snapshot, { passphrase: PASS })

  const targetRoot = makeTempCacheDir('bar-trading-staging')
  const liveCacheDir = makeTempCacheDir('bar-trading-live')
  writeJson(liveCacheDir, 'sync-queue.json', [
    { _queue_id: 'q1', table: 'pos_orders', data: { id: 'order-1' } },
    { _queue_id: 'live-new', table: 'pos_orders', data: { id: 'order-new' } }
  ])
  const operationId = '22222222-2222-4222-8222-222222222222'
  const staged = stageBarTradingRestore(packagePath, { passphrase: PASS, operationId, targetRoot, liveCacheDir, expectedLodgeId: LODGE })
  assert.equal(staged.newerUnresolvedLocalWork, true)
  assert.equal(staged.canActivate, false)
  assert.throws(
    () => activateStagedBarTradingRestore(operationId, { targetRoot, liveCacheDir, authorized: true, lodgeId: LODGE, confirmLodgeId: LODGE }),
    /newer unresolved work/i
  )

  // Happy path on a live profile that is a strict subset of the archive.
  const liveCacheDir2 = makeTempCacheDir('bar-trading-live-ok')
  writeJson(liveCacheDir2, 'sync-queue.json', [{ _queue_id: 'q1', table: 'pos_orders', data: { id: 'order-1' } }])
  writeJson(liveCacheDir2, 'pos-submit-attempts.json', { 'attempt-1': { status: 'committed', payloadHash: 'a'.repeat(64) } })
  writeJson(liveCacheDir2, 'users.json', [{ id: 'user-live', password_hash: 'keep-me' }])
  const op2 = '33333333-3333-4333-8333-333333333333'
  const staged2 = stageBarTradingRestore(packagePath, { passphrase: PASS, operationId: op2, targetRoot, liveCacheDir: liveCacheDir2, expectedLodgeId: LODGE })
  assert.equal(staged2.canActivate, true)
  assert.throws(() => activateStagedBarTradingRestore(op2, { targetRoot, liveCacheDir: liveCacheDir2, lodgeId: LODGE }), /authorization is required/i)
  assert.throws(() => activateStagedBarTradingRestore(op2, { targetRoot, liveCacheDir: liveCacheDir2, authorized: true, lodgeId: LODGE, confirmLodgeId: 'other-lodge' }), /does not match/i)

  const activation = activateStagedBarTradingRestore(op2, { targetRoot, liveCacheDir: liveCacheDir2, authorized: true, lodgeId: LODGE, confirmLodgeId: LODGE })
  assert.equal(activation.success, true)
  assert.ok(activation.activation.activated_stores.includes('sync-queue.json'))
  assert.ok(activation.activation.prior_state_files.includes('sync-queue.json'))
  const priorDir = activation.activation.prior_state_directory
  assert.ok(fs.existsSync(path.join(priorDir, 'sync-queue.json')), 'prior state is preserved before activation')
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(liveCacheDir2, 'sync-queue.json'), 'utf8')).map((row) => row._queue_id).sort(),
    ['q1', 'q2'],
    'archive queue replaces the subset live queue only after authorization'
  )
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(liveCacheDir2, 'users.json'), 'utf8')), [{ id: 'user-live', password_hash: 'keep-me' }], 'withheld credential store is untouched')
  assert.equal(fs.existsSync(path.join(liveCacheDir2, 'sync-queue.json.tmp')), false, 'interrupted generation is never auto-promoted')
  const recoveryFiles = fs.readdirSync(liveCacheDir2).filter((name) => name.includes('.recovery'))
  assert.equal(recoveryFiles.length, 1, 'interrupted generation is preserved for review under a non-promotable name')
})

test('health summary reports last verified archive, age, target state, same-volume risk and limitations', () => {
  const cacheDir = seedSourceCache()
  const snapshot = buildCompleteSnapshot(cacheDir)
  const targetDir = makeTempCacheDir('bar-trading-health')
  const packagePath = path.join(targetDir, `snap${PACKAGE_EXTENSION}`)
  const written = writeBarTradingPackageToPath(packagePath, snapshot, { passphrase: PASS })
  assert.equal(written.success, true)

  const current = getBarTradingBackupHealth({ targetDir, lodgeId: LODGE, cacheDir })
  assert.equal(current.state, 'current')
  assert.equal(current.last_archive.fileName, written.fileName)
  assert.equal(current.target_state, 'ok')
  assert.equal(current.same_volume_as_profile, true)
  assert.ok(current.warnings.some((warning) => /same volume/i.test(warning)))
  assert.ok(current.limitations.some((limit) => /Device identity is never archived/.test(limit)))

  const stale = getBarTradingBackupHealth({ targetDir, lodgeId: LODGE, cacheDir, now: new Date(Date.now() + 8 * 86400000).toISOString() })
  assert.equal(stale.state, 'stale')
  assert.ok(stale.warnings.some((warning) => /day\(s\) old/.test(warning)))

  const missing = getBarTradingBackupHealth({ targetDir: path.join(targetDir, 'gone'), lodgeId: LODGE, cacheDir })
  assert.equal(missing.ok, false)
  assert.ok(missing.warnings.some((warning) => /missing/i.test(warning)))

  const unconfigured = getBarTradingBackupHealth({ targetDir: '', lodgeId: LODGE, cacheDir })
  assert.equal(unconfigured.state, 'not_configured')
})

test('target configuration fails closed for missing and same-volume targets, then persists an approved target', () => {
  const cacheDir = makeTempCacheDir('bar-trading-config-cache')
  const configDir = makeTempCacheDir('bar-trading-config')
  assert.throws(
    () => configureBarTradingBackupTarget({ configDir, cacheDir, targetDir: path.join(configDir, 'missing-drive') }),
    /does not exist/i
  )
  const targetDir = makeTempCacheDir('bar-trading-config-target')
  assert.throws(
    () => configureBarTradingBackupTarget({ configDir, cacheDir, targetDir }),
    /same volume/i
  )
  const configured = configureBarTradingBackupTarget({ configDir, cacheDir, targetDir, allowSameVolume: true })
  assert.equal(configured.success, true)
  assert.equal(readBarTradingBackupTarget({ configDir }), path.resolve(targetDir))
})

test('store inventory remains explicit and complete for recovery-critical keys', () => {
  const keys = new Set(BAR_TRADING_STORE_SPECS.map((spec) => spec.key))
  for (const required of ['sync-queue', 'sync-queue-generation', 'sync-failed', 'offline-operation-log', 'pos-submit-attempts', 'pos-submit-blocked', 'pos-tabs', 'pos-shifts', 'pos-cashup-submissions', 'pos-menu-items', 'inventory-items']) {
    assert.ok(keys.has(required), `inventory must include ${required}`)
  }
  const unresolved = BAR_TRADING_STORE_SPECS.filter((spec) => spec.unresolvedBearing)
  assert.equal(unresolved.length >= 6, true)
})
