begin;

-- Event base price and the consolidated invoice total are different values.
-- Validate the assembled invoice only after its room/resource components exist.
do $$
declare
  v_signature text := 'public.create_event_booking(jsonb)';
  v_definition text;
  v_before text;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing event creation RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  v_group_result jsonb;',
    '  v_group_result jsonb;' || E'\n  v_agreed_total numeric := 0;');
  if v_definition = v_before then raise exception 'Could not add event invoice price validation state'; end if;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  -- One customer-facing invoice for the reservation, including venue-only',
    E'  perform public.recalculate_event_totals(v_event_id);\n' ||
    E'  select round(coalesce(event.total_amount, 0) + coalesce(sum(booking.total_amount + coalesce(booking.charges_total, 0)), 0), 2)\n' ||
    E'    into v_agreed_total\n' ||
    E'    from public.conference_bookings event\n' ||
    E'    left join public.event_booking_rooms link on link.event_booking_id = event.id and link.lodge_id = v_lodge_id\n' ||
    E'    left join public.bookings booking on booking.id = coalesce(link.booking_id, event.exclusive_booking_id) and booking.lodge_id = v_lodge_id\n' ||
    E'   where event.id = v_event_id and event.lodge_id = v_lodge_id\n' ||
    E'   group by event.id;\n' ||
    E'  if v_status in (''reserved'', ''confirmed'') and v_agreed_total <= 0 then\n' ||
    E'    raise exception ''Set a positive agreed event or room charge before reserving or confirming this event'';\n' ||
    E'  end if;\n' ||
    E'  if v_deposit > 0 and v_agreed_total <= 0 then\n' ||
    E'    raise exception ''A deposit cannot be collected while the event invoice is unpriced'';\n' ||
    E'  end if;\n' ||
    E'  if v_deposit > v_agreed_total then\n' ||
    E'    raise exception ''Deposit exceeds the agreed consolidated event invoice total'';\n' ||
    E'  end if;\n' ||
    '  -- One customer-facing invoice for the reservation, including venue-only');
  if v_definition = v_before then raise exception 'Could not install event creation price guard'; end if;
  execute v_definition;
end;
$$;

-- An ordinary event edit may not reduce a reserved/confirmed invoice to zero.
do $$
declare
  v_signature text := 'public.update_event_booking(uuid,uuid,jsonb,timestamp with time zone,text)';
  v_definition text;
  v_before text;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing event update RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  v_current_rooms uuid[];',
    '  v_current_rooms uuid[];' || E'\n  v_agreed_total numeric := 0;');
  if v_definition = v_before then raise exception 'Could not add event update price validation state'; end if;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  perform public.recalculate_event_totals(p_event_id);',
    E'  perform public.recalculate_event_totals(p_event_id);\n' ||
    E'  select round(case\n' ||
    E'    when event.reservation_scope = ''exclusive_lodge'' then greatest(coalesce(sum(booking.total_amount), 0), greatest(0, coalesce(event.total_amount, 0) - coalesce(event.charges_total, 0))) + coalesce(event.charges_total, 0)\n' ||
    E'    when event.reservation_scope = ''venue_with_rooms'' then coalesce(sum(booking.total_amount + coalesce(booking.charges_total, 0)), 0) + coalesce(event.total_amount, 0)\n' ||
    E'    else coalesce(event.total_amount, 0)\n' ||
    E'  end, 2) into v_agreed_total\n' ||
    E'  from public.conference_bookings event\n' ||
    E'  left join public.event_booking_rooms link on link.event_booking_id = event.id and link.lodge_id = p_lodge_id\n' ||
    E'  left join public.bookings booking on booking.id = coalesce(link.booking_id, event.exclusive_booking_id) and booking.lodge_id = p_lodge_id\n' ||
    E'  where event.id = p_event_id and event.lodge_id = p_lodge_id\n' ||
    E'  group by event.id;\n' ||
    E'  if coalesce(payload->>''status'', v_record.status) in (''reserved'', ''confirmed'') and v_agreed_total <= 0 then\n' ||
    E'    raise exception ''Set a positive agreed event or room charge before reserving or confirming this event'';\n' ||
    E'  end if;');
  if v_definition = v_before then raise exception 'Could not install event update price guard'; end if;
  execute v_definition;
end;
$$;

-- Keep direct event-payment callers (including queued operations from older
-- clients) inside the same combined event/room balance as invoice collection.
do $$
declare
  v_signature text := 'public.update_event_payment(uuid,uuid,numeric,text,text,text,uuid)';
  v_definition text;
  v_before text;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing event payment RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  v_signed_amount numeric;',
    '  v_signed_amount numeric;' || E'\n  v_room_total numeric := 0;\n  v_room_paid numeric := 0;\n  v_invoice_total numeric := 0;\n  v_invoice_paid numeric := 0;');
  if v_definition = v_before then raise exception 'Could not add consolidated payment validation state'; end if;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  v_signed_amount := case when v_type = ''refund'' then -v_amount else v_amount end;',
    E'  select coalesce(sum(b.total_amount + coalesce(b.charges_total, 0)), 0),\n' ||
    E'         coalesce(sum(b.amount_paid), 0)\n' ||
    E'    into v_room_total, v_room_paid\n' ||
    E'    from public.bookings b\n' ||
    E'   where b.lodge_id = p_lodge_id\n' ||
    E'     and (b.id = v_event.exclusive_booking_id or exists (select 1 from public.event_booking_rooms r where r.event_booking_id = p_event_id and r.booking_id = b.id and r.lodge_id = p_lodge_id));\n' ||
    E'  v_invoice_total := round(case when v_event.reservation_scope = ''exclusive_lodge'' then greatest(v_room_total, greatest(0, coalesce(v_event.total_amount, 0) - coalesce(v_event.charges_total, 0))) + coalesce(v_event.charges_total, 0) when v_event.reservation_scope = ''venue_with_rooms'' then v_room_total + coalesce(v_event.total_amount, 0) else coalesce(v_event.total_amount, 0) end, 2);\n' ||
    E'  v_invoice_paid := round(coalesce(v_event.amount_paid, 0) + v_room_paid, 2);\n' ||
    E'  if v_type <> ''refund'' and v_invoice_total <= 0 then return jsonb_build_object(''success'', false, ''error'', ''Set a positive agreed event or room charge before accepting payment''); end if;\n' ||
    E'  if v_type <> ''refund'' and v_amount > greatest(0, v_invoice_total - v_invoice_paid) then return jsonb_build_object(''success'', false, ''error'', ''Payment exceeds the current consolidated event invoice balance''); end if;\n' ||
    '  v_signed_amount := case when v_type = ''refund'' then -v_amount else v_amount end;');
  if v_definition = v_before then raise exception 'Could not install consolidated event payment guard'; end if;
  execute v_definition;
end;
$$;

-- Cancellation retries resolve by the same stable operation key. Receipts are
-- retained; the UI explains that refunds require a separate authorized action.
do $$
declare
  v_signature text := 'public.cancel_event_booking(uuid,uuid,text,boolean,text)';
  v_definition text;
  v_before text;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing event cancellation RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;
  v_definition := replace(v_definition,
    '  v_linked_room record;',
    '  v_linked_room record;' || E'\n  v_key text := coalesce(nullif(btrim(p_idempotency_key), ''''), ''event-cancel:'' || p_event_id::text);');
  if v_definition = v_before then raise exception 'Could not add cancellation idempotency key'; end if;
  v_before := v_definition;
  v_definition := replace(v_definition,
    E'  IF v_record.status = ''cancelled'' THEN\n    RETURN jsonb_build_object(''success'', false, ''error'', ''Event is already cancelled'');\n  END IF;',
    E'  IF v_record.status = ''cancelled'' THEN\n' ||
    E'    IF EXISTS (SELECT 1 FROM public.financial_audit_log a WHERE a.event_booking_id = p_event_id AND a.action = ''event_cancelled'' AND a.idempotency_key = v_key AND a.before_snapshot->>''reason'' = p_reason AND a.before_snapshot->>''cancel_linked_rooms'' = p_cancel_linked_rooms::text) THEN\n' ||
    E'      RETURN jsonb_build_object(''success'', true, ''cancelled'', true, ''idempotent'', true);\n' ||
    E'    END IF;\n' ||
    E'    RETURN jsonb_build_object(''success'', false, ''error'', ''Event is already cancelled. Review the event history before retrying.'');\n' ||
    E'  END IF;');
  if v_definition = v_before then raise exception 'Could not install cancellation retry behavior'; end if;
  v_before := v_definition;
  v_definition := replace(v_definition,
    $old$jsonb_build_object('previous_status', v_record.status, 'reason', p_reason),
    p_idempotency_key
  );$old$,
    $new$jsonb_build_object('previous_status', v_record.status, 'reason', p_reason, 'cancel_linked_rooms', p_cancel_linked_rooms),
    v_key
  );$new$);
  if v_definition = v_before then raise exception 'Could not bind cancellation audit to its full operation payload'; end if;
  execute v_definition;
end;
$$;

commit;
