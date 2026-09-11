import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scrubSupportBundleValue } from '../src/shared/supportBundleScrub.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

test('PINs, passwords, tokens, and card material are redacted', () => {
  const scrubbed = scrubSupportBundleValue({
    pin_hash: 'abc123',
    staff_pin: '1234',
    password_hash: 'hash',
    session_token: 'tok_abcdef123456',
    api_key: 'key',
    card_number: '4111111111111111',
    cvv: '123',
    nested: { authorization: 'Bearer xyz', keep: 'yes' }
  })
  assert.equal(scrubbed.pin_hash, '[REDACTED]')
  assert.equal(scrubbed.staff_pin, '[REDACTED]')
  assert.equal(scrubbed.password_hash, '[REDACTED]')
  assert.equal(scrubbed.session_token, '[REDACTED]')
  assert.equal(scrubbed.api_key, '[REDACTED]')
  assert.equal(scrubbed.card_number, '[REDACTED]')
  assert.equal(scrubbed.cvv, '[REDACTED]')
  assert.equal(scrubbed.nested.authorization, '[REDACTED]')
  assert.equal(scrubbed.nested.keep, 'yes')
})

test('private payroll, bank numbers, and raw customer PII are redacted', () => {
  const scrubbed = scrubSupportBundleValue({
    gross_salary: 12000,
    payroll_net_pay: 9000,
    bank_account_number: '12345678',
    customer_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    phone: '+26770000000',
    record_id: 'rec-1',
    user_id: 'op-1',
    user_name: 'Operator'
  })
  assert.equal(scrubbed.gross_salary, '[REDACTED]')
  assert.equal(scrubbed.payroll_net_pay, '[REDACTED]')
  assert.equal(scrubbed.bank_account_number, '[REDACTED]')
  assert.equal(scrubbed.customer_name, '[REDACTED]')
  assert.equal(scrubbed.guest_email, '[REDACTED]')
  assert.equal(scrubbed.phone, '[REDACTED]')
  // Operator identity and record IDs stay intact for support triage.
  assert.equal(scrubbed.record_id, 'rec-1')
  assert.equal(scrubbed.user_id, 'op-1')
  assert.equal(scrubbed.user_name, 'Operator')
})

test('bearer tokens embedded in messages are redacted without dropping the log', () => {
  const scrubbed = scrubSupportBundleValue({
    message: 'request failed with Bearer abcdef1234567890, retry later',
    session: "x-boroko-session: 'abcdef1234567890'"
  })
  assert.doesNotMatch(scrubbed.message, /abcdef1234567890/)
  assert.match(scrubbed.message, /retry later/)
  assert.doesNotMatch(scrubbed.session, /abcdef1234567890/)
})

test('support bundle uses the allowlisted schema and carries product, version, and pending counts', () => {
  const health = read('src/main/domains/health.js')
  assert.match(health, /shapeSupportBundle\(\{/)
  assert.match(health, /product: getBundleProductId\(\)/)
  assert.match(health, /app_version: getBundleAppVersion\(\)/)
  assert.match(health, /pending_operations:/)
  assert.match(health, /supportBundleScrub\.js/)
})
