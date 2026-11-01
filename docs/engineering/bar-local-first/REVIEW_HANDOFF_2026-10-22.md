# Bar local-first implementation review handoff — 22 October 2026

## Review scope

Review the local export/outbox continuation against `TECHNICAL_PLAN.md`, `AGENTS.md`, the feature matrix, acceptance manifest and current application paths. This checkpoint adds:

- Local migration 0041 for authenticated, business/outlet/authority-epoch scoped `outbox.bundle.get`, including manifest scope/range/hash, event payload-hash and event-to-export-item linkage checks.
- Local migration 0042 for `outbox.status`, replacing its prior unscoped aggregation with current-scope pending/exported counts, watermarks and integrity reconciliation for the 50 most recent batches.
- Modern and Legacy Administration UI for durable bundle creation, unsigned JSON download request, backlog/watermark display, recent batch integrity, and same-batch retrieval after an interrupted download.
- Focused UI, API/database regression assertions, and updated engineering evidence. No customer PDF or guide files were changed.

## Verification completed

- `node --test tests/bar-local/export-workflow-ui.test.mjs` — passed 2/2.
- `node --test services/bar-local/tests/export-unit.test.mjs` — passed 3/3.
- `node --test --test-name-pattern="every registered query has a version and validator" services/bar-local/tests/contract-surface-parity.test.mjs` — passed 1/1.
- `node --test tests/bar-local/modern-client.test.mjs` — passed 31/31.
- `node --test legacy-pos/tests/bar-local-client.test.mjs` — passed 21/21.
- `npm.cmd run legacy-pos:test` — passed 219 source checks + 47 Node tests.
- `npm.cmd run bar-local:typecheck` and `npm.cmd run typecheck:renderer` — passed.
- `npm.cmd run build:hospitality-pos` and `npm.cmd run legacy-pos:build` — passed. Modern retains existing Vite mixed static/dynamic import warnings.
- `node --check services/bar-local/tests/api-advanced-commands.test.mjs` — passed.

## Not independently verified

- API/database tests for retrieval, tenant/outlet/epoch scope, outbox status, event-to-item reconciliation and tampering were added but not executed. `psql` is unavailable in this workspace and `BAR_LOCAL_TEST_DB=1` plus the isolated cluster identity are not configured. The broad contract-surface attempt stopped at its fail-closed isolated-target guard; no database was contacted.
- The new migrations have not been applied in this checkpoint. Review migration ordering/dispatcher ACLs and execute the added DB assertions only against a positively identified isolated local cluster.
- No rendered authenticated service session or actual browser download was exercised. The browser does not report whether the file was ultimately saved; the UI says to confirm it appears in Downloads.
- Only the 50 most recent batches are individually listed/reconciled in the status panel. Aggregate current-scope counts and watermarks cover all rows. End-to-end checkpoint reconciliation, worker crash/replay, cutover/fencing and complete export-history paging remain open.
- Signing, cloud transport, ingestion and acknowledgement remain disabled. No hosted Supabase command, migration, write, deployment, release, customer cutover or push occurred.
- The product remains partial and unqualified. Full-plan work remains in startup/login/domain routing, office-host/LAN installation, host topology/replication/fencing, backup/restore/runtime qualification, further matrix workflows, customer documentation, hardware, load/soak and A01–A32 acceptance.

## Customer guides and worktree

The user explicitly deferred PDF edits. Customer PDF, quick-start, screenshots, approved-manifest and packaged offline-guide work is recorded as pending in `MANUAL_IMPACT.md` and A19; no such files were edited. Do not treat an old approved manual as evidence for the new workflow.

The shared worktree contains unrelated dirty and untracked work, including separate TypeScript migration, company-login, public-domain and property-adaptation changes. Preserve it. No reset, clean, commit, release, deployment or cutover was performed. The current scoped SHA-256 entries are in `CHANGED_FILE_HASHES.csv`; five pre-existing rows for unrelated booking/POS/AdminCentral/Reports files currently differ and were left untouched.

## Review references

- `TECHNICAL_PLAN.md`
- `FEATURE_CONTRACT_MATRIX.csv`
- `ACCEPTANCE_MANIFEST.csv` and `ACCEPTANCE_RESULTS.md`
- `IMPLEMENTATION_REPORT.md`
- `SECURITY_AND_FAILURE_REVIEW.md`
- `MANUAL_IMPACT.md`
- `EVIDENCE_LOG.md`
- `CHANGED_FILE_HASHES.csv`
- `CUTOVER_AND_RECOVERY_RUNBOOK.md`
- `REVIEW_PROMPT.md`

## 22 October 2026 continuation after this handoff was drafted

Migration 0043 and its versioned `loyalty.programs.list` query were added after the initial export handoff. The query authenticates the active device/session, requires `accounting.manage` or `settings.manage` in SQL, rejects filters, and returns only business-global/current-outlet programmes. Both Modern and Legacy allowlists and the shared query registry include it. Operator Owner-facing programme UI was added in both Modern and Legacy after this query contract; see the loyalty administration UI follow-up below.

Additional verification: loyalty query source checks 2/2; export UI plus loyalty plus Modern/Legacy local client suites 56/56; filtered registered-query validator 1/1; `bar-local:typecheck` passed; Modern and Legacy production builds passed. The stale Legacy allowlist count test was updated and passes. `CHANGED_FILE_HASHES.csv` now has 408 entries and 24 current-scope matches with zero mismatches.

No database migration was applied and no DB-backed retrieval/scope/tamper assertions ran because `psql` and the configured isolated target are unavailable. API-level behaviour, customer PDF work (pending by user direction), installed Windows/database/topology, and A01–A32 acceptance remain open. No hosted service was accessed or changed.

## 22 October 2026 loyalty administration UI follow-up

The previous continuation note said programme management UI remained open. It is now wired in both Modern and Legacy owner-only Administration panels. The panels load the authenticated scoped programme query, allow create/versioned update and active-state changes, explain business-wide scope, disable creation when a global programme exists, and fail closed when the read is unavailable. UI source checks are included in `tests/bar-local/export-workflow-ui.test.mjs`.

Verification after this UI change: combined export and loyalty source checks passed 6/6; Modern renderer typecheck, Bar local service/contracts typecheck and Legacy production build passed. The Modern production build passed after the final read-failure guard. No DB-backed migration/API test, authenticated rendered click-through or PDF/manual package check is claimed. Customer guides remain pending at the user's direction.

### Outlet programme creation follow-up

The owner editor now supports creating the first programme for the authenticated outlet as well as creating a business-wide programme. New outlet creation passes only the `outlet_id` returned in the authenticated query scope; the UI prevents a second programme for that outlet. Modern and Legacy render this choice separately from editing existing scoped programmes. Source checks and both product builds/typechecks were rerun after this addition; the database-backed uniqueness/scope flow still requires execution on the guarded isolated PostgreSQL target.

## 22 October 2026 loyalty balance read

Migration 0044 adds `loyalty.account.get`, requiring `customers.manage`, validating a single customer UUID and enforcing the current business scope. It returns the existing ledger-maintained account JSON (or null when the customer is not enrolled) with a checked time, watermark and authenticated scope. Modern and Legacy customer operations panels display the service read and refresh it on customer selection and after enrollment/earn/redeem. Redemption remains server-authoritative at commit. DB regression assertions were added to `db-loyalty.test.mjs`, but cannot be executed until a guarded isolated PostgreSQL target is available.

Source UI/query checks, typechecks and product builds will be recorded after verification. The guide needs to explain the checked time and commit-time revalidation. Customer PDF and offline guide changes remain pending by the user's instruction.

- Migration 0044 and both Modern/Legacy customer panels now expose a timestamped, business/outlet-scoped points-balance read. The UI discards late responses after customer changes and refreshes after enroll/earn/redeem. Displayed balance does not authorize redemption; atomic local commands recheck eligibility. `db-loyalty.test.mjs` adds database assertions, but they were not run because no isolated DB target is configured.
- Verification: focused export/loyalty/client tests 61/61; registered query validation 1/1; Modern renderer and local service/contracts typechecks; Legacy and Modern production builds passed. Full hosted, installed, database migration and physical qualification remain open. Customer PDF and guide work is pending at user direction.

## 22 October 2026 — export commit-group integrity

Migration 0045 replaces the export command's row-level limit with paging over distinct `commit_sequence` values. The configured limit now bounds the number of groups selected, and every event row within each selected group is locked and assigned to the batch. `event_count` can therefore exceed the group limit when one command emits multiple outbox events. This prevents two exports from splitting the effects of one atomic business command.

The guarded API regression now inserts a second fixture event at the same sequence as a real support event, requests `limit: 1`, and expects both events in the resulting batch. Source-contract checks are added. Neither migration 0045 nor the DB regression can be executed until a guarded isolated PostgreSQL target is available. Signing, receiver transport and acknowledgements remain disabled.

The export group pagination regression is now registered in `npm run test:bar-local-contracts`. This is a source/API-test contract runner; the DB-backed API fixture remains separate and guarded.
