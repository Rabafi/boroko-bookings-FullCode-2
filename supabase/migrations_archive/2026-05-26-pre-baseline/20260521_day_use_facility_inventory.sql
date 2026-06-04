begin;

update public.outlets o
   set name = 'Others'
 where o.name = 'Front Desk'
   and not exists (
     select 1
       from public.outlets x
      where x.lodge_id = o.lodge_id
        and x.name = 'Others'
   );

alter table public.pool_day_use
  add column if not exists activity_type text not null default 'pool',
  add column if not exists includes_pool boolean not null default true,
  add column if not exists includes_facility_access boolean not null default false,
  add column if not exists includes_braai boolean not null default false,
  add column if not exists base_total numeric not null default 0,
  add column if not exists extras_total numeric not null default 0,
  add column if not exists extras jsonb not null default '[]'::jsonb;

update public.pool_day_use
   set base_total = coalesce(total, 0)
 where coalesce(base_total, 0) = 0
   and coalesce(total, 0) > 0;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'pool_day_use_activity_type_check'
       and conrelid = 'public.pool_day_use'::regclass
  ) then
    alter table public.pool_day_use
      add constraint pool_day_use_activity_type_check
      check (activity_type in ('pool', 'facility', 'braai', 'mixed'));
  end if;
end
$$;

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
  v_base_total               numeric;
  v_extras_total             numeric := 0;
  v_total                    numeric;
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

  if v_fee_per_adult < 0 or v_fee_per_adult > 999999.99 then
    raise exception 'Adult day-use fee must be between P0.00 and P999,999.99';
  end if;

  if v_fee_per_child < 0 or v_fee_per_child > 999999.99 then
    raise exception 'Child day-use fee must be between P0.00 and P999,999.99';
  end if;

  if v_activity_type not in ('pool', 'facility', 'braai', 'mixed') then
    raise exception 'Activity type must be pool, facility, braai, or mixed';
  end if;

  v_base_total := (v_adults * v_fee_per_adult) + (v_children * v_fee_per_child);

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

  insert into public.pool_day_use (
    id, lodge_id, date, guest_name, phone,
    adults, children, fee_per_adult, fee_per_child,
    activity_type, includes_pool, includes_facility_access, includes_braai,
    base_total, extras_total, extras,
    total, payment_method, notes
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
    v_activity_type,
    v_includes_pool,
    v_includes_facility_access,
    v_includes_braai,
    v_base_total,
    v_extras_total,
    coalesce(payload->'extras', '[]'::jsonb),
    v_total,
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id, 'total', v_total);
end;
$pool_day_use$;

grant execute on function public.add_pool_day_use(jsonb) to anon, authenticated;

create or replace function public.delete_pool_day_use(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
  v_extras jsonb := '[]'::jsonb;
  v_extra jsonb;
  v_inventory_item_id uuid;
  v_quantity numeric;
begin
  select coalesce(extras, '[]'::jsonb)
    into v_extras
    from public.pool_day_use
   where id = p_id
     and lodge_id = p_lodge_id;

  delete from public.pool_day_use
   where id = p_id
     and lodge_id = p_lodge_id
   returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Pool day-use entry not found');
  end if;

  for v_extra in
    select value
      from jsonb_array_elements(v_extras)
  loop
    v_inventory_item_id := nullif(v_extra->>'inventory_item_id', '')::uuid;
    v_quantity := greatest(coalesce((v_extra->>'quantity')::numeric, 0), 0);
    if v_inventory_item_id is null or v_quantity <= 0 then
      continue;
    end if;

    update public.inventory_items
       set current_stock = current_stock + v_quantity
     where id = v_inventory_item_id
       and lodge_id = p_lodge_id;
  end loop;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_pool_day_use(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
