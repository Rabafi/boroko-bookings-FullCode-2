import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ShowerHead, Sparkles } from 'lucide-react'

const HOUSEKEEPING_STATES = [
  { key: 'dirty', label: 'Dirty', icon: ShowerHead, tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'in_progress', label: 'In Progress', icon: Clock, tone: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'clean', label: 'Clean', icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'inspected', label: 'Inspected', icon: Sparkles, tone: 'bg-purple-100 text-purple-700 border-purple-200' }
]

function statusLabel(value) {
  return HOUSEKEEPING_STATES.find((entry) => entry.key === value)?.label || 'Clean'
}

export default function AdvancedHousekeeping() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState([])
  const [arrivals, setArrivals] = useState([])
  const [departures, setDepartures] = useState([])
  const [savingRoomId, setSavingRoomId] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    setError('')
    setWarnings([])
    try {
      const warn = []
      const settle = async (label, promise) => {
        try {
          return await promise
        } catch (e) {
          warn.push(`${label}: ${e?.message || 'failed'}`)
          return null
        }
      }
      if (!window.api?.rooms?.getAll) throw new Error('Rooms API is not available')
      const [roomRows, arrivalRows, departureRows] = await Promise.all([
        settle('Rooms', window.api.rooms.getAll()),
        settle('Arrivals', window.api?.hotel?.getArrivals?.()),
        settle('Departures', window.api?.hotel?.getDepartures?.())
      ])
      if (roomRows == null) {
        setError(warn.join(' · ') || 'Could not load advanced housekeeping board.')
        setRooms([])
        setArrivals([])
        setDepartures([])
        return
      }
      setRooms(Array.isArray(roomRows) ? roomRows : [])
      setArrivals(Array.isArray(arrivalRows) ? arrivalRows : [])
      setDepartures(Array.isArray(departureRows) ? departureRows : [])
      if (warn.length) setWarnings(warn)
    } catch (err) {
      setError(err?.message || 'Could not load advanced housekeeping board.')
      setRooms([])
      setArrivals([])
      setDepartures([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const arrivalRoomIds = useMemo(() => new Set(arrivals.map((booking) => String(booking.room_id))), [arrivals])
  const departureRoomIds = useMemo(() => new Set(departures.map((booking) => String(booking.room_id))), [departures])

  const filteredRooms = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rooms
      .filter((room) => {
        if (!needle) return true
        return [
          room.room_number,
          room.room_type,
          room.housekeeping_status,
          room.housekeeping_notes
        ].some((value) => String(value || '').toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        const aDeparture = departureRoomIds.has(String(a.id)) ? 0 : 1
        const bDeparture = departureRoomIds.has(String(b.id)) ? 0 : 1
        if (aDeparture !== bDeparture) return aDeparture - bDeparture
        const aArrival = arrivalRoomIds.has(String(a.id)) ? 0 : 1
        const bArrival = arrivalRoomIds.has(String(b.id)) ? 0 : 1
        if (aArrival !== bArrival) return aArrival - bArrival
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
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="bb-section-kicker">HOTEL OPERATIONS</p>
            <h1 className="bb-page-header-title">Advanced Housekeeping</h1>
            <p className="bb-page-header-subtitle">
              Supervisor-ready room turnaround, arrival priority, and readiness tracking.
            </p>
          </div>
          <button type="button" onClick={loadData} className="btn-secondary w-fit">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} className="mr-2 inline" />
          {error}
        </div>
      )}
      {warnings.length > 0 && !error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Partial load: {warnings.join(' · ')}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
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
                    <button
                      type="button"
                      onClick={() => navigate(`/maintenance?room_id=${encodeURIComponent(room.id)}`)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Maintenance
                    </button>
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
