import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, RefreshCw, AlertTriangle, FileText, Wrench, Calendar, DollarSign, CheckCircle, XCircle, Clock, Tag, Paperclip, Shield } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { StatusBadge } from '../shared/StatusBadge'

const COST_TYPES = ['purchase', 'installation', 'repair', 'maintenance', 'upgrade', 'other']
const ASSET_TYPES = ['equipment', 'furniture', 'fixture', 'vehicle', 'tool', 'appliance', 'system', 'other']

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function money(amount) {
  return `P${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function InspectionBadge({ result }) {
  const colors = { pass: 'border-emerald-200 bg-emerald-50 text-emerald-700', fail: 'border-red-200 bg-red-50 text-red-700', conditional: 'border-amber-200 bg-amber-50 text-amber-700' }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${colors[result] || colors.conditional}`}>{result}</span>
}

function PreventiveBadge({ status }) {
  const colors = { pending: 'border-blue-200 bg-blue-50 text-blue-700', overdue: 'border-red-200 bg-red-50 text-red-700', completed: 'border-emerald-200 bg-emerald-50 text-emerald-700', skipped: 'border-slate-200 bg-slate-100 text-slate-500' }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${colors[status] || colors.pending}`}>{status}</span>
}

export default function AssetManagement() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [searchParams, setSearchParams] = useState({})
  const [apiAvailable, setApiAvailable] = useState(true)

  useEffect(() => {
    if (!window.api?.assetManagement) {
      setApiAvailable(false)
    }
  }, [])

  const TABS = [
    ['dashboard', 'Dashboard'],
    ['assets', 'Assets'],
    ['categories', 'Categories'],
    ['warranties', 'Warranties'],
    ['inspections', 'Inspections'],
    ['preventive', 'Preventive'],
    ['costs', 'Costs']
  ]

  if (!apiAvailable) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">ASSET MANAGEMENT</p>
          <h1 className="bb-page-header-title">Asset Management</h1>
        </div>
        <div className="bb-card p-6 text-center">
          <AlertTriangle size={24} className="mx-auto mb-2 text-amber-500" />
          <p className="text-sm font-semibold text-slate-700">Asset Management API not available</p>
          <p className="text-xs text-slate-500 mt-1">The assetManagement module is not exposed in the preload bridge.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Property Care</p>
          <h1 className="bb-page-header-title mt-2">Asset Management</h1>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'assets' && <AssetsTab />}
      {activeTab === 'categories' && <CategoriesTab />}
      {activeTab === 'warranties' && <WarrantiesTab />}
      {activeTab === 'inspections' && <InspectionsTab />}
      {activeTab === 'preventive' && <PreventiveTab />}
      {activeTab === 'costs' && <CostsTab />}
    </div>
  )
}

function DashboardTab() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dashboard, setDashboard] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.assetManagement.getAssetDashboard()
      if (data && typeof data === 'object') {
        setDashboard(data)
      } else {
        setDashboard(null)
      }
    } catch (e) {
      setError(e?.message || 'Failed to load dashboard')
      setDashboard(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !dashboard) {
    return <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
  }

  if (error && !dashboard) {
    return (
      <div className="bb-card p-6">
        <div className="flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-500" />
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="ml-auto rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">Retry</button>
        </div>
      </div>
    )
  }

  if (!dashboard) {
    return <div className="bb-card p-6 text-center"><p className="text-xs text-slate-400">No dashboard data available</p></div>
  }

  const cards = [
    { label: 'Total Assets', value: dashboard.total_assets || 0, icon: <Wrench size={18} />, color: 'text-blue-600' },
    { label: 'Active Warranties', value: dashboard.active_warranties || 0, icon: <Shield size={18} />, color: 'text-emerald-600' },
    { label: 'Upcoming Inspections', value: dashboard.upcoming_inspections || 0, icon: <Search size={18} />, color: 'text-amber-600' },
    { label: 'Overdue Preventive', value: dashboard.overdue_preventive || 0, icon: <AlertTriangle size={18} />, color: 'text-red-600' },
    { label: 'Cost YTD', value: money(dashboard.total_cost_ytd || 0), icon: <DollarSign size={18} />, color: 'text-slate-800' }
  ]

  return (
    <div className="grid grid-cols-1 gap-5">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="bb-card p-4 text-center">
            <div className="flex justify-center mb-2 text-slate-400">{card.icon}</div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </section>

      {Array.isArray(dashboard.assets_by_category) && dashboard.assets_by_category.length > 0 && (
        <section className="bb-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-bold text-slate-800">Assets by Category</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {dashboard.assets_by_category.map((cat) => (
              <div key={cat.category} className="flex items-center justify-between px-5 py-3">
                <p className="text-sm text-slate-700">{cat.category}</p>
                <p className="text-sm font-bold text-slate-800">{cat.count}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AssetsTab() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ asset_name: '', asset_type: 'equipment', category: '', manufacturer: '', model: '', serial_number: '', location: '', purchase_date: '', purchase_cost: '', warranty_expiry: '', warranty_provider: '', expected_lifespan_years: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.assetRegistry.getAssets(typeFilter || null, statusFilter || null)
      setAssets(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message || 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return assets
    const q = search.toLowerCase()
    return assets.filter((a) => (a.asset_name || '').toLowerCase().includes(q) || (a.serial_number || '').toLowerCase().includes(q) || (a.manufacturer || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q))
  }, [assets, search])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const result = await window.api.assetRegistry.createAsset(form)
      if (result?.success) {
        setFormOpen(false)
        setForm({ asset_name: '', asset_type: 'equipment', category: '', manufacturer: '', model: '', serial_number: '', location: '', purchase_date: '', purchase_cost: '', warranty_expiry: '', warranty_provider: '', expected_lifespan_years: '', notes: '' })
        await load()
      }
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets..." className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="">All Types</option>
          {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="disposed">Disposed</option>
          <option value="sold">Sold</option>
          <option value="lost">Lost</option>
        </select>
        <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> Add Asset</button>
        <button onClick={load} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <div className="bb-card p-8 text-center"><p className="text-xs text-slate-400">{search || typeFilter || statusFilter ? 'No assets match your filters' : 'No assets registered yet'}</p></div>
      ) : (
        <div className="bb-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Warranty</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => setSelectedAsset(selectedAsset?.id === asset.id ? null : asset)}>
                    <td className="px-5 py-3"><p className="text-sm font-semibold text-slate-800">{asset.asset_name}</p>{asset.serial_number && <p className="text-[10px] text-slate-400">SN: {asset.serial_number}</p>}</td>
                    <td className="px-5 py-3 text-xs text-slate-600 capitalize">{asset.asset_type}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{asset.category || '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{asset.location || '—'}</td>
                    <td className="px-5 py-3"><StatusBadge status={asset.status || 'active'} /></td>
                    <td className="px-5 py-3 text-xs text-slate-600">{asset.warranty_expiry ? (new Date(asset.warranty_expiry) < new Date() ? <span className="text-red-500">Expired {asset.warranty_expiry}</span> : asset.warranty_expiry) : '—'}</td>
                    <td className="px-5 py-3">
                      {selectedAsset?.id === asset.id ? <span className="text-[10px] font-semibold text-emerald-600">▲</span> : <span className="text-[10px] text-slate-300">▼</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedAsset && <AssetDetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} onRefresh={load} />}

      {formOpen && (
        <Modal title="Register New Asset" onClose={() => setFormOpen(false)} size="lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Asset Name *</label>
              <input type="text" value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Type</label>
              <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Category</label>
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Manufacturer</label>
              <input type="text" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Model</label>
              <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Serial Number</label>
              <input type="text" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Location</label>
              <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Purchase Date</label>
              <input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Purchase Cost</label>
              <input type="number" step="0.01" value={form.purchase_cost} onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Expected Lifespan (years)</label>
              <input type="number" value={form.expected_lifespan_years} onChange={(e) => setForm({ ...form, expected_lifespan_years: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Warranty Expiry</label>
              <input type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Warranty Provider</label>
              <input type="text" value={form.warranty_provider} onChange={(e) => setForm({ ...form, warranty_provider: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !form.asset_name.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Create Asset'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AssetDetailPanel({ asset, onClose, onRefresh }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoadingHistory(true)
      try {
        const data = await window.api.assetRegistry.getMaintenanceHistory(asset.id)
        setHistory(Array.isArray(data) ? data : [])
      } catch { setHistory([]) } finally { setLoadingHistory(false) }
    }
    load()
  }, [asset.id])

  return (
    <div className="bb-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-bold text-slate-800">{asset.asset_name}</h2>
          <p className="text-xs text-slate-500">{asset.asset_type}{asset.category ? ` · ${asset.category}` : ''}{asset.serial_number ? ` · SN: ${asset.serial_number}` : ''}</p>
        </div>
        <button onClick={onClose} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">Close</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-4 text-xs">
        <div><p className="text-slate-400">Manufacturer</p><p className="font-semibold text-slate-700">{asset.manufacturer || '—'}</p></div>
        <div><p className="text-slate-400">Model</p><p className="font-semibold text-slate-700">{asset.model || '—'}</p></div>
        <div><p className="text-slate-400">Location</p><p className="font-semibold text-slate-700">{asset.location || '—'}</p></div>
        <div><p className="text-slate-400">Status</p><StatusBadge status={asset.status} /></div>
        <div><p className="text-slate-400">Purchase Date</p><p className="font-semibold text-slate-700">{asset.purchase_date || '—'}</p></div>
        <div><p className="text-slate-400">Purchase Cost</p><p className="font-semibold text-slate-700">{asset.purchase_cost ? money(asset.purchase_cost) : '—'}</p></div>
        <div><p className="text-slate-400">Warranty Expiry</p><p className="font-semibold text-slate-700">{asset.warranty_expiry ? (new Date(asset.warranty_expiry) < new Date() ? <span className="text-red-500">{asset.warranty_expiry} (Expired)</span> : asset.warranty_expiry) : '—'}</p></div>
        <div><p className="text-slate-400">Warranty Provider</p><p className="font-semibold text-slate-700">{asset.warranty_provider || '—'}</p></div>
      </div>
      {asset.notes && <div className="px-5 pb-3 text-xs text-slate-500"><p className="text-slate-400">Notes:</p><p>{asset.notes}</p></div>}

      <div className="border-t border-slate-100 px-5 py-3.5">
        <h3 className="text-xs font-bold text-slate-700 mb-2">Maintenance History</h3>
        {loadingHistory ? (
          <div className="flex items-center justify-center py-4"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">No maintenance history recorded</p>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-slate-700">{h.description || 'Maintenance entry'}</p>
                  <p className="text-[10px] text-slate-400">{h.maintenance_date}{h.cost > 0 ? ` · ${money(h.cost)}` : ''}</p>
                </div>
                {h.maintenance_ticket_id && <span className="text-[10px] text-slate-400">Ticket</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoriesTab() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', icon: '', parent_category_id: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await window.api.assetManagement.getAssetCategories()
      setCategories(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tree = useMemo(() => {
    const roots = categories.filter((c) => !c.parent_category_id && c.is_active !== false)
    const children = (parentId) => categories.filter((c) => c.parent_category_id === parentId && c.is_active !== false)
    const build = (items, depth = 0) => items.length > 0 ? (
      <ul className={depth > 0 ? 'ml-4 border-l border-slate-200 pl-3 mt-1 space-y-1' : 'space-y-1'}>
        {items.map((cat) => (
          <li key={cat.id}>
            <div className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50 text-xs">
              <div className="flex items-center gap-2">
                <Tag size={12} className="text-slate-400" />
                <span className="font-semibold text-slate-700">{cat.name}</span>
                {cat.description && <span className="text-slate-400">· {cat.description}</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditing(cat); setForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '', parent_category_id: cat.parent_category_id || '' }); setFormOpen(true) }} className="text-[10px] text-slate-400 hover:text-slate-600">Edit</button>
                <button onClick={async () => { if (confirm('Delete?')) { await window.api.assetManagement.deleteAssetCategory(cat.id); load() } }} className="text-[10px] text-red-400 hover:text-red-600">Del</button>
              </div>
            </div>
            {children(cat.id).length > 0 && build(children(cat.id), depth + 1)}
          </li>
        ))}
      </ul>
    ) : null
    return build(roots)
  }, [categories, load])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { ...form }
      if (!payload.parent_category_id) payload.parent_category_id = null
      if (editing) {
        await window.api.assetManagement.updateAssetCategory(editing.id, payload)
      } else {
        await window.api.assetManagement.createAssetCategory(payload)
      }
      setFormOpen(false)
      setEditing(null)
      setForm({ name: '', description: '', icon: '', parent_category_id: '' })
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{categories.length} categories</p>
        <button onClick={() => { setEditing(null); setForm({ name: '', description: '', icon: '', parent_category_id: '' }); setFormOpen(true) }} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> Add Category</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : categories.length === 0 ? (
        <div className="bb-card p-8 text-center"><p className="text-xs text-slate-400">No categories defined</p></div>
      ) : (
        <div className="bb-card p-5">{tree}</div>
      )}

      {formOpen && (
        <Modal title={editing ? 'Edit Category' : 'Create Category'} onClose={() => { setFormOpen(false); setEditing(null) }} size="md">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Icon</label>
              <input type="text" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Icon name" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Parent Category</label>
              <select value={form.parent_category_id} onChange={(e) => setForm({ ...form, parent_category_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="">None (top-level)</option>
                {categories.filter((c) => c.id !== editing?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setFormOpen(false); setEditing(null) }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function WarrantiesTab() {
  const [warranties, setWarranties] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ asset_id: '', provider: '', warranty_number: '', start_date: '', end_date: '', coverage_details: '', contact_phone: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [w, a] = await Promise.all([
        window.api.assetManagement.getAssetWarranties(),
        window.api.assetRegistry.getAssets(null, null)
      ])
      setWarranties(Array.isArray(w) ? w : [])
      setAssets(Array.isArray(a) ? a : [])
    } catch (e) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const assetMap = useMemo(() => {
    const m = {}
    for (const a of assets) m[a.id] = a
    return m
  }, [assets])

  const grouped = useMemo(() => {
    const g = {}
    for (const w of warranties) {
      const aid = w.asset_id
      if (!g[aid]) g[aid] = []
      g[aid].push(w)
    }
    return g
  }, [warranties])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.assetManagement.createAssetWarranty(form)
      setFormOpen(false)
      setForm({ asset_id: '', provider: '', warranty_number: '', start_date: '', end_date: '', coverage_details: '', contact_phone: '' })
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{warranties.length} warranties</p>
        <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> Add Warranty</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : warranties.length === 0 ? (
        <div className="bb-card p-8 text-center"><p className="text-xs text-slate-400">No warranties registered</p></div>
      ) : (
        Object.entries(grouped).map(([assetId, ws]) => {
          const asset = assetMap[assetId]
          return (
            <section key={assetId} className="bb-card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
                <Shield size={16} className="text-emerald-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-800">{asset?.asset_name || 'Unknown Asset'}</h2>
                  {asset?.serial_number && <p className="text-xs text-slate-400">{asset.serial_number}</p>}
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {ws.map((w) => {
                  const expired = w.end_date && new Date(w.end_date) < new Date()
                  const expiring = w.end_date && !expired && new Date(w.end_date) <= new Date(Date.now() + 30 * 86400000)
                  return (
                    <div key={w.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-700">{w.provider || 'Unknown Provider'}</p>
                          {w.warranty_number && <span className="text-[10px] text-slate-400">#{w.warranty_number}</span>}
                          {expired && <span className="text-[10px] font-semibold text-red-500">EXPIRED</span>}
                          {expiring && <span className="text-[10px] font-semibold text-amber-500">EXPIRING</span>}
                        </div>
                        <p className="text-xs text-slate-500">{w.start_date || '—'} to {w.end_date || '—'}{w.contact_phone ? ` · ${w.contact_phone}` : ''}</p>
                        {w.coverage_details && <p className="text-[10px] text-slate-400 mt-0.5">{w.coverage_details}</p>}
                      </div>
                      <button onClick={async () => { if (confirm('Delete this warranty?')) { await window.api.assetManagement.deleteAssetWarranty(w.id); load() } }} className="text-[10px] text-red-400 hover:text-red-600 ml-3">Delete</button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}

      {formOpen && (
        <Modal title="Add Warranty" onClose={() => setFormOpen(false)} size="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Asset *</label>
              <select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="">Select asset...</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Provider</label>
              <input type="text" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Warranty Number</label>
              <input type="text" value={form.warranty_number} onChange={(e) => setForm({ ...form, warranty_number: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">End Date</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Coverage Details</label>
              <textarea value={form.coverage_details} onChange={(e) => setForm({ ...form, coverage_details: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Contact Phone</label>
              <input type="text" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.asset_id} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function InspectionsTab() {
  const [inspections, setInspections] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ asset_id: '', inspection_date: todayStr(), inspector_name: '', result: 'pass', notes: '', next_inspection_date: '', cost: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [i, a] = await Promise.all([
        window.api.assetManagement.getAssetInspections(assetFilter || null),
        window.api.assetRegistry.getAssets(null, null)
      ])
      setInspections(Array.isArray(i) ? i : [])
      setAssets(Array.isArray(a) ? a : [])
    } catch (e) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [assetFilter])

  useEffect(() => { load() }, [load])

  const assetMap = useMemo(() => {
    const m = {}
    for (const a of assets) m[a.id] = a
    return m
  }, [assets])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.assetManagement.createAssetInspection(form)
      setFormOpen(false)
      setForm({ asset_id: '', inspection_date: todayStr(), inspector_name: '', result: 'pass', notes: '', next_inspection_date: '', cost: '' })
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="flex flex-wrap items-center gap-3">
        <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="">All Assets</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
        </select>
        <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> Record Inspection</button>
        <button onClick={load} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><RefreshCw size={13} /></button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : inspections.length === 0 ? (
        <div className="bb-card p-8 text-center"><p className="text-xs text-slate-400">No inspections recorded</p></div>
      ) : (
        <div className="bb-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Asset</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Inspector</th>
                  <th className="px-5 py-3">Result</th>
                  <th className="px-5 py-3">Cost</th>
                  <th className="px-5 py-3">Next Inspection</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {inspections.map((ins) => {
                  const asset = assetMap[ins.asset_id]
                  return (
                    <tr key={ins.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-semibold text-slate-800">{asset?.asset_name || 'Unknown'}</p>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">{ins.inspection_date}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">{ins.inspector_name || '—'}</td>
                      <td className="px-5 py-3"><InspectionBadge result={ins.result} /></td>
                      <td className="px-5 py-3 text-xs text-slate-600">{ins.cost > 0 ? money(ins.cost) : '—'}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">{ins.next_inspection_date || '—'}</td>
                      <td className="px-5 py-3">
                        <button onClick={async () => { if (confirm('Delete this inspection?')) { await window.api.assetManagement.deleteAssetInspection(ins.id); load() } }} className="text-[10px] text-red-400 hover:text-red-600">Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <Modal title="Record Inspection" onClose={() => setFormOpen(false)} size="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Asset *</label>
              <select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="">Select asset...</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Inspection Date</label>
              <input type="date" value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Inspector Name</label>
              <input type="text" value={form.inspector_name} onChange={(e) => setForm({ ...form, inspector_name: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Result *</label>
              <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="conditional">Conditional</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Cost</label>
              <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Next Inspection Date</label>
              <input type="date" value={form.next_inspection_date} onChange={(e) => setForm({ ...form, next_inspection_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.asset_id} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Record'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PreventiveTab() {
  const [assignments, setAssignments] = useState([])
  const [templates, setTemplates] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [templateFormOpen, setTemplateFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [templateForm, setTemplateForm] = useState({ title: '', description: '', asset_category_id: '', frequency_days: 30, estimated_duration_minutes: 60, assigned_role: '', requires_room_ooo: false })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [a, t, asgn] = await Promise.all([
        window.api.assetManagement.getPreventiveTemplates(),
        window.api.assetManagement.getPreventiveAssignments(null, statusFilter || null),
        window.api.assetRegistry.getAssets(null, null)
      ])
      setTemplates(Array.isArray(a) ? a : [])
      setAssignments(Array.isArray(t) ? t : [])
      setAssets(Array.isArray(asgn) ? asgn : [])
    } catch (e) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const assetMap = useMemo(() => {
    const m = {}
    for (const a of assets) m[a.id] = a
    return m
  }, [assets])

  const handleComplete = async (id, notes) => {
    try {
      await window.api.assetManagement.completePreventiveAssignment(id, notes || null)
      await load()
    } catch (e) {
      setError(e?.message)
    }
  }

  const handleSkip = async (id, notes) => {
    try {
      await window.api.assetManagement.skipPreventiveAssignment(id, notes || null)
      await load()
    } catch (e) {
      setError(e?.message)
    }
  }

  const handleGenerate = async () => {
    try {
      const result = await window.api.assetManagement.generatePreventiveAssignments()
      if (result?.success) {
        await load()
      }
    } catch (e) {
      setError(e?.message)
    }
  }

  const handleTemplateSave = async () => {
    setSaving(true)
    try {
      await window.api.assetManagement.createPreventiveTemplate(templateForm)
      setTemplateFormOpen(false)
      setTemplateForm({ title: '', description: '', asset_category_id: '', frequency_days: 30, estimated_duration_minutes: 60, assigned_role: '', requires_room_ooo: false })
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
            <option value="skipped">Skipped</option>
          </select>
          <button onClick={handleGenerate} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">Generate Assignments</button>
        </div>
        <button onClick={() => setTemplateFormOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> New Template</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="bb-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <Calendar size={16} className="text-blue-600" />
              <h2 className="text-sm font-bold text-slate-800">Assignments ({assignments.length})</h2>
            </div>
            {assignments.length === 0 ? (
              <div className="px-5 py-8 text-center"><p className="text-xs text-slate-400">No assignments. Generate from templates.</p></div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
                {assignments.map((a) => {
                  const asset = assetMap[a.asset_id]
                  const isOverdue = a.next_due_date && new Date(a.next_due_date) < new Date() && a.status !== 'completed' && a.status !== 'skipped'
                  return (
                    <div key={a.id} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{asset?.asset_name || 'Unknown Asset'}</p>
                          <p className="text-xs text-slate-500">Due: {a.next_due_date || '—'} {isOverdue && <span className="text-red-500 font-semibold">(OVERDUE)</span>}</p>
                        </div>
                        <PreventiveBadge status={isOverdue ? 'overdue' : a.status} />
                      </div>
                      <div className="flex gap-2 mt-2">
                        {a.status !== 'completed' && a.status !== 'skipped' && (
                          <>
                            <button onClick={() => handleComplete(a.id, '')} className="flex items-center gap-1 rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200"><CheckCircle size={11} /> Complete</button>
                            <button onClick={() => handleSkip(a.id, '')} className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"><XCircle size={11} /> Skip</button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="bb-card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
              <FileText size={16} className="text-slate-600" />
              <h2 className="text-sm font-bold text-slate-800">Templates ({templates.length})</h2>
            </div>
            {templates.length === 0 ? (
              <div className="px-5 py-8 text-center"><p className="text-xs text-slate-400">No templates created</p></div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
                {templates.map((t) => (
                  <div key={t.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t.title}</p>
                        <p className="text-xs text-slate-500">Every {t.frequency_days}d · {t.estimated_duration_minutes}min{t.assigned_role ? ` · ${t.assigned_role}` : ''}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={async () => { if (confirm('Delete template?')) { await window.api.assetManagement.deletePreventiveTemplate(t.id); load() } }} className="text-[10px] text-red-400 hover:text-red-600">Delete</button>
                      </div>
                    </div>
                    {t.description && <p className="text-[10px] text-slate-400 mt-1">{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {templateFormOpen && (
        <Modal title="Create Preventive Template" onClose={() => setTemplateFormOpen(false)} size="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Title *</label>
              <input type="text" value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Description</label>
              <textarea value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Frequency (days)</label>
              <input type="number" value={templateForm.frequency_days} onChange={(e) => setTemplateForm({ ...templateForm, frequency_days: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Estimated Duration (min)</label>
              <input type="number" value={templateForm.estimated_duration_minutes} onChange={(e) => setTemplateForm({ ...templateForm, estimated_duration_minutes: Number(e.target.value) })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Assigned Role</label>
              <input type="text" value={templateForm.assigned_role} onChange={(e) => setTemplateForm({ ...templateForm, assigned_role: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={templateForm.requires_room_ooo} onChange={(e) => setTemplateForm({ ...templateForm, requires_room_ooo: e.target.checked })} className="rounded border-slate-300" />
                <span className="text-xs font-semibold text-slate-500">Requires Room OOO</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setTemplateFormOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleTemplateSave} disabled={saving || !templateForm.title.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Create Template'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CostsTab() {
  const [costs, setCosts] = useState([])
  const [summary, setSummary] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(todayStr())
  const [assetFilter, setAssetFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ asset_id: '', cost_type: 'maintenance', description: '', amount: '', vendor_id: '', ticket_id: '', cost_date: todayStr() })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [c, s, a] = await Promise.all([
        window.api.assetManagement.getAssetCosts(assetFilter || null),
        window.api.assetManagement.getAssetCostSummary(startDate || null, endDate || null),
        window.api.assetRegistry.getAssets(null, null)
      ])
      setCosts(Array.isArray(c) ? c : [])
      setSummary(Array.isArray(s) ? s : [])
      setAssets(Array.isArray(a) ? a : [])
    } catch (e) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }, [assetFilter, startDate, endDate])

  useEffect(() => { load() }, [load])

  const assetMap = useMemo(() => {
    const m = {}
    for (const a of assets) m[a.id] = a
    return m
  }, [assets])

  const totalCost = useMemo(() => costs.reduce((sum, c) => sum + Number(c.amount || 0), 0), [costs])

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.api.assetManagement.recordAssetCost(form)
      setFormOpen(false)
      setForm({ asset_id: '', cost_type: 'maintenance', description: '', amount: '', vendor_id: '', ticket_id: '', cost_date: todayStr() })
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {error && <div className="bb-card p-3 border-red-200 bg-red-50"><p className="text-xs text-red-600">{error}</p></div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1">Asset Filter</label>
          <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">All Assets</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={14} /> Record Cost</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : (
        <>
          {summary.length > 0 && (
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {summary.map((s) => (
                <div key={s.cost_type} className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1 capitalize">{s.cost_type}</p>
                  <p className="text-lg font-bold text-slate-800">{money(s.total_amount)}</p>
                  <p className="text-[10px] text-slate-400">{s.count} entries</p>
                </div>
              ))}
              <div className="bb-card p-4 text-center border-emerald-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">Total</p>
                <p className="text-lg font-bold text-emerald-700">{money(totalCost)}</p>
                <p className="text-[10px] text-slate-400">{costs.length} entries</p>
              </div>
            </section>
          )}

          {costs.length === 0 ? (
            <div className="bb-card p-8 text-center"><p className="text-xs text-slate-400">No costs recorded in this period</p></div>
          ) : (
            <div className="bb-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-5 py-3">Asset</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Description</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {costs.map((c) => {
                      const asset = assetMap[c.asset_id]
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-3">
                            <p className="text-sm font-semibold text-slate-800">{asset?.asset_name || 'Unknown'}</p>
                          </td>
                          <td className="px-5 py-3"><span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 capitalize">{c.cost_type}</span></td>
                          <td className="px-5 py-3 text-xs text-slate-600">{c.description || '—'}</td>
                          <td className="px-5 py-3 text-xs text-slate-600">{c.cost_date}</td>
                          <td className="px-5 py-3 text-right text-sm font-bold text-slate-800">{money(c.amount)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {formOpen && (
        <Modal title="Record Asset Cost" onClose={() => setFormOpen(false)} size="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Asset *</label>
              <select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="">Select asset...</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Cost Type</label>
              <select value={form.cost_type} onChange={(e) => setForm({ ...form, cost_type: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                {COST_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Amount *</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Cost Date</label>
              <input type="date" value={form.cost_date} onChange={(e) => setForm({ ...form, cost_date: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Vendor ID</label>
              <input type="text" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Ticket ID</label>
              <input type="text" value={form.ticket_id} onChange={(e) => setForm({ ...form, ticket_id: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.asset_id || !form.amount} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving...' : 'Record Cost'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
