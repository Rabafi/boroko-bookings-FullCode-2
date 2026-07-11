# Boroko Bookings Project State

As of: 2026-07-07

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
- Main desktop long-outage hardening: queued desktop operations now have an append-only local operation journal, manager-acknowledged lodge offline mode, offline operations bundle export, mesh repair visibility, and mesh allowlist/schema coverage for every desktop offline RPC operation while preserving Supabase RPC replay as final authority.
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

### 2026-07-11: Product workspace and release-feed isolation

- The repository remains one shared code workspace and one Supabase backend for Boroko Bookings, Lodge & Camp, Hotel, and Restaurant & Bar POS.
- Existing Boroko Bookings installations remain the compatibility product: Windows application ID `com.boroko.bookings`, user-data identity `boroko-bookings`, and the established public updater feed `Rabafi/boroko-bookings-releases`. Only the root `release:*` scripts may be used to update those live customers.
- Lodge & Camp (`com.boroko.lodgecamp`), Hotel (`com.boroko.hotel`), and Restaurant & Bar POS (`com.boroko.hospitalitypos`) have independent public GitHub Releases feeds. This avoids `latest.yml` collisions that could otherwise offer one product's installer to another product.
- The dedicated feeds are configured and their GitHub repositories exist, but no new standalone product installer has been published or operator-smoke-tested yet.

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
- 2026-07-08: Restaurant-mode Supabase migrations through `20260708190000_restaurant_phase3_role_hardening.sql` were applied to the linked Supabase project via `npm run db:push`, and a follow-up push reported `Remote database is up to date`. Live schema smoke confirmed the restaurant Phase 2-5 migration records, 20 expected restaurant tables with RLS enabled, parent-join RLS on purchase-order/checklist child tables, role guards on the checked restaurant RPC set, and `generate_owner_digest` using `inventory_items` rather than the old `inventory` name. This does not prove packaged desktop, Manager PWA, or operator workflow smoke.
- 2026-07-10: Restaurant Phase 6 differentiators, POS visual-cue migrations, and `20260710160000_pos_even_split_atomic.sql` were applied to the linked Supabase project via `npm run db:push`; a later push must still be used to prove no newer local migrations are pending. Even bill splits now run through a single server transaction with row locking, lodge/outlet role enforcement, server audit, and an idempotency record. Kitchen-ticket reads and status updates use the authoritative `pos_prep_tickets`/RPC path when online, while the local cache remains an offline fallback. This is repository and linked-database proof, not proof that a packaged desktop, deployed Manager PWA, printers, or a real restaurant service shift has been operator-smoke-tested.

## Enterprise Foundation (codex/tsa-bonno-enterprise-foundation branch)

The Enterprise foundation implementation has been started on the `codex/tsa-bonno-enterprise-foundation` branch. This branch builds the product foundation for the Enterprise Hotel tier and property-aware module visibility without breaking current Starter, Standard, or Pro behavior.

### Implemented so far

1. **Enterprise subscription plan**: Added `Enterprise` to `SUBSCRIPTION_PLAN_ORDER` and `PLAN_ALIASES`. Enterprise is the top tier for hotel-grade PMS operations.

2. **Pro plan capped**: Pro is no longer unlimited. New limits: 500 bookings/month, 10 grace, 30 rooms, 10 users.

3. **Enterprise usage limits**: 2,000 bookings/month, 50 grace, 100 rooms, 25 users.

4. **Property type constants** (`src/shared/propertyTypes.js`): Defines `guest_house`, `bnb`, `lodge`, `camp`, `motel`, `hotel`, `resort`, `restaurant` with labels, defaults, and helper functions (`normalizePropertyType`, `isHotelPropertyType`, `isResortPropertyType`, `isRestaurantOnly`).

5. **Module catalog and visibility resolver** (`src/shared/moduleCatalog.js`): 34-module catalog with categories, plan requirements, property type restrictions, and add-on keys. `resolveModuleVisibility` returns `visible`, `locked`, or `hidden` based on property type, plan, and add-on state.

6. **Navigation updated** (`src/renderer/src/navigation/desktopNav.js`): Added Hotel group nav items (Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts, Rate Plans, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Enterprise Reports, Guest CRM, Operations Compliance, and Multi-Outlet POS). Navigation filtering now uses module visibility resolver with property type, plan, and add-on state.

7. **Subscription panel updated** (`src/renderer/src/components/SubscriptionAccessPanel.jsx`): Shows Enterprise plan with capacity pack messaging, handles Enterprise recommendation, and styles Enterprise plan card with indigo theme.

8. **Entitlement feature map updated** (`src/main/domains/subscriptionState.js`): Added Enterprise-level features (`hotel_mode`, `room_types`, `physical_inventory`, `floors_sections`, `front_desk_dashboard`, `folios`, `advanced_housekeeping`, `hotel_kpis`, `corporate_accounts`, `rate_plans`, `custom_website`, `payment_gateway`, `channel_manager`, `multi_property`).

9. **Tests added** (`tests/enterprise-foundation.test.mjs`): 43 tests covering plan limits, property type normalization, module catalog, visibility resolver, and add-on gating. All pass.

10. **Existing tests updated** (`tests/subscription-usage-limits.test.mjs`): Updated to reflect capped Pro limits, Enterprise as the best-fit plan, and the `enterprise` usage state key.

11. **Hotel module routes implemented in repository**: Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts placeholder, and Rate Plans placeholder now have routed Enterprise-gated screens. Corporate Accounts and Rate Plans remain controlled add-on placeholders, not full production modules.

12. **Room Types foundation**: `room_types` domain, cache registration, renderer CRUD, room dropdown linkage, and Supabase migration files are present. Rooms keep the legacy `room_type` text fallback while Enterprise rooms can link to `room_type_id`.

13. **Floors & Sections foundation**: `floor_sections` domain, renderer CRUD, room linkage, cache registration, and migration files are present. Rooms can optionally link to `floor_section_id`.

14. **Hotel Dashboard and Hotel KPIs**: Front-desk dashboard, arrivals, departures, in-house guests, no-show attention list, occupancy, ADR, RevPAR, and daily hotel KPI estimates are implemented. Revenue figures in hotel KPI/dashboard views are labelled as estimates; database/RPC financial records remain authoritative.

15. **Folio foundation**: The Hotel Folios screen is booking-charge-backed and posts charges through the existing audited booking-charge RPC path. It is not a separate final folio ledger yet, and it must not be treated as a replacement for authoritative payment/refund/settlement flows.

16. **Advanced Housekeeping**: Enterprise-gated advanced housekeeping board is implemented using the existing `rooms.updateHousekeeping` IPC/RPC path. It adds supervisor-style turnaround visibility without creating a second room-readiness mutation path.

17. **Enterprise add-on catalog**: Shared `enterpriseAddons` catalog distinguishes requestable add-ons from planned add-ons. Settings/Subscription shows relevant Enterprise add-ons for the selected property type and makes clear that add-ons require explicit activation.

18. **Audited Room Moves foundation**: Room Moves is now a distinct Enterprise feature/capability (`room_moves`) rather than a front-desk-dashboard side effect. The desktop domain uses the dedicated `move_booking_room` RPC with a stable idempotency key for online and offline replay. The new `20260703230000_room_moves_foundation.sql` migration creates `room_move_log`, enforces lodge role checks, locks affected booking/room rows, rejects conflicting idempotency-key reuse, checks target-room date conflicts, marks the previous occupied room dirty, marks the target room occupied, and writes the audit row server-side.

19. **Operational add-on read contract repaired**: Phase 10 operational module reads now call concrete RPCs (`get_lost_found_items`, `get_incident_logs`, `get_visitor_registrations`, `get_linen_items`, `get_linen_laundry_batches`) instead of a non-existent generic `rpc` function. `20260703220000_phase10_operational_modules.sql` defines those read RPCs and repairs the emergency-list view to use current bookings/customers/rooms fields.

20. **In-app upgrade request path wired to Command Central tickets**: The Subscription Package Builder now has a real preload/main-process submission bridge. Until a dedicated commercial-request table/workflow is built, submitted package requests create `Upgrade Request` support tickets in Command Central with selected plan, add-ons, capacity details, contact details, and pricing-note context. This is a working intake path, not the final quote-to-invoice/pro-forma workflow.

21. **Dedicated subscription request data model**: The support-ticket bridge has been replaced with a dedicated `subscription_package_requests` table and Supabase RPCs for in-app/public submission, admin listing/detail, status updates, quote/pro-forma document recording, and activation. Domain file `subscriptionRequests.js`, IPC handlers, and preload bridge are wired. Command Central has a Subscription Requests inbox with status flow controls.

22. **Marketing website Enterprise package builder**: The marketing site (`marketing-site/`) now has an Enterprise page (`/enterprise`) where prospects can select Enterprise add-ons, fill in property details, and submit a quote request directly via the public `submit_public_subscription_request` RPC. The packages page now includes Enterprise as a fourth tier.

23. **Commercial request hardening**: `20260704001000_subscription_requests_activation_hardening.sql` removes the broad public/authenticated request policies, keeps public website leads hidden from lodge users, grants admin request RPCs through `service_role`, validates request payloads, stores quote/pro-forma document payloads on the request, and makes activation require a selected license/lodge pair that actually matches `licenses.lodge_id`. Desktop activation updates the selected license plan and upserts selected add-on feature entitlements before marking the request activated. Command Central can save recorded quote/pro-forma payloads as A4 PDFs.

24. **Automated package quotation flow**: Starter, Standard, Pro, and Enterprise now use published annual package prices in the shared commercial package catalog (`P8,999`, `P12,999`, `P18,999`, `P37,998`). Advertised Enterprise add-ons now also have published Pula annual/setup pricing. The in-app Subscription Package Builder now generates and submits the same quotation request, includes one-time 30-day trial eligibility in the pricing snapshot, and downloads the quote document for the client. The marketing website package buttons route into the quote builder for Starter/Standard/Pro/Enterprise, capture whether the property has already used the one-month trial, download a client quotation after successful submission, and submit the same pricing/trial snapshot to the public subscription request RPC. Public request RPC hardening in `20260704100000_subscription_request_auto_quote_pricing.sql` stores automatic quote payloads with status `quoted` and creates a Command Central notification.

25. **Enterprise add-on sales catalog tightened**: Public/in-app advertised Enterprise add-ons now focus on commercially meaningful modules: Custom Direct Booking Website, Online Payment Gateway, Rate Plans, Channel Manager, Corporate Accounts, Advanced Housekeeping Mobile, Guest Portal, Multi-Property Dashboard, Advanced Rate Engine, and Multi-Outlet POS Pro. Smaller operational utilities such as emergency list, visitor register, incident log, lost and found, and linen/laundry remain internal/planned module work rather than advertised quote add-ons.

26. **Enterprise operations contract layer**: `20260704110000_enterprise_operations_contracts.sql` adds lodge-scoped, RLS-enabled operational tables and RPCs for Enterprise workflow readiness records/events, payment-link requests, channel sync queue items, guest messages, guest-portal requests, revenue recommendations, guest CRM notes, Enterprise documents, and report snapshots. Desktop domain/preload/IPC wiring exposes this through `enterpriseOperations`, and the Enterprise workflow workspaces now save setup readiness to that contract with a local draft fallback. Payment links start as `requested` records only; this does not mark bookings paid. Channel sync items require idempotency keys and stay queued/manual-review until a real provider integration is configured.

### What is NOT yet proven or complete in this branch

- Live Supabase deployment of the Enterprise migration set through `20260704001000_subscription_requests_activation_hardening.sql` was completed on 2026-07-04 via `npm run db:push`; a follow-up `npm run db:push` reported `Remote database is up to date`.
- Live Supabase deployment state was refreshed on 2026-07-06 after the July 5 Enterprise migration set was added. The supported wrapper `npm run db:push` connected through the configured Supabase pooler and reported `Remote database is up to date`, so the repository migration history through `20260705205000_multi_property_shared_profiles.sql` was confirmed applied to the linked project. The follow-up channel-sync safety migration `20260706100000_channel_sync_manual_review_until_provider.sql` was also applied on 2026-07-06 and a second `npm run db:push` reported `Remote database is up to date`. This does not prove provider integrations, packaged desktop smoke tests, or deployed web clients.
- Corporate Accounts, Rate Plans, group blocks, rooming lists, master folios, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Advanced Reporting, Guest CRM, Operations Compliance, and Multi-Outlet POS now have routed Enterprise screens or contract-backed setup/control-plane foundations in the repository. Some remain operational foundations rather than full external integrations: there is still no live OTA/channel provider, no public card-payment settlement, and no released custom website deployment automation.
- The dedicated subscription request table, Command Central inbox, marketing website package builder, automatic website quote download, quote/pro-forma request records, desktop PDF export, and one-click Command Central activation from a selected request are now implemented in the repository. Public website requests can store an auto-generated quote payload and reference immediately, but payment remains manual and activation remains Command Central-controlled. There is no public self-service card payment gateway in this scope.
- The Folios implementation is a safe foundation over existing booking charges, not a final independent hotel folio ledger with split billing, master folio, night audit close, and company allocation.
- Early check-in and late checkout currently rely on existing booking status/date rules and reschedule paths; a dedicated hotel policy/pricing workflow has not been implemented.
- Brand rename and release publication are not done.

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
- `node .\tests\enterprise-foundation.test.mjs` passed with 172 tests after the Room Moves, operational read RPC, subscription-request guardrails, commercial document workflow, PDF export, and activation hardening were added.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after live Enterprise migration deployment:

- `npm run db:push` applied the remaining Enterprise migrations and a second run reported `Remote database is up to date`.
- `node .\tests\enterprise-foundation.test.mjs` passed with 173 tests after live-schema migration fixes for `settings(lodge_id)`, migration timestamp uniqueness, and the emergency-list view.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after automated quotation and Enterprise operations contract work:

- `node .\tests\enterprise-foundation.test.mjs` passed with 178 tests.
- `npm run build` passed for main, preload, and renderer.

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

## 2026-07-04: Enterprise hotel features added

- **Night Audit Transactional Close**: `night_audit_close` and `night_audit_exceptions` tables with RPCs for running checks, closing, reopening, summary, history, and exception resolution. Domain in `src/main/domains/nightAudit.js`. IPC handlers and preload bridges wired.
- **Check-in / Check-out Workflow**: `checkin_config`, `checkin_checklist_items`, `checkout_checklist_items` tables with RPCs for checklist retrieval, step completion, reset, and config management. Domain in `src/main/domains/checkinWorkflow.js`. React component at `CheckinWorkflow.jsx`.
- **Early Check-in / Late Checkout Policy Engine**: Policy and request tables for early check-in and late checkout with fee calculation, approval workflow, and CRUD RPCs. Domain in `src/main/domains/earlyLateCheckout.js`. React component at `EarlyLateCheckout.jsx`.
- **Cancellation / No-Show Policy Engine**: `cancellation_policies` and `cancellation_requests` tables with fee calculation, deposit handling, customer credit, and approval workflow. Domain in `src/main/domains/cancellationPolicies.js`. React component at `CancellationPolicies.jsx`.
- **Revenue Manager UI**: React component at `RevenueManager.jsx` with forecast, competitor notes, demand events, and recommendations panels.
- **NightAudit component** verified complete at `NightAudit.jsx` (595 lines).
- All four SQL migrations: `20260705100000_night_audit_close.sql`, `20260705120000_checkin_checkout_workflow.sql`, `20260705140000_early_late_checkout_policies.sql`, `20260705160000_cancellation_policies.sql`.
- Shared layer: capabilities added to `accessControl.js`, modules added to `moduleCatalog.js`, DEV_ENTERPRISE_PREVIEW_CAPABILITIES updated, `database.js` exports extended.
- Test suites: `tests/enterprise-night-audit.test.mjs` (11 tests), `tests/enterprise-checkin-cancellation.test.mjs` (16 tests) — all 27 passing.

## 2026-07-06: Enterprise maturity verification and fixes

- The Enterprise worktree remains a large uncommitted implementation branch. Preserve unrelated changes and compare each surface against the current manifest before claiming readiness.
- The `/booking-engine` desktop route now renders a dedicated `BookingEngine.jsx` workspace instead of pointing at the generic `EnterpriseWorkflowWorkspace` with an undefined `advanced_booking_engine` workflow key. The workspace manages booking-engine rules and upsells through the existing preload/domain/RPC contract and includes price, availability, and upsell preview only; it does not create booking intents implicitly.
- `PaymentGatewayConfig.jsx` no longer records a fake completed webhook payment from a manual "test webhook" action. The admin screen now exposes a signature verification check through `payments.verifyWebhookSignature`, and the UI states that the check does not create a payment or settle a booking.
- Regression coverage was extended in `tests/enterprise-booking-engine.test.mjs` and `tests/enterprise-payment-webhook-security.test.mjs` for the dedicated Booking Engine route and payment webhook UI safety.
- Verification passed on 2026-07-06: `node .\tests\enterprise-booking-engine.test.mjs` (26 tests), `node .\tests\enterprise-payment-webhook-security.test.mjs` (16 tests), `node .\tests\enterprise-routing-regression.test.mjs` (45 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise navigation/catalog maturity was tightened on 2026-07-06: `maintenance_enterprise`, `group_operations`, and `advanced_reports` now have module-catalog rows; Custom Website, Payment Gateway Config, Housekeeping Command Center, Promo Codes, and Rate Calendar routes are reflected in the catalog/module keys used by navigation; and `tests/enterprise-nav-catalog-parity.test.mjs` now fails any Enterprise nav entry that bypasses module-catalog gating or points at a route missing from its catalog module.
- Enterprise entitlement/access-control maturity was tightened on 2026-07-06: route-level `UpgradeWall` feature names are now backed by the subscription feature map; add-on-only Enterprise features such as Documents, Hotel Roles, Room Attributes, Advanced Reports, Advanced Booking Engine, Advanced Rates, Rate Calendar, and Promo Codes remain locked until the add-on is enabled; and hotel workflow capabilities such as group operations, preventive maintenance, night audit close/reopen/checks, check-in/out, early/late checkout, and cancellation policies are blocked when their Enterprise feature is disabled.
- Verification for the navigation/catalog/entitlement pass: `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests), `node .\tests\enterprise-housekeeping-maintenance.test.mjs` (13 tests), `node .\tests\enterprise-routing-regression.test.mjs` (46 tests), `node .\tests\enterprise-lower-tier-regression.test.mjs` (10 tests), `node .\tests\subscription-usage-limits.test.mjs` (14 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Live Supabase deployment state was refreshed on 2026-07-06: `npm run db:push` used the configured Supabase pooler and reported `Remote database is up to date` for the linked project. Local SQL contract verification also passed via `node .\tests\enterprise-live-sql-contract.test.mjs` (135 tests).
- Channel Manager provider safety was tightened on 2026-07-06: the local provider adapter now fails closed when no live OTA adapter is connected, and the forward migration `20260706100000_channel_sync_manual_review_until_provider.sql` replaces `process_channel_sync_queue` so queued channel sync items move to `manual_review_required` with an explicit provider-not-connected message instead of being marked `completed`. This was deployed to the linked Supabase project via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the channel safety pass: `node .\tests\enterprise-channel-manager.test.mjs` (10 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (140 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Payment webhook safety was tightened on 2026-07-07: the desktop preload/main IPC bridge no longer exposes `recordWebhookPayment`, the admin Payment Gateway screen remains signature-check-only, and the forward migration `20260707100000_payment_webhook_service_role_only.sql` revokes `record_webhook_payment` from `authenticated`/`anon` and grants it only to `service_role`. This preserves the rule that browser redirects, renderer actions, and operator tests cannot settle online payments; only server-side provider webhook infrastructure may record a verified webhook payment.
- The desktop payment bridge was tightened further on 2026-07-07: `payments:createBookingIntent` and `payments:createPaymentIntent` are no longer exposed through preload/main IPC or the desktop `database.js` facade. Until a real hosted-checkout/server integration is built, the desktop Payment Gateway surface is limited to provider configuration, dashboard visibility, and signature verification; it cannot initiate or settle public provider payments from renderer code.
- The payment webhook lockdown migration was deployed to the linked Supabase project on 2026-07-07 via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the payment webhook safety pass: `node .\tests\enterprise-payment-webhook-security.test.mjs` (17 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (145 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise readiness screens were tightened on 2026-07-07: Custom Website, Payment Links, and Channel Manager workflow workspaces now expose explicit non-editable launch gates for the unresolved external proof they still need, such as website deployment automation, published-site smoke testing, hosted checkout, server webhook infrastructure, provider reconciliation, and live OTA provider adapters. A locally completed readiness checklist no longer implies that those add-ons are operational.
- Enterprise catalog parity was also tightened: the Advanced Reports module now has a matching `advanced_reports` add-on catalog entry, and the Advanced Housekeeping module/test coverage recognizes both routed housekeeping surfaces (`/advanced-housekeeping` and `/housekeeping-command-center`).
- Verification for the readiness-gate/catalog pass: `node .\tests\enterprise-foundation.test.mjs` (179 tests), `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), and `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests).
- Release-gate maturity was tightened on 2026-07-07: `tests/release-behavior.test.mjs` was aligned to the current split-domain code layout and current offline dependency semantics, added as `npm run test:release-behavior`, and added to `docs/SHIP_READY_RUNBOOK.md`. It now verifies prior-run dependency handling, queued booking-reference rewrite behavior, idempotent payment replay branch ordering, and POS v3 submit-intent idempotency.
- Verification for the release-gate pass: `npm run test:release-behavior`, `npm run test:offline-queue-critical`, and `npm run test:offline-pos-critical`.
- Enterprise regression maturity was tightened on 2026-07-07: `npm run test:enterprise` was added as a discoverable Enterprise release gate in `package.json` and `docs/SHIP_READY_RUNBOOK.md`. It runs every `tests/enterprise-*.test.mjs` suite in sorted order and fails the release gate on the first broken Enterprise route, contract, migration, entitlement, offline, or security regression. Verification passed with 27 Enterprise suites.
- Web-surface local release checks were refreshed on 2026-07-07 and promoted to a root release gate: `npm run test:web-surfaces` runs Manager PWA lint/build plus booking-site tests/build. It passed with the existing Manager PWA lint warnings still warning-only, booking-site tests at 32 passing tests, and both web builds passing. This is local build/test proof only; it does not prove Netlify/public deployment publication or live browser smoke on the deployed URLs.
- Deployment-state clarity was tightened on 2026-07-07: `docs/DEPLOYMENT_EVIDENCE_MATRIX.md` now records built, deployed/published, and smoke-tested evidence separately for Supabase, desktop, Legacy POS, Manager PWA, public booking site, marketing site, payment provider integration, channel provider integration, and custom website automation. Rows that only have local build/test evidence are explicitly marked `local-only` or `not-proven`.
- Marketing-site Enterprise proof was tightened on 2026-07-07: `npm run test:marketing-site` now verifies Enterprise package metadata, the Netlify `/enterprise` redirect, public subscription-request RPC wiring, manual-payment-only copy, published Enterprise pricing, and advertised Enterprise add-on keys. `packages.html` metadata and structured data now include Enterprise instead of describing only Starter/Standard/Pro.
- Hotel-mode sidebar curation was tightened on 2026-07-07: duplicate or setup-only Enterprise entries are no longer shown as primary hotel sidebar pages. Hotel mode keeps the normal Dashboard, Housekeeping, Maintenance, Night Audit, Staff, Settings, and core hotel workspaces, while hiding duplicate/deep-link pages such as Hotel Dashboard, Advanced Housekeeping, Housekeeping Command, Maintenance (Enterprise), Hotel KPIs, Corporate Billing, Rate Calendar, Promo Codes, Room Attributes, Documents, Hotel Roles, Night Audit (Enterprise), Check-in Workflow, Early/Late Checkout, Cancellation Policies, Booking Engine, Payment Links, Payment Gateway, and Custom Website. Custom Website remains an internal/deep-link workflow rather than a client daily workspace because Boroko provisions the website for the client.
- Customer-facing Enterprise Preview Mode was removed on 2026-07-07. Unpurchased add-ons should not appear as locked daily-navigation clutter; add-on testing now belongs in Command Central, where grouped bundles such as Website + Online Payments, Guest Experience Suite, Revenue & Distribution Suite, and Enterprise Operations Suite can be enabled/disabled for a selected account using admin feature overrides.
- Website/payment packaging direction was simplified on 2026-07-07: customers should see "Direct Booking Website with Online Payments" rather than separate technical payment gateway/webhook items. Boroko builds/configures the website, connects the property's payment provider, guests book and pay online, and the desktop app receives the booking plus verified payment confirmation. Payment links are parked as a later operational tool for special invoice/folio/balance links.
- Still not proven by this local verification: real payment-provider checkout/provider-hosted settlement infrastructure, real OTA/channel-provider connectivity, custom website deployment automation, packaged installer smoke testing, and public/marketing deployment publication.

## 2026-07-08: Future Enterprise hotel add-ons added to manifest

- The Enterprise manifest and shared add-on catalog now include three planned hotel add-on directions: Staff Operations & Workforce, Maintenance & Asset Management, and Events & Venue Management. They are marked as planned/non-advertised add-ons, not shipped operational modules or public quote-builder products.
- Verification after the catalog/manifest update: `node .\tests\enterprise-foundation.test.mjs` passed with 180 tests.

## 2026-07-08: Restaurant POS phase verification and foundations

- Restaurant POS product planning now lives in `docs/RESTAURANT_POS_PRODUCT_PLAN.md` with phase-by-phase status notes and guardrails for other agents. Phase 1 restaurant curation is verified complete in the repository; Phase 2 restaurant operations is verified complete after hardening bill splits, manager-discount PIN approval, modifier persistence, and Enterprise nav guardrail expectations; Phases 3 and 4 now have tested shared foundations but are not yet fully wired to customer-facing UI, Supabase stock/loyalty/account ledgers, or offline replay.
- Phase 2 hardening added `supabase/migrations/20260708120000_restaurant_phase2_operations_hardening.sql`. This migration persists modifier group `min_selections`/`max_selections` and adds `approve_pos_discount_with_pin(payload jsonb)` so manager discount approval is server-authoritative and audited through PIN capability checks instead of a provisional offline approval.
- Restaurant-mode verification found and fixed Enterprise navigation drift around the Payment Gateway add-on: the advertised/requestable route now resolves through `/payment-links`, and `payment_gateway` no longer lists the stale `/payment-gateway-config` route as a catalog navigation route.
- New restaurant regression coverage: `tests/restaurant-operations-foundation.test.mjs`, `tests/restaurant-recipe-costing.test.mjs`, and `tests/restaurant-growth-foundation.test.mjs`.
- New shared foundations: `src/shared/restaurantRecipeCosting.js` for units, recipe theoretical usage, cost, and variance; `src/shared/restaurantGrowth.js` for loyalty math, customer-account ledger entries, delivery settlement, and multi-outlet comparison.
- Verification passed on 2026-07-08: `node .\tests\restaurant-mode-curation.test.mjs`, `node .\tests\restaurant-operations-foundation.test.mjs`, `node .\tests\restaurant-recipe-costing.test.mjs`, `node .\tests\restaurant-growth-foundation.test.mjs`, `npm test`, `npm run test:enterprise`, `npm run build`, and `npm run manager:build`.

## Updating this file

Update this document when:

- a major feature is completed or removed;
- an execution path or application surface changes;
- a migration is confirmed deployed;
- release versions change;
- a known critical risk becomes verified, fixed, or superseded.

Use exact dates and distinguish repository implementation, uncommitted work, released binaries, and confirmed production deployment.
