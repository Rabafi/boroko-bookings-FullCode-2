import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const modern = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx')
const legacy = join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx')
const modernClient = join(root, 'src/main/bar-local/client.js')
const legacyClient = join(root, 'legacy-pos/src/main/bar-local/client.js')

test('Modern closed-day correction panel branches from the normal return flow', () => {
  const source = readFileSync(modern, 'utf8')
  assert.match(source, /barSaleShiftIsClosed/)
  assert.match(source, /canPostCloseCorrectBarSale/)
  assert.match(source, /canPostCloseReturnBarSaleLines/)
  assert.match(source, /barPostCloseCorrectionBlockedMessage/)
  assert.match(source, /onSubmit=\{selectedSaleClosed \? submitPostCloseReturn : submitReturn\}/)
  assert.match(source, /Approve and post current-date correction/)
  assert.match(source, /Approve and cancel remaining closed-day sale \/ tip/)
  assert.match(source, /command: 'sale\.correct_after_close'/)
  assert.match(source, /kind: 'void'/)
  assert.match(source, /shift\?\.business_date/)
})

test('Modern correction panel shows closed-day evidence, remaining quantities and history', () => {
  const source = readFileSync(modern, 'utf8')
  assert.match(source, /closed business date/)
  assert.match(source, /post_close_tip_remaining/)
  assert.match(source, /post_close_corrected_quantity/)
  assert.match(source, /Corrections posted for this receipt/)
  assert.match(source, /requested by/)
  assert.match(source, /approved by/)
  assert.match(source, /The original receipt and its closed business date are never rewritten/)
  assert.match(source, /cannot be edited afterwards/)
})

test('Modern post-close controls never author payment state or paid totals', () => {
  const source = readFileSync(modern, 'utf8')
  assert.doesNotMatch(source, /payment_status\s*:/)
  assert.doesNotMatch(source, /amount_paid\s*:/)
})

test('Legacy closed-day correction panel mirrors the Modern safety contract', () => {
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
