-- ═══════════════════════════════════════════════════════════════════════════════
-- 20260714245000_phase2_repair_migration.sql
-- Forward-only repair addressing all Phase 2 audit findings:
--   1. settle_event — broken RPC (nonexistent helper, nonexistent column,
--      wrong total calculation, race condition, unsafe idempotency, 
--      missing adjustment_type, folio reference mismatch)
--   2. app_is_service_role — overwritten with narrower implementation
--   3. Attendance trigger — lodge check bypassed on self-service
--   4. Schedule overlap — absent, replaced with GiST exclusion constraint
--   5. Schedule upsert — plain INSERT (multi-shift-day model)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. EVENT SETTLEMENT REPAIR
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1a. Add missing adjustment_type column to event_settlements
ALTER TABLE public.event_settlements
  ADD COLUMN IF NOT EXISTS adjustment_type text;

-- 1b. Add the balance constraint that 14244000 attempted
ALTER TABLE public.event_settlements
  DROP CONSTRAINT IF EXISTS event_settlements_balance_check;
ALTER TABLE public.event_settlements
  ADD CONSTRAINT event_settlements_balance_check
  CHECK (balance >= 0);

-- 1c. Canonical total calculator — mirrors recalculate_event_totals exactly
CREATE OR REPLACE FUNCTION public._calculate_event_settlement_totals(
  p_event_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resource_total numeric := 0;
  v_extra_total numeric := 0;
  v_pos_total numeric := 0;
  v_amount_paid numeric := 0;
  v_total numeric := 0;
BEGIN
  SELECT COALESCE(SUM(subtotal), 0) INTO v_resource_total
    FROM public.event_booking_resources
   WHERE event_booking_id = p_event_booking_id;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_extra_total
    FROM public.event_booking_line_items
   WHERE event_booking_id = p_event_booking_id
     AND voided_at IS NULL
     AND (line_type IS NULL OR line_type <> 'pos');

  SELECT COALESCE(SUM(subtotal), 0) INTO v_pos_total
    FROM public.event_booking_line_items
   WHERE event_booking_id = p_event_booking_id
     AND voided_at IS NULL
     AND line_type = 'pos';

  SELECT COALESCE(SUM(
    CASE
      WHEN lower(coalesce(type, '')) = 'refund' THEN -abs(amount)
      ELSE amount
    END
  ), 0) INTO v_amount_paid
    FROM public.payments
   WHERE conference_booking_id = p_event_booking_id;

  v_total := round(v_resource_total + v_extra_total + v_pos_total, 2);

  RETURN jsonb_build_object(
    'resource_total', v_resource_total,
    'extra_total', v_extra_total,
    'pos_total', v_pos_total,
    'total_paid', v_amount_paid,
    'final_total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._calculate_event_settlement_totals(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._calculate_event_settlement_totals(uuid) FROM public, anon, authenticated;

-- 1d. Replace settle_event — authoritative version
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
  -- 0a. PWA guard — financial mutations must come from the desktop app
  PERFORM public.app_reject_pwa_financial_mutation();

  -- 0b. Feature entitlement — venue_management add-on + role check
  PERFORM public.app_require_feature(
    p_lodge_id,
    'venue_management',
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
      RETURN jsonb_build_object('success', false, 'error', 'Adjustment type is required and must be credit, waiver, or discount when amount is non-zero');
    END IF;
    IF NULLIF(btrim(coalesce(p_adjustment_reason, '')), '') IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Adjustment reason is required when amount is non-zero');
    END IF;
  END IF;

  -- 3. Event-scoped advisory lock — serializes ALL settlement attempts
  --    for this event, regardless of idempotency key.
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

  -- 5. Check for existing settlement — SAFE now (inside event lock + booking lock)
  IF EXISTS (SELECT 1 FROM public.event_settlements
              WHERE event_booking_id = p_event_booking_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event already settled');
  END IF;

  -- 6. Idempotency claim — key-scoped
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

  -- 7. Calculate authoritative totals — uses canonical recalculate_event_totals rules
  v_totals := public._calculate_event_settlement_totals(p_event_booking_id);
  v_final_total := (v_totals->>'final_total')::numeric;
  v_total_paid := (v_totals->>'total_paid')::numeric;
  v_balance := v_final_total - v_total_paid - v_adj_amount;

  -- Adjustment cannot exceed outstanding
  IF v_adj_amount > (v_final_total - v_total_paid) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Adjustment of ' || v_adj_amount || ' exceeds outstanding balance of ' || (v_final_total - v_total_paid));
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

  -- 10. Authoritative ledger entries — total debit, payment credit, optional adjustment credit
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

  -- 11. Folio posting for remaining balance
  v_event_name := v_booking.event_name;
  v_client_name := v_booking.client_name;

  IF v_booking.exclusive_booking_id IS NOT NULL AND v_balance > 0 THEN
    SELECT id INTO v_folio_id FROM public.hotel_folios
      WHERE lodge_id = p_lodge_id
        AND booking_id = v_booking.exclusive_booking_id
        AND status = 'open'
      LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      -- Deterministic child key — well under 128-char limit
      v_child_key := left(v_key, 100) || '-folio-charge';

      v_folio_result := public.add_folio_charge(
        p_lodge_id,
        v_folio_id,
        v_balance,
        'Event settlement: ' || COALESCE(nullif(v_event_name, ''), nullif(v_client_name, ''), 'Event'),
        'event_settlement',
        v_settled_id,
        v_child_key
      );

      IF (v_folio_result->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Folio charge failed: %', COALESCE(v_folio_result->>'error', 'unknown error')
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    -- No open folio -> balance stays as accounts receivable on the booking
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
-- 2. RESTORE app_is_service_role — canonical baseline semantics
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.app_is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.app_request_role() IN ('service_role', 'supabase_admin', 'postgres');
$$;

GRANT EXECUTE ON FUNCTION public.app_is_service_role() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ATTENDANCE TRIGGER REPAIR — validate lodge BEFORE early return
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_self_clock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
BEGIN
  NEW.clocked_in_by := COALESCE(public.app_current_user_id(), auth.uid());
  v_actor_id := NEW.clocked_in_by;

  -- Validate staff belongs to this lodge — runs for ALL paths (self + manager)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_lodge_roles
    WHERE user_id = NEW.staff_id AND lodge_id = NEW.lodge_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = NEW.staff_id AND lodge_id = NEW.lodge_id
  ) THEN
    RAISE EXCEPTION 'Staff member does not belong to this lodge.';
  END IF;

  -- Self-service: clocking in oneself is always allowed
  IF v_actor_id = NEW.staff_id THEN
    RETURN NEW;
  END IF;

  -- Manager override: verify actor has workforce_scheduling.manage capability
  IF NOT EXISTS (
    SELECT 1 FROM public.user_lodge_roles
    WHERE user_id = v_actor_id
      AND lodge_id = NEW.lodge_id
      AND role IN ('manager', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Only managers can clock in other staff members.';
  END IF;

  -- Record manager override audit trail
  NEW.manager_override_by := v_actor_id;
  NEW.manager_override_reason := 'Manager clock-in override';

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. SCHEDULING REPAIR — overlap guard + multi-shift days
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4a. Enable btree_gist for GiST exclusion constraint on uuid/time types
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 4b. Drop the old unique index (one-row-per-day model)
DROP INDEX IF EXISTS public.idx_staff_schedules_unique_day;

-- 4c. GiST exclusion constraint prevents overlapping shifts
--     Overnight shift convention: end_time < start_time means roll to next day
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
  );

-- 4d. Replace upsert_staff_schedule — plain INSERT (multi-shift days allowed)
--     Overlap prevented by GiST exclusion constraint above.
CREATE OR REPLACE FUNCTION public.upsert_staff_schedule(
  p_lodge_id uuid,
  p_staff_id uuid,
  p_schedule_date date,
  p_shift_label text,
  p_start_time time,
  p_end_time time,
  p_role_at_shift text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.app_require_feature(
    p_lodge_id, 'workforce_management',
    ARRAY['manager', 'admin', 'super_admin']
  );

  INSERT INTO public.staff_schedules (
    lodge_id, staff_id, schedule_date, shift_label,
    start_time, end_time, role_at_shift, notes, created_by
  ) VALUES (
    p_lodge_id, p_staff_id, p_schedule_date, p_shift_label,
    p_start_time, p_end_time, p_role_at_shift, p_notes, auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_staff_schedule(uuid, uuid, date, text, time, time, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. DUPLICATE-AUDIT PLACEHOLDER
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run this separately AFTER the migration to check for pre-existing duplicates:
--
--   SELECT event_booking_id, lodge_id, COUNT(*)
--     FROM public.event_settlements
--     GROUP BY event_booking_id, lodge_id
--     HAVING COUNT(*) > 1;
--
-- If duplicates are found, resolve them before uncommenting the unique constraint:
--
--   ALTER TABLE public.event_settlements
--     ADD CONSTRAINT event_settlements_unique_event
--     UNIQUE (lodge_id, event_booking_id);

COMMIT;
