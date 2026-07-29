# HotelOS Regression Scenarios Checklist

As of: 2026-07-14  
Phase: 9–13 verification / truth reconciliation  

Status values for each scenario:

| Status | Meaning |
|---|---|
| **pass** | Automated test and/or linked evidence proves the contract in this checkout |
| **fail** | Known broken / unsafe path observed in code |
| **unproved** | Code may exist; end-to-end operator/provider/live DB smoke not proved |

Commercial bundling (Phase 14) is **out of scope** for this checklist.

---

## Scenario checklist (15)

| # | Scenario | Expected contract | Status | Evidence / notes |
|---|---|---|---|---|
| 1 | **Front-desk board truthfulness** | No silent empty success; partial-load warnings; occupancy/balance labelled estimates; exception cards (dirty, OOO/maintenance, unassigned, outstanding, VIP) | **pass** (unit contract) | `tests/hotel-front-desk-board.test.mjs`; `HotelHome.jsx` + `hotel.js` |
| 2 | **Reservation create with rate plan snapshot** | Server quote / rate plan path for stay total; stable offline booking op IDs when queued | **unproved** (e2e) / partial code | `quote_room_stay`, `createBooking`; campsite/room tests exist; packaged hotel smoke unproved |
| 3 | **Guided check-in completes only when online** | Check-in step complete + hotel check-in reject offline; no silent queue of incomplete identity/deposit steps | **pass** (source contract) | `checkinWorkflow.js` online throws; `hotel-offline-entitlement-safety.test.mjs` |
| 4 | **Room move mid-stay with stable idempotency** | Online RPC or offline queue with stable idempotency key; booking cache pending estimate | **pass** (source) | `roomMoves.js` `buildRoomMoveIdempotencyKey` + `queueOperation` |
| 5 | **Folio charge / payment / void / close are online_only** | Offline must not queue financial folio mutations | **pass** | `folioLedger.js` `requireOnline`; offline safety test; no `queueOperation` |
| 6 | **POS charge to guest folio / booking linkage** | Authoritative POS v3 booking/folio link; no double post on retry | **unproved** (hotel outlet e2e) | POS financial suites exist for lodge/HPOS paths; hotel outlet invariant still flagged Partial in completion matrix |
| 7 | **Early/late checkout approval billing gate** | Approve requires online (fee impact); cannot queue approval offline | **pass** (source) | `earlyLateCheckout.js` `requireOnlineApproval` |
| 8 | **Cancellation approve / process / fee online_only** | Fee calc, process, approve reject offline | **pass** (source) | `cancellationPolicies.js` `requireOnlineFinancial` |
| 9 | **Housekeeping assign + inspect** | RPC path exists; readiness affects check-in blockers on board | **unproved** (operator) | Domain RPCs present; no offline queue yet; e2e unproved |
| 10 | **Maintenance OOO blocks availability online_only** | set OOO / OOS / return-to-service reject offline; no silent queue | **pass** (source) | `maintenanceEnterprise.js` `requireOnlineAvailability` |
| 11 | **Night audit close / reopen / resolve online_only** | Cannot close business date offline; reopen requires reason | **pass** (source) | `nightAudit.js` `requireOnline`; reopen reason check |
| 12 | **Corporate charge + payment + suspend online_only** | No offline queue of corporate financial/status mutations | **pass** (fixed 2026-07-14) | `corporateBilling.js` previously queued; now `requireOnline` |
| 13 | **Offline financial safety entitlement** | Key online_only ops reject offline; credit-limit check does not invent within_limit=true offline | **pass** | `tests/hotel-offline-entitlement-safety.test.mjs` |
| 14 | **Multi-property isolation** | Property switch fails closed (no local lodge change on error); group RPCs lodge-scoped | **unproved** (e2e) / partial code | Fail-closed switch in domain/UI (Phase 6–8); live dual-lodge smoke unproved |
| 15 | **Channel / OTA provider fail-closed** | Live adapter never claims OTA success; manual export is local-only | **pass** (unit) | `channelProviderAdapter.js` + `hotel-channel-rates` / enterprise channel tests |

---

## Summary counts (this session)

| Status | Count |
|---|---|
| pass | 10 |
| unproved | 5 |
| fail | 0 (after corporate offline queue fix) |

## Gaps blocking “sellable hotel day complete”

1. Packaged operator smoke for scenarios 2, 6, 9, 11 (live lodge day).
2. Multi-property dual-lodge smoke + repair of `getAllPropertyGroups` RPC call shape (scenario 14).
3. Live payment gateway merchant certification (related provider matrix; not scenario-pass here).
4. POS→hotel folio idempotent posting invariant proof (scenario 6).
5. Housekeeping offline queue (matrix historically claimed queueable; code is online-required).

## How to re-run automated subset

```bash
node --test tests/hotel-offline-entitlement-safety.test.mjs tests/hotel-front-desk-board.test.mjs tests/hotel-core-entitlement-boundary.test.mjs tests/enterprise-offline-contract.test.mjs tests/enterprise-channel-manager.test.mjs
npm run test:enterprise
# 2026-07-14: enterprise gate 28/28 suites pass; offline safety 41/41 with lower-tier
```

Do not mark a scenario **pass** for operator/live behavior based only on string-contract tests.
