-- Phase 6: Restaurant Differentiators and Deep Operations
-- Tables: reservations, waitlist, combos, recipe_variance, prep_items, prep_batches,
--         ticket_status_events, supplier_items, purchase_suggestions

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.1 Table Reservations and Waitlist
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  party_size integer NOT NULL CHECK (party_size > 0),
  reservation_date date NOT NULL,
  reservation_time time NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 90,
  preferred_table_id uuid,
  assigned_table_id uuid,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','waiting','seated','completed','cancelled','no_show')),
  source text DEFAULT 'walk_in' CHECK (source IN ('walk_in','phone','whatsapp','online','manager')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_reservations_lodge_isolation" ON restaurant_reservations
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_date ON restaurant_reservations (lodge_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_status ON restaurant_reservations (lodge_id, status);

CREATE TABLE IF NOT EXISTS restaurant_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  customer_id uuid,
  customer_name text NOT NULL,
  customer_phone text,
  party_size integer NOT NULL CHECK (party_size > 0),
  quoted_wait_minutes integer,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','seated','cancelled','expired')),
  assigned_table_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_waitlist_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_waitlist_lodge_isolation" ON restaurant_waitlist_entries
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_restaurant_waitlist_status ON restaurant_waitlist_entries (lodge_id, status);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.2 Combo, Bundle, and Meal-Deal Builder
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_combo_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  name text NOT NULL,
  description text,
  base_price numeric NOT NULL DEFAULT 0,
  category text,
  active boolean NOT NULL DEFAULT true,
  available_from time,
  available_to time,
  days_of_week int[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_combo_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_combo_groups_lodge_isolation" ON restaurant_combo_groups
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE TABLE IF NOT EXISTS restaurant_combo_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES restaurant_combo_groups(id) ON DELETE CASCADE,
  slot_name text NOT NULL,
  min_selections integer NOT NULL DEFAULT 1,
  max_selections integer NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_combo_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_combo_slots_lodge_isolation" ON restaurant_combo_slots
  FOR ALL USING (combo_id IN (SELECT id FROM restaurant_combo_groups WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid));

CREATE TABLE IF NOT EXISTS restaurant_combo_slot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES restaurant_combo_slots(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL,
  price_delta numeric NOT NULL DEFAULT 0,
  default_selected boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_combo_slot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_combo_slot_items_lodge_isolation" ON restaurant_combo_slot_items
  FOR ALL USING (slot_id IN (SELECT s.id FROM restaurant_combo_slots s JOIN restaurant_combo_groups g ON s.combo_id = g.id WHERE g.lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid));

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.3 Recipe Variance Report (snapshot table, optional)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_recipe_variance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  start_date date NOT NULL,
  end_date date NOT NULL,
  inventory_item_id uuid NOT NULL,
  inventory_item_name text,
  unit text,
  theoretical_quantity numeric NOT NULL DEFAULT 0,
  actual_quantity numeric,
  variance_quantity numeric,
  variance_value numeric,
  variance_percent numeric,
  severity text DEFAULT 'ok' CHECK (severity IN ('ok','watch','high','critical')),
  linked_recipes jsonb,
  generated_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_recipe_variance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_recipe_variance_lodge_isolation" ON restaurant_recipe_variance_snapshots
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_restaurant_variance_date ON restaurant_recipe_variance_snapshots (lodge_id, start_date, end_date);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.5 Prep and Batch Production
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_prep_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  name text NOT NULL,
  produced_inventory_item_id uuid NOT NULL,
  default_yield_quantity numeric NOT NULL DEFAULT 1,
  yield_unit text NOT NULL DEFAULT 'portion',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_prep_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_prep_items_lodge_isolation" ON restaurant_prep_items
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE TABLE IF NOT EXISTS restaurant_prep_item_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_item_id uuid NOT NULL REFERENCES restaurant_prep_items(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit text,
  waste_percent numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_prep_item_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_prep_item_ingredients_lodge_isolation" ON restaurant_prep_item_ingredients
  FOR ALL USING (prep_item_id IN (SELECT id FROM restaurant_prep_items WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid));

CREATE TABLE IF NOT EXISTS restaurant_prep_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  prep_item_id uuid NOT NULL,
  batch_code text NOT NULL,
  produced_inventory_item_id uuid NOT NULL,
  planned_yield_quantity numeric NOT NULL,
  actual_yield_quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'portion',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','voided')),
  prepared_by uuid,
  approved_by uuid,
  notes text,
  idempotency_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  posted_at timestamptz,
  voided_at timestamptz
);

ALTER TABLE restaurant_prep_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_prep_batches_lodge_isolation" ON restaurant_prep_batches
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

-- Some linked databases received an early partial Phase 6 table shape without
-- the full batch-operation fields. Reconcile them before creating functions and
-- the replay guard so this forward migration remains restart-safe.
ALTER TABLE restaurant_prep_batches
  ADD COLUMN IF NOT EXISTS outlet_id uuid,
  ADD COLUMN IF NOT EXISTS prep_item_id uuid,
  ADD COLUMN IF NOT EXISTS batch_code text,
  ADD COLUMN IF NOT EXISTS produced_inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS planned_yield_quantity numeric,
  ADD COLUMN IF NOT EXISTS actual_yield_quantity numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit text DEFAULT 'portion',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS prepared_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE restaurant_prep_batches
   SET idempotency_key = concat('legacy-', id::text)
 WHERE idempotency_key IS NULL;

ALTER TABLE restaurant_prep_batches
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_prep_batch_idempotency ON restaurant_prep_batches (lodge_id, idempotency_key);

CREATE TABLE IF NOT EXISTS restaurant_prep_batch_ingredient_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES restaurant_prep_batches(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL,
  quantity_consumed numeric NOT NULL,
  unit_cost numeric,
  movement_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_prep_batch_ingredient_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_prep_batch_movements_lodge_isolation" ON restaurant_prep_batch_ingredient_movements
  FOR ALL USING (batch_id IN (SELECT id FROM restaurant_prep_batches WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid));

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.6 Kitchen Timing Analytics
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_ticket_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL,
  station text,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_ticket_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_ticket_events_lodge_isolation" ON restaurant_ticket_status_events
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_restaurant_ticket_events_ticket ON restaurant_ticket_status_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_ticket_events_lodge_date ON restaurant_ticket_status_events (lodge_id, changed_at);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.7 Low-Stock Purchase Suggestions
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS restaurant_supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  supplier_sku text,
  preferred boolean NOT NULL DEFAULT false,
  pack_size numeric,
  pack_unit text,
  last_unit_cost numeric,
  lead_time_days integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_supplier_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_supplier_items_lodge_isolation" ON restaurant_supplier_items
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_supplier_item_unique ON restaurant_supplier_items (lodge_id, supplier_id, inventory_item_id);

CREATE TABLE IF NOT EXISTS restaurant_purchase_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  outlet_id uuid,
  inventory_item_id uuid NOT NULL,
  inventory_item_name text,
  supplier_id uuid,
  supplier_name text,
  current_stock numeric DEFAULT 0,
  reorder_level numeric DEFAULT 0,
  suggested_quantity numeric NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','converted','dismissed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE restaurant_purchase_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_purchase_suggestions_lodge_isolation" ON restaurant_purchase_suggestions
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb->>'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_restaurant_purchase_suggestions_status ON restaurant_purchase_suggestions (lodge_id, status);

-- ══════════════════════════════════════════════════════════════════════════════
-- RPC Functions
-- ══════════════════════════════════════════════════════════════════════════════

-- 6.1 Reservations
CREATE OR REPLACE FUNCTION create_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  IF v_lodge_id IS NULL THEN
    RAISE EXCEPTION 'lodge_id is required';
  END IF;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager','supervisor']);

  INSERT INTO restaurant_reservations (
    lodge_id, outlet_id, customer_id, customer_name, customer_phone, customer_email,
    party_size, reservation_date, reservation_time, duration_minutes,
    preferred_table_id, status, source, notes, created_by
  ) VALUES (
    v_lodge_id,
    (payload->>'outlet_id')::uuid,
    (payload->>'customer_id')::uuid,
    payload->>'customer_name',
    payload->>'customer_phone',
    payload->>'customer_email',
    (payload->>'party_size')::integer,
    (payload->>'reservation_date')::date,
    (payload->>'reservation_time')::time,
    COALESCE((payload->>'duration_minutes')::integer, 90),
    (payload->>'preferred_table_id')::uuid,
    COALESCE(payload->>'status', 'booked'),
    COALESCE(payload->>'source', 'walk_in'),
    payload->>'notes',
    (payload->>'created_by')::uuid
  ) RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_restaurant_reservations(
  p_lodge_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS SETOF restaurant_reservations
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT r.*
  FROM restaurant_reservations r
  WHERE r.lodge_id = p_lodge_id
    AND (p_start_date IS NULL OR r.reservation_date >= p_start_date)
    AND (p_end_date IS NULL OR r.reservation_date <= p_end_date)
    AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id)
  ORDER BY r.reservation_date, r.reservation_time;
$$;

CREATE OR REPLACE FUNCTION update_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_lodge_id uuid;
  v_result jsonb;
BEGIN
  v_id := (payload->>'id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager','supervisor']);

  UPDATE restaurant_reservations SET
    customer_name = COALESCE(payload->>'customer_name', customer_name),
    customer_phone = COALESCE(payload->>'customer_phone', customer_phone),
    customer_email = COALESCE(payload->>'customer_email', customer_email),
    party_size = COALESCE((payload->>'party_size')::integer, party_size),
    reservation_date = COALESCE((payload->>'reservation_date')::date, reservation_date),
    reservation_time = COALESCE((payload->>'reservation_time')::time, reservation_time),
    duration_minutes = COALESCE((payload->>'duration_minutes')::integer, duration_minutes),
    preferred_table_id = COALESCE((payload->>'preferred_table_id')::uuid, preferred_table_id),
    status = COALESCE(payload->>'status', status),
    notes = COALESCE(payload->>'notes', notes),
    updated_by = (payload->>'updated_by')::uuid,
    updated_at = now()
  WHERE id = v_id AND lodge_id = v_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_restaurant_reservation(p_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager','supervisor']);
  UPDATE restaurant_reservations SET status = 'cancelled', notes = COALESCE(p_reason, notes), updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION seat_restaurant_reservation(p_id uuid, p_lodge_id uuid, p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager','supervisor']);
  UPDATE restaurant_reservations SET status = 'seated', assigned_table_id = p_table_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION mark_restaurant_reservation_no_show(p_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager','supervisor']);
  UPDATE restaurant_reservations SET status = 'no_show', notes = COALESCE(p_reason, notes), updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- Waitlist
CREATE OR REPLACE FUNCTION create_restaurant_waitlist_entry(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_lodge_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager','supervisor','cashier']);
  INSERT INTO restaurant_waitlist_entries (lodge_id, outlet_id, customer_id, customer_name, customer_phone, party_size, quoted_wait_minutes, notes, created_by)
  VALUES (v_lodge_id, (payload->>'outlet_id')::uuid, (payload->>'customer_id')::uuid, payload->>'customer_name', payload->>'customer_phone', (payload->>'party_size')::integer, (payload->>'quoted_wait_minutes')::integer, payload->>'notes', (payload->>'created_by')::uuid)
  RETURNING to_jsonb(restaurant_waitlist_entries.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_restaurant_waitlist(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS SETOF restaurant_waitlist_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT w.* FROM restaurant_waitlist_entries w
  WHERE w.lodge_id = p_lodge_id AND w.status IN ('waiting','notified')
    AND (p_outlet_id IS NULL OR w.outlet_id = p_outlet_id)
  ORDER BY w.created_at;
$$;

CREATE OR REPLACE FUNCTION seat_restaurant_waitlist_entry(p_id uuid, p_lodge_id uuid, p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager','supervisor']);
  UPDATE restaurant_waitlist_entries SET status = 'seated', assigned_table_id = p_table_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_waitlist_entries.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- 6.2 Combos
CREATE OR REPLACE FUNCTION get_restaurant_combos(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS SETOF restaurant_combo_groups
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT g.* FROM restaurant_combo_groups g
  WHERE g.lodge_id = p_lodge_id AND g.active = true
    AND (p_outlet_id IS NULL OR g.outlet_id = p_outlet_id OR g.outlet_id IS NULL)
  ORDER BY g.name;
$$;

CREATE OR REPLACE FUNCTION upsert_restaurant_combo(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid; v_combo_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager']);

  v_combo_id := (payload->>'id')::uuid;
  IF v_combo_id IS NULL THEN
    INSERT INTO restaurant_combo_groups (lodge_id, outlet_id, name, description, base_price, category, active, available_from, available_to, days_of_week)
    VALUES (v_lodge_id, (payload->>'outlet_id')::uuid, payload->>'name', payload->>'description', COALESCE((payload->>'base_price')::numeric, 0), payload->>'category', COALESCE((payload->>'active')::boolean, true), (payload->>'available_from')::time, (payload->>'available_to')::time, ARRAY(SELECT jsonb_array_elements_text(payload->'days_of_week'))::int[])
    RETURNING id INTO v_combo_id;
  ELSE
    UPDATE restaurant_combo_groups SET
      name = COALESCE(payload->>'name', name),
      description = COALESCE(payload->>'description', description),
      base_price = COALESCE((payload->>'base_price')::numeric, base_price),
      category = COALESCE(payload->>'category', category),
      active = COALESCE((payload->>'active')::boolean, active),
      updated_at = now()
    WHERE id = v_combo_id AND lodge_id = v_lodge_id;
  END IF;

  -- Delete existing slots and recreate
  IF payload->'slots' IS NOT NULL THEN
    DELETE FROM restaurant_combo_slots WHERE combo_id = v_combo_id;
    FOR i IN 0..jsonb_array_length(payload->'slots') - 1 LOOP
      DECLARE
        v_slot jsonb := payload->'slots'->i;
        v_slot_id uuid;
      BEGIN
        INSERT INTO restaurant_combo_slots (combo_id, slot_name, min_selections, max_selections, required, sort_order)
        VALUES (v_combo_id, v_slot->>'slot_name', COALESCE((v_slot->>'min_selections')::integer, 1), COALESCE((v_slot->>'max_selections')::integer, 1), COALESCE((v_slot->>'required')::boolean, true), COALESCE((v_slot->>'sort_order')::integer, i))
        RETURNING id INTO v_slot_id;

        IF v_slot->'items' IS NOT NULL THEN
          FOR j IN 0..jsonb_array_length(v_slot->'items') - 1 LOOP
            DECLARE v_item jsonb := v_slot->'items'->j;
            BEGIN
              INSERT INTO restaurant_combo_slot_items (slot_id, menu_item_id, price_delta, default_selected, active)
              VALUES (v_slot_id, (v_item->>'menu_item_id')::uuid, COALESCE((v_item->>'price_delta')::numeric, 0), COALESCE((v_item->>'default_selected')::boolean, false), COALESCE((v_item->>'active')::boolean, true));
            END;
          END LOOP;
        END IF;
      END;
    END LOOP;
  END IF;

  SELECT to_jsonb(g.*) INTO v_result FROM restaurant_combo_groups g WHERE g.id = v_combo_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_restaurant_combo(p_combo_id uuid, p_lodge_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager']);
  DELETE FROM restaurant_combo_groups WHERE id = p_combo_id AND lodge_id = p_lodge_id;
  RETURN true;
END;
$$;

-- 6.3 Recipe Variance Report
CREATE OR REPLACE FUNCTION get_recipe_variance_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(v)) INTO v_result
  FROM (
    SELECT
      ii.id AS inventory_item_id,
      ii.name AS inventory_item_name,
      ii.unit,
      COALESCE(ii.current_stock, 0) AS current_stock,
      COALESCE(ts.theoretical_qty, 0) AS theoretical_quantity,
      CASE WHEN COALESCE(ts.theoretical_qty, 0) > 0 THEN
        COALESCE(ii.current_stock, 0) - ts.theoretical_qty
      ELSE NULL END AS variance_quantity,
      CASE WHEN COALESCE(ts.theoretical_qty, 0) > 0 THEN
        (COALESCE(ii.current_stock, 0) - ts.theoretical_qty) * COALESCE(ii.cost_price, 0)
      ELSE NULL END AS variance_value,
      CASE WHEN ts.theoretical_qty > 0 THEN
        ROUND(((COALESCE(ii.current_stock, 0) - ts.theoretical_qty) / ts.theoretical_qty * 100)::numeric, 1)
      ELSE NULL END AS variance_percent,
      CASE
        WHEN COALESCE(ts.theoretical_qty, 0) = 0 THEN 'ok'
        WHEN ABS(COALESCE(ii.current_stock, 0) - ts.theoretical_qty) / GREATEST(ts.theoretical_qty, 0.01) < 0.05 THEN 'ok'
        WHEN ABS(COALESCE(ii.current_stock, 0) - ts.theoretical_qty) / GREATEST(ts.theoretical_qty, 0.01) < 0.15 THEN 'watch'
        WHEN ABS(COALESCE(ii.current_stock, 0) - ts.theoretical_qty) / GREATEST(ts.theoretical_qty, 0.01) < 0.30 THEN 'high'
        ELSE 'critical'
      END AS severity,
      COALESCE(ts.linked_recipes, '[]'::jsonb) AS linked_recipes
    FROM inventory_items ii
    LEFT JOIN LATERAL (
      SELECT
        SUM(rsm.theoretical_quantity) AS theoretical_qty,
        jsonb_agg(DISTINCT jsonb_build_object('recipe_name', r.name, 'menu_item', mi.name)) FILTER (WHERE r.id IS NOT NULL) AS linked_recipes
      FROM restaurant_recipe_stock_movements rsm
      JOIN restaurant_recipes r ON rsm.recipe_id = r.id
      LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
      WHERE rsm.inventory_item_id = ii.id
        AND rsm.lodge_id = p_lodge_id
        AND rsm.created_at::date BETWEEN p_start_date AND p_end_date
    ) ts ON true
    WHERE ii.lodge_id = p_lodge_id
      AND (p_outlet_id IS NULL OR ii.outlet_id = p_outlet_id OR ii.outlet_id IS NULL)
    ORDER BY ABS(COALESCE(ts.theoretical_qty, 0) - COALESCE(ii.current_stock, 0)) DESC NULLS LAST
  ) v;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 6.5 Prep Batches
CREATE OR REPLACE FUNCTION get_restaurant_prep_items(p_lodge_id uuid)
RETURNS SETOF restaurant_prep_items
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT * FROM restaurant_prep_items WHERE lodge_id = p_lodge_id AND active = true ORDER BY name;
$$;

CREATE OR REPLACE FUNCTION upsert_restaurant_prep_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid; v_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager']);
  v_id := (payload->>'id')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO restaurant_prep_items (lodge_id, name, produced_inventory_item_id, default_yield_quantity, yield_unit)
    VALUES (v_lodge_id, payload->>'name', (payload->>'produced_inventory_item_id')::uuid, COALESCE((payload->>'default_yield_quantity')::numeric, 1), COALESCE(payload->>'yield_unit', 'portion'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE restaurant_prep_items SET name = payload->>'name', produced_inventory_item_id = (payload->>'produced_inventory_item_id')::uuid, default_yield_quantity = COALESCE((payload->>'default_yield_quantity')::numeric, default_yield_quantity), yield_unit = COALESCE(payload->>'yield_unit', yield_unit), updated_at = now()
    WHERE id = v_id AND lodge_id = v_lodge_id;
  END IF;

  -- Replace ingredients
  IF payload->'ingredients' IS NOT NULL THEN
    DELETE FROM restaurant_prep_item_ingredients WHERE prep_item_id = v_id;
    FOR i IN 0..jsonb_array_length(payload->'ingredients') - 1 LOOP
      DECLARE v_ing jsonb := payload->'ingredients'->i;
      BEGIN
        INSERT INTO restaurant_prep_item_ingredients (prep_item_id, inventory_item_id, quantity, unit, waste_percent)
        VALUES (v_id, (v_ing->>'inventory_item_id')::uuid, (v_ing->>'quantity')::numeric, v_ing->>'unit', COALESCE((v_ing->>'waste_percent')::numeric, 0));
      END;
    END LOOP;
  END IF;

  SELECT to_jsonb(pi.*) INTO v_result FROM restaurant_prep_items pi WHERE pi.id = v_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_restaurant_prep_batches(
  p_lodge_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS SETOF restaurant_prep_batches
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT b.* FROM restaurant_prep_batches b
  WHERE b.lodge_id = p_lodge_id
    AND (p_start_date IS NULL OR b.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR b.created_at::date <= p_end_date)
    AND (p_outlet_id IS NULL OR b.outlet_id = p_outlet_id)
  ORDER BY b.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION create_restaurant_prep_batch(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid; v_id uuid; v_result jsonb; v_key text;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_key := payload->>'idempotency_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager']);

  -- Idempotency check
  SELECT id INTO v_id FROM restaurant_prep_batches WHERE lodge_id = v_lodge_id AND idempotency_key = v_key;
  IF v_id IS NOT NULL THEN
    SELECT to_jsonb(b.*) INTO v_result FROM restaurant_prep_batches b WHERE b.id = v_id;
    RETURN v_result;
  END IF;

  INSERT INTO restaurant_prep_batches (lodge_id, outlet_id, prep_item_id, batch_code, produced_inventory_item_id, planned_yield_quantity, actual_yield_quantity, unit, status, prepared_by, notes, idempotency_key)
  VALUES (v_lodge_id, (payload->>'outlet_id')::uuid, (payload->>'prep_item_id')::uuid, payload->>'batch_code', (payload->>'produced_inventory_item_id')::uuid, (payload->>'planned_yield_quantity')::numeric, COALESCE((payload->>'actual_yield_quantity')::numeric, 0), COALESCE(payload->>'unit', 'portion'), 'draft', (payload->>'prepared_by')::uuid, payload->>'notes', v_key)
  RETURNING id INTO v_id;

  SELECT to_jsonb(b.*) INTO v_result FROM restaurant_prep_batches b WHERE b.id = v_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION post_restaurant_prep_batch(p_batch_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch restaurant_prep_batches%ROWTYPE;
  v_result jsonb;
  v_ing record;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['admin','manager']);

  SELECT * INTO v_batch FROM restaurant_prep_batches WHERE id = p_batch_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_batch.status != 'draft' THEN RAISE EXCEPTION 'Only draft batches can be posted'; END IF;

  -- Record ingredient movements
  FOR v_ing IN
    SELECT pii.*, ii.name AS item_name
    FROM restaurant_prep_item_ingredients pii
    JOIN inventory_items ii ON pii.inventory_item_id = ii.id
    WHERE pii.prep_item_id = v_batch.prep_item_id
  LOOP
    INSERT INTO restaurant_prep_batch_ingredient_movements (batch_id, inventory_item_id, quantity_consumed, unit_cost)
    VALUES (v_batch.id, v_ing.inventory_item_id, v_ing.quantity * (1 + v_ing.waste_percent / 100), (SELECT cost_price FROM inventory_items WHERE id = v_ing.inventory_item_id));

    UPDATE inventory_items SET current_stock = current_stock - (v_ing.quantity * (1 + v_ing.waste_percent / 100)) WHERE id = v_ing.inventory_item_id AND lodge_id = p_lodge_id;
  END LOOP;

  -- Increase produced item stock
  UPDATE inventory_items SET current_stock = current_stock + v_batch.actual_yield_quantity WHERE id = v_batch.produced_inventory_item_id AND lodge_id = p_lodge_id;

  UPDATE restaurant_prep_batches SET status = 'posted', approved_by = p_lodge_id, posted_at = now() WHERE id = p_batch_id;

  SELECT to_jsonb(b.*) INTO v_result FROM restaurant_prep_batches b WHERE b.id = p_batch_id;
  RETURN v_result;
END;
$$;

-- 6.6 Kitchen Timing
CREATE OR REPLACE FUNCTION record_ticket_status_event(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_lodge_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  INSERT INTO restaurant_ticket_status_events (lodge_id, ticket_id, station, from_status, to_status, changed_by)
  VALUES (v_lodge_id, (payload->>'ticket_id')::uuid, payload->>'station', payload->>'from_status', payload->>'to_status', (payload->>'changed_by')::uuid)
  RETURNING to_jsonb(restaurant_ticket_status_events.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_kitchen_timing_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid DEFAULT NULL,
  p_station text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      COALESCE(station, 'unknown') AS station,
      COUNT(*) AS total_tickets,
      COUNT(*) FILTER (WHERE to_status = 'ready') AS ready_count,
      COUNT(*) FILTER (WHERE to_status = 'served') AS served_count,
      AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY ticket_id ORDER BY changed_at))) / 60) AS avg_prep_minutes
    FROM restaurant_ticket_status_events
    WHERE lodge_id = p_lodge_id
      AND changed_at::date BETWEEN p_start_date AND p_end_date
      AND (p_station IS NULL OR station = p_station)
    GROUP BY station
    ORDER BY total_tickets DESC
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 6.7 Purchase Suggestions
CREATE OR REPLACE FUNCTION get_low_stock_purchase_suggestions(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(s)) INTO v_result
  FROM (
    SELECT
      ii.id AS inventory_item_id,
      ii.name AS inventory_item_name,
      COALESCE(ii.current_stock, 0) AS current_stock,
      COALESCE(ii.reorder_level, 0) AS reorder_level,
      GREATEST(COALESCE(ii.reorder_level, 0) - COALESCE(ii.current_stock, 0), 0) AS suggested_quantity,
      'Low stock - below reorder level' AS reason,
      si.supplier_id,
      sup.name AS supplier_name,
      si.last_unit_cost
    FROM inventory_items ii
    LEFT JOIN restaurant_supplier_items si ON si.inventory_item_id = ii.id AND si.lodge_id = ii.lodge_id AND si.preferred = true
    LEFT JOIN restaurant_suppliers sup ON si.supplier_id = sup.id
    WHERE ii.lodge_id = p_lodge_id
      AND COALESCE(ii.current_stock, 0) <= COALESCE(ii.reorder_level, 0)
      AND ii.reorder_level > 0
      AND (p_outlet_id IS NULL OR ii.outlet_id = p_outlet_id OR ii.outlet_id IS NULL)
    ORDER BY (COALESCE(ii.reorder_level, 0) - COALESCE(ii.current_stock, 0)) DESC
  ) s;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_restaurant_supplier_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_lodge_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager']);

  INSERT INTO restaurant_supplier_items (lodge_id, supplier_id, inventory_item_id, supplier_sku, preferred, pack_size, pack_unit, last_unit_cost, lead_time_days)
  VALUES (v_lodge_id, (payload->>'supplier_id')::uuid, (payload->>'inventory_item_id')::uuid, payload->>'supplier_sku', COALESCE((payload->>'preferred')::boolean, false), (payload->>'pack_size')::numeric, payload->>'pack_unit', (payload->>'last_unit_cost')::numeric, (payload->>'lead_time_days')::integer)
  ON CONFLICT (lodge_id, supplier_id, inventory_item_id) DO UPDATE SET
    supplier_sku = EXCLUDED.supplier_sku, preferred = EXCLUDED.preferred, pack_size = EXCLUDED.pack_size, pack_unit = EXCLUDED.pack_unit, last_unit_cost = EXCLUDED.last_unit_cost, lead_time_days = EXCLUDED.lead_time_days, updated_at = now()
  RETURNING to_jsonb(restaurant_supplier_items.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION convert_purchase_suggestions_to_po(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid; v_supplier_id uuid; v_po_id uuid; v_result jsonb;
  v_suggestion jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_supplier_id := (payload->>'supplier_id')::uuid;
  PERFORM public.app_require_lodge_role(v_lodge_id, ARRAY['admin','manager']);

  -- Create draft purchase order
  INSERT INTO restaurant_purchase_orders (lodge_id, supplier_id, status, notes)
  VALUES (v_lodge_id, v_supplier_id, 'draft', COALESCE(payload->>'notes', 'Auto-created from purchase suggestions'))
  RETURNING id INTO v_po_id;

  -- Add items from suggestions
  FOR v_suggestion IN SELECT jsonb_array_elements(payload->'suggestions')
  LOOP
    INSERT INTO restaurant_purchase_order_items (purchase_order_id, inventory_item_id, quantity, unit_cost)
    VALUES (v_po_id, (v_suggestion->>'inventory_item_id')::uuid, (v_suggestion->>'quantity')::numeric, (v_suggestion->>'unit_cost')::numeric);
  END LOOP;

  -- Mark suggestions as converted
  UPDATE restaurant_purchase_suggestions SET status = 'converted', updated_at = now()
  WHERE lodge_id = v_lodge_id AND status = 'suggested'
    AND supplier_id = v_supplier_id
    AND id = ANY(ARRAY(SELECT (jsonb_array_elements(payload->'suggestions')->>'id')::uuid));

  SELECT to_jsonb(po.*) INTO v_result FROM restaurant_purchase_orders po WHERE po.id = v_po_id;
  RETURN v_result;
END;
$$;
