# Implementation prompt: complete local Bar authority

Copy the prompt below into the implementing model's chat in this repository. Read the linked plan rather than treating this shorter prompt as a replacement.

---

You are implementing Tsa Bonno HospitalityOS's fully local Bar architecture end to end. Work in:

`C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`

The owner wants daily Bar trading and all locally possible Bar management/add-on functions to work without internet, with transactions authorised, validated and durably committed by a local backend. HotelOS and LodgingOS remain online-first on Supabase. Implement the whole local stack and its modern/Legacy clients, guardrails, tests, recovery, packaging source, documentation and review evidence in one sustained implementation engagement. Do not stop after writing another plan, a sale-only demo or a service scaffold.

Read and follow:

1. `AGENTS.md` and current `PROJECT_STATE.md`.
2. `docs/ARCHITECTURE.md` and `docs/SHIP_READY_RUNBOOK.md`.
3. `docs/engineering/bar-local-first/TECHNICAL_PLAN.md` in full; it is the detailed implementation contract.
4. The current Bar capability/recovery/release matrices, all relevant Accounting authorisation and source-coverage contracts, and `docs/bar-manual/maintenance.md`.

Treat the plan as an architectural change explicitly requested by the owner. It changes financial authority **only for explicitly commissioned local Bar profiles**. Preserve the Supabase-only mutation rules for hotel/lodge and cloud-mode profiles. Document the narrowly scoped new rule in the engineering guide/architecture; do not globally weaken financial guardrails.

## Absolute environment restrictions

- **No hosted Supabase migrations or writes, anywhere.** No linked push/reset/repair, preview-project fixtures, remote DDL/DML, Auth/user/config changes, Storage uploads, Edge Function deployment, credentials/secrets changes or real trading operations.
- Do not run release/publish scripts or cut over a customer.
- Local-only PostgreSQL schema migrations and isolated local fixtures are allowed and required. Put them under `services/bar-local/db/migrations/`, outside `supabase/migrations/`.
- Build a test-target guard that requires explicit opt-in, a loopback allowlist, dedicated test database and positively verified local cluster identity. Reject unknown, hosted and default connection targets before migrations/tests. Inspect old wrappers before invoking them.
- Do not modify the existing hosted migration backlog. Do not assume the historical replay draft or any pending server function is approved/deployed.
- Hosted financial ingestion stays disabled. Implement local outbox/export bundles and fake-receiver tests; describe future hosted ingestion in a proposal document. Do not silently use old cloud sale/stock/shift RPCs to post completed local trades.

These restrictions override generic migration/release instructions in historical runbooks. The owner is to receive reviewable code and evidence before any real deployment.

## Chosen architecture

Use one local Bar service with PostgreSQL for single-till and multi-till deployments. One till uses loopback; multiple tills use a pinned TLS API over LAN. The service is a standalone Windows service and survives cashier logout/Electron exit. Legacy POS is a compatible thin client, not the PostgreSQL host. Do not build a second SQLite financial engine. SQLite on modern clients is a durable intent journal only; retain a tested compatible durable journal for Legacy.

Introduce a trusted `cloud | bar_local` authority router scoped to product/business/outlet/authority/epoch. Route every Bar read/write/background job/auth/report/optional add-on to the selected authority. Connectivity must never switch it. A local outage must never fall back to cloud writes. Keep unaffected cloud paths and existing customer profiles intact.

Use **strict TypeScript** for the new Node.js service and shared contract package, and for new high-risk client/IPC/authority/recovery adapters where the current build supports it. Keep database schema/functions in SQL/PLpgSQL. Derive types and runtime validators from one versioned contract definition; types do not replace runtime validation, authorisation or database atomicity. Compile to JavaScript compatible with each existing modern/Legacy runtime and module format. Preserve checked-JavaScript bridges where compatibility requires them, document exceptions, and do not turn this into a wholesale conversion of existing apps. Add the new strict type checks to the real build/test aggregates and prove customer startup needs no development TypeScript tooling. Follow the full language policy in the technical plan.

In local mode, all financial/stock changes use authoritative local atomic RPCs through an authenticated service. Implement local staff/PIN/session/capability/entitlement enforcement, strict scope, duplicate protection, server calculations, ledger/audit, business-state locks and actionable recovery. No renderer-authored authoritative balance/status/totals; no service-role or DB credentials in clients; no generic unaudited SQL/RPC proxy.

## Required execution sequence

1. Capture baseline `git status`, changed-file ownership/hashes, relevant tests/builds and current contract evidence. Preserve unrelated edits; do not reset, clean, reformat or commit others' work. Discover applicable nested instructions. Re-verify old audit claims against current code.
2. Create the exhaustive `FEATURE_CONTRACT_MATRIX.csv` specified in the plan: every actual Bar route/tab/action/background job/export/add-on, current caller/RPC, new local contract, permissions/scope, retry/audit effect and tests. Trace shared settings/staff/Accounting and Legacy paths. No enabled local-capable feature may disappear to simplify scope.
3. Implement service lifecycle, separate local schema/runner/roles, strict TypeScript versioned contracts with runtime validation, secure first-owner commissioning, local sessions/PIN approvals, signed entitlement verification, TLS pairing/device revocation and scope fencing. Offline first installation must not secretly need Supabase login/lease/CDN.
4. Implement the atomic database operation receipt and ledger core, modern and Legacy durable intents, operation-status recovery and full domain coverage. An operation key is created once before dispatch; same-key/same-payload retries return the original committed receipt before mutable shift/menu/tab checks, subject to authenticated recovery access. Different payloads conflict. Stock, sale, tenders, cash/customer liabilities, audit/accounting/outbox effects commit atomically as applicable. Preserve original shift/business date and all authoritative before/after evidence.
5. Implement all offered tabs, corrections/refunds, stock/purchasing, shifts/drawers/cash-up, local reports, staff/control/settings and enabled customer/growth/accounting/workforce functions. Preserve package/capability, maker/checker, readiness/source coverage, historical opening state and precise monetary/UOM rules. Do not replace unavailable evidence with zeros.
6. Wire modern renderer/preload/IPC and Legacy client, durable uncertain-outcome UX, receipt/reprint hardware, catalogue/changefeed recovery and old-queue/mesh fencing. Server/LAN loss retains drafts/intents and stops financial finalisation; internet loss alone does not stop trading. Separate local committed status from cloud export/integration state.
7. Implement encrypted consistent DB/WAL backups, externally held recovery material, staged verification, replacement-host restore, old-host fencing/epoch procedure and measured recovery targets. Existing redacted till backups do not suffice. Do not promise recovery newer than the valid backup/WAL chain.
8. Implement local outbox and signed/checksummed export batches, import/cutover dry runs and blocked hosted transport. Never turn a local commit into a pending sale merely because cloud export is disabled. Cloud reports/PWA remain explicitly stale for this scope. Write the future ingestion contract proposal and the cloud-writer-fencing limitation.
9. Prepare offline Windows service/DB/runtime installation and upgrade/uninstall-preserves-data source, diagnostics, dependency notices/checksums and packaged-client verification. Preserve modern/Legacy app IDs, feeds and supported targets. No Docker customer dependency or runtime downloads.
10. Complete feature and A01–A20 acceptance coverage from the plan, real DB/API concurrency and fault tests, 50,000-sale multi-client qualification, baseline regression comparisons and affected builds. Record the 8-hour/hardware/restore/installer checks actually executed; if unavailable, mark them unverified and do not manufacture evidence.
11. Update required Bar manual/quick-start/captures/evidence and generate visually reviewed candidate PDFs with the relevant skills. Preserve approved-manifest semantics; candidates do not become approved merely because their checksums match. Complete source/documentation work even if human approval or release signing remains pending.
12. Deliver a full independent review packet. Do not publish, commission a live business, migrate Supabase or claim customer readiness.

## Mandatory correctness details

- Local database runtime cannot bypass financial functions with direct table writes. Local session identity must be trusted and transaction-scoped; test pooled-connection leakage and forged actor IDs.
- Enforce authority, epoch, tenant, outlet, device, actor, package, capability and business state. Reset/suspend staff locally across tills. Approval binds to the exact operation/hash, expires and cannot be replayed against another target.
- Same-key concurrency produces one effect. Timeout/not-found never creates a new key. Persist original envelopes before network dispatch; corruption/full disk must fail safely. Preserve imported legacy keys and unresolved journals.
- Use decimal/integer financial precision and explicit rounding. Capture price/tax/recipe/business-date versions. Keep payments/stock/accounts/vouchers append-only with linked compensations; never edit balances to reconcile a discrepancy.
- Lock tabs, stock, credit/voucher balances and cash-up state; test simultaneous last-unit, split/settlement, return, receiving and close/approval races.
- Local historic receipt lookup works after shifts close and menu/staff change; genuinely uncommitted closed-shift work must be refused or explicitly reconciled without rewriting original facts.
- Do not independently spend cloud/shared hotel credit or vouchers offline from a cached balance. Preserve exclusive authority/escrow boundaries.
- Printing is a post-commit side effect. Lost print response supports explicit reprint, not resubmission of the sale.
- Offline external tender recording is not provider authorisation/settlement. Cross-hotel charges, banking, government filing, cloud messaging/support and remote dashboards have explicit external status.
- Without hosted changes there is no new hosted write fence. A stale old cloud client can still be a writer; require a proven controlled handover or leave commissioning blocked. Local flags do not solve that.
- After local trades exist, rollback cannot mean toggling back to cloud or restoring an older DB without reconciliation. No auto-election of a second Bar authority.
- No hard-coded/default owner PINs, forged entitlement signatures, globally disabled TLS checks, exported plaintext secrets or internet-required replacement-host recovery.

## Mixed Windows and replicated-host requirements

Implement the updated plan section in full: modern office PC hosts the Bar app/service; Windows 7 Legacy till pairs to that Bar/outlet and receives complete versioned published menus over authenticated LAN without internet. Preserve lodge/cloud Legacy paths. Test required Bar cashier workflows, outlet permissions, catalogue deletion/empty/paginated snapshots, stale carts and reconnect recovery on the installed Legacy runtime.

Eligible modern hosts hold full PostgreSQL standbys. Implement primary-plus-standby durable acknowledgement, a mature supported coordinator, majority agreement, safe promotion eligibility and enforceable old-primary fencing. Verify the actual Windows stack and offline packaging; no home-grown consensus or mesh/file-copy substitution. Three eligible modern hosts are the default automatic-failover profile. One modern office PC plus one Windows 7 till remains single-host; document supported witness/manual arrangements for two modern hosts and stop unsafe sole-survivor writes. Preserve logical authority and original operation IDs across ordinary failover. Assess and extend existing local database foundation work without assuming replication readiness. The original prohibition on election means competing authorities; the updated fenced failover contract is now required.

Complete A21–A23 in addition to A01–A20, including real failure/partition tests, installed compatibility evidence, updated role-selection setup, menu and recovery documentation. Missing coordinator/hardware evidence is a readiness blocker, not a passing gate.

Implement the plan's Settings-led setup section and A24 as mandatory scope. Three PCs are illustrative: support and qualify two and six devices, separating terminals, full replicas and coordinator voters. Provide functional Settings controls for Set up this PC as server, Connect this PC to a Bar, Keep a full database copy, Devices/status, Check setup/Repair connection, Change/Recover server and Remove/Replace PC, with a reduced Legacy connection screen. Automate supported prerequisite/service installation, discovery/pairing, full seed, streaming catch-up, endpoint reconnection and health checks. Enforce privileges, protected storage, idempotent resumable setup, safe membership/fencing and truthful topology limitations. No command-line setup requirement, mock buttons, silent data replacement or unsafe promotion override. Include actual installed workflow/fault tests, screenshots, manuals and offline guide packaging evidence. A24 extends the earlier acceptance manifest to A01–A24.

## Tests and evidence

Implement all eight owner-approved daily-readiness/maintenance/recovery additions in the technical plan, with acceptance IDs A25–A32: host sleep/shutdown/Windows-maintenance guidance; opening readiness checks; persistent truthful modern/Legacy connection indicators; encrypted independent scheduled backups and isolated restore verification; safe compatible offline updates; isolated installation rehearsal/training; offline replacement-PC wizard including safe two-PC recovery; and an executable failure matrix proving acknowledged-sale durability and original-key uncertain-outcome recovery. The complete acceptance manifest is now A01–A32. These are functional requirements with actual installed runtime/fault evidence, authorised settings, idempotent recovery, audit and manual/quick-start/screenshots/packaged-guide coverage. Preserve the exact durability-profile limits; do not disable security updates indefinitely, overwrite live data during verification/training, fake hardware tests, or allow unsafe promotion when isolation/quorum/receipt evidence is missing. Keep existing restrictions on hosted writes, releases and real customer cutover.

Use the real scripts listed in the plan and re-read `package.json`; add and register meaningful new service/local-DB/API/restore/soak suites. Mocks/static checks do not replace behavioral database evidence. Do not run a pre-existing wrapper unless its database target is proved local and isolated. Run affected modern/Legacy builds and hotel/lodge/shared regressions. Preserve precise baseline failures; do not weaken tests or call skips passes.

Keep an evidence manifest with test ID -> command -> actual production path -> assertions -> result -> log/hash. Include explicit negative/bypass tests and fault windows, financial/stock invariant queries and measured load/restore results. A queue-transfer stress test is not a real 50,000-sale test. Simulated business days are not a multi-week wall-clock soak.

Required deliverables in `docs/engineering/bar-local-first/`:

- completed feature contract matrix and A01–A20 acceptance manifest/results;
- `IMPLEMENTATION_REPORT.md` and changed-file/review SHA-256 manifest;
- `SECURITY_AND_FAILURE_REVIEW.md`;
- `CUTOVER_AND_RECOVERY_RUNBOOK.md`;
- `FUTURE_CLOUD_CONTRACT.md` explicitly labelled undeployed proposal;
- `MANUAL_IMPACT.md`, screenshots/QA references and candidate-versus-approved guide status;
- evidence logs for tests/builds/DB concurrency/fault/restore/performance/packaging;
- updated project state/architecture and scoped authority-rule amendment.

Work autonomously through all authorised implementation. Make ordinary engineering choices from the plan and repository evidence. If a hard environmental dependency is missing, finish independent code/docs/tests, preserve the exact reproducible blocker and mark that acceptance gate unverified. Do not stop at a plan, replace real behavior with stubs, claim completion while feature rows remain incomplete, or invent production approval.

Your final report must distinguish: source implemented; tests actually passed/failed/skipped; packaged/runtime/hardware verification; documentation candidate/approval status; real commissioning not performed; hosted Supabase changes **none**; cloud ingestion **disabled**. Provide the precise files and commands the reviewing model should use. Independent review and corrections follow this implementation; no model can self-certify production readiness merely by finishing one pass.
