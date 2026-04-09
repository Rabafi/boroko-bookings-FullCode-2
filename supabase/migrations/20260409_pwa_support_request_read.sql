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
    s.created_at,
    s.updated_at,
    s.resolved_at
  from public.support_tickets s
  where s.lodge_id = p_lodge_id
    and public.app_lodge_access(p_lodge_id)
  order by coalesce(s.updated_at, s.created_at) desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 1);
$function$;

revoke all on function public.get_lodge_support_tickets(uuid, int) from public;
grant execute on function public.get_lodge_support_tickets(uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
