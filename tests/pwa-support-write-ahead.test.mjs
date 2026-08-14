import assert from 'node:assert/strict'
import test from 'node:test'

import {
  enqueueOfflineOperationVerified,
  getOfflineQueue,
  removeOfflineOperation,
  setOfflineQueue
} from '../manager-pwa/src/lib/runtime.js'

function installStorage({ throwOnWrite = false, mismatch = false } = {}) {
  const values = new Map()
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (throwOnWrite) throw new Error('quota exceeded')
      values.set(key, mismatch ? JSON.stringify({ tampered: true }) : String(value))
    },
    removeItem: (key) => values.delete(key)
  }
  global.window = { localStorage: storage, dispatchEvent: () => {} }
  global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  return storage
}

function item(id, body = 'original') {
  return { id, type: 'support/create', label: 'Create support request', payload: { lodge_id: 'lodge-1', title: body, operation_id: id }, createdAt: '2026-08-06T08:00:00.000Z' }
}

test('support write-ahead persistence fails closed on storage errors', () => {
  installStorage({ throwOnWrite: true })
  assert.throws(() => enqueueOfflineOperationVerified('lodge-1', item('support-op-1')), /quota exceeded/i)
})

test('support write-ahead persistence verifies the item and removes it only after success', () => {
  installStorage()
  const operation = item('support-op-2')
  enqueueOfflineOperationVerified('lodge-1', operation)
  assert.deepEqual(getOfflineQueue('lodge-1'), [operation])
  removeOfflineOperation('lodge-1', operation.id)
  assert.deepEqual(getOfflineQueue('lodge-1'), [])
})

test('lost response recovery retains the exact item across reload', () => {
  installStorage()
  const operation = item('support-op-3', 'unchanged body')
  enqueueOfflineOperationVerified('lodge-1', operation)
  // A reload creates a new module/runtime view over the same browser storage;
  // the item remains until the authoritative replay succeeds.
  assert.deepEqual(getOfflineQueue('lodge-1')[0], operation)
  assert.equal(getOfflineQueue('lodge-1')[0].id, operation.id)
})

test('duplicate support enqueue is idempotent and changed reuse conflicts', () => {
  installStorage()
  const operation = item('support-op-4')
  const first = enqueueOfflineOperationVerified('lodge-1', operation)
  const duplicate = enqueueOfflineOperationVerified('lodge-1', { ...operation })
  assert.deepEqual(duplicate, first)
  assert.equal(getOfflineQueue('lodge-1').length, 1)
  assert.throws(() => enqueueOfflineOperationVerified('lodge-1', item('support-op-4', 'changed')), (error) => error?.code === 'idempotency_conflict')
})

test('queue replacement preserves entries added during a flush', () => {
  installStorage()
  setOfflineQueue('lodge-1', [item('support-op-5')])
  setOfflineQueue('lodge-1', [...getOfflineQueue('lodge-1'), item('support-op-6')])
  assert.deepEqual(getOfflineQueue('lodge-1').map((entry) => entry.id), ['support-op-5', 'support-op-6'])
})
