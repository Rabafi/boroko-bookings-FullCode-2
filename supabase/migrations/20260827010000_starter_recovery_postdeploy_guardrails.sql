-- Forward-only guardrails for the already-applied starter recovery contract.
--
-- 20260826000000 is already part of the deployed migration history.  Keep its
-- field mapping, signed-ledger reconstruction, warning counts, and atomic
-- restore implementation intact by renaming those definitions to private v1
-- names and placing narrow, service-role-only guards in front of them.

-- Legacy live-lodge queries use deleted=false as their compatibility boundary.
-- Make every existing disposable recovery row satisfy both quarantine signals.
update public.settings
   set deleted = true,
       updated_at = now()
 where coalesce(is_disposable_recovery, false) = true
   and coalesce(deleted, false) = false;

-- ---------------------------------------------------------------------------
-- 1. Explicit operation-id validation while retaining the deployed validator
-- ---------------------------------------------------------------------------
alter function public._starter_recovery_validate_payload(jsonb)
  rename to _starter_recovery_validate_payload_v1;

create or replace function public._starter_recovery_validate_payload(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Recovery payload must be a JSON object.' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'operation_id'), '') is null
     or p_payload->>'operation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;

  -- The deployed validator owns the complete DTO, type, ceiling, lodge,
  -- protected-field, and signed-payment contract.
  perform public._starter_recovery_validate_payload_v1(p_payload);
end;
$$;

revoke all on function public._starter_recovery_validate_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public._starter_recovery_validate_payload_v1(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Idempotency-before-target guard and final quarantine enforcement
-- ---------------------------------------------------------------------------
alter function public.admin_execute_starter_disposable_restore(jsonb)
  rename to _starter_recovery_execute_v1;

create or replace function public.admin_execute_starter_disposable_restore(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id text;
  v_source_lodge_id uuid;
  v_recovery_lodge_id uuid;
  v_reason text;
  v_ticket_ref text;
  v_package_sha256 text;
  v_package_bytes integer;
  v_payload_sha256 text;
  v_actor uuid := public.app_current_user_id();
  v_actor_email text;
  v_payload_actor uuid;
  v_existing public.starter_recovery_operations%rowtype;
  v_result jsonb;
  v_marker boolean := false;
  v_deleted boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery is restricted to the Command Central service path.' using errcode = '42501';
  end if;

  -- This explicit guard runs before any cast or operation lookup.  The
  -- delegated validator below retains the full deployed contract.
  perform public._starter_recovery_validate_payload(p_payload);

  v_operation_id := p_payload->>'operation_id';
  v_source_lodge_id := (p_payload->>'source_lodge_id')::uuid;
  v_recovery_lodge_id := (p_payload->>'recovery_lodge_id')::uuid;
  v_reason := btrim(p_payload->>'reason');
  v_ticket_ref := btrim(p_payload->>'ticket_ref');
  v_payload_actor := nullif(p_payload->>'actor_id','')::uuid;
  v_actor_email := nullif(lower(btrim(p_payload->>'actor_email')), '');
  if v_payload_actor is not null and v_actor is not null and v_payload_actor <> v_actor then
    raise exception 'Payload actor_id does not match the authenticated operator.' using errcode = '42501';
  end if;
  v_actor := coalesce(v_actor, v_payload_actor);
  v_package_sha256 := p_payload->>'package_sha256';
  v_package_bytes := coalesce((p_payload->>'package_bytes')::integer, pg_column_size(p_payload));
  v_payload_sha256 := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  -- The lock covers the idempotency comparison.  A verified same-operation
  -- replay returns before the delegated implementation can reject its now
  -- existing recovery target.  Any changed operation metadata fails closed.
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id, 0));
  select * into v_existing
    from public.starter_recovery_operations
   where operation_id = v_operation_id
   for update;
  if found then
    if v_existing.source_lodge_id is distinct from v_source_lodge_id
       or v_existing.recovery_lodge_id is distinct from v_recovery_lodge_id
       or v_existing.reason is distinct from v_reason
       or v_existing.ticket_ref is distinct from v_ticket_ref
       or v_existing.package_sha256 is distinct from v_package_sha256
       or v_existing.package_bytes is distinct from v_package_bytes
       or v_existing.payload_sha256 is distinct from v_payload_sha256
       or v_existing.actor_id is distinct from v_actor
       or v_existing.actor_email is distinct from v_actor_email
       or v_existing.target_mode <> 'disposable' then
      raise exception 'Operation ID was reused with a different payload.' using errcode = '23505';
    end if;
    if v_existing.status = 'verified' then
      select coalesce(s.is_disposable_recovery, false), coalesce(s.deleted, false)
        into v_marker, v_deleted
        from public.settings s
       where s.lodge_id = v_recovery_lodge_id
       limit 1;
      v_marker := coalesce(v_marker, false);
      v_deleted := coalesce(v_deleted, false);
      v_result := coalesce(v_existing.result, '{}'::jsonb)
        || jsonb_build_object(
          'success', coalesce((v_existing.result->>'success')::boolean, true) and v_marker and v_deleted,
          'idempotent', true,
          'quarantined', v_marker and v_deleted,
          'deleted', v_deleted,
          'quarantine_complete', v_marker and v_deleted
        );
      update public.starter_recovery_operations
         set result = v_result,
             updated_at = now()
       where operation_id = v_operation_id;
      return v_result;
    end if;
    raise exception 'Recovery operation is not retryable in status %.', v_existing.status using errcode = '55000';
  end if;

  -- The deployed implementation performs source/target checks, all inserts,
  -- ledger reconstruction, warning counts, and its immutable verified audit
  -- in one transaction.  It still sees the original public helper name.
  v_result := public._starter_recovery_execute_v1(p_payload);

  -- The old insert used deleted=false.  Harden its target before exposing the
  -- successful result, while remaining in the same transaction.
  update public.settings
     set deleted = true,
         updated_at = now()
   where lodge_id = v_recovery_lodge_id
     and coalesce(is_disposable_recovery, false) = true;
  select exists (
           select 1 from public.settings s
            where s.lodge_id = v_recovery_lodge_id
              and coalesce(s.is_disposable_recovery, false) = true
         ),
         exists (
           select 1 from public.settings s
            where s.lodge_id = v_recovery_lodge_id
              and coalesce(s.is_disposable_recovery, false) = true
              and coalesce(s.deleted, false) = true
         )
    into v_marker, v_deleted;
  if not v_marker or not v_deleted then
    raise exception 'Disposable recovery target did not receive both quarantine markers.' using errcode = '23514';
  end if;
  v_result := v_result || jsonb_build_object(
    'quarantined', true,
    'deleted', true,
    'quarantine_complete', true
  );
  update public.starter_recovery_operations
     set result = v_result,
         updated_at = now()
   where operation_id = v_operation_id;
  return v_result;
end;
$$;

revoke all on function public._starter_recovery_execute_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_execute_starter_disposable_restore(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_execute_starter_disposable_restore(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Verification requires both quarantine markers
-- ---------------------------------------------------------------------------
alter function public.admin_verify_starter_disposable_restore(text)
  rename to _starter_recovery_verify_v1;

create or replace function public.admin_verify_starter_disposable_restore(p_operation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation public.starter_recovery_operations%rowtype;
  v_result jsonb;
  v_marker boolean := false;
  v_deleted boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery verification is service-role only.' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_operation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;
  select * into v_operation
    from public.starter_recovery_operations
   where operation_id = p_operation_id;
  if not found then
    raise exception 'Recovery operation was not found.' using errcode = '22023';
  end if;

  v_result := public._starter_recovery_verify_v1(p_operation_id);
  select coalesce(s.is_disposable_recovery, false), coalesce(s.deleted, false)
    into v_marker, v_deleted
    from public.settings s
   where s.lodge_id = v_operation.recovery_lodge_id
   limit 1;
  v_marker := coalesce(v_marker, false);
  v_deleted := coalesce(v_deleted, false);
  return v_result || jsonb_build_object(
    'success', coalesce((v_result->>'success')::boolean, false) and v_marker and v_deleted,
    'quarantined', v_marker and v_deleted,
    'deleted', v_deleted,
    'quarantine_complete', v_marker and v_deleted
  );
end;
$$;

revoke all on function public._starter_recovery_verify_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_verify_starter_disposable_restore(text)
  from public, anon, authenticated;
grant execute on function public.admin_verify_starter_disposable_restore(text)
  to service_role;

notify pgrst, 'reload schema';
