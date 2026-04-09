import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { RefreshCw, Search, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { FRONT_DESK_ONLY_MESSAGE, listBookings, listRooms } from '../lib/api'

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

export default function Bookings() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [view, setView] = useState('list')
  const [tab, setTab] = useState('today')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    setLoading(true)
    const [bookingRows, roomRows] = await Promise.all([
      listBookings(user.lodge_id).catch(() => []),
      listRooms(user.lodge_id).catch(() => [])
    ])
    setBookings(bookingRows || [])
    setRooms((roomRows || []).map((room) => ({ id: room.id, room_number: room.room_number })))
    setLoading(false)
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const filtered = bookings.filter((booking) => {
    const matchSearch = !search || (booking.guest_name || '').toLowerCase().includes(search.toLowerCase())
    if (tab === 'today') return matchSearch && (booking.check_in === today || booking.check_out === today) && booking.status !== 'cancelled'
    if (tab === 'upcoming') return matchSearch && booking.check_in > today && booking.status === 'confirmed'
    return matchSearch
  })

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
          <div className="flex gap-2">
            {[['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${tab === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
                {label}
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

        <div className="mt-3">
          <FrontDeskNotice compact />
        </div>
        <p className="mt-2 text-[11px] text-gray-500">Online requests stay marked as pending until front desk accepts them in the desktop app.</p>
      </div>

      {view === 'calendar' && !loading ? (
        <CalendarView bookings={bookings} rooms={rooms} onSelectBooking={setSelected} />
      ) : (
        <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-gray-500 text-sm text-center pt-12">No bookings found.</p>
          ) : filtered.map((booking) => (
            <button key={booking.id} onClick={() => setSelected(booking)} className="w-full bg-gray-800 rounded-2xl p-4 text-left active:scale-[0.98] transition-transform">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm">{booking.guest_name || 'Guest'}</p>
                  {booking.source === 'online' && booking.status === 'pending' && (
                    <p className="text-[11px] text-amber-300 mt-1">Online request waiting for front desk confirmation</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[booking.status]}`}>{booking.status.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-gray-400 text-xs">{booking.check_in} → {booking.check_out}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${PAY_COLOR[booking.payment_status]}`}>{booking.payment_status}</span>
              </div>
              <p className="text-gray-500 text-xs mt-1">P {(Number(booking.total_amount || 0) + Number(booking.charges_total || 0)).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}

      {selected && <BookingSheet booking={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
