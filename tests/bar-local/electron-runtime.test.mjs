import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { BarLocalElectronRuntime, registerBarLocalIpc } from '../../src/main/bar-local/electronRuntime.js'

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'), 'utf8'),
    decryptString: (value) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8').replace(/^encrypted:/, '')
  }
}

test('fresh Bar defers cloud IPC until explicit choice and a new process, while local authority wins over that choice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bar-choice-'))
  const handlers = new Map()
  try {
    let restarted = 0
    const runtime = registerBarLocalIpc({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      app: { getPath: () => dir, once() {}, relaunch() { restarted += 1 }, exit() {} },
      safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos'
    })
    assert.equal(runtime.status().workspace_choice_required, true)
    // Exercise the same handler fence used by subsequently registered cloud IPC.
    let cloudCalls = 0
    // Registration wraps the original handle function on this object.
    const ipc = { handle: (name, fn) => handlers.set(name, fn) }
    const second = registerBarLocalIpc({ ipcMain: ipc,
      app: { getPath: () => dir, once() {} }, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    ipc.handle('auth:login', () => { cloudCalls += 1 })
    await assert.rejects(handlers.get('auth:login')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' })
    second.close()
    const result = runtime.selectCloudWorkspace()
    assert.equal(result.restart_required, true)
    assert.equal(runtime.cloudStartupDeferred, true)
    const next = new BarLocalElectronRuntime({ userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.equal(next.cloudStartupDeferred, false)
    next.close()
    assert.equal(cloudCalls, 0)
    runtime.close()
    const local = writeLocalAuthority(dir)
    assert.equal(local.mode, 'bar_local')
    assert.throws(() => local.selectCloudWorkspace(), { code: 'WRONG_AUTHORITY' })
    local.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a process that already opened the cloud workspace refuses local setup or pairing', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-cloud-active-'))
  try {
    mkdirSync(join(userDataPath, 'bar-local'), { recursive: true })
    writeFileSync(join(userDataPath, 'bar-local', 'workspace-choice.json'), JSON.stringify({ version: 1, workspace: 'cloud' }))
    const runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    try {
      assert.equal(runtime.cloudStartupDeferred, false, 'the cloud workspace has started')
      const setup = { base_url: 'http://127.0.0.1:8787', setup_secret: 'a-local-setup-secret' }
      const pair = { base_url: 'http://127.0.0.1:8787', pairing_code: '123456', device_name: 'Till' }
      await assert.rejects(runtime.setupOwner(setup), { code: 'CLOUD_WORKSPACE_ACTIVE' })
      await assert.rejects(runtime.pairDevice(pair), { code: 'CLOUD_WORKSPACE_ACTIVE' })
      assert.equal(runtime.status().authority_mode, 'cloud')
    } finally { runtime.close() }
  } finally { rmSync(userDataPath, { recursive: true, force: true }) }
})

test('hotel and lodge do not require the Bar workspace choice', () => {
  for (const product of ['hotel', 'lodging']) {
    const dir = mkdtempSync(join(tmpdir(), 'bar-choice-product-'))
    try {
      const runtime = new BarLocalElectronRuntime({ userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: product })
      assert.equal(runtime.cloudStartupDeferred, false)
      runtime.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('Modern Bar runtime remains cloud-bound when no trusted authority profile exists', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  try {
    const runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.equal(runtime.mode, 'cloud')
    assert.equal(runtime.status().configured, false)
    assert.deepEqual(runtime.getOpenIntents(), [])
    await assert.rejects(runtime.query('bootstrap'), { code: 'WRONG_AUTHORITY' })
    await assert.rejects(runtime.command({ command: 'sale.commit', payload: {} }), { code: 'WRONG_AUTHORITY' })
    runtime.close()
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('saved or unreadable cloud profiles block local setup and pairing in the main process', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-cloud-fence-'))
  const runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    const setup = { base_url: 'http://127.0.0.1:8787', setup_secret: 'secret' }
    const pair = { base_url: 'http://127.0.0.1:8787', pairing_code: '123456', device_name: 'Till' }
    writeFileSync(join(userDataPath, 'profiles.json'), JSON.stringify({ profiles: [{ lodge_id: 'saved-cloud-business' }] }))
    await assert.rejects(runtime.setupOwner(setup), { code: 'CLOUD_TRANSITION_REQUIRED' })
    await assert.rejects(runtime.pairDevice(pair), { code: 'CLOUD_TRANSITION_REQUIRED' })
    writeFileSync(join(userDataPath, 'profiles.json'), '{broken')
    await assert.rejects(runtime.setupOwner(setup), { code: 'CLOUD_PROFILE_UNVERIFIED' })
    writeFileSync(join(userDataPath, 'profiles.json'), JSON.stringify({ profiles: [] }))
    writeFileSync(join(userDataPath, 'lodge-id.json'), JSON.stringify({ lodge_id: 'older-cloud-business' }))
    await assert.rejects(runtime.pairDevice(pair), { code: 'CLOUD_TRANSITION_REQUIRED' })
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('loopback owner commissioning persists a local-only profile and OS-protected device token', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const businessId = 'e513f287-3c0d-4a8a-9e30-3c498de85b99'
  const outletId = '1fa934c2-981b-4d4e-8c02-1851cd96c4ea'
  const authorityId = 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7'
  const deviceId = 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2'
  const token = 'local-device-token-value-0123456789'
  const service = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      outcome: 'commissioned', business_id: businessId, outlet_id: outletId,
      authority_id: authorityId, authority_epoch: 1, commissioning_id: 'commission-1',
      device_id: deviceId, device_token: token
    }))
  })
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  const address = service.address()
  const runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    const result = await runtime.setupOwner({
      base_url: `http://127.0.0.1:${address.port}`,
      setup_secret: 'a-local-setup-secret-that-is-long',
      business_name: 'Test Bar', outlet_name: 'Main', owner_name: 'Owner',
      owner_email: 'owner@example.test', owner_password: 'a test owner password 123',
      pin: '482915', device_name: 'Till 1', device_platform: 'modern'
    })
    assert.equal(result.authority_mode, 'bar_local')
    assert.equal(result.device_token, undefined)
    assert.equal(runtime.status().configured, true)
    const credential = readFileSync(join(userDataPath, 'bar-local', 'device-credential.bin'))
    assert.notEqual(credential.toString('utf8')[0], '{')
    assert.equal(credential.toString('utf8').includes(token), false)
  } finally {
    runtime.close()
    await new Promise((resolve) => service.close(resolve))
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern owner setup resumes the same staged identity after a lost committed reply and process restart', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-resume-owner-'))
  const businessId = 'e513f287-3c0d-4a8a-9e30-3c498de85b99'
  const outletId = '1fa934c2-981b-4d4e-8c02-1851cd96c4ea'
  const authorityId = 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7'
  const deviceId = 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2'
  const ownerStaffId = 'ba42454b-b1da-4aed-9fc1-6cda6cf07cb3'
  let firstRequest = null
  let attempts = 0
  const service = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    attempts += 1
    if (attempts === 1) {
      firstRequest = received
      // The fake authority commits its result, then the caller loses the reply.
      response.destroy()
      return
    }
    assert.deepEqual(received, firstRequest, 'resume must resend the exact saved payload and credential')
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true, outcome: 'commissioned_local', authority_id: authorityId,
      authority_epoch: 1, business_id: businessId, outlet_id: outletId,
      device_id: deviceId, owner_staff_id: ownerStaffId, device_token: 'must-not-be-returned'
    }))
  })
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  const address = service.address()
  const request = {
    base_url: `http://127.0.0.1:${address.port}`,
    setup_secret: 'a-local-setup-secret-that-is-long',
    business_name: 'Recoverable Bar', outlet_name: 'Main', owner_name: 'Owner',
    owner_email: 'owner@example.test', owner_password: 'a test owner password 123',
    pin: '482915', device_name: 'Till 1', device_platform: 'modern'
  }
  let runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    await assert.rejects(runtime.setupOwner(request))
    const pending = runtime.status().provisioning_recovery
    assert.deepEqual(pending, { pending: true, kind: 'owner', recoverable: true })
    assert.equal(JSON.stringify(runtime.status()).includes(firstRequest.device_token), false, 'status must not expose staged credentials')
    runtime.close()
    runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.deepEqual(runtime.status().provisioning_recovery, pending)
    const encryptedPending = readFileSync(join(userDataPath, 'bar-local', 'provisioning.bin')).toString('utf8')
    assert.equal(encryptedPending.includes(request.owner_password), false, 'raw owner password must not be persisted for retry')
    await assert.rejects(runtime.resumeProvisioning(), { code: 'OWNER_PASSWORD_REQUIRED' })
    const result = await runtime.resumeProvisioning({ owner_password: request.owner_password })
    assert.equal(result.authority_id, authorityId)
    assert.equal(result.device_token, undefined)
    assert.equal(attempts, 2)
    assert.equal(runtime.status().configured, true)
    assert.equal(runtime.status().provisioning_recovery, null)
  } finally {
    runtime.close()
    await new Promise((resolve) => service.close(resolve))
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern Bar runtime pairs a device and commits the authority only after scope validation', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const businessId = 'e513f287-3c0d-4a8a-9e30-3c498de85b99'
  const outletId = '1fa934c2-981b-4d4e-8c02-1851cd96c4ea'
  const authorityId = 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7'
  const deviceId = 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2'
  const token = 'paired-local-device-token-value-0123456789'
  let received = null
  const service = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true, outcome: 'device_paired', authority_id: authorityId, authority_epoch: 1,
      business_id: businessId, outlet_id: outletId, device_id: deviceId,
      server_certificate_fingerprint: null
    }))
  })
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  const address = service.address()
  let runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    const result = await runtime.pairDevice({
      base_url: `http://127.0.0.1:${address.port}`,
      pairing_code: '12345678', device_name: 'Till 2'
    })
    assert.equal(received.pairing_code, '12345678')
    assert.equal(received.name, 'Till 2')
    assert.equal(received.platform, 'modern')
    assert.equal(received.certificate_fingerprint, null)
    assert.match(received.provisioning_id, /^[0-9a-f-]{36}$/i)
    assert.match(received.device_token, /^bld_[A-Za-z0-9_-]{32,}$/)
    assert.equal(result.authority_mode, 'bar_local')
    assert.equal(result.device_token, undefined)
    assert.equal(runtime.status().configured, true)
    const encryptedProfile = readFileSync(join(userDataPath, 'bar-local', 'authority.bin'))
    const profile = JSON.parse(fakeSafeStorage().decryptString(encryptedProfile))
    assert.equal(encryptedProfile.toString('utf8').includes(authorityId), false)
    assert.equal(encryptedProfile.toString('utf8').includes('127.0.0.1'), false)
    assert.equal(profile.authority_id, authorityId)
    assert.equal(profile.local_service.base_url, `http://127.0.0.1:${address.port}`)
    const credential = readFileSync(join(userDataPath, 'bar-local', 'device-credential.bin'))
    assert.equal(credential.toString('utf8').includes(received.device_token), false)
    assert.equal(JSON.parse(fakeSafeStorage().decryptString(credential)).device_token, received.device_token)
    const recoveryPath = join(userDataPath, 'bar-local', 'provisioning.bin')
    writeFileSync(recoveryPath, fakeSafeStorage().encryptString(JSON.stringify({
      kind: 'pairing', request: { device_token: 'bld_unrelated_staged_credential_012345678901234567890123456789' }
    })))
    runtime.close()
    runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.equal(runtime.status().configured, true)
    assert.equal(existsSync(recoveryPath), true, 'a different staged credential is preserved for recovery')
    assert.equal(JSON.parse(fakeSafeStorage().decryptString(readFileSync(join(userDataPath, 'bar-local', 'device-credential.bin')))).device_token, received.device_token)
    runtime.close()
    writeFileSync(recoveryPath, fakeSafeStorage().encryptString(JSON.stringify({
      kind: 'pairing', request: { device_token: received.device_token }
    })))
    runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.equal(runtime.status().configured, true)
    assert.equal(existsSync(recoveryPath), false, 'startup clears only the completed record bound to the committed credential')
  } finally {
    runtime.close()
    await new Promise((resolve) => service.close(resolve))
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern pairing fails before consuming a code when the durable intent journal cannot be recovered', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const localDir = join(userDataPath, 'bar-local')
  mkdirSync(localDir, { recursive: true })
  let requests = 0
  const service = createServer(async (request, response) => {
    requests += 1
    for await (const _chunk of request) {}
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end('{}')
  })
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  const address = service.address()
  const runtime = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    writeFileSync(join(localDir, 'intents.jsonl'), '{broken}\n')
    await assert.rejects(runtime.pairDevice({
      base_url: `http://127.0.0.1:${address.port}`, pairing_code: '12345678', device_name: 'Till 2'
    }), { code: 'INTENT_JOURNAL_CORRUPT' })
    assert.equal(requests, 0)
    assert.equal(runtime.status().configured, false)
  } finally {
    runtime.close()
    await new Promise((resolve) => service.close(resolve))
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Bar local runtime rejects malformed persisted authority rather than falling back to cloud', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  try {
    const configDir = join(userDataPath, 'bar-local')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify({ authority_mode: 'bar_local', product: 'hotel' })))
    assert.throws(
      () => new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' }),
      { code: 'AUTHORITY_CONFIG_INVALID' }
    )
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern Bar runtime fails closed when OS secure storage cannot open a committed local profile', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  const authority = {
    authority_mode: 'bar_local', product: 'hospitality-pos',
    business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
    outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'],
    active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
    authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7', authority_epoch: 1,
    contract_version: 1, base_url: 'http://127.0.0.1:4317'
  }
  writeFileSync(join(configDir, 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify(authority)))
  const unavailableStorage = { ...fakeSafeStorage(), isEncryptionAvailable: () => false }
  try {
    assert.throws(
      () => new BarLocalElectronRuntime({ userDataPath, safeStorage: unavailableStorage, buildProductId: 'hospitality-pos' }),
      { code: 'SECURE_STORAGE_UNAVAILABLE' }
    )
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern Bar runtime never silently downgrades an older plaintext local authority profile', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'authority.json'), JSON.stringify({ authority_mode: 'bar_local', product: 'hospitality-pos' }))
  try {
    assert.throws(
      () => new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' }),
      { code: 'AUTHORITY_PROFILE_UPGRADE_REQUIRED' }
    )
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Modern Bar runtime never defaults to cloud when a protected device credential has no profile', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'device-credential.bin'), fakeSafeStorage().encryptString(JSON.stringify({
    device_id: 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2',
    device_token: 'orphaned-local-device-token-value-0123456789'
  })))
  try {
    assert.throws(
      () => new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' }),
      { code: 'AUTHORITY_PROFILE_MISSING' }
    )
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('preload IPC exposes only the fixed local adapter operations', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  try {
    const handlers = new Map()
    const once = new Map()
    const runtime = registerBarLocalIpc({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      app: { getPath: () => userDataPath, once: (name, fn) => once.set(name, fn) },
      safeStorage: fakeSafeStorage(),
      buildProductId: 'hospitality-pos'
    })
    assert.deepEqual([...handlers.keys()], [
      'barLocal:getStatus', 'barLocal:adminRecoveryStatus', 'barLocal:adminCopyRecoverySet', 'barLocal:adminChooseRecoveryDestination', 'barLocal:adminRecoveryJob', 'barLocal:adminCreateRecoveryBase', 'barLocal:adminVerifyRecoveryPoint', 'barLocal:adminExportRecoveryKeys', 'barLocal:trainingLaunch', 'barLocal:trainingBegin', 'barLocal:trainingReset',
      'barLocal:serverSetupPreflight', 'barLocal:serverSetupStatus', 'barLocal:serverSetupBegin', 'barLocal:serverSetupUpdateOwnerEmail', 'barLocal:serverSetupResume', 'barLocal:serverSetupCancel',
      'barLocal:selectCloudWorkspace', 'barLocal:openLocalBarWorkspace', 'barLocal:setupOwner', 'barLocal:pairDevice', 'barLocal:reconnectServer', 'barLocal:resumeProvisioning', 'barLocal:login', 'barLocal:recoverOwnerPassword', 'barLocal:logout',
      'barLocal:startPairing',
      'barLocal:query', 'barLocal:requestApprovalForCommand', 'barLocal:command', 'barLocal:retryOperation',
      'barLocal:getOpenIntents', 'barLocal:getOperation',
      'barLocal:adminStatus', 'barLocal:adminBackups', 'barLocal:adminRunBackup', 'barLocal:adminVerifyBackup',
      'barLocal:adminRestoreDrill',
      'barLocal:adminReplicationStatus', 'barLocal:adminSetDurability', 'barLocal:adminSwitchover', 'barLocal:adminUpdateStatus', 'barLocal:adminImportUpdatePackage', 'barLocal:adminStageUpdate', 'barLocal:adminApplyUpdate',
      'barLocal:adminCloudSyncStatus', 'barLocal:adminCloudSyncConfig', 'barLocal:adminCloudSyncRun',
      'barLocal:refreshReadiness', 'barLocal:getCatalogueSnapshot'
    ])
    assert.equal((await handlers.get('barLocal:getStatus')()).authority_mode, 'cloud')
    await assert.rejects(handlers.get('barLocal:command')({}, { command: 'sale.commit', payload: {} }), { code: 'WRONG_AUTHORITY' })
    await assert.rejects(handlers.get('barLocal:requestApprovalForCommand')({}, { command: 'sale.return', payload: {}, pin: '1234' }), { code: 'WRONG_AUTHORITY' })
    await assert.rejects(handlers.get('barLocal:startPairing')({}, {}), { code: 'WRONG_AUTHORITY' })
    await assert.rejects(handlers.get('barLocal:adminStatus')({}), { code: 'WRONG_AUTHORITY' })
    await assert.rejects(handlers.get('barLocal:adminRunBackup')({}, {}), { code: 'WRONG_AUTHORITY' })
    assert.equal(once.has('before-quit'), true)
    runtime.close()
  } finally {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

const LOCAL_AUTHORITY = {
  authority_mode: 'bar_local', product: 'hospitality-pos',
  business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
  outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'],
  active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
  authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7', authority_epoch: 1,
  contract_version: 1, base_url: 'http://127.0.0.1:4317'
}

const LOCAL_OPERATION_ID = 'fdcbf03c-3ae1-4f13-9d29-ae6fd57b4517'

function writeLocalAuthority(userDataPath, runtimeOptions = {}) {
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify(LOCAL_AUTHORITY)))
  return new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos', ...runtimeOptions })
}

function intentEnvelope(operationId = LOCAL_OPERATION_ID) {
  return {
    contract_version: 1,
    authority_id: LOCAL_AUTHORITY.authority_id,
    authority_epoch: 1,
    business_id: LOCAL_AUTHORITY.business_id,
    outlet_id: LOCAL_AUTHORITY.active_outlet_id,
    device_id: 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2',
    operation_id: operationId,
    command: 'sale.commit',
    payload_version: 1,
    payload: { total_cents: 100 },
    expected_versions: {},
    dependencies: [],
    client_occurred_at: '2026-10-20T10:00:00.000Z'
  }
}

test('getOpenIntents fails closed when the committed local journal is unavailable', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const runtime = writeLocalAuthority(userDataPath)
  try {
    assert.equal(runtime.mode, 'bar_local')
    runtime.close()
    assert.throws(
      () => runtime.getOpenIntents(),
      (error) => error.code === 'LOCAL_INTENT_RECOVERY_REQUIRED' && /journal is unavailable/i.test(error.message)
    )
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('getOpenIntents fails closed when the local journal cannot be read', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const runtime = writeLocalAuthority(userDataPath)
  try {
    const journal = runtime.adapter.journal
    runtime.adapter = {
      authority_mode: 'bar_local',
      router: runtime.adapter.router,
      journal: { list() { throw new Error('journal backend unavailable') } },
      requireClient() { throw new Error('not expected') },
      close() { journal.close() }
    }
    assert.throws(
      () => runtime.getOpenIntents(),
      (error) => error.code === 'LOCAL_INTENT_RECOVERY_REQUIRED' && /could not be read/i.test(error.message)
    )
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('logout refuses to leave an unresolved local operation', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const runtime = writeLocalAuthority(userDataPath)
  try {
    runtime.adapter.journal.createIntent(intentEnvelope())
    let clientLogoutCalls = 0
    runtime.adapter = {
      authority_mode: 'bar_local',
      router: runtime.adapter.router,
      journal: runtime.adapter.journal,
      requireClient: () => ({ logout: async () => { clientLogoutCalls += 1 } }),
      close() { runtime.adapter.journal.close() }
    }
    await assert.rejects(
      runtime.logout(),
      (error) => error.code === 'LOCAL_INTENT_RECOVERY_REQUIRED'
        && error.operationId === LOCAL_OPERATION_ID
        && error.details.open_intents.length === 1
    )
    assert.equal(clientLogoutCalls, 0)
    assert.equal(runtime.adapter.journal.get(LOCAL_OPERATION_ID).state, 'durable_intent')
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('logout succeeds when the local journal has no open operations', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const runtime = writeLocalAuthority(userDataPath)
  try {
    let clientLogoutCalls = 0
    runtime.adapter = {
      authority_mode: 'bar_local',
      router: runtime.adapter.router,
      journal: runtime.adapter.journal,
      requireClient: () => ({
        logout: async () => {
          clientLogoutCalls += 1
          return { ok: true, outcome: 'logged_out' }
        }
      }),
      close() { runtime.adapter.journal.close() }
    }
    assert.deepEqual(await runtime.logout(), { ok: true, outcome: 'logged_out' })
    assert.equal(clientLogoutCalls, 1)
    assert.equal(runtime.session, null)
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('the quit fence blocks unresolved operations but allows a deliberate retry', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const handlers = new Map()
  const once = new Map()
  const errors = []
  const warnings = []
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify(LOCAL_AUTHORITY)))
  const runtime = registerBarLocalIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    app: { getPath: () => userDataPath, once: (name, fn) => once.set(name, fn) },
    safeStorage: fakeSafeStorage(),
    buildProductId: 'hospitality-pos'
  })
  try {
    runtime.adapter.journal.createIntent(intentEnvelope())
    assert.throws(
      () => runtime.assertSafeToQuit(),
      (error) => error.code === 'LOCAL_INTENT_RECOVERY_REQUIRED'
    )
    runtime.logger = {
      info() {},
      error: (message) => errors.push(message),
      warn: (message) => warnings.push(message)
    }
    let prevented = 0
    once.get('before-quit')({ preventDefault: () => { prevented += 1 } })
    assert.equal(prevented, 1)
    assert.equal(errors.length, 1)
    once.get('before-quit')({ preventDefault: () => { prevented += 1 } })
    assert.equal(prevented, 1)
    assert.equal(warnings.length, 1)
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('committed local authority fences every cloud IPC handler registered after the router', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-runtime-'))
  const configDir = join(userDataPath, 'bar-local')
  mkdirSync(configDir, { recursive: true })
  const authority = {
    authority_mode: 'bar_local', product: 'hospitality-pos',
    business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
    outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'],
    active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
    authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7', authority_epoch: 1,
    contract_version: 1, base_url: 'http://127.0.0.1:4317'
  }
  writeFileSync(join(configDir, 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify(authority)))
  const handlers = new Map()
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) }
  const runtime = registerBarLocalIpc({
    ipcMain,
    app: { getPath: () => userDataPath, once: () => {} },
    safeStorage: fakeSafeStorage(),
    buildProductId: 'hospitality-pos'
  })
  try {
    let cloudCalls = 0
    ipcMain.handle('pos:createOrder', async () => {
      cloudCalls += 1
      return { success: true }
    })
    ipcMain.handle('barGuides:getManifest', async () => ({ success: true, documents: [] }))
    assert.equal((await handlers.get('barLocal:getStatus')()).authority_mode, 'bar_local')
    runtime.command = async () => {
      const error = Object.assign(new Error('The service response was lost.'), {
        code: 'UNKNOWN_OUTCOME', outcomeUnknown: true, operationId: 'fdcbf03c-3ae1-4f13-9d29-ae6fd57b4517'
      })
      throw error
    }
    assert.deepEqual(await handlers.get('barLocal:command')({}, { operation_id: 'fdcbf03c-3ae1-4f13-9d29-ae6fd57b4517' }), {
      ok: false,
      outcome: 'unknown',
      operation_id: 'fdcbf03c-3ae1-4f13-9d29-ae6fd57b4517',
      error: { code: 'UNKNOWN_OUTCOME', message: 'The service response was lost.', retry_same_operation: true }
    })
    await assert.rejects(handlers.get('pos:createOrder')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' })
    assert.deepEqual(await handlers.get('barGuides:getManifest')({}), { success: true, documents: [] })
    assert.equal(cloudCalls, 0)
  } finally {
    runtime.close()
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('commissioning requests a fresh process and fences local and cloud IPC if relaunch fails', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bar-local-restart-fence-'))
  const service = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ outcome: 'commissioned', business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99', outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea', authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7', authority_epoch:  1, device_id: 'a542454b-b1da-4aed-9fc1-6cda6cf07cb2', device_token: 'local-device-token-value-0123456789' }))
  })
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  const handlers = new Map()
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) }
  let relaunches = 0
  const runtime = registerBarLocalIpc({ ipcMain, app: { getPath: () => userDataPath, once: () => {}, relaunch: () => { relaunches++; throw new Error('unavailable') }, exit: () => {} }, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
  try {
    ipcMain.handle('pos:createOrder', () => { throw new Error('cloud handler reached') })
    await handlers.get('barLocal:setupOwner')({}, { base_url: `http://127.0.0.1:${service.address().port}`, setup_secret: 'a-local-setup-secret-that-is-long', business_name: 'Test Bar', outlet_name: 'Main', owner_name: 'Owner', owner_email: 'owner@example.test', owner_password: 'a test owner password 123', pin: '482915', device_name: 'Till 1', device_platform: 'modern' })
    assert.equal(relaunches, 1)
    assert.equal((await handlers.get('barLocal:getStatus')()).restart_required, true)
    await assert.rejects(handlers.get('barLocal:login')({}, {}), { code: 'LOCAL_RESTART_REQUIRED' })
    await assert.rejects(handlers.get('barLocal:command')({}, {}), { code: 'LOCAL_RESTART_REQUIRED' })
    await assert.rejects(handlers.get('pos:createOrder')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' })
    runtime.close()
    const fresh = new BarLocalElectronRuntime({ userDataPath, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos' })
    assert.equal(fresh.status().restart_required, false)
    assert.equal(fresh.mode, 'bar_local')
    fresh.close()
  } finally {
    runtime.close()
    await new Promise((resolve) => service.close(resolve))
    rmSync(userDataPath, { recursive: true, force: true })
  }
})
