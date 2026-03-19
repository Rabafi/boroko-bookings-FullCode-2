import { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react'

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
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(null) // room id being saved
  const [noteEdits, setNoteEdits] = useState({}) // { [roomId]: string }
  const [error, setError] = useState('')

  useEffect(() => { loadRooms() }, [])

  const loadRooms = async () => {
    const data = await window.api.rooms.getAll()
    setRooms(data || [])
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Housekeeping</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {counts.clean} clean · {counts.in_progress} in progress · {counts.dirty} dirty
          </p>
        </div>
        <button
          onClick={loadRooms}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <div key={key} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cfg.badge}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-800">{counts[key]}</p>
                <p className="text-xs text-gray-500">{cfg.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 font-bold flex-shrink-0">✕</button>
        </div>
      )}

      {/* Room cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
              className={`bg-white rounded-xl shadow-sm overflow-hidden border-l-4 ${
                status === 'clean' ? 'border-green-400' :
                status === 'dirty' ? 'border-red-400' : 'border-yellow-400'
              }`}
            >
              <div className="px-5 py-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-800">Room {room.room_number}</p>
                    <p className="text-xs text-gray-400">{room.room_type}</p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                    <Icon size={11} />
                    {cfg.label}
                  </span>
                </div>

                {/* Notes */}
                <textarea
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 mb-3"
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
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                    className="mt-2 w-full text-xs py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
                  >
                    {isSaving ? 'Saving...' : 'Save Notes'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {rooms.length === 0 && (
          <div className="col-span-3 py-16 text-center text-gray-400">
            No rooms found. Add rooms first.
          </div>
        )}
      </div>
    </div>
  )
}
