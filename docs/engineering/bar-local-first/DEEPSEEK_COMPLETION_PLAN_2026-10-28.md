# DeepSeek implementation and completion plan — 28 October 2026

## Assignment and finish line

Take over the existing Bar local-first implementation in:

`C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`

Finish all remaining software that can be implemented and meaningfully verified on this development PC. This is an implementation assignment, not a request to stop after an inventory, passing build, small cleanup or another handoff. Continue through ordinary implementation decisions and retain durable checkpoints during long work.

Read `INDEPENDENT_REVIEW_2026-10-28.md` first, then AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, TECHNICAL_PLAN.md, IMPLEMENTATION_PROMPT.md, REVIEW_PROMPT.md and the current source. Use `INDEPENDENT_COVERAGE_2026-10-28.csv` as the105-row baseline: A01–A32, all64 feature rows and WP0–WP8. Historical source classifications and author claims are not acceptance.

The target is a working local product: a nontechnical owner installs/creates a new Bar, a till joins it, staff log in and perform every offered workflow offline over the LAN, and the owner can back up, rehearse, update and recover using guarded screens. Correctness requires atomic financial/stock/GL/audit truth, stable operation IDs, exact money, scope/capability enforcement and safe recovery under partial failure.

Separate two supported journeys: a **fresh empty local Bar** and an **existing cloud business transition**. Fresh trial does not require importing Lounge. Still implement the original plan's transition preparation against synthetic/offline export fixtures; do not pretend a new empty database migrates an existing business. Neither journey authorizes live customer activation.

Explicitly deferred:

- Additional physical PCs, installed Windows7 reference equipment, actual multi-PC/peripheral/power/network-partition/soak qualification.
- Customer PDFs, quick-start, screenshots, approved-document manifest and approval/package-guide artifact updates.

Keep these as visible release gates. You may simulate several independent client/service/DB processes on this PC; label that evidence accurately. Continue internal technical documentation and manual-impact assessment without modifying frozen customer approval baselines.

Not authorized: hosted Supabase schema/migrations or other hosted writes, hosted ingestion activation, production/customer data import or live cutover, deployment/release, commit/push, destructive cleanup. A proposed receiver and migrations may be source-tested against disposable **local** PostgreSQL only. Do not inspect or use unexpected/mismatched hosted credentials to fill an evidence gap. No Docker requirement for client installations.

## Execution discipline and verified baseline

1. Inspect dirty files and active processes. Preserve unrelated TypeScript, marketing, booking, PWA and Legacy login changes. Do not reset/clean the checkout or stop an active app to make tests easier. If you require exclusive ownership of an actual running process, establish its identity and coordinate first.
2. Read the independent evidence index. Full current DB suite through0066:188 tests,186 pass,2 fail,0 skip. Its fixture stopped cleanly. The two maintained failures are a scope-denial HTTP expectation and outdated runtime-function allowlist. They are not permission to weaken checks.
3. Reviewer reproductions confirmed: first-owner lost reply strands provisioning; restore hardening removes cloud-sync grants; response-body stalls exceed sync timeout. Real forged business/outlet/authority/device requests were correctly denied with403/403/409/401 and no forged row. See review and `evidence/independent-2026-10-28/`.
4. Modern87 tests, Legacy219 source +50 Node, renderer/finance typechecks and browser5 cases passed independently. The broad run emitted812/787pass/19fail/6skip, then the wrapper timed out; do not claim a clean broad exit. Remaining emitted failures are deferred guide/PDF/source-anchor gates. Installed compatible Chromium exists and works through existing executable-path overrides. The historical disk blocker was resolved during review; always recheck current free space and retain the4GiB guard.
5. Use TypeScript for new infrastructure, SQL/PLpgSQL for authoritative DB rules, and narrow checked adapters for existing JS clients. Do not weaken strictness or rewrite the whole app.
6. If using multiple agents, use a coordinator and a small number of bounded workers with disjoint files. Suggested lanes: core SQL/contracts; client/setup UI; recovery/packaging; coordinator owns integration/cloud changes. One migration allocator, one DB test runner at a time, no shared-file racing. Each worker supplies source diff, negative tests and evidence; coordinator verifies integration.

For every phase, implement contracts and enforcement before relying on UI controls. Record failure/retry/authorization/audit behavior, add meaningful behavioral tests, run the affected real scripts, then advance. Do not repeatedly rerun unchanged broad suites during editing.

## Phase1 — Close independently reproduced defects and restore the test baseline

### 1A. Recoverable first-owner and pairing provisioning (R1)

Current setup generates the raw first-device token only on the server and sends it once after committing. A lost reply leaves the authority commissioned and setup permanently fenced, while the client cannot log in. Single-use pairing has a related window. Fix the protocol end to end, not by allowing a second authority or clearing application data.

Requirements:

- Persist a stable provisioning ID and protected credential/recovery staging on the client **before** first dispatch. Persist enough state to resume after process/OS restart without creating another intent.
- Bind the server provisioning result to that ID, original normalized payload and possession of the original staged secret/device credential. Decide a reviewed secure credential-delivery design; matching replay must not reveal credentials to someone who merely guesses an ID.
- Distinguish a response lost after commit from a definitive failed attempt. Matching replay returns the same authority/business/outlet/device, while changed-payload reuse and unrelated requests remain refused. Preserve the existing first-owner takeover guard.
- Make the local credential/profile/journal transition resumable across every write boundary. An encryption or disk failure must preserve recovery material and stop safely; never strand the only owner silently or switch to cloud.
- Apply the same pairing/recovery contract to Modern and Legacy. Consuming a code twice for the same authenticated provisioning intent must not create duplicate devices; arbitrary code reuse stays denied.
- Show a simple Resume setup/Check setup result path instead of manual SQL, deleting profiles or obtaining a new code after an ambiguous response.

Tests: actual API/DB with caller socket dropped after commit; crash before send, after send, after server commit, after credential persistence, after authority persistence and before restart; disk/encryption failure; same/reused/expired/wrong code; changed-payload key reuse; stolen identifier without proof; fresh startup after interrupted local/cloud choice. Reconcile exactly one authority/device/result and verify login after recovery.

Relevant source: `src/main/bar-local/{electronRuntime,client}.js`, Legacy counterparts, app.ts setup/pair routes, identity migrations and protected journals. Use a forward local migration for existing schema changes.

### 1B. Cloud response deadlines and bounded reads (R2)

Keep the timeout active through complete response consumption. Read with an incremental UTF-8 **byte** bound; do not call unbounded response.text() then check length. Abort/cancel stalled/oversized bodies and pending I/O on stop; mark durable failure and release worker ownership without acknowledging the batch. Retrying preserves the exact batch/manifest/key. A queued cash-up request must remain nonblocking and coalesced.

Tests: delayed headers; immediate headers and no completed body; slow drip; oversized chunked/multibyte response; malformed acknowledgement; body reset; stop during response; retry after failure/restart; new run after lock release. Convert the reviewer reproduction into a proper passing regression with real loopback HTTP and representative DB integration. Keep disabled/approved transport refusal intact.

### 1C. Restore runtime allowlist and full security regression (R3/R4)

Add the10 intended cloud-sync functions to the authoritative runtime allowlist via a forward local migration. Inspect every function's ownership, SECURITY DEFINER, pinned search_path and grants. Restore hardening must preserve required narrow grants while denying tables/sequences/helpers/PUBLIC and schema creation. Include future migrations in the same contract.

Update the maintained scope test to assert the reviewed per-field HTTP/code contract and run **all** cases before final reporting. Retain zero-effect assertions. Update the independent expected runtime allowlist for explicitly reviewed failover and sync functions; never set expected = actual grants or grant everything to turn the test green.

Acceptance: the original full DB suite passes including post-hardening financial checks, and a real encrypted staged restore can use the normal runtime to read sync status, resume a pending batch and preserve its hash/ack state. Re-run all helper/table/sequence denial assertions previously hidden by the early failing expectation.

## Phase2 — Complete stock and financial correction invariants

### 2A. Live lot balances and FEFO

Design an append-only lot-allocation ledger scoped by authority/business/outlet/location/product, with explicit quantity/UOM precision, source movement and receipt provenance. Preserve historical movement hashes and immutable receipt contents.

- Record receipt lots and remaining quantity; define a safe migration policy for historical unallocated stock, with visible unknown provenance rather than fabricated expiry.
- Allocate eligible lots in deterministic FEFO order under stable locks. Define expiry/timezone and no-expiry policies explicitly; refuse unsafe ambiguity. Barcode/pack/recipe depletion must use the same authoritative units and conversions.
- Link every sale/prep/waste/transfer allocation. Returns restore the correct lot only where provenance/disposition permits; expired returned stock cannot silently become eligible for sale.
- Stocktakes reconcile intervening movements using versions/snapshots. Transfers preserve lot identity/provenance and deny cross-authority spending.
- Replace receipt-history-only screens with truthful received/remaining/allocated/expired figures, while preserving separate history. Paginate complete results and handle deletions/zero/stale snapshots.

Tests: two tills competing for last lot units, same-date ties, fractional/pack/recipe quantities, expiry boundary, repeated receiving, partial returns, disposal, transfer/retry, stocktake race, insufficient stock, historical provenance and rollback. Assert total lot quantities reconcile to product stock and every physical allocation is auditable. Add live API and rendered client tests.

### 2B. Tips, historical corrections and cash-up

Preserve tested remaining-item and unallocated-tip conservation. Finish the supported reconciliation workflows for allocated staff tips, payouts and corrections after the original drawer/cash-up has closed. Do not edit old submitted snapshots, delete entries or bypass current closed-drawer guards.

Use separately approved compensating events with explicit original-sale/payout/period/cash-up linkage, responsible actor, reason, maker/checker and current open recovery drawer/period policy. Derive every refund/tender/stock/tip/GL effect server-side, expose it for review before confirmation, and reconcile reports. Distinguish legitimate correction from replay of an old committed operation. If accounting is enabled, missing source coverage/opening policy remains a blocker.

Tests: repeated partial returns and full remaining void; allocated-versus-paid tips; payout reversal and shift-close race; closed period; cash shortage; multi-tender cents; duplicate approvals and retries; suspended approver; old receipt recovery. Prove original values plus all corrections conserve the promised balances without double payment/refund.

## Phase3 — Finish owner-friendly setup, network and service integration

Implement real Settings > Local Bar Network and the reduced Legacy Connect to Bar Server flow. Reuse existing installers, clients, replication and admin functions behind narrow typed privileged orchestration; do not add a generic renderer command-execution facility.

Required functional journeys:

1. Create server: OS/architecture/resource/disk/port/existing-authority checks; verified offline runtime/PostgreSQL/service prerequisites; protected dedicated identities/config/TLS; narrow firewall/service registration; resumable progress and final readiness. Refuse overwriting another business or system PostgreSQL instance. Elevate only the required guarded OS step.
2. Join: authenticated discovery plus manual fallback, pinned identity confirmation, named business/outlet, stable pairing intent and credential persistence. Discovery alone never establishes trust. A cashier cannot enroll database replicas or change membership.
3. Keep full copy: eligibility/resource checks, authorized consistent physical seed, protected storage/keys, streaming catch-up, lag and readiness. Resume/restart staging safely; do not replace a valid data directory. Windows7 stays client-only. Terminal count, replica count and coordinator membership are separate.
4. Devices: actual registered PC identity/role/state, last contact, active authority, replica status, durability and recovery limitations. Correctly distinguish offline, copying, catching up and ready.
5. Repair/reconnect/remove/replace: scoped diagnostics and non-destructive retry, address changes only through enrolled pinned hosts, old-device revocation and safe membership rules. No delete-data repair shortcut or unrestricted Make primary button.
6. Power/maintenance: service-start and sleep/hibernate checks, authorized keep-awake configuration while serving, sensible maintenance windows, drain/pending-operation warnings and safe shutdown guidance. Do not disable Windows security updates or claim to prevent forced power loss.

Use stable orchestration IDs/checkpoints for double clicks, process kills and reboot. Audit results; export redacted support evidence. All sensitive actions must be service/OS-enforced, not merely hidden buttons. Test using isolated service processes and bounded fake OS adapters, then real locally safe packaging checks. Leave actual reference-PC/SCM/firewall qualification pending where not safely exercised.

## Phase4 — Complete opening/readiness, session and authority routing

Trace **every** offered read/write/background path, not only the dedicated local cashier. Inventory global providers, login/logout/token refresh, settings, subscriptions/entitlements, help/support, updates, printing, reports and enabled add-ons. Explain any intentional replacement route; do not leave a button wired to cloud in commissioned-local mode.

- Trusted authority choice precedes cloud DB, queue and timers. Keep hotel/lodge online-first and shared restaurant/cloud selection working.
- Local errors never authorize fallback. Profile/authority/epoch/outlet changes cancel/fence old requests and isolate caches/journals. Uncertain receipts remain queryable by the original identity.
- Complete offline signed entitlement installation/validation and package/capability denial without exposing privileged keys or requiring hosted login. Reject expired/forged/revoked policy per the reviewed product contract; preserve legitimate local sessions when internet alone disappears.
- Readiness covers authenticated authority/write permission, catalogue, disk, clock, backup health and configured replica/printer policies. Separate blockers from warnings and enforce financial blockers at commit time. Never trust an old green screen.
- Every till has clear named-server/ready/reconnecting/unknown-sale/paused/stale wording. Internet/cloud lag should not repeatedly interrupt cashiers. Keep real safety refusals, approval errors and original-operation recovery visible.
- Printing follows committed receipts; print/reprint never re-submits a sale, and reprints are marked. Surface print uncertainty honestly. Physical printer/drawer/scanner qualification remains deferred, not the receipt and retry software.

Tests: internet failure independently from LAN/service/DB loss; cloud reachable while local unavailable; profile switch with pending work; revoked device/session/approver; stale readiness; background queue/mesh contamination; old or delayed responses; offline logout/restart; complete/empty/deleted/stale catalogue. Run relevant hotel/lodge/restaurant/PWA/public/cloud regressions without hosted writes.

## Phase5 — Independent backup, portable keys, recovery and upgrades

Snapshots are not PITR. Complete the planned supported PostgreSQL base-backup/WAL archive chain and recovery health checks, with a verified independent destination. Keep existing encrypted dump/restore tools useful without overstating their RPO.

- Configure an owner-authorized destination outside live replica storage, encryption, scheduled checks, retention, lag and failure reporting. Detect detached/unwritable/full/corrupt destinations and broken WAL chains. Never delete the only viable recovery chain.
- Provide owner-held encrypted recovery material sufficient on a replacement Windows identity; DPAPI from the original PC alone is insufficient. Protect export/restore/config/device/TLS trust and keys, avoid secrets in logs/renderer, and document rotation/revocation.
- Stage restore into a fresh non-serving target. Validate schema/versions, receipts, operation IDs, ledger/GL/stock/audit/outbox, scoped auth and R3 grants before activation.
- Detect acknowledged client receipts newer than the recovery point. A missing acknowledged receipt is a data-loss incident, not permission to invent a replacement sale. Recover immutable pending intents only by original identity.
- Implement separate replacement-client, replacement-standby and replacement-primary wizards. Require proven old-primary isolation and supported durability/promotion eligibility before writes. Missing keys/evidence must produce an actionable safe stop.
- Wire the signed local update helpers into real stage/preflight/checkpoint/apply/resume/status controls. Include compatibility ranges, mixed-version refusal, pre-update verified backup, pending intent/receipt preservation and honest schema rollback limits. Admin cannot always report no staged package after a valid stage.

Tests on this PC: real encrypted backup and restore into a second owned cluster, lost original DPAPI context via isolated test credentials, WAL gap and valid target-time recovery, corruption/tampering/wrong key, full destination, retention after corrupt package, revoked device, pending receipt reconciliation, interrupted seed/upgrade, signed/unsigned/wrong-product/corrupt/mixed-version package. Record actual measured recovery point/time for this synthetic environment; do not claim hardware RTO from it.

## Phase6 — Isolated operator training/rehearsal

Add Start training/rehearsal with a persistent obvious banner and TRAINING receipts. Separate authority/database, device credentials, journals, settings, backups, exports, cloud queue and any payment-provider state. Seed disposable products/staff and support the setup/pair/sale/receipt/recovery demonstration using training members only.

Entry/exit must preserve live drafts and block switching that strands uncertain live work. No default connection to live service, shared membership or hosted uploader. Do not simulate training failure by stopping the live server. Require a clear exit/cleanup checklist; deletion of unrelated data is never implicit.

Tests: explicit cross-mode API/IPC bypass attempts, reused credentials/authority IDs, shared-journal paths, live export contamination, training restore and app restart, pending live operation on entry. Check rendered banners/receipts and prove zero live financial/provider/cloud effects.

## Phase7 — Finish cloud preparation and safe existing-data transition

Preserve the agreed server-only bounded incremental uploader, nominal15-minute schedule, optional daily-only schedule, Sync now and nonblocking cash-up hint. Close R2/R3 before adding more transport UI.

- Derive uploader eligibility from the actual trusted active authority/durability/recovery state, not a renderer flag or stale role name. Account for controlled switchover, restore and old-primary return; stale workers cannot acknowledge/upload a conflicting authority history.
- Preserve whole financial commit groups, immutable canonical bytes, batch identity and hash. Validate complete event payload/source dependencies for required cloud reporting; an event label or aggregate alone may not reconstruct business truth.
- Distinguish prepared/exported/received/validated/ingested, highest observed versus contiguous acknowledged prefix and per-outlet gaps. Only authoritative ingested acknowledgement advances applicable progress. No skip/delete conflict escape hatch without an audited reviewed policy.
- Exercise receiver duplicate/out-of-order/partial/changed-hash/changed-reference behavior, worker crash after reservation/send/receiver commit/local acknowledgement and restart. Verify bounded retries/backoff and durable failure state.
- Keep approved hosted transport disabled/refused. Do not deploy the proposed receiver or claim Supabase reports are updated. Hosted activation is a separate authorized project.

For existing-business transition, build a read-only source inventory/export specification and deterministic **offline dry-run importer** against synthetic files. Preserve source IDs, historical financial/audit lineage, outstanding credit/voucher custody, catalogue/UOM, stock, opening GL, cash-ups, queues and unresolved operations. Produce reconciliation totals/hashes, rejected rows and repeatable import receipts; reruns cannot duplicate data.

Activation requires independently verified old-cloud-writer handover across desktops/Legacy/PWA/queues and pending ambiguous cloud outcomes. A local preference cannot fence old cloud writers. Implement the preparation and proposed handover contract/test fixtures, but leave live activation blocked until separately authorized source/hosted work exists. Once local trading begins, do not offer a blind rollback to the old cloud database.

## Phase8 — Close the full feature and acceptance inventory

Review every64 feature row against actual Modern/Legacy UI, fixed IPC, client, command/query registry, SQL and reports. Use explicit offered feature scope and package rules; do not count a hidden or missing function as completed because the registered command mapping test passes.

Specifically reconcile current Accounting operation inventory with local source-to-subledger-to-GL/report behavior, AP locks/reversals, bank-file import/reconciliation, budgets, payroll privacy, tax working-paper versions, period locks, opening readiness and export completeness. Preserve actual external bank payment/statutory filing boundaries. Cover imports/attachments/audit/support/settings and every locally offered customer/loyalty/voucher/control/workforce workflow. No dummy records, cached zeros or silent truncation.

For every row provide: actual entry point, source functions, scope/capability/package checks, stable write identity, read completeness/version semantics, ledger/audit/report effect, unknown/rejection/retry/restart path, actual executed positive/negative evidence, remaining gate. Missing software is FAIL/PARTIAL; unknown execution is UNVERIFIED; justified external unavailable behavior is documented separately.

Implement a deterministic multi-process real-command load/fault harness for A20/A32. Run the required50,000-sale/42-day business-time simulation where feasible, using only identified disposable targets and reconciling operation/receipt/tender/stock/tip/voucher/credit/GL/outbox invariants. Simulated business time is not42 days of wall-clock soak. Record latency distribution and capacity limits rather than extrapolating from A03's100 duplicate requests.

Cover owned-process termination, delayed/lost replies, dropped receiver bodies, corruption/full disk within isolated storage, interrupted upgrade/seed/backup, clock changes through injectable test clocks, stale epochs and returned old hosts. Never change the system clock or stop unrelated services to run a simulation. Keep reference power/multi-PC/peripheral tests deferred.

## Verification and completion rules

Inspect actual package scripts and test wrappers before running them. Use the guarded `bar-local:test:isolated` runner, unique fresh clusters, target identity and owned processes. Never reuse another chat's DB or set hosted credentials in a reset harness. Keep fsync/full_page_writes/synchronous_commit and disk guards. A passing probe that reproduces a defect is not a fixed-feature pass.

Relevant current scripts include:

- `npm run bar-local:test:isolated`
- `npm run bar-local:typecheck`
- `npm run test:bar-local-electron`
- `npm run test:bar-local-storage`
- `npm run test:bar-local-storage:electron`
- `npm run test:bar-local-startup:electron`
- `npm run test:bar-local-ui`
- `npm run typecheck:renderer`
- `npm run typecheck:bar-local-finance`
- `npm test --prefix legacy-pos`
- `npm run build:hospitality-pos`
- `npm run build --prefix legacy-pos`
- `npm run test:bar` and affected cloud-mode regressions.

Native Electron/Windows/browser access may need normal desktop permissions. Use the installed browser through supported overrides; do not download silently or skip browser checks because the package default path differs. Capture final exit status, test counts, skips and logs. If a wrapper times out, identify and stop only its verified owned descendants; do not accept a printed summary as a normal exit.

Run focused checks during edits, then the complete affected suites once integrated source is stable. Resolve product/contract failures with meaningful regressions. Document the deferred guide failures separately without changing PDFs, frozen source hashes or approval manifests. Review red rendered/source tests individually; never label every failure documentation by assumption.

Update PROJECT_STATE.md for real architectural/release changes, internal runbooks and MANUAL_IMPACT.md. Keep old dated reviews historical. Produce a new105-row coverage matrix, exact reviewed hashes, reproducible fixture commands/logs and a failure matrix with explicit environment/topology.

Final report must separate:

1. Software implemented and independently reproducible on this PC.
2. Remaining software/platform/coordinator/source-authorization blockers, if any.
3. Deferred physical equipment qualification.
4. Deferred customer documents/packaged approval.
5. Disabled hosted ingestion and unperformed customer cutover/release.

Do not claim all local software complete while R1–R7 or any original feature/acceptance requirement has an unimplemented local component. If mature Windows coordinator support cannot be established, report that specific architectural blocker and keep automatic failover unavailable; do not substitute homemade consensus or an unqualified lease argument. Continue all other independent work instead of stopping at that blocker. No completion percentage, production-readiness claim or deployment approval can be inferred from a build or a partial suite.

## Current phase status — 28 October 2026 continuation

**Phase 1:** R1 recoverable owner setup and device pairing are implemented in Modern and Legacy local clients, local service routes and migrations 0067; protected request replay, wrong-proof/changed-payload denial, duplicate prevention, operator resume controls and restart recovery have focused coverage. The guarded full isolated run passed all 205 service tests, including migration 0067/0068, runtime privilege, provisioning recovery and forged-scope cases (EV-146). R2 response-body deadline/byte-limit/shutdown tests pass 3/3. Phase 1 source and local DB coverage for these changes is verified; installed setup and full process-kill/platform acceptance remain open.

**Phase 7:** the synthetic offline envelope validator is implemented and currently passes 11/11. It requires complete business/outlet inventory, timezone-qualified snapshot time, a business owner on every row, outlet scope on operational collections, unique scope identities, valid exact-decimal control definitions and resolution receipts for any pending cloud operation; explicitly declared source links must resolve exactly once, honor nullability and pass their declared business/outlet scope. It remains a validator only; a source-specific exporter, proof that relationship rules cover every source FK, ledger/custody reconciliation, target-schema plan, idempotent importer and old-writer fencing are still open. No Lounge data has been read or imported.

**Phases 2–6 and 8:** remain open as described above. The committed-local main-process early return is now covered: local authority loads before cloud DB startup and skips cloud queues, mesh, timers and updater; an unreadable local profile quits before cloud initialization (EV-156). This does not complete profile/session/cache and shared-renderer route acceptance. The local workflow UI has focused rendered checks for finance, workforce tips (including closed-shift payout recovery), staff/loyalty, drawer handover, lot stock operations and support history (EV-147, EV-154/155). The full service suite after migrations 0071/0072 applied successfully but failed 2 of 208 stale client/migration parity assertions; the corrected focused suite passed 11/11 and migration 0073 tip/security tests passed 2/2. Do not claim a clean full service suite for the latest migrations. Remaining local software includes other closed-shift financial corrections, independent WAL/PITR backups, signed update orchestration, isolated training mode and broader fault/load acceptance. Lounge source transition and fencing require Supabase/source access and remain excluded by the user; real host/hardware and multi-PC checks are also excluded. Customer PDF/quick-start/screenshots/manifest/package-guide work is pending by direction and non-blocking for a software release; local-authority commissioning remains NO-GO until independent operations/data gates pass.

### 29 October follow-up: local payout query contract defect closed

Review confirmed that migration 0073's `workforce.tip_payouts` response lacked the authenticated `scope.role` required by the production HTTP response validator. Migration 0074 now returns the role from the authenticated session, keeps direct runtime invocation revoked, and has an HTTP regression. Focused service tests passed 2/2; the full guarded isolated PostgreSQL suite passed 209/209 through migrations 0001–0074, and its successful disposable cluster stopped cleanly and was retired after identity verification (EV-161). This supersedes the prior statement that the post-0073 full suite was unavailable. It closes only the query contract issue; all other open phases above remain open.

### Phase 3 network diagnostics follow-up — 28 October 2026

The Modern Local authority administration panel now displays the service-generated client endpoint/scope, separate endpoint reachability/liveness/readiness, database reachability/name, TLS expiry state, write-authority basis and automatic-failover evidence. The rendered copy explicitly says these diagnostics do not establish trading readiness or failover safety. Focused admin-response coverage passed 3/3 and `npm.cmd run typecheck:renderer` exited 0. This is a diagnostics surface only; server installation orchestration, enrolled-device lifecycle, real LAN checks, backup/replica recovery and physical host qualification remain open.

### R1 finalization follow-up — 28 October 2026

Modern and Legacy startup now reconcile a leftover protected provisioning stage after a committed authority/credential write: only an exact staged-token match is cleared; a mismatch is preserved. Runtime boundary regressions passed 21/21 Modern and 8/8 Legacy, and both production app builds passed. This closes one previously missing local file-finalization window but does not close the full crash matrix or the isolated DB privilege verification.

### Current guarded DB preflight after product builds — 28 October 2026

The latest system-volume read is 0.68 GiB free after the Modern/Legacy production builds. Do not start the isolated PostgreSQL suite until the normal 4 GiB preflight can pass; no cluster was started at this headroom. Do not delete retained fixtures or generated outputs to manufacture room. Full DB verification remains pending.

### Guarded DB preflight recheck — 28 October 2026

Historical note: after a focused renderer test, `Get-PSDrive C` reported 2.06 GiB free and the guarded runner did not start. Later user-authorized removal of only `%TEMP%\MicrosoftEdgeDownloads` created sufficient space; the unchanged 4 GiB guard then passed and the full isolated suite completed successfully (EV-141/146). Preserve both earlier and later evidence; do not weaken the guard.
