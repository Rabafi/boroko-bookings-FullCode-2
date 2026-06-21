# Boroko Bookings Project State

As of: 2026-06-21

This is the dated orientation document for humans and AI agents. It is intentionally separate from the durable rules in [AGENTS.md](AGENTS.md).

## Released baseline

- Desktop package version: `1.5.3`.
- Legacy POS package version: `1.1.0`.
- Manager PWA and public booking site are independently built and deployed web surfaces.
- The desktop app uses `database.js` as a compatibility facade; business logic is split across `src/main/domains/`.
- Legacy POS is a separate Electron 22/Windows POSReady 7-compatible deliverable with its own updater, release scripts, cache, queue, mesh behavior, and database probe.

## Implemented architecture and safeguards

The repository currently contains:

- RPC-first booking payment handling and database-derived payment status.
- A customer-credit ledger for advance payments that do not reserve rooms, with receipt, allocation, refund, reversal, audit, and liability reporting.
- Atomic booking rescheduling with room/date conflict checks, exclusive-event protection, authoritative repricing, reason capture, and overpayment transfer to customer credit.
- A desktop **Front Desk -> Prepayments** workspace for receiving advance payments, viewing balances and history, applying credit to bookings, refunding/reversing entries, and printing advance-payment receipts.
- Read-only Manager PWA visibility for outstanding customer-credit liability.
- Human-readable advance-payment receipt numbers (`PRE-YYYY-NNNN`) and dedicated A4 PDF rendering.
- Stable offline operation IDs and idempotency protection for critical financial and inventory work.
- `financial_operation_idempotency` and `financial_audit_log` infrastructure.
- Atomic POS v3 order/return flows, inventory depletion/restoration, outlet enforcement, shift and cash-up contracts.
- Booking-linked POS charge support where the order has authoritative booking/folio linkage.
- Atomic room-maintenance reconciliation.
- Event/full-lodge quotation support.
- Manager PWA POS reporting, support inbox/read receipts, operational caching, and guarded operational mutations.
- Main desktop and Legacy POS mesh/offline synchronization support.
- Command Central audit, fleet-health, notification, entitlement, and release-control capabilities.

The customer-credit and booking-reschedule migrations were confirmed applied to the linked Supabase project on 2026-06-20. Repository implementation and database deployment do not by themselves prove that every client surface has been published or operator-smoke-tested.

## Current uncommitted work

The worktree on 2026-06-21 contains substantial in-progress changes. Do not assume these are released or deployed:

- completed customer-credit and booking-reschedule implementation awaiting intentional commit/release publication;
- detailed report export RPCs and desktop report export work;
- guest lifetime intelligence and Manager PWA guest/reporting work;
- Manager PWA navigation, inbox, notification, freshness, and UX changes;
- Legacy POS shift/outlet/cash-up enforcement and mesh/runtime changes;
- related focused regression tests;
- Events & Venues planning material;
- missing RLS policies on `room_rate_overrides` table fixed via `20260621180000_add_room_rate_overrides_rls_policies.sql` migration (applied);
- `room_booking_expected_total` function updated to consult rate overrides via `20260621190000_add_rate_overrides_to_expected_total.sql` migration (applied) — previously the `create_booking` RPC rejected override-based totals;
- `Rooms.jsx`: error display added inside rate override form (was hidden inside room CRUD modal);
- `Rooms.jsx`: success message after saving rate override (was missing entirely).

Before continuing any of these areas, inspect `git status`, the relevant diff, and the latest migration files. Preserve unrelated edits.

## Superseded old priorities

The former top-level priorities—deposit linkage, basic booking replay, first-generation idempotency, initial POS-to-booking linkage, and adding a financial audit table—are no longer accurate as unimplemented project-wide tasks.

They remain regression-sensitive contracts. New work must verify and preserve them rather than reimplement them from an old plan.

## Known caveats

- Customer-credit/reschedule repair migrations through `20260621170000` are applied to the linked project, including receipt numbering, safe transfer keys, local-date check-in, and event parent-ID protection.
- The customer-credit/reschedule feature is release-candidate quality, not yet production-certified: packaged-installer smoke tests, disconnected replay testing, database concurrency/isolation smoke tests, Supabase lint/advisors, artifact signing, and final publication remain.
- Desktop 1.5.3 is the active local release candidate; a successful local build does not mean it has been published.
- Historical POS orders with `outlet_id = NULL` may appear as `Unassigned`; do not invent outlet attribution without evidence.
- Some regression suites are structural contract tests. Passing them does not replace database smoke tests for high-risk SQL.
- The working tree can contain multiple concurrent initiatives. Do not stage, revert, format, or rewrite unrelated files.
- A PWA empty result may indicate session/readiness or schema-contract failure rather than genuinely absent data.
- `room_rate_overrides` has RLS enabled but had zero policies; the `20260621180000` migration adds them. Until applied, SELECT queries via the Supabase client (Dashboard specials, booking form discounts, Rooms override list) silently return empty results while SECURITY DEFINER RPCs (create/update/delete) work normally.

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
