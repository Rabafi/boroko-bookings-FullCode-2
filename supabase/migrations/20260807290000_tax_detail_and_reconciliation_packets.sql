-- Explicit tax-detail allocations and filing-grade bank reconciliation packets.
-- These objects make source arithmetic reproducible without broad account-type
-- joins and keep bank evidence separate from accounting-period close.

begin;

alter table public.pos_order_items
  add column if not exists tax_code text,
  add column if not exists tax_treatment text not null default 'out_of_scope';
alter table public.restaurant_bill_items
  add column if not exists tax_code text,
  add column if not exists tax_treatment text not null default 'out_of_scope';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_order_items_tax_treatment_chk') then
    alter table public.pos_order_items add constraint pos_order_items_tax_treatment_chk
      check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurant_bill_items_tax_treatment_chk') then
    alter table public.restaurant_bill_items add constraint restaurant_bill_items_tax_treatment_chk
      check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown'));
  end if;
end
$$;

create table if not exists public.restaurant_tax_detail_allocations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  tax_return_id uuid not null references public.restaurant_tax_returns(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  source_line_id uuid not null,
  journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  business_date date not null,
  tax_direction text not null check (tax_direction in ('output','input','adjustment')),
  tax_code text,
  tax_treatment text not null check (tax_treatment in ('taxable','zero_rated','exempt','out_of_scope','unknown')),
  taxable_base numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  gross_amount numeric(18,2) not null default 0,
  source_version integer not null default 1,
  source_payload_hash text not null,
  configuration_hash text not null,
  created_at timestamptz not null default now(),
  unique(tax_return_id, source_type, source_line_id, tax_code)
);
alter table public.restaurant_tax_detail_allocations enable row level security;
revoke all on table public.restaurant_tax_detail_allocations from public, anon, authenticated;
grant select on table public.restaurant_tax_detail_allocations to service_role;
create index if not exists restaurant_tax_detail_allocations_source_idx
  on public.restaurant_tax_detail_allocations(lodge_id, source_type, source_id, business_date);

alter table public.restaurant_tax_returns
  add column if not exists source_manifest_hash text,
  add column if not exists configuration_hash text,
  add column if not exists generated_at timestamptz,
  add column if not exists stale_at timestamptz,
  add column if not exists amendment_of uuid references public.restaurant_tax_returns(id) on delete restrict,
  add column if not exists amendment_reason text;

create or replace function public._restaurant_tax_return_is_stale(p_return_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.restaurant_tax_returns%rowtype;
  c public.restaurant_tax_configurations%rowtype;
  h text;
begin
  select * into r from public.restaurant_tax_returns where id = p_return_id;
  if not found then return true; end if;
  select * into c from public.restaurant_tax_configurations where id = r.configuration_id and lodge_id = r.lodge_id;
  if not found then return true; end if;
  h := encode(digest(to_jsonb(c)::text, 'sha256'), 'hex');
  if r.configuration_hash is distinct from h then return true; end if;
  return exists (
    select 1 from public.restaurant_financial_source_postings s
     where s.lodge_id = r.lodge_id
       and s.source_type in ('pos_order','ap_bill','expense','expense_payment','ap_payment','payroll','payroll_settlement','inventory_purchase','inventory_stocktake','settlement')
       and s.business_date between r.period_start and r.period_end
       and s.created_at > coalesce(r.generated_at, r.prepared_at, r.created_at)
  );
end
$$;

create or replace function public.generate_restaurant_tax_working_paper(
  p_lodge_id uuid, p_period_start date, p_period_end date, p_configuration_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid; v_cfg public.restaurant_tax_configurations%rowtype;
  v_existing public.restaurant_tax_returns%rowtype; v_id uuid;
  v_config_hash text; v_manifest jsonb; v_manifest_hash text; v_snapshot jsonb; v_hash text;
  v_output numeric := 0; v_input numeric := 0; v_sales numeric := 0; v_purchases numeric := 0;
  v_row record; v_sign numeric; v_base numeric; v_tax numeric;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'Valid tax period is required' using errcode = '22023';
  end if;
  select * into v_cfg from public.restaurant_tax_configurations
   where id = p_configuration_id and lodge_id = p_lodge_id
     and effective_from <= p_period_start and (effective_to is null or effective_to >= p_period_end);
  if not found then raise exception 'Tax configuration is not effective for the full period' using errcode = '23503'; end if;
  v_config_hash := encode(digest(to_jsonb(v_cfg)::text, 'sha256'), 'hex');
  select * into v_existing from public.restaurant_tax_returns
   where lodge_id = p_lodge_id and period_start = p_period_start and period_end = p_period_end for update;
  if found and v_existing.status <> 'draft' then
    raise exception 'Reviewed, approved, or filed tax working papers are immutable; create an amendment' using errcode = '55000';
  end if;
  v_id := coalesce(v_existing.id, gen_random_uuid());
  delete from public.restaurant_tax_detail_allocations where tax_return_id = v_id;

  -- POS: line-level allocations carry the signed return direction and never
  -- infer taxable bases from revenue-account totals.
  for v_row in
    select o.id source_id, o.transaction_type,
           coalesce(o.business_date, (o.completed_at at time zone 'Africa/Gaborone')::date) business_date,
           i.id source_line_id, i.subtotal, i.gross_subtotal, i.net_subtotal,
           i.tax_allocated, i.tax_code, i.tax_treatment,
           s.journal_entry_id, s.source_version, s.payload_hash
      from public.pos_orders o
      join public.pos_order_items i on i.order_id = o.id and i.lodge_id = p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id = p_lodge_id and s.source_type = 'pos_order' and s.source_id = o.id and s.status = 'posted'
     where o.lodge_id = p_lodge_id
       and o.status in ('completed','settled')
       and coalesce(o.business_date, (o.completed_at at time zone 'Africa/Gaborone')::date) between p_period_start and p_period_end
  loop
    v_sign := case when lower(coalesce(v_row.transaction_type, 'sale')) = 'return' then -1 else 1 end;
    v_tax := round(coalesce(v_row.tax_allocated, 0) * v_sign, 2);
    v_base := round((case when coalesce(v_row.net_subtotal, 0) <> 0 then v_row.net_subtotal else coalesce(v_row.subtotal, 0) - coalesce(v_row.tax_allocated, 0) end) * v_sign, 2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id, tax_return_id, source_type, source_id, source_line_id, journal_entry_id,
      business_date, tax_direction, tax_code, tax_treatment, taxable_base, tax_amount,
      gross_amount, source_version, source_payload_hash, configuration_hash
    ) values (
      p_lodge_id, v_id, case when v_sign < 0 then 'pos_return' else 'pos_sale' end,
      v_row.source_id, v_row.source_line_id, v_row.journal_entry_id, v_row.business_date,
      'output', v_row.tax_code, coalesce(v_row.tax_treatment, case when v_tax <> 0 then 'taxable' else 'out_of_scope' end),
      v_base, v_tax, round((coalesce(v_row.subtotal, 0) + coalesce(v_row.tax_allocated, 0)) * v_sign, 2),
      coalesce(v_row.source_version, 1), coalesce(v_row.payload_hash, ''), v_config_hash
    );
  end loop;

  -- AP bills: use item totals and explicit tax fields. The input tax line is
  -- not included in purchases_ex_tax because it is already separated here.
  for v_row in
    select b.id source_id, b.bill_date business_date, i.id source_line_id,
           i.total, i.tax_amount, i.tax_code, i.tax_treatment,
           b.accrual_journal_entry_id journal_entry_id, s.source_version, s.payload_hash
      from public.restaurant_bills b
      join public.restaurant_bill_items i on i.bill_id = b.id and i.lodge_id = p_lodge_id
      join public.restaurant_financial_source_postings s on s.lodge_id = p_lodge_id and s.source_type = 'ap_bill' and s.source_id = b.id and s.status = 'posted'
     where b.lodge_id = p_lodge_id and b.status in ('approved','partially_paid','paid','overdue')
       and b.bill_date between p_period_start and p_period_end
  loop
    v_tax := round(coalesce(v_row.tax_amount, 0), 2);
    v_base := round(coalesce(v_row.total, 0), 2);
    insert into public.restaurant_tax_detail_allocations(
      lodge_id, tax_return_id, source_type, source_id, source_line_id, journal_entry_id,
      business_date, tax_direction, tax_code, tax_treatment, taxable_base, tax_amount,
      gross_amount, source_version, source_payload_hash, configuration_hash
    ) values (
      p_lodge_id, v_id, 'ap_bill', v_row.source_id, v_row.source_line_id, v_row.journal_entry_id,
      v_row.business_date, 'input', v_row.tax_code,
      coalesce(v_row.tax_treatment, case when v_tax <> 0 then 'taxable' else 'out_of_scope' end),
      v_base, v_tax, round(v_base + v_tax, 2), coalesce(v_row.source_version, 1), coalesce(v_row.payload_hash, ''), v_config_hash
    );
  end loop;

  -- Direct expenses are included only after their own lifecycle posting.
  insert into public.restaurant_tax_detail_allocations(
    lodge_id, tax_return_id, source_type, source_id, source_line_id, journal_entry_id,
    business_date, tax_direction, tax_code, tax_treatment, taxable_base, tax_amount,
    gross_amount, source_version, source_payload_hash, configuration_hash
  )
  select p_lodge_id, v_id, 'expense', e.id, e.id, e.journal_entry_id, e.date, 'input', e.tax_code,
         coalesce(e.tax_treatment, case when e.tax_amount <> 0 then 'taxable' else 'out_of_scope' end),
         round(e.amount - e.tax_amount, 2), round(e.tax_amount, 2), e.amount, e.source_version,
         coalesce(e.payload_hash, ''), v_config_hash
   from public.expenses e
   where e.lodge_id = p_lodge_id and e.status in ('posted','paid')
     and e.journal_entry_id is not null and e.date between p_period_start and p_period_end;

  insert into public.restaurant_tax_detail_allocations(
    lodge_id, tax_return_id, source_type, source_id, source_line_id, journal_entry_id,
    business_date, tax_direction, tax_code, tax_treatment, taxable_base, tax_amount,
    gross_amount, source_version, source_payload_hash, configuration_hash
  )
  select p_lodge_id, v_id, 'inventory_purchase', p.id, p.id, s.journal_entry_id, p.date,
         'input', p.tax_code, coalesce(p.tax_treatment, case when p.tax_amount <> 0 then 'taxable' else 'out_of_scope' end),
         round(p.total_cost-p.tax_amount,2), round(p.tax_amount,2), p.total_cost, 1,
         coalesce(s.payload_hash,p.payload_hash,''), v_config_hash
    from public.inventory_purchases p
    join public.restaurant_financial_source_postings s on s.lodge_id=p_lodge_id and s.source_type='inventory_purchase' and s.source_id=p.id and s.status='posted'
   where p.lodge_id=p_lodge_id and p.date between p_period_start and p_period_end;

  select coalesce(sum(t.tax_amount) filter (where t.tax_direction = 'output'), 0),
         coalesce(sum(t.tax_amount) filter (where t.tax_direction = 'input'), 0),
         coalesce(sum(t.taxable_base) filter (where t.tax_direction = 'output'), 0),
         coalesce(sum(t.taxable_base) filter (where t.tax_direction = 'input'), 0)
    into v_output, v_input, v_sales, v_purchases
    from public.restaurant_tax_detail_allocations t where t.tax_return_id = v_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', t.id, 'source_type', t.source_type, 'source_id', t.source_id,
    'source_line_id', t.source_line_id, 'journal_entry_id', t.journal_entry_id,
    'business_date', t.business_date, 'direction', t.tax_direction, 'tax_code', t.tax_code,
    'tax_treatment', t.tax_treatment, 'taxable_base', t.taxable_base, 'tax_amount', t.tax_amount,
    'gross_amount', t.gross_amount, 'source_version', t.source_version,
    'source_payload_hash', t.source_payload_hash, 'configuration_hash', t.configuration_hash
  ) order by t.business_date, t.source_type, t.source_id, t.source_line_id), '[]'::jsonb)
    into v_manifest from public.restaurant_tax_detail_allocations t where t.tax_return_id = v_id;
  v_manifest_hash := encode(digest(v_manifest::text, 'sha256'), 'hex');
  v_snapshot := jsonb_build_object(
    'period_start', p_period_start, 'period_end', p_period_end,
    'configuration_id', v_cfg.id, 'jurisdiction_code', v_cfg.jurisdiction_code,
    'rule_version', v_cfg.rule_version, 'configuration_hash', v_config_hash,
    'sales_ex_tax', round(v_sales, 2), 'output_tax', round(v_output, 2),
    'purchases_ex_tax', round(v_purchases, 2), 'input_tax', round(v_input, 2),
    'net_tax_payable', round(v_output - v_input, 2), 'source_manifest_hash', v_manifest_hash,
    'allocation_count', jsonb_array_length(v_manifest), 'generated_at', now()
  );
  v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');
  insert into public.restaurant_tax_returns(
    id, lodge_id, period_start, period_end, tax_rate, total_sales_incl, total_sales_excl,
    total_tax_collected, total_purchases_incl, total_purchases_excl, total_input_tax,
    net_tax_payable, status, configuration_id, jurisdiction_code, rule_version,
    source_snapshot, snapshot_hash, source_manifest_hash, configuration_hash,
    prepared_by, prepared_at, generated_at, stale_at, updated_at
  ) values (
    v_id, p_lodge_id, p_period_start, p_period_end, 0, v_sales + v_output, v_sales,
    v_output, v_purchases + v_input, v_purchases, v_input, v_output - v_input,
    'draft', v_cfg.id, v_cfg.jurisdiction_code, v_cfg.rule_version, v_snapshot, v_hash,
    v_manifest_hash, v_config_hash, v_actor, now(), now(), null, now()
  ) on conflict (lodge_id, period_start, period_end) do update set
    total_sales_incl = excluded.total_sales_incl, total_sales_excl = excluded.total_sales_excl,
    total_tax_collected = excluded.total_tax_collected, total_purchases_incl = excluded.total_purchases_incl,
    total_purchases_excl = excluded.total_purchases_excl, total_input_tax = excluded.total_input_tax,
    net_tax_payable = excluded.net_tax_payable, configuration_id = excluded.configuration_id,
    jurisdiction_code = excluded.jurisdiction_code, rule_version = excluded.rule_version,
    source_snapshot = excluded.source_snapshot, snapshot_hash = excluded.snapshot_hash,
    source_manifest_hash = excluded.source_manifest_hash, configuration_hash = excluded.configuration_hash,
    prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, generated_at = excluded.generated_at,
    stale_at = null, updated_at = now();
  perform public.log_restaurant_financial_action(p_lodge_id, 'tax_working_paper.generated', 'restaurant_tax_returns', v_id, null, v_snapshot, jsonb_build_object('snapshot_hash', v_hash, 'source_manifest_hash', v_manifest_hash));
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'id', v_id, 'snapshot_hash', v_hash, 'source_manifest_hash', v_manifest_hash,
    'source_manifest', v_manifest, 'working_paper_only', true, 'complete', true
  ));
end
$$;

-- Reopen/review/approve/file must refuse a stale source snapshot.
create or replace function public.review_restaurant_tax_working_paper(p_lodge_id uuid,p_return_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_r public.restaurant_tax_returns%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_r from public.restaurant_tax_returns where id = p_return_id and lodge_id = p_lodge_id for update;
  if not found or v_r.status <> 'draft' or v_r.snapshot_hash <> encode(digest(v_r.source_snapshot::text, 'sha256'), 'hex') then raise exception 'Valid draft working paper not found' using errcode='23514'; end if;
  if public._restaurant_tax_return_is_stale(p_return_id) then
    update public.restaurant_tax_returns set stale_at = now(), updated_at = now() where id = p_return_id;
    return jsonb_build_object('success', false, 'error', 'Tax working paper is stale; regenerate before review', 'stale', true);
  end if;
  if v_r.prepared_by = v_actor then raise exception 'Working-paper preparer cannot review it' using errcode='42501'; end if;
  update public.restaurant_tax_returns set status='reviewed', updated_at=now() where id=p_return_id;
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_return_id, 'status', 'reviewed'));
end
$$;

create or replace function public.approve_restaurant_tax_working_paper(p_lodge_id uuid,p_return_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_r public.restaurant_tax_returns%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.tax_file');
  select * into v_r from public.restaurant_tax_returns where id = p_return_id and lodge_id = p_lodge_id for update;
  if not found or v_r.status <> 'reviewed' or v_r.snapshot_hash <> encode(digest(v_r.source_snapshot::text, 'sha256'), 'hex') then raise exception 'Reviewed immutable working paper not found' using errcode='23514'; end if;
  if public._restaurant_tax_return_is_stale(p_return_id) then
    update public.restaurant_tax_returns set stale_at = now(), updated_at = now() where id = p_return_id;
    return jsonb_build_object('success', false, 'error', 'Tax working paper is stale; regenerate before approval', 'stale', true);
  end if;
  if v_r.prepared_by = v_actor then raise exception 'Working-paper preparer cannot approve it' using errcode='42501'; end if;
  update public.restaurant_tax_returns set status='approved', approved_by=v_actor, approved_at=now(), updated_at=now() where id=p_return_id;
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_return_id, 'status', 'approved'));
end
$$;

create or replace function public.record_restaurant_tax_filing(p_lodge_id uuid,p_return_id uuid,p_filing_reference text,p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_r public.restaurant_tax_returns%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.tax_file');
  if nullif(btrim(p_filing_reference), '') is null then raise exception 'Authoritative filing reference is required' using errcode='22023'; end if;
  select * into v_r from public.restaurant_tax_returns where id=p_return_id and lodge_id=p_lodge_id for update;
  if not found or v_r.status <> 'approved' or v_r.approved_by is null or v_r.snapshot_hash <> encode(digest(v_r.source_snapshot::text, 'sha256'), 'hex') then raise exception 'Approved immutable working paper is required before filing' using errcode='23514'; end if;
  if public._restaurant_tax_return_is_stale(p_return_id) then
    update public.restaurant_tax_returns set stale_at = now(), updated_at = now() where id = p_return_id;
    return jsonb_build_object('success', false, 'error', 'Tax working paper is stale; filing is blocked', 'stale', true);
  end if;
  if v_r.approved_by = v_actor then raise exception 'Working-paper approver cannot record the filing' using errcode='42501'; end if;
  update public.restaurant_tax_returns set status='filed', filed_by=v_actor, filed_at=now(), filing_reference=btrim(p_filing_reference), notes=nullif(btrim(p_notes),''), updated_at=now() where id=p_return_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'tax_filing.recorded','restaurant_tax_returns',p_return_id,to_jsonb(v_r),jsonb_build_object('filing_reference',btrim(p_filing_reference),'filed_by',v_actor,'source_manifest_hash',v_r.source_manifest_hash),null);
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_return_id,'status','filed'));
end
$$;

create or replace function public.get_restaurant_tax_filing_packet_v2(p_lodge_id uuid, p_return_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_r jsonb; v_alloc jsonb; v_control jsonb; v_hash text; v_cfg public.restaurant_tax_configurations%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  select to_jsonb(r) into v_r from public.restaurant_tax_returns r where r.id=p_return_id and r.lodge_id=p_lodge_id;
  if v_r is null then raise exception 'Tax return not found' using errcode='P0002'; end if;
  select * into v_cfg from public.restaurant_tax_configurations c where c.id=(v_r->>'configuration_id')::uuid and c.lodge_id=p_lodge_id;
  if not found then raise exception 'Tax configuration evidence is missing' using errcode='23503'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.business_date,a.source_type,a.source_id,a.source_line_id),'[]'::jsonb) into v_alloc from public.restaurant_tax_detail_allocations a where a.tax_return_id=p_return_id and a.lodge_id=p_lodge_id;
  select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'code',a.code,'name',a.name,'output_tax',coalesce(x.output_tax,0),'input_tax',coalesce(x.input_tax,0)) order by a.code),'[]'::jsonb) into v_control
    from public.restaurant_accounts a left join lateral (
      select sum(case when l.credit>0 then l.credit-l.debit else 0 end) filter(where l.account_id=v_cfg.output_tax_account_id) output_tax,
             sum(case when l.debit>0 then l.debit-l.credit else 0 end) filter(where l.account_id=v_cfg.input_tax_account_id) input_tax
        from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id and e.lodge_id=p_lodge_id and e.is_posted and e.entry_date between (v_r->>'period_start')::date and (v_r->>'period_end')::date
    ) x on true where a.lodge_id=p_lodge_id and a.is_active and a.id in (v_cfg.output_tax_account_id,v_cfg.input_tax_account_id);
  v_hash := encode(digest(jsonb_build_object('return',v_r,'allocations',v_alloc,'control_accounts',v_control)::text,'sha256'),'hex');
  return jsonb_build_object('success',true,'data',jsonb_build_object('return',v_r,'allocations',v_alloc,'control_accounts',v_control,'packet_hash',v_hash,'complete',true,'professional_review_required',true));
end
$$;

revoke all on function public.get_restaurant_tax_filing_packet_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_restaurant_tax_filing_packet_v2(uuid,uuid) to authenticated,service_role;

commit;
