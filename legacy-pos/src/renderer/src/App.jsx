import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import Login from './screens/Login';
import POSTerminal from './screens/POSTerminal';

const Orders = lazy(() => import('./screens/Orders'));
const CashUp = lazy(() => import('./screens/CashUp'));
const Tickets = lazy(() => import('./screens/Tickets'));
const MenuManagement = lazy(() => import('./screens/MenuManagement'));
const Tables = lazy(() => import('./screens/Tables'));
const Hardware = lazy(() => import('./screens/Hardware'));
const Sync = lazy(() => import('./screens/Sync'));
const Shifts = lazy(() => import('./screens/Shifts'));
const CustomerDisplay = lazy(() => import('./components/CustomerDisplay'));
const KitchenDisplay = lazy(() => import('./components/KitchenDisplay'));

const CORE_TABS = [
  { to: '/terminal', label: 'Terminal' },
  { to: '/orders', label: 'Orders' },
  { to: '/cashup', label: 'Cash-Up' },
  { to: '/sync', label: 'Sync' }
];

const ADVANCED_TABS = [
  { to: '/tickets', label: 'Tickets' },
  { to: '/menu', label: 'Menu' },
  { to: '/tables', label: 'Tables' },
  { to: '/shifts', label: 'Shifts' },
  { to: '/hardware', label: 'Hardware' }
];

function LoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-6 w-6 animate-pulse rounded-lg bg-emerald-200" />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [lodgeId, setLodgeId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [lowResource, setLowResource] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const displayLodgeName = settings?.lodge_name || settings?.company_name || user?.lodge_name || '';

  const tryRestore = useCallback(async () => {
    try {
      const config = await window.api.pos.getConfig();
      if (!config.configured) { setLoading(false); return; }
      const lr = await window.api.pos.getLowResourceConfig().catch(() => null);
      setLowResource(lr);
      const restored = await window.api.pos.restoreSession();
      if (restored) {
        setUser(restored.user);
        setLodgeId(restored.lodgeId);
        const s = await window.api.pos.getSettings().catch(() => null);
        setSettings(s);
        window.api.pos.bootstrapReferenceData().then((result) => {
          if (result?.settingsData) setSettings(result.settingsData);
        }).catch(() => {});
      }
    } catch (e) { console.error('Session restore failed:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { tryRestore(); }, [tryRestore]);

  useEffect(() => {
    window.api.pos.getWindowState().then((s) => {
      if (s) setIsFullscreen(s.isFullscreen);
    }).catch(() => {});
  }, []);

  // Online check: 30s in low-resource mode, 10s otherwise
  useEffect(() => {
    const check = async () => { const o = await window.api.pos.getIsOnline().catch(() => false); setIsOnline(o); };
    check();
    const intervalMs = lowResource?.onlineCheckMs || 30000;
    const interval = setInterval(check, intervalMs);
    return () => clearInterval(interval);
  }, [lowResource]);

  const handleLogin = async (email, password) => {
    const result = await window.api.pos.login(email, password);
    setUser(result.user); setLodgeId(result.lodgeId);
    const s = await window.api.pos.getSettings().catch(() => null);
    setSettings(s);
    window.api.pos.bootstrapReferenceData().then((r) => {
      if (r?.settingsData) setSettings(r.settingsData);
    }).catch(() => {});
    return result;
  };

  const handleOfflineUnlock = async (email, password) => {
    const result = await window.api.pos.restoreSession({ email, password });
    if (result) {
      setUser(result.user);
      setLodgeId(result.lodgeId);
      const s = await window.api.pos.getSettings().catch(() => null);
      setSettings(s);
      window.api.pos.bootstrapReferenceData().then((r) => {
        if (r?.settingsData) setSettings(r.settingsData);
      }).catch(() => {});
      return result;
    }
    throw new Error('Offline unlock failed.');
  };

  const handleLogout = async () => {
    await window.api.pos.logout();
    setUser(null); setLodgeId(null); setSettings(null);
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="text-center space-y-3">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-emerald-200 mx-auto" />
        <p className="text-xs text-slate-400">Loading...</p>
      </div>
    </div>
  );

  if (window.location.hash === '#/customer-display') return <Suspense fallback={<LoadingFallback />}><CustomerDisplay /></Suspense>;
  if (window.location.hash === '#/kitchen-display') return <Suspense fallback={<LoadingFallback />}><KitchenDisplay /></Suspense>;
  if (!user) return <Login onLogin={handleLogin} onOfflineUnlock={handleOfflineUnlock} />;

  const visibleTabs = lowResource?.enabled !== false
    ? (showAdvanced ? [...CORE_TABS, ...ADVANCED_TABS] : CORE_TABS)
    : [...CORE_TABS, ...ADVANCED_TABS];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="sticky top-0 z-50 flex min-h-[52px] items-center justify-between border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-slate-800">{displayLodgeName || 'Boroko POS'}</h1>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {lowResource?.enabled !== false && (
            <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-500" title="Running in low-resource mode">LR</span>
          )}
        </div>
        <nav className="flex items-center gap-0.5">
          {visibleTabs.map(({ to, label }) => (
            <a key={to} href={`#${to}`}
              className={`flex min-h-9 items-center rounded-md px-3 text-xs font-semibold transition-colors ${
                window.location.hash === `#${to}`
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}>{label}</a>
          ))}
          {lowResource?.enabled !== false && !showAdvanced && (
            <button onClick={() => setShowAdvanced(true)} className="min-h-9 rounded-md px-3 text-xs font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-600">More...</button>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const result = await window.api.pos.toggleFullscreen().catch(() => null);
              if (result) setIsFullscreen(result.isFullscreen);
            }}
            className="min-h-9 min-w-9 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <span className="text-xs text-slate-500">{user.name || user.email}</span>
          <button onClick={handleLogout} className="min-h-9 rounded-md px-2.5 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">Sign Out</button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <HashRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/terminal" replace />} />
              <Route path="/terminal" element={<POSTerminal user={user} settings={settings} isOnline={isOnline} lowResource={lowResource} />} />
              <Route path="/orders" element={<Orders user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/cashup" element={<CashUp user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/tickets" element={<Tickets user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/menu" element={<MenuManagement user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/tables" element={<Tables user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/shifts" element={<Shifts user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/hardware" element={<Hardware user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/sync" element={<Sync user={user} isOnline={isOnline} setIsOnline={setIsOnline} />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </main>
    </div>
  );
}
