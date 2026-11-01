import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BAR_LOCAL_SETUP_REQUIRED,
  BarLocalSetupRequiredError,
  assertCloudCompanySetupAllowed,
  cloudCompanySetupRefusal,
  isLocalBarSetupRequest
} from '../../src/shared/barLocalCompanySetup.js'
import { LOCAL_BAR_WORKSPACE_FLAG, LOCAL_BAR_WORKSPACE_DIR } from '../../src/shared/barLocalWorkspace.js'
import { BarLocalElectronRuntime } from '../../src/main/bar-local/electronRuntime.js'
import {
  buildWorkspaceLaunchArguments,
  buildWorkspacePrefill,
  dedicatedWorkspacePrefillPath,
  normalizeLocalBarSetupRequest,
  sanitizeWorkspaceEnvironment
} from '../../src/main/bar-local/localBarWorkspace.ts'

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'), 'utf8'),
    decryptString: (value) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8').replace(/^encrypted:/, '')
  }
}

const barPayload = {
  settings: {
    lodge_name: 'Town Bar',
    property_type: 'restaurant',
    business_type: 'restaurant',
    operating_profile: { hospitality_mode: 'bar_only', recommended_features: [] }
  },
  admin: { name: 'Owner', email: 'owner@bar.test', password: 'secret123', role: 'admin' }
}

test('the Bar journey cannot reach cloud company initialization', () => {
  assert.equal(isLocalBarSetupRequest(barPayload.settings), true)
  const refusal = cloudCompanySetupRefusal(barPayload.settings)
  assert.ok(refusal, 'a Bar payload must be refused before cloud setup runs')
  assert.equal(refusal.success, false)
  assert.equal(refusal.code, BAR_LOCAL_SETUP_REQUIRED)
  assert.equal(refusal.required_flow, 'bar_local_commissioning')
  assert.match(refusal.error, /cannot be created in this business setup/)
  assert.match(refusal.error, /Set up a new Bar on this computer/)
  // The refusal is a complete IPC result: no handler path continues to Supabase.
  assert.deepEqual(Object.keys(refusal).sort(), ['code', 'error', 'required_flow', 'success'])
})

test('the settings-domain guard refuses a Bar before any profile or Supabase work', () => {
  assert.throws(() => assertCloudCompanySetupAllowed(barPayload.settings), (error) => {
    assert.ok(error instanceof BarLocalSetupRequiredError)
    assert.equal(error.code, BAR_LOCAL_SETUP_REQUIRED)
    return true
  })
})

test('restaurant, hotel and lodge registration payloads are unchanged', () => {
  const allowed = [
    { operating_profile: { hospitality_mode: 'restaurant_bar' } },
    { operating_profile: { hospitality_mode: null }, property_type: 'restaurant' },
    { property_type: 'hotel', business_type: 'hotel' },
    { property_type: 'lodge', business_type: 'lodge' },
    { property_type: 'restaurant', business_type: 'restaurant' },
    { operating_profile: '{"hospitality_mode":"restaurant_bar"}' },
    {},
    null,
    undefined
  ]
  for (const settings of allowed) {
    assert.equal(isLocalBarSetupRequest(settings), false, `should stay a cloud company: ${JSON.stringify(settings)}`)
    assert.equal(cloudCompanySetupRefusal(settings), null)
    assert.doesNotThrow(() => assertCloudCompanySetupAllowed(settings))
  }
})

test('all Bar classification aliases are refused before cloud setup, even if another field says restaurant', () => {
  const refused = [
    { property_type: 'bar' },
    { business_type: 'bar' },
    { property_type: 'Bar / Bar POS' },
    { business_type: 'tavern' },
    { propertyType: 'bar_pos' },
    { operating_mode: 'bar' },
    { operatingMode: 'bar-only' },
    { hospitality_mode: 'drinks-only' },
    { operating_profile: { hospitality_mode: 'bar-pos' } },
    { operating_profile: '{"hospitality_mode":"bar"}' },
    { package_key: 'bar-pos' },
    { commercial_package_key: 'bar_only' },
    { operating_profile: { commercial_package_key: 'bar_pos' } }
  ]
  for (const alias of refused) {
    const settings = { property_type: 'restaurant', business_type: 'restaurant', ...alias }
    assert.equal(isLocalBarSetupRequest(settings), true, JSON.stringify(settings))
    assert.equal(cloudCompanySetupRefusal(settings)?.code, BAR_LOCAL_SETUP_REQUIRED)
    assert.throws(() => assertCloudCompanySetupAllowed(settings), { code: BAR_LOCAL_SETUP_REQUIRED })
  }
})

test('a malformed operating profile is not silently treated as a cloud Bar', () => {
  assert.equal(isLocalBarSetupRequest({ operating_profile: '{not json' }), false)
  assert.equal(isLocalBarSetupRequest({ operating_profile: { hospitality_mode: 'BAR_ONLY' } }), true)
  assert.equal(isLocalBarSetupRequest({ hospitality_mode: 'bar_only' }), true)
})

test('handoff carries bounded Bar contact details and currency without copying another workspace or secrets', () => {
  const normalized = normalizeLocalBarSetupRequest({
    business_name: '  Town Bar  ',
    currency: 'bwp',
    company_name: 'Town Bar Ltd',
    email: 'owner@townbar.example',
    company_id: 'should-not-cross',
    customer_data: [{ id: 1 }],
    device_token: 'secret'
  })
  assert.deepEqual(normalized, {
    business_name: 'Town Bar', currency: 'BWP',
    business_profile: { company_name: 'Town Bar Ltd', email: 'owner@townbar.example' }
  })
  assert.deepEqual(normalizeLocalBarSetupRequest({ business_name: '', currency: 'x1' }), {
    business_name: null, currency: 'BWP', business_profile: {}
  })
  assert.deepEqual(normalizeLocalBarSetupRequest(null), { business_name: null, currency: 'BWP', business_profile: {} })
  assert.equal(normalizeLocalBarSetupRequest({ currency: 'R' }).currency, 'ZAR')
  assert.equal(normalizeLocalBarSetupRequest({ business_name: 'a'.repeat(400) }).business_name.length, 200)

  const prefill = buildWorkspacePrefill(normalized, '2026-10-30T00:00:00.000Z')
  assert.equal(prefill.version, 2)
  assert.equal(prefill.business_name, 'Town Bar')
  assert.equal(prefill.currency, 'BWP')
  assert.deepEqual(prefill.business_profile, { company_name: 'Town Bar Ltd', email: 'owner@townbar.example' })
  assert.deepEqual(Object.keys(prefill).sort(), ['business_name', 'business_profile', 'created_at', 'currency', 'version'])

  // The prefill path lives inside the dedicated workspace subtree only.
  const prefillPath = dedicatedWorkspacePrefillPath('C:\\data\\app')
  assert.ok(prefillPath.includes(LOCAL_BAR_WORKSPACE_DIR))
  assert.ok(!prefillPath.includes('profiles.json'))
})

test('the dedicated workspace is a separate process profile with no inherited secrets', () => {
  assert.deepEqual(buildWorkspaceLaunchArguments({ isPackaged: true, appPath: 'C:\\app' }), [LOCAL_BAR_WORKSPACE_FLAG])
  assert.deepEqual(buildWorkspaceLaunchArguments({ isPackaged: false, appPath: 'C:\\app' }), ['C:\\app', LOCAL_BAR_WORKSPACE_FLAG])
  const env = sanitizeWorkspaceEnvironment({
    PATH: 'C:\\Windows',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    BAR_LOCAL_BACKUP_KEY: 'key',
    BAR_LOCAL_UPDATE_APPLY_ENABLED: '1',
    PGPASSWORD: 'pw',
    DATABASE_URL: 'postgres://localhost/live',
    ELECTRON_RUN_AS_NODE: '1',
    BOROKO_TEST_USER_DATA_DIR: 'C:\\tmp',
    NORMAL_SETTING: 'kept'
  })
  assert.deepEqual(env, { PATH: 'C:\\Windows', NORMAL_SETTING: 'kept' })
})

test('a dedicated window owns its own authority status and cannot switch to cloud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bar-workspace-'))
  try {
    const standard = new BarLocalElectronRuntime({
      userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos'
    })
    assert.equal(standard.status().workspace_isolation, 'standard')
    assert.equal(standard.status().setup_prefill, null)

    const dedicated = new BarLocalElectronRuntime({
      userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos'
    })
    dedicated.dedicatedLocalWorkspace = true
    const status = dedicated.status()
    assert.equal(status.workspace_isolation, 'dedicated_bar')
    assert.equal(status.authority_mode, 'cloud')
    assert.equal(status.configured, false)

    // Prefill is read from the dedicated profile root (which is this runtime's
    // userDataPath inside the real dedicated process).
    const prefillPath = join(dir, 'bar-local-setup-request.json')
    writeFileSync(prefillPath, JSON.stringify({ version: 1, business_name: 'Corner Pub', currency: 'ZAR', created_at: 'now' }))
    assert.deepEqual(dedicated.status().setup_prefill, { business_name: 'Corner Pub', currency: 'ZAR', business_profile: {} })
    writeFileSync(prefillPath, JSON.stringify({ version: 3, business_name: 'Unsupported Format' }))
    assert.equal(dedicated.status().setup_prefill, null)
    // The prefill helper itself targets the dedicated workspace subtree.
    assert.ok(dedicatedWorkspacePrefillPath(dir).endsWith(join(LOCAL_BAR_WORKSPACE_DIR, 'bar-local-setup-request.json')))

    assert.throws(() => dedicated.selectCloudWorkspace(), { code: 'DEDICATED_LOCAL_WORKSPACE' })
    // A standard workspace still gets the existing explicit cloud choice.
    assert.equal(typeof standard.selectCloudWorkspace().restart_required, 'boolean')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('practice mode, an already-local window and a committed Bar cannot open another workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bar-workspace-guard-'))
  try {
    const runtime = new BarLocalElectronRuntime({
      userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos'
    })
    runtime.training = true
    assert.throws(() => runtime.assertCanOpenLocalBarWorkspace(), { code: 'WRONG_AUTHORITY' })

    runtime.training = false
    runtime.dedicatedLocalWorkspace = true
    assert.throws(() => runtime.assertCanOpenLocalBarWorkspace(), { code: 'WORKSPACE_ALREADY_LOCAL' })

    runtime.dedicatedLocalWorkspace = false
    assert.doesNotThrow(() => runtime.assertCanOpenLocalBarWorkspace())

    const authority = {
      authority_mode: 'bar_local',
      product: 'hospitality-pos',
      business_id: 'e513f287-3c0d-4a8a-9e30-3c498de85b99',
      outlet_ids: ['1fa934c2-981b-4d4e-8c02-1851cd96c4ea'],
      active_outlet_id: '1fa934c2-981b-4d4e-8c02-1851cd96c4ea',
      authority_id: 'a7cf64e8-bf07-4bb6-ac6e-7129c6b26fc7',
      authority_epoch: 1,
      contract_version: 1,
      base_url: 'http://127.0.0.1:4317'
    }
    mkdirSync(join(dir, 'bar-local'), { recursive: true })
    writeFileSync(join(dir, 'bar-local', 'authority.bin'), fakeSafeStorage().encryptString(JSON.stringify(authority)))
    const committed = new BarLocalElectronRuntime({
      userDataPath: dir, safeStorage: fakeSafeStorage(), buildProductId: 'hospitality-pos'
    })
    assert.throws(() => committed.assertCanOpenLocalBarWorkspace(), { code: 'ALREADY_COMMISSIONED' })
    committed.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('the setup renderer and IPC wire the same guard', () => {
  const setup = readFileSync(new URL('../../src/renderer/src/components/Setup.jsx', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../../src/main/bar-local/electronRuntime.js', import.meta.url), 'utf8')
  const domain = readFileSync(new URL('../../src/main/domains/settings.js', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../../src/preload/index.js', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../src/renderer/src/App.jsx', import.meta.url), 'utf8')

  // Renderer: the Bar branch never reaches the cloud company or cloud profile writes.
  const finish = setup.slice(setup.indexOf('const handleFinish ='), setup.indexOf('const STEP_LABELS'))
  assert.match(finish, /if \(isBarLocal\) \{/, 'handleFinish must branch before cloud setup')
  assert.ok(
    finish.indexOf('if (isBarLocal) {') < finish.indexOf('window.api.setup.initializeCompany'),
    'the Bar guard must run before initializeCompany'
  )
  const operating = setup.slice(setup.indexOf('const handleContinueOperating ='), setup.indexOf('const getSetupErrorMessage'))
  assert.match(operating, /if \(isBarLocal\) \{[\s\S]*setStep\(3\)[\s\S]*return[\s\S]*\}\n    try \{/)
  assert.ok(
    operating.indexOf('if (isBarLocal)') < operating.indexOf('updateOperatingProfile'),
    'the Bar branch must skip the cloud operating-profile write'
  )
  assert.match(setup, /<BarLocalSetupHandoff/)
  assert.match(setup, /businessProfile=\{\{/)
  assert.match(setup, /company_name: form\.company_name[\s\S]*vat_number: form\.vat_number/)
  const handoff = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/BarLocalSetupHandoff.jsx', import.meta.url), 'utf8')
  assert.match(handoff, /local owner sign-in using your name and a PIN/)
  assert.doesNotMatch(handoff, /restaurant, hotel, lodge|existing cloud business/i)

  // The handoff is successful only after the dedicated window reports a
  // visible ready-to-show acknowledgement. The main process can focus an
  // already-running dedicated Bar window and acknowledge that same request.
  assert.match(runtime, /windowsHide: false/)
  assert.match(runtime, /25000\)/)
  assert.match(runtime, /\/ready\/\$\{handoffToken\}/)
  assert.match(app, /react-first-commit[\s\S]*rendererReady/)
  assert.match(app, /Bar or counter name[\s\S]*An outlet is a trading area, not each till[\s\S]*Main Bar[\s\S]*Pool Bar/)
  assert.match(app, /Main computer name[\s\S]*Other tills connect to this main computer/)
  assert.match(app, /Owner PIN[\s\S]*Choose 4–12 digits/)
  assert.match(app, /Currency[\s\S]*3-letter code, such as BWP/)
  assert.match(app, /Timezone[\s\S]*Africa\/Gaborone/)
  assert.match(app, /More storage space is needed[\s\S]*Check again/)
  assert.doesNotMatch(app, /This computer is not ready for automatic setup/)
  assert.match(main, /ipcMain\.handle\('barLocal:rendererReady'[\s\S]*if \(mainWindowVisible\) completeLocalWorkspaceHandoffs\(\)/)
  assert.match(main, /if \(localWorkspaceRendererReady && mainWindowVisible\)/)
  assert.match(main, /app\.on\('second-instance', \(_event, commandLine\)[\s\S]*existing\.focus\(\)[\s\S]*if \(localWorkspaceRendererReady && mainWindowVisible\)[\s\S]*acknowledgeLocalBarWorkspace\(\[flag\]\)[\s\S]*pendingLocalBarHandoffs\.add\(flag\)/)
  assert.match(main, /function completeLocalWorkspaceHandoffs\(\)[\s\S]*acknowledgeLocalBarWorkspace\(process\.argv\)[\s\S]*acknowledgeLocalBarWorkspace\(\[flag\]\)/)

  // Main process: the IPC contract and the settings domain both enforce it.
  assert.match(main, /cloudCompanySetupRefusal\(payload\?\.settings\)/)
  assert.ok(main.indexOf('cloudCompanySetupRefusal(payload?.settings)') < main.indexOf('db.initializeCompanySetup(payload)'))
  assert.match(domain, /isLocalBarSetupRequest\(settings\)/)
  const domainSetup = domain.slice(domain.indexOf('export async function initializeCompanySetup'))
  assert.ok(
    domainSetup.indexOf('isLocalBarSetupRequest(settings)') < domainSetup.indexOf('const activeProfile = getActiveProfile()'),
    'the domain guard must run before profile work'
  )
  assert.match(preload, /openLocalBarWorkspace: \(request\) => invoke\('barLocal:openLocalBarWorkspace', request\)/)
})
