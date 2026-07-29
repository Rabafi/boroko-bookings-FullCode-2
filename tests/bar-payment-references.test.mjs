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
  const desktopDomain = read('src/main/domains/pos.js')
  const legacyTerminal = read('legacy-pos/src/renderer/src/screens/POSTerminal.jsx')
  const legacyMain = read('legacy-pos/src/main/index.js')
  assert.match(terminal, /paymentReferences/)
  assert.match(terminal, /Card approval\/reference/)
  assert.match(terminal, /Mobile money reference/)
  assert.match(terminal, /missingReferences/)
  assert.match(terminal, /payment_breakdown: paymentBreakdown/)
  assert.match(legacyPos, /missingTenderReferences/)
  assert.match(desktopDomain, /validateProviderPaymentReferences\(paymentBreakdown, paymentMethod\)/)
  assert.match(legacyTerminal, /missingProviderReferences/)
  assert.match(legacyMain, /validateProviderPaymentReferences\(payload\.payment_breakdown, payload\.payment_method\)/)
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
  const repair = read('supabase/migrations/20260729150000_pos_tender_reference_guard_v2.sql')
  assert.match(sql, /validate_pos_tender_references/)
  assert.match(sql, /v_method in \('card', 'mobile_money'\)/)
  assert.match(sql, /requires a transaction or approval reference/)
  assert.match(sql, /trg_validate_pos_tender_references/)
  assert.match(repair, /v_default_method in \('card', 'mobile_money'\)/)
  assert.match(repair, /jsonb_array_length\(v_breakdown\) = 0/)
  assert.match(repair, /v_provider_seen/)
})
