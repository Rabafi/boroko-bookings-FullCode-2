# Bar local-first cloud synchronisation - 27 October 2026

Implementation and verification record for the server-only cloud upload path. This document separates what is **implemented and exercised on this development PC** from what is **customer-ready**. It is not a release approval.

Authorization boundary for this work:

- No hosted Supabase change, migration, deployment, ingestion or customer cutover was performed.
- No commit, push or release was performed.
- The receiver contract in `services/bar-local/db/cloud-receiver/0001_cloud_ingest.sql` is a **proposed** contract, exercised only against disposable local PostgreSQL clusters created by the isolated runner.
- Physical multi-PC, Windows 7, peripheral/power qualification and customer PDFs remain deferred by the user's direction.

## What was added

| Area | File | Purpose |
|---|---|---|
| Durable queue/state/receipts | `services/bar-local/db/migrations/0064_cloud_sync.sql` | `cloud_sync_config`, `cloud_sync_state`, `cloud_sync_receipts`; take/next/sign/uploading/fail/ack/run/status/config functions; grants limited to `bar_local_runtime` |
| Uploader and scheduler | `services/bar-local/src/operations/cloudSync.ts` | HMAC signing, advisory-lock single uploader, bounded drain, retry, 15-minute/daily schedule, non-blocking final pass, honest status |
| Service wiring | `services/bar-local/src/server.ts`, `src/app.ts` | controller lifecycle; final sync requested only after a committed cash-up |
| Admin API | `services/bar-local/src/admin.ts` | `GET /v1/admin/cloud-sync`, `POST /v1/admin/cloud-sync/config`, `POST /v1/admin/cloud-sync/run`; credential redaction; capability enforcement |
| Config | `services/bar-local/src/config.ts` | `BAR_LOCAL_CLOUD_SYNC_TRANSPORT/KEY/KEY_FILE/KEY_ID/TIMEOUT_MS/MAX_BATCHES`; default transport `disabled` |
| Proposed receiver | `services/bar-local/db/cloud-receiver/0001_cloud_ingest.sql` | receive/validate/ingest states, manifest and payload hash verification, per-event uniqueness, late-sequence recording |
| Modern client | `src/main/bar-local/client.js`, `src/main/bar-local/electronRuntime.js`, `src/preload/index.js`, `src/renderer/src/types/desktop-api.d.ts` | validated admin HTTP methods, IPC channels, preload bridge, renderer typing |
| Modern UI | `src/renderer/src/components/hospitality-pos/BarLocalAdminPanel.jsx` | status, configuration, "Sync now", honest failure/pending messaging, corrected export copy |
| Legacy client/UI | `legacy-pos/src/main/bar-local/client.js`, `runtime.js`, `src/main/index.js`, `src/preload/index.js`, `src/renderer/src/components/BarLocalAdminPanel.jsx` | same contract and panel in the Electron 22 app |
| Two-authority guard | `src/main/bar-local/electronRuntime.js`, `legacy-pos/src/main/bar-local/runtime.js` | refuses local setup/pairing in a process that already started the cloud workspace (`CLOUD_WORKSPACE_ACTIVE`) |

### Correctness properties enforced in the database

- A batch is created only from **committed** outbox rows, one outlet at a time, oldest commit sequence first.
- The batch limit is a target, not a hard cap: `cloud_sync_take_batch` always reserves **whole commit-sequence groups**, so one financial commit is never split across two uploads. A group larger than the limit is uploaded intact.
- Creating a batch is not an acknowledgement; `ready`/`prepared` only means durably reserved.
- `received` and `validated` receipts are recorded but leave the batch pending; only `ingested` sets `status='acknowledged'`, `acknowledged_at` and the watermark.
- A receipt for the same batch with a different manifest hash or receiver reference is refused (`EXPORT_ACK_HASH_MISMATCH`, `EXPORT_ACK_CONFLICT`), never overwritten.
- `cloud_sync_config_set` has partial-update semantics: omitted keys keep committed values, explicit `null`/empty clears the receiver URL or signing key, and wrong JSON types fail with `VALIDATION_FAILED` instead of a raw cast error.
- The body sent to a receiver is the PostgreSQL canonical manifest text with signature fields merged in; JavaScript never re-encodes the manifest, so numeric scale (`12.50`) cannot become `12.5` and break the receiver's manifest hash.
- Worker start resumes the committed `next_due_at`; with no due time it waits for the configured schedule rather than uploading a few seconds after every restart, so a "once daily" choice stays daily. "Sync now" and the cash-up final pass are immediate.

## Requirement coverage (as at 27 October 2026)

Statuses are `PASS`, `FAIL`, `PARTIAL`, `UNVERIFIED`. "PASS" means the stated behavior was exercised by a named check on this development PC, not that the product is qualified on customer hardware.

### A. Authority and mode selection

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| A1 | Bar financial mutations use the local PostgreSQL authority; failure never falls back to Supabase | PASS | Isolated suite 161/161 through migration 0064; runtime allowlist and durability checks included |
| A2 | Modern first-run choice is resolved before cloud startup; committed local authority wins | PARTIAL | Source + startup tests; an actual installed app relaunch/transition was not performed |
| A3 | Hotel/lodge profiles stay online-first and are not converted to local Bar authority | PARTIAL | Cloud authority paths unchanged and no automatic local fallback exists; not exercised on a hotel/lodge install |
| A4 | Restaurant/cloud installs are not forced into Bar mode | PASS | Explicit workspace choice; unconfigured installs keep the cloud path (`TAKEOVER_2026-10-27.md`) |
| A5 | Legacy keeps its cloud mode and only uses local mode when explicitly commissioned | PASS | Legacy tests 219 source + 50 Node; installed transition unverified |

### B. Offline and topology

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| B1 | Tills trade offline against the local Bar server | PARTIAL | Cashier/sale/cash-up contracts pass in isolation; no physical network partition test |
| B2 | One designated server performs uploads; clients cannot upload or acknowledge | PASS | `not_primary` and `busy` outcomes asserted; client bridge has no upload authority |
| B3 | Variable till counts (2 and 6) | UNVERIFIED | Deferred physical multi-PC testing |
| B4 | Physical replicas with honest durability/recovery guarantees | PARTIAL | Replication status/durability/manual switchover endpoints exist; no automatic fencing/failover or installed replica |
| B5 | Windows 10/11 host service and database lifecycle | UNVERIFIED | Scripts are sources only, syntax-checked, not installed or qualified |
| B6 | Windows 7 Legacy POS client-only | UNVERIFIED | Deferred by user; Electron 22 host not qualified |

### C. Cloud synchronisation

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| C1 | Everyday reads/writes stay local; upload is out of band | PASS | Uploader is a separate server-side timer/manual pass over committed outbox rows |
| C2 | Single designated uploader | PASS | `networkRole !== single_host` returns `not_primary`; advisory lock returns `busy` |
| C3 | Incremental confirmed changes in bounded batches, nominally every 15 minutes | PASS | `cloud-sync.test.mjs`: bounded pass leaves pending work; drain to zero; whole commit groups asserted |
| C4 | Final sync requested at cash-up without blocking or changing the cash-up result | PARTIAL | Fire-and-forget after `committed_local`; code path cannot delay the response, but no UI latency measurement |
| C5 | "Sync now" control | PASS | Admin route + Modern/Legacy client + panel assertions |
| C6 | Optional daily-only schedule | PASS | `nextDueAt` unit test (same day and next day) and config route assertions; `firstRunDelay` proves a restart resumes the committed due time and does not upload on every start; the timer itself is not time-travelled end to end |
| C7 | Durable retry/checkpoints, duplicate protection, authoritative acknowledgements | PASS | Transport failure keeps `status='ready'` with `transport_error` and incremented attempts; API replay is idempotent; receiver refuses changed payloads |
| C8 | Honest last-success, pending and failure status | PASS | Route assertions: `last_success_at` null while failing, `failed_batches > 0`, `pending_events > 0`, `last_final_sync_state='failed'` |
| C9 | A local export file is not a cloud upload or acknowledgement | PASS | Export copy corrected in both panels; export batches are uploaded and acknowledged separately |
| C10 | Hosted Supabase ingestion activated | FAIL | Intentionally not authorised: transport defaults to `disabled`, `approved` refuses with `CLOUD_SYNC_TRANSPORT_NOT_AUTHORISED`, no receiver deployed |
| C11 | Operator recovery for a permanently conflicting batch | PARTIAL | Failure is durable, visible and retried; there is no quarantine/skip action yet. Not reachable without a receiver, which is not deployed |

### D. Guardrails

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| D1 | Settings are capability- and tenant-scoped server-side | PASS | `settings.manage` enforced in `cloud_sync_config_set`; a `pos.view` cashier receives 403 on status/config/run |
| D2 | Configuration validated; no credential leakage to renderer or logs | PASS | Loopback-only `local_test`, URL/limit/schedule validation, redacted receiver URL, signing secret never returned |
| D3 | Financial uncertainty, authorization and unsafe stock/cash fail closed | PASS | Existing isolated suite (approvals, shortages, closed drawers, replay) 161/161 |
| D4 | A visible control is never the enforcement point | PASS | UI gating is additive; every route and function rechecks capability and scope |

### E. Client surfaces

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| E1 | Modern and Legacy use the same authoritative contract | PASS | Shared service routes; both clients validate responses and reject unverified shapes |
| E2 | IPC/preload allowlists and renderer typing are narrow | PASS | Electron test asserts the exact channel list; renderer typecheck passes |
| E3 | Cashier screens stay quiet; technical detail stays in administration | PARTIAL | Admin panel is capability-gated and cashier messaging is plain; no full operator UAT |

### F. Implementation preference

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| F1 | New service/DB infrastructure is TypeScript and integrates with the JavaScript apps | PASS | `cloudSync.ts`, `config.ts`, `admin.ts` compile under the service `tsc` build; JS clients call through validated adapters |

### G. Documentation and release gates

| # | Requirement | Status | Evidence / limit |
|---|---|---|---|
| G1 | Dated requirement coverage with retained evidence | PASS | This document plus the evidence directories below |
| G2 | Manual-impact decision recorded | PASS | `MANUAL_IMPACT.md`, 27 October cloud synchronisation section |
| G3 | Customer manual, quick-start, screenshots, approved manifest and packaged offline guides | UNVERIFIED | Deferred by the user; release gate |
| G4 | Customer cutover and commissioning | FAIL (gate) | Not authorised and not qualified |

## Verification performed

| Check | Command | Result | Evidence |
|---|---|---|---|
| Full isolated service suite (final source) | `npm run bar-local:test:isolated` | `service-tests: PASS` — 162 tests, 162 pass, 0 fail, 0 skipped, 561.5 s; bootstrap applied migrations 0001-0064 on PostgreSQL 17.6. The runner process exited 1 only because its post-run disposable `pg-data` removal hit a transient Windows `EBUSY`; all six steps reported PASS and the test log shows 0 failures | `.tmp/bar-isolated-tests/2026-10-27T14-08-15-689Z-6071597c/` |
| Full isolated service suite (earlier checkpoint) | `npm run bar-local:test:isolated` | 161/161 before the commit-group and restart-schedule refinements; retained for comparison | `.tmp/bar-isolated-tests/2026-10-27T13-49-02-546Z-e9ce18e2/` |
| Cloud/receiver regression | `npm run bar-local:test:isolated -- --test-file cloud-sync.test.mjs --test-file api-cloud-sync.test.mjs` | 6 tests, 6 pass, 0 fail (whole-commit-group assertion, partial config save, startup schedule, disabled/non-primary/approved refusal) | `.tmp/bar-isolated-tests/2026-10-27T14-06-07-185Z-118bc01f/` |
| Service build (inside the isolated run) | `services/bar-local` `tsc -p tsconfig.json` | PASS (`service-build`) | same directories |
| Modern Electron/IPC/UI-node tests | `npm run test:bar-local-electron` | 87 pass | run log retained in this session |
| Modern renderer UI suite | `npm run test:bar-local-ui` | 5 pass | run log retained in this session |
| Renderer typecheck | `npm run typecheck:renderer` | PASS | run log retained in this session |
| Legacy suite | `npm test --prefix legacy-pos` | 219 source checks + 50 Node tests pass | run log retained in this session |
| Modern product build | `npm run build:hospitality-pos` | PASS (51.82 s, final source) | `out/hospitality-pos/` |
| Legacy product build | `npm --prefix legacy-pos run build` | PASS (11.65 s, final source) | `out/` |

The final full suite (162 tests) ran after both SQL refinements and the restart-schedule change. The targeted run was also repeated after the refinements and rebuilt a fresh cluster, applying all 64 migrations before exercising the cloud, receiver and admin routes.

### Failure evidence

No test failed in any retained run. Two non-test observations are recorded rather than hidden:

1. The final full-suite runner exited with code 1 after all steps passed, because Windows briefly held a handle on the disposable `pg-data` directory (`EBUSY` during cleanup). The test log shows `pass 162`, `fail 0`; the retained evidence directory keeps the logs, and the identified disposable cluster data was removed afterwards to reclaim disk. Re-run commands are unaffected.
2. One real defect was found by inspection rather than by a failing test: `cloud_sync_take_batch` originally limited **event rows**, which could split one financial commit across two uploads. It now reserves whole commit groups, and the cloud test asserts one commit group per batch under a one-group limit. That assertion would fail against the previous implementation.

Historical failed runs from earlier checkpoints remain in `.tmp/bar-isolated-tests/` and are not evidence for this change.

## Does local Bar data reach Supabase?

**No.** No hosted receiver exists, no hosted migration was applied, the default transport is `disabled`, the reserved `approved` transport refuses to run, and every upload in this session targeted a loopback HTTP test server in front of a disposable local PostgreSQL database. A saved export file, an enabled toggle, or a `received`/`validated` receipt does not put data in Supabase. Cloud-side reports will not contain Bar trade until a receiver is deployed, authorised and acknowledged as `ingested`.

## Implemented versus customer-ready

**Implementation verdict: substantially implemented and verified at the local/development-PC level.** The local authority, the durable upload contract, the receiver contract, the admin API, both client surfaces and the cash-up final-sync hook are working code exercised by an isolated PostgreSQL suite and both production builds. This is not a stub, a mock, a visible form or a passing build alone.

**Customer-readiness verdict: NO-GO.** The following are unresolved and block a customer Bar deployment:

- Installed Windows 10/11 service and PostgreSQL lifecycle, TLS/SCM installation and upgrade behavior.
- Physical 2-till and 6-till topology, network partition, power loss, peripheral and soak testing.
- Automatic coordinator/fencing and supported failover; replacement-host restore and PITR.
- Windows 7 Legacy client qualification.
- A deployed, authorised receiver and any hosted ingestion.
- Quarantine/skip recovery for a permanently conflicting batch (C11).
- Customer manual, quick-start, screenshots, approved-document manifest and packaged offline-guide evidence.
- Customer cutover, commissioning and release approval.

## Running the UI

The service and both clients are run from the repository with the existing scripts (this work produces no installer):

```powershell
# 1. Build the local Bar service and contracts
npm run bar-local:build

# 2. Provision a disposable dev database (bar_local_test_* names only)
#    Set BAR_LOCAL_DB_HOST=127.0.0.1, BAR_LOCAL_DB_PORT, BAR_LOCAL_PG_BIN, BAR_LOCAL_BOOTSTRAP_USER,
#    BAR_LOCAL_DB_NAME=bar_local_test_dev, BAR_LOCAL_MIGRATOR_USER/PASSWORD and BAR_LOCAL_RUNTIME_PASSWORD.
#    Omit BAR_LOCAL_SETUP_SECRET to have bootstrap generate .local/setup-secret.txt.
npm --prefix services/bar-local run db:bootstrap
npm --prefix services/bar-local run db:migrate

# 3. Start the service with the same BAR_LOCAL_DB_* / BAR_LOCAL_RUNTIME_* variables plus
#    BAR_LOCAL_ALLOW_TEST_DB=1 (default HTTP bind 127.0.0.1:8787)
npm --prefix services/bar-local run start

# 4. Modern Hospitality POS (Bar local workspace, includes the admin panel)
npm run dev:restaurant-bar

# 5. Legacy POS (Electron 22, separate terminal)
npm --prefix legacy-pos run dev
```

In the app, choose the local Bar workspace and give the setup form the committed service endpoint (for example `http://127.0.0.1:8787`) and the setup secret from `services/bar-local/.local/setup-secret.txt` (or `BAR_LOCAL_SETUP_SECRET`). Installed provisioning is a separate, unqualified workflow (`scripts/provision-local.mjs`); it is not part of this verification.

Cloud synchronisation is visible in **Administration -> Cloud synchronisation** inside the Bar local workspace, and only for a session with settings-management capability. With the default configuration the panel reports transport `disabled` and disables "Sync now", so no pass is started and nothing is contacted. To exercise the path locally, start the service with `BAR_LOCAL_CLOUD_SYNC_TRANSPORT=local_test`, a 32+ character `BAR_LOCAL_CLOUD_SYNC_KEY` (or `..._KEY_FILE`), a `BAR_LOCAL_CLOUD_SYNC_KEY_ID`, and configure a loopback receiver URL in the panel.

## Externally blocked prerequisites

| Prerequisite | Blocked by |
|---|---|
| Hosted receiver deployment and ingestion | Not authorised; requires separate architecture/security review and hosted deployment approval |
| Hosted Supabase migration for the receiver contract | Not authorised |
| Installed service/database/TLS qualification | Needs target Windows 10/11 hardware and an approved installation window |
| Physical multi-till, power-loss, peripheral and soak qualification | Deferred by the user |
| Windows 7 Legacy qualification | Deferred by the user |
| Customer manuals, quick-start, screenshots, manifest and packaged offline guides | Deferred by the user; release gate |
| Commit, push, release and customer cutover | Not authorised |
