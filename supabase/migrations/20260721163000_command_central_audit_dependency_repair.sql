-- Narrow compatibility repair for linked environments that need governed
-- Command Central operations before the separate commercial billing ledger is
-- deployed. The later billing migration remains idempotent over these objects.

create table if not exists public.command_central_audit_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.command_central_operations(operation_id),
  event_type text not null,
  target_lodge_id uuid,
  product_id text,
  actor_id uuid,
  actor_email text,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.command_central_audit_events enable row level security;
revoke all on public.command_central_audit_events from public, anon, authenticated;

create or replace function public.command_central_complete_operation(
  p_operation_id uuid,
  p_result jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  update public.command_central_operations
     set status = 'completed', result = p_result, completed_at = now()
   where operation_id = p_operation_id and status = 'started';
end;
$$;

create or replace function public.command_central_fail_operation(
  p_operation_id uuid,
  p_result jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  update public.command_central_operations
     set status = 'failed', result = p_result, completed_at = now()
   where operation_id = p_operation_id and status = 'started';
end;
$$;

revoke all on function public.command_central_complete_operation(uuid, jsonb), public.command_central_fail_operation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.command_central_complete_operation(uuid, jsonb), public.command_central_fail_operation(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
