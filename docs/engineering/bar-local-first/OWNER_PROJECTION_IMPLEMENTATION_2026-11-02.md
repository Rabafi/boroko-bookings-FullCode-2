# Bar owner projection implementation checkpoint

Updated: 2026-11-03

## Implemented locally

- The existing Manager PWA now contains a directly reachable `#/bar-owner` route and a Bar owner link from the regular login screen. The route bypasses the legacy Manager AuthProvider and uses only the separate owner receiver account. It reads isolated sales totals, daily chart rows, transaction history, stock movements, lot release history, cash-up lifecycle history and the receiver's last-ingested watermark.
- The local Bar sender checks a signed, nonce-bound owner-link status before each upload. A missing, changed, revoked or mismatched link leaves committed work in the local outbox.
- Command Central can request a link against the loopback `local_test` receiver. It persists the receiver identity while keeping upload disabled. The PWA owner must approve the link, and an authorised local operator must enable upload separately.
- The receiver validates link identity, signature, authority/business/outlet scope, bounded request bytes and the exact original JSON bytes used by the local canonical hash. Ingestion is isolated from the local trading database and idempotent by authority/event and batch identity. The receiver TypeScript now typechecks without a file-wide `@ts-nocheck` suppression.
- Receiver read endpoints require the verified owner session and active, non-revoked owner link. The PWA uses exact numeric strings, refuses incomplete projections, and does not read a Supabase financial dataset for these Bar screens.
- A standalone receiver process entrypoint and an example environment file exist. External database connections require certificate validation; public HTTP requires TLS; verification email delivery uses a bounded HTTPS webhook.

## Local verification

Outlet isolation follow-up: migration 0080 binds new sender batches to the outlet that configured the approved owner link; migration 0081 scopes retries of older prepared batches as well. The upgrade regression reproduced a pre-0081 old-outlet retry selection, applied the migration sequence, and confirmed the excluded batch and outbox ownership stay untouched while the approved outlet proceeds. An enabled configuration save from another outlet is refused. Full multi-outlet links and reports remain unsupported.

PWA deadline follow-up: request settlement now races network fetch and body reads against an independent 12-second deadline, cancels the active body reader without awaiting a potentially stalled cancellation, and refuses already-aborted signals before opening a request. `tests/manager-pwa-bar-owner-request.test.mjs` passed **6/6** against a real loopback HTTP server for stalled headers/body, caller cancellation, already-aborted callers, over-limit bodies, and a successful request after timeout. This is Node HTTP coverage, not Chromium/browser qualification.

The 3 November follow-up regression passed `services/bar-local/tests/owner-receiver.test.mjs` **1/1** against a disposable PostgreSQL 17 cluster. It exercises a non-UUID link ID through claim, approve, sales and operations routes; a cash-up review inherits only the original submitted amounts while retaining the reviewer; waste reports delta plus remaining quantity; and lot release is returned as lifecycle history, not a stock movement. Service build/typecheck and Manager PWA production build passed for the follow-up. The ordinary isolated runner reproduced Windows restricted-token error 87 at `pg_ctl start`; the same isolated cluster was started directly and later stopped cleanly using `pg_ctl`. No active Bar database was used. The earlier 9/9/25/25 counts refer to the preceding EV-184/183 checkpoints, not the new regression count.

The ordinary isolated runner was not modified or weakened. Its four-GiB disk gate initially refused at 3.10 GiB. Only stopped `pg-data` children inside `.tmp/bar-isolated-tests/` were removed after checking their recorded PostgreSQL PIDs against live processes; 4.33 GiB was reclaimed while logs and result files were retained.

## Not commissioned

- No hosted receiver or mail webhook is deployed. The receiver SQL is a separate local fixture, not a Supabase migration. Do not point it at the Bar trading database.
- Each owner link is currently restricted to one outlet. The PWA states this limit explicitly. Multi-outlet link/sender checkpointing and owner reports remain a release gate for multi-outlet businesses; do not imply venue-wide coverage from one outlet. Live stock-on-hand, card settlement, broader financial reports/charts and full venue dashboard coverage also remain open.
- Wrong-owner and revoked-link denial, CORS origin denial, signed approval, upload idempotency and retained pending work were exercised locally. The owner route was build-verified, not browser-walkthrough tested in this follow-up. Production TLS, provider mail delivery, installed customer app, internet interruption, multi-device approval and production database isolation were not exercised.
- Local Bar commissioning remains NO-GO until its separate release gates pass.

## Manual impact

Manual impact is required before release: the new owner link on Manager PWA sign-in, standalone owner access route, one-outlet coverage warning, stock-lot history, and cash-up review attribution affect customer navigation and reports. Per the user's direction, PDF edits are skipped for now and are explicitly pending; approved manual/quick-start text, screenshots, manifest checksum and packaged offline-guide verification are not release-ready. Reassess and update the approved guides before enabling owner projection for customers. These deferred guide artifacts do not block this local software checkpoint by user direction.
