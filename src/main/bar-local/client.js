// @ts-check

import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { randomUUID } from 'node:crypto'
import {
  AUTHORITY_MODES,
  BarLocalAdapterError,
  createAuthorityRouter,
  isLoopbackHostname,
  normalizeFingerprint,
  requireInteger,
  requireString,
  requireUuid,
  validateServiceEndpoint
} from './authority.js'
import {
  INTENT_STATES,
  approvalHashForEnvelope,
  assertCommandEnvelope,
  openIntentJournal,
  payloadHashForEnvelope
} from './intents.js'
import { checkCartAgainstSnapshot, loadCatalogueSnapshot } from './catalogue.js'

export const ALLOWED_COMMANDS = Object.freeze(new Set([
  'sale.commit', 'sale.return', 'sale.void', 'sale.correct_after_close', 'tab.open', 'tab.add', 'tab.settle', 'tab.transfer',
  'tab.split', 'tab.merge', 'shift.open', 'shift.close', 'drawer.movement', 'cashup.submit',
  'cashup.review', 'cashup.reopen', 'stock.receive', 'stock.adjust', 'stock.stocktake', 'stock.waste', 'stock.lot.waste', 'stock.lot.release',
  'stock.transfer', 'supplier.upsert', 'purchase_order.create', 'purchase_order.cancel',
  'purchase_order.receive', 'customer.create', 'customer.credit.payment', 'voucher.issue',
  'catalogue.upsert', 'catalogue.availability.set', 'expense.create', 'expense.void',
  'accounting.account.upsert', 'control.checklist.start', 'control.checklist.item.set',
  'control.incident.log', 'control.incident.resolve', 'workforce.shift.schedule',
  'workforce.shift.cancel', 'workforce.clock.in', 'workforce.clock.out', 'staff.create',
  'staff.status', 'settings.update', 'accounting.journal.post', 'accounting.period.close',
  'catalogue.modifier_group.upsert', 'catalogue.modifier_option.upsert',
  'catalogue.product_modifier.set', 'catalogue.recipe.set', 'promotion.upsert',
  'loyalty.program.upsert', 'loyalty.account.enrol', 'loyalty.points.earn',
  'loyalty.points.redeem', 'loyalty.points.adjust', 'workforce.tip.allocate',
  'workforce.tip.payout', 'workforce.tip.payout.reverse', 'support.report.create',
  'export.bundle.create', 'accounting.ap.invoice.upsert', 'accounting.ap.invoice.approve',
  'accounting.ap.payment.post', 'accounting.ap.payment.reverse', 'accounting.bank_account.upsert',
  'accounting.bank_statement.import', 'accounting.bank.reconcile', 'accounting.tax_code.upsert',
  'accounting.tax_return.prepare', 'accounting.payroll_run.create',
  'accounting.payroll_run.prepare', 'accounting.payroll_run.finalise', 'accounting.budget.upsert'
]))

export const ALLOWED_QUERIES = Object.freeze(new Set([
  'accounting.records',
  'drawer.open_shifts',
  'workforce.tip_payouts',
  'bootstrap', 'menu.list', 'menu.availability', 'menu.promotions', 'menu.modifiers', 'expenses.list', 'expense.get',
  'accounting.accounts.list', 'tabs.list', 'tab.get', 'sales.list', 'reports.sales_summary',
  'control.templates.list', 'control.checklists.list', 'control.checklist.get',
  'control.incidents.list', 'workforce.roster', 'workforce.attendance.list',
  'workforce.attendance.current', 'sale.get', 'shift.current', 'cashup.summary', 'stock.list', 'stock.lot_expiry', 'stock.lot_balances',
  'suppliers.list', 'purchase_orders.list', 'purchase_order.get', 'customers.list', 'vouchers.list',
  'staff.list', 'audit.search', 'outbox.status', 'outbox.bundle.get', 'loyalty.programs.list', 'loyalty.account.get', 'accounting.trial_balance',
  'reports.stock', 'reports.cashup', 'reports.post_close_corrections', 'support.reports.list'
]))

const APPROVAL_CAPABILITY_BY_COMMAND = Object.freeze({
  'drawer.movement': 'pos.cashup',
  'sale.commit': 'pos.discount',
  'sale.return': 'pos.void',
  'sale.void': 'pos.void',
  'sale.correct_after_close': 'pos.void',
  'tab.settle': 'pos.discount',
  'tab.transfer': 'pos.manage',
  'tab.split': 'pos.manage',
  'tab.merge': 'pos.manage',
  'cashup.review': 'pos.cashup',
  'cashup.reopen': 'pos.cashup',
  'stock.adjust': 'inventory.approve',
  'stock.waste': 'inventory.approve',
  'stock.lot.waste': 'inventory.approve',
  'stock.lot.release': 'inventory.approve',
  'purchase_order.create': 'inventory.approve',
  'purchase_order.cancel': 'inventory.approve',
  'voucher.issue': 'vouchers.manage',
  'expense.void': 'accounting.approve',
  'staff.status': 'staff.manage',
  'accounting.period.close': 'accounting.approve',
  'loyalty.points.adjust': 'accounting.approve',
  'workforce.tip.payout': 'pos.cashup',
  'workforce.tip.payout.reverse': 'pos.cashup',
  'accounting.ap.invoice.approve': 'accounting.approve',
  'accounting.ap.payment.post': 'accounting.approve',
  'accounting.ap.payment.reverse': 'accounting.approve',
  'accounting.payroll_run.finalise': 'accounting.approve'
})

export const CATALOGUE_QUERY = 'menu.availability'

export const CATALOGUE_EVENT_PREFIXES = Object.freeze(['catalogue.', 'promotion.', 'menu.'])

export const MAX_CATALOGUE_REFRESH_PAGES = 200

/**
 * @param {unknown} eventType
 * @returns {boolean}
 */
export function isCatalogueEventType(eventType) {
  return typeof eventType === 'string'
    && CATALOGUE_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))
}

const HASH_RE = /^[0-9a-f]{64}$/

/**
 * @typedef {import('./authority.js').LocalRoute} LocalRoute
 * @typedef {import('./authority.js').IdentityMapping} IdentityMapping
 * @typedef {import('./intents.js').IntentJournal} IntentJournal
 * @typedef {import('./intents.js').IntentRecord} IntentRecord
 * @typedef {import('./intents.js').CommandEnvelope} CommandEnvelope
 * @typedef {import('./intents.js').Payload} Payload
 * @typedef {import('./catalogue.js').CatalogueSnapshot} CatalogueSnapshot
 */

/**
 * @typedef {Object} DeviceCredential
 * @property {string} device_id
 * @property {string} device_token
 * @property {string|null} [label]
 */

/**
 * The encrypted store performs its existing device_id/device_token string
 * checks before returning; label is passed to validateCredential unchanged.
 * @typedef {{device_id: string, device_token: string, label?: unknown}} DeviceCredentialReadExpectedView
 */

/**
 * @typedef {Object} DeviceCredentialStore
 * @property {() => (DeviceCredentialReadExpectedView|null|Promise<DeviceCredentialReadExpectedView|null>)} load
 * @property {(credential: DeviceCredential|null) => (void|Promise<void>)} save
 * @property {() => (void|Promise<void>)} clear
 */

/**
 * @typedef {Object} SessionState
 * @property {string} token
 * @property {string} session_id
 * @property {string} expires_at
 * @property {string} device_id
 * @property {string} business_id
 * @property {string} outlet_id
 * @property {number} authority_epoch
 * @property {Record<string, unknown>} staff
 */

/**
 * @typedef {Object} ClientLogger
 * @property {((record: Record<string, unknown>) => void)|undefined} [info]
 * @property {((record: Record<string, unknown>) => void)|undefined} [warn]
 * @property {((record: Record<string, unknown>) => void)|undefined} [error]
 */

/**
 * @typedef {Object} TransportResponse
 * @property {number} status
 * @property {Record<string, string|string[]|undefined>} headers
 * @property {unknown} body
 * @property {boolean} parse_error
 * @property {boolean} too_large
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Payload}
 */
function requirePayload(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${field} must be a plain object.`)
  }
  return /** @type {Payload} */ (value)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [options]
 * @returns {string}
 */
function optionalStringField(value, field, options = {}) {
  if (value === undefined || value === null) return ''
  return requireString(value, field, options)
}

/**
 * Normalizes a local Bar service error envelope. Returns null when the payload
 * does not carry a machine-readable code.
 * @param {unknown} payload
 * @param {{ status?: number, operationId?: string|null }} [options]
 * @returns {BarLocalAdapterError|null}
 */
export function normalizeErrorEnvelope(payload, options = {}) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = /** @type {Record<string, unknown>} */ (payload)
  const nested = record.error !== undefined && record.error !== null && typeof record.error === 'object' && !Array.isArray(record.error)
    ? /** @type {Record<string, unknown>} */ (record.error)
    : record
  const code = typeof nested.code === 'string' && nested.code.length > 0 ? nested.code : null
  if (code === null) return null
  const status = options.status ?? 0
  const retryField = nested.retry_same_operation
  const retrySameOperation = typeof retryField === 'boolean'
    ? retryField
    : status === 408 || status === 425 || status === 429 || status >= 500
  const requiresManager = nested.requires_manager === true
  const message = typeof nested.message === 'string' && nested.message.length > 0
    ? nested.message
    : 'The local Bar service refused the request.'
  return new BarLocalAdapterError(code, message, {
    status,
    retrySameOperation,
    requiresManager,
    correlationId: typeof record.correlation_id === 'string' ? record.correlation_id : null,
    operationId: options.operationId ?? null,
    details: nested.details ?? null
  })
}

/**
 * Builds a self-contained HTTP transport. Plain HTTP is loopback-only; LAN
 * traffic must use HTTPS with a pinned SHA-256 certificate fingerprint.
 * @param {{
 *   base_url?: string,
 *   baseUrl?: string,
 *   certificate_fingerprint?: string|null|undefined,
 *   certificateFingerprint?: string|null|undefined,
 *   request_timeout_ms?: number,
 *   timeoutMs?: number,
 *   connect_timeout_ms?: number,
 *   max_response_bytes?: number
 * }} options
 */
export function createHttpTransport(options) {
  const endpoint = validateServiceEndpoint(options.base_url ?? options.baseUrl)
  const rawFingerprint = options.certificate_fingerprint ?? options.certificateFingerprint ?? null
  const fingerprint = rawFingerprint === null || rawFingerprint === undefined ? null : normalizeFingerprint(rawFingerprint)
  if (endpoint.protocol === 'https:' && fingerprint === null) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'Pinned TLS requires a SHA-256 certificate fingerprint.')
  }
  const timeoutMs = requireInteger(options.request_timeout_ms ?? options.timeoutMs ?? 15000, 'request_timeout_ms', { min: 100, max: 120000 })
  const connectTimeoutMs = requireInteger(options.connect_timeout_ms ?? 5000, 'connect_timeout_ms', { min: 100, max: 120000 })
  const maxResponseBytes = requireInteger(options.max_response_bytes ?? 8 * 1024 * 1024, 'max_response_bytes', { min: 1024, max: 64 * 1024 * 1024 })
  const agent = endpoint.protocol === 'https:'
    ? new https.Agent({
        keepAlive: true,
        rejectUnauthorized: false,
        checkServerIdentity: (_hostname, certificate) => verifyCertificateFingerprint(certificate, fingerprint)
      })
    : new http.Agent({ keepAlive: true })

  /**
   * @param {import('node:tls').PeerCertificate} certificate
   * @param {string} expected
   * @returns {Error|undefined}
   */
  function verifyCertificateFingerprint(certificate, expected) {
    const reported = certificate && typeof certificate.fingerprint256 === 'string' ? certificate.fingerprint256 : ''
    if (reported === '') {
      return new Error('TLS_FINGERPRINT_MISMATCH')
    }
    const normalized = normalizeFingerprint(reported)
    if (normalized !== expected) return new Error('TLS_FINGERPRINT_MISMATCH')
    return undefined
  }

  /**
   * @param {Error} error
   * @returns {BarLocalAdapterError}
   */
  function mapTransportError(error) {
    if (error instanceof BarLocalAdapterError) return error
    const nodeCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : ''
    const message = error.message || 'The local Bar service transport failed.'
    if (nodeCode === 'TLS_FINGERPRINT_MISMATCH' || message === 'TLS_FINGERPRINT_MISMATCH') {
      return new BarLocalAdapterError('TLS_FINGERPRINT_MISMATCH', 'The local Bar service certificate does not match the pinned fingerprint.', { outcomeUnknown: true })
    }
    if (nodeCode === 'CONNECT_TIMEOUT' || message === 'CONNECT_TIMEOUT') {
      return new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The local Bar service did not answer in time.', { retrySameOperation: true, cause: error })
    }
    if (nodeCode === 'REQUEST_TIMEOUT' || message === 'REQUEST_TIMEOUT') {
      return new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar service did not answer before the timeout; the outcome is unknown.', { retrySameOperation: true, outcomeUnknown: true, cause: error })
    }
    if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ERR_SOCKET_BAD_PORT'].includes(nodeCode)) {
      return new BarLocalAdapterError('SERVICE_UNAVAILABLE', 'The local Bar service is unreachable.', { retrySameOperation: true, cause: error })
    }
    if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET'].includes(nodeCode)) {
      return new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar service connection dropped with an unknown outcome.', { retrySameOperation: true, outcomeUnknown: true, cause: error })
    }
    return new BarLocalAdapterError('SERVICE_UNAVAILABLE', message, { retrySameOperation: true, cause: error })
  }

  /**
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {{
   *   body?: unknown,
   *   token?: string|null,
   *   deviceId?: string|null,
   *   deviceToken?: string|null,
   *   correlationId?: string|null,
   *   query?: Record<string, string>
   * }} [requestOptions]
   * @returns {Promise<TransportResponse>}
   */
  async function request(method, path, requestOptions = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'Local Bar client paths must be relative API paths.')
    }
    const url = new URL(`${endpoint.base_url}${path}`)
    if (requestOptions.query) {
      for (const [key, value] of Object.entries(requestOptions.query)) {
        url.searchParams.set(key, value)
      }
    }
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' }
    if (requestOptions.token) headers.authorization = `Bearer ${requestOptions.token}`
    if (requestOptions.deviceId) headers['x-bar-device-id'] = requestOptions.deviceId
    if (requestOptions.deviceToken) headers['x-bar-device-token'] = requestOptions.deviceToken
    if (requestOptions.correlationId) headers['x-correlation-id'] = requestOptions.correlationId
    let serializedBody
    if (requestOptions.body !== undefined) {
      try {
        serializedBody = JSON.stringify(requestOptions.body)
      } catch (error) {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'The request body is not JSON serializable.', { cause: error })
      }
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(serializedBody))
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let connectTimer
      /** @param {BarLocalAdapterError} error */
      const fail = (error) => {
        if (settled) return
        settled = true
        if (connectTimer) clearTimeout(connectTimer)
        reject(error)
      }
      /** @type {import('node:http').RequestOptions & import('node:https').RequestOptions} */
      const baseOptions = {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent
      }
      const onResponse = (/** @type {import('node:http').IncomingMessage} */ res) => {
        const chunks = []
        let size = 0
        let tooLarge = false
        res.on('data', (/** @type {Buffer|string} */ chunk) => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          size += buffer.length
          if (size > maxResponseBytes) {
            tooLarge = true
            res.destroy(new Error('RESPONSE_TOO_LARGE'))
            return
          }
          chunks.push(buffer)
        })
        res.on('error', (error) => {
          if (tooLarge) {
            fail(new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar service response exceeded the client limit.', { outcomeUnknown: true, retrySameOperation: true, cause: error }))
            return
          }
          fail(mapTransportError(error))
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          if (connectTimer) clearTimeout(connectTimer)
          const text = Buffer.concat(chunks).toString('utf8')
          let body = null
          let parseError = false
          if (text.trim() !== '') {
            try {
              body = JSON.parse(text)
            } catch {
              parseError = true
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            parse_error: parseError,
            too_large: tooLarge
          })
        })
      }
      const req = endpoint.protocol === 'https:'
        ? https.request(/** @type {import('node:https').RequestOptions} */ (baseOptions), onResponse)
        : http.request(/** @type {import('node:http').RequestOptions} */ (baseOptions), onResponse)
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('REQUEST_TIMEOUT'))
      })
      connectTimer = setTimeout(() => {
        req.destroy(new Error('CONNECT_TIMEOUT'))
      }, connectTimeoutMs)
      req.on('socket', (socket) => {
        if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true)
        const clearConnectTimer = () => {
          if (connectTimer) clearTimeout(connectTimer)
        }
        if (socket.connecting) {
          socket.once('connect', clearConnectTimer)
        } else {
          clearConnectTimer()
        }
        if (socket instanceof tls.TLSSocket) {
          const verifyPeer = () => {
            if (fingerprint === null) return
            const check = verifyCertificateFingerprint(socket.getPeerCertificate(), fingerprint)
            if (check) req.destroy(new Error('TLS_FINGERPRINT_MISMATCH'))
          }
          if (socket.connecting) {
            socket.once('secureConnect', verifyPeer)
          } else {
            verifyPeer()
          }
        }
      })
      req.on('error', (error) => fail(mapTransportError(error)))
      req.end(serializedBody)
    })
  }

  return {
    endpoint: Object.freeze({ ...endpoint, certificate_fingerprint: fingerprint }),
    get baseUrl() {
      return endpoint.base_url
    },
    get fingerprint() {
      return fingerprint
    },
    /**
     * @param {string} path
     * @param {{ token?: string|null, deviceId?: string|null, query?: Record<string, string>, correlationId?: string|null }} [options]
     * @returns {Promise<TransportResponse>}
     */
    get(path, options = {}) {
      return request('GET', path, options)
    },
    /**
     * @param {string} path
     * @param {unknown} body
     * @param {{ token?: string|null, deviceId?: string|null, deviceToken?: string|null, correlationId?: string|null }} [options]
     * @returns {Promise<TransportResponse>}
     */
    post(path, body, options = {}) {
      return request('POST', path, { ...options, body })
    },
    close() {
      agent.destroy()
    }
  }
}

/**
 * @param {unknown} value
 * @returns {DeviceCredential}
 */
function validateCredential(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The stored device credential is invalid.')
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  const token = requireString(record.device_token, 'device_token', { min: 20, max: 200 })
  return {
    device_id: requireUuid(record.device_id, 'device_id'),
    device_token: token,
    label: record.label === undefined || record.label === null ? null : requireString(record.label, 'label', { max: 120 })
  }
}

/**
 * In-memory default; the main process supplies a durable implementation.
 * @param {DeviceCredential|null} [initial]
 * @returns {DeviceCredentialStore}
 */
export function createMemoryDeviceCredentialStore(initial = null) {
  /** @type {DeviceCredential|null} */
  let credential = initial === null ? null : validateCredential(initial)
  return {
    load() {
      return credential
    },
    save(value) {
      credential = value === null ? null : validateCredential(value)
    },
    clear() {
      credential = null
    }
  }
}

/**
 * @param {unknown} response
 * @returns {boolean}
 */
function isSessionExpiryError(response) {
  return response instanceof BarLocalAdapterError && (response.code === 'SESSION_EXPIRED' || response.code === 'AUTH_REQUIRED' || response.code === 'SESSION_REVOKED')
}

export class BarLocalClient {
  /**
   * @param {{
   *   router: ReturnType<typeof createAuthorityRouter>,
   *   transport?: ReturnType<typeof createHttpTransport>,
   *   journal?: IntentJournal,
   *   device_store?: DeviceCredentialStore,
   *   deviceStore?: DeviceCredentialStore,
   *   logger?: ClientLogger|null,
   *   clock?: () => Date,
   *   identity?: IdentityMapping|null,
   *   request_timeout_ms?: number,
   *   connect_timeout_ms?: number
   * }} options
   */
  constructor(options) {
    this.router = options.router
    this.clock = options.clock ?? (() => new Date())
    this.logger = options.logger ?? null
    this.identity = options.identity ?? null
    this.credentialStore = options.device_store ?? options.deviceStore ?? createMemoryDeviceCredentialStore()
    this.transport = options.transport ?? null
    if (this.transport === null) {
      const service = this.router.config.local_service
      if (this.router.mode !== AUTHORITY_MODES.BAR_LOCAL || service === null) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'A local Bar client requires committed bar_local configuration with a service endpoint.')
      }
      this.transport = createHttpTransport({
        base_url: service.base_url,
        certificate_fingerprint: service.certificate_fingerprint,
        request_timeout_ms: options.request_timeout_ms,
        connect_timeout_ms: options.connect_timeout_ms
      })
    }
    this.journal = options.journal ?? openIntentJournal()
    /** @type {SessionState|null} */
    this.session = null
    this.eventCursor = 0
    this.resyncRequired = false
    /** @type {CatalogueSnapshot|null} */
    this.catalogueSnapshot = null
    this.catalogueInvalidated = true
    this.catalogueInvalidatedThrough = 0
    /** @type {Record<string, unknown>|null} */
    this.catalogueInvalidation = null
    /** @type {{
     *   reason: string,
     *   requested_after?: number,
     *   retention_floor_sequence?: number|null,
     *   latest_commit_sequence?: number,
     *   latest_event_sequence?: number,
     *   commit_sequence?: number
     * }|null} */
    this.catalogueGap = null
    /** @type {Promise<Record<string, unknown>>|null} */
    this.catalogueRefreshInFlight = null
  }

  /**
   * @param {'info'|'warn'|'error'} level
   * @param {Record<string, unknown>} record
   */
  #log(level, record) {
    const logger = this.logger
    if (!logger) return
    const sink = logger[level]
    if (typeof sink === 'function') sink({ ...record, at: this.clock().toISOString() })
  }

  /**
   * @param {string} operationId
   * @param {string} code
   */
  #logOperation(operationId, code) {
    this.#log('info', { event: 'bar_local.operation', operation_id: operationId, code })
  }

  #newCorrelationId() {
    return randomUUID()
  }

  /** @returns {Promise<DeviceCredential>} */
  async #credential() {
    const stored = await this.credentialStore.load()
    if (stored === null) {
      throw new BarLocalAdapterError('AUTH_REQUIRED', 'This till has no commissioned device credential. Pair the device first.')
    }
    return validateCredential(stored)
  }

  /** @returns {SessionState} */
  #requireSession() {
    if (this.session === null) {
      throw new BarLocalAdapterError('AUTH_REQUIRED', 'No local Bar session is active. Log in first.')
    }
    return this.session
  }

  /** @returns {Promise<{session: SessionState, credential: DeviceCredential}>} */
  async #requireAuth() {
    const session = this.#requireSession()
    const credential = await this.#credential()
    return { session, credential }
  }

  /**
   * Re-checks the authenticated session against a freshly asserted local
   * route. A session issued for another authority epoch, business or outlet is
   * unusable even when the transport would still answer.
   * @param {SessionState} session
   * @param {LocalRoute} route
   */
  #assertSessionScope(session, route) {
    if (session.authority_epoch !== route.authority_epoch) {
      this.session = null
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The local session belongs to a different authority epoch.', {
        details: { session_epoch: session.authority_epoch, route_epoch: route.authority_epoch }
      })
    }
    if (session.business_id !== route.business_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local session business does not match the committed scope.')
    }
    if (session.outlet_id !== route.outlet_id) {
      throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The local session outlet does not match the active committed outlet.')
    }
  }

  /**
   * @param {string} feature
   * @param {boolean} requireReady
   * @returns {LocalRoute}
   */
  #localRoute(feature, requireReady) {
    return this.router.assertLocal(feature, { requireReady })
  }

  /**
   * @param {string} command
   */
  #assertAllowedCommand(command) {
    if (!ALLOWED_COMMANDS.has(command)) {
      throw new BarLocalAdapterError('COMMAND_NOT_REGISTERED', `Command ${command} is not registered for local Bar authority.`)
    }
  }

  /**
   * @param {string} queryName
   */
  #assertAllowedQuery(queryName) {
    if (!ALLOWED_QUERIES.has(queryName)) {
      throw new BarLocalAdapterError('QUERY_NOT_REGISTERED', `Query ${queryName} is not registered for local Bar authority.`)
    }
  }

  /**
   * @param {unknown} body
   * @param {string} field
   * @returns {Payload}
   */
  #expectObject(body, field) {
    return requirePayload(body, field)
  }

  /**
   * Commissions the first owner over loopback. The server permanently fences
   * this route after first use, so the client only calls it when instructed.
   * @param {Payload} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async setupOwner(request) {
    const payload = requirePayload(request, 'setup request')
    if (!isLoopbackHostname(this.transport.endpoint.hostname)) {
      throw new BarLocalAdapterError('SETUP_LOCAL_ONLY', 'First-owner commissioning must run on the local machine over loopback.')
    }
    if (typeof payload.provisioning_id !== 'string' || typeof payload.device_token !== 'string') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'A stable protected setup attempt is required before contacting the local Bar service.')
    }
    const response = await this.transport.post('/v1/setup/owner', payload, { correlationId: this.#newCorrelationId() })
    const body = this.#expectObject(response.body, 'commissioning response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    if (response.status !== 201 && response.status !== 200) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar service did not commission the business.')
    }
    const committedCredential = validateCredential({ device_id: body.device_id, device_token: payload.device_token })
    await this.credentialStore.save(committedCredential)
    if (this.router.mode === AUTHORITY_MODES.BAR_LOCAL) {
      const configuredEpoch = this.router.config.authority_epoch
      const commissionedEpoch = requireInteger(body.authority_epoch, 'authority_epoch', { min: 1 })
      if (configuredEpoch !== null && configuredEpoch !== commissionedEpoch) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The commissioned authority epoch does not match the committed configuration.')
      }
    }
    this.#log('info', { event: 'bar_local.setup_owner', outcome: body.outcome })
    return { ...body, device_token: undefined }
  }

  /**
   * @param {Payload} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async startPairing(request = {}) {
    const { session, credential } = await this.#requireAuth()
    this.#localRoute('pairing.start', true)
    const response = await this.transport.post('/v1/pairing/start', request, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'pairing response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    return body
  }

  /**
   * @param {Payload} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async completePairing(request) {
    const payload = requirePayload(request, 'pairing request')
    if (typeof payload.provisioning_id !== 'string' || typeof payload.device_token !== 'string') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'A stable protected pairing attempt is required before contacting the local Bar service.')
    }
    this.#localRoute('pairing.complete', true)
    const response = await this.transport.post('/v1/pairing/complete', {
      ...payload,
      certificate_fingerprint: this.transport.fingerprint
    }, { correlationId: this.#newCorrelationId() })
    const body = this.#expectObject(response.body, 'pairing response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    const serverFingerprint = body.server_certificate_fingerprint
    if (this.transport.fingerprint !== null && typeof serverFingerprint === 'string') {
      if (normalizeFingerprint(serverFingerprint) !== this.transport.fingerprint) {
        throw new BarLocalAdapterError('TLS_FINGERPRINT_MISMATCH', 'The paired server certificate does not match the pinned fingerprint.')
      }
    }
    const credential = validateCredential({ device_id: body.device_id, device_token: payload.device_token })
    await this.credentialStore.save(credential)
    this.#log('info', { event: 'bar_local.device_paired', device_id: credential.device_id })
    return { ...body, device_token: undefined }
  }

  /**
   * @param {{ staff_id?: string, staffId?: string, pin?: string, email?: string, password?: string, outlet_id?: string, outletId?: string }} request
   * @returns {Promise<SessionState>}
   */
  async login(request) {
    const credential = await this.#credential()
    let body
    if (request.email !== undefined || request.password !== undefined) {
      if (request.staff_id !== undefined || request.staffId !== undefined || request.pin !== undefined) {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'Use either owner email and password or staff ID and PIN.')
      }
      body = {
        email: requireString(request.email, 'email', { min: 3, max: 254 }).trim().toLowerCase(),
        password: requireString(request.password, 'password', { min: 12, max: 128 })
      }
    } else {
      const staffId = requireUuid(request.staff_id ?? request.staffId, 'staff_id')
      const pin = requireString(request.pin, 'pin', { min: 4, max: 12 })
      if (!/^\d+$/.test(pin)) throw new BarLocalAdapterError('VALIDATION_FAILED', 'pin must be numeric.')
      body = { staff_id: staffId, pin }
    }
    // Readiness is authenticated: requiring it here makes first login (and
    // login after restart) impossible. The server authenticates this device
    // and staff; final trading still has its separate readiness/DB guards.
    const route = this.#localRoute('session.create', false)
    const outletId = request.outlet_id ?? request.outletId
    if (outletId !== undefined && outletId !== null) body.outlet_id = requireUuid(outletId, 'outlet_id')
    const response = await this.transport.post('/v1/sessions', body, {
      deviceToken: credential.device_token,
      correlationId: this.#newCorrelationId()
    })
    const responseBody = this.#expectObject(response.body, 'session response')
    const error = normalizeErrorEnvelope(responseBody, { status: response.status })
    if (error) throw error
    const epoch = requireInteger(responseBody.authority_epoch, 'authority_epoch', { min: 1 })
    if (route.authority_epoch !== epoch) {
      this.session = null
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The local session belongs to a different authority epoch.')
    }
    /** @type {SessionState} */
    const session = {
      token: requireString(responseBody.session_token, 'session_token', { min: 20, max: 200 }),
      session_id: requireUuid(responseBody.session_id, 'session_id'),
      expires_at: requireString(responseBody.expires_at, 'expires_at', { max: 40 }),
      device_id: credential.device_id,
      business_id: requireUuid(responseBody.business_id, 'business_id'),
      outlet_id: requireUuid(responseBody.outlet_id, 'outlet_id'),
      authority_epoch: epoch,
      staff: requirePayload(responseBody.staff, 'staff')
    }
    if (session.business_id !== route.business_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local session business does not match the committed scope.')
    }
    this.session = session
    this.#log('info', { event: 'bar_local.login', staff_id: session.staff.staff_id ?? session.staff.id })
    return session
  }

  async recoverOwnerPassword(request) {
    if (!isLoopbackHostname(this.transport.endpoint.hostname)) {
      throw new BarLocalAdapterError('OWNER_RECOVERY_LOCAL_ONLY', 'Owner password recovery must be started on the main Bar computer.')
    }
    const payload = requirePayload(request, 'owner password recovery request')
    const body = {
      owner_email: requireString(payload.owner_email, 'owner_email', { min: 3, max: 254 }).trim().toLowerCase(),
      new_password: requireString(payload.new_password, 'new_password', { min: 12, max: 128 }),
      recovery_secret: requireString(payload.recovery_secret, 'recovery_secret', { min: 16, max: 200 })
    }
    const response = await this.transport.post('/v1/owner/password/recover', body, { correlationId: this.#newCorrelationId() })
    const responseBody = this.#expectObject(response.body, 'owner recovery response')
    const error = normalizeErrorEnvelope(responseBody, { status: response.status })
    if (error) throw error
    return responseBody
  }

  /**
   * @returns {Promise<SessionState>}
   */
  async refreshSession() {
    const { session, credential } = await this.#requireAuth()
    const response = await this.transport.post('/v1/sessions/refresh', {}, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'session response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) {
      if (isSessionExpiryError(error)) this.session = null
      throw error
    }
    const epoch = body.authority_epoch === undefined
      ? session.authority_epoch
      : requireInteger(body.authority_epoch, 'authority_epoch', { min: 1 })
    if (epoch !== session.authority_epoch) {
      this.session = null
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The refreshed session belongs to a different authority epoch.')
    }
    this.session = {
      ...session,
      token: requireString(body.session_token, 'session_token', { min: 20, max: 200 }),
      expires_at: requireString(body.expires_at, 'expires_at', { max: 40 }),
      authority_epoch: epoch
    }
    return this.session
  }

  /**
   * @returns {Promise<{ session_id: string }>}
   */
  async revokeSession() {
    const session = this.#requireSession()
    const credential = await this.#credential()
    const response = await this.transport.post('/v1/sessions/revoke', { session_id: session.session_id }, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'session revocation response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error && error.code !== 'SESSION_EXPIRED' && error.code !== 'SESSION_REVOKED') throw error
    this.session = null
    return { session_id: session.session_id }
  }

  /**
   * Clears local credentials even when the service cannot be reached.
   * @returns {Promise<{ revoked: boolean }>}
   */
  async logout() {
    let revoked = false
    try {
      await this.revokeSession()
      revoked = true
    } catch {
      revoked = false
    }
    this.session = null
    return { revoked }
  }

  /**
   * @param {Payload} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async requestApproval(request) {
    const payload = requirePayload(request, 'approval request')
    const operation = assertCommandEnvelope(payload.operation)
    const { session, credential } = await this.#requireAuth()
    if (operation.device_id !== credential.device_id) {
      throw new BarLocalAdapterError('AUTH_INVALID', 'The approval operation belongs to a different device.')
    }
    this.#localRoute(`approval:${operation.command}`, true)
    const response = await this.transport.post('/v1/approvals', {
      operation,
      capability: requireString(payload.capability, 'capability', { max: 60 }),
      pin: requireString(payload.pin, 'pin', { min: 4, max: 12 }),
      target_type: payload.target_type === undefined ? 'operation' : requireString(payload.target_type, 'target_type', { max: 60 }),
      target_id: payload.target_id ?? null
    }, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'approval response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    const expectedHash = approvalHashForEnvelope(operation)
    if (body.operation_hash !== undefined && body.operation_hash !== expectedHash) {
      throw new BarLocalAdapterError('APPROVAL_SCOPE_MISMATCH', 'The approval does not bind to this exact operation.')
    }
    return body
  }

  /**
   * Request an approval for a fixed command using trusted authority scope.
   * The renderer supplies only command data and a PIN; it cannot choose the
   * authority, business, outlet, device, or operation envelope scope.
   * @param {{command: string, payload: Payload, pin: string, operation_id?: string}} request
   */
  async requestApprovalForCommand(request) {
    const command = requireString(request.command, 'command', { max: 80 })
    const payload = requirePayload(request.payload, 'payload')
    const route = this.#localRoute(`approval:${command}`, true)
    const { credential } = await this.#requireAuth()
    const capability = APPROVAL_CAPABILITY_BY_COMMAND[command]
    if (!capability) throw new BarLocalAdapterError('VALIDATION_FAILED', 'This local workflow has no registered approval capability.')
    const operation = assertCommandEnvelope({
      contract_version: 1,
      authority_id: route.authority_id,
      authority_epoch: route.authority_epoch,
      business_id: route.business_id,
      outlet_id: route.outlet_id,
      device_id: credential.device_id,
      operation_id: request.operation_id ?? randomUUID(),
      command,
      payload_version: 1,
      payload,
      expected_versions: {},
      dependencies: [],
      client_occurred_at: this.clock().toISOString()
    })
    return this.requestApproval({ operation, capability, pin: request.pin, target_type: command })
  }

  /**
   * @param {{
   *   command: string,
   *   payload: Payload,
   *   operation_id?: string,
   *   expected_versions?: Payload,
   *   dependencies?: string[],
   *   client_occurred_at?: string
   * }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async command(request) {
    const command = requireString(request.command, 'command', { max: 80 })
    this.#assertAllowedCommand(command)
    const payload = requirePayload(request.payload, 'payload')
    const route = this.#localRoute(`command:${command}`, !command.startsWith('catalogue.'))
    const { session, credential } = await this.#requireAuth()
    const record = this.journal
    if (record.filePath === null) {
      throw new BarLocalAdapterError('RECOVERY_REQUIRED', 'A durable intent journal file is required before dispatching financial commands.')
    }
    const operationId = request.operation_id === undefined
      ? randomUUID()
      : requireUuid(request.operation_id, 'operation_id')
    const envelope = assertCommandEnvelope({
      contract_version: 1,
      authority_id: route.authority_id,
      authority_epoch: route.authority_epoch,
      business_id: route.business_id,
      outlet_id: route.outlet_id,
      device_id: credential.device_id,
      operation_id: operationId,
      command,
      payload_version: 1,
      payload,
      expected_versions: request.expected_versions ?? {},
      dependencies: request.dependencies ?? [],
      client_occurred_at: request.client_occurred_at ?? this.clock().toISOString()
    })
    const incomingHash = payloadHashForEnvelope(envelope)
    const existing = record.get(operationId)
    if (existing) {
      if (existing.payload_hash !== incomingHash) {
        throw new BarLocalAdapterError('IDEMPOTENCY_PAYLOAD_CONFLICT', 'This operation id was already used with a different payload; resolve the original operation instead.', {
          operationId,
          retrySameOperation: false
        })
      }
      const terminal = this.#terminalOutcome(existing)
      if (terminal) return terminal
    } else {
      const unresolved = record.list().find((intent) => intent.operation_id !== operationId
        && ![INTENT_STATES.COMMITTED_LOCAL, INTENT_STATES.TERMINAL_REFUSAL, INTENT_STATES.CANCELLED].includes(intent.state))
      if (unresolved) {
        throw new BarLocalAdapterError('UNRESOLVED_OPERATION', 'Resolve the earlier local operation with its original ID before starting another operation.', {
          operationId: unresolved.operation_id, retrySameOperation: true
        })
      }
      record.createIntent(envelope)
    }
    return this.#dispatch(operationId, route, session, credential)
  }

  /**
   * Retries the exact original envelope with the original operation id. A
   * timeout never produces a new key.
   * @param {string} operationId
   * @returns {Promise<Record<string, unknown>>}
   */
  async retryOperation(operationId) {
    const id = requireUuid(operationId, 'operation_id')
    const record = this.journal.get(id)
    if (!record) {
      throw new BarLocalAdapterError('OPERATION_NOT_FOUND', 'No durable intent exists for this operation id.', { operationId: id })
    }
    const terminal = this.#terminalOutcome(record)
    if (terminal) return terminal
    // Recovery must remain available when a mutable readiness condition (for
    // example an empty catalogue) changed after the original commit. The DB
    // resolves an existing receipt first and guards any genuinely new effect.
    const route = this.#localRoute(`command:${record.command}`, false)
    const { session, credential } = await this.#requireAuth()
    if (record.device_id !== credential.device_id) {
      throw new BarLocalAdapterError('AUTH_INVALID', 'The durable intent belongs to a different device.', { operationId: id })
    }
    return this.#dispatch(id, route, session, credential)
  }

  /**
   * @param {IntentRecord} record
   * @returns {Record<string, unknown>|null}
   */
  #terminalOutcome(record) {
    if (record.state === INTENT_STATES.COMMITTED_LOCAL) {
      return {
        ok: true,
        outcome: 'committed_local',
        replayed: true,
        from_journal: true,
        receipt: record.receipt,
        result: record.result
      }
    }
    if (record.state === INTENT_STATES.TERMINAL_REFUSAL) {
      return { ok: false, outcome: 'refused', from_journal: true, error: record.refusal }
    }
    if (record.state === INTENT_STATES.CANCELLED) {
      throw new BarLocalAdapterError('OPERATION_REFUSED', 'This operation was cancelled locally and will not be dispatched.', { operationId: record.operation_id })
    }
    return null
  }

  /**
   * @param {string} operationId
   * @param {LocalRoute} route
   * @param {SessionState} session
   * @param {DeviceCredential} credential
   * @returns {Promise<Record<string, unknown>>}
   */
  async #dispatch(operationId, route, session, credential) {
    const record = this.journal.get(operationId)
    if (!record) {
      throw new BarLocalAdapterError('OPERATION_NOT_FOUND', 'The durable intent disappeared before dispatch.', { operationId })
    }
    this.journal.markSending(operationId)
    const correlationId = this.#newCorrelationId()
    let response
    try {
      response = await this.transport.post('/v1/commands', record.envelope, {
        token: session.token,
        deviceId: credential.device_id,
        correlationId
      })
    } catch (error) {
      const mapped = error instanceof BarLocalAdapterError
        ? error
        : new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar service transport failed with an unknown outcome.', { retrySameOperation: true, outcomeUnknown: true, cause: error })
      // The sending frame is already durable. If storage also failed, preserve
      // its identity and still report uncertainty rather than masking it.
      try { this.journal.markOutcomeUnknown(operationId, mapped.code) } catch {}
      this.#logOperation(operationId, mapped.code)
      throw new BarLocalAdapterError(mapped.code, mapped.message, {
        status: mapped.status,
        retrySameOperation: true,
        outcomeUnknown: true,
        correlationId: mapped.correlationId ?? correlationId,
        operationId,
        details: mapped.details,
        cause: mapped
      })
    }
    try {
      return this.#handleCommandResponse(operationId, route, response, correlationId)
    } catch (cause) {
      if (cause instanceof BarLocalAdapterError && cause.outcomeUnknown) throw cause
      throw new BarLocalAdapterError(cause instanceof BarLocalAdapterError ? cause.code : 'UNKNOWN_OUTCOME',
        'The command was sent but its outcome could not be saved safely. Keep this operation ID, restore saved-operation storage and recover it before starting another transaction.', {
          operationId, retrySameOperation: true, outcomeUnknown: true, correlationId, cause
        })
    }
  }

  /**
   * @param {string} operationId
   * @param {LocalRoute} route
   * @param {TransportResponse} response
   * @param {string} correlationId
   * @returns {Record<string, unknown>}
   */
  #handleCommandResponse(operationId, route, response, correlationId) {
    if (response.too_large || response.parse_error || response.body === null) {
      this.journal.markOutcomeUnknown(operationId, 'UNKNOWN_OUTCOME')
      throw new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar service reply could not be trusted; check the operation before retrying.', {
        status: response.status,
        retrySameOperation: true,
        outcomeUnknown: true,
        correlationId,
        operationId
      })
    }
    const body = this.#expectObject(response.body, 'command response')
    if (body.ok === true && body.outcome === 'committed_local') {
      const receipt = requirePayload(body.receipt, 'command.receipt')
      if (receipt.operation_id !== operationId) {
        this.journal.markOutcomeUnknown(operationId, 'UNKNOWN_OUTCOME')
        throw new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar receipt does not match the submitted operation.', {
          status: response.status,
          retrySameOperation: true,
          outcomeUnknown: true,
          correlationId,
          operationId
        })
      }
      if (receipt.authority_id !== route.authority_id || receipt.authority_epoch !== route.authority_epoch) {
        this.journal.markOutcomeUnknown(operationId, 'WRONG_AUTHORITY_EPOCH')
        throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The local Bar receipt belongs to a different authority or epoch.', {
          retrySameOperation: true,
          outcomeUnknown: true,
          operationId
        })
      }
      if (receipt.commit_sequence === undefined || !Number.isSafeInteger(receipt.commit_sequence)) {
        this.journal.markOutcomeUnknown(operationId, 'UNKNOWN_OUTCOME')
        throw new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar receipt is missing its commit sequence.', {
          retrySameOperation: true,
          outcomeUnknown: true,
          operationId
        })
      }
      const result = body.result === undefined || body.result === null ? null : requirePayload(body.result, 'command.result')
      this.journal.markCommitted(operationId, receipt, result)
      this.#logOperation(operationId, 'committed_local')
      return {
        ok: true,
        outcome: 'committed_local',
        replayed: body.replayed === true,
        receipt,
        result
      }
    }
    const normalized = normalizeErrorEnvelope(body, { status: response.status, operationId }) ?? new BarLocalAdapterError(
      response.status >= 500 ? 'UNKNOWN_OUTCOME' : 'INTERNAL_ERROR',
      'The local Bar service returned an unexpected error envelope.',
      { status: response.status }
    )
    const sessionError = isSessionExpiryError(normalized)
    const ambiguous = normalized.code === 'UNKNOWN_OUTCOME'
      || normalized.code === 'OPERATION_EXECUTING'
      || sessionError
      || normalized.retrySameOperation
      || response.status === 408
      || response.status === 425
      || response.status === 429
      || response.status >= 500
    if (ambiguous) {
      if (sessionError) this.session = null
      this.journal.markOutcomeUnknown(operationId, normalized.code)
      this.#logOperation(operationId, normalized.code)
      throw new BarLocalAdapterError(normalized.code, normalized.message, {
        status: normalized.status,
        retrySameOperation: true,
        requiresManager: normalized.requiresManager,
        correlationId: normalized.correlationId ?? correlationId,
        operationId,
        outcomeUnknown: true,
        details: normalized.details,
        cause: normalized
      })
    }
    const refusal = {
      code: normalized.code,
      message: normalized.message,
      retry_same_operation: false,
      requires_manager: normalized.requiresManager
    }
    this.journal.markRefused(operationId, refusal)
    this.#logOperation(operationId, normalized.code)
    return { ok: false, outcome: 'refused', replayed: false, error: refusal }
  }

  /**
   * @param {string} operationId
   * @returns {Promise<Record<string, unknown>>}
   */
  async getOperation(operationId) {
    const id = requireUuid(operationId, 'operation_id')
    const route = this.#localRoute('operation.status', false)
    const { session, credential } = await this.#requireAuth()
    const response = await this.transport.get(`/v1/operations/${encodeURIComponent(id)}`, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = response.body
    if (response.too_large || response.parse_error || body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar operation status could not be read safely.', {
        status: response.status,
        retrySameOperation: true,
        outcomeUnknown: true,
        operationId: id
      })
    }
    const error = normalizeErrorEnvelope(body, { status: response.status, operationId: id })
    if (error) throw error
    const record = /** @type {Record<string, unknown>} */ (body)
    const status = requireString(record.status, 'operation.status', { max: 20 })
    if (status !== 'executing' && status !== 'committed' && status !== 'refused') {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar service reported an unknown operation status.', { operationId: id })
    }
    if (route.authority_id !== null && record.authority_id !== undefined && record.authority_id !== route.authority_id) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'The operation status belongs to a different authority.', { operationId: id })
    }
    const journalRecord = this.journal.get(id)
    if (journalRecord) {
      this.#reconcileJournal(journalRecord, record, status)
    }
    this.#logOperation(id, status)
    return {
      operation_id: id,
      status,
      outcome: record.outcome ?? null,
      receipt: record.receipt ?? null,
      result: record.result ?? null,
      error: record.error ?? null,
      commit_sequence: record.commit_sequence ?? null,
      business_date: record.business_date ?? null
    }
  }

  /**
   * @param {IntentRecord} journalRecord
   * @param {Record<string, unknown>} status
   * @param {string} state
   */
  #reconcileJournal(journalRecord, status, state) {
    try {
      if (state === 'committed') {
        if (journalRecord.state !== INTENT_STATES.COMMITTED_LOCAL) {
          const receipt = requirePayload(status.receipt, 'operation.receipt')
          const result = status.result === undefined || status.result === null ? null : requirePayload(status.result, 'operation.result')
          if (journalRecord.state === INTENT_STATES.SENDING || journalRecord.state === INTENT_STATES.OUTCOME_UNKNOWN) {
            this.journal.markCommitted(journalRecord.operation_id, receipt, result)
          }
        }
      } else if (state === 'refused') {
        if (journalRecord.state === INTENT_STATES.SENDING || journalRecord.state === INTENT_STATES.OUTCOME_UNKNOWN) {
          const refusal = requirePayload(status.error, 'operation.error')
          this.journal.markRefused(journalRecord.operation_id, refusal)
        }
      } else if (state === 'executing' && journalRecord.state === INTENT_STATES.SENDING) {
        this.journal.markOutcomeUnknown(journalRecord.operation_id, 'OPERATION_EXECUTING')
      }
    } catch (error) {
      if (error instanceof BarLocalAdapterError && error.code === 'VALIDATION_FAILED') {
        this.#log('warn', { event: 'bar_local.journal_reconcile_skipped', operation_id: journalRecord.operation_id, code: error.code })
        return
      }
      throw error
    }
  }

  /**
   * Sends one authenticated administration request to the local service. The
   * renderer cannot choose the authority, endpoint or headers.
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {Payload|null} [body]
   * @returns {Promise<Record<string, unknown>>}
   */
  async #adminRequest(method, path, body = null) {
    const route = this.#localRoute(`admin:${method}:${path}`, true)
    const { session, credential } = await this.#requireAuth()
    const correlationId = this.#newCorrelationId()
    const response = method === 'GET'
      ? await this.transport.get(path, {
        token: session.token,
        deviceId: credential.device_id,
        correlationId
      })
      : await this.transport.post(path, body === null ? {} : body, {
        token: session.token,
        deviceId: credential.device_id,
        correlationId
      })
    if (response.too_large || response.parse_error || response.body === null) {
      throw new BarLocalAdapterError('UNKNOWN_OUTCOME', 'The local Bar administration reply could not be read safely. Check current administration status before retrying.', {
        status: response.status,
        correlationId
      })
    }
    const record = this.#expectObject(response.body, 'administration response')
    const error = normalizeErrorEnvelope(record, { status: response.status })
    if (error) throw error
    if (response.status < 200 || response.status >= 300) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar service refused the administration request.', {
        status: response.status,
        correlationId
      })
    }
    this.#assertAdministrationScope(record, route, credential)
    return record
  }

  /**
   * @param {Record<string, unknown>} record
   * @param {LocalRoute} route
   * @param {DeviceCredential} credential
   */
  #assertAdministrationScope(record, route, credential) {
    const envelopes = [record]
    for (const key of ['data', 'result']) {
      const nested = record[key]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) envelopes.push(/** @type {Record<string, unknown>} */ (nested))
    }
    for (const envelope of envelopes) {
      if (envelope.authority_id !== undefined && envelope.authority_id !== route.authority_id) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY', 'The administration response belongs to a different authority.')
      }
      if (envelope.authority_epoch !== undefined && envelope.authority_epoch !== route.authority_epoch) {
        throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The administration response belongs to a different authority epoch.')
      }
      const scope = envelope.scope
      if (scope === undefined || scope === null) continue
      const scoped = requirePayload(scope, 'administration.scope')
      if (scoped.business_id !== undefined && scoped.business_id !== route.business_id) {
        throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The administration response belongs to a different business.')
      }
      if (scoped.outlet_id !== undefined && scoped.outlet_id !== route.outlet_id) {
        throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The administration response belongs to a different outlet.')
      }
      if (scoped.device_id !== undefined && scoped.device_id !== credential.device_id) {
        throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The administration response belongs to a different device.')
      }
    }
  }

  /** @returns {Promise<Record<string, unknown>>} */
  async adminStatus() {
    return this.#adminRequest('GET', '/v1/admin/status')
  }

  /** @returns {Promise<Record<string, unknown>>} */
  async adminBackups() {
    return this.#adminRequest('GET', '/v1/admin/backup')
  }

  /**
   * @param {{ label?: string }|string} [request]
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminRunBackup(request = {}) {
    const label = typeof request === 'string' ? request : request?.label
    const body = label === undefined || label === null || String(label).trim() === ''
      ? {}
      : { label: requireString(label, 'label', { max: 120 }) }
    return this.#adminRequest('POST', '/v1/admin/backup', body)
  }

  /**
   * @param {{ file_name?: string }|string} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminVerifyBackup(request) {
    const fileName = typeof request === 'string' ? request : request?.file_name
    return this.#adminRequest('POST', '/v1/admin/backup/verify', {
      file_name: requireString(fileName, 'file_name', { max: 255 })
    })
  }

  /**
   * @param {{ file_name?: string, authorized_by?: string, reason?: string, confirm?: string }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminRestoreDrill(request) {
    const payload = requirePayload(request, 'restore drill request')
    if (payload.confirm !== 'RESTORE_DRILL') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'Type RESTORE_DRILL to confirm a restore drill.')
    }
    return this.#adminRequest('POST', '/v1/admin/backup/restore-drill', {
      confirm: 'RESTORE_DRILL',
      file_name: requireString(payload.file_name, 'file_name', { min: 1, max: 255 }),
      authorized_by: requireString(payload.authorized_by, 'authorized_by', { min: 3, max: 120 }),
      reason: requireString(payload.reason, 'reason', { min: 8, max: 500 })
    })
  }

  /** @returns {Promise<Record<string, unknown>>} */
  async adminReplicationStatus() {
    return this.#adminRequest('GET', '/v1/admin/replication')
  }

  /**
   * @param {{ profile?: string }|string} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminSetDurability(request) {
    const profile = typeof request === 'string' ? request : request?.profile
    return this.#adminRequest('POST', '/v1/admin/replication/durability', {
      profile: requireString(profile, 'profile', { max: 40 })
    })
  }

  /**
   * @param {{ confirm?: string, reason?: string }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminSwitchover(request) {
    const payload = requirePayload(request, 'switchover request')
    if (payload.confirm !== 'SWITCHOVER') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'Type SWITCHOVER to confirm a replication switchover.')
    }
    return this.#adminRequest('POST', '/v1/admin/replication/switchover', {
      confirm: 'SWITCHOVER',
      reason: requireString(payload.reason, 'reason', { min: 3, max: 500 })
    })
  }

  /** @returns {Promise<Record<string, unknown>>} */
  async adminUpdateStatus() {
    return this.#adminRequest('GET', '/v1/admin/update')
  }

  async adminRecoveryStatus() {
    return this.#adminRequest('GET', '/v1/admin/recovery')
  }
  async adminCopyRecoverySet(request) {
    return this.#adminRequest('POST', '/v1/admin/recovery/copy', request)
  }
  async adminSetRecoveryDestination(request) {
    return this.#adminRequest('POST', '/v1/admin/recovery/destination', request)
  }
  async adminRecoveryJob(id) {
    return this.#adminRequest('GET', `/v1/admin/recovery/job?id=${encodeURIComponent(requireString(id, 'id', { max: 36 }))}`)
  }
  async adminCreateRecoveryBase(request) {
    return this.#adminRequest('POST', '/v1/admin/recovery/base', request)
  }
  async adminVerifyRecoveryPoint(request) {
    return this.#adminRequest('POST', '/v1/admin/recovery/drill', request)
  }
  async adminExportRecoveryKeys(request) {
    return this.#adminRequest('POST', '/v1/admin/recovery/keys', request)
  }

  /** @param {{ package: string, confirm: 'STAGE_UPDATE' }} request */
  async adminStageUpdate(request) {
    const packageName = requireString(request.package, 'package', { max: 160 })
    if (packageName === '.' || packageName === '..' || packageName.startsWith('.') || /[\\/]/.test(packageName) || packageName.includes('\0')) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'package must be a visible update inbox directory name without path separators.')
    }
    if (request.confirm !== 'STAGE_UPDATE') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'confirm must be STAGE_UPDATE.')
    }
    return this.#adminRequest('POST', '/v1/admin/update/stage', {
      package: packageName,
      confirm: 'STAGE_UPDATE'
    })
  }

  /** @param {{ confirm: 'APPLY_UPDATE', authorized_by: string, reason: string }} request */
  async adminApplyUpdate(request) {
    if (request.confirm !== 'APPLY_UPDATE') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'confirm must be APPLY_UPDATE.')
    }
    return this.#adminRequest('POST', '/v1/admin/update/apply', {
      confirm: 'APPLY_UPDATE',
      authorized_by: requireString(request.authorized_by, 'authorized_by', { min: 3, max: 120 }),
      reason: requireString(request.reason, 'reason', { min: 8, max: 500 })
    })
  }

  /**
   * Durable cloud-sync status as reported by the local authority. A local
   * export is not an upload; only the receiver's ingested state advances the
   * acknowledged watermark.
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminCloudSyncStatus() {
    return this.#adminRequest('GET', '/v1/admin/cloud-sync')
  }

  /**
   * @param {{
   *   enabled?: boolean,
   *   receiver_url?: string|null,
   *   schedule_mode?: 'fifteen_minutes'|'daily',
   *   daily_at?: string|null,
   *   batch_limit?: number,
   *   signing_key_id?: string|null
   * }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminCloudSyncConfig(request) {
    const payload = requirePayload(request, 'cloud sync configuration')
    /** @type {Record<string, unknown>} */
    const body = {}
    if (payload.enabled !== undefined) {
      if (typeof payload.enabled !== 'boolean') {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'enabled must be true or false.')
      }
      body.enabled = payload.enabled
    }
    if (payload.receiver_url === null) {
      body.receiver_url = null
    } else if (payload.receiver_url !== undefined) {
      body.receiver_url = requireString(payload.receiver_url, 'receiver_url', { max: 500 })
    }
    if (payload.schedule_mode !== undefined) {
      const mode = requireString(payload.schedule_mode, 'schedule_mode', { max: 40 })
      if (mode !== 'fifteen_minutes' && mode !== 'daily') {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'schedule_mode must be fifteen_minutes or daily.')
      }
      body.schedule_mode = mode
    }
    if (payload.daily_at !== undefined && payload.daily_at !== null) {
      const dailyAt = requireString(payload.daily_at, 'daily_at', { min: 5, max: 5 })
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyAt)) {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'daily_at must be a 24-hour time such as 23:30.')
      }
      body.daily_at = dailyAt
    }
    if (payload.batch_limit !== undefined) {
      body.batch_limit = requireInteger(payload.batch_limit, 'batch_limit', { min: 1, max: 1000 })
    }
    if (payload.signing_key_id === null) {
      body.signing_key_id = null
    } else if (payload.signing_key_id !== undefined) {
      body.signing_key_id = requireString(payload.signing_key_id, 'signing_key_id', { max: 120 })
    }
    return this.#adminRequest('POST', '/v1/admin/cloud-sync/config', body)
  }

  /**
   * Requests one bounded upload pass. It never blocks local trade and never
   * converts a timeout into a new identity.
   * @param {{ final?: boolean }} [request]
   * @returns {Promise<Record<string, unknown>>}
   */
  async adminCloudSyncRun(request = {}) {
    const payload = requirePayload(request, 'cloud sync run request')
    if (payload.final !== undefined && typeof payload.final !== 'boolean') {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'final must be true or false.')
    }
    return this.#adminRequest('POST', '/v1/admin/cloud-sync/run', payload.final === true ? { final: true } : {})
  }

  /**
   * @param {string} queryName
   * @param {Payload} [filters]
   * @returns {Promise<Record<string, unknown>>}
   */
  async query(queryName, filters = {}) {
    const name = requireString(queryName, 'query', { max: 80 })
    this.#assertAllowedQuery(name)
    const route = this.#localRoute(`query:${name}`, false)
    const { session, credential } = await this.#requireAuth()
    const response = await this.transport.post(`/v1/queries/${encodeURIComponent(name)}`, {
      contract_version: 1,
      authority_id: route.authority_id,
      authority_epoch: route.authority_epoch,
      query: name,
      query_version: 1,
      filters: requirePayload(filters, 'filters')
    }, {
      token: session.token,
      deviceId: credential.device_id,
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'query response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    const validated = this.#validateQueryResult(body, route, credential)
    return validated
  }

  /**
   * @param {Record<string, unknown>} body
   * @param {LocalRoute} route
   * @param {DeviceCredential} credential
   * @returns {Record<string, unknown>}
   */
  #validateQueryResult(body, route, credential) {
    if (!Array.isArray(body.data) && (body.data === null || typeof body.data !== 'object')) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar query returned an invalid data section.')
    }
    const pagination = requirePayload(body.pagination, 'query.pagination')
    if (typeof pagination.next_cursor !== 'string' && pagination.next_cursor !== null && pagination.next_cursor !== undefined) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar query returned an invalid pagination cursor.')
    }
    if (typeof pagination.has_more !== 'boolean') {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar query returned invalid pagination metadata.')
    }
    if (!Number.isSafeInteger(body.snapshot_watermark) || /** @type {number} */ (body.snapshot_watermark) < 0) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar query returned an invalid snapshot watermark.')
    }
    if (typeof body.as_of !== 'string' || typeof body.complete !== 'boolean' || !Array.isArray(body.unavailable)) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar query returned incomplete metadata.')
    }
    const scope = requirePayload(body.scope, 'query.scope')
    if (scope.business_id !== route.business_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local Bar query was answered for a different business.')
    }
    if (scope.outlet_id !== route.outlet_id) {
      throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The local Bar query was answered for a different outlet.')
    }
    if (scope.device_id !== credential.device_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local Bar query was answered for a different device.')
    }
    return body
  }

  /**
   * @param {{ after?: number, limit?: number }} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async events(options = {}) {
    const route = this.#localRoute('events', true)
    const { session, credential } = await this.#requireAuth()
    this.#assertSessionScope(session, route)
    const after = requireInteger(options.after ?? 0, 'after', { min: 0 })
    const limit = requireInteger(options.limit ?? 200, 'limit', { min: 1, max: 1000 })
    const response = await this.transport.get('/v1/events', {
      token: session.token,
      deviceId: credential.device_id,
      query: { after: String(after), limit: String(limit) },
      correlationId: this.#newCorrelationId()
    })
    const body = this.#expectObject(response.body, 'event feed response')
    const error = normalizeErrorEnvelope(body, { status: response.status })
    if (error) throw error
    if (!Array.isArray(body.events)) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar event feed is missing its events.')
    }
    for (const [index, rawEvent] of body.events.entries()) {
      const event = this.#expectObject(rawEvent, `events[${index}]`)
      requireInteger(event.commit_sequence, `events[${index}].commit_sequence`, { min: 0 })
      requireInteger(event.event_index, `events[${index}].event_index`, { min: 0 })
      requireString(event.event_type, `events[${index}].event_type`, { max: 120 })
    }
    const nextCursor = requireInteger(body.next_cursor, 'events.next_cursor', { min: 0 })
    const latestCommit = requireInteger(body.latest_commit_sequence, 'events.latest_commit_sequence', { min: 0 })
    const latestEvent = requireInteger(body.latest_event_sequence, 'events.latest_event_sequence', { min: 0 })
    const gapDetected = body.gap_detected === true
    if (gapDetected) {
      const floor = body.retention_floor_sequence
      if (!Number.isSafeInteger(floor) || /** @type {number} */ (floor) < 0) {
        throw new BarLocalAdapterError('INTERNAL_ERROR', 'A gapped local Bar event feed must report its retention floor.')
      }
    }
    const scope = requirePayload(body.scope, 'events.scope')
    if (scope.business_id !== route.business_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local Bar event feed was answered for a different business.')
    }
    if (scope.outlet_id !== route.outlet_id) {
      throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The local Bar event feed was answered for a different outlet.')
    }
    if (scope.device_id !== credential.device_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The local Bar event feed was answered for a different device.')
    }
    if (body.authority_id !== undefined && body.authority_id !== route.authority_id) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY', 'The local Bar event feed belongs to a different authority.')
    }
    if (body.authority_epoch !== undefined && body.authority_epoch !== route.authority_epoch) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The local Bar event feed belongs to a different authority epoch.')
    }
    if (!gapDetected && nextCursor < after) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The local Bar event feed cursor moved backwards.')
    }
    return {
      events: body.events,
      event_count: body.event_count,
      next_cursor: nextCursor,
      latest_commit_sequence: latestCommit,
      latest_event_sequence: latestEvent,
      retention_floor_sequence: body.retention_floor_sequence ?? null,
      gap_detected: gapDetected,
      complete: body.complete === true,
      scope
    }
  }

  /**
   * Advances the local event cursor only when the feed has no gap. A gap
   * leaves the cursor in place and requires an explicit resync.
   * @returns {Promise<Record<string, unknown>>}
   */
  async pollEvents() {
    const before = this.eventCursor
    const feed = await this.events({ after: before, limit: 200 })
    if (feed.gap_detected === true) {
      this.resyncRequired = true
      this.catalogueInvalidated = true
      this.catalogueGap = {
        reason: 'event_feed_gap',
        requested_after: before,
        retention_floor_sequence: feed.retention_floor_sequence,
        latest_commit_sequence: feed.latest_commit_sequence,
        latest_event_sequence: feed.latest_event_sequence
      }
      this.catalogueInvalidation = this.catalogueGap
      this.#log('warn', {
        event: 'bar_local.event_gap',
        cursor: this.eventCursor,
        retention_floor_sequence: feed.retention_floor_sequence
      })
      return {
        ...feed,
        cursor: this.eventCursor,
        resync_required: true,
        catalogue_invalidated: this.catalogueInvalidated
      }
    }
    const catalogueEvents = feed.events.filter((event) => isCatalogueEventType(event.event_type))
    if (catalogueEvents.length > 0) {
      const latest = catalogueEvents[catalogueEvents.length - 1]
      const commitSequence = /** @type {number} */ (latest.commit_sequence)
      this.catalogueInvalidatedThrough = Math.max(this.catalogueInvalidatedThrough, commitSequence)
      this.catalogueInvalidated = true
      this.catalogueInvalidation = {
        reason: 'catalogue_event',
        event_type: latest.event_type,
        commit_sequence: commitSequence,
        operation_id: latest.operation_id ?? null,
        event_count: catalogueEvents.length
      }
      this.#log('info', {
        event: 'bar_local.catalogue_invalidated',
        event_type: latest.event_type,
        commit_sequence: commitSequence
      })
    }
    this.eventCursor = /** @type {number} */ (feed.next_cursor)
    return {
      ...feed,
      cursor: this.eventCursor,
      resync_required: this.resyncRequired,
      catalogue_invalidated: this.catalogueInvalidated
    }
  }

  /**
   * @param {number} cursor
   */
  resetEventCursor(cursor = 0) {
    const hadGap = this.resyncRequired
    this.eventCursor = requireInteger(cursor, 'cursor', { min: 0 })
    this.resyncRequired = false
    this.catalogueGap = null
    if (hadGap) {
      this.catalogueInvalidated = true
      this.catalogueInvalidation = { reason: 'resync_cursor_reset', commit_sequence: this.eventCursor }
    }
    return this.eventCursor
  }

  /**
   * Reports the catalogue invalidation state without contacting the service.
   * @returns {Record<string, unknown>}
   */
  catalogueStatus() {
    return {
      invalidated: this.catalogueInvalidated,
      resync_required: this.resyncRequired,
      retention_floor_sequence: this.catalogueGap === null
        ? null
        : this.catalogueGap.retention_floor_sequence ?? null,
      event_cursor: this.eventCursor,
      invalidated_through: this.catalogueInvalidatedThrough,
      snapshot_watermark: this.catalogueSnapshot === null ? null : this.catalogueSnapshot.snapshot_watermark,
      has_snapshot: this.catalogueSnapshot !== null,
      refresh_in_flight: this.catalogueRefreshInFlight !== null,
      invalidation: this.catalogueInvalidation
    }
  }

  /**
   * Reloads the complete catalogue through the bounded local query contract.
   * The event cursor drives invalidation: an unchanged snapshot is reused, a
   * feed gap fails closed until the caller explicitly resets the cursor, and
   * concurrent callers share one in-flight load. There is no cloud fallback.
   * @param {{
   *   filters?: Record<string, unknown>,
   *   page_size?: number,
   *   max_pages?: number,
   *   previous_snapshot?: CatalogueSnapshot|null,
   *   catalogue_version?: number|null,
   *   query_name?: string,
   *   force?: boolean
   * }} [options]
   * @returns {Promise<{
   *   snapshot: CatalogueSnapshot,
   *   reused: boolean,
   *   resync_required: boolean,
   *   retention_floor_sequence: number|null,
   *   event_cursor: number,
   *   catalogue_invalidated: boolean
   * }>}
   */
  async refreshCatalogueSnapshot(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'Catalogue refresh options must be an object.')
    }
    const queryName = options.query_name ?? CATALOGUE_QUERY
    this.#assertAllowedQuery(queryName)
    const pageSize = requireInteger(options.page_size ?? 200, 'page_size', { min: 1, max: 1000 })
    const maxPages = requireInteger(
      options.max_pages ?? MAX_CATALOGUE_REFRESH_PAGES,
      'max_pages',
      { min: 1, max: MAX_CATALOGUE_REFRESH_PAGES }
    )
    const route = this.#localRoute('catalogue.refresh', true)
    const { session, credential } = await this.#requireAuth()
    this.#assertSessionScope(session, route)
    if (this.resyncRequired) {
      throw new BarLocalAdapterError('CATALOGUE_RESYNC_REQUIRED', 'The local event feed lost history; reset the event cursor and reload the complete catalogue before selling.', {
        retrySameOperation: false,
        details: {
          resync_required: true,
          event_cursor: this.eventCursor,
          retention_floor_sequence: this.catalogueGap === null
            ? null
            : this.catalogueGap.retention_floor_sequence ?? null
        }
      })
    }
    if (options.force !== true && !this.catalogueInvalidated && this.catalogueSnapshot !== null) {
      return {
        snapshot: /** @type {CatalogueSnapshot} */ (this.catalogueSnapshot),
        reused: true,
        resync_required: false,
        retention_floor_sequence: null,
        event_cursor: this.eventCursor,
        catalogue_invalidated: this.catalogueInvalidated
      }
    }
    if (this.catalogueRefreshInFlight !== null) {
      return this.catalogueRefreshInFlight
    }
    const refresh = this.#refreshCatalogue(route, session, credential, {
      query_name: queryName,
      filters: options.filters ?? {},
      page_size: pageSize,
      max_pages: maxPages,
      previous_snapshot: options.previous_snapshot ?? this.catalogueSnapshot,
      catalogue_version: options.catalogue_version ?? null
    })
    this.catalogueRefreshInFlight = refresh
    try {
      return await refresh
    } finally {
      if (this.catalogueRefreshInFlight === refresh) this.catalogueRefreshInFlight = null
    }
  }

  /**
   * @param {LocalRoute} route
   * @param {SessionState} session
   * @param {DeviceCredential} credential
   * @param {{
   *   query_name: string,
   *   filters: Record<string, unknown>,
   *   page_size: number,
   *   max_pages: number,
   *   previous_snapshot: CatalogueSnapshot|null,
   *   catalogue_version: number|null
   * }} options
   * @returns {Promise<{
   *   snapshot: CatalogueSnapshot,
   *   reused: boolean,
   *   resync_required: boolean,
   *   retention_floor_sequence: number|null,
   *   event_cursor: number,
   *   catalogue_invalidated: boolean
   * }>}
   */
  async #refreshCatalogue(route, session, credential, options) {
    const snapshot = await loadCatalogueSnapshot(
      (name, filters) => this.query(name, filters),
      {
        filters: options.filters,
        query_name: options.query_name,
        page_size: options.page_size,
        max_pages: options.max_pages,
        previous_snapshot: options.previous_snapshot,
        catalogue_version: options.catalogue_version
      }
    )
    const confirmed = this.#localRoute('catalogue.refresh', true)
    this.#assertSessionScope(session, confirmed)
    if (
      confirmed.authority_id !== route.authority_id
      || confirmed.authority_epoch !== route.authority_epoch
      || confirmed.business_id !== route.business_id
      || confirmed.outlet_id !== route.outlet_id
    ) {
      throw new BarLocalAdapterError('WRONG_AUTHORITY_EPOCH', 'The local authority changed while the catalogue was loading; reload the catalogue.')
    }
    const scope = requirePayload(snapshot.scope, 'catalogue.scope')
    if (scope.business_id !== route.business_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The catalogue snapshot belongs to a different business.')
    }
    if (scope.outlet_id !== route.outlet_id) {
      throw new BarLocalAdapterError('OUTLET_SCOPE_MISMATCH', 'The catalogue snapshot belongs to a different outlet.')
    }
    if (scope.device_id !== credential.device_id) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The catalogue snapshot belongs to a different device.')
    }
    if (
      scope.actor_staff_id !== undefined
      && session.staff.staff_id !== undefined
      && scope.actor_staff_id !== session.staff.staff_id
    ) {
      throw new BarLocalAdapterError('TENANT_SCOPE_MISMATCH', 'The catalogue snapshot belongs to a different staff member.')
    }
    if (snapshot.complete !== true) {
      throw new BarLocalAdapterError('CATALOGUE_INCOMPLETE', 'The catalogue snapshot is not complete.')
    }
    if (snapshot.page_count < 1 || snapshot.page_count > options.max_pages) {
      throw new BarLocalAdapterError('CATALOGUE_LIMIT_EXCEEDED', 'The catalogue snapshot exceeded the bounded refresh limit.')
    }
    if (this.resyncRequired) {
      this.catalogueInvalidated = true
    } else if (snapshot.snapshot_watermark >= this.catalogueInvalidatedThrough) {
      this.catalogueInvalidated = false
    }
    this.catalogueSnapshot = snapshot
    this.#log('info', {
      event: 'bar_local.catalogue_refreshed',
      snapshot_watermark: snapshot.snapshot_watermark,
      page_count: snapshot.page_count,
      catalogue_invalidated: this.catalogueInvalidated
    })
    return {
      snapshot,
      reused: false,
      resync_required: this.resyncRequired,
      retention_floor_sequence: this.catalogueGap === null
        ? null
        : this.catalogueGap.retention_floor_sequence ?? null,
      event_cursor: this.eventCursor,
      catalogue_invalidated: this.catalogueInvalidated
    }
  }

  /**
   * @returns {Promise<Record<string, unknown>>}
   */
  async healthLive() {
    const response = await this.transport.get('/v1/health/live', { correlationId: this.#newCorrelationId() })
    const body = this.#expectObject(response.body, 'liveness response')
    return body
  }

  /**
   * @returns {Promise<Record<string, unknown>>}
   */
  async healthReady() {
    this.#localRoute('health.ready', false)
    const { session, credential } = await this.#requireAuth()
    let response
    try {
      response = await this.transport.get('/v1/health/ready', {
        token: session.token,
        deviceId: credential.device_id,
        correlationId: this.#newCorrelationId()
      })
    } catch (error) {
      if (error instanceof BarLocalAdapterError) {
        this.router.markUnavailable(error.code)
      }
      throw error
    }
    const body = this.#expectObject(response.body, 'readiness response')
    if (typeof body.ready === 'boolean' && Array.isArray(body.blockers)) {
      this.router.markReadiness(body)
    }
    return body
  }

  /**
   * @param {{
   *   filters?: Record<string, unknown>,
   *   page_size?: number,
   *   max_pages?: number,
   *   previous_snapshot?: CatalogueSnapshot|null,
   *   catalogue_version?: number|null,
   *   query_name?: string
   * }} [options]
   * @returns {Promise<CatalogueSnapshot>}
   */
  fetchCatalogueSnapshot(options = {}) {
    const queryName = options.query_name ?? CATALOGUE_QUERY
    this.#assertAllowedQuery(queryName)
    return loadCatalogueSnapshot((name, filters) => this.query(name, filters), options)
  }

  /**
   * @param {unknown} cart
   * @param {CatalogueSnapshot} snapshot
   */
  checkCart(cart, snapshot) {
    return checkCartAgainstSnapshot(cart, snapshot)
  }

  close() {
    this.transport.close()
    this.journal.close()
  }
}

/**
 * @param {ConstructorParameters<typeof BarLocalClient>[0]} options
 * @returns {BarLocalClient}
 */
export function createBarLocalClient(options) {
  return new BarLocalClient(options)
}
