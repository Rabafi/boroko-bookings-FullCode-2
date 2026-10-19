-- Luna remediation: immutable keyed Hotel folio mutations and ledger lineage.
-- Forward-only. Existing unlinked transfer/void history is deliberately preserved
-- for read-only review; no amount/time-based history is backfilled.

begin;

create table if not exists public.hotel_folio_transfer_pairs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  source_folio_id uuid not null references public.hotel_folios(id),
  target_folio_id uuid not null references public.hotel_folios(id),
  operation_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint hotel_folio_transfer_pairs_distinct_chk check (source_folio_id <> target_folio_id),
  constraint hotel_folio_transfer_pairs_key_uidx unique (lodge_id, operation_key)
);

alter table public.folio_line_items
  add column if not exists transfer_pair_id uuid,
  add column if not exists reverses_line_item_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'folio_line_items_transfer_pair_fk') then
    alter table public.folio_line_items add constraint folio_line_items_transfer_pair_fk
      foreign key (transfer_pair_id) references public.hotel_folio_transfer_pairs(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'folio_line_items_reverses_line_fk') then
    alter table public.folio_line_items add constraint folio_line_items_reverses_line_fk
      foreign key (reverses_line_item_id) references public.folio_line_items(id) on delete restrict;
  end if;
end $$;

create unique index if not exists folio_line_items_one_reversal_per_original_uidx
  on public.folio_line_items(reverses_line_item_id)
  where reverses_line_item_id is not null;
create unique index if not exists folio_line_items_transfer_leg_once_uidx
  on public.folio_line_items(transfer_pair_id, line_type)
  where transfer_pair_id is not null and line_type in ('transfer_in','transfer_out');
-- Enforce tenant/folio lineage for new rows without blocking installation on
-- ambiguous historic line items. NOT VALID foreign keys still check new writes.
create unique index if not exists hotel_folios_lodge_id_id_uidx
  on public.hotel_folios(lodge_id,id);
create unique index if not exists folio_line_items_lodge_id_id_uidx
  on public.folio_line_items(lodge_id,id);
create unique index if not exists hotel_folio_transfer_pairs_lodge_id_uidx
  on public.hotel_folio_transfer_pairs(lodge_id,id);

do $$
begin
  if not exists(select 1 from pg_constraint where conname='hotel_folio_transfer_pairs_source_scope_fk') then
    alter table public.hotel_folio_transfer_pairs add constraint hotel_folio_transfer_pairs_source_scope_fk
      foreign key(lodge_id,source_folio_id) references public.hotel_folios(lodge_id,id) on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='hotel_folio_transfer_pairs_target_scope_fk') then
    alter table public.hotel_folio_transfer_pairs add constraint hotel_folio_transfer_pairs_target_scope_fk
      foreign key(lodge_id,target_folio_id) references public.hotel_folios(lodge_id,id) on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='folio_line_items_folio_scope_fk') then
    alter table public.folio_line_items add constraint folio_line_items_folio_scope_fk
      foreign key(lodge_id,folio_id) references public.hotel_folios(lodge_id,id) on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='folio_line_items_pair_scope_fk') then
    alter table public.folio_line_items add constraint folio_line_items_pair_scope_fk
      foreign key(lodge_id,transfer_pair_id) references public.hotel_folio_transfer_pairs(lodge_id,id) on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conname='folio_line_items_reversal_scope_fk') then
    alter table public.folio_line_items add constraint folio_line_items_reversal_scope_fk
      foreign key(lodge_id,reverses_line_item_id) references public.folio_line_items(lodge_id,id) on delete restrict not valid;
  end if;
end $$;

create or replace function public._hotel_folio_validate_lineage_v1()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_pair public.hotel_folio_transfer_pairs%rowtype; v_original public.folio_line_items%rowtype;
begin
  if not exists(select 1 from public.hotel_folios hf where hf.id=new.folio_id and hf.lodge_id=new.lodge_id) then
    raise exception 'Folio line lodge does not match its folio' using errcode='23514';
  end if;
  if new.line_type in ('transfer_in','transfer_out') and new.transfer_pair_id is null then
    raise exception 'New transfer lines require an immutable transfer pair' using errcode='23514';
  end if;
  if new.line_type='void' then
    if new.reverses_line_item_id is null then
      raise exception 'New folio corrections must reference the original line' using errcode='23514';
    end if;
    select * into v_original from public.folio_line_items li
      where li.id=new.reverses_line_item_id and li.lodge_id=new.lodge_id;
    if not found or v_original.folio_id is distinct from new.folio_id then
      raise exception 'Correction original must be in the same lodge and folio' using errcode='23514';
    end if;
    if v_original.line_type in ('transfer_in','transfer_out') then
      if v_original.transfer_pair_id is null or new.transfer_pair_id is distinct from v_original.transfer_pair_id then
        raise exception 'Transfer correction must retain its complete transfer pair' using errcode='23514';
      end if;
    elsif new.transfer_pair_id is not null then
      raise exception 'Non-transfer correction cannot claim a transfer pair' using errcode='23514';
    end if;
  elsif new.reverses_line_item_id is not null then
    raise exception 'Only correction lines may reference an original line' using errcode='23514';
  elsif new.transfer_pair_id is not null then
    if new.line_type not in ('transfer_in','transfer_out') then
      raise exception 'Only transfer legs may create a transfer pair' using errcode='23514';
    end if;
    select * into v_pair from public.hotel_folio_transfer_pairs tp
      where tp.id=new.transfer_pair_id and tp.lodge_id=new.lodge_id;
    if not found then raise exception 'Transfer pair is not in this lodge' using errcode='23514'; end if;
    if (new.line_type='transfer_out' and new.folio_id is distinct from v_pair.source_folio_id)
       or (new.line_type='transfer_in' and new.folio_id is distinct from v_pair.target_folio_id) then
      raise exception 'Transfer leg does not match its paired folio endpoint' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hotel_folio_validate_lineage_v1 on public.folio_line_items;
create trigger trg_hotel_folio_validate_lineage_v1
  before insert or update of folio_id,lodge_id,line_type,transfer_pair_id,reverses_line_item_id
  on public.folio_line_items for each row execute function public._hotel_folio_validate_lineage_v1();
revoke all on function public._hotel_folio_validate_lineage_v1() from public,anon,authenticated;

-- Financial table changes must stay behind the authorized RPC contract.
revoke insert,update,delete,truncate,references,trigger on public.hotel_folios,public.folio_line_items from public,anon,authenticated;

create table if not exists public.hotel_folio_mutation_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  operation_key text not null,
  operation_kind text not null,
  actor_id uuid not null,
  entity_id uuid,
  request_hash text not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (lodge_id, operation_key)
);
alter table public.hotel_folio_mutation_audit enable row level security;
revoke all on public.hotel_folio_mutation_audit from public, anon, authenticated;
grant select, insert on public.hotel_folio_mutation_audit to service_role;
alter table public.hotel_folio_transfer_pairs enable row level security;
revoke all on public.hotel_folio_transfer_pairs from public, anon, authenticated;
grant select, insert on public.hotel_folio_transfer_pairs to service_role;

create or replace function public._hotel_folio_finish_v1(
  p_lodge_id uuid, p_key text, p_kind text, p_entity_id uuid, p_hash text, p_request_payload jsonb, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_envelope jsonb;
begin
  v_envelope := jsonb_build_object(
    'success', coalesce((p_result->>'success')::boolean, false),
    'operation_id', p_key,
    'operation_type', 'hotel_folio_' || p_kind || '_v1',
    'payload_hash', p_hash,
    'lodge_id', p_lodge_id,
    'actor_id', public.app_current_user_id(),
    'request_payload', p_request_payload,
    'receipt', p_result
  );
  perform public._record_financial_operation(
    p_lodge_id, p_key, 'hotel_folio_' || p_kind || '_v1', p_entity_id, p_hash, v_envelope
  );
  return v_envelope;
end;
$$;

create or replace function public._hotel_folio_apply_transfer_v1(
  p_lodge_id uuid, p_source_id uuid, p_target_id uuid, p_amount numeric,
  p_description text, p_actor uuid, p_key text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_source public.hotel_folios%rowtype;
  v_target public.hotel_folios%rowtype;
  v_pair uuid := gen_random_uuid();
  v_out public.folio_line_items%rowtype;
  v_in public.folio_line_items%rowtype;
begin
  if p_source_id is null or p_target_id is null or p_source_id = p_target_id then
    return jsonb_build_object('success', false, 'error', 'Choose two different folios in the same lodge.');
  end if;
  perform hf.id from public.hotel_folios hf
   where hf.lodge_id = p_lodge_id and hf.id in (p_source_id, p_target_id)
   order by hf.id for update;
  select * into v_source from public.hotel_folios where lodge_id=p_lodge_id and id=p_source_id;
  select * into v_target from public.hotel_folios where lodge_id=p_lodge_id and id=p_target_id;
  if v_source.id is null or v_target.id is null then
    return jsonb_build_object('success', false, 'error', 'Source or target folio not found in this lodge.');
  end if;
  if v_source.status <> 'open' or v_target.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Both source and target folios must be open.');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount <> round(p_amount,2) then
    return jsonb_build_object('success', false, 'error', 'Transfer amount must be positive and no more than two decimal places.');
  end if;
  insert into public.hotel_folio_transfer_pairs(id,lodge_id,source_folio_id,target_folio_id,operation_key,created_by)
  values(v_pair,p_lodge_id,p_source_id,p_target_id,p_key,p_actor);
  insert into public.folio_line_items(folio_id,lodge_id,amount,line_type,description,created_by,audit_before,transfer_pair_id)
  values(p_source_id,p_lodge_id,p_amount,'transfer_out',coalesce(p_description,'Transfer out'),p_actor,to_jsonb(v_source),v_pair)
  returning * into v_out;
  insert into public.folio_line_items(folio_id,lodge_id,amount,line_type,description,created_by,audit_before,transfer_pair_id)
  values(p_target_id,p_lodge_id,p_amount,'transfer_in',coalesce(p_description,'Transfer in'),p_actor,to_jsonb(v_target),v_pair)
  returning * into v_in;
  update public.hotel_folios set balance=balance-p_amount,updated_at=now() where id=p_source_id returning * into v_source;
  update public.hotel_folios set balance=balance+p_amount,updated_at=now() where id=p_target_id returning * into v_target;
  update public.folio_line_items set audit_after=to_jsonb(v_source) where id=v_out.id;
  update public.folio_line_items set audit_after=to_jsonb(v_target) where id=v_in.id;
  select * into v_out from public.folio_line_items where id=v_out.id;
  select * into v_in from public.folio_line_items where id=v_in.id;
  return jsonb_build_object('success',true,'pair_id',v_pair,'transfer_out',to_jsonb(v_out),'transfer_in',to_jsonb(v_in),
    'source_folio',to_jsonb(v_source),'target_folio',to_jsonb(v_target));
end;
$$;

create or replace function public.hotel_folio_mutation_v1(
  p_lodge_id uuid, p_operation_kind text, p_idempotency_key text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_key text := p_idempotency_key;
  v_entity uuid;
  v_hash text;
  v_claim jsonb;
  v_result jsonb;
  v_nested jsonb;
  v_before jsonb;
  v_after jsonb;
  v_child_key text;
  v_source public.hotel_folios%rowtype;
  v_target public.hotel_folios%rowtype;
  v_line public.folio_line_items%rowtype;
  v_pair public.hotel_folio_transfer_pairs%rowtype;
  v_leg public.folio_line_items%rowtype;
  v_reversal public.folio_line_items%rowtype;
  v_reversals jsonb;
  v_target_id uuid;
  v_target_type text;
  v_amount numeric;
  v_reason text;
  v_reversal_count integer;
  v_pair_leg_count integer;
  v_original_count integer;
  v_status text;
begin
  perform public.app_reject_pwa_financial_mutation();
  if p_lodge_id is null or v_actor is null then
    raise exception 'An authenticated Hotel user and lodge are required' using errcode='42501';
  end if;
  if v_key is null or v_key = '' or v_key <> btrim(v_key) or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success',false,'error','A stable folio operation key of 8 to 128 characters is required.');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('success',false,'error','Folio operation details must be an object.');
  end if;
  if p_operation_kind is null or p_operation_kind not in ('create','charge','payment','booking_charge','transfer','split','void','close','reopen','lock') then
    raise exception 'Unsupported Hotel folio operation' using errcode='22023';
  end if;

  if p_operation_kind in ('create','charge','payment','booking_charge') then
    perform public.app_require_lodge_role(p_lodge_id,array['receptionist','cashier','supervisor','manager','admin','super_admin','finance']);
  elsif p_operation_kind in ('close') then
    perform public.app_require_lodge_role(p_lodge_id,array['supervisor','manager','admin','super_admin','finance']);
  elsif p_operation_kind in ('reopen','lock','transfer','split','void') then
    if p_operation_kind in ('reopen','lock') then
      perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin','finance']);
    else
      perform public.app_require_lodge_role(p_lodge_id,array['supervisor','manager','admin','super_admin','finance']);
    end if;
  end if;

  if p_operation_kind='create' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['booking_id','guest_id','folio_type','label'])) then
      return jsonb_build_object('success',false,'error','Create folio payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='charge' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['folio_id','amount','description','reference_type','reference_id'])) then
      return jsonb_build_object('success',false,'error','Charge payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='payment' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['folio_id','amount','description'])) then
      return jsonb_build_object('success',false,'error','Payment payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='booking_charge' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['booking_id','description','category','quantity','unit_price','outlet_id','expected_updated_at'])) then
      return jsonb_build_object('success',false,'error','Booking charge payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='transfer' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['source_folio_id','target_folio_id','amount','description'])) then
      return jsonb_build_object('success',false,'error','Transfer payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='split' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['source_folio_id','target_folio_type','target_label','amount','description'])) then
      return jsonb_build_object('success',false,'error','Split payload contains unsupported fields.');
    end if;
  elsif p_operation_kind='void' then
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['line_item_id','reason'])) then
      return jsonb_build_object('success',false,'error','Void payload contains unsupported fields.');
    end if;
  else
    if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key <> all(array['folio_id'])) then
      return jsonb_build_object('success',false,'error','Folio status payload contains unsupported fields.');
    end if;
  end if;

  v_entity := coalesce(nullif(p_payload->>'folio_id','')::uuid,
                       nullif(p_payload->>'source_folio_id','')::uuid,
                       nullif(p_payload->>'line_item_id','')::uuid,
                       nullif(p_payload->>'booking_id','')::uuid);
  if p_operation_kind='void' and nullif(btrim(coalesce(p_payload->>'reason','')),'') is null then
    return jsonb_build_object('success',false,'error','A correction reason is required.');
  end if;

  v_hash := encode(sha256(convert_to(p_lodge_id::text || ':' || v_actor::text || ':' ||
    p_operation_kind || ':' || p_payload::text,'UTF8')),'hex');
  v_claim := public._claim_financial_operation(p_lodge_id,v_key,'hotel_folio_'||p_operation_kind||'_v1',v_entity,v_hash);
  if coalesce((v_claim->>'success')::boolean,false) is not true then return v_claim; end if;
  if coalesce((v_claim->>'found')::boolean,false) then return v_claim->'operation_result'; end if;

  if p_operation_kind='create' then
    if nullif(p_payload->>'booking_id','') is not null and not exists(
      select 1 from public.bookings b where b.id=(p_payload->>'booking_id')::uuid and b.lodge_id=p_lodge_id
    ) then
      v_result:=jsonb_build_object('success',false,'error','Booking not found in this lodge.');
    elsif nullif(p_payload->>'guest_id','') is not null and not exists(
      select 1 from public.customers c where c.id=(p_payload->>'guest_id')::uuid and c.lodge_id=p_lodge_id
    ) then
      v_result:=jsonb_build_object('success',false,'error','Guest not found in this lodge.');
    else
      v_nested:=public.create_hotel_folio(p_lodge_id,
        nullif(p_payload->>'booking_id','')::uuid,
        nullif(p_payload->>'guest_id','')::uuid,
        coalesce(nullif(p_payload->>'folio_type',''),'guest'),
        coalesce(p_payload->>'label',''));
      if coalesce((v_nested->>'success')::boolean,false) then
        v_result:=jsonb_build_object('success',true,'result',v_nested);
        v_after:=v_nested->'folio';
      else
        v_result:=v_nested;
      end if;
    end if;
  elsif p_operation_kind in ('charge','payment') then
    v_entity:=nullif(p_payload->>'folio_id','')::uuid;
    v_amount:=(p_payload->>'amount')::numeric;
    select * into v_source from public.hotel_folios where id=v_entity and lodge_id=p_lodge_id for update;
    if not found then
      v_result:=jsonb_build_object('success',false,'error','Folio not found in this lodge.');
    elsif v_source.status<>'open' then
      v_result:=jsonb_build_object('success',false,'error','Folio is '||v_source.status||'; financial entries require an open folio.');
    elsif v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<>round(v_amount,2) then
      v_result:=jsonb_build_object('success',false,'error','Amount must be positive and no more than two decimal places.');
    else
      v_before:=to_jsonb(v_source);
      v_child_key:='folio-child:'||md5(v_key);
      if p_operation_kind='charge' then
        v_nested:=public.add_folio_charge(p_lodge_id,v_entity,v_amount,coalesce(p_payload->>'description',''),
          nullif(p_payload->>'reference_type',''),nullif(p_payload->>'reference_id','')::uuid,v_child_key);
      else
        v_nested:=public.add_folio_payment(p_lodge_id,v_entity,v_amount,coalesce(nullif(p_payload->>'description',''),'Payment'),v_child_key);
      end if;
      if coalesce((v_nested->>'success')::boolean,false) then
        v_result:=jsonb_build_object('success',true,'result',v_nested);
        v_after:=v_nested->'folio';
      else
        v_result:=v_nested;
      end if;
    end if;
  elsif p_operation_kind='booking_charge' then
    v_entity:=nullif(p_payload->>'booking_id','')::uuid;
    v_amount:=(p_payload->>'unit_price')::numeric;
    if v_entity is null or v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<>round(v_amount,2)
      or coalesce((p_payload->>'quantity')::numeric,0)<=0
      or (p_payload->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') then
      v_result:=jsonb_build_object('success',false,'error','Booking charge requires a booking and positive quantity/unit price with at most two price decimals.');
    else
      select to_jsonb(b) into v_before from public.bookings b where b.id=v_entity and b.lodge_id=p_lodge_id for update;
      if v_before is null then
        v_result:=jsonb_build_object('success',false,'error','Booking not found in this lodge.');
      else
        v_child_key:='folio-child:'||md5(v_key);
        v_nested:=public.add_booking_charge(v_entity,p_lodge_id,coalesce(p_payload->>'description',''),
          coalesce(nullif(p_payload->>'category',''),'folio'),(p_payload->>'quantity')::numeric,v_amount,
          nullif(p_payload->>'outlet_id','')::uuid,nullif(p_payload->>'expected_updated_at','')::timestamptz,v_child_key);
        if coalesce((v_nested->>'success')::boolean,false) then
          v_result:=jsonb_build_object('success',true,'result',v_nested);
          v_after:=v_nested;
        else
          v_result:=v_nested;
        end if;
      end if;
    end if;
  elsif p_operation_kind='transfer' then
    v_entity:=nullif(p_payload->>'source_folio_id','')::uuid;
    v_amount:=(p_payload->>'amount')::numeric;
    v_nested:=public._hotel_folio_apply_transfer_v1(p_lodge_id,v_entity,
      nullif(p_payload->>'target_folio_id','')::uuid,v_amount,coalesce(p_payload->>'description',''),v_actor,v_key);
    v_result:=case when coalesce((v_nested->>'success')::boolean,false)
      then jsonb_build_object('success',true,'result',v_nested) else v_nested end;
    if coalesce((v_nested->>'success')::boolean,false) then
      v_before:=jsonb_build_object('source',v_nested->'transfer_out'->'audit_before','target',v_nested->'transfer_in'->'audit_before');
      v_after:=jsonb_build_object('source',v_nested->'source_folio','target',v_nested->'target_folio');
    end if;
  elsif p_operation_kind='split' then
    v_entity:=nullif(p_payload->>'source_folio_id','')::uuid;
    v_amount:=(p_payload->>'amount')::numeric;
    select * into v_source from public.hotel_folios where id=v_entity and lodge_id=p_lodge_id for update;
    if not found or v_source.status<>'open' then
      v_result:=jsonb_build_object('success',false,'error','Source folio not found or not open.');
    elsif v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<>round(v_amount,2) then
      v_result:=jsonb_build_object('success',false,'error','Split amount must be positive and no more than two decimal places.');
    else
      v_target_type:=coalesce(nullif(p_payload->>'target_folio_type',''),'guest');
      if v_target_type not in ('guest','master','company','department','incidental') then
        v_result:=jsonb_build_object('success',false,'error','Choose a supported target folio type.');
      else
        v_target_id:=gen_random_uuid();
        insert into public.hotel_folios(id,lodge_id,booking_id,guest_id,folio_type,folio_number,label,status,balance)
        values(v_target_id,p_lodge_id,v_source.booking_id,v_source.guest_id,v_target_type,public.app_generate_folio_number(p_lodge_id),
          coalesce(p_payload->>'target_label',''),'open',0) returning * into v_target;
        v_nested:=public._hotel_folio_apply_transfer_v1(p_lodge_id,v_entity,v_target_id,v_amount,
          coalesce(nullif(p_payload->>'description',''),'Split transfer'),v_actor,v_key);
        if coalesce((v_nested->>'success')::boolean,false) is not true then
          raise exception 'Split could not be completed atomically: %',coalesce(v_nested->>'error','transfer failed') using errcode='P0001';
        end if;
        v_result:=jsonb_build_object('success',true,'result',jsonb_build_object('source_folio_id',v_entity,
          'target_folio',to_jsonb(v_target),'transfer',v_nested));
        v_before:=to_jsonb(v_source);
        v_after:=jsonb_build_object('source',v_nested->'source_folio','target',v_nested->'target_folio');
      end if;
    end if;
  elsif p_operation_kind='void' then
    select li.* into v_line from public.folio_line_items li
      join public.hotel_folios hf on hf.id=li.folio_id
      where li.id=(p_payload->>'line_item_id')::uuid and hf.lodge_id=p_lodge_id;
    if not found then
      v_result:=jsonb_build_object('success',false,'error','Line item not found in this lodge.');
    elsif v_line.line_type in ('void') or v_line.reverses_line_item_id is not null then
      v_result:=jsonb_build_object('success',false,'error','A reversal cannot itself be voided.');
    elsif v_line.line_type in ('transfer_in','transfer_out') and v_line.transfer_pair_id is null then
      v_result:=jsonb_build_object('success',false,'error','This historical transfer has no unambiguous pair link. Reconcile the original ledger before correcting it.');
    elsif v_line.transfer_pair_id is null and v_line.line_type not in ('charge','payment') then
      v_result:=jsonb_build_object('success',false,'error','This historical line type requires manual reconciliation before correction.');
    else
      if v_line.transfer_pair_id is not null then
        select * into v_pair from public.hotel_folio_transfer_pairs where id=v_line.transfer_pair_id and lodge_id=p_lodge_id;
        if not found then
          v_result:=jsonb_build_object('success',false,'error','Transfer pair evidence is incomplete; reconcile before correction.');
        else
          perform hf.id from public.hotel_folios hf where hf.lodge_id=p_lodge_id and hf.id in(v_pair.source_folio_id,v_pair.target_folio_id) order by hf.id for update;
          perform li.id from public.folio_line_items li where li.transfer_pair_id=v_pair.id order by li.id for update;
          select count(*) into v_pair_leg_count from public.folio_line_items li where li.transfer_pair_id=v_pair.id and li.line_type in('transfer_in','transfer_out');
          select count(*) into v_reversal_count from public.folio_line_items li where li.reverses_line_item_id in(
            select id from public.folio_line_items where transfer_pair_id=v_pair.id and line_type in('transfer_in','transfer_out'));
          if v_pair_leg_count<>2 then
            v_result:=jsonb_build_object('success',false,'error','Transfer pair is incomplete; reconcile before correction.');
          elsif v_reversal_count not in (0,2) then
            v_result:=jsonb_build_object('success',false,'error','A prior transfer correction is incomplete; reconcile before correction.');
          elsif v_reversal_count=2 then
            select jsonb_agg(to_jsonb(r) order by r.created_at) into v_reversals from public.folio_line_items r
              where r.reverses_line_item_id in(select id from public.folio_line_items where transfer_pair_id=v_pair.id);
            v_result:=jsonb_build_object('success',true,'already_reversed',true,'reversals',coalesce(v_reversals,'[]'::jsonb));
          else
            select count(*) into v_original_count from public.folio_line_items li join public.hotel_folios hf on hf.id=li.folio_id
              where li.transfer_pair_id=v_pair.id and hf.status='open';
            if v_original_count<>2 then
              v_result:=jsonb_build_object('success',false,'error','Both transfer folios must be open to correct this pair.');
            else
              select * into v_source from public.hotel_folios where id=v_pair.source_folio_id and lodge_id=p_lodge_id;
              select * into v_target from public.hotel_folios where id=v_pair.target_folio_id and lodge_id=p_lodge_id;
              select * into v_leg from public.folio_line_items where transfer_pair_id=v_pair.id and line_type='transfer_out';
              select * into v_line from public.folio_line_items where transfer_pair_id=v_pair.id and line_type='transfer_in';
              v_before:=jsonb_build_object('source',to_jsonb(v_source),'target',to_jsonb(v_target));
              insert into public.folio_line_items(folio_id,lodge_id,amount,line_type,description,created_by,audit_before,transfer_pair_id,reverses_line_item_id)
                values(v_leg.folio_id,p_lodge_id,v_leg.amount,'void',coalesce(nullif(p_payload->>'reason',''),'Voided')||' — transfer reversal',v_actor,to_jsonb(v_leg),v_pair.id,v_leg.id)
                returning * into v_reversal;
              v_reversals:=jsonb_build_array(to_jsonb(v_reversal));
              insert into public.folio_line_items(folio_id,lodge_id,amount,line_type,description,created_by,audit_before,transfer_pair_id,reverses_line_item_id)
                values(v_line.folio_id,p_lodge_id,v_line.amount,'void',coalesce(nullif(p_payload->>'reason',''),'Voided')||' — transfer reversal',v_actor,to_jsonb(v_line),v_pair.id,v_line.id)
                returning * into v_reversal;
              v_reversals:=v_reversals||jsonb_build_array(to_jsonb(v_reversal));
              update public.hotel_folios set balance=balance+v_leg.amount,updated_at=now() where id=v_leg.folio_id returning * into v_source;
              update public.hotel_folios set balance=balance-v_line.amount,updated_at=now() where id=v_line.folio_id returning * into v_target;
              update public.folio_line_items set audit_after=to_jsonb(v_source) where reverses_line_item_id=v_leg.id;
              update public.folio_line_items set audit_after=to_jsonb(v_target) where reverses_line_item_id=v_line.id;
              select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb) into v_reversals from public.folio_line_items r where r.reverses_line_item_id in (select id from public.folio_line_items where transfer_pair_id=v_pair.id and line_type in ('transfer_in','transfer_out'));
              v_result:=jsonb_build_object('success',true,'reversals',v_reversals);
              v_after:=jsonb_build_object('source',to_jsonb(v_source),'target',to_jsonb(v_target));
            end if;
          end if;
        end if;
      else
        select * into v_source from public.hotel_folios where id=v_line.folio_id and lodge_id=p_lodge_id for update;
        select * into v_line from public.folio_line_items where id=v_line.id for update;
        if v_source.status<>'open' then
          v_result:=jsonb_build_object('success',false,'error','Only an open folio can be corrected.');
        else
          select count(*) into v_reversal_count
            from public.folio_line_items r
           where r.lodge_id=p_lodge_id and r.line_type='void'
             and (r.reverses_line_item_id=v_line.id
               or (r.reverses_line_item_id is null and r.audit_before->>'id'=v_line.id::text));
          if v_reversal_count>1 then
            v_result:=jsonb_build_object('success',false,'manual_review_required',true,
              'error','This line has ambiguous historical corrections. Review the folio integrity report before making another correction.');
          elsif v_reversal_count=1 then
            select r.* into v_reversal
              from public.folio_line_items r
             where r.lodge_id=p_lodge_id and r.line_type='void'
               and (r.reverses_line_item_id=v_line.id
                 or (r.reverses_line_item_id is null and r.audit_before->>'id'=v_line.id::text))
             order by r.created_at,r.id limit 1;
            v_result:=jsonb_build_object('success',true,'already_reversed',true,'reversal',to_jsonb(v_reversal));
          else
            v_before:=to_jsonb(v_source);
            insert into public.folio_line_items(folio_id,lodge_id,amount,line_type,description,created_by,audit_before,reverses_line_item_id)
              values(v_line.folio_id,p_lodge_id,v_line.amount,'void',coalesce(nullif(p_payload->>'reason',''),'Voided')||' — original: '||v_line.description,
                v_actor,to_jsonb(v_line),v_line.id) returning * into v_reversal;
            if v_line.line_type='charge' then
              update public.hotel_folios set balance=balance-v_line.amount,updated_at=now() where id=v_line.folio_id returning * into v_source;
            else
              update public.hotel_folios set balance=balance+v_line.amount,updated_at=now() where id=v_line.folio_id returning * into v_source;
            end if;
            update public.folio_line_items set audit_after=to_jsonb(v_source) where id=v_reversal.id;
            select * into v_reversal from public.folio_line_items where id=v_reversal.id;
            v_result:=jsonb_build_object('success',true,'reversal',to_jsonb(v_reversal));
            v_after:=to_jsonb(v_source);
          end if;
        end if;
      end if;
    end if;
  else
    v_entity:=nullif(p_payload->>'folio_id','')::uuid;
    select * into v_source from public.hotel_folios where id=v_entity and lodge_id=p_lodge_id for update;
    if not found then
      v_result:=jsonb_build_object('success',false,'error','Folio not found in this lodge.');
    else
      v_before:=to_jsonb(v_source);
      v_status:=case when p_operation_kind='close' then 'closed' when p_operation_kind='reopen' then 'open' else 'locked' end;
      if (p_operation_kind='close' and v_source.status<>'open')
        or (p_operation_kind='reopen' and v_source.status<>'closed')
        or (p_operation_kind='lock' and v_source.status not in ('open','closed')) then
        v_result:=jsonb_build_object('success',false,'error','Folio is '||v_source.status||'; requested status transition is not allowed.');
      else
        update public.hotel_folios set status=v_status,updated_at=now() where id=v_entity and lodge_id=p_lodge_id returning * into v_source;
        v_result:=jsonb_build_object('success',true,'result',jsonb_build_object('folio',to_jsonb(v_source)));
        v_after:=to_jsonb(v_source);
      end if;
    end if;
  end if;

  if coalesce((v_result->>'success')::boolean,false) then
    insert into public.hotel_folio_mutation_audit(lodge_id,operation_key,operation_kind,actor_id,entity_id,request_hash,before_state,after_state)
    values(p_lodge_id,v_key,p_operation_kind,v_actor,v_entity,v_hash,v_before,coalesce(v_after,v_result));
  end if;
  return public._hotel_folio_finish_v1(p_lodge_id,v_key,p_operation_kind,v_entity,v_hash,p_payload,v_result);
end;
$$;

-- Preserve the existing read contract while exposing authoritative correction state.
create or replace function public.get_folio_line_items(p_lodge_id uuid,p_folio_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_result jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['receptionist','cashier','supervisor','manager','admin','super_admin','finance']);
  if not exists(select 1 from public.hotel_folios hf where hf.id=p_folio_id and hf.lodge_id=p_lodge_id) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(
    to_jsonb(li) || jsonb_build_object(
      'is_reversed',rev.id is not null,
      'reversal',case when rev.id is null then null else to_jsonb(rev) end,
      'transfer_pair',case when tp.id is null then null else to_jsonb(tp) || jsonb_build_object(
        'reversal_count',pair_state.reversal_count,
        'status',case when pair_state.leg_count<>2 then 'incomplete'
          when pair_state.reversal_count=0 then 'active'
          when pair_state.reversal_count=2 then 'reversed' else 'correction_incomplete' end
      ) end
    ) order by li.created_at desc,li.id desc
  ),'[]'::jsonb) into v_result
  from public.folio_line_items li
  left join lateral (
    select r.* from public.folio_line_items r
     where r.lodge_id=p_lodge_id and r.line_type='void'
       and (r.reverses_line_item_id=li.id
         or (r.reverses_line_item_id is null and r.audit_before->>'id'=li.id::text))
     order by r.created_at,r.id limit 1
  ) rev on true
  left join public.hotel_folio_transfer_pairs tp on tp.id=li.transfer_pair_id and tp.lodge_id=p_lodge_id
  left join lateral (
    select count(*) filter(where original.line_type in('transfer_in','transfer_out'))::integer as leg_count,
      count(r.id)::integer as reversal_count
    from public.folio_line_items original
    left join public.folio_line_items r on r.reverses_line_item_id=original.id and r.lodge_id=p_lodge_id
    where original.transfer_pair_id=tp.id and original.lodge_id=p_lodge_id
  ) pair_state on tp.id is not null
  where li.folio_id=p_folio_id and li.lodge_id=p_lodge_id;
  return v_result;
end;
$$;

revoke all on function public.get_folio_line_items(uuid,uuid) from public,anon;
grant execute on function public.get_folio_line_items(uuid,uuid) to anon,authenticated,service_role;
-- Read-only history diagnosis. Historic transfers are listed unpaired; no
-- amount/time heuristics create links or alter balances.
create or replace function public.get_hotel_folio_integrity_diagnostics(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_result jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin','finance']);
  with
  folio_calc as materialized (
    select hf.id as folio_id,hf.balance as stored_balance,
      coalesce(sum(case
        when li.line_type in('charge','transfer_in') then li.amount
        when li.line_type in('payment','transfer_out') then -li.amount
        when li.line_type='void' and li.audit_before->>'line_type' in('charge','transfer_in') then -li.amount
        when li.line_type='void' and li.audit_before->>'line_type' in('payment','transfer_out') then li.amount
        else 0 end),0) as ledger_balance,
      count(*) filter(where li.line_type='adjustment'
        or (li.line_type='void' and coalesce(li.audit_before->>'line_type','') not in ('charge','payment','transfer_in','transfer_out')))::integer as unclassified_line_count
    from public.hotel_folios hf
    left join public.folio_line_items li on li.folio_id=hf.id and li.lodge_id=p_lodge_id
    where hf.lodge_id=p_lodge_id group by hf.id,hf.balance
  ),
  legacy_dups as materialized (
    select li.audit_before->>'id' as original_id,count(*)::integer as reversal_count,
      jsonb_agg(li.id order by li.created_at,li.id) as reversal_ids
    from public.folio_line_items li
    where li.lodge_id=p_lodge_id and li.line_type='void'
      and li.reverses_line_item_id is null and li.audit_before ? 'id'
    group by li.audit_before->>'id' having count(*)>1
  ),
  unlinked as materialized (
    select li.id,li.folio_id,li.line_type,li.amount,li.created_at
    from public.folio_line_items li where li.lodge_id=p_lodge_id
      and li.line_type in('transfer_in','transfer_out') and li.transfer_pair_id is null
  ),
  pair_health as materialized (
    select tp.id,tp.source_folio_id,tp.target_folio_id,
      count(li.id) filter(where li.line_type in('transfer_in','transfer_out'))::integer as leg_count,
      count(li.id) filter(where li.line_type='transfer_out')::integer as out_count,
      count(li.id) filter(where li.line_type='transfer_in')::integer as in_count,
      max(li.folio_id) filter(where li.line_type='transfer_out') as out_folio_id,
      max(li.folio_id) filter(where li.line_type='transfer_in') as in_folio_id,
      count(distinct li.amount) filter(where li.line_type in('transfer_in','transfer_out'))::integer as amount_count,
      count(r.id)::integer as reversal_count
    from public.hotel_folio_transfer_pairs tp
    left join public.folio_line_items li on li.transfer_pair_id=tp.id and li.lodge_id=p_lodge_id
    left join public.folio_line_items r on r.reverses_line_item_id=li.id and r.lodge_id=p_lodge_id
    where tp.lodge_id=p_lodge_id
    group by tp.id,tp.source_folio_id,tp.target_folio_id
  ),
  cross_lodge as materialized (
    select li.id as line_item_id,li.lodge_id as line_lodge_id,li.folio_id,hf.lodge_id as folio_lodge_id
    from public.folio_line_items li join public.hotel_folios hf on hf.id=li.folio_id
    where li.lodge_id=p_lodge_id and li.lodge_id is distinct from hf.lodge_id
  ),
  counts as (
    select
      (select count(*)::integer from unlinked) as unlinked_count,
      coalesce((select sum(reversal_count-1)::integer from legacy_dups),0) as duplicate_legacy_count,
      (select count(*)::integer from folio_calc where round(stored_balance,2)<>round(ledger_balance,2) and unclassified_line_count=0) as balance_diff_count,
      (select count(*)::integer from folio_calc where unclassified_line_count>0) as uncheckable_balance_count,
      (select count(*)::integer from folio_calc where unclassified_line_count>0) as unclassified_adjustment_count,
      (select count(*)::integer from pair_health where leg_count<>2 or out_count<>1 or in_count<>1 or out_folio_id is distinct from source_folio_id or in_folio_id is distinct from target_folio_id or amount_count<>1) as incomplete_pair_count,
      (select count(*)::integer from pair_health where reversal_count not in(0,2)) as incomplete_pair_reversal_count,
      (select count(*)::integer from cross_lodge) as cross_lodge_line_count
  )
  select jsonb_build_object(
    'schema_version',1,'complete',true,'certifiable',
      (c.unlinked_count+c.duplicate_legacy_count+c.balance_diff_count+c.uncheckable_balance_count+c.incomplete_pair_count+c.incomplete_pair_reversal_count+c.cross_lodge_line_count)=0,
    'lodge_id',p_lodge_id,'generated_at',clock_timestamp(),
    'unlinked_historic_transfer_count',c.unlinked_count,
    'duplicate_legacy_reversal_count',c.duplicate_legacy_count,
    'balance_difference_count',c.balance_diff_count,
    'uncheckable_balance_folio_count',c.uncheckable_balance_count,
    'unclassified_adjustment_count',c.unclassified_adjustment_count,
    'unclassified_line_count',c.unclassified_adjustment_count,
    'incomplete_transfer_pair_count',c.incomplete_pair_count,
    'incomplete_transfer_reversal_count',c.incomplete_pair_reversal_count,
    'cross_lodge_line_count',c.cross_lodge_line_count,
    'sample_limit',50,
    'samples',jsonb_build_object(
      'unlinked_transfers',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from unlinked order by created_at,id limit 50) x),'[]'::jsonb),
      'duplicate_legacy_reversals',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from legacy_dups order by original_id limit 50) x),'[]'::jsonb),
      'balance_differences',coalesce((select jsonb_agg(jsonb_build_object('folio_id',folio_id,'stored_balance',stored_balance,'ledger_balance',ledger_balance) order by folio_id) from (select * from folio_calc where round(stored_balance,2)<>round(ledger_balance,2) and unclassified_line_count=0 order by folio_id limit 50) x),'[]'::jsonb),
      'uncheckable_balances',coalesce((select jsonb_agg(jsonb_build_object('folio_id',folio_id,'stored_balance',stored_balance,'unclassified_line_count',unclassified_line_count) order by folio_id) from (select * from folio_calc where unclassified_line_count>0 order by folio_id limit 50) x),'[]'::jsonb),
      'incomplete_transfer_pairs',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pair_health where leg_count<>2 or out_count<>1 or in_count<>1 or out_folio_id is distinct from source_folio_id or in_folio_id is distinct from target_folio_id or amount_count<>1 order by id limit 50) x),'[]'::jsonb),
      'incomplete_transfer_reversals',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pair_health where reversal_count not in(0,2) order by id limit 50) x),'[]'::jsonb),
      'cross_lodge_lines',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from cross_lodge order by line_item_id limit 50) x),'[]'::jsonb)
    ),
    'samples_truncated',jsonb_build_object(
      'unlinked_transfers',c.unlinked_count>50,
      'duplicate_legacy_reversals',(select count(*) from legacy_dups)>50,
      'balance_differences',c.balance_diff_count>50,
      'uncheckable_balances',c.uncheckable_balance_count>50,
      'incomplete_transfer_pairs',c.incomplete_pair_count>50,
      'incomplete_transfer_reversals',c.incomplete_pair_reversal_count>50,
      'cross_lodge_lines',c.cross_lodge_line_count>50
    )
  ) into v_result from counts c;
  return v_result;
end;
$$;

-- Legacy mutations remain available only to server-owned definer callers during
-- cutover; authenticated clients must upgrade to the keyed v1 contract.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in(
      'create_hotel_folio','add_folio_charge','add_folio_payment','transfer_folio_charge',
      'split_folio','void_folio_line','close_folio','reopen_folio','lock_folio'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;

revoke all on function public._hotel_folio_finish_v1(uuid,text,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public._hotel_folio_apply_transfer_v1(uuid,uuid,uuid,numeric,text,uuid,text) from public,anon,authenticated;
revoke all on function public.hotel_folio_mutation_v1(uuid,text,text,jsonb) from public,anon;
grant execute on function public.hotel_folio_mutation_v1(uuid,text,text,jsonb) to anon,authenticated,service_role;
revoke all on function public.get_hotel_folio_integrity_diagnostics(uuid) from public,anon;
grant execute on function public.get_hotel_folio_integrity_diagnostics(uuid) to anon,authenticated,service_role;

commit;