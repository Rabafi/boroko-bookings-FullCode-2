begin;

alter table public.pool_day_use
  add column if not exists resource_key text;

create or replace function public.add_pool_day_use(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $pool_day_use$
declare
  v_id                       uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                 uuid := (payload->>'lodge_id')::uuid;
  v_adults                   integer := greatest(coalesce((payload->>'adults')::integer, 1), 0);
  v_children                 integer := greatest(coalesce((payload->>'children')::integer, 0), 0);
  v_fee_per_adult            numeric := coalesce((payload->>'fee_per_adult')::numeric, 0);
  v_fee_per_child            numeric := coalesce((payload->>'fee_per_child')::numeric, 0);
  v_activity_type            text := lower(coalesce(nullif(payload->>'activity_type', ''), 'pool'));
  v_includes_pool            boolean := coalesce((payload->>'includes_pool')::boolean, v_activity_type in ('pool', 'mixed'));
  v_includes_facility_access boolean := coalesce((payload->>'includes_facility_access')::boolean, v_activity_type in ('facility', 'braai', 'mixed'));
  v_includes_braai           boolean := coalesce((payload->>'includes_braai')::boolean, v_activity_type in ('braai', 'mixed'));
  v_status                   text := lower(coalesce(nullif(payload->>'status', ''), 'checked_in'));
  v_pricing_mode             text := lower(coalesce(nullif(payload->>'pricing_mode', ''), 'per_person'));
  v_flat_fee                 numeric := coalesce((payload->>'flat_fee')::numeric, 0);
  v_hourly_rate              numeric := coalesce((payload->>'hourly_rate')::numeric, 0);
  v_duration_hours           numeric := greatest(coalesce((payload->>'duration_hours')::numeric, 0), 0);
  v_package_name             text := nullif(payload->>'package_name', '');
  v_package_fee              numeric := coalesce((payload->>'package_fee')::numeric, 0);
  v_deposit_amount           numeric := greatest(coalesce((payload->>'deposit_amount')::numeric, 0), 0);
  v_base_total               numeric := 0;
  v_extras_total             numeric := 0;
  v_total                    numeric;
  v_balance_due              numeric;
  v_extra                    jsonb;
  v_inventory_item_id        uuid;
  v_quantity                 numeric;
  v_unit_price               numeric;
  v_name                     text;
  v_stock_ok                 boolean;
begin
  if exists (
    select 1 from public.pool_day_use
    where id = v_id
      and lodge_id = v_lodge_id
  ) then
    select total into v_total
      from public.pool_day_use
     where id = v_id
       and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_id, 'total', v_total, 'idempotent', true);
  end if;

  if v_activity_type not in ('pool', 'facility', 'braai', 'mixed') then
    raise exception 'Activity type must be pool, facility, braai, or mixed';
  end if;

  if v_status not in ('reserved', 'checked_in', 'active', 'completed', 'cancelled') then
    raise exception 'Status must be reserved, checked_in, active, completed, or cancelled';
  end if;

  if v_pricing_mode not in ('per_person', 'flat', 'hourly', 'package') then
    raise exception 'Pricing mode must be per_person, flat, hourly, or package';
  end if;

  if greatest(v_fee_per_adult, v_fee_per_child, v_flat_fee, v_hourly_rate, v_package_fee, v_deposit_amount) > 999999.99 then
    raise exception 'Day-use pricing values must be between P0.00 and P999,999.99';
  end if;

  if least(v_fee_per_adult, v_fee_per_child, v_flat_fee, v_hourly_rate, v_package_fee, v_deposit_amount) < 0 then
    raise exception 'Day-use pricing values cannot be negative';
  end if;

  if v_pricing_mode = 'flat' then
    v_base_total := v_flat_fee;
  elsif v_pricing_mode = 'hourly' then
    v_base_total := v_hourly_rate * v_duration_hours;
  elsif v_pricing_mode = 'package' then
    v_base_total := v_package_fee;
  else
    v_base_total := (v_adults * v_fee_per_adult) + (v_children * v_fee_per_child);
  end if;

  for v_extra in
    select value
      from jsonb_array_elements(coalesce(payload->'extras', '[]'::jsonb))
  loop
    v_inventory_item_id := nullif(v_extra->>'inventory_item_id', '')::uuid;
    v_quantity := greatest(coalesce((v_extra->>'quantity')::numeric, 0), 0);
    v_unit_price := coalesce((v_extra->>'unit_price')::numeric, 0);
    v_name := coalesce(nullif(v_extra->>'name', ''), 'Extra');

    if v_quantity <= 0 then
      continue;
    end if;

    if v_unit_price < 0 or v_unit_price > 999999.99 then
      raise exception 'Day-use extra price for % must be between P0.00 and P999,999.99', v_name;
    end if;

    if v_inventory_item_id is not null then
      select current_stock >= v_quantity
        into v_stock_ok
        from public.inventory_items
       where id = v_inventory_item_id
         and lodge_id = v_lodge_id;

      if v_stock_ok is distinct from true then
        raise exception 'Not enough stock for %', v_name;
      end if;

      update public.inventory_items
         set current_stock = current_stock - v_quantity
       where id = v_inventory_item_id
         and lodge_id = v_lodge_id;
    end if;

    v_extras_total := v_extras_total + (v_quantity * v_unit_price);
  end loop;

  v_total := v_base_total + v_extras_total;
  v_deposit_amount := least(v_deposit_amount, v_total);
  v_balance_due := greatest(v_total - v_deposit_amount, 0);

  insert into public.pool_day_use (
    id, lodge_id, date, guest_name, phone,
    adults, children, fee_per_adult, fee_per_child,
    template_key, template_name,
    activity_type, includes_pool, includes_facility_access, includes_braai,
    status, start_time, end_time, duration_hours,
    pricing_mode, flat_fee, hourly_rate, package_name, package_fee,
    base_total, extras_total, extras, total,
    deposit_amount, balance_due,
    resource_key, resource_name, resource_type, service_notes,
    payment_method, notes
  ) values (
    v_id,
    v_lodge_id,
    (payload->>'date')::date,
    coalesce(payload->>'guest_name', 'Walk-in'),
    nullif(payload->>'phone', ''),
    v_adults,
    v_children,
    v_fee_per_adult,
    v_fee_per_child,
    nullif(payload->>'template_key', ''),
    nullif(payload->>'template_name', ''),
    v_activity_type,
    v_includes_pool,
    v_includes_facility_access,
    v_includes_braai,
    v_status,
    nullif(payload->>'start_time', ''),
    nullif(payload->>'end_time', ''),
    v_duration_hours,
    v_pricing_mode,
    v_flat_fee,
    v_hourly_rate,
    v_package_name,
    v_package_fee,
    v_base_total,
    v_extras_total,
    coalesce(payload->'extras', '[]'::jsonb),
    v_total,
    v_deposit_amount,
    v_balance_due,
    nullif(payload->>'resource_key', ''),
    nullif(payload->>'resource_name', ''),
    nullif(payload->>'resource_type', ''),
    nullif(payload->>'service_notes', ''),
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id, 'total', v_total, 'balance_due', v_balance_due);
end;
$pool_day_use$;

grant execute on function public.add_pool_day_use(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
