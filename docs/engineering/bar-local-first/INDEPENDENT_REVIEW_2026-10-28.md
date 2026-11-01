# Independent implementation review — 28 October 2026

**Verdict: CHANGES REQUIRED. The complete locally implementable software is not finished. Customer commissioning remains NO-GO.**

This is a follow-up to the historical reviews, not a replacement for their evidence. Luna's final handoff explicitly says implementation and acceptance are incomplete; it does not claim that the full plan is finished. The current follow-up primarily repaired source-contract regressions, error visibility and several financial/readiness safeguards. Substantial local infrastructure and workflow work remains, independently of extra PCs and customer documents.

Review authorization: source inspection, synthetic tests and review/plan artifacts only. No product fixes, hosted schema changes, hosted ingestion, customer import/cutover, release, commit or push were performed. The already-running Bar development application was left alone. It was previously observed running its existing cloud workspace; this review did not convert it or use it as a test database. Hardware qualification and customer PDFs/quick-start/screenshots/approved-manifest changes remain explicitly deferred.

## Evidence and scope

- Full current service suite: **188 tests, 186 pass, 2 fail, 0 skips**, on a fresh identified PostgreSQL 17.6 cluster through local migration **0066**. Bootstrap/build succeeded. Runner exit 1 is a real red test result, not a disk preflight or cleanup failure. Stop succeeded. Target: `.tmp/bar-isolated-tests/2026-10-28T09-20-16-670Z-5c94c9f2/`; database `bar_local_test_c6788f411a47b5cd`, loopback port54284. The failed fixture was retained stopped, without cleanup of application data.
- Additional reviewer reproductions: **3/3**, on a separate fresh guarded cluster `.tmp/bar-isolated-tests/2026-10-28T09-40-24-541Z-ae9c694c/`. These confirm two defects and four safe scope denials; passing reproduction tests do **not** mean the defects were fixed. This successful fixture stopped and its own data was retired by the guarded runner.
- Modern Electron/runtime/journal/guard tests: **87/87**.
- Legacy: package script passed, **219 source checks plus50 Node tests**. This is not Windows7 qualification.
- Renderer typecheck and targeted Bar finance typecheck: **PASS**. These targeted configurations do not establish whole-repository TypeScript cleanliness.
- Real browser local finance/handover/operator suite: **5/5**, using the installed `chromium_headless_shell-1248` selected through the existing environment overrides. Fixtures mock IPC/service responses; this is rendered-component evidence, not an entire live till installation.
- Independent broad Bar run emitted **812 tests,787 pass,19 fail,6 skip**. All19 emitted failures concern guide/PDF/manifest/source-anchor checks; the rendered-recovery browser gate passed with the installed-browser override. The wrapper hit its600-second timeout and recorded SIGTERM instead of a normal process exit: the emitted summary is retained, but this is **not** a clean full-script exit or a passing broad suite. Do not change frozen guide hashes to clear failures. Preserve the six guarded DB skips as skips.
- Separate focused source tests from the preceding hourly review: base-product + error visibility **19/19**. These do not substitute for rendered accessibility/operator testing.
- Source snapshot:291 files in `evidence/independent-2026-10-28/reviewed-source-sha256.csv`. It covers selected service/contracts integration, local runtimes, Modern/Legacy components and tests; it is not a Git attribution claim or a hash of customer data. Unrelated concurrent work was preserved.

Detailed105-row coverage (32 acceptance requirements,64 feature rows,9 work packages): `INDEPENDENT_COVERAGE_2026-10-28.csv`. PASS means only the explicitly bounded behavior was verified. PARTIAL never means customer acceptance. A03's current specified100-request case passes; the remaining requirements have partial, missing or deferred evidence. No percentage is inferred.

The runner's earlier1.81GiB disk blocker was historical: this review observed more than10GiB free and ran the full suite without weakening the4GiB guard. Luna's earlier unavailable-browser limitation also no longer applies when selecting the installed compatible browser. Neither correction closes the substantive implementation gaps.

## Actionable findings

### R1 — P1: first-owner setup cannot recover a committed lost reply

Sources: `services/bar-local/src/app.ts:275`–306 creates fresh identities and device token, calls commissioning, then sends the only raw device credential; `services/bar-local/db/migrations/0003_identity.sql:27` permanently refuses setup after an authority exists; `src/main/bar-local/client.js:680`–702 saves credentials only after receiving a successful response; `src/main/bar-local/electronRuntime.js:284`–329 persists the authority profile afterward. Pairing has a related one-use-response window at `services/bar-local/db/migrations/0025_pairing_authority_scope.sql:22`–31 and runtime `electronRuntime.js:353`–397.

Reproduction uses the real service and real isolated database: a fresh owned loopback proxy forwards first-owner setup, reads its201 committed response, then destroys the caller socket without forwarding credentials. Retrying identical setup receives409 `AUTHORITY_ALREADY_COMMISSIONED`; the database contains exactly one authority and one device; staff login without the missing paired-device credential receives401. No second business is created, but the supported operator setup is stranded. It is not safe to solve this by deleting authority data, re-enabling cloud or granting anonymous access.

Correction: durable provisioning identity and protected client staging before sending; matching-payload resume/replay with proof of possession; recoverable atomic profile/credential completion across both Modern and Legacy; changed-payload/reused-code abuse denied. Keep first-owner takeover protection. Cover loss before/after commit, reply and each local checkpoint. Pairing's related window was source-traced, not independently fault-injected in this review.

Evidence: `evidence/independent-2026-10-28/review-probes.log`, first reproduction; replay command/runner in `.tmp/independent-bar-review-20261028/commissioning-and-restore.test.mjs` and `run-probes-isolated.mjs`. The latter is a copy of the guarded runner with only root resolution and the selected test command changed; loopback/identity/disk/start-stop guards remain.

### R2 — P2: response-body stalls bypass the cloud uploader timeout and retain its lock

Source: `services/bar-local/src/operations/cloudSync.ts:433` clears the request abort timer immediately after fetch returns headers; line436 then awaits `response.text()` outside that deadline. The64KiB check at line437 runs only after the entire body has already been buffered, and measures string length rather than bytes. `runNow` keeps the same active promise at line687; the advisory-lock client is released only after drain completes at line664.

Independent reproduction drives the built production controller with a fresh real loopback HTTP receiver and synthetic DB responses. The receiver sends200 headers and an unfinished JSON body. At1752ms with a configured1000ms timeout, the controller remains unsettled and its lock client unreleased. Manually completing the body releases it. A live stuck body can therefore stop subsequent automatic/manual/final passes and delay shutdown indefinitely; a large body is not bounded while being read. Hosted transport is disabled, so this is currently a pre-activation transport defect, not evidence of a hosted outage.

Correction: keep a total deadline through complete bounded streaming-body consumption, abort/cancel on deadline/byte limit/shutdown, durably mark failure, and always release/recover worker ownership. Preserve batch ID/hash and retry. Test delayed headers, never-ending/dripping body, oversized UTF-8/chunked responses, reset and stop while in flight.

Evidence: `evidence/independent-2026-10-28/cloud-body-timeout-probe.json`; runnable `.tmp/independent-bar-review-20261028/cloud-body-timeout-probe.mjs`. No hosted connection or real DB was used by this probe.

### R3 — P1: restore hardening silently removes all cloud-sync function access

Sources: `services/bar-local/db/migrations/0064_cloud_sync.sql:704`–713 grants10 sync functions directly, but never registers them in `runtime_function_allowlist`. `services/bar-local/src/operations/backup.ts:1427` revokes all runtime function privileges; line1513 regrants only names in that table. Migration0065 does register its three failover functions at line336, which makes the omissions in0064 material.

Real isolated reproduction: immediately after migrations, runtime has EXECUTE on `cloud_sync_status()` and `cloud_sync_worker_config()`. After executing the actual `buildRuntimeSecurityStatements` restoration sequence, both privileges are false. The restored runtime can no longer read sync status or drive the worker. This is a product restore defect, not just the outdated allowlist assertion described next. Other financial effects were not lost by this probe.

Correction: forward local migration registering the intended narrow sync functions; verify all functions remain SECURITY DEFINER with pinned search_path and no PUBLIC/direct-table/helper exposure. Test actual staged encrypted restore through the real runtime, including configuration, pending batches, unchanged hashes, retries and acknowledgements. Never fix it with a blanket schema/function grant.

Evidence: `review-probes.log`, second reproduction; guarded fixture path above.

### R4 — P2: two maintained regressions abort before completing their intended coverage

`services/bar-local/tests/api-scope-isolation.test.mjs:69` requiresHTTP200 for every refused field. Current actual contracts deny business/outlet with403 `OUTLET_SCOPE_MISMATCH`, authority with409 `WRONG_AUTHORITY`, and device with401 `AUTH_INVALID`. The maintained test aborts on its first business case. Reviewer's independent loop exercised all four and verified zero forged catalogue rows. This is not a demonstrated authorization bypass.

`services/bar-local/tests/db-runtime-privileges.test.mjs:7`–42 omits the three explicitly allowlisted failover functions added by0065; its line65 assertion aborts before later helper/table/sequence/financial assertions. Update the independently reviewed intended allowlist, incorporating R3's sync repair, and preserve the negative privilege checks. Do not derive expectations from whatever happens to be granted and thereby make the test tautological.

Evidence: current full service log, final failure details; `review-probes.log`, third test; additional `device-scope-probe.json` confirms device mismatch is rejected before any DB call.

### R5 — P1 completion gap: the required Settings-led deployment and recovery product is unfinished

`src/renderer/src/App.jsx` and local runtimes provide first-owner/join forms; they require an already-installed/running service and explicit address/trust/setup material. `BarLocalAdminPanel.jsx` supplies partial status/backup/durability/switchover controls. It does not implement the complete install/discover/full-copy/enroll/remove/replace/maintenance workflow described at `TECHNICAL_PLAN.md:150`. Windows scripts are useful source, not connected wizards or installed qualification. `services/bar-local/src/admin.ts:918`–936 always returns no staged update and no automatic installation, even though signed update helpers exist.

This is locally implementable integration work in A01/A24–A31/WP1/WP5/WP7, not merely a request for extra PCs. Add the guarded orchestration and then leave physical qualification explicitly pending. Production witness startup is correctly refused at `services/bar-local/src/server.ts:43`–49; do not remove that safety gate to claim topology completion.

### R6 — P1 completion gap: lot allocation and correction workflows remain incomplete

`services/bar-local/db/migrations/0047_stock_lot_expiry_report.sql:1`–2 explicitly states receipt records do not represent remaining lots; later0049 fixes pagination but does not implement lot depletion. Sales/returns/waste/transfers still lack complete lot allocation/provenance and FEFO. The UI's received-quantity label is honest, but cannot satisfy BAR-STOCK-007 or original stock invariants.

Retained/unallocated tip corrections and closed-drawer refusals have real tests. The full reviewed reconciliation path for allocated/payout tips and closed submitted historical cash-ups remains incomplete. Safe refusal is preferable to corrupting history, but is not a completed correction feature. Preserve immutable prior receipts and introduce separately approved compensating events where the plan requires corrections.

### R7 — P1 completion gap: independent recovery, training, transition and full fault/load proof remain open

`services/bar-local/packaging/windows/install-backup-task.ps1:11` explicitly describes snapshot backups rather than WAL archiving/PITR. Tested encrypted dumps and restore invariants are valuable; they do not provide the required continuous WAL chain, independent recovery destination, portable owner-held keys or complete replacement-PC workflow. R3 shows why successful snapshot tests cannot be taken as full recovery acceptance.

No isolated operator training authority lifecycle/banner exists (A30). Safe cloud-source dry-run import, reconciliation and actual old-cloud-writer handover are absent (A17/WP6); setup correctly blocks a saved cloud business. Fresh empty-Bar trial can be developed without importing Lounge, but does not close the original transition requirement. No supported qualified coordinator has been delivered; witness source remains experimental and production-disabled. A20/A32 full fault/race/load requirements remain materially incomplete. These source/software gaps are separate from deferred physical-PC and manual gates.

## Verification interpretation and remaining limits

The188-case run exercises actual SQL/API locking, idempotency, sale/tender/stock/GL conservation, returns, approvals, revoked roles, scoped queries, catalogue, purchasing, reports, cloud-test receiver and selected recovery/restore paths. It also executes the experimental witness via a clearly marked test-only harness; its passing test is not production automatic-failover approval. A service registry mapping test only covers registered commands, not missing product features or every historical Accounting operation.

Existing Modern/Legacy startup, fixed IPC/client routes, protected SQLite/JSONL journals, query envelope validation and immutable original operation recovery were inspected against their tests. Browser forms were tested with synthetic bridges; complete live installed UI-to-service end-to-end operation for every feature was not established. Maintained cloud regressions in the broad suite do not fully qualify hotel/lodge/PWA/public-site or live Supabase deployment. We did not rebuild/relaunch the running Modern application for this final source checkpoint or claim a fresh independent installed build; author build results remain historical scoped evidence. No hardware support, power-loss, independent Windows installer or real multi-PC result is inferred.

## Separate verdicts

| Area | Verdict |
|---|---|
| Local financial/API core | Substantial real coverage, but full suite red and full-plan financial/fault completeness not established |
| All locally implementable software | **INCOMPLETE — CHANGES REQUIRED**, including R1–R7 |
| Cloud source/transport | Implemented partial test path; R2/R3 defects; hosted receiving/activation intentionally disabled |
| Existing Lounge migration | Not implemented or performed; no source data imported and no old writer fenced |
| Topology/failover | Manual/experimental sources only; unsupported automatic witness safely refused |
| Hardware/installed/multi-PC | UNVERIFIED and deferred where user specified |
| Customer documents/packaged approval | DEFERRED, remains a release gate |
| Customer commissioning/release | **NO-GO** |

Next implementation instructions: `DEEPSEEK_COMPLETION_PLAN_2026-10-28.md`. No approval to deploy, activate hosted ingestion, run customer migration or push follows from this review.

## Reproduction retention and manual impact

Durable copies of the reviewer probes and guarded selected-test runner are under `evidence/independent-2026-10-28/probes/`. Run from the repository root. The guarded DB runner creates its own fresh cluster and requires normal PostgreSQL process permissions on this Windows host. Non-DB probes use only synthetic DB responses and/or owned loopback HTTP. `full-service.log`, `full-service-results.json`, `review-probes.log`, `checks.json` and individual check logs retain the actual results; do not rerun destructive experiments against the stopped failed fixture or a running application database.

Manual-impact decision: **No customer manual update required for these review/test/implementation-plan artifacts**, because this review changes no product behavior. The existing customer-facing changes still require the separately deferred PDF/quick-start/screenshots/approval and packaged-guide release work. No customer document or frozen approval baseline was edited by the reviewer.
