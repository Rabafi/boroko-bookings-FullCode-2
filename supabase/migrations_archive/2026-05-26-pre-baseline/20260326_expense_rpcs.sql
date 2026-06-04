create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.expenses (
    lodge_id,
    date,
    category,
    description,
    amount
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    coalesce((payload->>'amount')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_expense(jsonb) to anon, authenticated;

create or replace function public.update_expense(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.expenses
  set
    date = case when payload ? 'date' then (payload->>'date')::date else date end,
    category = case when payload ? 'category' then payload->>'category' else category end,
    description = case when payload ? 'description' then payload->>'description' else description end,
    amount = case when payload ? 'amount' then coalesce((payload->>'amount')::numeric, 0) else amount end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_expense(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_expense(
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
  delete from public.expenses
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_expense(uuid, uuid) to anon, authenticated;
