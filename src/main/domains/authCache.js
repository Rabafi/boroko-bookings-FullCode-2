// @ts-check
import path from 'path';
import { state } from '../state.js';
import { readCache, writeCache } from './cacheStore.js';
import { normalizeEmail, normalizeLodgeId, normalizeUserRecord } from './shared.js';
import { normalizeStaffStatus } from '../../shared/accessControl.js';
import { readSecureJson, writeSecureJson } from './secureLocalStore.js';
import { recordCriticalError } from './operationalLog.js';

/** @typedef {Record<string, unknown>} AuthCachePropertyView */

/** @param {unknown} user @returns {unknown} */
export function normalizeSessionUser(user) {
  if (!user || typeof user !== 'object') return user || null;
  const userView = /** @type {AuthCachePropertyView} */ (user)

  const normalized = {
    ...userView,
    id: userView.id || userView.user_id || null,
    email: normalizeEmail(userView.email),
    name: typeof userView.name === 'string' ? userView.name : userView.name || '',
    role: userView.role || null,
    lodge_id: normalizeLodgeId(userView.lodge_id || userView.lodgeId || null),
    status: normalizeStaffStatus(userView.status),
    capability_overrides:
      userView.capability_overrides && typeof userView.capability_overrides === 'object' && !Array.isArray(userView.capability_overrides)
        ? userView.capability_overrides
        : {}
  };

  if (Object.prototype.hasOwnProperty.call(userView, 'allowed_outlet_ids')) {
    if (userView.allowed_outlet_ids === null) {
      normalized.allowed_outlet_ids = null;
    } else if (Array.isArray(userView.allowed_outlet_ids)) {
      normalized.allowed_outlet_ids = [.../** @type {unknown[]} */ (userView.allowed_outlet_ids)];
    } else if (userView.allowed_outlet_ids === undefined) {
      delete normalized.allowed_outlet_ids;
    }
  } else {
    delete normalized.allowed_outlet_ids;
  }

  return normalized;
}

/** @param {unknown} existingUser @param {unknown} refreshedUser @returns {unknown} */
export function mergeSessionUserScope(existingUser, refreshedUser) {
  const existing = normalizeSessionUser(existingUser) || null;
  const refreshed = normalizeSessionUser(refreshedUser) || null;

  if (!existing) return refreshed;
  if (!refreshed) return existing;

  const existingView = /** @type {AuthCachePropertyView} */ (existing)
  const refreshedView = /** @type {AuthCachePropertyView} */ (refreshed)
  const next = { ...existingView, ...refreshedView };
  const refreshedHasScope = Object.prototype.hasOwnProperty.call(refreshedView, 'allowed_outlet_ids');
  const existingHasScope = Object.prototype.hasOwnProperty.call(existingView, 'allowed_outlet_ids');

  if (refreshedHasScope) {
    next.allowed_outlet_ids = refreshedView.allowed_outlet_ids;
  } else if (existingHasScope) {
    next.allowed_outlet_ids = existingView.allowed_outlet_ids;
  } else {
    delete next.allowed_outlet_ids;
  }

  return next;
}

/** @returns {unknown[]} */
export function readAuthCache() {
  if (!state.cacheDir) return [];
  const parsed = readSecureJson(path.join(state.cacheDir, 'auth-cache.json'), []);
  return Array.isArray(parsed) ? /** @type {unknown[]} */ (parsed) : [];
}

/** @param {unknown} entries @returns {boolean} */
export function writeAuthCache(entries) {
  if (!state.cacheDir) return false;
  const written = writeSecureJson(
    path.join(state.cacheDir, 'auth-cache.json'),
    Array.isArray(entries) ? /** @type {unknown[]} */ (entries) : []
  );
  if (!written) {
    recordCriticalError(
      'auth.secure_storage',
      new Error('Secure storage is unavailable; offline sign-in preparation was not saved.'),
      { operation: 'auth_cache_write' },
      { limit: 120 }
    );
  }
  return written;
}

/** @param {unknown} user */
export function upsertCachedUser(user) {
  const userView = /** @type {AuthCachePropertyView | null | undefined} */ (user)
  if (!userView?.email) return;
  const normalizedUser = normalizeSessionUser(normalizeUserRecord(user));
  const normalizedView = /** @type {AuthCachePropertyView | null | undefined} */ (normalizedUser)
  if (!normalizedView?.id || !normalizedView.email) return;
  const { password_hash: _ph, ...safeUser } = normalizedView;
  const cached = readCache('users');
  const cachedView = /** @type {AuthCachePropertyView & {map: (callback: (entry: unknown) => unknown) => {filter: (callback: (entry: unknown) => boolean) => AuthCachePropertyView[]}}} */ (cached)
  const existing = cachedView.map(normalizeUserRecord).filter((entry) => entry !== null);
  const previous = existing.find((entry) => entry.id === safeUser.id || entry.email === safeUser.email);
  const mergedUser = /** @type {AuthCachePropertyView} */ (mergeSessionUserScope(previous, { ...safeUser, lodge_id: safeUser.lodge_id || state.lodgeId }));
  const next = existing.filter((entry) => entry.id !== safeUser.id && entry.email !== safeUser.email);
  next.push(mergedUser);
  writeCache('users', next);
}
