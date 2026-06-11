# Ship-Ready Runbook

Use this checklist before publishing Boroko Bookings to operators.

## Release Gate

Run these checks from the repository root:

- `npm test`
- `npm run test:offline-queue-critical`
- `npm run test:offline-pos-critical`
- `npm run test:inventory-offline-sync`
- `npm run test:import-critical`
- `npm run audit:prod`
- `npm run build`
- `npm run manager:lint`
- `npm run manager:build`
- `npm run booking:build`

Do not publish if any required check is red.

## Database

- Confirm the active Supabase baseline is the intended source of truth.
- Keep historical migrations in `supabase/migrations_archive` after baselining.
- Run Supabase database lint/advisors against the target project before production promotion.
- Smoke-test `create_booking`, `create_pos_order`, `void_pos_order`, `validate_app_session`, and public online booking RPCs after migration.

## Operations

- Verify email sending, push notifications, backups, restore rehearsal, and support bundle export.
- Check the System Health panel for failed sync items, financial validation alerts, and device health issues.
- Confirm the Manager PWA and public booking site point at the same production Supabase project as the release.

## Security

- Keep service-role keys out of desktop, PWA, and booking-site environment files.
- Prefer HTTPS external links; local HTTP is allowed only for development loopback addresses.
- Review Electron preload changes carefully because exposed APIs are available to the renderer.
- Sign Windows release artifacts before broad distribution.

## Incident Response

- Capture a support bundle before making manual data repairs.
- Preserve the affected lodge ID, device ID, app version, queue state, and latest backup.
- For sync incidents, avoid manually clearing failed financial items until the server record has been checked.
