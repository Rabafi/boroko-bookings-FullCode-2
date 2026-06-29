import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { state } from '../state.js';
import {
  mergeSessionUserScope,
  normalizeSessionUser,
  upsertCachedUser
} from './authCache.js';
import {
  applyBackendSession,
  clearBackendSession,
  getBackendSession
} from './authClients.js';
import { readCache } from './cacheStore.js';
import { checkOnline } from './connectivity.js';
import { touchUserPresence } from './users.js';
import {
  normalizeStaffStatus,
  STAFF_STATUS_LABELS
} from '../../shared/accessControl.js';
import {
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
import {
  readSecureJson,
  removeSecureJson,
  writeSecureJson
} from './secureLocalStore.js';

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

function isPosFullAccessRole(role) {
  return ['admin', 'manager', 'super_admin'].includes((role || '').toLowerCase());
}

function ensureActiveSessionUser(user) {
  const status = normalizeStaffStatus(user?.status);
  if (status === 'active') return null;
  return status === 'archived'
    ? `This staff account is ${STAFF_STATUS_LABELS[status].toLowerCase()}. Connect to the internet and ask an admin to restore it before signing in again.`
    : `This staff account is ${STAFF_STATUS_LABELS[status].toLowerCase()}. Connect to the internet and ask an admin to reactivate it before signing in again.`;
}

const CURRENT_SESSION_NONCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TRUSTED_SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // password-unlocked offline sessions

function getSessionNoncePath() {
  return path.join(state.cacheDir, 'session-nonce.json');
}

function getTrustedSessionsPath() {
  return path.join(state.cacheDir, 'trusted-sessions.json');
}

export function readSessionNonce() {
  return readSecureJson(getSessionNoncePath(), null);
}

function readTrustedSessions() {
  const parsed = readSecureJson(getTrustedSessionsPath(), []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeTrustedSessions(sessions) {
  writeSecureJson(getTrustedSessionsPath(), Array.isArray(sessions) ? sessions : []);
}

export function pruneExpiredTrustedSessions(sessions = readTrustedSessions()) {
  const now = Date.now();
  const active = sessions.filter((session) => {
    const createdAt = new Date(session?.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= TRUSTED_SESSION_MAX_AGE_MS;
  });
  if (active.length !== sessions.length) writeTrustedSessions(active);
  return active;
}

export function normalizeTrustedSessionRecord(record) {
  if (!record?.nonce) return null;
  return {
    ...record,
    userId: record.userId || record.id || null,
    id: record.id || record.userId || null,
    email: normalizeEmail(record.email),
    lodge_id: normalizeLodgeId(record.lodge_id || state.lodgeId),
    createdAt: record.createdAt || new Date().toISOString()
  };
}

function buildTrustedSessionRecord(user, nonce, password = '') {
  const session = getBackendSession();
  const normalizedUser = normalizeSessionUser(user);
  const record = normalizedUser && typeof normalizedUser === 'object' ?
  {
    id: normalizedUser.id || null,
    email: normalizedUser.email || null,
    name: normalizedUser.name || null,
    role: normalizedUser.role || null,
    lodge_id: normalizedUser.lodge_id || null,
    ...(Object.prototype.hasOwnProperty.call(normalizedUser, 'allowed_outlet_ids') ?
    { allowed_outlet_ids: normalizedUser.allowed_outlet_ids } :
    {}),
    isMasterAdmin: Boolean(normalizedUser.isMasterAdmin),
    session_token: session?.token || null,
    session_expires_at: session?.expires_at || null,
    session_type: session?.session_type || null
  } :
  {
    id: user || null,
    email: null,
    name: null,
    role: null,
    lodge_id: null,
    isMasterAdmin: false,
    session_token: session?.token || null,
    session_expires_at: session?.expires_at || null,
    session_type: session?.session_type || null
  };

  return {
    userId: record.id,
    ...record,
    nonce,
    createdAt: new Date().toISOString(),
    offline_password_hash: password ? bcrypt.hashSync(password, 10) : null
  };
}

export function writeSessionNonce(user, nonce, password = '') {
  const record = buildTrustedSessionRecord(user, nonce, password);
  writeSecureJson(getSessionNoncePath(), record);

  const sessions = pruneExpiredTrustedSessions();
  const normalizedRecord = normalizeTrustedSessionRecord(record);
  if (!normalizedRecord?.id && !normalizedRecord?.email) return;
  const existing = sessions.find((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email);

  });
  const nextRecord = {
    ...(existing || {}),
    ...record,
    offline_password_hash: record.offline_password_hash || existing?.offline_password_hash || null
  };
  const next = sessions.filter((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return !(normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email));

  });
  next.push(nextRecord);
  writeTrustedSessions(next);
}

export function clearSessionNonce() {
  removeSecureJson(getSessionNoncePath());
}

export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex');
  writeSessionNonce(user, nonce, password);
  return nonce;
}

export function setCurrentUser(user) {
  state.currentUser = normalizeSessionUser(user);
  if (state.currentUser?.isMasterAdmin) {
    clearBackendSession();
  }
  if (state.currentUser) {
    state.replayAuthReady = true;
    // Trigger local P2P Mesh initialization
    import('./mesh/meshLifecycle.js').then((module) => {
      module.initializeMesh();
    }).catch((err) => console.error('[Mesh] Failed to initialize mesh:', err));
  }
}

export function getCurrentUser() {
  return state.currentUser;
}

export function logoutCurrentUser({ forgetTrustedSession = false } = {}) {
  state.currentUser = null;
  state.replayAuthReady = false;
  clearBackendSession();
  if (forgetTrustedSession) clearSessionNonce();

  // Shut down local P2P Mesh operations
  import('./mesh/meshLifecycle.js').then((module) => {
    module.shutdownMesh();
  }).catch((err) => console.error('[Mesh] Failed to shutdown mesh:', err));
}

export function restoreCurrentTrustedSession() {
  const stored = readSessionNonce();
  const nonce = typeof stored?.nonce === 'string' ? stored.nonce : '';
  if (!nonce) return null;
  return restoreUserSession(nonce);
}

export function restoreUserSession(nonce, options = {}) {
  const maxAgeMs = options?.trustedUnlock === true
    ? TRUSTED_SESSION_MAX_AGE_MS
    : CURRENT_SESSION_NONCE_MAX_AGE_MS;
  authTrace('restoreSession start', { hasNonce: !!nonce, nonceLength: typeof nonce === 'string' ? nonce.length : null });
  console.log('[AUTH] restoreSession requested');
  if (!nonce) {
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    console.log('[AUTH] restoreSession cleared current user');
    authTrace('restoreSession result', { restored: false, reason: 'no_nonce' });
    return null;
  }

  let stored = readSessionNonce();
  if (!stored || stored.nonce !== nonce) {
    stored = pruneExpiredTrustedSessions().
    map(normalizeTrustedSessionRecord).
    filter(Boolean).
    find((session) => session.nonce === nonce && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)));
  }
  if (!stored || stored.nonce !== nonce) {
    console.warn('[AUTH] restoreSession REJECTED: invalid or missing session nonce');
    state.currentUser = null;
    clearBackendSession();
    authTrace('restoreSession result', { restored: false, reason: 'invalid_or_missing_nonce' });
    return null;
  }

  const age = Date.now() - new Date(stored.createdAt).getTime();
  if (age > maxAgeMs) {
    console.warn('[AUTH] restoreSession REJECTED: nonce expired', { ageMs: age });
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'nonce_expired' });
    return null;
  }

  const userId = stored.userId;
  if (stored.isMasterAdmin) {
    clearBackendSession();
    const safeUser = normalizeSessionUser({
      id: userId,
      email: stored.email || '',
      name: stored.name || 'Master Admin',
      role: stored.role || 'super_admin',
      isMasterAdmin: true
    });
    setCurrentUser(safeUser);
    console.log('[AUTH] restoreSession restored master admin:', {
      userId: safeUser.id,
      email: safeUser.email
    });
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, role: safeUser.role, isMasterAdmin: true });
    return safeUser;
  }

  if (stored.email && stored.role) {
    applyBackendSession({
      token: stored.session_token || null,
      expires_at: stored.session_expires_at || null,
      session_type: stored.session_type || 'desktop'
    });
    const users = readCache('users').
    map(normalizeUserRecord).
    filter(Boolean);
    const cachedById = users.find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
    const cachedByEmail = stored.email ?
    users.find((u) => u.email === normalizeEmail(stored.email) && (u.lodge_id ? u.lodge_id === state.lodgeId : true)) :
    null;
    const hasStoredScope = Object.prototype.hasOwnProperty.call(stored, 'allowed_outlet_ids');
    const nonceUser = normalizeSessionUser({
      id: userId,
      email: stored.email,
      name: stored.name || '',
      role: stored.role,
      lodge_id: stored.lodge_id || state.lodgeId,
      ...(hasStoredScope ? { allowed_outlet_ids: stored.allowed_outlet_ids } : {})
    });
    const mergedUser = hasStoredScope ?
    nonceUser :
    mergeSessionUserScope(
      nonceUser,
      cachedById || cachedByEmail || {
        allowed_outlet_ids: isPosFullAccessRole(stored.role) ?
        null :
        []
      }
    );
    const safeUser = normalizeSessionUser(mergedUser);
    const inactiveMessage = ensureActiveSessionUser(safeUser);
    if (inactiveMessage) {
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      authTrace('restoreSession result', { restored: false, reason: 'inactive_staff', userId: safeUser.id, status: safeUser.status });
      return null;
    }
    setCurrentUser(safeUser);
    console.log('[AUTH] restoreSession restored from nonce metadata:', {
      userId: safeUser.id,
      email: safeUser.email,
      lodge_id: safeUser.lodge_id || state.lodgeId
    });
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'nonce_metadata' });
    return safeUser;
  }

  const users = readCache('users');
  const user = users.
  map(normalizeUserRecord).
  filter(Boolean).
  find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
  if (!user) {
    console.warn('[AUTH] restoreSession cache miss for stored userId:', userId);
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'user_cache_miss', userId });
    return null;
  }
  const { password_hash: _ph, ...safeUser } = user;
  const inactiveMessage = ensureActiveSessionUser(safeUser);
  if (inactiveMessage) {
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'inactive_staff', userId: safeUser.id, status: safeUser.status });
    return null;
  }
  setCurrentUser(safeUser);
  console.log('[AUTH] restoreSession restored:', {
    userId: safeUser.id,
    email: safeUser.email,
    lodge_id: safeUser.lodge_id || state.lodgeId
  });
  authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'cache' });
  return safeUser;
}

export function restoreSavedTrustedSession(email = '', password = '') {
  const emailLower = normalizeEmail(email);
  const sessions = pruneExpiredTrustedSessions().
  map(normalizeTrustedSessionRecord).
  filter(Boolean).
  filter((session) => !session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId));

  const legacy = normalizeTrustedSessionRecord(readSessionNonce());
  const candidates = [
  ...sessions,
  ...(legacy ? [legacy] : [])].
  filter((session, index, all) => {
    const key = session.id || session.email || session.nonce;
    return all.findIndex((entry) => (entry.id || entry.email || entry.nonce) === key) === index;
  });

  const matches = emailLower ?
  candidates.filter((session) => session.email === emailLower) :
  candidates;

  if (matches.length === 0) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'no_saved_session', email: emailLower });
    return { user: null, nonce: '', code: 'no_saved_trusted_session' };
  }
  if (!emailLower && matches.length > 1) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'email_required', count: matches.length });
    return { user: null, nonce: '', code: 'email_required', error: 'Choose the staff account to open its saved offline session.' };
  }
  if (!password) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_required', email: emailLower });
    return { user: null, nonce: '', code: 'password_required', error: 'Enter this user password to open the saved offline session.' };
  }

  const session = matches[0];
  if (!session.offline_password_hash) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_not_prepared', email: emailLower });
    return {
      user: null,
      nonce: '',
      code: 'offline_password_not_prepared',
      error: 'This saved session was created before offline password unlock was enabled. Connect to the internet and sign in once to prepare it.'
    };
  }
  if (!bcrypt.compareSync(password, session.offline_password_hash)) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'wrong_password', email: emailLower });
    return { user: null, nonce: '', code: 'wrong_password', error: 'Incorrect password for this saved offline session.' };
  }

  const user = restoreUserSession(session.nonce, { trustedUnlock: true });
  const inactiveMessage = ensureActiveSessionUser(user);
  if (inactiveMessage) {
    return { user: null, nonce: '', code: 'account_inactive', error: inactiveMessage };
  }
  return user ?
  { user, nonce: '', code: null } :
  { user: null, nonce: '', code: 'saved_session_invalid', error: 'The saved offline session could not be opened. Connect to the internet and sign in again.' };
}

export async function validateCurrentSession() {
  if (state.currentUser?.isMasterAdmin) return state.currentUser;

  const session = getBackendSession();
  if (!state.currentUser) {
    console.warn('[AUTH] Session validation failed: missing user');
    return null;
  }
  if (!session?.token) {
    authTrace('validateCurrentSession skipped', {
      reason: 'missing_backend_token',
      userId: state.currentUser?.id || null,
      lodge_id: state.lodgeId
    });
    return state.currentUser;
  }

  if (session.expires_at) {
    const expiryTs = new Date(session.expires_at).getTime();
    if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
      console.warn('[AUTH] Offline session expired');
      state.replayAuthReady = false;
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }
  }

  // Don't block loading screen if IO is exhausted
  const onlineCheck = checkOnline();
  const timeout = new Promise((r) => setTimeout(() => r('timeout'), 3000));
  const result = await Promise.race([onlineCheck, timeout]);
  if (result === 'timeout' || !state.isOnline) {
    return state.currentUser;
  }

  try {
    const rpcPromise = state.supabase.rpc('validate_app_session', {
      p_session_token: session.token
    });
    const rpcTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('validate_app_session timed out')), 5000)
    );
    const { data, error } = await Promise.race([rpcPromise, rpcTimeout]);
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      state.replayAuthReady = false;
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }

    const rowLodgeId = normalizeLodgeId(row.lodge_id);
    if (
    row.session_type !== (session.session_type || 'desktop') ||
    rowLodgeId && rowLodgeId !== normalizeLodgeId(state.lodgeId))
    {
      state.replayAuthReady = false;
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }

    const refreshedUser = normalizeSessionUser({
      ...state.currentUser,
      id: row.id || state.currentUser.id,
      name: row.name || state.currentUser.name,
      email: row.email || state.currentUser.email,
      role: row.role || state.currentUser.role,
      lodge_id: row.lodge_id || state.currentUser.lodge_id || state.lodgeId
    });

    setCurrentUser(refreshedUser);
    upsertCachedUser(refreshedUser);
    await touchUserPresence({
      userId: refreshedUser.id,
      lodgeId: refreshedUser.lodge_id || state.lodgeId,
      sessionType: row.session_type || session.session_type || 'desktop',
      markSignIn: false
    });

    const stored = readSessionNonce();
    if (stored?.nonce) {
      writeSessionNonce(refreshedUser, stored.nonce);
    }

    return refreshedUser;
  } catch (error) {
    authTrace('validateCurrentSession failed', {
      message: error?.message || 'unknown_error',
      lodge_id: state.lodgeId
    });
    return state.currentUser;
  }
}
