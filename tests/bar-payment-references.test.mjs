import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Bar Till captures references for card and mobile-money tenders', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const legacyPos = read('src/renderer/src/components/POS.jsx')
  assert.match(terminal, /paymentReferences/)
  assert.match(terminal, /Card approval\/reference/)
  assert.match(terminal, /Mobile money reference/)
  assert.match(terminal, /missingReferences/)
  assert.match(terminal, /payment_breakdown: paymentBreakdown/)
  assert.match(legacyPos, /missingTenderReferences/)
})

test('payment references remain visible on receipts and transaction detail', () => {
  const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx')
  const report = read('src/renderer/src/components/hospitality-pos/HposReports.jsx')
  assert.match(receipt, /payment\.reference/)
  assert.match(report, /selectedPaymentBreakdown/)
  assert.match(report, /reference &&/)
})

test('database guard rejects provider tenders without audit references', () => {
  const sql = read('supabase/migrations/20260729120000_pos_tender_reference_guard.sql')
  assert.match(sql, /validate_pos_tender_references/)
  assert.match(sql, /v_method in \('card', 'mobile_money'\)/)
  assert.match(sql, /requires a transaction or approval reference/)
  assert.match(sql, /trg_validate_pos_tender_references/)
})
