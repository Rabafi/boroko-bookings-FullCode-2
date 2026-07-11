# Enterprise Offline Mutation Matrix

Last updated: 2026-07-04

## Classification

Each mutation is classified as:
- **online_only**: blocked when offline; requires server round-trip
- **queueable**: stored locally and replayed when online; must use stable operation_id/idempotency_key
- **read_online**: reads that prefer live data but degrade gracefully to cache

## Financial Mutations

| Feature | Operation | Class | Idempotency | Notes |
|---|---|---|---|---|
| Folio Ledger | addCharge | online_only | RPC-level | Financial atomicity requires server lock |
| Folio Ledger | addPayment | online_only | RPC-level | Payment must be authorized server-side |
| Folio Ledger | transferCharge | online_only | RPC-level | Double-entry must be atomic |
| Folio Ledger | splitFolio | online_only | RPC-level | Atomic split requires server |
| Folio Ledger | voidLineItem | online_only | RPC-level | Audit trail must be server-created |
| Folio Ledger | closeFolio | online_only | RPC-level | Balance check requires live data |
| Folio Ledger | reopenFolio | online_only | RPC-level | Status must be server-authoritative |
| Folio Ledger | lockFolio | online_only | RPC-level | Lock must be server-enforced |
| Night Audit | close | online_only | RPC-level | Cannot close without live data |
| Night Audit | reopen | online_only | RPC-level | Requires server authorization |
| Night Audit | resolveException | online_only | RPC-level | Exception state is server-side |
| Corporate Billing | charge | online_only | RPC-level | Financial mutation |
| Corporate Billing | recordPayment | online_only | RPC-level | Payment recording |
| Corporate Billing | suspendAccount | online_only | RPC-level | Status change |
| Corporate Billing | reactivateAccount | online_only | RPC-level | Status change |
| Payments | confirmPayment | online_only | RPC-level | Payment confirmation |
| Payments | recordWebhookPayment | online_only | Event ID | Server-side webhook only |

## Operational Mutations

| Feature | Operation | Class | Idempotency | Notes |
|---|---|---|---|---|
| Check-in Workflow | completeStep | queueable | operation_id | Step completion can be deferred |
| Check-in Workflow | resetStep | queueable | operation_id | |
| Early/Late Checkout | create | queueable | operation_id | Request can be queued |
| Early/Late Checkout | approve | online_only | operation_id | Approval affects billing |
| Early/Late Checkout | reject | queueable | operation_id | |
| Cancellation Policies | approve | online_only | operation_id | Affects financials/refunds |
| Cancellation Policies | process | online_only | operation_id | Refund processing |
| Housekeeping | assignRoom | queueable | operation_id | Assignment can be deferred |
| Housekeeping | completeInspection | queueable | operation_id | |
| Maintenance | setRoomOOO | online_only | operation_id | Affects availability |
| Maintenance | clearRoomOOO | online_only | operation_id | Affects availability |
| Document System | publishDocument | online_only | operation_id | Publishing requires server |
| Channel Manager | syncAvailability | online_only | operation_id | Must push to OTA when online |
| Channel Manager | importReservations | online_only | operation_id | Must fetch from OTA |
| Abandoned Payments | recoverSession | online_only | operation_id | Payment recovery is financial |
| Guest Messaging | sendMessage | queueable | operation_id | Can be queued and sent later |
| Guest CRM | updateProfile | queueable | operation_id | Profile changes can merge |
| Guest Portal | createRequest | queueable | operation_id | Guest request can be queued |
| Booking Engine | createIntent | queueable | operation_id | Analytics intent can be deferred |

## Queue Contract

For queueable operations, the offline queue must store:
- RPC name (e.g., 'checkinWorkflow:completeStep')
- Payload (serialized JSON)
- Stable operation_id (UUID, generated client-side)
- Idempotency key (can be same as operation_id)
- Dependency list (operation_ids that must complete first)
- Created timestamp
- Retry count
- Last error

## Online-Only Handling

For online_only operations when offline:
- The domain function returns { success: false, error: 'This operation requires an internet connection', onlineOnly: true }
- Any calling UI should show a clear "Operation requires internet" message
- The operation must NOT be added to the offline queue

## Verification

Each mutation in this matrix must have a test in an enterprise test file that:
- For online_only: proves the domain function rejects the operation when state.isOnline = false
- For queueable: proves the function calls queueOperation with correct RPC name and payload structure
