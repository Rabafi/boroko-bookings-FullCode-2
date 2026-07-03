# Booking Rescheduling and Customer Credit

> **Status: implemented and database-deployed as of 2026-06-20; release publication pending in this document's evidence.** The repository includes the Supabase ledger/RPC layer, desktop backend and UI, offline replay contracts, reporting classification, read-only Manager PWA visibility, receipts, and focused regression coverage. The linked migration list and live RPC catalog were verified after deployment. This plan's packaged-installer evidence refers to the historical Windows 1.5.2 artifact; the current package manifest is newer, so use [../PROJECT_STATE.md](../PROJECT_STATE.md) and [SHIP_READY_RUNBOOK.md](SHIP_READY_RUNBOOK.md) for current release state.

## Implementation record

Implemented entry points:

- Desktop: **Front Desk -> Prepayments**
- Existing booking: **Bookings -> Payment -> Customer credit**
- Eligible booking: **Bookings -> Reschedule**
- Manager PWA: read-only customer-credit liability summary under Money

Confirmed implementation:

- `customer_credit_ledger` with lodge/customer isolation, immutable compensating entries, RLS, constraints, consistency trigger, and customer-scoped locking.
- Atomic receipt, allocation, refund, reversal, balance/history/summary, cash-flow, and booking-reschedule RPCs.
- Stable idempotency keys for queued advance-payment receipts and queued reschedules.
- Credit allocation as an alternative payment source, never a duplicate normal payment.
- Cash reporting that counts advance receipt once, excludes allocation as new cash, and distinguishes internal credit transfers from external refunds.
- Advance-payment receipts that state no accommodation is reserved until a booking is confirmed.
- Desktop capability gates for receipt/allocation and refund/reversal actions.

Verification completed on 2026-06-20 for this feature slice:

- Linked Supabase migrations applied through `20260620200000`.
- Live function signatures, authenticated grants, ledger table, and consistency trigger verified.
- Customer-credit/reschedule, financial-integrity, offline-queue, production-guardrail, Manager PWA lint/build, booking-site build, Legacy POS tests, and desktop build passed.
- Windows installer created at `dist/Boroko-Bookings-1.5.2-x64.exe` for that historical verification slice.

Remaining release gates:

- Run the complete current ship-ready command matrix, including production audit and all affected offline/import/inventory suites.
- Run Supabase lint/advisors and disposable live concurrency, duplicate replay, rollback, and cross-lodge isolation smoke tests.
- Test prepayment, allocation, refund/reversal, rescheduling, conflict handling, receipt printing, and disconnected replay from the packaged installer.
- Sign and intentionally publish the desktop installer.
- Deploy and smoke-test any changed Manager PWA build.
- Confirm backups, support-bundle export, production queue health, and deployment-matrix status before operator rollout.

The sections below preserve the original technical design and acceptance contract. Where proposed names differ from the final migration, the deployed migration and current tests are authoritative.

## Comprehensive Technical Implementation Plan

**Project:** Boroko Bookings  
**Prepared for:** Implementation by another AI agent  
**Priority:** Financial integrity and concurrency safety  
**Surfaces:** Supabase, Electron desktop, offline queue, Manager PWA, reporting, receipts, regression tests

---

## 1. Objective

Implement two related booking capabilities:

1. **Reschedule an existing booking**
   - Change check-in and check-out dates.
   - Optionally move the booking to another room.
   - Revalidate availability atomically.
   - Recalculate the authoritative booking total.
   - Preserve payments and correctly handle overpayment or increased balance.
   - Keep a complete reasoned audit trail.

2. **Hold money for a customer before dates are confirmed**
   - Receive money without creating a booking or blocking a room.
   - Treat the money as customer credit held by the lodge.
   - Later apply some or all of that credit to a newly created or existing booking.
   - Support partial allocation, remaining credit, refund, reversal, and complete transaction history.

These features must follow the repository's financial rules:

- Supabase is the single source of truth.
- All financial mutations happen in RPCs.
- `amount_paid` and `payment_status` are never authored by the frontend.
- Critical operations are atomic, concurrency-safe, idempotent, and audited.
- Offline operations replay the same RPC contract used online.
- Electron and Manager PWA paths must be considered independently.

---

## 2. Non-Negotiable Domain Model

### 2.1 A customer credit is not a booking

Do not create a booking with null dates, placeholder dates, a fake room, or a special non-blocking booking status.

A booking represents reserved accommodation. Customer credit represents money held by the lodge on behalf of a customer.

Keeping these concepts separate prevents:

- Incorrect room occupancy.
- False arrivals and departures.
- Distorted booking counts and subscription usage.
- Invalid room conflict checks.
- Misleading booking revenue.
- Placeholder records that become difficult to reconcile.

### 2.2 Customer credit is a ledger, not an editable balance

Never store a mutable `customers.credit_balance` that clients directly increment or decrement.

The available balance must be derived from immutable ledger entries:

```text
available credit
= receipts
+ positive adjustments
- booking allocations
- refunds
- negative adjustments
- reversals
```

Ledger entries must not be edited or deleted after posting. Corrections use compensating entries.

### 2.3 Applying credit is not receiving new cash

There are two distinct accounting events:

1. The customer gives the lodge money:
   - Cash/bank/card collection occurs.
   - Customer-credit liability increases.

2. The credit is allocated to a booking:
   - Customer-credit liability decreases.
   - The booking's paid amount increases.
   - No new cash is collected at allocation time.

Reports must not count both events as cash receipts. A booking payment created by credit allocation must use a dedicated method such as `customer_credit`, and cash-collection reports must exclude that method.

---

## 3. Required Preliminary Investigation

Before editing code:

1. Read the repository `AGENTS.md`.
2. Inspect the current working tree and preserve unrelated user changes.
3. Inspect the latest local migrations affecting:
   - `bookings`
   - `payments`
   - `financial_audit_log`
   - `financial_operation_idempotency`
   - `create_booking`
   - `update_booking`
   - `update_booking_payment`
   - `approve_booking_refund`
   - room overlap protection
   - exclusive-event overlap protection
4. Verify the linked Supabase schema before relying on migration history.
5. Confirm actual function signatures with PostgreSQL catalog queries.
6. List real scripts from `package.json`; do not invent test commands.
7. Read the existing Electron path:
   - `src/main/domains/bookings.js`
   - `src/main/database.js`
   - `src/main/index.js`
   - `src/preload/index.js`
   - `src/renderer/src/components/Bookings.jsx`
8. Read the Manager PWA path:
   - `manager-pwa/src/lib/api.js`
   - `manager-pwa/src/pages/Bookings.jsx`
   - `manager-pwa/src/pages/Money.jsx`
9. Inspect existing financial and offline regression tests before designing new test assertions.

Do not modify historical migrations. Add new forward-only migrations.

---

## 4. Product Decisions for Version 1

Implement the following behavior unless the owner explicitly changes it.

### 4.1 Rescheduling eligibility

Allow rescheduling only for bookings in:

- `pending`
- `confirmed`

Reject:

- `checked_in`
- `checked_out`
- `cancelled`

An in-house stay extension or room move is operationally different and should remain a separate future workflow.

### 4.2 Rescheduling overpayments

If a reschedule lowers the total below the amount already paid, the operator must choose one of:

- Transfer the excess into customer credit.
- Cancel the reschedule and process a booking refund first.

Do not silently preserve an overpaid booking. Do not automatically issue external cash refunds inside the rescheduling RPC.

### 4.3 Rescheduling price

The server calculates the total for the new room and dates using the authoritative room-rate logic.

If a manager-authorized custom total is supported:

- It must require `allow_total_override`.
- It must enforce manager/admin authorization server-side.
- The reason must be captured.
- The before/after amount must be audited.

### 4.4 Customer credit identity

Credit belongs to:

- One `lodge_id`.
- One `customer_id`.

Credit cannot be transferred between lodges.

Do not allow cross-customer allocation in version 1. If a receipt was recorded against the wrong customer, reverse it and record the correct receipt.

### 4.5 Offline behavior

- **Record advance payment:** may be queued offline using the same RPC payload. Show it as pending and do not include it in confirmed available credit until Supabase acknowledges it.
- **Apply credit:** online-only in version 1 because the available balance must be locked and confirmed against concurrent allocations.
- **Create booking using credit:** online-only as one atomic RPC. Offline users may create the booking without applying credit, then allocate credit after synchronization.
- **Reschedule:** use the same rescheduling RPC online and in replay. If queued offline, mark the local change as tentative and prevent financial follow-up actions until synchronization succeeds. A server conflict must surface in System Health/manual repair rather than silently overwriting another booking.
- **Refund customer credit:** online-only.

---

## 5. Database Schema

Create a new migration with a timestamp later than the latest migration in the repository.

### 5.1 `customer_credit_ledger`

Recommended schema:

```sql
create table public.customer_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.lodges(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  entry_type text not null,
  amount numeric(14,2) not null,
  method text,
  reference text,
  notes text not null default '',
  booking_id uuid references public.bookings(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  reverses_entry_id uuid references public.customer_credit_ledger(id) on delete restrict,
  recorded_by uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint customer_credit_amount_positive_chk check (amount > 0),
  constraint customer_credit_entry_type_chk check (
    entry_type in (
      'receipt',
      'booking_allocation',
      'refund',
      'adjustment_in',
      'adjustment_out',
      'reversal_in',
      'reversal_out'
    )
  ),
  constraint customer_credit_idempotency_format_chk check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
  )
);
```

Use positive `amount` values. The sign is determined by `entry_type`.

Balance effect:

| Entry type | Credit balance effect | Cash effect |
|---|---:|---:|
| `receipt` | Increase | Cash in |
| `booking_allocation` | Decrease | None |
| `refund` | Decrease | Cash out |
| `adjustment_in` | Increase | Normally none |
| `adjustment_out` | Decrease | Normally none |
| `reversal_in` | Increase | Depends on reversed entry |
| `reversal_out` | Decrease | Depends on reversed entry |

### 5.2 Constraints and indexes

Add:

```sql
create unique index customer_credit_ledger_lodge_idempotency_uidx
  on public.customer_credit_ledger (lodge_id, idempotency_key);

create index customer_credit_ledger_customer_created_idx
  on public.customer_credit_ledger (lodge_id, customer_id, created_at desc);

create index customer_credit_ledger_booking_idx
  on public.customer_credit_ledger (booking_id)
  where booking_id is not null;

create unique index customer_credit_ledger_reversal_uidx
  on public.customer_credit_ledger (reverses_entry_id)
  where reverses_entry_id is not null;
```

Add validation through constraints or RPC logic:

- `receipt` requires a real payment method.
- `booking_allocation` requires `booking_id` and `payment_id`.
- `refund` requires a payment method and reference/proof according to existing refund policy.
- Reversal entries require `reverses_entry_id`.
- The referenced customer and booking must belong to the same lodge.
- An entry can be reversed only once.

### 5.3 Audit support

Extend the existing `financial_audit_log.action` constraint to include:

- `booking_rescheduled`
- `customer_credit_received`
- `customer_credit_allocated`
- `customer_credit_refunded`
- `customer_credit_adjusted`
- `customer_credit_reversed`

If `financial_audit_log.booking_id` is nullable, use it for booking-related credit events. Include `customer_id`, ledger entry IDs, and balances in snapshots.

Do not create an unrelated second audit system unless the current table cannot represent these events safely.

### 5.4 RLS and grants

Enable RLS on the ledger.

Recommended access:

- Direct `INSERT`, `UPDATE`, and `DELETE`: denied to `anon` and `authenticated`.
- Mutations: RPC only.
- Select: either a lodge-scoped policy using existing access helpers or, preferably, controlled read RPCs.
- `service_role`: permitted as required by the existing backend pattern.

Apply the repository's PWA mutation gate:

- Manager PWA remains read-only for these features initially.
- Desktop-authorized RPC execution may mutate.
- Do not accidentally grant financial mutation access to the direct PWA session.

---

## 6. Server-Side Balance Calculation

Create one canonical internal function:

```text
customer_credit_balance(lodge_id, customer_id) -> numeric
```

The function should calculate:

```sql
sum(
  case
    when entry_type in ('receipt', 'adjustment_in', 'reversal_in') then amount
    when entry_type in ('booking_allocation', 'refund', 'adjustment_out', 'reversal_out') then -amount
    else 0
  end
)
```

Requirements:

- Return a rounded numeric value, never null.
- Never trust a frontend-supplied balance.
- Allocation and refund RPCs must lock before reading the balance.
- Use a transaction-scoped advisory lock based on `lodge_id + customer_id`, or lock a stable customer row with `FOR UPDATE`.
- The locking strategy must serialize concurrent allocations for the same customer.

Do not add a balance cache in version 1 unless profiling proves it necessary. Correctness is more important than avoiding a small indexed aggregate.

---

## 7. Required Customer Credit RPCs

Every mutation RPC must:

- Be `SECURITY DEFINER`.
- Set a safe `search_path`.
- Validate lodge access and role.
- Reject PWA financial mutation where the existing architecture requires it.
- Require an idempotency key.
- Use `_claim_financial_operation` and `_record_financial_operation`, or an equivalent existing canonical mechanism.
- Lock all relevant rows before validating balances.
- Return structured JSON with `success`, identifiers, authoritative balances, and `idempotent`.
- Never expose raw SQL errors when a stable domain error can be returned.

### 7.1 `record_customer_credit`

Suggested signature:

```text
record_customer_credit(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_notes text,
  p_recorded_by uuid,
  p_idempotency_key text
) returns jsonb
```

Atomic behavior:

1. Validate positive amount and supported method.
2. Verify customer belongs to lodge.
3. Claim idempotency operation.
4. Lock customer credit scope.
5. Insert `receipt` ledger entry.
6. Calculate new available balance.
7. Insert financial audit event.
8. Record idempotency result.
9. Return ledger entry and authoritative balance.

Do not insert a normal booking `payments` row because no booking exists.

### 7.2 `apply_customer_credit_to_booking`

Suggested signature:

```text
apply_customer_credit_to_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_notes text,
  p_recorded_by uuid,
  p_expected_booking_updated_at timestamptz,
  p_idempotency_key text
) returns jsonb
```

Atomic behavior:

1. Lock customer credit scope.
2. Lock booking row `FOR UPDATE`.
3. Verify lodge and customer ownership.
4. Reject cancelled/checked-out booking according to existing payment rules.
5. Verify optimistic concurrency timestamp if supplied.
6. Calculate confirmed available credit.
7. Calculate booking outstanding amount:

   ```text
   total_amount + charges_total - amount_paid
   ```

8. Reject:
   - Zero/negative allocation.
   - Allocation greater than available credit.
   - Allocation greater than booking outstanding amount.
9. Insert a `payments` row:
   - `booking_id = booking`
   - `amount = allocation amount`
   - `method = 'customer_credit'`
   - `type = 'payment'`
   - deterministic idempotency key derived from the operation
   - notes identifying the credit allocation
10. Insert `booking_allocation` credit ledger entry linked to the booking and payment.
11. Recalculate booking `amount_paid` from authoritative payment rows or use the repository's canonical server helper.
12. Recompute `payment_status` with `compute_payment_status`.
13. Update the booking once.
14. Write financial audit events for both payment/allocation context without double-counting the amount.
15. Record idempotency result.
16. Return:
   - new credit balance
   - booking amount paid
   - booking outstanding amount
   - booking payment status
   - ledger entry ID
   - payment ID

Do not implement this as two frontend RPC calls. The allocation and booking payment must commit or roll back together.

### 7.3 `create_booking_with_customer_credit`

Suggested signature:

```text
create_booking_with_customer_credit(
  -- same authoritative booking fields as create_booking
  p_credit_amount numeric,
  p_created_by uuid,
  p_booking_id uuid,
  p_idempotency_key text,
  p_allow_total_override boolean
) returns jsonb
```

This must be one atomic transaction:

1. Validate customer and room.
2. Lock credit scope.
3. Perform server-authoritative room/exclusive-event conflict checks.
4. Calculate/validate total using existing booking rules.
5. Validate credit balance and requested allocation.
6. Insert booking.
7. Insert credit-backed booking payment.
8. Insert credit allocation ledger entry.
9. Derive booking financial fields.
10. Audit and record idempotency.

Prefer extracting and reusing private server-side helpers from `create_booking` and credit allocation rather than duplicating validation logic. Do not call multiple public RPCs from the client.

If `p_credit_amount = 0`, the existing `create_booking` path may remain in use.

### 7.4 `refund_customer_credit`

Suggested signature:

```text
refund_customer_credit(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_notes text,
  p_requested_by uuid,
  p_approved_by uuid,
  p_idempotency_key text
) returns jsonb
```

Requirements:

- Online-only.
- Follow the existing refund approval/role pattern.
- Lock and validate available balance.
- Insert a `refund` ledger entry.
- Never edit/delete the original receipt.
- Audit proof/reference and approving actor.
- Return the remaining authoritative balance.

### 7.5 `reverse_customer_credit_entry`

Use this for incorrect receipts or allocations rather than deletion.

Requirements:

- Manager/admin authorization.
- Online-only.
- Entry can be reversed once.
- A booking allocation reversal must also create a corresponding negative booking payment/refund entry and recalculate the booking atomically.
- Do not permit reversal when downstream state makes it invalid without an explicit supported compensating operation.
- Record the original and compensating ledger entry IDs.

### 7.6 Read RPCs

Add:

```text
get_customer_credit_balance(lodge_id, customer_id)
get_customer_credit_history(lodge_id, customer_id, limit, offset)
get_customer_credit_summary(lodge_id, search, limit, offset)
```

The summary should return customers with:

- Customer identity.
- Confirmed available balance.
- Total receipts.
- Total allocations.
- Total refunds.
- Last activity date.

Paginate history and summary. Do not load the entire ledger into the client and calculate balances there.

---

## 8. Dedicated Rescheduling RPC

Do not expose rescheduling merely as a cosmetically renamed generic booking edit. Implement explicit server semantics and audit.

Suggested signature:

```text
reschedule_booking(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_new_room_id uuid,
  p_new_check_in date,
  p_new_check_out date,
  p_reason text,
  p_overpayment_action text,
  p_allow_total_override boolean,
  p_override_total numeric,
  p_expected_updated_at timestamptz,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
```

Allowed `p_overpayment_action`:

- `reject`
- `transfer_to_customer_credit`

### 8.1 Atomic algorithm

1. Validate required values and non-empty reason.
2. Claim the financial operation by idempotency key.
3. Lock the booking `FOR UPDATE`.
4. Validate lodge ownership and operator role.
5. Check expected `updated_at`.
6. Reject unsupported statuses.
7. Validate `check_out > check_in`.
8. Verify room belongs to lodge, is active, and is not under blocking maintenance.
9. Check normal room overlap while excluding the current booking.
10. Check exclusive-event/full-lodge overlap using the repository's canonical protection.
11. Calculate expected total from authoritative rate logic.
12. Apply authorized override only when explicitly requested and permitted.
13. Calculate:

   ```text
   old_owed = old total_amount + charges_total
   new_owed = new total_amount + charges_total
   amount_paid = authoritative booking amount_paid
   overpayment = max(0, amount_paid - new_owed)
   additional_due = max(0, new_owed - amount_paid)
   ```

14. If `overpayment > 0`:
   - `reject`: return a stable domain error with overpayment amount.
   - `transfer_to_customer_credit`: atomically create:
     - a negative/refund-style booking payment reducing `amount_paid`
     - a customer-credit `adjustment_in` or dedicated `booking_overpayment_transfer` receipt type
     - linked audit snapshots
15. Update room, dates, total, and derived payment status.
16. Record `booking_rescheduled` audit data:
   - old/new room
   - old/new dates
   - old/new total
   - amount paid
   - overpayment transferred
   - additional amount due
   - reason
   - actor
17. Record idempotency result.
18. Return complete authoritative result.

### 8.2 Transfer semantics

The transfer must not create cash movement.

Recommended implementation:

- Insert a negative `payments` row with:
  - `type = 'refund'` or a new constrained type such as `credit_transfer`
  - `method = 'customer_credit_transfer'`
  - notes linking the credit ledger entry
- Insert a positive credit ledger entry linked to the booking/payment.
- Exclude transfer methods from cash-refund and cash-receipt reports.

If adding new `payments.type` values, update all constraints, reports, UI labels, and tests. If retaining `refund`, reports must distinguish a credit transfer from an external refund by method.

### 8.3 Database-level conflict enforcement

The RPC's explicit overlap query is not sufficient by itself under concurrency unless supported by an exclusion constraint, advisory lock, or equivalent canonical booking lock strategy.

Investigate the existing `no_overlapping_bookings` protection. Reuse it if valid.

The final design must prove that two concurrent reschedules cannot both reserve the same room/date range.

---

## 9. Electron Main Process

### 9.1 Domain functions

Add functions in the appropriate main-process domain, preferably a dedicated `customerCredit.js` plus booking reschedule support in `bookings.js`:

- `rescheduleBooking`
- `recordCustomerCredit`
- `getCustomerCreditBalance`
- `getCustomerCreditHistory`
- `getCustomerCreditSummary`
- `applyCustomerCreditToBooking`
- `createBookingWithCustomerCredit`
- `refundCustomerCredit`
- `reverseCustomerCreditEntry`

Rules:

- Generate stable intent IDs before the first network attempt.
- Reuse the same intent ID for retry and offline replay.
- Do not generate a replacement key after timeout.
- Surface structured server errors.
- Refresh the smallest relevant caches after success.
- Record critical errors with customer/booking IDs, never sensitive payment proof contents.

### 9.2 Offline queue

Queued entries must use:

```js
{
  type: 'rpc',
  table: 'record_customer_credit', // or reschedule_booking
  data: { /* exact RPC payload */ }
}
```

Requirements:

- Persist the idempotency key.
- Normalize legacy queue records only if necessary.
- Pending credit receipt must show `_pending_sync` and `_financial_estimate`.
- Pending receipt must not become spendable credit.
- Pending reschedule must mark the booking tentative.
- Disable payment, refund, checkout, and credit allocation actions while relevant booking/customer financial sync is unresolved.
- Replay errors must appear in System Health with enough context for repair.
- Replays must not fall back to raw inserts or generic `.update()`.

### 9.3 Database exports, IPC, and preload

Wire every required operation through:

- `src/main/database.js`
- `src/main/index.js`
- `src/preload/index.js`

Use narrow, explicit APIs such as:

```js
window.api.bookings.reschedule(...)
window.api.customerCredit.record(...)
window.api.customerCredit.getBalance(...)
window.api.customerCredit.getHistory(...)
window.api.customerCredit.applyToBooking(...)
window.api.customerCredit.refund(...)
```

Validate IPC input shapes in the main process. Do not trust renderer-provided lodge IDs, roles, totals, or balances.

---

## 10. Desktop User Interface

Primary file currently containing booking workflows:

- `src/renderer/src/components/Bookings.jsx`

Refactor into smaller components if necessary, but avoid an unrelated broad rewrite.

### 10.1 Reschedule action

Add a distinct **Reschedule** action for eligible bookings.

The modal must show:

- Guest and current room.
- Current dates.
- Current booking total.
- Amount already paid.
- New room selector.
- New check-in/check-out dates.
- New authoritative price preview.
- Difference:
  - additional amount due
  - no financial change
  - overpayment
- Required reason.
- Overpayment action when relevant.

The preview is informational. The server result is authoritative.

Confirmation copy should clearly state that availability and pricing will be rechecked before saving.

On `BOOKING_CONFLICT`, stale timestamp, or room conflict:

- Keep the modal open.
- Show the complete error.
- Refresh the displayed booking and room availability.
- Do not silently retry with a new idempotency key.

### 10.2 Customer credit during booking creation

When a customer is selected:

- Load confirmed available credit.
- Show pending credit separately.
- Add an **Apply customer credit** control.
- Default allocation to `min(available credit, booking total)` only after an explicit user action.
- Permit partial allocation.
- Never allow more than confirmed credit or booking total.

When credit is used, submit `create_booking_with_customer_credit` rather than:

1. creating the booking, then
2. applying credit in a second client call.

### 10.3 Apply credit to an existing booking

In the payment modal:

- Add `Customer credit` as a source only if confirmed balance is positive.
- Show available credit and outstanding booking balance.
- Use `apply_customer_credit_to_booking`.
- Do not route this through the normal cash/card `update_booking_payment` call.

### 10.4 Customer Credit panel

Add a panel under the Money area, with:

- Customer search.
- Available confirmed credit.
- Pending offline receipt amount.
- Record advance payment.
- View ledger history.
- Print/export advance payment receipt.
- Apply to a booking.
- Refund credit with approval.
- Reverse incorrect entry with manager authorization.

Suggested labels:

- **Advance payment received**
- **Available customer credit**
- **Applied to booking**
- **Credit refunded**
- **Pending synchronization**

Avoid “wallet” unless the product owner prefers it; “Customer Credit” is clearer for lodge staff.

### 10.5 Receipt wording

Advance-payment receipts must include:

> This payment is held as customer credit. It does not reserve accommodation or guarantee room availability until a booking is confirmed.

Include:

- Lodge.
- Customer.
- Amount.
- Method.
- Reference.
- Date/time.
- Receipt/ledger identifier.
- Recorded-by user.
- Remaining credit balance.

---

## 11. Manager PWA

The Manager PWA connects directly to Supabase and does not use `database.js`.

Version 1 should remain read-only for these sensitive operations.

### 11.1 Bookings

Display:

- Reschedule history in booking detail.
- Previous and current dates/room.
- Reason and actor.
- Financial difference.
- Any overpayment transferred to customer credit.

Do not add direct PWA reschedule mutation unless a later requirement explicitly authorizes it and the server role model supports it.

### 11.2 Money

Add read-only customer credit visibility:

- Total outstanding customer-credit liability.
- Customers with available credit.
- Recent receipts.
- Recent allocations.
- Recent refunds.
- Pending/error state if applicable.

Ensure the PWA calls read RPCs rather than calculating balances from unrestricted raw rows.

Keep existing guidance that desktop completes payments, refunds, and booking mutations.

---

## 12. Reporting and Accounting Changes

Audit every report that reads `payments` or sums cash.

At minimum inspect:

- Dashboard collections.
- Daily cash.
- Monthly revenue.
- Payment-method totals.
- Cash-up reconciliation.
- Booking financial history.
- Collections queue.
- Manager PWA Money page.
- Exports.

### 12.1 Required classifications

Reports should expose distinct concepts:

- **Cash collected:** includes customer-credit receipts on receipt date.
- **Cash refunded:** includes customer-credit cash refunds on refund date.
- **Booking payments:** includes credit allocation on allocation date for booking settlement.
- **Customer-credit liability:** confirmed unused credit balance.
- **Revenue:** follow the application's existing recognition policy, but never treat unused customer credit as room revenue.

### 12.2 Double-counting guardrail

When a P1,000 advance receipt is later allocated:

- Cash collected across both events remains P1,000, not P2,000.
- Booking paid increases by P1,000.
- Customer-credit liability decreases by P1,000.

Add regression tests specifically proving this.

### 12.3 Payment method labels

Add display labels where needed:

- `customer_credit` → `Customer credit`
- `customer_credit_transfer` → `Transferred to customer credit`

Do not include these methods in physical cash/card/bank cash-up totals.

---

## 13. Financial and Operational Audit Trail

Every action should produce enough evidence to answer:

- Who performed it?
- When?
- On which customer and booking?
- What was the prior state?
- What is the new state?
- What amount moved?
- Was external cash involved?
- What reason/reference/proof was supplied?
- What idempotency key protected the action?

Booking detail timeline should include:

- Original booking creation.
- Reschedule event.
- New dates and room.
- Price difference.
- Credit allocation.
- Credit transfer caused by lower reschedule total.
- Refund/reversal events.

Do not derive an audit timeline solely from mutable booking fields.

---

## 14. Concurrency Scenarios That Must Be Safe

Implement and test:

1. Two devices reschedule different bookings into the same room/date slot.
   - Exactly one succeeds.

2. Two devices allocate the same P1,000 customer credit simultaneously.
   - Combined successful allocations cannot exceed P1,000.

3. An allocation request times out after commit and is retried.
   - One ledger entry and one booking payment exist.

4. An advance receipt is queued offline and replayed more than once.
   - One receipt exists.

5. Booking is changed on another device while reschedule modal is open.
   - Stale reschedule fails with a conflict response.

6. Booking balance changes while credit allocation modal is open.
   - Server recalculates outstanding amount and rejects excess allocation.

7. Credit refund and allocation are attempted concurrently.
   - Total outflow cannot exceed confirmed credit.

8. A reschedule creates an overpayment and transfers it to credit.
   - Booking payment reduction and credit increase either both commit or both roll back.

---

## 15. Migration and Compatibility Strategy

### Phase 1: Database foundations

- Ledger table, constraints, indexes, RLS.
- Audit action expansion.
- Balance/read helpers.
- Mutation RPCs.
- Grants.

### Phase 2: Desktop backend

- Domain methods.
- Offline queue support.
- IPC and preload.
- Cache integration.
- System Health error visibility.

### Phase 3: Desktop UI

- Reschedule modal.
- Customer Credit panel.
- Booking creation allocation.
- Existing booking allocation.
- Receipts and history.

### Phase 4: Manager PWA and reporting

- Read-only PWA visibility.
- Cash/revenue/liability classification.
- Exports.

### Phase 5: Verification and deployment

- Local tests.
- Builds.
- Linked database migration.
- Live RPC smoke tests using disposable test records.
- Cleanup of test data through supported paths.

The database migration should land before clients that call the new RPCs. Old clients must continue operating during rollout.

Do not remove or change existing RPC signatures unless compatibility wrappers are retained.

---

## 16. Required Tests

Add focused regression suites rather than relying only on broad string checks.

Suggested files:

- `tests/customer-credit-regression.test.mjs`
- `tests/booking-reschedule-regression.test.mjs`
- `tests/customer-credit-financial-contract-integration.sql`
- Extend `tests/offline-queue-regression.test.mjs`
- Extend `tests/financial-integrity-regression.test.mjs`
- Extend PWA regression coverage

### 16.1 SQL/integration tests

Test:

- Receipt creates credit.
- Duplicate receipt replay is idempotent.
- Same idempotency key with different payload is rejected.
- Partial allocation.
- Full allocation.
- Insufficient credit.
- Allocation above booking balance.
- Concurrent allocation.
- Credit refund.
- Reversal once only.
- Cross-lodge/customer attempts rejected.
- PWA mutation rejected.
- Reschedule into available room succeeds.
- Conflicting reschedule fails.
- Concurrent conflicting reschedules allow one winner.
- Stale booking timestamp fails.
- Unsupported booking status fails.
- Higher reschedule total creates additional due.
- Lower total with `reject` fails.
- Lower total with transfer moves exact excess into credit.
- Credit transfer creates no net new cash.

### 16.2 Electron tests

Test:

- Exact RPC payloads.
- Stable idempotency keys across retries.
- Offline receipt queues an RPC.
- Offline reschedule queues the dedicated RPC.
- Pending credit is not spendable.
- Financial actions lock while sync is unresolved.
- No raw insert/update of financial fields.
- IPC/preload contracts exist.

### 16.3 UI tests

Test:

- Reschedule is hidden/disabled for unsupported statuses.
- Reason is required.
- Overpayment requires an explicit action.
- Credit balance appears for selected customer.
- Allocation cannot exceed credit or outstanding amount.
- Complete server errors remain visible.
- Advance receipt warning text appears.
- PWA displays data read-only.

### 16.4 Reporting tests

For a P1,000 receipt followed by a P1,000 allocation:

- Cash collected = P1,000.
- Credit liability = P0.
- Booking paid = P1,000.
- Allocation cash effect = P0.

For a P1,000 receipt with P700 allocated:

- Cash collected = P1,000.
- Credit liability = P300.
- Booking paid = P700.

---

## 17. Verification Commands

Use only scripts that exist in the current `package.json`. At the time this plan was written, relevant commands include:

```powershell
npm test
npm run test:offline-queue-critical
npm run test:financial-integrity
npm run build
npm run manager:lint
npm run manager:build
```

Also run new focused test files directly with Node if no package script is added.

Before pushing a migration:

1. Inspect local SQL carefully.
2. Verify the linked migration list.
3. Run the repository's `npm run db:push` wrapper.
4. Confirm deployed function signatures and grants.
5. Execute live smoke tests with a test lodge/customer/booking where safe.
6. Verify ledger, booking payment, payment status, audit rows, and report classification.

Do not package or publish a release until database and client verification pass.

---

## 18. Acceptance Criteria

The work is complete only when all conditions below are true.

### Rescheduling

- Operator can reschedule an eligible booking.
- New room/dates are conflict-checked atomically.
- Exclusive-event conflicts are enforced.
- Total is calculated server-side.
- Existing payments are preserved.
- Increased balance is correct.
- Overpayment is rejected or atomically transferred to customer credit.
- Reason and before/after state are audited.
- Retry cannot duplicate transfer/audit effects.
- Offline replay uses the same RPC and exposes conflicts.

### Customer credit

- Money can be received without creating or blocking a booking.
- Available credit is ledger-derived.
- Receipt is idempotent and audited.
- Credit can be partially or fully allocated.
- Allocation and booking payment are one transaction.
- Concurrent allocations cannot overspend.
- Credit can be refunded/reversed through compensating entries.
- Pending offline receipts are clearly marked and not spendable.
- Advance-payment receipt explicitly says no room is reserved.

### Reporting

- Unused credit appears as a liability, not booking revenue.
- Cash receipt occurs once.
- Credit allocation does not create duplicate cash.
- Booking paid amount and payment status remain authoritative.
- Desktop and PWA show consistent balances.

### Security and quality

- No frontend writes `amount_paid` or `payment_status`.
- No raw inserts for critical mutations.
- PWA remains read-only for version 1.
- RLS and grants are verified.
- Focused regression tests and builds pass.
- Existing unrelated working-tree changes are preserved.

---

## 19. Explicitly Forbidden Implementations

Do not:

- Create placeholder or date-less bookings for advance payments.
- Add an editable customer balance field as the source of truth.
- Directly update `bookings.amount_paid`.
- Calculate authoritative `payment_status` in React or Electron.
- Apply credit with a client-side read-then-write sequence.
- Create a booking and allocate credit in two separate client RPC calls.
- Allow allocation from pending offline credit.
- Count credit receipt and allocation as two cash receipts.
- Delete or edit posted ledger entries.
- Retry with a fresh idempotency key after an ambiguous timeout.
- Trust frontend-provided lodge ID, balance, total, role, or payment status.
- Bypass exclusive-event or maintenance checks.
- Silently resolve stale booking conflicts.
- Modify historical migration files.
- Overwrite unrelated user changes in the dirty worktree.

---

## 20. Implementation Prompt for the Next AI

Use the following as the execution instruction:

> Implement the complete Booking Rescheduling and Customer Credit plan in `docs/BOOKING_RESCHEDULE_AND_CUSTOMER_CREDIT_IMPLEMENTATION_PLAN.md`.
>
> Begin by inspecting the current working tree, current local code, latest migrations, and linked Supabase schema. Treat the plan's proposed signatures as a design target, but reconcile them with the live schema and existing canonical helpers before writing SQL. Preserve all unrelated user changes.
>
> Financial integrity is non-negotiable. All mutations must be atomic Supabase RPCs, concurrency-safe, idempotent, audited, and compatible with the Electron offline queue. Never directly update `amount_paid` or author `payment_status` in a client. Do not model customer credit as a date-less booking or mutable balance.
>
> Implement both execution surfaces: Electron through the main-process domain/IPC/preload path, and read-only Manager PWA visibility through direct Supabase read RPCs. Keep PWA financial mutations disabled in version 1.
>
> Pay special attention to cash classification: advance receipt is cash collected; later booking allocation is a non-cash internal transfer and must not double-count collections.
>
> Add focused SQL, offline, financial, UI-contract, reporting, and concurrency regression coverage. Run the repository's actual tests and builds. Deploy migrations only through the repository's supported database workflow, then verify live function signatures, grants, idempotency, audit rows, balances, booking payment state, and report totals.
>
> Do not declare completion if only the UI or only the migration is implemented. Completion requires the full database, Electron, offline replay, PWA read visibility, reporting, receipt, audit, and regression-test flow described in the plan.
