begin;

create table if not exists public.pool_day_use_operation_receipts (
  idempotency_key text primary key,
  lodge_id uuid not null,
  entry_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.pool_day_use_operation_receipts from public, anon, authenticated;

create or replace function public.update_pool_day_use(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_key text := nullif(btrim(payload->>'idempotency_key'), '');
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_status text := case when payload ? 'status' then lower(nullif(payload->>'status', '')) else null end;
  v_payment_method text := case when payload ? 'payment_method' then nullif(btrim(payload->>'payment_method'), '') else null end;
  v_settle_balance boolean := coalesce((payload->>'settle_balance')::boolean, false);
  v_row public.pool_day_use%rowtype;
  v_result jsonb;
begin
  if v_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'Day-use entry and lodge are required');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 or v_key !~ '^[A-Za-z0-9:_-]+$' then
    return jsonb_build_object('success', false, 'error', 'A valid idempotency key is required');
  end if;

  select result into v_result
    from public.pool_day_use_operation_receipts
   where idempotency_key = v_key
     and lodge_id = v_lodge_id;
  if found then
    return v_result || jsonb_build_object('idempotent', true);
  end if;

  select * into v_row
    from public.pool_day_use
   where id = v_id
     and lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Day-use entry was not found');
  end if;

  if v_expected_updated_at is not null
     and v_row.updated_at is distinct from v_expected_updated_at then
    return jsonb_build_object('success', false, 'error', 'Day-use entry was changed on another device. Refresh and try again.');
  end if;

  if v_status is not null
     and v_status not in ('reserved', 'checked_in', 'active', 'completed', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Invalid day-use status');
  end if;

  update public.pool_day_use
     set status = coalesce(v_status, status),
         payment_method = coalesce(v_payment_method, payment_method),
         deposit_amount = case when v_settle_balance then total else deposit_amount end,
         balance_due = case when v_settle_balance then 0 else balance_due end,
         updated_at = now()
   where id = v_id
     and lodge_id = v_lodge_id
  returning * into v_row;

  v_result := jsonb_build_object(
    'success', true,
    'id', v_row.id,
    'status', v_row.status,
    'deposit_amount', v_row.deposit_amount,
    'balance_due', v_row.balance_due,
    'payment_method', v_row.payment_method,
    'updated_at', v_row.updated_at
  );

  insert into public.pool_day_use_operation_receipts (idempotency_key, lodge_id, entry_id, result)
  values (v_key, v_lodge_id, v_id, v_result)
  on conflict (idempotency_key) do nothing;

  return v_result;
end
$function$;

revoke all on function public.update_pool_day_use(jsonb) from public, anon;
grant execute on function public.update_pool_day_use(jsonb) to authenticated, service_role;

commit;
