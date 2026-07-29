import { getLocalDateKey, LOCAL_TIME_ZONE } from './operationalLog.js';
import { dedupePromise } from './infrastructure.js';
import { getAllRooms } from './rooms.js';
import { getAllBookings } from './bookings.js';

function todayKey() {
  return getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKeyFor(offsetDays = 0) {
  return getLocalDateKey(addDays(new Date(), offsetDays), LOCAL_TIME_ZONE);
}

function overlapsDate(booking, dateKey) {
  return String(booking?.check_in || '') <= dateKey && String(booking?.check_out || '') > dateKey;
}

function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const nights = Math.round((end - start) / 86400000);
  return Number.isFinite(nights) && nights > 0 ? nights : 1;
}

function annotateBooking(row) {
  if (!row) return null;
  return {
    ...row,
    customer_name: row.customers?.name,
    customer_phone: row.customers?.phone,
    customer_email: row.customers?.email,
    room_number: row.rooms?.room_number,
    room_type: row.rooms?.room_type,
    rate_per_night: row.rooms?.rate_per_night,
    room_status: row.rooms?.status
  };
}

async function fetchBookingsByDateFilter(filterFn) {
  const bookings = await getAllBookings();
  return bookings.filter(filterFn).map(annotateBooking).filter(Boolean);
}

function bookingStatus(b) {
  return String(b?.status || '').toLowerCase();
}

function isCancelled(b) {
  return bookingStatus(b) === 'cancelled';
}

function isCheckedIn(b) {
  const s = bookingStatus(b);
  return s === 'checked_in' || s === 'in_house' || s === 'staying';
}

function isCheckedOut(b) {
  return bookingStatus(b) === 'checked_out';
}

function balanceOutstanding(b) {
  return Math.max(
    0,
    Number(b?.total_amount || 0) + Number(b?.charges_total || 0) - Number(b?.amount_paid || 0)
  );
}

function isVip(b) {
  return Boolean(
    b?.is_vip
    || b?.vip
    || b?.customers?.is_vip
    || b?.customers?.vip
    || String(b?.special_requests || '').toLowerCase().includes('vip')
    || String(b?.notes || '').toLowerCase().includes('vip')
  );
}

function isUnassignedRoom(b) {
  return !b?.room_id && !b?.rooms?.id && !b?.room_number && !b?.rooms?.room_number;
}

function roomStatusOf(b) {
  return String(b?.room_status || b?.rooms?.status || '').toLowerCase();
}

/** Expected arrivals today that have not checked in yet. */
function _getArrivals() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || isCancelled(b) || isCheckedOut(b)) return false;
    if (String(b.check_in || '') !== today) return false;
    // Still show checked-in arrivals so the board can mark them complete.
    return true;
  });
}

/** Expected departures today (checked-in or still marked in-house). */
function _getDepartures() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || isCancelled(b)) return false;
    if (String(b.check_out || '') !== today) return false;
    return true;
  });
}

function _getInHouse() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || isCancelled(b) || isCheckedOut(b)) return false;
    if (isCheckedIn(b)) return true;
    return String(b.check_in || '') <= today && String(b.check_out || '') > today;
  });
}

function _getNoShows() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || isCancelled(b) || isCheckedIn(b) || isCheckedOut(b)) return false;
    const status = bookingStatus(b);
    if (status === 'no_show' || status === 'no-show') return true;
    // Overdue arrival not yet checked in / no-showed
    return String(b.check_in || '') < today && (status === 'confirmed' || status === 'booked' || status === 'reserved' || status === 'pending' || !status);
  });
}

async function _getDashboardStats() {
  const rooms = await getAllRooms();
  const allBookings = await getAllBookings();
  const today = todayKey();

  const roomCounts = { available: 0, occupied: 0, dirty: 0, maintenance: 0, reserved: 0, ooo: 0, total: 0 };
  for (const room of rooms) {
    const status = String(room.status || 'available').toLowerCase();
    if (status === 'out_of_order' || status === 'ooo' || status === 'out_of_service') {
      roomCounts.ooo += 1;
      roomCounts.maintenance += 1;
    } else if (roomCounts[status] !== undefined) {
      roomCounts[status] += 1;
    } else {
      roomCounts.available += 1;
    }
    roomCounts.total += 1;
  }

  const arrivalsRaw = allBookings.filter((b) => b && !isCancelled(b) && !isCheckedOut(b) && String(b.check_in || '') === today);
  const departuresRaw = allBookings.filter((b) => b && !isCancelled(b) && String(b.check_out || '') === today);
  const inHouseRaw = allBookings.filter((b) => {
    if (!b || isCancelled(b) || isCheckedOut(b)) return false;
    if (isCheckedIn(b)) return true;
    return String(b.check_in || '') <= today && String(b.check_out || '') > today;
  });
  const noShowsRaw = allBookings.filter((b) => {
    if (!b || isCancelled(b) || isCheckedIn(b) || isCheckedOut(b)) return false;
    const status = bookingStatus(b);
    if (status === 'no_show' || status === 'no-show') return true;
    return String(b.check_in || '') < today && (status === 'confirmed' || status === 'booked' || status === 'reserved' || status === 'pending' || !status);
  });

  const annotate = (rows) => rows.map(annotateBooking).filter(Boolean);
  const arrivals = annotate(arrivalsRaw);
  const departures = annotate(departuresRaw);
  const inHouse = annotate(inHouseRaw);
  const noShows = annotate(noShowsRaw);

  const pendingArrivals = arrivals.filter((b) => !isCheckedIn(b));
  const pendingDepartures = departures.filter((b) => !isCheckedOut(b));
  const unassignedArrivals = pendingArrivals.filter(isUnassignedRoom);
  const dirtyBlockers = pendingArrivals.filter((b) => {
    const rs = roomStatusOf(b);
    return rs === 'dirty' || rs === 'cleaning' || rs === 'inspect' || rs === 'inspection';
  });
  const maintenanceBlockers = pendingArrivals.filter((b) => {
    const rs = roomStatusOf(b);
    return rs === 'maintenance' || rs === 'out_of_order' || rs === 'ooo' || rs === 'out_of_service';
  });
  const outstandingBalances = inHouse
    .map((b) => ({ ...b, _balance: balanceOutstanding(b) }))
    .filter((b) => b._balance > 0.009)
    .sort((a, b) => b._balance - a._balance);
  const vipArrivals = arrivals.filter(isVip);
  const specialRequests = [...pendingArrivals, ...inHouse].filter((b) =>
    String(b.special_requests || b.notes || '').trim().length > 0
  );

  const occupancyPercent = roomCounts.total > 0
    ? Math.round(((roomCounts.occupied + roomCounts.reserved) / roomCounts.total) * 100)
    : 0;

  const outstandingTotal = outstandingBalances.reduce((sum, b) => sum + b._balance, 0);

  return {
    rooms: roomCounts,
    occupancyPercent,
    arrivals: arrivals.length,
    pendingArrivals: pendingArrivals.length,
    departures: departures.length,
    pendingDepartures: pendingDepartures.length,
    inHouse: inHouse.length,
    noShows: noShows.length,
    unassignedArrivals: unassignedArrivals.length,
    dirtyBlockers: dirtyBlockers.length,
    maintenanceBlockers: maintenanceBlockers.length,
    outstandingBalanceCount: outstandingBalances.length,
    outstandingTotal,
    vipArrivals: vipArrivals.length,
    // Values are derived from live booking/room cache via the same domain reads
    // as the rest of the front desk — labelled estimates until night-audit KPIs are used.
    balanceSource: 'booking_ledger_estimate',
    occupancySource: 'room_status_estimate',
    date: today,
    lists: {
      arrivals,
      departures,
      inHouse,
      noShows,
      pendingArrivals,
      pendingDepartures,
      unassignedArrivals,
      dirtyBlockers,
      maintenanceBlockers,
      outstandingBalances: outstandingBalances.slice(0, 20),
      vipArrivals,
      specialRequests: specialRequests.slice(0, 20)
    }
  };
}

async function _getHotelKpis(days = 7) {
  const windowDays = Math.min(Math.max(Number(days) || 7, 1), 31);
  const rooms = await getAllRooms();
  const bookings = await getAllBookings();
  const totalRooms = rooms.length;
  const roomStatus = rooms.reduce((acc, room) => {
    const status = String(room.status || 'available').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const daily = [];
  let occupiedRoomNights = 0;
  let soldRoomNights = 0;
  let estimatedRoomRevenue = 0;
  let arrivals = 0;
  let departures = 0;
  let noShows = 0;

  for (let offset = 0; offset < windowDays; offset++) {
    const date = dateKeyFor(offset);
    const active = bookings.filter((booking) => booking && booking.status !== 'cancelled' && overlapsDate(booking, date));
    const dayArrivals = bookings.filter((booking) => booking && booking.status !== 'cancelled' && String(booking.check_in || '') === date);
    const dayDepartures = bookings.filter((booking) => booking && booking.status !== 'cancelled' && String(booking.check_out || '') === date);
    const dayNoShows = bookings.filter((booking) => {
      const status = String(booking?.status || '').toLowerCase();
      return String(booking?.check_in || '') === date && (status === 'no_show' || status === 'no-show');
    });

    const dayRevenue = active.reduce((sum, booking) => {
      const nights = nightsBetween(booking.check_in, booking.check_out);
      return sum + (Number(booking.total_amount || 0) / nights);
    }, 0);

    occupiedRoomNights += active.length;
    soldRoomNights += active.filter((booking) => String(booking.status || '').toLowerCase() !== 'no_show').length;
    estimatedRoomRevenue += dayRevenue;
    arrivals += dayArrivals.length;
    departures += dayDepartures.length;
    noShows += dayNoShows.length;

    daily.push({
      date,
      occupiedRooms: active.length,
      availableRooms: Math.max(0, totalRooms - active.length),
      occupancyPercent: totalRooms > 0 ? Math.round((active.length / totalRooms) * 100) : 0,
      arrivals: dayArrivals.length,
      departures: dayDepartures.length,
      noShows: dayNoShows.length,
      estimatedRoomRevenue: Math.round(dayRevenue * 100) / 100
    });
  }

  const roomNightsAvailable = totalRooms * windowDays;
  const occupancyPercent = roomNightsAvailable > 0 ? Math.round((occupiedRoomNights / roomNightsAvailable) * 100) : 0;
  const adr = soldRoomNights > 0 ? estimatedRoomRevenue / soldRoomNights : 0;
  const revPar = roomNightsAvailable > 0 ? estimatedRoomRevenue / roomNightsAvailable : 0;

  // Forward-looking board KPIs from local booking/room cache — not night-audit or ledger authority.
  // Prefer advancedReports RPC occupancy/rate/debtor surfaces for ledger-derived historical KPIs.
  return {
    days: windowDays,
    totalRooms,
    roomStatus,
    roomNightsAvailable,
    occupiedRoomNights,
    soldRoomNights,
    occupancyPercent,
    adr: Math.round(adr * 100) / 100,
    revPar: Math.round(revPar * 100) / 100,
    estimatedRoomRevenue: Math.round(estimatedRoomRevenue * 100) / 100,
    arrivals,
    departures,
    noShows,
    daily,
    occupancySource: 'booking_cache_estimate',
    revenueSource: 'booking_cache_estimate',
    kpiSource: 'booking_cache_estimate',
    authority: 'estimate'
  };
}

export function getDashboardStats() {
  return dedupePromise('hotelDashboardStats', _getDashboardStats);
}

export function getArrivals() {
  return dedupePromise('hotelArrivals', _getArrivals);
}

export function getDepartures() {
  return dedupePromise('hotelDepartures', _getDepartures);
}

export function getInHouse() {
  return dedupePromise('hotelInHouse', _getInHouse);
}

export function getNoShows() {
  return dedupePromise('hotelNoShows', _getNoShows);
}

export function getHotelKpis(days = 7) {
  return dedupePromise(`hotelKpis:${days}`, () => _getHotelKpis(days));
}
