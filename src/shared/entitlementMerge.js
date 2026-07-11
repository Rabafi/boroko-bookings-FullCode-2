import { getPlanFeatureMap, mergeFeatureOverrides } from '../main/domains/subscriptionState.js';

export function mergeEnterpriseAddons(baseFeatureMap, enabledAddons = []) {
  const merged = { ...baseFeatureMap };
  const addonFeatureMap = {
    corporate_accounts: ['corporate_accounts'],
    rate_plans: ['rate_plans'],
    custom_website: ['custom_website'],
    payment_gateway: ['payment_gateway'],
    channel_manager: ['channel_manager'],
    advanced_housekeeping_mobile: ['advanced_housekeeping'],
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
    documents: ['documents'],
    hotel_roles: ['hotel_roles'],
    room_attributes: ['room_attributes'],
    advanced_booking_engine: ['advanced_booking_engine'],
    operations_compliance: ['operations_compliance'],
    advanced_reports: ['advanced_reports'],
    room_attributes: ['room_attributes'],
    advanced_booking_engine: ['advanced_booking_engine']
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
