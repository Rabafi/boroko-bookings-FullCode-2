# Bar local authority: implementation and verification plan

## 30 October 2026 — current continuation status

Forward migration 0076 and `POST /v1/replacement/challenge` now provide a server-signed fresh-device challenge bound to the active device, Bar, outlet, promoted/unfenced authority epoch and actual local endpoint. Modern and Legacy replacement reconnect pass the already verified endpoint and refuse to release the device token/owner PIN until the original paired device proves the challenge. The challenge exposes no token hash over HTTP. Bar registration aliases are blocked before cloud company/profile work; first-run setup copy now uses the “new Bar on this computer / connect this till” wording. Focused registration/replacement proof tests passed 13/13; challenge HTTP tests passed 3/3. Modern Bar Electron tests passed 101/101, Bar UI tests 5/5, Modern and Legacy builds, and Modern renderer/Bar service typechecks passed. The complete guarded service run reached 211/245 and timed out after cascading failures from a destructive test-order interaction; the replacement test passed 1/1 and post-close tests 3/3 when each ran on its own fresh isolated database. A single PITR runtime-authentication failure remains to diagnose. See EV-170 in `EVIDENCE_LOG.md` for the bounded evidence.

This does not close the plan. Local owner commissioning still requires the bundled service to be installed and reachable; LAN TLS and multiple-PC reconnection are unqualified. Independent off-host WAL/PITR recovery (the guarded drill currently fails runtime-authentication verification) and replacement-host restoration/fencing, installed signed-update lifecycle, and complete A01–A32/64-feature reconciliation remain open. Isolated practice-mode provision/trade/restart/reset now passed on this development PC, but installed/customer qualification remains pending. Customer PDFs/quick-start/screenshots/approved-document packaging are pending by user direction. No hosted database change, release, cutover or customer Bar creation occurred.

## 29 October 2026 — continuation status

This plan remains active and is not fully accepted. Fresh Hospitality POS starts in local owner setup by default; choosing the existing cloud workspace is explicit. This makes local setup the default path, but does not install/start PostgreSQL or commission a business. A protected owner setup and a running, authenticated local Bar service are still required before trading. Local authority remains **NO-GO for customer commissioning**.

The current local service implementation passed the guarded isolated PostgreSQL suite **209/209** through migrations 0001–0073 (EV-159). Modern/Legacy local workflow, storage, build and focused typecheck results are recorded in EV-160. These synthetic/local checks do not establish installed Windows lifecycle, customer trading, multi-PC durability or recovery readiness. The separate Chromium startup smoke could not start its GPU child on this PC (`0xC0000135`) and is unverified; the broad renderer IPC typecheck remains red with 11,077 repository-wide diagnostics.

After that checkpoint, independent review identified a concrete response-contract defect in migration 0073's `workforce.tip_payouts` scope: it omitted the authenticated role required by the production validator. Forward migration 0074 restores the session-derived role and preserves direct runtime-function denial. The focused API/tip tests passed 2/2 and the full guarded isolated service suite passed 209/209 through migration 0074 (EV-161). This closes that query defect only; it does not close the remaining plan phases below.

Continue implementing software work that is possible on this workstation. Mark work needing multiple physical PCs, Supabase access/deployment or physical power/peripheral qualification as pending and outside this pass. The user also directed that customer PDFs, quick-starts, screenshots and approved-document packaging remain pending and non-blocking for a software release. This does not waive their documented release/commissioning gates. Do not infer that any pending work is complete from a passing synthetic test.

Remaining local software work includes the isolated training/rehearsal mode, independent WAL/PITR and off-host recovery chain, replacement-host recovery/fencing, complete installed update orchestration, remaining closed-shift corrections, and full profile/session/cache/shared-renderer route acceptance. Reconcile each acceptance row against current implementation and executable evidence before claiming completion. See EV-159/160, `LOCAL_REMAINING_2026-10-26.md`, and `INDEPENDENT_CHECKPOINT_2026-10-29.md` for current evidence and boundaries.

## 23 October 2026 — lot and expiry visibility follow-up

Migration 0047 adds the authenticated, outlet-scoped `stock.lot_expiry` read route and both local stock panels show receipt lot codes, expiry status, received quantity and supplier reference. The report intentionally does not imply current lot balances: POS sales are not allocated to lots. FEFO allocation, lot-specific waste and exact remaining quantity remain open. Source regression, DB integration, typecheck and builds are pending this continuation. Customer PDF, quick-start, screenshots, approved manifest and packaged-guide work remain pending at the user's direction.

Date: 19 October 2026, Africa/Gaborone.

Status: **active implementation plan; not complete.** The 22 October 2026 continuation adds local administration/operations panels and service status, encrypted backup verification, replication controls, Windows service/backup/standby tooling, and admin audit metadata through migration 0040. A separate guarded `npm run bar-local:test` run is recorded as passing 132/132 on an isolated PostgreSQL 17.6 cluster; the prior focused service tests pass 39/39, readiness tests 4/4, tender tests 23/23 and Modern admin-response tests 2/2. Subsequent follow-ups added migration 0046 for a durable physical drawer count that snapshots expected cash and variance without changing the cash balance, plus authenticated export retrieval/status, a business/outlet-scoped loyalty-programme query (migration 0043), a timestamped current loyalty account read (migration 0044), and Modern/Legacy owner programme editors using the version-checked atomic write command. Both customer panels display the current local points balance and refresh after loyalty actions; the service rechecks eligibility at commit. Legacy customer enrollment, sale-linked loyalty earning and referenced point redemption are connected. External tenders remain locally asserted and local room charges that require hotel authority are refused. Windows backup task source now schedules hourly full snapshots in addition to daily and startup runs; this is not WAL archiving/PITR or an independent off-host copy. Modern and Legacy also record shift-locked physical drawer counts with an idempotent count-time expected-cash/variance receipt; paired receiver-confirmed handover remains open. The `npm test --prefix services/bar-local` invocation built successfully, then database-backed cases failed closed because its required `BAR_LOCAL_TEST_DB=1` disposable target was not configured; that invocation is not a pass and did not touch a database. Installed Windows lifecycle, automatic coordinator/failover, independent WAL/PITR backups, replacement-host restore, customer readiness, complete domain routing, multi-till/hardware and failure qualification remain open. Manual impact for visible settings and backup workflows is recorded; per the user's current direction, customer-guide updates and checks are pending but non-blocking for a software release. See [implementation report](IMPLEMENTATION_REPORT.md) and [evidence log](EVIDENCE_LOG.md). No commissioning, release or deployment is claimed.

Companion documents: [implementation prompt](IMPLEMENTATION_PROMPT.md) and [independent review prompt](REVIEW_PROMPT.md).

## 1. Decision and exact scope

Keep HotelOS, LodgingOS, the public booking site and the Manager PWA on their existing Supabase contracts. Add an explicitly commissioned `bar_local` authority mode to `hospitality-pos` in Bar mode. In this mode, a local Bar service backed by PostgreSQL authorises and commits Bar operations. Internet availability must never choose the write authority.

Use the **same local service and PostgreSQL implementation for one till and multiple tills**. One till can run the service on its own supported Windows computer using loopback. Multiple tills connect to one designated supported Windows host over the LAN. Legacy POS is a client of this service; its older Windows/Electron runtime must not be required to host PostgreSQL or a new native database module.

This choice avoids building separate financial engines for single-till SQLite and multi-till PostgreSQL, and gives a practical path to reusing reviewed PostgreSQL rules. Modern tills may use SQLite for their durable submission journal, but it is never an independent financial ledger. Existing Legacy POS JSON/JSONL submission storage remains supported and must be made durably correct where the new path needs it.

### Non-negotiable hosted Supabase boundary

For this implementation and subsequent review:

- **Run no migrations against any hosted Supabase project.** Do not use a hosted preview project as a disguised disposable environment.
- Do not create or change hosted tables, functions, triggers, policies, grants, users, Auth settings, Storage objects, Edge Functions, secrets or business records.
- Do not run linked database pushes, migration repair, schema changes, live trading fixtures, release scripts or customer cutover. Commands in older runbooks are not authorisation.
- Do not add local-Bar schema files to `supabase/migrations/`; use a separately named local-only migration directory and runner.
- Use an isolated local PostgreSQL test cluster. Its schema migrations are necessary and expressly permitted. They are **local database migrations, not hosted Supabase migrations**.
- Ship local authority and a durable cloud-export/outbox boundary. **Hosted financial ingestion remains disabled** in this pass. No current Supabase RPC is assumed to accept a completed local ledger safely.
- Describe any future cloud ingestion contract in a document. Do not create, deploy or execute a hosted migration for it in this pass.

The outcome is end-to-end **local Bar operation**, coexisting with unchanged online-first hotel/lodge systems. It is not an end-to-end deployment of new cloud consolidation. Without a later approved ingestion contract, Supabase reports and the Manager PWA will not contain new local-Bar trades. Local reports and export bundles must state that clearly.

### Meaning of offline

Daily Bar operations must complete without DNS, internet, Supabase Auth refresh, licence refresh, CDNs or remote configuration. A commissioned local authority and its local network must be available. During loss of the Bar server/LAN, clients may retain drafts and uncertain submissions, but must **not** independently finalise sales, approvals, cash-up or stock changes. This is a deliberate single-authority design, not disconnected multi-master trading.

Card authorisation, mobile-money confirmation, banking, government filing, cloud messaging, remote support and hotel room-charge confirmation depend on their providers. Record a locally asserted external tender separately from provider-confirmed authorisation and settlement. Do not present offline tender entry as external payment verification.

## 2. Evidence and current layout

Read these sources afresh before editing; the checkout contains substantial unrelated work:

- `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/SHIP_READY_RUNBOOK.md`.
- `docs/BAR_CAPABILITY_ACCEPTANCE_MATRIX.md`, `docs/BAR_TAB_RECOVERY_CONTRACT.md`, `docs/BAR_RELEASE_ACCEPTANCE.md`.
- `docs/audits/2026-10-15/bar-remote-readiness.md` and the later 15–16 October replay corrections in `PROJECT_STATE.md`. The older assessment is evidence, not proof of present defects.
- `docs/bar-manual/maintenance.md`, `document-manifest.json`, manuscript and current approved PDFs.

Observed integration points:

| Area | Current path / implication |
|---|---|
| Product build | `apps/hospitality-pos/package.json`, `scripts/product-app.mjs`, root `package.json`, product build configuration; separate product identity and release feed |
| Desktop authority boundary | renderer -> `src/preload/` -> `src/main/index.js` IPC -> `src/main/database.js` facade -> `src/main/domains/*` -> Supabase |
| POS domains | `pos.js`, `posOffline.js`, `posShiftClose.js`, `posMerge.js`, `posSubmitJournal.js`; inspect every exported caller, not only sale submit |
| Queue | `infrastructure.js`, `syncShared.js`, `syncStore.js` and append-only operation journal; current desktop queue is JSON/JSONL, not SQLite |
| Cache | `cacheStore.js`; some cache reads/writes tolerate failures. Such helpers cannot become local financial commit storage |
| Mesh | `src/main/domains/mesh/*`; eligible operation transport, not a replicated financial database or failover authority |
| Legacy POS | `legacy-pos/src/main/index.js`, shared payloads/queue/totals, storage journal/secrets, signed mesh; separate Electron 22/ia32 lifecycle |
| Bar UI | `HposLayout.jsx`, `HposNav.jsx`, `HposTerminal.jsx`, sibling Bar pages and shared Restaurant/Accounting pages reachable in Bar mode |
| Access | shared `barModeProfile`, commercial entitlements/access, capability checks, main-process guards, server RPC guards |
| Recovery | `barTradingBackup.js`, `barTradingBackupAutomation.js`; existing archives explicitly omit/restrict some identity and auth material and are not a new local-server backup |
| Hardware | modern and Legacy `src/main/hardware/posHardwareAdapter.js`; printing failures must not create another sale |

Root dependencies already include `better-sqlite3` and `bcryptjs`; `pg` is currently a development dependency. A deployed service must have its actual runtime dependencies packaged independently. Presence in `package.json` does not establish native ABI compatibility or installer support.

Historical SQL contains Supabase-specific identities, RLS, helper functions and deployment assumptions. Do not copy all migrations into the local cluster or make local `auth.uid()` a universal owner shortcut. Inventory the effective contracts and port their semantics with local identity enforcement.

## 3. Requirements and inventory gate

Before domain implementation, create `FEATURE_CONTRACT_MATRIX.csv` in this directory. Enumerate **every Bar-visible route, query tab, action, search action, keyboard shortcut, background task, export and optional add-on**, including shared settings/staff/data pages. Trace actual dynamic navigation and entitlement overrides, not just filenames. Each row must include:

`requirement_id, package, route_or_job, action, current_callers, current_rpc_or_query, current_auth, lodge_outlet_scope, current_offline_behavior, local_read_contract, local_write_contract, dependencies, audit_ledger_effect, retry_rule, external_dependency, test_ids, evidence, completion_status`.

Allowed classifications: locally implemented; externally dependent with explicit pending/unavailable behavior; intentionally excluded because current Bar mode does not offer it. An enabled Bar feature cannot be omitted, silently hidden, converted to a dummy result or declared online-only merely to finish. Newly discovered local-capable features expand the implementation matrix and coverage. An incomplete row prevents an end-to-end-complete claim.

Minimum coverage:

| Family | Required local behavior |
|---|---|
| Bootstrap and setup | new isolated installation, create local business/outlet, owner setup, pair tills, configure printers/tax/menu/staff and import approved seed data without internet |
| Access | local login/logout, PIN selection, manager approval, capability/entitlement checks, staff creation/suspension/reset, session invalidation, audit |
| Counter sales | cash/change, permitted external tender recording, split tender, tax/discount/service/tip calculations, immutable receipt and sale history |
| Tabs | open/add/remove/transfer/split/merge where currently supported, ownership and optimistic versions, partial/full settlement, recovery |
| Corrections | void, return, partial return/refund, approval requests and decisions, original tender and stock disposition, original-sale linkage |
| Shifts and drawers | clock-in/out, own/shared tills, operator activation, float, paid-in/out, counts, handovers, shift close, cash-up submit/review/reopen policy |
| Products and stock | products/packs/units, prices/tax, modifiers and promotions where Bar permits them, availability, suppliers, receiving, purchase orders, stocktakes, waste, lots/expiry, recipes/prep under existing package gates |
| Customer and growth | local customers, accounts/credit, loyalty, vouchers and liabilities, promotions and multi-outlet actions offered by purchased add-ons |
| Workforce and control | roster, attendance, tips/payouts, expenses, checklists, incident logs, operational alerts and local help |
| Reports and accounting | sales/tenders/stock/cash-up, owner review, source ledger/GL, AP, bank-file reconciliation, budgets, payroll and tax working papers offered by enabled add-ons; complete local data and explicit scope |
| Administration | applicable local settings, imports/exports, audit search, device status, backups/restore, guide access, update-from-local-package preparation |
| Hardware | local receipt printer/scanner/drawer and supported device tests; reprints without resubmission |
| External services | hotel charge, card/mobile authorisation, email/SMS, remote inbox/support, cloud reporting, filing, live bank feed: explicit external boundary and durable recovery where applicable |

Restaurant-only floor/kitchen/reservation functionality remains governed by the actual Bar profile; do not enable excluded Restaurant features accidentally. Preserve add-on and role gates. Existing Accounting activation/completeness rules remain substantive local rules, not flags to bypass.

## 4. Target architecture and ownership

```text
Modern Bar renderer -> narrow preload/IPC -> authority router
                                            |
Legacy POS renderer -> Legacy main client --+-> pinned TLS Bar API
                                                 |
                                      trusted local sessions + policy
                                                 |
                                      atomic local PostgreSQL RPCs
                                                 |
                    ledgers + audit + operation receipts + export outbox
                                                 |
                                verified local export / review bundle
                                                 |
                          future reviewed cloud ingestion (DISABLED)

Hotel / Lodge / public site / Manager PWA -> existing Supabase contracts
```

### Authority router

Persist trusted configuration with `authority_mode = cloud | bar_local`, product, business/lodge, permitted outlets, authority UUID, authority epoch, commissioning ID, pinned API identity and contract version. The client renderer cannot switch mode or supply a new server URL during a transaction. `bar_local` requires product `hospitality-pos` and a server-verified Bar configuration; a UI property-type flag alone is insufficient.

- Cloud mode retains existing contracts and queue semantics.
- Local mode routes **all** relevant Bar reads, writes, background jobs, authorisation, reports and add-on operations to the local service.
- A local failure never falls back to Supabase. Internet reconnect never starts old Bar queue replay for locally committed operations.
- Business-context changes cancel/fence in-flight requests and partition cached state and journals by authority, epoch, tenant and outlet.
- Use explicit domain adapters, not a generic `supabase.rpc(anyName, anyPayload)` proxy.
- Preserve response envelopes only where they have the same meaning. Add `authority`, `local_committed`, `operation_id`, `commit_sequence`, `cloud_status`, `dataset_scope` and structured recovery outcomes rather than relabelling a provisional cloud result as final.

Route application startup as well as domain calls. Inspect the renderer app-context/providers, login screen, startup licence/session checks, settings bootstrap, scheduled token/lease refresh, subscription banners, update checks, support polling and logout behavior. A correctly routed POS method is useless if the global shell refuses to mount without Supabase Auth. In local mode, startup reads trusted authority configuration first and establishes a local session; periodic cloud failures cannot evict it. External jobs may wait explicitly without blocking local startup or leaking local credentials to cloud.

### Mixed Windows clients, catalogue distribution and replicated hosts

Owner direction, 19 October 2026: the modern Bar app may run on a Windows 10+ office PC hosting the local service, while a Windows 7/POSReady 7 till runs Legacy POS. This section supersedes the original restriction against coordinated failover below. These are implementation requirements, not claims that existing database foundation work provides them.

- Windows 7 is a Legacy Electron 22 client only, not a supported database host, standby or failover voter. Qualify its installed runtime, TLS, printers and cashier workflows on actual reference equipment. Modern Windows x64 hosts require a documented verified OS/runtime/PostgreSQL support matrix; Windows 10+ alone is not certification of every build.
- Installer: Create Bar on the first eligible office PC/till; establish owner, outlet, staff and menu. Join Bar on subsequent clients using owner-issued single-use pairing and verified pinned server identity. Eligible modern hosts may separately enrol as standbys after authenticated full seed/catch-up. Till pairing grants no database or replication administration rights.
- The existing Legacy menu/outlet, inventory-link and Bar pack controls are reuse evidence. Current menu reads and catalogue publication in `legacy-pos/src/main/index.js` still use Supabase/cache. Implement authenticated local API adapters only for commissioned Bar devices, preserving lodge/cloud behavior. Internal `lodge_id` naming must map explicitly to the Bar business/outlet without granting hotel access.
- Office-created inventory products become sellable only when linked to priced menu items with tax/UOM/pack/depletion and outlet rules. Publish immutable catalogue versions atomically to the local authority. Legacy receives the published menu via durable LAN changefeed, reconnect cursor catch-up or consistent full snapshot, without internet or hosted catalogue RPCs. Display active version and actionable refresh/error state.
- Snapshot application must be atomic and complete, including deleted items, empty menus, availability, categories, prices, barcodes and supported modifiers/packs/tax. Paginate rather than silently truncating to low-resource menu limits. Catalogue edits must not silently reprice existing carts/tabs or receipts; bind submissions to versions and enforce an explicit refresh/reconfirmation policy without rewriting uncertain payloads or retry keys.
- Inventory and implement every required Legacy Bar cashier workflow: sales, shifts/drawers, tabs, returns, approvals, receipts, stock visibility and recovery. Enforce Bar/outlet/package/role scope in the backend. Office management/add-ons remain modern-app workflows unless explicitly offered on Legacy. Exclude lodge-only room charges and unrelated restaurant functions according to the Bar profile. Receiving a menu alone is not proof of full Bar compatibility.
- Each eligible modern standby holds its own complete PostgreSQL data directory on protected local disk, using compatible pinned physical streaming replication. No shared live database file, file-sync utility or independently writable replica. Replicate ledgers, receipts, audit, identity data, catalogue and outbox; provision service configuration, certificates/keys and recovery material separately and securely.
- Three eligible modern hosts are the default proposed automatic-failover topology: one active primary and two standbys. Choose a mature coordinator with verified support and offline packaging for the actual Windows deployment, majority agreement and enforceable fencing. PostgreSQL alone does not elect leaders. Do not implement consensus in TypeScript or repurpose mesh. Missing coordinator/platform qualification blocks automatic-failover readiness.
- In the replicated durability profile, acknowledge writes only after durable primary commit plus at least one eligible standby. Test synchronous PostgreSQL durability together with coordinator membership and promotion eligibility: quorum alone does not prove a candidate contains every acknowledged receipt. Promote only through a supported protocol proving preservation of the acknowledged prefix; otherwise stop writes. Never silently downgrade to asynchronous acknowledgement.
- An unavailable replica catches up before becoming eligible; every copy is not always simultaneously current. Requiring every replica to acknowledge would stop trading whenever one is off. Show lag, eligibility, durability profile and recovery risk. A single-host profile is explicitly lower resilience; only authorised audited administration may change profiles.
- Fence the old primary before replacement writes; minority partitions cannot continue finalising trades. A returning former primary rejoins only as a validated standby. Coordinator-enforced monotonic leadership terms and write fencing are separate from logical business authority identity. Ordinary failover preserves the logical authority, original operation IDs and valid pending work; restored/recommissioned datasets retain the stricter epoch procedure.
- Clients discover only enrolled/pinned hosts, show a bounded takeover interruption, query original receipts and retry the same payload/key safely. Test lost replies, delayed old-primary responses, approvals, printing and export-worker fencing. Never fall back to cloud or finalise independently when no safe authority exists.
- One Windows 10+ office PC plus one Windows 7 till has only one eligible database host: office-PC failure stops final trading. Two modern hosts require a documented supported independent witness/coordinator arrangement or controlled manual takeover with positive old-primary isolation and proven receipt durability. A witness does not hold the full business database. A lone survivor cannot infer that peers are dead. Do not promise automatic failover for unsupported topologies.
- Replicas propagate mistakes and do not replace independent encrypted backups/WAL or owner-held recovery material. Update installation, menu, role, failover and recovery instructions and packaged guides during implementation.

### Settings-led setup for a variable number of PCs

Three PCs were an example, not a required or maximum installation size. Support a variable registered device population, including two and six PCs and mixed modern/Legacy terminals. Qualify two- and six-device deployments explicitly and publish measured capacity limits rather than promising unlimited devices. Distinguish terminal count, full database replica count and coordinator voter count. All eligible modern PCs should be offered a full-copy role by default after resource checks; Windows 7 remains client-only. A six-PC installation need not have six voting members: choose a supported odd-sized coordinator group independently from the data replicas, documenting failure tolerance and safe membership changes. Adding a till must never silently change quorum or durability policy. Two PCs are supported with the previously stated recovery limitations; the wizard must explain those limitations before completion.

Provide **Settings > Local Bar Network** in the modern Bar app, with a reduced **Settings > Connect to Bar Server** workflow in Legacy. These are required functional screens, not placeholder buttons or instructions to run commands. Owner/authorised setup capability is required for server, replica, membership and recovery changes; cashier access is limited to connection state and approved reconnect actions. Enforce permissions and scope in the service, not just the UI.

| Control | Required behavior |
|---|---|
| Set up this PC as server | Wizard checks OS/architecture, disk/resources, existing database/authority and port conflicts; installs bundled verified service/runtime prerequisites with OS elevation only when required; creates or safely resumes setup, protects data/config/keys, configures narrowly scoped local firewall rules, starts services and verifies reboot persistence. Never overwrites an existing business database. |
| Connect this PC to a Bar | Discover local servers automatically; require an expiring single-use pairing code and verified identity before trust. Offer manual address entry if discovery is blocked, without requiring a static IP for normal use. Display business/outlet and assign permitted terminal role. LAN discovery is not authentication. |
| Keep a full database copy on this PC | Available only on eligible modern PCs. Explain storage/privacy and role, obtain authorised enrolment, prepare protected local storage, seed a consistent complete database, stream changes, and display progress/catch-up before readiness. No manual file copying or database password entry. An interrupted seed resumes safely or restarts staging without replacing valid existing data. |
| Devices and database copies | Show named PCs, OS, role, active server, last contact, full-copy readiness, lag, durability profile and supported takeover eligibility. Separate Connected, Copying, Catching up, Ready, Offline and Needs attention states. Never label a cache/full replica as an independent backup or claim every PC is current while disconnected. |
| Check setup / Repair connection | Run scoped diagnostics and safe retries for service, LAN/TLS, clock, disk, replication and version compatibility; offer actionable errors and export a redacted support report. Do not reset authority, erase data or disable security as a repair shortcut. |
| Change server / Recover server | Guided planned switchover or supported recovery with eligibility, pending-operation, quorum and old-primary fencing checks. Drain and confirm the safe handoff, audit the action and reconnect clients automatically. No unconditional Make primary button or manual override that bypasses fencing/durability. |
| Remove or replace PC | Authenticated revocation, safe membership/quorum checks, credential rotation where required and guided replica replacement. Do not delete local financial data implicitly; explain retention and separately authorise any destructive cleanup. |

Automate discovery, endpoint reconnection after address/leader changes, service startup, secure device registration, consistent initial seeding, incremental replication, lag monitoring and safe catch-up/rejoin where supported. Keep owner choices to naming the business/device, selecting server or join role, verifying pairing and choosing an explained eligible full-copy option. Use progress and resumable stages; double clicks, retries, process kills and reboot during setup must not create duplicate authorities/devices or corrupt data. Install, join, replica enrolment and switchover must have stable operation identities and auditable results. Never upload credentials or require internet to complete local setup.

Before declaring setup complete, run an automated readiness check and show the exact resilience achieved: e.g. Server only; Server plus full copy with controlled recovery; or Qualified automatic failover. Explain the effect of losing each relevant machine and provide a guided non-destructive connection/recovery demonstration. Automatic failover is enabled only for a verified supported topology. Local setup does not bypass the separate cloud-writer fencing/cutover approval gates.

Add A24: real installed modern/Legacy Settings workflows for two and six PCs, mixed roles, discovery/manual fallback, restricted users, wrong/reused pairing code, wrong business, unsupported replica host, insufficient disk, occupied ports, interrupted installation/seeding, repeated clicks, reboot, address changes, replica addition/removal and safe switchover/recovery. Assert complete menus and full replica contents, safe quorum membership changes, original receipt recovery, no data overwrite, actionable status and no cloud dependency. Register executable behavioral evidence and screenshots; update customer manual/quick-start and packaged offline guides for these controls.

### Daily readiness, maintenance and recovery requirements

Owner-approved additions, 19 October 2026: all eight items below are mandatory implementation and independent-review scope. Extend the executable acceptance manifest through **A32**, retaining A01–A24. Implement these within the Settings-led setup/status workflows and applicable till screens; include permission, retry, audit, error recovery and customer-guide coverage.

| ID / addition | Required implementation and evidence |
|---|---|
| A25 — Server power and maintenance | Check active host sleep/hibernate and service-startup settings during setup and readiness checks. Offer an authorised, clearly explained configuration that keeps the host awake while serving/trading, with no unnecessary display-on requirement. Warn on app-initiated shutdown/maintenance with active terminals or uncertain operations; provide safe drain/switchover where supported. Explain that closing the app does not stop the service. Configure permitted Windows maintenance windows through supported mechanisms, without indefinitely disabling security updates or claiming to prevent power loss/forced OS shutdown. Test supported sleep/resume, logout/reboot, planned maintenance and unexpected host loss; preserve original operation receipts. |
| A26 — Opening readiness check | Automatically run a lightweight opening check and provide Run checks again: active authority/write readiness, local authentication, required catalogue, disk, full-copy eligibility/lag, backup freshness/destination, configured printers and clock health. Show checked-at time and separate blocking trading faults from warnings: missing required authority/durability blocks finalisation; unavailable internet alone does not; an unavailable printer follows the explicit receipt/reprint policy. Enforce financial blockers at commit time as well as in the opening screen. Never let an old green result authorise unsafe trading. Verify disconnected/expired/low-space states and plain-language corrective actions. |
| A27 — Connection indicator on every till | Keep a visible modern/Legacy indicator distinguishing Internet unavailable—local trading ready, Connected to [named server], Reconnecting/checking sale result, Server unavailable—sales paused and Read-only/not ready. Derive final-trading readiness from authenticated authority and policy, not a ping or internet flag. Show stale status after a bounded timeout, update on takeover/reconnect, preserve drafts and label unknown sale outcomes. Do not expose infrastructure secrets or falsely present local tender entry as provider verification. Test loss of internet independently from LAN, authority and quorum. |
| A28 — Independent automatic backups | Provide authorised Settings controls for an encrypted scheduled backup destination separate from live replica storage, retention, status and Restore verification. Support a practical external drive or approved separate local destination, with clear same-machine failure limitations; never treat another live replica as an independent backup. Automate consistent backup/WAL validation and periodic isolated restore/invariant verification, record verified-through recovery point and age, remind when the destination is disconnected and retry safely on return. Protect owner-held recovery keys separately. Prevent retention from deleting the only valid chain; test unplugged/full destinations, corruption, missed schedules and restoration without internet/original host. Clarify that automated restore verification never overwrites live data. |
| A29 — Safe offline updates | Preflight client/service/schema/replica/coordinator compatibility; validate signed/checksummed local installation packages, available disk and recoverable pre-upgrade backup. Use an explicit tested upgrade order, drain or maintenance period, and resumable upgrade state. Incompatible clients cannot mutate; compatible unaffected clients continue only where the verified protocol permits. Preserve data, original intents, receipts, keys and membership across restart. Do not automatically downgrade a changed database or assume an installer rollback reverses schema/data. Document recovery from every interruption and minimum supported versions. Test mixed versions, corrupt/wrong packages and upgrade failure without internet; no release publication is authorised by these tests. |
| A30 — Installation rehearsal | Add Start training/rehearsal with a persistent obvious training banner and isolated authority/database, credentials, journals, receipts, exports and device membership. Seed disposable example products and staff; demonstrate office menu publication, pairing, sale, receipt printing and supported failover using only training members. Training receipts must say TRAINING and never enter live finance/stock/cloud exports or external payment providers. Never simulate failure by stopping the live server. Entry/exit must preserve uncertain live work; block a switch that would strand it. Test isolation/bypass attempts and provide a clear end-of-rehearsal checklist before separate real commissioning. |
| A31 — Replace a broken PC | Add Replace a PC wizard supporting a lost client, failed primary and failed standby as separate cases. With authorised owner-held offline recovery material, revoke the old device, validate identity/versions, establish quorum and positively fence an old primary before promotion, or stage a verified backup restore if no eligible full copy exists. Restore/provision secrets securely, validate database/receipts/stock/audit/outbox, re-enrol replicas and reconnect permitted clients. Require no access to the original machine or internet for supported recovery. Missing keys, missing acknowledged receipts or inability to prove isolation produces a specific safe-stop path, never an unsafe override. Give a particularly clear two-modern-PC controlled takeover flow and explain why a modern-plus-Windows-7 pair cannot promote the Legacy till. Record measured recovery point/time and test returned-old-PC denial. |
| A32 — Failure checklist and proof | Maintain a runnable failure matrix covering primary/standby/coordinator/client process kills, reference power-loss tests, LAN partitions, quorum loss, address changes, disk exhaustion, journal/WAL corruption, interrupted seeding/upgrade/backup and delayed/lost sale replies. Link each case to fault point, expected safe behavior, exact runtime/topology, retained logs and financial/stock invariant queries. Prove every acknowledged sale survives the failures promised by that installed durability profile, and an uncertain operation resolves using its original key without duplicate tender/stock/accounting effects. Do not claim zero loss for a single-host disk failure beyond its verified backup point. Test two- and six-device profiles, actual installed Windows 7 clients and all offered recovery modes. Simulated process failures do not count as physical power-cut/hardware qualification; mark unavailable evidence unverified. |

The customer-facing instructions must explain opening checks, connection wording, backup reminders, safe shutdown/update timing, training separation and replacement recovery in ordinary language. Update the manual/quick-start/screenshots and approved offline guide packaging evidence during implementation. These planning additions do not by themselves change current application behavior or approve an installer/customer cutover.

### Language and type-safety policy

Owner clarification, 19 October 2026: use TypeScript where it improves correctness and maintainability, without an unrelated rewrite of the existing applications.

- Implement the new Node.js local service and `packages/bar-contracts` in **TypeScript with strict type checking**. This includes authentication/scope, command handlers, database adapters, operation receipts, recovery, backup and export contracts. Database schema and atomic functions remain **SQL/PLpgSQL**; TypeScript does not replace database enforcement.
- Prefer TypeScript for new modern-client authority routing, durable-intent and IPC adapters where the current build supports it. Keep narrowly scoped JavaScript bridges with checked JSDoc when required by existing boundaries. Do not convert unrelated HotelOS, LodgingOS, PWA, Restaurant or renderer code as part of this task.
- Compile shared contracts and any new Legacy adapter code to JavaScript compatible with Legacy POS's existing Electron/Node runtime and module format. Ship compiled JavaScript and type declarations; do not require a TypeScript interpreter or a new unsupported runtime on customer machines. Preserve existing Legacy JavaScript where conversion adds compatibility risk without improving the contract.
- Keep one versioned contract definition for command/query payloads, results and structured errors, with inferred/derived TypeScript types and **runtime validation** at every untrusted input boundary. TypeScript types alone do not validate JSON, authenticate an actor, enforce outlet scope or prove an atomic transaction.
- Represent money/quantity transport values and operation/authority identities explicitly. Do not use unchecked `any`, broad assertions or compiler-suppression comments to bypass financial, authentication or recovery contracts. Validate database/network results before narrowing them.
- Register strict service/contract type checks and compilation in the relevant test/build aggregate. Verify compiled modern and Legacy consumers, invalid-input rejection and production startup without development-only TypeScript tooling. Small existing JavaScript build scripts may remain JavaScript with a documented reason.

### Proposed implementation boundaries

These are new paths, not claims of existing files. Adapt directory naming only with a documented reason:

```text
services/bar-local/
  package.json
  src/{server,config,lifecycle,auth,pairing,api,contracts,db,domains,events,backup,export,health}/
  db/migrations/                  # ONLY the local schema
  scripts/{migrate-local,doctor,backup,restore,verify-install}/
  packaging/windows/              # service installation and upgrade assets
  tests/{db,api,concurrency,faults,restore,soak}/
packages/bar-contracts/            # versioned DTOs, validation, errors; no credentials
src/main/bar-local/                # modern client, authority router, durable intents
legacy-pos/src/main/bar-local/     # old-runtime-compatible client and intent adapter
tests/bar-local/                   # integration and rendered operator acceptance
```

Keep database credentials, database roles, TLS private keys and signing keys in the service account's protected storage. Clients receive device-scoped credentials, never PostgreSQL or service-role credentials. The service must continue running when the Electron window closes, the cashier logs out, or another till restarts.

### API surface and query contract

Implement a versioned, allowlisted API. Suggested minimum routes:

| Endpoint | Contract |
|---|---|
| `GET /v1/health/live` | Minimal liveness only; no business or secret metadata |
| `GET /v1/health/ready` | Authenticated readiness, identity/epoch/schema compatibility and actionable blockers |
| `POST /v1/setup/owner` | Loopback/bootstrap-secret-only first-owner flow; permanently fenced after initialisation |
| `POST /v1/pairing/start`, `/complete` | Owner-authorised pairing creation; single-use device registration and pinned server identity |
| `POST /v1/sessions`, `/refresh`, `/revoke` | Local credential validation, rotated session tokens and scope-bound revocation |
| `POST /v1/approvals` | Exact action/hash-bound manager proof; no reusable blanket authorisation |
| `POST /v1/commands` | Validated canonical command envelope; dispatch only registered domain handlers |
| `GET /v1/operations/:operationId` | Scoped authoritative receipt/status; no automatic new ID after missing/unknown outcome |
| `POST /v1/queries/:queryName` | Allowlisted read/query DTO, bounded pagination, server-derived scope and completeness metadata |
| `GET /v1/events` | Authenticated scoped cursor/changefeed with replay/gap detection |
| backup/export administration | Narrow separately authorised jobs; job IDs/status, no renderer-supplied raw SQL or arbitrary service filesystem paths |

Successful command response contains `operation_id`, `authority_id`, `authority_epoch`, `outcome=committed_local`, `receipt`, `commit_sequence`, `server_committed_at`, `business_date`, affected entity IDs/versions and `cloud_status=integration_disabled` for this pass. An uncertain HTTP transport error is not a business refusal. Structured failure contains `code`, `outcome`, `retry_same_operation`, `requires_manager`, safe message and scoped correlation ID. A direct transport response must never claim committed before the DB commit succeeds.

Queries return `data`, typed pagination cursor, `snapshot_watermark`, `scope`, `as_of`, `complete`, and explicit unavailable reasons. Bounded list pages and streaming full exports are different contracts. Build server-side report jobs from a consistent snapshot; never assemble a supposedly complete export from whatever pages the UI happened to load. Normal role/outlet scope applies to jobs and their result downloads.

Maintain a command/query registry in `packages/bar-contracts` mapping external name/version to validator, local function, required capability/feature, scope, retry policy and tests. Minimum commands include `sale.commit`, `sale.return`, `sale.void`, `tab.open`, `tab.change`, `tab.split`, `tab.transfer`, `tab.settle`, shift/operator/drawer transitions, cash movement/count/cash-up commands, catalogue mutations, receiving/stocktake/adjust/transfer commands and enabled add-on mutations. The exhaustive feature matrix, not this example list, determines registry completeness. Clients cannot choose PostgreSQL function names.

## 5. Local installation, trust and identity

### Local-only database runner

Require an explicit `BAR_LOCAL_TEST_DB=1` plus an allowlisted loopback endpoint, dedicated database name and cluster identity for automated destructive tests. Reject hosted domains/IPs, Supabase project references, normal app connection variables, default production credentials and unknown cluster identities. Verify the actual connection server identity after connect, not just its URL. No generic fallback connection string.

Use separate migration-owner and runtime roles. Migrations have ordered versions and checksums, a transaction/advisory lock, applied-history records, compatibility checks and resumable failure semantics. Runtime role has no DDL, role creation or unrestricted table-write permission. Only approved local functions can mutate financial/stock state. Validate tenant/outlet/actor/device/epoch in those functions or through a non-forgeable trusted session context. Forbid cross-request pooled-session identity leakage; set context transaction-locally and clear/test it.

### Commissioning without internet

Provide a local wizard and CLI-supported recovery path:

1. Install a fresh local service/cluster into its own data directory, never an existing Supabase or customer database.
2. Create an authority UUID and business/outlet identity; preserve existing lodge UUID mappings when importing an existing business.
3. First-owner creation uses a one-time local bootstrap secret displayed/stored through an OS-protected setup channel, expires after use, and is disabled once an owner exists. No default PIN or open LAN setup endpoint.
4. Create local owner credentials, recovery material, tax/configuration and package entitlement. Demo fixtures are never automatically trading data.
5. Import a versioned verified commissioning bundle or enter a genuinely new catalogue/opening stock with accountable approvals. Validate completeness, duplicate IDs, units, taxes and opening balances.
6. Pair tills physically using a short-lived, single-use code and displayed server certificate fingerprint. Discovery is a convenience; discovery advertisements are not trust.
7. Exercise a non-trading readiness check and make the required backup/recovery preparation before activation.

Commercial entitlement is an offline-verifiable signed artifact, bound to authority/business/product/package/outlets with monotonic version. Public verification key may be packaged; private issuer key must not be shipped. If no authorised signing facility/artifact exists, use an isolated test key explicitly marked non-production and leave production entitlement activation blocked. Do not silently make all add-ons free or forge a production licence.

Do not require periodic internet leases for ordinary local trading. Any existing commercial expiry/suspension policy must be explicitly represented in the signed local entitlement with clear warnings and local backup/export access after expiry. Do not invent a new commercial policy or accidentally remove existing suspension behavior. Define offline initial activation as import of an authorised signed entitlement, not a call to hosted licensing.

### API authentication

- Local service manages staff identities, strong password/PIN verifiers, device registration, refresh/revocation and outlet assignments. Never import plaintext PINs or blindly trust cached cloud verifiers as new authority identities.
- Verify approval PINs at the service; bind a short-lived approval to actor, capability, target operation and payload hash. Do not persist raw PINs in journals, receipts or logs.
- Enforce package + role + tenant + outlet + state on each command, including direct API calls, exports and background jobs. Local access control is the enforcement boundary; cloud RLS cannot protect local data.
- Protect API traffic with TLS and certificate pinning. Legacy clients must pin through their compatible main-process transport, never globally disable certificate verification.
- Rate-limit login/PIN/pairing, use bounded bodies/timeouts, parameterised SQL, narrow CORS/origin rules, input schemas, redacted logs and lockout recovery that does not depend on internet.
- Suspend/reset staff locally and invalidate their sessions across tills immediately. Enforce maker/checker separation where the current contract requires it.
- Define authenticated administrative recovery with audit and physical access; do not add an unauthenticated bypass or make support response necessary for ordinary outage recovery.

## 6. Database and command contract

Use a dedicated local database and schema, e.g. `bar_local`. Keep the complete schema versioned in the local service. The following are minimum logical records; match actual product contracts discovered in the matrix:

| Group | Required records / invariants |
|---|---|
| Identity/config | authority registry/epoch, business, outlets, tills, devices, staff, role/capability assignments, sessions, entitlement artifacts, settings versions |
| Catalogue | menu/catalogue revisions, products, packs/UOM conversions, price/tax snapshots, modifiers/promotions, recipes, suppliers, lots |
| Trading | sales, immutable sale lines and tenders, tabs/lines/versions, settlement links, returns/refunds/voids, receipt identities |
| Money | append-only payment and cash ledgers, drawer periods, staff shifts, counts, handovers, cash-up submissions/decisions/reconciliation |
| Stock | movements, locations/lots, stocktakes, receipts/purchases, transfers, waste/production, derived/locked balance projections |
| Customer | customers, account/credit ledger and allocations, vouchers/redemptions, loyalty events and reversals |
| Other Bar work | expenses, roster/attendance, tips, checklist/incident records and all enabled add-on records |
| Accounting | chart/config versions, posting sources, immutable balanced journals/lines, AP/bank/tax/payroll/budget/period state, cutover/opening balances and readiness evidence |
| Reliability | operation receipts, append-only audit, durable print jobs, export outbox/batches/acks, migration history, import batches and recovery manifests |

### Canonical command envelope

```json
{
  "contract_version": 1,
  "authority_id": "uuid",
  "authority_epoch": 1,
  "business_id": "uuid",
  "outlet_id": "uuid",
  "device_id": "uuid",
  "operation_id": "uuid-created-once-before-send",
  "command": "sale.commit",
  "payload_version": 1,
  "payload": {},
  "expected_versions": {},
  "dependencies": [],
  "client_occurred_at": "ISO-8601"
}
```

Actor comes from the authenticated session, not a trusted `actor_id` field in JSON. Staff/approval references in payloads must be validated against authenticated proof. Enforce operation-ID uniqueness at authority scope; include tenant/outlet/device/actor/command/payload version/content in the identity binding so cross-scope reuse conflicts. Document canonicalisation (ordered object keys, explicit decimals, Unicode/null rules, excluded transport metadata) and retain the original normalised command bytes and hash. Do not hash binary floats or mutate historical bytes.

### Atomic execution algorithm

1. Authenticate the current device/session and establish transaction-local trusted scope.
2. Validate the envelope and claim the unique operation receipt atomically. Concurrent same-key submissions wait/read the same receipt, not run twice.
3. For an already committed matching command, return its immutable original receipt through a read-authorised recovery path **before mutable shift/tab/menu eligibility checks**. Do not re-execute it. A suspended actor/device cannot gain general recovery visibility; provide authorised manager lookup where needed.
4. For a new claim, validate live permission/package/scope/state. Lock the authority's transactional commit-counter row before domain locks, then lock affected rows in a documented stable order. Use explicit row locks for balances/tab/drawer state and SERIALIZABLE where predicates require it. Retry deadlock/serialization failures internally with the **same** operation identity and a bounded budget.
5. Derive totals, taxes, price/recipe snapshots and change locally on the server. Use fixed-precision PostgreSQL numeric or validated integer minor units; JS floats never decide financial truth. Quantities/UOM use explicit precision and conversion policy.
6. Write all business effects, financial/stock/accounting ledger rows, audit before/after and outbox events in the **same** transaction as the operation receipt.
7. Commit with durable PostgreSQL settings. Only then acknowledge `local_committed` and enqueue/deliver the committed receipt for printing.
8. Lost response: client asks operation status/retries the original envelope. A changed-payload same key is `IDEMPOTENCY_PAYLOAD_CONFLICT`; never invent a replacement key after ambiguity.

For the first implementation, every committed mutation allocates its export/changefeed number from the locked **transactional authority counter**, incremented in the same transaction. This serialises the commit-number boundary per authority and prevents a later visible number from skipping an earlier uncommitted event. Do not use `nextval()`/wall-clock timestamps as a supposedly contiguous commit cursor: sequences can be allocated out of commit order. Event batches may use `(commit_sequence, event_index)` for several events within one command. Test concurrent snapshot/subscription/export startup. Measure contention under A20 before proposing a more elaborate equivalent ordering mechanism.

Expected business refusals must leave no partial domain effects. Use a transaction/savepoint policy that rolls back tentative work and records an immutable terminal refusal receipt where the command was definitively rejected; a SQL exception cannot be logged as a refusal inside an already-aborted transaction. Unexpected connection/commit failure remains ambiguous until lookup. Do not cache pre-authentication denials as a cross-user financial receipt. A new, explicitly changed intent following a definitive rejection gets a new operation ID with a link to the refused intent; ambiguous retries keep the original.

Receipt uniqueness: stable authority UUID + outlet/series + monotonic receipt sequence, separate from operation UUID. Gaps after aborted sequences are acceptable if documented; reuse is not. Retain original tax/price/actor/shift/business-date facts forever under the retention policy, even after menu edits or staff suspension. Separate client timestamp, server commit timestamp, business date and event sequence. Business timezone is configured and versioned; local clock movement cannot change an already committed business date.

Operation receipt retention must cover database lifetime/financial retention and backup replay, not the current 24-hour client journal cleanup. Pruning a UI intent is safe only after durable receipt storage and a verified checkpoint; never expire server idempotency receipts while a retained backup can replay commands.

### Required error/status model

Define machine codes for validation, capability/entitlement denial, tenant/outlet mismatch, revoked device, wrong authority/epoch, stale tab/catalogue, closed shift/drawer, insufficient stock/credit, duplicate settlement, changed-payload key reuse, parent pending, command not found, executing/retryable, committed, terminal refusal, local service unavailable, disk/DB unavailable and recovery required. Carry these through API/main/preload/UI without relying on prose.

`not_found` is not permission to generate a new operation ID. A late request can still arrive. Re-submit the same envelope; cancellation/abandonment needs a server-recorded terminal state that fences late arrival. Keep status reads read-authorised and scoped.

## 7. Domain invariants and local verification

### Sales, tabs and corrections

- Validate active shift, drawer/operator, outlet, sellable item and catalogue version. Preserve exact displayed-price agreement: stale catalogue requires explicit repricing confirmation, not an unnoticed higher bill.
- Sell through one atomic function covering order, lines, tenders, stock, receipt, audit and accounting source when enabled. An accounting posting failure cannot leave a sale reported as fully posted; choose atomic posting or an explicit blocking posting-exception contract with reports marked incomplete. Preserve current stronger rules.
- Lock tabs/version state for add/split/transfer/merge/settle. Deterministic penny allocation must conserve line quantities, tax, discounts, tender and tip totals. Two tills cannot settle the same remaining balance.
- Return quantity/value cannot exceed original less prior accepted reversals. Choose restock/waste disposition, require reason/approval, reverse all linked ledger effects atomically. Voids/refunds never delete the original.
- Bind manager decisions to the exact request and hash; requested correction and approval are separate audited transitions. No blanket manager-unlocked renderer token.
- Printing and drawer pulses follow committed results. Retrying print/reprint never re-runs the financial command; reprints are marked. Exactly-once physical printing is not promised after power loss; offer receipt lookup and explicit reprint.

### Stock and purchasing

- Sale depletion, returns, receipts, adjustments, stocktakes, transfers and prep use one movement ledger. No client-side stock subtraction as authority.
- Enforce outlet/location/lots and UOM conversion. Block ambiguous item-name links; preserve audited legacy mapping rather than guessing.
- Lock affected balances in stable order; concurrent attempts to sell the last unit yield the configured stock policy once. Default no-negative-stock unless a current explicit approved policy permits an audited override.
- Stocktake captures a version/snapshot and reconciles intervening movements; it must not overwrite newer stock blindly. Purchase receiving is idempotent per receipt, tracks partial deliveries and prevents over-receipt without explicit policy.
- Recipes/prep consume inputs and produce outputs atomically with cost snapshots, waste and expiry rules where enabled.

### Shifts, cash and reports

- Enforce one applicable active drawer period and validated staff/till ownership. Record floats, paid-in/out, tips and cash handovers as ledger movements with stable keys.
- Close and submit cash-up against the same locked authoritative scope. Blank/NaN/missing evidence is unavailable, not zero. Duplicate close/approval cannot repeat effects.
- Once a locally committed shift is closed, delayed client retries resolve original receipts without changing shift/date. A genuinely uncommitted sale cannot be inserted into a closed shift by rewriting its identity. A correction needs a separate authorised reconciliation event with original linkage.
- Reports use consistent database snapshots, scoped event/commit watermarks and completeness metadata. Include historical imported prefix versus local trading period explicitly. No cached zeros or silent truncation in PDF/CSV/XLSX.
- Historical external-provider settlements remain unverified until evidence is imported/confirmed; local cash-up does not mark them settled automatically.

### Accounts, vouchers, loyalty and multi-outlet

Use locally owned append-only ledgers with locked available balances, scoped issuer/authority, redemption idempotency, reversals and audit. Cloud-issued/shared hotel balances and vouchers cannot be spent offline merely from a cache. Import explicit exclusive custody/escrow allocation or leave that cross-system instrument unavailable with clear guidance. Do not promise network-wide double-spend prevention without communication.

Multiple outlets on the **same** Bar authority share the same transactional database and enforce outlet capabilities. Disconnected authorities do not share a mutable balance. Stock transfers across external authorities remain pending until an approved handoff protocol exists.

### Accounting and workforce add-ons

Inventory all 95-or-current accounting operations from the current authorisation matrix; do not assume the historical count is complete. Port source-to-subledger-to-GL-to-report invariants, balanced postings, period locks, maker/checker, provenance/source coverage, AP payment locks, tax-pack versions, payroll privacy and export completeness.

Local accounting requires a reconciled opening trial balance and source scope. A cash-up is not a statutory statement. If historical data/policy is incomplete, retain explicit readiness blockers; do not fabricate opening balances or waive activation to show a working page. Locally available bank-file imports/reconciliation and payroll/tax calculations work offline. Actual bank payment and statutory submission remain external. Existing package and capability gates still apply.

## 8. Durable clients, UI and topology failure behavior

Persist each financial intent **before dispatch**, including authority/epoch/scope, original envelope/hash and recovery state. Modern client: transactional SQLite intent store through the main process, tested against the packaged Electron ABI. Legacy: compatible append-only journal with checksummed records, fsync, recoverable torn-tail handling and durable compaction. Do not expose a raw database API to renderer code.

State machine:

```text
draft -> durable_intent -> sending -> committed_local
                              |        |
                              |        +-> receipt/print/reprint
                              +-> outcome_unknown -> status/read/retry SAME command
                              +-> terminal_refusal (retain evidence; explicit resolution)

committed_local -> export_pending -> exported_unacknowledged
                  # hosted acknowledgement/ingestion disabled in this pass
```

Cancelled draft, server-refused command, unknown outcome and committed sale are distinct. Failed local journal writes stop dispatch. A service outage keeps an already-sent command in outcome-unknown until checked. Keep basket/input recoverable without making draft stock/tenders authoritative. Do not display success before local commit.

UI must distinguish:

- local server connected/disconnected;
- committed locally versus submission awaiting outcome;
- internet available/unavailable;
- cloud integration disabled versus export backlog versus a future acknowledged cloud watermark;
- current local backup age and last **verified restore**, not just last file written.

No red cloud-offline banner should imply a healthy local Bar cannot trade. A server/LAN outage must clearly stop finalisation and explain lookup/recovery. Use normal product language in customer screens; keep epoch/hash/database details in diagnostics.

Push invalidations/WebSocket/SSE are optional transport conveniences; use monotonic per-scope commit/event sequences, authenticated subscriptions and gap detection. Poll/snapshot recovery must work. A reconnecting till obtains an authorised consistent snapshot plus cursor, then catches up without missing a concurrent update. Device caches are scoped and labelled; a stale cache cannot grant permission.

Mesh must not replay local-authority commands into cloud lanes or turn peers into competing servers. Keep old mesh/cloud behavior for non-migrated profiles. In local mode, pin the logical authority and enrolled hosts, reject stale leadership, and use only the coordinated replication/fencing contract above for failover. Mesh is not database replication or leader election.

## 9. Cloud coexistence and future ingestion boundary

Write an outbox row in the local commit transaction. Each event includes immutable event ID, authority/epoch, scope, operation/source IDs, event/contract version, original business date, canonical facts and hash, local commit sequence and dependency references. Do not store raw credentials or PINs in it.

Outbox retry/export workers use leases and bounded backoff without blocking trading. Export batches are bounded, ordered, versioned, checksummed and signed by an authority export key with defined rotation. A batch includes a manifest, previous checkpoint, event list, ledger/control totals and dependency closure. Exporting is **not acknowledgement**; do not delete unacknowledged financial events or claim cloud sync success. Retention/compression/backpressure and disk limits must be explicit.

This pass implements bundle generation, validation, cursor handling and a test-only fake receiver exercising duplicate/out-of-order/partial acknowledgements. The production hosted uploader is absent or hard-disabled in both client and service configuration. There must be no generic cloud-write escape hatch. Read-only seed import uses explicit files; automatic hosted reads are not necessary for trading or test setup.

Create `FUTURE_CLOUD_CONTRACT.md` describing what would be needed later:

- authenticated authority registration, tenancy/outlet binding, key rotation/revocation and batch anti-replay;
- an atomic idempotent **import of completed local facts**, not blind re-execution of old online sale/shift/stock RPCs;
- receipt lookup first, payload conflict checks, dependency/watermark acknowledgement and durable inbox deduplication;
- stock/accounting cutover boundaries so local movements are not depleted/posted twice;
- handling closed periods, historical dates, rejected imports, reconciliation and reports that disclose stale/missing authorities;
- no cloud edit of local-owned sale facts; remote proposed changes must return to the owner authority as separately authorised commands;
- explicitly separate remote read models from ledger authority and define which existing reports need changes;
- expected hosted schema/RPC changes and deployment fixtures, marked **proposal only**.

A cloud refusal never erases or rewrites a committed local sale. It produces an integration/reconciliation issue. Do not promise complete cloud financial parity with unchanged hosted contracts.

## 10. Existing data, cutover and rollback

Implementation must provide a dry-run import/commissioning tool and isolated rehearsals; do not cut over a real customer in this pass.

1. Inventory every modern/Legacy profile, old queue, failed store, submit journal, mesh copy, open tab, shift, drawer, voucher/credit liability and cloud counterpart for the outlet. Record hashes/counts and unresolved outcomes.
2. Preserve encrypted full backups and immutable source evidence. Do not auto-convert cached rows into authoritative sales or replay all historical queues into the new database.
3. Require a quiescent cutover and reconciliation: resolve/receipt-match each uncertain old operation against its original authority, close/transfer open state through approved explicit rules, reconcile stock and money. An unresolved financial operation blocks activation for that scope; preserve its key and bytes.
4. Import a consistent versioned seed: identities/mappings, complete catalogue, opening stock/valuation, outstanding account/voucher/AP balances, accounting opening state and the historical data needed for supported returns/reports. Imported settled history is read-only historical context, not a new sale event/outbox posting.
5. Record per-outlet cutover authority, timestamp/business date, cloud snapshot boundary and signed/hashes control totals. A complete report must show included historical prefix and local suffix without double counting.
6. Fence old writers. Because hosted Supabase is unchanged, this pass **cannot claim a new server-enforced cloud write fence**. Commissioning a previously cloud-owned outlet requires separately verified operational isolation of every old writer/background process/device/session and a controlled outlet handover. If that cannot be demonstrated, keep activation NO-GO; do not assume a local flag protects cloud RPCs from stale clients. A future hosted enforcement change requires separate authorisation.
7. Pair all tills to the new authority, verify local guards and reconcile opening totals before first real trade. Capture a verified initial backup.

Rollback before the first local trade can restore configuration from the verified pre-cutover snapshot. **After any local commit, do not switch back to cloud mode or restore an older DB as an ordinary rollback.** Freeze writes, preserve journals/exports, reconcile and perform an explicit reviewed handback/import. Unknown commands and authority epochs remain fenced.

Software upgrade rollback is separately managed: compatible binaries/schema versions, pre-upgrade backup, migration receipts and a maintenance state. Never run an old binary against an incompatible new local schema.

## 11. Backups, restore and durability

Use PostgreSQL `fsync=on`, `full_page_writes=on`, `synchronous_commit=on` for financial commits. Validate settings in the readiness/doctor tool. An OS/process crash test is necessary but does not prove every disk/controller honors flush; qualify actual host hardware and recommend UPS protection.

Implement encrypted, consistent PostgreSQL backups using supported tools/APIs, not a live directory copy. Initial defaults: daily verified base backup, frequent WAL archive to another local physical device where configured, hourly recovery health check; retention policy 24 hourly recovery points, 7 daily, 4 weekly subject to measured capacity. Use actual recoverability measurements, not nominal scheduler intervals. Archiving needs a continuous valid WAL chain and appropriate WAL settings; report a broken chain immediately.

Acceptance targets: no loss of an acknowledged commit on process/OS restart of a functioning disk; host-disk-loss RPO <= 5 minutes **only when** a verified second-device WAL archive meets that lag; otherwise disclose measured backup-age RPO. Target tested host replacement RTO <= 60 minutes on qualification hardware. If the environment cannot meet these targets, leave readiness blocked or state the explicitly approved operational limitation, never claim zero data loss.

Backup scope includes database, authority identity/epoch, schema history, import/cutover receipts, outbox/export manifests, catalogue/config, accounting evidence, attachments, print records and documented restore trust material. Protect auth verifiers and keys with owner-held encrypted recovery material; do not rely solely on the original Windows DPAPI profile. Redacted support bundles remain separate from full recovery backups.

Restore process:

- verify encrypted package, hashes, schema/version and WAL continuity into a staging cluster;
- verify ledger balances, stock totals, receipt uniqueness, operation receipts, outbox checkpoints and authentication recovery;
- require authorised activation and fencing of the old host; preserve authority ID, increment epoch under an audited restore procedure, rotate/pair credentials as required;
- old host must remain stopped/off-network; clients reject its stale epoch. Epoch numbers do not magically fence an isolated still-running host, so physical/operational isolation is mandatory without quorum;
- reconcile client intents newer than the backup by original operation ID and preserved envelope. An acknowledged client receipt missing from restored DB is a data-loss incident; never regenerate it as a fresh sale automatically;
- prove replacement-machine owner recovery and till re-pairing with internet physically blocked.

Retention never deletes the only valid backup/WAL chain or the only copy of an unresolved command. Disk-low states surface actionable guidance; disk exhaustion cannot yield a false commit acknowledgement. Backups are not failover and cannot promise data newer than the verified recovery point.

## 12. Windows deployment and support

Develop against a pinned supported PostgreSQL major and verify it at implementation time; prefer the current compatible supported major, record exact patch/tool versions in the evidence. Do not introduce Docker as a customer runtime requirement. A local disposable container is acceptable for tests.

Prepare a separate Bar service installer/installation bundle for supported host Windows x64 with bundled/pinned runtime or a verified fully offline prerequisite installer, PostgreSQL tooling, service wrapper, TLS bootstrap and documented licence notices. Validate signatures/checksums of redistributed dependencies. No download-on-first-launch dependency in an offline installation.

Service runs under a dedicated least-privilege OS account, starts after PostgreSQL, recovers after reboot, rotates logs and has scoped firewall rules. PostgreSQL binds loopback/private service boundary, not unrestricted LAN access. Only authenticated TLS API is exposed to till subnets. Installation, upgrade and removal must preserve trading data/backups by default. Do not overwrite system PostgreSQL installations or unrelated ports/data directories.

Include `doctor` diagnostics for service/DB reachability, authority/epoch/version, TLS expiry, disk, recovery lag, schema compatibility, journal health, local capability/entitlement status and external integration state. Default timeouts must let a till reach a recoverable state promptly. A cashier can open guides and inspect committed receipt history without cloud credentials.

Legacy client build keeps its existing app ID, ia32 target, release feed and minimum runtime. The local host is a newer supported computer; do not claim the legacy OS itself becomes secure/supported through this change. Test TLS transport on its real target environment before qualifying it.

Preserve modern product IDs/update feeds and isolate Bar runtime code in product bundles. Hotel/lodge builds must not start the local server, open local DB paths, inherit local authority login, or lose existing cloud RPC guards.

## 13. Work packages and implementation order

Execute these within one implementation engagement, with durable checkpoints. A checkpoint is not permission to stop after a scaffold; unavailable infrastructure/approval must be recorded truthfully and independent work continued.

| WP | Deliverable | Completion evidence |
|---|---|---|
| 0 | baseline status/hashes, exhaustive matrix, authority ADR, dependency inventory, no-hosted-target guard | current tree evidence, actual route/action mapping, safe local test runner |
| 1 | service lifecycle, local DB/migrations, contracts, auth/pairing/entitlement, first-owner commissioning | blank local install and denial/bypass tests with internet blocked |
| 2 | receipts/idempotency/locking, sale/payment/stock/audit/outbox atomic core, durable modern + Legacy intents | real concurrent and crash-window DB/API tests |
| 3 | tabs/corrections/shifts/drawers/cash-up/stock/purchasing and hardware linkage | production-path workflows and reconciliation |
| 4 | all locally offered add-ons/settings/import/export/accounting/workforce/control functions | every matrix row implemented or justified external boundary, no dummy routes |
| 5 | modern and Legacy authority routing/UI, changefeed, recovery, mesh/old-queue fencing | rendered multi-till tests, direct API guards, untouched cloud-mode regressions |
| 6 | export/outbox/checkpoints and disabled cloud transport; dry-run data cutover/fencing | deterministic bundle validation, fake-receiver tests, no hosted writes |
| 7 | full backup/WAL/staged restore/host recovery and offline service installer | replacement-host restore evidence and packaged runtime exercise |
| 8 | stress/fault/security/regression qualification, manuals/quick-start/screenshots/PDFs, review packet | recorded results, approval status, exact limitations and hashes |

### Historical checkpoint coverage (22 October 2026)

This table is retained as a dated implementation snapshot; it is not the current status. The 27–28 October continuation below and `TAKEOVER_CONTINUATION_2026-10-27.md` supersede its statements where they conflict.

| WP | Current state | Remaining gate |
|---|---|---|
| 0 | Partial: baseline report, ADR, dependencies, matrix, manifest, evidence log and hashes exist. | Resolve existing broad Bar/preload/renderer checks and review all live routes against the matrix. |
| 1 | Partial: service/contracts/local-only migrations through 0040, Windows PostgreSQL/service/backup scripts, and protected Modern/Legacy authority profiles and main-process clients exist. Modern has first-owner and join forms; both clients expose authenticated pairing and administration. | Signed/offline installer, clean-machine owner setup, LAN TLS provisioning, installed reboot proof and supported Windows qualification. |
| 2 | Partial: service-level atomic/idempotency source and historical 100-request A03 evidence exist; clients journal stable intents. The 21 Oct 113/113 result through migration 0038 is historical. Current full package suite was attempted but database cases require the unconfigured disposable-test opt-in; current focused admin/replication/operations tests pass 39/39. | Re-run DB/API and concurrency suites against the explicitly isolated target; add process-kill/restart windows and finish routing both app clients through durable intents. |
| 3 | Partial: service source includes sales/tabs/corrections/stock/purchasing/cash-up. Modern and Legacy expose staff login, versioned catalogue product create/edit, outlet availability, cash sale with manager-approved promotion, tabs, stock receiving, shift/cash-up, paid-in/paid-out/float drawer movements and physical drawer counts. A count locks the shift, snapshots service-calculated expected cash and variance in the committed receipt/audit/outbox record, and does not change expected cash. Both workspaces show timestamped count entries through the existing cash-movement query and display the count-time variance after commit. Both clients list submitted cash-ups in the local reporting window, approve/reject with a required reason/PIN, and reopen a reviewed cash-up into a new recount revision. Existing service SQL enforces maker-checker, approval expiry/scope/one-time use, reviewed-state match, period lock and revision snapshot. Focused drawer count/movement replay and source tests, Modern/Legacy builds, and Bar service/contracts typecheck passed; DB integration assertions for count replay/variance are added but need the guarded local PostgreSQL target. | Complete paired drawer handover with receiver confirmation, additional manager-gated workflows, hardware receipt/printing integration and installed reconciliation coverage; execute drawer count/movement DB cases and exercise callers against an installed local service. |
| 4 | Partial: service contracts include workforce, tips, accounting/AP/bank/tax/payroll/budgets, reports, exports, loyalty, menu modifiers/recipes/promotions and control. Modern and Legacy local cashier flows consume configured modifier snapshots for sales and tab additions, including modifier-aware estimates and authority-priced command payloads. A scoped `menu.modifiers` query exposes manager configuration; a separate `menu.promotions` query exposes only business-scoped, currently active promotion definitions and the discount policy to `pos.view` sessions. Both cashiers accept a promotion code for `sale.commit`, check applicability and threshold locally for guidance, request a different manager's exact-operation approval above threshold, and leave maximum, eligibility and final totals to the service. Both local customer panels now connect enrollment, sale-linked points earning and redemption through durable service commands; Modern selects a recent sale while Legacy requires the committed sale UUID. The database owns balances and eligibility; timestamped current-balance reads and scoped Modern/Legacy programme management are now wired; recipes and other offered add-ons remain open. | Connect every offered workflow through both app APIs; preserve denial, audit, retry and recovery evidence. |
| 5 | Partial: Modern fixed main/preload adapter, fail-closed startup authority check and main IPC cloud-handler fence exist. Modern and Legacy local workspaces use service queries/commands and durable intent IDs for currently exposed workflows, including versioned product edits, outlet-scoped audit search, local support-report entry, stock/cash-up reports, drawer movements, menu availability, manager-approved returns/voids/promotions, cash-up review/reopen, modifier selection and settings-managed discount policy, with authenticated readiness indicators that distinguish current ready, blocked, stale, unknown and unavailable checks. Admin panels distinguish an unavailable backup destination from an empty package list; the Modern admin adapter now unwraps the service's status/replication/package response envelopes so those panels show the actual returned data. Both tender editors state the external-provider boundary and prevent a client from claiming provider confirmation. Both cashiers refresh the complete local catalogue every 15 seconds; Legacy also consumes the authenticated, device/outlet-scoped event cursor and retention-gap signal. The service pages events by whole commit groups so its commit-sequence cursor cannot skip same-commit rows. On menu changes clients load a consistent paginated snapshot and clear unsent cart/promotion state; failed catch-up blocks sale commit until a complete snapshot succeeds. | Finish all domain routes, background job routing, installer integration, live multi-till/rendered tests and cloud-mode regression. |
| 6 | Partial: the service creates bounded unsigned bundles in the local database, validates manifest and event payload hashes, retains exported events without acknowledgement, and keeps hosted transport disabled. Authenticated `outbox.bundle.get` scopes by business/outlet/authority/epoch and rechecks the canonical manifest digest and each event payload hash. New `outbox.status` reconciliation returns current-scope pending/exported counts, exported/acknowledged watermarks, and integrity results for the 50 most recent batches against their outbox rows/items. Modern and Legacy admin panels show those values, pause new exports if status is unavailable or a recent batch fails integrity, create through durable command handlers, download only complete unsigned bundles, and retain the confirmed batch ID for same-batch recovery. UI contract checks pass; API/DB scope and tamper assertions are added but remain unrun behind the isolated-target guard. | Add crash/replay worker and end-to-end checkpoint/cutover reconciliation; prove dry-run data cutover/fencing. Signing, production hosted transport and acknowledgement remain disabled. |
| 7 | Partial: Windows service and hourly/daily/startup backup task source, encrypted `pg_dump`, hourly/daily/weekly retention, optional secondary destination copy, GCM package authentication, isolated restore verification and signed update staging helpers exist. The admin path surfaces audit-write failure and database/destination uncertainty; secondary-copy health is now visible in both Modern and Legacy admin panels (EV-162). A copy folder is not independent merely because it is a different path. | Offline signed installer, independently verified off-host destination/WAL/PITR, replacement-host restore, measured RPO/RTO, installed lifecycle/reboot tests and qualification. Hourly snapshots reduce local snapshot spacing only; they do not establish an off-host recovery point or PITR. |
| 8 | Partial: scoped evidence/review documents exist; service build, 39 focused service tests, 4 readiness tests, 23 tender tests, 2 Modern admin-response tests, renderer typecheck and both product builds pass. External tenders are explicitly recorded as locally asserted; neither UI lets an operator claim provider confirmation without a trusted integration, and both refuse local room-charge completion. The broad `npm test` invocation was attempted but database-backed cases were gated on an unconfigured isolated `BAR_LOCAL_TEST_DB=1` target; a separate guarded 132/132 service-suite result is recorded in the implementation report. The user directed that PDF, quick-start, screenshot, approved-manifest and packaged-guide edits remain pending. | Complete acceptance matrix, run remaining guarded DB/API/load/fault/security evidence, refresh hashes, verify installed packaging, and obtain independent review. Customer guide work remains pending until the user resumes it. |

### Continuation update (28 October 2026)

| Work package | Current implementation/evidence | Remaining work |
|---|---|---|
| WP1 | Local service uses one business per authority/database. The full isolated PostgreSQL suite passed 205/205 with PostgreSQL 17.6 and migrations through 0068, including the forged business/outlet/authority/device API scope regression and no-write assertions. | Add second-authority tenant isolation proof and complete direct-bypass/role matrix. |
| WP3 | Drawer handover is implemented in migrations 0055/0056 and both local clients. Migration 0066 rejects generic drawer tip payout, requires an active catalogue item when opening a shift, and blocks tip-payout reversal against a closed shift. Migrations 0069/0070 add lot balances/FEFO, selected-lot waste and inspected quarantine release; focused 0069/0070 DB tests pass 2/2 (EV-153). | Implement reviewed financial correction/reconciliation after a closed shift; reconcile historical tip/cash-up corrections; finish remaining guarded race/replay tests and installed reconciliation. The broad 206/206 suite predates migration 0070. |
| WP5 | Modern and Legacy product/availability catalogue reads now require matching scope, snapshot watermark, product ID/SKU/version and pagination before editing/trading. Snapshot drift triggers bounded retries and clears stale menu/edit state. Focused snapshot tests passed 8/8; renderer typecheck and both product builds passed. | Complete background authority routing, installer integration, multi-till rendered tests and cloud-mode regression. |
| WP6 | Export/acknowledgement counters are presented as highest observed sequence values; neither those maxima nor `received`/`validated` evidence establishes a contiguous ingested prefix. Backup verification exposes highest-sequence aliases and reports the contiguous checkpoint as unknown. | Implement and test the planned cloud-to-local dry-run importer and per-outlet cutover evidence. The user selected Botswapelo Lounge, but no target export was available, no importer exists, and old cloud writers are not server-fenced; no activation is ready. |
| WP8 | Current focused results are indexed in `EVIDENCE_LOG.md` and the continuation checkpoint. The full guarded isolated service suite passed 205/205 on PostgreSQL 17.6 with migrations through 0068; the successful disposable database was stopped and retired. PDF, quick-start, screenshots, approved-document manifest and packaged guides remain deferred by the user. | Rerun and resolve the broad Bar suite as appropriate, then run remaining security/load/fault acceptance. Customer qualification and the separate physical/manual release gates remain open. |

### 29 October locally achievable workflow additions

Fresh hospitality-pos startup now opens local owner setup by default; selecting a cloud workspace is explicit. This does not create an authority or bypass protected provisioning/readiness. Committed-local startup returns before cloud database, queue, mesh, timer and updater setup; focused startup gates pass, while profile/session/cache and shared-renderer route acceptance remains incomplete. The local finance workspace exposes exact-range trial balance, journal posting with exact-cent UI balance preflight, and maker-checker period close. Migration 0071 adds settings-managed, outlet-scoped support-report history; migration 0072 repairs runtime allowlists for lot commands on existing local databases. Migration 0073 adds a maker-checker tip payout reversal through a separately selected open manager drawer after the original drawer closes; it records a linked paid-in movement and preserves the original cash-up. See EV-154–156. User-directed multi-PC, Supabase-dependent, physical install/hardware and customer PDF/guide gates remain pending and non-blocking for a software release; local-authority commissioning still requires independent readiness/operations acceptance. Other local software remains open, including the rest of post-close corrections, independent WAL/PITR backup, signed update orchestration and isolated training mode.

### 29 October 2026 — backup copy wiring and local default clarification

The fresh-install default is local owner setup, not automatic database installation or business activation. A local Bar service/PostgreSQL instance must be installed and running; the owner must complete protected one-time setup and readiness before trading. A saved cloud business cannot be imported or switched by choosing the local path.

`BAR_LOCAL_BACKUP_COPY_TO` now reaches manual encrypted backup creation, and the Windows service installer rejects secondary-copy paths that overlap PostgreSQL data, primary backups, service data or the installation. Authenticated admin status reports whether the configured destination is readable and the latest package; Modern and Legacy admin panels display the destination and same-drive limitation. EV-162 records focused guarded PostgreSQL/API/installer checks, local workflow tests and both product builds. This copy does not provide WAL/PITR, independent off-host recovery, or replacement-host restore. The dedicated local database remains the first-run default; actually commissioning it still requires a separately provisioned, protected service.

Backup storage separation now resolves existing symlink/junction ancestors in both service config and Windows installer path helpers before comparing protected directories. A junction-backed secondary copy nested under primary backup storage is rejected; the Windows path helper integration test and the 18-case guarded PostgreSQL/API/installer suite pass (EV-163). This closes a path-alias bypass but does not add WAL/PITR or qualify an installed restore.

All package and acceptance statuses remain partial/unverified for full production-path acceptance. Witness failover is refused at service startup pending a safe coordinator and fencing proof. See `FAILOVER_2026-10-27.md` and the continuation checkpoint for scoped results and known gaps.

Do not port money logic independently into clients to make a page work. Build the database contract and scoped API first, then wire callers and cover the real path.

## 14. Verification and acceptance IDs

Create a runnable acceptance manifest linking these IDs plus each feature-matrix row to executable tests/evidence. Tests must invoke real production functions/API/DB. Regex/source checks and mocks cannot establish atomicity, permission isolation, durability or local-mode correctness.

| ID | Required proof |
|---|---|
| A01 | clean local commissioning, owner login, staff/menu setup, paired modern and Legacy tills with all internet/DNS blocked; no hidden cloud bootstrap |
| A02 | two tenants, two outlets, cashier/stock/manager/finance roles; forged actor/outlet/device/session, revoked session and direct RPC/table/API bypass all denied |
| A03 | 100 simultaneous identical-key requests produce one receipt, one payment/stock/accounting effect and identical recovery outcome; changed-payload reuse conflicts |
| A04 | process kill before send, before commit, after commit/before reply, after reply/before client journal checkpoint, during print; original intent recovers without double effect |
| A05 | simultaneous last-unit sales, voucher/credit spends, tab settlement/split/transfer, return limits, cash-up close/approval, purchase receipt and stocktake races preserve invariants |
| A06 | every primary/add-on workflow in matrix passes through real local API, including blocked permissions, invalid state, recovery and audit assertions |
| A07 | pricing/tax/discount/tender/change and fractional stock use agreed rounding; invalid decimals/blank/NaN/overflow/currency mismatch rejected; allocation sums reconcile |
| A08 | shift/menu changes after original commit do not break receipt recovery; truly uncommitted closed-shift work is refused/reconciled without rewriting shift/key/date |
| A09 | server/LAN lost while internet remains: no cloud fallback or independent financial completion; retained intent resolves on reconnect; auth/scope fence survives restart |
| A10 | suspended staff/package restrictions/manager maker-checker enforced by service and DB, not merely UI; offline licence artifact validation and expiry policy tested |
| A11 | client/main/service/DB restarts, corrupt/torn journal, full disk, backup destination failure and clock rollback produce explicit safe outcomes, never success/zero data fabrication |
| A12 | backup into staging and replacement-machine restore with no internet; verify ledger/stock/receipts/outbox/auth, stale-host isolation, missing-receipt detection, measured RPO/RTO |
| A13 | outbox commit atomicity, worker crash, duplicate/out-of-order batches and partial fake acknowledgements; exported != acknowledged; real hosted transport unreachable/disabled |
| A14 | old cloud queues/mesh copies cannot import local trades; existing cloud-mode desktop/Legacy, hotel/lodge, PWA/public paths retain their contracts |
| A15 | all local reports/exports have matching dataset hashes/totals/watermarks, no duplicate historical prefix, no truncated pages, accounting readiness fails closed |
| A16 | strict TypeScript checks for the new service/contracts; compiled JavaScript compatibility and startup without development tooling; offline packaged installer/service reboot and unattended lifecycle, native module loading, legacy TLS/main compatibility, local peripherals and guide access |
| A17 | restore/cutover/upgrade dry run preserves pending work; unresolved cloud outcomes and unfenced old writers prevent commissioning; rollback after local trade blocked |
| A18 | external tender/room charge/global voucher/support/filing boundaries visible and correctly pending/unavailable; no false provider confirmation |
| A19 | every affected customer instruction/screenshot/quick-start/PDF visually verified; approved-manifest status honest; ordinary cashier can open/save both packaged guides offline |
| A20 | multi-process qualification below completes with invariant queries and artifact hashes; no ignored failed financial operations |
| A21 | installed Windows 7 Legacy till with modern office host: offline pairing/login, office create/link/publish, automatic LAN menu update, scope denial, packs/prices/tax/barcodes, deleted/empty/paginated snapshots, stale cart and reconnect recovery; required Bar cashier workflows pass |
| A22 | three eligible modern hosts and actual supported coordinator: full seed/catch-up, synchronous durability, primary loss, partitions/quorum loss, fencing, safe candidate eligibility, old-host return, original-key recovery and no lost acknowledged sale/duplicate stock or export; measured interruption/lag |
| A23 | mixed single-host and two-modern-host profiles show truthful limitations; unsafe sole-survivor finalisation denied; witness/manual recovery where supported, offline runtime/key provisioning, replication disk failure and independent backup restore verified |

### Load and outage qualification

Use an isolated cluster and actual API clients, at least three concurrent till processes (include modern and Legacy-compatible paths). Seed a realistic full catalogue/stock/staff fixture. Commit **50,000 real sales** over simulated 42-day business periods, with realistic tab/cash-up/return/receiving activity, fault/restart points, and no internet. The business-date test seam must be test-only and absent from production APIs. Simulated days do not constitute a 42-day wall-clock soak; report that distinction. Also run a sustained wall-clock trading soak of at least 8 hours on reference hardware before customer qualification; report if unavailable.

At a declared test load of 5 completed sales/second across tills, target p95 local commit <= 500 ms and p99 <= 2 s on the recorded host/network, excluding printing/provider latency. Record raw latency/error histograms, resources, DB size, disk/backup behavior and contention. Test stock/open tabs/shift transitions and local queries concurrently. Do not replace 50,000 actual sales with queue-transfer tests or waive integrity for throughput.

Final invariant queries must reconcile order/return net, tender/cash ledgers, stock movements/balances, customer/voucher liabilities, cash-up variances, accounting postings/source coverage and unique operation/receipt counts. Retain deterministic seeds and failure diagnostics.

### Existing repository scripts

Re-read `package.json` before executing; these names exist in the planning snapshot:

```text
npm test
npm run test:offline-queue-critical
npm run test:offline-pos-critical
npm run test:financial-integrity
npm run test:inventory-offline-sync
npm run test:queue-replay-authority
npm run test:financial-truth
npm run test:bar
npm run test:bar-guides
npm run test:bar-guide-behavior
npm run test:typecheck:main
npm run test:typecheck:preload
npm run test:typecheck:renderer
npm run test:typecheck:shared
npm run test:release-behavior
npm run test:release-architecture
npm run test:web-surfaces
npm run build:hospitality-pos
npm run legacy-pos:test
npm run legacy-pos:build
```

Run appropriate hotel/lodge product builds when shared boundaries change; use verified current script names. Add explicit new service/DB/API/fault/restore/soak scripts and register them in a discoverable aggregate. Do not claim a proposed test script existed before implementation. Read wrappers for target selection before running financial SQL, Bar product SQL, Restaurant/accounting suites or disposable commands. Use them only if their target has been positively constrained to the isolated local test cluster; otherwise document a safe local adaptation. No existing `--linked` or hosted default is permitted.

Record baseline failures with exact test IDs and output before editing; compare after. Do not weaken tests, update assertions to accept a regression, report skips as passes or call a build a packaged installer. Missing runtime/hardware/keys blocks its respective gate; complete remaining work and report the boundary.

## 15. Documentation, review and release state

Manual impact: **required when the user authorizes the guide work**. This changes installation, login, approvals, offline meanings, recovery, stock/financial finality and equipment/topology. Update the manuscript, quick-start source, feature matrix, coverage/evidence/screenshots/QA, all affected captures, and generate/review PDFs using the relevant document/PDF skills. Customer PDFs describe operator actions and recovery; internal SQL/service deployment/signing/accounting activation mechanics stay in engineering documentation. Current user direction defers these edits and classifies them as pending but not blocking a software release; no guide is thereby approved, and local-authority commissioning remains subject to its separate operational gates.

Read the approval rule in `docs/bar-manual/maintenance.md`: generated PDFs are not automatically approved. Preserve the approved-manifest meaning. Prepare clearly labelled candidate PDFs and a review record when guide work resumes; update the approved manifest only with actual approval evidence. Do not fabricate approval or silently label old guides as updated. Under the user's current release-scope instruction, missing guide artifacts are recorded pending and do not block a software release; this does not grant guide approval or customer-ready local-Bar status.

Implementation must deliberately update the durable engineering rules to scope the existing Supabase-only financial rule: cloud-mode/hotel/lodge remain Supabase-authoritative; commissioned local-Bar mode uses local service/PostgreSQL atomic contracts. Do not silently contradict `AGENTS.md` or globally relax its rule. If editing `AGENTS.md` is restricted, provide the exact proposed amendment and leave activation blocked pending that documentation integration.

Update `docs/ARCHITECTURE.md`, `PROJECT_STATE.md` and applicable release/deployment/manual matrices with factual implementation and test status. Preserve existing dated evidence; do not rewrite old NO-GO reports as though they approved this design. Source completion, independent review, entitlement approval, guide approval, hardware qualification, customer commissioning and hosted integration are separate states.

Produce `IMPLEMENTATION_REPORT.md`, `ACCEPTANCE_RESULTS.md`, `SECURITY_AND_FAILURE_REVIEW.md`, `MANUAL_IMPACT.md`, `CUTOVER_AND_RECOVERY_RUNBOOK.md`, `FUTURE_CLOUD_CONTRACT.md` and a review manifest with changed-file SHA-256 values, current dirty-tree boundaries, exact commands/results, DB/runtime versions, logs, screenshots, packaged artifact inspection and all open limitations.

The follow-up review uses [REVIEW_PROMPT.md](REVIEW_PROMPT.md), independently verifies production paths and may require corrections. No installer publication, real customer switch, hosted migration/write or cloud ingestion is authorised by this plan. A single implementation pass is an execution goal, not evidence that every gate passed.

## 16. Definition of done

Implementation is complete for review when the local stack, all in-scope feature rows, modern/Legacy clients, local-only migrations, installer source, backup/restore, export boundary and documentation candidates are concrete and runnable; meaningful tests prove financial/stock invariants and denial paths; unrelated surfaces retain their contracts; and the evidence names every unexecuted qualification honestly.

Production readiness additionally requires independent review/corrections, approved commercial and accounting policy artifacts where applicable, approved guides, signed/offline installer and target-hardware proof, measured backup/restore targets and a separately authorised reconciled/fenced customer cutover. Cloud consolidation additionally requires its own reviewed and authorised hosted contract. Neither is implied by local code completion.

## Primary technical references

These justify technology constraints, not product-specific correctness; record the exact supported versions selected at implementation time.

- [SQLite appropriate uses](https://www.sqlite.org/whentouse.html): embedded storage versus shared network access.
- [PostgreSQL application-level consistency](https://www.postgresql.org/docs/current/applevel-consistency.html): locking/isolation and transaction discipline.
- [PostgreSQL WAL settings](https://www.postgresql.org/docs/current/runtime-config-wal.html): durability configuration.
- [PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html): base backups and complete WAL chains.
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html): consistent logical backup tooling.
- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting): self-hosting exists, but this plan selects a dedicated local service rather than requiring the full stack at each Bar.

## 28 October 2026 — current continuation status

See [the 28 October continuation checkpoint](TAKEOVER_CONTINUATION_2026-10-28.md) and [evidence log](EVIDENCE_LOG.md) for exact results. Recoverable provisioning, bounded cloud response-body handling, explicit runtime grants for reviewed cloud-sync functions, and a synthetic transition-export validator have been implemented. The validator now checks explicitly declared parent-child decimal totals; focused tests passed 12/12 (EV-142). The full isolated PostgreSQL run passed 205/205 on PostgreSQL 17.6 after migrations 0001–0068 (EV-146); after adding migration 0069 for current lot balances, FEFO depletion, transfer lineage and traceable returns, the full suite passed 206/206 (EV-150). Final query scope and direct-table ACL follow-ups passed focused real HTTP Modern/Legacy lot query and database FEFO/return/denial tests 1/1 each; contracts passed 19/19, renderer typecheck passed, and both production builds passed (EV-151). Five rendered Modern workflow browser suites passed 5/5 when serialized (EV-152). Migration 0070 adds manager-approved exact-lot waste and quarantine inspection/release: focused PostgreSQL cases passed 2/2, the Modern rendered stock workflow passed 1/1, contracts passed 20/20, renderer typecheck and both product builds passed (EV-153). Preserve EV-143 and the first EV-151 API-query attempt as historical failures with fixes documented; the guarded runner's 4 GiB protection was not weakened. The synthetic transition validator does not authorize Lounge inventory or cutover. Reviewed corrections after a closed shift, remaining host/data-transition work, broad qualification and customer documentation remain pending but non-blocking for a software release at the user's direction; local-authority commissioning remains NO-GO until its separate operational gates pass.

## 29 October 2026 — current continuation status

The Windows backup path checks now resolve junctions/reparse points before comparing backup, copy and PostgreSQL data destinations (EV-163). The guarded isolated PostgreSQL/service suite then passed **214/214** on PostgreSQL 17.6; all cluster lifecycle steps exited 0 and the disposable data was retired after clean shutdown (EV-164). This confirms the current implemented service contracts and does not close missing feature rows. Remaining local implementation includes independent WAL/PITR with recovery health and replacement-host restore, complete reviewed post-close sale corrections, an isolated training/rehearsal authority, complete operator-facing signed-update orchestration, and full profile/session/cache/shared-renderer route isolation. Physical multi-PC and Supabase/source-transition work remains excluded by user direction. Customer PDF/quick-start/screenshots/manifest/package-guide work remains pending and non-blocking for a software release; local-authority commissioning remains NO-GO pending its independent gates.

EV-165 adds a focused, streaming AES-256-GCM WAL segment archive/restore primitive and command-line contract, verified by four focused tests plus a strict service typecheck. PostgreSQL does not yet invoke the helper and there is no physical base-backup chain, continuity/retention policy, recovery health check or restore orchestration. Treat this as a building block only; PITR remains unimplemented and unqualified.

### 29 October implementation continuation

The current source also contains the bundled Modern first-Bar install/owner provisioning flow and already selects local setup by default on a fresh `hospitality-pos` install. This supersedes the earlier dated checkpoint that said setup required an already-running service; the installer is still not qualified on an installed Windows target. EV-166 wires a Modern offline update folder picker/copy, signed package staging, guarded apply, checkpoint re-verification, failed-apply recovery display, and post-apply restart/version status. Service build and focused tests passed 73/73. The managed Windows restart behavior remains unverified. The remaining software gaps are training isolation, full PITR/recovery, full profile/session/cache and shared-screen isolation, and the rest of reviewed post-close correction coverage; replacement/failover and physical qualification must stay fail-closed until safely proven. Customer manuals/PDFs and their package checks remain pending and non-blocking for a software release by user direction. This continuation does not close the plan or qualify customer commissioning.

EV-169 adds the loopback-only PostgreSQL admin URL to the installer’s ACL-protected service environment for backup, restore-drill and update-checkpoint operations, and completes the Modern shared-till private-state reset across manager drafts, approval PINs, transient flags, and late audit/support responses from an earlier staff session. The focused installer/renderer suite passed 24/24; Modern renderer and Bar service typechecks passed; and the final Modern package build passed. This is a scoped hardening follow-up; it does not close the plan. Training authority, PostgreSQL-integrated WAL/PITR/base-backup recovery and replacement-host recovery remain unimplemented. The installer and service restart still need a real installed Windows qualification; the full DB suite is not rerun until the retained-fixture 4 GiB reserve is available. Customer guide artifacts remain pending and non-blocking for software release per user direction.

### 29 October verification continuation

EV-168 records passing Modern/Legacy local suites, rendered finance workflows, local contracts, offline-update unit tests, affected typechecks, and both production builds. It also repairs the isolated test runner's missing test-only database opt-in. The first fresh full service run stopped cleanly but had six configuration-setup failures among 232 tests; after the runner fix, the six update tests pass directly. The failed cluster fixture is retained and the runner's 4 GiB guard now prevents a fresh full rerun. No post-fix full-suite pass is claimed. The complete software plan remains open for training isolation, a real WAL/base-backup PITR chain, replacement-host recovery/fencing, installed Windows lifecycle, and complete workflow acceptance. Supabase, multi-PC, and customer guide qualification remain deferred under the user's instructions.
