// @ts-check
import { createClient } from '@supabase/supabase-js';
import { state } from '../state.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const AUTH_REDIRECT_URL = (
process.env.BOROKO_AUTH_REDIRECT_URL ||
import.meta.env.VITE_AUTH_REDIRECT_URL ||
'').
trim();

/** @param {string} label @param {Record<string, unknown>} [payload] */
function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

/** @param {string} key @param {unknown} [sessionToken] */
export function buildSupabaseClient(key, sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null;
  authTrace('buildSupabaseClient', {
    clientKind: key === SUPABASE_ANON_KEY ? 'anon' : 'non-anon',
    hasExplicitSessionToken: !!token,
    explicitSessionTokenLength: token ? token.length : null,
    currentLodgeId: state.lodgeId
  });
  return createClient(SUPABASE_URL, key, {
    global: {
      headers: token ? { 'x-boroko-session': token } : {}
    }
  });
}

export function buildSupabaseAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function getAuthRedirectUrl() {
  return AUTH_REDIRECT_URL || undefined;
}

/** @typedef {{token?: unknown, expires_at?: unknown, session_type?: unknown} | null | undefined} BackendSessionInput */

/** @param {BackendSessionInput} session */
export function applyBackendSession(session) {
  authTrace('applyBackendSession', {
    hasIncomingToken: !!session?.token,
    // Read only the existing `.length` property; this type view does not
    // validate the untrusted cache/backend token value.
    incomingTokenLength: session?.token ? /** @type {{length?: unknown}} */ (session.token).length : null,
    session_type: session?.session_type || null,
    expires_at: session?.expires_at || null,
    lodgeId: state.lodgeId
  });
  state.backendSession = session?.token ?
  {
    token: session.token,
    expires_at: session.expires_at || null,
    session_type: session.session_type || 'desktop'
  } :
  null;
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY, state.backendSession?.token || null);
}

export function clearBackendSession() {
  authTrace('clearBackendSession', {
    hadBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    lodgeId: state.lodgeId
  });
  applyBackendSession(null);
}

export function getBackendSession() {
  return state.backendSession ? { ...state.backendSession } : null;
}
