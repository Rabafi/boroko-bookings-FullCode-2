// @ts-check

/** @typedef {'Starter' | 'Standard' | 'Pro' | 'Enterprise'} PlanName */
/** @typedef {'inactive' | 'cancelled' | 'expired' | 'suspended' | 'trial' | 'grace_period' | 'active'} SubscriptionState */
/** @typedef {Record<string, boolean>} FeatureMap */
/** @typedef {{payment_status?: unknown, next_due_date?: unknown, expires_at?: unknown, is_active?: unknown, grace_period_days?: unknown}} SubscriptionStateInput */
/** @typedef {{subscription_state?: unknown, expires_at?: unknown, next_due_date?: unknown, grace_period_days?: unknown, offline_lease_days?: unknown, trial_end?: unknown}} OfflineValidityInput */

const ENTITLEMENT_FEATURES = ['basic_reports', 'starter_backup', 'starter_backup_automation', 'staff_basic', 'prepayments_basic', 'prepayments_management', 'prepayments_advanced', 'reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking', 'hotel_mode', 'room_types', 'room_attributes', 'physical_inventory', 'floors_sections', 'front_desk_dashboard', 'folios', 'advanced_housekeeping', 'hotel_kpis', 'corporate_accounts', 'rate_plans', 'custom_website', 'payment_gateway', 'channel_manager', 'multi_property', 'room_moves', 'subscription_builder', 'advanced_rates', 'rate_calendar', 'promo_codes', 'advanced_reports', 'guest_portal', 'multi_outlet_pos', 'linen_laundry', 'lost_found', 'incident_log', 'visitor_register', 'emergency_list', 'housekeeping_command_center', 'maintenance_enterprise', 'group_operations', 'operations_compliance', 'guest_messaging', 'guest_crm', 'documents', 'hotel_roles', 'night_audit_enterprise', 'checkin_workflow', 'early_late_checkout', 'cancellation_policies', 'advanced_booking_engine', 'workforce_management', 'asset_management', 'venue_management'];
const PLAN_FEATURE_MAP = {
  Starter: {
    basic_reports: true, starter_backup: true, starter_backup_automation: true, staff_basic: true, prepayments_basic: true, prepayments_management: false, prepayments_advanced: false, reports: false, expenses: false, staff: false, pwa: false, audit: false,
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
    cancellation_policies: false, advanced_booking_engine: false,
    workforce_management: false, asset_management: false, venue_management: false
  },
  Standard: {
    basic_reports: true, starter_backup: true, starter_backup_automation: true, staff_basic: true, prepayments_basic: true, prepayments_management: true, prepayments_advanced: false, reports: true, expenses: true, staff: true, pwa: false, audit: true,
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
    cancellation_policies: false, advanced_booking_engine: false,
    workforce_management: false, asset_management: false, venue_management: false
  },
  Pro: {
    basic_reports: true, starter_backup: true, starter_backup_automation: true, staff_basic: true, prepayments_basic: true, prepayments_management: true, prepayments_advanced: true, reports: true, expenses: true, staff: true, pwa: true, audit: true,
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
    cancellation_policies: false, advanced_booking_engine: false,
    workforce_management: false, asset_management: false, venue_management: false
  },
  /**
   * Enterprise / Hotel Core plan map.
   * true  = included in Hotel Core (or internal Enterprise plan)
   * false = optional add-on / planned premium — must not unlock on a clean Core licence
   */
  Enterprise: {
    basic_reports: true, starter_backup: true, starter_backup_automation: true, staff_basic: true, prepayments_basic: true, prepayments_management: true, prepayments_advanced: true, reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true, online_booking: true,
    hotel_mode: true, room_types: true, room_attributes: true, physical_inventory: true,
    floors_sections: true, front_desk_dashboard: true, folios: true,
    advanced_housekeeping: true, hotel_kpis: true, corporate_accounts: true,
    rate_plans: true, custom_website: false, payment_gateway: false,
    channel_manager: false, multi_property: false,
    room_moves: true, subscription_builder: true,
    advanced_rates: false, rate_calendar: false, promo_codes: false, advanced_reports: false, guest_portal: false, multi_outlet_pos: false,
    linen_laundry: false, lost_found: false, incident_log: false,
    visitor_register: false, emergency_list: false,
    housekeeping_command_center: true, maintenance_enterprise: true, group_operations: false, operations_compliance: false,
    guest_messaging: false, guest_crm: false, documents: true, hotel_roles: true,
    night_audit_enterprise: true, checkin_workflow: true, early_late_checkout: true,
    cancellation_policies: true, advanced_booking_engine: false,
    workforce_management: false, asset_management: false, venue_management: false
  }
};

export const DEFAULT_SUBSCRIPTION_GRACE_DAYS = 7;
export const DEFAULT_OFFLINE_LEASE_DAYS = 7;

/** @param {unknown} plan @returns {PlanName} */
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

/** @param {Record<string, unknown>} [map] @returns {FeatureMap} */
function cloneFeatureMap(map = {}) {
  // Fail-closed: unknown/missing features default to false so a new
  // entitlement key never unlocks on old plans until explicitly granted.
  return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, map[feature] === true]));
}

/** @param {unknown} value @param {number} fallback @returns {number} */
export function toPositiveInt(value, fallback) {
  // parseInt performs its native string coercion at runtime.
  const numeric = Number.parseInt(/** @type {string} */ (value), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** @param {unknown} dateValue @param {number} days @returns {Date} */
export function addDays(dateValue, days) {
  // Date construction intentionally keeps native coercion for cache/RPC values.
  const value = /** @type {Date} */ (Reflect.construct(Date, [dateValue || Date.now()]));
  value.setDate(value.getDate() + days);
  return value;
}

/** @param {unknown[]} [values] @returns {Date | null} */
function minDate(values = []) {
  const valid = values.
  map((value) => value ? /** @type {Date} */ (Reflect.construct(Date, [value])) : null).
  filter(/** @type {(value: Date | null) => value is Date} */ (
    (value) => value !== null && Number.isFinite(value.getTime())
  ));
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid.map((value) => value.getTime())));
}

/** @param {SubscriptionStateInput} [input] @returns {SubscriptionState} */
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
    const expiry = /** @type {Date} */ (Reflect.construct(Date, [expires_at]));
    if (Number.isFinite(expiry.getTime()) && expiry < new Date()) {
      return 'expired';
    }
  }

  if (rawStatus === 'suspended' || rawStatus === 'paused') return 'suspended';
  if (rawStatus === 'trial') return 'trial';
  if (rawStatus === 'free') return 'active';

  if (next_due_date) {
    const dueDate = /** @type {Date} */ (Reflect.construct(Date, [next_due_date]));
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

/** @param {unknown} state @returns {state is 'active' | 'grace_period' | 'trial'} */
export function subscriptionAllowsAccess(state) {
  return state === 'active' || state === 'grace_period' || state === 'trial';
}

/** @param {unknown} nextDueDate @param {unknown} [gracePeriodDays] @returns {string | null} */
export function computeGracePeriodEnd(nextDueDate, gracePeriodDays = DEFAULT_SUBSCRIPTION_GRACE_DAYS) {
  if (!nextDueDate) return null;
  const dueDate = /** @type {Date} */ (Reflect.construct(Date, [nextDueDate]));
  if (!Number.isFinite(dueDate.getTime())) return null;
  return addDays(dueDate, Math.max(Number(gracePeriodDays || 0), 0) + 1).toISOString();
}

/** @param {OfflineValidityInput} [input] @returns {string} */
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
  /** @type {unknown[]} */
  const candidates = [leaseEnd];
  const graceEnd = computeGracePeriodEnd(next_due_date, grace_period_days);
  if (graceEnd) candidates.push(graceEnd);
  if (expires_at) candidates.push(expires_at);
  if (trial_end) candidates.push(trial_end);
  return (minDate(candidates) || leaseEnd).toISOString();
}

/** @param {unknown} plan @param {{trial?: unknown, expired?: unknown}} [options] @returns {FeatureMap} */
export function getPlanFeatureMap(plan, { trial = false, expired = false } = {}) {
  if (trial) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, true]));
  if (expired) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, false]));
  return cloneFeatureMap(PLAN_FEATURE_MAP[normalizePlanName(plan)] || PLAN_FEATURE_MAP.Starter);
}

/**
 * A boolean base map stays boolean-valued because copied values are booleans
 * and every override write is a boolean.
 * @overload
 * @param {Record<string, boolean>} baseMap
 * @param {unknown} [overrides]
 * @returns {Record<string, boolean>}
 */
/**
 * Other base maps retain their existing arbitrary values after object spread.
 * @overload
 * @param {unknown} baseMap
 * @param {unknown} [overrides]
 * @returns {Record<string, unknown>}
 */
/** @param {unknown} baseMap @param {unknown} [overrides] @returns {Record<string, unknown>} */
export function mergeFeatureOverrides(baseMap = {}, overrides = []) {
  // Type-only cast: object spread retains its native behavior for null and
  // primitive inputs; it does not claim the source has validated feature keys.
  /** @type {Record<string, unknown>} */
  const next = { .../** @type {object} */ (baseMap) };
  // The assertion preserves native for-of behavior (including malformed
  // non-iterable TypeErrors) without validating override rows.
  for (const row of /** @type {Iterable<unknown>} */ (overrides || [])) {
    const record = /** @type {Record<string, unknown> | null | undefined} */ (row);
    const featureName = String(record?.feature_name || '').trim();
    if (!featureName) continue;
    next[featureName] = record?.enabled !== false;
  }
  return next;
}
