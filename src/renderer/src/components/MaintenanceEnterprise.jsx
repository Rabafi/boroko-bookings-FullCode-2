import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle, Wrench } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'

export default function MaintenanceEnterprise() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [preventiveSchedules, setPreventiveSchedules] = useState([])
  const [duePreventive, setDuePreventive] = useState([])
  const [activeTab, setActiveTab] = useState('dashboard')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [downtimeHistory, setDowntimeHistory] = useState([])
  const [scheduleForm, setScheduleForm] = useState({ title: '', description: '', frequency_days: 30, frequency_type: 'days', next_due_date: new Date().toISOString().slice(0, 10) })

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
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
      if (!window.api?.maintenanceEnterprise?.getMaintenanceDashboard) {
        throw new Error('Maintenance enterprise API is not available')
      }
      const [dash, schedules, due] = await Promise.all([
        settle('Dashboard', window.api.maintenanceEnterprise.getMaintenanceDashboard()),
        settle('Schedules', window.api.maintenanceEnterprise.getAllPreventiveSchedules()),
        settle('Due preventive', window.api.maintenanceEnterprise.getDuePreventive(new Date().toISOString().slice(0, 10)))
      ])
      if (dash == null && schedules == null && due == null) {
        setError(warn.join(' · ') || 'Failed to load maintenance data')
        setDashboard(null)
        setPreventiveSchedules([])
        setDuePreventive([])
        return
      }
      setDashboard(dash)
      setPreventiveSchedules(Array.isArray(schedules) ? schedules : [])
      setDuePreventive(Array.isArray(due) ? due : [])
      if (warn.length) setError(`Partial load: ${warn.join(' · ')}`)
    } catch (err) {
      setError(err?.message || 'Failed to load maintenance data')
      setDashboard(null)
      setPreventiveSchedules([])
      setDuePreventive([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const dashboardCards = useMemo(() => {
    if (!dashboard) return []
    return [
      { label: 'Open Tickets', value: dashboard.open_tickets || 0, color: 'text-red-600' },
      { label: 'Out of Order', value: dashboard.rooms_out_of_order || 0, color: 'text-amber-600' },
      { label: 'Out of Service', value: dashboard.rooms_out_of_service || 0, color: 'text-orange-600' },
      { label: 'Due Preventive', value: dashboard.due_preventive || 0, color: 'text-blue-600' },
      { label: 'Avg Repair (days)', value: dashboard.avg_repair_days || 0, color: 'text-slate-600' }
    ]
  }, [dashboard])

  const handleCreateSchedule = async () => {
    try {
      await window.api.maintenanceEnterprise.createPreventiveSchedule(scheduleForm)
      setScheduleForm({ title: '', description: '', frequency_days: 30, frequency_type: 'days', next_due_date: new Date().toISOString().slice(0, 10) })
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleCompletePreventive = async (id) => {
    try {
      await window.api.maintenanceEnterprise.completePreventive(id, null, null)
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleSetOutOfOrder = async () => {
    if (!selectedRoomId || !reason) return
    try {
      await window.api.maintenanceEnterprise.setRoomOutOfOrder(selectedRoomId, startDate, reason, endDate, null)
      setReason('')
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleSetOutOfService = async () => {
    if (!selectedRoomId || !reason) return
    try {
      await window.api.maintenanceEnterprise.setRoomOutOfService(selectedRoomId, startDate, reason, endDate, null)
      setReason('')
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleReturnToService = async (downtimeId) => {
    try {
      await window.api.maintenanceEnterprise.returnRoomToService(downtimeId)
      await loadData()
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleLoadDowntimeHistory = async () => {
    if (!selectedRoomId) return
    try {
      const history = await window.api.maintenanceEnterprise.getRoomDowntimeHistory(selectedRoomId)
      setDowntimeHistory(Array.isArray(history) ? history : [])
    } catch (err) {
      setError(err?.message)
    }
  }

  if (loading && !dashboard) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">MAINTENANCE</p>
          <h1 className="bb-page-header-title">Maintenance Enterprise</h1>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="bb-section-kicker">MAINTENANCE</p>
            <h1 className="bb-page-header-title">Maintenance Enterprise</h1>
          </div>
          <button onClick={loadData} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bb-card p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-xs text-red-600 font-medium">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-slate-500 mt-1 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {[['dashboard', 'Dashboard'], ['schedules', 'Preventive Schedules'], ['ooo', 'OOO / OOS'], ['downtime', 'Downtime History']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {dashboardCards.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-5">
          {dashboardCards.map((card) => (
            <div key={card.label} className="bb-card p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="bb-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <Wrench size={18} className="text-blue-600" />
              <h2 className="text-sm font-bold text-slate-800">Due Preventive Maintenance</h2>
            </div>
            {duePreventive.length === 0 ? (
              <div className="px-5 py-8 text-center"><p className="text-xs text-slate-400">No preventive maintenance due</p></div>
            ) : (
              <div className="divide-y divide-slate-50">
                {duePreventive.slice(0, 10).map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                      <p className="text-xs text-slate-500">Due: {item.next_due_date} · {item.room_number || 'No room'}</p>
                    </div>
                    <button onClick={() => handleCompletePreventive(item.id)} className="rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200">
                      Complete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="bb-card p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-3">Room OOO / OOS Quick Action</h2>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Room ID</label>
                <input type="text" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} placeholder="Room UUID" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Reason</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Plumbing issue" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSetOutOfOrder} className="flex-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700">Set Out of Order</button>
                <button onClick={handleSetOutOfService} className="flex-1 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700">Set Out of Service</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'schedules' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="bb-card p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4">Create Preventive Schedule</h2>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Title</label>
                <input type="text" value={scheduleForm.title} onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })} placeholder="e.g. HVAC Filter Change" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Description</label>
                <textarea value={scheduleForm.description} onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })} placeholder="Description" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Frequency</label>
                  <input type="number" value={scheduleForm.frequency_days} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency_days: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Type</label>
                  <select value={scheduleForm.frequency_type} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency_type: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Next Due Date</label>
                <input type="date" value={scheduleForm.next_due_date} onChange={(e) => setScheduleForm({ ...scheduleForm, next_due_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
              </div>
              <button onClick={handleCreateSchedule} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Create Schedule</button>
            </div>
          </section>
          <section className="bb-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-bold text-slate-800">All Preventive Schedules</h2>
            </div>
            <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
              {preventiveSchedules.length === 0 ? (
                <div className="px-5 py-8 text-center"><p className="text-xs text-slate-400">No schedules created</p></div>
              ) : (
                preventiveSchedules.map((s) => (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                        <p className="text-xs text-slate-500">Due: {s.next_due_date} · Every {s.frequency_days} {s.frequency_type}</p>
                      </div>
                      <button onClick={() => handleCompletePreventive(s.id)} className="rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200">Mark Done</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'ooo' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Room Out of Order / Out of Service Management</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Room ID</label>
              <input type="text" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} placeholder="Room UUID" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Reason</label>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSetOutOfOrder} className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700">Set Out of Order</button>
            <button onClick={handleSetOutOfService} className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700">Set Out of Service</button>
          </div>
        </section>
      )}

      {activeTab === 'downtime' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Room Downtime History</h2>
          <div className="flex gap-3 mb-4">
            <input type="text" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} placeholder="Room UUID" className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            <button onClick={handleLoadDowntimeHistory} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Load History</button>
          </div>
          {downtimeHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-2.5">Start</th>
                    <th className="px-5 py-2.5">End</th>
                    <th className="px-5 py-2.5">Type</th>
                    <th className="px-5 py-2.5">Reason</th>
                    <th className="px-5 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {downtimeHistory.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 text-slate-600">{d.start_date}</td>
                      <td className="px-5 py-3 text-slate-600">{d.end_date || 'Active'}</td>
                      <td className="px-5 py-3"><StatusBadge status={d.downtime_type === 'out_of_order' ? 'OOO' : 'OOS'} size="sm" /></td>
                      <td className="px-5 py-3 text-slate-500">{d.reason}</td>
                      <td className="px-5 py-3">
                        {!d.end_date && (
                          <button onClick={() => handleReturnToService(d.id)} className="rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200">
                            Return to Service
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Enter a room ID and click Load History</p>
          )}
        </section>
      )}
    </div>
  )
}
