# Starter Backup and Command Central Recovery Roadmap

Status: Stages 1 and 3 are implemented in source and their ordered database
migrations are applied to the linked project through `20260827020000`. Linked
migration parity, an empty post-deploy dry run, error-level SQL lint, and
security advisors are clean. No installer or authenticated disposable-lodge
smoke exists, so recovery and automation are not yet released or customer-ready.
Stage 2 live-lodge replacement remains blocked.

## Current boundary (honest status)

- The customer-owned `.tbbackup` package contains the Starter core-data set only: property settings, rooms, guest/customer records, bookings, quotations, the signed payment ledger, and maintenance tickets.
- It intentionally excludes uploaded documents/images, invoices and expenses, inventory and supplies, POS sales and cash-up, conference/day-use/event records, staff accounts and credentials, audit logs, sync queues/local cache state, and managed-backup policy/files.
- The package is encrypted when a passphrase is supplied, is written atomically, and can be verified. The passphrase is not stored in the package.
- Recovery is support-led and disposable-lodge-only. Local validation remains a non-mutating, non-PII rehearsal. The implemented Command Central path requires a separate authoritative server execute and verification result before it reports success; its database contract is deployed, but authenticated operator/isolation smoke remains open.
- A package may contain up to 256 MiB and 100,000 rows per table, but the current authoritative one-RPC restore payload is capped at 8 MiB. Larger valid packages can be saved and verified but require the planned chunked transport before Command Central can restore them.
- Command Central's existing “Restore company” action restores an archived company lifecycle state. It is not a `.tbbackup` importer and must not be described as one.
- Weekly encrypted Starter automation is implemented locally as a separate customer-owned path. It is not managed backup, has not been released, and its presence in source is not production evidence.

No customer-facing live restore, database overwrite, or automatic Starter backup should be enabled until the gates below are complete.

## Workstream A — Command Central support-only recovery workspace

Build a privileged, support-only workspace for `.tbbackup` recovery. The first release should restore into a newly provisioned disposable recovery lodge/project; a live-lodge restore is a later, separately approved capability.

Required controls:

- Require authenticated Command Central support capability, an explicit lodge scope, a stable operation ID, and a mandatory reason/ticket reference. Enforce these server-side; do not rely on hidden UI controls.
- Accept only `.tbbackup` packages. Validate package format/schema/version, encryption and passphrase, checksums/fingerprint, manifest/data agreement, lodge identity, row ceilings, completeness warnings, protected-field absence, and supported application/database compatibility before any mutation.
- Show a read-only preview before restore: source package fingerprint, created time, lodge identity, included/excluded categories, record counts, completeness warnings, target, and the exact consequence (new recovery environment or controlled replacement). A failed or incomplete validation must stop closed.
- Take an independent pre-restore safety snapshot and record its fingerprint. Never overwrite the only known-good package or the live database without an approved rollback point.
- Use an authoritative server-side, atomic restore contract. Validate foreign keys and business invariants, preserve signed payment-ledger semantics, and make retries idempotent. Never perform client-side read/modify/write imports or direct renderer database writes.
- Define conflict and identity policy before implementation: empty-target restore is the default; any live-lodge replacement or merge requires an explicit mode, deterministic conflict rules, transaction rollback, and a second approval.
- Record immutable audit evidence for request, validation, preview approval, restore start/end, target, actor, package fingerprint, pre-restore snapshot, counts, reconciliation result, and failures. Do not put passphrases, tokens, or connection secrets in logs.
- Run post-restore checks for row counts/fingerprints, lodge isolation, booking/customer/room references, ledger totals and payment status derivation, settings, and application health. Produce an exportable support report and an actionable rollback/retry state.

## Workstream B — Weekly encrypted Starter backup automation

Add an opt-in, customer-owned scheduler for eligible Lodge/Hotel Starter accounts. It should reduce missed backups without interrupting operations or pretending that a local package is a managed full-data backup.

Proposed contract:

- During setup, a manager selects a destination folder and creates/confirms a passphrase. Store the automation secret only through OS secure credential storage (Windows Credential Manager/DPAPI or the platform equivalent), accessible from the protected main process; never persist it in renderer state, ordinary JSON, the `.tbbackup` file, logs, or the sync queue.
- Run at most once per seven-day window and also evaluate due state at startup/reconnect. Create a versioned `.tbbackup` with an atomic temp-file/rename flow, then immediately reopen and verify its encryption, checksum, lodge identity, and completeness before marking it successful.
- Keep multiple verified versions in the selected destination. Initial policy should retain the latest verified copy plus a bounded weekly history (the exact count/age must be approved before implementation); never remove the only verified copy, and do not silently replace a file with an unverified result.
- Show the last successful time, destination label, fingerprint, verification result, next due time, and failure reason. A missing destination, unavailable credential, incomplete/offline read, or failed verification must remain visibly actionable and retryable.
- When due or failed, show a persistent manager-level warning with a short, bounded snooze. Do not block bookings, check-ins, check-outs, payments, POS, or other operational work because a backup is overdue. A backup warning is not authorization to use an unverified package for recovery.
- Keep the current Starter scope and exclusions visible in setup and status. Offline-created data must be labelled incomplete/local and must not be certified as a complete server backup.

## Product differentiation

Starter automation is a narrow, customer-owned, encrypted core-data safeguard. It does not include live self-service restore, POS/inventory/expense/document data, support-managed retention, or the broader managed backup controls.

Pro/managed backup remains the separate broader-data, centrally governed product path with its own entitlements, schedule, destination/retention policy, support ownership, and restore runbook. Do not reuse the Starter entitlement to expose managed backup files, do not merge the two histories, and do not market Starter's weekly copies as equivalent to Pro. Any later tier change must preserve the package's recorded scope and the applicable recovery contract.

## Future workstream C — Complete business backup

Every authoritative customer record must ultimately have a documented backup
and recovery path. “Complete” means enough data to reconstruct the lodge's
business truth, not every byte from an application device. Until this scope is
implemented and restore-tested, the seven-category `.tbbackup` must continue to
be labelled **Core Data Backup** rather than a complete or full-system backup.

The complete scope should cover property configuration, rooms/campsites and
rate dimensions, customers, bookings and accommodation details, quotations,
payments/refunds/customer credit, maintenance/assets, conferences/events/day
use, POS orders/returns/cash-ups, inventory movements and suppliers,
expenses/invoices/accounting records, non-secret staff memberships/roles, and
the audit evidence required to reconcile those records. Uploaded documents,
photos, signed invoices, and attachments should use a separately encrypted
object archive tied to the database package by a versioned manifest and
checksums. Immutable audit history should be archived and reviewable, but must
not be blindly replayed as operational mutations.

Never include passwords, passphrases, session tokens, API/service keys,
encryption private keys, OS secure-store values, temporary files, derived
indexes/reports, or rebuildable caches. Pending offline operations require a
separate encrypted and idempotency-aware recovery design because they may be
the only copy of unsubmitted business work; they must never be replayed without
server reconciliation.

Implement complete backup incrementally and only in lockstep with recovery.
First replace the current 8 MiB one-RPC restore limit with authenticated,
hash-verified chunked staging. Then add each data domain with schema/version
validation, atomic restore ordering, stable retry identity, lodge isolation,
row/count/hash reconciliation, financial-ledger and stock-balance checks,
attachment checksum verification, and disposable restore rehearsal. Starter
should retain a customer-owned complete export path; Pro differentiation should
come from managed off-device automation, monitoring, retention, attachment
custody, recovery support, and tested recovery objectives rather than withholding
customer-owned data.

## Staged acceptance and deployment gates

### Stage 0 — Contract and threat model

- Approve the recovery target model, supported schema/application versions, conflict policy, retention default, OS credential-storage adapter, support roles, and audit fields.
- Add focused contract tests for package scope, exclusion/redaction, passphrase handling, identity, checksums, row ceilings, and the explicit `live_restore_available: false` boundary.
- Document the data classes that remain outside Starter and the separate Pro/managed path.

### Stage 1 — Support validation and disposable restore

- Implement the support-only file/passphrase intake and read-only preview.
- Validate wrong passphrase, tampering, truncation, unsupported version, lodge mismatch, incomplete package, duplicate IDs, missing references, protected fields, and over-limit packages.
- Restore only to an isolated disposable recovery lodge/project. Prove authorization, lodge isolation, atomic rollback, stable-key retry behavior, audit evidence, post-restore validation, and financial-ledger reconciliation.
- Require a support report and a second-person sign-off before any claim of recovery readiness. A rehearsal that only validates in memory is not a restore proof.

### Stage 2 — Controlled live-lodge recovery (separate approval)

- Do not start until Stage 1 passes and the authoritative database contract/migrations are deployed and verified.
- Add a separately gated replacement flow with fresh safety snapshot, explicit outage/change window, two-person approval, deterministic conflict rules, rollback rehearsal, idempotent retry, and authenticated two-lodge isolation smoke.
- Reconcile bookings, signed ledger entries, balances/status derivation, and operational references before reopening the lodge. Publish the support report and preserve the pre-restore snapshot.

### Stage 3 — Starter automation

- Test first-run setup, OS credential retrieval failure, locked workstation/restart, startup/reconnect scheduling, due/overdue transitions, destination disappearance, permission/full-disk errors, offline/partial reads, atomic interruption, duplicate scheduler invocation, verification failure, retention cleanup, and recovery after correction.
- Confirm encrypted output cannot be opened without the passphrase, no secret reaches renderer/logs/queues, fingerprints and status survive restart, and the latest verified copy is never lost.
- Run a manual operator test covering save, automatic verification, second-copy retention, warning/snooze, and continued booking/payment operation while overdue.

### Stage 4 — Release and production gates

- Run the focused recovery/backup tests, affected desktop/Command Central tests, production guardrails, full required regression suites, and affected product builds.
- For any database/RPC change, apply the ordered migration to the intended environment, require local/remote migration parity, zero affected linked SQL lint/advisor errors, and authenticated support/lodge-isolation smoke. Repository code alone is not deployment evidence.
- Test from the packaged signed installer, including fresh install, upgrade with existing customer state, restart, credential access, destination permissions, and recovery report handling.
- Record each surface in `docs/DEPLOYMENT_EVIDENCE_MATRIX.md`. Do not announce live recovery or automated Starter backups until the required database, desktop, installer, support, and operator evidence is complete.

## Ownership and follow-up

The next slice is runtime and release evidence for Stages 1 and 3: authenticated
Command Central actor/capability and two-lodge isolation smoke, a chunked
transport for valid recovery payloads above 8 MiB, scheduler restart/credential/
destination smoke, and packaged signed-installer verification. Stage 2 remains
blocked until those gates and the support restore report receive sign-off.
