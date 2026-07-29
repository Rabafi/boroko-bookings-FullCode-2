# Migration Order Manifest

As of: 2026-07-14

## Linked database deployment boundary

The linked Supabase migration chain is applied through
`20260714248000_event_settlement_unique_invariant.sql` as of 2026-07-14.
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
