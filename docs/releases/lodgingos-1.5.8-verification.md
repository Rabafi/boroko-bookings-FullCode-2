# LodgingOS 1.5.8 verification — 2026-11-13

Source implementation: `b824fd82`, branch `codex/lodge-event-invoices-20261106`.
Built from the focused isolated release snapshot, excluding unrelated workspace implementation.

- Focused auth/event/invoice/correction tests: 37 passed. Desktop guardrails and public contracts passed.
- Offline queue, POS offline, financial integrity, inventory sync, import, enterprise, release behavior/architecture, financial truth, Lodge blockers and brand checks passed.
- Main and renderer typechecks and final Lodge production build passed.
- Shared web checks passed: Manager lint/build, booking-site tests (75 passed)/build, marketing and public-domain contracts.
- Production dependency audits: zero vulnerabilities in root, Manager PWA and booking site.
- Windows x64 NSIS packaging succeeded using Electron 42.11.18, ABI 146. Packaged native SQLite opened an in-memory database and returned the expected query result.
- Archive metadata: version 1.5.8, name `boroko-bookings`, main `out/lodge-camp/main/index.js`. No `.env` files, unrelated product output, tests, SQL, documentation or scratch folders were packaged.
- Application ID and update feed retained: `com.boroko.bookings`, `Rabafi/boroko-bookings-releases`.
- Authenticode reports `NotSigned` for the executable and installer. Unsigned release explicitly authorized by the publisher.
- Updater YAML version, installer filename, size and SHA512 match the generated installer. Installer SHA256: `cf8056327d31ad7709b8cdc2af52667e62e44b37f920bde92d8bccb46e10a21c`.

Production migration parity was previously verified at 524 through `20261113010000`. This packaging run made no database changes. Historical payment correction remains paused, and unverified agreed event prices remain unresolved. No final customer balance is asserted.

Verification does not include an interactive customer sign-in or real booking mutation from the packaged installer. No Bar installer, PWA or public-site deployment is included.

Release destination: https://github.com/Rabafi/boroko-bookings-releases/releases/tag/v1.5.8
