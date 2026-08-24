-- Assigned-waiter ownership for open bar tabs.
--
-- The existing tab bodies remain the financial source of truth.  This
-- migration puts an ownership boundary in front of those bodies and adds one
-- atomic, retry-safe waiter-transfer operation.  The application actor is the
-- only identity accepted as the assigned waiter; a shared-terminal manager
-- cannot impersonate a PIN-selected waiter without a server-issued operator
-- identity, so that path fails closed.

begin;

-- Opaque proof issued only by the PIN-verified shared Till activation RPC.
-- The plaintext token never belongs in renderer state; only its SHA-256 hash
-- is persisted and the main-process Till session retains the token.
create table if not exists public.pos_till_operator_proofs (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  lodge_id uuid not null,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  staff_id uuid not null references public.users(id) on delete restrict,
  pos_shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists pos_till_operator_proofs_scope_idx
  on public.pos_till_operator_proofs(lodge_id, outlet_id, staff_id, pos_shift_id, expires_at);
alter table public.pos_till_operator_proofs enable row level security;
revoke all on public.pos_till_operator_proofs from anon, authenticated;

create or replace function public._pos_operator_proof_staff(
  p_token text,
  p_lodge_id uuid,
  p_outlet_id uuid,
  p_shift_id uuid,
  p_app_actor uuid
)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select p.staff_id
    from public.pos_till_operator_proofs p
   where p.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
     and p.lodge_id = p_lodge_id
     and p.outlet_id = p_outlet_id
     and p.pos_shift_id = p_shift_id
     and p.created_by = p_app_actor
     and p.expires_at > now()
   limit 1
$$;
revoke all on function public._pos_operator_proof_staff(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_operator_proof_staff(text, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public._pos_tab_is_bar_scope(p_lodge_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.settings s
     where s.lodge_id = p_lodge_id
       and (
         coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only'
         or coalesce(s.operating_profile->>'commercial_package_key', '') = 'bar_pos'
       )
  )
$$;
revoke all on function public._pos_tab_is_bar_scope(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_tab_is_bar_scope(uuid) to service_role;

create table if not exists public.pos_tab_waiter_transfer_operations (
  lodge_id uuid not null,
  operation_id uuid not null,
  tab_id uuid not null references public.pos_tabs(id) on delete restrict,
  from_waiter_id uuid not null references public.users(id) on delete restrict,
  to_waiter_id uuid not null references public.users(id) on delete restrict,
  from_shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  to_shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  expected_tab_version integer not null,
  resulting_tab_version integer not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (lodge_id, operation_id)
);
create index if not exists pos_tab_waiter_transfer_tab_idx
  on public.pos_tab_waiter_transfer_operations(lodge_id, tab_id, created_at desc);
alter table public.pos_tab_waiter_transfer_operations enable row level security;
revoke all on public.pos_tab_waiter_transfer_operations from anon, authenticated;

create table if not exists public.pos_tab_waiter_transfer_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  tab_id uuid not null references public.pos_tabs(id) on delete restrict,
  operation_id uuid not null,
  from_waiter_id uuid not null references public.users(id) on delete restrict,
  to_waiter_id uuid not null references public.users(id) on delete restrict,
  from_shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  to_shift_id uuid not null references public.pos_shifts(id) on delete restrict,
  actor_id uuid not null references public.users(id) on delete restrict,
  expected_tab_version integer not null,
  resulting_tab_version integer not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  notes text,
  created_at timestamptz not null default now(),
  unique (lodge_id, operation_id)
);
create index if not exists pos_tab_waiter_transfer_audit_tab_idx
  on public.pos_tab_waiter_transfer_audit(lodge_id, tab_id, created_at desc);
alter table public.pos_tab_waiter_transfer_audit enable row level security;
revoke all on public.pos_tab_waiter_transfer_audit from anon, authenticated;

create or replace function public.prevent_pos_tab_waiter_transfer_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Assigned-waiter transfer evidence is immutable.' using errcode = '55006';
end;
$$;

drop trigger if exists pos_tab_waiter_transfer_audit_immutable
  on public.pos_tab_waiter_transfer_audit;
create trigger pos_tab_waiter_transfer_audit_immutable
  before update or delete on public.pos_tab_waiter_transfer_audit
  for each row execute function public.prevent_pos_tab_waiter_transfer_mutation();

-- Return an actionable reason instead of trusting a client-side shift list.
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
  if not exists (
    select 1
      from public.user_lodge_roles r
     where r.user_id = p_waiter_id
       and r.lodge_id = p_lodge_id
       and lower(r.role) in ('waiter', 'bar', 'bartender', 'cashier')
  ) and not exists (
    select 1
      from public.users u
     where u.id = p_waiter_id
       and u.lodge_id = p_lodge_id
       and lower(coalesce(u.role, '')) in ('waiter', 'bar', 'bartender', 'cashier')
  ) then
    return 'The selected staff member is not authorized as a serving waiter.';
  end if;

  select * into v_shift
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

-- Renew the server-side proof together with the local Shift-mode session. An
-- expired proof, closed Till, or ended attendance can never be resurrected.
create or replace function public.touch_pos_till_operator_proof(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(payload->>'operator_proof', '');
  v_lodge uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_staff uuid := nullif(payload->>'staff_id', '')::uuid;
  v_shift uuid := nullif(payload->>'shift_id', '')::uuid;
  v_actor uuid := public.app_current_user_id();
  v_hash text;
  v_proof public.pos_till_operator_proofs%rowtype;
  v_error text;
  v_minutes integer;
begin
  if v_token is null or v_lodge is null or v_outlet is null or v_staff is null or v_shift is null or v_actor is null then
    return jsonb_build_object('success', false, 'code', 'operator_proof_required', 'error', 'A live shared Till operator proof is required. Unlock Till again.');
  end if;
  if not public.app_lodge_access(v_lodge) then
    return jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'Access denied for this lodge.');
  end if;
  v_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');
  select * into v_proof
    from public.pos_till_operator_proofs
   where token_hash = v_hash
     and lodge_id = v_lodge
     and outlet_id = v_outlet
     and staff_id = v_staff
     and pos_shift_id = v_shift
     and created_by = v_actor
   for update;
  if not found or v_proof.expires_at <= now() then
    return jsonb_build_object('success', false, 'code', 'operator_proof_expired', 'error', 'The shared Till proof expired. Unlock Till again before continuing.');
  end if;
  v_error := public._pos_tab_active_waiter_error(v_lodge, v_outlet, v_staff, v_shift);
  if v_error is not null then
    return jsonb_build_object('success', false, 'code', 'operator_shift_required', 'error', v_error);
  end if;
  select greatest(5, least(240, coalesce(nullif(s.operating_profile->'till_operator_policy'->>'inactivity_minutes', '')::integer, 30)))
    into v_minutes
    from public.settings s
   where s.lodge_id = v_lodge
   limit 1;
  v_minutes := coalesce(v_minutes, 30);
  update public.pos_till_operator_proofs
     set expires_at = now() + make_interval(mins => v_minutes)
   where token_hash = v_hash;
  return jsonb_build_object('success', true, 'expires_at', now() + make_interval(mins => v_minutes));
end;
$$;

revoke all on function public.touch_pos_till_operator_proof(jsonb) from public, authenticated;
grant execute on function public.touch_pos_till_operator_proof(jsonb) to anon, authenticated, service_role;

-- Preserve the latest server-derived financial body and wrap it with owner
-- checks.  This also prevents a waiter from changing ownership through a
-- normal save; transfer_pos_tab_waiter is the only ownership transition.
alter function public.upsert_pos_tab(jsonb)
  rename to upsert_pos_tab_unowned;

create or replace function public.upsert_pos_tab(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(payload->>'id', '')::uuid;
  v_lodge uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_waiter uuid := nullif(payload->>'waiter_id', '')::uuid;
  v_shift uuid := nullif(payload->>'shift_id', '')::uuid;
  v_expected integer := nullif(payload->>'expected_version', '')::integer;
  v_actor uuid := public.app_current_user_id();
  v_operator uuid;
  v_operator_proof text := nullif(payload->>'_operator_proof', '');
  v_existing public.pos_tabs%rowtype;
  v_waiter_error text;
begin
  if v_lodge is null or not public.app_lodge_access(v_lodge) then
    return jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'Access denied for this lodge.');
  end if;
  if v_actor is null then
    return jsonb_build_object('success', false, 'code', 'authentication_required', 'error', 'Sign in as the assigned waiter before changing this tab.');
  end if;
  perform public.app_require_lodge_role(v_lodge, array['waiter','bar','bartender','cashier','supervisor','manager','admin','super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge, v_outlet);
  if not public._pos_tab_is_bar_scope(v_lodge) then
    return public.upsert_pos_tab_unowned(payload - '_operator_proof');
  end if;
  if v_operator_proof is not null then
    v_operator := public._pos_operator_proof_staff(v_operator_proof, v_lodge, v_outlet, v_shift, v_actor);
    if v_operator is null then
      return jsonb_build_object('success', false, 'code', 'operator_proof_invalid', 'error', 'The shared Till operator proof is missing or expired. Unlock Till again before changing this tab.');
    end if;
  else
    v_operator := v_actor;
  end if;

  if v_id is not null then
    select * into v_existing
      from public.pos_tabs
     where id = v_id and lodge_id = v_lodge
     for update;
    if found then
      if v_existing.waiter_id is null or v_existing.waiter_id is distinct from v_operator then
        return jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', 'Only the assigned waiter can edit or close this tab. Ask that waiter to transfer it first.');
      end if;
      if v_waiter is distinct from v_existing.waiter_id then
        return jsonb_build_object('success', false, 'code', 'waiter_transfer_required', 'error', 'Changing the assigned waiter requires the explicit Transfer waiter action.');
      end if;
      if v_expected is null then
        return jsonb_build_object('success', false, 'code', 'tab_version_required', 'error', 'Refresh this tab before saving; its current version is required.');
      end if;
    end if;
  end if;

  v_waiter_error := public._pos_tab_active_waiter_error(v_lodge, v_outlet, v_waiter, v_shift);
  if v_waiter_error is not null then
    return jsonb_build_object('success', false, 'code', 'waiter_shift_required', 'error', v_waiter_error);
  end if;
  if v_waiter is distinct from v_operator then
    return jsonb_build_object('success', false, 'code', 'actor_waiter_mismatch', 'error', 'Only the assigned waiter or its verified Till operator proof can change this tab.');
  end if;

  return public.upsert_pos_tab_unowned(payload - '_operator_proof');
end;
$$;

revoke all on function public.upsert_pos_tab_unowned(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_pos_tab_unowned(jsonb) to service_role;
revoke all on function public.upsert_pos_tab(jsonb) from public, authenticated;
grant execute on function public.upsert_pos_tab(jsonb) to anon, authenticated, service_role;

-- Preserve the existing status body, but make every status transition owner
-- bound.  Server-side ownership applies to hold/settle/close/cancel and does
-- not depend on whether a renderer happens to display a button.
alter function public.update_pos_tab_status(uuid, text, text)
  rename to update_pos_tab_status_unowned;

create or replace function public.update_pos_tab_status(
  p_tab_id uuid,
  p_status text,
  p_notes text,
  p_operator_proof text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tab public.pos_tabs%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_operator uuid;
  v_error text;
begin
  select * into v_tab from public.pos_tabs where id = p_tab_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'tab_not_found', 'error', 'Open table tab not found. Refresh open tabs and try again.');
  end if;
  perform public.app_require_lodge_role(v_tab.lodge_id, array['waiter','bar','bartender','cashier','supervisor','manager','admin','super_admin']);
  perform public.app_require_pos_outlet_access(v_tab.lodge_id, v_tab.outlet_id);
  if not public._pos_tab_is_bar_scope(v_tab.lodge_id) then
    return public.update_pos_tab_status_unowned(p_tab_id, p_status, p_notes);
  end if;
  if p_operator_proof is not null then
    v_operator := public._pos_operator_proof_staff(p_operator_proof, v_tab.lodge_id, v_tab.outlet_id, v_tab.shift_id, v_actor);
    if v_operator is null then
      return jsonb_build_object('success', false, 'code', 'operator_proof_invalid', 'error', 'The shared Till operator proof is missing or expired. Unlock Till again before changing this tab.');
    end if;
  else
    v_operator := v_actor;
  end if;
  if v_operator is null or v_tab.waiter_id is distinct from v_operator then
    return jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', 'Only the assigned waiter or its verified Till operator proof can change this tab. Ask that waiter to transfer it first.');
  end if;
  v_error := public._pos_tab_active_waiter_error(v_tab.lodge_id, v_tab.outlet_id, v_tab.waiter_id, v_tab.shift_id);
  if v_error is not null then
    return jsonb_build_object('success', false, 'code', 'waiter_shift_required', 'error', v_error);
  end if;
  return public.update_pos_tab_status_unowned(p_tab_id, p_status, p_notes);
end;
$$;

revoke all on function public.update_pos_tab_status_unowned(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_pos_tab_status_unowned(uuid, text, text) to service_role;
-- Keep the certified three-argument caller contract for existing restaurant
-- clients while exposing the proof-bearing overload to the Bar desktop path.
create or replace function public.update_pos_tab_status(
  p_tab_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.update_pos_tab_status(p_tab_id, p_status, p_notes, null::text)
$$;

revoke all on function public.update_pos_tab_status(uuid, text, text) from public, authenticated;
grant execute on function public.update_pos_tab_status(uuid, text, text) to anon, authenticated, service_role;
revoke all on function public.update_pos_tab_status(uuid, text, text, text) from public, authenticated;
grant execute on function public.update_pos_tab_status(uuid, text, text, text) to anon, authenticated, service_role;

-- One atomic ownership transfer.  The advisory lock serializes the operation
-- key before the idempotency lookup, so concurrent retries return the stored
-- result instead of racing into a unique violation.
create or replace function public.transfer_pos_tab_waiter(
  p_tab_id uuid,
  p_target_waiter_id uuid,
  p_target_shift_id uuid,
  p_operation_id uuid,
  p_expected_tab_version integer,
  p_notes text default null,
  p_operator_proof text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tab public.pos_tabs%rowtype;
  v_target public.users%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_operator uuid;
  v_hash text;
  v_operation public.pos_tab_waiter_transfer_operations%rowtype;
  v_result jsonb;
  v_error text;
  v_target_name text;
  v_from_shift_id uuid;
  v_before_snapshot jsonb;
  v_lodge uuid;
begin
  if p_operation_id is null or p_tab_id is null or p_target_waiter_id is null or p_target_shift_id is null then
    return jsonb_build_object('success', false, 'code', 'invalid_transfer', 'error', 'Tab, target waiter, target shift, and a stable transfer key are required.');
  end if;
  if p_expected_tab_version is null or p_expected_tab_version < 1 then
    return jsonb_build_object('success', false, 'code', 'tab_version_required', 'error', 'Refresh this tab and include its current version before transferring it.');
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    return jsonb_build_object('success', false, 'code', 'invalid_transfer', 'error', 'Transfer notes must be 1000 characters or fewer.');
  end if;

  -- The hash includes every caller-controlled field, including null notes.
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'tab_id', p_tab_id,
    'target_waiter_id', p_target_waiter_id,
    'target_shift_id', p_target_shift_id,
    'expected_tab_version', p_expected_tab_version,
    'notes', p_notes
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('pos-tab-waiter-transfer:' || p_operation_id::text, 0));

  -- Lock and authorize the tab before consulting the operation row. A known
  -- operation UUID must never disclose a stored result to an actor who no
  -- longer owns the current tab (or to an actor from another outlet/lodge).
  select * into v_tab from public.pos_tabs where id = p_tab_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'tab_not_found', 'error', 'Open table tab not found. Refresh open tabs and try again.');
  end if;
  v_lodge := v_tab.lodge_id;
  perform public.app_require_lodge_role(v_tab.lodge_id, array['waiter','bar','bartender','cashier','supervisor','manager','admin','super_admin']);
  perform public.app_require_pos_outlet_access(v_tab.lodge_id, v_tab.outlet_id);
  if not public._pos_tab_is_bar_scope(v_tab.lodge_id) then
    return jsonb_build_object('success', false, 'code', 'bar_scope_required', 'error', 'Waiter transfer is available only for Bar Open Tabs.');
  end if;
  select * into v_operation
    from public.pos_tab_waiter_transfer_operations
   where lodge_id = v_lodge
     and operation_id = p_operation_id
   for update;
  if found then
    if v_operation.tab_id is distinct from p_tab_id or v_operation.payload_hash is distinct from v_hash then
      return jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'error', 'This transfer key was already used for different tab or waiter details.');
    end if;
    if p_operator_proof is not null then
      v_operator := public._pos_operator_proof_staff(p_operator_proof, v_operation.lodge_id, v_tab.outlet_id, v_operation.from_shift_id, v_actor);
      if v_operator is null then
        return jsonb_build_object('success', false, 'code', 'operator_proof_invalid', 'error', 'The shared Till operator proof is missing or expired. Unlock Till again before retrying this transfer.');
      end if;
    else
      v_operator := v_actor;
    end if;
    if v_operator is null or v_operator is distinct from v_operation.from_waiter_id then
      return jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', 'Only the waiter who initiated this transfer, or its verified Till operator proof, can retry it.');
    end if;
    return v_operation.result || jsonb_build_object('replayed', true);
  end if;

  if p_operator_proof is not null then
    v_operator := public._pos_operator_proof_staff(p_operator_proof, v_tab.lodge_id, v_tab.outlet_id, v_tab.shift_id, v_actor);
    if v_operator is null then
      return jsonb_build_object('success', false, 'code', 'operator_proof_invalid', 'error', 'The shared Till operator proof is missing or expired. Unlock Till again before transferring this tab.');
    end if;
  else
    v_operator := v_actor;
  end if;
  if v_operator is null or v_tab.waiter_id is distinct from v_operator then
    return jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', 'Only the currently assigned waiter or its verified Till operator proof can transfer this tab.');
  end if;
  v_error := public._pos_tab_active_waiter_error(v_tab.lodge_id, v_tab.outlet_id, v_tab.waiter_id, v_tab.shift_id);
  if v_error is not null then
    return jsonb_build_object('success', false, 'code', 'waiter_shift_required', 'error', v_error);
  end if;

  if v_tab.waiter_id = p_target_waiter_id then
    return jsonb_build_object('success', false, 'code', 'invalid_transfer', 'error', 'Choose another active waiter for the transfer.');
  end if;
  if v_tab.tab_version <> p_expected_tab_version then
    return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before transferring.', 'tab', to_jsonb(v_tab));
  end if;

  v_error := public._pos_tab_active_waiter_error(v_tab.lodge_id, v_tab.outlet_id, p_target_waiter_id, p_target_shift_id);
  if v_error is not null then
    return jsonb_build_object('success', false, 'code', 'target_waiter_shift_required', 'error', v_error);
  end if;

  v_from_shift_id := v_tab.shift_id;
  v_before_snapshot := to_jsonb(v_tab);

  select * into v_target from public.users where id = p_target_waiter_id and lodge_id = v_tab.lodge_id for key share;
  v_target_name := coalesce(nullif(btrim(v_target.name), ''), v_target.email, v_tab.waiter_name);
  update public.pos_tabs
     set waiter_id = p_target_waiter_id,
         waiter_name = v_target_name,
         shift_id = p_target_shift_id,
         updated_at = now(),
         tab_version = tab_version + 1
   where id = v_tab.id
   returning * into v_tab;

  v_result := jsonb_build_object(
    'success', true,
    'tab', to_jsonb(v_tab),
    'operation_id', p_operation_id,
    'from_waiter_id', v_operator,
    'to_waiter_id', p_target_waiter_id,
    'from_shift_id', v_from_shift_id,
    'to_shift_id', p_target_shift_id
  );
  -- v_tab.shift_id now contains the target; retain the source in the audit
  -- row from the locked pre-update snapshot via the operation arguments.
  insert into public.pos_tab_waiter_transfer_operations(
    lodge_id, operation_id, tab_id, from_waiter_id, to_waiter_id,
    from_shift_id, to_shift_id, expected_tab_version, resulting_tab_version,
    payload_hash, result, created_by
  ) values (
    v_tab.lodge_id, p_operation_id, v_tab.id, v_operator, p_target_waiter_id,
    v_from_shift_id, p_target_shift_id,
    p_expected_tab_version, v_tab.tab_version, v_hash, v_result, v_actor
  );
  insert into public.pos_tab_waiter_transfer_audit(
    lodge_id, outlet_id, tab_id, operation_id, from_waiter_id, to_waiter_id,
    from_shift_id, to_shift_id, actor_id, expected_tab_version,
    resulting_tab_version, payload_hash, notes
  ) values (
    v_tab.lodge_id, v_tab.outlet_id, v_tab.id, p_operation_id, v_operator,
    p_target_waiter_id, v_from_shift_id,
    p_target_shift_id, v_actor, p_expected_tab_version, v_tab.tab_version,
    v_hash, p_notes
  );
  insert into public.pos_audit_log(
    lodge_id, outlet_id, actor_id, operator_id, action, entity_type, entity_id,
    idempotency_key, before_snapshot, after_snapshot, details, created_at
  ) values (
    v_tab.lodge_id, v_tab.outlet_id, v_actor, v_operator,
    'tab_waiter_transferred', 'pos_tab', v_tab.id, p_operation_id::text,
    v_before_snapshot,
    to_jsonb(v_tab),
    jsonb_build_object('from_waiter_id', v_operator, 'to_waiter_id', p_target_waiter_id, 'from_shift_id', v_from_shift_id, 'to_shift_id', p_target_shift_id, 'operator_proof_used', p_operator_proof is not null, 'notes', p_notes),
    now()
  );
  return v_result;
end;
$$;

revoke all on function public.transfer_pos_tab_waiter(uuid, uuid, uuid, uuid, integer, text, text)
  from public, authenticated;
grant execute on function public.transfer_pos_tab_waiter(uuid, uuid, uuid, uuid, integer, text, text)
  to anon, authenticated, service_role;

-- Settling a tab through the authoritative order RPC is also a tab mutation.
-- Add the same owner/current-shift proof immediately before that RPC claims its
-- financial idempotency operation. The rewrite is forward-only and refuses to
-- install if a later migration has materially changed the known contract.
create or replace function public._pos_tab_settlement_owner_error(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tab_id uuid := nullif(p_payload->>'tab_id', '')::uuid;
  v_lodge uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_outlet uuid := nullif(p_payload->>'outlet_id', '')::uuid;
  v_tab public.pos_tabs%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_operator uuid;
  v_operator_proof text := nullif(p_payload->>'_operator_proof', '');
  v_error text;
begin
  if v_tab_id is null then
    return null;
  end if;
  select * into v_tab
    from public.pos_tabs
   where id = v_tab_id and lodge_id = v_lodge
   for update;
  if not found then
    return 'The selected open tab is missing or belongs to another lodge.';
  end if;
  if not public._pos_tab_is_bar_scope(v_tab.lodge_id) then
    return null;
  end if;
  if v_operator_proof is not null then
    v_operator := public._pos_operator_proof_staff(v_operator_proof, v_tab.lodge_id, v_tab.outlet_id, v_tab.shift_id, v_actor);
    if v_operator is null then return 'The shared Till operator proof is missing or expired. Unlock Till again before settling this tab.'; end if;
  else
    v_operator := v_actor;
  end if;
  if v_tab.waiter_id is null or v_tab.waiter_id is distinct from v_operator then
    return 'Only the assigned waiter can settle this tab. Ask that waiter to transfer it first.';
  end if;
  if v_tab.outlet_id is distinct from v_outlet then
    return 'The selected tab belongs to another outlet. Refresh open tabs before settling it.';
  end if;
  v_error := public._pos_tab_active_waiter_error(v_tab.lodge_id, v_tab.outlet_id, v_tab.waiter_id, v_tab.shift_id);
  return v_error;
end;
$$;

revoke all on function public._pos_tab_settlement_owner_error(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public._pos_tab_settlement_owner_error(jsonb) to service_role;

do $do$
declare
  v_definition text;
  v_begin_pos integer;
  v_hash_pos integer;
  v_claim_occurrences integer;
  v_marker text := 'v_request_hash :=';
  v_guard text := $guard$  v_tab_owner_error := public._pos_tab_settlement_owner_error(payload);
  IF v_tab_owner_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'tab_not_owned', 'error', v_tab_owner_error);
  END IF;
  payload := payload - '_operator_proof';
$guard$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  v_claim_occurrences := (length(v_definition) - length(replace(lower(v_definition), '_claim_financial_operation', ''))) / length('_claim_financial_operation');
  if v_claim_occurrences <> 1 then
    raise exception 'create_pos_order_v3 financial-claim contract is ambiguous or missing';
  end if;
  v_begin_pos := strpos(lower(v_definition), E'\nbegin');
  if v_begin_pos = 0 then
    raise exception 'create_pos_order_v3 declaration/body boundary is missing';
  end if;
  v_definition := substr(v_definition, 1, v_begin_pos - 1)
    || E'\n  v_tab_owner_error text;'
    || substr(v_definition, v_begin_pos);
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 request-hash anchor is ambiguous or missing';
  end if;
  v_hash_pos := strpos(v_definition, v_marker);
  v_definition := substr(v_definition, 1, v_hash_pos - 1)
    || v_guard
    || substr(v_definition, v_hash_pos);
  execute v_definition;
end
$do$;

-- Bill splitting closes the source tab and creates/updates other tabs in one
-- RPC. Keep its existing atomic/idempotent contract, but require the source
-- assigned waiter and a live proof of that waiter's Till/attendance.
do $do$
declare
  v_definition text;
  v_old text := $old$v_source public.pos_tabs%rowtype;v_existing record;$old$;
  v_new text := $new$v_source public.pos_tabs%rowtype;v_existing record;v_actor uuid:=public.app_current_user_id();v_operator uuid;v_owner_error text;$new$;
  v_guard_old text := $old$  perform public.app_require_lodge_role(v_source.lodge_id,array['cashier','supervisor','manager','admin','super_admin']); perform public.app_require_pos_outlet_access(v_source.lodge_id,v_source.outlet_id);$old$;
  v_guard_new text := $new$  perform public.app_require_lodge_role(v_source.lodge_id,array['waiter','bar','bartender','cashier','supervisor','manager','admin','super_admin']); perform public.app_require_pos_outlet_access(v_source.lodge_id,v_source.outlet_id);
  if public._pos_tab_is_bar_scope(v_source.lodge_id) then
    if payload ? '_operator_proof' then v_operator:=public._pos_operator_proof_staff(nullif(payload->>'_operator_proof',''),v_source.lodge_id,v_source.outlet_id,v_source.shift_id,v_actor); if v_operator is null then return jsonb_build_object('success',false,'code','operator_proof_invalid','error','The shared Till operator proof is missing or expired. Unlock Till again before splitting this tab.'); end if; else v_operator:=v_actor; end if;
    if v_operator is null or v_source.waiter_id is distinct from v_operator then return jsonb_build_object('success',false,'code','tab_not_owned','error','Only the assigned waiter or its verified Till operator proof can split this tab.'); end if;
    v_owner_error:=public._pos_tab_active_waiter_error(v_source.lodge_id,v_source.outlet_id,v_operator,v_source.shift_id);
    if v_owner_error is not null then return jsonb_build_object('success',false,'code','waiter_shift_required','error',v_owner_error); end if;
  end if;
  payload := payload - '_operator_proof';$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.split_pos_tab_evenly(jsonb)'::regprocedure) into v_definition;
  if v_definition is null then raise exception 'split_pos_tab_evenly(jsonb) is not installed'; end if;
  v_occurrences := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  if v_occurrences <> 1 then raise exception 'split_pos_tab_evenly ownership declaration contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_occurrences := (length(v_definition)-length(replace(v_definition,v_guard_old,'')))/length(v_guard_old);
  if v_occurrences <> 1 then raise exception 'split_pos_tab_evenly ownership guard contract is ambiguous or missing'; end if;
  execute replace(v_definition,v_guard_old,v_guard_new);
end
$do$;

-- Extend the existing PIN-verified activation result with an opaque proof.
-- This leaves the PIN check, attendance linkage and Till opening in the
-- earlier authoritative function while binding the proof to its exact shift.
do $do$
declare
  v_definition text;
  v_decl_old text := $old$  v_pos_shift_id uuid;$old$;
  v_decl_new text := $new$  v_pos_shift_id uuid;
  v_operator_proof text;
  v_operator_proof_hash text;$new$;
  v_tail_old text := $old$  select to_jsonb(p) into v_open_result from public.pos_shifts p where p.id = v_pos_shift_id;
  return jsonb_build_object(
    'success', true,$old$;
  v_tail_new text := $new$  select to_jsonb(p) into v_open_result from public.pos_shifts p where p.id = v_pos_shift_id;
  v_operator_proof := encode(extensions.gen_random_bytes(32), 'hex');
  v_operator_proof_hash := encode(extensions.digest(convert_to(v_operator_proof, 'UTF8'), 'sha256'), 'hex');
  delete from public.pos_till_operator_proofs
   where lodge_id = v_lodge_id
     and outlet_id = v_outlet_id
     and staff_id = v_staff_id
     and pos_shift_id = v_pos_shift_id
     and created_by = v_actor_id
     and expires_at > now();
  insert into public.pos_till_operator_proofs(token_hash, lodge_id, outlet_id, staff_id, pos_shift_id, expires_at, created_by)
  values(v_operator_proof_hash, v_lodge_id, v_outlet_id, v_staff_id, v_pos_shift_id,
    now() + make_interval(mins => greatest(5, least(240, coalesce((select nullif(s.operating_profile->'till_operator_policy'->>'inactivity_minutes', '')::integer from public.settings s where s.lodge_id = v_lodge_id limit 1), 30)))),
    v_actor_id);
  return jsonb_build_object(
    'success', true,
    'operator_proof', v_operator_proof,$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.activate_shared_till_operator(jsonb)'::regprocedure) into v_definition;
  if v_definition is null then raise exception 'activate_shared_till_operator(jsonb) is not installed'; end if;
  v_occurrences := (length(v_definition)-length(replace(v_definition,v_decl_old,'')))/length(v_decl_old);
  if v_occurrences <> 1 then raise exception 'shared Till proof declaration contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition,v_decl_old,v_decl_new);
  v_occurrences := (length(v_definition)-length(replace(v_definition,v_tail_old,'')))/length(v_tail_old);
  if v_occurrences <> 1 then raise exception 'shared Till proof return contract is ambiguous or missing'; end if;
  execute replace(v_definition,v_tail_old,v_tail_new);
end
$do$;

notify pgrst, 'reload schema';
commit;
