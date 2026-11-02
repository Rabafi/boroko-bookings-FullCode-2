# Bar installer recovery — 2 November 2026

## Result

The original saved Rabafi Pub setup now has its local database and Bar service installed. The setup attempt remained `f7fac8c7-f80b-4fbd-97d7-5d8ddba18143`; no new Bar or attempt was created.

- Windows services `BarLocalPostgreSQL` and `BarLocalService` are running.
- PostgreSQL accepts loopback connections on `127.0.0.1:55432`.
- `GET /v1/health/live` returns HTTP 200. `GET /v1/health/ready` returns HTTP 401 until an authenticated device session exists.
- The Bar screen says **Service installed — waiting for the owner sign-in**. The owner must enter the PIN and choose a password in the UI. No credentials were generated or entered.
- The installer log reports the encrypted backup task registered. Task Scheduler enumeration was denied to the restricted verification process; confirm the task through an authorized account before relying on scheduled backups.

## Fixes

The work corrected typed PowerShell parameter binding, PostgreSQL's versioned runtime destination, Windows PowerShell 5.1 atomic replacement, restricted read-only PostgreSQL configuration validation, and the temporary permission needed for fresh `initdb`.

The Windows service wrapper now reads its configured launch options from its process command line. Saved-attempt resume now lets the elevated installer inspect `PG_VERSION`, so the sandboxed app does not accidentally request a second `initdb`. The installer never resets an existing cluster. Reinstallation skips already-correct service image path, account, description and start mode.

## Verification

- Real elevated isolated PostgreSQL initialization and two loopback configuration passes passed.
- Windows service C# wrapper compiled successfully.
- `node --test --test-concurrency=1 tests/bar-local/installer-binding.test.mjs tests/bar-local/server-setup.test.mjs tests/bar-local/setup-status-visibility.test.mjs tests/bar-local/electron-runtime.test.mjs services/bar-local/tests/windows-path-safety.test.mjs`: **47/47 passed**.
- Main-process no-emit TypeScript check passed.
- `npm.cmd run bar-local:verify-stage` verified **1,975 files**.
- `npm.cmd run build:hospitality-pos` passed after the installer and main-process changes.

The first final test run competed with payload verification and timed out in the Windows path test; the serial rerun passed 47/47. The app build reports pre-existing Vite mixed static/dynamic import warnings.

## Pending release evidence

Owner sign-in and an authenticated local trade walkthrough remain pending until the owner enters credentials. The backup task's first execution and restore drill, TLS/LAN pairing, physical multi-PC/hardware qualification, and customer commissioning are not established. The approved manual, quick-start, screenshots, checksums and packaged offline-guide checks remain pending and non-blocking for a software release at the user's direction. Supabase work remains excluded.

The focused source/tests and this recovery note are ready for commit and push. The repository-wide daily focused commit/push rule is in `AGENTS.md`, implementation workflow item 8.
