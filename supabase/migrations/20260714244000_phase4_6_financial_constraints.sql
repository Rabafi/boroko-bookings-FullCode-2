-- ── Phase 4/6: Financial ledger, constraints, attendance ──────────────────
-- settle_event is now defined solely in 20260714243000_events_venues_depth.sql.
-- This migration creates the financial_ledger table, attendance constraints,
-- lodge-scope triggers, and the event_settlements balance check constraint.
-- RPC references:
--   add_folio_charge(uuid,uuid,numeric,text,text,uuid,text) ← 20260714200000
--   add_folio_payment(uuid,uuid,numeric,text,text)          ← 20260714200000
--   charge_to_corporate_account(uuid,uuid,uuid,numeric,text,boolean,text) ← 20260714236000
--   record_corporate_payment(uuid,uuid,uuid[],numeric,text,text)           ← 20260705105000

-- ══════════════════════════════════════════════════════════════════════════
-- 1. FINANCIAL LEDGER TABLE
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  description text,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_lodge ON public.financial_ledger(lodge_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_entity ON public.financial_ledger(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created ON public.financial_ledger(created_at DESC);

ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. (removed) settle_event — now defined solely in 20260714243000
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 3. STAFF ATTENDANCE — ADD clocked_in_by COLUMN
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS clocked_in_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manager_override_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manager_override_reason text;

-- ══════════════════════════════════════════════════════════════════════════
-- 4a. Partial unique index — prevent duplicate open attendance per day
-- ══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_attendance_open_per_day
  ON public.staff_attendance (lodge_id, staff_id)
  WHERE clock_out_at IS NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 4b. Self-clock-in enforcement trigger
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_self_clock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_staff_lodge_id uuid;
BEGIN
  -- Populate clocked_in_by from the current session
  NEW.clocked_in_by := COALESCE(public.app_current_user_id(), auth.uid());
  v_actor_id := NEW.clocked_in_by;

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

  -- Validate referenced staff belongs to this lodge
  SELECT lodge_id INTO v_staff_lodge_id FROM public.users WHERE id = NEW.staff_id;
  IF v_staff_lodge_id IS DISTINCT FROM NEW.lodge_id THEN
    RAISE EXCEPTION 'Staff member does not belong to this lodge.';
  END IF;

  -- Record manager override audit trail
  NEW.manager_override_by := v_actor_id;
  NEW.manager_override_reason := 'Manager clock-in override';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_attendance_self_clock_in ON public.staff_attendance;
CREATE TRIGGER trg_staff_attendance_self_clock_in
  BEFORE INSERT ON public.staff_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_self_clock_in();

-- ══════════════════════════════════════════════════════════════════════════
-- 4c. Overlapping shift prevention (application/RPC level)
-- ══════════════════════════════════════════════════════════════════════════
-- Overlapping shifts are prevented at the application level via FOR UPDATE
-- locking in the upsert_staff_schedule RPC (20260714210000). The trigger-
-- based approach was race-prone and could not handle overnight shifts.
DROP TRIGGER IF EXISTS trg_staff_schedule_overlap_check ON public.staff_schedules;
DROP FUNCTION IF EXISTS public.prevent_overlapping_shift();

-- Overnight shifts use end_time < start_time convention
-- (e.g., start=22:00, end=06:00 means 22:00-06:00 next day).
-- The application-level overlap check should use:
--   An overnight shift (end_time < start_time) spans midnight.
--   Overlap exists if either:
--     A starts before B ends (accounting for midnight crossing)
--     OR B starts before A ends

-- ══════════════════════════════════════════════════════════════════════════
-- 4d. Lodge-scoped validation trigger for event records
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.validate_lodge_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lodge_id uuid;
BEGIN
  IF TG_ARGV[0] = 'event_booking' THEN
    SELECT lodge_id INTO v_lodge_id FROM public.conference_bookings WHERE id = NEW.event_booking_id;
    IF NOT FOUND OR v_lodge_id IS DISTINCT FROM NEW.lodge_id THEN
      RAISE EXCEPTION 'Lodge mismatch: event_booking % does not belong to lodge %', NEW.event_booking_id, NEW.lodge_id;
    END IF;
  END IF;

  IF TG_ARGV[0] = 'supplier_coordination' THEN
    SELECT lodge_id INTO v_lodge_id FROM public.conference_bookings WHERE id = NEW.event_booking_id;
    IF NOT FOUND OR v_lodge_id IS DISTINCT FROM NEW.lodge_id THEN
      RAISE EXCEPTION 'Lodge mismatch: event_booking % does not belong to lodge %', NEW.event_booking_id, NEW.lodge_id;
    END IF;
  END IF;

  IF TG_ARGV[0] = 'deposit_milestones' THEN
    SELECT lodge_id INTO v_lodge_id FROM public.conference_bookings WHERE id = NEW.event_booking_id;
    IF NOT FOUND OR v_lodge_id IS DISTINCT FROM NEW.lodge_id THEN
      RAISE EXCEPTION 'Lodge mismatch: event_booking % does not belong to lodge %', NEW.event_booking_id, NEW.lodge_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_lodge_scope() TO authenticated;

DROP TRIGGER IF EXISTS trg_event_booking_line_items_lodge_scope ON public.event_booking_line_items;
CREATE TRIGGER trg_event_booking_line_items_lodge_scope
  BEFORE INSERT OR UPDATE ON public.event_booking_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_lodge_scope('event_booking');

DROP TRIGGER IF EXISTS trg_supplier_coordination_lodge_scope ON public.supplier_coordination;
CREATE TRIGGER trg_supplier_coordination_lodge_scope
  BEFORE INSERT OR UPDATE ON public.supplier_coordination
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_lodge_scope('supplier_coordination');

DROP TRIGGER IF EXISTS trg_deposit_milestones_lodge_scope ON public.deposit_milestones;
CREATE TRIGGER trg_deposit_milestones_lodge_scope
  BEFORE INSERT OR UPDATE ON public.deposit_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_lodge_scope('deposit_milestones');

-- ══════════════════════════════════════════════════════════════════════════
-- 4e. Event settlement balance CHECK constraint
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.event_settlements
  DROP CONSTRAINT IF EXISTS event_settlements_balance_check;

ALTER TABLE public.event_settlements
  ADD CONSTRAINT event_settlements_balance_check
  CHECK (balance = final_total - total_paid - coalesce(adjustment_amount, 0));


