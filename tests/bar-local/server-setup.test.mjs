import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ServerSetupOrchestrator,
  buildInstallerArguments,
  buildInstallerWrapper,
  chooseFreePort,
  computeSetupStorage,
  normalizeOwnerDraft,
  parseServerPayloadManifest,
  publicSetupState,
  redactLogTail,
  verifyServerPayload
} from '../../src/main/bar-local/serverSetup.js'

const REQUIRED = [
  'server/dist/server.js',
  'server/package.json',
  'server/scripts/provision-local.mjs',
  'server/scripts/bar-operations.mjs',
  'server/scripts/write-api-certificate.mjs',
  'server/packaging/windows/create-api-certificate.ps1',
  'server/packaging/windows/install-server.ps1',
  'server/packaging/windows/configure-postgres.ps1',
  'server/packaging/windows/install-service.ps1',
  'server/packaging/windows/install-backup-task.ps1',
  'server/packaging/windows/lib/BarLocalCommon.ps1',
  'node/node.exe',
  'postgres/bin/postgres.exe',
  'postgres/bin/initdb.exe',
  'postgres/bin/pg_ctl.exe',
  'postgres/bin/psql.exe',
  'postgres/bin/pg_dump.exe',
  'postgres/bin/pg_isready.exe',
  'postgres/bin/pg_basebackup.exe',
  'postgres/bin/pg_verifybackup.exe',
  'postgres/lib/dict_snowball.dll'
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fixture(root) {
  const payload = join(root, 'payload')
  const files = {}
  for (const name of REQUIRED) {
    const file = join(payload, name)
    mkdirSync(dirname(file), { recursive: true })
    const content = `fixture:${name}`
    writeFileSync(file, content)
    files[name] = sha256(content)
  }
  const manifest = {
    schema: 1,
    service_version: '1.2.3',
    postgres_version: '17.5',
    node_version: 'v22.1.0',
    created_at: new Date().toISOString(),
    files
  }
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(manifest))
  return { payload, manifest }
}

function memorySafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => String(buffer).slice(4)
  }
}

function ownerDraft(overrides = {}) {
  return {
    business_name: 'River Bar',
    outlet_name: 'Main Bar',
    owner_name: 'Owner One',
    owner_email: 'owner@example.test',
    pin: '1234',
    currency: 'bwp',
    timezone: 'Africa/Gaborone',
    device_name: 'Bar office till',
    business_profile: { company_name: 'River Bar Limited', city: 'Gaborone' },
    ...overrides
  }
}

function runtime(overrides = {}) {
  return {
    configured: false,
    restartRequired: false,
    calls: [],
    status() { return { configured: this.configured, restart_required: this.restartRequired } },
    assertNoSavedCloudBusiness() {},
    async setupOwner(request) {
      this.calls.push(request)
      this.configured = true
      this.restartRequired = true
      return { owner_staff_id: '3c8f8f14-3ef2-4e64-9f40-8c3f9c9f4a11' }
    },
    ...overrides
  }
}

function orchestratorFor(root, options = {}) {
  const { payload } = options.payloadFixture ?? fixture(root)
  const state = {
    runner: async ({ cwd }) => {
      writeFileSync(join(cwd, 'status.json'), JSON.stringify({ phase: 'installed', certificate_fingerprint: 'a'.repeat(64), message: 'ok', updated_at: new Date().toISOString() }))
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    ...options
  }
  return new ServerSetupOrchestrator({
    runtime: state.runtime ?? runtime(),
    userDataPath: join(root, 'user-data'),
    basePath: root,
    isPackaged: false,
    buildProductId: 'hospitality-pos',
    safeStorage: memorySafeStorage(),
    installRoot: join(root, 'program-data'),
    payloadDir: payload,
    platform: 'win32',
    diskFree: () => 20n * 1024n * 1024n * 1024n,
    isPortFree: async () => true,
    serviceDetected: async () => false,
    serviceLive: async () => true,
    ...state
  })
}

test('manifest validation rejects unsafe paths and missing required files', () => {
  const base = {
    schema: 1,
    service_version: '1.0.0',
    postgres_version: '17.4',
    node_version: 'v20.11.0',
    files: Object.fromEntries(REQUIRED.map((name) => [name, 'a'.repeat(64)]))
  }
  assert.equal(Object.keys(parseServerPayloadManifest(base).files).length, REQUIRED.length)
  assert.throws(() => parseServerPayloadManifest({ ...base, schema: 2 }), /schema/)
  assert.throws(() => parseServerPayloadManifest({ ...base, postgres_version: '16.4' }), /PostgreSQL 17/)
  assert.throws(() => parseServerPayloadManifest({ ...base, node_version: 'v18.0.0' }), /Node.js 20/)
  assert.throws(() => parseServerPayloadManifest({ ...base, files: { ...base.files, [REQUIRED[0]]: 'bad' } }), /invalid hash/)
  assert.throws(() => parseServerPayloadManifest({ ...base, files: { ...base.files, '../escape': 'a'.repeat(64) } }), /unsafe path/)
  const missing = { ...base.files }
  delete missing[REQUIRED[0]]
  assert.throws(() => parseServerPayloadManifest({ ...base, files: missing }), /missing/)
})

test('payload verification hashes every file and detects corruption', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-payload-'))
  try {
    const { payload } = fixture(root)
    const result = await verifyServerPayload({ payloadDir: payload })
    assert.equal(result.checked_files, REQUIRED.length)
    assert.ok(BigInt(result.payload_bytes) > 0n)
    assert.equal(result.manifest.service_version, '1.2.3')
    writeFileSync(join(payload, REQUIRED[0]), 'tampered')
    await assert.rejects(() => verifyServerPayload({ payloadDir: payload }), (error) => error.code === 'SERVER_PAYLOAD_CORRUPT')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('owner draft validation and installer arguments never contain secrets', () => {
  const draft = normalizeOwnerDraft(ownerDraft())
  assert.equal(draft.currency, 'BWP')
  assert.equal(draft.pin, '1234')
  assert.deepEqual(draft.business_profile, { company_name: 'River Bar Limited', city: 'Gaborone' })
  assert.throws(() => normalizeOwnerDraft(ownerDraft({ pin: '12' })), /PIN/)
  assert.throws(() => normalizeOwnerDraft(ownerDraft({ business_name: '   ' })), /business_name/)
  assert.throws(() => normalizeOwnerDraft(ownerDraft({ currency: 'PULA' })), /Currency/)
  assert.throws(() => normalizeOwnerDraft(ownerDraft({ timezone: 'not a zone' })), /Timezone/)
  assert.equal(normalizeOwnerDraft(ownerDraft({ timezone: 'UTC' })).timezone, 'UTC')

  const install = {
    install_dir: 'C:\\Bar\\server',
    data_dir: 'C:\\Bar\\data',
    pg_data_dir: 'C:\\Bar\\pgdata',
    backup_dir: 'C:\\Bar\\backups',
    pg_bin: 'C:\\Bar\\postgres\\bin',
    node_path: 'C:\\Bar\\node\\node.exe',
    server_root: 'C:\\Bar\\server',
    installer_script: 'C:\\Bar\\server\\packaging\\windows\\install-server.ps1',
    http_port: 8787,
    db_port: 55432,
    base_url: 'http://127.0.0.1:8787',
    upgrade: false
  }
  const args = buildInstallerArguments(install)
  const names = args.map(([name]) => name)
  for (const name of ['InstallDir', 'DataDir', 'PgBin', 'PgDataDir', 'DbPort', 'HttpPort', 'NodePath', 'ServiceRoot', 'SetupSecretFile', 'BackupKeyFile', 'ReplicationPasswordFile', 'BackupDir', 'DbName', 'HttpHost', 'SkipFirewall', 'InitDb']) {
    assert.ok(names.includes(name), `missing installer argument ${name}`)
  }
  const state = {
    version: 1, attempt_id: 'a', phase: 'prepared', created_at: '', updated_at: '',
    owner: { business_name: 'B', outlet_name: 'O', owner_name: 'N', currency: 'BWP', timezone: 'UTC', device_name: 'D' },
    install,
    secrets: { setup_secret: 'SETUP-SECRET-VALUE', backup_key: 'BACKUP-KEY-VALUE', replication_password: 'REPLICATION-VALUE' },
    staging: { root: 'C:\\Users\\x\\bar-local\\server-setup\\a', secret_dir: 'C:\\Users\\x\\bar-local\\server-setup\\a\\secrets', wrapper_path: 'C:\\Users\\x\\bar-local\\server-setup\\a\\install.ps1', status_path: 'C:\\Users\\x\\bar-local\\server-setup\\a\\status.json', log_path: 'C:\\Users\\x\\bar-local\\server-setup\\a\\install.log' },
    payload: { dir: 'C:\\Bar\\payload', manifest_sha256: 'x', service_version: '1', postgres_version: '17.5' },
    last_error: null, installed_at: null, completed_at: null
  }
  const wrapper = buildInstallerWrapper(state)
  assert.ok(!wrapper.includes('SETUP-SECRET-VALUE'))
  assert.ok(!wrapper.includes('BACKUP-KEY-VALUE'))
  assert.ok(!wrapper.includes('REPLICATION-VALUE'))
  assert.match(wrapper, /UTF8Encoding\(\$false\)/)
  assert.match(wrapper, /Copy-IfMissing/)
  const publicState = publicSetupState(state)
  assert.equal('log_path' in publicState, false)
  assert.equal(publicState.can_cancel, true)
})

test('setup storage uses measured payload bytes and separates the install floor from backup headroom', () => {
  const payload = 220n * 1024n * 1024n
  const minimum = payload + 1024n ** 3n + 64n * 1024n ** 2n
  const blocked = computeSetupStorage(minimum - 1n, payload)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.shortfall_bytes, '1')
  assert.equal(blocked.shortfall_gib, 0.1)
  assert.equal(computeSetupStorage(minimum, payload).status, 'advisory')
  assert.equal(computeSetupStorage(minimum + 4n * 1024n ** 3n, payload).status, 'ok')
  assert.equal(computeSetupStorage(null, payload).status, 'unknown')
})

test('bundled Windows install supplies a protected loopback admin URL for backups and update checkpoints', () => {
  const installer = readFileSync(join(process.cwd(), 'services/bar-local/packaging/windows/install-server.ps1'), 'utf8')
  assert.match(installer, /BAR_LOCAL_ADMIN_DATABASE_URL\s*=\s*\('postgresql:\/\/'\s*\+\s*\[uri\]::EscapeDataString\(\$BootstrapUser\)/)
  assert.match(installer, /\+\s*'@127\.0\.0\.1:'\s*\+\s*\[string\]\$DbPort\s*\+\s*'\/'\s*\+\s*\[uri\]::EscapeDataString\(\$DbName\)\)/)
  assert.match(installer, /Set-SecretFileAcl\s+-Path\s+\$envFile\s+-ServiceAccount\s+\$ServiceAccount/)
  assert.doesNotMatch(installer, /Write-(?:Host|Note|Step).*BAR_LOCAL_ADMIN_DATABASE_URL/i)
})

test('free-port selection skips occupied ports and refuses exhaustion', async () => {
  const busy = new Set([8787, 8788])
  assert.equal(await chooseFreePort({ start: 8787, isFree: async (port) => !busy.has(port) }), 8789)
  await assert.rejects(() => chooseFreePort({ start: 65534, limit: 3, isFree: async () => false }), (error) => error.code === 'NO_FREE_PORT')
})

test('preflight reports blockers for wrong platform, product and missing payload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-preflight-'))
  try {
    const payload = join(root, 'missing')
    const orchestrator = new ServerSetupOrchestrator({
      runtime: runtime(),
      userDataPath: join(root, 'user-data'),
      basePath: root,
      isPackaged: false,
      buildProductId: 'lodge-camp',
      safeStorage: memorySafeStorage(),
      installRoot: join(root, 'program-data'),
      payloadDir: payload,
      platform: 'linux',
      diskFree: () => 1n,
      serviceDetected: async () => false
    })
    const result = await orchestrator.preflight()
    assert.equal(result.ready, false)
    const codes = result.blockers.map((blocker) => blocker.code)
    for (const code of ['UNSUPPORTED_PLATFORM', 'WRONG_PRODUCT', 'SERVER_PAYLOAD_MISSING']) {
      assert.ok(codes.includes(code), `missing blocker ${code}`)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('storage-only preflight gives an exact drive shortfall and a separate low-space advisory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-storage-preflight-'))
  try {
    let free = 20n * 1024n ** 3n
    const orchestrator = orchestratorFor(root, { diskFree: () => free })
    const enough = await orchestrator.preflight()
    const required = BigInt(enough.storage.required_free_bytes)

    free = required - 256n * 1024n ** 2n
    const blocked = await orchestrator.preflight()
    assert.equal(blocked.ready, false)
    assert.equal(blocked.storage.status, 'blocked')
    assert.equal(blocked.blockers.length, 1)
    assert.match(blocked.blockers[0].message, /Free another 0\.3 GiB on C:, then select Check again/)

    free = required + 2n * 1024n ** 3n
    const advisory = await orchestrator.preflight()
    assert.equal(advisory.ready, true)
    assert.equal(advisory.storage.status, 'advisory')
    assert.match(advisory.warnings.join(' '), /Storage space is low.*Actual backup space depends on your Bar database size/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('automatic setup installs, requires owner credentials and keeps recovery proof only in protected state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-setup-'))
  try {
    const fakeRuntime = runtime()
    const orchestrator = orchestratorFor(root, { runtime: fakeRuntime })
    const preflight = await orchestrator.preflight()
    assert.equal(preflight.ready, true, JSON.stringify(preflight.blockers))
    assert.equal(preflight.storage.status, 'ok')
    assert.ok(BigInt(preflight.storage.required_free_bytes) > BigInt(preflight.payload_bytes))
    assert.ok(preflight.suggested_http_port)

    const started = await orchestrator.begin(ownerDraft())
    assert.equal(started.available, true)
    assert.equal(started.phase, 'installing')
    assert.ok(orchestrator.installPromise)
    await orchestrator.installPromise
    const installed = await orchestrator.status()
    assert.equal(installed.phase, 'installed')
    assert.equal(installed.pin_required, true)

    await assert.rejects(() => orchestrator.resume({ pin: '12' }), /PIN/)
    const done = await orchestrator.resume({ pin: '9876', owner_password: 'a test owner password 123' })
    assert.equal(done.phase, 'complete')
    assert.equal(fakeRuntime.calls.length, 1)
    assert.equal(fakeRuntime.calls[0].pin, '9876')
    assert.equal(fakeRuntime.calls[0].setup_secret.length, 64)
    assert.equal(fakeRuntime.calls[0].business_name, 'River Bar')
    const state = orchestrator.readState()
    assert.equal(state.secrets.setup_secret.length, 64, 'the setup recovery secret remains protected in OS-encrypted state')
    assert.equal(state.secrets.replication_password, '')
    assert.ok(state.secrets.backup_key.length > 0)
    assert.equal(existsSync(state.staging.secret_dir), false)
    let recoveryRequest
    fakeRuntime.recoverOwnerPassword = async (request) => { recoveryRequest = request; return { ok: true } }
    const recovered = await orchestrator.recoverOwnerPassword({ owner_email: 'owner@example.test', new_password: 'a replacement owner password', recovery_secret: 'untrusted-renderer-input' })
    assert.deepEqual(recovered, { ok: true })
    assert.equal(recoveryRequest.recovery_secret, state.secrets.setup_secret)
    assert.equal(JSON.stringify(await orchestrator.status()).includes(state.secrets.setup_secret), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('installer failure is recoverable with the same attempt and secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-setup-fail-'))
  try {
    let attempts = 0
    const runner = async ({ cwd }) => {
      attempts += 1
      if (attempts === 1) {
        writeFileSync(join(cwd, 'status.json'), JSON.stringify({ phase: 'failed', message: 'Access denied', code: 'INSTALLER_FAILED' }))
        return { exitCode: 1, stdout: '', stderr: '' }
      }
      writeFileSync(join(cwd, 'status.json'), JSON.stringify({ phase: 'installed', certificate_fingerprint: 'a'.repeat(64), message: 'ok' }))
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const orchestrator = orchestratorFor(root, { runner })
    await orchestrator.begin(ownerDraft())
    await orchestrator.installPromise
    const failed = await orchestrator.status()
    assert.equal(failed.phase, 'failed')
    assert.match(failed.last_error.message, /Access denied|installer exited/)
    const setupSecret = orchestrator.readState().secrets.setup_secret
    const savedWrapper = orchestrator.readState().staging.wrapper_path
    const legacyWrapper = "# saved legacy wrapper\n$arguments = @('-DbPort','55432')\n"
    writeFileSync(savedWrapper, legacyWrapper)

    const resumed = await orchestrator.resume()
    assert.equal(resumed.phase, 'installing')
    await orchestrator.installPromise
    assert.equal((await orchestrator.status()).phase, 'installed')
    assert.equal(orchestrator.readState().secrets.setup_secret, setupSecret)
    assert.equal(attempts, 2)
    assert.equal(readFileSync(`${savedWrapper}.before-typed-parameters`, 'utf8'), legacyWrapper)
    assert.match(readFileSync(savedWrapper, 'utf8'), /\$arguments = @\{/)
    assert.match(readFileSync(savedWrapper, 'utf8'), /DbPort = \[int\]55432/)
    assert.match(readFileSync(savedWrapper, 'utf8'), /ResumeExisting = \$true/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('progress reports actual migration counters and uncertain installs cannot launch twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-setup-progress-'))
  try {
    let launches = 0
    const orchestrator = orchestratorFor(root, { runner: async ({ cwd }) => {
      launches++
      writeFileSync(join(cwd, 'status.json'), JSON.stringify({ phase: 'installing', message: 'Provisioning the database', updated_at: new Date().toISOString() }))
      writeFileSync(join(cwd, 'progress.json'), JSON.stringify({ task: 'Applying database migration', completed: 5, total: 78, updated_at: new Date().toISOString() }))
      return { exitCode: 124, stdout: '', stderr: 'Awaiting confirmation; preserve this attempt.' }
    } })
    await orchestrator.begin(ownerDraft())
    await orchestrator.installPromise
    const status = await orchestrator.status()
    assert.equal(status.phase, 'installing')
    assert.equal(status.progress.completed, 5)
    assert.equal(status.progress.total, 78)
    assert.match(status.progress.task, /Applying/)
    await assert.rejects(() => orchestrator.resume(), { code: 'INSTALLATION_STATUS_UNCERTAIN' })
    assert.equal(launches, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('prelaunch failure has plain guidance and redacted support detail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-setup-launch-'))
  try {
    const orchestrator = orchestratorFor(root, { runner: async () => ({ exitCode: 1, stdout: '', stderr: 'Start-Process: Unknown error (0xffffffff). password=private' }) })
    await orchestrator.begin(ownerDraft())
    await orchestrator.installPromise
    const status = await orchestrator.status()
    assert.equal(status.last_error.code, 'ELEVATION_LAUNCH_FAILED')
    assert.match(status.last_error.message, /administrator permission/)
    assert.doesNotMatch(status.last_error.message, /Start-Process/)
    assert.match(status.launcher_diagnostic, /0xffffffff/)
    assert.doesNotMatch(status.launcher_diagnostic, /private/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cancel refuses installed services and removes only an unstarted attempt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-setup-cancel-'))
  try {
    const orchestrator = orchestratorFor(root)
    await orchestrator.begin(ownerDraft())
    await orchestrator.installPromise
    await assert.rejects(() => orchestrator.cancel(), (error) => error.code === 'SETUP_SERVICE_INSTALLED')

    const failedRoot = mkdtempSync(join(tmpdir(), 'bar-setup-cancel-failed-'))
    try {
      const failed = orchestratorFor(failedRoot, {
        runner: async ({ cwd }) => {
          writeFileSync(join(cwd, 'status.json'), JSON.stringify({ phase: 'failed', message: 'UAC denied', code: 'ELEVATION_DENIED' }))
          return { exitCode: 1, stdout: '', stderr: '' }
        }
      })
      await failed.begin(ownerDraft())
      await failed.installPromise
      assert.equal((await failed.status()).phase, 'failed')
      const result = await failed.cancel()
      assert.equal(result.cancelled, true)
      assert.equal(await failed.status().then((status) => status.available), false)
    } finally { rmSync(failedRoot, { recursive: true, force: true }) }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('generated PowerShell wrapper parses on Windows without executing', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'bar-wrapper-'))
  try {
    const state = {
      version: 1, attempt_id: 'a', phase: 'prepared', created_at: '', updated_at: '',
      owner: { business_name: 'B', outlet_name: 'O', owner_name: 'N', currency: 'BWP', timezone: 'UTC', device_name: 'D' },
      install: {
        install_dir: join(root, "server 'quoted'"),
        data_dir: join(root, 'data'),
        pg_data_dir: join(root, 'pgdata'),
        backup_dir: join(root, 'backups'),
        pg_bin: join(root, 'postgres', '17.6', 'bin'),
        node_path: join(root, 'runtime', 'node-v22.1.0', 'node.exe'),
        server_root: join(root, 'payload', 'server'),
        installer_script: join(root, 'payload', 'server', 'packaging', 'windows', 'install-server.ps1'),
        http_port: 8787,
        db_port: 55432,
        base_url: 'http://127.0.0.1:8787',
        upgrade: false
      },
      secrets: { setup_secret: 'secret-value', backup_key: 'key-value', replication_password: 'replication-value' },
      staging: { root: join(root, 'staging'), secret_dir: join(root, 'staging', 'secrets'), wrapper_path: join(root, 'staging', 'install.ps1'), status_path: join(root, 'staging', 'status.json'), log_path: join(root, 'staging', 'install.log') },
      payload: { dir: join(root, 'payload'), manifest_sha256: 'x', service_version: '1', postgres_version: '17.6', node_version: 'v22.1.0' },
      last_error: null, installed_at: null, completed_at: null
    }
    const wrapper = buildInstallerWrapper(state)
    writeFileSync(join(root, 'wrapper.ps1'), wrapper)
    const parse = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$tokens = $null; $errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${join(root, 'wrapper.ps1').replaceAll("'", "''")}', [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Output ("$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Extent.Text) — $($_.Message)") }; exit 1 }`], { encoding: 'utf8' })
    assert.equal(parse.status, 0, `${parse.stdout}\n${parse.stderr}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('log redaction removes secrets, hashes and bearer-style tokens', () => {
  const utf16HashDecodedAsUtf8 = [...'b'.repeat(64)].join('\u0000')
  const text = [
    'setup-secret: abcdef123456',
    'password= hunter2',
    `token ${'a'.repeat(64)}`,
    `token ${utf16HashDecodedAsUtf8}`,
    'device bld_abcdefghijklmnopqrstuvwxyz012345',
    'normal installer line'
  ].join('\n')
  const redacted = redactLogTail(text)
  assert.ok(!redacted.includes('abcdef123456'))
  assert.ok(!redacted.includes('hunter2'))
  assert.ok(!redacted.includes('a'.repeat(64)))
  assert.ok(!redacted.includes('b'.repeat(64)))
  assert.ok(!redacted.includes('\u0000'))
  assert.ok(!redacted.includes('bld_abcdefghijklmnopqrstuvwxyz012345'))
  assert.match(redacted, /normal installer line/)
})
