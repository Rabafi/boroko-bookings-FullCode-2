import { safeStorage } from 'electron';

const SECRET_FIELDS = new Set(['pin', 'approval_pin']);

function encryptionAvailable() {
  try {
    return safeStorage?.isEncryptionAvailable?.() === true;
  } catch {
    return false;
  }
}

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

function decrypt(value) {
  if (!value?._secure_queue_secret) return value;
  if (!encryptionAvailable() || value.algorithm !== 'electron-safeStorage') {
    throw new Error('This queued approval secret cannot be decrypted on this POS device.');
  }
  return safeStorage.decryptString(Buffer.from(value.value, 'base64'));
}

function transform(value, mode) {
  if (Array.isArray(value)) return value.map((entry) => transform(entry, mode));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SECRET_FIELDS.has(key) && entry !== '' && entry != null
      ? (mode === 'encrypt' ? encrypt(entry) : decrypt(entry))
      : transform(entry, mode)
  ]));
}

export function protectLegacyQueuePayload(payload) {
  return transform(payload, 'encrypt');
}

export function resolveLegacyQueuePayload(payload) {
  return transform(payload, 'decrypt');
}
