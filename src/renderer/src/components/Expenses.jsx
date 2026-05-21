import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { Modal } from './shared/Modal'
import HorizontalScrollArea from './shared/HorizontalScrollArea'
import { useSettings } from '../app-context'
import { localToday } from '../utils/localDate'

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

const today = () => localToday()
const monthStart = () => {
  const d = new Date()
  d.setDate(1)
  return localToday().slice(0, 8) + '01'
}

function fmt(v) {
  return Number(v || 0).toFixed(2)
}

function normalizeMaintenanceRow(row = {}) {
  const date = String(row.reported_date || row.created_at || row.date || '').slice(0, 10)
  const title = row.title || row.issue || row.description || 'Maintenance repair'
  const roomLabel = row.room_number ? `Room ${row.room_number}` : (row.room_type || '')
  const status = String(row.status || 'open').replace(/_/g, ' ')
  return {
    id: `maintenance-${row.id || row._queue_id || date || title}`,
    date,
    description: title,
    category: 'Maintenance & Repairs',
    outlet_id: null,
    notes: [roomLabel, `Status: ${status}`, row.description || ''].filter(Boolean).join(' · '),
    amount: Number(row.total_cost || 0)
  }
}

export default function Expenses() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [expenses, setExpenses] = useState([])
  const [inventorySpend, setInventorySpend] = useState({ total: 0, purchases: [] })
  const [supplySpend, setSupplySpend] = useState({ total: 0, purchases: [] })
  const [maintenanceSpend, setMaintenanceSpend] = useState({ total: 0, rows: [] })
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(today())
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date_desc')
  const [outlets, setOutlets] = useState([])
  const [selectedOutlet, setSelectedOutlet] = useState('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [form, setForm] = useState({
    date: today(),
    description: '',
    category: CATEGORIES[0],
    amount: '',
    notes: '',
    outlet_id: ''
  })

  useEffect(() => {
    window.api.outlets.getAll().then((d) => setOutlets(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [start, end, selectedOutlet])

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    setPageError('')
    try {
      const showSupplyCosts = !selectedOutlet || selectedOutlet === 'all' || selectedOutlet === 'unassigned'
      const showMaintenanceCosts = !selectedOutlet || selectedOutlet === 'all' || selectedOutlet === 'unassigned'
      const [expenseData, inventoryData, supplyData, maintenanceData] = await Promise.all([
        window.api.expenses.getAll(start, end, selectedOutlet),
        window.api.reports.inventorySpend(start, end, selectedOutlet).catch(() => ({ total: 0, purchases: [] })),
        showSupplyCosts
          ? window.api.reports.supplySpend(start, end).catch(() => ({ total: 0, purchases: [] }))
          : Promise.resolve({ total: 0, purchases: [] }),
        showMaintenanceCosts
          ? window.api.reports.maintenanceRows(start, end).catch(() => [])
          : Promise.resolve([])
      ])
      setExpenses(expenseData || [])
      setInventorySpend(inventoryData || { total: 0, purchases: [] })
      setSupplySpend(supplyData || { total: 0, purchases: [] })
      const rows = (maintenanceData || []).map(normalizeMaintenanceRow).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      setMaintenanceSpend({
        total: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        rows
      })
    } catch (err) {
      setPageError(err?.message || 'Could not load expenses right now.')
      setInventorySpend({ total: 0, purchases: [] })
      setSupplySpend({ total: 0, purchases: [] })
      setMaintenanceSpend({ total: 0, rows: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!window.api?.sync?.onStatusChanged) return
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      load(true)
    })
    return () => unsubscribe?.()
  }, [start, end, selectedOutlet])

  const expenseMatchesCurrentOutlet = (expense) => {
    if (!selectedOutlet || selectedOutlet === 'all') return true
    if (selectedOutlet === 'unassigned') return !expense?.outlet_id
    return expense?.outlet_id === selectedOutlet
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ date: today(), description: '', category: CATEGORIES[0], amount: '', notes: '', outlet_id: '' })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (exp) => {
    setEditing(exp)
    setForm({
      date: exp.date,
      description: exp.description,
      category: exp.category || CATEGORIES[0],
      amount: String(exp.amount),
      notes: exp.notes || '',
      outlet_id: exp.outlet_id || ''
    })
    setFormError('')
    setFormOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        outlet_id: form.outlet_id || null
      }
      const result = editing
        ? await window.api.expenses.update(editing.id, payload)
        : await window.api.expenses.create(payload)

      if (!result?.success) {
        setFormError(result?.error || 'Could not save this expense right now.')
        return
      }

      const selectedOutletRow = payload.outlet_id
        ? outlets.find((row) => row.id === payload.outlet_id)
        : null
      const savedExpense = editing
        ? {
            ...editing,
            ...payload,
            outlets: payload.outlet_id
              ? { name: selectedOutletRow?.name || null }
              : null
          }
        : {
            ...payload,
            id: result?.id,
            outlets: payload.outlet_id
              ? { name: selectedOutletRow?.name || null }
              : null
          }
      setExpenses((prev) => {
        const next = prev.filter((row) => row.id !== savedExpense.id)
        if (!expenseMatchesCurrentOutlet(savedExpense)) return next
        return [savedExpense, ...next]
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      })

      setFormOpen(false)
    } catch (err) {
      setFormError(err?.message || 'Could not save this expense right now.')
      return
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (exp) => {
    if (!confirm(`Delete "${exp.description}"?\n\nThis permanently removes the expense from the period totals and category summaries.`)) return
    const result = await window.api.expenses.delete(exp.id).catch((err) => ({ success: false, error: err?.message || 'Could not delete this expense.' }))
    if (!result?.success) {
      alert(result?.error || 'Could not delete this expense right now.')
      return
    }
    setExpenses((prev) => prev.filter((row) => row.id !== exp.id))
  }

  const filtered = useMemo(() => {
    const normalizedSearch = search.toLowerCase()
    return [...expenses.filter((e) => {
      const matchSearch =
        !search ||
        e.description?.toLowerCase().includes(normalizedSearch) ||
        e.category?.toLowerCase().includes(normalizedSearch)
      const matchCat = catFilter === 'all' || e.category === catFilter
      return matchSearch && matchCat
    })].sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return String(a.date || '').localeCompare(String(b.date || ''))
        case 'amount_desc':
          return Number(b.amount || 0) - Number(a.amount || 0)
        case 'amount_asc':
          return Number(a.amount || 0) - Number(b.amount || 0)
        case 'description_asc':
          return String(a.description || '').localeCompare(String(b.description || ''))
        case 'date_desc':
        default:
          return String(b.date || '').localeCompare(String(a.date || ''))
      }
    })
  }, [catFilter, expenses, search, sortBy])

  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0)
  const manualPeriodTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const showSupplyCosts = !selectedOutlet || selectedOutlet === 'all' || selectedOutlet === 'unassigned'
  const showMaintenanceCosts = !selectedOutlet || selectedOutlet === 'all' || selectedOutlet === 'unassigned'
  const inventoryTotal = Number(inventorySpend?.total || 0)
  const roomSupplyTotal = showSupplyCosts ? Number(supplySpend?.total || 0) : 0
  const maintenanceTotal = showMaintenanceCosts ? Number(maintenanceSpend?.total || 0) : 0
  const stockTotal = inventoryTotal + roomSupplyTotal
  const totalOutgoings = manualPeriodTotal + stockTotal + maintenanceTotal
  const outletNameById = Object.fromEntries((outlets || []).map((row) => [row.id, row.name]))
  const stockRows = [
    ...((inventorySpend?.purchases || []).map((row) => ({
      id: `inventory-${row.id || row.item_id || row.date}`,
      date: row.date,
      source: 'Inventory',
      description: row.inventory_items?.name || 'Inventory purchase',
      category: row.inventory_items?.category || 'Uncategorised',
      outlet_id: row.inventory_items?.outlet_id || null,
      notes: row.notes || '',
      amount: Number(row.total_cost || 0)
    }))),
    ...(showSupplyCosts ? (supplySpend?.purchases || []).map((row) => ({
      id: `supply-${row.id || row.item_id || row.date}`,
      date: row.date,
      source: 'Room Supplies',
      description: row.supply_items?.name || 'Room supply purchase',
      category: 'Room Supplies',
      outlet_id: null,
      notes: row.notes || '',
      amount: Number(row.total_cost || 0)
    })) : [])
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const maintenanceRows = showMaintenanceCosts ? maintenanceSpend.rows || [] : []

  const byCategory = filtered.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount || 0)
    return acc
  }, {})

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Operating Costs</p>
          <h1 className="bb-page-header-title mt-2">Expenses</h1>
          <p className="bb-page-header-subtitle">
            Manual: {currency} {fmt(manualPeriodTotal)} · Stock: {currency} {fmt(stockTotal)} · Total outgoings: {currency} {fmt(totalOutgoings)}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add Expense
        </button>
      </div>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {/* Filters */}
      <div className="bb-filter-bar">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">From</label>
          <input
            type="date"
            className="input text-sm"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <label className="text-slate-500">To</label>
          <input
            type="date"
            className="input text-sm"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={selectedOutlet}
          onChange={(e) => setSelectedOutlet(e.target.value)}
        >
          <option value="all">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id || o.name} value={o.id || ''}>{o.name}</option>
          ))}
          <option value="unassigned">Others</option>
        </select>
        <select
          className="input w-auto"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="date_desc">Newest date</option>
          <option value="date_asc">Oldest date</option>
          <option value="amount_desc">Highest amount</option>
          <option value="amount_asc">Lowest amount</option>
          <option value="description_asc">Description A-Z</option>
        </select>
        <div className="ml-auto text-xs text-slate-500">
          Date and outlet filters update the costs shown here. Search and category filters apply to manual expenses only.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Manual Expenses</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{currency} {fmt(manualPeriodTotal)}</p>
          <p className="mt-2 text-xs text-slate-500">{expenses.length} editable records in this date range.</p>
        </div>
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inventory Purchases</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{currency} {fmt(inventoryTotal)}</p>
          <p className="mt-2 text-xs text-slate-500">{inventorySpend?.purchases?.length || 0} automatic stock cost entries.</p>
        </div>
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Room Supplies</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{currency} {fmt(roomSupplyTotal)}</p>
          <p className="mt-2 text-xs text-slate-500">
            {showSupplyCosts
              ? `${supplySpend?.purchases?.length || 0} property-wide supply purchase entries.`
              : 'Shown in All Outlets or Others view because room supplies are property-wide.'}
          </p>
        </div>
        <div className="bb-card p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Maintenance Repairs</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{currency} {fmt(maintenanceTotal)}</p>
          <p className="mt-2 text-xs text-slate-500">
            {showMaintenanceCosts
              ? `${maintenanceRows.length || 0} repair entry${maintenanceRows.length === 1 ? '' : 's'} in this period.`
              : 'Shown in All Outlets or Others view because maintenance is property-wide.'}
          </p>
        </div>
        <div className="bb-card border-slate-900 bg-slate-900 p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Total Outgoings</p>
          <p className="mt-3 text-2xl font-bold">{currency} {fmt(totalOutgoings)}</p>
          <p className="mt-2 text-xs text-white/70">Manual expenses plus inventory, room-supply, and maintenance costs.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        {/* Table */}
        <div className="bb-table-shell xl:col-span-3">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-semibold text-slate-800">Manual expense records</p>
            <p className="mt-1 text-xs text-slate-500">These are the entries you can create, edit, and delete from this screen.</p>
          </div>
          {loading ? (
            <div className="bb-empty-state min-h-[220px]">
              <p className="text-sm font-medium text-slate-500">Loading expenses…</p>
            </div>
          ) : (
            <HorizontalScrollArea>
              <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-left">Category</th>
                  <th className="px-5 py-3 text-left">Outlet</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{exp.date}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{exp.description}</p>
                      {exp.notes && <p className="mt-0.5 text-xs text-slate-400">{exp.notes}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {exp.outlets?.name ?? <span className="text-slate-300">Others</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">
                      {currency} {fmt(exp.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(exp)}
                          className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-50"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(exp)}
                          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12">
                      <div className="bb-empty-state py-10">
                        <p className="text-base font-semibold text-slate-800">No expenses found</p>
                        <p className="text-sm text-slate-500">Try a different date range, category, or search term.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={4} className="px-5 py-3 text-sm font-semibold text-slate-700">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">
                      {currency} {fmt(total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
              </table>
            </HorizontalScrollArea>
          )}
        </div>

        {/* Category Summary */}
        <div className="space-y-6">
          <div className="bb-card p-5">
            <h3 className="mb-4 font-semibold text-slate-700">Manual Expenses by Category</h3>
            {Object.keys(byCategory).length === 0 ? (
              <div className="bb-empty-state min-h-[180px] py-8">
                <p className="text-sm text-slate-500">No manual expense data for the current filters.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amount]) => {
                    const pct = total > 0 ? (amount / total) * 100 : 0
                    return (
                      <div key={cat}>
                        <div className="mb-1 flex justify-between text-xs text-slate-600">
                          <span className="truncate pr-2">{cat}</span>
                          <span className="font-medium shrink-0">
                            {currency} {fmt(amount)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100">
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
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-sm font-bold text-slate-800">
                  <span>Filtered Total</span>
                  <span>{currency} {fmt(total)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bb-card p-5">
            <h3 className="mb-4 font-semibold text-slate-700">Automatic Stock Costs</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Inventory purchases</span>
                <span className="font-semibold text-slate-800">{currency} {fmt(inventoryTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Room-supply purchases</span>
                <span className="font-semibold text-slate-800">{currency} {fmt(roomSupplyTotal)}</span>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-sm font-bold text-slate-900">
                  <span>Total stock costs</span>
                  <span>{currency} {fmt(stockTotal)}</span>
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              These rows come from stock purchase records automatically. They affect reporting and cannot be edited from the Expenses screen.
            </p>
          </div>
        </div>
      </div>

      <div className="bb-table-shell">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">Automatic stock purchase entries</p>
          <p className="mt-1 text-xs text-slate-500">Inventory and room-supply purchases flow here automatically for visibility and P&amp;L review.</p>
        </div>
        <HorizontalScrollArea>
          <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left">Date</th>
              <th className="px-5 py-3 text-left">Source</th>
              <th className="px-5 py-3 text-left">Description</th>
              <th className="px-5 py-3 text-left">Category</th>
              <th className="px-5 py-3 text-left">Outlet</th>
              <th className="px-5 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stockRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-5 py-3 text-slate-600">{row.date}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                    row.source === 'Inventory'
                      ? 'border border-violet-200 bg-violet-50 text-violet-700'
                      : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}>
                    {row.source}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-800">{row.description}</p>
                  {row.notes && <p className="mt-0.5 text-xs text-slate-400">{row.notes}</p>}
                </td>
                <td className="px-5 py-3 text-slate-600">{row.category}</td>
                <td className="px-5 py-3 text-slate-600">
                  {row.outlet_id ? (outletNameById[row.outlet_id] || 'Unknown outlet') : <span className="text-slate-400">Property-wide</span>}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-slate-800">
                  {currency} {fmt(row.amount)}
                </td>
              </tr>
            ))}
            {stockRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12">
                  <div className="bb-empty-state py-10">
                    <p className="text-base font-semibold text-slate-800">No stock purchases in this view</p>
                    <p className="text-sm text-slate-500">
                      Record inventory or room-supply purchases and they will appear here automatically.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {stockRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td colSpan={5} className="px-5 py-3 text-sm font-semibold text-slate-700">
                  Total Stock Costs
                </td>
                <td className="px-5 py-3 text-right font-bold text-slate-800">
                  {currency} {fmt(stockTotal)}
                </td>
              </tr>
            </tfoot>
          )}
          </table>
        </HorizontalScrollArea>
      </div>

      {showMaintenanceCosts && (
        <div className="bb-table-shell">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-semibold text-slate-800">Maintenance repair entries</p>
            <p className="mt-1 text-xs text-slate-500">Read-only repair costs that flow into reporting and P&amp;L automatically.</p>
          </div>
          <HorizontalScrollArea>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Room</th>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {maintenanceRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{row.date || '—'}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {row.notes?.split(' · ')?.[0] || 'Property-wide'}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{row.description}</p>
                      {row.notes && <p className="mt-0.5 text-xs text-slate-400">{row.notes}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                        Maintenance
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">
                      {currency} {fmt(row.amount)}
                    </td>
                  </tr>
                ))}
                {maintenanceRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12">
                      <div className="bb-empty-state py-10">
                        <p className="text-base font-semibold text-slate-800">No maintenance costs found</p>
                        <p className="text-sm text-slate-500">Repair costs will appear here once they are recorded for the selected period.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {maintenanceRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={4} className="px-5 py-3 text-sm font-semibold text-slate-700">
                      Total Maintenance Costs
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">
                      {currency} {fmt(maintenanceTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </HorizontalScrollArea>
        </div>
      )}

      {/* Form Modal */}
      {formOpen && (
        <Modal
          title={editing ? 'Edit Expense' : 'Add Expense'}
          onClose={() => setFormOpen(false)}
          size="sm"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
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
                <p className="mt-1 text-xs text-slate-500">Use the full amount that should count toward reporting for this date.</p>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Outlet</label>
              <select
                className="input"
                value={form.outlet_id}
                onChange={(e) => setForm({ ...form, outlet_id: e.target.value })}
              >
                <option value="">— Others —</option>
                {outlets.map((o) => (
                  <option key={o.id || o.name} value={o.id || ''}>{o.name}</option>
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
