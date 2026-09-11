# Bar Restaurant Gate — Test Failure Triage

Date: 2026-09-07 (second pass). Source revision: `0010b612` plus dirty worktree.
Command: `npm run test:restaurant:all` (`tests/run-restaurant-suite.mjs --keep-going`).
Result: **37/39 files pass; 2 fail, both PostgreSQL-blocked** (was 12 failing).
No failure was waived, skipped, or weakened: every fixed file names the exact
assertion, the traced behavior, and the decision below.

Bar gate: `npm run test:bar` passes 309/309.

## Rule

A failing file is never fixed by accepting any error, skipping the file, or
updating a snapshot without reviewing the behavior.

## Environment-blocked (need approved disposable target, not run)

| File | Intended invariant | Observed 2026-09-07 | Next step / blocker |
|---|---|---|---|
| restaurant-accounting-behavioral.test.mjs | Real PostgreSQL behavioral proof for Accounting authorization | `connect ECONNREFUSED 127.0.0.1:54322` (reproduced today; no database exists in this environment, no docker to start one) | Run only in the approved disposable environment per WP4/WP8. `db reset --local --yes` is destructive: requires explicit approval plus isolated project/container/port/volume verification. Never point at a linked production URL. |
| restaurant-recipe-depletion-behavioral.test.mjs | Real PostgreSQL depletion behavior | Same ECONNREFUSED | Same disposable-DB path. Capture the exact assertion on the approved target before deciding code vs test. |
| restaurant-accounting-cutover-activation.test.mjs (Task A 2026-09-09) | Real-role cutover maker/checker, revision binding, source-drift races, apply replay/concurrency, rollback atomicity, full-tuple activation readback | Explicit safety refusal, reproduced 2026-09-09 (pure config matrix + child-process isolation pass connection-free; integration refuses pre-connection without all 3 approval inputs; fixture preflight names exact missing grants instead of assuming superuser) | Same disposable-DB path per `docs/ACCOUNTING_SQL_ACCEPTANCE.md`; Task B executes. Not a regression — never executed successfully anywhere yet. |

## Resolved 2026-09-07 (per-assertion capture → decision → fix)

| File | Failing assertion(s) | Traced behavior | Decision |
|---|---|---|---|
| restaurant-hpos-service-contract | `navigate('/hpos/pos')` single-quote; `openTableSession(` in HposTerminal; `setSuccessMessage('')`; `serviceMode === 'delivery'`; `redeemVoucher`; `availabilityBusy ? 'Saving…'`; `Disabled/dessert` sections; recipe-link `disabled=`; `canAccessCapability(access, 'inventory.manage')`; `navigate('/restaurant/inventory')` in sidebar stock; `Add Item\|Add stock item\|createItem` negative | Quote drift (×several); one-call v3 settlement replaced the second table session (POS.jsx keeps `openTableSession` for table-pick open); voucher redemption moved into the atomic tender envelope (server redeems in `create_pos_order_v3`); availability busy indicator moved to a row subcomponent; stock-method model replaced input-disable with explicit method + conflict state; inventory mutations gated by `canManage`; sidebar stock routes via Manage hub; create/edit entry points gated by `canManage` | Evidence-backed test repair throughout; one deliberate product-behavior pin added (terminal must NOT make a second table session). No invariant weakened. |
| restaurant-accounting-p2-containment | `setGlAccounts(Array.isArray(result?.data)…)`; `setPreviewTxns([])`; `disabled={Boolean(editAccount)}` | Shared `unwrap(a,[])` helper; preview derives from file state and resets by clearing it; account config behind `canManage` with opening values in Chart of Accounts | Evidence-backed test repair; strictly stronger gating asserted. |
| restaurant-gaps-fixes (7) | `receivePurchaseOrder(orderId)`; `resolveAlert(alertId)`; `getExceptionAlerts()`; export `db.getPosPurchaseOrders?.(…)`; `rpc('seat_…', {\n      payload:`; stage count 20 (actual 34); `stages.length === 20`; `Confirm` absent; `!setupComplete` | Location-aware receive `(orderId, stockLocationId)` end to end; idempotent 3-arg resolve + server-confirmed `resolved_at`; authorized `getAlertHistory({includeResolved:true})`; `callDb('getPosPurchaseOrders', …dates)`; CRLF in source; restaurant STAGES (20) + BAR_STAGES (14) mode-split; `Confirm` only in guidance copy; ternary retirement on server-confirmed completion | Evidence-backed test repair; mode-split counts pinned per list. |
| restaurant-operations-foundation | 8 preload `ipcRenderer.invoke` patterns; `new.inventory_item_id…`; `v_parent_type`; `new.quantity` depletion guard | Preload now routes through the shared `invoke()` wrapper (same methods/channels); depletion guard references `v_line.*` after trigger→function refactor; non-sale skip uses `v_order.transaction_type` | Evidence-backed test repair. |
| restaurant-phase4-financial-workflow | `redeemVoucher` post-sale + `!result.offline` context | Same atomic-tender evolution as hpos contract (both terminals) | Test rewritten to the atomic contract (tender row + pre-submit validation). |
| restaurant-phase5-operations | `Cannot clock in/out offline`; `get_active_alerts` | Deliberate offline attendance via trusted cache + queued idempotent replay, marked provisional; active alerts via authorized history RPC (`p_include_resolved: false`) | Tests rewritten to the offline-first contract (provisional flags, stable keys) and the history RPC. |
| restaurant-self-shift | `Confirm manager decision`; review-call shape | Copy is now `Enter a correction note…`; review call carries `manager_pin` (PIN-verified review) | Evidence-backed test repair; stronger shape asserted. |
| restaurant-staff-management | `Waiter / till operator`; preload `getAccessAudit` exact form; review-call shape | Operator-first labels (`Till operator / cashier`); same preload wrapper evolution; `manager_pin` in review call | Evidence-backed test repair. |
| restaurant-station-routing | `kitchen_station_id` in create/update (800-char window) | Field present in both functions; test window predated added fields | Window widened to function boundaries. |
| restaurant-usability-gaps | `executeSplitBill` window; `RestaurantTables` viewMode ×5; split dead-code shape | Same window class; area toggle genuinely missing → implemented (`viewMode`, `tablesByArea`, Grid/By Area, LayoutGrid headers + counts, default grid unchanged); split transport-error envelope + offline-block assertions updated | One real UI addition + one real domain/test hardening; **plus one real product fix found in triage: even-split omitted `source_tab_version`** — now forwarded null-safe (server skips the check on null, enforces when known). |
| restaurant-workspace-ux | `<ActiveComponent … tabKey={activeTab.key}` | Renders the displayed tab via `viewTab` with denial support | Updated to the V04 contract. |

## Runner hardening (unchanged)

- `tests/run-pos-settlement-sql.mjs` supports `POS_SETTLEMENT_STRICT_RELEASE=1`:
  normal runs skip with exit 0 when `POS_SETTLEMENT_TEST_DB_URL` is absent
  (verified); strict release mode fails with exit 1 instead of skipping
  (verified). Release CI must set the strict flag so SQL acceptance cannot
  pass by skipping.
- Keep-going restaurant gate still reports all failures and stays nonzero
  (today: 2 failing files listed, exit 1). No file was excluded.

## Blockers

1. Disposable-database approval for the two behavioral suites (WP4/WP8 procedure).
2. Nothing else from this gate: all ten drift files are resolved with evidence above.
