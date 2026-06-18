import { safeStorage } from 'electron';

const SECRET_FIELDS = new Set(['pin', 'approval_pin']);

function canEncrypt() {
  try {
    return safeStorage?.isEncryptionAvailable?.() === true;
  } catch {
    return false;
  }
}

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

function decryptSecret(value) {
  if (!value?._secure_queue_secret) return value;
  if (!canEncrypt() || value.alg !== 'electron-safeStorage' || typeof value.data !== 'string') {
    throw new Error('Queued approval secret cannot be decrypted on this device.');
  }
  return safeStorage.decryptString(Buffer.from(value.data, 'base64'));
}

function transform(value, mode) {
  if (Array.isArray(value)) return value.map((entry) => transform(entry, mode));
  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELDS.has(key) && entry != null && entry !== '') {
      next[key] = mode === 'encrypt' ? encryptSecret(entry) : decryptSecret(entry);
    } else {
      next[key] = transform(entry, mode);
    }
  }
  return next;
}

export function protectQueuedRpcData(data) {
  return transform(data, 'encrypt');
}

export function resolveQueuedRpcData(data) {
  return transform(data, 'decrypt');
}

