import { useState, useEffect } from 'react'
import { Waves, Plus, Trash2, X, Users, TrendingUp } from 'lucide-react'
import { PAYMENT_METHOD_PLAIN_OPTIONS } from '../constants/paymentMethods'
import { useSettings } from '../app-context'
import { localToday } from '../utils/localDate'

const PAYMENT_METHODS = PAYMENT_METHOD_PLAIN_OPTIONS

const today = () => localToday()

const emptyForm = (settings) => ({
  date: today(),
  guest_name: '',
  phone: '',
  adults: '1',
  children: '0',
  fee_per_adult: settings?.pool_fee_adult || '',
  fee_per_child: settings?.pool_fee_child || '0',
  payment_method: 'Cash',
  notes: ''
})

export default function DayUse() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(today())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm(settings))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await window.api.dayuse.getAll(selectedDate, selectedDate).catch(() => [])
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [selectedDate])
  
  // Refresh on sync events
  useEffect(() => {
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      load(true)
    })
    return () => unsubscribe?.()
  }, [selectedDate])

  const set = (f, v) => setForm((prev) => ({ ...prev, [f]: v }))

  const adults = Number(form.adults) || 0
  const children = Number(form.children) || 0
  const feeAdult = parseFloat(form.fee_per_adult) || 0
  const feeChild = parseFloat(form.fee_per_child) || 0
  const previewTotal = adults * feeAdult + children * feeChild

  const totalAdults = entries.reduce((s, e) => s + (e.adults || 0), 0)
  const totalChildren = entries.reduce((s, e) => s + (e.children || 0), 0)
  const totalRevenue = entries.reduce((s, e) => s + (e.total || 0), 0)

  const openCreate = () => {
    setForm(emptyForm(settings))
    setError('')
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.guest_name.trim()) { setError('Guest name is required'); return }
    if (!form.date) { setError('Date is required'); return }
    if (adults < 1) { setError('At least 1 adult is required'); return }
    setSaving(true)
    setError('')
    try {
      await window.api.dayuse.add({
        ...form,
        adults,
        children,
        fee_per_adult: feeAdult,
        fee_per_child: feeChild
      })
      setShowForm(false)
      if (form.date === selectedDate) load()
    } catch (err) {
      setError(err.message || 'Failed to save entry')
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this day use entry?')) return
    setDeleting(id)
    await window.api.dayuse.delete(id).catch(() => {})
    setDeleting(null)
    load()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">

{/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Waves size={26} className="text-cyan-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pool / Day Use</h1>
            <p className="text-sm text-gray-500">Walk-in guests using pool facilities</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors"
        >
          <Plus size={16} /> Add Entry
        </button>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-medium text-gray-600">View date:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <button
          onClick={() => setSelectedDate(today())}
          className="text-xs text-cyan-600 hover:text-cyan-800 font-medium underline"
        >
          Today
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
          <p className="text-xs text-gray-500 mb-1">Adults</p>
          <p className="text-2xl font-bold text-gray-800">{totalAdults}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
          <p className="text-xs text-gray-500 mb-1">Children</p>
          <p className="text-2xl font-bold text-gray-800">{totalChildren}</p>
        </div>
        <div className="bg-cyan-50 rounded-xl border border-cyan-200 p-4 text-center shadow-sm">
          <p className="text-xs text-cyan-600 mb-1 flex items-center justify-center gap-1">
            <TrendingUp size={11} /> Revenue
          </p>
          <p className="text-2xl font-bold text-cyan-700">{currency}{totalRevenue.toFixed(2)}</p>
        </div>
      </div>

      {/* Entries table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
          <Waves size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No entries for this date</p>
          <button onClick={openCreate} className="mt-3 text-cyan-600 text-sm font-medium hover:underline">
            Add the first entry
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Guest</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Phone</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Adults</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Children</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Payment</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.guest_name}</td>
                  <td className="px-4 py-3 text-gray-500">{e.phone || '—'}</td>
                  <td className="px-4 py-3 text-center text-gray-700">
                    {e.adults}
                    {e.fee_per_adult > 0 && (
                      <span className="text-xs text-gray-400 ml-1">@{currency}{e.fee_per_adult}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">
                    {e.children}
                    {e.children > 0 && e.fee_per_child > 0 && (
                      <span className="text-xs text-gray-400 ml-1">@{currency}{e.fee_per_child}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{e.payment_method}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{currency}{(e.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(e.id)}
                      disabled={deleting === e.id}
                      className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-300">
              <tr>
                <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-700">
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-gray-700">{totalAdults}</td>
                <td className="px-4 py-3 text-center font-semibold text-gray-700">{totalChildren}</td>
                <td />
                <td className="px-4 py-3 text-right font-bold text-cyan-700 text-base">
                  {currency}{totalRevenue.toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Pool / Day Use Entry</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name *</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="e.g. John Doe"
                    value={form.guest_name}
                    onChange={(e) => set('guest_name', e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="Optional"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adults *</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    value={form.adults}
                    onChange={(e) => set('adults', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Children</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    value={form.children}
                    onChange={(e) => set('children', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fee per Adult ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="0.00"
                    value={form.fee_per_adult}
                    onChange={(e) => set('fee_per_adult', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fee per Child ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="0.00"
                    value={form.fee_per_child}
                    onChange={(e) => set('fee_per_child', e.target.value)}
                  />
                </div>
              </div>

              {/* Live total preview */}
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-cyan-700 flex items-center gap-2">
                  <Users size={14} />
                  {adults} adult{adults !== 1 ? 's' : ''}{children > 0 ? ` + ${children} child${children !== 1 ? 'ren' : ''}` : ''}
                </span>
                <span className="text-lg font-bold text-cyan-800">{currency}{previewTotal.toFixed(2)}</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white"
                  value={form.payment_method}
                  onChange={(e) => set('payment_method', e.target.value)}
                >
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Optional notes..."
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
                  className="px-5 py-2.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
