-- Final anchored repairs for stale dynamic SQL exposed by live plpgsql_check.
--
-- Fresh-chain portability (same acceptance contract as 20260730100000,
-- 20260906000000, and 20260906001000): a fresh build may already carry the
-- repaired form. Each hunk accepts stale-present (replace every occurrence,
-- post-verify, EXECUTE) or already-correct (explicit NOTICE no-op); anything
-- else raises the original fail-closed error. All matchers are single-line,
-- so byte matching is checkout-independent (pinned by
-- tests/bar-migration-drift-fresh-chain.test.mjs). One DO block keeps the
-- file atomic. Fail closed if the deployed definitions no longer contain
-- the expected text.

do $repair$
declare
  v_definition text;
  v_repaired text;
  v_old_present boolean;
  v_new_present boolean;
begin
  -- Hunk 1: retired expenses total/expense_date fragment in
  -- get_fnb_consolidated_report.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)')) into v_definition;
  if v_definition is null then raise exception 'get_fnb_consolidated_report(uuid,date,date,uuid) is missing'; end if;
  v_old_present := position('select coalesce(sum(coalesce(amount, total, 0)), 0)::numeric from public.expenses where lodge_id = $1 and (expense_date between $2 and $3 or created_at::date between $2 and $3)' in v_definition) > 0;
  v_new_present := position('select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))' in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, 'select coalesce(sum(coalesce(amount, total, 0)), 0)::numeric from public.expenses where lodge_id = $1 and (expense_date between $2 and $3 or created_at::date between $2 and $3)', 'select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))');
    if position('select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))' in v_repaired) = 0 or position('select coalesce(sum(coalesce(amount, total, 0)), 0)::numeric from public.expenses where lodge_id = $1 and (expense_date between $2 and $3 or created_at::date between $2 and $3)' in v_repaired) > 0 then raise exception 'expenses total/expense_date rewrite did not install cleanly'; end if;
    execute v_repaired;
    raise notice 'get_fnb_consolidated_report: stale expenses total/expense_date fragment repaired';
  elsif v_new_present then
    raise notice 'get_fnb_consolidated_report: already in repaired form; skipping';
  else
    raise exception 'Expected stale expenses total/expense_date fragment was not found';
  end if;
  -- Hunk 2: retired conference-booking date-range fragment in
  -- get_fnb_demand_recommendations.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)')) into v_definition;
  if v_definition is null then raise exception 'get_fnb_demand_recommendations(uuid,date,uuid) is missing'; end if;
  v_old_present := position('select count(*)::integer from public.conference_bookings where lodge_id = $1 and (booking_date = $2 or (start_date <= $2 and end_date >= $2))' in v_definition) > 0;
  v_new_present := position('select count(*)::integer from public.conference_bookings where lodge_id = $1 and booking_date = $2' in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, 'select count(*)::integer from public.conference_bookings where lodge_id = $1 and (booking_date = $2 or (start_date <= $2 and end_date >= $2))', 'select count(*)::integer from public.conference_bookings where lodge_id = $1 and booking_date = $2');
    if position('select count(*)::integer from public.conference_bookings where lodge_id = $1 and booking_date = $2' in v_repaired) = 0 or position('select count(*)::integer from public.conference_bookings where lodge_id = $1 and (booking_date = $2 or (start_date <= $2 and end_date >= $2))' in v_repaired) > 0 then raise exception 'conference booking date-range rewrite did not install cleanly'; end if;
    execute v_repaired;
    raise notice 'get_fnb_demand_recommendations: stale conference booking date-range fragment repaired';
  elsif v_new_present then
    raise notice 'get_fnb_demand_recommendations: already in repaired form; skipping';
  else
    raise exception 'Expected stale conference booking date-range fragment was not found';
  end if;
end;
$repair$;
