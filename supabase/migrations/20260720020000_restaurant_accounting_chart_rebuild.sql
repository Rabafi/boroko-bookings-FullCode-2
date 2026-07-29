-- Restaurant Accounting chart-of-accounts rebuild.
-- Operator execution remains revoked until the complete module passes release gates.

begin;

alter table public.restaurant_accounts
  add column if not exists cash_flow_classification text;

alter table public.restaurant_accounts
  drop constraint if exists restaurant_accounts_cash_flow_classification_chk;
alter table public.restaurant_accounts
  add constraint restaurant_accounts_cash_flow_classification_chk
  check (cash_flow_classification is null or cash_flow_classification in ('cash', 'operating', 'investing', 'financing'));

comment on column public.restaurant_accounts.opening_balance is
  'Deprecated display field. Authoritative opening balances are dated double-entry journals.';

create or replace function public.get_restaurant_accounts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');

  return jsonb_build_object(
    'success', true,
    'data', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'ledger_balance',
        case
          when a.account_type in ('asset', 'expense')
            then coalesce(x.debits, 0) - coalesce(x.credits, 0)
          else coalesce(x.credits, 0) - coalesce(x.debits, 0)
        end
      ) order by a.code)
      from public.restaurant_accounts a
      left join lateral (
        select sum(l.debit) as debits, sum(l.credit) as credits
        from public.restaurant_journal_lines l
        join public.restaurant_journal_entries e on e.id = l.entry_id
        where l.account_id = a.id
          and e.lodge_id = p_lodge_id
          and e.is_posted
      ) x on true
      where a.lodge_id = p_lodge_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_restaurant_account(
  p_lodge_id uuid,
  p_code text,
  p_name text,
  p_account_type text,
  p_parent_id uuid default null,
  p_opening_balance numeric default 0,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.manage');

  if nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null then
    raise exception 'Account code and name are required' using errcode = '22023';
  end if;
  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then
    raise exception 'Invalid account type' using errcode = '22023';
  end if;
  if coalesce(p_opening_balance, 0) <> 0 then
    raise exception 'Opening balances must be posted with post_restaurant_opening_balance'
      using errcode = '22023';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.restaurant_accounts
    where id = p_parent_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Parent account belongs to another lodge or does not exist'
      using errcode = '23503';
  end if;

  insert into public.restaurant_accounts(
    lodge_id, code, name, account_type, parent_id, opening_balance, description
  ) values (
    p_lodge_id, btrim(p_code), btrim(p_name), p_account_type, p_parent_id, 0,
    nullif(btrim(p_description), '')
  )
  returning id into v_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id, 'account_created', 'account', v_id, null,
    jsonb_build_object('code', btrim(p_code), 'name', btrim(p_name), 'account_type', p_account_type),
    null
  );

  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_id));
exception
  when unique_violation then
    raise exception 'Account code already exists for this lodge' using errcode = '23505';
end;
$$;

create or replace function public.update_restaurant_account(
  p_id uuid,
  p_lodge_id uuid,
  p_name text default null,
  p_description text default null,
  p_is_active boolean default null,
  p_opening_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.restaurant_accounts%rowtype;
  v_after public.restaurant_accounts%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.manage');

  if p_opening_balance is not null then
    raise exception 'Opening balances are immutable ledger postings, not account fields'
      using errcode = '22023';
  end if;

  select * into v_before from public.restaurant_accounts
  where id = p_id and lodge_id = p_lodge_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  update public.restaurant_accounts
  set name = coalesce(nullif(btrim(p_name), ''), name),
      description = case when p_description is null then description else nullif(btrim(p_description), '') end,
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
  where id = p_id
  returning * into v_after;

  perform public.log_restaurant_financial_action(
    p_lodge_id, 'account_updated', 'account', p_id, to_jsonb(v_before), to_jsonb(v_after), null
  );
  return jsonb_build_object('success', true, 'data', to_jsonb(v_after));
end;
$$;

create or replace function public.delete_restaurant_account(p_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.restaurant_accounts%rowtype;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_before from public.restaurant_accounts
  where id = p_id and lodge_id = p_lodge_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  update public.restaurant_accounts set is_active = false, updated_at = now()
  where id = p_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id, 'account_deactivated', 'account', p_id, to_jsonb(v_before),
    to_jsonb(v_before) || jsonb_build_object('is_active', false), null
  );
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.post_restaurant_opening_balance(
  p_lodge_id uuid,
  p_account_id uuid,
  p_equity_account_id uuid,
  p_entry_date date,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_account public.restaurant_accounts%rowtype;
  v_equity public.restaurant_accounts%rowtype;
  v_abs numeric(18,2);
  v_lines jsonb;
  v_debit_target boolean;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_entry_date is null or coalesce(p_amount, 0) = 0 then
    raise exception 'Opening date and non-zero amount are required' using errcode = '22023';
  end if;

  select * into v_account from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id and is_active;
  select * into v_equity from public.restaurant_accounts
  where id = p_equity_account_id and lodge_id = p_lodge_id and is_active and account_type = 'equity';
  if v_account.id is null or v_equity.id is null or v_account.id = v_equity.id then
    raise exception 'Opening and equity accounts must be distinct active lodge accounts'
      using errcode = '23503';
  end if;

  v_abs := abs(round(p_amount, 2));
  v_debit_target := (v_account.account_type in ('asset', 'expense') and p_amount > 0)
                 or (v_account.account_type in ('liability', 'equity', 'revenue') and p_amount < 0);

  v_lines := case when v_debit_target then
    jsonb_build_array(
      jsonb_build_object('account_id', v_account.id, 'debit', v_abs, 'credit', 0, 'memo', 'Opening balance'),
      jsonb_build_object('account_id', v_equity.id, 'debit', 0, 'credit', v_abs, 'memo', 'Opening balance contra')
    )
  else
    jsonb_build_array(
      jsonb_build_object('account_id', v_account.id, 'debit', 0, 'credit', v_abs, 'memo', 'Opening balance'),
      jsonb_build_object('account_id', v_equity.id, 'debit', v_abs, 'credit', 0, 'memo', 'Opening balance contra')
    )
  end;

  return public._restaurant_post_journal(
    p_lodge_id, p_entry_date, concat('Opening balance: ', v_account.name),
    'opening_balance', v_account.id, v_account.code, p_idempotency_key,
    v_lines, v_actor, null
  );
end;
$$;

create or replace function public.seed_restaurant_default_accounts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.manage');

  insert into public.restaurant_accounts(lodge_id, code, name, account_type, cash_flow_classification)
  values
    (p_lodge_id, '1000', 'Cash on Hand', 'asset', 'cash'),
    (p_lodge_id, '1020', 'Operating Bank', 'asset', 'cash'),
    (p_lodge_id, '1100', 'Accounts Receivable', 'asset', 'operating'),
    (p_lodge_id, '1200', 'Food Inventory', 'asset', 'operating'),
    (p_lodge_id, '1210', 'Beverage Inventory', 'asset', 'operating'),
    (p_lodge_id, '1500', 'Equipment', 'asset', 'investing'),
    (p_lodge_id, '2000', 'Accounts Payable', 'liability', 'operating'),
    (p_lodge_id, '2100', 'Tax Payable', 'liability', 'operating'),
    (p_lodge_id, '2200', 'PAYE Payable', 'liability', 'operating'),
    (p_lodge_id, '2300', 'Payroll Deductions Payable', 'liability', 'operating'),
    (p_lodge_id, '2400', 'Tips Payable', 'liability', 'operating'),
    (p_lodge_id, '3000', 'Owner Equity', 'equity', 'financing'),
    (p_lodge_id, '3100', 'Retained Earnings', 'equity', 'financing'),
    (p_lodge_id, '4000', 'Food Sales', 'revenue', 'operating'),
    (p_lodge_id, '4100', 'Beverage Sales', 'revenue', 'operating'),
    (p_lodge_id, '4200', 'Other Sales', 'revenue', 'operating'),
    (p_lodge_id, '4900', 'Discounts and Promotions', 'revenue', 'operating'),
    (p_lodge_id, '5000', 'Food Cost', 'expense', 'operating'),
    (p_lodge_id, '5100', 'Beverage Cost', 'expense', 'operating'),
    (p_lodge_id, '6000', 'Payroll Expense', 'expense', 'operating'),
    (p_lodge_id, '6100', 'Utilities Expense', 'expense', 'operating'),
    (p_lodge_id, '6200', 'Rent Expense', 'expense', 'operating'),
    (p_lodge_id, '6900', 'Other Operating Expense', 'expense', 'operating')
  on conflict (lodge_id, code) do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('success', true, 'data', jsonb_build_object('inserted', v_inserted));
end;
$$;

revoke all on function public.get_restaurant_accounts(uuid) from public, anon, authenticated;
revoke all on function public.create_restaurant_account(uuid, text, text, text, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.update_restaurant_account(uuid, uuid, text, text, boolean, numeric) from public, anon, authenticated;
revoke all on function public.delete_restaurant_account(uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_restaurant_opening_balance(uuid, uuid, uuid, date, numeric, text) from public, anon, authenticated;
revoke all on function public.seed_restaurant_default_accounts(uuid) from public, anon, authenticated;

grant execute on function public.get_restaurant_accounts(uuid) to service_role;
grant execute on function public.create_restaurant_account(uuid, text, text, text, uuid, numeric, text) to service_role;
grant execute on function public.update_restaurant_account(uuid, uuid, text, text, boolean, numeric) to service_role;
grant execute on function public.delete_restaurant_account(uuid, uuid) to service_role;
grant execute on function public.post_restaurant_opening_balance(uuid, uuid, uuid, date, numeric, text) to service_role;
grant execute on function public.seed_restaurant_default_accounts(uuid) to service_role;

commit;
