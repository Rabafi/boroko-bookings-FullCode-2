// @ts-check
import { safeStorage } from 'electron';

const SECRET_FIELDS = new Set(['pin', 'approval_pin']);

/**
 * Expected envelope emitted by encrypt(); persisted queue values remain
 * unvalidated and malformed values keep their existing Buffer/from error path.
 * @typedef {Record<string, unknown> & {_secure_queue_secret?: unknown, algorithm?: unknown, value?: unknown}} LegacyEncryptedQueueSecretExpectedView
 */

/** @returns {boolean} */
function encryptionAvailable() {
  try {
    return safeStorage?.isEncryptionAvailable?.() === true;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
function encrypt(value) {
  if (!encryptionAvailable()) {
    throw new Error('Secure Windows credential storage is unavailable. Approval operations require an online connection.');
  }
  return {
    _secure_queue_secret: true,
    algorithm: 'electron-safeStorage',
    value: safeStorage.encryptString(String(value)).toString('base64')
  };
}

/** @param {unknown} value @returns {unknown} */
function decrypt(value) {
  if (!(/** @type {LegacyEncryptedQueueSecretExpectedView} */ (value))?._secure_queue_secret) return value;
  if (!encryptionAvailable() || (/** @type {LegacyEncryptedQueueSecretExpectedView} */ (value)).algorithm !== 'electron-safeStorage') {
    throw new Error('This queued approval secret cannot be decrypted on this POS device.');
  }
  // `value` is base64 text from encrypt(); this expected-data assertion does
  // not validate journal/cache contents or change Buffer.from's runtime errors.
  return safeStorage.decryptString(Buffer.from(/** @type {string} */ ((/** @type {LegacyEncryptedQueueSecretExpectedView} */ (value)).value), 'base64'));
}

/** @param {unknown} value @param {'encrypt' | 'decrypt'} mode @returns {unknown} */
function transform(value, mode) {
  if (Array.isArray(value)) return value.map((entry) => transform(entry, mode));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([key, entry]) => [
    key,
    SECRET_FIELDS.has(key) && entry !== '' && entry != null
      ? (mode === 'encrypt' ? encrypt(entry) : decrypt(entry))
      : transform(entry, mode)
  ]));
}

/** @param {unknown} payload @returns {unknown} */
export function protectLegacyQueuePayload(payload) {
  return transform(payload, 'encrypt');
}

/** @param {unknown} payload @returns {unknown} */
export function resolveLegacyQueuePayload(payload) {
  return transform(payload, 'decrypt');
}
