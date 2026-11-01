import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import Login from './screens/Login';
import BarLocalWorkspace from './screens/BarLocalWorkspace';
import POSTerminal from './screens/POSTerminal';
import tsaBonnoHospitalityLogo from './assets/tsa-bonno-hospitalityos-logo.png';
import { isBarOnlyMode } from '../../../../src/shared/propertyTypes.js';

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

function LegacyBarPairBoundary({ initialAuthority }) {
  const [authority, setAuthority] = useState(initialAuthority);
  const [draft, setDraft] = useState({ base_url: '', certificate_fingerprint: '', pairing_code: '', device_name: 'Bar till' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pairCommitted, setPairCommitted] = useState(false);
  const recovery = authority?.provisioning_recovery;

  if (authority?.mode === 'bar_local' && authority?.configured && !authority?.restart_required) return <BarLocalWorkspace authority={authority} />;
  const hasSavedCloudBusiness = authority?.has_saved_cloud_business === true;
  const canPair = authority?.mode === 'cloud' && authority?.configured === false && !hasSavedCloudBusiness && !pairCommitted;

  const pair = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await window.api.pos.barLocal.pairDevice(draft);
      setPairCommitted(true);
      setNotice('Pairing was committed. Close and reopen the application before signing in. Do not reuse the pairing code.');
      const status = await window.api.pos.barLocal.getStatus();
      setAuthority({ ...status, mode: status.authority_mode });
      setDraft((current) => ({ ...current, pairing_code: '' }));
    } catch (cause) {
      setError(cause && typeof cause.message === 'string' ? cause.message : 'This till could not join the local Bar server. Confirm the HTTPS address, certificate fingerprint and unused pairing code.');
    } finally { setBusy(false); }
  };

  const resumePairing = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await window.api.pos.barLocal.resumeProvisioning();
      setPairCommitted(true);
      setNotice('Pairing was committed. Close and reopen the application before signing in. Do not reuse the pairing code.');
      const status = await window.api.pos.barLocal.getStatus();
      setAuthority({ ...status, mode: status.authority_mode });
    } catch (cause) {
      setError(cause && typeof cause.message === 'string' ? cause.message : 'The saved pairing could not be resumed. Preserve this till and contact your supervisor.');
    } finally { setBusy(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Bar local authority</p>
        <h1 className="mt-3 text-2xl font-bold">{canPair ? 'Join the office Bar server' : hasSavedCloudBusiness ? 'Existing cloud workspace' : authority?.restart_required || pairCommitted ? 'Restart this till' : 'Local authority needs repair'}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{canPair
          ? 'Enter the one-time pairing details from the authorised Modern office till. Legacy POS stays a client; it does not host the local database.'
          : authority?.message || 'The saved local authority state is unavailable. Cloud login and cloud-backed screens remain disabled until this till is repaired or re-paired through the approved process.'}</p>
          {recovery?.pending && <div className="mt-5 rounded border border-amber-700 bg-amber-950/40 p-4 text-sm">
            <p>{recovery.recoverable ? 'A pairing attempt is safely saved on this till. Resume it to finish the same pairing; the original one-time code will be reused only with its saved request.' : 'A saved pairing record needs repair. Do not pair again or clear this till; contact your supervisor.'}</p>
            {recovery.recoverable && <button type="button" disabled={busy} onClick={resumePairing} className="mt-3 w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Resuming…' : 'Resume saved pairing'}</button>}
          </div>}
          {canPair && !recovery?.pending && <form onSubmit={pair} className="mt-5 space-y-3">
          <label className="block text-sm">Bar server HTTPS address<input required placeholder="https://bar-office.local:8787" value={draft.base_url} onChange={(event) => setDraft((current) => ({ ...current, base_url: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
          <label className="block text-sm">Certificate fingerprint<input required autoComplete="off" value={draft.certificate_fingerprint} onChange={(event) => setDraft((current) => ({ ...current, certificate_fingerprint: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2 font-mono text-xs" /></label>
          <label className="block text-sm">Single-use pairing code<input required inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="one-time-code" value={draft.pairing_code} onChange={(event) => setDraft((current) => ({ ...current, pairing_code: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
          <label className="block text-sm">Till name<input required maxLength={120} value={draft.device_name} onChange={(event) => setDraft((current) => ({ ...current, device_name: event.target.value }))} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
          <button disabled={busy} className="w-full rounded bg-amber-500 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Pairing…' : 'Pair this Legacy till'}</button>
        </form>}
        {hasSavedCloudBusiness && authority?.mode === 'cloud' && <p className="mt-4 text-sm text-amber-200">This till has saved cloud configuration or business data. Its transactions and queue must be reconciled before local activation. Continue using the existing workspace; do not create an empty replacement.</p>}
        {(authority?.restart_required || pairCommitted) && <p role="status" className="mt-4 text-sm text-amber-200">Pairing is saved. Close and reopen the application to continue. Do not repeat pairing or reuse the code.</p>}
        {authority?.mode === 'cloud' && authority?.workspace_choice_required && !pairCommitted && <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try {
            await window.api.pos.barLocal.selectCloudWorkspace();
            setNotice('Close and reopen the application to continue to the existing cloud workspace.');
          } catch (cause) { setError(cause?.message || 'The workspace choice could not be saved. Try again.'); setBusy(false); }
        }} className="mt-5 w-full rounded border border-slate-500 p-3 text-sm disabled:opacity-50">Continue to lodge, restaurant or existing cloud business</button>}
        {error && <p role="alert" className="mt-4 rounded bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded bg-emerald-950 p-3 text-sm text-emerald-200">{notice}</p>}
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [lodgeId, setLodgeId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [localAuthorityGate, setLocalAuthorityGate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [lowResource, setLowResource] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const displayLodgeName = settings?.lodge_name || settings?.company_name || user?.lodge_name || '';
  const barOnly = isBarOnlyMode(settings);

  const tryRestore = useCallback(async () => {
    try {
      let authority;
      try {
        authority = await window.api.pos.barLocal.getStatus();
      } catch {
        setLocalAuthorityGate({ mode: 'unknown', message: 'The Legacy Bar authority state could not be verified. Restart the till or contact your supervisor.' });
        setLoading(false);
        return;
      }
      if (!authority || authority.authority_mode !== 'cloud' || authority.workspace_choice_required) {
        setLocalAuthorityGate({
          ...authority,
          mode: authority?.authority_mode || 'unknown',
          message: authority?.blocked_reason?.message || 'The Legacy Bar authority state could not be verified. Restart the till or contact your supervisor.'
        });
        setLoading(false);
        return;
      }
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

  const handleLogin = async (email, password, lodgeId = null) => {
    const result = await window.api.pos.login(email, password, lodgeId);
    if (result?.code === 'company_selection_required') return result;
    setUser(result.user); setLodgeId(result.lodgeId);
    const s = await window.api.pos.getSettings().catch(() => null);
    setSettings(s);
    window.api.pos.bootstrapReferenceData().then((r) => {
      if (r?.settingsData) setSettings(r.settingsData);
    }).catch(() => {});
    return result;
  };

  const handleOfflineUnlock = async (email, password, lodgeId = null) => {
    const result = await window.api.pos.restoreSession({ email, password, lodgeId });
    if (result?.code === 'company_selection_required') return result;
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
  if (!user && localAuthorityGate) {
    return <LegacyBarPairBoundary initialAuthority={localAuthorityGate} />;
  }
  if (!user) return <Login onLogin={handleLogin} onOfflineUnlock={handleOfflineUnlock} />;

  const visibleTabs = (lowResource?.enabled !== false
    ? (showAdvanced ? [...CORE_TABS, ...ADVANCED_TABS] : CORE_TABS)
    : [...CORE_TABS, ...ADVANCED_TABS]).filter((tab) => !barOnly || !['/tickets', '/tables'].includes(tab.to));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="sticky top-0 z-50 flex min-h-[52px] items-center justify-between border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={tsaBonnoHospitalityLogo} alt="Tsa Bonno HospitalityOS" className="h-10 w-28 object-contain" draggable="false" />
          <h1 className="text-base font-bold text-slate-800">{displayLodgeName || 'Tsa Bonno POS Legacy'}</h1>
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
              <Route path="/terminal" element={<POSTerminal user={user} settings={settings} isOnline={isOnline} lowResource={lowResource} barOnly={barOnly} />} />
              <Route path="/orders" element={<Orders user={user} settings={settings} isOnline={isOnline} barOnly={barOnly} />} />
              <Route path="/cashup" element={<CashUp user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/tickets" element={barOnly ? <Navigate to="/terminal" replace /> : <Tickets user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/menu" element={<MenuManagement user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/tables" element={barOnly ? <Navigate to="/terminal" replace /> : <Tables user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/shifts" element={<Shifts user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/hardware" element={<Hardware user={user} settings={settings} isOnline={isOnline} />} />
              <Route path="/sync" element={<Sync user={user} isOnline={isOnline} setIsOnline={setIsOnline} barOnly={barOnly} />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </main>
    </div>
  );
}
