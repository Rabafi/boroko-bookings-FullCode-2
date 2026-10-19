// @ts-check
import bcrypt from 'bcryptjs';
import { state } from '../state.js';
import { isPosFullAccessRole } from '../../shared/accessControl.js';
import { createAppError, normalizeUserRecord } from './shared.js';
import { readCache, writeCache } from './cacheStore.js';

const PWA_DISABLED_MESSAGE = 'Manager mobile app access disabled.';
const PWA_ROLE_DISABLED_MESSAGE = 'Only manager and admin roles can use the manager mobile app.';
const USER_SELECT = 'id, auth_user_id, name, email, role, status, lodge_id, created_at, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, invite_sent_at, password_updated_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash, capability_overrides';
const LEGACY_USER_SELECT = 'id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash';

/** @typedef {Record<string, unknown>} UserPropertyView */

/** @param {unknown} role @returns {string} */
export function normalizeStaffRole(role) {
  return String(role || '').trim().toLowerCase() || 'receptionist';
}

/** @param {unknown} overrides @returns {Record<string, unknown>} */
export function normalizeCapabilityOverrides(overrides = {}) {
  return overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    ? /** @type {Record<string, unknown>} */ (overrides)
    : {};
}

/** @param {unknown} role */
function isPwaEligibleRole(role) {
  const normalized = normalizeStaffRole(role);
  return normalized === 'manager' || normalized === 'admin';
}

/** @param {unknown} reason @param {string} [fallback] */
function normalizePwaDisabledReason(reason, fallback = PWA_DISABLED_MESSAGE) {
  const value = String(reason || '').trim();
  return value || fallback;
}

/** @returns {string[] | null} */
export function getUserPosOutletFilter() {
  if (!state.currentUser) return [];
  if (state.currentUser.isMasterAdmin) return null;
  if (isPosFullAccessRole(state.currentUser.role)) return null;
  return Array.isArray(state.currentUser.allowed_outlet_ids) ? state.currentUser.allowed_outlet_ids : [];
}

/** @param {unknown} existingUser @param {unknown} data */
export function resolvePwaAccessUpdate(existingUser = {}, data = {}) {
  const existing = /** @type {UserPropertyView} */ (existingUser)
  const input = /** @type {UserPropertyView} */ (data)
  const hasToggle = Object.prototype.hasOwnProperty.call(data, 'pwa_enabled');
  const hasReason = Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason');
  const nextRole = normalizeStaffRole(input.role || existing?.role);
  const nextPassword = typeof input.pwa_password === 'string' ? input.pwa_password.trim() : '';
  const hasPassword = Boolean(nextPassword);
  const autoDisableForRole = Boolean(existing?.pwa_enabled) && Object.prototype.hasOwnProperty.call(data, 'role') && !isPwaEligibleRole(nextRole);
  const requested = hasToggle || hasReason || hasPassword || autoDisableForRole;

  if (!requested) {
    return { requested: false };
  }

  const enabled = autoDisableForRole ?
  false :
  hasToggle ?
  input.pwa_enabled === true :
  existing?.pwa_enabled === true;

  if (enabled && !isPwaEligibleRole(nextRole)) {
    throw createAppError('pwa_role_ineligible', PWA_ROLE_DISABLED_MESSAGE, { role: nextRole });
  }

  const password_hash = hasPassword ? bcrypt.hashSync(nextPassword, 10) : null;
  const hasExistingPassword = Boolean(existing?.pwa_password_set_at || existing?.pwa_password_hash);
  if (enabled && !password_hash && !hasExistingPassword) {
    throw createAppError('pwa_password_required', 'Set a separate manager mobile app password before enabling access.');
  }

  return {
    requested: true,
    enabled,
    password_hash,
    autoDisableForRole,
    disabled_reason: enabled ?
    null :
    normalizePwaDisabledReason(
      autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : input.pwa_disabled_reason,
      autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : PWA_DISABLED_MESSAGE
    )
  };
}

/** @param {unknown} data @param {unknown} [fallbackRole] */
export function buildPwaAccessInput(data = {}, fallbackRole = null) {
  const input = /** @type {UserPropertyView} */ (data)
  const payload = /** @type {UserPropertyView} */ ({});

  if (Object.prototype.hasOwnProperty.call(data, 'pwa_enabled')) {
    payload.pwa_enabled = input.pwa_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason')) {
    payload.pwa_disabled_reason = input.pwa_disabled_reason;
  }
  if (typeof input.pwa_password === 'string') {
    payload.pwa_password = input.pwa_password;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'role')) {
    payload.role = input.role;
  } else if (fallbackRole) {
    payload.role = fallbackRole;
  }

  return payload;
}

/** @param {unknown} user */
function sanitizeUserForRenderer(user) {
  if (!user || typeof user !== 'object') return user;
  const userView = /** @type {UserPropertyView} */ (user)
  const {
    password_hash: _passwordHash,
    pin_hash: _pinHash,
    pwa_password_hash: _pwaPasswordHash,
    ...safeUser
  } = userView;
  return safeUser;
}

/** @param {unknown} error */
function isLegacyUserSchemaError(error) {
  const errorView = /** @type {UserPropertyView | null | undefined} */ (error)
  const message = String(errorView?.message || '');
  return /column users\.(status|last_sign_in_at|last_desktop_sign_in_at|last_pwa_sign_in_at|last_activity_at|invite_sent_at|password_updated_at|capability_overrides) does not exist/i.test(message);
}

async function selectUsersWithSchemaFallback() {
  const client = /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase)
  const primary = await client
    .from('users')
    .select(USER_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('name');
  if (!primary.error || !isLegacyUserSchemaError(primary.error)) {
    return primary;
  }
  return client
    .from('users')
    .select(LEGACY_USER_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('name');
}

export async function getAllUsers() {
  if (state.isOnline) {
    const { data } = await selectUsersWithSchemaFallback();
    const normalized = (data || []).map(normalizeUserRecord).filter((entry) => entry !== null);
    if (data) writeCache('users', normalized);
    return normalized.map(sanitizeUserForRenderer);
  }
  return /** @type {UserPropertyView[]} */ (readCache('users')).map(normalizeUserRecord).filter((entry) => entry !== null).map(sanitizeUserForRenderer);
}

export async function getUsers() {
  return getAllUsers();
}

/** @param {unknown} id */
export async function getUserById(id) {
  if (!id) return null;
  try {
    const primaryResult = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
      from('users').
      select(USER_SELECT).
      eq('id', id).
      eq('lodge_id', state.lodgeId).
      single();
    /** @type {unknown} */ let data = primaryResult.data;
    let error = primaryResult.error;
    if (error && isLegacyUserSchemaError(error)) {
      const legacyResult = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).
        from('users').
        select(LEGACY_USER_SELECT).
        eq('id', id).
        eq('lodge_id', state.lodgeId).
        single();
      data = legacyResult.data;
      error = legacyResult.error;
    }
    if (error) throw error;
    return sanitizeUserForRenderer(normalizeUserRecord(data));
  } catch {
    const user = /** @type {UserPropertyView[]} */ (readCache('users')).map(normalizeUserRecord).filter((entry) => entry !== null).find((entry) => entry.id === id) || null;
    return sanitizeUserForRenderer(user);
  }
}

/** @param {{ userId?: unknown, lodgeId?: unknown, sessionType?: unknown, markSignIn?: unknown }} [options] */
export async function touchUserPresence({ userId, lodgeId = state.lodgeId, sessionType = 'desktop', markSignIn = false } = {}) {
  if (!userId || !lodgeId || !state.isOnline) return false;
  try {
    const { data, error } = await /** @type {import('@supabase/supabase-js').SupabaseClient} */ (state.supabase).rpc('touch_user_presence', {
      p_user_id: userId,
      p_lodge_id: lodgeId,
      p_session_type: sessionType,
      p_mark_sign_in: markSignIn === true
    });
    if (error || data?.success === false) return false;
    return true;
  } catch {
    return false;
  }
}
