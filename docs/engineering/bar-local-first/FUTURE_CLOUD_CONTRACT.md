# Future cloud ingestion contract — proposal only

Status: **UNDEPLOYED PROPOSAL. Hosted financial ingestion is disabled.** This document authorizes no Supabase schema change, write, transport, deployment or customer cutover.

## Required properties

- Accept signed/checksummed export batches from a commissioned local authority through an explicitly enabled future ingestion service. A local export is not a cloud acknowledgement.
- Preserve authority UUID/epoch, business/outlet/device, contract version, monotonic commit sequence, original operation ID, canonical payload hash, dependency references, event time/business date and source ledger/audit/outbox identifiers.
- Reject gaps, duplicate IDs with changed payload, invalid signatures, unknown authority/epoch, out-of-scope outlets, missing dependencies, sequence regression and batches from revoked/fenced writers.
- Make ingestion atomic and idempotent: the same batch and operation IDs return the original result; a changed payload conflicts. Persist per-event status and durable cursor only with the corresponding committed effects.
- Keep local `committed`, `exported`, `received`, `validated`, `ingested` and `rejected` states distinct. Partial receipt cannot advance the full cursor. Export never means posted or acknowledged.
- Reconcile domain-specific ledgers without replaying legacy cloud POS RPCs. Define treatment for sales, returns, voids, stock, cash, vouchers/customer liabilities, tips, tax, accounting, audit and corrections before implementation.
- Preserve reports' source scope, completeness watermark, last-ingested timestamp and explicit stale-local-data disclosure. PWA/cloud reports must not imply that they include trades not ingested.
- Define migration/backfill, duplicate/conflict resolution, operator review, privacy/retention, signing-key rotation, revocation and disaster recovery. Do not synthesize missing records or silently coerce ambiguous outcomes.

## Preconditions

Separate architecture/security review, approved SQL/RPC contracts, isolated database tests, authenticated scope tests, threat review, policy sign-off and explicit deployment authorization. Until those gates pass, no transport from local export to hosted Supabase is permitted.

## Status update - 27 October 2026

The local service now has an outbound uploader (`services/bar-local/src/operations/cloudSync.ts` plus migration `0064_cloud_sync.sql`) and a proposed receiver contract (`db/cloud-receiver/0001_cloud_ingest.sql`). They were exercised only against disposable loopback PostgreSQL targets.

- Transport is `disabled` by default. `local_test` accepts loopback receivers only. The reserved `approved` mode refuses to run with `CLOUD_SYNC_TRANSPORT_NOT_AUTHORISED`.
- No hosted receiver, hosted migration, service identity or ingestion function is deployed. Nothing in this change permits a hosted transport, so the precondition above still applies in full.
- Sequence interpretation was refined during implementation: a missing sequence normally means that commit had not committed yet when a later one did. The receiver records such a batch as a late sequence rather than treating it as a gap or duplicate. Genuine conflicts (same batch or event identity with changed content) are refused.
- See `CLOUD_SYNC_2026-10-27.md` for the requirement coverage and evidence, and treat that document as the current implementation record where it differs from this proposal.
