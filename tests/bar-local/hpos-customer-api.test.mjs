import test from 'node:test'
import assert from 'node:assert/strict'
import { readPendingCustomerIntent, submitLocalCustomer } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposCustomerApi.js'

function storageFixture() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('local customer creation persists its exact operation and clears on authority confirmation', async () => {
  const storage = storageFixture()
  const payload = { name: 'Test Guest', phone: '+26770000000' }
  let dispatched
  await submitLocalCustomer({ storage, payload, command: async (intent) => {
    dispatched = intent
    assert.deepEqual(readPendingCustomerIntent(storage), intent)
    return { outcome: 'committed_local', result: { customer_id: 'customer-1' } }
  } })
  assert.equal(dispatched.command, 'customer.create')
  assert.deepEqual(dispatched.payload, payload)
  assert.ok(dispatched.operation_id)
  assert.equal(readPendingCustomerIntent(storage), null)
})

test('uncertain customer creation retries the saved operation and unchanged personal data', async () => {
  const storage = storageFixture()
  const payload = { name: 'Test Guest', email: 'guest@example.test' }
  await assert.rejects(submitLocalCustomer({ storage, payload, command: async () => { throw new Error('service stopped') } }), /service stopped/)
  const saved = readPendingCustomerIntent(storage)
  let retried
  await submitLocalCustomer({ storage, payload: { name: 'Changed Name' }, command: async (intent) => { retried = intent; return { outcome: 'committed_local' } } })
  assert.equal(retried.operation_id, saved.operation_id)
  assert.deepEqual(retried.payload, payload)
  assert.equal(readPendingCustomerIntent(storage), null)
})
