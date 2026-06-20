## Boroko Bookings 1.5.2

### Highlights
- Mesh synchronization, authentication, and offline queue hardening
- Quotation currency guardrails
- Improved system-health and client update reporting
- Manager PWA cache refresh and health-reporting improvements

### Operator Notes
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

