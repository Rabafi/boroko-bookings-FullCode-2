import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../App'
import {
  LayoutDashboard, Building2, CreditCard, ToggleRight, Megaphone,
  LifeBuoy, Activity, LogOut, Shield, RefreshCw, Plus, Trash2,
  Copy, CheckCircle, XCircle, Key, ChevronRight, X, AlertTriangle,
  Clock, TrendingUp, Users, Home, Wrench, DollarSign, Edit3,
  Mail, Send, CheckCircle2, Eye, EyeOff, Receipt, FileText,
  BarChart3, Filter
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
const TIERS = ['Basic', 'Standard', 'Premium']
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

// ── Trial status helper ───────────────────────────────────────────────────────
function getTrialInfo(company, licenses) {
  const hasLicense = licenses.some(l => l.lodge_id === company.lodge_id && l.is_active)
  if (hasLicense) return { label: 'Licensed', color: 'bg-green-500/20 text-green-300' }
  if (!company.trial_started_at) return { label: 'In Trial', color: 'bg-blue-500/20 text-blue-300' }
  const trialEnd = new Date(company.trial_started_at)
  trialEnd.setDate(trialEnd.getDate() + 3)
  const daysLeft = Math.ceil((trialEnd - new Date()) / 864e5)
  if (daysLeft > 0) return { label: `Trial: ${daysLeft}d left`, color: daysLeft === 1 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300' }
  return { label: 'Trial Expired', color: 'bg-red-500/20 text-red-400' }
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Dashboard
// ════════════════════════════════════════════════════════════════════
function Dashboard({ companies, licenses, tickets, activityLogs }) {
  const today = new Date().toISOString().split('T')[0]
  const active = licenses.filter(l => l.is_active).length
  const expiring = licenses.filter(l => l.expires_at && l.is_active && new Date(l.expires_at) > new Date() && (new Date(l.expires_at) - new Date()) < 30 * 864e5).length
  const overdue = licenses.filter(l => l.next_due_date && l.next_due_date < today && l.payment_status !== 'free' && l.is_active).length
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const trialsExpired = companies.filter(c => getTrialInfo(c, licenses).label === 'Trial Expired').length
  const trialsActive = companies.filter(c => getTrialInfo(c, licenses).label.startsWith('Trial:')).length
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
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        <StatCard label="Registered Companies" value={companies.length} color="text-white" />
        <StatCard label="Active Licenses" value={active} color="text-green-400" />
        <StatCard label="In Trial" value={trialsActive} color={trialsActive > 0 ? 'text-blue-400' : 'text-gray-500'} />
        <StatCard label="Trial Expired" value={trialsExpired} color={trialsExpired > 0 ? 'text-red-400' : 'text-gray-500'} />
        <StatCard label="Expiring (30 days)" value={expiring} color={expiring > 0 ? 'text-yellow-400' : 'text-gray-500'} />
        <StatCard label="Overdue Payments" value={overdue} color={overdue > 0 ? 'text-red-400' : 'text-gray-500'} />
        <StatCard label="Open Tickets" value={openTickets} color={openTickets > 0 ? 'text-orange-400' : 'text-gray-500'} />
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
function Companies({ companies, licenses, loading }) {
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
                <th className="px-4 py-3 text-left">Status</th>
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
                    {(() => { const t = getTrialInfo(c, licenses); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span> })()}
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
const INVOICE_CURRENCIES = ['USD', 'BWP', 'ZAR', 'EUR', 'GBP', 'N$', 'ZK']

function LicenseBilling({ licenses, companies, onRefresh }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '' })
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState(null) // '3d'|'7d'|'paid'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invoiceForm, setInvoiceForm] = useState({ package_name: 'Basic', amount: '', currency: 'BWP', paid_date: new Date().toISOString().split('T')[0], description: '' })
  const [billingModal, setBillingModal] = useState(null) // license to edit billing
  const [billingForm, setBillingForm] = useState({})
  const [emailStatus, setEmailStatus] = useState({}) // { [licenseId]: 'sending'|'sent'|'error' }
  const requiresInvoice = selectedPeriod && selectedPeriod !== '3d' && selectedPeriod !== '7d'

  const today = new Date().toISOString().split('T')[0]

  const sendEmail = async (lic) => {
    const company = companies.find(c => c.lodge_id === lic.lodge_id)
    const to = company?.email
    setEmailStatus(s => ({ ...s, [lic.id]: 'sending' }))
    try {
      const r = await window.api.email.sendLicense({
        to,
        licenseKey: lic.license_key,
        lodgeName: lic.lodge_name,
        plan: lic.subscription_plan,
        expiresAt: lic.expires_at,
        lodgeId: lic.lodge_id,
        notes: lic.notes
      })
      setEmailStatus(s => ({ ...s, [lic.id]: r.success ? 'sent' : 'error' }))
      if (!r.success) {
        alert(`Email failed: ${r.error}`)
      }
    } catch (e) {
      setEmailStatus(s => ({ ...s, [lic.id]: 'error' }))
      alert(`Email error: ${e.message}`)
    }
    setTimeout(() => setEmailStatus(s => { const n = { ...s }; delete n[lic.id]; return n }), 4000)
  }

  const handleCreate = async (e) => {
    e.preventDefault(); setError(''); setSaving(true)
    if (requiresInvoice && (!invoiceForm.amount || isNaN(Number(invoiceForm.amount)) || Number(invoiceForm.amount) <= 0)) {
      setError('Please enter a valid amount for this paid license.')
      setSaving(false); return
    }
    const companyLodgeId = form.lodge_id // keep for email + display; DB always gets 'unassigned'
    const r = await window.api.admin.createLicense({ ...form, lodge_id: 'unassigned', expires_at: form.expires_at || null, notes: form.notes || null }).catch(e => ({ error: e.message }))
    if (r?.license_key) {
      let invoice = null
      if (requiresInvoice) {
        const invNum = await window.api.admin.getNextInvoiceNumber().catch(() => null)
        if (typeof invNum === 'string') {
          invoice = await window.api.admin.createInvoice({
            invoice_number: invNum,
            lodge_id: companyLodgeId,
            lodge_name: form.lodge_name,
            license_id: r.id || null,
            package_name: invoiceForm.package_name,
            amount: Number(invoiceForm.amount),
            currency: invoiceForm.currency,
            status: 'paid',
            issued_date: invoiceForm.paid_date,
            paid_date: invoiceForm.paid_date,
            description: invoiceForm.description || null
          }).catch(() => null)
        }
      }
      setShowForm(false)
      setForm({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '' })
      setSelectedCompany('')
      setSelectedPeriod(null)
      setInvoiceForm({ package_name: 'Basic', amount: '', currency: 'BWP', paid_date: new Date().toISOString().split('T')[0], description: '' })
      onRefresh()
      // Auto-send email if company has a registered email
      const company = companies.find(c => c.lodge_id === companyLodgeId)
      if (company?.email) {
        const emailPayload = {
          to: company.email,
          licenseKey: r.license_key,
          lodgeName: form.lodge_name,
          plan: invoice?.package_name || null,
          expiresAt: form.expires_at || null,
          lodgeId: companyLodgeId,
          notes: form.notes || null,
          invoice: invoice || null
        }
        window.api.email.sendLicense(emailPayload).then(res => {
          if (!res.success) console.warn('[Email] License email failed:', res.error)
        })
      }
    } else setError(r?.error || 'Failed')
    setSaving(false)
  }

  const openBilling = (lic) => {
    setBillingModal(lic)
    setBillingForm({
      subscription_plan: TIERS.includes(lic.subscription_plan) ? lic.subscription_plan : 'Starter',
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
            <div className="space-y-4">
              <Field label="Company *">
                <select
                  className={inp}
                  value={selectedCompany}
                  onChange={e => {
                    const lodgeId = e.target.value
                    setSelectedCompany(lodgeId)
                    if (lodgeId) {
                      const c = companies.find(c => c.lodge_id === lodgeId)
                      if (c) setForm(f => ({ ...f, lodge_id: c.lodge_id, lodge_name: c.lodge_name || c.company_name || '', business_type: c.business_type || 'lodge' }))
                    } else {
                      setForm(f => ({ ...f, lodge_id: '', lodge_name: '', business_type: 'lodge' }))
                    }
                  }}
                  required
                >
                  <option value="">— Select a company —</option>
                  {[...(companies || [])].sort((a, b) => (a.lodge_name || '').localeCompare(b.lodge_name || '')).map(c => (
                    <option key={c.lodge_id} value={c.lodge_id}>{c.lodge_name || c.company_name || c.lodge_id}</option>
                  ))}
                </select>
              </Field>
              {selectedCompany && (
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 font-mono">
                  ID: {form.lodge_id}
                </div>
              )}
              <Field label="License Period">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '3 Days',   days: 3,  periodId: '3d' },
                      { label: '7 Days',   days: 7,  periodId: '7d' },
                      { label: '1 Month',  months: 1, periodId: 'paid' },
                      { label: '3 Months', months: 3, periodId: 'paid' },
                      { label: '6 Months', months: 6, periodId: 'paid' },
                      { label: '1 Year',   years: 1,  periodId: 'paid' },
                      { label: '2 Years',  years: 2,  periodId: 'paid' },
                    ].map(({ label, days, months, years, periodId }) => {
                      const getDate = () => {
                        const d = new Date()
                        if (days)   d.setDate(d.getDate() + days)
                        if (months) d.setMonth(d.getMonth() + months)
                        if (years)  d.setFullYear(d.getFullYear() + years)
                        return d.toISOString().split('T')[0]
                      }
                      const val = getDate()
                      const active = form.expires_at === val
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            const newVal = active ? '' : val
                            setForm({ ...form, expires_at: newVal })
                            setSelectedPeriod(newVal ? periodId : null)
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            active
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-purple-500 hover:text-purple-300'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    type="date"
                    className={`${inp} text-xs`}
                    value={form.expires_at}
                    onChange={e => {
                      setForm({ ...form, expires_at: e.target.value })
                      setSelectedPeriod(e.target.value ? 'paid' : null)
                    }}
                    placeholder="Or pick a custom date"
                  />
                  {form.expires_at && (
                    <p className="text-xs text-gray-500">
                      Expires: {new Date(form.expires_at + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      {' · '}
                      <button type="button" onClick={() => { setForm({ ...form, expires_at: '' }); setSelectedPeriod(null) }} className="text-red-400 hover:text-red-300">clear</button>
                    </p>
                  )}
                </div>
              </Field>

              {/* Invoice fields — required for paid periods (not 3-day or 7-day) */}
              {requiresInvoice && (
                <div className="border border-yellow-600/40 bg-yellow-900/10 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5"><Receipt size={13} /> Invoice Required for Paid License</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Package *">
                      <select className={inp} value={invoiceForm.package_name} onChange={e => setInvoiceForm({ ...invoiceForm, package_name: e.target.value })} required={requiresInvoice}>
                        {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Payment Date *">
                      <input type="date" className={inp} value={invoiceForm.paid_date} onChange={e => setInvoiceForm({ ...invoiceForm, paid_date: e.target.value })} required={requiresInvoice} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount Paid *">
                      <input type="number" step="0.01" min="0.01" className={inp} placeholder="0.00" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} required={requiresInvoice} />
                    </Field>
                    <Field label="Currency">
                      <select className={inp} value={invoiceForm.currency} onChange={e => setInvoiceForm({ ...invoiceForm, currency: e.target.value })}>
                        {INVOICE_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description (optional)">
                    <input className={inp} placeholder="e.g. Annual subscription payment" value={invoiceForm.description} onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
            <Field label="Notes">
              <input className={inp} placeholder="Annual license..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </Field>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setShowForm(false); setSelectedCompany(''); setSelectedPeriod(null); setInvoiceForm({ package_name: 'Basic', amount: '', currency: 'BWP', paid_date: new Date().toISOString().split('T')[0], description: '' }) }} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm transition-colors`}>Cancel</button>
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
                        {(() => {
                          const st = emailStatus[lic.id]
                          const company = companies.find(c => c.lodge_id === lic.lodge_id)
                          if (!company?.email) return null
                          return (
                            <button
                              onClick={() => sendEmail(lic)}
                              disabled={st === 'sending'}
                              title={st === 'sent' ? 'Email sent!' : st === 'error' ? 'Email failed' : `Send key to ${company.email}`}
                              className={`p-1 transition-colors ${
                                st === 'sent' ? 'text-green-400' :
                                st === 'error' ? 'text-red-400' :
                                'text-gray-400 hover:text-blue-400'
                              }`}
                            >
                              {st === 'sent' ? <CheckCircle2 size={13} /> : <Send size={13} className={st === 'sending' ? 'animate-pulse' : ''} />}
                            </button>
                          )
                        })()}
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
// SECTION: Bookkeeping
// ════════════════════════════════════════════════════════════════════
const STATUS_COLORS = {
  paid:      'bg-green-800 text-green-200',
  draft:     'bg-gray-700 text-gray-300',
  sent:      'bg-blue-800 text-blue-200',
  overdue:   'bg-red-800 text-red-200',
  cancelled: 'bg-gray-700 text-gray-400'
}

function Bookkeeping({ companies }) {
  const [subTab, setSubTab] = useState('invoices')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  const [filterLodge, setFilterLodge] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editInvoice, setEditInvoice] = useState(null)
  const [sendingEmail, setSendingEmail] = useState({})
  const [emailSent, setEmailSent] = useState({})
  const [createForm, setCreateForm] = useState({
    lodge_id: '', lodge_name: '', package_name: 'Basic', amount: '', currency: 'BWP',
    status: 'paid', issued_date: new Date().toISOString().split('T')[0],
    due_date: '', paid_date: new Date().toISOString().split('T')[0], description: '', notes: ''
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    const [invs, sum] = await Promise.all([
      window.api.admin.getInvoices({}).catch(() => []),
      window.api.admin.getInvoiceSummary().catch(() => null)
    ])
    setInvoices(invs)
    setSummary(sum)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = invoices.filter(inv => {
    if (filterLodge && inv.lodge_id !== filterLodge) return false
    if (filterStatus && inv.status !== filterStatus) return false
    return true
  })

  const handleCreateInvoice = async (e) => {
    e.preventDefault(); setCreateError(''); setCreateSaving(true)
    if (!createForm.amount || Number(createForm.amount) <= 0) { setCreateError('Enter a valid amount.'); setCreateSaving(false); return }
    const invNum = await window.api.admin.getNextInvoiceNumber().catch(() => null)
    if (!invNum || typeof invNum !== 'string') { setCreateError('Could not generate invoice number.'); setCreateSaving(false); return }
    const r = await window.api.admin.createInvoice({ ...createForm, invoice_number: invNum, amount: Number(createForm.amount), due_date: createForm.due_date || null, paid_date: createForm.paid_date || null, description: createForm.description || null, notes: createForm.notes || null }).catch(e => ({ error: e.message }))
    if (r?.error) { setCreateError(r.error); setCreateSaving(false); return }
    setShowCreate(false)
    setCreateForm({ lodge_id: '', lodge_name: '', package_name: 'Basic', amount: '', currency: 'BWP', status: 'paid', issued_date: new Date().toISOString().split('T')[0], due_date: '', paid_date: new Date().toISOString().split('T')[0], description: '', notes: '' })
    loadData()
    setCreateSaving(false)
  }

  const handleSaveEdit = async () => {
    if (!editInvoice) return
    await window.api.admin.updateInvoice(editInvoice.id, {
      package_name: editInvoice.package_name, amount: Number(editInvoice.amount),
      currency: editInvoice.currency, status: editInvoice.status,
      paid_date: editInvoice.paid_date || null, due_date: editInvoice.due_date || null,
      description: editInvoice.description || null, notes: editInvoice.notes || null
    }).catch(() => {})
    setEditInvoice(null); loadData()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this invoice?')) return
    await window.api.admin.deleteInvoice(id).catch(() => {})
    loadData()
  }

  const handleSendEmail = async (inv) => {
    const company = companies.find(c => c.lodge_id === inv.lodge_id)
    const to = company?.email
    if (!to) { alert('No email address found for this company.'); return }
    setSendingEmail(s => ({ ...s, [inv.id]: true }))
    const r = await window.api.admin.sendInvoiceEmail({ to, invoice: inv, lodgeName: inv.lodge_name }).catch(e => ({ success: false, error: e.message }))
    setSendingEmail(s => ({ ...s, [inv.id]: false }))
    if (r.success) {
      setEmailSent(s => ({ ...s, [inv.id]: true }))
      setTimeout(() => setEmailSent(s => { const n = { ...s }; delete n[inv.id]; return n }), 4000)
      if (inv.status === 'draft') {
        await window.api.admin.updateInvoice(inv.id, { status: 'sent' }).catch(() => {})
        loadData()
      }
    } else alert(`Email failed: ${r.error}`)
  }

  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthTotal = summary?.byMonth?.find(m => m.month === thisMonth)?.amount || 0
  const pendingCount = invoices.filter(i => ['draft', 'sent', 'overdue'].includes(i.status)).length

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
        {[{ id: 'invoices', label: 'Invoices', icon: FileText }, { id: 'reports', label: 'Reports', icon: BarChart3 }].map(t => (
          <button key={t.id} type="button" onClick={() => setSubTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${subTab === t.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── INVOICES SUB-TAB ── */}
      {subTab === 'invoices' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select className={`${inp} text-xs flex-1 min-w-32`} value={filterLodge} onChange={e => setFilterLodge(e.target.value)}>
              <option value="">All Companies</option>
              {[...(companies || [])].sort((a, b) => (a.lodge_name || '').localeCompare(b.lodge_name || '')).map(c => (
                <option key={c.lodge_id} value={c.lodge_id}>{c.lodge_name || c.company_name || c.lodge_id}</option>
              ))}
            </select>
            <select className={`${inp} text-xs flex-1 min-w-28`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {['draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <button onClick={() => setShowCreate(v => !v)} className={`flex items-center gap-1.5 ${btn()} px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap`}>
              <Plus size={13} /> New Invoice
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><FileText size={14} className="text-purple-400" /> New Invoice</h3>
              <form onSubmit={handleCreateInvoice} className="space-y-3">
                {createError && <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-xs">{createError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Company *">
                    <select className={inp} value={createForm.lodge_id} onChange={e => {
                      const c = companies.find(c => c.lodge_id === e.target.value)
                      setCreateForm(f => ({ ...f, lodge_id: e.target.value, lodge_name: c?.lodge_name || c?.company_name || '' }))
                    }} required>
                      <option value="">— Select —</option>
                      {[...(companies || [])].sort((a, b) => (a.lodge_name || '').localeCompare(b.lodge_name || '')).map(c => (
                        <option key={c.lodge_id} value={c.lodge_id}>{c.lodge_name || c.company_name || c.lodge_id}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Package *">
                    <select className={inp} value={createForm.package_name} onChange={e => setCreateForm(f => ({ ...f, package_name: e.target.value }))} required>
                      {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Amount *">
                    <input type="number" step="0.01" min="0.01" className={inp} value={createForm.amount} onChange={e => setCreateForm(f => ({ ...f, amount: e.target.value }))} required placeholder="0.00" />
                  </Field>
                  <Field label="Currency">
                    <select className={inp} value={createForm.currency} onChange={e => setCreateForm(f => ({ ...f, currency: e.target.value }))}>
                      {INVOICE_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className={inp} value={createForm.status} onChange={e => setCreateForm(f => ({ ...f, status: e.target.value }))}>
                      {['draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </Field>
                  <Field label="Issued Date *">
                    <input type="date" className={inp} value={createForm.issued_date} onChange={e => setCreateForm(f => ({ ...f, issued_date: e.target.value }))} required />
                  </Field>
                  <Field label="Due Date">
                    <input type="date" className={inp} value={createForm.due_date} onChange={e => setCreateForm(f => ({ ...f, due_date: e.target.value }))} />
                  </Field>
                  <Field label="Payment Date">
                    <input type="date" className={inp} value={createForm.paid_date} onChange={e => setCreateForm(f => ({ ...f, paid_date: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Description">
                  <input className={inp} placeholder="e.g. Annual subscription" value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} />
                </Field>
                <Field label="Notes">
                  <input className={inp} placeholder="Internal notes…" value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowCreate(false)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
                  <button type="submit" disabled={createSaving} className={`flex-1 ${btn()} py-2 rounded-lg text-sm disabled:opacity-60`}>{createSaving ? 'Saving…' : 'Create Invoice'}</button>
                </div>
              </form>
            </div>
          )}

          {/* Invoice table */}
          <div className="bg-gray-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500 text-sm">Loading invoices…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500"><Receipt size={28} className="mx-auto mb-2 opacity-40" /><p className="text-sm">No invoices found.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="px-4 py-3 text-left font-medium">Invoice #</th>
                    <th className="px-4 py-3 text-left font-medium">Company</th>
                    <th className="px-4 py-3 text-left font-medium">Package</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv, i) => (
                    <tr key={inv.id} className={`border-t border-gray-700 hover:bg-gray-750 transition-colors ${i % 2 === 1 ? 'bg-gray-800/60' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs text-purple-300">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-200 text-xs max-w-32 truncate">{inv.lodge_name || inv.lodge_id}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{inv.package_name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white text-xs">{inv.currency} {Number(inv.amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[inv.status] || 'bg-gray-700 text-gray-300'}`}>{inv.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmt(inv.issued_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button title="Send email" onClick={() => handleSendEmail(inv)} disabled={sendingEmail[inv.id]}
                            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50">
                            {emailSent[inv.id] ? <CheckCircle2 size={14} className="text-green-400" /> : sendingEmail[inv.id] ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
                          </button>
                          <button title="Edit" onClick={() => setEditInvoice({ ...inv })}
                            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-purple-400 transition-colors">
                            <Edit3 size={14} />
                          </button>
                          <button title="Delete" onClick={() => handleDelete(inv.id)}
                            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── REPORTS SUB-TAB ── */}
      {subTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-gray-400 text-sm">Revenue from paid invoices</p>
            <button onClick={() => window.print()} className={`flex items-center gap-2 ${btn()} px-4 py-2 rounded-lg text-sm font-medium transition-colors print:hidden`}>
              <FileText size={14} /> Export as PDF
            </button>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 print:grid-cols-4">
            {[
              { label: 'Total Revenue', value: summary ? `${summary.currency} ${Number(summary.total).toFixed(2)}` : '—', color: 'text-green-400' },
              { label: 'This Month', value: summary ? `${summary.currency} ${Number(thisMonthTotal).toFixed(2)}` : '—', color: 'text-blue-400' },
              { label: 'Paid Invoices', value: invoices.filter(i => i.status === 'paid').length, color: 'text-green-400' },
              { label: 'Pending', value: pendingCount, color: pendingCount > 0 ? 'text-yellow-400' : 'text-gray-400' }
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-800 rounded-xl p-4 print:border print:border-gray-300 print:bg-white">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Revenue by Plan */}
          <div className="bg-gray-800 rounded-xl overflow-hidden print:border print:border-gray-300">
            <div className="px-4 py-3 border-b border-gray-700 print:border-gray-300">
              <p className="text-sm font-semibold text-white">Revenue by Plan</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700 print:border-gray-300">
                  <th className="px-4 py-2 text-left font-medium">Plan</th>
                  <th className="px-4 py-2 text-right font-medium">Revenue</th>
                  <th className="px-4 py-2 text-right font-medium">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map(plan => {
                  const planTotal = summary?.byPlan?.[plan] || 0
                  const planCount = invoices.filter(i => i.package_name === plan && i.status === 'paid').length
                  return (
                    <tr key={plan} className="border-t border-gray-700 print:border-gray-300">
                      <td className="px-4 py-3 text-gray-200 font-medium">{plan}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{summary?.currency || 'USD'} {Number(planTotal).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{planCount}</td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-gray-600 print:border-gray-400 bg-gray-700/50 print:bg-gray-50">
                  <td className="px-4 py-3 text-white font-bold">Total</td>
                  <td className="px-4 py-3 text-right text-green-400 font-bold">{summary?.currency || 'USD'} {Number(summary?.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 font-semibold">{invoices.filter(i => i.status === 'paid').length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Monthly revenue */}
          {summary?.byMonth?.length > 0 && (
            <div className="bg-gray-800 rounded-xl overflow-hidden print:border print:border-gray-300">
              <div className="px-4 py-3 border-b border-gray-700 print:border-gray-300">
                <p className="text-sm font-semibold text-white">Monthly Revenue</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700 print:border-gray-300">
                    <th className="px-4 py-2 text-left font-medium">Month</th>
                    <th className="px-4 py-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.byMonth].reverse().map(({ month, amount }) => (
                    <tr key={month} className="border-t border-gray-700 print:border-gray-300">
                      <td className="px-4 py-3 text-gray-200">{new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{summary.currency} {Number(amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit invoice modal */}
      {editInvoice && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md space-y-3 border border-gray-700">
            <div className="flex justify-between items-center">
              <h3 className="text-white font-semibold">Edit Invoice {editInvoice.invoice_number}</h3>
              <button onClick={() => setEditInvoice(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Package">
                <select className={inp} value={editInvoice.package_name} onChange={e => setEditInvoice(v => ({ ...v, package_name: e.target.value }))}>
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className={inp} value={editInvoice.status} onChange={e => setEditInvoice(v => ({ ...v, status: e.target.value }))}>
                  {['draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Amount">
                <input type="number" step="0.01" className={inp} value={editInvoice.amount} onChange={e => setEditInvoice(v => ({ ...v, amount: e.target.value }))} />
              </Field>
              <Field label="Currency">
                <select className={inp} value={editInvoice.currency} onChange={e => setEditInvoice(v => ({ ...v, currency: e.target.value }))}>
                  {INVOICE_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" className={inp} value={editInvoice.due_date || ''} onChange={e => setEditInvoice(v => ({ ...v, due_date: e.target.value }))} />
              </Field>
              <Field label="Paid Date">
                <input type="date" className={inp} value={editInvoice.paid_date || ''} onChange={e => setEditInvoice(v => ({ ...v, paid_date: e.target.value }))} />
              </Field>
            </div>
            <Field label="Description">
              <input className={inp} value={editInvoice.description || ''} onChange={e => setEditInvoice(v => ({ ...v, description: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <input className={inp} value={editInvoice.notes || ''} onChange={e => setEditInvoice(v => ({ ...v, notes: e.target.value }))} />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditInvoice(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button onClick={handleSaveEdit} className={`flex-1 ${btn()} py-2 rounded-lg text-sm`}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
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
  { id: 'bookkeeping',   label: 'Bookkeeping',        icon: Receipt },
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
          {section === 'companies'     && <Companies companies={companies} licenses={licenses} loading={loading} />}
          {section === 'billing'       && <LicenseBilling licenses={licenses} companies={companies} onRefresh={loadAll} />}
          {section === 'bookkeeping'   && <Bookkeeping companies={companies} />}
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
