import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const ROLES = ['single_host', 'client', 'replica', 'voter'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type NetworkRole = (typeof ROLES)[number]
export type InternetState = 'available' | 'unavailable' | 'unknown'
const INTERNET_STATES = ['available', 'unavailable', 'unknown'] as const

export class NetworkStatusError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'NetworkStatusError'
    this.code = code
  }
}

export interface AuthoritySnapshot {
  readonly authority_id: string
  readonly authority_epoch: string
  readonly business_id: string
  readonly commissioned_at?: string | null
  readonly database?: string | null
}

export interface CapabilityEvidence {
  readonly coordinator?: {
    readonly verified: boolean
    readonly provider?: string | null
    readonly evidenceRef?: string | null
  }
  readonly replication?: {
    readonly verified: boolean
    readonly mode?: string | null
    readonly evidenceRef?: string | null
  }
  readonly externalHardware?: {
    readonly verified: boolean
    readonly evidenceRef?: string | null
  }
  /** Witness-gated automatic failover evidence. Only set from live lease
   *  evidence, never from configuration alone. */
  readonly automaticFailover?: {
    readonly verified: boolean
    readonly evidenceRef?: string | null
  }
}

export interface ServiceProbeReport {
  readonly requested: boolean
  readonly url: string | null
  readonly reachable: boolean
  readonly live: boolean
  readonly status_code: number | null
  readonly service_version: string | null
  readonly readiness: 'auth_required' | 'ready' | 'not_ready' | 'unverified' | 'not_configured'
  readonly readiness_status_code: number | null
  readonly error: string | null
}

export interface TlsCertificateReport {
  readonly enabled: boolean
  readonly certificate_file: string | null
  readonly fingerprint_sha256: string | null
  readonly subject: string | null
  readonly issuer: string | null
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly expired: boolean | null
}

export interface NetworkStatusOptions {
  readonly role: NetworkRole
  readonly bindHost: string
  readonly port: number
  readonly tlsCertFile?: string | null
  readonly serviceUrl?: string | null
  readonly serviceCaFile?: string | null
  readonly probeTimeoutMs?: number
  readonly authority?: AuthoritySnapshot | null
  readonly database?: { readonly reachable: boolean; readonly error?: string | null; readonly name?: string | null } | null
  readonly evidence?: CapabilityEvidence | null
  readonly internetState?: InternetState | null
  readonly now?: Date
}

export interface WriteAuthorityReport {
  readonly role: NetworkRole
  readonly granted: boolean
  readonly basis: string
  readonly blockers: readonly string[]
  readonly internet_state: InternetState
  readonly internet_influences_authority: false
}

export interface ResolveWriteAuthorityOptions {
  readonly role: NetworkRole
  readonly authority?: AuthoritySnapshot | null
  readonly databaseReachable: boolean
  readonly databaseName?: string | null
  readonly service?: {
    readonly requested: boolean
    readonly reachable: boolean
    readonly live: boolean
    readonly readiness: ServiceProbeReport['readiness']
  } | null
  readonly internetState?: InternetState | null
}

export interface NetworkCapability {
  readonly status: 'verified' | 'unverified' | 'unavailable'
  readonly detail: string
  readonly evidence_ref: string | null
}

export interface NetworkStatusReport {
  readonly ok: true
  readonly command: 'network-status'
  readonly generated_at: string
  readonly role: NetworkRole
  readonly status: 'ok' | 'degraded' | 'unverified'
  readonly address: {
    readonly host: string
    readonly port: number
    readonly scope: 'loopback' | 'private' | 'wildcard' | 'public'
    readonly client_reachable: boolean
  }
  readonly tls: TlsCertificateReport
  readonly service: ServiceProbeReport
  readonly database: {
    readonly reachable: boolean
    readonly error: string | null
    readonly status: 'reachable' | 'unreachable' | 'not_checked'
  }
  readonly authority: AuthoritySnapshot | null
  readonly write_authority: WriteAuthorityReport
  readonly capabilities: {
    readonly coordinator: NetworkCapability
    readonly replication: NetworkCapability
    readonly external_hardware: NetworkCapability
    readonly automatic_failover: NetworkCapability
  }
  readonly limitations: readonly string[]
}

interface ProbeResponse {
  readonly statusCode: number
  readonly body: string
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '')
}

function isPrivateAddress(host: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (match) {
    const second = Number.parseInt(match[1], 10)
    return second >= 16 && second <= 31
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
}

export function classifyBindHost(host: string): 'loopback' | 'private' | 'wildcard' | 'public' {
  const normalized = normalizeHost(host)
  if (LOOPBACK_HOSTS.has(normalized)) return 'loopback'
  if (normalized === '0.0.0.0' || normalized === '::') return 'wildcard'
  if (isPrivateAddress(normalized)) return 'private'
  return 'public'
}

export function parseNetworkRole(value: unknown): NetworkRole {
  if (typeof value !== 'string' || !ROLES.includes(value as NetworkRole)) {
    throw new NetworkStatusError('NETWORK_ROLE_INVALID', `Network role must be one of: ${ROLES.join(', ')}.`)
  }
  return value as NetworkRole
}

export function parseInternetState(value: unknown): InternetState {
  if (value === undefined || value === null || value === '') return 'unknown'
  if (typeof value !== 'string' || !INTERNET_STATES.includes(value as InternetState)) {
    throw new NetworkStatusError('NETWORK_INTERNET_STATE_INVALID', 'Internet state must be one of: available, unavailable, unknown.')
  }
  return value as InternetState
}

export function resolveWriteAuthority(options: ResolveWriteAuthorityOptions): WriteAuthorityReport {
  const role = parseNetworkRole(options.role)
  const internetState = parseInternetState(options.internetState)
  const blockers: string[] = []
  let basis = 'no_local_write_authority'

  if (role === 'client') {
    basis = 'client_delegates_to_authority_server'
    blockers.push('CLIENT_ROLE_DELEGATES_WRITES: this host has no local Bar write authority and must send commands to the authoritative server.')
  } else if (role === 'replica' || role === 'voter') {
    basis = `${role}_role_has_no_write_authority`
    blockers.push(`${role.toUpperCase()}_ROLE_HAS_NO_WRITE_AUTHORITY: writes remain blocked until a reviewed, evidenced promotion and fencing procedure is completed.`)
  } else if (!options.authority) {
    basis = 'single_host_without_authority'
    blockers.push('AUTHORITY_IDENTITY_MISSING: no commissioned Bar authority identity is available on this host.')
  } else if (
    !UUID_RE.test(options.authority.authority_id)
    || !/^[1-9]\d*$/.test(options.authority.authority_epoch)
    || !UUID_RE.test(options.authority.business_id)
  ) {
    basis = 'single_host_with_incomplete_authority'
    blockers.push('AUTHORITY_IDENTITY_INCOMPLETE: the authority identity, positive epoch or business scope is missing or malformed.')
  } else if (!options.authority.commissioned_at) {
    basis = 'single_host_with_uncommissioned_authority'
    blockers.push('AUTHORITY_NOT_COMMISSIONED: the authority has no commissioning timestamp.')
  } else if (!options.databaseReachable) {
    basis = 'single_host_with_unreachable_database'
    blockers.push('AUTHORITY_DATABASE_UNREACHABLE: the authoritative database is not reachable.')
  } else if (options.databaseName && options.authority.database && options.databaseName !== options.authority.database) {
    basis = 'single_host_database_mismatch'
    blockers.push('AUTHORITY_DATABASE_MISMATCH: the connected database does not match the commissioned authority database.')
  } else if (!options.service || options.service.requested !== true) {
    basis = 'single_host_without_service_probe'
    blockers.push('AUTHORITY_SERVICE_UNVERIFIED: the local Bar service was not probed, so live authority cannot be proven.')
  } else if (!options.service.reachable || !options.service.live) {
    basis = 'single_host_with_unreachable_service'
    blockers.push('AUTHORITY_SERVICE_UNREACHABLE: the local Bar service is not reachable and live.')
  } else if (options.service.readiness !== 'ready' && options.service.readiness !== 'auth_required') {
    basis = 'single_host_with_unready_service'
    blockers.push('AUTHORITY_SERVICE_NOT_READY: the local Bar service readiness probe did not confirm a serving state.')
  } else {
    basis = 'single_host_commissioned_authority'
  }

  return {
    role,
    granted: blockers.length === 0,
    basis,
    blockers,
    internet_state: internetState,
    internet_influences_authority: false
  }
}

export async function certificateFingerprint(certFile: string): Promise<TlsCertificateReport> {
  const resolved = path.resolve(certFile)
  let pem: Buffer
  try {
    pem = await readFile(resolved)
  } catch {
    throw new NetworkStatusError('NETWORK_TLS_CERT_UNREADABLE', `The TLS certificate file could not be read: ${resolved}`)
  }
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(pem)
  } catch {
    throw new NetworkStatusError('NETWORK_TLS_CERT_INVALID', `The TLS certificate file is not a valid X.509 certificate: ${resolved}`)
  }
  return {
    enabled: true,
    certificate_file: resolved,
    fingerprint_sha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
    subject: certificate.subject,
    issuer: certificate.issuer,
    valid_from: certificate.validFrom,
    valid_to: certificate.validTo,
    expired: certificate.validToDate ? certificate.validToDate.getTime() <= Date.now() : null
  }
}

function requestOnce(url: URL, timeoutMs: number, caPem: Buffer | null): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json' },
      ...(url.protocol === 'https:' && caPem ? { ca: caPem, servername: url.hostname } : {})
    }
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requester(url, options, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= 65_536) chunks.push(chunk)
      })
      response.on('end', () => {
        resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.once('timeout', () => {
      request.destroy(new Error('probe timeout'))
    })
    request.once('error', reject)
    request.end()
  })
}

function serviceUrlFrom(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new NetworkStatusError('NETWORK_SERVICE_URL_INVALID', 'The service URL is invalid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NetworkStatusError('NETWORK_SERVICE_URL_INVALID', 'The service URL must use http or https.')
  }
  return url
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return 'probe failed'
  const code = typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : ''
  return code ? `${code}: ${error.message}` : error.message
}

export async function probeService(options: {
  serviceUrl: string
  timeoutMs?: number
  caFile?: string | null
}): Promise<ServiceProbeReport> {
  const url = serviceUrlFrom(options.serviceUrl)
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 2500, 30_000))
  let caPem: Buffer | null = null
  if (options.caFile) {
    try {
      caPem = await readFile(path.resolve(options.caFile))
    } catch {
      throw new NetworkStatusError('NETWORK_TLS_CA_UNREADABLE', 'The service CA/certificate file could not be read.')
    }
  }
  const liveUrl = new URL('/v1/health/live', url)
  const readyUrl = new URL('/v1/health/ready', url)
  let liveResponse: ProbeResponse
  try {
    liveResponse = await requestOnce(liveUrl, timeoutMs, caPem)
  } catch (error) {
    return {
      requested: true,
      url: url.toString(),
      reachable: false,
      live: false,
      status_code: null,
      service_version: null,
      readiness: 'unverified',
      readiness_status_code: null,
      error: errorText(error)
    }
  }
  let live = false
  let serviceVersion: string | null = null
  try {
    const parsed = JSON.parse(liveResponse.body) as Record<string, unknown>
    live = liveResponse.statusCode === 200 && parsed.status === 'live'
    serviceVersion = typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    live = false
  }
  let readiness: ServiceProbeReport['readiness'] = 'unverified'
  let readinessStatus: number | null = null
  try {
    const readyResponse = await requestOnce(readyUrl, timeoutMs, caPem)
    readinessStatus = readyResponse.statusCode
    if (readyResponse.statusCode === 200) readiness = 'ready'
    else if (readyResponse.statusCode === 401 || readyResponse.statusCode === 403) readiness = 'auth_required'
    else readiness = 'not_ready'
  } catch {
    readiness = 'unverified'
  }
  return {
    requested: true,
    url: url.toString(),
    reachable: true,
    live,
    status_code: liveResponse.statusCode,
    service_version: serviceVersion,
    readiness,
    readiness_status_code: readinessStatus,
    error: null
  }
}

function capability(
  evidence: { verified: boolean; evidenceRef?: string | null } | undefined,
  verifiedDetail: string,
  unverifiedDetail: string
): NetworkCapability {
  const evidenceRef = evidence?.evidenceRef?.trim()
  if (evidence?.verified === true && evidenceRef) {
    return { status: 'verified', detail: verifiedDetail, evidence_ref: evidenceRef }
  }
  return { status: 'unverified', detail: unverifiedDetail, evidence_ref: null }
}

export async function buildNetworkStatus(options: NetworkStatusOptions): Promise<NetworkStatusReport> {
  const role = parseNetworkRole(options.role)
  const host = options.bindHost?.trim()
  if (!host) {
    throw new NetworkStatusError('NETWORK_BIND_INVALID', 'A bind host is required.')
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new NetworkStatusError('NETWORK_BIND_INVALID', 'The service port must be an integer between 1 and 65535.')
  }
  const scope = classifyBindHost(host)
  const tls = options.tlsCertFile
    ? await certificateFingerprint(options.tlsCertFile)
    : {
        enabled: false,
        certificate_file: null,
        fingerprint_sha256: null,
        subject: null,
        issuer: null,
        valid_from: null,
        valid_to: null,
        expired: null
      }
  if (scope !== 'loopback' && !tls.enabled) {
    throw new NetworkStatusError('NETWORK_TLS_REQUIRED', 'A non-loopback service bind requires a TLS certificate and key.')
  }
  const service = options.serviceUrl
    ? await probeService({
        serviceUrl: options.serviceUrl,
        timeoutMs: options.probeTimeoutMs,
        caFile: options.serviceCaFile
      })
    : {
        requested: false,
        url: null,
        reachable: false,
        live: false,
        status_code: null,
        service_version: null,
        readiness: 'not_configured' as const,
        readiness_status_code: null,
        error: null
      }
  const database = options.database === undefined || options.database === null
    ? { reachable: false, error: null, status: 'not_checked' as const }
    : {
        reachable: options.database.reachable,
        error: options.database.error ?? null,
        status: options.database.reachable ? 'reachable' as const : 'unreachable' as const
      }
  const authority = options.authority ?? null
  if (authority && (!authority.authority_id || !authority.authority_epoch)) {
    throw new NetworkStatusError('NETWORK_AUTHORITY_INVALID', 'The supplied authority identity is incomplete.')
  }
  const internetState = parseInternetState(options.internetState)
  const writeAuthority = resolveWriteAuthority({
    role,
    authority,
    databaseReachable: database.status === 'reachable',
    databaseName: options.database?.name ?? null,
    service,
    internetState
  })
  const coordinator = capability(
    options.evidence?.coordinator,
    'A external coordinator is recorded with explicit evidence.',
    'No supported external coordinator is configured or evidenced. No home-grown consensus is implemented.'
  )
  const replication = capability(
    options.evidence?.replication,
    'Streaming replication is recorded with explicit evidence.',
    'No verified streaming replication or standby evidence is available. This role label is not proof of replication.'
  )
  const externalHardware = capability(
    options.evidence?.externalHardware,
    'External topology hardware is recorded with explicit evidence.',
    'External witness, fencing or network hardware is not verified by this inspection.'
  )
  const failoverEvidence = options.evidence?.automaticFailover
  const failoverRef = failoverEvidence?.evidenceRef?.trim()
  const automaticFailover: NetworkCapability = failoverEvidence?.verified === true && failoverRef
    ? {
        status: 'verified',
        detail: 'Automatic failover is backed by a reachable witness lease bound to the local authority epoch.',
        evidence_ref: failoverRef
      }
    : {
        status: 'unavailable',
        detail: 'Automatic failover is not active on this host. Do not promote a replica or redirect clients without a reviewed runbook and verified fencing.',
        evidence_ref: null
      }
  const limitations = [
    'No home-grown consensus, quorum or leader election is implemented; automatic failover requires an external witness and stays unverified without live lease evidence.',
    'Coordinator, replication, external hardware and automatic failover remain unverified unless explicit evidence is supplied.',
    'A role label does not grant write authority; local Bar commits remain single-authority and server-enforced.',
    'Internet availability is reported for diagnostics only and never selects or grants Bar write authority.',
    'Service readiness normally requires an authenticated device session. The public readiness response is reported honestly as auth_required or unverified.',
    'An authority epoch alone does not fence an isolated old host. Physical or operational isolation is mandatory during restore/failover.'
  ]
  if (role === 'replica' || role === 'voter') {
    limitations.push('Replica and voter roles must not accept Bar writes without a verified coordinator and safe promotion procedure.')
  }
  if (tls.enabled && tls.expired) {
    limitations.push('The configured TLS certificate is expired.')
  }
  if (scope === 'wildcard') {
    limitations.push('The service is configured to bind a wildcard address; restrict the firewall to the Bar subnet.')
  }
  if (service.requested && !service.reachable) {
    limitations.push('The service liveness probe failed. This is not evidence that local trading data is lost.')
  }

  const degraded = (service.requested && !service.reachable)
    || (database.status === 'unreachable')
    || (tls.enabled && tls.expired === true)
    || (role !== 'single_host' && replication.status !== 'verified')
  return {
    ok: true,
    command: 'network-status',
    generated_at: (options.now ?? new Date()).toISOString(),
    role,
    status: degraded ? 'degraded' : service.requested || database.status === 'reachable' || authority ? 'ok' : 'unverified',
    address: {
      host,
      port: options.port,
      scope,
      client_reachable: scope !== 'loopback'
    },
    tls,
    service,
    database,
    authority,
    write_authority: writeAuthority,
    capabilities: {
      coordinator,
      replication,
      external_hardware: externalHardware,
      automatic_failover: automaticFailover
    },
    limitations
  }
}
