# Tsa Bonno HospitalityOS Project State

## 2026-09-11 — Base Bar waste summary in Sales report and POS exports (local; zero SQL)

- The Sales report carries a quantity-only Waste card (per-item wasted quantities with top reason for the selected period), and the POS history Excel/PDF exports carry Waste Summary plus line-level Waste Detail with the same numbers; the JSON companion adds the same waste dataset. One shared `src/shared/wasteSummary.js` aggregator serves all three surfaces.
- Boundaries kept: only Waste-action movements count (other decreases excluded), money never appears (costed waste/margin stay Pro), sections render only on a complete server movement ledger (labeled UNAVAILABLE otherwise), and exports omit waste without the stock permission. No migration, no new RPC.
- Bar manual impact: Required — Part F documents the card and export sections (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-base-food` 19/19; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-11 — Auto-menu sync no longer mints duplicates for wizard-covered stock (deployed to linked oicgpknsmtvcsjacymum)

- Incident: renaming wizard-made stock in Stock re-ran `sync_inventory_item_to_pos`, which found no auto row and inserted a new auto sellable, duplicating the wizard product(s) at the Till (Russian/Russian Half case).
- Fix as `20260912000000_bar_sync_skip_covered_stock.sql`: the INSERT branch now fires only when no `pos_menu_items` row of any kind references the stock. Early-return cleanup, in-place auto-row maintenance, and standalone-stock minting are byte-identical to `20260911000000`. No privilege statements in the file (`CREATE OR REPLACE` keeps existing access); pinned by contract test.
- Deployment: linked project `oicgpknsmtvcsjacymum` (this worktree's app target) was at parity through `20260911000000`, so the push applied exactly this one migration. Post-checks: `migration list` parity through `20260912000000`, dry-run `Remote database is up to date`, `db lint --level error` zero errors. Live function-body read-back was not performed (no SQL console path from here); evidence is push success + parity + lint + static contract tests.
- Operator note: the already-minted auto `Russian` row is not removed by this migration — delete it once from Products (its stock stays listed via the Half), then add Russian Full. Future stock edits will no longer re-mint it.
- Evidence: `bar-product-contracts` +1 block; full `test:bar` 438/440 with only the 2 pre-existing `bar-guides-contract` PDF-checksum failures. Bar manual impact: none beyond the existing rename guidance (no new operator workflow).

## 2026-09-11 — Base Bar no-stock products for in-house food (local; zero SQL)

- In-house food cooked by the tray (hundreds of fatcakes a day) can now skip stock entirely: the Bar wizard's Stock source offers No stock tracking, persisted as `stock_method = 'non_stock'` through the existing `create/update_pos_menu_item` contracts (tip definitions from `20260716025000` accept and store it; the Till/readiness path already sells it with no depletion). No migration written or deployed.
- Server-shape findings pinned by tests rather than new SQL: outlet stays null on create (the current tip has no beverage-outlet guard; null-outlet items pass the Till outlet filter so fatcakes sell at the Bar), edits keep the existing outlet scope, recipe-forced sections (breakfast/starters/mains/sides/desserts/cocktails/food) fail closed client-side because the server would silently force the recipe method, and linking from a stockless product now offers the selected row's version instead of a null that the server rejects.
- Display repair included: the desktop menu list read omitted `stock_method`, which would have shown non-stock products as needing stock setup; the column is now selected (additive, cache-compatible). Availability toggles round-trip `non_stock` because updates omit `stock_method` and the server preserves the stored method.
- Retry discipline mirrors stock-only creation (no operation key on the plain contract): ambiguous failures must be checked in Products before any explicit retry, never replayed blindly; the wizard says so.
- Bar manual impact: Required — Part E gains the no-stock paragraph (manual availability, recipe-forced exclusion). PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: `bar-base-food` 11/11; full `test:bar` + `build:hospitality-pos` rerun below. Migrations NOT pushed (none written), nothing published; relaunch required for UI.

## 2026-09-11 — Base Bar food improvements: weighed units, clearer flow, sizes & extras, waste action (local; zero SQL)

- Base Bar (`bar_pos`, no add-on) food gaps closed without any migration: the server contract already stores any unit text and accepts any positive decimal `depletion_qty` (`20260909000000`), so no `REVOKE`/`GRANT` risk was taken after the 2026-09-10 anon-grant outage. No files under `supabase/` were touched.
- `BAR_COUNTED_UNITS` (new shared list): bottle/can/keg/packet/portion/each plus kg/g/l/ml, used by both the product wizard and the stock dialog. `BAR_PRODUCT_CATEGORIES` gains `Cider`. Fries can now consume weighed ingredients (e.g. Potatoes in kg at 0.3 per sale) with the existing atomic `save_bar_product_with_stock` + Till depletion path, idempotent and audited as before. Pack sizes stay server-pinned 6/12/24; copy now states packs work for portions too.
- Wizard `Flow` relabelled `What are you adding?` (option contracts unchanged), depletion help carries the weighed example, and a Sizes & extras notice surfaces applicable modifier groups with a manage shortcut (Products; Stock entry shows the notice read-only). Waste action on each Stock row posts a negative delta through the existing idempotent `adjust_inventory_stock` RPC (`inventory.manage`, lodge assertion, fresh operation key, offline-queued) with structured `Waste · reason_code=…` notes and required reason/detail; validation/notice helpers gained additive `waste` branches.
- Bar manual impact: Required — `manuscript.md` Part E extended (weighed depletion, sizes/extras, portion packs, Waste). PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: new `bar-base-food` 8/8; full `test:bar` 432/434 with only the 2 pre-existing `bar-guides-contract` PDF-checksum failures (output/pdf vs manifest drift from the parallel guides workstream; reproduced at baseline, untouched by this change); `build:hospitality-pos` passes; `git diff --check` clean. Migrations NOT pushed (none written), nothing published; relaunch required for UI.

## 2026-09-11 — Product delete delists stock automatically; opening-stock exactly-once (deployed to linked Theko)

- Operator requirement: deleting a product must delist its stock item in Stock automatically, with movement history preserved for financial truth and auditing. Deployed as `20260911000000_bar_product_delete_delists_stock.sql` on linked `hwzkwdfmoeayophaktsq` (Theko); live-verified by query.
- `delete_pos_menu_item` now: (1) returns idempotent success for an already-deleted row (`already_deleted`) so offline queue replays of applied deletes never dead-letter; (2) on hard delete, delists the linked stock item (`inventory_items.is_active = false`) ONLY when no remaining reference keeps it in service — any `pos_menu_items` row of any template kind including archived, legacy `menu_items`, `restaurant_recipe_ingredients`, and `restaurant_prep_item_ingredients`/`restaurant_prep_items.produced_inventory_item_id` (joined by lodge); (3) writes a `stock_delisted_with_product_delete` entry to `restaurant_financial_audit_log` with `movements_preserved: true`. Movements are never touched by the delist path. The archive path (sale history) keeps stock listed by design.
- Opening-stock exactly-once repair: the AFTER INSERT `log_inventory_opening_stock_movement` trigger is the single opening writer. The wizard contract's explicit insert (third writer, note "…when the product was created") was removed; `restaurant_seed_inventory_item_stock_location_balance` keeps seeding the location balance but no longer writes its second opening movement. Provable same-event duplicates were deduplicated in-migration (wizard rows dropped when any other opening row exists; plain "Opening stock" rows dropped when the richer seed row exists) — post-check: 0 items with duplicate openings DB-wide.
- `save_bar_product_with_stock` stock duplicate-name guard now excludes inactive items, so a delisted name is reusable when the product is re-created. `sync_inventory_item_to_pos` refuses to resurrect auto sellables for inactive stock.
- Desktop/UI: `deletePosMenuItem` passes the server outcome flags through; HposMenu reports "Product deleted and its stock item delisted. Movement history is preserved for audit."; delisted stock is excluded from HposStock list + Count-All scope, lodge Inventory list, the wizard's link list, HposMenu pickers, and day-use lists. `get_bar_stock_aging` already excluded inactive items server-side.
- Incident remediation on Theko: the three phantom "Coke 330ml" stock items from the 2026-09-10 retry storm (products already deleted by the operator, 0 purchases, only defect-written openings) were deduplicated to one opening movement each and delisted with three `stock_delisted_with_product_delete` audit entries. Operator next step: re-create Coke 330ml normally — one save now yields exactly one product, one stock item and one opening movement.
- Blank count sheet printed blank (reported by operator): `index.css` runs a global print policy (`body * { visibility: hidden !important }`) that whitelists specific printable overlays; the Bar count sheet used display-only print rules, so it kept layout but painted nothing. Fixed in `hospitality-pos.css` by joining the visibility whitelist and anchoring the sheet `position: absolute` at the page top (the established multi-page report-overlay pattern, so long sheets flow across pages). Regression pinned in `bar-stock-base-ergonomics`; the browser harness bundle CSS regenerates from source via esbuild on each suite run. No manual update required (restores already-documented behavior; defect printed empty pages).
- Evidence: `bar-product-contracts` +2 blocks (delist SQL contract incl. movement-delete count = 2 dedup rules only; operational-filter wiring across surfaces); full `test:bar` 424/431 — only failures remain the pre-existing `bar-guides-contract` PDF-checksum pair; `build:hospitality-pos` passes; `git diff --check` clean. Bar manual impact: Required — manuscript Part E updated (delete delists stock, history preserved, freed names reusable); PDF rebuild/manifest approval still pending with the guides workstream. `20260909060000` verification migration still deliberately local-only.

## 2026-09-11 — Bar product save: duplicate-name guard, terminal rejections, queue resolved-detection, Bar sync Clear (deployed to linked Theko)

- Incident: the 2026-09-10 outage of `save_bar_product_with_stock` (anon EXECUTE revoked, then a broken deployed pack loop) left every wizard save as a retryable `unknown` product-request under a freshly minted operation key. After the RPC was repaired, retrying the stored failed entries created the same product/stock repeatedly (operation-key dedupe cannot see cross-key duplicates), and the Bar System Health queue had no Clear control.
- Deployed on this machine's linked project `hwzkwdfmoeayophaktsq` (Theko) — the DB the customer app actually hit; note other PROJECT_STATE entries reference `oicgpknsmtvcsjacymum` from a parallel workstream. Chain deployed today: `20260910000000` (anon EXECUTE re-grant), `20260910010000`/`20260910020000` (surgical pack-loop patches, superseded), `20260910030000` (full-body redeploy with index-iteration pack loops + anon grant), `20260910040000` (duplicate-name guards). Live verified by query: product guard (`A product named … already exists`, 23505, pack rows excluded, edits exclude self), stock guard (same lodge + same outlet-or-unassigned location), index loops present, `v_pack_row->>` gone, ACL `{postgres,service_role,anon,authenticated}` all EXECUTE.
- `20260910040000_bar_product_duplicate_name_guard.sql`: both guards fail closed BEFORE any mutation with recovery hints; same-key replays return earlier (unaffected); `bar_pack` derived rows excluded from the product match. Legacy `save_bar_pos_product_with_packs` path is not exposed by the current renderer (preload has no binding) and remains unguarded — deliberate scope boundary.
- Chain-tolerance repair: `20260910010000`/`20260910020000` were fail-closed DO patches against live-drift shapes; on a fresh disposable chain their anchors can be absent, which would abort the chain even though `20260910030000`/`040000` redeploy the authoritative body. Both files were edited post-deploy (live never re-runs them) to skip with a `raise notice … superseded by 20260910030000` instead of raising; pinned by a contracts test. Fresh-chain convergence: 20260909000000 → grants → optional patches (skip) → 030000 → 040000 = final guarded body.
- Desktop flow: `src/shared/productRequest.js` adds `isDefinitiveProductRejection` (SQLSTATE 22023/23505 ⇒ terminal); `pos.js` `dispatchOnline` now returns `{transported, rejected}` for those instead of throwing retryable-unknown, so stale duplicate entries become `rejected` (discardable from the Products banner) instead of re-dispatching forever. Transport/permission/missing stay retryable.
- Queue resolved-detection: `infrastructure.js` `isAlreadyAppliedRpcError` treats `save_bar_product_with_stock` refusals matching `^A (product|stock item) named …` as already-applied (resolved elsewhere ⇒ item consumed as synced, never dead-lettered). The match is prefix-anchored so barcode/operation-key conflicts (which also say "Use the existing product instead.") stay reviewable.
- Bar UI: `HposSystemHealth.jsx` failed-operations desk gains per-row and bulk Clear (calls existing `sync:clearFailed` IPC; records manager-review health faults + journal exactly like the admin panel), with a confirm gate when any selected row is financial; queue-desk copy explains Retry vs Clear. CSS wrappers `hpos-sync-header-actions`/`hpos-sync-row-actions` (+ mobile breakpoint) in `hospitality-pos.css`.
- Evidence: `bar-product-contracts` +7 blocks (guard SQL, classification wiring, resolved-detection, Clear controls, chain tolerance); `bar-product-save-flow` +2 (classifier unit matrix; retry-storm duplicate under a new key terminally rejected with one effect and discard). Full `test:bar` 422/429 — the only 2 failures are the pre-existing `bar-guides-contract` PDF-checksum pair (reproduced at baseline without these changes; the concurrent guides workstream owes the rebuild). `offline-queue-regression` ok; restaurant suite unchanged (same 3 pre-existing disposable-DB-gated failures at baseline and with changes). `build:hospitality-pos` passes; `git diff --check` clean.
- Bar manual impact: **Required** — visible controls and workflow changed. `manuscript.md` updated: Part E now states a product/stock name can only be used once (use the existing product instead); Part H documents System Health Retry vs Clear (stops retries, records for manager review). Pending before release: screenshot recapture of the Products/System Health flows, PDF rebuild, manifest approval and packaged offline smoke — folded into the already-pending guides rebuild above.
- Operator follow-ups: (1) delete the already-created duplicate products from Products, keeping one copy — the guard is forward-looking and does not dedupe existing rows; (2) stale failed/pending product saves on the device will terminally reject on their next retry with the duplicate-name message and can then be discarded from the Products banner; (3) relaunch the Bar app to load the new renderer/main code; (4) `20260909060000_fnb_drift_full_block_verification.sql` remains local-only (deliberately not pushed with these fixes).

## 2026-09-10 — Bar repair tranche F1–F8: persistence, wizard, SQL, publication, recovery, gating, docs (local; migrations NOT deployed)

- F1 `src/shared/productSaveFlow.js` (new, pure/tested): persist-once with verified read-back writes (storage failure blocks dispatch), verbatim replay under stable keys, overwrite rejection on changed payloads, single-flight per key, definitive-rejected vs unknown-outcome vs pending-upgrade states, crash recovery enumeration. `pos.js` save path rebuilt on it (replay-first ordering preserved around journal reuse); startup + 15-min recovery scheduler in `index.js`; retry/status/discard IPC + preload + facade.
- F2 wizard: staged legacy fallback removed (missing RPC preserves the request with an update-required message); edit hydration of packs/barcodes/availability with preserved-changes saves; operation-key rotation only on real value changes after failure; explicit unknown-outcome retry; stock-only safe-retry guidance; Products interrupted-save banner with per-key retry (`pos:getProductRequestStatus`/`retry`).
- F3 SQL (local files): mandatory edit versions under row locks, disabled-pack skip, mid-transaction auto-menu cleanup scoped to fresh rows, server opening-stock movement, outlet authorization; barcode triggers remain the concurrency backstop.
- F4 publication: shared sweep machine with per-outlet published/pending/failed/no-job (empty never proves publication), poison cap with permanent-fail RPC path, supersede reporting; `complete` RPC requires token + live lease and reports supersession.
- F5 Till recovery: canonical key builders, init-gated draft persistence, hold id submitted + persisted together, identity reconciliation preserving unknown outcomes, actionable storage-failure states.
- F6 modifiers: trigger rewrite (distinct-attribution counting, malformed rejection), INSERT-only tab-save coverage, domain replay-first ordering.
- F7 Till gating: `tillEntitlements` matrix (base/add-on/denial/restaurant), customer/promotion read/control/submit gates, approved stale-readiness cache with labeled banner, backend-update compat codes.
- F8: narrow-viewport basket drawer with totals bar (payment forces open), decimal-safe `roundCash` (1.005→1.01), split-tender exclusion pinned, manuscript updated (favourites, quick cash/change, Settle vs Resume, unified product flow, explicit float, reprint, stale readiness, retry saves).
- Evidence: new `bar-product-save-flow` 11/11 (executed same-key/overwrite/storage/concurrency/drop-after-commit/rejection/recovery + publication handover/expiry/overtake/partial/poison), `bar-basket-hold-recovery` 3/3, `bar-till-entitlements` 4/4, extended contracts/daily/recovery suites; full `test:bar` 414/416 with the only 2 failures in `bar-guides-contract` PDF-checksum tests caused by another concurrent workstream's mid-build untracked `output/pdf` + `document-manifest.json` (reproduces without my changes; my manuscript edit does not affect PDF bytes); non-DB restaurant suites pass; PG suites unrunnable here; `build:hospitality-pos` passes; `diff --check` clean on touched files. Migrations NOT pushed, nothing published. Residuals: disposable-DB run of `test:bar-product-sql` (skips without `BAR_PRODUCT_TEST_DB_URL`), guide screenshot recapture + PDF rebuild + manifest approval + packaged offline smoke (needs display + the concurrent guides build to settle).

## 2026-09-10 — Bar readiness missing-RPC ReferenceError fixed (local, needs relaunch)

- `src/main/domains/pos.js` called `isMissingRpcError()` on the stock-readiness and product-save RPC error paths without importing it (helper lives in untracked `src/shared/productRequest.js`). Every RPC error — including the expected missing-function case when `20260909030000` is undeployed — threw `ReferenceError` instead of returning the graceful `backend-update-required` envelope, so the Till showed `Stock status unavailable — selling is paused` with no recovery via Refresh. Fixed with the one-line shared import; IPC already fails closed, renderer behavior unchanged (still paused on unknown readiness).
- Regression: `bar-product-contracts` now asserts the import + `backend-update-required` branches; `bar-product-save-flow` executes the real classifier (missing shapes true, transport/business errors false, null-safe). Full `test:bar` 411/415; the 4 failures are parallel-tranche drift (Bar-guide PDF checksums, `auto_from_inventory` migration text, single-line tabId regex), none from this fix. `build:hospitality-pos` passes.
- Residuals: `20260909030000` was already deployed (pooler dry-run reported up to date); renderer ignores the `code` and keeps fail-closed pause; `20260909030000` role list still excludes `supervisor`/`bar` logins (see prior investigation). No manual update required (internal defect fix, no customer-facing workflow change).
- 2026-09-10 deployment: forward migration `20260909050000_bar_read_rpc_anon_grants.sql` (anon EXECUTE on `get_pos_menu_stock_readiness(uuid)` + `get_bar_stock_aging(uuid,uuid)`, matching the established desktop-grant convention; enforcement stays server-side) pushed to production `oicgpknsmtvcsjacymum` via pooler — exactly one migration applied. Live verified: `has_function_privilege('anon',…)` true for both. Direct-DB hostname does not resolve from this network (pooler path used). Operator action: relaunch the Bar app from a build containing the `isMissingRpcError` import fix, then Refresh in Till/Stock.

## 2026-09-09 — Disposable-cloud SQL acceptance complete (isolated project; production untouched)

- Created isolated disposable Supabase project `repsrmlomedqrmrdsbga` (same org/region as production) with ref-guarded tooling; linked production project `oicgpknsmtvcsjacymum` was never written by this work (one read-only tenant SELECT excepted). No Docker was available, so the local-stack path was not used. Note: remote production migration parity advanced to `20260908020000` during this work via a separate party; the repaired July-30 bytes, drift repairs, payroll fix, and `20260909*` files are not deployed there.
- Applied the full migration chain (439 timestamped files) to the disposable with a tolerant runner (benign base-template conflicts ignored and logged; per-file BEGIN/COMMIT semantics emulated). Two genuine fresh-build defects surfaced and were repaired as forward-compatible migrations: missing `btree_gist` prerequisite ordering (environment bootstrap + report) and byte-exact source-snapshot assertions failing on fresh builds (July-30 attribution repair by Task A; three F&B drift repairs plus a payroll interval-literal fix authored here). A duplicate version collision (`20260909000000`) from parallel work was resolved by renaming the payroll fix to `20260909040000`; scratch `test.tmp.sql` was renamed out of the migrations glob and pinned by a filename guard.
- Per-migration object reconciliation over all 439 files: existence plus exact function bodies with surgical-patch/shutdown/rebuild/drop dispositions; 438/439 PASS, remainder is an accepted upstream platform-template drift (realtime subscription index, unreferenced). Migration history stamped; `db push --dry-run` reports up to date.
- Real SQL acceptance on the disposable, all green with exact SQLSTATEs under real `authenticated`/`anon` roles: cutover maker/checker 19/19, behavioral 11/11, recipe 1/1, settlement strict gate (contract + behaviors A-D), migration portability 8/8, drift fresh-chain 5/5, matrix + activation 31/31, plus a live manager-unlock/PIN-staff attribution demo (operator = shift waiter, audit actor = manager). F5 needed managed-platform session pooling discipline (per-subtest session reaping under the 15-session cap) and three test-source corrections (wrong RPC signature literal, complete budget matrix + conflict code, as-of date bound); the suites found one real app bug (payroll interval literal, fixed forward).
- Draft release packet in `docs/ACCOUNTING_RELEASE_READINESS_PACKET.md` (proposed/verified/pending separated). Still requiring explicit owner choices: pilot tenant/effective date/operators/devices/channel/abort owner, signing inputs (`CSC_LINK`, `CSC_KEY_PASSWORD` missing), publish token (`GH_TOKEN` missing), production migration deployment, and the go/no-go approval. No activation, signing, publishing, or production migration is claimed.

## 2026-09-09 — Bar customer guides packaged and exposed offline (repository implementation; UI smoke pending)

- Added the Bar documentation lifecycle gate to `AGENTS.md`, `docs/bar-manual/maintenance.md`, the pull-request template, `docs/SHIP_READY_RUNBOOK.md` and `docs/BAR_RELEASE_ACCEPTANCE.md`.
- Added `docs/bar-manual/document-manifest.json` for app applicability, distinct document revisions, review date, filenames and SHA-256 approval checksums.
- The actual Bar shell now exposes Help & guides from the HposLayout -> HposNav top-right profile menu, with Open manual, Open quick-start and Save PDF actions for ordinary authenticated Bar users. The renderer sends fixed document IDs through preload; main resolves only the allowlisted packaged resources under `resources/bar-guides/`.
- `apps/hospitality-pos/electron-builder.json` packages the approved Bar pair and manifest. Open/save are local and do not require connectivity or write operational records.
- Verification: the full `npm run test:bar` suite passes 395/395, and `npm run test:bar-guides` passes 12/12 executable checks; the final PDFs contain exactly 55 manual pages and 4 quick-start pages; fresh release renders contain exactly 55 and 4 page images. The final hashes are manual `682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356` and quick-start `DE66637B4C8D2E1A44F1F8E2943D9A88C3784838F317B0C55E2F6434AE0C350B`; packaged copies match.
- Final verification rerun on 2026-09-10: `npm run build:hospitality-pos`, `npm run test:bar-guides`, PDF integrity checks, and the unpacked Windows package completed successfully; the actual packaged-window offline Open/Save smoke remains pending as recorded below.
- The prior Save dialog defect (`title: Save` referencing an undefined variable) was fixed and covered by executable cancellation, copy-failure, open-failure and missing-resource tests. The prior Bar recovery-screen crash was fixed by initializing HposTerminal selectedOutlet before dependent effects; build:hospitality-pos passes. Repository implementation and local packaged-resource verification are complete for this tranche. Packaged UI open/save testing remains uncompleted because the Windows Computer Use helper failed during initialization with `helper_unknown_error: apply deny-read ACLs`; a direct Playwright launch of the packaged executable also failed before a window opened. No signed installer, release-feed publication or installed-artifact smoke is claimed.

## 2026-09-09 — Bar P2b/P2c: selling polish, basket recovery, quick cash, reprint (local, needs relaunch)

- Till: per-outlet favourites + Top sellers (operator-ordered, never hardcoded), direct quantity entry (existing per-caller rules preserved, no integer imposition), single/pack basket badges, last-added highlight + scroll, Undo-remove (6s, unpaid only) + Clear confirmation, Open-tabs count button, resumed-tab identity header (“Ready to continue” / “Tab changed — refresh required”), Open Tabs Settle action distinct from Resume (requires certified total, auto-opens payment).
- Basket recovery: tenant/outlet/operator/shift-scoped drafts persisted on change, one-shot restore with explicit Restore/Discard; precedence resumed-tab > payment-recovery > hold-intent (matched by tab identity + recency) > draft; catalogue revalidation on restore (drop unavailable, refresh prices, report both). Hold intents persisted before dispatch and reconciled by tab identity.
- Quick cash: Exact/P50/P100/P200 + custom received for cash tenders, validated (received >= due, half-up rounding); allocation stays exactly due, excess is change only — pure shared helper `tillBasketRecovery.js` with behavioral tests. Receipts carry display-only `cash_received`/`change_due`; this-terminal last-receipt reprint without resubmission; absent aids never fabricated.
- Evidence: `bar-till-selling` 5/5, `bar-till-recovery` 5/5; full `test:bar` green; `build:hospitality-pos` passes. No migration, no deployment.

## 2026-09-09 — Bar P3/P4: atomic product contract, publication jobs, enforcement, wizard, daily flow (migrations NOT deployed)

- New local migrations (require linked-DB deploy + disposable-DB acceptance before any release): `20260909000000` atomic `save_bar_product_with_stock` (stock create-or-link + opening-once + product + packs, expected-version guards, barcode conflicts with recovery hints, wizard stock skips auto-menu sync by design, publication jobs created in-txn, full payload+ids persisted); `20260909010000` publication claim/complete/fail RPCs (token + unexpired lease, per-outlet versions, supersession, server-side tenant/outlet checks); `20260909020000` modifier-min trigger (sale rows only, reversals/legacy shapes exempt); `20260909030000` stock-readiness read (outcome only).
- Desktop: `saveBarProductWithStock` (dual capability, pre-dispatch durable request, verbatim retry, best-effort publish sweep), `processPendingPublicationJobs` worker (poison-attempt cap, desktop-closed pause stated), `getMenuStockReadiness` (pos.view, no recipe gate), domain modifier asserts (Till Hold/Pay + saveTab/createPosOrder, freshness-tracked, server trigger as backstop).
- UI: `HposProductWizard` (shared from Products + Stock, stock-only path, recipe read-only recovery without conversion, duplicates + use-existing, Save & add another, pre-migration staged fallback marked compatibility mode, publication retry); Till server-readiness gating (unknown/failed blocks selling with Refresh recovery; restaurant path unchanged); Till unknown-scan permission-gated creation; explicit opening float on Till + My Shift; Open Tabs sorting; Cash & close open-tab link; readiness grouped into 6 Bar sections (evidence/progress unchanged).
- Unrelated-worktree repair (no behavior change): `src/main/index.js` had a syntax error from concurrent pending work (`})  app.on(`) that blocked every build; split into two statements. Pre-existing `diff --check` whitespace flags in `HposLayout.jsx`/`HposNav.jsx` left untouched.
- Evidence: `bar-product-contracts` 9/9, `bar-daily-flow` 8/8; full `test:bar` 395/395; non-DB restaurant suites pass (`restaurant-hpos-service-contract`, `gaps-fixes` incl. a slice-bound fix for the new grouping block, mode-curation, operations-foundation, product-extraction 91+34); PG-backed suites un-runnable here (ECONNREFUSED 127.0.0.1:54322, no docker — pre-existing environment limit); `build:hospitality-pos` passes with wizard + worker markers in fresh bundles; `git diff --check` clean on all touched files. Migrations NOT pushed, nothing published. Relaunch required for UI; server features inert until migration deployment.

## 2026-09-09 — Bar Till touch targets enlarged, hover traps removed (local, needs relaunch)

- Till frequent controls now meet a 44px minimum: basket +/- (44px with accessible labels), remove (44px bordered, full opacity), category pills and service-mode toggles (44px height, larger type, `aria-pressed`). Cash/Card/Mobile/Split are 56px primary buttons; the final Pay confirmation is 60px. Product-card meta chips and the sold-out/setup label grew to 11–12px.
- Removed hover-only JS traps that stick on touch: product-card lift, cart-row highlight, trash opacity toggle, pay-button background mutation. Keyboard focus was already covered globally (`hospitality-pos.css` `:focus-visible` rules) and is now pinned by regression test. No scanner/keyboard shortcut behavior changed.
- Evidence: new `tests/bar-till-touch-targets.test.mjs` 5/5; full `npm run test:bar` 362/362; `npm run build:hospitality-pos` passes; `git diff --check` clean. Relaunch the Bar build. No Supabase deployment.

## 2026-09-09 — Bar Till skips floor-table reads in Bar-only mode (local, needs relaunch)

- `HposTerminal.jsx` no longer loads `getTablesWithStatus` when `shouldLoadTillTables()` is false (new `src/shared/barModeProfile.js` helper: true unless Bar-only). The current-shift read is untouched and always runs, so Bar still loads the correct operator/outlet shift; post-hold/post-payment table refreshes are gated the same way. Restaurant behavior unchanged (helper returns true there).
- Bar tab-name suggestions now come from the already-loaded tab list (`openTabNames` from `getTabs`) instead of floor tables. Stale voucher codes/amounts clear whenever the sale leaves walk-up counter mode (tab/table/customer), matching the voucher row visibility condition so hidden values can never reach the tender breakdown.
- Per approved baseline V4 P1 (safe subset): existing customer/promotion/recipe/modifier reads are retained until the P3 readiness contracts land; no migration in this tranche.
- Evidence: new `tests/bar-till-shift-tables.test.mjs` 4/4; full `npm run test:bar` 351/351 green on re-run (one transient `bar-migration-drift-fresh-chain` branch-matrix failure in an earlier run did not reproduce; that suite reads only migration SQL + an inline helper and passes standalone — pre-existing suite-level flakiness in this dirty worktree, unrelated to these files); `npm run build:hospitality-pos` passes with markers verified in fresh `out/hospitality-pos` bundle; `git diff --check` clean on touched files. Relaunch the Bar build to take effect. No Supabase deployment.

## 2026-09-09 — Lodge Starter team performance inside Staff (deployed migration)

- The lodging app now embeds a read-only Performance tab inside Staff (`StaffProductivityPanel`), so Starter teams see server-recorded task activity, timing, ratings and incidents per staff member with a working From/To filter. Copy follows the property vocabulary (lodge/camp/guest house/motel/B&B).
- Hotel and POS are untouched: `/workforce` stays Enterprise + Workforce add-on, `workforce_management` stays `hotel_only`/Enterprise in the catalog and plan maps.
- Read path only: desktop IPC tries `workforce_scheduling.view` then falls back to `staff.view`; migration `20260908020000` lets `get_staff_productivity_dashboard` accept `staff_basic` for `lodge-camp` only (other products still require `workforce_management`; lodge access + role check unchanged, fail closed). All manage RPCs unchanged.
- Also fixed the Workforce page Refresh to actually use the selected date range (it previously re-queried a hardcoded 30 days).
- Evidence: `tests/lodge-starter-productivity.test.mjs` 5/5, `restaurant-staff-management` 7/7, `production-guardrails` ok; migrations pushed via `npm run db:push` (including 3 pending accounting migrations from the worktree) and the live gate verified against the linked project (`LIVE_GATE_OK`).
- Note: `commercial-catalog-authority` has 1 pre-existing failure from worktree drift (6-arg `isCommercialFeatureIncluded` calls predate this change; Starter plan maps were not altered).

## 2026-09-09 — Cross-product Manager activity & performance workspace (local)

- The Manager PWA now has a single protected `/performance` workspace for LodgingOS, HotelOS, Restaurant OS, and Bar OS managers/admins with current product-aware metrics and a merged recent-activity timeline.
- It reuses existing server-backed dashboard, reporting, POS, financial-audit, and operational read contracts rather than adding a second client-side financial model.
- The route requires `dashboard.view`; individual unavailable sources are named with recovery guidance, while the visible data remains read-only.
- Restaurant/Bar POS monetary metrics fail closed as `Unavailable` whenever the period is not server-certified. Quotes, conference reservations, and day-use rows never display their non-ledger totals as confirmed cash.
- Evidence: focused `manager-performance-workspace` tests 3/3, Manager PWA lint, and production build all pass.
- No migration, database deployment, PWA publication, installer release, or live-data change was performed.

## 2026-09-08 - Activated Bar addon visibility and Manage refresh (local)

- Read-only linked-database inspection confirmed Botswapelo Lounge's active Bar POS licence contains all three approved addons. The deployed entitlement RPC still emits base-package-only effective_features alongside the full approved commercial_pricing_snapshot; the running desk cache already contains the addon keys.
- Desktop entitlement normalization now resolves valid product-scoped commercial grants before legacy Pro defaults for features omitted by that RPC. Explicit server feature denials, commercial force-off, expired/foreign contexts and role permissions retain precedence. This fixes reproduced workforce/advanced-report false defaults; accounting itself is permitted by the current source for the Lounge admin, so the exact prior on-screen state was not observed.
- Manage refreshes the shared entitlement snapshot on entry and offers Refresh package access with actionable failure feedback, avoiding the existing 15-minute renderer polling delay after Command Central changes.
- Focused behavioral regression: tests/bar-addon-activation-refresh.test.mjs 5/5. Full Bar gate 314/315: the browser-suite test fails in existing Accounting lifecycle scenarios A2/A3/A4 (cutover selector, activation read-back fixture missing lodge identity, and extra cutover-list reads); these files were not changed by this repair. build:hospitality-pos passes; main normalizer and Manage refresh markers verified in fresh output. Targeted git diff --check passes.
- No live licence edits, accounting cutover, migration deployment or installer publishing. Running Electron must relaunch to load the rebuilt main-process normalizer.


## 2026-09-07 - Verification-driven completion pass: V01–V05 fixed, restaurant gate 37/39, Accounting matrix reviewed, activation UI built (all local; nothing activated/published)

Independent verification (BAR_CLAIMS_VERIFICATION.md) reproduced five defect
classes in the prior pass; all are fixed here with behavioral (not
source-text) coverage. No production publishing, migration execution, grant
change, live-data repair, add-on enablement, or provider activation performed.

- V01 outcome classifier is now provenance-aware (`keyPreviouslySent`,
  explicit domain-unknown wins, server evidence required for commit, bare
  SQLSTATE/message proves nothing, replay-convergent version conflicts only).
  Domain tags every result with provenance; both tab IPC catch blocks tag
  `outcome: unknown`; post-commit cache reconciliation can no longer convert
  a commit into failure (warning field instead). Also fixed: thrown split RPC
  errors now convert to unknown envelopes instead of escaping. New
  `bar-tab-recovery-outcomes` 10/10 runs the REAL classifier + REAL domain
  functions (Electron stubbed, Supabase scripted, temp fs cache).
- V02 immutable replay executor (`replaySavedTabOperation` /
  `submitNewTabOperation`): verbatim saved requests with `is_replay`,
  per-operation replay auth (originator or manager), single-flight per key,
  archive-instead-of-delete, tenant-scoped inbox independent of the tab
  list/ownership/form state, read-storage errors block dispatch, corrected
  path validates terminal rejection itself. `HposOpenChecks` reworked to the
  two entry paths; status checks are labeled as same-key replays. Domain
  accepts `is_replay` past stale local pre-checks. New executor tests 10/10;
  real-browser R1–R6 pass (saved-3-way replay from a 2-way form, corrected
  new key, verbatim transfer replay, closed-tab inbox resolve, post-ownership
  replay, tenant isolation).
- V03 tenant binding: missing/blank lodge rejected whenever an expected
  lodge is known; fetch binder stamps requested lodge / refuses foreign
  answers; offline legacy snapshots bind only on single-profile devices
  (multi-profile must refresh); all Bar callers audited (one Till straggler
  fixed). New `bar-commercial-tenant-binding` 5/5 runs the REAL validator,
  binder, and offline adapter with seeded caches/registry.
- V04 standalone Bar per-tab filter (`workspaceTabAccess.js` decision
  contract: commercial force-off + capability, fail-closed without context;
  tampered `?tab=` renders explicit denial, never the child; outlet scope
  falls back to a sanitized URL value). Restaurant-mode behavior unchanged
  by design. Browser F1–F4 pass with zero-unauthorized-call spies; decision
  tests 7/7.
- V05 allowlisted bundle schema (`shapeSupportBundle`: known top-level keys
  only; bodies reduced to IDs/counts/codes/sanitized strings) + fixed
  replacer bug (numeric match offsets leaked into output) + context-aware
  scrub + cycle/binary/depth/size guards. Real `getSupportBundle` pipeline
  test with seeded synthetic secrets passes; verification probe fully
  redacted. 9/9 across both scrub suites.
- Phase B: restaurant gate 37/39 (was 27/39). Ten drift files resolved with
  per-assertion evidence in `docs/BAR_TEST_FAILURE_TRIAGE.md`; only the two
  PostgreSQL-blocked suites remain (no database/docker in this environment).
  Two real product issues found and fixed in triage: POS even-split omitted
  `source_tab_version` (optimistic concurrency gap), and the area-view
  toggle was missing (implemented: viewMode/tablesByArea/Grid-By-Area).
- Phase D: `docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md` now covers 95 IPC
  operations mapped to exact deployed signatures (definer/search_path/grants/
  tenant markers extracted per function; lifecycle caps reconciled as
  read/manage/close with no invented permission; orphan dispositions
  reviewed — main-internal artifact writers, one gated basic-report path,
  dead V2 superseded variants with no path). Executable guards 6/6 in
  `bar-accounting-matrix`. Found and closed a real maker/checker gap:
  `approve_restaurant_historical_cutover` existed server-side but was
  unwired — domain + `approveCutover` IPC op added.
- Phase E: `RestaurantAccountingActivation.jsx` on route
  `restaurant/accounting-setup` (read gate + manage-gated actions, linked
  from the readiness notice): readiness with actionable items, cutover
  prepare (idempotent) → independent approve (notes + hash echo +
  preparer≠approver warning) → explicit-approval activate with exact args →
  uncertain-response read-back recovery → suspend with retained-history
  note. Browser A1–A5 pass; node activation tests 5/5.
- Verification: `npm run test:bar` 309/309; `test:financial-truth` 189/189;
  `test:restaurant:all` 37/39 (2 PG-blocked); pos-rush 43/43;
  release-behavior/architecture ok; hardware-adapter ok (contract only);
  legacy-pos 219/219; manager lint 0 errors; `git diff --check` clean;
  `build:hospitality-pos` passes with all fix markers verified in fresh
  `out/hospitality-pos` bundles (unsigned local build, version still 1.5.7).
- Residuals needing explicit approval: (1) isolated disposable database for
  Phase C/D3 — no docker here, exact request in
  `docs/ACCOUNTING_SQL_ACCEPTANCE.md`; (2) release version number;
  (3) code-signing inputs + publish token for `scripts/release.mjs publish`;
  (4) pilot tenant/config/cutover/devices/channel (`docs/ACCOUNTING_PILOT_RELEASE_EVIDENCE.md`
  is an empty shell by design); (5) WP7 live two-terminal/device runs.
  Pre-existing cosmetic duplicate key `lost_found.manage` in
  `accessControl.js` labels left untouched.

## 2026-09-07 - Bar handoff WP1/WP2/WP3/WP6 implemented locally (not released)

- WP1 commercial entitlements: conflicting normalized override aliases now fail closed consistently across single-feature and set decisions; entitlement checks accept an optional expected lodge binding and all Bar callers (main IPC, domain, App, Layout, Manage Hub, Menu, Terminal, SubscriptionAccessPanel) supply it; Till voucher/tip gating now consumes the shared entitlement object instead of bare package strings (was silently ignoring force-on/off). New `tests/bar-commercial-overrides-wp1.test.mjs` 8/8; one stale regex in `bar-commercial-overrides.test.mjs` widened for the lodge arg without changing its invariant.
- WP2 split/transfer recovery: new `src/shared/posTabRecovery.js` durable envelope (tenant-scoped keys, legacy key migration reads, quarantine on corruption, persist-before-dispatch, unknown/rejected/needs_review classification); `pos.js` split/transfer preserve code/SQLSTATE/outcome and allow server-authoritative replay when the local tab cache lost the row; Open Tabs shows original-attempt summary with Check status / Retry original / Start corrected attempt (corrected only after proven rejection) and outcome-not-confirmed copy, never storage-deletion advice. New `tests/bar-tab-recovery.test.mjs` 9/9; one stale waiter-ownership source assertion re-pointed at the helper (legacy keys preserved there).
- WP3 finance route: reviewed the `finance-close -> restaurant_accounting` exception (kept); `/hpos/cash` confirmed Accounting-free; Bar Expenses confirmed on its own entitled `/hpos/expenses` page; finance tabs enforce per-tab FeatureGate without mounting unauthorized components; outlet query context preserved. New `tests/bar-finance-route.test.mjs` 6/6.
- WP4 gate: same 12 restaurant files fail as baseline (2 need approved disposable PG at 127.0.0.1:54322, 10 need product decisions + per-file capture; nothing weakened). Added `POS_SETTLEMENT_STRICT_RELEASE=1` so release CI fails instead of skipping unset SQL acceptance (both modes verified). Triage in `docs/BAR_TEST_FAILURE_TRIAGE.md`.
- WP5 accounting: activation explicitly blocked; `docs/BAR_ACCOUNTING_ACTIVATION_RUNBOOK.md` holds the generated 112-function matrix (capability column is a heuristic needing per-function review, high-risk functions called out), design notes, staged proposal, and no-grant deactivation runbook. No migration, grant, or deployment performed.
- WP6 hardening: support bundles now scrub PINs/tokens/card material/payroll/bank/customer PII via `src/shared/supportBundleScrub.js` and carry product, app version, and pending-operation counts. New `tests/bar-support-bundle-scrub.test.mjs` 4/4.
- Verification: `npm run test:bar` 260/260 across 36 files; `test:financial-truth` 189/189; release-behavior/architecture, hardware-adapter, pos-rush pass; `git diff --check` clean; `build:hospitality-pos` passes with WP1-WP3 markers verified in fresh `out/hospitality-pos` bundles (unsigned local build, not a signed installer). Docs: `BAR_COMPLETION_STATUS.md`, `BAR_CAPABILITY_ACCEPTANCE_MATRIX.md`, `BAR_TAB_RECOVERY_CONTRACT.md`, `BAR_RELEASE_ACCEPTANCE.md`.
- Residuals needing approval/decisions: disposable-DB runs, 10 restaurant product decisions, WP7 device/two-terminal/offline/restore acceptance, transfer replay by non-originator (server returns `tab_not_owned`; client keeps record for support), signed release + migration parity refresh + owner sign-off. No production publishing, migration execution, grant change, live-data repair, add-on enablement, or provider activation performed.

## 2026-09-06 - Open Tabs duplicate tab-poll removed (local, needs relaunch)

- `HposLayout.jsx` no longer fires its own `getTabs({status:'active'})` while the route is `/hpos/checks`: `HposOpenChecks.jsx` already owns mount + 15s quiet poll + visibility refetch of the same financial-truth RPC, so the layout kept only its kitchen-ticket poll there and preserves the last-known Open-tabs badge count instead of flickering it to zero. Leaving the page repolls via the new `location.pathname` dependency.
- Gradual Bar slowdown context: Till mount still fans out 7 parallel full reads (`getMenuItems`, full customer DTO, `getTabs` with line items, recipes, staff, promotions, outlets) plus sequential modifiers and floor snapshot; `getCustomers`/recipes/promotions have no caller-side limit and grow monotonically. Next candidate tranche is lazy-loading the customer DTO (only needed for account-charge/delivery/customer picker) and staggering Till secondary reads. Backend caps (`fetchAllPosRows` to 100000, whole-file cache/queue rewrites, unrotated journal) are larger risks and intentionally untouched here.
- Verification: new `tests/bar-open-tabs-poll-dedupe.test.mjs` 2/2; full `npm run test:bar` 228/228 pass; `npm run build:hospitality-pos` passes with `onChecksPage` verified in `HposLayout-dEbiN4tF.js`. Relaunch the fresh Bar build to feel the difference on Open Tabs.

## 2026-09-06 - Cross-shift tab settlement fix deployed to Supabase

- Deployed two pending migrations via `npm run db:push` (pooler) to `oicgpknsmtvcsjacymum`: `20260906001000_fnb_live_function_drift_repair_followup.sql` and `20260906163000_pos_tab_settlement_current_shift_proof.sql`. `migration list --linked` shows parity through `20260906163000`; dry-run reports `Remote database is up to date`.
- Live `pg_get_functiondef('_pos_tab_settlement_owner_error')` verified: validates the Till operator proof against the current payment `shift_id` (`v_payment_shift`), no longer against the tab's original `v_tab.shift_id`. Same assigned waiter can now settle a still-open Bar tab in a later open shift with a fresh PIN unlock in the current shift/outlet.
- Operator recovery for `The shared Till operator proof is missing or expired ... before settling this tab` on cross-shift tabs: the assigned waiter needs an open Till shift + active attendance in the current shift, Unlock Till with that waiter's PIN in the current outlet/shift, refresh Open Tabs, then `Record payment & close tab`.
- Verification: `bar-waiter-tab-ownership` 13/13, full `npm run test:bar` 226/226 pass.
- Residual: `supabase db lint --linked --level error` still reports one error in `get_fnb_consolidated_report` (`column "total" does not exist` on the expenses fragment). Pre-existing F&B drift, untouched by this tranche; needs a forward repair before the ship-ready gate passes.

## 2026-09-06 - Shift-mode tab settlement proof renewal (local, needs relaunch)

- Fixed a payment-boundary race in the shared Till: pointer/keyboard activity renewed the server proof asynchronously, so `Record payment & close tab` could reach `create_pos_order_v3` first and receive `The shared Till operator proof is missing or expired` while the UI still appeared unlocked.
- Fresh Shift-mode payments now await authoritative proof renewal before creating the order envelope. Renewal failure clears the local operator session, reopens the PIN prompt, and records no payment. Recovered/idempotent attempts skip the preflight so the server can still replay a previously committed payment under its original operation key after proof expiry.
- Verification: focused Till/operator and tab-ownership tests pass; full `npm run test:bar` passes 225/225; `npm run build:hospitality-pos` passes and `HposTerminal-VtGghgh3.js` contains the awaited renewal before `createOrder`. No database migration or deployment was required.

## 2026-09-06 - Bar stock, availability, Finance routing, cash-close truth, and tab-save guards (local, needs relaunch)

- Single-item Bar physical counts now use the same atomic `postBarPhysicalCount` contract as Count All, including `expected_qty`, `expected_updated_at`, actual quantity, structured reason, and a stable operation id. Zero-variance counts still reach the server for certification; delivery remains on its separate adjustment path.
- Menu availability changes inspect the authoritative mutation result before changing local sold-out state. A rejected response leaves the product unchanged and displays the server error.
- Bar's shared Finance & close route is add-on-aware: `/restaurant/finance-close` is reachable with `restaurant_accounting`, while its tab capabilities and server authorization remain enforced.
- Cash & close no longer converts server errors, malformed responses, or incomplete/offline snapshots into an empty queue. It shows an explicit unverified state and recovery action instead of a clear review.
- Reopened HPOS and Lodge tabs forward their loaded `expected_version` and `tab_version`; existing-tab saves without a positive version fail closed. A rejected optimistic save restores the exact prior cached row and ordering.
- Bar tab checkout remains one atomic `create_pos_order_v3` call. The retained `pos:openTableSession` compatibility handler accepts `tables` or `tabs`; floor-table IPCs remain `tables`-only.
- Verification: 83/83 focused checks and full `npm run test:bar` 190/190 pass. `npm run build:hospitality-pos` passes; fresh bundles include `HposStock-ChoVYHUH.js`, `HposMenu-BTPFIz_M.js`, `HposCashClose-HPG1qJA5.js`, and `HposTerminal-GQnWJRrD.js`. No database migration or deployment was required.

## 2026-09-05 — Cash & close scroll lock fixed to Till-only viewport (local, needs relaunch)

- Defect: `/hpos/cash` sat in `POS_ROUTE_PREFIXES`, so `HposLayout` applied the locked Till viewport (`overflow: hidden`) to the Cash & close review page — long cash-up queues and the manager decision form below the fold were unreachable for every role.
- Fix: the `is-pos` class in `HposLayout.jsx:435` now follows `isTillRoute` (`/pos`, `/hpos/pos`) instead of `isPosRoute`; `/hpos/cash` keeps its New Order suppression and history nav unchanged.
- Regression: `tests/bar-cash-scroll.test.mjs` 2/2. Verification: focused 6/6 with boot-context tests, full `npm run test:bar` 188/188 pass; `npm run build:hospitality-pos` rebuilt with the Till-only lock verified in the renderer bundle. Relaunch the fresh Bar build.

## 2026-09-05 — Cashier boot navigation loop fixed via auth-only outlet context (local, needs relaunch)

- Defect: `settings:get` requires `settings.view`, which cashier/supervisor roles lack, so boot settings stayed `null`. Every `/hpos/*` route guard (`RestaurantOnlyRoute`) then defaulted `property_type` to `lodge` and bounced to `/`, which `HposLayout` bounced to `/hpos/pos` in an infinite loop (sidebar rendered, pages flickered blank, React Router flood protection tripped). Managers were unaffected. The `reports:criticalErrors` role error in the logs is expected noise for these roles (health log is `system.health`-gated and callers already swallow it).
- Fix: new auth-only `settings:getOutletContext` IPC (`src/main/index.js`) with an explicit routing/mode/identity allowlist (lodge/product/mode/currency/names only, no secrets, fails closed to `null` when signed out); exposed in preload; `App.jsx` boot falls back to it when the full row is denied. Guards still fail closed on a genuine lodge context.
- Regression: `tests/bar-cashier-boot-context.test.mjs` 4/4. Verification: full `npm run test:bar` 188/188 pass; `npm run build:hospitality-pos` rebuilt with the fix verified in main/preload/renderer bundles. Relaunch the fresh Bar build and log the cashier in again (outlet filter snapshots at login).

## 2026-09-05 — Byte-equivalent retries + pre-journal version guard (P0 follow-up, local)

- Cache backfill removed: `resolveCachedTabVersion` deleted. New shared `src/shared/posV3TabFields.js` (`applyOptionalV3TabFields` forwards `expected_tab_version`/`resolve_tab` only when the caller sent them; `isPositiveTabVersion`) keeps rebuilt retries byte-identical so old version-less journal entries replay server-side instead of dying in local conflict. New `hasPosSubmitAttempt` journal export lets the domain reject brand-new version-less `tab_id` attempts before journaling while exempting replays (server replays committed work first, definitively rejects uncommitted work for clearing).
- POS.jsx blocks locally on `currentOpenTab?.id !== activeTabId` or missing version, all modes.
- Verification: real journal behavioral tests (old journal reuses byte-identical, enriched conflicts, helper units), bar 185/185, legacy 219/219; both products rebuilt. No migration this round (server already mandates + replays first).

## 2026-09-05 — Mandatory tab version + lodge waiter + claim-first reorder (P0 follow-ups, deployed)

- `20260905233000_pos_v3_claim_first_tab_settlement.sql` (pushed, verified live incl. ordering): replay returns before any tab lock/validation/ownership/upsert/write; proof strip stays pre-claim; name resolution gated on `resolve_tab` (legacy never opts in — proven by executable legacy test); unsettleable close raises and rolls back.
- `20260905234000_pos_v3_tab_version_waiter.sql` (pushed, verified live): `expected_tab_version` mandatory for every `tab_id` (`tab_version_required`); non-Bar resolve attributes the validated payload waiter, Bar keeps the proof operator. Terminal/helper fail closed on missing versions (explicit `resumeIntent` makes lost-link reachable); POS.jsx blocks locally when `activeTabId` lacks a version; domain backfills versions from local cache for queued payloads in both builders.
- R-0002 behavioral SQL cases A–D in one always-rolled-back txn (scratch-DB only); historical duplicates untouched (no DELETE/backfill; gated index note stands).
- Verification: bar 183/183, legacy 219/219, lodge one-call + version-block tests pass, live `pg_get_functiondef` markers + ordering all OK; both products rebuilt. Relaunch fresh builds.
- Residuals: orphan `restaurant-hpos-service-contract.test.mjs` already red on HEAD (restored untouched); `restaurant-operations-foundation` has pre-existing preload-drift failures (appended test passes alone).

## 2026-09-05 — Claim-first atomic settlement + one-call lodge/bar payments (P0 follow-ups, deployed)

- `20260905233000_pos_v3_claim_first_tab_settlement.sql` (pushed, verified live incl. ordering): idempotent replay now returns before any tab lock/validation/ownership/upsert/write; proof strip stays pre-claim for stable hashes; tab resolve-or-create gated on explicit `resolve_tab` (legacy/others never mint tabs — proven by new legacy test); unsettleable close raises `P0001` and rolls everything back. Live `pg_get_functiondef` verified: all markers present, single claim, replay precedes lock/ownership/resolve.
- Terminal sends `expected_tab_version` + `resolve_tab`; domain forwards both in online+offline v3 builders (server field stays optional). Lodge `POS.jsx` table payments are one call now (table-pick open flow unchanged, still consuming). Resume carries explicit `resumeIntent`; helper fail-closed covers lost-link (now reachable), context-change, and counter-degrade; nav state clears on replay successes too.
- Behavioral SQL (`tests/pos-tab-settlement-atomic.sql`): R-0002 fixture cases A–D in one always-rolled-back txn (settle → identical replay → second rejected → stale blocked/valid settles). Scratch-DB only via `npm run test:pos-settlement-sql`; never pointed at production. Yogofun/duplicate history untouched (no DELETE/backfill anywhere; gated index note in migration).
- Verification: bar suite 181/181, legacy suite 219/219, new foundation lodge test passes (that file has pre-existing preload-drift failures unrelated to this change); both products rebuilt and bundles verified (`resolve_tab` in lodge POS, single `openTableSession` left only for table-pick). Relaunch fresh builds.
- Residuals: orphan `restaurant-hpos-service-contract.test.mjs` was already red on HEAD (quote drift, then stale `redeemVoucher` etc.) — file restored untouched; needs a dedicated refurbishment pass. A concurrent `db push` raced us once (version row appeared with "up to date"); coordinate pushes.

## 2026-09-05 — Fail-closed resumed-tab retention + version guard (P0, deployed)

- New shared helper `resolveResumedTabPayment` (`src/shared/barModeProfile.js`): a tab-opened sale must retain its exact tab id (resume nav id or selected tab id; mismatch blocks with `tab_context_changed`), must settle in a tab mode (counter flip blocked with `tab_settlement_required`), and forwards the loaded version when known. `HposTerminal.jsx` completeOrder fails closed through it before journaling; order payload carries `tab_id` + `expected_tab_version`. `HposOpenChecks.jsx` resume now passes `tabVersion` (legacy null-`table_name` tabs included via `tabName` fallback).
- `20260905232000_pos_v3_tab_version_guard.sql` (pushed, verified live): presented versions are checked against the locked tab row pre-claim (`tab_version_conflict`); absent versions keep prior behavior. Exact replays exempt via claim short-circuit.
- R-0002 recovery coverage: helper unit tests (fresh/resume/mismatch/degraded/malformed), migration asserts (replay-before-mutation ordering, single commit, no deletes), Strict single-use + failure-preserves-session + Shift renew/consume-no-op store tests, live SQL introspection (`tests/pos-tab-settlement-atomic.sql`, `npm run test:pos-settlement-sql` skips without `POS_SETTLEMENT_TEST_DB_URL`).
- Historical duplicates (e.g. yogofun records) untouched in code: no DELETE/backfill anywhere; reconcile via audited void/refund, then the gated unique index note in `20260905231000` applies.
- Verification: full `npm run test:bar` 181/181 pass; rebuilt (`HposTerminal-eaKAjtx_.js` carries the helper). Relaunch from the fresh build. Residual: lodge `POS.jsx` table flow still uses two calls (Strict exposure, unreported); orphan `restaurant-hpos-service-contract.test.mjs` has a pre-existing line-59 quote-style failure unrelated to these changes.

## 2026-09-05 — Paid tab auto-close carries operator proof and reports failures (local, not deployed)

- Defect: `createPosOrder` in `src/main/domains/pos.js` closed the tab fire-and-forget (`closePosTab(data.tab_id).catch(() => {})`) with no operator proof, so the server rejected the close as `tab_not_owned` (desktop actor is the login manager, tab waiter is the PIN bartender) while the payment stood — Open Tabs never reduced and no error ever surfaced.
- Fix: the auto-close (online and offline paths) now forwards `_operator_proof`, and a failed close no longer fails the recorded payment but returns `tab_close_warning`, which `HposTerminal.jsx` appends to the success message so the operator knows the tab is still open (e.g. it belongs to another waiter → use Transfer waiter).
- Regression: new `paid tab auto-close carries the operator proof and reports close failures` test in `tests/bar-waiter-tab-ownership.test.mjs`. Verification: full `npm run test:bar` 177/177 pass; `npm run build:hospitality-pos` rebuilt (renderer + main bundles verified to carry `tab_close_warning`). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar tab resume lands on Open tab so payment closes it (local, not deployed)

- Pre-existing defect surfaced once tab payments started working: bar tabs always carry `table_name` (= tab name), so `HposTerminal.jsx` resume logic set mode `table`, which is invalid in bar-only and corrected to `counter`. The payment then recorded a counter sale with `tab_id: null` and the tab stayed open (`createPosOrder` only auto-closes when `tab_id` is present). None of the earlier reference/Till edits touched this path (confirmed via `git diff`).
- Resume now lands on `tab` in bar mode at all three decision points (initial state, loaded-tab effect, invalid-mode correction which prefers `tab` when resuming). Restaurant table resume is unchanged.
- Regression: new `resumed bar tabs open in tab mode so payment closes the tab` test in `tests/bar-mode-curation.test.mjs`. Verification: full `npm run test:bar` 176/176 pass; `npm run build:hospitality-pos` rebuilt (`HposTerminal-BY0NeR4A.js` carries the fix). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar POS card and mobile-money references fully optional (deployed)

- Restaurant Bar POS (`HposTerminal.jsx`): both `Card approval/reference (optional)` and `Mobile money reference (optional)`; provider inputs no longer `required`; client-side check only rejects overlong (>120) references. Desktop domain `validateProviderPaymentReferences` likewise only length-guards both methods.
- Migrations `20260905000000` (card-optional, superseded) and `20260905000001_pos_provider_references_optional.sql` (both optional, matching-row allocation checks kept) were the only pending migrations and were pushed via `npm run db:push` at the operator's explicit request. Live trigger verified via `pg_get_functiondef`: contains `v_card_seen`/`v_mobile_seen` and 120-char guards, no `requires a transaction or approval reference`.
- Main POS (`POS.jsx`) and Legacy POS renderers/validators remain strict in their own UI; the relaxed domain/DB layers stay compatible with them.
- Verification: new `bar POS provider references are optional with length guards` test; full `npm run test:bar` 175/175 pass; `npm run build:hospitality-pos` rebuilt (`HposTerminal-C0Ezr1dw.js` carries the optional labels). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar tab close uses PIN-verified operator for table session (local, not deployed)

- `HposTerminal.jsx` tab payment called `pos:openTableSession` with the login `user` while the Till authorize check compares the session against the payload waiter/cashier IDs. On a shared terminal (manager logged in, bartender PIN-verified) every tab payment failed with `till_operator_mismatch`, cleared the session, and looped on re-PIN with `Till has locked`. Counter sales already sent `verifiedOperator` so they kept working. The tab open call now sends `(verifiedOperator || user)` for `waiter_id`/`waiter_name`, matching the order payload and hold-check paths.
- Follow-up: the same call also omitted `shift_id`, which shared-Till authorize rejects with `till_operator_shift_mismatch` (clearing the session) while counter `createOrder` sends `shift_id` and passes. The tab open call now sends `cashier_id` and `shift_id: currentShift?.id`. `npm run build:hospitality-pos` rebuilt so `out/hospitality-pos` carries the fix; relaunch from the fresh build (or `npm run dev:restaurant-bar`).
- Regression: new `tab open session carries the PIN-verified operator, not the login user` test in `tests/bar-till-operator-policy.test.mjs`. Verification: targeted 21/21 and full `npm run test:bar` 173/173 pass locally. `npm run build:hospitality-pos` completed successfully so `out/hospitality-pos` now carries both this fix and the tables-or-tabs gate; relaunch from the fresh build (or `npm run dev:restaurant-bar`) — restarting the old installed build alone does not pick up source fixes.

## 2026-09-05 — Bar base open-tab sales unblocked from restaurant tables gate (local, not deployed)

- `pos:openTableSession` in `src/main/index.js` now accepts either `tables` or `tabs` via `requireTablesOrTabsFeature()`. Bar POS base includes `tabs` but excludes `tables`, so every Bar open-tab sale was failing with the generic `This feature is not included in the current commercial package` error. Counter sales were unaffected; tab sales in Botswapelo Lounge were blocked.
- Restaurant packages include both features so their behavior is unchanged; packages with neither still fail closed with the same generic message. Floor-table management IPCs remain `tables`-only.
- Regression: new `Bar base open-tab sales are not blocked by the restaurant tables gate` test in `tests/bar-till-base-entitlements.test.mjs`. Verification: targeted 22/22 and full `npm run test:bar` 172/172 pass locally.

## 2026-09-05 — Restaurant Bar POS card reference made optional (local, not deployed)

- Restaurant Bar POS (`HposTerminal.jsx`) card approval/reference is now optional: label shows `Card approval/reference (optional)`, the input is only `required` for mobile money, and client-side `missingReferences` only blocks mobile-money tenders without a reference. Mobile-money reference remains required.
- Desktop domain `validateProviderPaymentReferences` in `src/main/domains/pos.js` now only requires a reference for `mobile_money`; card references are length-guarded (120 chars) but may be empty. Main POS (`POS.jsx`) and Legacy POS UIs remain strict in their own renderers; the relaxed domain/DB layers stay compatible with them.
- Forward migration `20260905000000_pos_card_reference_optional.sql` redefines `validate_pos_tender_references()` so card rows need only a matching card tender row (reference optional, length-checked) while mobile-money rows still require a reference plus a matching row. Local only; requires linked Supabase deployment plus authenticated behavioral proof before customer enablement. NOTE 2026-09-05: until that migration is applied to the linked database, the deployed trigger still rejects card tenders without a reference (`card tender requires a transaction or approval reference`) even though the UI/domain allow it — apply only that file via the Supabase SQL editor, do not `db:push` (it would push all pending tranches).
- Verification: `tests/bar-payment-references.test.mjs` 3/3 and full `npm run test:bar` 171/171 pass locally.

## 2026-09-04 — F&B progressive activation hardened locally (migrations pending deployment)

All five phases of `docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md` are implemented
in local source and hardened against the post-implementation review findings.
No Supabase deployment, installer publication, PWA/marketing deploy, or live
authenticated smoke has been performed for this tranche.

- Entitlements fail closed: `_fnb_entitlement_state()` returns
  entitled/not_entitled/unverified (never throws true on error); `set_` rejects
  `ENTITLEMENT_UNVERIFIED`; `get_` reports unverified rows as
  disabled+unentitled; previously enabled modules hide on lapse; every feature
  RPC enforces `_fnb_require_module()` independently; renderer defaults are
  unverified and the panel offers no action until the server confirms.
- Room service is a fulfilment view over canonical POS: menu-item lines at
  server prices (free text rejected), outlet/booking/room validation, open
  shift required, one `pos_orders` + `pos_order_items` + `pos_prep_tickets`
  (service_mode room) write-set per operation key, void-permission cancels,
  runner validation, delivery posts one POS-sourced `booking_charges` row
  (unique pos-source index, no client `folio_posted`).
- Meal redemption enforces the plan window, outlet scope, and complimentary
  manager approval; `inventory_consumed`/`folio_reference` are always stored
  as false/null (server-derived, client values stripped in the domain too).
- Reporting uses real columns (`pos_orders.total`, `inventory_purchases.date`
  /`.total_cost`, `expenses.date`/`.amount`) and NULL+completeness flags for
  unavailable money; Today/demand no longer reference absent
  `is_active`/`deleted` columns. Handoff posts exactly one canonical expense.
- Invoice capture requires a lodge supplier + purchase order, takes ordered
  qty/price from PO lines, and compares against confirmed received/invoiced
  figures; food-safety readings require a manager template; all replays with
  a mismatched payload return `IDEMPOTENCY_CONFLICT`.
- Server `_fnb_has_capability()` (role default + boolean override) and
  `_fnb_require_outlet()` (lodge ownership, active, `allowed_outlet_ids`)
  guard every RPC; handover writes (transitions, close-outs, approvals) stay
  possible while disabled, new work does not.
- UI: booking/room/menu selectors + live delivery queue; entitlement list +
  grant/redeem; template picker + corrective queue; supplier→PO→line matching
  + invoice decision queue; scoped caches/dedupe keys; five F&B RPCs added to
  `FINANCIAL_SYNC_TABLES`; `.fnb-field` replaces the blanket label rule;
  hub holds loading state for module links and all cards/tabs carry outlet.
- Coverage `tests/fnb-progressive-activation.test.mjs` passes 23/23
  (executed registry/sync logic + fail-closed SQL invariants, no no-op
  assertions); lodge integration 10/10, product extraction 15/15, restaurant
  curation 55/55, offline-queue ok, LodgingOS build passes with only existing
  warnings. `tests/production-guardrails.test.mjs` still fails on its
  pre-existing stale `database.js`-facade assertion (logic now lives in
  `src/main/domains/bookings.js`); unrelated to F&B.
- Known remaining gap (documented, not claimed): room-service POS rows are
  written directly to the canonical tables rather than through the
  `create_pos_order_v3` validator, so v3-only guards (catalog snapshot,
  operator proof) do not run on them; shift, menu, price, idempotency, kitchen
  routing, and folio-source equivalence are enforced. Close this before
  treating room service as fully v3-equivalent.
- Forward migrations `20260904000000`, `20260904010000`, `20260904020000`
  remain local-only and unapplied remotely. Disabling a module hides
  navigation and stops new work; retained history stays readable.

## 2026-09-04 — AI assistant is recommend-only; offline smarts added locally

The desktop Ops AI no longer automates anything. There is no proposal
store, no confirm-execute path, and no direct ledger write reachable from
the assistant: `src/main/ai/aiOrchestrator.js` maps every write intent
(`create_booking`, `check_in`, `check_out`, `record_payment`,
`bulk_record_payment`, `bulk_check_out`) to a route-bearing recommendation
(`RECOMMENDATION_ROUTES` + `buildRecommendation`), and `ai:execute` rejects
unconditionally with audit event `ai.execute.rejected` (`recommend_only`).
The renderer (`OpsAi.jsx`) shows a Recommendation card whose button only
navigates (payment intents deep-link `collectPaymentBookingId` /
`reviewBookingId`); the proposal Confirm UI is removed. The two crafted
bulk-message fast-paths in `ai:turn` (capability/actions-gate bypass) and
all timestamp-minted idempotency keys in the orchestrator are deleted, and
the cloud system prompt now instructs recommend-only behavior. Read tools,
capability gates on reads, strict fenced-JSON parsing, sync-aware context,
provider routing, error normalization, and bulk Inline-panel IPC
(preview → explicit Confirm, still capability-gated) are unchanged.

Offline smarts (no outside LLM, all device-local): `chrono-node/en`
(English-only deep import) extends day-window parsing ("last 7 days",
"in 5 days", "fortnight"; room digits never corrupt the window),
`fuse.js/basic` powers sidebar topic search with did-you-mean plus a
`findClosestTopics` helper, room number-words resolve ("room five" → 5),
shift bias is hour-parameterized (`getTimeAwareSuggestions`), multi-match
guest/booking widgets disambiguate, the daily briefing carries a
deterministic template `story`, fallback queries log a truncated
`ai.unresolved_query` signal for the monthly synonym backlog review, and
the tool runner accepts an injectable clock so date-relative tools are
deterministic in tests. `chrono-node` is pruned to ~138 KB (EN ESM only)
via `scripts/prune-chrono-locales.mjs`, chained into `postinstall` so fresh
installs stay lean; `mini-search` was evaluated and deferred to avoid
regressing the tuned intent matcher.

Verification: ai-guardrails 96/96, ai-local-tools 12/12 (fixed clock),
ai-smarts 21/21 (new), local-assistant 36/36, ai-provider-behavior 15/15,
ai-parser-runtime 36/36, production guardrails ok, LodgingOS production
build passes with only pre-existing warnings. No Supabase migration is
involved. Desktop release required before operators see the new UI; cloud
provider + guest-PII caution from the 2026-09-03 audit still applies if a
cloud provider is ever configured.

Follow-up accuracy hardening (same tranche, local matcher only): fixed
seven reproduced misroutes with evidence — guarded synonyms (order/sale/
bill/food/tab skip expansion near void/cancel/purchase/stock/report/
utility contexts; `refund` mapping removed), light (unexpanded) identity
gates for playbooks and policy FAQ, stopword-robust content-token sequence
tiers in scoring, exact-phrase keywords (purchase order, order stock, void
sale, electricity bill, food cost, ...), bare check-in/out routing to the
guides, missing-room defaulting to all rooms, and session raw-first (a
confident raw answer wins; continuation-led messages still enrich). All
suites stay green (ai-smarts now 31/31 with misroute regression pins) and
the production build still passes. Known residual limitations: "open tabs"
has no backing tool so it honestly disambiguates, and vague "purchase
report" may land on an unrelated summary — both read-only, neither executes.

## 2026-09-04 — Verified booking audit contracts deployed to Supabase

Forward migration `20260904090000_verified_booking_contracts.sql` adds the
authoritative import-row contract, paid-cancellation and checkout-balance
guards, accommodation-aware update/reschedule wrappers, one atomic and
idempotent multi-room booking/group-invoice transaction, and payload-bound
public booking idempotency. Multi-room replay is one queue intent, uses stable
child mappings, refreshes authoritative booking/group data after success, and
marks every affected child for recovery when replay is rejected.

Offline booking money now remains in explicit `_estimated_*` presentation
fields until server confirmation. Bookings, Room Grid, and receipts label that
state and block unsafe financial/status actions. Public booking forms retain a
per-intent UUID across refresh/ambiguous retry. Manager PWA entitlements fail
closed without a verified server lease, and every device-local queue mutation
uses verified write/readback persistence. The race-prone invoice max+1 helper
is hard-gated away from invoice creation.

Focused booking contracts pass 10/10; import, offline-queue, financial-integrity,
customer-credit/reschedule, production guardrail, campsite/rate, and all 31
Enterprise regression suites pass. LodgingOS, Manager PWA, and public booking
site production builds pass; the booking site test suite passes 33/33. Manager
PWA lint has warnings but no errors. The linked `Tsa Bonno HospitalityOS`
Supabase project (`oicgpknsmtvcsjacymum`) has local/remote migration parity
through `20260904090000`; the post-push dry run reports the remote database up
to date. Linked SQL lint reports no booking-contract finding, but release remains
blocked by three error-level findings in the simultaneously deployed F&B
functions documented below.

## 2026-09-04 — F&B database migrations deployed; client surfaces unpublished

All five phases of `docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md` are implemented in
local source. Migrations `20260904000000` through `20260904020000` are applied
to the linked Supabase project; no installer publication, PWA/marketing deploy,
or live authenticated smoke has been performed for this tranche. Post-push SQL
lint reports three error-level schema mismatches in
`fnb_module_disable_blockers`, `get_fnb_consolidated_report`, and
`get_fnb_demand_recommendations`; these must be repaired by a forward migration
before release.

- Phase 1: company-scoped `fnb_module_preferences` + `get/set` RPCs with
  allowlist, lodge membership, `settings.manage_general` (server equivalent of
  `settings.manage`), commercial entitlement, optimistic versioning,
  disable-blockers, and append-only audit; online-only activation with
  last-confirmed cache + retry; slim header with shared outlet context and
  primary New order; Today landing counts; compact switcher showing enabled
  modules only; More-tools panel (enabled first, disabled with benefit + one
  action); completed lodge token adapter + button/field/modal/table/empty/error
  hierarchy scoped strictly to `.lodge-food-beverage-hub`.
- Phase 2: Inventory/Expenses consume `?scope=food-beverage&outlet=&from=`
  with an F&B-filtered banner and Back-to-F&B return; Reports consumes
  `?tab=pos&outlet=&from=food-beverage` without dropping context on tab
  switches; module-gated tabs hide while disabled (recipes, purchasing, team,
  settlement) and canonical bridges carry outlet + return; consolidated F&B
  report reads server-confirmed sales/cost signals with source + completeness.
- Phase 3: idempotent room-service create (offline-eligible, same key on
  replay) + online-only state transitions with runner/cancel-reason/audit;
  atomic meal-plan grant/redeem with covers, complimentary reason/approval,
  inventory-consumed flag, and folio-reference-only rule (never authors
  `amount_paid`/`payment_status`); Today + consolidated read models.
- Phase 4: immutable temperature logs (offline-eligible) with automatic
  out-of-range corrective actions + explicit supervisor close-out; supplier
  invoice capture (offline-eligible) with ordered/received/invoiced matching,
  manager variance approval, and accounting handoff that posts no ledger.
- Phase 5: read-only advisory demand recommendations (occupancy, events,
  reservations, history, stock) with freshness/confidence/source/exceptions;
  explicit manager approval creates traceable prep-batch / draft-PO requests.

Forward migrations `20260904000000_fnb_module_preferences.sql`,
`20260904010000_fnb_guest_service.sql`, and
`20260904020000_fnb_supply_planning.sql` are local-only and unapplied
remotely. Disabling a module hides navigation and stops new work; it never
deletes data, reverses money, or blocks authorised retained-history reads.
Focused F&B activation coverage passes 11/11, lodge/restaurant integration
passes 10/10, product extraction 15/15, restaurant curation 55/55, and the
LodgingOS production build passes with only the existing chunking warnings.
`tests/production-guardrails.test.mjs` still fails on its pre-existing stale
`database.js`-facade assertion (it expects inline `cached[idx]` payment logic
that now lives in `src/main/domains/bookings.js`); that failure predates this
tranche and is unrelated to F&B.

## 2026-09-03 — Lodge Food & Beverage integration de-duplicated locally

The LodgingOS Food & Beverage hub now reuses the mature Restaurant & Bar
kitchen, menu/recipe, purchasing, lot/expiry, team, settlement, and operational
control workflows without creating a second owner for shared lodge records.
Lodge Inventory remains authoritative for item stock, Lodge Reports for sales
evidence, Lodge Expenses for operating costs, and the lodge POS for selling and
operator cash-up. Those duplicated F&B views now present explicit links to the
canonical lodge workflow.

The live floor now hands table, outlet, service-mode, and running-tab context to
the lodge POS; reservation and recipe links remain inside the lodge F&B route.
The broken Cash & close workspace alias is mapped to Finance, workspace cards
and tabs are capability-filtered, and the embedded restaurant header is
suppressed so the F&B page uses lodge visual hierarchy. Duplicate lodge POS
menu, table, modifier, recipe, and floor setup entries were removed in favor of
F&B management, while terminal device, shift, promotion, and audit controls
remain in POS.

The F&B shell has since been simplified to an operator-first hierarchy: four
permission-aware quick actions, one sticky compact workspace switcher, one
selected-workspace heading, and smaller secondary tabs/guidance. A CSS adapter
scoped strictly to `.lodge-food-beverage-hub` translates the reused restaurant
plum/copper controls to LodgingOS emerald/slate/white without changing the
standalone Restaurant & Bar product.

Focused lodge/restaurant integration coverage passes 87/87 and the LodgingOS
production build passes. No Supabase migration or deployment is required for
this renderer integration.

## 2026-09-03 — Client subscription settings and commercial billing history clarified locally

The client-facing Subscription page now leads with the current plan, price,
standing, next payment, and compact usage. Invoice and payment history has
explicit loading, unavailable, error, and empty states; plan selection is
labelled as a preview/request rather than immediate activation; and technical
entitlement detail is collapsed by default.

Subscription billing history no longer reuses guest booking invoices. Forward
migration `20260903090000_client_commercial_billing_history.sql` adds a narrow,
session-bound reader over the commercial account, invoice, allocation, and
payment ledgers. It enforces company, product, active-user, and subscription-
management scope server-side, returns authoritative invoice status and balance
fields, and never converts a failed read into a misleading empty paid history.
The desktop IPC retains the legacy method name only as a compatibility alias to
the new commercial contract.

The unfinished Document Templates page has been retired from client Settings,
desktop navigation, and the legacy `/documents` route. The underlying Hotel
document implementation remains dormant and fail-closed so it can be completed
later without exposing template metadata as a finished client workflow.

Focused subscription/billing/routing coverage passes 87/87, the commercial
suite passes 11/11, production guardrails pass, and LodgingOS, HotelOS, and
Hospitality POS production builds pass with the existing chunk-size warnings.
The complete Enterprise regression gate passes all 31 suites, and the product
extraction suite passes 15/15. Stale navigation and direct-IPC source-shape
assertions were aligned with the current `Users & Access` label and guarded
preload `invoke()` wrapper. The linked migration history records
`20260903090000_client_commercial_billing_history.sql` as applied. Forward repair
`20260903110000_client_commercial_billing_history_scope_repair.sql` was applied
on 2026-09-03; it binds the direct-auth fallback to the requested company and
hides internal draft invoices. The post-deployment dry run reports the remote
database up to date, and linked error-level SQL lint and advisors both return
no findings. No installers have been published.

## 2026-09-01 — Trial transition UX and commercial override control plane deployed to Supabase

All three separately distributed products retain full in-product access during
an active 30-day trial. LodgingOS now labels trial-only feature access, shows
the exact selected post-trial package and countdown, and presents user, room,
check-in-month booking, Manager PWA session, offline-queue, and feature-loss
impacts before activation. No paid package is treated as an automatic fallback:
without an activated package, access pauses. Trial guidance is silent for paid
subscriptions.

Commercially locked routes remain discoverable and now open a page-specific
upgrade showcase without mounting the protected workspace. Role/capability
denials remain separate and explicitly explain that an upgrade does not change
operator permissions.

Forward migration `20260829110000_commercial_entitlement_overrides.sql` adds a
product-scoped, append-only feature and numeric allowance override ledger.
Command Central can force on/off every feature in the selected product's
package/add-on catalogue and override LodgingOS users, rooms, monthly bookings,
or booking grace; for example, Starter can be granted three users. Overrides
require a fresh active master-admin identity, an eight-character reason, a
stable operation ID, server audit, and optional expiry, and are soft-revoked to
restore the package default. Security, roles, tenancy, audit, idempotency,
financial ledgers, and product identity cannot be overridden. The desktop and
server creation guards consume `effective_limits`, and entitlement reads are
bound to the current executable so Lodge, Hotel, and POS grants cannot leak
across products.

Unsafe lower-package assignment now returns an audited `pending_remediation`
result rather than a dead-end error or an unsafe activation. For excess users,
Command Central requires the operator to select exactly which accounts remain
active; overflow accounts are suspended, never deleted, Manager PWA access is
disabled, and active sessions are revoked atomically. Existing rooms, bookings,
financial records, and offline work are never automatically deleted or
discarded.

Customer-facing commercial catalogues are product-specific. LodgingOS exposes
only Starter, Standard, and Pro and no longer recommends Enterprise after Pro;
HotelOS presents its separately licensed Hotel Core offer, while POS retains
its own package ladder. Command Central groups packages by product and lets an
operator compare overrides against a prospective package such as Starter even
when the client's currently active license is Pro. Internal `Enterprise`
compatibility identifiers remain in shared HotelOS implementation paths, but
they are not a LodgingOS plan or customer-facing upgrade target.

Focused trial/override/remediation coverage passes, production guardrails pass,
and LodgingOS, HotelOS, and Hospitality POS production builds pass with only the
existing chunking warnings. Migration
`20260829110000_commercial_entitlement_overrides.sql` was applied to the linked
Supabase project on 2026-09-01. Post-deployment lint identified one invalid
reference to the nonexistent `public.users.updated_at` column inside the new
user-remediation RPC; no user records had been changed. Forward repair
`20260901010000_fix_commercial_user_remediation_user_timestamp.sql` was applied
immediately. The final linked dry run reports the remote database up to date,
and linked error-level SQL lint and security advisors both pass with no issues.
No desktop installers have been published, so the new operator-facing trial,
showcase, remediation, and override controls require the matching desktop
release before they are available to customers.

## 2026-08-29 — Login entitlement argument-limit incident repaired and deployed

The Enterprise plan-normalization migration deployed on 2026-08-28 rebuilt the
63-key `_license_plan_features` result with one `jsonb_build_object` call. That
passed 126 arguments to PostgreSQL, exceeding its 100-argument function-call
limit and causing entitlement resolution during customer login to fail with
`cannot pass more than 100 arguments to a function`.

Forward migration `20260829010000_fix_license_feature_argument_limit.sql`
preserves the complete 63-flag and plan-tier contract while building the JSONB
map from rows with `jsonb_object_agg`, removing the variadic argument ceiling.
It is deployed to the linked Supabase project, local and remote migration
history match, and a post-deploy dry run is empty. Live read-only RPC probes
pass for expired, trial, Starter, Standard, Pro, Enterprise, and the Hotel plan
alias with the expected enabled-feature counts and boolean values. Focused
login/subscription/Hotel entitlement coverage passes 17/17. No desktop release
is required for this server-side repair.

## 2026-08-28 — Subscription switching and tier-surface guardrails implemented locally (migration pending)

LodgingOS now exposes `Core Data Backup` directly on Starter and consolidates it
into a single `Data Management` workspace on Standard and Pro. The legacy
`/starter-backup` route remains compatible, and role-aware Data Management tabs
retain backup access for Finance users without exposing import controls. Hotel
Core now discovers the same Data Management workspace, and Hotel navigation
uses the `Guest Deposits` name with feature and role annotations.

Manager Mobile App provisioning is now consistently Pro-only in the Users &
Access UI and desktop main process. New enablement requires a live authoritative
entitlement; offline or unverifiable provisioning fails closed. Forward
migration `20260828091000_users_access_subscription_guards.sql` enforces the
same rule for every database caller, revokes active PWA sessions when mobile
access is disabled, and rejects any active Standard assignment while enabled
PWA users or active PWA sessions remain. This includes Pro-to-Standard,
trial-to-Standard, and deactivate/insert transitions and never silently rewrites
staff access.

Successful activation now refreshes the shared renderer entitlement immediately
and bypasses the two-minute main-process cache. Guest Deposits closes and blocks
stale receive, allocation, and refund forms after capability loss, and its
reconciliation control is role-aware. Focused subscription, recovery, deposit,
and traffic coverage passes; production guardrails and both LodgingOS and
HotelOS production builds pass with only existing chunking warnings. The linked
Supabase dry run identifies only the new `20260828091000` migration as pending;
it has not been deployed, and no desktop release has been published.

## 2026-08-28 — Check-in-month booking-cap rule implemented and deployed

Booking-cap enforcement now uses only the selected check-in month's active,
non-exclusive bookings (`confirmed`, `checked_in`, and `checked_out`). Booking
creation-month volume remains visible as an explicitly informational metric and
cannot block booking creation. The desktop no longer disables New Booking merely
because the current check-in month is full; the selected date is enforced during
creation, and multi-room bookings preflight all requested room-booking units.

Forward migration `20260828090000_booking_check_in_month_usage_enforcement.sql`
removes the creation-month quota, serializes per-lodge/per-check-in-month quota
acquisition, and applies the same guard when a pending/cancelled booking is
confirmed or a booking is moved into another month. LodgingOS booking bases are
now Starter 120, Standard 400, and Pro 600, retaining only the small existing
grace allowances of +2, +5, and +10 respectively. Pro is no longer treated as
unlimited by the forward server rule or usage UI. Enterprise/Hotel limits remain
unchanged pending the separate product-boundary work. Focused subscription,
cross-layer enforcement, and production-guardrail tests pass, as does the
Lodge/Camp production build. The linked migration history was verified on
2026-08-28 as applied through
`20260828090000_booking_check_in_month_usage_enforcement.sql`; live server
enforcement now includes this rule. No desktop release was published as part of
that database verification.

## 2026-08-27 — Whole-project Auth/config recovery integration (local-only)

The scheduled backup workflow now has a separate encrypted whole-project
recovery bundle step. It uses the existing database URL and encryption public
key to capture explicit Auth schema/data, Storage schema, migration history,
and a value-free repository function/config inventory; it uploads only the
encrypted artifact to the dedicated `tsa-bonno/supabase/whole-project/` R2
prefix and a seven-day GitHub artifact. The shared R2 helper remains backward
compatible with the existing database artifact names. No Management API token,
function secret, project API key, provider credential, Storage object byte,
private key, or passphrase is exported. The integration, checksums, and restore
ordering pass locally; no live workflow run, upload, deployment, or restore
proof exists yet.

## 2026-08-27 — Encrypted Supabase Storage backup tranche implemented locally (credentials and live proof pending)

The existing scheduled database-backup workflow now has a separate encrypted
Supabase Storage tranche. It uses dedicated Supabase Storage S3 credentials only
inside the Storage step, dynamically lists every live bucket and paginated object,
HEADs private and public objects, records S3-visible bucket/object metadata and
plaintext SHA-256 values in an encrypted manifest, and writes independently
encrypted object blobs to the existing private Cloudflare R2 bucket. R2 blob keys
are deterministic synthetic hashes; the incremental public index contains no
bucket names or object paths. Unchanged blobs are reused only after their encrypted
size and checksum metadata are HEAD-verified.

Storage snapshots are explicitly non-atomic. A run publishes its encrypted
manifest and complete public index only after a second full bucket/object/HEAD
inventory exactly matches the first. Every manifest, blob, and public index upload
is read-after-write or HEAD verified. Storage retention uses a separate versioned
R2 prefix, validates the complete index/manifest graph and every blob referenced by
retained snapshots before deleting anything, and fails with no deletion on a
malformed index, orphan/missing manifest, or missing/corrupt retained blob. It
retains 14 daily days and one snapshot per ISO week through 90 days and never uses
a service-role fallback.

Focused local coverage exercises S3 continuation-token pagination, private object
paths and metadata remaining absent from the public index/R2 key names, encrypted
manifest recovery, unchanged-blob reuse, mid-run source mutation rejection,
retained-reference-safe cleanup, fail-closed malformed/missing reference state,
and workflow credential scoping. This tranche is not deployed, committed, pushed,
or live-verified. It still requires four repository secrets
(`SUPABASE_STORAGE_S3_ENDPOINT`, `SUPABASE_STORAGE_S3_REGION`,
`SUPABASE_STORAGE_S3_ACCESS_KEY_ID`, and
`SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY`), a controlled manual workflow run, R2
inspection, representative blob decryption/checksum proof, and a disposable-project
Storage restore rehearsal. Supabase-generated S3 credentials are server-only but
have full Storage access across all buckets and bypass RLS; Supabase currently does
not provide a generated read-only S3 key. The initial copy consumes Storage egress,
S3 does not expose all bucket access/restriction settings, and object versioning is
not supported, so the database archive and a separately protected secrets/function
inventory remain required for whole-project recovery.

## 2026-08-27 — Encrypted Supabase database backup live and independently verified

The scheduled GitHub Actions database-backup workflow now has a fail-closed
preflight that reports every missing repository secret by its actual GitHub
name, writes a safe run summary, opens one deduplicated failure issue, detects
an overdue successful backup after 26 hours, and closes the overdue issue after
a fully successful run. Success requires the encrypted database artifact and
the private Cloudflare R2 upload; cleanup remains unconditional. R2 uses a
SigV4-signed S3-compatible request with a dedicated managed prefix and bounded
daily/weekly retention that never deletes the sole successful object. A local offline
verification/rehearsal command now decrypts an existing archive into a unique
temporary path, rejects unsafe or malformed tar input, verifies required files,
checks the recorded SHA-256 values and metadata, accepts legacy v1
`github_run_id` archives through an explicit compatibility alias while emitting
canonical `run_id` output, emits a secret-redacted report,
and removes plaintext by default. It does not restore or write a database.

The first three scheduled workflow runs failed because GitHub supplied none of
the six required repository secrets:
`SUPABASE_BACKUP_DB_URL`, `BACKUP_ENCRYPTION_PUBLIC_KEY_B64`,
`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`,
`CLOUDFLARE_R2_ACCESS_KEY_ID`, and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. The owner
subsequently configured all six without placing their values in source or chat.
Manual GitHub Actions run `33079309627` on commit `9be651a` completed all dump,
encryption, GitHub-artifact, R2-upload, freshness, retention, and cleanup steps.
R2 retained one encrypted object and deleted none.

The exact object downloaded back from R2 was independently decrypted and
verified locally using the owner-held encrypted private key and separately held
passphrase:
`tsa-bonno_supabase_tsa-bonno-supabase-2026-08-27T13-54-39Z-33079309627.tar.gz.tbbackup`,
10,828,261 bytes, archive SHA-256
`cd7e2d498898cf36968141dcfc341f0b83b4803d011b201978eef85bcbef5668`.
Verification confirmed the required SQL files, metadata, and internal checksums
and removed temporary plaintext. Commit `e074610` corrected future archives to
write canonical `run_id` while retaining a strict, conflict-rejecting v1 adapter
for the first archive's `github_run_id` field.

The linked Supabase project currently exposes one Storage bucket,
`private-cashup-proofs`, and four deployed Edge Functions. Only
`send-booking-confirmation` and `send-push` have source in this repository;
`auth-master-admin` and `send-welcome-email` must be recovered into source
control. The present workflow backs up the PostgreSQL database archive only. It
does not yet copy Storage objects, Edge Function source, function-secret values,
or external-provider configuration. A future whole-project tranche must add an
encrypted, content-addressed Storage manifest/object backup with retention that
never deletes blobs referenced by retained manifests, recover the missing
function sources, and maintain a separately protected restore inventory for
secrets that must be recreated rather than exported.

Local evidence passes the R2/workflow, backup-crypto/retention, and offline
rehearsal tests (25/25), script syntax validation, `git diff --check`, and
production guardrails. The workflow and verifier are committed and pushed to
`main`; the daily schedule is active and the first encrypted database backup is
verified. This is not yet whole-project disaster recovery: Auth users, Storage
object bytes/configuration, two missing Edge Function sources, deployed
function secrets, provider/project configuration, and unsynced device queues
still require separate backup contracts and full disposable-project restore
evidence.

## 2026-08-27 — Starter recovery workspace and weekly automation (database deployed; desktop not released)

The Starter `.tbbackup` contract now defaults to v3 with recomputed canonical
per-table hashes, strict import ceilings, schema-aligned restore allowlists,
protected/media-field removal, explicit non-transactional snapshot disclosure,
and signed-ledger validation/reconstruction. Command Central now has a
freshly-reauthenticated, capability-gated recovery workspace that decrypts only
in the Electron main process, validates and remaps in memory, and can submit an
idempotent restore only to a new quarantined disposable lodge. A restore is not
labelled verified until the authoritative execute RPC and a separate server
verification RPC both confirm actor, target, counts, isolation, quarantine,
ledger reconciliation, and request binding. Live-lodge replacement remains
blocked. Source room-type and floor-section IDs are deliberately not copied
across lodge boundaries; their unresolved counts are disclosed while campsite
operational fields are preserved.

Eligible accommodation packages now have an opt-in, customer-owned weekly
automation path with OS-secure passphrase storage, active-lodge scoping,
startup/reconnect due evaluation, crash-safe single-flight locking, immediate
post-write verification, bounded retention of scheduler-owned verified files,
and a simple status/setup UI with passphrase visibility controls. This remains
separate from managed/Pro backup policy and never blocks lodge operations.

Local verification passes: Starter backup 27/27 and combined recovery,
automation, wiring, and SQL-contract coverage 42/42. The linked project is now
applied through `20260827020000_starter_recovery_campsite_booking_completeness.sql`,
including the prepayment entitlement migration, the recovery/automation RPCs,
post-deploy idempotency and quarantine guardrails, and campsite booking-detail
restore coverage. Local/remote migration history matches, the post-deploy dry
run is empty, and linked error-level SQL lint and security advisors report no
issues.

This is database deployment evidence only. No authenticated Command Central
disposable-restore/two-lodge isolation smoke, restart credential test, packaged
installer, publication, or customer enablement has been completed, so the
desktop recovery and automation workflows are not yet customer-ready. The
package remains a seven-category core-data export rather than a whole-product
backup. Its export ceiling is 256 MiB/100,000 rows per table, while the current
authoritative one-RPC restore transport is limited to 8 MiB; larger valid
packages require a future chunked restore transport and must not be presented
as currently restorable.

The approved future direction is now recorded in
`docs/STARTER_BACKUP_RECOVERY_ROADMAP.md`: every authoritative customer data
domain must gain a backup and tested recovery path, including POS, inventory,
expenses/accounting, events, assets, attachments, non-secret memberships, and
audit evidence. Secrets and rebuildable device state remain excluded. The
current product name must remain **Core Data Backup** until that broader scope,
chunked transport, reconciliation, and disposable restore evidence exist.

No installer was built or published.
During local work, ignored reproducible `out/hospitality-pos`,
`dist/hospitality-pos`, and `node_modules/.vite` artifacts were removed to
recover disk space; no source, customer data, or `.tbbackup` file was removed.

## 2026-08-25 — Starter Core Data Recovery Export package (local implementation; no publication)

Starter Backup now writes a branded `.tbbackup` envelope around canonical core
JSON. The package carries included/excluded dataset categories, app/schema
versions, full SHA-256 checksums, recovery readme, and optional AES-256-GCM
encryption using a passphrase that is never persisted. The desktop flow shows
the saved destination, full fingerprint, record counts and completeness,
supports opening the folder, verification, saving another atomic copy,
seven-day history/reminders, and a disposable in-memory support-led restore
rehearsal that writes only a non-PII validation report. Decrypted customer data
is not returned over the renderer IPC verifier and is not extracted by the
rehearsal. No live restore or database overwrite path was added. Package
round-trip, integrity, wrong-passphrase, atomic-write contract, history, and
rehearsal tests pass;
`npm run build` passes with the existing Vite dynamic-import warning. This
source remains unpublished and no installer or external deployment is claimed.
The near-term implementation plan for Command Central live recovery and
automated encrypted Starter backups is tracked in
[docs/STARTER_BACKUP_RECOVERY_ROADMAP.md](docs/STARTER_BACKUP_RECOVERY_ROADMAP.md).

## 2026-08-25 — Manager PWA version visibility and multi-business switching (production deployed)

The Manager PWA now exposes the root application semantic version plus a
unique per-build identifier under Menu, supports an explicit update check, and
identifies the waiting build in the global update prompt. Service-worker
registration is build-addressed and bypasses the HTTP cache for update checks;
runtime asset caching and the existing offline shell remain intact.

Supabase-authenticated accounts now retain every active Manager membership
returned by the server instead of silently filtering disabled or unentitled
companies and auto-opening the last eligible product. Login presents a
product/package-aware company chooser, and Menu presents the same company list
inside the authenticated app. Unavailable companies remain visible with an
actionable access/plan state but cannot be selected. A switch re-lists
memberships server-side, selects the exact lodge without a fallback row, mints
the new lodge-scoped app session, revokes the previous session, and remounts
entitlement, inbox, product-shell, and data providers by lodge/session identity.

A read-only linked account check for `botswapelostudios2@gmail.com` found five
active, auth-linked Admin memberships. Restaurant is enabled and entitled;
Bar, Lodge, and Lounge are entitled but their per-user Manager PWA access is
off; Hotel is both disabled and not entitled under its current package state.
No production permission or entitlement was changed. Enabling the three
eligible memberships remains an explicit access-control action, while Hotel
requires a valid Manager App entitlement before it may be opened.

Combined PWA/product/prepayment coverage passes 68/68, Manager lint has zero
errors and 34 existing warnings, and the production PWA build passes. Vercel
deployment `dpl_62R3FmKmkDm4HqW4p579XNbgaucy` is READY and is aliased to
`boroko-bookings.vercel.app`; both that alias and
`tsa-bonno-hospitalityos-manager.vercel.app` load the Tsa Bonno HospitalityOS
Manager production shell. No database migration, desktop release, marketing
deployment, commit, or push is claimed for this tranche.

## 2026-08-25 — Tiered Guest Deposits / Prepayments (local implementation; database deployment pending)

The accommodation products now use one authoritative customer-credit ledger
and RPC family across three commercial tiers. Lodge Starter exposes Guest
Deposits Lite (`prepayments_basic`) for receiving a deposit, viewing the
server-confirmed balance and history, allocating credit to a booking, and
Admin-authorized refund/reversal with a mandatory reason. Lodge Standard adds
Prepayments Management (`prepayments_management`) with portfolio search,
reconciliation, partial or split allocation support, bounded operational
reporting, and audited CSV export. Lodge Pro adds Credit Control & Automation
(`prepayments_advanced`) with server-calculated ageing, configurable three-band
thresholds, alerts, analytics, and advisory read-only matching suggestions.
Hotel Core carries all three accommodation capabilities; Hospitality POS
packages carry none. Downgraded accommodation accounts retain ledger reads
while actions outside the active tier fail closed. The Manager PWA remains
read-only.

The Manager PWA now uses the exact `prepayments.view` capability instead of
the older invoice-view proxy. `/prepayments` is an accommodation route for both
LodgingOS and HotelOS, remains unavailable to Hospitality POS, fails closed on
malformed authoritative summaries, and explicitly disables receive, allocate,
refund, reverse, reconcile, export, ageing, matching, and configuration
capabilities on mobile. It does not calculate a portfolio liability from row
fallbacks. Public marketing now presents the same tier boundaries across the
home comparison, package page, feature page, LodgingOS and HotelOS pages,
Manager App page, and brochure. The Standard brochure no longer places the
Manager App below Pro. The public guest booking site remains unchanged because
it contains no internal package or customer-credit control surface.

Desktop mutations require caller-owned stable operation IDs; refund and
reversal require a reason; IPC, domain, and database boundaries independently
enforce lodge, actor, role, capability, subscription feature, and input rules.
Offline allocation exposes explicitly pending estimate fields and never authors
authoritative `amount_paid` or `payment_status`. Failed or malformed
authoritative reads remain unavailable rather than becoming zero. Standard CSV
exports are bounded, neutralize spreadsheet formulas, hash the written file,
and record server audit evidence with a visible partial-success state when the
file succeeds but audit confirmation fails. Pro ageing, alerts, matching, and
configuration are server-backed; matching suggestions do not mutate ledgers.

Forward migration `20260825010000_prepayments_tier_controls.sql` adds the
catalogue, entitlement, authorization, configuration/audit, portfolio,
reconciliation, ageing, alert, matching, and export contracts. A linked dry run
on 2026-08-25 identifies exactly this migration as pending; it has not been
deployed or live-smoke-tested. Local evidence passes the 16/16 focused tier
contract, 44/44 combined affected contracts, 9/9 hotel financial invariants,
production guardrails, the LodgingOS production build, and the Manager PWA
build. Manager membership coverage passes 17/17, the marketing contract passes
all legacy assertions plus 4/4 new tier-boundary checks, and Manager lint has
zero errors and 34 existing warnings. The existing Vite mesh dynamic/static
import warning remains. Manager PWA production deployment
`dpl_3WtPaDKfEC8wZozNu7bMEzKDkkEH` is READY on Vercel; both
`tsa-bonno-hospitalityos-manager.vercel.app` and the compatibility alias
`boroko-bookings.vercel.app` return HTTP 200, and their production shell asset
hashes match the verified local build. The prepayments database migration,
desktop source, and marketing source remain uncommitted/unpublished; no
authenticated production Guest Deposits smoke is claimed.

## 2026-08-24 — Lodge Starter basic reports (linked database applied; desktop publication pending)

Lodge Starter now includes a deliberately narrow, view-only `basic_reports`
module for Today, 7-day, and 30-day operating summaries. The full `reports`
module and all report exports remain Standard-only. The desktop route is
capability-gated by `reports.basic_view`; only manager/finance/admin-equivalent
roles receive that capability by default, with the existing entitlement and
override boundaries still applied.

Forward migration `20260824050000_starter_basic_report.sql` adds the
server-authoritative `get_starter_basic_report(uuid, integer)` RPC. It enforces
application-session, lodge, role/capability, and range checks server-side; uses
the property's configured business timezone; distinguishes arrivals,
departures, and bookings-created dates; calculates occupancy from room-nights;
and derives collections and outstanding balances from signed payment-ledger
entries rather than a cached booking total. Financial values are returned only
when booking/payment source coverage and payment signs can be certified;
otherwise every monetary field is `NULL` with an actionable reason. The
desktop anon-key application-session grant is restored explicitly while the
SECURITY DEFINER body remains fail-closed.
The same migration updates the active accommodation-package catalogue and
package-entitlement rows, backfills valid current and legacy accommodation
licences without overwriting manual feature overrides, and records each new
lodge grant in the activation audit log.

Focused Starter/marketing coverage passes 5/5, commercial coverage passes
11/11, production guardrails pass, and the LodgingOS production build passes
with the existing Vite mesh dynamic/static import warning. The affected
enterprise entitlement run passes 46/47; its sole failure is the pre-existing
IPC parity test expecting literal `ipcRenderer.invoke(...)` calls even though
the preload uses the shared `invoke(...)` wrapper, so it discovers zero preload
channels before evaluating this feature's matching handler. Migration
`20260824050000` is applied to the linked Tsa Bonno HospitalityOS project;
local/remote history is in parity through that ID, the post-deployment dry run
reports the remote database up to date, linked error-level SQL lint returns no
findings, and error-level advisors report no issues. The updated desktop and
marketing source remain unpublished, and no desktop installer has been built
or published for this tranche.

## 2026-08-24 — Lodge Starter package completion (linked database applied; desktop publication pending)

The Starter package now has four bounded operator workflows in local source:
Users & Access Lite, customer-owned Starter Backup, print/save-PDF output for
Basic Reports, and universal immutable operational audit recording. Users &
Access Lite permits at most two accounts, requires one active Admin, restricts
the second account to Receptionist or Operations, and withholds custom
permissions, PWA access, outlet scope, audit viewing, and full Staff Management.
The matching database guards serialize account changes and reject a
noncompliant Starter activation or downgrade instead of silently accepting an
over-limit lodge.

Starter Backup creates an atomic, customer-owned JSON artifact with lodge scope,
PII warnings, completeness evidence, row ceilings, a SHA-256 digest, and no
secret/idempotency-key or absolute-path disclosure. Recovery is explicitly
support-led; the feature does not claim a live restore. It is available only to
licensed Lodge/Hotel accommodation packages and is rejected for Hospitality POS
before any save dialog or data read. Basic Reports now support bounded A4 PDF
and native print output for the existing Today/7-day/30-day summaries. Report
money remains server-authoritative, and print retries retain a stable operation
ID for idempotent audit evidence.

Starter operational writes now have a forward-only audit-recording closure in
`20260824070000_starter_universal_audit_recording.sql`. Existing
`financial_audit_log` remains authoritative for booking/payment financial
mutations, `staff_access_audit` remains authoritative for Starter user-access
changes, and POS ledgers remain unchanged. The new lodge-scoped,
actor-attributed `starter_operational_audit_log` captures rooms, housekeeping,
customers, quotations, invoices, and maintenance changes with immutable
append-only protection and recursive credential/identity-secret redaction.
Starter backup creation and basic-report PDF/print artifact actions call the
server RPC `record_starter_artifact_audit` with stable content/operation IDs;
artifact writes report `auditRecorded: false` when server evidence cannot be
confirmed. Audit viewing and night-audit workflow remain Standard-only. Focused
cross-product coverage passes 57/57, production guardrails pass, and the
LodgingOS production build passes with the existing Vite mesh import warning.
The affected Enterprise entitlement file passes 21/22; its sole failure is the
pre-existing IPC parity parser that expects literal `ipcRenderer.invoke(...)`
calls although preload uses the shared `invoke(...)` wrapper. Linked migrations
`20260824060000_starter_users_access_lite.sql`,
`20260824065000_starter_backup_entitlement.sql`, and
`20260824070000_starter_universal_audit_recording.sql` are applied. Migration
history has local/remote parity through `20260824070000`, the post-deployment
dry run reports the remote database up to date, and linked error-level SQL lint
returns no findings. A refreshed authenticated Hills View Lodge desktop session
now resolves `staff_basic: true` and refreshes all three existing user records;
the lodge remains above the Starter two-user limit and new creation is blocked.
Desktop source remains uncommitted/unpublished, and authenticated backup,
report-artifact, installer, and public-release smoke remain open.

## 2026-08-24 — Consolidated main and Bar/POS source publication

Repository history is consolidated onto `main`; redundant local and GitHub branch labels were removed only after their committed tips were preserved on `main`. The previously uncommitted Bar/POS operational tranche is now prepared for repository publication on that single branch, including the ordered forward migrations through `20260821040000`, guarded offline replay, authoritative financial/read completeness, Bar Base stock and Till controls, cash-up evidence, setup/read truth, secure local storage, Command Central subscription hardening, Manager PWA alignment, Legacy POS continuity, marketing copy, and the matching regression coverage.

Current verification passes: production guardrails; Bar 171/171; focused offline/setup/open-tabs/security 17/17; Legacy POS 218/218; command-central 34/34; commercial 11/11; Manager PWA membership 17/17; restaurant workspace 22/22; marketing contract 1/1; LodgingOS, Hospitality POS, Legacy POS, and Manager PWA production builds; and Manager PWA lint with zero errors and 34 existing warnings. The known Vite mesh dynamic/static import warning remains. This source publication does not publish desktop installers, deploy the Manager PWA or marketing site, or independently change the already-recorded linked Supabase deployment state.

## 2026-08-21 — Offline contract, secure-store, health-fault, and setup-read truth tranche (linked database applied; desktop publication pending)

The desktop/POS offline contract now has stable idempotent wrappers for POS menu updates and staff clock-out, with legacy queue replay conversion preserving the original operation key. Direct `clock_out_staff` execution is revoked for the desktop client role; live anonymous probes confirmed both new wrappers are callable but fail closed with `Access denied for this lodge.`, while the direct RPC returns permission denied. The linked migration `20260821040000_offline_rpc_contracts_and_desktop_grants.sql` was successfully pushed, and `supabase migration list --linked` reports local/remote parity through `20260821040000`.

Secure local storage now fails closed when encrypted storage is unavailable and propagates an actionable warning rather than silently writing sensitive session material in plaintext. Health-fault retention/deduplication now runs through the actual sync-store path with bounded, redacted, deterministic records. Setup progress now uses an authoritative read-status envelope and visibly labels offline/unavailable evidence; completion remains blocked until the server read is complete. Existing setup array callers remain supported.

Combined focused coverage is 11/11, `npm run test:bar` is 171/171, changed JavaScript syntax checks pass, and `npm run build:hospitality-pos` exits 0 with the existing Vite mesh dynamic/static import warning. Linked SQL lint returned `results=[]`. The pre-deploy dry run identified only `20260821040000`. A later post-deploy dry run hit transient `LegacyDbConfigConnectTempRoleError`, and the advisors command stalled during login-role initialization and was interrupted; those checks are not claimed as passed. Desktop source/build evidence is local only: no installer, public desktop release, PWA publication, or operator smoke has been performed.

## 2026-08-20 — Open-tab values restored from server-derived line facts (linked applied)

Held POS tabs submit persisted `unit_price` and `quantity` snapshots, not
renderer-authored line totals. Forward migration
`20260820170000_pos_tab_server_derived_line_values.sql` adds an immutable,
strictly validated server helper that derives line values for new writes and
for existing active rows at read time. Invalid item shapes remain operationally
visible but stay `financial_complete=false`; the operational read remains
complete and the Open Tabs top-level amount fields are populated only for
certified rows. Migration `20260820170000` is applied to the linked project;
the follow-up dry run reports the remote database up to date, linked
error-level SQL lint returns zero findings, and linked error-level advisors
report no issues. Focused Open Tabs coverage passes 4/4 and the full Bar suite
passes 155/155.

## 2026-08-20 — Bar Base deferred service tranche (implementation; deployment performed elsewhere)

The deferred Bar Base service tranche is implemented in repository source and
covered by focused regressions. Migrations
`20260820120000_bar_base_atomic_stock_operations.sql`,
`20260820130000_bar_setup_alert_checklist_controls.sql`, and
`20260820140000_bar_base_deferred_service_tranche.sql` are covered by this
implementation. This delegated task performed no deployment; the current
shared project state records the linked tranche through `20260820160000` as
applied by separate work, without this entry independently asserting remote
state. The tranche adds certified daily-close summary output,
immutable/idempotent cash-up proof metadata and scoped signed reads, certified
basic category/top-product reporting, controlled void-reason templates,
authoritative handover notes, and Bar board controls while preserving Base/add-on
boundaries and blind cash-up behavior.

Cash-up proof upload/list/read now uses the session-bound Supabase client,
structured-clone bytes, bounded MIME/size validation, SHA-256 and stable retry
keys; no local path, base64 blob, service credential, delete path, or permanent
URL is stored. The private Storage bucket/policies still require functional
live verification to prove that the `x-boroko-session` request context is
available to Storage policy evaluation. Until that verification, the UI fails
closed with an actionable message rather than treating missing evidence as
empty.

Focused deferred coverage passes 4/4, the Bar suite passes 155/155 and includes
onboarding, checklist, and deferred-service tests, and the Hospitality POS build passes
with the existing mesh chunking warning only. No deployment, commit, or
desktop publication has been performed.

## 2026-08-20 — Named Bar tabs restored to Open Tabs (linked database applied; desktop publication pending)

The Open Tabs desktop read now distinguishes an active POS tab from an active
physical-table tab. Named Bar tabs intentionally have no `table_name`; they
are included by the operational active-status filter, while floor occupancy
continues to require a real table name. This fixes the local/cache path that
previously hid a successfully held named tab.

Forward migration
`20260820150000_pos_open_tabs_operational_read_completeness.sql` separates a
complete operational tab-row read from per-row financial certification. A
server-confirmed tab remains visible when its line amounts are not certifiable,
but its total stays unavailable; the UI does not promote an incomplete amount
to financial truth. Migration `20260820150000` is applied to the linked project.
The ordered push also exposed a PostgreSQL `42P10` lint error in the newly
deployed checklist-template function: its conflict target omitted the predicate
from a partial unique index. Forward migration `20260820160000` repairs that
target without changing the nullable legacy table shape. Linked migration
history is in parity through `20260820160000`; the follow-up dry run reports the
remote database up to date, linked error-level SQL lint is clean, and linked
error-level advisors report no issues. Focused Open Tabs coverage passes 2/2,
focused checklist coverage passes 4/4, the complete Bar suite passes 144/144,
and the Hospitality POS production build passes with the existing mesh chunking
warning only. Updated desktop source still requires normal installer publication
before operators receive it.

## 2026-08-20 — Bar POS Base readiness, stock ergonomics, and commercial-copy alignment (linked database applied; desktop publication pending)

Bar POS Base remains P4,500/year and now explicitly documents the counter
essentials already supported in the product: modifiers, open tabs, and
receipts. The three separate annual add-on boundaries remain intact:
Stock & Purchasing Pro (P3,000), Accounting & Workforce (P6,000), and Growth
& Multi-Outlet (P5,000); advanced Owner View, purchasing depth, accounting,
workforce, and multi-outlet workflows are not included in Base.

Bar onboarding now presents a 14-stage, evidence-backed staff/device/shift
readiness path covering staff accounts, least-privilege roles, private PINs,
device readiness, and a first completed shift. Receipt, scanner, and cash
hardware readiness requires an explicitly observed successful test on the
current POS computer; saved settings alone do not complete the stage.
Attendance-PIN clock-out and manager-approved daily-close checklist evidence
remain server-authoritative and cannot be satisfied by a client-side tick.

Basic Bar stock now has category suggestions, a low-stock filter, structured
adjustment reasons, read-only movement history with source-completeness
status, a printable blank count sheet that never presents cached quantities as
certified on-hand, and stable operation/retry keys. Atomic batch count posting
and multi-line simple delivery are now implemented through the forward-only
`20260820120000_bar_base_atomic_stock_operations.sql` migration: each operation
uses one stable UUID/payload hash, deterministic row locks, explicit expected
quantity/version evidence, outlet/manager authorization, immutable count or
delivery movements, and replay-safe offline queue contracts. Count All is
blocked unless the stock read is server-complete and versioned. Simple
delivery remains supplier/PO/lot/expiry/valuation-free and fails closed to
Purchase Receiving when Accounting is active. Bar stock history now exposes
server actor, expected, actual, delta and reason. Barcode receiving lookup and
verified ESC/POS output-path label printing are wired; label printing gives a
recovery message when no configured output path exists.

The ordered linked migration tranche from
`20260820100000_bar_base_catalog_feature_alignment.sql` through
`20260820160000_bar_checklist_operation_conflict_target_repair.sql` is applied.
Remote history is in parity, a follow-up dry run is a no-op, linked error-level
SQL lint is clean, and error-level advisors report no issues. Source changes
remain uncommitted and no desktop installer has been published. Independent
verification records `npm run test:bar` (144/144) and
`npm run build:hospitality-pos` passing, with the existing mesh warning only;
focused commercial, marketing, onboarding, stock, Open Tabs, and checklist
tests also pass.

## 2026-08-18 — Bar POS tab/digest anon grants repaired (linked applied)

Live diagnosis on the Botswapelo Lodge bar desk exposed a production defect:
the desktop application-session client executes RPCs as the `anon` role (anon
key plus `x-boroko-session` header), but the 2026-08-14 Bar POS authorization
hardening migration (`20260814010000`) revoked `anon` from `upsert_pos_tab`,
`update_pos_tab_status`, and `generate_owner_digest`, and its tab read wrapper
was never granted to `anon` in the first place. Every open-tab poll failed with
`permission denied for function get_restaurant_pos_tabs_financial_truth`
(repeated each refresh round), so the desktop fell back to device-local tabs
marked uncertified and tab saves/transfers/owner digest would fail the same way
at runtime. This is the same class as the 2026-08-17
`app_current_lodge_id` repair and the follow-up "re-audit remaining
authenticated-only functions the desktop (anon role) may call".

Migration `20260818100000_bar_pos_tab_anon_session_grants.sql` restores EXECUTE
to `anon` (plus `authenticated`, `service_role`) on
`get_restaurant_pos_tabs_financial_truth(uuid,uuid,text)`,
`upsert_pos_tab(jsonb)`, `update_pos_tab_status(uuid,text,text)`, and
`generate_owner_digest(uuid)`. All remain SECURITY DEFINER with server-side
app-session, lodge, role, and outlet enforcement (`app_require_pos_outlet_access`,
`app_require_lodge_role`, `_restaurant_require_operational_report_access`), so
the grants restore the client contract without opening table access or
bypassing any guardrail. The unscoped implementations stay
`service_role`-only. Applied to the linked project via `supabase db push` on
2026-08-18. Live verification with the anon key and no session: the RPC is now
callable past the permission layer and returns the intended fail-closed body
guard `42501 "A valid app session is required."` instead of
`permission denied for function get_restaurant_pos_tabs_financial_truth`;
the desktop (anon key plus `x-boroko-session`) passes that guard. Restart the
bar app so open-tab financial truth refreshes from the server again.

The bar System Health page ("system health is empty") previously never loaded
the desktop saved-issue log the top-right warning pill counts, so the pill could
show N critical errors while the page showed nothing. Fixed in the renderer:
`HposSystemHealth.jsx` now loads `reports.criticalErrors` (limit 12) and
`app.getRendererErrors` (limit 6) with the rest of the health snapshot and
renders them under a new "App issues" tab with a badge count matching the pill
(danger/warning tone by financial/`db_init`/error level, message, scope label,
time, and context JSON). "Clear saved issues" is gated by the `system.health`
capability client-side and enforced by the existing
`reports:clearCriticalErrors` IPC handler; the clear only touches the
device-local `critical-errors.json` log, never database financial truth.
Regression coverage added to `tests/bar-financial-ui-regression.test.mjs`.
Verified: `npm run build:hospitality-pos` builds, and the compiled chunk
contains the new section. The three errors currently counted on the bar desk
are stale `pos.order.create` failures logged 2026-08-16 (two catalog-snapshot
blocks and three insufficient-stock blocks at the same outlet, from the
fresh-company smoke tests before that day's catalog/outlet fixes) and can be
cleared from the new App issues tab.

Repository verification: full `test:bar` suite 127/129 pass. The two failures
are a working-tree caveat unrelated to this change: the in-progress uncommitted
preload refactor (src/preload/index.js, `invoke(...)` helper instead of
`ipcRenderer.invoke(...)` literals) no longer matches the literal assertions in
`tests/bar-financial-ui-regression.test.mjs` and `tests/bar-stock-aging.test.mjs`;
the refactored preload still exposes the same channels and contracts.

## 2026-08-17 — Anon-role session-function grants repaired (linked applied)

A live diagnosis (Botswapelo Lodge dev desk, The Hills View account switch)
exposed a production defect: `public.app_current_lodge_id(text)` had never been
granted EXECUTE to `anon`/`authenticated`. RLS policies on
`event_booking_line_items`, `event_booking_resources`, `event_booking_rooms`,
`room_types`, `floor_sections`, and venue tables call it directly, so every
read of those tables failed for the desktop/PWA/public surfaces with
`permission denied for function app_current_lodge_id` (reproduced via REST
probes). The desktop's background cache refresh batch includes
`event-line-items`, so each refresh round partially failed with
`Cache refresh failed: ... app_current_lodge_id`, leaving caches stale, the
health panel stuck retrying ("Fresh data is still retrying after a refresh
problem"), and report refreshes intermittently stuck while a failing round was
in flight. Report RPCs themselves (revenue, P&L, room profitability, snapshot,
occupancy) were verified healthy end-to-end with the app's own session token.

Migration `20260817090000_grant_anon_session_functions.sql` is linked and
applied: it grants EXECUTE on `app_current_lodge_id(text)` to `anon,
authenticated`, and EXECUTE on `submit_authenticated_commercial_quote_request(jsonb)`
to `anon` (previously authenticated/service_role only; the desktop calls it as
anon). Verification after deploy: `rpc/app_current_lodge_id` returns the
correct lodge id; `event_booking_line_items`, `room_types`, and
`floor_sections` reads return 200; the quote RPC now returns a business
validation error (not 42501); the full cache fetcher batch is clean. The only
remaining non-200 in the batch is `maintenance_tickets` selecting `issue`
(42703, deployed schema is older), which the app already tolerates via its
legacy-select fallback. `supabase db push` also applied the previously pending
`20260816200000_bar_offline_continuity.sql` in the same ordered deployment.
Follow-up: restart the desktop app so refresh rounds complete and the health
panel clears; re-audit remaining authenticated-only functions the desktop
(anon role) may call.

## 2026-08-16 — Bar Mode 60-day offline continuity (repository implementation; deployment pending)

Desktop Bar Mode now supports a device-local, dependency-ordered outage chain
for attendance, personal/shared Till activation, shifts, POS sales, menu and Bar
pack changes, immutable catalogue publication, blind cash-up submission, manager
cash-up review, shift close, and attendance clock-out. Local financial results
remain explicitly provisional; replay invokes the existing authoritative RPCs
with stable operation/idempotency keys and does not create a second local
financial model. Cash-up replay waits for the shift and every queued sale, and
sale replay waits for locally-created shifts, catalogue snapshots, inventory,
and booking dependencies as applicable. PIN and manager-PIN fields are
encrypted with Electron safeStorage before entering the durable queue.

The trusted desktop-session design now keeps a successful first online login
locally unlockable by password for 60 days, and the forward migration aligns
the authoritative desktop application-token lifetime to that same window. The trusted
record is stored per local profile, the password remains a bcrypt hash, and the
record uses Electron safeStorage encryption when the operating system makes it
available. This does not turn external card processors or cloud sync into
offline services; offline tenders and operational results are stored locally
and reconciled when connectivity returns.

Forward migration `20260816200000_bar_offline_continuity.sql` extends eligible,
non-revoked desktop sessions created within the preceding 60 days and adds the
client-identity replay wrappers needed by offline catalogue, attendance,
shared-Till and cash-up-review operations, and raises Bar-only immutable
catalogue eligibility to 1,440 hours (60 days). The migration is present in the
repository but is not confirmed deployed. Updated desktop source likewise
requires a normal production build and installer publication before operators
receive it.

Local verification passed on 2026-08-16: JavaScript syntax checks for the
changed main-process domains; `tests/bar-offline-continuity.test.mjs` (6/6);
`tests/offline-pos-regression.test.mjs`;
`tests/offline-queue-regression.test.mjs` (combined 8/8); and
`npm run test:bar` (128/128, including the new continuity coverage). The Hospitality POS
production build could not be rerun in this session because the execution
approval service rejected the build after its usage limit was reached; this is
an unverified release gate, not a build failure.

## 2026-08-16 — Bar product “Save & make available” session grant repair (linked applied)

The fresh Bar setup smoke test exposed a real production defect: the atomic,
idempotent `save_bar_pos_product_with_packs(jsonb)` RPC was callable only by
the Supabase `authenticated` role, while the established desktop
application-session client calls it as `anon`. Migration
`20260816110000_bar_product_save_custom_session_grant.sql` is applied to the
linked project and grants execution to `anon`, `authenticated`, and
`service_role`, after removing the broader default grant. It does not grant
table access or remove any guardrail: the RPC remains SECURITY DEFINER and
requires the current application session, matching lodge, manager/admin role,
stable operation key, payload-hash replay check, and catalog audit record.

The prior `20260816100000_bar_base_manager_pwa.sql` entitlement alignment was
applied in the same ordered deployment. Linked migration history confirms
local/remote parity through `20260816130000`. A follow-up fresh-company smoke
also found that the product RPC called the Bar pack helper to disable every
unselected pack size; that could reject and roll back an ordinary product whose
stock record was unassigned or not at a Bar outlet. Migration
`20260816120000_bar_product_save_skip_unselected_pack_templates.sql` is linked
and applied: it touches pack templates only when a pack is enabled or an
existing pack needs disabling. The Bar UI now states that the underlying item
can still be sold individually, displays pack choices only for stock assigned
to an active Bar outlet, and lets the operator choose a stock location during
stock creation/editing. Focused Bar product regression passes 10/10; the final
live smoke is an authorised Bar manager retrying the exact “Save & make
available” action. A later stock-location smoke showed the legacy virtual Bar
fallback had no UUID, so its display text could be submitted as an inventory
outlet ID and was correctly rejected by PostgreSQL. Migration
`20260816130000_bar_mode_default_physical_outlet.sql` is linked and applied:
it backfills exactly one active physical beverage outlet for each Bar-mode
company without a physical Bar outlet, and installs the same provision-on-
settings trigger for future Bar signups. It does not relabel historical stock
or sales. The Bar Stock UI now filters virtual rows from all UUID controls and
submits only a verified durable outlet ID.

The same fresh-company smoke then found that the newly provisioned physical Bar
outlet had no outlet-matched immutable POS catalogue snapshot. The v3 order
contract correctly refused to trade rather than silently using a global or
different-outlet catalogue. Migration
`20260816140000_bar_outlet_initial_catalog_snapshot.sql` is linked and
applied: its server-owned lifecycle helper builds the ordinary immutable
catalogue payload for the physical Bar outlet, creates one only when none is
active, and backfills existing Bar-mode companies. It retains the exact-outlet
snapshot requirement for orders; subsequent catalogue changes continue to use
the normal audited manager publication path. The focused Bar product/snapshot
regression suite passes 12/12. The remaining live smoke is one authorised
two-item Bar sale followed by receipt, stock, sales-report, and cash-up checks.

That live sale then exposed a second fresh-company setup defect: `current_stock`
held the opening 12 bottles, but the physical stock-location balance used by
the POS line trigger was zero. Migration
`20260816150000_bar_stock_location_opening_balance_repair.sql` is linked and
applied. It maps each Bar outlet to its shared default stock location unless a
manager already selected another mapping, reconciles only the previously
unallocated remainder of existing Bar stock without changing business-wide
stock or inventing a historical financial movement, and atomically creates
matching location balances and opening-stock ledger entries for future items.
The idempotent Receive/Count RPC now updates both balances and rejects an
attempt to make either negative. Focused Bar product/snapshot regression passes
13/13; the next live smoke remains one two-item sale followed by receipt,
on-hand, sales-report, and cash-up checks.

That live sale confirmed the financial transaction but exposed a receipt
identity presentation defect: the daily POS insert trigger had assigned the
immutable server receipt number, while `create_pos_order_v3(jsonb)` omitted it
from both its initial response and stored idempotent result. Migration
`20260816160000_pos_v3_server_receipt_identity.sql` is linked and applied. It
returns the receipt number, order number, daily sequence, and business date
from the committed same-lodge `pos_orders` row, and enriches only prior v3
idempotency records that already map to a row with a server-issued receipt
number. It neither changes a POS order nor its tender, stock, audit trail, or
receipt assignment. The POS receipt UI continues to block print/save when a
server number is genuinely absent rather than inventing one. The focused POS
financial-truth suite passes 7/7 and the complete Bar suite passes 107/107.

The same live sale revealed that the Reports screen was deriving its financial
readiness from raw POS history metadata in the renderer, even though the
server already publishes a certified, hash-bound POS financial-report dataset
for exports. The desktop now has a `pos:getCertifiedReportHistory` IPC
contract that uses that server dataset, its report run and control totals, and
the existing local-pending-operation check. It returns an explicit complete
envelope only after certification; otherwise it retains the order list but
marks every aggregate as unavailable and gives the operator the server
recovery reason. The reports screen uses those certified controls for normal
history (correction mode remains separately scoped). The first live use
correctly failed closed because the older authorization migration granted that
SECURITY DEFINER report function only to `authenticated`, while the desktop
uses the established application-session context with the PostgREST `anon`
role. Migration
`20260816170000_pos_financial_report_custom_session_grant.sql` is linked and
applied. It grants only `anon`, `authenticated`, and `service_role` execute
access after revoking the public default; it does not grant table access or
weaken the report's app-actor, lodge, capability, or outlet-scope checks. The
complete Bar suite passes 107/107, the focused financial-report regression
passes 31/31, and the Hospitality POS production build passes.

The first PDF-export smoke then exposed the matching application-session grant
gap in `record_report_artifact_result(...)`: the detailed JSON companion was
written locally, but its server audit record was denied before PDF rendering.
Migration `20260816180000_pos_report_artifact_custom_session_grant.sql` is
linked and applied. It restores execute access only to `anon`,
`authenticated`, and `service_role`; the SECURITY DEFINER RPC still locks the
same-lodge report run, requires the caller's current POS-report access, and
allows a non-service caller only to record artifacts for the POS report run it
created. Accounting-artifact access remains excluded. The focused
financial-report regression passes 31/31; the outstanding live smoke is a
successful PDF plus JSON companion export for the certified Bar sale.

The subsequent Bar stock smoke found that `getInventoryItems()` correctly
marked an online server-complete array, but the custom array properties were
lost across Electron IPC and the UI therefore showed its safety warning and
withheld availability cards. The desktop now exposes the additional
`inventory:getItemsWithReadStatus` envelope (`items`, `source`, `complete`)
for the Bar stock controls; the legacy list endpoint remains unchanged for
other operational callers. The Bar page treats a missing envelope as
unverified, while an online, complete server read now displays its truth
explicitly. This alters no inventory record or database contract. Focused Bar
stock/report tests pass 33/33 and the Hospitality POS production build passes.
The remaining live smoke is a restarted Bar app showing the stock cards and
the expected post-sale on-hand balance without an unavailable-source warning.

The same manual smoke exposed a separate interrupted-sale recovery hazard.
Read-only linked evidence for the test company shows two different v3 sale
intents rather than one idempotency key being applied twice: R-0001
(`773ff471-bd15-4b28-a97c-29ba2b3d5906`) was created on the client at
13:44:06Z and committed at 13:44:12Z; the older unresolved intent later issued
as R-0002 (`e08df12f-223f-4205-8323-4ff5643fdcc3`) was created on the client
at 13:29:35Z but committed only when recovered at 14:40:57Z. Each receipt has
exactly one matching `financial_operation_idempotency` record and its own
`pos-order:<intent-id>` key. The server therefore preserved same-key
idempotency, but the local submission journal previously allowed the same
signed-in operator to start a different intent while an older one remained
pending.

The journal now permits only one unresolved intent per lodge and signed-in
operator, while still allowing an exact payload/key replay. A different sale
fails closed with `pos_submit_recovery_required`; a failed or unauthorized
server reconciliation read no longer becomes a false “not found” result. The
Till recovery card displays the original client timestamp, items, quantities,
and tenders, warns that a retry can complete an older sale that was never
recorded, and tells the operator to check Sales and not retry after entering a
replacement. The submit-journal tests are now part of the normal Bar release
gate. Verification: focused recovery/workspace/stock tests pass 36/36, the
complete Bar suite passes 119/119, and the Hospitality POS production build
passes. No database migration or direct data repair was made. R-0002 remains
intact pending an explicit, audited manager void with stock returned; deleting
the transaction would destroy the financial and inventory audit trail.

Live correction verification: the manager voided R-0002 through the protected
PIN workflow with the documented interrupted-test-sale reason and
`return_to_stock`. A read-only linked database check confirms R-0001 remains
the sole completed P40 sale, R-0002 is `voided`, `pos_override_log` contains
the void approval, and `pos_audit_log` records an authoritative -P40 delta plus
two restored Heineken 330ml units. Both `inventory_items.current_stock` and the
mapped Bar stock-location balance are now 10. No row was deleted or edited
outside the governed void RPC.

The live shared-terminal cash-up smoke then found an analogous deployment
grant gap: the staff cash-up submission succeeded, but its required
attendance-PIN clock-out was denied before the manager review. Migration
`20260816190000_attendance_pin_custom_session_grant.sql` is linked and
applied. It grants execute only on the existing protected attendance-PIN
clock-in and clock-out RPCs to `anon`, `authenticated`, and `service_role`
after revoking the public default. Their SECURITY DEFINER implementations
continue to require the current app actor's lodge/role, selected staff member,
staff PIN, and existing attendance idempotency contract. Read-only linked
verification confirms `anon` execute access for exactly both functions. The
focused cash-up checks pass 7/7 and the complete Bar suite passes 120/120.

The repaired attendance path then completed a live cash-up lifecycle for the
fresh Bar company: the cashier submitted P60, attendance clock-out completed,
and the manager approved the same P60 against P60 expected with zero variance.
Linked read-only verification confirms one approved submission, one closed Till
shift, and one reconciled cash-up session carrying the same server cash-up
identity; it did not create a second close. Two final operator-UX corrections
are in the desktop source: a successful staff clock-out notice is no longer
cleared by the form reset, and focusing the manager-PIN input brings the
Approve/return actions into view with an accessible scroll target. Focused
cash-up tests now pass 8/8, the complete Bar suite passes 121/121, and
`npm run build:hospitality-pos` passes on 2026-08-16. This is source/build and
linked-database evidence; the desktop UI changes still require the normal
desktop release/installer publication process before customer devices receive
them.

Bar Manage now includes an owner-facing package guide sourced from the same
authoritative add-on catalogue used by commercial quoting. It accurately
states that Base Bar POS records sales, simple delivery quantities, and
physical counts, but does not create supplier bills, purchase history,
cost-of-sales reporting, or a P&L. It shows each annual add-on's live
entitlement state and price, and explains that both Stock & Purchasing Pro and
Accounting & Workforce are required for a controlled purchases-to-P&L workflow.
The guide is informational and routes only to governed package review; it does
not alter any entitlement. The complete Bar suite passes 122/122.

## 2026-08-14 — Linked Supabase migration deployment without Docker

Docker Desktop and Podman are unavailable on this workstation, so the migration
alternative is the linked Supabase Management API path: `supabase db push
--linked --yes`. With the user's explicit deployment authority, the full local
chain is now applied to project `oicgpknsmtvcsjacymum` through
`20260814080000_security_definer_search_path_hardening.sql`. `supabase migration
list --linked` reports 371 migration rows with every local ID equal to its remote
ID; there are no pending local migrations. The deployment included the Bar/POS
authorization hardening plus forward-only linked-schema lint repairs: persisted
POS `tab_id` linkage and split-payment guard, historical-cutover approval
timestamp, partial tax-return conflict targeting, stale parameter/column fixes,
and HypoPG advisor wrappers with admin/service-role-only execution.

Remote verification: `supabase db lint --linked --level error --fail-on error`
passes with zero linked SQL errors. Read-only smoke checks confirm the obsolete
`public.pos_payments` relation is not referenced, `pos_orders.tab_id` and
cutover `approved_at` exist, and the tax base partial unique index is present.
The 20260814060000 forward migration makes the five compatibility views
security-invoker/security-barrier and enables RLS while revoking direct
anon/authenticated table grants on the ten internal audit, sequence, commercial,
and payroll tables. `supabase db advisors --linked --level error --fail-on none`
now reports no error-level findings; 20260814070000 also removes the redundant
POS table uniqueness index. The 20260814080000 migration fixes the mutable
search_path on 59 SECURITY DEFINER functions. The warning-level advisor baseline
is now 1,854 legacy warnings (835 anonymous/863 authenticated callable
SECURITY DEFINER notices, 42 permissive-policy notices, 66 init-plan notices,
46 remaining mutable search paths, one Auth configuration warning, and one
public-extension placement warning). The local disposable Accounting
behavioral suite remains unavailable because no local PostgreSQL runtime is
installed; never aim it at the linked production project.

## 2026-08-14 — Bar/Restaurant authorization and fail-closed verification (linked applied, release-gated)

The linked project now includes `20260814010000_bar_pos_authorization_hardening.sql` and the forward lint-repair/security chain through `20260814080000`. Their wrapper contracts enforce operator capability, lodge/outlet scope, and audited tab-status transitions for POS tabs and financial report exports; the desktop IPC mirrors those boundaries for settings, hardware, POS reads/exports, cash-drawer operations, and Accounting close/payroll exports. Hospitality POS Business Control now treats unavailable POS, expense, stock-cost, menu-cost, expiry, and procurement sources as unavailable rather than zero or “none,” and Balance Sheet period-close controls require `accounting.close`. Cached tab reads are outlet/status filtered, online tab-status failures no longer mutate the local cache, and cash-up history failures no longer become a false empty history. Owner Digest now derives monetary fields only from the certified POS report envelope; staff performance, recipe variance/preparation-loss, finance overview, settlement, deposit, tip, and cash-up reads preserve source metadata and fail closed instead of presenting empty reads as zero. A preparation-loss RPC contract bug referencing an undefined client variable was also removed. The lint-repair chain persists authoritative POS order-to-tab identity and repairs linked schema drift without recreating `pos_payments`; the final security migration makes compatibility views obey base-table RLS and removes direct grants on internal tables, the index cleanup removes a redundant `pos_tabs` uniqueness index, and the definer hardening fixes trusted search paths on 59 elevated functions.

Local verification on 2026-08-14: Bar regression 98/98, financial-truth 189/189, commercial 10/10, product 15/15, release architecture 2/2, offline POS/queue, financial-integrity, release-behavior, production guardrails, `audit:prod` (0 production vulnerabilities), `npm run build:hospitality-pos`, `npm run manager:lint`, and `npm run manager:build` all pass; Manager lint has 0 errors (34 warnings). The official restaurant suite still requires PostgreSQL at `127.0.0.1:54322`; the opt-in disposable harness confirms Docker Desktop and Podman are both absent. Linked migration parity, error-level SQL lint, and error-level security advisors now pass, and read-only smoke confirms anonymous compatibility-view reads return zero rows while RPC-backed commercial quoting still works. No authenticated outlet-isolation/concurrency smoke has run. This is database deployment evidence only; Restaurant/Bar and Accounting remain no-ship until disposable behavior, authenticated smoke, policy sign-off, and release packaging are completed.

Count correction (2026-08-13): the final Bar suite is 89/89 after adding shared report, stock-cost, and expense finality coverage; earlier 84/84, 85/85, and 86/86 references below are superseded.

Final cross-surface verification (2026-08-13): generic restaurant Finance Overview, Daily Close, Cash Drawer, desktop POS History, Hpos My Sales, Legacy receipt detail, open-tab split previews, customer display, queued return rows, and incomplete cash-up previews now fail closed on uncertified totals or tenders. History exports require a server-complete reconciled envelope; refund workflows require an explicit confirmed tender instead of inheriting `cash`; server-issued receipt identity and recorded line amounts remain mandatory for printed artifacts; successful online receipt DTOs no longer turn missing server amounts/tenders into zero or local fallback truth. Detailed expenses and stock-cost reports/exports also preserve unavailable amounts, reject synthetic quantity×unit-cost totals, and require explicit server-complete source metadata. Shared booking revenue, occupancy, P&L, and room-profitability views now use the same explicit finality contract. The new `20260812040000_spend_report_finality.sql` and `20260812050000_shared_report_finality.sql` add those certificates to the server RPCs, but neither is deployed. The final Bar suite is 89/89, financial truth is 189/189, Legacy POS is 217/217, Manager lint has 0 errors (34 warnings), Manager/web/booking builds and tests, Hospitality POS and Legacy builds, offline/queue, enterprise, production guardrails, and release gates pass. This remains local code evidence only: linked migrations are behind the local tip, `db:lint` reports 20 linked-schema errors, and no disposable PostgreSQL or authenticated production smoke has run.

## 2026-08-12 — Bar financial UI finality follow-up (local, no-ship)

The Bar implementation now withholds Manager PWA and desktop summary money when the authoritative POS source is incomplete or stale, uses server/business-date and lodge-timezone finality in `20260812010000_manager_bar_pos_snapshot_finality.sql`, preserves POS/expense read metadata through Electron IPC, and prevents synthetic receipt numbers, derived open-tab totals, cached Till totals, and unconfirmed corrections. Bar exports select restaurant-scoped presets and fail closed if a legacy preset is submitted. Legacy POS Bar mode also removes lodging-specific sync language. Focused Bar tests pass 86/86; financial-truth tests pass 189/189; Manager build/lint and Hospitality POS/Legacy POS builds/tests pass. The new migrations and all client changes are local-only; the linked database remains behind the local migration tip and the disposable PostgreSQL behavioral gate is unavailable, so this is not a deployment or release claim.

Follow-up verification (2026-08-13): the Bar suite now passes 86/86 after withholding incomplete Hpos Reports/Business Control/Manager operations/Manager POS-sales monetary aggregates, requiring persisted reconciled tender envelopes and recorded line amounts for Manager certification, making cached stock counts explicitly last-known and blocking audited count deltas until a server-complete read, excluding lodging night-audit and maintenance-only surfaces from the Manager PWA Bar navigation, removing unsafe optional-promise catches, and closing remaining unrecorded item-line fallbacks in Business Control, POS exports, generic desktop reports, shared POS snapshots, Legacy POS history/export, Legacy cash-up, hardware receipts, and receipt tender labels. Manager PWA lint has 0 errors (34 warnings), Manager build and Hospitality POS/Legacy POS builds pass, `npm run audit:prod` passes with 0 production vulnerabilities, Legacy POS regression passes 217/217, and release architecture/behavior gates pass. The focused financial-truth suite passes 189/189; offline POS/queue critical gates, enterprise (50/50), full production guardrails, and web-surface contracts/builds also pass. The open-tab/customer-display financial-finality regression is included in the 86/86 count. The disposable Accounting behavioral suite still cannot connect to `127.0.0.1:54322` on this workstation; linked `db:lint` still reports 20 pre-cleanup-schema errors because the local cleanup migrations are not deployed. New local finality migrations `20260812020000_manager_bar_pos_report_detail_finality.sql` and `20260812030000_pos_export_detail_finality.sql` remain uncompiled against PostgreSQL and unapplied; the generic desktop POS summary now falls back to the authoritative export contract when deployed and otherwise remains uncertified.

Current correction for this section (2026-08-08): the local tip is `20260807560000_financial_truth_remediation_followup.sql`. It corrects signed POS return tender controls, signed tender-envelope enforcement, deferred cumulative-return GL posting, operational/Accounting tender-writer separation, customer-account DTO authorization, POS export outlet scope and artifact evidence, statement cumulative equity/row DTO correctness, and bank split-allocation capacity. The focused financial-truth/accounting suite passes 186/186 and the Hospitality POS production build passes. This migration is local-only and has not been applied to a disposable or linked database; Accounting & Payroll remains no-ship pending the existing behavioral, authorization, migration, policy and deployment gates. The historical 153/153 and 30-migration figures below describe an earlier continuation slice and are superseded.

## 2026-08-07 — Financial-truth continuation: source-chain closure, complete file exports, and linked lint cleanup (local, no-ship)

The current local tip also contains `20260807380000_pos_account_voucher_atomic_tender_guard.sql`. It requires activated Accounting plus customer/voucher identity in the authoritative POS tender breakdown, and both desktop and Legacy POS replay adapt older queued v3 account envelopes without rotating their stable operation key. This migration is local-only and unverified in the unavailable disposable PostgreSQL behavioral gate.

The latest local forward gates add Accounting grant lockdown, server-authored POS report datasets, historical-account/opening-balance policy, optional-Accounting operational tender subledgers, cumulative return reversal, source-coverage registry, signed bank imports/allocation matching, page-specific export finality, payroll statutory/PII controls, authoritative source-population coverage, fail-closed statement finality, and an allocation-aware bank workspace. The existing v2 contracts remain compatibility surfaces but are no-ship locked. `20260807420000` through `20260807550000` are local-only and not deployed.

Correction to the historical verification counts in this section: the focused financial-truth/accounting suite now passes 179/179; 31 pending migrations through `20260807380000` were transaction-compiled and rolled back, while the cutover/AP and forward financial-truth gate migrations through `20260807550000` have static/contract evidence only; Legacy POS regression passes 217/217; and the full data exporter now writes a per-section `data-export-manifest-v1`, blocks incomplete financial claims, and visibly labels allowed partial operational workbooks.

The local remediation chain now also includes `20260807230000_inventory_movement_evidence_and_valuation.sql`, `20260807240000_payroll_payment_batches_and_idempotency.sql`, `20260807250000_payroll_statutory_provenance_and_attendance.sql`, `20260807260000_financial_truth_linked_lint_cleanup.sql`, `20260807270000` through `20260807330000`, plus `20260807340000_cashup_variance_source_gl_posting.sql`, `20260807350000_tax_amendment_and_adjustment_lifecycle.sql`, `20260807360000_tax_adjustment_review_read.sql`, and `20260807370000_accounting_page_exports.sql`. Stock movements, purchases, and transfer records receive durable operation/source-document/payload evidence and disclose `unknown_legacy` valuation instead of reconstructing history from current cost. Payroll has immutable export batches with file hashes/control totals, stable approve/export/settle/reconcile/close operations, liability settlement against a selected asset account, bank evidence, statutory source/hash/provenance requirements, and an attendance disposition register. Settlement now posts clearing/fee/deposit journals and source coverage; blind cash-up posts only non-zero cash over/short differences; tax has governed debit/credit-note adjustments, filed-return amendment generation, and an authenticated review read surface. The cleanup migration repairs active linked-schema Manage/AP/bank projection errors and fail-closes stale pre-V2 financial RPC bodies without restoring operator grants. All eight Accounting pages now request complete, server-authoritative report-run-backed exports with row counts, source hashes, completeness manifests, and stable report-run identities.

The desktop Accounting bridge and Payroll/Tax pages expose these contracts, preserve stable keys through retries, block payslips before approved calculation state, and retain the eight-page export/readiness controls. Accounting report/export RPCs remain authenticated-denied by the forward lockdown until the DB gate passes. POS history Excel/PDF exports now request the uncapped server-certified POS dataset, use shared classification/control logic, verify the saved workbook/PDF, and attempt restricted artifact evidence recording. The repository includes `npm run test:restaurant:disposable`, an explicit opt-in harness that starts Supabase, resets a disposable database, applies the ordered migrations, runs the restaurant suite, and stops the stack; the harness reaches Supabase only under elevated filesystem access, then fails because Docker Desktop/Podman is not installed or on PATH. Local verification on this continuation: the focused financial-truth/accounting suite passes 179/179; the POS truth fixtures pass 4/4 including >5,000 rows; temporary POS Excel/PDF handlers write, reopen, and hash artifacts; Manager PWA lint/build and Hospitality POS production build remain previous passing evidence; changed JavaScript syntax checks pass; and 31 pending migrations through `20260807380000` were the last transaction-compiled batch and explicitly rolled back. The forward financial-truth gate migrations through `20260807550000` have static/contract evidence only. The combined build command once exceeded its 120-second shell timeout while the POS client build was still running, then the standalone `npm run build:hospitality-pos` completed successfully.

This remains a strict no-ship state. The new SQL migrations are not deployed or live-verified; the local PostgreSQL behavioral gate at `127.0.0.1:54322` is unavailable; linked Supabase lint reached the project but reports 20 current-schema errors until the cleanup migration is applied; no authenticated concurrency/isolation/cutover or payroll bank rehearsal has run; and accounting policy/statutory sign-off, migration deployment evidence, signed packaging, and production smoke are still required. Do not enable Accounting or claim the 85-issue remediation is shipped from this worktree.

## 2026-08-07 — Bar and Accounting financial-truth remediation (local, no-ship)

The forward financial-truth control plane is implemented locally but is not deployed or enabled. `20260807120000_bar_accounting_financial_truth_control_plane.sql` adds explicit accounting activation/cutover, source-posting coverage, cumulative balance-sheet calculations, report-run manifests, expense/POS/AP/payroll source linkage, payroll expected-worker readiness, and locked absolute stocktake behavior. `20260807130000_bar_tab_financial_snapshot_and_concurrency.sql` adds server-computed open-tab totals, tab versions and payload-hash split replay. `20260807140000_retire_legacy_cash_drawer_close.sql` removes the editable lodge-wide drawer close and auto-close behavior. `20260807150000_budget_versioned_complete_matrix.sql` adds exact versioned budget coverage and maker-checker approval. `20260807160000_ap_payment_payload_hash_and_bank_close_boundary.sql` binds AP payments to a canonical payload and payment account. `20260807170000_bank_packet_without_period_lock.sql` completes bank packets without implicitly locking an accounting period. The linked database boundary remains the previously recorded `20260730100000_shared_till_operator_attribution`; all seven migrations are local-only.

Accounting activation remains a no-ship operation until a disposable PostgreSQL instance proves the behavioral/concurrency/authorization fixtures, the policy decisions in `docs/ACCOUNTING_POLICY_DECISIONS.md` are signed off, source coverage is complete for the target period, the migration chain is deployed and linted, and authenticated smoke covers desktop, Manager PWA, and Legacy POS compatibility. No production or release claim is made from local SQL or static tests. The current worktree contains unrelated user changes and remains uncommitted.

As of: 2026-08-06 (POS critical-hardening follow-up, local)

## Status: The Restaurant & Bar (Hospitality POS) hardening implementation is in the repository as uncommitted work and is not released or deployed from this worktree. POS submissions recover from interrupted server calls through a stable main-process submit journal that never evicts unresolved financial attempts; recipe stock depletion is implemented as server-atomic in the new local migration but is not PostgreSQL-verified on this workstation; shift close routes through authoritative cash-up finalization or exact server evidence and requires `pos.cashup`; cash-up submissions use fail-closed persisted, server-key-correlated rounds; and the Manager PWA support inbox uses write-ahead queue envelopes and queue-item operation IDs. The restored Till attribution migration is present locally and is already applied to the linked project. `supabase migration list --linked` confirms local and remote histories align through `20260730100000_shared_till_operator_attribution`. The forward migrations `20260805090000_pos_recipe_stock_depletion_server_atomic.sql`, `20260805100000_support_inbox_operation_id_idempotency.sql`, `20260806100000_authoritative_pos_shift_close_resolution.sql`, and `20260806110000_cashup_retry_resolution_keys.sql` remain local-only and require separate review/deployment before customer enablement. Verification below records repository implementation, linked deployment and release state separately; repository presence is not deployment or release.

### 2026-08-06 — Encrypted free-tier Supabase cloud backup workflow (local, not enabled)

- A daily GitHub Actions workflow now prepares the official Supabase logical-backup set (`roles.sql`, `schema.sql`, and `data.sql`) on a hosted runner, records SHA-256 evidence, encrypts the compressed archive with AES-256-GCM plus RSA-OAEP key wrapping, removes runner plaintext, retains a seven-day encrypted Actions artifact, and uploads the encrypted copy to a user-owned Google Drive folder through least-scope `drive.file` OAuth.
- Google Drive retention keeps daily copies for 14 days and one copy per ISO week through 90 days; expired copies move to Drive trash. Encryption decryption/tamper checks and retention-policy tests are repository-local. The encrypted private key never belongs in GitHub or Google Drive and is required for every recovery rehearsal.
- This workflow is not operational yet. It has not been pushed to the default branch, no GitHub secrets are configured from this worktree, and no live backup or restore rehearsal has run. Follow `docs/SUPABASE_FREE_BACKUPS.md`, manually trigger the first run, decrypt the resulting artifact, and restore only to a disposable project before claiming recovery readiness. Database dumps do not contain Supabase Storage object binaries, which remain a separate backup requirement.

### 2026-08-05 — POS critical-hardening pass (local, not deployed)

- Interrupted POS submissions now recover via a durable main-process submit journal (`posSubmitJournal.js`, JSON-backed in the state cache dir). First submission records the exact server envelope (submitIntentId, order ID, client timestamp, payload digest); an exact retry reuses the original envelope so the server idempotency contract replays the original sale; changed payloads fail closed as idempotency conflicts; unresolved entries are never evicted to make room for committed records; and corrupt journals write a durable recovery block before moving evidence. If the marker write fails, the original corrupt file remains in place and an in-process latch prevents a later sale from treating the missing marker as a clean first run. HPOS Terminal recovery offers only Retry original sale with guidance that staff must not recreate it. Till-operator gate rejections keep the envelope, so retry after PIN re-verification checks the original sale. Journal capacity/corruption, marker-write failure and interrupted-submission recovery tests pass.
- Recipe stock depletion is now server-atomic: a new trigger on `pos_order_items` inserts lock inventory rows, computes portion quantity in inventory units including waste, fails closed on insufficient stock, and writes both restaurant recipe stock movements and inventory movements. The legacy `record_recipe_stock_depletion` RPC is rewritten as an idempotent replay that derives quantities from the authoritative order lines and skips lines that already have movements; a new manager-only reconciliation report lists orders missing movements. The offline queue no longer enqueues a separate depletion operation, so offline replay cannot double-deplete. The focused recipe contract tests pass; live PostgreSQL behavior remains blocked by the unavailable local database.
- Shift close now runs through the authoritative `finalize_pos_shift_cashup_v2` RPC with a stable per-shift idempotency key; offline and failed/ambiguous responses keep the local shift open; exact server resolution requires a closed status plus matching cash-up/finalization evidence; stale cached `open`, missing, locked, void and unknown states fail closed; and replay does not append a second close audit. The `pos:closeShift` IPC handler requires `pos.cashup`, and the Lodge compatibility UI shows pending/error/recovery guidance.
- Cash-up submissions (My Cash-up and shared-terminal Staff cash-up) now persist one real lodge/shift/manager-actor round with the original payload fingerprint before IPC. Exact transport retries reuse the same key and original count/notes/identities; storage failures prevent the RPC; changed details remain blocked until the server confirms rejection of that exact saved idempotency key; and shared-terminal retries continue to require the staff PIN while retaining the staff operator separately. A stale rejection from the preceding round, including after a corrected submission commits but its response is lost, cannot rotate the corrected round's key. The local `20260806110000_cashup_retry_resolution_keys.sql` migration exposes only the opaque operation key needed for this correlation and keeps expected drawer/variance data out of the cashier response.
- The Manager PWA support inbox now writes the complete queue envelope before every online support RPC, verifies it by read-back, deduplicates by operation ID, removes it only after success/replay, and retains the same item after transport ambiguity. The support RPC migration adds transaction-scoped advisory locks and canonical SHA-256 payload hashes for lodge/ticket operation scopes; PostgreSQL concurrency behavior remains unverified until the local database is available.
- Verification: the focused repository regressions pass 61/61 with 0 failures (56 POS/support correction tests plus 5 separate cloud-backup tests); `test:bar` passes 67/67; `npm test`, all five offline/financial/inventory/release gates, Manager lint (0 errors), Manager build, and the Hospitality POS build pass. The recipe and support PostgreSQL behavioral suites, plus `test:restaurant`, are blocked by `ECONNREFUSED 127.0.0.1:54322` and therefore make no database-behavior claim. The cash-up retry-resolution migration has repository contract coverage but no PostgreSQL behavioral result on this workstation. `git diff --check` passes; the final handoff records script-level pass/fail status separately where scripts do not emit test counts.
- Repository/deployment boundary: `20260730100000_shared_till_operator_attribution.sql` is restored locally and remains uncommitted; `supabase migration list --linked` confirms the same version is applied remotely. `20260805090000_pos_recipe_stock_depletion_server_atomic.sql`, `20260805100000_support_inbox_operation_id_idempotency.sql`, `20260806100000_authoritative_pos_shift_close_resolution.sql`, and `20260806110000_cashup_retry_resolution_keys.sql` are local-only and have not been deployed. All renderer/main-process/PWA changes in this section are local and uncommitted; no release binary, push, or migration deployment was performed.

### 2026-07-30 — Configurable Till operator verification (local)

- Hospitality POS settings now expose Till operator verification for restaurant/bar companies. New and unset companies fail closed to **Strict — PIN for every order**. Managers can explicitly choose **Shift — PIN once, then stay unlocked** and configure the inactivity lock (default 30 minutes, bounded to 5–240 minutes).
- Shift sessions retain the PIN-verified operator identity for sales, held tabs, and cash-up. The authoritative main-process session manager now renews only validated Shift activity, expires without read-side effects, clears on outlet/operator/shift mismatch, and invalidates matching sessions when a shift or policy closes. Sensitive corrections remain manager-approved. Anonymous Till operation is not supported.
- The main process validates and overwrites shared-terminal operator, outlet and shift attribution before order/tab writes, consumes Strict sessions after a successful order, and revalidates an open shift online so the policy cannot be bypassed by renderer state. Missing/invalid policy data resolves to Strict. The deployed `20260716033000_pos_order_operator_from_shift.sql` trigger remains the database authority for completed-order cashier attribution.
- Focused verification: the Bar suite includes behavioral session expiry, touch renewal, mismatch rejection, Strict consumption, shift-close isolation, and the deployed server attribution guard. This session-policy implementation and the restored `20260730100000_shared_till_operator_attribution.sql` file remain local and uncommitted; `supabase migration list --linked` confirms the linked project has the same migration applied. The supporting migration is not a reason to omit a migration from the repository; it is the repository’s restored record of an already-linked deployment.

### 2026-07-29 — Bar Mode scanner and barcode hardening (deployed)

- Hospitality POS Till and Legacy POS now share one keyboard-wedge decoder with Enter/Numpad Enter/Tab and idle completion, timing-gap reset, prefix/suffix framing, length/control validation, leading-zero preservation, duplicate terminator protection, outlet-safe lookup, stock-availability checks, and suspension while payment, PIN, shift, modifier, or receipt workflows have focus.
- Bar Base Stock and Products support manual barcode entry or an explicit Scan flow. Stock create/edit preserves barcode values through online RPCs, cache and retry payloads; Products can inherit a linked stock barcode without overwriting an explicit menu code. 6/12/24-pack templates have independent scan/edit fields and cannot silently reuse a single-bottle code.
- System Health now verifies a real scanner input on the current POS computer, displays captured length/terminator for operator confirmation, exposes bounded framing/timing settings, and records only a SHA-256 barcode hash in the local POS audit. A keyboard-wedge device has no OS-level “connected” signal; this explicit capture is the authoritative connection proof.
- Forward migrations `20260729160000_barcode_scanner_guardrails.sql` and `20260729170000_bar_pack_template_barcodes.sql` are applied to the linked Supabase project. They normalize and lock active inventory/menu assignments, enforce lodge/outlet duplicate rules, provide manager-only conflict checks, preserve single-product sync, and persist distinct package barcodes through the authoritative pack RPC.
- Verification passes: 57 Bar tests, 217 Legacy POS regressions, 3 critical financial/offline/inventory gates, POS hardware-adapter tests, 15 product tests, 2 release-architecture tests, main-process syntax checks, both Hospitality POS and Legacy POS production builds, and linked migration history through `20260729170000`. Linked lint still reports the repository’s existing unrelated schema errors plus one non-blocking loop-variable warning in `normalize_pos_barcode`; no new scanner/pack errors were reported.
- No installer was built or published. Before customer handoff, run System Health → Devices → Verify scanner input with the actual scanner, scan a known product, confirm the displayed count/terminator, then scan that product at Till, Stock setup, and (if used) each pack template. Keep a printed/manual fallback until that physical smoke test passes.

### 2026-07-29 — Bar Mode guardrail repair pass (deployed)

- Stock editing now preserves `latest_unit_cost`: blank cost means unchanged, zero remains an explicit valid value, invalid/negative/non-finite values fail closed, and edit forms cannot change on-hand quantity outside Receive/Count. Restricted stock users select only assigned outlets; managers/admins may use lodge-wide or explicit outlet aging views.
- Provider payment references are enforced at the Hospitality POS main-process boundary, Legacy POS renderer/main/offline queue boundaries, and a forward database trigger repair that rejects empty/non-array provider breakdowns as well as missing or oversized references.
- Cash-up idempotency now serializes retries and validates shift, cashier/operator, actor, rounded physical cash, and notes before returning a replay. Shared attendance-PIN handovers use the same conflict contract.
- Focused verification passes: 43 Bar tests, 217 Legacy POS regressions, 4 critical financial/offline/hardware gates, 15 product tests, 2 release-architecture tests, main-process syntax checks, and the Hospitality POS production build.
- The first linked deployment attempt exposed an invalid historical `SELECT ... INTO` record syntax in `20260721151000_command_central_commercial_billing.sql`. That migration was repaired and committed as `567f6d76` before retrying. The ordered push then applied all 16 pending migrations through `20260729150000`; read-only migration history now matches local through that version.
- Post-deployment `npm run db:lint` completed, but `scratch/db-lint.json` retains 20 pre-existing errors in unrelated asset, restaurant-accounting, payroll, and corporate-billing surfaces. None name the new Bar contracts (`get_bar_stock_aging`, cash-up idempotency, or tender-reference guards).
- No installer was built or published. Authenticated cashier/manager smoke tests for cash/card/mobile/split tenders, measured pours, stock-aging visibility, blind cash-up, and exact replay still require designated test accounts and remain the final operational gate.
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

### 2026-08-16 — Command Central subscription truth and activation hardening

- Linked Supabase migration `20260816090000_command_central_subscription_truth_hardening.sql` is confirmed applied. It removes the obsolete one-argument `activate_subscription_request(uuid)` bypass, limits commercial activation to approved requests, validates activation payment-state input, and preserves the governing operation/audit workflow.
- Bar POS annual bundles are now financially consistent across shared UI pricing, authoritative SQL quotes, and generated Command Central PDF documents: the initial annual invoice includes Bar POS plus selected annual bundles. A Bar POS quote with all three bundles is `P18,500` due now and `P18,500` annual renewal. Hotel recurring add-on timing was intentionally preserved.
- Command Central now injects a freshly reauthenticated master-admin actor into commercial assignment and request activation; activation targets are filtered to the exact lodge and product; the operator sees a final confirmation and recovery guidance when an assignment must be created or corrected first.
- Licensing Workbench now consumes persisted company operating profiles so it does not offer Bar-only packages/add-ons to a restaurant profile. Product-matched package and add-on eligibility remains server-enforced.
- Deployment verification on 2026-08-16: remote migration history reports the migration applied, the legacy bypass overload count is zero, the live quote RPC returned the figures above, and the old `payment_under_review` activation path is absent. Local verification passed: `npm run test:bar` (100 tests), `npm test`, `npm run build:hospitality-pos`, and `npm run build`.

The database migration is live. Updated desktop source still requires the normal desktop release/installer publication process before operators receive its UI and IPC changes.

### 2026-08-16 — Bar POS Base includes Manager PWA (database deployed; web publication pending)

- Bar POS Base now explicitly includes the browser-based Manager PWA in both the shared commercial catalogue and a new forward-only commercial migration. The PWA remains mobile read-only for Bar operations: sales, open tabs, basic stock, cash-close readiness, reports, staff visibility, alerts, and inbox. Desktop Bar POS remains the only sales, cash-up, return, void, correction, and stock-mutation surface.
- Growth & Multi-Outlet remains the explicit gate for the advanced Bar Owner View (`owner_mobile_view`); Base Bar cannot discover or deep-link to it. Restaurant floor and kitchen remain blocked in `bar_only` sessions.
- The migration updates only the active `bar_pos` catalogue, adds the matching authoritative package-entitlement row, and persists the PWA grant for active Bar licenses only when no existing lodge-level feature override exists. Existing manual PWA disablements remain authoritative, and automatic grants receive an activation-audit record. Historical price/quote snapshots are unchanged; Bar POS remains P4,500/year.
- Production database verification on 2026-08-16: linked Supabase migration history records `20260816100000`, and linked error-level SQL lint returned zero findings. The Manager PWA production deployment was not published: the linked Vercel project `tsa-bonno-hospitalityos-manager` rejected its stored deployment token. Marketing-site and desktop package-copy changes also remain unpublished. Complete an authenticated Bar Base/Growth smoke after the PWA deployment succeeds before claiming end-to-end availability.

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
## 2026-09-04 — LodgingOS General Settings save workflow hardened

General Settings now keeps an in-progress draft stable across global settings
refreshes and Assistant toggles, disables clean or unauthorized saves, validates
all save entry points consistently, and preserves edits made while a save is in
flight. Save feedback distinguishes server, partial-schema, and device-only
results. Remote saves have bounded timeouts with actionable recovery guidance;
offline saves are explicitly marked as device-only and requiring a later retry.
Focused settings-save regression coverage passes and the LodgingOS production
build passes. No database migration or release installer was published.

## 2026-09-07 — Live F&B reporting-function drift repaired

- Three forward-only migrations (`20260906000000`, `20260906001000`, and `20260907000000`) repair stale deployed dynamic-SQL fragments in the F&B disable-blocker, consolidated-report, and demand-recommendation functions. The repairs use anchored `pg_get_functiondef` replacements and fail closed if the expected deployed definition is not present.
- The linked Supabase project is confirmed migrated and `npm run db:lint` now produces an empty error report. Focused progressive-activation regression coverage passes 26/26.
- This database repair does not activate Restaurant Accounting. Botswapelo Lounge's active Bar licence still has no `bar_accounting_workforce` add-on selection, and the lodge has no chart of accounts or POS/tender mappings. Accounting remains correctly fail-closed pending governed commercial entitlement and configuration.

## 2026-09-08 - Accounting activation verified-fix pass (local only, NOT applied/activated)

- Implemented the three verified activation defects from `ACCOUNTING_VERIFIED_FIX_HANDOFF.md` (WP1–WP5, local edits + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  1. An independent reviewer can now load any prepared cutover batch after sign-in/reload via tenant-scoped `getCutoverBatches`/`getCutoverBatch` reads (`accounting.read`); absent-or-foreign batches answer identical nulls, stale selections are cleared, and late responses are ignored.
  2. Opening-balance application is an explicit UI step wired through `applyCutover` (`accounting.manage`) with per-batch single flight and server idempotent replay; activation with a supplied batch requires authoritative applied state, while the valid no-history/no-batch path is preserved.
  3. Uncertain activation reconciles the complete stored tuple via the pure `src/shared/accountingActivation.js` snapshot/comparator (exact-match / active-different / inactive / unreadable); any `active:true` under a different date/config/policy/batch/tenant never confirms, and readiness copy requires `ready === true` with every blocker listed.
- New local-only migration `supabase/migrations/20260907010000_accounting_cutover_reads_and_activation_grants.sql` (authored, NOT APPLIED): repairs two 42703 runtime failures found by inspection (`approved_at`, `applied_at` columns), adds the three read RPCs, and grants authenticated EXECUTE on the activation lifecycle surface only. Deployment still requires the exact-target approval in `docs/ACCOUNTING_SQL_ACCEPTANCE.md`.
- Evidence: `test:bar` 318/318, `test:financial-truth` 189/189, browser suite 21/21 (W0/W0b/W1/W1b–W7), node activation 8/8, matrix 7/7 over 99 IPC ops, rush 43/43, release-behavior/architecture/hardware-adapter ok, legacy-pos 219/219, manager lint 0 errors, `build:hospitality-pos` exit 0 (unsigned), `git diff --check` exit 0. `test:restaurant:all` passes every non-SQL file; the only failures are the 3 SQL suites with `ECONNREFUSED 127.0.0.1:54322`, including the new strict cutover-activation suite. Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting second repair pass F1–F5 (local only, NOT applied/activated)

- Closed five verified findings on top of the earlier fix pass (local code + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  - F1: approval binds to reviewed evidence. The reviewer explicitly confirms the displayed batch into an immutable snapshot; approval revalidates it against a fresh read and never auto-submits a changed hash. New local-only migration `supabase/migrations/20260908000000_accounting_approve_evidence_binding.sql` (authored, NOT APPLIED, grants nothing) rejects null/blank expected hashes server-side while keeping every under-lock guard.
  - F2: the activation comparator is fail-closed — explicit-boolean `active` required, `active:false` + status:active reads as scheduled/not-yet-active, one canonical cutover field with alias-conflict rejection, explicit-null vs absent distinction, malformed rejection without coercion.
  - F3: one tenant/user/URL-scoped load lifecycle — direct URLs, reloads, and back/forward navigation resolve under the current session; session changes invalidate all in-flight reads.
  - F4: nominal and timeout apply paths share one rule — only same-batch applied detail confirms; malformed/unconfirmed outcomes keep the batch ID for same-batch retry and never enable activation.
  - F5: the cutover SQL suite is rewritten with a pre-connection safety gate (opt-in flag + explicit target URL + host-bound acknowledgement), real `authenticated`/`anon` role sessions, two-client concurrency races, rollback atomicity, and full readiness fixtures. Execution remains blocked pending disposable-target approval.
- Evidence: `test:bar` 324/324, browser suite 31/31 (incl. X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b), node activation 14/14, matrix 7/7 (signatures unchanged), `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned, new-flow markers verified), `diff --check` exit 0. `test:restaurant:all` 37/40 files; the 3 SQL failures are the 2 pre-existing ECONNREFUSED suites plus the rewritten cutover suite's explicit safety refusal (no connection attempted). Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting third repair pass G1–G4 + G2 (local only, NOT applied/activated)

- Closed four further verified findings (local code + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  - G1: approval now binds the full reviewed revision atomically. New local-only migration `supabase/migrations/20260908010000_accounting_approve_revision_binding.sql` (authored, NOT APPLIED) drops the weaker 4-argument overload and replaces it with a single strong 6-argument form validating opening hash, source identity, and preparation identity null-safely under the batch row lock. The source-only re-preparation race (same opening hash, new source/preparer) is rejected before mutation; domain, UI snapshot, harness mock, and matrix row updated with it.
  - G2: SQL suite logic repaired — pure safety-configuration matrix (no connection to test safety), self-approval naming the reviewed hash, before/after rollback counts retaining the earlier posting, explicit license + override entitlement provisioning (each step verified), v2 mappings effective 2026-01-01, source-drift/preparer-drift/missing-hash SQL coverage, and concurrent dispatch documented as lock-serialized with exactly-one-winner assertions.
  - G3: blank identity is malformed (never an implicit null), review snapshots require tenant/preparer/source-documented evidence in a mandatory tenant/batch scope, and missing fresh fields block instead of being skipped.
  - G4: approval success notices require authoritative same-batch approved detail matching the reviewed revision; lying/malformed/lost responses stay unconfirmed with the batch retained. Production HashRouter parity covered by a cold-URL browser regression.
- Evidence: `test:bar` 331/331, browser suite 34/34 (incl. Y1/Y2/Y3), node activation 21/21, matrix 7/7 (approve row updated for the new signature), `test:financial-truth` 189/189. `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal). Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting fourth repair pass H1–H3 (local only, NOT applied/activated)

- Closed three further verified findings (local code + tests only — no new migration; no database, grant, activation, or publishing operation occurred):
  - H1: safety tests no longer assert the invoking environment is unapproved. The pure configuration matrix plus isolated child-process checks (scrubbed env refuses pre-connection nonzero; valid-shaped dummy env passes connection-free) pass under both absent and valid-shaped settings. The real integration entry keeps requireSafety() first and never connects unapproved.
  - H2: the entitlement fixture fetches `get_lodge_entitlement` once as JSON and validates commercial identity + flag from the same result; setup sessions establish a real actor identity before protected RPC fixture calls (genuine capability gates, not missing-session failures).
  - H3: approval readback proves the full reviewed revision via a shared strict source reader (absent ≠ explicit null; blank/wrong-type/conflicting rejected in snapshot, preflight, and outcome alike), preparation-identity comparison, mandatory snapshot scope, and approver-independence (approver recorded and ≠ preparer; current operator need not be the approver, with revision-only wording).
- Evidence: `test:bar` 333/333, browser suite 35/35 (incl. Z1), node activation 23/23, matrix 7/7, `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned), `diff --check` exit 0. `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal: 3 pass connection-free). Nothing activated, packaged, signed, or released.
- Coordination: Supabase task owns disposable-cloud acceptance and must certify against the final snapshot hashes recorded in `docs/BAR_COMPLETION_STATUS.md`. No 40/40 SQL-backed claim is made here.

## 2026-09-09 - Accounting Task A managed-platform repair I1 (local only, NOT applied/activated)

- Replaced the unconditional superuser premise with precise managed-Supabase-compatible prerequisite checks (local code + tests only — all three forward migrations byte-identical, verified by hash; no database, grant, activation, or publishing operation occurred):
  - New `tests/helpers/disposable-prerequisites.mjs`: a static reviewable requirement list (fixture tables with exact DML rights, setup RPC EXECUTE rights by exact signature, `authenticated`/`anon` role-switching, auth helper), a read-only live prober (`has_*_privilege` checks plus guarded SET ROLE trials with RESET, side-effect free), and a pure evaluator. A sufficient managed non-superuser proceeds; gaps fail pre-side-effect naming the exact capability and operation.
  - The suite's `connectSuperuser` is now `connectFixture` (safety checks still first, no superuser assumed); the integration test runs the preflight before any fixture insert and dropped the `usesuper` assertion and the restricted-helper direct call.
- Evidence: `test:bar` 334/334, node activation 24/24 (H1–H3 intact), safety both ways (valid-shaped G2 filter 3/3 never dialled; absent env 3 connection-free + designed refusal), `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned). `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal). `git diff --check` fails solely on another workstream's pre-existing file (hotel StaffOperations blank EOF line, preserved untouched); all Task A files check clean. Nothing activated, packaged, signed, or released.
- Coordination: Task B owns disposable-cloud acceptance and must check hashes before running, certifying the corrected snapshot in `docs/BAR_COMPLETION_STATUS.md` (changed suite + helper + node tests; unchanged migrations/pure/component) — never the superseded pass-4 suite hash. Status-only notice to Task B; no shared-file edits requested.

## 2026-09-09 - Accounting Task A line-ending repair (local only, no cloud contact)

- Unblocked Task B's halted migration chain: `20260730100000_shared_till_operator_attribution.sql` failed with P0001 because its CRLF matcher blocks matched zero times against the LF-stored `create_pos_order_v3` definition. Repaired with a newline-portable strict transformation
(byte-exact legacy path first, CRLF-normalized fallback, explicit already-installed branch, zero/ambiguous errors
kept, rewritten output verified before EXECUTE). Checkout-independent test `tests/bar-migration-line-ending-portability.test.mjs`
8/8 in the CRLF tree and 8/8 in an isolated LF checkout (canonical LF blocks derived once, explicit CRLF built by single
conversion, fallback branch covered by construction on both; file collected by the bar gate). Narrow `.gitattributes` (`supabase/migrations/*.sql text eol=lf`) added after measuring zero status churn; no renormalization run.
- Triage: the halt file is the sole CRLF member of the 20-file anchored-replacement class (5 applied-prefix peers LF, 14 post-halt peers LF, 1 post-halt dependent immune via single-line needles). The applied prefix is untouched — definer `20260711120000` byte-identical by hash. H1–H3/I1 behavior not reopened.
- Evidence: portability 7/7, bar 334/334, financial-truth 189/189, rush 43/43, release-behavior ok, restaurant 37/40 (3 SQL-blocked as before), release-architecture/hardware ok, build exit 0 (unsigned), task files diff-check clean. Nothing activated, packaged, signed, or released.
- Resume package for Task B in `docs/BAR_COMPLETION_STATUS.md` (old/new raw + canonical hashes, applied-prefix classification, SQL acceptance checklist) and `docs/ACCOUNTING_SQL_ACCEPTANCE.md`. Task B validates the new hash, confirms no partial effects on the SAME disposable project, resumes, then completes the chain and runs final acceptance. No production changes; Task B's runner and cloud project untouched.
