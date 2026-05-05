begin;

create table if not exists public.subscription_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null,
  version_code text not null,
  headline text,
  modules jsonb not null default '[]'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  pricing_meta jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (plan_name, version_code)
);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid,
  lodge_key text,
  license_id uuid,
  invoice_id uuid,
  event_type text not null,
  event_status text not null default 'completed',
  plan_name text,
  plan_version_code text,
  actor_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.subscription_plan_versions (plan_name, version_code, headline, modules, feature_flags, pricing_meta)
values
  ('Starter', '2026.04', 'Run a small lodge day to day', '["Dashboard","Bookings","Quotations","Invoices","Room Grid","Calendar","Guests","Rooms","Housekeeping","Maintenance","Settings"]'::jsonb, '{"reports":false,"expenses":false,"staff":false,"pwa":false,"audit":false,"conference":false,"pool":false,"import":false,"pos":false,"inventory":false,"supplies":false}'::jsonb, '{"price_label":"Entry","badge":"Core Operations"}'::jsonb),
  ('Standard', '2026.04', 'See the business, not just the bookings', '["Everything in Starter","Reports & Analytics","Expenses Tracking","Staff Management","Night Audit","Data Management","Conference Bookings","Pool / Day Use"]'::jsonb, '{"reports":true,"expenses":true,"staff":true,"pwa":false,"audit":true,"conference":true,"pool":true,"import":true,"pos":false,"inventory":false,"supplies":false}'::jsonb, '{"price_label":"Mid-tier","badge":"Business Control"}'::jsonb),
  ('Pro', '2026.04', 'Monetize more operations from one system', '["Everything in Standard","Manager PWA","Point of Sale (POS)","Inventory Management","Room Supplies Tracker"]'::jsonb, '{"reports":true,"expenses":true,"staff":true,"pwa":true,"audit":true,"conference":true,"pool":true,"import":true,"pos":true,"inventory":true,"supplies":true}'::jsonb, '{"price_label":"Full Suite","badge":"Revenue Expansion"}'::jsonb)
on conflict (plan_name, version_code) do nothing;

alter table public.licenses
  add column if not exists plan_version_code text,
  add column if not exists subscription_state text,
  add column if not exists grace_period_days integer not null default 7,
  add column if not exists offline_lease_days integer not null default 7,
  add column if not exists activated_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists last_entitlement_sync_at timestamptz;

alter table public.lodge_features
  add column if not exists reason text,
  add column if not exists expires_at timestamptz,
  add column if not exists review_at timestamptz,
  add column if not exists granted_by uuid,
  add column if not exists granted_at timestamptz not null default now();

create index if not exists subscription_events_lodge_id_idx on public.subscription_events (lodge_id, created_at desc);
create index if not exists subscription_events_license_id_idx on public.subscription_events (license_id, created_at desc);
create index if not exists subscription_events_event_type_idx on public.subscription_events (event_type, created_at desc);

create or replace function public._normalize_subscription_plan(p_plan text)
returns text
language plpgsql
immutable
as $function$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if v_plan in ('premium', 'pro') then
    return 'Pro';
  end if;
  if v_plan = 'standard' then
    return 'Standard';
  end if;
  return 'Starter';
end;
$function$;

create or replace function public._subscription_state(
  p_payment_status text,
  p_next_due_date date,
  p_expires_at timestamptz,
  p_is_active boolean,
  p_grace_days integer default 7
) returns text
language plpgsql
stable
as $function$
declare
  v_payment_status text := lower(coalesce(btrim(p_payment_status), 'active'));
  v_grace_days integer := greatest(coalesce(p_grace_days, 7), 0);
  v_grace_end date;
begin
  if coalesce(p_is_active, true) = false then
    return 'inactive';
  end if;
  if v_payment_status = 'cancelled' then
    return 'cancelled';
  end if;
  if p_expires_at is not null and p_expires_at < now() then
    return 'expired';
  end if;
  if v_payment_status in ('suspended', 'paused') then
    return 'suspended';
  end if;
  if v_payment_status in ('trial', 'free') then
    return 'active';
  end if;
  if p_next_due_date is not null and p_next_due_date < current_date then
    v_grace_end := p_next_due_date + v_grace_days;
    if v_grace_end < current_date then
      return 'suspended';
    end if;
    return 'grace_period';
  end if;
  if v_payment_status = 'overdue' then
    if p_next_due_date is not null then
      v_grace_end := p_next_due_date + v_grace_days;
      if v_grace_end < current_date then
        return 'suspended';
      end if;
    end if;
    return 'grace_period';
  end if;
  return 'active';
end;
$function$;

create or replace function public._subscription_access_allowed(p_state text)
returns boolean
language sql
immutable
as $function$
  select coalesce(lower(btrim(p_state)), '') in ('active', 'grace_period');
$function$;

create or replace function public._offline_valid_until(
  p_state text,
  p_expires_at timestamptz,
  p_next_due_date date,
  p_grace_days integer,
  p_lease_days integer
) returns timestamptz
language plpgsql
stable
as $function$
declare
  v_state text := lower(coalesce(btrim(p_state), 'active'));
  v_lease_days integer := greatest(least(coalesce(p_lease_days, 7), 30), 1);
  v_candidate timestamptz := now() + make_interval(days => v_lease_days);
  v_grace_end timestamptz;
begin
  if v_state not in ('active', 'grace_period') then
    return now();
  end if;
  if p_next_due_date is not null then
    v_grace_end := (p_next_due_date + greatest(coalesce(p_grace_days, 7), 0))::timestamptz + interval '1 day';
    if v_grace_end < v_candidate then
      v_candidate := v_grace_end;
    end if;
  end if;
  if p_expires_at is not null and p_expires_at < v_candidate then
    v_candidate := p_expires_at;
  end if;
  return v_candidate;
end;
$function$;

create or replace function public._generate_license_key()
returns text
language plpgsql
volatile
as $function$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_result text := 'BB-';
  v_index integer;
begin
  for v_index in 0..11 loop
    v_result := v_result || substr(v_chars, (get_byte(v_bytes, v_index) % length(v_chars)) + 1, 1);
    if v_index in (3, 7) then
      v_result := v_result || '-';
    end if;
  end loop;
  return v_result;
end;
$function$;

create or replace function public._record_subscription_event(
  p_lodge_id uuid,
  p_lodge_key text,
  p_license_id uuid,
  p_invoice_id uuid,
  p_event_type text,
  p_event_status text,
  p_plan_name text,
  p_plan_version_code text,
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  insert into public.subscription_events (
    lodge_id, lodge_key, license_id, invoice_id, event_type, event_status,
    plan_name, plan_version_code, actor_id, details
  ) values (
    p_lodge_id, p_lodge_key, p_license_id, p_invoice_id, p_event_type,
    coalesce(nullif(btrim(p_event_status), ''), 'completed'),
    p_plan_name, p_plan_version_code, v_actor, coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_event_id;
  return v_event_id;
end;
$function$;

update public.licenses
set subscription_plan = public._normalize_subscription_plan(subscription_plan)
where coalesce(nullif(subscription_plan, ''), 'Starter') <> public._normalize_subscription_plan(subscription_plan);

update public.licenses
set plan_version_code = coalesce(nullif(plan_version_code, ''), '2026.04'),
    grace_period_days = greatest(coalesce(grace_period_days, 7), 0),
    offline_lease_days = greatest(least(coalesce(offline_lease_days, 7), 30), 1),
    activated_at = coalesce(activated_at, issued_at),
    cancelled_at = case when lower(coalesce(payment_status, '')) = 'cancelled' then coalesce(cancelled_at, issued_at, now()) else cancelled_at end,
    suspended_at = case when lower(coalesce(payment_status, '')) in ('suspended', 'paused', 'overdue') then coalesce(suspended_at, issued_at, now()) else suspended_at end,
    subscription_state = public._subscription_state(payment_status, next_due_date, expires_at, is_active, grace_period_days);

update public.lodge_features
set granted_at = coalesce(granted_at, updated_at, now()),
    reason = nullif(btrim(reason), '');

with ranked as (
  select
    l.id,
    row_number() over (
      partition by lower(btrim(l.lodge_id::text))
      order by
        case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
          when 'active' then 0
          when 'grace_period' then 1
          when 'suspended' then 2
          when 'expired' then 3
          when 'cancelled' then 4
          else 5
        end,
        l.expires_at desc nulls last,
        l.issued_at desc nulls last,
        l.id desc
    ) as rn
  from public.licenses l
  where coalesce(l.is_active, true) = true
    and nullif(btrim(l.lodge_id::text), '') is not null
    and lower(btrim(l.lodge_id::text)) <> 'unassigned'
)
update public.licenses l
set is_active = false,
    subscription_state = 'superseded',
    notes = trim(both from concat(coalesce(l.notes, ''), case when coalesce(l.notes, '') = '' then '' else ' ' end, '[Auto-archived during subscription hardening]'))
from ranked r
where l.id = r.id
  and r.rn > 1;

create unique index if not exists licenses_one_active_assignment_idx
  on public.licenses ((lower(btrim(lodge_id::text))))
  where coalesce(is_active, true) = true
    and nullif(btrim(lodge_id::text), '') is not null
    and lower(btrim(lodge_id::text)) <> 'unassigned';

create index if not exists licenses_subscription_state_idx on public.licenses (subscription_state, next_due_date, expires_at);
create index if not exists lodge_features_active_override_idx on public.lodge_features (lodge_id, feature_name, expires_at);

create or replace function public._license_plan_features(
  p_plan text,
  p_trial boolean default false,
  p_expired boolean default false
) returns jsonb
language plpgsql
immutable
as $function$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if p_expired then
    return jsonb_build_object('reports', false, 'expenses', false, 'staff', false, 'pwa', false, 'audit', false, 'conference', false, 'pool', false, 'import', false, 'pos', false, 'inventory', false, 'supplies', false);
  end if;
  if p_trial then
    return jsonb_build_object('reports', true, 'expenses', true, 'staff', true, 'pwa', true, 'audit', true, 'conference', true, 'pool', true, 'import', true, 'pos', true, 'inventory', true, 'supplies', true);
  end if;
  if v_plan in ('pro', 'premium') then
    return jsonb_build_object('reports', true, 'expenses', true, 'staff', true, 'pwa', true, 'audit', true, 'conference', true, 'pool', true, 'import', true, 'pos', true, 'inventory', true, 'supplies', true);
  end if;
  if v_plan = 'standard' then
    return jsonb_build_object('reports', true, 'expenses', true, 'staff', true, 'pwa', false, 'audit', true, 'conference', true, 'pool', true, 'import', true, 'pos', false, 'inventory', false, 'supplies', false);
  end if;
  return jsonb_build_object('reports', false, 'expenses', false, 'staff', false, 'pwa', false, 'audit', false, 'conference', false, 'pool', false, 'import', false, 'pos', false, 'inventory', false, 'supplies', false);
end;
$function$;

create or replace function public.get_lodge_entitlement(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_settings public.settings%rowtype;
  v_license public.licenses%rowtype;
  v_overrides jsonb := '{}'::jsonb;
  v_trial_end timestamptz;
  v_days_left int;
  v_expired boolean;
  v_plan text;
  v_payment_status text;
  v_subscription_state text;
  v_access_allowed boolean;
  v_grace_days integer;
  v_lease_days integer;
  v_grace_ends_at timestamptz;
  v_offline_valid_until timestamptz;
begin
  select *
  into v_settings
  from public.settings s
  where s.lodge_id = p_lodge_id
    and coalesce(s.deleted, false) = false
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1;

  select coalesce(jsonb_object_agg(lf.feature_name, lf.enabled), '{}'::jsonb)
  into v_overrides
  from public.lodge_features lf
  where lf.lodge_id = p_lodge_id
    and (lf.expires_at is null or lf.expires_at > now());

  select *
  into v_license
  from public.licenses l
  where l.lodge_id::text = p_lodge_id::text
    and coalesce(l.is_active, true) = true
  order by
    case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
      when 'active' then 0
      when 'grace_period' then 1
      when 'suspended' then 2
      when 'expired' then 3
      when 'cancelled' then 4
      else 5
    end,
    l.expires_at desc nulls last,
    l.issued_at desc nulls last
  limit 1;

  if found then
    v_plan := public._normalize_subscription_plan(v_license.subscription_plan);
    v_payment_status := lower(coalesce(v_license.payment_status, 'active'));
    v_grace_days := greatest(coalesce(v_license.grace_period_days, 7), 0);
    v_lease_days := greatest(least(coalesce(v_license.offline_lease_days, 7), 30), 1);
    v_subscription_state := public._subscription_state(v_payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_grace_days);
    v_access_allowed := public._subscription_access_allowed(v_subscription_state);
    v_grace_ends_at := case when v_license.next_due_date is null then null else (v_license.next_due_date + v_grace_days)::timestamptz + interval '1 day' end;
    v_offline_valid_until := public._offline_valid_until(v_subscription_state, v_license.expires_at, v_license.next_due_date, v_grace_days, v_lease_days);

    update public.licenses
    set subscription_state = v_subscription_state,
        last_entitlement_sync_at = now()
    where id = v_license.id
      and (
        subscription_state is distinct from v_subscription_state
        or last_entitlement_sync_at is null
        or last_entitlement_sync_at < now() - interval '1 hour'
      );

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'plan_version_code', coalesce(v_license.plan_version_code, '2026.04'),
      'payment_status', v_payment_status,
      'subscription_state', v_subscription_state,
      'monthly_fee', coalesce(v_license.monthly_fee, 0),
      'currency', v_license.currency,
      'next_due_date', v_license.next_due_date,
      'expires_at', v_license.expires_at,
      'grace_period_days', v_grace_days,
      'grace_period_ends_at', v_grace_ends_at,
      'offline_lease_days', v_lease_days,
      'offline_valid_until', v_offline_valid_until,
      'source_license_id', v_license.id,
      'lodge_name', coalesce(v_license.lodge_name, v_settings.lodge_name, v_settings.company_name),
      'effective_features', case when v_access_allowed then public._license_plan_features(v_plan, false, false) || coalesce(v_overrides, '{}'::jsonb) else public._license_plan_features(v_plan, false, true) end
    );
  end if;

  v_trial_end := coalesce(v_settings.trial_started_at, now()) + interval '3 days';
  if v_settings.trial_started_at is null then
    v_days_left := 3;
    v_expired := false;
  else
    v_days_left := greatest(0, ceil(extract(epoch from (v_trial_end - now())) / 86400.0))::int;
    v_expired := v_days_left <= 0;
  end if;

  return jsonb_build_object(
    'lodge_id', p_lodge_id,
    'status', case when v_expired then 'expired' else 'trial' end,
    'daysLeft', v_days_left,
    'expired', v_expired,
    'plan', case when v_expired then null else 'Trial' end,
    'plan_version_code', 'trial',
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'subscription_state', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
    'grace_period_days', 0,
    'grace_period_ends_at', null,
    'offline_lease_days', 3,
    'offline_valid_until', least(v_trial_end, now() + interval '3 days'),
    'source_license_id', null,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$function$;

create or replace function public.activate_license_key(
  p_lodge_id uuid,
  p_license_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_license public.licenses%rowtype;
  v_bound_lodge text;
  v_subscription_state text;
begin
  select * into v_license
  from public.licenses l
  where upper(btrim(l.license_key)) = upper(btrim(p_license_key))
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'License key not found. Please check and try again.');
  end if;
  if coalesce(v_license.is_active, true) = false then
    return jsonb_build_object('success', false, 'error', 'This license key has been deactivated.');
  end if;

  v_subscription_state := public._subscription_state(v_license.payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_license.grace_period_days);
  if v_subscription_state in ('cancelled', 'expired', 'suspended') then
    return jsonb_build_object('success', false, 'error', 'This license key is not currently eligible for activation.');
  end if;

  v_bound_lodge := nullif(btrim(v_license.lodge_id::text), '');
  if v_bound_lodge is not null and lower(v_bound_lodge) <> 'unassigned' and v_bound_lodge <> p_lodge_id::text then
    return jsonb_build_object('success', false, 'error', 'This license key is already registered to another installation.');
  end if;

  update public.licenses
  set is_active = false,
      subscription_state = 'superseded',
      notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded during activation]'))
  where lodge_id::text = p_lodge_id::text
    and id <> v_license.id
    and coalesce(is_active, true) = true;

  update public.licenses
  set lodge_id = p_lodge_id::text,
      activated_at = coalesce(activated_at, now()),
      subscription_state = public._subscription_state(payment_status, next_due_date, expires_at, is_active, grace_period_days)
  where id = v_license.id;

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, v_license.id, null,
    'license_activated', 'completed',
    public._normalize_subscription_plan(v_license.subscription_plan),
    coalesce(v_license.plan_version_code, '2026.04'),
    jsonb_build_object('license_key', v_license.license_key)
  );

  return public.get_lodge_entitlement(p_lodge_id);
end;
$function$;

create or replace function public.issue_subscription_contract(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lodge_key text := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '');
  v_lodge_id uuid := case when coalesce(p_payload->>'lodge_id', '') ~ '^[0-9a-fA-F-]{36}$' then (p_payload->>'lodge_id')::uuid else null end;
  v_plan text := public._normalize_subscription_plan(p_payload->>'subscription_plan');
  v_plan_version_code text := coalesce(nullif(btrim(coalesce(p_payload->>'plan_version_code', '')), ''), '2026.04');
  v_payment_status text := lower(coalesce(nullif(btrim(coalesce(p_payload->>'payment_status', '')), ''), 'active'));
  v_grace_days integer := greatest(coalesce(nullif(p_payload->>'grace_period_days', '')::integer, 7), 0);
  v_offline_lease_days integer := greatest(least(coalesce(nullif(p_payload->>'offline_lease_days', '')::integer, 7), 30), 1);
  v_attempt integer := 0;
  v_license public.licenses%rowtype;
  v_invoice public.invoices%rowtype;
  v_invoice_number text;
  v_invoice_status text;
  v_create_invoice boolean := coalesce((p_payload->>'create_invoice')::boolean, false) or jsonb_typeof(p_payload->'invoice') = 'object';
  v_amount numeric := coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, 0);
  v_invoice_amount numeric;
begin
  if v_lodge_key is null then
    return jsonb_build_object('success', false, 'error', 'A lodge must be selected before issuing a subscription.');
  end if;

  update public.licenses
  set is_active = false,
      subscription_state = 'superseded',
      notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by a newer subscription contract]'))
  where lodge_id::text = v_lodge_key
    and coalesce(is_active, true) = true;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.licenses (
        lodge_id, license_key, lodge_name, business_type, expires_at, notes,
        subscription_plan, payment_status, monthly_fee, currency, next_due_date,
        last_payment_date, is_active, plan_version_code, grace_period_days,
        offline_lease_days, activated_at, subscription_state
      ) values (
        v_lodge_key,
        public._generate_license_key(),
        coalesce(p_payload->>'lodge_name', ''),
        coalesce(nullif(p_payload->>'business_type', ''), 'lodge'),
        nullif(p_payload->>'expires_at', '')::timestamptz,
        nullif(p_payload->>'notes', ''),
        v_plan,
        v_payment_status,
        v_amount,
        coalesce(nullif(p_payload->>'currency', ''), 'BWP'),
        nullif(p_payload->>'next_due_date', '')::date,
        nullif(p_payload->>'last_payment_date', '')::date,
        true,
        v_plan_version_code,
        v_grace_days,
        v_offline_lease_days,
        now(),
        public._subscription_state(v_payment_status, nullif(p_payload->>'next_due_date', '')::date, nullif(p_payload->>'expires_at', '')::timestamptz, true, v_grace_days)
      )
      returning * into v_license;
      exit;
    exception
      when unique_violation then
        if v_attempt >= 8 then
          raise;
        end if;
    end;
  end loop;

  if v_create_invoice then
    if v_lodge_id is null then
      raise exception 'Subscription invoices require a valid lodge UUID.';
    end if;

    v_invoice_amount := coalesce(nullif(p_payload #>> '{invoice,amount}', '')::numeric, v_amount, 0);
    v_invoice_status := coalesce(nullif(lower(p_payload #>> '{invoice,status}'), ''), case when v_payment_status in ('trial', 'free') then 'draft' else 'paid' end);
    v_invoice_number := nullif(p_payload #>> '{invoice,invoice_number}', '');
    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(v_lodge_id);
    end if;

    insert into public.invoices (
      invoice_number, lodge_id, lodge_name, license_id, package_name,
      amount, currency, status, issued_date, paid_date, due_date, description, notes
    ) values (
      v_invoice_number,
      v_lodge_id,
      coalesce(nullif(p_payload #>> '{invoice,lodge_name}', ''), coalesce(p_payload->>'lodge_name', '')),
      v_license.id,
      v_plan,
      v_invoice_amount,
      coalesce(nullif(p_payload #>> '{invoice,currency}', ''), coalesce(nullif(p_payload->>'currency', ''), 'BWP')),
      v_invoice_status,
      coalesce(nullif(p_payload #>> '{invoice,issued_date}', '')::date, current_date),
      nullif(p_payload #>> '{invoice,paid_date}', '')::date,
      nullif(p_payload #>> '{invoice,due_date}', '')::date,
      nullif(coalesce(p_payload #>> '{invoice,description}', p_payload->>'notes'), ''),
      nullif(p_payload #>> '{invoice,notes}', '')
    )
    returning * into v_invoice;
  end if;

  perform public._record_subscription_event(
    v_lodge_id, v_lodge_key, v_license.id, v_invoice.id,
    'subscription_issued', 'completed', v_plan, v_plan_version_code,
    jsonb_build_object('payment_status', v_payment_status, 'subscription_state', v_license.subscription_state, 'monthly_fee', coalesce(v_license.monthly_fee, 0), 'currency', v_license.currency, 'invoice_number', v_invoice.invoice_number)
  );

  return jsonb_build_object(
    'success', true,
    'license', to_jsonb(v_license),
    'invoice', case when v_invoice.id is null then null else to_jsonb(v_invoice) end,
    'entitlement', case when v_lodge_id is null then null else public.get_lodge_entitlement(v_lodge_id) end
  );
end;
$function$;

create or replace function public.update_subscription_contract(
  p_license_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before public.licenses%rowtype;
  v_after public.licenses%rowtype;
  v_lodge_key text;
  v_lodge_id uuid;
  v_plan text;
  v_payment_status text;
  v_grace_days integer;
  v_offline_lease_days integer;
  v_event_type text := 'subscription_updated';
begin
  select * into v_before
  from public.licenses
  where id = p_license_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Subscription record not found.');
  end if;

  v_lodge_key := coalesce(nullif(btrim(coalesce(p_payload->>'lodge_id', '')), ''), v_before.lodge_id::text);
  v_lodge_id := case when coalesce(v_lodge_key, '') ~ '^[0-9a-fA-F-]{36}$' then v_lodge_key::uuid else null end;
  v_plan := case when p_payload ? 'subscription_plan' then public._normalize_subscription_plan(p_payload->>'subscription_plan') else public._normalize_subscription_plan(v_before.subscription_plan) end;
  v_payment_status := lower(coalesce(nullif(btrim(coalesce(p_payload->>'payment_status', '')), ''), coalesce(v_before.payment_status, 'active')));
  v_grace_days := greatest(coalesce(nullif(p_payload->>'grace_period_days', '')::integer, v_before.grace_period_days, 7), 0);
  v_offline_lease_days := greatest(least(coalesce(nullif(p_payload->>'offline_lease_days', '')::integer, v_before.offline_lease_days, 7), 30), 1);

  if v_lodge_key <> coalesce(v_before.lodge_id::text, '') then
    update public.licenses
    set is_active = false,
        subscription_state = 'superseded',
        notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by subscription reassignment]'))
    where lodge_id::text = v_lodge_key
      and id <> p_license_id
      and coalesce(is_active, true) = true;
    v_event_type := 'subscription_reassigned';
  elsif v_plan <> public._normalize_subscription_plan(v_before.subscription_plan) then
    v_event_type := 'subscription_plan_changed';
  elsif (p_payload ? 'last_payment_date') or (p_payload ? 'next_due_date') then
    v_event_type := 'subscription_renewed';
  end if;

  update public.licenses
  set lodge_id = v_lodge_key,
      lodge_name = case when p_payload ? 'lodge_name' then coalesce(p_payload->>'lodge_name', lodge_name) else lodge_name end,
      business_type = case when p_payload ? 'business_type' then coalesce(nullif(p_payload->>'business_type', ''), business_type) else business_type end,
      subscription_plan = v_plan,
      payment_status = v_payment_status,
      monthly_fee = case when p_payload ? 'monthly_fee' then coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, monthly_fee) else monthly_fee end,
      currency = case when p_payload ? 'currency' then coalesce(nullif(p_payload->>'currency', ''), currency) else currency end,
      expires_at = case when p_payload ? 'expires_at' then nullif(p_payload->>'expires_at', '')::timestamptz else expires_at end,
      next_due_date = case when p_payload ? 'next_due_date' then nullif(p_payload->>'next_due_date', '')::date else next_due_date end,
      last_payment_date = case when p_payload ? 'last_payment_date' then nullif(p_payload->>'last_payment_date', '')::date else last_payment_date end,
      is_active = case when p_payload ? 'is_active' then coalesce((p_payload->>'is_active')::boolean, is_active) else is_active end,
      notes = case when p_payload ? 'notes' then nullif(p_payload->>'notes', '') else notes end,
      plan_version_code = coalesce(nullif(p_payload->>'plan_version_code', ''), plan_version_code, '2026.04'),
      grace_period_days = v_grace_days,
      offline_lease_days = v_offline_lease_days,
      cancelled_at = case when v_payment_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      suspended_at = case when public._subscription_state(v_payment_status, case when p_payload ? 'next_due_date' then nullif(p_payload->>'next_due_date', '')::date else next_due_date end, case when p_payload ? 'expires_at' then nullif(p_payload->>'expires_at', '')::timestamptz else expires_at end, case when p_payload ? 'is_active' then coalesce((p_payload->>'is_active')::boolean, is_active) else is_active end, v_grace_days) = 'suspended' then coalesce(suspended_at, now()) else suspended_at end,
      subscription_state = public._subscription_state(v_payment_status, case when p_payload ? 'next_due_date' then nullif(p_payload->>'next_due_date', '')::date else next_due_date end, case when p_payload ? 'expires_at' then nullif(p_payload->>'expires_at', '')::timestamptz else expires_at end, case when p_payload ? 'is_active' then coalesce((p_payload->>'is_active')::boolean, is_active) else is_active end, v_grace_days)
  where id = p_license_id
  returning * into v_after;

  perform public._record_subscription_event(
    v_lodge_id, v_lodge_key, v_after.id, null,
    v_event_type, 'completed', v_after.subscription_plan, coalesce(v_after.plan_version_code, '2026.04'),
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );

  return jsonb_build_object('success', true, 'license', to_jsonb(v_after), 'entitlement', case when v_lodge_id is null then null else public.get_lodge_entitlement(v_lodge_id) end);
end;
$function$;

create or replace function public.set_subscription_feature_override(
  p_lodge_id uuid,
  p_feature_name text,
  p_enabled boolean,
  p_reason text default null,
  p_expires_at timestamptz default null,
  p_review_at timestamptz default null,
  p_granted_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing public.lodge_features%rowtype;
begin
  select * into v_existing
  from public.lodge_features
  where lodge_id = p_lodge_id
    and feature_name = p_feature_name
  limit 1;

  insert into public.lodge_features (
    lodge_id, feature_name, enabled, updated_at, reason,
    expires_at, review_at, granted_by, granted_at
  ) values (
    p_lodge_id, p_feature_name, coalesce(p_enabled, true), now(),
    nullif(btrim(coalesce(p_reason, '')), ''), p_expires_at, p_review_at,
    p_granted_by, coalesce(v_existing.granted_at, now())
  )
  on conflict (lodge_id, feature_name)
  do update set
    enabled = excluded.enabled,
    updated_at = now(),
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    review_at = excluded.review_at,
    granted_by = excluded.granted_by,
    granted_at = coalesce(public.lodge_features.granted_at, excluded.granted_at);

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, null, null,
    'feature_override_set', 'completed', null, null,
    jsonb_build_object('feature_name', p_feature_name, 'enabled', coalesce(p_enabled, true), 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'expires_at', p_expires_at, 'review_at', p_review_at)
  );

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.clear_subscription_feature_override(
  p_lodge_id uuid,
  p_feature_name text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.lodge_features
  where lodge_id = p_lodge_id
    and feature_name = p_feature_name;

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, null, null,
    'feature_override_cleared', 'completed', null, null,
    jsonb_build_object('feature_name', p_feature_name)
  );

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.get_subscription_events(
  p_lodge_id uuid default null,
  p_limit integer default 100
) returns setof public.subscription_events
language sql
security definer
set search_path to 'public'
as $function$
  select se.*
  from public.subscription_events se
  where p_lodge_id is null or se.lodge_id = p_lodge_id
  order by se.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

grant execute on function public.get_lodge_entitlement(uuid) to anon, authenticated, service_role;
grant execute on function public.activate_license_key(uuid, text) to anon, authenticated, service_role;
grant execute on function public.issue_subscription_contract(jsonb) to authenticated, service_role;
grant execute on function public.update_subscription_contract(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_subscription_feature_override(uuid, text, boolean, text, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.clear_subscription_feature_override(uuid, text) to authenticated, service_role;
grant execute on function public.get_subscription_events(uuid, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
