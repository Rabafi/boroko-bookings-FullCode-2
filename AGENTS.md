# Boroko Bookings Agent Guide

Last reviewed: 2026-07-03

This file contains durable engineering rules. It is not a task tracker.

Before changing the system, read:

- [PROJECT_STATE.md](PROJECT_STATE.md) for the dated implementation state and current worktree caveats.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for application surfaces and execution paths.
- [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md) before releases.

Historical audits and implementation plans are evidence from a point in time, not current instructions unless the user explicitly activates them.

If an external audit claims severe offline/sync issues, first verify the current file layout. As of 2026-07-03, the main desktop queue is JSON/JSONL-backed rather than SQLite, the repository contains server-side idempotency infrastructure for key financial/offline paths, the Manager PWA queue is a limited device-local browser queue, and Legacy POS mesh traffic is signed/authenticated. Still verify live Supabase deployment separately when deployment state matters.

## Product standard

Boroko Bookings is a financial-grade hospitality operations system. It manages bookings, customers, payments, customer credit, POS, inventory, maintenance, reporting, quotations, events, and operational administration.

Correctness means preserving financial and operational truth under concurrency, retries, offline operation, and partial failure.

## Current application surfaces

- Desktop Electron app: renderer -> preload/IPC -> `src/main/database.js` facade -> `src/main/domains/*` -> Supabase.
- Manager PWA: React browser app -> Supabase RPCs and read queries. It has a device-local queue for approved operational actions.
- Legacy POS: separate Electron 22 application under `legacy-pos/`, with its own cache, offline queue, mesh behavior, release lifecycle, and database contract.
- Public booking site: browser app under `booking-site/` using public, server-enforced booking APIs/RPCs.
- Command Central: privileged administration within the desktop application.
- Supabase: PostgreSQL, RLS, RPCs, audit data, and authoritative business rules.

Do not assume a change has only one caller. Trace every relevant desktop, PWA, Legacy POS, public-site, offline-replay, reporting, and migration path.

## Non-negotiable financial rules

1. Financial mutations must use authoritative Supabase RPCs.
2. Never write `bookings.amount_paid` directly from a client.
3. Never author `payment_status` in React, Electron renderer code, or offline estimates.
4. Payments are delta-based ledger entries; authoritative totals come from the database.
5. Offline replay must invoke the same RPC contract and preserve the same stable operation or idempotency key.
6. Never replace an ambiguous timeout with a new idempotency key.
7. POS orders, returns, voids, cash-up, booking charges, refunds, customer credit, and inventory movements must remain atomic and auditable.
8. Database/RPC results are authoritative. Local cache values may be labelled estimates but must not silently become financial truth.

## Database and concurrency rules

- Prefer one atomic RPC over client-side read-modify-write sequences.
- Lock affected rows where concurrent mutation can change the answer.
- Enforce lodge, outlet, actor, capability, and booking ownership server-side.
- Validate idempotency-key reuse against the original operation payload.
- Preserve audit before/after context for financially meaningful changes.
- Treat later migrations as capable of superseding earlier migrations and old audit reports.
- Verify the linked schema when deployment state matters; migration files alone do not prove production deployment.
- Do not expose service-role credentials to desktop renderers, PWAs, POS clients, or public sites.

## Offline and sync rules

- Queue operations, not an invented second business model.
- Store RPC name, payload, stable operation ID/idempotency key, dependencies, and retry state.
- Replaying an operation must not duplicate its financial or inventory effect.
- Do not silently discard failed financial work.
- Distinguish pending local estimates from server-confirmed records.
- Preserve legacy queue compatibility when changing a payload contract.
- Check both the main desktop queue and the separate Legacy POS queue.
- The Manager PWA also has a limited device-local operational queue; do not describe offline queuing as Electron-only.

## Manager PWA boundaries

The PWA connects directly to Supabase and does not use `database.js`.

It is not globally read-only: it supports selected RPC-backed operational actions such as maintenance, expenses, inventory, day-use, conference, quotation, and support/inbox workflows. High-risk financial capabilities must remain explicitly capability-gated and server-enforced. Do not infer permission from a visible button.

## Implementation workflow

1. Inspect the current working tree and preserve unrelated user changes.
2. Treat bug reports and old audits as hypotheses; verify them against current code, later migrations, tests, and, when relevant, the linked database.
3. Trace reads, writes, offline replay, reporting, and authorization before editing.
4. Implement the smallest complete cross-surface fix.
5. Add focused regression coverage for the contract being changed.
6. Run the real scripts from `package.json`; do not invent test names.
7. Update [PROJECT_STATE.md](PROJECT_STATE.md) when a change materially alters architecture, active risks, release state, or deployment assumptions.

## Definition of done

A critical change is not done until:

- database behavior is atomic and concurrency-safe;
- retries are idempotent;
- authorization and lodge/outlet isolation are enforced server-side;
- desktop and every other applicable surface use the same authoritative contract;
- offline replay preserves that contract;
- reports and audit history remain financially consistent;
- focused tests and affected builds pass;
- deployment status is stated accurately rather than inferred.
