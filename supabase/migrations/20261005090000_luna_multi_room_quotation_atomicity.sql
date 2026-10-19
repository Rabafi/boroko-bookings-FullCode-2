-- Luna remediation self-review fix: quotation-linked multi-room creation owns
-- the accepted quotation state transition in the same transaction as the group.
-- An exact group intent is checked first; converted historical quotes without
-- that proof stay manual-review only.

begin;

alter function public.update_quotation(uuid,uuid,jsonb,timestamptz)
  rename to update_quotation_pre_conversion_guard_v1;

create or replace function public.create_multi_room_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_total_amount numeric,
  p_deposit_amount numeric,
  p_deposit_method text,
  p_notes text,
  p_created_by uuid,
  p_group_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor uuid:=public.app_current_user_id();
  v_key text:=p_idempotency_key;
  v_group_key text:=p_group_key;
  v_inner_key text;
  v_request jsonb;
  v_hash text;
  v_existing public.booking_group_create_intents%rowtype;
  v_result jsonb;
  v_group_id uuid;
  v_booking_ids uuid[];
  v_success boolean:=false;
  v_quotation_id uuid;
  v_quotation public.quotations%rowtype;
  v_quotation_rooms jsonb;
  v_requested_rooms jsonb;
  v_quotation_room_count integer;
  v_quotation_line_total numeric;
  v_effective_total_amount numeric;
  v_quotation_rejection jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  if p_lodge_id is null or v_actor is null then
    raise exception 'Authenticated multi-room booking actor and lodge are required' using errcode='42501';
  end if;
  perform public.app_require_lodge_role(p_lodge_id,array['receptionist','finance','manager','admin','super_admin']);
  if v_key is null or v_key='' or v_key<>btrim(v_key) or length(v_key)<8 or length(v_key)>128 then
    return jsonb_build_object('success',false,'error','Multi-room booking requires an exact stable operation key of 8 to 128 characters.');
  end if;
  if v_group_key is null or v_group_key='' or v_group_key<>btrim(v_group_key) then
    return jsonb_build_object('success',false,'error','Multi-room booking requires an exact non-empty group key.');
  end if;
  if p_created_by is not null and p_created_by is distinct from v_actor then
    raise exception 'Multi-room booking created_by must match the authenticated actor' using errcode='42501';
  end if;

  if lower(v_group_key) ~ '^quotation-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_quotation_id:=substring(v_group_key from 11)::uuid;
  end if;

  v_request:=jsonb_build_object(
    'actor_id',v_actor,'lodge_id',p_lodge_id,'customer_id',p_customer_id,
    'check_in',p_check_in,'check_out',p_check_out,'rooms',p_rooms,
    'total_amount',p_total_amount,'deposit_amount',p_deposit_amount,'deposit_method',p_deposit_method,
    'notes',p_notes,'created_by',v_actor,'group_key',v_group_key
  );
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');
  v_inner_key:='multi-room:'||encode(sha256(convert_to(p_lodge_id::text||':'||v_actor::text||':'||v_key,'UTF8')),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('booking-group-operation:'||p_lodge_id::text||':'||v_key,0));
  select * into v_existing from public.booking_group_create_intents i
   where i.lodge_id=p_lodge_id and i.operation_key=v_key for update;
  if found then
    if v_existing.actor_id is distinct from v_actor or v_existing.request_hash is distinct from v_hash
       or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'code','idempotency_conflict','error','Multi-room booking key was already used for a different authorized request.');
    end if;
    if v_quotation_id is not null and coalesce((v_existing.operation_result->>'success')::boolean,false) then
      select * into v_quotation from public.quotations q
       where q.id=v_quotation_id and q.lodge_id=p_lodge_id for update;
      if not found then
        return v_existing.operation_result||jsonb_build_object(
          'quotation_id',v_quotation_id,'quotation_recovery_required',true,'manual_review_required',true,
          'quotation_error','The exact booking group exists, but its quotation is missing. Preserve the group and review the quotation link.'
        );
      end if;
      if coalesce(array_length(v_existing.booking_ids,1),0)<2
         or v_existing.operation_result->'booking_ids' is distinct from to_jsonb(v_existing.booking_ids) then
        return v_existing.operation_result||jsonb_build_object(
          'quotation_id',v_quotation_id,'quotation_recovery_required',true,'manual_review_required',true,
          'quotation_error','The exact booking intent has no complete saved child receipt. Preserve the group and reconcile its original result before changing the quotation.'
        );
      end if;
      if v_quotation.converted_booking_id is null and v_quotation.status in ('sent','accepted','converted') then
        update public.quotations
           set status='converted',converted_booking_id=v_existing.booking_ids[1],updated_at=now()
         where id=v_quotation_id and lodge_id=p_lodge_id;
      elsif v_quotation.status<>'converted'
         or v_quotation.converted_booking_id is distinct from v_existing.booking_ids[1] then
        return v_existing.operation_result||jsonb_build_object(
          'quotation_id',v_quotation_id,'quotation_recovery_required',true,'manual_review_required',true,
          'quotation_error','The exact booking group exists, but the quotation points to a different state or booking. Preserve both records and review the link.'
        );
      end if;
      return v_existing.operation_result||jsonb_build_object('quotation_id',v_quotation_id);
    end if;
    return v_existing.operation_result;
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('booking-group-key:'||p_lodge_id::text||':'||v_group_key,0));
  select * into v_existing from public.booking_group_create_intents i
   where i.lodge_id=p_lodge_id and i.group_key=v_group_key for update;
  if found then
    return jsonb_build_object('success',false,'code','idempotency_conflict',
      'error','This multi-room group key is already bound to an earlier creation. Confirm its result before starting a new group.');
  end if;

  if exists(select 1 from public.booking_group_idempotency i where i.lodge_id=p_lodge_id and (i.operation_key=v_key or i.operation_key=v_inner_key or i.group_key=v_group_key)) then
    return jsonb_build_object('success',false,'code','manual_recovery_required','manual_review_required',true,
      'error','An older multi-room operation has no complete actor-bound request envelope. Preserve it and reconcile before retrying; no replacement was created.');
  end if;

  v_quotation_rejection:=null;
  if v_quotation_id is not null then
    select * into v_quotation from public.quotations q
     where q.id=v_quotation_id and q.lodge_id=p_lodge_id for update;
    if not found then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_not_found',
        'error','The quotation for this booking group was not found in this lodge.');
    elsif v_quotation.status='converted' or v_quotation.converted_booking_id is not null then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','manual_recovery_required',
        'manual_review_required',true,
        'error','This quotation was converted before its exact group intent was recorded. Confirm its booking and invoice before retrying; no replacement group was created.');
    elsif v_quotation.status not in ('sent','accepted') then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_not_convertible',
        'error','A multi-room quotation must be sent or accepted before conversion.');
    elsif coalesce(v_quotation.tax_amount,0)<>0 or v_quotation.total_amount is distinct from v_quotation.subtotal then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_tax_review_required','manual_review_required',true,
        'error','This group booking flow cannot safely apply the quotation tax total. Review the approved tax treatment before converting; no booking group was created.');
    elsif v_quotation.subtotal is null or v_quotation.subtotal<=0 then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_amount_invalid',
        'error','The accepted quotation has no valid positive subtotal. Review and resend it before converting.');
    elsif v_quotation.valid_until is not null and v_quotation.valid_until<current_date then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_expired',
        'error','This quotation has expired. Review and resend a current quotation before converting it.');
    elsif coalesce(v_quotation.quotation_type,'room')<>'room'
       or v_quotation.customer_id is distinct from p_customer_id
       or v_quotation.check_in is distinct from p_check_in
       or v_quotation.check_out is distinct from p_check_out
       or (p_total_amount is not null and round(p_total_amount,2) is distinct from round(v_quotation.subtotal,2))
       or btrim(regexp_replace(regexp_replace(coalesce(p_notes,''),E'\\[STAY_GROUP:[^]]+\\]','','g'),E'\\[STAY_ROOMS:[0-9]+\\]','','g')) is distinct from coalesce(v_quotation.notes,'')
       or jsonb_typeof(v_quotation.accommodation_lines)<>'array'
       or jsonb_typeof(p_rooms)<>'array' then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_group_mismatch',
        'error','The booking group does not match the customer, dates, notes or room lines on the accepted quotation.');
    elsif jsonb_array_length(v_quotation.accommodation_lines)<2
       or jsonb_array_length(v_quotation.accommodation_lines)<>jsonb_array_length(p_rooms)
       or exists(select 1 from jsonb_array_elements(v_quotation.accommodation_lines) as x(value)
         where jsonb_typeof(x.value)<>'object'
            or nullif(btrim(x.value->>'room_id'),'') is null
            or coalesce(nullif(btrim(x.value->>'adults'),''),'1') !~ '^-?[0-9]+$'
            or coalesce(nullif(btrim(x.value->>'children'),''),'0') !~ '^-?[0-9]+$')
       or exists(select 1 from jsonb_array_elements(p_rooms) as x(value)
         where jsonb_typeof(x.value)<>'object'
            or nullif(btrim(x.value->>'room_id'),'') is null
            or coalesce(nullif(btrim(x.value->>'adults'),''),'1') !~ '^-?[0-9]+$'
            or coalesce(nullif(btrim(x.value->>'children'),''),'0') !~ '^-?[0-9]+$') then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_room_lines_invalid',
        'error','The accepted quotation does not contain a complete multi-room selection. Review the quotation before retrying.');
    elsif exists(select 1 from jsonb_array_elements(v_quotation.accommodation_lines) as x(value)
      where coalesce(nullif(btrim(x.value->>'amount'),''),nullif(btrim(x.value->>'total_amount'),'')) is null
         or coalesce(nullif(btrim(x.value->>'amount'),''),nullif(btrim(x.value->>'total_amount'),'')) !~ '^[0-9]+([.][0-9]+)?$') then
      v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_amount_invalid',
        'error','Every accepted room line must have a finite non-negative amount. Review and resend this quotation before converting.');
    else
      select coalesce(sum(case when nullif(btrim(x.value->>'amount'),'') is not null
          then nullif(btrim(x.value->>'amount'),'')::numeric
          else nullif(btrim(x.value->>'total_amount'),'')::numeric end),0)
        into v_quotation_line_total
        from jsonb_array_elements(v_quotation.accommodation_lines) as x(value);
      if round(v_quotation_line_total,2) is distinct from round(v_quotation.subtotal,2) then
        v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_amount_mismatch',
          'error','The saved quotation subtotal does not match its room lines. Review and resend the quotation before converting.');
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
          'room_id',btrim(x.value->>'room_id'),
          'adults',greatest(coalesce(nullif(btrim(x.value->>'adults'),''),'1')::integer,1),
          'children',greatest(coalesce(nullif(btrim(x.value->>'children'),''),'0')::integer,0),
          'tents',0,'vehicles',0
        ) order by x.ordinality),'[]'::jsonb)
        into v_quotation_rooms
        from jsonb_array_elements(v_quotation.accommodation_lines) with ordinality as x(value,ordinality);
      select coalesce(jsonb_agg(jsonb_build_object(
          'room_id',btrim(x.value->>'room_id'),
          'adults',greatest(coalesce(nullif(btrim(x.value->>'adults'),''),'1')::integer,1),
          'children',greatest(coalesce(nullif(btrim(x.value->>'children'),''),'0')::integer,0),
          'tents',greatest(coalesce(nullif(btrim(x.value->>'tents'),''),'0')::integer,0),
          'vehicles',greatest(coalesce(nullif(btrim(x.value->>'vehicles'),''),'0')::integer,0)
        ) order by x.ordinality),'[]'::jsonb)
        into v_requested_rooms
        from jsonb_array_elements(p_rooms) with ordinality as x(value,ordinality);
      v_quotation_room_count:=jsonb_array_length(v_quotation_rooms);
      if v_quotation_rejection is null and (v_quotation_room_count<2 or v_quotation_rooms is distinct from v_requested_rooms) then
        v_quotation_rejection:=jsonb_build_object('success',false,'code','quotation_group_mismatch',
          'error','The booking group room order or occupancy differs from the accepted quotation.');
      end if;
    end if;
  end if;

  if v_quotation_id is not null and v_quotation_rejection is null then
    v_effective_total_amount:=v_quotation.subtotal;
  else
    v_effective_total_amount:=p_total_amount;
  end if;

  if v_quotation_rejection is not null then
    v_result:=v_quotation_rejection;
  else
    v_result:=public.create_multi_room_booking_pre_intent_v1(
      p_lodge_id,p_customer_id,p_check_in,p_check_out,p_rooms,v_effective_total_amount,p_deposit_amount,
      p_deposit_method,p_notes,v_actor,v_group_key,v_inner_key
    );
  end if;
  v_success:=coalesce((v_result->>'success')::boolean,false);
  if v_success then
    v_group_id:=nullif(v_result->>'group_id','')::uuid;
    select coalesce(array_agg(x.value::uuid order by x.ordinality),'{}'::uuid[])
      into v_booking_ids
      from jsonb_array_elements_text(v_result->'booking_ids') with ordinality as x(value,ordinality);
    if v_group_id is null or coalesce(array_length(v_booking_ids,1),0)<>jsonb_array_length(p_rooms)
       or (select count(distinct u.booking_id) from unnest(v_booking_ids) as u(booking_id))<>array_length(v_booking_ids,1)
       or not exists(select 1 from public.booking_invoice_groups g where g.id=v_group_id and g.lodge_id=p_lodge_id and g.group_key=v_group_key)
       or (select count(*) from public.booking_invoice_group_lines l where l.group_id=v_group_id and l.lodge_id=p_lodge_id)<>array_length(v_booking_ids,1)
       or exists(select 1 from unnest(v_booking_ids) as u(booking_id) left join public.bookings b on b.id=u.booking_id and b.lodge_id=p_lodge_id where b.id is null)
       or exists(select 1 from unnest(v_booking_ids) as u(booking_id) where not exists(select 1 from public.booking_invoice_group_lines l where l.group_id=v_group_id and l.booking_id=u.booking_id and l.lodge_id=p_lodge_id)) then
      raise exception 'Multi-room booking did not persist its complete group, invoice, and child mapping' using errcode='P0001';
    end if;
    if v_quotation_id is not null then
      update public.quotations
         set status='converted',converted_booking_id=v_booking_ids[1],updated_at=now()
       where id=v_quotation_id and lodge_id=p_lodge_id
         and status in ('sent','accepted') and converted_booking_id is null;
      if not found then
        raise exception 'Quotation state changed before its booking group could be committed' using errcode='P0001';
      end if;
    end if;
    v_result:=v_result||jsonb_build_object(
      'operation_id',v_key,'operation_type','multi_room_booking_create_v1','payload_hash',v_hash,
      'lodge_id',p_lodge_id,'actor_id',v_actor,'request_payload',v_request,
      'receipt',jsonb_build_object('group_id',v_group_id,'group_key',v_group_key,'booking_ids',to_jsonb(v_booking_ids))
    );
    if v_quotation_id is not null then
      v_result:=v_result||jsonb_build_object(
        'quotation_id',v_quotation_id,
        'receipt',(v_result->'receipt')||jsonb_build_object('quotation_id',v_quotation_id)
      );
    end if;
  elsif v_quotation_id is not null then
    v_result:=v_result||jsonb_build_object(
      'quotation_id',v_quotation_id,'operation_id',v_key,'operation_type','multi_room_booking_create_v1',
      'payload_hash',v_hash,'lodge_id',p_lodge_id,'actor_id',v_actor,'request_payload',v_request,
      'manual_review_required',true,
      'receipt',jsonb_build_object('quotation_id',v_quotation_id,'status','definitive_rejection')
    );
  end if;

  insert into public.booking_group_create_intents(lodge_id,operation_key,actor_id,group_key,booking_ids,original_request,request_hash,operation_result)
  values(p_lodge_id,v_key,v_actor,v_group_key,coalesce(v_booking_ids,'{}'::uuid[]),v_request,v_hash,v_result);
  return v_result;
end;
$$;

revoke all on function public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)
  to anon,authenticated,service_role;



revoke all on function public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)
  to service_role;
create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_quote public.quotations%rowtype;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,array['receptionist','finance','manager','admin','super_admin']
  );
  if p_id is null or p_lodge_id is null or coalesce(jsonb_typeof(payload),'null')<>'object' then
    return jsonb_build_object('success',false,'error','A lodge-scoped quotation update payload is required.');
  end if;
  select * into v_quote from public.quotations q
   where q.id=p_id and q.lodge_id=p_lodge_id for update;
  if not found then
    return jsonb_build_object('success',false,'error','Quotation not found');
  end if;
  if p_expected_updated_at is not null and v_quote.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('success',false,'error','conflict','conflict',true,
      'message','This record was updated on another device. Refresh and reapply your change.');
  end if;
  if v_quote.status='converted' then
    return jsonb_build_object('success',false,'code','quotation_conversion_owned_by_booking_intent',
      'manual_review_required',true,
      'error','A converted quotation is immutable. Preserve its original group and review any correction before changing related records.');
  end if;
  if (v_quote.status='converted' and payload ? 'status' and payload->>'status' is distinct from 'converted')
     or (v_quote.status<>'converted' and payload ? 'status' and payload->>'status'='converted')
     or (payload ? 'converted_booking_id'
         and nullif(payload->>'converted_booking_id','') is distinct from v_quote.converted_booking_id::text) then
    return jsonb_build_object('success',false,'code','quotation_conversion_owned_by_booking_intent',
      'manual_review_required',true,
      'error','A quotation conversion link is owned by its server booking intent. Preserve this update and review the original group or booking before retrying.');
  end if;
  return public.update_quotation_pre_conversion_guard_v1(
    p_id,p_lodge_id,payload,p_expected_updated_at
  );
end;
$$;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language sql security definer set search_path=public
as $$
  select public.update_quotation(p_id,p_lodge_id,payload,null::timestamptz);
$$;

revoke all on function public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)
  to service_role;
revoke all on function public.update_quotation(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.update_quotation(uuid,uuid,jsonb,timestamptz) to anon,authenticated,service_role;
revoke all on function public.update_quotation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_quotation(uuid,uuid,jsonb) to anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;