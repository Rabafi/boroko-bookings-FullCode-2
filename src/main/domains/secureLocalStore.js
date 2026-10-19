// @ts-check

/** @typedef {{_encrypted?: unknown, alg?: unknown, data?: unknown}} SecureEnvelopeLike */

import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';

const SECURE_STORE_VERSION = 1;
export const SECURE_STORE_UNAVAILABLE_CODE = 'secure_storage_unavailable';

/** @returns {boolean} */
function canUseSafeStorage() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

/** @param {string} filePath @param {string} operation */
function reportSecureStorageUnavailable(filePath, operation) {
  // Never include the value being protected (or the full path) in diagnostics.
  console.error(`[Secure Store] ${operation} blocked: OS secure storage is unavailable.`, {
    file: path.basename(filePath),
    code: SECURE_STORE_UNAVAILABLE_CODE,
    action: 'Enable the operating system secure-storage provider, then sign in again to prepare offline access.'
  });
}

/** @param {unknown} value @returns {{_encrypted: true, v: number, alg: string, data: string}} */
function buildEncryptedEnvelope(value) {
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  return {
    _encrypted: true,
    v: SECURE_STORE_VERSION,
    alg: 'electron-safeStorage',
    data: encrypted.toString('base64')
  };
}

/** @param {unknown} parsed @returns {unknown} */
function parseSecureEnvelope(parsed) {
  // Preserve the original optional/direct reads for malformed JSON values.
  const value = /** @type {SecureEnvelopeLike | null | undefined} */ (parsed);
  if (!value?._encrypted) return parsed;
  if (value.alg !== 'electron-safeStorage' || typeof value.data !== 'string') {
    throw new Error('Unsupported secure local store format.');
  }
  if (!canUseSafeStorage()) {
    const error = new Error('OS secure storage is not available.');
    /** @type {Error & {code: string}} */ (error).code = SECURE_STORE_UNAVAILABLE_CODE;
    throw error;
  }
  const decrypted = safeStorage.decryptString(Buffer.from(value.data, 'base64'));
  return JSON.parse(decrypted);
}

/** @param {string} filePath @param {unknown} fallback @param {{migratePlaintext?: unknown}} [options] @returns {unknown} */
export function readSecureJson(filePath, fallback, { migratePlaintext = true } = {}) {
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const envelope = /** @type {SecureEnvelopeLike | null | undefined} */ (parsed);

    // This store is used for session material and password-derived unlock
    // records. Never consume or preserve a plaintext record while the OS
    // provider is unavailable. Leave the old file in place so it can be
    // migrated safely after secure storage becomes available.
    if (!envelope?._encrypted && !canUseSafeStorage()) {
      reportSecureStorageUnavailable(filePath, 'Read');
      return fallback;
    }

    const value = parseSecureEnvelope(parsed);
    if (migratePlaintext && !envelope?._encrypted && canUseSafeStorage()) {
      // Do not return sensitive plaintext to a caller if migration failed.
      if (!writeSecureJson(filePath, value)) return fallback;
    }
    return value;
  } catch (error) {
    if (/** @type {{code?: unknown} | null | undefined} */ (error)?.code === SECURE_STORE_UNAVAILABLE_CODE) {
      reportSecureStorageUnavailable(filePath, 'Read');
    }
    return fallback;
  }
}

/** @param {string} filePath @param {unknown} value @returns {boolean} */
export function writeSecureJson(filePath, value) {
  if (!canUseSafeStorage()) {
    // Fail closed: this module must never downgrade a secure record to
    // plaintext merely because Electron safeStorage is unavailable.
    reportSecureStorageUnavailable(filePath, 'Write');
    return false;
  }

  try {
    const payload = buildEncryptedEnvelope(value);
    // Encrypt before touching the existing file. A failed encryption leaves
    // any previous record intact and never creates a plaintext fallback.
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
    return true;
  } catch (error) {
    console.error('[Secure Store] Encrypted write failed:', {
      file: path.basename(filePath),
      message: /** @type {{message?: unknown} | null | undefined} */ (error)?.message || 'unknown_error'
    });
    return false;
  }
}

/** @param {string} filePath */
export function removeSecureJson(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist.
  }
}
