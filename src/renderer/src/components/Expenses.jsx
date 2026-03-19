import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../App'

const CATEGORIES = [
  'Food & Beverage',
  'Utilities',
  'Maintenance & Repairs',
  'Cleaning & Supplies',
  'Staff & Labour',
  'Marketing',
  'Transport',
  'Equipment',
  'Other'
]

const today = () => new Date().toISOString().split('T')[0]
const monthStart = () => {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

function fmt(v) {
  return Number(v || 0).toFixed(2)
}

export default function Expenses() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(false)
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(today())
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    date: today(),
    description: '',
    category: CATEGORIES[0],
    amount: '',
    notes: ''
  })

  useEffect(() => {
    load()
  }, [start, end])

  const load = async () => {
    setLoading(true)
    const data = await window.api.expenses.getAll(start, end).catch(() => [])
    setExpenses(data || [])
    setLoading(false)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ date: today(), description: '', category: CATEGORIES[0], amount: '', notes: '' })
    setFormOpen(true)
  }

  const openEdit = (exp) => {
    setEditing(exp)
    setForm({
      date: exp.date,
      description: exp.description,
      category: exp.category || CATEGORIES[0],
      amount: String(exp.amount),
      notes: exp.notes || ''
    })
    setFormOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount) }
    if (editing) {
      await window.api.expenses.update(editing.id, payload).catch(console.error)
    } else {
      await window.api.expenses.create(payload).catch(console.error)
    }
    setSaving(false)
    setFormOpen(false)
    load()
  }

  const handleDelete = async (exp) => {
    if (!confirm(`Delete "${exp.description}"?`)) return
    await window.api.expenses.delete(exp.id).catch(console.error)
    load()
  }

  const filtered = expenses.filter((e) => {
    const matchSearch =
      !search ||
      e.description?.toLowerCase().includes(search.toLowerCase()) ||
      e.category?.toLowerCase().includes(search.toLowerCase())
    const matchCat = catFilter === 'all' || e.category === catFilter
    return matchSearch && matchCat
  })

  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0)

  const byCategory = filtered.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount || 0)
    return acc
  }, {})

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length} records · Total: {currency} {fmt(total)}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add Expense
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500">From</label>
          <input
            type="date"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <label className="text-gray-500">To</label>
          <input
            type="date"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Table */}
        <div className="xl:col-span-3 bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <p className="px-5 py-10 text-center text-gray-400 text-sm">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-left">Category</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((exp) => (
                  <tr key={exp.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{exp.date}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{exp.description}</p>
                      {exp.notes && <p className="text-xs text-gray-400 mt-0.5">{exp.notes}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">
                      {currency} {fmt(exp.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(exp)}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(exp)}
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                      No expenses found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={3} className="px-5 py-3 font-semibold text-gray-700 text-sm">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-800">
                      {currency} {fmt(total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {/* Category Summary */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-gray-700 mb-4">By Category</h3>
          {Object.keys(byCategory).length === 0 ? (
            <p className="text-sm text-gray-400">No data</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => {
                  const pct = total > 0 ? (amount / total) * 100 : 0
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="truncate pr-2">{cat}</span>
                        <span className="font-medium shrink-0">
                          {currency} {fmt(amount)}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
          {total > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <div className="flex justify-between text-sm font-bold text-gray-800">
                <span>Total</span>
                <span>{currency} {fmt(total)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {formOpen && (
        <Modal
          title={editing ? 'Edit Expense' : 'Add Expense'}
          onClose={() => setFormOpen(false)}
          size="sm"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount ({currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <input
                type="text"
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                placeholder="What was this expense for?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                className="input resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setFormOpen(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Expense'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
