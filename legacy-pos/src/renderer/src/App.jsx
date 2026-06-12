import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
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
      }
    } catch (e) { console.error('Session restore failed:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { tryRestore(); }, [tryRestore]);

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
    return result;
  };

  const handleLogout = async () => {
    await window.api.pos.logout();
    setUser(null); setLodgeId(null); setSettings(null);
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent mx-auto" />
        <p className="mt-4 text-sm text-slate-500">Loading Boroko POS Legacy...</p>
      </div>
    </div>
  );

  if (window.location.hash === '#/customer-display') return <Suspense fallback={<LoadingFallback />}><CustomerDisplay /></Suspense>;
  if (window.location.hash === '#/kitchen-display') return <Suspense fallback={<LoadingFallback />}><KitchenDisplay /></Suspense>;
  if (!user) return <Login onLogin={handleLogin} />;

  const visibleTabs = lowResource?.enabled !== false
    ? (showAdvanced ? [...CORE_TABS, ...ADVANCED_TABS] : CORE_TABS)
    : [...CORE_TABS, ...ADVANCED_TABS];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-50 flex min-h-[56px] items-center justify-between border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-800">Boroko POS Legacy</h1>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {lowResource?.enabled !== false && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Low Resource</span>
          )}
        </div>
        <nav className="flex items-center gap-1.5">
          {visibleTabs.map(({ to, label }) => (
            <a key={to} href={`#${to}`} className="flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800">{label}</a>
          ))}
          {lowResource?.enabled !== false && !showAdvanced && (
            <button onClick={() => setShowAdvanced(true)} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600">More...</button>
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{user.name || user.email}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{user.role}</span>
          <button onClick={handleLogout} className="min-h-10 rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-600 hover:bg-red-100">Sign Out</button>
        </div>
      </header>
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
    </div>
  );
}
