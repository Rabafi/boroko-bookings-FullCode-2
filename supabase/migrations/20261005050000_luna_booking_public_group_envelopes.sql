-- Luna remediation: bind public, campsite, and multi-room creation to immutable envelopes.
-- Existing rows without their original request remain read-only/manual-recovery evidence.

begin;

-- ---------------------------------------------------------------------------
-- Campsite booking creation: include every occupancy/pricing input before a
-- retry can reach the legacy implementation or current-rate checks.
-- ---------------------------------------------------------------------------
alter function public.create_campsite_booking(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text)
  rename to create_campsite_booking_pre_intent_v1;

create table public.campsite_booking_create_intents (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  actor_id uuid not null,
  booking_id uuid references public.bookings(id) on delete restrict,
  original_request jsonb not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  operation_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint campsite_booking_create_intents_key_len_chk check(length(operation_key) between 8 and 128),
  constraint campsite_booking_create_intents_lodge_key_uidx unique(lodge_id,operation_key)
);
create unique index campsite_booking_create_intents_booking_uidx
  on public.campsite_booking_create_intents(lodge_id,booking_id) where booking_id is not null;
alter table public.campsite_booking_create_intents enable row level security;
revoke all on table public.campsite_booking_create_intents from public,anon,authenticated;
grant select,insert on table public.campsite_booking_create_intents to service_role;

create or replace function public._campsite_booking_intent_immutable_v1()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  raise exception 'Campsite booking creation intents are immutable.' using errcode='55000';
end;
$$;
revoke all on function public._campsite_booking_intent_immutable_v1() from public,anon,authenticated;
create trigger campsite_booking_create_intents_immutable
before update or delete on public.campsite_booking_create_intents
for each row execute function public._campsite_booking_intent_immutable_v1();

create or replace function public.create_campsite_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_tents integer,
  p_vehicles integer,
  p_total_amount numeric,
  p_invoice_number text default null,
  p_notes text default '',
  p_created_by uuid default null,
  p_deposit_amount numeric default 0,
  p_booking_id uuid default null,
  p_idempotency_key text default null,
  p_deposit_method text default null
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor uuid:=public.app_current_user_id();
  v_key text:=p_idempotency_key;
  v_request jsonb;
  v_hash text;
  v_existing public.campsite_booking_create_intents%rowtype;
  v_result jsonb;
  v_booking_id uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  if p_lodge_id is null or v_actor is null then
    raise exception 'Authenticated campsite-booking actor and lodge are required' using errcode='42501';
  end if;
  perform public.app_require_lodge_role(p_lodge_id,array['receptionist','manager','admin','super_admin']);
  if v_key is null or v_key='' or v_key<>btrim(v_key) or length(v_key)<8 or length(v_key)>128 then
    return jsonb_build_object('success',false,'error','Campsite booking requires an exact stable operation key of 8 to 128 characters.');
  end if;
  if p_created_by is not null and p_created_by is distinct from v_actor then
    raise exception 'Campsite booking created_by must match the authenticated actor' using errcode='42501';
  end if;

  v_request:=jsonb_build_object(
    'actor_id',v_actor,'lodge_id',p_lodge_id,'customer_id',p_customer_id,'room_id',p_room_id,
    'check_in',p_check_in,'check_out',p_check_out,'adults',p_adults,'children',p_children,
    'tents',p_tents,'vehicles',p_vehicles,'total_amount',p_total_amount,
    'invoice_number',p_invoice_number,'notes',p_notes,'created_by',v_actor,
    'deposit_amount',p_deposit_amount,'deposit_method',p_deposit_method,'requested_booking_id',p_booking_id
  );
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('campsite-booking-key:'||p_lodge_id::text||':'||v_key,0));
  select * into v_existing from public.campsite_booking_create_intents i
   where i.lodge_id=p_lodge_id and i.operation_key=v_key for update;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_hash is distinct from v_hash
       or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'code','idempotency_conflict','error','Campsite booking key was already used for a different authorized request.');
    end if;
    return v_existing.operation_result;
  end if;

  if exists(select 1 from public.bookings b where b.lodge_id=p_lodge_id and b.create_idempotency_key=v_key)
     or exists(select 1 from public.booking_create_intents i where i.lodge_id=p_lodge_id and i.operation_key=v_key) then
    return jsonb_build_object('success',false,'code','manual_recovery_required','manual_review_required',true,
      'error','An older campsite request has no complete immutable occupancy envelope. Preserve it and reconcile before retrying; no replacement was created.');
  end if;

  if p_adults is null or p_children is null or p_tents is null or p_vehicles is null
     or p_adults<0 or p_children<0 or p_tents<0 or p_vehicles<0 or p_adults+p_children<1
     or p_total_amount is null or p_total_amount::text in ('NaN','Infinity','-Infinity') or p_total_amount<>round(p_total_amount,2)
     or coalesce(p_deposit_amount,0)::text in ('NaN','Infinity','-Infinity') or coalesce(p_deposit_amount,0)<0 then
    v_result:=jsonb_build_object('success',false,'error','Campsite occupancy, quoted total, and deposit must be valid finite amounts.');
  else
    v_result:=public.create_campsite_booking_pre_intent_v1(
      p_lodge_id,p_customer_id,p_room_id,p_check_in,p_check_out,p_adults,p_children,p_tents,p_vehicles,
      p_total_amount,p_invoice_number,coalesce(p_notes,''),v_actor,p_deposit_amount,p_booking_id,v_key,p_deposit_method
    );
  end if;

  if coalesce((v_result->>'success')::boolean,false) then
    if nullif(v_result->>'booking_id','') is null then
      raise exception 'Campsite booking creation returned success without its booking ID' using errcode='P0001';
    end if;
    v_booking_id:=(v_result->>'booking_id')::uuid;
    if not exists(select 1 from public.bookings b where b.id=v_booking_id and b.lodge_id=p_lodge_id
      and b.customer_id=p_customer_id and b.room_id=p_room_id and b.check_in=p_check_in and b.check_out=p_check_out
      and b.create_idempotency_key=v_key and b.tents_count=p_tents and b.vehicles_count=p_vehicles
      and b.accommodation_kind='campsite') then
      raise exception 'Campsite booking result does not match the committed request' using errcode='P0001';
    end if;
    if not exists(select 1 from public.booking_accommodation_details d where d.booking_id=v_booking_id and d.lodge_id=p_lodge_id
      and d.adults=p_adults and d.children=p_children and d.tents=p_tents and d.vehicles=p_vehicles
      and d.accommodation_kind='campsite') then
      raise exception 'Campsite booking did not persist its occupancy details' using errcode='P0001';
    end if;
    v_result:=v_result||jsonb_build_object(
      'operation_id',v_key,'operation_type','campsite_booking_create_v1','payload_hash',v_hash,
      'lodge_id',p_lodge_id,'actor_id',v_actor,'request_payload',v_request,
      'receipt',jsonb_build_object('booking_id',v_booking_id,'tents',p_tents,'vehicles',p_vehicles,'total_amount',round(p_total_amount,2))
    );
  end if;

  insert into public.campsite_booking_create_intents(lodge_id,operation_key,actor_id,booking_id,original_request,request_hash,operation_result)
  values(p_lodge_id,v_key,v_actor,case when coalesce((v_result->>'success')::boolean,false) then v_booking_id else null end,
    v_request,v_hash,v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Multi-room creation: one actor-bound parent intent, with one atomic child
-- operation and immutable local/server ID mapping.
-- ---------------------------------------------------------------------------
alter function public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)
  rename to create_multi_room_booking_pre_intent_v1;

create table public.booking_group_create_intents (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  actor_id uuid not null,
  group_key text not null,
  booking_ids uuid[] not null default array[]::uuid[],
  original_request jsonb not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  operation_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint booking_group_create_intents_key_len_chk check(length(operation_key) between 8 and 128),
  constraint booking_group_create_intents_lodge_key_uidx unique(lodge_id,operation_key),
  constraint booking_group_create_intents_lodge_group_uidx unique(lodge_id,group_key)
);
alter table public.booking_group_create_intents enable row level security;
revoke all on table public.booking_group_create_intents from public,anon,authenticated;
grant select,insert on table public.booking_group_create_intents to service_role;

create or replace function public._booking_group_create_intent_immutable_v1()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  raise exception 'Multi-room booking creation intents are immutable.' using errcode='55000';
end;
$$;
revoke all on function public._booking_group_create_intent_immutable_v1() from public,anon,authenticated;
create trigger booking_group_create_intents_immutable
before update or delete on public.booking_group_create_intents
for each row execute function public._booking_group_create_intent_immutable_v1();

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
  v_expected_booking_count integer;
  v_success boolean:=false;
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

  v_result:=public.create_multi_room_booking_pre_intent_v1(
    p_lodge_id,p_customer_id,p_check_in,p_check_out,p_rooms,p_total_amount,p_deposit_amount,
    p_deposit_method,p_notes,v_actor,v_group_key,v_inner_key
  );
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
    v_result:=v_result||jsonb_build_object(
      'operation_id',v_key,'operation_type','multi_room_booking_create_v1','payload_hash',v_hash,
      'lodge_id',p_lodge_id,'actor_id',v_actor,'request_payload',v_request,
      'receipt',jsonb_build_object('group_id',v_group_id,'group_key',v_group_key,'booking_ids',to_jsonb(v_booking_ids))
    );
  end if;

  insert into public.booking_group_create_intents(lodge_id,operation_key,actor_id,group_key,booking_ids,original_request,request_hash,operation_result)
  values(p_lodge_id,v_key,v_actor,v_group_key,coalesce(v_booking_ids,'{}'::uuid[]),v_request,v_hash,v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public booking: require the browser's persisted UUID, retain exact request
-- order/content and result, and fail closed for older hash-only receipts.
-- ---------------------------------------------------------------------------
alter table public.public_booking_idempotency
  add column if not exists original_request jsonb;

create or replace function public.create_online_booking(p_slug text,payload jsonb)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_slug text:=lower(btrim(coalesce(p_slug,'')));
  v_lodge_id uuid;
  v_key text;
  v_payload jsonb;
  v_request jsonb;
  v_hash text;
  v_existing public.public_booking_idempotency%rowtype;
  v_result jsonb;
  v_booking_ids uuid[];
  v_expected_booking_count integer;
  v_group_ids uuid[];
  v_group_line_count integer;
begin
  if jsonb_typeof(payload)<>'object' then
    return jsonb_build_object('success',false,'error','Public booking details must be a JSON object.');
  end if;
  if jsonb_typeof(payload->'idempotency_key')<>'string' then
    return jsonb_build_object('success',false,'error','Refresh the booking form before retrying; a stable request key is required.');
  end if;
  v_key:=payload->>'idempotency_key';
  if v_key is null or v_key='' or v_key<>btrim(v_key) or length(v_key)<16 or length(v_key)>128 then
    return jsonb_build_object('success',false,'error','A valid exact booking request key is required.');
  end if;
  v_payload:=payload-'idempotency_key';

  select s.lodge_id into v_lodge_id from public.settings s
   where lower(btrim(coalesce(s.slug,'')))=v_slug and coalesce(s.deleted,false)=false limit 1;
  if v_lodge_id is null then return jsonb_build_object('success',false,'error','Lodge not found'); end if;
  v_request:=jsonb_build_object('lodge_id',v_lodge_id,'slug',v_slug,'payload',v_payload);
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('public-booking-key:'||v_lodge_id::text||':'||v_key,0));
  select * into v_existing from public.public_booking_idempotency i
   where i.lodge_id=v_lodge_id and i.idempotency_key=v_key for update;
  if found then
    if v_existing.original_request is null then
      return jsonb_build_object('success',false,'code','manual_recovery_required','manual_review_required',true,
        'error','An older public booking key has no original request envelope. Preserve the request and contact the property before retrying.');
    end if;
    if v_existing.request_hash is distinct from v_hash or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'code','idempotency_conflict','error','This booking request key was already used for different details. Start a new request only after confirming the earlier result.');
    end if;
    if v_existing.result is null then
      return jsonb_build_object('success',false,'code','manual_recovery_required','manual_review_required',true,
        'error','The earlier public booking has no saved result. Contact the property before creating another request.');
    end if;
    return v_existing.result||jsonb_build_object('idempotent',true);
  end if;

  if exists(select 1 from public.bookings b where b.lodge_id=v_lodge_id
      and (b.create_idempotency_key=v_key or b.create_idempotency_key like v_key||':%')) then
    return jsonb_build_object('success',false,'code','manual_recovery_required','manual_review_required',true,
      'error','A booking already uses this key but its original public request is unavailable. Contact the property before retrying.');
  end if;

  insert into public.public_booking_idempotency(
    lodge_id,idempotency_key,request_hash,effective_idempotency_key,booking_ids,result,original_request
  ) values(v_lodge_id,v_key,v_hash,v_key,'{}'::uuid[],null,v_request);

  v_expected_booking_count:=case
    when lower(coalesce(v_payload->>'booking_type','room'))='full_lodge' then 1
    when jsonb_typeof(v_payload->'rooms')='array' then jsonb_array_length(v_payload->'rooms')
    else 1 end;
  if v_expected_booking_count<1
     or (lower(coalesce(v_payload->>'booking_type','room'))='multi_room'
       and (jsonb_typeof(v_payload->'rooms')<>'array' or v_expected_booking_count<2)) then
    v_result:=jsonb_build_object('success',false,'code','booking_rejected','legacy_rejection_code','invalid_room_group',
      'error','A multi-room request must include at least two rooms.');
  else
    begin
      v_result:=public.create_online_booking_legacy(v_slug,
        jsonb_set(coalesce(payload,'{}'::jsonb),'{idempotency_key}',to_jsonb(v_key),true));
      if coalesce(jsonb_typeof(v_result),'null')<>'object' then
        raise exception 'Public booking implementation returned a malformed result' using errcode='P0001';
      end if;
      if coalesce((v_result->>'success')::boolean,false) is not true then
        v_result:=v_result||jsonb_build_object('legacy_rejection_code',v_result->>'code','code','booking_rejected');
        -- The older multi-room routine may return false after earlier child rows
        -- have been inserted. A sentinel exception rolls all of its writes back.
        raise exception 'Public booking was definitively rejected' using errcode='ZL001';
      end if;
    exception when sqlstate 'ZL001' then
      null;
    end;
  end if;
  if coalesce((v_result->>'success')::boolean,false) is not true then
    update public.public_booking_idempotency set result=v_result,updated_at=now()
     where lodge_id=v_lodge_id and idempotency_key=v_key;
    return v_result;
  end if;
  select case
    when jsonb_typeof(v_result->'booking_ids')='array'
      then array(select x.value::uuid from jsonb_array_elements_text(v_result->'booking_ids') x)
    when nullif(v_result->>'booking_id','') is not null
      then array[(v_result->>'booking_id')::uuid]
    else '{}'::uuid[] end into v_booking_ids;
  if coalesce(array_length(v_booking_ids,1),0)<>v_expected_booking_count
     or (select count(distinct u.booking_id) from unnest(v_booking_ids) as u(booking_id))<>v_expected_booking_count
     or exists(select 1 from unnest(v_booking_ids) as u(booking_id) left join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id where b.id is null)
     or exists(select 1 from unnest(v_booking_ids) as u(booking_id) where not exists(select 1 from public.invoices i where i.booking_id=u.booking_id and i.lodge_id=v_lodge_id))
     or exists(select 1 from unnest(v_booking_ids) as u(booking_id) join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id
       where b.create_idempotency_key is distinct from v_key and b.create_idempotency_key is distinct from v_key||':'||b.room_id::text)
     or exists(select 1 from unnest(v_booking_ids) as u(booking_id) join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id
       where b.check_in is distinct from nullif(v_payload->>'check_in','')::date
         or b.check_out is distinct from nullif(v_payload->>'check_out','')::date
         or coalesce(b.source,'')<>'online'
         or (lower(coalesce(v_payload->>'booking_type','room'))='full_lodge' and coalesce(b.is_exclusive_event,false) is not true))
     or (jsonb_typeof(v_payload->'rooms')='array' and exists(
       select 1
       from jsonb_array_elements(v_payload->'rooms') with ordinality as r(value,ordinality)
       full join unnest(v_booking_ids) with ordinality as u(booking_id,ordinality) using(ordinality)
       left join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id
       where r.ordinality is null or u.ordinality is null
          or b.room_id is distinct from nullif(r.value->>'room_id','')::uuid
          or b.adults is distinct from greatest(1,coalesce(nullif(r.value->>'adults','')::integer,1))
          or b.children is distinct from greatest(0,coalesce(nullif(r.value->>'children','')::integer,0)))) then
    raise exception 'Public booking response does not match committed booking and invoice rows' using errcode='P0001';
  end if;

  if array_length(v_booking_ids,1)>1 then
    select array_agg(distinct l.group_id),count(distinct l.booking_id)
      into v_group_ids,v_group_line_count
      from public.booking_invoice_group_lines l
      join public.booking_invoice_groups g on g.id=l.group_id and g.lodge_id=v_lodge_id
     where l.lodge_id=v_lodge_id and l.booking_id=any(v_booking_ids);
    if coalesce(array_length(v_group_ids,1),0)<>1
       or v_group_line_count<>array_length(v_booking_ids,1)
       or coalesce((v_result->>'group_invoice')::boolean,false) is not true
       or not exists(select 1 from public.booking_invoice_groups g where g.id=v_group_ids[1] and g.lodge_id=v_lodge_id
         and g.invoice_number is not distinct from v_result->>'invoice_number')
       or exists(select 1 from unnest(v_booking_ids) as u(booking_id) join public.bookings b on b.id=u.booking_id and b.lodge_id=v_lodge_id
         join public.booking_invoice_groups g on g.id=v_group_ids[1] and g.lodge_id=v_lodge_id
         where b.customer_id is distinct from g.customer_id) then
      raise exception 'Public multi-room booking did not persist one complete lodge-scoped invoice group' using errcode='P0001';
    end if;
  end if;


  v_result:=v_result||jsonb_build_object(
    'operation_id',v_key,'operation_type','public_booking_create_v1','payload_hash',v_hash,
    'lodge_id',v_lodge_id,'request_payload',v_request,
    'receipt',jsonb_build_object('booking_ids',to_jsonb(v_booking_ids),'booking_id',v_booking_ids[1])
  );
  update public.public_booking_idempotency
     set booking_ids=v_booking_ids,result=v_result,updated_at=now()
   where lodge_id=v_lodge_id and idempotency_key=v_key;
  return v_result||jsonb_build_object('idempotent',false);
end;
$$;

-- Old implementations are server-only; all API clients enter through the
-- exact-envelope wrappers after schema cache refresh.
revoke all on function public.create_campsite_booking_pre_intent_v1(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text) from public,anon,authenticated;
revoke all on function public.create_campsite_booking(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text) from public,anon;
grant execute on function public.create_campsite_booking(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text) to anon,authenticated,service_role;

revoke all on function public.create_multi_room_booking_pre_intent_v1(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text) from public,anon;
grant execute on function public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text) to anon,authenticated,service_role;

revoke all on function public.create_online_booking_legacy(text,jsonb) from public,anon,authenticated;
revoke all on function public.create_online_booking(text,jsonb) from public,anon;
grant execute on function public.create_online_booking(text,jsonb) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
