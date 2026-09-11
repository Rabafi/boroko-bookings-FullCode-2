-- Mandatory tab version and lodge waiter attribution for v3 settlement (P0).
--
-- 1. expected_tab_version is now required for every non-null tab_id. Version
--    checks previously ran only when supplied, so older clients could settle
--    without optimistic concurrency. Absent or non-positive versions fail
--    closed before anything is recorded. Exact replays are unaffected (the
--    claim block returns the stored result first) and legacy flows never
--    send tab_id.
-- 2. Tab resolve-or-create preserves the validated payload waiter for
--    non-Bar scopes instead of stamping the shift cashier as the serving
--    waiter. Bar scope keeps the proof-verified operator. The nested upsert
--    already rejects waiters without an open outlet shift, so an unknown
--    waiter cannot slip through.

begin;

do $pre$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  if position('Tab lock, status/version validation, and ownership run AFTER' in v_definition) = 0 then
    raise exception 'Claim-first tab preamble is missing; apply 20260905233000 first';
  end if;
end
$pre$;

do $do$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  -- 1. Require a positive expected_tab_version for every tab settlement.
  v_old := $old$  if v_tab_id is not null then
    select t.status, t.tab_version$old$;
  v_new := $new$  if v_tab_id is not null then
    if nullif(payload->>'expected_tab_version', '') is null
       or nullif(payload->>'expected_tab_version', '') !~ '^[0-9]+$'
       or (payload->>'expected_tab_version')::integer <= 0 then
      return jsonb_build_object('success', false, 'code', 'tab_version_required', 'error', 'This sale is missing its tab version. Refresh the open check before taking payment.');
    end if;
    select t.status, t.tab_version$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Tab preamble anchor is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- 2. Attribute resolve-or-create tabs to the validated payload waiter
  -- outside Bar scope; Bar scope keeps the proof-verified operator.
  v_old := $old$      'waiter_id', v_operator_id,$old$;
  v_new := $new$      'waiter_id', case when public._pos_tab_is_bar_scope(v_lodge_id) then v_operator_id else coalesce(nullif(payload->>'waiter_id', '')::uuid, v_operator_id) end,$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'Tab resolve waiter anchor is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end
$do$;

commit;
