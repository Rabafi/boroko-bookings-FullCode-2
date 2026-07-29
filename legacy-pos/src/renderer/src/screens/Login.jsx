import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import tsaBonnoRestaurantLogo from '../assets/tsa-bonno-restaurant-bar-os-logo-color.png';

const LEGACY_POS_REMEMBERED_EMAILS_KEY = 'boroko.legacyPos.rememberedEmails';
const MAX_REMEMBERED_EMAILS = 8;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function readRememberedEmails() {
  try {
    const stored = globalThis.localStorage?.getItem(LEGACY_POS_REMEMBERED_EMAILS_KEY);
    const parsed = JSON.parse(stored || '[]');
    return Array.isArray(parsed)
      ? parsed.map(normalizeEmail).filter(Boolean).slice(0, MAX_REMEMBERED_EMAILS)
      : [];
  } catch {
    return [];
  }
}

function saveRememberedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return readRememberedEmails();
  const next = [normalized, ...readRememberedEmails().filter((entry) => entry !== normalized)]
    .slice(0, MAX_REMEMBERED_EMAILS);
  try {
    globalThis.localStorage?.setItem(LEGACY_POS_REMEMBERED_EMAILS_KEY, JSON.stringify(next));
  } catch {
    // Email memory is a convenience only; sign-in must not depend on localStorage.
  }
  return next;
}

export default function Login({ onLogin, onOfflineUnlock }) {
  const [rememberedEmails, setRememberedEmails] = useState(() => readRememberedEmails());
  const [email, setEmail] = useState(() => readRememberedEmails()[0] || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(null);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    window.api.pos.getConfig().then((config) => {
      setConfigured(config.configured);
    }).catch(() => setConfigured(false));
    window.api.pos.updates?.getState?.().then(setUpdateInfo).catch(() => {});
  }, []);

  const handleUpdateAction = async () => {
    setUpdateBusy(true);
    try {
      const phase = updateInfo?.phase;
      const result = phase === 'available'
        ? await window.api.pos.updates.download()
        : phase === 'ready'
          ? await window.api.pos.updates.install()
          : await window.api.pos.updates.check();
      if (result?.blocked) {
        setError(`Finish sync or close shifts before installing: ${(result.safety?.blockers || []).join(', ')}`);
      }
      if (result?.state) setUpdateInfo(result.state);
      else await window.api.pos.updates?.getState?.().then(setUpdateInfo).catch(() => {});
    } finally {
      setUpdateBusy(false);
    }
  };

  const checkTrustedSession = useCallback(async (emailValue) => {
    if (!emailValue) { setHasSavedSession(false); return; }
    try {
      const result = await window.api.pos.hasTrustedSession(emailValue);
      setHasSavedSession(!!result);
    } catch {
      setHasSavedSession(false);
    }
  }, []);

  useEffect(() => {
    checkTrustedSession(normalizeEmail(email));
  }, [email, checkTrustedSession]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const loginEmail = normalizeEmail(email);
    if (!loginEmail || !password) {
      setError('Email and password are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onLogin(loginEmail, password);
      setEmail(loginEmail);
      setRememberedEmails(saveRememberedEmail(loginEmail));
    } catch (err) {
      const msg = err?.message || 'Login failed.';
      if (msg.includes('not configured') || msg.includes('Supabase')) {
        setError(msg);
      } else {
        setError(msg + ' Try again or use offline mode if available.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineUnlock = async (e) => {
    e.preventDefault();
    const loginEmail = normalizeEmail(email);
    if (!loginEmail || !password) {
      setError('Email and password are required for offline unlock.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (onOfflineUnlock) {
        await onOfflineUnlock(loginEmail, password);
      } else {
        await window.api.pos.restoreSession({ email: loginEmail, password });
      }
      setEmail(loginEmail);
      setRememberedEmails(saveRememberedEmail(loginEmail));
    } catch (err) {
      setError(err?.message || 'Offline unlock failed.');
    } finally {
      setLoading(false);
    }
  };

  if (configured === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-emerald-200 mx-auto" />
          <p className="text-xs text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="text-center">
            <img src={tsaBonnoRestaurantLogo} alt="Tsa Bonno Restaurant & Bar OS" className="mx-auto mb-4 h-24 w-72 max-w-full object-contain" draggable="false" />
            <h1 className="text-xl font-bold text-slate-800">Tsa Bonno POS Legacy</h1>
            <p className="mt-4 text-sm text-slate-600">
              This POS terminal is not configured. Contact the system administrator.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="text-center">
          <img src={tsaBonnoRestaurantLogo} alt="Tsa Bonno Restaurant & Bar OS" className="mx-auto mb-4 h-24 w-72 max-w-full object-contain" draggable="false" />
          <h1 className="text-xl font-bold text-slate-800">Tsa Bonno POS Legacy</h1>
          <p className="mt-1.5 text-sm text-slate-400">Sign in to your terminal</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              list="legacy-pos-remembered-emails"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="you@lodge.com"
              autoComplete="email"
              disabled={loading}
            />
            {rememberedEmails.length > 0 && (
              <datalist id="legacy-pos-remembered-emails">
                {rememberedEmails.map((savedEmail) => (
                  <option key={savedEmail} value={savedEmail} />
                ))}
              </datalist>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Your password"
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                disabled={loading}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <button
            type="button"
            onClick={handleOfflineUnlock}
            disabled={loading || !email || !password || !hasSavedSession}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Offline Unlock
          </button>
          {!hasSavedSession && (
            <p className="text-center text-xs text-slate-400">
              No saved session available. Connect to the internet to sign in first.
            </p>
          )}
        </form>

        <button
          type="button"
          onClick={handleUpdateAction}
          disabled={updateBusy}
          className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50 transition-colors"
        >
          {updateBusy ? 'Checking...' :
            updateInfo?.phase === 'available' ? `Update available (v${updateInfo.version})` :
            updateInfo?.phase === 'ready' ? 'Restart to Install Update' :
            'Check for Updates'}
        </button>
      </div>
    </div>
  );
}
