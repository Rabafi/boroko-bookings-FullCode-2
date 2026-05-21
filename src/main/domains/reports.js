import { state } from '../state.js'
import {
  LOCAL_TIME_ZONE,
  getLocalDateKey,
  recordCriticalError
} from './operationalLog.js'
import {
  readCache,
  readSyncMeta
} from './infrastructure.js'
import { getAllRooms } from './rooms.js'
import { getAllBookings } from './bookings.js'
import { getExpenses } from './expenses.js'
import { getMaintenanceRowsForPeriod } from './maintenance.js'
import { getInventorySpend } from './inventory.js'
import { getPosOrders, getOutlets, getPosRevenueSummary } from './pos.js'
import { getSupplySpend, getRoomSupplyAllocations } from './supplies.js'
import { getConferenceBookings } from './conference.js'
import { getPoolDayUse } from './pool.js'

async function getAllExpenses() {
  return getExpenses('2000-01-01', '2099-12-31')
}

async function getAllPOSOrders() {
  return getPosOrders('2000-01-01', '2099-12-31')
}

async function getAllConferenceBookings() {
  return getConferenceBookings('2000-01-01', '2099-12-31')
}

async function getAllPoolDayUse() {
  return getPoolDayUse('2000-01-01', '2099-12-31')
}

let dashboardSnapshotWarningShown = false;

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export async function getOccupancyReport(startDate, endDate) {
  const rooms = await getAllRooms().catch((error) => {
    const cached = readCache('rooms');
    if (cached.length > 0) return cached;
    throw error;
  });
  const cachedBookingsInRange = readCache('bookings').filter(
    (b) => b.status !== 'cancelled' && b.status !== 'pending' && b.check_in <= endDate && b.check_out > startDate
  );
  let bookings = [];
  try {
    const { data, error } = await state.supabase.
    from('bookings').
    select('room_id, check_in, check_out, total_amount, charges_total, is_exclusive_event, status').
    eq('lodge_id', state.lodgeId).
    not('status', 'in', '("cancelled","pending")').
    lte('check_in', endDate).
    gt('check_out', startDate);
    if (error) throw error;
    bookings = (data || []).length === 0 && cachedBookingsInRange.length > 0 ?
    cachedBookingsInRange :
    data || [];
  } catch {
    bookings = cachedBookingsInRange;
  }

  // +1 for inclusive end-date: Jan 1–Jan 7 = 7 days, not 6
  const totalDays = Math.max(1, Math.round(
    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
  ) + 1);

  return rooms.map((room) => {
    const roomBookings = bookings.filter((b) => b.room_id === room.id);
    let nights = 0;
    for (const b of roomBookings) {
      const start = new Date(Math.max(new Date(b.check_in), new Date(startDate)));
      const end = new Date(Math.min(new Date(b.check_out), new Date(endDate)));
      nights += Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    }
    const actualRevenue = roomBookings.reduce((sum, b) => sum + (b.total_amount || 0) + (b.charges_total || 0), 0);
    const hasEvent = roomBookings.some((b) => b.is_exclusive_event);
    return {
      ...room,
      occupied_nights: nights,
      occupancy_rate: totalDays > 0 ? Math.round(nights / totalDays * 100) : 0,
      actual_revenue: actualRevenue,
      has_event: hasEvent
    };
  });
}

async function getRevenueReportLocal(startDate, endDate) {
  const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const computeInclusiveVat = (gross, vatEnabled, vatRate) => {
    const rate = vatEnabled ? Number(vatRate || 0) : 0;
    if (rate <= 0) return 0;
    return roundMoney(roundMoney(gross) * rate / (100 + rate));
  };
  const paymentWindowStart = `${startDate}T00:00:00`;
  const paymentWindowEnd = `${endDate}T23:59:59`;

  const cachedBookingsInRange = readCache('bookings').filter(
    (b) => b.check_in >= startDate && b.check_in <= endDate
  );
  let bookings = [];
  let paymentEvents = [];
  try {
    const [{ data: bookingRows, error: bookingError }, { data: paymentRows, error: paymentError }] = await Promise.all([
    state.supabase.
    from('bookings').
    select('id, total_amount, charges_total, amount_paid, status, payment_status, check_in, check_out, is_exclusive_event, notes, event_daily_rate, vat_enabled, vat_rate').
    eq('lodge_id', state.lodgeId).
    gte('check_in', startDate).
    lte('check_in', endDate),
    state.supabase.
    from('payments').
    select('booking_id, amount, method, type, paid_at').
    eq('lodge_id', state.lodgeId).
    gte('paid_at', paymentWindowStart).
    lte('paid_at', paymentWindowEnd)]
    );
    if (bookingError) throw bookingError;
    if (paymentError) throw paymentError;
    bookings = (bookingRows || []).length === 0 && cachedBookingsInRange.length > 0 ?
    cachedBookingsInRange :
    bookingRows || [];
    paymentEvents = paymentRows || [];
  } catch {
    bookings = cachedBookingsInRange;
    paymentEvents = [];
  }

  // Exclude cancelled bookings from all revenue aggregations.
  // Cancelled count is preserved from the raw fetch for informational reporting.
  // Guard: normalize status to '' so null/undefined values do not pass through as non-cancelled.
  const cancelledCount = bookings.filter((b) => (b.status || '') === 'cancelled').length;
  // Exclude both cancelled and pending: pending online requests are not financial commitments
  const revenueBookings = bookings.filter((b) => !['cancelled', 'pending'].includes(b.status || ''));
  const cancelledBookingIds = new Set(
    bookings.
    filter((booking) => (booking.status || '') === 'cancelled').
    map((booking) => booking.id).
    filter(Boolean)
  );
  const cancelledRetainedPayments = paymentEvents.filter((payment) => {
    if (!cancelledBookingIds.has(payment?.booking_id)) return false;
    return String(payment?.type || '').toLowerCase() !== 'refund';
  });
  const retainedRevenue = cancelledRetainedPayments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
  const cancelledRetained = Array.from(new Set(cancelledRetainedPayments.map((payment) => payment.booking_id).filter(Boolean)));

  // Split revenue-eligible bookings into regular vs exclusive-event room-rows.
  // allUnits is derived from revenueBookings ONLY — cancelled bookings must not affect
  // total_bookings, avg_booking_value, or any count/average derived from allUnits.
  const regularBookings = revenueBookings.filter((b) => !b.is_exclusive_event);
  const eventRows = revenueBookings.filter((b) => b.is_exclusive_event);

  // Collapse event room-rows into unique event groups (1 group = 1 event).
  // E5 FIX: accumulate charges_total from every room-row so folio charges on
  // event bookings are not silently dropped from event revenue.
  const eventGroupMap = {};
  eventRows.forEach((b) => {
    const match = b.notes?.match(/\[GROUP:([^\]]+)\]/);
    const groupId = match?.[1] || b.check_in;
    if (!eventGroupMap[groupId]) {
      const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / 86400000);
      eventGroupMap[groupId] = {
        group_id: groupId,
        check_in: b.check_in,
        check_out: b.check_out,
        nights,
        daily_rate: b.event_daily_rate || 0,
        total: (b.event_daily_rate || 0) * nights,
        charges_total: 0, // accumulated below from all room-rows
        room_count: 0,
        status: b.status,
        payment_status: b.payment_status,
        amount_paid: 0,
        vat_enabled: !!b.vat_enabled,
        vat_rate: Number(b.vat_rate || 0)
      };
    }
    eventGroupMap[groupId].room_count++;
    eventGroupMap[groupId].amount_paid += b.amount_paid || 0;
    // E5 FIX: sum charges_total across all rooms in this event group
    eventGroupMap[groupId].charges_total += b.charges_total || 0;
  });
  const uniqueEvents = Object.values(eventGroupMap);
  // E5 FIX: event group revenue = base (daily_rate*nights) + accumulated folio charges
  const eventRevenue = uniqueEvents.reduce((sum, e) => sum + e.total + e.charges_total, 0);
  // Include charges_total in revenue; || 0 guards against null/undefined on older rows
  const regularRevenue = regularBookings.reduce((sum, b) => sum + (b.total_amount || 0) + (b.charges_total || 0), 0);
  const totalRevenue = regularRevenue + eventRevenue;
  const totalPaid = regularBookings.reduce((sum, b) => sum + (b.amount_paid || 0), 0) +
  uniqueEvents.reduce((sum, e) => sum + e.amount_paid, 0);

  // Treat each unique event as 1 booking unit for counts / averages
  const allUnits = [...regularBookings, ...uniqueEvents];

  const regularVat = regularBookings.reduce(
    (sum, b) => sum + computeInclusiveVat(
      Number(b.total_amount || 0) + Number(b.charges_total || 0),
      b.vat_enabled,
      b.vat_rate
    ),
    0
  );
  const eventVat = uniqueEvents.reduce(
    (sum, e) => sum + computeInclusiveVat(
      Number(e.total || 0) + Number(e.charges_total || 0),
      e.vat_enabled,
      e.vat_rate
    ),
    0
  );
  const vatAmount = roundMoney(regularVat + eventVat);
  const vatRatesInUse = new Set(
    revenueBookings.
    map((b) => {
      const rate = Number(b?.vat_rate || 0);
      return b?.vat_enabled && rate > 0 ? rate : null;
    }).
    filter((rate) => rate !== null)
  );
  const vatRate = vatRatesInUse.size === 1 ? Array.from(vatRatesInUse)[0] : null;
  const bookingPaymentByMethod = {};
  let grossCollected = 0;
  let refundsIssued = 0;
  let netCashCollected = 0;

  for (const payment of paymentEvents) {
    const amount = Number(payment?.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    netCashCollected = roundMoney(netCashCollected + amount);
    if (amount > 0) {
      grossCollected = roundMoney(grossCollected + amount);
      const method = String(payment?.method || 'unknown');
      bookingPaymentByMethod[method] = roundMoney((bookingPaymentByMethod[method] || 0) + amount);
    } else {
      refundsIssued = roundMoney(refundsIssued + Math.abs(amount));
    }
  }

  return {
    total_revenue: totalRevenue,
    regular_revenue: regularRevenue,
    event_revenue: eventRevenue,
    event_count: uniqueEvents.length,
    event_bookings: uniqueEvents,
    total_bookings: allUnits.length,
    avg_booking_value: allUnits.length > 0 ? totalRevenue / allUnits.length : 0,
    confirmed_count: allUnits.filter((b) => b.status === 'confirmed').length,
    checked_in_count: allUnits.filter((b) => b.status === 'checked_in').length,
    checked_out_count: allUnits.filter((b) => b.status === 'checked_out').length,
    cancelled_count: cancelledCount,
    paid_count: allUnits.filter((b) => b.payment_status === 'paid').length,
    partial_count: allUnits.filter((b) => b.payment_status === 'partial').length,
    unpaid_count: allUnits.filter((b) => !b.payment_status || b.payment_status === 'unpaid').length,
    paid_revenue: netCashCollected,
    cash_collected: netCashCollected,
    gross_collected: grossCollected,
    refunds_issued: refundsIssued,
    amount_paid_snapshot: totalPaid,
    retained_revenue: retainedRevenue,
    retained_count: cancelledRetained.length,
    outstanding_amount: totalRevenue - totalPaid,
    vat_enabled: vatRatesInUse.size > 0,
    vat_rate: vatRate,
    vat_mixed: vatRatesInUse.size > 1,
    vat_amount: vatAmount,
    net_revenue: +(totalRevenue - vatAmount).toFixed(2),
    booking_payment_by_method: bookingPaymentByMethod
  };
}

export async function getRevenueReport(startDate, endDate) {
  if (!startDate || !endDate) throw new Error('Revenue report requires a start date and end date.');
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_revenue_report', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      if (error) throw error;
      if (data && typeof data === 'object') return { ...data, source: 'server', as_of_range: { start: startDate, end: endDate } };
      throw new Error('Revenue report summary was empty.');
    } catch (error) {
      recordCriticalError('reports.revenue', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  try {
    return {
      ...(await getRevenueReportLocal(startDate, endDate)),
      source: 'local',
      as_of_range: { start: startDate, end: endDate }
    };
  } catch (error) {
    recordCriticalError('reports.revenue.local', error, { startDate, endDate }, { level: 'error', limit: 120 });
    throw new Error(`Revenue report could not be generated for ${startDate} to ${endDate}: ${error?.message || 'Unknown error'}`);
  }
}

export async function getTodayBookingPaymentMix(dateValue = null) {
  if (!state.lodgeId) return { total_collected: 0, by_method: {}, payment_count: 0, date: null };

  const target = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(target.getTime())) return { total_collected: 0, by_method: {}, payment_count: 0, date: null };

  const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59, 999);

  if (!state.isOnline) {
    return {
      total_collected: 0,
      by_method: {},
      payment_count: 0,
      date: dayStart.toISOString().slice(0, 10)
    };
  }

  const { data, error } = await state.supabase.
  from('payments').
  select('amount, method, type, paid_at').
  eq('lodge_id', state.lodgeId).
  gte('paid_at', dayStart.toISOString()).
  lte('paid_at', dayEnd.toISOString());

  if (error) throw new Error(error.message);

  const byMethod = {};
  let totalCollected = 0;
  let grossCollected = 0;
  let refundsIssued = 0;
  let paymentCount = 0;

  for (const payment of data || []) {
    const type = String(payment?.type || 'payment');
    const amount = Number(payment?.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    paymentCount += 1;
    totalCollected += amount;

    if (type === 'refund' || amount < 0) {
      refundsIssued += Math.abs(amount);
      continue;
    }

    const method = String(payment?.method || 'unknown');
    byMethod[method] = Math.round(((byMethod[method] || 0) + amount) * 100) / 100;
    grossCollected += amount;
  }

  return {
    total_collected: Math.round(totalCollected * 100) / 100,
    gross_collected: Math.round(grossCollected * 100) / 100,
    refunds_issued: Math.round(refundsIssued * 100) / 100,
    by_method: byMethod,
    payment_count: paymentCount,
    date: dayStart.toISOString().slice(0, 10)
  };
}

async function getProfitLossLocal(start, end) {
  const [rev, pos, exps, inv, sup, conf, pool, maintenanceRows] = await Promise.all([
  getRevenueReport(start, end),
  getPosRevenueSummary(start, end),
  getExpenses(start, end),
  getInventorySpend(start, end),
  getSupplySpend(start, end),
  getConferenceRevenueSummary(start, end),
  getPoolRevenueSummary(start, end),
  getMaintenanceRowsForPeriod(start, end)]
  );
  const bookingRevenue = rev.total_revenue || 0;
  const posRevenue = pos?.direct_revenue || 0;
  const conferenceRevenue = conf.total || 0;
  const poolRevenue = pool.total || 0;
  const retainedRevenue = Number(rev.retained_revenue || 0);
  const totalRevenue = bookingRevenue + posRevenue + conferenceRevenue + poolRevenue + retainedRevenue;
  const totalExpenses = exps.reduce((s, e) => s + Number(e.amount || 0), 0);
  const invCosts = inv.total || 0;
  const supCosts = sup.total || 0;
  const maintenanceCosts = (maintenanceRows || []).reduce((s, row) => s + Number(row.total_cost || 0), 0);
  const totalCosts = invCosts + supCosts + maintenanceCosts;
  const grossProfit = totalRevenue - totalExpenses - totalCosts;
  const expByCategory = exps.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount || 0);
    return acc;
  }, {});
  const vatAmount = rev.vat_amount || 0;
  return {
    bookingRevenue, posRevenue, conferenceRevenue, poolRevenue, retainedRevenue, totalRevenue,
    totalExpenses, expByCategory,
    invCosts, supCosts, maintenanceCosts, totalCosts,
    grossProfit,
    vatAmount,
    vatEnabled: rev.vat_enabled || false,
    vatRate: rev.vat_rate || 0,
    vatMixed: rev.vat_mixed || false,
    netRevenue: +(totalRevenue - vatAmount).toFixed(2)
  };
}

function finalizeProfitLossSummary(summary = {}, retainedRevenueFallback = 0) {
  const bookingRevenue = Number(summary.bookingRevenue || 0);
  const posRevenue = Number(summary.posRevenue || 0);
  const conferenceRevenue = Number(summary.conferenceRevenue || 0);
  const poolRevenue = Number(summary.poolRevenue || 0);
  const retainedRevenue = Number(summary.retainedRevenue ?? retainedRevenueFallback ?? 0);
  const totalExpenses = Number(summary.totalExpenses || 0);
  const invCosts = Number(summary.invCosts || 0);
  const supCosts = Number(summary.supCosts || 0);
  const maintenanceCosts = Number(summary.maintenanceCosts || 0);
  const totalCosts = invCosts + supCosts + maintenanceCosts;
  const totalRevenue = bookingRevenue + posRevenue + conferenceRevenue + poolRevenue + retainedRevenue;
  const vatAmount = Number(summary.vatAmount || 0);

  return {
    ...summary,
    bookingRevenue,
    posRevenue,
    conferenceRevenue,
    poolRevenue,
    retainedRevenue,
    totalRevenue,
    totalExpenses,
    invCosts,
    supCosts,
    maintenanceCosts,
    totalCosts,
    grossProfit: totalRevenue - totalExpenses - totalCosts,
    vatAmount,
    netRevenue: +(totalRevenue - vatAmount).toFixed(2)
  };
}

export async function getProfitLoss(start, end) {
  if (!start || !end) throw new Error('Profit and loss report requires a start date and end date.');
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_profit_loss_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: start,
        p_end_date: end
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        const normalized = { ...data };
        if (typeof normalized.maintenanceCosts === 'undefined') {
          const maintenanceRows = await getMaintenanceRowsForPeriod(start, end);
          normalized.maintenanceCosts = (maintenanceRows || []).reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
        }
        let retainedRevenue = normalized.retainedRevenue;
        if (typeof retainedRevenue === 'undefined') {
          const revenue = await getRevenueReport(start, end).catch(() => null);
          retainedRevenue = Number(revenue?.retained_revenue || 0);
        }
        return {
          ...finalizeProfitLossSummary(normalized, retainedRevenue),
          source: 'server',
          as_of_range: { start, end }
        };
      }
      throw new Error('Profit and loss summary was empty.');
    } catch (error) {
      recordCriticalError('reports.profit_loss', error, {
        start,
        end,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  try {
    return {
      ...(await getProfitLossLocal(start, end)),
      source: 'local',
      as_of_range: { start, end }
    };
  } catch (error) {
    recordCriticalError('reports.profit_loss.local', error, { start, end }, { level: 'error', limit: 120 });
    throw new Error(`Profit and loss report could not be generated for ${start} to ${end}: ${error?.message || 'Unknown error'}`);
  }
}

export async function getReportsSnapshot(today = getLocalDateKey(new Date(), LOCAL_TIME_ZONE)) {
  if (!state.lodgeId) throw new Error('No active lodge selected for reports snapshot.');
  const syncMeta = readSyncMeta();
  const lastSyncedAt = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;

  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_reports_snapshot', {
        p_lodge_id: state.lodgeId,
        p_today: today
      });
      if (error) throw error;
      if (data && typeof data === 'object') return { ...data, source: 'server', as_of: today, last_synced_at: lastSyncedAt };
      throw new Error('Reports snapshot was empty.');
    } catch (error) {
      console.warn('[Reports] Shared snapshot unavailable, using local fallback:', error?.message || error);
    }
  }

  const todayDate = new Date(`${today}T00:00:00`);
  const weekStartDate = new Date(todayDate);
  const weekday = weekStartDate.getDay();
  weekStartDate.setDate(weekStartDate.getDate() - (weekday === 0 ? 6 : weekday - 1));
  const weekStart = getLocalDateKey(weekStartDate, LOCAL_TIME_ZONE);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0), LOCAL_TIME_ZONE);
  const lastMonthStart = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1), LOCAL_TIME_ZONE);
  const lastMonthEnd = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), 0), LOCAL_TIME_ZONE);

  const [rooms, bookings, payments, expenses, posOrders, conferenceBookings, poolDayUse, maintenanceRows] = await Promise.all([
  getAllRooms().catch(() => []),
  getAllBookings().catch(() => []),
  Promise.resolve(readCache('payments') || []),
  getAllExpenses().catch(() => []),
  getAllPOSOrders().catch(() => []),
  getAllConferenceBookings().catch(() => []),
  getAllPoolDayUse().catch(() => []),
  getMaintenanceRowsForPeriod(monthStart, monthEnd).catch(() => [])]
  );

  const totalRooms = Array.isArray(rooms) ? rooms.length : 0;
  const dateOnly = (value) => String(value || '').slice(0, 10);
  const inRange = (value, start, end) => {
    const day = dateOnly(value);
    return Boolean(day) && day >= start && day <= end;
  };
  const revenueInRange = (start, end) => payments.
  filter((payment) => inRange(payment.paid_at, start, end)).
  reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const refundsInRange = (start, end) => payments.
  filter((payment) => inRange(payment.paid_at, start, end) && (Number(payment.amount || 0) < 0 || String(payment.type || '').toLowerCase() === 'refund')).
  reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0);
  const cancelledBookingIds = new Set(
    bookings.
    filter((booking) => String(booking?.status || '') === 'cancelled').
    map((booking) => booking.id).
    filter(Boolean)
  );
  const retainedForRange = (start, end) => {
    let retained = 0;
    let count = 0;
    const seenBookingIds = new Set();
    for (const payment of payments) {
      if (!inRange(payment.paid_at, start, end)) continue;
      const amount = Number(payment.amount || 0);
      if (amount <= 0) continue;
      if (String(payment.type || '').toLowerCase() === 'refund') continue;
      if (!cancelledBookingIds.has(payment.booking_id)) continue;
      retained += amount;
      if (payment.booking_id && !seenBookingIds.has(payment.booking_id)) {
        seenBookingIds.add(payment.booking_id);
        count += 1;
      }
    }
    return { retained, count };
  };
  const monthRetained = retainedForRange(monthStart, monthEnd);
  const lastMonthRetained = retainedForRange(lastMonthStart, lastMonthEnd);
  const overlapNights = (start, end) => bookings.
  filter((booking) => booking?.status !== 'cancelled' && booking?.check_in < end && booking?.check_out > start).
  reduce((sum, booking) => {
    const overlapStart = booking.check_in > start ? booking.check_in : start;
    const overlapEnd = booking.check_out < end ? booking.check_out : end;
    return sum + Math.max(0, Math.ceil((new Date(`${overlapEnd}T00:00:00`) - new Date(`${overlapStart}T00:00:00`)) / 86400000));
  }, 0);

  const monthDays = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
  const lastMonthDays = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0).getDate();
  const unpaidBookings = bookings.filter((booking) => booking?.status !== 'cancelled' && ['partial', 'unpaid', ''].includes(String(booking?.payment_status || 'unpaid')));
  const maintenanceCosts = (maintenanceRows || []).reduce((sum, row) => sum + Number(row.total_cost || 0), 0);

  return {
    todayRev: revenueInRange(today, today),
    weekRev: revenueInRange(weekStart, today),
    monthRev: revenueInRange(monthStart, monthEnd),
    lastMonthRev: revenueInRange(lastMonthStart, lastMonthEnd),
    monthRefunds: refundsInRange(monthStart, monthEnd),
    lastMonthRefunds: refundsInRange(lastMonthStart, lastMonthEnd),
    monthRetainedRevenue: monthRetained.retained,
    lastMonthRetainedRevenue: lastMonthRetained.retained,
    monthRetainedCount: monthRetained.count,
    lastMonthRetainedCount: lastMonthRetained.count,
    monthOcc: totalRooms > 0 && monthDays > 0 ? Math.round(overlapNights(monthStart, getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1), LOCAL_TIME_ZONE)) / (totalRooms * monthDays) * 100) : 0,
    lastMonthOcc: totalRooms > 0 && lastMonthDays > 0 ? Math.round(overlapNights(lastMonthStart, monthStart) / (totalRooms * lastMonthDays) * 100) : 0,
    currentOcc: bookings.filter((booking) => booking?.status === 'checked_in').length,
    totalRooms,
    unpaidTotal: unpaidBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)), 0),
    unpaidCount: unpaidBookings.length,
    monthExpenses: expenses.filter((expense) => inRange(expense.date, monthStart, monthEnd)).reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    maintenanceCosts,
    posRevenue: posOrders.filter((order) => order?.status !== 'voided' && inRange(order.created_at, monthStart, monthEnd)).reduce((sum, order) => sum + Number(order.total || 0), 0),
    conferenceRevenue: conferenceBookings.filter((booking) => String(booking?.payment_status || '').toLowerCase() !== 'cancelled' && inRange(booking.booking_date, monthStart, monthEnd)).reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0),
    poolRevenue: poolDayUse.filter((entry) => inRange(entry.date, monthStart, monthEnd)).reduce((sum, entry) => sum + Number(entry.total || 0), 0),
    source: state.isOnline ? 'fallback' : 'offline',
    as_of: today,
    last_synced_at: lastSyncedAt
  };
}

function getOutletProfitLossBucket(outletRow) {
  const type = String(outletRow?.type || '').trim().toLowerCase();
  if (type === 'food') return 'kitchen';
  if (type === 'beverage') return 'bar';
  if (type === 'front_desk' || type === 'accommodation') return 'front_desk';
  return 'unassigned';
}

export async function getOutletProfitLoss(startDate, endDate) {
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_outlet_profit_loss_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        };
      }
      throw new Error('Outlet profit and loss summary was empty.');
    } catch (error) {
      recordCriticalError('reports.outlet_profit_loss', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  const cachedOutlets = readCache('outlets');
  const cachedPosRows = readCache('pos-orders').filter((order) => {
    const orderDate = String(order.created_at || '').split('T')[0];
    return (
      (order.status || '') === 'completed' && (
      !startDate || orderDate >= startDate) && (
      !endDate || orderDate <= endDate));

  });
  const inventoryMap = new Map(readCache('inventory-items').map((item) => [item.id, item]));
  const cachedPurchaseRows = readCache('inventory-purchases').
  filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)).
  map((row) => ({
    ...row,
    inventory_items: inventoryMap.get(row.item_id) ?
    { outlet_id: inventoryMap.get(row.item_id).outlet_id || null } :
    null
  }));
  const cachedSupplyTotal = readCache('supply-purchases').
  filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)).
  reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
  const cachedExpenseRows = readCache('expenses').
  filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate));
  const maintenanceRows = await getMaintenanceRowsForPeriod(startDate, endDate).catch(() => []);
  let outletRows = [];
  let posRows = [];
  let purchaseRows = [];
  let expenseRows = [];
  let bookingResult = null;
  let confResult = { total: 0 };
  let poolResult = { total: 0 };
  let supResult = { total: cachedSupplyTotal };

  try {
    const [
    { data: liveOutlets, error: outletError },
    { data: livePos, error: posError },
    { data: livePurchases, error: purchaseError },
    { data: liveExpenses, error: expenseError },
    liveBookingResult,
    liveConfResult,
    livePoolResult,
    liveSupplyResult] =
    await Promise.all([
    state.supabase.
    from('outlets').
    select('id, name, type').
    eq('lodge_id', state.lodgeId),
    state.supabase.
    from('pos_orders').
    select('total, outlet_id, payment_method').
    eq('lodge_id', state.lodgeId).
    eq('status', 'completed').
    gte('created_at', `${startDate}T00:00:00`).
    lte('created_at', `${endDate}T23:59:59`),
    state.supabase.
    from('inventory_purchases').
    select('total_cost, inventory_items(outlet_id)').
    eq('lodge_id', state.lodgeId).
    gte('date', startDate).
    lte('date', endDate),
    state.supabase.
    from('expenses').
    select('amount, outlet_id').
    eq('lodge_id', state.lodgeId).
    gte('date', startDate).
    lte('date', endDate),
    getRevenueReport(startDate, endDate),
    getConferenceRevenueSummary(startDate, endDate),
    getPoolRevenueSummary(startDate, endDate),
    getSupplySpend(startDate, endDate)]
    );

    if (outletError) throw outletError;
    if (posError) throw posError;
    if (purchaseError) throw purchaseError;
    if (expenseError) throw expenseError;

    outletRows = (liveOutlets || []).length === 0 && cachedOutlets.length > 0 ? cachedOutlets : liveOutlets || [];
    posRows = (livePos || []).length === 0 && cachedPosRows.length > 0 ? cachedPosRows : livePos || [];
    purchaseRows = (livePurchases || []).length === 0 && cachedPurchaseRows.length > 0 ? cachedPurchaseRows : livePurchases || [];
    expenseRows = (liveExpenses || []).length === 0 && cachedExpenseRows.length > 0 ? cachedExpenseRows : liveExpenses || [];
    bookingResult = liveBookingResult;
    confResult = liveConfResult || { total: 0 };
    poolResult = livePoolResult || { total: 0 };
    supResult = liveSupplyResult || { total: cachedSupplyTotal };
  } catch (error) {
    outletRows = cachedOutlets.length > 0 ? cachedOutlets : await getOutlets().catch(() => []);
    posRows = cachedPosRows;
    purchaseRows = cachedPurchaseRows;
    expenseRows = cachedExpenseRows;
    bookingResult = await getRevenueReport(startDate, endDate).catch(() => null);
    supResult = { total: cachedSupplyTotal };
    if (!outletRows.length && !posRows.length && !purchaseRows.length && !expenseRows.length && state.isOnline) {
      throw new Error(error?.message || 'Failed to load outlet profit and loss report');
    }
  }

  const outletMap = {};
  (outletRows || []).forEach((o) => {
    const key = getOutletProfitLossBucket(o);
    outletMap[o.id] = { key, name: o.name, type: o.type || null };
  });

  // B. Initialize buckets — always present, even if zero
  const buckets = {
    kitchen: { key: 'kitchen', name: 'Kitchen', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, maintenanceCost: 0, expenses: 0, profit: 0 },
    bar: { key: 'bar', name: 'Bar', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, maintenanceCost: 0, expenses: 0, profit: 0 },
    front_desk: { key: 'front_desk', name: 'Front Desk', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, maintenanceCost: 0, expenses: 0, profit: 0 },
    unassigned: { key: 'unassigned', name: 'Unassigned', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, maintenanceCost: 0, expenses: 0, profit: 0 }
  }

  // C–F: Fetch all raw data in parallel
  // C. POS revenue grouped by outlet
;(posRows || []).forEach((o) => {
    const info = outletMap[o.outlet_id];
    const key = info?.key || 'unassigned';
    buckets[key].posRevenue += Number(o.total || 0);
  });

  const folioPosRevenue = (posRows || []).reduce(
    (sum, row) => sum + ((row.payment_method || '') === 'folio' ? Number(row.total || 0) : 0),
    0
  );

  // D. Booking + conference + pool revenue → Front Desk only, net of POS folio so combined totals do not double count.
  buckets.front_desk.bookingRevenue = Math.max(0, (bookingResult?.total_revenue || 0) - folioPosRevenue) + (
  confResult.total || 0) + (
  poolResult.total || 0)

  // E. Inventory cost grouped by outlet (JS-side — same pattern as getInventorySpend)
;(purchaseRows || []).forEach((p) => {
    const info = outletMap[p.inventory_items?.outlet_id];
    const key = info?.key || 'unassigned';
    buckets[key].inventoryCost += Number(p.total_cost || 0);
  })

  // F. Expenses grouped by outlet
;(expenseRows || []).forEach((e) => {
    const info = outletMap[e.outlet_id];
    const key = info?.key || 'unassigned';
    buckets[key].expenses += Number(e.amount || 0);
  })

  // G. Room-based maintenance is a Front Desk cost; property-wide work stays Unassigned.
;(maintenanceRows || []).forEach((row) => {
    const key = row.room_id || row.room_number ? 'front_desk' : 'unassigned';
    buckets[key].maintenanceCost += Number(row.total_cost || 0);
  });

  // H. Room supplies are accommodation costs, so keep them under Front Desk.
  buckets.front_desk.supplyCost += Number(supResult?.total || 0);

  // I. Per-outlet totals
  Object.values(buckets).forEach((b) => {
    b.revenue = b.posRevenue + b.bookingRevenue;
    b.profit = b.revenue - b.inventoryCost - b.supplyCost - b.maintenanceCost - b.expenses;
  });

  // J. Combined — built by summing outlet rows so reconciliation is guaranteed
  const combined = { posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, maintenanceCost: 0, expenses: 0, profit: 0 };
  Object.values(buckets).forEach((b) => {
    combined.posRevenue += b.posRevenue;
    combined.bookingRevenue += b.bookingRevenue;
    combined.revenue += b.revenue;
    combined.inventoryCost += b.inventoryCost;
    combined.supplyCost += b.supplyCost;
    combined.maintenanceCost += b.maintenanceCost;
    combined.expenses += b.expenses;
    combined.profit += b.profit;
  });

  return {
    outlets: Object.values(buckets),
    combined,
    source: 'local',
    as_of_range: { start: startDate, end: endDate }
  };
}

export async function getDashboardStats() {
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.substring(0, 7);

  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_manager_dashboard_snapshot', {
        p_lodge_id: state.lodgeId,
        p_today: today
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        return {
          total_rooms: Number(data.totalRooms || 0),
          occupied_today: Number(data.occupied || 0),
          checkins_today: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).filter((booking) => booking?.check_in === today).length,
          checkouts_today: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).filter((booking) => booking?.check_out === today).length,
          revenue_month: Number(data.monthRevenue || 0),
          upcoming_bookings: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).length,
          outstanding_total: Number(data.outstandingTotal || 0),
          unpaid_count: Number(data.unpaidCount || 0)
        };
      }
    } catch (error) {
      if (!dashboardSnapshotWarningShown) {
        dashboardSnapshotWarningShown = true;
        console.warn('[Dashboard] Server snapshot unavailable, using legacy stats fallback:', error?.message || error);
      }
    }

    // Run 5 targeted queries in parallel — each fetches only what it needs.
    // NOTE: charges_total is not selected here because it may not yet exist as a
    // column on the bookings table in older DB schemas (it lives in booking_charges).
    // The RPC above is the canonical source; this is a last-resort fallback.
    try {
      const d = new Date(today);
      const monthStart = thisMonth + '-01';
      const nextMonthStart = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0];

      const [roomsRes, occupiedRes, todayRes, revenueRes, upcomingRes] = await Promise.all([
      // count only — HEAD request, no rows transferred
      state.supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('lodge_id', state.lodgeId),
      state.supabase.from('bookings').select('id', { count: 'exact', head: true }).
      eq('lodge_id', state.lodgeId).
      in('status', ['confirmed', 'checked_in']).
      lte('check_in', today).
      gt('check_out', today),
      // today's arrivals + departures only — 2 columns
      state.supabase.from('bookings').select('check_in, check_out').
      eq('lodge_id', state.lodgeId).
      neq('status', 'cancelled').
      or(`check_in.eq.${today},check_out.eq.${today}`),
      // this month's revenue — total_amount only (charges_total may not exist as column yet)
      state.supabase.from('bookings').select('total_amount').
      eq('lodge_id', state.lodgeId).
      neq('status', 'cancelled').
      gte('check_in', monthStart).
      lt('check_in', nextMonthStart),
      state.supabase.from('bookings').select('id', { count: 'exact', head: true }).
      eq('lodge_id', state.lodgeId).
      eq('status', 'confirmed').
      gt('check_in', today)]
      );

      const monthEndStr = new Date(new Date(nextMonthStart).getTime() - 86400000).toISOString().split('T')[0];
      const [confMonthResult, poolMonthResult] = await Promise.all([
      getConferenceRevenueSummary(monthStart, monthEndStr),
      getPoolRevenueSummary(monthStart, monthEndStr)]
      );

      const todayBookings = todayRes.data || [];
      const bookingRevMonth = (revenueRes.data || []).reduce((s, b) => s + (b.total_amount || 0), 0);
      return {
        total_rooms: roomsRes.count ?? 0,
        occupied_today: occupiedRes.count ?? 0,
        checkins_today: todayBookings.filter((b) => b.check_in === today).length,
        checkouts_today: todayBookings.filter((b) => b.check_out === today).length,
        revenue_month: bookingRevMonth + (confMonthResult.total || 0) + (poolMonthResult.total || 0),
        upcoming_bookings: upcomingRes.count ?? 0
      };
    } catch (fallbackError) {
      console.warn('[Dashboard] Legacy stats fallback also failed, returning minimal stats:', fallbackError?.message || fallbackError);
      return { total_rooms: 0, occupied_today: 0, checkins_today: 0, checkouts_today: 0, revenue_month: 0, upcoming_bookings: 0 };
    }
  }

  // Offline: aggregate from cache
  const rooms = readCache('rooms');
  const bookings = readCache('bookings');
  return {
    total_rooms: rooms.length,
    occupied_today: bookings.filter(
      (b) => ['confirmed', 'checked_in'].includes(b.status) && b.check_in <= today && b.check_out > today
    ).length,
    checkins_today: bookings.filter((b) => b.check_in === today && b.status !== 'cancelled').length,
    checkouts_today: bookings.filter((b) => b.check_out === today && b.status !== 'cancelled').length,
    revenue_month: bookings.
    filter((b) => b.check_in?.startsWith(thisMonth) && b.status !== 'cancelled').
    reduce((s, b) => s + (b.total_amount || 0) + (b.charges_total || 0), 0),
    upcoming_bookings: bookings.filter((b) => b.check_in > today && b.status === 'confirmed').length
  };
}

export async function getTodayActivity() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (state.isOnline) {
    // Previously fetched all bookings. Now filters to only today/tomorrow rows.
    const { data } = await state.supabase.
    from('bookings').
    select('*').
    eq('lodge_id', state.lodgeId).
    neq('status', 'cancelled').
    or(`check_in.in.(${today},${tomorrow}),check_out.eq.${today}`);
    const all = data || [];
    return {
      checkins_today: all.filter((b) => b.check_in === today),
      checkouts_today: all.filter((b) => b.check_out === today),
      checkins_tomorrow: all.filter((b) => b.check_in === tomorrow)
    };
  }

  const bookings = readCache('bookings');
  return {
    checkins_today: bookings.filter((b) => b.check_in === today && b.status !== 'cancelled'),
    checkouts_today: bookings.filter((b) => b.check_out === today && b.status !== 'cancelled'),
    checkins_tomorrow: bookings.filter((b) => b.check_in === tomorrow && b.status !== 'cancelled')
  };
}

export async function getUpcomingCheckins() {
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dayAfterStr = new Date(Date.now() + 172800000).toISOString().split('T')[0];
  const upcomingDates = [todayStr, tomorrowStr, dayAfterStr];

  const mapBooking = (b, customers, rooms) => {
    const customer = customers.find((c) => c.id === b.customer_id);
    const room = rooms.find((r) => r.id === b.room_id);
    return {
      ...b,
      customer_name: b.customer_name || customer?.name,
      customer_phone: b.customer_phone || customer?.phone,
      customer_email: b.customer_email || customer?.email,
      room_number: b.room_number || room?.room_number,
      room_type: b.room_type || room?.room_type,
      booking_type: 'room'
    };
  };

  let roomBookings = [];
  let confBookings = [];
  let poolBookings = [];

  if (state.isOnline) {
    const [{ data: roomData }, { data: confData }, { data: poolData }] = await Promise.all([
    state.supabase.
    from('bookings').
    select('*, customers(name, phone, email), rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    in('check_in', upcomingDates).
    neq('status', 'cancelled'),
    state.supabase.
    from('conference_bookings').
    select('*').
    eq('lodge_id', state.lodgeId).
    in('booking_date', upcomingDates),
    state.supabase.
    from('pool_day_use').
    select('*').
    eq('lodge_id', state.lodgeId).
    in('date', upcomingDates)]
    );

    roomBookings = (roomData || []).map((b) => ({
      ...b,
      customer_name: b.customers?.name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type,
      booking_type: 'room'
    }));

    confBookings = (confData || []).map((cb) => ({
      id: cb.id,
      customer_name: cb.client_name,
      check_in: cb.booking_date,
      check_out: cb.booking_date,
      room_number: cb.room_name,
      adults: cb.attendees || 0,
      children: 0,
      total_amount: cb.total_amount || 0,
      deposit_paid: cb.deposit_paid || 0,
      payment_status: cb.payment_status,
      start_time: cb.start_time,
      end_time: cb.end_time,
      booking_type: 'conference'
    }));

    poolBookings = (poolData || []).map((pd) => ({
      id: pd.id,
      customer_name: pd.guest_name,
      check_in: pd.date,
      check_out: pd.date,
      room_number: 'Day Use',
      adults: pd.adults || 0,
      children: pd.children || 0,
      total_amount: pd.total || 0,
      deposit_amount: Number(pd.deposit_amount || 0),
      balance_due: Number(pd.balance_due || 0),
      template_name: pd.template_name || '',
      resource_name: pd.resource_name || '',
      payment_method: pd.payment_method,
      booking_type: 'day_use'
    }));
  } else {
    const customers = readCache('customers');
    const rooms = readCache('rooms');
    roomBookings = readCache('bookings').
    filter((b) => upcomingDates.includes(b.check_in) && b.status !== 'cancelled').
    map((b) => mapBooking(b, customers, rooms));

    confBookings = (readCache('conference-bookings') || []).
    filter((cb) => upcomingDates.includes(cb.booking_date)).
    map((cb) => ({
      id: cb.id,
      customer_name: cb.client_name,
      check_in: cb.booking_date,
      check_out: cb.booking_date,
      room_number: cb.room_name,
      adults: Number(cb.attendees) || 0,
      children: 0,
      total_amount: Number(cb.total_amount) || 0,
      deposit_paid: Number(cb.deposit_paid) || 0,
      payment_status: cb.payment_status,
      start_time: cb.start_time,
      end_time: cb.end_time,
      booking_type: 'conference'
    }));

    poolBookings = (readCache('pool-day-use') || []).
    filter((pd) => upcomingDates.includes(pd.date)).
    map((pd) => ({
      id: pd.id,
      customer_name: pd.guest_name,
      check_in: pd.date,
      check_out: pd.date,
      room_number: 'Day Use',
      adults: Number(pd.adults) || 0,
      children: Number(pd.children) || 0,
      total_amount: Number(pd.total) || 0,
      deposit_amount: Number(pd.deposit_amount || 0),
      balance_due: Number(pd.balance_due || 0),
      template_name: pd.template_name || '',
      resource_name: pd.resource_name || '',
      payment_method: pd.payment_method,
      booking_type: 'day_use'
    }));
  }

  const all = [...roomBookings, ...confBookings, ...poolBookings];

  return {
    today: all.filter((b) => b.check_in === todayStr),
    tomorrow: all.filter((b) => b.check_in === tomorrowStr),
    dayAfter: all.filter((b) => b.check_in === dayAfterStr)
  };
}

export async function getForecast(days = 30) {
  const today = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + days);
  const futureStr = future.toISOString().split('T')[0];

  const [roomsData, bookingsData] = await Promise.all([
  getAllRooms(),
  state.isOnline ?
  state.supabase.from('bookings').select('check_in, check_out, status').
  eq('lodge_id', state.lodgeId).
  neq('status', 'cancelled').
  lte('check_in', futureStr).
  gte('check_out', today).
  then((r) => r.data || []) :
  readCache('bookings').filter((b) => b.status !== 'cancelled' && b.check_in <= futureStr && b.check_out >= today)]
  );

  const totalRooms = roomsData.length || 1;
  const result = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const occupied = bookingsData.filter((b) => b.check_in <= dateStr && b.check_out > dateStr).length;
    result.push({ date: dateStr, occupied, total: totalRooms, rate: Math.round(occupied / totalRooms * 100) });
  }

  return result;
}

export async function getRoomProfitabilityReport(startDate, endDate) {
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_room_profitability_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      if (error) throw error;
      if (Array.isArray(data)) {
        return data.map((row) => ({
          ...row,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        }));
      }
      throw new Error('Room profitability summary was empty.');
    } catch (error) {
      recordCriticalError('reports.room_profitability', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  const rooms = await getAllRooms();
  const occupancy = await getOccupancyReport(startDate, endDate);
  const occupancyByRoom = new Map((occupancy || []).map((row) => [row.id, row]));

  let supplyRows = [];
  try {
    const movementRows = await getRoomSupplyAllocations(startDate, endDate);
    supplyRows = (movementRows || []).map((row) => ({
      room_id: row.room_id,
      total_cost: row.total_cost,
      units_used: row.units_used
    }));
  } catch {
    supplyRows = [];
  }

  const maintenanceRows = await getMaintenanceRowsForPeriod(startDate, endDate);

  const supplyByRoom = {};
  for (const row of supplyRows) {
    const key = row.room_id;
    if (!supplyByRoom[key]) supplyByRoom[key] = { cost: 0, units: 0 };
    supplyByRoom[key].cost += Number(row.total_cost || 0);
    supplyByRoom[key].units += Number(row.units_used || 0);
  }

  const maintenanceByRoom = {};
  for (const row of maintenanceRows) {
    const key = row.room_id;
    if (!maintenanceByRoom[key]) maintenanceByRoom[key] = { count: 0, open: 0, cost: 0 };
    maintenanceByRoom[key].count += 1;
    if ((row.status || '') !== 'resolved') maintenanceByRoom[key].open += 1;
    maintenanceByRoom[key].cost += Number(row.total_cost || 0);
  }

  const result = rooms.map((room) => {
    const occ = occupancyByRoom.get(room.id) || {};
    const supply = supplyByRoom[room.id] || { cost: 0, units: 0 };
    const maintenance = maintenanceByRoom[room.id] || { count: 0, open: 0, cost: 0 };
    const revenue = Number(occ.actual_revenue || 0);
    const supplyCost = Number(supply.cost || 0);
    const maintenanceCost = Number(maintenance.cost || 0);
    const runningCost = supplyCost + maintenanceCost;
    const contribution = revenue - runningCost;
    return {
      id: room.id,
      room_number: room.room_number,
      room_type: room.room_type,
      rate_per_night: Number(room.rate_per_night || 0),
      occupied_nights: Number(occ.occupied_nights || 0),
      occupancy_rate: Number(occ.occupancy_rate || 0),
      revenue,
      supply_cost: supplyCost,
      supply_units_used: Number(supply.units || 0),
      maintenance_cost: maintenanceCost,
      running_cost: runningCost,
      maintenance_count: Number(maintenance.count || 0),
      open_maintenance_count: Number(maintenance.open || 0),
      contribution,
      margin_pct: revenue > 0 ? Math.round(contribution / revenue * 100) : 0
    };
  });

  return result.
  sort((a, b) => b.contribution - a.contribution).
  map((row) => ({
    ...row,
    source: 'local',
    as_of_range: { start: startDate, end: endDate }
  }));
}

async function getConferenceRevenueSummary(startDate, endDate) {
  if (!state.isOnline) return { total: 0, collected: 0, count: 0 };
  try {
    const { data, error } = await state.supabase.
    from('conference_bookings').
    select('total_amount, deposit_paid, payment_status').
    eq('lodge_id', state.lodgeId).
    gte('booking_date', startDate).
    lte('booking_date', endDate);
    if (error) throw error;
    const rows = (data || []).filter((r) => r.payment_status !== 'cancelled');
    return {
      total: rows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
      collected: rows.reduce((s, r) => s + Number(r.deposit_paid || 0), 0),
      count: rows.length
    };
  } catch {
    return { total: 0, collected: 0, count: 0 };
  }
}

async function getPoolRevenueSummary(startDate, endDate) {
  if (!state.isOnline) return { total: 0, count: 0 };
  try {
    const { data, error } = await state.supabase.
    from('pool_day_use').
    select('total').
    eq('lodge_id', state.lodgeId).
    gte('date', startDate).
    lte('date', endDate);
    if (error) throw error;
    const rows = data || [];
    return {
      total: rows.reduce((s, r) => s + Number(r.total || 0), 0),
      count: rows.length
    };
  } catch {
    return { total: 0, count: 0 };
  }
}

export async function getNightAudit(date) {
  if (!state.isOnline) return null;
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;
  const bookingAuditSelect = 'id, booking_number, total_amount, charges_total, payment_status, amount_paid, adults, children, notes, status, check_in, check_out, created_at, customers(name), rooms(room_number, room_type)';
  const mapAuditBooking = (booking) => ({
    ...booking,
    customer_name: booking?.customer_name || booking?.customers?.name || '',
    room_number: booking?.room_number || booking?.rooms?.room_number || '',
    room_type: booking?.room_type || booking?.rooms?.room_type || ''
  });

  try {
    const { data, error } = await state.supabase.rpc('get_night_audit_summary', {
      p_lodge_id: state.lodgeId,
      p_audit_date: date
    });
    if (error) throw error;
    if (data && typeof data === 'object') {
      return {
        ...data,
        check_ins: (data.check_ins || []).map(mapAuditBooking),
        check_outs: (data.check_outs || []).map(mapAuditBooking),
        new_bookings: (data.new_bookings || []).map(mapAuditBooking),
        outstanding: (data.outstanding || []).map(mapAuditBooking),
        pos_orders: data.pos_orders || []
      };
    }
  } catch (rpcError) {
    console.warn('[NightAudit] Server summary unavailable, using legacy fallback:', rpcError?.message || rpcError);
  }

  try {
    const [
    { data: checkIns },
    { data: checkOuts },
    { data: newBookings },
    { data: posOrders },
    { data: outstanding }] =
    await Promise.all([
    state.supabase.from('bookings').select(bookingAuditSelect).
    eq('lodge_id', state.lodgeId).eq('check_in', date).neq('status', 'cancelled').order('check_in'),
    state.supabase.from('bookings').select(bookingAuditSelect).
    eq('lodge_id', state.lodgeId).eq('check_out', date).neq('status', 'cancelled').order('check_out'),
    state.supabase.from('bookings').select(bookingAuditSelect).
    eq('lodge_id', state.lodgeId).gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
    state.supabase.from('pos_orders').select('*, pos_order_items(*)').
    eq('lodge_id', state.lodgeId).eq('status', 'completed').gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
    state.supabase.from('bookings').select(bookingAuditSelect).
    eq('lodge_id', state.lodgeId).in('status', ['confirmed', 'checked_in']).neq('payment_status', 'paid').order('check_in')]
    );

    const posRevenue = (posOrders || []).reduce((s, o) => s + Number(o.total || 0), 0);
    const outstandingTotal = (outstanding || []).reduce((s, b) => {
      const paid = Number(b.amount_paid || 0);
      return s + Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - paid);
    }, 0);

    return {
      date,
      check_ins: (checkIns || []).map(mapAuditBooking),
      check_outs: (checkOuts || []).map(mapAuditBooking),
      new_bookings: (newBookings || []).map(mapAuditBooking),
      pos_orders: posOrders || [],
      pos_revenue: posRevenue,
      outstanding: (outstanding || []).map(mapAuditBooking),
      outstanding_total: outstandingTotal
    };
  } catch (error) {
    throw new Error(error?.message || 'Night audit could not be loaded.');
  }
}
