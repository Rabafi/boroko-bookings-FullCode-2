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
    return jsonb_build_object(
      'reports', false, 'expenses', false, 'staff', false, 'audit', false,
      'conference', false, 'pool', false, 'import', false, 'pos', false,
      'inventory', false, 'supplies', false
    );
  end if;

  if p_trial then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', true,
      'inventory', true, 'supplies', true
    );
  end if;

  if v_plan in ('pro', 'premium') then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', true,
      'inventory', true, 'supplies', true
    );
  end if;

  if v_plan = 'standard' then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', false,
      'inventory', false, 'supplies', false
    );
  end if;

  return jsonb_build_object(
    'reports', false, 'expenses', false, 'staff', false, 'audit', false,
    'conference', false, 'pool', false, 'import', false, 'pos', false,
    'inventory', false, 'supplies', false
  );
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
  where lf.lodge_id = p_lodge_id;

  select *
  into v_license
  from public.licenses l
  where l.lodge_id::text = p_lodge_id::text
    and coalesce(l.is_active, true) = true
  order by
    case
      when lower(coalesce(l.payment_status, '')) = 'cancelled' then 2
      when l.expires_at is not null and l.expires_at < now() then 1
      else 0
    end,
    l.expires_at desc nulls last,
    l.issued_at desc nulls last
  limit 1;

  if found then
    v_plan := case lower(coalesce(v_license.subscription_plan, ''))
      when 'premium' then 'Pro'
      when 'pro' then 'Pro'
      when 'standard' then 'Standard'
      when 'basic' then 'Starter'
      when 'starter' then 'Starter'
      else 'Starter'
    end;
    v_payment_status := lower(coalesce(v_license.payment_status, 'active'));
    v_expired := v_payment_status = 'cancelled'
      or coalesce(v_license.is_active, true) = false
      or (v_license.expires_at is not null and v_license.expires_at < now());

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_expired then 'expired' else 'licensed' end,
      'daysLeft', null,
      'expired', v_expired,
      'plan', v_plan,
      'payment_status', v_payment_status,
      'monthly_fee', coalesce(v_license.monthly_fee, 0),
      'currency', v_license.currency,
      'next_due_date', v_license.next_due_date,
      'expires_at', v_license.expires_at,
      'lodge_name', coalesce(v_license.lodge_name, v_settings.lodge_name, v_settings.company_name),
      'effective_features',
        case
          when v_expired then public._license_plan_features(v_plan, false, true)
          else public._license_plan_features(v_plan, false, false) || coalesce(v_overrides, '{}'::jsonb)
        end
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
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
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
begin
  select *
  into v_license
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

  if lower(coalesce(v_license.payment_status, '')) = 'cancelled' then
    return jsonb_build_object('success', false, 'error', 'This license key has been cancelled.');
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'This license key has expired.');
  end if;

  v_bound_lodge := nullif(btrim(v_license.lodge_id::text), '');
  if v_bound_lodge is not null
     and lower(v_bound_lodge) <> 'unassigned'
     and v_bound_lodge <> p_lodge_id::text then
    return jsonb_build_object('success', false, 'error', 'This license key is already registered to another installation.');
  end if;

  update public.licenses
  set lodge_id = p_lodge_id::text
  where id = v_license.id;

  return public.get_lodge_entitlement(p_lodge_id);
end;
$function$;

grant execute on function public.get_lodge_entitlement(uuid) to anon, authenticated, service_role;
grant execute on function public.activate_license_key(uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
