-- Bank-account setup and complete reconciliation read projection. Operator grants remain revoked.

begin;

create or replace function public.save_restaurant_bank_account_v2(
 p_lodge_id uuid,p_id uuid,p_account_id uuid,p_name text,p_bank_name text,p_account_number text,p_account_type text,p_is_active boolean default true
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid;v_before public.restaurant_bank_accounts%rowtype;v_after public.restaurant_bank_accounts%rowtype;v_id uuid;
begin
 v_actor:=public._restaurant_require_capability(p_lodge_id,'accounting.manage');
 if nullif(btrim(p_name),'')is null or nullif(btrim(p_account_number),'')is null or p_account_type not in('checking','savings','cash','mobile_money')then raise exception 'Bank name, account number, and valid account type are required' using errcode='22023';end if;
 if not exists(select 1 from public.restaurant_accounts where id=p_account_id and lodge_id=p_lodge_id and is_active and account_type='asset')then raise exception 'Bank GL account must be an active lodge asset' using errcode='23503';end if;
 if p_id is null then
  insert into public.restaurant_bank_accounts(lodge_id,account_id,name,bank_name,account_number,account_type,opening_balance,current_balance,is_active)
  values(p_lodge_id,p_account_id,btrim(p_name),nullif(btrim(p_bank_name),''),btrim(p_account_number),p_account_type,0,0,coalesce(p_is_active,true))returning * into v_after;
  v_id:=v_after.id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_account.created','restaurant_bank_accounts',v_id,null,to_jsonb(v_after),null);
 else
  select * into v_before from public.restaurant_bank_accounts where id=p_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Bank account not found' using errcode='P0002';end if;
  if v_before.account_id<>p_account_id and exists(select 1 from public.restaurant_bank_transactions where bank_account_id=p_id)then raise exception 'The GL account cannot change after statement evidence exists' using errcode='23514';end if;
  update public.restaurant_bank_accounts set account_id=p_account_id,name=btrim(p_name),bank_name=nullif(btrim(p_bank_name),''),account_number=btrim(p_account_number),account_type=p_account_type,is_active=coalesce(p_is_active,is_active),updated_at=now()where id=p_id returning * into v_after;
  v_id:=p_id;
  perform public.log_restaurant_financial_action(p_lodge_id,'bank_account.updated','restaurant_bank_accounts',v_id,to_jsonb(v_before),to_jsonb(v_after),null);
 end if;
 return jsonb_build_object('success',true,'data',to_jsonb(v_after));
end $$;

create or replace function public.get_restaurant_bank_workspace_v2(p_lodge_id uuid,p_bank_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
 if p_bank_account_id is not null and not exists(select 1 from public.restaurant_bank_accounts where id=p_bank_account_id and lodge_id=p_lodge_id)then raise exception 'Bank account belongs to another lodge or is missing' using errcode='23503';end if;
 return jsonb_build_object('success',true,'data',jsonb_build_object(
  'accounts',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('ledger_balance',coalesce((select round(sum(l.debit-l.credit),2)from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=a.account_id and e.lodge_id=p_lodge_id and e.is_posted),0))order by a.name)from public.restaurant_bank_accounts a where a.lodge_id=p_lodge_id),'[]'::jsonb),
  'imports',coalesce((select jsonb_agg(to_jsonb(i)-'raw_payload' order by i.period_end desc,i.imported_at desc)from public.restaurant_bank_statement_imports i where i.lodge_id=p_lodge_id and(p_bank_account_id is null or i.bank_account_id=p_bank_account_id)),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('proposal',coalesce((select to_jsonb(p)from public.restaurant_match_proposals p where p.bank_transaction_id=t.id order by p.created_at desc limit 1),'null'::jsonb))order by t.transaction_date desc,t.imported_at desc)from public.restaurant_bank_transactions t where t.lodge_id=p_lodge_id and(p_bank_account_id is null or t.bank_account_id=p_bank_account_id)),'[]'::jsonb),
  'reconciliations',coalesce((select jsonb_agg(to_jsonb(r)order by r.reconciliation_date desc,r.created_at desc)from public.restaurant_bank_reconciliations r where r.lodge_id=p_lodge_id and(p_bank_account_id is null or r.bank_account_id=p_bank_account_id)),'[]'::jsonb)
 ));
end $$;

revoke all on function public.save_restaurant_bank_account_v2(uuid,uuid,uuid,text,text,text,text,boolean)from public,anon,authenticated;
revoke all on function public.get_restaurant_bank_workspace_v2(uuid,uuid)from public,anon,authenticated;
grant execute on function public.save_restaurant_bank_account_v2(uuid,uuid,uuid,text,text,text,text,boolean)to service_role;
grant execute on function public.get_restaurant_bank_workspace_v2(uuid,uuid)to service_role;

commit;

