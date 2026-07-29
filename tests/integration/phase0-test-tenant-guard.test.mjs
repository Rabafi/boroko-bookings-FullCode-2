import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertDisposableTarget,
  formatSafeTarget,
  isTestTenantOptedIn,
  loadTestEnv,
  readEnvFile,
  redactSecrets,
  requireResetConfirmation,
  resolveTestLodgeId,
  RESET_DATA_CONFIRMATION
} from './test-tenant-guard.mjs'
import { allFixtureRows, buildFixtureRows, FIXTURE_IDS } from './tenant-fixture.mjs'

const TEST_LODGE_ID = '11111111-1111-4111-8111-111111111111'
const SAFE_ENV = {
  BOROKO_TEST_TENANT: 'true',
  BOROKO_TEST_LODGE_ID: TEST_LODGE_ID,
  SUPABASE_URL: 'http://127.0.0.1:54321',
  NODE_ENV: 'test'
}

test('guard rejects the default opt-out and does not infer a lodge from application state', () => {
  assert.equal(isTestTenantOptedIn({ BOROKO_TEST_TENANT: 'false' }), false)
  assert.throws(
    () => assertDisposableTarget({ BOROKO_TEST_TENANT: 'false', SUPABASE_URL: SAFE_ENV.SUPABASE_URL }),
    /BOROKO_TEST_TENANT=true is required/,
  )
  assert.equal(resolveTestLodgeId({ BOROKO_TEST_TENANT: 'true', SUPABASE_URL: SAFE_ENV.SUPABASE_URL }), '')
})

test('guard accepts an opted-in local disposable target', () => {
  const target = assertDisposableTarget(SAFE_ENV)
  assert.equal(target.host, '127.0.0.1')
  assert.equal(target.lodgeId, TEST_LODGE_ID)
  assert.match(formatSafeTarget(target), /127\.0\.0\.1 \/ lodge 11111111…/)
})

test('guard rejects the configured production Supabase project even when opted in', () => {
  assert.throws(
    () => assertDisposableTarget({ ...SAFE_ENV, SUPABASE_URL: 'https://oicgpknsmtvcsjacymum.supabase.co' }),
    /known production backend/,
  )
})

test('guard rejects production targets supplied through explicit block lists', () => {
  assert.throws(
    () => assertDisposableTarget({
      ...SAFE_ENV,
      SUPABASE_URL: 'https://isolated-project.supabase.co',
      BOROKO_PRODUCTION_SUPABASE_URLS: 'https://isolated-project.supabase.co'
    }),
    /known production backend/,
  )
  assert.throws(
    () => assertDisposableTarget({
      ...SAFE_ENV,
      BOROKO_PRODUCTION_LODGE_IDS: TEST_LODGE_ID
    }),
    /listed as production/,
  )
})

test('guard rejects malformed lodge IDs and non-local HTTP targets', () => {
  assert.throws(
    () => assertDisposableTarget({ ...SAFE_ENV, BOROKO_TEST_LODGE_ID: 'lodge-1' }),
    /must be a UUID/,
  )
  assert.throws(
    () => assertDisposableTarget({ ...SAFE_ENV, SUPABASE_URL: 'http://remote.supabase.co' }),
    /must use HTTPS/,
  )
})

test('reset requires an explicit destructive confirmation phrase', () => {
  assert.throws(() => requireResetConfirmation({ env: {} }), /requires --confirm-reset/)
  assert.equal(requireResetConfirmation({ env: {}, confirmed: true }), RESET_DATA_CONFIRMATION)
  assert.equal(requireResetConfirmation({ env: { BOROKO_TEST_RESET_CONFIRMATION: RESET_DATA_CONFIRMATION } }), RESET_DATA_CONFIRMATION)
})

test('fixture rows are deterministic and every row is scoped to the requested lodge', () => {
  const fixture = buildFixtureRows(TEST_LODGE_ID)
  const rows = allFixtureRows(TEST_LODGE_ID)
  assert.equal(rows.length, 9)
  assert.equal(fixture.outlets[0].id, FIXTURE_IDS.foodOutlet)
  assert.equal(fixture.menuItems[1].inventory_item_id, FIXTURE_IDS.inventorySoda)
  for (const row of rows) {
    if ('lodge_id' in row) assert.equal(row.lodge_id, TEST_LODGE_ID)
  }
})

test('env file loading never overrides an explicit process environment value', () => {
  const tempFile = new URL('./fixtures/phase0-test.env', import.meta.url)
  // readEnvFile is tested against a missing file here; the CLI intentionally
  // does not create or mutate .env during integration setup.
  assert.deepEqual(readEnvFile(tempFile.pathname), {})
  const merged = loadTestEnv({ cwd: process.cwd(), envFile: '.env', env: { BOROKO_TEST_TENANT: 'true' } })
  assert.equal(merged.BOROKO_TEST_TENANT, 'true')
})

test('diagnostics redact credential-shaped values', () => {
  const safe = redactSecrets('Bearer abc.def.ghi service_role=super-secret password=hunter2')
  assert.doesNotMatch(safe, /super-secret|hunter2|Bearer abc/)
})
