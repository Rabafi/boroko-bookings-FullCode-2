import { useState, useEffect } from 'react'
import { Presentation, Plus, Pencil, Trash2, X, Users, Clock, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { PAYMENT_METHOD_PLAIN_OPTIONS } from '../constants/paymentMethods'
import { useSettings } from '../app-context'

const SETUP_TYPES = ['Theatre', 'Boardroom', 'Classroom', 'U-Shape', 'Banquet', 'Cocktail']
const PAYMENT_STATUSES = ['pending', 'deposit_paid', 'paid', 'cancelled']
const PAYMENT_METHODS = PAYMENT_METHOD_PLAIN_OPTIONS

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  deposit_paid: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800'
}
const STATUS_LABELS = {
  pending: 'Pending',
  deposit_paid: 'Deposit Paid',
  paid: 'Paid',
  cancelled: 'Cancelled'
}

const empty = () => ({
  booking_date: new Date().toISOString().split('T')[0],
  start_time: '08:00',
  end_time: '17:00',
  client_name: '',
  company: '',
  attendees: '',
  setup_type: 'Theatre',
  room_name: 'Conference Room',
  includes_catering: false,
  catering_notes: '',
  total_amount: '',
  deposit_paid: '',
  payment_status: 'pending',
  payment_method: '',
  notes: ''
})

function duration(start, end) {
  if (!start || !end) return ''
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

export default function Conference() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [filterDate, setFilterDate] = useState('')
  const [deleting, setDeleting] = useState(null)

  const load = async () => {
    setLoading(true)
    const start = filterDate || undefined
    const end = filterDate || undefined
    const data = await window.api.conference.getAll(start, end).catch(() => [])
    setBookings(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [filterDate])

  const set = (f, v) => setForm((prev) => ({ ...prev, [f]: v }))

  const openCreate = () => {
    setEditing(null)
    setForm(empty())
    setError('')
    setShowForm(true)
  }

  const openEdit = (b) => {
    setEditing(b)
    setForm({
      booking_date: b.booking_date,
      start_time: b.start_time,
      end_time: b.end_time,
      client_name: b.client_name,
      company: b.company || '',
      attendees: String(b.attendees || ''),
      setup_type: b.setup_type || 'Theatre',
      room_name: b.room_name || 'Conference Room',
      includes_catering: b.includes_catering || false,
      catering_notes: b.catering_notes || '',
      total_amount: String(b.total_amount || ''),
      deposit_paid: String(b.deposit_paid || ''),
      payment_status: b.payment_status || 'pending',
      payment_method: b.payment_method || '',
      notes: b.notes || ''
    })
    setError('')
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.client_name.trim()) { setError('Client name is required'); return }
    if (!form.booking_date) { setError('Date is required'); return }
    if (!form.start_time || !form.end_time) { setError('Start and end time are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        attendees: Number(form.attendees) || 0,
        total_amount: parseFloat(form.total_amount) || 0,
        deposit_paid: parseFloat(form.deposit_paid) || 0
      }
      if (editing) {
        await window.api.conference.update(editing.id, payload)
      } else {
        await window.api.conference.create(payload)
      }
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message || 'Failed to save booking')
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this conference booking?')) return
    setDeleting(id)
    await window.api.conference.delete(id).catch(() => {})
    setDeleting(null)
    load()
  }

  const grouped = bookings.reduce((acc, b) => {
    const d = b.booking_date
    if (!acc[d]) acc[d] = []
    acc[d].push(b)
    return acc
  }, {})

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Presentation size={26} className="text-green-700" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conference Bookings</h1>
            <p className="text-sm text-gray-500">Manage conference room reservations</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          <Plus size={16} /> New Booking
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-5">
        <Calendar size={16} className="text-gray-400" />
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {filterDate && (
          <button onClick={() => setFilterDate('')} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Clear filter
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <Presentation size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No conference bookings found</p>
          <button onClick={openCreate} className="mt-3 text-green-700 text-sm font-medium hover:underline">
            Create your first booking
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => (
            <div key={date} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-700">
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                  })}
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {grouped[date].map((b) => (
                  <div key={b.id}>
                    <div className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{b.client_name}</p>
                          {b.company && <span className="text-xs text-gray-500">· {b.company}</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.payment_status]}`}>
                            {STATUS_LABELS[b.payment_status]}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {b.start_time} – {b.end_time}
                            {duration(b.start_time, b.end_time) && (
                              <span className="text-gray-400">({duration(b.start_time, b.end_time)})</span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users size={12} /> {b.attendees || 0} pax
                          </span>
                          <span>{b.setup_type}</span>
                          {b.room_name && b.room_name !== 'Conference Room' && <span>· {b.room_name}</span>}
                          {b.includes_catering && <span className="text-green-600 font-medium">+ Catering</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-gray-900 text-sm">{currency}{(b.total_amount || 0).toFixed(2)}</p>
                        {b.deposit_paid > 0 && (
                          <p className="text-xs text-gray-400">Deposit: {currency}{b.deposit_paid.toFixed(2)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                        >
                          {expandedId === b.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                        <button onClick={() => openEdit(b)} className="p-1.5 text-gray-400 hover:text-green-700 rounded">
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(b.id)}
                          disabled={deleting === b.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {expandedId === b.id && (
                      <div className="px-4 pb-3 bg-gray-50 text-xs text-gray-600 space-y-1 border-t border-gray-100 pt-2">
                        {b.payment_method && <p>Payment Method: <span className="font-medium">{b.payment_method}</span></p>}
                        {b.catering_notes && <p>Catering Notes: <span className="font-medium">{b.catering_notes}</span></p>}
                        {b.notes && <p>Notes: <span className="font-medium">{b.notes}</span></p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Edit Conference Booking' : 'New Conference Booking'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client / Group Name *</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="e.g. ABC Company"
                    value={form.client_name}
                    onChange={(e) => set('client_name', e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company / Organisation</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Optional"
                    value={form.company}
                    onChange={(e) => set('company', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.booking_date}
                    onChange={(e) => set('booking_date', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.start_time}
                    onChange={(e) => set('start_time', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={form.end_time}
                    onChange={(e) => set('end_time', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">No. of Attendees</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0"
                    value={form.attendees}
                    onChange={(e) => set('attendees', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Setup Type</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={form.setup_type}
                    onChange={(e) => set('setup_type', e.target.value)}
                  >
                    {SETUP_TYPES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Room / Venue Name</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Conference Room"
                    value={form.room_name}
                    onChange={(e) => set('room_name', e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="catering"
                  checked={form.includes_catering}
                  onChange={(e) => set('includes_catering', e.target.checked)}
                  className="w-4 h-4 text-green-600 rounded"
                />
                <label htmlFor="catering" className="text-sm font-medium text-gray-700">Includes Catering</label>
              </div>

              {form.includes_catering && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catering Notes</label>
                  <textarea
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    placeholder="e.g. Tea breaks, lunch buffet, dietary requirements..."
                    value={form.catering_notes}
                    onChange={(e) => set('catering_notes', e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.00"
                    value={form.total_amount}
                    onChange={(e) => set('total_amount', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Paid ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="0.00"
                    value={form.deposit_paid}
                    onChange={(e) => set('deposit_paid', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={form.payment_status}
                    onChange={(e) => set('payment_status', e.target.value)}
                  >
                    {PAYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                    value={form.payment_method}
                    onChange={(e) => set('payment_method', e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  placeholder="Any additional notes..."
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : editing ? 'Update Booking' : 'Create Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
