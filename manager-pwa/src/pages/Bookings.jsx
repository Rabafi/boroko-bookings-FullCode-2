import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { CalendarClock, RefreshCw, Search, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { FRONT_DESK_ONLY_MESSAGE, listBookings, listRooms } from '../lib/api'
import { readCacheEntry } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

const STATUS_COLOR = {
  confirmed: 'bg-blue-900/50 text-blue-300',
  checked_in: 'bg-green-900/50 text-green-300',
  checked_out: 'bg-gray-800 text-gray-400',
  cancelled: 'bg-red-900/30 text-red-400',
  no_show: 'bg-yellow-900/30 text-yellow-400',
  pending: 'bg-amber-950/60 text-amber-300'
}

const PAY_COLOR = {
  paid: 'bg-green-900/50 text-green-400',
  partial: 'bg-yellow-900/50 text-yellow-400',
  unpaid: 'bg-red-900/30 text-red-400'
}

const FILTERS = [
  ['today', 'Today'],
  ['in_house', 'In-house'],
  ['arrivals', 'Arrivals'],
  ['departures', 'Departures'],
  ['pending_online', 'Online'],
  ['overdue', 'Overdue'],
  ['upcoming', 'Upcoming'],
  ['all', 'All']
]

function normalizeFilter(value) {
  return FILTERS.some(([id]) => id === value) ? value : 'today'
}

function matchesFilter(booking, filter, today) {
  const status = booking.status || ''
  const active = status !== 'cancelled'
  if (filter === 'today') return active && (booking.check_in === today || booking.check_out === today)
  if (filter === 'in_house') return active && status === 'checked_in'
  if (filter === 'arrivals') return active && booking.check_in === today
  if (filter === 'departures') return active && booking.check_out === today
  if (filter === 'pending_online') return active && booking.source === 'online' && status === 'pending'
  if (filter === 'overdue') return active && status === 'checked_in' && booking.check_out < today
  if (filter === 'upcoming') return active && booking.check_in > today && ['confirmed', 'pending'].includes(status)
  return true
}

function addDaysKey(dayKey, days) {
  const value = new Date(`${dayKey}T00:00:00`)
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}

function getBookingGroup(booking, today, tomorrow) {
  const status = booking.status || ''
  if (status === 'checked_in' && booking.check_out < today) return 'Overdue'
  if (booking.check_in === today || booking.check_out === today) return 'Today'
  if (booking.check_in === tomorrow || booking.check_out === tomorrow) return 'Tomorrow'
  if (booking.check_in > tomorrow) return 'Upcoming'
  if (status === 'checked_in') return 'In-house'
  return 'Earlier'
}

const GROUP_ORDER = ['Overdue', 'Today', 'Tomorrow', 'Upcoming', 'In-house', 'Earlier']

function FrontDeskNotice({ compact = false }) {
  return (
    <div className={`rounded-xl border border-yellow-800 bg-yellow-950/40 ${compact ? 'px-3 py-2' : 'px-3 py-3'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Front Desk only</p>
      <p className="mt-1 text-sm text-yellow-100">{FRONT_DESK_ONLY_MESSAGE}</p>
    </div>
  )
}

function BookingSheet({ booking, onClose }) {
  const nights = booking.check_in && booking.check_out
    ? Math.round((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000)
    : 0

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 pb-28 max-h-[90vh] overflow-y-auto overscroll-contain" onClick={(event) => event.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">{booking.guest_name || 'Guest'}</h2>
            <p className="text-xs text-gray-400">
              {nights} night{nights !== 1 ? 's' : ''} · Check-in {format(parseISO(booking.check_in), 'd MMM')} → {format(parseISO(booking.check_out), 'd MMM')}
            </p>
            {booking.source === 'online' && booking.status === 'pending' && (
              <p className="text-xs text-amber-300 mt-2">This is an online booking request. Front desk still needs to accept it before operations should rely on it.</p>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-gray-500"><X size={20} /></button>
        </div>

        <div className="bg-gray-800 rounded-xl p-3 mb-4 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-gray-400">Status</span><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[booking.status]}`}>{booking.status}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Booking source</span><span className="text-white">{booking.source === 'online' ? 'Online request' : 'Front desk booking'}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Total</span><span className="text-white font-semibold">P {(Number(booking.total_amount || 0) + Number(booking.charges_total || 0)).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Paid</span><span className="text-green-400">P {Number(booking.amount_paid || 0).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Balance</span><span className="text-yellow-400">P {Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Payment</span><span className={`px-2 py-0.5 rounded-full text-xs ${PAY_COLOR[booking.payment_status]}`}>{booking.payment_status}</span></div>
        </div>

        <FrontDeskNotice />
      </div>
    </div>
  )
}

function CalendarView({ bookings, rooms, onSelectBooking }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(today)
    day.setDate(day.getDate() + index)
    return day
  })

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-1 mb-2">
          <div className="text-xs text-gray-500 font-medium py-2">Room</div>
          {days.map((day, index) => (
            <div key={index} className="text-xs text-center text-gray-500 font-medium py-2">
              {format(day, 'EEE d')}
            </div>
          ))}
        </div>

        {rooms.map((room) => (
          <div key={room.id} className="grid grid-cols-[100px_repeat(7,1fr)] gap-1 mb-1 items-stretch min-h-[48px]">
            <div className="text-sm text-white bg-gray-800 rounded-lg flex items-center px-2 sticky left-0 z-10">
              {room.room_number}
            </div>
            {days.map((day, index) => {
              const dayStr = format(day, 'yyyy-MM-dd')
              const isToday = dayStr === new Date().toISOString().slice(0, 10)
              const activeBooking = bookings.find((booking) =>
                booking.room_id === room.id &&
                booking.status !== 'cancelled' &&
                booking.check_in <= dayStr &&
                booking.check_out > dayStr
              )

              if (activeBooking) {
                const isStart = activeBooking.check_in === dayStr
                if (!isStart) return null

                const startIndex = index
                const endIndex = days.findIndex((entry) => format(entry, 'yyyy-MM-dd') === activeBooking.check_out)
                const rawSpan = endIndex === -1 ? days.length - startIndex : endIndex - startIndex
                const span = Math.max(1, Math.min(rawSpan, days.length - startIndex))

                return (
                  <div
                    key={index}
                    onClick={() => onSelectBooking(activeBooking)}
                    style={{ gridColumn: `span ${span}` }}
                    className="z-0"
                  >
                    <div className={`cursor-pointer h-full rounded-xl px-2 py-1 flex items-center hover:opacity-80 ${STATUS_COLOR[activeBooking.status] || 'bg-blue-900/50 text-blue-300'}`}>
                      <span className="text-[11px] font-semibold truncate block">{activeBooking.guest_name || 'Guest'}</span>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={index}
                  className={`rounded-md border border-gray-800 ${isToday ? 'bg-gray-700' : 'bg-gray-900'}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function BookingRow({ booking, onSelectBooking }) {
  return (
    <button key={booking.id} onClick={() => onSelectBooking(booking)} className="w-full bg-gray-800 rounded-2xl p-4 text-left active:scale-[0.98] transition-transform">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm">{booking.guest_name || 'Guest'}</p>
          {booking.source === 'online' && booking.status === 'pending' && (
            <p className="text-[11px] text-amber-300 mt-1">Online request waiting for front desk confirmation</p>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[booking.status] || 'bg-gray-800 text-gray-300'}`}>{String(booking.status || 'unknown').replace('_', ' ')}</span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-xs">{booking.check_in} → {booking.check_out}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full ${PAY_COLOR[booking.payment_status] || 'bg-gray-800 text-gray-300'}`}>{booking.payment_status || 'unknown'}</span>
      </div>
      <p className="text-gray-500 text-xs mt-1">P {(Number(booking.total_amount || 0) + Number(booking.charges_total || 0)).toLocaleString()}</p>
    </button>
  )
}

export default function Bookings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [view, setView] = useState('list')
  const [tab, setTab] = useState(() => normalizeFilter(searchParams.get('filter')))
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [selected, setSelected] = useState(null)
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = addDaysKey(today, 1)

  useEffect(() => {
    setTab(normalizeFilter(searchParams.get('filter')))
  }, [searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [bookingRows, roomRows] = await Promise.all([
        listBookings(user.lodge_id).catch(() => []),
        listRooms(user.lodge_id).catch(() => [])
      ])
      setBookings(bookingRows || [])
      setRooms((roomRows || []).map((room) => ({ id: room.id, room_number: room.room_number })))
      const cacheTimes = [
        readCacheEntry(user.lodge_id, 'bookings', null)?.updatedAt,
        readCacheEntry(user.lodge_id, 'rooms', null)?.updatedAt
      ].filter(Boolean).sort()
      setLastUpdated(cacheTimes.at(-1) || null)
    } catch (error) {
      setLoadError(error?.message || 'Bookings could not load.')
    }
    setLoading(false)
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const filterCounts = useMemo(() => Object.fromEntries(
    FILTERS.map(([id]) => [id, bookings.filter((booking) => matchesFilter(booking, id, today)).length])
  ), [bookings, today])

  const filtered = bookings.filter((booking) => {
    const matchSearch = !search || (booking.guest_name || '').toLowerCase().includes(search.toLowerCase())
    return matchSearch && matchesFilter(booking, tab, today)
  })

  const groupedBookings = useMemo(() => {
    const groups = new Map()
    filtered.forEach((booking) => {
      const group = getBookingGroup(booking, today, tomorrow)
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(booking)
    })
    return [...groups.entries()]
      .sort(([left], [right]) => GROUP_ORDER.indexOf(left) - GROUP_ORDER.indexOf(right))
      .map(([label, rows]) => ({
        label,
        rows: [...rows].sort((left, right) => String(left.check_in || '').localeCompare(String(right.check_in || '')))
      }))
  }, [filtered, today, tomorrow])

  const activeFilterLabel = FILTERS.find(([id]) => id === tab)?.[1] || 'Today'

  function changeFilter(id) {
    setTab(id)
    const next = new URLSearchParams(searchParams)
    if (id === 'today') next.delete('filter')
    else next.set('filter', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-white">Bookings</h1>
          <button onClick={load} className="p-2 text-gray-400 hover:text-white">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-3">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {FILTERS.map(([id, label]) => (
              <button key={id} onClick={() => changeFilter(id)} className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${tab === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
                {label}
                <span className="ml-1 opacity-70">{filterCounts[id] || 0}</span>
              </button>
            ))}
          </div>
          <div className="flex bg-gray-800 rounded-xl p-0.5 w-fit">
            <button onClick={() => setView('list')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>List</button>
            <button onClick={() => setView('calendar')} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'calendar' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Calendar</button>
          </div>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Search guest name…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} />
          <p className="shrink-0 text-[11px] text-gray-500">{activeFilterLabel}: {filtered.length}</p>
        </div>
      </div>

      {view === 'calendar' && !loading ? (
        <div className="flex-1 py-3 space-y-3 overflow-y-auto">
          <CalendarView bookings={bookings} rooms={rooms} onSelectBooking={setSelected} />
          <div className="px-4">
            <MobileBoundaryNotice compact>
              View booking detail and send requests on mobile. Front desk confirms bookings, payments, refunds, and room moves on desktop.
            </MobileBoundaryNotice>
          </div>
        </div>
      ) : (
        <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : loadError ? (
            <p className="text-red-300 text-sm text-center pt-12">{loadError}</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={`No ${activeFilterLabel.toLowerCase()} bookings`}
              message="Try another filter, clear the search, or ask front desk if an expected booking has not reached mobile yet."
              action={
                tab !== 'all'
                  ? <button type="button" onClick={() => changeFilter('all')} className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Show all bookings</button>
                  : null
              }
            />
          ) : groupedBookings.map((group) => (
            <section key={group.label} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{group.label}</p>
                <span className="text-[11px] text-gray-500">{group.rows.length}</span>
              </div>
              {group.rows.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onSelectBooking={setSelected} />
              ))}
            </section>
          ))}
          {!loading && !loadError && (
            <MobileBoundaryNotice compact>
              View booking detail and send requests on mobile. Front desk confirms bookings, payments, refunds, and room moves on desktop.
            </MobileBoundaryNotice>
          )}
        </div>
      )}

      {selected && <BookingSheet booking={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
