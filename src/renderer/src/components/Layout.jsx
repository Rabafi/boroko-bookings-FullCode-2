import { useEffect, useMemo, useRef, useState, useContext } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useSettings, useAccess, useOnlineRequests, UnsavedChangesContext } from '../app-context'
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
  CreditCard,
  HardDrive,
  ShieldAlert,
  Download,
  Loader2,
  RefreshCw,
  Clock,
  AlertCircle,
  Sparkles
} from 'lucide-react'
import { productLogoColor, productLogoLight } from '../assets/productLogos'
import CommandPalette from './CommandPalette'
import OfflineNotice from './shared/OfflineNotice'
import OpsAiLayer from './shared/OpsAiLayer'
import { ALL_NAV, NAV_GROUPS, getDesktopNavItems } from '../navigation/desktopNav'
import {
  getSubscriptionPlan,
  buildUpgradeRequestDescription,
  formatPlanLimits,
  normalizeSubscriptionPlan,
  trackUpgradeIntent
} from '../../../shared/subscriptionPlans'
import { isHotelPropertyType } from '../../../shared/propertyTypes'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { getCommercialPackageLabel, getCommercialPackagePlanNames } from '../../../shared/commercialPackages'
import { getUiVocabulary } from '../../../shared/uiVocabulary'
import { normalizeSupportMessages, supportMessageSide, supportSenderName } from '../../../shared/supportThreads'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'

// ── Tier definitions (mirrors AdminCentral) ───────────────────────────────────
const TIERS = getCommercialPackagePlanNames(BUILD_PRODUCT.id)
const ADDON_FEATURE_KEYS = [
  'custom_website',
  'payment_gateway',
  'channel_manager',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'multi_outlet_pos',
  'guest_messaging',
  'guest_crm',
  'advanced_reports',
  'advanced_booking_engine',
  'operations_compliance',
  'group_operations'
]

function getEffectiveAddonsFromEntitlement(entitlement = {}) {
  const addons = new Set(Array.isArray(entitlement.enterprise_addons) ? entitlement.enterprise_addons : [])
  const features = entitlement.effective_features || {}
  for (const key of ADDON_FEATURE_KEYS) {
    if (features[key] === true) addons.add(key)
  }
  if (features.rate_calendar === true || features.promo_codes === true) addons.add('advanced_rates')
  return [...addons]
}

function latestSupportMessage(row) {
  const messages = normalizeSupportMessages(row)
  return messages[messages.length - 1] || null
}

function supportAlertId(request, latest) {
  return `${request?.id || 'request'}:${latest?.id || latest?.created_at || latest?.body || request?.updated_at || request?.created_at || 'latest'}`
}

const DESKTOP_INBOX_SEEN_LIMIT = 250

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Best effort only.
  }
}

function desktopInboxSeenKey(lodgeId, userId) {
  return `boroko_desktop_seen_inbox:${String(lodgeId || 'global').toLowerCase()}:${String(userId || 'user').toLowerCase()}`
}

function desktopInboxScanKey(lodgeId, userId) {
  return `boroko_desktop_inbox_last_scan:${String(lodgeId || 'global').toLowerCase()}:${String(userId || 'user').toLowerCase()}`
}

function isAfterStoredScan(value, lastScanAt) {
  if (!value || !lastScanAt) return Boolean(value && !lastScanAt)
  const time = new Date(value).getTime()
  const scanTime = new Date(lastScanAt).getTime()
  return Number.isFinite(time) && Number.isFinite(scanTime) && time > scanTime
}

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
function UpgradeModal({ lockedItem, onClose, settings, currentPlan: currentPlanProp }) {
  const [selectedTier, setSelectedTier] = useState(lockedItem?.tier || 'Standard')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const currentPlan = normalizeSubscriptionPlan(currentPlanProp || lockedItem?.currentPlan || settings?.subscription_plan || 'Starter')
  const currentLimits = formatPlanLimits(currentPlan)
  const selectedPlan = normalizeSubscriptionPlan(selectedTier)
  const selectedLimits = formatPlanLimits(selectedPlan)

  const submit = async () => {
    setSaving(true)
    const lodge_name = settings?.lodge_name || settings?.company_name || 'Unknown Lodge'
    const plan = getSubscriptionPlan(selectedTier)
    trackUpgradeIntent({
      lodgeId: settings?.lodge_id,
      lodgeName: lodge_name,
      plan: currentPlan,
      usage: lockedItem?.usage || {},
      recommendation: { recommendedPlan: selectedPlan },
      trigger: 'modal'
    })
    await window.api.admin.createSupportTicket({
      lodge_id: settings?.lodge_id,
      lodge_name,
       title: `Package Request — ${getCommercialPackageLabel(selectedTier, BUILD_PRODUCT.id)}`,
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

  const tierBorder = { Starter: 'border-slate-300', Standard: 'border-blue-400', Pro: 'border-purple-400', Enterprise: 'border-emerald-500' }
  const tierBg    = { Starter: 'bg-slate-100',      Standard: 'bg-blue-50',      Pro: 'bg-purple-50',      Enterprise: 'bg-emerald-50' }
  const tierBadge = { Starter: 'bg-slate-200 text-slate-700', Standard: 'bg-blue-600 text-blue-50', Pro: 'bg-purple-600 text-purple-50', Enterprise: 'bg-emerald-700 text-emerald-50' }
  const tierBtn   = { Starter: 'bg-gray-600 hover:bg-gray-500', Standard: 'bg-blue-600 hover:bg-blue-500', Pro: 'bg-purple-600 hover:bg-purple-500', Enterprise: 'bg-emerald-700 hover:bg-emerald-600' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[28px] border border-white/70 bg-white/95 p-5 sm:p-6 shadow-[0_28px_90px_rgba(15,23,42,0.28)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-amber-500" />
          <h3 className="font-bold text-slate-900 text-base">Unlock {lockedItem?.label}</h3>
        </div>
        <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition-all hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
      </div>
      <p className="text-slate-500 text-xs mb-4">
         {lockedItem?.label} is locked on {getCommercialPackageLabel(currentPlan, BUILD_PRODUCT.id)}. Upgrade to {getCommercialPackageLabel(selectedPlan, BUILD_PRODUCT.id)} to unlock it for this {BUILD_PRODUCT.businessNoun}.
      </p>
      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
         <p className="font-semibold text-slate-700">Current package: {getCommercialPackageLabel(currentPlan, BUILD_PRODUCT.id)}</p>
        <p className="mt-1">{currentLimits.bookings} · {currentLimits.grace} · {currentLimits.rooms} · {currentLimits.users}</p>
         <p className="mt-2 font-semibold text-slate-700">Required package: {getCommercialPackageLabel(selectedPlan, BUILD_PRODUCT.id)}</p>
        <p className="mt-1">{selectedLimits.bookings} · {selectedLimits.grace} · {selectedLimits.rooms} · {selectedLimits.users}</p>
      </div>

        {done ? (
          <div className="bb-empty-state py-8">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
            <p className="font-semibold text-slate-900">Upgrade request sent</p>
            <p className="text-sm text-slate-500 mt-1">We&apos;ll contact you shortly to confirm the best plan and next steps.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-5">
              {TIERS.map(tier => {
                const plan = getSubscriptionPlan(tier)
                const spotlight = plan.spotlight
                const isRecommended = spotlight === 'Most Popular'
                const isPremium = tier === 'Pro'
                const isSelected = selectedTier === tier
                const modules = getSubscriptionPlan(tier).modules
                const visibleModules = modules.slice(0, 3)
                const extraCount = modules.length - 3
                return (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  className={`rounded-xl border-2 p-2.5 sm:p-3 text-left transition-all ${
                    isSelected
                      ? `${tierBorder[tier]} ${tierBg[tier]} ring-1 ring-offset-1 ${tierBorder[tier]}`
                      : isRecommended
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : isPremium
                          ? 'border-purple-200 bg-purple-50/60'
                          : 'border-slate-200 bg-slate-50/80 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                       <span className={`text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${tierBadge[tier]}`}>{getCommercialPackageLabel(tier, BUILD_PRODUCT.id)}</span>
                      {spotlight && (
                        <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          isRecommended ? 'bg-emerald-600 text-white' : 'bg-purple-600 text-purple-50'
                        }`}>
                          {spotlight}
                        </span>
                      )}
                    </div>
                    {isSelected && <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />}
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-500 mb-1">{getSubscriptionPlan(tier).priceLabel}</p>
                  <p className="mb-1.5 text-[10px] sm:text-[11px] font-medium text-slate-700 line-clamp-2">{getSubscriptionPlan(tier).pitch}</p>
                  <ul className="space-y-0.5">
                    {visibleModules.map(f => (
                      <li key={f} className="flex items-start gap-1 text-[10px] sm:text-xs text-slate-600">
                        <Zap size={9} className="mt-0.5 flex-shrink-0 text-amber-500" />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                    {extraCount > 0 && (
                      <li className="text-[10px] text-slate-400 pl-3.5">+{extraCount} more</li>
                    )}
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
                <><ArrowRight size={15} /> Upgrade Plan</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Mandatory Backup Modal ───────────────────────────────────────────────────
function MandatoryBackupModal({ onGoToBackup }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-[32px] border border-white/20 bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-50 text-amber-600 ring-8 ring-amber-50/50">
          <ShieldAlert size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Weekly Archiving Due</h2>
        <p className="mt-3 text-slate-500">
          To maintain data safety and audit compliance, a full Excel data export is required once a week. 
          The current week's archive is now overdue.
        </p>
        <div className="mt-8 space-y-3">
          <button
            onClick={onGoToBackup}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-4 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30"
          >
            <HardDrive size={18} />
            Go to Data Management
          </button>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Mandatory Security Procedure
          </p>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { settings } = useSettings()
  const access = useAccess()
  const { count: onlineRequestCount, requests: onlineRequests } = useOnlineRequests()
  const navigate = useNavigate()
  const location = useLocation()
  const navGuard = useContext(UnsavedChangesContext)
  const [collapsed, setCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [upgradeItem, setUpgradeItem] = useState(null) // { label, tier, capability } of locked item clicked
  const [syncStatus, setSyncStatus] = useState({ pending: 0, failed: 0, syncInProgress: false, lastSuccessfulSyncAt: null })
  const [collectionSummary, setCollectionSummary] = useState({ count: 0, amount: 0 })
  const [backupStatus, setBackupStatus] = useState({ latestAt: null, overdue: false, enabled: false })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inboxAlerts, setInboxAlerts] = useState([])
  const onlineRequestIdsRef = useRef(new Set())
  const supportRequestIdsRef = useRef(new Map())
  const onlineRequestsPrimedRef = useRef(false)
  const supportRequestsPrimedRef = useRef(false)
  const isBrowserPreview = typeof window === 'undefined' || !window.api?.settings

  const pushInboxAlert = (request, latest, variant = 'new') => {
    const id = supportAlertId(request, latest)
    setInboxAlerts((current) => {
      if (current.some((item) => item.id === id)) return current
      return [
        {
          id,
          requestId: request?.id || null,
          title: variant === 'reply'
            ? `New reply from ${supportSenderName(latest)}`
            : `New manager inbox message`,
          message: latest?.body || request?.description || request?.title || 'A manager mobile message arrived.',
          createdAt: new Date().toISOString()
        },
        ...current
      ].slice(0, 3)
    })
    window.setTimeout(() => {
      setInboxAlerts((current) => current.filter((item) => item.id !== id))
    }, 18_000)
  }

  useEffect(() => {
    if (location.pathname.startsWith('/pos')) setCollapsed(true)
  }, [location.pathname])

  useEffect(() => {
    const checkSync = async () => {
      try {
        const status = await window.api.sync.getStatus()
        setSyncStatus(status || { pending: 0, failed: 0, syncInProgress: false, lastSuccessfulSyncAt: null })
      } catch { /* non-fatal — sync status is informational */ }
    }
    checkSync()
    const unsubscribe = window.api?.sync?.onStatusChanged?.((status) => {
      setSyncStatus(status || { pending: 0, failed: 0, syncInProgress: false, lastSuccessfulSyncAt: null })
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
        const summary = await window.api.bookings.getCollectionsSummary()
        if (mounted) setCollectionSummary(summary || { count: 0, amount: 0 })
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
  }, [])

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
        setBackupStatus({ 
          latestAt: latest, 
          overdue: info?.policy?.overdue === true,
          enabled: info?.policy?.enabled === true
        })
      } catch {
        if (mounted) setBackupStatus({ latestAt: null, overdue: false, enabled: false })
      }
    }
    loadBackups()
    const interval = setInterval(loadBackups, 30000) // check every 30s for compliance
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    onlineRequestIdsRef.current = new Set()
    supportRequestIdsRef.current = new Map()
    onlineRequestsPrimedRef.current = false
    supportRequestsPrimedRef.current = false
  }, [settings?.lodge_id, user?.id])

  useEffect(() => {
    if (isBrowserPreview || !user || !window.api?.app?.notify) return undefined

    const currentIds = new Set((onlineRequests || []).map((request) => request.id))
    if (!onlineRequestsPrimedRef.current) {
      onlineRequestIdsRef.current = currentIds
      onlineRequestsPrimedRef.current = true
      return undefined
    }

    const newRequests = (onlineRequests || []).filter((request) => request?.id && !onlineRequestIdsRef.current.has(request.id))
    if (newRequests.length > 0) {
      newRequests.slice(0, 3).forEach((request) => {
        const guestName = request.guest_name || request.customer_name || 'Guest'
        const roomLabel = request.room_number ? `Room ${request.room_number}` : 'Room TBD'
        const checkIn = request.check_in ? ` • ${request.check_in}` : ''
        window.api.app.notify({
          title: 'New online booking request',
          body: `${guestName} • ${roomLabel}${checkIn}`,
          sound: true,
          flash: true
        }).catch(() => {})
      })
    }

    onlineRequestIdsRef.current = currentIds
  }, [isBrowserPreview, onlineRequests, user?.id])

  useEffect(() => {
    if (isBrowserPreview || !user || !window.api?.requests?.getAll || !window.api?.app?.notify) return undefined

    let cancelled = false
    const lodgeId = settings?.lodge_id || settings?.id || 'global'
    const userId = user?.id || user?.email || 'user'
    const seenKey = desktopInboxSeenKey(lodgeId, userId)
    const scanKey = desktopInboxScanKey(lodgeId, userId)

    const getSeenVersions = () => {
      const value = readJsonStorage(seenKey, [])
      return Array.isArray(value) ? value : []
    }

    const rememberSeenVersions = (versions) => {
      const current = getSeenVersions()
      const next = [...new Set([...versions.filter(Boolean), ...current])]
        .slice(0, DESKTOP_INBOX_SEEN_LIMIT)
      writeJsonStorage(seenKey, next)
      return next
    }

    const isSeenVersion = (version) => getSeenVersions().includes(version)

    const acknowledgeRequest = (request, latest) => {
      const version = supportAlertId(request, latest)
      rememberSeenVersions([version])
      window.api.requests.markRead?.(request.id, 'front_desk', latest?.id || null).catch(() => {})
    }

    const announceRequest = (request, latest, variant) => {
      const note = latest?.body || request.description || request.admin_notes || 'A new request arrived from the manager mobile app.'
      pushInboxAlert(request, latest, variant)
      window.api.app.notify({
        title: variant === 'reply'
          ? `New inbox reply from ${supportSenderName(latest)}`
          : `Front desk request: ${request.title}`,
        body: note,
        sound: true,
        flash: true
      }).catch(() => {})
      acknowledgeRequest(request, latest)
    }

    const loadSupportRequests = async () => {
      try {
        const rows = await window.api.requests.getAll(12)
        if (cancelled) return
        const nextRows = Array.isArray(rows) ? rows : []
        if (!supportRequestsPrimedRef.current) {
          const initialUnread = nextRows.filter((row) => {
            if (String(row.category || '').trim().toLowerCase() !== 'front desk request') return false
            const latest = latestSupportMessage(row)
            return row.front_desk_has_unread === true &&
              latest &&
              supportMessageSide(latest) === 'manager'
          })
          initialUnread.slice(0, 3).forEach((request) => {
            announceRequest(request, latestSupportMessage(request), 'new')
          })
          initialUnread.slice(3).forEach((request) => {
            acknowledgeRequest(request, latestSupportMessage(request))
          })
          supportRequestIdsRef.current = new Map(nextRows.map((row) => [row.id, row]))
          rememberSeenVersions(
            nextRows
              .filter((row) => String(row.category || '').trim().toLowerCase() === 'front desk request')
              .filter((row) => typeof row.front_desk_has_unread !== 'boolean')
              .map((row) => {
                const latest = latestSupportMessage(row)
                return latest && supportMessageSide(latest) === 'manager' ? supportAlertId(row, latest) : null
              })
          )
          if (initialUnread.length > 0) {
            window.dispatchEvent(new CustomEvent('boroko:desktop-inbox-updated', {
              detail: { requests: initialUnread }
            }))
          }
          writeJsonStorage(scanKey, new Date().toISOString())
          supportRequestsPrimedRef.current = true
          return
        }

        const lastScanAt = readJsonStorage(scanKey, null)
        const newFrontDeskRequests = nextRows.filter((row) => {
          if (String(row.category || '').trim().toLowerCase() !== 'front desk request') return false
          const latest = latestSupportMessage(row)
          if (!latest || supportMessageSide(latest) !== 'manager') return false
          const version = supportAlertId(row, latest)
          if (typeof row.front_desk_has_unread === 'boolean') {
            return row.front_desk_has_unread === true && !supportRequestIdsRef.current.has(row.id)
          }
          return !supportRequestIdsRef.current.has(row.id) &&
            !isSeenVersion(version) &&
            isAfterStoredScan(latest.created_at || row.created_at, lastScanAt)
        })

        const updatedFrontDeskRequests = nextRows.filter((row) => {
          if (String(row.category || '').trim().toLowerCase() !== 'front desk request') return false
          const previous = supportRequestIdsRef.current.get(row.id)
          if (!previous) return false
          const latest = latestSupportMessage(row)
          const previousLatest = latestSupportMessage(previous)
          if (!latest || supportMessageSide(latest) !== 'manager') return false
          const version = supportAlertId(row, latest)
          const changed = String(latest.id || latest.created_at || latest.body) !== String(previousLatest?.id || previousLatest?.created_at || previousLatest?.body || '')
          if (typeof row.front_desk_has_unread === 'boolean') {
            return row.front_desk_has_unread === true && changed
          }
          return changed &&
            !isSeenVersion(version) &&
            isAfterStoredScan(latest.created_at || row.updated_at, lastScanAt)
        })

        if (newFrontDeskRequests.length > 0) {
          newFrontDeskRequests.slice(0, 3).forEach((request) => {
            const latest = latestSupportMessage(request)
            announceRequest(request, latest, 'new')
          })
          newFrontDeskRequests.slice(3).forEach((request) => {
            acknowledgeRequest(request, latestSupportMessage(request))
          })
        }

        if (updatedFrontDeskRequests.length > 0) {
          updatedFrontDeskRequests.slice(0, 3).forEach((request) => {
            const latest = latestSupportMessage(request)
            announceRequest(request, latest, 'reply')
          })
          updatedFrontDeskRequests.slice(3).forEach((request) => {
            acknowledgeRequest(request, latestSupportMessage(request))
          })
        }

        if (newFrontDeskRequests.length > 0 || updatedFrontDeskRequests.length > 0) {
          window.dispatchEvent(new CustomEvent('boroko:desktop-inbox-updated', {
            detail: {
              requests: [...newFrontDeskRequests, ...updatedFrontDeskRequests]
            }
          }))
        }

        supportRequestIdsRef.current = new Map(nextRows.map((row) => [row.id, row]))
        writeJsonStorage(scanKey, new Date().toISOString())
      } catch {
        // Best-effort only.
      }
    }

    loadSupportRequests()
    const interval = setInterval(loadSupportRequests, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isBrowserPreview, settings?.id, settings?.lodge_id, user?.email, user?.id])

  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  // Lodge product shell never switches into hotel bizType (motel is hotel-class
  // by property type but must stay lodge navigation without locked hotel rails).
  const bizType = propertyType === 'restaurant'
    ? 'restaurant'
    : (IS_LODGE_PRODUCT ? 'lodge' : (isHotelPropertyType(propertyType) ? 'hotel' : 'lodge'))
  const vocab = getUiVocabulary({ settings, propertyType, productId: BUILD_PRODUCT.id })
  const assistantEnabled = settings?.assistant_enabled === true

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

  const subscriptionPlan = access?.entitlement?.plan || access?.subscription_plan || null
  const effectiveUiPlan = subscriptionPlan
  const effectiveUiBizType = bizType
  const effectiveUiPropertyType = propertyType
  const effectiveUiAddons = getEffectiveAddonsFromEntitlement(access?.entitlement || {})
  const effectiveUiAccess = access
  const navItems = useMemo(() => (
    getDesktopNavItems(
      effectiveUiBizType,
      effectiveUiAccess,
      effectiveUiPropertyType,
      effectiveUiPlan,
      effectiveUiAddons,
      settings?.operating_profile,
      BUILD_PRODUCT.id
    ).filter((item) => assistantEnabled || item.to !== '/ai')
  ), [effectiveUiBizType, effectiveUiAccess, assistantEnabled, effectiveUiPlan, effectiveUiPropertyType, effectiveUiAddons, settings?.operating_profile])
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
        .map((item) => {
          const blocked = Boolean(item.capability && access?.blockedByFeature?.[item.capability])
          // Lodge product: never paint Hotel-group capabilities as locked upsells.
          if (IS_LODGE_PRODUCT && item.group === 'Hotel' && (item.isLocked || blocked)) {
            return null
          }
          return {
            ...item,
            isLocked: item.isLocked === true || blocked
          }
        })
        .filter(Boolean)
    })).filter((group) => group.items.length > 0)
  ), [access, navItems])

  const navLinkClass = ({ isActive }) =>
    `group flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
      isActive
        ? 'border-emerald-400/40 bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-[0_12px_30px_rgba(22,101,52,0.28)]'
        : 'border-transparent text-emerald-100/85 hover:border-white/10 hover:bg-white/8 hover:text-white'
    }`

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNavClick = (e, to) => {
    if (to !== location.pathname && navGuard.current?.isDirty) {
      e.preventDefault()
      navGuard.current.confirmLeave(() => navigate(to))
    }
  }

  const BIZ_EMOJI = { lodge: '🏕️', restaurant: '🍽️' }
  const bizManagerLabel = bizType === 'restaurant'
    ? `${vocab.nounTitle} Manager`
    : `${vocab.nounTitle} Manager`
  const PAGE_PURPOSE = {
    Dashboard: 'See today’s sales, service, stock, and exceptions at a glance.',
    POS: 'Create orders, take payment, and send work to the right station.',
    Reports: 'Review sales, margins, payments, and operational trends.',
    Inventory: 'Maintain stock levels, counts, and purchasing decisions.',
    Expenses: 'Record and review business costs with clear categories.',
    Staff: 'Manage the team and the access they need for their work.',
    Settings: 'Configure this restaurant, its devices, and operating defaults.',
    'Floor & Service': 'Manage live tables, reservations, and front-of-house flow.',
    Kitchen: 'Track preparation from new ticket to ready service.',
    'Menu & Production': 'Manage menu items, recipes, combos, and preparation.',
    'Stock & Purchasing': 'Keep purchasing, stock risk, and expiry work together.',
    Team: 'Review shifts, performance, and staff accountability.',
    'Cash & Close': 'Reconcile cash, close the day, and review owner controls.',
    Control: 'Handle checklists, alerts, deposits, feedback, and operating policies.'
  }
  const workspaceName = settings?.lodge_name || settings?.company_name || 'Tsa Bonno LodgingOS'
  const logoSrc = productLogoColor
  const darkLogoSrc = productLogoLight
  const pendingCount = Number(syncStatus.pending || 0)
  const failedCount = Number(syncStatus.failed || 0)
  const syncInProgress = syncStatus?.syncInProgress === true
  const currentSyncState = failedCount > 0 ? 'failed' : syncInProgress ? 'syncing' : 'idle'
  const cacheStale = syncStatus?.cacheStale || { active: false, names: [] }
  const isPosRoute = location.pathname === '/pos'
  const currency = settings?.currency || 'P'

  const offlineTasksByRoute = {
    '/': [
      'Polling for new online guest enquiries',
      'Syncing occupancy data from other devices',
      'Live revenue and performance updates'
    ],
    '/bookings': [
      'Receiving new website bookings',
      'Processing guest refunds',
      'Final cloud confirmation for offline-created bookings',
      'Real-time multi-device availability sync'
    ],
    '/pos': [
      'Real-time stock level synchronisation',
      'Processing cloud-based mobile payments',
      'Master inventory data updates'
    ],
    '/inventory': [
      'Live multi-outlet stock synchronisation',
      'Master catalogue cloud verification',
      'Remote supplier price updates'
    ],
    '/quotations': [
      'Final invoice number confirmation after offline conversion',
      'Emailing digital documents to clients',
      'Live currency rate verification'
    ],
    '/rooms': [
      'Uploading room gallery photos',
      'Live status sync between departments',
      'Remote configuration backups'
    ],
    '/calendar': [
      'Seeing bookings made on other devices',
      'Live cloud availability verification',
      'Remote scheduling conflict resolution'
    ],
    '/day-use': [
      'Real-time multi-device count sync',
      'Remote revenue reconciliation',
      'Instant cloud backup of new entries'
    ],
    '/invoices': [
      'Sending digital invoices via Email/WhatsApp',
      'Cloud-validated financial audit trails',
      'Real-time payment ledger reconciliation'
    ],
    '/reports': [
      'Consolidating data from other offline devices',
      'Authoritative cloud financial verification',
      'Cloud-based Excel and PDF exports'
    ],
    '/settings': [
      'Downloading new software updates',
      'Cloud profile and license synchronization',
      'Activating new subscription features'
    ]
  }
  const currentOfflineTasks = offlineTasksByRoute[location.pathname] || ['Instant multi-device synchronisation', 'Sending external notifications', 'Live cloud-side data verification']
  const quickSearchShortcut = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'Cmd K' : 'Ctrl K'
  const searchableItems = useMemo(() => (
    [
      ...navItems
      .filter((item) => item?.to && item?.label && item?.icon)
      .map((item) => ({
        ...item,
        group: item.group || (item.to === '/settings' ? 'Admin' : 'Workspace')
      })),
      { label: 'Create booking', to: '/bookings', icon: Zap, group: 'Quick Actions', keywords: ['new booking', 'reservation', 'check in'] },
      { label: 'Collect payment', to: '/invoices', icon: CreditCard, group: 'Quick Actions', keywords: ['balance', 'invoice', 'paid', 'settle'] },
      { label: 'Check room status', to: '/rooms', icon: CheckCircle2, group: 'Quick Actions', keywords: ['available', 'occupied', 'room board'] },
      { label: 'Review sync health', to: '/settings', icon: ShieldAlert, group: 'Quick Actions', keywords: ['offline', 'backup', 'system', 'errors'] },
      { label: 'Open POS sale', to: '/pos', icon: Zap, group: 'Quick Actions', keywords: ['restaurant', 'cashier', 'order'] },
      { label: 'Export reports', to: '/reports', icon: Download, group: 'Quick Actions', keywords: ['excel', 'pdf', 'finance'] }
    ]
  ), [navItems])
  const activeNavItem = useMemo(() => {
    const currentPath = location.pathname || '/'
    return ALL_NAV.find((item) => currentPath === item.to || (item.to !== '/' && currentPath.startsWith(item.to))) || ALL_NAV[0]
  }, [location.pathname])

  const handlePaletteSelect = (item) => {
    if (!item?.to) return
    if (item.to !== location.pathname && navGuard.current?.isDirty) {
      navGuard.current.confirmLeave(() => {
        navigate(item.to)
        setPaletteOpen(false)
      })
      return
    }
    navigate(item.to)
    setPaletteOpen(false)
  }

  const financialFailedCount = Number(syncStatus.financialFailedCount || 0)
  const syncTone = financialFailedCount > 0
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : failedCount > 0
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : syncInProgress || pendingCount > 0
        ? 'border-blue-100 bg-blue-50 text-blue-700'
        : cacheStale.active
          ? 'border-sky-200 bg-sky-50 text-sky-900'
          : !syncStatus.isOnline
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'

  const syncLabel = financialFailedCount > 0
    ? `${financialFailedCount} critical issue${financialFailedCount !== 1 ? 's' : ''}`
    : failedCount > 0
      ? `${failedCount} item${failedCount !== 1 ? 's' : ''} need review`
      : syncInProgress
        ? 'Syncing now'
        : pendingCount > 0
          ? `${pendingCount} waiting`
          : cacheStale.active
            ? 'Refreshing data'
            : !syncStatus.isOnline
              ? 'Offline'
              : 'Synced'

  const syncSubLabel = failedCount > 0
    ? 'Open System Health'
    : syncInProgress
      ? 'Sync replay is running'
      : pendingCount > 0
      ? 'Keep this device online'
      : cacheStale.active
        ? 'Retrying in background'
        : !syncStatus.isOnline
          ? 'Cloud sync is paused'
          : syncStatus?.lastSuccessfulSyncAt
            ? `Last sync ${new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'All local changes saved'
  const syncStateLabel = currentSyncState === 'failed' ? 'Failed' : currentSyncState === 'syncing' ? 'Syncing' : 'Idle'
  const lastSuccessfulSyncLabel = syncStatus?.lastSuccessfulSyncAt
    ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'No successful sync yet'
  const backupSubLabel = backupStatus.latestAt
    ? `Backup ${new Date(backupStatus.latestAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : 'No local backup yet'
  const attentionItems = [
    financialFailedCount > 0 && {
      key: 'critical-sync',
      tone: 'critical',
      icon: ShieldAlert,
      label: `${financialFailedCount} critical sync issue${financialFailedCount === 1 ? '' : 's'}`,
      detail: 'Review financial operations',
      to: '/settings',
      state: { activeTab: 'system' }
    },
    failedCount > 0 && financialFailedCount === 0 && {
      key: 'sync-review',
      tone: 'warning',
      icon: AlertCircle,
      label: `${failedCount} sync item${failedCount === 1 ? '' : 's'} need review`,
      detail: 'Open System Health',
      to: '/settings',
      state: { activeTab: 'system' }
    },
    onlineRequestCount > 0 && {
      key: 'online-requests',
      tone: 'warning',
      icon: BellDot,
      label: `${onlineRequestCount} online request${onlineRequestCount === 1 ? '' : 's'}`,
      detail: 'Confirm or decline',
      to: '/bookings'
    },
    collectionSummary.count > 0 && {
      key: 'collections',
      tone: 'danger',
      icon: CreditCard,
      label: `${currency} ${Number(collectionSummary.amount || 0).toFixed(2)} owed`,
      detail: `${collectionSummary.count} collection${collectionSummary.count === 1 ? '' : 's'}`,
      to: '/invoices'
    },
    pendingCount > 0 && failedCount === 0 && {
      key: 'sync-pending',
      tone: 'info',
      icon: Clock,
      label: `${pendingCount} pending sync item${pendingCount === 1 ? '' : 's'}`,
      detail: 'Keep device online',
      to: '/settings',
      state: { activeTab: 'system' }
    },
    backupStatus.overdue && {
      key: 'backup',
      tone: 'warning',
      icon: HardDrive,
      label: 'Backup overdue',
      detail: backupSubLabel,
      to: '/settings',
      state: { activeTab: 'system' }
    },
    cacheStale.active && {
      key: 'cache-stale',
      tone: 'info',
      icon: RefreshCw,
      label: 'Refreshing live data',
      detail: cacheStale.names?.join(', ') || 'Retrying in background',
      to: '/settings',
      state: { activeTab: 'system' }
    }
  ].filter(Boolean)

  const navigateWithGuard = (to, options = {}) => {
    if (navGuard.current?.isDirty) {
      navGuard.current.confirmLeave(() => navigate(to, options))
    } else {
      navigate(to, options)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(187,247,208,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(209,250,229,0.2),transparent_22%),#edf2ee]">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-[76px]' : 'w-[248px]'
        } relative flex flex-col flex-shrink-0 border-r border-emerald-950/10 bg-[linear-gradient(180deg,#0f3d2c_0%,#0c2d23_100%)] text-white transition-all duration-200`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(74,222,128,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.16),transparent_28%)]" />

        {/* Logo */}
        <div className="relative z-10 border-b border-white/8 px-3.5 py-4">
          <div className="flex items-center justify-between gap-3">
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-full items-center">
                    <img
                      src={darkLogoSrc}
                      alt={BUILD_PRODUCT.brandName}
                      className="h-full w-full object-contain object-left"
                      draggable="false"
                    />
                  </div>
                </div>
              </div>
            )}
            {collapsed && (
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-white/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                <img
                  src={logoSrc}
                  alt={BUILD_PRODUCT.brandName}
                  className="h-full w-full object-contain"
                  draggable="false"
                />
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
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-100/55">Workspace</p>
              <p className="mt-1 truncate text-sm font-semibold text-white">{workspaceName}</p>
              <p className="mt-1 text-xs text-emerald-100/65">{vocab.nounTitle} operations</p>
            </div>
          )}
          {/* Sidebar spacer */}
          <div className="h-2" />
        </div>

        {/* Nav — scrollable area */}
        <nav className="relative z-10 flex flex-1 flex-col overflow-y-auto px-2.5 py-3">
          {/* Dashboard — standalone top */}
          {standaloneTop.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass} title={collapsed ? label : undefined} onClick={(e) => handleNavClick(e, to)}>
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
                      className="group flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-all hover:border-white/16 hover:bg-white/[0.06]"
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
                    <NavLink key={to} to={to} end={end} className={navLinkClass} title={collapsed ? label : undefined} onClick={(e) => handleNavClick(e, to)}>
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
            <NavLink key={to} to={to} className={navLinkClass} title={collapsed ? label : undefined} onClick={(e) => handleNavClick(e, to)}>
              <Icon size={17} className="flex-shrink-0 transition-transform group-hover:scale-105" />
              {!collapsed && <span className="text-sm font-medium">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="relative z-10 border-t border-white/8 p-2">
          {!collapsed && (
            <div className="mb-1.5 rounded-xl border border-white/10 bg-white/6 px-2.5 py-1.5">
              <p className="text-[9px] uppercase tracking-[0.16em] text-emerald-100/50">Signed in as</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{user?.name}</p>
                <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-medium capitalize leading-tight text-emerald-50">
                {access?.roleLabel || user?.role}
                </span>
              </div>
            </div>
          )}
          {/* Help / Support Ticket */}
          <button
            onClick={() => setShowHelp(true)}
            className="mb-0.5 flex w-full items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-emerald-100/80 transition-all hover:border-white/10 hover:bg-white/8 hover:text-white"
            title={collapsed ? 'Support' : undefined}
          >
            <LifeBuoy size={14} />
            {!collapsed && <span className="text-xs">Help / Support</span>}
          </button>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-emerald-100/80 transition-all hover:border-white/10 hover:bg-white/8 hover:text-white"
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut size={14} />
            {!collapsed && <span className="text-xs">Sign out</span>}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-auto">
        {!isPosRoute && (
          <div className="shrink-0 border-b border-slate-200/70 bg-white/80 px-4 py-2.5 backdrop-blur-xl md:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  <span>{bizManagerLabel}</span>
                  <ChevronsRight size={12} className="text-slate-300" />
                  <span className="truncate text-slate-700">{workspaceName}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-slate-900">
                    {activeNavItem?.label || 'Operations'}
                  </h1>
                  <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 md:inline-flex">
                    {access?.roleLabel || user?.role}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {PAGE_PURPOSE[activeNavItem?.label] || 'Use this page to complete the current operational task safely and clearly.'}
                </p>
              </div>

              <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
                {assistantEnabled && (
                  <button
                    type="button"
                    onClick={() => navigateWithGuard('/ai', { state: { initialPrompt: `What can I do on ${activeNavItem?.label || 'this screen'}?`, sourceRoute: location.pathname, sourceLabel: activeNavItem?.label || 'this screen' } })}
                    className="group inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-3 text-left text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md"
                    title="Ask Tsa Bonno Assistant"
                  >
                    <Sparkles size={16} className="text-emerald-50" />
                    <span className="hidden text-sm font-semibold lg:inline">Ask</span>
                    <span className="hidden rounded-lg border border-white/20 bg-white/12 px-2 py-1 text-[10px] font-bold text-white/85 md:inline-flex">
                      Local
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className="group inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-50/50"
                  title="Open quick search"
                >
                  <Search size={16} className="text-slate-500 group-hover:text-emerald-600" />
                  <span className="hidden text-sm font-semibold text-slate-700 lg:inline">Search</span>
                  <span className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400 md:inline-flex">
                    <span className="opacity-60">{quickSearchShortcut.split(' ')[0]}</span>
                    <span>{quickSearchShortcut.split(' ')[1]}</span>
                  </span>
                </button>


                <button
                  type="button"
                  onClick={() => { const dest = '/settings'; const state = { state: { activeTab: 'system' } }; if (navGuard.current?.isDirty) { navGuard.current.confirmLeave(() => navigate(dest, state)) } else { navigate(dest, state) } }}
                  className={`relative inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-left shadow-sm transition-all hover:shadow-md ${syncTone}`}
                  title="Open System Health & Sync"
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-white/60 shadow-inner ${
                    financialFailedCount > 0 ? 'text-rose-600' : failedCount > 0 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {syncInProgress ? <RefreshCw size={16} className="animate-spin" /> : <BellDot size={16} />}
                  </span>
                  <span className="hidden text-sm font-bold leading-tight tracking-tight lg:inline">{syncLabel}</span>
                  {(pendingCount > 0 || failedCount > 0) && (
                    <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black text-white ${
                      financialFailedCount > 0 || failedCount > 0 ? 'bg-rose-600' : 'bg-blue-600'
                    }`}>
                      {failedCount || pendingCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {!isPosRoute && failedCount > 0 && (
          <div className={`flex shrink-0 items-center gap-2 border-b px-6 py-2.5 text-sm ${
            financialFailedCount > 0
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            <span>{financialFailedCount > 0 ? '⛔' : '⚠️'}</span>
            <span>
              {failedCount} operation{failedCount !== 1 ? 's' : ''} {financialFailedCount > 0 ? 'could not sync and need critical review' : 'stopped syncing and need attention'}.
              Open <strong>System Health</strong> to see the reason and resolve each item.
              {syncStatus.failedBookingIds?.length > 0 && (
                <> {syncStatus.failedBookingIds.length} affected booking{syncStatus.failedBookingIds.length !== 1 ? 's are' : ' is'} marked in the booking list.</>
              )}
            </span>
          </div>
        )}
        {!isPosRoute && syncStatus.pending > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-800">
            <span>⏳</span>
            <span>{syncStatus.pending} operation{syncStatus.pending !== 1 ? 's' : ''} still need to sync. Keep the app online until this clears.</span>
          </div>
        )}
        {!isPosRoute && cacheStale.active && (
          <div className="flex shrink-0 items-center gap-2 border-b border-sky-200 bg-sky-50 px-6 py-2.5 text-sm text-sky-900">
            <span>🔄</span>
            <span>
              Fresh {cacheStale.names?.join(', ') || 'booking'} data could not be refreshed yet, so this screen may be slightly outdated.
              The app is retrying automatically in the background.
            </span>
          </div>
        )}
        {!isPosRoute && attentionItems.length > 0 && (
          <div className="border-b border-slate-200/70 bg-white/80 px-4 py-2.5 backdrop-blur-xl md:px-5">
            <div className="mx-auto flex max-w-[1500px] items-center gap-2 overflow-x-auto">
              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-800 shadow-sm">
                <Sparkles size={14} />
                Attention
              </div>
              {attentionItems.slice(0, 6).map((item) => {
                const Icon = item.icon
                const toneClass = {
                  critical: 'border-rose-300 bg-rose-50 text-rose-900',
                  danger: 'border-red-200 bg-red-50 text-red-900',
                  warning: 'border-amber-200 bg-amber-50 text-amber-900',
                  info: 'border-sky-200 bg-sky-50 text-sky-900'
                }[item.tone] || 'border-slate-200 bg-slate-50 text-slate-800'
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigateWithGuard(item.to, item.state ? { state: item.state } : {})}
                    className={`group flex shrink-0 items-center gap-2.5 rounded-2xl border px-3 py-2 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/72 shadow-inner">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[210px] truncate font-bold leading-tight">{item.label}</span>
                      <span className="block max-w-[210px] truncate text-[11px] font-medium opacity-75">{item.detail}</span>
                    </span>
                    <ArrowRight size={14} className="opacity-45 transition-transform group-hover:translate-x-0.5" />
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className={`flex-1 overflow-auto ${isPosRoute ? 'px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-4' : 'px-3 pb-4 pt-3 md:px-5 md:pb-5'}`}>
          {!isPosRoute && <OfflineNotice tasks={currentOfflineTasks} />}
          <Outlet />
        </div>
      </div>

      {!isPosRoute && inboxAlerts.length > 0 && (
        <div className="pointer-events-none fixed right-5 top-5 z-[70] w-[min(420px,calc(100vw-2.5rem))] space-y-3">
          {inboxAlerts.map((alert) => (
            <div
              key={alert.id}
              className="pointer-events-auto rounded-[22px] border border-emerald-200 bg-white p-4 shadow-[0_22px_70px_rgba(15,23,42,0.22)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <BellDot size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">{alert.title}</p>
                  <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-600">{alert.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setInboxAlerts((current) => current.filter((item) => item.id !== alert.id))
                        navigateWithGuard('/', { state: { focusInbox: true, requestId: alert.requestId } })
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                    >
                      Open inbox <ArrowRight size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInboxAlerts((current) => current.filter((item) => item.id !== alert.id))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInboxAlerts((current) => current.filter((item) => item.id !== alert.id))}
                  className="shrink-0 rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Dismiss inbox alert"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Support ticket modal */}
      {showHelp && <SupportModal onClose={() => setShowHelp(false)} settings={settings} />}

      {/* Upgrade request modal */}
      {upgradeItem && (
        <UpgradeModal
          lockedItem={upgradeItem}
          onClose={() => setUpgradeItem(null)}
          settings={settings}
          currentPlan={normalizeSubscriptionPlan(access?.entitlement?.plan || 'Starter')}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={searchableItems}
        onSelect={handlePaletteSelect}
        currentPath={location.pathname}
      />

      {assistantEnabled && <OpsAiLayer />}

      {/* Mandatory Backup Block */}
      {backupStatus.overdue && location.pathname !== '/data-management' && (
        <MandatoryBackupModal onGoToBackup={() => { const dest = '/data-management'; const state = { state: { activeTab: 'backups' } }; if (navGuard.current?.isDirty) { navGuard.current.confirmLeave(() => navigate(dest, state)) } else { navigate(dest, state) } }} />
      )}
    </div>
  )
}
