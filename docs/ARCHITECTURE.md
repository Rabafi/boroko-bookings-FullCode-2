# Boroko Bookings Architecture

Last reviewed: 2026-06-20

## System map

| Surface | Runtime | Authoritative write path | Offline behavior |
|---|---|---|---|
| Desktop front desk | Electron + React | Renderer -> preload/IPC -> `database.js` facade -> domain module -> Supabase RPC | Main desktop queue, local cache, mesh synchronization |
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

On an eligible offline path, the RPC name, payload, stable key, and dependencies are stored and replayed. Offline estimates are visibly pending and are not authoritative balances.

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

