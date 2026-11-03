# Bar owner projection implementation checkpoint

Updated: 2026-11-03

## Implemented locally

- The existing Manager PWA now contains the Bar Owner View. It registers and signs in to the dedicated projection receiver, verifies an owner email, creates a one-time Bar connection code, approves or revokes a Bar link, and reads isolated sales totals, daily chart rows, transaction history, committed stock movement history, submitted cash-up records and the receiver's last-ingested watermark.
- The local Bar sender checks a signed, nonce-bound owner-link status before each upload. A missing, changed, revoked or mismatched link leaves committed work in the local outbox.
- Command Central can request a link against the loopback `local_test` receiver. It persists the receiver identity while keeping upload disabled. The PWA owner must approve the link, and an authorised local operator must enable upload separately.
- The receiver validates link identity, signature, authority/business/outlet scope, bounded request bytes and the exact original JSON bytes used by the local canonical hash. Ingestion is isolated from the local trading database and idempotent by authority/event and batch identity.
- Receiver read endpoints require the verified owner session and active, non-revoked owner link. The PWA uses exact numeric strings, refuses incomplete projections, and does not read a Supabase financial dataset for these Bar screens.
- A standalone receiver process entrypoint and an example environment file exist. External database connections require certificate validation; public HTTP requires TLS; verification email delivery uses a bounded HTTPS webhook.

## Local verification

The Bar service build and typecheck passed. Manager PWA typecheck and production build passed; full PWA ESLint completed with 0 errors and 36 existing warnings. The Hospitality POS production build passed. Focused PostgreSQL-backed receiver and sender checks passed 9/9 across cloud sync, body/deadline/retry behavior, duplicate/late-event handling and the owner receiver sale/stock/cash-up projection. Electron runtime and PWA boundary checks passed 25/25. The disposable PostgreSQL 17 cluster was created below `.tmp/bar-isolated-tests/`, launched directly after this machine's `pg_ctl` failed with Windows restricted-token error 87, then stopped cleanly with `pg_ctl`. No active Bar database was used.

The ordinary isolated runner was not modified or weakened. Its four-GiB disk gate initially refused at 3.10 GiB. Only stopped `pg-data` children inside `.tmp/bar-isolated-tests/` were removed after checking their recorded PostgreSQL PIDs against live processes; 4.33 GiB was reclaimed while logs and result files were retained.

## Not commissioned

- No hosted receiver or mail webhook is deployed. The receiver SQL is a separate local fixture, not a Supabase migration. Do not point it at the Bar trading database.
- The local owner projection covers sales, transaction history, stock movement history and submitted cash-up records. It does not report live stock-on-hand or card settlement, and broader financial reports/charts and full venue dashboard coverage remain open.
- Wrong-owner and revoked-link denial, CORS origin denial, signed approval, upload idempotency and retained pending work were exercised locally. Production TLS, provider mail delivery, installed customer app, internet interruption, multi-device approval and production database isolation were not exercised.
- Local Bar commissioning remains NO-GO until its separate release gates pass.

## Manual impact

The local-test Command Central owner-link fields are visible only for the loopback test transport and are not a production customer workflow. Internal manual-impact decision: no approved customer PDF change for this non-commissioned test-only control. Per user instruction, PDF, quick-start, screenshots, manifest checksum and packaged offline-guide updates are pending and are not a blocker for the software changes in this checkpoint. Reassess and update all approved customer guides before any release that enables owner projection for customers.
