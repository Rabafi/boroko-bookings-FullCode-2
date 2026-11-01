import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { assertClusterIdentity, connectionConfig, loadTarget } from '../scripts/lib/db-target.mjs'
import { resetSchema, runMigrations, seedSetupSecret, seedTestGuard } from '../scripts/lib/migrate.mjs'

const { Client } = pg

export const TEST_SETUP_SECRET = 'db-test-setup-secret-0123456789abcdef'
export const TEST_SETUP_SECRET_HASH = createHash('sha256').update(TEST_SETUP_SECRET, 'utf8').digest('hex')

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function sha256Json(value) {
  return sha256Text(JSON.stringify(value))
}

async function openClient(target, user) {
  const client = new Client(connectionConfig({ ...target, user, maintenance: false }))
  await client.connect()
  return client
}

export async function createHarness(t, { managerCapabilities = ['pos.view', 'pos.manage', 'pos.void', 'pos.cashup', 'pos.reports', 'inventory.view', 'inventory.manage', 'inventory.approve', 'customers.manage', 'vouchers.manage', 'settings.manage', 'accounting.read', 'accounting.manage', 'accounting.approve', 'export.manage'], entitlementFeatures = ['bar_growth_multi_outlet'] } = {}) {
  const target = loadTarget()
  const migratorUser = process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator'
  const runtimeUser = process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime'
  const migrator = await openClient(target, migratorUser)
  const runtime = await openClient(target, runtimeUser)
  t.after(async () => {
    await runtime.end()
    await migrator.end()
  })

  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true })
  await resetSchema(migrator)
  await runMigrations(migrator)
  await seedTestGuard(migrator, target.clusterData)
  await seedSetupSecret(migrator, TEST_SETUP_SECRET_HASH)
  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true })

  const authorityId = randomUUID()
  const businessId = randomUUID()
  const outletId = randomUUID()
  const deviceId = randomUUID()
  const ownerTokenHash = sha256Text(`owner-token-${randomUUID()}`)
  const managerTokenHash = sha256Text(`manager-token-${randomUUID()}`)

  const commission = await runtime.query(
    `SELECT bar_local.commission_owner($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result`,
    [authorityId, businessId, outletId, 'Test Bar', 'Main Bar', 'Owner One',
     sha256Text('1234'), 'test-salt', 100000, TEST_SETUP_SECRET_HASH, 'BWP', 'Africa/Gaborone']
  )
  const ownerStaffId = commission.rows[0].result.owner_staff_id

  await migrator.query(
    `INSERT INTO bar_local.devices (id, business_id, outlet_id, name, platform, certificate_fingerprint, token_hash)
     VALUES ($1,$2,$3,'Till 1','modern','test-fingerprint',$4)`,
    [deviceId, businessId, outletId, sha256Text(`device-${deviceId}`)]
  )
  const manager = await migrator.query(
    `INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
     VALUES ($1,'Manager One','manager',$2,$3,'test-salt',100000) RETURNING id`,
    [businessId, managerCapabilities, sha256Text('5678')]
  )
  const managerStaffId = manager.rows[0].id

  await runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [ownerStaffId, deviceId, outletId, ownerTokenHash])
  await runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [managerStaffId, deviceId, outletId, managerTokenHash])
  await runtime.query('SELECT bar_local.service_set_entitlement($1,$2,$3,$4,$5)', [
    ownerTokenHash, deviceId, 1, entitlementFeatures, 'test-key'
  ])

  const envelope = (command, payload, operationId = randomUUID()) => ({
    contract_version: 1,
    operation_id: operationId,
    command,
    authority_id: authorityId,
    authority_epoch: 1,
    business_id: businessId,
    outlet_id: outletId,
    device_id: deviceId,
    payload
  })

  const execute = async (client, fn, env, { hash = sha256Json(env.payload), approvalHash = null, tokenHash = ownerTokenHash } = {}) => {
    const result = await client.query(
      `SELECT bar_local.${fn}($1,$2,$3::jsonb,$4,$5) AS result`,
      [tokenHash, deviceId, JSON.stringify(env), hash, approvalHash]
    )
    return result.rows[0].result
  }

  const call = async (fn, env, options) => execute(runtime, fn, env, options)

  const query = async (name, filters = {}, { tokenHash = ownerTokenHash, authorityEpoch = 1 } = {}) => {
    const result = await runtime.query(
      `SELECT bar_local.query_dispatch($1,$2,$3,$4,$5,$6::jsonb) AS result`,
      [tokenHash, deviceId, authorityId, authorityEpoch, name, JSON.stringify(filters)]
    )
    return result.rows[0].result
  }

  const approve = async (capability, operationHash, { targetType = 'operation', targetId = null, approverStaffId = managerStaffId } = {}) => {
    const tokenHash = approverStaffId === managerStaffId ? managerTokenHash : ownerTokenHash
    const result = await runtime.query(
      `SELECT bar_local.service_create_approval($1,$2,$3,$4,$5,$6,$7) AS result`,
      [tokenHash, deviceId, approverStaffId, capability, operationHash, targetType, targetId]
    )
    return result.rows[0].result.approval_id
  }

  return {
    target, migrator, runtime,
    authorityId, businessId, outletId, deviceId,
    ownerStaffId, managerStaffId, ownerTokenHash, managerTokenHash,
    envelope, call, callWith: execute, query, approve,
    seedShiftCatalogue: async () => {
      await migrator.query(
        `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate, active)
         VALUES ($1, $2, 'Shift setup fixture', 1, 0, true)`,
        [businessId, `SHIFT-FIXTURE-${randomUUID()}`]
      )
    },
    newRuntimeClient: async () => {
      const client = new Client(connectionConfig({ ...target, user: runtimeUser, maintenance: false }))
      await client.connect()
      t.after(async () => { await client.end() })
      return client
    },
    insertStaff: async (name, role, capabilities) => {
      const result = await migrator.query(
        `INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
         VALUES ($1,$2,$3,$4,$5,'test-salt',100000) RETURNING id`,
        [businessId, name, role, capabilities, sha256Text(name)]
      )
      return result.rows[0].id
    },
    openShift: async (openingFloat = '100.00') => {
      // Most domain tests open a shift before creating the products they exercise.
      // Supply a temporary catalogue item only for that setup, leaving their
      // subsequent catalogue counts and explicit empty-catalogue tests unchanged.
      const seed = await migrator.query(
        `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate, active)
         SELECT $1, $2, 'Shift setup fixture', 1, 0, true
         WHERE NOT EXISTS (SELECT 1 FROM bar_local.products WHERE business_id = $1 AND active)
         RETURNING id`, [businessId, `SHIFT-FIXTURE-${randomUUID()}`]
      )
      const env = envelope('shift.open', { opening_float: openingFloat })
      let result
      try {
        result = await call('cmd_shift_open', env)
      } finally {
        if (seed.rows.length) await migrator.query('DELETE FROM bar_local.products WHERE id = $1', [seed.rows[0].id])
      }
      if (!result.ok) throw new Error(`shift open failed: ${JSON.stringify(result.error)}`)
      return result.result.shift_id
    }
  }
}
