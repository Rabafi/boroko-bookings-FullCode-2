# Bar, Accounting & Payroll Financial-Truth Remediation Plan

> **Status:** Active implementation handoff requested on 2026-08-07. This document combines the Bar/sidebar/Manage audit and the Accounting & Payroll/reporting audit. It records confirmed defects, required design decisions, implementation order, tests, deployment gates, and acceptance criteria. It does **not** claim that any defect is fixed or that the Accounting & Workforce add-on is safe to sell or enable.
>
> **Primary objective:** Make every number traceable from an authoritative source transaction through its subledger, general ledger, reconciliation, screen, and export—without silent truncation, cache substitution, client-authored financial truth, duplicate replay, or unexplained balancing adjustments.

## 1. Executive verdict

The current system contains several strong server-authoritative components, but it does not yet provide one complete financial chain across Bar operations, Accounting & Payroll, management reporting, and exports.

The most serious conclusions are:

1. **Restaurant/Bar Accounting remains a no-ship surface.** Its tables and RPCs are deliberately service-role-only. Do not restore authenticated grants until the behavioral, authorization, reconciliation, and deployment gates in this plan pass.
2. **The general ledger is not automatically fed by most of the app.** Manual/opening/reversal journals, one-at-a-time POS posting, AP, and payroll exist, but ordinary POS sales/returns/voids, stock/COGS, cash-up differences, expenses, settlements, booking/event flows, customer credit, vouchers, and several other sources are not a complete atomic posting chain.
3. **The current financial-statement SQL can return false results.** Date and posted-state filters are attached to a nullable joined journal-entry row while journal lines are still summed, and the balance sheet mixes cumulative balances with selected-period earnings.
4. **Bar customer-account and voucher checkout are not financially atomic.** A customer-account tender can close a sale without creating the matching receivable entry, while voucher redemption occurs after the sale and is skipped offline.
5. **Online POS receipts can print client-calculated totals instead of the server-authoritative result.** This can make the operator-facing receipt disagree with the stored order.
6. **The legacy cash-drawer close lets the operator author part of the expected amount.** It also auto-closes an existing session without a proper count/reconciliation. The newer blind shift cash-up path is the correct foundation; the legacy path must be retired.
7. **Reports and exports are not reliably complete.** POS and expense reads have hard limits, the UI renders further subsets, some export enrichment failures are swallowed, and neither report manifests nor immutable control totals prove that every source row was included.
8. **Several Accounting pages are polished entry screens over incomplete accounting workflows.** AP, bank reconciliation, tax, budgets, statements, and payroll require substantive accounting controls—not merely UI refinements.
9. **Management “net” and “profit” metrics are operational estimates, not accounting profit.** They omit or misuse COGS, payroll, accruals, tax, tips, settlement fees, liabilities, depreciation, and other ledger facts.
10. **Most existing Accounting tests are structural/regex tests.** They prove code shape, not transaction behavior. The behavioral suite currently depends on a disposable PostgreSQL/Supabase instance that was unavailable during the audit.

Until this plan is complete, the honest product position is:

- Bar POS can remain available only for the workflows already covered by authoritative POS/stock/cash-up contracts.
- Customer-account tender, voucher tender, accounting statements, tax filing packs, payroll payment claims, and financial-grade report exports must remain disabled or explicitly labelled unavailable.
- Operational dashboards must not be presented as a P&L, net profit, or bank-reconciled financial statement.

## 2. Required first actions for the implementing model

Before editing anything:

1. Read `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, and `docs/SHIP_READY_RUNBOOK.md` in full.
2. Run `git status --short` and preserve all unrelated work. At the time of this handoff the tree is dirty, including active cash-up/POS work and untracked forward migrations dated 2026-08-05 and 2026-08-06. Do not reset, overwrite, rename, or silently absorb that work.
3. Re-read every current file listed in section 5. Line numbers in this document are audit anchors, not a substitute for reading the current code after other changes land.
4. List the current migration tail and choose the next unused timestamp. Add forward-only migrations; never edit an already deployed migration to make a test pass.
5. Verify the linked Supabase migration history, function signatures, grants, RLS policies, and lint result separately from the repository. Local SQL is not proof of deployment.
6. Establish a disposable PostgreSQL/Supabase database for behavioral tests. Do not restore Accounting grants based only on regex/static tests.
7. Obtain explicit accounting-policy sign-off for the chart, revenue recognition, VAT treatment, inventory costing, voucher treatment, tips, payroll liabilities, settlement fees, cash over/short, period close, and historical cutover. Code must implement approved policy, not invent it.
8. Work in narrow vertical slices. Each financially meaningful slice must include the forward migration, authoritative RPC, desktop/PWA/Legacy POS callers as applicable, offline replay, UI recovery state, reports, audit evidence, and behavioral tests.

## 3. Non-negotiable truth contract

Every financial result must satisfy all of the following:

```text
operator intent
  -> durable operation envelope and stable idempotency key
  -> server-side identity, capability, lodge and outlet validation
  -> row locks and state-transition validation
  -> authoritative price/tax/cost/balance calculation
  -> atomic business mutation + subledger mutation + GL posting + audit
  -> immutable authoritative result snapshot
  -> cache/UI reconciliation
  -> report control totals and source links
  -> export manifest, row counts and hashes
```

The following are forbidden:

- Client-authored payment status, amount paid, tax payable, expected cash, profit, voucher balance, receivable balance, payroll tax, or financial-statement totals.
- A second idempotency key after an ambiguous timeout.
- Posting a sale first and its tender, voucher, receivable, stock, or GL effect later as an unrelated best-effort call.
- Editing or deleting posted financial records. Corrections use governed reversals or compensating entries linked to the original.
- Treating cached or partially loaded data as a complete financial report.
- Exporting the rows currently visible on screen and calling the file complete.
- Labelling inventory purchases as COGS, cash receipts as revenue, customer-credit allocation as new cash, or a cash-up as revenue recognition.
- Unlocking a period or forcing a reconciliation to zero without an approved, reasoned, auditable workflow.
- Enabling an add-on because its UI builds while its database contract remains denied or behaviorally unproved.

## 4. Scope map

### 4.1 Bar primary rail

| Route | Page | Main financial concern |
|---|---|---|
| `/hpos/pos` | Sell | Atomic pricing, tenders, account/voucher liability, receipt truth, returns/voids, stock and GL |
| `/hpos/checks` | Open tabs | Authoritative tab value, concurrency/versioning, exact-once split/settle |
| `/hpos/menu` | Products | Atomic product/pack changes, catalogue readiness, price history and error visibility |
| `/hpos/stock` | Stock | Absolute counts under lock, receipt/cost evidence, durable retry, valuation |
| `/hpos/cash` | Cash & close | Blind count, server expected amount, tender/shift/outlet scope, review and period effects |
| `/hpos/reports` | Sales | Complete data, correct return/cancel treatment, business date, split tenders and exports |

### 4.2 Bar Manage and add-ons

The plan also covers Staff accounts, Shifts & cashiers, Audit, Checklists, bar/customer displays, Settings, System Health, Subscription, Data/backup, Expenses, Customers & loyalty, Vouchers, advanced inventory/recipes, multi-outlet/owner control, and Business Control. Pages without a confirmed arithmetic defect still require regression coverage because their permissions, configuration, queue state, or display claims affect financial interpretation.

### 4.3 Accounting & Payroll pages

| Route | Page |
|---|---|
| `/restaurant/chart-of-accounts` | Chart of Accounts |
| `/restaurant/general-ledger` | General Ledger |
| `/restaurant/accounts-payable` | Accounts Payable |
| `/restaurant/bank-reconciliation` | Bank Reconciliation |
| `/restaurant/tax-returns` | Tax Working Papers / Returns |
| `/restaurant/budgets` | Budgets |
| `/restaurant/balance-sheet` | Financial Statements |
| `/restaurant/payroll` | Payroll |

## 5. Current code surfaces that must be traced

This is a minimum list, not permission to ignore callers found by search.

### Navigation, commercial access and routes

- `src/shared/barModeProfile.js`
- `src/shared/moduleCatalog.js`
- `src/shared/commercialEntitlements.js`
- `src/shared/commercialAccess.js`
- `src/shared/accessControl.js`
- `src/renderer/src/App.jsx`
- `src/renderer/src/components/hospitality-pos/HposManageHub.jsx`
- `src/renderer/src/components/hospitality-pos/HposNav.jsx`
- `src/renderer/src/components/hospitality-pos/HposDock.jsx`

### Bar operational UI and desktop domains

- `src/renderer/src/components/hospitality-pos/HposTerminal.jsx`
- `src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx`
- `src/renderer/src/components/hospitality-pos/HposMenu.jsx`
- `src/renderer/src/components/hospitality-pos/HposStock.jsx`
- `src/renderer/src/components/hospitality-pos/HposCashClose.jsx`
- `src/renderer/src/components/hospitality-pos/HposMyCashup.jsx`
- `src/renderer/src/components/hospitality-pos/HposSharedCashup.jsx`
- `src/renderer/src/components/hospitality-pos/HposTeam.jsx`
- `src/renderer/src/components/hospitality-pos/HposExpenses.jsx`
- `src/renderer/src/components/hospitality-pos/HposCustomers.jsx`
- `src/renderer/src/components/hospitality-pos/HposReports.jsx`
- `src/renderer/src/components/hospitality-pos/HposBusinessControl.jsx`
- `src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx`
- `src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx`
- `src/main/domains/pos.js`
- `src/main/domains/posOffline.js`
- `src/main/domains/posSubmitJournal.js`
- `src/main/domains/posShiftClose.js`
- `src/main/domains/inventory.js`
- `src/main/domains/expenses.js`
- `src/main/domains/customerCredit.js`
- `src/main/database.js`
- `src/main/index.js`
- `src/preload/index.js`
- `src/shared/syncQueue.js`

### Accounting and reporting

- `src/renderer/src/components/restaurant-accounting/RestaurantChartOfAccounts.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantAccountsPayable.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantBankReconciliation.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantTaxReturns.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantBudgets.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantBalanceSheet.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantPayroll.jsx`
- `src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx`
- `src/main/domains/restaurantAccountingV2.js`
- `src/main/domains/restaurantAccounting.js`
- `src/main/domains/reports.js`
- `src/main/domains/reportExport.js`
- `src/renderer/src/components/Reports.jsx`
- `src/renderer/src/components/AdvancedReports.jsx`
- `manager-pwa/src/lib/api.js`
- `manager-pwa/src/pages/Dashboard.jsx`
- `manager-pwa/src/pages/More.jsx`
- `legacy-pos/`

### Accounting migration chain

- `20260717020000_restaurant_general_ledger.sql` through the current Accounting migrations.
- Containment migrations `20260718050000` through `20260719030000`.
- Rebuild migrations `20260720010000` through `20260720130000`.
- All later POS, inventory, cash-up, reporting, customer-credit, and voucher migrations that supersede earlier behavior.

## 6. Combined confirmed issue register

Severity meanings:

- **P0:** Can create, display, export, or market materially false financial truth; blocks release/enablement.
- **P1:** Serious control, completeness, audit, accounting-UX, or recovery defect; must be fixed before financial-grade release.
- **P2:** Important usability/operability deficiency that can cause mistakes but is not by itself proof of false posting.

### 6.1 Cross-system and statements

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| FT-01 | P0 | Most operational sources do not atomically feed the GL. Search of `_restaurant_post_journal(...)` shows only opening/manual/reversal, manual POS posting, AP, and payroll callers. | A documented source-coverage matrix and atomic posting for every in-scope post-cutover source. |
| FT-02 | P0 | `get_restaurant_financial_statements_v2` left-joins journal lines before journal entries; entry-date and `is_posted` predicates do not prevent unrelated lines from being summed. | Correct relational filtering, preferably pre-aggregate filtered posted entries/lines. Add behavioral tests with out-of-period and unposted entries. |
| FT-03 | P0 | The balance sheet adds only selected-period earnings to cumulative balance-sheet accounts. Arbitrary start dates therefore produce false accounting-equation differences unless formal closing entries happen to align. | Define retained-earnings/closing policy. Balance sheet must be cumulative as of end date; P&L must be for the selected period. Prove the equation across multiple periods. |
| FT-04 | P0 | Accounting is exposed in the commercial/navigation model while its RPCs/tables remain service-role-only under no-ship containment. | Remove sale/activation/deep-link claims until readiness. Re-enable only explicit RPCs after behavior and grant audits. |
| FT-05 | P1 | There is no complete activation/cutover contract separating pre-accounting history, opening balances, backfill, and post-cutover automatic posting. | Add an explicit accounting effective date and governed opening/backfill workflow; never silently mix incomplete history with current statements. |

### 6.2 Sell / tenders / receipts / returns

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| POS-01 | P0 | The terminal sends `payment_method: account` plus `customer_account_charge`, but `create_pos_order_v3` does not process that object. The separate `charge_restaurant_account` RPC is not called by checkout. A sale can close without its receivable ledger entry. | One atomic POS RPC must validate customer/credit status, create the sale, customer-account ledger entry, tender allocation, stock, GL and audit. |
| POS-02 | P0 | Voucher redemption happens only after successful order creation and only online. The voucher is not an authoritative tender allocation in the order. A redemption failure leaves a recorded sale and an unreconciled voucher. | Voucher validation, row lock, redemption ledger, tender allocation, sale and GL must commit or roll back together. Offline replay must use the same contract. |
| POS-03 | P0 | The completed receipt overlays the server result with `orderPayload` totals/items/tender values from the client. Server repricing/promotion/tax can therefore disagree with the printed/displayed receipt. | Online receipts use only the server-returned immutable sale snapshot. Offline documents are conspicuously `PROVISIONAL — PENDING SERVER CONFIRMATION`. |
| POS-04 | P1 | Loyalty award is a post-sale best-effort call. Failure leaves the sale recorded and loyalty incomplete. | If loyalty is a contractual sale benefit, include it in the transaction; otherwise create an idempotent repair record with visible status and deterministic replay. |
| POS-05 | P1 | Tender mappings are free-form and allow semantically unsafe mappings, including treating customer account or voucher as generic assets. No completeness/readiness audit prevents posting with missing/wrong mappings. | Typed mapping roles with account-type constraints, effective dates and a blocking readiness check. Customer accounts map to AR; vouchers map to a liability. |
| POS-06 | P1 | Returns/voids are not part of a demonstrated end-to-end GL, tender, voucher/account, tax, tip, inventory and COGS reversal chain. | Reverse the original allocations and cost snapshots proportionally; never recalculate a historical return from current catalog price/cost/tax. |
| POS-07 | P1 | Card/mobile settlement and fees are not a complete clearing-to-bank workflow. | Post sale tenders to clearing accounts, then reconcile settlement batches and fees to bank deposits. |

### 6.3 Open tabs, products and stock

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| TAB-01 | P1 | Open-tab value is calculated from base unit price × quantity and omits modifiers, discounts, tax, tips and server repricing. | Server read model returns subtotal, discount, tax, tips, total and version from authoritative tab state. |
| TAB-02 | P1 | Split attempts use a fresh random UUID per attempt, so an ambiguous timeout followed by retry can submit another split. | Persist one operation envelope before the first request, reuse it until the outcome is resolved, and validate payload-hash reuse server-side. |
| TAB-03 | P1 | Tab edits/splits lack a clearly exposed optimistic-concurrency version in the UI contract. | Lock or compare a tab version; reject stale edits with a recoverable refresh/review path. |
| PROD-01 | P1 | Product save and 6/12/24 pack-template application are sequential. A later failure can leave a partially changed product. | Use one atomic product-plus-pack RPC or a durable resumable operation whose partial state is explicit and repairable. |
| PROD-02 | P1 | Product/menu initial loads swallow errors and can render an empty catalogue as if no products exist. | Show source/error/completeness state; never convert a failed financial/stock read into an unqualified empty list. |
| PROD-03 | P2 | Catalogue readiness is not a single enforced contract covering barcode uniqueness, stock link/depletion quantity, outlet publication and effective pricing. | Add server readiness validation and publish snapshots; block sale of invalid stock-tracked items. |
| STOCK-01 | P1 | Physical count computes a delta against the client/cached `current_stock`, then sends a generic adjustment. Concurrent sales/receipts can make the posted count wrong. | Absolute-count RPC locks the stock record, records system quantity, counted quantity, delta, cost snapshot, source, actor and operation key atomically. |
| STOCK-02 | P1 | Count/receipt actions generate new UUIDs per click without a durable attempt record. Ambiguous timeouts can duplicate movement. | Durable stable operation keys with a resolve/retry UI and server payload-hash validation. |
| STOCK-03 | P1 | Inventory receipts/counts lack a complete source-document and valuation contract suitable for AP, COGS and audit. | Capture supplier/document/date/outlet/lot/unit cost/tax/currency as applicable and post valuation consistently. |
| STOCK-04 | P1 | Reports that subtract inventory purchases as “cost” do not calculate actual COGS and can double-count purchases/expenses. | Use inventory valuation and consumption/recipe depletion for COGS; purchases affect inventory/AP/cash, not automatically period expense. |

### 6.4 Cash, expenses, staff and operational controls

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| CASH-01 | P0 | Legacy cash close lets the operator edit a “POS cash movement” included in expected cash, then sends a closing total that SQL trusts for variance. | Retire this path. Server computes expected cash from immutable shift/outlet events; operator enters only a blind physical count and reason/evidence where required. |
| CASH-02 | P0 | Opening a cash-drawer session can auto-close an existing lodge-wide session without a count/reconciliation and creates weak lodge-wide scope. | No auto-close. Sessions must be outlet/till/shift/operator scoped; abandon/reassign requires explicit approval, reason and audit. |
| CASH-03 | P1 | Cash-up is not yet proved against the complete tender set, retained cash tips, refunds, cash in/out, account/voucher tenders and settlement clearing. | One shift-close summary with control totals by tender and documented treatment for every event type. |
| EXP-01 | P1 | Expenses are mutable CRUD records; online and queued offline paths allow update/delete rather than correction/reversal. | Draft/submit/approve/post/pay/void lifecycle; no destructive deletion after approval/posting. Corrections are linked reversals or new versions. |
| EXP-02 | P1 | Expense fields omit evidence and accounting dimensions such as supplier/payee, payment method/account, receipt attachment, tax code, approval and stable financial operation ID. | Add required source evidence and typed posting data with capability and maker-checker rules proportionate to amount/risk. |
| EXP-03 | P1 | Expenses do not feed the Accounting GL, and the read is capped at 500 with cache substitution behavior. | Atomic posting and paginated authoritative reads. Reports/exports must disclose and reject incompleteness. |
| TEAM-01 | P1 | Clock-in/out UI creates fresh operation IDs per action; ambiguous outcomes are not durably recoverable. | Stable operation envelopes, server overlap constraints and an explicit resolve path. |
| TEAM-02 | P1 | Attendance/shift data and payroll time input are disconnected. Payroll can silently exclude workers rather than reconcile roster/time exceptions. | Controlled attendance-to-payroll import with a completeness register and manager review; no silent automatic wages and no silent omissions. |
| CTRL-01 | P1 | Audit/System Health cannot compensate for missing source postings, and current reads do not provide a unified posting-drift or incomplete-report signal. | Add financial source coverage, failed posting, queue ambiguity, subledger/GL drift and report completeness diagnostics. |
| CTRL-02 | P2 | Checklists are operational evidence, not accounting period-close evidence. | Keep operational checklists separate; create a governed accounting close checklist linked to objective control results. |

### 6.5 Chart of Accounts and General Ledger

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| COA-01 | P1 | The chart RPC returns `ledger_balance`; the page reads `row.balance`, displaying zero/incorrect balances. | One versioned DTO and contract test shared across RPC/domain/UI/export. |
| COA-02 | P1 | Chart activation/deactivation and mapping do not yet form a full readiness workflow that blocks unsafe financial posting. | Prevent deactivation of used/mapped control accounts; validate parent/type/control-account rules and expose mapping gaps. |
| GL-01 | P0 | General-ledger read has an unordered `LIMIT 500` inside the result construction, with no pagination, total count or truncation flag. Screens and any derived output can omit arbitrary entries. | Deterministic keyset pagination and a separate complete export/report-run path. Always return total/returned/completeness metadata. |
| GL-02 | P1 | Manual journals do not have a complete maker-checker, attachment/evidence and approval lifecycle. | Draft → submitted → approved/posted, with creator ≠ approver for configured risk, evidence, reversal and period lock enforcement. |
| GL-03 | P1 | Posting keys exist, but source coverage and payload-hash versioning are not consistently used by every domain. | Standardize `(lodge_id, posting_key)` uniqueness, source type/id/version, canonical payload hash and replay-result lookup. |

### 6.6 Accounts Payable

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| AP-01 | P1 | Outstanding/overdue read excludes only paid/cancelled and therefore includes draft/submitted bills that are not yet accrued. | Separate draft workflow from approved/posting liability and age only recognized AP. |
| AP-02 | P1 | UI supports only a minimal one-line bill flow and lacks supplier statement, aging, credit notes, corrections, attachments, tax/currency, PO/GRN and three-way-match evidence. | Implement a real bill header/lines lifecycle and at minimum aging, credit notes, document evidence and reconciliation. Make PO/GRN matching conditional on purchasing use. |
| AP-03 | P1 | Payment idempotency replay compares bill, amount and date but not payment account, reference or notes. | Canonical payload hash covers every financially meaningful field; conflicting key reuse fails. |
| AP-04 | P1 | UI keeps the AP payment idempotency key in `sessionStorage`; restart loses the attempt identity. | Persist unresolved operations durably and provide lookup/retry/cancel-after-proof workflow. |
| AP-05 | P1 | AP and direct Expenses can represent the same cost without a clear mutual-exclusion/control policy. | Define direct-paid expense versus supplier bill rules and add duplicate/reference controls and reconciliations. |

### 6.7 Bank reconciliation and period close

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| BANK-01 | P1 | CSV parsing uses naive comma splitting and breaks quoted fields/embedded commas. | RFC 4180-compliant parsing, encoding/date/decimal validation, preview and explicit column mapping. |
| BANK-02 | P1 | Automatic matching is largely exact amount within ±3 days and does not prove one journal line cannot be approved against multiple bank rows. | Database uniqueness/locking for approved matches, confidence reasons, split/combined matching, and reviewer evidence. |
| BANK-03 | P1 | Entered statement balance is not reconciled to imported `balance_after` evidence. | Verify opening + transactions = closing and compare entered closing to statement-derived closing before completion. |
| BANK-04 | P1 | Exceptions can net to zero through adjustments without adequate line-by-line evidence that each unmatched statement item is resolved. | Every exception must link to an individual statement row, journal/adjustment, reason, actor and approval. |
| BANK-05 | P0 | Completing one bank reconciliation inserts a lodge-wide accounting period lock, even if other bank accounts/subledgers are incomplete. There is no complete close/reopen workflow. | Separate bank-account reconciliation from accounting-period close. Period close requires all checklist controls; reopen requires independent approval, reason and audit. |
| BANK-06 | P1 | There is no immutable reconciliation packet/export with import identity, row counts, matched/unmatched detail, adjustments, reviewer names and hashes. | Produce a reproducible reconciliation report run and signed-off packet. |

### 6.8 Tax working papers

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| TAX-01 | P0 | Purchases sum includes asset lines, including input-tax asset, then input tax is reported separately; this can double-count input tax in “purchases ex tax.” | Derive taxable bases from explicit tax-detail/source allocations, not broad account types. Add arithmetic fixtures. |
| TAX-02 | P1 | Source coverage is limited to the incomplete GL and selected source types. | Tax pack must cover all configured taxable sources, exemptions/zero-rated items, debit/credit notes and adjustments. |
| TAX-03 | P1 | Snapshot stores totals/counts but not the immutable journal/source IDs and hashes needed to reproduce the return. | Store source manifest, configuration version, source hashes, generation/review/approval actors and timestamps. |
| TAX-04 | P1 | Review/approval/filing workflow lacks a full stale-source and amendment model. | Detect any post-generation source/config change; require regenerate or governed amendment; never present a stale pack as current. |
| TAX-05 | P1 | There is no filing-grade detailed export/working-paper packet. | Export summary, transaction detail, adjustments, reconciliation to GL control accounts and filing metadata. |

### 6.9 Budgets and financial statements

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| BUD-01 | P1 | Budget is primarily an entry matrix; no budget-vs-actual, variance, forecast, version/scenario, approval or commentary workflow exists. | Versioned annual budgets with complete account×12 matrices, approval/freeze, actual comparison, variance and export. |
| BUD-02 | P1 | Save validates supplied rows but does not prove the entire expected matrix is present or remove omitted old rows. It also accepts active non-P&L accounts even though the read shows revenue/expense accounts. | Server derives expected P&L accounts, validates all 12 months, upserts exact matrix and handles omissions explicitly. |
| FS-01 | P0 | Financial statements inherit the disconnected/incomplete GL and the SQL defects FT-02/FT-03. | Statements stay unavailable until GL source coverage, close state and SQL behavior are proved. |
| FS-02 | P1 | No comparative periods, opening/closing retained earnings bridge, accounting-basis disclosure, report status or drill-through completeness proof. | Add P&L, balance sheet, cash flow and trial balance with comparative columns, source drill-through and reconciliation metadata. |
| FS-03 | P1 | “Balance” can be presented without a closed/reconciled state or completeness warning. | Every statement states `draft/unclosed`, `closed`, or `reopened`, plus source cut-off and unresolved exceptions. |

### 6.10 Payroll

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| PAY-01 | P0 | Calculation loops only over approved time inputs. Active employees with missing terms/input are silently omitted, allowing an apparently valid but incomplete payroll. | Build an expected-worker register first; block calculation until every included/excluded worker has an explicit reviewed disposition. |
| PAY-02 | P1 | UI allows calculation for any draft, without a complete input-review readiness gate. | Server readiness RPC returns blocking exceptions; calculate is enabled only when the server says ready. |
| PAY-03 | P1 | Time input accepts a staff ID that can be missing/cross-lodge; later joins silently omit it. | Validate active lodge employment at write time and enforce FKs/constraints appropriate to the identity model. |
| PAY-04 | P1 | Employment terms are insert-only/open-ended and overlap rules make future terms hard to manage. | Effective-dated close/supersede workflow with non-overlap constraint and before/after audit. |
| PAY-05 | P1 | Period lifecycle has no complete close, correction, rollback/reopen or off-cycle adjustment workflow. | Explicit state machine with permitted transitions, maker-checker, reversal and locked-period rules. |
| PAY-06 | P0 | Generic tax brackets, two rates and a flat health deduction are not sufficient evidence of Botswana payroll compliance. Rate bounds/version provenance are weak. | Use effective-dated, jurisdiction-specific configuration approved against current official rules. Store source/version/effective dates; never hardcode unverified legal assumptions. |
| PAY-07 | P1 | Calculate/approve/post/export do not consistently use durable stable idempotency keys. | Stable operation IDs and payload hashes for every mutation and export run. |
| PAY-08 | P1 | Payroll posting creates liabilities and export says “not paid,” but there is no liability settlement/payment workflow. | Payment batch lifecycle posts bank/cash settlement against net/tax/deduction liabilities and reconciles to bank. |
| PAY-09 | P1 | Payroll CSV omits key controls such as period ID/dates, export ID/hash, employee count, control total, debit date and source account; UI discards the payload hash. | Bank/payment instruction export with immutable batch metadata, file hash, control totals and explicit `exported_not_paid` status. |
| PAY-10 | P1 | Bank/account/identity PII is handled as ordinary raw fields without sufficient UI warning, masking, retention or logging controls. | Minimize, mask and protect PII; capability-gate access; exclude from logs/support bundles; document retention and secure export handling. |
| PAY-11 | P1 | Payslips can be available while processing yet describe an approved snapshot; itemization/YTD/employer/statutory context is incomplete. | Payslips only from immutable approved calculation versions and include required earnings/deductions/YTD/employer/period identifiers. |
| PAY-12 | P1 | Several date defaults use UTC conversion, risking the wrong Botswana business/pay date around midnight. | Central lodge-timezone business-date service used by UI, RPC and report filters. |

### 6.11 Reports, dashboards and exports

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| REP-01 | P0 | `getPosOrders` limits results to 500. `HposReports` renders only 100 rows and PDF item detail is capped further. Excel/PDF can therefore look complete while omitting transactions. | Cursor-paginated screen; server/report-run export of the entire filtered population; explicit row/control totals and no hidden caps. |
| REP-02 | P1 | POS summary excludes voided but not consistently cancelled records; returns are negative inside labels such as “gross” and counts/averages can mix sales and returns. | Typed transaction model with separate sales, returns, voids/cancellations and net measures; documented formulas. |
| REP-03 | P1 | Screen and export classify split tenders differently, and `created_at` versus authoritative `business_date` is inconsistent. | One shared report dataset and business-date policy. Tender allocations are line-level, not collapsed to the word `split`. |
| REP-04 | P1 | Current POS export lacks immutable report identity/hash, source watermark, complete row counts/control totals, return linkage, original order, shift, business date, tax/item allocation, catalogue/cost snapshot, sync status and GL status. | Add a versioned detailed transaction export and a separate summary; every figure drills to source IDs. |
| REP-05 | P1 | Accounting pages other than payroll do not provide complete exports. | Chart, GL/trial balance, AP aging/detail, bank reconciliation, tax, budgets and statements each get appropriate full exports. |
| REP-06 | P0 | `HposBusinessControl` uses `Promise.allSettled` and usually fails only if all sources fail. Missing sources silently become zero/empty while “Net after expenses” is shown. | Fail closed for a financial claim. Operational dashboards must show per-source completeness and never calculate net/profit from missing sources. |
| REP-07 | P1 | Business-control “net” omits COGS, VAT, tips, payroll, AP/accruals, settlement fees, depreciation, stock liabilities and other facts. | Rename to a precisely defined operational metric or replace with GL-derived profit after Accounting readiness. |
| REP-08 | P1 | The detailed lodge workbook has strong base RPC reconciliation, but its P&L is operational aggregation: revenue minus expenses/purchases/supplies/maintenance. Purchases are not COGS and categories can double-count. | Do not call this accounting P&L. Once GL is ready, source P&L from posted ledger and provide an operational-to-GL bridge. |
| REP-09 | P0 | Supplemental export sheets use swallowed failures and metadata can still say “Server-authoritative (RPC).” Data/backup collection also has safe fallbacks to empty arrays. | Financial exports fail closed. If partial operational exports are allowed, manifest every omitted/failed section and watermark the file `INCOMPLETE`. |
| REP-10 | P1 | Cached/offline data can appear without a strong source/as-of/provisional marker. | Block statutory/financial statements offline. Watermark permitted operational exports with cache timestamp, pending queue counts and `PROVISIONAL`. |
| REP-11 | P1 | No immutable report-run record proves filters, code/schema version, generated-by, source cut-off, row counts, reconciliation state and output hash. | Add report-run manifests and hash the canonical dataset plus produced files. |

### 6.12 Test-evidence limitations

| ID | Sev. | Confirmed issue | Required outcome |
|---|---:|---|---|
| TEST-01 | P0 | Accounting statement/tax tests can pass by matching SQL text while missing incorrect arithmetic and join behavior. | Transactional database assertions with seeded source rows and exact expected balances. |
| TEST-02 | P1 | Accounting test set has stale contradictory expectations from earlier shutdown/API stages. | Replace chronology-based assertions with one current contract and retain historical shutdown only as security regression where still intended. |
| TEST-03 | P0 | Behavioral Accounting tests were not run because `127.0.0.1:54322` was unavailable. | A running disposable DB is a hard gate; test failure to connect is not a pass or waiver. |
| TEST-04 | P1 | Passing Bar/financial/offline suites are valuable but predominantly structural and do not prove cross-ledger financial equality. | Add end-to-end fixtures spanning source, subledger, GL, report and export. |

## 7. Target financial architecture

### 7.1 Accounting activation and cutover

Accounting is optional commercially, but financial integrity is not. Use this model:

1. Core operational subledgers—POS tenders, vouchers, customer AR/credit, stock movements and cash-up—must always be correct, whether or not the Accounting add-on is enabled.
2. Add `accounting_effective_from` (or an equivalent governed activation record), configuration version, opening-balance batch and activation approver.
3. Before activation, run a server readiness report proving chart/mappings, opening balances, source coverage, staff/payroll configuration, bank accounts, VAT configuration and unresolved exceptions.
4. From the effective timestamp forward, every covered business RPC must create its GL journal in the same PostgreSQL transaction. If required mappings are absent, fail closed with an actionable readiness error.
5. Historical activity before the cutover is represented by approved opening balances or an explicitly reviewed deterministic backfill. Never silently use only the latest 500 operational rows or current catalogue cost to invent history.
6. Statements must disclose the accounting effective date and whether comparatives are complete.

### 7.2 Posting identity and linkage

Extend the existing journal foundation rather than creating a competing ledger:

- Keep `restaurant_journal_entries`, `restaurant_journal_lines`, `_restaurant_post_journal`, unique `(lodge_id, posting_key)`, source type/id and payload hash.
- Add/standardize `source_version`, `source_business_date`, `outlet_id`, `operation_id`, reversal linkage and configuration/mapping version where missing.
- Every source table must be able to resolve its authoritative journal entry or posting status.
- Idempotent replay with the same canonical payload returns the original result. Reuse with a different payload fails with a dedicated conflict code.
- Posted journals are immutable. Reversal creates a linked opposite journal; it never edits/deletes the original.
- Internal posting helpers are not broad client APIs. Business RPCs call them after validating the domain event.

### 7.3 Minimum posting-policy matrix

Account IDs must come from typed lodge configuration; the labels below are accounting roles, not hardcoded account numbers.

| Source event | Debit | Credit | Additional truth |
|---|---|---|---|
| Cash/card/mobile POS sale | Cash or tender clearing | Revenue, output VAT, tips payable | Tender allocation equals authoritative total |
| Customer-account POS sale | Trade receivables | Revenue, output VAT, tips payable | Customer AR ledger entry in same transaction |
| Voucher sale/issue | Cash/clearing/AR | Voucher liability | Voucher issue ledger and expiry policy |
| Voucher redemption | Voucher liability plus any other tender | Revenue, output VAT, tips payable | Redemption linked to order; unused balance remains liability |
| POS COGS | COGS | Inventory | Use transaction-time cost/recipe snapshot |
| POS return/refund | Reverse original revenue/tax/tender and COGS/inventory | Exact proportional reversal | Link original order/lines and original snapshots |
| Card/mobile settlement | Bank and settlement-fee expense | Tender clearing | Batch/deposit/provider reference |
| Cash over/short | Cash or cash-over/short expense | Cash or cash-over/short income | Difference only; cash-up does not re-recognize revenue |
| Supplier bill | Expense/asset/inventory and input VAT | Accounts payable | Bill approval recognizes liability |
| Supplier payment | Accounts payable | Bank/cash | Payment linked to bill(s) and bank statement |
| Direct-paid expense | Expense/asset and input VAT | Bank/cash | Must not duplicate AP bill |
| Inventory receipt on credit | Inventory/input VAT | Accounts payable | Quantity and valuation source evidence |
| Payroll posting | Wage/employer costs | Net pay, PAYE and other liabilities | Approved immutable payroll version |
| Payroll settlement | Payable liabilities | Bank/cash | Payment batch and bank reconciliation |
| Customer-credit receipt | Cash/clearing | Customer-credit liability | Not booking revenue |
| Credit allocation to booking | Customer-credit liability | Booking receivable/deferred-revenue role per approved policy | No new cash |
| Booking/event payment | Cash/clearing/customer credit | Receivable/deferred revenue per policy | Separate cash collection from recognition |
| Booking/event refund | Reverse original cash/credit allocation | Appropriate receivable/liability | Retained fees separately classified |

An accountant must approve recognition timing for accommodation, events, deposits, service charges, expired vouchers and retained fees before implementation.

### 7.4 Reconciliation controls

Create a server-side reconciliation status read model with, at minimum:

- POS order totals = sum of tender allocations.
- Cash tender events ± authorized cash movements = shift expected cash.
- Customer-account subledger balance = AR control account.
- Customer-credit ledger balance = customer-credit liability control account.
- Voucher outstanding balance = voucher liability control account.
- Inventory valuation subledger = inventory control account.
- Approved unpaid supplier bills = AP control account.
- Payroll outstanding payment/tax/deduction batches = payroll liability control accounts.
- Bank GL balance = reconciled bank evidence plus outstanding items.
- Every posted journal balances, has an existing source, and is not duplicated.
- Every post-cutover financial source has exactly one current posting or a governed reversal chain.

Statements and period close must fail closed when a required control is out of tolerance.

### 7.5 Authoritative report contract

Financial report RPCs must return a versioned envelope, not an unqualified array:

```json
{
  "schema_version": "financial-report-v1",
  "report_run_id": "uuid",
  "report_type": "pos_transaction_detail",
  "parameters": {},
  "generated_at": "timestamptz",
  "data_cutoff": "timestamptz",
  "business_timezone": "Africa/Gaborone",
  "currency": "BWP",
  "source_mode": "server_authoritative",
  "status": "complete",
  "warnings": [],
  "row_count": 0,
  "control_totals": {},
  "reconciliations": {},
  "dataset_hash": "sha256:...",
  "next_cursor": null,
  "rows": []
}
```

Rules:

- UI pagination may fetch pages, but export generation must iterate the entire server-authoritative population or use a server-side report run.
- A limit is allowed only when accompanied by deterministic ordering, cursor, total/returned counts and an explicit completeness state.
- The XLSX/PDF/CSV metadata page/header includes report ID, lodge, outlets, filters, business timezone, currency, generated-by/time, data cut-off, row count, control totals, reconciliation status, schema/app version and hash.
- PDF may be a labelled summary only if a companion detailed file is referenced. It must not silently omit item rows.
- Financial/statutory exports fail if a required source fails. Partial exports are allowed only for operational diagnostics and must be visibly marked `INCOMPLETE` with a section-by-section manifest.

## 8. Phased implementation plan

Each phase ends with a deployable/testable vertical result. Do not merge all work into one migration or one enormous UI change.

### Phase 0 — Containment and evidence baseline

**Goal:** Prevent known false claims while establishing reproducible evidence.

Tasks:

1. Keep all Accounting tables/RPCs service-role-only. Confirm effective privileges for `public`, `anon`, and `authenticated` from PostgreSQL catalogs.
2. Hide or disable Accounting & Workforce purchase/activation and direct routes in Bar mode. Show a truthful “not yet available” state rather than a broken permission error.
3. Disable customer-account and voucher tender in checkout until the atomic POS contract is deployed and smoke-tested.
4. Retire the legacy editable-expected-cash close UI. Route operators to the current blind shift cash-up workflow.
5. Rename operational “profit/net/P&L” claims to formula-specific neutral terms, or hide them when any source is missing.
6. Add a visible completeness/error banner to POS reports, Business Control and data exports. Until full report RPCs exist, state the current row cap and prevent “complete” labelling.
7. Start a current audit evidence file recording baseline test commands, failures, linked migration state, linked grants and known lint findings.

Acceptance:

- No operator can create a false account/voucher sale, client-authored cash variance, or apparently complete truncated financial export.
- No sales/activation UI says the Accounting add-on is available.
- Existing working Bar sales, blind cash-up, inventory and offline flows are not regressed.

### Phase 1 — Behavioral database harness and accounting-policy decisions

**Goal:** Replace code-shape confidence with executable financial behavior.

Tasks:

1. Make the existing Accounting behavioral harness reliably start against a disposable database. It must apply the active baseline plus all forward migrations.
2. Create deterministic fixture builders for two lodges, two outlets, multiple users/capabilities, multiple periods and every tender/source type.
3. Add transaction assertions for rollback, duplicate replay, conflicting key reuse, concurrency, cross-lodge/outlet access and locked periods.
4. Add exact accounting fixtures for sales, returns, discounts, VAT, tips, account/voucher tenders, COGS, AP, direct expenses, settlements, cash differences, payroll and customer credit.
5. Record approved accounting policies and effective-dated regulatory configuration. For Botswana tax/payroll, verify against current BURS material before coding formulas; do not infer rates or contribution rules from the existing generic UI.
6. Reconcile and remove stale contradictory tests. Keep security shutdown assertions until replacement RPCs are individually released.

Acceptance:

- A connection failure is red, not skipped/passed.
- Tests assert database rows and exact balances, not just migration text.
- Policy decisions are documented and linked to configuration versions.

### Phase 2 — Ledger foundation, statement repair and accounting cutover

**Goal:** Establish one reliable journal contract before connecting more sources.

Tasks:

1. Add the accounting activation/effective-date record and readiness RPC.
2. Harden `_restaurant_post_journal`/journal schema with standardized source version, business date, outlet, operation ID, reversal and mapping/config version fields.
3. Add a server posting-status/source-coverage read model and reconciliation exceptions table. Exceptions require reason, owner, status and resolution link; they are not balancing entries.
4. Repair financial-statement queries by joining/filtering posted entries before aggregating lines.
5. Implement cumulative balance-sheet balances as of `end_date`; implement period P&L for `start_date..end_date`; bridge current earnings/retained earnings according to approved close policy.
6. Implement trial balance and statement cross-checks: total debits = credits, assets = liabilities + equity, P&L retained-earnings bridge and cash-flow-to-cash movement.
7. Add governed opening-balance/import and deterministic backfill dry-run. Historical rows without reliable cost/tax snapshots remain explicit exceptions; do not fabricate values.

Acceptance:

- Out-of-period and unposted lines never enter statements.
- Balance sheet balances for multiple arbitrary date ranges with and without close entries.
- No source is marked covered merely because a manual journal exists.
- Activation is impossible while required mappings/reconciliations are incomplete.

### Phase 3 — Atomic POS sale, account, voucher, receipt and reversal contract

**Goal:** Make checkout one exact-once financial transaction.

Implement a new forward-compatible RPC version, for example `create_pos_order_v4`; use the next valid project naming/version decision after inspecting every caller.

Input contract:

- Stable `operation_id`/idempotency key created and durably stored before the first network call.
- Lodge is derived/validated from authenticated membership; outlet, shift and operator are server-validated.
- Item IDs, quantities, modifier choices, promotion/manual-discount approval references and service context.
- Tender allocations as typed requests: cash, card, mobile money, customer account, voucher, booking/event folio where supported.
- Customer/voucher/provider references as applicable.
- Client totals may be included only as a stale-price comparison hint, never as authority.

Server transaction:

1. Lock/validate catalogue, promotion, shift/till, customer credit/AR and voucher rows.
2. Reprice items/modifiers, calculate discount, VAT, tips and authoritative total.
3. Validate tender allocations equal the authoritative amount and provider references are present.
4. Enforce account status/limit and create the customer-account ledger entry when used.
5. Validate voucher issue/expiry/balance and create an immutable voucher-redemption entry when used.
6. Insert order, order-item and tender-allocation snapshots.
7. Apply recipe/packaged-item inventory depletion at transaction-time cost.
8. Post revenue/tax/tips/tenders plus COGS/inventory to the GL when Accounting is active.
9. Record audit, payload hash and authoritative result snapshot.
10. Commit everything or nothing.

Output contract:

- Full authoritative order/tender/item/pricing/tax/cost snapshot, receipt/order numbers, posting IDs/status and replay marker.
- The renderer must not overlay financial fields from its request.

Also:

- Fold loyalty into the transaction or a durable idempotent repair queue with visible status.
- Version return/void RPCs to reverse exact original item, tender, voucher/account, VAT, tip, stock and GL allocations.
- Update Desktop, main queue replay, Manager PWA callers if any, and Legacy POS. Preserve compatibility for already queued older payloads through an explicit adapter.
- Online uncertain results use the existing POS submit journal/result lookup; offline receipts are provisional until the same RPC confirms them.

Acceptance scenarios:

- Mixed cash/card/account/voucher tender.
- Partial voucher plus cash; insufficient/expired voucher; concurrent redemption.
- Credit-limit breach; concurrent customer-account sales.
- Promotion changes between screen load and submit.
- Timeout after commit followed by exact replay.
- Return after later catalogue/tax/cost changes.
- Every receipt equals the stored authoritative snapshot and detailed export.

### Phase 4 — Tabs, products, stock and COGS

**Goal:** Remove client-derived stock/tab truth and make catalogue changes recoverable.

Tasks:

1. Add an authoritative open-tab read model with version and financial totals. Make split/transfer/merge/settle operations version-aware and idempotent.
2. Persist tab operation envelopes across restart. A stale version must produce a review screen showing server state, not an automatic overwrite.
3. Replace sequential product-plus-pack saves with one atomic RPC, or an operation record that guarantees resume/compensation and clearly blocks sale while incomplete.
4. Add catalogue readiness validation: active outlet mapping, unique barcodes, pack quantities/barcodes, stock link, depletion quantity, tax/pricing configuration and publication snapshot.
5. Add absolute stock-count RPCs with row locks and immutable count evidence.
6. Add receipt/adjustment/waste/transfer RPCs with durable keys, source documents, lot/expiry and valuation data.
7. Choose and document the inventory cost method. Store the cost snapshot used by each sale/return; never derive historical COGS from current item cost.
8. Replace swallowed read errors/empty-cache fallbacks with typed source/completeness envelopes.

Acceptance:

- Concurrent sale and physical count produce the correct locked count/delta.
- Replay cannot duplicate receipt, count, transfer or tab split.
- Inventory valuation reconciles to the GL control account.
- POS COGS and returns use transaction-time cost snapshots.

### Phase 5 — Cash-up, settlement and expenses

**Goal:** Make cash/bank movement distinct from revenue and fully auditable.

Tasks:

1. Remove/deny legacy cash-drawer session auto-close and client expected-total contracts after migration of any required data.
2. Consolidate on an outlet/till/shift/operator-scoped blind cash-up RPC. Compute expected cash from authoritative tender allocations, refunds, cash in/out, floats, retained tips and approved corrections.
3. Add manager review/reject/correct/reopen state transitions with stable keys and mandatory reasons. Posted corrections create linked cash over/short journals.
4. Add card/mobile settlement batches, provider references, gross amount, fee, net deposit, settlement date and bank match.
5. Replace expense CRUD with draft/submit/approve/post/pay/void/reverse workflow. Add source attachment, supplier/payee, tax, payment account/method, outlet and operation ID.
6. Define direct-paid expense versus AP bill. Add duplicate supplier/reference/date/amount warnings and prohibit one source from being recognized twice.
7. Make expense reads cursor-paginated and exports server-authoritative.

Acceptance:

- An operator cannot change expected cash.
- A cash-up cannot recognize revenue a second time.
- Settlement fees and deposits reconcile clearing accounts to bank.
- Posted expenses cannot be deleted; reversal is complete and linked.

### Phase 6 — Accounting page completion

#### 6A. Chart of Accounts

1. Normalize DTO names (`ledger_balance` versus `balance`) across RPC/domain/UI/export.
2. Add account-type, parent, control-account and cash-flow-classification validation.
3. Prevent deactivation/deletion when an account has journal history, active mappings or open balances.
4. Add mapping/readiness view, opening-balance status and chart export.

#### 6B. General Ledger

1. Remove unordered limit behavior; add deterministic keyset pagination, total counts and complete export.
2. Add trial balance, account activity, source drill-through, reversal chain and posting-status filters.
3. Add manual journal draft/submit/approve/post/reverse workflow, attachments and maker-checker thresholds.
4. Enforce period locks server-side for manual and automated postings.

#### 6C. Accounts Payable

1. Correct recognition/aging status semantics.
2. Implement multi-line bills with supplier, document number/date/due date, tax code, currency if supported, source attachment and expense/asset/inventory accounts.
3. Add submit/approve/post, partial payment, credit note, reversal and supplier statement/aging.
4. Expand idempotency payload hash to every meaningful payment field and persist unresolved payment attempts.
5. Link PO/GRN/three-way evidence where purchasing is enabled; do not fake a match for lodges not using that module.

#### 6D. Bank Reconciliation and Period Close

1. Replace comma splitting with a robust CSV parser and explicit import mapping/validation.
2. Make import identity deterministic from account, statement dates, file hash and normalized rows; duplicate files are detected.
3. Enforce one-to-one/many-to-one/one-to-many match constraints and approval locks in SQL.
4. Reconcile statement opening + movements = closing, and statement closing to entered evidence.
5. Require each exception/adjustment to resolve an identified row and link a journal.
6. Separate bank reconciliation completion from lodge period close.
7. Add close checklist covering all bank accounts, posting exceptions, POS/stock/cash-up, AP, payroll, tax, suspense and subledger-control reconciliations.
8. Add governed reopen with separate approval, reason, affected-report invalidation and audit.

#### 6E. Tax

1. Replace broad account-type purchase math with explicit tax-detail allocations.
2. Support configured taxable/zero-rated/exempt/out-of-scope treatment and credit/debit notes.
3. Generate an immutable source manifest containing every journal/source ID and hash.
4. Detect staleness when any source or configuration changes.
5. Add review/approval/filing/amendment lifecycle and a detailed filing packet.
6. Keep all statutory logic effective-dated and source-referenced. Official BURS references are listed in section 13, but current professional review remains required.

#### 6F. Budgets

1. Server derives the complete expected revenue/expense account × 12-month matrix.
2. Add versions/scenarios, draft/submit/approve/freeze/supersede states and change commentary.
3. Define omission semantics explicitly; do not leave stale old rows silently active.
4. Add budget-vs-actual, monthly/YTD variance, forecast and export.

#### 6G. Financial Statements

1. Use only the corrected, complete posted GL and approved close status.
2. Provide P&L, balance sheet, cash flow and trial balance with comparatives and drill-through.
3. Show accounting basis, effective date, period status, generated-at/data-cutoff and unresolved exceptions.
4. Produce immutable statement report runs and complete XLSX/PDF outputs.

#### 6H. Payroll

1. Add an expected-worker register from active effective-dated employment terms. Every worker is included or explicitly excluded with reason/approval.
2. Add attendance import/reconciliation and exception workflow. Manual time remains possible but must be attributable and approved.
3. Validate staff/lodge relationship at input write time and prevent overlapping terms with database constraints.
4. Implement lifecycle: draft → input review → calculated version → approved → posted → payment batch exported → paid/reconciled → closed, plus governed reversal/off-cycle/reopen.
5. Add durable idempotency/payload hashes to calculate, approve, post, export and settlement.
6. Replace generic unbounded statutory inputs with effective-dated jurisdiction-specific configuration, validation and provenance approved against current official rules.
7. Add payroll liability settlement and bank reconciliation.
8. Make payment exports immutable and include batch/period IDs, dates, debit account, employee count, control total, file/dataset hash and generated-by.
9. Protect PII with least privilege, masking, log/support-bundle exclusion, retention rules and secure file handling.
10. Generate payslips only from immutable approved versions with full earnings, deductions, employer, period, employee and YTD context.

Acceptance for Phase 6:

- Every page has a server-authoritative read model, complete export, state/recovery UX and behavioral tests.
- No page converts a permission, source or network failure into empty financial data.
- Maker-checker and period locks are enforced in SQL, not by button visibility.

### Phase 7 — Reports, dashboards, exports and backup manifests

**Goal:** Make “complete and financially true” mechanically provable.

Tasks:

1. Implement the authoritative report envelope in section 7.5 and immutable `report_run` storage.
2. Separate operational reports from accounting reports:
   - Operational sales: orders, items, tenders, returns, shifts and stock effects.
   - Cash-flow collections: actual cash/clearing/customer-credit movements.
   - Accounting: GL-derived P&L, balance sheet, cash flow, trial balance and subledger reconciliations.
3. Fix POS classifications and formulas. Report sales, returns, discounts, VAT, tips and net sales separately. Exclude voided/cancelled rows according to explicit transaction state; show their audit detail separately.
4. Standardize on lodge `business_date` for operational trading reports and disclose timestamp/timezone filters.
5. Replace `getPosOrders`/expense hard limits for export with report-run pagination. Keep screen pagination independent from export completeness.
6. Build a detailed POS transaction export containing source/order/receipt IDs, business date/time, outlet, shift, operator, customer/folio where permitted, transaction/original order, item/modifier snapshot, quantities, price/discount/tax/tip, tender allocations/references, return links, sync state, inventory/COGS posting and GL status.
7. Add complete exports for Chart/GL/AP/Bank/Tax/Budget/Statements/Payroll and an operational-to-GL reconciliation workbook.
8. Remove swallowed supplemental-sheet failures. A financial workbook is produced only if every required section succeeds and reconciles.
9. Add a backup/export manifest with per-section status, row count, as-of timestamp, hash and errors. A support backup may be partial only if it says so; a finance export may not.
10. Update Business Control/Finance Overview to consume source completeness metadata. Show no “net” when required inputs fail. Prefer GL figures after Accounting activation; otherwise label exact operational formulas.

Acceptance:

- Seed more than 500 orders and 500 expenses; screen pages correctly and export contains every matching row.
- XLSX/PDF/CSV totals equal report-run control totals and source queries.
- A single failed required source prevents a “complete” financial file.
- The same filters produce the same dataset hash unless source data or report/schema version changed.

### Phase 8 — Cross-surface authorization, offline UX and operational recovery

**Goal:** Make every caller honor the same contract and make uncertainty visible.

Tasks:

1. Trace Desktop renderer → preload/IPC → database facade → domain → Supabase for every changed operation.
2. Trace Manager PWA direct RPC calls and its separate device-local queue. Do not assume Electron changes reach it.
3. Trace Legacy POS renderer/main/offline queue/mesh. Preserve queued payload compatibility and signed mesh behavior.
4. Add capability, lodge and outlet enforcement to every RPC; test with authenticated roles. Visibility is not authorization.
5. Use one durable operation-attempt utility for non-POS actions such as AP payments, tab splits, stock counts/receipts, shifts, expenses, bank import and payroll actions.
6. Distinguish UI states: local pending, server confirmed, definitively rejected, ambiguous/needs resolution, reversed, and stale report.
7. Add System Health queues for ambiguous financial operations, posting failures, reconciliation drift and stale/incomplete report runs. Never silently discard failed financial work.
8. Centralize lodge-timezone business-date handling across renderer, RPCs, reports and exports.

Acceptance:

- Restart after an ambiguous timeout and retry uses the same key/payload.
- Offline replay invokes the same RPC and produces the same journal/source result as online.
- Cross-lodge/outlet and unauthorized calls fail in SQL.
- Pending/offline values cannot be mistaken for confirmed financial truth.

### Phase 9 — Migration, backfill, deployment and controlled enablement

**Goal:** Prove the exact production system before exposing Accounting.

Tasks:

1. Apply forward migrations to a disposable database; run full behavior/concurrency/isolation tests.
2. Dry-run historical source coverage by lodge. Produce counts/totals for posted, already posted, reversible, missing configuration and unpostable-without-evidence records.
3. Approve opening balances/backfill in a controlled batch with deterministic posting keys. Store batch ID, source manifest, reviewer and hashes.
4. Reconcile every control account and produce a signed-off cutover packet.
5. Deploy migrations first, verify functions/grants/RLS/catalog definitions and run database lint/advisors.
6. Deploy/build each affected surface separately. Record Supabase, Desktop, Legacy POS, Manager PWA and any other affected surface in `docs/DEPLOYMENT_EVIDENCE_MATRIX.md`.
7. Perform authenticated smoke tests using real role boundaries—not service-role impersonation—for every page and mutation.
8. Restore grants one RPC at a time only after its vertical slice passes. Do not grant direct table DML to distributed clients.
9. Enable Accounting for an internal/test lodge first. Monitor failed postings, reconciliation drift, queue ambiguity and report hashes through at least one full close cycle.
10. Only then re-enable commercial activation and operator navigation.

Acceptance:

- Repository migration history equals linked production history for the released slice.
- Every enabled RPC has explicit authenticated grant/RLS/capability evidence.
- Post-cutover source coverage is 100% or the system blocks close/statements and names every exception.
- One complete payroll, bank reconciliation, tax working paper and period close has been rehearsed end to end.

## 9. Required behavioral test matrix

Tests must inspect database state after each operation and after replay. At minimum:

### Exact-once and concurrency

- Same key + same payload returns same result and creates no extra source, subledger, stock or journal row.
- Same key + changed amount/account/reference/notes/items fails.
- Timeout after commit, process restart and retry resolves the original result.
- Concurrent voucher redemptions cannot overspend.
- Concurrent customer-account sales cannot exceed credit limit.
- Concurrent AP payments cannot overpay a bill.
- Concurrent stock count/sale and bank-match approvals serialize correctly.

### Authorization and tenancy

- Cross-lodge source IDs, account IDs, staff IDs, customer IDs, vouchers, bank rows and outlets fail.
- Roles lacking manage/approve/payroll/bank/close capabilities fail server-side.
- Maker cannot approve their own transaction where separation is required.
- Direct table writes remain denied.

### POS and inventory

- Mixed tenders total exactly to authoritative sale total.
- Discounts/tax/tips/returns reconcile by line and order.
- Account and voucher subledgers reconcile to control accounts.
- Returns reverse original cost and tax snapshots.
- Shift cash expected equals authoritative cash events; blind count creates only the variance effect.
- Inventory quantity and valuation reconcile after receipt, sale, waste, transfer, count and return.

### Accounting pages

- Statements exclude unposted and out-of-period journals.
- Balance sheet equation holds across month/year boundaries and reopen/reclose.
- Trial balance totals agree with GL detail and exported rows.
- AP aging includes recognized unpaid liabilities only.
- Bank import handles quoted CSV, duplicates and malformed rows; matches cannot be reused.
- Tax base/tax totals reconcile to detailed source lines and control accounts; stale pack invalidates.
- Budget save detects missing months/accounts and actual variance matches GL.
- Payroll blocks missing workers/terms/time, uses correct configuration version, posts balanced liabilities and settles them once.

### Reports and exports

- More-than-cap fixtures prove full export.
- Screen subtotal, report-run control total, XLSX, CSV and PDF summary agree.
- Return/cancel/void/split-tender/business-date classifications match across screen and file.
- Failed required source blocks complete export.
- Cached/offline operational export is visibly provisional and financial/statutory export is blocked.
- Dataset/file hashes are reproducible and change when source/config/report version changes.

## 10. Existing commands and new-test placement

Use real current scripts from `package.json`. During development run focused tests first, then the full affected release matrix.

Focused/current commands include:

```text
npm run test:bar
npm run test:restaurant
npm run test:financial-integrity
npm run test:offline-pos-critical
npm run test:offline-queue-critical
npm run test:inventory-offline-sync
npm run test:customer-credit-reschedule
npm run legacy-pos:test
npm run legacy-pos:build
npm run manager:lint
npm run manager:build
npm run build:hospitality-pos
npm run db:lint
```

Before release, run the complete `docs/SHIP_READY_RUNBOOK.md` matrix, including `npm test`, release behavior/architecture, enterprise/web surfaces, production audit and builds.

Keep/add focused tests beside the current suites:

- `tests/restaurant-accounting-behavioral.test.mjs`
- `tests/restaurant-accounting-*.test.mjs`
- `tests/pos-financial-contract-integration.sql`
- `tests/bar-*.test.mjs`
- `tests/offline-pos-regression.test.mjs`
- `tests/inventory-offline-sync-regression.test.mjs`
- `tests/detailed-reports-*.test.mjs`
- `tests/pwa-pos-reporting-regression.test.mjs`
- Legacy POS tests under `legacy-pos/`

Static migration-text tests may remain as guardrails, but they cannot satisfy a behavioral acceptance item.

## 11. Recommended implementation/PR slicing

Use this order to minimize unsafe intermediate states:

1. Containment and truthful labels/disabled actions.
2. Disposable DB harness and exact accounting fixtures.
3. Ledger/statement SQL repair and activation/readiness contract.
4. Atomic POS account/voucher/tender/receipt contract plus Legacy POS/offline compatibility.
5. POS return/void/settlement and inventory/COGS chain.
6. Cash-up and expense lifecycle.
7. Chart and GL read/governance.
8. AP.
9. Bank reconciliation and period close.
10. Tax.
11. Budgets and statements UI/exports.
12. Payroll completeness, statutory configuration and settlement.
13. Report-run/export framework and all page exports.
14. Historical cutover/backfill, production grants and controlled enablement.

Every PR/slice should include:

- Problem/financial invariant.
- Forward migration and postconditions.
- All callers and offline compatibility.
- UI pending/error/recovery behavior.
- Audit/source/GL/report effects.
- Behavioral tests and exact commands/evidence.
- Deployment state: local only, linked test, or production-confirmed.

## 12. Final no-ship checklist

Accounting & Workforce, financial statements and financial-grade exports remain unavailable until all boxes are true:

- [ ] All P0 issues in section 6 are fixed with behavioral proof.
- [ ] Every post-cutover source in the approved coverage matrix posts atomically or fails closed.
- [ ] Subledger-control reconciliations pass with no unexplained difference.
- [ ] Statement SQL passes exact multi-period fixtures and accounting equations.
- [ ] POS account/voucher receipts and returns are atomic online and under replay.
- [ ] Legacy editable expected-cash/auto-close path is removed or server-denied.
- [ ] No report/export has an undisclosed cap, swallowed required source, or unmarked cache fallback.
- [ ] Every Accounting page has a complete export/report-run contract.
- [ ] Payroll roster completeness, statutory configuration, PII controls and liability settlement pass.
- [ ] Bank reconciliation is separated from period close and close/reopen is governed.
- [ ] Authenticated role/lodge/outlet tests pass; service-role-only testing is not used as operator evidence.
- [ ] Disposable DB, database lint/advisors, full repository gates and affected builds pass.
- [ ] Linked migration/grant/RLS state is recorded in the deployment evidence matrix.
- [ ] A controlled lodge completes sale-to-close, AP, payroll, bank, tax and statement rehearsal.
- [ ] Commercial activation/navigation is restored only after all above evidence is signed off.

## 13. Regulatory reference starting points

These links are starting points, not a substitute for current professional review or lodge-specific tax advice:

- BURS returns: <https://www.burs.org.bw/index.php/tax/returns>
- BURS VAT FAQ: <https://www.burs.org.bw/index.php/about-us/faq/tax-faq/vat-faq>
- BURS PAYE: <https://www.burs.org.bw/index.php/tax/income-tax/pay-as-you-earn>
- BURS tax table download: <https://www.burs.org.bw/index.php/tax/tax-downloads?download=828%3Aburs-tax-table>
- BURS tax downloads: <https://burs.org.bw/index.php/tax/tax-downloads>

Store the exact source URL/document/version/effective date used by each statutory configuration. If official guidance changes, add a new effective-dated version; do not mutate historical payroll/tax calculations.

## 14. Completion standard

The work is complete only when a reviewer can choose any material figure on a Bar page, Accounting page, dashboard, XLSX, CSV or PDF and trace it bidirectionally:

```text
displayed/exported figure
  <-> report-run row and control total
  <-> GL journal line and subledger control
  <-> immutable source transaction/version
  <-> actor, approval, operation ID and audit evidence
```

If any link is missing, silently truncated, cache-derived without a warning, manually forced to balance, or impossible to reproduce, the figure is not yet financially true.
