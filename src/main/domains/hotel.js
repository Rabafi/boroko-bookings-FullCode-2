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

function _getArrivals() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || b.status === 'cancelled') return false;
    return String(b.check_in || '') === today;
  });
}

function _getDepartures() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || b.status === 'cancelled') return false;
    return String(b.check_out || '') === today;
  });
}

function _getInHouse() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || b.status === 'cancelled') return false;
    return String(b.check_in || '') <= today && String(b.check_out || '') > today;
  });
}

function _getNoShows() {
  const today = todayKey();
  return fetchBookingsByDateFilter((b) => {
    if (!b || b.status === 'cancelled' || b.status === 'checked_in' || b.status === 'checked_out') return false;
    const status = String(b.status || '').toLowerCase();
    return status === 'no_show' || status === 'no-show' || String(b.check_in || '') < today;
  });
}

async function _getDashboardStats() {
  const rooms = await getAllRooms();
  const allBookings = await getAllBookings();
  const today = todayKey();

  const roomCounts = { available: 0, occupied: 0, dirty: 0, maintenance: 0, reserved: 0, total: 0 };
  for (const room of rooms) {
    const status = String(room.status || 'available').toLowerCase();
    if (roomCounts[status] !== undefined) roomCounts[status]++;
    else roomCounts.available++;
    roomCounts.total++;
  }

  const arrivals = allBookings.filter((b) => b && b.status !== 'cancelled' && String(b.check_in || '') === today);
  const departures = allBookings.filter((b) => b && b.status !== 'cancelled' && String(b.check_out || '') === today);
  const inHouse = allBookings.filter((b) => b && b.status !== 'cancelled' && String(b.check_in || '') <= today && String(b.check_out || '') > today);
  const noShows = allBookings.filter((b) => {
    if (!b || b.status === 'cancelled' || b.status === 'checked_in' || b.status === 'checked_out') return false;
    const status = String(b.status || '').toLowerCase();
    return status === 'no_show' || status === 'no-show' || String(b.check_in || '') < today;
  });

  const occupancyPercent = roomCounts.total > 0
    ? Math.round(((roomCounts.occupied + roomCounts.reserved) / roomCounts.total) * 100)
    : 0;

  const outstandingTotal = inHouse.reduce((sum, b) => {
    return sum + Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0));
  }, 0);

  return {
    rooms: roomCounts,
    occupancyPercent,
    arrivals: arrivals.length,
    departures: departures.length,
    inHouse: inHouse.length,
    noShows: noShows.length,
    outstandingTotal,
    date: today
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
    daily
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
