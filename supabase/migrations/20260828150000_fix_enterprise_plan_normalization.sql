-- Fix Enterprise plan normalization for Hotel Core
create or replace function public._normalize_subscription_plan(p_plan text) returns text
language plpgsql immutable
as $$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if v_plan in ('premium', 'pro') then return 'Pro'; end if;
  if v_plan = 'standard' then return 'Standard'; end if;
  if v_plan in ('enterprise', 'hotel', 'resort') then return 'Enterprise'; end if;
  return 'Starter';
end;
$$;

create or replace function public._license_plan_features(p_plan text, p_trial boolean default false, p_expired boolean default false) returns jsonb
language plpgsql immutable
as $$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if p_expired then
    return jsonb_build_object(
      'basic_reports', false, 'starter_backup', false, 'starter_backup_automation', false,
      'staff_basic', false, 'prepayments_basic', false, 'prepayments_management', false, 'prepayments_advanced', false,
      'reports', false, 'expenses', false, 'staff', false, 'pwa', false, 'audit', false,
      'conference', false, 'pool', false, 'import', false, 'pos', false, 'inventory', false, 'supplies', false,
      'online_booking', false, 'hotel_mode', false, 'room_types', false, 'room_attributes', false, 'physical_inventory', false,
      'floors_sections', false, 'front_desk_dashboard', false, 'folios', false,
      'advanced_housekeeping', false, 'hotel_kpis', false, 'corporate_accounts', false,
      'rate_plans', false, 'custom_website', false, 'payment_gateway', false,
      'channel_manager', false, 'multi_property', false, 'room_moves', false, 'subscription_builder', false,
      'advanced_rates', false, 'rate_calendar', false, 'promo_codes', false, 'advanced_reports', false, 'guest_portal', false, 'multi_outlet_pos', false,
      'linen_laundry', false, 'lost_found', false, 'incident_log', false,
      'visitor_register', false, 'emergency_list', false,
      'housekeeping_command_center', false, 'maintenance_enterprise', false, 'group_operations', false, 'operations_compliance', false,
      'guest_messaging', false, 'guest_crm', false, 'documents', false, 'hotel_roles', false,
      'night_audit_enterprise', false, 'checkin_workflow', false, 'early_late_checkout', false,
      'cancellation_policies', false, 'advanced_booking_engine', false,
      'workforce_management', false, 'asset_management', false, 'venue_management', false
    );
  end if;
  if p_trial then
    return jsonb_build_object(
      'basic_reports', true, 'starter_backup', true, 'starter_backup_automation', true,
      'staff_basic', true, 'prepayments_basic', true, 'prepayments_management', true, 'prepayments_advanced', true,
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', true, 'inventory', true, 'supplies', true, 'online_booking', true,
      'hotel_mode', true, 'room_types', true, 'room_attributes', true, 'physical_inventory', true,
      'floors_sections', true, 'front_desk_dashboard', true, 'folios', true,
      'advanced_housekeeping', true, 'hotel_kpis', true, 'corporate_accounts', true,
      'rate_plans', true, 'custom_website', true, 'payment_gateway', true,
      'channel_manager', true, 'multi_property', true, 'room_moves', true, 'subscription_builder', true,
      'advanced_rates', true, 'rate_calendar', true, 'promo_codes', true, 'advanced_reports', true, 'guest_portal', true, 'multi_outlet_pos', true,
      'linen_laundry', true, 'lost_found', true, 'incident_log', true,
      'visitor_register', true, 'emergency_list', true,
      'housekeeping_command_center', true, 'maintenance_enterprise', true, 'group_operations', true, 'operations_compliance', true,
      'guest_messaging', true, 'guest_crm', true, 'documents', true, 'hotel_roles', true,
      'night_audit_enterprise', true, 'checkin_workflow', true, 'early_late_checkout', true,
      'cancellation_policies', true, 'advanced_booking_engine', true,
      'workforce_management', true, 'asset_management', true, 'venue_management', true
    );
  end if;
  if v_plan in ('enterprise', 'hotel', 'resort') then
    return jsonb_build_object(
      'basic_reports', true, 'starter_backup', true, 'starter_backup_automation', true,
      'staff_basic', true, 'prepayments_basic', true, 'prepayments_management', true, 'prepayments_advanced', true,
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', true, 'inventory', true, 'supplies', true, 'online_booking', true,
      'hotel_mode', true, 'room_types', true, 'room_attributes', true, 'physical_inventory', true,
      'floors_sections', true, 'front_desk_dashboard', true, 'folios', true,
      'advanced_housekeeping', true, 'hotel_kpis', true, 'corporate_accounts', true,
      'rate_plans', true, 'custom_website', false, 'payment_gateway', false,
      'channel_manager', false, 'multi_property', false, 'room_moves', true, 'subscription_builder', true,
      'advanced_rates', false, 'rate_calendar', false, 'promo_codes', false, 'advanced_reports', false, 'guest_portal', false, 'multi_outlet_pos', false,
      'linen_laundry', false, 'lost_found', false, 'incident_log', false,
      'visitor_register', false, 'emergency_list', false,
      'housekeeping_command_center', true, 'maintenance_enterprise', true, 'group_operations', false, 'operations_compliance', false,
      'guest_messaging', false, 'guest_crm', false, 'documents', true, 'hotel_roles', true,
      'night_audit_enterprise', true, 'checkin_workflow', true, 'early_late_checkout', true,
      'cancellation_policies', true, 'advanced_booking_engine', false,
      'workforce_management', false, 'asset_management', false, 'venue_management', false
    );
  end if;
  if v_plan in ('pro', 'premium') then
    return jsonb_build_object(
      'basic_reports', true, 'starter_backup', true, 'starter_backup_automation', true,
      'staff_basic', true, 'prepayments_basic', true, 'prepayments_management', true, 'prepayments_advanced', true,
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', true, 'inventory', true, 'supplies', true, 'online_booking', true,
      'hotel_mode', false, 'room_types', false, 'room_attributes', false, 'physical_inventory', false,
      'floors_sections', false, 'front_desk_dashboard', false, 'folios', false,
      'advanced_housekeeping', false, 'hotel_kpis', false, 'corporate_accounts', false,
      'rate_plans', false, 'custom_website', false, 'payment_gateway', false,
      'channel_manager', false, 'multi_property', false, 'room_moves', false, 'subscription_builder', false,
      'advanced_rates', false, 'rate_calendar', false, 'promo_codes', false, 'advanced_reports', false, 'guest_portal', false, 'multi_outlet_pos', false,
      'linen_laundry', false, 'lost_found', false, 'incident_log', false,
      'visitor_register', false, 'emergency_list', false,
      'housekeeping_command_center', false, 'maintenance_enterprise', false, 'group_operations', false, 'operations_compliance', false,
      'guest_messaging', false, 'guest_crm', false, 'documents', false, 'hotel_roles', false,
      'night_audit_enterprise', false, 'checkin_workflow', false, 'early_late_checkout', false,
      'cancellation_policies', false, 'advanced_booking_engine', false,
      'workforce_management', false, 'asset_management', false, 'venue_management', false
    );
  end if;
  if v_plan = 'standard' then
    return jsonb_build_object(
      'basic_reports', true, 'starter_backup', true, 'starter_backup_automation', true,
      'staff_basic', true, 'prepayments_basic', true, 'prepayments_management', true, 'prepayments_advanced', false,
      'reports', true, 'expenses', true, 'staff', true, 'pwa', false, 'audit', true,
      'conference', true, 'pool', true, 'import', true, 'pos', false, 'inventory', false, 'supplies', false, 'online_booking', false,
      'hotel_mode', false, 'room_types', false, 'room_attributes', false, 'physical_inventory', false,
      'floors_sections', false, 'front_desk_dashboard', false, 'folios', false,
      'advanced_housekeeping', false, 'hotel_kpis', false, 'corporate_accounts', false,
      'rate_plans', false, 'custom_website', false, 'payment_gateway', false,
      'channel_manager', false, 'multi_property', false, 'room_moves', false, 'subscription_builder', false,
      'advanced_rates', false, 'rate_calendar', false, 'promo_codes', false, 'advanced_reports', false, 'guest_portal', false, 'multi_outlet_pos', false,
      'linen_laundry', false, 'lost_found', false, 'incident_log', false,
      'visitor_register', false, 'emergency_list', false,
      'housekeeping_command_center', false, 'maintenance_enterprise', false, 'group_operations', false, 'operations_compliance', false,
      'guest_messaging', false, 'guest_crm', false, 'documents', false, 'hotel_roles', false,
      'night_audit_enterprise', false, 'checkin_workflow', false, 'early_late_checkout', false,
      'cancellation_policies', false, 'advanced_booking_engine', false,
      'workforce_management', false, 'asset_management', false, 'venue_management', false
    );
  end if;
  return jsonb_build_object(
    'basic_reports', true, 'starter_backup', true, 'starter_backup_automation', true,
    'staff_basic', true, 'prepayments_basic', true, 'prepayments_management', false, 'prepayments_advanced', false,
    'reports', false, 'expenses', false, 'staff', false, 'pwa', false, 'audit', false,
    'conference', false, 'pool', false, 'import', false, 'pos', false, 'inventory', false, 'supplies', false, 'online_booking', false,
    'hotel_mode', false, 'room_types', false, 'room_attributes', false, 'physical_inventory', false,
    'floors_sections', false, 'front_desk_dashboard', false, 'folios', false,
    'advanced_housekeeping', false, 'hotel_kpis', false, 'corporate_accounts', false,
    'rate_plans', false, 'custom_website', false, 'payment_gateway', false,
    'channel_manager', false, 'multi_property', false, 'room_moves', false, 'subscription_builder', false,
    'advanced_rates', false, 'rate_calendar', false, 'promo_codes', false, 'advanced_reports', false, 'guest_portal', false, 'multi_outlet_pos', false,
    'linen_laundry', false, 'lost_found', false, 'incident_log', false,
    'visitor_register', false, 'emergency_list', false,
    'housekeeping_command_center', false, 'maintenance_enterprise', false, 'group_operations', false, 'operations_compliance', false,
    'guest_messaging', false, 'guest_crm', false, 'documents', false, 'hotel_roles', false,
    'night_audit_enterprise', false, 'checkin_workflow', false, 'early_late_checkout', false,
    'cancellation_policies', false, 'advanced_booking_engine', false,
    'workforce_management', false, 'asset_management', false, 'venue_management', false
  );
end;
$$;
notify pgrst, 'reload schema';
