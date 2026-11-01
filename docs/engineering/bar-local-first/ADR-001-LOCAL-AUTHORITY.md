# ADR-001: Local Bar authority uses a dedicated PostgreSQL service

- Status: accepted for implementation; production activation is not approved.
- Date: 2026-10-20.
- Scope: `hospitality-pos` in Bar mode only.

## Context

The current desktop Bar path is renderer -> preload/IPC -> `database.js` -> Supabase RPCs, with a JSON/JSONL offline queue. That model cannot finalise Bar sales, tabs, cash-up or stock locally when the internet is unavailable, and cannot provide authoritative receipt identity after an ambiguous submission. The approved technical plan requires a local authority that still preserves financial truth under concurrency, retries and partial failure.

## Decision

1. Use one dedicated PostgreSQL database and one local service for every commissioned Bar authority, from a single till to multiple tills.
2. Route all Bar financial/stock mutations through authoritative local PostgreSQL functions. Clients never write ledger tables and never choose SQL function names.
3. Keep Supabase authoritative for HotelOS, LodgingOS, the public booking site and the Manager PWA. Do not add local-Bar schema to `supabase/migrations/`, do not write to hosted Supabase in this pass, and keep hosted financial ingestion disabled.
4. Modern tills use a durable SQLite intent journal; Legacy POS uses a compatible append-only JSON/JSONL journal. Neither is an independent financial ledger.
5. A commissioned `bar_local` authority never falls back to cloud mode because the internet is available. A local outage stops finalisation; clients retain drafts and uncertain submissions.
6. Use one atomic operation receipt per stable operation ID. The same key and payload returns the original receipt; a changed payload conflicts; a timeout never creates a new key.
7. Use PostgreSQL synchronous commit and transaction-local commit sequence allocation. A committed local result is returned only after the database transaction commits.
8. Keep cloud export explicit and one-way: local outbox -> signed bundle -> future reviewed ingestion. Export is not acknowledgement. No production uploader exists in this pass.
9. Protect the service with device-scoped credentials and pinned TLS. PostgreSQL and service secrets never reach renderers or clients.

## Consequences

- The product must ship and support a local PostgreSQL runtime, service lifecycle, backup/restore and host recovery. These are operational obligations, not optional extras.
- Every existing Bar route, background job and add-on must be inventoried, then mapped to a local contract or an explicit external/unavailable boundary. A UI-only route is not sufficient.
- Modern and Legacy clients need authority routing, durable intent stores and recovery UX. Legacy remains a thin client and does not host PostgreSQL.
- Local reports are authoritative for local trading; cloud reports and the Manager PWA will not contain new local trades until a separately approved ingestion contract exists.
- Automatic failover, replication and durability profiles require a supported coordinator and actual hardware qualification. This ADR does not claim them.

## Rejected alternatives

- SQLite per till as the financial ledger: cannot safely coordinate multiple tills or provide one receipt authority.
- Each till as an independent authority: would require conflict resolution for money, stock, credit and vouchers.
- Running the full Supabase stack locally: unnecessary operational weight and a different trust boundary.
- Mesh as database replication or leader election: mesh is an operation transport, not a transactional authority.
- Reusing old cloud sale RPCs for local replay: they do not import completed local facts safely and would risk double effects.

## Mandatory invariants

- One logical authority identity per commissioned Bar; authority epoch changes are audited.
- Actor, device, business, outlet, capability and entitlement scope are enforced server-side.
- Stock, tender, credit, voucher, cash-up, accounting and receipt effects commit atomically with the operation receipt and audit.
- Expected business refusals leave no partial domain effects; ambiguous transport outcomes are resolved by the original operation ID.
- Backup/restore, failover and replacement do not create a second writable authority.
- No customer cutover, release publication or hosted migration is authorised by implementation progress.

## References

- `TECHNICAL_PLAN.md`
- `FEATURE_CONTRACT_MATRIX.csv`
- `ACCEPTANCE_MANIFEST.csv`
- `AGENTS.md`
