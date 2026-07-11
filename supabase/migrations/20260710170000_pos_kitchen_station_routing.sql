begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- POS Kitchen Station Routing
-- Server-backed kitchen stations, menu-item station assignment, and
-- item-grouped ticket creation in create_pos_order_v3.
-- ══════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. KITCHEN STATIONS TABLE
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.pos_kitchen_stations (
  id          uuid primary key default gen_random_uuid(),
  lodge_id    uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id   uuid null references public.outlets(id) on delete cascade,
  station_key text not null,
  name        text not null,
  station_type text not null check (station_type in ('kitchen', 'bar', 'prep', 'other')),
  enabled     boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lodge_id, outlet_id, station_key)
);

alter table public.pos_kitchen_stations enable row level security;

create policy "pos_kitchen_stations_lodge_isolation" on public.pos_kitchen_stations
  for all using (public.app_lodge_access(lodge_id))
  with check (public.app_lodge_access(lodge_id));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ADD kitchen_station_id TO pos_menu_items
-- ────────────────────────────────────────────────────────────────────────────

alter table public.pos_menu_items
  add column if not exists kitchen_station_id uuid null
  references public.pos_kitchen_stations(id) on delete set null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. GET POS KITCHEN STATIONS
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_pos_kitchen_stations(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns table (
  id          uuid,
  lodge_id    uuid,
  outlet_id   uuid,
  station_key text,
  name        text,
  station_type text,
  enabled     boolean,
  sort_order  integer,
  created_at  timestamptz,
  updated_at  timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.app_is_service_role() then
    return query
    select s.id, s.lodge_id, s.outlet_id, s.station_key, s.name, s.station_type, s.enabled, s.sort_order, s.created_at, s.updated_at
    from public.pos_kitchen_stations s
    where s.lodge_id = p_lodge_id
      and (p_outlet_id is null or s.outlet_id is null or s.outlet_id = p_outlet_id)
    order by s.sort_order, s.name;
    return;
  end if;

  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  return query
  select s.id, s.lodge_id, s.outlet_id, s.station_key, s.name, s.station_type, s.enabled, s.sort_order, s.created_at, s.updated_at
  from public.pos_kitchen_stations s
  where s.lodge_id = p_lodge_id
    and (p_outlet_id is null or s.outlet_id is null or s.outlet_id = p_outlet_id)
  order by s.sort_order, s.name;
end;
$$;

revoke all on function public.get_pos_kitchen_stations(uuid, uuid) from public;
grant execute on function public.get_pos_kitchen_stations(uuid, uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. UPSERT POS KITCHEN STATION
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.upsert_pos_kitchen_station(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id    uuid;
  v_outlet_id   uuid;
  v_station_key text;
  v_name        text;
  v_station_type text;
  v_enabled     boolean;
  v_sort_order  integer;
  v_id          uuid;
  v_existing    record;
  v_session     record;
begin
  v_session := public.app_current_session_row();
  if v_session.user_id is null then
    return jsonb_build_object('success', false, 'error', 'Authentication required.');
  end if;

  v_lodge_id    := (payload->>'lodge_id')::uuid;
  v_outlet_id   := nullif(payload->>'outlet_id', '')::uuid;
  v_station_key := trim(payload->>'station_key');
  v_name        := trim(payload->>'name');
  v_station_type := coalesce(nullif(payload->>'station_type', ''), 'kitchen');
  v_enabled     := coalesce((payload->>'enabled')::boolean, true);
  v_sort_order  := coalesce((payload->>'sort_order')::integer, 0);
  v_id          := nullif(payload->>'id', '')::uuid;

  if v_lodge_id is null or v_station_key = '' or v_name = '' then
    return jsonb_build_object('success', false, 'error', 'lodge_id, station_key, and name are required.');
  end if;

  if v_station_type not in ('kitchen', 'bar', 'prep', 'other') then
    return jsonb_build_object('success', false, 'error', 'station_type must be kitchen, bar, prep, or other.');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  select * into v_existing
  from public.pos_kitchen_stations s
  where s.lodge_id = v_lodge_id
    and s.station_key = v_station_key
    and (s.outlet_id is not distinct from v_outlet_id);

  if v_existing.id is not null and v_id is null then
    v_id := v_existing.id;
  end if;

  if v_id is not null then
    update public.pos_kitchen_stations set
      name = v_name,
      station_type = v_station_type,
      enabled = v_enabled,
      sort_order = v_sort_order,
      outlet_id = v_outlet_id,
      updated_at = now()
    where id = v_id
    returning id into v_id;
  else
    insert into public.pos_kitchen_stations (lodge_id, outlet_id, station_key, name, station_type, enabled, sort_order)
    values (v_lodge_id, v_outlet_id, v_station_key, v_name, v_station_type, v_enabled, v_sort_order)
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'station', jsonb_build_object(
      'id', v_id,
      'lodge_id', v_lodge_id,
      'outlet_id', v_outlet_id,
      'station_key', v_station_key,
      'name', v_name,
      'station_type', v_station_type,
      'enabled', v_enabled,
      'sort_order', v_sort_order
    )
  );
end;
$$;

revoke all on function public.upsert_pos_kitchen_station(jsonb) from public;
grant execute on function public.upsert_pos_kitchen_station(jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. DELETE POS KITCHEN STATION
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_pos_kitchen_station(
  p_lodge_id uuid,
  p_station_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session record;
begin
  v_session := public.app_current_session_row();
  if v_session.user_id is null then
    return jsonb_build_object('success', false, 'error', 'Authentication required.');
  end if;

  if p_lodge_id is null or p_station_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id and station_id are required.');
  end if;

  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  delete from public.pos_kitchen_stations
  where id = p_station_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.delete_pos_kitchen_station(uuid, uuid) from public;
grant execute on function public.delete_pos_kitchen_station(uuid, uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. UPDATE create_pos_menu_item TO ACCEPT kitchen_station_id
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_pos_menu_item(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id       uuid;
  v_outlet_id      uuid;
  v_name           text;
  v_id             uuid;
  v_station_id     uuid;
  v_station_lodge  uuid;
begin
  v_lodge_id  := (payload->>'lodge_id')::uuid;
  v_outlet_id := nullif(payload->>'outlet_id', '')::uuid;
  v_name      := trim(payload->>'name');
  v_station_id := nullif(payload->>'kitchen_station_id', '')::uuid;

  if v_lodge_id is null or v_name = '' then
    return jsonb_build_object('success', false, 'error', 'lodge_id and name are required.');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_station_id is not null then
    select lodge_id into v_station_lodge from public.pos_kitchen_stations where id = v_station_id;
    if v_station_lodge is null or v_station_lodge != v_lodge_id then
      return jsonb_build_object('success', false, 'error', 'Station does not belong to this lodge.');
    end if;
    if not exists (
      select 1 from public.pos_kitchen_stations
      where id = v_station_id and enabled = true
        and (outlet_id is null or outlet_id = v_outlet_id)
    ) then
      return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.');
    end if;
  end if;

  insert into public.pos_menu_items (
    lodge_id, name, category, price, is_available, barcode,
    inventory_item_id, depletion_qty, outlet_id,
    dietary_flags, prep_time_minutes, is_popular, kitchen_station_id
  ) values (
    v_lodge_id,
    v_name,
    coalesce(nullif(payload->>'category', ''), 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    nullif(payload->>'depletion_qty', '')::numeric,
    v_outlet_id,
    coalesce(payload->'dietary_flags', '[]'::jsonb),
    coalesce((payload->>'prep_time_minutes')::integer, 0),
    coalesce((payload->>'is_popular')::boolean, false),
    v_station_id
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. UPDATE update_pos_menu_item TO ACCEPT kitchen_station_id
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.update_pos_menu_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_station_id     uuid;
  v_outlet_id      uuid;
  v_station_lodge  uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_station_id := nullif(payload->>'kitchen_station_id', '')::uuid;
  v_outlet_id  := nullif(payload->>'outlet_id', '')::uuid;

  if v_station_id is not null then
    select lodge_id into v_station_lodge from public.pos_kitchen_stations where id = v_station_id;
    if v_station_lodge is null or v_station_lodge != p_lodge_id then
      return jsonb_build_object('success', false, 'error', 'Station does not belong to this lodge.');
    end if;
    if not exists (
      select 1 from public.pos_kitchen_stations
      where id = v_station_id and enabled = true
        and (outlet_id is null or outlet_id = v_outlet_id)
    ) then
      return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.');
    end if;
  end if;

  update public.pos_menu_items set
    name = coalesce(nullif(payload->>'name', ''), name),
    category = coalesce(nullif(payload->>'category', ''), category),
    price = coalesce((payload->>'price')::numeric, price),
    is_available = coalesce((payload->>'is_available')::boolean, is_available),
    barcode = payload->>'barcode',
    inventory_item_id = nullif(payload->>'inventory_item_id', '')::uuid,
    depletion_qty = nullif(payload->>'depletion_qty', '')::numeric,
    outlet_id = CASE WHEN payload ? 'outlet_id' THEN v_outlet_id ELSE outlet_id END,
    dietary_flags = coalesce(payload->'dietary_flags', dietary_flags),
    prep_time_minutes = coalesce((payload->>'prep_time_minutes')::integer, prep_time_minutes),
    is_popular = coalesce((payload->>'is_popular')::boolean, is_popular),
    kitchen_station_id = CASE WHEN payload ? 'kitchen_station_id' THEN v_station_id ELSE kitchen_station_id END,
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. REPLACE create_pos_order_v3 WITH ITEM-GROUPED STATION ROUTING
-- ────────────────────────────────────────────────────────────────────────────
-- The original v3 removed prep ticket creation. This version adds it back with
-- per-item station routing: items are grouped by kitchen_station_id from
-- pos_menu_items (falling back to outlet-type routing when unset), and one
-- prep ticket is created per station group.

CREATE OR REPLACE FUNCTION public.create_pos_order_v3(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := nullif(payload->>'id', '')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_snapshot_id uuid := nullif(payload->>'catalog_snapshot_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_client_at timestamptz := nullif(payload->>'client_created_at', '')::timestamptz;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'create_idempotency_key', '')), '');
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_device_id text := nullif(btrim(coalesce(payload->>'source_device_id', '')), '');
  v_payment_method text := lower(coalesce(nullif(payload->>'payment_method', ''), 'cash'));
  v_payment_breakdown jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_manual_discount jsonb := coalesce(payload->'manual_discount', '{}'::jsonb);
  v_promotion_id uuid := nullif(payload->>'promotion_id', '')::uuid;
  v_tip_total numeric := round(greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0)), 2);
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_event_booking_id uuid := nullif(payload->>'event_booking_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_operator_id uuid;
  v_actor_role text := lower(coalesce(public.app_current_role(), ''));
  v_snapshot record;
  v_shift record;
  v_offline_hours integer := 72;
  v_request_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_line jsonb;
  v_catalog_item jsonb;
  v_modifier_group jsonb;
  v_modifier_option jsonb;
  v_modifier_id text;
  v_modifier_ids jsonb;
  v_resolved_modifiers jsonb;
  v_priced_items jsonb := '[]'::jsonb;
  v_priced_line jsonb;
  v_menu_item_id uuid;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_depletion_qty numeric;
  v_base_price numeric;
  v_modifier_total numeric;
  v_unit_price numeric;
  v_line_gross numeric;
  v_gross_total numeric := 0;
  v_discount_total numeric := 0;
  v_promotion_discount numeric := 0;
  v_manual_discount_amount numeric := 0;
  v_promotion jsonb;
  v_promotion_base numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_payment_total numeric := 0;
  v_payment jsonb;
  v_usage record;
  v_stock numeric;
  v_line_count integer;
  v_line_index integer := 0;
  v_discount_allocated numeric := 0;
  v_tax_allocated numeric := 0;
  v_line_discount numeric := 0;
  v_line_tax numeric := 0;
  v_line_net numeric := 0;
  v_authoritative_items jsonb := '[]'::jsonb;
  v_order_item_id uuid;
  v_folio_charge_id uuid;
  v_is_event_folio boolean := false;
  -- Station routing variables
  v_station_groups jsonb := '{}'::jsonb;
  v_station_key text;
  v_station_items jsonb;
  v_outlet_type text := '';
  v_default_station text := 'kitchen';
  v_ticket_id uuid;
  v_ticket_items jsonb;
  v_tickets_created jsonb := '[]'::jsonb;
  v_ticket record;
BEGIN
  IF v_order_id IS NULL THEN v_order_id := public.gen_random_uuid(); END IF;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  IF v_idempotency_key IS NULL OR length(v_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'create_idempotency_key is required (min 8 chars)');
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least one item is required');
  END IF;

  IF v_snapshot_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'catalog_snapshot_id is required');
  END IF;

  IF v_shift_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'shift_id is required');
  END IF;

  IF v_client_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_created_at is required');
  END IF;

  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT role INTO v_actor_role
  FROM public.user_lodge_roles
  WHERE user_id = v_actor_id AND lodge_id = v_lodge_id
  LIMIT 1;

  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  IF v_actor_role NOT IN ('cashier', 'supervisor', 'manager', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS access requires cashier role or above');
  END IF;

  IF v_outlet_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pos_outlets
      WHERE id = v_outlet_id AND lodge_id = v_lodge_id AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Outlet not found or inactive');
    END IF;
  END IF;

  SELECT public._claim_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, 'order', jsonb_build_object('client_created_at', v_client_at)
  ) INTO v_claim;

  IF (v_claim->>'claimed')::boolean = false THEN
    IF (v_claim->>'expired')::boolean = true THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'Idempotency key has expired. Please retry.',
        'code', 'idempotency_expired', 'manual_review_required', true
      );
    END IF;
    v_result := (v_claim->>'result')::jsonb;
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  v_request_hash := encode(sha512(convert_to(v_idempotency_key, 'utf8')), 'hex');

  SELECT * INTO v_snapshot
  FROM public.pos_catalog_snapshots
  WHERE id = v_snapshot_id AND lodge_id = v_lodge_id;

  IF v_snapshot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Catalog snapshot not found');
  END IF;

  SELECT * INTO v_shift
  FROM public.pos_shifts
  WHERE id = v_shift_id AND lodge_id = v_lodge_id AND status = 'open';

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found or not open');
  END IF;

  v_operator_id := coalesce(v_shift.user_id, v_actor_id);

  -- Resolve default station from outlet type
  IF v_outlet_id IS NOT NULL THEN
    SELECT lower(coalesce(type, '')) INTO v_outlet_type
    FROM public.outlets WHERE id = v_outlet_id AND lodge_id = v_lodge_id;
    IF v_outlet_type = 'beverage' THEN v_default_station := 'bar';
    END IF;
  END IF;

  -- Price each item from catalog
  for v_line in select value from jsonb_array_elements(v_items)
  loop
    v_menu_item_id := nullif(v_line->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_line->>'quantity')::numeric, 1);
    if v_quantity <= 0 then v_quantity := 1; end if;
    v_depletion_qty := coalesce((v_line->>'depletion_qty')::numeric, 1);

    v_catalog_item := null;
    if v_menu_item_id is not null then
      select value into v_catalog_item
      from jsonb_array_elements(coalesce(v_snapshot.items, '[]'::jsonb))
      where (value->>'id')::uuid = v_menu_item_id;
    end if;

    if v_catalog_item is not null then
      v_base_price := coalesce((v_catalog_item->>'price')::numeric, 0);
    else
      v_base_price := coalesce((v_line->>'unit_price')::numeric, 0);
    end if;

    v_modifier_total := 0;
    v_resolved_modifiers := '[]'::jsonb;
    v_modifier_ids := coalesce(v_line->'modifier_option_ids', '[]'::jsonb);
    if jsonb_array_length(v_modifier_ids) > 0 and v_catalog_item is not null then
      for v_modifier_group in select value from jsonb_array_elements(coalesce(v_catalog_item->'modifier_groups', '[]'::jsonb))
      loop
        for v_modifier_option in select value from jsonb_array_elements(coalesce(v_modifier_group->'options', '[]'::jsonb))
        loop
          v_modifier_id := (v_modifier_option->>'id')::text;
          if v_modifier_ids ? v_modifier_id then
            v_modifier_total := v_modifier_total + coalesce((v_modifier_option->>'price')::numeric, 0);
            v_resolved_modifiers := v_resolved_modifiers || jsonb_build_array(v_modifier_option);
          end if;
        end loop;
      end loop;
    end if;

    v_unit_price := round(v_base_price + v_modifier_total, 2);
    v_line_gross := round(v_unit_price * v_quantity, 2);

    v_priced_items := v_priced_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_menu_item_id,
        'item_name', coalesce(v_catalog_item->>'name', v_line->>'item_name', 'Item'),
        'quantity', v_quantity,
        'unit_price', v_unit_price,
        'base_unit_price', v_base_price,
        'modifiers', v_resolved_modifiers,
        'modifier_total', v_modifier_total,
        'gross_subtotal', v_line_gross,
        'category', coalesce(v_catalog_item->>'category', v_line->>'category', 'Other'),
        'inventory_item_id', coalesce(
          nullif(v_line->>'inventory_item_id', '')::uuid,
          (v_catalog_item->>'inventory_item_id')::uuid
        ),
        'depletion_qty', v_depletion_qty,
        'item_notes', v_line->>'item_notes'
      )
    );
  end loop;

  -- Discounts and promotions
  v_gross_total := 0;
  for v_priced_line in select value from jsonb_array_elements(v_priced_items)
  loop
    v_gross_total := v_gross_total + (v_priced_line->>'gross_subtotal')::numeric;
  end loop;

  v_manual_discount_amount := 0;
  if v_manual_discount ? 'amount' then
    v_manual_discount_amount := coalesce((v_manual_discount->>'amount')::numeric, 0);
  elsif v_manual_discount ? 'percent' then
    v_manual_discount_amount := round(v_gross_total * coalesce((v_manual_discount->>'percent')::numeric, 0) / 100, 2);
  end if;
  v_discount_total := v_discount_total + v_manual_discount_amount;

  if v_promotion_id is not null then
    select * into v_promotion from public.pos_promotions
    where id = v_promotion_id and lodge_id = v_lodge_id and is_active = true;
    if v_promotion.id is not null then
      v_promotion_base := v_gross_total - v_manual_discount_amount;
      if v_promotion.type = 'percent' then
        v_promotion_discount := round(v_promotion_base * coalesce(v_promotion.value, 0) / 100, 2);
      elsif v_promotion.type = 'fixed' then
        v_promotion_discount := least(coalesce(v_promotion.value, 0), v_promotion_base);
      end if;
      v_discount_total := v_discount_total + v_promotion_discount;
    end if;
  end if;

  v_discount_total := round(least(v_discount_total, v_gross_total), 2);
  v_tax_total := round((v_gross_total - v_discount_total) * coalesce(v_snapshot.vat_rate, 0) / 100, 2);
  v_total := round(v_gross_total - v_discount_total + v_tax_total + v_tip_total, 2);

  -- Payment validation
  if v_payment_method != 'none' and v_payment_method != 'folio' then
    v_payment_total := 0;
    for v_payment in select value from jsonb_array_elements(v_payment_breakdown)
    loop
      v_payment_total := v_payment_total + coalesce((v_payment->>'amount')::numeric, 0);
    end loop;
    if abs(v_payment_total - v_total) > 0.01 then
      return jsonb_build_object('success', false, 'error',
        format('Payment total %s does not match order total %s', v_payment_total, v_total));
    end if;
  end if;

  -- Inventory stock check
  for v_usage in
    select
      (value->>'inventory_item_id')::uuid as inventory_item_id,
      value->>'item_name' as item_name,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by (value->>'inventory_item_id')::uuid, value->>'item_name'
  loop
    select current_stock into v_stock from public.inventory_items
    where id = v_usage.inventory_item_id and lodge_id = v_lodge_id;
    if coalesce(v_stock, 0) < v_usage.required_stock then
      return jsonb_build_object(
        'success', false,
        'error', format('Insufficient stock for %s', v_usage.item_name),
        'code', 'insufficient_stock'
      );
    end if;
  end loop;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, event_booking_id, walk_in_name, status, total, notes,
    completed_at, payment_method, outlet_id, create_idempotency_key,
    gross_total, discount_total, tax_rate, tax_total, tip_total,
    payment_breakdown, service_mode, table_name, tab_name, waiter_name,
    cashier_id, cashier_name, shift_id, ticket_status, transaction_type,
    catalog_snapshot_id, source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_event_booking_id,
    nullif(payload->>'walk_in_name', ''), 'completed', v_total,
    nullif(payload->>'notes', ''), now(), v_payment_method, v_outlet_id,
    v_idempotency_key, v_gross_total, v_discount_total,
    coalesce(v_snapshot.vat_rate, 0), v_tax_total, v_tip_total,
    v_payment_breakdown, nullif(payload->>'service_mode', ''),
    nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''),
    nullif(payload->>'waiter_name', ''), v_operator_id,
    (select u.name from public.users u where u.id = v_operator_id),
    v_shift_id, coalesce(nullif(payload->>'ticket_status', ''), 'new'),
    'sale', v_snapshot_id, v_device_id, v_client_at, now()
  );

  v_line_count := jsonb_array_length(v_priced_items);
  for v_priced_line in select value from jsonb_array_elements(v_priced_items)
  loop
    v_line_index := v_line_index + 1;
    v_line_gross := (v_priced_line->>'gross_subtotal')::numeric;
    if v_line_index = v_line_count then
      v_line_discount := v_discount_total - v_discount_allocated;
      v_line_tax := v_tax_total - v_tax_allocated;
    else
      v_line_discount := case when v_gross_total > 0
        then round(v_line_gross * v_discount_total / v_gross_total, 2)
        else 0 end;
      v_line_tax := case when v_gross_total - v_discount_total > 0
        then round((v_line_gross - v_line_discount) * v_tax_total / (v_gross_total - v_discount_total), 2)
        else 0 end;
    end if;
    v_discount_allocated := v_discount_allocated + v_line_discount;
    v_tax_allocated := v_tax_allocated + v_line_tax;
    v_line_net := round(v_line_gross - v_line_discount + v_line_tax, 2);

    insert into public.pos_order_items (
      lodge_id, order_id, menu_item_id, item_name, quantity, unit_price,
      subtotal, inventory_item_id, depletion_qty, category, modifiers,
      item_notes, gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_lodge_id, v_order_id,
      nullif(v_priced_line->>'menu_item_id', '')::uuid,
      v_priced_line->>'item_name',
      (v_priced_line->>'quantity')::integer,
      (v_priced_line->>'unit_price')::numeric,
      v_line_net,
      nullif(v_priced_line->>'inventory_item_id', '')::uuid,
      (v_priced_line->>'depletion_qty')::numeric,
      v_priced_line->>'category',
      coalesce(v_priced_line->'modifiers', '[]'::jsonb),
      nullif(v_priced_line->>'item_notes', ''),
      v_line_gross, v_line_discount, v_line_tax, v_line_net
    )
    returning id into v_order_item_id;

    v_authoritative_items := v_authoritative_items || jsonb_build_array(
      v_priced_line || jsonb_build_object(
        'id', v_order_item_id,
        'discount_allocated', v_line_discount,
        'tax_allocated', v_line_tax,
        'net_subtotal', v_line_net
      )
    );
  end loop;

  for v_usage in
    select
      nullif(value->>'inventory_item_id', '')::uuid as inventory_item_id,
      sum((value->>'quantity')::numeric * (value->>'depletion_qty')::numeric) as required_stock
    from jsonb_array_elements(v_priced_items)
    where nullif(value->>'inventory_item_id', '') is not null
    group by nullif(value->>'inventory_item_id', '')::uuid
  loop
    update public.inventory_items
       set current_stock = current_stock - v_usage.required_stock,
           updated_at = now()
     where id = v_usage.inventory_item_id
       and lodge_id = v_lodge_id;
  end loop;

  -- ─── Item-grouped station ticket creation ──────────────────────────────────
  -- Group order items by kitchen_station_id from pos_menu_items, falling back
  -- to the outlet-type default (kitchen/bar) when no station is assigned.
  -- One prep ticket is created per station group.

  for v_priced_line in select value from jsonb_array_elements(v_authoritative_items)
  loop
    v_station_key := v_default_station;

    -- Look up the item's assigned station from pos_menu_items
    if nullif(v_priced_line->>'menu_item_id', '') is not null then
      select coalesce(s.station_key, v_default_station) into v_station_key
      from public.pos_menu_items mi
      left join public.pos_kitchen_stations s
        on s.id = mi.kitchen_station_id and s.lodge_id = v_lodge_id and s.enabled = true
      where mi.id = (v_priced_line->>'menu_item_id')::uuid
        and mi.lodge_id = v_lodge_id;
    end if;

    if v_station_key is null or v_station_key = '' then
      v_station_key := v_default_station;
    end if;

    -- Accumulate items into station groups
    v_station_items := coalesce(v_station_groups->v_station_key, '[]'::jsonb);
    v_station_groups := v_station_groups || jsonb_build_object(
      v_station_key,
      v_station_items || jsonb_build_array(v_priced_line)
    );
  end loop;

  -- Insert one prep ticket per station group
  for v_station_key in select jsonb_object_keys(v_station_groups)
  loop
    v_ticket_items := v_station_groups->v_station_key;
    v_ticket_id := public.gen_random_uuid();

    insert into public.pos_prep_tickets (
      id, lodge_id, order_id, outlet_id, station, status,
      table_name, tab_name, waiter_name, room_id, notes, items
    ) values (
      v_ticket_id, v_lodge_id, v_order_id, v_outlet_id,
      v_station_key, 'new',
      nullif(payload->>'table_name', ''),
      nullif(payload->>'tab_name', ''),
      nullif(payload->>'waiter_name', ''),
      v_room_id,
      nullif(payload->>'notes', ''),
      v_ticket_items
    )
    returning * into v_ticket;

    v_tickets_created := v_tickets_created || jsonb_build_array(to_jsonb(v_ticket));
  end loop;

  -- ─── Folio charge (room or event) ──────────────────────────────────────────
  if v_payment_method = 'folio' then
    if v_is_event_folio then
      INSERT INTO public.event_booking_line_items (
        event_booking_id, lodge_id, line_type, description, category,
        quantity, unit_price, subtotal, created_by
      ) VALUES (
        v_event_booking_id, v_lodge_id, 'pos', 'POS order ' || left(v_order_id::text, 8),
        'pos', 1, v_total, v_total, v_actor_id
      )
      returning id into v_folio_charge_id;

      update public.pos_orders
         set folio_charge_id = v_folio_charge_id
       where id = v_order_id;

      perform public.recalculate_event_totals(v_event_booking_id);
    else
      insert into public.booking_charges (
        lodge_id, booking_id, description, amount, category, quantity,
        outlet_id, source_type, source_id
      ) values (
        v_lodge_id, v_booking_id,
        'POS order ' || left(v_order_id::text, 8),
        v_total, 'pos', 1, v_outlet_id, 'pos_order', v_order_id
      )
      returning id into v_folio_charge_id;

      update public.pos_orders
         set folio_charge_id = v_folio_charge_id
       where id = v_order_id;
    end if;
  end if;

  if v_manual_discount_amount > 0 then
    insert into public.pos_audit_log (
      lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
      device_id, action, entity_type, entity_id, staff_id, amount_delta,
      idempotency_key, client_at, after_snapshot, details
    ) values (
      v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
      v_device_id, 'pos_discount_applied', 'pos_order', v_order_id, v_operator_id,
      -v_manual_discount_amount, v_idempotency_key, v_client_at,
      v_manual_discount, v_manual_discount
    );
  end if;

  insert into public.pos_audit_log (
    lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
    device_id, action, entity_type, entity_id, staff_id, amount_delta,
    idempotency_key, client_at, after_snapshot, details
  ) values (
    v_lodge_id, v_outlet_id, v_shift_id, v_order_id, v_actor_id, v_operator_id,
    v_device_id, 'pos_order_created', 'pos_order', v_order_id, v_operator_id,
    v_total, v_idempotency_key, v_client_at,
    jsonb_build_object(
      'total', v_total, 'gross_total', v_gross_total,
      'discount_total', v_discount_total, 'tax_total', v_tax_total,
      'tip_total', v_tip_total, 'catalog_snapshot_id', v_snapshot_id,
      'items', v_authoritative_items
    ),
    jsonb_build_object('payment_method', v_payment_method, 'folio_charge_id', v_folio_charge_id, 'event_booking_id', v_event_booking_id)
  );

  v_result := jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_total,
    'gross_total', v_gross_total,
    'discount_total', v_discount_total,
    'tax_rate', coalesce(v_snapshot.vat_rate, 0),
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'payment_method', v_payment_method,
    'payment_breakdown', v_payment_breakdown,
    'catalog_snapshot_id', v_snapshot_id,
    'shift_id', v_shift_id,
    'cashier_id', v_operator_id,
    'folio_charge_id', v_folio_charge_id,
    'event_booking_id', v_event_booking_id,
    'items', v_authoritative_items,
    'tickets', v_tickets_created,
    'server_received_at', now()
  );

  perform public._record_financial_operation(
    v_lodge_id, v_idempotency_key, 'create_pos_order_v3',
    v_order_id, v_request_hash, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.create_pos_order_v3(jsonb) from public;
grant execute on function public.create_pos_order_v3(jsonb)
  to anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. UPDATE publish_pos_catalog_snapshot TO INCLUDE kitchen_station_id
-- ────────────────────────────────────────────────────────────────────────────
-- The catalog snapshot is the server-side data contract for order pricing.
-- It must include kitchen_station_id so the server can route items to stations.

CREATE OR REPLACE FUNCTION public.publish_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_modifier_groups jsonb;
  v_promotions jsonb;
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
  v_next_version integer;
  v_snapshot_id uuid;
  v_payload jsonb;
  v_payload_hash text;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_lodge_id::text || ':catalog:' || coalesce(p_outlet_id::text, 'global'),
      0
    )
  );

  select coalesce(s.vat_enabled, false), coalesce(s.vat_rate, 0)
    into v_vat_enabled, v_vat_rate
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'category', m.category,
      'price', m.price,
      'is_available', coalesce(m.is_available, true),
      'inventory_item_id', m.inventory_item_id,
      'depletion_qty', public._positive_depletion_qty(m.depletion_qty, 1),
      'outlet_id', m.outlet_id,
      'barcode', m.barcode,
      'kitchen_station_id', m.kitchen_station_id
    )
    order by m.category, m.name
  ), '[]'::jsonb)
    into v_items
    from public.pos_menu_items m
   where m.lodge_id = p_lodge_id
     and (
       (p_outlet_id is null and m.outlet_id is null)
       or m.outlet_id = p_outlet_id
       or m.outlet_id is null
     );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'applies_to_categories', coalesce(g.applies_to_categories, '{}'::text[]),
      'options', coalesce(g.options, '[]'::jsonb),
      'active', g.active
    )
    order by g.name
  ), '[]'::jsonb)
    into v_modifier_groups
    from public.pos_modifier_groups g
   where g.lodge_id = p_lodge_id
     and g.active = true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'type', p.type,
      'value', p.value,
      'applies_to_categories', coalesce(p.applies_to_categories, '{}'::text[]),
      'applies_to_items', coalesce(p.applies_to_items, '{}'::uuid[]),
      'min_total', p.min_total,
      'min_quantity', p.min_quantity,
      'max_uses', p.max_uses,
      'used_count', p.used_count,
      'valid_from', p.valid_from,
      'valid_until', p.valid_until,
      'is_active', p.is_active
    )
    order by p.name
  ), '[]'::jsonb)
    into v_promotions
    from public.pos_promotions p
   where p.lodge_id = p_lodge_id
     and p.is_active = true;

  v_payload := jsonb_build_object(
    'items', v_items,
    'modifier_groups', v_modifier_groups,
    'promotions', v_promotions,
    'vat_enabled', v_vat_enabled,
    'vat_rate', v_vat_rate,
    'outlet_id', p_outlet_id,
    'published_at', now()
  );

  v_payload_hash := encode(sha512(convert_to(v_payload::text, 'utf8')), 'hex');

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.pos_catalog_snapshots
  where lodge_id = p_lodge_id;

  insert into public.pos_catalog_snapshots (
    id, lodge_id, outlet_id, version, items, modifier_groups,
    promotions, vat_enabled, vat_rate, payload_hash, created_at
  ) values (
    gen_random_uuid(), p_lodge_id, p_outlet_id, v_next_version,
    v_items, v_modifier_groups, v_promotions,
    v_vat_enabled, v_vat_rate, v_payload_hash, now()
  )
  returning id into v_snapshot_id;

  return jsonb_build_object(
    'success', true,
    'id', v_snapshot_id,
    'version', v_next_version,
    'item_count', jsonb_array_length(v_items),
    'hash', v_payload_hash
  );
end;
$$;

revoke all on function public.publish_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.publish_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

commit;
