-- Staff access is operationally sensitive. Keep an immutable, server-backed
-- account/audience trail and make the advertised manager workflow safe.

create table if not exists public.staff_access_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  staff_user_id uuid,
  actor_id uuid,
  action text not null check (action in (
    'staff_account_created', 'staff_account_updated', 'staff_role_changed',
    'staff_status_changed', 'staff_outlet_access_changed', 'staff_permissions_changed',
    'staff_mobile_access_changed', 'staff_approval_pin_changed', 'staff_password_changed',
    'staff_auth_linked', 'staff_account_deleted'
  )),
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_access_audit_lodge_created_idx
  on public.staff_access_audit (lodge_id, created_at desc);

alter table public.staff_access_audit enable row level security;

drop policy if exists staff_access_audit_lodge_scope_select on public.staff_access_audit;
create policy staff_access_audit_lodge_scope_select
  on public.staff_access_audit for select
  using (public.app_lodge_access(lodge_id));

revoke all on table public.staff_access_audit from anon, authenticated;
grant select on table public.staff_access_audit to service_role;

create or replace function public.staff_access_audit_snapshot(p_user public.users)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select to_jsonb(p_user) - array['password_hash', 'pin_hash', 'pwa_password_hash']::text[];
$$;

create or replace function public.capture_staff_access_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_lodge_id uuid;
  v_staff_user_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'staff_account_created';
    v_before := null;
    v_after := public.staff_access_audit_snapshot(new);
    v_lodge_id := new.lodge_id;
    v_staff_user_id := new.id;
  elsif tg_op = 'DELETE' then
    v_action := 'staff_account_deleted';
    v_before := public.staff_access_audit_snapshot(old);
    v_after := null;
    v_lodge_id := old.lodge_id;
    v_staff_user_id := old.id;
  else
    if not (
      old.name is distinct from new.name
      or old.email is distinct from new.email
      or old.role is distinct from new.role
      or old.status is distinct from new.status
      or old.allowed_outlet_ids is distinct from new.allowed_outlet_ids
      or old.capability_overrides is distinct from new.capability_overrides
      or old.pwa_enabled is distinct from new.pwa_enabled
      or old.pwa_password_set_at is distinct from new.pwa_password_set_at
      or old.pwa_disabled_reason is distinct from new.pwa_disabled_reason
      or old.pin_hash is distinct from new.pin_hash
      or old.password_hash is distinct from new.password_hash
      or old.auth_user_id is distinct from new.auth_user_id
    ) then
      return new;
    end if;

    v_action := case
      when old.status is distinct from new.status then 'staff_status_changed'
      when old.role is distinct from new.role then 'staff_role_changed'
      when old.allowed_outlet_ids is distinct from new.allowed_outlet_ids then 'staff_outlet_access_changed'
      when old.capability_overrides is distinct from new.capability_overrides then 'staff_permissions_changed'
      when old.pwa_enabled is distinct from new.pwa_enabled
        or old.pwa_password_set_at is distinct from new.pwa_password_set_at
        or old.pwa_disabled_reason is distinct from new.pwa_disabled_reason then 'staff_mobile_access_changed'
      when old.pin_hash is distinct from new.pin_hash then 'staff_approval_pin_changed'
      when old.password_hash is distinct from new.password_hash then 'staff_password_changed'
      when old.auth_user_id is distinct from new.auth_user_id then 'staff_auth_linked'
      else 'staff_account_updated'
    end;
    v_before := public.staff_access_audit_snapshot(old);
    v_after := public.staff_access_audit_snapshot(new);
    v_lodge_id := new.lodge_id;
    v_staff_user_id := new.id;
  end if;

  insert into public.staff_access_audit (
    lodge_id, staff_user_id, actor_id, action, before_snapshot, after_snapshot
  ) values (
    v_lodge_id, v_staff_user_id, public.app_current_user_id(), v_action, v_before, v_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_access_audit_users_trigger on public.users;
create trigger staff_access_audit_users_trigger
after insert or update or delete on public.users
for each row execute function public.capture_staff_access_audit();

create or replace function public.get_staff_access_audit(
  p_lodge_id uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  action text,
  staff_user_id uuid,
  staff_name text,
  actor_id uuid,
  actor_name text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  return query
  select
    audit.id,
    audit.action,
    audit.staff_user_id,
    coalesce(audit.after_snapshot->>'name', audit.before_snapshot->>'name', 'Staff account'),
    audit.actor_id,
    coalesce(actor.name, 'System or offline sync'),
    audit.before_snapshot,
    audit.after_snapshot,
    audit.created_at
  from public.staff_access_audit audit
  left join public.users actor
    on actor.id = audit.actor_id
   and actor.lodge_id = audit.lodge_id
  where audit.lodge_id = p_lodge_id
  order by audit.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

revoke all on function public.get_staff_access_audit(uuid, integer) from public;
grant execute on function public.get_staff_access_audit(uuid, integer) to authenticated, service_role;

-- Managers can run a service team but cannot create or elevate privileged
-- accounts. Admins retain full staff-account authority.
create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_email text;
  v_outlet_ids uuid[];
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_role text := lower(coalesce(payload->>'role', 'receptionist'));
  v_status text := lower(coalesce(payload->>'status', 'active'));
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
  v_actor_role text;
begin
  if exists (
    select 1 from public.users
    where id = (payload->>'id')::uuid and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (select 1 from public.users where lodge_id = v_lodge_id) then
    perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  end if;

  select role into v_actor_role
  from public.users
  where id = public.app_current_user_id() and lodge_id = v_lodge_id;

  if v_actor_role = 'manager' then
    if v_role not in ('cashier', 'supervisor', 'receptionist', 'operations') then
      return jsonb_build_object('success', false, 'error', 'Managers can create service-team accounts only. An administrator must assign finance, manager, or owner access.');
    end if;
    if coalesce(payload->'capability_overrides', '{}'::jsonb) <> '{}'::jsonb then
      return jsonb_build_object('success', false, 'error', 'Managers cannot set custom permission exceptions.');
    end if;
    if v_pwa_enabled then
      return jsonb_build_object('success', false, 'error', 'Managers cannot grant manager mobile app access.');
    end if;
  end if;

  if v_status not in ('active', 'suspended', 'archived') then
    return jsonb_build_object('success', false, 'error', 'Invalid staff status.');
  end if;
  v_email := lower(btrim(coalesce(payload->>'email', '')));
  if v_email = '' or nullif(btrim(coalesce(payload->>'name', '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Staff name and email are required.');
  end if;

  if exists (select 1 from public.users where lodge_id = v_lodge_id and lower(btrim(email)) = v_email) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;
  if v_auth_user_id is not null and exists (select 1 from public.users where lodge_id = v_lodge_id and auth_user_id = v_auth_user_id) then
    return jsonb_build_object('success', false, 'error', 'That Supabase Auth account is already linked to a user in this lodge.');
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[]) into v_outlet_ids
  from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if cardinality(v_outlet_ids) > 0 and (
    select count(*) from public.outlets where lodge_id = v_lodge_id and id = any(v_outlet_ids)
  ) <> cardinality(v_outlet_ids) then
    return jsonb_build_object('success', false, 'error', 'Every selected outlet must belong to this business.');
  end if;
  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;
  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object('success', false, 'error', 'Only Manager and Admin roles can receive Manager PWA access.');
  end if;

  insert into public.users (
    id, auth_user_id, lodge_id, name, email, password_hash, role, status,
    allowed_outlet_ids, pin_hash, capability_overrides, pwa_enabled,
    pwa_password_hash, pwa_password_set_at, pwa_password_reset_by, pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid, v_auth_user_id, v_lodge_id, payload->>'name', v_email,
    payload->>'password_hash', v_role, v_status, v_outlet_ids, nullif(payload->>'pin_hash', ''),
    coalesce(payload->'capability_overrides', '{}'::jsonb), v_pwa_enabled, v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case when v_pwa_enabled then null else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.') end
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'auth_user_id', v_auth_user_id);
end;
$$;

create or replace function public.update_user_profile(p_id uuid, p_lodge_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing public.users%rowtype;
  v_actor_role text;
  v_actor_id uuid := public.app_current_user_id();
  v_email text;
  v_outlet_ids uuid[];
  v_next_role text;
  v_next_status text;
  v_pin_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('staff-profile:' || p_lodge_id::text, 0));
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select * into v_existing from public.users where id = p_id and lodge_id = p_lodge_id for update;
  if v_existing.id is null then return jsonb_build_object('success', false, 'error', 'User not found.'); end if;
  select role into v_actor_role from public.users where id = v_actor_id and lodge_id = p_lodge_id;

  v_next_role := lower(coalesce(nullif(payload->>'role', ''), v_existing.role));
  v_next_status := lower(coalesce(nullif(payload->>'status', ''), v_existing.status));
  if v_next_status not in ('active', 'suspended', 'archived') then return jsonb_build_object('success', false, 'error', 'Invalid staff status.'); end if;
  if v_actor_id = p_id and (v_next_role is distinct from v_existing.role or v_next_status is distinct from v_existing.status) then
    return jsonb_build_object('success', false, 'error', 'You cannot change your own role, suspend, or archive the account you are using.');
  end if;
  if v_existing.role = 'admin' and v_existing.status in ('active', 'suspended') and (v_next_role <> 'admin' or v_next_status not in ('active', 'suspended'))
    and not exists (select 1 from public.users where lodge_id = p_lodge_id and id <> p_id and role = 'admin' and status in ('active', 'suspended')) then
    return jsonb_build_object('success', false, 'error', 'You cannot remove or archive the last admin in this business.');
  end if;
  if v_actor_role = 'manager' then
    if v_existing.role not in ('cashier', 'supervisor', 'receptionist', 'operations') or v_next_role not in ('cashier', 'supervisor', 'receptionist', 'operations') then
      return jsonb_build_object('success', false, 'error', 'Managers can manage service-team accounts only.');
    end if;
    if payload ? 'capability_overrides' and coalesce(payload->'capability_overrides', '{}'::jsonb) <> coalesce(v_existing.capability_overrides, '{}'::jsonb) then
      return jsonb_build_object('success', false, 'error', 'Managers cannot set custom permission exceptions.');
    end if;
  end if;

  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if v_email = '' then return jsonb_build_object('success', false, 'error', 'Staff email is required.'); end if;
    if exists (select 1 from public.users where lodge_id = p_lodge_id and lower(btrim(email)) = v_email and id <> p_id) then
      return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists.', v_email));
    end if;
  end if;
  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[]) into v_outlet_ids from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  else
    v_outlet_ids := coalesce(v_existing.allowed_outlet_ids, '{}'::uuid[]);
  end if;
  if cardinality(v_outlet_ids) > 0 and (select count(*) from public.outlets where lodge_id = p_lodge_id and id = any(v_outlet_ids)) <> cardinality(v_outlet_ids) then
    return jsonb_build_object('success', false, 'error', 'Every selected outlet must belong to this business.');
  end if;
  if v_next_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;
  if payload ? 'pin_hash' then v_pin_hash := nullif(payload->>'pin_hash', ''); end if;

  update public.users
  set name = case when payload ? 'name' then coalesce(nullif(payload->>'name', ''), name) else name end,
      email = coalesce(v_email, email), role = v_next_role, status = v_next_status,
      pin_hash = case when payload ? 'pin_hash' then v_pin_hash else pin_hash end,
      allowed_outlet_ids = v_outlet_ids,
      capability_overrides = case when payload ? 'capability_overrides' then coalesce(payload->'capability_overrides', '{}'::jsonb) else capability_overrides end
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;

create or replace function public.set_user_password(p_id uuid, p_lodge_id uuid, p_password_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user public.users%rowtype;
  v_actor_role text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_user from public.users where id = p_id and lodge_id = p_lodge_id for update;
  if v_user.id is null then return jsonb_build_object('success', false, 'error', 'User not found.'); end if;
  select role into v_actor_role from public.users where id = public.app_current_user_id() and lodge_id = p_lodge_id;
  if v_actor_role = 'manager' and v_user.role not in ('cashier', 'supervisor', 'receptionist', 'operations') then
    return jsonb_build_object('success', false, 'error', 'Managers can reset service-team passwords only.');
  end if;
  if nullif(btrim(coalesce(p_password_hash, '')), '') is null then return jsonb_build_object('success', false, 'error', 'A password is required.'); end if;
  update public.users set password_hash = p_password_hash, password_updated_at = now() where id = p_id and lodge_id = p_lodge_id;
  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;

create or replace function public.delete_user(p_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user public.users%rowtype;
  v_actor_role text;
  v_actor_id uuid := public.app_current_user_id();
begin
  perform pg_advisory_xact_lock(hashtextextended('staff-delete:' || p_lodge_id::text, 0));
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_user from public.users where id = p_id and lodge_id = p_lodge_id for update;
  if v_user.id is null then return jsonb_build_object('success', false, 'error', 'User not found.'); end if;
  if v_actor_id = p_id then return jsonb_build_object('success', false, 'error', 'You cannot delete the account you are currently signed in with.'); end if;
  if v_user.status <> 'archived' then return jsonb_build_object('success', false, 'error', 'Archive the staff account before permanently deleting it.'); end if;
  select role into v_actor_role from public.users where id = v_actor_id and lodge_id = p_lodge_id;
  if v_actor_role = 'manager' and v_user.role not in ('cashier', 'supervisor', 'receptionist', 'operations') then
    return jsonb_build_object('success', false, 'error', 'Managers can delete archived service-team accounts only.');
  end if;
  delete from public.users where id = p_id and lodge_id = p_lodge_id;
  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;
