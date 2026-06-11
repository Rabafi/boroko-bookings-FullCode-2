import { createClient } from '@supabase/supabase-js';
import { state } from '../state.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const AUTH_REDIRECT_URL = (
process.env.BOROKO_AUTH_REDIRECT_URL ||
import.meta.env.VITE_AUTH_REDIRECT_URL ||
'').
trim();

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

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

export function applyBackendSession(session) {
  authTrace('applyBackendSession', {
    hasIncomingToken: !!session?.token,
    incomingTokenLength: session?.token ? session.token.length : null,
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
