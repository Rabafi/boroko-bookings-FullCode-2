import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, AlertCircle, Clock, RefreshCw, Package2, BarChart3, ClipboardList } from 'lucide-react'
import { useSettings } from '../App'

const STATUS_CONFIG = {
  clean: {
    label: 'Clean',
    icon: CheckCircle,
    badge: 'bg-green-100 text-green-700',
    row: ''
  },
  dirty: {
    label: 'Dirty',
    icon: AlertCircle,
    badge: 'bg-red-100 text-red-700',
    row: 'bg-red-50/40'
  },
  in_progress: {
    label: 'In Progress',
    icon: Clock,
    badge: 'bg-yellow-100 text-yellow-700',
    row: 'bg-yellow-50/40'
  }
}

export default function Housekeeping() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [rooms, setRooms] = useState([])
  const [todayBookings, setTodayBookings] = useState([])
  const [supplyItems, setSupplyItems] = useState([])
  const [weekAllocations, setWeekAllocations] = useState([])
  const [saving, setSaving] = useState(null) // room id being saved
  const [noteEdits, setNoteEdits] = useState({}) // { [roomId]: string }
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const thisMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }
  const weekStart = thisMonday()
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = (() => {
    const date = new Date(today + 'T12:00:00')
    date.setDate(date.getDate() + 1)
    return date.toISOString().split('T')[0]
  })()

  useEffect(() => { loadRooms() }, [])

  const loadRooms = async () => {
    setLoading(true)
    setError('')
    try {
      const [roomData, bookingData, itemData, allocationData] = await Promise.all([
        window.api.rooms.getAll().catch(() => []),
        window.api.bookings.getByDateRange(today, tomorrow).catch(() => []),
        window.api.supplies?.getItems?.().catch(() => []),
        window.api.supplies?.getWeekAllocations?.(weekStart).catch(() => [])
      ])
      setRooms(roomData || [])
      setTodayBookings(bookingData || [])
      setSupplyItems(itemData || [])
      setWeekAllocations(allocationData || [])
    } catch (e) {
      setError(e.message || 'Could not load housekeeping overview.')
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (room, newStatus) => {
    setError('')
    // Optimistic update — show change immediately
    setRooms((prev) =>
      prev.map((r) => r.id === room.id ? { ...r, housekeeping_status: newStatus } : r)
    )
    setSaving(room.id)
    const notes = noteEdits[room.id] ?? room.housekeeping_notes ?? ''
    try {
      const result = await window.api.rooms.updateHousekeeping(room.id, newStatus, notes)
      if (result && result.success === false) {
        setError(`Update failed: ${result.error || 'Unknown error'}. Make sure you have run the housekeeping SQL migration.`)
        setRooms((prev) =>
          prev.map((r) => r.id === room.id ? { ...r, housekeeping_status: room.housekeeping_status } : r)
        )
      }
      await loadRooms()
    } catch (e) {
      setError(e.message || 'Update failed')
      setRooms((prev) =>
        prev.map((r) => r.id === room.id ? { ...r, housekeeping_status: room.housekeeping_status } : r)
      )
    } finally {
      setSaving(null)
    }
  }

  const saveNotes = async (room) => {
    setSaving(room.id)
    const notes = noteEdits[room.id] ?? room.housekeeping_notes ?? ''
    try {
      await window.api.rooms.updateHousekeeping(room.id, room.housekeeping_status || 'clean', notes)
      setNoteEdits((prev) => {
        const next = { ...prev }
        delete next[room.id]
        return next
      })
      await loadRooms()
    } finally {
      setSaving(null)
    }
  }

  const counts = {
    clean:       rooms.filter((r) => (r.housekeeping_status || 'clean') === 'clean').length,
    dirty:       rooms.filter((r) => r.housekeeping_status === 'dirty').length,
    in_progress: rooms.filter((r) => r.housekeeping_status === 'in_progress').length
  }

  const roomMap = useMemo(
    () => Object.fromEntries(rooms.map((room) => [room.id, room])),
    [rooms]
  )

  const itemMap = useMemo(
    () => Object.fromEntries(supplyItems.map((item) => [item.id, item])),
    [supplyItems]
  )

  const supplySummary = useMemo(() => {
    const roomTotals = {}
    const itemTotals = {}
    let totalCost = 0
    let totalUnits = 0

    for (const row of weekAllocations) {
      const room = roomMap[row.room_id]
      const item = itemMap[row.supply_item_id]
      const roomKey = row.room_id
      const itemKey = row.supply_item_id
      const cost = Number(row.total_cost || 0)
      const units = Number(row.units_used || 0)
      totalCost += cost
      totalUnits += units

      if (!roomTotals[roomKey]) {
        roomTotals[roomKey] = {
          room_id: row.room_id,
          room_number: room?.room_number || '—',
          room_type: room?.room_type || '',
          total_cost: 0,
          total_units: 0,
          item_count: 0
        }
      }
      roomTotals[roomKey].total_cost += cost
      roomTotals[roomKey].total_units += units
      roomTotals[roomKey].item_count += 1

      if (!itemTotals[itemKey]) {
        itemTotals[itemKey] = {
          supply_item_id: row.supply_item_id,
          name: item?.name || 'Unknown item',
          unit: item?.unit || '',
          total_cost: 0,
          total_units: 0,
          room_count: 0
        }
      }
      itemTotals[itemKey].total_cost += cost
      itemTotals[itemKey].total_units += units
      itemTotals[itemKey].room_count += 1
    }

    const byRoom = Object.values(roomTotals).sort((a, b) => b.total_cost - a.total_cost)
    const byItem = Object.values(itemTotals).sort((a, b) => b.total_cost - a.total_cost)

    return {
      totalCost,
      totalUnits,
      roomsTracked: byRoom.length,
      topRooms: byRoom.slice(0, 5),
      topItems: byItem.slice(0, 5)
    }
  }, [weekAllocations, roomMap, itemMap])

  const notesNeedingAttention = rooms.filter((room) => String(room.housekeeping_notes || '').trim()).length
  const dirtyOrInProgress = counts.dirty + counts.in_progress
  const arrivingToday = todayBookings.filter((booking) => booking.check_in === today && booking.status !== 'cancelled')
  const arrivalAttention = arrivingToday
    .map((booking) => {
      const room = rooms.find((entry) => String(entry.id) === String(booking.room_id))
      if (!room) return null
      const housekeepingStatus = room.housekeeping_status || 'clean'
      if (housekeepingStatus === 'clean') return null
      return { booking, room, housekeepingStatus }
    })
    .filter(Boolean)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Housekeeping Operations</p>
          <h1 className="bb-page-header-title mt-2">Housekeeping</h1>
          <p className="bb-page-header-subtitle">
            {counts.clean} clean · {counts.in_progress} in progress · {counts.dirty} dirty
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => navigate('/supplies')}
            className="btn-secondary"
          >
            <BarChart3 size={14} /> Open Supply Report
          </button>
          <button
            onClick={loadRooms}
            className="btn-secondary"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <div key={key} className="bb-card flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cfg.badge}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{counts[key]}</p>
                <p className="text-xs text-slate-500">{cfg.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Package2 size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{currency} {Number(supplySummary.totalCost || 0).toFixed(2)}</p>
            <p className="text-xs text-slate-500">Supply cost this week</p>
          </div>
        </div>
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <ClipboardList size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{supplySummary.roomsTracked}</p>
            <p className="text-xs text-slate-500">Rooms with supply capture</p>
          </div>
        </div>
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{dirtyOrInProgress}</p>
            <p className="text-xs text-slate-500">Rooms still needing attention</p>
          </div>
        </div>
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
            <CheckCircle size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{notesNeedingAttention}</p>
            <p className="text-xs text-slate-500">Rooms with housekeeping notes</p>
          </div>
        </div>
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{arrivalAttention.length}</p>
            <p className="text-xs text-slate-500">Today&apos;s arrivals needing prep</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="bb-card p-5 xl:col-span-1">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Weekly housekeeping report</p>
              <p className="mt-1 text-xs text-slate-500">
                Based on room-supply capture for the week starting {weekStart}.
              </p>
            </div>
            <button onClick={() => navigate('/supplies')} className="btn-secondary text-xs">
              Detailed Report
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bb-card-muted p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Units Used</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{Math.round(supplySummary.totalUnits || 0)}</p>
              <p className="mt-1 text-xs text-slate-500">Consumables recorded across all captured rooms this week.</p>
            </div>
            <div className="bb-card-muted p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Top Cost Driver</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{supplySummary.topItems[0]?.name || 'No data yet'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {supplySummary.topItems[0]
                  ? `${currency} ${Number(supplySummary.topItems[0].total_cost || 0).toFixed(2)} this week`
                  : 'Start weekly capture to see which supplies cost the most.'}
              </p>
            </div>
          </div>
        </div>

        <div className="bb-card p-5 xl:col-span-1">
          <p className="text-sm font-semibold text-slate-900">Highest supply cost rooms</p>
          <p className="mt-1 text-xs text-slate-500">Use this to spot rooms that are consuming more stock than expected.</p>
          <div className="mt-4 space-y-3">
            {supplySummary.topRooms.length > 0 ? supplySummary.topRooms.map((room) => (
              <div key={room.room_id} className="bb-card-muted flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Room {room.room_number}</p>
                  <p className="text-xs text-slate-500">{room.room_type || 'Room'} · {Math.round(room.total_units)} units across {room.item_count} logged items</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{currency} {Number(room.total_cost || 0).toFixed(2)}</p>
                </div>
              </div>
            )) : (
              <div className="bb-empty-state min-h-[160px] px-4 py-6">
                <p className="text-base font-semibold text-slate-800">No weekly supply capture yet</p>
                <p className="text-sm text-slate-500">Capture items like toilet paper, soap, and linen use to compare room cost this week.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bb-card p-5 xl:col-span-1">
          <p className="text-sm font-semibold text-slate-900">Most used housekeeping supplies</p>
          <p className="mt-1 text-xs text-slate-500">Track consumables that drive recurring housekeeping cost.</p>
          <div className="mt-4 space-y-3">
            {supplySummary.topItems.length > 0 ? supplySummary.topItems.map((item) => (
              <div key={item.supply_item_id} className="bb-card-muted flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">{Math.round(item.total_units)} {item.unit || 'units'} used across {item.room_count} room entries</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{currency} {Number(item.total_cost || 0).toFixed(2)}</p>
                </div>
              </div>
            )) : (
              <div className="bb-empty-state min-h-[160px] px-4 py-6">
                <p className="text-base font-semibold text-slate-800">No supply cost data yet</p>
                <p className="text-sm text-slate-500">Room Supplies can track toilet paper, amenities, linen, and other consumables by room.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 font-bold flex-shrink-0">✕</button>
        </div>
      )}

      {arrivalAttention.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Arrival Readiness Alert</p>
              <p className="mt-1 text-sm text-amber-800">
                These rooms have guests arriving today but still show dirty or in-progress housekeeping status.
              </p>
            </div>
            <button
              onClick={() => navigate('/roomgrid')}
              className="btn-secondary text-xs"
            >
              Open Room Board
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {arrivalAttention.slice(0, 5).map(({ booking, room, housekeepingStatus }) => (
              <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white/80 px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Room {room.room_number} · {booking.customer_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Arriving today · {room.room_type || 'Room'} · status {housekeepingStatus === 'in_progress' ? 'in progress' : housekeepingStatus}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/bookings', { state: { focusBookingId: booking.id } })}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Open Booking
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Room cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && rooms.length === 0 && (
          <div className="col-span-3">
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-base font-semibold text-slate-800">Loading housekeeping board</p>
              <p className="text-sm text-slate-500">Bringing in room status, notes, and this week&apos;s supply capture.</p>
            </div>
          </div>
        )}
        {rooms.map((room) => {
          const status = room.housekeeping_status || 'clean'
          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.clean
          const Icon = cfg.icon
          const noteVal = noteEdits[room.id] ?? room.housekeeping_notes ?? ''
          const isDirty = room.id in noteEdits && noteEdits[room.id] !== (room.housekeeping_notes ?? '')
          const isSaving = saving === room.id
          const roomSupplyRows = weekAllocations.filter((row) => row.room_id === room.id)
          const roomSupplyCost = roomSupplyRows.reduce((sum, row) => sum + Number(row.total_cost || 0), 0)
          const roomUnitsUsed = roomSupplyRows.reduce((sum, row) => sum + Number(row.units_used || 0), 0)

          return (
            <div
              key={room.id}
              className={`bb-card overflow-hidden border-l-4 ${
                status === 'clean' ? 'border-green-400' :
                status === 'dirty' ? 'border-red-400' : 'border-yellow-400'
              }`}
            >
              <div className="px-5 py-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-slate-800">Room {room.room_number}</p>
                    <p className="text-xs text-slate-400">{room.room_type}</p>
                    {arrivalAttention.some((entry) => String(entry.room.id) === String(room.id)) && (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">Arrival today needs readiness</p>
                    )}
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                    <Icon size={11} />
                    {cfg.label}
                  </span>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Weekly Supply Cost</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {roomSupplyCost > 0 ? `${currency} ${roomSupplyCost.toFixed(2)}` : 'Not captured yet'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Usage Logged</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {roomSupplyRows.length > 0 ? `${Math.round(roomUnitsUsed)} units` : 'No room-supply entries'}
                    </p>
                  </div>
                </div>

                {/* Notes */}
                <textarea
                  className="input mb-3 w-full resize-none text-xs"
                  rows={2}
                  placeholder="Housekeeping notes (e.g. needs extra towels)..."
                  value={noteVal}
                  onChange={(e) => setNoteEdits((prev) => ({ ...prev, [room.id]: e.target.value }))}
                />

                {/* Status buttons */}
                <div className="flex gap-2">
                  {Object.entries(STATUS_CONFIG).map(([key, c]) => (
                    <button
                      key={key}
                      disabled={isSaving || status === key}
                      onClick={() => updateStatus(room, key)}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                        status === key
                          ? `${c.badge} cursor-default`
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {isSaving && status !== key ? '...' : c.label}
                    </button>
                  ))}
                </div>

                {/* Save notes button — only show if notes were edited */}
                {isDirty && (
                  <button
                    onClick={() => saveNotes(room)}
                    disabled={isSaving}
                    className="mt-2 w-full rounded-lg bg-green-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
                  >
                    {isSaving ? 'Saving...' : 'Save Notes'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {!loading && rooms.length === 0 && (
          <div className="col-span-3">
            <div className="bb-empty-state min-h-[240px]">
              <p className="text-base font-semibold text-slate-800">No rooms found</p>
              <p className="text-sm text-slate-500">Add rooms first so housekeeping can track readiness and notes.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
