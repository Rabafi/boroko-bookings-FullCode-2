import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../../services/bar-local/db/migrations/0043_loyalty_program_query.sql', import.meta.url)
const accountMigration = new URL('../../services/bar-local/db/migrations/0044_loyalty_account_balance_query.sql', import.meta.url)
const registry = new URL('../../packages/bar-contracts/src/registry.ts', import.meta.url)
const modern = new URL('../../src/main/bar-local/client.js', import.meta.url)
const legacy = new URL('../../legacy-pos/src/main/bar-local/client.js', import.meta.url)

test('loyalty programme read is scoped and capability checked in the local database contract', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /query_session\(p_token_hash, p_device_id, p_authority_id, p_authority_epoch\)/)
  assert.match(sql, /v_ctx\.capabilities @> ARRAY\['accounting\.manage'\].*v_ctx\.capabilities @> ARRAY\['settings\.manage'\]/s)
  assert.match(sql, /p\.business_id = v_ctx\.business_id/)
  assert.match(sql, /p\.outlet_id IS NULL OR p\.outlet_id = v_ctx\.outlet_id/)
  assert.match(sql, /loyalty\.programs\.list does not accept filters/)
  assert.match(sql, /SECURITY DEFINER/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION bar_local\.query_dispatch[\s\S]*TO bar_local_runtime/)
})

test('Modern and Legacy clients and the versioned registry allow only the loyalty programme query', async () => {
  const [contracts, modernClient, legacyClient] = await Promise.all([
    readFile(registry, 'utf8'), readFile(modern, 'utf8'), readFile(legacy, 'utf8')
  ])
  assert.match(contracts, /'loyalty\.programs\.list': \{ version: 1, capability: CAPABILITIES\.ACCOUNTING_MANAGE, validate: \(payload\) => validateQueryFilters\(payload, \[\]\) \}/)
  assert.match(modernClient, /'loyalty\.programs\.list'/)
  assert.match(legacyClient, /'loyalty\.programs\.list'/)
})

test('loyalty balance query is business scoped and never replaces commit-time redemption checks', async () => {
  const sql = await readFile(accountMigration, 'utf8')
  const contracts = await readFile(registry, 'utf8')
  const [modernClient, legacyClient] = await Promise.all([readFile(modern, 'utf8'), readFile(legacy, 'utf8')])
  assert.match(sql, /assert_capability\(v_ctx\.capabilities, 'customers\.manage'\)/)
  assert.match(sql, /bar_local\.customers c[\s\S]*c\.business_id = v_ctx\.business_id/)
  assert.match(sql, /loyalty_account_json\(a\.id\)/)
  assert.match(sql, /snapshot_watermark/)
  assert.match(contracts, /'loyalty\.account\.get': \{ version: 1, capability: CAPABILITIES\.CUSTOMERS_MANAGE/)
  assert.match(modernClient, /'loyalty\.account\.get'/)
  assert.match(legacyClient, /'loyalty\.account\.get'/)
})
