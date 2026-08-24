import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';

const SECURE_STORE_VERSION = 1;
export const SECURE_STORE_UNAVAILABLE_CODE = 'secure_storage_unavailable';

function canUseSafeStorage() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function reportSecureStorageUnavailable(filePath, operation) {
  // Never include the value being protected (or the full path) in diagnostics.
  console.error(`[Secure Store] ${operation} blocked: OS secure storage is unavailable.`, {
    file: path.basename(filePath),
    code: SECURE_STORE_UNAVAILABLE_CODE,
    action: 'Enable the operating system secure-storage provider, then sign in again to prepare offline access.'
  });
}

function buildEncryptedEnvelope(value) {
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  return {
    _encrypted: true,
    v: SECURE_STORE_VERSION,
    alg: 'electron-safeStorage',
    data: encrypted.toString('base64')
  };
}

function parseSecureEnvelope(parsed) {
  if (!parsed?._encrypted) return parsed;
  if (parsed.alg !== 'electron-safeStorage' || typeof parsed.data !== 'string') {
    throw new Error('Unsupported secure local store format.');
  }
  if (!canUseSafeStorage()) {
    const error = new Error('OS secure storage is not available.');
    error.code = SECURE_STORE_UNAVAILABLE_CODE;
    throw error;
  }
  const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
  return JSON.parse(decrypted);
}

export function readSecureJson(filePath, fallback, { migratePlaintext = true } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // This store is used for session material and password-derived unlock
    // records. Never consume or preserve a plaintext record while the OS
    // provider is unavailable. Leave the old file in place so it can be
    // migrated safely after secure storage becomes available.
    if (!parsed?._encrypted && !canUseSafeStorage()) {
      reportSecureStorageUnavailable(filePath, 'Read');
      return fallback;
    }

    const value = parseSecureEnvelope(parsed);
    if (migratePlaintext && !parsed?._encrypted && canUseSafeStorage()) {
      // Do not return sensitive plaintext to a caller if migration failed.
      if (!writeSecureJson(filePath, value)) return fallback;
    }
    return value;
  } catch (error) {
    if (error?.code === SECURE_STORE_UNAVAILABLE_CODE) {
      reportSecureStorageUnavailable(filePath, 'Read');
    }
    return fallback;
  }
}

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
      message: error?.message || 'unknown_error'
    });
    return false;
  }
}

export function removeSecureJson(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist.
  }
}
