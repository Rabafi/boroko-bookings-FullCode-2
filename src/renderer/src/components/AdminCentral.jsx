import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../App'
import {
  LayoutDashboard, Building2, CreditCard, ToggleRight, Megaphone,
  LifeBuoy, Activity, LogOut, Shield, RefreshCw, Plus, Trash2,
  Copy, CheckCircle, XCircle, Key, ChevronRight, X, AlertTriangle,
  Clock, TrendingUp, Users, Home, Wrench, DollarSign, Edit3,
  Mail, Send, CheckCircle2, Eye, EyeOff
} from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────────────────
const BIZ_EMOJI  = { lodge: '🏕️', restaurant: '🍽️', retail: '🛒', service_provider: '🔧' }
const BIZ_LABEL  = { lodge: 'Lodge', restaurant: 'Restaurant', retail: 'Retail', service_provider: 'Service Provider' }
const ALL_FEATURES = ['pos', 'inventory', 'supplies', 'conference', 'pool', 'reports', 'expenses', 'staff', 'audit', 'import']
const FEAT_LABEL   = {
  pos: 'POS / Bar', inventory: 'Inventory', supplies: 'Room Supplies',
  conference: 'Conference', pool: 'Pool / Day Use',
  reports: 'Reports', expenses: 'Expenses', staff: 'Staff Management',
  audit: 'Night Audit', import: 'Data Import'
}

// ── Subscription Tiers ────────────────────────────────────────────────────────
const TIERS = ['Starter', 'Standard', 'Pro']
const TIER_DESC = {
  Starter:  'Bookings, rooms, guests & housekeeping only',
  Standard: 'Adds reports, expenses, staff, audit, conference & day use',
  Pro:      'Full suite including POS, inventory & room supplies'
}
const TIER_FLAGS = {
  Starter: {
    reports: false, expenses: false, staff: false, audit: false,
    conference: false, pool: false, pos: false, inventory: false,
    supplies: false, import: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, audit: true,
    conference: true, pool: true, pos: false, inventory: false,
    supplies: false, import: true
  },
  Pro: {
    reports: true, expenses: true, staff: true, audit: true,
    conference: true, pool: true, pos: true, inventory: true,
    supplies: true, import: true
  }
}
const PRIORITY_COLOR = { Low: 'text-gray-400', Normal: 'text-blue-400', High: 'text-orange-400', Urgent: 'text-red-400' }
const STATUS_COLOR   = { open: 'bg-yellow-500/20 text-yellow-300', in_progress: 'bg-blue-500/20 text-blue-300', resolved: 'bg-green-500/20 text-green-300', closed: 'bg-gray-500/20 text-gray-400' }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function timeAgo(dt) {
  if (!dt) return ''
  const diff = Date.now() - new Date(dt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return fmt(dt)
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  )
}

function StatCard({ label, value, color = 'text-white', sub }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className={`bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 ${wide ? 'w-[640px]' : 'w-[480px]'} max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

const inp = "w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
const btn = (variant = 'primary') => ({
  primary: 'bg-purple-600 hover:bg-purple-700 text-white',
  danger: 'bg-red-600/20 hover:bg-red-600/40 text-red-400',
  ghost: 'bg-gray-700 hover:bg-gray-600 text-gray-200'
}[variant])

// ════════════════════════════════════════════════════════════════════
// SECTION: Dashboard
// ════════════════════════════════════════════════════════════════════
function Dashboard({ companies, licenses, tickets, activityLogs }) {
  const today = new Date().toISOString().split('T')[0]
  const active = licenses.filter(l => l.is_active).length
  const expiring = licenses.filter(l => l.expires_at && l.is_active && new Date(l.expires_at) > new Date() && (new Date(l.expires_at) - new Date()) < 30 * 864e5).length
  const overdue = licenses.filter(l => l.next_due_date && l.next_due_date < today && l.payment_status !== 'free' && l.is_active).length
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const byType = companies.reduce((a, c) => { const t = c.business_type || 'lodge'; a[t] = (a[t] || 0) + 1; return a }, {})
  const recent5 = [...companies].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5)
  const recentLogs = activityLogs.slice(0, 15)

  const ACTION_ICON = {
    user_login: '👤', booking_created: '📅', expense_added: '💸',
    maintenance_raised: '🔧', default: '📌'
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white">Dashboard</h2>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Registered Companies" value={companies.length} color="text-white" />
        <StatCard label="Active Licenses" value={active} color="text-green-400" />
        <StatCard label="Expiring (30 days)" value={expiring} color={expiring > 0 ? 'text-yellow-400' : 'text-gray-500'} />
        <StatCard label="Overdue Payments" value={overdue} color={overdue > 0 ? 'text-red-400' : 'text-gray-500'} />
        <StatCard label="Open Support Tickets" value={openTickets} color={openTickets > 0 ? 'text-orange-400' : 'text-gray-500'} />
      </div>

      {/* Business types */}
      {Object.keys(byType).length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Business Types</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(byType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
                <span>{BIZ_EMOJI[type] || '🏢'}</span>
                <span className="text-sm text-gray-200">{BIZ_LABEL[type] || type}</span>
                <span className="text-sm font-bold text-white bg-gray-600 rounded-full px-2">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        {/* Recently registered */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Recently Registered</p>
          {recent5.length === 0 ? (
            <p className="text-gray-500 text-sm">No companies yet</p>
          ) : (
            <div className="space-y-3">
              {recent5.map(c => (
                <div key={c.lodge_id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{c.lodge_name || '—'}</p>
                    <p className="text-xs text-gray-500">{BIZ_EMOJI[c.business_type] || '🏢'} {BIZ_LABEL[c.business_type] || c.business_type}</p>
                  </div>
                  <p className="text-xs text-gray-500">{fmt(c.updated_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Recent Activity</p>
          {recentLogs.length === 0 ? (
            <p className="text-gray-500 text-sm">No activity logged yet</p>
          ) : (
            <div className="space-y-2.5">
              {recentLogs.map(log => (
                <div key={log.id} className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">{ACTION_ICON[log.action] || ACTION_ICON.default}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-200 truncate">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500">{log.lodge_name || log.lodge_id?.slice(0,8)} · {timeAgo(log.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Companies
// ════════════════════════════════════════════════════════════════════
function Companies({ companies, loading }) {
  const [selected, setSelected] = useState(null)
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const openDetail = async (company) => {
    setSelected(company)
    setStats(null)
    setStatsLoading(true)
    const s = await window.api.admin.getCompanyStats(company.lodge_id).catch(() => null)
    setStats(s)
    setStatsLoading(false)
  }

  return (
    <div className="flex gap-5 h-full">
      {/* Table */}
      <div className={`flex-1 min-w-0 bg-gray-800 rounded-xl overflow-hidden ${selected ? 'hidden md:block' : ''}`}>
        {companies.length === 0 && !loading ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <Building2 size={32} className="mx-auto mb-3 opacity-40" />
            <p>No registered businesses found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Lodge ID</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {companies.map((c) => (
                <tr
                  key={c.lodge_id}
                  className={`hover:bg-gray-700 transition-colors cursor-pointer ${selected?.lodge_id === c.lodge_id ? 'bg-gray-700' : ''}`}
                  onClick={() => openDetail(c)}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-white">{c.lodge_name || '—'}</p>
                    {c.company_name && <p className="text-xs text-gray-400">{c.company_name}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                      {BIZ_EMOJI[c.business_type] || '🏢'} {BIZ_LABEL[c.business_type] || c.business_type || 'Lodge'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{[c.city, c.country].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {c.phone && <p>{c.phone}</p>}
                    {c.email && <p>{c.email}</p>}
                    {!c.phone && !c.email && '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono text-gray-500">{c.lodge_id?.slice(0, 8)}…</span>
                      <CopyBtn text={c.lodge_id} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmt(c.updated_at)}</td>
                  <td className="px-4 py-3 text-gray-500"><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-72 shrink-0 bg-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white text-sm">Company Detail</h3>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
          </div>
          <div>
            <p className="text-lg font-bold text-white">{selected.lodge_name}</p>
            {selected.company_name && <p className="text-xs text-gray-400">{selected.company_name}</p>}
            <p className="text-xs text-gray-500 mt-1">{BIZ_EMOJI[selected.business_type]} {BIZ_LABEL[selected.business_type] || selected.business_type}</p>
          </div>
          <div className="text-xs text-gray-400 space-y-1 border-t border-gray-700 pt-3">
            {selected.city || selected.country ? <p>📍 {[selected.city, selected.country].filter(Boolean).join(', ')}</p> : null}
            {selected.phone && <p>📞 {selected.phone}</p>}
            {selected.email && <p>✉️ {selected.email}</p>}
          </div>
          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-gray-400 mb-1">Lodge ID</p>
            <div className="flex items-center gap-1">
              <span className="text-xs font-mono text-gray-500 break-all">{selected.lodge_id}</span>
              <CopyBtn text={selected.lodge_id} />
            </div>
          </div>
          {/* Live stats */}
          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Live Stats</p>
            {statsLoading ? (
              <p className="text-xs text-gray-500 animate-pulse">Loading stats…</p>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: Home, label: 'Rooms', value: stats.rooms },
                  { icon: Users, label: 'Staff', value: stats.users },
                  { icon: TrendingUp, label: 'Bookings (30d)', value: stats.bookings_30d },
                  { icon: DollarSign, label: 'Expenses (30d)', value: stats.expenses_30d?.toFixed(0) },
                  { icon: Wrench, label: 'Open Tickets', value: stats.open_maintenance }
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="bg-gray-700 rounded-lg p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon size={11} className="text-gray-400" />
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                    <p className="text-sm font-bold text-white">{value ?? '—'}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-500">Stats unavailable</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Licenses & Billing
// ════════════════════════════════════════════════════════════════════
function LicenseBilling({ licenses, onRefresh }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [billingModal, setBillingModal] = useState(null) // license to edit billing
  const [billingForm, setBillingForm] = useState({})

  const today = new Date().toISOString().split('T')[0]

  const handleCreate = async (e) => {
    e.preventDefault(); setError(''); setSaving(true)
    const r = await window.api.admin.createLicense({ ...form, lodge_id: form.lodge_id || 'unassigned', expires_at: form.expires_at || null, notes: form.notes || null }).catch(e => ({ error: e.message }))
    if (r?.license_key) { setShowForm(false); setForm({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '' }); onRefresh() }
    else setError(r?.error || 'Failed')
    setSaving(false)
  }

  const openBilling = (lic) => {
    setBillingModal(lic)
    setBillingForm({
      subscription_plan: lic.subscription_plan || 'Basic',
      monthly_fee: lic.monthly_fee || 0,
      currency: lic.currency || 'USD',
      payment_status: lic.payment_status || 'active',
      last_payment_date: lic.last_payment_date || '',
      next_due_date: lic.next_due_date || ''
    })
  }

  const saveBilling = async () => {
    await window.api.admin.updateLicenseBilling(billingModal.id, billingForm).catch(() => {})
    // Auto-apply tier feature flags to the lodge if lodge_id is set
    const lodgeId = billingModal.lodge_id
    const tierFlags = TIER_FLAGS[billingForm.subscription_plan]
    if (lodgeId && lodgeId !== 'unassigned' && tierFlags) {
      await Promise.all(
        Object.entries(tierFlags).map(([feature, enabled]) =>
          window.api.admin.setLodgeFeature(lodgeId, feature, enabled).catch(() => {})
        )
      )
    }
    setBillingModal(null); onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-gray-400 text-sm">Manage license keys and subscription billing</p>
        <button onClick={() => setShowForm(true)} className={`flex items-center gap-2 ${btn()} px-4 py-2 rounded-lg text-sm font-medium transition-colors`}>
          <Plus size={15} /> Generate License
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2"><Key size={16} className="text-purple-400" /> New License</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            {error && <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Business Name *">
                <input className={inp} placeholder="e.g. Sunset Lodge" value={form.lodge_name} onChange={e => setForm({...form, lodge_name: e.target.value})} required />
              </Field>
              <Field label="Business Type">
                <select className={inp} value={form.business_type} onChange={e => setForm({...form, business_type: e.target.value})}>
                  <option value="lodge">🏕️ Lodge / Hotel</option>
                  <option value="restaurant">🍽️ Restaurant</option>
                  <option value="retail">🛒 Retail</option>
                  <option value="service_provider">🔧 Service Provider</option>
                </select>
              </Field>
              <Field label="Lodge ID (optional)">
                <input className={`${inp} font-mono`} placeholder="UUID from Companies list" value={form.lodge_id} onChange={e => setForm({...form, lodge_id: e.target.value})} />
              </Field>
              <Field label="Expiry Date (optional)">
                <input type="date" className={inp} value={form.expires_at} onChange={e => setForm({...form, expires_at: e.target.value})} />
              </Field>
            </div>
            <Field label="Notes">
              <input className={inp} placeholder="Annual license..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </Field>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setShowForm(false)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm transition-colors`}>Cancel</button>
              <button type="submit" disabled={saving} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60`}>
                {saving ? 'Generating…' : '🔑 Generate Key'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {licenses.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><Key size={32} className="mx-auto mb-3 opacity-40" /><p>No licenses yet.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Key</th>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Payment</th>
                <th className="px-4 py-3 text-left">Next Due</th>
                <th className="px-4 py-3 text-left">Expires</th>
                <th className="px-4 py-3 text-center">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {licenses.map(lic => {
                const expired = lic.expires_at && new Date(lic.expires_at) < new Date()
                const overdue = lic.next_due_date && lic.next_due_date < today && lic.payment_status !== 'free'
                return (
                  <tr key={lic.id} className={`hover:bg-gray-700 transition-colors ${!lic.is_active ? 'opacity-50' : ''} ${overdue ? 'bg-red-950/30' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-purple-300 text-xs font-bold">{lic.license_key}</span>
                        <CopyBtn text={lic.license_key} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium text-xs">{lic.lodge_name || '—'}</p>
                      <p className="text-xs text-gray-500">{BIZ_EMOJI[lic.business_type]} {BIZ_LABEL[lic.business_type] || lic.business_type}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        lic.subscription_plan === 'Pro'      ? 'bg-purple-500/20 text-purple-300' :
                        lic.subscription_plan === 'Standard' ? 'bg-blue-500/20 text-blue-300' :
                        lic.subscription_plan === 'Starter'  ? 'bg-gray-500/20 text-gray-300' :
                        'bg-gray-600/20 text-gray-400'
                      }`}>{lic.subscription_plan || 'Starter'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        lic.payment_status === 'active' ? 'bg-green-500/20 text-green-300' :
                        lic.payment_status === 'overdue' ? 'bg-red-500/20 text-red-300' :
                        lic.payment_status === 'free' ? 'bg-blue-500/20 text-blue-300' :
                        'bg-gray-500/20 text-gray-400'}`}>
                        {lic.payment_status || 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lic.next_due_date ? (
                        <span className={overdue ? 'text-red-400 font-medium' : 'text-gray-300'}>{fmt(lic.next_due_date)}{overdue ? ' ⚠' : ''}</span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lic.expires_at ? <span className={expired ? 'text-red-400' : 'text-gray-300'}>{fmt(lic.expires_at)}{expired ? ' ✕' : ''}</span> : <span className="text-gray-600">None</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={async () => { await window.api.admin.updateLicense(lic.id, { is_active: !lic.is_active }); onRefresh() }}>
                        {lic.is_active ? <CheckCircle size={16} className="text-green-400 mx-auto" /> : <XCircle size={16} className="text-red-400 mx-auto" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openBilling(lic)} className="p-1 text-gray-400 hover:text-purple-400 transition-colors" title="Edit billing"><Edit3 size={13} /></button>
                        <button onClick={async () => { if (!confirm(`Delete ${lic.license_key}?`)) return; await window.api.admin.deleteLicense(lic.id); onRefresh() }} className="p-1 text-red-500 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {billingModal && (
        <Modal title={`Edit Billing — ${billingModal.lodge_name || billingModal.license_key}`} onClose={() => setBillingModal(null)} wide>
          <div className="space-y-4">
            {/* Tier selector */}
            <Field label="Subscription Plan">
              <div className="grid grid-cols-3 gap-2 mt-1">
                {TIERS.map(tier => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setBillingForm({...billingForm, subscription_plan: tier})}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      billingForm.subscription_plan === tier
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <p className="text-sm font-bold text-white">{tier}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-tight">{TIER_DESC[tier]}</p>
                  </button>
                ))}
              </div>
            </Field>

            {/* Feature preview for selected tier */}
            {TIER_FLAGS[billingForm.subscription_plan] && (
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">Features auto-applied with this plan</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_FEATURES.map(f => {
                    const on = TIER_FLAGS[billingForm.subscription_plan][f] !== false
                    return (
                      <span key={f} className={`text-xs px-2 py-0.5 rounded-full font-medium ${on ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-500 line-through'}`}>
                        {FEAT_LABEL[f]}
                      </span>
                    )
                  })}
                </div>
                {(!billingModal.lodge_id || billingModal.lodge_id === 'unassigned') && (
                  <p className="text-xs text-amber-400 mt-2">⚠ No lodge ID linked — flags won't be auto-applied. Set a lodge ID on the license first.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Monthly Fee">
                <input type="number" className={inp} value={billingForm.monthly_fee} onChange={e => setBillingForm({...billingForm, monthly_fee: e.target.value})} />
              </Field>
              <Field label="Currency">
                <input className={inp} value={billingForm.currency} onChange={e => setBillingForm({...billingForm, currency: e.target.value})} placeholder="USD" />
              </Field>
              <Field label="Payment Status">
                <select className={inp} value={billingForm.payment_status} onChange={e => setBillingForm({...billingForm, payment_status: e.target.value})}>
                  {['active', 'overdue', 'free', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Last Payment Date">
                <input type="date" className={inp} value={billingForm.last_payment_date} onChange={e => setBillingForm({...billingForm, last_payment_date: e.target.value})} />
              </Field>
              <Field label="Next Due Date" >
                <input type="date" className={inp} value={billingForm.next_due_date} onChange={e => setBillingForm({...billingForm, next_due_date: e.target.value})} />
              </Field>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setBillingModal(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button onClick={saveBilling} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium`}>Save & Apply Plan</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Feature Flags
// ════════════════════════════════════════════════════════════════════
function FeatureFlags({ companies }) {
  const [selectedLodge, setSelectedLodge] = useState(null)
  const [flags, setFlags] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadFlags = async (lodgeId) => {
    const data = await window.api.admin.getLodgeFeatures(lodgeId).catch(() => [])
    const map = {}
    ALL_FEATURES.forEach(f => map[f] = true) // default all enabled
    data.forEach(r => { map[r.feature_name] = r.enabled })
    setFlags(map)
  }

  const selectLodge = (c) => { setSelectedLodge(c); loadFlags(c.lodge_id); setSaved(false) }

  const toggle = (f) => setFlags(prev => ({ ...prev, [f]: !prev[f] }))

  const saveFlags = async () => {
    if (!selectedLodge) return
    setSaving(true)
    await Promise.all(ALL_FEATURES.map(f => window.api.admin.setLodgeFeature(selectedLodge.lodge_id, f, flags[f] !== false)))
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex gap-5">
      {/* Company list */}
      <div className="w-56 shrink-0 bg-gray-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-700">Select Company</p>
        <div className="divide-y divide-gray-700 max-h-[500px] overflow-y-auto">
          {companies.map(c => (
            <button
              key={c.lodge_id}
              onClick={() => selectLodge(c)}
              className={`w-full px-4 py-3 text-left text-sm transition-colors ${selectedLodge?.lodge_id === c.lodge_id ? 'bg-purple-600/20 text-purple-300' : 'text-gray-300 hover:bg-gray-700'}`}
            >
              <p className="font-medium truncate">{c.lodge_name || '—'}</p>
              <p className="text-xs text-gray-500">{BIZ_EMOJI[c.business_type]} {BIZ_LABEL[c.business_type]}</p>
            </button>
          ))}
          {companies.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No companies</p>}
        </div>
      </div>

      {/* Toggles */}
      <div className="flex-1">
        {!selectedLodge ? (
          <div className="bg-gray-800 rounded-xl p-12 text-center text-gray-500">
            <ToggleRight size={32} className="mx-auto mb-3 opacity-40" />
            <p>Select a company to manage its feature flags</p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">{selectedLodge.lodge_name}</h3>
                <p className="text-xs text-gray-400">Toggle individual modules, or apply a preset tier</p>
              </div>
              <button
                onClick={saveFlags}
                disabled={saving}
                className={`flex items-center gap-2 ${saved ? 'bg-green-600' : btn()} px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60`}
              >
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Flags'}
              </button>
            </div>
            {/* Quick tier preset buttons */}
            <div className="flex items-center gap-2 pb-1">
              <span className="text-xs text-gray-500">Quick apply:</span>
              {TIERS.map(tier => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setFlags({ ...flags, ...TIER_FLAGS[tier] })}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    tier === 'Pro'      ? 'border-purple-600 text-purple-300 hover:bg-purple-600/20' :
                    tier === 'Standard' ? 'border-blue-600 text-blue-300 hover:bg-blue-600/20' :
                    'border-gray-600 text-gray-400 hover:bg-gray-600/20'
                  }`}
                >
                  {tier}
                </button>
              ))}
              <span className="text-xs text-gray-600 ml-1">(then Save)</span>
            </div>
            <div className="space-y-3 pt-2">
              {ALL_FEATURES.map(f => (
                <div key={f} className="flex items-center justify-between py-3 border-b border-gray-700">
                  <div>
                    <p className="text-sm font-medium text-white">{FEAT_LABEL[f]}</p>
                    <p className="text-xs text-gray-500">Allow this lodge to access the {FEAT_LABEL[f]} module</p>
                  </div>
                  <button
                    onClick={() => toggle(f)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${flags[f] !== false ? 'bg-purple-600' : 'bg-gray-600'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${flags[f] !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Broadcasts
// ════════════════════════════════════════════════════════════════════
function Broadcasts() {
  const [broadcasts, setBroadcasts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', expires_at: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const data = await window.api.admin.getBroadcasts().catch(() => [])
    setBroadcasts(data)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    await window.api.admin.createBroadcast({ ...form, expires_at: form.expires_at || null }).catch(() => {})
    setForm({ title: '', message: '', expires_at: '' }); setShowForm(false); setSaving(false); load()
  }

  const toggle = async (b) => { await window.api.admin.updateBroadcast(b.id, { is_active: !b.is_active }); load() }
  const del = async (b) => { if (!confirm('Delete broadcast?')) return; await window.api.admin.deleteBroadcast(b.id); load() }

  const isActive = (b) => b.is_active && (!b.expires_at || new Date(b.expires_at) > new Date())

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-gray-400 text-sm">Announcements shown as banners to all lodge users</p>
        <button onClick={() => setShowForm(true)} className={`flex items-center gap-2 ${btn()} px-4 py-2 rounded-lg text-sm font-medium`}>
          <Plus size={15} /> New Announcement
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Title *">
              <input className={inp} placeholder="System maintenance tonight…" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            </Field>
            <Field label="Message *">
              <textarea className={`${inp} h-20 resize-none`} placeholder="Details of the announcement…" value={form.message} onChange={e => setForm({...form, message: e.target.value})} required />
            </Field>
            <Field label="Expires At (optional — leave blank for permanent)">
              <input type="datetime-local" className={inp} value={form.expires_at} onChange={e => setForm({...form, expires_at: e.target.value})} />
            </Field>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button type="submit" disabled={saving} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium disabled:opacity-60`}>{saving ? 'Posting…' : 'Post Announcement'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {broadcasts.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><Megaphone size={32} className="mx-auto mb-3 opacity-40" /><p>No announcements yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-700">
            {broadcasts.map(b => {
              const active = isActive(b)
              return (
                <div key={b.id} className={`px-5 py-4 flex items-start gap-4 ${!active ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-white text-sm">{b.title}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${active ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-500'}`}>
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-2">{b.message}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      Posted {fmt(b.created_at)}{b.expires_at ? ` · Expires ${fmt(b.expires_at)}` : ' · No expiry'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggle(b)} className="p-1.5 text-gray-400 hover:text-white" title={active ? 'Deactivate' : 'Activate'}>
                      {active ? <XCircle size={16} /> : <CheckCircle size={16} />}
                    </button>
                    <button onClick={() => del(b)} className="p-1.5 text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Support Tickets
// ════════════════════════════════════════════════════════════════════
function SupportTickets({ companies }) {
  const [tickets, setTickets] = useState([])
  const [filter, setFilter] = useState({ status: '', priority: '', q: '' })
  const [detail, setDetail] = useState(null)
  const [notes, setNotes] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const data = await window.api.admin.getSupportTickets({}).catch(() => [])
    setTickets(data)
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = (t) => { setDetail(t); setNotes(t.admin_notes || ''); setNewStatus(t.status) }

  const updateTicket = async () => {
    setSaving(true)
    await window.api.admin.updateSupportTicket(detail.id, { status: newStatus, admin_notes: notes }).catch(() => {})
    setSaving(false); setDetail(null); load()
  }

  const del = async (t) => { if (!confirm('Delete ticket?')) return; await window.api.admin.deleteSupportTicket(t.id); load() }

  const filtered = tickets.filter(t => {
    if (filter.status && t.status !== filter.status) return false
    if (filter.priority && t.priority !== filter.priority) return false
    if (filter.q && !t.title.toLowerCase().includes(filter.q.toLowerCase()) && !(t.lodge_name || '').toLowerCase().includes(filter.q.toLowerCase())) return false
    return true
  })

  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-gray-400 text-sm">Support tickets from lodges</p>
          {openCount > 0 && <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{openCount} open</span>}
        </div>
        <div className="flex items-center gap-2">
          <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 w-48" placeholder="Search…" value={filter.q} onChange={e => setFilter({...filter, q: e.target.value})} />
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.status} onChange={e => setFilter({...filter, status: e.target.value})}>
            <option value="">All Status</option>
            {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.priority} onChange={e => setFilter({...filter, priority: e.target.value})}>
            <option value="">All Priority</option>
            {['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><LifeBuoy size={32} className="mx-auto mb-3 opacity-40" /><p>No tickets found.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Lodge</th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-700 transition-colors cursor-pointer" onClick={() => openDetail(t)}>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.lodge_name || t.lodge_id?.slice(0,8)}</td>
                  <td className="px-4 py-3 font-medium text-white">{t.title}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{t.category}</td>
                  <td className={`px-4 py-3 text-xs font-semibold ${PRIORITY_COLOR[t.priority] || 'text-gray-400'}`}>{t.priority}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[t.status] || 'bg-gray-500/20 text-gray-400'}`}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(t.created_at)}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={e => { e.stopPropagation(); del(t) }} className="p-1 text-red-500 hover:text-red-400"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded">{detail.category}</span>
              <span className={`px-2 py-1 rounded font-semibold ${PRIORITY_COLOR[detail.priority]}`}>{detail.priority} priority</span>
              <span className={`px-2 py-1 rounded ${STATUS_COLOR[detail.status]}`}>{detail.status}</span>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Lodge: {detail.lodge_name || detail.lodge_id}</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{detail.description}</p>
            </div>
            <Field label="Update Status">
              <select className={inp} value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Admin Notes">
              <textarea className={`${inp} h-24 resize-none`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes…" />
            </Field>
            <div className="flex gap-3">
              <button onClick={() => setDetail(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button onClick={updateTicket} disabled={saving} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium disabled:opacity-60`}>{saving ? 'Saving…' : 'Save Update'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Activity Log
// ════════════════════════════════════════════════════════════════════
function ActivityLog({ companies }) {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState({ lodge_id: '', start: '', end: '' })
  const [limit, setLimit] = useState(100)

  const load = useCallback(async () => {
    const data = await window.api.admin.getActivityLogs({ ...filter, limit }).catch(() => [])
    setLogs(data)
  }, [filter, limit])

  useEffect(() => { load() }, [load])

  const ACTION_ICON = { user_login: '👤', booking_created: '📅', expense_added: '💸', maintenance_raised: '🔧' }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none"
          value={filter.lodge_id}
          onChange={e => setFilter({...filter, lodge_id: e.target.value})}
        >
          <option value="">All Lodges</option>
          {companies.map(c => <option key={c.lodge_id} value={c.lodge_id}>{c.lodge_name || c.lodge_id?.slice(0,8)}</option>)}
        </select>
        <input type="date" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.start} onChange={e => setFilter({...filter, start: e.target.value})} />
        <span className="text-gray-600 text-sm">to</span>
        <input type="date" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.end} onChange={e => setFilter({...filter, end: e.target.value})} />
        <button onClick={() => setFilter({ lodge_id: '', start: '', end: '' })} className="text-xs text-gray-500 hover:text-gray-300">Reset</button>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {logs.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><Activity size={32} className="mx-auto mb-3 opacity-40" /><p>No activity logged yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-700">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 px-5 py-3">
                <span className="text-base mt-0.5">{ACTION_ICON[log.action] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-200">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500 shrink-0 ml-3">{timeAgo(log.created_at)}</p>
                  </div>
                  <p className="text-xs text-gray-500">{log.lodge_name || log.lodge_id?.slice(0, 16)}</p>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{JSON.stringify(log.details).slice(0, 80)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {logs.length >= limit && (
        <button onClick={() => setLimit(l => l + 100)} className="w-full py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-xl transition-colors">
          Load more…
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Email / Notification Settings
// ════════════════════════════════════════════════════════════════════
const EMPTY_CONFIG = { host: '', port: '587', user: '', pass: '', from: '', to: '' }

function EmailSettings() {
  const [config, setConfig] = useState(EMPTY_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState(null) // { ok: bool, msg: string }

  useEffect(() => {
    window.api.email.getConfig().then(c => {
      if (c) setConfig(c)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500'
  const set = (k, v) => setConfig(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setSaving(true); setStatus(null)
    const r = await window.api.email.saveConfig(config).catch(() => ({ success: false, error: 'Unknown error' }))
    setStatus(r.success ? { ok: true, msg: 'Settings saved!' } : { ok: false, msg: r.error || 'Save failed.' })
    setSaving(false)
  }

  const test = async () => {
    setTesting(true); setStatus(null)
    const r = await window.api.email.test(config).catch(() => ({ success: false, error: 'Unknown error' }))
    setStatus(r.success
      ? { ok: true, msg: 'Test email sent! Check your inbox.' }
      : { ok: false, msg: r.error || 'Test failed. Check your SMTP settings.' })
    setTesting(false)
  }

  if (!loaded) return <div className="text-gray-400 text-sm p-4">Loading…</div>

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-purple-700 flex items-center justify-center">
          <Mail size={18} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Email Notifications</h2>
          <p className="text-xs text-gray-400">Receive alerts for support tickets & upgrade requests</p>
        </div>
      </div>

      <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-5 space-y-4">
        {/* SMTP Server */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">SMTP Server</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Host</label>
              <input className={inp} placeholder="smtp.gmail.com" value={config.host} onChange={e => set('host', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Port</label>
              <input className={inp} placeholder="587" value={config.port} onChange={e => set('port', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Auth */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">Authentication</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Email / Username</label>
              <input className={inp} placeholder="you@gmail.com" value={config.user} onChange={e => set('user', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Password / App Password</label>
              <div className="relative">
                <input
                  className={`${inp} pr-9`}
                  type={showPass ? 'text' : 'password'}
                  placeholder="App password or SMTP password"
                  value={config.pass}
                  onChange={e => set('pass', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">For Gmail, use a 16-character App Password (not your account password).</p>
            </div>
          </div>
        </div>

        {/* From / To */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">Routing</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">From Name / Address</label>
              <input className={inp} placeholder='"Boroko Command Central" <you@gmail.com>' value={config.from} onChange={e => set('from', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Send Notifications To</label>
              <input className={inp} placeholder="admin@youremail.com" value={config.to} onChange={e => set('to', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            status.ok ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
          }`}>
            {status.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {status.msg}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button
            onClick={test}
            disabled={testing}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
          >
            <Send size={14} />
            {testing ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="mt-4 bg-blue-900/20 border border-blue-700/30 rounded-xl p-4">
        <p className="text-xs text-blue-300 font-semibold mb-2">When will emails be sent?</p>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>📩 Whenever a lodge submits a <strong className="text-gray-300">Help / Support ticket</strong></li>
          <li>🆙 Whenever a lodge requests an <strong className="text-gray-300">subscription upgrade</strong></li>
        </ul>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MAIN: AdminCentral
// ════════════════════════════════════════════════════════════════════
const NAV_ITEMS = [
  { id: 'dashboard',     label: 'Dashboard',         icon: LayoutDashboard },
  { id: 'companies',     label: 'Companies',          icon: Building2 },
  { id: 'billing',       label: 'Licenses & Billing', icon: CreditCard },
  { id: 'flags',         label: 'Feature Flags',      icon: ToggleRight },
  { id: 'broadcasts',    label: 'Broadcasts',         icon: Megaphone },
  { id: 'tickets',       label: 'Support Tickets',    icon: LifeBuoy },
  { id: 'activity',      label: 'Activity Log',       icon: Activity },
  { id: 'notifications', label: 'Email Alerts',       icon: Mail },
]

export default function AdminCentral() {
  const { logout } = useAuth()
  const [section, setSection] = useState('dashboard')
  const [companies, setCompanies] = useState([])
  const [licenses, setLicenses] = useState([])
  const [tickets, setTickets] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [c, l, t, a] = await Promise.all([
      window.api.admin.getCompanies().catch(() => []),
      window.api.admin.getLicenses().catch(() => []),
      window.api.admin.getSupportTickets({}).catch(() => []),
      window.api.admin.getActivityLogs({ limit: 200 }).catch(() => [])
    ])
    setCompanies(c); setLicenses(l); setTickets(t); setActivityLogs(a)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const openTickets  = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const upgradeCount = tickets.filter(t => t.category === 'Upgrade Request' && (t.status === 'open' || t.status === 'in_progress')).length

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
            <Shield size={16} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">Command Central</h1>
            <p className="text-xs text-gray-400">Master Admin Console</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="flex items-center gap-2 text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={logout} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col py-4 gap-1 px-2">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            // Badge logic: support ticket count (orange) + upgrade request count (purple)
            const ticketBadge  = id === 'tickets' && openTickets > 0 ? openTickets : null
            const upgradeBadge = id === 'tickets' && upgradeCount > 0 ? upgradeCount : null
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors w-full text-left ${
                  section === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {upgradeBadge && (
                  <span className="bg-purple-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${upgradeBadge} upgrade request(s)`}>
                    🆙{upgradeBadge}
                  </span>
                )}
                {ticketBadge && !upgradeBadge && (
                  <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{ticketBadge}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          {section === 'dashboard'     && <Dashboard companies={companies} licenses={licenses} tickets={tickets} activityLogs={activityLogs} />}
          {section === 'companies'     && <Companies companies={companies} loading={loading} />}
          {section === 'billing'       && <LicenseBilling licenses={licenses} onRefresh={loadAll} />}
          {section === 'flags'         && <FeatureFlags companies={companies} />}
          {section === 'broadcasts'    && <Broadcasts />}
          {section === 'tickets'       && <SupportTickets companies={companies} />}
          {section === 'activity'      && <ActivityLog companies={companies} />}
          {section === 'notifications' && <EmailSettings />}
        </div>
      </div>
    </div>
  )
}
