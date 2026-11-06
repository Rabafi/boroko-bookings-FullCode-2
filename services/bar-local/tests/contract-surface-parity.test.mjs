import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BAR_LOCAL_ERROR_CODES,
  BarLocalError,
  COMMANDS,
  QUERIES,
  getQuery,
  validateQueryEnvelope
} from '@tsa-bonno/bar-contracts'
import { COMMAND_FUNCTIONS } from '../dist/commands.js'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'
import { ALLOWED_QUERIES as modernQueries, ALLOWED_COMMANDS as modernCommands } from '../../../src/main/bar-local/client.js'
import { ALLOWED_QUERIES as legacyQueries, ALLOWED_COMMANDS as legacyCommands } from '../../../legacy-pos/src/main/bar-local/client.js'

const OWNER_PIN = '1234'

test('production client allowlists cover exactly the versioned service registry', () => {
  for (const queries of [modernQueries, legacyQueries]) assert.deepEqual([...queries].sort(), Object.keys(QUERIES).sort())
  for (const commands of [modernCommands, legacyCommands]) assert.deepEqual([...commands].sort(), Object.keys(COMMANDS).sort())
})
const PARITY_PROBE_KEY = '__parity_probe'
const INTERNAL_HELPERS = [
  'cmd_stock_movement',
  'reverse_sale',
  'reverse_sale_after_close',
  'enforce_sale_discount_capability',
  'assert_discount_policy',
  'query_dispatch_legacy'
]

function runtimeCommandAllowlist() {
  const path = fileURLToPath(new URL('../db/migrations/0031_runtime_execution_allowlist.sql', import.meta.url))
  const sql = readFileSync(path, 'utf8')
  const insert = /INSERT INTO bar_local\.runtime_function_allowlist[\s\S]*?VALUES([\s\S]*?);/.exec(sql)
  assert.ok(insert, '0031 must contain the runtime function allowlist insert')
  const allowlist = new Set([...insert[1].matchAll(/'([^']+)'/g)].map((match) => match[1]))
  for (const migration of ['0040_admin_status_metadata.sql', '0054_approver_identity.sql', '0067_recoverable_provisioning.sql', '0068_cloud_sync_runtime_grants.sql', '0072_stock_lot_runtime_allowlist.sql', '0075_post_close_corrections.sql', '0076_replacement_challenge.sql', '0077_local_business_profile.sql', '0082_atomic_bar_product_save.sql', '0083_native_stock_workflows.sql', '0086_atomic_cashup_handover.sql', '0087_blind_cashup_query_projection.sql', '0088_scoped_my_sales_query.sql', '0089_scoped_journal_entries_query.sql', '0090_journal_query_account_schema_fix.sql', '0091_bank_reconcile_journal_outlet_scope.sql']) {
    const source = readFileSync(fileURLToPath(new URL(`../db/migrations/${migration}`, import.meta.url)), 'utf8')
    const values = /INSERT INTO bar_local\.runtime_function_allowlist[\s\S]*?VALUES([\s\S]*?)(?:ON CONFLICT|;)/.exec(source)
    if (values) for (const match of values[1].matchAll(/'([^']+)'/g)) allowlist.add(match[1])
    const dynamic = /FOREACH v_name IN ARRAY ARRAY\[([\s\S]*?)\]/.exec(source)
    if (dynamic) for (const match of dynamic[1].matchAll(/'([^']+)'/g)) allowlist.add(match[1])
    const removed = /DELETE FROM bar_local\.runtime_function_allowlist WHERE function_name\s*=\s*'([^']+)'/g
    for (const match of source.matchAll(removed)) allowlist.delete(match[1])
  }
  return allowlist
}

test('every registered command has exactly one registered local handler', () => {
  const commandNames = Object.keys(COMMANDS).sort()
  const handlerNames = Object.keys(COMMAND_FUNCTIONS).sort()

  assert.deepEqual(handlerNames, commandNames)
  for (const [command, functionName] of Object.entries(COMMAND_FUNCTIONS)) {
    assert.equal(typeof functionName, 'string', `${command} handler must be a function name`)
    assert.match(functionName, /^bar_local\.cmd_[a-z0-9_]+$/, `${command} must map to a local cmd_ function`)
    assert.equal(COMMAND_FUNCTIONS[command], functionName, `${command} must have one stable handler`)
  }
  assert.equal(
    new Set(Object.values(COMMAND_FUNCTIONS)).size,
    commandNames.length,
    'two commands must not share one handler mapping'
  )
})

test('command handler mappings and the current local migration allowlist agree exactly', () => {
  const allowlist = runtimeCommandAllowlist()
  const handlerFunctions = new Set(
    Object.values(COMMAND_FUNCTIONS).map((functionName) => functionName.replace(/^bar_local\./, ''))
  )
  const allowlistedCommands = new Set([...allowlist].filter((name) => name.startsWith('cmd_')))

  assert.deepEqual([...handlerFunctions].sort(), [...allowlistedCommands].sort())

  for (const [command, functionName] of Object.entries(COMMAND_FUNCTIONS)) {
    const unqualified = functionName.replace(/^bar_local\./, '')
    assert.equal(allowlist.has(unqualified), true, `${command} maps to non-allowlisted function ${unqualified}`)
  }
  for (const functionName of allowlistedCommands) {
    assert.equal(
      handlerFunctions.has(functionName),
      true,
      `allowlisted function ${functionName} has no command handler mapping`
    )
  }
})

test('internal SQL helpers are absent from the runtime command allowlist', () => {
  const allowlist = runtimeCommandAllowlist()
  for (const helper of INTERNAL_HELPERS) {
    assert.equal(allowlist.has(helper), false, `${helper} must not be callable as a runtime command`)
  }
})

test('every registered query has a version and validator accepted by the query envelope', () => {
  const scope = { authority_id: randomUUID(), authority_epoch: 1 }
  const queryNames = Object.keys(QUERIES)

  assert.ok(queryNames.length > 0)
  for (const [name, definition] of Object.entries(QUERIES)) {
    assert.equal(typeof definition.version, 'number', `${name} query version must be present`)
    assert.ok(Number.isInteger(definition.version) && definition.version > 0, `${name} query version must be positive`)
    assert.equal(typeof definition.validate, 'function', `${name} query validator must be present`)
    assert.ok(definition.validate.length > 0, `${name} query validator must accept filters`)
    assert.equal(typeof definition.capability, 'string')
    assert.ok(definition.capability.length > 0)

    const validated = validateQueryEnvelope({
      contract_version: 1,
      ...scope,
      query: name,
      query_version: definition.version,
      filters: name === 'outbox.bundle.get'
        ? { batch_id: randomUUID() }
        : name === 'loyalty.account.get' ? { customer_id: randomUUID() }
        : name === 'accounting.records' ? { kind: 'bank_accounts' } : {}
    })
    assert.equal(validated.query, name)
    assert.equal(validated.query_version, definition.version)
    assert.equal(typeof validated.filters, 'object')
  }

  const unknownQuery = 'queries.not_a_registered_query'
  assert.throws(
    () => getQuery(unknownQuery),
    (error) => error instanceof BarLocalError && error.code === BAR_LOCAL_ERROR_CODES.QUERY_NOT_REGISTERED
  )
  assert.throws(
    () => validateQueryEnvelope({
      contract_version: 1,
      ...scope,
      query: unknownQuery,
      query_version: 1,
      filters: {}
    }),
    (error) => error instanceof BarLocalError && error.code === BAR_LOCAL_ERROR_CODES.QUERY_NOT_REGISTERED
  )
  assert.throws(
    () => validateQueryEnvelope({
      contract_version: 1,
      ...scope,
      query: 'outbox.bundle.get',
      query_version: 1,
      filters: { batch_id: 'not-a-uuid' }
    }),
    (error) => error instanceof BarLocalError && error.code === BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED
  )
  assert.deepEqual(validateQueryEnvelope({
    contract_version: 1, ...scope, query: 'accounting.journal_entries', query_version: 1,
    filters: { from: '2026-11-01', to: '2026-11-30', account_code: '1000', limit: 50 }
  }).filters, { from: '2026-11-01', to: '2026-11-30', account_code: '1000', limit: 50 })
  assert.throws(() => validateQueryEnvelope({
    contract_version: 1, ...scope, query: 'accounting.journal_entries', query_version: 1,
    filters: { from: 'November', limit: 50 }
  }), (error) => error instanceof BarLocalError && error.code === BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED)
})

test('HTTP command routing reaches validators for every registered command', async (t) => {
  const h = await createApiHarness(t)
  const ownerSetupBody = {
      provisioning_id: randomUUID(),
      device_token: `bld_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`,
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Contract Parity Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Parity Owner',
      pin: OWNER_PIN,
      currency: 'BWP',
      timezone: 'Africa/Gaborone',
      device_name: 'Parity Till',
      device_platform: 'modern',
      business_profile: {
        company_name: 'Parity Bar Limited', address: '1 Main Road', city: 'Gaborone', country: 'Botswana',
        phone: '+267 70000000', email: 'owner@parity.example', website: 'https://parity.example', vat_number: 'BW123'
      }
    }
  const setupResponse = await h.request('/v1/setup/owner', { body: ownerSetupBody })
  assert.equal(setupResponse.status, 201, JSON.stringify(setupResponse.body))
  const savedProfile = await h.migrator.query('SELECT profile FROM bar_local.business WHERE id = $1', [setupResponse.body.business_id])
  assert.deepEqual(savedProfile.rows[0].profile, {
    company_name: 'Parity Bar Limited', address: '1 Main Road', city: 'Gaborone', country: 'Botswana',
    phone: '+267 70000000', email: 'owner@parity.example', website: 'https://parity.example', vat_number: 'BW123'
  })
  const setupRetry = await h.request('/v1/setup/owner', { body: ownerSetupBody })
  assert.equal(setupRetry.status, 201, JSON.stringify(setupRetry.body))
  assert.equal(setupRetry.body.business_id, setupResponse.body.business_id, 'same operation retry returns the original Bar identity')
  const profileAudit = await h.migrator.query(
    "SELECT count(*)::integer AS count FROM bar_local.audit_log WHERE business_id = $1 AND action = 'business.profile_saved'",
    [setupResponse.body.business_id]
  )
  assert.equal(profileAudit.rows[0].count, 1, 'same operation retry does not duplicate profile audit')
  const setup = { ...setupResponse.body, device_token: setupResponse.stagedDeviceToken }

  const login = await h.request('/v1/sessions', {
    deviceToken: setup.device_token,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const auth = { token: login.body.session_token, deviceId: setup.device_id }

  const scope = {
    authority_id: setup.authority_id,
    authority_epoch: setup.authority_epoch,
    business_id: setup.business_id,
    outlet_id: setup.outlet_id,
    device_id: setup.device_id
  }
  const envelope = (command) => ({
    contract_version: 1,
    operation_id: randomUUID(),
    command,
    ...scope,
    payload: { [PARITY_PROBE_KEY]: true }
  })

  const unknownQuery = await h.request('/v1/queries/queries.not_a_registered_query', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: {}
    }
  })
  assert.equal(unknownQuery.status, 400, JSON.stringify(unknownQuery.body))
  assert.equal(unknownQuery.body.ok, false)
  assert.equal(unknownQuery.body.code, 'QUERY_NOT_REGISTERED')

  const failures = []
  for (const command of Object.keys(COMMANDS)) {
    const response = await h.request('/v1/commands', { ...auth, body: envelope(command) })
    if (response.status !== 400 || response.body?.ok !== false || response.body?.code !== 'VALIDATION_FAILED') {
      failures.push({
        command,
        status: response.status,
        code: response.body?.code ?? null,
        message: response.body?.message ?? null
      })
    }
  }
  assert.deepEqual(
    failures,
    [],
    `commands accepted an unknown payload key or failed before validation: ${JSON.stringify(failures, null, 2)}`
  )
})
