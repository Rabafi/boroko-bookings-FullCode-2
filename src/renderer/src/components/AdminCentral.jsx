import { useEffect, useState, useCallback, useMemo } from 'react'
import { useAuth } from '../app-context'
import { safeLoadAll, hasPartialFailures, getFailureSummary } from '../utils/safeLoad'
import { timeAgo as sharedTimeAgo, formatMoney, fmtDate } from '../utils/timeAgo'
import { useToast } from './shared/Toast'
import { DarkConfirmDialog } from './shared/DarkConfirmDialog'
import { useTableSort, SortableHeader } from '../hooks/useTableSort'
import { BarChart, DonutChart, Sparkline, HorizontalBar } from './shared/Charts'
import LicensingWorkbench from './LicensingWorkbench'
import ExecutiveCockpit from './ExecutiveCockpit'
import Client360 from './Client360'
import AccountingDashboard from './AccountingDashboard'
import AdminToday from './AdminToday'
import GlobalSearch from './GlobalSearch'
import BulkActions from './BulkActions'
import SystemHealth from './SystemHealth'
import Notifications from './Notifications'
import Fleet from './Fleet'
import Releases from './Releases'
import SurfaceIntelligence from './SurfaceIntelligence'
import SubscriptionRequests from './SubscriptionRequests'
import EnterpriseWorkflowWorkspace from './EnterpriseWorkflowWorkspace'
import PaymentGatewayConfig from './PaymentGatewayConfig'
import Pagination, { usePagination } from './shared/Pagination'
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
import { normalizeSupportMessages, supportMessageSide, supportSenderMeta, supportSenderName } from '../../../shared/supportThreads'
import {
  LayoutDashboard, Building2, CreditCard, ToggleRight, Megaphone,
  LifeBuoy, Activity, LogOut, Shield, RefreshCw, Plus, Trash2,
  Copy, CheckCircle, XCircle, Key, ChevronRight, X, AlertTriangle,
  Clock, TrendingUp, Users, Home, Wrench, DollarSign, Edit3,
  Mail, Send, CheckCircle2, Eye, EyeOff, Receipt, FileText,
  BarChart3, Filter, Wallet, Printer, Bell, Server, Rocket,
  Zap, Search, CheckSquare
} from 'lucide-react'
import { formatLocalDate, localToday } from '../utils/localDate'
import { TRIAL_LENGTH_DAYS, DEFAULT_TAX_RATE, ACTION_ICON } from '../constants/adminConstants'
import ErrorBoundary from './shared/ErrorBoundary'
import { BIZ_EMOJI, BIZ_LABEL, ALL_FEATURES, FEAT_LABEL, INVOICE_CURRENCIES } from '../constants/adminConstants'

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
const STATUS_COLOR = { open: 'bg-yellow-500/20 text-yellow-300', acknowledged: 'bg-amber-500/20 text-amber-300', in_progress: 'bg-blue-500/20 text-blue-300', resolved: 'bg-green-500/20 text-green-300', closed: 'bg-gray-500/20 text-gray-400' }
const DEFAULT_PLAN = 'Starter'

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePlanName(plan) {
  return normalizeSubscriptionPlan(plan)
}

function lodgeKey(value) {
  return String(value || '').trim().toLowerCase()
}

const UNASSIGNED_LICENSE_STATES = new Set(['cancelled', 'expired', 'superseded', 'deleted', 'inactive'])

function isAssignedLicense(license) {
  if (!license || !lodgeKey(license.lodge_id) || license.is_active === false) return false
  const state = String(license.subscription_state || license.payment_status || 'active').toLowerCase()
  return !UNASSIGNED_LICENSE_STATES.has(state)
}

function licenseSortTime(license) {
  const value = license?.updated_at || license?.issued_at || license?.created_at || license?.expires_at || license?.next_due_date
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function pickPreferredLicense(current, candidate) {
  if (!current) return candidate
  const currentPlanRank = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizePlanName(current.subscription_plan))
  const candidatePlanRank = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizePlanName(candidate.subscription_plan))
  if (candidatePlanRank !== currentPlanRank) return candidatePlanRank > currentPlanRank ? candidate : current
  return licenseSortTime(candidate) >= licenseSortTime(current) ? candidate : current
}

function getAssignedLicenseForLodge(licenses, lodgeId) {
  const target = lodgeKey(lodgeId)
  return (licenses || []).reduce((best, license) => {
    if (!isAssignedLicense(license) || lodgeKey(license.lodge_id) !== target) return best
    return pickPreferredLicense(best, license)
  }, null)
}

function getAssignedPlanForLodge(licenses, lodgeId) {
  const activeLicense = getAssignedLicenseForLodge(licenses, lodgeId)
  return activeLicense ? normalizePlanName(activeLicense.subscription_plan) : null
}

function getPlanFlags(plan) {
  return { ...(TIER_FLAGS[normalizePlanName(plan)] || TIER_FLAGS[DEFAULT_PLAN]) }
}

function getLicensePlanForLodge(licenses, lodgeId) {
  const activeLicense = getAssignedLicenseForLodge(licenses, lodgeId)
  return activeLicense ? normalizePlanName(activeLicense.subscription_plan) : null
}

function getSubscriptionStatusLabel(license) {
  return String(license?.subscription_state || license?.payment_status || 'active').replace(/_/g, ' ')
}

function subscriptionStatusTone(license) {
  const raw = String(license?.subscription_state || license?.payment_status || 'active').toLowerCase()
  if (raw === 'active' || raw === 'licensed') return 'bg-green-500/20 text-green-300'
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
const timeAgo = sharedTimeAgo

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

function ShortcutsModal({ onClose }) {
  const shortcuts = [
    { keys: ['Ctrl', 'K'], desc: 'Open Global Search' },
    { keys: ['?'], desc: 'Show keyboard shortcuts' },
    { keys: ['1'], desc: 'Go to Dashboard' },
    { keys: ['2'], desc: 'Go to Companies' },
    { keys: ['3'], desc: 'Go to Licensing' },
    { keys: ['4'], desc: 'Go to Finance' },
    { keys: ['5'], desc: 'Go to Client Desk' },
    { keys: ['6'], desc: 'Go to Communications' },
    { keys: ['7'], desc: 'Go to Platform Operations' },
    { keys: ['8'], desc: 'Go to Activity Log' },
    { keys: ['9'], desc: 'Go to Admin Tools' },
    { keys: ['Esc'], desc: 'Close modal / drawer' },
  ]
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <div className="space-y-2">
        {shortcuts.map(({ keys, desc }) => (
          <div key={desc} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-300">{desc}</span>
            <div className="flex items-center gap-1">
              {keys.map(k => (
                <kbd key={k} className="px-2 py-0.5 text-[11px] font-mono text-gray-400 bg-gray-700 border border-gray-600 rounded">{k}</kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
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
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.() } }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className={`bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 ${wide ? 'max-w-2xl' : 'max-w-lg'} w-full max-h-[85vh] overflow-y-auto`}
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
  const assignedPlan = normalizePlanName(getAssignedPlanForLodge(licenses, company?.lodge_id))
  if (assignedPlan) return { label: `${assignedPlan} Licensed`, color: 'bg-green-500/20 text-green-300', plan: assignedPlan }
  if (!company?.trial_started_at) return { label: 'In Trial', color: 'bg-blue-500/20 text-blue-300', plan: null }
  const trialEnd = new Date(company.trial_started_at)
  trialEnd.setDate(trialEnd.getDate() + TRIAL_LENGTH_DAYS)
  const daysLeft = Math.ceil((trialEnd - new Date()) / 864e5)
  if (daysLeft > 0) return { label: `Trial: ${daysLeft}d left`, color: daysLeft === 1 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300', plan: null }
  return { label: 'Trial Expired', color: 'bg-red-500/20 text-red-400', plan: null }
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Dashboard
// ════════════════════════════════════════════════════════════════════
function Dashboard({ companies, licenses, tickets, activityLogs, onOpenCompany }) {
  const today = localToday()
  const active = licenses.filter(l => l.is_active).length
  const expiring = licenses.filter(l => l.expires_at && l.is_active && new Date(l.expires_at) > new Date() && (new Date(l.expires_at) - new Date()) < 30 * 864e5).length
  const overdue = licenses.filter(l => l.next_due_date && l.next_due_date < today && l.payment_status !== 'free' && l.is_active).length
  const activeFinancial = licenses.filter(l => l.is_active && l.payment_status !== 'free')
  const mrr = activeFinancial.reduce((sum, l) => {
    const amt = Number(l.amount || 0)
    if (l.billing_cycle === 'annual') return sum + (amt / 12)
    return sum + amt
  }, 0)
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const urgentTickets = tickets.filter(t => t.priority === 'urgent' || t.priority === 'critical').length
  const trialsExpired = companies.filter(c => getTrialInfo(c, licenses).label === 'Trial Expired').length
  const trialsActive = companies.filter(c => getTrialInfo(c, licenses).label.startsWith('Trial:')).length
  const byType = companies.reduce((a, c) => { const t = c.business_type || 'lodge'; a[t] = (a[t] || 0) + 1; return a }, {})
  const recent5 = [...companies].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5)
  const recentLogs = activityLogs.slice(0, 8)

  const ticketByStatus = tickets.reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a }, {})
  const ticketChartData = [
    { label: 'Open', value: ticketByStatus.open || 0, color: '#f59e0b' },
    { label: 'In Progress', value: ticketByStatus.in_progress || 0, color: '#3b82f6' },
    { label: 'Resolved', value: ticketByStatus.resolved || 0, color: '#10b981' },
    { label: 'Closed', value: ticketByStatus.closed || 0, color: '#6b7280' }
  ].filter(d => d.value > 0)

  const ACTION_LABELS = {
    booking_created: 'Booking Created', booking_cancelled: 'Booking Cancelled',
    payment_received: 'Payment Received', company_archived: 'Company Archived',
    company_restored: 'Company Restored', company_deleted: 'Company Deleted',
    license_created: 'License Created', license_updated: 'License Updated',
    broadcast_created: 'Broadcast Created', ticket_created: 'Ticket Created',
    ticket_updated: 'Ticket Updated', feature_flag_updated: 'Feature Flag Updated',
    release_created: 'Release Created', release_status_changed: 'Release Status Changed',
    admin_audit: 'Admin Audit', default: 'Activity'
  }

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mr-1">Quick Actions</p>
        {[
          { label: 'Companies', section: 'companies', icon: Building2 },
          { label: 'Tickets', section: 'tickets', icon: LifeBuoy },
          { label: 'Finance', section: 'finance', icon: DollarSign },
          { label: 'Broadcasts', section: 'broadcasts', icon: Megaphone },
        ].map(({ label, section, icon: Icon }) => (
          <button key={section} onClick={() => window.__adminNavigate?.(section)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border border-gray-700">
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Financial KPIs */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">Financial Health</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Monthly Revenue" value={`$${mrr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} color="text-green-400" />
          <StatCard label="Paying Customers" value={activeFinancial.length} color="text-green-400" />
          <StatCard label="Overdue Payments" value={overdue} color={overdue > 0 ? 'text-red-400' : 'text-gray-500'} />
          <StatCard label="Active Licenses" value={active} color="text-green-400" />
        </div>
      </div>

      {/* Operational KPIs */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">Operations</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Registered Companies" value={companies.length} color="text-white" />
          <StatCard label="In Trial" value={trialsActive} color={trialsActive > 0 ? 'text-blue-400' : 'text-gray-500'} />
          <StatCard label="Trial Expired" value={trialsExpired} color={trialsExpired > 0 ? 'text-red-400' : 'text-gray-500'} />
          <StatCard label="Expiring (30d)" value={expiring} color={expiring > 0 ? 'text-yellow-400' : 'text-gray-500'} />
          <StatCard label="Open Tickets" value={openTickets} color={openTickets > 0 ? 'text-orange-400' : 'text-gray-500'} />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {Object.keys(byType).length > 0 && (
          <div className="bg-gray-800 rounded-xl p-4">
            <DonutChart
              label="Business Types"
              data={Object.entries(byType).map(([type, count]) => ({
                label: BIZ_LABEL[type] || type,
                value: count,
                color: type === 'lodge' ? '#a855f7' : type === 'hotel' ? '#3b82f6' : '#10b981'
              }))}
              size={110}
            />
          </div>
        )}
        <div className="bg-gray-800 rounded-xl p-4">
          <BarChart
            label="License Status"
            height={140}
            data={[
              { label: 'Active', value: active, color: '#10b981' },
              { label: 'Trial', value: trialsActive, color: '#3b82f6' },
              { label: 'Expired', value: trialsExpired, color: '#ef4444' },
              { label: 'Expiring', value: expiring, color: '#f59e0b' },
              { label: 'Overdue', value: overdue, color: '#f97316' }
            ]}
          />
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          {ticketChartData.length > 0 ? (
            <BarChart label="Tickets by Status" height={140} data={ticketChartData} />
          ) : (
            <div className="flex flex-col items-center justify-center h-[140px] text-gray-500">
              <LifeBuoy size={24} className="mb-2 opacity-40" />
              <p className="text-xs">No tickets</p>
            </div>
          )}
        </div>
      </div>

      {/* Today's Action Items */}
      <AdminToday />

      <div className="grid grid-cols-2 gap-5">
        {/* Recently registered */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Recently Registered</p>
          {recent5.length === 0 ? (
            <p className="text-gray-500 text-sm">No companies yet</p>
          ) : (
            <div className="space-y-3">
              {recent5.map(c => (
                <div key={c.lodge_id} className="flex items-center justify-between group">
                  <button onClick={() => onOpenCompany?.(c)} className="text-left">
                    <p className="text-sm font-medium text-purple-400 group-hover:text-purple-300 transition-colors">{c.lodge_name || '—'}</p>
                    <p className="text-xs text-gray-500">{BIZ_EMOJI[c.business_type] || '🏢'} {BIZ_LABEL[c.business_type] || c.business_type}</p>
                  </button>
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
                    <p className="text-xs text-gray-200 truncate">{ACTION_LABELS[log.action] || log.action.replace(/_/g, ' ')}</p>
                    <p className="text-[10px] text-gray-500">{log.lodge_name || log.lodge_id?.slice(0, 8)} · {timeAgo(log.created_at)}</p>
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
  const toast = useToast()
  const [selected, setSelected] = useState(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [usageStatsByLodge, setUsageStatsByLodge] = useState({})
  const [peakBookingUsageByLodge, setPeakBookingUsageByLodge] = useState({})
  const [usageFilter, setUsageFilter] = useState('all')
  const [companySearch, setCompanySearch] = useState('')

  const [showDisabled, setShowDisabled] = useState(false)
  const visibleCompaniesBase = useMemo(
    () => showDisabled ? companies.filter(c => c.deleted) : companies.filter(c => !c.deleted),
    [companies, showDisabled]
  )

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

  const eligibleUsers = useMemo(
    () => companyUsers.filter((user) => user.role === 'manager' || user.role === 'admin'),
    [companyUsers]
  )
  const activePwaUser = useMemo(
    () => eligibleUsers.find((user) => user.id === selectedCompanyUserId) || null,
    [eligibleUsers, selectedCompanyUserId]
  )

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
    setDetailTab('overview')
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

    const loadWithLimit = async () => {
      const entries = []
      let nextIndex = 0
      const worker = async () => {
        while (active && nextIndex < targets.length) {
          const company = targets[nextIndex]
          nextIndex += 1
          const companyStats = await window.api.admin.getCompanyStats(company.lodge_id).catch(() => null)
          entries.push([company.lodge_id, companyStats])
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker))
      return entries
    }

    loadWithLimit().then((entries) => {
      if (!active) return
      setUsageStatsByLodge((current) => ({ ...current, ...Object.fromEntries(entries) }))
    }).catch(() => {})
    return () => { active = false }
  }, [usageStatsByLodge, visibleCompaniesBase])

  useEffect(() => {
    setPeakBookingUsageByLodge((current) => {
      const next = { ...current }
      let changed = false
      visibleCompaniesBase.forEach((company) => {
        const currentUsage = Number(usageStatsByLodge[company.lodge_id]?.usage_status?.bookings?.percentUsed ?? 0)
        const previous = Number(current[company.lodge_id] ?? 0)
        const peak = Math.max(previous, currentUsage)
        if (peak !== previous || current[company.lodge_id] === undefined) {
          next[company.lodge_id] = peak
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [usageStatsByLodge, visibleCompaniesBase])

  const companyUsageRows = useMemo(() => visibleCompaniesBase.map((company) => {
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
  }), [visibleCompaniesBase, usageStatsByLodge, licenses, peakBookingUsageByLodge])

  const visibleCompanies = useMemo(() => companyUsageRows.filter((row) => {
    if (usageFilter === 'all') return true
    if (usageFilter === 'pro') return row.rollup.plan === 'Pro'
    if (usageFilter === 'near_limit') return row.rollup.key === 'near_limit' || row.rollup.key === 'critical'
    return row.rollup.key === usageFilter
  }).map((row) => row.company).filter(c => {
    if (companySearch && !c.lodge_name?.toLowerCase().includes(companySearch.toLowerCase()) && !c.company_name?.toLowerCase().includes(companySearch.toLowerCase()) && !c.lodge_id?.toLowerCase().includes(companySearch.toLowerCase())) return false
    return true
  }), [companyUsageRows, usageFilter, companySearch])

  const { sorted: sortedCompanies, sortKey: companySortKey, sortDir: companySortDir, toggleSort: toggleCompanySort } = useTableSort(visibleCompanies, 'lodge_name')

  const { page: companyPage, setPage: setCompanyPage, totalPages: companyTotalPages, paginated: paginatedCompanies, total: companyTotal } = usePagination(sortedCompanies)

  const usageFilterCounts = useMemo(() => companyUsageRows.reduce((acc, row) => {
    acc.total += 1
    acc[row.rollup.key] = (acc[row.rollup.key] || 0) + 1
    if (row.rollup.key === 'critical') {
      acc.critical += 1
      acc.near_limit += 1
    }
    if (row.rollup.plan === 'Pro') acc.pro += 1
    if (row.rollup.recommendation?.recommendedPlan && row.rollup.recommendation.recommendedPlan !== row.rollup.plan) acc.upgradeOpportunities += 1
    return acc
  }, { total: 0, near_limit: 0, critical: 0, in_grace: 0, blocked: 0, above_plan: 0, pro: 0, upgradeOpportunities: 0 }), [companyUsageRows])

  const attentionRows = useMemo(() => [...companyUsageRows]
    .sort((a, b) => usagePriorityScore(b.rollup.key) - usagePriorityScore(a.rollup.key) || (b.rollup.recommendation?.currentUsagePct?.bookings || 0) - (a.rollup.recommendation?.currentUsagePct?.bookings || 0))
    .filter((row) => row.rollup.key !== 'normal' && row.rollup.key !== 'pro' && row.rollup.key !== 'unknown')
    .slice(0, 5), [companyUsageRows])
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
        toast.success('Company archived successfully')
      } else if (lifecycleMode === 'restore') {
        const res = await window.api.admin.restoreCompany(companyTarget.lodge_id)
        if (res?.success === false) throw new Error(res.error)
        toast.success('Company restored successfully')
      } else if (lifecycleMode === 'delete') {
        const res = await window.api.admin.permanentlyDeleteCompany(companyTarget.lodge_id)
        if (res?.success === false) throw new Error(res.error)
        toast.success(`Company permanently deleted. Removed ${res?.deleted_count || 0} row(s).`)
      }

      setCompanyTarget(null)
      setConfirmName('')
      setSelected(null)
      onReload?.()
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Action failed')
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
      toast(removed > 0
        ? `Repaired ${repaired.length} event group(s). Removed ${removed} duplicate booking row(s).`
        : 'No duplicate event booking groups found.'
      )
      onReload?.()
      if (selected?.lodge_id === company.lodge_id) openDetail(company)
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Repair failed')
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
      toast.warning('Password must be at least 6 characters')
      return
    }
    setResetLoading(true)
    try {
      const users = await window.api.admin.getCompanyUsers(resetTarget.lodge_id)
      const admin = users.find(u => u.role === 'admin')
      if (!admin) {
        toast.error('No admin user found for this company')
        setResetLoading(false)
        return
      }
      const result = await window.api.admin.resetCompanyUserPassword(resetTarget.lodge_id, admin.id, password)
      if (result?.success === false) {
        throw new Error(result.error || 'Failed to reset password')
      }
      toast.success('Admin password reset successfully')
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to reset password')
    } finally {
      setResetLoading(false)
    }
  }

  const savePwaAccess = async () => {
    if (!pwaTarget || !selectedCompanyUserId) return
    if (pwaPassword && pwaPassword.trim().length < 6) {
      toast.warning('Manager mobile app password must be at least 6 characters')
      return
    }
    if (pwaEnabled && !pwaPassword.trim() && !activePwaUser?.pwa_password_set_at) {
      toast.warning('Set a manager mobile app password before enabling access')
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
      toast.success('Manager mobile app access updated')
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Failed to update manager mobile app access')
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
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const { exportAdminExcel } = await import('../utils/adminExport.js')
                const cols = [
                  { key: 'lodge_name', header: 'Lodge' },
                  { key: 'company_email', header: 'Email' },
                  { key: 'business_type', header: 'Type' },
                  { key: 'status_label', header: 'Status' },
                  { key: 'room_count', header: 'Rooms' },
                  { key: 'user_count', header: 'Users' },
                  { key: 'booking_count', header: 'Bookings' },
                  { key: 'created_at', header: 'Created' }
                ]
                const rows = visibleCompanies.map(c => {
                  const trial = getTrialInfo(c, licenses)
                  const rollup = getCompanyUsageRollup(usageStatsByLodge[c.lodge_id], licenses, c)
                  return {
                    ...c,
                    status_label: trial.label,
                    room_count: rollup.stats?.room_count ?? 0,
                    user_count: rollup.stats?.user_count ?? 0,
                    booking_count: rollup.stats?.booking_count ?? 0
                  }
                })
                await exportAdminExcel('Companies', rows, { columns: cols })
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            >
              Excel
            </button>
            <button
              onClick={async () => {
                const { exportAdminPdf } = await import('../utils/adminExport.js')
                const cols = [
                  { key: 'lodge_name', header: 'Lodge' },
                  { key: 'company_email', header: 'Email' },
                  { key: 'business_type', header: 'Type' },
                  { key: 'status_label', header: 'Status' },
                  { key: 'room_count', header: 'Rooms' },
                  { key: 'user_count', header: 'Users' },
                  { key: 'booking_count', header: 'Bookings' }
                ]
                const rows = visibleCompanies.map(c => {
                  const trial = getTrialInfo(c, licenses)
                  const rollup = getCompanyUsageRollup(usageStatsByLodge[c.lodge_id], licenses, c)
                  return {
                    ...c,
                    status_label: trial.label,
                    room_count: rollup.stats?.room_count ?? 0,
                    user_count: rollup.stats?.user_count ?? 0,
                    booking_count: rollup.stats?.booking_count ?? 0
                  }
                })
                await exportAdminPdf('Companies', rows, { columns: cols })
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            >
              PDF
            </button>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{showDisabled ? 'Archived Companies' : 'Operational Lodges'}</p>
          </div>
        </div>
        <div className="border-b border-gray-700 bg-gray-900/40 px-4 py-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={companySearch}
                onChange={e => setCompanySearch(e.target.value)}
                placeholder="Search companies..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
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
              {attentionRows.map(({ company, rollup, currentBookingsUsagePercent, peakBookingsUsagePercent }) => {
                const assignedPlan = getAssignedPlanForLodge(licenses, company?.lodge_id)
                const displayPlan = normalizePlanName(assignedPlan || rollup.plan || DEFAULT_PLAN)
                return (
                <button
                  key={company.lodge_id}
                  type="button"
                  onClick={() => openDetail(company)}
                  className="flex w-full items-start justify-between gap-4 rounded-xl border border-gray-700 bg-gray-800/70 px-3 py-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{company.lodge_name || '—'}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {displayPlan} · Bookings {currentBookingsUsagePercent}% · Peak {peakBookingsUsagePercent}% · Rooms {rollup.recommendation?.currentUsagePct?.rooms ?? 0}% · Users {rollup.recommendation?.currentUsagePct?.users ?? 0}%
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${rollup.cls}`}>{rollup.label}</span>
                    <p className="mt-1 text-xs font-semibold text-emerald-300">{rollup.recommendation?.recommendedPlan || displayPlan}</p>
                    <p className="text-[11px] text-gray-500">{rollup.recommendation?.reason || '—'}</p>
                  </div>
                </button>
                )
              })}
            </div>
          </div>
        )}
        {visibleCompanies.length === 0 && !loading ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <Building2 size={32} className="mx-auto mb-3 opacity-40" />
            <p>{showDisabled ? 'No companies found.' : 'No active companies found.'}</p>
            <p className="text-xs text-gray-500 mt-1">Companies appear here once they register or are imported.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <SortableHeader label="Business" sortKey="lodge_name" currentSortKey={companySortKey} currentSortDir={companySortDir} onToggle={toggleCompanySort} />
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Recommendation</th>
                <SortableHeader label="Location" sortKey="city" currentSortKey={companySortKey} currentSortDir={companySortDir} onToggle={toggleCompanySort} />
                <SortableHeader label="Contact" sortKey="email" currentSortKey={companySortKey} currentSortDir={companySortDir} onToggle={toggleCompanySort} />
                <SortableHeader label="Lodge ID" sortKey="lodge_id" currentSortKey={companySortKey} currentSortDir={companySortDir} onToggle={toggleCompanySort} />
                <th className="px-4 py-3 text-left">Last Activity</th>
                <SortableHeader label="Updated" sortKey="updated_at" currentSortKey={companySortKey} currentSortDir={companySortDir} onToggle={toggleCompanySort} />
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {paginatedCompanies.map((c) => (
                (() => {
                  const rollup = getCompanyUsageRollup(usageStatsByLodge[c.lodge_id], licenses, c)
                  const assignedPlan = getAssignedPlanForLodge(licenses, c?.lodge_id)
                  const displayPlan = normalizePlanName(assignedPlan || rollup.plan || DEFAULT_PLAN)
                  const bookingPct = rollup.recommendation?.currentUsagePct?.bookings ?? 0
                  const roomPct = rollup.recommendation?.currentUsagePct?.rooms ?? 0
                  const userPct = rollup.recommendation?.currentUsagePct?.users ?? 0
                  const bookingUsageText = displayPlan === 'Pro' ? 'Unlimited' : `${bookingPct}%`
                  const roomUsageText = displayPlan === 'Pro' ? 'Unlimited' : `${roomPct}%`
                  const userUsageText = displayPlan === 'Pro' ? 'Unlimited' : `${userPct}%`
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
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 font-semibold">{displayPlan}</span>
                      {c.deleted && <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-400 font-bold uppercase tracking-tight">Archived</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                      Bookings {bookingUsageText} · Rooms {roomUsageText} · Users {userUsageText}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-white">{rollup.recommendation?.recommendedPlan || displayPlan}</p>
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
        <Pagination page={companyPage} totalPages={companyTotalPages} onPageChange={setCompanyPage} />
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
            <div className="flex gap-1 bg-gray-700 rounded-lg p-0.5">
              {['overview', 'activity'].map(tab => (
                <button key={tab} onClick={() => setDetailTab(tab)}
                  className={`flex-1 text-[10px] py-1.5 rounded-md transition-colors capitalize ${detailTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {tab}
                </button>
              ))}
              <button onClick={() => setViewClient360(selected)}
                className="flex-1 text-[10px] py-1.5 rounded-md transition-colors text-purple-400 hover:text-purple-300">
                Full Profile
              </button>
            </div>
            {detailTab === 'overview' ? (
              <>
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
          <button
            onClick={() => handleRepairDuplicateEvents(selected)}
            disabled={repairLoading}
            className="w-full text-xs py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition-all disabled:opacity-50"
          >
            {repairLoading ? 'Repairing Events...' : 'Repair Duplicate Events'}
          </button>
              </>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Recent Activity</p>
                {activityLogs.filter(log => log.lodge_id === selected.lodge_id).slice(0, 10).length === 0 ? (
                  <p className="text-xs text-gray-500">No activity for this company</p>
                ) : (
                  activityLogs.filter(log => log.lodge_id === selected.lodge_id).slice(0, 10).map(log => (
                    <div key={log.id} className="flex items-start gap-2 py-1">
                      <span className="text-xs mt-0.5">{ACTION_ICON[log.action] || '📌'}</span>
                      <div className="min-w-0">
                        <p className="text-[11px] text-gray-300 truncate">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-[10px] text-gray-500">{timeAgo(log.created_at)}{log.actor_email ? ` · ${log.actor_email}` : ''}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
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
// SECTION: Feature Flags
// ════════════════════════════════════════════════════════════════════
function FeatureFlagSearch({ companies, selectedLodge, onSelect }) {
  const [search, setSearch] = useState('')
  const filtered = search
    ? companies.filter(c => c.lodge_name?.toLowerCase().includes(search.toLowerCase()) || c.lodge_id?.toLowerCase().includes(search.toLowerCase()))
    : companies
  return (
    <>
      <div className="px-3 py-2 border-b border-gray-700">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies..."
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500" />
      </div>
      <div className="divide-y divide-gray-700 max-h-[420px] overflow-y-auto">
        {filtered.map(c => (
          <button key={c.lodge_id} onClick={() => onSelect(c)}
            className={`w-full px-4 py-3 text-left text-sm transition-colors ${selectedLodge?.lodge_id === c.lodge_id ? 'bg-purple-600/20 text-purple-300' : 'text-gray-300 hover:bg-gray-700'}`}>
            <p className="font-medium truncate">{c.lodge_name || '—'}</p>
            <p className="text-xs text-gray-500">{BIZ_EMOJI[c.business_type]} {BIZ_LABEL[c.business_type]}</p>
          </button>
        ))}
        {filtered.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No companies match</p>}
      </div>
    </>
  )
}

function FeatureFlags({ companies, licenses }) {
  const toast = useToast()
  const [selectedLodge, setSelectedLodge] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(DEFAULT_PLAN)
  const [baseFlags, setBaseFlags] = useState(getPlanFlags(DEFAULT_PLAN))
  const [flags, setFlags] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadFlags = async (lodgeId, planName = DEFAULT_PLAN) => {
    setLoading(true)
    const data = await window.api.admin.getLodgeFeatures(lodgeId).catch(() => [])
    const map = getPlanFlags(planName)
    data.forEach(r => { map[r.feature_name] = r.enabled })
    setSelectedPlan(normalizePlanName(planName))
    setBaseFlags(getPlanFlags(planName))
    setFlags(map)
    setLoading(false)
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
    const errors = []
    await Promise.all(ALL_FEATURES.map(async (featureName) => {
      try {
        const isBaseValue = flags[featureName] === baseFlags[featureName]
        if (isBaseValue) {
          await window.api.admin.clearLodgeFeature(selectedLodge.lodge_id, featureName)
        } else {
          await window.api.admin.setLodgeFeature(selectedLodge.lodge_id, featureName, flags[featureName] !== false)
        }
      } catch (e) { errors.push(featureName) }
    }))
    setSaving(false)
    if (errors.length) { console.error('Feature flags save failed:', errors); toast.error('Some feature flags failed to save') }
    else { setSaved(true); toast.success('Feature flags saved'); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <div className="flex gap-5">
      {/* Company list */}
      <div className="w-56 shrink-0 bg-gray-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-700">Select Company</p>
        <FeatureFlagSearch companies={companies} selectedLodge={selectedLodge} onSelect={selectLodge} />
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
            {loading ? (
              <div className="py-12 text-center text-gray-500 animate-pulse">Loading feature flags...</div>
            ) : (
              <>
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
              </>
            )}
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
  const toast = useToast()
  const [broadcasts, setBroadcasts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', message: '', expires_at: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmState, setConfirmState] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await window.api.admin.getBroadcasts().catch(() => [])
    setBroadcasts(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      const r = await window.api.admin.createBroadcast({ ...form, expires_at: form.expires_at || null })
      if (r?.error) { console.error('Broadcast create failed:', r.error); toast.error('Failed to create broadcast: ' + r.error); setSaving(false); return }
      setForm({ title: '', message: '', expires_at: '' }); setShowForm(false); setSaving(false); load(); toast.success('Announcement posted successfully')
    } catch (e) { console.error('Broadcast create error:', e); toast.error('Failed to create broadcast'); setSaving(false) }
  }

  const toggle = async (b) => {
    try { await window.api.admin.updateBroadcast(b.id, { is_active: !b.is_active }); load() }
    catch (e) { console.error('Broadcast toggle error:', e); toast.error('Failed to toggle broadcast') }
  }
  const del = (b) => setConfirmState({ type: 'broadcast', item: b })
  const confirmDeleteBroadcast = async () => {
    if (!confirmState?.item) return
    try { await window.api.admin.deleteBroadcast(confirmState.item.id); load() }
    catch (e) { toast.error('Failed to delete broadcast') }
    setConfirmState(null)
  }

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
        {loading ? (
          <div className="px-6 py-16 text-center text-gray-500 animate-pulse">Loading announcements...</div>
        ) : broadcasts.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><Megaphone size={32} className="mx-auto mb-3 opacity-40" /><p>No announcements yet.</p><p className="text-xs text-gray-600 mt-1">Click "New Announcement" to create your first broadcast.</p></div>
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
function SupportTickets({ companies, onOpenCompany }) {
  const toast = useToast()
  const [tickets, setTickets] = useState([])
  const [filter, setFilter] = useState({ status: '', priority: '', q: '' })
  const [detail, setDetail] = useState(null)
  const [notes, setNotes] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmState, setConfirmState] = useState(null)

  const load = useCallback(async () => {
    const data = await window.api.admin.getSupportTickets({}).catch(() => [])
    setTickets(data)
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = (t) => { setDetail(t); setNotes(''); setNewStatus(t.status); setSaveError('') }

  const updateTicket = async () => {
    setSaving(true)
    setSaveError('')
    const body = notes.trim()
    try {
      const result = body && window.api.admin.addSupportTicketMessage
        ? await window.api.admin.addSupportTicketMessage(detail.id, {
          lodge_id: detail.lodge_id,
          body,
          status: newStatus,
          metadata: { source: 'command_central_support_tickets' }
        })
        : await window.api.admin.updateSupportTicket(detail.id, { status: newStatus })
      if (result?.success === false) throw new Error(result.error || 'Could not save ticket update')
      setSaving(false); setDetail(null); load()
    } catch (error) {
      setSaveError(error?.message || 'Could not save ticket update')
      setSaving(false)
    }
  }

  const del = (t) => setConfirmState({ type: 'ticket', item: t })
  const confirmDeleteTicket = async () => {
    if (!confirmState?.item) return
    await window.api.admin.deleteSupportTicket(confirmState.item.id)
    load()
    setConfirmState(null)
  }

  const filtered = tickets.filter(t => {
    if (filter.status && t.status !== filter.status) return false
    if (filter.priority && t.priority !== filter.priority) return false
    if (filter.q && !t.title.toLowerCase().includes(filter.q.toLowerCase()) && !(t.lodge_name || '').toLowerCase().includes(filter.q.toLowerCase())) return false
    return true
  })

  const openCount = tickets.filter(t => ['open', 'acknowledged', 'in_progress'].includes(t.status)).length

  const { sorted: sortedTickets, sortKey: ticketSortKey, sortDir: ticketSortDir, toggleSort: toggleTicketSort } = useTableSort(filtered, 'created_at', 'desc')

  const { page: ticketPage, setPage: setTicketPage, totalPages: ticketTotalPages, paginated: paginatedTickets } = usePagination(sortedTickets)

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
            {['open', 'acknowledged', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none" value={filter.priority} onChange={e => setFilter({ ...filter, priority: e.target.value })}>
            <option value="">All Priority</option>
            {['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={async () => {
              const { exportAdminExcel } = await import('../utils/adminExport.js')
              const cols = [
                { key: 'lodge_name', header: 'Lodge' },
                { key: 'title', header: 'Title' },
                { key: 'category', header: 'Category' },
                { key: 'priority', header: 'Priority' },
                { key: 'status', header: 'Status' },
                { key: 'created_at', header: 'Created' }
              ]
              await exportAdminExcel('Support Tickets', filtered, { columns: cols })
            }}
            className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
          >
            Excel
          </button>
          <button
            onClick={async () => {
              const { exportAdminPdf } = await import('../utils/adminExport.js')
              const cols = [
                { key: 'lodge_name', header: 'Lodge' },
                { key: 'title', header: 'Title' },
                { key: 'category', header: 'Category' },
                { key: 'priority', header: 'Priority' },
                { key: 'status', header: 'Status' },
                { key: 'created_at', header: 'Created' }
              ]
              await exportAdminPdf('Support Tickets', filtered, { columns: cols })
            }}
            className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
          >
            PDF
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><LifeBuoy size={32} className="mx-auto mb-3 opacity-40" /><p>No tickets found.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <SortableHeader label="Lodge" sortKey="lodge_name" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <SortableHeader label="Title" sortKey="title" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <SortableHeader label="Category" sortKey="category" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <SortableHeader label="Priority" sortKey="priority" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <SortableHeader label="Status" sortKey="status" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <SortableHeader label="Created" sortKey="created_at" currentSortKey={ticketSortKey} currentSortDir={ticketSortDir} onToggle={toggleTicketSort} />
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {paginatedTickets.map(t => (
                <tr key={t.id} className="hover:bg-gray-700 transition-colors cursor-pointer" onClick={() => openDetail(t)}>
                  <td className="px-4 py-3 text-xs">
                    <button onClick={(e) => { e.stopPropagation(); const c = companies.find(co => co.lodge_id === t.lodge_id); if (c && onOpenCompany) onOpenCompany(c) }} className="text-purple-400 hover:text-purple-300 hover:underline truncate max-w-[120px] block">{t.lodge_name || t.lodge_id?.slice(0, 8)}</button>
                  </td>
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
        <Pagination page={ticketPage} totalPages={ticketTotalPages} onPageChange={setTicketPage} />
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
                <div className="rounded-xl border border-gray-700 bg-gray-900 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Inbox Conversation</p>
                      <p className="mt-1 text-xs text-gray-400">Lodge: {detail.lodge_name || detail.lodge_id}</p>
                    </div>
                    <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300">
                      {normalizeSupportMessages(detail).length} message{normalizeSupportMessages(detail).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                    {normalizeSupportMessages(detail).map((message) => {
                      const isManager = supportMessageSide(message) === 'manager'
                      return (
                        <div key={message.id} className={`flex ${isManager ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[84%] rounded-2xl px-4 py-3 ${
                            isManager
                              ? 'rounded-bl-md border border-gray-700 bg-gray-800 text-gray-100'
                              : 'rounded-br-md bg-emerald-700 text-white'
                          }`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isManager ? 'text-gray-400' : 'text-emerald-100'}`}>
                                  {supportSenderName(message)}
                                </p>
                                {supportSenderMeta(message) && (
                                  <p className={`mt-0.5 text-[11px] ${isManager ? 'text-gray-500' : 'text-emerald-100/75'}`}>
                                    {supportSenderMeta(message)}
                                  </p>
                                )}
                              </div>
                              <span className={`shrink-0 text-[11px] ${isManager ? 'text-gray-500' : 'text-emerald-100/75'}`}>
                                {timeAgo(message.created_at)}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
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
                    {['open', 'acknowledged', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Reply">
                  <textarea className={`${inp} h-24 resize-none`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Write the next reply in this inbox conversation…" />
                </Field>
                {saveError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {saveError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setDetail(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
                  <button onClick={updateTicket} disabled={saving} className={`flex-1 ${btn()} py-2 rounded-lg text-sm font-medium disabled:opacity-60`}>{saving ? 'Saving...' : notes.trim() ? 'Send Reply' : 'Save Status'}</button>
                </div>
              </div>
            )
          })()}
        </Modal>
      )}
      <DarkConfirmDialog open={!!confirmState?.type === 'ticket'} title="Delete ticket?" message="This cannot be undone." confirmLabel="Delete" onConfirm={confirmDeleteTicket} onCancel={() => setConfirmState(null)} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Activity Log
// ════════════════════════════════════════════════════════════════════
function ActivityLog({ companies, onOpenCompany }) {
  const [logs, setLogs] = useState([])
  const [summary, setSummary] = useState([])
  const [filter, setFilter] = useState({ lodge_id: '', start: '', end: '' })
  const [limit, setLimit] = useState(100)
  const [logSearch, setLogSearch] = useState('')

  const load = useCallback(async () => {
    const [data, sum] = await Promise.all([
      window.api.admin.getActivityLogs({ ...filter, limit }).catch(() => []),
      window.api.admin.getAuditSummary({ start: filter.start || null, end: filter.end || null }).catch(() => [])
    ])
    setLogs(data)
    setSummary(sum)
  }, [filter, limit])

  useEffect(() => { load() }, [load])

  const { page: logPage, setPage: setLogPage, totalPages: logTotalPages, paginated: paginatedLogs } = usePagination(logs)

  const filteredLogs = logSearch
    ? paginatedLogs.filter(log =>
        log.action?.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.actor_email?.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.lodge_name?.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.entity_type?.toLowerCase().includes(logSearch.toLowerCase())
      )
    : paginatedLogs

  return (
    <div className="space-y-4">
      {/* Audit summary cards */}
      {summary.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">Audit Summary</p>
          <div className="flex flex-wrap gap-2">
            {summary.map(s => (
              <div key={s.action} className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
                <span className="text-base">{ACTION_ICON[s.action] || '📌'}</span>
                <div>
                  <p className="text-sm text-gray-200">{s.action.replace(/_/g, ' ')}</p>
                  <p className="text-[10px] text-gray-500">{s.count}× &middot; last {timeAgo(s.last_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <button
          onClick={async () => {
            const { exportAdminExcel } = await import('../utils/adminExport.js')
            const cols = [
              { key: 'created_at', header: 'Time' },
              { key: 'action', header: 'Action' },
              { key: 'actor_email', header: 'Actor' },
              { key: 'entity_type', header: 'Entity Type' },
              { key: 'entity_id', header: 'Entity ID' },
              { key: 'lodge_name', header: 'Lodge' },
              { key: 'lodge_id', header: 'Lodge ID' },
              { key: 'details', header: 'Details' }
            ]
            await exportAdminExcel('Admin Audit Log', logs, { columns: cols })
          }}
          className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
        >
          Excel
        </button>
        <button
          onClick={async () => {
            const { exportAdminPdf } = await import('../utils/adminExport.js')
            const cols = [
              { key: 'created_at', header: 'Time' },
              { key: 'action', header: 'Action' },
              { key: 'actor_email', header: 'Actor' },
              { key: 'entity_type', header: 'Entity Type' },
              { key: 'lodge_name', header: 'Lodge' },
              { key: 'details', header: 'Details' }
            ]
            await exportAdminPdf('Admin Audit Log', logs, { columns: cols })
          }}
          className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
        >
          PDF
        </button>
      </div>

      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={logSearch}
          onChange={e => setLogSearch(e.target.value)}
          placeholder="Search actions, actors..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {logs.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500"><Activity size={32} className="mx-auto mb-3 opacity-40" /><p>No audit entries yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-700">
            {filteredLogs.map(log => (
              <div key={log.id} className="flex items-start gap-3 px-5 py-3">
                <span className="text-base mt-0.5">{ACTION_ICON[log.action] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-200">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500 shrink-0 ml-3">{timeAgo(log.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <button onClick={() => { const c = companies.find(co => co.lodge_id === log.lodge_id); if (c && onOpenCompany) onOpenCompany(c) }} className="text-xs text-purple-400 hover:text-purple-300 hover:underline">{log.lodge_name || log.lodge_id?.slice(0, 16)}</button>
                    {log.actor_email && (
                      <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">by {log.actor_email}</span>
                    )}
                    {log.entity_type && (
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{log.entity_type}{log.entity_id ? `#${log.entity_id?.slice(0, 8)}` : ''}</span>
                    )}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{JSON.stringify(log.details).slice(0, 120)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
function InvoicePreview({ invoice, onClose, taxRate = DEFAULT_TAX_RATE }) {
  if (!invoice) return null

  const subtotal = Number(invoice.amount) || 0
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

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
                  <td className="py-5 text-right">{invoice.currency} {subtotal.toFixed(2)}</td>
                  <td className="py-5 text-right font-bold">{invoice.currency} {subtotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-6">
            <div className="w-64 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal:</span>
                <span className="font-semibold text-gray-900">{invoice.currency} {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax ({taxRate}%):</span>
                <span className="font-semibold text-gray-900">{invoice.currency} {taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t-2 border-gray-900">
                <span className="font-black uppercase tracking-tighter text-gray-900">Total Amount:</span>
                <span className="font-black text-xl text-purple-900">{invoice.currency} {total.toFixed(2)}</span>
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
  const toast = useToast()
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
    status: 'paid', issued_date: localToday(),
    due_date: '', paid_date: localToday(), description: '', notes: ''
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  // Expenses state
  const [expenses, setExpenses] = useState([])
  const [showCreateExpense, setShowCreateExpense] = useState(false)
  const [editExpense, setEditExpense] = useState(null)
  const [expenseForm, setExpenseForm] = useState({
    date: localToday(),
    category: 'Infrastructure',
    amount: '',
    currency: 'BWP',
    description: '',
    vendor: ''
  })
  const [viewingInvoice, setViewingInvoice] = useState(null)
  const [confirmState, setConfirmState] = useState(null)

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

  const { sorted: sortedInvoices, sortKey: invSortKey, sortDir: invSortDir, toggleSort: toggleInvSort } = useTableSort(filtered, 'issued_date', 'desc')

  const { page: invPage, setPage: setInvPage, totalPages: invTotalPages, paginated: paginatedInvoices } = usePagination(sortedInvoices)
  const { sorted: sortedExpenses, sortKey: expSortKey, sortDir: expSortDir, toggleSort: toggleExpSort } = useTableSort(expenses, 'date', 'desc')

  const { page: expPage, setPage: setExpPage, totalPages: expTotalPages, paginated: paginatedExpenses } = usePagination(sortedExpenses)

  const handleCreateInvoice = async (e) => {
    e.preventDefault(); setCreateError(''); setCreateSaving(true)
    if (!createForm.amount || Number(createForm.amount) <= 0) { setCreateError('Enter a valid amount.'); setCreateSaving(false); return }
    const invNum = await window.api.admin.getNextInvoiceNumber().catch(() => null)
    if (!invNum || typeof invNum !== 'string') { setCreateError('Could not generate invoice number.'); setCreateSaving(false); return }
    const r = await window.api.admin.createInvoice({ ...createForm, invoice_number: invNum, amount: Number(createForm.amount), due_date: createForm.due_date || null, paid_date: createForm.paid_date || null, description: createForm.description || null, notes: createForm.notes || null }).catch(e => ({ error: e.message }))
    if (r?.error) { setCreateError(r.error); setCreateSaving(false); return }
    setShowCreate(false)
    setCreateForm({ lodge_id: '', lodge_name: '', package_name: DEFAULT_PLAN, amount: '', currency: 'BWP', status: 'paid', issued_date: localToday(), due_date: '', paid_date: localToday(), description: '', notes: '' })
    loadData()
    setCreateSaving(false)
  }

  const handleSaveEdit = async () => {
    if (!editInvoice) return
    try {
      await window.api.admin.updateInvoice(editInvoice.id, {
        package_name: editInvoice.package_name, amount: Number(editInvoice.amount),
        currency: editInvoice.currency, status: editInvoice.status,
        paid_date: editInvoice.paid_date || null, due_date: editInvoice.due_date || null,
        description: editInvoice.description || null, notes: editInvoice.notes || null
      })
      setEditInvoice(null); loadData()
    } catch (e) { console.error('Invoice update error:', e); toast.error('Failed to update invoice') }
  }

  const handleDelete = (id) => setConfirmState({ type: 'invoice', id })
  const confirmDeleteInvoice = async () => {
    if (!confirmState?.id) return
    try {
      await window.api.admin.deleteInvoice(confirmState.id)
      loadData()
    } catch (e) { toast.error('Failed to delete invoice') }
    setConfirmState(null)
  }

  const handleSendEmail = async (inv) => {
    const company = companies.find(c => c.lodge_id === inv.lodge_id)
    const to = company?.email
    if (!to) { toast.warning('No email address found for this company.'); return }
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
    } else toast.error('Email failed: ' + r.error)
  }

  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthTotal = summary?.byMonth?.find(m => m.month === thisMonth)?.amount || 0
  const pendingCount = invoices.filter(i => ['draft', 'sent', 'overdue'].includes(i.status)).length

  const handleCreateExpense = async (e) => {
    e.preventDefault()
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) return
    try {
      await window.api.admin.createExpense(expenseForm)
      setExpenseForm({ date: localToday(), category: 'Infrastructure', amount: '', currency: 'BWP', description: '', vendor: '' })
      setShowCreateExpense(false)
      loadData()
    } catch (e) { console.error('Expense create error:', e); toast.error('Failed to create expense') }
  }

  const handleDeleteExpense = (id) => setConfirmState({ type: 'expense', id })
  const confirmDeleteExpense = async () => {
    if (!confirmState?.id) return
    try {
      await window.api.admin.deleteExpense(confirmState.id)
      loadData()
    } catch (e) { toast.error('Failed to delete expense') }
    setConfirmState(null)
  }

  const handleSaveEditExpense = async () => {
    if (!editExpense) return
    try {
      await window.api.admin.updateExpense(editExpense.id, {
        date: editExpense.date, category: editExpense.category,
        amount: Number(editExpense.amount), currency: editExpense.currency,
        description: editExpense.description, vendor: editExpense.vendor
      })
      setEditExpense(null); loadData()
    } catch (e) { console.error('Expense update error:', e); toast.error('Failed to update expense') }
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
            <button
              onClick={async () => {
                const { exportAdminExcel } = await import('../utils/adminExport.js')
                const cols = [
                  { key: 'invoice_number', header: 'Invoice #' },
                  { key: 'lodge_name', header: 'Company' },
                  { key: 'package_name', header: 'Plan' },
                  { key: 'amount', header: 'Amount' },
                  { key: 'currency', header: 'Currency' },
                  { key: 'status', header: 'Status' },
                  { key: 'issued_date', header: 'Issued' },
                  { key: 'due_date', header: 'Due' }
                ]
                const rows = filtered
                await exportAdminExcel('Invoices', rows, { columns: cols })
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            >
              Excel
            </button>
            <button
              onClick={async () => {
                const { exportAdminPdf } = await import('../utils/adminExport.js')
                const cols = [
                  { key: 'invoice_number', header: 'Invoice #' },
                  { key: 'lodge_name', header: 'Company' },
                  { key: 'package_name', header: 'Plan' },
                  { key: 'amount', header: 'Amount' },
                  { key: 'currency', header: 'Currency' },
                  { key: 'status', header: 'Status' },
                  { key: 'issued_date', header: 'Issued' }
                ]
                const rows = filtered
                await exportAdminPdf('Invoices', rows, { columns: cols })
              }}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            >
              PDF
            </button>
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
              <div className="p-8 text-center text-gray-500"><Receipt size={28} className="mx-auto mb-2 opacity-40" /><p className="text-sm">No invoices found.</p><p className="text-xs text-gray-500 mt-1">Create an invoice using the button above.</p></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <SortableHeader label="Invoice #" sortKey="invoice_number" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <SortableHeader label="Company" sortKey="lodge_name" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <SortableHeader label="Package" sortKey="package_name" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <SortableHeader label="Amount" sortKey="amount" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <SortableHeader label="Status" sortKey="status" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <SortableHeader label="Date" sortKey="issued_date" currentSortKey={invSortKey} currentSortDir={invSortDir} onToggle={toggleInvSort} />
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInvoices.map((inv, i) => (
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
            <Pagination page={invPage} totalPages={invTotalPages} onPageChange={setInvPage} />
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
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const { exportAdminExcel } = await import('../utils/adminExport.js')
                  const cols = [
                    { key: 'date', header: 'Date' },
                    { key: 'category', header: 'Category' },
                    { key: 'vendor', header: 'Vendor' },
                    { key: 'description', header: 'Description' },
                    { key: 'amount', header: 'Amount' },
                    { key: 'currency', header: 'Currency' }
                  ]
                  await exportAdminExcel('Expenses', expenses, { columns: cols })
                }}
                className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              >
                Excel
              </button>
              <button
                onClick={async () => {
                  const { exportAdminPdf } = await import('../utils/adminExport.js')
                  const cols = [
                    { key: 'date', header: 'Date' },
                    { key: 'category', header: 'Category' },
                    { key: 'vendor', header: 'Vendor' },
                    { key: 'description', header: 'Description' },
                    { key: 'amount', header: 'Amount' },
                    { key: 'currency', header: 'Currency' }
                  ]
                  await exportAdminPdf('Expenses', expenses, { columns: cols })
                }}
                className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              >
                PDF
              </button>
              <button onClick={() => setShowCreateExpense(v => !v)} className={`flex items-center gap-1.5 ${btn()} px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap`}>
                <Plus size={13} /> Add Expense
              </button>
            </div>
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
                    <SortableHeader label="Date" sortKey="date" currentSortKey={expSortKey} currentSortDir={expSortDir} onToggle={toggleExpSort} />
                    <SortableHeader label="Category" sortKey="category" currentSortKey={expSortKey} currentSortDir={expSortDir} onToggle={toggleExpSort} />
                    <SortableHeader label="Vendor" sortKey="vendor" currentSortKey={expSortKey} currentSortDir={expSortDir} onToggle={toggleExpSort} />
                    <SortableHeader label="Description" sortKey="description" currentSortKey={expSortKey} currentSortDir={expSortDir} onToggle={toggleExpSort} />
                    <SortableHeader label="Amount" sortKey="amount" currentSortKey={expSortKey} currentSortDir={expSortDir} onToggle={toggleExpSort} />
                    <th className="px-4 py-3 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedExpenses.map(exp => (
                    <tr key={exp.id} className="border-t border-gray-700 hover:bg-gray-750">
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmt(exp.date)}</td>
                      <td className="px-4 py-3 text-purple-300 text-xs">{exp.category}</td>
                      <td className="px-4 py-3 text-gray-200 text-xs">{exp.vendor}</td>
                      <td className="px-4 py-3 text-gray-300 text-xs">{exp.description}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white text-xs">{exp.currency} {Number(exp.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button title="Edit" onClick={() => setEditExpense({ ...exp })} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-purple-400 transition-colors">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => handleDeleteExpense(exp.id)} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pagination page={expPage} totalPages={expTotalPages} onPageChange={setExpPage} />
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setEditInvoice(null) }} tabIndex={-1} autoFocus>
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

      {/* Edit expense modal */}
      {editExpense && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onKeyDown={(e) => { if (e.key === 'Escape') setEditExpense(null) }} tabIndex={-1} autoFocus>
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md space-y-3 border border-gray-700">
            <div className="flex justify-between items-center">
              <h3 className="text-white font-semibold">Edit Expense</h3>
              <button onClick={() => setEditExpense(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input type="date" className={inp} value={editExpense.date} onChange={e => setEditExpense(v => ({ ...v, date: e.target.value }))} />
              </Field>
              <Field label="Category">
                <select className={inp} value={editExpense.category} onChange={e => setEditExpense(v => ({ ...v, category: e.target.value }))}>
                  {['Infrastructure', 'Development', 'Marketing', 'Legal', 'Payroll', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Amount">
                <input type="number" step="0.01" className={inp} value={editExpense.amount} onChange={e => setEditExpense(v => ({ ...v, amount: e.target.value }))} />
              </Field>
              <Field label="Currency">
                <select className={inp} value={editExpense.currency} onChange={e => setEditExpense(v => ({ ...v, currency: e.target.value }))}>
                  {INVOICE_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Vendor">
                <input className={inp} value={editExpense.vendor} onChange={e => setEditExpense(v => ({ ...v, vendor: e.target.value }))} />
              </Field>
            </div>
            <Field label="Description">
              <input className={inp} value={editExpense.description} onChange={e => setEditExpense(v => ({ ...v, description: e.target.value }))} />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditExpense(null)} className={`flex-1 ${btn('ghost')} py-2 rounded-lg text-sm`}>Cancel</button>
              <button onClick={handleSaveEditExpense} className={`flex-1 ${btn()} py-2 rounded-lg text-sm`}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      <DarkConfirmDialog open={confirmState?.type === 'invoice'} title="Delete invoice?" message="This action cannot be undone." confirmLabel="Delete" onConfirm={confirmDeleteInvoice} onCancel={() => setConfirmState(null)} />
      <DarkConfirmDialog open={confirmState?.type === 'expense'} title="Delete expense?" message="This action cannot be undone." confirmLabel="Delete" onConfirm={confirmDeleteExpense} onCancel={() => setConfirmState(null)} />

      <InvoicePreview invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MAIN: AdminCentral
// ════════════════════════════════════════════════════════════════════
const NAV_GROUPS = [
  {
    label: 'Command',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, tip: 'Business metrics, executive cockpit, and company overview' },
      { id: 'companies', label: 'Companies', icon: Building2, tip: 'Manage lodge and hotel accounts' },
      { id: 'licensing', label: 'Licensing', icon: CreditCard, tip: 'Manage plans, trials, license keys, and subscription requests' },
      { id: 'finance', label: 'Finance Office', icon: DollarSign, tip: 'Revenue reports, invoices, and bookkeeping' },
    ]
  },
  {
    label: 'Client Work',
    items: [
      { id: 'client-desk', label: 'Client Desk', icon: LifeBuoy, tip: 'Support tickets and sales leads' },
      { id: 'communications', label: 'Communications', icon: Bell, tip: 'Notifications, broadcasts, and email delivery settings' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { id: 'platform', label: 'Platform Operations', icon: Server, tip: 'System health, surfaces, fleet, and releases' },
      { id: 'activity', label: 'Activity Log', icon: Activity, tip: 'Audit trail of all admin actions' },
    ]
  },
  {
    label: 'Implementation',
    items: [
      { id: 'implementation', label: 'Add-ons', icon: Rocket, tip: 'Website builds, payment setup, and Enterprise workflow readiness' },
    ]
  },
  {
    label: 'Tools',
    items: [
      { id: 'tools', label: 'Admin Tools', icon: Search, tip: 'Global search, bulk actions, and test reset' },
    ]
  }
]

function SectionTabs({ tabs, active, onChange }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-gray-900/80 p-1">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            active === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
          }`}
        >
          {Icon && <Icon size={14} />}
          {label}
        </button>
      ))}
    </div>
  )
}

function DashboardHub({ companies, licenses, tickets, activityLogs, onOpenCompany, initialTab = 'overview' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'executive', label: 'Executive Cockpit', icon: BarChart3 }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'overview'
        ? <Dashboard companies={companies} licenses={licenses} tickets={tickets} activityLogs={activityLogs} onOpenCompany={onOpenCompany} />
        : <ExecutiveCockpit companies={companies} licenses={licenses} tickets={tickets} activityLogs={activityLogs} />}
    </div>
  )
}

function LicensingHub({ companies, licenses, tickets, onRefresh, initialTab = 'workbench' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'workbench', label: 'Licensing Workbench', icon: CreditCard },
    { id: 'requests', label: 'Subscription Requests', icon: FileText }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'workbench'
        ? <LicensingWorkbench companies={companies} licenses={licenses} tickets={tickets} onRefresh={onRefresh} />
        : <SubscriptionRequests companies={companies} licenses={licenses} />}
    </div>
  )
}

function ClientDesk({ companies, onOpenCompany, initialTab = 'support' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'support', label: 'Support Tickets', icon: LifeBuoy },
    { id: 'leads', label: 'Marketing Leads', icon: Users }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'support'
        ? <SupportTickets companies={companies} onOpenCompany={onOpenCompany} />
        : <Leads />}
    </div>
  )
}

function CommunicationsHub({ companies, onOpenCompany, initialTab = 'notifications' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone },
    { id: 'email', label: 'Email Config', icon: Mail }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'notifications' && <Notifications onOpenCompany={onOpenCompany} companies={companies} />}
      {tab === 'broadcasts' && <Broadcasts />}
      {tab === 'email' && <EmailSettings />}
    </div>
  )
}

function PlatformOperations({ companies, onOpenCompany, initialTab = 'health' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'health', label: 'System Health', icon: Shield },
    { id: 'surfaces', label: 'Surface Intelligence', icon: Activity },
    { id: 'fleet', label: 'Fleet', icon: Server },
    { id: 'releases', label: 'Releases', icon: Rocket }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'health' && <SystemHealth />}
      {tab === 'surfaces' && <SurfaceIntelligence />}
      {tab === 'fleet' && <Fleet onOpenCompany={onOpenCompany} companies={companies} />}
      {tab === 'releases' && <Releases />}
    </div>
  )
}

function ImplementationAddons() {
  const [tab, setTab] = useState('website')
  const tabs = [
    { id: 'website', label: 'Website Build', icon: Rocket },
    { id: 'payment-readiness', label: 'Payment Links Readiness', icon: CheckSquare },
    { id: 'gateway', label: 'Payment Gateway Setup', icon: CreditCard }
  ]
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Implementation & Add-ons</p>
        <h2 className="mt-2 text-xl font-bold text-white">Website, payment, and Enterprise workflow readiness</h2>
        <p className="mt-2 max-w-3xl text-sm text-gray-300">
          This Command Central area is reserved for Boroko-managed add-on setup. Website Build, Payment Gateway Setup,
          Payment Links Readiness, and Enterprise workflow checklists should be mounted here as internal/admin tools.
        </p>
      </div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="rounded-xl border border-gray-800 bg-gray-950/40">
        {tab === 'website' && <EnterpriseWorkflowWorkspace workflowKey="custom_website" />}
        {tab === 'payment-readiness' && <EnterpriseWorkflowWorkspace workflowKey="payment_gateway" />}
        {tab === 'gateway' && <PaymentGatewayConfig />}
      </div>
    </div>
  )
}

function AdminTools({ companies, onNavigate, onOpenCompany, initialTab = 'search' }) {
  const [tab, setTab] = useState(initialTab)
  const tabs = [
    { id: 'search', label: 'Global Search', icon: Search },
    { id: 'bulk', label: 'Bulk Actions', icon: CheckSquare },
    { id: 'test-reset', label: 'Test Reset', icon: Trash2 }
  ]
  return (
    <div>
      <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'search' && <GlobalSearch onNavigate={onNavigate} onOpenCompany={onOpenCompany} companies={companies} />}
      {tab === 'bulk' && <BulkActions />}
      {tab === 'test-reset' && <TestResetMaintenance companies={companies} />}
    </div>
  )
}

function FinanceOffice({ companies }) {
  const [tab, setTab] = useState('accounting')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
        <button
          onClick={() => setTab('accounting')}
          className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${tab === 'accounting' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          Accounting
        </button>
        <button
          onClick={() => setTab('bookkeeping')}
          className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${tab === 'bookkeeping' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          Bookkeeping
        </button>
      </div>
      {tab === 'accounting' ? <AccountingDashboard /> : <Bookkeeping companies={companies} />}
    </div>
  )
}

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

// ════════════════════════════════════════════════════════════════════
// Sales CRM — pipeline view
// ════════════════════════════════════════════════════════════════════
const STAGES = [
  { id: 'new', label: 'New', color: 'bg-blue-500/20 text-blue-300', dot: 'bg-blue-400' },
  { id: 'contacted', label: 'Contacted', color: 'bg-amber-500/20 text-amber-300', dot: 'bg-amber-400' },
  { id: 'demo_scheduled', label: 'Demo Scheduled', color: 'bg-purple-500/20 text-purple-300', dot: 'bg-purple-400' },
  { id: 'proposal_sent', label: 'Proposal Sent', color: 'bg-cyan-500/20 text-cyan-300', dot: 'bg-cyan-400' },
  { id: 'won', label: 'Won', color: 'bg-green-500/20 text-green-300', dot: 'bg-green-400' },
  { id: 'lost', label: 'Lost', color: 'bg-red-500/20 text-red-300', dot: 'bg-red-400' }
]

function LeadDrawer({ lead, onClose, onUpdate }) {
  if (!lead) return null
  const stage = lead.stage || lead.status || 'new'
  const stageObj = STAGES.find(s => s.id === stage)
  const isOverdue = lead.follow_up_at && new Date(lead.follow_up_at) < new Date() && !['won', 'lost'].includes(stage)

  const activityTimeline = [
    lead.created_at && { time: lead.created_at, action: 'Lead created', detail: `from ${lead.source || 'website'}` },
    lead.updated_at && lead.updated_at !== lead.created_at && { time: lead.updated_at, action: 'Last updated', detail: lead.sales_notes ? 'notes added' : 'details changed' },
    lead.follow_up_at && { time: lead.follow_up_at, action: isOverdue ? 'Follow-up overdue' : 'Follow-up scheduled', detail: new Date(lead.follow_up_at).toLocaleDateString() },
  ].filter(Boolean).sort((a, b) => new Date(b.time) - new Date(a.time))

  const quickActions = [
    { label: 'Mark Contacted', stage: 'contacted', hidden: stage !== 'new' },
    { label: 'Schedule Demo', stage: 'demo_scheduled', hidden: !['new', 'contacted'].includes(stage) },
    { label: 'Send Proposal', stage: 'proposal_sent', hidden: !['demo_scheduled'].includes(stage) },
    { label: 'Mark Won', stage: 'won', hidden: ['won', 'lost'].includes(stage) },
    { label: 'Mark Lost', stage: 'lost', hidden: ['won', 'lost'].includes(stage) },
  ].filter(a => !a.hidden)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} tabIndex={-1} autoFocus>
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold text-sm">{lead.contact_name}</h3>
            <p className="text-[11px] text-gray-400">{lead.lodge_name} | {lead.email || 'No email'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4">
          {/* Stage + Value */}
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-lg p-2 text-center border ${stageObj?.color?.split(' ')[0] || 'bg-gray-750'} border-gray-700`}>
              <p className="text-[10px] text-gray-400 uppercase">Stage</p>
              <p className={`text-xs font-semibold ${stageObj?.color?.split(' ')[1] || 'text-white'}`}>{stageObj?.label || stage}</p>
            </div>
            <div className="bg-gray-750 border border-gray-700 rounded-lg p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Value</p>
              <p className="text-xs font-bold text-white">{lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '—'}</p>
            </div>
            <div className="bg-gray-750 border border-gray-700 rounded-lg p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Probability</p>
              <p className="text-xs font-bold text-white">{lead.probability || 0}%</p>
            </div>
          </div>

          {/* Quick Actions */}
          {quickActions.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase mb-2">Quick Actions</p>
              <div className="flex flex-wrap gap-2">
                {quickActions.map(a => (
                  <button key={a.stage} onClick={() => onUpdate(lead.id, a.stage)}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 transition-colors border border-purple-500/30">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contact info */}
          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Contact Details</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-500">Phone:</span> <span className="text-white">{lead.phone || '—'}</span></div>
              <div><span className="text-gray-500">Source:</span> <span className="text-white">{lead.source || 'website'}</span></div>
              <div><span className="text-gray-500">Interest:</span> <span className="text-white">{lead.interest || '—'}</span></div>
              <div><span className="text-gray-500">Country:</span> <span className="text-white">{lead.country || '—'}</span></div>
            </div>
          </div>

          {/* Sales notes */}
          {lead.sales_notes && (
            <div className="border-t border-gray-700 pt-3">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Sales Notes</p>
              <p className="text-xs text-gray-300 bg-gray-750 rounded-lg p-2 whitespace-pre-wrap">{lead.sales_notes}</p>
            </div>
          )}

          {/* Lost reason */}
          {lead.lost_reason && (
            <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3">
              <p className="text-[10px] text-red-400 uppercase mb-1">Lost Reason</p>
              <p className="text-xs text-red-300">{lead.lost_reason}</p>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Activity Timeline</p>
            <div className="space-y-2">
              {activityTimeline.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-white font-medium">{item.action}</p>
                    <p className="text-[10px] text-gray-500">{item.detail} | {new Date(item.time).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
              {activityTimeline.length === 0 && (
                <p className="text-[11px] text-gray-500">No activity recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filterStage, setFilterStage] = useState('')
  const [filterInterest, setFilterInterest] = useState('')
  const [updating, setUpdating] = useState(null)
  const [viewMode, setViewMode] = useState('table') // table | pipeline
  const [editingLead, setEditingLead] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [selectedLead, setSelectedLead] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = {}
      if (filterStage) filters.stage = filterStage
      if (filterInterest) filters.interest = filterInterest
      const result = await window.api.admin.getMarketingLeads(filters)
      const allLeads = Array.isArray(result) ? result : (result?.leads || [])
      setLeads(allLeads.filter(l => l.status !== 'dropped'))
    } catch (e) { setError(e?.message || 'Failed to load leads') }
    setLoading(false)
  }, [filterStage, filterInterest])

  useEffect(() => { load() }, [load])

  const { sorted: sortedLeads, sortKey: leadSortKey, sortDir: leadSortDir, toggleSort: toggleLeadSort } = useTableSort(leads, 'created_at', 'desc')

  const { page: leadPage, setPage: setLeadPage, totalPages: leadTotalPages, paginated: paginatedLeads } = usePagination(sortedLeads)

  const updateStage = async (id, stage) => {
    setUpdating(id)
    try {
      await window.api.admin.updateLeadCrm(id, { stage })
      await load()
    } finally { setUpdating(null) }
  }

  const saveCrm = async () => {
    if (!editingLead) return
    setUpdating(editingLead.id)
    try {
      await window.api.admin.updateLeadCrm(editingLead.id, editForm)
      setEditingLead(null)
      setEditForm({})
      await load()
    } finally { setUpdating(null) }
  }

  const startEdit = (lead) => {
    setEditingLead(lead)
    setEditForm({
      stage: lead.stage || lead.status || 'new',
      follow_up_at: lead.follow_up_at ? new Date(lead.follow_up_at).toISOString().slice(0, 16) : '',
      sales_notes: lead.sales_notes || '',
      estimated_value: lead.estimated_value || 0,
      probability: lead.probability || 0,
      lost_reason: lead.lost_reason || ''
    })
  }

  const stageColor = (s) => STAGES.find(st => st.id === s)?.color || 'bg-gray-500/20 text-gray-300'

  const overdueFollowUps = leads.filter(l => l.follow_up_at && new Date(l.follow_up_at) < new Date() && !['won', 'lost'].includes(l.stage || l.status))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Sales Pipeline</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode(v => v === 'table' ? 'pipeline' : 'table')}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
            {viewMode === 'table' ? 'Pipeline View' : 'Table View'}
          </button>
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Overdue follow-ups */}
      {overdueFollowUps.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">{overdueFollowUps.length} overdue follow-up(s)</p>
          <p className="text-[11px] text-amber-300/70">{overdueFollowUps.map(l => l.contact_name || l.lodge_name).join(', ')}</p>
        </div>
      )}

      {/* Pipeline summary cards */}
      {viewMode === 'pipeline' && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {STAGES.map(s => {
            const stageLeads = leads.filter(l => (l.stage || l.status) === s.id)
            const totalVal = stageLeads.reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0)
            return (
              <div key={s.id} className={`rounded-xl p-3 ${s.color.split(' ')[0]} border border-transparent`}>
                <p className="text-[10px] uppercase font-semibold">{s.label}</p>
                <p className="text-xl font-bold">{stageLeads.length}</p>
                {totalVal > 0 && <p className="text-[10px] opacity-70">${totalVal.toLocaleString()}</p>}
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterStage('')}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!filterStage ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
          All ({leads.length})
        </button>
        {STAGES.map(s => (
          <button key={s.id} onClick={() => setFilterStage(s.id)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filterStage === s.id ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s.label} ({leads.filter(l => (l.stage || l.status) === s.id).length})
          </button>
        ))}
      </div>

      {/* Table view */}
      {viewMode === 'table' && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-6 py-16 text-center text-gray-500 animate-pulse">Loading pipeline...</div>
          ) : paginatedLeads.length === 0 ? (
            <div className="px-6 py-16 text-center text-gray-500">
              <TrendingUp size={32} className="mx-auto mb-3 opacity-40" />
              <p>No leads found.</p>
              <p className="text-xs text-gray-500 mt-1">Leads are created from upgrade requests or imported manually.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                <tr>
                  <SortableHeader label="Contact" sortKey="contact_name" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Lodge" sortKey="lodge_name" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Stage" sortKey="stage" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Value" sortKey="estimated_value" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Follow-up" sortKey="follow_up_at" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Interest" sortKey="interest" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <SortableHeader label="Source" sortKey="source" currentSortKey={leadSortKey} currentSortDir={leadSortDir} onToggle={toggleLeadSort} />
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginatedLeads.map(lead => {
                  const stage = lead.stage || lead.status || 'new'
                  return (
                    <tr key={lead.id} className="hover:bg-gray-750 cursor-pointer" onClick={() => setSelectedLead(lead)}>
                      <td className="px-4 py-3">
                        <p className="text-white font-medium">{lead.contact_name}</p>
                        <p className="text-[10px] text-gray-500">{lead.email}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-300">{lead.lodge_name}</td>
                      <td className="px-4 py-3">
                        <select className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer ${stageColor(stage)} ${updating === lead.id ? 'opacity-50' : ''}`}
                          value={stage} disabled={updating === lead.id}
                          onChange={(e) => updateStage(lead.id, e.target.value)}>
                          {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-300">{lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {lead.follow_up_at ? (
                          <span className={new Date(lead.follow_up_at) < new Date() ? 'text-red-400' : 'text-gray-300'}>
                            {new Date(lead.follow_up_at).toLocaleDateString()}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{lead.interest || '—'}</td>
                      <td className="px-4 py-3 text-[10px] text-gray-500">{lead.source || 'website'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => startEdit(lead)} className="text-xs text-purple-400 hover:text-purple-300">Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pipeline (kanban) view */}
      {viewMode === 'pipeline' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {STAGES.map(s => {
            const stageLeads = leads.filter(l => (l.stage || l.status) === s.id)
            return (
              <div key={s.id} className="bg-gray-800 rounded-xl p-3">
                <p className={`text-xs font-semibold uppercase mb-2 ${s.color.split(' ')[1]}`}>{s.label} ({stageLeads.length})</p>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {stageLeads.map(lead => (
                    <div key={lead.id} className="bg-gray-750 border border-gray-700 rounded-lg p-2 cursor-pointer hover:border-gray-600" onClick={() => startEdit(lead)}>
                      <p className="text-xs text-white font-medium truncate">{lead.contact_name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{lead.lodge_name}</p>
                      {lead.estimated_value > 0 && <p className="text-[10px] text-green-400 mt-1">${Number(lead.estimated_value).toLocaleString()}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Pagination page={leadPage} totalPages={leadTotalPages} onPageChange={setLeadPage} />

      {/* Edit modal */}
      {editingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingLead(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 w-[480px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-white">Edit Lead: {editingLead.contact_name}</h3>
              <button onClick={() => setEditingLead(null)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Stage</label>
                <select className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"
                  value={editForm.stage} onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))}>
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Follow-up Date</label>
                <input type="datetime-local" className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"
                  value={editForm.follow_up_at} onChange={e => setEditForm(f => ({ ...f, follow_up_at: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Estimated Value ($)</label>
                  <input type="number" className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"
                    value={editForm.estimated_value} onChange={e => setEditForm(f => ({ ...f, estimated_value: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Probability (%)</label>
                  <input type="number" min="0" max="100" className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"
                    value={editForm.probability} onChange={e => setEditForm(f => ({ ...f, probability: Number(e.target.value) }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Sales Notes</label>
                <textarea className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 h-20"
                  value={editForm.sales_notes} onChange={e => setEditForm(f => ({ ...f, sales_notes: e.target.value }))} />
              </div>
              {editForm.stage === 'lost' && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Lost Reason</label>
                  <input type="text" className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"
                    value={editForm.lost_reason} onChange={e => setEditForm(f => ({ ...f, lost_reason: e.target.value }))} />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={saveCrm} disabled={!!updating}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50">
                  {updating ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingLead(null)}
                  className="px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2 rounded-lg transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedLead && (
        <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)}
          onUpdate={async (id, stage) => {
            setUpdating(id)
            await window.api.admin.updateLeadCrm(id, { stage })
            setSelectedLead(null)
            await load()
            setUpdating(null)
          }} />
      )}
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
  const [loadError, setLoadError] = useState(null)
  const [loadWarnings, setLoadWarnings] = useState(null)
  const [viewClient360, setViewClient360] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [connected, setConnected] = useState(true)
  // Expose navigate for Dashboard quick actions
  useEffect(() => { window.__adminNavigate = (s) => setSection(s); return () => { delete window.__adminNavigate } }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSection('search')
        return
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      if (e.key === '?') { e.preventDefault(); setShowShortcuts(true); return }
      const sectionMap = { '1': 'dashboard', '2': 'companies', '3': 'licensing', '4': 'finance', '5': 'client-desk', '6': 'communications', '7': 'platform', '8': 'activity', '9': 'tools' }
      if (sectionMap[e.key]) { e.preventDefault(); setSection(sectionMap[e.key]) }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setLoadWarnings(null)
    try {
      const { data, errors } = await safeLoadAll(
        window.api.admin.getCompanies(),
        window.api.admin.getLicenses(),
        window.api.admin.getSupportTickets({}),
        window.api.admin.getActivityLogs({ limit: 200 })
      )
      const [c, l, t, a] = data
      setCompanies(Array.isArray(c) ? c : [])
      setLicenses(Array.isArray(l) ? l : [])
      setTickets(Array.isArray(t) ? t : [])
      setActivityLogs(Array.isArray(a) ? a : [])
      if (hasPartialFailures(errors)) {
        setLoadWarnings(getFailureSummary(errors, ['Companies', 'Licenses', 'Tickets', 'Activity Logs']))
      }
    } catch (err) {
      console.error('Command Central load failed:', err)
      setLoadError('Command Central data could not be fully loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Connection status ping
  useEffect(() => {
    let active = true
    let inFlight = false
    const ping = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      try {
        await window.api.admin.getCompanies()
        if (active) setConnected(true)
      } catch {
        if (active) setConnected(false)
      } finally {
        inFlight = false
      }
    }
    ping()
    const interval = setInterval(ping, 120000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      active = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [])

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length
  const upgradeCount = tickets.filter(t => t.category === 'Upgrade Request' && (t.status === 'open' || t.status === 'in_progress')).length
  const today = localToday()
  const overdueCount = licenses.filter(l => l.next_due_date && l.next_due_date < today && l.payment_status !== 'free' && l.is_active).length
  const expiringCount = licenses.filter(l => l.expires_at && l.is_active && new Date(l.expires_at) > new Date() && (new Date(l.expires_at) - new Date()) < 7 * 864e5).length

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
          <span className="flex items-center gap-1.5 text-[10px] text-gray-500" title={connected ? 'Supabase connected' : 'Supabase unreachable'}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
            {connected ? 'Live' : 'Offline'}
          </span>
          <button onClick={() => setShowShortcuts(true)} className="text-gray-600 hover:text-gray-400 text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors" title="Keyboard shortcuts (?)">
            <kbd className="font-mono text-[10px]">?</kbd>
          </button>
          <button onClick={loadAll} className="flex items-center gap-2 text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={logout} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-900/40 border-b border-red-700 px-6 py-3 flex items-center gap-3 print:hidden">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300 flex-1">{loadError}</p>
          <button onClick={loadAll} className="text-xs text-red-400 hover:text-red-300 underline">Retry</button>
        </div>
      )}

      {loadWarnings && !loadError && (
        <div className="bg-amber-900/40 border-b border-amber-700 px-6 py-3 flex items-center gap-3 print:hidden">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 flex-1">{loadWarnings}</p>
          <button onClick={loadAll} className="text-xs text-amber-400 hover:text-amber-300 underline">Retry</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 print:block">
        {/* Sidebar */}
        <div className="w-60 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col py-4 gap-4 px-2 print:hidden overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{group.label}</p>
              {group.items.map(({ id, label, icon: Icon, tip }) => {
                const ticketBadge = id === 'client-desk' && openTickets > 0 ? openTickets : null
                const upgradeBadge = id === 'licensing' && upgradeCount > 0 ? upgradeCount : null
                const overdueBadge = id === 'finance' && overdueCount > 0 ? overdueCount : null
                const expiringBadge = id === 'licensing' && expiringCount > 0 ? expiringCount : null
                const activeBadge = ticketBadge || upgradeBadge || overdueBadge || expiringBadge
                return (
                  <button
                    key={id}
                    onClick={() => setSection(id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors w-full text-left ${section === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="flex-1 truncate" title={tip}>{label}</span>
                    {upgradeBadge && (
                      <span className="bg-purple-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${upgradeBadge} upgrade request(s)`}>
                        {upgradeBadge}
                      </span>
                    )}
                    {ticketBadge && !upgradeBadge && (
                      <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{ticketBadge}</span>
                    )}
                    {overdueBadge && !ticketBadge && !upgradeBadge && (
                      <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${overdueBadge} overdue payment(s)`}>
                        {overdueBadge}
                      </span>
                    )}
                    {expiringBadge && !ticketBadge && !upgradeBadge && !overdueBadge && (
                      <span className="bg-yellow-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${expiringBadge} license(s) expiring soon`}>
                        {expiringBadge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 p-6 overflow-y-auto print:p-0 print:overflow-visible print:block">
          {loading && companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 animate-pulse space-y-3">
              <RefreshCw size={28} className="animate-spin text-purple-400" />
              <p className="text-sm">Loading Command Central…</p>
            </div>
          ) : viewClient360 ? (
            <ErrorBoundary><Client360 company={viewClient360} licenses={licenses} onBack={() => setViewClient360(null)} /></ErrorBoundary>
          ) : (
          <>
          {(section === 'dashboard' || section === 'cockpit') && <ErrorBoundary><DashboardHub companies={companies} licenses={licenses} tickets={tickets} activityLogs={activityLogs} onOpenCompany={(company) => setViewClient360(company)} initialTab={section === 'cockpit' ? 'executive' : 'overview'} /></ErrorBoundary>}
          {section === 'companies' && <ErrorBoundary><Companies companies={companies} licenses={licenses} loading={loading} onReload={loadAll} /></ErrorBoundary>}
          {(section === 'licensing' || section === 'subscription-requests') && <ErrorBoundary><LicensingHub companies={companies} licenses={licenses} tickets={tickets} onRefresh={loadAll} initialTab={section === 'subscription-requests' ? 'requests' : 'workbench'} /></ErrorBoundary>}
          {(section === 'finance' || section === 'bookkeeping' || section === 'accounting') && <ErrorBoundary><FinanceOffice companies={companies} /></ErrorBoundary>}
          {(section === 'tickets' || section === 'leads' || section === 'client-desk') && <ErrorBoundary><ClientDesk companies={companies} onOpenCompany={(company) => setViewClient360(company)} initialTab={section === 'leads' ? 'leads' : 'support'} /></ErrorBoundary>}
          {(section === 'notifications' || section === 'broadcasts' || section === 'email-alerts' || section === 'communications') && <ErrorBoundary><CommunicationsHub companies={companies} onOpenCompany={(company) => setViewClient360(company)} initialTab={section === 'broadcasts' ? 'broadcasts' : section === 'email-alerts' ? 'email' : 'notifications'} /></ErrorBoundary>}
          {section === 'activity' && <ErrorBoundary><ActivityLog companies={companies} onOpenCompany={(company) => setViewClient360(company)} /></ErrorBoundary>}
          {(section === 'health' || section === 'surfaces' || section === 'fleet' || section === 'releases' || section === 'platform') && <ErrorBoundary><PlatformOperations onOpenCompany={(company) => setViewClient360(company)} companies={companies} initialTab={['health', 'surfaces', 'fleet', 'releases'].includes(section) ? section : 'health'} /></ErrorBoundary>}
          {section === 'implementation' && <ErrorBoundary><ImplementationAddons /></ErrorBoundary>}
          {(section === 'search' || section === 'bulk' || section === 'test-reset' || section === 'tools') && <ErrorBoundary><AdminTools onNavigate={(s) => setSection(s)} onOpenCompany={(company) => setViewClient360(company)} companies={companies} initialTab={['search', 'bulk', 'test-reset'].includes(section) ? section : 'search'} /></ErrorBoundary>}
          </>
          )}
        </div>
      </div>
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
