import { useEffect, useRef, useState, lazy, Suspense, createContext, useContext, useMemo } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Bell, Moon, RefreshCw, Sun, X } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { FeaturesProvider, useFeatures } from './contexts/FeaturesContext'
import { getSubscriptionPlan, normalizeSubscriptionPlan } from '@shared/subscriptionPlans'
import { supabase } from './lib/supabase'
import BottomNav from './components/BottomNav'
import { flushOfflineQueue, getQueueStatus } from './lib/api'
import { getRuntimeMeta, getUnreadPwaNotificationCount, listPwaNotifications, markPwaNotificationRead, removePwaNotification, subscribeRuntimeEvent } from './lib/runtime'

import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import borokoLogoDark from './assets/boroko-bookings-logo-dark.png'

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

function NotificationDetailSheet({ item, onClose, onClear }) {
  if (!item) return null

  const prettify = (value) => String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim() || 'general'
  const sentAt = item.meta?.sentAt || item.createdAt || null
  const updatedAt = item.meta?.updatedAt || item.updatedAt || null
  const requestBody = item.meta?.requestBody || item.message || ''
  const deskResponse = item.meta?.deskResponse || ''
  const requestStatus = prettify(item.meta?.requestStatus || (item.category === 'frontDeskRequest' ? 'open' : 'info'))
  const requestCategory = prettify(item.meta?.requestCategory || item.category || 'general')
  const isFrontDeskThread = Boolean(item.meta?.requestBody || item.meta?.deskResponse || item.category === 'frontDeskRequest')

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-[28px] border border-white/10 bg-gray-950 px-4 pb-8 pt-4 shadow-[0_-24px_90px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-700" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">Notification</p>
            <h2 className="mt-1 text-lg font-bold text-white">{item.title}</h2>
            <p className="mt-1 text-xs text-gray-400">{requestCategory} • {requestStatus}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/5 p-2 text-gray-300">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">What was sent</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-white">{requestBody || 'No request text was recorded.'}</p>
          </div>

          <div className="rounded-2xl border border-sky-900/60 bg-sky-950/30 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">Front desk response</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-sky-50">{deskResponse || 'Waiting for front desk to reply.'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Sent</p>
              <p className="mt-1 text-sm text-white">{sentAt ? new Date(sentAt).toLocaleString() : 'Just now'}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Updated</p>
              <p className="mt-1 text-sm text-white">{updatedAt ? new Date(updatedAt).toLocaleString() : 'Waiting'}</p>
            </div>
          </div>

          {item.message && item.message !== requestBody && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Summary</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">{item.message}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {item.href && (
              <button
                type="button"
                onClick={() => {
                  window.location.hash = `#${item.href}`
                  onClose()
                }}
                className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Open related screen
              </button>
            )}
            <button
              type="button"
              onClick={() => onClear(item)}
              className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-200"
            >
              Clear from inbox
            </button>
          </div>

          {!isFrontDeskThread && (
            <p className="text-xs text-gray-500">
              This is a general alert. Front desk requests show the sent note and reply together.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function NotificationCard({ item, onOpen, onClear }) {
  const [dragX, setDragX] = useState(0)
  const gestureRef = useRef({ active: false, startX: 0, startY: 0, swiped: false, pointerId: null })
  const isRead = Boolean(item.readAt)
  const toneClasses = item.tone === 'error'
    ? 'border-red-900 bg-red-950/45 text-red-100'
    : item.tone === 'warn'
      ? 'border-amber-900 bg-amber-950/45 text-amber-100'
      : 'border-blue-900 bg-blue-950/45 text-blue-100'

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gestureRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      swiped: false,
      pointerId: event.pointerId,
      offsetX: 0
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event) => {
    if (!gestureRef.current.active) return
    const deltaX = event.clientX - gestureRef.current.startX
    const deltaY = event.clientY - gestureRef.current.startY
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
      gestureRef.current.active = false
      gestureRef.current.offsetX = 0
      setDragX(0)
      return
    }
    if (deltaX < 0) {
      const next = Math.max(deltaX, -120)
      gestureRef.current.offsetX = next
      setDragX(next)
    } else {
      const next = Math.min(deltaX * 0.15, 24)
      gestureRef.current.offsetX = next
      setDragX(next)
    }
  }

  const finishGesture = () => {
    if (!gestureRef.current.active) {
      setDragX(0)
      return
    }
    const shouldDismiss = Number(gestureRef.current.offsetX || dragX || 0) <= -88
    gestureRef.current.active = false
    gestureRef.current.swiped = shouldDismiss
    gestureRef.current.offsetX = 0
    setDragX(0)
    if (shouldDismiss) {
      onClear(item)
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        if (gestureRef.current.swiped) {
          gestureRef.current.swiped = false
          event.preventDefault()
          return
        }
        onOpen(item)
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      style={{
        transform: `translateX(${dragX}px)`,
        touchAction: 'pan-y'
      }}
      className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition-transform duration-150 ${toneClasses} ${isRead ? 'opacity-80' : 'shadow-lg'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-white/10 p-2">
          <Bell size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{item.title}</p>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${isRead ? 'bg-white/10 text-white/70' : 'bg-white/15 text-white'}`}>
              {isRead ? 'Read' : 'New'}
            </span>
          </div>
          {item.message ? <p className="mt-1 text-xs opacity-90">{item.message}</p> : null}
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.16em] opacity-70">
            <span>Tap to open</span>
            <span>Swipe left to clear</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function NotificationCenter({ notificationCount, setNotificationCount }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [notifications, setNotifications] = useState([])
  const lastAnnouncedRef = useRef(null)
  const [activeNotification, setActiveNotification] = useState(null)

  useEffect(() => {
    if (!user?.lodge_id) return undefined
    const refresh = (detail) => {
      const next = listPwaNotifications(user.lodge_id, 6)
      setNotifications(next)
      setNotificationCount(getUnreadPwaNotificationCount(user.lodge_id))
      const latest = detail?.latest
      if (
        latest &&
        latest.id !== lastAnnouncedRef.current &&
        !latest.readAt
      ) {
        lastAnnouncedRef.current = latest.id
        showToast({
          title: latest.title,
          message: latest.message,
          tone: latest.tone === 'error' ? 'error' : latest.tone === 'warn' ? 'queued' : 'success',
          duration: 4200
        })
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(latest.title, { body: latest.message || 'Open Boroko Manager for details.' })
        }
      }
    }
    refresh({})
    const unsubscribe = subscribeRuntimeEvent('boroko:pwa-notifications', refresh)
    return () => unsubscribe?.()
  }, [setNotificationCount, showToast, user?.lodge_id])

  useEffect(() => {
    if (activeNotification && !notifications.some((item) => item.id === activeNotification.id)) {
      setActiveNotification(null)
    }
  }, [activeNotification, notifications])

  useEffect(() => {
    if (!activeNotification) return
    const latest = notifications.find((item) => item.id === activeNotification.id)
    if (latest && latest.updatedAt !== activeNotification.updatedAt) {
      setActiveNotification(latest)
    }
  }, [activeNotification, notifications])

  if (!notifications.length) return null

  const clearNotification = (item) => {
    removePwaNotification(user.lodge_id, item.sourceKey || item.id)
    if (activeNotification?.id === item.id) {
      setActiveNotification(null)
    }
  }

  return (
    <div className="mx-3 mt-2 space-y-2">
      <div className="rounded-3xl border border-white/10 bg-gray-900/90 px-4 py-3 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Notification inbox</p>
            <p className="text-xs text-gray-400 mt-1">
              Open a card to see the thread. Swipe left on mobile to clear it from the inbox.
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">
            {notificationCount} unread
          </span>
        </div>
      </div>
      {notifications.slice(0, 4).map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          onOpen={(notification) => {
            markPwaNotificationRead(user.lodge_id, notification.id)
            setActiveNotification(notification)
          }}
          onClear={clearNotification}
        />
      ))}
      <NotificationDetailSheet
        item={activeNotification}
        onClose={() => setActiveNotification(null)}
        onClear={clearNotification}
      />
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
        <h1 className="text-2xl font-bold text-white mt-3">Manager mobile app locked</h1>
        <p className="text-sm text-gray-300 mt-3">
          {user?.lodge_display_name || entitlement?.lodge_name || 'This lodge'} is not currently entitled to the manager mobile app.
        </p>
        <p className="text-sm text-gray-400 mt-2">
          The manager mobile app sits inside the {proPlan.name} plan because {proPlan.pitch.toLowerCase()}.
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

function AuthenticatedShell({ alertCount, dark, setDark, setAlertCount, notificationCount, setNotificationCount }) {
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
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-44 items-center">
            <img src={borokoLogoDark} alt="Boroko Manager" className="max-h-full max-w-full object-contain" draggable="false" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Boroko</p>
            <p className="truncate text-sm font-semibold text-white">Manager Mobile App</p>
          </div>
        </div>
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
      <NotificationCenter notificationCount={notificationCount} setNotificationCount={setNotificationCount} />

      <div className="flex-1 pwa-page-shell">
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
      <BottomNav alertCount={alertCount} notificationCount={notificationCount} />
    </div>
  )
}

function AppShell() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [alertCount, setAlertCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)
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
        notificationCount={notificationCount}
        setAlertCount={setAlertCount}
        setDark={setDark}
        setNotificationCount={setNotificationCount}
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
