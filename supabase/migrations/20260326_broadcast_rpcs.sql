create or replace function public.create_broadcast(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.broadcasts (
    title,
    message,
    expires_at,
    is_active
  ) values (
    payload->>'title',
    payload->>'message',
    nullif(payload->>'expires_at', '')::timestamptz,
    coalesce((payload->>'is_active')::boolean, true)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_broadcast(jsonb) from public, anon, authenticated;
grant execute on function public.create_broadcast(jsonb) to service_role;

create or replace function public.update_broadcast(
  p_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.broadcasts
  set
    title = case when payload ? 'title' then payload->>'title' else title end,
    message = case when payload ? 'message' then payload->>'message' else message end,
    expires_at = case when payload ? 'expires_at' then nullif(payload->>'expires_at', '')::timestamptz else expires_at end,
    is_active = case when payload ? 'is_active' then coalesce((payload->>'is_active')::boolean, false) else is_active end
  where id = p_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Broadcast not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_broadcast(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_broadcast(uuid, jsonb) to service_role;

create or replace function public.delete_broadcast(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.broadcasts
  where id = p_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Broadcast not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

revoke all on function public.delete_broadcast(uuid) from public, anon, authenticated;
grant execute on function public.delete_broadcast(uuid) to service_role;
