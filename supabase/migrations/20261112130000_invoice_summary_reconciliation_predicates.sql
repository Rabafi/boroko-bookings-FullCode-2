begin;

-- Correct the grouped event reconciliation predicate. The preceding migration
-- guarded one spelling but replaced a differently ordered scope list, so it
-- could report success without changing this expression.
do $$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$(
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('venue_only', 'exclusive_lodge')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required$old$;
  v_new text := $new$(
             x.event_booking_id is not null
             and ((x.event_paid > 0 and x.room_paid > 0)
               or (x.event_paid > 0 and x.event_total <= 0))
           ) as reconciliation_required$new$;
begin
  if to_regprocedure('public.get_invoice_summary(uuid,uuid)') is null then
    raise exception 'Missing consolidated invoice summary RPC';
  end if;

  select pg_get_functiondef('public.get_invoice_summary(uuid,uuid)'::regprocedure)
    into v_definition;

  if position(v_new in v_definition) > 0 then
    raise exception 'Grouped reconciliation correction is already present; refusing a silent no-op';
  end if;
  if position(v_old in v_definition) = 0
     or (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected deployed grouped reconciliation expression';
  end if;

  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition or position(v_old in v_updated) > 0
     or position(v_new in v_updated) = 0 then
    raise exception 'Grouped reconciliation expression was not replaced exactly once';
  end if;

  execute v_updated;
end;
$$;

commit;
