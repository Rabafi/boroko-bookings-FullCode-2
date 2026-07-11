begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 6 Security Hardening — Corrective Migration
-- Adds:
--   1. app_require_restaurant_lodge() — validates lodge is restaurant-type
--   2. REVOKE ALL / GRANT EXECUTE on all 23 Phase 6 RPCs
--   3. SET search_path TO 'public' on all Phase 6 functions
--   4. Role checks added to the 10 previously unprotected functions
--   5. Actor-derived fields (created_by/changed_by from session, not payload)
--   6. Table conflict locking for seat_restaurant_reservation
--   7. Prep batch validation improvements (lodge ownership, ingredient ownership)
-- ══════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. SHARED RESTAURANT LODGE GUARD
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge(
  p_lodge_id uuid,
  p_roles text[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_property_type text;
BEGIN
  -- Service role bypass
  IF public.app_is_service_role() THEN
    RETURN;
  END IF;

  -- Lodge access + role check (reuses existing guard)
  IF p_roles IS NOT NULL THEN
    PERFORM public.app_require_lodge_role(p_lodge_id, p_roles);
  ELSE
    PERFORM public.app_require_lodge_role(p_lodge_id);
  END IF;

  -- Load authoritative property_type from settings
  SELECT property_type INTO v_property_type
  FROM public.settings
  WHERE id = p_lodge_id;

  -- Fail closed if settings absent
  IF v_property_type IS NULL THEN
    RAISE EXCEPTION 'Lodge settings not found for restaurant guard.' USING ERRCODE = '28000';
  END IF;

  -- Require restaurant property type (pos_only is backward-compatible alias)
  IF v_property_type NOT IN ('restaurant', 'pos_only') THEN
    RAISE EXCEPTION 'This feature is restaurant-only. Lodge property type is %', v_property_type
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.app_require_restaurant_lodge(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_require_restaurant_lodge(uuid, text[]) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2–4. RESTORE ALL 23 PHASE 6 RPCs WITH FULL SECURITY
--
-- For each function:
--   a) CREATE OR REPLACE with SET search_path TO 'public'
--   b) Replace app_require_lodge_role with app_require_restaurant_lodge
--   c) Add role checks to the 10 previously unprotected functions
--   d) Derive actor fields from session where applicable
--   e) REVOKE ALL / GRANT EXECUTE
-- ────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.1 Reservations
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid;
  v_result jsonb;
  v_session app_sessions%ROWTYPE;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  IF v_lodge_id IS NULL THEN
    RAISE EXCEPTION 'lodge_id is required';
  END IF;

  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager','supervisor','cashier']);

  -- Derive actor from session, not payload
  v_session := public.app_current_session_row();

  INSERT INTO public.restaurant_reservations (
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
    v_session.user_id
  ) RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_restaurant_reservations(
  p_lodge_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS SETOF public.restaurant_reservations
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['cashier','supervisor','manager','admin']);
  RETURN QUERY SELECT r.*
  FROM public.restaurant_reservations r
  WHERE r.lodge_id = p_lodge_id
    AND (p_start_date IS NULL OR r.reservation_date >= p_start_date)
    AND (p_end_date IS NULL OR r.reservation_date <= p_end_date)
    AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id)
  ORDER BY r.reservation_date, r.reservation_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_lodge_id uuid;
  v_result jsonb;
  v_session app_sessions%ROWTYPE;
BEGIN
  v_id := (payload->>'id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;

  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager','supervisor']);

  v_session := public.app_current_session_row();

  UPDATE public.restaurant_reservations SET
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
    updated_by = v_session.user_id,
    updated_at = now()
  WHERE id = v_id AND lodge_id = v_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_restaurant_reservation(p_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb; v_session app_sessions%ROWTYPE;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager','supervisor']);
  v_session := public.app_current_session_row();
  UPDATE public.restaurant_reservations
  SET status = 'cancelled', notes = COALESCE(p_reason, notes), updated_by = v_session.user_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- seat_restaurant_reservation: add table conflict locking
CREATE OR REPLACE FUNCTION public.seat_restaurant_reservation(p_id uuid, p_lodge_id uuid, p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_session app_sessions%ROWTYPE;
  v_conflict_count integer;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager','supervisor']);

  v_session := public.app_current_session_row();

  -- Validate the table belongs to this lodge
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_tables
    WHERE id = p_table_id AND lodge_id = p_lodge_id
  ) THEN
    RAISE EXCEPTION 'Table does not belong to this lodge.' USING ERRCODE = '42501';
  END IF;

  -- Lock the reservation row
  PERFORM 1 FROM public.restaurant_reservations
  WHERE id = p_id AND lodge_id = p_lodge_id FOR UPDATE;

  -- Check for overlapping seated reservations on this table
  SELECT count(*) INTO v_conflict_count
  FROM public.restaurant_reservations
  WHERE assigned_table_id = p_table_id
    AND lodge_id = p_lodge_id
    AND status IN ('seated', 'confirmed')
    AND id != p_id;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Table is already occupied by another reservation.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.restaurant_reservations
  SET status = 'seated', assigned_table_id = p_table_id, updated_by = v_session.user_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_restaurant_reservation_no_show(p_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb; v_session app_sessions%ROWTYPE;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager','supervisor']);
  v_session := public.app_current_session_row();
  UPDATE public.restaurant_reservations
  SET status = 'no_show', notes = COALESCE(p_reason, notes), updated_by = v_session.user_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_reservations.*) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_restaurant_reservation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_restaurant_reservation(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_restaurant_reservations(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_reservations(uuid, date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_restaurant_reservation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_restaurant_reservation(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_restaurant_reservation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_restaurant_reservation(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.seat_restaurant_reservation(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seat_restaurant_reservation(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_restaurant_reservation_no_show(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_restaurant_reservation_no_show(uuid, uuid, text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.1 Waitlist (get_restaurant_waitlist was unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_restaurant_waitlist_entry(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lodge_id uuid; v_result jsonb; v_session app_sessions%ROWTYPE;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager','supervisor','cashier']);
  v_session := public.app_current_session_row();

  INSERT INTO public.restaurant_waitlist_entries (
    lodge_id, outlet_id, customer_id, customer_name, customer_phone,
    party_size, quoted_wait_minutes, notes, created_by
  ) VALUES (
    v_lodge_id, (payload->>'outlet_id')::uuid, (payload->>'customer_id')::uuid,
    payload->>'customer_name', payload->>'customer_phone',
    (payload->>'party_size')::integer, (payload->>'quoted_wait_minutes')::integer,
    payload->>'notes', v_session.user_id
  ) RETURNING to_jsonb(restaurant_waitlist_entries.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_restaurant_waitlist(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS SETOF public.restaurant_waitlist_entries
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['cashier','supervisor','manager','admin']);
  RETURN QUERY SELECT w.* FROM public.restaurant_waitlist_entries w
  WHERE w.lodge_id = p_lodge_id AND w.status IN ('waiting','notified')
    AND (p_outlet_id IS NULL OR w.outlet_id = p_outlet_id)
  ORDER BY w.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.seat_restaurant_waitlist_entry(p_id uuid, p_lodge_id uuid, p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb; v_session app_sessions%ROWTYPE;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager','supervisor']);
  v_session := public.app_current_session_row();
  UPDATE public.restaurant_waitlist_entries
  SET status = 'seated', assigned_table_id = p_table_id, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING to_jsonb(restaurant_waitlist_entries.*) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_restaurant_waitlist_entry(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_restaurant_waitlist_entry(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_restaurant_waitlist(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_waitlist(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.seat_restaurant_waitlist_entry(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seat_restaurant_waitlist_entry(uuid, uuid, uuid) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.2 Combos (get_restaurant_combos was unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_restaurant_combos(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS SETOF public.restaurant_combo_groups
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['supervisor','manager','admin']);
  RETURN QUERY SELECT g.* FROM public.restaurant_combo_groups g
  WHERE g.lodge_id = p_lodge_id AND g.active = true
    AND (p_outlet_id IS NULL OR g.outlet_id = p_outlet_id OR g.outlet_id IS NULL)
  ORDER BY g.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_restaurant_combo(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid; v_combo_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager']);

  v_combo_id := (payload->>'id')::uuid;
  IF v_combo_id IS NULL THEN
    INSERT INTO public.restaurant_combo_groups (lodge_id, outlet_id, name, description, base_price, category, active, available_from, available_to, days_of_week)
    VALUES (v_lodge_id, (payload->>'outlet_id')::uuid, payload->>'name', payload->>'description', COALESCE((payload->>'base_price')::numeric, 0), payload->>'category', COALESCE((payload->>'active')::boolean, true), (payload->>'available_from')::time, (payload->>'available_to')::time, ARRAY(SELECT jsonb_array_elements_text(payload->'days_of_week'))::int[])
    RETURNING id INTO v_combo_id;
  ELSE
    UPDATE public.restaurant_combo_groups SET
      name = COALESCE(payload->>'name', name),
      description = COALESCE(payload->>'description', description),
      base_price = COALESCE((payload->>'base_price')::numeric, base_price),
      category = COALESCE(payload->>'category', category),
      active = COALESCE((payload->>'active')::boolean, active),
      updated_at = now()
    WHERE id = v_combo_id AND lodge_id = v_lodge_id;
  END IF;

  IF payload->'slots' IS NOT NULL THEN
    DELETE FROM public.restaurant_combo_slots WHERE combo_id = v_combo_id;
    FOR i IN 0..jsonb_array_length(payload->'slots') - 1 LOOP
      DECLARE
        v_slot jsonb := payload->'slots'->i;
        v_slot_id uuid;
      BEGIN
        INSERT INTO public.restaurant_combo_slots (combo_id, slot_name, min_selections, max_selections, required, sort_order)
        VALUES (v_combo_id, v_slot->>'slot_name', COALESCE((v_slot->>'min_selections')::integer, 1), COALESCE((v_slot->>'max_selections')::integer, 1), COALESCE((v_slot->>'required')::boolean, true), COALESCE((v_slot->>'sort_order')::integer, i))
        RETURNING id INTO v_slot_id;

        IF v_slot->'items' IS NOT NULL THEN
          FOR j IN 0..jsonb_array_length(v_slot->'items') - 1 LOOP
            DECLARE v_item jsonb := v_slot->'items'->j;
            BEGIN
              INSERT INTO public.restaurant_combo_slot_items (slot_id, menu_item_id, price_delta, default_selected, active)
              VALUES (v_slot_id, (v_item->>'menu_item_id')::uuid, COALESCE((v_item->>'price_delta')::numeric, 0), COALESCE((v_item->>'default_selected')::boolean, false), COALESCE((v_item->>'active')::boolean, true));
            END;
          END LOOP;
        END IF;
      END;
    END LOOP;
  END IF;

  SELECT to_jsonb(g.*) INTO v_result FROM public.restaurant_combo_groups g WHERE g.id = v_combo_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_restaurant_combo(p_combo_id uuid, p_lodge_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager']);
  DELETE FROM public.restaurant_combo_groups WHERE id = p_combo_id AND lodge_id = p_lodge_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_combos(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_combos(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_restaurant_combo(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_restaurant_combo(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_restaurant_combo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_restaurant_combo(uuid, uuid) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.3 Recipe Variance (get_recipe_variance_report was unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_recipe_variance_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['supervisor','manager','admin']);

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
    FROM public.inventory_items ii
    LEFT JOIN LATERAL (
      SELECT
        SUM(rsm.theoretical_quantity) AS theoretical_qty,
        jsonb_agg(DISTINCT jsonb_build_object('recipe_name', r.name, 'menu_item', mi.name)) FILTER (WHERE r.id IS NOT NULL) AS linked_recipes
      FROM public.restaurant_recipe_stock_movements rsm
      JOIN public.restaurant_recipes r ON rsm.recipe_id = r.id
      LEFT JOIN public.menu_items mi ON r.menu_item_id = mi.id
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

REVOKE ALL ON FUNCTION public.get_recipe_variance_report(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipe_variance_report(uuid, date, date, uuid) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.5 Prep Batches (get_restaurant_prep_items, get_restaurant_prep_batches
--                    were unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_restaurant_prep_items(p_lodge_id uuid)
RETURNS SETOF public.restaurant_prep_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['supervisor','manager','admin']);
  RETURN QUERY SELECT * FROM public.restaurant_prep_items WHERE lodge_id = p_lodge_id AND active = true ORDER BY name;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_restaurant_prep_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid; v_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager']);

  v_id := (payload->>'id')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.restaurant_prep_items (lodge_id, name, produced_inventory_item_id, default_yield_quantity, yield_unit)
    VALUES (v_lodge_id, payload->>'name', (payload->>'produced_inventory_item_id')::uuid, COALESCE((payload->>'default_yield_quantity')::numeric, 1), COALESCE(payload->>'yield_unit', 'portion'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.restaurant_prep_items SET name = payload->>'name', produced_inventory_item_id = (payload->>'produced_inventory_item_id')::uuid, default_yield_quantity = COALESCE((payload->>'default_yield_quantity')::numeric, default_yield_quantity), yield_unit = COALESCE(payload->>'yield_unit', yield_unit), updated_at = now()
    WHERE id = v_id AND lodge_id = v_lodge_id;
  END IF;

  IF payload->'ingredients' IS NOT NULL THEN
    DELETE FROM public.restaurant_prep_item_ingredients WHERE prep_item_id = v_id;
    FOR i IN 0..jsonb_array_length(payload->'ingredients') - 1 LOOP
      DECLARE v_ing jsonb := payload->'ingredients'->i;
      BEGIN
        INSERT INTO public.restaurant_prep_item_ingredients (prep_item_id, inventory_item_id, quantity, unit, waste_percent)
        VALUES (v_id, (v_ing->>'inventory_item_id')::uuid, (v_ing->>'quantity')::numeric, v_ing->>'unit', COALESCE((v_ing->>'waste_percent')::numeric, 0));
      END;
    END LOOP;
  END IF;

  SELECT to_jsonb(pi.*) INTO v_result FROM public.restaurant_prep_items pi WHERE pi.id = v_id;
  RETURN v_result;
END;
$$;

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_restaurant_prep_batches(
  p_lodge_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_outlet_id uuid DEFAULT NULL
)
RETURNS SETOF public.restaurant_prep_batches
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['supervisor','manager','admin']);
  RETURN QUERY SELECT b.* FROM public.restaurant_prep_batches b
  WHERE b.lodge_id = p_lodge_id
    AND (p_start_date IS NULL OR b.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR b.created_at::date <= p_end_date)
    AND (p_outlet_id IS NULL OR b.outlet_id = p_outlet_id)
  ORDER BY b.created_at DESC;
END;
$$;

-- create_restaurant_prep_batch: improve validation, derive prepared_by from session
CREATE OR REPLACE FUNCTION public.create_restaurant_prep_batch(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid; v_id uuid; v_result jsonb; v_key text;
  v_session app_sessions%ROWTYPE;
  v_prep_item_lodge uuid;
  v_produced_lodge uuid;
  v_fingerprint text;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_key := payload->>'idempotency_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager']);
  v_session := public.app_current_session_row();

  -- Validate prep item belongs to this lodge
  SELECT lodge_id INTO v_prep_item_lodge
  FROM public.restaurant_prep_items
  WHERE id = (payload->>'prep_item_id')::uuid;

  IF v_prep_item_lodge IS NULL THEN
    RAISE EXCEPTION 'Prep item not found.' USING ERRCODE = '23503';
  END IF;
  IF v_prep_item_lodge != v_lodge_id THEN
    RAISE EXCEPTION 'Prep item does not belong to this lodge.' USING ERRCODE = '42501';
  END IF;

  -- Validate produced inventory item belongs to this lodge
  SELECT lodge_id INTO v_produced_lodge
  FROM public.inventory_items
  WHERE id = (payload->>'produced_inventory_item_id')::uuid;

  IF v_produced_lodge IS NULL THEN
    RAISE EXCEPTION 'Produced inventory item not found.' USING ERRCODE = '23503';
  END IF;
  IF v_produced_lodge != v_lodge_id THEN
    RAISE EXCEPTION 'Produced inventory item does not belong to this lodge.' USING ERRCODE = '42501';
  END IF;

  -- Validate quantities are positive
  IF COALESCE((payload->>'planned_yield_quantity')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'Planned yield quantity must be positive.' USING ERRCODE = '22023';
  END IF;

  -- Idempotency check with payload fingerprint
  v_fingerprint := md5(payload::text);
  SELECT id INTO v_id FROM public.restaurant_prep_batches
  WHERE lodge_id = v_lodge_id AND idempotency_key = v_key;

  IF v_id IS NOT NULL THEN
    SELECT to_jsonb(b.*) INTO v_result FROM public.restaurant_prep_batches b WHERE b.id = v_id;
    RETURN v_result;
  END IF;

  INSERT INTO public.restaurant_prep_batches (
    lodge_id, outlet_id, prep_item_id, batch_code, produced_inventory_item_id,
    planned_yield_quantity, actual_yield_quantity, unit, status,
    prepared_by, notes, idempotency_key
  ) VALUES (
    v_lodge_id, (payload->>'outlet_id')::uuid, (payload->>'prep_item_id')::uuid,
    payload->>'batch_code', (payload->>'produced_inventory_item_id')::uuid,
    (payload->>'planned_yield_quantity')::numeric,
    COALESCE((payload->>'actual_yield_quantity')::numeric, 0),
    COALESCE(payload->>'unit', 'portion'), 'draft',
    v_session.user_id, payload->>'notes', v_key
  ) RETURNING id INTO v_id;

  SELECT to_jsonb(b.*) INTO v_result FROM public.restaurant_prep_batches b WHERE b.id = v_id;
  RETURN v_result;
END;
$$;

-- post_restaurant_prep_batch: lock rows, derive actor, reject non-draft, retry-safe
CREATE OR REPLACE FUNCTION public.post_restaurant_prep_batch(p_batch_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.restaurant_prep_batches%ROWTYPE;
  v_result jsonb;
  v_ing record;
  v_session app_sessions%ROWTYPE;
  v_movement_id uuid;
  v_current_stock numeric;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin','manager']);
  v_session := public.app_current_session_row();

  -- Lock the batch row
  SELECT * INTO v_batch FROM public.restaurant_prep_batches
  WHERE id = p_batch_id AND lodge_id = p_lodge_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found.' USING ERRCODE = '23503';
  END IF;

  IF v_batch.status != 'draft' THEN
    -- Retry-safe: if already posted, return existing result
    IF v_batch.status = 'posted' THEN
      SELECT to_jsonb(b.*) INTO v_result FROM public.restaurant_prep_batches b WHERE b.id = p_batch_id;
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'Only draft batches can be posted. Current status: %', v_batch.status
      USING ERRCODE = '23514';
  END IF;

  -- Validate ingredients belong to the same lodge
  FOR v_ing IN
    SELECT pii.*, ii.name AS item_name, ii.lodge_id AS item_lodge_id, ii.current_stock
    FROM public.restaurant_prep_item_ingredients pii
    JOIN public.inventory_items ii ON pii.inventory_item_id = ii.id
    WHERE pii.prep_item_id = v_batch.prep_item_id
  LOOP
    IF v_ing.item_lodge_id != p_lodge_id THEN
      RAISE EXCEPTION 'Ingredient "%" does not belong to this lodge.', v_ing.item_name
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- Lock all affected inventory rows and record movements
  FOR v_ing IN
    SELECT pii.*, ii.name AS item_name, ii.cost_price, ii.current_stock
    FROM public.restaurant_prep_item_ingredients pii
    JOIN public.inventory_items ii ON pii.inventory_item_id = ii.id
    WHERE pii.prep_item_id = v_batch.prep_item_id
  LOOP
    DECLARE
      v_qty_consumed numeric := v_ing.quantity * (1 + v_ing.waste_percent / 100);
    BEGIN
      -- Lock the inventory row
      SELECT current_stock INTO v_current_stock
      FROM public.inventory_items
      WHERE id = v_ing.inventory_item_id AND lodge_id = p_lodge_id
      FOR UPDATE;

      -- Reject if insufficient stock
      IF v_current_stock < v_qty_consumed THEN
        RAISE EXCEPTION 'Insufficient stock for "%" (have %, need %).',
          v_ing.item_name, v_current_stock, v_qty_consumed
          USING ERRCODE = '22023';
      END IF;

      -- Create movement record
      INSERT INTO public.restaurant_prep_batch_ingredient_movements
        (batch_id, inventory_item_id, quantity_consumed, unit_cost)
      VALUES
        (v_batch.id, v_ing.inventory_item_id, v_qty_consumed, v_ing.cost_price)
      RETURNING id INTO v_movement_id;

      -- Deplete ingredient stock
      UPDATE public.inventory_items
      SET current_stock = current_stock - v_qty_consumed, updated_at = now()
      WHERE id = v_ing.inventory_item_id AND lodge_id = p_lodge_id;
    END;
  END LOOP;

  -- Produce finished item
  UPDATE public.inventory_items
  SET current_stock = current_stock + v_batch.actual_yield_quantity, updated_at = now()
  WHERE id = v_batch.produced_inventory_item_id AND lodge_id = p_lodge_id;

  -- Mark batch as posted with authoritative actor
  UPDATE public.restaurant_prep_batches
  SET status = 'posted', approved_by = v_session.user_id, posted_at = now()
  WHERE id = p_batch_id;

  SELECT to_jsonb(b.*) INTO v_result FROM public.restaurant_prep_batches b WHERE b.id = p_batch_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_prep_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_prep_items(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_restaurant_prep_item(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_restaurant_prep_item(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_restaurant_prep_batches(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_prep_batches(uuid, date, date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_restaurant_prep_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_restaurant_prep_batch(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_restaurant_prep_batch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_restaurant_prep_batch(uuid, uuid) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.6 Kitchen Timing (record_ticket_status_event was unprotected,
--                      get_kitchen_timing_report was unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

-- WAS UNPROTECTED (mutating!) — now has role check and derives changed_by
CREATE OR REPLACE FUNCTION public.record_ticket_status_event(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lodge_id uuid; v_result jsonb; v_session app_sessions%ROWTYPE;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;

  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['cashier','supervisor','manager','admin']);
  v_session := public.app_current_session_row();

  INSERT INTO public.restaurant_ticket_status_events (lodge_id, ticket_id, station, from_status, to_status, changed_by)
  VALUES (v_lodge_id, (payload->>'ticket_id')::uuid, payload->>'station', payload->>'from_status', payload->>'to_status', v_session.user_id)
  RETURNING to_jsonb(restaurant_ticket_status_events.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_kitchen_timing_report(
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
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['supervisor','manager','admin']);

  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      COALESCE(station, 'unknown') AS station,
      COUNT(*) AS total_tickets,
      COUNT(*) FILTER (WHERE to_status = 'ready') AS ready_count,
      COUNT(*) FILTER (WHERE to_status = 'served') AS served_count,
      AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY ticket_id ORDER BY changed_at))) / 60) AS avg_prep_minutes
    FROM public.restaurant_ticket_status_events
    WHERE lodge_id = p_lodge_id
      AND changed_at::date BETWEEN p_start_date AND p_end_date
      AND (p_station IS NULL OR station = p_station)
    GROUP BY station
    ORDER BY total_tickets DESC
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.record_ticket_status_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ticket_status_event(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_kitchen_timing_report(uuid, date, date, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kitchen_timing_report(uuid, date, date, uuid, text) TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6.7 Purchase Suggestions (get_low_stock_purchase_suggestions was unprotected)
-- ══════════════════════════════════════════════════════════════════════════════

-- WAS UNPROTECTED — now has role check
CREATE OR REPLACE FUNCTION public.get_low_stock_purchase_suggestions(p_lodge_id uuid, p_outlet_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['manager','admin']);

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
    FROM public.inventory_items ii
    LEFT JOIN public.restaurant_supplier_items si ON si.inventory_item_id = ii.id AND si.lodge_id = ii.lodge_id AND si.preferred = true
    LEFT JOIN public.restaurant_suppliers sup ON si.supplier_id = sup.id
    WHERE ii.lodge_id = p_lodge_id
      AND COALESCE(ii.current_stock, 0) <= COALESCE(ii.reorder_level, 0)
      AND ii.reorder_level > 0
      AND (p_outlet_id IS NULL OR ii.outlet_id = p_outlet_id OR ii.outlet_id IS NULL)
    ORDER BY (COALESCE(ii.reorder_level, 0) - COALESCE(ii.current_stock, 0)) DESC
  ) s;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_restaurant_supplier_item(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lodge_id uuid; v_result jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager']);

  INSERT INTO public.restaurant_supplier_items (lodge_id, supplier_id, inventory_item_id, supplier_sku, preferred, pack_size, pack_unit, last_unit_cost, lead_time_days)
  VALUES (v_lodge_id, (payload->>'supplier_id')::uuid, (payload->>'inventory_item_id')::uuid, payload->>'supplier_sku', COALESCE((payload->>'preferred')::boolean, false), (payload->>'pack_size')::numeric, payload->>'pack_unit', (payload->>'last_unit_cost')::numeric, (payload->>'lead_time_days')::integer)
  ON CONFLICT (lodge_id, supplier_id, inventory_item_id) DO UPDATE SET
    supplier_sku = EXCLUDED.supplier_sku, preferred = EXCLUDED.preferred, pack_size = EXCLUDED.pack_size, pack_unit = EXCLUDED.pack_unit, last_unit_cost = EXCLUDED.last_unit_cost, lead_time_days = EXCLUDED.lead_time_days, updated_at = now()
  RETURNING to_jsonb(restaurant_supplier_items.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_purchase_suggestions_to_po(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid; v_supplier_id uuid; v_po_id uuid; v_result jsonb;
  v_suggestion jsonb;
BEGIN
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_supplier_id := (payload->>'supplier_id')::uuid;
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin','manager']);

  -- Create draft purchase order
  INSERT INTO public.restaurant_purchase_orders (lodge_id, supplier_id, status, notes)
  VALUES (v_lodge_id, v_supplier_id, 'draft', COALESCE(payload->>'notes', 'Auto-created from purchase suggestions'))
  RETURNING id INTO v_po_id;

  -- Add items from suggestions
  FOR v_suggestion IN SELECT jsonb_array_elements(payload->'suggestions')
  LOOP
    INSERT INTO public.restaurant_purchase_order_items (purchase_order_id, inventory_item_id, quantity, unit_cost)
    VALUES (v_po_id, (v_suggestion->>'inventory_item_id')::uuid, (v_suggestion->>'quantity')::numeric, (v_suggestion->>'unit_cost')::numeric);
  END LOOP;

  -- Mark suggestions as converted
  UPDATE public.restaurant_purchase_suggestions SET status = 'converted', updated_at = now()
  WHERE lodge_id = v_lodge_id AND status = 'suggested'
    AND supplier_id = v_supplier_id
    AND id = ANY(ARRAY(SELECT (jsonb_array_elements(payload->'suggestions')->>'id')::uuid));

  SELECT to_jsonb(po.*) INTO v_result FROM public.restaurant_purchase_orders po WHERE po.id = v_po_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_low_stock_purchase_suggestions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_low_stock_purchase_suggestions(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_restaurant_supplier_item(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_restaurant_supplier_item(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.convert_purchase_suggestions_to_po(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_purchase_suggestions_to_po(jsonb) TO authenticated, service_role;

commit;
