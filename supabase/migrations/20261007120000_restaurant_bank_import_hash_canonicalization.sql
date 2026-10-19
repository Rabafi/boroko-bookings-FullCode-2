-- Hash persisted two-decimal statement balances so later verification is reproducible.
begin;
create or replace function public.import_bank_statement_v3(
  p_lodge_id uuid,p_bank_account_id uuid,p_rows jsonb,p_file_name text,p_operation_id text,
  p_opening_balance numeric,p_closing_balance numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid; v_hash text; v_import uuid; v_existing record; v_row jsonb; v_prev numeric:=p_opening_balance; v_after numeric; v_debit numeric; v_credit numeric; v_date date; v_index integer:=0;
begin
  v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
  if p_opening_balance is null or p_closing_balance is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or nullif(btrim(p_operation_id),'') is null then raise exception 'Opening/closing evidence, rows and stable operation ID are required' using errcode='22023'; end if;
  if not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id and is_active) then raise exception 'Bank account is invalid for the lodge' using errcode='42501'; end if;
  v_hash:=encode(digest(jsonb_build_object('bank_account_id',p_bank_account_id,'rows',p_rows,'opening_balance',round(p_opening_balance,2),'closing_balance',round(p_closing_balance,2))::text,'sha256'),'hex');
  select id,payload_hash into v_existing from public.restaurant_bank_statement_imports where lodge_id=p_lodge_id and bank_account_id=p_bank_account_id and operation_idempotency_key=p_operation_id for update;
  if found then if v_existing.payload_hash<>v_hash then raise exception 'Bank import operation ID conflicts with different payload' using errcode='23505'; end if; return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_existing.id,'replayed',true)); end if;
  insert into public.restaurant_bank_statement_imports(lodge_id,bank_account_id,statement_hash,file_name,row_count,imported_by,raw_payload,payload_hash,period_start,period_end,operation_idempotency_key,opening_balance,closing_balance,balance_policy)
  values(p_lodge_id,p_bank_account_id,v_hash,nullif(btrim(p_file_name),''),jsonb_array_length(p_rows),v_actor,p_rows,v_hash,nullif(p_rows->0->>'transaction_date','')::date,nullif(p_rows->(jsonb_array_length(p_rows)-1)->>'transaction_date','')::date,p_operation_id,p_opening_balance,p_closing_balance,'every_row_balance_after') returning id into v_import;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_date:=nullif(v_row->>'transaction_date','')::date; v_debit:=coalesce(nullif(v_row->>'debit','')::numeric,0); v_credit:=coalesce(nullif(v_row->>'credit','')::numeric,0); v_after:=nullif(v_row->>'balance_after','')::numeric;
    if v_date is null or nullif(btrim(v_row->>'description'),'') is null or v_after is null or not ((v_debit>0 and v_credit=0) or (v_credit>0 and v_debit=0)) then raise exception 'Every imported row requires date, description, one debit/credit and balance_after' using errcode='22023'; end if;
    if round(v_after-(v_prev+v_credit-v_debit),2)<>0 then raise exception 'Bank running balance does not equal previous_balance + credit - debit at row %',v_index+1 using errcode='23514'; end if;
    insert into public.restaurant_bank_transactions(lodge_id,bank_account_id,transaction_date,description,debit,credit,balance_after,previous_balance,signed_amount,reference_number,category,fingerprint,statement_import_id)
    values(p_lodge_id,p_bank_account_id,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after,v_prev,round(v_credit-v_debit,2),nullif(btrim(v_row->>'reference_number'),''),nullif(btrim(v_row->>'category'),''),encode(digest(concat_ws('|',p_bank_account_id::text,v_date,btrim(v_row->>'description'),v_debit,v_credit,v_after),'sha256'),'hex'),v_import);
    v_prev:=v_after; v_index:=v_index+1;
  end loop;
  if round(v_prev-p_closing_balance,2)<>0 then raise exception 'Bank closing balance evidence does not equal the final row balance' using errcode='23514'; end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_import,'replayed',false,'row_count',v_index,'opening_balance',p_opening_balance,'closing_balance',p_closing_balance,'signed_amount_policy','credit - debit','balance_policy','every_row_balance_after','payload_hash',v_hash));
end
$$;
commit;
