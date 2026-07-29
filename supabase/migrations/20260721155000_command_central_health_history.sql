-- Command Central diagnostic history. Local-only until explicitly deployed.
create table if not exists public.command_central_health_runs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  status text not null check (status in ('healthy', 'degraded', 'failed')),
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists command_central_health_runs_created_idx
  on public.command_central_health_runs (created_at desc);

alter table public.command_central_health_runs enable row level security;
revoke all on table public.command_central_health_runs from public, anon, authenticated;
grant select, insert on table public.command_central_health_runs to service_role;

create or replace function public.admin_record_command_central_health_run(
  p_actor_id uuid,
  p_actor_email text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_status text,
  p_results jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_results jsonb;
begin
  if p_actor_id is null then raise exception 'Actor is required'; end if;
  if p_status not in ('healthy', 'degraded', 'failed') then raise exception 'Invalid health status'; end if;
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then raise exception 'Health results must be an array'; end if;
  if pg_column_size(coalesce(p_results, '[]'::jsonb)) > 200000 then raise exception 'Health evidence is too large'; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', left(item->>'id', 80),
    'status', left(item->>'status', 24),
    'source', left(item->>'source', 120),
    'checked_at', left(item->>'checked_at', 40),
    'latency_ms', case when (item->>'latency_ms') ~ '^\d+$' then (item->>'latency_ms')::bigint end,
    'row_count', case when (item->>'row_count') ~ '^\d+$' then (item->>'row_count')::bigint end,
    'error_code', left(item->>'error_code', 80),
    'error_message', left(item->>'error_message', 500)
  ))), '[]'::jsonb)
  into v_results
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) item;

  insert into public.command_central_health_runs(actor_id, actor_email, started_at, completed_at, status, results)
  values (p_actor_id, left(coalesce(p_actor_email, ''), 320), p_started_at, p_completed_at, p_status, v_results)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'run_id', v_id, 'status', p_status, 'created_at', now());
end;
$$;

create or replace function public.admin_list_command_central_health_runs(p_limit integer default 20)
returns setof public.command_central_health_runs
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from public.command_central_health_runs order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.admin_record_command_central_health_run(uuid, text, timestamptz, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_command_central_health_runs(integer) from public, anon, authenticated;
grant execute on function public.admin_record_command_central_health_run(uuid, text, timestamptz, timestamptz, text, jsonb) to service_role;
grant execute on function public.admin_list_command_central_health_runs(integer) to service_role;
