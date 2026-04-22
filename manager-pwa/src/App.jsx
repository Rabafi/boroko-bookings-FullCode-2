import { useEffect, useRef, useState, lazy, Suspense, createContext, useContext, useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Moon, RefreshCw, Sun, X } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { FeaturesProvider, useFeatures } from './contexts/FeaturesContext'
import { getSubscriptionPlan, normalizeSubscriptionPlan } from '@shared/subscriptionPlans'
import { supabase } from './lib/supabase'
import BottomNav from './components/BottomNav'
import { flushOfflineQueue, getQueueStatus } from './lib/api'
import { getRuntimeMeta, subscribeRuntimeEvent } from './lib/runtime'

import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'

const Rooms = lazy(() => import('./pages/Rooms'))
const Bookings = lazy(() => import('./pages/Bookings'))
const Reports = lazy(() => import('./pages/Reports'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Money = lazy(() => import('./pages/Money'))
const More = lazy(() => import('./pages/More'))
const Quotations = lazy(() => import('./pages/Quotations'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Audit = lazy(() => import('./pages/Audit'))
const Guests = lazy(() => import('./pages/Guests'))
const Staff = lazy(() => import('./pages/Staff'))
const Conference = lazy(() => import('./pages/Conference'))
const DayUse = lazy(() => import('./pages/DayUse'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Control = lazy(() => import('./pages/Control'))

const ToastContext = createContext({ showToast: () => {} })

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

let swRegistration = null
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => { swRegistration = registration })
      .catch(() => {})
  })
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

async function subscribeToPush(user) {
  try {
    if (!swRegistration || !import.meta.env.VITE_VAPID_PUBLIC_KEY) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY)
    })
    const json = subscription.toJSON()
    await supabase.from('push_subscriptions').upsert({
      lodge_id: user.lodge_id,
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: 'lodge_id,endpoint' })
  } catch {
    // Best-effort only.
  }
}

async function unsubscribeFromPush(user) {
  try {
    if (!swRegistration) return
    const subscription = await swRegistration.pushManager.getSubscription()
    if (!subscription) return
    await supabase.from('push_subscriptions').delete().eq('lodge_id', user.lodge_id).eq('endpoint', subscription.endpoint)
    await subscription.unsubscribe()
  } catch {
    // Best-effort only.
  }
}

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('boroko_pwa_theme')
    return saved ? saved === 'dark' : true
  })

  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', !dark)
    localStorage.setItem('boroko_pwa_theme', dark ? 'dark' : 'light')
  }, [dark])

  return [dark, setDark]
}

function BroadcastBanners() {
  const [banners, setBanners] = useState([])

  useEffect(() => {
    let interval
    async function load() {
      const dismissed = JSON.parse(sessionStorage.getItem('boroko_pwa_dismissed_broadcasts') || '[]')
      const now = new Date().toISOString()
      const { data } = await supabase
        .from('broadcasts')
        .select('id, title, message')
        .eq('is_active', true)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
      if (data) setBanners(data.filter((item) => !dismissed.includes(item.id)))
    }
    load()
    interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  if (banners.length === 0) return null

  return (
    <div className="flex flex-col gap-1 px-3 pt-2">
      {banners.map((banner) => (
        <div key={banner.id} className="flex items-start gap-2 bg-green-900/80 border border-green-700 rounded-lg px-3 py-2 text-sm">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-green-200 truncate">{banner.title}</p>
            <p className="text-green-300 text-xs mt-0.5">{banner.message}</p>
          </div>
          <button
            onClick={() => {
              const dismissed = JSON.parse(sessionStorage.getItem('boroko_pwa_dismissed_broadcasts') || '[]')
              sessionStorage.setItem('boroko_pwa_dismissed_broadcasts', JSON.stringify([...dismissed, banner.id]))
              setBanners((current) => current.filter((item) => item.id !== banner.id))
            }}
            className="text-green-400 hover:text-white shrink-0 mt-0.5"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function SyncBanner() {
  const { user } = useAuth()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [queueCount, setQueueCount] = useState(() => user?.lodge_id ? getQueueStatus(user.lodge_id).count : 0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!user?.lodge_id) return undefined

    const refresh = () => {
      setOnline(navigator.onLine)
      setQueueCount(getQueueStatus(user.lodge_id).count)
    }

    const onOnline = async () => {
      refresh()
      setSyncing(true)
      await flushOfflineQueue(user.lodge_id).catch(() => {})
      setSyncing(false)
      refresh()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', refresh)
    const unsubscribe = subscribeRuntimeEvent('boroko:pwa-queue', refresh)
    refresh()

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', refresh)
      unsubscribe?.()
    }
  }, [user?.lodge_id])

  if (online && queueCount === 0 && !syncing) return null

  return (
    <div className={`mx-3 mt-2 rounded-2xl px-4 py-3 text-sm ${online ? 'bg-blue-950/40 border border-blue-900 text-blue-200' : 'bg-amber-950/40 border border-amber-900 text-amber-200'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{online ? 'Sync in progress' : 'Offline mode'}</p>
          <p className="text-xs mt-1 opacity-80">
            {online
              ? `${syncing ? 'Pushing' : 'Ready to push'} ${queueCount} queued change${queueCount === 1 ? '' : 's'}`
              : `${queueCount} change${queueCount === 1 ? '' : 's'} waiting to sync when the internet returns`}
          </p>
        </div>
        {online && queueCount > 0 && (
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        )}
      </div>
    </div>
  )
}

function LockedView({ title = 'Access Restricted' }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
      <p className="text-lg font-bold text-white">{title}</p>
      <p className="text-sm text-gray-400 mt-2">This area is not included in your current access level.</p>
    </div>
  )
}

function ToastViewport({ toasts }) {
  if (!toasts.length) return null

  return (
    <div className="fixed left-3 right-3 top-3 z-[90] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm ${
            toast.tone === 'error'
              ? 'border-red-800 bg-red-950/95 text-red-100'
              : toast.tone === 'queued'
                ? 'border-amber-800 bg-amber-950/95 text-amber-100'
                : 'border-emerald-800 bg-emerald-950/95 text-emerald-100'
          }`}
        >
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.message ? <p className="mt-1 text-xs opacity-90">{toast.message}</p> : null}
        </div>
      ))}
    </div>
  )
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useMemo(() => (
    ({ title, message = '', tone = 'success', duration = 2600 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((current) => [...current, { id, title, message, tone }])
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, duration)
    }
  ), [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastViewport toasts={toasts} />
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

function GlobalStatusFooter() {
  const { user } = useAuth()
  const location = useLocation()
  const [queueCount, setQueueCount] = useState(() => user?.lodge_id ? getQueueStatus(user.lodge_id).count : 0)
  const [lastSync, setLastSync] = useState(() => user?.lodge_id ? getRuntimeMeta(user.lodge_id, 'last-sync', null) : null)

  useEffect(() => {
    if (!user?.lodge_id) return undefined
    const refresh = () => {
      setQueueCount(getQueueStatus(user.lodge_id).count)
      setLastSync(getRuntimeMeta(user.lodge_id, 'last-sync', null))
    }
    const unsubscribeQueue = subscribeRuntimeEvent('boroko:pwa-queue', refresh)
    const unsubscribeCache = subscribeRuntimeEvent('boroko:pwa-cache', refresh)
    refresh()
    return () => {
      unsubscribeQueue?.()
      unsubscribeCache?.()
    }
  }, [user?.lodge_id])

  return (
    <div className="px-4 pb-20 pt-2 text-[11px] text-gray-500 flex items-center justify-between gap-3">
      <span className="truncate capitalize">{location.pathname === '/' ? 'Dashboard' : location.pathname.replace('/', '').replace('-', ' ')}</span>
      <span className="shrink-0">{queueCount > 0 ? `${queueCount} queued` : 'Synced'}</span>
      <span className="truncate text-right">{lastSync ? `Last sync moved ${lastSync.processed || 0}` : 'Live status'}</span>
    </div>
  )
}

function Guard({ capability, children }) {
  const { access, can } = useFeatures()
  if (capability && access && !can(capability)) return <LockedView />
  return children
}

function ManagerPwaPlanLocked() {
  const { user, logout } = useAuth()
  const { entitlement } = useFeatures()
  const proPlan = getSubscriptionPlan('Pro')

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-purple-900/60 bg-gray-900/90 p-6 text-center shadow-2xl">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-xs uppercase tracking-[0.25em] text-purple-300">Pro Feature</p>
        <h1 className="text-2xl font-bold text-white mt-3">Manager PWA Locked</h1>
        <p className="text-sm text-gray-300 mt-3">
          {user?.lodge_display_name || entitlement?.lodge_name || 'This lodge'} is not currently entitled to the Manager PWA.
        </p>
        <p className="text-sm text-gray-400 mt-2">
          The Manager PWA sits inside the {proPlan.name} plan because {proPlan.pitch.toLowerCase()}.
        </p>
        <div className="rounded-2xl bg-purple-950/40 border border-purple-900/60 px-4 py-3 mt-5 text-sm text-purple-200">
          Current plan: {normalizeSubscriptionPlan(entitlement?.plan || 'Starter')}
        </div>
        <button
          onClick={logout}
          className="w-full mt-5 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-2xl font-semibold transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

function AuthenticatedShell({ alertCount, dark, setDark, setAlertCount }) {
  const { user } = useAuth()
  const { entitlement, loading: entitlementLoading } = useFeatures()
  const lastUserRef = useRef(null)

  useEffect(() => {
    if (user) {
      lastUserRef.current = user
      subscribeToPush(user)
    } else if (lastUserRef.current) {
      unsubscribeFromPush(lastUserRef.current)
      lastUserRef.current = null
    }
  }, [user?.id])

  if (entitlementLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (entitlement?.effective_features?.pwa === false) {
    return <ManagerPwaPlanLocked />
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 app-bg">
      <div className="flex justify-end px-4 pt-3 pb-1">
        <button
          onClick={() => setDark((value) => !value)}
          className="p-2 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <SyncBanner />
      <BroadcastBanners />

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rooms" element={<Suspense fallback={<PageLoader />}><Rooms /></Suspense>} />
          <Route path="/bookings" element={<Suspense fallback={<PageLoader />}><Bookings /></Suspense>} />
          <Route path="/reports" element={<Suspense fallback={<PageLoader />}><Guard capability="reports.view"><Reports /></Guard></Suspense>} />
          <Route path="/alerts" element={<Suspense fallback={<PageLoader />}><Alerts onCountChange={setAlertCount} /></Suspense>} />
          <Route path="/money" element={<Suspense fallback={<PageLoader />}><Money /></Suspense>} />
          <Route path="/more" element={<Suspense fallback={<PageLoader />}><More /></Suspense>} />
          <Route path="/quotations" element={<Suspense fallback={<PageLoader />}><Guard capability="quotations.view"><Quotations /></Guard></Suspense>} />
          <Route path="/invoices" element={<Suspense fallback={<PageLoader />}><Guard capability="invoices.view"><Invoices /></Guard></Suspense>} />
          <Route path="/expenses" element={<Suspense fallback={<PageLoader />}><Guard capability="expenses.view"><Expenses /></Guard></Suspense>} />
          <Route path="/audit" element={<Suspense fallback={<PageLoader />}><Guard capability="audit.view"><Audit /></Guard></Suspense>} />
          <Route path="/guests" element={<Suspense fallback={<PageLoader />}><Guard capability="guests.view"><Guests /></Guard></Suspense>} />
          <Route path="/staff" element={<Suspense fallback={<PageLoader />}><Guard capability="staff.view"><Staff /></Guard></Suspense>} />
          <Route path="/conference" element={<Suspense fallback={<PageLoader />}><Guard capability="conference.view"><Conference /></Guard></Suspense>} />
          <Route path="/day-use" element={<Suspense fallback={<PageLoader />}><Guard capability="pool.view"><DayUse /></Guard></Suspense>} />
          <Route path="/inventory" element={<Suspense fallback={<PageLoader />}><Guard capability="inventory.view"><Inventory /></Guard></Suspense>} />
          <Route path="/control" element={<Suspense fallback={<PageLoader />}><Control /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <GlobalStatusFooter />
      <BottomNav alertCount={alertCount} />
    </div>
  )
}

function AppShell() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [alertCount, setAlertCount] = useState(0)
  const [dark, setDark] = useDarkMode()
  const browserPath = typeof window === 'undefined' ? '' : window.location.pathname
  const browserHash = typeof window === 'undefined' ? '' : window.location.hash
  const storedRecoveryMode = typeof window !== 'undefined' && sessionStorage.getItem('boroko_password_recovery') === '1'
  const isPasswordRecoveryLink =
    location.pathname === '/reset-password' ||
    browserPath === '/reset-password' ||
    browserHash.startsWith('#/reset-password') ||
    /(?:^|[&#])type=recovery(?:&|$)/.test(browserHash) ||
    /(?:^|[&#])access_token=/.test(browserHash)
  const showPasswordRecovery = storedRecoveryMode || isPasswordRecoveryLink

  if (isPasswordRecoveryLink && typeof window !== 'undefined') {
    sessionStorage.setItem('boroko_password_recovery', '1')
  }

  if (showPasswordRecovery) return <ResetPassword />

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <FeaturesProvider>
      <AuthenticatedShell
        alertCount={alertCount}
        dark={dark}
        setAlertCount={setAlertCount}
        setDark={setDark}
      />
    </FeaturesProvider>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  )
}
