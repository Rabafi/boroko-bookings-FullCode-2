-- Retained refund fees must come from the refund approval ledger.
-- A cancelled booking's original positive payments are not retained revenue.

begin;

alter function public.get_revenue_report(uuid, date, date)
  rename to get_revenue_report_before_refund_fee_fix;

create function public.get_revenue_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_report jsonb;
  v_retained_revenue numeric := 0;
  v_retained_count integer := 0;
begin
  v_report := public.get_revenue_report_before_refund_fee_fix(
    p_lodge_id,
    p_start_date,
    p_end_date
  );

  select
    coalesce(sum(greatest(coalesce(r.retained_amount, 0), 0)), 0),
    count(distinct r.booking_id) filter (where coalesce(r.retained_amount, 0) > 0)
    into v_retained_revenue, v_retained_count
  from public.refund_approval_log r
  where r.lodge_id = p_lodge_id
    and r.created_at >= p_start_date::timestamptz
    and r.created_at < (p_end_date + 1)::timestamptz;

  return jsonb_set(
    jsonb_set(
      coalesce(v_report, '{}'::jsonb),
      '{retained_revenue}',
      to_jsonb(round(coalesce(v_retained_revenue, 0)::numeric, 2)),
      true
    ),
    '{retained_count}',
    to_jsonb(coalesce(v_retained_count, 0)),
    true
  );
end;
$function$;

revoke all on function public.get_revenue_report_before_refund_fee_fix(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_revenue_report(uuid, date, date) from public;
grant execute on function public.get_revenue_report(uuid, date, date)
  to anon, authenticated, service_role;

alter function public.get_reports_snapshot(uuid, date)
  rename to get_reports_snapshot_before_refund_fee_fix;

create function public.get_reports_snapshot(
  p_lodge_id uuid,
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_today, current_date);
  v_month_start date := date_trunc('month', v_today::timestamp)::date;
  v_month_end_exclusive date := (date_trunc('month', v_today::timestamp) + interval '1 month')::date;
  v_last_month_start date := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;
  v_report jsonb;
  v_month_retained_revenue numeric := 0;
  v_last_month_retained_revenue numeric := 0;
  v_month_retained_count integer := 0;
  v_last_month_retained_count integer := 0;
begin
  v_report := public.get_reports_snapshot_before_refund_fee_fix(p_lodge_id, v_today);

  select
    coalesce(sum(greatest(coalesce(r.retained_amount, 0), 0)), 0),
    count(distinct r.booking_id) filter (where coalesce(r.retained_amount, 0) > 0)
    into v_month_retained_revenue, v_month_retained_count
  from public.refund_approval_log r
  where r.lodge_id = p_lodge_id
    and r.created_at >= v_month_start::timestamptz
    and r.created_at < v_month_end_exclusive::timestamptz;

  select
    coalesce(sum(greatest(coalesce(r.retained_amount, 0), 0)), 0),
    count(distinct r.booking_id) filter (where coalesce(r.retained_amount, 0) > 0)
    into v_last_month_retained_revenue, v_last_month_retained_count
  from public.refund_approval_log r
  where r.lodge_id = p_lodge_id
    and r.created_at >= v_last_month_start::timestamptz
    and r.created_at < v_month_start::timestamptz;

  return jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(v_report, '{}'::jsonb),
          '{monthRetainedRevenue}',
          to_jsonb(round(coalesce(v_month_retained_revenue, 0)::numeric, 2)),
          true
        ),
        '{lastMonthRetainedRevenue}',
        to_jsonb(round(coalesce(v_last_month_retained_revenue, 0)::numeric, 2)),
        true
      ),
      '{monthRetainedCount}',
      to_jsonb(coalesce(v_month_retained_count, 0)),
      true
    ),
    '{lastMonthRetainedCount}',
    to_jsonb(coalesce(v_last_month_retained_count, 0)),
    true
  );
end;
$function$;

revoke all on function public.get_reports_snapshot_before_refund_fee_fix(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_reports_snapshot(uuid, date) from public;
grant execute on function public.get_reports_snapshot(uuid, date)
  to anon, authenticated, service_role;

commit;
