# AGENTS.md

## 🧠 Project Overview

**Boroko Bookings** is a hospitality operations system designed to manage:

* Room bookings
* Customer data
* Payments and balances
* POS (food, services)
* Inventory
* Reporting

This system must behave as a **financial-grade, real-world business system**, not a simple CRUD app.

---

## 🏗️ Architecture

### Core Stack

* **Electron Desktop App**

  * Uses `database.js` as backend logic layer
  * Handles offline sync and IPC communication

* **Manager PWA (React)**

  * Connects directly to Supabase
  * Does NOT use `database.js`

* **Backend**

  * Supabase (PostgreSQL + RPC functions)

* **Sync System**

  * Custom offline queue (Electron only)

---

### Execution Paths (CRITICAL)

There are TWO independent data mutation paths:

1. **Electron Path**
   UI → IPC → `database.js` → Supabase

2. **PWA Path**
   UI → Supabase مباشرة (direct)

⚠️ Any fix must consider BOTH paths.

---

## 🔒 Core Engineering Rules (NON-NEGOTIABLE)

1. **ALL financial mutations MUST go through Supabase RPCs**
2. **NEVER update `amount_paid` directly**
3. **NEVER calculate `payment_status` in frontend**
4. **Offline sync MUST replay the exact same RPC calls**
5. **NO raw inserts for critical operations (bookings, payments, inventory)**
6. **Backend (DB/RPC) is the single source of truth**

---

## 💰 Financial System Rules

* Payments are **incremental (delta-based)**
* `amount_paid = SUM(all payments)`
* `payment_status` is derived:

  * `unpaid` → 0 paid
  * `partial` → 0 < paid < total
  * `paid` → paid ≥ total

---

### Deposit Handling (CRITICAL)

* Deposits MUST NOT be written directly to `amount_paid`
* Deposits MUST be processed via:

```js
supabase.rpc('update_booking_payment', ...)
```

---

## ⚠️ Known Issues (Current)

* Deposit during booking creation is not consistently recorded
* Offline booking sync may bypass RPC (risk of double booking)
* No idempotency for sync operations (duplicate replay risk)
* POS is not fully linked to bookings (revenue leakage risk)
* Inventory updates are not atomic

---

## 🎯 Current Priorities

1. Fix **deposit → payment RPC flow**
2. Fix **offline booking sync (prevent double bookings)**
3. Implement **idempotency for sync queue**
4. Link **POS charges to bookings**
5. Add **financial audit logging**

---

## 🧱 Design Principles

* System must handle **real-world operational pressure**
* Must support **concurrent users safely**
* Must maintain **financial accuracy at all times**
* Prefer **database-enforced logic over frontend logic**
* Avoid duplication of business logic across layers

---

## ⚙️ Backend Patterns

### ✅ Preferred

* Supabase RPC (PL/pgSQL)
* Row-level locking (`FOR UPDATE`)
* Atomic updates
* Server-side validation

---

### ❌ Forbidden

* Direct `.update()` on financial fields
* Frontend-derived totals
* Multi-step read → modify → write patterns
* Silent overwrites

---

## 🔁 Offline Sync Rules

* Queue must store **operations**, not raw data

* Use:

  * `type: 'rpc'`
  * function name
  * payload

* Replay must call:

```js
supabase.rpc(...)
```

---

## 🧾 Future Requirements

* Transaction/audit log table
* Idempotency keys for all critical operations
* Booking charges ledger (POS integration)
* Financial reporting consistency (cash vs system)

---

## 🧠 Instructions for Codex

When modifying this system:

* Always prioritize **data integrity over convenience**
* Assume **multiple users acting concurrently**
* Prefer **RPC-based solutions**
* Do NOT introduce shortcuts that bypass backend logic
* Ensure fixes work for BOTH:

  * Electron (via `database.js`)
  * PWA (direct Supabase)

If unsure:
→ choose the **safer, more atomic approach**

---

## 🚨 Critical Warning

This system manages real financial data.

Any incorrect implementation may cause:

* Revenue loss
* Incorrect balances
* Broken reports

Always validate:

* concurrency safety
* atomicity
* correctness of totals

---

## ✅ Definition of “Correct”

A solution is ONLY correct if:

* It is **atomic**
* It is **concurrency-safe**
* It uses **RPC or database-level enforcement**
* It does NOT rely on frontend calculations
* It preserves **financial truth under all conditions**

---
