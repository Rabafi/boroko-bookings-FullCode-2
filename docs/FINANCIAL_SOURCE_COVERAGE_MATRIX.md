# Financial Source Coverage Matrix

Version: `bar-accounting-financial-truth-v1`
Deployment status: local repository only as of 2026-08-07; no linked-database deployment claim is made.

Every post-cutover financial source must have one authoritative mutation, a subledger where applicable, one or more balanced journal lines, an audit event, a stable operation key and a report/export identity. Missing coverage is a release blocker, not a reason to show zero.

| Source | Authoritative mutation | Subledger/control | GL/source posting | Report/export | Local implementation | Deployment proof |
|---|---|---|---|---|---|---|
| POS sale/return/void | `create_pos_order_v3` + `post_pos_order_to_gl_v2` | order, tender allocation, account/voucher, inventory | atomic typed tender/category/COGS journal | POS transaction/export manifest | control-plane RPC, source metadata, trigger, loyalty repair | local-only |
| Open tab/split | `upsert_pos_tab`, `split_pos_tab_evenly` | tab snapshot/version | posts when settled through POS | server tab read model | snapshot, version and payload-hash retry contract | local-only |
| Direct expense | `create_expense` / lifecycle RPCs | evidence, operation ID, status | atomic expense journal when active | expense register/export | source posting, immutable posted state, paged read | local-only |
| AP bill/payment/credit note | `create_restaurant_bill_v3` (v2 compatibility wrapper), approve/pay/credit-note RPCs | recognized supplier bill, payment identity, evidence-backed credit-note subledger | AP accrual/payment/credit reversal journals + source postings | AP detail/aging/supplier statement/packet | multi-line evidence, base-currency fail-closed policy, maker-checker credit notes, control-account reconciliation | local-only |
| Inventory receipt/count/depletion | authoritative inventory/stocktake RPCs | movement, source document, operation, lot and cost evidence | COGS/valuation policy | stock/COGS export | locked absolute stocktake, recipe atomicity, evidence defaults and coverage RPC | local-only |
| Cash-up/settlement | shift cash-up/finalization RPCs | tender control totals, blind count | non-zero cash-over/short plus clearing-to-bank settlement journals | close packet | legacy editable drawer path retired; variance and settlement source postings are atomic | local-only |
| Payroll | calculate/approve/post/export/settle/reconcile/close workflow | expected workers, attendance dispositions, immutable snapshot and payment batch | payroll accrual plus liability-settlement journals + source postings | hashed payment batch and approved-version payslips | settlement operations, bank evidence, statutory provenance and attendance register | local-only |
| Bank import/match/close | bank import/match/reconciliation RPCs | import identity, row match, packet | bank journal/clearing | immutable reconciliation packet | existing rebuild plus packet table; full DB proof pending | local-only |
| Tax working paper | configured tax working-paper RPC plus governed adjustment/amendment RPCs | source/journal manifest, snapshot hash, debit/credit-note evidence | reconciles to posted journals; adjustments are explicit and reviewable | filing-grade working-paper envelope | corrected taxable base, stale detection, maker-checker and filed-return amendments | local-only |
| Budget | versioned matrix/template RPCs | scenario/version/approval | comparison only; never creates actuals | full matrix/variance export | idempotent matrix/template RPCs | local-only |
| Manual journal | draft/submit/approve/post/reverse RPCs | maker-checker and evidence | immutable journal | GL/trial balance export | existing journal controls plus report-run envelope | local-only |

The `get_restaurant_financial_source_coverage` RPC is the enablement control. Its result must be complete for the requested period; `restaurant_reconciliation_exceptions` must have no blocking open items; and the linked database, not this file, must be verified before enabling a lodge.

Historical rows are audited separately with `get_restaurant_historical_cutover_audit`. Its packet must retain candidate, posted, already-posted, reversible, missing-configuration, and unpostable-without-evidence counts/totals plus a deterministic source-manifest hash. `approve_restaurant_historical_cutover` requires an independent reviewer, unchanged hashes, review notes, and a complete audit before the batch can be applied by activation.
