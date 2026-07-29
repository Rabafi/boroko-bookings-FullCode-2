-- ═══════════════════════════════════════════════════════════════════════════════
-- 20260714246000_phase2_post_deploy_integrity_repair.sql
-- Forward-only repair addressing post-audit P0/P1 findings:
--   1. Attendance identity model (auth.users vs public.users ID domains)
--   2. Settlement idempotency replay ordering
--   3. apply_venue_package_to_event FOR UPDATE
--   4. GiST constraint null/off-safe predicate
--   5. Settlement balance equation constraint
--   6. Settlement unique constraint (after duplicate audit)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ATTENDANCE TRIGGER — fix identity model
--    staff_attendance.staff_id references auth.users(id)
--    app_current_user_id() returns public.users.id
--    Self-service compares auth.uid() with NEW.staff_id (both auth.users domain)
--    Manager role check uses public.users.role at the lodge
--    user_lodge_roles removed (table does not exist)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_self_clock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_public_id uuid;
  v_actor_auth_id uuid;
  v_staff_lodge_id uuid;
BEGIN
  v_actor_public_id := public.app_current_user_id();
  v_actor_auth_id := auth.uid();
  NEW.clocked_in_by := v_actor_public_id;

  -- Look up the staff member's public.users record via auth_user_id join
  SELECT u.lodge_id INTO v_staff_lodge_id
    FROM public.users u
   WHERE u.auth_user_id = NEW.staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found (auth_user_id % not in public.users)', NEW.staff_id;
  END IF;

  -- Validate staff belongs to this lodge
  IF v_staff_lodge_id IS DISTINCT FROM NEW.lodge_id THEN
    RAISE EXCEPTION 'Staff member does not belong to this lodge.';
  END IF;

  -- Self-service: compare auth.users IDs (both in auth.users domain)
  IF v_actor_auth_id IS NOT NULL AND v_actor_auth_id = NEW.staff_id THEN
    RETURN NEW;
  END IF;

  -- Manager override: verify actor has manager/admin/super_admin role at this lodge
  IF v_actor_public_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_actor_public_id
      AND lodge_id = NEW.lodge_id
      AND role IN ('manager', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Only managers can clock in other staff members.';
  END IF;

  NEW.manager_override_by := v_actor_public_id;
  NEW.manager_override_reason := 'Manager clock-in override';

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. SETTLEMENT — fix idempotency replay ordering
--    Must check claim BEFORE rejecting existing settlement so retries
--    return the original stored result instead of "already settled".
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.settle_event(
  p_event_booking_id uuid,
  p_lodge_id uuid,
  p_idempotency_key text,
  p_adjustment_amount numeric DEFAULT 0,
  p_adjustment_type text DEFAULT NULL,
  p_adjustment_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_hash text;
  v_claim jsonb;
  v_booking public.conference_bookings%ROWTYPE;
  v_totals jsonb;
  v_final_total numeric;
  v_total_paid numeric;
  v_balance numeric;
  v_settled_id uuid;
  v_folio_id uuid;
  v_child_key text;
  v_folio_result jsonb;
  v_user_id uuid;
  v_event_name text;
  v_client_name text;
  v_adj_amount numeric;
  v_result jsonb;
BEGIN
  PERFORM public.app_reject_pwa_financial_mutation();
  PERFORM public.app_require_feature(
    p_lodge_id, 'venue_management',
    ARRAY['manager', 'admin', 'super_admin', 'finance']
  );

  -- 1. Idempotency key validation
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters');
  END IF;
  IF v_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Idempotency key must match [A-Za-z0-9:_-]+');
  END IF;

  -- 2. Adjustment validation
  v_adj_amount := COALESCE(p_adjustment_amount, 0);
  IF v_adj_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Adjustment amount cannot be negative');
  END IF;
  IF v_adj_amount > 0 THEN
    IF p_adjustment_type IS NULL OR p_adjustment_type NOT IN ('credit', 'waiver', 'discount') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Adjustment type required (credit/waiver/discount) when amount > 0');
    END IF;
    IF NULLIF(btrim(coalesce(p_adjustment_reason, '')), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Adjustment reason required when amount > 0');
    END IF;
  END IF;

  -- 3. Event-scoped advisory lock
  PERFORM pg_advisory_xact_lock(
    hashtextextended('event_settle:' || p_event_booking_id::text, 0)
  );

  -- 4. Lock the booking row
  SELECT * INTO v_booking
    FROM public.conference_bookings
   WHERE id = p_event_booking_id AND lodge_id = p_lodge_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;

  -- 5. Idempotency claim — MUST come BEFORE existing-settlement check,
  --    so retries replay the original result instead of "already settled".
  v_hash := encode(
    sha256(
      (coalesce(p_event_booking_id::text, '') || '|' ||
       coalesce(p_lodge_id::text, '') || '|' ||
       coalesce(v_adj_amount::text, '0') || '|' ||
       coalesce(p_adjustment_type, '') || '|' ||
       coalesce(p_adjustment_reason, '') || '|' ||
       coalesce(p_notes, ''))::bytea
    ),
    'hex'
  );

  v_claim := public._claim_financial_operation(
    p_lodge_id, v_key, 'settle_event', p_event_booking_id, v_hash
  );
  IF (v_claim->>'success')::boolean IS NOT TRUE THEN
    RETURN v_claim;
  END IF;
  IF (v_claim->>'found')::boolean = TRUE THEN
    RETURN coalesce(v_claim->'operation_result', v_claim);
  END IF;

  -- 6. Check for existing settlement (SAFE — inside event+booking locks, after claim)
  IF EXISTS (SELECT 1 FROM public.event_settlements
              WHERE event_booking_id = p_event_booking_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event already settled');
  END IF;

  -- 7. Calculate authoritative totals
  v_totals := public._calculate_event_settlement_totals(p_event_booking_id);
  v_final_total := (v_totals->>'final_total')::numeric;
  v_total_paid := (v_totals->>'total_paid')::numeric;
  v_balance := v_final_total - v_total_paid - v_adj_amount;

  IF v_adj_amount > (v_final_total - v_total_paid) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Adjustment of ' || v_adj_amount || ' exceeds outstanding ' || (v_final_total - v_total_paid));
  END IF;

  v_user_id := public.app_current_user_id();

  -- 8. Create settlement record
  INSERT INTO public.event_settlements (
    lodge_id, event_booking_id, settled_by, final_total, total_paid,
    balance, adjustment_reason, adjustment_amount, adjustment_type, notes
  ) VALUES (
    p_lodge_id, p_event_booking_id, v_user_id,
    v_final_total, v_total_paid, GREATEST(0, v_balance),
    p_adjustment_reason, v_adj_amount, p_adjustment_type, p_notes
  ) RETURNING id INTO v_settled_id;

  -- 9. Update booking status
  UPDATE public.conference_bookings SET
    status = 'completed',
    total_amount = v_final_total,
    balance_due = GREATEST(0, v_balance),
    updated_at = now()
   WHERE id = p_event_booking_id AND lodge_id = p_lodge_id;

  -- 10. Three-line ledger entries
  INSERT INTO public.financial_ledger (
    lodge_id, entity_type, entity_id, entry_type, amount,
    description, reference_type, reference_id, created_by
  ) VALUES (
    p_lodge_id, 'event_settlement', v_settled_id,
    'debit', v_final_total,
    'Event settlement total: ' || COALESCE(nullif(v_booking.event_name, ''), nullif(v_booking.client_name, ''), 'Event'),
    'event_booking', p_event_booking_id, v_user_id
  );

  INSERT INTO public.financial_ledger (
    lodge_id, entity_type, entity_id, entry_type, amount,
    description, reference_type, reference_id, created_by
  ) VALUES (
    p_lodge_id, 'event_settlement', v_settled_id,
    'credit', v_total_paid,
    'Event settlement payments received',
    'event_booking', p_event_booking_id, v_user_id
  );

  IF v_adj_amount > 0 THEN
    INSERT INTO public.financial_ledger (
      lodge_id, entity_type, entity_id, entry_type, amount,
      description, reference_type, reference_id, created_by
    ) VALUES (
      p_lodge_id, 'event_settlement', v_settled_id,
      'credit', v_adj_amount,
      'Event adjustment (' || p_adjustment_type || '): ' || COALESCE(p_adjustment_reason, ''),
      'event_booking', p_event_booking_id, v_user_id
    );
  END IF;

  -- 11. Folio posting
  v_event_name := v_booking.event_name;
  v_client_name := v_booking.client_name;

  IF v_booking.exclusive_booking_id IS NOT NULL AND v_balance > 0 THEN
    SELECT id INTO v_folio_id FROM public.hotel_folios
      WHERE lodge_id = p_lodge_id
        AND booking_id = v_booking.exclusive_booking_id
        AND status = 'open'
      LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      v_child_key := left(v_key, 100) || '-folio-charge';

      v_folio_result := public.add_folio_charge(
        p_lodge_id, v_folio_id, v_balance,
        'Event settlement: ' || COALESCE(nullif(v_event_name, ''), nullif(v_client_name, ''), 'Event'),
        'event_settlement', v_settled_id, v_child_key
      );

      IF (v_folio_result->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Folio charge failed: %', COALESCE(v_folio_result->>'error', 'unknown error')
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- 12. Record idempotency
  v_result := jsonb_build_object(
    'success', true, 'settlement_id', v_settled_id,
    'final_total', v_final_total, 'total_paid', v_total_paid,
    'balance', GREATEST(0, v_balance), 'adjustment', v_adj_amount
  );

  PERFORM public._record_financial_operation(
    p_lodge_id, v_key, 'settle_event', p_event_booking_id, v_hash, v_result
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_event(uuid, uuid, text, numeric, text, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. apply_venue_package_to_event — lock the booking row
--    Prevents concurrent settlement from adding package charges mid-settlement.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_venue_package_to_event(
  p_package_id uuid,
  p_event_booking_id uuid,
  p_lodge_id uuid,
  p_quantity int DEFAULT 1,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_item jsonb;
  v_line_id uuid;
  v_count int := 0;
  v_claim jsonb;
  v_request_hash text;
  v_entity_id uuid := coalesce(p_package_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_event_lodge_id uuid;
  v_event_status text;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);

  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be at least 1');
  END IF;

  -- Fetch package
  SELECT * INTO v_pkg FROM public.venue_packages
   WHERE id = p_package_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  -- Lock booking row and verify lodge + terminal status
  SELECT lodge_id, status INTO v_event_lodge_id, v_event_status
    FROM public.conference_bookings
   WHERE id = p_event_booking_id
     FOR UPDATE;
  IF NOT FOUND OR v_event_lodge_id IS DISTINCT FROM p_lodge_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found or belongs to a different lodge');
  END IF;
  IF v_event_status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking is already completed');
  END IF;

  -- Idempotency claim
  IF p_idempotency_key IS NOT NULL THEN
    v_request_hash := encode(
      sha256(
        (p_lodge_id::text || p_package_id::text || p_event_booking_id::text || p_quantity::text || p_idempotency_key)::bytea
      ),
      'hex'
    );
    v_claim := public._claim_financial_operation(
      p_lodge_id, p_idempotency_key, 'apply_venue_package', v_entity_id, v_request_hash
    );
    IF (v_claim->>'success')::boolean IS NOT TRUE THEN
      RETURN v_claim;
    END IF;
    IF (v_claim->>'found')::boolean = true THEN
      RETURN coalesce(v_claim->'operation_result', jsonb_build_object('success', true, 'note', 'Already applied'));
    END IF;
  END IF;

  -- Insert line items from package
  v_count := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_pkg.items)
  LOOP
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) VALUES (
      p_lodge_id, p_event_booking_id,
      COALESCE(v_item->>'line_type', 'package'),
      v_item->>'description',
      COALESCE(v_item->>'category', v_pkg.category),
      COALESCE((v_item->>'quantity')::numeric, 1) * p_quantity,
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'quantity')::numeric, 1) * p_quantity * COALESCE((v_item->>'unit_price')::numeric, 0),
      'package-' || p_package_id || '-item-' || v_count
    ) RETURNING id INTO v_line_id;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) VALUES (
      p_lodge_id, p_event_booking_id, 'package', v_pkg.package_name, v_pkg.category,
      p_quantity, v_pkg.base_price, p_quantity * v_pkg.base_price,
      'package-' || p_package_id || '-base'
    );
    v_count := 1;
  END IF;

  PERFORM public.recalculate_event_totals(p_event_booking_id, p_lodge_id);

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._record_financial_operation(
      p_lodge_id, p_idempotency_key, 'apply_venue_package', v_entity_id, v_request_hash,
      jsonb_build_object('success', true, 'items_added', v_count, 'event_booking_id', p_event_booking_id)
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'items_added', v_count);
END; $$;

GRANT EXECUTE ON FUNCTION public.apply_venue_package_to_event(uuid, uuid, uuid, int, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. GiST CONSTRAINT — add null/off-safe predicate
--    'off' shifts have null times -> unbounded tsrange -> false overlaps.
--    Working shifts require both start and end times.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.staff_schedules
  DROP CONSTRAINT IF EXISTS no_overlap_staff_shifts;

ALTER TABLE public.staff_schedules
  ADD CONSTRAINT no_overlap_staff_shifts
  EXCLUDE USING gist (
    lodge_id WITH =,
    staff_id WITH =,
    tsrange(
      schedule_date + start_time,
      CASE WHEN end_time > start_time THEN schedule_date + end_time
           ELSE schedule_date + end_time + INTERVAL '1 day' END,
      '[)'
    ) WITH &&
  )
  WHERE (shift_label IS DISTINCT FROM 'off' AND start_time IS NOT NULL AND end_time IS NOT NULL);

-- Add column check for consistent null/off rules
ALTER TABLE public.staff_schedules
  DROP CONSTRAINT IF EXISTS staff_schedules_shift_times_check;
ALTER TABLE public.staff_schedules
  ADD CONSTRAINT staff_schedules_shift_times_check
  CHECK (
    (shift_label = 'off' AND start_time IS NULL AND end_time IS NULL)
    OR
    (shift_label IS DISTINCT FROM 'off' AND start_time IS NOT NULL AND end_time IS NOT NULL)
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. SETTLEMENT BALANCE CONSTRAINT — enforce equation
--    Replaces the weak CHECK (balance >= 0) with the full reconciliation.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.event_settlements
  DROP CONSTRAINT IF EXISTS event_settlements_balance_check;
ALTER TABLE public.event_settlements
  ADD CONSTRAINT event_settlements_balance_check
  CHECK (
    balance = GREATEST(0, final_total - total_paid - COALESCE(adjustment_amount, 0))
    AND balance >= 0
    AND total_paid >= 0
    AND final_total >= 0
    AND COALESCE(adjustment_amount, 0) >= 0
  );

-- Require adjustment_type and reason when adjustment_amount > 0
ALTER TABLE public.event_settlements
  DROP CONSTRAINT IF EXISTS event_settlements_adjustment_check;
ALTER TABLE public.event_settlements
  ADD CONSTRAINT event_settlements_adjustment_check
  CHECK (
    (COALESCE(adjustment_amount, 0) = 0)
    OR
    (COALESCE(adjustment_amount, 0) > 0
     AND adjustment_type IS NOT NULL
     AND adjustment_type IN ('credit', 'waiver', 'discount')
     AND NULLIF(btrim(coalesce(adjustment_reason, '')), '') IS NOT NULL)
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. DUPLICATE AUDIT + UNIQUE CONSTRAINT
--    Run the audit first, then add the unique constraint.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  RAISE WARNING 'Phase 2 repair: run duplicate audit before adding unique constraint';
  RAISE WARNING '  SELECT event_booking_id, lodge_id, COUNT(*)';
  RAISE WARNING '    FROM public.event_settlements';
  RAISE WARNING '    GROUP BY event_booking_id, lodge_id';
  RAISE WARNING '    HAVING COUNT(*) > 1;';
END $$;

-- Uncomment AFTER verifying no duplicates:
-- ALTER TABLE public.event_settlements
--   ADD CONSTRAINT event_settlements_unique_event
--   UNIQUE (lodge_id, event_booking_id);

COMMIT;
