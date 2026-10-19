-- DEP-01: repair Hotel transfer integrity aggregation without changing the live migration.
begin;
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
  transfer_legs as materialized (
    select li.transfer_pair_id,
      count(*)::integer as leg_count,
      count(*) filter(where li.line_type='transfer_out')::integer as out_count,
      count(*) filter(where li.line_type='transfer_in')::integer as in_count,
      (max(li.folio_id::text) filter(where li.line_type='transfer_out'))::uuid as out_folio_id,
      (max(li.folio_id::text) filter(where li.line_type='transfer_in'))::uuid as in_folio_id,
      count(distinct li.amount)::integer as amount_count
    from public.folio_line_items li
    where li.lodge_id=p_lodge_id and li.transfer_pair_id is not null
      and li.line_type in('transfer_in','transfer_out')
    group by li.transfer_pair_id
  ),
  transfer_reversals as materialized (
    select li.transfer_pair_id,count(r.id)::integer as reversal_count
    from public.folio_line_items li
    left join public.folio_line_items r on r.reverses_line_item_id=li.id and r.lodge_id=p_lodge_id
    where li.lodge_id=p_lodge_id and li.transfer_pair_id is not null
      and li.line_type in('transfer_in','transfer_out')
    group by li.transfer_pair_id
  ),
  pair_health as materialized (
    select tp.id,tp.source_folio_id,tp.target_folio_id,
      coalesce(l.leg_count,0)::integer as leg_count,
      coalesce(l.out_count,0)::integer as out_count,
      coalesce(l.in_count,0)::integer as in_count,
      l.out_folio_id,l.in_folio_id,coalesce(l.amount_count,0)::integer as amount_count,
      coalesce(r.reversal_count,0)::integer as reversal_count
    from public.hotel_folio_transfer_pairs tp
    left join transfer_legs l on l.transfer_pair_id=tp.id
    left join transfer_reversals r on r.transfer_pair_id=tp.id
    where tp.lodge_id=p_lodge_id
  ),  cross_lodge as materialized (
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
commit;