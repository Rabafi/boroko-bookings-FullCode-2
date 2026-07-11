import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BedDouble,
  CalendarCheck,
  CalendarX,
  Users,
  ArrowRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ShowerHead,
  Wrench,
  Eye
} from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'
import { useSettings } from '../app-context'

const ROOM_STATUS_CONFIG = {
  available: { label: 'Available', icon: CheckCircle, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  occupied:  { label: 'Occupied',  icon: BedDouble,  color: 'bg-blue-100 text-blue-700 border-blue-200' },
  dirty:     { label: 'Dirty',     icon: ShowerHead, color: 'bg-amber-100 text-amber-700 border-amber-200' },
  maintenance: { label: 'Maintenance', icon: Wrench, color: 'bg-red-100 text-red-700 border-red-200' },
  reserved:  { label: 'Reserved',  icon: CalendarCheck, color: 'bg-purple-100 text-purple-700 border-purple-200' }
}

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function timeAgo(value) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const diffMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0
  return Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
}

export default function HotelDashboard() {
  const { settings } = useSettings()
  const navigate = useNavigate()
  const currency = settings?.currency || 'P'

  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [rooms, setRooms] = useState([])
  const [arrivals, setArrivals] = useState([])
  const [departures, setDepartures] = useState([])
  const [inHouse, setInHouse] = useState([])
  const [noShows, setNoShows] = useState([])
  const [error, setError] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [hotelStats, allRooms, arrivingToday, departingToday, inHouseGuests, noShowGuests] = await Promise.all([
        window.api.hotel.getDashboardStats(),
        window.api.rooms.getAll().catch(() => []),
        window.api.hotel.getArrivals(),
        window.api.hotel.getDepartures(),
        window.api.hotel.getInHouse(),
        window.api.hotel.getNoShows()
      ])

      setStats(hotelStats)
      setRooms(Array.isArray(allRooms) ? allRooms : [])
      setArrivals(Array.isArray(arrivingToday) ? arrivingToday : [])
      setDepartures(Array.isArray(departingToday) ? departingToday : [])
      setInHouse(Array.isArray(inHouseGuests) ? inHouseGuests : [])
      setNoShows(Array.isArray(noShowGuests) ? noShowGuests : [])
    } catch (err) {
      console.error('Hotel dashboard load failed:', err)
      setError(err?.message || 'Failed to load hotel dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const roomCounts = useMemo(() => {
    const counts = { available: 0, occupied: 0, dirty: 0, maintenance: 0, reserved: 0, total: 0 }
    for (const room of rooms) {
      const status = String(room.status || 'available').toLowerCase()
      if (counts[status] !== undefined) counts[status]++
      else counts.available++
      counts.total++
    }
    return counts
  }, [rooms])

  const occupancyPercent = useMemo(() => {
    if (roomCounts.total === 0) return 0
    return Math.round(((roomCounts.occupied + roomCounts.reserved) / roomCounts.total) * 100)
  }, [roomCounts])

  const outstandingTotal = useMemo(() => {
    return inHouse.reduce((sum, b) => {
      const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
      return sum + balance
    }, 0)
  }, [inHouse])

  if (loading && !stats) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">HOTEL OPERATIONS</p>
          <h1 className="bb-page-header-title">Front Desk Dashboard</h1>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">HOTEL OPERATIONS</p>
          <h1 className="bb-page-header-title">Front Desk Dashboard</h1>
        </div>
        <div className="bb-card p-6 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-red-600 font-medium">{error}</p>
          <button onClick={loadData} className="mt-3 text-sm text-emerald-700 font-semibold hover:underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="bb-section-kicker">HOTEL OPERATIONS</p>
            <h1 className="bb-page-header-title">Front Desk Dashboard</h1>
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Status Cards ──────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-5">
        <div className="bb-card p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Rooms</p>
          <p className="text-2xl font-bold text-slate-800">{roomCounts.total}</p>
        </div>
        <div className="bb-card p-4 text-center border-l-4 border-l-emerald-500">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">Available</p>
          <p className="text-2xl font-bold text-emerald-700">{roomCounts.available}</p>
        </div>
        <div className="bb-card p-4 text-center border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">Occupied</p>
          <p className="text-2xl font-bold text-blue-700">{roomCounts.occupied}</p>
        </div>
        <div className="bb-card p-4 text-center border-l-4 border-l-purple-500">
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-600 mb-1">Reserved</p>
          <p className="text-2xl font-bold text-purple-700">{roomCounts.reserved}</p>
        </div>
        <div className="bb-card p-4 text-center border-l-4 border-l-amber-500">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-1">Dirty</p>
          <p className="text-2xl font-bold text-amber-700">{roomCounts.dirty}</p>
        </div>
        <div className="bb-card p-4 text-center border-l-4 border-l-red-500">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-1">Maintenance</p>
          <p className="text-2xl font-bold text-red-700">{roomCounts.maintenance}</p>
        </div>
      </section>

      {/* ── Occupancy + Revenue Summary ──────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-5">
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Occupancy</p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-slate-800">{occupancyPercent}%</span>
            <span className="text-xs text-slate-500 mb-1">{roomCounts.occupied + roomCounts.reserved} of {roomCounts.total} rooms</span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all"
              style={{ width: `${occupancyPercent}%` }}
            />
          </div>
        </div>
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">In-House Guests</p>
          <p className="text-3xl font-bold text-slate-800">{inHouse.length}</p>
          <p className="text-xs text-slate-500 mt-1">{inHouse.filter(b => Number(b.amount_paid || 0) < Number(b.total_amount || 0)).length} with outstanding balance</p>
        </div>
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Booking Balance Estimate</p>
          <p className="text-3xl font-bold text-amber-600">{formatCurrency(outstandingTotal, currency)}</p>
          <p className="text-xs text-slate-400 mt-1">Based on current booking cache; final balances remain database-authoritative.</p>
          <p className="text-xs text-slate-500 mt-0.5">Across {inHouse.filter(b => Math.max(0, Number(b.total_amount || 0) - Number(b.amount_paid || 0)) > 0).length} bookings</p>
        </div>
      </section>

      {noShows.length > 0 && (
        <section className="bb-card mb-5 overflow-hidden border-amber-200">
          <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-3.5">
            <AlertTriangle size={18} className="text-amber-600" />
            <h2 className="text-sm font-bold text-amber-900">No-Show Attention</h2>
            <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
              {noShows.length}
            </span>
          </div>
          <div className="divide-y divide-amber-50">
            {noShows.slice(0, 5).map((booking) => (
              <div
                key={booking.id}
                className="flex cursor-pointer items-center gap-4 px-5 py-3 transition-colors hover:bg-amber-50/60"
                onClick={() => navigate('/bookings', { state: { highlightBookingId: booking.id } })}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{booking.customer_name || 'Guest'}</p>
                  <p className="text-xs text-slate-500">
                    Room {booking.room_number || '—'} · Expected {booking.check_in}
                  </p>
                </div>
                <StatusBadge status={booking.status || 'overdue'} size="sm" />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ── Today's Arrivals ────────────────────────────────────────────── */}
        <section className="bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <CalendarCheck size={18} className="text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-800">Today's Arrivals</h2>
            <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              {arrivals.length}
            </span>
          </div>
          {arrivals.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CalendarCheck size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-xs text-slate-400">No arrivals scheduled today</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
              {arrivals.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-emerald-50/40 transition-colors cursor-pointer"
                  onClick={() => navigate('/bookings', { state: { highlightBookingId: booking.id } })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{booking.customer_name || 'Guest'}</p>
                    <p className="text-xs text-slate-500">
                      {booking.room_number} · {booking.room_type} · {nightsBetween(booking.check_in, booking.check_out)} night{nightsBetween(booking.check_in, booking.check_out) !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700">{formatCurrency(booking.total_amount, currency)}</p>
                    {Number(booking.amount_paid || 0) < Number(booking.total_amount || 0) && (
                      <p className="text-[10px] font-semibold text-amber-600">
                        Balance: {formatCurrency(Number(booking.total_amount || 0) - Number(booking.amount_paid || 0), currency)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={booking.payment_status || 'pending'} size="sm" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Today's Departures ──────────────────────────────────────────── */}
        <section className="bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <CalendarX size={18} className="text-blue-600" />
            <h2 className="text-sm font-bold text-slate-800">Today's Departures</h2>
            <span className="ml-auto rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              {departures.length}
            </span>
          </div>
          {departures.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CalendarX size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-xs text-slate-400">No departures scheduled today</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
              {departures.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-blue-50/40 transition-colors cursor-pointer"
                  onClick={() => navigate('/bookings', { state: { highlightBookingId: booking.id } })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{booking.customer_name || 'Guest'}</p>
                    <p className="text-xs text-slate-500">
                      {booking.room_number} · {booking.room_type}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700">{formatCurrency(booking.total_amount, currency)}</p>
                    {Number(booking.amount_paid || 0) < Number(booking.total_amount || 0) && (
                      <p className="text-[10px] font-semibold text-red-600">
                        Owes: {formatCurrency(Number(booking.total_amount || 0) - Number(booking.amount_paid || 0), currency)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={booking.payment_status || 'pending'} size="sm" />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── In-House Guest List ──────────────────────────────────────────── */}
      {inHouse.length > 0 && (
        <section className="bb-card overflow-hidden mt-5">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <BedDouble size={18} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-800">In-House Guests</h2>
            <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {inHouse.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Guest</th>
                  <th className="px-5 py-2.5">Room</th>
                  <th className="px-5 py-2.5">Check-in</th>
                  <th className="px-5 py-2.5">Check-out</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5 text-right">Paid</th>
                  <th className="px-5 py-2.5 text-right">Balance (est.)</th>
                  <th className="px-5 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {inHouse.map((booking) => {
                  const total = Number(booking.total_amount || 0)
                  const paid = Number(booking.amount_paid || 0)
                  const balance = Math.max(0, total + Number(booking.charges_total || 0) - paid)
                  return (
                    <tr
                      key={booking.id}
                      className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                      onClick={() => navigate('/bookings', { state: { highlightBookingId: booking.id } })}
                    >
                      <td className="px-5 py-3 font-medium text-slate-800">{booking.customer_name || 'Guest'}</td>
                      <td className="px-5 py-3 text-slate-600">{booking.room_number}</td>
                      <td className="px-5 py-3 text-slate-500">{booking.check_in ? new Date(booking.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{booking.check_out ? new Date(booking.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-700">{formatCurrency(total, currency)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{formatCurrency(paid, currency)}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {formatCurrency(balance, currency)}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <StatusBadge status={booking.payment_status || 'pending'} size="sm" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <section className="bb-card p-4 mt-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <button
            onClick={() => navigate('/bookings')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-md"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CalendarCheck size={20} />
            </div>
            <span className="text-sm font-semibold leading-tight text-slate-700">New Booking</span>
          </button>
          <button
            onClick={() => navigate('/housekeeping')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50/60 hover:shadow-md"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ShowerHead size={20} />
            </div>
            <span className="text-sm font-semibold leading-tight text-slate-700">Housekeeping</span>
          </button>
          <button
            onClick={() => navigate('/pos')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-md"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              <Users size={20} />
            </div>
            <span className="text-sm font-semibold leading-tight text-slate-700">POS</span>
          </button>
          <button
            onClick={() => navigate('/maintenance')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50/60 hover:shadow-md"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-red-100 text-red-700">
              <Wrench size={20} />
            </div>
            <span className="text-sm font-semibold leading-tight text-slate-700">Maintenance</span>
          </button>
        </div>
      </section>
    </div>
  )
}
