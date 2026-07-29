# Ship-Ready Runbook

Use this checklist before publishing any Tsa Bonno HospitalityOS product to operators.

## Desktop and shared-contract gate

Run these checks from the repository root:

- `npm test`
- `npm run test:offline-queue-critical`
- `npm run test:offline-pos-critical`
- `npm run test:financial-integrity`
- `npm run test:inventory-offline-sync`
- `npm run test:import-critical`
- `npm run test:release-behavior`
- `npm run test:release-architecture`
- `npm run test:enterprise`
- `npm run test:marketing-site`
- `npm run test:web-surfaces`
- `npm run audit:prod`
- `npm run build`

Do not publish if any required check is red.

## Product release-feed gate

Tsa Bonno LodgingOS is the renamed existing customer application. Its compatibility Windows identity `com.boroko.bookings`, stored-data identity `boroko-bookings`, and update feed `Rabafi/boroko-bookings-releases` are fixed until a tested bridge migration explicitly replaces them. Do not change those values in an ordinary release: LodgingOS updates must install over the existing customer application. Customer-facing installer, shortcut, and uninstall labels use the Tsa Bonno LodgingOS name.

Each standalone product must use both its own Windows application ID and its own public GitHub Releases feed:

- Hotel: `com.boroko.hotel` / `Rabafi/boroko-hotel-releases`
- Restaurant & Bar POS: `com.boroko.hospitalitypos` / `Rabafi/boroko-hospitality-pos-releases`

HotelOS and Restaurant & Bar POS must never publish to the LodgingOS GitHub Releases feed or to each other's feed. Before publishing, run `npm run test:release-architecture` and verify the selected workspace, version, product-specific `out/<product>/` tree, and release repository. Keep production installer packaging serial unless parallel packaging has been separately proved safe, because native dependency rebuilds and packaging resources can still be shared even though compiled Electron outputs are product-isolated.

Run every feature-specific regression script present in `package.json` for the area being released, including customer-credit/reschedule or report-export tests when those changes are part of the release.

For every changed workflow, verify the guardrails as well as the happy path: authorization and business scope, invalid input/state rejection, duplicate/retry behavior, audit or ledger evidence where applicable, clear operator recovery messaging, and the safe result after refresh/restart. Do not release a workflow that merely appears to work while allowing an invalid, duplicated, unauthorized, or untraceable operation.

For offline/sync or mesh changes, explicitly verify the current implementation rather than relying on older audit reports. In this checkout, the desktop queue is JSON/JSONL-backed, the Manager PWA has a limited localStorage queue, and Legacy POS has its own authenticated mesh and queue. A report claiming SQLite sync queues, no idempotency table, or unauthenticated mesh should be treated as stale until proven against current code.

For customer-credit/reschedule releases, manually verify from the packaged desktop installer:

- advance-payment receipt creation without a booking or room hold;
- receipt wording that explicitly says accommodation is not reserved;
- partial and full credit allocation to an existing booking;
- insufficient-credit and excessive-allocation rejection;
- refund and reversal authorization;
- rescheduling into an available room/date range;
- stale/conflicting reschedule rejection;
- lower-priced reschedule overpayment handling;
- disconnected receipt/reschedule queueing and exact-once replay after reconnection;
- reporting classification: receipt is cash in, allocation is non-cash, unused credit is a liability.

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
- For customer credit, test concurrent allocation versus allocation/refund, reversal-once enforcement, booking/customer/lodge consistency, and exact cash-flow classification.
- Do not treat local regression success as proof that the live Supabase project has the matching functions, grants, RLS policies, and migration state.

## Deployment matrix

Record whether each changed surface is built, published, and smoke-tested in [DEPLOYMENT_EVIDENCE_MATRIX.md](DEPLOYMENT_EVIDENCE_MATRIX.md):

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
- Sign Windows release artifacts before broad distribution. Unsigned local installers are development evidence only and are not release-ready.

## Tsa Bonno public-brand release gates

Before publishing any renamed installer or claiming the Boroko → Tsa Bonno migration complete:

1. `npm run test:brand-migration` and `npm run audit:brand:strict` must pass with zero unresolved/blocking brand findings.
2. Packaged product isolation must be proved: each `dist/<product>/win-unpacked/resources/app.asar` contains only its own `out/<product>/` tree, the correct main entry, matching `product.json`, preserved update repository, and official product logo resources. The brand-migration suite asserts this when dist artifacts exist.
3. Windows installer `ProductName` / `FileDescription`, shortcut name, and uninstall display name must be the exact Tsa Bonno product names while app IDs, LodgingOS `boroko-bookings` user-data identity, and update feeds remain unchanged.
4. Code-sign every published Windows installer with a real Authenticode certificate. Do not generate a disposable self-signed certificate and call the release signed.
5. Prove clean-machine install smoke for each product being published.
6. For LodgingOS, prove in-place upgrade over an existing Boroko/LodgingOS install on a **disposable copy** of customer state: user-data directory retained, settings/profiles/offline queues/backups/update channel intact, no HotelOS or POS data imported, no financial operation duplicated or dropped, and installer/shortcut/uninstaller labels become **Tsa Bonno LodgingOS**.
7. Do not rename GitHub updater repository slugs, Netlify compatibility hostnames, Supabase project refs, or database identifiers in the same release that first ships the public brand unless a tested bridge plan says otherwise.

Local branded builds and live web rebrands alone do not satisfy this gate.

## Incident Response

- Capture a support bundle before making manual data repairs.
- Preserve the affected lodge ID, device ID, app version, queue state, and latest backup.
- For sync incidents, avoid manually clearing failed financial items until the server record has been checked.
