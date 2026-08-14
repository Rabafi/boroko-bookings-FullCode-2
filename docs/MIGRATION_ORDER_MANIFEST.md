# Migration Order Manifest

As of: 2026-08-14

## Forward financial-truth migrations (local-only, through 2026-08-14)

The repository has advanced beyond the historical manifest above. These migrations are ordered after the linked boundary recorded in `PROJECT_STATE.md` and are not production proof:

| Migration | Purpose | Enablement state |
|---|---|---|
| `20260807120000_bar_accounting_financial_truth_control_plane.sql` | Accounting activation/cutover, source postings, cumulative statements, report runs, expense/POS/payroll/stock controls | local-only; disposable DB and linked deployment required |
| `20260807130000_bar_tab_financial_snapshot_and_concurrency.sql` | Server tab financial snapshot, optimistic versioning, split payload-hash replay | local-only; compatibility smoke required |
| `20260807140000_retire_legacy_cash_drawer_close.sql` | Retires editable lodge-wide drawer close and prevents auto-close; preserves shift cash-up rail | local-only; operator smoke required |
| `20260807150000_budget_versioned_complete_matrix.sql` | Versioned 12-month budget matrix, exact account coverage, maker-checker approval and replay-safe saves | local-only; disposable DB and authorization proof required |
| `20260807160000_ap_payment_payload_hash_and_bank_close_boundary.sql` | AP payment payload identity/replay protection and explicit payment-account attribution | local-only; disposable DB and AP compatibility proof required |
| `20260807170000_bank_packet_without_period_lock.sql` | Bank reconciliation packet completion with immutable statement evidence and no implicit accounting-period lock | local-only; disposable DB and bank smoke required |
| `20260807180000_typed_mappings_and_period_close.sql` | Typed/effective POS mappings, server-authoritative period close/reopen, maker-checker locks | local-only; disposable DB, authorization, and close rehearsal required |
| `20260807190000_accounting_readiness_matrix.sql` | Readiness derived from the current source-coverage matrix | local-only; linked schema verification required |
| `20260807200000_attendance_clockout_idempotency.sql` | Attendance/POS clock-out retry identity and payload-conflict protection | local-only; authenticated concurrency smoke required |
| `20260807210000_atomic_bar_product_pack_save.sql` | Atomic Bar product plus pack-template save with durable replay | local-only; catalog compatibility smoke required |
| `20260807220000_expense_lifecycle_and_source_policy.sql` | Draft/submit/approve/post/pay/void/reverse expense lifecycle, source policy, duplicate control | local-only; expense/AP behavior and maker-checker smoke required |
| `20260807230000_inventory_movement_evidence_and_valuation.sql` | Stock operation/source-document evidence, valuation-method disclosure, and movement coverage | local-only; stock concurrency and historical evidence rehearsal required |
| `20260807240000_payroll_payment_batches_and_idempotency.sql` | Immutable payroll payment batches, stable operation IDs, liability settlement, bank evidence, close | local-only; PII, settlement, bank, and period-close rehearsal required |
| `20260807250000_payroll_statutory_provenance_and_attendance.sql` | Statutory source provenance and attendance-to-payroll disposition register | local-only; current official-rule review and authenticated payroll rehearsal required |
| `20260807260000_financial_truth_linked_lint_cleanup.sql` | Repairs active linked-schema Manage/AP/bank projections and fail-closes stale pre-V2 financial RPC bodies | local-only; linked migration application and zero-error lint required |
| `20260807270000_financial_truth_gap_closure.sql` | Source coverage matrix, typed expense compatibility, deterministic ledger/export and post-cutover source diagnostics | local-only; disposable DB and cross-source reconciliation required |
| `20260807280000_ledger_tax_bank_close_and_manual_workflows.sql` | Complete ledger paging, manual-journal lifecycle, tax/bank/close workflow contracts | local-only; maker-checker and period-close rehearsal required |
| `20260807290000_tax_detail_and_reconciliation_packets.sql` | Explicit tax detail allocations, stale working papers and filing-grade tax packets | local-only; arithmetic fixture and statutory review required |
| `20260807300000_bank_evidence_lock_and_packet_export.sql` | Immutable bank evidence locks, row-level exception controls and complete packet exports | local-only; bank import/match/packet rehearsal required |
| `20260807310000_inventory_purchase_and_stocktake_gl_posting.sql` | Inventory receipt valuation and stocktake variance source-to-GL posting | local-only; concurrent stock and valuation rehearsal required |
| `20260807320000_expense_tax_detail_posting.sql` | Expense tax-detail validation and atomic direct-expense source posting | local-only; expense/AP duplicate and tax rehearsal required |
| `20260807330000_settlement_source_gl_posting.sql` | Settlement fee/clearing-to-bank journal, bank match evidence, payroll-settlement coverage and complete ledger export | local-only; settlement/bank concurrency rehearsal required |
| `20260807340000_cashup_variance_source_gl_posting.sql` | Difference-only cash-over/short journal, typed mappings, cash-up readiness and source coverage | local-only; cash-up tender/variance rehearsal required |
| `20260807350000_tax_amendment_and_adjustment_lifecycle.sql` | Governed tax debit/credit-note adjustments, filed-return amendments, manifest regeneration and durable operation identity | local-only; tax amendment maker-checker and statutory rehearsal required |
| `20260807360000_tax_adjustment_review_read.sql` | Capability-gated tax adjustment evidence read for the Tax page | local-only; authenticated tax review smoke required |
| `20260807370000_accounting_page_exports.sql` | Complete report-run-backed, hashed exports for all eight Accounting pages | local-only; export-completeness and authenticated report-run smoke required |
| `20260807380000_pos_account_voucher_atomic_tender_guard.sql` | Activation-gates account/voucher POS tenders and requires customer/voucher identity in the authoritative breakdown while preserving v3 replay compatibility | local-only; POS tender concurrency/replay and authenticated grant smoke required |
| `20260807390000_historical_cutover_audit_and_approval.sql` | Historical source dry-run classification, deterministic source manifest/hash, validated opening-balance application, and independent cutover approval | local-only; cutover audit packet, reviewer evidence, disposable DB, and linked deployment required |
| `20260807400000_pos_return_authoritative_reversal.sql` | POS return authoritative reversal of stored line/tax/tip/tender allocations, recipe/direct stock evidence, and transaction-time cost/COGS | local-only; return/tender/stock concurrency smoke and authenticated grant verification required |
| `20260807410000_ap_supplier_controls_and_credit_notes.sql` | AP multi-line evidence-bearing bills, currency/tax metadata, supplier statement/control reconciliation, immutable credit-note corrections, and credit-aware payment protection | local-only; AP maker-checker, statement/GL reconciliation, document-hash, concurrency, and authenticated smoke required |
| `20260807420000_accounting_no_ship_grant_lockdown.sql` | Accounting report/export/cutover grant lockdown, server-authored report identity, generic operational-report boundary, and artifact evidence contract | local-only; authenticated denial and service-role-only behavior required |
| `20260807430000_statement_history_and_opening_balance_truth.sql` | Historical account statement retention, scalar opening-balance disposition, deactivation guards, and fail-closed statements | local-only; inactive-account, opening-balance, and arbitrary-period behavior required |
| `20260807440000_pos_operational_tender_subledger.sql` | Optional-Accounting customer-account/voucher subledgers, immutable tender allocation identity, and feature enforcement | local-only; Growth-only and Accounting-active tender concurrency required |
| `20260807450000_pos_return_cumulative_reversal.sql` | Cumulative tip/tender reversal, voucher/account restoration, and original movement-cost reversal | local-only; repeated partial-return and concurrent retry behavior required |
| `20260807460000_financial_source_coverage_registry.sql` | Server-owned financial source registry and source-to-subledger-to-GL coverage contract | local-only; inactive, unsupported, pending, failed, and reconciliation behavior required |
| `20260807470000_bank_reconciliation_semantics.sql` | Bank sign convention, immutable import evidence, match allocations, and maker-checker contract | local-only; running-balance, split/combined allocation, and isolation behavior required |
| `20260807480000_accounting_export_finality.sql` | Page-specific Accounting exports, finality/watermarks, selected payroll export, and detailed evidence | local-only; filter, stale, unapproved, and artifact evidence behavior required |
| `20260807490000_payroll_pii_and_statutory_gate.sql` | Governed payroll source documents, independent statutory approval, masked workspace, and raw-bank export controls | local-only; statutory, missing-worker, PII, and audit behavior required |
| `20260807500000_accounting_export_companion_evidence.sql` | Hash-linked detailed companions and post-write Accounting artifact evidence | local-only; successful-write and failure-retention behavior required |
| `20260807510000_pos_report_control_parity.sql` | Server POS control-total parity, split tender identity, business-date filtering, and item cost snapshots | local-only; screen/export/control equality and >5,000-row behavior required |
| `20260807520000_pos_tender_and_bank_lock_hardening.sql` | Multiple account/voucher tender correction and locked bank allocation review hardening | local-only; over-allocation, completed-packet, and maker-checker behavior required |
| `20260807530000_financial_source_expected_rows_and_accounting_lockdown.sql` | Authoritative source population counts, posting aliases, subledger/GL controls, and expanded Accounting lockdown | local-only; source omission and authenticated denial behavior required |
| `20260807540000_statement_finality_and_cash_flow_classification.sql` | Explicit cash-flow classification and statement dataset/source/balance/close/finality fields | local-only; arbitrary-period statement finality behavior required |
| `20260807550000_bank_match_allocation_workspace.sql` | Locked bank-match candidate evidence, allocation-aware workspace projection, and retirement of loose proposal callers | local-only; candidate isolation, allocation/reviewer behavior, and authenticated bank smoke required |
| `20260807560000_financial_truth_remediation_followup.sql` | Signed POS return/tender controls, cumulative return posting, outlet-scoped exports, statement DTO correction, and bank allocation capacity | local-only; disposable DB, authorization, and linked deployment required |
| `20260812010000_manager_bar_pos_snapshot_finality.sql` | Timezone/business-date-aware Manager Bar POS snapshot with unresolved-source finality and server-confirmed metadata | local-only; PostgreSQL apply, authorization smoke, and Manager PWA production smoke required |
| `20260812020000_manager_bar_pos_report_detail_finality.sql` | Removes synthetic Manager tender/line fallbacks, requires reconciled persisted payment envelopes and recorded item amounts, and exposes detail-level completeness flags | local-only; PostgreSQL apply, report parity/concurrency checks, and authenticated Manager PWA smoke required |
| `20260812030000_pos_export_detail_finality.sql` | Makes the authoritative POS export report-run fail closed on unknown statuses, missing amounts, synthetic/mismatched tenders, and incomplete line evidence | local-only; PostgreSQL apply, screen/export control parity, artifact verification, and authenticated export smoke required |
| `20260812040000_spend_report_finality.sql` | Adds explicit completeness, unresolved-row counts, and server-confirmed truth to inventory/supply spend RPCs | local-only; PostgreSQL apply, null-cost fixture, export parity, and authenticated report smoke required |
| `20260812050000_shared_report_finality.sql` | Adds explicit completeness metadata to shared revenue, P&L, and room-profitability RPCs while preserving existing payload fields | local-only; PostgreSQL apply, null-source fixtures, compatibility smoke, and authenticated report smoke required |
| `20260814010000_bar_pos_authorization_hardening.sql` | Adds capability, lodge/outlet, and audited tab-status authorization wrappers for Bar/POS tabs and financial exports; removes anonymous tab upsert execution | local-only; PostgreSQL compile/apply, outlet-isolation/concurrency smoke, and authenticated Bar/POS smoke required |
| `20260814020000_linked_schema_lint_and_pos_split_hardening.sql` | Persists POS order-to-tab identity, repairs split-payment guard/schema drift, adds cutover approval evidence, fixes partial tax conflict targeting, and installs HypoPG wrappers | applied to linked Supabase; authenticated tab/payment smoke and security-advisor remediation still required |
| `20260814030000_linked_lint_final_repairs.sql` | Makes the managed index advisor resolve protected HypoPG functions and qualifies the voucher-ledger operation variable | applied to linked Supabase; later security-advisor hardening supersedes the interim findings |
| `20260814040000_linked_lint_operation_id_qualification.sql` | Renames the GL posting operation variable to remove ON CONFLICT column ambiguity | applied to linked Supabase; behavior/concurrency smoke still required |
| `20260814050000_hypopg_wrapper_privilege_hardening.sql` | Restricts HypoPG advisor compatibility wrappers to database-admin/service roles | applied to linked Supabase; later security-advisor hardening supersedes the interim findings |
| `20260814060000_security_advisor_rls_and_view_invoker_hardening.sql` | Makes compatibility views security-invoker/barrier and closes direct anon/authenticated access to internal audit, sequence, commercial, and payroll tables | applied to linked Supabase; error-level linked advisors now clean; behavioral/authenticated smoke still required |
| `20260814070000_remove_duplicate_pos_tab_index.sql` | Removes the duplicate `pos_tabs` active-table uniqueness index while retaining the canonical constraint | applied to linked Supabase; duplicate-index warning cleared |
| `20260814080000_security_definer_search_path_hardening.sql` | Sets a fixed trusted search path on 59 mutable `SECURITY DEFINER` functions | applied to linked Supabase; remaining warning-level findings are legacy/grant/policy/configuration items |

The desktop generic POS summary is intentionally not treated as certified from the historical `get_pos_sales_summary` response. After `20260812030000` is deployed, the desktop domain uses `get_pos_financial_report_export_v2` for a certified summary; until then the screen and exports remain visibly incomplete rather than using the legacy synthetic-tender response.

> **Historical manifest.** This document covers only the 2026-07-14 implementation
> chain below. The repository migration chain has advanced well beyond
> `20260714248000` since then; the current local/remote deployment boundary is
> recorded in [PROJECT_STATE.md](../PROJECT_STATE.md). Do not use this manifest to
> reason about post-2026-07-14 migrations.

## Linked database deployment boundary

The linked Supabase migration chain is currently applied through
`20260814080000_security_definer_search_path_hardening.sql`; local and remote
IDs match for all 371 migration rows. Linked SQL lint and error-level database
advisors are clean. The disposable
behavioral database is unavailable on this workstation. Repository migration
presence remains separate from packaged-client and operator workflow proof.
Repository migration presence remains separate from packaged-client and
operator workflow proof.

## 20260714 implementation chain (deployed)

| Migration | Purpose | Final authority |
|---|---|---|
| `20260714210000_staff_scheduling_and_attendance.sql` | Staff scheduling, attendance, leave tables + RPCs | Yes — foundation layer only |
| `20260714220000_asset_registry_and_vendors.sql` | Asset/vendor tables + CRUD RPCs | Yes — foundation layer only |
| `20260714230000_venue_packages.sql` | Venue packages table + CRUD + apply RPC | Yes — foundation layer only |
| `20260714235000_app_require_feature.sql` | `app_require_feature()` helper (service-role bypass added 2026-07-14) | Yes |
| `20260714236000_corporate_billing_repair.sql` | Stronger `charge_to_corporate_account` + `record_corporate_payment` (mandatory idempotency, advisory locks, sequential allocation) | **Yes — authoritative version** (142400 deleted) |
| `20260714241000_staff_operations_depth.sql` | Depth tables (departments, shifts, tasks, training, handovers, etc.) + 23 RPCs | Yes |
| `20260714242000_asset_maintenance_depth.sql` | Depth tables (categories, warranties, inspections, attachments, costs, preventive) + 28 RPCs | Yes |
| `20260714243000_events_venues_depth.sql` | Depth tables (leads, availability, run sheets, suppliers, milestones, settlements) + 23 RPCs — includes **final single settle_event** signature (no `p_final_total`, has `p_idempotency_key`, uses `add_folio_charge`) | Yes |
| `20260714244000_phase4_6_financial_constraints.sql` | `financial_ledger` table, attendance constraints (partial unique index on `lodge_id, staff_id`, self-clock-in with manager override, overnight shift conventions), `validate_lodge_scope` triggers, balance CHECK constraint | Yes |
| `20260714245000_phase2_repair_migration.sql` | Settlement, ledger, folio, attendance, and overlap repair | Superseded where noted by later repairs |
| `20260714246000_phase2_post_deploy_integrity_repair.sql` | Replay ordering, attendance identity lookup, event/package locking, shift-time and balance constraints | Superseded for canonical actor IDs and package replay by `142470` |
| `20260714247000_actor_identity_and_workforce_integrity.sql` | Converts workforce and financial actor FKs to canonical `public.users.id`; strengthens workforce lodge scope; makes package application key mandatory and replay-safe | **Yes — authoritative actor/package repair** |
| `20260714248000_event_settlement_unique_invariant.sql` | Audits duplicates and enforces one settlement per lodge/event | **Yes — authoritative uniqueness invariant** |

## Deleted migrations

| Migration | Reason | Superseded by |
|---|---|---|
| `20260714240000_corporate_folio_idempotency.sql` | Weaker version overrode stronger `142360` implementation | `20260714236000_corporate_billing_repair.sql` |

## RPCs with single definition (overloads removed)

The `settle_event` RPC had an overload created in 14244000. After the 2026-07-14 round 2 cleanup, the overload was removed — 14243000 now contains the **final single definition** with signature `(uuid, uuid, text, numeric, text, text, text)`.

| RPC | Final authoritative migration | Notes |
|---|---|---|
| `charge_to_corporate_account` | `20260714236000_corporate_billing_repair.sql` | Mandatory idempotency (8-128 chars), advisory lock for invoice numbers, sequential allocation, folio payment result checking |
| `record_corporate_payment` | `20260714236000_corporate_billing_repair.sql` | Strict invoice locking, sequential per-invoice allocation, duplicate rejection |
| `settle_event` | `20260714243000_events_venues_depth.sql` | Single definition; no `p_final_total` from client; computes total from locked line items; idempotent via `_claim_financial_operation`; posts balance via `add_folio_charge`; unique settlement per event |

## Scoped change manifest

Eight areas changed across the 2026-07-14 sessions:

1. **Staff/Workforce** — `142100` (foundation) + `142410` (depth) + `staffOperations.js` + IPC + preload + `StaffOperations.jsx` + `/workforce` route
2. **Assets/Maintenance** — `142200` (foundation) + `142420` (depth) + `assetManagement.js` + IPC + preload + `AssetManagement.jsx` + `/assets` route
3. **Events/Venues** — `142300` (packages) + `142430` (depth) + `venueManagement.js` + IPC + preload + `VenueManagement.jsx` + `/venues` route
4. **Corporate financial repair** — `142360` (stronger impl) + `142400` deleted + IPC capability fixes
5. **Entitlement plumbing** — `142350` (app_require_feature) + moduleCatalog + accessControl + entitlementMerge + subscriptionRequests + UpgradeWall + IPC capabilities

Changes in Session 2 (2026-07-14 afternoon — full round 1–9 execution):

6. **Financial event settlement** — `142430` settle_event rewritten: no `p_final_total`, server-side total computation, `add_folio_charge` usage, unique settlement enforcement, `p_idempotency_key` before defaults; preload/IPC/domain/React aligned
7. **Auth helper fix** — `142350` `app_require_feature` changed to `app_is_service_role()` bypass; `app_is_service_role()` helper added using `current_setting('role', true)`
8. **Attendance constraints** — `14244000` partial unique index on `(lodge_id, staff_id)`; self-clock-in with manager override; `manager_override_by`/`_reason` audit columns; staff-belong-to-lodge validation; race-prone overlap trigger replaced with application-level FOR UPDATE + overnight shift documentation
9. **Preload/IPC contract** — 19 IPC handlers fixed; 12 bridge functions forwarded missing filter params; `bridge-contract.test.mjs` (84 tests) verifies exact param counts per channel
10. **Build verification** — `compile-verification.mjs` (9 tests) verifies product workspace, electron-vite configs, and build scripts; enhanced `production-guardrails.test.mjs`
11. **Bridge tests** — `bridge-contract.test.mjs` verifies all 74 bridge functions have matching IPC handlers with correct param counts
