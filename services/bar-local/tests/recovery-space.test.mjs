import test from 'node:test'
import assert from 'node:assert/strict'
import { recoveryBaseRequiredBytes, recoveryDrillRequiredBytes } from '../dist/operations/recovery.js'

test('physical backup space scales with actual source size and accounts for plaintext plus encrypted copies', () => {
  const source = 2n * 1024n ** 3n
  assert.equal(recoveryBaseRequiredBytes(source), 2n * source + 512n * 1024n ** 2n)
  const largeSource = 8n * 1024n ** 3n
  assert.equal(recoveryBaseRequiredBytes(largeSource), 2n * largeSource + 2n * 1024n ** 3n)
})

test('recovery drill reserves the uncompressed base plus replay growth', () => {
  const base = 500n * 1024n ** 2n
  assert.equal(recoveryDrillRequiredBytes(base), base + 1024n ** 3n)
  const largeBase = 8n * 1024n ** 3n
  assert.equal(recoveryDrillRequiredBytes(largeBase), largeBase + 2n * 1024n ** 3n)
})
