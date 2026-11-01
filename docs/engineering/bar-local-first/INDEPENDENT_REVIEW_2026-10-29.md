# Independent follow-up review — 29 October 2026

**Software completeness: CHANGES REQUIRED. Customer commissioning: NO-GO.**

Luna stopped on a usage limit in turn `01a1853d-a56e-7ff1-84ff-d02ba41f1b6a`; this is the independent review of that stopped checkpoint, not a claim that the author finished. Several real defects found during monitoring are now repaired and independently retested. The remaining main blockers are missing product workflows and incomplete acceptance, rather than a failing selected regression suite.

The complete coverage inventory is [INDEPENDENT_COVERAGE_2026-10-29.csv](INDEPENDENT_COVERAGE_2026-10-29.csv): all 32 acceptance requirements, 64 feature rows and 9 work packages. It retains unchanged historical evidence and explicitly identifies the narrower new independent tests. Whole-row status is 1 PASS, 98 PARTIAL, 3 FAIL and 3 UNVERIFIED. These are acceptance classifications, not a percentage of code complete. A03 retains its previously verified bounded concurrency case; no other entire feature is promoted merely because its test file belongs to a passing suite. Historical source descriptions/line anchors remain historical unless the current finding or checkpoint explicitly supersedes them.

## Findings that still require action

### F1 — P1: selecting this laptop as server does not install the local system

`src/renderer/src/App.jsx:1515` offers **Set up this PC as the server**, but line1519 requires the service/database already installed; line1521 requests a service address and line1522 a one-time setup secret. The form then calls the existing owner provisioning API. `src/main/bar-local/electronRuntime.js:90` changes the fresh product's startup preference, and `src/main/index.js:4775` fences cloud startup; neither provisions PostgreSQL or the service.

This does not satisfy the user's required journey: register a new Bar on this laptop, choose it as server, and have the application safely prepare its local dependencies. Existing service/installer scripts are useful components, but a settings-first nontechnical owner still cannot complete this journey without external technical work. Finish bundled offline dependency verification, protected installation/TLS/configuration, resumable progress, readiness, owner provisioning and safe recovery. Preserve existing installations and other products. This is local software work; the lack of extra PCs does not explain the missing orchestration.

### F2 — P1: a second encrypted dump folder is not the planned recovery system

`services/bar-local/src/operations/backup.ts:856` correctly states `restore_verified: false`, and line857 explicitly says its encrypted pg_dump package contains no WAL/PITR chain. The optional secondary copy at line907 improves redundancy but may remain on the same disk. Path/junction checks prevent several unsafe configurations; they do not prove independent media or recoverability.

Independent tests verify encryption/tamper handling, guarded restore/update primitives and runtime privileges after hardening. They do not complete continuous WAL/PITR, owner-portable recovery material, guided isolated restore/replacement, verified recovery-point selection, old-primary fencing, or measured recovery objectives. Implement local orchestration and isolated restore evidence before relying on it as the planned recovery product. Keep physical second-machine/power qualification pending. Never advertise dump-copy success as a recovery guarantee.

### F3 — P1: full authority lifecycle, failover and training remain incomplete

`services/bar-local/src/operations/replication.ts:277` says this service implements no automatic failover/consensus, and line415 reports no supported automatic coordinator evidenced. Manual physical-replication and guarded promotion primitives do not satisfy A22/A24/A31. Do not enable the test witness or waive fencing to make a demo work. The complete two/six-device commissioning/removal/replacement product and supported coordinator remain partial; physical host qualification is explicitly deferred.

The technical plan's current local-only scope also identifies isolated training/rehearsal, full profile/session/cache/shared-renderer isolation, remaining closed-shift corrections and installed update/recovery orchestration as open. Fresh local setup, fixed IPC and a committed-local early return are meaningful progress, but not proof of every shared route's isolation. Training fixtures used by tests are not the owner-facing training authority required by A30. The paid-tip recovery-drawer correction in0073 is a bounded improvement, not all historical sale/cash-up/tip reconciliation.

### F4 — P2: synthetic passing checks still leave end-to-end acceptance gaps

A01/A04–A08/A11–A12/A14–A16/A20/A24/A28–A32 remain partial or unverified for their full stated scope. The coverage matrix carries the row-specific limits. Required work includes all actual operator flows through renderer/IPC/client/service/DB, negative roles and approvals, ambiguous responses and restart, stock/GL/audit reconciliation, full local failure/load evidence and complete product compatibility. The original source-specific cloud transition/export/import and old-writer fence remain incomplete and deferred from this local-only pass. A new empty Bar never imports an existing business implicitly.

Author evidence EV-160 reports a non-green broad renderer IPC typecheck and a Windows GPU runtime failure preventing the optional hidden-renderer startup smoke. Those are not independently rerun here, and their results must not be described as passing. Targeted service compilation and runtime tests passing does not establish repository-wide TypeScript cleanliness or installed Windows compatibility.

## Previously reproduced defects: current disposition

- **Owner/pairing lost-response recovery:** 0067 introduces stable proof-bound provisioning and both clients stage protected credentials. Current independent real API replay/conflicting-proof cases pass. Full process/OS checkpoint fault windows remain partial.
- **Cloud response body timeout:** the real controller retains its deadline through bounded body consumption and aborts on shutdown. Three independent loopback regressions pass, including durable failure and lock release.
- **Cloud runtime grants after restore:** 0068 registers the explicit narrow functions. The independent current test applies actual restore hardening and verifies the exact callable surface and negative privileges.
- **New lot command grants after restore:** 0070 initially omitted the two commands from the allowlist; the earlier independent full run failed. Forward migration0072 now registers them; the current independent post-hardening exact privilege test passes. No blanket grant was used.
- **Legacy lot-screen crash:** earlier browser runs twice reproduced undefined `displayQuantity`. Its helper now exists, and the independent rendered Legacy waste/release workflow passes.
- **Tip-payout query metadata:** 0073 omitted authenticated role and failed the production response validator. Forward0074 restores session-derived role and keeps direct helper access revoked. The current independent `api-service` test traverses the authenticated HTTP response validator successfully. Do not repeat the historical failure as still present.

## Executed evidence

New independent verification after the author stopped:

| Check | Result | Evidence |
|---|---|---|
| Fresh guarded PostgreSQL17.6, migrations0001–0074, six selected real test files | **10/10**, build/bootstrap/stop exit0 | `.tmp/bar-isolated-tests/2026-10-29T03-10-28-879Z-117c3d64/{results.json,service-tests.log,bootstrap.log}` |
| Real Modern/Legacy HTTP clients, original-journal lost-reply recovery, provisioning, post-restore exact runtime privileges, FEFO/expiry/lot operations, cloud body failures | Included in10 above | Same log; exact test names retained |
| Legacy lot, shared finance and operator/tip browser fixtures | **3/3** | `evidence/independent-2026-10-29/final-focused-ui.log` |
| Real package `test:bar-local-electron` | **89/89** | `final-electron-tests.log` in same evidence directory |
| Backup/update operations helper tests | **30/30** | `final-operations-tests.log` |
| Actual Windows junction/path and backup-schedule regressions | **3/3** | `final-windows-source-tests.log` |

The operations invocation also named a nonexistent `windows-install.test.mjs`; it emitted only the actual30 operations tests. No installer test result is attributed to that absent file. The subsequent explicit existing Windows test files produced the separate3/3 result above.

The guarded DB runner created a new nonce-named, identity-checked loopback cluster, stripped hosted DB environment, preserved fsync and its4GiB preflight, stopped it positively and retired only its own successful disposable data. No application database or running Bar instance was used or disturbed. No hosted migration/write, ingestion activation, live cutover, product edit, installation, release, commit/push or destructive cleanup occurred.

**Author evidence checked, not independently rerun:** the latest full run `.tmp/bar-isolated-tests/2026-10-29T01-29-09-545Z-eaf3f32b` emitted214/214 with all runner phases exit0. Prior209/209 through0074 was also read from logs. Earlier independent207/205/2 through0070 remains historical; it is not the result of the repaired source. Current independent selected checks validate the repaired boundaries but do not replace all214 tests or prove every acceptance row.

Browser fixtures render real components but mock IPC/service responses. Windows path helpers are not installed service qualification. Test restore primitives are not replacement-host recovery. External card/mobile/bank/hotel authorisation still needs its external authority; locally recorded tenders do not prove external settlement. Hosted financial ingestion remains disabled; exports and local fake-receiver acknowledgements do not mean Supabase was updated.

Customer manuals/quick-start/screenshots/approved manifest, additional PCs, Windows7/peripherals and physical power/LAN qualification remain deferred. The user's later instruction permits pending items to be non-blocking for a scoped software release; this review does not override that scope choice, but it does not establish a release was performed or approve customer commissioning. No source percentage or unconditional fully-offline claim is justified.

See [REMEDIATION_PROMPT_2026-10-29.md](REMEDIATION_PROMPT_2026-10-29.md) for the next implementation assignment. The monitoring heartbeat is to be paused after delivery of this review, as requested; resume explicitly for a new implementation checkpoint.
