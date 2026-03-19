import { useState, useEffect, useRef, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sun, Moon, X } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { FeaturesProvider } from './contexts/FeaturesContext'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Rooms from './pages/Rooms'
import Bookings from './pages/Bookings'
import Reports from './pages/Reports'
import Alerts from './pages/Alerts'
import BottomNav from './components/BottomNav'

// Register service worker and store registration for push subscription
let swRegistration = null
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => { swRegistration = reg })
      .catch(() => {})
  })
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

async function subscribeToPush(user) {
  try {
    if (!swRegistration || !import.meta.env.VITE_VAPID_PUBLIC_KEY) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY)
    })
    const json = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      lodge_id: user.lodge_id,
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: 'lodge_id,endpoint' })
  } catch (_) { /* silently skip if push not supported */ }
}

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('boroko_pwa_theme')
    return saved ? saved === 'dark' : true
  })

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.remove('light-mode')
    } else {
      document.documentElement.classList.add('light-mode')
    }
    localStorage.setItem('boroko_pwa_theme', dark ? 'dark' : 'light')
  }, [dark])

  return [dark, setDark]
}

function BroadcastBanners() {
  const [banners, setBanners] = useState([])

  const load = async () => {
    const dismissed = JSON.parse(sessionStorage.getItem('boroko_pwa_dismissed_broadcasts') || '[]')
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('broadcasts')
      .select('id, title, message')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
    if (data) setBanners(data.filter(b => !dismissed.includes(b.id)))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const dismiss = (id) => {
    const dismissed = JSON.parse(sessionStorage.getItem('boroko_pwa_dismissed_broadcasts') || '[]')
    sessionStorage.setItem('boroko_pwa_dismissed_broadcasts', JSON.stringify([...dismissed, id]))
    setBanners(prev => prev.filter(b => b.id !== id))
  }

  if (banners.length === 0) return null

  return (
    <div className="flex flex-col gap-1 px-3 pt-2">
      {banners.map(b => (
        <div key={b.id} className="flex items-start gap-2 bg-green-900/80 border border-green-700 rounded-lg px-3 py-2 text-sm">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-green-200 truncate">{b.title}</p>
            <p className="text-green-300 text-xs mt-0.5">{b.message}</p>
          </div>
          <button onClick={() => dismiss(b.id)} className="text-green-400 hover:text-white shrink-0 mt-0.5">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function AppShell() {
  const { user, loading } = useAuth()
  const [alertCount, setAlertCount] = useState(0)
  const [dark, setDark] = useDarkMode()

  // Subscribe to push notifications once after login
  useEffect(() => {
    if (user) subscribeToPush(user)
  }, [user?.id])

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
      <div className="flex flex-col min-h-screen bg-gray-950 app-bg">
        {/* Theme toggle header bar */}
        <div className="flex justify-end px-4 pt-3 pb-1">
          <button
            onClick={() => setDark(d => !d)}
            className="p-2 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <BroadcastBanners />

        <div className="flex-1">
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/rooms"    element={<Rooms />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/reports"  element={<Reports />} />
            <Route path="/alerts"   element={<Alerts onCountChange={setAlertCount} />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <BottomNav alertCount={alertCount} />
      </div>
    </FeaturesProvider>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </HashRouter>
  )
}
