import { state } from '../state.js';
import { normalizeUserRecord } from './shared.js';
import { readCache, writeCache } from './cacheStore.js';

function sanitizeUserForRenderer(user) {
  if (!user || typeof user !== 'object') return user;
  const {
    password_hash: _passwordHash,
    pin_hash: _pinHash,
    pwa_password_hash: _pwaPasswordHash,
    ...safeUser
  } = user;
  return safeUser;
}

export async function getAllUsers() {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('users').
    select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').
    eq('lodge_id', state.lodgeId).
    order('name');
    const normalized = (data || []).map(normalizeUserRecord).filter(Boolean);
    if (data) writeCache('users', normalized);
    return normalized.map(sanitizeUserForRenderer);
  }
  return readCache('users').map(normalizeUserRecord).filter(Boolean).map(sanitizeUserForRenderer);
}

export async function getUsers() {
  return getAllUsers();
}

export async function getUserById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('users').
    select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return sanitizeUserForRenderer(normalizeUserRecord(data));
  } catch {
    const user = readCache('users').map(normalizeUserRecord).filter(Boolean).find((entry) => entry.id === id) || null;
    return sanitizeUserForRenderer(user);
  }
}
