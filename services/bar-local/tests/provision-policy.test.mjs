import test from 'node:test'
import assert from 'node:assert/strict'
import { hasPopulatedTestGuard } from '../scripts/lib/provision-policy.mjs'
test('production resume distinguishes an empty schema marker table from disposable data', async () => {
  for (const guarded of [false, true]) {
    const client = { query: async sql => ({ rows: [sql.includes('to_regclass') ? { marker: 'bar_local.test_guard' } : { guarded }] }) }
    assert.equal(await hasPopulatedTestGuard(client), guarded)
  }
  assert.equal(await hasPopulatedTestGuard({ query: async () => ({ rows: [{ marker: null }] }) }), false)
  await assert.rejects(hasPopulatedTestGuard({ query: async sql => {
    if (sql.includes('to_regclass')) return { rows: [{ marker: 'bar_local.test_guard' }] }
    throw new Error('marker unreadable')
  } }), /unreadable/)
})
