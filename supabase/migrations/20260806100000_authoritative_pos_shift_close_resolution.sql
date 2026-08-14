-- Exact server evidence for resolving a lost or replayed POS shift-close response.
-- This is intentionally local-only until separately reviewed and deployed.
create or replace function public.get_pos_shift_close_resolution(
  p_lodge_id uuid,
  p_shift_id uuid,
  p_close_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_cashup record;
  v_status text;
  v_key_matches boolean := false;
begin
  if p_lodge_id is null or p_shift_id is null then
    return jsonb_build_object('success', false, 'code', 'invalid_scope', 'error', 'lodge_id and shift_id are required');
  end if;

  perform public.app_require_lodge_role(
    p_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin']
  );

  select s.* into v_shift
    from public.pos_shifts s
   where s.lodge_id = p_lodge_id
     and s.id = p_shift_id;
  if not found then
    return jsonb_build_object('success', true, 'exists', false, 'status', 'missing', 'shift_id', p_shift_id);
  end if;

  v_status := lower(coalesce(v_shift.status, 'unknown'));
  if nullif(btrim(coalesce(p_close_idempotency_key, '')), '') is not null then
    select c.* into v_cashup
      from public.pos_cashup_sessions c
     where c.lodge_id = p_lodge_id
       and c.shift_id = p_shift_id
       and c.idempotency_key = p_close_idempotency_key
     order by c.created_at desc
     limit 1;
  else
    select c.* into v_cashup
      from public.pos_cashup_sessions c
     where c.lodge_id = p_lodge_id
       and c.shift_id = p_shift_id
     order by c.created_at desc
     limit 1;
  end if;

  v_key_matches := v_cashup.id is not null
    and nullif(btrim(coalesce(v_cashup.idempotency_key, '')), '') is not null
    and (nullif(btrim(coalesce(p_close_idempotency_key, '')), '') is null
      or v_cashup.idempotency_key = p_close_idempotency_key)
    and (v_shift.close_idempotency_key is null
      or v_shift.close_idempotency_key = v_cashup.idempotency_key);

  return jsonb_build_object(
    'success', true,
    'exists', true,
    'shift_id', p_shift_id,
    'status', v_status,
    'finalized', (v_status = 'closed' and v_key_matches),
    'close_idempotency_key', v_shift.close_idempotency_key,
    'shift', to_jsonb(v_shift),
    'cashup_session', case when v_cashup.id is null then null else to_jsonb(v_cashup) end
  );
end;
$$;

revoke all on function public.get_pos_shift_close_resolution(uuid, uuid, text) from public;
grant execute on function public.get_pos_shift_close_resolution(uuid, uuid, text) to authenticated, service_role;
