-- Luna remediation: bind create_booking replay to the original authorized request.
-- The prior authoritative implementation remains behind a server-only name;
-- original request identity, deposit, invoice and result commit together.

begin;

alter function public.create_booking(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)
  rename to create_booking_pre_intent_v1;

create table public.booking_create_intents (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  actor_id uuid not null,
  booking_id uuid references public.bookings(id) on delete restrict,
  original_request jsonb not null,
  request_hash text not null,
  operation_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint booking_create_intents_key_len_chk check(length(operation_key) between 8 and 128),
  constraint booking_create_intents_lodge_key_uidx unique(lodge_id,operation_key)
);
create unique index booking_create_intents_lodge_booking_uidx
  on public.booking_create_intents(lodge_id,booking_id) where booking_id is not null;
alter table public.booking_create_intents enable row level security;
revoke all on public.booking_create_intents from public,anon,authenticated;
grant select,insert on public.booking_create_intents to service_role;

create or replace function public.create_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_total_amount numeric,
  p_invoice_number text default null,
  p_notes text default '',
  p_created_by uuid default null,
  p_deposit_amount numeric default 0,
  p_booking_id uuid default null,
  p_idempotency_key text default null,
  p_deposit_method text default null,
  p_allow_total_override boolean default false
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_actor uuid:=public.app_current_user_id();
  v_key text:=p_idempotency_key;
  v_method text:=nullif(btrim(coalesce(p_deposit_method,'')),'');
  v_notes text:=coalesce(p_notes,'');
  v_allow_override boolean:=coalesce(p_allow_total_override,false);
  v_total numeric:=case when p_total_amount is null then null else round(p_total_amount,2) end;
  v_deposit numeric:=round(coalesce(p_deposit_amount,0),2);
  v_request jsonb;
  v_hash text;
  v_existing public.booking_create_intents%rowtype;
  v_booking_id uuid:=coalesce(p_booking_id,gen_random_uuid());
  v_result jsonb;
  v_invoice_number text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id,array['receptionist','manager','admin','super_admin']);
  if p_lodge_id is null or v_actor is null then
    raise exception 'Authenticated actor and lodge are required' using errcode='42501';
  end if;
  if v_key is null or v_key='' or v_key<>btrim(v_key) or length(v_key)<8 or length(v_key)>128 then
    return jsonb_build_object('success',false,'error','Booking creation requires a stable idempotency key of 8 to 128 characters.');
  end if;
  if p_created_by is not null and p_created_by is distinct from v_actor then
    raise exception 'Booking created_by must match the authenticated actor' using errcode='42501';
  end if;
  if (v_total is not null and v_total::text in ('NaN','Infinity','-Infinity'))
     or v_deposit::text in ('NaN','Infinity','-Infinity') then
    return jsonb_build_object('success',false,'error','Booking total and deposit must be finite amounts.');
  end if;

  v_request:=jsonb_build_object(
    'actor_id',v_actor,'lodge_id',p_lodge_id,'customer_id',p_customer_id,'room_id',p_room_id,
    'check_in',p_check_in,'check_out',p_check_out,'adults',p_adults,'children',p_children,
    'total_amount',v_total,'invoice_number',p_invoice_number,'notes',v_notes,
    'created_by',v_actor,'deposit_amount',v_deposit,'deposit_method',v_method,
    'allow_total_override',v_allow_override,'requested_booking_id',p_booking_id
  );
  v_hash:=encode(sha256(convert_to(v_request::text,'UTF8')),'hex');

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('booking-create-key:'||p_lodge_id::text||':'||v_key,0));
  select * into v_existing from public.booking_create_intents
   where lodge_id=p_lodge_id and operation_key=v_key for update;
  if found then
    if v_existing.actor_id is distinct from v_actor
       or v_existing.request_hash is distinct from v_hash
       or v_existing.original_request is distinct from v_request then
      return jsonb_build_object('success',false,'error','Booking idempotency key was already used for a different authorized request.');
    end if;
    return v_existing.operation_result;
  end if;

  -- A booking UUID is global across lodges. Lock it without lodge scoping so
  -- simultaneous cross-property claims cannot race past the row check.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('booking-create-id:'||v_booking_id::text,0));
  if exists(select 1 from public.booking_create_intents i where i.lodge_id=p_lodge_id and i.booking_id=v_booking_id) then
    return jsonb_build_object('success',false,'error','This booking ID is already bound to a different creation intent.');
  end if;
  if exists(select 1 from public.bookings b where b.id=v_booking_id or (b.lodge_id=p_lodge_id and b.create_idempotency_key=v_key)) then
    return jsonb_build_object('success',false,'error','An older booking uses this key or ID without a verifiable original request. Manual recovery is required; no replacement was created.');
  end if;

  if v_deposit<0 then
    v_result:=jsonb_build_object('success',false,'error','Booking deposit cannot be negative.');
  elsif not exists(select 1 from public.customers c where c.id=p_customer_id and c.lodge_id=p_lodge_id) then
    v_result:=jsonb_build_object('success',false,'error','Customer was not found in this lodge. Refresh the customer list before retrying.');
  else
    v_result:=public.create_booking_pre_intent_v1(
      p_lodge_id,p_customer_id,p_room_id,p_check_in,p_check_out,p_adults,p_children,
      v_total,p_invoice_number,v_notes,v_actor,v_deposit,v_booking_id,v_key,v_method,v_allow_override
    );
  end if;

  if coalesce((v_result->>'success')::boolean,false) then
    if nullif(v_result->>'booking_id','') is null then
      raise exception 'Booking creation returned success without its original booking ID' using errcode='P0001';
    end if;
    v_booking_id:=(v_result->>'booking_id')::uuid;
    select i.invoice_number into v_invoice_number from public.invoices i
      where i.booking_id=v_booking_id and i.lodge_id=p_lodge_id;
    if not found then
      raise exception 'Booking creation did not create its required invoice row' using errcode='P0001';
    end if;
    if not exists(select 1 from public.bookings b where b.id=v_booking_id and b.lodge_id=p_lodge_id and b.create_idempotency_key=v_key) then
      raise exception 'Booking creation result does not match its committed lodge/key row' using errcode='P0001';
    end if;
    if v_deposit>0 and not exists(select 1 from public.payments pay where pay.booking_id=v_booking_id and pay.lodge_id=p_lodge_id
      and pay.type='deposit' and pay.idempotency_key='payment:deposit:'||v_booking_id::text
      and pay.amount=v_deposit and pay.method is not distinct from v_method) then
      raise exception 'Booking creation returned success without its required deposit ledger entry' using errcode='P0001';
    end if;
    v_result:=v_result||jsonb_build_object(
      'operation_id',v_key,'operation_type','booking_create_v1','payload_hash',v_hash,
      'lodge_id',p_lodge_id,'actor_id',v_actor,'request_payload',v_request,
      'receipt',jsonb_build_object('booking_id',v_booking_id,'invoice_number',v_invoice_number,'deposit_amount',v_deposit)
    );
  end if;

  insert into public.booking_create_intents(
    lodge_id,operation_key,actor_id,booking_id,original_request,request_hash,operation_result
  ) values(p_lodge_id,v_key,v_actor,
    case when coalesce((v_result->>'success')::boolean,false) then v_booking_id else null end,
    v_request,v_hash,v_result);
  return v_result;
end;
$$;

-- Remove every direct old/overloaded create_booking grant; only the exact
-- envelope wrapper is available to authenticated clients after this migration.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_booking'
  loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  end loop;
end $$;
revoke all on function public.create_booking_pre_intent_v1(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.create_booking(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)
  to anon,authenticated,service_role;

-- Read-only full-scope legacy gap scan; samples are deliberately bounded.
create or replace function public.get_booking_create_intent_diagnostics(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_result jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin','finance']);
  with legacy as materialized (
    select b.id as booking_id,b.create_idempotency_key,b.created_at
    from public.bookings b left join public.booking_create_intents i on i.lodge_id=b.lodge_id and i.booking_id=b.id
    where b.lodge_id=p_lodge_id and i.id is null
  )
  select jsonb_build_object(
    'schema_version',1,'complete',true,'lodge_id',p_lodge_id,'generated_at',clock_timestamp(),
    'legacy_booking_count',(select count(*) from legacy),
    'sample_limit',50,
    'samples',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from legacy order by created_at desc,booking_id limit 50) x),'[]'::jsonb),
    'samples_truncated',(select count(*) from legacy)>50
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_booking_create_intent_diagnostics(uuid) from public,anon;
grant execute on function public.get_booking_create_intent_diagnostics(uuid) to anon,authenticated,service_role;

commit;