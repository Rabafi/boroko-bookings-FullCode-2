import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../dist/config.js'
import { updateSigningPayloadSha256 } from '../dist/operations/updates.js'
import {
  applyUpdatePackage,
  describeUpdateTrust,
  listUpdateInbox,
  readLastUpdateFailure,
  readStagedUpdate,
  stageUpdatePackage
} from '../dist/operations/updateService.js'

const KEY_ID = 'test-release-key'

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bar-update-service-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function configFor(root, options = {}) {
  return loadConfig({
    ...process.env,
    BAR_LOCAL_UPDATE_INBOX_DIR: path.join(root, 'inbox'),
    BAR_LOCAL_UPDATE_STAGING_DIR: path.join(root, 'staging'),
    BAR_LOCAL_UPDATE_INSTALL_DIR: path.join(root, 'install'),
    BAR_LOCAL_UPDATE_PUBLIC_KEY_FILE: options.publicKeyFile ?? path.join(root, 'trusted-release-key.pem'),
    BAR_LOCAL_UPDATE_KEY_ID: KEY_ID,
    BAR_LOCAL_UPDATE_APPLY_ENABLED: options.applyEnabled === false ? '' : '1'
  })
}

async function prepareInstall(t, root) {
  const installDir = path.join(root, 'install')
  await mkdir(path.join(installDir, 'data'), { recursive: true })
  await writeFile(path.join(installDir, 'app.txt'), 'installed 0.1.0\n')
  await writeFile(path.join(installDir, 'data', 'trading.json'), '{"trades":1}\n')
  return installDir
}

async function writeSignedPackage(t, root, options = {}) {
  const packageDir = path.join(root, 'inbox', options.name ?? 'release-1.1.0')
  await mkdir(packageDir, { recursive: true })
  const files = options.files ?? [{ source: 'payload/app.txt', target: 'app.txt', bytes: 'updated by signed update\n' }]
  const manifestFiles = []
  for (const file of files) {
    const sourcePath = path.join(packageDir, ...file.source.split('/'))
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, file.bytes)
    manifestFiles.push({
      source: file.source,
      target: file.target,
      sha256: sha256(file.bytes),
      bytes: Buffer.byteLength(file.bytes)
    })
  }
  const manifest = {
    format: 'bar-local-update',
    format_version: 1,
    package: { name: 'bar-local-service', version: options.version ?? '1.1.0' },
    compatibility: {
      schema: options.schema ?? { min: 18, max: 20 },
      contract: options.contract ?? { min: 1, max: 1 },
      service: options.service ?? { min: '0.1.0', max: '0.2.0' }
    },
    files: manifestFiles,
    requires: { min_free_bytes: 0, extra_free_bytes: 0 },
    created_at: '2026-10-29T00:00:00.000Z',
    notes: 'signed offline update fixture',
    signature: options.signature === 'missing' ? null : { algorithm: 'ed25519', key_id: KEY_ID, value: 'A'.repeat(64) }
  }
  const { privateKey, publicKey } = options.keys ?? generateKeyPairSync('ed25519')
  if (options.writePublicKey !== false) {
    await writeFile(path.join(root, 'trusted-release-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }))
  }
  if (options.signature !== 'missing') {
    const digest = updateSigningPayloadSha256(manifest)
    manifest.signature = {
      algorithm: 'ed25519',
      key_id: KEY_ID,
      value: sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64')
    }
  }
  const manifestPath = path.join(packageDir, 'update-manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { packageDir, manifestPath, manifest, publicKey }
}

function stageRequest(overrides = {}) {
  return {
    packageName: 'release-1.1.0',
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    ...overrides
  }
}

function noUnresolvedWork() {
  return async () => {}
}

function checkpointIn(root) {
  return async (context) => {
    const directory = path.join(root, 'checkpoints')
    await mkdir(directory, { recursive: true })
    const filePath = path.join(directory, `pre-update-${context.version}.dump`)
    const bytes = Buffer.from(`verified checkpoint for ${context.version} ${context.manifestSha256}\n`)
    await writeFile(filePath, bytes)
    return { path: filePath, sha256: sha256(bytes) }
  }
}

test('a signed offline package is staged only after signature, compatibility, hash and disk checks', async (t) => {
  const root = await temporaryRoot(t)
  await prepareInstall(t, root)
  await writeSignedPackage(t, root)
  const config = configFor(root)

  const trust = await describeUpdateTrust(config)
  assert.equal(trust.configured, true)
  assert.equal(trust.key_id, KEY_ID)

  const inbox = await listUpdateInbox(config)
  assert.equal(inbox.packages.length, 1)
  assert.equal(inbox.packages[0].version, '1.1.0')

  const staged = await stageUpdatePackage(config, stageRequest())
  assert.equal(staged.status, 'staged')
  assert.equal(staged.staged.version, '1.1.0')
  assert.equal(staged.staged.signature_key_id, KEY_ID)
  assert.match(staged.staged.manifest_sha256, /^[0-9a-f]{64}$/)
  assert.ok(staged.validation.checks.includes('manifest_signature_trusted'))

  const state = await readStagedUpdate(config)
  assert.equal(state.state, 'staged')
  assert.equal(state.staged.version, '1.1.0')
  assert.equal(state.lock_present, false)
  assert.equal((await stat(path.join(root, 'staging', 'staged', 'payload', 'app.txt'))).isFile(), true)

  const again = await stageUpdatePackage(config, stageRequest())
  assert.equal(again.status, 'already_staged')
})

test('staging refuses unsigned, wrong-key, corrupt and incompatible packages', async (t) => {
  const root = await temporaryRoot(t)
  await prepareInstall(t, root)
  const config = configFor(root)

  await writeSignedPackage(t, root, { name: 'unsigned', signature: 'missing' })
  await assert.rejects(stageUpdatePackage(config, stageRequest({ packageName: 'unsigned' })), {
    code: 'UPDATE_SIGNATURE_MISSING'
  })

  const otherKeys = generateKeyPairSync('ed25519')
  await writeSignedPackage(t, root, { name: 'wrong-key', keys: otherKeys, writePublicKey: false })
  await assert.rejects(stageUpdatePackage(config, stageRequest({ packageName: 'wrong-key' })), {
    code: 'UPDATE_SIGNATURE_INVALID'
  })

  await writeSignedPackage(t, root, { name: 'corrupt' })
  await writeFile(path.join(root, 'inbox', 'corrupt', 'payload', 'app.txt'), 'tampered after signing\n')
  await assert.rejects(
    stageUpdatePackage(config, stageRequest({ packageName: 'corrupt' })),
    (error) => ['UPDATE_ARTIFACT_SIZE_MISMATCH', 'UPDATE_ARTIFACT_HASH_MISMATCH'].includes(error.code)
  )

  await writeSignedPackage(t, root, { name: 'future-schema', schema: { min: 50, max: 60 } })
  await assert.rejects(stageUpdatePackage(config, stageRequest({ packageName: 'future-schema' })), {
    code: 'UPDATE_INCOMPATIBLE_SCHEMA'
  })

  await writeSignedPackage(t, root, { name: 'old-version', version: '0.0.9' })
  await assert.rejects(stageUpdatePackage(config, stageRequest({ packageName: 'old-version' })), {
    code: 'UPDATE_DOWNGRADE_BLOCKED'
  })
})

test('applying a staged update requires explicit enablement, no unresolved work and a verified checkpoint', async (t) => {
  const root = await temporaryRoot(t)
  const installDir = await prepareInstall(t, root)
  await writeSignedPackage(t, root)

  const disabled = configFor(root, { applyEnabled: false })
  await assert.rejects(
    applyUpdatePackage(disabled, { currentSchemaVersion: 19, currentContractVersion: 1, authorizedBy: 'Owner', reason: 'scheduled maintenance' }, {
      assertNoUnresolvedWork: noUnresolvedWork(),
      createCheckpoint: checkpointIn(root)
    }),
    { code: 'UPDATE_APPLY_DISABLED' }
  )

  const config = configFor(root)
  await stageUpdatePackage(config, stageRequest())
  await assert.rejects(
    applyUpdatePackage(config, { currentSchemaVersion: 19, currentContractVersion: 1, authorizedBy: 'Owner', reason: 'scheduled maintenance' }, {
      assertNoUnresolvedWork: async () => {
        throw Object.assign(new Error('1 local financial operation is still executing.'), { code: 'UPDATE_UNRESOLVED_WORK' })
      },
      createCheckpoint: checkpointIn(root)
    }),
    /still executing/
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'installed 0.1.0\n')

  await assert.rejects(
    applyUpdatePackage(config, { currentSchemaVersion: 19, currentContractVersion: 1, authorizedBy: 'Owner', reason: 'scheduled maintenance' }, {
      assertNoUnresolvedWork: noUnresolvedWork()
    }),
    { code: 'UPDATE_CHECKPOINT_REQUIRED' }
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'installed 0.1.0\n')

  await assert.rejects(
    applyUpdatePackage(config, { currentSchemaVersion: 19, currentContractVersion: 1, authorizedBy: 'Owner', reason: 'scheduled maintenance' }, {
      assertNoUnresolvedWork: noUnresolvedWork(),
      createCheckpoint: async () => {
        throw new Error('checkpoint destination is full')
      }
    }),
    /checkpoint destination is full/
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'installed 0.1.0\n')
  const failed = JSON.parse(await readFile(path.join(root, 'staging', 'last-update-failure.json'), 'utf8'))
  assert.match(failed.recovery, /staged package and checkpoint were retained/i)
  assert.equal((await readLastUpdateFailure(config))?.code, failed.code)
})

test('an authorised apply promotes signed files, preserves trading data and removes the staged package', async (t) => {
  const root = await temporaryRoot(t)
  const installDir = await prepareInstall(t, root)
  await writeSignedPackage(t, root)
  const config = configFor(root)
  await stageUpdatePackage(config, stageRequest())

  const report = await applyUpdatePackage(config, {
    currentSchemaVersion: 19,
    currentContractVersion: 1,
    authorizedBy: 'Owner Ada',
    reason: 'apply signed maintenance release'
  }, {
    assertNoUnresolvedWork: noUnresolvedWork(),
    createCheckpoint: checkpointIn(root)
  })

  assert.equal(report.status, 'applied')
  assert.equal(report.version, '1.1.0')
  assert.deepEqual(report.applied_files, ['app.txt'])
  assert.equal(report.authorized_by, 'Owner Ada')
  assert.equal(report.staged_package_removed, true)
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'updated by signed update\n')
  assert.equal(await readFile(path.join(installDir, 'data', 'trading.json'), 'utf8'), '{"trades":1}\n')
  assert.ok(report.checkpoint_path.startsWith(path.join(root, 'checkpoints')))
  assert.match(report.checkpoint_sha256, /^[0-9a-f]{64}$/)

  const state = await readStagedUpdate(config)
  assert.equal(state.state, 'none')
  const evidence = JSON.parse(await readFile(path.join(root, 'staging', 'last-update.json'), 'utf8'))
  assert.equal(evidence.version, '1.1.0')
  assert.equal(evidence.authorized_by, 'Owner Ada')
})

test('a checkpoint inside the disposable staging area is refused before any file is promoted', async (t) => {
  const root = await temporaryRoot(t)
  const installDir = await prepareInstall(t, root)
  await writeSignedPackage(t, root)
  const config = configFor(root)
  await stageUpdatePackage(config, stageRequest())

  await assert.rejects(
    applyUpdatePackage(config, {
      currentSchemaVersion: 19,
      currentContractVersion: 1,
      authorizedBy: 'Owner Ada',
      reason: 'bad checkpoint location'
    }, {
      assertNoUnresolvedWork: noUnresolvedWork(),
      createCheckpoint: async () => {
        const entries = await readdir(path.join(root, 'staging'), { withFileTypes: true })
        const temporary = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('update-1.1.0-'))
        assert.ok(temporary, 'the updater must create a temporary staging directory before checkpointing')
        const filePath = path.join(root, 'staging', temporary.name, 'checkpoint.dump')
        await writeFile(filePath, 'checkpoint inside disposable staging\n')
        return { path: filePath }
      }
    }),
    { code: 'UPDATE_CHECKPOINT_LOCATION_INVALID' }
  )
  assert.equal(await readFile(path.join(installDir, 'app.txt'), 'utf8'), 'installed 0.1.0\n')
})

test('status reports no package, an invalid marker and missing trust honestly', async (t) => {
  const root = await temporaryRoot(t)
  await prepareInstall(t, root)
  await writeSignedPackage(t, root, { publicKeyFile: null })
  const config = loadConfig({
    ...process.env,
    BAR_LOCAL_UPDATE_INBOX_DIR: path.join(root, 'inbox'),
    BAR_LOCAL_UPDATE_STAGING_DIR: path.join(root, 'staging'),
    BAR_LOCAL_UPDATE_INSTALL_DIR: path.join(root, 'install'),
    BAR_LOCAL_UPDATE_PUBLIC_KEY_FILE: '',
    BAR_LOCAL_UPDATE_KEY_ID: '',
    BAR_LOCAL_UPDATE_APPLY_ENABLED: ''
  })

  const trust = await describeUpdateTrust(config)
  assert.equal(trust.configured, false)
  assert.match(trust.error, /No pinned release public key/i)

  const empty = await readStagedUpdate(config)
  assert.equal(empty.state, 'none')
  assert.equal(empty.staged, null)
  await assert.rejects(stageUpdatePackage(config, stageRequest()), { code: 'UPDATE_SIGNING_UNAVAILABLE' })

  const signed = configFor(root)
  await writeSignedPackage(t, root, { name: 'marker-test' })
  await stageUpdatePackage(signed, stageRequest({ packageName: 'marker-test' }))
  await writeFile(path.join(root, 'staging', 'staged', 'update-manifest.json'), '{"tampered":true}\n')
  const invalid = await readStagedUpdate(signed)
  assert.equal(invalid.state, 'invalid')
  assert.equal(invalid.error_code, 'UPDATE_STAGED_MANIFEST_MISMATCH')
  assert.match(invalid.message, /changed after it was verified/i)
})
