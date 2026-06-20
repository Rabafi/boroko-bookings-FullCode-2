# Boroko Bookings

Boroko Bookings is a financial-grade hospitality operations platform built around Supabase.

## Applications

- `src/` — main Electron front-desk and administration application.
- `src/main/domains/` — desktop business logic behind the `database.js` facade.
- `manager-pwa/` — manager mobile/web operations application.
- `legacy-pos/` — separate Windows POSReady 7-compatible Electron POS.
- `booking-site/` — public online booking site.
- `marketing-site/` — public product website.
- `supabase/` — database migrations, RPCs, RLS, and backend contracts.

See [PROJECT_STATE.md](PROJECT_STATE.md) for the dated implementation state and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for execution paths.

## Setup

```powershell
npm install
npm run dev
```

Install web or Legacy POS dependencies separately when working on those applications:

```powershell
npm run manager:install
npm run booking:install
npm run legacy-pos:install
```

## Verification

Core desktop and web checks:

```powershell
npm test
npm run test:offline-queue-critical
npm run test:offline-pos-critical
npm run test:financial-integrity
npm run test:inventory-offline-sync
npm run test:import-critical
npm run audit:prod
npm run build
npm run manager:lint
npm run manager:build
npm run booking:build
```

Run feature-specific scripts listed in `package.json` when their area changes. Run `npm run legacy-pos:test` and `npm run legacy-pos:build` for Legacy POS changes.

GitHub Actions currently runs the production guardrails, critical queue/POS suites, dependency audit, desktop build, Manager PWA lint/build, and booking-site build through `.github/workflows/offline-queue-critical.yml`. Local release verification is broader; see [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md).

## Releases

- Desktop package version: `1.5.2`.
- Desktop releases publish to `Rabafi/boroko-bookings-releases`.
- Legacy POS package version: `1.1.0`.
- Legacy POS releases publish separately to `Rabafi/boroko-pos-legacy-releases`.
- Manager PWA, public booking site, and database migrations have independent deployment lifecycles.

The desktop GitHub workflow is `.github/workflows/publish-desktop-release.yml`.

Never infer that a migration is deployed merely because it exists locally.
