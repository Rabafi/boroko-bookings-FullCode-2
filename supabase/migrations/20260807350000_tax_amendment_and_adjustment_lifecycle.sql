-- Complete tax working-paper amendment, adjustment, and source manifest
-- lifecycle.  Existing four-argument generation callers remain supported.

begin;

alter table public.restaurant_tax_returns
  add column if not exists amendment_sequence integer not null default 0,
  add column if not exists amendment_operation_id uuid,
  add column if not exists amendment_of uuid references public.restaurant_tax_returns(id) on delete restrict;

drop index if exists public.restaurant_tax_returns_lodge_period_uidx;
create unique index if not exists restaurant_tax_returns_lodge_period_base_uidx
  on public.restaurant_tax_returns(lodge_id, period_start, period_end)
  where amendment_of is null;
create unique index if not exists restaurant_tax_returns_lodge_period_amendment_uidx
  on public.restaurant_tax_returns(lodge_id, period_start, period_end, amendment_sequence);
create unique index if not exists restaurant_tax_returns_amendment_operation_uidx
  on public.restaurant_tax_returns(lodge_id, amendment_operation_id)
  where amendment_operation_id is not null;

create table if not exists public.restaurant_tax_adjustments (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  business_date date not null,
  adjustment_type text not null check (adjustment_type in ('debit_note','credit_note','adjustment')),
  tax_direction text not null check (tax_direction in ('output','input')),
  tax_code text,
  tax_treatment text not null default 'taxable' check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown')),
  taxable_base numeric(18,2) not null default 0 check (taxable_base >= 0),
  tax_amount numeric(18,2) not null default 0 check (tax_amount >= 0),
  gross_amount numeric(18,2) not null default 0 check (gross_amount >= 0),
  source_reference text not null,
  evidence_ref text not null,
  reason text not null,
  status text not null default 'draft' check (status in ('draft','approved','void')),
  operation_id uuid not null,
  payload_hash text not null,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  voided_by uuid references public.users(id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lodge_id, operation_id)
);
alter table public.restaurant_tax_adjustments enable row level security;
revoke all on table public.restaurant_tax_adjustments from public, anon, authenticated;
grant select on table public.restaurant_tax_adjustments to service_role;
create index if not exists restaurant_tax_adjustments_period_idx
  on public.restaurant_tax_adjustments(lodge_id, business_date, status);

create or replace function public.record_restaurant_tax_adjustment(p_lodge_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge_id uuid := coalesce(nullif(payload->>'lodge_id','')::uuid,p_lodge_id);
  v_id uuid := coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  v_operation uuid := coalesce(nullif(payload->>'operation_id','')::uuid,v_id);
  v_date date := nullif(payload->>'business_date','')::date;
  v_type text := lower(btrim(coalesce(payload->>'adjustment_type','')));
  v_direction text := lower(btrim(coalesce(payload->>'tax_direction','')));
  v_treatment text := lower(btrim(coalesce(payload->>'tax_treatment','taxable')));
  v_base numeric := round(coalesce(nullif(payload->>'taxable_base','')::numeric,0),2);
  v_tax numeric := round(coalesce(nullif(payload->>'tax_amount','')::numeric,0),2);
  v_gross numeric := round(coalesce(nullif(payload->>'gross_amount','')::numeric,v_base+v_tax),2);
  v_reference text := nullif(btrim(payload->>'source_reference'),'');
  v_evidence text := nullif(btrim(payload->>'evidence_ref'),'');
  v_reason text := nullif(btrim(payload->>'reason'),'');
  v_actor uuid;
  v_hash text;
  v_existing public.restaurant_tax_adjustments%rowtype;
begin
  if v_lodge_id is distinct from p_lodge_id then
    raise exception 'Tax adjustment lodge scope does not match the authenticated lodge' using errcode='42501';
  end if;
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if v_lodge_id is null or v_date is null or v_type not in ('debit_note','credit_note','adjustment')
     or v_direction not in ('output','input') or v_treatment not in ('taxable','zero_rated','exempt','out_of_scope','unknown')
     or v_base < 0 or v_tax < 0 or v_gross < 0 or v_reference is null or v_evidence is null or v_reason is null then
    raise exception 'Tax adjustment date, direction, amounts, reason, reference, and evidence are required' using errcode='22023';
  end if;
  if v_treatment <> 'taxable' and v_tax <> 0 then
    raise exception 'Non-taxable tax adjustments cannot carry tax' using errcode='22023';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'id',v_id,'lodge_id',v_lodge_id,'business_date',v_date,'adjustment_type',v_type,
    'tax_direction',v_direction,'tax_code',nullif(payload->>'tax_code',''),
    'tax_treatment',v_treatment,'taxable_base',v_base,'tax_amount',v_tax,
    'gross_amount',v_gross,'source_reference',v_reference,'evidence_ref',v_evidence,
    'reason',v_reason,'operation_id',v_operation
  )::text,'sha256'),'hex');
  select * into v_existing from public.restaurant_tax_adjustments
   where lodge_id=v_lodge_id and operation_id=v_operation for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception 'Tax adjustment retry conflicts with the original payload' using errcode='23505';
    end if;
    return jsonb_build_object('success',true,'id',v_existing.id,'status',v_existing.status,'idempotent',true);
  end if;
  insert into public.restaurant_tax_adjustments(
    id,lodge_id,business_date,adjustment_type,tax_direction,tax_code,tax_treatment,
    taxable_base,tax_amount,gross_amount,source_reference,evidence_ref,reason,
    operation_id,payload_hash,created_by
  ) values (
    v_id,v_lodge_id,v_date,v_type,v_direction,nullif(payload->>'tax_code',''),v_treatment,
    v_base,v_tax,v_gross,v_reference,v_evidence,v_reason,v_operation,v_hash,v_actor
  );
  perform public.log_restaurant_financial_action(v_lodge_id,'tax_adjustment.created','restaurant_tax_adjustments',v_id,null,to_jsonb(payload),null);
  return jsonb_build_object('success',true,'id',v_id,'status','draft','operation_id',v_operation);
end
$$;

create or replace function public.approve_restaurant_tax_adjustment(p_lodge_id uuid,p_adjustment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id,'accounting.tax_file');
  v_row public.restaurant_tax_adjustments%rowtype;
begin
  select * into v_row from public.restaurant_tax_adjustments
   where id=p_adjustment_id and lodge_id=p_lodge_id for update;
  if not found or v_row.status <> 'draft' then
    raise exception 'Draft tax adjustment not found' using errcode='23514';
  end if;
  if v_row.created_by = v_actor then
    raise exception 'Tax adjustment preparer cannot approve the adjustment' using errcode='42501';
  end if;
  update public.restaurant_tax_adjustments
     set status='approved',approved_by=v_actor,approved_at=now(),updated_at=now()
   where id=p_adjustment_id and lodge_id=p_lodge_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'tax_adjustment.approved','restaurant_tax_adjustments',p_adjustment_id,to_jsonb(v_row),jsonb_build_object('approved_by',v_actor));
  return jsonb_build_object('success',true,'id',p_adjustment_id,'status','approved');
end
$$;

create or replace function public._restaurant_tax_return_is_stale(p_return_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  r public.restaurant_tax_returns%rowtype;
  c public.restaurant_tax_configurations%rowtype;
  h text;
begin
  select * into r from public.restaurant_tax_returns where id=p_return_id;
  if not found then return true; end if;
  select * into c from public.restaurant_tax_configurations where id=r.configuration_id and lodge_id=r.lodge_id;
  if not found then return true; end if;
  h := encode(digest(to_jsonb(c)::text,'sha256'),'hex');
  if r.configuration_hash is distinct from h then return true; end if;
  if exists(select 1 from public.restaurant_financial_source_postings s where s.lodge_id=r.lodge_id and s.source_type in ('pos_order','ap_bill','expense','expense_payment','ap_payment','payroll','payroll_settlement','inventory_purchase','inventory_stocktake','settlement','cashup') and s.business_date between r.period_start and r.period_end and s.created_at > coalesce(r.generated_at,r.prepared_at,r.created_at)) then return true; end if;
  return exists(select 1 from public.restaurant_tax_adjustments a where a.lodge_id=r.lodge_id and a.business_date between r.period_start and r.period_end and a.status='approved' and a.updated_at > coalesce(r.generated_at,r.prepared_at,r.created_at));
end
$$;

-- One internal generator serves both the original period row and an explicit
-- amendment row.  It keeps the public four-argument RPC stable while making
-- the target row unambiguous after amendments are enabled.
create or replace function public._generate_restaurant_tax_working_paper(
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date,
  p_configuration_id uuid,
  p_target_return_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid; v_cfg public.restaurant_tax_configurations%rowtype;
  v_existing public.restaurant_tax_returns%rowtype; v_id uuid;
  v_config_hash text; v_manifest jsonb; v_manifest_hash text; v_snapshot jsonb; v_hash text;
  v_output numeric := 0; v_input numeric := 0; v_sales numeric := 0; v_purchases numeric := 0;
  v_row record; v_sign numeric; v_base numeric; v_tax numeric;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Valid tax period is required' using errcode='22023';
  end if;
  select * into v_cfg from public.restaurant_tax_configurations
   where id=p_configuration_id and lodge_id=p_lodge_id
     and effective_from<=p_period_start and (effective_to is null or effective_to>=p_period_end);
  if not found then raise exception 'Tax configuration is not effective for the full period' using errcode='23503'; end if;
  v_config_hash := encode(digest(to_jsonb(v_cfg)::text,'sha256'),'hex');
  if p_target_return_id is null then
    select * into v_existing from public.restaurant_tax_returns
     where lodge_id=p_lodge_id and period_start=p_period_start and period_end=p_period_end and amendment_of is null for update;
  else
    select * into v_existing from public.restaurant_tax_returns
     where id=p_target_return_id and lodge_id=p_lodge_id for update;
    if not found or v_existing.amendment_of is null or v_existing.period_start<>p_period_start or v_existing.period_end<>p_period_end then
      raise exception 'Tax amendment target is invalid' using errcode='23514';
    end if;
  end if;
  if found and v_existing.status <> 'draft' then
    raise exception 'Reviewed, approved, or filed tax working papers are immutable; create an amendment' using errcode='55000';
  end if;
  v_id := coalesce(v_existing.id,coalesce(p_target_return_id,gen_random_uuid()));
  delete from public.restaurant_tax_detail_allocations where tax_return_id=v_id;

  for v_row in
    select o.id source_id,o.transaction_type,coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) business_date,
           i.id source_line_id,i.subtotal,i.gross_subtotal,i.net_subtotal,i.tax_allocated,i.tax_code,i.tax_treatment,
           s.journal_entry_id,s.source_version,s.payload_hash
      from public.pos_orders o
      join public.pos_order_items i on i.order_id=o.id and i.lodge_id=p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='pos_order' and s.source_id=o.id and s.status='posted'
     where o.lodge_id=p_lodge_id and o.status in('completed','settled')
       and coalesce(o.business_date,(o.completed_at at time zone 'Africa/Gaborone')::date) between p_period_start and p_period_end
  loop
    v_sign:=case when lower(coalesce(v_row.transaction_type,'sale'))='return' then -1 else 1 end;
    v_tax:=round(coalesce(v_row.tax_allocated,0)*v_sign,2);
    v_base:=round((case when coalesce(v_row.net_subtotal,0)<>0 then v_row.net_subtotal else coalesce(v_row.subtotal,0)-coalesce(v_row.tax_allocated,0) end)*v_sign,2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,case when v_sign<0 then 'pos_return' else 'pos_sale' end,v_row.source_id,v_row.source_line_id,v_row.journal_entry_id,v_row.business_date,
      'output',v_row.tax_code,coalesce(v_row.tax_treatment,case when v_tax<>0 then 'taxable' else 'out_of_scope' end),v_base,v_tax,
      round((coalesce(v_row.subtotal,0)+coalesce(v_row.tax_allocated,0))*v_sign,2),coalesce(v_row.source_version,1),coalesce(v_row.payload_hash,''),v_config_hash
    );
  end loop;

  for v_row in
    select b.id source_id,b.bill_date business_date,i.id source_line_id,i.total,i.tax_amount,i.tax_code,i.tax_treatment,
           b.accrual_journal_entry_id journal_entry_id,s.source_version,s.payload_hash
      from public.restaurant_bills b
      join public.restaurant_bill_items i on i.bill_id=b.id and i.lodge_id=p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='ap_bill' and s.source_id=b.id and s.status='posted'
     where b.lodge_id=p_lodge_id and b.status in('approved','partially_paid','paid','overdue') and b.bill_date between p_period_start and p_period_end
  loop
    v_tax:=round(coalesce(v_row.tax_amount,0),2); v_base:=round(coalesce(v_row.total,0),2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,'ap_bill',v_row.source_id,v_row.source_line_id,v_row.journal_entry_id,v_row.business_date,'input',v_row.tax_code,
      coalesce(v_row.tax_treatment,case when v_tax<>0 then 'taxable' else 'out_of_scope' end),v_base,v_tax,round(v_base+v_tax,2),coalesce(v_row.source_version,1),coalesce(v_row.payload_hash,''),v_config_hash
    );
  end loop;

  insert into public.restaurant_tax_detail_allocations(
    lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
    taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
  )
  select p_lodge_id,v_id,'expense',e.id,e.id,e.journal_entry_id,e.date,'input',e.tax_code,
         coalesce(e.tax_treatment,case when e.tax_amount<>0 then 'taxable' else 'out_of_scope' end),round(e.amount-e.tax_amount,2),round(e.tax_amount,2),e.amount,e.source_version,coalesce(e.payload_hash,''),v_config_hash
    from public.expenses e
   where e.lodge_id=p_lodge_id and e.status in('posted','paid') and e.journal_entry_id is not null and e.date between p_period_start and p_period_end;

  insert into public.restaurant_tax_detail_allocations(
    lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
    taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
  )
  select p_lodge_id,v_id,'inventory_purchase',p.id,p.id,s.journal_entry_id,p.date,'input',p.tax_code,
         coalesce(p.tax_treatment,case when p.tax_amount<>0 then 'taxable' else 'out_of_scope' end),round(p.total_cost-p.tax_amount,2),round(p.tax_amount,2),p.total_cost,1,coalesce(s.payload_hash,p.payload_hash,''),v_config_hash
    from public.inventory_purchases p
    join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted'
   where p.lodge_id=p_lodge_id and p.date between p_period_start and p_period_end;

  -- Approved debit/credit notes and tax adjustments are explicit tax sources,
  -- not inferred from account totals.  Credit notes reverse their direction.
  for v_row in
    select a.* from public.restaurant_tax_adjustments a
     where a.lodge_id=p_lodge_id and a.business_date between p_period_start and p_period_end and a.status='approved'
     order by a.business_date,a.id
  loop
    v_sign:=case when v_row.adjustment_type='credit_note' then -1 else 1 end;
    v_tax:=round(v_row.tax_amount*v_sign,2); v_base:=round(v_row.taxable_base*v_sign,2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id,tax_return_id,source_type,source_id,source_line_id,journal_entry_id,business_date,tax_direction,tax_code,tax_treatment,
      taxable_base,tax_amount,gross_amount,source_version,source_payload_hash,configuration_hash
    ) values (
      p_lodge_id,v_id,'tax_adjustment',v_row.id,v_row.id,null,v_row.business_date,v_row.tax_direction,v_row.tax_code,v_row.tax_treatment,
      v_base,v_tax,round(v_row.gross_amount*v_sign,2),1,v_row.payload_hash,v_config_hash
    );
  end loop;

  select coalesce(sum(t.tax_amount) filter(where t.tax_direction='output'),0),coalesce(sum(t.tax_amount) filter(where t.tax_direction='input'),0),
         coalesce(sum(t.taxable_base) filter(where t.tax_direction='output'),0),coalesce(sum(t.taxable_base) filter(where t.tax_direction='input'),0)
    into v_output,v_input,v_sales,v_purchases
    from public.restaurant_tax_detail_allocations t where t.tax_return_id=v_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id',t.id,'source_type',t.source_type,'source_id',t.source_id,'source_line_id',t.source_line_id,'journal_entry_id',t.journal_entry_id,
    'business_date',t.business_date,'direction',t.tax_direction,'tax_code',t.tax_code,'tax_treatment',t.tax_treatment,'taxable_base',t.taxable_base,
    'tax_amount',t.tax_amount,'gross_amount',t.gross_amount,'source_version',t.source_version,'source_payload_hash',t.source_payload_hash,
    'configuration_hash',t.configuration_hash
  ) order by t.business_date,t.source_type,t.source_id,t.source_line_id),'[]'::jsonb) into v_manifest
    from public.restaurant_tax_detail_allocations t where t.tax_return_id=v_id;
  v_manifest_hash:=encode(digest(v_manifest::text,'sha256'),'hex');
  v_snapshot:=jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'configuration_id',v_cfg.id,'jurisdiction_code',v_cfg.jurisdiction_code,
    'rule_version',v_cfg.rule_version,'configuration_hash',v_config_hash,'sales_ex_tax',round(v_sales,2),'output_tax',round(v_output,2),
    'purchases_ex_tax',round(v_purchases,2),'input_tax',round(v_input,2),'net_tax_payable',round(v_output-v_input,2),
    'source_manifest_hash',v_manifest_hash,'allocation_count',jsonb_array_length(v_manifest),'generated_at',now());
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  if p_target_return_id is null then
    insert into public.restaurant_tax_returns(
      id,lodge_id,period_start,period_end,tax_rate,total_sales_incl,total_sales_excl,total_tax_collected,total_purchases_incl,total_purchases_excl,total_input_tax,
      net_tax_payable,status,configuration_id,jurisdiction_code,rule_version,source_snapshot,snapshot_hash,source_manifest_hash,configuration_hash,prepared_by,prepared_at,generated_at,stale_at,updated_at
    ) values (
      v_id,p_lodge_id,p_period_start,p_period_end,0,v_sales+v_output,v_sales,v_output,v_purchases+v_input,v_purchases,v_input,v_output-v_input,'draft',v_cfg.id,v_cfg.jurisdiction_code,v_cfg.rule_version,
      v_snapshot,v_hash,v_manifest_hash,v_config_hash,v_actor,now(),now(),null,now()
    ) on conflict (lodge_id,period_start,period_end) where amendment_of is null do update set
      total_sales_incl=excluded.total_sales_incl,total_sales_excl=excluded.total_sales_excl,total_tax_collected=excluded.total_tax_collected,
      total_purchases_incl=excluded.total_purchases_incl,total_purchases_excl=excluded.total_purchases_excl,total_input_tax=excluded.total_input_tax,
      net_tax_payable=excluded.net_tax_payable,configuration_id=excluded.configuration_id,jurisdiction_code=excluded.jurisdiction_code,rule_version=excluded.rule_version,
      source_snapshot=excluded.source_snapshot,snapshot_hash=excluded.snapshot_hash,source_manifest_hash=excluded.source_manifest_hash,configuration_hash=excluded.configuration_hash,
      prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,generated_at=excluded.generated_at,stale_at=null,updated_at=now();
  else
    update public.restaurant_tax_returns set
      total_sales_incl=v_sales+v_output,total_sales_excl=v_sales,total_tax_collected=v_output,
      total_purchases_incl=v_purchases+v_input,total_purchases_excl=v_purchases,total_input_tax=v_input,
      net_tax_payable=v_output-v_input,status='draft',configuration_id=v_cfg.id,jurisdiction_code=v_cfg.jurisdiction_code,
      rule_version=v_cfg.rule_version,source_snapshot=v_snapshot,snapshot_hash=v_hash,source_manifest_hash=v_manifest_hash,
      configuration_hash=v_config_hash,prepared_by=v_actor,prepared_at=now(),generated_at=now(),stale_at=null,updated_at=now()
    where id=v_id and lodge_id=p_lodge_id;
  end if;
  perform public.log_restaurant_financial_action(p_lodge_id,'tax_working_paper.generated','restaurant_tax_returns',v_id,null,v_snapshot,jsonb_build_object('snapshot_hash',v_hash,'source_manifest_hash',v_manifest_hash,'amendment_of',v_existing.amendment_of));
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'snapshot_hash',v_hash,'source_manifest_hash',v_manifest_hash,'source_manifest',v_manifest,'working_paper_only',true,'complete',true,'amendment_of',v_existing.amendment_of));
end
$$;

create or replace function public.generate_restaurant_tax_working_paper(p_lodge_id uuid,p_period_start date,p_period_end date,p_configuration_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public._generate_restaurant_tax_working_paper(p_lodge_id,p_period_start,p_period_end,p_configuration_id,null);
end
$$;

create or replace function public.generate_restaurant_tax_amendment_working_paper(p_lodge_id uuid,p_amendment_id uuid,p_configuration_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.restaurant_tax_returns%rowtype;
  v_cfg uuid;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  select * into v_row from public.restaurant_tax_returns where id=p_amendment_id and lodge_id=p_lodge_id and amendment_of is not null;
  if not found then raise exception 'Tax amendment not found' using errcode='P0002'; end if;
  v_cfg:=coalesce(p_configuration_id,v_row.configuration_id);
  return public._generate_restaurant_tax_working_paper(p_lodge_id,v_row.period_start,v_row.period_end,v_cfg,p_amendment_id);
end
$$;

create or replace function public.create_restaurant_tax_amendment(
  p_lodge_id uuid,
  p_original_return_id uuid,
  p_reason text,
  p_operation_id uuid default null,
  p_configuration_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_original public.restaurant_tax_returns%rowtype;
  v_id uuid := gen_random_uuid();
  v_operation uuid := coalesce(p_operation_id,v_id);
  v_sequence integer;
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A reason is required to create a tax amendment' using errcode='22023';
  end if;
  select * into v_original from public.restaurant_tax_returns where id=p_original_return_id and lodge_id=p_lodge_id for update;
  if not found or v_original.amendment_of is not null or v_original.status <> 'filed' then
    raise exception 'Only the filed original tax return can be amended' using errcode='55000';
  end if;
  select id into v_id from public.restaurant_tax_returns where lodge_id=p_lodge_id and amendment_operation_id=v_operation;
  if found then
    return jsonb_build_object('success',true,'id',v_id,'idempotent',true,'status',(select status from public.restaurant_tax_returns where id=v_id));
  end if;
  select coalesce(max(amendment_sequence),0)+1 into v_sequence
    from public.restaurant_tax_returns where lodge_id=p_lodge_id and period_start=v_original.period_start and period_end=v_original.period_end;
  insert into public.restaurant_tax_returns(
    id,lodge_id,period_start,period_end,tax_rate,status,configuration_id,jurisdiction_code,rule_version,
    amendment_sequence,amendment_operation_id,amendment_of,amendment_reason,prepared_by,prepared_at,updated_at
  ) values (
    v_id,p_lodge_id,v_original.period_start,v_original.period_end,v_original.tax_rate,'draft',coalesce(p_configuration_id,v_original.configuration_id),
    v_original.jurisdiction_code,v_original.rule_version,v_sequence,v_operation,v_original.id,btrim(p_reason),v_actor,now(),now()
  );
  v_result:=public.generate_restaurant_tax_amendment_working_paper(p_lodge_id,v_id,coalesce(p_configuration_id,v_original.configuration_id));
  return jsonb_build_object('success',true,'id',v_id,'amendment_of',v_original.id,'status','draft','generation',v_result,'operation_id',v_operation);
end
$$;

revoke all on function public.record_restaurant_tax_adjustment(uuid,jsonb), public.approve_restaurant_tax_adjustment(uuid,uuid), public.create_restaurant_tax_amendment(uuid,uuid,text,uuid,uuid), public.generate_restaurant_tax_amendment_working_paper(uuid,uuid,uuid) from public,anon;
grant execute on function public.record_restaurant_tax_adjustment(uuid,jsonb), public.approve_restaurant_tax_adjustment(uuid,uuid), public.create_restaurant_tax_amendment(uuid,uuid,text,uuid,uuid), public.generate_restaurant_tax_amendment_working_paper(uuid,uuid,uuid) to authenticated,service_role;
revoke all on function public.generate_restaurant_tax_working_paper(uuid,date,date,uuid) from public,anon;
grant execute on function public.generate_restaurant_tax_working_paper(uuid,date,date,uuid) to authenticated,service_role;

commit;
