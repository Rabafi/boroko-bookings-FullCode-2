import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, CheckCircle, Wrench, AlertTriangle, RefreshCw } from 'lucide-react'
import { Modal } from './shared/Modal'
import { StatusBadge } from './shared/StatusBadge'
import { localToday } from '../utils/localDate'
import { useFeatures } from '../app-context'

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const STATUSES = ['open', 'in_progress', 'resolved']

const priorityColor = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700'
}

const statusColor = {
  open: 'bg-red-50 text-red-600',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved: 'bg-green-50 text-green-700'
}

const today = () => localToday()

export default function Maintenance() {
  const features = useFeatures()
  const isEnterprise = features?.maintenance_enterprise === true
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState('tickets')

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam) setActiveTab(tabParam)
  }, [searchParams])

  const TABS = [
    ['tickets', 'Tickets'],
    ...(isEnterprise ? [
      ['preventive', 'Preventive'],
      ['ooo', 'Out of Order'],
      ['downtime', 'Downtime'],
      ['costs', 'Costs']
    ] : [])
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Property Care</p>
          <h1 className="bb-page-header-title mt-2">Maintenance</h1>
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

      {activeTab === 'tickets' && <TicketsTab />}
      {activeTab === 'preventive' && isEnterprise && <PreventiveTab />}
      {activeTab === 'ooo' && isEnterprise && <OooTab />}
      {activeTab === 'downtime' && isEnterprise && <DowntimeTab />}
      {activeTab === 'costs' && isEnterprise && <CostsTab />}
    </div>
  )
}

function TicketsTab() {
  const [tickets, setTickets] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [resolving, setResolving] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  const [form, setForm] = useState({
    room_id: '',
    title: '',
    description: '',
    priority: 'medium',
    reported_date: today(),
    labour_cost: '',
    parts_cost: '',
    total_cost: '',
    vendor_name: '',
    cost_notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [t, r] = await Promise.all([
        window.api.maintenance.getAll(),
        window.api.rooms.getAll()
      ])
      setTickets(t || [])
      setRooms(r || [])
    } catch (err) {
      setLoadError(err?.message || 'Maintenance records could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setForm({
      room_id: rooms[0]?.id || '',
      title: '',
      description: '',
      priority: 'medium',
      reported_date: today(),
      labour_cost: '',
      parts_cost: '',
      total_cost: '',
      vendor_name: '',
      cost_notes: ''
    })
    setFormOpen(true)
  }

  const openEdit = (ticket) => {
    setEditing(ticket)
    setEditOpen(true)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await window.api.maintenance.create({ ...form, room_id: form.room_id || null })
      if (result?.success === false) throw new Error(result.error || 'Failed to create ticket')
      setFormOpen(false)
      loadData()
    } catch (err) {
      setError(err.message || 'Failed to create ticket')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (id, data) => {
    await window.api.maintenance.update(id, data).catch(console.error)
    setEditOpen(false)
    setEditing(null)
    loadData()
  }

  const handleResolve = async (ticket) => {
    if (!confirm(`Mark "${ticket.title || ticket.issue}" as resolved? The room will return to Available.`)) return
    setResolving(ticket.id)
    await window.api.maintenance.resolve(ticket.id, ticket.room_id).catch(console.error)
    setResolving(null)
    loadData()
  }

  const displayed = tickets.filter((t) =>
    statusFilter === 'all' ? true : t.status === statusFilter
  )

  const openCount = tickets.filter((t) => t.status !== 'resolved').length

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="bb-page-header-subtitle">
          {openCount} open ticket{openCount !== 1 ? 's' : ''}
        </p>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Ticket
        </button>
      </div>

      <div className="bb-filter-bar w-fit">
        {[['all', 'All'], ['open', 'Open'], ['in_progress', 'In Progress'], ['resolved', 'Resolved']].map(
          ([v, l]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-4 py-2 transition-colors ${
                statusFilter === v ? 'rounded-xl bg-green-600 text-white' : 'rounded-xl text-slate-600 hover:bg-slate-50'
              }`}
            >
              {l}
            </button>
          )
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="bb-empty-state min-h-[220px]">
          <p className="text-sm font-medium text-slate-500">Loading maintenance tickets…</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="bb-empty-state min-h-[220px]">
          <Wrench size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-semibold text-slate-800">No maintenance tickets found</p>
          <p className="text-sm text-slate-500">New tickets will appear here as issues are reported.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displayed.map((ticket) => (
            <div
              key={ticket.id}
              className={`bb-card border-l-4 p-5 ${
                ticket.priority === 'urgent'
                  ? 'border-red-500'
                  : ticket.priority === 'high'
                  ? 'border-orange-400'
                  : ticket.priority === 'medium'
                  ? 'border-yellow-400'
                  : 'border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold leading-snug text-slate-800">{ticket.title || ticket.issue}</h3>
                <span
                  className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${priorityColor[ticket.priority]}`}
                >
                  {ticket.priority}
                </span>
              </div>

              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                {ticket.description || ticket.notes || <span className="italic">No description</span>}
              </p>

              <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
                <span>
                  Room {ticket.room_number || ticket.room_id}
                </span>
                <span>{ticket.reported_date}</span>
              </div>
              {Number(ticket.total_cost || 0) > 0 && (
                <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  Repair cost: P {Number(ticket.total_cost || 0).toFixed(2)}
                </div>
              )}

              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${statusColor[ticket.status]}`}
                >
                  {ticket.status?.replace('_', ' ')}
                </span>
                <div className="flex gap-2">
                  {ticket.status !== 'resolved' && (
                    <>
                      <button
                        onClick={() => openEdit(ticket)}
                        className="rounded-lg px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
                      >
                        Update
                      </button>
                      <button
                        onClick={() => handleResolve(ticket)}
                        disabled={resolving === ticket.id}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50"
                      >
                        <CheckCircle size={12} />
                        {resolving === ticket.id ? 'Resolving...' : 'Resolve'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <Modal title="New Maintenance Ticket" onClose={() => setFormOpen(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>The selected room will be set to <strong>Maintenance</strong> status, blocking new bookings.</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Room *</label>
              <select
                className="input"
                value={form.room_id}
                onChange={(e) => setForm({ ...form, room_id: e.target.value })}
                required
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} — {r.room_type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issue Title *</label>
              <input
                type="text"
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="e.g. Broken AC unit"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                className="input resize-none"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Details about the issue..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority *</label>
                <select
                  className="input capitalize"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p} className="capitalize">{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Reported *</label>
                <input
                  type="date"
                  className="input"
                  value={form.reported_date}
                  onChange={(e) => setForm({ ...form, reported_date: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Labour Cost</label>
                <input type="number" min="0" step="0.01" className="input" value={form.labour_cost} onChange={(e) => setForm({ ...form, labour_cost: e.target.value })} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parts Cost</label>
                <input type="number" min="0" step="0.01" className="input" value={form.parts_cost} onChange={(e) => setForm({ ...form, parts_cost: e.target.value })} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Cost</label>
                <input type="number" min="0" step="0.01" className="input" value={form.total_cost} onChange={(e) => setForm({ ...form, total_cost: e.target.value })} placeholder="Auto from labour + parts" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <input type="text" className="input" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} placeholder="Optional supplier / technician" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Notes</label>
              <textarea className="input resize-none" rows={2} value={form.cost_notes} onChange={(e) => setForm({ ...form, cost_notes: e.target.value })} placeholder="Optional note about the repair spend..." />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setFormOpen(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editOpen && editing && (
        <Modal
          title="Update Ticket"
          onClose={() => { setEditOpen(false); setEditing(null) }}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <strong>{editing.title || editing.issue}</strong> — Room {editing.room_number || editing.room_id}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                className="input capitalize"
                defaultValue={editing.status}
                id="status-select"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                className="input capitalize"
                defaultValue={editing.priority}
                id="priority-select"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p} className="capitalize">{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                className="input resize-none"
                rows={2}
                defaultValue={editing.notes || ''}
                id="notes-input"
                placeholder="Update notes..."
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Labour Cost</label>
                <input type="number" min="0" step="0.01" className="input" defaultValue={editing.labour_cost || ''} id="labour-cost-input" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parts Cost</label>
                <input type="number" min="0" step="0.01" className="input" defaultValue={editing.parts_cost || ''} id="parts-cost-input" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Cost</label>
                <input type="number" min="0" step="0.01" className="input" defaultValue={editing.total_cost || ''} id="total-cost-input" placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <input type="text" className="input" defaultValue={editing.vendor_name || ''} id="vendor-name-input" placeholder="Optional supplier / technician" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Notes</label>
              <textarea className="input resize-none" rows={2} defaultValue={editing.cost_notes || ''} id="cost-notes-input" placeholder="Optional note about the repair spend..." />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setEditOpen(false); setEditing(null) }}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const status = document.getElementById('status-select').value
                  const priority = document.getElementById('priority-select').value
                  const notes = document.getElementById('notes-input').value
                  const labour_cost = document.getElementById('labour-cost-input').value
                  const parts_cost = document.getElementById('parts-cost-input').value
                  const total_cost = document.getElementById('total-cost-input').value
                  const vendor_name = document.getElementById('vendor-name-input').value
                  const cost_notes = document.getElementById('cost-notes-input').value
                  handleUpdate(editing.id, { status, priority, notes, labour_cost, parts_cost, total_cost, vendor_name, cost_notes })
                }}
                className="btn-primary flex-1"
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function PreventiveTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [duePreventive, setDuePreventive] = useState([])
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    description: '',
    frequency_days: 30,
    frequency_type: 'days',
    next_due_date: new Date().toISOString().slice(0, 10)
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [schedulesData, due] = await Promise.all([
        window.api.maintenanceEnterprise.getAllPreventiveSchedules().catch(() => []),
        window.api.maintenanceEnterprise.getDuePreventive(new Date().toISOString().slice(0, 10)).catch(() => [])
      ])
      setSchedules(Array.isArray(schedulesData) ? schedulesData : [])
      setDuePreventive(Array.isArray(due) ? due : [])
    } catch (err) {
      setError(err?.message || 'Failed to load preventive maintenance data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

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

  if (loading && schedules.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {error && (
        <div className="lg:col-span-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

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
          <Wrench size={18} className="text-blue-600" />
          <h2 className="text-sm font-bold text-slate-800">All Preventive Schedules</h2>
        </div>
        <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
          {schedules.length === 0 ? (
            <div className="px-5 py-8 text-center"><p className="text-xs text-slate-400">No schedules created</p></div>
          ) : (
            schedules.map((s) => (
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

      {duePreventive.length > 0 && (
        <section className="lg:col-span-2 bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <AlertTriangle size={18} className="text-amber-600" />
            <h2 className="text-sm font-bold text-slate-800">Due Preventive Maintenance</h2>
          </div>
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
        </section>
      )}
    </div>
  )
}

function OooTab() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const [reason, setReason] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const dash = await window.api.maintenanceEnterprise.getMaintenanceDashboard().catch(() => null)
      setDashboard(dash)
    } catch (err) {
      setError(err?.message || 'Failed to load OOO data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

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

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {dashboard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bb-card p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Open Tickets</p>
            <p className="text-2xl font-bold text-red-600">{dashboard.open_tickets || 0}</p>
          </div>
          <div className="bb-card p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Out of Order</p>
            <p className="text-2xl font-bold text-amber-600">{dashboard.rooms_out_of_order || 0}</p>
          </div>
          <div className="bb-card p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Out of Service</p>
            <p className="text-2xl font-bold text-orange-600">{dashboard.rooms_out_of_service || 0}</p>
          </div>
          <div className="bb-card p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Avg Repair (days)</p>
            <p className="text-2xl font-bold text-slate-600">{dashboard.avg_repair_days || 0}</p>
          </div>
        </div>
      )}

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
    </div>
  )
}

function DowntimeTab() {
  const [error, setError] = useState(null)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [downtimeHistory, setDowntimeHistory] = useState([])

  const handleLoadDowntimeHistory = async () => {
    if (!selectedRoomId) return
    try {
      const history = await window.api.maintenanceEnterprise.getRoomDowntimeHistory(selectedRoomId)
      setDowntimeHistory(Array.isArray(history) ? history : [])
    } catch (err) {
      setError(err?.message)
    }
  }

  const handleReturnToService = async (downtimeId) => {
    try {
      await window.api.maintenanceEnterprise.returnRoomToService(downtimeId)
      await handleLoadDowntimeHistory()
    } catch (err) {
      setError(err?.message)
    }
  }

  return (
    <section className="bb-card p-5">
      <h2 className="text-sm font-bold text-slate-800 mb-4">Room Downtime History</h2>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
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
  )
}

function CostsTab() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.maintenance.getAll()
      .then((data) => setTickets(Array.isArray(data) ? data : []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false))
  }, [])

  const costTickets = useMemo(() =>
    tickets.filter((t) => Number(t.total_cost || 0) > 0)
      .sort((a, b) => Number(b.total_cost || 0) - Number(a.total_cost || 0)),
    [tickets]
  )

  const totalCost = useMemo(() =>
    costTickets.reduce((sum, t) => sum + Number(t.total_cost || 0), 0),
    [costTickets]
  )

  const totalLabour = useMemo(() =>
    costTickets.reduce((sum, t) => sum + Number(t.labour_cost || 0), 0),
    [costTickets]
  )

  const totalParts = useMemo(() =>
    costTickets.reduce((sum, t) => sum + Number(t.parts_cost || 0), 0),
    [costTickets]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="bb-card p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Repair Cost</p>
          <p className="text-2xl font-bold text-slate-800">P {totalCost.toFixed(2)}</p>
        </div>
        <div className="bb-card p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Labour</p>
          <p className="text-2xl font-bold text-blue-600">P {totalLabour.toFixed(2)}</p>
        </div>
        <div className="bb-card p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Parts</p>
          <p className="text-2xl font-bold text-amber-600">P {totalParts.toFixed(2)}</p>
        </div>
      </div>

      <section className="bb-card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-800">Repair Cost History</h2>
        </div>
        {costTickets.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-slate-400">No maintenance costs recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Ticket</th>
                  <th className="px-5 py-2.5">Room</th>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-5 py-2.5 text-right">Labour</th>
                  <th className="px-5 py-2.5 text-right">Parts</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5">Vendor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {costTickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{ticket.title || ticket.issue}</td>
                    <td className="px-5 py-3 text-slate-600">{ticket.room_number || '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{ticket.reported_date}</td>
                    <td className="px-5 py-3 text-right text-slate-600">P {Number(ticket.labour_cost || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">P {Number(ticket.parts_cost || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">P {Number(ticket.total_cost || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-slate-500">{ticket.vendor_name || '—'}</td>
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
