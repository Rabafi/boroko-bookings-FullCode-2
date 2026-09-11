-- Repair three live F&B function bodies whose migration versions match the
-- repository but whose deployed definitions still reference retired columns.
--
-- Fresh-chain portability (same acceptance contract as 20260730100000): a
-- fresh build from the repository may already carry the repaired form (no
-- drift ever existed). Each hunk therefore accepts two verified states and
-- rejects the rest, preserving the original replace-all semantics:
--   stale present (old found at least once) -> replace every occurrence,
--     post-verify (old gone, repaired present), then EXECUTE;
--   already-correct (old absent and the repaired form present; or old
--     absent for a removal) -> explicit NOTICE no-op, never a silent pass;
--   unknown (old absent and repaired absent) -> raise the original
--     fail-closed error, so an unknown function version can never be
--     silently rewritten.
-- No CRLF-normalization branch is needed: every matcher fragment below is
-- a single line, so byte matching is already checkout-independent (pinned
-- by tests/bar-migration-drift-fresh-chain.test.mjs). One DO block keeps
-- the file atomic. Fail closed when the expected live fragment is absent
-- so this migration cannot silently rewrite an unknown function version.

do $repair$
declare
  v_definition text;
  v_repaired text;
  v_old_present boolean;
  v_new_present boolean;
begin
  -- Hunk 1: cash-up status predicate in fnb_module_disable_blockers.
  select pg_get_functiondef(to_regprocedure('public.fnb_module_disable_blockers(uuid,text)'))
    into v_definition;
  if v_definition is null then
    raise exception 'fnb_module_disable_blockers(uuid,text) is missing';
  end if;
  v_old_present := position($old$coalesce(status, '''') not in (''closed'',''approved'',''reconciled'')$old$ in v_definition) > 0;
  v_new_present := position($new$false$new$ in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, $old$coalesce(status, '''') not in (''closed'',''approved'',''reconciled'')$old$, $new$false$new$);
    if position($new$false$new$ in v_repaired) = 0 or position($old$coalesce(status, '''') not in (''closed'',''approved'',''reconciled'')$old$ in v_repaired) > 0 then
      raise exception 'cash-up status rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'fnb_module_disable_blockers: stale cash-up status fragment repaired';
  elsif v_new_present then
    raise notice 'fnb_module_disable_blockers: already in repaired form; skipping';
  else
    raise exception 'Expected stale cash-up status fragment was not found';
  end if;

  -- Hunk 2: POS grand_total fragment in get_fnb_consolidated_report.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_consolidated_report(uuid,date,date,uuid)'))
    into v_definition;
  if v_definition is null then
    raise exception 'get_fnb_consolidated_report(uuid,date,date,uuid) is missing';
  end if;
  v_old_present := position('coalesce(sum(coalesce(total, grand_total, 0)), 0)::numeric' in v_definition) > 0;
  v_new_present := position('sum(total)::numeric' in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, 'coalesce(sum(coalesce(total, grand_total, 0)), 0)::numeric', 'sum(total)::numeric');
    if position('sum(total)::numeric' in v_repaired) = 0 or position('coalesce(sum(coalesce(total, grand_total, 0)), 0)::numeric' in v_repaired) > 0 then
      raise exception 'POS grand_total rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'get_fnb_consolidated_report: stale POS grand_total fragment repaired';
  elsif v_new_present then
    raise notice 'get_fnb_consolidated_report: already in repaired form; skipping';
  else
    raise exception 'Expected stale POS grand_total fragment was not found';
  end if;

  -- Hunk 3: retired rooms.deleted predicate in get_fnb_demand_recommendations.
  -- The repair removes the predicate, so "already correct" is simply its
  -- absence; there is no replacement text to look for.
  select pg_get_functiondef(to_regprocedure('public.get_fnb_demand_recommendations(uuid,date,uuid)'))
    into v_definition;
  if v_definition is null then
    raise exception 'get_fnb_demand_recommendations(uuid,date,uuid) is missing';
  end if;
  v_old_present := position(' and coalesce(deleted, false) = false' in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, ' and coalesce(deleted, false) = false', '');
    if position(' and coalesce(deleted, false) = false' in v_repaired) > 0 then
      raise exception 'rooms.deleted rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice 'get_fnb_demand_recommendations: stale rooms.deleted fragment repaired';
  else
    raise notice 'get_fnb_demand_recommendations: rooms.deleted predicate already absent; skipping';
  end if;
end;
$repair$;
