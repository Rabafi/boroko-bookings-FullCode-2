-- Manager-facing feedback queue. Staff may record feedback, but only managers
-- can retrieve the venue-wide follow-up list.

create or replace function public.get_restaurant_feedback(p_lodge_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'rating', f.rating,
      'channel', f.channel,
      'message', f.message,
      'created_at', f.created_at,
      'staff_name', coalesce(u.name, u.email, 'Staff member')
    ) order by f.created_at desc)
    from public.restaurant_customer_feedback f
    left join public.users u on u.id = f.created_by
    where f.lodge_id = p_lodge_id
      and f.created_at >= now() - make_interval(days => v_days)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_restaurant_feedback(uuid, integer) from public;
grant execute on function public.get_restaurant_feedback(uuid, integer) to authenticated, service_role;
