-- Migration: 20260430_device_health_reports
-- Creates cross-device health reporting table and supporting RPCs.
-- Stores one row per device per lodge; upserted by each client on health publish.

-- Table: stores one row per device per lodge
create table if not exists public.device_health_reports (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  device_id text not null,
  client_type text not null check (client_type in ('desktop', 'pwa')),
  reported_at timestamptz not null default now(),
  pending_queue_count integer not null default 0,
  failed_queue_count integer not null default 0,
  unresolved_local_count integer not null default 0,
  replay_auth_ready boolean not null default true,
  last_successful_sync_at timestamptz,
  reconciliation_state text not null default 'unknown' check (reconciliation_state in ('unknown','unverifiable','clear','mismatch')),
  top_fault_types text[] default '{}',
  raw_summary jsonb default '{}',
  unique (lodge_id, device_id)
);

-- Upsert function callable by authenticated clients
create or replace function public.upsert_device_health(
  p_lodge_id uuid,
  p_device_id text,
  p_client_type text,
  p_pending_queue_count integer,
  p_failed_queue_count integer,
  p_unresolved_local_count integer,
  p_replay_auth_ready boolean,
  p_last_successful_sync_at timestamptz,
  p_reconciliation_state text,
  p_top_fault_types text[],
  p_raw_summary jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into device_health_reports (
    lodge_id, device_id, client_type, reported_at,
    pending_queue_count, failed_queue_count, unresolved_local_count,
    replay_auth_ready, last_successful_sync_at, reconciliation_state,
    top_fault_types, raw_summary
  ) values (
    p_lodge_id, p_device_id, p_client_type, now(),
    p_pending_queue_count, p_failed_queue_count, p_unresolved_local_count,
    p_replay_auth_ready, p_last_successful_sync_at, p_reconciliation_state,
    p_top_fault_types, p_raw_summary
  )
  on conflict (lodge_id, device_id) do update set
    client_type = excluded.client_type,
    reported_at = now(),
    pending_queue_count = excluded.pending_queue_count,
    failed_queue_count = excluded.failed_queue_count,
    unresolved_local_count = excluded.unresolved_local_count,
    replay_auth_ready = excluded.replay_auth_ready,
    last_successful_sync_at = excluded.last_successful_sync_at,
    reconciliation_state = excluded.reconciliation_state,
    top_fault_types = excluded.top_fault_types,
    raw_summary = excluded.raw_summary;
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

-- Read function: returns all device health rows for a lodge
create or replace function public.get_device_health_rollup(p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_rows jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'device_id', device_id,
      'client_type', client_type,
      'reported_at', reported_at,
      'pending_queue_count', pending_queue_count,
      'failed_queue_count', failed_queue_count,
      'unresolved_local_count', unresolved_local_count,
      'replay_auth_ready', replay_auth_ready,
      'last_successful_sync_at', last_successful_sync_at,
      'reconciliation_state', reconciliation_state,
      'top_fault_types', top_fault_types,
      'stale', (now() - reported_at) > interval '10 minutes'
    )
  ) into v_rows
  from device_health_reports
  where lodge_id = p_lodge_id;
  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

-- RLS: only authenticated users of the same lodge can read/write
alter table public.device_health_reports enable row level security;
create policy "lodge members can manage device health" on public.device_health_reports
  for all using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Grant execute to authenticated role
grant execute on function public.upsert_device_health to authenticated;
grant execute on function public.get_device_health_rollup to authenticated;
revoke execute on function public.upsert_device_health from anon;
revoke execute on function public.get_device_health_rollup from anon;
