# DeepSeek implementation prompt — restore the original Bar application

## Your assignment

Finish the existing Bar local-first implementation in this repository:

`C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`

The user requires the ORIGINAL, established Restaurant & Bar POS interface running against the local Bar PostgreSQL service. Preserve its existing pages, navigation, Manage button, workflows, styling, component structure, Stock Pro and Accounting Pro add-ons. The replacement local workspace is not the requested product. This is a full integration/restoration assignment, not permission to redesign the product or finish only Menu/Stock/Till.

Implement and test the work, remove genuinely unused replacement UI, then create focused commits and push the completed scope to the configured branch/remote. Preserve saved Rabafi Pub data, identities, credentials, device journals and Restaurant data. PDFs/quick-start/screenshots/guide packaging, hosted/Supabase work and tests requiring extra physical PCs remain explicitly deferred. Do not claim those gates passed.

Work through the complete assignment. Do not stop at a plan, a few green unit tests, or a build. If an external dependency genuinely blocks an item, record the exact evidence and continue independent work. Never claim the whole task is complete with original screens still replaced, routes missing, add-ons suppressed, or real service workflows untested.

## Establish the current state before editing

Read AGENTS.md, PROJECT_STATE.md and docs/ARCHITECTURE.md. Read the original technical plan, implementation/review prompts and acceptance matrices in docs/engineering/bar-local-first. Read NORMAL_HPOS_LOCAL_AUTHORITY_INTEGRATION_2026-11-03.md, NATIVE_STOCK_PROGRESS_2026-11-04.md, CHOOSER_PROFILE_KEY_FIX_2026-11-04.md and the independent November reviews. Older reports are historical evidence, not proof of current behavior.

Inspect git status, branch, diffs, staged changes and configured remote. The checkout contains extensive unrelated TypeScript, marketing, PWA, booking-site and other changes. Preserve them. Do not reset the checkout, overwrite another author's work, stage everything or push unrelated changes. Read SHIP_READY_RUNBOOK before any release action; this task does not authorize deployment/release.

Coordinate ownership with the currently active Luna work before touching overlapping files. Last known ownership: Luna was restricted to the original Till and its adapter; the reviewer was inventorying routes and investigating response contracts. Recheck the actual worktree. Stop overlapping writers through the user's handoff process; do not send messages to other chats without the user's authorization. Use existing code that satisfies the contracts rather than rebuilding it again.

Initial static inventory is available in:

- scripts/bar-native-interface-inventory.mjs
- docs/engineering/bar-local-first/evidence/native-interface-restoration-2026-11-05/route-api-inventory.json
- the adjacent route-coverage.csv and api-methods.json

This inventory includes Restaurant-only routes, aliases, relative component dependencies and imperfect static API references. Audit and refine it; do not mistake raw counts for missing Bar features or acceptance percentages. Compare against the original Bar navigation and all three Bar add-on groups. Establish a finite, explicit route/workflow checklist before declaring completion.

## Independently observed defects and current runtime

The owner has successfully authenticated to the local Bar. The running app nevertheless renders replacement panels and reports:

- `events.latest_event_sequence must be a safe integer`
- `query.scope.role must be a string`
- `query.data must be an object`
- `query.pagination must be an object`
- local-reference/value validation failures.

These are not merely cosmetic. In captured logs several are HTTP 400 error envelopes produced by the local service, then surfaced by the desktop adapter. Trace actual SQL -> service response validation -> HTTP -> desktop validation -> original component contracts. Do not silence exceptions, fabricate successful reads, return empty lists after errors, coerce unsafe values, or disable validation to make the screenshots look clean.

Specific source leads:

1. Migration 0039 service_events calculates max(commit_sequence) over the outlet outbox and returns latest_event_sequence directly. A genuinely empty outbox can produce SQL NULL. Verify later overrides and establish correct empty-feed/cursor semantics. Preserve commit-group pagination, outlet scoping, gaps and monotonic cursor behavior.
2. packages/bar-contracts/src/results.ts validates data, pagination, actor/device/business/outlet/role, watermark and completeness. SQL functions created by different migrations do not all construct identical metadata. Repair inconsistent producers under authenticated scope; do not invent role/tenant identity in the renderer or overwrite a conflicting scope.
3. The original shift.current SQL can return data:null when no shift exists, while the generic response validator expects an object or array. Define the legitimate absent-record contract explicitly, consistently and narrowly across SQL, HTTP, Modern, Legacy and screen adapters. Absence must not masquerade as service failure or as an open shift.
4. The latest local shell hardcodes enterprise_addons:[] and refreshEntitlement as a no-op. This hides entitled original functionality. The real locally authoritative entitlement/capability state must drive visibility and server enforcement; do not enable every add-on by default.
5. HposLayout contains a local-only reduced search list, bypasses the existing Manage PIN flow and relabels Manage as Operations. Restore the original interaction and implement the corresponding local server-authorized PIN contract.

Last reviewer-owned development session was 40002, launched with BOROKO_PRODUCT=hospitality-pos and electron-vite dev -- --bar-local-workspace. It reported bar_local authority: cloud startup disabled. Treat it as potentially active; verify before restarting or running competing tests. No reviewer customer SQL, credential reset or service upgrade was performed. Source migrations currently extend through 0083; recheck for subsequent work and do not infer the installed service/database has all source migrations.

## Required architecture

- Bar operational path: original renderer component -> fixed preload/IPC -> main-process local adapter -> authenticated services/bar-local command/query -> local PostgreSQL.
- Restaurant retains its existing cloud authority and eligible cached/offline sessions/queues. Hotel, lodge, Legacy, booking-site and PWA behavior outside this task remain intact.
- Same email can belong to Bar and Restaurant. Explicit business selection determines authority. Never infer it from email, connectivity or a failed password; never try credentials against another backend as fallback.
- Preserve protected per-device journals and existing cloud/local fences. No cloud Bar fallback, dual writers, renderer database credentials, direct client financial writes or a new parallel business model.
- Prefer adapting the existing IPC/data facade once per contract where appropriate, rather than redesigning each page. Use explicit allowlists and typed mappings. Do not replace window.api with an unrestricted renderer proxy or forward unknown local operations to cloud.
- If an original workflow lacks an equivalent local atomic command/query, implement the missing local contract. Merely mounting the original component while its IPC is rejected is not completion.

## Work package 1 — exact original interface and route parity

Inventory original App.jsx routes, HposLayout, HposNav, HposManageHub, barModeProfile, commercial entitlements, feature gates and all nested tabs/dialogs. Record each Bar-applicable entry's original component, required capability/add-on, reads, mutations, printing/export behavior, local contract and executed acceptance evidence.

Cover every applicable existing workflow, including:

- original Sell/Terminal, products/menu/wizard, pack sizes, recipes, modifiers, promotions, availability, receipts and reprints;
- original open tabs, updates, split tenders/settlement, corrections, returns and voids;
- original drawer, handovers, shifts, personal/shared cash-up, shift close and reviews;
- original service Stock plus Stock Pro purchasing, suppliers, purchase orders, receiving, suggestions, transfers, lots/expiry, FEFO, counts, waste, valuation and costing;
- original staff accounts/PINs/roles/outlets, attendance, roster, tips and workforce features;
- original customers, loyalty, vouchers, reports, business/outlet control, expenses, checklists and incident records;
- original Accounting Pro chart/accounts, general ledger/journals/reversals, payables and payments, bank statements/reconciliation, tax, budgets, statements, period controls, payroll and accounting readiness/activation features that exist in the original Bar product;
- original Manage, settings/devices, setup readiness, health/audit, relevant import/export/data/backup controls and applicable customer/bar displays.

Verify add-on boundaries against the actual original Bar product. Do not introduce restaurant-only kitchens/reservations or accommodation pages into Bar just because their components share the repository. Preserve original grouping, route URLs, deep links, active navigation, role/outlet filters, dialogs, focus and touch behavior. Keep add-on names and entitlements intact.

Restore the familiar manager PIN unlock with local authentication, expiry and user-switch invalidation. Actual privileged actions remain server-enforced; a navigation unlock is not a transferable capability grant. Do not store raw PINs.

## Work package 2 — complete local operational contracts

Trace every applicable original screen action through reads, writes, reporting, replay and authorization. Implement compatibility adapters with original response shapes backed by the local source of truth. Explicitly map IDs, decimal strings, versions, dates, status transitions, pagination, availability and absence semantics.

Preserve:

- atomic financial, stock, GL and audit effects;
- exact-money representation and database-derived totals;
- stable operation IDs, payload-conflict validation and original-ID recovery after ambiguous responses/restart;
- row locking and expected-version concurrency checks;
- server-enforced actor, role, business, outlet, device, entitlement and approval scope;
- no duplicate opening stock, supplier payment, tender, refund, payroll or journal effect on retry;
- complete scoped snapshots; proper empty/deleted/stale catalogue handling; no partial snapshot accepted as complete;
- balanced ledgers, source-to-GL links, stock/lot reconciliation and business-date preservation.

Do not weaken the original Accounting Pro controls to fit the smaller replacement service. Add missing local structures and authoritative contracts when necessary. New migrations must be additive, ordered, privilege-hardened, upgrade-tested and compatible with existing data. Never edit an already-applied historical migration to pretend an installed database was repaired.

## Work package 3 — setup, login and service compatibility

Normal launch must expose existing Rabafi Pub clearly and reach its original shared login/workspace. Saved parent and child Electron profiles can have different safeStorage contexts: validate the protected authority in its own context. Do not copy encryption keys, rewrite credentials or recreate the business. A public chooser descriptor cannot authenticate a session.

Keep new-Bar setup in the same coherent app experience; retain entered nonsecret setup data and explain installation progress/retry. Distinguish choosing a new password from signing in. Do not route completed Bars through repeated setup or an obsolete operational window.

Establish client/service/database compatibility explicitly. Verify the installed package and migration state separately from the worktree. Build an upgrade/repair path that retains existing data, journals, grants and backup scheduling. Validate it on disposable copies first. Before any necessary real Rabafi service/schema upgrade, verify an independent restorable backup and coordinate downtime. Never drop/reinitialize the customer database or use its records as a test fixture. Do not restart the user's active app or services without coordination.

## Work package 4 — remove replacement UI completely

Replace all operational BarLocalWorkspace route targets with their original working components. Inventory BarLocalNativeMenu, BarLocalOperations and related introduced panels/helpers. Remove unused replacement UI, imports, styles, route aliases and obsolete tests after original workflows are connected and acceptance passes.

Keep necessary local client/service/journal/IPC/setup primitives. A setup component or atomic local command is not automatically disposable because it has BarLocal in its name. Do not delete shared code used by Legacy or another surface. There must be no second simplified operational app left behind or reachable by stale URLs.

## Work package 5 — meaningful independent acceptance

Use the actual package.json commands. Add focused behavioral regressions for changed contracts, and run affected existing suites/typechecks/builds without reducing strictness or replacing tests with source regex assertions.

Database tests must use positively identified, fresh, nonce-named disposable loopback clusters through the guarded runner. Retain failed fixtures/logs. Respect the existing 4 GiB test reserve; never use hosted Supabase, Rabafi, another chat's DB, or bypass guards. Start/stop only owned processes. Coordinate to avoid competing with an active author's tests.

Required scenarios:

1. Fresh business with no products, events, stock, shifts or transactions: all appropriate original pages show truthful empty states without validation errors; management/setup stays usable.
2. Existing saved profile and upgrade/restart: correct business/outlet/entitlements, no repeated setup, protected journals retained.
3. Both Bar and Restaurant under the same email; explicit switching; Bar never calls cloud auth/data; Restaurant cached offline sessions and queues remain valid. Unresolved Bar work blocks unsafe switching.
4. Original Menu -> stock/pack receipt -> original Till -> cash/card/split sale/tab -> receipt -> stock/lot/GL/audit -> return/void -> cash-up/review -> original reports. Compare authoritative records, not just displayed totals.
5. Each add-on's original rendered workflow, including Accounting Pro controls, using real local service/DB contracts. Test appropriate entitlement denial as well as access.
6. Wrong actor/outlet/device/business, insufficient role, invalid transition, stale versions, duplicate/reused IDs with changed payloads, concurrent last-stock sale and count, post-commit lost response, process/service restart and exact original-ID replay.
7. Complete catalogue deletion/empty/stale pagination and event-feed cursor/gap handling, including genuinely empty outboxes.
8. Original pages through actual preload/IPC/client/service/PostgreSQL where applicable. Mocked bridges and direct SQL are useful but do not establish this chain.
9. Relevant Modern/Legacy journal and local/cloud boundary regressions; no competing cloud replay or writer.

Keep a row-by-row PASS/FAIL/PARTIAL/UNVERIFIED matrix with reproducible commands, target identities, source references, logs and explicit limitations. Do not fabricate percentages or count tests as feature completion. Software completion and physical/customer-release readiness are separate verdicts. Do not accept a blank placeholder, disabled form, generic unavailable page or replacement panel as restored functionality.

## Commits, push and final handoff

Update PROJECT_STATE, IMPLEMENTATION_REPORT, EVIDENCE_LOG and the internal manual-impact assessment with current facts; PDFs and other explicitly deferred artifacts stay pending. Reconcile stale statements so the newest status is clear.

Use focused commits for this assignment only, carefully separating pre-existing mixed changes and reviewing the staged diff. Never git add -A or reset unrelated files. Finish acceptance before labeling the restoration complete. Push the focused commits to the configured branch/remote when authorized and permitted. Earlier pushes encountered automatic destination-trust rejection: do not bypass it or silently claim a push succeeded. If a new push is rejected, report the exact destination, action and stated reason and request only the approval genuinely required, while completing unaffected work.

Final handoff must identify restored original pages/add-ons, removed replacement UI, local API coverage, migration/installed-upgrade state, executed acceptance, unresolved failures, deferred PDFs/Supabase/physical-PC gates, commits and actual push result. Do not finish with only “Till remains unwired” or “more than thirty pages pending” while declaring the requested implementation complete.
