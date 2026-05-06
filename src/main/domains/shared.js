const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null;
}

export function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '');
}

export function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return null;
  const email = normalizeEmail(user.email);
  return {
    ...user,
    id: user.id || user.user_id || null,
    email,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null)
  };
}

export function isBackendAuthSchemaError(message = '') {
  return /authenticate_user|authenticate_manager|get_manager_pwa_profile|validate_app_session|set_user_pwa_access|get_lodge_auth_context|schema cache|returned record type|structure of query does not match|contract_version|column .*deleted|column .*lodge_id|column .*password_hash|column .*pwa_|permission denied/i.test(message);
}

export function createAppError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}
