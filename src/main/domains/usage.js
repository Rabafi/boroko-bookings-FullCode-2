import { state } from '../state.js';
import {
  MONTHLY_USAGE_RESET_COPY,
  canCreateBooking,
  canCreateRoom,
  canCreateUser,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  getNextSubscriptionPlan,
  getPlanUsageLimits,
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

export async function getCreationUsageSummary(targetLodgeId = state.lodgeId, { monthDate = new Date(), creationMonthDate = new Date(), forceRemoteRefresh = false } = {}) {
  const entitlement = await getTrialStatus(targetLodgeId).catch(() => null);
  const plan = normalizeSubscriptionPlan(entitlement?.plan || 'Starter');
  const limits = getPlanUsageLimits(plan);
  if (!state.isOnline && !forceRemoteRefresh || !targetLodgeId) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  const { dateStart, dateEnd } = getMonthWindowIso(monthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  const [bookingsResult, createdBookingsResult, roomsResult, usersResult] = await Promise.all([
  state.supabase.
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('check_in', dateStart).
  lt('check_in', dateEnd),
  state.supabase.
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('created_at', creationWindow.start).
  lt('created_at', creationWindow.end),
  state.supabase.
  from('rooms').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId),
  state.supabase.
  from('users').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId)]
  );

  if (bookingsResult.error || createdBookingsResult.error || roomsResult.error || usersResult.error) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  state.lastUsageSyncAt = new Date().toISOString();
  return {
    ...buildUsageSummary(plan, limits, {
      monthlyBookings: Number(bookingsResult.count || 0),
      targetMonthBookings: Number(bookingsResult.count || 0),
      creationMonthBookings: Number(createdBookingsResult.count || 0),
      rooms: Number(roomsResult.count || 0),
      users: Number(usersResult.count || 0)
    }, 'remote'),
    lastUsageSyncAt: state.lastUsageSyncAt
  };
}

export async function getUsageLimitSnapshot(options = {}) {
  const monthDate = options?.monthDate ? new Date(options.monthDate) : new Date();
  const summary = await getCreationUsageSummary(state.lodgeId, {
    monthDate,
    creationMonthDate: new Date(),
    forceRemoteRefresh: options?.forceRemoteRefresh === true
  });
  return {
    ...summary,
    stale: summary.source !== 'remote',
    warning: buildUsageWarning(summary)
  };
}

export async function assertCreationWithinUsageLimit(resource, options = {}) {
  const targetMonthDate = options.targetMonthDate || options.monthDate || new Date();
  const creationMonthDate = options.creationMonthDate || new Date();
  const summary = await getCreationUsageSummary(state.lodgeId, {
    monthDate: targetMonthDate,
    creationMonthDate,
    forceRemoteRefresh: options.forceRemoteRefresh === true
  });
  return finalizeUsageGate(resource, summary);
}
