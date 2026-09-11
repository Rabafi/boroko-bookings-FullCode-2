-- Shared Till unlocks are performed by a manager, but the open POS shift is
-- owned by the PIN-verified staff member. Orders must therefore be attributed
-- to that shift owner while retaining the authenticated manager in the audit
-- actor_id column. The old contract preferred app_current_user_id(), which
-- made every shared-terminal sale appear under the manager's cashier_id.
do $$
declare
  v_definition text;
  v_live text;
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
  v_new_count integer;
  v_result text;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  -- Newline portability: the dollar-quoted matcher blocks above carry this
  -- file's own checkout line endings (CRLF or LF), while pg_get_functiondef
  -- returns the stored definition (LF when installed from LF bytes). Match
  -- byte-exactly first to preserve the legacy path bit-for-bit; otherwise
  -- compare with carriage returns normalized on BOTH sides. Only CRLF
  -- sequences are collapsed: lone carriage returns, spaces, and all other
  -- bytes still participate in matching, so a missing or changed contract
  -- keeps failing instead of matching loosely. The swapped blocks contain
  -- no embedded newlines inside string literals (single-line error texts
  -- only), so CRLF->LF normalization cannot alter literal content.
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  v_new_count := (length(v_definition) - length(replace(v_definition, v_new, ''))) / length(v_new);
  if v_occurrences = 1 and v_new_count = 0 then
    v_result := replace(v_definition, v_old, v_new);
  else
    v_live := replace(v_definition, chr(13) || chr(10), chr(10));
    v_old := replace(v_old, chr(13) || chr(10), chr(10));
    v_new := replace(v_new, chr(13) || chr(10), chr(10));
    v_occurrences := (length(v_live) - length(replace(v_live, v_old, ''))) / length(v_old);
    v_new_count := (length(v_live) - length(replace(v_live, v_new, ''))) / length(v_new);
    if v_occurrences = 1 and v_new_count = 0 then
      v_result := replace(v_live, v_old, v_new);
    elsif v_occurrences = 0 and v_new_count = 1 then
      -- The exact intended new contract is already installed (for example
      -- a prior attempt committed the rewrite before halting elsewhere).
      -- This explicit branch proves the target state; it never stands in
      -- for a missing or ambiguous contract.
      raise notice 'create_pos_order_v3 operator attribution repair already installed; skipping rewrite';
      return;
    elsif v_occurrences = 0 then
      raise exception 'create_pos_order_v3 operator attribution contract is not in the expected form';
    else
      raise exception 'create_pos_order_v3 operator attribution contract is ambiguous';
    end if;
  end if;
  -- Verify the rewritten statement before executing: the new block exactly
  -- once, the old block fully gone. Anything else aborts instead of
  -- installing a half-rewritten function.
  if (length(v_result) - length(replace(v_result, v_new, ''))) / length(v_new) <> 1 then
    raise exception 'create_pos_order_v3 operator attribution rewrite did not install the new block exactly once';
  end if;
  if position(v_old in v_result) <> 0 then
    raise exception 'create_pos_order_v3 operator attribution rewrite left the old block behind';
  end if;

  execute v_result;
end;
$$
