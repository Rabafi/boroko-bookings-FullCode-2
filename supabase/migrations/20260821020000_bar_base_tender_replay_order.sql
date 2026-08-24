-- Keep commercial tender enforcement on new POS work while allowing an
-- unambiguous retry to reach the existing authoritative replay contract.
-- 20260820190000 inserted the guard before each order's replay path.  This
-- forward-only repair moves that guard after replay/claim resolution without
-- changing 19000 or weakening its entitlement helper.
begin;

do $do$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
  v_signature text;
  v_guard_marker text := 'v_bar_tender_error := public.pos_bar_tender_entitlement_error(v_lodge_id, payload);';
  v_guard_anchor text;
  v_guard_start integer;
  v_guard_end integer;
  v_anchor_pos integer;
  v_anchor_relative integer;
  v_occurrences integer;
  v_guard text := $guard$  v_bar_tender_error := public.pos_bar_tender_entitlement_error(v_lodge_id, payload);
  if v_bar_tender_error is not null then
    return jsonb_build_object('success', false, 'error', v_bar_tender_error, 'code', 'commercial_entitlement_blocked');
  end if;
$guard$;
begin
  -- Legacy create_pos_order has a table-backed replay lookup.  Leave its
  -- lodge/outlet checks intact, remove the pre-replay guard, then insert the
  -- same guard immediately before the first authoritative item mutation.
  v_signature := 'public.create_pos_order(jsonb)';
  v_oid := to_regprocedure(v_signature)::oid;
  if v_oid is null then
    raise exception 'Required POS order RPC is missing: %', v_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'The 19000 Bar tender guard is missing from %', v_signature;
  end if;

  v_guard_start := position(v_guard_marker in v_definition);
  v_guard_anchor := 'perform public.app_require_lodge_role(v_lodge_id,';
  v_anchor_relative := position(v_guard_anchor in substring(v_definition from v_guard_start));
  if v_guard_start = 0 or v_anchor_relative = 0 then
    raise exception 'The pre-replay Bar tender guard anchor is missing from %', v_signature;
  end if;
  v_guard_end := v_guard_start + v_anchor_relative - 1;
  v_patched := substr(v_definition, 1, v_guard_start - 1)
    || substr(v_definition, v_guard_end);

  v_guard_anchor := 'for v_item in select * from jsonb_array_elements(v_items) loop';
  v_occurrences := (length(v_patched) - length(replace(v_patched, v_guard_anchor, ''))) / length(v_guard_anchor);
  if v_occurrences <> 2 then
    raise exception 'The post-replay item anchor is ambiguous or missing from %', v_signature;
  end if;
  v_anchor_pos := position(v_guard_anchor in v_patched);
  v_patched := substr(v_patched, 1, v_anchor_pos - 1)
    || v_guard
    || substr(v_patched, v_anchor_pos);
  execute v_patched;

  -- create_pos_order_v3 claims the financial operation before loading the
  -- snapshot.  Replays/conflicts therefore return first; a newly claimed
  -- operation is guarded before any stock/order mutation.  A rejected new
  -- operation rolls back the pending claim in the same transaction.
  v_signature := 'public.create_pos_order_v3(jsonb)';
  v_oid := to_regprocedure(v_signature)::oid;
  if v_oid is null then
    raise exception 'Required POS order RPC is missing: %', v_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if position('v_bar_tender_error text;' in v_definition) = 0 then
    raise exception 'The 19000 Bar tender guard is missing from %', v_signature;
  end if;

  v_guard_start := position(v_guard_marker in v_definition);
  v_guard_anchor := 'if jsonb_typeof(v_items)';
  v_anchor_relative := position(v_guard_anchor in substring(v_definition from v_guard_start));
  if v_guard_start = 0 or v_anchor_relative = 0 then
    raise exception 'The pre-claim Bar tender guard anchor is missing from %', v_signature;
  end if;
  v_guard_end := v_guard_start + v_anchor_relative - 1;
  v_patched := substr(v_definition, 1, v_guard_start - 1)
    || substr(v_definition, v_guard_end);

  v_guard_anchor := 'select s.*' || E'\n    into v_snapshot';
  v_occurrences := (length(v_patched) - length(replace(v_patched, v_guard_anchor, ''))) / length(v_guard_anchor);
  if v_occurrences <> 1 then
    raise exception 'The post-claim snapshot anchor is ambiguous or missing from %', v_signature;
  end if;
  v_anchor_pos := position(v_guard_anchor in v_patched);
  v_patched := substr(v_patched, 1, v_anchor_pos - 1)
    || v_guard
    || substr(v_patched, v_anchor_pos);
  execute v_patched;
end;
$do$;

commit;
