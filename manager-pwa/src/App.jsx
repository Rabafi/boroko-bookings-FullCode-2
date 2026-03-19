import { useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { FeaturesProvider } from './contexts/FeaturesContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Rooms from './pages/Rooms'
import Bookings from './pages/Bookings'
import Reports from './pages/Reports'
import Alerts from './pages/Alerts'
import BottomNav from './components/BottomNav'

// Register service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

function AppShell() {
  const { user, loading } = useAuth()
  const [alertCount, setAlertCount] = useState(0)

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
      <div className="flex flex-col min-h-screen bg-gray-950">
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/rooms"    element={<Rooms />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/reports"  element={<Reports />} />
          <Route path="/alerts"   element={<Alerts onCountChange={setAlertCount} />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
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
