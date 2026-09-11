-- Hotfix: _license_plan_features was deployed with 63 key/value pairs passed
-- to jsonb_build_object (126 arguments). PostgreSQL accepts at most 100
-- arguments per function call, so entitlement resolution failed during login.
-- Build the same complete feature map from rows instead of a variadic call.

create or replace function public._license_plan_features(
  p_plan text,
  p_trial boolean default false,
  p_expired boolean default false
) returns jsonb
language plpgsql immutable
as $$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
  v_all_features text[] := array[
    'basic_reports', 'starter_backup', 'starter_backup_automation',
    'staff_basic', 'prepayments_basic', 'prepayments_management', 'prepayments_advanced',
    'reports', 'expenses', 'staff', 'pwa', 'audit',
    'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking',
    'hotel_mode', 'room_types', 'room_attributes', 'physical_inventory',
    'floors_sections', 'front_desk_dashboard', 'folios',
    'advanced_housekeeping', 'hotel_kpis', 'corporate_accounts', 'rate_plans',
    'custom_website', 'payment_gateway', 'channel_manager', 'multi_property',
    'room_moves', 'subscription_builder', 'advanced_rates', 'rate_calendar',
    'promo_codes', 'advanced_reports', 'guest_portal', 'multi_outlet_pos',
    'linen_laundry', 'lost_found', 'incident_log', 'visitor_register', 'emergency_list',
    'housekeeping_command_center', 'maintenance_enterprise', 'group_operations',
    'operations_compliance', 'guest_messaging', 'guest_crm', 'documents', 'hotel_roles',
    'night_audit_enterprise', 'checkin_workflow', 'early_late_checkout',
    'cancellation_policies', 'advanced_booking_engine', 'workforce_management',
    'asset_management', 'venue_management'
  ];
  v_enabled_features text[] := array[]::text[];
  v_enable_all boolean := false;
  v_result jsonb;
begin
  if p_expired then
    null;
  elsif p_trial then
    v_enable_all := true;
  elsif v_plan in ('enterprise', 'hotel', 'resort') then
    v_enabled_features := array[
      'basic_reports', 'starter_backup', 'starter_backup_automation',
      'staff_basic', 'prepayments_basic', 'prepayments_management', 'prepayments_advanced',
      'reports', 'expenses', 'staff', 'pwa', 'audit',
      'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking',
      'hotel_mode', 'room_types', 'room_attributes', 'physical_inventory',
      'floors_sections', 'front_desk_dashboard', 'folios',
      'advanced_housekeeping', 'hotel_kpis', 'corporate_accounts', 'rate_plans',
      'room_moves', 'subscription_builder', 'housekeeping_command_center',
      'maintenance_enterprise', 'documents', 'hotel_roles', 'night_audit_enterprise',
      'checkin_workflow', 'early_late_checkout', 'cancellation_policies'
    ];
  elsif v_plan in ('pro', 'premium') then
    v_enabled_features := array[
      'basic_reports', 'starter_backup', 'starter_backup_automation',
      'staff_basic', 'prepayments_basic', 'prepayments_management', 'prepayments_advanced',
      'reports', 'expenses', 'staff', 'pwa', 'audit',
      'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking'
    ];
  elsif v_plan = 'standard' then
    v_enabled_features := array[
      'basic_reports', 'starter_backup', 'starter_backup_automation',
      'staff_basic', 'prepayments_basic', 'prepayments_management',
      'reports', 'expenses', 'staff', 'audit', 'conference', 'pool', 'import'
    ];
  else
    v_enabled_features := array[
      'basic_reports', 'starter_backup', 'starter_backup_automation',
      'staff_basic', 'prepayments_basic'
    ];
  end if;

  select jsonb_object_agg(feature_name, v_enable_all or feature_name = any(v_enabled_features))
    into v_result
  from unnest(v_all_features) as features(feature_name);

  return v_result;
end;
$$;

notify pgrst, 'reload schema';
