create or replace function public.add_pool_day_use(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.pool_day_use (
    lodge_id,
    date,
    guest_name,
    phone,
    adults,
    children,
    fee_per_adult,
    fee_per_child,
    total,
    payment_method,
    notes
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'date')::date,
    coalesce(payload->>'guest_name', 'Walk-in'),
    nullif(payload->>'phone', ''),
    coalesce((payload->>'adults')::integer, 1),
    coalesce((payload->>'children')::integer, 0),
    coalesce((payload->>'fee_per_adult')::numeric, 0),
    coalesce((payload->>'fee_per_child')::numeric, 0),
    coalesce((payload->>'total')::numeric, 0),
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

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
begin
  delete from public.pool_day_use
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Pool day-use entry not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_pool_day_use(uuid, uuid) to anon, authenticated;
