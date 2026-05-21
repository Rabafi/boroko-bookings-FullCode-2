import { useState, useEffect, useRef, useCallback, useContext, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { BellRing, ChevronDown, ChevronUp, Download, FileText, RefreshCw, RotateCcw, X } from 'lucide-react'
import { APP_FEATURES, FEATURE_LABELS, buildCapabilitySnapshot, isPosFullAccessRole } from '../../shared/accessControl'
import { SUBSCRIPTION_PLAN_ORDER, getAllSubscriptionPlans, getFeatureRequiredPlan, getSubscriptionPlan, normalizeSubscriptionPlan } from '../../shared/subscriptionPlans'
import AppErrorBoundary from './components/AppErrorBoundary'
import { Modal } from './components/shared/Modal'
import { extractReleaseHighlights, formatReleaseDate, toReleaseSections } from './utils/updatePresentation'
import borokoLogoDark from './assets/boroko-bookings-logo-dark.png'
import {
  AuthContext,
  SettingsContext,
  ProfilesContext,
  FeaturesContext,
  AccessContext,
  OnlineRequestsContext,
  UnsavedChangesContext,
  useAuth,
  useProfiles
} from './app-context'

// ── Lazy — split into separate chunks, loaded on first visit ──────────────────
const Welcome     = lazy(() => import('./components/Welcome'))
const Login       = lazy(() => import('./components/Login'))
const Layout      = lazy(() => import('./components/Layout'))
const Dashboard   = lazy(() => import('./components/Dashboard'))
const Rooms       = lazy(() => import('./components/Rooms'))
const Bookings    = lazy(() => import('./components/Bookings'))
const Setup       = lazy(() => import('./components/Setup'))
const MasterSetup = lazy(() => import('./components/MasterSetup'))
const LodgeChooser = lazy(() => import('./components/LodgeChooser'))
const Calendar    = lazy(() => import('./components/Calendar'))
const Reports     = lazy(() => import('./components/Reports'))
const Staff       = lazy(() => import('./components/Staff'))
const Settings    = lazy(() => import('./components/Settings'))
const RoomGrid    = lazy(() => import('./components/RoomGrid'))
const Guests      = lazy(() => import('./components/Guests'))
const Housekeeping = lazy(() => import('./components/Housekeeping'))
const Expenses    = lazy(() => import('./components/Expenses'))
const Maintenance = lazy(() => import('./components/Maintenance'))
const POS         = lazy(() => import('./components/POS'))
const Inventory   = lazy(() => import('./components/Inventory'))
const RoomSupplies = lazy(() => import('./components/RoomSupplies'))
const NightAudit  = lazy(() => import('./components/NightAudit'))
const AdminCentral = lazy(() => import('./components/AdminCentral'))
const Conference  = lazy(() => import('./components/Conference'))
const DayUse      = lazy(() => import('./components/DayUse'))
const DataManagement = lazy(() => import('./components/DataManagement'))
const Quotations     = lazy(() => import('./components/Quotations'))
const BookingInvoices = lazy(() => import('./components/BookingInvoices'))
const OpsAi = lazy(() => import('./components/OpsAi'))

// ── Loading fallback for lazy routes ─────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex min-h-[400px] h-full items-center justify-center p-6">
      <div className="bb-card flex min-w-[220px] flex-col items-center gap-4 px-8 py-7 text-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Loading workspace</p>
          <p className="mt-1 text-xs text-slate-500">Preparing Boroko Bookings for this screen.</p>
        </div>
      </div>
    </div>
  )
}

// Thin wrapper so each lazy route element reads cleanly
function Lazy({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// { pos: true, inventory: true, ... }
const INPUT_FOCUS_DEBUG = false
const DEFAULT_TRIAL_STATUS = { status: 'trial', daysLeft: 3, expired: false }
const USER_SCOPE_KEY = 'bb_user_scope'

function isEditableFieldTarget(target) {
  if (!(target instanceof Element)) return false
  const editable = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable]')
  if (!(editable instanceof HTMLElement)) return false
  if ('disabled' in editable && editable.disabled) return false
  if ('readOnly' in editable && editable.readOnly) return false
  return true
}

// ── Upgrade Wall ───────────────────────────────────────────────────────────────
function UpgradeWall({ feature, children }) {
  const features = useContext(FeaturesContext)
  const access = useContext(AccessContext)
  // Only block when flags have been loaded AND this feature is explicitly false
  if (Object.keys(features).length > 0 && features[feature] === false) {
    const requiredTier = getFeatureRequiredPlan(feature)
    const requiredPlan = getSubscriptionPlan(requiredTier)
    const trialExpired = access?.entitlement?.expired === true
    const moduleLabel = FEATURE_LABELS[feature] || 'This module'
    const tierColor = requiredTier === 'Pro' ? 'purple' : 'blue'
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-10 text-center select-none">
        <div className="text-6xl mb-5">🔒</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          {trialExpired ? 'Trial expired' : `${requiredTier} Plan Required`}
        </h2>
        <p className="text-gray-500 text-sm max-w-sm mb-6">
          {trialExpired
            ? `${moduleLabel} is unavailable because this trial has ended. Buy a subscription to restore lodge access.`
            : `${moduleLabel} is not included in your current subscription. ${requiredPlan.headline}. ${requiredPlan.upgradeNudge}`}
        </p>
        <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold ${
          tierColor === 'purple'
            ? 'bg-purple-100 text-purple-700 border border-purple-200'
            : 'bg-blue-100 text-blue-700 border border-blue-200'
        }`}>
          {trialExpired ? 'Buy a subscription to continue' : `Upgrade to ${requiredTier} to access this feature`}
        </div>
      </div>
    )
  }
  return children
}

// ── Update Banner ─────────────────────────────────────────────────────────────
function UpdateBanner() {
  const UPDATE_SNOOZE_KEY = 'bb_update_snooze_until'
  const [state, setState] = useState(null) // null | 'available' | 'downloading' | 'ready' | 'error'
  const [updateInfo, setUpdateInfo] = useState(null)
  const [progress, setProgress] = useState({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
  const [message, setMessage] = useState('')
  const [minimized, setMinimized] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [snoozed, setSnoozed] = useState(false)
  const listenersAdded = useRef(false)

  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  useEffect(() => {
    if (listenersAdded.current || !window.api?.updates) return
    listenersAdded.current = true

    const isSnoozed = () => {
      try {
        const raw = window.localStorage.getItem(UPDATE_SNOOZE_KEY)
        if (!raw) return false
        const until = Number(raw)
        if (!Number.isFinite(until) || until <= Date.now()) {
          window.localStorage.removeItem(UPDATE_SNOOZE_KEY)
          return false
        }
        return true
      } catch {
        return false
      }
    }

    window.api.updates.getState().then((info) => {
      if (!info?.phase || ['idle', 'checking', 'uptodate'].includes(info.phase)) return
      const snoozedNow = isSnoozed() && info.phase === 'available'
      setSnoozed(snoozedNow)
      setUpdateInfo(info)
      setState(info.phase)
      setProgress(info.progress || { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
      if (info.phase === 'available') setMessage('New version available')
      if (info.phase === 'downloading') setMessage('Downloading update…')
      if (info.phase === 'ready') setMessage('Restart when you are ready to install.')
      if (info.phase === 'error') setMessage(info.error || 'The update failed.')
    }).catch(() => {})

    const cleanupAvailable = window.api.updates.onAvailable((info) => {
      setSnoozed(isSnoozed())
      setUpdateInfo(info)
      setMessage('New version available')
      setState('available')
      setMinimized(isSnoozed())
    })
    const cleanupProgress = window.api.updates.onProgress((p) => {
      setSnoozed(false)
      setProgress(p)
      setState('downloading')
      setMessage(p.bytesPerSecond > 0 ? `${formatBytes(p.bytesPerSecond)}/s` : 'Downloading…')
    })
    const cleanupReady = window.api.updates.onReady((info) => {
      setUpdateInfo(info)
      setState('ready')
      setMessage('Ready to install')
      setMinimized(false)
    })
    const cleanupError = window.api.updates.onError((info) => {
      setUpdateInfo(info)
      setMessage(info?.message || 'The update failed.')
      setState('error')
      setMinimized(false)
    })

    return () => {
      listenersAdded.current = false
      cleanupAvailable?.()
      cleanupProgress?.()
      cleanupReady?.()
      cleanupError?.()
    }
  }, [])

  if (!state) return null
  const version = updateInfo?.version || ''
  const releaseDate = formatReleaseDate(updateInfo?.releaseDate)
  const highlights = extractReleaseHighlights(updateInfo?.releaseNotes)
  const sections = toReleaseSections(updateInfo?.releaseNotes)

  const snoozeForDay = () => {
    try {
      window.localStorage.setItem(UPDATE_SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000))
    } catch {}
    setSnoozed(true)
    setMinimized(true)
  }

  const dismiss = () => {
    setState(null)
    setDetailsOpen(false)
  }

  const downloadUpdate = async () => {
    setState('downloading')
    setMessage('Preparing download…')
    const result = await window.api.updates.download().catch((error) => ({
      success: false,
      error: error?.message || 'Download failed.'
    }))
    if (!result?.success) {
      setState('error')
      setMessage(result?.error || 'Download failed.')
    }
  }

  if (minimized || (snoozed && state === 'available')) {
    return (
      <div className="fixed bottom-5 right-5 z-[9999] pointer-events-none">
        <button
          type="button"
          onClick={() => {
            setSnoozed(false)
            setMinimized(false)
          }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
        >
          <BellRing size={14} className={state === 'downloading' ? 'animate-pulse text-sky-600' : state === 'ready' ? 'text-emerald-600' : state === 'error' ? 'text-red-600' : 'text-amber-600'} />
          <span>{state === 'ready' ? `Restart to install v${version}` : state === 'downloading' ? `Downloading v${version}` : state === 'error' ? 'Update failed' : `Update available v${version}`}</span>
          <ChevronUp size={14} />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-[9999] pointer-events-none">
        <div className="pointer-events-auto w-[360px] overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/95 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur">
          <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-4 py-3 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">App update</p>
                <p className="mt-1 text-sm font-semibold">
                  {state === 'ready'
                    ? `Boroko Bookings v${version} is ready`
                    : state === 'downloading'
                      ? `Downloading v${version}`
                      : state === 'error'
                        ? 'Update needs attention'
                        : `Boroko Bookings v${version} is available`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Minimize update card"
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss update card"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1">
              <p className="text-sm text-slate-700">{message}</p>
              {(updateInfo?.releaseName || releaseDate) && (
                <p className="text-xs text-slate-500">
                  {[updateInfo?.releaseName, releaseDate].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {state === 'downloading' && (
              <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-sky-800">
                  <span>Download progress</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-sky-700">
                  <span>{formatBytes(progress.transferred)} of {progress.total ? formatBytes(progress.total) : 'calculating...'}</span>
                  <span>{progress.bytesPerSecond > 0 ? `${formatBytes(progress.bytesPerSecond)}/s` : 'starting...'}</span>
                </div>
              </div>
            )}

            {highlights.length > 0 && state !== 'error' && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">What changed</p>
                <div className="space-y-1.5">
                  {highlights.map((item) => (
                    <p key={item} className="text-xs text-slate-700">• {item}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              {state === 'available' && (
                <button type="button" onClick={downloadUpdate} className="btn-primary flex-1 justify-center">
                  <Download size={15} />
                  Download update
                </button>
              )}
              {state === 'ready' && (
                <button type="button" onClick={() => window.api.updates.install()} className="btn-primary flex-1 justify-center">
                  <RotateCcw size={15} />
                  Restart to install
                </button>
              )}
              {state === 'error' && (
                <button type="button" onClick={() => window.api.updates.check()} className="btn-primary flex-1 justify-center">
                  <RefreshCw size={15} />
                  Try again
                </button>
              )}
              {updateInfo?.releaseNotes && (
                <button type="button" onClick={() => setDetailsOpen(true)} className="btn-secondary justify-center">
                  <FileText size={15} />
                  Details
                </button>
              )}
            </div>

            {state === 'available' && (
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1">
                <p className="text-[11px] text-slate-500">You can keep working and install later.</p>
                <button
                  type="button"
                  onClick={snoozeForDay}
                  className="text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                >
                  Remind me tomorrow
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailsOpen && (
        <Modal title={`Boroko Bookings v${version}`} onClose={() => setDetailsOpen(false)} size="lg">
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-900">Update details</p>
              <p className="mt-1 text-sm text-slate-600">
                {[updateInfo?.releaseName, releaseDate].filter(Boolean).join(' · ') || 'Release notes from the latest desktop update.'}
              </p>
            </div>
            {sections.length > 0 ? (
              <div className="space-y-4">
                {sections.map((section) => (
                  <div key={section.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                    <div className="mt-3 space-y-2">
                      {section.items.map((item) => (
                        <p key={item} className="text-sm leading-6 text-slate-700">• {item}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                {updateInfo?.releaseNotes}
              </pre>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

// ── Broadcast Banner ──────────────────────────────────────────────────────────
function BroadcastBanner() {
  const [broadcasts, setBroadcasts] = useState([])

  useEffect(() => {
    if (!window.api?.admin?.getActiveBroadcasts) return
    window.api.admin.getActiveBroadcasts().then((data) => {
      if (!Array.isArray(data)) return
      const dismissed = JSON.parse(sessionStorage.getItem('bb_dismissed_broadcasts') || '[]')
      setBroadcasts(data.filter(b => !dismissed.includes(b.id)))
    }).catch(() => {})
  }, [])

  const dismiss = (id) => {
    const dismissed = JSON.parse(sessionStorage.getItem('bb_dismissed_broadcasts') || '[]')
    sessionStorage.setItem('bb_dismissed_broadcasts', JSON.stringify([...dismissed, id]))
    setBroadcasts(prev => prev.filter(b => b.id !== id))
  }

  if (broadcasts.length === 0) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] space-y-px pointer-events-none">
      {broadcasts.map(b => (
        <div key={b.id} className="bg-purple-700 text-white text-sm flex items-center justify-between px-4 py-2 shadow-lg pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="text-purple-200">📢</span>
            <span><strong>{b.title}:</strong> {b.message}</span>
          </div>
          <button onClick={() => dismiss(b.id)} className="text-purple-200 hover:text-white ml-4 text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  )
}

// ── Sync Fail Banner ───────────────────────────────────────────────────────────
function SyncFailBanner() {
  const navigate = useNavigate()
  const [syncStatus, setSyncStatus] = useState({ failed: 0, cacheStale: { active: false, names: [] } })

  useEffect(() => {
    if (!window.api?.sync?.getStatus || !window.api?.sync?.onStatusChanged) return

    const checkStatus = async () => {
      try {
        const status = await window.api.sync.getStatus()
        setSyncStatus(status || { failed: 0, cacheStale: { active: false, names: [] } })
      } catch (e) {
        setSyncStatus({ failed: 0, cacheStale: { active: false, names: [] } })
      }
    }

    checkStatus()
    const unsubscribe = window.api.sync.onStatusChanged((status) => {
      setSyncStatus(status || { failed: 0, cacheStale: { active: false, names: [] } })
    })

    return () => unsubscribe?.()
  }, [])

  const failedCount = Number(syncStatus?.failed || 0)
  const staleNames = Array.isArray(syncStatus?.cacheStale?.names) ? syncStatus.cacheStale.names : []
  const hasStaleCache = syncStatus?.cacheStale?.active === true && staleNames.length > 0
  const mesh = syncStatus?.mesh || {}
  const meshPeerCount = Number(mesh.peerCount || 0)
  const hasMeshSignal = Boolean(mesh.lastError)
  const isGlobalOffline = syncStatus?.isOnline === false

  if (failedCount === 0 && !hasStaleCache && !hasMeshSignal) return null

  const staleLabel = staleNames.join(', ')
  const tone = failedCount > 0 ? 'bg-amber-500 shadow-amber-500/20' : isGlobalOffline && meshPeerCount > 0 ? 'bg-emerald-700 shadow-emerald-700/20' : 'bg-sky-600 shadow-sky-600/20'
  const title =
    failedCount > 0
      ? `${failedCount} sync issue${failedCount === 1 ? '' : 's'} need attention`
      : isGlobalOffline && meshPeerCount > 0
        ? `Global Offline • Local Mesh: ${meshPeerCount} Peer${meshPeerCount === 1 ? '' : 's'} Connected`
        : mesh.lastError
          ? 'Local Mesh needs setup'
          : hasStaleCache
            ? `Fresh ${staleLabel} data is loading...`
            : `Local Mesh: ${mesh.running ? 'Ready' : 'Idle'}`
  const subtitle =
    failedCount > 0
      ? 'Tap to open System Health and resolve issues'
      : mesh.lastError
        ? mesh.lastError
        : isGlobalOffline && meshPeerCount > 0
          ? 'Nearby front-desk computers can share locks and offline work'
          : hasMeshSignal
            ? `${meshPeerCount} peer${meshPeerCount === 1 ? '' : 's'} · ${Number(mesh.activeLockCount || 0)} active lock${Number(mesh.activeLockCount || 0) === 1 ? '' : 's'}`
            : 'Reviewing status in System Health'

  return (
    <div className="fixed top-[52px] left-1/2 -translate-x-1/2 z-[9996] pointer-events-none w-full max-w-md px-4">
      <div
        className={`${tone} text-white flex items-center justify-between gap-4 px-4 py-3 shadow-2xl rounded-2xl border border-white/20 backdrop-blur-md pointer-events-auto cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] select-none`}
        onClick={() => navigate('/settings', { state: { activeTab: 'system' } })}
        title={failedCount > 0 ? 'Open System Health to review issues' : 'Opening System Health'}
      >
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-xl">
            {failedCount > 0 ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            ) : isGlobalOffline && meshPeerCount > 0 ? (
              <WifiIcon />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M22 4 12 14.01l-3-3"/></svg>
            )}
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">
              {title}
            </p>
            <p className="text-[11px] opacity-80 mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="bg-white/20 px-2.5 py-1.5 rounded-lg font-bold uppercase tracking-wider text-[10px]">
          {failedCount > 0 ? 'Review' : 'Open'}
        </div>
      </div>
    </div>
  )
}

function WifiIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13a10 10 0 0 1 14 0" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M12 20h.01" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
    </svg>
  )
}

// ── Financial Health Banner ───────────────────────────────────────────────────
function FinancialHealthBanner() {
  const navigate = useNavigate()
  const [errors, setErrors] = useState([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const criticalErrors = await (window.api.reports?.criticalErrors?.(3).catch(() => []) || Promise.resolve([]))
        if (!mounted) return
        setErrors(Array.isArray(criticalErrors) ? criticalErrors : [])
      } catch {
        if (mounted) setErrors([])
      }
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (errors.length === 0) return null

  const hasFinancial = errors.some(e => e.scope?.toLowerCase().includes('financial') || e.operation?.toLowerCase().includes('financial'))
  const hasHighSeverity = errors.some(e => e.severity === 'error' || e.scope?.toLowerCase().includes('db_init'))
  const isTrulyCritical = hasFinancial || hasHighSeverity

  const tone = isTrulyCritical
    ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
    : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
  const count = errors.length
  const label = isTrulyCritical ? 'critical error' : 'system warning'
  const dotTone = isTrulyCritical ? 'bg-rose-500' : 'bg-amber-500 animate-pulse'

  return (
    <div className="fixed top-[72px] right-4 z-[9995] pointer-events-none">
      <button
        type="button"
        className={`${tone} pointer-events-auto inline-flex items-center gap-3 rounded-full border px-3 py-2 text-xs shadow-lg backdrop-blur-sm transition-colors`}
        onClick={() => navigate('/settings', { state: { activeTab: 'system' } })}
      >
        <div className={`h-2.5 w-2.5 rounded-full ${dotTone}`} />
        <span className="font-semibold">{count} {label}{count === 1 ? '' : 's'}</span>
        <span className="text-[11px] font-medium opacity-75">System Health</span>
      </button>
    </div>
  )
}

// ── Booking Sync Conflict Notification ────────────────────────────────────────
// P0-4: Notify staff when offline bookings fail due to room conflicts
function BookingSyncConflictNotification() {
  const [conflicts, setConflicts] = useState([])

  useEffect(() => {
    const unsubscribers = []

    if (window.api?.sync?.onBookingConflict) {
      unsubscribers.push(window.api.sync.onBookingConflict((payload) => {
      const { bookingId, error } = payload
      setConflicts((prev) => {
        // Avoid duplicate notifications for the same booking
        if (prev.some((c) => c.bookingId === bookingId)) return prev
        return [...prev, { bookingId, error, timestamp: Date.now() }]
      })

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setConflicts((prev) => prev.filter((c) => c.bookingId !== bookingId))
      }, 8000)
      }))
    }

    if (window.api?.mesh?.onConflictDetected) {
      unsubscribers.push(window.api.mesh.onConflictDetected((payload) => {
        const bookingId = payload?.loserId || payload?.bookingId || `${payload?.roomId || 'mesh'}:${payload?.checkIn || ''}`
        const error = payload?.roomId
          ? `Local mesh conflict on room ${payload.roomId} for ${payload.checkIn || 'selected dates'}`
          : 'Local mesh conflict detected'
        setConflicts((prev) => {
          if (prev.some((c) => c.bookingId === bookingId)) return prev
          return [...prev, { bookingId, error, timestamp: Date.now(), mesh: true }]
        })
        setTimeout(() => {
          setConflicts((prev) => prev.filter((c) => c.bookingId !== bookingId))
        }, 10000)
      }))
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.())
  }, [])

  if (conflicts.length === 0) return null

  return (
    <div className="fixed top-[100px] left-0 right-0 z-[9995] pointer-events-none">
      {conflicts.map((conflict) => (
        <div
          key={conflict.bookingId}
          className="bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center px-4 py-2 shadow-md pointer-events-auto cursor-pointer transition-colors mx-4 mb-2 rounded-lg"
          onClick={() => {
            window.location.hash = '#/bookings'
            setConflicts((prev) => prev.filter((c) => c.bookingId !== conflict.bookingId))
          }}
        >
          <span className="font-semibold">
            {conflict.mesh ? 'Local mesh conflict' : 'Booking sync failed'}: {conflict.error} — Open Bookings to fix it.
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Trial Expired Lock Screen ─────────────────────────────────────────────────
function TrialExpiredScreen({ lodgeName, onSwitchAccount }) {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const tiers = getAllSubscriptionPlans()
  const lockedFeatures = APP_FEATURES.map((featureName) => FEATURE_LABELS[featureName] || featureName)

  const requestUpgrade = async (tier) => {
    setSubmitting(true)
    try {
      await window.api.admin.createSupportTicket({
        lodge_name: lodgeName || 'Unknown Lodge',
        title: `Subscription Request — ${tier} Plan`,
        description: `The lodge has requested to buy a ${tier} subscription after their free trial ended.`,
        category: 'Upgrade Request',
        priority: 'High'
      })
      setSubmitted(true)
    } catch { setSubmitted(true) }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-green-700 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-red-200 mb-3">Trial expired</div>
        <h1 className="text-3xl font-bold text-white mb-2">Boroko Bookings is paused</h1>
        <p className="text-green-200 text-sm max-w-md">
          This lodge is using an expired trial. App features are locked until a subscription is purchased and activated.
        </p>
        <button
          type="button"
          onClick={onSwitchAccount}
          className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15"
        >
          Log in to another account
        </button>
      </div>

      {submitted ? (
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Request sent!</h2>
          <p className="text-gray-500 text-sm">Our team will contact you shortly to activate your subscription. Thank you for choosing Boroko Bookings.</p>
        </div>
      ) : (
        <div className="w-full max-w-5xl space-y-5">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/10 p-4 sm:grid-cols-3 lg:grid-cols-6">
            {lockedFeatures.map((featureName) => (
              <div key={featureName} className="rounded-xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold text-white/55 line-through">
                {featureName}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {tiers.map((tier) => (
            <div key={tier.name} className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col">
              <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${tier.name === 'Pro' ? 'text-purple-600' : tier.name === 'Standard' ? 'text-green-600' : 'text-blue-600'}`}>
                {tier.name}
              </div>
              <div className="text-lg font-bold text-gray-800 mb-2">Contact us</div>
              <p className="mb-4 text-xs font-medium leading-5 text-gray-500">{tier.headline}</p>
              <ul className="space-y-1.5 flex-1 mb-5">
                {tier.modules.slice(0, 5).map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => requestUpgrade(tier.name)}
                disabled={submitting}
                className={`w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  tier.name === 'Pro' ? 'bg-purple-600 hover:bg-purple-700' :
                  tier.name === 'Standard' ? 'bg-green-600 hover:bg-green-700' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {submitting ? 'Sending...' : `Buy ${tier.name}`}
              </button>
            </div>
          ))}
          </div>
        </div>
      )}

      <p className="text-green-300 text-xs mt-6">
        Need help? Contact us at support@boroko.io
      </p>
    </div>
  )
}

// ── Trial Banner ──────────────────────────────────────────────────────────────
function TrialBanner({ daysLeft }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  const color = daysLeft <= 1 ? 'bg-red-600' : daysLeft <= 2 ? 'bg-amber-500' : 'bg-blue-600'
  const label = daysLeft === 1 ? 'Last day' : `${daysLeft} days`
  return (
    <div className="fixed top-0 left-0 right-0 z-[9997] pointer-events-none">
      <div className={`${color} text-white text-xs flex items-center justify-between px-4 py-1.5 pointer-events-auto`}>
        <span>🕐 <strong>{label} left</strong> in your free trial — contact us to subscribe and keep your data.</span>
        <button onClick={() => setDismissed(true)} className="ml-4 opacity-70 hover:opacity-100 text-base leading-none">×</button>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, fallbackPath = '/login', isTransitioning = false }) {
  const { user } = useAuth()
  const { activeProfile, loading } = useProfiles()

  if (loading || isTransitioning) return <PageLoader />
  if (!user) return <Navigate to={fallbackPath} replace />
  if (!user?.isMasterAdmin && (!activeProfile || activeProfile.status !== 'ready')) {
    return <Navigate to={fallbackPath} replace />
  }
  return children
}

export default function App() {
  const isBrowserPreview = !window.api?.settings
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('bb_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [authRestoreLoading, setAuthRestoreLoading] = useState(() => !isBrowserPreview && !!user)
  const [profiles, setProfiles] = useState([])
  const [activeProfile, setActiveProfile] = useState(null)
  const [profilesLoading, setProfilesLoading] = useState(!isBrowserPreview)
  const [settingsLoading, setSettingsLoading] = useState(!isBrowserPreview)
  const [settings, setSettings] = useState(null)
  const [features, setFeatures] = useState({}) // feature flags keyed by feature name
  const [trialStatus, setTrialStatus] = useState(DEFAULT_TRIAL_STATUS)
  const [onlineRequests, setOnlineRequests] = useState([])
  const focusRecoveryQueuedRef = useRef(false)
  const lastEditablePointerRef = useRef(null)
  const focusObservedRef = useRef(false)
  const restoreAttemptedRef = useRef(false)
  const navigationGuardRef = useRef({ isDirty: false, confirmLeave: null })

  // Dark mode — apply saved preference on startup
  useEffect(() => {
    if (localStorage.getItem('bb_dark_mode') === 'true') {
      document.documentElement.classList.add('dark-mode')
    }
  }, [])

  // Poll for pending online booking requests every 60 seconds
  const refreshOnlineRequests = useCallback(async () => {
    if (!window.api?.bookings?.getPendingOnline) return
    try {
      const data = await window.api.bookings.getPendingOnline()
      setOnlineRequests(data || [])
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (isBrowserPreview) return
    if (!user || user.isMasterAdmin) return
    if (activeProfile?.status !== 'ready') return
    refreshOnlineRequests()
    const interval = setInterval(refreshOnlineRequests, 60_000)
    return () => clearInterval(interval)
  }, [activeProfile?.status, isBrowserPreview, refreshOnlineRequests, user])

  const runFocusRecovery = useCallback((reason) => {
    if (focusRecoveryQueuedRef.current) return
    focusRecoveryQueuedRef.current = true
    if (INPUT_FOCUS_DEBUG) {
      console.log('[INPUT FOCUS] recovery requested:', {
        reason,
        activeTag: document.activeElement?.tagName || null,
        activeType: document.activeElement?.getAttribute?.('type') || null
      })
    }
    requestAnimationFrame(() => {
      window.focus()
      requestAnimationFrame(() => {
        document.body?.offsetHeight
        focusRecoveryQueuedRef.current = false
        if (INPUT_FOCUS_DEBUG) {
          console.log('[INPUT FOCUS] recovery finished:', {
            reason,
            activeTag: document.activeElement?.tagName || null,
            activeType: document.activeElement?.getAttribute?.('type') || null
          })
        }
      })
    })
  }, [])

  const applyEntitlement = useCallback((entitlement) => {
    const nextTrial = entitlement || DEFAULT_TRIAL_STATUS
    const nextFeatures = {}
    const normalizedPlan = normalizeSubscriptionPlan(nextTrial?.plan || 'Starter')
    const planIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizedPlan)
    APP_FEATURES.forEach((featureName) => {
      if (Object.prototype.hasOwnProperty.call(nextTrial?.effective_features || {}, featureName)) {
        nextFeatures[featureName] = nextTrial.effective_features[featureName] !== false
      } else if (nextTrial?.expired === true) {
        nextFeatures[featureName] = false
      } else if (nextTrial?.status === 'trial') {
        nextFeatures[featureName] = true
      } else {
        const requiredPlan = getFeatureRequiredPlan(featureName)
        const requiredIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(requiredPlan)
        nextFeatures[featureName] = planIndex >= requiredIndex
      }
    })
    setTrialStatus(nextTrial)
    setFeatures(nextFeatures)
  }, [])

  const clearStoredRendererSession = useCallback(() => {
    localStorage.removeItem('bb_user')
    localStorage.removeItem('bb_session_nonce')
    localStorage.removeItem(USER_SCOPE_KEY)
    restoreAttemptedRef.current = false
    setUser(null)
  }, [])

  const logout = useCallback(() => {
    clearStoredRendererSession()
    window.api.auth.logout().catch(() => {})
  }, [clearStoredRendererSession])

  const switchAccount = useCallback(() => {
    logout()
    window.location.hash = '#/login'
  }, [logout])

  const reloadProfiles = useCallback(async () => {
    if (isBrowserPreview || !window.api?.profiles) {
      setProfiles([])
      setActiveProfile(null)
      setProfilesLoading(false)
      setSettingsLoading(false)
      return { profiles: [], activeProfile: null }
    }

    setProfilesLoading(true)
    try {
      const [list, active] = await Promise.all([
        window.api.profiles.list().catch(() => []),
        window.api.profiles.getActive().catch(() => null)
      ])

      const nextProfiles = Array.isArray(list) ? list : []
      const nextActive = active || nextProfiles.find((profile) => profile.active) || null

      setSettingsLoading(Boolean(nextActive))
      setProfiles(nextProfiles)
      setActiveProfile(nextActive)
      return { profiles: nextProfiles, activeProfile: nextActive }
    } finally {
      setProfilesLoading(false)
    }
  }, [isBrowserPreview])

  const selectProfile = useCallback(async (lodgeId) => {
    if (user && !user.isMasterAdmin) {
      logout()
    }
    const result = await window.api.profiles.select(lodgeId)
    if (!result?.success) {
      throw new Error(result?.error || 'Could not switch to that lodge on this computer.')
    }
    await reloadProfiles()
    return result.data
  }, [logout, reloadProfiles, user])

  const createDraftProfile = useCallback(async () => {
    if (user && !user.isMasterAdmin) {
      logout()
    }
    const result = await window.api.profiles.createDraft()
    if (!result?.success) {
      throw new Error(result?.error || 'Could not create a new lodge profile.')
    }
    await reloadProfiles()
    return result.data
  }, [logout, reloadProfiles, user])

  const removeDraftProfile = useCallback(async (lodgeId) => {
    const result = await window.api.profiles.removeDraft(lodgeId)
    if (result?.success) {
      await reloadProfiles()
    }
    return result
  }, [reloadProfiles])

  useEffect(() => {
    if (isBrowserPreview) {
      setProfilesLoading(false)
      setSettingsLoading(false)
      setTrialStatus(DEFAULT_TRIAL_STATUS)
      return
    }
    reloadProfiles().catch(() => {
      setProfiles([])
      setActiveProfile(null)
      setProfilesLoading(false)
    })
  }, [isBrowserPreview, reloadProfiles])

  useEffect(() => {
    if (isBrowserPreview) return undefined
    if (profilesLoading) return undefined

    let cancelled = false
    let interval

    const loadProfileContext = async () => {
      if (!activeProfile) {
        setSettings(null)
        setFeatures({})
        setTrialStatus(DEFAULT_TRIAL_STATUS)
        setSettingsLoading(false)
        return
      }

      setSettingsLoading(true)
      try {
        const nextSettings = await window.api.settings.get().catch(() => null)
        if (!cancelled) {
          setSettings(nextSettings)
        }

        if (activeProfile.status === 'ready' && activeProfile.lodge_id) {
          if (window.api?.trial?.getStatus) {
            const refreshEntitlement = async () => {
              const nextTrial = await window.api.trial.getStatus(activeProfile.lodge_id).catch(() => DEFAULT_TRIAL_STATUS)
              if (!cancelled) applyEntitlement(nextTrial || DEFAULT_TRIAL_STATUS)
            }

            await refreshEntitlement()
            interval = setInterval(() => {
              refreshEntitlement().catch(() => {})
            }, 60_000)
          } else if (!cancelled) {
            applyEntitlement(DEFAULT_TRIAL_STATUS)
          }
        } else if (!cancelled) {
          setFeatures({})
          setTrialStatus(DEFAULT_TRIAL_STATUS)
        }
      } finally {
        if (!cancelled) setSettingsLoading(false)
      }
    }

    loadProfileContext()

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeProfile?.lodge_id, activeProfile?.status, applyEntitlement, isBrowserPreview, profilesLoading])

  const [isLoggingIn, setIsLoggingIn] = useState(false)

  useEffect(() => {
    if (isBrowserPreview || profilesLoading || !user || user.isMasterAdmin || isLoggingIn) return

    const storedScope = localStorage.getItem(USER_SCOPE_KEY) || ''
    const activeLodgeId = activeProfile?.lodge_id || ''
    const currentUserLodgeId = String(user?.lodge_id || '').trim().toLowerCase()

    if (!activeLodgeId || storedScope !== activeLodgeId || (currentUserLodgeId && currentUserLodgeId !== activeLodgeId)) {
      console.warn('[AUTH] Security scope mismatch - forcing logout', {
        activeLodgeId,
        storedScope,
        currentUserLodgeId
      })
      clearStoredRendererSession()
      window.api.auth.logout().catch(() => {})
    }
  }, [activeProfile?.lodge_id, clearStoredRendererSession, isBrowserPreview, isLoggingIn, profilesLoading, user])

  // Re-establish main-process currentUser on startup using the session nonce.
  // After an Electron restart, currentUser in database.js is null even though
  // the renderer restored the user from localStorage. The nonce proves this
  // renderer instance previously authenticated — identity is derived from the
  // nonce file in the main process, not from renderer-supplied data.
  useEffect(() => {
    if (isBrowserPreview) {
      setAuthRestoreLoading(false)
      return
    }
    if (!user) {
      setAuthRestoreLoading(false)
    }
  }, [isBrowserPreview, user])

  useEffect(() => {
    if (profilesLoading || !user || restoreAttemptedRef.current || !window.api?.auth?.restoreSession) return

    if (!user.isMasterAdmin) {
      const storedScope = localStorage.getItem(USER_SCOPE_KEY) || ''
      const activeLodgeId = activeProfile?.lodge_id || ''
      if (!activeLodgeId || storedScope !== activeLodgeId) return
    }

    restoreAttemptedRef.current = true
    const nonce = localStorage.getItem('bb_session_nonce') || ''
    const restorePromise = nonce
      ? window.api.auth.restoreSession(nonce).then((restored) => ({ user: restored, nonce }))
      : (window.api.auth.restoreSavedSession?.() || Promise.resolve({ user: null, nonce: '' }))

    restorePromise.then((result) => {
      const restored = result?.user || result
      if (!restored) {
        clearStoredRendererSession()
        setAuthRestoreLoading(false)
        return null
      }
      if (result?.nonce) {
        localStorage.setItem('bb_session_nonce', result.nonce)
      }
      return window.api.auth.validateSession?.()
        .then((validated) => {
          return validated || restored
        })
        .catch(() => restored)
        .finally(() => {
          setAuthRestoreLoading(false)
        })
    }).catch(() => {
      clearStoredRendererSession()
      setAuthRestoreLoading(false)
    })
  }, [activeProfile?.lodge_id, clearStoredRendererSession, profilesLoading, user])

  useEffect(() => {
    if (isBrowserPreview) return undefined

    const unsubscribe = window.api?.window?.onFocusRecovery?.((payload) => {
      runFocusRecovery(payload?.reason || 'window')
    })

    const handleFocusIn = (event) => {
      focusObservedRef.current = true
      if (INPUT_FOCUS_DEBUG) {
        console.log('[INPUT FOCUS] focusin:', {
          tag: event.target?.tagName || null,
          type: event.target?.getAttribute?.('type') || null
        })
      }
    }

    const handlePointerDown = (event) => {
      if (!isEditableFieldTarget(event.target)) return
      lastEditablePointerRef.current = event.target
      focusObservedRef.current = false

      if (INPUT_FOCUS_DEBUG) {
        console.log('[INPUT FOCUS] pointerdown editable target:', {
          tag: event.target?.tagName || null,
          type: event.target?.getAttribute?.('type') || null,
          className: event.target?.className || null
        })
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const target = lastEditablePointerRef.current
          if (!target) return
          const active = document.activeElement
          const targetOwnsFocus = active === target || (target.contains?.(active) ?? false)
          if (!focusObservedRef.current && !targetOwnsFocus) {
            runFocusRecovery('editable-pointerdown')
          }
        })
      })
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      unsubscribe?.()
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isBrowserPreview, runFocusRecovery])

  const login = useCallback(async (userData, nonce) => {
    setIsLoggingIn(true)
    try {
      localStorage.setItem('bb_user', JSON.stringify(userData))
      localStorage.setItem('bb_session_nonce', nonce || '')
      
      // Force refresh from main process (especially important for offline login)
      const refreshed = await reloadProfiles()
      const currentProfile = refreshed.activeProfile

      const scope = userData?.isMasterAdmin
        ? 'master_admin'
        : (currentProfile?.lodge_id || userData?.lodge_id || '')
        
      if (scope) {
        localStorage.setItem(USER_SCOPE_KEY, scope)
      } else {
        localStorage.removeItem(USER_SCOPE_KEY)
      }
      
      restoreAttemptedRef.current = false
      setUser(userData)
    } finally {
      // Small delay to ensure React has finished re-rendering with the new activeProfile
      // before we re-enable the security scope check
      setTimeout(() => setIsLoggingIn(false), 200)
    }
  }, [reloadProfiles])

  const handleSetupComplete = useCallback(async (newSettings) => {
    setSettings(newSettings)
    await reloadProfiles()
  }, [reloadProfiles])

  if (isBrowserPreview) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 via-green-700 to-green-500 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 text-center">
          <div className="text-5xl mb-4">🖥️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-3">Desktop App Required</h1>
          <p className="text-sm text-gray-600 leading-6">
            This Boroko Bookings screen is the desktop version. It needs the app installed on your computer and cannot run fully inside a browser tab.
          </p>
          <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 text-left">
            Use this link only for visual review, or share the manager mobile app link if your partner needs browser access.
          </div>
        </div>
      </div>
    )
  }

  const appLoading = (profilesLoading || settingsLoading || authRestoreLoading) && !isLoggingIn
  const preAuthFallbackPath = profiles.length === 0
    ? '/welcome'
    : activeProfile?.status === 'draft'
      ? '/setup'
      : '/choose-lodge'

  if (appLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-green-900">
        <div className="text-center text-white">
          <div className="mx-auto mb-5 flex h-36 w-[420px] max-w-[86vw] items-center justify-center">
            <img src={borokoLogoDark} alt="Boroko Bookings" className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <p className="text-sm text-green-200">Loading Boroko Bookings...</p>
        </div>
      </div>
    )
  }

  const authContextValue = { user, login, logout }
  const settingsContextValue = { settings, setSettings }
  const profilesContextValue = {
    profiles,
    activeProfile,
    loading: appLoading,
    profilesLoading,
    reloadProfiles,
    selectProfile,
    createDraftProfile,
    removeDraftProfile
  }
  // allowedOutletIds: null = unrestricted (manager/admin), [] = no access, [uuid] = scoped
  const _allowedOutletIds =
    user?.isMasterAdmin || isPosFullAccessRole(user?.role)
      ? null
      : (user?.allowed_outlet_ids || [])

  const accessContextValue = {
    ...buildCapabilitySnapshot({
      role: user?.role,
      isMasterAdmin: user?.isMasterAdmin,
      features
    }),
    entitlement: trialStatus,
    allowedOutletIds: _allowedOutletIds
  }

  // Master admin gets Command Central, no regular app
  if (user?.isMasterAdmin) {
    return (
      <AuthContext.Provider value={authContextValue}>
        <ProfilesContext.Provider value={profilesContextValue}>
          <SettingsContext.Provider value={settingsContextValue}>
            <AppErrorBoundary>
              <Lazy><AdminCentral /></Lazy>
            </AppErrorBoundary>
          </SettingsContext.Provider>
        </ProfilesContext.Provider>
      </AuthContext.Provider>
    )
  }

  // Trial expired and no license — full lock screen after lodge login
  if (user && trialStatus?.expired) {
    return <TrialExpiredScreen lodgeName={settings?.lodge_name} onSwitchAccount={switchAccount} />
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <ProfilesContext.Provider value={profilesContextValue}>
      <AccessContext.Provider value={accessContextValue}>
      <FeaturesContext.Provider value={features}>
      <OnlineRequestsContext.Provider value={{ count: onlineRequests.length, requests: onlineRequests, refresh: refreshOnlineRequests }}>
      <SettingsContext.Provider value={settingsContextValue}>
        <AppErrorBoundary>
          <HashRouter>
            <UnsavedChangesContext.Provider value={navigationGuardRef}>
            {/* Phase 1: Unified Notification Center */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end gap-3 pointer-events-none [&>*]:pointer-events-auto">
              <UpdateBanner />
              <BroadcastBanner />
              <SyncFailBanner />
              <FinancialHealthBanner />
              <BookingSyncConflictNotification />
              {user && trialStatus?.status === 'trial' && trialStatus?.lodge_id && !user?.isMasterAdmin && (
                <TrialBanner daysLeft={trialStatus.daysLeft} />
              )}
            </div>
            <Routes>
              <Route
                path="/welcome"
                element={profiles.length === 0 ? <Lazy><Welcome /></Lazy> : <Navigate to="/choose-lodge" replace />}
              />
              <Route
                path="/choose-lodge"
                element={profiles.length > 0 ? <Lazy><LodgeChooser /></Lazy> : <Navigate to="/welcome" replace />}
              />
              <Route
                path="/login"
                element={user ? <Navigate to="/" replace /> : <Lazy><Login /></Lazy>}
              />
              <Route
                path="/setup"
                element={
                  activeProfile?.status === 'draft'
                    ? <Lazy><Setup onComplete={handleSetupComplete} /></Lazy>
                    : <Navigate to={preAuthFallbackPath} replace />
                }
              />
              <Route
                path="/master-setup"
                element={<Lazy><MasterSetup onComplete={() => { window.location.hash = '/login' }} /></Lazy>}
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute fallbackPath={preAuthFallbackPath} isTransitioning={isLoggingIn}>
                    <Lazy><Layout /></Lazy>
                  </ProtectedRoute>
                }
              >
                {/* Always available — eager */}
                <Route index element={<Lazy><Dashboard /></Lazy>} />
                <Route path="rooms" element={<Lazy><Rooms /></Lazy>} />
                <Route path="bookings"    element={<Lazy><Bookings /></Lazy>} />
                <Route path="quotations" element={<Lazy><Quotations /></Lazy>} />
                <Route path="invoices" element={<Lazy><BookingInvoices /></Lazy>} />
                {/* Always available — lazy */}
                <Route path="calendar"    element={<Lazy><Calendar /></Lazy>} />
                <Route path="roomgrid"    element={<Lazy><RoomGrid /></Lazy>} />
                <Route path="guests"      element={<Lazy><Guests /></Lazy>} />
                <Route path="housekeeping" element={<Lazy><Housekeeping /></Lazy>} />
                <Route path="maintenance" element={<Lazy><Maintenance /></Lazy>} />
                <Route path="settings"    element={<Lazy><Settings /></Lazy>} />
                {/* Standard tier — lazy (UpgradeWall outside Lazy so wall renders without loading) */}
                <Route path="reports"    element={<UpgradeWall feature="reports">   <Lazy><Reports /></Lazy>    </UpgradeWall>} />
                <Route path="expenses"   element={<UpgradeWall feature="expenses">  <Lazy><Expenses /></Lazy>   </UpgradeWall>} />
                <Route path="staff"      element={<UpgradeWall feature="staff">     <Lazy><Staff /></Lazy>      </UpgradeWall>} />
                <Route path="audit"      element={<UpgradeWall feature="audit">     <Lazy><NightAudit /></Lazy> </UpgradeWall>} />
                <Route path="conference" element={<UpgradeWall feature="conference"><Lazy><Conference /></Lazy>  </UpgradeWall>} />
                <Route path="dayuse"     element={<UpgradeWall feature="pool">      <Lazy><DayUse /></Lazy>     </UpgradeWall>} />
                <Route path="data-management" element={<UpgradeWall feature="import"><Lazy><DataManagement /></Lazy></UpgradeWall>} />
                {/* Pro tier — lazy */}
                <Route path="pos"        element={<UpgradeWall feature="pos">       <Lazy><POS /></Lazy>        </UpgradeWall>} />
                <Route path="inventory"  element={<UpgradeWall feature="inventory"> <Lazy><Inventory /></Lazy>  </UpgradeWall>} />
                <Route path="supplies"   element={<UpgradeWall feature="supplies">  <Lazy><RoomSupplies /></Lazy></UpgradeWall>} />
                <Route path="ai"         element={<Lazy><OpsAi /></Lazy>} />
              </Route>
              <Route path="*" element={<Navigate to={user ? '/' : preAuthFallbackPath} replace />} />
            </Routes>
            </UnsavedChangesContext.Provider>
          </HashRouter>
        </AppErrorBoundary>
      </SettingsContext.Provider>
      </OnlineRequestsContext.Provider>
      </FeaturesContext.Provider>
      </AccessContext.Provider>
      </ProfilesContext.Provider>
    </AuthContext.Provider>
  )
}
