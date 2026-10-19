// @ts-check
import { readCache } from './cacheStore.js';
import { readSyncQueue } from './syncStore.js';
import {
  MONTHLY_USAGE_RESET_COPY,
  canCreateRoom,
  canCreateUser,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  getNextSubscriptionPlan,
  getPlanRecommendation
} from '../../shared/subscriptionPlans.js';

/** @typedef {Record<string, unknown>} UsagePropertyView */
/** @typedef {{isAbovePlan?: unknown, isBlocked?: unknown, isInGrace?: unknown, effectiveLimit?: unknown, used?: unknown}} UsageStatusView */
/** @typedef {{targetMonthStatus?: UsageStatusView, combinedStatus?: UsageStatusView, creationMonthStatus?: UsageStatusView, isBlocked?: unknown}} UsageBookingAllowanceView */
/** @typedef {{plan: string, limits: import('../../shared/subscriptionPlans.js').UsageLimits, usage: {monthlyBookings?: number, targetMonthBookings: number, creationMonthBookings: number, rooms: number, users: number}, source: string, statuses: {rooms?: UsageStatusView, users?: UsageStatusView, bookings?: UsageStatusView, bookingTargetMonth?: UsageStatusView, bookingCreationMonth?: UsageStatusView}, bookingAllowance: UsageBookingAllowanceView, recommendation: unknown, monthlyResetCopy: string, [field: string]: unknown}} UsageSummary */

/** @param {Date} [now] */
export function getMonthWindowIso(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dateStart = start.toISOString().slice(0, 10);
  const dateEnd = end.toISOString().slice(0, 10);
  return { start: start.toISOString(), end: end.toISOString(), dateStart, dateEnd, startDate: start, endDate: end };
}

/** @param {unknown} item */
function resolveQueuedItemCreatedAtRaw(item = {}) {
  const fields = /** @type {UsagePropertyView | null | undefined} */ (item)
  return (
    fields?.timestamp ||
    fields?.createdAt ||
    fields?.created_at ||
    fields?.queued_at ||
    (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.created_at_client ||
    (/** @type {UsagePropertyView | null | undefined} */ ((/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.payload))?.created_at_client ||
    (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.createdAt ||
    (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.created_at ||
    (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.queued_at ||
    new Date().toISOString());
}

/** @param {{targetMonthDate?: Date, creationMonthDate?: Date}} [options] */
function getPendingUsageQueueCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const queue = readSyncQueue();
  const { startDate, endDate } = getMonthWindowIso(targetMonthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  let pendingTargetMonthBookings = 0;
  let pendingCreationMonthBookings = 0;
  let pendingRooms = 0;
  let pendingUsers = 0;
  for (const item of queue) {
    const fields = /** @type {UsagePropertyView | null | undefined} */ (item)
    if (fields?.type !== 'rpc') continue;
    if (fields?.table === 'create_booking') {
      const status = String((/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.p_status || (/** @type {UsagePropertyView | null | undefined} */ ((/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.payload))?.status || 'confirmed').toLowerCase();
      if (!['confirmed', 'checked_in', 'checked_out'].includes(status)) continue;
      if ((/** @type {UsagePropertyView | null | undefined} */ ((/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.payload))?.is_exclusive_event === true || (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.p_is_exclusive_event === true) continue;
      const checkInRaw = (/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.p_check_in || (/** @type {UsagePropertyView | null | undefined} */ ((/** @type {UsagePropertyView | null | undefined} */ (fields?.data))?.payload))?.check_in;
      const checkIn = new Date(/** @type {string | number | Date} */ (checkInRaw || 0));
      if (!Number.isFinite(checkIn.getTime())) continue;
      const createdAtRaw = resolveQueuedItemCreatedAtRaw(item);
      const createdAt = new Date(/** @type {string | number | Date} */ (createdAtRaw));
      if (checkIn >= startDate && checkIn < endDate) pendingTargetMonthBookings += 1;
      if (Number.isFinite(createdAt.getTime()) && createdAt >= creationWindow.startDate && createdAt < creationWindow.endDate) {
        pendingCreationMonthBookings += 1;
      }
    } else if (fields?.table === 'create_room') {
      pendingRooms += 1;
    } else if (fields?.table === 'create_user') {
      pendingUsers += 1;
    }
  }
  return { pendingTargetMonthBookings, pendingCreationMonthBookings, pendingRooms, pendingUsers };
}

function getCachedMonthlyBookingUsage(now = new Date()) {
  // This call-site view preserves the shared helper's existing cache-row reads; it adds no validation.
  return countMonthlyUsageBookings(/** @type {Parameters<typeof countMonthlyUsageBookings>[0]} */ (readCache('bookings')), now);
}

function getCachedCreatedBookingUsage(now = new Date()) {
  return countMonthlyCreatedBookings(/** @type {Parameters<typeof countMonthlyCreatedBookings>[0]} */ (readCache('bookings')), now);
}

/** @param {{targetMonthDate?: Date, creationMonthDate?: Date}} [options] */
export function getCachedEntityUsageCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const pending = getPendingUsageQueueCounts({ targetMonthDate, creationMonthDate });
  const targetMonthBookings = getCachedMonthlyBookingUsage(targetMonthDate) + pending.pendingTargetMonthBookings;
  const creationMonthBookings = getCachedCreatedBookingUsage(creationMonthDate) + pending.pendingCreationMonthBookings;
  return {
    monthlyBookings: targetMonthBookings,
    targetMonthBookings,
    creationMonthBookings,
    rooms: /** @type {unknown[]} */ (readCache('rooms')).length + pending.pendingRooms,
    users: /** @type {unknown[]} */ (readCache('users')).length + pending.pendingUsers
  };
}

/** @param {string} plan @param {import('../../shared/subscriptionPlans.js').UsageLimits} limits @param {{monthlyBookings?: number, targetMonthBookings: number, creationMonthBookings: number, rooms: number, users: number}} usage @param {string} source @returns {UsageSummary} */
export function buildUsageSummary(plan, limits, usage, source) {
  const bookingAllowance = evaluateBookingCreationAllowance({
    plan,
    targetMonthUsed: usage.targetMonthBookings,
    createdMonthUsed: usage.creationMonthBookings,
    limits
  });
  const roomStatus = canCreateRoom({ plan, used: usage.rooms, limits });
  const userStatus = canCreateUser({ plan, used: usage.users, limits });
  const recommendation = getPlanRecommendation({
    plan,
    bookingsUsage: usage.targetMonthBookings ?? usage.monthlyBookings,
    roomsUsage: usage.rooms,
    usersUsage: usage.users,
    limits
  });

  return {
    plan,
    limits,
    usage,
    source,
    statuses: {
      bookings: bookingAllowance.combinedStatus,
      bookingTargetMonth: bookingAllowance.targetMonthStatus,
      bookingCreationMonth: bookingAllowance.creationMonthStatus,
      rooms: roomStatus,
      users: userStatus
    },
    bookingAllowance,
    recommendation,
    monthlyResetCopy: MONTHLY_USAGE_RESET_COPY
  };
}

/** @param {'booking' | 'room' | 'user'} resource @param {UsageSummary} summary */
function usageLimitErrorMessage(resource, summary) {
  const plan = summary.plan;
  const limits = summary.limits;
  if (resource === 'booking') {
    return 'Booking limit reached for the selected check-in month. Choose another check-in month or upgrade the plan.';
  }

  const nextPlan = getNextSubscriptionPlan(plan);
  if (resource === 'room') {
    if (summary.statuses?.rooms?.isAbovePlan) {
      return `This lodge is above the ${plan} plan room limit. Existing rooms remain available, but new rooms are restricted until usage is reduced or the plan is upgraded.`;
    }
    return `Room limit reached: ${plan} allows up to ${limits?.rooms} rooms. Upgrade to ${nextPlan} for more rooms.`;
  }
  if (summary.statuses?.users?.isAbovePlan) {
    return `This lodge is above the ${plan} plan user limit. Existing staff remain available, but new users are restricted until usage is reduced or the plan is upgraded.`;
  }
  return `User limit reached: ${plan} allows up to ${limits?.users} staff accounts. Upgrade to ${nextPlan} for more users.`;
}

/** @param {UsageSummary | null | undefined} summary */
export function buildUsageWarning(summary) {
  if (!summary) return '';
  const plan = summary.plan;
  if (summary.bookingAllowance?.targetMonthStatus?.isBlocked) {
    return 'The selected check-in month has reached its booking allowance. Another check-in month may still be available.';
  }
  if (summary.statuses?.rooms?.isAbovePlan || summary.statuses?.users?.isAbovePlan) {
    return `This lodge is above the ${plan} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.`;
  }
  if (summary.bookingAllowance?.combinedStatus?.isInGrace) {
    return 'You have reached the monthly booking limit and are using grace bookings. Upgrade now to avoid interruptions.';
  }
  return '';
}

/** @param {'booking' | 'room' | 'user'} resource @param {UsageSummary} summary */
export function finalizeUsageGate(resource, summary) {
  const status = resource === 'booking' ?
  summary.bookingAllowance?.combinedStatus :
  resource === 'room' ?
  summary.statuses?.rooms :
  summary.statuses?.users;

  const blocked = resource === 'booking' ?
  summary.bookingAllowance?.isBlocked :
  status?.isBlocked;

  if (blocked) {
    throw new Error(usageLimitErrorMessage(resource, summary));
  }

  summary.status = status;
  summary.warning = buildUsageWarning(summary);
  return summary;
}
