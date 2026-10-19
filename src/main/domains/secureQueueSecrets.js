// @ts-check
import { safeStorage } from 'electron';

/** @typedef {{ _secure_queue_secret: true, alg: 'electron-safeStorage', data: string }} SecureQueueSecretEnvelope */

/** @type {Set<string>} */
const SECRET_FIELDS = new Set(['pin', 'approval_pin', 'manager_pin']);

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  if (value === null || value === undefined) return undefined;
  return Reflect.get(Object(value), key, value);
}

function canEncrypt() {
  try {
    return safeStorage?.isEncryptionAvailable?.() === true;
  } catch {
    return false;
  }
}

/** @param {unknown} value @returns {SecureQueueSecretEnvelope} */
function encryptSecret(value) {
  if (!canEncrypt()) {
    throw new Error('Secure Windows storage is unavailable. Connect this device and obtain online supervisor approval.');
  }
  return {
    _secure_queue_secret: true,
    alg: 'electron-safeStorage',
    data: safeStorage.encryptString(String(value)).toString('base64')
  };
}

/** @param {unknown} value @returns {unknown} */
function decryptSecret(value) {
  if (!readOptionalField(value, '_secure_queue_secret')) return value;
  if (!canEncrypt() || readOptionalField(value, 'alg') !== 'electron-safeStorage' || typeof readOptionalField(value, 'data') !== 'string') {
    throw new Error('Queued approval secret cannot be decrypted on this device.');
  }
  // Preserve the baseline's second property read after the typeof check above;
  // this assertion only selects Buffer.from's string overload and adds no
  // runtime validation or rejection path.
  return safeStorage.decryptString(Buffer.from(/** @type {string} */ (readOptionalField(value, 'data')), 'base64'));
}

/** @param {unknown} value @param {'encrypt' | 'decrypt'} mode @returns {unknown} */
function transform(value, mode) {
  if (Array.isArray(value)) return value.map((entry) => transform(entry, mode));
  if (!value || typeof value !== 'object') return value;

  /** @type {Record<string, unknown>} */
  const next = {};
  // Object.entries is the existing traversal and eagerly reads enumerable
  // string-keyed values before recursively transforming them. Its library
  // declaration exposes those values as any, so widen them to unknown here.
  const entries = /** @type {Array<[string, unknown]>} */ (Object.entries(value));
  for (const [key, entry] of entries) {
    if (SECRET_FIELDS.has(key) && entry != null && entry !== '') {
      next[key] = mode === 'encrypt' ? encryptSecret(entry) : decryptSecret(entry);
    } else {
      next[key] = transform(entry, mode);
    }
  }
  return next;
}

/** @param {unknown} data @returns {unknown} */
export function protectQueuedRpcData(data) {
  return transform(data, 'encrypt');
}

/** @param {unknown} data @returns {unknown} */
export function resolveQueuedRpcData(data) {
  return transform(data, 'decrypt');
}

