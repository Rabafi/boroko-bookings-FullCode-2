# Ship-Ready Runbook

Current financial-truth tip: `20260814080000_security_definer_search_path_hardening.sql`. Docker/Podman are not required to deploy this chain: the linked Supabase Management API path (`supabase db push --linked --yes`) has applied every local migration to the linked project, and `supabase migration list --linked` shows local/remote parity through this tip. Linked SQL lint and error-level security advisors pass. The release is still gated by local disposable PostgreSQL behavior/concurrency tests, authenticated outlet-isolation smoke, policy sign-off, and controlled cutover evidence.

Use this checklist before publishing any Tsa Bonno HospitalityOS product to operators.

## No-Docker migration path

When the workstation cannot host Docker/Podman, use the linked Supabase project
for migration application; this does not require a local Postgres container:

1. `supabase projects list` — confirm the intended linked project.
2. `supabase migration list --linked` — record the local/remote boundary.
3. `supabase db push --linked --yes` — apply the ordered migrations remotely.
4. `supabase migration list --linked` — require every local ID to match remote.
5. `supabase db push --linked --dry-run --yes` — require `Remote database is up to date.`
6. `supabase db lint --linked --level error --fail-on error` — require zero linked SQL errors.

Never run destructive behavioral fixtures against the linked production project.
They still require a disposable PostgreSQL environment (a hosted preview/branch
or a machine with Postgres) and must be separately authorized and isolated.

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
- `npm run test:financial-truth`
- `npm run test:bar`
- `npm run build:hospitality-pos`
- `npm run manager:lint`

Do not publish if any required check is red.

## Bar and Accounting financial-truth gate

The remediation plan is a nine-phase, forward-only migration chain. Before enabling any Accounting or Bar financial-truth change:

- Apply and verify the ordered migrations through the current repository tip (`20260814080000` in this worktree). The no-Docker deployment path is `supabase db push --linked --yes`, followed by `supabase migration list --linked`, `supabase db lint --linked --level error --fail-on error`, `supabase db advisors --linked --level error --fail-on error`, and read-only schema/grant smoke. Migration parity is evidence of database application, not a substitute for behavioral or authenticated authorization sign-off. Exercise account/voucher POS tenders, return/refund reversal, source coverage, signed bank import/match allocation, page-specific exports, payroll statutory approval, source-population completeness, statement cash-flow finality, and AP bill/credit-note/payment flows online and through applicable queue replay only after the new corrections are deployed.
- Run `npm run test:restaurant:disposable` after setting `RESTAURANT_ACCOUNTING_DISPOSABLE_DB=1`; the harness starts Supabase, resets the disposable database, applies the ordered migrations, runs `npm run test:restaurant`, and stops the stack. A missing CLI/Docker runtime, migration failure, or connection failure is a hard no-ship result, not a waiver. Use `RESTAURANT_ACCOUNTING_KEEP_DB=1` only for local debugging, never as release evidence.
- Run authenticated two-lodge/two-outlet behavioral fixtures covering source transaction → subledger → GL → report → export, conflicting idempotency payloads, concurrent mutation, rollback, authorization, RLS, offline replay, cash-up variance, settlements, payroll settlement, tax amendments, bank packets, and period close/reopen.
- Verify `get_restaurant_accounting_readiness` and `get_restaurant_financial_source_coverage` for the target lodge and effective date. No blocking requirement, posting exception, unresolved queue ambiguity, stale tax pack, incomplete report section, or pre-cutover row may be silently treated as zero.
- Exercise every Accounting page's JSON, XLSX, CSV, and PDF export. The first three must contain the complete server dataset; a PDF is acceptable only with its retained detailed companion file and matching report-run/dataset hash. POS history Excel/PDF must fail while orders or voids are cached, pending, failed, or otherwise incomplete.
- Verify the linked database's grants, RLS, functions, triggers, migration history, lint/advisors, and source coverage after deployment. Do not infer live state from local SQL or static tests.
- Obtain recorded policy sign-off for chart mappings, VAT/tax treatment, inventory valuation, vouchers/tips, payroll statutory configuration, cash over/short, settlement fees, period close, and historical cutover.

No-ship conditions include any missing source posting, duplicate or ambiguous financial operation, failed required export section, offline statutory statement, unsigned release artifact, unverified migration deployment, unavailable disposable database, non-zero linked SQL lint error in the affected schema, or missing authenticated production smoke evidence. The operator-facing UI must remain gated and explicitly mark financial data unavailable until these conditions are cleared.

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
