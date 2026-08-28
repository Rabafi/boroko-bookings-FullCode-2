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

export function getMonthWindowIso(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dateStart = start.toISOString().slice(0, 10);
  const dateEnd = end.toISOString().slice(0, 10);
  return { start: start.toISOString(), end: end.toISOString(), dateStart, dateEnd, startDate: start, endDate: end };
}

function resolveQueuedItemCreatedAtRaw(item = {}) {
  return (
    item?.timestamp ||
    item?.createdAt ||
    item?.created_at ||
    item?.queued_at ||
    item?.data?.created_at_client ||
    item?.data?.payload?.created_at_client ||
    item?.data?.createdAt ||
    item?.data?.created_at ||
    item?.data?.queued_at ||
    new Date().toISOString());
}

function getPendingUsageQueueCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const queue = readSyncQueue();
  const { startDate, endDate } = getMonthWindowIso(targetMonthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  let pendingTargetMonthBookings = 0;
  let pendingCreationMonthBookings = 0;
  let pendingRooms = 0;
  let pendingUsers = 0;
  for (const item of queue) {
    if (item?.type !== 'rpc') continue;
    if (item?.table === 'create_booking') {
      const status = String(item?.data?.p_status || item?.data?.payload?.status || 'confirmed').toLowerCase();
      if (!['confirmed', 'checked_in', 'checked_out'].includes(status)) continue;
      if (item?.data?.payload?.is_exclusive_event === true || item?.data?.p_is_exclusive_event === true) continue;
      const checkInRaw = item?.data?.p_check_in || item?.data?.payload?.check_in;
      const checkIn = new Date(checkInRaw || 0);
      if (!Number.isFinite(checkIn.getTime())) continue;
      const createdAtRaw = resolveQueuedItemCreatedAtRaw(item);
      const createdAt = new Date(createdAtRaw);
      if (checkIn >= startDate && checkIn < endDate) pendingTargetMonthBookings += 1;
      if (Number.isFinite(createdAt.getTime()) && createdAt >= creationWindow.startDate && createdAt < creationWindow.endDate) {
        pendingCreationMonthBookings += 1;
      }
    } else if (item?.table === 'create_room') {
      pendingRooms += 1;
    } else if (item?.table === 'create_user') {
      pendingUsers += 1;
    }
  }
  return { pendingTargetMonthBookings, pendingCreationMonthBookings, pendingRooms, pendingUsers };
}

function getCachedMonthlyBookingUsage(now = new Date()) {
  return countMonthlyUsageBookings(readCache('bookings'), now);
}

function getCachedCreatedBookingUsage(now = new Date()) {
  return countMonthlyCreatedBookings(readCache('bookings'), now);
}

export function getCachedEntityUsageCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const pending = getPendingUsageQueueCounts({ targetMonthDate, creationMonthDate });
  const targetMonthBookings = getCachedMonthlyBookingUsage(targetMonthDate) + pending.pendingTargetMonthBookings;
  const creationMonthBookings = getCachedCreatedBookingUsage(creationMonthDate) + pending.pendingCreationMonthBookings;
  return {
    monthlyBookings: targetMonthBookings,
    targetMonthBookings,
    creationMonthBookings,
    rooms: readCache('rooms').length + pending.pendingRooms,
    users: readCache('users').length + pending.pendingUsers
  };
}

export function buildUsageSummary(plan, limits, usage, source) {
  const bookingAllowance = evaluateBookingCreationAllowance({
    plan,
    targetMonthUsed: usage.targetMonthBookings,
    createdMonthUsed: usage.creationMonthBookings
  });
  const roomStatus = canCreateRoom({ plan, used: usage.rooms });
  const userStatus = canCreateUser({ plan, used: usage.users });
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
