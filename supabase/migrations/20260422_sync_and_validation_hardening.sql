create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_amount numeric := coalesce((payload->>'amount')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_amount <= 0 or v_amount > 999999.99 then
    raise exception 'Expense amount must be between P0.01 and P999,999.99';
  end if;

  insert into public.expenses (
    lodge_id,
    date,
    category,
    description,
    amount,
    outlet_id
  ) values (
    v_lodge_id,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    v_amount,
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_expense(jsonb) from public;
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
  v_amount numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if payload ? 'amount' then
    v_amount := coalesce((payload->>'amount')::numeric, 0);
    if v_amount <= 0 or v_amount > 999999.99 then
      raise exception 'Expense amount must be between P0.01 and P999,999.99';
    end if;
  end if;

  update public.expenses
  set
    date        = case when payload ? 'date'        then (payload->>'date')::date                    else date        end,
    category    = case when payload ? 'category'    then payload->>'category'                        else category    end,
    description = case when payload ? 'description' then payload->>'description'                     else description end,
    amount      = case when payload ? 'amount'      then v_amount                                     else amount      end,
    outlet_id   = case when payload ? 'outlet_id'   then nullif(payload->>'outlet_id', '')::uuid    else outlet_id   end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_expense(uuid, uuid, jsonb) from public;
grant execute on function public.update_expense(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.add_pool_day_use(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_adults integer := greatest(coalesce((payload->>'adults')::integer, 1), 0);
  v_children integer := greatest(coalesce((payload->>'children')::integer, 0), 0);
  v_fee_per_adult numeric := coalesce((payload->>'fee_per_adult')::numeric, 0);
  v_fee_per_child numeric := coalesce((payload->>'fee_per_child')::numeric, 0);
  v_total numeric;
begin
  if v_fee_per_adult < 0 or v_fee_per_adult > 999999.99 then
    raise exception 'Adult day-use fee must be between P0.00 and P999,999.99';
  end if;

  if v_fee_per_child < 0 or v_fee_per_child > 999999.99 then
    raise exception 'Child day-use fee must be between P0.00 and P999,999.99';
  end if;

  v_total := (v_adults * v_fee_per_adult) + (v_children * v_fee_per_child);

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
    v_adults,
    v_children,
    v_fee_per_adult,
    v_fee_per_child,
    v_total,
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'total', v_total);
end;
$function$;

grant execute on function public.add_pool_day_use(jsonb) to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_bookings_total_amount_non_negative'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint chk_bookings_total_amount_non_negative
      check (total_amount >= 0) not valid;
  end if;
end
$$;

notify pgrst, 'reload schema';
