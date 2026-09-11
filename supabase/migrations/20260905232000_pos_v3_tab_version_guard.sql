-- Optimistic concurrency for resumed tab settlement (P0 follow-up).
--
-- Terminals that resume an existing tab forward the version they loaded as
-- expected_tab_version. When present, create_pos_order_v3 rejects the
-- payment if the locked tab row has moved on (another terminal changed the
-- check after resume), before anything is recorded. Absent versions keep
-- the existing behavior for older flows. Exact idempotent replays are
-- unaffected (the claim block returns the stored result first).

begin;

do $do$
declare
  v_definition text;
  v_old text := $old$  v_tab_status text;$old$;
  v_new text := $new$  v_tab_status text;
  v_tab_version integer;
  v_expected_tab_version integer;$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  if position('pos_tab_settled' in v_definition) = 0 then
    raise exception 'Atomic tab settlement is missing; apply 20260905230000 first';
  end if;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab lock declaration is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$  if v_tab_id is not null then
    select t.status
      into v_tab_status
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
    end if;
    if v_tab_status not in ('open', 'running', 'ready', 'delivered') then
      return jsonb_build_object('success', false, 'code', 'tab_already_settled', 'error', 'This tab is already closed. Refresh open tabs before taking payment.');
    end if;
  end if;$old$;
  v_new := $new$  if v_tab_id is not null then
    select t.status, t.tab_version
      into v_tab_status, v_tab_version
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
    end if;
    if v_tab_status not in ('open', 'running', 'ready', 'delivered') then
      return jsonb_build_object('success', false, 'code', 'tab_already_settled', 'error', 'This tab is already closed. Refresh open tabs before taking payment.');
    end if;
    if nullif(payload->>'expected_tab_version', '') is not null then
      if nullif(payload->>'expected_tab_version', '') !~ '^[0-9]+$' then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.');
      end if;
      v_expected_tab_version := (payload->>'expected_tab_version')::integer;
      if v_expected_tab_version <> v_tab_version then
        return jsonb_build_object('success', false, 'code', 'tab_version_conflict', 'error', 'This tab changed on another terminal. Refresh it before taking payment.', 'tab_version', v_tab_version);
      end if;
    end if;
  end if;$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab lock block is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

commit;
