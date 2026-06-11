import crypto from 'crypto';
import { meshState } from './meshState.js';

// Clean nonces older than the tolerance window periodically.
const noncePurgeInterval = setInterval(purgeExpiredNonces, 10000);
noncePurgeInterval.unref?.();

/**
 * Computes the SHA256 hex hash of a request body (string or buffer).
 */
export function computeBodyHash(body) {
  const hash = crypto.createHash('sha256');
  if (body) {
    if (typeof body === 'string') {
      hash.update(body, 'utf8');
    } else if (Buffer.isBuffer(body)) {
      hash.update(body);
    } else {
      // JSON objects, etc.
      hash.update(JSON.stringify(body), 'utf8');
    }
  } else {
    hash.update('');
  }
  return hash.digest('hex');
}

/**
 * Computes the strict HMAC-SHA256 signature for P2P mesh network requests.
 * Format:
 *   METHOD + "\n" +
 *   PATH + "\n" +
 *   TIMESTAMP + "\n" +
 *   NONCE + "\n" +
 *   SHA256(BODY)
 *
 * NOTE: PATH includes the query string exactly as received/sent.
 */
export function generateMeshSignature(method, path, timestamp, nonce, body, secret) {
  if (!secret) {
    throw new Error('[MeshSecurity] Missing lodge mesh secret.');
  }

  const cleanMethod = method.toUpperCase().trim();
  const cleanPath = path.trim();
  const cleanTimestamp = timestamp.trim();
  const cleanNonce = nonce.trim();
  const bodyHash = computeBodyHash(body);

  const signatureInput = `${cleanMethod}\n${cleanPath}\n${cleanTimestamp}\n${cleanNonce}\n${bodyHash}`;

  return crypto
    .createHmac('sha256', secret)
    .update(signatureInput, 'utf8')
    .digest('hex');
}

/**
 * Validates a incoming request's HMAC signature.
 * Enforces timing-safe comparisons, nonce validation, and a strict 30s timestamp drift.
 */
export function validateIncomingRequest(method, path, headers, body, secret) {
  const nodeId = headers['x-boroko-mesh-node-id'];
  const lodgeId = headers['x-boroko-mesh-lodge-id'];
  const timestamp = headers['x-boroko-mesh-timestamp'];
  const nonce = headers['x-boroko-mesh-nonce'];
  const signature = headers['x-boroko-mesh-signature'];

  if (!nodeId || !lodgeId || !timestamp || !nonce || !signature) {
    return { isValid: false, error: 'Missing mandatory security headers' };
  }

  // 1. Verify Lodge ID matches active lodge profile
  if (lodgeId !== meshState.lodgeId) {
    return { isValid: false, error: 'Lodge ID mismatch' };
  }

  // 2. Validate timestamp tolerance window (30 seconds)
  const requestTime = new Date(timestamp).getTime();
  if (isNaN(requestTime)) {
    return { isValid: false, error: 'Invalid timestamp format' };
  }

  const now = Date.now();
  const drift = Math.abs(now - requestTime);
  if (drift > 30000) { // 30 seconds tolerance (accommodates LAN clock drift)
    return { isValid: false, error: `Timestamp drift exceeds tolerance. Drift: ${drift}ms` };
  }

  // 3. Prevent nonce replay attacks
  if (meshState.serverNonceCache.has(nonce)) {
    return { isValid: false, error: 'Nonce already utilized' };
  }

  // 4. Calculate expected signature and compare in constant-time
  try {
    const expectedSignature = generateMeshSignature(method, path, timestamp, nonce, body, secret);
    
    const signatureBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (signatureBuf.length !== expectedBuf.length) {
      return { isValid: false, error: 'Invalid request signature' };
    }

    const isTimingSafe = crypto.timingSafeEqual(signatureBuf, expectedBuf);
    if (!isTimingSafe) {
      return { isValid: false, error: 'Signature verification failed' };
    }
  } catch (err) {
    return { isValid: false, error: `Signature verification error: ${err.message}` };
  }

  // Cache nonce to prevent replay attacks (associated with timestamp expires in 10s)
  meshState.serverNonceCache.add(nonce);
  
  // Store expiration timestamp along with nonce to allow purging
  // Stored in the same map or Set, here we also save a map of nonce -> expire timestamp
  if (!meshState.nonceExpiries) {
    meshState.nonceExpiries = new Map();
  }
  meshState.nonceExpiries.set(nonce, requestTime + 30000);

  return { isValid: true };
}

/**
 * Periodically purges nonces whose validity tolerance window has expired.
 */
function purgeExpiredNonces() {
  if (!meshState.nonceExpiries) return;
  const now = Date.now();
  for (const [nonce, expireTime] of meshState.nonceExpiries.entries()) {
    if (now > expireTime) {
      meshState.serverNonceCache.delete(nonce);
      meshState.nonceExpiries.delete(nonce);
    }
  }
}
