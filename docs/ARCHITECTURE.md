# Tsa Bonno HospitalityOS Architecture

Last reviewed: 2026-07-03

## System map

| Surface | Runtime | Authoritative write path | Offline behavior |
|---|---|---|---|
| Desktop front desk | Electron + React | Renderer -> preload/IPC -> `database.js` facade -> domain module -> Supabase RPC | Main desktop queue, append-only local operation journal, local cache, mesh operation sharing, manager offline-mode controls |
| Manager PWA | React browser app | Direct Supabase RPC | Limited device-local queue for approved operational actions |
| Legacy POS | Electron 22 + React | POS renderer -> preload/IPC -> Legacy POS main process -> Supabase RPC | Separate POS cache/queue plus mesh peer synchronization |
| Public booking site | React browser app | Public server-enforced Supabase RPC/API contract | No trusted financial offline mutation path |
| Command Central | Desktop privileged UI | IPC -> admin domains/RPCs | Administrative actions require explicit error handling |
| Supabase | PostgreSQL | RPCs, triggers, constraints, RLS, audit and idempotency tables | Authoritative source of truth |

## Desktop structure

`src/main/database.js` is a compatibility facade, not the complete business-logic implementation. Domain behavior lives under `src/main/domains/`, including bookings, finance, inventory, maintenance, POS, reports, customer credit, sync, authentication, and administration.

The renderer must not connect around the preload/IPC boundary for privileged desktop behavior.

## Mutation contract

Critical mutations should follow this shape:

```text
UI intent
  -> capability and input checks
  -> authoritative RPC with stable idempotency key
  -> atomic database validation and mutation
  -> audit/ledger records
  -> authoritative result
  -> cache/UI reconciliation
```

### Guardrail standard

Every operator-facing workflow must be designed with its failure and recovery paths, not only its happy path. Apply the relevant guardrails: capability and tenant/outlet checks, valid state transitions, server-side input validation, idempotency or duplicate protection, atomic mutation where truth changes, audit/ledger evidence, clear in-product status/error guidance, and focused regression coverage. For financial, inventory, availability, and irreversible actions, these controls are mandatory and must fail closed. A disabled or hidden UI button is helpful guidance, never the authorization boundary.

On an eligible offline path, the RPC name, payload, stable key, and dependencies are stored and replayed. Offline estimates are visibly pending and are not authoritative balances. Desktop queue writes are accompanied by a local operation journal so long-outage work can be audited and exported without changing the final replay authority.

The main desktop queue is stored as durable JSON/JSONL files, not SQLite. The current processor has a promise-level guard against overlapping replay loops and uses dependency-aware item selection so dependent operations are not replayed before their parent operation is complete.

The local mesh shares allowed queued operations, room holds, conflict signals, and repair diagnostics between nearby lodge devices. It does not transfer full cache snapshots and must not be treated as a replacement for Supabase. Supabase RPC replay remains the point where financial, booking, inventory, customer-credit, event, and POS changes become final.

Current desktop offline queue coverage includes normal front-desk and lodge operations: bookings, booking status/payment updates, booking charges, quotation lifecycle and conversion, customer-credit receipt/allocation/refund/reversal, event and conference operations, rate overrides, day use, room/customer/housekeeping updates, expenses, maintenance tickets, inventory item/purchase/adjustment/stocktake work, POS orders/returns/tabs/tables/shifts, supplies, room-supply allocations/moves, and supply/room-supply stocktakes. Booking refund requests can be prepared offline as local pending-approval records with proof references and journal audit, but they are not replayed as refund approvals.

The Manager PWA has its own limited device-local queue stored in browser local storage and scoped per lodge. It blocks high-risk financial mutations such as booking payments and quotation conversion while offline. Its queue health is useful for that device, but it is not the desktop queue and not a financial source of truth.

Legacy POS has a separate queue and authenticated local mesh. Peer requests are signed and checked with timestamp/nonce/lodge identity controls. This mesh is local transport for eligible POS queue state; it does not replace server-side POS RPC validation or cash-up controls.

Accommodation multi-room bookings are not Events & Venues records. Direct bookings and room quotations can capture one lead guest and several selected room lines, then create one normal booking record per room with shared `[STAY_GROUP]` metadata and a group invoice wrapper in `booking_invoice_groups` / `booking_invoice_group_lines`. Each child booking keeps the standard room conflict checks, room status lifecycle, room-level profitability, payment ledger behavior, refund approval boundary, and offline replay contract, while the guest/company receives one customer-facing invoice. Group invoice collection and refund approval are entered once in the invoice UI and allocated across the child booking ledgers.

The public booking site uses lodge-configured offer flags from `settings` through `get_public_booking_offers`. Public guests can submit single-room, multi-room, and full-lodge accommodation requests through `create_online_booking`. Multi-room public requests create the same grouped accommodation invoice wrapper as desktop; full-lodge public requests create one exclusive booking so the existing exclusive-event overlap guard remains authoritative. Day-use and event/venue offers can be displayed publicly from lodge configuration, but they are contact/inquiry paths until dedicated public day-use/event booking RPCs are opened.

The intentional online-only set is narrow and server-verification-heavy: first-time login/session bootstrap, Command Central/admin work, imports and undo-imports, server-authoritative exports/reports/financial validation, license activation, fleet health, formal booking refund approval/final settlement with live manager PIN verification, and POS catalog publishing/setup changes that must create Legacy POS catalog snapshots.

## Financial truth

- `payments` and other ledgers represent deltas.
- Booking totals, paid amounts, balances, and statuses are database-derived.
- POS returns and voids must reverse the appropriate stock, payment, charge, and audit effects.
- Customer credit is a ledger, not a mutable balance field or synthetic booking.
- Reports must distinguish cash movement, revenue recognition, refunds, retained fees, customer credit, and unlinked POS sales.

## Authorization boundaries

- RLS and RPC validation enforce lodge isolation.
- POS writes enforce outlet and operator capability.
- PWA visibility or UI presence does not grant mutation authority.
- Service-role credentials stay server/admin-side and out of distributed clients.
- Public booking APIs must not trust client-calculated price, availability, or payment state.

## Deployment boundaries

The following can move independently:

- desktop installer;
- Legacy POS installer;
- Manager PWA deployment;
- public booking-site deployment;
- marketing site;
- Supabase migrations.

A feature is operational only when every required surface and migration has been deployed. Repository code alone is not proof of production state.
