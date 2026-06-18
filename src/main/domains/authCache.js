import path from 'path';
import { state } from '../state.js';
import { readCache, writeCache } from './cacheStore.js';
import { normalizeEmail, normalizeLodgeId, normalizeUserRecord } from './shared.js';
import { normalizeStaffStatus } from '../../shared/accessControl.js';
import { readSecureJson, writeSecureJson } from './secureLocalStore.js';

export function normalizeSessionUser(user) {
  if (!user || typeof user !== 'object') return user || null;

  const normalized = {
    ...user,
    id: user.id || user.user_id || null,
    email: normalizeEmail(user.email),
    name: typeof user.name === 'string' ? user.name : user.name || '',
    role: user.role || null,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null),
    status: normalizeStaffStatus(user.status),
    capability_overrides:
      user.capability_overrides && typeof user.capability_overrides === 'object' && !Array.isArray(user.capability_overrides)
        ? user.capability_overrides
        : {}
  };

  if (Object.prototype.hasOwnProperty.call(user, 'allowed_outlet_ids')) {
    if (user.allowed_outlet_ids === null) {
      normalized.allowed_outlet_ids = null;
    } else if (Array.isArray(user.allowed_outlet_ids)) {
      normalized.allowed_outlet_ids = [...user.allowed_outlet_ids];
    } else if (user.allowed_outlet_ids === undefined) {
      delete normalized.allowed_outlet_ids;
    }
  } else {
    delete normalized.allowed_outlet_ids;
  }

  return normalized;
}

export function mergeSessionUserScope(existingUser, refreshedUser) {
  const existing = normalizeSessionUser(existingUser) || null;
  const refreshed = normalizeSessionUser(refreshedUser) || null;

  if (!existing) return refreshed;
  if (!refreshed) return existing;

  const next = { ...existing, ...refreshed };
  const refreshedHasScope = Object.prototype.hasOwnProperty.call(refreshed, 'allowed_outlet_ids');
  const existingHasScope = Object.prototype.hasOwnProperty.call(existing, 'allowed_outlet_ids');

  if (refreshedHasScope) {
    next.allowed_outlet_ids = refreshed.allowed_outlet_ids;
  } else if (existingHasScope) {
    next.allowed_outlet_ids = existing.allowed_outlet_ids;
  } else {
    delete next.allowed_outlet_ids;
  }

  return next;
}

export function readAuthCache() {
  if (!state.cacheDir) return [];
  const parsed = readSecureJson(path.join(state.cacheDir, 'auth-cache.json'), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeAuthCache(entries) {
  if (!state.cacheDir) return;
  writeSecureJson(path.join(state.cacheDir, 'auth-cache.json'), Array.isArray(entries) ? entries : []);
}

export function upsertCachedUser(user) {
  if (!user?.email) return;
  const normalizedUser = normalizeSessionUser(normalizeUserRecord(user));
  if (!normalizedUser?.id || !normalizedUser.email) return;
  const { password_hash: _ph, ...safeUser } = normalizedUser;
  const cached = readCache('users');
  const existing = cached.
  map(normalizeUserRecord).
  filter(Boolean);
  const previous = existing.find((entry) => entry.id === safeUser.id || entry.email === safeUser.email);
  const mergedUser = mergeSessionUserScope(previous, { ...safeUser, lodge_id: safeUser.lodge_id || state.lodgeId });
  const next = existing.filter((entry) => entry.id !== safeUser.id && entry.email !== safeUser.email);
  next.push(mergedUser);
  writeCache('users', next);
}
