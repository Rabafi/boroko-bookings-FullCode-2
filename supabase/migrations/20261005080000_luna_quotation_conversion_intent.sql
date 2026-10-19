-- Luna remediation: exact replay for quotation conversion. The key is stable
-- per quotation; the immutable envelope binds actor/lodge/deposit/method and
-- stores the original result before a later status/price change can alter it.

begin;

alter function public.convert_quotation_to_booking(uuid,uuid,numeric,text,uuid)
  rename to convert_quotation_to_booking_pre_intent_v1;

create or replace function public.convert_quotation_to_booking(
  p_quotation_id uuid,
  p_lodge_id uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text default 'cash',
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor uuid:=public.app_current_user_id();
  v_key text:='quotation-conversion:'||p_quotation_id::text;
  v_deposit numeric:=round(coalesce(p_deposit_amount,0),2);
  v_method text:=nullif(btrim(coalesce(p_payment_method,'')),'');
  v_request jsonb;
  v_hash text;
  v_existing public.booking_create_intents%rowtype;
  v_result jsonb;
  v_booking_id uuid;
  v_invoice_number text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,array['receptionist','finance','manager','admin','super_admin']
  );
  if p_lodge_id is null or p_quotation_id is null or v_actor is null then
    raise exception 'Authenticated actor, lodge and quotation are required' using errcode='42501';
  end if;
  if p_created_by is not null and p_created_by is distinct from v_actor then
    raise exception 'Quotation conversion actor does not match the authenticated session' using errcode='42501';
  end if;
  if v_deposit::text in ('NaN','Infinity','-Infinity') or v_deposit<0 then
    return jsonb_build_object('success',false,'error','Deposit amount must be a finite non-negative amount.');
  end if;
  if v_deposit>0 and v_method is null then
    return jsonb_build_object('success',false,'error','Payment method is required when a deposit is provided.');
  end if;

  v_request:=jsonb_build_object(
    'contract','quotation_conversion_v1',
    'actor_id',v_actor,
    'lodge_id',p_lodge_id,
    'quotation_id',p_quotation_id,
    'deposit_amount',v_deposit,
    'payment_method',v_method,
    'created_by',v_actor
  );
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'booking-create-key:'||p_lodge_id::text||':'||v_key,0
  ));
  select * into v_existing
    from public.booking_create_intents i
   where i.lodge_id=p_lodge_id and i.operation_key=v_key
   for update;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_hash is distinct from v_hash
       or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'code','idempotency_conflict',
        'error','This quotation conversion key was already used with a different deposit, method, actor or scope.');
    end if;
    return v_existing.operation_result;
  end if;

  -- Older conversions have no immutable caller envelope. A converted status
  -- alone cannot prove the original deposit or authorize replay.
  perform 1 from public.quotations q
   where q.id=p_quotation_id and q.lodge_id=p_lodge_id
   for update;
  if not found then
    v_result:=jsonb_build_object('success',false,'code','quotation_not_found',
      'error','Quotation was not found in this lodge.');
  elsif exists(select 1 from public.quotations q
    where q.id=p_quotation_id and q.lodge_id=p_lodge_id
      and (q.status='converted' or q.converted_booking_id is not null)) then
    v_result:=jsonb_build_object('success',false,'code','booking_history_ambiguous',
      'manual_review_required',true,
      'error','This quotation was converted before its original request was recorded. Confirm its booking and deposit before retrying; no replacement was created.');
  else
    v_result:=public.convert_quotation_to_booking_pre_intent_v1(
      p_quotation_id,p_lodge_id,v_deposit,v_method,v_actor
    )::jsonb;
    if v_result is null or jsonb_typeof(v_result)<>'object' then
      raise exception 'Quotation conversion returned a malformed result' using errcode='P0001';
    end if;
    if coalesce((v_result->>'success')::boolean,false) then
      v_booking_id:=nullif(v_result->>'booking_id','')::uuid;
      if v_booking_id is null
         or not exists(select 1 from public.bookings b
           where b.id=v_booking_id and b.lodge_id=p_lodge_id
             and b.quotation_id=p_quotation_id and b.create_idempotency_key=v_key) then
        raise exception 'Quotation conversion receipt does not match its booking row' using errcode='P0001';
      end if;
      select i.invoice_number into v_invoice_number
        from public.invoices i where i.booking_id=v_booking_id and i.lodge_id=p_lodge_id
        order by i.issued_at desc limit 1;
      if not found or v_invoice_number is null
         or v_invoice_number is distinct from v_result->>'invoice_number' then
        raise exception 'Quotation conversion receipt does not match its invoice row' using errcode='P0001';
      end if;
      if v_deposit>0 and not exists(select 1 from public.payments p
        where p.booking_id=v_booking_id and p.lodge_id=p_lodge_id
          and p.type='deposit' and p.idempotency_key='payment:deposit:'||v_booking_id::text
          and p.amount=v_deposit and p.method is not distinct from v_method) then
        raise exception 'Quotation conversion returned success without its required deposit ledger entry' using errcode='P0001';
      end if;
      if not exists(select 1 from public.quotations q where q.id=p_quotation_id
        and q.lodge_id=p_lodge_id and q.status='converted'
        and q.converted_booking_id=v_booking_id) then
        raise exception 'Quotation conversion did not atomically finalize its quotation' using errcode='P0001';
      end if;
      v_result:=v_result||jsonb_build_object(
        'operation_id',v_key,'operation_type','quotation_conversion_v1',
        'payload_hash',v_hash,'lodge_id',p_lodge_id,'actor_id',v_actor,
        'request_payload',v_request,
        'receipt',jsonb_build_object('quotation_id',p_quotation_id,
          'booking_id',v_booking_id,'invoice_number',v_invoice_number,'deposit_amount',v_deposit)
      );
    else
      v_result:=v_result||jsonb_build_object(
        'operation_id',v_key,'operation_type','quotation_conversion_v1',
        'payload_hash',v_hash,'lodge_id',p_lodge_id,'actor_id',v_actor,
        'request_payload',v_request,
        'receipt',jsonb_build_object('status','definitive_rejection')
      );
    end if;
  end if;

  insert into public.booking_create_intents(
    lodge_id,operation_key,actor_id,booking_id,original_request,request_hash,operation_result
  ) values(
    p_lodge_id,v_key,v_actor,
    case when coalesce((v_result->>'success')::boolean,false) then v_booking_id else null end,
    v_request,v_hash,v_result
  );
  return v_result;
end;
$$;

revoke all on function public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)
  to service_role;
revoke all on function public.convert_quotation_to_booking(uuid,uuid,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.convert_quotation_to_booking(uuid,uuid,numeric,text,uuid)
  to anon,authenticated,service_role;

commit;
