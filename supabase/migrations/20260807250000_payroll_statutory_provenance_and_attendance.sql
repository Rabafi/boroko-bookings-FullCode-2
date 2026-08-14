-- Payroll statutory provenance and attendance-to-payroll reconciliation.

begin;

alter table public.restaurant_payroll_statutory_configurations
  add column if not exists source_reference text,
  add column if not exists source_document_hash text,
  add column if not exists policy_approved_by uuid references public.users(id),
  add column if not exists policy_approved_at timestamptz;

create table if not exists public.restaurant_payroll_attendance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
  staff_user_id uuid not null references public.users(id) on delete restrict,
  attendance_source text not null,
  expected_hours numeric(8,2) not null default 0 check (expected_hours >= 0),
  approved_hours numeric(8,2) not null default 0 check (approved_hours >= 0),
  disposition text not null default 'pending' check (disposition in ('pending', 'confirmed', 'excluded')),
  exclusion_reason text,
  operation_id uuid not null,
  payload_hash text not null,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, pay_period_id, staff_user_id),
  unique (lodge_id, operation_id),
  check ((disposition = 'excluded' and nullif(btrim(exclusion_reason), '') is not null) or disposition <> 'excluded')
);
alter table public.restaurant_payroll_attendance_reconciliations enable row level security;
revoke all on table public.restaurant_payroll_attendance_reconciliations from public, anon, authenticated;

create or replace function public.set_restaurant_payroll_statutory_configuration_v3(
  p_lodge_id uuid,
  p_jurisdiction_code text,
  p_rule_version text,
  p_effective_from date,
  p_effective_to date,
  p_tax_brackets jsonb,
  p_social_security_rate numeric,
  p_pension_rate numeric,
  p_health_amount numeric,
  p_currency text,
  p_source_reference text,
  p_source_document_hash text,
  p_policy_approved boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_base jsonb;
  v_id uuid;
begin
  if nullif(btrim(p_source_reference), '') is null or nullif(btrim(p_source_document_hash), '') is null or p_policy_approved is not true then
    raise exception 'Payroll statutory configuration requires an official source reference, document hash, and policy approval' using errcode = '22023';
  end if;
  v_base := public.set_restaurant_payroll_statutory_configuration(
    p_lodge_id, p_jurisdiction_code, p_rule_version, p_effective_from, p_effective_to,
    p_tax_brackets, p_social_security_rate, p_pension_rate, p_health_amount, p_currency
  );
  v_id := nullif(v_base->'data'->>'id', '')::uuid;
  update public.restaurant_payroll_statutory_configurations
     set source_reference = btrim(p_source_reference),
         source_document_hash = lower(btrim(p_source_document_hash)),
         policy_approved_by = v_actor,
         policy_approved_at = now()
   where id = v_id and lodge_id = p_lodge_id;
  return v_base || jsonb_build_object('provenance', jsonb_build_object('source_reference', p_source_reference, 'source_document_hash', lower(btrim(p_source_document_hash)), 'approved_by', v_actor));
end
$$;

create or replace function public.set_restaurant_payroll_attendance_disposition_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid,
  p_staff_user_id uuid,
  p_attendance_source text,
  p_expected_hours numeric,
  p_approved_hours numeric,
  p_disposition text,
  p_exclusion_reason text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_manage');
  v_hash text := encode(digest(jsonb_build_object('period_id', p_pay_period_id, 'staff_user_id', p_staff_user_id, 'source', p_attendance_source, 'expected_hours', p_expected_hours, 'approved_hours', p_approved_hours, 'disposition', p_disposition, 'exclusion_reason', p_exclusion_reason)::text, 'sha256'), 'hex');
  v_existing public.restaurant_payroll_attendance_reconciliations%rowtype;
  v_id uuid;
begin
  if p_operation_id is null or nullif(btrim(p_attendance_source), '') is null or p_disposition not in ('confirmed', 'excluded') or coalesce(p_expected_hours, 0) < 0 or coalesce(p_approved_hours, 0) < 0 then
    raise exception 'Attendance disposition requires a stable key, source, non-negative hours, and confirmed or excluded status' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_lodge_id::text || ':' || p_operation_id::text, 0));
  if p_disposition = 'excluded' and nullif(btrim(p_exclusion_reason), '') is null then raise exception 'An explicit exclusion reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.restaurant_pay_periods where id = p_pay_period_id and lodge_id = p_lodge_id and status = 'draft') then raise exception 'Attendance can only be reconciled for a draft pay period' using errcode = '22023'; end if;
  if not exists (select 1 from public.users where id = p_staff_user_id and lodge_id = p_lodge_id and coalesce(status, 'active') = 'active') then raise exception 'Attendance worker is not an active lodge employee' using errcode = '23503'; end if;
  select * into v_existing from public.restaurant_payroll_attendance_reconciliations where lodge_id = p_lodge_id and operation_id = p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then raise exception 'Attendance operation key conflicts with a different payload' using errcode = '22000'; end if;
    return jsonb_build_object('success', true, 'id', v_existing.id, 'replayed', true, 'data', to_jsonb(v_existing));
  end if;
  insert into public.restaurant_payroll_attendance_reconciliations(lodge_id, pay_period_id, staff_user_id, attendance_source, expected_hours, approved_hours, disposition, exclusion_reason, operation_id, payload_hash, approved_by, approved_at)
  values (p_lodge_id, p_pay_period_id, p_staff_user_id, btrim(p_attendance_source), round(coalesce(p_expected_hours, 0), 2), round(coalesce(p_approved_hours, 0), 2), p_disposition, nullif(btrim(p_exclusion_reason), ''), p_operation_id, v_hash, v_actor, now())
  on conflict (lodge_id, pay_period_id, staff_user_id) do update set attendance_source = excluded.attendance_source, expected_hours = excluded.expected_hours, approved_hours = excluded.approved_hours, disposition = excluded.disposition, exclusion_reason = excluded.exclusion_reason, operation_id = excluded.operation_id, payload_hash = excluded.payload_hash, approved_by = excluded.approved_by, approved_at = excluded.approved_at, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'replayed', false, 'disposition', p_disposition);
end
$$;

create or replace function public.get_restaurant_payroll_attendance_reconciliation_v3(
  p_lodge_id uuid,
  p_pay_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.payroll_view');
  return jsonb_build_object('success', true, 'data', coalesce((select jsonb_agg(to_jsonb(a) order by a.staff_user_id) from public.restaurant_payroll_attendance_reconciliations a where a.lodge_id = p_lodge_id and a.pay_period_id = p_pay_period_id), '[]'::jsonb));
end
$$;

grant execute on function public.set_restaurant_payroll_statutory_configuration_v3(uuid, text, text, date, date, jsonb, numeric, numeric, numeric, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.set_restaurant_payroll_attendance_disposition_v3(uuid, uuid, uuid, text, numeric, numeric, text, text, uuid) to authenticated, service_role;
grant execute on function public.get_restaurant_payroll_attendance_reconciliation_v3(uuid, uuid) to authenticated, service_role;

commit;
