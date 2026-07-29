begin;

alter table public.restaurant_shifts
  add column if not exists staff_user_id uuid references public.users(id) on delete restrict,
  add column if not exists clocked_in_by uuid references public.users(id) on delete restrict,
  add column if not exists clocked_out_by uuid references public.users(id) on delete restrict,
  add column if not exists idempotency_key text;

create unique index if not exists restaurant_shifts_active_staff_user_unique
  on public.restaurant_shifts (lodge_id, staff_user_id)
  where status = 'active' and staff_user_id is not null;

create unique index if not exists restaurant_shifts_idempotency_unique
  on public.restaurant_shifts (lodge_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.clock_in_staff(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_staff_user_id uuid := nullif(payload->>'staff_user_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_role text := lower(nullif(btrim(coalesce(payload->>'role', '')), ''));
  v_expected_hours numeric := nullif(payload->>'expected_hours', '')::numeric;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_staff public.users%rowtype;
  v_existing_id uuid;
  v_shift_id uuid := gen_random_uuid();
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);

  if v_actor_id is null or not exists (select 1 from public.users u where u.id = v_actor_id and u.lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Your signed-in staff identity could not be confirmed for this business. Sign in again before changing shifts.');
  end if;
  if v_staff_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Choose a staff member from the active team list.');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'This clock-in needs a valid retry key. Close and reopen the form, then try again.');
  end if;

  select id into v_existing_id from public.restaurant_shifts where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then return jsonb_build_object('success', true, 'shift_id', v_existing_id, 'duplicate', true); end if;

  select * into v_staff from public.users where id = v_staff_user_id and lodge_id = v_lodge_id for key share;
  if not found or coalesce(v_staff.status, 'active') <> 'active' then
    return jsonb_build_object('success', false, 'error', 'That staff member is no longer active for this business. Refresh the team list and choose an active staff member.');
  end if;
  if v_role is null or v_role not in ('waiter', 'cashier', 'kitchen', 'bar', 'manager') then
    return jsonb_build_object('success', false, 'error', 'Choose the person''s duty for this shift.');
  end if;
  if v_expected_hours is not null and (v_expected_hours <= 0 or v_expected_hours > 24) then
    return jsonb_build_object('success', false, 'error', 'Expected shift hours must be greater than zero and no more than 24.');
  end if;
  if exists (select 1 from public.restaurant_shifts where lodge_id = v_lodge_id and staff_user_id = v_staff_user_id and status = 'active') then
    return jsonb_build_object('success', false, 'error', 'This staff member already has an active shift. Clock them out before starting another one.');
  end if;

  insert into public.restaurant_shifts (id, lodge_id, staff_user_id, staff_name, role, expected_hours, status, clocked_in_by, idempotency_key)
  values (v_shift_id, v_lodge_id, v_staff.id, coalesce(nullif(btrim(v_staff.name), ''), v_staff.email), v_role, v_expected_hours, 'active', v_actor_id, v_key);

  return jsonb_build_object('success', true, 'shift_id', v_shift_id);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'This staff member already has an active shift. Refresh the list before trying again.');
end;
$$;

create or replace function public.clock_out_staff(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor_id uuid := public.app_current_user_id();
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);
  if v_actor_id is null or not exists (select 1 from public.users u where u.id = v_actor_id and u.lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Your signed-in staff identity could not be confirmed for this business. Sign in again before changing shifts.');
  end if;
  if v_shift_id is null then return jsonb_build_object('success', false, 'error', 'Shift ID is required.'); end if;

  update public.restaurant_shifts
     set clock_out = now(), status = 'completed', notes = coalesce(v_notes, notes), clocked_out_by = v_actor_id
   where id = v_shift_id and lodge_id = v_lodge_id and status = 'active';
  if not found then return jsonb_build_object('success', false, 'error', 'Active shift not found. Refresh the list and try again.'); end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.clock_in_staff(jsonb), public.clock_out_staff(jsonb) from public;
grant execute on function public.clock_in_staff(jsonb), public.clock_out_staff(jsonb) to authenticated, service_role;

commit;
