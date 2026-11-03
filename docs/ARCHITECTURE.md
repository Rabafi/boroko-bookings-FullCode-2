# Tsa Bonno HospitalityOS Architecture

27 October Bar startup follow-up: Modern Restaurant/Bar first-run choice is resolved before cloud initialization. Pending choice opens only local setup/guide IPC. An explicit cloud workspace preference takes effect after restart; a committed local authority always overrides it. Renderer startup skips cloud bootstrap while the choice is pending. This does not migrate saved cloud businesses or enable hosted ingestion. See `engineering/bar-local-first/TAKEOVER_2026-10-27.md`.

27 October Bar cloud-sync follow-up: the local Bar service now owns a server-only, durable outbox uploader. It runs only on the designated `single_host` server, holds a PostgreSQL advisory lock so one pass runs at a time, uploads oldest committed batch first in bounded passes, signs each batch with HMAC-SHA256 over `<key_id>.<batch_id>.<manifest_hash>`, and advances the local acknowledgement only when a receiver reports `ingested`. `received` and `validated` receipts are recorded but leave work pending, and a local export file is never treated as a cloud acceptance. Transport is `disabled` by default; `local_test` permits loopback receivers only; `approved` is reserved and refuses to run without separate hosted activation. No hosted receiver is deployed and no local trade has been uploaded to Supabase.

Last reviewed: 2026-10-27

## System map

Local Bar follow-up (26 October 2026): migrations 0058/0059 preserve exact decimal responses and refuse new corrections against closed or cash-insufficient original drawers while committed receipt recovery remains available. Migration 0060 cancels an unallocated tip with a full-sale void through the original tender allocation and source-to-GL paths. Allocated staff tips fail closed pending supported reconciliation. Modern saved-operation storage now uses transactional SQLite; the financial authority remains the dedicated local PostgreSQL service. Hosted Supabase ingestion remains disabled and no hosted migrations were run. Coordinator, enrollment, WAL/PITR and installed qualification gates remain open.

| Surface | Runtime | Authoritative write path | Offline behavior |
|---|---|---|---|
| Desktop front desk | Electron + React | Renderer -> preload/IPC -> `database.js` facade -> domain module -> Supabase RPC | Main desktop queue, append-only local operation journal, local cache, mesh operation sharing, manager offline-mode controls |
| Manager PWA | React browser app | Direct Supabase RPC | Limited device-local queue for approved operational actions |
| Legacy POS | Electron 22 + React | POS renderer -> preload/IPC -> Legacy POS main process -> Supabase RPC | Separate POS cache/queue plus mesh peer synchronization |
| Local Bar authority (partial; unqualified and not generally commissioned) | Modern Hospitality POS or Legacy POS -> fixed preload/IPC bridge -> main-process local authority adapter -> `services/bar-local` -> local PostgreSQL | Dedicated scoped local commands with durable intent IDs; both clients expose login, shift, sales/tabs/corrections, stock and cash-up workflows plus administration/operations panels for status, backups, replication controls, pairing, loyalty programme management and current ledger-backed loyalty balance reads. Local export bundles can be retrieved unsigned and without acknowledgement. A server-only uploader on the designated Bar server can send committed outbox batches to a configured receiver, but transport is disabled by default and only a receiver `ingested` acknowledgement counts. Existing domain routing is not yet complete; automatic failover, installed Windows lifecycle, replacement-host restore and hardware qualification are not established. Local Bar mode fails closed and does not fall back to cloud. |
| Public booking site | React browser app | Public server-enforced Supabase RPC/API contract | No trusted financial offline mutation path |
| Command Central | Desktop privileged UI | IPC -> admin domains/RPCs | Administrative actions require explicit error handling |
| Supabase | PostgreSQL | RPCs, triggers, constraints, RLS, audit and idempotency tables | Authoritative source of truth |

## Desktop structure

`src/main/database.js` is a compatibility facade, not the complete business-logic implementation. Domain behavior lives under `src/main/domains/`, including bookings, finance, inventory, maintenance, POS, reports, customer credit, sync, authentication, and administration.

The renderer must not connect around the preload/IPC boundary for privileged desktop behavior.

The local Bar authority is a separate, explicitly committed mode. It uses the local service's authenticated, scoped and atomic command/query contracts rather than Supabase for local Bar operations. Modern startup includes first-owner and join forms; both workspaces connect the currently exposed cashier workflows, including manager-approved promotion discounts and periodic catalogue refresh. Legacy consumes the scoped local event cursor and both clients clear stale unsent carts after a complete catalogue catch-up. Cloud synchronisation is a separate server-side concern: only the `single_host` service process uploads, only one pass runs at a time (PostgreSQL advisory lock), and a pass is bounded and ordered by committed batch. Client processes never upload, and a client cannot acknowledge a batch. This remains a partial integration: installer/service lifecycle and database packaging, installed approval qualification, complete POS domain routing, host replication/failover, independent installed backup/restore, guide packaging, hosted receiver deployment and target-hardware qualification remain incomplete. This exception applies only to the dedicated Bar-local mode and does not change cloud-mode, hotel, lodge, PWA or public-site authority paths.

## Mutation contract

Local Bar submission journals preserve the original envelope through ambiguous replies. PIN-bearing staff commands require OS-protected journal storage, including validated upgrades of older plaintext journal records. A partial write fences that journal instance until restart/recovery; failure to persist a reply checkpoint remains an uncertain original operation rather than permission to create a replacement transaction. The server remains authoritative. Local migrations 0048–0051 normalize replay receipts, make stock snapshots complete, enforce durable commits and reject missing approval hashes. The isolated PostgreSQL runner creates fresh guarded targets; explicit service-test discovery excludes maintenance scripts. These safeguards do not qualify automatic failover or customer installation.

The Modern and Legacy local workspaces share strictly checked accounting, staff-status, loyalty-correction, tip and cash-handover components. Local queries provide versioned/scoped finance records and eligible open-drawer identities. PIN-only approval authenticates the eligible distinct operator through a private temporary service session; the cashier session is preserved and approver access is rechecked at consumption. Paired handovers atomically debit the approved outgoing drawer and credit the confirming receiving drawer. Migrations 0057–0060 correct signed cash totals, preserve exact decimal responses, guard original drawers and conserve unallocated tips on cancellation. The complete isolated service suite passed 152/152; historical signed manifests and outbox hashes are preserved.

Modern commissioned-local startup uses `sqliteFrameStore.ts` through the existing intent state machine. SQLite is a per-device operation journal, not a financial replica or a shared network file. WAL/FULL commits persist each revision before dispatch or receipt acknowledgement; exclusive ownership and expected revisions prevent competing writers. Existing JSONL is validated and imported once, retaining its original IDs, protected credential frames and uncertain states. The original archive is retained but cannot become a fallback. A backend pin in the OS-protected authority profile also detects loss of both the SQLite file and its initialization marker. Failures fence trading until recovery. Legacy Electron 22 retains protected JSONL, and hotel/lodge cloud queues retain their existing storage. Bundled-module and actual Electron OS-storage/process-reopen checks exist on the development PC; installed upgrades, replacement-host recovery and the complete power/peripheral matrix remain unqualified. See `docs/engineering/bar-local-first/TAKEOVER_LATEST_2026-10-26.md`.

Critical mutations should follow this shape:

```text
UI intent
  -> capability and input checks
  -> authoritative RPC with stable idempotency key
  -> atomic database validation and mutation
  -> audit/ledger records
  -> authoritative result
  -> cache/UI reconciliation
```

### Guardrail standard

Every operator-facing workflow must be designed with its failure and recovery paths, not only its happy path. Apply the relevant guardrails: capability and tenant/outlet checks, valid state transitions, server-side input validation, idempotency or duplicate protection, atomic mutation where truth changes, audit/ledger evidence, clear in-product status/error guidance, and focused regression coverage. For financial, inventory, availability, and irreversible actions, these controls are mandatory and must fail closed. A disabled or hidden UI button is helpful guidance, never the authorization boundary.

On an eligible offline path, the RPC name, payload, stable key, and dependencies are stored and replayed. Offline estimates are visibly pending and are not authoritative balances. Desktop queue writes are accompanied by a local operation journal so long-outage work can be audited and exported without changing the final replay authority.

The main desktop queue is stored as durable JSON/JSONL files, not SQLite. The current processor has a promise-level guard against overlapping replay loops and uses dependency-aware item selection so dependent operations are not replayed before their parent operation is complete.

The local mesh shares allowed queued operations, room holds, conflict signals, and repair diagnostics between nearby lodge devices. It does not transfer full cache snapshots and must not be treated as a replacement for Supabase. Supabase RPC replay remains the point where financial, booking, inventory, customer-credit, event, and POS changes become final.

Current desktop offline queue coverage includes normal front-desk and lodge operations: bookings, booking status/payment updates, booking charges, quotation lifecycle and conversion, customer-credit receipt/allocation/refund/reversal, event and conference operations, rate overrides, day use, room/customer/housekeeping updates, expenses, maintenance tickets, inventory item/purchase/adjustment/stocktake work, POS orders/returns/tabs/tables/shifts, staff clock in/out with attendance-PIN proof, personal and shared-terminal cash-up submits, shared-drawer period opens, cash movements, handover and closing counts, drawer and cash-up reviews with operator/manager PIN proof, supplies, room-supply allocations/moves, and supply/room-supply stocktakes. Booking refund requests can be prepared offline as local pending-approval records with proof references and journal audit, but they are not replayed as refund approvals. Offline reviews are provisional until the server confirms them against authoritative totals; changing an outlet's cash-counting model stays online-only.

The Manager PWA has its own limited device-local queue stored in browser local storage and scoped per lodge. It blocks high-risk financial mutations such as booking payments and quotation conversion while offline. Its queue health is useful for that device, but it is not the desktop queue and not a financial source of truth.

Legacy POS has a separate queue and authenticated local mesh. Peer requests are signed and checked with timestamp/nonce/lodge identity controls. This mesh is local transport for eligible POS queue state; it does not replace server-side POS RPC validation or cash-up controls.

Accommodation multi-room bookings are not Events & Venues records. Direct bookings and room quotations can capture one lead guest and several selected room lines, then create one normal booking record per room with shared `[STAY_GROUP]` metadata and a group invoice wrapper in `booking_invoice_groups` / `booking_invoice_group_lines`. Each child booking keeps the standard room conflict checks, room status lifecycle, room-level profitability, payment ledger behavior, refund approval boundary, and offline replay contract, while the guest/company receives one customer-facing invoice. Group invoice collection and refund approval are entered once in the invoice UI and allocated across the child booking ledgers.

The public booking site uses lodge-configured offer flags from `settings` through `get_public_booking_offers`. Public guests can submit single-room, multi-room, and full-lodge accommodation requests through `create_online_booking`. Multi-room public requests create the same grouped accommodation invoice wrapper as desktop; full-lodge public requests create one exclusive booking so the existing exclusive-event overlap guard remains authoritative. Day-use and event/venue offers can be displayed publicly from lodge configuration, but they are contact/inquiry paths until dedicated public day-use/event booking RPCs are opened.

The intentional online-only set is narrow and server-verification-heavy: first-time login/session bootstrap, Command Central/admin work, imports and undo-imports, server-authoritative exports/reports/financial validation, license activation, fleet health, formal booking refund approval/final settlement with live manager PIN verification, and POS catalog publishing/setup changes that must create Legacy POS catalog snapshots.

## Financial truth

- `payments` and other ledgers represent deltas.
- Booking totals, paid amounts, balances, and statuses are database-derived.
- POS returns and voids must reverse the appropriate stock, payment, charge, and audit effects.
- Customer credit is a ledger, not a mutable balance field or synthetic booking.
- Reports must distinguish cash movement, revenue recognition, refunds, retained fees, customer credit, and unlinked POS sales.

## Authorization boundaries

- RLS and RPC validation enforce lodge isolation.
- POS writes enforce outlet and operator capability.
- PWA visibility or UI presence does not grant mutation authority.
- Service-role credentials stay server/admin-side and out of distributed clients.
- Public booking APIs must not trust client-calculated price, availability, or payment state.

## Deployment boundaries

The following can move independently:

- desktop installer;
- Legacy POS installer;
- Manager PWA deployment;
- public booking-site deployment;
- marketing site;
- Supabase migrations.

A feature is operational only when every required surface and migration has been deployed. Repository code alone is not proof of production state.
## Packaged Bar customer guides

The `hospitality-pos` Electron build takes the approved pair from `output/pdf/` and packages them as external resources at `resources/bar-guides/`, alongside `document-manifest.json`. The build configuration filters that resource set to the two Bar PDFs so repository documentation, screenshots and other product manuals are not shipped accidentally.

The customer path is:

```text
Bar shell (`HposLayout.jsx` -> `HposNav.jsx`) top-right profile menu -> Help & guides
  -> renderer requests bar-manual or bar-quick-start
  -> preload forwards the fixed document identifier
  -> main process validates the identifier against an allowlist
  -> main process resolves resources/bar-guides/<approved filename>
  -> shell.openPath opens the local PDF, or dialog.showSaveDialog + fs.copyFileSync saves it
```

The renderer never supplies an arbitrary filesystem path. Open and Save PDF are local operations: they do not require connectivity, change operational records or create business audit events. The manifest keeps app applicability, document revision, review date, filename and SHA-256 checksum distinct and is checked before release.

## Explicitly commissioned local Bar authority

The local-first Bar architecture is scoped to an explicitly commissioned `hospitality-pos` Bar profile. In that profile, a local PostgreSQL service is intended to authorize and atomically commit Bar operations; internet availability must never select or change authority, and local service failure must never fall back to Supabase. Modern desktop and Legacy POS clients must use the same local contracts while retaining their existing cloud-mode behavior. HotelOS, LodgingOS, Manager PWA, public booking, and other cloud profiles keep their current Supabase contracts. Local export status and bundle retrieval are authenticated and business/outlet/authority-epoch scoped; the current clients can download complete unsigned JSON bundles locally. Cloud upload is a separate server-only path (migration 0064 and `operations/cloudSync.ts`): the designated `single_host` service signs and posts already-committed batches and records receiver receipts, `received`/`validated` leave work pending, and only an `ingested` receipt advances the local acknowledgement. Transport defaults to `disabled`; `local_test` accepts loopback receivers only; `approved` refuses to run without separate hosted activation. No hosted receiver or ingestion function is deployed, no local trade has been sent to Supabase, and cloud reports must not imply they include un-ingested local trades. This architecture exception is not active for customer use until application integration, local setup/recovery, security, packaging, documentation and acceptance gates are independently verified.

### Bar local loyalty and export boundary (22 October 2026)

The local Bar service exposes authenticated business/outlet-scoped `loyalty.programs.list` and business-scoped `loyalty.account.get` reads. Modern and Legacy administration can create or version-update global/current-outlet loyalty programmes; customer operations panels display a timestamped current points balance but the atomic command revalidates eligibility when earning or redeeming. Local export status and unsigned bundle retrieval are also scoped to the active business, outlet, authority and epoch; browser download does not acknowledge or upload a batch. Migration 0043/0044 and the latest export migrations are local-only and have not been applied to hosted Supabase.

Export paging now selects complete commit sequences. The `limit` parameter caps groups, not event rows; all events associated with each selected sequence are included and locked into the same export batch. Cloud upload batching follows the same rule: `cloud_sync_take_batch` treats the batch limit as a target and always reserves whole commit groups, so one financial commit is never split across two uploads. Source/API fixture checks are in `npm run test:bar-local-contracts`; database execution is covered by the isolated service suite. Hosted ingestion remains inactive and no receiver is deployed.

### Bar cloud upload boundary (27 October 2026)

Local trade authority stays in the local PostgreSQL service. Cloud upload is an outbound projection of already-committed outbox rows, never a second business model:

- **Who uploads.** Only the designated `single_host` service process. Client-role processes return `not_primary`, and the renderer/preload bridge has no upload authority. A client can read status and trigger a pass through the authenticated admin route, but the service performs it.
- **One pass at a time.** `pg_try_advisory_lock('bar_local.cloud_sync.worker')`; a concurrent pass returns `busy` instead of interleaving batches.
- **Durable queue.** Batches and receipts live in `bar_local.export_batches` and `bar_local.cloud_sync_receipts`; run status, watermarks and `next_due_at` live in `bar_local.cloud_sync_state`. A crash leaves the batch `ready` with its attempt count, so the next pass retries the same batch.
- **Ordering and bounds.** Oldest unacknowledged batch first, bounded by `batch_limit` events (whole commit groups) and `BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES` per pass.
- **Signed, exact transport.** The body is the PostgreSQL canonical manifest text with signature fields merged in; JavaScript never re-encodes the manifest, so `12.50` cannot become `12.5`. HMAC-SHA256 covers `<key_id>.<batch_id>.<manifest_hash>`; the receiver recomputes the manifest hash from the received document.
- **Acknowledgement states.** `received` and `validated` are recorded as receipts but keep the batch pending; only `ingested` sets `status='acknowledged'`, `acknowledged_at` and the watermark. A hash mismatch or conflicting receipt is refused, never overwritten.
- **Scheduling.** Every 15 minutes (default) or once daily at a configured local time, plus "Sync now" and a non-blocking final pass after a committed cash-up. A restart resumes the committed `next_due_at` and otherwise waits for the configured schedule, so choosing "once daily" does not turn every service start into an upload. Cash-up never waits for, or depends on, the upload result.
- **Fail-closed transport.** `disabled` (default) starts no uploader; `local_test` permits loopback receivers only; `approved` is reserved and refuses to run until a separate hosted activation is authorised.
- **Honest status.** Pending/prepared/failed batch counts, acknowledged watermark, last check/success/failure, last final-sync state and the latest batch are read from the database, not inferred in the UI. A saved export file is explicitly not an upload or an acknowledgement.

The receiver contract in `services/bar-local/db/cloud-receiver/0001_cloud_ingest.sql` is a proposed, disposable-database-tested target only. It is not applied to hosted Supabase.

### Bar witness failover boundary (27 October 2026)

Manual switchover remains available, and it is not replaced. Witness-gated automatic failover adds a second, independent process that decides who may write:

```
primary service  --signed lease renew-->  witness (durable epoch + lease, own state file)
        |                                        ^
        | local authority_epoch must equal lease epoch
        v
local PostgreSQL (fence flag, authority epoch, sessions, audit)

standby service  --state/acquire-->  witness
        |  promotes only after: lease expired, replay LSN >= primary LSN,
        |  primary durability recorded synchronous, epoch granted = local + 1
        v
pg_promote() + service_failover_promote()  (epoch +1, revoke sessions, clear fence, audit)
```

- The write gate is checked in the service process before `POST /v1/commands` and `POST /v1/approvals`. It starts closed in `witness` mode, so a restart cannot serve before verification. `AUTHORITY_FENCED` maps to HTTP 503 and is not retryable.
- The database is the authoritative fence: `current_session` and `allocate_sequence` refuse while `failover_state.fenced` is set, independently of any UI or process state. There is no unfence function.
- Promotion is one-way and epoch-monotonic. A stale or partitioned host cannot rejoin by restarting; it is fenced and must be re-enrolled as a standby.
- The primary reports its durability (`synchronous` or `single_host`) with every lease message because a standby's own settings cannot prove how the primary acknowledged sales. A standby refuses to promote on `single_host` or unrecorded durability.
- `automatic_failover` is reported `verified` only from live lease evidence at the local authority epoch; it is `unavailable` otherwise. Nothing infers it from configuration.
- Client auto-repointing, witness installation/service lifecycle, physical multi-PC qualification and hosted anything are out of scope and remain release gates.

The witness reads no Bar database, backup or cloud-sync settings, and this path performs no hosted operation. See `docs/engineering/bar-local-first/FAILOVER_2026-10-27.md` for the safety argument, configuration and what remains unverified.

### 27 October 2026 local Bar checkpoint

Modern setup can recover after committed owner setup or pairing when subsequent status or automatic sign-in fails. Modern and Legacy return/void controls now require a fresh local readiness check before requesting approval. These changes do not introduce a default-local startup path or cloud ingestion. Unconfigured installations still take the cloud path. Cloud synchronisation exists as a disabled-by-default server-only uploader with durable local receipts; no hosted acceptance path is deployed, so local-to-Supabase trade transfer remains unavailable. See PROJECT_STATE.md and the dated coverage record for unresolved gates.

### 2 November 2026 local owner sales projection prototype

The existing Manager PWA can render a Bar Owner View against the separate `services/bar-local/src/ownerReceiver.ts` contract. Its projection account/session, link approval and read endpoints are independent of Supabase Auth and the local Bar owner PIN/password. The PWA receives only verified, owner-scoped sales projection DTOs; it must keep withholding accommodation-backed Bar pages and must never use stale hosted snapshots as fallback. Before upload, the local service verifies a signed nonce-bound proof for the exact authority/business/outlet. The receiver accepts signed, bounded batches, uses original request bytes for canonical hash validation and atomically ingests idempotently in its own database. Command Central's connection form is exposed only for loopback `local_test`; upload stays disabled until the owner approves and a local administrator separately enables it. This prototype covers sales totals/history/chart and receiver-watermark reads only. The process entrypoint and email-webhook contract are source-only: no receiver, provider, database or hosted endpoint is deployed, and no production link is active. Stock/cash-up/reports expansion, server hardening/release qualification and physical multi-PC acceptance remain open; local Bar commissioning stays NO-GO. See `docs/engineering/bar-local-first/OWNER_PROJECTION_IMPLEMENTATION_2026-11-02.md`.


3 November 2026 — local owner projection follow-up: committed cloud export envelopes now carry the authoritative operation business date, covered by the manifest signature/hash, so separate receiver reports can scope sales and stock/cash-up operations without assuming every event payload repeats its date. The Manager PWA can read these owner-approved projections, including stock movement history and submitted cash-up records. This receiver database contract remains separate from the Bar authority and is not deployed to Supabase; no hosted activation is implied. See EV-184 and docs/engineering/bar-local-first/OWNER_PROJECTION_IMPLEMENTATION_2026-11-02.md.
