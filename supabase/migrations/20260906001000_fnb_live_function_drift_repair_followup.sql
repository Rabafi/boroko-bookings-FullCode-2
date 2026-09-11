-- Follow-up for two additional stale dynamic-SQL fragments exposed after the
-- first live F&B drift repair.
--
-- Fresh-chain portability (same acceptance contract as 20260730100000 and
-- 20260906000000): a fresh build may already carry the repaired form. Each
-- stage accepts stale-present (replace every occurrence, post-verify, mark
-- changed) or already-correct (explicit skip); anything else raises the
-- original fail-closed error. The events stages share one work variable
-- with a single EXECUTE so a half-rewritten function can never commit; the
-- remains-check proves no stale events query survives in any branch that
-- executes. All matchers are single-line, so byte matching is
-- checkout-independent (pinned by
-- tests/bar-migration-drift-fresh-chain.test.mjs). One DO block keeps the
-- file atomic. Each replacement is anchored and fails closed.

do $repair$
declare
  v_definition text;
  v_repaired text;
  v_work text;
  v_changed boolean;
  v_old_present boolean;
  v_new_present boolean;
begin
  -- Hunk 1: retired inventory purchased_at fragment in
  -- get_fnb_consolidated_report.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)'))
    into v_definition;
  if v_definition is null then
    raise exception 'get_fnb_consolidated_report(uuid,date,date,uuid) is missing';
  end if;
  v_old_present := position('select coalesce(sum(coalesce(total_cost, 0)), 0)::numeric from public.inventory_purchases where lodge_id = $1 and (purchased_at::date between $2 and $3 or created_at::date between $2 and $3)' in v_definition) > 0;
  v_new_present := position('select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))' in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, 'select coalesce(sum(coalesce(total_cost, 0)), 0)::numeric from public.inventory_purchases where lodge_id = $1 and (purchased_at::date between $2 and $3 or created_at::date between $2 and $3)', 'select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))');
    if position('select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))' in v_repaired) = 0 or position('select coalesce(sum(coalesce(total_cost, 0)), 0)::numeric from public.inventory_purchases where lodge_id = $1 and (purchased_at::date between $2 and $3 or created_at::date between $2 and $3)' in v_repaired) > 0 then
      raise exception 'inventory purchased_at rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'get_fnb_consolidated_report: stale inventory purchased_at fragment repaired';
  elsif v_new_present then
    raise notice 'get_fnb_consolidated_report: already in repaired form; skipping';
  else
    raise exception 'Expected stale inventory purchased_at fragment was not found';
  end if;

  -- Hunk 2: stale public.events references in get_fnb_demand_recommendations.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)'))
    into v_definition;
  if v_definition is null then
    raise exception 'get_fnb_demand_recommendations(uuid,date,uuid) is missing';
  end if;
  v_work := v_definition;
  v_changed := false;
  -- Stage A: events-table guard. The stale guard takes precedence when both
  -- forms are present; the post-checks below prove the guard is gone.
  v_old_present := position($old$if to_regclass('public.events') is not null then$old$ in v_work) > 0;
  v_new_present := position($new$if false then$new$ in v_work) > 0;
  if v_old_present then
    v_work := replace(v_work, $old$if to_regclass('public.events') is not null then$old$, $new$if false then$new$);
    v_changed := true;
  elsif not v_new_present then
    raise exception 'Expected stale public.events fragment was not found';
  else
    raise notice 'get_fnb_demand_recommendations: events guard already disabled; skipping stage';
  end if;
  -- Stage B: events count query. Same precedence: a present stale query is
  -- repaired even if an unrelated neutralized count already exists; the
  -- remains-check proves the stale query is gone.
  v_old_present := position('select count(*)::integer from public.events where lodge_id = $1 and (event_date = $2 or (start_date <= $2 and end_date >= $2))' in v_work) > 0;
  v_new_present := position('select 0::integer' in v_work) > 0;
  if v_old_present then
    v_work := replace(v_work, 'select count(*)::integer from public.events where lodge_id = $1 and (event_date = $2 or (start_date <= $2 and end_date >= $2))', 'select 0::integer');
    v_changed := true;
  elsif not v_new_present then
    raise exception 'Expected stale public.events fragment was not found';
  else
    raise notice 'get_fnb_demand_recommendations: events count already neutralized; skipping stage';
  end if;
  if position($old$if to_regclass('public.events') is not null then$old$ in v_work) > 0 then
    raise exception 'Stale public.events guard remains after repair';
  end if;
  if position('public.events where' in v_work) > 0 then
    raise exception 'Stale public.events query remains after repair';
  end if;
  if v_changed then
    execute v_work;
    raise notice 'get_fnb_demand_recommendations: stale public.events fragments repaired';
  else
    raise notice 'get_fnb_demand_recommendations: already in repaired form; skipping';
  end if;
end;
$repair$;
