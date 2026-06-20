begin;

create or replace function public.open_pos_shift_with_id(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_cashier_id uuid := nullif(payload->>'cashier_id', '')::uuid;
  v_cashier_name text := nullif(payload->>'cashier_name', '');
  v_opening_float numeric := round(greatest(0, coalesce(nullif(payload->>'opening_float', '')::numeric, 0)), 2);
  v_notes text := nullif(payload->>'notes', '');
  v_create_idempotency_key text := nullif(payload->>'create_idempotency_key', '');
  v_existing public.pos_shifts%rowtype;
  v_row public.pos_shifts%rowtype;
begin
  if v_shift_id is null or v_lodge_id is null or v_cashier_id is null or v_outlet_id is null
     or v_create_idempotency_key is null then
    return jsonb_build_object(
      'success', false,
      'error', 'shift_id, lodge_id, cashier_id, outlet_id and create_idempotency_key are required'
    );
  end if;

  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  perform pg_advisory_xact_lock(
    hashtext('pos_shift:' || v_lodge_id::text || ':' || v_outlet_id::text || ':' || v_cashier_id::text)
  );

  select *
    into v_existing
    from public.pos_shifts
   where lodge_id = v_lodge_id
     and (
       id = v_shift_id
       or create_idempotency_key = v_create_idempotency_key
     )
   order by opened_at desc
   limit 1
   for update;

  if found then
    if v_existing.outlet_id is distinct from v_outlet_id then
      return jsonb_build_object('success', false, 'error', 'Existing shift belongs to another outlet');
    end if;
    return jsonb_build_object(
      'success', true,
      'id', v_existing.id,
      'already_open', v_existing.status = 'open',
      'shift', to_jsonb(v_existing)
    );
  end if;

  select *
    into v_existing
    from public.pos_shifts
   where lodge_id = v_lodge_id
     and outlet_id = v_outlet_id
     and cashier_id = v_cashier_id
     and status = 'open'
   order by opened_at desc
   limit 1
   for update;

  if found then
    return jsonb_build_object(
      'success', true,
      'already_open', true,
      'shift', to_jsonb(v_existing)
    );
  end if;

  insert into public.pos_shifts (
    id, lodge_id, outlet_id, cashier_id, cashier_name, opening_float,
    status, opened_at, notes, create_idempotency_key
  ) values (
    v_shift_id, v_lodge_id, v_outlet_id, v_cashier_id, v_cashier_name,
    v_opening_float, 'open', now(), v_notes, v_create_idempotency_key
  )
  returning * into v_row;

  return jsonb_build_object('success', true, 'id', v_row.id, 'shift', to_jsonb(v_row));
end;
$$;

revoke all on function public.open_pos_shift_with_id(jsonb) from public;
grant execute on function public.open_pos_shift_with_id(jsonb)
  to anon, authenticated, service_role;

-- Closing a shift without reconciliation bypasses the authoritative cash-up
-- ledger. Keep the old function for controlled recovery only.
revoke all on function public.close_pos_shift_with_id(jsonb)
  from public, anon, authenticated;
grant execute on function public.close_pos_shift_with_id(jsonb) to service_role;

commit;
