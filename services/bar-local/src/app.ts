import { createHmac, randomBytes, randomInt, randomUUID, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import {
  BAR_LOCAL_ERROR_CODES,
  BarLocalError,
  enumeration,
  getCommand,
  keys,
  object,
  optionalString,
  optionalUuid,
  pin as validatePin,
  safeEqualHex,
  sha256Hex,
  string,
  uuid,
  validateEnvelope,
  validateEventFeed,
  validateOperationStatus,
  validateQueryEnvelope,
  validateQueryResult,
  validateReadiness
} from '@tsa-bonno/bar-contracts'
import type { Payload } from '@tsa-bonno/bar-contracts'
import { approvalHashFor, executeCommand } from './commands.js'
import { callFunction, query } from './db.js'
import type { JsonRecord } from './db.js'
import { dummyPinVerify, hashPin, verifyPin, verifyPinAsync } from './pin.js'
import {
  applyCors, bearerToken, correlationId, deviceIdHeader, deviceTokenHeader,
  isLoopbackRequest, readJson, sendError, sendJson
} from './http.js'
import type { JsonObject } from './http.js'
import { createRateLimiter } from './rate-limit.js'
import type { RateLimiter } from './rate-limit.js'
import type { ServiceConfig } from './config.js'
import { createAdminHandler } from './admin.js'
import type { CloudSyncController } from './operations/cloudSync.js'
import type { FailoverController } from './operations/failover.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMEZONE_RE = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/
const CURRENCY_RE = /^[A-Z]{3}$/

export interface AppLogger {
  info?(record: JsonRecord): void
  error?(record: JsonRecord): void
}

export interface AppOptions {
  config: ServiceConfig
  pool: Pool
  logger?: AppLogger | null
  cloudSync?: CloudSyncController | null
  failover?: FailoverController | null
  requestRestart?: (() => void) | null
}

type AppContext = AppOptions

interface SessionContext {
  device_id: string
  business_id: string
  outlet_id: string
  staff_id: string
  role: string
  capabilities: string[]
  display_name: string
}

interface AuthContext {
  token: string
  tokenHash: string
  deviceId: string
  context: SessionContext
}

interface StaffRecord {
  id: string
  display_name: string
  role: string
  capabilities: string[]
  pin_hash: string
  pin_salt: string
  pin_iterations: number
  status: string
  locked_until: string | null
}

interface DeviceRecord {
  device_id: string
  business_id: string
  outlet_id: string
  name: string
  platform: string
  status: string
}

interface SessionRecord {
  session_id: string
  expires_at: string
  authority_epoch: number
}

interface PairingRecord {
  device_id: string
  expires_in?: number
}

interface ApprovalRecord {
  approval_id: string
  expires_in: number
}

function signatureValue(error: unknown, key: 'code' | 'message' | 'cause'): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function setupFingerprint(config: ServiceConfig): string | null {
  if (!config.http.tls) return null
  try {
    const certificate = new X509Certificate(readFileSync(config.http.tls.certFile))
    return certificate.fingerprint256.replaceAll(':', '').toLowerCase()
  } catch {
    return null
  }
}

function tokenHash(token: string): string {
  return sha256Hex(token)
}

function newSessionToken(): string {
  return `bls_${randomBytes(32).toString('base64url')}`
}

function newDeviceToken(): string {
  return `bld_${randomBytes(32).toString('base64url')}`
}

function pairingCode(): string {
  return String(randomInt(0, 100000000)).padStart(8, '0')
}

function normalizeStaff(staff: StaffRecord): JsonRecord {
  return {
    staff_id: staff.id,
    display_name: staff.display_name,
    role: staff.role,
    capabilities: staff.capabilities
  }
}

async function authenticate(ctx: AppContext, req: IncomingMessage): Promise<AuthContext> {
  const token = bearerToken(req)
  const deviceId = deviceIdHeader(req)
  if (!token || !deviceId) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_REQUIRED, 'A bearer session token and X-Bar-Device-Id header are required.', { httpStatus: 401 })
  }
  if (!UUID_RE.test(deviceId)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The device header is not a valid identity.', { httpStatus: 401 })
  }
  const result = await query(ctx.pool, 'SELECT to_jsonb(bar_local.service_session($1,$2)) AS result', [tokenHash(token), deviceId])
  const context = result.rows[0]?.result as SessionContext | undefined
  if (!context) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The local session is invalid.', { httpStatus: 401 })
  }
  return {
    token,
    tokenHash: tokenHash(token),
    deviceId,
    context
  }
}

async function loadStaff(pool: Pool, businessId: string, staffId: string): Promise<StaffRecord | null> {
  return callFunction<StaffRecord>(pool, 'bar_local.service_staff', [
    { value: businessId, cast: 'uuid' },
    { value: staffId, cast: 'uuid' }
  ])
}

function lockDetails(staff: StaffRecord | null): { locked_until: string; retry_after_seconds: number } | null {
  const lockedUntil = staff?.locked_until ? new Date(staff.locked_until) : null
  if (!lockedUntil || Number.isNaN(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) return null
  return {
    locked_until: lockedUntil.toISOString(),
    retry_after_seconds: Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000))
  }
}

function assertNotLocked(staff: StaffRecord | null): void {
  const details = lockDetails(staff)
  if (details) {
    throw new BarLocalError('ACCOUNT_LOCKED', 'This operator is temporarily locked after repeated credential failures.', {
      httpStatus: 429,
      details
    })
  }
}

async function recordLoginOutcome(pool: Pool, staffId: string, success: boolean): Promise<void> {
  await callFunction(pool, 'bar_local.service_login_outcome', [
    { value: staffId, cast: 'uuid' },
    { value: success }
  ])
}

async function resolveApprover(ctx: AppContext,auth: AuthContext,pin: string,capability: string,staffId: string|null): Promise<StaffRecord> {
  const candidates=await callFunction<StaffRecord[]>(ctx.pool,'bar_local.service_approval_candidates',[
    {value:auth.tokenHash},{value:auth.deviceId,cast:'uuid'},{value:capability},{value:staffId,cast:'uuid'}
  ])??[]
  if(candidates.length>128)throw new BarLocalError('APPROVAL_INVALID','This business requires a named approver selection; PIN-only lookup is limited to 128 eligible identities.',{httpStatus:409})
  const matches: StaffRecord[]=[]
  for(let offset=0;offset<candidates.length;offset+=4){
    const group=await Promise.all(candidates.slice(offset,offset+4).map(async staff=>({staff,valid:await verifyPinAsync(pin,staff)})))
    for(const item of group)if(item.valid)matches.push(item.staff)
  }
  if(candidates.length===0)await verifyPinAsync(pin,{pin_hash:'00'.repeat(32),pin_salt:'5a'.repeat(16),pin_iterations:ctx.config.security.pinIterations})
  if(matches.length!==1){
    if(staffId&&candidates.length===1)await recordLoginOutcome(ctx.pool,candidates[0]!.id,false)
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID,
      matches.length>1?'More than one operator uses this PIN. Authorised approvers need distinct PINs or an explicit named approval.':'No active authorised approver matched that PIN.',{httpStatus:401})
  }
  const staff=matches[0]!
  assertNotLocked(staff)
  if(!staff.capabilities.includes(capability))throw new BarLocalError(BAR_LOCAL_ERROR_CODES.CAPABILITY_DENIED,'This operator cannot approve this action.',{httpStatus:403})
  await recordLoginOutcome(ctx.pool,staff.id,true)
  return staff
}

function clientKey(req: IncomingMessage): string {
  return `${req.socket.remoteAddress || 'unknown'}`
}

export function createApp(options: AppOptions) {
  const { config, pool, logger = null, cloudSync = null, failover = null } = options
  const fingerprint = setupFingerprint(config)
  const setupLimiter: RateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })
  const handleAdmin = createAdminHandler(authenticate, { cloudSync, failover, requestRestart: options.requestRestart })
  const sessionLimiter: RateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 })
  const replacementChallengeLimiter: RateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 })
  const pairingLimiter: RateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 })
  const approvalLimiter: RateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 })

  async function setupOwner(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (!isLoopbackRequest(req)) {
      throw new BarLocalError('SETUP_LOCAL_ONLY', 'First-owner commissioning is only available from the local machine.', { httpStatus: 403 })
    }
    if (!config.setupSecret) {
      throw new BarLocalError('SETUP_UNAVAILABLE', 'No local setup secret is provisioned on this service.', { httpStatus: 503 })
    }
    setupLimiter.check(clientKey(req))
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', [
      'setup_secret', 'provisioning_id', 'device_token', 'business_name', 'outlet_name', 'owner_name', 'pin',
      'currency', 'timezone', 'device_name', 'device_platform', 'business_profile'
    ])
    const setupSecret = string(body.setup_secret, 'setup_secret', { min: 16, max: 200 })
    const provisioningId = uuid(body.provisioning_id, 'provisioning_id')
    const deviceToken = string(body.device_token, 'device_token', { min: 40, max: 100, pattern: /^bld_[A-Za-z0-9_-]+$/ })
    const businessName = string(body.business_name, 'business_name', { min: 1, max: 200, trim: true })
    const outletName = string(body.outlet_name, 'outlet_name', { min: 1, max: 120, trim: true })
    const ownerName = string(body.owner_name, 'owner_name', { min: 1, max: 120, trim: true })
    const ownerPin = validatePin(body.pin)
    const currency = body.currency === undefined ? 'BWP' : string(body.currency, 'currency', { min: 3, max: 3, pattern: CURRENCY_RE })
    const timezone = body.timezone === undefined ? 'Africa/Gaborone' : string(body.timezone, 'timezone', { min: 1, max: 80, pattern: TIMEZONE_RE })
    const deviceName = string(body.device_name, 'device_name', { min: 1, max: 120, trim: true })
    const devicePlatform = body.device_platform === undefined
      ? 'modern'
      : enumeration(body.device_platform, 'device_platform', ['modern', 'legacy'])
    const rawBusinessProfile = body.business_profile === undefined ? {} : object(body.business_profile, 'business_profile')
    keys(rawBusinessProfile, 'business_profile', ['company_name', 'address', 'city', 'country', 'phone', 'email', 'website', 'vat_number'])
    const businessProfile: Record<string, string> = {}
    for (const [field, max] of Object.entries({ company_name: 200, address: 240, city: 120, country: 120, phone: 80, email: 254, website: 240, vat_number: 80 })) {
      if (rawBusinessProfile[field] !== undefined) businessProfile[field] = string(rawBusinessProfile[field], `business_profile.${field}`, { min: 0, max, trim: true })
    }
    if (!safeEqualHex(sha256Hex(setupSecret), sha256Hex(config.setupSecret))) {
      throw new BarLocalError('SETUP_SECRET_INVALID', 'The local setup secret is invalid.', { httpStatus: 401 })
    }
    const authorityId = randomUUID()
    const businessId = randomUUID()
    const outletId = randomUUID()
    const verifier = hashPin(ownerPin, config.security.pinIterations)
    const requestHash = sha256Hex(JSON.stringify([
      setupSecret, businessName, outletName, ownerName,
      sha256Hex(`${deviceToken}:${ownerPin}`), currency, timezone, deviceName,
      devicePlatform, config.http.tls ? fingerprint : null, businessProfile
    ]))
    const result = await callFunction<JsonRecord>(pool, 'bar_local.commission_owner_profile_recoverable', [
      { value: provisioningId, cast: 'uuid' },
      { value: requestHash },
      { value: tokenHash(deviceToken) },
      { value: authorityId, cast: 'uuid' },
      { value: businessId, cast: 'uuid' },
      { value: outletId, cast: 'uuid' },
      { value: businessName },
      { value: outletName },
      { value: ownerName },
      { value: verifier.pin_hash },
      { value: verifier.pin_salt },
      { value: verifier.pin_iterations },
      { value: sha256Hex(setupSecret) },
      { value: currency },
      { value: timezone },
      { value: deviceName },
      { value: devicePlatform },
      { value: fingerprint },
      { value: JSON.stringify(businessProfile), cast: 'jsonb' }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no commissioning result.', { httpStatus: 500 })
    }
    setupLimiter.reset()
    sendJson(res, 201, {
      ok: true,
      outcome: 'commissioned_local',
      ...result,
      // The raw device credential is supplied and durably staged by the
      // client before dispatch; never return it from the service.
      cloud_status: 'integration_disabled'
    }, id)
  }

  async function replacementChallenge(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    replacementChallengeLimiter.check(clientKey(req))
    const body = await readJson(req, { limitBytes: 4096 })
    keys(body, 'body', ['device_id', 'client_nonce'])
    const deviceId = uuid(body.device_id, 'device_id')
    const clientNonce = string(body.client_nonce, 'client_nonce', { min: 64, max: 64, pattern: /^[a-f0-9]{64}$/i })
    const record = await callFunction<JsonRecord>(ctx.pool, 'bar_local.service_replacement_challenge', [
      { value: deviceId, cast: 'uuid' }
    ])
    const tokenHash = typeof record?.token_hash === 'string' ? record.token_hash : ''
    if (!record || !/^[a-f0-9]{64}$/.test(tokenHash) || record.device_status !== 'active') {
      throw new BarLocalError('REPLACEMENT_NOT_VERIFIED', 'This till is not an active device on this Bar.', { httpStatus: 404 })
    }
    const authorityEpoch = record.authority_epoch
    if (record.fenced !== false || record.in_recovery !== false || typeof authorityEpoch !== 'number'
        || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 1 || record.promoted_epoch !== authorityEpoch) {
      throw new BarLocalError('REPLACEMENT_NOT_VERIFIED', 'This Bar copy is not the promoted, unfenced active authority.', { httpStatus: 409 })
    }
    const socketAddress = String(req.socket.localAddress || '').toLowerCase().replace(/^::ffff:/, '')
    const socketPort = Number(req.socket.localPort)
    if (isIP(socketAddress) === 0 || !Number.isInteger(socketPort) || socketPort < 1 || socketPort > 65535) {
      throw new BarLocalError('REPLACEMENT_NOT_VERIFIED', 'The service could not bind this challenge to its listening endpoint.', { httpStatus: 503 })
    }
    const proof = {
      client_nonce: clientNonce,
      device_id: record.device_id,
      authority_id: record.authority_id,
      business_id: record.business_id,
      outlet_id: record.outlet_id,
      server_address: socketAddress,
      server_port: socketPort,
      server_fingerprint: fingerprint
    }
    const signature = createHmac('sha256', Buffer.from(tokenHash, 'hex')).update(JSON.stringify(proof), 'utf8').digest('hex')
    sendJson(res, 200, { ok: true, proof, signature }, id)
  }

  async function createSession(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    sessionLimiter.check(clientKey(req))
    const rawDeviceToken = deviceTokenHeader(req)
    if (!rawDeviceToken || rawDeviceToken.length < 20 || rawDeviceToken.length > 200) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_REQUIRED, 'A paired device token is required to start a session.', { httpStatus: 401 })
    }
    const device = await callFunction<DeviceRecord>(pool, 'bar_local.service_device', [{ value: tokenHash(rawDeviceToken) }])
    if (!device) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'This device is not paired with the local authority.', { httpStatus: 401 })
    }
    if (device.status !== 'active') {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.DEVICE_REVOKED, 'This device has been revoked.', { httpStatus: 401 })
    }
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['staff_id', 'pin', 'outlet_id'])
    const staffId = uuid(body.staff_id, 'staff_id')
    const suppliedPin = validatePin(body.pin)
    const outletId = body.outlet_id === undefined ? device.outlet_id : uuid(body.outlet_id, 'outlet_id')
    const staff = await loadStaff(pool, device.business_id, staffId)
    if (!staff || staff.status !== 'active') {
      dummyPinVerify(suppliedPin, config.security.pinIterations)
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The operator credential is invalid.', { httpStatus: 401 })
    }
    assertNotLocked(staff)
    if (!verifyPin(suppliedPin, staff)) {
      await recordLoginOutcome(pool, staff.id, false)
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The operator credential is invalid.', { httpStatus: 401 })
    }
    await recordLoginOutcome(pool, staff.id, true)
    const sessionToken = newSessionToken()
    const session = await callFunction<SessionRecord>(pool, 'bar_local.service_create_session', [
      { value: staffId, cast: 'uuid' },
      { value: device.device_id, cast: 'uuid' },
      { value: outletId, cast: 'uuid' },
      { value: tokenHash(sessionToken) },
      { value: config.security.sessionTtlSeconds }
    ])
    if (!session) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no session.', { httpStatus: 500 })
    }
    sendJson(res, 201, {
      ok: true,
      session_token: sessionToken,
      session_id: session.session_id,
      expires_at: session.expires_at,
      authority_epoch: session.authority_epoch,
      business_id: device.business_id,
      outlet_id: outletId,
      device: { device_id: device.device_id, name: device.name, platform: device.platform },
      staff: normalizeStaff(staff)
    }, id)
  }

  async function refreshSession(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const sessionToken = newSessionToken()
    const result = await callFunction<SessionRecord>(pool, 'bar_local.service_refresh_session', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: tokenHash(sessionToken) },
      { value: config.security.sessionTtlSeconds }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no refreshed session.', { httpStatus: 500 })
    }
    sendJson(res, 200, {
      ok: true,
      session_token: sessionToken,
      expires_at: result.expires_at,
      authority_epoch: result.authority_epoch
    }, id)
  }

  async function revokeSession(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['session_id'])
    const sessionId = uuid(body.session_id, 'session_id')
    await callFunction(pool, 'bar_local.service_revoke_session', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: sessionId, cast: 'uuid' }
    ])
    sendJson(res, 200, { ok: true, outcome: 'session_revoked', session_id: sessionId }, id)
  }

  async function listDevices(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const devices = await callFunction<JsonRecord[]>(pool, 'bar_local.service_devices', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' }
    ])
    sendJson(res, 200, { ok: true, devices: devices ?? [] }, id)
  }

  async function revokeDevice(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['device_id'])
    const targetDeviceId = uuid(body.device_id, 'device_id')
    if (targetDeviceId === auth.deviceId) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'A device cannot revoke itself. Sign out instead.')
    }
    await callFunction(pool, 'bar_local.service_revoke_device', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: targetDeviceId, cast: 'uuid' }
    ])
    sendJson(res, 200, { ok: true, outcome: 'device_revoked', device_id: targetDeviceId }, id)
  }

  async function startPairing(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['ttl_seconds'])
    const ttl = body.ttl_seconds === undefined
      ? config.security.pairingTtlSeconds
      : Number(body.ttl_seconds)
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 900) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'ttl_seconds must be an integer between 60 and 900.')
    }
    const code = pairingCode()
    const result = await callFunction<{ expires_in: number }>(pool, 'bar_local.service_create_pairing_code', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: tokenHash(code) },
      { value: ttl }
    ])
    sendJson(res, 201, {
      ok: true,
      pairing_code: code,
      expires_in: result?.expires_in ?? ttl,
      server_certificate_fingerprint: fingerprint
    }, id)
  }

  async function completePairing(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    pairingLimiter.check(clientKey(req))
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['provisioning_id', 'device_token', 'pairing_code', 'name', 'platform', 'certificate_fingerprint'])
    const provisioningId = uuid(body.provisioning_id, 'provisioning_id')
    const deviceToken = string(body.device_token, 'device_token', { min: 40, max: 100, pattern: /^bld_[A-Za-z0-9_-]+$/ })
    const code = string(body.pairing_code, 'pairing_code', { min: 6, max: 12, pattern: /^\d+$/ })
    const name = string(body.name, 'name', { min: 1, max: 120, trim: true })
    const platform = body.platform === undefined ? 'modern' : enumeration(body.platform, 'platform', ['modern', 'legacy'])
    const certificateFingerprint = optionalString(body.certificate_fingerprint, 'certificate_fingerprint', { max: 200, trim: true })
    const requestHash = sha256Hex(JSON.stringify([code, name, platform, certificateFingerprint ?? null]))
    const result = await callFunction<PairingRecord>(pool, 'bar_local.service_complete_pairing_recoverable', [
      { value: provisioningId, cast: 'uuid' },
      { value: requestHash },
      { value: tokenHash(deviceToken) },
      { value: tokenHash(code) },
      { value: name },
      { value: platform },
      { value: certificateFingerprint }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no paired device.', { httpStatus: 500 })
    }
    sendJson(res, 201, {
      ok: true,
      outcome: 'device_paired',
      ...result,
      server_certificate_fingerprint: fingerprint
    }, id)
  }

  function requireWriteAuthority(): void {
    // The in-process gate is the fast half of the fencing contract: it stops new
    // commands the instant the witness lease is lost, before the database fence
    // is even attempted. The database fence remains authoritative for anything
    // already in flight.
    if (!failover || failover.gate.allowWrites()) return
    throw new BarLocalError(
      BAR_LOCAL_ERROR_CODES.AUTHORITY_FENCED,
      'This Bar authority is not allowed to write right now. Trading stays stopped until failover verification completes; do not start a new sale on another till and expect it to commit here.',
      {
        httpStatus: 503,
        details: { gate_reason: failover.gate.reason() }
      }
    )
  }

  async function createApproval(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    requireWriteAuthority()
    const auth = await authenticate(ctx, req)
    approvalLimiter.check(`${auth.context.business_id}:${auth.deviceId}`)
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['operation', 'capability', 'pin', 'target_type', 'target_id','approver_staff_id'])
    const operation = validateEnvelope(object(body.operation, 'operation'))
    if (operation.device_id !== auth.deviceId) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID, 'The authenticated device does not match the approval operation.', { httpStatus: 401 })
    }
    const command = getCommand(operation.command)
    if (!command?.approval) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'This command does not accept a manager approval.')
    }
    const capability = string(body.capability, 'capability', { min: 1, max: 60 })
    if (capability !== command.approval) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `This command requires the ${command.approval} approval capability.`)
    }
    const suppliedPin = validatePin(body.pin)
    const approver=await resolveApprover(ctx,auth,suppliedPin,capability,optionalUuid(body.approver_staff_id,'approver_staff_id'))
    const targetType = body.target_type === undefined ? 'operation' : string(body.target_type, 'target_type', { min: 1, max: 60 })
    const targetId = optionalUuid(body.target_id, 'target_id')
    const operationHash = approvalHashFor(operation)
    let approvalTokenHash=auth.tokenHash
    let temporarySession: SessionRecord|null=null
    let result: ApprovalRecord|null=null
    try{
      if(approver.id!==auth.context.staff_id){
        approvalTokenHash=tokenHash(newSessionToken())
        temporarySession=await callFunction<SessionRecord>(pool,'bar_local.service_create_session',[
          {value:approver.id,cast:'uuid'},{value:auth.deviceId,cast:'uuid'},
          {value:auth.context.outlet_id,cast:'uuid'},{value:approvalTokenHash},{value:60}
        ])
        if(!temporarySession)throw new BarLocalError(BAR_LOCAL_ERROR_CODES.AUTH_INVALID,'The approving operator could not be authenticated.',{httpStatus:401})
      }
      result = await callFunction<ApprovalRecord>(pool, 'bar_local.service_create_approval', [
      { value: approvalTokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: approver.id, cast: 'uuid' },
      { value: capability },
      { value: operationHash },
      { value: targetType },
      { value: targetId, cast: 'uuid' },
      { value: 300 }
    ])
    }finally{
      if(temporarySession){
        try{await callFunction(pool,'bar_local.service_revoke_session',[
          {value:approvalTokenHash},{value:auth.deviceId,cast:'uuid'},{value:temporarySession.session_id,cast:'uuid'}
        ])}catch{logger?.error?.({event:'approval_session_cleanup_failed',device_id:auth.deviceId,staff_id:approver.id})}
      }
    }
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no approval.', { httpStatus: 500 })
    }
    sendJson(res, 201, {
      ok: true,
      approval_id: result.approval_id,
      expires_in: result.expires_in,
      operation_hash: operationHash
    }, id)
  }

  async function submitCommand(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    requireWriteAuthority()
    const auth = await authenticate(ctx, req)
    const envelope = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    const result = await executeCommand({
      pool,
      config,
      tokenHash: auth.tokenHash,
      deviceId: auth.deviceId,
      envelope
    })
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no command receipt.', { httpStatus: 500 })
    }
    // Keep the top-level correlation identical to the persisted receipt.
    // Legacy verifies both; returning only receipt.operation_id made genuine
    // committed trades appear uncertain to the production Legacy client.
    const outcome = typeof result === 'object' && result !== null && 'outcome' in result
      ? (result as { outcome?: unknown }).outcome
      : undefined
    if (cloudSync && envelope.command === 'cashup.submit' && outcome === 'committed_local') {
      // Cash-up has already committed locally. The final upload is a hint that
      // must never delay or fail the cashier's committed result.
      cloudSync.requestFinalSync('cashup.submit')
    }
    sendJson(res, 200, { ...result, operation_id: envelope.operation_id }, id)
  }

  async function submitQuery(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string, queryName: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const body = await readJson(req, { limitBytes: config.http.bodyLimitBytes })
    keys(body, 'body', ['contract_version', 'authority_id', 'authority_epoch', 'query', 'query_version', 'filters'])
    if (body.query !== undefined && body.query !== queryName) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The query name in the body does not match the request path.')
    }
    const envelope = validateQueryEnvelope({
      contract_version: body.contract_version,
      authority_id: body.authority_id,
      authority_epoch: body.authority_epoch,
      query: queryName,
      query_version: body.query_version ?? 1,
      filters: body.filters ?? {}
    })
    const result = await callFunction<JsonRecord>(pool, 'bar_local.query_dispatch', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: envelope.authority_id, cast: 'uuid' },
      { value: envelope.authority_epoch },
      { value: envelope.query },
      { value: JSON.stringify(envelope.filters), cast: 'jsonb' }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no query result.', { httpStatus: 500 })
    }
    const validated = validateQueryResult(result)
    sendJson(res, 200, { ...validated, ok: true, query: envelope.query }, id)
  }

  async function eventFeed(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string, url: URL): Promise<void> {
    const auth = await authenticate(ctx, req)
    const afterRaw = url.searchParams.get('after') ?? '0'
    if (!/^\d{1,19}$/.test(afterRaw)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'after must be a non-negative commit sequence.')
    }
    const limitRaw = url.searchParams.get('limit') ?? '200'
    if (!/^\d{1,4}$/.test(limitRaw)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'limit must be an integer between 1 and 1000.')
    }
    const limit = Number.parseInt(limitRaw, 10)
    if (limit < 1 || limit > 1000) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'limit must be an integer between 1 and 1000.')
    }
    const result = await callFunction<JsonRecord>(pool, 'bar_local.service_events', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: afterRaw, cast: 'bigint' },
      { value: limit }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no event feed.', { httpStatus: 500 })
    }
    const validated = validateEventFeed(result)
    sendJson(res, 200, { ...validated, ok: true }, id)
  }

  async function operationStatus(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string, operationId: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    if (!UUID_RE.test(operationId)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.OPERATION_NOT_FOUND, 'No local operation receipt exists for this identifier.', { httpStatus: 404 })
    }
    const result = await callFunction<JsonRecord>(pool, 'bar_local.service_operation_status', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' },
      { value: operationId, cast: 'uuid' }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no operation status.', { httpStatus: 500 })
    }
    const validated = validateOperationStatus(result)
    sendJson(res, 200, { ...validated, ok: true }, id)
  }

  async function readiness(ctx: AppContext, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const auth = await authenticate(ctx, req)
    const result = await callFunction<JsonRecord>(pool, 'bar_local.service_readiness', [
      { value: auth.tokenHash },
      { value: auth.deviceId, cast: 'uuid' }
    ])
    if (!result) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local authority returned no readiness result.', { httpStatus: 500 })
    }
    const validated = validateReadiness(result)
    sendJson(res, validated.ready ? 200 : 503, { ...validated, ok: validated.ready }, id)
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = correlationId(req)
    const started = Date.now()
    res.on('finish', () => {
      logger?.info?.({
        method: req.method,
        path: (req.url || '').split('?')[0],
        status: res.statusCode,
        duration_ms: Date.now() - started,
        correlation_id: id
      })
    })
    if (!applyCors(req, res, config.http.allowedOrigins)) {
      sendJson(res, 403, { ok: false, code: 'ORIGIN_DENIED', message: 'This origin is not allowed.', correlation_id: id }, id)
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const ctx: AppContext = { config, pool, logger }
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname
      if (config.training) {
        res.setHeader('X-Bar-Training', 'practice-only')
        if (pathname.startsWith('/v1/admin/recovery') || pathname.startsWith('/v1/admin/cloud-sync') || pathname.startsWith('/v1/admin/update')
            || pathname.startsWith('/v1/admin/replication') || pathname.startsWith('/v1/admin/failover')
            || pathname.startsWith('/v1/pairing') || pathname.startsWith('/v1/replacement')) {
          sendJson(res, 403, { ok: false, code: 'TRAINING_ISOLATION', message: 'Practice mode cannot upload, update live software, pair other tills or change live server membership.' }, id)
          return
        }
      }
      if (req.method === 'GET' && pathname === '/v1/health/live') {
        sendJson(res, 200, { ok: true, status: 'live', service: 'bar-local', version: config.service.version, training_instance_id: config.training?.instanceId ?? null }, id)
        return
      }
      if (req.method === 'GET' && pathname === '/v1/health/ready') {
        await readiness(ctx, req, res, id)
        return
      }
      if (req.method === 'GET' && pathname === '/v1/events') {
        await eventFeed(ctx, req, res, id, url)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/setup/owner') {
        await setupOwner(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/replacement/challenge') {
        await replacementChallenge(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/sessions') {
        await createSession(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/sessions/refresh') {
        await refreshSession(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/sessions/revoke') {
        await revokeSession(ctx, req, res, id)
        return
      }
      if (req.method === 'GET' && pathname === '/v1/devices') {
        await listDevices(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/devices/revoke') {
        await revokeDevice(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/pairing/start') {
        await startPairing(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/pairing/complete') {
        await completePairing(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/approvals') {
        await createApproval(ctx, req, res, id)
        return
      }
      if (req.method === 'POST' && pathname === '/v1/commands') {
        await submitCommand(ctx, req, res, id)
        return
      }
      const queryMatch = /^\/v1\/queries\/([a-z][a-z0-9._]*)$/.exec(pathname)
      if (req.method === 'POST' && queryMatch) {
        await submitQuery(ctx, req, res, id, queryMatch[1])
        return
      }
      const operationMatch = /^\/v1\/operations\/([0-9a-fA-F-]+)$/.exec(pathname)
      if (req.method === 'GET' && operationMatch) {
        await operationStatus(ctx, req, res, id, operationMatch[1])
        return
      }
      if (await handleAdmin(ctx, req, res, id, url)) return
      sendJson(res, 404, { ok: false, code: 'ROUTE_NOT_FOUND', message: 'No such local Bar service route.', correlation_id: id }, id)
    } catch (error) {
      const code = signatureValue(error, 'code')
      const message = signatureValue(error, 'message')
      const cause = signatureValue(error, 'cause')
      logger?.error?.({
        correlation_id: id,
        code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
        message: typeof message === 'string' ? message : 'Unknown local Bar service error.',
        cause: typeof cause === 'object' && cause !== null
          ? signatureValue(cause, 'message') ?? signatureValue(cause, 'code')
          : undefined
      })
      sendError(res, error, id)
    }
  }

  return handler
}
