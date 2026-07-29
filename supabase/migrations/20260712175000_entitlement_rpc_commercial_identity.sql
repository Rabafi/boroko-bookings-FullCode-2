-- The online entitlement RPC must carry the commercial identity used by the
-- desktop access snapshot. Without this, a POS licence falls back to Pro-only
-- compatibility data after every refresh.

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
  select * into v_settings
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

  select * into v_license
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

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'product_id', v_license.product_id,
      'commercial_package_key', v_license.commercial_package_key,
      'commercial_catalog_version', v_license.commercial_catalog_version,
      'commercial_pricing_snapshot', v_license.commercial_pricing_snapshot,
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
      'effective_features', case
        when v_access_allowed then public._license_plan_features(v_plan, false, false) || coalesce(v_overrides, '{}'::jsonb)
        else public._license_plan_features(v_plan, false, true)
      end
    );
  end if;

  v_trial_end := coalesce(v_settings.trial_started_at, now()) + interval '30 days';
  if v_settings.trial_started_at is null then
    v_days_left := 30;
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
    'product_id', null,
    'commercial_package_key', null,
    'commercial_catalog_version', null,
    'commercial_pricing_snapshot', null,
    'plan_version_code', 'trial',
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
    'grace_period_days', 0,
    'grace_period_ends_at', null,
    'offline_lease_days', 30,
    'offline_valid_until', least(v_trial_end, now() + interval '30 days'),
    'source_license_id', null,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$function$;
