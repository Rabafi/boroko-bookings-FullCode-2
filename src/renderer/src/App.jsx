import { useState, useEffect, createContext, useContext, useRef, useCallback } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Rooms from './components/Rooms'
import Bookings from './components/Bookings'
import Calendar from './components/Calendar'
import Reports from './components/Reports'
import Staff from './components/Staff'
import Settings from './components/Settings'
import Setup from './components/Setup'
import RoomGrid from './components/RoomGrid'
import Guests from './components/Guests'
import Housekeeping from './components/Housekeeping'
import Expenses from './components/Expenses'
import Maintenance from './components/Maintenance'
import POS from './components/POS'
import Inventory from './components/Inventory'
import RoomSupplies from './components/RoomSupplies'
import NightAudit from './components/NightAudit'
import AdminCentral from './components/AdminCentral'
import MasterSetup from './components/MasterSetup'
import Conference from './components/Conference'
import DayUse from './components/DayUse'
import DataImport from './components/DataImport'

const AuthContext = createContext(null)
const SettingsContext = createContext(null)
const FeaturesContext = createContext({}) // { pos: true, inventory: true, ... }

// ── Tier that unlocks each feature ────────────────────────────────────────────
const FEATURE_TIER = {
  reports: 'Standard', expenses: 'Standard', staff: 'Standard',
  audit: 'Standard', conference: 'Standard', pool: 'Standard', import: 'Standard',
  pos: 'Pro', inventory: 'Pro', supplies: 'Pro'
}

// ── Upgrade Wall ───────────────────────────────────────────────────────────────
function UpgradeWall({ feature, children }) {
  const features = useContext(FeaturesContext)
  // Only block when flags have been loaded AND this feature is explicitly false
  if (Object.keys(features).length > 0 && features[feature] === false) {
    const requiredTier = FEATURE_TIER[feature] || 'Standard'
    const tierColor = requiredTier === 'Pro' ? 'purple' : 'blue'
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[500px] p-10 text-center select-none">
        <div className="text-6xl mb-5">🔒</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          {requiredTier} Plan Required
        </h2>
        <p className="text-gray-500 text-sm max-w-sm mb-6">
          This module is not included in your current subscription. Contact your account manager to upgrade and unlock it.
        </p>
        <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold ${
          tierColor === 'purple'
            ? 'bg-purple-100 text-purple-700 border border-purple-200'
            : 'bg-blue-100 text-blue-700 border border-blue-200'
        }`}>
          ✦ Upgrade to {requiredTier} to access this feature
        </div>
      </div>
    )
  }
  return children
}

// ── Update Banner ─────────────────────────────────────────────────────────────
function UpdateBanner() {
  const [state, setState] = useState(null) // null | 'downloading' | 'ready'
  const [version, setVersion] = useState('')
  const [progress, setProgress] = useState(0)
  const listenersAdded = useRef(false)

  useEffect(() => {
    if (listenersAdded.current || !window.api?.updates) return
    listenersAdded.current = true

    window.api.updates.onAvailable((info) => {
      setVersion(info.version)
      setState('downloading')
    })
    window.api.updates.onProgress((p) => {
      setProgress(p.percent)
    })
    window.api.updates.onReady((info) => {
      setVersion(info.version)
      setState('ready')
    })
  }, [])

  if (!state) return null

  if (state === 'downloading') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-blue-600 text-white text-sm flex items-center justify-between px-4 py-2 shadow-lg">
        <span>
          ⬇️ Downloading update v{version}…
        </span>
        <div className="flex items-center gap-3">
          <div className="w-32 bg-blue-400 rounded-full h-1.5">
            <div
              className="bg-white rounded-full h-1.5 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-blue-100 text-xs">{progress}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-green-600 text-white text-sm flex items-center justify-between px-4 py-2 shadow-lg">
      <span>
        ✅ <strong>Boroko Bookings v{version}</strong> is ready to install
      </span>
      <div className="flex items-center gap-3">
        <span className="text-green-200 text-xs">Saves automatically on next quit</span>
        <button
          onClick={() => window.api.updates.install()}
          className="bg-white text-green-700 font-semibold text-xs px-3 py-1 rounded hover:bg-green-50 transition-colors"
        >
          Restart Now
        </button>
        <button
          onClick={() => setState(null)}
          className="text-green-200 hover:text-white text-xs px-1"
        >
          ✕
        </button>
      </div>
    </div>
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
    <div className="fixed top-0 left-0 right-0 z-[9998] space-y-px">
      {broadcasts.map(b => (
        <div key={b.id} className="bg-purple-700 text-white text-sm flex items-center justify-between px-4 py-2 shadow-lg">
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

// ── Trial Expired Lock Screen ─────────────────────────────────────────────────
function TrialExpiredScreen({ lodgeName }) {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const TIERS = [
    { name: 'Starter', price: 'Contact us', color: 'blue', features: ['Room bookings', 'Check-in / Check-out', 'Basic reports', 'Up to 2 users'] },
    { name: 'Standard', price: 'Contact us', color: 'green', features: ['Everything in Starter', 'Expenses & Night Audit', 'Staff management', 'Full reports'] },
    { name: 'Pro', price: 'Contact us', color: 'purple', features: ['Everything in Standard', 'POS & Inventory', 'Room Supplies', 'Conference & Day Use'] }
  ]

  const requestUpgrade = async (tier) => {
    setSubmitting(true)
    try {
      await window.api.admin.createSupportTicket({
        lodge_name: lodgeName || 'Unknown Lodge',
        title: `Subscription Request — ${tier} Plan`,
        description: `The lodge has requested to subscribe to the ${tier} plan after their free trial ended.`,
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
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-3xl font-bold text-white mb-2">Your free trial has ended</h1>
        <p className="text-green-200 text-sm max-w-md">
          Thank you for trying Boroko Bookings. Choose a plan below to continue using all features.
        </p>
      </div>

      {submitted ? (
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Request sent!</h2>
          <p className="text-gray-500 text-sm">Our team will contact you shortly to activate your subscription. Thank you for choosing Boroko Bookings.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl">
          {TIERS.map((tier) => (
            <div key={tier.name} className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col">
              <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${tier.color === 'purple' ? 'text-purple-600' : tier.color === 'green' ? 'text-green-600' : 'text-blue-600'}`}>
                {tier.name}
              </div>
              <div className="text-lg font-bold text-gray-800 mb-4">{tier.price}</div>
              <ul className="space-y-1.5 flex-1 mb-5">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => requestUpgrade(tier.name)}
                disabled={submitting}
                className={`w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  tier.color === 'purple' ? 'bg-purple-600 hover:bg-purple-700' :
                  tier.color === 'green' ? 'bg-green-600 hover:bg-green-700' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {submitting ? 'Sending...' : `Get ${tier.name}`}
              </button>
            </div>
          ))}
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
    <div className={`${color} text-white text-xs flex items-center justify-between px-4 py-1.5 fixed top-0 left-0 right-0 z-[9997]`}>
      <span>🕐 <strong>{label} left</strong> in your free trial — contact us to subscribe and keep your data.</span>
      <button onClick={() => setDismissed(true)} className="ml-4 opacity-70 hover:opacity-100 text-base leading-none">×</button>
    </div>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function useFeatures() {
  return useContext(FeaturesContext)
}

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('bb_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // Dark mode — apply saved preference on startup
  useEffect(() => {
    if (localStorage.getItem('bb_dark_mode') === 'true') {
      document.documentElement.classList.add('dark-mode')
    }
  }, [])

  const [settings, setSettings] = useState(null)
  const [setupComplete, setSetupComplete] = useState(null) // null = loading
  const [showSetup, setShowSetup] = useState(false)
  const [features, setFeatures] = useState({}) // feature flags keyed by feature name
  const [trialStatus, setTrialStatus] = useState(null) // null = loading

  const loadFeatures = (lodgeId) => {
    if (!lodgeId || !window.api?.admin?.getLodgeFeatures) return
    window.api.admin.getLodgeFeatures(lodgeId).then((flags) => {
      if (!Array.isArray(flags) || flags.length === 0) return
      const map = {}
      flags.forEach(f => { map[f.feature_name] = f.enabled })
      setFeatures(map)
    }).catch(() => {})
  }

  useEffect(() => {
    let interval
    window.api.settings.get().then((s) => {
      setSettings(s)
      setSetupComplete(s?.setup_complete === true)
      loadFeatures(s?.lodge_id)
      // Re-check feature flags every 60s so plan upgrades reflect without restart
      interval = setInterval(() => loadFeatures(s?.lodge_id), 60_000)
      // Check trial/license status
      if (s?.lodge_id && window.api?.trial) {
        window.api.trial.getStatus(s.lodge_id).then(setTrialStatus).catch(() => setTrialStatus({ status: 'trial', daysLeft: 3, expired: false }))
      } else {
        setTrialStatus({ status: 'trial', daysLeft: 3, expired: false })
      }
    })
    return () => clearInterval(interval)
  }, [])

  const login = (userData) => {
    localStorage.setItem('bb_user', JSON.stringify(userData))
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('bb_user')
    setUser(null)
  }

  const handleSetupComplete = (newSettings) => {
    setSettings(newSettings)
    setSetupComplete(true)
    setShowSetup(false)
  }

  // Still loading settings
  if (setupComplete === null) {
    return (
      <div className="min-h-screen bg-green-900 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="text-4xl mb-3">🏕️</div>
          <p className="text-green-200 text-sm">Loading Boroko Bookings...</p>
        </div>
      </div>
    )
  }

  // First time or user clicked Sign Up — show lodge setup wizard
  if (!setupComplete || showSetup) {
    return <Setup onComplete={handleSetupComplete} onCancel={setupComplete ? () => setShowSetup(false) : null} />
  }

  // Trial expired and no license — full lock screen (master admins bypass)
  if (trialStatus?.expired && !user?.isMasterAdmin) {
    return <TrialExpiredScreen lodgeName={settings?.lodge_name} />
  }

  // Master admin gets Command Central, no regular app
  if (user?.isMasterAdmin) {
    return (
      <AuthContext.Provider value={{ user, login, logout }}>
        <SettingsContext.Provider value={{ settings, setSettings }}>
          <AdminCentral />
        </SettingsContext.Provider>
      </AuthContext.Provider>
    )
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <UpdateBanner />
      <BroadcastBanner />
      {trialStatus?.status === 'trial' && !user?.isMasterAdmin && (
        <TrialBanner daysLeft={trialStatus.daysLeft} />
      )}
      <FeaturesContext.Provider value={features}>
      <SettingsContext.Provider value={{ settings, setSettings }}>
        <HashRouter>
          <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onSignUp={() => setShowSetup(true)} />} />
            {/* One-time master admin setup — accessible without login */}
            <Route path="/master-setup" element={<MasterSetup onComplete={() => window.location.hash = '/login'} />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              {/* Always available */}
              <Route index element={<Dashboard />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="roomgrid" element={<RoomGrid />} />
              <Route path="guests" element={<Guests />} />
              <Route path="housekeeping" element={<Housekeeping />} />
              <Route path="maintenance" element={<Maintenance />} />
              <Route path="settings" element={<Settings />} />
              {/* Standard tier */}
              <Route path="reports"    element={<UpgradeWall feature="reports">   <Reports />   </UpgradeWall>} />
              <Route path="expenses"   element={<UpgradeWall feature="expenses">  <Expenses />  </UpgradeWall>} />
              <Route path="staff"      element={<UpgradeWall feature="staff">     <Staff />     </UpgradeWall>} />
              <Route path="audit"      element={<UpgradeWall feature="audit">     <NightAudit /></UpgradeWall>} />
              <Route path="conference" element={<UpgradeWall feature="conference"><Conference /></UpgradeWall>} />
              <Route path="dayuse"     element={<UpgradeWall feature="pool">      <DayUse />    </UpgradeWall>} />
              <Route path="import"     element={<UpgradeWall feature="import">    <DataImport /></UpgradeWall>} />
              {/* Pro tier */}
              <Route path="pos"        element={<UpgradeWall feature="pos">       <POS />       </UpgradeWall>} />
              <Route path="inventory"  element={<UpgradeWall feature="inventory"> <Inventory /> </UpgradeWall>} />
              <Route path="supplies"   element={<UpgradeWall feature="supplies">  <RoomSupplies /></UpgradeWall>} />
            </Route>
          </Routes>
        </HashRouter>
      </SettingsContext.Provider>
      </FeaturesContext.Provider>
    </AuthContext.Provider>
  )
}
