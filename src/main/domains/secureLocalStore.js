import fs from 'fs';
import { safeStorage } from 'electron';

const SECURE_STORE_VERSION = 1;

function canUseSafeStorage() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
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
    throw new Error('OS secure storage is not available.');
  }
  const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
  return JSON.parse(decrypted);
}

export function readSecureJson(filePath, fallback, { migratePlaintext = true } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const value = parseSecureEnvelope(parsed);
    if (migratePlaintext && !parsed?._encrypted && canUseSafeStorage()) {
      writeSecureJson(filePath, value);
    }
    return value;
  } catch {
    return fallback;
  }
}

export function writeSecureJson(filePath, value) {
  try {
    const payload = canUseSafeStorage() ? buildEncryptedEnvelope(value) : value;
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('[Secure Store] Write failed:', error);
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
