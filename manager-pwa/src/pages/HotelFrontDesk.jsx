import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BedDouble, ChevronRight, ClipboardCheck, LogIn, LogOut, RefreshCw, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listBookings, listRooms } from '../lib/api'
import EmptyState from '../components/EmptyState'
import DataFreshness from '../components/DataFreshness'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function guestName(booking) {
  return booking.customer_name || booking.guest_name || booking.customer?.name || 'Guest'
}

function StayList({ title, icon: Icon, rows, empty, tone = 'text-white' }) {
  return (
    <section className="rounded-2xl bg-gray-800 p-4">
      <div className="flex items-center gap-2">
        <Icon size={17} className={tone} />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className="ml-auto text-xs text-gray-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.slice(0, 6).map((booking) => (
            <Link
              key={booking.id}
              to="/bookings"
              className="flex items-center gap-3 rounded-xl bg-gray-900 px-3 py-3 active:scale-[0.99]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-gray-300">
                <BedDouble size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{guestName(booking)}</p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {booking.room?.room_number ? `Room ${booking.room.room_number}` : booking.room_number ? `Room ${booking.room_number}` : 'Room assignment pending'}
                  {' · '}{booking.check_in} – {booking.check_out}
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-gray-600" />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export default function HotelFrontDesk() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [bookingRows, roomRows] = await Promise.all([
        listBookings(user.lodge_id, { forceFresh: true }),
        listRooms(user.lodge_id)
      ])
      setBookings(bookingRows || [])
      setRooms(roomRows || [])
      setUpdatedAt(new Date().toISOString())
    } catch (loadError) {
      setError(loadError?.message || 'Hotel front desk could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const overview = useMemo(() => {
    const businessDate = today()
    const active = bookings.filter((booking) => booking.status !== 'cancelled')
    return {
      arrivals: active.filter((booking) => booking.check_in === businessDate && !['checked_in', 'checked_out', 'no_show'].includes(booking.status)),
      departures: active.filter((booking) => booking.check_out === businessDate && booking.status === 'checked_in'),
      inHouse: active.filter((booking) => booking.status === 'checked_in'),
      readyRooms: rooms.filter((room) => ['clean', 'ready', 'available'].includes(String(room.housekeeping_status || room.status || '').toLowerCase())),
      attentionRooms: rooms.filter((room) => ['dirty', 'maintenance', 'out_of_service'].includes(String(room.housekeeping_status || room.status || '').toLowerCase()))
    }
  }, [bookings, rooms])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <header className="bg-gray-900 px-4 pb-4 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Front Desk</h1>
            <p className="mt-1 text-xs text-gray-400">Live arrivals, departures, rooms, and in-house stays</p>
            <DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" />
          </div>
          <button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh front desk">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Arrivals</p><p className="mt-1 text-2xl font-bold text-amber-200">{overview.arrivals.length}</p></div>
          <div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Departures</p><p className="mt-1 text-2xl font-bold text-sky-200">{overview.departures.length}</p></div>
          <div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">In house</p><p className="mt-1 text-2xl font-bold text-emerald-200">{overview.inHouse.length}</p></div>
          <div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Rooms ready</p><p className="mt-1 text-2xl font-bold text-white">{overview.readyRooms.length}</p></div>
        </div>

        {!loading && bookings.length === 0 && rooms.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No front-desk data yet" message="Refresh after the hotel has rooms or bookings available in the current company." />
        ) : null}

        <StayList title="Today’s arrivals" icon={LogIn} rows={overview.arrivals} empty="No arrivals are expected today." tone="text-amber-300" />
        <StayList title="Today’s departures" icon={LogOut} rows={overview.departures} empty="No in-house departures are due today." tone="text-sky-300" />
        <StayList title="In-house guests" icon={Users} rows={overview.inHouse} empty="No guests are currently checked in." tone="text-emerald-300" />

        <section className="rounded-2xl bg-gray-800 p-4">
          <div className="flex items-center gap-2"><BedDouble size={17} className="text-amber-300" /><h2 className="text-sm font-semibold text-white">Room readiness</h2></div>
          <p className="mt-2 text-sm text-gray-400">{overview.readyRooms.length} ready · {overview.attentionRooms.length} need attention</p>
          <Link to="/rooms" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-white">Open rooms <ChevronRight size={15} /></Link>
        </section>
      </main>
    </div>
  )
}
