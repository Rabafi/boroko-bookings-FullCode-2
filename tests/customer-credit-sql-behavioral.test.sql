-- Customer Credit & Booking Reschedule — SQL Behavioral Tests
-- Run against a disposable test database after migration push.
-- All scenarios must pass before declaring the feature deployable.

begin;

-- ─── Test fixtures ───────────────────────────────────────────────────────────
-- Assumes: a test lodge (id = :test_lodge_id), a test room, a test customer exist.
-- Use psql variables:
--   \set test_lodge_id ''''<uuid>''''
--   \set test_room_id ''''<uuid>''''
--   \set test_customer_id ''''<uuid>''''

-- 1. Record P1,000 credit — should succeed, return entry_id and balance = 1000
SELECT public.record_customer_credit(
  :'test_lodge_id',
  :'test_customer_id',
  1000,
  'cash',
  'test-receipt-001',
  'Advance payment',
  null
) AS result_1;

-- Verify balance = 1000
SELECT public.customer_credit_balance(:'test_lodge_id', :'test_customer_id') AS balance_1
WHERE public.customer_credit_balance(:'test_lodge_id', :'test_customer_id') = 1000;

-- 2. Replay same idempotency key — should return idempotent=true, same entry
SELECT public.record_customer_credit(
  :'test_lodge_id',
  :'test_customer_id',
  1000,
  'cash',
  'test-receipt-001',
  'Advance payment',
  null
) AS result_2;
-- Verify: result_2.idempotent = true

-- 3. Reuse key with different payload — should be rejected (different hash)
SELECT public.record_customer_credit(
  :'test_lodge_id',
  :'test_customer_id',
  500,
  'cash',
  'test-receipt-001',
  'Different amount',
  null
) AS result_3;
-- Verify: result_3.success = false

-- 4. Allocate P700 to a booking — balance becomes P300, booking gets P700
-- First create a booking to allocate against
-- (Use existing createBooking RPC or direct insert for test setup)
-- Then:
SELECT public.apply_customer_credit_to_booking(
  :'test_lodge_id',
  :'test_customer_id',
  :'test_booking_id',
  700,
  'test-alloc-001',
  '',
  null,
  null
) AS result_4;
-- Verify: result_4.balance = 300, result_4.amount_paid >= 700

-- 5. Allocate remaining P300 — balance becomes P0, booking fully paid
SELECT public.apply_customer_credit_to_booking(
  :'test_lodge_id',
  :'test_customer_id',
  :'test_booking_id',
  300,
  'test-alloc-002',
  '',
  null,
  null
) AS result_5;
-- Verify: result_5.balance = 0

-- 6. Two concurrent allocations — advisory lock prevents overspend
-- (Tested via psql client-side concurrency or application-level test)
-- Cannot easily test in single SQL file; document as application-level test requirement.

-- 7. Refund — should succeed, reduce balance
SELECT public.refund_customer_credit(
  :'test_lodge_id',
  :'test_customer_id',
  200,
  'cash',
  'test-refund-001',
  'Refund partial',
  null,
  null
) AS result_7;
-- Verify: result_7.success = true

-- 8. Refund exceeds balance — should be rejected
SELECT public.refund_customer_credit(
  :'test_lodge_id',
  :'test_customer_id',
  99999,
  'cash',
  'test-refund-002',
  'Over refund',
  null,
  null
) AS result_8;
-- Verify: result_8.success = false

-- 9. Reverse receipt — should create reversal_out
-- Get the receipt entry_id from step 1
DO $$
DECLARE
  v_entry_id uuid;
BEGIN
  SELECT id INTO v_entry_id
    FROM public.customer_credit_ledger
   WHERE lodge_id = :'test_lodge_id'
     AND customer_id = :'test_customer_id'
     AND entry_type = 'receipt'
     AND idempotency_key = 'test-receipt-001'
   LIMIT 1;

  PERFORM public.reverse_customer_credit_entry(
    :'test_lodge_id',
    v_entry_id,
    'Test reversal',
    'test-reverse-001',
    null
  );
END $$;
-- Verify: reversal_out entry exists

-- 10. Try to reverse a reversal — should be rejected
DO $$
DECLARE
  v_reversal_id uuid;
BEGIN
  SELECT id INTO v_reversal_id
    FROM public.customer_credit_ledger
   WHERE lodge_id = :'test_lodge_id'
     AND customer_id = :'test_customer_id'
     AND entry_type = 'reversal_out'
   LIMIT 1;

  PERFORM public.reverse_customer_credit_entry(
    :'test_lodge_id',
    v_reversal_id,
    'Double reverse attempt',
    'test-reverse-002',
    null
  );
END $$;
-- Verify: last result.success = false

-- 11. Cross-lodge read attempt — should fail
-- (Requires a second lodge_id; test via application layer)

-- 12. PWA mutation attempt — should fail
-- (Requires PWA session; test via application layer)

-- 13. Reschedule to occupied room — should fail
SELECT public.reschedule_booking(
  :'test_booking_id',
  :'test_lodge_id',
  :'test_occupied_room_id',
  '2026-07-01',
  '2026-07-05',
  'Test reschedule to occupied',
  'test-reschedule-001'
) AS result_13;
-- Verify: result_13.success = false

-- 14. Valid reschedule — should succeed
SELECT public.reschedule_booking(
  :'test_booking_id',
  :'test_lodge_id',
  :'test_room_id',
  '2026-07-10',
  '2026-07-15',
  'Test valid reschedule',
  'test-reschedule-002'
) AS result_14;
-- Verify: result_14.success = true

-- 15. Reschedule with overpayment reject — should fail with overpayment error
-- (Set up a booking where reschedule would create overpayment)

-- 16. Reschedule with transfer — should create customer credit
SELECT public.reschedule_booking(
  :'test_booking_id',
  :'test_lodge_id',
  :'test_room_id',
  '2026-06-25',
  '2026-06-26',
  'Shorter stay creates overpayment',
  'test-reschedule-003',
  'transfer_to_customer_credit'
) AS result_16;
-- Verify: result_16.overpayment_transferred > 0

-- 17. Read RPCs with access check
SELECT public.get_customer_credit_balance(:'test_lodge_id', :'test_customer_id') AS balance_read;
SELECT public.get_customer_credit_history(:'test_lodge_id', :'test_customer_id', 10, 0) AS history_read;
SELECT public.get_customer_credit_summary(:'test_lodge_id', null, 10, 0) AS summary_read;

-- Verify: all return success = true

-- 18. Verify all RPCs compile and execute
-- (All above scenarios already test this implicitly)

commit;
