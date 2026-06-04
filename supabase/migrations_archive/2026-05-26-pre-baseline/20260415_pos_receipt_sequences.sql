-- POS Receipt Sequences
-- Adds a server-side atomic receipt number to pos_orders, mirroring the
-- invoice_sequences pattern used for booking invoices.
-- Format: REC-{YEAR}-{NNNN} (e.g. REC-2026-0001)

alter table public.pos_orders
  add column if not exists receipt_number text;

-- ── Sequence table ────────────────────────────────────────────────────────────

create table if not exists public.pos_receipt_sequences (
  lodge_id    uuid    not null,
  year        integer not null,
  last_number integer not null default 0,
  primary key (lodge_id, year)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.pos_receipt_sequences enable row level security;

-- Only security-definer RPCs should touch this table; no direct access needed.
-- (All grants happen through the RPC that owns it.)

-- ── get_next_receipt_number ───────────────────────────────────────────────────

create or replace function public.get_next_receipt_number(p_lodge_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_year   integer := extract(year from now())::integer;
  v_next   integer;
begin
  insert into public.pos_receipt_sequences (lodge_id, year, last_number)
  values (p_lodge_id, v_year, 1)
  on conflict (lodge_id, year)
  do update set last_number = pos_receipt_sequences.last_number + 1
  returning last_number into v_next;

  return 'REC-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$func$;

revoke all on function public.get_next_receipt_number(uuid) from public;
-- Intentionally not granted to anon/authenticated directly —
-- called only from security-definer create_pos_order.

-- ── Updated create_pos_order (adds receipt_number) ────────────────────────────

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id                uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id               uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_create_idempotency_key  text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_receipt        text;
  v_receipt_number          text;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  -- ── Idempotency: check by idempotency key ────────────────────────────────
  if v_create_idempotency_key is not null then
    select id, total, receipt_number
      into v_existing_id, v_existing_total, v_existing_receipt
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     for update;

    if found then
      return jsonb_build_object(
        'success',         true,
        'id',              v_existing_id,
        'total',           coalesce(v_existing_total, 0),
        'receipt_number',  v_existing_receipt,
        'idempotent',      true,
        'replayed',        true
      );
    end if;
  end if;

  -- ── Idempotency: check by order id ──────────────────────────────────────
  select id, total, receipt_number
    into v_existing_id, v_existing_total, v_existing_receipt
    from public.pos_orders
   where lodge_id = v_lodge_id
     and id = v_order_id
   limit 1;

  if found then
    return jsonb_build_object(
      'success',         true,
      'id',              v_existing_id,
      'total',           coalesce(v_existing_total, 0),
      'receipt_number',  v_existing_receipt,
      'idempotent',      true,
      'replayed',        v_is_replay
    );
  end if;

  -- ── Assign receipt number ────────────────────────────────────────────────
  v_receipt_number := public.get_next_receipt_number(v_lodge_id);

  begin
    insert into public.pos_orders (
      id,
      lodge_id,
      room_id,
      booking_id,
      walk_in_name,
      total,
      notes,
      payment_method,
      outlet_id,
      status,
      created_at,
      create_idempotency_key,
      receipt_number
    ) values (
      v_order_id,
      v_lodge_id,
      nullif(payload->>'room_id', '')::uuid,
      nullif(payload->>'booking_id', '')::uuid,
      nullif(payload->>'walk_in_name', ''),
      0,
      nullif(payload->>'notes', ''),
      coalesce(nullif(payload->>'payment_method', ''), 'cash'),
      v_outlet_id,
      'completed',
      coalesce(v_created_at_client, now()),
      v_create_idempotency_key,
      v_receipt_number
    );
  exception
    when unique_violation then
      if v_create_idempotency_key is not null then
        select id, total, receipt_number
          into v_existing_id, v_existing_total, v_existing_receipt
          from public.pos_orders
         where lodge_id = v_lodge_id
           and create_idempotency_key = v_create_idempotency_key
         limit 1;

        if found then
          return jsonb_build_object(
            'success',         true,
            'id',              v_existing_id,
            'total',           coalesce(v_existing_total, 0),
            'receipt_number',  v_existing_receipt,
            'idempotent',      true,
            'replayed',        true
          );
        end if;
      end if;

      select id, total, receipt_number
        into v_existing_id, v_existing_total, v_existing_receipt
        from public.pos_orders
       where lodge_id = v_lodge_id
         and id = v_order_id
       limit 1;

      if found then
        return jsonb_build_object(
          'success',         true,
          'id',              v_existing_id,
          'total',           coalesce(v_existing_total, 0),
          'receipt_number',  v_existing_receipt,
          'idempotent',      true,
          'replayed',        v_is_replay
        );
      end if;

      raise;
  end;

  -- ── Process line items ───────────────────────────────────────────────────
  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := null;
        v_depletion_qty := 1;
      else
        raise exception
          'POS menu item % not found for lodge % — order rejected',
          v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := null;
      v_depletion_qty := 1;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item_name,
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);

    if v_inv_item_id is not null then
      update public.inventory_items
         set current_stock = greatest(0, coalesce(current_stock, 0)
                                        - (v_depletion_qty * v_quantity))
       where id = v_inv_item_id
         and lodge_id = v_lodge_id;
    end if;
  end loop;

  update public.pos_orders
     set total = v_computed_total
   where id = v_order_id;

  return jsonb_build_object(
    'success',        true,
    'id',             v_order_id,
    'total',          v_computed_total,
    'receipt_number', v_receipt_number
  );
end;
$function$;

revoke all on function public.create_pos_order(jsonb) from public;
grant execute on function public.create_pos_order(jsonb) to anon, authenticated;
