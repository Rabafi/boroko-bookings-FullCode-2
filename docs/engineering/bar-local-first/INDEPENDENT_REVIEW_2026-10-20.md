# Independent review — Bar local authority — 20 October 2026

**CHANGES REQUIRED. Source incomplete; financial/security approval and customer commissioning are NO-GO.**

The implementation chat “Finish Bar local-first” (01a158f2-c8e3-7fd3-a7c8-567ce4a2310f) stopped on a usage-limit error. This is review of its interrupted checkpoint, not a completed delivery.

Repository: C:/Users/Botswapelo Studios/Documents/Work/Tsa Bonno HospitalityOS.
HEAD: 36089433660567cd37859cfb37d86fdcd05175fc, with substantial uncommitted implementation and unrelated TypeScript/Legacy login changes. No product source fixes, commits, pushes, releases, hosted operations or customer cutover were performed by this review.

Read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md, the technical plan and both prompts, author report/security review, dependency inventory, matrices, evidence, manual-impact record and cutover runbook. Traced actual Modern/Legacy startup, workspaces, transports, journals, service dispatch/auth, all 25 local migrations and recovery helpers.

Companions:
- INDEPENDENT_ACCEPTANCE_2026-10-20.csv: all A01–A32.
- INDEPENDENT_FEATURE_COVERAGE_2026-10-20.csv: all 63 current feature rows.
- REMEDIATION_PROMPT_2026-10-20.md: concrete correction/completion assignment.
- evidence/independent-review-2026-10-20/: independent probes, results, logs and hashes.

The author's 171-row CHANGED_FILE_HASHES.csv was initially stale for five Bar files (matrix, report, manual-impact and both workspaces). At final capture it has eight mismatches: concurrent TypeScript work also changed its status file, src/main/index.js and Bookings.jsx. See author-manifest-check.json. This is a shared changing checkout, not an atomic frozen snapshot; command results describe their execution-time state. The independent manifest records final inspected bytes. Bar SQL/contract/workspace findings were rechecked; final main startup references are lines 4652/4675. Rerun affected checks after subsequent edits. Existing author evidence was preserved.

## Independently executed checks

Created a fresh PostgreSQL 17.6 cluster at .tmp/bar-local-independent-review-20261020/pg-data, bound to 127.0.0.1:55461; dedicated database bar_local_test_independent_review, explicit cluster identity, dedicated migrator/runtime roles, BAR_LOCAL_TEST_DB=1. The author's port-55441 cluster was not used. Schema resets were restricted to this new cluster. Durability settings were explicitly enabled, without claiming physical hardware qualification.

| Check | Actual result | Limits |
|---|---|---|
| npm run bar-local:test | 64 passed; 0 failures/skips; 160.648 s | Rebuilt service/contracts, all 25 migrations; real HTTP identical-key concurrency. |
| Independent DB probes | Five conservation/permission expectations failed | Real validated service command layer and SQL; synthetic fixtures. Recipe configuration used its SQL function because its HTTP contract is missing. |
| Signed-out JSX rendering | Modern throws; Legacy renders | Actual bundled components and React server rendering; not installed Electron. |
| Unknown-sale JSX probes | Both clients generated a second ID for the unchanged cart | Compiled components with synthetic hooks/transport; not physical crash qualification. |
| Legacy real HTTP refusal | Terminal refusal journaled as uncertain | Actual loopback service, test session fixture. |
| Legacy wrong-authority receipt | Accepted as committed | Synthetic adversarial transport, actual client/journal. |
| Real encrypted pg_dump/pg_restore | Copy/restore mechanics succeeded | New empty bar_local_test_independent_restore database on the review cluster; not replacement hardware/PITR. |
| Restore verification | Falsely returned verified | Existing tender mismatch and missing runtime access escaped checks. |
| bar-local:typecheck; typecheck:main | Passed | Does not establish renderer/runtime correctness. |
| test:bar-local-electron | 12/12 passed | Main/runtime/estimate tests miss initial signed-out render. |
| legacy-pos:test | 219 source checks + 17 Node tests passed | Misses real response-contract defects. |
| legacy-pos:build; build:hospitality-pos | Passed | Compilation, not installed qualification. |
| Lodging build; hotel product build | Both passed | npm run build; node scripts/product-app.mjs hotel build. Live cloud contracts not fully qualified. |
| test:typecheck:renderer-ipc | Failed | Full diagnostics retained. |
| test:bar-guides | 10 pass, 1 fail, 1 skip | Manual checksum mismatch; package-directory check skipped. |
| test:preload-api; test:preload-transport | Both failed | Frozen fixtures/API mismatch; attribution not established. |
| test:bar | 809 tests: 786 pass, 17 fail, 6 skip | Full log retained; guide/source/retry/stock/hardware/rendered recovery failures. |
| test:release-architecture | Passed | Source regression only. |
| test:release-behavior | Failed | Old direct-RPC source assertion; attribution not established. |

Probe programs exit zero when evidence collection completes: JSON pass=false is a reproduced product defect, not acceptance success. No failed assertion was rewritten or waived. Logs/command exits are retained; build warnings are not release qualification.

## Confirmed defects

### F01 — P1 — Modern local login crashes before rendering
Source: src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx:72.
Initial session is null. canManageMenu reads session.staff before the signed-out return. React rendering throws “Cannot read properties of null (reading 'staff')”; a restarted configured till cannot reach login.
Evidence: ui-and-contract-probes.json, modern initial signed-out render.
Fix: safe initial/logout access and real rendered startup/login/logout regressions.

### F02 — P1 — An unknown sale leaves fresh submission enabled
Sources: Modern workspace:85–115,210; Legacy workspace:83–103 and Commit cash sale button.
Both keep the cart/pending intent but clear busy. The normal commit button generates a fresh UUID and overwrites pending state. If the first sale committed before losing its reply, a normal second click creates another sale/depletion. Same-key idempotency does not protect different keys. Logout/other mutations and restart also hide recovery state: pending starts null; a count is not an operator recovery workflow.
Evidence: actual compiled component probes produce two different IDs for one unchanged cart after unknown outcome in both clients.
Fix: bind basket to durable intent through resolution, fence re-key/unsafe edits/switches, restore unresolved work visibly after restart; exercise actual crash/lost-reply windows.

### F03 — P1 — Refund tender allocation loses residual pennies
Source: services/bar-local/db/migrations/0005_operations.sql:103–113 (latest reverse_sale).
Independent rounding of proportional tender shares never assigns the residual. A 0.03 sale paid 0.01 cash/card/bank, followed by a 0.01 return, commits total=-0.01 with tender_total=0.
Evidence: database-probes.json.
Fix: deterministic minor-unit allocation bounded by remaining original tenders, exact sum assertion before commit.

### F04 — P1 — Repeated partial returns exceed the original payment
Source: services/bar-local/db/migrations/0005_operations.sql:54–57.
Each return rounds original net/tax times current quantity ratio without cumulative monetary limits. Three 0.01 units discounted by 0.01 cost 0.02; three accepted one-unit returns refund 0.03.
Evidence: database-probes.json, refunds [-0.01,-0.01,-0.01].
Fix: locked cumulative remaining net/tax/discount/tender allocation, final residual handling and concurrent/fractional/mixed-tender tests.

### F05 — P1 — Recipe returns restore the wrong stock
Source: services/bar-local/db/migrations/0005_operations.sql:58–70; compare final depletion in migration 0020.
Recipe sales consume snapshotted ingredients, but returns always add the finished product. Ten finished and ten ingredient units become eleven finished and eight ingredients after one recipe sale and full restock return.
Evidence: database-probes.json.
Fix: compensate actual immutable original depletion/UOM/recipe movements under the approved restock/waste policy; never invent finished stock or use today's changed recipe.

### F06 — P1 — Cashiers bypass discount permission
Source: services/bar-local/db/migrations/0020_menu_modifiers_recipes_promotions.sql:1310–1323.
Final sale checks pos.manage but accepts discount_amount without pos.discount/approval. Standard cashier capabilities omit pos.discount. A restricted cashier committed a 10.00 product for 1.00 with a 9.00 discount through the validated service command.
Evidence: database-probes.json.
Fix: enforce applicable capability, approval and limits in SQL/service for counter/tab/promotion paths, including direct bypass attempts.

### F07 — P1 — Staff administration escalates to owner
Source: services/bar-local/db/migrations/0005_operations.sql:897,909–925.
An operator with only staff.manage can choose role=owner or capabilities beyond their own. The independent probe created an owner with settings/accounting-approval/backup/export authority; no nondelegable-role/ceiling check exists.
Evidence: database-probes.json.
Fix: explicit privileged-role/delegation policy and owner/independent proof where required; enforce capability ceilings and real API negatives.

### F08 — P1 — Advanced SQL domains are unreachable through the API
Sources: packages/bar-contracts/src/registry.ts; services/bar-local/src/commands.ts:18–69; Modern allowlists.
SQL/tests implement recipes/promotions/loyalty/tips/extended Accounting, but production getCommand rejects catalogue.recipe.set, promotion.upsert, loyalty.points.earn, workforce.tip.allocate and accounting.ap.invoice.upsert. SQL tests invoke h.call directly, bypassing validator/dispatch.
Evidence: ui-and-contract-probes.json and registry/SQL test inspection.
Fix: exhaustive versioned registry, derived mappings/validators/results/client allowlists and real HTTP coverage for every offered function; no generic SQL proxy.

### F09 — P1 — Legacy converts terminal refusals into unknown outcomes
Source: legacy-pos/src/main/bar-local/client.js:378–396.
Client expects top-level operation_id/retry_same_operation. Actual service returns outcome=refused and error.retry_same_operation=false. Real insufficient-stock refusal becomes journal state uncertain and outcome_unknown=true.
Evidence: legacy-service-probes.json, actual loopback HTTP command.
Fix: consume actual versioned refusal shape, retain correlation and distinguish terminal recording from pre-commit denial/transport ambiguity; add real service/client tests.

### F10 — P1 — Legacy accepts wrong receipts as committed
Sources: legacy-pos/src/main/bar-local/client.js:374–376; intents.js:571–575.
Any 2xx ok/committed_local response becomes terminal without validating operation, authority, epoch, scope or commit sequence. An adversarial response with different operation/authority and epoch 99 was accepted; missing receipt can be stored null.
Evidence: legacy-service-probes.json.
Fix: shared strict outcome/receipt validation; malformed/wrong receipts remain unknown with original intent retained. Modern's stronger checks must apply to Legacy.

### F11 — P1 — Restore verifier falsely approves inconsistent finance
Source: services/bar-local/src/operations/backup.ts:1480–1500,1623–1627.
Checks inspect internal sale arithmetic and existing journal balance, not sale/tender conservation, cumulative reversal limits, required source-to-GL coverage or actual service authentication. Real restored F03 mismatch passes every check as verified; zero GL rows vacuously pass.
Evidence: real-backup-restore.json: verified, but independent tender mismatch count=1.
Fix: independent financial/source/stock/receipt/outbox/runtime invariants and real negative restore fixtures; refuse these known corrupt examples.

### F12 — P1 — Restored runtime loses access
Source: services/bar-local/src/operations/backup.ts:1278–1287,1295–1342.
pg_restore --no-owner --no-privileges is followed by no trusted security restoration stage. Fresh restore has runtime schema_usage=false, yet verifies green. Default function execution also differs from original revocations/allowlisted grants.
Evidence: real-backup-restore.json, runtimePrivileges.
Fix: controlled ownership/roles/default privileges/exact grants restoration; prove authenticated read/commit plus table/helper/DDL denial before activation. Broad grants are unsafe.

## Open implementation/completeness gates

These are missing plan requirements, separate from the twelve reproduced bugs.

### C01 — All-process authority routing and feature parity
src/main/index.js:4652 registers/discards the runtime, then unconditionally calls db.initDatabase at 4675. infrastructure.js:2308+ still requires Supabase configuration and starts cloud runtime/connectivity/timers. Main backup/catalogue/fleet/validation/notification jobs bypass IPC fencing; in-flight old cloud calls are not globally fenced. Legacy's earlier authority detection/skipped cloud startup is progress, not full routing. The limited local counter replaces the full shell: tabs/corrections/approvals/cash-up/stock/admin/reports/add-ons/hardware are missing. Denying an unwired action is not feature implementation.

### C02 — Source-to-GL/Accounting readiness
Final sales/returns have no atomic source-linked GL posting or explicit blocked posting-exception/readiness contract. The entitlement-enabled independent fixture has nine sales/corrections and zero journals. Standalone journals/AP tests do not prove source coverage, opening-state reconciliation or period/report correctness. A03's duplicate sale/stock proof does not establish its full Accounting clause.

### C03 — Settings, installer and Windows lifecycle
No functional Local Bar Network/reduced Legacy wizard implements server install, join, full-copy enrolment, status/repair/switchover/remove/replace. Pinned clients exist; production TLS bootstrap/discovery/rotation, offline pinned runtime/service wrapper/least-privilege account/reboot persistence do not. No bundled install or independent Windows service behavior is qualified.

### C04 — Full copies and safe failover
No supported packaged coordinator, physical standby seed/catch-up, synchronous-replica acknowledgement, acknowledged-prefix eligibility, quorum/fencing or old-host rejoin protocol. Two/six-device and witness/manual profiles are unqualified. One modern office host plus Windows 7 tills remains single-host; Legacy cannot become standby/voter.

### C05 — Operational recovery
Real logical dump/encryption/restore helpers exist; older “no backup implementation” wording is too broad. Scheduled independent destinations, continuous WAL/PITR, safe retention/restore verification, owner-held recovery material, safe activation/fencing/epoch and measured replacement-host RPO/RTO remain absent/unverified. Fix F11/F12 even for logical restore.

### C06 — Catalogue, readiness, updates and safety
Modern page combiner validates scope/watermarks; Legacy concatenates UI pages without equivalent cross-page snapshot proof. Neither workspace consumes events for automatic office-to-till menu updates or complete catalogue-version/reconfirmation behavior. Sale payloads lack catalogue binding; SQL reprices current catalogue. Packs/UOM/barcodes/modifiers/deletes/empty/stale/reconnect need actual workflow proof.
Current readiness checks only a small authority/staff/product subset, without disk/WAL/replica/backup/clock/printer/commit-policy proof. Update hashes/version helpers do not establish trusted signed offline installation. Power/maintenance, isolated rehearsal and replacement wizards remain missing. Backend room-charge/provider-confirmation refusals exist, but complete external UI boundaries do not.

### C07 — Export, cutover and inventory
Outbox transactions and deterministic export/fake receiver helpers exist; hosted ingestion stays disabled correctly. Durable workers/checkpoint crash recovery, dry-run reconciliation and old hosted writer isolation are unfinished. A local flag is not a hosted fence.
Author matrix “locally_implemented” labels often mean SQL-only while naming cloud callers or pending UI. Grouped Accounting rows do not enumerate all offered operations/jobs. Companion review CSV retains all 63 rows but marks end-to-end gaps; it does not certify the matrix exhaustive.

### C08 — Qualification and deferred documents
Installed Win7/modern multi-PC/peripheral/physical power-cut, full fault matrix, 50,000 real sales over simulated 42 days and 8-hour reference-hardware soak are unverified.
The human explicitly told the author to defer PDFs/screenshots/manifest, confirmed in thread history. Respect that direction: deferred documentation is a release gate, not disobedience. Current manual checksum/package evidence remains unresolved; ordinary local cashier offline packaged guide access is unproved. AGENTS.md still requires the narrow local-authority amendment/proposal before activation; cloud/hotel/lodge safeguards must remain intact.

## Work packages and quality

| WP | Result | Reason |
|---|---|---|
| 0 | FAILED | Inventory/ADR/guard exist; stale hashes and SQL-only completion labels. |
| 1 | FAILED | Local auth/migrations partly tested; privilege escalation, entitlement/setup/installer unfinished. |
| 2 | FAILED | Same-key concurrency works; duplicate-key UX, financial defects and crash recovery block approval. |
| 3 | FAILED | SQL domain foundation; correction/stock defects and missing operator/hardware workflows. |
| 4 | FAILED | Advanced contracts unreachable; full add-ons/settings/report/source coverage missing. |
| 5 | FAILED | Modern crash, incomplete all-process fences/menu/recovery/multi-till proof. |
| 6 | FAILED | Disabled cloud transport correct; workers/cutover/fencing incomplete. |
| 7 | FAILED | Logical backup mechanics work; verifier/security restoration/HA/lifecycle incomplete. |
| 8 | FAILED | Broad regressions/reproduced bugs; qualification unverified, guide work deferred. |

Useful foundations include strict compilation, isolated migrations/roles, scoped sessions/device revocation, stable same-key receipts, transactional commit counter, SQL numeric arithmetic, pinned transport, durable checksummed journals and explicit cloud-disabled state. The author is candid about NO-GO.

Quality weakness: layer-disconnected verification. SQL-only tests bypass missing HTTP contracts; builds/main tests miss initial rendering; fake replies differ from the service. Separate allowlists and unchecked generic database-result narrowing promote drift. Checked-JS bridges are reasonable where compatibility needs them, but packaged Legacy/native/runtime proof remains missing. Modern JSONL versus the plan's SQLite intent-store requirement needs a documented reconciled design decision and equivalent fault proof.

Every A01–A32 and all 63 author feature rows are assessed separately in the companion CSVs. FAILED means a defect/missing implementation; UNVERIFIED means unavailable execution/qualification proof. Component success never promotes an entire requirement to PASS.

## Separate verdicts

- Implementation completeness: FAILED.
- Financial/stock correctness and security: CHANGES REQUIRED.
- Complete offline daily operation/no fallback: FAILED / unproved.
- Replication, failover and customer recovery: incomplete / NO-GO.
- Documents: explicitly deferred; approval/checksum/package evidence unresolved.
- Packaged Windows/hardware/load/physical failure qualification: UNVERIFIED / NO-GO.
- Hotel/lodge: builds pass; no comprehensive live cloud/PWA/public qualification claimed.
- Hosted Supabase changes in this review: NONE; deployment state not queried/modified.
- Hosted financial ingestion: DISABLED as required, not cloud parity.
- Customer commissioning/release: NO-GO.

Correct defects, then finish remaining work packages without hiding features or weakening tests. Further independent review and unavailable qualification remain necessary. This review is not a guarantee that every defect has been found and is not release authorization.


The review-only PostgreSQL cluster was positively re-identified and stopped after testing; files/fixtures are retained under ignored .tmp for inspection. Other application/database processes were not stopped. No source remediation was performed.
