-- Events & Venues Foundation
-- Generalizes conference_bookings into a full event management system.
-- Creates event resources, line items, room links, POS event linkage, and financial audit support.
-- All financial mutations are RPC-based with idempotency keys.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. GENERALIZE conference_bookings
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add new columns using safe nullable defaults for incremental rollout
ALTER TABLE public.conference_bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'conference',
  ADD COLUMN IF NOT EXISTS reservation_scope text NOT NULL DEFAULT 'venue_only',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'reserved',
  ADD COLUMN IF NOT EXISTS adults integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS children integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extras_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BWP',
  ADD COLUMN IF NOT EXISTS exclusive_booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS create_idempotency_key text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Constraints
DO $$
BEGIN
  -- Valid event type
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conference_bookings_event_type_chk'
  ) THEN
    ALTER TABLE public.conference_bookings
      ADD CONSTRAINT conference_bookings_event_type_chk
      CHECK (event_type IN ('conference','meeting','party','wedding','corporate','pool_party','braai','reception','other'));
  END IF;

  -- Valid reservation scope
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conference_bookings_reservation_scope_chk'
  ) THEN
    ALTER TABLE public.conference_bookings
      ADD CONSTRAINT conference_bookings_reservation_scope_chk
      CHECK (reservation_scope IN ('venue_only','venue_with_rooms','exclusive_lodge'));
  END IF;

  -- Valid status
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conference_bookings_status_chk'
  ) THEN
    ALTER TABLE public.conference_bookings
      ADD CONSTRAINT conference_bookings_status_chk
      CHECK (status IN ('draft','reserved','confirmed','active','completed','cancelled'));
  END IF;

  -- Non-negative financial fields
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conference_bookings_non_negative_financials_chk'
  ) THEN
    ALTER TABLE public.conference_bookings
      ADD CONSTRAINT conference_bookings_non_negative_financials_chk
      CHECK (
        subtotal >= 0 AND extras_total >= 0 AND charges_total >= 0
        AND amount_paid >= 0 AND balance_due >= 0
        AND adults >= 0 AND children >= 0
      );
  END IF;
END $$;

-- Idempotency index
CREATE UNIQUE INDEX IF NOT EXISTS conference_bookings_lodge_idempotency_uidx
  ON public.conference_bookings (lodge_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

-- Exclusive booking uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS conference_bookings_exclusive_booking_uidx
  ON public.conference_bookings (exclusive_booking_id)
  WHERE exclusive_booking_id IS NOT NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS conference_bookings_lodge_status_idx
  ON public.conference_bookings (lodge_id, status);

CREATE INDEX IF NOT EXISTS conference_bookings_lodge_date_idx
  ON public.conference_bookings (lodge_id, booking_date);

CREATE INDEX IF NOT EXISTS conference_bookings_customer_idx
  ON public.conference_bookings (customer_id)
  WHERE customer_id IS NOT NULL;

-- Backfill existing rows
UPDATE public.conference_bookings
SET
  event_name = COALESCE(NULLIF(btrim(company), ''), NULLIF(btrim(client_name), ''), 'Conference'),
  event_type = 'conference',
  reservation_scope = 'venue_only',
  adults = COALESCE(attendees, 0),
  amount_paid = COALESCE(deposit_paid, 0),
  balance_due = GREATEST(0, COALESCE(total_amount, 0) - COALESCE(deposit_paid, 0)),
  updated_at = COALESCE(updated_at, now())
WHERE event_name IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. EVENT BOOKING RESOURCES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.event_booking_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  resource_name_snapshot text NOT NULL,
  resource_type_snapshot text NOT NULL DEFAULT 'venue',
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  exclusive_use boolean NOT NULL DEFAULT false,
  unit_price_snapshot numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT event_resource_time_check CHECK (end_at > start_at),
  CONSTRAINT event_resource_quantity_check CHECK (quantity > 0),
  CONSTRAINT event_resource_non_negative CHECK (unit_price_snapshot >= 0 AND subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS event_booking_resources_lodge_conflict_idx
  ON public.event_booking_resources (lodge_id, resource_key, start_at, end_at)
  WHERE NOT exclusive_use OR exclusive_use = true;

CREATE INDEX IF NOT EXISTS event_booking_resources_booking_idx
  ON public.event_booking_resources (event_booking_id);

-- RLS
ALTER TABLE public.event_booking_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_booking_resources_lodge_policy ON public.event_booking_resources;
CREATE POLICY event_booking_resources_lodge_policy ON public.event_booking_resources
  FOR ALL USING (lodge_id = (public.app_current_lodge_id()))
  WITH CHECK (lodge_id = (public.app_current_lodge_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_booking_resources TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. EVENT BOOKING LINE ITEMS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.event_booking_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  line_type text NOT NULL DEFAULT 'manual',
  description text NOT NULL DEFAULT '',
  category text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  depletion_quantity numeric,
  source_reference text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT event_line_item_type_check CHECK (
    line_type IN ('venue','package','catering','equipment','cleaning','security','decoration','inventory','manual','pos')
  ),
  CONSTRAINT event_line_item_quantity_check CHECK (quantity > 0),
  CONSTRAINT event_line_item_non_negative CHECK (unit_price >= 0 AND subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS event_booking_line_items_booking_idx
  ON public.event_booking_line_items (event_booking_id);

CREATE INDEX IF NOT EXISTS event_booking_line_items_inventory_idx
  ON public.event_booking_line_items (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_booking_line_items_source_uidx
  ON public.event_booking_line_items (event_booking_id, source_reference)
  WHERE source_reference IS NOT NULL;

-- RLS
ALTER TABLE public.event_booking_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_booking_line_items_lodge_policy ON public.event_booking_line_items;
CREATE POLICY event_booking_line_items_lodge_policy ON public.event_booking_line_items
  FOR ALL USING (lodge_id = (public.app_current_lodge_id()))
  WITH CHECK (lodge_id = (public.app_current_lodge_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_booking_line_items TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. EVENT BOOKING ROOMS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.event_booking_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL DEFAULT 'guest_room',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT event_room_relationship_check CHECK (
    relationship_type IN ('guest_room','event_room','full_lodge')
  )
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS event_booking_rooms_event_booking_uidx
  ON public.event_booking_rooms (event_booking_id, booking_id);

CREATE UNIQUE INDEX IF NOT EXISTS event_booking_rooms_booking_uidx
  ON public.event_booking_rooms (booking_id);

CREATE INDEX IF NOT EXISTS event_booking_rooms_event_idx
  ON public.event_booking_rooms (event_booking_id);

-- RLS
ALTER TABLE public.event_booking_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_booking_rooms_lodge_policy ON public.event_booking_rooms;
CREATE POLICY event_booking_rooms_lodge_policy ON public.event_booking_rooms
  FOR ALL USING (lodge_id = (public.app_current_lodge_id()))
  WITH CHECK (lodge_id = (public.app_current_lodge_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_booking_rooms TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. POS EVENT FOLIO LINKAGE
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS event_booking_id uuid
  REFERENCES public.conference_bookings(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS pos_orders_event_booking_idx
  ON public.pos_orders (event_booking_id)
  WHERE event_booking_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. EXTEND FINANCIAL AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add event_booking_id column to financial_audit_log
ALTER TABLE public.financial_audit_log
  ADD COLUMN IF NOT EXISTS event_booking_id uuid
  REFERENCES public.conference_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS financial_audit_log_event_idx
  ON public.financial_audit_log (event_booking_id)
  WHERE event_booking_id IS NOT NULL;

-- Extend action check constraint to include event actions
DO $$
BEGIN
  ALTER TABLE public.financial_audit_log
    DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;

  ALTER TABLE public.financial_audit_log
    ADD CONSTRAINT financial_audit_log_action_check CHECK (
      action IN (
        'payment_recorded','refund_recorded','charge_added','charge_deleted',
        'booking_total_edited','booking_status_changed','booking_rescheduled',
        'customer_credit_received','customer_credit_allocated','customer_credit_refunded',
        'customer_credit_adjusted','customer_credit_reversed',
        'event_created','event_updated','event_cancelled',
        'event_line_item_added','event_line_item_voided',
        'event_room_linked','event_room_unlinked',
        'event_payment_recorded','event_pos_charge_added','event_pos_charge_reversed'
      )
    );
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. EVENT TOTALS RECALCULATION FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculate_event_totals(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric := 0;
  v_extras_total numeric := 0;
  v_charges_total numeric := 0;
  v_amount_paid numeric := 0;
  v_total numeric;
  v_balance numeric;
BEGIN
  -- Sum active non-POS line items. This includes the server-created base
  -- venue/package line and any later extras.
  SELECT COALESCE(SUM(subtotal), 0)
  INTO v_extras_total
  FROM public.event_booking_line_items
  WHERE event_booking_id = p_event_id
    AND voided_at IS NULL
    AND line_type <> 'pos';

  -- Sum resource subtotals
  SELECT COALESCE(SUM(subtotal), 0)
  INTO v_subtotal
  FROM public.event_booking_resources
  WHERE event_booking_id = p_event_id;

  -- POS folio charges are represented by event line items. Do not also sum
  -- pos_orders or the same sale would be counted twice.
  SELECT COALESCE(SUM(subtotal), 0)
  INTO v_charges_total
  FROM public.event_booking_line_items
  WHERE event_booking_id = p_event_id
    AND voided_at IS NULL
    AND line_type = 'pos';

  -- Refund rows reduce collections even when an older caller stored their
  -- amount as positive.
  SELECT COALESCE(SUM(
    CASE
      WHEN lower(coalesce(type, '')) = 'refund' THEN -abs(amount)
      ELSE amount
    END
  ), 0)
  INTO v_amount_paid
  FROM public.payments
  WHERE conference_booking_id = p_event_id
    AND amount > 0;

  v_total := v_subtotal + v_extras_total + v_charges_total;
  v_balance := GREATEST(0, v_total - v_amount_paid);

  UPDATE public.conference_bookings
  SET
    subtotal = v_subtotal,
    extras_total = v_extras_total,
    charges_total = v_charges_total,
    total_amount = v_total,
    amount_paid = v_amount_paid,
    balance_due = v_balance,
    payment_status = CASE
      WHEN v_amount_paid >= v_total AND v_total > 0 THEN 'paid'
      WHEN v_amount_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END,
    updated_at = now()
  WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_event_totals(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. CREATE EVENT BOOKING RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_event_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_event_id uuid;
  v_idempotency_key text := payload->>'idempotency_key';
  v_reservation_scope text := coalesce(nullif(btrim(payload->>'reservation_scope'), ''), 'venue_only');
  v_event_type text := coalesce(nullif(btrim(payload->>'event_type'), ''), 'conference');
  v_status text := coalesce(nullif(btrim(payload->>'status'), ''), 'reserved');
  v_booking_date text := payload->>'booking_date';
  v_start_time text := payload->>'start_time';
  v_end_time text := payload->>'end_time';
  v_exclusive_booking_id uuid;
  v_room_ids jsonb;
  v_room_id uuid;
  v_booking_id uuid;
  v_inv_number text;
  v_deposit numeric := coalesce((payload->>'deposit_amount')::numeric, 0);
  v_deposit_method text := payload->>'payment_method';
  v_dep_result jsonb;
  v_room_count integer := 0;
  v_result jsonb;
  v_resource jsonb;
  v_resource_start timestamptz;
  v_resource_end timestamptz;
  v_resource_price numeric;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  IF nullif(btrim(coalesce(v_idempotency_key, '')), '') IS NULL
     OR length(v_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key is required (min 8 chars)');
  END IF;

  IF v_booking_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'booking_date is required');
  END IF;

  IF v_start_time IS NULL OR v_end_time IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'start_time and end_time are required');
  END IF;

  IF v_end_time <= v_start_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'end_time must be after start_time');
  END IF;

  IF coalesce((payload->>'total_amount')::numeric, 0) < 0
     OR v_deposit < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event amounts cannot be negative');
  END IF;

  IF v_deposit > 0 AND nullif(btrim(coalesce(v_deposit_method, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method is required when a deposit is provided');
  END IF;

  IF v_reservation_scope IN ('venue_with_rooms', 'exclusive_lodge')
     AND (
       nullif(payload->>'check_in', '') IS NULL
       OR nullif(payload->>'check_out', '') IS NULL
       OR (payload->>'check_out')::date <= (payload->>'check_in')::date
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid room check-in and check-out dates are required');
  END IF;

  -- Generate event ID
  v_event_id := (payload->>'id')::uuid;
  IF v_event_id IS NULL THEN
    v_event_id := gen_random_uuid();
  END IF;

  -- Idempotency check
  IF EXISTS (
    SELECT 1 FROM public.conference_bookings
    WHERE lodge_id = v_lodge_id AND create_idempotency_key = v_idempotency_key
  ) THEN
    SELECT id INTO v_event_id
    FROM public.conference_bookings
    WHERE lodge_id = v_lodge_id AND create_idempotency_key = v_idempotency_key;
    RETURN jsonb_build_object(
      'success', true, 'event_id', v_event_id,
      'idempotent', true
    );
  END IF;

  -- Advisory lock for booking overlap protection
  PERFORM pg_advisory_xact_lock(
    hashtextextended('booking-overlap:' || v_lodge_id::text, 0)
  );

  -- ═══ EXCLUSIVE LODGE SCOPE ═══
  IF v_reservation_scope = 'exclusive_lodge' THEN
    -- Check no existing bookings in date range
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.lodge_id = v_lodge_id
        AND coalesce(b.status, '') <> 'cancelled'
        AND b.check_in < (payload->>'check_out')::date
        AND b.check_out > (payload->>'check_in')::date
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot create exclusive event: the lodge already has bookings during these dates');
    END IF;

    -- Find all non-maintenance rooms for the exclusive booking
    SELECT count(*) INTO v_room_count
    FROM public.rooms r
    WHERE r.lodge_id = v_lodge_id
      AND coalesce(r.status, '') <> 'maintenance';

    IF v_room_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'No rooms available for exclusive event');
    END IF;

    -- Create one authoritative exclusive booking
    v_inv_number := public.get_next_invoice_number(v_lodge_id);
    v_booking_id := gen_random_uuid();

    INSERT INTO public.bookings (
      id, lodge_id, room_id, customer_id,
      check_in, check_out, adults, children,
      total_amount, amount_paid, deposit_amount, payment_status,
      status, invoice_number, notes, is_exclusive_event,
      event_daily_rate, create_idempotency_key,
      created_at, updated_at
    ) VALUES (
      v_booking_id, v_lodge_id,
      (SELECT r.id FROM public.rooms r WHERE r.lodge_id = v_lodge_id AND coalesce(r.status, '') <> 'maintenance' ORDER BY r.room_number LIMIT 1),
      nullif(payload->>'customer_id', '')::uuid,
      (payload->>'check_in')::date,
      (payload->>'check_out')::date,
      coalesce((payload->>'adults')::integer, 1),
      coalesce((payload->>'children')::integer, 0),
      coalesce((payload->>'total_amount')::numeric, 0),
      0, 0, 'unpaid',
      'confirmed', v_inv_number,
      format('[GROUP:evt-%s] Event: %s', v_event_id, coalesce(payload->>'event_name', 'Exclusive Event')),
      true,
      nullif(payload->>'event_daily_rate', '')::numeric,
      'event-booking:' || v_event_id::text,
      now(), now()
    );

    v_exclusive_booking_id := v_booking_id;

    -- Create invoice
    INSERT INTO public.invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
    VALUES (v_booking_id, v_lodge_id, v_inv_number, now(), (payload->>'check_in')::date)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ═══ INSERT EVENT PARENT ═══
  INSERT INTO public.conference_bookings (
    id, lodge_id, customer_id, event_name, event_type, reservation_scope, status,
    booking_date, start_time, end_time,
    client_name, company, adults, children,
    room_name, setup_type, includes_catering, catering_notes,
    subtotal, extras_total, charges_total, amount_paid, balance_due,
    total_amount, deposit_paid, payment_status, payment_method,
    currency, exclusive_booking_id, quotation_id,
    create_idempotency_key, created_by, notes, updated_at
  ) VALUES (
    v_event_id, v_lodge_id,
    nullif(payload->>'customer_id', '')::uuid,
    coalesce(payload->>'event_name', payload->>'client_name', 'Event'),
    v_event_type, v_reservation_scope, v_status,
    v_booking_date, v_start_time, v_end_time,
    coalesce(payload->>'client_name', 'Guest'),
    payload->>'company',
    coalesce((payload->>'adults')::integer, 0),
    coalesce((payload->>'children')::integer, 0),
    payload->>'room_name',
    coalesce(payload->>'setup_type', 'Default'),
    coalesce((payload->>'includes_catering')::boolean, false),
    payload->>'catering_notes',
    0,
    0, 0, 0, 0,
    0,
    coalesce(v_deposit, 0),
    CASE WHEN v_deposit > 0 THEN 'partial' ELSE 'unpaid' END,
    v_deposit_method,
    coalesce(payload->>'currency', 'BWP'),
    v_exclusive_booking_id,
    nullif(payload->>'quotation_id', '')::uuid,
    v_idempotency_key, v_actor,
    payload->>'notes',
    now()
  );

  -- Preserve the operator-entered venue/package price as an immutable,
  -- server-calculated line item rather than trusting total_amount as an
  -- aggregate. The recalculation function remains the only totals authority.
  IF coalesce((payload->>'total_amount')::numeric, 0) > 0 THEN
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference, created_by
    ) VALUES (
      v_lodge_id, v_event_id, 'venue',
      coalesce(nullif(btrim(payload->>'base_charge_description'), ''), 'Event / venue fee'),
      'venue', 1,
      round((payload->>'total_amount')::numeric, 2),
      round((payload->>'total_amount')::numeric, 2),
      'event-base:' || v_event_id::text,
      v_actor
    );
  END IF;

  -- Reserve requested venue resources inside the same transaction and under
  -- the same lodge advisory lock as room allocation.
  IF jsonb_typeof(coalesce(payload->'resources', '[]'::jsonb)) = 'array' THEN
    FOR v_resource IN
      SELECT value FROM jsonb_array_elements(coalesce(payload->'resources', '[]'::jsonb))
    LOOP
      IF nullif(btrim(coalesce(v_resource->>'resource_key', '')), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Every event resource requires a resource_key');
      END IF;

      v_resource_start := coalesce(
        nullif(v_resource->>'start_at', '')::timestamptz,
        (v_booking_date || ' ' || v_start_time)::timestamp AT TIME ZONE 'Africa/Gaborone'
      );
      v_resource_end := coalesce(
        nullif(v_resource->>'end_at', '')::timestamptz,
        (v_booking_date || ' ' || v_end_time)::timestamp AT TIME ZONE 'Africa/Gaborone'
      );
      v_resource_price := round(greatest(0, coalesce(nullif(v_resource->>'unit_price', '')::numeric, 0)), 2);

      IF v_resource_end <= v_resource_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'Event resource end time must be after start time');
      END IF;

      IF coalesce((v_resource->>'exclusive_use')::boolean, true)
         AND EXISTS (
           SELECT 1
           FROM public.event_booking_resources existing_resource
           JOIN public.conference_bookings existing_event
             ON existing_event.id = existing_resource.event_booking_id
           WHERE existing_resource.lodge_id = v_lodge_id
             AND existing_resource.resource_key = v_resource->>'resource_key'
             AND existing_event.status NOT IN ('cancelled', 'completed')
             AND existing_resource.start_at < v_resource_end
             AND existing_resource.end_at > v_resource_start
         ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Venue resource is already reserved: ' || coalesce(v_resource->>'resource_name', v_resource->>'resource_key')
        );
      END IF;

      INSERT INTO public.event_booking_resources (
        lodge_id, event_booking_id, resource_key,
        resource_name_snapshot, resource_type_snapshot,
        start_at, end_at, quantity, exclusive_use,
        unit_price_snapshot, subtotal, created_by
      ) VALUES (
        v_lodge_id, v_event_id, v_resource->>'resource_key',
        coalesce(nullif(btrim(v_resource->>'resource_name'), ''), v_resource->>'resource_key'),
        coalesce(nullif(btrim(v_resource->>'resource_type'), ''), 'venue'),
        v_resource_start, v_resource_end,
        greatest(1, coalesce((v_resource->>'quantity')::integer, 1)),
        coalesce((v_resource->>'exclusive_use')::boolean, true),
        v_resource_price,
        round(greatest(1, coalesce((v_resource->>'quantity')::integer, 1)) * v_resource_price, 2),
        v_actor
      );
    END LOOP;
  END IF;

  -- ═══ VENUE WITH ROOMS SCOPE ═══
  -- The event parent must exist before event_booking_rooms can reference it.
  IF v_reservation_scope = 'venue_with_rooms' THEN
    v_room_ids := payload->'room_ids';
    IF v_room_ids IS NOT NULL
       AND jsonb_typeof(v_room_ids) = 'array'
       AND jsonb_array_length(v_room_ids) > 0 THEN
      FOR i IN 0..jsonb_array_length(v_room_ids) - 1 LOOP
        v_room_id := (v_room_ids->>i)::uuid;
        IF v_room_id IS NOT NULL THEN
          PERFORM public.app_check_room_maintenance(v_lodge_id, v_room_id);

          IF NOT EXISTS (
            SELECT 1 FROM public.rooms r
            WHERE r.id = v_room_id AND r.lodge_id = v_lodge_id
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Selected room does not belong to this lodge');
          END IF;

          IF EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.room_id = v_room_id
              AND b.lodge_id = v_lodge_id
              AND coalesce(b.status, '') <> 'cancelled'
              AND b.check_in < (payload->>'check_out')::date
              AND b.check_out > (payload->>'check_in')::date
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Room ' || v_room_id || ' is not available for the requested dates');
          END IF;

          v_booking_id := gen_random_uuid();
          v_inv_number := public.get_next_invoice_number(v_lodge_id);

          INSERT INTO public.bookings (
            id, lodge_id, room_id, customer_id,
            check_in, check_out, adults, children,
            total_amount, amount_paid, deposit_amount, payment_status,
            status, invoice_number, notes, create_idempotency_key,
            created_at, updated_at
          ) VALUES (
            v_booking_id, v_lodge_id, v_room_id,
            nullif(payload->>'customer_id', '')::uuid,
            (payload->>'check_in')::date,
            (payload->>'check_out')::date,
            coalesce((payload->>'adults')::integer, 1),
            coalesce((payload->>'children')::integer, 0),
            (SELECT r.rate_per_night * GREATEST(1, (payload->>'check_out')::date - (payload->>'check_in')::date)
             FROM public.rooms r WHERE r.id = v_room_id AND r.lodge_id = v_lodge_id),
            0, 0, 'unpaid',
            'confirmed', v_inv_number,
            format('[EVENT:%s] %s', v_event_id, coalesce(payload->>'event_name', 'Event Room')),
            'event-room:' || v_event_id || ':' || v_room_id,
            now(), now()
          );

          INSERT INTO public.invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
          VALUES (v_booking_id, v_lodge_id, v_inv_number, now(), (payload->>'check_in')::date)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.event_booking_rooms (
            lodge_id, event_booking_id, booking_id, room_id, relationship_type, created_by
          ) VALUES (
            v_lodge_id, v_event_id, v_booking_id, v_room_id, 'guest_room', v_actor
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ═══ RECORD DEPOSIT PAYMENT ═══
  IF v_deposit > 0 AND v_deposit_method IS NOT NULL THEN
    INSERT INTO public.payments (
      lodge_id, conference_booking_id, amount, method, type,
      idempotency_key, recorded_by, paid_at
    ) VALUES (
      v_lodge_id, v_event_id, v_deposit, v_deposit_method, 'deposit',
      'event-deposit:' || v_event_id::text, v_actor, now()
    );
  END IF;

  -- Recalculate totals
  PERFORM public.recalculate_event_totals(v_event_id);

  -- Audit log
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id,
    after_snapshot, idempotency_key
  ) VALUES (
    v_lodge_id, v_event_id, 'event_created', v_actor,
    jsonb_build_object('event_id', v_event_id, 'reservation_scope', v_reservation_scope, 'event_type', v_event_type),
    v_idempotency_key
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'exclusive_booking_id', v_exclusive_booking_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event_booking(jsonb) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. UPDATE EVENT BOOKING RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_event_booking(
  p_event_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_record public.conference_bookings%rowtype;
  v_updated_at timestamptz;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  SELECT * INTO v_record
  FROM public.conference_bookings
  WHERE id = p_event_id AND lodge_id = p_lodge_id
  FOR UPDATE;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_record.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  END IF;

  IF payload ? 'total_amount'
     AND coalesce((payload->>'total_amount')::numeric, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event base amount cannot be negative');
  END IF;

  IF payload ? 'reservation_scope'
     AND nullif(btrim(payload->>'reservation_scope'), '') IS DISTINCT FROM v_record.reservation_scope THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reservation scope cannot be changed after creation. Cancel and recreate the event safely.'
    );
  END IF;

  UPDATE public.conference_bookings
  SET
    event_name = CASE WHEN payload ? 'event_name' THEN coalesce(payload->>'event_name', event_name) ELSE event_name END,
    event_type = CASE WHEN payload ? 'event_type' THEN coalesce(nullif(btrim(payload->>'event_type'), ''), event_type) ELSE event_type END,
    reservation_scope = reservation_scope,
    status = CASE WHEN payload ? 'status' THEN coalesce(nullif(btrim(payload->>'status'), ''), status) ELSE status END,
    client_name = CASE WHEN payload ? 'client_name' THEN coalesce(payload->>'client_name', client_name) ELSE client_name END,
    company = CASE WHEN payload ? 'company' THEN payload->>'company' ELSE company END,
    adults = CASE WHEN payload ? 'adults' THEN coalesce((payload->>'adults')::integer, adults) ELSE adults END,
    children = CASE WHEN payload ? 'children' THEN coalesce((payload->>'children')::integer, children) ELSE children END,
    room_name = CASE WHEN payload ? 'room_name' THEN payload->>'room_name' ELSE room_name END,
    setup_type = CASE WHEN payload ? 'setup_type' THEN coalesce(payload->>'setup_type', setup_type) ELSE setup_type END,
    includes_catering = CASE WHEN payload ? 'includes_catering' THEN coalesce((payload->>'includes_catering')::boolean, includes_catering) ELSE includes_catering END,
    catering_notes = CASE WHEN payload ? 'catering_notes' THEN payload->>'catering_notes' ELSE catering_notes END,
    booking_date = CASE WHEN payload ? 'booking_date' THEN coalesce(payload->>'booking_date', booking_date) ELSE booking_date END,
    start_time = CASE WHEN payload ? 'start_time' THEN coalesce(payload->>'start_time', start_time) ELSE start_time END,
    end_time = CASE WHEN payload ? 'end_time' THEN coalesce(payload->>'end_time', end_time) ELSE end_time END,
    currency = CASE WHEN payload ? 'currency' THEN coalesce(payload->>'currency', currency) ELSE currency END,
    notes = CASE WHEN payload ? 'notes' THEN payload->>'notes' ELSE notes END,
    updated_at = now()
  WHERE id = p_event_id AND lodge_id = p_lodge_id
  RETURNING updated_at INTO v_updated_at;

  -- Updating the venue/package price updates its canonical base line item.
  IF payload ? 'total_amount' THEN
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference, created_by
    ) VALUES (
      p_lodge_id, p_event_id, 'venue', 'Event / venue fee', 'venue',
      1,
      round(coalesce((payload->>'total_amount')::numeric, 0), 2),
      round(coalesce((payload->>'total_amount')::numeric, 0), 2),
      'event-base:' || p_event_id::text,
      v_actor
    )
    ON CONFLICT (event_booking_id, source_reference)
    WHERE source_reference IS NOT NULL
    DO UPDATE SET
      unit_price = excluded.unit_price,
      subtotal = excluded.subtotal,
      voided_at = NULL,
      void_reason = NULL;
  END IF;

  PERFORM public.recalculate_event_totals(p_event_id);

  -- Audit log
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, idempotency_key
  ) VALUES (
    p_lodge_id, p_event_id, 'event_updated', v_actor, p_idempotency_key
  );

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'updated_at', v_updated_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_event_booking(uuid, uuid, jsonb, timestamptz, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. ADD EVENT LINE ITEM RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_event_line_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_event_id uuid := (payload->>'event_booking_id')::uuid;
  v_line_id uuid;
  v_quantity numeric := coalesce((payload->>'quantity')::numeric, 1);
  v_unit_price numeric := coalesce((payload->>'unit_price')::numeric, 0);
  v_subtotal numeric;
  v_idempotency_key text := payload->>'idempotency_key';
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_depletion_quantity numeric := (payload->>'depletion_quantity')::numeric;
  v_stock numeric;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_booking_id is required');
  END IF;

  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  IF nullif(btrim(coalesce(v_idempotency_key, '')), '') IS NULL
     OR length(v_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key is required (min 8 chars)');
  END IF;

  -- Verify event exists and is not terminal
  IF NOT EXISTS (
    SELECT 1 FROM public.conference_bookings
    WHERE id = v_event_id AND lodge_id = v_lodge_id
      AND status NOT IN ('cancelled', 'completed')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found or in terminal state');
  END IF;

  -- Serialize the same user intent before touching stock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('event-line:' || v_lodge_id::text || ':' || v_idempotency_key, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.event_booking_line_items
    WHERE lodge_id = v_lodge_id AND source_reference = v_idempotency_key
  ) THEN
    SELECT id INTO v_line_id
    FROM public.event_booking_line_items
    WHERE lodge_id = v_lodge_id AND source_reference = v_idempotency_key
    LIMIT 1;
    RETURN jsonb_build_object('success', true, 'line_item_id', v_line_id, 'idempotent', true);
  END IF;

  -- Validate quantity and price
  IF v_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  END IF;
  IF v_unit_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unit price cannot be negative');
  END IF;

  -- Server-calculated subtotal
  v_subtotal := round(v_quantity * v_unit_price, 2);

  -- Inventory depletion (atomic)
  IF v_inventory_item_id IS NOT NULL THEN
    v_depletion_quantity := coalesce(v_depletion_quantity, v_quantity);

    SELECT current_stock INTO v_stock
    FROM public.inventory_items
    WHERE id = v_inventory_item_id AND lodge_id = v_lodge_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Inventory item not found');
    END IF;

    IF v_stock < v_depletion_quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient stock. Available: ' || v_stock || ', Required: ' || v_depletion_quantity);
    END IF;

    UPDATE public.inventory_items
    SET current_stock = current_stock - v_depletion_quantity,
        updated_at = now()
    WHERE id = v_inventory_item_id AND lodge_id = v_lodge_id;
  END IF;

  v_line_id := gen_random_uuid();

  INSERT INTO public.event_booking_line_items (
    id, lodge_id, event_booking_id, line_type, description, category,
    quantity, unit_price, subtotal,
    inventory_item_id, depletion_quantity, source_reference,
    created_by
  ) VALUES (
    v_line_id, v_lodge_id, v_event_id,
    coalesce(nullif(btrim(payload->>'line_type'), ''), 'manual'),
    coalesce(payload->>'description', ''),
    payload->>'category',
    v_quantity, v_unit_price, v_subtotal,
    v_inventory_item_id, v_depletion_quantity,
    v_idempotency_key,
    v_actor
  );

  -- Recalculate event totals
  PERFORM public.recalculate_event_totals(v_event_id);

  -- Audit
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id,
    amount_delta, idempotency_key
  ) VALUES (
    v_lodge_id, v_event_id, 'event_line_item_added', v_actor,
    v_subtotal, v_idempotency_key
  );

  RETURN jsonb_build_object('success', true, 'line_item_id', v_line_id, 'subtotal', v_subtotal);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_event_line_item(jsonb) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. VOID EVENT LINE ITEM RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.void_event_line_item(
  p_line_item_id uuid,
  p_lodge_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_line public.event_booking_line_items%rowtype;
  v_event_id uuid;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance', 'manager', 'admin', 'super_admin']
  );

  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Void reason is required');
  END IF;

  SELECT * INTO v_line
  FROM public.event_booking_line_items
  WHERE id = p_line_item_id AND lodge_id = p_lodge_id
  FOR UPDATE;

  IF v_line.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Line item not found');
  END IF;

  IF v_line.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Line item is already voided');
  END IF;

  v_event_id := v_line.event_booking_id;

  -- Mark voided (do NOT delete)
  UPDATE public.event_booking_line_items
  SET voided_at = now(),
      void_reason = p_reason
  WHERE id = p_line_item_id;

  -- Restore inventory exactly once
  IF v_line.inventory_item_id IS NOT NULL AND coalesce(v_line.depletion_quantity, 0) > 0 THEN
    UPDATE public.inventory_items
    SET current_stock = current_stock + v_line.depletion_quantity,
        updated_at = now()
    WHERE id = v_line.inventory_item_id AND lodge_id = p_lodge_id;
  END IF;

  -- Recalculate totals
  PERFORM public.recalculate_event_totals(v_event_id);

  -- Audit
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id,
    amount_delta, idempotency_key,
    before_snapshot
  ) VALUES (
    p_lodge_id, v_event_id, 'event_line_item_voided', v_actor,
    -v_line.subtotal, p_idempotency_key,
    jsonb_build_object('line_item_id', p_line_item_id, 'subtotal', v_line.subtotal, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', true, 'voided', true, 'subtotal_restored', -v_line.subtotal);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_event_line_item(uuid, uuid, text, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. UPDATE EVENT PAYMENT RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_event_payment(
  p_event_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text,
  p_type text DEFAULT 'payment',
  p_idempotency_key text DEFAULT NULL,
  p_recorded_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_effective_actor uuid;
  v_record public.conference_bookings%rowtype;
  v_payment_id uuid;
  v_new_paid numeric;
  v_total numeric;
  v_balance numeric;
  v_payment_status text;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  v_effective_actor := coalesce(p_recorded_by, v_actor);

  IF v_effective_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'An authenticated session is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  IF nullif(btrim(coalesce(p_method, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method is required');
  END IF;

  IF nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Idempotency key is required');
  END IF;

  IF lower(coalesce(p_type, 'payment')) NOT IN ('payment', 'deposit', 'refund') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment type must be payment, deposit, or refund');
  END IF;

  SELECT * INTO v_record
  FROM public.conference_bookings
  WHERE id = p_event_id AND lodge_id = p_lodge_id
  FOR UPDATE;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;

  IF v_record.status IN ('cancelled', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot record payment on a cancelled or completed event');
  END IF;

  -- Idempotency check via payments table
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE lodge_id = p_lodge_id
      AND conference_booking_id = p_event_id
      AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'payment_status', v_record.payment_status);
  END IF;

  -- Insert payment
  v_payment_id := gen_random_uuid();
  INSERT INTO public.payments (
    id, lodge_id, conference_booking_id, amount, method, type,
    idempotency_key, recorded_by, paid_at
  ) VALUES (
    v_payment_id, p_lodge_id, p_event_id,
    CASE WHEN lower(p_type) = 'refund' THEN -abs(p_amount) ELSE abs(p_amount) END,
    p_method, lower(p_type),
    p_idempotency_key, v_effective_actor, now()
  );

  -- Server-authoritative recalculation
  PERFORM public.recalculate_event_totals(p_event_id);

  -- Read updated state
  SELECT amount_paid, balance_due, payment_status, subtotal + extras_total + charges_total
  INTO v_new_paid, v_balance, v_payment_status, v_total
  FROM public.conference_bookings
  WHERE id = p_event_id;

  -- Audit
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id,
    amount_delta, after_snapshot, idempotency_key
  ) VALUES (
    p_lodge_id, p_event_id, 'event_payment_recorded', v_actor,
    CASE WHEN lower(p_type) = 'refund' THEN -abs(p_amount) ELSE abs(p_amount) END,
    jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_new_paid, 'balance_due', v_balance, 'payment_status', v_payment_status),
    p_idempotency_key
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount_paid', v_new_paid,
    'balance_due', v_balance,
    'payment_status', v_payment_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_event_payment(uuid, uuid, numeric, text, text, text, uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. CANCEL EVENT BOOKING RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_event_booking(
  p_event_id uuid,
  p_lodge_id uuid,
  p_reason text,
  p_cancel_linked_rooms boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_record public.conference_bookings%rowtype;
  v_linked_room record;
BEGIN
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance', 'manager', 'admin', 'super_admin']
  );

  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cancellation reason is required');
  END IF;

  SELECT * INTO v_record
  FROM public.conference_bookings
  WHERE id = p_event_id AND lodge_id = p_lodge_id
  FOR UPDATE;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;

  IF v_record.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event is already cancelled');
  END IF;

  -- Advisory lock
  PERFORM pg_advisory_xact_lock(
    hashtextextended('booking-overlap:' || p_lodge_id::text, 0)
  );

  -- Cancel linked rooms if requested
  IF p_cancel_linked_rooms THEN
    FOR v_linked_room IN
      SELECT ebr.booking_id
      FROM public.event_booking_rooms ebr
      WHERE ebr.event_booking_id = p_event_id
    LOOP
      UPDATE public.bookings
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_linked_room.booking_id
        AND lodge_id = p_lodge_id
        AND status NOT IN ('cancelled', 'checked_out');
    END LOOP;
  END IF;

  -- Cancel exclusive booking if exists
  IF v_record.exclusive_booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_record.exclusive_booking_id
      AND lodge_id = p_lodge_id
      AND status NOT IN ('cancelled', 'checked_out');
  END IF;

  -- Cancel event
  UPDATE public.conference_bookings
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason,
      updated_at = now()
  WHERE id = p_event_id;

  -- Audit
  INSERT INTO public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id,
    before_snapshot, idempotency_key
  ) VALUES (
    p_lodge_id, p_event_id, 'event_cancelled', v_actor,
    jsonb_build_object('previous_status', v_record.status, 'reason', p_reason),
    p_idempotency_key
  );

  RETURN jsonb_build_object('success', true, 'cancelled', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_event_booking(uuid, uuid, text, boolean, text) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. EVENT RESOURCE CONFLICT CHECK FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_event_resource_conflict(
  p_lodge_id uuid,
  p_resource_key text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'A valid event resource time range is required';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.event_booking_resources ebr
    JOIN public.conference_bookings cb ON cb.id = ebr.event_booking_id
    WHERE ebr.lodge_id = p_lodge_id
      AND ebr.resource_key = p_resource_key
      AND cb.status NOT IN ('cancelled', 'completed')
      AND ebr.start_at < p_end_at
      AND ebr.end_at > p_start_at
      AND (p_exclude_event_id IS NULL OR ebr.event_booking_id != p_exclude_event_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_event_resource_conflict(uuid, text, timestamptz, timestamptz, uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. GET EVENT BOOKING DETAILS RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_event_booking_details(
  p_event_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event jsonb;
  v_resources jsonb;
  v_line_items jsonb;
  v_rooms jsonb;
  v_payments jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  -- Event parent
  SELECT to_jsonb(cb.*) INTO v_event
  FROM public.conference_bookings cb
  WHERE cb.id = p_event_id AND cb.lodge_id = p_lodge_id;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  -- Resources
  SELECT coalesce(jsonb_agg(to_jsonb(ebr.*)), '[]') INTO v_resources
  FROM public.event_booking_resources ebr
  WHERE ebr.event_booking_id = p_event_id;

  -- Line items (non-voided for display, voided for history)
  SELECT coalesce(jsonb_agg(to_jsonb(ebli.*)), '[]') INTO v_line_items
  FROM public.event_booking_line_items ebli
  WHERE ebli.event_booking_id = p_event_id;

  -- Linked rooms
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', ebr.id,
    'booking_id', ebr.booking_id,
    'room_id', ebr.room_id,
    'room_number', rm.room_number,
    'room_type', rm.room_type,
    'relationship_type', ebr.relationship_type,
    'check_in', b.check_in,
    'check_out', b.check_out,
    'total_amount', b.total_amount,
    'amount_paid', b.amount_paid,
    'payment_status', b.payment_status
  )), '[]') INTO v_rooms
  FROM public.event_booking_rooms ebr
  JOIN public.bookings b ON b.id = ebr.booking_id
  LEFT JOIN public.rooms rm ON rm.id = ebr.room_id
  WHERE ebr.event_booking_id = p_event_id;

  -- Payments
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'amount', p.amount,
    'method', p.method,
    'type', p.type,
    'paid_at', p.paid_at,
    'recorded_by', p.recorded_by
  )), '[]') INTO v_payments
  FROM public.payments p
  WHERE p.conference_booking_id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'event', v_event,
    'resources', v_resources,
    'line_items', v_line_items,
    'rooms', v_rooms,
    'payments', v_payments
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_booking_details(uuid, uuid) TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. COMPATIBILITY WRAPPERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Old conference RPCs are kept as-is for backward compatibility.
-- They continue to work for existing records and callers.
-- New code should use the event RPCs.

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

COMMIT;
