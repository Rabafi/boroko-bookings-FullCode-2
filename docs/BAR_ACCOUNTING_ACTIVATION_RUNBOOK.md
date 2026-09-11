# Bar Accounting Activation Runbook

Date: 2026-09-08 (third verification repair pass, G1–G4 + G2). Status: **NOT
activated. Code, tests, three local forward migrations, and the operator
workflow are local-only; production activation remains explicitly
blocked.**

The per-signature authorization inventory is the reviewed
`ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md` (99 IPC operations, generated from
the live IPC map × domain exports × latest migration text, with executable
guards in `tests/bar-accounting-matrix.test.mjs`).

This runbook prepares the staged activation. It does not authorize grants,
deployment, credential distribution, or live-data work. No grant migration is
included: one is produced only after executable authorization proof on an
approved disposable target with real restricted roles.

## 1. Current state

- Eight Accounting pages exist on the explicit `restaurantAccountingV2`
  preload bridge (`src/preload/index.js`), domain
  (`src/main/domains/restaurantAccountingV2.js`), and IPC (`src/main/index.js`).
- The domain uses the ordinary session-bound Supabase client and requires
  online access (`requireOnline`). No service-role key is present in any
  distributed client path.
- Earlier read-only metadata found Accounting/ledger/budget/payroll functions
  with no EXECUTE for anon/authenticated. **Recheck current schema metadata
  before relying on any count**: migration files do not prove deployment.
- Renderer route protection exists (`RestaurantAccountingRoute`:
  `accounting.read` / `accounting.payroll_view`; commercial
  `restaurant_accounting` via `UpgradeWall`). UI enablement is not activation.

## 2. Authorization design (to be proven, not assumed)

- Tenant identity is derived server-side: the domain always sends
  `p_lodge_id: state.lodgeId` and every RPC must reject caller-supplied
  foreign lodge IDs. Verify per function on the linked schema.
- Required per-function proof: SECURITY DEFINER boundaries with hardened
  `search_path`, role/capability checks inside mutations and relevant reads,
  RLS coverage, journal idempotency (`p_idempotency_key` / `p_operation_id`
  required by `requireKey`), maker/checker separation (draft/submit/approve/
  post), period locks, immutable audit trails, payroll/private-field scoping,
  and tenant-aware cache keys (`dedupePromise` keys) with invalidation on
  tenant/session switch.
- Online failures must fail closed and preserve null/incomplete evidence
  (the domain throws; renderers must not convert that into zero/empty).
- Tax/payroll legal configuration needs approved jurisdiction-specific
  inputs. No statutory rates are invented here.

## 3. High-risk functions — reviewed mapping (verified-fix pass)

- `activate_restaurant_accounting` / `suspend_restaurant_accounting`:
  `accounting.manage` in the shipped IPC map (unchanged — no new capability
  invented). Activation additionally requires server-side readiness-true, an
  APPLIED cutover batch when POS history exists (approval alone is refused
  by the client before dispatch), and explicit effective dating;
  maker/checker on cutover is enforced by actor, not by splitting
  capabilities further. Reconciliation deliberately kept across UI/IPC/SQL.
- `approve_restaurant_historical_cutover` is wired end to end (domain +
  `approveCutover` IPC op + facade export, `accounting.manage`): previously
  the server required an approval no operator could give, making activation
  with POS history unreachable. Preparer≠approver is enforced server-side;
  the UI additionally disables self-approval with clear copy.
- Approval binds to the full reviewed revision (F1, hardened by G1 in the
  third repair pass): the reviewer explicitly confirms the DISPLAYED batch
  into an immutable snapshot scoped to the current tenant and selection
  (tenant, batch, status, preparer, opening hash, source hash; a null
  source is the documented nullable case for history-free batches, blank
  identity is malformed). Notes alone never authorize. Approval re-reads
  the batch and submits only on an exact snapshot match, sending opening
  hash, source identity, and preparation identity — never null-substituted,
  never auto-submitted. Local forward migration
  `supabase/migrations/20260908010000_accounting_approve_revision_binding.sql`
  (**authored, NOT applied**) supersedes the earlier hash-only repair: it
  drops the weaker 4-argument overload so no bypassing entry point remains
  executable, and the single strong 6-argument form validates all three
  reviewed identities null-safely (IS DISTINCT FROM rejects null-vs-value
  either way, where plain <> would not) under the batch row lock. This
  closes the source-only re-preparation race: same balances keep the
  opening hash while source/preparer change, and approval of the superseded
  revision is now rejected (23505) before any mutation. Every prior guard
  (status, preparer≠approver, balance shape, audit completeness,
  stored-vs-audit drift) is preserved; grants are authenticated +
  service_role on the new signature only, anon/public revoked.
- `apply_restaurant_historical_cutover` is wired (`applyCutover`,
  `accounting.manage`) with an explicit UI step: prepared → approved →
  applied → activate. Per-batch single flight (sync ref + busy key) plus
  server idempotent replay. Nominal and timeout paths share one
  reconciliation rule (F4): ONLY complete authoritative detail identifying
  the same batch as applied confirms; malformed envelopes, null/failed/
  wrong-batch detail, and non-applied statuses stay unconfirmed with the
  batch ID retained for same-batch retry. Direct RPC evidence is never
  accepted during a readback failure, and activation stays blocked until
  applied state is verified.
- Approval success notices reconcile authoritative state too (G4, hardened
  by H3 in the fourth repair pass): the RPC envelope alone never proves a
  commit — not even a well-shaped nominal success. The UI announces approval
  only on same-tenant/same-batch approved detail matching the COMPLETE
  reviewed revision: opening hash, strictly present source identity
  (explicit null allowed; absent/blank/wrong-type/conflicting never match),
  preparation identity equal to the reviewed preparer, a recorded approver
  who differs from the preparer (independent approval; the current operator
  need not be that approver, but then only the revision's approval is
  stated), and a snapshot scope equal to the requested batch/tenant.
  Undefined, malformed, lying, or lost responses with anything less stay
  unconfirmed with the original batch retained for refresh or same-batch
  retry. No automatic reapproval, no new batch, no inference of no-commit
  from rejection.
- Activation readback is fail-closed (F2): authoritative `active` must be
  an explicit boolean — `status` alone never confirms, and
  active:false + status:active is the scheduled future-effective state
  (reported as scheduled/not-yet-active, never as current activation).
  Cutover identity has one canonical field with conflicting-alias
  rejection; a no-cutover request matches only an explicitly present null.
- Batch loading follows one tenant/user/URL-scoped lifecycle (F3): direct
  URLs, reloads, and back/forward navigation resolve the authorized batch
  under the current session; session changes invalidate every in-flight
  list/readiness/account/detail read so prior-tenant data never reappears.
- `apply_restaurant_historical_cutover` is wired (`applyCutover`,
  `accounting.manage`) with an explicit UI step: prepared → approved →
  applied → activate. Per-batch single flight (sync ref + busy key) plus
  server idempotent replay; timeouts reload the same batch and confirm only
  on applied state with stored posting references.
- Cutover batch list/detail reads (`getCutoverBatches`/`getCutoverBatch`,
  `accounting.read`) let an independent reviewer load any prepared batch
  after sign-in/reload; absent-or-foreign batches answer identical nulls.
  Activation-state read (`getActivationState`, `accounting.read`) exposes
  the complete stored tuple for exact-match reconciliation.
- Local forward migration
  `supabase/migrations/20260907010000_accounting_cutover_reads_and_activation_grants.sql`
  (**authored, NOT applied**): repairs two undefined-column runtime failures
  found by inspection (`approved_at` missing breaks approve; `applied_at`
  missing breaks activate-with-cutover — both raise 42703), adds the three
  read RPCs above, and grants authenticated EXECUTE on the activation
  lifecycle surface only (anon/public stay revoked; service_role untouched).
  Deployment requires the exact-target approval in
  `docs/ACCOUNTING_SQL_ACCEPTANCE.md`.
- Operator workflow: `RestaurantAccountingActivation.jsx` on route
  `restaurant/accounting-setup` (read gate + manage-gated actions), linked
  from the readiness notice on every accounting page. Browser-tested
  end to end with stateful mocked IPC (W0/W0b/W1/W1b–W7 plus X1/X1b/X1c
  drift and missing-evidence binding, X2 scheduled state, X3/X3b/X3c URL
  restore/navigation/session-invalidation, X4/X4b apply-evidence rules,
  Y1 source-only race rejection, Y2 approval-evidence reconciliation,
  Y3 production HashRouter cold-URL restore, Z1 later-revision approval
  never confirming the old review).

## 4. Executable acceptance (blocked: needs approved disposable target)

On the approved disposable target with synthetic tenants A and B and real
restricted roles via the ordinary app client: chart/opening repeatability and
balance; balanced maker/checker journals with locked-period and reversal
rules; one GL effect per committed sale/return/void with replay safety;
AP uniqueness/partial/overpayment races; bank import/match/settlement;
versioned tax config and amendments; approved budgets/statements with
assets = liabilities + equity; payroll privacy and no self-approval;
readiness-blocked close with audited reopen; exports reconciling UI totals
with no cross-tenant or payroll leakage.

## 5. Staged activation proposal (after proof only)

1. Draft a local forward migration naming exact function signatures with
   minimum grants (authenticated only where a documented contract requires
   it; anon closed by default). Never embed a service-role key in clients.
2. Test readiness-false, feature-disabled, permission-revoked, and
   partial-upgrade states.
3. Obtain explicit approval; apply to production; verify normal-client reads
   and mutations; record exact migration IDs and evidence.

## 6. Safe deactivation runbook

Suspend via `suspend_restaurant_accounting` (audited, capability-gated).
Deactivation hides navigation and stops new work; it never deletes posted
records, reverses money, or blocks authorized retained-history reads.
Retained history stays readable through the same authorized contracts.

## 7. Function matrix

Generated 2026-09-07 from `src/main/domains/restaurantAccountingV2.js`
(112 mapped; 1 export unmatched by the generator — re-verify count against
source). The Capability column is a verb heuristic and starting point only;
see section 3 for mandatory corrections before any grant work.

Domain export | RPC | Kind | Capability (heuristic — review) | Notes
---|---|---|---|---
getRestaurantAccountsV2 | get_restaurant_accounts | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantChartExportV2 | get_restaurant_chart_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantChartExportV3 | get_restaurant_chart_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantAccountV2 | create_restaurant_account | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
updateRestaurantAccountV2 | update_restaurant_account | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantAccountCashFlowV2 | set_restaurant_account_cash_flow_classification | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
deleteRestaurantAccountV2 | delete_restaurant_account | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
seedRestaurantAccountsV2 | seed_restaurant_default_accounts | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
postRestaurantOpeningBalanceV2 | post_restaurant_opening_balance | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantLedgerWorkspaceV2 | get_restaurant_ledger_workspace_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantLedgerPageV2 | get_restaurant_ledger_workspace_page_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantLedgerExportV2 | get_restaurant_ledger_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantLedgerReportExportV2 | get_restaurant_ledger_report_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantLedgerExportV3 | get_restaurant_ledger_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantJournalV2 | create_restaurant_journal_entry | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantManualJournalDraftV2 | create_restaurant_manual_journal_draft | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
submitRestaurantManualJournalV2 | submit_restaurant_manual_journal | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantManualJournalV2 | approve_restaurant_manual_journal | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
postRestaurantManualJournalV2 | post_restaurant_manual_journal | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reverseRestaurantJournalV2 | reverse_restaurant_journal_entry | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPosMappingsV2 | get_restaurant_pos_gl_mappings | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPosMappingV2 | set_restaurant_pos_gl_mapping | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPosMappingEffectiveV2 | set_restaurant_pos_gl_mapping_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
postRestaurantPosOrderV2 | post_pos_order_to_gl_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantApWorkspaceV2 | get_restaurant_ap_workspace_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantApExportV2 | get_restaurant_ap_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantApExportV3 | get_restaurant_ap_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantApSupplierStatementV2 | get_restaurant_supplier_statement_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantApGlSettingsV2 | set_restaurant_ap_gl_settings | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantBillV2 | create_restaurant_bill_v3 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
submitRestaurantBillV2 | submit_restaurant_bill | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantBillV2 | approve_restaurant_bill | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
payRestaurantBillV2 | record_restaurant_bill_payment_v2 | mutation | accounting.ap_pay | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantApCreditNoteV2 | create_restaurant_ap_credit_note_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
submitRestaurantApCreditNoteV2 | submit_restaurant_ap_credit_note_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantApCreditNoteV2 | approve_restaurant_ap_credit_note_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
saveRestaurantBankAccountV2 | save_restaurant_bank_account_v2 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBankWorkspaceV2 | get_restaurant_bank_workspace_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBankMatchCandidatesV1 | get_bank_match_candidates_v1 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBankExportV2 | get_restaurant_bank_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBankExportV3 | get_restaurant_bank_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
importRestaurantBankStatementV2 | import_bank_statement_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
importRestaurantBankStatementV3 | import_bank_statement_v3 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
proposeRestaurantBankMatchesV2 | propose_bank_matches_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reviewRestaurantBankMatchV2 | review_bank_match_v2 | mutation | accounting.bank_approve | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
proposeRestaurantBankMatchAllocationV1 | propose_bank_match_allocations_v1 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reviewRestaurantBankMatchAllocationV1 | review_bank_match_allocation_v1 | mutation | accounting.bank_approve | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
exceptRestaurantBankTransactionV2 | set_bank_transaction_exception | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantBankReconciliationV2 | create_bank_reconciliation_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
completeRestaurantBankReconciliationV2 | complete_bank_reconciliation_v2 | mutation | accounting.close | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBankReconciliationPacketV2 | get_restaurant_bank_reconciliation_packet_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
matchRestaurantSettlementToBankTransactionV2 | match_restaurant_settlement_to_bank_transaction | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantTaxWorkspaceV2 | get_restaurant_tax_working_papers_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantTaxAdjustmentsV2 | get_restaurant_tax_adjustments | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantTaxExportV2 | get_restaurant_tax_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantTaxExportV3 | get_restaurant_tax_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantTaxConfigurationV2 | set_restaurant_tax_configuration | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
generateRestaurantTaxWorkingPaperV2 | generate_restaurant_tax_working_paper | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantTaxAmendmentV2 | create_restaurant_tax_amendment | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
generateRestaurantTaxAmendmentWorkingPaperV2 | generate_restaurant_tax_amendment_working_paper | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
recordRestaurantTaxAdjustmentV2 | record_restaurant_tax_adjustment | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantTaxAdjustmentV2 | approve_restaurant_tax_adjustment | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reviewRestaurantTaxWorkingPaperV2 | review_restaurant_tax_working_paper | mutation | accounting.bank_approve | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantTaxWorkingPaperV2 | approve_restaurant_tax_working_paper | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
fileRestaurantTaxWorkingPaperV2 | record_restaurant_tax_filing | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantTaxFilingPacketV2 | get_restaurant_tax_filing_packet_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBudgetMatrixV2 | get_restaurant_budget_matrix_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBudgetExportV2 | get_restaurant_budget_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantBudgetExportV3 | get_restaurant_budget_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
saveRestaurantBudgetMatrixV2 | save_restaurant_budget_matrix_v2 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantBudgetVersionV2 | approve_restaurant_budget_version | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantBudgetTemplateV2 | create_restaurant_budget_template_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
applyRestaurantBudgetTemplateV2 | apply_restaurant_budget_template_v2 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantFinancialStatementsV2 | get_restaurant_financial_statements_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantStatementsExportV2 | get_restaurant_statements_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantStatementsExportV3 | get_restaurant_statements_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollWorkspaceV2 | get_restaurant_payroll_workspace_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollExportV2 | get_restaurant_payroll_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollExportV3 | get_restaurant_payroll_export_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollRecordsV2 | get_restaurant_payroll_records_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPayrollTermsV2 | set_restaurant_payroll_employment_terms | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPayrollConfigurationV2 | set_restaurant_payroll_statutory_configuration_v3 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
createRestaurantPayPeriodV2 | create_restaurant_pay_period_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPayrollTimeV2 | set_restaurant_payroll_time_input | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantPayrollTimeV2 | approve_restaurant_payroll_time_input | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
calculateRestaurantPayrollV2 | calculate_restaurant_payroll_v3 | mutation | accounting.payroll_manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantPayrollV2 | approve_restaurant_payroll_v3 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
exportRestaurantPayrollPaymentsV2 | export_restaurant_payroll_payments_v4 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPayrollGlSettingsV2 | set_restaurant_payroll_gl_settings | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
postRestaurantPayrollV2 | post_restaurant_payroll_to_gl_v2 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
settleRestaurantPayrollV2 | settle_restaurant_payroll_v3 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reconcileRestaurantPayrollSettlementV2 | reconcile_restaurant_payroll_settlement_v3 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
closeRestaurantPayrollV2 | close_restaurant_payroll_v3 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollReadinessV2 | get_restaurant_payroll_readiness_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
setRestaurantPayrollAttendanceDispositionV2 | set_restaurant_payroll_attendance_disposition_v3 | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPayrollAttendanceReconciliationV2 | get_restaurant_payroll_attendance_reconciliation_v3 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantAccountingReadinessV2 | get_restaurant_accounting_readiness | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
prepareRestaurantHistoricalCutoverV2 | prepare_restaurant_historical_cutover | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
activateRestaurantAccountingV2 | activate_restaurant_accounting | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
suspendRestaurantAccountingV2 | suspend_restaurant_accounting | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantFinancialSourceCoverageV2 | get_restaurant_financial_source_coverage | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
startRestaurantReportRunV2 | start_restaurant_report_run | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
completeRestaurantReportRunV2 | complete_restaurant_report_run | mutation | accounting.close | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
failRestaurantReportRunV2 | fail_restaurant_report_run | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
prepareRestaurantPeriodCloseV2 | prepare_restaurant_period_close | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
approveRestaurantPeriodCloseV2 | approve_restaurant_period_close | mutation | accounting.manage | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
reopenRestaurantPeriodCloseV2 | reopen_restaurant_period_close | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getRestaurantPeriodCloseV2 | get_restaurant_period_close | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getPosFinancialReportExportV2 | get_pos_financial_report_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
getLodgeOperationalReportExportV2 | get_lodge_operational_report_export_v2 | read | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
recordReportArtifactResult | record_report_artifact_result | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
recordAccountingExportArtifactV3 | record_accounting_export_artifact_v3 | mutation | accounting.read | tenant via p_lodge_id=state.lodgeId; grants+RLS RECHECK on linked schema
