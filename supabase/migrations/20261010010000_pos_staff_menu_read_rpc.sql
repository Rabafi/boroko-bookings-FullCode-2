-- Keep POS catalog reads available to authenticated staff without granting table SELECT.
-- The client previously queried pos_menu_items directly; the RLS policy existed,
-- but authenticated/anon lacked SELECT, so the desktop silently served an empty cache.
create or replace function public.get_pos_menu_items_for_staff_v1(p_lodge_id uuid)
returns setof public.pos_menu_items
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user public.users%rowtype;
  v_role text;
  v_override jsonb;
  v_can_view boolean;
begin
  if auth.uid() is null or p_lodge_id is null then
    raise exception 'An authenticated lodge session is required.' using errcode = '42501';
  end if;

  begin
    select u.*
      into strict v_user
      from public.users u
     where u.auth_user_id = auth.uid()
       and u.lodge_id = p_lodge_id
       and lower(coalesce(u.status, 'active')) = 'active';
  exception
    when no_data_found then
      raise exception 'An active staff session for this lodge is required.' using errcode = '42501';
  end;

  v_role := lower(btrim(coalesce(v_user.role, '')));
  v_role := case v_role
    when 'superadmin' then 'super_admin'
    when 'administrator' then 'admin'
    when 'owner' then 'admin'
    when 'pos_cashier' then 'cashier'
    when 'barcashier' then 'cashier'
    when 'kitchencashier' then 'cashier'
    when 'pos_supervisor' then 'supervisor'
    else v_role
  end;

  v_override := coalesce(v_user.capability_overrides, '{}'::jsonb) -> 'pos.view';
  if jsonb_typeof(v_override) = 'boolean' then
    v_can_view := (v_override::text)::boolean;
  else
    v_can_view := v_role in ('cashier', 'supervisor', 'manager', 'admin', 'super_admin');
  end if;
  if not coalesce(v_can_view, false) then
    raise exception 'POS view capability is required.' using errcode = '42501';
  end if;

  if v_role in ('manager', 'admin', 'super_admin') then
    return query
      select m.*
        from public.pos_menu_items m
       where m.lodge_id = p_lodge_id
       order by m.category, m.name, m.id
       limit 500;
  else
    return query
      select m.*
        from public.pos_menu_items m
       where m.lodge_id = p_lodge_id
         and (m.outlet_id is null or m.outlet_id = any(coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])))
       order by m.category, m.name, m.id
       limit 500;
  end if;
end;
$$;

revoke all on function public.get_pos_menu_items_for_staff_v1(uuid) from public, anon, service_role;
grant execute on function public.get_pos_menu_items_for_staff_v1(uuid) to authenticated;
comment on function public.get_pos_menu_items_for_staff_v1(uuid) is
  'Authenticated POS menu read. Enforces active lodge identity, pos.view, and server-side outlet scope without table SELECT grants.';