# Bar local-first continuation checkpoint — 27–28 October 2026

**Implementation and acceptance remain incomplete; customer commissioning is not approved.** This is an evidence index and handoff, not an independent acceptance or deployment record. The current working tree is authoritative; the dated baseline documents are historical. Hosted ingestion remains disabled and no hosted activation, release, cutover, commit or push is implied. The user deferred physical multi-PC, peripheral, power and Windows 7 qualification, and customer PDF, quick-start, screenshots, approved-manifest and packaged-guide work. These remain release gates, not completed work.

Status terminology: **PASS** means the named check passed at its recorded revision and scope; **FAIL** means the named check failed; **PARTIAL** means some implementation/evidence exists but the full requirement remains open; **UNVERIFIED** means full requirement evidence is absent or not re-established at this checkpoint. Baseline "locally_implemented" means source exists, not acceptance. The independent follow-up marks all 32 acceptance, 64 feature and nine work-package rows UNVERIFIED. Historical passing checks are not silently promoted to current full acceptance. Any checks currently running are **pending**, with no result claimed here.

## Evidence and corrections to older checkpoints

- The isolated service suite through 0060 passed 152/152; the 0061 focused retained-tip tests passed 2/2. Modern SQLite storage, bundled Electron OS storage, and a real local HTTP lost-reply recovery have recorded development-PC evidence in TAKEOVER_LATEST_2026-10-26.md and TAKEOVER_2026-10-27.md. These do not cover every crash/print/power window. The broad Bar suite's recorded 772 pass, 34 fail and six skip is not a passing suite; see BROAD_SUITE_FAILURE_ANALYSIS_2026-10-27.md.
- A03's 22 October 100-request result is historical **PASS for that recorded test**, not current verification of every later migration or accounting effect. All later or ongoing full-suite runs require separately recorded outcomes.
- Migration 0055/0056 and both local clients implement paired drawer handover; 26 October isolated evidence covers its conservation, replay and denial cases. The older WP3 statement that handover has yet to be implemented is superseded; installed and multi-till qualification remains open.
- Migration 0064 and the cloud-sync controller implement local batch/checkpoint and loopback receiver testing. Older A13 and WP6 statements saying no worker exists are stale. Hosted transport remains disabled; approved transport refuses activation. Complete crash/retry, authoritative receiver acceptance and cutover reconciliation are still open.
- Witness source and migration 0065 exist. Production service startup refuses witness mode because fencing and promotion safety are not established; the witness is not a supported coordinator. Older A23 wording that no witness source exists is superseded; A22/A23 stay UNVERIFIED. See FAILOVER_2026-10-27.md safety notice.
- The current checkout includes shared-contract rejection of generic drawer tip payouts, migration 0066's service-side drawer guard, catalogue-required shift opening, and refusal of tip reversals against closed shifts. A guarded isolated PostgreSQL/API run on 27 October passed all five selected cases, including these guards. This does not reconcile historical tip-payout reversals or already-submitted cash-up corrections; reviewed reconciliation remains open.
- Migration 0066 was applied by the disposable PostgreSQL runner in that same five-case run; service build passed. The full service suite remains unrun because its disk guard stopped before cluster initialization. This scoped evidence is not full service acceptance or release qualification.
- Modern and Legacy administration now label export and cloud acknowledgement counters as highest observed sequence values, and explain that gaps, pending work, and incomplete receiver ingestion may remain. A focused UI test passed 6/6. Backup verification retains compatibility aliases, adds explicit highest-sequence fields, reports the pending outbox count, and deliberately leaves the contiguous acknowledged checkpoint unknown (`null`).
- Modern and Legacy catalogue refresh now require coherent product/availability snapshots by scope, watermark, IDs, SKUs, versions and pagination; on drift they make bounded retry attempts and clear stale display/edit state. The focused snapshot test passed 8/8, renderer typecheck passed and both application builds passed.
- Verification on this continuation: service build and five selected isolated PostgreSQL/API cases passed; bar contract/UI suite passed 18/18; Modern local Electron suite passed 87/87; Modern Bar UI suite passed 5/5; Legacy suite passed 219 source checks plus 50 Node tests; focused administration UI passed 6/6. The full isolated PostgreSQL suite did not start because the runner's mandatory 4 GiB free-space preflight found 1.81 GiB; no cluster was initialized. Retry only after free space is available without deleting active application data.
- Lot receipt history does not represent remaining lot balances or FEFO allocation. Existing-cloud transition, import and writer fencing, independent WAL/PITR, packaged replacement/upgrade, and safe coordinator remain unfinished. Source scripts or a local test do not prove installed behavior.
- A focused cross-scope API regression was added for forged business, outlet, authority and device IDs, asserting refusal and no catalogue writes. Its source parses and the service/contracts typecheck passes, but the real API/DB case remains unrun behind the isolated runner's 4 GiB free-space guard; second-authority tenant isolation is still open (EV-114).
- Baseline manifest entries saying no crash harness exists are too broad: SQLite synthetic termination and local HTTP lost-reply checks exist. They do not cover A04, A11 or A32 in full.

## Acceptance A01–A32

The baseline status below is retained from ACCEPTANCE_MANIFEST.csv; current full-row status is UNVERIFIED unless user-deferred. The stated next gate is the baseline action, with the corrections above taking precedence where it describes older source. A19 remains pending at the user's direction.

| ID | Requirement | Baseline | Current | Remaining gate |
| --- | --- | --- | --- | --- |
| A01 | Clean local commissioning, owner login, staff/menu setup and paired modern/Legacy tills with internet/DNS blocked | partial | UNVERIFIED | Run the packaged installer and exercise owner setup, two Modern tills and a Legacy till with internet/DNS blocked |
| A02 | Two tenants, two outlets, cashier/stock/manager/finance roles and forged/revoked scope denial | partial | UNVERIFIED | Run the new forged-scope API test on isolated PostgreSQL; add second-authority tenant, forged-actor, full role/capability and direct-bypass cases |
| A03 | 100 simultaneous identical-key requests produce one receipt/effect and changed payload conflicts | verified | UNVERIFIED | None |
| A04 | Process kill before/after send, commit, reply, client checkpoint and print recovers without duplicate effect | not_run | UNVERIFIED | Extend existing SQLite crash and lost-reply checks to all client/service/commit/reply/checkpoint/print windows and reconcile effects. |
| A05 | Simultaneous last-unit/voucher/credit/tab/return/cash-up/purchase/stocktake races preserve invariants | partial | UNVERIFIED | Add remaining domain race tests after commands exist |
| A06 | Every matrix primary/add-on workflow runs through real local API with denial/recovery/audit assertions | partial | UNVERIFIED | Run every remaining matrix row through the local API and an installed client with denial/audit/retry/recovery assertions |
| A07 | Pricing/tax/discount/tender/change/fractional-stock rounding and invalid numeric rejection | partial | UNVERIFIED | Add arithmetic property tests and reject invalid/overflow cases |
| A08 | Shift/menu changes after commit do not break receipt recovery; uncommitted closed-shift work refused/reconciled | partial | UNVERIFIED | Add recovery tests across shift close and catalogue revision |
| A09 | Server/LAN loss with internet present never falls back to cloud or finalises independently | not_run | UNVERIFIED | Complete app routing then test service/LAN loss with internet available |
| A10 | Suspended staff/package restrictions/maker-checker and offline entitlement validation enforced by service/DB | partial | UNVERIFIED | Add test entitlement path and policy decision |
| A11 | Client/main/service/DB restart, corrupt journal, full disk, backup failure and clock rollback safe outcomes | not_run | UNVERIFIED | Extend existing storage fault checks to client/main/service/DB restart, corruption, disk, backup and clock rollback. |
| A12 | Backup to staging and replacement-host restore without internet; verify ledgers/receipts/outbox/auth, stale host, RPO/RTO | partial | UNVERIFIED | Qualify scheduled backup and replacement-host restore on supported Windows hardware |
| A13 | Outbox atomicity, worker crash, duplicate/out-of-order/partial fake acknowledgements; export != acknowledged; hosted transport disabled | partial | UNVERIFIED | Exercise worker crash, retry, duplicate/out-of-order and partial acknowledgement; reconcile checkpoints; hosted activation remains disabled. |
| A14 | Old cloud queues/mesh cannot import local trades; cloud-mode desktop/Legacy/hotel/lodge/PWA/public contracts unchanged | not_run | UNVERIFIED | Add queue/mesh fencing and run existing cloud regressions |
| A15 | Reports/exports match hashes/totals/watermarks, no duplicate prefix/truncation, accounting readiness fails closed | partial | UNVERIFIED | Implement consistent snapshot jobs and completeness metadata |
| A16 | Strict TS checks, compiled JS compatibility, offline packaged installer/service lifecycle/native modules/legacy TLS/peripherals/guides | partial | UNVERIFIED | Install the packaged service on supported hosts and exercise install/reboot/upgrade/printer behavior |
| A17 | Restore/cutover/upgrade dry run preserves pending work; unresolved cloud outcomes/unfenced old writers block; post-trade rollback blocked | not_run | UNVERIFIED | Implement dry-run import/cutover and fencing checks |
| A18 | External tender/room charge/global voucher/support/filing boundaries visible and pending/unavailable, no false confirmation | partial | UNVERIFIED | Continue explicit pending/unavailable boundary coverage for room charge, vouchers, support delivery and filing |
| A19 | Affected manuals/screenshots/quick-start/PDFs visually verified with honest approval status; offline guide access | pending_user_direction | UNVERIFIED — user deferred | Pending by user direction: update candidate guides after UI stabilises and user resumes PDF work |
| A20 | Multi-process 50,000-sale/42-day simulation, latency targets and invariant reconciliation with artifacts | not_run | UNVERIFIED | Build deterministic simulator and record results |
| A21 | Installed Windows 7 Legacy till with modern office host: pairing/login/menu publication/cashier workflows/reconnect | partial | UNVERIFIED | Execute the packaged local service on reference Windows 7 hardware and run the full Legacy workflow |
| A22 | Three modern hosts with supported coordinator: seed/catch-up, sync durability, failover, fencing, partitions and invariant proofs | not_run | UNVERIFIED | Implement/qualify coordinator selection and execute the three-host failure matrix |
| A23 | Mixed single-host/two-modern-host limitations, unsafe sole survivor denial, witness/manual recovery and restore | not_run | UNVERIFIED | Select a supported safe topology and qualify sole-survivor, fencing, recovery and partition behavior; experimental witness is refused in production. |
| A24 | Installed two-/six-PC Settings workflows for setup/join/replica/removal/switchover and negative cases | partial | UNVERIFIED | Qualify the packaged host/join/replica/removal/switchover workflows on two and six installed PCs |
| A25 | Server power/maintenance behavior: sleep/startup checks, drain warnings, reboot/maintenance/loss tests | not_run | UNVERIFIED | Add host checks and test sleep/reboot/maintenance |
| A26 | Opening readiness check with blockers/warnings, checked-at time and commit-time enforcement | partial | UNVERIFIED | Expand server readiness blockers and verify fail-closed opening/sale under service, catalogue and database faults |
| A27 | Visible connection indicator across Modern/Legacy distinguishing internet/LAN/authority/readiness | partial | UNVERIFIED | Complete the connection status model and qualify reconnecting states |
| A28 | Encrypted scheduled backup destination, retention, restore verification, key protection and failure tests | partial | UNVERIFIED | Install the backup destination and qualify retention/restore/failure behavior, including key custody |
| A29 | Safe offline upgrade preflight, signed packages, resumable state, mixed-version/failure tests | partial | UNVERIFIED | Produce a signed package and run offline upgrade, rollback, mixed-version and interrupted-update tests on target hardware |
| A30 | Training/rehearsal isolated authority, banner, disposable data and no live/finance/provider effects | not_run | UNVERIFIED | Implement isolated training authority and rendered tests |
| A31 | Replace broken client/primary/standby with recovery keys, fencing, restore, re-enrolment and safe-stop paths | not_run | UNVERIFIED | Implement and exercise the replacement-host workflow with recovery keys and fencing on target hardware |
| A32 | Runnable failure matrix covering process/power/LAN/quorum/disk/corruption/seed/upgrade/backup/lost replies with proofs | not_run | UNVERIFIED | Build and execute the complete fault matrix with invariant evidence; physical cases remain deferred. |

## Work packages WP0–WP8

Each package is PARTIAL in the plan and UNVERIFIED for full acceptance. Individual passing tests are scoped as above.

| WP | Current source/evidence | Remaining gate |
| --- | --- | --- |
| WP0 | Baseline, ADR, inventories, feature and acceptance matrices and guarded local runner exist. | Reconcile all live routes and maintain current, attributable evidence/hashes. |
| WP1 | Local service uses one business per authority/database. A focused API regression now covers forged tenant, outlet, authority and device scope in one authority; syntax and service typecheck passed. | Run the regression on the guarded isolated PostgreSQL cluster, then add cross-authority/second-database tenant isolation evidence and complete the direct-bypass/role matrix. |
| WP2 | Atomic commands, idempotency, durable Modern SQLite and Legacy intents have isolated evidence. | Full crash windows, race/financial invariants, current full-suite evidence and recovery qualification. |
| WP3 | Sales, corrections, stock, cash-up, counts and paired handover have service/client implementations and partial DB evidence. | Allocated-tip and historical cash-up reconciliation, lot/FEFO, remaining workflows, hardware and installed reconciliation. |
| WP4 | Multiple local add-on, settings, accounting and workforce contracts and panels exist. | Complete all offered workflows and denial/recovery/audit evidence; implement isolated rehearsal. |
| WP5 | Authority routing, cloud fences, protected intents and catalogue catch-up exist. | Complete domain/background routing and actual client, network-loss and cloud regression coverage. |
| WP6 | Outbox/export and local-test cloud-sync batching/checkpoints exist; hosted activation is refused. | Complete crash/retry and receiver proof, dry-run cutover/import and old-writer fencing. |
| WP7 | Encrypted backup/restore, retention and Windows lifecycle scripts exist. | Independent WAL/PITR, portable keys, replacement/recovery, signed offline installer, sleep/maintenance and installed proof. |
| WP8 | Scoped tests, evidence and review records exist; broad suite remains non-green. | Complete security/fault/load acceptance and independent review; physical qualification and customer documentation are user-deferred. |

## Feature matrix — 64 rows

Every row remains UNVERIFIED for full production-path acceptance in FOLLOWUP_COVERAGE_2026-10-27.csv. Baseline source classification is reproduced without upgrading it to PASS. The action and dependencies below identify the specific contract and implementation context; each row still needs its actual local caller, server authorization, denial, audit, retry/recovery and applicable reconciliation evidence. External-only steps remain external; physical and customer-guide gates remain deferred. The dated feature matrix can lag subsequent source changes; the corrections and named reports above take precedence.

| Feature | Action | Baseline source status | Current | Dependencies / remaining context |
| --- | --- | --- | --- | --- |
| BAR-COUNTER-001 | Staff sign-in, add/edit product, open shift, catalogue, split/non-cash sale and tab settlement, returns/voids, cash-up, stock receive/adjust/stocktake/waste/transfer, drawer movements and physical counts, menu availability, receipts and uncertain retry | partial | UNVERIFIED | Protected local profile, paired device, local PostgreSQL service |
| BAR-SETUP-001 | First-owner commissioning | partial | UNVERIFIED | Local PostgreSQL, TLS bootstrap |
| BAR-SETUP-002 | Pair additional till | partial | UNVERIFIED | Local API, pinned server identity |
| BAR-ACCESS-001 | Local staff login | partial | UNVERIFIED | Local authentication |
| BAR-ACCESS-002 | Local authority startup/session restore | partial | UNVERIFIED | Protected profile, startup authority gate; full authority router still required |
| BAR-ACCESS-003 | Create/suspend staff | locally_implemented | UNVERIFIED | Local auth, approvals |
| BAR-ACCESS-004 | Manager approval proof | partial | UNVERIFIED | Local auth, hashing |
| BAR-SALE-001 | Commit local cash counter sale with split/cash/non-cash tenders, service-backed promotion and configurable discount limits | locally_implemented | UNVERIFIED | Local DB, catalogue, stock, tenders |
| BAR-SALE-002 | Return/refund; Modern and Legacy local workspaces accept quantities for multiple lines in one manager-approved return | locally_implemented | UNVERIFIED | Original sale, stock, tenders, approval |
| BAR-SALE-003 | Void sale | locally_implemented | UNVERIFIED | Original sale, approval |
| BAR-TAB-001 | Open tab | locally_implemented | UNVERIFIED | Local DB, staff |
| BAR-TAB-002 | Add lines to tab | locally_implemented | UNVERIFIED | Tab version, stock, catalogue |
| BAR-TAB-003 | Settle tab | locally_implemented | UNVERIFIED | Tab version, tenders, stock |
| BAR-TAB-004 | Transfer tab | locally_implemented | UNVERIFIED | Approval, version, target staff |
| BAR-TAB-005 | Split tab | locally_implemented | UNVERIFIED | Approval, tab version, line allocation |
| BAR-TAB-006 | Merge tabs | locally_implemented | UNVERIFIED | Approval, tab versions, ownership |
| BAR-SHIFT-001 | Open shift/drawer | partial | UNVERIFIED | Local DB |
| BAR-SHIFT-002 | Close shift | partial | UNVERIFIED | Open tabs/sales evidence |
| BAR-SHIFT-003 | Drawer movement | partial | UNVERIFIED | Cash ledger |
| BAR-CASH-001 | Submit cash-up | partial | UNVERIFIED | Shift, cash/card evidence |
| BAR-CASH-002 | Review cash-up | locally_implemented | UNVERIFIED | Maker-checker approval |
| BAR-CASH-003 | Reopen closed cash-up | locally_implemented | UNVERIFIED | Approval, period lock, review-state match, revision snapshot |
| BAR-MENU-001 | List menu/catalogue | partial | UNVERIFIED | Local DB |
| BAR-MENU-002 | Create/update product | partial | UNVERIFIED | Catalogue validation and optimistic product version |
| BAR-MENU-003 | Availability / sold-out | locally_implemented | UNVERIFIED | product_availability, product, outlet |
| BAR-MENU-004 | Modifier configuration, recipe management and promotion authoring; cashier modifier selection and promotion application are supported | partial | UNVERIFIED | Product model, recipes, promos |
| BAR-STOCK-001 | List stock/low stock | partial | UNVERIFIED | Local DB |
| BAR-STOCK-002 | Receive stock | partial | UNVERIFIED | Supplier/lot fields |
| BAR-STOCK-003 | Adjust stock | locally_implemented | UNVERIFIED | Approval |
| BAR-STOCK-004 | Stocktake | locally_implemented | UNVERIFIED | Locked snapshot |
| BAR-STOCK-005 | Waste | locally_implemented | UNVERIFIED | Approval |
| BAR-STOCK-006 | Purchase orders/receiving | locally_implemented | UNVERIFIED | Supplier, PO, partial delivery, lot/expiry capture |
| BAR-STOCK-007 | Lots/expiry | partial | UNVERIFIED | Lot-level depletion/allocation remains unimplemented |
| BAR-CUSTOMER-001 | List/create customers | locally_implemented | UNVERIFIED | Local customer/credit |
| BAR-CUSTOMER-002 | Credit payment | locally_implemented | UNVERIFIED | Credit ledger, shift |
| BAR-CUSTOMER-003 | Loyalty events | partial | UNVERIFIED | Loyalty ledger |
| BAR-VOUCHER-001 | List/issue vouchers | locally_implemented | UNVERIFIED | Local liability ledger |
| BAR-VOUCHER-002 | Voucher redemption/refund | locally_implemented | UNVERIFIED | Voucher ledger |
| BAR-REPORT-001 | Sales summary report | partial | UNVERIFIED | sales, sale_lines, sale_tenders, products |
| BAR-REPORT-002 | Outlet-scoped stock valuation/low-stock/movement and cash-up summary | partial | UNVERIFIED | Reads stock, cash-up and tender ledgers; no writes |
| BAR-CONTROL-001 | Checklists/incident log | locally_implemented | UNVERIFIED | control templates/checklists/incidents, staff |
| BAR-EXPENSE-001 | Bar expenses | locally_implemented | UNVERIFIED | accounting_accounts, journal_entries/lines, suppliers |
| BAR-WORKFORCE-001 | Roster/attendance | locally_implemented | UNVERIFIED | workforce roster/attendance, staff, entitlements |
| BAR-WORKFORCE-002 | Tips/payouts | partial | UNVERIFIED | Tip ledger/payout |
| BAR-ACCOUNTING-001 | Chart of accounts | locally_implemented | UNVERIFIED | accounting_accounts, journal_lines |
| BAR-ACCOUNTING-002 | Journal posting | partial | UNVERIFIED | Balanced journals, source provenance |
| BAR-ACCOUNTING-003 | Trial balance/period close | partial | UNVERIFIED | Journals/period lock/approval |
| BAR-ACCOUNTING-004 | AP/bank/tax/payroll/budgets | partial | UNVERIFIED | Full accounting subledgers |
| BAR-AUDIT-001 | Search scoped audit history by action or JSON value | partial | UNVERIFIED | Read-only access to immutable before/after audit rows |
| BAR-DEVICE-001 | Device inventory/revocation | locally_implemented | UNVERIFIED | Device registry |
| BAR-NETWORK-001 | Local Bar Network setup/status | partial | UNVERIFIED | Installer, TLS, service lifecycle, replication topology |
| BAR-NETWORK-002 | Full replica seeding/catch-up/failover | partial | UNVERIFIED | PostgreSQL streaming replication, coordinator, fencing, hardware |
| BAR-BACKUP-001 | Encrypted scheduled backup/restore verification | partial | UNVERIFIED | PostgreSQL tools, encryption key, retention policy, runtime security restoration |
| BAR-EXPORT-001 | Outbox/export bundle, status reconciliation and test receiver | partial | UNVERIFIED | Local PostgreSQL outbox and export_batches; authenticated staff session; authorized client |
| BAR-UPDATE-001 | Safe offline update/rehearsal/replacement | partial | UNVERIFIED | Signed packages, update state, training/rehearsal authority |
| BAR-HARDWARE-001 | Receipt printer/drawer/scanner | partial | UNVERIFIED | Durable print jobs, device tests |
| BAR-EXTERNAL-001 | Card/mobile/hotel charge recording | external_pending | UNVERIFIED | External provider boundary |
| BAR-LEGACY-001 | LAN catalogue distribution and stale-cart catch-up | partial | UNVERIFIED | Paired device profile and local event API |
| BAR-LEGACY-002 | Local cash counter: sales with split tenders, shifts, product create/edit, availability, tabs with transfer/split/merge, returns/voids, stock receive/adjust/stocktake/waste/transfer, cash-up review, drawer movement, receipts, administration and retry | locally_implemented | UNVERIFIED | Node 16-compatible pinned HTTP(S) transport; durable Legacy JSONL intent journal; paired device profile |
| BAR-SUPPORT-001 | Record a local redacted support report | partial | UNVERIFIED | Service redacts diagnostics/metadata, checks payload size, stores checksum and audit event |
| BAR-INTEGRATION-001 | Explicit cloud/local authority routing | partial | UNVERIFIED | Protected authority profile, Electron safeStorage credential, journal, preload/IPC adapter; startup/login/domain/job routing still absent |
| BAR-INTEGRATION-002 | Authenticated LAN local authority adapter | partial | UNVERIFIED | Pinned Node 16-compatible transport, durable journal, paired device profile; full domain router still required |
| BAR-INTEGRATION-003 | Enforce explicit profile isolation and no-fallback fence | partial | UNVERIFIED | Trusted profile config, epoch fencing, queue partition, cross-profile tests; background router missing |
| BAR-STOCK-008 | Transfer stock to another outlet on the same local authority | locally_implemented | UNVERIFIED | Catalogue, source stock, destination outlet |

## Locally achievable next work

Complete safe financial correction and its isolated DB/API regressions; implement reviewed allocated-tip and historical cash-up correction, remaining lot allocation and FEFO, and the isolated training authority. Add two-tenant bypass and arithmetic boundary fixtures; extend crash-window and same-operation recovery tests. Complete dry-run cutover/old-writer fencing and safe supported coordinator design before enabling any production failover. Continue independent backup/WAL/PITR and replacement tooling. Record each result against its exact revision and do not infer a pass from a source or UI test.

Physical qualification, approved customer guides and hosted activation are separate deferred or unauthorized gates. Nothing in this checkpoint authorizes any of them.
## Botswapelo Lounge transition request

The user selected **Botswapelo Lounge** as the target for local Bar authority. The only repository-local tenant evidence located during this continuation is the read-only eligible-tenant list in `docs/ACCOUNTING_RELEASE_READINESS_PACKET.md`, dated 8 September 2026; that older list is not current Lounge data or proof that the local Bar source is reconciled. The configured Supabase project reference did not match its documented reference and its secret values were not read or used; no Supabase CLI is installed. No hosted dataset was read. The technical plan requires a dry-run importer, source hashes/control totals, uncertainty reconciliation, opening balances, old-writer isolation and an explicit per-outlet boundary before activation. No executable dry-run cutover/import tool exists in the local Bar service yet. Therefore target selection is recorded, while the Lounge data inventory, import, authority switch and first local trade remain pending. Hosted and local records must not be manually copied or reconciled by guessed opening totals.

## 28 October follow-up

- The error-visibility audit was closed for page-level local Bar workspace, operations and administration errors with the shared notice/focus behavior. Seven errors remain inline directly under their originating forms to preserve PIN and correction context. Focused visibility checks passed 4/4; the Hospitality POS production build and `bar-local:typecheck` passed (EV-126 and current build/typecheck run). Manual-impact record updated; customer PDF, quick-start, screenshots and packaged-guide verification remain deferred by the user.
- The maintained Bar regression gate was captured at 812 tests: 785 passed, 21 failed, 6 skipped (EV-127). The one non-guide failure was a stale expectation for the unprovisioned sales mailbox; repository guidance confirms the shared support address is the customer-facing mailbox. Its focused suite now passes 15/15 (EV-128). The broad suite has not been rerun after that correction.
- The remaining visible broad-gate failures are historical guide/source hash and PDF applicability/content checks, plus rendered browser recovery blocked by the missing Playwright Chromium executable. No frozen guide baseline or approval checksum was modified. Full local service qualification remains blocked by the 4 GiB isolated-DB preflight; no Lounge data import, authority switch or cutover is claimed.
