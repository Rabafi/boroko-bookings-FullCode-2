// V05 behavioral regression: support-bundle privacy via the allowlisted
// export schema. Exercises the REAL scrub/shape helpers and the REAL
// getSupportBundle pipeline (Electron stubbed, aux logs seeded with
// synthetic secrets only — never real credentials or customer data).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs';
import path from 'node:path';

import {
  sanitizeSupportText,
  scrubSupportBundleValue,
  shapeSupportBundle
} from '../src/shared/supportBundleScrub.js'
import {
  importDomain,
  importState,
  makeTempCacheDir
} from './helpers/domain-test-setup.mjs'

const health = await importDomain('health.js')
const { state, resetState } = await importState()

function bundleText(value) {
  return JSON.stringify(value)
}

test('independent verification probe is fully redacted', () => {
  const probe = {
    message: 'PIN=1234 password=synthetic-secret customer email audit@example.invalid',
    customer: { name: 'Synthetic Guest', address: 'Synthetic Address' },
    payroll: { gross: 100, net: 80 },
    bank: { iban: 'SYNTHETIC-IBAN' }
  }
  const scrubbed = scrubSupportBundleValue(probe)
  const text = bundleText(scrubbed)
  for (const secret of ['1234', 'synthetic-secret', 'audit@example.invalid', 'Synthetic Guest', 'Synthetic Address', 'SYNTHETIC-IBAN']) {
    assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `must not leak ${secret}`)
  }
  // Payroll figures leave no raw values behind.
  assert.doesNotMatch(text, /"gross":\s*100/)
  assert.doesNotMatch(text, /"net":\s*80/)
  const shaped = shapeSupportBundle({ generated_at: 't', product: 'p', app_version: 'v', critical_errors: [probe] })
  const shapedText = bundleText(shaped)
  for (const secret of ['1234', 'synthetic-secret', 'audit@example.invalid', 'Synthetic Guest', 'Synthetic Address', 'SYNTHETIC-IBAN']) {
    assert.doesNotMatch(shapedText, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `shaped bundle must not leak ${secret}`)
  }
})

test('arrays, token URLs, cycles, depth, binary, and large strings are bounded', () => {
  const cyclic = { id: 'c1' }
  cyclic.self = cyclic
  const big = `https://pay.example/callback?access_token=${'T'.repeat(9000)}`
  const deep = {}
  let cursor = deep
  for (let i = 0; i < 16; i++) cursor = cursor[`l${i}`] = {}
  cursor.leaf = 1
  const out = scrubSupportBundleValue({
    list: [{ api_key: 'K1' }, { ok: 1 }],
    url: big,
    cyclic,
    deep,
    blob: new Uint8Array([1, 2, 3])
  })
  assert.equal(out.list[0].api_key, '[REDACTED]')
  assert.equal(out.list[1].ok, 1)
  assert.doesNotMatch(out.url, /T{8,}/)
  assert.match(out.url, /access_token=\[REDACTED\]/)
  assert.equal(out.cyclic.self, '[CYCLE omitted]')
  assert.equal(out.blob, '[BINARY omitted]')
  assert.match(bundleText(out.deep), /TRUNCATED/)
})

test('free-text sanitizer keeps diagnostics while removing credentials', () => {
  const clean = sanitizeSupportText('split failed for tab 1234, PIN=9999, contact audit@example.invalid, retry later')
  assert.match(clean, /retry later/)
  assert.match(clean, /tab 1234/)
  assert.doesNotMatch(clean, /9999/)
  assert.doesNotMatch(clean, /audit@example\.invalid/)
  assert.equal(sanitizeSupportText(42), 42)
})

test('allowlisted schema drops unknown sections and raw bodies', () => {
  const shaped = shapeSupportBundle({
    generated_at: '2026-09-07T00:00:00.000Z',
    product: 'hospitality-pos',
    app_version: '9.9.9',
    lodge_id: 'lodge-1',
    user_id: 'op-1',
    user_name: 'Support Operator',
    app_online: true,
    pending_operations: { pending: 3, failed: 1 },
    future_unknown_section: { password: 'x', data: [1, 2, 3] },
    sync_details: {
      pendingCount: 2,
      pending: [{ _queue_id: 'q1', table: 'bookings', data: { customer_name: 'Nope', amount: 5 }, lastError: 'PIN=1111 boom' }]
    },
    financial_reconciliation: {
      summary: { paymentMismatches: 1 },
      paymentMismatches: [{ booking_id: 'b1', amount: 50, void_reason: 'guest asked, email g@example.invalid' }]
    }
  })
  assert.equal(shaped.future_unknown_section, undefined)
  assert.equal(shaped.user_name, 'Support Operator')
  assert.deepEqual(shaped.pending_operations, { pending: 3, failed: 1 })
  // Queue payload bodies are reduced to redacted shapes; error text is sanitized, not dropped.
  assert.equal(shaped.sync_details.pending[0].table, 'bookings')
  assert.equal(shaped.sync_details.pending[0].data.customer_name, '[REDACTED]')
  assert.equal(shaped.sync_details.pending[0].data.amount, 5)
  assert.doesNotMatch(shaped.sync_details.pending[0].lastError, /1111/)
  // Mismatch rows keep IDs/amounts/codes; free text is sanitized.
  assert.equal(shaped.financial_reconciliation.paymentMismatches[0].booking_id, 'b1')
  assert.equal(shaped.financial_reconciliation.paymentMismatches[0].amount, 50)
  assert.doesNotMatch(bundleText(shaped.financial_reconciliation), /g@example\.invalid/)
})

test('real getSupportBundle pipeline redacts seeded synthetic secrets', async () => {
  const cacheDir = makeTempCacheDir('v05-pipeline')
  fs.writeFileSync(path.join(cacheDir, 'critical-errors.json'), JSON.stringify([
    {
      scope: 'pos.test',
      message: 'transfer replay failed; password=syrup-secret PIN=4321 contact ledger@example.invalid',
      customer: { name: 'Pipeline Guest', address: 'Pipeline Address' },
      payroll: { gross: 700, net: 560 },
      bank: { iban: 'PIPE-IBAN-1' },
      at: new Date().toISOString()
    }
  ]))
  resetState()
  state.isOnline = false
  state.lodgeId = null
  state.currentUser = null
  state.cacheDir = cacheDir
  const bundle = await health.getSupportBundle(5)
  // Allowlist: only known top-level keys leave the device.
  const allowedTop = new Set([
    'generated_at', 'product', 'app_version', 'lodge_id', 'user_id',
    'user_name', 'app_online', 'pending_operations', 'system_health',
    'sync_status', 'sync_details', 'syncMeta', 'healthFaults',
    'financial_reconciliation', 'financial_validation',
    'financial_validation_runs', 'financial_validation_alerts', 'critical_errors'
  ])
  for (const key of Object.keys(bundle)) assert.ok(allowedTop.has(key), `unexpected top-level key ${key}`)
  const text = bundleText(bundle)
  for (const secret of ['syrup-secret', '4321', 'ledger@example.invalid', 'Pipeline Guest', 'Pipeline Address', 'PIPE-IBAN-1']) {
    assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `pipeline must not leak ${secret}`)
  }
  assert.doesNotMatch(text, /"gross":\s*700/)
  // The seeded error is still diagnosable (present, sanitized).
  const errors = bundle.critical_errors || []
  assert.ok(errors.length >= 1, 'seeded critical error must survive shaping')
  assert.match(bundleText(errors[0]), /transfer replay failed/)
})
