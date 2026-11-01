# Bar local authority cutover and recovery runbook

Date: 2026-10-20. **Design/review aid only; not approved for customer use. No cutover was performed.**

## Current decision

Do not commission a business or cut over a till based on this runbook. Modern and Legacy have local authority paths for selected workflows, but full customer commissioning is not qualified. The cloud-to-local importer/rehearsal and server-enforced old-writer fencing are absent; installed lifecycle, supported coordinator, replacement-host restore and customer qualification also remain open. This runbook documents stop conditions; it does not claim that cutover/recovery tooling exists or authorize its use.

## Target requested — Botswapelo Lounge (28 October 2026)

The user selected Botswapelo Lounge as the target for a future local Bar authority. This is a target selection, not approval to start local trading. No current Lounge data export, queue inventory, source control totals, local target database, operator/device list or signed cutover boundary was available in this workspace. The configured Supabase project reference did not match the project's documented reference; its secret values were not read or used. No Supabase CLI is installed. The isolated PostgreSQL database used by development tests is disposable test data and must never be treated as the Lounge database.

Command Central does not provide a delete-and-recreate or local-Bar commissioning workflow. The Hospitality POS application has a separate “Bar: set up or join a local server” workspace choice and first-owner form, but it is offered only when no cloud business is saved on that computer. If the current Lounge cloud business is saved there, the application deliberately blocks creation of an empty local replacement until a verified migration and cloud-writer fence exist. Do not delete the hosted account to get around this guard: deleting it is unnecessary for an empty local test Bar and would destroy the source needed for any later comparison. The UI form also requires the local PostgreSQL service to have been installed and started first; first-owner commissioning creates a new local business/outlet identity and imports no cloud records. Even an empty test Bar remains subject to the qualification stop conditions below before live trading.

The local service now has an offline envelope verifier at `services/bar-local/scripts/dry-run-transition-import.mjs`, documented in `TRANSITION_EXPORT_V1.md`. It checks only the synthetic export envelope, declared collection counts, exact decimal measures, row identity and declared business/outlet scope, then produces a canonical source hash and refusal/receipt output. It performs no database contact and no import. It is not the required source-specific financial/lineage importer and must not be used with customer exports or to authorize cutover. Before any data can be imported, a versioned read-only source snapshot still needs proof of complete query paging, source lineage, balanced financial/stock/liability controls and stable unresolved-operation custody. Exercise the future importer against a disposable target, and block on any missing or conflicting item. Before a future authority switch, positively isolate existing cloud writers/background jobs for this outlet and confirm every old queue/device cannot resume cloud writes. No historical transaction may be replayed as a new sale or produce a second posting/outbox event.

The exact customer source export and supported active operator/device scope are still needed to create a target-specific rehearsal. A verified, tenant-scoped read-only connection or an approved export is required before examining source data. Do not point an app profile at the disposable test cluster, copy guessed balances, disable cloud access ad hoc, or let one till trade locally while other writers remain active. Hosted and Lounge data have not been accessed or changed by this preparation.

### Minimum read-only rehearsal package

Provide the export through an approved encrypted channel and keep credentials out of the package. Include the exact business/outlet identifiers and source snapshot boundary; complete catalogue and menu configuration; current inventory balances and valuation with lot provenance where available; nonzero voucher, customer-credit, loyalty, supplier/AP and accounting balances; open shifts, drawers and tabs; supported report/correction history; and a per-device inventory of queued, failed, uncertain and last-acknowledged operations. Include row counts and canonical file hashes for each extract, plus authoritative source totals for cash, card/other tenders, stock and open liabilities. Mark unavailable domains explicitly; a missing extract is not an empty extract.

Do not export password/PIN verifiers as active local identities. Do not convert cached/offline operations into sales. Every uncertain or failed operation needs its stable ID and exact original outcome evidence; an unresolved financial outcome blocks the rehearsal. If the source has only aggregate stock while the local feature expects lot balances, record the limitation and keep lot-dependent workflows unavailable until reconciled.

## Topology limits

- One modern office PC plus any number of Windows 7 Legacy tills has one eligible database host. If that host is unavailable, stop financial finalisation. Windows 7 is a client, not a replica or voter.
- Two modern hosts require a separately supported witness/coordinator or a controlled manual procedure with positive isolation of the old primary and proof that every acknowledged receipt is preserved. A lone survivor must not self-promote.
- Three modern hosts are only eligible for automatic failover after a supported, packaged coordinator, synchronous durability, quorum, acknowledged-prefix eligibility and enforceable fencing are installed and tested.
- Device count is variable. Two- and six-device capacity and failure behavior remain unqualified.

## Stop and preserve

1. Stop accepting new financial actions if the configured authority is unavailable or its identity/epoch is uncertain. Do not switch to Supabase, another local database, or a cached balance.
2. Preserve the original operation identifier, exact payload, shift/business date, device and last known outcome. Do not resubmit with a new key.
3. Keep tills and queues intact. Record device, authority, epoch, app/runtime version, time, network state and any receipt/print response.
4. Printing is post-commit. Recover the original committed receipt and explicitly reprint; never resubmit the sale because printing failed.
5. Do not restore an older database over current data or permit a former primary to reconnect as writer.

## Replacement or restore — future gated procedure

No executable supported procedure is available yet. Before such a procedure can be approved, implementation must: positively isolate the old writer; verify the backup/WAL chain and encryption keys; restore to a staging instance without internet; reconcile operation receipts, ledgers, audit, outbox, auth and catalogue; prove the acknowledged prefix; enroll a fresh identity/epoch; and retain the source for forensic review. Record measured data-loss and recovery time. If any proof is missing, stop and escalate; do not permit financial writes.

## Hosted coexistence

No hosted migration or write fence is included. Existing cloud clients may remain able to write to Supabase. Therefore a local flag does not prevent an old cloud writer from creating divergent transactions. Any future customer cutover requires a separately reviewed and authorized controlled handover, reconciled cloud queues, explicit handling of uncertain operations and verified old-writer isolation. Hosted financial ingestion remains disabled.
