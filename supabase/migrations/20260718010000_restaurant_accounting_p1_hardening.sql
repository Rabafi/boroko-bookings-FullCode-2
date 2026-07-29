begin;

-- ══════════════════════════════════════════════════════════════
-- 1. Immutable Financial Audit Log
-- ══════════════════════════════════════════════════════════════

create table if not exists public.restaurant_financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  actor_user_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.restaurant_financial_audit_log enable row level security;

create policy restaurant_financial_audit_log_lodge_scope_select on public.restaurant_financial_audit_log
  for select using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_financial_audit_log_lodge_action_idx
  on public.restaurant_financial_audit_log(lodge_id, action, created_at);

create index if not exists restaurant_financial_audit_log_lodge_entity_idx
  on public.restaurant_financial_audit_log(lodge_id, entity_type, entity_id);

create or replace function public.log_restaurant_financial_action(
  p_lodge_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_data jsonb default null,
  p_new_data jsonb default null,
  p_metadata jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();

  insert into public.restaurant_financial_audit_log (
    lodge_id, actor_user_id, action, entity_type, entity_id,
    old_data, new_data, metadata
  ) values (
    p_lodge_id, v_actor_id, p_action, p_entity_type, p_entity_id,
    p_old_data, p_new_data, p_metadata
  );
end;
$$;

grant execute on function public.log_restaurant_financial_action(uuid, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. RLS Lockdown — drop INSERT/UPDATE/DELETE policies
--    on all 19 restaurant accounting tables
-- ══════════════════════════════════════════════════════════════

-- restaurant_accounts (migration 01)
drop policy if exists restaurant_accounts_lodge_scope_insert on public.restaurant_accounts;
drop policy if exists restaurant_accounts_lodge_scope_update on public.restaurant_accounts;
drop policy if exists restaurant_accounts_lodge_scope_delete on public.restaurant_accounts;

-- restaurant_journal_entries (migration 02)
drop policy if exists restaurant_journal_entries_lodge_scope_insert on public.restaurant_journal_entries;
drop policy if exists restaurant_journal_entries_lodge_scope_update on public.restaurant_journal_entries;
drop policy if exists restaurant_journal_entries_lodge_scope_delete on public.restaurant_journal_entries;

-- restaurant_journal_lines (migration 02) — parent-join variants
drop policy if exists restaurant_journal_lines_lodge_scope_insert on public.restaurant_journal_lines;
drop policy if exists restaurant_journal_lines_lodge_scope_delete on public.restaurant_journal_lines;

-- restaurant_bank_accounts (migration 03)
drop policy if exists restaurant_bank_accounts_lodge_scope_insert on public.restaurant_bank_accounts;
drop policy if exists restaurant_bank_accounts_lodge_scope_update on public.restaurant_bank_accounts;
drop policy if exists restaurant_bank_accounts_lodge_scope_delete on public.restaurant_bank_accounts;

-- restaurant_bank_transactions (migration 03)
drop policy if exists restaurant_bank_transactions_lodge_scope_insert on public.restaurant_bank_transactions;
drop policy if exists restaurant_bank_transactions_lodge_scope_update on public.restaurant_bank_transactions;
drop policy if exists restaurant_bank_transactions_lodge_scope_delete on public.restaurant_bank_transactions;

-- restaurant_bank_reconciliations (migration 03)
drop policy if exists restaurant_bank_reconciliations_lodge_scope_insert on public.restaurant_bank_reconciliations;
drop policy if exists restaurant_bank_reconciliations_lodge_scope_update on public.restaurant_bank_reconciliations;
drop policy if exists restaurant_bank_reconciliations_lodge_scope_delete on public.restaurant_bank_reconciliations;

-- restaurant_bills (migration 04)
drop policy if exists restaurant_bills_lodge_scope_insert on public.restaurant_bills;
drop policy if exists restaurant_bills_lodge_scope_update on public.restaurant_bills;
drop policy if exists restaurant_bills_lodge_scope_delete on public.restaurant_bills;

-- restaurant_bill_items (migration 04)
drop policy if exists restaurant_bill_items_lodge_scope_insert on public.restaurant_bill_items;
drop policy if exists restaurant_bill_items_lodge_scope_update on public.restaurant_bill_items;
drop policy if exists restaurant_bill_items_lodge_scope_delete on public.restaurant_bill_items;

-- restaurant_bill_payments (migration 04)
drop policy if exists restaurant_bill_payments_lodge_scope_insert on public.restaurant_bill_payments;
drop policy if exists restaurant_bill_payments_lodge_scope_update on public.restaurant_bill_payments;
drop policy if exists restaurant_bill_payments_lodge_scope_delete on public.restaurant_bill_payments;

-- restaurant_tax_returns (migration 05)
drop policy if exists restaurant_tax_returns_lodge_scope_insert on public.restaurant_tax_returns;
drop policy if exists restaurant_tax_returns_lodge_scope_update on public.restaurant_tax_returns;
drop policy if exists restaurant_tax_returns_lodge_scope_delete on public.restaurant_tax_returns;

-- restaurant_budgets (migration 06)
drop policy if exists restaurant_budgets_lodge_scope_insert on public.restaurant_budgets;
drop policy if exists restaurant_budgets_lodge_scope_update on public.restaurant_budgets;
drop policy if exists restaurant_budgets_lodge_scope_delete on public.restaurant_budgets;

-- restaurant_budget_templates (migration 06)
drop policy if exists restaurant_budget_templates_lodge_scope_insert on public.restaurant_budget_templates;
drop policy if exists restaurant_budget_templates_lodge_scope_update on public.restaurant_budget_templates;
drop policy if exists restaurant_budget_templates_lodge_scope_delete on public.restaurant_budget_templates;

-- restaurant_budget_template_lines (migration 06) — parent-join variants
drop policy if exists restaurant_budget_template_lines_lodge_scope_insert on public.restaurant_budget_template_lines;
drop policy if exists restaurant_budget_template_lines_lodge_scope_update on public.restaurant_budget_template_lines;
drop policy if exists restaurant_budget_template_lines_lodge_scope_delete on public.restaurant_budget_template_lines;

-- restaurant_pay_periods (migration 08)
drop policy if exists restaurant_pay_periods_lodge_scope_insert on public.restaurant_pay_periods;
drop policy if exists restaurant_pay_periods_lodge_scope_update on public.restaurant_pay_periods;
drop policy if exists restaurant_pay_periods_lodge_scope_delete on public.restaurant_pay_periods;

-- restaurant_employee_pay_records (migration 08)
drop policy if exists restaurant_employee_pay_records_lodge_scope_insert on public.restaurant_employee_pay_records;
drop policy if exists restaurant_employee_pay_records_lodge_scope_update on public.restaurant_employee_pay_records;
drop policy if exists restaurant_employee_pay_records_lodge_scope_delete on public.restaurant_employee_pay_records;

-- restaurant_payroll_settings (migration 08)
drop policy if exists restaurant_payroll_settings_lodge_scope_insert on public.restaurant_payroll_settings;
drop policy if exists restaurant_payroll_settings_lodge_scope_update on public.restaurant_payroll_settings;
drop policy if exists restaurant_payroll_settings_lodge_scope_delete on public.restaurant_payroll_settings;

-- restaurant_payroll_payments (migration 08)
drop policy if exists restaurant_payroll_payments_lodge_scope_insert on public.restaurant_payroll_payments;
drop policy if exists restaurant_payroll_payments_lodge_scope_update on public.restaurant_payroll_payments;
drop policy if exists restaurant_payroll_payments_lodge_scope_delete on public.restaurant_payroll_payments;

-- ══════════════════════════════════════════════════════════════
-- 3. Timezone Fix for GL — replace hardcoded Africa/Gaborone
-- ══════════════════════════════════════════════════════════════

create or replace function public.post_pos_sales_to_gl(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_timezone text;
  v_day record;
  v_entry_id uuid;
  v_entries_posted integer := 0;
  v_account_bank uuid;
  v_account_cash uuid;
  v_account_revenue_food uuid;
  v_account_revenue_beverage uuid;
  v_account_vat uuid;
  v_account_tips_payable uuid;
  v_total_cash numeric;
  v_total_card numeric;
  v_total_mobile numeric;
  v_total_revenue numeric;
  v_total_tax numeric;
  v_total_discount numeric;
  v_total_tips numeric;
  v_lines jsonb;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_split jsonb;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select coalesce(timezone, 'Africa/Gaborone')
    into v_timezone
  from public.settings
  where lodge_id = p_lodge_id
  limit 1;

  select id into v_account_bank from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1020' and is_active = true limit 1;
  select id into v_account_cash from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1000' and is_active = true limit 1;
  select id into v_account_revenue_food from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '4000' and is_active = true limit 1;
  select id into v_account_revenue_beverage from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '4100' and is_active = true limit 1;
  select id into v_account_vat from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '2100' and is_active = true limit 1;
  select id into v_account_tips_payable from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '2400' and is_active = true limit 1;

  if v_account_revenue_food is null then
    return jsonb_build_object('success', false, 'error', 'Revenue account (4000) not found. Seed chart of accounts first.');
  end if;

  for v_day in
    select
      (o.created_at at time zone v_timezone)::date as business_date,
      sum(case
        when jsonb_typeof(o.payment_breakdown) = 'array' and jsonb_array_length(o.payment_breakdown) > 0 then
          coalesce((select sum(coalesce((e.value->>'amount')::numeric, 0))
            from jsonb_array_elements(o.payment_breakdown) e
            where e.value->>'method' in ('cash')), 0)
        else
          case when o.payment_method = 'cash' then o.total else 0 end
      end) as cash_total,
      sum(case
        when jsonb_typeof(o.payment_breakdown) = 'array' and jsonb_array_length(o.payment_breakdown) > 0 then
          coalesce((select sum(coalesce((e.value->>'amount')::numeric, 0))
            from jsonb_array_elements(o.payment_breakdown) e
            where e.value->>'method' in ('card','card_machine','snapscan')), 0)
        else
          case when o.payment_method in ('card','card_machine','snapscan') then o.total else 0 end
      end) as card_total,
      sum(case
        when jsonb_typeof(o.payment_breakdown) = 'array' and jsonb_array_length(o.payment_breakdown) > 0 then
          coalesce((select sum(coalesce((e.value->>'amount')::numeric, 0))
            from jsonb_array_elements(o.payment_breakdown) e
            where e.value->>'method' in ('mobile','eft','transfer','debit_order')), 0)
        else
          case when o.payment_method in ('mobile','eft','transfer','debit_order') then o.total else 0 end
      end) as mobile_total,
      sum(coalesce(nullif(o.gross_total, 0), o.total) - o.discount_total) as total_revenue,
      sum(o.tax_total) as total_tax,
      sum(o.discount_total) as total_discount,
      sum(coalesce(o.tip_total, 0)) as total_tips,
      jsonb_agg(o.id) as order_ids
    from public.pos_orders o
    where o.lodge_id = p_lodge_id
      and (o.created_at at time zone v_timezone)::date >= p_start_date
      and (o.created_at at time zone v_timezone)::date <= p_end_date
      and o.status in ('completed', 'settled')
      and coalesce(o.transaction_type, 'sale') = 'sale'
    group by (o.created_at at time zone v_timezone)::date
    having not exists (
      select 1 from public.restaurant_journal_entries je
      where je.lodge_id = p_lodge_id
        and je.source_type = 'pos_sale'
        and je.entry_date = (o.created_at at time zone v_timezone)::date
    )
    order by business_date
  loop
    v_total_cash := coalesce(v_day.cash_total, 0);
    v_total_card := coalesce(v_day.card_total, 0);
    v_total_mobile := coalesce(v_day.mobile_total, 0);
    v_total_revenue := coalesce(v_day.total_revenue, 0);
    v_total_tax := coalesce(v_day.total_tax, 0);
    v_total_discount := coalesce(v_day.total_discount, 0);
    v_total_tips := coalesce(v_day.total_tips, 0);

    if (v_total_cash + v_total_card + v_total_mobile) = 0 then
      continue;
    end if;

    v_lines := '[]'::jsonb;

    if v_total_cash > 0 and v_account_cash is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_cash, 'debit', v_total_cash, 'credit', 0, 'memo', 'Cash sales - ' || v_day.business_date);
    end if;

    if v_total_card > 0 and v_account_bank is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_bank, 'debit', v_total_card, 'credit', 0, 'memo', 'Card sales - ' || v_day.business_date);
    end if;

    if v_total_mobile > 0 and v_account_bank is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_bank, 'debit', v_total_mobile, 'credit', 0, 'memo', 'Mobile/EFT sales - ' || v_day.business_date);
    end if;

    v_lines := v_lines || jsonb_build_object('account_id', v_account_revenue_food, 'debit', 0, 'credit', v_total_revenue, 'memo', 'Sales revenue - ' || v_day.business_date);

    if v_total_tax > 0 and v_account_vat is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_vat, 'debit', 0, 'credit', v_total_tax, 'memo', 'VAT payable - ' || v_day.business_date);
    end if;

    if v_total_tips > 0 and v_account_tips_payable is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_tips_payable, 'debit', 0, 'credit', v_total_tips, 'memo', 'Tips payable - ' || v_day.business_date);
    end if;

    v_total_debit := 0;
    v_total_credit := 0;
    for v_line in select * from jsonb_array_elements(v_lines)
    loop
      v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
      v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    end loop;

    if v_total_debit <> v_total_credit then
      return jsonb_build_object('success', false, 'error', 'Journal not balanced for ' || v_day.business_date || ': debit ' || v_total_debit || ' != credit ' || v_total_credit);
    end if;

    if v_total_debit = 0 then
      continue;
    end if;

    insert into public.restaurant_journal_entries (
      lodge_id, entry_date, description, source_type, source_id, reference_number, created_by
    ) values (
      p_lodge_id, v_day.business_date,
      'POS sales batch - ' || v_day.business_date || ' (' || jsonb_array_length(v_day.order_ids) || ' orders)',
      'pos_sale', (v_day.order_ids->>0)::uuid,
      'PSB-' || to_char(v_day.business_date, 'YYYYMMDD') || '-' || jsonb_array_length(v_day.order_ids),
      v_actor_id
    ) returning id into v_entry_id;

    for v_line in select * from jsonb_array_elements(v_lines)
    loop
      insert into public.restaurant_journal_lines (
        entry_id, account_id, debit, credit, memo
      ) values (
        v_entry_id,
        (v_line->>'account_id')::uuid,
        coalesce((v_line->>'debit')::numeric, 0),
        coalesce((v_line->>'credit')::numeric, 0),
        v_line->>'memo'
      );
    end loop;

    v_entries_posted := v_entries_posted + 1;
  end loop;

  return jsonb_build_object('success', true, 'data', jsonb_build_object('entries_posted', v_entries_posted));
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. Timezone Fix for Tax Returns
-- ══════════════════════════════════════════════════════════════

create or replace function public.generate_tax_return(
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_rate numeric default 14
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_timezone text;
  v_existing_status text;
  v_sales_rec record;
  v_purchase_rec record;
  v_total_sales_incl numeric := 0;
  v_total_sales_excl numeric := 0;
  v_total_tax_collected numeric := 0;
  v_total_purchases_incl numeric := 0;
  v_total_purchases_excl numeric := 0;
  v_total_input_tax numeric := 0;
  v_net_tax_payable numeric := 0;
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['finance', 'manager', 'admin', 'super_admin']);

  select coalesce(timezone, 'Africa/Gaborone')
    into v_timezone
  from public.settings
  where lodge_id = p_lodge_id
  limit 1;

  select status into v_existing_status
    from public.restaurant_tax_returns
   where lodge_id = p_lodge_id
     and period_start = p_period_start
     and period_end = p_period_end;

  if v_existing_status in ('submitted', 'filed') then
    return jsonb_build_object(
      'success', false,
      'error', 'Cannot regenerate a ' || v_existing_status || ' tax return'
    );
  end if;

  select
    coalesce(sum(tax_total), 0) as tax_collected,
    coalesce(sum(
      case when gross_total > 0
        then greatest(gross_total - discount_total, 0)
        else 0
      end
    ), 0) as sales_excl,
    coalesce(sum(
      case when gross_total > 0
        then greatest(gross_total - discount_total, 0) + tax_total
        else 0
      end
    ), 0) as sales_incl
  into v_sales_rec
  from public.pos_orders
  where lodge_id = p_lodge_id
    and coalesce(status, 'open') not in ('voided', 'cancelled')
    and coalesce(transaction_type, 'sale') != 'return'
    and (created_at at time zone v_timezone)::date >= p_period_start
    and (created_at at time zone v_timezone)::date <= p_period_end;

  v_total_tax_collected := coalesce(v_sales_rec.tax_collected, 0);
  v_total_sales_excl := coalesce(v_sales_rec.sales_excl, 0);
  v_total_sales_incl := coalesce(v_sales_rec.sales_incl, 0);

  select
    coalesce(sum(amount), 0) as total_amount,
    coalesce(sum(round(amount * p_tax_rate / (100 + p_tax_rate), 2)), 0) as input_tax,
    coalesce(sum(amount - round(amount * p_tax_rate / (100 + p_tax_rate), 2)), 0) as purchases_excl
  into v_purchase_rec
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= p_period_start
    and date <= p_period_end;

  v_total_purchases_incl := coalesce(v_purchase_rec.total_amount, 0);
  v_total_input_tax := coalesce(v_purchase_rec.input_tax, 0);
  v_total_purchases_excl := coalesce(v_purchase_rec.purchases_excl, 0);

  v_net_tax_payable := round(v_total_tax_collected - v_total_input_tax, 2);

  insert into public.restaurant_tax_returns (
    lodge_id, period_start, period_end, tax_rate,
    total_sales_incl, total_sales_excl, total_tax_collected,
    total_purchases_incl, total_purchases_excl, total_input_tax,
    net_tax_payable, status, updated_at
  ) values (
    p_lodge_id, p_period_start, p_period_end, p_tax_rate,
    v_total_sales_incl, v_total_sales_excl, v_total_tax_collected,
    v_total_purchases_incl, v_total_purchases_excl, v_total_input_tax,
    v_net_tax_payable, 'draft', now()
  )
  on conflict (lodge_id, period_start, period_end) do update set
    tax_rate = excluded.tax_rate,
    total_sales_incl = excluded.total_sales_incl,
    total_sales_excl = excluded.total_sales_excl,
    total_tax_collected = excluded.total_tax_collected,
    total_purchases_incl = excluded.total_purchases_incl,
    total_purchases_excl = excluded.total_purchases_excl,
    total_input_tax = excluded.total_input_tax,
    net_tax_payable = excluded.net_tax_payable,
    status = 'draft',
    filed_at = null,
    updated_at = now();

  select row_to_json(tr) into v_result
    from public.restaurant_tax_returns tr
   where tr.lodge_id = p_lodge_id
     and tr.period_start = p_period_start
     and tr.period_end = p_period_end;

  return jsonb_build_object('success', true, 'tax_return', v_result);
end;
$$;

grant execute on function public.generate_tax_return(uuid, date, date, numeric) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. Timezone Fix for Payroll — calculate_payroll
-- ══════════════════════════════════════════════════════════════

create or replace function public.calculate_payroll(
  p_pay_period_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_timezone text;
  v_period record;
  v_settings record;
  v_staff record;
  v_shift record;
  v_hours numeric;
  v_ot_hours numeric;
  v_gross numeric;
  v_taxable numeric;
  v_paye numeric;
  v_ss numeric;
  v_pension numeric;
  v_hi numeric;
  v_total_ded numeric;
  v_net numeric;
  v_record_count integer := 0;
  v_total_gross numeric := 0;
  v_total_deductions numeric := 0;
  v_total_net numeric := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select coalesce(timezone, 'Africa/Gaborone')
    into v_timezone
  from public.settings
  where lodge_id = p_lodge_id
  limit 1;

  select * into v_period
  from public.restaurant_pay_periods
  where id = p_pay_period_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Pay period not found');
  end if;

  if v_period.status not in ('draft', 'processing') then
    return jsonb_build_object('success', false, 'error', 'Pay period is ' || v_period.status || ' and cannot be recalculated');
  end if;

  select * into v_settings
  from public.restaurant_payroll_settings
  where lodge_id = p_lodge_id;

  if not found then
    insert into public.restaurant_payroll_settings (lodge_id) values (p_lodge_id)
    returning * into v_settings;
  end if;

  update public.restaurant_pay_periods set status = 'processing', processed_at = now()
  where id = p_pay_period_id;

  for v_staff in
    select u.id as user_id, u.name as staff_name, coalesce(u.hourly_rate, 0) as hourly_rate
    from public.users u
    where u.lodge_id = p_lodge_id and coalesce(u.status, 'active') = 'active'
  loop
    select
      coalesce(sum(s.actual_hours), 0),
      coalesce(sum(
        case when s.actual_hours > coalesce(s.expected_hours, 8)
          then s.actual_hours - coalesce(s.expected_hours, 8)
          else 0 end
      ), 0)
    into v_hours, v_ot_hours
    from public.restaurant_shifts s
    where s.lodge_id = p_lodge_id
      and s.staff_user_id = v_staff.user_id
      and (s.clock_in at time zone v_timezone)::date between v_period.start_date and v_period.end_date
      and s.status = 'completed';

    v_gross := (v_hours * v_staff.hourly_rate) + (v_ot_hours * v_staff.hourly_rate * 1.5);

    v_taxable := greatest(v_gross - v_settings.paye_threshold, 0);
    v_paye := 0;

    if v_taxable > 0 then
      v_paye := v_paye + (least(v_taxable, v_settings.paye_rate_1_threshold) * v_settings.paye_rate_1 / 100);
    end if;

    if v_taxable > v_settings.paye_rate_1_threshold then
      v_paye := v_paye + (least(v_taxable - v_settings.paye_rate_1_threshold, v_settings.paye_rate_2_threshold - v_settings.paye_rate_1_threshold) * v_settings.paye_rate_2 / 100);
    end if;

    if v_taxable > v_settings.paye_rate_2_threshold then
      v_paye := v_paye + (least(v_taxable - v_settings.paye_rate_2_threshold, v_settings.paye_rate_3_threshold - v_settings.paye_rate_2_threshold) * v_settings.paye_rate_3 / 100);
    end if;

    if v_taxable > v_settings.paye_rate_3_threshold then
      v_paye := v_paye + ((v_taxable - v_settings.paye_rate_3_threshold) * v_settings.paye_rate_4 / 100);
    end if;

    v_ss := v_gross * v_settings.social_security_rate / 100;
    v_pension := v_gross * v_settings.pension_rate / 100;
    v_hi := v_settings.health_insurance_amount;
    v_total_ded := v_paye + v_ss + v_pension + v_hi;
    v_net := greatest(v_gross - v_total_ded, 0);

    insert into public.restaurant_employee_pay_records (
      lodge_id, staff_user_id, staff_name, pay_period_id,
      hourly_rate, hours_worked, overtime_hours, overtime_rate,
      gross_pay, paye_tax, social_security, pension_contribution,
      health_insurance, total_deductions, net_pay
    ) values (
      p_lodge_id, v_staff.user_id, v_staff.staff_name, p_pay_period_id,
      v_staff.hourly_rate, v_hours, v_ot_hours, v_staff.hourly_rate,
      v_gross, v_paye, v_ss, v_pension, v_hi, v_total_ded, v_net
    )
    on conflict (lodge_id, staff_user_id, pay_period_id) do update set
      staff_name = excluded.staff_name,
      hourly_rate = excluded.hourly_rate,
      hours_worked = excluded.hours_worked,
      overtime_hours = excluded.overtime_hours,
      overtime_rate = excluded.overtime_rate,
      gross_pay = excluded.gross_pay,
      paye_tax = excluded.paye_tax,
      social_security = excluded.social_security,
      pension_contribution = excluded.pension_contribution,
      health_insurance = excluded.health_insurance,
      total_deductions = excluded.total_deductions,
      net_pay = excluded.net_pay,
      updated_at = now();

    v_record_count := v_record_count + 1;
    v_total_gross := v_total_gross + v_gross;
    v_total_deductions := v_total_deductions + v_total_ded;
    v_total_net := v_total_net + v_net;
  end loop;

  return jsonb_build_object(
    'success', true,
    'records_processed', v_record_count,
    'total_gross', v_total_gross,
    'total_deductions', v_total_deductions,
    'total_net', v_total_net
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. Bank Import Hardening
-- ══════════════════════════════════════════════════════════════

-- 6a. Statement imports tracking table
create table if not exists public.restaurant_bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_account_id uuid not null references public.restaurant_bank_accounts(id) on delete cascade,
  statement_hash text not null,
  file_name text,
  row_count integer not null default 0,
  imported_by uuid references public.users(id),
  imported_at timestamptz not null default now()
);

alter table public.restaurant_bank_statement_imports enable row level security;

create policy restaurant_bank_statement_imports_lodge_scope_select on public.restaurant_bank_statement_imports
  for select using (public.app_lodge_access(lodge_id));

create unique index if not exists restaurant_bank_statement_imports_account_hash_uidx
  on public.restaurant_bank_statement_imports(bank_account_id, statement_hash);

-- 6b. Fingerprint column on bank transactions
alter table public.restaurant_bank_transactions add column if not exists fingerprint text;

-- 6c. Hardened import_bank_statement
create or replace function public.import_bank_statement(
  p_lodge_id uuid,
  p_bank_account_id uuid,
  p_transactions jsonb,
  p_statement_hash text,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_count integer;
  v_skipped integer := 0;
  v_txn jsonb;
  v_fingerprint text;
  v_import_id uuid;
  v_existing boolean;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_statement_hash is null or trim(p_statement_hash) = '' then
    return jsonb_build_object('success', false, 'error', 'Statement hash is required for idempotent imports');
  end if;

  if not exists (
    select 1 from public.restaurant_bank_accounts
    where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  if p_transactions is null or jsonb_array_length(p_transactions) = 0 then
    return jsonb_build_object('success', false, 'error', 'No transactions provided');
  end if;

  select exists(
    select 1 from public.restaurant_bank_statement_imports
    where bank_account_id = p_bank_account_id and statement_hash = p_statement_hash
  ) into v_existing;

  if v_existing then
    return jsonb_build_object('success', true, 'already_imported', true, 'imported', 0, 'skipped', 0);
  end if;

  insert into public.restaurant_bank_statement_imports (
    lodge_id, bank_account_id, statement_hash, file_name, row_count, imported_by
  ) values (
    p_lodge_id, p_bank_account_id, p_statement_hash, p_file_name, 0, v_actor_id
  ) returning id into v_import_id;

  v_count := 0;

  for v_txn in select jsonb_array_elements(p_transactions)
  loop
    v_fingerprint := md5(
      coalesce((v_txn ->> 'transaction_date'), '') ||
      coalesce(v_txn ->> 'description', '') ||
      coalesce((v_txn ->> 'debit'), '0') ||
      coalesce((v_txn ->> 'credit'), '0') ||
      coalesce(v_txn ->> 'reference_number', '')
    );

    if exists (
      select 1 from public.restaurant_bank_transactions
      where bank_account_id = p_bank_account_id
        and fingerprint = v_fingerprint
    ) then
      v_skipped := v_skipped + 1;

      perform public.log_restaurant_financial_action(
        p_lodge_id,
        'bank_import.duplicate_skip',
        'restaurant_bank_transactions',
        null,
        null,
        jsonb_build_object(
          'fingerprint', v_fingerprint,
          'transaction_date', v_txn ->> 'transaction_date',
          'description', v_txn ->> 'description'
        ),
        jsonb_build_object('statement_hash', p_statement_hash, 'import_id', v_import_id)
      );

      continue;
    end if;

    insert into public.restaurant_bank_transactions (
      lodge_id, bank_account_id, transaction_date, description, debit, credit,
      balance_after, reference_number, category, fingerprint
    ) values (
      p_lodge_id,
      p_bank_account_id,
      (v_txn ->> 'transaction_date')::date,
      v_txn ->> 'description',
      coalesce((v_txn ->> 'debit')::numeric, 0),
      coalesce((v_txn ->> 'credit')::numeric, 0),
      nullif((v_txn ->> 'balance_after'), '')::numeric,
      nullif(v_txn ->> 'reference_number', ''),
      nullif(v_txn ->> 'category', ''),
      v_fingerprint
    );

    v_count := v_count + 1;
  end loop;

  update public.restaurant_bank_statement_imports
  set row_count = v_count
  where id = v_import_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id,
    'bank_import.complete',
    'restaurant_bank_statement_imports',
    v_import_id,
    null,
    jsonb_build_object(
      'bank_account_id', p_bank_account_id,
      'statement_hash', p_statement_hash,
      'imported_count', v_count,
      'skipped_count', v_skipped,
      'file_name', p_file_name
    ),
    null
  );

  return jsonb_build_object(
    'success', true,
    'imported', v_count,
    'skipped', v_skipped,
    'already_imported', false
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- 7. Reconciliation Workflow Fix
-- ══════════════════════════════════════════════════════════════

-- 7a. Match proposals table
create table if not exists public.restaurant_match_proposals (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_account_id uuid not null references public.restaurant_bank_accounts(id) on delete cascade,
  bank_transaction_id uuid not null references public.restaurant_bank_transactions(id) on delete cascade,
  journal_entry_id uuid references public.restaurant_journal_entries(id) on delete set null,
  confidence numeric(5,4) not null default 0,
  proposed_by uuid references public.users(id),
  proposed_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz
);

alter table public.restaurant_match_proposals enable row level security;

create policy restaurant_match_proposals_lodge_scope_select on public.restaurant_match_proposals
  for select using (public.app_lodge_access(lodge_id));

create unique index if not exists restaurant_match_proposals_pending_uidx
  on public.restaurant_match_proposals(bank_transaction_id)
  where status != 'rejected';

-- 7b. propose_bank_matches (replaces auto_match_transactions)
create or replace function public.propose_bank_matches(
  p_lodge_id uuid,
  p_bank_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_proposal_count integer := 0;
  v_match record;
  v_confidence numeric;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if not exists (
    select 1 from public.restaurant_bank_accounts
    where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  for v_match in
    select
      bt.id as bt_id,
      je.id as je_id,
      je.entry_date,
      je.description,
      abs(
        case
          when bt.debit > 0 then bt.debit - jl.credit
          when bt.credit > 0 then bt.credit - jl.debit
          else 0
        end
      ) as amount_diff,
      case
        when bt.transaction_date = je.entry_date then 1.0
        when abs(extract(day from bt.transaction_date - je.entry_date)) <= 1 then 0.9
        when abs(extract(day from bt.transaction_date - je.entry_date)) <= 3 then 0.7
        else 0.5
      end as date_confidence
    from public.restaurant_bank_transactions bt
    join public.restaurant_bank_accounts ba on ba.id = bt.bank_account_id
    join public.restaurant_accounts ra on ra.id = ba.account_id
    join public.restaurant_journal_lines jl on jl.account_id = ra.id
    join public.restaurant_journal_entries je on je.id = jl.entry_id
    where bt.lodge_id = p_lodge_id
      and bt.bank_account_id = p_bank_account_id
      and bt.is_reconciled = false
      and je.lodge_id = p_lodge_id
      and bt.transaction_date between (je.entry_date - interval '3 days') and (je.entry_date + interval '3 days')
      and (
        (bt.debit > 0 and jl.credit = bt.debit and jl.debit = 0)
        or
        (bt.credit > 0 and jl.debit = bt.credit and jl.credit = 0)
      )
      and not exists (
        select 1 from public.restaurant_match_proposals mp
        where mp.bank_transaction_id = bt.id
          and mp.status in ('pending', 'approved')
      )
  loop
    v_confidence := v_match.date_confidence *
      case
        when v_match.amount_diff = 0 then 1.0
        when v_match.amount_diff < 1 then 0.95
        when v_match.amount_diff < 10 then 0.8
        when v_match.amount_diff < 100 then 0.6
        else 0.3
      end;

    insert into public.restaurant_match_proposals (
      lodge_id, bank_account_id, bank_transaction_id, journal_entry_id,
      confidence, proposed_by
    ) values (
      p_lodge_id, p_bank_account_id, v_match.bt_id, v_match.je_id,
      v_confidence, v_actor_id
    );

    v_proposal_count := v_proposal_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'proposed', v_proposal_count,
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mp.id,
        'bank_transaction_id', mp.bank_transaction_id,
        'journal_entry_id', mp.journal_entry_id,
        'confidence', mp.confidence,
        'status', mp.status
      ) order by mp.confidence desc), '[]'::jsonb)
      from public.restaurant_match_proposals mp
      where mp.bank_account_id = p_bank_account_id
        and mp.status = 'pending'
    )
  );
end;
$$;

-- 7c. approve_bank_match (new)
create or replace function public.approve_bank_match(
  p_proposal_id uuid,
  p_lodge_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_proposal record;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_proposal
  from public.restaurant_match_proposals
  where id = p_proposal_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Match proposal not found');
  end if;

  if v_proposal.status != 'pending' then
    return jsonb_build_object('success', false, 'error', 'Proposal is not in pending status (current: ' || v_proposal.status || ')');
  end if;

  if p_approve then
    update public.restaurant_match_proposals
    set status = 'approved',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = p_proposal_id;

    update public.restaurant_bank_transactions
    set is_reconciled = true,
        reconciled_entry_id = v_proposal.journal_entry_id
    where id = v_proposal.bank_transaction_id
      and is_reconciled = false;

    perform public.log_restaurant_financial_action(
      p_lodge_id,
      'bank_match.approve',
      'restaurant_match_proposals',
      p_proposal_id,
      to_jsonb(v_proposal),
      jsonb_build_object('status', 'approved', 'reviewed_by', v_actor_id),
      jsonb_build_object('bank_transaction_id', v_proposal.bank_transaction_id, 'journal_entry_id', v_proposal.journal_entry_id)
    );
  else
    update public.restaurant_match_proposals
    set status = 'rejected',
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = p_proposal_id;

    perform public.log_restaurant_financial_action(
      p_lodge_id,
      'bank_match.reject',
      'restaurant_match_proposals',
      p_proposal_id,
      to_jsonb(v_proposal),
      jsonb_build_object('status', 'rejected', 'reviewed_by', v_actor_id),
      jsonb_build_object('bank_transaction_id', v_proposal.bank_transaction_id, 'journal_entry_id', v_proposal.journal_entry_id)
    );
  end if;

  return jsonb_build_object('success', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

-- 7d. complete_bank_reconciliation (hardened)
create or replace function public.complete_bank_reconciliation(
  p_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_recon record;
  v_unreconciled_count integer;
  v_new_balance numeric(15,2);
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_recon
  from public.restaurant_bank_reconciliations
  where id = p_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Reconciliation not found');
  end if;

  if v_recon.status != 'draft' then
    return jsonb_build_object('success', false, 'error', 'Reconciliation is not in draft status (current: ' || v_recon.status || ')');
  end if;

  if v_recon.difference <> 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Reconciliation difference must be zero before completing. Current difference: ' || v_recon.difference
    );
  end if;

  select count(*) into v_unreconciled_count
  from public.restaurant_bank_transactions
  where bank_account_id = v_recon.bank_account_id
    and lodge_id = p_lodge_id
    and is_reconciled = false
    and transaction_date <= v_recon.reconciliation_date;

  if v_unreconciled_count > 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'There are ' || v_unreconciled_count || ' unreconciled transactions on or before the reconciliation date'
    );
  end if;

  select
    coalesce(opening_balance, 0)
    + coalesce((select sum(debit) from public.restaurant_bank_transactions
                where bank_account_id = v_recon.bank_account_id and lodge_id = p_lodge_id
                  and is_reconciled = true), 0)
    - coalesce((select sum(credit) from public.restaurant_bank_transactions
                where bank_account_id = v_recon.bank_account_id and lodge_id = p_lodge_id
                  and is_reconciled = true), 0)
  into v_new_balance
  from public.restaurant_bank_accounts
  where id = v_recon.bank_account_id;

  update public.restaurant_bank_accounts
  set current_balance = v_new_balance,
      updated_at = now()
  where id = v_recon.bank_account_id;

  update public.restaurant_bank_reconciliations
  set status = 'completed',
      notes = p_notes,
      completed_at = now(),
      book_balance = v_new_balance
  where id = p_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id,
    'bank_reconciliation.complete',
    'restaurant_bank_reconciliations',
    p_id,
    to_jsonb(v_recon),
    jsonb_build_object('status', 'completed', 'completed_at', now(), 'new_balance', v_new_balance),
    jsonb_build_object('bank_account_id', v_recon.bank_account_id, 'statement_balance', v_recon.statement_balance, 'difference', v_recon.difference)
  );

  return jsonb_build_object('success', true, 'new_balance', v_new_balance);
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- 8. Opening Balance Protection
-- ══════════════════════════════════════════════════════════════

-- 8a. Hardened update_restaurant_bank_account
create or replace function public.update_restaurant_bank_account(
  p_id uuid,
  p_lodge_id uuid,
  p_name text,
  p_bank_name text,
  p_account_number text,
  p_is_active boolean,
  p_opening_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_current record;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_current
  from public.restaurant_bank_accounts
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  if p_opening_balance is not null and p_opening_balance != v_current.opening_balance then
    if exists (
      select 1 from public.restaurant_bank_transactions
      where bank_account_id = p_id
        and is_reconciled = true
        and lodge_id = p_lodge_id
      limit 1
    ) then
      return jsonb_build_object('success', false, 'error', 'Cannot change opening balance: account has reconciled transactions');
    end if;

    if exists (
      select 1 from public.restaurant_bank_reconciliations
      where bank_account_id = p_id
        and status = 'completed'
        and lodge_id = p_lodge_id
      limit 1
    ) then
      return jsonb_build_object('success', false, 'error', 'Cannot change opening balance: account has completed reconciliations');
    end if;
  end if;

  update public.restaurant_bank_accounts
  set name = p_name,
      bank_name = nullif(trim(p_bank_name), ''),
      account_number = nullif(trim(p_account_number), ''),
      is_active = p_is_active,
      opening_balance = coalesce(p_opening_balance, opening_balance),
      updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- 8b. Hardened delete_restaurant_account
create or replace function public.delete_restaurant_account(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_has_entries boolean;
  v_has_posted_entries boolean;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select exists(
    select 1 from public.restaurant_journal_lines jl
    join public.restaurant_journal_entries je on je.id = jl.entry_id
    where je.lodge_id = p_lodge_id
      and jl.account_id = p_id
  ) into v_has_entries;

  if v_has_entries then
    return jsonb_build_object('success', false, 'error', 'Cannot delete account with existing journal entries. Deactivate it instead.');
  end if;

  select exists(
    select 1 from public.restaurant_journal_lines jl
    join public.restaurant_journal_entries je on je.id = jl.entry_id
    where je.lodge_id = p_lodge_id
      and jl.account_id = p_id
      and je.is_posted = true
  ) into v_has_posted_entries;

  if v_has_posted_entries then
    return jsonb_build_object('success', false, 'error', 'Cannot delete account with posted journal entries. Deactivate it instead.');
  end if;

  update public.restaurant_accounts
  set is_active = false, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  perform public.log_restaurant_financial_action(
    p_lodge_id,
    'account.deactivate',
    'restaurant_accounts',
    p_id,
    null,
    jsonb_build_object('is_active', false),
    null
  );

  return jsonb_build_object('success', true);
end;
$$;

commit;
