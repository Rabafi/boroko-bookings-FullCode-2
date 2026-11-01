import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createHarness, sha256Text } from './harness.mjs'

function productPayload(sku = 'FAILOVER-1') {
  return { sku, name: sku, category: 'Test', price: '10.00', tax_rate: '0', track_stock: false }
}

test('authority fencing stops writes and promotion is a one-way epoch bump', async (t) => {
  const h = await createHarness(t)

  const initial = (await h.runtime.query('SELECT bar_local.service_failover_status() AS result')).rows[0].result
  assert.equal(initial.fenced, false)
  assert.equal(initial.authority_epoch, 1)
  assert.equal(initial.in_recovery, false)

  const fence = (await h.runtime.query("SELECT bar_local.service_failover_fence('OPERATOR_TEST_FENCE') AS result")).rows[0].result
  assert.equal(fence.fenced, true)
  assert.equal(fence.fence_epoch, 1)
  assert.equal(fence.fence_reason, 'OPERATOR_TEST_FENCE')

  // current_session runs before the command's own error envelope, so a fenced
  // authority raises rather than returning ok:false.
  await assert.rejects(
    () => h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', productPayload())),
    (error) => error.detail === 'AUTHORITY_FENCED'
  )

  const readiness = (await h.runtime.query('SELECT bar_local.service_readiness($1,$2) AS result', [
    h.ownerTokenHash, h.deviceId
  ])).rows[0].result
  assert.equal(readiness.ready, false)
  assert.equal(readiness.fenced, true)
  assert.equal(readiness.blockers.includes('authority_fenced'), true)

  // Promotion must advance the epoch by exactly one.
  await assert.rejects(
    () => h.runtime.query('SELECT bar_local.service_failover_promote($1)', [3]),
    /exactly one/
  )
  await assert.rejects(
    () => h.runtime.query('SELECT bar_local.service_failover_promote($1)', [1]),
    /exactly one/
  )

  const promoted = (await h.runtime.query('SELECT bar_local.service_failover_promote($1,$2::jsonb) AS result', [
    2, JSON.stringify({ test: 'db-failover' })
  ])).rows[0].result
  assert.equal(promoted.promoted, true)
  assert.equal(Number(promoted.authority_epoch), 2)

  const after = (await h.runtime.query('SELECT bar_local.service_failover_status() AS result')).rows[0].result
  assert.equal(after.fenced, false)
  assert.equal(after.authority_epoch, 2)
  assert.equal(Number(after.promoted_epoch), 2)

  const sessions = (await h.migrator.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
       FROM bar_local.sessions`
  )).rows[0]
  assert.equal(sessions.revoked, sessions.total, 'promotion must revoke every existing session')

  // The pre-promotion epoch is dead even with the original token.
  await assert.rejects(
    () => h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', productPayload('FAILOVER-2'))),
    (error) => error.detail === 'WRONG_AUTHORITY_EPOCH'
  )

  // A freshly issued session at the new epoch can trade.
  const token = `bls_${process.pid}_${randomUUID()}`
  const tokenHash = sha256Text(token)
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [
    h.ownerStaffId, h.deviceId, h.outletId, tokenHash
  ])
  const current = await h.callWith(
    h.runtime,
    'cmd_catalogue_upsert',
    { ...h.envelope('catalogue.upsert', productPayload('FAILOVER-3')), authority_epoch: 2 },
    { tokenHash }
  )
  assert.equal(current.ok, true, JSON.stringify(current.error))

  // Fencing again at the promoted epoch keeps the epoch monotonic.
  await h.runtime.query("SELECT bar_local.service_failover_fence('SECOND_FENCE')")
  await assert.rejects(
    () => h.runtime.query('SELECT bar_local.service_failover_promote($1)', [2]),
    /exactly one/
  )
  const second = (await h.runtime.query('SELECT bar_local.service_failover_promote($1) AS result', [3])).rows[0].result
  assert.equal(Number(second.authority_epoch), 3)

  const audit = await h.migrator.query(
    `SELECT action, after FROM bar_local.audit_log WHERE action = 'failover.promoted' ORDER BY id`
  )
  assert.equal(audit.rows.length, 2)
  assert.equal(Number(audit.rows[0].after.authority_epoch), 2)
  assert.equal(Number(audit.rows[1].after.authority_epoch), 3)
})

test('a fenced authority refuses sequence allocation even for an otherwise valid caller', async (t) => {
  const h = await createHarness(t)
  await h.migrator.query("SELECT bar_local.service_failover_fence('SEQUENCE_FENCE')")
  await assert.rejects(
    () => h.migrator.query('SELECT * FROM bar_local.allocate_sequence(true)'),
    /fenced/
  )
  await h.migrator.query('SELECT bar_local.service_failover_promote($1)', [2])
  const allocated = (await h.migrator.query('SELECT * FROM bar_local.allocate_sequence(true)')).rows[0]
  assert.equal(Number(allocated.commit_sequence) >= 1, true)
})
