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
import { recordCriticalError } from './operationalLog.js';
import {
  getRuntimeProductId,
  isProductCompatiblePropertyType
} from '../../shared/productIdentity.js';

/** @typedef {Record<string, unknown>} AuthRecordExpectedView */
/** @typedef {AuthRecordExpectedView} StoredSessionExpectedView */
/** @typedef {AuthRecordExpectedView & {userId: unknown, id: unknown, email: string, lodge_id: string|null, createdAt: unknown}} NormalizedTrustedSessionExpectedView */
/** @typedef {AuthRecordExpectedView} CachedSettingsExpectedView */
/** @typedef {AuthRecordExpectedView} SessionUserExpectedView */

/** @param {string} label @param {Record<string, unknown>} [payload] */
function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

/**
 * Fail closed when the active profile's cached property type does not match
 * the running product binary (restaurant.exe must not operate hotel data).
 * Missing settings are allowed so first-run / draft setup is not blocked.
 */
function assertCachedSettingsMatchCurrentProduct() {
  // readCache returns unknown JSON. This view records the existing indexed
  // property reads only; it does not validate persisted settings.
  const settings = /** @type {Array<CachedSettingsExpectedView | null | undefined> | null | undefined} */ (readCache('settings'))?.[0] || null;
  if (!settings) return true;
  const propertyType = settings.property_type || settings.business_type;
  if (!propertyType) return true;
  const productId = getRuntimeProductId();
  if (isProductCompatiblePropertyType(productId, propertyType)) return true;
  console.warn('[AUTH] product_profile_mismatch on session restore', {
    productId,
    propertyType
  });
  return false;
}

function clearSessionForProductMismatch() {
  state.replayAuthReady = false;
  state.currentUser = null;
  clearBackendSession();
  clearSessionNonce();
}

/** @param {unknown} role */
function isPosFullAccessRole(role) {
  // Callers pass the stored role string produced by auth normalization. Keep
  // the original direct toLowerCase behavior for truthy malformed values.
  const roleView = /** @type {string | {toLowerCase: () => string} | null | undefined} */ (role);
  return ['admin', 'manager', 'super_admin'].includes((roleView || '').toLowerCase());
}

/** @param {unknown} user */
function ensureActiveSessionUser(user) {
  const userView = /** @type {SessionUserExpectedView | null | undefined} */ (user);
  const status = normalizeStaffStatus(userView?.status);
  if (status === 'active') return null;
  return status === 'archived'
    ? `This staff account is ${STAFF_STATUS_LABELS[status].toLowerCase()}. Connect to the internet and ask an admin to restore it before signing in again.`
    : `This staff account is ${STAFF_STATUS_LABELS[status].toLowerCase()}. Connect to the internet and ask an admin to reactivate it before signing in again.`;
}

const CURRENT_SESSION_NONCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TRUSTED_SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // password-unlocked offline sessions
const MASTER_ADMIN_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** @param {import('../state.js').DesktopAuthRuntimeStatus['status']} status @param {string} reason */
function publishAuthRuntimeStatus(status, reason) {
  const user = state.currentUser
  const tokenPresent = !!state.backendSession?.token
  const next = {
    status,
    generation: state.authSessionGeneration,
    actorId: user?.id ? String(user.id) : null,
    lodgeId: state.lodgeId ? String(state.lodgeId) : null,
    reason: String(reason || 'unspecified').slice(0, 80),
    at: new Date().toISOString(),
    tokenPresent,
    clientBound: Boolean(state.supabase && tokenPresent)
  }
  const previous = state.authRuntimeStatus
  state.authRuntimeStatus = next
  if (previous?.status !== next.status || previous?.reason !== next.reason || previous?.generation !== next.generation) {
    // This diagnostic intentionally excludes tokens, hashes, passwords, and cookies.
    console.info('[AUTH STATE]', {
      status: next.status,
      reason: next.reason,
      generation: next.generation,
      actorId: next.actorId,
      lodgeId: next.lodgeId,
      tokenPresent: next.tokenPresent,
      clientBound: next.clientBound,
      at: next.at
    })
  }
  try { state.emitAuthRuntimeStatus?.({ ...next }) } catch { /* best-effort renderer notice */ }
  return next
}

export function getAuthRuntimeStatus() {
  return { ...state.authRuntimeStatus }
}

/** Snapshot used only to prevent an old protected request from changing a newer session. */
export function getAuthRequestContext() {
  return {
    generation: state.authSessionGeneration,
    actorId: state.currentUser?.id ? String(state.currentUser.id) : null,
    lodgeId: state.lodgeId ? normalizeLodgeId(state.lodgeId) : null
  }
}

/** @param {{generation?: number, actorId?: string|null, lodgeId?: string|null}|null|undefined} context */
function authRequestContextIsCurrent(context) {
  return Boolean(context
    && context.generation === state.authSessionGeneration
    && context.actorId === (state.currentUser?.id ? String(state.currentUser.id) : null)
    && context.lodgeId === (state.lodgeId ? normalizeLodgeId(state.lodgeId) : null))
}

function bumpAuthSessionGeneration() {
  state.authSessionGeneration += 1
  state.authSessionGenerationToken = null
}

/** @param {StoredSessionExpectedView | null | undefined} record @param {{trustedUnlock?: boolean}} [options] */
function getStoredSessionMaxAgeMs(record, { trustedUnlock = false } = {}) {
  if (record?.isMasterAdmin) return MASTER_ADMIN_SESSION_MAX_AGE_MS;
  return trustedUnlock ? TRUSTED_SESSION_MAX_AGE_MS : CURRENT_SESSION_NONCE_MAX_AGE_MS;
}

function getSessionNoncePath() {
  return path.join(/** @type {string} */ (state.cacheDir), 'session-nonce.json');
}

function getTrustedSessionsPath() {
  return path.join(/** @type {string} */ (state.cacheDir), 'trusted-sessions.json');
}

export function readSessionNonce() {
  return readSecureJson(getSessionNoncePath(), null);
}

function readTrustedSessions() {
  const parsed = readSecureJson(getTrustedSessionsPath(), []);
  return Array.isArray(parsed) ? /** @type {unknown[]} */ (parsed) : [];
}

/** @param {unknown} sessions */
function writeTrustedSessions(sessions) {
  const written = writeSecureJson(
    getTrustedSessionsPath(),
    Array.isArray(sessions) ? sessions : []
  );
  if (!written) {
    recordCriticalError(
      'auth.secure_storage',
      new Error('Secure storage is unavailable; the trusted offline session was not saved.'),
      { operation: 'trusted_sessions_write' },
      { limit: 120 }
    );
  }
  return written;
}

/** @param {unknown[]} [sessions] */
export function pruneExpiredTrustedSessions(sessions = readTrustedSessions()) {
  const now = Date.now();
  const active = sessions.filter((session) => {
    const sessionView = /** @type {StoredSessionExpectedView | null | undefined} */ (session);
    if (sessionView?.isMasterAdmin) return false;
    // Session records are written with an ISO createdAt string; this expected
    // persisted-data view preserves Date's existing coercion for old/malformed rows.
    const createdAt = new Date(/** @type {string|number} */ (sessionView?.createdAt || 0)).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= TRUSTED_SESSION_MAX_AGE_MS;
  });
  if (active.length !== sessions.length) writeTrustedSessions(active);
  return active;
}

/** @param {unknown} record @returns {NormalizedTrustedSessionExpectedView|null} */
export function normalizeTrustedSessionRecord(record) {
  const recordView = /** @type {StoredSessionExpectedView | null | undefined} */ (record);
  if (!recordView?.nonce) return null;
  return {
    ...recordView,
    userId: recordView.userId || recordView.id || null,
    id: recordView.id || recordView.userId || null,
    email: normalizeEmail(recordView.email),
    lodge_id: normalizeLodgeId(recordView.lodge_id || state.lodgeId),
    createdAt: recordView.createdAt || new Date().toISOString()
  };
}

/** @param {unknown} user @param {string} nonce @param {string} [password] */
function buildTrustedSessionRecord(user, nonce, password = '') {
  const session = getBackendSession();
  const normalizedUser = normalizeSessionUser(user);
  const normalizedView = /** @type {SessionUserExpectedView | null | undefined} */ (normalizedUser);
  const record = normalizedView && typeof normalizedView === 'object' ?
  {
    id: normalizedView.id || null,
    email: normalizedView.email || null,
    name: normalizedView.name || null,
    role: normalizedView.role || null,
    lodge_id: normalizedView.lodge_id || null,
    ...(Object.prototype.hasOwnProperty.call(normalizedView, 'allowed_outlet_ids') ?
    { allowed_outlet_ids: normalizedView.allowed_outlet_ids } :
    {}),
    isMasterAdmin: Boolean(normalizedView.isMasterAdmin),
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
    offline_password_hash: password && !record.isMasterAdmin ? bcrypt.hashSync(password, 10) : null
  };
}

/** @param {unknown} user @param {string} nonce @param {string} [password] */
export function writeSessionNonce(user, nonce, password = '') {
  const record = buildTrustedSessionRecord(user, nonce, password);
  const nonceWritten = writeSecureJson(getSessionNoncePath(), record);
  if (!nonceWritten) {
    recordCriticalError(
      'auth.secure_storage',
      new Error('Secure storage is unavailable; the sign-in session was not saved for offline unlock.'),
      { operation: 'session_nonce_write' },
      { limit: 120 }
    );
    return false;
  }

  const sessions = pruneExpiredTrustedSessions();
  const normalizedRecord = normalizeTrustedSessionRecord(record);
  if (!normalizedRecord?.id && !normalizedRecord?.email) return true;
  if (normalizedRecord.isMasterAdmin) return true;
  const existing = sessions.find((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email);

  });
  const existingRecord = /** @type {StoredSessionExpectedView|null|undefined} */ (existing);
  const nextRecord = {
    ...(existingRecord || {}),
    ...record,
    offline_password_hash: record.offline_password_hash || existingRecord?.offline_password_hash || null
  };
  const next = sessions.filter((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return !(normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email));

  });
  next.push(nextRecord);
  return writeTrustedSessions(next);
}

export function clearSessionNonce() {
  removeSecureJson(getSessionNoncePath());
}

/** @param {unknown} user @param {string} [password] */
export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex');
  return writeSessionNonce(user, nonce, password) ? nonce : null;
}

/** @param {unknown} user */
export function setCurrentUser(user) {
  // normalizeSessionUser preserves non-object truthy inputs; this expected view
  // reflects its actual object input from auth producers without adding a guard.
  state.currentUser = /** @type {typeof state.currentUser} */ (normalizeSessionUser(user));
  const backendToken = typeof state.backendSession?.token === 'string' ? state.backendSession.token : null
  if (backendToken && backendToken !== state.authSessionGenerationToken) {
    state.authSessionGeneration += 1
    state.authSessionGenerationToken = backendToken
  }
  if (state.currentUser?.isMasterAdmin) {
    clearBackendSession();
    state.replayAuthReady = false
    publishAuthRuntimeStatus('authenticated', 'master_admin_local_session')
  }
  if (state.currentUser) {
    if (!state.currentUser.isMasterAdmin) {
      state.replayAuthReady = Boolean(backendToken)
      publishAuthRuntimeStatus(backendToken ? 'authenticated' : state.isOnline ? 'sign_in_required' : 'offline_trusted', backendToken ? 'login_or_restore' : state.isOnline ? 'missing_backend_token' : 'offline_restore')
    }
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
  const wasMasterAdmin = Boolean(state.currentUser?.isMasterAdmin);
  state.currentUser = null;
  bumpAuthSessionGeneration()
  state.replayAuthReady = false;
  clearBackendSession();
  if (forgetTrustedSession || wasMasterAdmin) clearSessionNonce();
  publishAuthRuntimeStatus('sign_in_required', 'user_signed_out')

  // Shut down local P2P Mesh operations
  import('./mesh/meshLifecycle.js').then((module) => {
    module.shutdownMesh();
  }).catch((err) => console.error('[Mesh] Failed to shutdown mesh:', err));
}

export function restoreCurrentTrustedSession() {
  const stored = /** @type {StoredSessionExpectedView | null} */ (readSessionNonce());
  const nonce = typeof stored?.nonce === 'string' ? stored.nonce : '';
  if (!nonce) return null;
  return restoreUserSession(nonce);
}

/** @param {unknown} nonce @param {{trustedUnlock?: boolean}} [options] */
export function restoreUserSession(nonce, options = {}) {
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

  // The encrypted session record is still untrusted persisted JSON. This view
  // only documents fields read below and retains the existing rejection flow.
  let stored = /** @type {StoredSessionExpectedView | null} */ (readSessionNonce());
  if (!stored || stored.nonce !== nonce) {
    stored = /** @type {StoredSessionExpectedView | null} */ (pruneExpiredTrustedSessions().
    map(normalizeTrustedSessionRecord).
    filter((session) => session !== null).
    find((session) => session.nonce === nonce && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId))));
  }

  const maxAgeMs = getStoredSessionMaxAgeMs(stored, options);
  if (!stored || stored.nonce !== nonce) {
    console.warn('[AUTH] restoreSession REJECTED: invalid or missing session nonce');
    state.currentUser = null;
    clearBackendSession();
    authTrace('restoreSession result', { restored: false, reason: 'invalid_or_missing_nonce' });
    return null;
  }

  // createdAt is written as an ISO string; the view preserves Date's existing
  // coercion/invalid-date behavior for malformed persisted values.
  const age = Date.now() - new Date(/** @type {string | number} */ (stored.createdAt)).getTime();
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
    const safeUser = /** @type {SessionUserExpectedView} */ (normalizeSessionUser({
      id: userId,
      email: stored.email || '',
      name: stored.name || 'Master Admin',
      role: stored.role || 'super_admin',
      isMasterAdmin: true
    }));
    setCurrentUser(safeUser);
    console.log('[AUTH] restoreSession restored master admin:', {
      userId: safeUser.id,
      email: safeUser.email
    });
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, role: safeUser.role, isMasterAdmin: true });
    return safeUser;
  }

  if (!assertCachedSettingsMatchCurrentProduct()) {
    clearSessionForProductMismatch();
    authTrace('restoreSession result', { restored: false, reason: 'product_profile_mismatch' });
    return null;
  }

  if (stored.email && stored.role) {
    const trustedSessionExpiresAt = options.trustedUnlock
      ? new Date(new Date(/** @type {string|number} */ (stored.createdAt)).getTime() + TRUSTED_SESSION_MAX_AGE_MS).toISOString()
      : null;
    applyBackendSession({
      token: stored.session_token || null,
      // Older desktop tokens were originally issued with a seven-day expiry.
      // The forward migration extends eligible, non-revoked desktop sessions;
      // use the same local trust boundary so a 60-day offline password unlock
      // is not immediately rejected by stale stored expiry metadata.
      expires_at: trustedSessionExpiresAt || stored.session_expires_at || null,
      session_type: stored.session_type || 'desktop'
    });
    const users = /** @type {Array<SessionUserExpectedView>} */ (/** @type {unknown[]} */ (readCache('users')).
    map(normalizeUserRecord).
    filter(Boolean));
    const cachedById = users.find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
    const cachedByEmail = stored.email ?
    users.find((u) => u.email === normalizeEmail(stored.email) && (u.lodge_id ? u.lodge_id === state.lodgeId : true)) :
    null;
    const hasStoredScope = Object.prototype.hasOwnProperty.call(stored, 'allowed_outlet_ids');
    const nonceUser = /** @type {SessionUserExpectedView} */ (normalizeSessionUser({
      id: userId,
      email: stored.email,
      name: stored.name || '',
      role: stored.role,
      lodge_id: stored.lodge_id || state.lodgeId,
      ...(hasStoredScope ? { allowed_outlet_ids: stored.allowed_outlet_ids } : {})
    }));
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
    const safeUser = /** @type {SessionUserExpectedView} */ (normalizeSessionUser(mergedUser));
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

  const users = /** @type {unknown[]} */ (readCache('users'));
  const user = /** @type {Array<SessionUserExpectedView>} */ (users.
  map(normalizeUserRecord).
  filter(Boolean)).
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
  filter((session) => session !== null).
  filter((session) => !session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId));

  const legacy = normalizeTrustedSessionRecord(readSessionNonce());
  const candidates = /** @type {StoredSessionExpectedView[]} */ ([
  ...sessions,
  ...(legacy ? [legacy] : [])].
  filter((session, index, all) => {
    const sessionView = /** @type {StoredSessionExpectedView} */ (session);
    const key = sessionView.id || sessionView.email || sessionView.nonce;
    return all.findIndex((entry) => {
      const entryView = /** @type {StoredSessionExpectedView} */ (entry);
      return (entryView.id || entryView.email || entryView.nonce) === key;
    }) === index;
  }));

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
  // Offline password hashes are produced by bcrypt.hashSync in
  // buildTrustedSessionRecord; persisted session JSON remains unvalidated.
  if (!bcrypt.compareSync(password, /** @type {string} */ (session.offline_password_hash))) {
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

async function validateCurrentSessionImpl() {
  if (state.currentUser?.isMasterAdmin) {
    state.replayAuthReady = false
    publishAuthRuntimeStatus('authenticated', 'master_admin_local_session')
    return state.currentUser
  }
  if (!state.currentUser) {
    state.replayAuthReady = false
    publishAuthRuntimeStatus('sign_in_required', 'missing_main_user')
    return null
  }
  if (!assertCachedSettingsMatchCurrentProduct()) {
    clearSessionForProductMismatch()
    publishAuthRuntimeStatus('sign_in_required', 'product_profile_mismatch')
    return null
  }

  // A profile switch or restore can leave the current user in memory while
  // the backend client has lost its custom session header. Rebind only from
  // this same actor/lodge's encrypted session nonce; the server still decides
  // whether that token is active.
  let session = getBackendSession()
  if (!session?.token) {
    if (!state.isOnline) {
      state.replayAuthReady = false
      publishAuthRuntimeStatus('offline_trusted', 'offline_without_backend_token')
      return state.currentUser
    }
    const stored = /** @type {StoredSessionExpectedView | null} */ (readSessionNonce())
    const sameActor = String(stored?.userId || stored?.id || '') === String(state.currentUser.id || '')
    const sameLodge = normalizeLodgeId(stored?.lodge_id || state.lodgeId) === normalizeLodgeId(state.lodgeId)
    if (stored?.session_token && sameActor && sameLodge) {
      applyBackendSession({ token: stored.session_token, expires_at: stored.session_expires_at || null, session_type: stored.session_type || 'desktop' })
      session = getBackendSession()
      if (session?.token !== state.authSessionGenerationToken) {
        state.authSessionGeneration += 1
        state.authSessionGenerationToken = String(session?.token || '')
      }
    } else {
      state.currentUser = null
      state.replayAuthReady = false
      publishAuthRuntimeStatus('sign_in_required', 'missing_backend_token')
      return null
    }
  }

  // The guard above returns when no stored session can be restored. In the
  // restore branch, applyBackendSession stores the truthy token before the
  // synchronous getBackendSession read; this view adds no runtime validation.
  const activeSession = /** @type {NonNullable<ReturnType<typeof getBackendSession>>} */ (session)

  if (activeSession.expires_at) {
    const expiryTs = new Date(/** @type {string | number} */ (activeSession.expires_at)).getTime()
    if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
      state.replayAuthReady = false
      state.currentUser = null
      clearBackendSession()
      clearSessionNonce()
      publishAuthRuntimeStatus('sign_in_required', 'locally_expired_server_session')
      return null
    }
  }

  // Bind every awaited recovery step to the session that supplied its token.
  // A login/profile switch during reachability must not be overwritten by an
  // older validation attempt.
  const generationAtStart = state.authSessionGeneration
  const actorAtStart = String(state.currentUser.id || '')
  const lodgeAtStart = normalizeLodgeId(state.lodgeId)
  const tokenAtStart = String(activeSession.token)
  const isCurrentSession = () => generationAtStart === state.authSessionGeneration
    && actorAtStart === String(state.currentUser?.id || '')
    && lodgeAtStart === normalizeLodgeId(state.lodgeId)
    && tokenAtStart === String(getBackendSession()?.token || '')
  const onlineCheck = checkOnline()
  let reachabilityTimer
  const timeout = new Promise((/** @type {(value: 'timeout') => void} */ resolve) => {
    reachabilityTimer = setTimeout(() => resolve('timeout'), 3000)
  })
  let reachability
  try {
    reachability = await Promise.race([onlineCheck, timeout])
  } catch {
    reachability = 'timeout'
  } finally {
    clearTimeout(reachabilityTimer)
  }
  if (!isCurrentSession()) return state.currentUser
  if (reachability === 'timeout' || !state.isOnline) {
    state.replayAuthReady = false
    publishAuthRuntimeStatus(state.isOnline ? 'validation_unavailable' : 'offline_trusted', state.isOnline ? 'reachability_check_timeout' : 'offline')
    return state.currentUser
  }

  try {
    if (!isCurrentSession()) return state.currentUser
    // Rebuild exactly the existing anon-key client with this session token;
    // this repairs a lost header binding without changing role or tenant.
    applyBackendSession(activeSession)
    const supabase = /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
    const rpcPromise = supabase.rpc('validate_app_session', { p_session_token: activeSession.token })
    let rpcTimer
    const rpcTimeout = new Promise((/** @type {(value: never) => void} */ _resolve, /** @type {(reason: Error) => void} */ reject) => {
      rpcTimer = setTimeout(() => reject(new Error('validate_app_session timed out')), 5000)
    })
    let result
    try {
      result = /** @type {Awaited<typeof rpcPromise>} */ (await Promise.race([rpcPromise, rpcTimeout]))
    } finally {
      clearTimeout(rpcTimer)
    }
    const { data, error } = result
    if (!isCurrentSession()) return state.currentUser
    if (error) {
      const code = String(/** @type {{code?: unknown}|null|undefined} */ (error)?.code || '')
      if (code === '42501') {
        state.replayAuthReady = false
        publishAuthRuntimeStatus('access_denied', 'server_authorization_denied')
        return state.currentUser
      }
      throw error
    }

    const row = /** @type {AuthRecordExpectedView | null | undefined} */ (Array.isArray(data) ? data[0] : data)
    if (!row) {
      state.replayAuthReady = false
      state.currentUser = null
      clearBackendSession()
      clearSessionNonce()
      publishAuthRuntimeStatus('sign_in_required', 'server_session_missing_or_revoked')
      return null
    }

    const rowLodgeId = normalizeLodgeId(row.lodge_id)
    if (row.session_type !== (activeSession.session_type || 'desktop') || !rowLodgeId || rowLodgeId !== lodgeAtStart
      || String(row.id || '') !== actorAtStart) {
      state.replayAuthReady = false
      state.currentUser = null
      clearBackendSession()
      clearSessionNonce()
      publishAuthRuntimeStatus('sign_in_required', 'server_session_scope_mismatch')
      return null
    }

    const refreshedUser = /** @type {SessionUserExpectedView} */ (normalizeSessionUser({
      ...state.currentUser,
      id: row.id || state.currentUser.id,
      name: row.name || state.currentUser.name,
      email: row.email || state.currentUser.email,
      role: row.role || state.currentUser.role,
      lodge_id: row.lodge_id || state.currentUser.lodge_id || state.lodgeId
    }))
    setCurrentUser(refreshedUser)
    state.replayAuthReady = true
    publishAuthRuntimeStatus('authenticated', 'server_validation_succeeded')
    upsertCachedUser(refreshedUser)
    await touchUserPresence({
      // The server validated this row's id against actorAtStart above; the
      // auth cache normalizer retains that existing id value without coercion.
      userId: /** @type {string} */ (refreshedUser.id),
      lodgeId: refreshedUser.lodge_id || state.lodgeId,
      sessionType: row.session_type || activeSession.session_type || 'desktop',
      markSignIn: false
    }).catch(() => {})
    if (!isCurrentSession()) return state.currentUser
    const stored = /** @type {StoredSessionExpectedView | null} */ (readSessionNonce())
    if (stored?.nonce) {
      if (!isCurrentSession()) return state.currentUser
      const persisted = writeSessionNonce(refreshedUser, stored.nonce)
      if (!persisted) authTrace('validateCurrentSession secure persistence unavailable', { userId: refreshedUser.id || null, lodge_id: state.lodgeId })
    }
    return refreshedUser
  } catch (error) {
    if (!isCurrentSession()) return state.currentUser
    const errorView = /** @type {{message?: unknown, code?: unknown}|null|undefined} */ (error)
    state.replayAuthReady = false
    authTrace('validateCurrentSession failed', { code: errorView?.code || null, lodge_id: state.lodgeId })
    const errorClass = errorView?.code
      ? String(errorView.code).slice(0, 24)
      : /timed out|timeout/i.test(String(errorView?.message || '')) ? 'timeout' : 'network_or_validation_error'
    publishAuthRuntimeStatus('validation_unavailable', errorClass)
    return state.currentUser
  }
}

/** @type {ReturnType<typeof validateCurrentSessionImpl> | null} */
let authValidationPromise = null
export function validateCurrentSession() {
  if (authValidationPromise) return authValidationPromise
  authValidationPromise = validateCurrentSessionImpl().finally(() => { authValidationPromise = null })
  return authValidationPromise
}

/** @param {unknown} error @param {string} source */
export async function reportAuthRequestFailure(error, source = 'protected_request', requestContext = getAuthRequestContext()) {
  if (!authRequestContextIsCurrent(requestContext)) return
  const view = /** @type {{message?: unknown, code?: unknown}|null|undefined} */ (error)
  const code = String(view?.code || '')
  const message = String(view?.message || error || '')
  if (code === '42501' || /access denied|not allowed to perform|role does not have access|not authorized to/i.test(message)) {
    // One bounded safe validation distinguishes a stale header from a real
    // role/lodge denial. The protected request remains rejected either way.
    await validateCurrentSession()
    if (!authRequestContextIsCurrent(requestContext)) return
    if (state.authRuntimeStatus.status === 'authenticated') {
      state.replayAuthReady = false
      publishAuthRuntimeStatus('access_denied', `request_scope_denied:${source}`)
    }
    return
  }
  if (code === '401' || code === 'PGRST301' || /not authenticated|valid app session|session (has )?(expired|been revoked)|invalid session/i.test(message)) {
    // An explicit invalid-session response is authoritative. Revalidate once
    // before clearing so a concurrent network failure is not mistaken for
    // revocation; never create a new token or silently extend this one.
    await validateCurrentSession()
    // validateCurrentSession owns invalid/revoked-session clearing. If it
    // authenticated or repaired this same session, the failing request cannot
    // revoke that newer/current authority.
    if (!authRequestContextIsCurrent(requestContext)) return
  }
}
