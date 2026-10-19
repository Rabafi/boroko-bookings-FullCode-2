// @ts-check
import { state } from '../state.js';
import {
  MONTHLY_USAGE_RESET_COPY,
  canCreateBooking,
  canCreateRoom,
  canCreateUser,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  getEffectiveUsageLimits,
  getNextSubscriptionPlan,
  getPlanRecommendation,
  normalizeSubscriptionPlan
} from '../../shared/subscriptionPlans.js';
import { getTrialStatus } from './entitlements.js';
import {
  buildUsageSummary,
  buildUsageWarning,
  finalizeUsageGate,
  getCachedEntityUsageCounts,
  getMonthWindowIso
} from './usageSupport.js';

/** @typedef {Record<string, unknown>} UsageOptionsView */

export {
  MONTHLY_USAGE_RESET_COPY,
  canCreateBooking,
  canCreateRoom,
  canCreateUser,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  getNextSubscriptionPlan,
  getPlanRecommendation,
  normalizeSubscriptionPlan
};

/** @param {string | null} [targetLodgeId] @param {{monthDate?: Date, creationMonthDate?: Date, forceRemoteRefresh?: boolean}} [options] */
export async function getCreationUsageSummary(targetLodgeId = state.lodgeId, { monthDate = new Date(), creationMonthDate = new Date(), forceRemoteRefresh = false } = {}) {
  const entitlement = await getTrialStatus(targetLodgeId).catch(() => null);
  const plan = normalizeSubscriptionPlan(entitlement?.plan || 'Starter');
  const limits = getEffectiveUsageLimits(entitlement || {}, plan);
  if (!state.isOnline && !forceRemoteRefresh || !targetLodgeId) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  const { dateStart, dateEnd } = getMonthWindowIso(monthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  const [bookingsResult, createdBookingsResult, roomsResult, usersResult] = await Promise.all([
  /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('check_in', dateStart).
  lt('check_in', dateEnd),
  /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('created_at', creationWindow.start).
  lt('created_at', creationWindow.end),
  /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
  from('rooms').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId),
  /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
  from('users').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId)]
  );

  if (bookingsResult.error || roomsResult.error || usersResult.error) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  const cachedUsage = createdBookingsResult.error
    ? getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate })
    : null;
  state.lastUsageSyncAt = new Date().toISOString();
  return {
    ...buildUsageSummary(plan, limits, {
      monthlyBookings: Number(bookingsResult.count || 0),
      targetMonthBookings: Number(bookingsResult.count || 0),
      creationMonthBookings: createdBookingsResult.error
        ? Number(cachedUsage?.creationMonthBookings || 0)
        : Number(createdBookingsResult.count || 0),
      rooms: Number(roomsResult.count || 0),
      users: Number(usersResult.count || 0)
    }, 'remote'),
    creationMonthSource: createdBookingsResult.error ? 'cache' : 'remote',
    lastUsageSyncAt: state.lastUsageSyncAt
  };
}

/** @param {unknown} [options] */
export async function getUsageLimitSnapshot(options = {}) {
  const optionView = /** @type {UsageOptionsView | null | undefined} */ (options)
  const monthDate = optionView?.monthDate ? new Date(/** @type {string | number | Date} */ (optionView.monthDate)) : new Date();
  const summary = await getCreationUsageSummary(state.lodgeId, {
    monthDate,
    creationMonthDate: new Date(),
    forceRemoteRefresh: optionView?.forceRemoteRefresh === true
  });
  return {
    ...summary,
    stale: summary.source !== 'remote',
    warning: buildUsageWarning(summary)
  };
}

/** @param {'booking' | 'room' | 'user'} resource @param {{targetMonthDate?: Date, monthDate?: Date, creationMonthDate?: Date, forceRemoteRefresh?: boolean, requestedUnits?: number}} [options] */
export async function assertCreationWithinUsageLimit(resource, options = {}) {
  const targetMonthDate = options.targetMonthDate || options.monthDate || new Date();
  const creationMonthDate = options.creationMonthDate || new Date();
  const summary = await getCreationUsageSummary(state.lodgeId, {
    monthDate: targetMonthDate,
    creationMonthDate,
    forceRemoteRefresh: options.forceRemoteRefresh === true
  });
  const finalized = finalizeUsageGate(resource, summary);
  if (resource === 'booking') {
    const requestedUnits = Math.max(1, Math.floor(Number(options.requestedUnits) || 1));
    const status = finalized.bookingAllowance?.targetMonthStatus;
    const rawEffectiveLimit = status?.effectiveLimit;
    const effectiveLimit = Number(rawEffectiveLimit);
    const used = Math.max(0, Number(status?.used) || 0);
    const hasFiniteLimit = rawEffectiveLimit !== null && rawEffectiveLimit !== undefined && rawEffectiveLimit !== '' && Number.isFinite(effectiveLimit);
    if (hasFiniteLimit && used + requestedUnits > effectiveLimit) {
      const remaining = Math.max(0, effectiveLimit - used);
      throw new Error(
        `Only ${remaining} booking${remaining === 1 ? '' : 's'} remain for the selected check-in month; this booking needs ${requestedUnits}.`
      );
    }
  }
  return finalized;
}
