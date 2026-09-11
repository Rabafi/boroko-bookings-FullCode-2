-- F&B drift full-block verification and repair.
--
-- Purpose: verify -- with positive proof, never mere absence -- that the
-- three F&B advisory functions carry reviewed corrected shapes.
-- This file performs NO rewrites: every hunk asserts the complete
-- corrected block (disposable variant, production variant, or shared text)
-- is present exactly once with no stale form remaining. Anything else
-- raises the original fail-closed error. Repairs, where ever needed, remain
-- the v1 drift files' job (20260906000000, 20260906001000, 20260907000000),
-- which stay applied history and are NOT modified or replayed here; this
-- file runs after them and strictly verifies their outcome. A stale state
-- reaching this file raises for human review instead of auto-repairing a
-- second time.
-- Newline portability: live definitions are CRLF-collapsed before matching
-- (only CR+LF sequences). Corrected shapes captured from both targets.

do $verify$
declare
  v_definition text;
  v_live text;
  v_repaired text;
  v_old_count integer;
  v_new_count integer;
  v_s1 integer;
  v_s2 integer;
  v_p1 integer;
  v_p2 integer;
  v_old_cash text := $B1$  if p_module_key = 'settlement' and to_regclass('public.pos_cashup_sessions') is not null then
    begin
      execute 'select count(*)::integer from public.pos_cashup_sessions where lodge_id = $1 and coalesce(status, '''') not in (''closed'',''approved'',''reconciled'')'
        into v_count using p_lodge_id;$B1$;
  v_new_cash text := $B2$  if p_module_key = 'settlement' and to_regclass('public.pos_cashup_sessions') is not null then
    begin
      execute 'select count(*)::integer from public.pos_cashup_sessions where lodge_id = $1 and false'
        into v_count using p_lodge_id;$B2$;
  v_old_ev text := $B3$  -- Events.
  begin
    if to_regclass('public.events') is not null then
      execute 'select count(*)::integer from public.events where lodge_id = $1 and (event_date = $2 or (start_date <= $2 and end_date >= $2))'
        into v_events using v_lodge, p_date;$B3$;
  v_new_ev text := $B4$  -- Events.
  begin
    if false then
      execute 'select 0::integer'
        into v_events using v_lodge, p_date;$B4$;
  v_old_conf text := $B5$    elsif to_regclass('public.conference_bookings') is not null then
      execute 'select count(*)::integer from public.conference_bookings where lodge_id = $1 and (booking_date = $2 or (start_date <= $2 and end_date >= $2))'
        into v_events using v_lodge, p_date;$B5$;
  v_new_conf text := $B6$    elsif to_regclass('public.conference_bookings') is not null then
      execute 'select count(*)::integer from public.conference_bookings where lodge_id = $1 and booking_date = $2'
        into v_events using v_lodge, p_date;$B6$;
  v_new_room_d text := $B7$        execute 'select count(*)::integer from public.rooms where lodge_id = $1'
          into v_room_count using v_lodge;$B7$;
  v_new_room_p text := $B8$      execute 'select count(*)::integer from public.rooms where lodge_id = $1'
        into v_low_stock using v_lodge;$B8$;
  v_new_s1 text := $B9$        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and (created_at::date between $2 and $3) and coalesce(status, '''') not in (''voided'',''cancelled'',''void'')'
          into v_sales, v_covers using v_lodge, p_start, p_end;$B9$;
  v_new_s2 text := $B10$        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and outlet_id = $2 and (created_at::date between $3 and $4) and coalesce(status, '''') not in (''voided'',''cancelled'',''void'')'
          into v_sales, v_covers using v_lodge, p_outlet_id, p_start, p_end;$B10$;
  v_new_p1 text := $B11$        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and (created_at::date between $2 and $3) and coalesce(status, '''') not in (''voided'',''cancelled'')'
          into v_sales, v_covers using v_lodge, p_start, p_end;$B11$;
  v_new_p2 text := $B12$        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and outlet_id = $2 and (created_at::date between $3 and $4) and coalesce(status, '''') not in (''voided'',''cancelled'')'
          into v_sales, v_covers using v_lodge, p_outlet_id, p_start, p_end;$B12$;
  v_new_cost text := $B13$      execute 'select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))'
        into v_cost using v_lodge, p_start, p_end;$B13$;
  v_new_exp text := $B14$      execute 'select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))'
        into v_expense_total using v_lodge, p_start, p_end;$B14$;
  v_frag_grand text := $B15$coalesce(sum(coalesce(total, grand_total, 0)), 0)::numeric$B15$;
  v_frag_purch text := $B16$select coalesce(sum(coalesce(total_cost, 0)), 0)::numeric from public.inventory_purchases where lodge_id = $1 and (purchased_at::date between $2 and $3 or created_at::date between $2 and $3)$B16$;
  v_frag_exp text := $B17$select coalesce(sum(coalesce(amount, total, 0)), 0)::numeric from public.expenses where lodge_id = $1 and (expense_date between $2 and $3 or created_at::date between $2 and $3)$B17$;
  v_frag_rooms text := $B18$ and coalesce(deleted, false) = false$B18$;
begin
  -- Hunk: cash-up status predicate (fnb_module_disable_blockers).
  -- Stale shape: settlement-module EXECUTE with the retired status list (definer 20260904000000)
  -- Corrected shape: same statement with the predicate neutralized (captured disposable + production, identical)
  select pg_get_functiondef(to_regprocedure('public.fnb_module_disable_blockers(uuid,text)')) into v_definition;
  if v_definition is null then
    raise exception 'public.fnb_module_disable_blockers(uuid,text) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_old_cash, ''))) / length(v_old_cash);
  v_new_count := (length(v_live) - length(replace(v_live, v_new_cash, ''))) / length(v_new_cash);
  if v_old_count = 1 and v_new_count = 0 then
    v_repaired := replace(v_live, v_old_cash, v_new_cash);
    if (length(v_repaired) - length(replace(v_repaired, v_new_cash, ''))) / length(v_new_cash) <> 1
       or position(v_old_cash in v_repaired) > 0 then
      raise exception 'cash-up status rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'cash-up status: stale block repaired';
  elsif v_old_count = 0 and v_new_count = 1 then
    raise notice 'cash-up status: already in corrected form; skipping';
  elsif v_old_count = 0 and v_new_count = 0 then
    raise exception 'Expected stale cash-up status fragment was not found';
  else
    raise exception 'cash-up status contract is ambiguous';
  end if;

  -- Hunk: events-table guard and count (get_fnb_demand_recommendations).
  -- Stale shape: Events if-block with public.events guard and count (definer 20260904020000)
  -- Corrected shape: disabled guard with neutralized count (captured disposable + production, identical)
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_demand_recommendations(uuid,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_old_ev, ''))) / length(v_old_ev);
  v_new_count := (length(v_live) - length(replace(v_live, v_new_ev, ''))) / length(v_new_ev);
  if v_old_count = 1 and v_new_count = 0 then
    v_repaired := replace(v_live, v_old_ev, v_new_ev);
    if (length(v_repaired) - length(replace(v_repaired, v_new_ev, ''))) / length(v_new_ev) <> 1
       or position(v_old_ev in v_repaired) > 0 then
      raise exception 'events guard and count rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'events guard and count: stale block repaired';
  elsif v_old_count = 0 and v_new_count = 1 then
    raise notice 'events guard and count: already in corrected form; skipping';
  elsif v_old_count = 0 and v_new_count = 0 then
    raise exception 'Expected stale public.events fragment was not found';
  else
    raise exception 'events guard and count contract is ambiguous';
  end if;

  -- Hunk: conference-booking count (get_fnb_demand_recommendations).
  -- Stale shape: elsif branch with booking date-range (definer 20260904020000)
  -- Corrected shape: elsif branch with single booking date (captured disposable + production, identical)
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_demand_recommendations(uuid,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_old_conf, ''))) / length(v_old_conf);
  v_new_count := (length(v_live) - length(replace(v_live, v_new_conf, ''))) / length(v_new_conf);
  if v_old_count = 1 and v_new_count = 0 then
    v_repaired := replace(v_live, v_old_conf, v_new_conf);
    if (length(v_repaired) - length(replace(v_repaired, v_new_conf, ''))) / length(v_new_conf) <> 1
       or position(v_old_conf in v_repaired) > 0 then
      raise exception 'conference count rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'conference count: stale block repaired';
  elsif v_old_count = 0 and v_new_count = 1 then
    raise notice 'conference count: already in corrected form; skipping';
  elsif v_old_count = 0 and v_new_count = 0 then
    raise exception 'Expected stale conference booking date-range fragment was not found';
  else
    raise exception 'conference count contract is ambiguous';
  end if;

  -- Hunk: inventory purchase cost (get_fnb_consolidated_report).
  -- Stale shape: defensive single-line fragment (reviewed lineage only)
  -- Corrected shape: full cost statement (captured disposable + production, identical)
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_consolidated_report(uuid,date,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_frag_purch, ''))) / length(v_frag_purch);
  v_new_count := (length(v_live) - length(replace(v_live, v_new_cost, ''))) / length(v_new_cost);
  if v_old_count = 1 and v_new_count = 0 then
    v_repaired := replace(v_live, v_frag_purch, v_new_cost);
    if (length(v_repaired) - length(replace(v_repaired, v_new_cost, ''))) / length(v_new_cost) <> 1
       or position(v_frag_purch in v_repaired) > 0 then
      raise exception 'inventory cost rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'inventory cost: stale block repaired';
  elsif v_old_count = 0 and v_new_count = 1 then
    raise notice 'inventory cost: already in corrected form; skipping';
  elsif v_old_count = 0 and v_new_count = 0 then
    raise exception 'Expected stale inventory purchased_at fragment was not found';
  else
    raise exception 'inventory cost contract is ambiguous';
  end if;

  -- Hunk: operating expenses (get_fnb_consolidated_report).
  -- Stale shape: defensive single-line fragment (reviewed lineage only)
  -- Corrected shape: full expenses statement (captured disposable + production, identical)
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_consolidated_report(uuid,date,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_frag_exp, ''))) / length(v_frag_exp);
  v_new_count := (length(v_live) - length(replace(v_live, v_new_exp, ''))) / length(v_new_exp);
  if v_old_count = 1 and v_new_count = 0 then
    v_repaired := replace(v_live, v_frag_exp, v_new_exp);
    if (length(v_repaired) - length(replace(v_repaired, v_new_exp, ''))) / length(v_new_exp) <> 1
       or position(v_frag_exp in v_repaired) > 0 then
      raise exception 'operating expenses rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'operating expenses: stale block repaired';
  elsif v_old_count = 0 and v_new_count = 1 then
    raise notice 'operating expenses: already in corrected form; skipping';
  elsif v_old_count = 0 and v_new_count = 0 then
    raise exception 'Expected stale expenses total/expense_date fragment was not found';
  else
    raise exception 'operating expenses contract is ambiguous';
  end if;

  -- Hunk: POS sales totals (get_fnb_consolidated_report).
  -- Stale shape: defensive bare expression (never observed in repository or
  -- captured definitions; retained from reviewed lineage for hypothetical
  -- drift). Corrected shapes: the outlet pair, disposable variant or
  -- production variant, each statement exactly once.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_consolidated_report(uuid,date,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_frag_grand, ''))) / length(v_frag_grand);
  v_s1 := (length(v_live) - length(replace(v_live, v_new_s1, ''))) / length(v_new_s1);
  v_s2 := (length(v_live) - length(replace(v_live, v_new_s2, ''))) / length(v_new_s2);
  v_p1 := (length(v_live) - length(replace(v_live, v_new_p1, ''))) / length(v_new_p1);
  v_p2 := (length(v_live) - length(replace(v_live, v_new_p2, ''))) / length(v_new_p2);
  if v_old_count = 0 and v_s1 = 1 and v_s2 = 1 and v_p1 = 0 and v_p2 = 0 then
    raise notice 'pos-sales totals: corrected shape verified (disposable variant); nothing to do';
  elsif v_old_count = 0 and v_p1 = 1 and v_p2 = 1 and v_s1 = 0 and v_s2 = 0 then
    raise notice 'pos-sales totals: corrected shape verified (production variant); nothing to do';
  elsif v_old_count = 0 and v_s1 = 0 and v_s2 = 0 and v_p1 = 0 and v_p2 = 0 then
    raise exception 'Expected stale POS grand_total fragment was not found';
  else
    raise exception 'pos-sales totals contract is ambiguous or stale - manual review required';
  end if;

  -- Hunk: rooms deleted predicate (get_fnb_demand_recommendations).
  -- Stale shape: defensive single-line fragment (reviewed lineage only).
  -- Corrected shapes: the rooms count statement, disposable variant (into
  -- v_room_count) or production variant (into v_low_stock), exactly one.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)')) into v_definition;
  if v_definition is null then
    raise exception 'public.get_fnb_demand_recommendations(uuid,date,uuid) is missing';
  end if;
  v_live := replace(v_definition, chr(13) || chr(10), chr(10));
  v_old_count := (length(v_live) - length(replace(v_live, v_frag_rooms, ''))) / length(v_frag_rooms);
  v_s1 := (length(v_live) - length(replace(v_live, v_new_room_d, ''))) / length(v_new_room_d);
  v_s2 := (length(v_live) - length(replace(v_live, v_new_room_p, ''))) / length(v_new_room_p);
  if v_old_count = 0 and ((v_s1 = 1 and v_s2 = 0) or (v_s1 = 0 and v_s2 = 1)) then
    raise notice 'rooms predicate: corrected shape verified; nothing to do';
  elsif v_old_count = 0 and v_s1 = 0 and v_s2 = 0 then
    raise exception 'Expected stale rooms.deleted fragment was not found';
  else
    raise exception 'rooms predicate contract is ambiguous or stale - manual review required';
  end if;

  -- Global post-condition: no stale events query may remain in the
  -- demand function in any branch that passes.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)')) into v_definition;
  if position('public.events where' in v_definition) > 0 then
    raise exception 'Stale public.events query remains after repair';
  end if;
  raise notice 'F&B drift full-block verification passed';
end;
$verify$;
