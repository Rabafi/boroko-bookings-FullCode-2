-- Clean up ::text casts in subscription functions after licenses.lodge_id became uuid
-- Run this AFTER 20260526_normalize_remaining_lodge_ids.sql succeeds.

begin;

-- 1. get_lodge_entitlement
create or replace function public.get_lodge_entitlement(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
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
  where l.lodge_id = p_lodge_id
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

-- 2. activate_license_key
create or replace function public.activate_license_key(
  p_lodge_id uuid,
  p_license_key text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_license public.licenses%rowtype;
  v_bound_lodge uuid;
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

  v_bound_lodge := v_license.lodge_id;
  if v_bound_lodge is not null and v_bound_lodge <> p_lodge_id then
    return jsonb_build_object('success', false, 'error', 'This license key is already registered to another installation.');
  end if;

  update public.licenses
  set is_active = false,
      subscription_state = 'superseded',
      notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded during activation]'))
  where lodge_id = p_lodge_id
    and id <> v_license.id
    and coalesce(is_active, true) = true;

  update public.licenses
  set lodge_id = p_lodge_id,
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

-- 3. issue_subscription_contract
create or replace function public.issue_subscription_contract(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
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
  where lodge_id = v_lodge_id
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
        v_lodge_id,
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
      lodge_id, invoice_number, total_amount, status, issued_at, due_date, notes
    ) values (
      v_lodge_id,
      v_invoice_number,
      v_invoice_amount,
      v_invoice_status,
      now(),
      coalesce(nullif(p_payload #>> '{invoice,due_date}', '')::date, now()::date + 30),
      coalesce(nullif(p_payload #>> '{invoice,notes}', ''), 'Subscription invoice')
    )
    returning * into v_invoice;

    perform public._record_subscription_event(
      v_lodge_id, v_lodge_id::text, v_license.id, v_invoice.id,
      'subscription_contract_issued', 'completed',
      public._normalize_subscription_plan(v_license.subscription_plan),
      coalesce(v_license.plan_version_code, '2026.04'),
      jsonb_build_object('invoice_number', v_invoice.invoice_number, 'amount', v_invoice_amount, 'status', v_invoice_status)
    );
  end if;

  return jsonb_build_object('success', true, 'license_id', v_license.id, 'license_key', v_license.license_key);
end;
$function$;

-- 4. update_subscription_contract
create or replace function public.update_subscription_contract(
  p_license_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_before public.licenses%rowtype;
  v_lodge_key text;
  v_lodge_id uuid;
  v_plan text;
  v_payment_status text;
  v_event_type text := 'subscription_updated';
begin
  select *
  into v_before
  from public.licenses
  where id = p_license_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Subscription record not found.');
  end if;

  v_lodge_key := coalesce(nullif(btrim(coalesce(p_payload->>'lodge_id', '')), ''), v_before.lodge_id::text);
  v_lodge_id := case when coalesce(v_lodge_key, '') ~ '^[0-9a-fA-F-]{36}$' then v_lodge_key::uuid else v_before.lodge_id end;
  v_plan := case when p_payload ? 'subscription_plan' then public._normalize_subscription_plan(p_payload->>'subscription_plan') else public._normalize_subscription_plan(v_before.subscription_plan) end;
  v_payment_status := lower(coalesce(nullif(btrim(coalesce(p_payload->>'payment_status', '')), ''), coalesce(v_before.payment_status, 'active')));

  if v_lodge_id is distinct from v_before.lodge_id then
    update public.licenses
    set is_active = false,
        subscription_state = 'superseded',
        notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by subscription reassignment]'))
    where lodge_id = v_lodge_id
      and id <> p_license_id
      and coalesce(is_active, true) = true;
    v_event_type := 'subscription_reassigned';
  elsif v_plan <> public._normalize_subscription_plan(v_before.subscription_plan) then
    v_event_type := 'subscription_plan_changed';
  elsif (p_payload ? 'last_payment_date') or (p_payload ? 'next_due_date') then
    v_event_type := 'subscription_renewed';
  end if;

  update public.licenses
  set lodge_id = v_lodge_id,
      subscription_plan = v_plan,
      payment_status = v_payment_status,
      monthly_fee = case when p_payload ? 'monthly_fee' then coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, monthly_fee) else monthly_fee end,
      expires_at = case when p_payload ? 'expires_at' then nullif(p_payload->>'expires_at', '')::timestamptz else expires_at end,
      next_due_date = case when p_payload ? 'next_due_date' then nullif(p_payload->>'next_due_date', '')::date else next_due_date end,
      last_payment_date = case when p_payload ? 'last_payment_date' then nullif(p_payload->>'last_payment_date', '')::date else last_payment_date end,
      notes = case when p_payload ? 'notes' then coalesce(nullif(p_payload->>'notes', ''), notes) else notes end
  where id = p_license_id;

  perform public._record_subscription_event(
    coalesce(v_lodge_id, v_before.lodge_id),
    coalesce(v_lodge_id, v_before.lodge_id)::text,
    p_license_id, null,
    v_event_type, 'completed',
    public._normalize_subscription_plan(v_plan),
    coalesce(v_before.plan_version_code, '2026.04'),
    jsonb_build_object('previous_plan', public._normalize_subscription_plan(v_before.subscription_plan), 'new_plan', public._normalize_subscription_plan(v_plan))
  );

  return jsonb_build_object('success', true, 'license_id', p_license_id);
end;
$function$;

-- Re-grants
grant execute on function public.get_lodge_entitlement(uuid) to anon, authenticated, service_role;
grant execute on function public.activate_license_key(uuid, text) to anon, authenticated, service_role;
grant execute on function public.issue_subscription_contract(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_subscription_contract(uuid, jsonb) to anon, authenticated, service_role;

commit;
