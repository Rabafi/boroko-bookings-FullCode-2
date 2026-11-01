# Bar local implementation takeover checkpoint — 26 October 2026

**Historical checkpoint superseded by TAKEOVER_LATEST_2026-10-26.md.** In particular, the earlier disk threshold and full-suite/typecheck descriptions below are historical, not current results.

Status: implementation incomplete; customer commissioning remains NO-GO. This is an implementer's verification record, not independent approval. The 20 October review remains historical.

## Repairs since takeover

- Fresh local migration 0041 parsing repaired. Local migrations 0048–0050 normalize drawer replay receipts, complete stock/lot pagination and enforce durable financial commits. Migration history checks and application share a session advisory lock to prevent concurrent installer races.
- Modern login no longer requires an authenticated readiness result before authentication. Blank-catalogue commissioning and safe reads can proceed while new financial work remains guarded. Receipt recovery retains the original operation ID.
- The HTTP command reply includes the operation identity required by the actual Legacy client. Both client query allowlists include lot/expiry reads.
- Modern and Legacy stock screens load complete, scope-checked paginated snapshots. Concurrently changing snapshots restart once and then fail visibly rather than mix rows. Lot quantities explicitly describe receipt history, not remaining lot balances.
- Both journals protect PIN-bearing staff commands with OS secure storage before append. Existing plaintext credential records are atomically replaced only after validation and successful protection. Missing keys preserve the original file. Modern journal recovery now retains a complete final record without a newline; complete invalid or undecryptable records fail closed.
- Synchronous replication uses `ANY 1 (*)`. Controlled switchover validates candidate durability settings, records promotion truthfully even if a later step fails, and uses local commit only for the administrative configuration connection to avoid waiting indefinitely for a new standby. Trading connections retain synchronous commit.

## Executed evidence

The disposable targets below were created for this work, never hosted Supabase or application databases. Evidence paths are retained under ignored `.tmp`; they are not customer installation evidence.

| Check | Result and limits |
| --- | --- |
| Modern Electron/renderer regression aggregate, rerun 26 October | 50/50 passed using `npm run test:bar-local-electron`; includes both journal implementations, plaintext credential upgrade, complete-list guards and renderer recovery. |
| Main TypeScript checking, rerun 26 October | `npm run typecheck:main` passed. This does not establish that all broad migration checking is clean. |
| Previous takeover affected builds | Modern hospitality-pos and Legacy builds passed; saved results in `.tmp/bar-takeover-20261023/checks-results.json`. |
| Actual Modern and Legacy HTTP clients | Passed against owned disposable PostgreSQL: first login, setup, sale, lost reply, journal reopen and original-ID recovery; exactly two sales and expected stock. Loopback HTTP is not installed TLS or Windows 7 qualification. |
| Concurrent migrations | Two actual clients on a fresh disposable database applied each migration once. Focused test passed. |
| Physical streaming and controlled switchover | Two PostgreSQL processes passed, matching five committed receipts before and after promotion; `.tmp/bar-takeover-20261023/replication-proof-2.json`. Same-machine evidence only. Automatic failover and continued trading without another synchronous replica are not proven. |
| Full fresh isolated suite, 23 October | **Failed: 100 passed, 43 failed of 143.** PostgreSQL PANIC reported no disk space at 12:00:42 host log time; subsequent cases encountered recovery mode. Do not treat the later failures as independent product defects or the suite as passing. Logs: `.tmp/bar-isolated-tests/2026-10-23T09-48-46-305Z-30ba4a93/`. |
| Full-suite retry, 26 October | Safely refused before initialization: approximately 7.18 GiB free, below the new runner's 8 GiB preflight requirement. No database initialized. Threshold is test headroom, not a product hardware specification. |

## Remaining work and release gates

Full database verification must be rerun after storage headroom is available. Preserve the failed-run logs. Do not reset an existing application database or delete another chat's active fixtures to make room.

Automatic coordinator/quorum/fencing support on the intended Windows deployment is unselected/unqualified. Installed service lifecycle, supported replica enrollment and replacement, independent backups/PITR, safe host replacement, paired receiver-confirmed cash handover, remaining feature-matrix workflows, actual two/six-device recovery, Windows 7, printers/drawers, power interruption, load and eight-hour soak remain incomplete or unverified. Source and simulated tests cannot establish those results.

The original A01–A32, work packages and feature matrix remain the acceptance scope; this checkpoint does not upgrade their status wholesale. A full current coverage reconciliation and later independent review are still required. Customer PDFs, quick-start, screenshots, approved manifest and packaged offline-guide verification remain deferred by the user and block release. Hosted financial ingestion stays disabled. No hosted changes, cutover, release, commit or push performed.
