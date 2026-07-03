# Boroko Bookings Project State

As of: 2026-07-03

This is the dated orientation document for humans and AI agents. It is intentionally separate from the durable rules in [AGENTS.md](AGENTS.md).

## Released baseline

- Desktop package manifest version: `1.5.5`. Publication of this exact version is not proven by the repository alone.
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
- Main desktop long-outage hardening: queued desktop operations now have an append-only local operation journal, manager-acknowledged lodge offline mode, offline operations bundle export, mesh repair visibility, and mesh coverage for every desktop offline RPC operation while preserving Supabase RPC replay as final authority.
- Main desktop normal operations now have broader offline queue coverage in the repository: booking charges, customer-credit allocation/refund/reversal, rate overrides, expenses, maintenance updates/resolution, inventory purchases/item edits/deletes/stocktakes, event line items, supply purchases/item edits/deletes, room-supply allocations/moves, and supply/room-supply stocktakes. Local values remain pending estimates until replay succeeds.
- Main desktop sync queue storage is file-backed JSON/JSONL under the app cache/user-data path (`sync-queue.json`, failed queue JSON, and `offline-operation-log.jsonl`), not a SQLite queue. The queue processor uses a promise-level processing guard and dependency-aware replay ordering.
- Manager PWA offline state is device-local `localStorage`, scoped per lodge, with blocked high-risk mutation types and a three-attempt unresolved/dead-letter threshold. It is not IndexedDB and is not a global financial authority.
- Legacy POS mesh uses signed local HTTP requests with HMAC-SHA256, timestamps, nonces, lodge identity checks, and a bounded mesh port range. It is authenticated local transport, not anonymous raw LAN message acceptance.
- Booking refund preparation now supports offline pending-approval requests with proof references, retained-fee calculations, local cache visibility, and operation-journal audit. The actual refund/customer-credit settlement still requires online manager PIN verification and the authoritative `approve_booking_refund` RPC.
- Accommodation multi-room booking is implemented as one lead guest stay group with multiple normal room booking records plus a first-class group invoice wrapper (`booking_invoice_groups` / lines). Direct bookings and room quotations can both produce this grouped accommodation invoice. It uses `[STAY_GROUP]` metadata, not Events & Venues event grouping, so each room line keeps normal room availability, status, payment, refund, profitability, and offline replay behavior while the guest/company sees one invoice. Group invoice payments and approved refunds are entered once by the operator and allocated across the child room booking ledgers.
- Public booking-site accommodation requests can now use lodge-specific public offer settings. Lodges can advertise room stays, multi-room stays, full-lodge stays, day-use options, and event/venue options on their slug. The public booking RPC supports single-room, multi-room, and full-lodge accommodation requests; multi-room requests create the same group invoice wrapper as desktop direct bookings, while full-lodge requests create one exclusive booking to preserve exclusive-event conflict rules. Day-use and event/venue offers are exposed as public information/contact paths until their pricing, payment, and approval rules are opened through dedicated public RPCs.
- Command Central audit, fleet-health, notification, entitlement, and release-control capabilities.

The customer-credit and booking-reschedule migrations were confirmed applied to the linked Supabase project on 2026-06-20. Repository implementation and database deployment do not by themselves prove that every client surface has been published or operator-smoke-tested.

## Current workspace and recent verification

The worktree on 2026-07-03 was not pristine before this documentation update. Preserve unrelated changes:

- modified `src/main/domains/settings.js`;
- modified `src/renderer/src/components/Settings.jsx`;
- modified `booking-site/src/pages/LodgePage.jsx`;
- modified `booking-site/src/pages/BookingPage.jsx`;
- modified `booking-site/src/pages/SuccessPage.jsx`;
- modified `tests/customer-credit-reschedule-regression.test.mjs`;
- untracked `supabase/migrations/20260703153000_public_booking_offers.sql`.

Older in-progress areas that were previously called out have since been partly or fully absorbed into repository code. Do not assume they are published or deployed just because they are present locally:

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
- 2026-06-25: Guests gained customer-credit balance visibility plus shortcuts into Prepayments; cancelled booking refunds can now be transferred to customer credit through `20260625120000_booking_refund_to_customer_credit.sql` (applied to the linked Supabase project and live function definition verified).
- 2026-06-26: Events & Venues venue-only creation was repaired via `20260626120000_harden_event_booking_parent_id.sql` and `20260626123000_fix_event_booking_id_after_idempotency_miss.sql` (applied to the linked Supabase project and rollback-only live smoke verified). Root cause: the `create_event_booking` idempotency miss path cleared `v_event_id` before inserting `conference_bookings`.
- 2026-07-03: Main desktop offline/mesh hardening implemented in the repository. This adds a local operation journal, System Health offline-mode controls, daily offline operations bundle export, mesh repair diagnostics, and mesh allowlist/schema coverage for all desktop queued RPCs, including reschedules, customer credit, booking charges, rate overrides, expenses, maintenance, inventory stocktakes/purchases, event line items, and room-supply workflows. This does not make the local mesh a final database authority; cloud replay and server-side RPC validation remain required before values are final.
- 2026-07-03: Accommodation room quotations gained `accommodation_lines` storage so one quote can cover several rooms and convert into the same grouped accommodation invoice model used by direct multi-room bookings. The linked Supabase migration `20260703143000_quotation_accommodation_lines.sql` was applied.
- 2026-07-03: Public online booking gained lodge-configured public offer settings and live migration `20260703153000_public_booking_offers.sql` was applied. The booking site now reads `get_public_booking_offers`, lets guests select multiple available rooms, can request full-lodge exclusive use when enabled, and submits supported accommodation requests through the hardened `create_online_booking` RPC.
- 2026-07-03: External Kimi/agent offline-sync reports were verified against the current repository. The severe claims in `agent 1.txt` through `Agent 7.txt` were mostly false for this checkout: the code does not use SQLite sync queues, does have server-side idempotency infrastructure for key financial/offline paths, does not have the claimed direct booking-payment fallback that writes `bookings.amount_paid`, and the Legacy POS mesh is signed/authenticated. The corrected report was closer, but overstated readiness; live database deployment and packaged-operator smoke tests still need separate proof.

Focused verification run on 2026-07-03:

- `npm test` passed.
- `npm run test:offline-queue-critical` passed.
- `npm run test:offline-pos-critical` passed.
- `npm run test:financial-integrity` passed.
- `npm run test:inventory-offline-sync` passed.
- `npm run legacy-pos:test` passed with 216 checks.
- `npm run db:push` applied `20260703153000_public_booking_offers.sql`.
- `npm run test:customer-credit-reschedule` passed.
- `npm --prefix booking-site run test:run` passed.
- `npm --prefix booking-site run build` passed.
- `npm run build` passed.

Before continuing any of these areas, inspect `git status`, the relevant diff, and the latest migration files. Preserve unrelated edits.

## Superseded old priorities

The former top-level priorities—deposit linkage, basic booking replay, first-generation idempotency, initial POS-to-booking linkage, and adding a financial audit table—are no longer accurate as unimplemented project-wide tasks.

They remain regression-sensitive contracts. New work must verify and preserve them rather than reimplement them from an old plan.

## Known caveats

- Customer-credit/reschedule repair migrations through `20260621170000` are applied to the linked project, including receipt numbering, safe transfer keys, local-date check-in, and event parent-ID protection.
- The customer-credit/reschedule feature is release-candidate quality, not yet production-certified: packaged-installer smoke tests, disconnected replay testing, database concurrency/isolation smoke tests, Supabase lint/advisors, artifact signing, and final publication remain.
- Desktop 1.5.5 is the active local package manifest version. A successful local build does not mean it has been published.
- Historical POS orders with `outlet_id = NULL` may appear as `Unassigned`; do not invent outlet attribution without evidence.
- Some regression suites are structural contract tests. Passing them does not replace database smoke tests for high-risk SQL.
- Long-outage desktop operation remains "pending local truth" until Supabase replay succeeds. Managers should save offline operations bundles during multi-day outages and must review failed/dead-lettered operations when internet returns.
- Intentionally online-only areas remain: first-time login/session bootstrap, Command Central/admin service-role work, imports/undo imports, server-authoritative exports/reports/financial validation, license activation, fleet health, formal booking refund approval/final settlement with live manager PIN verification, and POS catalog publishing/setup changes needed by Legacy POS snapshots. Booking refund requests can be prepared offline, but they do not move money or customer credit until that online approval succeeds.
- The working tree can contain multiple concurrent initiatives. Do not stage, revert, format, or rewrite unrelated files.
- A PWA empty result may indicate session/readiness or schema-contract failure rather than genuinely absent data.
- `room_rate_overrides` previously had RLS enabled but no policies; the `20260621180000` migration added the policies and was recorded as applied. Re-verify the linked schema if this table appears empty in a deployed client.

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
