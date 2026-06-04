begin;

create or replace function public.repair_duplicate_event_bookings(p_lodge_id uuid default null)
returns table (
  lodge_id uuid,
  event_group text,
  kept_booking_id uuid,
  removed_booking_count integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_group record;
  v_keep_id uuid;
  v_remove_ids uuid[];
  v_total_amount numeric;
  v_amount_paid numeric;
  v_charges_total numeric;
  v_payment_status text;
begin
  for v_group in
    select
      b.lodge_id,
      public.extract_booking_event_group(b.notes) as event_group,
      array_agg(b.id order by b.created_at asc, b.id asc) as booking_ids,
      count(*)::integer as booking_count,
      coalesce(sum(coalesce(b.total_amount, 0)), 0) as total_amount,
      coalesce(sum(coalesce(b.amount_paid, 0)), 0) as amount_paid,
      coalesce(sum(coalesce(b.charges_total, 0)), 0) as charges_total
    from public.bookings b
    where coalesce(b.is_exclusive_event, false)
      and coalesce(b.status, '') <> 'cancelled'
      and public.extract_booking_event_group(b.notes) is not null
      and (p_lodge_id is null or b.lodge_id = p_lodge_id)
    group by b.lodge_id, public.extract_booking_event_group(b.notes)
    having count(*) > 1
  loop
    v_keep_id := v_group.booking_ids[1];
    v_remove_ids := v_group.booking_ids[2:array_length(v_group.booking_ids, 1)];
    v_total_amount := round(coalesce(v_group.total_amount, 0)::numeric, 2);
    v_amount_paid := round(coalesce(v_group.amount_paid, 0)::numeric, 2);
    v_charges_total := round(coalesce(v_group.charges_total, 0)::numeric, 2);
    v_payment_status := case
      when v_amount_paid >= v_total_amount + v_charges_total and v_total_amount + v_charges_total > 0 then 'paid'
      when v_amount_paid > 0 then 'partial'
      else 'unpaid'
    end;

    update public.payments p
       set booking_id = v_keep_id
     where p.lodge_id = v_group.lodge_id
       and p.booking_id = any(v_remove_ids);

    update public.booking_charges bc
       set booking_id = v_keep_id
     where bc.lodge_id = v_group.lodge_id
       and bc.booking_id = any(v_remove_ids);

    update public.pos_orders po
       set booking_id = v_keep_id
     where po.lodge_id = v_group.lodge_id
       and po.booking_id = any(v_remove_ids);

    delete from public.invoices i
     where i.lodge_id = v_group.lodge_id
       and i.booking_id = any(v_remove_ids);

    delete from public.bookings b
     where b.lodge_id = v_group.lodge_id
       and b.id = any(v_remove_ids);

    update public.bookings b
       set total_amount = v_total_amount,
           amount_paid = v_amount_paid,
           charges_total = v_charges_total,
           payment_status = v_payment_status,
           updated_at = now()
     where b.lodge_id = v_group.lodge_id
       and b.id = v_keep_id;

    lodge_id := v_group.lodge_id;
    event_group := v_group.event_group;
    kept_booking_id := v_keep_id;
    removed_booking_count := coalesce(array_length(v_remove_ids, 1), 0);
    return next;
  end loop;
end;
$$;

grant execute on function public.repair_duplicate_event_bookings(uuid) to service_role;

comment on function public.repair_duplicate_event_bookings(uuid)
is 'Merges legacy multi-row exclusive event bookings into one booking/invoice row per event group.';

commit;
