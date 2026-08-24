-- Allow a lodge administrator to operate the shared Till as the
-- named operator.  This is a forward repair after the deployed waiter
-- ownership contract; it does not loosen outlet, shift, attendance, proof, or
-- assigned-tab ownership checks.
begin;

create or replace function public._pos_tab_active_waiter_error(
  p_lodge_id uuid,
  p_outlet_id uuid,
  p_waiter_id uuid,
  p_shift_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.pos_shifts%rowtype;
begin
  if p_waiter_id is null then
    return 'An assigned waiter is required. Sign in as the serving waiter before changing this tab.';
  end if;

  if not exists (
    select 1
      from public.users u
     where u.id = p_waiter_id
       and u.lodge_id = p_lodge_id
       and coalesce(u.status, 'active') = 'active'
  ) then
    return 'The assigned waiter is not an active staff member for this lodge.';
  end if;

  -- Administrative Till operators may be the assigned operator when they are
  -- actively serving this outlet.  The exact shift and attendance checks
  -- below remain mandatory for every role.  This is deliberately an explicit
  -- role list: it does not turn a PIN or a visible UI choice into authority.
  if not exists (
    select 1
      from public.users u
     where u.id = p_waiter_id
       and u.lodge_id = p_lodge_id
       and lower(coalesce(u.role, '')) in (
         'waiter', 'bar', 'bartender', 'cashier',
         'admin', 'manager', 'supervisor', 'super_admin'
       )
  ) then
    return 'The selected staff member is not authorized as a serving waiter.';
  end if;

  select *
    into v_shift
    from public.pos_shifts s
   where s.id = p_shift_id
     and s.lodge_id = p_lodge_id
     and s.outlet_id is not distinct from p_outlet_id
     and s.cashier_id = p_waiter_id
     and s.status = 'open'
     and s.closed_at is null
   for key share;
  if not found then
    return 'The assigned waiter has no active Till shift for this outlet. Refresh Till and attendance before changing the tab.';
  end if;

  if v_shift.attendance_shift_id is not null then
    if not exists (
      select 1
        from public.restaurant_shifts a
       where a.id = v_shift.attendance_shift_id
         and a.lodge_id = p_lodge_id
         and a.staff_user_id = p_waiter_id
         and a.status = 'active'
    ) then
      return 'The assigned waiter attendance is no longer active. Refresh Clock in/out before changing the tab.';
    end if;
  elsif not exists (
    select 1
      from public.restaurant_shifts a
     where a.lodge_id = p_lodge_id
       and a.staff_user_id = p_waiter_id
       and a.status = 'active'
       and a.outlet_id is not distinct from p_outlet_id
  ) then
    return 'The assigned waiter attendance and Till shift cannot be proven for this outlet.';
  end if;

  return null;
end;
$$;

revoke all on function public._pos_tab_active_waiter_error(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_tab_active_waiter_error(uuid, uuid, uuid, uuid)
  to service_role;

commit;
