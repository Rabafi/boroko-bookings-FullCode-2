import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../app-context'
import LicensingWorkbench from './LicensingWorkbench'
import {
  MONTHLY_USAGE_RESET_COPY,
  SUBSCRIPTION_PLAN_ORDER,
  buildUpgradeRequestMessage,
  getPlanRecommendation,
  getPlanUsageLimits,
  getSubscriptionPlan,
  formatPlanLimits,
  getUsageLimitStatusWithGrace,
  getUsagePriorityScore,
  getUsageStateKey,
  getUsageStatePresentation,
  normalizeSubscriptionPlan,
  trackUpgradeIntent
} from '../../../shared/subscriptionPlans'
import {
  LayoutDashboard, Building2, CreditCard, ToggleRight, Megaphone,
  LifeBuoy, Activity, LogOut, Shield, RefreshCw, Plus, Trash2,
  Copy, CheckCircle, XCircle, Key, ChevronRight, X, AlertTriangle,
  Clock, TrendingUp, Users, Home, Wrench, DollarSign, Edit3,
  Mail, Send, CheckCircle2, Eye, EyeOff, Receipt, FileText,
  BarChart3, Filter, Wallet, Printer
} from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────────────────
const BIZ_EMOJI = { lodge: '🏕️', restaurant: '🍽️', retail: '🛒', service_provider: '🔧' }
const BIZ_LABEL = { lodge: 'Lodge', restaurant: 'Restaurant', retail: 'Retail', service_provider: 'Service Provider' }
const ALL_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies']
const FEAT_LABEL = {
  reports: 'Reports', expenses: 'Expenses', staff: 'Staff Management', pwa: 'Manager mobile app',
  audit: 'Night Audit', import: 'Data Import',
  pos: 'POS / Bar', inventory: 'Inventory', supplies: 'Room Supplies',
  conference: 'Conference', pool: 'Pool / Day Use'
}

// ── Subscription Tiers ────────────────────────────────────────────────────────
const TIERS = SUBSCRIPTION_PLAN_ORDER
const TIER_DESC = Object.fromEntries(TIERS.map((planName) => [planName, getSubscriptionPlan(planName).pitch]))
const TIER_FLAGS = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, pos: false, inventory: false,
    supplies: false, import: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, pos: false, inventory: false,
    supplies: false, import: true
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, pos: true, inventory: true,
    supplies: true, import: true
  }
}
const PRIORITY_COLOR = { Low: 'text-gray-400', Normal: 'text-blue-400', High: 'text-orange-400', Urgent: 'text-red-400' }
const STATUS_COLOR = { open: 'bg-yellow-500/20 text-yellow-300', in_progress: 'bg-blue-500/20 text-blue-300', resolved: 'bg-green-500/20 text-green-300', closed: 'bg-gray-500/20 text-gray-400' }
const DEFAULT_PLAN = 'Starter'

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePlanName(plan) {
  return normalizeSubscriptionPlan(plan)
}

function getPlanFlags(plan) {
  return { ...(TIER_FLAGS[normalizePlanName(plan)] || TIER_FLAGS[DEFAULT_PLAN]) }
}

function getLicensePlanForLodge(licenses, lodgeId) {
  const activeLicense = (licenses || []).find((license) => license.lodge_id === lodgeId && license.is_active !== false)
  return normalizePlanName(activeLicense?.subscription_plan)
}

function getSubscriptionStatusLabel(license) {
  return String(license?.subscription_state || license?.payment_status || 'active').replace(/_/g, ' ')
}

function subscriptionStatusTone(license) {
  const raw = String(license?.subscription_state || license?.payment_status || 'active').toLowerCase()
  if (raw === 'active') return 'bg-green-500/20 text-green-300'
  if (raw === 'trial' || raw === 'free') return 'bg-blue-500/20 text-blue-300'
  if (raw === 'grace_period' || raw === 'overdue') return 'bg-amber-500/20 text-amber-300'
  if (raw === 'suspended' || raw === 'cancelled' || raw === 'expired') return 'bg-red-500/20 text-red-300'
  return 'bg-gray-500/20 text-gray-400'
}

function fmt(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function usageBadgeMeta(status = {}) {
  const presentation = getUsageStatePresentation(status)
  return presentation
}

function getCompanyUsageRollup(stats = null, licenses = [], company = null) {
  if (!stats?.usage_status) {
    return {
      label: 'Unknown',
      cls: 'bg-gray-700 text-gray-300',
      key: 'unknown',
      plan: normalizePlanName(stats?.plan || getLicensePlanForLodge(licenses, company?.lodge_id)),
      recommendation: {
        label: 'Unknown',
        recommendedPlan: normalizePlanName(stats?.plan || getLicensePlanForLodge(licenses, company?.lodge_id)),
        reason: 'No usage data'
      }
    }
  }
  const plan = normalizePlanName(stats?.plan || getLicensePlanForLodge(licenses, company?.lodge_id))
  const allStatuses = [
    stats.usage_status.bookings,
    stats.usage_status.rooms,
    stats.usage_status.users
  ]
  const priority = [...allStatuses].sort((a, b) => getUsagePriorityScore(b) - getUsagePriorityScore(a))[0] || allStatuses[0]
  const badge = usageBadgeMeta(priority)
  const usage = stats.usage || {}
  const recommendation = getPlanRecommendation({
    plan,
    bookingsUsage: usage.monthlyBookings ?? stats.monthly_confirmed_bookings ?? 0,
    roomsUsage: usage.rooms ?? stats.rooms ?? 0,
    usersUsage: usage.users ?? stats.users ?? 0,
    limits: stats.usage_limits || getPlanUsageLimits(plan)
  })
  return {
    ...badge,
    key: badge.key || badge.label.toLowerCase().replace(/\s+/g, '_'),
    plan,
    recommendation,
    usage: {
      bookings: Number(usage.monthlyBookings ?? stats.monthly_confirmed_bookings ?? 0),
      rooms: Number(usage.rooms ?? stats.rooms ?? 0),
      users: Number(usage.users ?? stats.users ?? 0)
    },
    usageLimits: stats.usage_limits || getPlanUsageLimits(plan),
    bookingStatus: stats.usage_status.bookings,
    bookingStateKey: getUsageStateKey(stats.usage_status.bookings),
    roomStatus: stats.usage_status.rooms,
    roomStateKey: getUsageStateKey(stats.usage_status.rooms),
    userStatus: stats.usage_status.users,
    userStateKey: getUsageStateKey(stats.usage_status.users),
    statusKey: getUsageStateKey(priority),
    lastBookingDate: stats.last_booking_date || null
  }
}

function usagePriorityScore(key = '') {
  return getUsagePriorityScore(key)
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
  const hasLicense = licenses.some((license) =>
    license.lodge_id === company.lodge_id
    && license.is_active !== false
    && String(license.payment_status || '').toLowerCase() !== 'cancelled'
    && (!license.expires_at || new Date(license.expires_at) >= new Date())
  )
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
                    <p className="text-xs text-gray-500">{log.lodge_name || log.lodge_id?.slice(0, 8)} · {timeAgo(log.created_at)}</p>
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
function Companies({ companies, licenses, loading, onReload }) {
  const [selected, setSelected] = useState(null)
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [usageStatsByLodge, setUsageStatsByLodge] = useState({})
  const [peakBookingUsageByLodge, setPeakBookingUsageByLodge] = useState({})
  const [usageFilter, setUsageFilter] = useState('all')

  const [showDisabled, setShowDisabled] = useState(false)
  const visibleCompaniesBase = showDisabled
    ? companies.filter(c => c.deleted)
    : companies.filter(c => !c.deleted)

  // ─── Lifecycle (Archive/Restore/Delete) ─────────────────────────────────────
  const [lifecycleMode, setLifecycleMode] = useState('archive') // 'archive' | 'restore' | 'delete'
  const [companyTarget, setCompanyTarget] = useState(null)
  const [confirmName, setConfirmName] = useState('')
  const [lifecycleLoading, setLifecycleLoading] = useState(false)
  const [repairLoading, setRepairLoading] = useState(false)

  // ─── reset state ────────────────────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [pwaTarget, setPwaTarget] = useState(null)
  const [companyUsers, setCompanyUsers] = useState([])
  const [pwaUsersLoading, setPwaUsersLoading] = useState(false)
  const [pwaSaving, setPwaSaving] = useState(false)
  const [selectedCompanyUserId, setSelectedCompanyUserId] = useState('')
  const [pwaEnabled, setPwaEnabled] = useState(false)
  const [pwaPassword, setPwaPassword] = useState('')
  const [pwaDisabledReason, setPwaDisabledReason] = useState('')
  const [showPwaPassword, setShowPwaPassword] = useState(false)

  const eligibleUsers = companyUsers.filter((user) => user.role === 'manager' || user.role === 'admin')
  const activePwaUser = eligibleUsers.find((user) => user.id === selectedCompanyUserId) || null

  const applyPwaUser = (user) => {
    setSelectedCompanyUserId(user?.id || '')
    setPwaEnabled(user?.pwa_enabled === true)
    setPwaPassword('')
    setPwaDisabledReason(user?.pwa_disabled_reason || '')
    setShowPwaPassword(false)
  }

  const loadCompanyUsers = useCallback(async (targetLodgeId) => {
    setPwaUsersLoading(true)
    try {
      const rows = await window.api.admin.getCompanyUsers(targetLodgeId).catch(() => [])
      const nextUsers = Array.isArray(rows) ? rows : []
      setCompanyUsers(nextUsers)
      const nextEligible = nextUsers.filter((user) => user.role === 'manager' || user.role === 'admin')
      if (nextEligible.length === 0) {
        applyPwaUser(null)
        return
      }

      const nextSelected = nextEligible.find((user) => user.id === selectedCompanyUserId) || nextEligible[0]
      applyPwaUser(nextSelected)
    } finally {
      setPwaUsersLoading(false)
    }
  }, [selectedCompanyUserId])

  const openDetail = async (company) => {
    setSelected(company)
    setStats(null)
    setStatsLoading(true)
    const s = await window.api.admin.getCompanyStats(company.lodge_id).catch(() => null)
    setStats(s)
    setStatsLoading(false)
  }

  useEffect(() => {
    let active = true
    const targets = visibleCompaniesBase.filter((company) => !usageStatsByLodge[company.lodge_id])
    if (!targets.length) return () => { active = false }
    Promise.all(targets.map(async (company) => [
      company.lodge_id,
      await window.api.admin.getCompanyStats(company.lodge_id).catch(() => null)
    ])).then((entries) => {
      if (!active) return
      setUsageStatsByLodge((current) => ({ ...current, ...Object.fromEntries(entries) }))
    }).catch(() => {})
    return () => { active = false }
  }, [usageStatsByLodge, visibleCompaniesBase])

  useEffect(() => {
    setPeakBookingUsageByLodge((current) => {
      const next = { ...current }
      visibleCompaniesBase.forEach((company) => {
        const currentUsage = Number(usageStatsByLodge[company.lodge_id]?.usage_status?.bookings?.percentUsed ?? 0)
        const previous = Number(current[company.lodge_id] ?? 0)
        next[company.lodge_id] = Math.max(previous, currentUsage)
      })
      return next
    })
  }, [usageStatsByLodge, visibleCompaniesBase])

  const companyUsageRows = visibleCompaniesBase.map((company) => {
    const statsForCompany = usageStatsByLodge[company.lodge_id] || null
    const rollup = getCompanyUsageRollup(statsForCompany, licenses, company)
    const currentBookingsUsagePercent = Number(rollup.recommendation?.currentUsagePct?.bookings ?? 0)
    const peakBookingsUsagePercent = Number(peakBookingUsageByLodge[company.lodge_id] ?? currentBookingsUsagePercent)
    return {
      company,
      stats: statsForCompany,
      rollup,
      currentBookingsUsagePercent,
      peakBookingsUsagePercent
    }
  })

  const visibleCompanies = companyUsageRows.filter((row) => {
    if (usageFilter === 'all') return true
    if (usageFilter === 'pro') return row.rollup.plan === 'Pro'
    if (usageFilter === 'near_limit') return row.rollup.key === 'near_limit' || row.rollup.key === 'critical'
    return row.rollup.key === usageFilter
  }).map((row) => row.company)

  const usageFilterCounts = companyUsageRows.reduce((acc, row) => {
    acc.total += 1
    acc[row.rollup.key] = (acc[row.rollup.key] || 0) + 1
    if (row.rollup.key === 'critical') {
      acc.critical += 1
      acc.near_limit += 1
    }
    if (row.rollup.plan === 'Pro') acc.pro += 1
    if (row.rollup.recommendation?.recommendedPlan && row.rollup.recommendation.recommendedPlan !== row.rollup.plan) acc.upgradeOpportunities += 1
    return acc
  }, { total: 0, near_limit: 0, critical: 0, in_grace: 0, blocked: 0, above_plan: 0, pro: 0, upgradeOpportunities: 0 })

  const attentionRows = [...companyUsageRows]
    .sort((a, b) => usagePriorityScore(b.rollup.key) - usagePriorityScore(a.rollup.key) || (b.rollup.recommendation?.currentUsagePct?.bookings || 0) - (a.rollup.recommendation?.currentUsagePct?.bookings || 0))
    .filter((row) => row.rollup.key !== 'normal' && row.rollup.key !== 'pro' && row.rollup.key !== 'unknown')
    .slice(0, 5)
  const selectedPeakBookingPercent = selected
    ? Number(peakBookingUsageByLodge[selected.lodge_id] ?? stats?.usage_status?.bookings?.percentUsed ?? 0)
    : 0
  const currentBookingsUsagePercent = Number(stats?.usage_status?.bookings?.percentUsed ?? 0)
  const selectedPeakBookingDisplay = selected && stats?.usage_status?.bookings?.state === 'unlimited'
    ? 'Unlimited'
    : `${selectedPeakBookingPercent}%`

  const openPwaManager = async (company) => {
    setPwaTarget(company)
    setCompanyUsers([])
    applyPwaUser(null)
    await loadCompanyUsers(company.lodge_id)
  }

  const handleLifecycleAction = async () => {
    if (lifecycleLoading || !companyTarget) return
    setLifecycleLoading(true)
    try {
      if (lifecycleMode === 'archive') {
        const res = await window.api.admin.archiveCompany(companyTarget.lodge_id)
        if (res?.success === false) throw new Error(res.error)
        alert('Company archived successfully')
      } else if (lifecycleMode === 'restore') {
        const res = await window.api.admin.restoreCompany(companyTarget.lodge_id)
        if (res?.success === false) throw new Error(res.error)
        alert('Company restored successfully')
      } else if (lifecycleMode === 'delete') {
        const res = await window.api.admin.permanentlyDeleteCompany(companyTarget.lodge_id)
        if (res?.success === false) throw new Error(res.error)
        alert(`Company permanently deleted. Removed ${res?.deleted_count || 0} Supabase row(s) and local cache/profile data for this lodge.`)
      }

      setCompanyTarget(null)
      setConfirmName('')
      setSelected(null)
      onReload?.()
    } catch (err) {
      console.error(err)
      alert(`Action failed: ${err.message || 'Unknown error'}`)
    } finally {
      setLifecycleLoading(false)
    }
  }

  const handleRepairDuplicateEvents = async (company) => {
    if (!company || repairLoading) return
    setRepairLoading(true)
    try {
      const repairDuplicateEventBookings = window.api?.admin?.repairDuplicateEventBookings
      if (typeof repairDuplicateEventBookings !== 'function') {
        throw new Error('This Boroko Bookings window is still using the old desktop bridge. Fully quit and reopen the app, then try Repair Duplicate Events again.')
      }

      const res = await repairDuplicateEventBookings(company.lodge_id)
      if (res?.success === false) throw new Error(res.error)
      const repaired = Array.isArray(res?.repaired) ? res.repaired : []
      const removed = repaired.reduce((sum, row) => sum + Number(row.removed_booking_count || 0), 0)
      alert(removed > 0
        ? `Repaired ${repaired.length} event group(s). Removed ${removed} duplicate booking row(s).`
        : 'No duplicate event booking groups found for this company.'
      )
      onReload?.()
      if (selected?.lodge_id === company.lodge_id) openDetail(company)
    } catch (err) {
      console.error(err)
      alert(`Repair failed: ${err.message || 'Unknown error'}`)
    } finally {
      setRepairLoading(false)
    }
  }

  const handleRequestUpgrade = async (company = selected) => {
    if (!company) return
    const rollup = getCompanyUsageRollup(usageStatsByLodge[company.lodge_id], licenses, company)
    const lodgeName = company.lodge_name || company.company_name || 'Unknown lodge'
    const message = buildUpgradeRequestMessage(
      {
        lodgeName,
        currentPlan: rollup.plan
      },
      {
        bookings: rollup.recommendation?.currentUsage?.bookings ?? rollup.recommendation?.currentUsagePct?.bookings ?? 0,
        rooms: rollup.recommendation?.currentUsage?.rooms ?? rollup.recommendation?.currentUsagePct?.rooms ?? 0,
        users: rollup.recommendation?.currentUsage?.users ?? rollup.recommendation?.currentUsagePct?.users ?? 0,
        recommendedPlan: rollup.recommendation?.recommendedPlan
      },
      rollup.recommendation,
      { channel: 'whatsapp' }
    )
    trackUpgradeIntent({
      lodgeId: company.lodge_id,
      lodgeName,
      plan: rollup.plan,
      usage: {
        bookings: rollup.recommendation?.currentUsage?.bookings ?? rollup.recommendation?.currentUsagePct?.bookings ?? 0,
        rooms: rollup.recommendation?.currentUsage?.rooms ?? rollup.recommendation?.currentUsagePct?.rooms ?? 0,
        users: rollup.recommendation?.currentUsage?.users ?? rollup.recommendation?.currentUsagePct?.users ?? 0
      },
      recommendation: rollup.recommendation,
      trigger: 'blocked'
    })
    const externalOpen = window.api?.shell?.openExternal
    if (typeof externalOpen === 'function') {
      await externalOpen(`mailto:support@boroko.io?subject=${encodeURIComponent(message.emailSubject)}&body=${encodeURIComponent(message.emailBody)}`).catch(() => {})
    }
  }

  const handleRequestWhatsApp = async (company = selected) => {
    if (!company) return
    const rollup = getCompanyUsageRollup(usageStatsByLodge[company.lodge_id], licenses, company)
    const lodgeName = company.lodge_name || company.company_name || 'Unknown lodge'
    const message = buildUpgradeRequestMessage(
      {
        lodgeName,
        currentPlan: rollup.plan
      },
      {
        bookings: rollup.recommendation?.currentUsage?.bookings ?? rollup.recommendation?.currentUsagePct?.bookings ?? 0,
        rooms: rollup.recommendation?.currentUsage?.rooms ?? rollup.recommendation?.currentUsagePct?.rooms ?? 0,
        users: rollup.recommendation?.currentUsage?.users ?? rollup.recommendation?.currentUsagePct?.users ?? 0,
        recommendedPlan: rollup.recommendation?.recommendedPlan
      },
      rollup.recommendation
    )
    trackUpgradeIntent({
      lodgeId: company.lodge_id,
      lodgeName,
      plan: rollup.plan,
      usage: {
        bookings: rollup.recommendation?.currentUsage?.bookings ?? rollup.recommendation?.currentUsagePct?.bookings ?? 0,
        rooms: rollup.recommendation?.currentUsage?.rooms ?? rollup.recommendation?.currentUsagePct?.rooms ?? 0,
        users: rollup.recommendation?.currentUsage?.users ?? rollup.recommendation?.currentUsagePct?.users ?? 0
      },
      recommendation: rollup.recommendation,
      trigger: 'blocked'
    })
    const externalOpen = window.api?.shell?.openExternal
    if (typeof externalOpen === 'function') {
      await externalOpen(`https://wa.me/?text=${encodeURIComponent(message.whatsappText)}`).catch(() => {})
    }
  }

  const confirmReset = async () => {
    const password = newPassword.trim()
    if (!password || password.length < 6) {
      alert('Password must be at least 6 characters')
      return
    }
    setResetLoading(true)
    try {
      const users = await window.api.admin.getCompanyUsers(resetTarget.lodge_id)
      const admin = users.find(u => u.role === 'admin')
      if (!admin) {
        alert('No admin user found for this company')
        setResetLoading(false)
        return
      }
      const result = await window.api.admin.resetCompanyUserPassword(resetTarget.lodge_id, admin.id, password)
      if (result?.success === false) {
        throw new Error(result.error || 'Failed to reset password')
      }
      alert('Admin password reset successfully')
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      console.error(err)
      alert('Failed to reset password')
    } finally {
      setResetLoading(false)
    }
  }

  const savePwaAccess = async () => {
    if (!pwaTarget || !selectedCompanyUserId) return
    if (pwaPassword && pwaPassword.trim().length < 6) {
      alert('Manager mobile app password must be at least 6 characters')
      return
    }
    if (pwaEnabled && !pwaPassword.trim() && !activePwaUser?.pwa_password_set_at) {
      alert('Set a manager mobile app password before enabling access')
      return
    }

    setPwaSaving(true)
    try {
      const result = await window.api.admin.updateCompanyUserPwaAccess(
        pwaTarget.lodge_id,
        selectedCompanyUserId,
        {
          pwa_enabled: pwaEnabled,
          pwa_password: pwaPassword.trim(),
          pwa_disabled_reason: pwaEnabled ? '' : pwaDisabledReason.trim()
        }
      )
      if (result?.success === false) {
        throw new Error(result.error || 'Could not update manager mobile app access')
      }
      await loadCompanyUsers(pwaTarget.lodge_id)
      alert('Manager mobile app access updated')
    } catch (err) {
      console.error(err)
      alert(err.message || 'Failed to update manager mobile app access')
    } finally {
      setPwaSaving(false)
    }
  }

  return (
    <div className="flex gap-5 h-full">
      {/* Table */}
      <div className={`flex-1 min-w-0 bg-gray-800 rounded-xl overflow-hidden ${selected ? 'hidden md:block' : ''}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => setShowDisabled(false)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${!showDisabled ? 'bg-gray-700 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              Active ({companies.filter(c => !c.deleted).length})
            </button>
            <button
              onClick={() => setShowDisabled(true)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${showDisabled ? 'bg-red-900/40 text-red-400 font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              Archived ({companies.filter(c => c.deleted).length})
            </button>
          </div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">{showDisabled ? 'Archived Companies' : 'Operational Lodges'}</p>
        </div>
        <div className="border-b border-gray-700 bg-gray-900/40 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'near_limit', label: 'Near limit' },
              { id: 'in_grace', label: 'In grace' },
              { id: 'blocked', label: 'Blocked' },
              { id: 'above_plan', label: 'Above plan' },
              { id: 'pro', label: 'Pro' }
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setUsageFilter(filter.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  usageFilter === filter.id
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Near limit {usageFilterCounts.near_limit}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Critical {usageFilterCounts.critical}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">In grace {usageFilterCounts.in_grace}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Blocked {usageFilterCounts.blocked}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Above plan {usageFilterCounts.above_plan}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Pro {usageFilterCounts.pro}</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-1 text-gray-300">Upgrade opportunities {usageFilterCounts.upgradeOpportunities}</span>
          </div>
        </div>
        {attentionRows.length > 0 && (
          <div className="border-b border-gray-700 bg-gray-950/60 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Needs Attention</p>
                <p className="text-sm text-gray-500">Lodges closest to their current limits or above plan.</p>
              </div>
              <p className="text-xs text-gray-500">Current plan · usage · recommendation</p>
            </div>
            <div className="space-y-2">
              {attentionRows.map(({ company, rollup, currentBookingsUsagePercent, peakBookingsUsagePercent }) => (
                <button
                  key={company.lodge_id}
                  type="button"
                  onClick={() => openDetail(company)}
                  className="flex w-full items-start justify-between gap-4 rounded-xl border border-gray-700 bg-gray-800/70 px-3 py-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{company.lodge_name || '—'}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {rollup.plan} · Bookings {currentBookingsUsagePercent}% · Peak {peakBookingsUsagePercent}% · Rooms {rollup.recommendation?.currentUsagePct?.rooms ?? 0}% · Users {rollup.recommendation?.currentUsagePct?.users ?? 0}%
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${rollup.cls}`}>{rollup.label}</span>
                    <p className="mt-1 text-xs font-semibold text-emerald-300">{rollup.recommendation?.recommendedPlan || rollup.plan}</p>
                    <p className="text-[11px] text-gray-500">{rollup.recommendation?.reason || '—'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {visibleCompanies.length === 0 && !loading ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <Building2 size={32} className="mx-auto mb-3 opacity-40" />
            <p>{showDisabled ? 'No companies found.' : 'No active companies found.'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Recommendation</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Lodge ID</th>
                <th className="px-4 py-3 text-left">Last Activity</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {visibleCompanies.map((c) => (
                (() => {
                  const rollup = getCompanyUsageRollup(usageStatsByLodge[c.lodge_id], licenses, c)
                  const planText = rollup.plan || normalizePlanName(getLicensePlanForLodge(licenses, c.lodge_id))
                  const bookingPct = rollup.recommendation?.currentUsagePct?.bookings ?? 0
                  const roomPct = rollup.recommendation?.currentUsagePct?.rooms ?? 0
                  const userPct = rollup.recommendation?.currentUsagePct?.users ?? 0
                  const bookingUsageText = rollup.plan === 'Pro' ? 'Unlimited' : `${bookingPct}%`
                  const roomUsageText = rollup.plan === 'Pro' ? 'Unlimited' : `${roomPct}%`
                  const userUsageText = rollup.plan === 'Pro' ? 'Unlimited' : `${userPct}%`
                  const lastBookingDisplay = rollup.lastBookingDate ? fmt(rollup.lastBookingDate) : 'No bookings yet'
                  return (
                <tr
                  key={c.lodge_id}
                  className={`hover:bg-gray-700 transition-colors cursor-pointer ${selected?.lodge_id === c.lodge_id ? 'bg-gray-700' : ''} ${!rollup.lastBookingDate ? 'opacity-85' : ''}`}
                  onClick={() => openDetail(c)}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-white">{c.lodge_name || '—'}</p>
                    {c.company_name && <p className="text-xs text-gray-400">{c.company_name}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(() => { const t = getTrialInfo(c, licenses); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span> })()}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${rollup.cls}`}>{rollup.label}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 font-semibold">{planText}</span>
                      {c.deleted && <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-400 font-bold uppercase tracking-tight">Archived</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Bookings {bookingUsageText} · Rooms {roomUsageText} · Users {userUsageText}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-white">{rollup.recommendation?.recommendedPlan || planText}</p>
                    <p className="mt-1 text-xs text-gray-400">{rollup.recommendation?.reason || rollup.recommendation?.details || '—'}</p>
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
                  <td className="px-4 py-3 text-gray-400 text-xs">{lastBookingDisplay}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmt(c.updated_at)}</td>
                  <td className="px-4 py-3 text-gray-500"><ChevronRight size={14} /></td>
                </tr>
                  )
                })()
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
          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-gray-400 mb-1">Last activity</p>
            <p className="text-sm font-semibold text-white">{stats?.last_booking_date ? fmt(stats.last_booking_date) : 'No bookings yet'}</p>
          </div>
          {/* Live stats */}
          <div className="border-t border-gray-700 pt-3">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Live Stats</p>
            {statsLoading ? (
              <p className="text-xs text-gray-500 animate-pulse">Loading stats…</p>
            ) : stats ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: Home, label: 'Rooms', value: stats.rooms },
                    { icon: Users, label: 'Staff', value: stats.users },
                    { icon: TrendingUp, label: 'Monthly bookings used', value: stats.monthly_confirmed_bookings },
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
                <div className="mt-2 rounded-lg border border-gray-700 bg-gray-800/60 p-2 text-[11px] text-gray-300">
                  Plan: <span className="font-semibold text-white">{stats.plan || 'Starter'}</span>
                  {stats.usage_limits && (
                    <span>
                      {' · Limits: '}
                      {formatPlanLimits(stats.plan || 'Starter').bookings}, {formatPlanLimits(stats.plan || 'Starter').grace}, {formatPlanLimits(stats.plan || 'Starter').rooms}, {formatPlanLimits(stats.plan || 'Starter').users}
                    </span>
                  )}
                </div>
                <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/50 p-3 text-[11px] text-gray-300">
                  <p className="font-semibold text-white">
                    Current bookings usage: {stats.usage_status?.bookings?.state === 'unlimited' ? 'Unlimited' : `${currentBookingsUsagePercent}%`} · Rooms {stats.usage_status?.rooms?.state === 'unlimited' ? 'Unlimited' : `${stats.usage_status?.rooms?.percentUsed ?? 0}%`} · Users {stats.usage_status?.users?.state === 'unlimited' ? 'Unlimited' : `${stats.usage_status?.users?.percentUsed ?? 0}%`}
                  </p>
                  <p className="mt-1 text-gray-400">
                    Peak usage this session: {selectedPeakBookingDisplay} · {stats.monthly_reset_copy || MONTHLY_USAGE_RESET_COPY}
                  </p>
                  {stats.recommendation?.label && (
                    <p className="mt-1 text-emerald-300">
                      {stats.recommendation.label} · {stats.recommendation.reason || 'Capacity review'}
                    </p>
                  )}
                </div>
                {stats.usage_status && (
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-300">Bookings: {getUsageStateKey(stats.usage_status.bookings)}</span>
                    <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-300">Rooms: {getUsageStateKey(stats.usage_status.rooms)}</span>
                    <span className="rounded-full bg-gray-700 px-2 py-1 text-gray-300">Users: {getUsageStateKey(stats.usage_status.users)}</span>
                  </div>
                )}
              </>
            ) : <p className="text-xs text-gray-500">Stats unavailable</p>}
          </div>
          {/* Admin actions */}
          <div className="border-t border-gray-700 pt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => handleRequestUpgrade(selected)}
                className="w-full rounded-lg bg-purple-600/20 px-3 py-2 text-xs text-purple-200 transition-all hover:bg-purple-600 hover:text-white"
              >
                Request Upgrade
              </button>
              <button
                onClick={() => handleRequestWhatsApp(selected)}
                className="w-full rounded-lg bg-green-600/20 px-3 py-2 text-xs text-green-200 transition-all hover:bg-green-600 hover:text-white"
              >
                Request via WhatsApp
              </button>
            </div>
            <div className="flex gap-2">
            {!selected.deleted ? (
              <button
                onClick={() => { setLifecycleMode('archive'); setCompanyTarget(selected); setConfirmName('') }}
                className="flex-1 text-xs py-2 px-3 rounded-lg bg-gray-700 hover:bg-red-600/30 text-gray-300 hover:text-red-300 transition-all"
              >
                Archive
              </button>
            ) : (
              <button
                onClick={() => { setLifecycleMode('restore'); setCompanyTarget(selected); setConfirmName('') }}
                className="flex-1 text-xs py-2 px-3 rounded-lg bg-green-600/20 hover:bg-green-600 text-green-300 hover:text-white transition-all"
              >
                Restore
              </button>
            )}
            <button
              onClick={() => { setLifecycleMode('delete'); setCompanyTarget(selected); setConfirmName('') }}
              className="flex-1 text-xs py-2 px-3 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white transition-all"
            >
              Delete
            </button>
          </div>
          </div>
          <button
            onClick={() => handleRepairDuplicateEvents(selected)}
            disabled={repairLoading}
            className="w-full text-xs py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition-all disabled:opacity-50"
          >
            {repairLoading ? 'Repairing Events...' : 'Repair Duplicate Events'}
          </button>
        </div>
      )}

      {/* Lifecycle (Archive/Restore/Delete) Modal */}
      {companyTarget && (
        <Modal
          title={
            lifecycleMode === 'archive' ? 'Archive Company' :
              lifecycleMode === 'restore' ? 'Restore Company' :
                'Permanently Delete Company'
          }
          onClose={() => { setCompanyTarget(null); setConfirmName('') }}
        >
          <div className="space-y-4">
            {lifecycleMode === 'archive' && (
              <div className="bg-amber-900/40 text-amber-300 p-3 rounded-lg text-sm">
                <b>Archiving</b> will disable system access for this company. It will move to the Archived folder and can be restored later.
              </div>
            )}
            {lifecycleMode === 'restore' && (
              <div className="bg-green-900/40 text-green-300 p-3 rounded-lg text-sm">
                <b>Restoring</b> will re-enable all system access for this company immediately.
              </div>
            )}
            {lifecycleMode === 'delete' && (
              <div className="bg-red-950/70 border border-red-800 text-red-200 p-3 rounded-lg text-sm space-y-2">
                <p><b>Permanent deletion cannot be undone.</b></p>
                <p>This deletes this company from Supabase and removes the matching local profile/cache from this computer.</p>
              </div>
            )}
            <p className="text-sm text-gray-300">
              Type <b className="text-white">{companyTarget.lodge_name}</b> to confirm
            </p>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Type company name"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setCompanyTarget(null); setConfirmName('') }}
                className="flex-1 py-2 px-4 rounded-lg text-sm text-gray-300 bg-gray-700 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleLifecycleAction}
                disabled={confirmName.trim() !== companyTarget.lodge_name || lifecycleLoading}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${lifecycleMode === 'archive' ? 'bg-amber-600 hover:bg-amber-700' :
                    lifecycleMode === 'restore' ? 'bg-green-600 hover:bg-green-700' :
                      'bg-red-700 hover:bg-red-800'
                  }`}
              >
                {lifecycleLoading ? 'Processing...' :
                  lifecycleMode === 'archive' ? 'Archive Company' :
                    lifecycleMode === 'restore' ? 'Restore Company' :
                      'Delete Permanently'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset admin password modal */}
      {resetTarget && (
        <Modal
          title={`Reset Admin Password — ${resetTarget.lodge_name}`}
          onClose={() => { setResetTarget(null); setNewPassword(''); setShowResetPassword(false) }}
        >
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showResetPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="New password (min 6 characters)"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowResetPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                {showResetPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setResetTarget(null); setNewPassword(''); setShowResetPassword(false) }}
                className="flex-1 py-2 px-4 rounded-lg text-sm text-gray-300 bg-gray-700 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={confirmReset}
                disabled={resetLoading}
                className="flex-1 py-2 px-4 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {resetLoading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pwaTarget && (
        <Modal
          title={`Manager mobile app access — ${pwaTarget.lodge_name}`}
          onClose={() => {
            setPwaTarget(null)
            setCompanyUsers([])
            applyPwaUser(null)
            setPwaPassword('')
            setPwaDisabledReason('')
            setShowPwaPassword(false)
          }}
          wide
        >
          <div className="space-y-4">
            {pwaUsersLoading ? (
              <p className="text-sm text-gray-400">Loading eligible company users…</p>
            ) : eligibleUsers.length === 0 ? (
              <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-sm text-amber-200">
                This company does not currently have any Manager or Admin users who are eligible for the manager mobile app.
              </div>
            ) : (
              <>
                <Field label="Eligible User">
                  <select
                    className={inp}
                    value={selectedCompanyUserId}
                    onChange={(event) => {
                      const nextUser = eligibleUsers.find((user) => user.id === event.target.value) || null
                      applyPwaUser(nextUser)
                    }}
                  >
                    {eligibleUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.role})
                      </option>
                    ))}
                  </select>
                </Field>

                {activePwaUser && (
                  <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{activePwaUser.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{activePwaUser.email} · {activePwaUser.role}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${activePwaUser.pwa_enabled ? 'bg-indigo-500/20 text-indigo-300' : 'bg-gray-700 text-gray-300'}`}>
                        {activePwaUser.pwa_enabled ? 'Manager mobile app enabled' : 'Manager mobile app disabled'}
                      </span>
                    </div>

                    <label className="flex items-start gap-3 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={pwaEnabled}
                        onChange={(event) => {
                          setPwaEnabled(event.target.checked)
                          if (event.target.checked) setPwaDisabledReason('')
                        }}
                        className="mt-1"
                      />
                      <span>
                        Enable manager mobile app for this user
                        <span className="block text-xs text-gray-500 mt-1">Command Central can override the lodge plan, but login still stays limited to Manager and Admin roles.</span>
                      </span>
                    </label>

                    <Field label={`Manager mobile app password${activePwaUser.pwa_password_set_at ? ' (leave blank to keep current)' : ''}`}>
                      <div className="relative">
                        <input
                          type={showPwaPassword ? 'text' : 'password'}
                          className={`${inp} pr-10`}
                          value={pwaPassword}
                          onChange={(event) => setPwaPassword(event.target.value)}
                          placeholder={activePwaUser.pwa_password_set_at ? 'Leave blank to keep current password' : 'Min 6 characters'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwaPassword((value) => !value)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          {showPwaPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </Field>

                    <p className="text-xs text-gray-500">
                      {activePwaUser.pwa_password_set_at
                        ? `Current manager mobile app password last updated ${fmt(activePwaUser.pwa_password_set_at)}.`
                        : 'No manager mobile app password has been set yet.'}
                    </p>

                    {!pwaEnabled && (
                      <Field label="Disable Reason">
                        <input
                          className={inp}
                          value={pwaDisabledReason}
                          onChange={(event) => setPwaDisabledReason(event.target.value)}
                          placeholder="Why is manager mobile app access turned off for this user?"
                        />
                      </Field>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setPwaTarget(null)
                      setCompanyUsers([])
                      applyPwaUser(null)
                      setPwaPassword('')
                      setPwaDisabledReason('')
                    }}
                    className="flex-1 py-2 px-4 rounded-lg text-sm text-gray-300 bg-gray-700 hover:bg-gray-600"
                  >
                    Close
                  </button>
                  <button
                    onClick={savePwaAccess}
                    disabled={pwaSaving || !activePwaUser}
                    className="flex-1 py-2 px-4 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    {pwaSaving ? 'Saving...' : 'Save manager mobile app access'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function parseUpgradeRequest(description = '') {
  const text = String(description || '')
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const read = (prefix) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() || ''
  return {
    currentPlan: read('Current plan:'),
    requestedPlan: read('Requested plan:'),
    blockedFeature: read('Blocked feature:'),
    businessNeed: read('Business need:'),
    requestedOutcome: read('Requested package outcome:'),
    commercialValue: read('Commercial value:')
  }
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Licenses & Billing
// ════════════════════════════════════════════════════════════════════
const INVOICE_CURRENCIES = ['USD', 'BWP', 'ZAR', 'EUR', 'GBP', 'N$', 'ZK']

function LicenseBilling({ licenses, companies, onRefresh }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '', subscription_plan: DEFAULT_PLAN })
  const today = new Date().toISOString().split('T')[0]
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState(null) // '3d'|'7d'|'paid'
  const [duration, setDuration] = useState('') // 'monthly'|'quarterly'|'half_year'|'yearly'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invoiceForm, setInvoiceForm] = useState({ package_name: DEFAULT_PLAN, amount: '', currency: 'BWP', paid_date: today, description: '', billing_cycle: 'monthly' })
  const [billingModal, setBillingModal] = useState(null) // license to edit billing
  const [billingForm, setBillingForm] = useState({})
  const [emailStatus, setEmailStatus] = useState({}) // { [licenseId]: 'sending'|'sent'|'error' }
  const requiresInvoice = selectedPeriod && selectedPeriod !== '3d' && selectedPeriod !== '7d'

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
    const companyLodgeId = form.lodge_id
    const selectedPlan = normalizePlanName(form.subscription_plan || invoiceForm.package_name)
    const r = await window.api.admin.issueSubscriptionContract({
      license: {
        ...form,
        lodge_id: companyLodgeId || null,
        subscription_plan: selectedPlan,
        billing_cycle: invoiceForm.billing_cycle || 'monthly',
        expires_at: form.expires_at || null,
        notes: form.notes || null,
        payment_status: requiresInvoice ? 'active' : 'free',
        monthly_fee: requiresInvoice ? Number(invoiceForm.amount || 0) : 0,
        currency: invoiceForm.currency || 'BWP',
        next_due_date: form.expires_at || null,
        last_payment_date: requiresInvoice ? (invoiceForm.paid_date || null) : null
      },
      invoice: requiresInvoice
        ? {
          lodge_id: companyLodgeId,
          lodge_name: form.lodge_name,
          package_name: selectedPlan,
          amount: Number(invoiceForm.amount),
          currency: invoiceForm.currency,
          status: 'paid',
          issued_date: invoiceForm.paid_date,
          paid_date: invoiceForm.paid_date,
          description: invoiceForm.description || null
        }
        : null
    }).catch(e => ({ error: e.message }))
    const issuedLicense = r?.license_key ? r : r?.license || null
    const issuedInvoice = r?.invoice || null
    if (issuedLicense?.id || issuedLicense?.license_key) {
      setShowForm(false)
      setForm({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '', subscription_plan: DEFAULT_PLAN })
      setSelectedCompany('')
      setSelectedPeriod(null)
      setDuration('')
      setInvoiceForm({ package_name: DEFAULT_PLAN, amount: '', currency: 'BWP', paid_date: today, description: '' })
      onRefresh()
      // Auto-send email if company has a registered email
      const company = companies.find(c => c.lodge_id === companyLodgeId)
      if (company?.email) {
        const emailPayload = {
          to: company.email,
          licenseKey: issuedLicense.license_key,
          lodgeName: form.lodge_name,
          plan: selectedPlan,
          billingCycle: invoiceForm.billing_cycle || 'monthly',
          expiresAt: form.expires_at || null,
          lodgeId: companyLodgeId,
          notes: form.notes || null,
          invoice: issuedInvoice || null
        }
        window.api.email.sendLicense(emailPayload).then(res => {
          if (!res.success) console.warn('[Email] License email failed:', res.error)
        })
      }
    } else setError(r?.error || 'Failed to issue license. Please try again.')
    setSaving(false)
  }

  const openBilling = (lic) => {
    setBillingModal(lic)
    setBillingForm({
      subscription_plan: normalizePlanName(lic.subscription_plan),
      monthly_fee: lic.monthly_fee || 0,
      currency: lic.currency || 'USD',
      payment_status: lic.payment_status || 'active',
      last_payment_date: lic.last_payment_date || '',
      next_due_date: lic.next_due_date || ''
    })
  }

  const saveBilling = async () => {
    await window.api.admin.updateLicenseBilling(billingModal.id, {
      ...billingForm,
      subscription_plan: normalizePlanName(billingForm.subscription_plan)
    }).catch(() => { })
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
              <Field label="Subscription Plan">
                <div className="grid grid-cols-3 gap-2">
                  {TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, subscription_plan: tier }))
                        setInvoiceForm((f) => ({ ...f, package_name: tier }))
                      }}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${normalizePlanName(form.subscription_plan) === tier
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
              <Field label="License Period">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Duration</label>
                      <select
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={duration}
                        onChange={e => {
                          const dur = e.target.value
                          setDuration(dur)
                          if (!dur) {
                            setForm({ ...form, expires_at: '' })
                            setSelectedPeriod(null)
                            return
                          }
                          const d = new Date()
                          if (dur === '3d') d.setDate(d.getDate() + 3)
                          else if (dur === '7d') d.setDate(d.getDate() + 7)
                          else if (dur === 'monthly') d.setMonth(d.getMonth() + 1)
                          else if (dur === 'quarterly') d.setMonth(d.getMonth() + 3)
                          else if (dur === 'half_year') d.setMonth(d.getMonth() + 6)
                          else if (dur === 'yearly') d.setFullYear(d.getFullYear() + 1)

                          const val = d.toISOString().split('T')[0]
                          setForm({ ...form, expires_at: val })
                          setSelectedPeriod(dur === '3d' || dur === '7d' ? dur : 'paid')
                        }}
                      >
                        <option value="">— Select Duration —</option>
                        <option value="3d">Trial: 3 Days</option>
                        <option value="7d">Trial: 7 Days</option>
                        <option value="monthly">1 Month (Monthly)</option>
                        <option value="quarterly">3 Months (Quarterly)</option>
                        <option value="half_year">6 Months (Half-Year)</option>
                        <option value="yearly">1 Year (Yearly)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Custom Expiry</label>
                      <input
                        type="date"
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={form.expires_at}
                        onChange={e => {
                          setForm({ ...form, expires_at: e.target.value })
                          setSelectedPeriod(e.target.value ? 'paid' : null)
                          setDuration('')
                        }}
                      />
                    </div>
                  </div>
                  {form.expires_at && (
                    <div className="bg-gray-900/40 rounded-lg p-2 flex items-center justify-between border border-gray-700">
                      <p className="text-xs text-gray-300">
                        <span className="text-gray-500 uppercase text-[10px] mr-2">Expires</span>
                        {new Date(form.expires_at + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                      <button type="button" onClick={() => { setForm({ ...form, expires_at: '' }); setSelectedPeriod(null); setDuration('') }} className="text-red-400 hover:text-red-300 text-xs font-medium">Clear</button>
                    </div>
                  )}
                </div>
              </Field>

              {/* Invoice fields — required for paid periods (not 3-day or 7-day) */}
              {requiresInvoice && (
                <div className="border border-yellow-600/40 bg-yellow-900/10 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5"><Receipt size={13} /> Invoice Required for Paid License</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Package *">
                      <select
                        className={inp}
                        value={invoiceForm.package_name}
                        onChange={e => {
                          setInvoiceForm({ ...invoiceForm, package_name: e.target.value })
                          setForm((f) => ({ ...f, subscription_plan: e.target.value }))
                        }}
                        required={requiresInvoice}
                      >
                        {TIERS.map((planName) => (
                          <option key={planName} value={planName}>
                            {planName} - {getSubscriptionPlan(planName).headline}
                          </option>
                        ))}
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
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Billing Cycle">
                      <select className={inp} value={invoiceForm.billing_cycle} onChange={e => setInvoiceForm({ ...invoiceForm, billing_cycle: e.target.value })}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="half_year">Half-Year</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </Field>
                    <Field label="Description (optional)">
                      <input className={inp} placeholder="e.g. Annual subscription payment" value={invoiceForm.description} onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}
            </div>
            <Field label="Notes">
              <input className={inp} placeholder="Annual license..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setSelectedCompany('')
                  setSelectedPeriod(null)
                  setForm({ lodge_id: '', lodge_name: '', business_type: 'lodge', expires_at: '', notes: '', subscription_plan: DEFAULT_PLAN })
                  setInvoiceForm({ package_name: DEFAULT_PLAN, amount: '', currency: 'BWP', paid_date: new Date().toISOString().split('T')[0], description: '' })
                }}
                className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm transition-colors`}
              >
                Cancel
              </button>
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
                const overdue = ['grace_period', 'suspended', 'overdue'].includes(String(lic.subscription_state || lic.payment_status || '').toLowerCase())
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lic.subscription_plan === 'Pro' ? 'bg-purple-500/20 text-purple-300' :
                          lic.subscription_plan === 'Standard' ? 'bg-blue-500/20 text-blue-300' :
                            lic.subscription_plan === 'Starter' ? 'bg-gray-500/20 text-gray-300' :
                              'bg-gray-600/20 text-gray-400'
                        }`}>{lic.subscription_plan || 'Starter'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${subscriptionStatusTone(lic)}`}>
                        {getSubscriptionStatusLabel(lic)}
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
                              className={`p-1 transition-colors ${st === 'sent' ? 'text-green-400' :
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
                    onClick={() => setBillingForm({ ...billingForm, subscription_plan: tier })}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${billingForm.subscription_plan === tier
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
                <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">Features included with this plan before overrides</p>
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
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Monthly Fee">
                <input type="number" className={inp} value={billingForm.monthly_fee} onChange={e => setBillingForm({ ...billingForm, monthly_fee: e.target.value })} />
              </Field>
              <Field label="Currency">
                <input className={inp} value={billingForm.currency} onChange={e => setBillingForm({ ...billingForm, currency: e.target.value })} placeholder="USD" />
              </Field>
              <Field label="Payment Status">
                <select className={inp} value={billingForm.payment_status} onChange={e => setBillingForm({ ...billingForm, payment_status: e.target.value })}>
                  {['active', 'overdue', 'suspended', 'free', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Last Payment Date">
                <input type="date" className={inp} value={billingForm.last_payment_date} onChange={e => setBillingForm({ ...billingForm, last_payment_date: e.target.value })} />
              </Field>
              <Field label="Next Due Date" >
                <input type="date" className={inp} value={billingForm.next_due_date} onChange={e => setBillingForm({ ...billingForm, next_due_date: e.target.value })} />
              </Field>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setBillingModal(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button onClick={saveBilling} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium`}>Save Billing</button>
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
function FeatureFlags({ companies, licenses }) {
  const [selectedLodge, setSelectedLodge] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(DEFAULT_PLAN)
  const [baseFlags, setBaseFlags] = useState(getPlanFlags(DEFAULT_PLAN))
  const [flags, setFlags] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadFlags = async (lodgeId, planName = DEFAULT_PLAN) => {
    const data = await window.api.admin.getLodgeFeatures(lodgeId).catch(() => [])
    const map = getPlanFlags(planName)
    data.forEach(r => { map[r.feature_name] = r.enabled })
    setSelectedPlan(normalizePlanName(planName))
    setBaseFlags(getPlanFlags(planName))
    setFlags(map)
  }

  const selectLodge = (c) => {
    const planName = getLicensePlanForLodge(licenses, c.lodge_id)
    setSelectedLodge(c)
    loadFlags(c.lodge_id, planName)
    setSaved(false)
  }

  const toggle = (f) => setFlags(prev => ({ ...prev, [f]: !prev[f] }))

  const saveFlags = async () => {
    if (!selectedLodge) return
    setSaving(true)
    await Promise.all(ALL_FEATURES.map((featureName) => {
      const isBaseValue = flags[featureName] === baseFlags[featureName]
      if (isBaseValue) {
        return window.api.admin.clearLodgeFeature(selectedLodge.lodge_id, featureName).catch(() => { })
      }
      return window.api.admin.setLodgeFeature(selectedLodge.lodge_id, featureName, flags[featureName] !== false).catch(() => { })
    }))
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
                <p className="text-xs text-gray-400">Override modules on top of the assigned plan instead of replacing the plan itself</p>
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
            <div className="space-y-2 pb-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Base plan:</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 font-medium">{selectedPlan}</span>
                <span className="text-gray-600">Changes below are saved as overrides only.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Preview preset:</span>
                {TIERS.map(tier => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => {
                      setSelectedPlan(tier)
                      setBaseFlags(getPlanFlags(tier))
                      setFlags(getPlanFlags(tier))
                    }}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${tier === 'Pro' ? 'border-purple-600 text-purple-300 hover:bg-purple-600/20' :
                        tier === 'Standard' ? 'border-blue-600 text-blue-300 hover:bg-blue-600/20' :
                          'border-gray-600 text-gray-400 hover:bg-gray-600/20'
                      }`}
                  >
                    {tier}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const planName = getLicensePlanForLodge(licenses, selectedLodge.lodge_id)
                    setSelectedPlan(planName)
                    setBaseFlags(getPlanFlags(planName))
                    loadFlags(selectedLodge.lodge_id, planName)
                  }}
                  className="text-xs px-3 py-1 rounded-full border border-gray-600 text-gray-400 hover:bg-gray-600/20"
                >
                  Reset to assigned plan
                </button>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              {ALL_FEATURES.map(f => (
                <div key={f} className="flex items-center justify-between py-3 border-b border-gray-700">
                  <div>
                    <p className="text-sm font-medium text-white">{FEAT_LABEL[f]}</p>
                    <p className="text-xs text-gray-500">
                      {flags[f] === baseFlags[f]
                        ? `Inherits ${baseFlags[f] ? 'enabled' : 'disabled'} from the ${selectedPlan} plan`
                        : `Override applied: ${flags[f] ? 'enabled' : 'disabled'} for this lodge`}
                    </p>
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
    await window.api.admin.createBroadcast({ ...form, expires_at: form.expires_at || null }).catch(() => { })
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
              <input className={inp} placeholder="System maintenance tonight…" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Message *">
              <textarea className={`${inp} h-20 resize-none`} placeholder="Details of the announcement…" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} required />
            </Field>
            <Field label="Expires At (optional — leave blank for permanent)">
              <input type="datetime-local" className={inp} value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
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
    await window.api.admin.updateSupportTicket(detail.id, { status: newStatus, admin_notes: notes }).catch(() => { })
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
          <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 w-48" placeholder="Search…" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} />
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All Status</option>
            {['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.priority} onChange={e => setFilter({ ...filter, priority: e.target.value })}>
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
                  <td className="px-4 py-3 text-xs text-gray-400">{t.lodge_name || t.lodge_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{t.title}</p>
                    {t.category === 'Upgrade Request' && (() => {
                      const parsed = parseUpgradeRequest(t.description)
                      return parsed.requestedPlan ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                            {parsed.requestedPlan}
                          </span>
                          {parsed.blockedFeature && (
                            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                              {parsed.blockedFeature}
                            </span>
                          )}
                        </div>
                      ) : null
                    })()}
                  </td>
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
          {(() => {
            const upgrade = detail.category === 'Upgrade Request' ? parseUpgradeRequest(detail.description) : null
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded">{detail.category}</span>
                  <span className={`px-2 py-1 rounded font-semibold ${PRIORITY_COLOR[detail.priority]}`}>{detail.priority} priority</span>
                  <span className={`px-2 py-1 rounded ${STATUS_COLOR[detail.status]}`}>{detail.status}</span>
                </div>
                {upgrade && (upgrade.requestedPlan || upgrade.businessNeed || upgrade.blockedFeature) && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {upgrade.requestedPlan && (
                      <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300">Requested Plan</p>
                        <p className="mt-2 text-sm font-semibold text-white">{upgrade.requestedPlan}</p>
                        {upgrade.currentPlan && <p className="mt-1 text-xs text-purple-200/75">Current: {upgrade.currentPlan}</p>}
                      </div>
                    )}
                    {upgrade.blockedFeature && (
                      <div className="rounded-xl border border-gray-700 bg-gray-800 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Blocked Feature</p>
                        <p className="mt-2 text-sm font-semibold text-white">{upgrade.blockedFeature}</p>
                      </div>
                    )}
                    {upgrade.businessNeed && (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 sm:col-span-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Business Need</p>
                        <p className="mt-2 text-sm text-emerald-100">{upgrade.businessNeed}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-400 mb-1">Lodge: {detail.lodge_name || detail.lodge_id}</p>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{detail.description}</p>
                </div>
                {upgrade && (upgrade.requestedOutcome || upgrade.commercialValue) && (
                  <div className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
                    {upgrade.requestedOutcome && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Requested Outcome</p>
                        <p className="mt-1 text-sm text-gray-200">{upgrade.requestedOutcome}</p>
                      </div>
                    )}
                    {upgrade.commercialValue && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Commercial Value</p>
                        <p className="mt-1 text-sm text-gray-200">{upgrade.commercialValue}</p>
                      </div>
                    )}
                  </div>
                )}
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
            )
          })()}
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
          onChange={e => setFilter({ ...filter, lodge_id: e.target.value })}
        >
          <option value="">All Lodges</option>
          {companies.map(c => <option key={c.lodge_id} value={c.lodge_id}>{c.lodge_name || c.lodge_id?.slice(0, 8)}</option>)}
        </select>
        <input type="date" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.start} onChange={e => setFilter({ ...filter, start: e.target.value })} />
        <span className="text-gray-600 text-sm">to</span>
        <input type="date" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.end} onChange={e => setFilter({ ...filter, end: e.target.value })} />
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
const EMPTY_CONFIG = { host: '', port: '587', user: '', pass: '', from: '', to: '', allow_insecure_tls: false }

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
          <label className="mt-3 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            <input
              type="checkbox"
              className="mt-1"
              checked={config.allow_insecure_tls === true}
              onChange={e => set('allow_insecure_tls', e.target.checked)}
            />
            <span>
              <span className="block font-semibold text-amber-200">Allow insecure TLS certificate</span>
              <span className="block text-xs text-amber-100/80">
                Leave this off unless your mail server uses a self-signed or otherwise invalid certificate.
              </span>
            </span>
          </label>
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
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${status.ok ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
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
function InvoicePreview({ invoice, onClose }) {
  if (!invoice) return null

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white text-gray-900 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden print:shadow-none print:rounded-none print:w-full print:max-w-none">
        {/* Header Controls */}
        <div className="bg-gray-100 px-6 py-3 flex justify-between items-center print:hidden">
          <div className="flex items-center gap-3">
            <button onClick={() => window.print()} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-purple-700 transition-colors">
              <Printer size={16} /> Print / Save PDF
            </button>
            <p className="text-xs text-gray-500">Press Esc or click X to close</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-full transition-colors text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Invoice Body */}
        <div className="p-8 md:p-12 space-y-8 print:p-0 print:space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white font-black text-xl">B</div>
                <h1 className="text-2xl font-black tracking-tighter text-purple-900">BOROKO BOOKINGS</h1>
              </div>
              <p className="text-xs text-gray-500 font-medium">Software License & Support Services</p>
            </div>
            <div className="text-right">
              <h2 className="text-3xl font-light text-gray-400 uppercase tracking-widest mb-1">INVOICE</h2>
              <p className="text-sm font-mono font-bold text-gray-800">#{invoice.invoice_number}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2">Billed To</p>
              <p className="font-bold text-gray-900 text-base">{invoice.lodge_name || invoice.lodge_id}</p>
              <p className="text-gray-600 mt-1 whitespace-pre-wrap">{invoice.description?.split('\n')[0]}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2">Invoice Details</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs"><span className="text-gray-400">Date Issued:</span> <span className="font-semibold">{new Date(invoice.issued_date).toLocaleDateString('en-GB')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-400">Due Date:</span> <span className="font-semibold">{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-GB') : 'Upon Receipt'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-400">Status:</span> <span className={`font-bold uppercase tracking-tighter ${invoice.status === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>{invoice.status}</span></div>
              </div>
            </div>
          </div>

          <div className="mt-10">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-900 text-left text-[10px] uppercase tracking-widest text-gray-500">
                  <th className="py-3 font-bold">Item Description</th>
                  <th className="py-3 text-right font-bold">Qty</th>
                  <th className="py-3 text-right font-bold">Price</th>
                  <th className="py-3 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-gray-100">
                  <td className="py-5">
                    <p className="font-bold text-gray-900">{normalizePlanName(invoice.package_name)} Subscription</p>
                    <p className="text-xs text-gray-500 mt-1">Boroko Bookings Cloud License Fee</p>
                  </td>
                  <td className="py-5 text-right">1</td>
                  <td className="py-5 text-right">{invoice.currency} {Number(invoice.amount).toFixed(2)}</td>
                  <td className="py-5 text-right font-bold">{invoice.currency} {Number(invoice.amount).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-6">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal:</span>
                <span className="font-semibold text-gray-900">{invoice.currency} {Number(invoice.amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax (0%):</span>
                <span className="font-semibold text-gray-900">{invoice.currency} 0.00</span>
              </div>
              <div className="flex justify-between pt-3 border-t-2 border-gray-900">
                <span className="font-black uppercase tracking-tighter text-gray-900">Total Amount:</span>
                <span className="font-black text-xl text-purple-900">{invoice.currency} {Number(invoice.amount).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="pt-12 border-t border-gray-100">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2">Notes & Instructions</p>
            <p className="text-xs text-gray-600 leading-relaxed italic">
              {invoice.notes || "Thank you for your business. Please include the invoice number in your bank transfer reference. Access to software features is maintained subject to active subscription status."}
            </p>
          </div>

          <div className="pt-8 text-center text-[10px] text-gray-300 print:text-gray-400">
            &copy; {new Date().getFullYear()} Boroko Bookings. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  )
}

const STATUS_COLORS = {
  paid: 'bg-green-800 text-green-200',
  draft: 'bg-gray-700 text-gray-300',
  sent: 'bg-blue-800 text-blue-200',
  overdue: 'bg-red-800 text-red-200',
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
    lodge_id: '', lodge_name: '', package_name: DEFAULT_PLAN, amount: '', currency: 'BWP',
    status: 'paid', issued_date: new Date().toISOString().split('T')[0],
    due_date: '', paid_date: new Date().toISOString().split('T')[0], description: '', notes: ''
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  // Expenses state
  const [expenses, setExpenses] = useState([])
  const [showCreateExpense, setShowCreateExpense] = useState(false)
  const [editExpense, setEditExpense] = useState(null)
  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().split('T')[0],
    category: 'Infrastructure',
    amount: '',
    currency: 'BWP',
    description: '',
    vendor: ''
  })
  const [viewingInvoice, setViewingInvoice] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [invs, sum, exps] = await Promise.all([
      window.api.admin.getInvoices({}).catch(() => []),
      window.api.admin.getInvoiceSummary().catch(() => null),
      window.api.admin.getExpenses().catch(() => [])
    ])
    setInvoices(invs)
    setSummary(sum)
    setExpenses(exps)
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
    setCreateForm({ lodge_id: '', lodge_name: '', package_name: DEFAULT_PLAN, amount: '', currency: 'BWP', status: 'paid', issued_date: new Date().toISOString().split('T')[0], due_date: '', paid_date: new Date().toISOString().split('T')[0], description: '', notes: '' })
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
    }).catch(() => { })
    setEditInvoice(null); loadData()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this invoice?')) return
    await window.api.admin.deleteInvoice(id).catch(() => { })
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
        await window.api.admin.updateInvoice(inv.id, { status: 'sent' }).catch(() => { })
        loadData()
      }
    } else alert(`Email failed: ${r.error}`)
  }

  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthTotal = summary?.byMonth?.find(m => m.month === thisMonth)?.amount || 0
  const pendingCount = invoices.filter(i => ['draft', 'sent', 'overdue'].includes(i.status)).length

  const handleCreateExpense = async (e) => {
    e.preventDefault()
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) return
    await window.api.admin.createExpense(expenseForm)
    setExpenseForm({ date: new Date().toISOString().split('T')[0], category: 'Infrastructure', amount: '', currency: 'BWP', description: '', vendor: '' })
    setShowCreateExpense(false)
    loadData()
  }

  const handleDeleteExpense = async (id) => {
    if (!confirm('Delete this expense?')) return
    await window.api.admin.deleteExpense(id)
    loadData()
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1 print:hidden">
        {[
          { id: 'invoices', label: 'Invoices', icon: FileText },
          { id: 'expenses', label: 'Expenses', icon: Wallet },
          { id: 'reports', label: 'Reports', icon: BarChart3 }
        ].map(t => (
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
                      {TIERS.map((planName) => (
                        <option key={planName} value={planName}>
                          {planName} - {getSubscriptionPlan(planName).headline}
                        </option>
                      ))}
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
                      <td className="px-4 py-3 text-gray-300 text-xs">{normalizePlanName(inv.package_name)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white text-xs">{inv.currency} {Number(inv.amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[inv.status] || 'bg-gray-700 text-gray-300'}`}>{inv.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmt(inv.issued_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button title="View / Print" onClick={() => setViewingInvoice(inv)}
                            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                            <Eye size={14} />
                          </button>
                          <button title="Send email" onClick={() => handleSendEmail(inv)} disabled={sendingEmail[inv.id]}
                            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50">
                            {emailSent[inv.id] ? <CheckCircle2 size={14} className="text-green-400" /> : sendingEmail[inv.id] ? <RefreshCw size={14} className="animate-spin" /> : <Mail size={14} />}
                          </button>
                          <button title="Edit" onClick={() => setEditInvoice({ ...inv, package_name: normalizePlanName(inv.package_name) })}
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

      {/* ── EXPENSES SUB-TAB ── */}
      {subTab === 'expenses' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Wallet className="text-purple-400" size={18} />
              <h2 className="text-white font-semibold">Operational Expenses</h2>
            </div>
            <button onClick={() => setShowCreateExpense(v => !v)} className={`flex items-center gap-1.5 ${btn()} px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap`}>
              <Plus size={13} /> Add Expense
            </button>
          </div>

          {showCreateExpense && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">New Operational Expense</h3>
              <form onSubmit={handleCreateExpense} className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Date">
                    <input type="date" className={inp} value={expenseForm.date} onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })} required />
                  </Field>
                  <Field label="Category">
                    <select className={inp} value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                      {['Infrastructure', 'Development', 'Marketing', 'Legal', 'Payroll', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Amount">
                    <input type="number" step="0.01" className={inp} value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} required placeholder="0.00" />
                  </Field>
                  <Field label="Vendor">
                    <input className={inp} value={expenseForm.vendor} onChange={e => setExpenseForm({ ...expenseForm, vendor: e.target.value })} placeholder="e.g. AWS, GitHub" />
                  </Field>
                </div>
                <Field label="Description">
                  <input className={inp} value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} placeholder="Purpose of expense" required />
                </Field>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowCreateExpense(false)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
                  <button type="submit" className={`flex-1 ${btn()} py-2 rounded-lg text-sm`}>Save Expense</button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-gray-800 rounded-xl overflow-hidden">
            {expenses.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">No expenses recorded yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Category</th>
                    <th className="px-4 py-3 text-left font-medium">Vendor</th>
                    <th className="px-4 py-3 text-left font-medium">Description</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(exp => (
                    <tr key={exp.id} className="border-t border-gray-700 hover:bg-gray-750">
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmt(exp.date)}</td>
                      <td className="px-4 py-3 text-purple-300 text-xs">{exp.category}</td>
                      <td className="px-4 py-3 text-gray-200 text-xs">{exp.vendor}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{exp.description}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white text-xs">{exp.currency} {Number(exp.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => handleDeleteExpense(exp.id)} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
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
              <p className="text-sm font-semibold text-white print:text-black">Revenue by Plan</p>
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
                  const planTotal = invoices
                    .filter(i => normalizePlanName(i.package_name) === plan && i.status === 'paid')
                    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
                  const planCount = invoices.filter(i => normalizePlanName(i.package_name) === plan && i.status === 'paid').length
                  return (
                    <tr key={plan} className="border-t border-gray-700 print:border-gray-300">
                      <td className="px-4 py-3 text-gray-200 font-medium print:text-black">{plan}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold print:text-black">{summary?.currency || 'USD'} {Number(planTotal).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 print:text-gray-600">{planCount}</td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-gray-600 print:border-gray-400 bg-gray-700/50 print:bg-gray-50">
                  <td className="px-4 py-3 text-white font-bold print:text-black">Total</td>
                  <td className="px-4 py-3 text-right text-green-400 font-bold print:text-green-700">{summary?.currency || 'USD'} {Number(summary?.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 font-semibold print:text-gray-700">{invoices.filter(i => i.status === 'paid').length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Monthly revenue */}
          {summary?.byMonth?.length > 0 && (
            <div className="bg-gray-800 rounded-xl overflow-hidden print:border print:border-gray-300">
              <div className="px-4 py-3 border-b border-gray-700 print:border-gray-300">
                <p className="text-sm font-semibold text-white print:text-black">Monthly Revenue</p>
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
                      <td className="px-4 py-3 text-gray-200 print:text-black">{new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold print:text-black">{summary.currency} {Number(amount).toFixed(2)}</td>
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
                  {TIERS.map((planName) => (
                    <option key={planName} value={planName}>
                      {planName} - {getSubscriptionPlan(planName).headline}
                    </option>
                  ))}
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
      <InvoicePreview invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MAIN: AdminCentral
// ════════════════════════════════════════════════════════════════════
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'licensing', label: 'Licensing', icon: CreditCard },
  { id: 'test-reset', label: 'Test Reset', icon: Trash2 },
  { id: 'bookkeeping', label: 'Bookkeeping', icon: Receipt },
  { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone },
  { id: 'tickets', label: 'Support Tickets', icon: LifeBuoy },
  { id: 'activity', label: 'Activity Log', icon: Activity },
  { id: 'notifications', label: 'Email Alerts', icon: Mail },
]

function TestResetMaintenance({ companies }) {
  const [selectedLodge, setSelectedLodge] = useState(null)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null)
  const [preview, setPreview] = useState(null)
  const [auditRows, setAuditRows] = useState([])
  const [form, setForm] = useState({
    mode: 'full_demo_reset',
    days: 30,
    reason: '',
    confirmation: ''
  })
  const confirmationValid = String(form.confirmation || '').trim().toUpperCase() === 'RESET TEST DATA'

  const pushFlash = (type, text) => {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 4000)
  }

  const loadLodgeState = useCallback(async (company) => {
    if (!company?.lodge_id) return
    setLoading(true)
    try {
      const [features, audit] = await Promise.all([
        window.api.admin.getLodgeFeatures(company.lodge_id).catch(() => []),
        window.api.admin.getTestDataResetAudit(company.lodge_id, 10).catch(() => [])
      ])
      const enabled = Array.isArray(features) && features.some((row) => row.feature_name === 'test_mode_enabled' && row.enabled === true)
      setTestModeEnabled(enabled)
      setAuditRows(Array.isArray(audit) ? audit : [])
    } finally {
      setLoading(false)
    }
  }, [])

  const selectLodge = (company) => {
    setSelectedLodge(company)
    setPreview(null)
    setForm({ mode: 'full_demo_reset', days: 30, reason: '', confirmation: '' })
    loadLodgeState(company)
  }

  const toggleTestMode = async (enabled) => {
    if (!selectedLodge?.lodge_id) return
    setLoading(true)
    try {
      if (enabled) {
        const result = await window.api.admin.setLodgeFeature(
          selectedLodge.lodge_id,
          'test_mode_enabled',
          true,
          { reason: 'Boroko internal test reset mode enabled' }
        )
        if (result?.success === false) throw new Error(result.error || 'Could not enable test mode')
        setTestModeEnabled(true)
        pushFlash('success', 'Test mode enabled for this lodge.')
      } else {
        const result = await window.api.admin.clearLodgeFeature(selectedLodge.lodge_id, 'test_mode_enabled')
        if (result?.success === false) throw new Error(result.error || 'Could not disable test mode')
        setTestModeEnabled(false)
        pushFlash('success', 'Test mode disabled for this lodge.')
      }
      await loadLodgeState(selectedLodge)
    } catch (error) {
      pushFlash('error', error?.message || 'Could not update test mode.')
    } finally {
      setLoading(false)
    }
  }

  const runPreview = async () => {
    if (!selectedLodge?.lodge_id) return
    setPreviewLoading(true)
    try {
      const result = await window.api.admin.getTestDataResetPreview(selectedLodge.lodge_id, {
        mode: form.mode,
        days: Number(form.days || 30)
      })
      if (result?.success === false) throw new Error(result.error || 'Could not load preview')
      setPreview(result)
      pushFlash('success', 'Reset preview loaded.')
    } catch (error) {
      pushFlash('error', error?.message || 'Could not load preview.')
    } finally {
      setPreviewLoading(false)
    }
  }

  const runReset = async () => {
    if (!selectedLodge?.lodge_id) return
    setRunning(true)
    try {
      const result = await window.api.admin.runTestDataReset(selectedLodge.lodge_id, {
        lodge_name: selectedLodge.lodge_name,
        mode: form.mode,
        days: Number(form.days || 30),
        reason: form.reason,
        confirmation: form.confirmation
      })
      if (result?.success === false) throw new Error(result.error || 'Could not run test reset')
      pushFlash('success', 'Test data reset completed.')
      setPreview(result)
      setForm((current) => ({ ...current, confirmation: '' }))
      await loadLodgeState(selectedLodge)
    } catch (error) {
      pushFlash('error', error?.message || 'Could not run test reset.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex gap-5">
      <div className="w-64 shrink-0 bg-gray-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-700">Select Company</p>
        <div className="divide-y divide-gray-700 max-h-[620px] overflow-y-auto">
          {companies.map((company) => (
            <button
              key={company.lodge_id}
              onClick={() => selectLodge(company)}
              className={`w-full px-4 py-3 text-left text-sm transition-colors ${selectedLodge?.lodge_id === company.lodge_id ? 'bg-red-600/20 text-red-200' : 'text-gray-300 hover:bg-gray-700'
                }`}
            >
              <p className="font-medium truncate">{company.lodge_name || '—'}</p>
              <p className="text-xs text-gray-500">{company.lodge_id}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-5">
        {!selectedLodge ? (
          <div className="bg-gray-800 rounded-xl p-12 text-center text-gray-500">
            <Trash2 size={32} className="mx-auto mb-3 opacity-40" />
            <p>Select a company to manage Boroko-only test reset controls.</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/70 to-gray-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">Boroko Internal Tool</p>
                  <h3 className="mt-2 text-xl font-bold text-white">{selectedLodge.lodge_name}</h3>
                  <p className="mt-1 text-sm text-red-100/80">
                    This tool is for demos, QA, and sandbox cleanup only. It must never be used for live client finance records.
                  </p>
                </div>
                <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${testModeEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {testModeEnabled ? 'Test mode enabled' : 'Test mode disabled'}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => toggleTestMode(true)}
                  disabled={loading || testModeEnabled}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${btn()} disabled:opacity-50`}
                >
                  Enable Test Mode
                </button>
                <button
                  type="button"
                  onClick={() => toggleTestMode(false)}
                  disabled={loading || !testModeEnabled}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${btn('ghost')} disabled:opacity-50`}
                >
                  Disable Test Mode
                </button>
              </div>
              <p className={`mt-3 text-xs ${testModeEnabled ? 'text-emerald-300' : 'text-amber-300'}`}>
                {testModeEnabled
                  ? 'Test mode is currently active for this lodge. The green badge is the persistent state; the popup message is only temporary.'
                  : 'Enable test mode first. The reset tool stays locked until this lodge is explicitly marked for internal testing.'}
              </p>
            </div>

            {flash && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${flash.type === 'success' ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'}`}>
                {flash.text}
              </div>
            )}

            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="bg-gray-800 rounded-xl p-5 space-y-4">
                <div>
                  <h4 className="text-white font-semibold">Reset Plan</h4>
                  <p className="text-sm text-gray-400 mt-1">Preview first, then type the confirmation phrase to execute.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Reset Mode">
                    <select className={inp} value={form.mode} onChange={(e) => setForm((current) => ({ ...current, mode: e.target.value }))}>
                      <option value="recent_activity">Reset Recent Activity</option>
                      <option value="tagged_test_data">Reset Tagged Test Data</option>
                      <option value="full_demo_reset">Full Demo Lodge Reset</option>
                    </select>
                  </Field>
                  <Field label="Days Window">
                    <input
                      type="number"
                      min="1"
                      className={inp}
                      disabled={form.mode === 'full_demo_reset'}
                      value={form.days}
                      onChange={(e) => setForm((current) => ({ ...current, days: e.target.value }))}
                    />
                  </Field>
                </div>

                <Field label="Reason">
                  <textarea
                    className={inp}
                    rows="3"
                    value={form.reason}
                    onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))}
                    placeholder="Why this reset is needed"
                  />
                </Field>

                <Field label='Type "RESET TEST DATA" to confirm'>
                  <input
                    className={inp}
                    value={form.confirmation}
                    onChange={(e) => setForm((current) => ({ ...current, confirmation: e.target.value }))}
                    placeholder="RESET TEST DATA"
                  />
                </Field>
                <p className={`text-xs ${confirmationValid ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {confirmationValid
                    ? 'Confirmation accepted. You can now run the reset.'
                    : 'The reset button unlocks only after you type RESET TEST DATA exactly.'}
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={!testModeEnabled || previewLoading || running}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${btn('ghost')} disabled:opacity-50`}
                  >
                    {previewLoading ? 'Loading Preview…' : 'Preview Impact'}
                  </button>
                  <button
                    type="button"
                    onClick={runReset}
                    disabled={!testModeEnabled || running || !confirmationValid}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                  >
                    {running ? 'Running Reset…' : 'Run Reset'}
                  </button>
                </div>
                {(!testModeEnabled || !confirmationValid) && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                    {!testModeEnabled
                      ? 'Run Reset is locked because test mode is not active for this lodge.'
                      : 'Run Reset is locked until the confirmation phrase is entered exactly.'}
                  </div>
                )}

                {preview && (
                  <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
                    <div className="flex items-center gap-2 text-red-300">
                      <AlertTriangle size={15} />
                      <p className="text-sm font-semibold">Reset impact preview</p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(preview.deleted_counts || preview.counts || {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-gray-800 px-3 py-2">
                          <p className="text-xs uppercase tracking-wide text-gray-500">{key.replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-lg font-semibold text-white">{Number(value || 0)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-gray-800 rounded-xl p-5 space-y-4">
                <div>
                  <h4 className="text-white font-semibold">Reset Audit</h4>
                  <p className="text-sm text-gray-400 mt-1">Every reset stays logged even after test data is removed.</p>
                </div>
                {auditRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
                    No reset runs logged for this lodge yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {auditRows.map((row) => (
                      <div key={row.id} className="rounded-xl border border-gray-700 bg-gray-900/60 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{String(row.reset_mode || '').replace(/_/g, ' ')}</p>
                          <span className="text-xs text-gray-500">{fmt(row.created_at)}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">By {row.triggered_by_name || 'System'}</p>
                        {row.reason && <p className="mt-2 text-sm text-gray-300">{row.reason}</p>}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {Object.entries(row.deleted_counts || {}).slice(0, 6).map(([key, value]) => (
                            <div key={`${row.id}-${key}`} className="rounded-lg bg-gray-800 px-2.5 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-gray-500">{key.replace(/_/g, ' ')}</p>
                              <p className="mt-1 text-sm font-semibold text-white">{Number(value || 0)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

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

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const upgradeCount = tickets.filter(t => t.category === 'Upgrade Request' && (t.status === 'open' || t.status === 'in_progress')).length

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col print:bg-white print:text-black print:min-h-0">
      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0 print:hidden">
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

      <div className="flex flex-1 min-h-0 print:block">
        {/* Sidebar */}
        <div className="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col py-4 gap-1 px-2 print:hidden">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            // Badge logic: support ticket count (orange) + upgrade request count (purple)
            const ticketBadge = id === 'tickets' && openTickets > 0 ? openTickets : null
            const upgradeBadge = id === 'tickets' && upgradeCount > 0 ? upgradeCount : null
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors w-full text-left ${section === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
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
        <div className="flex-1 min-w-0 p-6 overflow-y-auto print:p-0 print:overflow-visible print:block">
          {section === 'dashboard' && <Dashboard companies={companies} licenses={licenses} tickets={tickets} activityLogs={activityLogs} />}
          {section === 'companies' && <Companies companies={companies} licenses={licenses} loading={loading} onReload={loadAll} />}
          {section === 'licensing' && <LicensingWorkbench companies={companies} licenses={licenses} tickets={tickets} onRefresh={loadAll} />}
          {section === 'test-reset' && <TestResetMaintenance companies={companies} />}
          {section === 'bookkeeping' && <Bookkeeping companies={companies} />}
          {section === 'broadcasts' && <Broadcasts />}
          {section === 'tickets' && <SupportTickets companies={companies} />}
          {section === 'activity' && <ActivityLog companies={companies} />}
          {section === 'notifications' && <EmailSettings />}
        </div>
      </div>
    </div>
  )
}
