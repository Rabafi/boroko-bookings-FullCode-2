# Bar local authority — independent review handoff

Date: 21 October 2026 (Africa/Gaborone)

## 22 October 2026 continuation checkpoint

Date: 22 October 2026 (Africa/Gaborone)

This is a **source and build checkpoint, not a release or customer commissioning**. Nothing below should be read as an installed, hardware-qualified or coordinator-qualified result.

### Completed in this continuation

- Local admin routes for status, backup, verify, replication, durability, switchover and update now exist behind authentication plus `settings.manage`; backup actions additionally require `backup.manage`. Destructive replication is loopback-only and backup paths are server-configured rather than client-supplied.
- Local migration 0040 allowlists the admin status/audit functions.
- Windows packaging source is present (9 PowerShell scripts plus a provisioning Node script) and syntax-checked only; it was not installed or executed as a packaging run.
- Modern/Legacy panel split and non-cash tenders are implemented, with explicit `locally_asserted` versus `provider_confirmed` evidence labelling.
- Legacy gained tab transfer/split/merge plus stock, purchasing, customer/voucher, control, workforce, accounting and administration panels.
- Preload admin contract typing was fixed.

### Admin security and fail-closed behaviour

- A database status failure does not report healthy, and an unreadable backup destination does not return an empty list.
- Backup manifests are verified by checksum and AES-GCM decryption.
- The admin flow surfaces an audit-write "possible completion" warning when the outcome cannot be confirmed.
- Switchover records a reason plus start and result audit entries.
- Regression coverage includes 401, 403, path traversal, missing resources and 409 conflicts.

### Verification performed

- `services/bar-local`: 132/132 passed in 594.1s against an isolated PostgreSQL 17.6 loopback cluster, with migrations applied through 0040.
- Modern workspace suite: 40/40 passed.
- Legacy: 219 source checks and 43 Node tests passed.
- Modern and Legacy builds passed. Preload, renderer, main and service typechecks passed.
- **Main-surface typecheck is NOT clean**: 5,385 diagnostics. The sidecar is `docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-22T11-20-26-869Z.jsonl`.
- Packaging evidence is syntax only. `git diff --check` passed, with CRLF warnings.

### Current status

- Feature matrix: 64 rows — 28 locally implemented, 35 partial, 1 external pending, 0 not implemented.
- Acceptance: 18 partial, 12 not run, 1 verified (A03), 1 pending user direction.
- Do not imply installed, hardware or coordinator qualification. A03 is verified; the other acceptance rows are not.

### Known Legacy caveat

The destination outlet UUID is entered manually, and the tab line shape is assumed from `tab.get` until a live service click-through confirms it.

### Remaining gaps

- Installed Windows/PostgreSQL/TLS/SCM deployment and service lifecycle.
- Real multi-node streaming, switchover, automatic failover and replica coordination.
- Replacement-host restore and PITR, and a scheduled backup destination.
- Windows 7, physical receipt printer/cash drawer/scanner hardware, multi-till operation, power loss and soak testing.
- Customer cutover and hosted ingestion.
- Customer PDF, quick-start, screenshots, approved-manifest and packaged-guide work was deferred by the user and remains deferred.

### Boundaries

The worktree is dirty with unrelated TypeScript-migration, company-login and public-domain work. No reset, commit, push, deploy or cutover was performed. After refresh, use `ACCEPTANCE_RESULTS.md`, `EVIDENCE_LOG.md`, `FEATURE_CONTRACT_MATRIX.csv` and `ACCEPTANCE_MANIFEST.csv` for detailed results and hashes. These documents are not claimed to be signed or release-approved.

## Historical 21 October 2026 handoff

The sections below are the historical 21 October record and are superseded for status by the 22 October checkpoint above.

## Review request

Independently review the current local Bar implementation against `TECHNICAL_PLAN.md`, the complete `FEATURE_CONTRACT_MATRIX.csv`, and A01–A32 in `ACCEPTANCE_MANIFEST.csv`. Treat this as a source and isolated-test checkpoint, not a commissioning or production-readiness review. Use `REVIEW_PROMPT.md` for required coverage and the exact current-tree hash manifest in `CHANGED_FILE_HASHES.csv`; the continuation-specific hashes are in `CONTINUATION_SHA256_2026-10-21.csv`.

The 21 October cashier increment adds the service-scoped `menu.promotions` query, promotion-code use in both Modern and Legacy local cash sales, exact-payload/durable-operation manager approval above the configured threshold, a service-enforced maximum, and `settings.manage` controls for the approval threshold and maximum. Local migration 0038 provides the active-business-date promotion snapshot. This did not route every Bar product screen or complete the local-first plan.

The follow-on LAN catch-up increment adds 15-second catalogue checks to both local cashiers. Legacy consumes the authenticated event cursor, validates device/business/outlet scope, handles retention gaps with a complete paginated snapshot, and advances the cursor only after successful catch-up. Both workspaces refresh promotion policy, clear unsent cart/promotion state on relevant changes, and block sale commit when refresh cannot verify current state.

## Verified in this checkpoint

- `services/bar-local` isolated PostgreSQL 17.6 suite: 113/113 passed through local migration 0038. It used `BAR_LOCAL_TEST_DB=1`, a dedicated `bar_local_test_codex` database, dedicated migrator/runtime roles, loopback port 55441 and an explicit cluster-data path. The local cluster was stopped after testing; no hosted database was used.
- After the LAN catch-up update, a fresh disposable PostgreSQL 17.6 loopback cluster passed the full 113/113 service suite through migration 0039. A focused API regression also passed with two event rows sharing one commit sequence while requesting a one-commit page. That scratch cluster was stopped and removed.
- Focused cashier-promotion query regression: 1/1 passed. It checks that manager configuration can retain future definitions while the cashier query returns only currently active business-date promotions and enforces authenticated scope.
- `npm.cmd run test:bar-local-electron`: 27/27 passed. Includes estimator, Modern runtime, recovery and static Modern/Legacy workflow assertions; it is not a rendered authenticated service click-through.
- `npm.cmd run legacy-pos:test`: 219 source checks and 32 Node tests passed, including event-feed scope and transport coverage.
- `npm.cmd run build:hospitality-pos`, `npm.cmd run legacy-pos:build`, `npm.cmd run typecheck:renderer` and `npm.cmd run bar-local:typecheck` passed. Modern build reports existing mixed static/dynamic import warnings.
- `git diff --check` passed; Git emitted existing line-ending normalization warnings.

## Incomplete implementation and unverified gates

- The complete existing Modern POS/domain routes, background jobs and all Legacy Bar data paths do not yet route through the local authority. Existing shared product screens and many enabled add-on workflows remain outside the dedicated local workspaces.
- There is no supported offline PostgreSQL/service installation bundle or Windows service lifecycle. Owner creation assumes a reachable preinstalled service. Actual network-isolated commissioning and reboot recovery were not exercised.
- Legacy now has source-level published-catalogue event catch-up and complete snapshot replacement, but installed LAN/reconnect, concurrent menu-publishing and Windows 7 qualification remain unverified.
- There is no qualified replica coordinator, synchronous multi-host failover/fencing, independent installed automatic backup destination, replacement-host restore, 50,000-sale simulation, eight-hour hardware soak, or power-loss test.
- Actual receipt printer, cash drawer and scanner hardware were not used. No live UI-to-PostgreSQL click-through for the new promotion approval or discount-policy settings was performed.
- A19 is `pending_user_direction`. At the user's request, PDF, quick-start, screenshot, approved-manifest and packaged offline-guide edits/checks were skipped and explicitly recorded as pending. No customer PDF was modified.

## Boundaries

No hosted Supabase migrations, writes, deployment, configuration change, customer cutover, release or push were performed. Hosted financial ingestion remains disabled; local exports are not cloud synchronization. HotelOS, LodgingOS, Manager PWA, public booking and existing cloud-mode contracts were not intentionally changed by this increment.

See `IMPLEMENTATION_REPORT.md`, `ACCEPTANCE_RESULTS.md`, `EVIDENCE_LOG.md`, `MANUAL_IMPACT.md`, `SECURITY_AND_FAILURE_REVIEW.md`, and `CUTOVER_AND_RECOVERY_RUNBOOK.md` for the detailed current implementation and release boundaries.
