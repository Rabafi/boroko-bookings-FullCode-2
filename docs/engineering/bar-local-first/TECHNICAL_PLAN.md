# Bar local authority: implementation and verification plan

Date: 19 October 2026, Africa/Gaborone.

Status: **proposed architecture and implementation contract; no implementation, commissioning or deployment is claimed by this document.**

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

Mesh must not replay local-authority commands into cloud lanes or turn peers into competing servers. Keep old mesh/cloud behavior for non-migrated profiles. In local mode, pin the one authority and reject old epochs. No automatic leader election/failover in this pass.

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
| A16 | offline packaged installer/service reboot and unattended lifecycle, native module loading, legacy TLS/main compatibility, local peripherals and guide access |
| A17 | restore/cutover/upgrade dry run preserves pending work; unresolved cloud outcomes and unfenced old writers prevent commissioning; rollback after local trade blocked |
| A18 | external tender/room charge/global voucher/support/filing boundaries visible and correctly pending/unavailable; no false provider confirmation |
| A19 | every affected customer instruction/screenshot/quick-start/PDF visually verified; approved-manifest status honest; ordinary cashier can open/save both packaged guides offline |
| A20 | multi-process qualification below completes with invariant queries and artifact hashes; no ignored failed financial operations |

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

Manual impact: **required**. This changes installation, login, approvals, offline meanings, recovery, stock/financial finality and equipment/topology. Update the manuscript, quick-start source, feature matrix, coverage/evidence/screenshots/QA, all affected captures, and generate/review PDFs using the relevant document/PDF skills. Customer PDFs describe operator actions and recovery; internal SQL/service deployment/signing/accounting activation mechanics stay in engineering documentation.

Read the approval rule in `docs/bar-manual/maintenance.md`: generated PDFs are not automatically approved. Preserve the approved-manifest meaning. Prepare clearly labelled candidate PDFs and a review record; update the approved manifest only with actual approval evidence. If approval is unavailable, mark guide/package release blocked and retain the complete reviewable candidates. Do not fabricate approval or silently ship old guides for changed workflows.

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
