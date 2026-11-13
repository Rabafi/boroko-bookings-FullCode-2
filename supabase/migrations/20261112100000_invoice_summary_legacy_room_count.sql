begin;

-- legacy_event_bookings exposes the booking primary key as id (b.*).
-- Referencing booking_id makes the complete invoice projection fail to plan,
-- even when the requested lodge has no legacy event invoices.
-- Patch the current definition so later active-payment filtering, permissions,
-- tenancy checks and the existing output contract are preserved.
do $$
declare
  v_definition text;
  v_before constant text := 'count(leb.booking_id)::integer as room_count';
  v_after constant text := 'count(leb.id)::integer as room_count';
begin
  if to_regprocedure('public.get_invoice_summary(uuid,uuid)') is null then
    raise exception 'Missing consolidated invoice summary RPC';
  end if;
  select pg_get_functiondef('public.get_invoice_summary(uuid,uuid)'::regprocedure)
    into v_definition;
  if position(v_before in v_definition) > 0 then
    if (length(v_definition) - length(replace(v_definition, v_before, '')))
         / length(v_before) <> 1 then
      raise exception 'Unexpected legacy event room-count expression';
    end if;
    execute replace(v_definition, v_before, v_after);
  elsif position(v_after in v_definition) = 0 then
    raise exception 'Invoice summary has no recognized legacy room-count expression';
  end if;
end;
$$;

commit;
