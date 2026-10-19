// @ts-check
import { normalizeStaffStatus } from '../../shared/accessControl.js';

/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {Error & { code?: unknown }} AppError */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} email */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** @param {unknown} id */
export function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null;
}

/** @param {unknown} value */
export function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '');
}

/**
 * @param {unknown} user
 * @returns {(UnknownRecord & { id: unknown, email: string, lodge_id: string | null, status: ReturnType<typeof normalizeStaffStatus>, capability_overrides: UnknownRecord }) | null}
 */
export function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return null;
  // The existing object guard admits arrays and objects with inherited or
  // accessor properties. This assertion only describes that already-tested
  // object for the property reads below; it does not claim payload validation.
  const record = /** @type {UnknownRecord} */ (user);
  const email = normalizeEmail(record.email);
  return {
    ...record,
    id: record.id || record.user_id || null,
    email,
    lodge_id: normalizeLodgeId(record.lodge_id || record.lodgeId || null),
    status: normalizeStaffStatus(record.status),
    capability_overrides:
      record.capability_overrides && typeof record.capability_overrides === 'object' && !Array.isArray(record.capability_overrides)
        ? /** @type {UnknownRecord} */ (record.capability_overrides)
        : {}
  };
}

/** @param {string} [message] */
export function isBackendAuthSchemaError(message = '') {
  return /authenticate_user|authenticate_manager|get_manager_pwa_profile|validate_app_session|set_user_pwa_access|get_lodge_auth_context|schema cache|returned record type|structure of query does not match|contract_version|column .*deleted|column .*lodge_id|column .*password_hash|column .*pwa_|permission denied/i.test(message);
}

/**
 * @param {string} code
 * @param {string} message
 * @param {UnknownRecord} [details]
 * @returns {AppError}
 */
export function createAppError(code, message, details = {}) {
  const error = new Error(message);
  /** @type {AppError} */ (error).code = code;
  Object.assign(error, details);
  return error;
}

export const MAX_FINANCIAL_AMOUNT = 1_000_000;
