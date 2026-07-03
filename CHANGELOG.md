## Boroko Bookings 1.5.5

### Highlights
- Main desktop long-outage and mesh hardening is present in the repository.
- Desktop sync queue state is journaled with exportable local operation history.
- Offline queue coverage now includes broader desktop lodge operations while preserving Supabase RPC replay as final authority.
- Accommodation room quotations can store multiple room lines and convert into grouped accommodation invoices.
- External offline/sync audit claims were verified on 2026-07-03; the severe SQLite/no-idempotency/unauthenticated-mesh findings were not true for the current checkout.

### Operator Notes
- Local estimates remain pending until cloud replay succeeds.
- Formal refund settlement, reports/export authority, admin work, license activation, and POS catalog publication remain online-only.
- Do not treat this changelog entry as proof that desktop, PWA, booking site, Legacy POS, or Supabase changes have all been published.

## Boroko Bookings 1.5.3

### Highlights
- Dedicated A4 advance-payment receipt PDFs with lodge branding and simple `PRE-YYYY-NNNN` numbering
- Customer-credit-only booking payments no longer require a separate cash amount
- Rescheduling now appears in booking activity and overpayment transfers use valid replay-safe keys
- Expected booking conflicts and overpayment choices no longer create critical System Health incidents
- Streamlined Events & Venues form and repaired full-lodge event creation
- Correct Gaborone-local check-in date handling around midnight
- Correct cancellation progress labels

### Operator Notes
- Prepayments now appear under **Finance**.
- Existing advance-payment receipts can be reopened from the customer credit ledger.
- Clear historical System Health entries after installing; expected booking conflicts should not recreate them.

## Boroko Bookings 1.5.2

### Highlights
- Customer prepayments held as auditable customer credit without blocking rooms
- Apply customer credit to existing bookings, with refund and reversal controls
- Booking rescheduling with authoritative availability, pricing, and overpayment handling
- Read-only Manager PWA customer-credit liability visibility
- Mesh synchronization, authentication, and offline queue hardening
- Quotation currency guardrails
- Improved system-health and client update reporting
- Manager PWA cache refresh and health-reporting improvements

### Operator Notes
- Access advance payments from **Front Desk -> Prepayments**.
- A prepayment does not reserve accommodation until it is applied to a confirmed booking.
- Use the booking **Reschedule** action to change eligible room dates; availability and price are rechecked when saved.
- Update the desktop application in place using the normal installer.
- Confirm devices reconnect and pending work synchronizes after restart.
- Database-backed features require their corresponding Supabase migrations.

## Boroko Bookings 1.5.0

### Highlights
- POS critical repair: financial write lockdown, pricing v2, returns v2, cash-up v2
- Event/lodge quotations with full RPC flow
- Atomic room maintenance flow
- PWA: POS reporting, light mode, burger menu, schema contract repair
- Inbox server read receipts
- Pool day-use mesh sync contract
- Legacy POS: mesh/storage modules, enhanced sync, payload schema
- Secure queue secrets for offline idempotency

### Operator Notes
- New POS financial safeguards are active — verify cash-up reports after update.
- Event quotations are now available from the front desk and PWA.
- Update both the main desktop app and legacy POS terminals.
- Restart all apps after download to apply.

## Boroko Bookings 1.3.16

### Highlights
- Maintenance release with quality improvements and fixes.

### Operator Notes
- Update when the front desk has a quiet moment.
- Restart the desktop app after download completes to apply the update.
- Review the updated areas briefly after install.

