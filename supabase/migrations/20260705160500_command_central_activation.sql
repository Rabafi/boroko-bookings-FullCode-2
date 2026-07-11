-- Command Central Activation Pipeline (Enhanced)
-- Add activation audit log and enhanced subscription activation infrastructure.

-- ── 1. Activation Audit Log ───────────────────────────────────────────────────
create table if not exists public.activation_audit_log (
  id uuid primary key default gen_random_uuid(),
  license_id uuid,
  lodge_id uuid,
  action text not null,
  previous_plan text,
  new_plan text,
  previous_addons jsonb default '[]'::jsonb,
  new_addons jsonb default '[]'::jsonb,
  effective_features jsonb default '{}'::jsonb,
  activated_by text,
  activation_reason text,
  related_request_id uuid,
  created_at timestamptz not null default now()
);

alter table public.activation_audit_log enable row level security;

create policy activation_audit_log_admin_policy on public.activation_audit_log
  using (true);

revoke insert, update, delete on public.activation_audit_log from authenticated, anon;

create index if not exists activation_audit_log_license_idx on public.activation_audit_log (license_id, created_at desc);
create index if not exists activation_audit_log_lodge_idx on public.activation_audit_log (lodge_id, created_at desc);

-- ── 2. Sequence for document numbering ────────────────────────────────────────
create sequence if not exists public.seq_document_number start 1 increment 1;

-- ── 3. RPCs ───────────────────────────────────────────────────────────────────

-- Get effective feature flags
create or replace function public.get_effective_feature_flags(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license record;
  v_features jsonb;
  v_plan_map jsonb;
  v_overrides jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select l.* into v_license
  from public.licenses l
  where l.lodge_id = p_lodge_id
  order by l.created_at desc
  limit 1;

  if v_license is null then
    return '{}'::jsonb;
  end if;

  -- Get plan features from lodge_features
  select jsonb_object_agg(lf.feature_name, lf.enabled) into v_features
  from public.lodge_features lf
  where lf.lodge_id = p_lodge_id;

  -- Get feature overrides
  select jsonb_object_agg(lf.feature_name, lf.enabled) into v_overrides
  from public.lodge_features lf
  where lf.lodge_id = p_lodge_id and lf.reason like '%override%';

  return jsonb_build_object(
    'license_id', v_license.id,
    'subscription_plan', v_license.subscription_plan,
    'plan_features', coalesce(v_features, '{}'::jsonb),
    'overrides', coalesce(v_overrides, '{}'::jsonb),
    'effective_features', coalesce(v_features, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.get_effective_feature_flags(uuid) to authenticated;

-- Get activation history
create or replace function public.get_activation_history(
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', aal.id,
    'action', aal.action,
    'previous_plan', aal.previous_plan,
    'new_plan', aal.new_plan,
    'previous_addons', aal.previous_addons,
    'new_addons', aal.new_addons,
    'effective_features', aal.effective_features,
    'activated_by', aal.activated_by,
    'activation_reason', aal.activation_reason,
    'related_request_id', aal.related_request_id,
    'created_at', aal.created_at
  ) order by aal.created_at desc) into v_history
  from public.activation_audit_log aal
  where aal.license_id = p_license_id;

  return coalesce(v_history, '[]'::jsonb);
end;
$$;

grant execute on function public.get_activation_history(uuid) to authenticated;

-- Deactivate enterprise addon
create or replace function public.deactivate_enterprise_addon(
  p_lodge_id uuid,
  p_addon_key text,
  p_deactivated_by text default 'admin',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_name text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);

  v_feature_name := case
    when p_addon_key = 'corporate_accounts' then 'corporate_accounts'
    when p_addon_key = 'rate_plans' then 'rate_plans'
    when p_addon_key = 'custom_website' then 'custom_website'
    when p_addon_key = 'payment_gateway' then 'payment_gateway'
    when p_addon_key = 'channel_manager' then 'channel_manager'
    when p_addon_key = 'advanced_housekeeping' then 'advanced_housekeeping'
    when p_addon_key = 'guest_portal' then 'guest_portal'
    when p_addon_key = 'multi_property' then 'multi_property'
    when p_addon_key = 'advanced_rates' then 'advanced_rates'
    when p_addon_key = 'multi_outlet_pos' then 'multi_outlet_pos'
    when p_addon_key = 'linen_laundry' then 'linen_laundry'
    when p_addon_key = 'lost_found' then 'lost_found'
    else p_addon_key
  end;

  update public.lodge_features
  set enabled = false, updated_at = now()
  where lodge_id = p_lodge_id and feature_name = v_feature_name;

  insert into public.activation_audit_log (lodge_id, action, activated_by, activation_reason)
  values (p_lodge_id, 'addon_deactivated', p_deactivated_by, coalesce(p_reason, 'Manual deactivation'));

  return jsonb_build_object('success', true, 'addon_key', p_addon_key, 'feature_name', v_feature_name);
end;
$$;

grant execute on function public.deactivate_enterprise_addon(uuid, text, text, text) to authenticated;

-- Get pending upgrade requests (admin)
create or replace function public.get_pending_upgrade_requests(
  p_status text default 'pending'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requests jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', sr.id,
    'source', sr.source,
    'request_type', sr.request_type,
    'status', sr.status,
    'company_name', sr.company_name,
    'property_name', sr.property_name,
    'contact_name', sr.contact_name,
    'contact_email', sr.contact_email,
    'requested_plan', sr.requested_plan,
    'requested_addons', sr.requested_addons,
    'created_at', sr.created_at
  ) order by sr.created_at desc) into v_requests
  from public.subscription_requests sr
  where (p_status is null or sr.status = p_status)
  order by sr.created_at desc;

  return coalesce(v_requests, '[]'::jsonb);
end;
$$;

grant execute on function public.get_pending_upgrade_requests(text) to authenticated;

-- Enhanced activate_subscription_request to write activation_audit_log
create or replace function public.activate_subscription_request(
  p_request_id uuid,
  p_activated_by text default 'admin',
  p_activation_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_license_id uuid;
  v_lodge_id uuid;
  v_previous_plan text;
begin
  select * into v_request
  from public.subscription_requests
  where id = p_request_id;

  if v_request is null then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  v_license_id := (p_activation_payload->>'license_id')::uuid;
  v_lodge_id := (p_activation_payload->>'lodge_id')::uuid;
  v_previous_plan := v_request.current_plan;

  -- Record activation audit
  insert into public.activation_audit_log (
    license_id, lodge_id, action,
    previous_plan, new_plan,
    previous_addons, new_addons,
    effective_features, activated_by,
    activation_reason, related_request_id
  )
  values (
    v_license_id, v_lodge_id, 'subscription_activated',
    v_previous_plan, p_activation_payload->>'plan',
    coalesce(v_request.requested_addons::jsonb, '[]'::jsonb),
    coalesce(p_activation_payload->'enterprise_addons', '[]'::jsonb),
    coalesce(p_activation_payload->'effective_features', '{}'::jsonb),
    p_activated_by,
    p_activation_payload->>'activation_reason',
    p_request_id
  );

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.activate_subscription_request(uuid, text, jsonb) to authenticated;
