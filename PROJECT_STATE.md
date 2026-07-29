# Tsa Bonno HospitalityOS Project State

As of: 2026-07-29 (wrong-folder recovery and canonical snapshot)

## Status: Phase 4–6 database integrity repairs are deployed. Disposable-database behavioral proof and the broader Phase 8 product backlog remain release gates.
### 2026-07-29 — Wrong-folder Restaurant/Bar recovery audit

- Compared the canonical `Tsa Bonno HospitalityOS` worktree with the accidental `Boroko Bookings` worktree. The accidental branch is the canonical branch's June 6 ancestor and is 41 commits behind; its July 29 work is uncommitted and targets the obsolete pre-v3 POS architecture.
- Preserved all 19 tracked modifications and 52 untracked non-ignored files from the accidental folder in the verified `recovery/boroko-bookings-2026-07-29.zip` bundle. All 71 extracted files matched their source SHA-256 values. Ignored environment files were compared separately without copying secrets; the canonical folder already retains the required backend, booking-site, PWA, database, and release configuration.
- The July 29 POS/domain/UI and Phase 1–8 migrations were not copied wholesale. They would downgrade the current `create_pos_order_v3` path or create parallel sale, return, KDS, shift, inventory, and check models. The proposed anonymous Manager oversight function also lacks an effective caller lodge/capability check, and the proposed check ledger accepts caller-authored line prices.
- Recovered the architecture-neutral disposable-test-tenant guard, deterministic Restaurant/Bar fixtures, guarded seed/reset CLI, `.env.example` opt-out, and package test script. The nine non-network guard tests pass; `--help` on the recovered CLI was repaired.
- The comparison and per-phase disposition are recorded in `docs/WRONG_FOLDER_RECOVERY_2026-07-29.md`. No July 29 Supabase migration was deployed. Valid concerns from the accidental audit—especially plaintext approval credentials in legacy offline queue compatibility and best-effort POS audit writes—remain candidates for new v3-compatible forward repairs.
- Canonical verification before the recovery snapshot: production guardrails, the recovered tenant guard, offline POS, inventory offline sync, Booking Site tests (33/33), Booking Site build, Marketing Site contract, Hospitality POS production build, Lodge/Camp production build, Manager PWA production build, and Manager PWA lint all pass. Manager lint retains 45 existing warnings and no errors. The Restaurant suite passes its first 16 accounting tests, then stops at the known disposable PostgreSQL gate because `127.0.0.1:54322` is not running. Restoring Booking Site development dependencies from its lockfile reported five audit findings (one moderate and four high); no dependency versions were auto-changed during recovery.

### 2026-07-29 — Bar Mode launch-readiness implementation (local, not deployed)

- Bar cash-up is now blind for active cashier/bartender sessions: the operator enters only the physical cash count, expected tender totals and live variance are withheld, and the authoritative submission contract stores server-derived non-cash expectations for manager review. Shared-terminal PIN handover follows the same contract and prevents duplicate submitted handovers.
- Bar products now accept validated decimal `depletion_qty` values for measured pours, retain independent 6/12/24 pack-template depletion, and fail closed when the recipe method is selected without the Stock & Purchasing Pro entitlement. A database check guard prevents new or updated non-positive direct-stock quantities.
- Bar Base Stock now exposes server-authoritative last receipt/sale dates, elapsed days, and Fresh/Aging/Stale/Critical age buckets through an outlet/lodge-scoped read RPC. The UI keeps on-hand values visible but labels stock age unavailable when offline or when the RPC cannot be verified; lot expiry and write-off remain Stock & Purchasing Pro controls.
- Card and mobile-money POS tenders now require a transaction or terminal approval reference in Bar Till and the legacy POS compatibility surface. References persist through the v3 payment breakdown, offline replay payload, receipt, sales detail, and the database trigger guard.
- Focused verification passes: 39 Bar/product/cash-up/aging/payment-reference tests, the offline POS, inventory offline-sync, financial-integrity, and POS hardware gates, plus both Lodge/Camp and product-specific Hospitality POS production builds. No installer was built or published. The four forward migrations from this pass are local only and require linked Supabase deployment plus authenticated behavioral proof before customer enablement.

### 2026-07-23 — Bar POS base and three add-on bundles (local, not deployed)

- The 2026-07-22 base-only curation is superseded by a four-part commercial structure: **Bar POS** base at P4,500/year, **Stock & Purchasing Pro** at P3,000/year, **Accounting & Workforce** at P6,000/year, and **Growth & Multi-Outlet** at P5,000/year. Bar mode keeps one six-item operating rail; base management now includes staff accounts, live shifts, bar checklists, access/POS audit, products, basic stock, cash-up, sales, displays, settings, health and protected data tools.
- Add-on routes are controlled by the selected commercial add-on keys as well as ordinary role/capability checks. Direct URLs fail closed. Restaurant floor, reservations and kitchen remain excluded from bar mode; shared accounting pages stay shared, while stock, workforce, customer, voucher, owner and outlet language is bar-specific.
- The authoritative commercial migration `20260723010000_bar_product_bundles.sql` mirrors the local catalogue, restricts all three add-ons to the `bar_only` operating profile, unions selected add-on features into the canonical quote snapshot, and lets existing governed activation reset/grant the resulting product feature rows. Entitlement loading restores selected add-on keys from the immutable commercial pricing snapshot so access survives restart and offline cache use.
- Bar Base gained mixed cash/card-or-mobile tender capture, basic cashier/bartender/manager administration, an access and POS audit view, and opening/closing control checks. The base deliberately has no arbitrary user cap; its simplicity is enforced by workflow boundaries rather than preventing an owner from creating the two or three accounts needed to operate safely.
- Stock & Purchasing Pro now exposes supplier/PO approval and idempotent receiving, reorder suggestions, lots/expiry and audited write-off, cocktail/prepared-portion recipes, prep batches, variance, stocktake/movement history, wastage evidence, and an on-hand stock valuation KPI.
- Accounting & Workforce exposes bar rosters, attendance, performance, controlled tip-pool payouts, expenses, all rebuilt accounting workspaces, private payroll, payment instruction export, and printable calculation-snapshot payslips. The accounting/payroll database RPCs and tables remain service-role-only under the existing no-ship guard. This pass does **not** restore authenticated operator grants: disposable-database behavioral proof, linked lint remediation, explicit per-RPC grant restoration, and authenticated smoke tests remain mandatory before this add-on can be sold or enabled in production.
- Growth & Multi-Outlet exposes regular-customer profiles and loyalty visibility, scheduled promotions, stored-value vouchers, authorised bar outlets, stock-custody transfers, cross-outlet contribution, central product catalogue behavior, advanced bar owner signals, and a Growth-gated Manager PWA owner view.
- Manager PWA now uses server-issued `hospitality_mode`: bar sessions cannot open or discover restaurant floor/kitchen pages, use bar product/stock/tab language, and require `owner_mobile_view` for the bar owner dashboard.
- Local verification: 181 focused bar/commercial/entitlement/accounting contract tests pass, including fail-closed coverage for every bar add-on deep link; both the product-specific Hospitality POS production build and Manager PWA production build pass. Manager PWA lint passes with 0 errors (45 existing whole-app warnings), and its production dependency audit reports 0 vulnerabilities. The Restaurant suite reaches its disposable PostgreSQL behavioral gate and stops because `127.0.0.1:54322` is not running; this workstation has no Docker executable, so the required local Supabase database cannot be started here. The migration and PWA changes are local and not deployed.

### 2026-07-22 — Bar POS base-product simplification (local, not deployed)

- Bar-only mode now presents a deliberately small primary rail: Sell, Open tabs, Products, Stock, Cash & close, and Sales. Its Manage hub retains only the base operating tools plus optional displays, settings, health, subscription and data utilities; restaurant floor/kitchen, customer CRM, staff administration, business control, advanced inventory, finance/accounting, payroll and outlet-control workspaces are hidden and fail closed on direct navigation.
- The base Stock page now lets an authorised manager create bottle/can/keg/packet/prepared-portion items, receive a simple delivery, and record a physical count. Stock movements continue through the existing authoritative inventory bridge, and physical counts use stable operation IDs instead of creating a separate bar ledger.
- Bar product setup supports drinks, snacks and simple food through direct stock or prepared-portion links. Recipe production remains a restaurant workflow. Bar setup readiness is reduced to ten evidence-backed stages covering business/tax, outlets, products/prices, base stock, payments, receipt hardware and cash controls.
- Basic shared sales reporting is now routed at `/hpos/reports`; bar day close omits table and kitchen blockers. Shared shift and cash-up controls remain in the base product because they provide operator and till accountability, while staff administration/performance remains outside the base bar workspace.
- Bar-facing language now consistently uses bartender, cashier, operator, tabs and counter service. The shared database payload retains legacy `waiter_id`/`waiter_name` field names for compatibility with the audited POS contract.
- Local verification: focused bar/commercial tests pass and the production desktop build completes. No Supabase migration or production deployment is part of this change.

### 2026-07-21 — Command Central control-plane foundation (local, not deployed)

- Command Central privileged mutations now require a master-administrator session at the Electron IPC boundary; a lodge-level `super_admin` session is not sufficient. Permanent company deletion is disabled pending the governed archive/anonymize workflow.
- High-risk Command Central mutations now additionally require a current-password step-up that expires after ten minutes and is bound to the exact master-admin user ID. The main process enforces the gate for commercial/licence, billing/invoice, release, company lifecycle, feature, user-access/password, test-reset, and implementation mutations; this is password reauthentication, not an MFA claim.
- Master-admin authentication now applies an in-process five-failure/fifteen-minute identity lockout, and master sessions expire after four hours. Master accounts are excluded from offline trusted-session storage, do not persist an offline password verifier, clear their nonce on logout, and cannot use the 60-day lodge staff offline-unlock path. The lockout is process-local until the authoritative server-side security-event/session model is deployed.
- New local-only forward migrations introduce a service-role-only control-plane operation/audit model and a separate commercial account, invoice, payment, allocation, and credit-note ledger. Commercial billing derives subscription charges from the canonical license price snapshot and does not use guest booking invoices or payments.
- The desktop bridge exposes retry-safe commercial invoice generation and payment recording, each requiring a stable operation ID and a reason. Accounting read models now report unavailable data as unavailable rather than presenting a successful zero-value result; the screen labels commercial subscription metrics separately from customer booking finance.
- System Health now treats skipped or runtime-only replay-contract probes as unverified rather than green. The operator must run an explicitly authorized deep health check before the replay-critical contract is shown as ready.
- Lodge-session support requests now derive their company target from the active trusted profile/session instead of accepting a renderer-supplied company ID; master-admin Command Central requests retain their explicit target-company workflow.
- Company archive/restore now use the same local-only governed control-plane pattern: master-admin IPC, a stable operation ID, a required reason, locked settings mutation, lifecycle history, and audit event. Legacy direct archive/restore IPC and permanent deletion remain unavailable. This migration is not deployed.
- Product-scoped release-control contracts are now local-only: a release is keyed and selected by `lodge-camp`, `hotel`, or `hospitality-pos`; the desktop and Legacy POS updaters send their runtime product identity through the public read-only gate and legacy unscoped releases are ineligible. The release desk selects a product before creating, listing, or changing a rollout. Deployment and linked updater verification remain required.
- Product-aware commercial subscription assignment is now wrapped in the local-only Command Central operation/audit envelope. The workbench keys active assignments by `(lodge_id, product_id)`, preserves selected add-ons during edits, and generates one stable operation ID per create/edit attempt so a retry replays the same recorded result rather than creating an untracked second assignment.
- Subscription-request activation now uses the local-only `admin_governed_activate_subscription_request` wrapper. Commercial requests retain the catalog-backed activation contract; legacy requests use the authoritative contract RPC inside the same operation claim/audit envelope, with no renderer/domain fallback writes to `licenses` or `lodge_features`.
- Legacy license create/update/delete, contract-issue, and billing-write IPC channels now return explicit refusals instead of calling direct table or fallback writers. Commercial subscription assignment is the only remaining Command Central license-write entry point, pending linked-RPC deployment verification.
- Command Central entitlement overrides now fail closed if their authoritative subscription RPC is unavailable; the old direct `lodge_features` upsert/delete fallback was removed so a missing contract cannot silently alter access without its server-side guardrails.
- Release lists and scheduled-release reads now propagate an unavailable control-plane query to the UI rather than returning an indistinguishable empty list.
- The Command Central Companies desk no longer performs a background per-company stats fan-out. It loads and retains an authoritative usage signal only when an operator opens that company, labels uninspected companies as unknown rather than clear, and avoids fleet-size-driven startup traffic.
- Selected-company statistics now inspect every parallel query result and reject partial failures instead of converting failed counts to zero. The detail panel shows the actual unavailable reason and a retry action; last activity is not labelled “No bookings yet” when its source could not be verified.
- Implementation & Add-ons now requires an explicit Command Central company selection. Website/payment-readiness records, payment-provider configuration, dashboard reads, local drafts, in-flight deduplication, and caches carry that lodge target; explicit Command Central reads fail visibly instead of falling back to an unlabeled empty or stale tenant view.
- Bulk status/delete/notification actions, update pushes, and notification creation now require the same fresh master-admin step-up. Sync-queue read failures return `ok: false` with unknown counts instead of presenting a healthy empty fleet.
- Command Central diagnostics now propagate support, audit, notification, automation, and fleet query failures rather than converting them to empty results. Each check retains its source, checked timestamp, latency, and observable row count, and Fleet treats an unavailable sync-queue response as an error.
- Local-only migration `20260721155000_command_central_health_history.sql` adds service-role-only diagnostic history with bounded, allowlisted evidence fields. The UI records completed runs, loads the five most recent server summaries, and explicitly shows `History unavailable` when the RPC is not deployed; secrets, raw SQL, tokens, and arbitrary payload keys are not accepted into the stored evidence envelope.
- Command Central audit reads now require the authoritative audit RPC and an online connection. They no longer fall back to the unrelated `activity_logs` table or return an indistinguishable empty summary when the audit contract fails. The legacy audit writer now awaits the audit RPC and returns an explicit recorded/unrecorded outcome to its callers instead of swallowing errors. Legacy mutations that still write audit after their business mutation remain a known non-atomic risk; only the new governed control-plane RPCs currently guarantee mutation-plus-audit rollback.
- The Activity Log renderer now uses independent authoritative read outcomes and displays a retryable unavailable state; an audit RPC failure can no longer be rendered as `No audit entries yet`.
- Support Tickets and Feature Flags now preserve unavailable/error state in the renderer instead of treating failed reads as empty ticket or override sets; feature saves are blocked until authoritative overrides load successfully.
- Finance Office now reads and posts invoices through the separate commercial ledger read/write RPCs, records payments through the governed allocation workflow, enforces one non-void invoice per account/billing period, and no longer edits or deletes guest-booking invoices. Guest booking finance remains a separate compatibility surface outside Command Central bookkeeping.
- The main-process read bridge for broadcasts, expenses, feature overrides, invoices, overdue licences, and company users now propagates authoritative query failures instead of converting them to empty arrays or zero summaries.
- Company settings changes now require an operator-supplied reason of at least eight characters at both the IPC and domain boundary; the handler no longer invents a generic audit reason.
- Local verification after these guardrails: `node --test tests/command-central-regression.test.mjs` passes 30/30, `npm test` passes, and `npm run build` completes. Command Central’s initial renderer chunk is about 298 kB (down from about 587 kB); heavy workspaces load on demand, while the remaining workspace chunks still merit later decomposition.
- Broader local gates: `npm run test:commercial` passes 9/9, `npm run test:products` passes 14/14, and `npm run test:release-architecture` passes 2/2. `npm run test:enterprise` remains red on the separate Restaurant Accounting no-ship work because `App.jsx` references the `restaurant_accounting` UpgradeWall key before that module is registered in `MODULE_CATALOG`; this Command Central pass did not expose that unfinished financial surface merely to make the suite green.
- Local-only forward migrations now include the commercial billing read model, audit read model/writer revocation, company access suspension/restore snapshots, product-assignment integrity, and governed subscription-request activation (`20260721157000` through `20260721161000`). This work has not been applied to the linked Supabase project and is not release or production proof. Linked database migration application and behavioral RPC verification remain required before any billing, lifecycle, licensing, or updater workflow is enabled for operators.
- Read-only linked `npm run db:lint` completed without a CLI transport failure but reported 20 existing function-level errors in asset, restaurant-accounting, payroll, and corporate-billing surfaces; none are from the local-only Command Central migrations, so those new RPCs still require deployment-time lint and behavioral proof.

### 2026-07-20 — Restaurant Accounting financial rebuild in progress

- Forward migrations `20260720010000` through `20260720090000` are applied to linked Supabase, covering the ledger, chart, POS, AP, bank, tax, budgets/statements, privacy-scoped payroll, and side-effect-free read models. Payroll now uses effective-dated pay terms, versioned statutory configuration, separate approved regular/overtime inputs, immutable calculation snapshots, maker-checker approval, balanced ledger posting, and payment export that explicitly remains unpaid.
- Statements are derived exclusively from posted journals. Balance sheets include current-period earnings and a balance difference, income statements retain historical activity for deactivated accounts, and cash flow uses explicit cash/operating/investing/financing classifications while surfacing ambiguous journals as unclassified.
- Every rebuilt RPC remains service-role-only; no authenticated execute grant, RLS policy, or direct operator table privilege has been restored. The explicit desktop v2 domain, allowlisted/capability-gated IPC dispatcher, preload bridge, and separated capabilities are now being wired, but routes and navigation remain unavailable. Focused payroll rebuild checks pass 9/9 (60/60 across the eight rebuild migrations when run sequentially). Restaurant Accounting remains no-ship pending page replacement, behavioral database coverage, build/UI verification, and per-RPC grant restoration.


### 2026-07-19 — Restaurant Accounting P7 shutdown drift guard

- Forward migration `20260719030000_restaurant_accounting_shutdown_drift_guard.sql` is applied to the linked Supabase project. It redefines `get_restaurant_payroll_settings` as a side-effect-free read: missing settings return documented defaults without inserting personnel or financial configuration.
- Operator access remains fully revoked. The migration grants the getter only to `service_role` and fails closed if any Accounting RLS policy reappears, any Accounting table has RLS disabled, any operator table or column privilege returns, or the getter becomes executable by `anon` or `authenticated`.
- The shutdown regression now derives the 20-table inventory from the Accounting `CREATE TABLE` SQL and checks the effective getter body and drift postconditions. Focused Restaurant Accounting suites pass 141/141, and a fresh Restaurant & Bar production build contains no Accounting page chunks or main-process RPC strings.
- Linked migration history matches through `20260719030000`. Live anonymous probes return HTTP 401 for both `restaurant_payroll_settings` and `get_restaurant_payroll_settings`. Restaurant Accounting remains no-ship; this hardening does not restore any UI, API, table, or RPC access.
### 2026-07-18 — Restaurant Accounting P0/P1 deployment

- Forward migrations `20260717010000` through `20260718040000` are applied to the linked Supabase project. The last migration provides the missing `app_get_actor_user_id()` compatibility bridge to the canonical `app_current_user_id()` session helper, resolving the actor-identity runtime errors surfaced by linked lint after the initial push.
- The deployed P0/P1 set includes accounting feature enforcement, corrected GL/tax/bank migration defects, a protected AP payment workflow, immutable audit/DML access controls, statement-import replay protection, maker-checker bank-match approval, GL-based reconciliation completion, and payment idempotency.
- Linked migration history matches every version through `20260718040000`. Targeted linked lint no longer reports the accounting actor-helper error; the broader lint report still contains unrelated pre-existing findings in other database areas. Focused Restaurant Accounting regression suites pass 128/128, and the Restaurant & Bar production build passed locally.
- This proves database deployment and local build/test coverage. An authenticated operator smoke test of chart setup, AP payment retry, bank import/reconciliation, tax, and payroll remains a release sign-off task.

### 2026-07-19 — Restaurant Accounting P6 total table shutdown

- Forward migration `20260719020000_restaurant_accounting_total_table_shutdown.sql` is applied to the linked Supabase project. It revokes `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `public`, `anon`, and `authenticated` on all 20 Accounting tables, including per-column grants; only `service_role` retains documented remediation access.
- The migration removes every existing RLS policy on those tables and leaves RLS enabled with no replacement operator policy. It fails closed unless PostgreSQL effective-privilege checks confirm that `anon` and `authenticated` have no table-level or column-level Accounting access.
- A zero-row live anonymous PostgREST probe now returns HTTP 401 for `restaurant_accounts`, `restaurant_employee_pay_records`, and `restaurant_payroll_settings`, replacing the pre-P6 HTTP 200 direct-table response. The same deployed SQL postcondition covers `authenticated` independently of any particular user or lodge membership. A zero-row `service_role` probe returns HTTP 200 for the documented remediation path.
- Linked migration history matches through `20260719020000`. Restaurant Accounting remains no-ship pending its financial-contract and privacy-policy rebuild.

### 2026-07-19 — Restaurant Accounting P5 total operator RPC shutdown

- Forward migration `20260719010000_restaurant_accounting_total_rpc_shutdown.sql` is applied to the linked Supabase project. It revokes all 61 Restaurant Accounting RPCs—including every read-named reporting and payroll RPC—from `public`, `anon`, and `authenticated`; `service_role` is the only retained execution path for controlled remediation.
- The migration fails closed unless PostgreSQL effective-privilege checks prove that `anon` and `authenticated` cannot execute any manifest entry. The manifest is checked against every Accounting SQL RPC and explicitly includes `get_restaurant_payroll_settings`, whose prior SECURITY DEFINER implementation could insert default settings.
- The eight Accounting renderer imports, preload namespaces, IPC handlers, desktop/HPOS navigation entries, HPOS metadata, and production database-facade domain exports are absent. The current Restaurant & Bar production build contains neither Accounting page chunks nor Accounting RPC strings in its main-process bundle.
- Linked migration history matches through `20260719010000`; focused Restaurant Accounting suites pass 137/137. Restaurant Accounting remains no-ship pending a complete financial-contract rebuild.

### 2026-07-19 — Restaurant Accounting P4 dormant-surface hardening

- Forward migration `20260718070000_restaurant_accounting_effective_privilege_guard.sql` is applied to the linked Supabase project. It guarded the then-known write-named Accounting RPC inventory and direct Accounting-table DML using PostgreSQL effective-privilege checks.
- Its function inventory did not include the read-named but side-effectful `get_restaurant_payroll_settings` RPC or the remaining read RPCs. That incomplete operator shutdown is superseded by the P5 total-RPC shutdown above.
- The client-surface removal described below remains part of the deployed no-ship boundary.

### 2026-07-18 — Restaurant Accounting P3 full shutdown

- Forward migration `20260718060000_restaurant_accounting_full_write_shutdown.sql` is applied to the linked Supabase project. It revokes every discovered Restaurant Accounting mutation RPC from `public`, `anon`, and `authenticated`, including chart, journals, bank import/matching, AP, tax, budgets, and payroll. Service-role execution remains only for controlled remediation.
- The Restaurant & Bar desktop and HPOS navigation no longer surface the eight Accounting pages. Each former direct route now shows an explicit temporary-unavailability screen rather than a seemingly normal workflow that fails after data entry.
- Linked migration history matches through `20260718060000`. Focused P2/P3 containment tests and the Restaurant & Bar production build pass. This makes unrelated Restaurant & Bar release assessment possible without exposing Accounting operations, but it does not make Restaurant Accounting shippable or financially trustworthy.
### 2026-07-18 — Restaurant Accounting P2 financial-write containment

- Forward migration 20260718050000_restaurant_accounting_p2_financial_write_containment.sql is applied to the linked Supabase project. It removes authenticated execution of POS/expense GL posting, AP approval/payment, tax-status filing, bank-match approval/reconciliation completion, and payroll calculation/approval/posting mutations. Read-only reporting remains available; service-role access is reserved for controlled remediation.
- Restaurant Accounting IPC handlers now reject failures rather than returning a { success: false } value that callers can mistake for a successful operation. Contained permission errors tell the operator that no accounting data was changed. Bank Reconciliation now unwraps the Chart-of-Accounts response before rendering its selector, clears a stale CSV preview when input changes, and does not present immutable bank-account fields as editable.
- Linked migration history matches through 20260718050000. Focused Restaurant Accounting regressions pass 132/132 and the Restaurant & Bar production build passed. Linked lint still reports pre-existing global issues and, importantly, confirms the contained POS posting, bank-match proposal, and payroll calculation functions are not safe to release as financial workflows.
- This is a safety containment, not production-readiness approval. The ledger, accounting policy, tax, AP, bank, and payroll rebuild remain required before restoring authenticated financial writes.
### 2026-07-16 — Restaurant & Bar floor workflow boundary

- The sidebar **Floor plan** is now a real-time service view: it shows table availability, reservations, occupied checks, serving staff and elapsed check time, then takes the selected table into the Till to start or continue its transaction. It no longer offers table setup or archive controls.
- **Manage → Floor & Service → Live Floor** is now the manager configuration desk for adding, naming, seating, area assignment, editing and safely archiving tables. The interface is hidden from non-managers and the existing IPC/RPC capability enforcement remains authoritative.
- This preserves the existing PIN-verified Till and server-authoritative open-tab contract for transactions; no financial or table-session write path was moved or weakened.

### 2026-07-16 — Waiter reservations and waitlist service workflow

- The sidebar Floor plan now opens a dedicated **Reservations & waitlist** service page for cashiers/waiters. They can view today’s arrivals, add and edit active walk-ins, select an available table to seat a party, confirm an arrival, and mark a no-show.
- Future-reservation creation/editing/cancellation, table setup and management overrides remain in **Manage**. The new `pos.service` capability gives the front-of-house workflow its own boundary rather than treating every waiter as a manager.
- Waitlist removal is deliberately non-destructive: the record becomes cancelled only after a reason is supplied. Every service edit, seating, removal and reservation state change writes before/after evidence plus the canonical actor to `restaurant_service_events`.
- Managers can edit active walk-ins and remove them through that same audited workflow; the waiter service page uses the established light HPOS service surface for legible, consistent contrast.
- Waiters can create phone reservations for a shared house guest list. A capacity check uses the active floor’s seats and overlapping reservations; a full slot can instead become a clearly labelled reservation-waitlist request, never a false confirmed booking. The reservation creator is retained in the audit trail, while the on-duty team assigns the actual table/server at arrival.
- Forward migration `20260716040000_restaurant_service_reservations_waitlist.sql` is applied to the linked Supabase project. Focused service-contract regression and the Restaurant & Bar production build pass.

### 2026-07-16 — Recipe preparation-loss reporting

- A completed void reverses sale revenue, but prepared food and cocktails remain consumed. Recipe Variance now shows those cancellations as **Preparation loss**, separate from financial revenue and cash reporting.
- The report is read-only and derived from the immutable `pos_order_voided` audit record plus the frozen `restaurant_recipe_stock_movements.theoretical_cost` captured at sale time. It cannot be edited or double-counted by the UI.
- It also shows each affected ingredient’s physical preparation-loss quantity and percentage of all recipe consumption in the selected period. That percentage is deliberately consumption-based, not a misleading percentage of purchases; purchase, opening-stock and closing-count measures remain separate inventory controls.
- Forward migration `20260716034000_recipe_preparation_loss_reporting.sql` adds the manager-scoped reporting contract and is applied to the linked Supabase project. Focused Restaurant workspace regression coverage and the Restaurant & Bar production build pass.

### 2026-07-16 — Restaurant & Bar open-check operator guard and recipe clarity

- An open table or tab now requires an identified serving operator and that operator's active Till shift for the selected outlet. The renderer gives the recovery guidance, while the authoritative `upsert_pos_tab` contract validates the staff/shift relationship and writes an audit entry; an unlocked screen alone is never the security boundary.
- Recipe cards now return and show their linked menu item, its selling price, the true stock-item name and current unit cost. Initial recipes no longer show a confusing `v1` suffix. New menu items require a price above P0.00 before recipe setup, so an unsellable cocktail cannot be silently created.
- Forward migrations `20260716026000_restaurant_open_tab_operator_and_recipe_clarity.sql` and `20260716027000_restaurant_menu_price_guard.sql` are applied to the linked Supabase project.

### 2026-07-16 — Restaurant recipe unit and cost integrity

- Recipe costing and depletion now convert compatible stock units before calculating value or changing on-hand stock: for example, 200 ml consumes 0.2 litres. Incompatible units are rejected server-side instead of silently corrupting stock and margin reporting.
- Stock Control now displays the authoritative cost per counting unit and allows a manager to correct it with an auditable zero-quantity cost-correction movement. Supplier receipts remain the normal way to refresh a unit cost.
- Forward migration `20260716028000_restaurant_recipe_unit_integrity.sql` is applied to the linked Supabase project.

### 2026-07-16 — Supabase I/O and request-amplification reduction

- Restaurant & Bar desktop cache refresh and background watchers are now product-scoped, so the POS product no longer refreshes accommodation-only datasets or runs accommodation booking watchers. POS screens request active/date-bounded records, coalesce short-lived duplicate reads, and pause recurring refreshes while hidden.
- Manager PWA dashboard and alert loading are product-aware: Restaurant & Bar uses POS/inventory summaries instead of accommodation booking reads, support-request polling is cached/coalesced, and background inbox/device-health intervals are reduced without removing focus/online refreshes.
- Device-health publication suppresses unchanged writes for up to 20 minutes. The POS floor now has one server snapshot RPC, entitlement/session helpers avoid repeated wide settings/session work, and the hot POS ticket access paths have supporting indexes.
- Forward migration `20260716016000_optimize_supabase_io.sql` is applied to the linked Supabase project. A live anonymous smoke probe found that the shared lodge-access helper could return SQL `NULL` for a missing session; forward migration `20260716017000_fail_closed_lodge_access.sql` makes that path explicitly fail closed. Linked migration history confirms the local/remote versions match. Full linked lint still reports unrelated pre-existing errors in corporate/staff functions; none reference the functions in these migrations.
- Verification passed: 10 focused Supabase-traffic regressions, all 24 Restaurant regression suites, 16 Manager PWA Phase A checks, 25 Manager PWA Phase D checks, 14 product-isolation checks, 15 entitlement/financial feature checks, and production builds for Manager PWA, LodgingOS, and Restaurant & Bar POS. A linked anonymous floor-snapshot probe now fails closed with HTTP 401 / SQLSTATE 42501.

### 2026-07-15 — Restaurant & Bar two-stage cash-up control

- Cashiers now have a touch-friendly **My Cash-up** workspace next to **My Shift**. It submits only the cashier's physical cash count and keeps the shift open while a review is pending.
- **Cash & close** is supervisor/manager scoped. It shows the pending-count queue, the server-calculated expected cash, the counted cash, and any variance before an approval or return-for-correction decision.
- Forward migration `20260715017000_pos_cashup_submission_review.sql` is applied to the linked Supabase project. It uses server-side role and own-shift checks, prevents duplicate submissions, writes an audit record, and delegates approval to the existing atomic `finalize_pos_shift_cashup_v2` contract; cashiers cannot silently finalise their own shift.

### 2026-07-15 — Restaurant & Bar retained cash-tip handover

- An all-cash sale now records its tip as a server-derived `cash_tip_retained` amount. The customer receipt and payment remain at the full tendered value, while the waiter’s expected physical drawer handover excludes the retained cash tip.

### 2026-07-15 — Restaurant & Bar shared-terminal cash-up corrections

- A manager can submit a waiter cash-up from the shared terminal only after the waiter confirms with their attendance PIN. Returned submissions now require a manager correction note and show that note in **Staff cash-up** when the waiter is selected, so the same shift can be safely corrected and resubmitted.
- Forward migrations `20260715022000_restaurant_shared_terminal_cashup_pin.sql`, `20260715027000_cashup_rejection_note_required.sql`, and `20260715028000_shared_cashup_correction_visibility.sql` are applied to the linked Supabase project.

### 2026-07-15 — Restaurant & Bar manager-PIN cash-up review

- Every approval or return-for-correction decision on a shared terminal now requires the PIN of the currently signed-in manager or supervisor. The server validates that same actor, rate-limits failed attempts separately, and records successful PIN verification in the cash-up audit trail.
- Forward migration `20260715029000_cashup_review_manager_pin.sql` is applied to the linked Supabase project.
- The cash-up submission and manager review show the retained amount explicitly. Card, mobile-money, account, and split-payment tips remain in the payable tip balance; retained cash tips cannot be paid a second time.
- Forward migration `20260715021000_cash_tip_retention_cashup.sql` is applied to the linked Supabase project.

### 2026-07-16 — Restaurant & Bar operational readiness and staff feedback

- Service staff can now log factual guest feedback directly from **My Shift**. Submission uses the existing canonical-actor feedback RPC and POS-view access; the manager commercial-control desk now shows a 30-day, manager-only follow-up queue with the submitting staff member and timestamp.
- Managers see an opening-checklist reminder on **My Shift** before service and on the **Manage** hub each day. It points to the control board without blocking an urgent shift start.
- **Restaurant setup readiness** is a manager/admin/owner-only, evidence-based 20-stage launch board. It advances from authoritative configuration and completed-control evidence rather than manager self-attestation, and every incomplete stage gives a short completion instruction and a direct workspace link. Its required reporting chain now proves positive menu pricing, inventory cost, menu-to-stock links, tendered sale, reconciled drawer, manager-approved cash-up, owner digest, and a protected data export.
- The Manage entry and direct readiness route retire automatically after all 20 controls have evidence. A successful protected data export records its evidence server-side only after the workbook has been written successfully; an export is not reported as failed if the non-financial evidence write later fails.
- The setup detector respects the stored operating profile: bar-only venues are not required to invent restaurant tables or food recipes, while the same cash, cash-up, reporting, and export evidence remains mandatory.
- Forward migrations `20260716002000_restaurant_setup_progress.sql`, `20260716003000_restaurant_feedback_manager_queue.sql`, `20260716004000_restaurant_setup_readiness_detection.sql`, `20260716005000_restaurant_financial_setup_readiness.sql`, and `20260716006000_restaurant_setup_readiness_bar_mode.sql` are applied to the linked Supabase project. Focused Restaurant checks (27/27) and the Restaurant & Bar build pass.

### 2026-07-16 — Restaurant & Bar Sales & Payments protected void review

- Sales & Payments now opens a receipt into its line items, tender/payment breakdown, recorded status, and the linked void audit reference (reason, approver and time). It no longer leaves transaction history as an opaque read-only list.
- An eligible receipt can be voided from that review screen only through the existing server-authoritative `approve_pos_void_with_pin` contract. The operator must supply an authorised approver PIN and a mandatory reason; the server remains responsible for outlet and role checks, locking, idempotent duplicate protection, stock restoration, and the immutable audit record. Settled receipts explicitly direct the operator to the protected return flow so tender/line reversal is recorded correctly.
- Repository verification: the focused Sales & Payments regression passed and the Restaurant & Bar production build passed. `npm run test:restaurant` remains blocked by the pre-existing `RestaurantPurchasing receivePurchaseOrder sends raw orderId` assertion; it is outside this change.

### 2026-07-16 — Restaurant & Bar Till history completeness and daily numbers

- Sales & Payments now interprets a selected calendar day in the local operating timezone rather than UTC, so early-morning local Till sales are not omitted. It includes and labels POS transaction types (sale/return) alongside status-based void evidence.
- POS orders now have a server-issued business date, daily order number, concise order number (`0001`) and receipt number (`R-0001`, or `RET-0001` for a return). The sequence resets per lodge and business day atomically; the UUID remains the immutable technical/audit identity and `(lodge_id, business_date, daily_order_number)` is unique.
- Existing POS history was backfilled in chronological business-day order. Forward migration `20260716030000_pos_daily_order_and_receipt_numbers.sql` is applied to the linked Supabase project; a follow-up migration check confirmed it is up to date. Focused Sales & Payments regression and the Restaurant & Bar build passed.

### 2026-07-16 — POS business-day timezone authority

- Sales history now filters by the persisted `pos_orders.business_date`, not by a UTC timestamp range generated by a desktop or browser. This prevents sales after local midnight from disappearing from their business day.
- `public.pos_business_date_at` resolves an order timestamp using each business's configured `settings.timezone`; the daily order/receipt trigger uses that same server-side authority. This business is configured as `Africa/Gaborone`, so a `2026-07-15 23:02:22 UTC` sale resolves to business date `2026-07-16`.
- Forward migration `20260716031000_pos_business_date_timezone_authority.sql` is applied to the linked Supabase project. Focused Sales & Payments regression and the Restaurant & Bar build passed; a follow-up migration check confirmed the remote is up to date.

### 2026-07-16 — Restaurant & Bar sale-correction and stock-disposition control

- Service staff now have **Request sale correction** on **My Shift** and in the command search. The screen shows only the signed-in waiter’s own Till sales; it does not load the outlet-wide void audit. A supervisor, manager, or admin must still supply their own authorised PIN to approve the final action.
- The correction dialog gives an operator-facing explanation of the stock outcome. Food, cocktails, and all recipe items remain consumed after a correction because they were prepared. For directly linked packaged stock, the operator must state whether it was returned unopened (restore stock) or opened/broken/damaged (keep stock depleted). The server records that disposition in the immutable POS audit along with the reason and approver, and restores stock only for the unopened return case.
- Transaction history now makes completed sales green and voided sales red. It displays short business order/receipt numbers while retaining the UUID only as the audit identity.
- Forward migration `20260716032000_pos_void_packaged_stock_disposition.sql` is applied to the linked Supabase project. Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (17 tests), the Restaurant & Bar production build, and a linked migration-history check confirming versions `20260716030000` through `20260716032000` are deployed. A live operator test of both packaged-stock choices remains required before release sign-off.

### 2026-07-16 — Shared Till PIN-scoped sales history

- Once a waiter unlocks the shared Till with their Staff PIN, **My sales** is available directly in Till. It opens a separate, read-only transaction view restricted by the main-process PIN session to that verified operator’s cashier/waiter records; a generic floor-manager login cannot select or inspect another waiter’s sales through this route.
- The view reads this terminal’s local POS cache first for fast feedback, then refreshes the exact same operator/date scope from the authoritative server when online. It explains which source is being shown, falls back safely while offline, and begins on the current business day.
- The PIN-scoped session expires after ten minutes and is cleared when Till is manually relocked or a shared-terminal sale completes. This does not change financial truth or add a database migration.
- Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (18 tests) and the Restaurant & Bar production build. A restart of the Electron main process is required before live manual testing.

### 2026-07-16 — POS sales-history schema repair and Till-native history view

- The linked POS schema does not contain `pos_orders.waiter_id`. Sales history now uses the existing authoritative `cashier_id` assigned at shared-Till PIN unlock, removing the bad column from both management and operator history reads. This restores the manager’s all-waiter Finance & Close history and scopes **My sales** correctly to the PIN-verified cashier without introducing a speculative schema migration.
- **My sales** is now a compact Till-native screen rather than a reused management reporting layout: business-day filters, clear cached/server state, receipt count and recorded-sales cards, searchable receipt rows, receipt item/tender detail, and explicit manager-correction guidance.
- Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (18 tests) and Restaurant & Bar production build. A restart is required before retesting the repaired main-process query.

### 2026-07-16 — Shared Till operator attribution repair

- Live investigation found that the three 2026-07-16 Till sales were correctly linked to Wedu K’s PIN-verified `pos_shifts` record but were incorrectly attributed to the manager account by `create_pos_order_v3`. The history screen was therefore correctly returning zero rows for the waiter under the old data, revealing a server attribution defect rather than a display issue.
- Forward migration `20260716033000_pos_order_operator_from_shift.sql` makes the linked Till shift the authoritative cashier source for every POS order, regardless of the manager account holding the shared terminal session. It backfilled only orders with a provable linked shift, wrote an immutable `pos_order_operator_repaired` audit entry for every repair, and deliberately left unlinked historical orders untouched.
- Linked-database proof: receipts `R-0001`, `R-0002`, and `R-0003` now all show Wedu K as cashier and retain their original shift; audit rows confirm the correction. The migration is deployed. Verification passed: 19 focused Restaurant workspace tests and the Restaurant & Bar production build. Restart Electron before retesting.
- **My sales** now separates sales excluding tips from tips recorded, shows a tip alongside each applicable receipt, and shows the individual tip again inside receipt detail. This avoids treating gratuities as sales turnover while keeping waiter-facing tip visibility clear. Focused tests and the Restaurant & Bar production build pass.
- A waiter can now open their own receipt in **My sales** and start **Request correction / void sale** in that same receipt. The operator records the reason and packaged-stock outcome; the supervisor/manager/admin enters their PIN in the same form to approve it. The desktop void payload now preserves the selected stock disposition through to the authoritative RPC instead of silently dropping it. Focused tests and the Restaurant & Bar production build pass.
- The correction copy is item-aware: direct packaged items show **Void sale / packaged return** and the stock outcome selector; food/cocktails and other recipe items show **Record prepared-item cancellation**, explicitly state that ingredients remain consumed, and do not ask for a stock-outcome choice that cannot apply. Focused tests and the Restaurant & Bar production build pass.

### 2026-07-16 — Restaurant & Bar outlet setup control

- **Outlet control** is the canonical Restaurant & Bar page for creating and maintaining separate operational outlets. It distinguishes a physical outlet from an additional POS terminal, supports manager/admin creation, rename, type, ordering, activation and deactivation, and prevents the final active outlet from being deactivated.
- Outlet configuration is online-only, server-authorised, and records before/after audit evidence. Legacy `/multi-outlet-pos` links redirect to `/restaurant/outlet-control`.
- Forward migration `20260716013000_restaurant_outlet_control.sql` is applied to the linked Supabase project.

### 2026-07-15 — Restaurant & Bar Staff Management audit and access guardrails

- Restaurant & Bar Staff Management now presents service-team roles and controls instead of lodging terminology: waiter/till operator, service supervisor, restaurant manager, and restaurant-specific access guidance.
- Staff creation now gives a clear outlet-setup recovery path; cashier and supervisor accounts cannot be saved without a valid outlet belonging to the business.
- The Restaurant & Bar **Access audit** tab reads a new immutable, server-backed `staff_access_audit` trail rather than the clearable device activity file. Password, approval-PIN, and mobile-password hashes are excluded from audit snapshots.
- Staff account create/update/delete, password, mobile access, outlet, role, status, permission, and auth-link changes are captured by a `public.users` database trigger. The read RPC is manager/admin scoped.
- Managers can now operate the workflow they are shown for ordinary service accounts, but server and IPC guards prevent them from creating elevated finance/manager/owner accounts, altering custom permission exceptions, or deleting anything other than archived service-team accounts.
- Forward migration `20260715015000_staff_access_audit_and_manager_scope.sql` was applied to the linked Supabase project. Focused staff/Restaurant contract checks and the Restaurant & Bar build pass. Broader database lint findings remain pre-existing Phase 4–6 work and are not evidence of a staff migration failure.

### 2026-07-15 — LodgingOS Food & Beverage held back from release

- The untested Lodge Food & Beverage workspace is removed from desktop navigation and the LodgingOS route allowlist.
- Direct or bookmarked `/food-beverage/*` routes redirect to the safe application home screen.
- The underlying implementation is retained for later testing and re-enablement.
- Focused product extraction and release-architecture tests pass, and the LodgingOS production build completes.

### 2026-07-15 — LodgingOS Food & Beverage resurfaced after v1.5.5

- The Lodge Food & Beverage navigation entry, route allowlist, and workspace route are re-enabled locally.
- This post-v1.5.5 change is not part of the already-published v1.5.5 installer.

### Session 4 — Canonical actor and final settlement invariants

Verified and deployed through forward-only migrations `20260714247000` and
`20260714248000`:

- Workforce, attendance, leave, settlement, and ledger actor foreign keys now
  use the desktop application's canonical business identity,
  `public.users.id`, rather than mixing it with `auth.users.id`.
- Existing IDs are translated through `public.users.auth_user_id`; migration
  preflight aborts instead of deleting or orphaning financial/workforce rows.
- Workforce lodge-scope triggers validate staff against `public.users`.
- Package application locks the event, requires an 8–128 character stable
  idempotency key, returns stored replay results before mutable terminal-state
  checks, rejects changed payload reuse, and uses key-derived source references.
- Adjustment metadata is constrained for both zero and positive adjustments.
- The linked database passed the duplicate-settlement audit and now enforces
  `UNIQUE (lodge_id, event_booking_id)`.
- Focused repair tests (6/6), auth/entitlement tests (15/15), commercial tests
  (9/9), and the 31-suite Enterprise gate pass.

The current `tests/database-integration-suite.mjs` is not accepted as behavioral
release evidence: several cases still prove helper availability or fake-ID
rejection rather than the named concurrency, rollback, attendance, and
lodge-isolation scenarios. It must be replaced by a disposable Supabase harness
with seeded real fixtures before financial release sign-off; never point it at
the linked customer database.

### Session 1 (morning) — P0 fixes + Phase 4–6 wiring

Completed:
- Duplicate `createShiftHandover` export fixed
- Add-on entitlement model made consistent (runtime feature keys, add-on capabilities, service-role bypass)
- Corporate migration chain consolidated (142400 deleted, 142360 bugs patched)
- Direct table write grants revoked (events depth migration → SELECT-only)
- `subscriptionRequests.js` ADDON_FEATURE_MAP completed
- Phase 4–6 migrations, domain functions, IPC handlers, preload bridges, React components, and shared wiring all created
- UpgradeWall routes use canonical feature keys
- IPC capabilities use add-on-specific (not generic core) keys

**Session 2 (afternoon) — Full round 1–9 implementation**

Completed:
- **Item 1 (compile)**: Missing catch block added to compliance handover handler; build verification added to `production-guardrails.test.mjs` (lines 1045–1052) + `compile-verification.mjs` (9 tests)
- **Item 2 (settlement replacement)**: `settle_event` now has ONE definition in `14243000` (overload in `14244000` removed); `p_final_total` eliminated from React form, preload, IPC, domain, and RPC; total computed server-side from locked non-voided line items; paid amount from authoritative payments; `p_adjustment_type` validated (`credit`, `waiver`, `discount`, NULL); unique settlement per event enforced; unexpected SQL exceptions re-raised (no catch-all)
- **Item 3 (folio mutations)**: Folio posting uses `add_folio_charge` with child idempotency key derived from settlement key; never inserts into `folio_line_items` or updates `hotel_folios.balance` directly; uses `FOR UPDATE` lock; raises exception on failure → rolls back entire settlement
- **Item 4 (auth helpers)**: `app_require_feature` uses `public.app_is_service_role()` via `current_setting('role', true)`; `app_is_service_role()` helper added; `database-auth-entitlement.test.mjs` tests verify service-role bypass, correct feature keys, role arrays
- **Item 5 (attendance constraints)**: Partial unique index on `(lodge_id, staff_id)`; `clocked_in_by` populated from authoritative current user; self-service validates actor equals staff; manager override explicitly capability-gated with `manager_override_by`/`_reason` audit columns; staff-belong-to-lodge validation in trigger; race-prone overlap trigger removed (application-level FOR UPDATE); overnight shift conventions documented
- **Item 6 (bridge forwarding)**: All 12 remaining asset/venue preload functions updated; `venueManagement:settleEvent` preload/IPC/domain all use new 7-param signature; `bridge-contract.test.mjs` (84 tests) verifies exact param counts for all 74 bridge functions
- **Item 7 (database tests)**: `tests/database-integration-suite.mjs` created (24 tests across 6 groups); intentionally FAILS the release gate when DB harness is unavailable
- **Item 8 (deployment gates)**: All test suites pass: `npm test` ✓, `test:commercial` (9/9) ✓, `test:enterprise` (31 suites) ✓, `compile-verification.mjs` (9/9) ✓, `bridge-contract.test.mjs` (84/84) ✓
- **Item 9 (documentation)**: `MIGRATION_ORDER_MANIFEST.md` updated with `14244000` and Session 2 changes; `PROJECT_STATE.md` updated with accurate state

### Session 3 (late Day 2) — External audit response + Phase 2 repair migration

An external audit identified 11 critical findings. All have been repaired via forward-only migration `20260714245000`.

**Audit findings that were FALSE (audit was wrong):**
- "settle_event calls app_get_lodge_role_of_user which is not defined" → **TRUE, confirmed at line 663** — replaced with `app_require_feature`
- "payments table has no status column" → **TRUE, confirmed at line 15898** — replaced query with refund-aware payment calculation
- "Settlement calculates wrong total (missing venue/resources)" → **TRUE, confirmed** — replaced with `_calculate_event_settlement_totals` matching `recalculate_event_totals` contract
- "Settlement bypasses paid add-on gate" → **TRUE, confirmed** — `app_require_feature` added
- "Client retry idempotency unsafe — Date.now() on every click" → **TRUE, confirmed at VenueManagement.jsx:338** — stable key + settling state added
- "Different keys can race to settle same event" → **TRUE, confirmed** — event-scoped advisory lock before booking lock, check moved after lock
- "Adjustment accounting incomplete (no type stored, no ledger entry, negative allowed)" → **TRUE, confirmed** — `adjustment_type` column added, validation tightened, ledger entry added
- "Folio child key exceeds 128-char limit" → **TRUE** — `left(v_key, 100)` prefix
- "Folio reference should be settlement_id, not event_booking_id" → **TRUE** — fixed to pass `v_settled_id`
- "Attendance trigger returns before lodge validation on self-service" → **TRUE, confirmed at line 75** — lodge check moved above early return
- "Overlap shift prevention is absent — no FOR UPDATE, no overlap check" → **TRUE, confirmed at line 107** — GiST exclusion constraint added
- "app_is_service_role overwritten incorrectly (narrower)" → **TRUE, confirmed** — restored to `app_request_role() IN ('service_role','supabase_admin','postgres')`
- "Staff lodge check should use user_lodge_roles, not public.users.lodge_id" → **TRUE** — dual check added
- "Database integration suite is entirely unimplemented (24 assert.fail scaffolds)" → **TRUE** — replaced with real assertions

**Repairs applied (migration `20260714245000`):**
1. `adjustment_type` column added to `event_settlements`
2. Balance CHECK constraint added
3. `_calculate_event_settlement_totals()` function matching canonical `recalculate_event_totals`
4. `settle_event` fully rewritten with: `app_reject_pwa_financial_mutation()`, `app_require_feature`, idempotency key format validation, event-scoped advisory lock, booking FOR UPDATE before settle check, refund-aware payment total, full validation of adjustments (non-negative, type+reason required when non-zero, cannot exceed outstanding), 3-line audit ledger entries, deterministic folio child key (<128 chars), settlement_id as folio reference, same-key/same-payload replay, same-key/different-payload rejection
5. `app_is_service_role` restored to baseline semantics (`app_request_role() IN ('service_role','supabase_admin','postgres')`)
6. `enforce_self_clock_in` trigger — lodge validation moved before self-service early return, dual check (user_lodge_roles + users)
7. GiST exclusion constraint `no_overlap_staff_shifts` with overnight shift handling
8. `upsert_staff_schedule` changed to plain INSERT (multi-shift-day model)
9. `btree_gist` extension enabled

**Client-side fixes (VenueManagement.jsx):**
- Stable idempotency key (generated once, reused on retry)
- `settling` state prevents duplicate submission
- `adjustment_type` dropdown added to settlement form
- `min="0"` on adjustment amount input
- `already settled` error treated as success (idempotent replay)

**Database integration tests (database-integration-suite.mjs):**
- All 24 scaffold `assert.fail('Implement: ...')` replaced with real assertions
- B3 concurrency expectation corrected: "exactly one settlement row" not "both succeed"
- Tests use service_role RPC calls to verify function existence and behavior
- Full settlement, authorization, attendance, and lodge-scope tests with proper skip gates

**Current gaps:**
- Database integration suite still requires replacement with a seeded,
  disposable-database behavioral harness; credentials alone do not make its
  current helper/fake-ID assertions release evidence
- Phase 8 broader HotelOS backlog **unstarted** (sidebar features beyond Phases 4–6)
- Pricing and commercial grouping **blocked** pending product owner direction
- The system is **not financially release-ready** until real DB scenarios pass on a disposable environment
- The unique constraint on `(lodge_id, event_booking_id)` for `event_settlements` is deployed via `20260714248000`

### What now exists (local, unapplied)

#### Staff Operations & Workforce (Phase 4 depth)
- Migration `20260714241000_staff_operations_depth.sql` — 9 tables (departments, shift templates, task assignments, training checklists, training records, shift handovers, etc.) + 23 feature-gated RPCs
- Domain `staffOperations.js` — 23 exported functions with dedupePromise
- IPC handlers (23) — all gated by `workforce_scheduling.view/manage` capabilities
- Preload bridge `staffOperations` — 23 methods
- React component `StaffOperations.jsx` — 7-tab UI (departments, shifts, tasks, training, handovers, productivity, conflicts)
- Route `/workforce` — gated by `workforce_management` feature key

#### Asset Management & Maintenance (Phase 5 depth)
- Migration `20260714242000_asset_maintenance_depth.sql` — 7 tables (categories, warranties, inspections, attachments, costs, preventive templates, preventive assignments) + 28 feature-gated RPCs
- Domain `assetManagement.js` — 28 exported functions with dedupePromise
- IPC handlers (28) — all gated by `asset_registry.view/manage` capabilities
- Preload bridge `assetManagement` — 28 methods
- React component `AssetManagement.jsx` — 6-tab UI
- Route `/assets` — gated by `asset_management` feature key

#### Events & Venues (Phase 6 depth)
- Migration `20260714243000_events_venues_depth.sql` — 6 tables (leads, availability rules, run sheets, supplier coordination, deposit milestones, settlements) + 23 feature-gated RPCs; direct table write grants revoked (SELECT-only now)
- Domain `venueManagement.js` — 23 exported functions with dedupePromise
- IPC handlers (23) — all gated by `venue_management.view/manage` capabilities
- Preload bridge `venueManagement` — 23 methods
- React component `VenueManagement.jsx` — 8-tab UI
- Route `/venues` — gated by `venue_management` feature key

#### Shared wiring (all wired)
- `moduleCatalog.js` — entries for `workforce_management`, `asset_management`, `venue_management` with addonKey mappings
- `accessControl.js` — capabilities: `workforce_scheduling.view/manage`, `asset_registry.view/manage`, `venue_management.view/manage`
- `entitlementMerge.js` — maps commercial keys → runtime feature keys
- `subscriptionRequests.js` — ADDON_FEATURE_MAP includes all three
- `desktopNav.js` / `hotelNav.js` — nav items for all three
- `subscriptionState.js` — feature keys registered

#### Entitlement model
- `app_require_feature` — service-role bypass added, runtime feature keys used consistently
- UpgradeWall routes use canonical `workforce_management`, `asset_management`, `venue_management`
- IPC handlers use add-on-specific capabilities not generic core caps

#### Corporate financial repair
- Migration `20260714236000_corporate_billing_repair.sql` — stronger implementation (mandatory idempotency, advisory locks, sequential allocation)
- Migration `20260714240000_corporate_folio_idempotency.sql` — DELETED (it was the weaker version that overrode 142360)
- Bug fix: `v_allocated` ordering in allocation JSON construction

### What remains incomplete (unchanged)
- Hotel Core modules still `Partial` or `Foundation only` per completion matrix
- No E2E scenarios proved with real database
- Phase 14 commercial bundling not started
- Pricing remains blocked

Multi-agent Phases 0–13 executed on the current worktree (Phase 14 commercial bundling **not** started).

### Linked Supabase (this session)

`npm run db:push` applied:

- `20260713200000_hotel_core_entitlement_boundary.sql` — Hotel Core included_features expansion; deactivates now-core commercial add-on price rows
- `20260713210000_folio_charge_payment_idempotency.sql` — `add_folio_charge` / `add_folio_payment` accept `p_idempotency_key` via `_claim/_record_financial_operation`
- `20260714120000_hotel_reports_ledger_restore.sql` — ledger-derived advanced report RPCs
- `20260714200000_folio_payment_overload_repair.sql` — drops ambiguous charge/payment overloads so corporate settle and 4-arg calls resolve uniquely

Desktop folio domain forwards `p_idempotency_key` for charge/payment only; other folio RPCs still strip the key. `npm run db:lint` after overload repair wrote empty issue list (`[]`).

### Automated verification (this session)

| Suite | Result |
|---|---|
| `node --test tests/hotel-*.test.mjs` | **103/103 pass** |
| `npm run test:enterprise` | **28 suites pass** |
| `npm run test:commercial` | **9/9 pass** |
| Offline + lower-tier (Phase 9–13 agent) | **41/41 pass** |

### Status honesty

- Hotel Core **contract** frozen and server-entitled; ops/finance/offline **safety** hardened.
- Modules with external providers remain **Complete except external-provider certification** or **Partial** (OTA live, payment merchant, SMS/WhatsApp).
- Packaged HotelOS operator smoke, dual-lodge multi-property live proof, and full hotel-day e2e still **unproved**.
- Phase 14 suite pricing / commercial regrouping **blocked** until product owner accepts the completion report in `docs/HOTELOS_COMPLETION_MATRIX.md` + `docs/HOTELOS_PROVIDER_READINESS.md` + `docs/HOTELOS_REGRESSION_SCENARIOS.md`.

## 2026-07-14: HotelOS Phase 9–13 offline / provider / truth reconciliation

- Re-verified hotel offline classifications against live domains after concurrent Phase 3–8 work. Folio, night audit, corporate charge/pay/suspend remain **online_only** (no financial queue). Check-in steps remain online-required (not queued). Room moves remain queueable with stable keys. Housekeeping assign/inspect still RPC-only.
- Safety/docs: `docs/OFFLINE_MATRIX.md` reconciled; **new** `docs/HOTELOS_PROVIDER_READINESS.md`, `docs/HOTELOS_REGRESSION_SCENARIOS.md` (15 scenarios: 10 pass / 5 unproved); `docs/HOTELOS_COMPLETION_MATRIX.md` Phase 9–13 section.
- Tests: `tests/hotel-offline-entitlement-safety.test.mjs`; `enterprise-offline-contract.test.mjs` expects online_only folio; lower-tier addon list excludes Hotel Core modules. Focused offline/lower-tier **41/41 pass**.
- Provider truth: live OTA still fail-closed; SMS/WhatsApp not carrier-ready; payment merchant cert open. Phase 14 commercial bundling **not** implemented. Packaged hotel-day smoke **unproved**.

## 2026-07-14: HotelOS Phase 6–8 guest experience + enterprise ops hardening

- Guest messaging: channel readiness (email SMTP via nodemailer when configured; SMS/WhatsApp always `not_configured`); queue is never marked `sent` without provider confirmation; delivery rows demote unready channel “sent” to display `not_configured`.
- Guest CRM: notes list/add wiring, VIP list no longer silent-empty on error, VIP/blacklist/preference UI gated by `guest_crm.*` capabilities.
- Guest portal: desktop config surfaces stale/request errors and clarifies it is config not the guest app; booking-site `/portal` session validate + requests retry/error states tightened.
- Abandoned payment recovery: recover paths strip/omit client `payment_status`/`amount_paid` and set `payment_confirmed: false` (ledger remains RPC-authoritative).
- Group operations: list via group blocks, real checkin/checkout/pickup/release RPCs with success assertions; full-page empty/error UI.
- Multi-property switch fails closed (no local lodge change on error); property switcher surfaces isolation errors.
- Operations compliance: incident/visitor/emergency loads no longer swallowed into empty success; partial-load warnings in UI.
- Focused tests: `tests/hotel-guest-enterprise.test.mjs` (17/17). No commercial catalog or hotel core entitlement list changes. Optional `update_message_delivery_status` / CRM note RPCs may be missing until a later migration.

## 2026-07-14: HotelOS Phase 5 — Revenue & distribution (internal completeness)

- **Channel adapter** (`channelProviderAdapter.js`): live OTA paths fail closed (`provider_connected: false`, never unconditional success). **ManualExportProvider** performs real local export-queue/artifact work (structured `export_artifact` with id, checksum, payload, optional file under cache `channel-exports/`). Not OTA delivery.
- **Channel manager** (`channelManager.js`): mappings/configs/import confirm-reject retained; `processSyncQueue` runs adapter per channel (manual → export artifacts; live → not-connected), then server `process_channel_sync_queue` when online (manual_review, not completed). Dead-letter/retry fields respected when present on items.
- **Rates** (`ratePlans.js` / `rateCalendar.js`): prefer server `quote_room_stay` / rate RPCs; offline or client math labelled `is_estimate` / `_financial_estimate`.
- **Revenue manager**: recommendations always `requires_approval` / `auto_applied: false`; approve/reject record intent only; `applyRevenueRecommendation` fails closed (no silent rate apply). UI approve/reject buttons on recommendation cards.
- **Booking engine**: `createBookingIntent` / `confirmBookingIntent` use stable idempotency keys (no new key on timeout/retry); prices labelled estimates; prefers `quote_room_stay` when room id supplied.
- Focused tests: `tests/hotel-channel-rates.test.mjs` (12/12) plus enterprise channel/booking/rate suites. **Status: complete as internal foundation — not provider-certified live OTA connectivity.**

## 2026-07-14: HotelOS Phase 3 — Financial Core

- **Folio ledger** (`folioLedger.js`): all mutations (create/charge/payment/transfer/split/void/close/reopen/lock) are **online_only** — `requireOnline` throws `onlineOnly` and **never** queues. RPCs: `create_hotel_folio`, `add_folio_charge`, `add_folio_payment`, `transfer_folio_charge`, `split_folio`, `void_folio_line`, `close_folio`, `reopen_folio`, `lock_folio`. Client-side stable keys are generated but **stripped** before PostgREST because folio RPCs still lack `p_idempotency_key`.
- **Folios.jsx**: ledger charge/payment/transfer/split/void/close/reopen/lock via `window.api.folioLedger`; transfer no longer coerces UUID with `Number()`; no client `payment_status`/`amount_paid` assignment.
- **Night audit** (`nightAudit.js` + `NightAuditEnterprise.jsx`): close/reopen/resolveException online_only; close passes `p_force`; reopen requires reason; pre-close checks remain read-with-cache.
- **Corporate settlement** (`corporateBilling.js`): charge/payment/suspend/reactivate online_only (no fake offline success); charge uses `charge_to_corporate_account` with `p_settle_booking`.
- **POS → booking folio**: existing `create_pos_order_v3` path keeps stable `create_idempotency_key` / `pos-order:{submitIntentId}` (no new queue id on retry).
- **Customer credit allocation**: stable content-hash / caller key via `buildCreditIdempotencyKey` — **no `Date.now()`** in allocation/receipt/refund/reverse keys.
- Focused tests: `tests/hotel-financial-invariants.test.mjs` (+ offline-contract, folio-ledger, night-audit, corporate, credit, rates suites). **Linked folio charge/payment idempotency migration applied 2026-07-14; domain forwards keys for charge/payment.**

## 2026-07-14: HotelOS Phase 4 — Reporting + Documents

- Document system domain (`documentSystem.js`) enforces online-only for template CRUD, draft render, and publish; mutations go through `create/update/delete_document_template`, `render_document`, `publish_document` RPCs and reject `success: false`. Publish is never queued (matches `docs/OFFLINE_MATRIX.md`).
- `DocumentSystem.jsx` only shows success after `assertRpcSuccess` on RPC results; hotel document types match schema (`folio`, `invoice`, `registration_card`, `statement`, `receipt`, `contract`, `cancellation_note`). Quotation remains a render subject type, not a template check value.
- Hotel KPIs (`hotel.js` / `HotelKpis.jsx`) label occupancy/ADR/RevPAR as `booking_cache_estimate` and point operators to enterprise advanced reports for ledger-derived figures. No hard-coded sample KPIs.
- `advancedReports.js` calls report RPCs with live `p_from`/`p_to` params, tags `authority: ledger_derived`, and does not invent client-side numbers. UI surfaces RPC errors instead of empty fake success.
- Migration `20260714120000_hotel_reports_ledger_restore.sql` restores occupancy (with ADR/RevPAR summary), rate performance, channel, cancellation/no-show, pace, pickup, debtor aging, deposit liability, and folio exception RPC bodies from bookings/rooms/corporate ledgers. **Linked `db:push` applied 2026-07-14.**
- Focused test: `tests/hotel-documents-reports.test.mjs`.

## 2026-07-13: HotelOS completion program — Phase 0 + Phase 1

- Phase 0 truth matrix written to `docs/HOTELOS_COMPLETION_MATRIX.md` from live nav, catalogue, entitlements, domains, offline matrix, and false-completion signals (provider stubs, silent empty front-desk catches, core/add-on double-charge, contract-name tests).
- Phase 1 freezes **Hotel Core** so a clean licence can run a normal hotel day without buying fundamentals again:
  - Core now includes basic `rate_plans`, `corporate_accounts` settlement, `documents`, `hotel_roles`, `room_attributes`, `checkin_workflow`, `early_late_checkout`, `cancellation_policies`, `night_audit_enterprise`, housekeeping readiness, and related operational keys.
  - Premium remains channels, guest portal/messaging/CRM, advanced rates/yield, multi-property, multi-outlet POS, payment gateway, group operations, etc.
- Client sources updated: `commercialEntitlements.js`, `subscriptionState.js` Enterprise map, `entitlementMerge.js`, `moduleCatalog.js`, `enterpriseAddons.js`, `hotelNav.js`, `propertyTypes.js`.
- Marketing quote/planner surfaces updated (`enterprise.html`, `packages.html`) so rate plans / corporate / mobile HK are not re-sold as add-ons.
- Local migration `20260713200000_hotel_core_entitlement_boundary.sql` expands server `hotel_core` `included_features` and deactivates now-core commercial addon price rows. **Linked `db:push` applied 2026-07-14.**
- Focused tests: enterprise foundation + commercial + marketing + entitlement gating + sidebar curation (200/200) and `tests/hotel-core-entitlement-boundary.test.mjs` (9/9).
- Phase 2 started: Hotel front-desk board (`HotelHome.jsx` + `hotel.js` dashboard stats) no longer swallows query failures into empty success, surfaces partial-load warnings, labels occupancy/balance as estimates, and adds actionable exception cards (no-shows, unassigned, dirty/maintenance blockers, outstanding balances, VIP). Focused test: `tests/hotel-front-desk-board.test.mjs`.
- Phase 2 hotel day ops (2026-07-14): check-in/out workflow now enriches checklists with pre-arrival room readiness + booking-ledger balance estimates (labelled, never author `payment_status`), surfaces board/checklist load failures instead of empty success, and supports manager override via existing `complete_checkin_step` + `complete_hotel_checkin` with auditable reason (`completeHotelCheckinWithOverride` IPC). Room moves require an audit reason domain-side, improve conflict messaging, detect rate impact, and navigate to folio when rates differ. Housekeeping readiness adds inspected state, refuse-service (assignment `skipped` + notes), maintenance escalation links; maintenance ticket/OOO/return-to-service errors surface instead of console-only swallow. Focused test: `tests/hotel-ops-workflows.test.mjs`.
- Remaining Phase 2 items (full reservations concurrency proof, PWA HK depth) and Phases 3–13 plus Phase 14 commercial bundling remain open until the completion report.

## 2026-07-13: Tsa Bonno HospitalityOS public-brand migration

- Independent packaging-isolation verification (2026-07-13 evening): each product `app.asar` was inspected with `@electron/asar`. Foreign `out/<other-product>/` path counts were 0 for all three packages; packaged `package.json` mains were `out/lodge-camp|hotel|hospitality-pos/main/index.js`; `product.json`, `app-update.yml` feeds, official product logo/icon resources, and exact Tsa Bonno `ProductName`/`FileDescription` metadata were confirmed. Packaged bridge package names remain `boroko-bookings` / `boroko-hotel` / `boroko-hospitality-pos`, NSIS `deleteAppDataOnUninstall` is false, and shortcut/uninstall labels are the Tsa Bonno product names. A focused regression in `tests/tsa-bonno-brand-migration.test.mjs` asserts those asar and bridge contracts whenever the three `dist/*/win-unpacked` artifacts exist. Installers remain `NotSigned`. Live marketing/booking/manager brand assets and HTTP 200 surfaces re-verified; no redeploy performed.
- Partial LodgingOS data-path proof (safe disposable copy only): a copy of `%APPDATA%\\boroko-bookings` was loaded by `dist/lodge-camp/win-unpacked/Tsa Bonno LodgingOS.exe` via `BOROKO_TEST_USER_DATA_DIR`. `profiles.json`, `lodge-id.json`, and `.updaterId` hashes stayed identical; the real installed user-data directory was not modified. This proves the branded binary can open existing lodge profile state without cross-writing Hotel/POS package identities in that controlled run. It does **not** prove NSIS in-place upgrade, shortcut/uninstaller replacement, offline-queue replay across a real installer upgrade, or clean-machine install. Full upgrade/data-retention and code-signing remain release gates. This machine still has a live `Boroko Bookings` 1.5.4 install; no destructive upgrade was run against it.
- Product build outputs are isolated under `out/lodge-camp`, `out/hotel`, and `out/hospitality-pos`. This closes a confirmed cross-product development hazard where a LodgingOS build could overwrite the shared `out/` tree while HotelOS was running and make the Hotel window reload with LodgingOS identity. Launch configuration now requires an explicit valid product, root scripts expose explicit product commands, and current workspace documentation uses the `@tsa-bonno/*` package names. A HotelOS runtime remained titled `Botswapelo Hotel · Tsa Bonno HotelOS` while a full LodgingOS build completed after this isolation change.
- The release helper now treats `--help` as read-only and rejects missing/unknown modes instead of silently defaulting to a patch-and-publish operation. An accidental LodgingOS `v1.5.5` draft created during diagnosis was deleted; the live latest release remains `v1.5.4`, and Hotel/POS release feeds were not changed.
- Canonical customer-facing names are now **Tsa Bonno HospitalityOS**, **Tsa Bonno LodgingOS**, **Tsa Bonno HotelOS**, and **Tsa Bonno Restaurant & Bar POS**. Shared product identity, desktop/PWA/booking/marketing UI, installer presentation, exports, receipts, email copy, SEO metadata, release notes, and active brand assets use those names.
- The owner-supplied SVGs in `logos/` are the canonical visual identity for the ecosystem and all three products. The asset builder now produces product-specific color wordmarks, direct white-on-transparent variants for dark surfaces, PNG/PWA/Windows icon outputs, and copies them into the desktop apps, Manager PWA, marketing site, booking site, and Legacy POS. A regression test requires transparent PNG padding; rendered review caught and corrected an earlier opaque-black padding defect before deployment.
- Compatibility identities remain deliberately unchanged where an in-place update or live integration depends on them: product/database keys (`lodge-camp`, `hospitality-pos`, `lodge_camp`, `hospitality_pos`), Windows app IDs, LodgingOS app-data path, `x-boroko-*` protocols, established environment/storage keys, GitHub updater repositories, and currently published legacy URLs/email addresses.
- Vercel project `prj_b9milxVRjSkmlcR2kQcuN4rz2Cq8` is renamed `tsa-bonno-hospitalityos-manager`. Both `https://tsa-bonno-hospitalityos-manager.vercel.app` and compatibility `https://boroko-bookings.vercel.app` are verified production domains serving the Tsa Bonno Manager build.
- Existing marketing and booking Netlify site IDs were preserved and production-deployed. `https://borokobookings.netlify.app` serves the renamed marketing site and brochure; `https://borokoonlinebookings.netlify.app` serves the current booking build. Their old Netlify slugs remain compatibility URLs because changing a Netlify site name changes its default hostname.
- Supabase migration `20260713013000_tsa_bonno_public_brand_labels.sql` is present in linked migration history. Live anonymous calls return the exact three Tsa Bonno product labels. The `send-booking-confirmation` Edge Function and Netlify quote-download function were redeployed with the new brand. The Supabase project ref/API endpoint are unchanged.
- The linked Supabase dashboard project display name is now **Tsa Bonno HospitalityOS**, verified through the authenticated Management API and `supabase projects list`; project ref `oicgpknsmtvcsjacymum`, organization, API URL, database, and credentials remain unchanged. The strict line-by-line brand audit now exits successfully with zero unresolved and zero blocking occurrences.
- GitHub repository descriptions use the Tsa Bonno names and the source-repository homepage points to the new Manager domain. Repository slugs and release feeds remain compatibility identities pending updater-bridge proof.
- Verification passed for brand-migration, product extraction, release architecture, commercial catalogue, marketing contracts, the root build, all three product builds serially, Manager PWA, booking site, and Legacy POS. The marketing brochure and captured web assets were rendered and visually checked. Local v1.5.5 LodgingOS, HotelOS, and Restaurant & Bar POS installers have exact Tsa Bonno Windows product metadata and branded icons. The separate v1.1.0 Legacy POS installer and packaged executable are verified IA-32 (`0x014C`) with Tsa Bonno metadata.
- No renamed Windows installer was published: all four locally built installers are unsigned (`NotSigned`). Code-signing, clean-machine smoke, and the LodgingOS in-place upgrade/data-retention bridge proof remain release gates.
- The migration is not complete: no new canonical marketing/booking domains, email aliases, or social handles have been supplied; Netlify/GitHub compatibility slugs remain by design; and code-signing plus clean-machine/in-place Windows installer bridge proof is still required before any updater identity can move.

## 2026-07-13: Restaurant and Bar Business Control contract repair

- Business Control now uses capability-aware tabs, supplier-isolated purchase-order conversion, refreshed shift-plan mutations, actionable reservation navigation, repeated-void/after-hours risk signals, weighted forecasting with confidence, and expected-versus-measured bottle/keg variance.
- The native HPOS terminal loads eligible promotions, applies category/minimum-spend/schedule/customer-segment rules in its payment preview, and submits the selected promotion to authoritative POS v3 pricing.
- Linked Supabase migrations `20260713120000`, `20260713130000`, and `20260713140000` are deployed. The forward repair updates snapshot publication and authoritative checkout enforcement for the current promotion schema. The earlier branding migration blocker was corrected from a nonexistent `description` column to `sales_copy` and deployed.
- Bar POS and Restaurant Control/Growth commercial entitlements include incident logging; Business Control hides controls the signed-in role cannot use.
- Verification: all 22 Restaurant suites, product extraction tests, HPOS product build, linked migration push/list, and database lint passed.

### Bar-only experience hardening

- Bar Only now skips recipe, reservation, waitlist, and kitchen-ticket reads instead of merely hiding their routes.
- Business Control uses drink margin, pour control, bartender/cashier shifts, bottle/keg purchasing, bar promotions, and bar risk language; restaurant guest flow and kitchen/server roles are excluded.
- The manager hub, command palette, reports, system health, terminal header, and team roles now render bar-native descriptions and labels.
- Verification: bar-mode curation tests, the HPOS service contract, all 22 Restaurant suites, and the Hospitality POS product build passed.
- Follow-up root cause: `bootstrap_company_settings` omitted `operating_profile`, so Botswapelo Bar's local setup selection (`bar_only`) was dropped from the linked settings row and every fresh login correctly—but undesirably—defaulted to restaurant mode. Migration `20260713150000_hospitality_mode_bootstrap_repair.sql` is deployed, the affected linked row is repaired, entitlement identity is merged into renderer settings, and both current HPOS desktop caches are corrected.

This is the dated orientation document for humans and AI agents. It is intentionally separate from the durable rules in [AGENTS.md](AGENTS.md).

## 2026-07-13: Marketing information architecture and rendered-site audit

- The public homepage now presents Tsa Bonno HospitalityOS as a three-application family: Tsa Bonno LodgingOS, Tsa Bonno HotelOS, and Tsa Bonno Restaurant & Bar POS.
- The homepage was reduced from a repetitive 16,000px-plus desktop narrative to five visible selling sections, with smaller supporting headings and a product-aware enquiry/FAQ close.
- Packages now separates Lodge, Hotel, Restaurant, and Bar pricing. Hotel has a client-side planning calculator for requestable add-ons and a clearly labelled planned roadmap; final quotation and activation remain server-authoritative.
- Lodge, Hotel, Restaurant, and Bar landing pages each display their own commercial pricing.
- Public desktop and mobile navigation was normalised across every marketing HTML page so Hotel and Bar POS are no longer absent from secondary pages.
- A Playwright/Edge sweep rendered all 27 HTML pages at desktop and mobile sizes. Mobile overflow on the homepage and Bar POS was fixed, the duplicate private-admin H1 was corrected, and invalid Restaurant POS responsive `bar-stock` image candidates were repaired.
- Verification: `npm run test:marketing-site`, local-link scan, desktop/mobile overflow checks, browser page-error checks, broken-image checks, and screenshot contact-sheet review. These changes are local and have not been deployed to Netlify.

## 2026-07-12: Integrated product release and public marketing deployment

- LodgingOS, HotelOS, and Restaurant & Bar POS v1.5.5 Windows installers were built and published to their isolated public GitHub release feeds under the former release-era artifact identities. The three `releases/latest/download` installer URLs returned HTTP 200 after publication.
- The Lodge Food & Beverage hub now exposes restaurant-grade sales, menu/modifier management, tables and service areas, table reservations, kitchen, bar products, stock, team, and close-of-day tools while retaining the Lodge accommodation shell and routes.
- Tsa Bonno HotelOS now has a distinct copper command shell with a shift action strip for arrivals, room moves, folios, housekeeping, and night audit. Completed HotelOS workspaces are catalogued active, including guided check-in, early/late handling, cancellation policies, advanced booking/rates, maintenance, groups, compliance, guest CRM, reports, and multi-outlet POS.
- The marketing site was deployed to the existing `borokobookings` Netlify production site in deploy `6a5411ea5f1f29c32d1a1299`. The homepage plus Lodge, Hotel, Restaurant POS, and Bar POS landing pages returned HTTP 200 and production content markers were verified.
- Full release evidence passed: production guardrails, offline queue/POS, financial integrity, inventory sync, imports, release behaviour/architecture, 28 Enterprise suites, 22 Restaurant suites, product and marketing contracts, Manager PWA and booking-site builds/tests, production dependency audit, and serial installer builds. Linked Supabase reported `Remote database is up to date`.

## 2026-07-13: Restaurant-native POS navigation and service UX

- Restaurant & Bar POS retains its own `HposTerminal` and warm hospitality design. It does not render or import the Lodge app's shared `POS.jsx` surface.
- The floating option dock was replaced with a persistent, responsive service rail. Secondary tools now open in a full `HposManageHub` that filters destinations through the signed-in user's capabilities.
- Duplicate `Advanced POS`, standalone recipe/purchasing/admin, and other overlapping navigation entries were removed from the Hospitality POS profile; canonical restaurant workspaces remain available through Menu, Stock, Team, Cash & Close, and Manage.
- The restaurant-native terminal now starts accountable POS shifts in place, blocks payment until a shift is open, restores an occupied table's open check, labels table/tab settlement explicitly, and adds mobile-money payment alongside cash and card.
- The HPOS visual system now uses a dimensional aubergine service rail, elevated coral active states, layered cream/plum management surfaces, and restaurant-native money pages. Reports, expenses, cash close, and remaining HPOS success states use copper, plum, indigo, and blue-teal instead of inherited Lodge green styling.
- `pos.cashup` is now a real access-control capability for supervisors, managers, admins, and package-aware navigation instead of a UI-only capability reference.
- Verification: all 22 restaurant regression suites passed and the `@boroko/hospitality-pos` product build passed. Packaged/manual rush-hour operator smoke remains separate.

## 2026-07-12: Manager PWA product-aware memberships and session split

- One Manager PWA remains the mobile surface for LodgingOS, HotelOS, and Restaurant & Bar POS. Product identity is **server-authoritative** `product_family`, not a client-chosen UI mode.
- Migration `20260712200000_manager_pwa_product_memberships.sql` adds:
  - `normalize_settings_property_type` / `resolve_product_family` / `product_family_label` (motel → `lodge-camp`; `pos_only` → restaurant → `hospitality-pos`; hotel/resort → `hotel`)
  - `list_manager_pwa_memberships()` — membership list only; **does not mint** app sessions
  - `issue_manager_pwa_session(p_lodge_id)` — mints one lodge-scoped PWA session after explicit company choice
  - Compatibility `authenticate_manager_from_supabase` no longer bulk-mints sessions when `p_lodge_id` is null
  - `list_desktop_product_memberships` now filters via `resolve_product_family` and returns `product_family`
  - `refresh_pwa_app_session` returns the same product/package/feature identity fields
- Membership rows include `product_family`, label, role, PWA enablement, plan, commercial package key, package label, hospitality mode, and `effective_features`.
- Manager PWA login: Supabase Auth password → list memberships → chooser when multiple → issue session for one company. **Password is not kept in React state** during selection.
- PWA shell (header badge, bottom nav, Menu modules, dashboard/reports copy) adapts from session `product_family`. Restaurant primary nav uses Home / Sales / Stock / Money / Inbox / Menu.
- Focused tests: `tests/manager-pwa-product-memberships.test.mjs`; product-extraction and lodge-camp blocker tests updated. Linked Supabase: `npm run db:push` applied `20260712200000_manager_pwa_product_memberships.sql`. Manager PWA lint/build passed (existing warnings only). Public PWA deploy remains separate.

## 2026-07-12: Product-aware commercial catalogue and authoritative quotes

- Added `src/shared/commercialEntitlements.js` with explicit LodgingOS Starter/Standard/Pro, Hotel Core, Bar POS, and Restaurant Service/Control/Growth offers. Hotel Core is `hotel_core` with internal compatibility plan `Enterprise`; POS offers use compatibility plan `Pro` without inheriting LodgingOS usage caps.
- Added the server-owned commercial catalogue, immutable quote snapshot, short-lived quote token, product/package validation, atomic Command Central notification, and server-approved activation mapping in `20260712170000_commercial_catalog_quote_authority.sql`, with forward repairs in `20260712171000_commercial_catalog_quote_authority_repair.sql`, `20260712172000_commercial_quote_addon_eligibility_repair.sql`, and `20260712173000_commercial_catalog_hotel_addon_repair.sql`.
- Linked Supabase deployment is confirmed: `npm run db:push` completed and `npm run db:lint` reports zero errors. Live anonymous quote-calculation smoke checks returned Lodge Starter P8,999, Hotel Core P37,998 plus selected add-on setup/recurring lines, and Bar POS P4,500.
- Desktop Package Builder and subscription request domain now submit stable product/package selections to the authoritative authenticated quote RPC. New commercial activation skips client-side licence/feature writes and is applied by the server transaction; legacy requests retain compatibility behaviour.
- POS Settings and upgrade requests now select and persist `commercial_package_key`, so Bar POS, Restaurant Service, Restaurant Control, and Restaurant Growth no longer collapse to the shared internal `Pro` plan. `src/shared/commercialAccess.js`, the access snapshot, POS IPC handlers, and restaurant route walls enforce the package feature boundary; the 20260712174000 migration resets catalog-known non-included features before granting the selected package.
- Live quote smoke checks now return all four POS keys and prices: Bar POS P4,500, Restaurant Service P8,999, Restaurant Control P12,999, and Restaurant Growth P18,999. Live catalog checks confirm Service excludes inventory/recipes, Control excludes loyalty, Growth includes loyalty, and Bar POS excludes tables/recipes. HotelOS/POS shared upgrade surfaces no longer render LodgingOS capacity-limit copy.
- Hotel marketing quotation now submits the product-aware public RPC. The protected Netlify quote endpoint retrieves by expiring token and returns a no-store PDF; the Packages page now presents the separate POS offers and correct Bar one-year licence wording.
- Verification passed: `npm run test:commercial` (including package-key persistence and Service/Control/Growth/Bar regressions), `npm run test:marketing-site`, `npm run test:products`, `npm run test:restaurant`, `npm test`, `npm run build`, all three product workspace builds, `npm run db:push`, and `npm run db:lint`. Public Netlify publication and a real Command Central activation against a live customer licence remain unproved.

## 2026-07-12: Product-scoped commercial packages

- LodgingOS customer-facing packages are Starter, Standard, and Pro. The old Enterprise package is no longer exposed in LodgingOS package selection, subscription upgrade UI, or LodgingOS marketing structured data.
- Tsa Bonno HotelOS is quoted as a separate product. HotelOS quotation flows may still submit the internal `Enterprise` plan key so existing licenses, entitlement maps, activation RPCs, and historical requests remain compatible.
- Hotel optional services remain explicitly quoted/activated and are no longer presented as a generic Enterprise package or as Lodge upsells.
- The legacy `/enterprise` marketing URL remains available as a compatibility URL, but its content is now the Tsa Bonno HotelOS quotation flow.

## 2026-07-12: Product-family usability and marketing integration

- Settings no longer offers a free property-type switcher. Product identity (LodgingOS / HotelOS / Restaurant & Bar POS, plus bar vs restaurant mode) is chosen at setup and shown as a locked label in Settings. After `setup_complete`, `saveSettings` keeps the existing `property_type` via `resolveLockedPropertyType` so a client cannot reclassify lodge ↔ hotel ↔ restaurant in-app. Setup still sets the type within each product’s allowed list.
- LodgingOS desktop nav is product-scoped: when compatibility `productId` is `lodge-camp`, hotel-only modules and locked HotelOS-group upsells are hidden (including motel, which is hotel-class by property type but ships on LodgingOS). The LodgingOS shell no longer switches `bizType` to `hotel` for motel, and its dashboard no longer embeds the hotel enterprise board. Property-type-only nav calls (no product id) keep legacy hotel inheritance for catalog tests; HotelOS continues to use `HotelLayout` / `hotelNav` for live night audit and front-desk rails.
- LodgingOS keeps the existing accommodation shell and core routes. A new **Food & Beverage** entry opens a LodgingOS-only control hub that reuses the restaurant-grade kitchen/bar, menu/modifier, recipe costing, prep batch, stock/purchasing, team, cash-close, settlement, checklist, and exception components without making LodgingOS present as Restaurant & Bar POS. The product route allowlist blocks this hub in HotelOS and Restaurant & Bar POS builds.
- Restaurant & Bar POS now keeps the service-critical actions in its persistent bottom dock: Service/Sell, Floor where applicable, Kitchen where applicable, Stock, Products for bar-only mode, and Cash & close. Lower-frequency tools are grouped under Operate, Review & close, and Business setup instead of appearing as one flat option wall.
- Hotel remains a separately compiled product with its independent copper operations shell, front-desk movement board, hotel navigation/search, guided check-in/out, folios, nightly rates, corporate settlement, housekeeping, and night-audit paths. Hotel v1.5.5 is packaged and publicly published; clean-machine operator smoke and external provider connectivity remain unproved.
- Marketing now presents Tsa Bonno HospitalityOS as a three-application product family. Dedicated `lodge-app.html`, `hotel.html`, `restaurant-pos.html`, and `bar-pos.html` landing pages expose product-specific trial registration and dedicated release-feed/download links. Trial forms use LodgingOS, HotelOS, or Restaurant/Bar language based on the selected product. The pages are published at the compatibility URL `https://borokobookings.netlify.app`.
- Verification passed: `npm test`, `npm run test:products`, all 22 `npm run test:restaurant` suites, focused Hotel rate/night-audit/corporate and UUID workflow suites, `npm run test:marketing-site`, and serial builds for `@boroko/lodge-camp`, `@boroko/hotel`, and `@boroko/hospitality-pos`.

## Released baseline

- Desktop package manifest version: `1.5.5`. Lodge/Camp, Hotel, and Restaurant & Bar POS installers and update metadata are published in their separate public release repositories.
- Legacy POS package version: `1.1.0`.
- Manager PWA and public booking site are independently built and deployed web surfaces.
- The desktop app uses `database.js` as a compatibility facade; business logic is split across `src/main/domains/`.
- Legacy POS is a separate Electron 22/Windows POSReady 7-compatible deliverable with its own updater, release scripts, cache, queue, mesh behavior, and database probe.

## Implemented architecture and safeguards

The repository currently contains:

- RPC-first booking payment handling and database-derived payment status.
- A customer-credit ledger for advance payments that do not reserve rooms, with receipt, allocation, refund, reversal, audit, and liability reporting.
- Atomic booking rescheduling with room/date conflict checks, exclusive-event protection, authoritative repricing, reason capture, and overpayment transfer to customer credit.
- A desktop **Front Desk -> Prepayments** workspace for receiving advance payments, viewing balances and history, applying credit to bookings, refunding/reversing entries, and printing advance-payment receipts.
- Read-only Manager PWA visibility for outstanding customer-credit liability.
- Human-readable advance-payment receipt numbers (`PRE-YYYY-NNNN`) and dedicated A4 PDF rendering.
- Stable offline operation IDs and idempotency protection for critical financial and inventory work.
- `financial_operation_idempotency` and `financial_audit_log` infrastructure.
- Atomic POS v3 order/return flows, inventory depletion/restoration, outlet enforcement, shift and cash-up contracts.
- Booking-linked POS charge support where the order has authoritative booking/folio linkage.
- Atomic room-maintenance reconciliation.
- Event/full-lodge quotation support.
- Manager PWA POS reporting, support inbox/read receipts, operational caching, and guarded operational mutations.
- Main desktop and Legacy POS mesh/offline synchronization support.
- Main desktop long-outage hardening: queued desktop operations now have an append-only local operation journal, manager-acknowledged lodge offline mode, offline operations bundle export, mesh repair visibility, and mesh allowlist/schema coverage for every desktop offline RPC operation while preserving Supabase RPC replay as final authority.
- Main desktop normal operations now have broader offline queue coverage in the repository: booking charges, customer-credit allocation/refund/reversal, rate overrides, expenses, maintenance updates/resolution, inventory purchases/item edits/deletes/stocktakes, event line items, supply purchases/item edits/deletes, room-supply allocations/moves, and supply/room-supply stocktakes. Local values remain pending estimates until replay succeeds.
- Main desktop sync queue storage is file-backed JSON/JSONL under the app cache/user-data path (`sync-queue.json`, failed queue JSON, and `offline-operation-log.jsonl`), not a SQLite queue. The queue processor uses a promise-level processing guard and dependency-aware replay ordering.
- Manager PWA offline state is device-local `localStorage`, scoped per lodge, with blocked high-risk mutation types and a three-attempt unresolved/dead-letter threshold. It is not IndexedDB and is not a global financial authority.
- Legacy POS mesh uses signed local HTTP requests with HMAC-SHA256, timestamps, nonces, lodge identity checks, and a bounded mesh port range. It is authenticated local transport, not anonymous raw LAN message acceptance.
- Booking refund preparation now supports offline pending-approval requests with proof references, retained-fee calculations, local cache visibility, and operation-journal audit. The actual refund/customer-credit settlement still requires online manager PIN verification and the authoritative `approve_booking_refund` RPC.
- Accommodation multi-room booking is implemented as one lead guest stay group with multiple normal room booking records plus a first-class group invoice wrapper (`booking_invoice_groups` / lines). Direct bookings and room quotations can both produce this grouped accommodation invoice. It uses `[STAY_GROUP]` metadata, not Events & Venues event grouping, so each room line keeps normal room availability, status, payment, refund, profitability, and offline replay behavior while the guest/company sees one invoice. Group invoice payments and approved refunds are entered once by the operator and allocated across the child room booking ledgers.
- Public booking-site accommodation requests can now use lodge-specific public offer settings. Lodges can advertise room stays, multi-room stays, full-lodge stays, day-use options, and event/venue options on their slug. The public booking RPC supports single-room, multi-room, and full-lodge accommodation requests; multi-room requests create the same group invoice wrapper as desktop direct bookings, while full-lodge requests create one exclusive booking to preserve exclusive-event conflict rules. Day-use and event/venue offers are exposed as public information/contact paths until their pricing, payment, and approval rules are opened through dedicated public RPCs.
- Command Central audit, fleet-health, notification, entitlement, and release-control capabilities.

The customer-credit and booking-reschedule migrations were confirmed applied to the linked Supabase project on 2026-06-20. Repository implementation and database deployment do not by themselves prove that every client surface has been published or operator-smoke-tested.

## Current workspace and recent verification

### 2026-07-11: Campsite authoritative pricing contract

The LodgingOS campsite pricing migration `20260711200000_campsite_booking_pricing_contract.sql` is present locally and appears in the linked migration history after `20260711191000`. `npm run db:push` completed with `Remote database is up to date`, and `npm run db:lint` completed with a zero-error result.

- `accommodation_booking_expected_total` is the server pricing contract for campsite site/person/tent/vehicle/composite modes, capacity checks, required-rate checks, and rounded totals.
- `create_campsite_booking` preserves the established room `create_booking` contract while carrying campsite occupancy through transaction-local pricing context, storing `booking_accommodation_details`, and rejecting idempotency-key reuse with changed occupancy.
- Desktop booking and offline/mesh replay now submit `p_tents` and `p_vehicles` through `create_campsite_booking`; normal room bookings keep the existing `create_booking` path.
- The booking-site card and shared estimate now display the configured rate mode and do not invent a tent or vehicle count when the guest has entered zero.
- Focused campsite, booking-site, offline queue/POS, release, blocker, and database-lint checks pass locally. Isolated live campsite RPC smoke, deployed booking-site parity, and packaged operator smoke remain unproved.
- Playwright web-server paths were corrected to resolve from `Playwright tests/`. Both E2E projects start their servers, but the pinned Chromium binary is not installed in this environment, so browser assertions remain unproved.

### 2026-07-11: Product-scoped multi-company desktop sign-in

- One Supabase Auth email can now have staff profiles at multiple companies. The desktop sign-in first lists only companies compatible with the launched product, then requires an explicit company choice when more than one is available.
- HotelOS only lists hotel/resort companies; LodgingOS lists lodge/camp/guest-house/motel companies; Restaurant & Bar POS lists restaurant companies. A selected company is then authenticated through the existing lodge-scoped app-session contract.
- Linked Supabase migration `20260711201000_product_membership_login.sql` was applied. It adds `list_desktop_product_memberships(text)`; database lint reported no errors after deployment.
- Staff/admin creation now permits the same email at different companies while still rejecting duplicate staff email records inside the same company.

### 2026-07-11: Hotel rates + night audit + corporate settlement

Linked migrations **applied**:
- `20260711190000_hotel_rates_night_audit_corporate.sql`
- `20260711191000_hotel_rate_night_audit_overload_repair.sql` (clears ambiguous 4-arg/5-arg `room_booking_expected_total` and dual `run_night_audit_checks` signatures that broke create/reschedule booking lint)

- `room_booking_expected_total` prices **night-by-night** using room overrides, then rate plans (corporate/room-type/general + days_of_week + stay limits), then room base rate. Single 5-arg function with corporate default + `quote_room_stay` RPC.
- Desktop `createBooking` prefers server `quote_room_stay` so booking totals match rate plans.
- Night audit checks expanded (pending departures, possible no-shows, open hotel folio balances, dirty rooms, pending moves); **one closed audit per business date**; critical blockers unless forced; overdue arrivals marked `no_show` on close. Single `run_night_audit_checks(lodge, business_date default)`.
- Desktop **Night Audit (Enterprise)** route (`/night-audit-enterprise`) is a live operational UI: run checks, force-close, history/reopen, exception resolve — not a redirect to the report-style `/audit`.
- Corporate charge settlement: invoice created, booking linked to corporate account, guest bill settlement via `payments` method `corporate` + open hotel folio payment mirror. UI requires booking id; amount blank/0 settles remaining balance.
- `supabase db lint --level error` on linked project: **0 errors** after overload repair.
- Tests: `tests/hotel-rates-night-audit-corporate.test.mjs`.

### 2026-07-11: Hotel Enterprise UUID rebuild (core modules)

Linked migration applied: `20260711180000_hotel_enterprise_uuid_complete.sql`.

- **Hotel folio ledger** rebuilt on **uuid** `lodge_id` / `folio_id` (old bigint ledger dropped; table was empty). Full RPCs: create, list, lines, charge, payment, transfer, split, void, close, reopen, lock, balance, auto guest-folio on check-in.
- **Check-in / check-out workflow** rebuilt on uuid with config, checklist init/complete/reset, and final `complete_hotel_checkin` / `complete_hotel_checkout` (room status + folio close).
- **Rate applicability** RPC `get_applicable_room_rate` (override → rate plan → room base).
- **Channel dashboard** uuid-safe operational summary (`manual_review` mode).
- Desktop: `checkinWorkflow` complete hotel check-in/out IPC, hotel dashboard route live (no longer redirects home), Layout treats motel/hotel/resort as `hotel` nav biz type, hotel inherits lodge nav + Front Desk/Folios/Check-in entries.
- Tests: `tests/hotel-enterprise-uuid-complete.test.mjs`.

Still require operator smoke before “100% sellable Hotel” claims: live night-audit close on a real lodge day, corporate charge against a live booking with open folio, channel import conversion, multi-property group switching with real second lodge, payment gateway, OTA sync providers.

### 2026-07-11: Database lint gate cleared on linked project

Linked Supabase `supabase db lint --level error --fail-on error -s public` now reports **0 errors** (was 104 functions / 107-class failures).

Applied repair migrations:

- `20260711160000_database_lint_gate_repair.sql`
- `20260711161000_database_lint_gate_repair_pass2.sql`
- `20260711162000_database_lint_gate_repair_pass3.sql`

What was fixed:

- compatibility columns (`bookings.corporate_account_id/room_type_id/customer_name/channel/group_block_id`, `booking_charges.unit_price/total_amount`, invoice/status totals, marketing/channel `updated_at`, payment provider `settings`, etc.)
- missing relation shims (`subscription_requests`, `stock_movements`, `booking_room_moves`, `housekeeping_log`, `user_lodges`, `restaurant_tables`, views for `pos_outlets`/`menu_items`/`maintenance`)
- bigint `app_require_lodge_role` overloads for incomplete enterprise modules that still use bigint lodge IDs (fail closed at runtime for real uuid lodges)
- extensions-qualified crypto helpers (`gen_random_bytes`, `crypt`, `hmac`, `digest`, `row_to_jsonb`)
- targeted function repairs/stubs for reports, POS v2 aliases, folio helpers, early/late checkout fees, debtor aging

Note: some enterprise hotel/booking-engine functions remain **fail-closed stubs or bigint-era shims** so lint passes and production uuid lodge paths stay safe. Full rewrite of those modules onto uuid lodge IDs is still future product work.

Run: `npm run db:lint` (uses linked DB credentials from `.env.db`).

### 2026-07-11: Campsite accommodation model + release-blocker migrations applied

Linked Supabase migrations applied successfully:

- `20260711120000_lodge_camp_release_blockers_repair.sql` (POS/guest-portal/PWA auth repair)
- `20260711140000_campsite_accommodation_model.sql` (campsite inventory model)

Campsite model now in repository and linked DB (Phase 1 complete product path):

- `rooms` gains `accommodation_kind` (`room`/`unit`/`tent`/`campsite`), capacity adults/children, max tents/vehicles, powered flag, site surface, shared facilities, and rate modes (`site`/`person`/`tent`/`vehicle`/`composite`) with per-person/tent/vehicle rates.
- `create_room` / `update_room` persist those fields with server validation.
- Public availability returns separate `rooms` and `campsites` arrays with campsite pricing via `compute_accommodation_stay_total`.
- Public offers include `campsites` (`public_offer_campsites`).
- Desktop Rooms UI labels inventory as Sites & Rooms for camp properties and exposes campsite controls.
- Booking site shows campsites separately from rooms/units.
- `camp` is a first-class property type again (no longer normalized away to `lodge`); operating profile includes `accommodation_mix` / `campsite_profile`.
- Shared helpers live in `src/shared/accommodation.js`.
- Contract tests: `tests/campsite-accommodation-model.test.mjs`.

Still open / not claimed done:

- Hosted online payments/deposits product work
- Deploying booking-site/PWA builds to production hosts
- Phase 2 multi-pitch capacity engine (true multi-booking per physical campsite area) — current model keeps one campsite row = one reservable unit for conflict safety
- Operator smoke of live campsite create/book/public search after desktop release

### 2026-07-12: Multi-company admin email uniqueness fix

- Hotel company setup with an email already used as restaurant admin failed on `users_admin_email_unique` (global unique index on admin emails).
- Linked migration applied: `20260712153000_drop_global_admin_email_unique.sql`. Same admin email may now exist at different companies; uniqueness remains per company via `users_email_lodge_unique` / `users_lodge_id_email_key`.
- Desktop `createUser` maps leftover constraint errors more clearly.

### 2026-07-12: Company setup settings RLS bootstrap

- New-company desktop setup was failing with `new row violates row-level security policy for table "settings"` because setup upserts settings through the anon client before any lodge session/user exists, while `settings` INSERT requires `app_lodge_access(lodge_id)`.
- Linked migration applied: `20260712120000_bootstrap_company_settings.sql` adds security-definer `bootstrap_company_settings(jsonb)` for first-time company rows only (refuses already-completed companies).
- Desktop `initializeCompanySetup` now calls `saveSettings(..., { allowBootstrap: true })`, which falls back to service-role or the bootstrap RPC when RLS blocks direct upsert. This unblocks multi-product setup with the same email (e.g. restaurant admin also creating a hotel company).

### 2026-07-12: Hotel in-app shell rebuilt as independent PMS UI

- Hotel product no longer re-skins Lodge `Layout.jsx`. It uses a dedicated shell under `src/renderer/src/components/hotel/`:
  - `HotelLayout.jsx` — charcoal/brass top command bar + icon rail + zone flyouts (different IA from lodge sidebar)
  - `HotelHome.jsx` — front-desk command board (arrivals / in-house / departures + room board)
  - `hotelTheme.css` — product-scoped tokens that re-skin shared operational pages without forking financial modules
  - `hotelNav.js` — hotel-only navigation map
- `App.jsx` routes hotel product to `HotelLayout` and home to `HotelHome`. Lodge still uses live `Layout` + `Dashboard`. HPOS still uses `HposLayout`.
- Onboarding (login/chooser/setup/loading) for hotel matches the charcoal/brass language. Lodge UI remains frozen green.

### 2026-07-12: Product shell contract + continuous isolation (frontend boundary)

- Expanded `src/shared/productIdentity.js` into a shell contract: brand names, business nouns, taglines, theme ids, route allowlists, and release repos — still one shared main/domains/Supabase backend.
- Cross-product login/session hardening: product assert now also runs on offline trusted-session unlock, session restore, and `validateCurrentSession` (not only online login). Wrong-product companies fail closed with `product_profile_mismatch`.
- Renderer `ProductShellGuard` enforces per-product route allowlists so restaurant.exe cannot open hotel enterprise modules and hotel.exe cannot open pure HPOS shell routes.
- **LodgingOS retains its established green operational chrome**, with chooser/loading/public identity renamed to Tsa Bonno LodgingOS. **Restaurant & Bar POS retains its own service shell**. **HotelOS** uses distinct indigo/slate onboarding and dedicated layout chrome so the three products remain visually separate.
- Marketing download script maps product pages to isolated GitHub release feeds; restaurant/hotel pages no longer silently resolve to the Lodge installer when their feed has no asset yet (early-access WhatsApp path).
- Focused tests: `tests/product-extraction.test.mjs` (+ release architecture). Operator smoke of packaged Hotel/HPOS installers still unproved.

### 2026-07-11: Product workspace and release-feed isolation

- The repository remains one shared code workspace and one Supabase backend for Tsa Bonno LodgingOS, Tsa Bonno HotelOS, and Tsa Bonno Restaurant & Bar POS.
- LodgingOS is the renamed existing installation: it retains compatibility Windows application ID `com.boroko.bookings`, user-data identity `boroko-bookings`, and established public updater feed `Rabafi/boroko-bookings-releases`. Its public installer/shortcut/uninstall labels use Tsa Bonno LodgingOS, and releases install in place for live customers.
- Hotel (`com.boroko.hotel`) and Restaurant & Bar POS (`com.boroko.hospitalitypos`) have independent public GitHub Releases feeds. This avoids `latest.yml` collisions that could otherwise offer one product's installer to another product.
- The Hotel and Restaurant & Bar POS feeds are configured and their GitHub repositories exist, but no new standalone product installer has been published or operator-smoke-tested yet.

The worktree on 2026-07-03 was not pristine before this documentation update. Preserve unrelated changes:

- modified `src/main/domains/settings.js`;
- modified `src/renderer/src/components/Settings.jsx`;
- modified `booking-site/src/pages/LodgePage.jsx`;
- modified `booking-site/src/pages/BookingPage.jsx`;
- modified `booking-site/src/pages/SuccessPage.jsx`;
- modified `tests/customer-credit-reschedule-regression.test.mjs`;
- untracked `supabase/migrations/20260703153000_public_booking_offers.sql`.

Older in-progress areas that were previously called out have since been partly or fully absorbed into repository code. Do not assume they are published or deployed just because they are present locally:

- completed customer-credit and booking-reschedule implementation awaiting intentional commit/release publication;
- detailed report export RPCs and desktop report export work;
- guest lifetime intelligence and Manager PWA guest/reporting work;
- Manager PWA navigation, inbox, notification, freshness, and UX changes;
- Legacy POS shift/outlet/cash-up enforcement and mesh/runtime changes;
- related focused regression tests;
- Events & Venues planning material;
- missing RLS policies on `room_rate_overrides` table fixed via `20260621180000_add_room_rate_overrides_rls_policies.sql` migration (applied);
- `room_booking_expected_total` function updated to consult rate overrides via `20260621190000_add_rate_overrides_to_expected_total.sql` migration (applied) — previously the `create_booking` RPC rejected override-based totals;
- `Rooms.jsx`: error display added inside rate override form (was hidden inside room CRUD modal);
- `Rooms.jsx`: success message after saving rate override (was missing entirely).
- 2026-06-25: Guests gained customer-credit balance visibility plus shortcuts into Prepayments; cancelled booking refunds can now be transferred to customer credit through `20260625120000_booking_refund_to_customer_credit.sql` (applied to the linked Supabase project and live function definition verified).
- 2026-06-26: Events & Venues venue-only creation was repaired via `20260626120000_harden_event_booking_parent_id.sql` and `20260626123000_fix_event_booking_id_after_idempotency_miss.sql` (applied to the linked Supabase project and rollback-only live smoke verified). Root cause: the `create_event_booking` idempotency miss path cleared `v_event_id` before inserting `conference_bookings`.
- 2026-07-03: Main desktop offline/mesh hardening implemented in the repository. This adds a local operation journal, System Health offline-mode controls, daily offline operations bundle export, mesh repair diagnostics, and mesh allowlist/schema coverage for all desktop queued RPCs, including reschedules, customer credit, booking charges, rate overrides, expenses, maintenance, inventory stocktakes/purchases, event line items, and room-supply workflows. This does not make the local mesh a final database authority; cloud replay and server-side RPC validation remain required before values are final.
- 2026-07-03: Accommodation room quotations gained `accommodation_lines` storage so one quote can cover several rooms and convert into the same grouped accommodation invoice model used by direct multi-room bookings. The linked Supabase migration `20260703143000_quotation_accommodation_lines.sql` was applied.
- 2026-07-03: Public online booking gained lodge-configured public offer settings and live migration `20260703153000_public_booking_offers.sql` was applied. The booking site now reads `get_public_booking_offers`, lets guests select multiple available rooms, can request full-lodge exclusive use when enabled, and submits supported accommodation requests through the hardened `create_online_booking` RPC.
- 2026-07-03: External Kimi/agent offline-sync reports were verified against the current repository. The severe claims in `agent 1.txt` through `Agent 7.txt` were mostly false for this checkout: the code does not use SQLite sync queues, does have server-side idempotency infrastructure for key financial/offline paths, does not have the claimed direct booking-payment fallback that writes `bookings.amount_paid`, and the Legacy POS mesh is signed/authenticated. The corrected report was closer, but overstated readiness; live database deployment and packaged-operator smoke tests still need separate proof.
- 2026-07-08: Restaurant-mode Supabase migrations through `20260708190000_restaurant_phase3_role_hardening.sql` were applied to the linked Supabase project via `npm run db:push`, and a follow-up push reported `Remote database is up to date`. Live schema smoke confirmed the restaurant Phase 2-5 migration records, 20 expected restaurant tables with RLS enabled, parent-join RLS on purchase-order/checklist child tables, role guards on the checked restaurant RPC set, and `generate_owner_digest` using `inventory_items` rather than the old `inventory` name. This does not prove packaged desktop, Manager PWA, or operator workflow smoke.
- 2026-07-10: Restaurant Phase 6 differentiators, POS visual-cue migrations, and `20260710160000_pos_even_split_atomic.sql` were applied to the linked Supabase project via `npm run db:push`; a later push must still be used to prove no newer local migrations are pending. Even bill splits now run through a single server transaction with row locking, lodge/outlet role enforcement, server audit, and an idempotency record. Kitchen-ticket reads and status updates use the authoritative `pos_prep_tickets`/RPC path when online, while the local cache remains an offline fallback. This is repository and linked-database proof, not proof that a packaged desktop, deployed Manager PWA, printers, or a real restaurant service shift has been operator-smoke-tested.

## Enterprise Foundation (codex/tsa-bonno-enterprise-foundation branch)

The Enterprise foundation implementation has been started on the `codex/tsa-bonno-enterprise-foundation` branch. This branch builds the product foundation for the Enterprise Hotel tier and property-aware module visibility without breaking current Starter, Standard, or Pro behavior.

### Implemented so far

1. **Enterprise subscription plan**: Added `Enterprise` to `SUBSCRIPTION_PLAN_ORDER` and `PLAN_ALIASES`. Enterprise is the top tier for hotel-grade PMS operations.

2. **Pro plan capped**: Pro is no longer unlimited. New limits: 500 bookings/month, 10 grace, 30 rooms, 10 users.

3. **Enterprise usage limits**: 2,000 bookings/month, 50 grace, 100 rooms, 25 users.

4. **Property type constants** (`src/shared/propertyTypes.js`): Defines `guest_house`, `bnb`, `lodge`, `camp`, `motel`, `hotel`, `resort`, `restaurant` with labels, defaults, and helper functions (`normalizePropertyType`, `isHotelPropertyType`, `isResortPropertyType`, `isRestaurantOnly`).

5. **Module catalog and visibility resolver** (`src/shared/moduleCatalog.js`): 34-module catalog with categories, plan requirements, property type restrictions, and add-on keys. `resolveModuleVisibility` returns `visible`, `locked`, or `hidden` based on property type, plan, and add-on state.

6. **Navigation updated** (`src/renderer/src/navigation/desktopNav.js`): Added Hotel group nav items (Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts, Rate Plans, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Enterprise Reports, Guest CRM, Operations Compliance, and Multi-Outlet POS). Navigation filtering now uses module visibility resolver with property type, plan, and add-on state.

7. **Subscription panel updated** (`src/renderer/src/components/SubscriptionAccessPanel.jsx`): Shows Enterprise plan with capacity pack messaging, handles Enterprise recommendation, and styles Enterprise plan card with indigo theme.

8. **Entitlement feature map updated** (`src/main/domains/subscriptionState.js`): Added Enterprise-level features (`hotel_mode`, `room_types`, `physical_inventory`, `floors_sections`, `front_desk_dashboard`, `folios`, `advanced_housekeeping`, `hotel_kpis`, `corporate_accounts`, `rate_plans`, `custom_website`, `payment_gateway`, `channel_manager`, `multi_property`).

9. **Tests added** (`tests/enterprise-foundation.test.mjs`): 43 tests covering plan limits, property type normalization, module catalog, visibility resolver, and add-on gating. All pass.

10. **Existing tests updated** (`tests/subscription-usage-limits.test.mjs`): Updated to reflect capped Pro limits, Enterprise as the best-fit plan, and the `enterprise` usage state key.

11. **Hotel module routes implemented in repository**: Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts placeholder, and Rate Plans placeholder now have routed Enterprise-gated screens. Corporate Accounts and Rate Plans remain controlled add-on placeholders, not full production modules.

12. **Room Types foundation**: `room_types` domain, cache registration, renderer CRUD, room dropdown linkage, and Supabase migration files are present. Rooms keep the legacy `room_type` text fallback while Enterprise rooms can link to `room_type_id`.

13. **Floors & Sections foundation**: `floor_sections` domain, renderer CRUD, room linkage, cache registration, and migration files are present. Rooms can optionally link to `floor_section_id`.

14. **Hotel Dashboard and Hotel KPIs**: Front-desk dashboard, arrivals, departures, in-house guests, no-show attention list, occupancy, ADR, RevPAR, and daily hotel KPI estimates are implemented. Revenue figures in hotel KPI/dashboard views are labelled as estimates; database/RPC financial records remain authoritative.

15. **Folio foundation**: The Hotel Folios screen is booking-charge-backed and posts charges through the existing audited booking-charge RPC path. It is not a separate final folio ledger yet, and it must not be treated as a replacement for authoritative payment/refund/settlement flows.

16. **Advanced Housekeeping**: Enterprise-gated advanced housekeeping board is implemented using the existing `rooms.updateHousekeeping` IPC/RPC path. It adds supervisor-style turnaround visibility without creating a second room-readiness mutation path.

17. **Enterprise add-on catalog**: Shared `enterpriseAddons` catalog distinguishes requestable add-ons from planned add-ons. Settings/Subscription shows relevant Enterprise add-ons for the selected property type and makes clear that add-ons require explicit activation.

18. **Audited Room Moves foundation**: Room Moves is now a distinct Enterprise feature/capability (`room_moves`) rather than a front-desk-dashboard side effect. The desktop domain uses the dedicated `move_booking_room` RPC with a stable idempotency key for online and offline replay. The new `20260703230000_room_moves_foundation.sql` migration creates `room_move_log`, enforces lodge role checks, locks affected booking/room rows, rejects conflicting idempotency-key reuse, checks target-room date conflicts, marks the previous occupied room dirty, marks the target room occupied, and writes the audit row server-side.

19. **Operational add-on read contract repaired**: Phase 10 operational module reads now call concrete RPCs (`get_lost_found_items`, `get_incident_logs`, `get_visitor_registrations`, `get_linen_items`, `get_linen_laundry_batches`) instead of a non-existent generic `rpc` function. `20260703220000_phase10_operational_modules.sql` defines those read RPCs and repairs the emergency-list view to use current bookings/customers/rooms fields.

20. **In-app upgrade request path wired to Command Central tickets**: The Subscription Package Builder now has a real preload/main-process submission bridge. Until a dedicated commercial-request table/workflow is built, submitted package requests create `Upgrade Request` support tickets in Command Central with selected plan, add-ons, capacity details, contact details, and pricing-note context. This is a working intake path, not the final quote-to-invoice/pro-forma workflow.

21. **Dedicated subscription request data model**: The support-ticket bridge has been replaced with a dedicated `subscription_package_requests` table and Supabase RPCs for in-app/public submission, admin listing/detail, status updates, quote/pro-forma document recording, and activation. Domain file `subscriptionRequests.js`, IPC handlers, and preload bridge are wired. Command Central has a Subscription Requests inbox with status flow controls.

22. **Marketing website Enterprise package builder**: The marketing site (`marketing-site/`) now has an Enterprise page (`/enterprise`) where prospects can select Enterprise add-ons, fill in property details, and submit a quote request directly via the public `submit_public_subscription_request` RPC. The packages page now includes Enterprise as a fourth tier.

23. **Commercial request hardening**: `20260704001000_subscription_requests_activation_hardening.sql` removes the broad public/authenticated request policies, keeps public website leads hidden from lodge users, grants admin request RPCs through `service_role`, validates request payloads, stores quote/pro-forma document payloads on the request, and makes activation require a selected license/lodge pair that actually matches `licenses.lodge_id`. Desktop activation updates the selected license plan and upserts selected add-on feature entitlements before marking the request activated. Command Central can save recorded quote/pro-forma payloads as A4 PDFs.

24. **Automated package quotation flow**: Starter, Standard, Pro, and Enterprise now use published annual package prices in the shared commercial package catalog (`P8,999`, `P12,999`, `P18,999`, `P37,998`). Advertised Enterprise add-ons now also have published Pula annual/setup pricing. The in-app Subscription Package Builder now generates and submits the same quotation request, includes one-time 30-day trial eligibility in the pricing snapshot, and downloads the quote document for the client. The marketing website package buttons route into the quote builder for Starter/Standard/Pro/Enterprise, capture whether the property has already used the one-month trial, download a client quotation after successful submission, and submit the same pricing/trial snapshot to the public subscription request RPC. Public request RPC hardening in `20260704100000_subscription_request_auto_quote_pricing.sql` stores automatic quote payloads with status `quoted` and creates a Command Central notification.

25. **Enterprise add-on sales catalog tightened**: Public/in-app advertised Enterprise add-ons now focus on commercially meaningful modules: Custom Direct Booking Website, Online Payment Gateway, Rate Plans, Channel Manager, Corporate Accounts, Advanced Housekeeping Mobile, Guest Portal, Multi-Property Dashboard, Advanced Rate Engine, and Multi-Outlet POS Pro. Smaller operational utilities such as emergency list, visitor register, incident log, lost and found, and linen/laundry remain internal/planned module work rather than advertised quote add-ons.

26. **Enterprise operations contract layer**: `20260704110000_enterprise_operations_contracts.sql` adds lodge-scoped, RLS-enabled operational tables and RPCs for Enterprise workflow readiness records/events, payment-link requests, channel sync queue items, guest messages, guest-portal requests, revenue recommendations, guest CRM notes, Enterprise documents, and report snapshots. Desktop domain/preload/IPC wiring exposes this through `enterpriseOperations`, and the Enterprise workflow workspaces now save setup readiness to that contract with a local draft fallback. Payment links start as `requested` records only; this does not mark bookings paid. Channel sync items require idempotency keys and stay queued/manual-review until a real provider integration is configured.

### What is NOT yet proven or complete in this branch

- Live Supabase deployment of the Enterprise migration set through `20260704001000_subscription_requests_activation_hardening.sql` was completed on 2026-07-04 via `npm run db:push`; a follow-up `npm run db:push` reported `Remote database is up to date`.
- Live Supabase deployment state was refreshed on 2026-07-06 after the July 5 Enterprise migration set was added. The supported wrapper `npm run db:push` connected through the configured Supabase pooler and reported `Remote database is up to date`, so the repository migration history through `20260705205000_multi_property_shared_profiles.sql` was confirmed applied to the linked project. The follow-up channel-sync safety migration `20260706100000_channel_sync_manual_review_until_provider.sql` was also applied on 2026-07-06 and a second `npm run db:push` reported `Remote database is up to date`. This does not prove provider integrations, packaged desktop smoke tests, or deployed web clients.
- Corporate Accounts, Rate Plans, group blocks, rooming lists, master folios, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Advanced Reporting, Guest CRM, Operations Compliance, and Multi-Outlet POS now have routed Enterprise screens or contract-backed setup/control-plane foundations in the repository. Some remain operational foundations rather than full external integrations: there is still no live OTA/channel provider, no public card-payment settlement, and no released custom website deployment automation.
- The dedicated subscription request table, Command Central inbox, marketing website package builder, automatic website quote download, quote/pro-forma request records, desktop PDF export, and one-click Command Central activation from a selected request are now implemented in the repository. Public website requests can store an auto-generated quote payload and reference immediately, but payment remains manual and activation remains Command Central-controlled. There is no public self-service card payment gateway in this scope.
- The Folios implementation is a safe foundation over existing booking charges, not a final independent hotel folio ledger with split billing, master folio, night audit close, and company allocation.
- Early check-in and late checkout currently rely on existing booking status/date rules and reschedule paths; a dedicated hotel policy/pricing workflow has not been implemented.
- Brand rename and release publication are not done.

Focused verification run on 2026-07-03:

- `npm test` passed.
- `npm run test:offline-queue-critical` passed.
- `npm run test:offline-pos-critical` passed.
- `npm run test:financial-integrity` passed.
- `npm run test:inventory-offline-sync` passed.
- `npm run legacy-pos:test` passed with 216 checks.
- `npm run db:push` applied `20260703153000_public_booking_offers.sql`.
- `npm run test:customer-credit-reschedule` passed.
- `npm --prefix booking-site run test:run` passed.
- `npm --prefix booking-site run build` passed.
- `npm run build` passed.
- `node .\tests\enterprise-foundation.test.mjs` passed with 172 tests after the Room Moves, operational read RPC, subscription-request guardrails, commercial document workflow, PDF export, and activation hardening were added.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after live Enterprise migration deployment:

- `npm run db:push` applied the remaining Enterprise migrations and a second run reported `Remote database is up to date`.
- `node .\tests\enterprise-foundation.test.mjs` passed with 173 tests after live-schema migration fixes for `settings(lodge_id)`, migration timestamp uniqueness, and the emergency-list view.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after automated quotation and Enterprise operations contract work:

- `node .\tests\enterprise-foundation.test.mjs` passed with 178 tests.
- `npm run build` passed for main, preload, and renderer.

Before continuing any of these areas, inspect `git status`, the relevant diff, and the latest migration files. Preserve unrelated edits.

## Superseded old priorities

The former top-level priorities—deposit linkage, basic booking replay, first-generation idempotency, initial POS-to-booking linkage, and adding a financial audit table—are no longer accurate as unimplemented project-wide tasks.

They remain regression-sensitive contracts. New work must verify and preserve them rather than reimplement them from an old plan.

## Known caveats

- Customer-credit/reschedule repair migrations through `20260621170000` are applied to the linked project, including receipt numbering, safe transfer keys, local-date check-in, and event parent-ID protection.
- The customer-credit/reschedule feature is release-candidate quality, not yet production-certified: packaged-installer smoke tests, disconnected replay testing, database concurrency/isolation smoke tests, Supabase lint/advisors, artifact signing, and final publication remain.
- Desktop 1.5.5 is the active local package manifest version. A successful local build does not mean it has been published.
- Historical POS orders with `outlet_id = NULL` may appear as `Unassigned`; do not invent outlet attribution without evidence.
- Some regression suites are structural contract tests. Passing them does not replace database smoke tests for high-risk SQL.
- Long-outage desktop operation remains "pending local truth" until Supabase replay succeeds. Managers should save offline operations bundles during multi-day outages and must review failed/dead-lettered operations when internet returns.
- Intentionally online-only areas remain: first-time login/session bootstrap, Command Central/admin service-role work, imports/undo imports, server-authoritative exports/reports/financial validation, license activation, fleet health, formal booking refund approval/final settlement with live manager PIN verification, and POS catalog publishing/setup changes needed by Legacy POS snapshots. Booking refund requests can be prepared offline, but they do not move money or customer credit until that online approval succeeds.
- The working tree can contain multiple concurrent initiatives. Do not stage, revert, format, or rewrite unrelated files.
- A PWA empty result may indicate session/readiness or schema-contract failure rather than genuinely absent data.
- `room_rate_overrides` previously had RLS enabled but no policies; the `20260621180000` migration added the policies and was recorded as applied. Re-verify the linked schema if this table appears empty in a deployed client.

## Where to look

- Durable engineering rules: [AGENTS.md](AGENTS.md)
- Architecture and execution paths: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Release checks: [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md)
- Database migrations: `supabase/migrations/`
- Desktop business domains: `src/main/domains/`
- Manager PWA API contract: `manager-pwa/src/lib/api.js`
- Legacy POS main process and queue: `legacy-pos/src/main/`
- Focused regression suites: `tests/` and `legacy-pos/tests/`

## 2026-07-04: Enterprise hotel features added

- **Night Audit Transactional Close**: `night_audit_close` and `night_audit_exceptions` tables with RPCs for running checks, closing, reopening, summary, history, and exception resolution. Domain in `src/main/domains/nightAudit.js`. IPC handlers and preload bridges wired.
- **Check-in / Check-out Workflow**: `checkin_config`, `checkin_checklist_items`, `checkout_checklist_items` tables with RPCs for checklist retrieval, step completion, reset, and config management. Domain in `src/main/domains/checkinWorkflow.js`. React component at `CheckinWorkflow.jsx`.
- **Early Check-in / Late Checkout Policy Engine**: Policy and request tables for early check-in and late checkout with fee calculation, approval workflow, and CRUD RPCs. Domain in `src/main/domains/earlyLateCheckout.js`. React component at `EarlyLateCheckout.jsx`.
- **Cancellation / No-Show Policy Engine**: `cancellation_policies` and `cancellation_requests` tables with fee calculation, deposit handling, customer credit, and approval workflow. Domain in `src/main/domains/cancellationPolicies.js`. React component at `CancellationPolicies.jsx`.
- **Revenue Manager UI**: React component at `RevenueManager.jsx` with forecast, competitor notes, demand events, and recommendations panels.
- **NightAudit component** verified complete at `NightAudit.jsx` (595 lines).
- All four SQL migrations: `20260705100000_night_audit_close.sql`, `20260705120000_checkin_checkout_workflow.sql`, `20260705140000_early_late_checkout_policies.sql`, `20260705160000_cancellation_policies.sql`.
- Shared layer: capabilities added to `accessControl.js`, modules added to `moduleCatalog.js`, DEV_ENTERPRISE_PREVIEW_CAPABILITIES updated, `database.js` exports extended.
- Test suites: `tests/enterprise-night-audit.test.mjs` (11 tests), `tests/enterprise-checkin-cancellation.test.mjs` (16 tests) — all 27 passing.

## 2026-07-06: Enterprise maturity verification and fixes

- The Enterprise worktree remains a large uncommitted implementation branch. Preserve unrelated changes and compare each surface against the current manifest before claiming readiness.
- The `/booking-engine` desktop route now renders a dedicated `BookingEngine.jsx` workspace instead of pointing at the generic `EnterpriseWorkflowWorkspace` with an undefined `advanced_booking_engine` workflow key. The workspace manages booking-engine rules and upsells through the existing preload/domain/RPC contract and includes price, availability, and upsell preview only; it does not create booking intents implicitly.
- `PaymentGatewayConfig.jsx` no longer records a fake completed webhook payment from a manual "test webhook" action. The admin screen now exposes a signature verification check through `payments.verifyWebhookSignature`, and the UI states that the check does not create a payment or settle a booking.
- Regression coverage was extended in `tests/enterprise-booking-engine.test.mjs` and `tests/enterprise-payment-webhook-security.test.mjs` for the dedicated Booking Engine route and payment webhook UI safety.
- Verification passed on 2026-07-06: `node .\tests\enterprise-booking-engine.test.mjs` (26 tests), `node .\tests\enterprise-payment-webhook-security.test.mjs` (16 tests), `node .\tests\enterprise-routing-regression.test.mjs` (45 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise navigation/catalog maturity was tightened on 2026-07-06: `maintenance_enterprise`, `group_operations`, and `advanced_reports` now have module-catalog rows; Custom Website, Payment Gateway Config, Housekeeping Command Center, Promo Codes, and Rate Calendar routes are reflected in the catalog/module keys used by navigation; and `tests/enterprise-nav-catalog-parity.test.mjs` now fails any Enterprise nav entry that bypasses module-catalog gating or points at a route missing from its catalog module.
- Enterprise entitlement/access-control maturity was tightened on 2026-07-06: route-level `UpgradeWall` feature names are now backed by the subscription feature map; add-on-only Enterprise features such as Documents, Hotel Roles, Room Attributes, Advanced Reports, Advanced Booking Engine, Advanced Rates, Rate Calendar, and Promo Codes remain locked until the add-on is enabled; and hotel workflow capabilities such as group operations, preventive maintenance, night audit close/reopen/checks, check-in/out, early/late checkout, and cancellation policies are blocked when their Enterprise feature is disabled.
- Verification for the navigation/catalog/entitlement pass: `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests), `node .\tests\enterprise-housekeeping-maintenance.test.mjs` (13 tests), `node .\tests\enterprise-routing-regression.test.mjs` (46 tests), `node .\tests\enterprise-lower-tier-regression.test.mjs` (10 tests), `node .\tests\subscription-usage-limits.test.mjs` (14 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Live Supabase deployment state was refreshed on 2026-07-06: `npm run db:push` used the configured Supabase pooler and reported `Remote database is up to date` for the linked project. Local SQL contract verification also passed via `node .\tests\enterprise-live-sql-contract.test.mjs` (135 tests).
- Channel Manager provider safety was tightened on 2026-07-06: the local provider adapter now fails closed when no live OTA adapter is connected, and the forward migration `20260706100000_channel_sync_manual_review_until_provider.sql` replaces `process_channel_sync_queue` so queued channel sync items move to `manual_review_required` with an explicit provider-not-connected message instead of being marked `completed`. This was deployed to the linked Supabase project via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the channel safety pass: `node .\tests\enterprise-channel-manager.test.mjs` (10 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (140 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Payment webhook safety was tightened on 2026-07-07: the desktop preload/main IPC bridge no longer exposes `recordWebhookPayment`, the admin Payment Gateway screen remains signature-check-only, and the forward migration `20260707100000_payment_webhook_service_role_only.sql` revokes `record_webhook_payment` from `authenticated`/`anon` and grants it only to `service_role`. This preserves the rule that browser redirects, renderer actions, and operator tests cannot settle online payments; only server-side provider webhook infrastructure may record a verified webhook payment.
- The desktop payment bridge was tightened further on 2026-07-07: `payments:createBookingIntent` and `payments:createPaymentIntent` are no longer exposed through preload/main IPC or the desktop `database.js` facade. Until a real hosted-checkout/server integration is built, the desktop Payment Gateway surface is limited to provider configuration, dashboard visibility, and signature verification; it cannot initiate or settle public provider payments from renderer code.
- The payment webhook lockdown migration was deployed to the linked Supabase project on 2026-07-07 via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the payment webhook safety pass: `node .\tests\enterprise-payment-webhook-security.test.mjs` (17 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (145 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise readiness screens were tightened on 2026-07-07: Custom Website, Payment Links, and Channel Manager workflow workspaces now expose explicit non-editable launch gates for the unresolved external proof they still need, such as website deployment automation, published-site smoke testing, hosted checkout, server webhook infrastructure, provider reconciliation, and live OTA provider adapters. A locally completed readiness checklist no longer implies that those add-ons are operational.
- Enterprise catalog parity was also tightened: the Advanced Reports module now has a matching `advanced_reports` add-on catalog entry, and the Advanced Housekeeping module/test coverage recognizes both routed housekeeping surfaces (`/advanced-housekeeping` and `/housekeeping-command-center`).
- Verification for the readiness-gate/catalog pass: `node .\tests\enterprise-foundation.test.mjs` (179 tests), `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), and `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests).
- Release-gate maturity was tightened on 2026-07-07: `tests/release-behavior.test.mjs` was aligned to the current split-domain code layout and current offline dependency semantics, added as `npm run test:release-behavior`, and added to `docs/SHIP_READY_RUNBOOK.md`. It now verifies prior-run dependency handling, queued booking-reference rewrite behavior, idempotent payment replay branch ordering, and POS v3 submit-intent idempotency.
- Verification for the release-gate pass: `npm run test:release-behavior`, `npm run test:offline-queue-critical`, and `npm run test:offline-pos-critical`.
- Enterprise regression maturity was tightened on 2026-07-07: `npm run test:enterprise` was added as a discoverable Enterprise release gate in `package.json` and `docs/SHIP_READY_RUNBOOK.md`. It runs every `tests/enterprise-*.test.mjs` suite in sorted order and fails the release gate on the first broken Enterprise route, contract, migration, entitlement, offline, or security regression. Verification passed with 27 Enterprise suites.
- Web-surface local release checks were refreshed on 2026-07-07 and promoted to a root release gate: `npm run test:web-surfaces` runs Manager PWA lint/build plus booking-site tests/build. It passed with the existing Manager PWA lint warnings still warning-only, booking-site tests at 32 passing tests, and both web builds passing. This is local build/test proof only; it does not prove Netlify/public deployment publication or live browser smoke on the deployed URLs.
- Deployment-state clarity was tightened on 2026-07-07: `docs/DEPLOYMENT_EVIDENCE_MATRIX.md` now records built, deployed/published, and smoke-tested evidence separately for Supabase, desktop, Legacy POS, Manager PWA, public booking site, marketing site, payment provider integration, channel provider integration, and custom website automation. Rows that only have local build/test evidence are explicitly marked `local-only` or `not-proven`.
- Marketing-site Enterprise proof was tightened on 2026-07-07: `npm run test:marketing-site` now verifies Enterprise package metadata, the Netlify `/enterprise` redirect, public subscription-request RPC wiring, manual-payment-only copy, published Enterprise pricing, and advertised Enterprise add-on keys. `packages.html` metadata and structured data now include Enterprise instead of describing only Starter/Standard/Pro.
- HotelOS sidebar curation was tightened on 2026-07-07: duplicate or setup-only Enterprise entries are no longer shown as primary hotel sidebar pages. HotelOS keeps the normal Dashboard, Housekeeping, Maintenance, Night Audit, Staff, Settings, and core hotel workspaces, while hiding duplicate/deep-link pages such as Hotel Dashboard, Advanced Housekeeping, Housekeeping Command, Maintenance (Enterprise), Hotel KPIs, Corporate Billing, Rate Calendar, Promo Codes, Room Attributes, Documents, Hotel Roles, Night Audit (Enterprise), Check-in Workflow, Early/Late Checkout, Cancellation Policies, Booking Engine, Payment Links, Payment Gateway, and Custom Website. Custom Website remains an internal/deep-link workflow rather than a client daily workspace because Tsa Bonno provisions the website for the client.
- Customer-facing Enterprise Preview Mode was removed on 2026-07-07. Unpurchased add-ons should not appear as locked daily-navigation clutter; add-on testing now belongs in Command Central, where grouped bundles such as Website + Online Payments, Guest Experience Suite, Revenue & Distribution Suite, and Enterprise Operations Suite can be enabled/disabled for a selected account using admin feature overrides.
- Website/payment packaging direction was simplified on 2026-07-07: customers should see "Direct Booking Website with Online Payments" rather than separate technical payment gateway/webhook items. Tsa Bonno configures the website, connects the property's payment provider, guests book and pay online, and the desktop app receives the booking plus verified payment confirmation. Payment links are parked as a later operational tool for special invoice/folio/balance links.
- Still not proven by this local verification: real payment-provider checkout/provider-hosted settlement infrastructure, real OTA/channel-provider connectivity, custom website deployment automation, packaged installer smoke testing, and public/marketing deployment publication.

## 2026-07-08: Future Enterprise hotel add-ons added to manifest

- The Enterprise manifest and shared add-on catalog now include three planned hotel add-on directions: Staff Operations & Workforce, Maintenance & Asset Management, and Events & Venue Management. They are marked as planned/non-advertised add-ons, not shipped operational modules or public quote-builder products.
- Verification after the catalog/manifest update: `node .\tests\enterprise-foundation.test.mjs` passed with 180 tests.

## 2026-07-08: Restaurant POS phase verification and foundations

- Restaurant POS product planning now lives in `docs/RESTAURANT_POS_PRODUCT_PLAN.md` with phase-by-phase status notes and guardrails for other agents. Phase 1 restaurant curation is verified complete in the repository; Phase 2 restaurant operations is verified complete after hardening bill splits, manager-discount PIN approval, modifier persistence, and Enterprise nav guardrail expectations; Phases 3 and 4 now have tested shared foundations but are not yet fully wired to customer-facing UI, Supabase stock/loyalty/account ledgers, or offline replay.
- Phase 2 hardening added `supabase/migrations/20260708120000_restaurant_phase2_operations_hardening.sql`. This migration persists modifier group `min_selections`/`max_selections` and adds `approve_pos_discount_with_pin(payload jsonb)` so manager discount approval is server-authoritative and audited through PIN capability checks instead of a provisional offline approval.
- Restaurant-mode verification found and fixed Enterprise navigation drift around the Payment Gateway add-on: the advertised/requestable route now resolves through `/payment-links`, and `payment_gateway` no longer lists the stale `/payment-gateway-config` route as a catalog navigation route.
- New restaurant regression coverage: `tests/restaurant-operations-foundation.test.mjs`, `tests/restaurant-recipe-costing.test.mjs`, and `tests/restaurant-growth-foundation.test.mjs`.
- New shared foundations: `src/shared/restaurantRecipeCosting.js` for units, recipe theoretical usage, cost, and variance; `src/shared/restaurantGrowth.js` for loyalty math, customer-account ledger entries, delivery settlement, and multi-outlet comparison.
- Verification passed on 2026-07-08: `node .\tests\restaurant-mode-curation.test.mjs`, `node .\tests\restaurant-operations-foundation.test.mjs`, `node .\tests\restaurant-recipe-costing.test.mjs`, `node .\tests\restaurant-growth-foundation.test.mjs`, `npm test`, `npm run test:enterprise`, `npm run build`, and `npm run manager:build`.

## Updating this file

Update this document when:

- a major feature is completed or removed;
- an execution path or application surface changes;
- a migration is confirmed deployed;
- release versions change;
- a known critical risk becomes verified, fixed, or superseded.

Use exact dates and distinguish repository implementation, uncommitted work, released binaries, and confirmed production deployment.
### 2026-07-13 — Restaurant & Bar POS world-class shell tranche

- Added a native Open Checks/Open Tabs workspace backed by the existing POS tab contract, with live 15-second refresh, ownership, age, value, search, and safe resume into `HposTerminal`.
- Added live rail badges for running checks/tabs and active kitchen tickets, capability-aware command search (`Ctrl/Cmd+K`), and explicit role-adaptive rail profiles for cashier, supervisor, and management roles.
- Added persistent touch/compact density modes, reusable HPOS UI primitives, a keyboard skip link, global focus-visible treatment, reduced-motion support, accessible notices/dialog semantics, and F2 payment access.
- Escape no longer silently destroys a terminal cart; it only dismisses transient payment/search UI.
- Restaurant and bar continue to share the same financial, offline, tab, order, and export contracts. No Lodge POS renderer was imported.
- The remaining Settings boundary is now HPOS-presented and only exposes relevant General and Subscription tabs. Lodge document templates and the accommodation health console were removed from HPOS navigation; a native restaurant/bar System Health workspace uses the existing sync status/details contracts.
- Customer and prep displays now use customer/POS language, and Multi-Outlet POS removes Room Service in restaurant/bar mode and adopts the HPOS visual system.

### 2026-07-13 — Manager capability expansion (online ordering intentionally excluded)

- Added the native Business Control workspace for restaurant and bar managers. It consolidates owner briefs, 30-day sales and run-rate signals, menu popularity, labour-versus-sales, reorder suggestions, promotions, reservation/waitlist flow, alerts, checklists, audit activity, and expiry watch.
- Added a Bar Control workflow for bottle/keg/ingredient variance: spill, comp/staff drink, measured-pour variance, expiry/spoilage, and physical count adjustments are recorded through the existing authoritative `inventory.adjustStock` contract with a stable operation identifier and manager-visible reason.
- Online/self-service ordering is deliberately not included in this expansion, per product scope.
