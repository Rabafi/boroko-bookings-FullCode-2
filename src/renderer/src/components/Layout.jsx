import { useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useSettings, useAccess, useOnlineRequests } from '../App'
import {
  LogOut,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  X,
  Lock,
  Zap,
  CheckCircle2,
  ArrowRight,
  Search,
  BellDot,
  ChevronsRight,
  CreditCard
} from 'lucide-react'
import CommandPalette from './CommandPalette'
import { ALL_NAV, NAV_GROUPS, getDesktopNavItems } from '../navigation/desktopNav'
import {
  SUBSCRIPTION_PLAN_ORDER,
  getSubscriptionPlan,
  buildUpgradeRequestDescription
} from '../../../shared/subscriptionPlans'

// ── Tier definitions (mirrors AdminCentral) ───────────────────────────────────
const TIERS = SUBSCRIPTION_PLAN_ORDER

// ── Support Ticket Modal ──────────────────────────────────────────────────────
function SupportModal({ onClose, settings }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'General', priority: 'Normal' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setSaving(true)
    await window.api.admin.createSupportTicket({
      lodge_id: settings?.lodge_id,
      lodge_name: settings?.lodge_name || settings?.company_name,
      ...form
    }).catch(() => {})
    setSaving(false); setDone(true)
    setTimeout(onClose, 1500)
  }

  const inp = "input w-full"

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start bg-slate-950/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-80 rounded-[24px] border border-white/70 bg-white/95 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.24)]" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><LifeBuoy size={15} className="text-emerald-600" /> Submit Support Ticket</h3>
          <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition-all hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700"><X size={16} /></button>
        </div>
        {done ? (
          <div className="bb-empty-state min-h-[180px] px-4 py-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">✓</div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Ticket submitted</p>
              <p className="mt-1 text-sm text-slate-500">We&apos;ll review it and be in touch shortly.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Title *</label>
              <input className={inp} placeholder="Briefly describe the issue" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Category</label>
                <select className={inp} value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                  {['General', 'Bug', 'Billing', 'Feature Request'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Priority</label>
                <select className={inp} value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                  {['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Description *</label>
              <textarea className={`${inp} h-20 resize-none`} placeholder="Describe the issue in detail…" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required />
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
              {saving ? 'Submitting…' : 'Submit Ticket'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Upgrade Request Modal ─────────────────────────────────────────────────────
function UpgradeModal({ lockedItem, onClose, settings }) {
  const [selectedTier, setSelectedTier] = useState(lockedItem?.tier || 'Standard')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setSaving(true)
    const lodge_name = settings?.lodge_name || settings?.company_name || 'Unknown Lodge'
    const plan = getSubscriptionPlan(selectedTier)
    await window.api.admin.createSupportTicket({
      lodge_id: settings?.lodge_id,
      lodge_name,
      title: `Upgrade Request — ${selectedTier} Plan`,
      description: buildUpgradeRequestDescription({
        lodgeName: lodge_name,
        requestedPlan: selectedTier,
        requestedFeatureKey: lockedItem?.capability,
        requestedFeature: lockedItem?.label || 'Locked feature',
        notes: `Commercial fit: ${plan.audience}`
      }),
      category: 'Upgrade Request',
      priority: 'High'
    }).catch(() => {})
    setSaving(false)
    setDone(true)
    setTimeout(onClose, 2000)
  }

  const tierBorder = { Starter: 'border-slate-300', Standard: 'border-blue-400', Pro: 'border-purple-400' }
  const tierBg    = { Starter: 'bg-slate-100',      Standard: 'bg-blue-50',      Pro: 'bg-purple-50' }
  const tierBadge = { Starter: 'bg-slate-200 text-slate-700', Standard: 'bg-blue-600 text-blue-50', Pro: 'bg-purple-600 text-purple-50' }
  const tierBtn   = { Starter: 'bg-gray-600 hover:bg-gray-500', Standard: 'bg-blue-600 hover:bg-blue-500', Pro: 'bg-purple-600 hover:bg-purple-500' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[28px] border border-white/70 bg-white/95 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.28)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-amber-500" />
            <h3 className="font-bold text-slate-900 text-base">Unlock {lockedItem?.label}</h3>
          </div>
          <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition-all hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </div>
        <p className="text-slate-500 text-xs mb-5">
          This feature is available on a higher Boroko plan. Choose a plan below to send an upgrade request and our team will help you unlock the right package for this lodge.
        </p>

        {done ? (
          <div className="bb-empty-state py-8">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
            <p className="font-semibold text-slate-900">Upgrade request sent</p>
            <p className="text-sm text-slate-500 mt-1">We&apos;ll contact you shortly to confirm the best plan and next steps.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {TIERS.map(tier => {
                const plan = getSubscriptionPlan(tier)
                const spotlight = plan.spotlight
                const isRecommended = spotlight === 'Most Popular'
                const isPremium = spotlight === 'Best for Direct Bookings'
                return (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${
                    selectedTier === tier
                      ? `${tierBorder[tier]} ${tierBg[tier]}`
                      : isRecommended
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : isPremium
                          ? 'border-purple-200 bg-purple-50/60'
                          : 'border-slate-200 bg-slate-50/80 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierBadge[tier]}`}>{tier}</span>
                      {spotlight && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isRecommended ? 'bg-emerald-600 text-white' : 'bg-purple-600 text-purple-50'
                        }`}>
                          {spotlight}
                        </span>
                      )}
                    </div>
                    {selectedTier === tier && <CheckCircle2 size={13} className="text-emerald-500" />}
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{getSubscriptionPlan(tier).priceLabel}</p>
                  <p className="mb-2 text-[11px] font-medium text-slate-700">{getSubscriptionPlan(tier).pitch}</p>
                  <ul className="space-y-1">
                    {getSubscriptionPlan(tier).modules.map(f => (
                      <li key={f} className="flex items-start gap-1 text-xs text-slate-600">
                        <Zap size={10} className="mt-0.5 flex-shrink-0 text-amber-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
                )
              })}
            </div>

            <button
              onClick={submit}
              disabled={saving}
              className={`w-full ${tierBtn[selectedTier]} text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors`}
            >
              {saving ? 'Sending request…' : (
                <><ArrowRight size={15} /> Request Upgrade to {selectedTier}</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { settings } = useSettings()
  const access = useAccess()
  const { count: onlineRequestCount } = useOnlineRequests()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [upgradeItem, setUpgradeItem] = useState(null) // { label, tier, capability } of locked item clicked
  const [syncStatus, setSyncStatus] = useState({ pending: 0, failed: 0 })
  const [collectionSummary, setCollectionSummary] = useState({ count: 0, amount: 0 })
  const [backupSummary, setBackupSummary] = useState({ latestAt: null })
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const checkSync = async () => {
      try {
        const status = await window.api.sync.getStatus()
        setSyncStatus(status || { pending: 0, failed: 0 })
      } catch { /* non-fatal — sync status is informational */ }
    }
    checkSync()
    const unsubscribe = window.api?.sync?.onStatusChanged?.((status) => {
      setSyncStatus(status || { pending: 0, failed: 0 })
    })
    const interval = setInterval(checkSync, 30_000)
    return () => {
      clearInterval(interval)
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadCollections = async () => {
      try {
        const bookings = await window.api.bookings.getAll()
        if (!mounted) return
        const openBalances = (Array.isArray(bookings) ? bookings : []).filter((booking) => {
          if ((booking.status || '') === 'cancelled') return false
          return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)) > 0
        })
        const amount = openBalances.reduce((sum, booking) => (
          sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
        ), 0)
        setCollectionSummary({ count: openBalances.length, amount })
      } catch {
        if (mounted) setCollectionSummary({ count: 0, amount: 0 })
      }
    }
    loadCollections()
    const interval = setInterval(loadCollections, 60_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [location.pathname])

  useEffect(() => {
    let mounted = true
    const loadBackups = async () => {
      try {
        const info = await window.api.backup.getInfo()
        if (!mounted) return
        const backups = Array.isArray(info?.backups) ? info.backups : []
        const latest = backups
          .map((entry) => entry?.created || null)
          .filter(Boolean)
          .sort()
          .at(-1) || null
        setBackupSummary({ latestAt: latest })
      } catch {
        if (mounted) setBackupSummary({ latestAt: null })
      }
    }
    loadBackups()
    const interval = setInterval(loadBackups, 300000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const bizType = settings?.business_type || 'lodge'

  useEffect(() => {
    const handleQuickSearch = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }
    }

    window.addEventListener('keydown', handleQuickSearch)
    return () => window.removeEventListener('keydown', handleQuickSearch)
  }, [])

  const navItems = useMemo(() => getDesktopNavItems(bizType, access), [bizType, access])
  const standaloneTop = useMemo(
    () => navItems.filter((item) => !item.group && item.to !== '/settings'),
    [navItems]
  )
  const standaloneBottom = useMemo(
    () => navItems.filter((item) => item.to === '/settings'),
    [navItems]
  )
  const grouped = useMemo(() => (
    NAV_GROUPS.map((groupName) => ({
      name: groupName,
      items: navItems
        .filter((item) => item.group === groupName)
        .map((item) => ({
          ...item,
          isLocked: item.capability && access?.blockedByFeature?.[item.capability]
        }))
    })).filter((group) => group.items.length > 0)
  ), [access, navItems])

  const navLinkClass = ({ isActive }) =>
    `group flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 transition-all ${
      isActive
        ? 'border-emerald-400/40 bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-[0_12px_30px_rgba(22,101,52,0.28)]'
        : 'border-transparent text-emerald-100/85 hover:border-white/10 hover:bg-white/8 hover:text-white'
    }`

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const BIZ_EMOJI = { lodge: '🏕️', restaurant: '🍽️' }
  const BIZ_LABEL = { lodge: 'Lodge Manager', restaurant: 'Restaurant Manager' }
  const workspaceName = settings?.lodge_name || settings?.company_name || 'Boroko Workspace'
  const pendingCount = Number(syncStatus.pending || 0)
  const failedCount = Number(syncStatus.failed || 0)
  const cacheStale = syncStatus?.cacheStale || { active: false, names: [] }
  const quickSearchShortcut = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'Cmd K' : 'Ctrl K'
  const searchableItems = useMemo(() => (
    navItems
      .filter((item) => item?.to && item?.label && item?.icon)
      .map((item) => ({
        ...item,
        group: item.group || (item.to === '/settings' ? 'Admin' : 'Workspace')
      }))
  ), [navItems])

  const handlePaletteSelect = (item) => {
    if (!item?.to) return
    navigate(item.to)
    setPaletteOpen(false)
  }

  const syncTone = failedCount > 0
    ? 'border-red-200 bg-red-50 text-red-800'
    : pendingCount > 0
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : cacheStale.active
        ? 'border-sky-200 bg-sky-50 text-sky-900'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800'

  const syncLabel = failedCount > 0
    ? `${failedCount} need review`
    : pendingCount > 0
      ? `${pendingCount} syncing`
      : cacheStale.active
        ? 'Refreshing data'
        : 'Synced'

  const syncSubLabel = failedCount > 0
    ? 'Open System Health'
    : pendingCount > 0
      ? 'Keep this device online'
      : cacheStale.active
        ? 'Retrying in background'
        : syncStatus?.lastSuccessfulSyncAt
          ? `Last sync ${new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
          : 'All local changes saved'
  const backupSubLabel = backupSummary.latestAt
    ? `Backup ${new Date(backupSummary.latestAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : 'No local backup yet'

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(209,250,229,0.2),transparent_22%),#edf2ee]">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-[84px]' : 'w-[288px]'
        } relative flex flex-col flex-shrink-0 border-r border-emerald-950/10 bg-[linear-gradient(180deg,#0f3d2c_0%,#0c2d23_100%)] text-white transition-all duration-200`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(74,222,128,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.16),transparent_28%)]" />

        {/* Logo */}
        <div className="relative z-10 border-b border-white/8 px-4 py-5">
          <div className="flex items-center justify-between gap-3">
            {!collapsed && (
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/10 text-lg shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                    {BIZ_EMOJI[bizType] || '🏢'}
                  </div>
                  <div className="min-w-0">
                    <span className="block truncate text-base font-semibold tracking-[-0.02em] text-white">Boroko</span>
                    <p className="mt-0.5 truncate text-xs text-emerald-100/70">{BIZ_LABEL[bizType] || 'Business Manager'}</p>
                  </div>
                </div>
              </div>
            )}
            {collapsed && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-white/10 text-lg shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                {BIZ_EMOJI[bizType] || '🏢'}
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-emerald-100 transition-all hover:bg-white/12 hover:text-white"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {!collapsed && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/6 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-100/55">Workspace</p>
              <p className="mt-1 truncate text-sm font-semibold text-white">{workspaceName}</p>
              <p className="mt-1 text-xs text-emerald-100/65">{bizType === 'restaurant' ? 'Restaurant operations' : 'Hospitality operations'}</p>
            </div>
          )}
        </div>

        {/* Nav — scrollable area */}
        <nav className="relative z-10 flex flex-1 flex-col overflow-y-auto px-3 py-4">
          {/* Dashboard — standalone top */}
          {standaloneTop.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass} title={collapsed ? label : undefined}>
              <Icon size={17} className="flex-shrink-0 transition-transform group-hover:scale-105" />
              {!collapsed && <span className="text-sm font-medium">{label}</span>}
            </NavLink>
          ))}

          {/* Grouped sections */}
          {grouped.map(group => (
            <div key={group.name} className="mt-4">
              {!collapsed
                ? (
                  <div className="mb-2 flex items-center gap-2 px-3">
                    <div className="h-px flex-1 bg-white/8" />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-100/45">{group.name}</p>
                  </div>
                )
                : <div className="my-2.5 mx-2 border-t border-white/8" />
              }
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon, end, isLocked, tier, capability }) =>
                  isLocked ? (
                    <button
                      key={label}
                      onClick={() => setUpgradeItem({ label, tier, capability })}
                      title={collapsed ? `${label} — ${tier} plan required` : undefined}
                      className="group flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left transition-all hover:border-white/16 hover:bg-white/[0.06]"
                    >
                      <Icon size={17} className="flex-shrink-0 text-emerald-200/65 transition-transform group-hover:scale-105" />
                      {!collapsed && <span className="flex-1 text-sm font-medium text-emerald-50/72">{label}</span>}
                      {!collapsed && tier && (
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          tier === 'Pro' ? 'bg-purple-500/20 text-purple-100' : 'bg-blue-500/20 text-blue-100'
                        }`}>{tier}</span>
                      )}
                      <Lock size={12} className="flex-shrink-0 text-emerald-100/40" />
                    </button>
                  ) : (
                    <NavLink key={to} to={to} end={end} className={navLinkClass} title={collapsed ? label : undefined}>
                      <div className="relative flex-shrink-0">
                        <Icon size={17} className="transition-transform group-hover:scale-105" />
                        {to === '/bookings' && onlineRequestCount > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow">
                            {onlineRequestCount > 9 ? '9+' : onlineRequestCount}
                          </span>
                        )}
                      </div>
                      {!collapsed && <span className="text-sm font-medium flex-1">{label}</span>}
                      {!collapsed && to === '/bookings' && onlineRequestCount > 0 && (
                        <span className="ml-auto flex-shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {onlineRequestCount} new
                        </span>
                      )}
                    </NavLink>
                  )
                )}
              </div>
            </div>
          ))}

          {/* Spacer + Settings pinned to bottom */}
          <div className="flex-1 min-h-3" />
          {standaloneBottom.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={navLinkClass} title={collapsed ? label : undefined}>
              <Icon size={17} className="flex-shrink-0 transition-transform group-hover:scale-105" />
              {!collapsed && <span className="text-sm font-medium">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="relative z-10 border-t border-white/8 p-3">
          {!collapsed && (
            <div className="mb-3 rounded-2xl border border-white/10 bg-white/6 px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/50">Signed in as</p>
              <p className="mt-1 truncate text-sm font-semibold text-white">{user?.name}</p>
              <span className="mt-2 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium capitalize text-emerald-50">
                {access?.roleLabel || user?.role}
              </span>
            </div>
          )}
          {/* Help / Support Ticket */}
          <button
            onClick={() => setShowHelp(true)}
            className="mb-1 flex w-full items-center gap-2 rounded-2xl border border-transparent px-3 py-2.5 text-emerald-100/80 transition-all hover:border-white/10 hover:bg-white/8 hover:text-white"
            title={collapsed ? 'Support' : undefined}
          >
            <LifeBuoy size={16} />
            {!collapsed && <span className="text-sm">Help / Support</span>}
          </button>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-2xl border border-transparent px-3 py-2.5 text-emerald-100/80 transition-all hover:border-white/10 hover:bg-white/8 hover:text-white"
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut size={16} />
            {!collapsed && <span className="text-sm">Sign out</span>}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="shrink-0 border-b border-slate-200/70 bg-white/72 px-6 py-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                <span>{BIZ_LABEL[bizType] || 'Business Manager'}</span>
                <ChevronsRight size={12} className="text-slate-300" />
                <span className="truncate text-slate-700">{workspaceName}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-slate-900">
                  Operations Workspace
                </h1>
                <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 md:inline-flex">
                  {access?.roleLabel || user?.role}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Navigate core modules, monitor sync health, and keep daily operations moving with confidence.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {collectionSummary.count > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/invoices')}
                  className="inline-flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left shadow-sm transition-all hover:border-rose-300 hover:bg-rose-100"
                  title="Open invoice collections"
                >
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-600">
                    <CreditCard size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-rose-900">
                      {settings?.currency || 'P'} {Number(collectionSummary.amount || 0).toFixed(2)} owed
                    </div>
                    <div className="text-xs text-rose-700">
                      {collectionSummary.count} booking{collectionSummary.count === 1 ? '' : 's'} need collection
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
                title="Open quick search"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <Search size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">Quick search</div>
                  <div className="text-xs text-slate-500">Jump to modules faster</div>
                </div>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
                  {quickSearchShortcut}
                </span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/settings')}
                className={`inline-flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left shadow-sm transition-all hover:shadow-md ${syncTone}`}
                title="Open Settings and System Health"
              >
                <BellDot size={16} className="text-slate-500" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{syncLabel}</div>
                  <div className="text-xs opacity-80">{syncSubLabel}</div>
                  <div className="text-[11px] opacity-70">{backupSubLabel}</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {syncStatus.failed > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm text-red-800">
            <span>⛔</span>
            <span>
              {syncStatus.failed} operation{syncStatus.failed !== 1 ? 's' : ''} need manual review before they can be trusted.
              Older failed items will retry automatically once the app is back online, but you can review them now in System Health.
              {syncStatus.failedBookingIds?.length > 0 && (
                <> Includes {syncStatus.failedBookingIds.length} booking creation{syncStatus.failedBookingIds.length !== 1 ? 's' : ''} — review the booking list before taking further action.</>
              )}
            </span>
          </div>
        )}
        {syncStatus.pending > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-800">
            <span>⏳</span>
            <span>{syncStatus.pending} operation{syncStatus.pending !== 1 ? 's' : ''} still need to sync. Keep the app online until this clears.</span>
          </div>
        )}
        {cacheStale.active && (
          <div className="flex shrink-0 items-center gap-2 border-b border-sky-200 bg-sky-50 px-6 py-2.5 text-sm text-sky-900">
            <span>🔄</span>
            <span>
              Fresh {cacheStale.names?.join(', ') || 'booking'} data could not be refreshed yet, so this screen may be slightly outdated.
              The app is retrying automatically in the background.
            </span>
          </div>
        )}
        <div className="flex-1 overflow-auto px-4 pb-4 pt-4 md:px-6 md:pb-6">
          <Outlet />
        </div>
      </div>

      {/* Support ticket modal */}
      {showHelp && <SupportModal onClose={() => setShowHelp(false)} settings={settings} />}

      {/* Upgrade request modal */}
      {upgradeItem && (
        <UpgradeModal
          lockedItem={upgradeItem}
          onClose={() => setUpgradeItem(null)}
          settings={settings}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={searchableItems}
        onSelect={handlePaletteSelect}
        currentPath={location.pathname}
      />
    </div>
  )
}
