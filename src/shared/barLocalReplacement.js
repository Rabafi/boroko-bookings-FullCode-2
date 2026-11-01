// @ts-check
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
// Checked JS keeps the same proof contract usable by Electron 22 / Node 16.
/** @param {unknown} value @returns {Record<string, any>} */
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function refuse(message) { throw Object.assign(new Error(message), { code: 'REPLACEMENT_NOT_VERIFIED' }) }

/**
 * Verify with the original device credential plus a fresh owner PIN before
 * changing any protected profile. Never returns or saves the temporary token.
 * @param {{authority_id:string,authority_epoch:number,business_id:string,outlet_id:string}} current
 * @param {{device_id:string,device_token:string}} credential
 * @param {{confirm:string,staff_id:string,pin:string}} request
 * @param {(method:string,pathname:string,options:Record<string,any>)=>Promise<any>} exchange
 * @param {{base_url:string,fingerprint:string|null}} endpoint
 */
export async function verifyBarReplacement(current, credential, request, exchange, endpoint) {
  if (request.confirm !== 'RECONNECT_SERVER' || !/^[a-f0-9-]{36}$/i.test(request.staff_id) || !/^\d{4,12}$/.test(request.pin)) refuse('Enter the owner staff ID and PIN, then confirm RECONNECT_SERVER.')
  if (!endpoint) refuse('A pinned replacement endpoint is required before releasing any credential.')
  const address = new URL(endpoint.base_url)
  const host = address.hostname.replace(/^\[|\]$/g, '')
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase())
  if (address.protocol !== 'https:' && !(address.protocol === 'http:' && loopback)) refuse('Use a pinned HTTPS LAN address, or loopback for local recovery.')
  if (address.protocol === 'https:' && (typeof endpoint.fingerprint !== 'string' || !/^(?:[a-f0-9]{64}|(?:[a-f0-9]{2}:){31}[a-f0-9]{2})$/i.test(endpoint.fingerprint))) refuse('A pinned replacement certificate is required before reconnecting.')
  const nonce = randomBytes(32).toString('hex')
  // No PIN or credential is sent until the peer proves possession of the
  // original replicated credential hash, bound to its actual TLS endpoint.
  const challenge = await exchange('POST', '/v1/replacement/challenge', { body: { device_id: credential.device_id, client_nonce: nonce } })
  const challengeBody = object(challenge.body), payload = object(challengeBody.proof)
  const signature = challengeBody.signature
  const key = createHash('sha256').update(credential.device_token).digest()
  const expected = createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex')
  const validSignature = typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)
    && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  const signedAddress = typeof payload.server_address === 'string' ? payload.server_address.toLowerCase().replace(/^::ffff:/, '') : ''
  const expectedPort = Number(address.port || (address.protocol === 'https:' ? 443 : 80))
  const fingerprint = typeof endpoint.fingerprint === 'string' ? endpoint.fingerprint.replace(/[^a-f0-9]/gi, '').toLowerCase() : null
  const proofFingerprint = typeof payload.server_fingerprint === 'string' ? payload.server_fingerprint.replace(/[^a-f0-9]/gi, '').toLowerCase() : null
  const exactLoopback = address.protocol === 'http:' && (host.toLowerCase() === 'localhost'
    ? ['127.0.0.1', '::1'].includes(signedAddress)
    : signedAddress === host.toLowerCase())
  const endpointPinMatches = address.protocol === 'https:' ? proofFingerprint === fingerprint : payload.server_fingerprint === null
  if (challenge.status !== 200 || !validSignature || payload.client_nonce !== nonce || payload.device_id !== credential.device_id || payload.authority_id !== current.authority_id || payload.business_id !== current.business_id || payload.outlet_id !== current.outlet_id || payload.server_port !== expectedPort || !endpointPinMatches || address.protocol === 'http:' && !exactLoopback) refuse('The selected server did not prove possession of this Bar’s replicated device secret at this endpoint. No PIN or device credential was sent.')
  let token = null, sessionId = null
  try {
    const response = await exchange('POST', '/v1/sessions', { deviceToken: credential.device_token, body: { staff_id: request.staff_id, pin: request.pin, outlet_id: current.outlet_id } })
    const body = object(response.body), staff = object(body.staff), device = object(body.device)
    token = typeof body.session_token === 'string' ? body.session_token : null
    sessionId = body.session_id
    if (response.status !== 201 || !token || token.length < 20 || staff.role !== 'owner' || staff.staff_id !== request.staff_id || device.device_id !== credential.device_id || body.business_id !== current.business_id || body.outlet_id !== current.outlet_id || !Number.isSafeInteger(body.authority_epoch) || body.authority_epoch <= current.authority_epoch) refuse('The replacement did not authenticate this Bar owner, original device and a newer authority epoch. The saved profile was not changed.')
    const proof = await exchange('GET', '/v1/admin/replacement', { sessionToken: token, deviceId: credential.device_id })
    const identity = object(object(proof.body).replacement)
    if (proof.status !== 200 || identity.authority_id !== current.authority_id || identity.business_id !== current.business_id || identity.authority_epoch !== body.authority_epoch || identity.promoted_epoch !== body.authority_epoch || identity.fenced !== false || identity.in_recovery !== false) refuse('This server is not the promoted, unfenced copy of your original Bar. No profile or saved operation was changed.')
    return { authority_epoch: body.authority_epoch }
  } finally {
    if (token && sessionId) await exchange('POST', '/v1/sessions/revoke', { sessionToken: token, deviceId: credential.device_id, body: { session_id: sessionId } }).catch(() => {})
  }
}
