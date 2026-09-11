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

test('bar POS provider references are optional with length guards', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const domain = read('src/main/domains/pos.js')
  const migration = read('supabase/migrations/20260905000001_pos_provider_references_optional.sql')
  assert.match(terminal, /Card approval\/reference \(optional\)/)
  assert.match(terminal, /Mobile money reference \(optional\)/)
  assert.doesNotMatch(terminal, /required=\{(splitRemainderMethod|paymentMethod) ===/)
  assert.match(terminal, /missingReferences/)
  assert.match(domain, /must be 120 characters or fewer/)
  assert.doesNotMatch(domain, /Enter the mobile money transaction or approval reference/)
  assert.match(migration, /v_mobile_seen/)
  assert.match(migration, /v_card_seen/)
  assert.match(migration, /must be 120 characters or fewer/)
  assert.doesNotMatch(migration, /requires a transaction or approval reference/)
  assert.match(migration, /trg_validate_pos_tender_references/)
})

test('domain forwards tab version and never backfills retries', () => {
  // Retry byte-equivalence: optional tab-identity fields travel only when
  // the caller sent them, and a brand-new version-less tab_id settlement
  // fails closed before journaling. Cache state must never leak into a
  // rebuilt envelope.
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /applyOptionalV3TabFields\(v3OfflinePayload, data\)/)
  assert.match(domain, /applyOptionalV3TabFields\(v3Payload, data\)/)
  assert.match(domain, /hasPosSubmitAttempt\(submitIntentId\)/)
  assert.match(domain, /This sale is missing its tab version/)
  assert.doesNotMatch(domain, /resolveCachedTabVersion/)
})

test('historical tender-reference guard required audit references (superseded by optional-reference contract)', () => {
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
