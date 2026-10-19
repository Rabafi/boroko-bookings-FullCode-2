-- Luna remediation: exact original envelope for legacy/exclusive-event creation.
-- This extends AUD-10 after source review found a distinct create_booking_record
-- path outside the room/campsite/group wrappers. It reuses the immutable shared
-- intent ledger and preserves the existing JSONB API signature.

begin;

alter function public.create_booking_record(jsonb)
  rename to create_booking_record_pre_intent_v1;

create or replace function public._booking_create_intent_immutable_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  raise exception 'Booking create intents are immutable'
    using errcode='55000';
end;
$$;
revoke all on function public._booking_create_intent_immutable_v1() from public,anon,authenticated;

drop trigger if exists booking_create_intents_immutable on public.booking_create_intents;
create trigger booking_create_intents_immutable
  before update or delete on public.booking_create_intents
  for each row execute function public._booking_create_intent_immutable_v1();

create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid:=public.app_current_user_id();
  v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_customer_id uuid:=nullif(payload->>'customer_id','')::uuid;
  v_room_id uuid:=nullif(payload->>'room_id','')::uuid;
  v_check_in date:=nullif(payload->>'check_in','')::date;
  v_check_out date:=nullif(payload->>'check_out','')::date;
  v_requested_id uuid:=nullif(payload->>'id','')::uuid;
  v_booking_id uuid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  v_key text:=payload->>'create_idempotency_key';
  v_created_by uuid:=nullif(payload->>'created_by','')::uuid;
  v_status text:=coalesce(nullif(payload->>'status',''),'confirmed');
  v_adults integer:=coalesce(nullif(payload->>'adults','')::integer,1);
  v_children integer:=coalesce(nullif(payload->>'children','')::integer,0);
  v_total numeric:=round(coalesce(nullif(payload->>'total_amount','')::numeric,0),2);
  v_deposit numeric:=round(coalesce(nullif(payload->>'deposit_amount','')::numeric,0),2);
  v_deposit_method text:=nullif(payload->>'deposit_method','');
  v_invoice_number text:=nullif(payload->>'invoice_number','');
  v_notes text:=coalesce(payload->>'notes','');
  v_exclusive boolean:=coalesce(nullif(payload->>'is_exclusive_event','')::boolean,false);
  v_event_daily_rate numeric:=round(coalesce(nullif(payload->>'event_daily_rate','')::numeric,0),2);
  v_allow_override boolean:=coalesce(nullif(payload->>'allow_total_override','')::boolean,false);
  v_request jsonb;
  v_hash text;
  v_existing public.booking_create_intents%rowtype;
  v_result jsonb;
  v_payload jsonb;
  v_detail text;
  v_recorded_booking uuid;
  v_recorded_invoice text;
begin
  -- The desktop uses the anon API key with a server-verified employee session
  -- header. Privilege to call this wrapper is not identity: these checks are.
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist','cashier','supervisor','manager','admin','super_admin']
  );
  if v_lodge_id is null or v_actor is null then
    raise exception 'Authenticated actor and lodge are required' using errcode='42501';
  end if;
  if v_created_by is not null and v_created_by is distinct from v_actor then
    raise exception 'Booking created_by must match the authenticated actor' using errcode='42501';
  end if;
  if v_key is null or v_key<>btrim(v_key) or length(v_key)<8 or length(v_key)>128 then
    return jsonb_build_object('success',false,'code','operation_key_required',
      'error','Booking creation requires a stable idempotency key of 8 to 128 characters.');
  end if;
  if v_allow_override then
    perform public.app_require_lodge_role(v_lodge_id,array['manager','admin','super_admin']);
  end if;
  if v_total::text in ('NaN','Infinity','-Infinity')
     or v_deposit::text in ('NaN','Infinity','-Infinity')
     or v_event_daily_rate::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('success',false,'error','Booking total, deposit and event rate must be finite amounts.');
  end if;
  if v_check_in is null or v_check_out is null or v_check_out<=v_check_in
     or v_adults<1 or v_children<0
     or v_total<0 or v_deposit<0 or v_deposit>v_total or v_event_daily_rate<0
     or v_status not in ('pending','confirmed','checked_in','checked_out','cancelled') then
    return jsonb_build_object('success',false,'error','Booking dates, occupancy, status and financial amounts are invalid.');
  end if;
  if v_deposit>0 and v_deposit_method is null then
    return jsonb_build_object('success',false,'error','Deposit method is required when a deposit is provided.');
  end if;

  v_request:=jsonb_build_object(
    'contract','create_booking_record_v1',
    'actor_id',v_actor,
    'lodge_id',v_lodge_id,
    'customer_id',v_customer_id,
    'room_id',case when v_exclusive then null else v_room_id end,
    'check_in',v_check_in,
    'check_out',v_check_out,
    'requested_booking_id',v_requested_id,
    'status',v_status,
    'adults',v_adults,
    'children',v_children,
    'total_amount',v_total,
    'invoice_number',case when v_exclusive then null else v_invoice_number end,
    'notes',case when v_exclusive then btrim(regexp_replace(regexp_replace(v_notes,'\[GROUP:[^]]+\]','','g'),'\[ROOMS:[0-9]+\]','','g')) else v_notes end,
    'created_by',v_actor,
    'deposit_amount',v_deposit,
    'deposit_method',v_deposit_method,
    'is_exclusive_event',v_exclusive,
    'event_daily_rate',v_event_daily_rate,
    'allow_total_override',v_allow_override
  );
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');

  -- Share lock names with create_booking so a key or booking ID cannot race
  -- across the room and event creation APIs.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'booking-create-key:'||v_lodge_id::text||':'||v_key,0
  ));
  select * into v_existing
    from public.booking_create_intents i
   where i.lodge_id=v_lodge_id and i.operation_key=v_key
   for update;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_hash is distinct from v_hash
       or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'code','idempotency_conflict',
        'error','Booking idempotency key was already used for a different authorized request.');
    end if;
    return v_existing.operation_result;
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'booking-create-id:'||v_booking_id::text,0
  ));
  if exists(select 1 from public.booking_create_intents i where i.booking_id=v_booking_id)
     or exists(select 1 from public.bookings b where b.id=v_booking_id)
     or exists(select 1 from public.bookings b where b.lodge_id=v_lodge_id and b.create_idempotency_key=v_key) then
    -- Existing rows without a verified envelope are ambiguous history, never
    -- proof that this changed request was already applied.
    v_result:=jsonb_build_object('success',false,'code','booking_history_ambiguous',
      'error','An older booking uses this key or ID without a verifiable original request. Manual recovery is required; no replacement was created.');
  elsif v_customer_id is null or v_room_id is null
     or not exists(select 1 from public.customers c where c.id=v_customer_id and c.lodge_id=v_lodge_id)
     or not exists(select 1 from public.rooms r where r.id=v_room_id and r.lodge_id=v_lodge_id) then
    v_result:=jsonb_build_object('success',false,'code','booking_scope_invalid',
      'error','The customer or room was not found in this lodge. Refresh the booking data before retrying.');
  else
    -- Rebuild only the fields the legacy implementation consumes. Client
    -- estimates such as amount_paid/payment_status are not authoritative.
    v_payload:=jsonb_build_object(
      'id',v_booking_id,'lodge_id',v_lodge_id,'customer_id',v_customer_id,'room_id',v_room_id,
      'check_in',v_check_in,'check_out',v_check_out,'status',v_status,
      'adults',v_adults,'children',v_children,'total_amount',v_total,
      'invoice_number',v_invoice_number,'notes',v_notes,'created_by',v_actor,
      'deposit_amount',v_deposit,'deposit_method',v_deposit_method,
      'is_exclusive_event',v_exclusive,'event_daily_rate',v_event_daily_rate,
      'allow_total_override',v_allow_override,'create_idempotency_key',v_key
    );

    -- The legacy function can return success:false after touching booking,
    -- invoice or payment rows. A private exception rolls those writes back;
    -- the outer transaction then stores the immutable definitive result.
    begin
      v_result:=public.create_booking_record_pre_intent_v1(v_payload);
      if v_result is null or jsonb_typeof(v_result)<>'object' then
        raise exception 'Legacy booking creation returned a malformed result' using errcode='PZ002';
      end if;
      if coalesce((v_result->>'success')::boolean,false) is not true then
        raise exception using errcode='PZ001',message='booking_record_definitive_rejection',detail=v_result::text;
      end if;
    exception
      when sqlstate 'PZ001' then
        get stacked diagnostics v_detail=pg_exception_detail;
        v_result:=v_detail::jsonb;
    end;

    if coalesce((v_result->>'success')::boolean,false) then
      v_recorded_booking:=nullif(v_result->>'booking_id','')::uuid;
      if v_recorded_booking is null or v_recorded_booking is distinct from v_booking_id then
        raise exception 'Booking creation returned a different or missing booking ID' using errcode='P0001';
      end if;
      select i.invoice_number into v_recorded_invoice
        from public.invoices i where i.booking_id=v_booking_id and i.lodge_id=v_lodge_id
        order by i.issued_at desc limit 1;
      if not found or v_recorded_invoice is null then
        raise exception 'Booking creation did not create its required invoice row' using errcode='P0001';
      end if;
      if not exists(
        select 1 from public.bookings b
         where b.id=v_booking_id and b.lodge_id=v_lodge_id
           and b.customer_id is not distinct from v_customer_id
           and b.room_id is not distinct from v_room_id
           and b.check_in=v_check_in and b.check_out=v_check_out
           and b.create_idempotency_key=v_key
           and b.total_amount=v_total and b.deposit_amount=v_deposit
           and b.is_exclusive_event=v_exclusive
           and coalesce(b.event_daily_rate,0)=v_event_daily_rate
      ) then
        raise exception 'Booking creation receipt does not match its committed original row' using errcode='P0001';
      end if;
      if v_deposit>0 and not exists(
        select 1 from public.payments p
         where p.booking_id=v_booking_id and p.lodge_id=v_lodge_id
           and p.type='deposit' and p.idempotency_key='payment:deposit:'||v_booking_id::text
           and p.amount=v_deposit and p.method is not distinct from v_deposit_method
      ) then
        raise exception 'Booking creation returned success without its required deposit ledger entry' using errcode='P0001';
      end if;
      v_result:=v_result||jsonb_build_object(
        'operation_id',v_key,'operation_type','booking_record_create_v1',
        'payload_hash',v_hash,'lodge_id',v_lodge_id,'actor_id',v_actor,
        'request_payload',v_request,
        'receipt',jsonb_build_object('booking_id',v_booking_id,
          'invoice_number',v_recorded_invoice,'deposit_amount',v_deposit,
          'total_amount',v_total,'room_count',case when v_exclusive then coalesce(nullif(substring(v_notes from '\[ROOMS:([0-9]+)\]'),'')::integer,1) else 1 end)
      );
    else
      v_result:=v_result||jsonb_build_object(
        'operation_id',v_key,'operation_type','booking_record_create_v1',
        'payload_hash',v_hash,'lodge_id',v_lodge_id,'actor_id',v_actor,
        'request_payload',v_request,
        'receipt',jsonb_build_object('status','definitive_rejection')
      );
    end if;
  end if;

  insert into public.booking_create_intents(
    lodge_id,operation_key,actor_id,booking_id,original_request,request_hash,operation_result
  ) values(
    v_lodge_id,v_key,v_actor,
    case when coalesce((v_result->>'success')::boolean,false) then v_booking_id else null end,
    v_request,v_hash,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.create_booking_record_pre_intent_v1(jsonb) from public,anon,authenticated;
grant execute on function public.create_booking_record_pre_intent_v1(jsonb) to service_role;
revoke all on function public.create_booking_record(jsonb) from public,anon,authenticated;
grant execute on function public.create_booking_record(jsonb) to anon,authenticated,service_role;

commit;
