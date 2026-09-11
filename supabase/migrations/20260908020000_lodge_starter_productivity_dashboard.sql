-- ── Lodge Starter staff productivity read ───────────────────────────────────
-- The lodging app embeds a read-only Team Performance tab inside Staff so
-- Starter teams can see staff activity without the Enterprise Workforce
-- add-on. Hotel and POS keep requiring workforce_management, and every
-- manage RPC (schedules, tasks, training, handovers) is untouched.
--
-- Rule enforced here (fail closed):
-- - lodge access + role check identical to app_require_feature
-- - product lodge-camp: workforce_management OR staff_basic
-- - any other product: workforce_management only

create or replace function public.get_staff_productivity_dashboard(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_metrics jsonb;
  v_summary jsonb;
  v_role text := lower(coalesce(public.app_current_role(), ''));
  v_entitlement jsonb;
  v_product text;
  v_workforce boolean;
  v_staff_basic boolean;
begin
  if public.app_is_service_role() then
    null; -- service-role bypass (cron, webhooks, admin), same as app_require_feature
  else
    if not public.app_lodge_access(p_lodge_id) then
      raise exception 'Access denied for this lodge.'
        using errcode = '42501';
    end if;

    if not (v_role = any(array['manager', 'admin', 'super_admin', 'receptionist', 'operations'])) then
      raise exception 'This session is not allowed to perform that action.'
        using errcode = '42501';
    end if;

    v_entitlement := public.get_lodge_entitlement(p_lodge_id);
    v_product := v_entitlement->>'product_id';
    v_workforce := coalesce((v_entitlement->'effective_features'->>'workforce_management')::boolean, false);
    v_staff_basic := coalesce((v_entitlement->'effective_features'->>'staff_basic')::boolean, false);

    if v_product = 'lodge-camp' then
      if not (v_workforce or v_staff_basic) then
        raise exception 'Feature "staff productivity" is not enabled for this lodge.'
          using errcode = '42501';
      end if;
    elsif not v_workforce then
      raise exception 'Feature "workforce_management" is not enabled for this lodge.'
        using errcode = '42501';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', pm.staff_id,
    'staff_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Unknown'),
    'metric_date', pm.metric_date,
    'tasks_completed', pm.tasks_completed,
    'tasks_on_time', pm.tasks_on_time,
    'avg_completion_time_minutes', pm.avg_completion_time_minutes,
    'incidents', pm.incidents,
    'rating', pm.rating
  ) order by pm.metric_date, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)), '[]'::jsonb)
  into v_metrics
  from public.staff_productivity_metrics pm
  left join auth.users u on u.id = pm.staff_id
  where pm.lodge_id = p_lodge_id and pm.metric_date between p_start_date and p_end_date;

  select jsonb_build_object(
    'total_tasks', coalesce(sum(pm.tasks_completed), 0),
    'on_time_tasks', coalesce(sum(pm.tasks_on_time), 0),
    'total_incidents', coalesce(sum(pm.incidents), 0),
    'avg_rating', round(coalesce(avg(pm.rating), 0), 1),
    'staff_count', count(distinct pm.staff_id)
  ) into v_summary
  from public.staff_productivity_metrics pm
  where pm.lodge_id = p_lodge_id and pm.metric_date between p_start_date and p_end_date;

  return jsonb_build_object('metrics', v_metrics, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

grant execute on function public.get_staff_productivity_dashboard(uuid, date, date) to authenticated;
