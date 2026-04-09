begin;

create or replace function public.get_lodge_support_tickets(
  p_lodge_id uuid,
  p_limit int default 50
)
returns table (
  id uuid,
  lodge_id uuid,
  lodge_name text,
  title text,
  description text,
  category text,
  priority text,
  status text,
  admin_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    s.id,
    s.lodge_id,
    s.lodge_name,
    s.title,
    s.description,
    s.category,
    s.priority,
    s.status,
    coalesce(s.admin_notes, '') as admin_notes,
    s.created_at,
    s.updated_at,
    s.resolved_at
  from public.support_tickets s
  where s.lodge_id = p_lodge_id
    and public.app_lodge_access(p_lodge_id)
  order by coalesce(s.updated_at, s.created_at) desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 1);
$function$;

create or replace function public.update_lodge_support_ticket(
  p_ticket_id uuid,
  p_lodge_id uuid,
  p_status text default null,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_admin_notes, '')), '');
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  if v_status not in ('', 'open', 'acknowledged', 'in_progress', 'resolved') then
    return jsonb_build_object('success', false, 'error', 'Invalid request status');
  end if;

  update public.support_tickets
     set status = case when v_status = '' then status else v_status end,
         admin_notes = case when p_admin_notes is null then admin_notes else v_note end,
         updated_at = now(),
         resolved_at = case
           when v_status = 'resolved' then now()
           when v_status in ('open', 'acknowledged', 'in_progress') then null
           else resolved_at
         end
   where id = p_ticket_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  return jsonb_build_object('success', true, 'id', p_ticket_id);
end;
$function$;

revoke all on function public.get_lodge_support_tickets(uuid, int) from public;
grant execute on function public.get_lodge_support_tickets(uuid, int) to authenticated, service_role;

revoke all on function public.update_lodge_support_ticket(uuid, uuid, text, text) from public;
grant execute on function public.update_lodge_support_ticket(uuid, uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
