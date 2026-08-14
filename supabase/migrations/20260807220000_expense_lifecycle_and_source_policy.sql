begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.restaurant_pos_gl_mappings'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%mapping_type%' loop
    execute format('alter table public.restaurant_pos_gl_mappings drop constraint %I',c.conname);
  end loop;
end
$$;
alter table public.restaurant_pos_gl_mappings add constraint restaurant_pos_gl_mappings_mapping_type_v3_chk
  check (mapping_type in ('category','tender','discount','tax','tips','cogs','inventory','settlement_fee','settlement_clearing','expense_category','expense_payable'));

-- Expenses are source documents, not an immediately-posted shadow ledger.
-- Every lifecycle transition is server-authoritative, retry-safe, and auditable.
alter table public.expenses
  add column if not exists source_kind text not null default 'direct',
  add column if not exists source_document_type text,
  add column if not exists source_document_id uuid,
  add column if not exists supplier_id uuid,
  add column if not exists payee_name text,
  add column if not exists payment_method text,
  add column if not exists payment_account_id uuid,
  add column if not exists expense_account_id uuid,
  add column if not exists tax_code text,
  add column if not exists tax_amount numeric(18,2) not null default 0,
  add column if not exists reference_number text,
  add column if not exists duplicate_fingerprint text,
  add column if not exists submitted_by uuid references public.users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists posted_by uuid references public.users(id),
  add column if not exists posted_at timestamptz,
  add column if not exists paid_by uuid references public.users(id),
  add column if not exists paid_at timestamptz,
  add column if not exists payment_journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  add column if not exists reversed_by uuid references public.users(id),
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict;

alter table public.expenses drop constraint if exists expenses_status_chk;
alter table public.expenses drop constraint if exists expenses_source_kind_chk;
alter table public.expenses add constraint expenses_status_chk
  check (status in ('draft','submitted','approved','unposted','posted','paid','voided','reversed','exception'));
alter table public.expenses add constraint expenses_source_kind_chk
  check (source_kind in ('direct','ap_bill','other'));
alter table public.expenses add constraint expenses_amount_tax_chk
  check (amount > 0 and tax_amount >= 0 and tax_amount <= amount);

create index if not exists expenses_lifecycle_idx
  on public.expenses(lodge_id,status,date,id);
create index if not exists expenses_duplicate_fingerprint_idx
  on public.expenses(lodge_id,duplicate_fingerprint,date)
  where duplicate_fingerprint is not null;

create table if not exists public.restaurant_expense_operations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  operation_id uuid not null,
  action text not null check (action in ('submit','approve','post','pay','void','reverse')),
  payload_hash text not null,
  result jsonb not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique(lodge_id,operation_id)
);
alter table public.restaurant_expense_operations enable row level security;
revoke all on table public.restaurant_expense_operations from public,anon,authenticated;

create or replace function public.set_restaurant_expense_gl_mapping(
  p_lodge_id uuid,
  p_mapping_type text,
  p_source_key text,
  p_account_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid;
  v_id uuid;
  v_type text:=lower(btrim(coalesce(p_mapping_type,'')));
  v_key text:=lower(btrim(coalesce(p_source_key,'')));
  v_account_type text;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if v_type not in ('expense_category','expense_payable') or v_key='' then
    raise exception 'Expense mapping type and source key are required' using errcode='22023';
  end if;
  select account_type into v_account_type
  from public.restaurant_accounts
  where id=p_account_id and lodge_id=p_lodge_id and is_active;
  if not found then raise exception 'Mapped expense account is inactive, missing, or foreign' using errcode='23503'; end if;
  if v_type='expense_category' and v_account_type<>'expense' then
    raise exception 'Expense category mappings require expense accounts' using errcode='22023';
  end if;
  if v_type='expense_payable' and v_account_type<>'liability' then
    raise exception 'Expense payable mappings require liability accounts' using errcode='22023';
  end if;
  insert into public.restaurant_pos_gl_mappings(lodge_id,mapping_type,source_key,account_id,created_by,effective_from,effective_to,mapping_version)
  values(p_lodge_id,v_type,v_key,p_account_id,v_actor,current_date,null,'bar-accounting-financial-truth-v1')
  on conflict(lodge_id,mapping_type,source_key) do update
    set account_id=excluded.account_id,updated_at=now(),effective_from=excluded.effective_from,effective_to=null,mapping_version=excluded.mapping_version
  returning id into v_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'expense_gl_mapping_set','pos_gl_mapping',v_id,null,
    jsonb_build_object('mapping_type',v_type,'source_key',v_key,'account_id',p_account_id),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'mapping_type',v_type,'source_key',v_key));
end
$$;

create or replace function public.create_expense(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_id uuid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  v_lodge uuid:=(payload->>'lodge_id')::uuid;
  v_amount numeric:=round(coalesce((payload->>'amount')::numeric,0),2);
  v_actor uuid:=public.app_get_actor_user_id();
  v_operation uuid:=coalesce(nullif(payload->>'operation_id','')::uuid,v_id);
  v_hash text:=encode(digest(payload::text,'sha256'),'hex');
  v_existing_hash text;
  v_fingerprint text:=coalesce(nullif(btrim(payload->>'duplicate_fingerprint'),''),
    encode(digest(lower(concat_ws('|',payload->>'date',v_amount::text,payload->>'supplier_id',payload->>'reference_number',payload->>'description')),'sha256'),'hex'));
  v_source_kind text:=lower(coalesce(nullif(btrim(payload->>'source_kind'),''),'direct'));
begin
  perform public.app_require_lodge_role(v_lodge,array['finance','manager','admin','super_admin']);
  if v_amount<=0 or v_amount>999999.99 then raise exception 'Expense amount must be between P0.01 and P999,999.99' using errcode='22023'; end if;
  if v_source_kind not in ('direct','ap_bill','other') then raise exception 'Expense source_kind is invalid' using errcode='22023'; end if;
  if nullif(btrim(payload->>'date'),'') is null or nullif(btrim(payload->>'description'),'') is null then raise exception 'Expense date and description are required' using errcode='22023'; end if;
  select payload_hash into v_existing_hash from public.expenses where id=v_id and lodge_id=v_lodge for update;
  if v_existing_hash is not null then
    if v_existing_hash<>v_hash then raise exception 'Expense retry payload does not match the original operation' using errcode='22000'; end if;
    return jsonb_build_object('success',true,'id',v_id,'idempotent',true,'status',(select status from public.expenses where id=v_id));
  end if;
  if exists(select 1 from public.expenses where lodge_id=v_lodge and operation_id=v_operation and id<>v_id) then raise exception 'Expense operation key is already bound to another expense' using errcode='23505'; end if;
  if exists(select 1 from public.expenses where lodge_id=v_lodge and duplicate_fingerprint=v_fingerprint and status not in ('voided','reversed')) then
    raise exception 'Potential duplicate expense: the same date, amount, supplier, reference, and description already exist' using errcode='23505';
  end if;
  insert into public.expenses(
    id,lodge_id,date,category,description,amount,notes,outlet_id,status,source_version,operation_id,payload_hash,evidence_ref,
    source_kind,source_document_type,source_document_id,supplier_id,payee_name,payment_method,payment_account_id,expense_account_id,
    tax_code,tax_amount,reference_number,duplicate_fingerprint
  ) values(
    v_id,v_lodge,(payload->>'date')::date,nullif(payload->>'category',''),nullif(payload->>'description',''),v_amount,
    nullif(payload->>'notes',''),nullif(payload->>'outlet_id','')::uuid,'draft',1,v_operation,v_hash,nullif(payload->>'evidence_ref',''),
    v_source_kind,nullif(payload->>'source_document_type',''),nullif(payload->>'source_document_id','')::uuid,
    nullif(payload->>'supplier_id','')::uuid,nullif(payload->>'payee_name',''),nullif(payload->>'payment_method',''),
    nullif(payload->>'payment_account_id','')::uuid,nullif(payload->>'expense_account_id','')::uuid,nullif(payload->>'tax_code',''),
    round(coalesce((payload->>'tax_amount')::numeric,0),2),nullif(payload->>'reference_number',''),v_fingerprint
  );
  perform public.log_restaurant_financial_action(v_lodge,'expense.created','expense',v_id,null,payload,jsonb_build_object('status','draft','actor_id',v_actor));
  return jsonb_build_object('success',true,'id',v_id,'posted',false,'status','draft');
end
$$;

create or replace function public.update_expense(p_id uuid,p_lodge_id uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_actor uuid:=public.app_get_actor_user_id();
begin
  perform public.app_require_lodge_role(p_lodge_id,array['finance','manager','admin','super_admin']);
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Expense not found'); end if;
  if v_exp.status not in ('draft','unposted') then raise exception 'Only draft expenses can be edited; use the controlled lifecycle for submitted or posted records' using errcode='55000'; end if;
  if payload ? 'amount' and (round((payload->>'amount')::numeric,2)<=0 or round((payload->>'amount')::numeric,2)>999999.99) then raise exception 'Expense amount is invalid' using errcode='22023'; end if;
  update public.expenses set
    date=case when payload ? 'date' then (payload->>'date')::date else date end,
    category=case when payload ? 'category' then nullif(payload->>'category','') else category end,
    description=case when payload ? 'description' then nullif(payload->>'description','') else description end,
    amount=case when payload ? 'amount' then round((payload->>'amount')::numeric,2) else amount end,
    notes=case when payload ? 'notes' then nullif(payload->>'notes','') else notes end,
    outlet_id=case when payload ? 'outlet_id' then nullif(payload->>'outlet_id','')::uuid else outlet_id end,
    evidence_ref=case when payload ? 'evidence_ref' then nullif(payload->>'evidence_ref','') else evidence_ref end,
    source_kind=case when payload ? 'source_kind' then coalesce(nullif(payload->>'source_kind',''),'direct') else source_kind end,
    source_document_type=case when payload ? 'source_document_type' then nullif(payload->>'source_document_type','') else source_document_type end,
    source_document_id=case when payload ? 'source_document_id' then nullif(payload->>'source_document_id','')::uuid else source_document_id end,
    supplier_id=case when payload ? 'supplier_id' then nullif(payload->>'supplier_id','')::uuid else supplier_id end,
    payee_name=case when payload ? 'payee_name' then nullif(payload->>'payee_name','') else payee_name end,
    payment_method=case when payload ? 'payment_method' then nullif(payload->>'payment_method','') else payment_method end,
    payment_account_id=case when payload ? 'payment_account_id' then nullif(payload->>'payment_account_id','')::uuid else payment_account_id end,
    expense_account_id=case when payload ? 'expense_account_id' then nullif(payload->>'expense_account_id','')::uuid else expense_account_id end,
    tax_code=case when payload ? 'tax_code' then nullif(payload->>'tax_code','') else tax_code end,
    tax_amount=case when payload ? 'tax_amount' then round(coalesce((payload->>'tax_amount')::numeric,0),2) else tax_amount end,
    reference_number=case when payload ? 'reference_number' then nullif(payload->>'reference_number','') else reference_number end,
    updated_at=now()
  where id=p_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'id',p_id,'updated_by',v_actor,'status',(select status from public.expenses where id=p_id));
end
$$;

create or replace function public._restaurant_expense_transition_operation(
  p_lodge_id uuid,p_expense_id uuid,p_operation_id uuid,p_action text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing public.restaurant_expense_operations%rowtype; v_hash text;
begin
  if p_operation_id is null then raise exception 'Expense lifecycle operation_id is required' using errcode='22023'; end if;
  v_hash:=encode(digest(jsonb_build_object('expense_id',p_expense_id,'action',p_action,'payload',coalesce(p_payload,'{}'::jsonb))::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text||':'||p_operation_id::text,0));
  select * into v_existing from public.restaurant_expense_operations where lodge_id=p_lodge_id and operation_id=p_operation_id for update;
  if found then
    if v_existing.payload_hash<>v_hash or v_existing.expense_id<>p_expense_id or v_existing.action<>p_action then raise exception 'Expense lifecycle operation key conflicts with a different request' using errcode='22000'; end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;
  return jsonb_build_object('payload_hash',v_hash);
end
$$;

create or replace function public._restaurant_record_expense_operation(
  p_lodge_id uuid,p_expense_id uuid,p_operation_id uuid,p_action text,p_hash text,p_result jsonb
)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.restaurant_expense_operations(lodge_id,expense_id,operation_id,action,payload_hash,result,created_by)
  values(p_lodge_id,p_expense_id,p_operation_id,p_action,p_hash,p_result,public.app_current_user_id());
end
$$;

create or replace function public.submit_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'expenses.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'submit',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status not in ('draft','unposted') then raise exception 'Only draft expenses can be submitted' using errcode='55000'; end if;
  if v_exp.source_kind='ap_bill' and (v_exp.source_document_id is null or not exists(select 1 from public.restaurant_bills b where b.id=v_exp.source_document_id and b.lodge_id=p_lodge_id)) then raise exception 'AP-linked expenses require an existing AP bill source document' using errcode='23503'; end if;
  if v_exp.source_kind='direct' and nullif(btrim(v_exp.evidence_ref),'') is null then raise exception 'Direct expenses require a receipt or evidence reference before submission' using errcode='22023'; end if;
  if exists(select 1 from public.expenses d where d.lodge_id=p_lodge_id and d.id<>p_id and d.duplicate_fingerprint=v_exp.duplicate_fingerprint and d.status not in('voided','reversed')) then raise exception 'Potential duplicate expense is already recorded' using errcode='23505'; end if;
  update public.expenses set status='submitted',submitted_by=v_actor,submitted_at=now(),updated_at=now() where id=p_id;
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','submitted');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'submit',v_hash,v_result);
  perform public.log_restaurant_financial_action(p_lodge_id,'expense.submitted','expense',p_id,null,null,jsonb_build_object('operation_id',p_operation_id,'actor_id',v_actor));
  return v_result;
end
$$;

create or replace function public.approve_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'approve',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status<>'submitted' then raise exception 'Only submitted expenses can be approved' using errcode='55000'; end if;
  if v_exp.submitted_by is not null and v_exp.submitted_by=v_actor then raise exception 'A different authorized user must approve the expense' using errcode='42501'; end if;
  update public.expenses set status='approved',approved_by=v_actor,approved_at=now(),updated_at=now() where id=p_id;
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','approved');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'approve',v_hash,v_result);
  perform public.log_restaurant_financial_action(p_lodge_id,'expense.approved','expense',p_id,null,null,jsonb_build_object('operation_id',p_operation_id,'actor_id',v_actor));
  return v_result;
end
$$;

create or replace function public.post_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid; v_expense_account uuid; v_payable_account uuid; v_journal jsonb; v_business_date date;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'post',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status='posted' or v_exp.status='paid' then return jsonb_build_object('success',true,'id',p_id,'status',v_exp.status,'replayed',true); end if;
  if v_exp.status<>'approved' then raise exception 'Only approved expenses can be posted' using errcode='55000'; end if;
  if v_exp.source_kind='ap_bill' then raise exception 'AP-linked expenses must be posted through the AP bill workflow; direct expense posting would duplicate the liability' using errcode='55000'; end if;
  v_business_date:=v_exp.date;
  select m.account_id into v_expense_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='expense_category' and m.source_key=lower(coalesce(v_exp.category,'other')) and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by m.effective_from desc limit 1;
  v_expense_account:=coalesce(v_expense_account,v_exp.expense_account_id);
  if v_expense_account is null or not exists(select 1 from public.restaurant_accounts where id=v_expense_account and lodge_id=p_lodge_id and is_active and account_type='expense') then raise exception 'No effective expense-category mapping is configured for %' ,coalesce(v_exp.category,'other') using errcode='23503'; end if;
  select m.account_id into v_payable_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='expense_payable' and m.source_key='default' and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by m.effective_from desc limit 1;
  if v_payable_account is null then raise exception 'Default expense-payable liability mapping is not configured' using errcode='23503'; end if;
  v_journal:=public._restaurant_post_journal(p_lodge_id,v_business_date,'Expense accrual: '||coalesce(v_exp.description,'expense'),'expense',p_id,v_exp.reference_number,'expense-post:'||p_id::text,jsonb_build_array(jsonb_build_object('account_id',v_expense_account,'debit',v_exp.amount,'credit',0,'memo',coalesce(v_exp.category,'expense')),jsonb_build_object('account_id',v_payable_account,'debit',0,'credit',v_exp.amount,'memo','Expense payable')),v_actor,null);
  update public.expenses set status='posted',journal_entry_id=(v_journal->'data'->>'entry_id')::uuid,posted_by=v_actor,posted_at=now(),updated_at=now() where id=p_id;
  perform public.record_restaurant_source_posting(p_lodge_id,'expense',p_id,v_business_date,(v_journal->'data'->>'entry_id')::uuid,p_operation_id,v_hash,1,v_exp.outlet_id,'posted');
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','posted','journal_entry_id',v_journal->'data'->>'entry_id');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'post',v_hash,v_result);
  return v_result;
end
$$;

create or replace function public.pay_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid; v_payment_account uuid; v_journal jsonb; v_method text; v_business_date date;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'pay',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status='paid' then return jsonb_build_object('success',true,'id',p_id,'status','paid','replayed',true); end if;
  if v_exp.status<>'posted' then raise exception 'Only posted expenses can be paid' using errcode='55000'; end if;
  if v_exp.source_kind='ap_bill' then raise exception 'AP-linked expenses must be paid through the AP payment workflow' using errcode='55000'; end if;
  v_method:=lower(coalesce(nullif(btrim(p_payload->>'payment_method'),''),nullif(btrim(v_exp.payment_method),''),'cash'));
  select m.account_id into v_payment_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key=v_method and m.effective_from<=v_exp.date and (m.effective_to is null or m.effective_to>=v_exp.date) order by m.effective_from desc limit 1;
  v_payment_account:=coalesce(nullif(p_payload->>'payment_account_id','')::uuid,v_exp.payment_account_id,v_payment_account);
  if v_payment_account is null or not exists(select 1 from public.restaurant_accounts where id=v_payment_account and lodge_id=p_lodge_id and is_active and account_type='asset') then raise exception 'No effective payment account is configured for %' ,v_method using errcode='23503'; end if;
  v_business_date:=coalesce(nullif(p_payload->>'payment_date','')::date,v_exp.date);
  v_journal:=public._restaurant_post_journal(p_lodge_id,v_business_date,'Expense payment: '||coalesce(v_exp.description,'expense'),'expense_payment',p_id,v_exp.reference_number,'expense-pay:'||p_id::text,jsonb_build_array(jsonb_build_object('account_id',case when v_exp.journal_entry_id is null then v_payment_account else (select l.account_id from public.restaurant_journal_lines l where l.entry_id=v_exp.journal_entry_id and l.credit>0 limit 1) end,'debit',v_exp.amount,'credit',0,'memo','Expense payable settlement'),jsonb_build_object('account_id',v_payment_account,'debit',0,'credit',v_exp.amount,'memo','Expense payment')),v_actor,null);
  update public.expenses set status='paid',paid_by=v_actor,paid_at=now(),payment_method=v_method,payment_account_id=v_payment_account,payment_journal_entry_id=(v_journal->'data'->>'entry_id')::uuid,updated_at=now() where id=p_id;
  perform public.record_restaurant_source_posting(p_lodge_id,'expense_payment',p_id,v_business_date,(v_journal->'data'->>'entry_id')::uuid,p_operation_id,v_hash,1,v_exp.outlet_id,'posted');
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','paid','journal_entry_id',v_journal->'data'->>'entry_id');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'pay',v_hash,v_result);
  return v_result;
end
$$;

create or replace function public.void_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'expenses.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'void',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',true,'id',p_id,'status','voided','replayed',true); end if;
  if v_exp.status in ('posted','paid','reversed') then raise exception 'Posted or paid expenses require controlled reversal; they cannot be voided' using errcode='55000'; end if;
  if v_exp.status='voided' then return jsonb_build_object('success',true,'id',p_id,'status','voided','replayed',true); end if;
  update public.expenses set status='voided',voided_at=now(),updated_at=now() where id=p_id;
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','voided');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'void',v_hash,v_result);
  perform public.log_restaurant_financial_action(p_lodge_id,'expense.voided','expense',p_id,null,null,jsonb_build_object('operation_id',p_operation_id,'actor_id',v_actor));
  return v_result;
end
$$;

create or replace function public.reverse_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid; v_journal jsonb; v_payment_journal jsonb; v_reason text:=coalesce(nullif(btrim(p_payload->>'reason'),''),'Controlled expense reversal');
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'reverse',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status='reversed' then return jsonb_build_object('success',true,'id',p_id,'status','reversed','replayed',true); end if;
  if v_exp.status not in ('posted','paid') or v_exp.journal_entry_id is null then raise exception 'Only posted or paid expenses can be reversed' using errcode='55000'; end if;
  select public._restaurant_post_journal(p_lodge_id,v_exp.date,v_reason,'expense_reversal',p_id,v_exp.reference_number,'expense-reverse:'||p_id::text,
    coalesce((select jsonb_agg(jsonb_build_object('account_id',l.account_id,'debit',l.credit,'credit',l.debit,'memo','Expense reversal') order by l.id) from public.restaurant_journal_lines l where l.entry_id=v_exp.journal_entry_id),'[]'::jsonb),v_actor,v_exp.journal_entry_id) into v_journal;
  if v_exp.payment_journal_entry_id is not null then
    select public._restaurant_post_journal(p_lodge_id,v_exp.date,v_reason,'expense_payment_reversal',p_id,v_exp.reference_number,'expense-pay-reverse:'||p_id::text,
      coalesce((select jsonb_agg(jsonb_build_object('account_id',l.account_id,'debit',l.credit,'credit',l.debit,'memo','Expense payment reversal') order by l.id) from public.restaurant_journal_lines l where l.entry_id=v_exp.payment_journal_entry_id),'[]'::jsonb),v_actor,v_exp.payment_journal_entry_id) into v_payment_journal;
  end if;
  update public.expenses set status='reversed',reversed_by=v_actor,reversed_at=now(),reversal_journal_entry_id=(v_journal->'data'->>'entry_id')::uuid,updated_at=now() where id=p_id;
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','reversed','journal_entry_id',v_journal->'data'->>'entry_id','payment_reversal_journal_entry_id',v_payment_journal->'data'->>'entry_id');
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'reverse',v_hash,v_result);
  perform public.log_restaurant_financial_action(p_lodge_id,'expense.reversed','expense',p_id,null,null,jsonb_build_object('operation_id',p_operation_id,'actor_id',v_actor,'reason',v_reason));
  return v_result;
end
$$;

create or replace function public.delete_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.void_expense(p_id,p_lodge_id,coalesce(p_operation_id,gen_random_uuid()),jsonb_build_object('compatibility_delete',true));
end
$$;

-- Keep the readiness gate honest: draft, submitted, and approved source documents
-- are unposted work, not proof that the ledger is complete.
create or replace function public.get_restaurant_accounting_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_activation record;
  v_missing jsonb:='[]'::jsonb;
  v_unposted integer:=0;
  v_open_exceptions integer:=0;
  v_active boolean:=false;
  v_has_account boolean:=false;
  v_has_voucher boolean:=false;
  v_has_discount boolean:=false;
  v_has_tax boolean:=false;
  v_has_tips boolean:=false;
  v_has_stock boolean:=false;
  v_has_settlement boolean:=false;
  v_expense_mappings jsonb:='[]'::jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select * into v_activation from public.restaurant_accounting_activation where lodge_id=p_lodge_id;
  v_active:=public.restaurant_accounting_is_active(p_lodge_id);
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='asset' and is_active) then v_missing:=v_missing||jsonb_build_array('active asset account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='liability' and is_active) then v_missing:=v_missing||jsonb_build_array('active liability account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='revenue' and is_active) then v_missing:=v_missing||jsonb_build_array('active revenue account'); end if;
  if not exists(select 1 from public.restaurant_accounts where lodge_id=p_lodge_id and account_type='expense' and is_active) then v_missing:=v_missing||jsonb_build_array('active expense account'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='cash' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('cash tender mapping'); end if;
  if not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='category' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('POS category revenue mapping'); end if;
  if exists(select 1 from public.expenses where lodge_id=p_lodge_id and status in('submitted','approved','posted','paid')) and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='expense_payable' and m.source_key='default' and m.effective_from<=current_date and (m.effective_to is null or m.effective_to>=current_date)) then v_missing:=v_missing||jsonb_build_array('default expense-payable liability mapping'); end if;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,'')) in ('account','ar') or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method','')) in ('account','ar')))) into v_has_account;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and (lower(coalesce(o.payment_method,''))='voucher' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown)='array' then o.payment_breakdown else '[]'::jsonb end) p where lower(coalesce(p->>'method',''))='voucher'))) into v_has_voucher;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.discount_total,0)>0) into v_has_discount;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tax_total,0)>0) into v_has_tax;
  select exists(select 1 from public.pos_orders o where o.lodge_id=p_lodge_id and coalesce(o.tip_total,0)>0) into v_has_tips;
  select exists(select 1 from public.inventory_movements m where m.lodge_id=p_lodge_id and m.movement_type in('recipe_sale','sale','pos_sale','receipt','adjustment','waste','transfer')) into v_has_stock;
  select exists(select 1 from public.restaurant_settlement_reconciliations s where s.lodge_id=p_lodge_id) into v_has_settlement;
  if v_has_account and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key in('account','ar')) then v_missing:=v_missing||jsonb_build_array('customer-account receivable tender mapping'); end if;
  if v_has_voucher and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tender' and m.source_key='voucher') then v_missing:=v_missing||jsonb_build_array('voucher liability tender mapping'); end if;
  if v_has_discount and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='revenue' where m.lodge_id=p_lodge_id and m.mapping_type='discount' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default discount mapping'); end if;
  if v_has_tax and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tax' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default output-tax mapping'); end if;
  if v_has_tips and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='tips' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default tips-payable mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='cogs' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default COGS mapping'); end if;
  if v_has_stock and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='inventory' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('default inventory-control mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='asset' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_clearing' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-clearing mapping'); end if;
  if v_has_settlement and not exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='settlement_fee' and m.source_key='default') then v_missing:=v_missing||jsonb_build_array('settlement-fee mapping'); end if;
  select count(*) into v_unposted from public.expenses where lodge_id=p_lodge_id and status in('draft','submitted','approved','unposted','exception');
  select count(*) into v_open_exceptions from public.restaurant_reconciliation_exceptions where lodge_id=p_lodge_id and status in('open','investigating') and severity='blocking';
  select coalesce(jsonb_agg(jsonb_build_object('category',coalesce(e.category,'other'),'mapped',exists(select 1 from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='expense_category' and m.source_key=lower(coalesce(e.category,'other'))))),'[]'::jsonb) into v_expense_mappings from (select distinct category from public.expenses where lodge_id=p_lodge_id and status in('submitted','approved','posted','paid')) e;
  return jsonb_build_object('success',true,'data',jsonb_build_object('active',v_active,'status',coalesce(v_activation.status,'draft'),'effective_from',v_activation.effective_from,'policy_version',coalesce(v_activation.policy_version,'bar-accounting-financial-truth-v1'),'configuration_version',coalesce(v_activation.configuration_version,'unconfigured'),'mapping_requirements',jsonb_build_object('account',v_has_account,'voucher',v_has_voucher,'discount',v_has_discount,'tax',v_has_tax,'tips',v_has_tips,'stock',v_has_stock,'settlement',v_has_settlement),'missing_requirements',v_missing,'unposted_expenses',v_unposted,'expense_mapping_requirements',v_expense_mappings,'blocking_exceptions',v_open_exceptions,'ready',jsonb_array_length(v_missing)=0 and v_unposted=0 and v_open_exceptions=0));
end
$$;

revoke all on function public.set_restaurant_expense_gl_mapping(uuid,text,text,uuid),public.submit_expense(uuid,uuid,uuid,jsonb),public.approve_expense(uuid,uuid,uuid,jsonb),public.post_expense(uuid,uuid,uuid,jsonb),public.pay_expense(uuid,uuid,uuid,jsonb),public.void_expense(uuid,uuid,uuid,jsonb),public.reverse_expense(uuid,uuid,uuid,jsonb),public._restaurant_expense_transition_operation(uuid,uuid,uuid,text,jsonb),public._restaurant_record_expense_operation(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_restaurant_expense_gl_mapping(uuid,text,text,uuid),public.submit_expense(uuid,uuid,uuid,jsonb),public.approve_expense(uuid,uuid,uuid,jsonb),public.post_expense(uuid,uuid,uuid,jsonb),public.pay_expense(uuid,uuid,uuid,jsonb),public.void_expense(uuid,uuid,uuid,jsonb),public.reverse_expense(uuid,uuid,uuid,jsonb) to authenticated,service_role;
grant execute on function public.delete_expense(uuid,uuid,uuid) to authenticated,service_role;

commit;
