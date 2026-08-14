-- Direct expense posting separates the expense base from input tax and keeps
-- the source/subledger/GL operation atomic.

begin;

create or replace function public.post_expense(p_id uuid,p_lodge_id uuid,p_operation_id uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_exp public.expenses%rowtype; v_op jsonb; v_hash text; v_result jsonb; v_actor uuid;
  v_expense_account uuid; v_payable_account uuid; v_tax_account uuid; v_journal jsonb; v_business_date date; v_base numeric;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  v_op:=public._restaurant_expense_transition_operation(p_lodge_id,p_id,p_operation_id,'post',p_payload);
  if coalesce((v_op->>'replayed')::boolean,false) then return v_op; end if;
  v_hash:=v_op->>'payload_hash';
  select * into v_exp from public.expenses where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Expense not found' using errcode='P0002'; end if;
  if v_exp.status in ('posted','paid') then return jsonb_build_object('success',true,'id',p_id,'status',v_exp.status,'replayed',true); end if;
  if v_exp.status<>'approved' then raise exception 'Only approved expenses can be posted' using errcode='55000'; end if;
  if v_exp.source_kind='ap_bill' then raise exception 'AP-linked expenses must be posted through the AP bill workflow; direct expense posting would duplicate the liability' using errcode='55000'; end if;
  v_business_date:=v_exp.date; v_base:=round(v_exp.amount-coalesce(v_exp.tax_amount,0),2);
  if v_base<=0 then raise exception 'Expense base must remain positive after explicit tax allocation' using errcode='22023'; end if;
  select m.account_id into v_expense_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='expense' where m.lodge_id=p_lodge_id and m.mapping_type='expense_category' and m.source_key=lower(coalesce(v_exp.category,'other')) and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by m.effective_from desc limit 1;
  v_expense_account:=coalesce(v_expense_account,v_exp.expense_account_id);
  if v_expense_account is null or not exists(select 1 from public.restaurant_accounts where id=v_expense_account and lodge_id=p_lodge_id and is_active and account_type='expense') then raise exception 'No effective expense-category mapping is configured for %',coalesce(v_exp.category,'other') using errcode='23503'; end if;
  select m.account_id into v_payable_account from public.restaurant_pos_gl_mappings m join public.restaurant_accounts a on a.id=m.account_id and a.lodge_id=p_lodge_id and a.is_active and a.account_type='liability' where m.lodge_id=p_lodge_id and m.mapping_type='expense_payable' and m.source_key='default' and m.effective_from<=v_business_date and (m.effective_to is null or m.effective_to>=v_business_date) order by m.effective_from desc limit 1;
  if v_payable_account is null then raise exception 'Default expense-payable liability mapping is not configured' using errcode='23503'; end if;
  if coalesce(v_exp.tax_amount,0)>0 then
    select c.input_tax_account_id into v_tax_account from public.restaurant_tax_configurations c where c.lodge_id=p_lodge_id and c.effective_from<=v_business_date and (c.effective_to is null or c.effective_to>=v_business_date) order by c.effective_from desc limit 1;
    if v_tax_account is null then raise exception 'An effective input-tax account is required for a taxed expense' using errcode='23503'; end if;
  end if;
  v_journal:=public._restaurant_post_journal(p_lodge_id,v_business_date,'Expense accrual: '||coalesce(v_exp.description,'expense'),'expense',p_id,v_exp.reference_number,'expense-post:'||p_id::text,
    case when coalesce(v_exp.tax_amount,0)>0 then jsonb_build_array(jsonb_build_object('account_id',v_expense_account,'debit',v_base,'credit',0,'memo',coalesce(v_exp.category,'expense')),jsonb_build_object('account_id',v_tax_account,'debit',v_exp.tax_amount,'credit',0,'memo','Input tax'),jsonb_build_object('account_id',v_payable_account,'debit',0,'credit',v_exp.amount,'memo','Expense payable')) else jsonb_build_array(jsonb_build_object('account_id',v_expense_account,'debit',v_exp.amount,'credit',0,'memo',coalesce(v_exp.category,'expense')),jsonb_build_object('account_id',v_payable_account,'debit',0,'credit',v_exp.amount,'memo','Expense payable')) end,v_actor,null);
  update public.expenses set status='posted',journal_entry_id=(v_journal->'data'->>'entry_id')::uuid,posted_by=v_actor,posted_at=now(),updated_at=now() where id=p_id;
  perform public.record_restaurant_source_posting(p_lodge_id,'expense',p_id,v_business_date,(v_journal->'data'->>'entry_id')::uuid,p_operation_id,v_hash,1,v_exp.outlet_id,'posted');
  v_result:=jsonb_build_object('success',true,'id',p_id,'status','posted','journal_entry_id',v_journal->'data'->>'entry_id','tax_allocated',coalesce(v_exp.tax_amount,0));
  perform public._restaurant_record_expense_operation(p_lodge_id,p_id,p_operation_id,'post',v_hash,v_result);
  return v_result;
end
$$;

commit;
