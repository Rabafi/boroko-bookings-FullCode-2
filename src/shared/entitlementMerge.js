import { getPlanFeatureMap, mergeFeatureOverrides } from '../main/domains/subscriptionState.js';

export function mergeEnterpriseAddons(baseFeatureMap, enabledAddons = []) {
  const merged = { ...baseFeatureMap };
  /**
   * Only optional / premium activation keys map here.
   * Hotel Core features (rate_plans, documents, hotel_roles, room_attributes,
   * corporate_accounts basic, advanced_housekeeping readiness) are granted by
   * the Enterprise/Hotel Core plan map — not by re-purchasing add-ons.
   *
   * Legacy add-on keys for now-core modules still map for historical licences
   * that stored those keys without the updated plan feature set.
   */
  const addonFeatureMap = {
    // Legacy core keys (harmless if already true on Core)
    corporate_accounts: ['corporate_accounts'],
    rate_plans: ['rate_plans'],
    documents: ['documents'],
    hotel_roles: ['hotel_roles'],
    room_attributes: ['room_attributes'],
    // True premium / requestable add-ons
    custom_website: ['custom_website'],
    payment_gateway: ['payment_gateway'],
    channel_manager: ['channel_manager'],
    // Mobile/analytics pack — distinct from core readiness housekeeping
    advanced_housekeeping_mobile: ['advanced_housekeeping', 'housekeeping_command_center'],
    guest_portal: ['guest_portal'],
    multi_property: ['multi_property'],
    advanced_rates: ['advanced_rates', 'rate_calendar', 'promo_codes'],
    linen_laundry: ['linen_laundry'],
    lost_found: ['lost_found'],
    incident_log: ['incident_log'],
    visitor_register: ['visitor_register'],
    emergency_list: ['emergency_list'],
    multi_outlet_pos: ['multi_outlet_pos'],
    guest_messaging: ['guest_messaging'],
    guest_crm: ['guest_crm'],
    advanced_booking_engine: ['advanced_booking_engine'],
    operations_compliance: ['operations_compliance', 'incident_log', 'visitor_register', 'emergency_list', 'linen_laundry'],
    advanced_reports: ['advanced_reports'],
    group_operations: ['group_operations'],
    staff_operations_workforce: ['workforce_management'],
    maintenance_asset_management: ['asset_management'],
    events_venue_management: ['venue_management']
  };
  for (const addonKey of enabledAddons) {
    const features = addonFeatureMap[addonKey] || [];
    for (const feature of features) {
      merged[feature] = true;
    }
  }
  return merged;
}

export function computeEffectiveFeatures(plan, enabledAddons = [], overrides = []) {
  const base = getPlanFeatureMap(plan);
  const withOverrides = mergeFeatureOverrides(base, overrides);
  return mergeEnterpriseAddons(withOverrides, enabledAddons);
}

export function getLockedFeatures(plan, enabledAddons = [], overrides = []) {
  const effective = computeEffectiveFeatures(plan, enabledAddons, overrides);
  return Object.entries(effective).filter(([, enabled]) => !enabled).map(([key]) => key);
}

export function getUnlockedFeatures(plan, enabledAddons = [], overrides = []) {
  const effective = computeEffectiveFeatures(plan, enabledAddons, overrides);
  return Object.entries(effective).filter(([, enabled]) => enabled).map(([key]) => key);
}

export function canAccessFeature(feature, plan, enabledAddons = [], overrides = []) {
  const effective = computeEffectiveFeatures(plan, enabledAddons, overrides);
  return effective[feature] === true;
}
