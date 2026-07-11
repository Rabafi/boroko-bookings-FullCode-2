const ENTITLEMENT_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking', 'hotel_mode', 'room_types', 'room_attributes', 'physical_inventory', 'floors_sections', 'front_desk_dashboard', 'folios', 'advanced_housekeeping', 'hotel_kpis', 'corporate_accounts', 'rate_plans', 'custom_website', 'payment_gateway', 'channel_manager', 'multi_property', 'room_moves', 'subscription_builder', 'advanced_rates', 'rate_calendar', 'promo_codes', 'advanced_reports', 'guest_portal', 'multi_outlet_pos', 'linen_laundry', 'lost_found', 'incident_log', 'visitor_register', 'emergency_list', 'housekeeping_command_center', 'maintenance_enterprise', 'group_operations', 'operations_compliance', 'guest_messaging', 'guest_crm', 'documents', 'hotel_roles', 'night_audit_enterprise', 'checkin_workflow', 'early_late_checkout', 'cancellation_policies', 'advanced_booking_engine'];
const PLAN_FEATURE_MAP = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, import: false, pos: false,
    inventory: false, supplies: false, online_booking: false,
    hotel_mode: false, room_types: false, room_attributes: false, physical_inventory: false,
    floors_sections: false, front_desk_dashboard: false, folios: false,
    advanced_housekeeping: false, hotel_kpis: false, corporate_accounts: false,
    rate_plans: false, custom_website: false, payment_gateway: false,
    channel_manager: false, multi_property: false,
    room_moves: false, subscription_builder: false,
    advanced_rates: false, rate_calendar: false, promo_codes: false, advanced_reports: false, guest_portal: false, multi_outlet_pos: false,
    linen_laundry: false, lost_found: false, incident_log: false,
    visitor_register: false, emergency_list: false,
    housekeeping_command_center: false, maintenance_enterprise: false, group_operations: false, operations_compliance: false,
    guest_messaging: false, guest_crm: false, documents: false, hotel_roles: false,
    night_audit_enterprise: false, checkin_workflow: false, early_late_checkout: false,
    cancellation_policies: false, advanced_booking_engine: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, import: true, pos: false,
    inventory: false, supplies: false, online_booking: false,
    hotel_mode: false, room_types: false, room_attributes: false, physical_inventory: false,
    floors_sections: false, front_desk_dashboard: false, folios: false,
    advanced_housekeeping: false, hotel_kpis: false, corporate_accounts: false,
    rate_plans: false, custom_website: false, payment_gateway: false,
    channel_manager: false, multi_property: false,
    room_moves: false, subscription_builder: false,
    advanced_rates: false, rate_calendar: false, promo_codes: false, advanced_reports: false, guest_portal: false, multi_outlet_pos: false,
    linen_laundry: false, lost_found: false, incident_log: false,
    visitor_register: false, emergency_list: false,
    housekeeping_command_center: false, maintenance_enterprise: false, group_operations: false, operations_compliance: false,
    guest_messaging: false, guest_crm: false, documents: false, hotel_roles: false,
    night_audit_enterprise: false, checkin_workflow: false, early_late_checkout: false,
    cancellation_policies: false, advanced_booking_engine: false
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true, online_booking: true,
    hotel_mode: false, room_types: false, room_attributes: false, physical_inventory: false,
    floors_sections: false, front_desk_dashboard: false, folios: false,
    advanced_housekeeping: false, hotel_kpis: false, corporate_accounts: false,
    rate_plans: false, custom_website: false, payment_gateway: false,
    channel_manager: false, multi_property: false,
    room_moves: false, subscription_builder: false,
    advanced_rates: false, rate_calendar: false, promo_codes: false, advanced_reports: false, guest_portal: false, multi_outlet_pos: false,
    linen_laundry: false, lost_found: false, incident_log: false,
    visitor_register: false, emergency_list: false,
    housekeeping_command_center: false, maintenance_enterprise: false, group_operations: false, operations_compliance: false,
    guest_messaging: false, guest_crm: false, documents: false, hotel_roles: false,
    night_audit_enterprise: false, checkin_workflow: false, early_late_checkout: false,
    cancellation_policies: false, advanced_booking_engine: false
  },
  Enterprise: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true, online_booking: true,
    hotel_mode: true, room_types: true, room_attributes: false, physical_inventory: true,
    floors_sections: true, front_desk_dashboard: true, folios: true,
    advanced_housekeeping: true, hotel_kpis: true, corporate_accounts: false,
    rate_plans: false, custom_website: true, payment_gateway: true,
    channel_manager: true, multi_property: false,
    room_moves: true, subscription_builder: true,
    advanced_rates: false, rate_calendar: false, promo_codes: false, advanced_reports: false, guest_portal: false, multi_outlet_pos: false,
    linen_laundry: true, lost_found: true, incident_log: true,
    visitor_register: true, emergency_list: true,
    housekeeping_command_center: true, maintenance_enterprise: true, group_operations: true, operations_compliance: false,
    guest_messaging: false, guest_crm: false, documents: false, hotel_roles: false,
    night_audit_enterprise: true, checkin_workflow: true, early_late_checkout: true,
    cancellation_policies: true, advanced_booking_engine: false
  }
};

export const DEFAULT_SUBSCRIPTION_GRACE_DAYS = 7;
export const DEFAULT_OFFLINE_LEASE_DAYS = 7;

export function normalizePlanName(plan) {
  const raw = String(plan || '').trim().toLowerCase();
  if (!raw) return 'Starter';
  if (raw === 'basic') return 'Starter';
  if (raw === 'premium') return 'Pro';
  if (raw === 'trial') return 'Pro';
  if (raw === 'starter') return 'Starter';
  if (raw === 'standard') return 'Standard';
  if (raw === 'pro') return 'Pro';
  if (raw === 'enterprise') return 'Enterprise';
  if (raw === 'hotel') return 'Enterprise';
  if (raw === 'resort') return 'Enterprise';
  return 'Starter';
}

function cloneFeatureMap(map = {}) {
  return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, map[feature] !== false]));
}

export function toPositiveInt(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function addDays(dateValue, days) {
  const value = new Date(dateValue || Date.now());
  value.setDate(value.getDate() + days);
  return value;
}

function minDate(values = []) {
  const valid = values.
  map((value) => value ? new Date(value) : null).
  filter((value) => value && Number.isFinite(value.getTime()));
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid.map((value) => value.getTime())));
}

export function computeSubscriptionState({
  payment_status,
  next_due_date,
  expires_at,
  is_active = true,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS
} = {}) {
  if (is_active === false) return 'inactive';

  const rawStatus = String(payment_status || 'active').trim().toLowerCase() || 'active';
  if (rawStatus === 'cancelled') return 'cancelled';

  if (expires_at) {
    const expiry = new Date(expires_at);
    if (Number.isFinite(expiry.getTime()) && expiry < new Date()) {
      return 'expired';
    }
  }

  if (rawStatus === 'suspended' || rawStatus === 'paused') return 'suspended';
  if (rawStatus === 'trial') return 'trial';
  if (rawStatus === 'free') return 'active';

  if (next_due_date) {
    const dueDate = new Date(next_due_date);
    if (Number.isFinite(dueDate.getTime())) {
      const today = new Date();
      const dueStart = new Date(dueDate);
      dueStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      if (dueStart < todayStart) {
        const graceEnd = addDays(dueStart, Math.max(Number(grace_period_days || 0), 0) + 1);
        return graceEnd < today ? 'suspended' : 'grace_period';
      }
    }
  }

  if (rawStatus === 'overdue') return 'grace_period';
  return 'active';
}

export function subscriptionAllowsAccess(state) {
  return state === 'active' || state === 'grace_period' || state === 'trial';
}

export function computeGracePeriodEnd(nextDueDate, gracePeriodDays = DEFAULT_SUBSCRIPTION_GRACE_DAYS) {
  if (!nextDueDate) return null;
  const dueDate = new Date(nextDueDate);
  if (!Number.isFinite(dueDate.getTime())) return null;
  return addDays(dueDate, Math.max(Number(gracePeriodDays || 0), 0) + 1).toISOString();
}

export function computeOfflineValidUntil({
  subscription_state,
  expires_at,
  next_due_date,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  offline_lease_days = DEFAULT_OFFLINE_LEASE_DAYS,
  trial_end = null
} = {}) {
  if (subscription_state && !subscriptionAllowsAccess(subscription_state)) {
    return new Date().toISOString();
  }

  const leaseEnd = addDays(new Date(), toPositiveInt(offline_lease_days, DEFAULT_OFFLINE_LEASE_DAYS));
  const candidates = [leaseEnd];
  const graceEnd = computeGracePeriodEnd(next_due_date, grace_period_days);
  if (graceEnd) candidates.push(graceEnd);
  if (expires_at) candidates.push(expires_at);
  if (trial_end) candidates.push(trial_end);
  return (minDate(candidates) || leaseEnd).toISOString();
}

export function getPlanFeatureMap(plan, { trial = false, expired = false } = {}) {
  if (trial) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, true]));
  if (expired) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, false]));
  return cloneFeatureMap(PLAN_FEATURE_MAP[normalizePlanName(plan)] || PLAN_FEATURE_MAP.Starter);
}

export function mergeFeatureOverrides(baseMap = {}, overrides = []) {
  const next = { ...baseMap };
  for (const row of overrides || []) {
    const featureName = String(row?.feature_name || '').trim();
    if (!featureName) continue;
    next[featureName] = row?.enabled !== false;
  }
  return next;
}
