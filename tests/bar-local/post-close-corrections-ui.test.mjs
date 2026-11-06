import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const legacy = join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx')
const modernClient = join(root, 'src/main/bar-local/client.js')
const legacyClient = join(root, 'legacy-pos/src/main/bar-local/client.js')

test('Legacy closed-day correction panel preserves the safety contract', () => {
  const source = readFileSync(legacy, 'utf8')
  assert.match(source, /barSaleShiftIsClosed/)
  assert.match(source, /canPostCloseCorrectBarSale/)
  assert.match(source, /canPostCloseReturnBarSaleLines/)
  assert.match(source, /barPostCloseCorrectionBlockedMessage/)
  assert.match(source, /onSubmit=\{selectedSaleClosed \? submitPostCloseReturn : submitReturn\}/)
  assert.match(source, /requestApproval\('sale\.correct_after_close'/)
  assert.match(source, /kind: 'void'/)
  assert.match(source, /Approve and post current-date correction/)
  assert.match(source, /Corrections posted for this receipt/)
  assert.match(source, /shift_status\?: string/)
  assert.match(source, /post_close_eligible\?: boolean/)
  assert.match(source, /post_close_tip_remaining\?: string \| number/)
  assert.match(source, /post_close_corrected_quantity\?: string \| number/)
  assert.doesNotMatch(source, /payment_status\s*:/)
  assert.doesNotMatch(source, /amount_paid\s*:/)
})

test('both local clients allowlist the authoritative post-close command', () => {
  for (const file of [modernClient, legacyClient]) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /'sale\.correct_after_close'/)
    assert.match(source, /'reports\.post_close_corrections'/)
  }
})
