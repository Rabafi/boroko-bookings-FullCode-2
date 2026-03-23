# TASK.md

## 🎯 Current Objective

Stabilize Boroko Bookings into a **financially safe, production-grade system** by fixing data integrity and concurrency issues.

---

## 🚨 Current Focus (ACTIVE TASK)

### Fix: Deposit Not Recorded During Booking Creation

### Problem

* Booking is created successfully
* Deposit entered in UI is NOT reflected in:

  * `amount_paid`
  * `payment_status`

### Root Cause

* Deposit is no longer written directly (correct)
* BUT booking creation does NOT trigger:
  `update_booking_payment` RPC

---

## ✅ Expected Behavior

When creating a booking:

1. Booking is inserted with:

   * `amount_paid = 0`
2. IF deposit > 0:

   * Call RPC:
     `update_booking_payment`
3. Final result:

   * `amount_paid = deposit`
   * `payment_status = partial | paid`

---

## 🔧 Implementation Requirements

* Deposit must be passed from frontend → backend
* `createBooking` must call RPC AFTER insert
* Must use:

  ```js
  supabase.rpc('update_booking_payment', ...)
  ```
* Must NOT:

  * update `amount_paid` directly
  * calculate status in frontend

---

## 🧪 Validation Criteria

A fix is correct ONLY if:

1. Create booking (total = 900, deposit = 500)
2. Database shows:

   * `amount_paid = 500`
   * `payment_status = partial`
3. Works after refresh
4. Works under concurrent use

---

## 📊 Current System Status

### ✅ Completed

* Payment updates are atomic via RPC
* Direct updates to `amount_paid` removed
* Sync queue supports RPC operations

---

### ⚠️ In Progress

* Deposit → payment linkage

---

### ❌ Pending (Next Phases)

#### Phase 2 — Booking Integrity

* Force booking creation through RPC
* Prevent double booking (offline sync fix)

#### Phase 3 — Sync Safety

* Add idempotency keys
* Prevent duplicate operations

#### Phase 4 — Revenue Integrity

* Link POS orders to bookings
* Ensure all charges affect booking totals

#### Phase 5 — Financial Audit

* Add transaction log table
* Track all financial operations

---

## 🔒 Constraints

* Do NOT introduce direct DB writes for financial fields
* Do NOT bypass RPC logic
* Do NOT duplicate logic across frontend/backend

---

## 🧠 Instructions for Claude

* Focus ONLY on the active task unless instructed otherwise
* Provide minimal, precise code changes
* Always maintain atomicity and concurrency safety
* Assume real-world multi-user environment

---

## 🚀 Next Task (After Completion)

Once deposit flow is fixed:

→ Move to:
**Offline Booking Sync Fix (Prevent Double Booking)**

---
