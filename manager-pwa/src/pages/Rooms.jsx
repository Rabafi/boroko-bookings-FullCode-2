import { useEffect, useMemo, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { createMaintenanceTicket, normalizeMaintenanceTicket } from '../lib/maintenance'
import { AlertTriangle, BedDouble, Check, RefreshCw, Wrench, X } from 'lucide-react'
import { listBookings, listMaintenanceTickets, listRooms } from '../lib/api'
import { readCacheEntry } from '../lib/runtime'
import { useToast } from '../App'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

const STATUS_CONFIG = {
  clean: { label: 'Clean', bg: 'bg-green-800/60', border: 'border-green-600', dot: 'bg-green-400' },
  dirty: { label: 'Dirty', bg: 'bg-yellow-800/40', border: 'border-yellow-600', dot: 'bg-yellow-400' },
  in_progress: { label: 'Cleaning', bg: 'bg-blue-800/40', border: 'border-blue-600', dot: 'bg-blue-400' },
  out_of_service: { label: 'Out of service', bg: 'bg-gray-800/60', border: 'border-gray-600', dot: 'bg-gray-500' },
  occupied: { label: 'Occupied', bg: 'bg-red-800/40', border: 'border-red-600', dot: 'bg-red-400' },
  maintenance: { label: 'Maintenance', bg: 'bg-orange-900/45', border: 'border-orange-600', dot: 'bg-orange-400' }
}

const FILTERS = [
  ['all', 'All'],
  ['occupied', 'Occupied'],
  ['dirty', 'Dirty'],
  ['in_progress', 'Cleaning'],
  ['out_of_service', 'OOS'],
  ['maintenance', 'Maintenance']
]

function matchesRoomFilter(item, filter) {
  if (filter === 'all') return true
  if (filter === 'occupied') return Boolean(item.booking)
  if (filter === 'maintenance') return item.status === 'maintenance'
  return item.status === filter
}

function RoomSheet({ room, booking, maintenanceItems = [], onClose, onUpdate }) {
  const { showToast } = useToast()
  const [maint, setMaint] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState('')

  const raiseMaintenance = async () => {
    if (!maint.trim()) return
    setSaving(true)
    try {
      const result = await createMaintenanceTicket({
        room_id: room.id,
        lodge_id: room.lodge_id,
        title: maint,
        issue: maint,
        description: '',
        status: 'open',
        priority: 'medium'
      })
      setDone('maint')
      setMaint('')
      onUpdate?.()
      showToast({
        title: result?.queued ? 'Ticket saved offline' : 'Maintenance ticket raised',
        message: result?.queued
          ? 'It will send automatically when the device reconnects.'
          : `Front desk can now track Room ${room.room_number}.`,
        tone: result?.queued ? 'queued' : 'success'
      })
      setTimeout(() => { setDone('') }, 1500)
    } catch (error) {
      showToast({
        title: 'Ticket was not raised',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 pb-28 max-h-[85vh] overflow-y-auto overscroll-contain" onClick={(event) => event.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Room {room.room_number}</h2>
            <p className="text-xs text-gray-400">{room.room_type || 'Room'}{room.name ? ` · ${room.name}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500"><X size={20} /></button>
        </div>

        {booking && (
          <div className="bg-gray-800 rounded-xl p-3 mb-4">
            <p className="text-xs text-gray-400 mb-1">Current Guest</p>
            <p className="text-sm font-semibold text-white">{booking.guest_name || 'Guest'}</p>
            <p className="text-xs text-gray-400">Checkout: {booking.check_out}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
              booking.payment_status === 'paid' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
            }`}>{booking.payment_status}</span>
          </div>
        )}

        {maintenanceItems.length > 0 && (
          <div className="bg-orange-950/30 border border-orange-900 rounded-xl p-3 mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-300">Open maintenance</p>
            <div className="mt-2 space-y-2">
              {maintenanceItems.slice(0, 3).map((ticket) => (
                <div key={ticket.id} className="rounded-lg bg-gray-900 px-3 py-2">
                  <p className="text-sm font-semibold text-white">{ticket.title || 'Maintenance ticket'}</p>
                  <p className="text-xs text-gray-400 mt-1">{ticket.priority || 'normal'} priority</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 rounded-xl border border-blue-900 bg-blue-950/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Read only</p>
          <p className="mt-1 text-sm text-blue-100">
            Housekeeping and room-state changes stay in Front Desk. Managers can view status here and raise a maintenance request if needed.
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><Wrench size={12} /> Raise Maintenance Ticket</p>
          <textarea
            className={`${inp} h-20 resize-none`}
            placeholder="Describe the issue..."
            value={maint}
            onChange={(event) => setMaint(event.target.value)}
          />
          <button
            onClick={raiseMaintenance}
            disabled={saving || !maint.trim()}
            className="w-full mt-2 bg-orange-700 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {done === 'maint' ? <><Check size={16} /> Ticket Raised</> : 'Raise Ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Rooms() {
  const { user } = useAuth()
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [roomRows, bookingRows, maintenanceRows] = await Promise.all([
        listRooms(user.lodge_id).catch(() => []),
        listBookings(user.lodge_id).catch(() => []),
        listMaintenanceTickets(user.lodge_id).catch(() => [])
      ])
      setRooms(roomRows || [])
      setBookings((bookingRows || []).filter((booking) => booking.status === 'checked_in'))
      setMaintenance((maintenanceRows || []).filter((ticket) => ticket.status !== 'resolved').map(normalizeMaintenanceTicket))
      const cacheTimes = [
        readCacheEntry(user.lodge_id, 'rooms', null)?.updatedAt,
        readCacheEntry(user.lodge_id, 'bookings', null)?.updatedAt,
        readCacheEntry(user.lodge_id, 'maintenance', null)?.updatedAt
      ].filter(Boolean).sort()
      setLastUpdated(cacheTimes.at(-1) || null)
    } catch (error) {
      setLoadError(error?.message || 'Rooms could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const roomItems = useMemo(() => rooms.map((room) => {
    const booking = bookings.find((row) => row.room_id === room.id) || null
    const maintenanceItems = maintenance.filter((ticket) => ticket.room_id === room.id || String(ticket.room_id || '') === String(room.id))
    const status = maintenanceItems.length > 0 || room.status === 'maintenance'
      ? 'maintenance'
      : booking
        ? 'occupied'
        : room.housekeeping_status || 'clean'
    return { room, booking, maintenanceItems, status }
  }), [bookings, maintenance, rooms])

  const summary = useMemo(() => ({
    total: roomItems.length,
    occupied: roomItems.filter((item) => item.booking).length,
    dirty: roomItems.filter((item) => item.status === 'dirty').length,
    maintenance: roomItems.filter((item) => item.status === 'maintenance').length
  }), [roomItems])

  const filterCounts = useMemo(() => Object.fromEntries(
    FILTERS.map(([id]) => [id, roomItems.filter((item) => matchesRoomFilter(item, id)).length])
  ), [roomItems])

  const filteredRooms = filter === 'all'
    ? roomItems
    : roomItems.filter((item) => matchesRoomFilter(item, filter))

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Rooms</h1>
          <p className="text-xs text-gray-400">{summary.total} total · {summary.occupied} occupied · {summary.maintenance} maintenance</p>
          <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-1" />
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {loadError && (
          <div className="bg-red-950/40 border border-red-900 rounded-2xl px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {[
            ['Rooms', summary.total, 'text-white'],
            ['Occupied', summary.occupied, 'text-red-300'],
            ['Dirty', summary.dirty, 'text-yellow-300'],
            ['Maint.', summary.maintenance, 'text-orange-300']
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl bg-gray-800 px-2 py-3 text-center">
              <p className={`text-lg font-bold ${tone}`}>{value}</p>
              <p className="text-[10px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${filter === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              {label}
              <span className="ml-1 opacity-70">{filterCounts[id] || 0}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filteredRooms.length === 0 ? (
          <EmptyState
            icon={BedDouble}
            title={rooms.length === 0 ? 'No rooms on this device yet' : 'No rooms in this filter'}
            message={rooms.length === 0 ? 'Refresh once the connection is stable, or ask front desk to confirm rooms are active on desktop.' : 'Try another room status or open Alerts if you are looking for maintenance follow-up.'}
            action={
              filter !== 'all'
                ? <button type="button" onClick={() => setFilter('all')} className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Show all rooms</button>
                : null
            }
          />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredRooms.map((item) => {
              const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.clean
              return (
                <button
                  key={item.room.id}
                  onClick={() => setSelected(item)}
                  className={`${cfg.bg} border ${cfg.border} rounded-2xl p-3 text-left transition-all active:scale-95`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-bold text-sm">{item.room.room_number}</span>
                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                  </div>
                  <p className="text-gray-400 text-xs truncate">{item.room.room_type || 'Room'}</p>
                  <p className="text-gray-500 text-[10px] mt-0.5">{cfg.label}</p>
                  {item.maintenanceItems.length > 0 && item.status !== 'maintenance' && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-orange-300"><AlertTriangle size={10} /> Maintenance</p>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <MobileBoundaryNotice compact>
          Room status is view-first on mobile. Managers can raise maintenance, while front desk completes housekeeping and room-state changes on desktop.
        </MobileBoundaryNotice>
      </div>

      {selected && (
        <RoomSheet
          room={selected.room}
          booking={selected.booking}
          maintenanceItems={selected.maintenanceItems}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}
