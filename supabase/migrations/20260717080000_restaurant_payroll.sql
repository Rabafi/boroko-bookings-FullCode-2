begin;

-- ============================================================
-- Restaurant Payroll
-- Gated to restaurant-bar only; does not touch hotel/lodge
-- ============================================================

-- ── restaurant_pay_periods ───────────────────────────────────
create table if not exists public.restaurant_pay_periods (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','processing','approved','paid','closed')),
  processed_at timestamptz,
  approved_by uuid references public.users(id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_pay_periods enable row level security;

create policy restaurant_pay_periods_lodge_scope_select on public.restaurant_pay_periods
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_pay_periods_lodge_scope_insert on public.restaurant_pay_periods
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_pay_periods_lodge_scope_update on public.restaurant_pay_periods
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_pay_periods_lodge_scope_delete on public.restaurant_pay_periods
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_pay_periods_lodge_idx on public.restaurant_pay_periods(lodge_id);

-- ── restaurant_employee_pay_records ─────────────────────────
create table if not exists public.restaurant_employee_pay_records (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  staff_user_id uuid not null references public.users(id),
  staff_name text not null,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete cascade,
  base_salary numeric(15,2) not null default 0,
  hourly_rate numeric(10,2) not null default 0,
  hours_worked numeric(8,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  overtime_rate numeric(10,2) not null default 0,
  bonus numeric(15,2) not null default 0,
  gross_pay numeric(15,2) not null default 0,
  paye_tax numeric(15,2) not null default 0,
  social_security numeric(15,2) not null default 0,
  pension_contribution numeric(15,2) not null default 0,
  health_insurance numeric(15,2) not null default 0,
  other_deductions numeric(15,2) not null default 0,
  total_deductions numeric(15,2) not null default 0,
  net_pay numeric(15,2) not null default 0,
  notes text,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lodge_id, staff_user_id, pay_period_id)
);

alter table public.restaurant_employee_pay_records enable row level security;

create policy restaurant_employee_pay_records_lodge_scope_select on public.restaurant_employee_pay_records
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_employee_pay_records_lodge_scope_insert on public.restaurant_employee_pay_records
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_employee_pay_records_lodge_scope_update on public.restaurant_employee_pay_records
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_employee_pay_records_lodge_scope_delete on public.restaurant_employee_pay_records
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_employee_pay_records_lodge_idx on public.restaurant_employee_pay_records(lodge_id);
create index if not exists restaurant_employee_pay_records_period_idx on public.restaurant_employee_pay_records(pay_period_id);

-- ── restaurant_payroll_settings ─────────────────────────────
create table if not exists public.restaurant_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null unique references public.settings(lodge_id) on delete cascade,
  paye_threshold numeric(15,2) not null default 5000,
  paye_rate_1 numeric(5,2) not null default 0,
  paye_rate_1_threshold numeric(15,2) not null default 5000,
  paye_rate_2 numeric(5,2) not null default 5,
  paye_rate_2_threshold numeric(15,2) not null default 8333,
  paye_rate_3 numeric(5,2) not null default 12.5,
  paye_rate_3_threshold numeric(15,2) not null default 12500,
  paye_rate_4 numeric(5,2) not null default 18.5,
  social_security_rate numeric(5,2) not null default 5,
  pension_rate numeric(5,2) not null default 0,
  health_insurance_amount numeric(15,2) not null default 0,
  currency text not null default 'BWP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_payroll_settings enable row level security;

create policy restaurant_payroll_settings_lodge_scope_select on public.restaurant_payroll_settings
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_settings_lodge_scope_insert on public.restaurant_payroll_settings
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_settings_lodge_scope_update on public.restaurant_payroll_settings
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_settings_lodge_scope_delete on public.restaurant_payroll_settings
  for delete using (public.app_lodge_access(lodge_id));

-- ── restaurant_payroll_payments ─────────────────────────────
create table if not exists public.restaurant_payroll_payments (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid references public.restaurant_pay_periods(id),
  employee_record_id uuid references public.restaurant_employee_pay_records(id),
  payment_date date not null,
  amount numeric(15,2) not null,
  payment_method text not null default 'bank_transfer',
  reference text,
  journal_entry_id uuid,
  created_at timestamptz not null default now()
);

alter table public.restaurant_payroll_payments enable row level security;

create policy restaurant_payroll_payments_lodge_scope_select on public.restaurant_payroll_payments
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_payments_lodge_scope_insert on public.restaurant_payroll_payments
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_payments_lodge_scope_update on public.restaurant_payroll_payments
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_payroll_payments_lodge_scope_delete on public.restaurant_payroll_payments
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_payroll_payments_lodge_idx on public.restaurant_payroll_payments(lodge_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- RPCs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── get_restaurant_payroll_settings ─────────────────────────
create or replace function public.get_restaurant_payroll_settings(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_settings record;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select * into v_settings
  from public.restaurant_payroll_settings
  where lodge_id = p_lodge_id;

  if not found then
    insert into public.restaurant_payroll_settings (lodge_id) values (p_lodge_id)
    returning * into v_settings;
  end if;

  return jsonb_build_object('success', true, 'data', row_to_json(v_settings));
end;
$$;

-- ── update_restaurant_payroll_settings ──────────────────────
create or replace function public.update_restaurant_payroll_settings(
  p_lodge_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  update public.restaurant_payroll_settings set
    paye_threshold = coalesce((p_settings->>'paye_threshold')::numeric, paye_threshold),
    paye_rate_1 = coalesce((p_settings->>'paye_rate_1')::numeric, paye_rate_1),
    paye_rate_1_threshold = coalesce((p_settings->>'paye_rate_1_threshold')::numeric, paye_rate_1_threshold),
    paye_rate_2 = coalesce((p_settings->>'paye_rate_2')::numeric, paye_rate_2),
    paye_rate_2_threshold = coalesce((p_settings->>'paye_rate_2_threshold')::numeric, paye_rate_2_threshold),
    paye_rate_3 = coalesce((p_settings->>'paye_rate_3')::numeric, paye_rate_3),
    paye_rate_3_threshold = coalesce((p_settings->>'paye_rate_3_threshold')::numeric, paye_rate_3_threshold),
    paye_rate_4 = coalesce((p_settings->>'paye_rate_4')::numeric, paye_rate_4),
    social_security_rate = coalesce((p_settings->>'social_security_rate')::numeric, social_security_rate),
    pension_rate = coalesce((p_settings->>'pension_rate')::numeric, pension_rate),
    health_insurance_amount = coalesce((p_settings->>'health_insurance_amount')::numeric, health_insurance_amount),
    currency = coalesce(nullif(btrim(p_settings->>'currency'), ''), currency),
    updated_at = now()
  where lodge_id = p_lodge_id;

  if not found then
    insert into public.restaurant_payroll_settings (
      lodge_id, paye_threshold, paye_rate_1, paye_rate_1_threshold,
      paye_rate_2, paye_rate_2_threshold, paye_rate_3, paye_rate_3_threshold,
      paye_rate_4, social_security_rate, pension_rate, health_insurance_amount, currency
    ) values (
      p_lodge_id,
      coalesce((p_settings->>'paye_threshold')::numeric, 5000),
      coalesce((p_settings->>'paye_rate_1')::numeric, 0),
      coalesce((p_settings->>'paye_rate_1_threshold')::numeric, 5000),
      coalesce((p_settings->>'paye_rate_2')::numeric, 5),
      coalesce((p_settings->>'paye_rate_2_threshold')::numeric, 8333),
      coalesce((p_settings->>'paye_rate_3')::numeric, 12.5),
      coalesce((p_settings->>'paye_rate_3_threshold')::numeric, 12500),
      coalesce((p_settings->>'paye_rate_4')::numeric, 18.5),
      coalesce((p_settings->>'social_security_rate')::numeric, 5),
      coalesce((p_settings->>'pension_rate')::numeric, 0),
      coalesce((p_settings->>'health_insurance_amount')::numeric, 0),
      coalesce(nullif(btrim(p_settings->>'currency'), ''), 'BWP')
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── create_pay_period ───────────────────────────────────────
create or replace function public.create_pay_period(
  p_lodge_id uuid,
  p_name text,
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
  v_new_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  if nullif(btrim(p_name), '') is null then
    return jsonb_build_object('success', false, 'error', 'Pay period name is required');
  end if;

  if p_start_date is null or p_end_date is null then
    return jsonb_build_object('success', false, 'error', 'Start and end dates are required');
  end if;

  if p_end_date < p_start_date then
    return jsonb_build_object('success', false, 'error', 'End date must be on or after start date');
  end if;

  insert into public.restaurant_pay_periods (lodge_id, name, start_date, end_date)
  values (p_lodge_id, btrim(p_name), p_start_date, p_end_date)
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
end;
$$;

-- ── get_pay_periods ─────────────────────────────────────────
create or replace function public.get_pay_periods(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  return jsonb_build_object(
    'success', true,
    'data', (
      select coalesce(jsonb_agg(row_to_json(p) order by p.start_date desc), '[]'::jsonb)
      from public.restaurant_pay_periods p
      where p.lodge_id = p_lodge_id
    )
  );
end;
$$;

-- ── calculate_payroll ───────────────────────────────────────
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
      and s.clock_in::date between v_period.start_date and v_period.end_date
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

-- ── get_pay_period_records ──────────────────────────────────
create or replace function public.get_pay_period_records(
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
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  return jsonb_build_object(
    'success', true,
    'data', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.staff_name), '[]'::jsonb)
      from public.restaurant_employee_pay_records r
      where r.pay_period_id = p_pay_period_id and r.lodge_id = p_lodge_id
    )
  );
end;
$$;

-- ── update_employee_pay_record ──────────────────────────────
create or replace function public.update_employee_pay_record(
  p_id uuid,
  p_lodge_id uuid,
  p_overrides jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_record record;
  v_bonus numeric;
  v_other_ded numeric;
  v_new_gross numeric;
  v_new_ded numeric;
  v_new_net numeric;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select * into v_record
  from public.restaurant_employee_pay_records
  where id = p_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Pay record not found');
  end if;

  v_bonus := coalesce((p_overrides->>'bonus')::numeric, v_record.bonus);
  v_other_ded := coalesce((p_overrides->>'other_deductions')::numeric, v_record.other_deductions);

  v_new_gross := v_record.base_salary + (v_record.hours_worked * v_record.hourly_rate)
    + (v_record.overtime_hours * v_record.overtime_rate * 1.5) + v_bonus;

  v_new_ded := v_record.paye_tax + v_record.social_security + v_record.pension_contribution
    + v_record.health_insurance + v_other_ded;

  v_new_net := greatest(v_new_gross - v_new_ded, 0);

  update public.restaurant_employee_pay_records set
    bonus = v_bonus,
    other_deductions = v_other_ded,
    gross_pay = v_new_gross,
    total_deductions = v_new_ded,
    net_pay = v_new_net,
    notes = coalesce(nullif(btrim(p_overrides->>'notes'), ''), notes),
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ── approve_payroll ─────────────────────────────────────────
create or replace function public.approve_payroll(
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
  v_period record;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select * into v_period
  from public.restaurant_pay_periods
  where id = p_pay_period_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Pay period not found');
  end if;

  if v_period.status not in ('draft', 'processing') then
    return jsonb_build_object('success', false, 'error', 'Pay period is ' || v_period.status || ' and cannot be approved');
  end if;

  update public.restaurant_pay_periods set
    status = 'approved',
    approved_by = v_actor_id
  where id = p_pay_period_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ── generate_payslip ────────────────────────────────────────
create or replace function public.generate_payslip(
  p_employee_record_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_record record;
  v_period record;
  v_settings record;
  v_employer_ss numeric;
  v_employer_pension numeric;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select * into v_record
  from public.restaurant_employee_pay_records
  where id = p_employee_record_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Pay record not found');
  end if;

  select * into v_period
  from public.restaurant_pay_periods
  where id = v_record.pay_period_id;

  select * into v_settings
  from public.restaurant_payroll_settings
  where lodge_id = p_lodge_id;

  if not found then
    insert into public.restaurant_payroll_settings (lodge_id) values (p_lodge_id)
    returning * into v_settings;
  end if;

  v_employer_ss := v_record.gross_pay * v_settings.social_security_rate / 100;
  v_employer_pension := v_record.gross_pay * v_settings.pension_rate / 100;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'employee_name', v_record.staff_name,
      'pay_period', v_period.name,
      'period_start', v_period.start_date,
      'period_end', v_period.end_date,
      'earnings', jsonb_build_object(
        'base_salary', v_record.base_salary,
        'hourly_rate', v_record.hourly_rate,
        'hours_worked', v_record.hours_worked,
        'regular_pay', v_record.hours_worked * v_record.hourly_rate,
        'overtime_hours', v_record.overtime_hours,
        'overtime_rate', v_record.overtime_rate,
        'overtime_pay', v_record.overtime_hours * v_record.overtime_rate * 1.5,
        'bonus', v_record.bonus,
        'gross_pay', v_record.gross_pay
      ),
      'employee_deductions', jsonb_build_object(
        'paye_tax', v_record.paye_tax,
        'social_security', v_record.social_security,
        'pension_contribution', v_record.pension_contribution,
        'health_insurance', v_record.health_insurance,
        'other_deductions', v_record.other_deductions,
        'total_deductions', v_record.total_deductions
      ),
      'employer_contributions', jsonb_build_object(
        'social_security', v_employer_ss,
        'pension', v_employer_pension,
        'total', v_employer_ss + v_employer_pension
      ),
      'net_pay', v_record.net_pay,
      'currency', v_settings.currency,
      'status', v_record.created_at::text,
      'generated_at', now()
    )
  );
end;
$$;

-- ── post_payroll_to_gl ──────────────────────────────────────
create or replace function public.post_payroll_to_gl(
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
  v_period record;
  v_total_gross numeric := 0;
  v_total_paye numeric := 0;
  v_total_ss numeric := 0;
  v_total_pension numeric := 0;
  v_total_hi numeric := 0;
  v_total_net numeric := 0;
  v_already_posted boolean;
  v_account_staff_costs uuid;
  v_account_bank uuid;
  v_account_paye_payable uuid;
  v_account_accrued_expenses uuid;
  v_entry_id uuid;
  v_ref text;
  v_total_deductions numeric;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager']);

  select * into v_period
  from public.restaurant_pay_periods
  where id = p_pay_period_id and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Pay period not found');
  end if;

  if v_period.status not in ('approved', 'paid') then
    return jsonb_build_object('success', false, 'error', 'Payroll must be approved before posting to GL');
  end if;

  select exists(
    select 1 from public.restaurant_employee_pay_records
    where pay_period_id = p_pay_period_id and lodge_id = p_lodge_id and journal_entry_id is not null
  ) into v_already_posted;

  if v_already_posted then
    return jsonb_build_object('success', false, 'error', 'Payroll has already been posted to GL');
  end if;

  -- Staff Costs (6100) for gross wages, Accrued Expenses (2300) for net pay payable,
  -- Bank (1020) for net pay disbursement, VAT Output (2100) for PAYE withheld
  select id into v_account_staff_costs from public.restaurant_accounts where lodge_id = p_lodge_id and code = '6100' and is_active = true;
  select id into v_account_bank from public.restaurant_accounts where lodge_id = p_lodge_id and code = '1020' and is_active = true;
  select id into v_account_paye_payable from public.restaurant_accounts where lodge_id = p_lodge_id and code = '2100' and is_active = true;
  select id into v_account_accrued_expenses from public.restaurant_accounts where lodge_id = p_lodge_id and code = '2300' and is_active = true;

  if v_account_staff_costs is null then
    return jsonb_build_object('success', false, 'error', 'Staff Costs account (6100) not found. Seed chart of accounts first.');
  end if;

  select
    coalesce(sum(gross_pay), 0),
    coalesce(sum(paye_tax), 0),
    coalesce(sum(social_security), 0),
    coalesce(sum(pension_contribution), 0),
    coalesce(sum(health_insurance), 0),
    coalesce(sum(net_pay), 0)
  into v_total_gross, v_total_paye, v_total_ss, v_total_pension, v_total_hi, v_total_net
  from public.restaurant_employee_pay_records
  where pay_period_id = p_pay_period_id and lodge_id = p_lodge_id;

  if v_total_gross = 0 then
    return jsonb_build_object('success', false, 'error', 'No payroll records found for this period');
  end if;

  v_total_deductions := v_total_paye + v_total_ss + v_total_pension + v_total_hi;
  v_ref := 'PR-' || to_char(v_period.end_date, 'YYYYMMDD') || '-' || left(p_pay_period_id::text, 8);

  -- Create journal entry: Debit Staff Costs (total gross), Credit Bank (net pay), Credit PAYE/VAT (withholdings)
  insert into public.restaurant_journal_entries (
    lodge_id, entry_date, description, source_type, source_id, reference_number, created_by
  ) values (
    p_lodge_id, v_period.end_date,
    'Payroll - ' || v_period.name || ' (' || v_period.start_date || ' to ' || v_period.end_date || ')',
    'payroll', p_pay_period_id, v_ref, v_actor_id
  ) returning id into v_entry_id;

  -- Debit: Staff Costs = total gross
  insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
  values (v_entry_id, v_account_staff_costs, v_total_gross, 0, 'Gross wages - ' || v_period.name);

  -- Credit: Bank = net pay disbursed
  if v_total_net > 0 and v_account_bank is not null then
    insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
    values (v_entry_id, v_account_bank, 0, v_total_net, 'Net pay disbursed - ' || v_period.name);
  end if;

  -- Credit: PAYE/VAT payable
  if v_total_paye > 0 and v_account_paye_payable is not null then
    insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
    values (v_entry_id, v_account_paye_payable, 0, v_total_paye, 'PAYE tax withheld - ' || v_period.name);
  end if;

  -- For social security, pension, health insurance - accrue as expenses payable
  -- These are deductions from gross that are not disbursed to employee but held for payment to authorities
  if (v_total_ss + v_total_pension + v_total_hi) > 0 and v_account_accrued_expenses is not null then
    insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
    values (v_entry_id, v_account_accrued_expenses, 0, v_total_ss + v_total_pension + v_total_hi, 'Deductions payable (SS/Pension/HI) - ' || v_period.name);
  end if;

  -- Link each pay record to the journal entry
  update public.restaurant_employee_pay_records set
    journal_entry_id = v_entry_id,
    updated_at = now()
  where pay_period_id = p_pay_period_id and lodge_id = p_lodge_id;

  update public.restaurant_pay_periods set status = 'paid', paid_at = now()
  where id = p_pay_period_id;

  return jsonb_build_object(
    'success', true,
    'summary', jsonb_build_object(
      'entry_id', v_entry_id,
      'total_gross', v_total_gross,
      'total_paye', v_total_paye,
      'total_social_security', v_total_ss,
      'total_pension', v_total_pension,
      'total_health_insurance', v_total_hi,
      'total_net_pay', v_total_net,
      'accounts', jsonb_build_object(
        'debit_staff_costs', v_account_staff_costs,
        'credit_bank', v_account_bank,
        'credit_paye_payable', v_account_paye_payable,
        'credit_accrued_expenses', v_account_accrued_expenses
      )
    )
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────
revoke all on function public.get_restaurant_payroll_settings(uuid) from public;
grant execute on function public.get_restaurant_payroll_settings(uuid) to authenticated, service_role;

revoke all on function public.update_restaurant_payroll_settings(uuid, jsonb) from public;
grant execute on function public.update_restaurant_payroll_settings(uuid, jsonb) to authenticated, service_role;

revoke all on function public.create_pay_period(uuid, text, date, date) from public;
grant execute on function public.create_pay_period(uuid, text, date, date) to authenticated, service_role;

revoke all on function public.get_pay_periods(uuid) from public;
grant execute on function public.get_pay_periods(uuid) to authenticated, service_role;

revoke all on function public.calculate_payroll(uuid, uuid) from public;
grant execute on function public.calculate_payroll(uuid, uuid) to authenticated, service_role;

revoke all on function public.get_pay_period_records(uuid, uuid) from public;
grant execute on function public.get_pay_period_records(uuid, uuid) to authenticated, service_role;

revoke all on function public.update_employee_pay_record(uuid, uuid, jsonb) from public;
grant execute on function public.update_employee_pay_record(uuid, uuid, jsonb) to authenticated, service_role;

revoke all on function public.approve_payroll(uuid, uuid) from public;
grant execute on function public.approve_payroll(uuid, uuid) to authenticated, service_role;

revoke all on function public.generate_payslip(uuid, uuid) from public;
grant execute on function public.generate_payslip(uuid, uuid) to authenticated, service_role;

revoke all on function public.post_payroll_to_gl(uuid, uuid) from public;
grant execute on function public.post_payroll_to_gl(uuid, uuid) to authenticated, service_role;

commit;
