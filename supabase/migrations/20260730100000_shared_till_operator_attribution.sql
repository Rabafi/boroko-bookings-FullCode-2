-- Shared Till unlocks are performed by a manager, but the open POS shift is
-- owned by the PIN-verified staff member. Orders must therefore be attributed
-- to that shift owner while retaining the authenticated manager in the audit
-- actor_id column. The old contract preferred app_current_user_id(), which
-- made every shared-terminal sale appear under the manager's cashier_id.
do $$
declare
  v_definition text;
  v_old text := $old$
  v_operator_id := coalesce(v_actor_id, v_shift.cashier_id);
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'Authenticated POS operator could not be resolved');
  end if;

  if not public.app_is_service_role()
     and v_shift.cashier_id is not null
     and v_shift.cashier_id <> v_operator_id
     and v_actor_role not in ('supervisor', 'manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'This operator is not assigned to the open shift');
  end if;
$old$;
  v_new text := $new$
  -- The manager who unlocked a shared Till remains the audit actor, while
  -- the PIN-verified staff member who owns the open shift is the operator.
  v_operator_id := coalesce(v_shift.cashier_id, v_actor_id);
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'Authenticated POS operator could not be resolved');
  end if;

  -- Do not let a cashier select another staff member's shift. Managers and
  -- supervisors may operate a shared shift after the server has validated it.
  if not public.app_is_service_role()
     and v_shift.cashier_id is not null
     and v_actor_id is not null
     and v_shift.cashier_id <> v_actor_id
     and v_actor_role not in ('supervisor', 'manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'This operator is not assigned to the open shift');
  end if;
$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences = 0 then
    raise exception 'create_pos_order_v3 operator attribution contract is not in the expected form';
  end if;
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 operator attribution contract is ambiguous';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$
