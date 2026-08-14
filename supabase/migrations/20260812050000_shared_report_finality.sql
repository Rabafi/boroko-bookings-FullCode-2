-- Add explicit finality metadata to the legacy shared Reports RPCs without
-- changing their existing field names.  Clients must not treat a successful
-- RPC transport response as a financial certificate by itself.

begin;

alter function public.get_revenue_report(uuid, date, date)
  rename to get_revenue_report_before_finality;

create function public.get_revenue_report(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_report jsonb;
  v_missing bigint := 0;
begin
  v_report := public.get_revenue_report_before_finality(p_lodge_id, p_start_date, p_end_date);
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select count(*) into v_missing
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.check_in between p_start_date and p_end_date
     and coalesce(b.status, '') not in ('cancelled')
     and (
       coalesce(b.status, '') = 'pending'
       or b.total_amount is null
       or b.charges_total is null
       or b.amount_paid is null
       or (coalesce(b.is_exclusive_event, false) and b.event_daily_rate is null)
     );
  return coalesce(v_report, '{}'::jsonb) || jsonb_build_object(
    'complete', v_missing = 0,
    'financial_truth', case when v_missing = 0 then 'server_confirmed' else 'server_incomplete' end,
    'source', 'server-authoritative',
    'unresolved_count', v_missing,
    'status', case when v_missing = 0 then 'complete' else 'incomplete' end
  );
end;
$$;

alter function public.get_profit_loss_summary(uuid, date, date)
  rename to get_profit_loss_summary_before_finality;

create function public.get_profit_loss_summary(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_report jsonb;
  v_unresolved bigint := 0;
begin
  v_report := public.get_profit_loss_summary_before_finality(p_lodge_id, p_start_date, p_end_date);
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select count(*) into v_unresolved
    from (
      select 1 from public.expenses e
       where e.lodge_id = p_lodge_id and e.date between p_start_date and p_end_date and e.amount is null
      union all
      select 1 from public.inventory_purchases i
       where i.lodge_id = p_lodge_id and i.date between p_start_date and p_end_date and i.total_cost is null
      union all
      select 1 from public.supply_purchases s
       where s.lodge_id = p_lodge_id and s.date between p_start_date and p_end_date and s.total_cost is null
      union all
      select 1 from public.maintenance_tickets m
       where m.lodge_id = p_lodge_id and m.reported_date between p_start_date and p_end_date and m.total_cost is null
      union all
      select 1 from public.pos_orders o
       where o.lodge_id = p_lodge_id and o.created_at >= p_start_date::timestamptz and o.created_at < (p_end_date + 1)::timestamptz
         and o.status in ('completed', 'settled') and (o.total is null or o.payment_method is null)
      union all
      select 1 from public.conference_bookings c
       where c.lodge_id = p_lodge_id and c.booking_date between p_start_date and p_end_date
         and coalesce(c.payment_status, '') <> 'cancelled' and c.total_amount is null
      union all
      select 1 from public.pool_day_use p
       where p.lodge_id = p_lodge_id and p.date between p_start_date and p_end_date and p.total is null
    ) gaps;
  return coalesce(v_report, '{}'::jsonb) || jsonb_build_object(
    'complete', v_unresolved = 0,
    'financial_truth', case when v_unresolved = 0 then 'server_confirmed' else 'server_incomplete' end,
    'source', 'server-authoritative',
    'unresolved_count', v_unresolved,
    'status', case when v_unresolved = 0 then 'complete' else 'incomplete' end
  );
end;
$$;

alter function public.get_room_profitability_summary(uuid, date, date)
  rename to get_room_profitability_summary_before_finality;

create function public.get_room_profitability_summary(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_report jsonb;
  v_unresolved bigint := 0;
begin
  v_report := public.get_room_profitability_summary_before_finality(p_lodge_id, p_start_date, p_end_date);
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select count(*) into v_unresolved
    from (
      select 1 from public.maintenance_tickets m
       where m.lodge_id = p_lodge_id and m.reported_date between p_start_date and p_end_date and m.total_cost is null
      union all
      select 1 from public.room_supply_movements rsm
       where rsm.lodge_id = p_lodge_id and rsm.created_at >= p_start_date::timestamptz and rsm.created_at < (p_end_date + 1)::timestamptz
         and rsm.movement_type = 'use' and rsm.total_cost is null
      union all
      select 1 from public.bookings b
       where b.lodge_id = p_lodge_id and b.check_in <= p_end_date and b.check_out > p_start_date
         and coalesce(b.status, '') not in ('cancelled')
         and (coalesce(b.status, '') = 'pending' or b.total_amount is null)
    ) gaps;
  return jsonb_build_object(
    'rows', case when jsonb_typeof(v_report) = 'array' then v_report else '[]'::jsonb end,
    'complete', v_unresolved = 0,
    'financial_truth', case when v_unresolved = 0 then 'server_confirmed' else 'server_incomplete' end,
    'source', 'server-authoritative',
    'unresolved_count', v_unresolved,
    'status', case when v_unresolved = 0 then 'complete' else 'incomplete' end
  );
end;
$$;

revoke all on function public.get_revenue_report_before_finality(uuid, date, date), public.get_profit_loss_summary_before_finality(uuid, date, date), public.get_room_profitability_summary_before_finality(uuid, date, date) from public, anon, authenticated;
revoke all on function public.get_revenue_report(uuid, date, date), public.get_profit_loss_summary(uuid, date, date), public.get_room_profitability_summary(uuid, date, date) from public;
grant execute on function public.get_revenue_report(uuid, date, date), public.get_profit_loss_summary(uuid, date, date), public.get_room_profitability_summary(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
