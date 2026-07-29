-- Unified Command Central audit read model.
-- Governed operations write command_central_audit_events while older admin
-- workflows still write activity_logs; the explorer must expose both sources
-- without allowing authenticated clients to forge legacy rows.

create or replace function public.get_command_central_audit_log(
  p_lodge_id text default null,
  p_actor_id uuid default null,
  p_action text default null,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_limit integer default 200,
  p_offset integer default 0
) returns table (
  id uuid,
  lodge_id text,
  lodge_name text,
  action text,
  actor_id uuid,
  actor_email text,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz,
  source text,
  operation_id uuid,
  product_id text,
  reason text
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  return query
  select * from (
    select
      al.id,
      al.lodge_id::text,
      al.lodge_name,
      al.action,
      al.actor_id,
      al.actor_email,
      al.entity_type,
      al.entity_id,
      al.details,
      al.created_at,
      'activity_logs'::text as source,
      null::uuid as operation_id,
      null::text as product_id,
      null::text as reason
    from public.activity_logs al
    where (p_lodge_id is null or al.lodge_id::text = p_lodge_id)
      and (p_actor_id is null or al.actor_id = p_actor_id)
      and (p_action is null or al.action = p_action)
      and (p_start is null or al.created_at >= p_start)
      and (p_end is null or al.created_at <= p_end)
    union all
    select
      ce.id,
      ce.target_lodge_id::text,
      coalesce(s.lodge_name, s.company_name, ce.target_lodge_id::text),
      ce.event_type,
      ce.actor_id,
      ce.actor_email,
      'command_central_operation',
      ce.operation_id::text,
      jsonb_build_object('before_state', ce.before_state, 'after_state', ce.after_state, 'reason', ce.reason),
      ce.created_at,
      'command_central_audit_events'::text,
      ce.operation_id,
      ce.product_id,
      ce.reason
    from public.command_central_audit_events ce
    left join public.settings s on s.lodge_id = ce.target_lodge_id
    where (p_lodge_id is null or ce.target_lodge_id::text = p_lodge_id)
      and (p_actor_id is null or ce.actor_id = p_actor_id)
      and (p_action is null or ce.event_type = p_action)
      and (p_start is null or ce.created_at >= p_start)
      and (p_end is null or ce.created_at <= p_end)
  ) combined
  order by combined.created_at desc
  limit greatest(least(coalesce(p_limit, 200), 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.get_command_central_audit_summary(
  p_start timestamptz default null,
  p_end timestamptz default null
) returns table (action text, count bigint, last_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  return query
  select combined.action, count(*)::bigint, max(combined.created_at)
  from (
    select al.action, al.created_at from public.activity_logs al
    where (p_start is null or al.created_at >= p_start) and (p_end is null or al.created_at <= p_end)
    union all
    select ce.event_type, ce.created_at from public.command_central_audit_events ce
    where (p_start is null or ce.created_at >= p_start) and (p_end is null or ce.created_at <= p_end)
  ) combined
  group by combined.action
  order by count(*) desc;
end;
$$;

revoke all on function public.get_command_central_audit_log(text, uuid, text, timestamptz, timestamptz, integer, integer), public.get_command_central_audit_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_command_central_audit_log(text, uuid, text, timestamptz, timestamptz, integer, integer), public.get_command_central_audit_summary(timestamptz, timestamptz) to service_role;

-- The legacy writer has no auth check and is only called through the main
-- process' service-role client. Remove its authenticated grant permanently.
revoke execute on function public.log_admin_audit(text, text, text, uuid, text, text, text, jsonb) from authenticated, anon, public;
grant execute on function public.log_admin_audit(text, text, text, uuid, text, text, text, jsonb) to service_role;
notify pgrst, 'reload schema';
