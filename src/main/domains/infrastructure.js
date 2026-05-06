import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getRoleCapabilities, normalizeAppRole } from "../../shared/accessControl.js";
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem, pickNextReadySyncItemIndex } from "../../shared/syncQueue.js";
export { FINANCIAL_SYNC_TABLES, isFinancialSyncItem };
import { getBackupHealthSummary, getBackupInfoForHealth } from './backupHealth.js';
import { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js';
import {
  SYNC_DRIFT_FAULT_TYPES,
  appendHealthFault,
  readFailedSyncQueue,
  readHealthFaults,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncMeta,
  writeSyncQueue
} from './syncStore.js';
import {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isPosCreateOrderQueueItem,
  isPosVoidQueueItem,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';
import {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache
} from './cacheStore.js';
import {
  mergeSessionUserScope,
  normalizeSessionUser,
  readAuthCache,
  upsertCachedUser,
  writeAuthCache
} from './authCache.js';
import {
  buildPwaAccessInput,
  getAllUsers,
  getUserPosOutletFilter,
  getUserById,
  getUsers,
  normalizeStaffRole,
  resolvePwaAccessUpdate
} from './users.js';
import {
  applyOfflinePosInventoryReservation,
  applyQueuedPosInventoryReservations,
  getOfflinePosInventoryReservation,
  patchLocalPosVoidHistory,
  readLocalPosVoidHistory,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory
} from './posOffline.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import {
  markClearedSyncItemForManualReview,
  patchCachedBookingSyncState,
  patchCachedPosOrderSyncState,
  patchCachedQuotationSyncState,
  replaceQueuedBookingReference,
  rewriteQueuedBookingReferenceItem
} from './syncCache.js';
import { assertCreationWithinUsageLimit } from './usage.js';
import {
  buildSyncStatusSnapshot,
  isQueuedDependencyResolved
} from './syncStatus.js';
import { broadcastSyncStatus, checkOnline } from './connectivity.js';
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  addDays,
  computeGracePeriodEnd,
  computeOfflineValidUntil,
  computeSubscriptionState,
  getPlanFeatureMap,
  mergeFeatureOverrides,
  normalizePlanName,
  subscriptionAllowsAccess,
  toPositiveInt
} from './subscriptionState.js';
import {
  createAppError,
  isBackendAuthSchemaError,
  isUuid,
  MAX_FINANCIAL_AMOUNT,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
import {
  appendAuxiliaryLog,
  CRITICAL_ERROR_LOG_FILE,
  getLocalDateKey,
  isNonCriticalOperationalError,
  logActivity,
  LOCAL_TIME_ZONE,
  readAuxiliaryLog,
  recordCriticalError,
  writeAuxiliaryLog
} from './operationalLog.js';
export { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js';
export { getBackupHealthSummary, getBackupInfoForHealth } from './backupHealth.js';
export {
  SYNC_DRIFT_FAULT_TYPES,
  appendHealthFault,
  readFailedSyncQueue,
  readHealthFaults,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js';
export {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isPosCreateOrderQueueItem,
  isPosVoidQueueItem,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';
export {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache
} from './cacheStore.js';
export {
  getAllUsers,
  getUserById,
  getUsers
} from './users.js';
export { broadcastSyncStatus, checkOnline } from './connectivity.js';
export {
  buildSyncStatusSnapshot
} from './syncStatus.js';
export {
  applyOfflinePosInventoryReservation,
  applyQueuedPosInventoryReservations,
  getOfflinePosInventoryReservation,
  readLocalPosVoidHistory,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory
} from './posOffline.js';
export { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
export {
  buildUsageSummary,
  buildUsageWarning,
  getMonthWindowIso
} from './usageSupport.js';
export {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  addDays,
  computeGracePeriodEnd,
  computeOfflineValidUntil,
  computeSubscriptionState,
  getPlanFeatureMap,
  mergeFeatureOverrides,
  normalizePlanName,
  subscriptionAllowsAccess,
  toPositiveInt
} from './subscriptionState.js';
export {
  createAppError,
  isBackendAuthSchemaError,
  isUuid,
  MAX_FINANCIAL_AMOUNT,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
export {
  appendAuxiliaryLog,
  CRITICAL_ERROR_LOG_FILE,
  getLocalDateKey,
  isNonCriticalOperationalError,
  logActivity,
  LOCAL_TIME_ZONE,
  readAuxiliaryLog,
  recordCriticalError,
  writeAuxiliaryLog
} from './operationalLog.js';
// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
// URL + ANON KEY — baked in at build time from the root .env file by electron-vite.
// Neither value is a secret (Supabase designed the anon key to be public-facing),
// but keeping them in .env rather than source code means they are not committed to
// the git repository and can be rotated without a code change.
//
// Before building, create a root .env file (see .env.example):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_KEY=<anon-public-key>
//
// SERVICE ROLE KEY — SECRET. Never put this in .env or source code.
// Set as an OS environment variable on the Command Central admin machine ONLY:
//   Windows PowerShell:
//     [System.Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','<key>','User')
//   macOS / Linux (add to ~/.zshrc or ~/.bashrc):
//     export SUPABASE_SERVICE_ROLE_KEY='<key>'
//
// Lodge customer machines will NOT have this variable → adminDb stays null →
// admin-only functions return a clear error instead of exposing privileged access.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from "../state.js";const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const AUTH_REDIRECT_URL = (
process.env.BOROKO_AUTH_REDIRECT_URL ||
import.meta.env.VITE_AUTH_REDIRECT_URL ||
'').
trim();

























const AUTH_CONTRACT_VERSION = 2;
const CONNECTIVITY_CHECK_INTERVAL_MS = 3000;
const PERIODIC_SYNC_INTERVAL_MS = 15000;
const PROFILE_CACHE_FILES = {
  settings: [],
  users: [],
  rooms: [],
  customers: [],
  bookings: [],
  quotations: [],
  expenses: [],
  outlets: [],
  'conference-bookings': [],
  'pool-day-use': [],
  'inventory-items': [],
  'inventory-purchases': [],
  'pos-menu-items': [],
  'pos-orders': [],
  'pos-order-items': [],
  'pos-void-history': [],
  activity: [],
  auth: [],
  syncQueue: [],
  syncFailed: [],
  syncMeta: null,
  healthFaults: [],
  cacheFreshness: null,
  trialStatus: null
};

function buildSupabaseClient(key, sessionToken = null) {
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

function applyBackendSession(session) {
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

function getBackendSession() {
  return state.backendSession ? { ...state.backendSession } : null;
}

// ─── PROFILES / LEGACY LODGE ID ──────────────────────────────────────────────
// Older builds stored a single lodge ID and one shared cache directory.
// Newer builds store multiple lodge profiles on one PC and activate one at a
// time by swapping the runtime lodgeId/cacheDir underneath existing functions.

function initializeProfileRuntime() {
  return import('./' + 'profiles.js').then((module) => module.initializeProfileRuntime());
}

// Returns the admin (service-role) Supabase client, or throws a clear error if
// the SUPABASE_SERVICE_ROLE_KEY env var was not set on this machine.
// Use this in any function that queries across all lodges (Command Central only).
export function requireAdmin() {
  if (!state.adminDb) {
    throw new Error(
      'This operation requires Command Central admin access. ' +
      'Set the SUPABASE_SERVICE_ROLE_KEY environment variable on this machine. ' +
      'See setup documentation for details.'
    );
  }
  return state.adminDb;
}

/**
 * Returns the outlet filter for the current user's POS access.
 * null  = unrestricted (manager / admin / super_admin / master admin)
 * []    = no access (cashier/supervisor with no outlets assigned)
 * [id1] = restricted to these outlet UUIDs
 */
export function setCurrentUser(user) {
  state.currentUser = normalizeSessionUser(user);
  if (state.currentUser?.isMasterAdmin) {
    clearBackendSession();
  }
  // P0-5: a real user is now authenticated — allow queue replay
  if (state.currentUser) {
    state.replayAuthReady = true;
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
}

// Restores the main-process session using a nonce that was issued during login.
// The nonce file (session-nonce.json) is the single source of truth for session
// identity — the renderer cannot influence which user is restored.
// Passing null/undefined clears the trusted device session.
export function restoreUserSession(nonce) {
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

  // Validate nonce against the current session, or any saved trusted session
  // for this lodge. This allows multiple staff to unlock their own saved
  // offline sessions on the same computer.
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

  // Expiry check
  const age = Date.now() - new Date(stored.createdAt).getTime();
  if (age > SESSION_NONCE_MAX_AGE_MS) {
    console.warn('[AUTH] restoreSession REJECTED: nonce expired', { ageMs: age });
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'nonce_expired' });
    return null;
  }

  // Identity derived from nonce file, NOT from renderer
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

  const user = restoreUserSession(session.nonce);
  return user ?
  { user, nonce: session.nonce, code: null } :
  { user: null, nonce: '', code: 'saved_session_invalid', error: 'The saved offline session could not be opened. Connect to the internet and sign in again.' };
}

export async function validateCurrentSession() {
  // Master admins authenticate against master_admins table, not Supabase app sessions.
  // They have no backend session token by design — treat as always valid.
  if (state.currentUser?.isMasterAdmin) return state.currentUser;

  const session = getBackendSession();
  // P0-6: Session validation is mandatory — cannot bypass with missing token
  if (!state.currentUser || !session?.token) {
    console.warn('[AUTH] Session validation failed: missing token or user');
    return null;
  }

  if (session.expires_at) {
    const expiryTs = new Date(session.expires_at).getTime();
    if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
      console.warn('[AUTH] Offline session expired');
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }
  }

  await checkOnline();
  if (!state.isOnline) {
    return state.currentUser;
  }

  try {
    const { data, error } = await state.supabase.rpc('validate_app_session', {
      p_session_token: session.token
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
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

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  console.log(`[AUTH TRACE] ${label}`, payload);
}

function getAuthClientState(kind = 'unknown', sessionToken = null, email = null) {
  const explicitToken = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null;
  return {
    clientKind: kind,
    hasExplicitSessionToken: !!explicitToken,
    explicitSessionTokenLength: explicitToken ? explicitToken.length : null,
    hasBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    backendSessionTokenLength: state.backendSession?.token ? state.backendSession.token.length : null,
    lodgeId: state.lodgeId,
    email: email || null
  };
}

function normalizeAuthContractRow(rpcRow) {
  if (!rpcRow || typeof rpcRow !== 'object' || Array.isArray(rpcRow)) {
    return { ok: false, reason: 'authenticate_user did not return a record.' };
  }

  const normalized = {
    contract_version: Number(rpcRow.contract_version),
    found: rpcRow.found,
    authenticated: rpcRow.authenticated === true,
    id: rpcRow.id || null,
    name: typeof rpcRow.name === 'string' ? rpcRow.name : '',
    email: normalizeEmail(rpcRow.email),
    role: typeof rpcRow.role === 'string' ? rpcRow.role : null,
    lodge_id: normalizeLodgeId(rpcRow.lodge_id),
    created_at: rpcRow.created_at || null,
    session_token: typeof rpcRow.session_token === 'string' && rpcRow.session_token ? rpcRow.session_token : null,
    session_expires_at: rpcRow.session_expires_at || null
  };

  if (normalized.contract_version !== AUTH_CONTRACT_VERSION) {
    return { ok: false, reason: `Expected contract_version ${AUTH_CONTRACT_VERSION}.` };
  }
  if (typeof normalized.found !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return a boolean found flag.' };
  }
  if (typeof normalized.authenticated !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return an authenticated flag.' };
  }
  if (!isUuid(normalized.lodge_id)) {
    return { ok: false, reason: 'authenticate_user must return a UUID lodge_id.' };
  }
  if (!normalized.email) {
    return { ok: false, reason: 'authenticate_user must return a normalized email.' };
  }
  if (normalized.found) {
    if (!isUuid(normalized.id)) {
      return { ok: false, reason: 'authenticate_user must return a UUID id when found = true.' };
    }
    if (!normalized.role) {
      return { ok: false, reason: 'authenticate_user must return role when found = true.' };
    }
    if (normalized.authenticated && !normalized.session_token) {
      return { ok: false, reason: 'authenticate_user must return a session_token when authenticated = true.' };
    }
  }

  return { ok: true, row: normalized };
}

function makeBackendAuthSchemaError(message, details = {}) {
  console.warn('[AUTH TRACE] schema error wrapper hit', { message, details });
  return {
    user: null,
    code: 'backend_auth_schema_outdated',
    error: message,
    details
  };
}

// ─── CONNECTIVITY & SYNC ──────────────────────────────────────────────────────

// Refresh one or more named caches from Supabase. Only fetches what's requested.
export async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names);
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)));
  } catch (e) {
    console.error('Cache refresh failed:', e);
  }
}

// Full refresh — used only at startup, reconnect, and after bulk operations.
export async function refreshAllCaches() {
  if (!state.lodgeId) return;
  await refreshCache(
    'users',
    'rooms',
    'customers',
    'bookings',
    'maintenance',
    'inventory-items',
    'inventory-purchases',
    'quotations',
    'conference-bookings',
    'pool-day-use',
    'pos-orders',
    'pos-menu-items',
    'outlets',
    'expenses'
  );
}

const MAX_SYNC_RETRIES = 5;
const SYNC_RETRY_BASE_DELAY_MS = 1000;
const SYNC_RETRY_MAX_DELAY_MS = 30_000;
const SYNC_REFRESH_RETRY_BASE_DELAY_MS = 5_000;
const SYNC_REFRESH_RETRY_MAX_DELAY_MS = 60_000;
const SYNC_ALREADY_APPLIED_CODES = new Set(['23505']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function isSyncRefreshStaleFor(name) {
  return state.syncRefreshState.stale && state.syncRefreshState.names.includes(name);
}

function markSyncRefreshStale(names = [], errorMessage = 'Cache refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  state.syncRefreshState = {
    stale: mergedNames.length > 0,
    names: mergedNames,
    attempts: Math.max(1, Number(state.syncRefreshState.attempts || 0)),
    lastError: String(errorMessage || 'Cache refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();
}

function clearSyncRefreshStale(names = []) {
  if (!state.syncRefreshState.stale) return;
  const clearNames = new Set(uniqueSyncNames(names));
  const remainingNames = clearNames.size === 0 ?
  [] :
  state.syncRefreshState.names.filter((name) => !clearNames.has(name));
  state.syncRefreshState = {
    stale: remainingNames.length > 0,
    names: remainingNames,
    attempts: remainingNames.length > 0 ? state.syncRefreshState.attempts : 0,
    lastError: remainingNames.length > 0 ? state.syncRefreshState.lastError : '',
    lastFailedAt: remainingNames.length > 0 ? state.syncRefreshState.lastFailedAt : null
  };
  if (!state.syncRefreshState.stale && state.syncRefreshRetryTimer) {
    clearTimeout(state.syncRefreshRetryTimer);
    state.syncRefreshRetryTimer = null;
  }
  broadcastSyncStatus();
}

async function refreshCacheStrict(...names) {
  if (!state.lodgeId) return;
  const fetchers = {
    users: () => state.supabase.from('users').select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').eq('lodge_id', state.lodgeId).order('name'),
    rooms: () => state.supabase.from('rooms').select('*').eq('lodge_id', state.lodgeId).order('room_number'),
    customers: () => state.supabase.from('customers').select('*').eq('lodge_id', state.lodgeId).order('name'),
    bookings: () => state.supabase.from('bookings').select('*').eq('lodge_id', state.lodgeId).order('check_in', { ascending: false }),
    maintenance: () => state.supabase.
    from('maintenance_tickets').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'inventory-items': () => state.supabase.from('inventory_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    'inventory-purchases': () => state.supabase.from('inventory_purchases').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    quotations: () => state.supabase.from('quotations').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('*').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }),
    'pool-day-use': () => state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    expenses: () => state.supabase.from('expenses').select('*, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    'pos-orders': () => state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order')
  };

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return;
    const { data, error } = await fetchers[name]();
    if (error) throw error;
    if (!data) return;
    if (name === 'users') {
      const normalizedUsers = data.map(normalizeUserRecord).filter(Boolean);
      writeCache(name, normalizedUsers, { source: 'remote' });
      if (state.currentUser && !state.currentUser.isMasterAdmin) {
        const refreshedUser = normalizedUsers.find((entry) =>
        state.currentUser.id && entry.id === state.currentUser.id ||
        !state.currentUser.id && state.currentUser.email && entry.email === state.currentUser.email
        );
        if (refreshedUser) {
          setCurrentUser(mergeSessionUserScope(state.currentUser, refreshedUser));
        }
      }
      return;
    }
    if (name === 'bookings') {
      writeCache(name, mergeRemoteBookingsWithLocalState(data || []), { source: 'remote' });
      return;
    }
    if (name === 'inventory-items') {
      writeCache(name, applyQueuedPosInventoryReservations(data || []), { source: 'remote' });
      return;
    }
    if (name === 'pos-orders') {
      writeCache(name, mergeRemotePosOrdersWithLocalState(data || []), { source: 'remote' });
      return;
    }
    writeCache(name, data, { source: 'remote' });
  }));
}

function scheduleSyncRefreshRetry(names = [], reason = 'Background refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  if (mergedNames.length === 0) return;

  const nextAttempts = Math.max(1, Number(state.syncRefreshState.attempts || 0) + 1);
  state.syncRefreshState = {
    stale: true,
    names: mergedNames,
    attempts: nextAttempts,
    lastError: String(reason || 'Background refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();

  if (state.syncRefreshRetryTimer) return;

  const waitMs = Math.min(
    SYNC_REFRESH_RETRY_MAX_DELAY_MS,
    SYNC_REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempts - 1))
  );

  state.syncRefreshRetryTimer = setTimeout(async () => {
    state.syncRefreshRetryTimer = null;
    const retryNames = [...state.syncRefreshState.names];
    if (!retryNames.length || !state.isOnline || !state.lodgeId) return;
    try {
      await refreshCacheStrict(...retryNames);
      clearSyncRefreshStale(retryNames);
    } catch (error) {
      console.error('[Sync] Background cache refresh retry failed:', error);
      scheduleSyncRefreshRetry(retryNames, error?.message || 'Background refresh retry failed.');
    }
  }, waitMs);
}

async function refreshCachesAfterSync(...names) {
  const targetNames = uniqueSyncNames(names);
  if (targetNames.length === 0) return;
  try {
    await refreshCacheStrict(...targetNames);
    clearSyncRefreshStale(targetNames);
  } catch (error) {
    console.error('[Sync] Post-sync cache refresh failed:', error);
    markSyncRefreshStale(targetNames, error?.message || 'Post-sync cache refresh failed.');
    scheduleSyncRefreshRetry(targetNames, error?.message || 'Post-sync cache refresh failed.');
  }
}

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isBookingUpdateConflictError(message = '') {
  return /modified on another device|booking conflict|refresh and try again/i.test(String(message || ''));
}

function shouldManualReviewSyncItem(item, errorMessage = '') {
  return item?.table === 'update_booking' && isBookingUpdateConflictError(errorMessage);
}

function isCreateBookingQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_booking';
}

function isConvertQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'convert_quotation_to_booking';
}

function getQueuedBookingId(item) {
  const bookingId = String(item?.data?.p_booking_id || '').trim();
  if (bookingId) return bookingId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('booking-')) {
    const parsedId = queueId.slice('booking-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.error('[BOOKING SYNC] Missing booking id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

function getQueuedQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || item?.data?.payload?.id || '').trim();
  if (quotationId) return quotationId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('quotation-')) {
    const parsedId = queueId.slice('quotation-'.length).trim();
    if (parsedId) return parsedId;
  }

  return null;
}

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room is not available|room.*conflict/i.test(String(message || ''));
}

function valuesEqualForDrift(left, right) {
  if (left == null && right == null) return true;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) < 0.0001;
  }
  return String(left) === String(right);
}

function hasDriftBaselineValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function queueItemNeedsBookingRefresh(item) {
  if (!item) return false;
  if (isPosCreateOrderQueueItem(item)) {
    return !!(item?.data?.payload?.booking_id || item?.data?.payload?.room_id);
  }
  if (item?.type === 'rpc') {
    return new Set([
    'create_booking',
    'update_booking',
    'update_booking_status',
    'update_booking_payment',
    'create_booking_record',
    'convert_quotation_to_booking']
    ).has(item.table);
  }
  return item?.table === 'bookings';
}

function queueItemNeedsInventoryRefresh(item) {
  if (!isPosCreateOrderQueueItem(item) && !isPosVoidQueueItem(item)) return false;
  const items = Array.isArray(item?.data?.payload?.items) ? item.data.payload.items : [];
  return items.some((entry) => !!entry?.menu_item_id || !!entry?.inventory_item_id);
}

function isAlreadyAppliedInsertError(item, error) {
  if (item?.type !== 'insert') return false;
  if (!item?.data?.id) return false;
  const code = String(error?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code);
}

function isAlreadyAppliedRpcError(item, errorOrMessage) {
  if (item?.type !== 'rpc') return false;
  const message = getErrorMessage(errorOrMessage);
  if (isConvertQuotationQueueItem(item) && /quotation is already converted|quotation is already .*converted|already converted/i.test(message)) {
    return true;
  }
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || item?.data?.p_quotation_id || null;
  if (!payloadId) return false;

  const code = String(errorOrMessage?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code) ||
  /duplicate key|unique constraint|already exists|already applied|23505/i.test(message);
}

export async function processSyncQueue() {
  if (state.syncInProgress) return { success: false, skipped: true, error: 'Sync is already in progress.' };
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!state.replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)');
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() });
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' };
  }
  state.syncInProgress = true;
  try {
    await _runSyncQueue();
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('[Sync] Fatal sync loop error:', error);
    appendHealthFault({
      type: 'sync_loop_error',
      scope: 'sync-queue',
      severity: 'error',
      message,
      at: new Date().toISOString()
    });
    writeSyncMeta({
      lastSyncFinishedAt: new Date().toISOString(),
      lastSyncOutcome: 'fatal_error',
      lastSyncError: message
    });
    return { success: false, error: message };
  } finally {
    state.syncInProgress = false;
    broadcastSyncStatus();
  }
}

async function _runSyncQueue() {
  await requeueEligibleFailedSyncItems();
  let queue = readSyncQueue().
  map((item) => ensureQueuedItem(item, item?.type || 'op')).
  map(normalizeQueuedSyncItemForReplay);
  if (queue.length === 0) return;

  // Normalize items left over from a previous (possibly crashed) run.
  // committed → drop (RPC already succeeded; do not retry)
  // in_flight → reset to pending (result unknown; retry — safe for all current operations)
  const normalized = [];
  for (const item of queue) {
    if (item._state === 'committed') {
      console.log('[SYNC COMMITTED CLEANUP]', item._queue_id);
      continue;
    }
    normalized.push(item._state === 'in_flight' ? { ...item, _state: 'pending' } : item);
  }
  if (normalized.length !== queue.length) writeSyncQueue(normalized);
  queue = normalized;

  // P0-1: record that a sync run has started
  writeSyncMeta({ lastSyncStartedAt: new Date().toISOString(), lastSyncOutcome: 'in_progress', lastSyncError: '' });

  console.log(`Syncing ${queue.length} offline operation(s)...`);
  const deadLetter = [];
  let successCount = 0;
  // Tracks _queue_ids of items that failed — dependents will be skipped.
  // Pre-seeded from sync-failed.json so children of a previously dead-lettered
  // parent are blocked immediately, not executed against a non-existent booking.
  // readFailedSyncQueue always returns []; corrupted file cannot crash this path.
  const _priorDeadLetter = readFailedSyncQueue();
  const failedQueueIds = new Set(_priorDeadLetter.map((item) => item._queue_id).filter(Boolean));
  const completedQueueIds = new Set();
  console.log('[SYNC PRELOAD FAILED IDS]', [...failedQueueIds]);
  const pending = [...queue];
  // P1-8: widen post-sync refresh tracking
  let shouldRefreshBookings = false;
  let shouldRefreshInventory = false;
  let shouldRefreshCustomers = false;
  let shouldRefreshRooms = false;
  let shouldRefreshUsers = false;
  let shouldRefreshQuotations = false;
  let shouldRefreshPosOrders = false;
  let shouldRefreshConference = false;
  let shouldRefreshPoolDayUse = false;

  while (pending.length > 0) {
    const nextIndex = pickNextReadySyncItemIndex(
      pending,
      completedQueueIds,
      failedQueueIds,
      isQueuedDependencyResolved
    );
    if (nextIndex === -1) {
      const blockedAt = new Date().toISOString();
      while (pending.length > 0) {
        const blockedItem = {
          ...pending.shift(),
          _state: 'pending',
          retryCount: MAX_SYNC_RETRIES,
          lastError: 'Blocked: unresolved sync dependency cycle',
          lastAttemptedAt: blockedAt,
          manualRetryOnly: true
        };
        if (blockedItem?._queue_id) failedQueueIds.add(blockedItem._queue_id);
        deadLetter.push(blockedItem);
      }
      writeSyncQueue([]);
      break;
    }

    const [item] = pending.splice(nextIndex, 1);
    // Skip items whose parent operation failed this run
    if (item._depends_on && failedQueueIds.has(item._depends_on)) {
      console.warn('[SYNC SKIPPED DEPENDENT]', { operation: item.table, queueId: item._queue_id, dependsOn: item._depends_on });
      const retryCount = (item.retryCount || 0) + 1;
      const skipped = { ...item, _state: 'pending', retryCount, lastError: 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString() };
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, 'Skipped: parent operation failed');
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      // Also mark related bookings as failed if their create_booking parent failed
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, 'Skipped: parent operation failed');
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      if (retryCount >= MAX_SYNC_RETRIES) {
        deadLetter.push(skipped);
      } else {
        pending.push(skipped);
      }
      writeSyncQueue(pending);
      continue;
    }

    const priorRetries = Math.max(0, Number(item.retryCount || 0));
    if (priorRetries > 0) {
      const backoffMs = Math.min(
        SYNC_RETRY_MAX_DELAY_MS,
        SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, priorRetries - 1))
      );
      console.warn(`[Sync] Backing off ${backoffMs}ms before retrying ${item.type} ${item.table}`);
      await delay(backoffMs);
    }

    // Persist in_flight before issuing remote call.
    // Crash here → restart normalizes to pending and retries safely.
    writeSyncQueue([{ ...item, _state: 'in_flight' }, ...pending]);

    let supabaseError = null;
    let rpcResultData = null;
    try {
      if (item.type === 'insert') {
        const payload = {
          ...item.data,
          lodge_id: item.data.lodge_id || state.lodgeId
        };

        const { data, error } = await state.supabase.
        from(item.table).
        insert(payload).
        select();

        if (error) {
          if (isAlreadyAppliedInsertError(item, error)) {
            console.warn(`↻ INSERT ${item.table} already applied remotely for id ${item.data.id}; treating as synced`);
            supabaseError = null;
          } else {
            console.error('❌ INSERT FAILED:', error);
            supabaseError = error;
          }
        } else {
          console.log('✅ INSERT SUCCESS:', data);
        }
      } else if (item.type === 'update') {
        // P2-14: use .select('id') to verify at least one row was actually matched.
        // A 0-row result means the entity was deleted or moved on the server during
        // the outage — the update is silently lost. We surface this as a health fault
        // rather than treating it as a success.
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        const { data: updData, error: updError } = await state.supabase.
        from(item.table).
        update(item.data).
        eq('id', item.id).
        eq('lodge_id', itemLodgeId).
        select('id');
        supabaseError = updError || null;
        if (!updError && (!updData || updData.length === 0)) {
          // Row not found on server — record as a fault but treat operation as consumed
          const ghostMsg = `UPDATE ${item.table} id=${item.id} matched 0 rows on server (entity may have been deleted during outage)`;
          console.warn('[Sync] Ghost update:', ghostMsg);
          appendHealthFault({ type: 'ghost_update', scope: item.table, message: ghostMsg, at: new Date().toISOString() });
        }
      } else if (item.type === 'delete') {
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        ({ error: supabaseError } = await state.supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', itemLodgeId));
      } else if (item.type === 'rpc') {
        const { data, error } = await state.supabase.rpc(item.table, item.data);
        rpcResultData = data || null;
        if (error) {
          if (isAlreadyAppliedRpcError(item, error)) {
            console.warn(`↻ RPC ${item.table} already applied remotely for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} FAILED:`, error);
            supabaseError = error;
          }
        } else if (data && data.success === false) {
          if (isAlreadyAppliedRpcError(item, data.error)) {
            console.warn(`↻ RPC ${item.table} reported duplicate for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} LOGIC FAILED:`, data.error);
            supabaseError = { message: data.error };
          }
        } else {
          console.log(`✅ RPC ${item.table} SUCCESS:`, data);
        }
      }
    } catch (e) {
      supabaseError = { message: e.message };
    }

    if (supabaseError) {
      // Track failed queue IDs so dependents are skipped
      if (item._queue_id) failedQueueIds.add(item._queue_id);
      const errorMessage = getErrorMessage(supabaseError);
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS VOID SYNC] Failed void', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `POS void rejected by server: ${errorMessage}`
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      // P1-13: mark rejected optimistic state for update/payment/status RPCs
      if (item.type === 'rpc' && ['update_booking', 'update_booking_status', 'update_booking_payment', 'add_booking_charge', 'delete_booking_charge', 'approve_booking_refund'].includes(item.table)) {
        const bookingId = item.data?.p_booking_id || item.data?.p_id || null;
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `${item.table} rejected by server: ${errorMessage}`
          });
        }
      }
      // Handle booking creation failures (especially room conflicts)
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          const isConflict = isRoomConflictError(errorMessage);
          console.warn('[BOOKING SYNC] Failed booking', bookingId, isConflict ? '(room conflict)' : '', errorMessage);
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
          // Notify renderer about booking conflict
          if (isConflict) {
            try {
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send('booking:sync-conflict', {
                    bookingId,
                    error: 'This room is already booked for the selected dates.',
                    details: errorMessage
                  });
                }
              });
            } catch (e) {
              console.error('[BOOKING SYNC] Failed to notify renderer:', e);
            }
          }
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const isConflict = isRoomConflictError(errorMessage);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            status: item._previous_status || 'accepted',
            converted_booking_id: null,
            _pending_sync: true,
            _pending_conversion: false,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
        if (localBookingId) {
          patchCachedBookingSyncState(localBookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
      }
      const retryCount = (item.retryCount || 0) + 1;
      const manualReviewOnly = shouldManualReviewSyncItem(item, errorMessage) ||
      (isCreateBookingQueueItem(item) || isConvertQuotationQueueItem(item)) && isRoomConflictError(errorMessage) ||
      item.manualRetryOnly === true;
      const updatedItem = {
        ...item,
        _state: 'pending', // reset from in_flight
        retryCount: manualReviewOnly ? MAX_SYNC_RETRIES : retryCount,
        lastError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        manualRetryOnly: manualReviewOnly
      };
      if (updatedItem.retryCount >= MAX_SYNC_RETRIES) {
        console.error(`[Sync] Dead-lettered after ${MAX_SYNC_RETRIES} attempts — ${item.type} ${item.table}:`, errorMessage);
        deadLetter.push(updatedItem);
      } else {
        console.warn(`[Sync] Failed (attempt ${updatedItem.retryCount}/${MAX_SYNC_RETRIES}) — ${item.type} ${item.table}:`, errorMessage);
        pending.push(updatedItem);
      }
      writeSyncQueue(pending);
    } else {
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[POS SYNC] Synced order', orderId);
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _pending_void: false,
            _synced_at: new Date().toISOString()
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null
          });
          console.log('[POS VOID SYNC] Synced void', orderId);
        }
      }
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[BOOKING SYNC] Synced booking', bookingId);
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const serverBookingId = rpcResultData?.booking_id || rpcResultData?.id || null;
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            ...(serverBookingId ? { converted_booking_id: serverBookingId } : {}),
            _pending_sync: false,
            _pending_conversion: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
        if (localBookingId) {
          replaceQueuedBookingReference(localBookingId, serverBookingId);
          if (serverBookingId) {
            for (let i = 0; i < pending.length; i += 1) {
              pending[i] = rewriteQueuedBookingReferenceItem(pending[i], localBookingId, serverBookingId);
            }
          }
          patchCachedBookingSyncState(localBookingId, {
            ...(serverBookingId ? { id: serverBookingId } : {}),
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
      }
      if (queueItemNeedsInventoryRefresh(item)) shouldRefreshInventory = true;
      if (queueItemNeedsBookingRefresh(item)) shouldRefreshBookings = true;
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true;
      if (item.table === 'rooms' || item.type === 'rpc' && item.table?.startsWith?.('update_room')) shouldRefreshRooms = true;
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true;
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'convert_quotation', 'convert_quotation_to_booking'].includes(item.table)) shouldRefreshQuotations = true;
      if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) shouldRefreshPosOrders = true;
      if (item.type === 'rpc' && ['create_conference_booking', 'update_conference_booking', 'delete_conference_booking'].includes(item.table)) shouldRefreshConference = true;
      if (item.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item.table)) shouldRefreshPoolDayUse = true;
      // Phase 1: persist committed state before removing from queue file.
      // Crash here → restart sees 'committed' → skips RPC without retrying.
      writeSyncQueue([{ ...item, _state: 'committed' }, ...pending]);
      if (item._queue_id) completedQueueIds.add(item._queue_id);
      // Phase 2: remove item from queue
      successCount++;
      writeSyncQueue(pending);
    }
  }
  const syncFinishedAt = new Date().toISOString();
  console.log(`✅ Sync complete: ${successCount} success, ${pending.length} remaining`);
  if (successCount > 0) {
    state.lastSuccessfulSyncAt = syncFinishedAt;
    // P0-1: persist sync recency to disk so it survives restarts
    writeSyncMeta({
      lastSuccessfulSyncAt: syncFinishedAt,
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: deadLetter.length > 0 ? 'partial' : 'success',
      lastSyncError: deadLetter.length > 0 ? `${deadLetter.length} item(s) dead-lettered` : ''
    });
  } else if (deadLetter.length > 0) {
    writeSyncMeta({
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: 'failed',
      lastSyncError: `All ${deadLetter.length} item(s) dead-lettered with no successes`
    });
  } else {
    writeSyncMeta({ lastSyncFinishedAt: syncFinishedAt, lastSyncOutcome: 'empty' });
  }
  writeSyncQueue(pending);

  if (successCount > 0 && shouldRefreshInventory) {
    refreshCache('inventory-items', 'inventory-purchases').catch(() => {});
  }

  // P2-16: snapshot optimistic booking state before refresh so we can detect drift afterwards
  const preSyncBookingSnapshot = shouldRefreshBookings ?
  readCache('bookings').
  filter((b) => !b._pending_sync).
  reduce((map, b) => {
    map[b.id] = {
      total_amount: b.total_amount,
      amount_paid: b.amount_paid,
      customer_id: b.customer_id,
      room_id: b.room_id,
      status: b.status,
      payment_status: b.payment_status
    };
    return map;
  }, {}) :
  null;

  // P1-8: widen canonical post-sync refresh
  const refreshTargets = [];
  if (successCount > 0 && shouldRefreshBookings) refreshTargets.push('bookings');
  if (successCount > 0 && shouldRefreshCustomers) refreshTargets.push('customers');
  if (successCount > 0 && shouldRefreshRooms) refreshTargets.push('rooms');
  if (successCount > 0 && shouldRefreshUsers) refreshTargets.push('users');
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations');
  if (successCount > 0 && shouldRefreshPosOrders) refreshTargets.push('pos-orders');
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings');
  if (successCount > 0 && shouldRefreshPoolDayUse) refreshTargets.push('pool-day-use');
  if (refreshTargets.length > 0) {
    await refreshCachesAfterSync(...refreshTargets);
  }

  // P2-16: compare post-refresh server values against pre-refresh optimistic state
  if (preSyncBookingSnapshot && successCount > 0) {
    try {
      const postSyncBookings = readCache('bookings');
      for (const b of postSyncBookings) {
        const pre = preSyncBookingSnapshot[b.id];
        if (!pre) continue;
        const drifts = [];
        if (!valuesEqualForDrift(pre.total_amount, b.total_amount)) drifts.push(`total_amount: local ${pre.total_amount} → server ${b.total_amount}`);
        if (!valuesEqualForDrift(pre.amount_paid, b.amount_paid)) drifts.push(`amount_paid: local ${pre.amount_paid} → server ${b.amount_paid}`);
        if (hasDriftBaselineValue(pre.customer_id) && !valuesEqualForDrift(pre.customer_id, b.customer_id)) drifts.push(`customer_id: local ${pre.customer_id} → server ${b.customer_id}`);
        if (hasDriftBaselineValue(pre.room_id) && !valuesEqualForDrift(pre.room_id, b.room_id)) drifts.push(`room_id: local ${pre.room_id} → server ${b.room_id}`);
        if (!valuesEqualForDrift(pre.status, b.status)) drifts.push(`status: local ${pre.status} → server ${b.status}`);
        if (!valuesEqualForDrift(pre.payment_status, b.payment_status)) drifts.push(`payment_status: local ${pre.payment_status} → server ${b.payment_status}`);
        if (drifts.length > 0) {
          appendHealthFault({
            type: 'booking_drift',
            scope: `booking:${b.id}`,
            severity: 'warn',
            message: `Post-sync drift on booking ${b.id}: ${drifts.join('; ')}`,
            context: { booking_id: b.id, drifts, invoice_number: b.invoice_number || null }
          });
          console.warn('[SYNC DRIFT]', b.id, drifts);
        }
      }
    } catch (driftError) {
      console.error('[Sync] Drift check failed:', driftError);
    }
  }

  if (deadLetter.length > 0) {
    const deadPath = path.join(state.cacheDir, 'sync-failed.json');
    const deadTmp = deadPath + '.tmp';
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(deadPath, 'utf-8'));} catch {/* empty */}
    try {
      fs.writeFileSync(deadTmp, JSON.stringify([...existing, ...deadLetter], null, 2), 'utf-8');
      fs.renameSync(deadTmp, deadPath);
    } catch (e) {
      console.error('[Sync] Dead-letter write failed:', e);
      try {fs.unlinkSync(deadTmp);} catch {/* ignore */}
    }
    for (const item of deadLetter) {
      console.error('[SYNC DEAD LETTER]', item);
    }
  }

  console.log(`[Sync] Done — ${successCount} synced, ${pending.length} retrying, ${deadLetter.length} dead-lettered`);

  broadcastSyncStatus();
}

export async function requeueEligibleFailedSyncItems(minAgeMs = DEAD_LETTER_AUTO_RETRY_AFTER_MS) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  if (failed.length === 0) return { retried: 0, remaining: 0 };

  const now = Date.now();
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  const keepFailed = [];
  const retryItems = [];

  for (const item of failed) {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const shouldRetry = Number.isNaN(attemptedAtMs) || now - attemptedAtMs >= minAgeMs;
    if (item.manualRetryOnly === true || !shouldRetry) {
      keepFailed.push(item);
      continue;
    }

    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: 0,
      lastError: '',
      lastAttemptedAt: null
    });

    if (!existingIds.has(cleanItem._queue_id)) {
      queue.push(cleanItem);
      existingIds.add(cleanItem._queue_id);
    }

    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem);
      if (orderId) {
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }

    retryItems.push(cleanItem);
  }

  if (retryItems.length === 0) return { retried: 0, remaining: failed.length };

  writeFailedSyncQueue(keepFailed);
  writeSyncQueue(queue);
  console.warn(`[Sync] Auto-requeued ${retryItems.length} dead-lettered item(s) for another attempt.`);
  broadcastSyncStatus();
  return { retried: retryItems.length, remaining: keepFailed.length };
}

export function queueOperation(type, table, data, id = null, meta = {}) {
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const derivedMeta = {
    ...(type === 'rpc' && table === 'create_quotation' && data?.payload?.id ?
    { _queue_id: `quotation-${data.payload.id}` } :
    {}),
    ...meta
  };
  // Guardrail: create_quotation defaults to _queue_id: `quotation-${record.id}`.
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data,
    id,
    timestamp: new Date().toISOString(),
    ...derivedMeta
  }, type);

  // Deduplication: skip if an identical RPC with same idempotency key is already queued
  if (type === 'rpc' && data?.p_idempotency_key) {
    const existingItem = queue.find(
      (item) => item.type === 'rpc' &&
      item.table === table &&
      item.data?.p_idempotency_key === data.p_idempotency_key
    );
    if (existingItem?._queue_id) {
      console.warn('[SYNC QUEUE] Duplicate idempotent RPC detected — reusing existing queue item', {
        operation: table,
        _queue_id: existingItem._queue_id
      });
      return existingItem._queue_id;
    }
  }

  const hasSameQueueId = queue.some((item) => item._queue_id === queuedItem._queue_id);
  if (hasSameQueueId) {
    console.warn('[SYNC QUEUE] Duplicate _queue_id detected — skipping push', { _queue_id: queuedItem._queue_id, operation: queuedItem.table });
    return queuedItem._queue_id;
  }

  queue.push(queuedItem);
  writeSyncQueue(queue);
  return queuedItem._queue_id;
}

function clearActivityLogForInfrastructure() {
  try {
    fs.writeFileSync(path.join(state.cacheDir, 'activity-log.json'), '[]', 'utf-8');
  } catch (e) {
    console.error('Clear activity log failed:', e);
  }
}

// ─── AUTO BACKUP ──────────────────────────────────────────────────────────────

export function createBackup() {
  try {
    if (!state.lodgeId) return;
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `backup-${ts}.json`);

    const users = readCache('users').map(({ password_hash, ...u }) => u);

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      lodge_id: state.lodgeId,
      tables: {
        rooms: readCache('rooms'),
        customers: readCache('customers'),
        bookings: readCache('bookings'),
        users,
        settings: readCache('settings')
      }
    };

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse();
    for (const old of files.slice(10)) {
      try {fs.unlinkSync(path.join(backupDir, old));} catch {/* ignore */}
    }

    console.log(`Auto-backup saved: ${backupPath}`);
    return backupPath;
  } catch (e) {
    console.error('Auto-backup failed:', e);
    return null;
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initDatabase() {
  if (state._initialized) {
    console.warn('[DB] initDatabase called more than once — skipping')
    return
  }
  state.cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache');
  state.profilesCacheDir = path.join(state.cacheRootDir, 'profiles');
  await initializeProfileRuntime();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL or VITE_SUPABASE_KEY is missing.\n' +
      'Create a root .env file with both variables, then re-run the app.\n' +
      'See .env.example for the required format.'
    );
  }
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    state.adminDb = buildSupabaseClient(serviceKey);
    console.log('[Auth] SUPABASE_SERVICE_ROLE_KEY found — Command Central admin mode enabled');
  } else {
    state.adminDb = null;
    console.log('[Auth] No SUPABASE_SERVICE_ROLE_KEY — running in lodge-only mode');
  }

  // P0-1: restore persisted sync recency so System Health has real data immediately
  if (state.cacheDir) {
    const meta = readSyncMeta();
    if (meta.lastSuccessfulSyncAt && !state.lastSuccessfulSyncAt) {
      state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt;
    }
  }

  // P0-5: replayAuthReady stays false until a real user logs in.
  // Startup sync is intentionally skipped — we must not replay queued financial
  // operations before the correct Supabase client is authenticated.
  let online = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    online = await checkOnline();
    if (online) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  if (online && state.lodgeId) {
    // Only refresh caches at startup (safe read-only — does not replay writes)
    await refreshAllCaches();
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)');
  } else {
    console.log('Running in offline mode — using cached data');
  }

  if (!state.backupIntervalStarted) {
    state.backupIntervalStarted = true;

    createBackup();
    setInterval(() => createBackup(), 60 * 60 * 1000);

    // Reconnect detection: fires sync on network return
    setInterval(async () => {
      if (state.connectivityCheckInProgress) return;
      state.connectivityCheckInProgress = true;
      try {
        const wasOffline = !state.isOnline;
        const nowOnline = await checkOnline();
        const hasPendingSync = readSyncQueue().length > 0 || readFailedSyncQueue().some((item) => item?.manualRetryOnly !== true);
        if (nowOnline && state.lodgeId && state.replayAuthReady && (wasOffline || hasPendingSync)) {
          console.log('Back online — syncing changes...');
          await requeueEligibleFailedSyncItems();
          await processSyncQueue();
          if (wasOffline) await refreshAllCaches();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Reconnect sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'reconnect',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      } finally {
        state.connectivityCheckInProgress = false;
      }
    }, CONNECTIVITY_CHECK_INTERVAL_MS);

    // P0-6: Periodic sync — ensures retryable dead letters are replayed even when
    // the app never transitions offline→online (i.e., stays continuously online).
    setInterval(async () => {
      try {
        if (!state.isOnline || !state.lodgeId || !state.replayAuthReady) return;
        await requeueEligibleFailedSyncItems();
        if (readSyncQueue().length > 0) {
          await processSyncQueue();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Periodic sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'periodic',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      }
    }, PERIODIC_SYNC_INTERVAL_MS);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── LOCAL TRUSTED DEVICE CACHE ───────────────────────────────────────────────
// The app no longer treats this device as a password verifier. Offline access is
// restored through the signed-in session nonce below; legacy password hashes are
// kept only so older installs can be diagnosed and phased out safely.

function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email);
  const filtered = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  writeAuthCache(filtered);
}
function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email);
  const entries = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  entries.push({ email: emailLower, lodge_id: state.lodgeId, password_hash: passwordHash, deprecated: true });
  writeAuthCache(entries);
}

// ─── SESSION NONCE (anti-impersonation) ─────────────────────────────────────
// A random nonce generated on successful login, persisted to a file only the
// main process can read. restoreUserSession() requires the correct nonce to
// prove the renderer legitimately logged in on a prior run.
// Identity is derived from the nonce file — the renderer cannot influence it.

// Offline-first front desks need a trusted device session that survives normal
// connectivity gaps without rechecking a password against Supabase every week.
const SESSION_NONCE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function getSessionNoncePath() {
  return path.join(state.cacheDir, 'session-nonce.json');
}

function getTrustedSessionsPath() {
  return path.join(state.cacheDir, 'trusted-sessions.json');
}

function readSessionNonce() {
  try {return JSON.parse(fs.readFileSync(getSessionNoncePath(), 'utf-8'));}
  catch {return null;}
}

function readTrustedSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getTrustedSessionsPath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTrustedSessions(sessions) {
  try {fs.writeFileSync(getTrustedSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8');} catch {}
}

function pruneExpiredTrustedSessions(sessions = readTrustedSessions()) {
  const now = Date.now();
  const active = sessions.filter((session) => {
    const createdAt = new Date(session?.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= SESSION_NONCE_MAX_AGE_MS;
  });
  if (active.length !== sessions.length) writeTrustedSessions(active);
  return active;
}

function normalizeTrustedSessionRecord(record) {
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

function writeSessionNonce(user, nonce, password = '') {
  const record = buildTrustedSessionRecord(user, nonce, password);
  fs.writeFileSync(getSessionNoncePath(), JSON.stringify(record, null, 2), 'utf-8');

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
  try {fs.unlinkSync(getSessionNoncePath());} catch {/* file may not exist */}
}

export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex');
  writeSessionNonce(user, nonce, password);
  return nonce;
}

async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: state.lodgeId });
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10); // legacy only, phased out by Supabase Auth
    upsertAuthEntry(emailLower, localHash);
  }
  upsertCachedUser(user);
  const authEntries = readAuthCache().filter((entry) => entry.email === emailLower && entry.lodge_id === state.lodgeId);
  const cachedUser = getCachedUser(emailLower);
  console.log('[AUTH] cache write result:', {
    email: emailLower,
    auth_entry_written: authEntries.length > 0,
    cached_user_written: !!cachedUser,
    cached_user_id: cachedUser?.id || null
  });
}

function getCachedUser(emailLower) {
  const normalizedEmail = normalizeEmail(emailLower);
  return readCache('users').
  map(normalizeUserRecord).
  find((u) => u?.email === normalizedEmail && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
}

function logAuthFailure(reason, details = {}) {
  console.warn('[AUTH] login failed:', {
    reason,
    lodge_id: state.lodgeId,
    email: details.email,
    online: state.isOnline,
    ...details
  });
}

function tryOfflineLogin(emailLower) {
  logAuthFailure('offline_password_login_disabled', { email: emailLower });
  return {
    user: null,
    code: 'offline_unlock_required',
    error:
    'Offline password sign-in is no longer supported. Open the app with the saved trusted session, or connect to the internet and sign in again.'
  };
}

function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user;
  return safeUser;
}

async function findRemoteUsersByEmailForCurrentLodge(emailLower) {
  try {
    const { data, error } = await state.supabase.
    from('users').
    select('id, email, role, lodge_id, created_at, name').
    eq('email', emailLower).
    eq('lodge_id', state.lodgeId).
    limit(5);
    if (error) return [];
    return (data || []).map(normalizeUserRecord).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchAuthenticateUserContract(emailLower) {
  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
    authTrace('auth client state', getAuthClientState('anon-health-probe', null, emailLower));
    const rpcArgs = {
      p_email: emailLower,
      p_lodge_id: state.lodgeId,
      p_password: null, // health-check probe — no password, expect authenticated: false
      p_session_type: 'desktop'
    };
    authTrace('rpc call start', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: rpcArgs
    });
    const rpcResult = await authClient.rpc('authenticate_user', rpcArgs);
    if (rpcResult.error) {
      authTrace('rpc call error', {
        functionName: 'authenticate_user',
        ...getAuthClientState('anon-health-probe', null, emailLower),
        args: rpcArgs,
        error: rpcResult.error
      });
    }
    const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) };
  } catch (error) {
    authTrace('rpc call error', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: {
        p_email: emailLower,
        p_lodge_id: state.lodgeId,
        p_password: null,
        p_session_type: 'desktop'
      },
      error: {
        message: error.message || 'authenticate_user failed.',
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null,
        stack: error.stack || null
      }
    });
    return {
      rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
      rpcRow: null,
      contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
    };
  }
}

async function getLodgeAuthContext(targetLodgeId = state.lodgeId) {
  const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
  const rpcArgs = {
    p_lodge_id: targetLodgeId
  };
  authTrace('auth client state', getAuthClientState('anon-lodge-context'));
  authTrace('rpc call start', {
    functionName: 'get_lodge_auth_context',
    ...getAuthClientState('anon-lodge-context'),
    args: rpcArgs
  });
  const { data, error } = await authClient.rpc('get_lodge_auth_context', rpcArgs);
  if (error) {
    authTrace('rpc call error', {
      functionName: 'get_lodge_auth_context',
      ...getAuthClientState('anon-lodge-context'),
      args: rpcArgs,
      error
    });
  }
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

async function authenticateOnline(emailLower, password) {
  const supabaseAuth = await authenticateWithSupabaseAuth(emailLower, password);
  if (supabaseAuth.user || supabaseAuth.code !== 'supabase_auth_unavailable') {
    return supabaseAuth;
  }

  let rpcResult;
  let rpcRow;
  let contract;
  try {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Authentication timed out — server did not respond in time.')), 15000)
    );
    const authResult = await Promise.race([
    (async () => {
      try {
        const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
        const rpcArgs = {
          p_email: emailLower,
          p_lodge_id: state.lodgeId,
          p_password: password,
          p_session_type: 'desktop'
        };
        authTrace('auth client state', getAuthClientState('anon-login', null, emailLower));
        authTrace('rpc call start', {
          functionName: 'authenticate_user',
          ...getAuthClientState('anon-login', null, emailLower),
          args: {
            ...rpcArgs,
            p_password: typeof password === 'string' ? `[length:${password.length}]` : null
          }
        });
        const rpcResult = await authClient.rpc('authenticate_user', rpcArgs);
        if (rpcResult.error) {
          authTrace('rpc call error', {
            functionName: 'authenticate_user',
            ...getAuthClientState('anon-login', null, emailLower),
            args: {
              ...rpcArgs,
              p_password: typeof password === 'string' ? `[length:${password.length}]` : null
            },
            error: rpcResult.error
          });
        }
        const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
        return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) };
      } catch (error) {
        authTrace('rpc call error', {
          functionName: 'authenticate_user',
          ...getAuthClientState('anon-login', null, emailLower),
          args: {
            p_email: emailLower,
            p_lodge_id: state.lodgeId,
            p_password: typeof password === 'string' ? `[length:${password.length}]` : null,
            p_session_type: 'desktop'
          },
          error: {
            message: error.message || 'authenticate_user failed.',
            code: error.code || null,
            details: error.details || null,
            hint: error.hint || null,
            stack: error.stack || null
          }
        });
        return {
          rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
          rpcRow: null,
          contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
        };
      }
    })(),
    timeoutPromise]
    );
    rpcResult = authResult.rpcResult;
    rpcRow = authResult.rpcRow;
    contract = authResult.contract;
  } catch (e) {
    return { user: null, code: 'server_unreachable', error: e.message };
  }

  console.log('[AUTH] online auth result:', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    user_id: contract.row?.id || null
  });
  authTrace('db.loginUser online auth result', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    authenticated: contract.row?.authenticated ?? null,
    user_id: contract.row?.id || null
  });

  if (rpcResult.error) {
    const errorMessage = rpcResult.error.message || 'authenticate_user failed.';
    console.error('[AUTH] online verification error:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      rpcError: errorMessage
    });
    if (isBackendAuthSchemaError(errorMessage)) {
      console.warn('[AUTH TRACE] schema error wrapper hit', {
        source: 'authenticate_user_rpc_error',
        email: emailLower,
        rpc_error: errorMessage
      });
    }
    return {
      user: null,
      code: 'auth_failed_real',
      error: errorMessage,
      details: {
        source: 'authenticate_user',
        rpc_error: errorMessage
      }
    };
  }

  if (!contract.ok) {
    console.error('[AUTH] online auth invalid RPC response shape:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      reason: contract.reason,
      payload: rpcRow || null
    });
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_contract_invalid',
      email: emailLower,
      reason: contract.reason,
      payload: rpcRow || null
    });
    return {
      user: null,
      code: 'auth_failed_real',
      error: contract.reason || 'Invalid authenticate_user contract response.',
      details: {
        source: 'authenticate_user_contract',
        reason: contract.reason,
        payload: rpcRow || null
      }
    };
  }

  const row = contract.row;
  if (normalizeLodgeId(row.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_lodge_mismatch',
      email: emailLower,
      returned_lodge_id: row.lodge_id,
      expected_lodge_id: state.lodgeId
    });
    return {
      user: null,
      code: 'auth_failed_real',
      error: 'authenticate_user returned a lodge_id that does not match this device.',
      details: {
        source: 'authenticate_user_lodge_mismatch',
        returned_lodge_id: row.lodge_id,
        expected_lodge_id: state.lodgeId
      }
    };
  }

  if (row.authenticated && row.found) {
    return {
      user: toSafeUser(row),
      source: 'rpc',
      session_token: row.session_token,
      session_expires_at: row.session_expires_at
    };
  }

  if (row.found) {
    return {
      user: null,
      code: 'wrong_password',
      error: 'That password is incorrect. Please try again or ask a manager to reset it.'
    };
  }

  const cachedUser = getCachedUser(emailLower);
  if (cachedUser) {
    return {
      user: null,
      code: 'wrong_lodge',
      error:
      'This account exists in saved data on this computer, but the server did not return it for the current lodge setup. Please ask support to check this device registration.'
    };
  }
  return {
    user: null,
    code: 'account_not_found',
    error: 'No staff account with that email was found for this lodge.'
  };
}

async function authenticateWithSupabaseAuth(emailLower, password) {
  if (!password) {
    return { user: null, code: 'wrong_password', error: 'Enter your password to sign in.' };
  }

  try {
    const authClient = buildSupabaseAuthClient();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: emailLower,
      password
    });

    if (authError) {
      const message = authError.message || 'Supabase Auth could not verify this sign-in.';
      if (/invalid login credentials|invalid credentials/i.test(message)) {
        return {
          user: null,
          code: 'supabase_auth_not_migrated',
          error: 'This account is not available in Supabase Auth yet.'
        };
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: message,
        details: { source: 'supabase_auth' }
      };
    }

    const accessToken = authData?.session?.access_token;
    if (!accessToken) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'Supabase Auth did not return an access token.',
        details: { source: 'supabase_auth' }
      };
    }

    const { data, error } = await authClient.rpc('authenticate_user_from_supabase', {
      p_lodge_id: state.lodgeId,
      p_session_type: 'desktop'
    });
    if (error) {
      if (/could not find the function|schema cache|authenticate_user_from_supabase/i.test(error.message || '')) {
        return {
          user: null,
          code: 'supabase_auth_unavailable',
          error: error.message
        };
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: error.message || 'Could not link this Supabase Auth user to the current lodge.',
        details: { source: 'authenticate_user_from_supabase' }
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    const contract = normalizeAuthContractRow(row);
    if (!contract.ok) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: contract.reason || 'Invalid Supabase Auth contract response.',
        details: { source: 'authenticate_user_from_supabase', payload: row || null }
      };
    }

    const normalized = contract.row;
    if (!normalized.found) {
      return {
        user: null,
        code: 'account_not_found',
        error: 'Supabase Auth verified the password, but this account is not linked to the selected lodge yet.'
      };
    }
    if (!normalized.authenticated || !normalized.session_token) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'The server did not issue a valid Boroko session for this Supabase Auth user.',
        details: { source: 'authenticate_user_from_supabase' }
      };
    }

    return {
      user: toSafeUser(normalized),
      source: 'supabase_auth',
      session_token: normalized.session_token,
      session_expires_at: normalized.session_expires_at
    };
  } catch (error) {
    return {
      user: null,
      code: 'supabase_auth_unavailable',
      error: error?.message || 'Supabase Auth could not be reached.'
    };
  }
}

async function createSupabaseAuthUserForStaff(emailLower, password) {
  if (!emailLower || !password) return null;
  const metadata = {
    lodge_id: state.lodgeId,
    app: 'boroko-bookings'
  };

  if (state.adminDb) {
    try {
      const { data, error } = await state.adminDb.auth.admin.createUser({
        email: emailLower,
        password,
        email_confirm: true,
        user_metadata: metadata
      });
      if (error) {
        console.warn('[AUTH] Supabase Auth admin staff create skipped:', {
          email: emailLower,
          message: error.message
        });
      } else {
        return data?.user?.id || null;
      }
    } catch (error) {
      console.warn('[AUTH] Supabase Auth admin staff create failed:', {
        email: emailLower,
        message: error?.message || 'unknown_error'
      });
    }
  }

  try {
    const authClient = buildSupabaseAuthClient();
    const { data, error } = await authClient.auth.signUp({
      email: emailLower,
      password,
      options: { data: metadata }
    });
    if (error) {
      console.warn('[AUTH] Supabase Auth staff signup skipped:', {
        email: emailLower,
        message: error.message
      });
      return null;
    }
    return data?.user?.id || null;
  } catch (error) {
    console.warn('[AUTH] Supabase Auth staff signup failed:', {
      email: emailLower,
      message: error?.message || 'unknown_error'
    });
    return null;
  }
}

/**
 * Always tries Supabase Auth first (authoritative). The older authenticate_user RPC is
 * retained as a temporary migration fallback for accounts not yet linked to auth.users.
 * Offline password verification is intentionally disabled; offline reopen uses the
 * trusted session nonce created after a successful online sign-in.
 *
 * @returns {{ user: object | null, error?: string }}
 */
export async function loginUser(email, password) {
  authTrace('db.loginUser start', {
    email,
    normalizedEmail: normalizeEmail(email),
    lodge_id: state.lodgeId,
    passwordLength: typeof password === 'string' ? password.length : null,
    hasPassword: typeof password === 'string' ? password.length > 0 : false
  });
  console.log('\n[DB LOGIN ATTEMPT]');
  console.log('[DB LOGIN] lodgeId:', state.lodgeId);
  console.log('[DB LOGIN] email:', normalizeEmail(email));
  clearBackendSession();
  if (!state.lodgeId) {
    const result = {
      user: null,
      code: 'no_profile_selected',
      error: 'Choose a lodge on this computer before staff sign-in.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }
  await checkOnline();
  const emailLower = normalizeEmail(email);

  if (state.isOnline) {
    const online = await authenticateOnline(emailLower, password);
    if (online.user) {
      let authContext;
      try {
        applyBackendSession({
          token: online.session_token,
          expires_at: online.session_expires_at,
          session_type: 'desktop'
        });
        authContext = await getLodgeAuthContext();
      } catch (e) {
        clearBackendSession();
        console.error('[AUTH REAL ERROR]', {
          message: e?.message,
          code: e?.code,
          details: e?.details,
          hint: e?.hint,
          stack: e?.stack
        });

        return {
          user: null,
          code: 'auth_failed_real',
          error: e?.message || 'Unknown authentication error',
          details: {
            code: e?.code,
            hint: e?.hint,
            details: e?.details
          }
        };
      }

      if (!authContext?.lodge_id || normalizeLodgeId(authContext.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
        clearBackendSession();
        console.warn('[AUTH TRACE] schema error wrapper hit', {
          source: 'get_lodge_auth_context_mismatch',
          expected_lodge_id: state.lodgeId,
          returned_lodge_id: authContext?.lodge_id || null
        });
        const result = {
          user: null,
          code: 'auth_failed_real',
          error: 'get_lodge_auth_context returned a lodge_id that does not match this device.',
          details: {
            source: 'get_lodge_auth_context',
            expected_lodge_id: state.lodgeId,
            returned_lodge_id: authContext?.lodge_id || null
          }
        };
        authTrace('db.loginUser final return', result);
        return result;
      }
      if (authContext.deleted) {
        clearBackendSession();
        const result = { user: null, code: 'company_disabled', error: 'This company has been disabled. Contact support.' };
        authTrace('db.loginUser final return', result);
        return result;
      }
      // Fetch outlet access for cashier/supervisor roles (non-breaking — new field)
      try {
        const { data: outletAccess } = await state.supabase.rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: state.lodgeId
        });
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || [];
        }
      } catch {
        // Non-critical — default to empty array if RPC not yet deployed
        if (!online.user.allowed_outlet_ids) online.user.allowed_outlet_ids = [];
      }
      if (online.source !== 'supabase_auth') {
        await createSupabaseAuthUserForStaff(emailLower, password);
      }
      await cacheSuccessfulLogin(online.user, emailLower, password);
      const result = {
        user: online.user,
        mode: 'online',
        source: online.source,
        session_token: online.session_token,
        session_expires_at: online.session_expires_at
      };
      authTrace('db.loginUser final return', { ...result, session_token: result.session_token ? '[present]' : null });
      return result;
    }

    if (online.code === 'wrong_password' || online.code === 'account_not_found' || online.code === 'wrong_lodge' || online.code === 'backend_auth_schema_outdated' || online.code === 'auth_failed_real') {
      logAuthFailure(online.code, { email: emailLower });
      authTrace('db.loginUser final return', online);
      return online;
    }

    console.warn('[AUTH] offline fallback decision:', {
      email: emailLower,
      reason: online.code || 'server_unreachable',
      using_offline_fallback: true
    });
    const savedSession = restoreSavedTrustedSession(emailLower, password);
    if (savedSession.user) {
      const result = {
        user: savedSession.user,
        mode: 'offline_trusted_session',
        warning: 'Opened the saved trusted session because the server could not verify the account right now.'
      };
      authTrace('db.loginUser final return', result);
      return result;
    }
    logAuthFailure(online.code || 'server_unreachable', { email: emailLower });
    const result = {
      user: null,
      code: savedSession.code || online.code || 'server_unreachable',
      error: savedSession.error || 'The server could not verify this sign-in, and this account has no saved offline session on this computer yet.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }

  console.warn('[AUTH] offline fallback decision:', {
    email: emailLower,
    reason: 'offline_mode',
    using_offline_fallback: true
  });
  const savedSession = restoreSavedTrustedSession(emailLower, password);
  if (savedSession.user) {
    const result = {
      user: savedSession.user,
      mode: 'offline_trusted_session',
      warning: 'Opened the saved trusted session while offline.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }
  const result = {
    user: null,
    code: savedSession.code || 'no_saved_trusted_session',
    error: savedSession.error || 'No saved trusted session was found on this computer. Connect to the internet and sign in once, then offline access will work for this device.'
  };
  authTrace('db.loginUser final return', result);
  return result;
}

// ─── USERS ────────────────────────────────────────────────────────────────────

export async function runAuthHealthCheck(email = '', options = {}) {
  authTrace('healthCheck start', { email: normalizeEmail(email), lodge_id: state.lodgeId });
  await checkOnline();
  if (!state.lodgeId) {
    const result = {
      ok: false,
      code: 'no_profile_selected',
      error: 'Choose a lodge profile on this computer before running the auth health check.',
      user: null,
      online: state.isOnline,
      lodge_id: null,
      contract_version: AUTH_CONTRACT_VERSION,
      settings_mode: null,
      checks: {
        lodge_id_is_uuid: false,
        settings_row_exists: false,
        settings_uses_uuid_contract: false,
        target_user_exists: false,
        authenticate_user_contract_valid: false
      }
    };
    authTrace('healthCheck return', result);
    return result;
  }
  const emailLower = normalizeEmail(email);
  const expectedUserId = isUuid(options?.expectedUserId) ? options.expectedUserId : null;
  const health = {
    ok: false,
    code: null,
    error: '',
    user: null,
    online: state.isOnline,
    lodge_id: state.lodgeId,
    contract_version: AUTH_CONTRACT_VERSION,
    settings_mode: null,
    checks: {
      lodge_id_is_uuid: isUuid(state.lodgeId),
      settings_row_exists: false,
      settings_uses_uuid_contract: false,
      target_user_exists: !emailLower,
      authenticate_user_contract_valid: false
    }
  };

  console.log('[AUTH HEALTH] start:', {
    email: emailLower || null,
    lodge_id: state.lodgeId,
    expected_user_id: expectedUserId
  });

  if (!health.checks.lodge_id_is_uuid) {
    health.code = 'invalid_lodge_id';
    health.error = 'This device is not linked to a valid UUID lodge ID.';
    authTrace('healthCheck return', health);
    return health;
  }

  if (!state.isOnline) {
    health.code = 'offline';
    health.error = 'An internet connection is required to validate the desktop auth contract.';
    authTrace('healthCheck return', health);
    return health;
  }

  try {
    const authContext = await getLodgeAuthContext();
    health.settings_mode = authContext ? 'lodge' : null;
    health.checks.settings_row_exists = !!authContext;
    health.checks.settings_uses_uuid_contract =
    isUuid(authContext?.lodge_id) &&
    normalizeLodgeId(authContext?.lodge_id) === normalizeLodgeId(state.lodgeId) &&
    Object.prototype.hasOwnProperty.call(authContext || {}, 'deleted');
  } catch (e) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_get_lodge_auth_context',
      message: e.message || null
    });
    health.code = isBackendAuthSchemaError(e.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(e.message || '') ?
    'The backend lodge auth context schema is outdated for this desktop auth flow. Run the checked-in auth migrations, then try again.' :
    e.message;
    authTrace('healthCheck return', health);
    return health;
  }

  if (!health.checks.settings_uses_uuid_contract) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'This app now requires UUID-based lodge settings rows with the latest auth migrations applied.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_settings_contract_invalid', health });
    authTrace('healthCheck return', health);
    return health;
  }

  const probeEmail = emailLower || '__auth_health_check__@invalid.local';
  const { rpcResult, contract } = await fetchAuthenticateUserContract(probeEmail);
  if (rpcResult?.error) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_authenticate_user_rpc',
      message: rpcResult.error.message || null
    });
    health.code = isBackendAuthSchemaError(rpcResult.error.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(rpcResult.error.message || '') ?
    'The canonical authenticate_user function is missing or outdated. Run the checked-in auth migrations, then try again.' :
    rpcResult.error.message;
    authTrace('healthCheck return', health);
    return health;
  }

  if (!contract.ok) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function returned an outdated contract shape.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_contract_invalid', contract });
    authTrace('healthCheck return', health);
    return health;
  }

  const probeRow = contract.row;
  if (normalizeLodgeId(probeRow.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function returned a lodge_id that does not match this device.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_lodge_mismatch', probeRow, lodgeId: state.lodgeId });
    authTrace('healthCheck return', health);
    return health;
  }

  if (emailLower) {
    if (probeRow.found) {
      health.checks.target_user_exists = true;
      health.user = toSafeUser(probeRow);
    } else {
      if (expectedUserId) {
        health.code = 'health_check_failed';
        health.error =
        'The new admin account was created, but the canonical authenticate_user check could not verify it for this lodge.';
        authTrace('healthCheck return', health);
        return health;
      }
      health.code = 'target_user_missing';
      health.error = 'The target user was not found for this lodge.';
      authTrace('healthCheck return', health);
      return health;
    }

    if (expectedUserId && probeRow.id !== expectedUserId) {
      health.code = 'backend_auth_schema_outdated';
      health.error = 'The canonical authenticate_user function returned a different user than the one just created for this lodge.';
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_expected_user_mismatch', probeRow, expectedUserId });
      authTrace('healthCheck return', health);
      return health;
    }
    if (probeRow.email !== emailLower) {
      health.code = 'backend_auth_schema_outdated';
      health.error = 'The canonical authenticate_user function returned a user that does not match the requested lodge-scoped email.';
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_email_mismatch', probeRow, emailLower });
      authTrace('healthCheck return', health);
      return health;
    }
  } else if (probeRow.found) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function unexpectedly returned a user during the health-check probe.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_unexpected_probe_user', probeRow });
    authTrace('healthCheck return', health);
    return health;
  }

  health.checks.authenticate_user_contract_valid = true;
  health.ok = true;
  health.code = 'ok';
  console.log('[AUTH HEALTH] success:', {
    email: emailLower || null,
    lodge_id: state.lodgeId,
    user_id: health.user?.id || null
  });
  authTrace('healthCheck return', health);
  return health;
}

export async function createUser(data) {
  await assertCreationWithinUsageLimit('user', { forceRemoteRefresh: state.isOnline });
  const emailLower = data.email.trim().toLowerCase();

  // ── Duplicate email check ─────────────────────────────────────────────────
  // Admin/super_admin emails are globally unique (one per system — they own the lodge setup).
  // All other roles (employees) can have accounts across multiple lodges.
  const isSetupRole = ['admin', 'super_admin'].includes(normalizeStaffRole(data.role));
  if (state.isOnline) {
    const query = state.supabase.from('users').select('id').eq('email', emailLower);
    if (!isSetupRole) query.eq('lodge_id', state.lodgeId);
    const { data: existing } = await query.limit(1);
    if (existing && existing.length > 0) {
      const msg = isSetupRole ?
      `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.` :
      `A user with the email "${emailLower}" already exists in this lodge.`;
      throw new Error(msg);
    }
  } else {
    const cached = readCache('users');
    const duplicate = isSetupRole ?
    cached.some((u) => u.email?.toLowerCase() === emailLower) :
    cached.some((u) => u.email?.toLowerCase() === emailLower && u.lodge_id === state.lodgeId);
    if (duplicate) {
      const msg = isSetupRole ?
      `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.` :
      `A user with the email "${emailLower}" already exists in this lodge.`;
      throw new Error(msg);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const hash = bcrypt.hashSync(data.password, 10);
  const pwaAccess = resolvePwaAccessUpdate({}, data);
  const id = randomUUID();
  const authUserId = state.isOnline ?
  await createSupabaseAuthUserForStaff(emailLower, data.password) :
  null;
  const user = {
    id,
    auth_user_id: authUserId,
    name: data.name,
    email: emailLower,
    password_hash: hash,
    role: normalizeStaffRole(data.role),
    lodge_id: state.lodgeId,
    pwa_enabled: pwaAccess.enabled === true,
    pwa_password_hash: pwaAccess.password_hash,
    pwa_password_set_at: pwaAccess.password_hash ? new Date().toISOString() : null,
    pwa_password_reset_by: pwaAccess.password_hash ? state.currentUser?.id || null : null,
    pwa_disabled_reason: pwaAccess.enabled === true ? null : pwaAccess.requested ? pwaAccess.disabled_reason : null,
    allowed_outlet_ids: Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : []
  };
  if (data.pin) {
    user.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_user', { payload: user });
    if (error) {
      console.error('[USERS] createUser insert failed:', {
        email: emailLower,
        lodge_id: state.lodgeId,
        error: error.message
      });
      const code = isBackendAuthSchemaError(error.message || '') ?
      'backend_auth_schema_outdated' :
      'user_create_failed';
      const prefix = code === 'backend_auth_schema_outdated' ?
      'This database is missing the latest Boroko auth schema required to create staff accounts for a lodge.' :
      'Could not create the staff account for this lodge.';
      throw createAppError(code, `${prefix} ${error.message}`.trim(), { email: emailLower, lodge_id: state.lodgeId });
    }
    if (!result?.success || !result?.id) {
      throw createAppError(
        'user_create_failed',
        result?.error || 'Supabase did not return the new staff account after insert.',
        { email: emailLower, lodge_id: state.lodgeId }
      );
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await state.supabase.rpc('set_user_pwa_access', {
        p_id: result.id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
      if (pwaError) {
        throw createAppError('pwa_access_update_failed', pwaError.message || 'Could not prepare manager mobile app access.', {
          email: emailLower,
          lodge_id: state.lodgeId,
          user_id: result.id
        });
      }
      if (!pwaResult?.success) {
        throw createAppError(
          'pwa_access_update_failed',
          pwaResult?.error || 'Could not prepare manager mobile app access.',
          { email: emailLower, lodge_id: state.lodgeId, user_id: result.id }
        );
      }
    }
    upsertCachedUser({
      id: result.id,
      auth_user_id: user.auth_user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      lodge_id: user.lodge_id,
      pin_hash: user.pin_hash || null,
      pwa_enabled: user.pwa_enabled,
      pwa_password_set_at: user.pwa_password_set_at,
      pwa_password_reset_by: user.pwa_password_reset_by,
      pwa_disabled_reason: user.pwa_disabled_reason,
      created_at: new Date().toISOString()
    });
    await refreshCache('users');
    if (!getCachedUser(emailLower)) {
      upsertCachedUser({
        id: result.id,
        auth_user_id: user.auth_user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        lodge_id: user.lodge_id,
        pin_hash: user.pin_hash || null,
        pwa_enabled: user.pwa_enabled,
        pwa_password_set_at: user.pwa_password_set_at,
        pwa_password_reset_by: user.pwa_password_reset_by,
        pwa_disabled_reason: user.pwa_disabled_reason,
        created_at: new Date().toISOString()
      });
    }
    if (pwaAccess.requested) {
      const action = user.pwa_enabled ? 'enabled' : 'prepared';
      logActivity('pwa_access_updated', `${user.name || user.email} · manager mobile app ${action}`);
    }
    return result?.id;
  } else {
    const cached = readCache('users');

    const newUser = {
      ...user,
      created_at: new Date().toISOString()
    };

    cached.push(newUser);
    writeCache('users', cached);

    // IMPORTANT: send ID to Supabase too
    // P2-15: assign _queue_id so pwa_access setup can declare an explicit dependency
    queueOperation('rpc', 'create_user', { payload: newUser }, null, { _queue_id: `user-${id}` });
    if (pwaAccess.requested) {
      // P2-15: must not run before the user row exists on the server
      queueOperation('rpc', 'set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      }, null, { _depends_on: `user-${id}` });
    }

    if (pwaAccess.requested) {
      const action = user.pwa_enabled ? 'enabled' : 'prepared';
      logActivity('pwa_access_updated', `${user.name || user.email} · manager mobile app ${action}`);
    }

    return id;
  }
}

export async function updateUser(id, data) {
  const cachedUsers = readCache('users');
  const existingUser = cachedUsers.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  const update = {};
  if (Object.prototype.hasOwnProperty.call(data, 'name')) update.name = data.name;
  if (Object.prototype.hasOwnProperty.call(data, 'email') && data.email) update.email = data.email.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(data, 'role')) update.role = normalizeStaffRole(data.role);
  if (Object.prototype.hasOwnProperty.call(data, 'allowed_outlet_ids')) {
    update.allowed_outlet_ids = Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : [];
  }
  const password_hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
  if (data.pin) {
    update.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }
  const pwaAccess = resolvePwaAccessUpdate(existingUser, buildPwaAccessInput(data));

  if (state.isOnline) {
    if (Object.keys(update).length > 0) {
      const { data: result, error } = await state.supabase.rpc('update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not update user');
    }
    if (password_hash) {
      const { data: passwordResult, error: passwordError } = await state.supabase.rpc('set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
      if (passwordError) throw new Error(passwordError.message);
      if (!passwordResult?.success) throw new Error(passwordResult?.error || 'Could not update user password');
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await state.supabase.rpc('set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
      if (pwaError) throw new Error(pwaError.message);
      if (!pwaResult?.success) throw new Error(pwaResult?.error || 'Could not update manager mobile app access');
    }
    await refreshCache('users');
  } else {
    const cached = [...cachedUsers];
    const idx = cached.findIndex((u) => u.id === id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...update };
      if (password_hash) cached[idx].password_hash = password_hash;
      if (pwaAccess.requested) {
        cached[idx].pwa_enabled = pwaAccess.enabled;
        cached[idx].pwa_disabled_reason = pwaAccess.disabled_reason;
        if (pwaAccess.password_hash) {
          cached[idx].pwa_password_hash = pwaAccess.password_hash;
          cached[idx].pwa_password_set_at = new Date().toISOString();
          cached[idx].pwa_password_reset_by = state.currentUser?.id || null;
        }
      }
    }
    writeCache('users', cached);
    if (Object.keys(update).length > 0) {
      queueOperation('rpc', 'update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
    }
    if (password_hash) {
      queueOperation('rpc', 'set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
    }
    if (pwaAccess.requested) {
      queueOperation('rpc', 'set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
    }
  }

  if (existingUser?.email && update.email && existingUser.email !== update.email) {
    removeAuthEntry(existingUser.email);
  }
  if (password_hash) {
    upsertAuthEntry((update.email || existingUser?.email || '').trim().toLowerCase(), password_hash);
  }
  if (pwaAccess.requested) {
    const subject = update.name || existingUser?.name || update.email || existingUser?.email || 'Staff account';
    const action = pwaAccess.enabled ?
    pwaAccess.password_hash ? 'enabled with a new mobile app password' : 'enabled' :
    pwaAccess.autoDisableForRole ? `suspended because the role changed to ${update.role || existingUser?.role}` : 'disabled';
    logActivity('pwa_access_updated', `${subject} · manager mobile app ${action}`);
  }
}

export async function resetUserPassword(id, password) {
  const users = state.isOnline ? await getAllUsers() : readCache('users');
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const password_hash = bcrypt.hashSync(password, 10);

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not reset password');
    await refreshCache('users');
  } else {
    const cached = readCache('users');
    const idx = cached.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error('Staff account not found in local data.');
    cached[idx] = { ...cached[idx], password_hash };
    writeCache('users', cached);
    queueOperation('rpc', 'set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
  }

  if (state.isOnline && existingUser.auth_user_id && state.adminDb) {
    const { error } = await state.adminDb.auth.admin.updateUserById(existingUser.auth_user_id, {
      password
    });
    if (error) throw new Error(error.message || 'Could not update Supabase Auth password.');
  }

  upsertAuthEntry(existingUser.email.trim().toLowerCase(), bcrypt.hashSync(password, 10));
}

export async function getAuthStatus(email = '') {
  await checkOnline();
  if (!state.lodgeId) {
    return {
      online: state.isOnline,
      lodge_id: null,
      hasOfflineAccess: false,
      hasTrustedSession: false,
      savedSessionCount: 0,
      hasCachedUsers: false,
      hasSavedAccounts: false,
      message: 'Choose a lodge on this computer for staff sign-in. Master admin sign-in still works.'
    };
  }
  const emailLower = normalizeEmail(email);
  const authEntries = readAuthCache().filter((entry) => entry.lodge_id === state.lodgeId);
  const cachedUsers = readCache('users').
  map(normalizeUserRecord).
  filter((entry) => entry && (!entry.lodge_id || entry.lodge_id === normalizeLodgeId(state.lodgeId)));
  const trustedSessions = pruneExpiredTrustedSessions().
  map(normalizeTrustedSessionRecord).
  filter((session) => session && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)));
  const legacySession = normalizeTrustedSessionRecord(readSessionNonce());
  const allTrustedSessions = [
  ...trustedSessions,
  ...(legacySession && (!legacySession.lodge_id || legacySession.lodge_id === normalizeLodgeId(state.lodgeId)) ? [legacySession] : [])];

  const hasTrustedSession = emailLower ?
  allTrustedSessions.some((session) => session.email === emailLower) :
  allTrustedSessions.length > 0;
  const hasOfflineAccess = emailLower ?
  authEntries.some((entry) => entry.email === emailLower) && cachedUsers.some((user) => user.email === emailLower) :
  authEntries.length > 0 && cachedUsers.length > 0;

  let message = 'Online. Staff can sign in normally.';
  if (!state.isOnline && hasTrustedSession) {
    message = 'Offline. Enter this user password to open the saved session on this computer.';
  } else if (!state.isOnline && emailLower && !hasOfflineAccess) {
    message = 'Offline. This account has no saved trusted session on this computer yet.';
  } else if (!state.isOnline) {
    message = allTrustedSessions.length > 0 ?
    'Offline. Choose a saved staff account and enter its password.' :
    'Offline. No saved staff sessions are available on this computer yet.';
  } else if (emailLower && !hasOfflineAccess) {
    message = 'Online. After this account signs in successfully once here, this computer can reopen its saved trusted session while offline.';
  } else if (emailLower && hasOfflineAccess) {
    message = 'Online. This account has local data on this computer. Offline access uses its saved session plus password.';
  } else if (hasOfflineAccess) {
    message = 'Online. This computer has saved local data for at least one staff account.';
  }

  return {
    online: state.isOnline,
    lodge_id: state.lodgeId,
    hasOfflineAccess,
    hasTrustedSession,
    savedSessionCount: allTrustedSessions.length,
    hasCachedUsers: cachedUsers.length > 0,
    hasSavedAccounts: authEntries.length > 0,
    message
  };
}

export async function deleteUser(id) {
  const users = state.isOnline ? await getAllUsers() : readCache('users').map(normalizeUserRecord).filter(Boolean);
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  if (state.currentUser?.id === id) throw new Error('You cannot delete the account you are currently signed in with.');

  if (normalizeStaffRole(existingUser.role) === 'admin') {
    const adminCount = users.filter((u) => normalizeStaffRole(u.role) === 'admin').length;
    if (adminCount <= 1) {
      throw new Error('You cannot delete the last admin in this lodge.');
    }
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete user');
    await refreshCache('users');
  } else {
    const cached = readCache('users');
    writeCache('users', cached.filter((u) => u.id !== id));
    queueOperation('rpc', 'delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
  }
}

// ─── ROOMS ────────────────────────────────────────────────────────────────────
// ─── CUSTOMERS ────────────────────────────────────────────────────────────────
// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// ─── BOOKING CHARGES (FOLIO) ──────────────────────────────────────────────────

// ─── RATE OVERRIDES (SEASONAL / WEEKEND PRICING) ──────────────────────────────

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────



// ─── ID PHOTO ─────────────────────────────────────────────────────────────────

// ─── FORECAST ─────────────────────────────────────────────────────────────────

// ─── POS (POINT OF SALE) ──────────────────────────────────────────────────────

// ─── INVENTORY ────────────────────────────────────────────────────────────────

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────




// ─── ANALYTICS & COST REPORTS ────────────────────────────────────────────────

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

// ─── INVOICES ────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// QUOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Tax helper — rate is a percentage (e.g. 14 = 14%). Default 0.
// Lightweight: only transitions draft → sent. Safe to call multiple times.
// ── Data Import ───────────────────────────────────────────────────────────────
