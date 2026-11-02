import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'
import { COMMAND_FUNCTIONS } from '../dist/commands.js'
import { buildRuntimeSecurityStatements } from '../dist/operations/backup.js'

const SERVICE_FUNCTIONS = [
  'service_approval_candidates',
  'service_admin_audit',
  'service_admin_status',
  'service_authority',
  'service_complete_pairing',
  'service_create_approval',
  'service_create_pairing_code',
  'service_create_session',
  'service_device',
  'service_devices',
  'service_events',
  'service_increment_epoch',
  'service_login_outcome',
  'service_operation_status',
  'service_readiness',
  'service_refresh_session',
  'service_replacement_challenge',
  'service_revoke_device',
  'service_revoke_session',
  'service_session',
  'service_set_entitlement',
  'service_staff'
  , 'service_owner_credential', 'service_owner_credential_by_staff', 'service_owner_password_change', 'service_owner_password_recover', 'service_create_owner_session'
]

// Reviewed privileged entry points added outside the command/service registry.
// Keep this list explicit so a migration cannot silently widen the runtime API.
const FAILOVER_FUNCTIONS = [
  'service_failover_status',
  'service_failover_fence',
  'service_failover_promote'
]
const CLOUD_SYNC_FUNCTIONS = [
  'cloud_sync_worker_config',
  'cloud_sync_take_batch',
  'cloud_sync_next_batch',
  'cloud_sync_mark_signed',
  'cloud_sync_mark_uploading',
  'cloud_sync_mark_failure',
  'cloud_sync_acknowledge',
  'cloud_sync_record_run',
  'cloud_sync_status',
  'cloud_sync_config_set'
]
const PROVISIONING_FUNCTIONS = ['commission_owner_profile_recoverable', 'commission_owner_credentials_profile_recoverable', 'service_complete_pairing_recoverable']

function expectedAllowlist() {
  return new Set([
    'commission_owner',
    ...PROVISIONING_FUNCTIONS,
    'query_dispatch',
    ...SERVICE_FUNCTIONS,
    ...FAILOVER_FUNCTIONS,
    ...CLOUD_SYNC_FUNCTIONS,
    ...Object.values(COMMAND_FUNCTIONS).map((name) => name.replace(/^bar_local\./, ''))
  ])
}

async function runtimeFunctionAccess(h) {
  const result = await h.migrator.query(
    `SELECT p.proname,
            has_function_privilege('bar_local_runtime', p.oid, 'EXECUTE') AS executable,
            p.prosecdef AS security_definer,
            p.proconfig AS function_config,
            pg_get_userbyid(p.proowner) AS function_owner,
            EXISTS (
              SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            ) AS public_execute
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'bar_local'`
  )
  return result.rows
}

test('runtime allowlist is exact, excludes helpers, and still commits financial work', async (t) => {
  const h = await createHarness(t)
  const expected = expectedAllowlist()

  for (const statement of buildRuntimeSecurityStatements({
    migrationOwner: 'bar_local_migrator',
    runtimeRole: 'bar_local_runtime'
  })) {
    await h.migrator.query(statement)
  }

  const allowlist = await h.migrator.query(
    'SELECT function_name FROM bar_local.runtime_function_allowlist ORDER BY function_name'
  )
  assert.deepEqual(allowlist.rows.map((row) => row.function_name), [...expected].sort())

  const access = await runtimeFunctionAccess(h)
  const executable = new Set(access.filter((row) => row.executable).map((row) => row.proname))
  assert.deepEqual([...executable].sort(), [...expected].sort())
  const byName = new Map(access.map((row) => [row.proname, row]))
  for (const fn of access) {
    assert.equal(fn.public_execute, false, `${fn.proname} must not be executable by PUBLIC`)
  }
  for (const name of [...FAILOVER_FUNCTIONS, ...CLOUD_SYNC_FUNCTIONS, ...PROVISIONING_FUNCTIONS]) {
    const fn = byName.get(name)
    assert.ok(fn, `${name} must exist in the reviewed runtime function set`)
    assert.equal(fn.security_definer, true, `${name} must remain SECURITY DEFINER`)
    assert.ok(fn.function_config?.includes('search_path=pg_catalog, bar_local'), `${name} must pin its search_path`)
    assert.equal(fn.function_owner, 'bar_local_migrator', `${name} must remain owned by the migration role`)
  }
  for (const helper of ['cmd_stock_movement', 'cmd_workforce_tip_payout_reverse_before_recovery', 'enforce_sale_discount_capability', 'assert_discount_policy', 'query_dispatch_legacy', 'query_dispatch_before_support_reports', 'support_reports_list', 'reverse_sale', 'reverse_sale_after_close', 'query_dispatch_before_post_close']) {
    assert.equal(executable.has(helper), false, `${helper} must not be executable by the runtime role`)
  }

  const direct = await h.migrator.query(
    `SELECT count(*)::int AS violations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bar_local'
        AND c.relkind IN ('r','p','v','m')
        AND (has_table_privilege('bar_local_runtime', c.oid, 'SELECT')
          OR has_table_privilege('bar_local_runtime', c.oid, 'INSERT')
          OR has_table_privilege('bar_local_runtime', c.oid, 'UPDATE')
          OR has_table_privilege('bar_local_runtime', c.oid, 'DELETE')
          OR has_table_privilege('bar_local_runtime', c.oid, 'TRUNCATE'))`
  )
  assert.equal(direct.rows[0].violations, 0)
  const sequences = await h.migrator.query(
    `SELECT count(*)::int AS violations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bar_local'
        AND c.relkind = 'S'
        AND (has_sequence_privilege('bar_local_runtime', c.oid, 'USAGE')
          OR has_sequence_privilege('bar_local_runtime', c.oid, 'SELECT')
          OR has_sequence_privilege('bar_local_runtime', c.oid, 'UPDATE'))`
  )
  assert.equal(sequences.rows[0].violations, 0)
  assert.equal(
    (await h.migrator.query("SELECT has_schema_privilege('bar_local_runtime', 'bar_local', 'CREATE') AS allowed")).rows[0].allowed,
    false
  )

  const shiftId = await h.openShift()
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'RUNTIME-PRIVILEGE', name: 'Runtime Privilege', category: 'Test', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id

  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '1.00',
    discount_reason: 'Runtime privilege regression',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '9.00', tendered: '10.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))

  const returnPayload = {
    sale_id: sale.result.sale_id,
    lines: [{ sale_line_id: sale.result.receipt.lines[0].sale_line_id, quantity: '1' }],
    reason: 'Runtime privilege return',
    disposition: 'restock'
  }
  const approvalHash = sha256Json(returnPayload)
  const approvalId = await h.approve('pos.void', approvalHash, {
    targetType: 'sale',
    targetId: sale.result.sale_id
  })
  const returned = await h.callWith(
    h.runtime,
    'cmd_sale_return',
    h.envelope('sale.return', { ...returnPayload, approval_id: approvalId }),
    { hash: sha256Json({ ...returnPayload, approval_id: approvalId }), approvalHash }
  )
  assert.equal(returned.ok, true, JSON.stringify(returned.error))
  assert.equal(Number(returned.receipt.total), -9)

  await assert.rejects(
    () => h.runtime.query('SELECT count(*) FROM bar_local.sales'),
    (error) => error.code === '42501'
  )
  await assert.rejects(
    () => h.runtime.query('CREATE TABLE bar_local.runtime_escape (id integer)'),
    (error) => error.code === '42501'
  )
  await assert.rejects(
    () => h.runtime.query(
      'SELECT bar_local.reverse_sale(NULL::bar_local.session_context, NULL::uuid, NULL::bigint, NULL::uuid, NULL::jsonb, NULL::text, NULL::text, false)'
    ),
    (error) => error.code === '42501'
  )
})
