import { useState, useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Beer, ShoppingCart, ClipboardList, Package, Users, Settings as SettingsIcon, LogOut, Clock, WifiOff } from 'lucide-react'
import Login from './screens/Login'
import POSTerminal from './screens/POSTerminal'
import Orders from './screens/Orders'
import Inventory from './screens/Inventory'
import Staff from './screens/Staff'
import CashUp from './screens/CashUp'
import SettingsScreen from './screens/SettingsScreen'

const NAV_ITEMS = [
  { to: '/terminal', label: 'Sell', icon: ShoppingCart },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/inventory', label: 'Stock', icon: Package },
  { to: '/staff', label: 'Staff', icon: Users },
  { to: '/cashup', label: 'Cash Up', icon: Clock },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function App() {
  const [user, setUser] = useState(null)
  const [lodgeId, setLodgeId] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const tryRestore = useCallback(async () => {
    try {
      const restored = await window.barAPI.restoreSession()
      if (restored) {
        setUser(restored.user)
        setLodgeId(restored.lodgeId)
        const s = await window.barAPI.getSettings().catch(() => null)
        setSettings(s)
      }
    } catch { /* no session */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { tryRestore() }, [tryRestore])

  const handleLogin = async (email, password) => {
    const result = await window.barAPI.login(email, password)
    setUser(result.user)
    setLodgeId(result.lodgeId)
    const s = await window.barAPI.getSettings().catch(() => null)
    setSettings(s)
    return result
  }

  const handleLogout = async () => {
    if (user) await window.barAPI.logout(user.id).catch(() => {})
    setUser(null)
    setLodgeId(null)
    setSettings(null)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-4">
          <Beer className="w-12 h-12 text-brand-500 animate-pulse" />
          <div className="h-1 w-32 bg-stone-800 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-brand-500 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <HashRouter>
      <div className="flex h-screen bg-stone-950">
        {/* Sidebar */}
        <nav className="w-56 bg-stone-900/50 border-r border-stone-800 flex flex-col shrink-0">
          <div className="flex items-center gap-2.5 px-4 h-14 border-b border-stone-800">
            <Beer className="w-6 h-6 text-brand-500" />
            <span className="font-semibold text-sm text-stone-100">Bar POS</span>
            <span className="ml-auto text-[10px] text-stone-600 font-mono">v1</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {NAV_ITEMS.map(item => (
              <a
                key={item.to}
                href={`#${item.to}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-stone-400
                  hover:text-stone-100 hover:bg-stone-800/60 transition-colors"
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </a>
            ))}
          </div>

          <div className="border-t border-stone-800 p-3 space-y-2">
            <div className="flex items-center gap-2 px-2">
              <div className="w-6 h-6 rounded-full bg-brand-800 flex items-center justify-center text-[10px] font-bold text-brand-200">
                {user.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-stone-300 truncate">{user.name}</div>
                <div className="text-[10px] text-stone-600">{user.role}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="btn-ghost w-full text-xs justify-start gap-2">
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/terminal" element={<POSTerminal user={user} settings={settings} />} />
            <Route path="/orders" element={<Orders user={user} />} />
            <Route path="/inventory" element={<Inventory user={user} />} />
            <Route path="/staff" element={<Staff user={user} />} />
            <Route path="/cashup" element={<CashUp user={user} settings={settings} />} />
            <Route path="/settings" element={<SettingsScreen user={user} settings={settings} onSettingsChange={setSettings} />} />
            <Route path="/" element={<Navigate to="/terminal" replace />} />
            <Route path="*" element={<Navigate to="/terminal" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
