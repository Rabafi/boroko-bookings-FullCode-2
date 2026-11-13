-- Move direct event-payment balance validation after the payload-bound
-- idempotency lookup. Existing exact full-balance retries must return their
-- original receipt even though the remaining invoice balance is now zero.
begin;

do $$
declare
  v_signature text := 'public.update_event_payment(uuid,uuid,numeric,text,text,text,uuid)';
  v_definition text;
  v_before text;
  v_guard text :=
    E'  select coalesce(sum(b.total_amount + coalesce(b.charges_total, 0)), 0),\n' ||
    E'         coalesce(sum(b.amount_paid), 0)\n' ||
    E'    into v_room_total, v_room_paid\n' ||
    E'    from public.bookings b\n' ||
    E'   where b.lodge_id = p_lodge_id\n' ||
    E'     and (b.id = v_event.exclusive_booking_id or exists (select 1 from public.event_booking_rooms r where r.event_booking_id = p_event_id and r.booking_id = b.id and r.lodge_id = p_lodge_id));\n' ||
    E'  v_invoice_total := round(case when v_event.reservation_scope = ''exclusive_lodge'' then greatest(v_room_total, greatest(0, coalesce(v_event.total_amount, 0) - coalesce(v_event.charges_total, 0))) + coalesce(v_event.charges_total, 0) when v_event.reservation_scope = ''venue_with_rooms'' then v_room_total + coalesce(v_event.total_amount, 0) else coalesce(v_event.total_amount, 0) end, 2);\n' ||
    E'  v_invoice_paid := round(coalesce(v_event.amount_paid, 0) + v_room_paid, 2);\n' ||
    E'  if v_type <> ''refund'' and v_invoice_total <= 0 then return jsonb_build_object(''success'', false, ''error'', ''Set a positive agreed event or room charge before accepting payment''); end if;\n' ||
    E'  if v_type <> ''refund'' and v_amount > greatest(0, v_invoice_total - v_invoice_paid) then return jsonb_build_object(''success'', false, ''error'', ''Payment exceeds the current consolidated event invoice balance''); end if;\n';
  v_guard_at integer;
  v_signed_at integer;
  v_target_at integer;
begin
  if to_regprocedure(v_signature) is null then raise exception 'Missing event payment RPC'; end if;
  select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
  v_before := v_definition;

  if length(v_definition) - length(replace(v_definition, v_guard, '')) <> length(v_guard) then
    raise exception 'Expected exactly one consolidated balance guard in update_event_payment';
  end if;
  v_guard_at := strpos(v_definition, v_guard);
  if v_guard_at = 0 then
    -- Some migration runners reformat function source. The distinctive
    -- consolidated-balance error must still occur exactly once before repair.
    if length(v_definition) - length(replace(v_definition, 'Payment exceeds the current consolidated event invoice balance', ''))
       <> length('Payment exceeds the current consolidated event invoice balance') then
      raise exception 'Could not safely locate the event payment balance guard';
    end if;
    raise exception 'Event payment balance guard formatting differs; refusing unsafe rewrite';
  end if;

  v_signed_at := strpos(v_definition, '  v_signed_amount := case when v_type = ''refund'' then -v_amount else v_amount end;');
  v_target_at := strpos(v_definition, '  if v_event.status in (''cancelled'', ''completed'') then');
  if v_signed_at = 0 or v_target_at = 0 then raise exception 'Could not locate event payment retry and state checks'; end if;

  if v_guard_at < v_signed_at then
    -- This is the affected layout: the balance rule runs before idempotency.
    v_definition := replace(v_definition, v_guard, '');
    v_target_at := strpos(v_definition, '  if v_event.status in (''cancelled'', ''completed'') then');
    if v_target_at = 0 then raise exception 'Could not relocate event payment balance guard'; end if;
    v_definition := overlay(v_definition placing v_guard from v_target_at for 0);
  elsif v_guard_at > v_target_at then
    raise exception 'Balance guard is after the event state check; refusing unsafe rewrite';
  end if;

  if v_definition = v_before then
    -- Already corrected: the guard is between the idempotency lookup and
    -- state check. This makes the forward migration safe on repaired copies.
    return;
  end if;
  execute v_definition;
end;
$$;

commit;
