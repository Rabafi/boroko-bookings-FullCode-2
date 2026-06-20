# Boroko Bookings Project State

As of: 2026-06-20

This is the dated orientation document for humans and AI agents. It is intentionally separate from the durable rules in [AGENTS.md](AGENTS.md).

## Released baseline

- Desktop package version: `1.5.2`.
- Legacy POS package version: `1.1.0`.
- Manager PWA and public booking site are independently built and deployed web surfaces.
- The desktop app uses `database.js` as a compatibility facade; business logic is split across `src/main/domains/`.
- Legacy POS is a separate Electron 22/Windows POSReady 7-compatible deliverable with its own updater, release scripts, cache, queue, mesh behavior, and database probe.

## Implemented architecture and safeguards

The repository currently contains:

- RPC-first booking payment handling and database-derived payment status.
- Stable offline operation IDs and idempotency protection for critical financial and inventory work.
- `financial_operation_idempotency` and `financial_audit_log` infrastructure.
- Atomic POS v3 order/return flows, inventory depletion/restoration, outlet enforcement, shift and cash-up contracts.
- Booking-linked POS charge support where the order has authoritative booking/folio linkage.
- Atomic room-maintenance reconciliation.
- Event/full-lodge quotation support.
- Manager PWA POS reporting, support inbox/read receipts, operational caching, and guarded operational mutations.
- Main desktop and Legacy POS mesh/offline synchronization support.
- Command Central audit, fleet-health, notification, entitlement, and release-control capabilities.

These statements describe repository implementation. Production availability still depends on the relevant migration and application release being deployed.

## Current uncommitted work

The worktree on 2026-06-20 contains substantial in-progress changes. Do not assume these are released or deployed:

- customer-credit ledger and booking-reschedule RPCs plus desktop integration;
- detailed report export RPCs and desktop report export work;
- guest lifetime intelligence and Manager PWA guest/reporting work;
- Manager PWA navigation, inbox, notification, freshness, and UX changes;
- Legacy POS shift/outlet/cash-up enforcement and mesh/runtime changes;
- related focused regression tests;
- Events & Venues planning material.

Before continuing any of these areas, inspect `git status`, the relevant diff, and the latest migration files. Preserve unrelated edits.

## Superseded old priorities

The former top-level priorities—deposit linkage, basic booking replay, first-generation idempotency, initial POS-to-booking linkage, and adding a financial audit table—are no longer accurate as unimplemented project-wide tasks.

They remain regression-sensitive contracts. New work must verify and preserve them rather than reimplement them from an old plan.

## Known caveats

- Migration presence does not prove that the linked production project has applied it.
- Historical POS orders with `outlet_id = NULL` may appear as `Unassigned`; do not invent outlet attribution without evidence.
- Some regression suites are structural contract tests. Passing them does not replace database smoke tests for high-risk SQL.
- The working tree can contain multiple concurrent initiatives. Do not stage, revert, format, or rewrite unrelated files.
- A PWA empty result may indicate session/readiness or schema-contract failure rather than genuinely absent data.

## Where to look

- Durable engineering rules: [AGENTS.md](AGENTS.md)
- Architecture and execution paths: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Release checks: [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md)
- Database migrations: `supabase/migrations/`
- Desktop business domains: `src/main/domains/`
- Manager PWA API contract: `manager-pwa/src/lib/api.js`
- Legacy POS main process and queue: `legacy-pos/src/main/`
- Focused regression suites: `tests/` and `legacy-pos/tests/`

## Updating this file

Update this document when:

- a major feature is completed or removed;
- an execution path or application surface changes;
- a migration is confirmed deployed;
- release versions change;
- a known critical risk becomes verified, fixed, or superseded.

Use exact dates and distinguish repository implementation, uncommitted work, released binaries, and confirmed production deployment.

