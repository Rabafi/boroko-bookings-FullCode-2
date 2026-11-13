begin;

-- Keep the server invoice projection aligned with the desktop collection
-- contract: unresolved event receipts have no collectible balance, and an
-- arithmetic overpayment never produces a negative guest balance.
do $$
declare
  v_definition text;
  v_updated text;
  v_replacements integer := 0;
begin
  if to_regprocedure('public.get_invoice_summary(uuid,uuid)') is null then
    raise exception 'Missing consolidated invoice summary RPC';
  end if;
  select pg_get_functiondef('public.get_invoice_summary(uuid,uuid)'::regprocedure)
    into v_definition;
  v_updated := v_definition;

  if position($old$greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2)) as balance_due$old$ in v_updated) > 0 then
    if (length(v_updated) - length(replace(v_updated, $old$greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2)) as balance_due$old$, '')))
         / length($old$greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2)) as balance_due$old$) <> 1 then
      raise exception 'Unexpected grouped invoice balance expression';
    end if;
    v_updated := replace(v_updated,
      $old$greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2)) as balance_due$old$,
      $new$case
             when x.event_booking_id is not null
              and ((x.event_paid > 0 and x.room_paid > 0)
                or (x.event_paid > 0 and x.event_total <= 0)) then null
             else greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2))
           end as balance_due$new$);
    v_replacements := v_replacements + 1;
  end if;

  if position($old$(
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('venue_only', 'exclusive_lodge')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required$old$ in v_updated) > 0 then
    if (length(v_updated) - length(replace(v_updated, $old$(
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('venue_only', 'exclusive_lodge')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required$old$, '')))
         / length($old$(
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('venue_only', 'exclusive_lodge')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required$old$) <> 1 then
      raise exception 'Unexpected grouped invoice reconciliation expression';
    end if;
    v_updated := replace(v_updated,
      $old$(
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('exclusive_lodge', 'venue_only')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required$old$,
      $new$(
             x.event_booking_id is not null
             and ((x.event_paid > 0 and x.room_paid > 0)
               or (x.event_paid > 0 and x.event_total <= 0))
           ) as reconciliation_required$new$);
    v_replacements := v_replacements + 1;
  end if;

  if position($old$round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end + e.room_charges - (e.room_paid + e.event_paid), 2) as balance_due$old$ in v_updated) > 0 then
    if (length(v_updated) - length(replace(v_updated, $old$round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end + e.room_charges - (e.room_paid + e.event_paid), 2) as balance_due$old$, '')))
         / length($old$round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end + e.room_charges - (e.room_paid + e.event_paid), 2) as balance_due$old$) <> 1 then
      raise exception 'Unexpected legacy event balance expression';
    end if;
    v_updated := replace(v_updated,
      $old$round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end + e.room_charges - (e.room_paid + e.event_paid), 2) as balance_due$old$,
      $new$case
             when (e.event_paid > 0 and e.room_paid > 0)
               or (e.event_paid > 0 and e.event_total <= 0) then null
             else greatest(0, round(
               case
                 when e.reservation_scope = 'exclusive_lodge'
                   then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                 when e.reservation_scope = 'venue_with_rooms'
                   then e.room_total + e.event_total
                 else e.event_total
               end + e.room_charges - (e.room_paid + e.event_paid), 2))
           end as balance_due$new$);
    v_replacements := v_replacements + 1;
  end if;

  if position($old$           when (case when e.reservation_scope = 'exclusive_lodge'$old$ in v_updated) > 0
     and position($old$           'event_unconsolidated'::text as invoice_kind,$old$ in v_updated) > 0 then
    v_updated := replace(v_updated,
      $old$           when (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges > 0
                  and (e.room_paid + e.event_paid) >= (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges then 'paid'
             when e.room_paid + e.event_paid > 0 then 'partial'
             else 'unpaid'
           end as payment_status,$old$,
      $new$           when (e.event_paid > 0 and e.room_paid > 0)
               or (e.event_paid > 0 and e.event_total <= 0) then 'reconciliation_required'
             when (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges > 0
                  and (e.room_paid + e.event_paid) >= (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges then 'paid'
             when e.room_paid + e.event_paid > 0 then 'partial'
             else 'unpaid'
           end as payment_status,$new$);
    v_replacements := v_replacements + 1;
  end if;

  if position($old$           true as reconciliation_required,$old$ in v_updated) > 0 then
    v_updated := replace(v_updated,
      $old$           true as reconciliation_required,$old$,
      $new$           ((e.event_paid > 0 and e.room_paid > 0)
             or (e.event_paid > 0 and e.event_total <= 0)) as reconciliation_required,$new$);
    v_replacements := v_replacements + 1;
  end if;

  if v_replacements <> 5 then
    raise exception 'Expected five recognized invoice projection expressions, changed %', v_replacements;
  end if;
  execute v_updated;
end;
$$;

commit;
