# Events & Venues Implementation Handoff

> **Status: proposed work as of 2026-06-20.** This is a planning handoff, not an implemented or deployed feature declaration. Reconcile it with current event quotations, conference/day-use/POS contracts, and the linked schema before implementation.

## Objective

Expand the existing **Conference** feature into **Events & Venues** so Boroko Bookings can manage:

- Conferences and meetings
- Parties, weddings, receptions, and corporate functions
- Pool, bar, braai, garden, gazebo, and other venue hire
- Venue-only events with no rooms
- Events with one or more optional rooms
- Existing exclusive/full-lodge events
- Event extras, inventory-linked items, payments, quotations, invoices, POS charges, reporting, and offline replay

The resulting model must preserve the existing full-lodge booking behavior and all financial-grade rules in `AGENTS.md`.

## Non-negotiable architectural decisions

1. **Do not remove or replace the existing full-lodge booking implementation.**
   - The current authoritative full-lodge record is a row in `bookings` with `is_exclusive_event = true`.
   - Existing lodge-wide overlap protection in `guard_exclusive_event_overlap()` must remain authoritative.
   - Existing full-lodge records must continue to appear in Bookings and reports.

2. **Rename the user-facing Conference feature to Events & Venues, but do not physically rename `conference_bookings` in the first release.**
   - Generalize `conference_bookings` in place.
   - Preserve current foreign keys from `payments`, current cache names, existing RPC names during migration, and old records.
   - New event-focused RPCs may wrap shared internal database functions.
   - Keep old conference RPCs as compatibility wrappers until all clients are migrated.

3. **An event is the parent operational and financial folio.**
   - Venue resources, optional rooms, extras, payments, and POS charges attach to the event.
   - A venue-only event must not create a fake room booking.
   - A selected room must create or link a real `bookings` row so room availability remains authoritative.
   - A full-lodge event must create or link the existing authoritative exclusive booking row.

4. **All financial totals and statuses are server-authoritative.**
   - Do not trust totals supplied by Electron, Manager PWA, Legacy POS, or any other client.
   - Do not derive payment status in frontend code.
   - Do not increment `deposit_paid` or similar aggregate fields directly.
   - Payments and refunds must be ledger-backed and idempotent.

5. **All critical mutations must be RPC based and transactional.**
   - Electron online and offline replay must call the same RPCs.
   - Manager PWA mutations, if enabled later, must call the same RPCs.
   - Creation of an event plus selected rooms/resources/line items/deposit must be one atomic database transaction.

## Current implementation to preserve

Before editing, inspect the latest definitions and call sites rather than assuming the baseline is current:

- `src/main/domains/conference.js`
- `src/renderer/src/components/Conference.jsx`
- `src/main/domains/bookings.js`
- `src/renderer/src/components/Bookings.jsx`
- `src/main/domains/pool.js`
- `src/shared/dayUseConfig.js`
- `src/main/domains/pos.js`
- `src/renderer/src/components/POS.jsx`
- `legacy-pos/src/main/index.js`
- `legacy-pos/src/renderer/src/screens/POSTerminal.jsx`
- `manager-pwa/src/lib/api.js`
- `manager-pwa/src/pages/Conference.jsx`
- `manager-pwa/src/pages/Quotations.jsx`
- `supabase/migrations/20260618180000_event_lodge_quotations.sql`

Important existing behavior:

- `conference_bookings` already supports dates, times, attendees, a venue-like `room_name`, payments, offline creation, and reporting.
- `payments.conference_booking_id` already links payment ledger rows to conference records.
- `update_conference_booking_payment` already accepts an idempotency key.
- Day Use already has configurable resources, pricing modes, bundled extras, inventory-linked extras, time conflicts, deposits, offline replay, and reporting.
- Full-lodge bookings already have concurrency-safe lodge-wide overlap protection.
- Event quotations currently support only `room` and `exclusive_event`.
- POS folio charging currently assumes `booking_id` and a room folio.

## Target terminology

Use the following user-facing terms:

- Navigation: **Events & Venues**
- Record: **Event booking**
- Financial container: **Event folio**
- Existing full-lodge option: **Entire lodge / Exclusive event**
- Optional rooms: **Guest rooms**
- Reservable non-room assets: **Venue resources**
- Priced additions: **Extras**

Keep internal compatibility names such as `conference_bookings` where necessary during phase one.

## Event types and reservation scopes

### Event type

Suggested initial values:

- `conference`
- `meeting`
- `party`
- `wedding`
- `corporate`
- `pool_party`
- `braai`
- `reception`
- `other`

Treat this as descriptive classification, not the availability rule.

### Reservation scope

This controls resource and room behavior:

- `venue_only`
  - No room booking required.
  - Reserves selected venue resources.

- `venue_with_rooms`
  - Reserves selected venue resources.
  - Creates one real booking for each selected room.

- `exclusive_lodge`
  - Creates or links exactly one authoritative `bookings.is_exclusive_event = true` record.
  - Uses existing full-lodge overlap protection.
  - Must not create one duplicated booking per room.

## Database migration design

Create one new timestamped migration. Do not modify an already-applied migration.

### 1. Generalize `conference_bookings`

Add columns using safe defaults and nullable rollout where appropriate:

```sql
alter table public.conference_bookings
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists event_name text,
  add column if not exists event_type text not null default 'conference',
  add column if not exists reservation_scope text not null default 'venue_only',
  add column if not exists status text not null default 'reserved',
  add column if not exists adults integer not null default 0,
  add column if not exists children integer not null default 0,
  add column if not exists subtotal numeric not null default 0,
  add column if not exists extras_total numeric not null default 0,
  add column if not exists charges_total numeric not null default 0,
  add column if not exists amount_paid numeric not null default 0,
  add column if not exists balance_due numeric not null default 0,
  add column if not exists currency text not null default 'BWP',
  add column if not exists exclusive_booking_id uuid references public.bookings(id) on delete restrict,
  add column if not exists quotation_id uuid references public.quotations(id) on delete set null,
  add column if not exists create_idempotency_key text,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;
```

Adjust names or types only after inspecting the live schema and the newest migrations.

Add constraints:

- Valid event type.
- Valid reservation scope.
- Valid status: `draft`, `reserved`, `confirmed`, `active`, `completed`, `cancelled`.
- `end_time > start_time`.
- Non-negative guest counts.
- Non-negative financial fields.
- `exclusive_booking_id` required only when an exclusive event has been successfully confirmed.
- A unique partial index on `(lodge_id, create_idempotency_key)` where the key is not null.
- A unique partial index on `exclusive_booking_id` where it is not null.

Backfill existing rows:

- `event_name = coalesce(company, client_name, 'Conference')`
- `event_type = 'conference'`
- `reservation_scope = 'venue_only'`
- `adults = attendees`
- `amount_paid = deposit_paid`
- Map old payment statuses to the new standard values.
- Recalculate totals from authoritative rows, not client assumptions.

Keep `deposit_paid` temporarily for compatibility, but make it a deprecated mirror of `amount_paid`. New code must not mutate it independently.

### 2. Event resources

Create `event_booking_resources`:

```text
id
lodge_id
event_booking_id -> conference_bookings.id
resource_key
resource_name_snapshot
resource_type_snapshot
start_at
end_at
quantity
exclusive_use
unit_price_snapshot
subtotal
created_at
created_by
```

Requirements:

- Store snapshots so later settings changes do not rewrite history.
- Use real timestamps for conflict checking, not only date plus text comparisons.
- Resource rows are financial only when `unit_price_snapshot > 0`; otherwise they still reserve capacity.
- Add indexes on `(lodge_id, resource_key, start_at, end_at)` and `event_booking_id`.

Resource configuration may initially reuse `day_use_resources`, but extend each resource definition with:

```text
capacity
allows_shared_use
default_price
pricing_mode
active
```

Do not enforce event conflicts solely in JavaScript. Database RPCs must enforce them.

### 3. Event line items

Create `event_booking_line_items`:

```text
id
lodge_id
event_booking_id
line_type
description
category
quantity
unit_price
subtotal
inventory_item_id nullable
depletion_quantity nullable
source_reference nullable
voided_at nullable
void_reason nullable
created_at
created_by
```

Suggested `line_type` values:

- `venue`
- `package`
- `catering`
- `equipment`
- `cleaning`
- `security`
- `decoration`
- `inventory`
- `manual`
- `pos`

Rules:

- The RPC calculates `subtotal = quantity * unit_price`.
- Never allow clients to provide authoritative subtotal.
- Preserve description and price snapshots.
- Inventory-linked line items must decrement inventory atomically and idempotently.
- Voiding an item must restore inventory exactly once where applicable.
- Do not physically delete financially relevant line items after confirmation.

### 4. Event-room links

Create `event_booking_rooms`:

```text
id
lodge_id
event_booking_id
booking_id -> bookings.id
room_id -> rooms.id
relationship_type
created_at
created_by
```

Add unique constraints:

- Unique `(event_booking_id, booking_id)`.
- A booking may belong to at most one event parent unless a future explicit requirement changes this.

For `venue_with_rooms`, every selected room must produce a real booking through shared server-side booking logic.

Do not call an RPC repeatedly from the client and hope all calls succeed. The event creation RPC must create the event and all room bookings in one database transaction.

### 5. POS event linkage

Add a nullable event foreign key to `pos_orders`:

```sql
alter table public.pos_orders
  add column if not exists event_booking_id uuid
  references public.conference_bookings(id) on delete restrict;
```

Enforce:

- A folio order targets either `booking_id` or `event_booking_id`, not both, unless a later explicit split-folio design is introduced.
- Directly paid POS orders remain normal POS revenue.
- Event-folio POS orders increase event charges through server-side ledger behavior.
- Reporting must avoid counting the same event-folio POS amount as both direct POS revenue and event revenue.

### 6. Financial audit

Either extend the current financial audit table with `event_booking_id`, or create a dedicated `event_financial_audit_log` if the existing constraints are booking-only.

Record:

- Event creation
- Line-item addition, edit, and void
- Room link and unlink
- Payment and refund
- POS folio posting and reversal
- Cancellation
- Before/after financial snapshots
- Actor
- Idempotency key
- Timestamp

## Server-authoritative totals

Define one reusable internal database routine for event totals.

Conceptually:

```text
base venue/resource subtotal
+ active event line items
+ linked room accommodation totals, if the commercial decision is that rooms
   are billed through the event folio
+ event-folio POS charges
= event gross total

payment ledger credits
- refunds
= amount paid

gross total - amount paid = balance due
```

Before implementing, make one explicit accounting choice:

### Recommended choice

The event folio is the customer-facing master folio, but linked room bookings retain their own accommodation totals for room operations and occupancy reporting.

To prevent duplicate revenue:

- Mark linked room bookings with an event parent.
- Revenue reports must classify their accommodation value under event accommodation once, not under both ordinary room revenue and event revenue.
- Payments for the package are recorded against the event parent.
- A linked room booking should show that settlement is controlled by its event folio.

If this cross-folio reporting change is too large for the first release, use a safer first version:

- Event folio includes venue and event extras only.
- Linked rooms retain independent room folios and payments.
- The UI shows a combined informational summary but does not merge financial ledgers.

Do not silently mix these models. Pick one, encode it in tests, and document it. The recommended final model is the master event folio, but the independent-room-folio version is an acceptable staged release.

## Required RPCs

Use names similar to the following. Exact signatures may be adjusted to existing conventions.

### `create_event_booking(payload jsonb)`

Must:

1. Validate lodge access and creator.
2. Validate idempotency key.
3. Acquire a lodge-scoped advisory transaction lock.
4. Validate event date/time and status.
5. Validate every resource and detect overlaps.
6. Validate every selected room, maintenance state, capacity, and overlap.
7. For `exclusive_lodge`, run the same authoritative logic used by current full-lodge creation.
8. Insert the generalized conference/event parent.
9. Insert resource reservations.
10. Insert line items and perform inventory mutations.
11. Create linked room bookings where applicable.
12. Create the exclusive booking where applicable.
13. Record any deposit through the event payment ledger function.
14. Recalculate totals and payment status.
15. Write audit records.
16. Return one complete canonical event snapshot.

The whole operation must roll back if any required component fails.

### `update_event_booking(payload jsonb)`

Must:

- Require `event_booking_id`, `lodge_id`, idempotency key, and expected `updated_at`.
- Lock the parent row.
- Reject stale concurrent updates.
- Revalidate changed resources and rooms.
- Never accept direct writes to aggregate financial fields.
- Recalculate totals and return the canonical row.

### `add_event_line_item(payload jsonb)`

Must:

- Validate quantity and price ranges.
- Snapshot the item details.
- Apply inventory depletion atomically if linked.
- Recalculate totals.
- Write audit history.
- Be idempotent.

### `void_event_line_item(...)`

Must:

- Require a reason and authorized actor.
- Mark the line voided instead of deleting it.
- Restore inventory once.
- Recalculate totals.
- Be idempotent.

### `update_event_payment(...)`

Mirror the safety properties of `update_booking_payment`:

- Delta-based payment amount.
- Payment or refund type.
- Required method.
- Required idempotency key.
- Row lock.
- Payment ledger insert.
- Server-derived `amount_paid`, `payment_status`, and `balance_due`.
- Audit record.

Standard payment statuses should be:

- `unpaid`
- `partial`
- `paid`

Do not retain `pending` and `deposit_paid` as the new financial truth. Translate them for old records and compatibility displays.

### `cancel_event_booking(...)`

Must:

- Lock the event.
- Require cancellation reason.
- Deal explicitly with linked rooms:
  - cancel linked bookings, or
  - reject until the operator confirms the chosen action.
- Release resource reservations.
- Preserve financial history.
- Never delete payments or audit records.
- Handle refund policy through an explicit refund flow.

### Compatibility wrappers

Retain:

- `create_conference_booking`
- `update_conference_booking`
- `update_conference_booking_payment`
- `delete_conference_booking`

Old wrappers should either call the new shared implementation or reject unsupported destructive behavior safely. Do not maintain two independent financial implementations.

## Concurrency and overlap rules

### Shared lodge lock

Use the existing booking overlap lock convention:

```sql
pg_advisory_xact_lock(
  hashtextextended('booking-overlap:' || lodge_id::text, 0)
)
```

Event creation involving rooms or full-lodge scope must use the same lock as room booking creation.

### Resource overlap

For exclusive resources, conflict exists when:

```text
existing.start_at < requested.end_at
AND existing.end_at > requested.start_at
AND existing.status is not cancelled
```

For shared resources:

- Sum active reserved quantity during the overlapping interval.
- Reject when requested quantity exceeds configured capacity.

### Full-lodge interaction

- An exclusive-lodge event conflicts with every active room booking in the date range.
- A normal room booking conflicts with every active exclusive-lodge event.
- Venue-only events do not automatically block rooms.
- Resource exclusivity must be independent of room exclusivity.

## Existing full-lodge booking compatibility

### New full-lodge creation

The Bookings screen should keep its current shortcut, renamed if helpful to:

**Create Full-Lodge Event**

The shortcut opens Events & Venues with:

```text
reservation_scope = exclusive_lodge
event_type = other
```

Submission creates:

- One event parent in `conference_bookings`.
- One authoritative exclusive row in `bookings`.
- A link through `exclusive_booking_id`.

### Existing full-lodge records

Do not force an immediate destructive backfill.

Implement a compatibility read:

- Events & Venues lists new event parents.
- It also lists legacy `bookings.is_exclusive_event = true` rows that have no linked event parent.
- Label legacy records clearly as `Legacy full-lodge event`.
- Opening one may offer a safe idempotent “Adopt into Events & Venues” action that creates the parent and links the existing booking without changing its financial values.

Do not create duplicate exclusive bookings during adoption.

## Desktop Electron changes

### Main process/domain layer

Preferred direction:

- Introduce `src/main/domains/events.js`.
- Keep `conference.js` as compatibility exports during migration.
- Add canonical event list/select constants in one shared location.
- Add event cache support without breaking old `conference-bookings` cache files.

Required operations:

- List/get event
- Create/update/cancel event
- Add/void line item
- Add/remove linked room
- Record payment/refund
- List event payments/audit history
- Fetch resources and availability
- Generate event slip/quotation/invoice

Every offline mutation must queue:

```js
type: 'rpc'
table: '<exact RPC name>'
data: { ...exact server payload... }
```

Use stable operation IDs created at user intent time. Never create a new idempotency key on each replay.

### IPC/preload

Add a grouped API such as:

```js
events: {
  list,
  get,
  create,
  update,
  cancel,
  addLineItem,
  voidLineItem,
  addRoom,
  removeRoom,
  recordPayment,
  getPayments,
  getAudit,
  getAvailability
}
```

Keep existing `conference` APIs working until the renderer migration is complete.

### Renderer

Rename:

- Route label `Conference` -> `Events & Venues`
- Page heading and copy
- Dashboard shortcut
- Permissions copy
- Reports and export section labels

Build the event editor as sections or tabs:

1. Overview
2. Venue and resources
3. Guest rooms
4. Extras
5. Payments
6. POS charges
7. History

The create flow should support presets:

- Conference
- Party
- Pool party
- Wedding/reception
- Corporate event
- Braai
- Custom

Presets prefill values only. The database remains authoritative.

### Booking screen

- Keep full-lodge events visible because they affect room availability.
- Show an event badge and a link to the event parent when available.
- Linked optional rooms remain visible as normal bookings.
- Venue-only events do not appear as fake room rows.
- Keep the current full-lodge shortcut but route it into the event creation flow.

## Day Use relationship

Do not merge Day Use records into events in the first release.

Use this boundary:

- Day Use: casual visits, walk-ins, simple pool/facility access.
- Events & Venues: advance reservation, named event, resource blocking, richer folio, optional rooms, quotations, and POS/event charges.

Reuse:

- Resource configuration concepts
- Pricing modes
- Extra presets
- Inventory-linked extra patterns
- Time conflict helper ideas

Do not reuse frontend-calculated totals as financial truth. Port the useful patterns into server-authoritative event RPCs.

Optionally add “Convert Day Use to Event” later; it is not required for the first implementation.

## POS changes

### Desktop POS

Extend customer/charge target:

- Walk-in
- Room folio
- Event folio

When Event folio is selected:

- Load active/upcoming events for the current lodge.
- Show event name, date, time, and balance context.
- Submit `event_booking_id`.
- Do not require `room_id` or `booking_id`.
- Display offline staging warnings equivalent to room folio warnings.

### Legacy POS

Legacy POS is a separate deployable client and must be updated in the same feature rollout if event folio charging is enabled.

Required:

- Cache eligible event parents.
- Select Event Folio.
- Include `event_booking_id` in canonical payloads.
- Queue exact RPC operations offline.
- Preserve event linkage through returns/voids.
- Add regression tests forbidding raw inserts into event financial tables.

If Legacy POS cannot be updated in the same release, keep event-folio charging disabled there rather than routing it through a fake room.

### Server POS RPC

Extend the authoritative POS order RPC:

- Validate the event belongs to the lodge.
- Validate it is not cancelled/completed as appropriate.
- Insert the POS order and items.
- Apply inventory depletion.
- Add or derive the event folio charge atomically.
- Ensure replay cannot duplicate either order or charge.

Returns and voids must reverse event folio charges and inventory exactly once.

## Quotations

Expand quotation types beyond current `room` and `exclusive_event`.

Recommended target:

- `room`
- `event`
- `exclusive_event`

For `event`, store:

- Event name/type
- Date/time
- Guest counts
- Requested resources
- Optional room selections
- Quoted line items
- Deposit terms

Conversion requirements:

- `room` -> existing room booking conversion.
- `event` -> `create_event_booking`.
- `exclusive_event` -> event parent plus authoritative exclusive booking.

Conversion must be idempotent and atomic.

Preserve the current offline queue phrase `Booking queued offline` where existing tests or operator workflows depend on it, unless all related contracts and tests are intentionally migrated together.

## Manager PWA

First release should remain read-only unless explicitly authorized otherwise.

Rename the page to Events & Venues and show:

- Event identity and type
- Date/time
- Status
- Guest counts
- Venue resources
- Linked rooms
- Event total, amount paid, and balance from server-authoritative fields
- POS event charges

Do not calculate payment status in React.

Update:

- Navigation and More page
- Dashboard/report summaries
- API select constants
- Schema compatibility fallbacks
- Empty-state and error handling

Avoid silent `[]` fallbacks for schema errors that should be visible during rollout.

## Reporting and exports

Update all relevant desktop and PWA reports.

Required dimensions:

- Event revenue
- Event payments/cash collected
- Outstanding event balances
- Revenue by event type
- Revenue by venue resource
- Event extras
- Event-linked room accommodation
- Event-folio POS
- Cancelled events and refunds

Prevent double counting:

- POS orders charged to an event folio are not direct POS cash revenue.
- Linked room accommodation is counted once according to the selected folio model.
- A full-lodge exclusive booking and its event parent are not counted as two sales.

Update:

- Dashboard totals
- P&L
- Detailed report RPCs
- Spreadsheet exports
- Invoice/receipt output
- Email output
- Data management exports

## Permissions and feature flags

Continue using the existing conference entitlement initially to avoid plan drift:

- Internal feature key may remain `conference`.
- User-facing label becomes Events & Venues.

Add or map capabilities:

- `conference.view` -> Events & Venues view
- `conference.manage` -> create/update resources and events
- `conference.payments` or equivalent
- `conference.cancel` or equivalent

Do not silently grant payment, cancellation, or void permissions just because a user can view events.

## Offline sync requirements

For every event mutation:

- Queue exact RPC name and payload.
- Store stable idempotency key.
- Preserve dependencies:
  - event creation before event payment
  - event creation before POS folio posting
  - room creation/link before operations that depend on it
- Merge peer queues safely.
- Patch cached event rows with sync status.
- Surface manual review when the server rejects an operation after local optimistic acceptance.

Critical scenario:

1. Device A creates an event offline.
2. Device B books the same room/resource online.
3. Device A reconnects.
4. Server rejects the conflicting event atomically.
5. Device A must show a clear manual-review state; it must not partially create the event or charge a deposit.

## Implementation phases

### Phase 0: Verification

- Inspect live schema and latest migration definitions.
- Enumerate every direct read/write of:
  - `conference_bookings`
  - `payments.conference_booking_id`
  - `bookings.is_exclusive_event`
  - `pos_orders.booking_id`
- Confirm current RPC overloads and grants.
- Confirm current report RPCs and revenue classifications.
- Write findings into the implementation PR description.

### Phase 1: Database foundation

- Generalize `conference_bookings`.
- Add resources, line items, room links, POS event link, indexes, constraints, RLS, and audit support.
- Add canonical event RPCs and compatibility wrappers.
- Add SQL/regression tests for concurrency, idempotency, totals, and overlap.

Do not proceed to broad UI work until database tests pass.

### Phase 2: Desktop Events & Venues

- Add domain/API/cache/offline support.
- Rename UI.
- Implement create/edit/detail screens.
- Add optional resources, extras, rooms, payments, and history.
- Redirect the Bookings full-lodge shortcut into the event flow.
- Preserve legacy full-lodge display.

### Phase 3: Quotations and documents

- Add event quotation type.
- Convert quotations atomically.
- Update PDF/email/export/invoice/slip outputs.

### Phase 4: POS

- Add Event Folio to desktop POS.
- Add server atomic posting/reversal.
- Update Legacy POS or explicitly leave the target disabled there.
- Add offline and return/void tests.

### Phase 5: Manager PWA and reporting

- Read-only Events & Venues page.
- Update dashboard, reports, exports, and financial classifications.
- Verify no double counting.

### Phase 6: Compatibility cleanup

- Adopt legacy full-lodge records only through an explicit idempotent action.
- Remove frontend-derived conference payment status.
- Deprecate old conference RPC internals after all clients use event RPCs.
- Do not physically rename the table until a separate migration proves all clients and integrations are ready.

## Required regression coverage

Create a focused test file such as:

`tests/events-venues-regression.test.mjs`

At minimum test:

1. Venue-only party creates no room booking.
2. Event with selected room creates one real booking and one link.
3. Two concurrent attempts for the same room cannot both succeed.
4. Two concurrent exclusive resource reservations cannot both succeed.
5. Shared resource capacity is enforced.
6. Exclusive-lodge event uses one authoritative exclusive booking.
7. Existing room booking blocks exclusive-lodge event.
8. Exclusive-lodge event blocks later room booking.
9. Retrying event creation with the same idempotency key returns the same result.
10. Retrying payment does not duplicate payment.
11. Retrying inventory extra does not double-deplete stock.
12. Client-supplied subtotal/total/payment status cannot override server truth.
13. Voiding an inventory extra restores stock once.
14. Event cancellation preserves ledger and audit history.
15. POS event folio order posts one charge.
16. POS retry does not duplicate the order or event charge.
17. POS void/return reverses the event charge once.
18. Reports do not double-count event-folio POS.
19. Reports do not double-count exclusive booking and event parent.
20. Offline queue stores RPC operations, not raw critical inserts.
21. Offline event conflict becomes manual review without partial server rows.
22. Legacy conference records still load.
23. Legacy full-lodge records still appear.
24. Manager PWA renders server totals and statuses.

Also update applicable existing tests:

- `tests/event-quotation-regression.test.mjs`
- `tests/offline-queue-regression.test.mjs`
- `tests/financial-integrity-regression.test.mjs`
- `tests/offline-pos-regression.test.mjs`
- `legacy-pos/tests/legacy-pos-regression.test.mjs`
- `tests/pwa-schema-contract-regression.test.mjs`

## Verification commands

Use actual scripts from `package.json`; do not invent script names.

Expected minimum verification:

```powershell
node .\tests\events-venues-regression.test.mjs
npm run test:financial-integrity
npm run test:offline-queue-critical
npm run test:offline-pos-critical
npm test
npm run build
npm run manager:lint
npm run manager:build
npm run legacy-pos:test
npm run legacy-pos:build
```

If migrations are deployed:

```powershell
npm run db:push
```

Then verify the linked database definitions and run targeted RPC probes using correct lodge/user role context.

## Acceptance criteria

The implementation is complete only when:

- Staff can create a venue-only party without selecting a room.
- Staff can reserve one or more resources with concurrency-safe conflict checks.
- Staff can optionally add real room bookings.
- Staff can create an exclusive/full-lodge event through Events & Venues.
- The Bookings full-lodge shortcut still exists and routes into the same authoritative flow.
- Existing full-lodge and conference records remain readable.
- Event totals and payment status are calculated only by the database.
- Deposits and later payments use an idempotent payment RPC.
- Offline replay uses the exact same event RPCs.
- Inventory-linked extras are atomic and replay-safe.
- Desktop POS can charge to an event folio without a room.
- Legacy POS is either safely updated or event folio is explicitly unavailable there.
- Manager PWA provides correct read-only visibility.
- Quotations convert into events atomically.
- Reports and exports do not double-count room, event, or POS revenue.
- Focused regressions, builds, and live-schema verification pass.

## Strict implementation prompt for the next AI

Implement the Events & Venues plan in `docs/EVENTS_VENUES_IMPLEMENTATION_HANDOFF.md`.

Before editing:

1. Read `AGENTS.md`.
2. Inspect the latest schema, migrations, RPC definitions, and every current read/write path listed in the plan.
3. Verify which claims in the plan match the current repository and linked database.
4. Report any material conflict before changing the architecture.

Implementation rules:

- Preserve the existing `bookings.is_exclusive_event` full-lodge mechanism and overlap trigger.
- Rename Conference only at the product/UI level in the first release; generalize `conference_bookings` in place.
- Do not create fake room bookings for venue-only events.
- Optional rooms must be real booking rows created transactionally by the event RPC.
- Full-lodge events must create exactly one authoritative exclusive booking.
- All financial mutations must use RPCs.
- Never accept client-calculated totals or payment status as authoritative.
- Never directly increment aggregate paid fields.
- Use stable idempotency keys for creation, payments, inventory, POS posting, voids, and refunds.
- Electron offline replay must call the exact same RPCs as online execution.
- Update Desktop, Manager PWA, reporting, quotations, exports, and both POS surfaces where in scope.
- Preserve compatibility for existing conference and full-lodge records.
- Do not make unrelated changes.

Work in the phases defined in the plan. After each phase, run focused regression tests. At the end, run the full verification set, inspect the final diff for financial and compatibility risks, and provide:

- Files changed
- Migrations added
- RPCs added or replaced
- Compatibility behavior
- Tests run and exact results
- Any deferred scope or remaining risk
