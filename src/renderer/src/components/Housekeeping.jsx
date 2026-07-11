import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, AlertCircle, Clock, RefreshCw, Package2, BarChart3, ClipboardList, Search, ShowerHead, Sparkles, XCircle, AlertTriangle } from 'lucide-react'
import { useFeatures, useSettings } from '../app-context'
import { formatLocalDate, localDateStringFromOffset, localToday } from '../utils/localDate'
import { StatusBadge } from './shared/StatusBadge'

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

const HOUSEKEEPING_STATES = [
  { key: 'dirty', label: 'Dirty', icon: ShowerHead, tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'in_progress', label: 'In Progress', icon: Clock, tone: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'clean', label: 'Clean', icon: CheckCircle, tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
]

function statusLabel(value) {
  return HOUSEKEEPING_STATES.find((entry) => entry.key === value)?.label || 'Clean'
}

const SHIFT_OPTIONS = ['morning', 'evening', 'night']
const ASSIGNMENT_STATUS_OPTIONS = ['pending', 'in_progress', 'completed', 'skipped']

export default function Housekeeping() {
  const features = useFeatures()
  const isEnterprise = features?.advanced_housekeeping === true
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState('board')

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam) setActiveTab(tabParam)
  }, [searchParams])

  const TABS = [
    ['board', 'Board'],
    ...(isEnterprise ? [
      ['turnover', 'Turnover'],
      ['assignments', 'Assignments'],
      ['inspection', 'Inspection']
    ] : []),
    ['supplies', 'Supplies']
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Housekeeping Operations</p>
          <h1 className="bb-page-header-title mt-2">Housekeeping</h1>
        </div>
      </div>

      {TABS.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setSearchParams({ tab: key }, { replace: true }) }}
              className={`px-4 py-2 text-xs font-semibold transition-colors ${
                activeTab === key
                  ? 'border-b-2 border-emerald-600 text-emerald-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'board' && <BoardTab />}
      {activeTab === 'turnover' && isEnterprise && <TurnoverTab />}
      {activeTab === 'assignments' && isEnterprise && <AssignmentsTab />}
      {activeTab === 'inspection' && isEnterprise && <InspectionTab />}
      {activeTab === 'supplies' && <SuppliesTab />}
    </div>
  )
}

function BoardTab() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const features = useFeatures()
  const [rooms, setRooms] = useState([])
  const [todayBookings, setTodayBookings] = useState([])
  const [saving, setSaving] = useState(null)
  const [noteEdits, setNoteEdits] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const today = localToday()
  const tomorrow = localDateStringFromOffset(1)

  useEffect(() => { loadRooms() }, [])

  const loadRooms = async () => {
    setLoading(true)
    setError('')
    try {
      const [roomData, bookingData] = await Promise.all([
        window.api.rooms.getAll().catch(() => []),
        window.api.bookings.getByDateRange(today, tomorrow).catch(() => [])
      ])
      setRooms(roomData || [])
      setTodayBookings(bookingData || [])
    } catch (e) {
      setError(e.message || 'Could not load housekeeping overview.')
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (room, newStatus) => {
    setError('')
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
    <>
      <div className="flex items-center justify-between">
        <p className="bb-page-header-subtitle">
          {counts.clean} clean · {counts.in_progress} in progress · {counts.dirty} dirty
        </p>
        <button onClick={loadRooms} className="btn-secondary">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="bb-compact-stat-grid">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <div key={key} className="bb-compact-stat flex items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${cfg.badge}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="bb-compact-stat__value">{counts[key]}</p>
                <p className="bb-compact-stat__label text-slate-500">{cfg.label}</p>
              </div>
            </div>
          )
        })}
        <div className="bb-compact-stat flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertCircle size={16} />
          </div>
          <div>
            <p className="bb-compact-stat__value">{dirtyOrInProgress}</p>
            <p className="bb-compact-stat__label text-slate-500">Need attention</p>
          </div>
        </div>
        <div className="bb-compact-stat flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
            <CheckCircle size={16} />
          </div>
          <div>
            <p className="bb-compact-stat__value">{notesNeedingAttention}</p>
            <p className="bb-compact-stat__label text-slate-500">With notes</p>
          </div>
        </div>
        <div className="bb-compact-stat flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Clock size={16} />
          </div>
          <div>
            <p className="bb-compact-stat__value">{arrivalAttention.length}</p>
            <p className="bb-compact-stat__label text-slate-500">Arrival prep</p>
          </div>
        </div>
      </div>

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
            <button onClick={() => navigate('/roomgrid')} className="btn-secondary text-xs">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && rooms.length === 0 && (
          <div className="col-span-3">
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-base font-semibold text-slate-800">Loading housekeeping board</p>
              <p className="text-sm text-slate-500">Bringing in room status and notes.</p>
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

                <textarea
                  className="input mb-3 w-full resize-none text-xs"
                  rows={2}
                  placeholder="Housekeeping notes (e.g. needs extra towels)..."
                  value={noteVal}
                  onChange={(e) => setNoteEdits((prev) => ({ ...prev, [room.id]: e.target.value }))}
                />

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
    </>
  )
}

function TurnoverTab() {
  const [rooms, setRooms] = useState([])
  const [arrivals, setArrivals] = useState([])
  const [departures, setDepartures] = useState([])
  const [savingRoomId, setSavingRoomId] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [roomRows, arrivalRows, departureRows] = await Promise.all([
        window.api.rooms.getAll(),
        window.api.hotel.getArrivals(),
        window.api.hotel.getDepartures()
      ])
      setRooms(Array.isArray(roomRows) ? roomRows : [])
      setArrivals(Array.isArray(arrivalRows) ? arrivalRows : [])
      setDepartures(Array.isArray(departureRows) ? departureRows : [])
    } catch (err) {
      setError(err?.message || 'Could not load turnover board.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const arrivalRoomIds = useMemo(() => new Set(arrivals.map((b) => String(b.room_id))), [arrivals])
  const departureRoomIds = useMemo(() => new Set(departures.map((b) => String(b.room_id))), [departures])

  const filteredRooms = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rooms
      .filter((room) => {
        if (!needle) return true
        return [room.room_number, room.room_type, room.housekeeping_status, room.housekeeping_notes]
          .some((v) => String(v || '').toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        const aDep = departureRoomIds.has(String(a.id)) ? 0 : 1
        const bDep = departureRoomIds.has(String(b.id)) ? 0 : 1
        if (aDep !== bDep) return aDep - bDep
        const aArr = arrivalRoomIds.has(String(a.id)) ? 0 : 1
        const bArr = arrivalRoomIds.has(String(b.id)) ? 0 : 1
        if (aArr !== bArr) return aArr - bArr
        return String(a.room_number || '').localeCompare(String(b.room_number || ''), undefined, { numeric: true })
      })
  }, [arrivalRoomIds, departureRoomIds, query, rooms])

  const counts = HOUSEKEEPING_STATES.reduce((acc, entry) => {
    acc[entry.key] = rooms.filter((room) => (room.housekeeping_status || 'clean') === entry.key).length
    return acc
  }, {})

  const saveStatus = async (room, nextStatus) => {
    setSavingRoomId(room.id)
    setError('')
    const previousStatus = room.housekeeping_status || 'clean'
    setRooms((current) => current.map((entry) => (
      entry.id === room.id ? { ...entry, housekeeping_status: nextStatus } : entry
    )))
    try {
      const result = await window.api.rooms.updateHousekeeping(room.id, nextStatus, room.housekeeping_notes || '')
      if (result?.success === false) throw new Error(result.error || 'Housekeeping update failed')
      await loadData()
    } catch (err) {
      setRooms((current) => current.map((entry) => (
        entry.id === room.id ? { ...entry, housekeeping_status: previousStatus } : entry
      )))
      setError(err?.message || 'Housekeeping update failed')
    } finally {
      setSavingRoomId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Supervisor-ready room turnaround, arrival priority, and readiness tracking.</p>
        <button type="button" onClick={loadData} className="btn-secondary">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} className="mr-2 inline" />
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {HOUSEKEEPING_STATES.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="bb-card flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${tone}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{counts[key] || 0}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            </div>
          </div>
        ))}
        <div className="bb-card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-purple-200 bg-purple-100 text-purple-700">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{arrivals.length}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arrivals Today</p>
          </div>
        </div>
      </div>

      <div className="bb-card p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search room, type, status, or notes"
          />
        </div>
      </div>

      <div className="bb-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRooms.map((room) => {
              const currentStatus = room.housekeeping_status || 'clean'
              const arrivalDue = arrivalRoomIds.has(String(room.id))
              const departureDue = departureRoomIds.has(String(room.id))
              return (
                <div key={room.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">Room {room.room_number}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {room.room_type || 'Room'}
                      </span>
                      {departureDue && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Departure</span>}
                      {arrivalDue && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">Arrival</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Current readiness: {statusLabel(currentStatus)}
                      {room.housekeeping_notes ? ` - ${room.housekeeping_notes}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {HOUSEKEEPING_STATES.map((state) => (
                      <button
                        key={state.key}
                        type="button"
                        disabled={savingRoomId === room.id || currentStatus === state.key}
                        onClick={() => saveStatus(room, state.key)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                          currentStatus === state.key
                            ? state.tone
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60'
                        }`}
                      >
                        {savingRoomId === room.id && currentStatus !== state.key ? 'Saving...' : state.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {filteredRooms.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-500">No rooms match this view.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AssignmentsTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [activeTab, setActiveTab] = useState('board')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [selectedRoom, setSelectedRoom] = useState('')
  const [selectedAttendant, setSelectedAttendant] = useState('')
  const [selectedShift, setSelectedShift] = useState('morning')
  const [notes, setNotes] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const dash = await window.api.housekeepingCommandCenter.getDashboard(selectedDate)
      setDashboard(dash)
    } catch (err) {
      setError(err?.message || 'Failed to load assignments')
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadData() }, [loadData])

  const summaryCards = useMemo(() => {
    if (!dashboard) return null
    return [
      { label: 'Dirty Rooms', value: dashboard.dirty_rooms || 0, color: 'text-amber-600' },
      { label: 'Clean Rooms', value: dashboard.clean_rooms || 0, color: 'text-emerald-600' },
      { label: 'Assignments', value: (dashboard.assignments || []).length, color: 'text-blue-600' },
      { label: 'Inspections', value: (dashboard.inspections || []).length, color: 'text-purple-600' },
      { label: 'Turnarounds', value: (dashboard.turnarounds || []).length, color: 'text-slate-600' }
    ]
  }, [dashboard])

  const handleCreateAssignment = async () => {
    if (!selectedRoom || !selectedAttendant) return
    try {
      await window.api.housekeepingCommandCenter.createAssignment(selectedRoom, selectedAttendant, selectedDate, selectedShift)
      setNotes('Assignment created')
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleUpdateStatus = async (id, status) => {
    try {
      await window.api.housekeepingCommandCenter.updateAssignmentStatus(id, status, notes)
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
          />
          <button onClick={loadData} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {[['board', 'Board'], ['assign', 'Create Assignment']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {summaryCards && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <div key={card.label} className="bb-card p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'board' && (
        <section className="bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <Clock size={18} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-800">Today's Board</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Room</th>
                  <th className="px-5 py-2.5">Attendant</th>
                  <th className="px-5 py-2.5">Shift</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(dashboard?.assignments || []).length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-xs text-slate-400">No assignments for selected date</td></tr>
                ) : (
                  dashboard?.assignments?.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-800">{a.room_number || a.room_id}</td>
                      <td className="px-5 py-3 text-slate-600">{a.assigned_name || 'Unassigned'}</td>
                      <td className="px-5 py-3"><StatusBadge status={a.shift} size="sm" /></td>
                      <td className="px-5 py-3"><StatusBadge status={a.status} size="sm" /></td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1">
                          {ASSIGNMENT_STATUS_OPTIONS.map((s) => (
                            <button
                              key={s}
                              onClick={() => handleUpdateStatus(a.id, s)}
                              className={`px-2 py-1 text-[10px] rounded-md font-medium transition-colors ${a.status === s ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                            >
                              {s.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'assign' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Create Assignment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Room</label>
              <input type="text" value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} placeholder="Room ID" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Attendant</label>
              <input type="text" value={selectedAttendant} onChange={(e) => setSelectedAttendant(e.target.value)} placeholder="User ID" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Date</label>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Shift</label>
              <select value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <button onClick={handleCreateAssignment} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700">
            Create Assignment
          </button>
          {notes && <p className="mt-2 text-xs text-emerald-600">{notes}</p>}
        </section>
      )}
    </div>
  )
}

function InspectionTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [checklistItems, setChecklistItems] = useState([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dash, items] = await Promise.all([
        window.api.housekeepingCommandCenter.getDashboard(selectedDate),
        window.api.housekeepingCommandCenter.getChecklistItems().catch(() => [])
      ])
      setDashboard(dash)
      setChecklistItems(Array.isArray(items) ? items : [])
    } catch (err) {
      setError(err?.message || 'Failed to load inspection data')
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadData() }, [loadData])

  const handleCompleteTurnaround = async (turnaroundId) => {
    try {
      await window.api.housekeepingCommandCenter.completeTurnaround(turnaroundId)
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
          />
          <button onClick={loadData} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <section className="bb-card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
          <CheckCircle size={18} className="text-purple-600" />
          <h2 className="text-sm font-bold text-slate-800">Inspections</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5">Room</th>
                <th className="px-5 py-2.5">Inspector</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Failed Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(dashboard?.inspections || []).length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-xs text-slate-400">No inspections for selected date</td></tr>
              ) : (
                dashboard?.inspections?.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{i.room_number || i.room_id}</td>
                    <td className="px-5 py-3 text-slate-600">{i.inspector_name || 'Unknown'}</td>
                    <td className="px-5 py-3"><StatusBadge status={i.status} size="sm" /></td>
                    <td className="px-5 py-3 text-slate-500">{(i.failed_items || []).join(', ') || 'None'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bb-card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
          <Clock size={18} className="text-slate-600" />
          <h2 className="text-sm font-bold text-slate-800">Turnaround Tracking</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5">Room</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Dirty At</th>
                <th className="px-5 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(dashboard?.turnarounds || []).length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-xs text-slate-400">No turnarounds for selected date</td></tr>
              ) : (
                dashboard?.turnarounds?.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{t.room_number || t.room_id}</td>
                    <td className="px-5 py-3"><StatusBadge status={t.status} size="sm" /></td>
                    <td className="px-5 py-3 text-slate-500">{t.dirty_at ? new Date(t.dirty_at).toLocaleTimeString() : '—'}</td>
                    <td className="px-5 py-3">
                      {t.status === 'dirty' && (
                        <button onClick={() => handleCompleteTurnaround(t.id)} className="rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200">
                          Mark Clean
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bb-card p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Inspection Checklist Configuration</h2>
        {checklistItems.length === 0 ? (
          <p className="text-xs text-slate-400">No checklist items configured. Use the RPC or database to add items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Item Name</th>
                  <th className="px-5 py-2.5">Category</th>
                  <th className="px-5 py-2.5">Required</th>
                  <th className="px-5 py-2.5">Sort Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {checklistItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{item.item_name}</td>
                    <td className="px-5 py-3 text-slate-600">{item.category}</td>
                    <td className="px-5 py-3">{item.is_required ? <CheckCircle size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-slate-300" />}</td>
                    <td className="px-5 py-3 text-slate-500">{item.sort_order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function SuppliesTab() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const features = useFeatures()
  const [rooms, setRooms] = useState([])
  const [supplyItems, setSupplyItems] = useState([])
  const [weekAllocations, setWeekAllocations] = useState([])
  const [loading, setLoading] = useState(true)

  const thisMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    d.setDate(d.getDate() + diff)
    return formatLocalDate(d)
  }
  const weekStart = thisMonday()

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const suppliesEnabled = Object.keys(features).length > 0 && features.supplies
      const [roomData, itemData, allocationData] = await Promise.all([
        window.api.rooms.getAll().catch(() => []),
        suppliesEnabled ? window.api.supplies?.getItems?.().catch(() => []) : Promise.resolve([]),
        suppliesEnabled ? window.api.supplies?.getWeekAllocations?.(weekStart).catch(() => []) : Promise.resolve([])
      ])
      setRooms(roomData || [])
      setSupplyItems(itemData || [])
      setWeekAllocations(allocationData || [])
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms])
  const itemMap = useMemo(() => Object.fromEntries(supplyItems.map((i) => [i.id, i])), [supplyItems])

  const supplySummary = useMemo(() => {
    const roomTotals = {}
    const itemTotals = {}
    let totalCost = 0
    let totalUnits = 0

    for (const row of weekAllocations) {
      const room = roomMap[row.room_id]
      const item = itemMap[row.supply_item_id]
      const cost = Number(row.total_cost || 0)
      const units = Number(row.units_used || 0)
      totalCost += cost
      totalUnits += units

      if (!roomTotals[row.room_id]) {
        roomTotals[row.room_id] = { room_id: row.room_id, room_number: room?.room_number || '—', room_type: room?.room_type || '', total_cost: 0, total_units: 0, item_count: 0 }
      }
      roomTotals[row.room_id].total_cost += cost
      roomTotals[row.room_id].total_units += units
      roomTotals[row.room_id].item_count += 1

      if (!itemTotals[row.supply_item_id]) {
        itemTotals[row.supply_item_id] = { supply_item_id: row.supply_item_id, name: item?.name || 'Unknown', unit: item?.unit || '', total_cost: 0, total_units: 0, room_count: 0 }
      }
      itemTotals[row.supply_item_id].total_cost += cost
      itemTotals[row.supply_item_id].total_units += units
      itemTotals[row.supply_item_id].room_count += 1
    }

    return {
      totalCost,
      totalUnits,
      roomsTracked: Object.values(roomTotals).length,
      topRooms: Object.values(roomTotals).sort((a, b) => b.total_cost - a.total_cost).slice(0, 5),
      topItems: Object.values(itemTotals).sort((a, b) => b.total_cost - a.total_cost).slice(0, 5)
    }
  }, [weekAllocations, roomMap, itemMap])

  if (!(Object.keys(features).length > 0 && features.supplies)) {
    return (
      <div className="bb-empty-state min-h-[220px]">
        <Package2 size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-base font-semibold text-slate-800">Room Supplies not enabled</p>
        <p className="text-sm text-slate-500">Enable the Room Supplies add-on to track housekeeping consumables.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bb-empty-state min-h-[220px]">
        <p className="text-sm font-medium text-slate-500">Loading supply data…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Weekly housekeeping report based on room-supply capture for the week starting {weekStart}.</p>
        <button onClick={() => navigate('/supplies')} className="btn-secondary text-xs">
          <BarChart3 size={14} /> Detailed Report
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bb-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Units Used</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{Math.round(supplySummary.totalUnits || 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Consumables recorded across all captured rooms this week.</p>
        </div>
        <div className="bb-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Supply Cost</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{currency} {Number(supplySummary.totalCost || 0).toFixed(2)}</p>
          <p className="mt-1 text-xs text-slate-500">Total cost of consumables this week.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="bb-card p-5">
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

        <div className="bb-card p-5">
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
    </div>
  )
}
