-- LodgingOS F&B progressive activation: company-scoped module preferences.
--
-- Implements the activation contract in docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md:
-- - company-scoped fnb_module_preferences keyed by (lodge_id, module_key)
-- - get_fnb_module_preferences() resolves defaults + entitlement state
-- - set_fnb_module_preference() validates allowlist, lodge membership,
--   settings.manage capability, commercial entitlement, optimistic version
-- - disabling rejects unsafe in-progress state via explicit blockers
-- - activation is online + server-confirmed and audited
--
-- Activation is a company preference, not a licence grant. Feature RPCs keep
-- enforcing lodge/outlet/actor/capability/state/idempotency independently.

begin;

-- ── Preference table ──────────────────────────────────────────────────────
create table if not exists public.fnb_module_preferences (
  lodge_id uuid not null,
  module_key text not null,
  enabled boolean not null default false,
  version integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fnb_module_preferences_pkey primary key (lodge_id, module_key),
  constraint fnb_module_preferences_key_check check (
    module_key in (
      'reservations', 'recipes', 'purchasing', 'room-service', 'meal-plans',
      'food-safety', 'team', 'settlement', 'fnb-reports',
      'invoice-matching', 'demand-planning'
    )
  ),
  constraint fnb_module_preferences_version_check check (version >= 1)
);

create index if not exists fnb_module_preferences_lodge_idx
  on public.fnb_module_preferences (lodge_id);

alter table public.fnb_module_preferences enable row level security;

revoke all on table public.fnb_module_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.fnb_module_preferences to service_role;

-- ── Audit table (append-only) ─────────────────────────────────────────────
create table if not exists public.fnb_module_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  module_key text not null,
  enabled boolean not null,
  previous_enabled boolean,
  previous_version integer,
  new_version integer not null,
  actor_id uuid,
  actor_role text,
  created_at timestamptz not null default now()
);

create index if not exists fnb_module_audit_lodge_idx
  on public.fnb_module_audit (lodge_id, created_at desc);

alter table public.fnb_module_audit enable row level security;

revoke all on table public.fnb_module_audit from public, anon, authenticated;
grant select, insert on table public.fnb_module_audit to service_role;

-- ── Internal helpers ──────────────────────────────────────────────────────

-- Resolve the caller's lodge + actor from the desktop app session or the
-- linked Supabase Auth identity. Returns (lodge_id, user_id). Nulls mean
-- unauthenticated; callers must fail closed.
create or replace function public._fnb_resolve_caller(p_lodge_id uuid)
returns table (lodge_id uuid, user_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_session public.app_sessions%rowtype;
  v_lodge uuid;
  v_user uuid;
  v_auth uuid;
begin
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_lodge := v_session.lodge_id;
    v_user := v_session.user_id;
  else
    begin
      v_auth := public.app_authenticated_user_id();
    exception when undefined_function then
      v_auth := null;
    end;
    if v_auth is not null then
      select u.id, u.lodge_id into v_user, v_lodge
        from public.users u
       where u.auth_user_id = v_auth
         and coalesce(u.status, 'active') = 'active'
       order by u.created_at, u.id
       limit 1;
    end if;
  end if;

  if p_lodge_id is not null and v_lodge is not null and v_lodge <> p_lodge_id then
    -- Lodge mismatch: fail closed by returning the session lodge so the
    -- caller comparison rejects. Never silently re-scope to the request.
    lodge_id := v_lodge;
    user_id := v_user;
    return next;
    return;
  end if;

  lodge_id := coalesce(p_lodge_id, v_lodge);
  user_id := v_user;
  return next;
end;
$$;

revoke all on function public._fnb_resolve_caller(uuid) from public, anon, authenticated;

-- settings.manage equivalence: admin/manager/owner family unless an explicit
-- capability override revokes settings.manage_general. Mirrors the desktop
-- buildCapabilitySnapshot role profile without trusting client JSON.
create or replace function public._fnb_can_manage(p_lodge_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := '';
  v_status text := '';
  v_overrides jsonb := '{}'::jsonb;
begin
  if p_user_id is null or p_lodge_id is null then
    return false;
  end if;
  select lower(coalesce(u.role, '')), lower(coalesce(u.status, 'active')),
         coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_status, v_overrides
    from public.users u
   where u.id = p_user_id
     and u.lodge_id = p_lodge_id
   limit 1;
  if not found then
    return false;
  end if;
  if v_status <> 'active' then
    return false;
  end if;
  if lower(coalesce(v_overrides->>'settings.manage_general', 'true')) in ('false', '0', 'no') then
    return false;
  end if;
  return v_role in ('manager', 'admin', 'owner', 'super_admin', 'administrator');
end;
$$;

revoke all on function public._fnb_can_manage(uuid, uuid) from public, anon, authenticated;

-- Commercial entitlement for an F&B module. Activation never grants a
-- licence; enabling requires the underlying commercial feature, disabling
-- never requires it. FAIL-CLOSED: any entitlement-resolution failure returns
-- false, and _fnb_entitlement_state() distinguishes verified-denied from
-- unverified so reads stay truthful without ever permitting activation.
create or replace function public._fnb_module_required_feature(p_module_key text)
returns text
language sql
immutable
security definer
set search_path to 'public'
as $$
  select case p_module_key
    when 'reservations' then 'pos'
    when 'recipes' then 'inventory'
    when 'purchasing' then 'inventory'
    when 'room-service' then 'pos'
    when 'meal-plans' then 'pos'
    when 'food-safety' then 'pos'
    when 'team' then 'pos'
    when 'settlement' then 'reports'
    when 'fnb-reports' then 'reports'
    when 'invoice-matching' then 'inventory'
    when 'demand-planning' then 'inventory'
    else null
  end;
$$;

revoke all on function public._fnb_module_required_feature(text) from public, anon, authenticated;

-- 'entitled' | 'not_entitled' | 'unverified'. Never throws.
create or replace function public._fnb_entitlement_state(p_lodge_id uuid, p_module_key text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_required text := public._fnb_module_required_feature(p_module_key);
  v_entitlement jsonb;
  v_features jsonb;
  v_value text;
begin
  if v_required is null then
    return 'not_entitled';
  end if;
  begin
    v_entitlement := public.get_lodge_entitlement(p_lodge_id);
  exception when others then
    return 'unverified';
  end;
  begin
    v_features := coalesce(v_entitlement->'effective_features', '{}'::jsonb);
    v_value := v_features->>v_required;
  exception when others then
    return 'unverified';
  end;
  if v_value is null then
    -- Absent flag means the licence map could not certify the feature.
    return 'unverified';
  end if;
  if lower(v_value) in ('true', 't', '1') then
    return 'entitled';
  end if;
  return 'not_entitled';
end;
$$;

revoke all on function public._fnb_entitlement_state(uuid, text) from public, anon, authenticated;

create or replace function public._fnb_module_entitled(p_lodge_id uuid, p_module_key text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Fail closed: only a verified 'entitled' state permits activation.
  return public._fnb_entitlement_state(p_lodge_id, p_module_key) = 'entitled';
end;
$$;

revoke all on function public._fnb_module_entitled(uuid, text) from public, anon, authenticated;

-- Is the module both entitled AND switched on for this lodge? Used by every
-- F&B feature RPC so a previously enabled module stops serving new work the
-- moment its commercial entitlement is removed. Reads of retained history
-- stay available; only new operational work is gated.
create or replace function public._fnb_module_active(p_lodge_id uuid, p_module_key text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_enabled boolean := false;
begin
  if public._fnb_entitlement_state(p_lodge_id, p_module_key) <> 'entitled' then
    return false;
  end if;
  select coalesce(enabled, false) into v_enabled
    from public.fnb_module_preferences
   where lodge_id = p_lodge_id and module_key = p_module_key;
  return coalesce(v_enabled, false);
end;
$$;

revoke all on function public._fnb_module_active(uuid, text) from public, anon, authenticated;

-- Enforce the module gate inside feature RPCs. Returns NULL when active;
-- otherwise returns the machine-readable denial code the RPC must surface.
create or replace function public._fnb_require_module(p_lodge_id uuid, p_module_key text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_state text := public._fnb_entitlement_state(p_lodge_id, p_module_key);
  v_enabled boolean := false;
begin
  if v_state = 'unverified' then
    return 'ENTITLEMENT_UNVERIFIED';
  end if;
  if v_state <> 'entitled' then
    return 'NOT_ENTITLED';
  end if;
  select coalesce(enabled, false) into v_enabled
    from public.fnb_module_preferences
   where lodge_id = p_lodge_id and module_key = p_module_key;
  if coalesce(v_enabled, false) is not true then
    return 'MODULE_DISABLED';
  end if;
  return null;
end;
$$;

revoke all on function public._fnb_require_module(uuid, text) from public, anon, authenticated;

-- Server-side capability enforcement mirroring the desktop role profile.
-- An explicit boolean capability override wins (grant or revoke); otherwise
-- the role default applies. Unknown roles fail closed.
create or replace function public._fnb_has_capability(p_lodge_id uuid, p_user_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := '';
  v_status text := '';
  v_overrides jsonb := '{}'::jsonb;
  v_override text;
  v_default boolean := false;
begin
  if p_lodge_id is null or p_user_id is null or p_capability is null then
    return false;
  end if;
  select lower(coalesce(u.role, '')), lower(coalesce(u.status, 'active')),
         coalesce(u.capability_overrides, '{}'::jsonb)
    into v_role, v_status, v_overrides
    from public.users u
   where u.id = p_user_id and u.lodge_id = p_lodge_id
   limit 1;
  if not found or v_status <> 'active' then
    return false;
  end if;
  v_override := lower(coalesce(v_overrides->>p_capability, ''));
  if v_override in ('true', 't', '1') then
    return true;
  end if;
  if v_override in ('false', 'f', '0', 'no') then
    return false;
  end if;
  v_default := case p_capability
    when 'pos.view' then v_role in ('cashier','supervisor','manager','admin','owner','super_admin','administrator','receptionist','operations','finance')
    when 'pos.service' then v_role in ('cashier','supervisor','manager','admin','owner','super_admin','administrator')
    when 'pos.manage' then v_role in ('cashier','supervisor','manager','admin','owner','super_admin','administrator')
    when 'pos.menu_manage' then v_role in ('manager','admin','owner','super_admin','administrator')
    when 'pos.cashup' then v_role in ('supervisor','manager','admin','owner','super_admin','administrator')
    when 'reports.view' then v_role in ('supervisor','manager','admin','owner','super_admin','administrator','finance','receptionist')
    when 'inventory.view' then v_role in ('manager','admin','owner','super_admin','administrator','supervisor','operations','finance')
    when 'inventory.manage' then v_role in ('manager','admin','owner','super_admin','administrator')
    when 'expenses.view' then v_role in ('manager','admin','owner','super_admin','administrator','finance','receptionist')
    when 'expenses.manage' then v_role in ('manager','admin','owner','super_admin','administrator','finance')
    when 'staff.view' then v_role in ('manager','admin','owner','super_admin','administrator')
    when 'workforce_scheduling.view' then v_role in ('manager','admin','owner','super_admin','administrator')
    when 'settings.manage_general' then v_role in ('manager','admin','owner','super_admin','administrator')
    else false
  end;
  return v_default;
end;
$$;

revoke all on function public._fnb_has_capability(uuid, uuid, text) from public, anon, authenticated;

-- Outlet enforcement: the outlet must belong to the lodge, be active, and the
-- actor must be scoped to it (unless their role carries full POS access).
-- Returns NULL when allowed, otherwise a denial code.
create or replace function public._fnb_require_outlet(p_lodge_id uuid, p_user_id uuid, p_outlet_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := '';
  v_allowed uuid[];
  v_owner uuid;
  v_active boolean := false;
begin
  if p_outlet_id is null then
    return null;
  end if;
  select lodge_id, coalesce(is_active, true) into v_owner, v_active
    from public.outlets where id = p_outlet_id limit 1;
  if not found or v_owner is distinct from p_lodge_id then
    return 'OUTLET_SCOPE_DENIED';
  end if;
  if v_active is not true then
    return 'OUTLET_INACTIVE';
  end if;
  select lower(coalesce(u.role, '')), coalesce(u.allowed_outlet_ids, '{}'::uuid[])
    into v_role, v_allowed
    from public.users u
   where u.id = p_user_id and u.lodge_id = p_lodge_id limit 1;
  if v_role in ('manager','admin','owner','super_admin','administrator','receptionist','operations','finance') then
    return null;
  end if;
  -- Outlet-scoped roles (cashier, supervisor, …) must be assigned to the outlet.
  if v_allowed is null or not (p_outlet_id = any(v_allowed)) then
    return 'OUTLET_SCOPE_DENIED';
  end if;
  return null;
end;
$$;

revoke all on function public._fnb_require_outlet(uuid, uuid, uuid) from public, anon, authenticated;

-- Unsafe in-progress state that must block a disable until handed over.
-- Returns a jsonb array of {code, message, count}. Empty array = safe.
-- Every probe is guarded by to_regclass so this function survives lodges
-- whose optional tables predate a phase migration.
create or replace function public.fnb_module_disable_blockers(p_lodge_id uuid, p_module_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_blockers jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if p_lodge_id is null then
    return jsonb_build_array(jsonb_build_object('code', 'LODGE_REQUIRED', 'message', 'A lodge is required.', 'count', 0));
  end if;

  if p_module_key = 'reservations' and to_regclass('public.restaurant_reservations') is not null then
    execute 'select count(*)::integer from public.restaurant_reservations where lodge_id = $1 and status in (''booked'',''confirmed'',''waiting'') and reservation_date >= current_date'
      into v_count using p_lodge_id;
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESERVATIONS_OPEN', 'message', 'There are upcoming booked/confirmed reservations. Reassign or cancel them before disabling reservations.', 'count', v_count));
    end if;
    if to_regclass('public.restaurant_waitlist_entries') is not null then
      execute 'select count(*)::integer from public.restaurant_waitlist_entries where lodge_id = $1 and status in (''waiting'',''notified'')'
        into v_count using p_lodge_id;
      if v_count > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'WAITLIST_OPEN', 'message', 'There are guests on the waitlist. Seat or clear them before disabling reservations.', 'count', v_count));
      end if;
    end if;
  end if;

  if p_module_key = 'room-service' and to_regclass('public.fnb_room_service_orders') is not null then
    execute 'select count(*)::integer from public.fnb_room_service_orders where lodge_id = $1 and status in (''new'',''preparing'',''ready'',''dispatched'')'
      into v_count using p_lodge_id;
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'ROOM_SERVICE_OPEN', 'message', 'There are in-progress room-service orders. Deliver or cancel them before disabling room service.', 'count', v_count));
    end if;
  end if;

  if p_module_key = 'food-safety' and to_regclass('public.fnb_corrective_actions') is not null then
    execute 'select count(*)::integer from public.fnb_corrective_actions where lodge_id = $1 and status in (''open'',''in_progress'')'
      into v_count using p_lodge_id;
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'FOOD_SAFETY_OPEN', 'message', 'There are open food-safety corrective actions. Close them before disabling food safety.', 'count', v_count));
    end if;
  end if;

  if p_module_key = 'invoice-matching' and to_regclass('public.fnb_supplier_invoices') is not null then
    execute 'select count(*)::integer from public.fnb_supplier_invoices where lodge_id = $1 and status in (''draft'',''pending_approval'')'
      into v_count using p_lodge_id;
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'INVOICE_MATCHING_PENDING', 'message', 'There are supplier invoices awaiting three-way matching approval. Approve or void them before disabling.', 'count', v_count));
    end if;
  end if;

  if p_module_key = 'settlement' and to_regclass('public.pos_cashup_sessions') is not null then
    begin
      execute 'select count(*)::integer from public.pos_cashup_sessions where lodge_id = $1 and coalesce(status, '''') not in (''closed'',''approved'',''reconciled'')'
        into v_count using p_lodge_id;
      if v_count > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'CASHUP_OPEN', 'message', 'There are open cash-up sessions. Close them before disabling settlement controls.', 'count', v_count));
      end if;
    exception when undefined_column then
      -- Older cash-up shape without status: fall back to no blocker.
      v_count := 0;
    end;
  end if;

  return v_blockers;
end;
$$;

revoke all on function public.fnb_module_disable_blockers(uuid, text) from public;
grant execute on function public.fnb_module_disable_blockers(uuid, text) to anon, authenticated, service_role;

-- ── Read contract ─────────────────────────────────────────────────────────
-- Resolves defaults + entitlement state for the caller's lodge. Never trusts
-- the toggle for entitlement; every row carries its own entitled/can_manage.
create or replace function public.get_fnb_module_preferences(p_lodge_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_can_manage boolean := false;
  v_modules jsonb := '[]'::jsonb;
  v_keys text[] := array['reservations','recipes','purchasing','room-service','meal-plans','food-safety','team','settlement','fnb-reports','invoice-matching','demand-planning'];
  v_key text;
  v_pref public.fnb_module_preferences%rowtype;
  v_entitled boolean;
  v_state text;
  v_reason text;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;

  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.', 'modules', '[]'::jsonb);
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.', 'modules', '[]'::jsonb);
  end if;

  v_can_manage := public._fnb_can_manage(v_lodge, v_user);

  foreach v_key in array v_keys loop
    select * into v_pref from public.fnb_module_preferences where lodge_id = v_lodge and module_key = v_key;
    -- Fail closed: only a verified 'entitled' state counts as entitled.
    -- 'unverified' is reported explicitly so the UI keeps the last confirmed
    -- state instead of permitting activation while licensing is unknown.
    v_state := public._fnb_entitlement_state(v_lodge, v_key);
    v_entitled := (v_state = 'entitled');
    if v_state = 'unverified' then
      v_modules := v_modules || jsonb_build_array(jsonb_build_object(
        'module_key', v_key,
        'enabled', false,
        'entitled', false,
        'can_manage', v_can_manage,
        'reason', 'entitlement_unverified',
        'version', coalesce(v_pref.version, 0)
      ));
    elsif v_pref.module_key is null then
      v_reason := case
        when not v_entitled then 'not_entitled'
        when not v_can_manage then 'ask_administrator'
        else 'default_off'
      end;
      v_modules := v_modules || jsonb_build_array(jsonb_build_object(
        'module_key', v_key,
        'enabled', false,
        'entitled', v_entitled,
        'can_manage', v_can_manage,
        'reason', v_reason,
        'version', 0
      ));
    else
      -- A previously enabled module whose entitlement was removed must not
      -- stay exposed: report it as not entitled so the UI hides it and the
      -- feature RPCs (which re-check independently) refuse new work.
      v_reason := case
        when v_entitled and v_pref.enabled then 'enabled'
        when not v_entitled then 'not_entitled'
        when not v_can_manage then 'ask_administrator'
        else 'disabled'
      end;
      v_modules := v_modules || jsonb_build_array(jsonb_build_object(
        'module_key', v_key,
        'enabled', (v_pref.enabled and v_entitled),
        'entitled', v_entitled,
        'can_manage', v_can_manage,
        'reason', v_reason,
        'version', v_pref.version,
        'updated_at', v_pref.updated_at
      ));
    end if;
  end loop;

  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'modules', v_modules, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_module_preferences(uuid) from public;
grant execute on function public.get_fnb_module_preferences(uuid) to anon, authenticated, service_role;

-- ── Write contract ────────────────────────────────────────────────────────
create or replace function public.set_fnb_module_preference(
  p_lodge_id uuid,
  p_module_key text,
  p_enabled boolean,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_key text := lower(btrim(coalesce(p_module_key, '')));
  v_existing public.fnb_module_preferences%rowtype;
  v_can_manage boolean := false;
  v_entitled boolean := false;
  v_new_version integer;
  v_blockers jsonb;
begin
  if v_key not in ('reservations','recipes','purchasing','room-service','meal-plans','food-safety','team','settlement','fnb-reports','invoice-matching','demand-planning') then
    return jsonb_build_object('success', false, 'code', 'UNKNOWN_MODULE', 'error', 'Unknown F&B module.');
  end if;
  if p_enabled is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A target state (enabled/disabled) is required.');
  end if;

  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;

  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;

  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;
  if coalesce(v_role, '') not in ('manager','admin','owner','super_admin','administrator') then
    -- Still allow the helper to narrow via overrides, but the role gate is
    -- the primary boundary; overrides can only remove access.
    v_can_manage := false;
  else
    v_can_manage := public._fnb_can_manage(v_lodge, v_user);
  end if;
  if not v_can_manage then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED',
      'error', 'Only a lodge administrator can change F&B modules. Ask an administrator.');
  end if;

  -- Fail closed: enabling requires a verified entitled state. An unverified
  -- licence map must never permit activation.
  if p_enabled then
    if public._fnb_entitlement_state(v_lodge, v_key) = 'unverified' then
      return jsonb_build_object('success', false, 'code', 'ENTITLEMENT_UNVERIFIED',
        'error', 'The licence for this module could not be verified. Reconnect and retry — activation is blocked until licensing confirms.');
    end if;
    v_entitled := public._fnb_module_entitled(v_lodge, v_key);
    if not v_entitled then
      return jsonb_build_object('success', false, 'code', 'NOT_ENTITLED',
        'error', 'This lodge does not include this module. Request access to enable it.');
    end if;
  end if;

  select * into v_existing from public.fnb_module_preferences
   where lodge_id = v_lodge and module_key = v_key
   for update;

  if v_existing.module_key is not null and p_expected_version is not null
     and v_existing.version <> p_expected_version then
    return jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT',
      'error', 'This module was changed by another administrator. Reload and retry.',
      'server_version', v_existing.version,
      'server_enabled', v_existing.enabled);
  end if;

  if not p_enabled then
    v_blockers := public.fnb_module_disable_blockers(v_lodge, v_key);
    if jsonb_array_length(coalesce(v_blockers, '[]'::jsonb)) > 0 then
      return jsonb_build_object('success', false, 'code', 'DISABLE_BLOCKED',
        'error', 'This module has in-progress work that needs a handover before it can be disabled.',
        'blockers', v_blockers);
    end if;
  end if;

  if v_existing.module_key is null then
    v_new_version := 1;
    insert into public.fnb_module_preferences (lodge_id, module_key, enabled, version, updated_by)
    values (v_lodge, v_key, p_enabled, v_new_version, v_user);
  else
    v_new_version := v_existing.version + 1;
    update public.fnb_module_preferences
       set enabled = p_enabled, version = v_new_version, updated_by = v_user, updated_at = now()
     where lodge_id = v_lodge and module_key = v_key;
  end if;

  insert into public.fnb_module_audit (lodge_id, module_key, enabled, previous_enabled, previous_version, new_version, actor_id, actor_role)
  values (v_lodge, v_key, p_enabled, v_existing.enabled, v_existing.version, v_new_version, v_user, nullif(v_role, ''));

  return jsonb_build_object(
    'success', true,
    'lodge_id', v_lodge,
    'module_key', v_key,
    'enabled', p_enabled,
    'entitled', public._fnb_module_entitled(v_lodge, v_key),
    'can_manage', true,
    'reason', case when p_enabled then 'enabled' else 'disabled' end,
    'version', v_new_version
  );
end;
$$;

revoke all on function public.set_fnb_module_preference(uuid, text, boolean, integer) from public;
grant execute on function public.set_fnb_module_preference(uuid, text, boolean, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
