begin;

create or replace function public.create_support_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.support_tickets (
    lodge_id,
    lodge_name,
    title,
    description,
    category,
    priority,
    status
  ) values (
    v_lodge_id,
    nullif(payload->>'lodge_name', ''),
    nullif(payload->>'title', ''),
    nullif(payload->>'description', ''),
    coalesce(nullif(payload->>'category', ''), 'General'),
    coalesce(nullif(payload->>'priority', ''), 'Normal'),
    'open'
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_support_ticket(jsonb) from public;
grant execute on function public.create_support_ticket(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
