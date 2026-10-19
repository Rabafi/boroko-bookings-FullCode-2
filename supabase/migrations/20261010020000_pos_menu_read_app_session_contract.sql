begin;

-- R8 (Codex review, CHANGES REQUIRED): the staff menu read silently truncated
-- at 500 rows, so a verified client cache could be overwritten by a partial
-- catalogue. This revision removes the implicit limit (the read returns the
-- complete lodge catalogue in one statement) and adds a fingerprint RPC so
-- the client can verify completeness before replacing a verified cache.
-- Both functions keep the same app-session / Supabase-Auth resolution and
-- server-side pos.view + outlet scope as before.
create or replace function public.get_pos_menu_items_for_staff_v1(p_lodge_id uuid)
returns setof public.pos_menu_items
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app_actor uuid;
  v_auth_actor uuid;
  v_user public.users%rowtype;
  v_role text;
  v_override jsonb;
  v_can_view boolean;
begin
  if p_lodge_id is null then
    raise exception 'A lodge is required.' using errcode = '42501';
  end if;

  v_app_actor := public.app_get_actor_user_id();
  v_auth_actor := auth.uid();

  if v_app_actor is not null then
    if public.app_current_lodge_id() is distinct from p_lodge_id then
      raise exception 'The active staff session does not match this lodge.' using errcode = '42501';
    end if;
    begin
      select u.*
        into strict v_user
        from public.users u
       where u.id = v_app_actor
         and u.lodge_id = p_lodge_id
         and lower(coalesce(u.status, 'active')) = 'active';
    exception
      when no_data_found then
        raise exception 'An active staff session for this lodge is required.' using errcode = '42501';
    end;
  elsif v_auth_actor is not null then
    begin
      select u.*
        into strict v_user
        from public.users u
       where u.auth_user_id = v_auth_actor
         and u.lodge_id = p_lodge_id
         and lower(coalesce(u.status, 'active')) = 'active';
    exception
      when no_data_found then
        raise exception 'An active staff session for this lodge is required.' using errcode = '42501';
    end;
  else
    raise exception 'An authenticated staff session is required.' using errcode = '42501';
  end if;

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

  -- No LIMIT: the catalogue must be complete so the desktop never replaces a
  -- verified cache with a truncated read. Ordering is deterministic and the
  -- client verifies the row count against get_pos_menu_catalog_fingerprint_v1.
  if v_role in ('manager', 'admin', 'super_admin') then
    return query
      select m.*
        from public.pos_menu_items m
       where m.lodge_id = p_lodge_id
       order by m.category, m.name, m.id;
  elsif cardinality(coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])) = 0 then
    return;
  else
    return query
      select m.*
        from public.pos_menu_items m
       where m.lodge_id = p_lodge_id
         and (m.outlet_id is null or m.outlet_id = any(coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])))
       order by m.category, m.name, m.id;
  end if;
end;
$$;

revoke all on function public.get_pos_menu_items_for_staff_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_pos_menu_items_for_staff_v1(uuid) to anon, authenticated;
comment on function public.get_pos_menu_items_for_staff_v1(uuid) is
  'Authenticated desktop app-session or Supabase Auth POS menu read. Enforces active lodge identity, pos.view and server-side outlet scope without table SELECT grants. Returns the complete catalogue (no implicit limit).';

-- Completeness verification for the client bootstrap: the count the caller is
-- entitled to see for this lodge, using exactly the same scope predicate as
-- get_pos_menu_items_for_staff_v1.
create or replace function public.get_pos_menu_catalog_fingerprint_v1(p_lodge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_app_actor uuid;
  v_auth_actor uuid;
  v_user public.users%rowtype;
  v_role text;
  v_override jsonb;
  v_can_view boolean;
  v_item_count integer;
begin
  if p_lodge_id is null then
    raise exception 'A lodge is required.' using errcode = '42501';
  end if;

  v_app_actor := public.app_get_actor_user_id();
  v_auth_actor := auth.uid();

  if v_app_actor is not null then
    if public.app_current_lodge_id() is distinct from p_lodge_id then
      raise exception 'The active staff session does not match this lodge.' using errcode = '42501';
    end if;
    begin
      select u.*
        into strict v_user
        from public.users u
       where u.id = v_app_actor
         and u.lodge_id = p_lodge_id
         and lower(coalesce(u.status, 'active')) = 'active';
    exception
      when no_data_found then
        raise exception 'An active staff session for this lodge is required.' using errcode = '42501';
    end;
  elsif v_auth_actor is not null then
    begin
      select u.*
        into strict v_user
        from public.users u
       where u.auth_user_id = v_auth_actor
         and u.lodge_id = p_lodge_id
         and lower(coalesce(u.status, 'active')) = 'active';
    exception
      when no_data_found then
        raise exception 'An active staff session for this lodge is required.' using errcode = '42501';
    end;
  else
    raise exception 'An authenticated staff session is required.' using errcode = '42501';
  end if;

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
    select count(*) into v_item_count
      from public.pos_menu_items m
     where m.lodge_id = p_lodge_id;
  else
    select count(*) into v_item_count
      from public.pos_menu_items m
     where m.lodge_id = p_lodge_id
       and (m.outlet_id is null or m.outlet_id = any(coalesce(v_user.allowed_outlet_ids, '{}'::uuid[])));
  end if;

  return jsonb_build_object(
    'success', true,
    'lodge_id', p_lodge_id,
    'item_count', v_item_count,
    'outlet_scoped', v_role not in ('manager', 'admin', 'super_admin')
  );
end;
$$;

revoke all on function public.get_pos_menu_catalog_fingerprint_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_pos_menu_catalog_fingerprint_v1(uuid) to anon, authenticated;
comment on function public.get_pos_menu_catalog_fingerprint_v1(uuid) is
  'R8 completeness fingerprint for the staff menu bootstrap: the exact row count the caller may see under the same session, pos.view and outlet scope as get_pos_menu_items_for_staff_v1.';

commit;
