# Ship-Ready Runbook

Use this checklist before publishing Boroko Bookings to operators.

## Desktop and shared-contract gate

Run these checks from the repository root:

- `npm test`
- `npm run test:offline-queue-critical`
- `npm run test:offline-pos-critical`
- `npm run test:financial-integrity`
- `npm run test:inventory-offline-sync`
- `npm run test:import-critical`
- `npm run audit:prod`
- `npm run build`
- `npm run manager:lint`
- `npm run manager:build`
- `npm run booking:build`

Do not publish if any required check is red.

Run every feature-specific regression script present in `package.json` for the area being released, including customer-credit/reschedule or report-export tests when those changes are part of the release.

## Legacy POS gate

When Legacy POS, shared POS SQL, mesh behavior, shifts, outlets, returns, or cash-up changes:

- `npm run legacy-pos:test`
- `npm run legacy-pos:build`
- `npm run legacy-pos:db:probe` against the intended database when credentials are available

Build and publish Legacy POS separately from the desktop installer. Verify its package version and dedicated release repository.

## Database

- Confirm the active Supabase baseline is the intended source of truth.
- Keep historical migrations in `supabase/migrations_archive` after baselining.
- Distinguish a migration written locally from one confirmed applied to the linked production project.
- Run Supabase database lint/advisors against the target project before production promotion.
- Smoke-test the current authoritative booking, payment, POS order/return/cash-up, inventory, authentication, and public online-booking RPCs affected by the release.
- For financial SQL, test duplicate replay, conflicting idempotency payloads, concurrent mutation, rollback behavior, and lodge/outlet isolation.

## Deployment matrix

Record whether each changed surface is built, published, and smoke-tested:

- Supabase migrations
- Desktop installer
- Legacy POS installer
- Manager PWA
- Public booking site
- Marketing site

Do not announce a cross-surface feature as available until all required rows are complete.

## Operations

- Verify email sending, push notifications, backups, restore rehearsal, and support bundle export.
- Check the System Health panel for failed sync items, financial validation alerts, and device health issues.
- Confirm the Manager PWA and public booking site point at the same production Supabase project as the release.
- Verify pending desktop and Legacy POS queues are clear or intentionally preserved before installing updates.

## Security

- Keep service-role keys out of desktop, PWA, and booking-site environment files.
- Prefer HTTPS external links; local HTTP is allowed only for development loopback addresses.
- Review Electron preload changes carefully because exposed APIs are available to the renderer.
- Sign Windows release artifacts before broad distribution.

## Incident Response

- Capture a support bundle before making manual data repairs.
- Preserve the affected lodge ID, device ID, app version, queue state, and latest backup.
- For sync incidents, avoid manually clearing failed financial items until the server record has been checked.
