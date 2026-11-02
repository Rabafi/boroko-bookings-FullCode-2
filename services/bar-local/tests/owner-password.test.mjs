import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertOwnerPassword,
  dummyOwnerPasswordVerify,
  hashOwnerPassword,
  normalizeOwnerEmail,
  verifyOwnerPassword
} from '../dist/password.js'

test('offline owner password verifier is salted, bounded, and timing safe', async () => {
  const password = 'bar owner password 123'
  const first = await hashOwnerPassword(password)
  const second = await hashOwnerPassword(password)
  assert.notEqual(first.password_salt, second.password_salt)
  assert.notEqual(first.password_hash, second.password_hash)
  assert.equal(await verifyOwnerPassword(password, first), true)
  assert.equal(await verifyOwnerPassword('another owner password', first), false)
  assert.equal(await verifyOwnerPassword(password, { ...first, password_iterations: 2_000_001 }), false)
  assert.equal(await verifyOwnerPassword(password, { ...first, password_salt: 'x' }), false)
  await dummyOwnerPasswordVerify('unknown@example.test')
})

test('owner email and password policy rejects malformed and ambiguous values', () => {
  assert.equal(normalizeOwnerEmail(' OWNER@Example.test '), 'owner@example.test')
  for (const email of ['', 'no-at-sign', 'a@b', 'x'.repeat(250) + '@example.test']) {
    assert.throws(() => normalizeOwnerEmail(email))
  }
  assert.equal(assertOwnerPassword('123456789012'), '123456789012')
  for (const password of ['short', ' 123456789012', '123456789012 ', 'x'.repeat(129)]) {
    assert.throws(() => assertOwnerPassword(password))
  }
})
