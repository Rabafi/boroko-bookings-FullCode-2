// @ts-check

export const AUTHORITY_MODES = Object.freeze({
  CLOUD: 'cloud',
  BAR_LOCAL: 'bar_local'
})

export const AUTHORITY_CONTRACT_VERSION = 1
export const LOCAL_AUTHORITY_PRODUCT = 'hospitality-pos'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * @typedef {Object} LocalServiceEndpoint
 * @property {string} base_url
 * @property {'http:'|'https:'} protocol
 * @property {string} hostname
 * @property {number} port
 * @property {string|null} certificate_fingerprint
 */

/**
 * @typedef {Object} AuthorityConfig
 * @property {'cloud'|'bar_local'} authority_mode
 * @property {string} product
 * @property {string| null} [business_id]
 * @property {string| null} [lodge_id]
 * @property {readonly string[]} [outlet_ids]
 * @property {string| null} [active_outlet_id]
 * @property {string| null} [authority_id]
 * @property {number| null} [authority_epoch]
 * @property {string| null} [commissioning_id]
 * @property {number} [contract_version]
 * @property {string| null} [certificate_fingerprint]
 * @property {string| null} [base_url]
 * @property {LocalServiceEndpoint| null} [local_service]
 */

/**
 * @typedef {Object} NormalizedAuthorityConfig
 * @property {'cloud'|'bar_local'} authority_mode
 * @property {string} product
 * @property {string|null} business_id
 * @property {string|null} lodge_id
 * @property {readonly string[]} outlet_ids
 * @property {string|null} active_outlet_id
 * @property {string|null} authority_id
 * @property {number|null} authority_epoch
 * @property {string|null} commissioning_id
 * @property {number} contract_version
 * @property {LocalServiceEndpoint|null} local_service
 */

/**
 * @typedef {Object} ReadinessResult
 * @property {boolean} ready
 * @property {string} authority_id
 * @property {number} authority_epoch
 * @property {string} business_id
 * @property {string} outlet_id
 * @property {string} schema_version
 * @property {number} commit_sequence
 * @property {string[]} blockers
 * @property {'integration_disabled'} cloud_export
 */

/**
 * @typedef {Object} CloudRoute
 * @property {'cloud'} authority
 * @property {string} feature
 * @property {string} product
 * @property {string|null} business_id
 * @property {'supabase'} target
 */

/**
 * @typedef {Object} LocalRoute
 * @property {'bar_local'} authority
 * @property {string} feature
 * @property {string} product
 * @property {string} business_id
 * @property {string} outlet_id
 * @property {string} authority_id
 * @property {number} authority_epoch
 * @property {number} contract_version
 * @property {LocalServiceEndpoint} service
 * @property {'integration_disabled'} cloud_status
 */

/**
 * @typedef {CloudRoute|LocalRoute} AuthorityRoute
 */

export class BarLocalAdapterError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{
   *   status?: number,
   *   retrySameOperation?: boolean,
   *   requiresManager?: boolean,
   *   correlationId?: string|null,
   *   operationId?: string|null,
   *   outcomeUnknown?: boolean,
   *   details?: unknown,
   *   cause?: unknown
   * }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BarLocalAdapterError'
    this.code = code
    this.status = options.status ?? 0
    this.retrySameOperation = options.retrySameOperation ?? false
    this.requiresManager = options.requiresManager ?? false
    this.correlationId = options.correlationId ?? null
    this.operationId = options.operationId ?? null
    this.outcomeUnknown = options.outcomeUnknown ?? false
    this.details = options.details ?? null
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {never}
 */
export function authorityError(code, message, details) {
  throw new BarLocalAdapterError(code, message, details === undefined ? undefined : { details })
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function requireUuid(value, field = 'value') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be a UUID.`)
  }
  return value.toLowerCase()
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [options]
 * @returns {number}
 */
export function requireInteger(value, field, options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be an integer between ${min} and ${max}.`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [options]
 * @returns {string}
 */
export function requireString(value, field, options = {}) {
  const { min = 1, max = 500 } = options
  if (typeof value !== 'string') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be a string.`)
  }
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be between ${min} and ${max} characters.`)
  }
  return trimmed
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.')
}

/**
 * @param {unknown} raw
 * @returns {LocalServiceEndpoint}
 */
export function validateServiceEndpoint(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL is required.')
  }
  let parsed
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL is not a valid URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL must use http (loopback only) or https.')
  }
  if (parsed.username || parsed.password) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL must not contain credentials.')
  }
  if ((parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search !== '' || parsed.hash !== '') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL must not contain a path, query or fragment.')
  }
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '')
  const protocol = parsed.protocol
  if (protocol === 'http:' && !isLoopbackHostname(hostname)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Plain HTTP is only permitted for a loopback Bar service. LAN clients must use pinned HTTPS.')
  }
  const port = parsed.port === '' ? (protocol === 'https:' ? 443 : 80) : Number(parsed.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The local Bar service base URL has an invalid port.')
  }
  return Object.freeze({
    base_url: `${protocol}//${parsed.host}`,
    protocol: /** @type {'http:'|'https:'} */ (protocol),
    hostname,
    port,
    certificate_fingerprint: null
  })
}

/**
 * Accepts a SHA-256 certificate fingerprint as colon/space separated hex or
 * base64 and returns canonical lowercase hex.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFingerprint(value) {
  if (typeof value !== 'string') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'certificate_fingerprint must be a SHA-256 fingerprint string.')
  }
  const trimmed = value.trim()
  const hex = trimmed.replace(/[\s:-]/g, '').toLowerCase()
  if (/^[0-9a-f]{64}$/.test(hex)) return hex
  if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64').toString('hex')
    if (decoded.length === 64) return decoded
  }
  throw new BarLocalAdapterError('VALIDATION_FAILED', 'certificate_fingerprint must be a SHA-256 hex or base64 fingerprint.')
}

/**
 * @param {unknown} config
 * @returns {NormalizedAuthorityConfig}
 */
export function validateAuthorityConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Authority configuration must be an object.')
  }
  const record = /** @type {Record<string, unknown>} */ (config)
  const mode = record.authority_mode
  if (mode !== AUTHORITY_MODES.CLOUD && mode !== AUTHORITY_MODES.BAR_LOCAL) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'authority_mode must be explicitly committed as cloud or bar_local.')
  }
  const product = record.product === undefined ? LOCAL_AUTHORITY_PRODUCT : requireString(record.product, 'product', { max: 80 })
  const contractVersion = record.contract_version === undefined
    ? AUTHORITY_CONTRACT_VERSION
    : requireInteger(record.contract_version, 'contract_version', { min: 1 })
  if (contractVersion !== AUTHORITY_CONTRACT_VERSION) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `contract_version must be ${AUTHORITY_CONTRACT_VERSION}.`)
  }
  const businessId = record.business_id === undefined || record.business_id === null
    ? null
    : requireUuid(record.business_id, 'business_id')
  const lodgeId = record.lodge_id === undefined || record.lodge_id === null
    ? null
    : requireString(record.lodge_id, 'lodge_id', { max: 200 })
  const commissioningId = record.commissioning_id === undefined || record.commissioning_id === null
    ? null
    : requireString(record.commissioning_id, 'commissioning_id', { max: 200 })

  if (mode === AUTHORITY_MODES.CLOUD) {
    return Object.freeze({
      authority_mode: AUTHORITY_MODES.CLOUD,
      product,
      business_id: businessId,
      lodge_id: lodgeId,
      outlet_ids: Object.freeze([]),
      active_outlet_id: null,
      authority_id: null,
      authority_epoch: null,
      commissioning_id: commissioningId,
      contract_version: contractVersion,
      local_service: null
    })
  }

  if (product !== LOCAL_AUTHORITY_PRODUCT) {
    throw new BarLocalAdapterError('WRONG_AUTHORITY', `bar_local authority requires product ${LOCAL_AUTHORITY_PRODUCT}.`)
  }
  const authorityId = requireUuid(record.authority_id, 'authority_id')
  const authorityEpoch = requireInteger(record.authority_epoch, 'authority_epoch', { min: 1 })
  if (businessId === null) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'bar_local authority requires a committed business_id.')
  }
  const outletIdsRaw = record.outlet_ids
  if (!Array.isArray(outletIdsRaw) || outletIdsRaw.length === 0) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'bar_local authority requires at least one permitted outlet.')
  }
  const outletIds = outletIdsRaw.map((value, index) => requireUuid(value, `outlet_ids[${index}]`))
  if (new Set(outletIds).size !== outletIds.length) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'outlet_ids must not contain duplicates.')
  }
  const activeOutletId = record.active_outlet_id === undefined || record.active_outlet_id === null
    ? outletIds[0]
    : requireUuid(record.active_outlet_id, 'active_outlet_id')
  if (!outletIds.includes(activeOutletId)) {
    throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The active outlet is not in the committed bar_local outlet scope.')
  }
  const serviceRecord = record.local_service
  const rawBaseUrl = record.base_url
  const rawFingerprint = record.certificate_fingerprint
  let endpoint
  if (serviceRecord !== undefined && serviceRecord !== null) {
    if (typeof serviceRecord !== 'object' || Array.isArray(serviceRecord)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'local_service must be an object.')
    }
    const service = /** @type {Record<string, unknown>} */ (serviceRecord)
    endpoint = validateServiceEndpoint(service.base_url)
    const fingerprint = service.certificate_fingerprint === undefined || service.certificate_fingerprint === null
      ? null
      : normalizeFingerprint(service.certificate_fingerprint)
    endpoint = Object.freeze({ ...endpoint, certificate_fingerprint: fingerprint })
  } else {
    endpoint = validateServiceEndpoint(rawBaseUrl)
    const fingerprint = rawFingerprint === undefined || rawFingerprint === null
      ? null
      : normalizeFingerprint(rawFingerprint)
    endpoint = Object.freeze({ ...endpoint, certificate_fingerprint: fingerprint })
  }
  if (endpoint.protocol === 'https:' && endpoint.certificate_fingerprint === null) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Pinned TLS requires a SHA-256 certificate fingerprint for the local Bar service.')
  }

  return Object.freeze({
    authority_mode: AUTHORITY_MODES.BAR_LOCAL,
    product,
    business_id: businessId,
    lodge_id: lodgeId,
    outlet_ids: Object.freeze(outletIds),
    active_outlet_id: activeOutletId,
    authority_id: authorityId,
    authority_epoch: authorityEpoch,
    commissioning_id: commissioningId,
    contract_version: contractVersion,
    local_service: endpoint
  })
}

/**
 * @param {unknown} result
 * @param {NormalizedAuthorityConfig} config
 * @returns {Readonly<ReadinessResult>}
 */
function validateReadinessForConfig(result, config) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new BarLocalAdapterError('INTERNAL_ERROR', 'The Bar service readiness response is not an object.')
  }
  const record = /** @type {Record<string, unknown>} */ (result)
  if (typeof record.ready !== 'boolean') {
    throw new BarLocalAdapterError('INTERNAL_ERROR', 'The Bar service readiness response is missing ready.')
  }
  const authorityId = requireUuid(record.authority_id, 'readiness.authority_id')
  if (authorityId !== config.authority_id) {
    throw new BarLocalAdapterError('WRONG_AUTHORITY', 'The Bar service identity does not match the committed authority configuration.')
  }
  const authorityEpoch = requireInteger(record.authority_epoch, 'readiness.authority_epoch', { min: 1 })
  if (authorityEpoch !== config.authority_epoch) {
    throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The Bar service authority epoch does not match the committed epoch.', {
      details: { configured_epoch: config.authority_epoch, reported_epoch: authorityEpoch }
    })
  }
  const businessId = requireUuid(record.business_id, 'readiness.business_id')
  if (businessId !== config.business_id) {
    throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The Bar service business does not match the committed scope.')
  }
  const outletId = requireUuid(record.outlet_id, 'readiness.outlet_id')
  if (!config.outlet_ids.includes(outletId)) {
    throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The Bar service outlet is outside the committed outlet scope.')
  }
  if (record.cloud_export !== 'integration_disabled') {
    throw new BarLocalAdapterError('INTERNAL_ERROR', 'The Bar service must report cloud export as disabled in this pass.')
  }
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.map((value, index) => requireString(value, `readiness.blockers[${index}]`, { max: 200 }))
    : null
  if (blockers === null) {
    throw new BarLocalAdapterError('INTERNAL_ERROR', 'The Bar service readiness response is missing blockers.')
  }
  if (record.ready !== (blockers.length === 0)) {
    throw new BarLocalAdapterError('INTERNAL_ERROR', 'The Bar service readiness response is internally inconsistent.')
  }
  return Object.freeze({
    ready: record.ready,
    authority_id: authorityId,
    authority_epoch: authorityEpoch,
    business_id: businessId,
    outlet_id: outletId,
    schema_version: requireString(record.schema_version, 'readiness.schema_version', { max: 80 }),
    commit_sequence: requireInteger(record.commit_sequence, 'readiness.commit_sequence', { min: 0 }),
    blockers: Object.freeze(blockers),
    cloud_export: 'integration_disabled'
  })
}

/**
 * @param {import('./authority.js').AuthorityConfig|NormalizedAuthorityConfig} config
 * @param {{ clock?: () => Date }} [options]
 */
export function createAuthorityRouter(config, options = {}) {
  const committed = validateAuthorityConfig(config)
  const clock = options.clock ?? (() => new Date())
  /** @type {Readonly<ReadinessResult>|null} */
  let readiness = null
  /** @type {string|null} */
  let fencedReason = null
  /** @type {string|null} */
  let activeOutletId = committed.active_outlet_id

  /**
   * @param {string} feature
   */
  function requireFeature(feature) {
    return requireString(feature, 'feature', { max: 160 })
  }

  /**
   * @param {string} feature
   * @returns {CloudRoute}
   */
  function cloudRoute(feature) {
    return Object.freeze({
      authority: 'cloud',
      feature,
      product: committed.product,
      business_id: committed.business_id,
      target: 'supabase'
    })
  }

  /**
   * @param {string} feature
   * @returns {LocalRoute}
   */
  function localRoute(feature, options = { requireReady: true }) {
    if (fencedReason !== null) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', fencedReason, { details: { authority_mode: committed.authority_mode } })
    }
    if (committed.local_service === null || committed.authority_id === null || committed.authority_epoch === null || committed.business_id === null || activeOutletId === null) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'bar_local authority is not fully commissioned.')
    }
    if (options.requireReady && (readiness === null || readiness.ready !== true)) {
      throw new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The local Bar service is not proven ready for this authority.', {
        retrySameOperation: true,
        details: { blockers: readiness?.blockers ?? ['readiness_not_checked'], authority_mode: 'bar_local' }
      })
    }
    return Object.freeze({
      authority: 'bar_local',
      feature,
      product: committed.product,
      business_id: committed.business_id,
      outlet_id: activeOutletId,
      authority_id: committed.authority_id,
      authority_epoch: committed.authority_epoch,
      contract_version: committed.contract_version,
      service: committed.local_service,
      cloud_status: 'integration_disabled'
    })
  }

  return {
    /** @returns {'cloud'|'bar_local'} */
    get mode() {
      return committed.authority_mode
    },
    get config() {
      return committed
    },
    /** @returns {Readonly<ReadinessResult>|null} */
    get readiness() {
      return readiness
    },
    get isReady() {
      return committed.authority_mode === AUTHORITY_MODES.BAR_LOCAL && fencedReason === null && readiness?.ready === true
    },
    get isFenced() {
      return fencedReason !== null
    },
    /**
     * @param {string} feature
     * @param {{ requireReady?: boolean }} [options]
     * @returns {AuthorityRoute}
     */
    routeFor(feature, options = {}) {
      const name = requireFeature(feature)
      return committed.authority_mode === AUTHORITY_MODES.CLOUD
        ? cloudRoute(name)
        : localRoute(name, { requireReady: options.requireReady !== false })
    },
    /**
     * @param {string} feature
     * @param {{ requireReady?: boolean }} [options]
     * @returns {LocalRoute}
     */
    assertLocal(feature, options = {}) {
      const name = requireFeature(feature)
      if (committed.authority_mode !== AUTHORITY_MODES.BAR_LOCAL) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'This feature is not routed to bar_local authority.', { details: { feature: name, authority_mode: committed.authority_mode } })
      }
      return localRoute(name, { requireReady: options.requireReady !== false })
    },
    /**
     * @param {string} feature
     * @returns {CloudRoute}
     */
    assertCloud(feature) {
      const name = requireFeature(feature)
      if (committed.authority_mode !== AUTHORITY_MODES.CLOUD) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'This feature is routed to bar_local authority and must not use the cloud path.', { details: { feature: name, authority_mode: committed.authority_mode } })
      }
      return cloudRoute(name)
    },
    /**
     * Records a successful authenticated readiness response. A mismatched
     * authority or epoch fences the router permanently instead of falling back.
     * @param {unknown} result
     * @returns {Readonly<ReadinessResult>}
     */
    markReadiness(result) {
      if (committed.authority_mode !== AUTHORITY_MODES.BAR_LOCAL) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Cloud mode does not use local Bar readiness.')
      }
      try {
        const validated = validateReadinessForConfig(result, committed)
        if (validated.outlet_id !== activeOutletId) {
          throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The Bar service readiness outlet is not the active outlet.', {
            details: { active_outlet_id: activeOutletId, reported_outlet_id: validated.outlet_id }
          })
        }
        readiness = validated
        fencedReason = null
        return validated
      } catch (error) {
        if (error instanceof BarLocalAdapterError && (error.code === 'WRONG_AUTHORITY_EPOCH' || error.code === 'WRONG_AUTHORITY')) {
          readiness = null
          fencedReason = `${error.code}: ${error.message}`
        }
        throw error
      }
    },
    /**
     * @param {string} reason
     * @returns {Readonly<ReadinessResult>}
     */
    markUnavailable(reason) {
      if (committed.authority_mode !== AUTHORITY_MODES.BAR_LOCAL) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Cloud mode does not use local Bar readiness.')
      }
      const message = requireString(reason, 'reason', { max: 500 })
      const blockers = Object.freeze([message])
      readiness = Object.freeze({
        ready: false,
        authority_id: /** @type {string} */ (committed.authority_id),
        authority_epoch: /** @type {number} */ (committed.authority_epoch),
        business_id: /** @type {string} */ (committed.business_id),
        outlet_id: /** @type {string} */ (activeOutletId),
        schema_version: 'unknown',
        commit_sequence: 0,
        blockers,
        cloud_export: 'integration_disabled'
      })
      return readiness
    },
    /**
     * Switches the committed outlet only when it is already allowed. The
     * previous readiness proof is discarded and must be re-established.
     * @param {string} outletId
     */
    activateOutlet(outletId) {
      if (committed.authority_mode !== AUTHORITY_MODES.BAR_LOCAL) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'Cloud mode does not select a local Bar outlet.')
      }
      const nextOutlet = requireUuid(outletId, 'outlet_id')
      if (!committed.outlet_ids.includes(nextOutlet)) {
        throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The requested outlet is outside the committed Bar outlet scope.')
      }
      activeOutletId = nextOutlet
      readiness = null
      return nextOutlet
    },
    /**
     * @param {string} outletId
     * @returns {boolean}
     */
    permitsOutlet(outletId) {
      return typeof outletId === 'string' && committed.outlet_ids.includes(outletId.toLowerCase())
    },
    describe() {
      return Object.freeze({
        authority_mode: committed.authority_mode,
        product: committed.product,
        business_id: committed.business_id,
        lodge_id: committed.lodge_id,
        outlet_ids: committed.outlet_ids,
        active_outlet_id: activeOutletId,
        authority_id: committed.authority_id,
        authority_epoch: committed.authority_epoch,
        contract_version: committed.contract_version,
        ready: readiness?.ready === true,
        blockers: readiness?.blockers ?? Object.freeze([]),
        fenced: fencedReason !== null,
        observed_at: clock().toISOString()
      })
    }
  }
}

/**
 * @typedef {Object} IdentityMappingConfig
 * @property {string} business_id
 * @property {string|null} [lodge_id]
 * @property {Array<{ lodge_outlet_id: string, local_outlet_id: string, label?: string }>} [outlets]
 * @property {Array<{ lodge_staff_id: string, local_staff_id: string, label?: string }>} [staff]
 */

/**
 * @typedef {Object} IdentityMapping
 * @property {string} business_id
 * @property {string|null} lodge_id
 * @property {(lodgeOutletId: string) => string} outletId
 * @property {(lodgeStaffId: string) => string} staffId
 * @property {(lodgeOutletId: string) => boolean} hasOutlet
 * @property {(lodgeStaffId: string) => boolean} hasStaff
 * @property {() => { outlet_ids: string[], staff_ids: string[] }} localIds
 */

/**
 * Builds the explicit cloud/lodge-to-local identity map. This intentionally
 * contains no implicit name matching; unmapped identities fail closed.
 * @param {IdentityMappingConfig} config
 * @returns {IdentityMapping}
 */
export function createIdentityMapping(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Identity mapping configuration must be an object.')
  }
  const businessId = requireUuid(config.business_id, 'business_id')
  const lodgeId = config.lodge_id === undefined || config.lodge_id === null
    ? null
    : requireString(config.lodge_id, 'lodge_id', { max: 200 })
  /** @type {Map<string, string>} */
  const outlets = new Map()
  /** @type {Map<string, string>} */
  const staff = new Map()
  /** @type {Map<string, string>} */
  const reverseOutlets = new Map()
  /** @type {Map<string, string>} */
  const reverseStaff = new Map()

  for (const [index, entry] of (config.outlets ?? []).entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `outlets[${index}] must be an object.`)
    }
    const lodgeOutletId = requireString(entry.lodge_outlet_id, `outlets[${index}].lodge_outlet_id`, { max: 200 })
    const localOutletId = requireUuid(entry.local_outlet_id, `outlets[${index}].local_outlet_id`)
    if (outlets.has(lodgeOutletId) || reverseOutlets.has(localOutletId)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `outlets[${index}] duplicates an existing identity mapping.`)
    }
    outlets.set(lodgeOutletId, localOutletId)
    reverseOutlets.set(localOutletId, lodgeOutletId)
  }
  for (const [index, entry] of (config.staff ?? []).entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `staff[${index}] must be an object.`)
    }
    const lodgeStaffId = requireString(entry.lodge_staff_id, `staff[${index}].lodge_staff_id`, { max: 200 })
    const localStaffId = requireUuid(entry.local_staff_id, `staff[${index}].local_staff_id`)
    if (staff.has(lodgeStaffId) || reverseStaff.has(localStaffId)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `staff[${index}] duplicates an existing identity mapping.`)
    }
    staff.set(lodgeStaffId, localStaffId)
    reverseStaff.set(localStaffId, lodgeStaffId)
  }

  return Object.freeze({
    business_id: businessId,
    lodge_id: lodgeId,
    /**
     * @param {string} lodgeOutletId
     * @returns {string}
     */
    outletId(lodgeOutletId) {
      const local = outlets.get(requireString(lodgeOutletId, 'lodge_outlet_id', { max: 200 }))
      if (!local) {
        throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'This lodge outlet has no committed local Bar outlet mapping.')
      }
      return local
    },
    /**
     * @param {string} lodgeStaffId
     * @returns {string}
     */
    staffId(lodgeStaffId) {
      const local = staff.get(requireString(lodgeStaffId, 'lodge_staff_id', { max: 200 }))
      if (!local) {
        throw new BarLocalAdapterError('STAFF_NOT_FOUND', 'This lodge staff identity has no committed local Bar staff mapping.')
      }
      return local
    },
    /** @param {string} lodgeOutletId */
    hasOutlet(lodgeOutletId) {
      return typeof lodgeOutletId === 'string' && outlets.has(lodgeOutletId)
    },
    /** @param {string} lodgeStaffId */
    hasStaff(lodgeStaffId) {
      return typeof lodgeStaffId === 'string' && staff.has(lodgeStaffId)
    },
    localIds() {
      return {
        outlet_ids: Array.from(outlets.values()),
        staff_ids: Array.from(staff.values())
      }
    }
  })
}
