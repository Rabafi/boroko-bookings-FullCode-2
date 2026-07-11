import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'

const SHIFT_OPTIONS = ['morning', 'evening', 'night']
const STATUS_OPTIONS = ['pending', 'in_progress', 'completed', 'skipped']
const INSPECTION_STATUS_OPTIONS = ['passed', 'failed', 'pending']
const TURNAROUND_STATUS_OPTIONS = ['dirty', 'in_progress', 'clean', 'inspected']

export default function HousekeepingCommandCenter() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [checklistItems, setChecklistItems] = useState([])
  const [activeTab, setActiveTab] = useState('board')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [selectedRoom, setSelectedRoom] = useState('')
  const [selectedAttendant, setSelectedAttendant] = useState('')
  const [selectedShift, setSelectedShift] = useState('morning')
  const [statusUpdate, setStatusUpdate] = useState('pending')
  const [notes, setNotes] = useState('')

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
      setError(err?.message || 'Failed to load housekeeping data')
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

  const handleStartTurnaround = async (bookingId) => {
    try {
      await window.api.housekeepingCommandCenter.startTurnaround(bookingId)
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

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
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">HOUSEKEEPING</p>
          <h1 className="bb-page-header-title">Housekeeping Command Center</h1>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  if (error && !dashboard) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">HOUSEKEEPING</p>
          <h1 className="bb-page-header-title">Housekeeping Command Center</h1>
        </div>
        <div className="bb-card p-6 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-red-600 font-medium">{error}</p>
          <button onClick={loadData} className="mt-3 text-sm text-emerald-700 font-semibold hover:underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="bb-section-kicker">HOUSEKEEPING</p>
            <h1 className="bb-page-header-title">Housekeeping Command Center</h1>
          </div>
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
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {[['board', 'Board'], ['assign', 'Assignments'], ['inspect', 'Inspections'], ['turnaround', 'Turnaround Time'], ['checklist', 'Checklist Config']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {summaryCards && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-5">
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
                          {STATUS_OPTIONS.map((s) => (
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

      {activeTab === 'inspect' && (
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
      )}

      {activeTab === 'turnaround' && (
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
      )}

      {activeTab === 'checklist' && (
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
      )}
    </div>
  )
}
