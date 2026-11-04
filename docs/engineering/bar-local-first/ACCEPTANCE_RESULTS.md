# Bar local authority acceptance results

## 4 November 2026 — normal Hpos local Menu checkpoint

| Check | Result | Scope and limits |
|---|---|---|
| Local chooser, Menu route, complete menu snapshot and local-default regressions | Passed, 13/13 | Renderer/test contract checks. They do not substitute for Electron IPC transport. |
| Renderer typecheck and Hospitality POS production build | Passed | Production build emitted existing mixed static/dynamic import warnings only. |
| Menu availability and optimistic catalogue versions | Passed, 2/2 | Identity-checked disposable PostgreSQL 17.6, all 81 migrations. Stale product versions were refused and outlet availability was enforced. |
| Stock completeness/FEFO, shift-readiness and tabs/cash-up contracts | Passed, 6/6 | Identity-checked disposable PostgreSQL 17.6; no Rabafi or hosted database. |
| Rendered local Menu create/edit/availability/archive workflow | Passed, 1/1 | Chromium page actions used a test-only `barLocal` bridge to the actual local service HTTP listener and disposable PostgreSQL. This did not run Electron IPC. |
| Shared owner first-use notice and local Electron regression suite | Focused checks passed 6/6; `npm.cmd run test:bar-local-electron` passed 109/109 | The owner notice clears only after successful owner authentication. This does not represent a rendered login against the installed local service. |
| A08 committed-sale recovery after shift close/menu and catalogue change | Passed, 2/2 | Disposable identity-checked PostgreSQL 17.6, all 81 migrations. Same-operation replay retained the original receipt after close/menu unavailability and after price/version change; a new operation on the closed shift was refused; sales and stock effects remained single. Recovery of an originally uncommitted uncertain sale across close remains untested. |
| Daily focused commits | `0925339b`, `7ff4d298`, `5c231cb0`, `35092aca`, `1e6bc7c6`, `3c302fdd`, `3a77eb5f`, `105f78ce` | Focused Bar implementation/evidence commits are local. Push was rejected by automatic review because the configured origin is not verified as a trusted private organization repository; see EV-192 for exact remaining action. |

Local Bar commissioning remains **NO-GO**. Stock and Till continue through local service-backed Bar workspace panels and do not yet use the regular `HposStock`/`HposTerminal` components. Electron IPC/service-transport rendered acceptance, legacy saved-setup migration, broad renderer/workspace isolation, installed Windows/customer qualification, physical multi-PC work and Supabase/hosted work remain open or excluded. PDF and approved guide/package work remains pending by user direction and is non-blocking for this software checkpoint. See EV-191–194 and `NORMAL_HPOS_LOCAL_AUTHORITY_INTEGRATION_2026-11-03.md`.

## 30 October 2026 — continuation verification (supersedes older status for this checkpoint)

| Check | Result | Limit |
|---|---|---|
| Registration guard + replacement client proof | 13/13 passed | Synthetic IPC/client proof; no customer Bar was created. |
| Replacement challenge HTTP tests | 3/3 passed | Real loopback HTTP listener with a fake DB pool; DB permission/migration is covered by guarded suite, not an independent production service. |
| Modern Bar Electron regression | 101/101 passed | Source/runtime tests; not installed service or physical tills. |
| Bar browser UI | 5/5 passed | Installed Chromium with test IPC fixtures; not an authenticated customer service click-through. |
| Modern and Legacy builds; Bar renderer/service typechecks | Passed | Build/source evidence only; no signed package or Windows installer execution. |
| Post-close correction DB integration | 3/3 passed | Fresh guarded loopback PostgreSQL cluster; test directory `.tmp/bar-isolated-tests/2026-10-30T09-26-44-522Z-5735cb5c`. |
| Planned physical replacement/reconnect DB integration | 1/1 passed | Fresh guarded loopback PostgreSQL cluster; test directory `.tmp/bar-isolated-tests/2026-10-30T09-27-59-840Z-fa3cae89`. This synthetic promotion test does not qualify replacement-host restore or multi-PC LAN operation. |
| Complete guarded service suite | **Not green**: 211/245 passed, 34 failed before the 30-minute timeout | One physical PITR runtime-authentication failure, a subsequently fixed replacement-test endpoint argument, and cascading failures because the test promoted/fenced the shared cluster before later DB files. Runner now isolates destructive cases last and uses `--test-force-exit`; the full suite has not been rerun after that change. Logs are retained at `.tmp/bar-isolated-tests/2026-10-30T08-40-22-976Z-fd852f6d`. |

Software completeness remains partial and customer commissioning remains NO-GO. See the 30 October section in `IMPLEMENTATION_REPORT.md` for the feature-by-feature status, exact UI steps and pending work. No hosted Supabase changes or customer cutover occurred. PDF/quick-start/screenshots/approved-manifest/packaged-guide work remains pending by user direction.

Date: 22 October 2026 (Africa/Gaborone)

## Final verification run — 22 October 2026

| Command / check | Result | Scope and limits |
|---|---|---|
| `npm run bar-local:test` | Passed, 132/132 (594.1s) | Fresh isolated PostgreSQL 17.6 loopback cluster at `127.0.0.1:55441`, database `bar_local_test_codex`, explicit cluster-data identity, migrations through `0040`. No hosted target was contacted. |
| `services/bar-local/tests/api-admin.test.mjs` | Passed within the 132-test suite | Real HTTP admin status/replication/update, backup create/list/verify with `pg_dump`, unauthenticated 401, low-capability 403, traversal 400, missing 404, no-standby durability 409, unverified-coordinator switchover 409 and audit rows. |
| `services/bar-local/tests/admin-replication.test.mjs` | Passed within the 132-test suite | Standby enrollment order, durability refusal without a standby, fenced switchover, no-rollback recovery report and unverified-coordinator fail-closed refusal. |
| `npm run test:bar-local-electron` | Passed, 40/40 | Modern runtime/recovery, administration panel, shared tender math, split-tender/tab/operations wiring. Not a live rendered service click-through. |
| `npm run legacy-pos:test` | Passed, 219 source checks + 43 Node tests | Legacy split tenders, tab transfer/split/merge, stock operations, admin/operations panels, runtime, transport and verified-receipt adapter. No installed Windows 7 or physical hardware. |
| `npm run build:hospitality-pos`; `npm run legacy-pos:build` | Passed | Modern build 53.8s; Legacy build 25.1s. Existing Modern mixed static/dynamic import warnings remain. |
| `npm run typecheck:preload`; `npm run typecheck:renderer`; `npm run typecheck:main`; `npm --prefix services/bar-local run typecheck` | Passed | The preload contract now declares the admin methods and request parameters. No broad main-surface claim. |
| `npm run typecheck:main-surface` | Not clean: 5,385 diagnostics | TypeScript-migration baseline (TS7006=1,934, TS2339=1,460, TS18046=488, TS18048=473, others). Sidecar: `docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-22T11-20-26-869Z.jsonl`. This is not a pass. |
| PowerShell parser over 9 packaging `.ps1` files; `node --check services/bar-local/scripts/provision-local.mjs` | Passed | Source syntax only. No installation, service start, scheduled task, standby enrollment or hardware test. |
| `git diff --check` | Passed | Existing CRLF normalization warnings only. |

This continuation validated the admin backup route against a disposable PostgreSQL target using both the manifest checksum and AES-GCM authentication with the configured key, made database status/backup-directory/audit-write errors visible, and persisted switchover reason plus start/result audit entries. The Modern and Legacy readiness views distinguish current ready, blocked, stale, unknown and unavailable states, and admin panels distinguish an unavailable backup folder from an empty backup set. The isolated database was created specifically for this run; no hosted migration or database write occurred.

## Follow-up UI and tender boundary verification — 22 October 2026

| Command / check | Result | Scope and limits |
|---|---|---|
| `node --test tests/bar-local/readiness-status.test.mjs` | Passed, 2/2 | Modern current/blocked/stale/unknown/unavailable states and readiness-gated action behavior. |
| `node --test legacy-pos/tests/bar-local-readiness-ui.test.mjs` | Passed, 2/2 | Legacy readiness states and fail-closed action behavior. |
| `node --test tests/bar-local/tender-workflows.test.mjs` | Passed, 13/13 | Money/tender math, explicit local-only provider status, room-charge refusal, and refusal of crafted provider-confirmed input. |
| `node --test legacy-pos/tests/bar-local-operator-workflows.test.mjs` | Passed, 10/10 | Legacy local-only tender UI, room-charge refusal, tabs and stock workflow regressions. |
| `node --test tests/bar-local/admin-response.test.mjs` | Passed, 2/2 | Modern admin panel unwraps service status/replication envelopes and reads the service's `packages` list shape. |
| `npm run typecheck:renderer` | Passed | Modern renderer project typecheck after tender UI changes. |
| `npm run build:hospitality-pos`; `npm run legacy-pos:build` | Passed | Rebuilt after both admin and tender UI changes. Modern reports existing mixed static/dynamic import warnings. |
| `npm run build --prefix services/bar-local` | Passed | Service/contracts TypeScript build. |

Both tender editors now state that external tender status is locally asserted and provider authorisation/settlement is not verified. The client rejects a crafted `provider_confirmed` status; SQL already rejects provider-confirmed claims from the local authority. Room charge is visibly unavailable and refused before submission because it requires the hotel authority. UI/evaluator regressions passed 13/13 Modern and 10/10 Legacy, including checks that the controls do not offer provider confirmation and cannot complete room charges. The Modern admin response adapter also has 2/2 shape tests; the renderer/API+database path was not exercised in this follow-up. No PDF or other customer guide file was edited.

Acceptance disposition:

- **A03 - Verified and reverified.** The 100-identical-request HTTP regression ran in the 132-test suite: one operation/sale/receipt, 99 exact replays, changed payload refused and stock depleted once.
- **A16, A21, A24, A28, A29 - Partial.** Source and tests now cover packaging/scripts, split tender and Legacy operations, admin backup/verification, administration panels and update preflight. Installed service lifecycle, signed release, replacement-host restore, physical hardware and Windows 7 qualification remain open.
- **A22, A23, A25, A30, A31, A32 - Not run.** Coordinator selection, three-host partition tests, power/maintenance, rehearsal authority and replacement-host workflows remain unavailable.
- **A19 - Pending user direction.** No PDF, quick-start, screenshot, approved-manifest or packaged-guide file was edited.
- Feature matrix: **64 rows - 28 locally implemented, 35 partial, 1 external pending, 0 not implemented.** `locally_implemented` remains source/service evidence only.

This is a source/build checkpoint, not customer commissioning or release approval. The full acceptance IDs and current gates are in `ACCEPTANCE_MANIFEST.csv`.

Current SHA-256 values for this continuation are in `CHANGED_FILE_HASHES.csv`; the dated 21 October continuation manifest remains historical. The shared checkout remains dirty with unrelated TypeScript-migration, website and Legacy company-login work; those changes were preserved, and no clean/reset, commit, push or release was performed.

## Executed in this continuation

### Latest cashier promotion and discount-policy continuation

| Command | Result | Scope and limits |
|---|---|---|
| `npm.cmd test` from `services/bar-local` | Passed, 113/113 | Isolated PostgreSQL 17.6 loopback cluster, explicit cluster data-directory identity, dedicated test database/roles, migrations through 0038. No hosted database was contacted. |
| `node --test tests/db-menu-modifier-config.test.mjs` with the guarded local target | Passed, 1/1 | Manager can inspect all definitions; a `pos.view` session can query business-scoped, currently active promotions and exact discount policy; future promotion is excluded from cashier results; caller scope remains server-owned. |
| `npm.cmd run test:bar-local-electron` | Passed, 26/26 | Estimate, runtime/recovery and static shared Modern/Legacy cashier/settings regressions; not a live renderer or DB click-through. |
| `npm.cmd run legacy-pos:test` | Passed, 219 source checks + 30 Node tests | Local client/runtime/receipt behavior included; no installed Windows 7 or physical-printer qualification. |
| `npm.cmd run build:hospitality-pos`; `npm.cmd run legacy-pos:build` | Passed | Both current Modern/Legacy workspaces compile with promotion and discount-policy panels. Modern build retains existing mixed static/dynamic import warnings. |
| `npm.cmd run typecheck:renderer`; `npm.cmd run bar-local:typecheck` | Passed | Modern renderer and strict Bar service/contracts checks. Does not qualify installer or live operation. |

| Command | Result | Scope and limits |
|---|---|---|
| `node --test tests/bar-local/cash-estimate.test.mjs tests/bar-local/modern-client.test.mjs` | Passed, 31/31 | Includes modifier-adjusted estimate and required-selection checks plus exact-scope/hash approvals for local correction and cash-up workflows. No live UI/database interaction. |
| `npm.cmd run test:bar-local-electron` | Passed, 21/21 | Modern authority runtime/profile/journal/IPC/recovery and display-estimate tests. No live service, rendered interaction, Windows secure storage or installed client. |
| `npm.cmd run legacy-pos:test` | Passed, 219 regression checks + 30 Node tests | Legacy regressions, local client/runtime, transport and IPC fence, including exact multi-line return/void/cash-up review/reopen approval binding and verified-receipt adapter cases. No physical printer or installed Windows 7 qualification. |
| `npm.cmd run build:hospitality-pos` | Passed | Modern main/preload/renderer compiled. Existing mixed static/dynamic import warnings remain. No installer or click-through exercise. |
| `npm.cmd run legacy-pos:build` | Passed | Legacy main/preload/renderer compiled. No packaged service runtime or target hardware exercise. |
| `npm.cmd run typecheck:main` | Passed | Modern main-process types pass; no claim about Windows runtime behavior or an installed service. |
| `npm.cmd run typecheck:renderer` | Passed | Modern renderer TypeScript project passes. Legacy renderer is covered by its production build, not this Modern typecheck project. |
| `node --test tests/bar-local/export-workflow-ui.test.mjs` | Passed, 2/2 | Modern and Legacy admin source checks confirm local command/query wiring, complete unsigned bundle checks, local-only/no-ack guidance and same-batch recovery. No browser download was exercised. |
| `node --test --test-name-pattern="every registered query has a version and validator" services/bar-local/tests/contract-surface-parity.test.mjs` | Passed, 1/1 | Confirms the registered export query has a version and accepted validator. The DB-backed command-routing case was not selected. |
| `node --test services/bar-local/tests/export-unit.test.mjs` | Passed, 3/3 | Deterministic bundle, payload/manifest hash verification and unsigned/disabled signing boundary. Unit evidence only. |
| `node --test services/bar-local/tests/contract-surface-parity.test.mjs` | Failed closed at isolated-target guard | Seven selected/non-DB checks passed, but the DB-backed HTTP routing test requires `BAR_LOCAL_TEST_DB=1` plus the isolated target configuration, which is unavailable in this worktree. No database was contacted. |
| `node --test tests/bar-local/modern-client.test.mjs`; `node --test legacy-pos/tests/bar-local-client.test.mjs`; `node --test legacy-pos/tests/bar-local-operator-workflows.test.mjs` | Passed, 31/31; 21/21; 11/11 | Current Modern/Legacy adapter contracts and Legacy operator workflow suite. No live export service or rendered UI interaction. |
| `npm.cmd run build:hospitality-pos`; `npm.cmd run legacy-pos:build` | Passed | Modern and Legacy production application builds. Modern emitted existing mixed static/dynamic import warnings. No installer or packaged service verification. |
| `npm.cmd run legacy-pos:test` | Passed, 219 source checks + 47 Node tests | Full current Legacy regression/client/runtime/operator suite after the export status UI addition. No live local service or packaged-device behavior. |
| `npm.cmd run bar-local:typecheck` | Passed | Contracts package build and Bar local service TypeScript check pass; no isolated database integration tests were run. |
| `node --test services/bar-local/tests/contract-menu-availability.test.mjs` | Passed, 2/2 | Includes catalogue update validation requiring a positive expected product version. |
| `node --test services/bar-local/tests/contract-audit-search.test.mjs` | Passed, 1/1 | Confirms the local audit query is read-only, requires settings management and rejects unsupported filters. |
| `npm.cmd run legacy-pos:test` (after adding the local Audit panel) | Passed, 219 source checks + 30 Node tests | Includes local client/runtime and authenticated transport checks; no authenticated audit-panel click-through. |
| `npm.cmd run build:hospitality-pos`, `npm.cmd run legacy-pos:build`, `npm.cmd run typecheck:renderer` (after adding the local Audit panel) | Passed | Both local workspaces compile; no installed service verification. |
| `npm.cmd run typecheck:renderer`, `npm.cmd run build:hospitality-pos`, `npm.cmd run legacy-pos:build`, `npm.cmd run test:bar-local-electron` (after adding local stock/cash-up reports) | Passed; local Electron 21/21 | Both local report panels compile and Modern runtime regressions pass; live local report requests were not exercised. |
| `npm.cmd run typecheck:renderer`, `npm.cmd run build:hospitality-pos`, `npm.cmd run legacy-pos:build`, `node --test services/bar-local/tests/contract-audit-search.test.mjs` (after adding local support entry) | Passed; contract tests 2/2 | Both local forms compile; the existing DB/API report-redaction tests were not rerun in this continuation. |
| `npm.cmd run legacy-pos:typecheck` | Not a package script | No such script is defined. Legacy renderer is covered by the Legacy production build and test suite. |
| `git diff --check` | Passed | No whitespace errors in tracked diffs; Git may report configured CRLF normalization warnings. |
| Fresh isolated PostgreSQL 17.6 cluster + `db-drawer-movements.test.mjs` | Passed, 1/1 | Applied all 33 local-only migrations; verified paid-out and float movements write one ledger/audit row each, update expected cash correctly, and replay the original receipt without duplication. Temporary loopback-only cluster stopped after the run. |
| Fresh isolated PostgreSQL 17.6 cluster + `db-menu-availability.test.mjs` | Passed, 1/1 | Applied all 33 local-only migrations; verified outlet availability, stale-version refusal, sold-out sale refusal, reactivation, and audit rows. Temporary loopback-only cluster stopped after the run. |

Earlier service/database evidence remains dated in `EVIDENCE_LOG.md`. It includes 96/96 isolated service tests against the test cluster available at that checkpoint; it is not a fresh run against a customer install and does not qualify the current host/service lifecycle.

The 4 November catalogue, stock, shift-readiness, tabs/cash-up and sale-replay tests ran against explicitly identified disposable loopback PostgreSQL clusters bootstrapped through all 81 local migrations; see EV-191 and EV-194. The full isolated PostgreSQL/API suite was not rerun. Existing modifier SQL/API evidence remains dated evidence, not proof of a live UI click-through.

## Acceptance status summary

The feature matrix contains 64 rows: 28 locally implemented, 35 partial, 1 external pending and 0 not implemented. Both dedicated Bar workspaces now include versioned menu editing, outlet availability, modifiers/recipes, promotions and approval policy, multi-line returns, full-sale voids, cash-up review, drawer movements, audit/support, reports, split/non-cash tenders, local administration, backup/replication/update status and the manager-approved Legacy operational/admin panels. The matrix remains partial because installed renderer/database qualification, coordinator/switchover, hardware, power-loss, soak and customer cutover have not run; some add-on domains also remain service-only.

- **A01 — Partial.** Modern owner/setup and join forms, local login, cashier/menu setup, sales, tabs, stock, cash-up, receipt view and pairing-code settings exist. A supported service/PostgreSQL installer and air-gapped end-to-end commissioning are absent.
- **A03 — Verified and reverified.** The 100-identical-request HTTP regression passed in the 132-test run: one operation/sale/receipt, 99 exact replays, changed payload refused and stock depleted once.
- **A04, A11, A20, A22, A23, A25, A29–A32 — Not run or not implemented.** Process/power fault matrix, long soak/load, coordinator/replication, service lifecycle and signed update/recovery proof remain open.
- **A16, A21, A24, A26–A28 — Partial.** Client UI/build paths exist, including Legacy verified-receipt printing and readiness gating. Installed runtime, printer, backup destination, reboot and multi-PC qualification remain open.
- **A19 — Pending by user direction.** PDF, quick-start, screenshot, approved document-manifest and packaged-guide edits/checks have been deferred. The engineering manual-impact assessment is recorded; no guide approval is claimed.
- **Other A02, A05–A10, A12–A15, A17–A18 — Partial/not run.** See the manifest for per-ID evidence and exact remaining gates.

## Explicit release boundary

Windows PowerShell/C# service and PostgreSQL lifecycle source exists, but no packaged offline installer was produced or qualified; the server must already be installed and running before Modern first-owner setup can work. No production deployment, hosted write, customer cutover, signed release or hardware qualification occurred. The feature matrix remains the authoritative list of locally offered Bar workflows not yet wired to application callers.

## 22 October continuation — Legacy loyalty customer actions

The Legacy customer panel now connects enrollment, sale-linked earning and referenced points redemption to the local service command bridge; Modern already exposes the same commands with recent-sale selection. Verification: `node --test tests/bar-local-operator-workflows.test.mjs` from `legacy-pos` passed 11/11; `npm run build` from `legacy-pos` passed; root `npm run typecheck:renderer` passed. Neither UI infers a balance as authority, and redemption is not represented as sale payment/discount. This is a source/build check only: no live service interaction was exercised, current-balance reads and programme management remain open, and A19 guide edits remain pending at user direction.

## 22 October continuation — Modern/Legacy export save workflow

Modern and Legacy Administration panels now invoke the stable local `export.bundle.create` command, retrieve by its confirmed batch ID through `outbox.bundle.get`, check complete bundle metadata and explicit unsigned/transport-disabled status, and request a JSON download locally. They also show current-scope outbox counts and watermarks, validate recent batch integrity, and pause new exports when status is unavailable or integrity fails. The last confirmed ID is retained for another read if download/retrieval fails. SQL reads check the outer canonical manifest digest, event payload hashes and batch-item linkage; API/DB regression assertions cover payload-hash mismatch with a recomputed outer digest and the reconciled status envelope. Focused source-contract checks passed 2/2, Modern renderer typecheck passed, and Modern/Legacy product builds passed. The export API/database assertions remain unrun because the guarded isolated PostgreSQL target is not configured; no live service or browser download was exercised. Signing, hosted transport, upload/acknowledgement, worker replay and cutover reconciliation remain open. The user asked to defer all PDF/document edits; A19 and customer guide, screenshot, approved-manifest and packaged-guide work remain pending.

## 22 October continuation — scoped export bundle retrieval

Added the `outbox.bundle.get` query to the versioned contract, Modern and Legacy client allowlists, and local migration 0041. It requires `export.manage`, scopes by authenticated business/outlet/authority epoch, verifies the canonical manifest hash and event count, and never acknowledges or deletes exported events. Shared bundle verification also checks each event payload hash. Modern and Legacy admin panels now create a bundle through their durable local command bridge and request a JSON download only after the authenticated query returns a complete unsigned bundle with hosted transport disabled. Bundle retrieval API/DB assertions were added to `api-advanced-commands.test.mjs`; they remain unrun because the guarded isolated PostgreSQL target is not configured. The service/contracts build, query validator, export unit tests, Modern/Legacy client tests, UI contract tests and both product builds passed. A live API/DB result and actual browser download remain unverified; signing, worker and checkpoint reconciliation remain open. Customer PDF work remains pending per user direction.
