# Original-interface restoration — incremental independent check, 5 November 2026

The posted Luna response restates the task; it does not claim or establish implementation completion. Inspected the current source independently rather than treating that recap as an implementation report.

## Real source progress

- LocalBarHposShell now imports and mounts original HposTerminal, OpenChecks, CashClose, personal cash-up, team, reports, Manage, Stock Pro workspace and eight Accounting pages. It no longer imports BarLocalWorkspace as its route implementation.
- Manage label/local PIN code and local entitlement refresh/mapping have changed.
- New migration 0084 repairs omitted query-scope roles from the authenticated SQL session and supplies zero for an empty event watermark. Nullable-shift response-contract tests have been added.
- These findings establish source changes, not that the running app/service has been upgraded or that original workflows operate successfully.

## Executed checks

`node --test --test-force-exit tests/bar-local/normal-hpos-local-routes.test.mjs services/bar-local/tests/query-results.test.mjs services/bar-local/tests/native-hpos-till-adapter.test.mjs`

Result: **19/19 passed**, exit 0. This combines source route checks, synthetic response-contract validation and isolated Till adapter behavior. It does not execute Electron IPC, real local service queries/mutations or PostgreSQL. No database or customer record was touched.

## Actionable gaps

1. **Original screens remain disconnected from local operations.** HposOpenChecks still calls original `window.api.pos` methods for tabs/splitting/transfers; HposReports calls original POS and inventory methods; RestaurantAccountingUi invokes `restaurantAccountingV2`. The main runtime's global registration wrapper still refuses non-barLocal/non-barGuides IPC in local mode. No matching local compatibility dispatch was found there. Simply mounting the original screen cannot pass those requests through the fence. Add explicit local routing/adapters and equivalent authoritative contracts; do not remove the cloud fence.
2. **Some route substitutions still change original workflows.** Original `hpos/growth-tools` mounts RestaurantGrowthControls with tabKey=growth, while the new local route mounts HposCustomers. Original `hpos/attendance` redirects to shift-close, while local mounts MyShift. Complete applicable Bar aliases, finance/accounting activation, data/settings and display routes against App.jsx rather than accepting the wildcard unavailable screen.
3. **Add-on compatibility needs behavioral acceptance.** The new mapping derives enterprise_addons from local entitlement features, but dependency checks inspect all included features. Test grants represented as add-on keys alone, feature lists, missing dependencies and revocation; a valid granted dependent add-on must not disappear because its prerequisite was represented by its add-on key.
4. **Migration/source success is not deployed acceptance.** The new empty-feed/nullable/role repairs require guarded PostgreSQL and actual HTTP/client tests, including denied/conflicting scope and fresh empty businesses. No independent migration 0084 DB execution or Rabafi installed upgrade was performed by this check.
5. **Cleanup remains incomplete.** BarLocalWorkspace still exists. Remove replacement UI only once all original behavior and remaining callers are accounted for; retain shared local service, setup and journal primitives.

Sent the findings and request to continue the authorized full implementation to Luna. No product remediation, running-app restart, customer DB operation, commit or push was performed by this review. Software restoration remains **PARTIAL / NOT COMPLETE**. Customer readiness is not established; deferred PDFs, hosted/Supabase and physical multi-PC work remain explicitly pending.

## Corrected owner PIN report

The user clarified a typo: the owner PIN chosen during local setup **does not** unlock Manage. The earlier conversational acknowledgement of success is withdrawn; it is not acceptance evidence. No PIN value was requested, read, logged or tested by the reviewer.

Source trace identifies a definite length mismatch: serverSetup.js accepts 4–12 numeric digits and BarLocalClient.verifyManagerPin accepts 4–12, while HposLayout's Manage input truncates to six. Valid longer setup PINs therefore cannot round-trip. This does not establish the length of the user's PIN or the cause of this particular failure. The local optional-method call also reports unauthorized when the verification method is unavailable, which can mislabel an incompatible running build as a wrong PIN. Asked for the visible error wording only and sent Luna the corrected failure plus these findings, requesting actual owner setup-to-Manage acceptance and preservation of existing credentials. No password/PIN reset, app restart or service upgrade was performed.

## Follow-up after the user's four-hour absence

Compact chat snapshot cursor `c939d051-3ab3-499f-b147-130b7bee5d1c:1` showed Luna still active, running broader regressions and reporting a packaging toolchain blocker. Source/evidence inspection found additional real progress:

- `src/renderer/src/App.jsx` exists (192,703 bytes), is modified rather than deleted in git, imports LocalBarHposShell and still contains original Manage/accounting routes. Manager PWA and Legacy App.jsx files also exist. EV-220 records an earlier editing-tool incident that zeroed the desktop App.jsx and recovery from `docs/engineering/typescript-migration/evidence/preimage-batch138-20261105/src__renderer__src__App.jsx.before`; that backup exists. This review confirms current presence/routes, not that every unrelated historical edit was preserved by the recovery.
- Modern BarLocalWorkspace.jsx is now absent from disk. The normal original component mounts remain in the local shell. Local adapters are present for Staff, Customers, Expenses, General Ledger and Accounts Payable. AP source includes local draft/approve/pay branches; its full SQL/HTTP workflow is not independently accepted.
- Manage input now allows 12 digits, matching setup; Modern client tests include full-owner-PIN verification and older-endpoint handling. This is not evidence of the user's real saved PIN succeeding.
- Stock Pro inventory/purchasing/suggestions/lots and Accounting chart/GL/AP routes have original components. Recipes/prep/variance, several workforce/growth pages, bank reconciliation, tax, budgets, statements, payroll, accounting setup and finance-close still route to explicit local unavailable boundaries. Some are shared Restaurant-only screens; classify applicable Bar scope before counting gaps. Unavailable boundaries prevent hosted calls but do not satisfy restored Bar workflow acceptance.
- Migrations now extend through 0089. Source presence does not prove installed deployment. Latest docs explicitly retain unexecuted SQL/installed acceptance limitations. Git HEAD remains the 4 November documentation commit 2d13996d; no new completed restoration commit/push was found.

Independent command: `node --test --test-force-exit tests/bar-local/modern-client.test.mjs tests/bar-local/hpos-expense-api.test.mjs tests/bar-local/hpos-customer-api.test.mjs tests/bar-local/bar-local-general-ledger-api.test.mjs services/bar-local/tests/hpos-staff-local-api.test.mjs services/bar-local/tests/bar-local-accounting-chart-api.test.mjs tests/bar-local/normal-hpos-local-routes.test.mjs` — **79/79**, exit 0, no skips. These are synthetic client/adapter/contract and source-route checks; they do not run PostgreSQL, native IPC or the user's installed service. No competing DB test, product edit or app restart was performed.

Overall verdict remains **partial restoration**, with real source progress and significant original/add-on workflows still pending. PDFs/hosted/physical-PC deferrals do not excuse those software gaps.

## Saved-app failures after the installer attempt

New user screenshots show Manage refusing verification with LOCAL_SERVICE_UPDATE_REQUIRED, Sell failing catalogue reads with the event-watermark validation error, and Staff shift close displaying the explicit unimplemented-local-workflow page.

An independent unauthenticated loopback probe confirmed the running service is alive (`GET http://127.0.0.1:8787/v1/health/live` -> 200) but lacks the PIN route (`POST /v1/manager-pin/verify`, empty JSON/no credentials -> 404). No PIN, session, database connection or authenticated mutation was used. Source app.ts contains the endpoint; the loaded installed service does not provide it. The screenshot is not evidence of an incorrect user PIN. The desktop maps HTTP404/405 to that exact compatibility error.

Source HposSharedShiftClose.jsx lines22–25 intentionally returns the unavailable screen in local authority mode; shared drawer close, attendance and staff PIN parity remain software work, not deferred physical-PC qualification.

Source BarLocalClient.events throws HTTP error envelopes before its new empty-feed NULL normalization. Consequently a legacy service returning HTTP400 for its own NULL-watermark validation cannot be fixed by normalizing only successful response bodies. Earlier captured live terminal evidence showed this failure as HTTP400; no fresh authenticated feed was requested in this check. A real empty-outbox HTTP/client regression and loaded-service upgrade acceptance are needed.

Sent all three failures, the concrete unauthenticated probe and upgrade/test requirements to Luna. No installed file, service process, schema, credential or customer record was changed by the reviewer. Saved-app commissioning remains failed/incomplete despite source/build progress.
