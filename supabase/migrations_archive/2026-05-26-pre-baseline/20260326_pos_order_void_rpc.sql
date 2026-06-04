create or replace function public.void_pos_order(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status
  into v_status
  from public.pos_orders
  where id = p_id
    and lodge_id = p_lodge_id;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
  set status = 'voided'
  where id = p_id
    and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

grant execute on function public.void_pos_order(uuid, uuid) to anon, authenticated;
