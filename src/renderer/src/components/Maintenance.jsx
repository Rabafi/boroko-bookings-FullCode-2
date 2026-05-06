import { useEffect, useState } from 'react'
import { Plus, CheckCircle, Wrench, AlertTriangle } from 'lucide-react'
import { Modal } from './shared/Modal'
import { localToday } from '../utils/localDate'

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
    const [t, r] = await Promise.all([
      window.api.maintenance.getAll().catch(() => []),
      window.api.rooms.getAll().catch(() => [])
    ])
    setTickets(t || [])
    setRooms(r || [])
    setLoading(false)
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
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Property Care</p>
          <h1 className="bb-page-header-title mt-2">Maintenance</h1>
          <p className="bb-page-header-subtitle">
            {openCount} open ticket{openCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* Status filter tabs */}
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

      {/* Ticket Grid */}
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
                  🛏️ Room {ticket.room_number || ticket.room_id}
                </span>
                <span>📅 {ticket.reported_date}</span>
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

      {/* Create Modal */}
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

      {/* Edit/Update Status Modal */}
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
    </div>
  )
}
