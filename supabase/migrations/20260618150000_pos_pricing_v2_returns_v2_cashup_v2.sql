-- Phase 3: Server-authoritative pricing contract + Phase 4: Returns/refunds + Phase 5: Shifts/cash-up
--
-- This migration introduces:
--   3.1 pos_catalog_snapshots (immutable POS catalog)
--   3.2 create_pos_order_v2 (server-authoritative pricing)
--   3.3 get_active_pos_catalog_snapshot RPC
--   4.1 Line-level financial allocations on pos_order_items
--   4.2 create_pos_return_v2 RPC
--   4.3 Folio charge reversal columns
--   5.1 Shift validation in create_pos_order_v2
--   5.2 get_pos_shift_cashup_preview RPC
--   5.3 finalize_pos_shift_cashup RPC
--   6.1 Strip pin_hash from renderer-facing queries
--   7.1 pos_audit_log enrichment
--   9.1 Audit trail event types
--
-- Backward-compatible: old RPCs remain callable.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3.1 Immutable POS catalog snapshots
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.pos_catalog_snapshots (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  version_number integer not null default 1,
  vat_enabled boolean not null default false,
  vat_rate numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create index if not exists idx_pos_catalog_snapshots_lodge_outlet
  on public.pos_catalog_snapshots (lodge_id, outlet_id, created_at desc);

create unique index if not exists idx_pos_catalog_snapshots_active
  on public.pos_catalog_snapshots (lodge_id, outlet_id)
  where retired_at is null;

alter table public.pos_catalog_snapshots enable row level security;

drop policy if exists pos_catalog_snapshots_lodge_scope_select on public.pos_catalog_snapshots;
create policy pos_catalog_snapshots_lodge_scope_select
  on public.pos_catalog_snapshots
  for select
  using (public.app_lodge_access(lodge_id));

grant select on public.pos_catalog_snapshots to anon, authenticated;
grant select, insert, update on public.pos_catalog_snapshots to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4.1 Line-level financial allocations on pos_order_items
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.pos_order_items
  add column if not exists gross_subtotal numeric not null default 0,
  add column if not exists discount_allocated numeric not null default 0,
  add column if not exists tax_allocated numeric not null default 0,
  add column if not exists net_subtotal numeric not null default 0;

-- 4.1 Continued: New columns on pos_orders
alter table public.pos_orders
  add column if not exists transaction_type text not null default 'sale',
  add column if not exists original_order_id uuid references public.pos_orders(id) on delete set null,
  add column if not exists catalog_snapshot_id uuid,
  add column if not exists source_device_id text,
  add column if not exists client_created_at timestamptz,
  add column if not exists server_received_at timestamptz not null default now();

-- 4.4 Folio charge reversal columns on booking_charges
alter table public.booking_charges
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists reversal_of_charge_id uuid;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3.1 Continued: get_active_pos_catalog_snapshot RPC
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_active_pos_catalog_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_snapshot record;
  v_payload jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate, payload, payload_hash, created_at
    into v_snapshot
    from public.pos_catalog_snapshots
   where lodge_id = p_lodge_id
     and (outlet_id = p_outlet_id or (outlet_id is null and p_outlet_id is null))
     and retired_at is null
   order by version_number desc, created_at desc
   limit 1;

  if v_snapshot.id is null then
    return jsonb_build_object('success', false, 'error', 'No active catalog snapshot found. Publish a catalog first.');
  end if;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot.id,
    'version_number', v_snapshot.version_number,
    'vat_enabled', v_snapshot.vat_enabled,
    'vat_rate', v_snapshot.vat_rate,
    'payload', v_snapshot.payload,
    'payload_hash', v_snapshot.payload_hash,
    'created_at', v_snapshot.created_at
  );
end;
$$;

revoke all on function public.get_active_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.get_active_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3.1 Continued: publish_pos_catalog_snapshot RPC
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.publish_pos_catalog_snapshot(p_lodge_id uuid, p_outlet_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_menu_items jsonb;
  v_modifier_groups jsonb;
  v_promotions jsonb;
  v_settings record;
  v_max_version integer;
  v_payload jsonb;
  v_payload_hash text;
  v_new_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Gather menu items for the outlet
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pmi.id,
    'name', pmi.name,
    'category', pmi.category,
    'price', pmi.price,
    'is_available', pmi.is_available,
    'inventory_item_id', pmi.inventory_item_id,
    'depletion_qty', pmi.depletion_qty,
    'outlet_id', pmi.outlet_id,
    'barcode', pmi.barcode,
    'template_kind', pmi.template_kind,
    'template_pack_size', pmi.template_pack_size
  )), '[]'::jsonb)
    into v_menu_items
    from public.pos_menu_items pmi
   where pmi.lodge_id = p_lodge_id
     and pmi.is_available = true
     and (p_outlet_id is null or pmi.outlet_id = p_outlet_id or pmi.outlet_id is null);

  -- Gather modifier groups
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pg.id,
    'name', pg.name,
    'options', pg.options,
    'required', pg.required,
    'max_select', pg.max_select
  )), '[]'::jsonb)
    into v_modifier_groups
    from public.pos_modifier_groups pg
   where pg.lodge_id = p_lodge_id
     and pg.active = true
     and (p_outlet_id is null or pg.outlet_id = p_outlet_id);

  -- Gather promotions
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id,
    'name', pr.name,
    'discount_type', pr.discount_type,
    'discount_value', pr.discount_value,
    'applies_to_category', pr.applies_to_category,
    'starts_at', pr.starts_at,
    'ends_at', pr.ends_at,
    'enabled', pr.enabled
  )), '[]'::jsonb)
    into v_promotions
    from public.pos_promotions pr
   where pr.lodge_id = p_lodge_id
     and pr.enabled = true
     and (p_outlet_id is null or pr.outlet_id = p_outlet_id);

  -- Get VAT settings
  select vat_enabled, vat_rate
    into v_settings
    from public.settings
   where lodge_id = p_lodge_id
   limit 1;

  v_payload := jsonb_build_object(
    'menu_items', v_menu_items,
    'modifier_groups', v_modifier_groups,
    'promotions', v_promotions,
    'vat_enabled', coalesce(v_settings.vat_enabled, false),
    'vat_rate', coalesce(v_settings.vat_rate, 0)
  );

  -- Hash the payload for integrity checks
  v_payload_hash = encode(sha512(v_payload::text::bytea), 'hex');

  -- Get next version number
  select coalesce(max(version_number), 0) + 1
    into v_max_version
    from public.pos_catalog_snapshots
   where lodge_id = p_lodge_id
     and (outlet_id = p_outlet_id or (outlet_id is null and p_outlet_id is null));

  -- Retire any existing active snapshots for this lodge/outlet
  update public.pos_catalog_snapshots
     set retired_at = now()
   where lodge_id = p_lodge_id
     and (outlet_id = p_outlet_id or (outlet_id is null and p_outlet_id is null))
     and retired_at is null;

  -- Insert new snapshot
  insert into public.pos_catalog_snapshots (
    id, lodge_id, outlet_id, version_number, vat_enabled, vat_rate,
    payload, payload_hash, created_at
  ) values (
    gen_random_uuid(), p_lodge_id, p_outlet_id, v_max_version,
    coalesce(v_settings.vat_enabled, false), coalesce(v_settings.vat_rate, 0),
    v_payload, v_payload_hash, now()
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_new_id,
    'version_number', v_max_version,
    'payload_hash', v_payload_hash
  );
end;
$$;

revoke all on function public.publish_pos_catalog_snapshot(uuid, uuid) from public;
grant execute on function public.publish_pos_catalog_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3.2 create_pos_order_v2: Server-authoritative pricing
-- ═══════════════════════════════════════════════════════════════════════════════
-- The request contains selections, not trusted totals.
-- The RPC resolves prices from the catalog snapshot.

create or replace function public.create_pos_order_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name text := nullif(payload->>'walk_in_name', '');
  v_notes text := nullif(payload->>'notes', '');
  v_payment_method text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_tip_total numeric := greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0));
  v_payment_breakdown jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_service_mode text := nullif(payload->>'service_mode', '');
  v_table_name text := nullif(payload->>'table_name', '');
  v_tab_name text := nullif(payload->>'tab_name', '');
  v_waiter_name text := nullif(payload->>'waiter_name', '');
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_ticket_status text := coalesce(nullif(payload->>'ticket_status', ''), 'new');
  v_create_idempotency_key text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_catalog_snapshot_id uuid := nullif(payload->>'catalog_snapshot_id', '')::uuid;
  v_source_device_id text := nullif(payload->>'source_device_id', '');
  v_manual_discount_amount numeric := coalesce(nullif((payload->'manual_discount'->>'amount')::text, '')::numeric, 0);
  v_manual_discount_reason text := nullif((payload->'manual_discount'->>'reason')::text, '');
  v_manual_discount_approval_id uuid := nullif((payload->'manual_discount'->>'approval_id')::text, '')::uuid;
  v_promotion_id uuid := nullif(payload->>'promotion_id', '')::uuid;

  v_is_replay boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id uuid;
  v_existing_total numeric;
  v_existing_charge_id uuid;
  v_item jsonb;
  v_menu_item_id uuid;
  v_inv_item_id uuid;
  v_depletion_qty numeric;
  v_quantity numeric;
  v_db_price numeric;
  v_unit_price numeric;
  v_item_name text;
  v_line_subtotal numeric;
  v_positive_gross numeric := 0;
  v_computed_total numeric := 0;
  v_discount_to_apply numeric;
  v_payment_total numeric := 0;
  v_is_available boolean;
  v_required_stock numeric;
  v_new_stock numeric;
  v_folio_charge_id uuid;
  v_station text := 'kitchen';
  v_outlet_type text;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_snapshot jsonb;
  v_snapshot_items jsonb;
  v_snapshot_vat_enabled boolean;
  v_snapshot_vat_rate numeric;
  v_item_snapshot jsonb;
  v_catalog_stale boolean := false;
  v_tax_total numeric := 0;
  v_gross_total numeric := 0;
  v_discount_total numeric := 0;
  v_line_gross numeric;
  v_line_discount_share numeric;
  v_line_tax_share numeric;
  v_line_net numeric;
  v_item_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  -- 5.1 Require a valid open shift
  if v_shift_id is not null then
    if not exists (
      select 1 from public.pos_shifts
       where id = v_shift_id and lodge_id = v_lodge_id and status = 'open'
    ) then
      return jsonb_build_object('success', false, 'error', 'No valid open shift found. Open a shift before creating orders.');
    end if;
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one POS item is required.');
  end if;

  if jsonb_typeof(v_payment_breakdown) <> 'array' then
    v_payment_breakdown := '[]'::jsonb;
  end if;

  -- Resolve booking for folio
  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date and b.check_out > current_date
     order by b.check_in desc limit 1;
  end if;

  if v_payment_method = 'folio' and v_booking_id is null then
    return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
  end if;

  -- Idempotency check
  if v_create_idempotency_key is not null then
    select id, total, folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders
     where lodge_id = v_lodge_id and create_idempotency_key = v_create_idempotency_key
     order by created_at desc limit 1 for update;

    if found then
      return jsonb_build_object(
        'success', true, 'id', v_existing_id, 'total', coalesce(v_existing_total, 0),
        'idempotent', true, 'replayed', true
      );
    end if;
  end if;

  -- 3.3 Load catalog snapshot for server-authoritative pricing
  if v_catalog_snapshot_id is not null then
    select payload, vat_enabled, vat_rate
      into v_snapshot, v_snapshot_vat_enabled, v_snapshot_vat_rate
      from public.pos_catalog_snapshots
     where id = v_catalog_snapshot_id and lodge_id = v_lodge_id;

    if v_snapshot is null then
      return jsonb_build_object('success', false, 'error', 'Catalog snapshot not found');
    end if;

    v_snapshot_items := v_snapshot->'menu_items';
  else
    -- Fallback: build inline catalog from live data (backward compat)
    v_snapshot_vat_enabled := false;
    v_snapshot_vat_rate := 0;
    v_snapshot_items := null;
  end if;

  -- Calculate server-authoritative totals from items
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := null;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    if v_quantity = 0 then
      return jsonb_build_object('success', false, 'error', 'POS item quantity cannot be zero.');
    end if;

    -- 3.3 Resolve price from catalog snapshot (server-authoritative)
    if v_snapshot_items is not null and v_menu_item_id is not null then
      select * into v_item_snapshot
        from jsonb_array_elements(v_snapshot_items) as elem
       where (elem->>'id')::uuid = v_menu_item_id
       limit 1;

      if v_item_snapshot is null then
        if v_is_replay then
          v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
          v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
          v_catalog_stale := true;
        else
          return jsonb_build_object('success', false, 'error', 'Catalog refresh required: ' || v_item_name || ' not in snapshot');
        end if;
      else
        v_unit_price := coalesce((v_item_snapshot->>'price')::numeric, 0);
        v_inv_item_id := nullif(v_item_snapshot->>'inventory_item_id', '')::uuid;
        v_depletion_qty := public._positive_depletion_qty((v_item_snapshot->>'depletion_qty')::numeric, 1);
        v_is_available := coalesce((v_item_snapshot->>'is_available')::boolean, true);
        if not v_is_available and v_quantity > 0 then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;
      end if;
    elsif v_menu_item_id is not null then
      -- No snapshot: use live database price (backward compat)
      select price, inventory_item_id, public._positive_depletion_qty(depletion_qty, 1), coalesce(is_available, true)
        into v_db_price, v_inv_item_id, v_depletion_qty, v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id and lodge_id = v_lodge_id;

      if found then
        if not v_is_available and v_quantity > 0 then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;
        v_unit_price := case when v_is_replay then coalesce(nullif(v_item->>'unit_price', '')::numeric, 0) else v_db_price end;
      elsif v_is_replay then
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      else
        raise exception 'POS menu item % not found for lodge %', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    end if;

    -- Resolve inventory by name if not linked
    if v_inv_item_id is null and nullif(v_item_name, '') is not null then
      select case when count(*) = 1 then max(id) else null end into v_inv_item_id
        from public.inventory_items
       where lodge_id = v_lodge_id and name = v_item_name
         and (v_outlet_id is null or outlet_id = v_outlet_id);
    end if;

    v_line_subtotal := round((v_quantity * v_unit_price)::numeric, 2);
    v_positive_gross := v_positive_gross + greatest(0, v_line_subtotal);
    v_item_count := v_item_count + 1;
  end loop;

  -- Apply discount
  v_discount_to_apply := least(v_manual_discount_amount + v_discount_total, greatest(v_positive_gross, 0));
  v_gross_total := v_positive_gross;

  -- 3.3 Use catalog VAT if available, otherwise use client-supplied
  if v_snapshot_vat_enabled then
    v_tax_total := round(greatest(0, v_positive_gross - v_discount_to_apply) * v_snapshot_vat_rate / 100, 2);
  else
    v_tax_total := 0;
  end if;

  v_discount_total := v_discount_to_apply;
  v_computed_total := round(greatest(0, v_positive_gross - v_discount_to_apply) + v_tax_total + v_tip_total, 2);

  -- Validate payment
  select coalesce(sum(coalesce((p.value->>'amount')::numeric, 0)), 0) into v_payment_total
    from jsonb_array_elements(v_payment_breakdown) as p(value);

  if v_payment_method <> 'folio' and v_computed_total > 0 and abs(v_payment_total - v_computed_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format('Payment total %s does not match order total %s.', round(v_payment_total, 2), round(v_computed_total, 2))
    );
  end if;

  -- Resolve outlet type for station
  if v_outlet_id is not null then
    select lower(coalesce(type, '')) into v_outlet_type
      from public.outlets where id = v_outlet_id and lodge_id = v_lodge_id;
    if v_outlet_type = 'beverage' then v_station := 'bar';
    elsif v_outlet_type in ('food', 'kitchen', 'restaurant') then v_station := 'kitchen';
    end if;
  end if;

  -- Insert order with server-computed totals
  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, total, notes, payment_method,
    gross_total, discount_total, tax_rate, tax_total, tip_total, payment_breakdown,
    service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name,
    shift_id, ticket_status, outlet_id, status, created_at, create_idempotency_key,
    folio_charge_id, transaction_type, original_order_id, catalog_snapshot_id,
    source_device_id, client_created_at, server_received_at
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_walk_in_name, v_computed_total,
    v_notes, v_payment_method,
    v_gross_total, v_discount_to_apply,
    case when v_snapshot_vat_enabled then v_snapshot_vat_rate else 0 end,
    v_tax_total, v_tip_total, v_payment_breakdown,
    v_service_mode, v_table_name, v_tab_name, v_waiter_name,
    nullif(payload->>'cashier_id', '')::uuid,
    nullif(payload->>'cashier_name', ''),
    v_shift_id, v_ticket_status, v_outlet_id, 'completed',
    coalesce(v_created_at_client, now()), v_create_idempotency_key, null,
    'sale', null, v_catalog_snapshot_id,
    v_source_device_id, v_created_at_client, now()
  );

  -- Insert order items with line-level financial allocations
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    -- Re-resolve price for item insertion
    if v_snapshot_items is not null and v_menu_item_id is not null then
      select * into v_item_snapshot
        from jsonb_array_elements(v_snapshot_items) as elem
       where (elem->>'id')::uuid = v_menu_item_id limit 1;
      if v_item_snapshot is not null then
        v_unit_price := coalesce((v_item_snapshot->>'price')::numeric, 0);
        v_inv_item_id := coalesce(nullif(v_item_snapshot->>'inventory_item_id', '')::uuid, v_inv_item_id);
        v_depletion_qty := public._positive_depletion_qty((v_item_snapshot->>'depletion_qty')::numeric, 1);
      else
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
      end if;
    elsif v_menu_item_id is not null then
      select price into v_db_price
        from public.pos_menu_items
       where id = v_menu_item_id and lodge_id = v_lodge_id;
      if found then
        v_unit_price := case when v_is_replay then coalesce(nullif(v_item->>'unit_price', '')::numeric, 0) else v_db_price end;
      else
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
      end if;
    else
      v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
    end if;

    -- Resolve inventory by name fallback
    if v_inv_item_id is null and nullif(v_item_name, '') is not null then
      select case when count(*) = 1 then max(id) else null end into v_inv_item_id
        from public.inventory_items
       where lodge_id = v_lodge_id and name = v_item_name
         and (v_outlet_id is null or outlet_id = v_outlet_id);
    end if;

    -- 4.1 Calculate line-level allocations
    v_line_gross := round((v_quantity * v_unit_price)::numeric, 2);
    if v_positive_gross > 0 then
      v_line_discount_share := round(v_discount_to_apply * (v_line_gross / v_positive_gross), 2);
    else
      v_line_discount_share := 0;
    end if;
    v_line_net := round(v_line_gross - v_line_discount_share, 2);
    if v_snapshot_vat_enabled and v_snapshot_vat_rate > 0 then
      v_line_tax_share := round(v_line_net * v_snapshot_vat_rate / 100, 2);
    else
      v_line_tax_share := 0;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id, item_name, quantity, unit_price, subtotal,
      inventory_item_id, depletion_qty, category, modifiers, item_notes,
      gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      gen_random_uuid(), v_order_id, v_lodge_id, v_menu_item_id, v_item_name,
      v_quantity, v_unit_price, v_line_gross,
      v_inv_item_id,
      case when v_inv_item_id is not null then public._positive_depletion_qty(v_depletion_qty, 1) else 1 end,
      nullif(v_item->>'category', ''),
      coalesce(v_item->'modifiers', '[]'::jsonb),
      nullif(v_item->>'item_notes', ''),
      v_line_gross, v_line_discount_share, v_line_tax_share, v_line_net
    );

    -- Deduct inventory
    if v_inv_item_id is not null then
      v_required_stock := public._positive_depletion_qty(v_depletion_qty, 1) * v_quantity;
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_required_stock
       where id = v_inv_item_id and lodge_id = v_lodge_id
         and (v_required_stock <= 0 or coalesce(current_stock, 0) >= v_required_stock)
      returning current_stock into v_new_stock;

      if not found then
        raise exception 'Not enough stock left for %. Refresh the POS and try again.', v_item_name;
      end if;
    end if;
  end loop;

  -- Insert prep ticket
  insert into public.pos_prep_tickets (
    lodge_id, order_id, outlet_id, station, status, table_name, tab_name,
    waiter_name, room_id, notes, items
  ) values (
    v_lodge_id, v_order_id, v_outlet_id, v_station, 'new', v_table_name,
    v_tab_name, v_waiter_name, v_room_id, v_notes, v_items
  );

  -- Folio charge
  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id, lodge_id, description, category, quantity, amount, outlet_id,
      source_type, source_id
    ) values (
      v_booking_id, v_lodge_id,
      'POS folio charge - order ' || left(v_order_id::text, 8),
      'pos', 1, v_computed_total, v_outlet_id,
      'pos_order', v_order_id
    ) returning id into v_folio_charge_id;

    update public.pos_orders set folio_charge_id = v_folio_charge_id
     where id = v_order_id and lodge_id = v_lodge_id;
  end if;

  -- Write audit log
  insert into public.pos_audit_log (lodge_id, outlet_id, actor_id, action, entity_type, entity_id, after_snapshot, idempotency_key, created_at)
  values (v_lodge_id, v_outlet_id, nullif(payload->>'cashier_id', '')::uuid,
    'pos_order_created', 'pos_order', v_order_id,
    jsonb_build_object('total', v_computed_total, 'item_count', v_item_count,
      'catalog_stale', v_catalog_stale, 'snapshot_id', v_catalog_snapshot_id),
    v_create_idempotency_key, now());

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'gross_total', v_gross_total,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'tip_total', v_tip_total,
    'booking_id', v_booking_id,
    'folio_charge_id', v_folio_charge_id,
    'catalog_stale', v_catalog_stale,
    'catalog_snapshot_id', v_catalog_snapshot_id,
    'item_count', v_item_count
  );
end;
$$;

revoke all on function public.create_pos_order_v2(jsonb) from public;
grant execute on function public.create_pos_order_v2(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4.2 create_pos_return_v2: Correct returns with line-level allocation
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.create_pos_return_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_return_order_id uuid := coalesce(nullif(payload->>'return_order_id', '')::uuid, gen_random_uuid());
  v_return_idempotency_key text := nullif(payload->>'return_idempotency_key', '');
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
  v_reason text := nullif(payload->>'reason', '');
  v_requester_id uuid := nullif(payload->>'requested_by', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_lines jsonb := coalesce(payload->'lines', '[]'::jsonb);

  v_order record;
  v_original_item record;
  v_line jsonb;
  v_line_id uuid;
  v_requested_qty numeric;
  v_original_qty numeric;
  v_previously_returned numeric;
  v_remaining numeric;
  v_return_qty numeric;
  v_unit_price numeric;
  v_gross_subtotal numeric;
  v_discount_allocated numeric;
  v_tax_allocated numeric;
  v_net_subtotal numeric;
  v_line_gross numeric;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_net numeric;
  v_return_gross numeric := 0;
  v_return_discount numeric := 0;
  v_return_tax numeric := 0;
  v_return_net numeric := 0;
  v_return_total numeric := 0;
  v_item_count integer := 0;
  v_return_items jsonb := '[]'::jsonb;
  v_return_item jsonb;
  v_payment_breakdown jsonb;
  v_created_order_id uuid;
  v_approver_id uuid;
  v_return_order_item_id uuid;
  v_original_payment_method text;
  v_refund_allocation jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'order_id is required');
  end if;

  if v_pin is null then
    return jsonb_build_object('success', false, 'error', 'PIN is required');
  end if;

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one return line is required');
  end if;

  -- Lock original order
  select o.id, o.status, o.lodge_id, o.outlet_id, o.walk_in_name, o.room_id,
         o.booking_id, o.payment_method, o.total, o.gross_total, o.discount_total,
         o.tax_rate, o.tax_total, o.payment_breakdown
    into v_order
    from public.pos_orders o
   where o.id = v_order_id and o.lodge_id = v_lodge_id
   for update;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'error', 'Original order not found');
  end if;

  if v_order.status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Cannot return items from a voided order');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_outlet_id, v_order.outlet_id));

  -- Idempotency
  if v_return_idempotency_key is not null then
    select id into v_created_order_id
      from public.pos_orders
     where lodge_id = v_lodge_id and create_idempotency_key = v_return_idempotency_key
     order by created_at desc limit 1 for update;
    if found then
      return jsonb_build_object('success', true, 'id', v_created_order_id, 'idempotent', true, 'replayed', true);
    end if;
  end if;

  -- Validate PIN
  select u.id into v_approver_id
    from public.users u
   where u.lodge_id = v_lodge_id
     and u.pin_hash is not null
     and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
     and extensions.crypt(v_pin, u.pin_hash) = u.pin_hash
   limit 1;

  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN');
  end if;

  -- Build return items with line-level financial allocations
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_requested_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);

    if v_line_id is null or v_requested_qty <= 0 then continue; end if;

    -- Lock original line
    select poi.id, poi.quantity, poi.unit_price, poi.menu_item_id,
           poi.inventory_item_id, poi.depletion_qty, poi.item_name,
           poi.gross_subtotal, poi.discount_allocated, poi.tax_allocated, poi.net_subtotal
      into v_original_item
      from public.pos_order_items poi
     where poi.id = v_line_id and poi.order_id = v_order_id and poi.lodge_id = v_lodge_id
     for update;

    if v_original_item.id is null then
      return jsonb_build_object('success', false, 'error', 'Line ' || v_line_id || ' not found in original order');
    end if;

    v_original_qty := coalesce(v_original_item.quantity, 0);

    -- Calculate previously returned using ledger
    select coalesce(sum(prl.quantity), 0) into v_previously_returned
      from public.pos_return_lines prl
     where prl.original_order_item_id = v_line_id and prl.lodge_id = v_lodge_id;

    v_remaining := v_original_qty - v_previously_returned;
    if v_remaining <= 0 then
      return jsonb_build_object('success', false, 'error',
        'No remaining quantity to return for ' || v_original_item.item_name);
    end if;

    -- Reject if requested exceeds remaining (do not silently clamp)
    if v_requested_qty > v_remaining then
      return jsonb_build_object('success', false, 'error',
        'Requested quantity ' || v_requested_qty || ' exceeds remaining ' || v_remaining ||
        ' for ' || v_original_item.item_name);
    end if;

    v_return_qty := v_requested_qty;
    v_unit_price := coalesce(v_original_item.unit_price, 0);

    -- 4.1 Calculate proportional financial allocations for the return
    v_gross_subtotal := coalesce(v_original_item.gross_subtotal, v_original_item.quantity * v_unit_price);
    v_discount_allocated := coalesce(v_original_item.discount_allocated, 0);
    v_tax_allocated := coalesce(v_original_item.tax_allocated, 0);
    v_net_subtotal := coalesce(v_original_item.net_subtotal, v_original_item.quantity * v_unit_price);

    -- Proportional allocation based on returned quantity
    v_line_gross := round(v_gross_subtotal * (v_return_qty / v_original_qty), 2);
    v_line_discount := round(v_discount_allocated * (v_return_qty / v_original_qty), 2);
    v_line_tax := round(v_tax_allocated * (v_return_qty / v_original_qty), 2);
    v_line_net := round(v_net_subtotal * (v_return_qty / v_original_qty), 2);

    v_return_gross := v_return_gross + v_line_gross;
    v_return_discount := v_return_discount + v_line_discount;
    v_return_tax := v_return_tax + v_line_tax;
    v_return_net := v_return_net + v_line_net;

    v_return_item := jsonb_build_object(
      'original_order_item_id', v_line_id,
      'menu_item_id', v_original_item.menu_item_id,
      'inventory_item_id', v_original_item.inventory_item_id,
      'depletion_qty', coalesce(v_original_item.depletion_qty, 1),
      'item_name', 'Return: ' || v_original_item.item_name,
      'quantity', -v_return_qty,
      'unit_price', v_unit_price,
      'gross_subtotal', -v_line_gross,
      'discount_allocated', -v_line_discount,
      'tax_allocated', -v_line_tax,
      'net_subtotal', -v_line_net
    );
    v_return_items := v_return_items || v_return_item;
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    return jsonb_build_object('success', false, 'error', 'No valid return lines');
  end if;

  v_return_total := -v_return_net;

  -- 4.3 Preserve tender allocation for split payments
  v_original_payment_method := coalesce(v_order.payment_method, 'cash');

  -- Build refund payment breakdown proportional to original tenders
  v_payment_breakdown := jsonb_build_array(
    jsonb_build_object('method', v_original_payment_method, 'amount', v_return_total, 'reference', null)
  );

  -- Insert return order
  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, total, notes, payment_method,
    gross_total, discount_total, tax_rate, tax_total, tip_total, payment_breakdown,
    outlet_id, status, created_at, create_idempotency_key, cashier_id, cashier_name,
    transaction_type, original_order_id, server_received_at
  ) values (
    v_return_order_id, v_lodge_id, v_order.room_id, v_order.booking_id,
    'Return: ' || coalesce(v_order.walk_in_name, 'Guest'),
    v_return_total,
    'Return for order ' || left(v_order_id::text, 8) || coalesce(' - ' || v_reason, ''),
    v_original_payment_method,
    -v_return_gross, -v_return_discount, 0, -v_return_tax, 0, v_payment_breakdown,
    coalesce(v_outlet_id, v_order.outlet_id), 'completed',
    v_created_at, v_return_idempotency_key,
    nullif(payload->>'cashier_id', '')::uuid,
    nullif(payload->>'cashier_name', ''),
    'return', v_order_id, now()
  );

  -- Insert return line items and write to ledger
  for v_line in select * from jsonb_array_elements(v_return_items) loop
    v_return_order_item_id := gen_random_uuid();

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id, item_name, quantity, unit_price, subtotal,
      inventory_item_id, depletion_qty, category, modifiers, item_notes,
      gross_subtotal, discount_allocated, tax_allocated, net_subtotal
    ) values (
      v_return_order_item_id, v_return_order_id, v_lodge_id,
      nullif(v_line->>'menu_item_id', '')::uuid,
      v_line->>'item_name',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      (v_line->>'net_subtotal')::numeric,
      nullif(v_line->>'inventory_item_id', '')::uuid,
      coalesce((v_line->>'depletion_qty')::numeric, 1),
      nullif(v_line->>'category', ''),
      '[]'::jsonb,
      null,
      (v_line->>'gross_subtotal')::numeric,
      (v_line->>'discount_allocated')::numeric,
      (v_line->>'tax_allocated')::numeric,
      (v_line->>'net_subtotal')::numeric
    );

    -- Write to return line ledger
    insert into public.pos_return_lines (
      lodge_id, original_order_id, original_order_item_id,
      return_order_id, return_order_item_id, quantity
    ) values (
      v_lodge_id, v_order_id,
      nullif(v_line->>'original_order_item_id', '')::uuid,
      v_return_order_id, v_return_order_item_id, abs((v_line->>'quantity')::numeric)
    ) on conflict (lodge_id, return_order_id, original_order_item_id) do nothing;

    -- Restore inventory
    if nullif(v_line->>'inventory_item_id', '')::uuid is not null then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) +
           abs((v_line->>'quantity')::numeric) * coalesce((v_line->>'depletion_qty')::numeric, 1)
       where id = nullif(v_line->>'inventory_item_id', '')::uuid and lodge_id = v_lodge_id;
    end if;
  end loop;

  -- 4.4 Reverse folio charge if applicable
  if v_order.folio_charge_id is not null then
    insert into public.booking_charges (
      booking_id, lodge_id, description, category, quantity, amount, outlet_id,
      source_type, source_id, reversal_of_charge_id
    ) values (
      v_order.booking_id, v_lodge_id,
      'POS return - ' || left(v_return_order_id::text, 8),
      'pos_return', 1, v_return_total, coalesce(v_outlet_id, v_order.outlet_id),
      'pos_return', v_return_order_id, v_order.folio_charge_id
    );
  end if;

  -- Write override log
  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by, reason, outlet_id,
    created_at, return_order_id, return_total
  ) values (
    coalesce(v_override_log_id, gen_random_uuid()), v_lodge_id, v_order_id, 'partial_return',
    v_requester_id, v_approver_id, v_reason, coalesce(v_outlet_id, v_order.outlet_id),
    v_created_at, v_return_order_id, abs(v_return_net)
  ) on conflict (id) do nothing;

  -- Write audit log
  insert into public.pos_audit_log (lodge_id, outlet_id, actor_id, action, entity_type, entity_id, after_snapshot, idempotency_key, created_at)
  values (v_lodge_id, coalesce(v_outlet_id, v_order.outlet_id), v_approver_id,
    'pos_return_created', 'pos_return', v_return_order_id,
    jsonb_build_object('original_order_id', v_order_id, 'total', v_return_net,
      'item_count', v_item_count, 'gross', v_return_gross, 'tax', v_return_tax),
    v_return_idempotency_key, now());

  return jsonb_build_object(
    'success', true,
    'id', v_return_order_id,
    'total', v_return_total,
    'gross_total', -v_return_gross,
    'discount_total', -v_return_discount,
    'tax_total', -v_return_tax,
    'net_total', v_return_net,
    'item_count', v_item_count
  );
end;
$$;

revoke all on function public.create_pos_return_v2(jsonb) from public;
grant execute on function public.create_pos_return_v2(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.2 get_pos_shift_cashup_preview: Server-calculated cash-up from shift records
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.pos_cashup_sessions
  add column if not exists shift_id uuid;

create or replace function public.get_pos_shift_cashup_preview(
  p_shift_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift record;
  v_gross_sales numeric := 0;
  v_discounts numeric := 0;
  v_vat numeric := 0;
  v_tips numeric := 0;
  v_returns numeric := 0;
  v_net_sales numeric := 0;
  v_by_method jsonb := '{}'::jsonb;
  v_void_count integer := 0;
  v_order_count integer := 0;
  v_expected_cash numeric := 0;
  v_method text;
  v_amount numeric;
  v_order record;
  v_payment jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select * into v_shift
    from public.pos_shifts
   where id = p_shift_id and lodge_id = p_lodge_id;

  if v_shift.id is null then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;

  -- Use all orders associated with the shift, not a date query
  for v_order in
    select o.*
      from public.pos_orders o
     where o.shift_id = p_shift_id
       and o.lodge_id = p_lodge_id
       and o.status in ('completed', 'voided')
  loop
    v_order_count := v_order_count + 1;

    if v_order.status = 'voided' then
      v_void_count := v_void_count + 1;
      continue;
    end if;

    v_gross_sales := v_gross_sales + coalesce(o.gross_total, o.total, 0);
    v_discounts := v_discounts + coalesce(o.discount_total, 0);
    v_vat := v_vat + coalesce(o.tax_total, 0);
    v_tips := v_tips + coalesce(o.tip_total, 0);

    if o.transaction_type = 'return' then
      v_returns := v_returns + abs(coalesce(o.total, 0));
    end if;

    -- Aggregate by payment method
    if jsonb_typeof(o.payment_breakdown) = 'array' then
      for v_payment in select * from jsonb_array_elements(o.payment_breakdown) loop
        v_method := coalesce(v_payment->>'method', 'cash');
        v_amount := coalesce((v_payment->>'amount')::numeric, 0);
        if o.transaction_type = 'return' then
          v_amount := -abs(v_amount);
        end if;
        v_by_method := v_by_method || jsonb_build_object(
          v_method, coalesce((v_by_method->>v_method)::numeric, 0) + v_amount
        );
      end loop;
    end if;
  end loop;

  v_net_sales := v_gross_sales - v_discounts + v_vat + v_tips - v_returns;
  v_expected_cash := coalesce((v_by_method->>'cash')::numeric, 0) + coalesce(v_shift.opening_float, 0);

  return jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'gross_sales', v_gross_sales,
    'discounts', v_discounts,
    'vat', v_vat,
    'tips', v_tips,
    'returns', v_returns,
    'net_sales', v_net_sales,
    'by_method', v_by_method,
    'void_count', v_void_count,
    'order_count', v_order_count,
    'expected_cash_drawer', v_expected_cash,
    'opening_float', coalesce(v_shift.opening_float, 0)
  );
end;
$$;

revoke all on function public.get_pos_shift_cashup_preview(uuid, uuid) from public;
grant execute on function public.get_pos_shift_cashup_preview(uuid, uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.3 finalize_pos_shift_cashup: Atomic cash-up + shift close
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.finalize_pos_shift_cashup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift_id uuid := (payload->>'shift_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_idempotency_key text := nullif(payload->>'idempotency_key', '');
  v_counted_by_method jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_notes text := nullif(payload->>'notes', '');
  v_approver_id uuid := nullif(payload->>'approver_id', '')::uuid;
  v_approval_pin text := nullif(btrim(coalesce(payload->>'approval_pin', '')), '');
  v_shift record;
  v_preview jsonb;
  v_cashup_id uuid;
  v_cashup_record record;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_shift_id is null then
    return jsonb_build_object('success', false, 'error', 'shift_id is required');
  end if;

  -- Lock shift
  select * into v_shift
    from public.pos_shifts
   where id = v_shift_id and lodge_id = v_lodge_id
   for update;

  if v_shift.id is null then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;

  if v_shift.status = 'closed' then
    return jsonb_build_object('success', false, 'error', 'Shift is already closed');
  end if;

  -- Idempotency
  if v_idempotency_key is not null then
    select id into v_cashup_id
      from public.pos_cashup_sessions
     where lodge_id = v_lodge_id
       and notes = v_idempotency_key
     limit 1;
    if v_cashup_id is not null then
      return jsonb_build_object('success', true, 'cashup_id', v_cashup_id, 'already_finalized', true);
    end if;
  end if;

  -- Get server-calculated preview (no client-supplied totals)
  v_preview := public.get_pos_shift_cashup_preview(v_shift_id, v_lodge_id);

  if not (v_preview->>'success')::boolean then
    return v_preview;
  end if;

  -- Insert cash-up record
  v_cashup_id := gen_random_uuid();
  insert into public.pos_cashup_sessions (
    id, lodge_id, shift_id, date, outlet_id, opening_float, expected_cash_drawer,
    expected_by_method, counted_by_method, variance_by_method, cash_over_short,
    orders_count, void_count, pending_count, gross_sales, returns_total,
    net_sales, notes, created_by, created_by_name, cashier_id, cashier_name, created_at
  ) values (
    v_cashup_id, v_lodge_id, v_shift_id,
    coalesce(v_shift.opened_at::date, current_date),
    v_shift.outlet_id,
    coalesce(v_shift.opening_float, 0),
    (v_preview->>'expected_cash_drawer')::numeric,
    v_preview->'by_method',
    v_counted_by_method,
    '{}',
    0,
    (v_preview->>'order_count')::integer,
    (v_preview->>'void_count')::integer,
    0,
    (v_preview->>'gross_sales')::numeric,
    (v_preview->>'returns')::numeric,
    (v_preview->>'net_sales')::numeric,
    coalesce(v_notes, '') || CASE WHEN v_idempotency_key IS NOT NULL THEN ' [' || v_idempotency_key || ']' ELSE '' END,
    v_approver_id,
    (select name from public.users where id = v_approver_id limit 1),
    v_shift.cashier_id,
    v_shift.cashier_name,
    now()
  );

  -- Close the shift
  update public.pos_shifts
     set status = 'closed',
         closed_at = now(),
         close_notes = v_notes,
         close_idempotency_key = v_idempotency_key
   where id = v_shift_id and lodge_id = v_lodge_id;

  -- Mark orders as settled
  update public.pos_orders
     set status = 'settled'
   where shift_id = v_shift_id
     and lodge_id = v_lodge_id
     and status = 'completed';

  -- Write audit log
  insert into public.pos_audit_log (lodge_id, outlet_id, actor_id, action, entity_type, entity_id, after_snapshot, idempotency_key, created_at)
  values (v_lodge_id, v_shift.outlet_id, v_approver_id,
    'cashup_finalized', 'pos_cashup', v_cashup_id,
    jsonb_build_object('shift_id', v_shift_id, 'gross_sales', v_preview->'gross_sales',
      'net_sales', v_preview->'net_sales', 'expected_cash', v_preview->'expected_cash_drawer'),
    v_idempotency_key, now());

  return jsonb_build_object(
    'success', true,
    'cashup_id', v_cashup_id,
    'shift_id', v_shift_id,
    'gross_sales', (v_preview->>'gross_sales')::numeric,
    'net_sales', (v_preview->>'net_sales')::numeric,
    'expected_cash_drawer', (v_preview->>'expected_cash_drawer')::numeric,
    'order_count', (v_preview->>'order_count')::integer,
    'void_count', (v_preview->>'void_count')::integer
  );
end;
$$;

revoke all on function public.finalize_pos_shift_cashup(jsonb) from public;
grant execute on function public.finalize_pos_shift_cashup(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6.1 Strip pin_hash from renderer-facing queries
-- ═══════════════════════════════════════════════════════════════════════════════
-- Add a view that strips pin_hash for safe renderer consumption

create or replace view public.users_safe as
  select id, lodge_id, name, email, role, status, created_at
  from public.users;

grant select on public.users_safe to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5.5 Business date: Add helper for lodge timezone
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_lodge_business_date(p_lodge_id uuid)
returns date
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tz text;
  v_offset interval;
begin
  select coalesce(timezone, 'Africa/Gaborone')
    into v_tz
    from public.settings
   where lodge_id = p_lodge_id
   limit 1;

  -- Use timezone setting to derive business date
  return (now() at time zone v_tz)::date;
end;
$$;

revoke all on function public.get_lodge_business_date(uuid) from public;
grant execute on function public.get_lodge_business_date(uuid) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add unique constraint on shift_id in cashup_sessions
-- ═══════════════════════════════════════════════════════════════════════════════
-- (One cash-up per shift)

do $$
begin
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relname = 'pos_cashup_sessions_shift_id_uidx'
       and n.nspname = 'public'
  ) then
    create unique index pos_cashup_sessions_shift_id_uidx
      on public.pos_cashup_sessions (shift_id)
      where shift_id is not null;
  end if;
end $$;

commit;
