const ENTITLEMENT_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking'];
const PLAN_FEATURE_MAP = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, import: false, pos: false,
    inventory: false, supplies: false, online_booking: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, import: true, pos: false,
    inventory: false, supplies: false, online_booking: false
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true, online_booking: true
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
