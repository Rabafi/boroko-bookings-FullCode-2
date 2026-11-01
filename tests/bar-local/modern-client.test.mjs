// @ts-check

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalHashForEnvelope } from '../../src/main/bar-local/intents.js'
import http from 'node:http'
import https from 'node:https'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALLOWED_COMMANDS,
  ALLOWED_QUERIES,
  MAX_CATALOGUE_REFRESH_PAGES,
  BarLocalAdapterError,
  buildCatalogueSnapshot,
  checkCartAgainstSnapshot,
  createAuthorityRouter,
  createBarLocalClient,
  createHttpTransport,
  createIdentityMapping,
  createMemoryDeviceCredentialStore,
  createModernBarLocalAdapter,
  loadCatalogueSnapshot,
  normalizeFingerprint,
  openIntentJournal,
  newOperationId
} from '../../src/main/bar-local/index.js'

const AUTHORITY_ID = '11111111-1111-4111-8111-111111111111'
const BUSINESS_ID = '22222222-2222-4222-8222-222222222222'
const OUTLET_ID = '33333333-3333-4333-8333-333333333333'
const DEVICE_ID = '44444444-4444-4444-8444-444444444444'
const STAFF_ID = '55555555-5555-4555-8555-555555555555'
const SESSION_ID = '66666666-6666-4666-8666-666666666666'
const OP_EXECUTING = '99999999-9999-4999-8999-999999999999'
const OP_TIMEOUT = '88888888-8888-4888-8888-888888888888'
const OP_CONFLICT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OP_REFUSED = 'abababab-abab-4bab-8bab-abababababab'
const OP_SESSION = 'acacacac-acac-4cac-8cac-acacacacacac'
const PRODUCT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRODUCT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PRODUCT_MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const GROUP_SIZE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const GROUP_TOPPINGS = 'efefefef-efef-4efe-8efe-efefefefefef'
const OPTION_LARGE = 'f0000000-0000-4000-8000-000000000001'
const OPTION_SMALL = 'f0000000-0000-4000-8000-000000000002'
const OPTION_CHEESE = 'f0000000-0000-4000-8000-000000000003'
const OPTION_BACON = 'f0000000-0000-4000-8000-000000000004'
const OPTION_ONION = 'f0000000-0000-4000-8000-000000000005'
const OPTION_OLIVES = 'f0000000-0000-4000-8000-000000000006'
const OPTION_UNKNOWN = 'f0000000-0000-4000-8000-000000000099'

const DEVICE_TOKEN = 'bld_test_device_token_0001'
const SESSION_TOKEN = 'sess_test_token_abcdefghij'
const ROTATED_SESSION_TOKEN = 'sess_test_token_rotated_01'

const CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIC4DCCAcigAwIBAgIIbUsMpxrXEvAwDQYJKoZIhvcNAQELBQAwFDESMBAGA1UE
AxMJbG9jYWxob3N0MB4XDTI2MTAxODEwMDAxNVoXDTM1MTAyMDEwMDAxNVowFDES
MBAGA1UEAxMJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEArnnIsvjW8JHlQLGH24c4DHHbbT2I5Xf2HC30QTW9suBX03R+fBVBDXFdLNTr
IAEgbnhS8umunskYmm+R7UreBVjr0DcZIxjtqjRtCKyXXfQ4InJ3HBgXz6PnNoa0
G6/uv7/l0eVqMo7u4/lZ6GnFLAK0/AMkxXFrMzpbpA5VGyq/7E8EvEQoCuHlWYuO
8D59KjBfssmiagkHt0gDvZxhTv7rTPn6z3BRLhOlre0e27FVYAjzY1rfHvKB3Tta
EJI9kJk4+2R/Yj6oIJDZTL6uHWJt3KWK1k1DaW79rYAROso1lMQhQcI48KPmwaQf
e3TFc6CV7g3qG4G+ZY+sbnYEXQIDAQABozYwNDAaBgNVHREEEzARgglsb2NhbGhv
c3SHBH8AAAEwCQYDVR0TBAIwADALBgNVHQ8EBAMCBaAwDQYJKoZIhvcNAQELBQAD
ggEBAG+nH7dhyM9BktlfUOHOlsBFWrVJqQaVusWABgxFdCslxWfaYWE5erBPXa+V
IOS392iGIwsUfIn0iS6Bk9KG6nMaHKCSv0ws7/d0SWF+NPV1GtyarQjhnVD3d290
SHqG/0wJ0K4J5V9Jw8VDcE9mxNTOuiz+ChgUN01kFhL6RxUnMH3Cg95jMJjA8RdM
ByfXCiY5Hd7SANR5q4S5jC3bvjv9USW39bd79pZrdUblwJecFttfedr4GLn8rthL
0VZui9aQFTKruafxpEJlNGsu+XfIVAGMuD+nRCVMdj11NrtPKxIgEOM54SLO7Hzz
Yfn/kki4eVB6mjoBO6pqst7tegM=
-----END CERTIFICATE-----`

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCueciy+NbwkeVA
sYfbhzgMcdttPYjld/YcLfRBNb2y4FfTdH58FUENcV0s1OsgASBueFLy6a6eyRia
b5HtSt4FWOvQNxkjGO2qNG0IrJdd9DgicnccGBfPo+c2hrQbr+6/v+XR5Woyju7j
+VnoacUsArT8AyTFcWszOlukDlUbKr/sTwS8RCgK4eVZi47wPn0qMF+yyaJqCQe3
SAO9nGFO/utM+frPcFEuE6Wt7R7bsVVgCPNjWt8e8oHdO1oQkj2QmTj7ZH9iPqgg
kNlMvq4dYm3cpYrWTUNpbv2tgBE6yjWUxCFBwjjwo+bBpB97dMVzoJXuDeobgb5l
j6xudgRdAgMBAAECggEBAJVFAc0EkbdtyooHmKjbTbtv6X/TRnyzni5Lro3fsXUI
9HqnTtNPx8D9fO6vFp3h+OIqNSU3gbq9ZzwxOdKe28YNZmpTyUC6whJ9Gc9zAWlT
WHc4IOk7P5vYqSaAJjUN1p/cSH3D3ZB1srH+EcqCOztE8ZwuAFafi0xfoCmCTZOY
Gze8Bo9X00+qfflgfDiK1IedykbYknye/j1QlLXIwfGqz8vuhhExg3ejgThJZJhY
RSg4iuFb7lmtZdK6zEwdqOQWdUfaE4VBY4seBcVnjyQEF0TraPvcqr2n8GoQOeX0
NHK/q59HrEiITMcw7V9KTFpU+FBvfkHDflIx6qpwmw0CgYEA6Axti4JvCX30xFvF
Qq9pAzGi9zOuPHkBnHITKm+NobDDQPPqZRXNpgglZrpaQA9S6bZC8URoz2+DBwUy
i27NOEWiaDne10aijLqteJxjUpbnWb2UW0zZmubrD+qxHwE8W374GcChfg6B2Q8i
zrNNRIGKyJed27r40BW/uELnQxcCgYEAwHwSOdB5ju0lnAf6IXU2aaVoW3CiVZ0C
7nVJAI9dXkl008Bzt62AXgIbhDhffL+3tQUKaaV2zwo1l6KgGEwGJt3HzeRLKsLn
4cskNBaTFdELOWkELsca/NM1T1PdlsHcch89EC3+C6ydVVUeF/DxL5uIyfUEn80i
NrHielbV7KsCgYEAvflevbZ9XVIHT7KqHlwpJvo+Jw/id5PBo+kok7dcRqHGWKjY
nwVopaNJq36pYISrJreWupt9C0aKCPdSWCDQVl98BMRMEga8EWbLmlC+Z+EvaqLw
kIasKEsg6pkDhRSn62hZigvQqrkJyUDBCGR2v70md+7YyAmcpg8INLxhROUCgYBq
a65//H1YwlDK5bYrjWyaGHOMKsf14atfP8Uu5BTRLnfDI2JXKTwRvcSM48YXaMAe
+zx4kJ0RdymOPsGY7V9xWalAcnoEmGIv+mp3ygtkQoGcKi2/1yFaq0OMKmgXE/PX
vOG78lHFDpimNzs+LV6L3chRMIBwAbBq4QrAbQY1pQKBgQCaXLMDZtPg14SkLbvP
BZRCsakHDYW6X385xkkhGclO9LlHesTvWkQhe9H5ijxts5umJtYfmFnzUPoN0Fir
zopMBwSCfMpFRP9L/vUOSHen/wLw1cu6IVATnZSwLLJh5N1gnSoWC3iBrs3TtalL
tTeiH5ppLVh7/oDDs053KFG/ng==
-----END PRIVATE KEY-----`

const TEST_FINGERPRINT = 'fe41980397bf229993fe5a4c65fdde1da38bb5cf66975e108317de900cda83ce'

const READINESS = Object.freeze({
  ready: true,
  authority_id: AUTHORITY_ID,
  authority_epoch: 1,
  business_id: BUSINESS_ID,
  outlet_id: OUTLET_ID,
  schema_version: 'bar-local-1',
  commit_sequence: 12,
  blockers: [],
  cloud_export: 'integration_disabled'
})

const QUERY_SCOPE = Object.freeze({
  business_id: BUSINESS_ID,
  outlet_id: OUTLET_ID,
  actor_staff_id: STAFF_ID,
  role: 'owner',
  device_id: DEVICE_ID
})

function json(res, status, payload) {
  const text = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', String(Buffer.byteLength(text)))
  res.end(text)
}

async function createFakeService({ secure = false } = {}) {
  const requests = []
  const routes = new Map()
  const sockets = new Set()
  const handler = (req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = null
      if (raw !== '') {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      }
      const parsed = new URL(req.url ?? '/', 'http://bar.local')
      const record = {
        method: req.method,
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams.entries()),
        headers: req.headers,
        body
      }
      requests.push(record)
      const route = routes.get(`${record.method} ${record.path}`)
      if (route) {
        route(req, res, body, record)
        return
      }
      json(res, 404, { ok: false, code: 'NOT_FOUND', message: `No fake route for ${record.method} ${record.path}` })
    })
  }
  const server = secure
    ? https.createServer({ cert: CERTIFICATE_PEM, key: PRIVATE_KEY_PEM }, handler)
    : http.createServer(handler)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    base_url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`,
    requests,
    route(method, path, fn) {
      routes.set(`${method} ${path}`, fn)
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve()))
    }
  }
}

function barLocalConfig(baseUrl, overrides = {}) {
  return {
    authority_mode: 'bar_local',
    product: 'hospitality-pos',
    business_id: BUSINESS_ID,
    lodge_id: 'lodge-main',
    outlet_ids: [OUTLET_ID],
    active_outlet_id: OUTLET_ID,
    authority_id: AUTHORITY_ID,
    authority_epoch: 1,
    commissioning_id: 'commissioning-test',
    base_url: baseUrl,
    ...overrides
  }
}

function sessionPayload() {
  return {
    ok: true,
    session_token: SESSION_TOKEN,
    session_id: SESSION_ID,
    expires_at: '2026-10-20T12:00:00.000Z',
    authority_epoch: 1,
    business_id: BUSINESS_ID,
    outlet_id: OUTLET_ID,
    staff: { staff_id: STAFF_ID, display_name: 'Test Operator' }
  }
}

function receiptFor(operationId, commitSequence = 42) {
  return {
    operation_id: operationId,
    outcome: 'committed_local',
    authority_id: AUTHORITY_ID,
    authority_epoch: 1,
    business_id: BUSINESS_ID,
    outlet_id: OUTLET_ID,
    device_id: DEVICE_ID,
    actor_staff_id: STAFF_ID,
    commit_sequence: commitSequence,
    business_date: '2026-10-20',
    server_committed_at: '2026-10-20T10:00:00.000Z',
    cloud_status: 'integration_disabled'
  }
}

function committedBody(operationId, options = {}) {
  return {
    ok: true,
    outcome: 'committed_local',
    replayed: options.replayed === true,
    receipt: receiptFor(operationId, options.commit_sequence ?? 42),
    result: options.result ?? { order_id: '00000000-0000-4000-8000-000000000001' }
  }
}

function envelopeFor(operationId, payload = { total_cents: 100 }) {
  return {
    contract_version: 1,
    authority_id: AUTHORITY_ID,
    authority_epoch: 1,
    business_id: BUSINESS_ID,
    outlet_id: OUTLET_ID,
    device_id: DEVICE_ID,
    operation_id: operationId,
    command: 'sale.commit',
    payload_version: 1,
    payload,
    expected_versions: {},
    dependencies: [],
    client_occurred_at: '2026-10-20T10:00:00.000Z'
  }
}

function productFixture(productId, overrides = {}) {
  return {
    product_id: productId,
    sku: `SKU-${productId.slice(0, 4)}`,
    name: 'Test Product',
    category: 'drinks',
    price: '125.50',
    tax_rate: '15',
    track_stock: true,
    active: true,
    available: true,
    version: 3,
    ...overrides
  }
}

function modifierOptionFixture(optionId, groupId, overrides = {}) {
  return {
    modifier_option_id: optionId,
    modifier_group_id: groupId,
    code: `OPTION-${optionId.slice(-2)}`,
    name: `Option ${optionId.slice(-2)}`,
    price_delta: '0.00',
    sort_order: 1,
    active: true,
    version: 1,
    ...overrides
  }
}

function modifierGroupFixture(groupId, options, overrides = {}) {
  return {
    modifier_group_id: groupId,
    code: 'GROUP',
    name: 'Group',
    required: true,
    min_selections: 1,
    max_selections: 1,
    active: true,
    version: 1,
    options,
    ...overrides
  }
}

function makeClient(server, options = {}) {
  const router = createAuthorityRouter(barLocalConfig(server.base_url, options.config ?? {}))
  router.markReadiness(options.readiness ?? READINESS)
  const dir = mkdtempSync(join(tmpdir(), 'bar-local-client-'))
  const journal = options.journal ?? openIntentJournal({ filePath: join(dir, 'intents.jsonl') })
  const credentialStore = options.credential_store ?? createMemoryDeviceCredentialStore({
    device_id: DEVICE_ID,
    device_token: DEVICE_TOKEN
  })
  const client = createBarLocalClient({
    router,
    journal,
    device_store: credentialStore,
    logger: options.logger ?? null,
    clock: options.clock,
    request_timeout_ms: options.request_timeout_ms
  })
  return {
    client,
    router,
    journal,
    credential_store: credentialStore,
    dir,
    cleanup() {
      client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('a post-send journal failure retains uncertainty and the original operation identity', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (_req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (_req, res, body) => json(res, 200, committedBody(body.operation_id)))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const operationId = newOperationId()
    harness.journal.markCommitted = () => { throw new Error('Synthetic checkpoint disk failure') }
    await assert.rejects(harness.client.command({ command:'shift.open', payload:{opening_float:'0.00'}, operation_id:operationId }),
      error => error.outcomeUnknown === true && error.retrySameOperation === true && error.operationId === operationId)
    assert.equal(harness.journal.get(operationId).state,'sending')
    assert.equal(server.requests.filter(request=>request.path==='/v1/commands').length,1)
  } finally { harness.cleanup(); await server.close() }
})

function cataloguePage(overrides = {}) {
  return {
    ok: true,
    data: [],
    pagination: { next_cursor: null, has_more: false },
    snapshot_watermark: 1,
    scope: QUERY_SCOPE,
    as_of: '2026-10-20T10:00:00.000Z',
    complete: true,
    unavailable: [],
    ...overrides
  }
}

test('authority configuration must be explicit, scoped and transport-safe', () => {
  assert.throws(() => createAuthorityRouter({}), (error) => error.code === 'VALIDATION_FAILED')
  assert.throws(
    () => createAuthorityRouter(barLocalConfig('http://10.0.0.5:8787')),
    (error) => error.code === 'VALIDATION_FAILED'
  )
  assert.throws(
    () => createAuthorityRouter({
      authority_mode: 'bar_local',
      product: 'hospitality-pos',
      business_id: BUSINESS_ID,
      outlet_ids: [OUTLET_ID],
      authority_id: AUTHORITY_ID,
      authority_epoch: 1,
      local_service: { base_url: 'https://127.0.0.1:8787' }
    }),
    (error) => error.code === 'VALIDATION_FAILED'
  )
  assert.throws(
    () => createAuthorityRouter(barLocalConfig('http://127.0.0.1:8787', { contract_version: 2 })),
    (error) => error.code === 'VALIDATION_FAILED'
  )
  assert.equal(normalizeFingerprint(TEST_FINGERPRINT.toUpperCase().replace(/(..)(?=.)/g, '$1:')), TEST_FINGERPRINT)
  assert.throws(() => createHttpTransport({ base_url: 'https://127.0.0.1:8787' }), (error) => error.code === 'VALIDATION_FAILED')
})

test('cloud authority never creates a local client and never calls the local service', async () => {
  const server = await createFakeService()
  const adapter = createModernBarLocalAdapter({
    authority: { authority_mode: 'cloud', product: 'hospitality-pos', business_id: BUSINESS_ID },
    journal: openIntentJournal()
  })
  try {
    assert.equal(adapter.authority_mode, 'cloud')
    assert.equal(adapter.client, null)
    const route = adapter.router.routeFor('command:sale.commit')
    assert.equal(route.authority, 'cloud')
    assert.equal(route.target, 'supabase')
    assert.throws(() => adapter.router.assertLocal('command:sale.commit'), (error) => error.code === 'WRONG_AUTHORITY')
    assert.throws(() => adapter.requireClient(), (error) => error.code === 'WRONG_AUTHORITY')
    assert.equal(server.requests.length, 0)
  } finally {
    adapter.close()
    await server.close()
  }
})

test('a bar_local adapter composes the router, journal and client for the same configuration', async () => {
  const server = await createFakeService()
  const dir = mkdtempSync(join(tmpdir(), 'bar-local-adapter-'))
  const adapter = createModernBarLocalAdapter({
    authority: barLocalConfig(server.base_url),
    journal_options: { filePath: join(dir, 'intents.jsonl') },
    device_credential: { device_id: DEVICE_ID, device_token: DEVICE_TOKEN },
    identity: {
      business_id: BUSINESS_ID,
      lodge_id: 'lodge-main',
      outlets: [{ lodge_outlet_id: 'OUTLET-A', local_outlet_id: OUTLET_ID }],
      staff: [{ lodge_staff_id: 'STAFF-1', local_staff_id: STAFF_ID }]
    }
  })
  try {
    assert.equal(adapter.authority_mode, 'bar_local')
    assert.ok(adapter.client instanceof Object)
    assert.equal(adapter.requireClient(), adapter.client)
    assert.equal(adapter.identity.outletId('OUTLET-A'), OUTLET_ID)
    assert.equal(adapter.describe().has_local_client, true)
    assert.equal(adapter.describe().authority.fenced, false)
  } finally {
    adapter.close()
    rmSync(dir, { recursive: true, force: true })
    await server.close()
  }
})

test('epoch mismatch fences the router instead of falling back', () => {
  const router = createAuthorityRouter(barLocalConfig('http://127.0.0.1:8787'))
  assert.throws(
    () => router.markReadiness({ ...READINESS, authority_epoch: 2 }),
    (error) => error.code === 'WRONG_AUTHORITY_EPOCH'
  )
  assert.equal(router.isFenced, true)
  assert.equal(router.readiness, null)
  assert.throws(() => router.routeFor('command:sale.commit'), (error) => error.code === 'WRONG_AUTHORITY_EPOCH')
  assert.throws(() => router.routeFor('command:sale.commit', { requireReady: false }), (error) => error.code === 'WRONG_AUTHORITY_EPOCH')
  assert.throws(() => router.assertLocal('command:sale.commit'), (error) => error.code === 'WRONG_AUTHORITY_EPOCH')
})

test('service loss blocks local routing and never becomes a cloud route', () => {
  const router = createAuthorityRouter(barLocalConfig('http://127.0.0.1:8787'))
  router.markReadiness(READINESS)
  assert.equal(router.routeFor('query:bootstrap').authority, 'bar_local')
  router.markUnavailable('SERVICE_UNREACHABLE')
  assert.equal(router.isReady, false)
  assert.throws(() => router.routeFor('query:bootstrap'), (error) => error.code === 'SERVICE_UNAVAILABLE')
  const degraded = router.routeFor('query:bootstrap', { requireReady: false })
  assert.equal(degraded.authority, 'bar_local')
  assert.notEqual(degraded.authority, 'cloud')
})

test('login, refresh and revoke manage the local session and never log secrets', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/sessions/refresh', (req, res) => json(res, 200, {
    ok: true,
    session_token: ROTATED_SESSION_TOKEN,
    expires_at: '2026-10-20T12:30:00.000Z'
  }))
  server.route('POST', '/v1/sessions/revoke', (req, res) => json(res, 200, { ok: true, session_id: SESSION_ID }))
  const logs = []
  const logger = {
    info: (record) => logs.push(record),
    warn: (record) => logs.push(record),
    error: (record) => logs.push(record)
  }
  const harness = makeClient(server, { logger })
  try {
    const session = await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    assert.equal(session.token, SESSION_TOKEN)
    assert.equal(session.business_id, BUSINESS_ID)
    assert.equal(session.authority_epoch, 1)

    const loginRequest = server.requests.find((request) => request.path === '/v1/sessions')
    assert.ok(loginRequest)
    assert.equal(loginRequest.headers['x-bar-device-token'], DEVICE_TOKEN)
    assert.equal(loginRequest.body.staff_id, STAFF_ID)
    assert.equal(loginRequest.body.pin, '2468')

    const refreshed = await harness.client.refreshSession()
    assert.equal(refreshed.token, ROTATED_SESSION_TOKEN)
    const refreshRequest = server.requests.find((request) => request.path === '/v1/sessions/refresh')
    assert.equal(refreshRequest.headers.authorization, `Bearer ${SESSION_TOKEN}`)
    assert.equal(refreshRequest.headers['x-bar-device-id'], DEVICE_ID)

    const revoked = await harness.client.revokeSession()
    assert.equal(revoked.session_id, SESSION_ID)
    assert.equal(harness.client.session, null)

    const serializedLogs = JSON.stringify(logs)
    assert.ok(!serializedLogs.includes(DEVICE_TOKEN))
    assert.ok(!serializedLogs.includes(SESSION_TOKEN))
    assert.ok(!serializedLogs.includes(ROTATED_SESSION_TOKEN))
    assert.ok(!serializedLogs.includes('2468'))
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('manager approval command uses trusted local scope and verifies exact operation hash', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (_req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/approvals', (_req, res, body) => json(res, 201, {
    ok: true,
    approval_id: '77777777-7777-4777-8777-777777777777',
    operation_hash: approvalHashForEnvelope(body.operation),
    expires_in: 300
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const operationId = newOperationId()
    const payload = { sale_id: 'sale-1', reason: 'Damaged item', disposition: 'waste', lines: [{ sale_line_id: 'line-1', quantity: '1' }, { sale_line_id: 'line-2', quantity: '0.5' }] }
    const approval = await harness.client.requestApprovalForCommand({
      command: 'sale.return', payload, pin: '9753', operation_id: operationId
    })
    const request = server.requests.find((entry) => entry.path === '/v1/approvals')
    assert.equal(request.body.operation.operation_id, operationId)
    assert.equal(request.body.operation.device_id, DEVICE_ID)
    assert.equal(request.body.operation.authority_id, AUTHORITY_ID)
    assert.equal(request.body.operation.outlet_id, OUTLET_ID)
    assert.equal(request.body.capability, 'pos.void')
    assert.equal(request.body.pin, '9753')
    assert.deepEqual(request.body.operation.payload.lines, payload.lines)
    assert.equal(approval.approval_id, '77777777-7777-4777-8777-777777777777')
    const cashupApproval = await harness.client.requestApprovalForCommand({
      command: 'cashup.review',
      payload: { cashup_id: '88888888-8888-4888-8888-888888888888', decision: 'rejected', reason: 'Count does not reconcile' },
      pin: '9753'
    })
    const cashupRequest = server.requests.filter((entry) => entry.path === '/v1/approvals')[1]
    assert.equal(cashupRequest.body.capability, 'pos.cashup')
    assert.equal(cashupRequest.body.operation.command, 'cashup.review')
    assert.equal(typeof cashupApproval.approval_id, 'string')
    const reopenApproval = await harness.client.requestApprovalForCommand({
      command: 'cashup.reopen',
      payload: { cashup_id: '88888888-8888-4888-8888-888888888888', expected_status: 'approved', counted_cash: '12.00', counted_card: '0.00', proof_refs: [], reason: 'Recount correction' },
      pin: '9753'
    })
    const reopenRequest = server.requests.filter((entry) => entry.path === '/v1/approvals')[2]
    assert.equal(reopenRequest.body.capability, 'pos.cashup')
    assert.equal(reopenRequest.body.operation.command, 'cashup.reopen')
    assert.equal(typeof reopenApproval.approval_id, 'string')
    const voidApproval = await harness.client.requestApprovalForCommand({
      command: 'sale.void', payload: { sale_id: 'sale-1', reason: 'Duplicate charge' }, pin: '9753'
    })
    const voidRequest = server.requests.filter((entry) => entry.path === '/v1/approvals')[3]
    assert.equal(voidRequest.body.capability, 'pos.void')
    assert.equal(voidRequest.body.operation.command, 'sale.void')
    assert.equal(typeof voidApproval.approval_id, 'string')
    await assert.rejects(harness.client.requestApprovalForCommand({ command: 'sale.return', payload, pin: 'bad' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED')
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('login refuses invalid staff credentials without opening a session', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 401, {
    ok: false,
    code: 'AUTH_INVALID',
    message: 'The staff pin is invalid.',
    retry_same_operation: false
  }))
  const harness = makeClient(server)
  try {
    await assert.rejects(
      harness.client.login({ staff_id: STAFF_ID, pin: '9999' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'AUTH_INVALID'
    )
    assert.equal(harness.client.session, null)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('session expiry keeps the operation retryable with the same key', async () => {
  const server = await createFakeService()
  const attempts = new Map()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (req, res, body) => {
    const operationId = body.operation_id
    const count = (attempts.get(operationId) ?? 0) + 1
    attempts.set(operationId, count)
    if (count === 1) {
      json(res, 401, {
        ok: false,
        code: 'SESSION_EXPIRED',
        message: 'The local session expired.',
        retry_same_operation: false
      })
      return
    }
    json(res, 200, committedBody(operationId, { replayed: true }))
  })
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.command({ command: 'sale.commit', payload: { total_cents: 500 }, operation_id: OP_SESSION }),
      (error) => error.code === 'SESSION_EXPIRED'
        && error.retrySameOperation === true
        && error.outcomeUnknown === true
        && error.operationId === OP_SESSION
    )
    assert.equal(harness.client.session, null)
    assert.equal(harness.journal.get(OP_SESSION).state, 'outcome_unknown')

    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const replay = await harness.client.retryOperation(OP_SESSION)
    assert.equal(replay.ok, true)
    assert.equal(replay.outcome, 'committed_local')
    assert.equal(harness.journal.get(OP_SESSION).state, 'committed_local')

    const commandRequests = server.requests.filter((request) => request.path === '/v1/commands')
    assert.deepEqual(commandRequests.map((request) => request.body.operation_id), [OP_SESSION, OP_SESSION])
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('retrying an OPERATION_EXECUTING reply reuses the exact envelope', async () => {
  const server = await createFakeService()
  let attempts = 0
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (req, res, body) => {
    attempts += 1
    if (attempts === 1) {
      json(res, 409, {
        ok: false,
        code: 'OPERATION_EXECUTING',
        message: 'The operation is already executing.',
        retry_same_operation: true
      })
      return
    }
    json(res, 200, committedBody(body.operation_id, { replayed: true }))
  })
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.command({
        command: 'sale.commit',
        payload: { total_cents: 12550 },
        operation_id: OP_EXECUTING
      }),
      (error) => error.code === 'OPERATION_EXECUTING'
        && error.retrySameOperation === true
        && error.operationId === OP_EXECUTING
    )
    assert.equal(harness.journal.get(OP_EXECUTING).state, 'outcome_unknown')

    const result = await harness.client.retryOperation(OP_EXECUTING)
    assert.equal(result.ok, true)
    assert.equal(result.receipt.operation_id, OP_EXECUTING)

    const commandRequests = server.requests.filter((request) => request.path === '/v1/commands')
    assert.equal(commandRequests.length, 2)
    assert.equal(commandRequests[0].body.operation_id, commandRequests[1].body.operation_id)
    assert.equal(JSON.stringify(commandRequests[0].body), JSON.stringify(commandRequests[1].body))
    assert.equal(commandRequests[0].headers.authorization, `Bearer ${SESSION_TOKEN}`)
    assert.equal(commandRequests[0].headers['x-bar-device-id'], DEVICE_ID)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('a timeout leaves the operation open and reconciles through getOperation', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (req, res, body) => {
    if (body.operation_id === OP_TIMEOUT) return
    json(res, 200, committedBody(body.operation_id))
  })
  server.route('GET', `/v1/operations/${OP_TIMEOUT}`, (req, res) => json(res, 200, {
    ok: true,
    operation_id: OP_TIMEOUT,
    status: 'committed',
    outcome: 'committed_local',
    authority_id: AUTHORITY_ID,
    receipt: receiptFor(OP_TIMEOUT, 77),
    result: { order_id: '00000000-0000-4000-8000-000000000002' },
    commit_sequence: 77,
    business_date: '2026-10-20'
  }))
  const harness = makeClient(server, { request_timeout_ms: 300 })
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.command({
        command: 'sale.commit',
        payload: { total_cents: 900 },
        operation_id: OP_TIMEOUT
      }),
      (error) => error.code === 'UNKNOWN_OUTCOME'
        && error.retrySameOperation === true
        && error.outcomeUnknown === true
        && error.operationId === OP_TIMEOUT
    )
    assert.equal(harness.journal.get(OP_TIMEOUT).state, 'outcome_unknown')
    await assert.rejects(harness.client.command({ command: 'sale.commit', payload: { total_cents: 901 }, operation_id: OP_CONFLICT }),
      (error) => error.code === 'UNRESOLVED_OPERATION' && error.operationId === OP_TIMEOUT && error.retrySameOperation === true)
    assert.equal(server.requests.filter((request) => request.path === '/v1/commands').length, 1)

    const status = await harness.client.getOperation(OP_TIMEOUT)
    assert.equal(status.status, 'committed')
    assert.equal(status.receipt.commit_sequence, 77)
    assert.equal(harness.journal.get(OP_TIMEOUT).state, 'committed_local')

    const replay = await harness.client.retryOperation(OP_TIMEOUT)
    assert.equal(replay.ok, true)
    assert.equal(replay.from_journal, true)
    const commandRequests = server.requests.filter((request) => request.path === '/v1/commands')
    assert.deepEqual(commandRequests.map((request) => request.body.operation_id), [OP_TIMEOUT])
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('reusing an operation id with a changed payload is rejected before dispatch', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (req, res, body) => json(res, 200, committedBody(body.operation_id)))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const first = await harness.client.command({
      command: 'sale.commit',
      payload: { total_cents: 100 },
      operation_id: OP_CONFLICT
    })
    assert.equal(first.ok, true)
    await assert.rejects(
      harness.client.command({
        command: 'sale.commit',
        payload: { total_cents: 999 },
        operation_id: OP_CONFLICT
      }),
      (error) => error.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT' && error.operationId === OP_CONFLICT
    )
    const commandRequests = server.requests.filter((request) => request.path === '/v1/commands')
    assert.equal(commandRequests.length, 1)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('terminal refusals are journaled and replayed without redispatch', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/commands', (req, res) => json(res, 422, {
    ok: false,
    code: 'INSUFFICIENT_STOCK',
    message: 'The product has insufficient stock.',
    retry_same_operation: false,
    requires_manager: true
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const refused = await harness.client.command({
      command: 'sale.commit',
      payload: { total_cents: 100 },
      operation_id: OP_REFUSED
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.outcome, 'refused')
    assert.equal(refused.error.code, 'INSUFFICIENT_STOCK')
    assert.equal(refused.error.requires_manager, true)
    assert.equal(harness.journal.get(OP_REFUSED).state, 'terminal_refusal')

    const replay = await harness.client.command({
      command: 'sale.commit',
      payload: { total_cents: 100 },
      operation_id: OP_REFUSED
    })
    assert.equal(replay.from_journal, true)
    assert.equal(replay.outcome, 'refused')
    const commandRequests = server.requests.filter((request) => request.path === '/v1/commands')
    assert.equal(commandRequests.length, 1)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('commands require a durable journal file before dispatch', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  const harness = makeClient(server, { journal: openIntentJournal() })
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.command({
        command: 'sale.commit',
        payload: { total_cents: 100 },
        operation_id: newOperationId()
      }),
      (error) => error.code === 'RECOVERY_REQUIRED'
    )
    assert.equal(server.requests.filter((request) => request.path === '/v1/commands').length, 0)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('intent journal recovers a torn tail and refuses interior corruption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bar-local-journal-'))
  try {
    const file = join(dir, 'intents.jsonl')
    const journal = openIntentJournal({ filePath: file })
    journal.createIntent(envelopeFor(OP_CONFLICT))
    journal.markSending(OP_CONFLICT)
    journal.markCommitted(OP_CONFLICT, receiptFor(OP_CONFLICT), { order_id: null })

    const repeated = journal.createIntent(envelopeFor(OP_CONFLICT))
    assert.equal(repeated.state, 'committed_local')
    assert.equal(repeated.revision, 3)
    assert.throws(
      () => journal.createIntent(envelopeFor(OP_CONFLICT, { total_cents: 999 })),
      (error) => error.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT'
    )
    journal.close()

    appendFileSync(file, '{"version":1,"operation_id":"tr')
    const recovered = openIntentJournal({ filePath: file })
    assert.equal(recovered.size, 1)
    assert.equal(recovered.recovery.repaired, true)
    assert.ok(recovered.recovery.torn_tail_bytes > 0)
    assert.equal(recovered.get(OP_CONFLICT).state, 'committed_local')
    recovered.close()

    appendFileSync(file, '{"version":1,"broken":true}\n')
    assert.throws(
      () => openIntentJournal({ filePath: file }),
      (error) => error.code === 'INTENT_JOURNAL_CORRUPT'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('commissioning and pairing store the device credential without exposing it', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/setup/owner', (req, res) => json(res, 201, {
    ok: true,
    outcome: 'commissioned',
    device_id: DEVICE_ID,
    device_token: DEVICE_TOKEN,
    authority_epoch: 1,
    business_id: BUSINESS_ID,
    outlet_id: OUTLET_ID
  }))
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/pairing/start', (req, res) => json(res, 200, {
    ok: true,
    pairing_code: 'PAIR-1234',
    expires_at: '2026-10-20T10:05:00.000Z'
  }))
  server.route('POST', '/v1/pairing/complete', (req, res) => json(res, 200, {
    ok: true,
    outcome: 'paired',
    device_id: DEVICE_ID,
    device_token: DEVICE_TOKEN,
    server_certificate_fingerprint: null
  }))
  const harness = makeClient(server, { credential_store: createMemoryDeviceCredentialStore(null) })
  try {
    const commissioned = await harness.client.setupOwner({
      provisioning_id: '77777777-7777-4777-8777-777777777777',
      device_token: DEVICE_TOKEN,
      business_name: 'Test Lodge',
      owner_name: 'Test Owner',
      owner_pin: '2468'
    })
    assert.equal(commissioned.outcome, 'commissioned')
    assert.equal(commissioned.device_token, undefined)
    assert.equal((await harness.credential_store.load()).device_token, DEVICE_TOKEN)

    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const pairing = await harness.client.startPairing({ label: 'Bar till' })
    assert.equal(pairing.pairing_code, 'PAIR-1234')

    const paired = await harness.client.completePairing({
      provisioning_id: '78787878-7878-4787-8787-787878787878',
      device_token: 'pair-device-token-secret-1234567890',
      pairing_code: 'PAIR-1234'
    })
    assert.equal(paired.outcome, 'paired')
    assert.equal(paired.device_token, undefined)
    const startRequest = server.requests.find((request) => request.path === '/v1/pairing/start')
    assert.equal(startRequest.headers.authorization, `Bearer ${SESSION_TOKEN}`)
    assert.equal(startRequest.headers['x-bar-device-id'], DEVICE_ID)
    const ownerRequest = server.requests.find((request) => request.path === '/v1/setup/owner')
    assert.equal(ownerRequest.body.provisioning_id, '77777777-7777-4777-8777-777777777777')
    assert.equal(ownerRequest.body.device_token, DEVICE_TOKEN)
    const pairingRequest = server.requests.find((request) => request.path === '/v1/pairing/complete')
    assert.equal(pairingRequest.body.provisioning_id, '78787878-7878-4787-8787-787878787878')
    assert.equal(pairingRequest.body.device_token, 'pair-device-token-secret-1234567890')
    assert.equal((await harness.credential_store.load()).device_token, 'pair-device-token-secret-1234567890')
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue pages assemble into one atomic snapshot with stale cart detection', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/queries/menu.availability', (req, res, body) => {
    const cursor = body.filters.cursor ?? null
    if (cursor === null) {
      json(res, 200, {
        ...cataloguePage(),
        data: [productFixture(PRODUCT_A)],
        pagination: { next_cursor: 'page-2', has_more: true },
        snapshot_watermark: 7
      })
      return
    }
    json(res, 200, {
      ...cataloguePage(),
      data: [productFixture(PRODUCT_B, { available: false })],
      pagination: { next_cursor: null, has_more: false },
      snapshot_watermark: 7
    })
  })
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const snapshot = await harness.client.fetchCatalogueSnapshot({ page_size: 50 })
    assert.equal(snapshot.complete, true)
    assert.equal(snapshot.page_count, 2)
    assert.deepEqual(snapshot.product_ids, [PRODUCT_A, PRODUCT_B])
    assert.deepEqual(snapshot.available_product_ids, [PRODUCT_A])
    assert.deepEqual(snapshot.unavailable_product_ids, [PRODUCT_B])
    assert.equal(snapshot.snapshot_watermark, 7)
    assert.match(snapshot.hash, /^[0-9a-f]{64}$/)

    const queryRequests = server.requests.filter((request) => request.path === '/v1/queries/menu.availability')
    assert.equal(queryRequests.length, 2)
    assert.equal(queryRequests[0].body.filters.limit, 50)
    assert.equal(queryRequests[0].body.filters.cursor, undefined)
    assert.equal(queryRequests[1].body.filters.cursor, 'page-2')

    const freshCart = await harness.client.checkCart({
      catalogue_version: null,
      items: [{ product_id: PRODUCT_A, version: 3, unit_price: '125.50' }]
    }, snapshot)
    assert.equal(freshCart.stale, false)

    const staleCart = await harness.client.checkCart({
      catalogue_version: null,
      items: [
        { product_id: PRODUCT_A, version: 3, unit_price: '999.00' },
        { product_id: PRODUCT_MISSING }
      ]
    }, snapshot)
    assert.equal(staleCart.stale, true)
    assert.equal(staleCart.requires_repricing, true)
    assert.ok(staleCart.reasons.includes('price_changed'))
    assert.ok(staleCart.reasons.includes('product_deleted'))
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue assembly fails closed on gaps, drift, truncation and duplicates', async () => {
  await assert.rejects(
    loadCatalogueSnapshot(async () => cataloguePage({ complete: false })),
    (error) => error.code === 'CATALOGUE_INCOMPLETE'
  )
  await assert.rejects(
    loadCatalogueSnapshot(async () => cataloguePage({ unavailable: ['price_lists'] })),
    (error) => error.code === 'CATALOGUE_INCOMPLETE'
  )
  await assert.rejects(
    loadCatalogueSnapshot(async () => cataloguePage({ pagination: { next_cursor: null, has_more: true } })),
    (error) => error.code === 'CATALOGUE_PAGINATION_INVALID'
  )
  await assert.rejects(
    loadCatalogueSnapshot(async () => cataloguePage({ pagination: { next_cursor: 'page-2', has_more: true }, data: [] })),
    (error) => error.code === 'CATALOGUE_PAGINATION_INVALID'
  )

  const drifted = [
    cataloguePage({ data: [productFixture(PRODUCT_A)], pagination: { next_cursor: 'page-2', has_more: true }, snapshot_watermark: 1 }),
    cataloguePage({ data: [productFixture(PRODUCT_B)], snapshot_watermark: 2 })
  ]
  let driftCall = 0
  await assert.rejects(
    loadCatalogueSnapshot(async () => drifted[driftCall++]),
    (error) => error.code === 'CATALOGUE_SNAPSHOT_CHANGED'
  )

  const duplicated = [
    cataloguePage({ data: [productFixture(PRODUCT_A)], pagination: { next_cursor: 'page-2', has_more: true } }),
    cataloguePage({ data: [productFixture(PRODUCT_A)] })
  ]
  let duplicateCall = 0
  await assert.rejects(
    loadCatalogueSnapshot(async () => duplicated[duplicateCall++]),
    (error) => error.code === 'CATALOGUE_DUPLICATE_PRODUCT'
  )

  assert.throws(
    () => buildCatalogueSnapshot([{
      data: [productFixture(PRODUCT_A)],
      pagination: { next_cursor: 'page-2', has_more: true },
      snapshot_watermark: 1,
      scope: QUERY_SCOPE,
      as_of: '2026-10-20T10:00:00.000Z',
      complete: true,
      unavailable: []
    }]),
    (error) => error.code === 'CATALOGUE_PAGINATION_INVALID'
  )

  const empty = await loadCatalogueSnapshot(async () => cataloguePage())
  assert.equal(empty.empty, true)
  assert.equal(empty.complete, true)
  assert.deepEqual(empty.product_ids, [])

  const deletedSnapshot = buildCatalogueSnapshot(
    [{
      data: [productFixture(PRODUCT_B)],
      pagination: { next_cursor: null, has_more: false },
      snapshot_watermark: 2,
      scope: QUERY_SCOPE,
      as_of: '2026-10-20T10:00:00.000Z',
      complete: true,
      unavailable: []
    }],
    {
      previous_snapshot: buildCatalogueSnapshot([{
        data: [productFixture(PRODUCT_A), productFixture(PRODUCT_B)],
        pagination: { next_cursor: null, has_more: false },
        snapshot_watermark: 1,
        scope: QUERY_SCOPE,
        as_of: '2026-10-20T09:00:00.000Z',
        complete: true,
        unavailable: []
      }])
    }
  )
  assert.deepEqual(deletedSnapshot.deleted_product_ids, [PRODUCT_A])

  const check = checkCartAgainstSnapshot(
    { catalogue_version: null, items: [{ product_id: PRODUCT_A }] },
    deletedSnapshot
  )
  assert.equal(check.stale, true)
  assert.ok(check.reasons.includes('product_deleted'))
})

test('the modern client allowlist includes the new local Bar command names', () => {
  const addedCommands = [
    'catalogue.modifier_group.upsert',
    'catalogue.modifier_option.upsert',
    'catalogue.product_modifier.set',
    'catalogue.recipe.set',
    'promotion.upsert',
    'loyalty.program.upsert',
    'loyalty.account.enrol',
    'loyalty.points.earn',
    'loyalty.points.redeem',
    'loyalty.points.adjust',
    'workforce.tip.allocate',
    'workforce.tip.payout',
    'workforce.tip.payout.reverse',
    'support.report.create',
    'export.bundle.create',
    'accounting.ap.invoice.upsert',
    'accounting.ap.invoice.approve',
    'accounting.ap.payment.post',
    'accounting.ap.payment.reverse',
    'accounting.bank_account.upsert',
    'accounting.bank_statement.import',
    'accounting.bank.reconcile',
    'accounting.tax_code.upsert',
    'accounting.tax_return.prepare',
    'accounting.payroll_run.create',
    'accounting.payroll_run.prepare',
    'accounting.payroll_run.finalise',
    'accounting.budget.upsert'
  ]
  for (const command of addedCommands) {
    assert.equal(ALLOWED_COMMANDS.has(command), true, `${command} must be registered for local Bar authority`)
  }
  assert.equal(ALLOWED_COMMANDS.has('catalogue.recipe.delete'), false)
  assert.equal(ALLOWED_COMMANDS.has('accounting.payroll_run.delete'), false)
})

test('report queries are allowlisted and dispatched through the local query contract', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/queries/reports.stock', (req, res) => json(res, 200, {
    ok: true,
    data: [{ sku: 'SKU-A', quantity: '4.000000' }],
    pagination: { next_cursor: null, has_more: false },
    snapshot_watermark: 9,
    scope: QUERY_SCOPE,
    as_of: '2026-10-20T10:00:00.000Z',
    complete: true,
    unavailable: []
  }))
  const harness = makeClient(server)
  try {
    assert.equal(ALLOWED_QUERIES.has('reports.stock'), true)
    assert.equal(ALLOWED_QUERIES.has('reports.cashup'), true)
    assert.equal(ALLOWED_QUERIES.has('outbox.bundle.get'), true)
    assert.equal(ALLOWED_QUERIES.has('loyalty.account.get'), true)
    assert.equal(ALLOWED_QUERIES.has('reports.unknown'), false)

    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const result = await harness.client.query('reports.stock', {})
    assert.equal(result.complete, true)
    assert.deepEqual(result.data, [{ sku: 'SKU-A', quantity: '4.000000' }])
    const request = server.requests.find((entry) => entry.path === '/v1/queries/reports.stock')
    assert.ok(request)
    assert.equal(request.body.query, 'reports.stock')

    await assert.rejects(
      harness.client.query('reports.unknown', {}),
      (error) => error.code === 'QUERY_NOT_REGISTERED'
    )
    assert.equal(server.requests.filter((entry) => entry.path === '/v1/queries/reports.unknown').length, 0)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('local menu promotions and modifier queries are allowlisted for the renderer', () => {
  assert.equal(ALLOWED_QUERIES.has('menu.promotions'), true)
  assert.equal(ALLOWED_QUERIES.has('menu.modifiers'), true)
})

test('administration calls use the authenticated local contract and validate destructive input', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/admin/status', (req, res) => json(res, 200, {
    ok: true,
    authority_id: AUTHORITY_ID,
    authority_epoch: 1,
    scope: QUERY_SCOPE,
    role: 'single_host',
    commit_sequence: 12
  }))
  server.route('GET', '/v1/admin/backup', (req, res) => json(res, 200, {
    ok: true,
    backups: [{ file_name: 'bar-2026-10-20.dump', created_at: '2026-10-20T10:00:00.000Z', size_bytes: 4096, verified: false }]
  }))
  server.route('POST', '/v1/admin/backup', (req, res, body) => json(res, 201, { ok: true, outcome: 'backup_created', label: body.label ?? null }))
  server.route('POST', '/v1/admin/backup/verify', (req, res, body) => json(res, 200, { ok: true, file_name: body.file_name, verified: true }))
  server.route('GET', '/v1/admin/replication', (req, res) => json(res, 200, { ok: true, role: 'single_host', durability: 'full', status: 'healthy' }))
  server.route('POST', '/v1/admin/replication/durability', (req, res, body) => json(res, 200, { ok: true, durability: body.profile }))
  server.route('POST', '/v1/admin/replication/switchover', (req, res, body) => json(res, 200, { ok: true, outcome: 'switchover_accepted', reason: body.reason }))
  server.route('GET', '/v1/admin/update', (req, res) => json(res, 200, { ok: true, current_version: '1.4.0', status: 'up_to_date' }))
  server.route('POST', '/v1/admin/update/stage', (req, res, body) => json(res, 200, { ok: true, command: 'update-stage', status: 'staged', package: body.package }))
  server.route('POST', '/v1/admin/update/apply', (req, res, body) => json(res, 200, { ok: true, command: 'update-apply', authorized_by: body.authorized_by }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })

    const status = await harness.client.adminStatus()
    assert.equal(status.role, 'single_host')
    assert.equal(status.commit_sequence, 12)
    const statusRequest = server.requests.find((entry) => entry.path === '/v1/admin/status')
    assert.equal(statusRequest.method, 'GET')
    assert.equal(statusRequest.headers.authorization, `Bearer ${SESSION_TOKEN}`)
    assert.equal(statusRequest.headers['x-bar-device-id'], DEVICE_ID)

    const backup = await harness.client.adminRunBackup({ label: 'shift close' })
    assert.equal(backup.label, 'shift close')
    const backupRequest = server.requests.find((entry) => entry.method === 'POST' && entry.path === '/v1/admin/backup')
    assert.equal(backupRequest.body.label, 'shift close')
    assert.equal(backupRequest.headers.authorization, `Bearer ${SESSION_TOKEN}`)

    const verified = await harness.client.adminVerifyBackup({ file_name: 'bar-2026-10-20.dump' })
    assert.equal(verified.verified, true)
    const verifyRequest = server.requests.find((entry) => entry.path === '/v1/admin/backup/verify')
    assert.deepEqual(verifyRequest.body, { file_name: 'bar-2026-10-20.dump' })

    const durability = await harness.client.adminSetDurability({ profile: 'full' })
    assert.equal(durability.durability, 'full')
    const durabilityRequest = server.requests.find((entry) => entry.path === '/v1/admin/replication/durability')
    assert.deepEqual(durabilityRequest.body, { profile: 'full' })

    const switched = await harness.client.adminSwitchover({ confirm: 'SWITCHOVER', reason: 'Primary host maintenance' })
    assert.equal(switched.outcome, 'switchover_accepted')
    const switchRequest = server.requests.find((entry) => entry.path === '/v1/admin/replication/switchover')
    assert.deepEqual(switchRequest.body, { confirm: 'SWITCHOVER', reason: 'Primary host maintenance' })

    const update = await harness.client.adminUpdateStatus()
    assert.equal(update.current_version, '1.4.0')

    const staged = await harness.client.adminStageUpdate({ package: 'bar-local-release-1.5.0', confirm: 'STAGE_UPDATE' })
    assert.equal(staged.status, 'staged')
    const stageRequest = server.requests.find((entry) => entry.path === '/v1/admin/update/stage')
    assert.deepEqual(stageRequest.body, { package: 'bar-local-release-1.5.0', confirm: 'STAGE_UPDATE' })

    const applied = await harness.client.adminApplyUpdate({ confirm: 'APPLY_UPDATE', authorized_by: 'Owner', reason: 'Apply verified release' })
    assert.equal(applied.command, 'update-apply')
    const applyRequest = server.requests.find((entry) => entry.path === '/v1/admin/update/apply')
    assert.deepEqual(applyRequest.body, { confirm: 'APPLY_UPDATE', authorized_by: 'Owner', reason: 'Apply verified release' })

    await assert.rejects(
      harness.client.adminSetDurability({}),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    await assert.rejects(
      harness.client.adminVerifyBackup({}),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    await assert.rejects(
      harness.client.adminSwitchover({ confirm: 'yes', reason: 'Primary host maintenance' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    await assert.rejects(
      harness.client.adminSwitchover({ confirm: 'SWITCHOVER', reason: '' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    await assert.rejects(
      harness.client.adminStageUpdate({ package: '../outside', confirm: 'STAGE_UPDATE' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    await assert.rejects(
      harness.client.adminApplyUpdate({ confirm: 'APPLY_UPDATE', authorized_by: 'Owner', reason: 'short' }),
      (error) => error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED'
    )
    assert.equal(server.requests.filter((entry) => entry.path === '/v1/admin/replication/switchover').length, 1)
    assert.equal(server.requests.filter((entry) => entry.path === '/v1/admin/replication/durability').length, 1)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('administration responses from another local scope fail closed', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/admin/status', (req, res) => json(res, 200, {
    ok: true,
    data: {
      authority_id: AUTHORITY_ID,
      authority_epoch: 1,
      scope: { ...QUERY_SCOPE, outlet_id: '99999999-9999-4999-8999-999999999990' }
    }
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.adminStatus(),
      (error) => error instanceof BarLocalAdapterError && error.code === 'OUTLET_SCOPE_MISMATCH'
    )
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('modifier-aware catalogue snapshots validate options and selection bounds', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/queries/menu.availability', (req, res) => json(res, 200, {
    ...cataloguePage(),
    snapshot_watermark: 11,
    data: [
      productFixture(PRODUCT_A, {
        modifier_groups: [
          modifierGroupFixture(GROUP_SIZE, [
            modifierOptionFixture(OPTION_LARGE, GROUP_SIZE, { code: 'LARGE', name: 'Large', price_delta: '3.00' }),
            modifierOptionFixture(OPTION_SMALL, GROUP_SIZE, { code: 'SMALL', name: 'Small' })
          ], { code: 'SIZE', name: 'Size', min_selections: 1, max_selections: 1 })
        ]
      }),
      productFixture(PRODUCT_B, {
        modifier_groups: [
          modifierGroupFixture(GROUP_TOPPINGS, [
            modifierOptionFixture(OPTION_CHEESE, GROUP_TOPPINGS, { code: 'CHEESE', name: 'Cheese' }),
            modifierOptionFixture(OPTION_BACON, GROUP_TOPPINGS, { code: 'BACON', name: 'Bacon' }),
            modifierOptionFixture(OPTION_ONION, GROUP_TOPPINGS, { code: 'ONION', name: 'Onion', active: false }),
            modifierOptionFixture(OPTION_OLIVES, GROUP_TOPPINGS, { code: 'OLIVES', name: 'Olives' })
          ], { code: 'TOPPINGS', name: 'Toppings', min_selections: 2, max_selections: 2 })
        ]
      })
    ]
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const snapshot = await harness.client.fetchCatalogueSnapshot()
    assert.deepEqual(snapshot.modifier_group_ids, [GROUP_SIZE, GROUP_TOPPINGS])
    assert.deepEqual(snapshot.modifier_option_ids, [
      OPTION_LARGE, OPTION_SMALL, OPTION_CHEESE, OPTION_BACON, OPTION_ONION, OPTION_OLIVES
    ])
    assert.deepEqual(snapshot.by_id[PRODUCT_A].modifier_group_ids, [GROUP_SIZE])
    assert.equal(snapshot.modifier_options_by_id[OPTION_LARGE].price_delta, '3.00')
    assert.equal(snapshot.modifier_groups_by_id[GROUP_TOPPINGS].min_selections, 2)

    const cartFor = (productId, modifiers) => ({
      catalogue_version: null,
      items: [{ product_id: productId, modifiers }]
    })

    const missingRequired = await harness.client.checkCart(cartFor(PRODUCT_A, []), snapshot)
    assert.equal(missingRequired.stale, true)
    assert.ok(missingRequired.reasons.includes('modifier_required'))

    const freshA = await harness.client.checkCart(cartFor(PRODUCT_A, [OPTION_LARGE]), snapshot)
    assert.equal(freshA.stale, false)

    const unknown = await harness.client.checkCart(cartFor(PRODUCT_A, [OPTION_UNKNOWN]), snapshot)
    assert.equal(unknown.stale, true)
    assert.ok(unknown.reasons.includes('modifier_unknown'))

    const wrongProduct = await harness.client.checkCart(cartFor(PRODUCT_A, [OPTION_CHEESE]), snapshot)
    assert.equal(wrongProduct.stale, true)
    assert.ok(wrongProduct.reasons.includes('modifier_not_for_product'))

    const tooMany = await harness.client.checkCart(cartFor(PRODUCT_A, [OPTION_LARGE, OPTION_SMALL]), snapshot)
    assert.equal(tooMany.stale, true)
    assert.ok(tooMany.reasons.includes('modifier_max_selections'))

    const belowMinimum = await harness.client.checkCart(cartFor(PRODUCT_B, [OPTION_CHEESE]), snapshot)
    assert.equal(belowMinimum.stale, true)
    assert.ok(belowMinimum.reasons.includes('modifier_min_selections'))

    const unavailable = await harness.client.checkCart(cartFor(PRODUCT_B, [OPTION_ONION]), snapshot)
    assert.equal(unavailable.stale, true)
    assert.ok(unavailable.reasons.includes('modifier_unavailable'))

    const freshB = await harness.client.checkCart(cartFor(PRODUCT_B, [OPTION_CHEESE, OPTION_BACON]), snapshot)
    assert.equal(freshB.stale, false)

    const exceeded = await harness.client.checkCart(cartFor(PRODUCT_B, [OPTION_CHEESE, OPTION_BACON, OPTION_OLIVES]), snapshot)
    assert.equal(exceeded.stale, true)
    assert.ok(exceeded.reasons.includes('modifier_max_selections'))
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('event feed gaps leave the cursor in place until an explicit resync', async () => {
  const server = await createFakeService()
  let gap = false
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/events', (req, res) => {
    if (gap) {
      json(res, 200, {
        ok: true,
        events: [],
        event_count: 0,
        next_cursor: 10,
        latest_commit_sequence: 10,
        latest_event_sequence: 10,
        retention_floor_sequence: 3,
        gap_detected: true,
        complete: true,
        scope: QUERY_SCOPE
      })
      return
    }
    json(res, 200, {
      ok: true,
      events: [],
      event_count: 0,
      next_cursor: 5,
      latest_commit_sequence: 5,
      latest_event_sequence: 5,
      retention_floor_sequence: 0,
      gap_detected: false,
      complete: true,
      scope: QUERY_SCOPE
    })
  })
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const first = await harness.client.pollEvents()
    assert.equal(first.cursor, 5)
    assert.equal(first.resync_required, false)

    gap = true
    const second = await harness.client.pollEvents()
    assert.equal(second.cursor, 5)
    assert.equal(second.resync_required, true)
    assert.equal(second.retention_floor_sequence, 3)
    assert.equal(harness.client.eventCursor, 5)

    harness.client.resetEventCursor(10)
    assert.equal(harness.client.eventCursor, 10)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue events invalidate a cached snapshot while unrelated events do not', async () => {
  const server = await createFakeService()
  let catalogueChanged = false
  let feed = {
    ok: true,
    events: [],
    event_count: 0,
    next_cursor: 0,
    latest_commit_sequence: 0,
    latest_event_sequence: 0,
    retention_floor_sequence: null,
    gap_detected: false,
    complete: true,
    scope: QUERY_SCOPE
  }
  const eventFor = (commitSequence, eventType) => ({
    commit_sequence: commitSequence,
    event_index: 0,
    event_type: eventType,
    operation_id: OP_EXECUTING,
    payload: {},
    payload_hash: '0'.repeat(64),
    created_at: '2026-10-20T10:00:00.000Z'
  })
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/events', (req, res) => json(res, 200, feed))
  server.route('POST', '/v1/queries/menu.availability', (req, res) => json(res, 200, {
    ...cataloguePage(),
    data: [catalogueChanged ? productFixture(PRODUCT_B) : productFixture(PRODUCT_A)],
    snapshot_watermark: catalogueChanged ? 14 : 12
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const initial = await harness.client.refreshCatalogueSnapshot()
    assert.equal(initial.reused, false)
    assert.equal(initial.resync_required, false)
    assert.deepEqual(initial.snapshot.product_ids, [PRODUCT_A])
    assert.equal(harness.client.catalogueStatus().invalidated, false)

    feed = {
      ...feed,
      events: [eventFor(13, 'sale.committed')],
      event_count: 1,
      next_cursor: 13,
      latest_commit_sequence: 13,
      latest_event_sequence: 13
    }
    const unrelated = await harness.client.pollEvents()
    assert.equal(unrelated.cursor, 13)
    assert.equal(unrelated.resync_required, false)
    assert.equal(unrelated.catalogue_invalidated, false)
    const cached = await harness.client.refreshCatalogueSnapshot()
    assert.equal(cached.reused, true)
    assert.deepEqual(cached.snapshot.product_ids, [PRODUCT_A])
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 1)

    catalogueChanged = true
    feed = {
      ...feed,
      events: [eventFor(14, 'promotion.upsert')],
      event_count: 1,
      next_cursor: 14,
      latest_commit_sequence: 14,
      latest_event_sequence: 14
    }
    const invalidated = await harness.client.pollEvents()
    assert.equal(invalidated.cursor, 14)
    assert.equal(invalidated.catalogue_invalidated, true)
    assert.equal(harness.client.catalogueStatus().invalidated, true)
    assert.equal(harness.client.catalogueStatus().invalidation.event_type, 'promotion.upsert')

    const refreshed = await harness.client.refreshCatalogueSnapshot()
    assert.equal(refreshed.reused, false)
    assert.deepEqual(refreshed.snapshot.product_ids, [PRODUCT_B])
    assert.equal(refreshed.snapshot.snapshot_watermark, 14)
    assert.equal(refreshed.catalogue_invalidated, false)
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 2)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue refresh fails closed on an event retention gap until the cursor is explicitly reset', async () => {
  const server = await createFakeService()
  let gap = false
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/events', (req, res) => {
    if (gap) {
      json(res, 200, {
        ok: true,
        events: [],
        event_count: 0,
        next_cursor: 10,
        latest_commit_sequence: 10,
        latest_event_sequence: 10,
        retention_floor_sequence: 3,
        gap_detected: true,
        complete: true,
        scope: QUERY_SCOPE
      })
      return
    }
    json(res, 200, {
      ok: true,
      events: [],
      event_count: 0,
      next_cursor: 5,
      latest_commit_sequence: 5,
      latest_event_sequence: 5,
      retention_floor_sequence: null,
      gap_detected: false,
      complete: true,
      scope: QUERY_SCOPE
    })
  })
  server.route('POST', '/v1/queries/menu.availability', (req, res) => json(res, 200, {
    ...cataloguePage(),
    data: [productFixture(PRODUCT_A)],
    snapshot_watermark: 10
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const first = await harness.client.pollEvents()
    assert.equal(first.cursor, 5)
    assert.equal(first.resync_required, false)

    gap = true
    const lost = await harness.client.pollEvents()
    assert.equal(lost.cursor, 5)
    assert.equal(lost.resync_required, true)
    assert.equal(lost.catalogue_invalidated, true)
    assert.equal(harness.client.catalogueStatus().retention_floor_sequence, 3)

    await assert.rejects(
      harness.client.refreshCatalogueSnapshot(),
      (error) => error.code === 'CATALOGUE_RESYNC_REQUIRED'
        && error.details.resync_required === true
        && error.details.retention_floor_sequence === 3
        && error.details.event_cursor === 5
    )
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 0)

    harness.client.resetEventCursor(10)
    const afterReset = harness.client.catalogueStatus()
    assert.equal(afterReset.resync_required, false)
    assert.equal(afterReset.invalidated, true)

    gap = false
    const recovered = await harness.client.refreshCatalogueSnapshot()
    assert.equal(recovered.reused, false)
    assert.equal(recovered.snapshot.snapshot_watermark, 10)
    assert.equal(recovered.catalogue_invalidated, false)
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 1)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue refresh coalesces concurrent callers, reuses unchanged snapshots and stays bounded', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('POST', '/v1/queries/menu.availability', (req, res) => {
    setTimeout(() => json(res, 200, {
      ...cataloguePage(),
      data: [productFixture(PRODUCT_A)],
      snapshot_watermark: 21
    }), 25)
  })
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    const [first, second] = await Promise.all([
      harness.client.refreshCatalogueSnapshot(),
      harness.client.refreshCatalogueSnapshot()
    ])
    assert.equal(first.reused, false)
    assert.equal(second.reused, false)
    assert.equal(first.snapshot, second.snapshot)
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 1)

    const cached = await harness.client.refreshCatalogueSnapshot()
    assert.equal(cached.reused, true)
    assert.equal(cached.snapshot, first.snapshot)
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 1)

    await assert.rejects(
      harness.client.refreshCatalogueSnapshot({ max_pages: MAX_CATALOGUE_REFRESH_PAGES + 1 }),
      (error) => error.code === 'VALIDATION_FAILED'
    )
    assert.equal(server.requests.filter((request) => request.path === '/v1/queries/menu.availability').length, 1)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('catalogue refresh and event polling reject responses from another scope', async () => {
  const server = await createFakeService()
  server.route('POST', '/v1/sessions', (req, res) => json(res, 200, sessionPayload()))
  server.route('GET', '/v1/events', (req, res) => json(res, 200, {
    ok: true,
    events: [],
    event_count: 0,
    next_cursor: 1,
    latest_commit_sequence: 1,
    latest_event_sequence: 1,
    retention_floor_sequence: null,
    gap_detected: false,
    complete: true,
    scope: { ...QUERY_SCOPE, outlet_id: PRODUCT_A }
  }))
  server.route('POST', '/v1/queries/menu.availability', (req, res) => json(res, 200, {
    ...cataloguePage(),
    data: [productFixture(PRODUCT_A)],
    scope: { ...QUERY_SCOPE, device_id: PRODUCT_B }
  }))
  const harness = makeClient(server)
  try {
    await harness.client.login({ staff_id: STAFF_ID, pin: '2468' })
    await assert.rejects(
      harness.client.pollEvents(),
      (error) => error.code === 'OUTLET_SCOPE_MISMATCH'
    )
    await assert.rejects(
      harness.client.refreshCatalogueSnapshot(),
      (error) => error.code === 'TENANT_SCOPE_MISMATCH'
    )
    assert.equal(harness.client.catalogueStatus().has_snapshot, false)
  } finally {
    harness.cleanup()
    await server.close()
  }
})

test('TLS pinning accepts the pinned fingerprint and rejects mismatches', async () => {
  const server = await createFakeService({ secure: true })
  server.route('GET', '/v1/health/live', (req, res) => json(res, 200, { ok: true, status: 'live' }))
  try {
    const pinned = createHttpTransport({
      base_url: server.base_url,
      certificate_fingerprint: TEST_FINGERPRINT,
      request_timeout_ms: 5000
    })
    try {
      const response = await pinned.get('/v1/health/live')
      assert.equal(response.status, 200)
      assert.equal(response.body.status, 'live')
    } finally {
      pinned.close()
    }

    const mismatched = createHttpTransport({
      base_url: server.base_url,
      certificate_fingerprint: 'aa'.repeat(32),
      request_timeout_ms: 5000
    })
    try {
      await assert.rejects(
        mismatched.get('/v1/health/live'),
        (error) => error instanceof BarLocalAdapterError && error.code === 'TLS_FINGERPRINT_MISMATCH'
      )
    } finally {
      mismatched.close()
    }
  } finally {
    await server.close()
  }
})

test('identity mapping fails closed for unmapped outlets and staff', () => {
  const mapping = createIdentityMapping({
    business_id: BUSINESS_ID,
    lodge_id: 'lodge-main',
    outlets: [{ lodge_outlet_id: 'OUTLET-A', local_outlet_id: OUTLET_ID }],
    staff: [{ lodge_staff_id: 'STAFF-1', local_staff_id: STAFF_ID }]
  })
  assert.equal(mapping.outletId('OUTLET-A'), OUTLET_ID)
  assert.equal(mapping.staffId('STAFF-1'), STAFF_ID)
  assert.equal(mapping.hasOutlet('OUTLET-A'), true)
  assert.equal(mapping.hasStaff('STAFF-2'), false)
  assert.deepEqual(mapping.localIds(), { outlet_ids: [OUTLET_ID], staff_ids: [STAFF_ID] })
  assert.throws(() => mapping.outletId('OUTLET-B'), (error) => error.code === 'OUTLET_SCOPE_MISMATCH')
  assert.throws(() => mapping.staffId('STAFF-9'), (error) => error.code === 'STAFF_NOT_FOUND')
  assert.throws(
    () => createIdentityMapping({
      business_id: BUSINESS_ID,
      outlets: [
        { lodge_outlet_id: 'OUTLET-A', local_outlet_id: OUTLET_ID },
        { lodge_outlet_id: 'OUTLET-A', local_outlet_id: PRODUCT_A }
      ]
    }),
    (error) => error.code === 'VALIDATION_FAILED'
  )
})
