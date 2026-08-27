-- Starter universal audit recording
--
-- Financial booking/payment mutations remain in financial_audit_log and POS
-- mutations remain in their existing server ledgers. Staff account changes
-- remain in staff_access_audit. This log closes the ordinary accommodation
-- operations gap without replacing or duplicating those ledgers.

create table if not exists public.starter_operational_audit_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  actor_id uuid,
  event_type text not null,
  entity_table text not null,
  entity_id uuid,
  operation_id text,
  artifact_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint starter_operational_audit_event_length_chk
    check (length(event_type) between 3 and 96),
  constraint starter_operational_audit_entity_length_chk
    check (length(entity_table) between 1 and 96),
  constraint starter_operational_audit_operation_length_chk
    check (operation_id is null or length(operation_id) between 8 and 128),
  constraint starter_operational_audit_artifact_length_chk
    check (artifact_id is null or length(artifact_id) between 8 and 256)
);

create index if not exists starter_operational_audit_lodge_created_idx
  on public.starter_operational_audit_log (lodge_id, created_at desc);

create unique index if not exists starter_operational_audit_artifact_uidx
  on public.starter_operational_audit_log (lodge_id, event_type, artifact_id)
  where artifact_id is not null;

alter table public.starter_operational_audit_log enable row level security;
drop policy if exists starter_operational_audit_lodge_select on public.starter_operational_audit_log;
create policy starter_operational_audit_lodge_select
  on public.starter_operational_audit_log for select
  using (public.app_lodge_access(lodge_id));

-- Distributed clients cannot insert, update, or delete audit evidence. The
-- SECURITY DEFINER trigger/RPC paths below are the only write paths.
revoke all on table public.starter_operational_audit_log from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.starter_operational_audit_log from service_role;
grant select on table public.starter_operational_audit_log to service_role;

create or replace function public.starter_audit_redact(p_value jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path to 'public'
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
begin
  if p_value is null then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      if v_key in (
        'password', 'password_hash', 'pin', 'pin_hash',
        'pwa_password', 'pwa_password_hash', 'lodge_mesh_secret',
        'id_photo', 'id_number', 'access_token', 'refresh_token',
        'service_role_key', 'anon_key'
      ) then
        continue;
      end if;
      v_result := v_result || jsonb_build_object(v_key, public.starter_audit_redact(v_value));
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.starter_audit_redact(value)), '[]'::jsonb)
      into v_result
      from jsonb_array_elements(p_value);
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function public.prevent_starter_operational_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'Starter operational audit evidence is append-only.' using errcode = '55000';
end;
$$;

drop trigger if exists starter_operational_audit_immutable on public.starter_operational_audit_log;
create trigger starter_operational_audit_immutable
before update or delete on public.starter_operational_audit_log
for each row execute function public.prevent_starter_operational_audit_mutation();

create or replace function public.capture_starter_operational_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_source jsonb;
  v_lodge_id uuid;
  v_entity_id uuid;
  v_operation_id text;
begin
  v_before := case when tg_op in ('UPDATE', 'DELETE') then public.starter_audit_redact(to_jsonb(old)) end;
  v_after := case when tg_op in ('INSERT', 'UPDATE') then public.starter_audit_redact(to_jsonb(new)) end;
  v_source := coalesce(v_after, v_before, '{}'::jsonb);

  v_lodge_id := nullif(v_source->>'lodge_id', '')::uuid;
  if v_lodge_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_entity_id := nullif(v_source->>'id', '')::uuid;
  v_operation_id := left(nullif(btrim(coalesce(
    v_source->>'idempotency_key',
    v_source->>'create_idempotency_key',
    v_source->>'operation_id',
    v_source->>'client_operation_id'
  )), ''), 128);

  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;

  insert into public.starter_operational_audit_log (
    lodge_id, actor_id, event_type, entity_table, entity_id, operation_id,
    before_snapshot, after_snapshot, metadata
  ) values (
    v_lodge_id,
    public.app_current_user_id(),
    lower(tg_table_name || '_' || tg_op),
    lower(tg_table_name),
    v_entity_id,
    v_operation_id,
    v_before,
    v_after,
    jsonb_build_object('source', 'starter_operational_trigger', 'operation', lower(tg_op))
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Attach only to ordinary operational entities. Bookings/payments and users
-- intentionally remain on their existing authoritative audit contracts.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'rooms', 'housekeeping_log', 'customers', 'quotations',
    'invoices', 'maintenance_tickets'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists starter_operational_audit_%I on public.%I', v_table, v_table);
      execute format(
        'create trigger starter_operational_audit_%1$I after insert or update or delete on public.%1$I for each row execute function public.capture_starter_operational_audit()',
        v_table
      );
    end if;
  end loop;
end;
$$;

create or replace function public.record_starter_artifact_audit(
  p_lodge_id uuid,
  p_action text,
  p_artifact_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action text := lower(nullif(btrim(coalesce(p_action, '')), ''));
  v_artifact_id text := nullif(btrim(coalesce(p_artifact_id, '')), '');
  v_row public.starter_operational_audit_log%rowtype;
  v_audit_id uuid;
  v_created_at timestamptz;
  v_inserted boolean := false;
begin
  if v_action not in (
    'starter_backup_created',
    'starter_report_pdf_saved',
    'starter_report_printed'
  ) then
    raise exception 'Unsupported Starter artifact audit action.' using errcode = '22023';
  end if;
  if v_artifact_id is null or length(v_artifact_id) < 8 or length(v_artifact_id) > 256 then
    raise exception 'A stable Starter artifact identifier is required.' using errcode = '22023';
  end if;

  -- Match the action's real capability boundary server-side. Recording is
  -- universal for entitled actions, but this RPC must not become a way for a
  -- role that cannot create an artifact to forge its audit evidence.
  if v_action = 'starter_backup_created' then
    perform public.app_require_feature(
      p_lodge_id,
      'starter_backup',
      array['owner', 'admin', 'manager', 'finance', 'super_admin']
    );
    if v_artifact_id !~ '^[0-9a-f]{64}$' then
      raise exception 'Starter backup artifact identifier must be a SHA-256 hash.' using errcode = '22023';
    end if;
  else
    perform public._restaurant_require_operational_report_access(
      p_lodge_id,
      'reports.basic_view'
    );
    if v_action = 'starter_report_pdf_saved' and v_artifact_id !~ '^[0-9a-f]{64}$' then
      raise exception 'Starter report PDF artifact identifier must be a SHA-256 hash.' using errcode = '22023';
    elsif v_action = 'starter_report_printed'
      and v_artifact_id !~ '^print-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Starter report print artifact identifier must contain a valid operation UUID.' using errcode = '22023';
    end if;
  end if;

  insert into public.starter_operational_audit_log (
    lodge_id, actor_id, event_type, entity_table, artifact_id, metadata
  ) values (
    p_lodge_id,
    public.app_current_user_id(),
    v_action,
    'starter_artifact',
    v_artifact_id,
    public.starter_audit_redact(coalesce(p_metadata, '{}'::jsonb))
  )
  on conflict (lodge_id, event_type, artifact_id) where artifact_id is not null
  do nothing
  returning id, created_at into v_audit_id, v_created_at;

  v_inserted := v_audit_id is not null;

  if v_inserted then
    v_row.id := v_audit_id;
    v_row.created_at := v_created_at;
  else
    select * into v_row
      from public.starter_operational_audit_log
     where lodge_id = p_lodge_id
       and event_type = v_action
       and artifact_id = v_artifact_id
     limit 1;
  end if;

  return jsonb_build_object(
    'success', true,
    'audit_id', v_row.id,
    'artifact_id', v_artifact_id,
    'idempotent', not v_inserted
  );
end;
$$;

revoke all on function public.starter_audit_redact(jsonb) from public, anon, authenticated;
revoke all on function public.prevent_starter_operational_audit_mutation() from public, anon, authenticated;
revoke all on function public.capture_starter_operational_audit() from public, anon, authenticated;
revoke all on function public.record_starter_artifact_audit(uuid, text, text, jsonb) from public;
grant execute on function public.record_starter_artifact_audit(uuid, text, text, jsonb) to anon, authenticated, service_role;
