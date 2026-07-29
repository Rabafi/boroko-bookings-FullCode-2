import { useCallback, useEffect, useMemo, useState } from 'react'
import { BedDouble, CalendarDays, CheckCircle2, ClipboardList, RefreshCw, Wrench } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createMaintenance, listBookings, listMaintenanceTickets, listRooms } from '../lib/api'
import EmptyState from '../components/EmptyState'
import DataFreshness from '../components/DataFreshness'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

const MODES = {
  calendar: { title: 'Planning', subtitle: 'Upcoming stays and room demand', icon: CalendarDays },
  roomgrid: { title: 'Room Board', subtitle: 'Live room availability and occupancy', icon: BedDouble },
  housekeeping: { title: 'Housekeeping', subtitle: 'Room readiness and cleaning watch', icon: CheckCircle2 },
  maintenance: { title: 'Maintenance', subtitle: 'Live ticket watch and new requests', icon: Wrench }
}

function stayName(booking) {
  return booking.customer_name || booking.guest_name || booking.customer?.name || 'Guest'
}

function roomStatus(room, activeBookings, openTickets) {
  if (openTickets.some((ticket) => String(ticket.room_id || '') === String(room.id))) return 'maintenance'
  if (activeBookings.some((booking) => String(booking.room_id || '') === String(room.id))) return 'occupied'
  return String(room.housekeeping_status || room.status || 'clean').toLowerCase()
}

function statusTone(status) {
  if (status === 'occupied') return 'border-red-800 bg-red-950/35 text-red-200'
  if (status === 'maintenance' || status === 'out_of_service') return 'border-orange-800 bg-orange-950/35 text-orange-200'
  if (status === 'dirty') return 'border-yellow-800 bg-yellow-950/35 text-yellow-200'
  if (status === 'in_progress') return 'border-sky-800 bg-sky-950/35 text-sky-200'
  return 'border-emerald-800 bg-emerald-950/35 text-emerald-200'
}

export default function PropertyOperations({ mode }) {
  const { user } = useAuth()
  const config = MODES[mode] || MODES.roomgrid
  const Icon = config.icon
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [title, setTitle] = useState('')
  const [roomId, setRoomId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [roomRows, bookingRows, ticketRows] = await Promise.all([
        listRooms(user.lodge_id),
        listBookings(user.lodge_id, { forceFresh: true }),
        listMaintenanceTickets(user.lodge_id, { forceFresh: true })
      ])
      setRooms(roomRows || [])
      setBookings(bookingRows || [])
      setTickets(ticketRows || [])
      setUpdatedAt(new Date().toISOString())
    } catch (loadError) {
      setError(loadError?.message || `${config.title} could not load.`)
    } finally {
      setLoading(false)
    }
  }, [config.title, user.lodge_id])

  useEffect(() => { load() }, [load])

  const activeBookings = useMemo(() => bookings.filter((booking) => ['confirmed', 'pending', 'checked_in'].includes(booking.status)), [bookings])
  const openTickets = useMemo(() => tickets.filter((ticket) => ticket.status !== 'resolved'), [tickets])
  const orderedBookings = useMemo(() => [...activeBookings].sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || ''))), [activeBookings])
  const roomRows = useMemo(() => rooms.map((room) => ({ room, status: roomStatus(room, activeBookings.filter((booking) => booking.status === 'checked_in'), openTickets) })), [activeBookings, openTickets, rooms])

  const submitTicket = async (event) => {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      await createMaintenance(user.lodge_id, {
        room_id: roomId || null,
        title: title.trim(),
        description: title.trim(),
        priority: 'medium',
        status: 'open'
      })
      setTitle('')
      setRoomId('')
      await load()
    } catch (submitError) {
      setError(submitError?.message || 'Maintenance ticket could not be raised.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <header className="bg-gray-900 px-4 pb-4 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-lg font-bold text-white">{config.title}</h1><p className="mt-1 text-xs text-gray-400">{config.subtitle}</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div>
          <button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label={`Refresh ${config.title}`}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

        {mode === 'calendar' && (
          <section className="space-y-2">
            {orderedBookings.length === 0 ? <EmptyState icon={CalendarDays} title="No upcoming stays" message="Confirmed and in-house stays will appear here." /> : orderedBookings.map((booking) => (
              <div key={booking.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{stayName(booking)}</p><p className="mt-1 text-xs text-gray-500">{booking.check_in} – {booking.check_out} · {booking.room?.room_number ? `Room ${booking.room.room_number}` : 'Room pending'}</p></div><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">{booking.status.replace('_', ' ')}</span></div></div>
            ))}
          </section>
        )}

        {(mode === 'roomgrid' || mode === 'housekeeping') && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {roomRows.map(({ room, status }) => <div key={room.id} className={`rounded-2xl border p-3 ${statusTone(status)}`}><div className="flex items-center justify-between"><span className="text-sm font-bold">{room.room_number}</span><span className="h-2 w-2 rounded-full bg-current" /></div><p className="mt-1 truncate text-xs opacity-75">{room.room_type || 'Room'}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">{status.replace('_', ' ')}</p></div>)}
            </div>
            {!loading && roomRows.length === 0 ? <EmptyState icon={BedDouble} title="No rooms found" message="Rooms will appear after property setup is complete." /> : null}
          </>
        )}

        {mode === 'maintenance' && (
          <>
            <form onSubmit={submitTicket} className="rounded-2xl bg-gray-800 p-4"><p className="text-sm font-semibold text-white">Raise a maintenance ticket</p><input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-3 w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white" placeholder="Describe the issue" /><select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white"><option value="">General property issue</option>{rooms.map((room) => <option key={room.id} value={room.id}>Room {room.room_number}</option>)}</select><button disabled={saving || !title.trim()} className="mt-3 w-full rounded-xl bg-orange-700 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Raise ticket'}</button></form>
            <section className="space-y-2">{openTickets.length === 0 ? <EmptyState icon={Wrench} title="No open maintenance tickets" message="New tickets will appear here immediately, including queued offline work." /> : openTickets.map((ticket) => <div key={ticket.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{ticket.title || ticket.issue || 'Maintenance ticket'}</p><p className="mt-1 text-xs text-gray-500">{ticket.priority || 'medium'} priority · {ticket.reported_date || String(ticket.created_at || '').slice(0, 10)}</p></div><ClipboardList size={17} className="text-orange-300" /></div></div>)}</section>
          </>
        )}

        <MobileBoundaryNotice compact>{mode === 'housekeeping' ? 'This manager view shows room readiness. Cleaning-state updates remain in the controlled front-desk workflow.' : 'Data is live from the selected company. Financial and room-stay mutations remain server-authorized.'}</MobileBoundaryNotice>
      </main>
    </div>
  )
}
