import { normalizeTrialBalanceResponse } from '../src/renderer/src/components/restaurant-accounting/trialBalanceResponse.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeBudgetResponse } from '../src/renderer/src/components/restaurant-accounting/budgetResponse.js'
import { createManualJournalIntent, journalIntentStorageKey, loadManualJournalIntent, normalizeManualJournalPayload, reconcileManualJournalStatus, restoreManualJournalForm, saveManualJournalIntent } from '../src/renderer/src/components/restaurant-accounting/journalIntent.js'
import { accountingExportRowCount } from '../src/main/accountingExportRowCount.js'
import { assertCompleteAccountingExport } from '../src/main/accountingExportCompleteness.js'
import { showAccountingExportSaveDialog } from '../src/main/accountingExportSaveDialog.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const auditDir = 'docs/audits/2026-10-07/accounting-addon'
const auditedButtons = JSON.parse(read(auditDir + '/non-submitting-forms.json')).rows
const migrations = () => readdirSync(resolve(root, 'supabase/migrations')).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort()
const latestMigrationContaining = (fragment) => {
  const needle = ('create or replace function public.' + fragment + '(').toLowerCase()
  const name = migrations().filter((entry) => read('supabase/migrations/' + entry).toLowerCase().includes(needle)).at(-1)
  return name ? read('supabase/migrations/' + name) : ''
}

test('DEP-01 forward fix aggregates UUID legs without max(uuid)', () => {
  const name = migrations().find((entry) => entry.includes('hotel_folio_integrity_diagnostics'))
  assert.ok(name, 'a forward migration for the diagnostic must be present')
  const sql = read('supabase/migrations/' + name)
  assert.match(sql, /create or replace function public\.get_hotel_folio_integrity_diagnostics\(/i)
  assert.match(sql, /max\([^)]*folio_id::text[^)]*\)[\s\S]*::uuid/i)
  assert.doesNotMatch(sql, /max\s*\(\s*\w+\.folio_id\s*\)/i)
  assert.match(sql, /out_count[\s\S]*in_count/i)
})

test('ACC-01 all 22 intended form actions are submit controls; utility actions stay buttons', async (t) => {
  assert.equal(auditedButtons.length, 22)
  for (const row of auditedButtons) {
    await t.test(row.file + ' ' + row.button, () => {
      const source = read(row.file)
      let searchAt = 0
      let openingTag = null
      while (searchAt < source.length) {
        const labelAt = source.indexOf(row.button, searchAt)
        if (labelAt < 0) break
        const buttonAt = source.lastIndexOf('<AccountingButton', labelAt)
        const nextButtonAt = buttonAt < 0 ? -1 : source.indexOf('<AccountingButton', buttonAt + 1)
        const buttonEnd = source.indexOf('</AccountingButton>', labelAt)
        const formStart = buttonAt < 0 ? -1 : source.lastIndexOf('<form', buttonAt)
        const priorFormEnd = buttonAt < 0 ? -1 : source.lastIndexOf('</form>', buttonAt)
        const formEnd = buttonAt < 0 ? -1 : source.indexOf('</form>', buttonAt)
        if (buttonAt >= 0 && buttonEnd > labelAt && (nextButtonAt < 0 || nextButtonAt > labelAt) && formStart > priorFormEnd && formEnd > buttonEnd) {
          const tagEnd = source.indexOf('>', buttonAt)
          openingTag = source.slice(buttonAt, tagEnd + 1)
          break
        }
        searchAt = labelAt + row.button.length
      }
      assert.ok(openingTag, row.file + ': ' + row.button + ' is not the named action inside a form')
      assert.match(openingTag, /\btype\s*=\s*["']submit["']/i, row.file + ': ' + row.button + ' must submit ' + row.form_handler)
    })
  }
  const shared = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
  assert.match(shared, /type\s*=\s*['"]button['"]/)
  assert.equal((shared.match(/type=\{type\}/g) || []).length, 2, 'Bar and Restaurant variants must both forward the selected type')
})

test('ACC-04 budget response is validated before it reaches rendering or mutation controls', () => {
  const ui = read('src/renderer/src/components/restaurant-accounting/RestaurantBudgets.jsx')
  const sql = latestMigrationContaining('get_restaurant_budget_matrix_v2')
  assert.match(ui, /normalizeBudgetResponse/)
  assert.match(read('supabase/migrations/20261007060000_restaurant_accounting_staff_session_rpc_grants.sql'), /get_restaurant_budget_matrix_v2[\s\S]*to anon/i)
  assert.match(ui, /budgetDataValid/)
  assert.match(read('src/renderer/src/components/restaurant-accounting/budgetResponse.js'), /Budget data response is invalid/i)
  assert.match(ui, /disabled=\{[^}]*!budgetDataValid/)
  assert.match(sql, /templates/)
  assert.match(sql, /2000[\s\S]*2100/)
  assert.match(sql, /coalesce\(jsonb_agg[\s\S]*'\[\]'::jsonb/)
})

test('ACC-05 journal entry and submission use one idempotent RPC with actor/lodge-scoped recovery', () => {
  const name = migrations().find((entry) => entry.includes('manual_journal_atomic_submission'))
  assert.ok(name, 'the atomic journal-submission RPC must be forward-migrated')
  const sql = read('supabase/migrations/' + name)
  assert.match(sql, /create_restaurant_manual_journal_draft\(/)
  assert.match(sql, /submit_restaurant_manual_journal\(/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /operation_id[\s\S]*payload_hash/)
  const ledger = read('src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx')
  assert.match(ledger, /createAndSubmitManualJournal/)
  assert.match(ledger, /journalIntentKey/)
  assert.match(ledger, /Check server status|Check submission status/i)
  assert.doesNotMatch(ledger, /createManualJournalDraft/)
  assert.doesNotMatch(ledger, /submitManualJournal/)
  assert.match(read('src/main/index.js'), /createAndSubmitManualJournal:[\s\S]*accounting\.manage/)
  assert.match(read('supabase/migrations/20261007060000_restaurant_accounting_staff_session_rpc_grants.sql'), /create_and_submit_restaurant_manual_journal_v2[\s\S]*to anon/i)
})

test('ACC-02 export defaults match the client while payroll remains private by default', () => {
  const joined = migrations().map((name) => read('supabase/migrations/' + name)).join('\n')
  const latest = joined.slice(joined.lastIndexOf('create or replace function public._restaurant_actor_has_capability'))
  assert.match(latest, /accounting\.export[\s\S]*v_role in\s*\(\s*'finance'[\s\S]*'manager'[\s\S]*'admin'[\s\S]*'super_admin'/)
  assert.match(latest, /accounting\.payroll_export[\s\S]*v_role in\s*\(\s*'admin'[\s\S]*'super_admin'/)
  assert.match(latest, /v_override[\s\S]*return \(v_override::text\)::boolean/)
})

test('ACC-03 AP, Bank, and Tax completeness is derived from evidence and reasons', () => {
  const latest = ['get_restaurant_ap_export_v3', 'get_restaurant_bank_export_v3', 'get_restaurant_tax_export_v3']
    .map(latestMigrationContaining).join('\n')
  for (const code of ['AP_CONTROL_DIFFERENCE', 'BANK_PACKET_MISSING', 'BANK_UNRESOLVED_ALLOCATION', 'TAX_CONTROL_DIFFERENCE', 'TAX_REVIEW_PENDING']) {
    assert.ok(latest.includes(code), 'missing completeness reason ' + code)
  }
  assert.match(latest, /p_filters[\s\S]*unknown|unsupported/i)
  assert.match(latest, /_restaurant_record_accounting_export_v3\(p_lodge_id,'ap',[\s\S]*?v_data,v_complete/i)
  assert.match(latest, /_restaurant_record_accounting_export_v3\(p_lodge_id,'bank',[\s\S]*?v_data,v_complete/i)
  assert.match(latest, /_restaurant_record_accounting_export_v3\(p_lodge_id,'tax',[\s\S]*?v_data,v_complete/i)
  assert.match(latest, /revoke all on function public\._restaurant_record_accounting_export_v3[\s\S]*from public,anon,authenticated/i)
  assert.match(latest, /grant execute on function public\._restaurant_record_accounting_export_v3[\s\S]*to service_role/i)
  assert.match(read('supabase/migrations/20261007060000_restaurant_accounting_staff_session_rpc_grants.sql'), /get_restaurant_ap_export_v3[\s\S]*to anon/i)
  assert.match(latest, /source_coverage_status/)
  assert.match(latest, /dataset_policy_version/)
  assert.ok(existsSync(resolve(root, 'docs/audits/2026-10-07/accounting-remediation/EXPORT_DATASET_POLICY.md')))
})

test('Accounting IPC keeps incomplete files blocked and reports failed artifact registration', () => {
  const main = read('src/main/index.js')
  const completeness = read('src/main/accountingExportCompleteness.js')
  assert.ok(main.includes('assertCompleteAccountingExport(unwrapAccountingExportResponse'))
  assert.match(completeness, /server did not certify every required source and reconciliation/)
  assert.match(completeness, /completeness_reasons/)
  assert.match(main, /artifact_status/)
  assert.match(main, /artifact registration failed|artifact record(?:ing)? failed/i)
  assert.match(main, /detailedCompanionHash/)
})

test('ledger export remains blocked until source coverage is certified', () => {
  const migration = latestMigrationContaining('get_restaurant_ledger_export_v3')
  assert.match(migration, /'complete', false/)
  assert.match(migration, /'dataset_status', 'blocked'/)
  assert.match(migration, /'source_coverage_status', 'unknown'/)
  assert.match(migration, /LEDGER_SOURCE_COVERAGE_UNKNOWN/)
  assert.match(migration, /_restaurant_record_accounting_export_v3\([\s\S]*?false[\s\S]*?'unknown'/)
  const unknown = {
    complete: false,
    source_coverage_status: 'unknown',
    completeness_reasons: [{
      code: 'LEDGER_SOURCE_COVERAGE_UNKNOWN',
      message: 'The ledger source population is not certified.'
    }]
  }
  assert.throws(() => assertCompleteAccountingExport(unknown), (error) => {
    assert.match(error.message, /Accounting export is INCOMPLETE/)
    assert.match(error.message, /LEDGER_SOURCE_COVERAGE_UNKNOWN/)
    return true
  })
})
test('closure evidence preserves the original audit and separates environment status', () => {
  assert.ok(existsSync(resolve(root, auditDir + '/REPORT.md')))
  assert.ok(existsSync(resolve(root, 'docs/audits/2026-10-07/accounting-remediation/CLOSURE_REGISTER.md')))
})

test('ACC-04 normalizer handles the deployed legacy response and rejects malformed data', () => {
  const row = { account_id: '11111111-1111-4111-8111-111111111111', code: '4000', name: 'Food Sales', account_type: 'revenue', months: { '1': '12.50' } }
  const legacy = normalizeBudgetResponse({ matrix: [row], complete: true, version_id: null, version_status: null })
  assert.equal(legacy.valid, true)
  assert.deepEqual(legacy.data.templates, [])
  assert.equal(legacy.data.matrix[0].months['1'], 12.5)

  const nested = normalizeBudgetResponse({ success: true, data: { matrix: [row], templates: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Base', lines: [] }], complete: true } })
  assert.equal(nested.valid, true)
  assert.equal(nested.data.templates.length, 1)

  for (const malformed of [
    { matrix: [{ ...row, months: { '13': 1 } }], complete: true },
    { matrix: [{ ...row, months: { '1': -1 } }], complete: true },
    { matrix: [row], templates: null, complete: true },
    { matrix: [row], complete: 'true' }
  ]) assert.equal(normalizeBudgetResponse(malformed).valid, false)

  const incomplete = normalizeBudgetResponse({ matrix: [row], complete: false })
  assert.equal(incomplete.valid, true)
  assert.match(incomplete.error, /incomplete/i)
})
test('ACC-05 journal intent keeps a stable payload and isolates lodge/actor profiles', () => {
  const firstScope = journalIntentStorageKey('lodge-a', 'actor-a')
  assert.notEqual(firstScope, journalIntentStorageKey('lodge-b', 'actor-a'))
  assert.notEqual(firstScope, journalIntentStorageKey('lodge-a', 'actor-b'))
  const payload = normalizeManualJournalPayload({
    entryDate: '2026-10-07', description: '  correction  ', referenceNumber: ' R-1 ', evidenceRef: ' voucher-1 ',
    lines: [{ accountId: '11111111-1111-4111-8111-111111111111', debit: '10.00', credit: '', memo: '' }, { accountId: '22222222-2222-4222-8222-222222222222', debit: '', credit: '10.00', memo: ' offset ' }]
  })
  assert.equal(payload.description, 'correction')
  assert.equal(payload.reference_number, 'R-1')
  assert.equal(payload.lines[1].memo, 'offset')
  assert.throws(() => normalizeManualJournalPayload({ entryDate: '2026-10-07', description: 'x', evidenceRef: 'e', lines: [{ accountId: 'a', debit: 1, credit: 0 }, { accountId: 'b', debit: 0, credit: 2 }] }), /balance/i)

  const data = new Map()
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }
  const intent = createManualJournalIntent({ scopeKey: firstScope, payload, operationId: '33333333-3333-4333-8333-333333333333' })
  saveManualJournalIntent(storage, firstScope, intent)
  assert.deepEqual(loadManualJournalIntent(storage, firstScope, firstScope), intent)
  assert.equal(restoreManualJournalForm(intent).lines[1].credit, '10')
  assert.equal(loadManualJournalIntent(storage, journalIntentStorageKey('lodge-a', 'actor-b'), journalIntentStorageKey('lodge-a', 'actor-b')), null)
})
test('ACC-03 accepted export evidence preserves tax lineage and bank packet boundaries', () => {
  const taxGeneration = read('supabase/migrations/20261007070000_restaurant_tax_generator_parent_order.sql')
  const apTax = read('supabase/migrations/20261007080000_restaurant_ap_tax_treatment_contract.sql')
  const bankReview = read('supabase/migrations/20261007090000_restaurant_bank_match_completion_boundary.sql')
  const bankCompletion = read('supabase/migrations/20261007100000_restaurant_bank_balance_sequence_sign.sql')
  const bankPacket = read('supabase/migrations/20261007110000_restaurant_bank_packet_hash_and_opening_balance.sql')
  const bankImport = read('supabase/migrations/20261007120000_restaurant_bank_import_hash_canonicalization.sql')
  const packetReader = read('supabase/migrations/20261009030000_restaurant_bank_packet_reader_ordinal_order.sql')

  const taxReturnShell = taxGeneration.indexOf('insert into public.restaurant_tax_returns(')
  const firstAllocation = taxGeneration.indexOf('insert into public.restaurant_tax_detail_allocations(', taxReturnShell)
  assert.ok(taxReturnShell >= 0 && firstAllocation > taxReturnShell, 'tax return parent is persisted before source allocation foreign keys')
  assert.match(apTax, /v_tax > 0 and v_treatment <> 'taxable'/)
  assert.match(apTax, /tax_rate, tax_treatment[\s\S]*v_treatment/)

  assert.match(bankReview, /set reconciled_entry_id\s*=\s*v_entry\.id/i)
  assert.doesNotMatch(bankReview, /set is_reconciled\s*=/i, 'match review does not prematurely close the reconciliation')
  assert.match(bankCompletion, /set is_reconciled\s*=\s*true/i)
  assert.match(bankCompletion, /prior_balance\s*-\s*debit\s*\+\s*credit/i)
  assert.match(bankPacket, /opening_balance[\s\S]*debit[\s\S]*credit|debit[\s\S]*credit[\s\S]*opening_balance/i)
  assert.match(bankPacket, /actual_manifest[\s\S]*statement_hash/i)
  assert.match(bankImport, /round\(p_opening_balance,2\)[\s\S]*round\(p_closing_balance,2\)/)
  assert.match(packetReader, /coalesce\(t\.source_row_ordinal, manifest\.manifest_ordinal\)/i)
  assert.match(packetReader, /jsonb_array_elements[\s\S]*source_manifest[\s\S]*with ordinality/i)
  assert.match(packetReader, /jsonb_agg\(ordered_rows\.row_json order by ordered_rows\.row_ordinal\)/i)
  assert.match(packetReader, /m\.value->>'id'\s*=\s*t\.id::text/i, 'legacy imports may use only matching immutable manifest ordinality')
  assert.match(packetReader, /Statement row order is unverified/i)
  assert.match(packetReader, /having count\(\*\) > 1/i, 'duplicate effective ordinals fail closed')
  assert.doesNotMatch(packetReader, /update public\.restaurant_bank_reconciliation_packets/i, 'immutable packet rows and hashes are not rewritten')
  assert.doesNotMatch(packetReader, /order by t\.transaction_date\s*,\s*t\.id/i)
})

test('Accounting file summaries report nested authoritative primary source row counts', () => {
  assert.equal(accountingExportRowCount({ payload: { accounts: [{}, {}, {}] } }), 3)
  assert.equal(accountingExportRowCount({ payload: { row_count: 7, entries: [{}, {}, {}, {}, {}, {}, {}] } }), 7)
  assert.equal(accountingExportRowCount({ payload: { bills: [{}, {}], row_counts: { bills: 2, payments: 5 } } }), 2)
  assert.equal(accountingExportRowCount({ payload: { transactions: [{}, {}], row_counts: { statement_rows: 2, match_allocations: 2 } } }), 2)
  assert.equal(accountingExportRowCount({ payload: { allocations: [{}], row_counts: { returns: 1, allocations: 1 } } }), 1)
  assert.equal(accountingExportRowCount({ row_count: 0, payload: { accounts: [{}, {}] } }), 0)
  assert.equal(accountingExportRowCount({ payload: {} }), 0)
})
test('incomplete exports keep server reasons in the desktop refusal contract', () => {
  const source = {
    complete: false,
    payload: {
      completeness_reasons: [
        { code: 'AP_CONTROL_DIFFERENCE', count: 1, message: 'The payable control account does not reconcile.' },
        { code: 'AP_NO_RECOGNIZED_SOURCES', count: 0, message: 'No recognized AP liabilities exist at this cutoff.' }
      ]
    }
  }
  assert.throws(() => assertCompleteAccountingExport(source), (error) => {
    assert.match(error.message, /Accounting export is INCOMPLETE/)
    assert.match(error.message, /AP_CONTROL_DIFFERENCE: The payable control account does not reconcile\. \(1 affected\)/)
    assert.match(error.message, /AP_NO_RECOGNIZED_SOURCES: No recognized AP liabilities exist at this cutoff\. \(0 affected\)/)
    return true
  })

  const fallback = { complete: false, payload: { completeness_reasons: [] } }
  assert.throws(() => assertCompleteAccountingExport(fallback), /did not certify every required source and reconciliation/)
  const certified = { complete: true, dataset_status: 'certified', export_id: 'export-1', dataset_hash: 'hash-1' }
  assert.equal(assertCompleteAccountingExport(certified), certified)
})
test('REV-01 a point-in-time not-found result preserves the original journal identity and payload', async () => {
  const storage = new Map()
  const adapter = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
  const scope = journalIntentStorageKey('lodge-review', 'actor-maker')
  const payload = { entry_date: '2026-10-08', description: 'Delayed request', evidence_ref: 'synthetic://review', lines: [{ account_id: 'cash', debit: 10, credit: 0 }, { account_id: 'equity', debit: 0, credit: 10 }] }
  const intent = createManualJournalIntent({ scopeKey: scope, payload, operationId: '15149eb8-5d72-4035-910a-94b1feaf91f8' })
  saveManualJournalIntent(adapter, scope, intent)
  const recovery = reconcileManualJournalStatus(intent, { found: false })
  assert.equal(recovery.terminal, false)
  assert.equal(recovery.intent.operationId, intent.operationId)
  assert.deepEqual(recovery.intent.payload, intent.payload)
  saveManualJournalIntent(adapter, scope, recovery.intent)
  const afterRestart = loadManualJournalIntent(adapter, scope, scope)
  assert.equal(afterRestart.operationId, intent.operationId)
  assert.deepEqual(afterRestart.payload, payload)

  // A request that was delayed before reaching the server lock and a retry from
  // a reloaded client converge on the same key/row; no replacement UUID exists.
  const rows = new Map()
  const locks = new Map()
  const submit = async (candidate) => {
    const key = candidate.operationId
    const prior = locks.get(key) || Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    locks.set(key, prior.then(() => current))
    await prior
    try {
      if (!rows.has(key)) rows.set(key, { id: 'draft-1', payload: candidate.payload })
      return rows.get(key)
    } finally { release() }
  }
  let releaseDelayed
  const delayedGate = new Promise((resolve) => { releaseDelayed = resolve })
  const delayedArrival = delayedGate.then(() => submit(intent))
  const retryResult = await submit(afterRestart)
  releaseDelayed()
  const lateResult = await delayedArrival
  assert.equal(retryResult.id, lateResult.id)
  assert.equal(rows.size, 1)
  assert.deepEqual(rows.get(intent.operationId).payload, payload)

  const ledger = read('src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx')
  assert.doesNotMatch(ledger, /Discard and edit|discardUncommittedJournal/)
  assert.match(ledger, /reconcileManualJournalStatus\(pendingJournalIntent,result\)/)
  assert.match(ledger, /Retry original submission/)
  assert.match(ledger, /disabled=\{Boolean\(pendingJournalIntent\)\}/)
})

test('REV-02 bank statement ordinal controls same-day sequence, closing balance and packet/export order', () => {
  const migration = read('supabase/migrations/20261008010000_accounting_independent_review_fixes.sql')
  const importer = migration.slice(migration.indexOf('create or replace function public.import_bank_statement_v3'), migration.indexOf('create or replace function public.complete_bank_reconciliation_v2'))
  const complete = migration.slice(migration.indexOf('create or replace function public.complete_bank_reconciliation_v2'), migration.indexOf('create or replace function public.get_restaurant_bank_export_v3'))
  const bankExport = migration.slice(migration.indexOf('create or replace function public.get_restaurant_bank_export_v3'))
  assert.match(migration, /unique index[^;]*statement_import_id,source_row_ordinal/i)
  assert.match(importer, /with ordinality[\s\S]*order by ordinality/i)
  assert.match(importer, /source_row_ordinal\)[\s\S]*v_import,v_ordinal/i)
  assert.match(importer, /jsonb_build_object\('bank_account_id',p_bank_account_id,'rows',p_rows,'opening_balance'/, 'the legacy import hash payload remains byte-contract compatible')
  assert.match(complete, /lag\(t\.balance_after\) over\(order by t\.source_row_ordinal\)/i)
  assert.match(complete, /order by t\.source_row_ordinal desc limit 1/i)
  assert.match(complete, /jsonb_agg\(to_jsonb\(t\) order by t\.source_row_ordinal\)/i)
  assert.match(bankExport, /case when t\.source_row_ordinal is not null then t\.source_row_ordinal[\s\S]*source_manifest/)
  assert.match(bankExport, /order by t\.packet_row_ordinal nulls last/i)
  assert.match(bankExport, /order by z\.packet_row_ordinal desc nulls last/i)
  assert.match(bankExport, /BANK_ORDER_UNVERIFIED/)
  assert.match(bankExport, /to_jsonb\(t\)-'source_row_ordinal'/, 'legacy manifests omit the newly added field for immutable hash comparison')
  assert.doesNotMatch(complete + bankExport, /order by [tz]\.transaction_date\s*,\s*[tz]\.id/i)
  assert.doesNotMatch(migration, /update public\.restaurant_bank_reconciliation_packets/i, 'immutable packet hashes are not rewritten')

  const ids = ['ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111']
  const entries = [
    { day: '2026-10-08', description: 'Repeated credit', debit: 0, credit: 10, balance: 110 },
    { day: '2026-10-08', description: 'Same debit', debit: 5, credit: 0, balance: 105 },
    { day: '2026-10-08', description: 'Repeated credit', debit: 0, credit: 10, balance: 115 },
    { day: '2026-10-08', description: 'Same debit', debit: 5, credit: 0, balance: 110 }
  ].map((row, index) => ({ ...row, id: ids[index], source_row_ordinal: index + 1 }))
  const reconstructed = [...entries].sort((a, b) => a.source_row_ordinal - b.source_row_ordinal)
  let balance = 100
  for (const row of reconstructed) {
    balance += row.credit - row.debit
    assert.equal(balance, row.balance)
  }
  assert.equal(balance, 110)
  assert.notDeepEqual([...entries].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.source_row_ordinal), [1, 2, 3, 4])
  assert.deepEqual(reconstructed.map((row) => row.description), ['Repeated credit', 'Same debit', 'Repeated credit', 'Same debit'])
})

test('REV-03 remediation regressions are discoverable by the maintained Restaurant gate', () => {
  const runner = read('tests/run-restaurant-suite.mjs')
  const fileName = 'restaurant-accounting-remediation-regressions.test.mjs'
  assert.match(runner, /restaurant-.*\\\.test\\\.mjs/)
  assert.match(fileName, /^restaurant-.*\.test\.mjs$/)
  assert.match(read('tests/' + fileName), /accounting-remediation-regressions/)
})

test('BUD-03 budget exports require a complete matrix and independently approved version', () => {
  const migration = latestMigrationContaining('get_restaurant_budget_export_v3')
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id,'accounting\.export'\)/)
  assert.match(migration, /v_matrix_complete:=coalesce\(\(v_data->>'complete_matrix'\)::boolean,false\)/)
  assert.match(migration, /restaurant_budget_versions b[\s\S]*b\.lodge_id=p_lodge_id and b\.period_year=p_year/)
  assert.match(migration, /b\.status='approved' and b\.approved_by is not null and b\.approved_by<>b\.created_by/)
  assert.match(migration, /v_complete:=v_matrix_complete and v_approval_complete/)
  assert.match(migration, /BUDGET_MATRIX_INCOMPLETE/)
  assert.match(migration, /BUDGET_VERSION_APPROVAL_REQUIRED/)
  assert.match(migration, /complete_matrix',v_complete/)
  assert.match(migration, /'unknown','not_applicable'/, 'matrix approval must not imply unrelated source-coverage certification')
  assert.match(migration, /revoke all on function public\.get_restaurant_budget_export_v3[\s\S]*grant execute on function public\.get_restaurant_budget_export_v3[\s\S]*to authenticated,service_role/i)
})
test('Accounting export test redirect replaces only native save-dialog selection and is disabled in packaged apps', async () => {
  const target = 'docs/audits/2026-10-08/accounting-independent-review/evidence/budget.json'
  let calls = 0
  const dialog = { showSaveDialog: async () => { calls += 1; return { filePath: 'native-path', canceled: false } } }
  const redirectedEnv = { BOROKO_TEST_ACCOUNTING_EXPORT_DIALOG_REDIRECT: '1', BOROKO_TEST_ACCOUNTING_EXPORT_SAVE_PATH: target }
  const redirected = await showAccountingExportSaveDialog({ app: { isPackaged: false }, dialog, parentWindow: null, options: {}, env: redirectedEnv })
  assert.equal(redirected.filePath, resolve(root, target))
  assert.equal(redirected.canceled, false)
  assert.equal(calls, 0)
  assert.deepEqual(redirectedEnv, {})
  const packaged = await showAccountingExportSaveDialog({ app: { isPackaged: true }, dialog, parentWindow: null, options: {}, env: { ...redirectedEnv, BOROKO_TEST_ACCOUNTING_EXPORT_DIALOG_REDIRECT: '1', BOROKO_TEST_ACCOUNTING_EXPORT_SAVE_PATH: target } })
  assert.equal(packaged.filePath, 'native-path')
  assert.equal(calls, 1)
  const ordinary = await showAccountingExportSaveDialog({ app: { isPackaged: false }, dialog, parentWindow: null, options: {}, env: {} })
  assert.equal(ordinary.filePath, 'native-path')
  assert.equal(calls, 2)
})

test('BUD-04 budget export retains only the established anon staff-session RPC grant', () => {
  const migration = read('supabase/migrations/20261009020000_restaurant_budget_export_restore_staff_rpc_grant.sql')
  const contract = latestMigrationContaining('get_restaurant_budget_export_v3')
  assert.match(migration, /grant execute on function public\.get_restaurant_budget_export_v3\(uuid,integer,jsonb\) to anon/i)
  assert.doesNotMatch(migration, /to public|grant all|grant execute on all/i)
  assert.match(contract, /_restaurant_require_capability\(p_lodge_id,'accounting\.export'\)/)
  assert.match(read('supabase/migrations/20260924000001_accounting_workspace_anon_client_access.sql'), /'get_restaurant_budget_export_v3'/)
})

test('GL trial balance uses authoritative totals independently of journal paging', () => {
  const rows = [{ account_id: 'cash', debit: '12.34', credit: '0', balance: '12.34' }, { account_id: 'revenue', debit: 0, credit: 12.34, balance: 12.34 }];
  for (const payload of [{ trial_balance: rows }, { success: true, data: { trial_balance: rows } }]) {
    assert.deepEqual(normalizeTrialBalanceResponse(payload).map(({ debit, credit, balance }) => ({ debit, credit, balance })), [{ debit: 12.34, credit: 0, balance: 12.34 }, { debit: 0, credit: 12.34, balance: 12.34 }]);
  }
  assert.deepEqual(normalizeTrialBalanceResponse({ trial_balance: [] }), []);
  for (const payload of [null, {}, { data: { entries: [], complete: true } }, { success: false, trial_balance: rows }, { trial_balance: [null] }, { trial_balance: [{ ...rows[0], debit: null }] }, { trial_balance: [{ ...rows[0], credit: '' }] }, { trial_balance: [{ ...rows[0], balance: 'NaN' }] }, { trial_balance: [{ ...rows[0], debit: -1 }] }]) {
    assert.throws(() => normalizeTrialBalanceResponse(payload), /Trial balance unavailable/);
  }
  const ledger = read('src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx');
  assert.match(ledger, /accountingInvoke\('getLedger',filters\)/);
  assert.match(ledger, /setTrialBalance\(normalizeTrialBalanceResponse\(t\)\)/);
  assert.match(ledger, /Trial balance could not be verified/);
  assert.doesNotMatch(ledger, /workspace\.trial_balance\.(reduce|map)/);
});