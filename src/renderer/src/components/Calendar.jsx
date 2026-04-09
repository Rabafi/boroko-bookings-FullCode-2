import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CreditCard, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { useSettings } from '../App'

const STATUS_STYLES = {
  confirmed: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-emerald-100 text-emerald-700',
  checked_out: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-rose-100 text-rose-700'
}

function bookingOutstandingAmount(booking) {
  return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
}

function currency(symbol, value) {
  return `${symbol} ${Number(value || 0).toFixed(2)}`
}

export default function Calendar() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currencySymbol = settings?.currency || 'P'
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [error, setError] = useState('')

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const visibleDays = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 1 })
  })
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })

  useEffect(() => {
    loadData()
  }, [currentMonth])

  useEffect(() => {
    const currentMonthKey = format(currentMonth, 'yyyy-MM')
    if (!String(selectedDay || '').startsWith(currentMonthKey)) {
      const todayKey = format(new Date(), 'yyyy-MM-dd')
      setSelectedDay(todayKey.startsWith(currentMonthKey) ? todayKey : format(monthStart, 'yyyy-MM-dd'))
    }
  }, [currentMonth, monthStart, selectedDay])

  const loadData = async () => {
    setLoading(true)
    setError('')
    const start = format(monthStart, 'yyyy-MM-dd')
    const end = format(monthEnd, 'yyyy-MM-dd')
    try {
      const [r, b] = await Promise.all([
        window.api.rooms.getAll(),
        window.api.bookings.getByDateRange(start, end)
      ])
      setRooms(Array.isArray(r) ? r : [])
      setBookings(Array.isArray(b) ? b : [])
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the planning calendar right now.')
    } finally {
      setLoading(false)
    }
  }

  const dailySummary = useMemo(() => {
    const summary = {}
    monthDays.forEach((day) => {
      const dayKey = format(day, 'yyyy-MM-dd')
      const activeBookings = bookings
        .filter((booking) => (
          dayKey >= booking.check_in &&
          dayKey < booking.check_out &&
          booking.status !== 'cancelled'
        ))
        .sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || '')))
      const arrivals = bookings.filter((booking) => booking.check_in === dayKey && booking.status !== 'cancelled')
      const departures = bookings.filter((booking) => booking.check_out === dayKey && booking.status !== 'cancelled')
      const outstandingValue = activeBookings.reduce((sum, booking) => sum + bookingOutstandingAmount(booking), 0)
      const unpaidStays = activeBookings.filter((booking) => bookingOutstandingAmount(booking) > 0).length
      summary[dayKey] = {
        dayKey,
        activeBookings,
        occupiedRooms: activeBookings.length,
        arrivals,
        departures,
        checkInValue: arrivals.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0),
        outstandingValue,
        unpaidStays
      }
    })
    return summary
  }, [bookings, monthDays])

  const selectedSummary = dailySummary[selectedDay] || {
    activeBookings: [],
    occupiedRooms: 0,
    arrivals: [],
    departures: [],
    checkInValue: 0,
    outstandingValue: 0,
    unpaidStays: 0
  }

  const monthMetrics = useMemo(() => {
    const totalRoomNights = Math.max(rooms.length * monthDays.length, 1)
    const occupiedRoomNights = monthDays.reduce((sum, day) => {
      const dayKey = format(day, 'yyyy-MM-dd')
      return sum + (dailySummary[dayKey]?.occupiedRooms || 0)
    }, 0)
    const occupancyRate = Math.round((occupiedRoomNights / totalRoomNights) * 100)
    const totalArrivals = monthDays.reduce((sum, day) => sum + (dailySummary[format(day, 'yyyy-MM-dd')]?.arrivals.length || 0), 0)
    const totalDepartures = monthDays.reduce((sum, day) => sum + (dailySummary[format(day, 'yyyy-MM-dd')]?.departures.length || 0), 0)
    const peakDay = monthDays.reduce((best, day) => {
      const dayKey = format(day, 'yyyy-MM-dd')
      const occupiedRooms = dailySummary[dayKey]?.occupiedRooms || 0
      if (!best || occupiedRooms > best.occupiedRooms) return { dayKey, occupiedRooms }
      return best
    }, null)
    return {
      occupancyRate,
      totalArrivals,
      totalDepartures,
      peakDay
    }
  }, [dailySummary, monthDays, rooms.length])

  const monthBookings = useMemo(() => (
    [...bookings].sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || '')))
  ), [bookings])

  const monthCollectionQueue = useMemo(() => (
    [...bookings]
      .filter((booking) => booking.status !== 'cancelled' && bookingOutstandingAmount(booking) > 0)
      .sort((a, b) => {
        const statusWeight = (booking) => {
          if (booking.status === 'checked_out') return 0
          if (booking.status === 'checked_in') return 1
          return 2
        }
        const statusGap = statusWeight(a) - statusWeight(b)
        if (statusGap !== 0) return statusGap
        return bookingOutstandingAmount(b) - bookingOutstandingAmount(a)
      })
      .slice(0, 8)
  ), [bookings])

  const isToday = (day) => isSameDay(day, new Date())

  const openBooking = (booking) => {
    navigate('/bookings', { state: { focusBookingId: booking.id } })
  }

  const collectPayment = (booking) => {
    navigate('/bookings', { state: { collectPaymentBookingId: booking.id } })
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Planning Calendar</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Monthly occupancy patterns, arrivals, departures, and booking flow for {format(currentMonth, 'MMMM yyyy')}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[160px] text-center text-base font-semibold text-gray-700">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="ml-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50"
          >
            This Month
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Occupancy Outlook</p>
          <p className="mt-3 text-2xl font-bold text-emerald-950">{monthMetrics.occupancyRate}%</p>
          <p className="mt-1 text-sm text-emerald-800">Average occupied room nights across the month.</p>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Arrivals</p>
          <p className="mt-3 text-2xl font-bold text-blue-950">{monthMetrics.totalArrivals}</p>
          <p className="mt-1 text-sm text-blue-800">Expected check-ins this month.</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Departures</p>
          <p className="mt-3 text-2xl font-bold text-amber-950">{monthMetrics.totalDepartures}</p>
          <p className="mt-1 text-sm text-amber-800">Expected check-outs this month.</p>
        </div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50/80 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Peak Day</p>
          <p className="mt-3 text-xl font-bold text-violet-950">
            {monthMetrics.peakDay ? format(new Date(`${monthMetrics.peakDay.dayKey}T12:00:00`), 'dd MMM') : '—'}
          </p>
          <p className="mt-1 text-sm text-violet-800">
            {monthMetrics.peakDay ? `${monthMetrics.peakDay.occupiedRooms} occupied room${monthMetrics.peakDay.occupiedRooms === 1 ? '' : 's'}` : 'No bookings yet'}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
            <div key={label} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
              {label}
            </div>
          ))}
        </div>
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading monthly planning view…</div>
        ) : (
          <div className="grid grid-cols-7">
            {visibleDays.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd')
              const summary = dailySummary[dayKey]
              const inMonth = isSameMonth(day, currentMonth)
              const selected = selectedDay === dayKey
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => inMonth && setSelectedDay(dayKey)}
                  className={`min-h-[132px] border-b border-r border-gray-100 px-3 py-3 text-left transition-colors ${
                    !inMonth
                      ? 'bg-gray-50/60 text-gray-300'
                      : selected
                        ? 'bg-emerald-50'
                        : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${isToday(day) && inMonth ? 'text-emerald-700' : inMonth ? 'text-gray-800' : 'text-gray-300'}`}>
                      {format(day, 'd')}
                    </span>
                    {inMonth && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        (summary?.occupiedRooms || 0) > 0
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {summary?.occupiedRooms || 0}/{rooms.length || 0}
                      </span>
                    )}
                  </div>
                  {inMonth && (
                    <div className="mt-3 space-y-1.5 text-xs">
                      <p className="text-gray-600">Arrivals: <span className="font-semibold text-gray-800">{summary?.arrivals.length || 0}</span></p>
                      <p className="text-gray-600">Departures: <span className="font-semibold text-gray-800">{summary?.departures.length || 0}</span></p>
                      <p className="text-gray-600">Check-in value: <span className="font-semibold text-gray-800">{currency(currencySymbol, summary?.checkInValue || 0)}</span></p>
                      {(summary?.unpaidStays || 0) > 0 && (
                        <p className="text-rose-600">Due stays: <span className="font-semibold text-rose-700">{summary?.unpaidStays || 0}</span></p>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-800">
              Day Plan for {format(new Date(`${selectedDay}T12:00:00`), 'dd MMM yyyy')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Use this to review expected arrivals, departures, and rooms occupied on that date.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 border-b border-gray-100 px-5 py-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Occupied Rooms</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{selectedSummary.occupiedRooms}</p>
            </div>
            <div className="rounded-xl bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Arrivals</p>
              <p className="mt-2 text-xl font-bold text-blue-950">{selectedSummary.arrivals.length}</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-600">Departures</p>
              <p className="mt-2 text-xl font-bold text-amber-950">{selectedSummary.departures.length}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 border-b border-gray-100 px-5 py-4 md:grid-cols-2">
            <div className="rounded-xl bg-rose-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Outstanding Balance</p>
              <p className="mt-2 text-xl font-bold text-rose-950">{currency(currencySymbol, selectedSummary.outstandingValue || 0)}</p>
              <p className="mt-1 text-xs text-rose-700">Across active stays on this date.</p>
            </div>
            <div className="rounded-xl bg-indigo-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Unpaid Active Stays</p>
              <p className="mt-2 text-xl font-bold text-indigo-950">{selectedSummary.unpaidStays || 0}</p>
              <p className="mt-1 text-xs text-indigo-700">Rooms that may need collection attention.</p>
            </div>
          </div>
          <div className="px-5 py-4">
            {selectedSummary.activeBookings.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">No occupied rooms on this day.</div>
            ) : (
              <div className="space-y-3">
                {selectedSummary.activeBookings.map((booking) => (
                  <div key={booking.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-800">{booking.customer_name}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Room {booking.room_number} · {booking.room_type || 'Room'} · {booking.check_in} to {booking.check_out}
                      </p>
                      {bookingOutstandingAmount(booking) > 0 && booking.status !== 'cancelled' && (
                        <p className="mt-1 text-sm font-semibold text-rose-700">
                          Balance due: {currency(currencySymbol, bookingOutstandingAmount(booking))}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[booking.status] || 'bg-slate-100 text-slate-600'}`}>
                        {String(booking.status || 'confirmed').replace('_', ' ')}
                      </span>
                      <span className="text-sm font-semibold text-gray-700">{currency(currencySymbol, Number(booking.total_amount || 0) + Number(booking.charges_total || 0))}</span>
                      <button
                        type="button"
                        onClick={() => openBooking(booking)}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <ExternalLink size={12} /> Open
                      </button>
                      {bookingOutstandingAmount(booking) > 0 && booking.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => collectPayment(booking)}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          <CreditCard size={12} /> Collect
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-800">Month Booking Flow</h2>
            <p className="mt-1 text-sm text-gray-500">A chronological list for planning the month ahead.</p>
          </div>
          {monthCollectionQueue.length > 0 && (
            <div className="border-b border-gray-100 bg-rose-50/70 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-rose-900">Collection Attention</p>
                  <p className="mt-1 text-xs text-rose-700">Unpaid stays this month that most likely need follow-up.</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {monthCollectionQueue.slice(0, 3).map((booking) => (
                  <div key={booking.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-white/80 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{booking.customer_name}</p>
                      <p className="text-xs text-slate-500">Room {booking.room_number} · {String(booking.status || '').replace('_', ' ')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => collectPayment(booking)}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <CreditCard size={12} /> Collect {currency(currencySymbol, bookingOutstandingAmount(booking))}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-[640px] overflow-y-auto">
            {monthBookings.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No bookings in this month yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {monthBookings.map((booking) => (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => setSelectedDay(booking.check_in)}
                    className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-gray-800">{booking.customer_name}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Room {booking.room_number} · Check-in {booking.check_in} · Check-out {booking.check_out}
                      </p>
                      {bookingOutstandingAmount(booking) > 0 && booking.status !== 'cancelled' && (
                        <p className="mt-1 text-xs font-semibold text-rose-700">
                          Balance due {currency(currencySymbol, bookingOutstandingAmount(booking))}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[booking.status] || 'bg-slate-100 text-slate-600'}`}>
                        {String(booking.status || 'confirmed').replace('_', ' ')}
                      </span>
                      <p className="mt-2 text-sm font-semibold text-gray-700">{currency(currencySymbol, Number(booking.total_amount || 0) + Number(booking.charges_total || 0))}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
