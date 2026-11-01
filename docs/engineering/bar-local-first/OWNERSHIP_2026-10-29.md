# Bar local-first ownership record - 29 October 2026

The user confirmed Luna has stopped. This record reserves the files and migration
numbers for the six remaining local-first workflows so no concurrent editor or
reviewer has to guess ownership.

## Reserved integration files

These files are edited by the integration owner only:

- `src/main/bar-local/electronRuntime.js` - fixed IPC registration and orchestration hooks
- `src/preload/index.js` - fixed `barLocal` bridge additions
- `src/renderer/src/App.jsx` - local setup entry point only
- `src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx` - panel routing/banner only
- `src/renderer/src/components/hospitality-pos/BarLocalAdminPanel.jsx` - admin workflow mounts only
- `apps/hospitality-pos/electron-builder.json` - server payload packaging

## New feature-owned files

- `src/main/bar-local/serverSetup.js` - automatic server installation/commissioning
- `src/main/bar-local/recovery.js` - recovery status, WAL/PITR orchestration and restore
- `src/main/bar-local/replacement.js` - replacement/switchover orchestration
- `src/main/bar-local/training.js` - isolated training authority switching
- `src/main/bar-local/updates.js` - signed offline update orchestration
- `src/renderer/src/components/bar-local/*` - new feature screens
- `tests/bar-local/server-setup*.test.mjs`, `tests/bar-local/recovery*.test.mjs`,
  `tests/bar-local/replacement*.test.mjs`, `tests/bar-local/training*.test.mjs`,
  `tests/bar-local/updates*.test.mjs`
- `scripts/stage-bar-local-server.mjs`

Existing `services/bar-local/src/operations/*` and `config.ts` remain preserved
Luna edits. New service configuration is additive and must not rewrite those
modules. New admin routes are appended to `services/bar-local/src/admin.ts`.

## Migration reservation

Local migrations `0075` and above are reserved in order:

- `0075` - post-close corrections
- `0076` - training isolation (if database-side objects are required)
- `0077+` - later recovery/replacement work

No hosted Supabase migration, hosted write, cutover, deployment, commit or push
is authorised by this record.
