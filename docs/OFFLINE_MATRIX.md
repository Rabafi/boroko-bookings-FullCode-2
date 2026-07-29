# Enterprise Offline Mutation Matrix

Last updated: 2026-07-14
Verified against: live domain sources under `src/main/domains/*` (Phase 9–13 reconciliation).

## Classification

Each mutation is classified as:
- **online_only**: blocked when offline; requires server round-trip; must **not** enter the offline queue
- **queueable**: stored locally and replayed when online; must use stable operation_id/idempotency_key
- **read_online**: reads that prefer live data but degrade gracefully to cache

## Code vs matrix truth (2026-07-14)

| Domain | Matrix intent | Domain enforcement evidence |
|---|---|---|
| `folioLedger.js` | online_only financial mutations | `requireOnline` + `err.onlineOnly`; **no** `queueOperation` on charge/payment/transfer/split/void/close/reopen/lock |
| `nightAudit.js` | online_only close/reopen/resolve | `requireOnline` on close/reopen/resolveException; checks may use cache only for read |
| `corporateBilling.js` | online_only charge/payment/suspend/reactivate | `requireOnline`; **no** offline queue (fixed 2026-07-14 — previously queued unsafely) |
| `checkinWorkflow.js` | steps were matrix-labelled queueable | **Code is online_only** for complete/reset step and hotel check-in/out (throws when offline). Matrix updated to match code — safer than inventing queue without stable op IDs |
| `earlyLateCheckout.js` | approve online_only | `requireOnlineApproval` on early/late approve |
| `cancellationPolicies.js` | approve/process online_only | `requireOnlineFinancial` on calculate/process/approve |
| `maintenanceEnterprise.js` | OOO online_only | `requireOnlineAvailability` on set OOO/OOS/return to service |
| `payments.js` | confirm/webhook online_only | explicit offline reject on confirm/record webhook |
| `abandonedPaymentRecovery.js` | recover online_only | explicit offline reject on recoverSession |
| `roomMoves.js` | queueable | queues `move_booking_room` with stable idempotency key when offline |
| `maintenance.js` (tickets) | queueable create/update/resolve | queues ticket RPCs when offline |
| `channelProviderAdapter.js` | online_only / provider | fail-closed stub — never reports live OTA success |
| Housekeeping command center | matrix queueable | **No** local queue yet — mutations call RPC only (de-facto online-required) |
| Guest messaging send | matrix queueable | Templates/triggers RPC; **no** device-local send queue; no live SMS/WhatsApp transport |

## Financial Mutations

| Feature | Operation | Class | Idempotency | Domain evidence |
|---|---|---|---|---|
| Folio Ledger | addCharge | online_only | RPC-level | `folioLedger.js` `requireOnline` |
| Folio Ledger | addPayment | online_only | RPC-level | same |
| Folio Ledger | transferCharge | online_only | RPC-level | same |
| Folio Ledger | splitFolio | online_only | RPC-level | same |
| Folio Ledger | voidLineItem | online_only | RPC-level | same |
| Folio Ledger | closeFolio | online_only | RPC-level | same |
| Folio Ledger | reopenFolio | online_only | RPC-level | same |
| Folio Ledger | lockFolio | online_only | RPC-level | same |
| Night Audit | close | online_only | RPC-level | `nightAudit.js` |
| Night Audit | reopen | online_only | RPC-level | same |
| Night Audit | resolveException | online_only | RPC-level | same |
| Corporate Billing | charge | online_only | RPC-level | `corporateBilling.js` |
| Corporate Billing | recordPayment | online_only | RPC-level | same |
| Corporate Billing | suspendAccount | online_only | RPC-level | same |
| Corporate Billing | reactivateAccount | online_only | RPC-level | same |
| Payments | confirmPayment | online_only | RPC-level | `payments.js` |
| Payments | recordWebhookPayment | online_only | Event ID | same + server webhook path |

## Operational Mutations

| Feature | Operation | Class | Idempotency | Domain evidence |
|---|---|---|---|---|
| Check-in Workflow | completeStep / resetStep | **online_only** | n/a | `checkinWorkflow.js` throws when offline |
| Check-in Workflow | completeHotelCheckin / Checkout | **online_only** | n/a | same |
| Early/Late Checkout | create request | online_required (no queue yet) | n/a | RPC only — not queued |
| Early/Late Checkout | approve | online_only | operation_id | `requireOnlineApproval` — affects billing |
| Early/Late Checkout | reject | online_required (no queue yet) | n/a | RPC only |
| Cancellation Policies | approve / process / fee calc | online_only | operation_id | `requireOnlineFinancial` |
| Housekeeping | assign / inspect | online_required (no queue yet) | n/a | `housekeepingCommandCenter.js` RPC only |
| Maintenance | ticket create/update/resolve | queueable | operation_id | `maintenance.js` `queueOperation` |
| Maintenance | setRoomOOO / clear / return | online_only | operation_id | `maintenanceEnterprise.js` |
| Document System | publishDocument | online_only / online_required | operation_id | RPC publish path; no offline queue |
| Channel Manager | syncAvailability / import | online_only | operation_id | internal queue + fail-closed provider |
| Abandoned Payments | recoverSession | online_only | operation_id | `abandonedPaymentRecovery.js` |
| Guest Messaging | template/trigger CRUD | online_required | n/a | no device send queue |
| Guest CRM | profile notes | mixed | n/a | verify per mutation before claiming queueable |
| Guest Portal | createRequest / session | online_required | n/a | RPC session/request paths |
| Booking Engine | createIntent | online_only | n/a | returns offline error |
| Room moves | moveBookingRoom | queueable | stable idempotency key | `roomMoves.js` |

## Queue Contract

For **queueable** operations, the offline queue must store:
- RPC name (e.g., `move_booking_room`)
- Payload (serialized JSON)
- Stable operation_id / `_queue_id` (client-generated, stable on retry)
- Idempotency key (can be same as operation_id)
- Dependency list (operation_ids that must complete first)
- Created timestamp
- Retry count
- Last error

Main desktop queue storage remains JSON/JSONL under app user-data (`sync-queue.json`, failed queue, operation journal) — not SQLite.

## Online-Only Handling

For online_only operations when offline:
- Domain throws `Error` with message containing `requires an internet connection` and `err.onlineOnly = true`, **or** returns `{ success: false, onlineOnly: true, error: '...' }` where the call site is result-shaped
- UI must show a clear "Operation requires internet" message
- The operation must **NOT** be added to the offline queue
- Never replace a timeout with a new idempotency key

## Verification

Each mutation in this matrix must have coverage that:
- For online_only: proves the domain source rejects when offline / does not call `queueOperation` for that mutation
- For queueable: proves the function calls `queueOperation` with correct RPC name and stable key structure

Focused suite: `tests/hotel-offline-entitlement-safety.test.mjs` + `tests/enterprise-offline-contract.test.mjs`.
