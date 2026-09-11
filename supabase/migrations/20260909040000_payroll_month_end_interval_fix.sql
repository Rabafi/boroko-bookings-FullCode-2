-- Fix invalid month-end interval literal in the payroll edge guard.
--
-- '1 month-1 day' is not valid interval input (PostgreSQL parses the unit
-- as the garbage token 'month-1'); the intended last-day-of-month
-- arithmetic requires spaces: '1 month - 1 day'. Without this fix every
-- monthly salary payroll fails with 22007 inside
-- _restaurant_guard_payroll_record_mutation.
--
-- Fresh-chain portability (same acceptance contract as the F&B drift
-- repairs): applies only when the stale literal is present (replace,
-- post-verify, EXECUTE); explicit NOTICE no-op when already fixed;
-- raises otherwise. Single DO block keeps it atomic.

do $fix$
declare
  v_definition text;
  v_repaired text;
  v_old_present boolean;
  v_new_present boolean;
begin
  select pg_get_functiondef(to_regprocedure('public._restaurant_guard_payroll_record_mutation()'))
    into v_definition;
  if v_definition is null then
    raise exception '_restaurant_guard_payroll_record_mutation() is missing';
  end if;
  v_old_present := position($old$interval '1 month-1 day'$old$ in v_definition) > 0;
  v_new_present := position($new$interval '1 month - 1 day'$new$ in v_definition) > 0;
  if v_old_present then
    v_repaired := replace(v_definition, $old$interval '1 month-1 day'$old$, $new$interval '1 month - 1 day'$new$);
    if position($new$interval '1 month - 1 day'$new$ in v_repaired) = 0 or position($old$interval '1 month-1 day'$old$ in v_repaired) > 0 then
      raise exception 'payroll month-end interval rewrite did not install cleanly';
    end if;
    execute v_repaired;
    raise notice '_restaurant_guard_payroll_record_mutation: invalid month-end interval literal repaired';
  elsif v_new_present then
    raise notice '_restaurant_guard_payroll_record_mutation: already in repaired form; skipping';
  else
    raise exception 'Expected stale month-end interval fragment was not found';
  end if;
end;
$fix$;
