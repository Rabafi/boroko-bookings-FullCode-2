-- Serialize the room booking row before recalculating its payment total. This
-- keeps a concurrent normal room payment from being overwritten by a stale
-- projection when the duplicate receipt is voided.
begin;
do $$
declare
  v_definition text;
  v_old text := $old$  update public.payments
     set voided_at = now(), void_reason = v_reason, voided_by = v_actor,$old$;
  v_new text := $new$  perform 1 from public.bookings b
   where b.id = v_duplicate.booking_id and b.lodge_id = p_lodge_id
   for update;

  update public.payments
     set voided_at = now(), void_reason = v_reason, voided_by = v_actor,$new$;
  v_old_count integer;
  v_new_count integer;
begin
  select pg_get_functiondef('public.void_duplicate_event_payment(uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure)
    into v_definition;
  v_old_count := (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old);
  v_new_count := (length(v_definition)-length(replace(v_definition,v_new,'')))/length(v_new);
  if v_old_count=1 and v_new_count=0 then
    execute replace(v_definition,v_old,v_new);
  elsif v_old_count=0 and v_new_count=1 then
    null;
  else
    raise exception 'Duplicate payment correction booking-lock boundary is unexpected';
  end if;
end;
$$;
commit;
