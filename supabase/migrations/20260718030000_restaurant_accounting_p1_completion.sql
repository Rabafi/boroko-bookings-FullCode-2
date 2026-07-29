begin;

-- Restaurant Accounting P1 completion: canonical RPC signatures, immutable audit access,
-- atomic statement imports, separated matching/reconciliation, and AP replay safety.

revoke all on function public.log_restaurant_financial_action(uuid, text, text, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke insert, update, delete on public.restaurant_financial_audit_log from public, anon, authenticated;
revoke insert, update, delete on public.restaurant_accounts, public.restaurant_journal_entries,
  public.restaurant_journal_lines, public.restaurant_bank_accounts,
  public.restaurant_bank_transactions, public.restaurant_bank_reconciliations,
  public.restaurant_bills, public.restaurant_bill_items, public.restaurant_bill_payments,
  public.restaurant_tax_returns, public.restaurant_budgets, public.restaurant_budget_templates,
  public.restaurant_budget_template_lines, public.restaurant_pay_periods,
  public.restaurant_employee_pay_records, public.restaurant_payroll_settings,
  public.restaurant_payroll_payments from public, anon, authenticated;

alter table public.restaurant_bank_transactions
  add column if not exists statement_import_id uuid references public.restaurant_bank_statement_imports(id) on delete restrict,
  add column if not exists reconciliation_id uuid references public.restaurant_bank_reconciliations(id) on delete set null;

alter table public.restaurant_bank_transactions
  drop constraint if exists restaurant_bank_transactions_amount_direction_chk;
alter table public.restaurant_bank_transactions
  add constraint restaurant_bank_transactions_amount_direction_chk
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0));

create unique index if not exists restaurant_bank_transactions_account_fingerprint_uidx
  on public.restaurant_bank_transactions(bank_account_id, fingerprint)
  where fingerprint is not null;
create index if not exists restaurant_bank_transactions_reconciliation_idx
  on public.restaurant_bank_transactions(reconciliation_id)
  where reconciliation_id is not null;

-- Prevent PostgREST selecting an arbitrary historical overload.
drop function if exists public.import_bank_statement(uuid, uuid, jsonb);
drop function if exists public.update_restaurant_bank_account(uuid, uuid, text, text, text, boolean);
drop function if exists public.record_bill_payment(uuid, uuid, date, numeric, text, text, text);

create or replace function public.import_bank_statement(
  p_lodge_id uuid,
  p_bank_account_id uuid,
  p_transactions jsonb,
  p_statement_hash text,
  p_file_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_import_id uuid;
  v_txn jsonb;
  v_fingerprint text;
  v_imported integer := 0;
  v_skipped integer := 0;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin','super_admin','manager','finance']);
  if nullif(btrim(p_statement_hash), '') is null or p_transactions is null or jsonb_array_length(p_transactions) = 0 then
    return jsonb_build_object('success', false, 'error', 'A statement hash and at least one transaction are required');
  end if;
  if not exists (select 1 from public.restaurant_bank_accounts where id = p_bank_account_id and lodge_id = p_lodge_id and is_active) then
    return jsonb_build_object('success', false, 'error', 'Active bank account not found');
  end if;
  begin
    insert into public.restaurant_bank_statement_imports(lodge_id, bank_account_id, statement_hash, file_name, row_count, imported_by)
    values (p_lodge_id, p_bank_account_id, btrim(p_statement_hash), nullif(btrim(p_file_name), ''), 0, public.app_get_actor_user_id())
    returning id into v_import_id;
  exception when unique_violation then
    return jsonb_build_object('success', true, 'already_imported', true, 'imported', 0, 'skipped', 0);
  end;
  for v_txn in select value from jsonb_array_elements(p_transactions)
  loop
    if nullif(btrim(v_txn->>'transaction_date'), '') is null or nullif(btrim(v_txn->>'description'), '') is null then
      raise exception 'Each transaction requires a date and description';
    end if;
    if ((coalesce((v_txn->>'debit')::numeric, 0) > 0)::integer + (coalesce((v_txn->>'credit')::numeric, 0) > 0)::integer) <> 1 then
      raise exception 'Each transaction must have exactly one positive debit or credit';
    end if;
    v_fingerprint := encode(digest(concat_ws('|', p_bank_account_id::text, v_txn->>'transaction_date', v_txn->>'description', coalesce(v_txn->>'debit','0'), coalesce(v_txn->>'credit','0'), coalesce(v_txn->>'reference_number','')), 'sha256'), 'hex');
    begin
      insert into public.restaurant_bank_transactions(lodge_id, bank_account_id, transaction_date, description, debit, credit, balance_after, reference_number, category, fingerprint, statement_import_id)
      values (p_lodge_id, p_bank_account_id, (v_txn->>'transaction_date')::date, btrim(v_txn->>'description'), coalesce((v_txn->>'debit')::numeric,0), coalesce((v_txn->>'credit')::numeric,0), nullif(v_txn->>'balance_after','')::numeric, nullif(btrim(v_txn->>'reference_number'),''), nullif(btrim(v_txn->>'category'),''), v_fingerprint, v_import_id);
      v_imported := v_imported + 1;
    exception when unique_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  update public.restaurant_bank_statement_imports set row_count = v_imported where id = v_import_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'bank_import.complete', 'restaurant_bank_statement_imports', v_import_id, null, jsonb_build_object('imported',v_imported,'skipped',v_skipped), jsonb_build_object('statement_hash',p_statement_hash));
  return jsonb_build_object('success', true, 'already_imported', false, 'imported', v_imported, 'skipped', v_skipped);
end;
$$;

create or replace function public.approve_bank_match(p_proposal_id uuid, p_lodge_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_proposal public.restaurant_match_proposals%rowtype; v_actor uuid := public.app_get_actor_user_id();
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin','super_admin','manager','finance']);
  select * into v_proposal from public.restaurant_match_proposals where id = p_proposal_id and lodge_id = p_lodge_id for update;
  if not found or v_proposal.status <> 'pending' then return jsonb_build_object('success',false,'error','Pending match proposal not found'); end if;
  if p_approve and v_proposal.proposed_by is not null and v_proposal.proposed_by = v_actor then return jsonb_build_object('success',false,'error','A different authorised user must approve a proposed match'); end if;
  update public.restaurant_match_proposals set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = v_actor, reviewed_at = now() where id = p_proposal_id;
  if p_approve then
    update public.restaurant_bank_transactions set reconciled_entry_id = v_proposal.journal_entry_id where id = v_proposal.bank_transaction_id and lodge_id = p_lodge_id and is_reconciled = false;
  end if;
  perform public.log_restaurant_financial_action(p_lodge_id, case when p_approve then 'bank_match.approve' else 'bank_match.reject' end, 'restaurant_match_proposals', p_proposal_id, to_jsonb(v_proposal), jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end), null);
  return jsonb_build_object('success',true,'status',case when p_approve then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.record_bill_payment(p_bill_id uuid, p_lodge_id uuid, p_payment_date date, p_amount numeric, p_payment_method text, p_reference text, p_notes text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bill public.restaurant_bills%rowtype; v_payment_id uuid := gen_random_uuid(); v_hash text; v_claim jsonb; v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin','super_admin','manager','finance']);
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('success',false,'error','Payment amount must be greater than zero'); end if;
  v_hash := md5(jsonb_build_object('bill_id',p_bill_id,'date',p_payment_date,'amount',p_amount,'method',p_payment_method,'reference',p_reference)::text);
  v_claim := public._claim_financial_operation(p_lodge_id, p_idempotency_key, 'restaurant_bill_payment', p_bill_id, v_hash);
  if (v_claim->>'success')::boolean is not true then return v_claim; end if;
  if (v_claim->>'found')::boolean then return coalesce(v_claim->'operation_result',v_claim); end if;
  select * into v_bill from public.restaurant_bills where id = p_bill_id and lodge_id = p_lodge_id for update;
  if not found or v_bill.status in ('draft','cancelled','paid') then return jsonb_build_object('success',false,'error','Bill is not payable'); end if;
  if p_amount > v_bill.total - v_bill.amount_paid then return jsonb_build_object('success',false,'error','Payment exceeds the outstanding balance'); end if;
  insert into public.restaurant_bill_payments(id,lodge_id,bill_id,payment_date,amount,payment_method,reference,notes,created_by) values(v_payment_id,p_lodge_id,p_bill_id,p_payment_date,p_amount,coalesce(nullif(btrim(p_payment_method),''),'bank_transfer'),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),public.app_get_actor_user_id());
  update public.restaurant_bills set amount_paid = amount_paid + p_amount, status = case when amount_paid + p_amount = total then 'paid' else 'partially_paid' end, updated_at = now() where id = p_bill_id;
  v_result := jsonb_build_object('success',true,'id',v_payment_id);
  perform public._record_financial_operation(p_lodge_id,p_idempotency_key,'restaurant_bill_payment',p_bill_id,v_hash,v_result);
  perform public.log_restaurant_financial_action(p_lodge_id,'ap_payment.record','restaurant_bill_payments',v_payment_id,null,jsonb_build_object('bill_id',p_bill_id,'amount',p_amount),null);
  return v_result;
end;
$$;

create or replace function public.create_bank_reconciliation(p_lodge_id uuid, p_bank_account_id uuid, p_statement_balance numeric, p_reconciliation_date date, p_transaction_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_account public.restaurant_bank_accounts%rowtype; v_id uuid; v_book_balance numeric; v_difference numeric; v_selected integer;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin','super_admin','manager','finance']);
  if p_statement_balance is null or p_reconciliation_date is null or coalesce(array_length(p_transaction_ids,1),0) = 0 then return jsonb_build_object('success',false,'error','Statement balance, reconciliation date, and selected transactions are required'); end if;
  select * into v_account from public.restaurant_bank_accounts where id = p_bank_account_id and lodge_id = p_lodge_id and is_active for update;
  if not found then return jsonb_build_object('success',false,'error','Active bank account not found'); end if;
  select count(*) into v_selected from public.restaurant_bank_transactions where lodge_id = p_lodge_id and bank_account_id = p_bank_account_id and id = any(p_transaction_ids) and not is_reconciled and reconciliation_id is null;
  if v_selected <> array_length(p_transaction_ids,1) then return jsonb_build_object('success',false,'error','One or more selected transactions are already assigned or reconciled'); end if;
  select coalesce(sum(jl.debit - jl.credit),0) + coalesce(v_account.opening_balance,0) into v_book_balance
  from public.restaurant_journal_entries je join public.restaurant_journal_lines jl on jl.entry_id = je.id
  where je.lodge_id = p_lodge_id and je.is_posted and je.entry_date <= p_reconciliation_date and jl.account_id = v_account.account_id;
  v_difference := p_statement_balance - v_book_balance;
  insert into public.restaurant_bank_reconciliations(lodge_id,bank_account_id,reconciliation_date,statement_balance,book_balance,difference,status,reconciled_by)
  values(p_lodge_id,p_bank_account_id,p_reconciliation_date,p_statement_balance,v_book_balance,v_difference,'draft',public.app_get_actor_user_id()) returning id into v_id;
  update public.restaurant_bank_transactions set reconciliation_id = v_id where id = any(p_transaction_ids) and lodge_id = p_lodge_id and bank_account_id = p_bank_account_id;
  return jsonb_build_object('success',true,'id',v_id,'book_balance',v_book_balance,'difference',v_difference);
end;
$$;

create or replace function public.complete_bank_reconciliation(p_id uuid, p_lodge_id uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_recon public.restaurant_bank_reconciliations%rowtype; v_open integer; v_count integer;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin','super_admin','manager','finance']);
  select * into v_recon from public.restaurant_bank_reconciliations where id = p_id and lodge_id = p_lodge_id for update;
  if not found or v_recon.status <> 'draft' then return jsonb_build_object('success',false,'error','Draft reconciliation not found'); end if;
  if v_recon.difference <> 0 then return jsonb_build_object('success',false,'error','Reconciliation difference must be zero before completion'); end if;
  select count(*) into v_count from public.restaurant_bank_transactions where reconciliation_id = p_id and lodge_id = p_lodge_id and not is_reconciled;
  if v_count = 0 then return jsonb_build_object('success',false,'error','No selected transactions are assigned to this reconciliation'); end if;
  select count(*) into v_open from public.restaurant_bank_transactions where lodge_id = p_lodge_id and bank_account_id = v_recon.bank_account_id and transaction_date <= v_recon.reconciliation_date and not is_reconciled and reconciliation_id is distinct from p_id;
  if v_open > 0 then return jsonb_build_object('success',false,'error','Earlier bank transactions remain unassigned or unreconciled'); end if;
  update public.restaurant_bank_transactions set is_reconciled = true where reconciliation_id = p_id and lodge_id = p_lodge_id;
  update public.restaurant_bank_accounts set current_balance = v_recon.book_balance, updated_at = now() where id = v_recon.bank_account_id;
  update public.restaurant_bank_reconciliations set status = 'completed', notes = nullif(btrim(p_notes),''), completed_at = now() where id = p_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_reconciliation.complete','restaurant_bank_reconciliations',p_id,to_jsonb(v_recon),jsonb_build_object('status','completed'),null);
  return jsonb_build_object('success',true,'new_balance',v_recon.book_balance);
end;
$$;
grant execute on function public.import_bank_statement(uuid, uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.create_bank_reconciliation(uuid, uuid, numeric, date, uuid[]) to authenticated, service_role;
grant execute on function public.complete_bank_reconciliation(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.approve_bank_match(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.record_bill_payment(uuid, uuid, date, numeric, text, text, text, text) to authenticated, service_role;

commit;