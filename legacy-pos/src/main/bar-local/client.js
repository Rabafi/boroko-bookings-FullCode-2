import http from 'http';
import https from 'https';
import { URL } from 'url';
import {
  INTENT_AUTHORITY_MODE,
  IntentJournalError,
  isUuid,
  operationPayloadHash,
  randomUuid
} from './intents.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fixed allowlists keep the Legacy adapter a thin client. A name is sent only
// when the local service registry offers that exact versioned contract.
export const ALLOWED_COMMANDS = Object.freeze(new Set([
  'sale.commit', 'sale.return', 'sale.void', 'sale.correct_after_close', 'tab.open', 'tab.add', 'tab.settle',
  'tab.transfer', 'tab.split', 'tab.merge', 'shift.open', 'shift.close',
  'drawer.movement', 'cashup.submit', 'cashup.review', 'cashup.reopen',
  'stock.receive', 'stock.adjust', 'stock.stocktake', 'stock.waste', 'stock.lot.waste', 'stock.lot.release', 'stock.transfer',
  'supplier.upsert', 'purchase_order.create', 'purchase_order.cancel',
  'purchase_order.receive', 'customer.create', 'customer.credit.payment',
  'voucher.issue', 'catalogue.upsert', 'catalogue.availability.set',
  'expense.create', 'expense.void', 'accounting.account.upsert',
  'control.checklist.start', 'control.checklist.item.set', 'control.incident.log',
  'control.incident.resolve', 'workforce.shift.schedule', 'workforce.shift.cancel',
  'workforce.clock.in', 'workforce.clock.out', 'staff.create', 'staff.status',
  'settings.update', 'accounting.journal.post', 'accounting.period.close',
  'catalogue.modifier_group.upsert', 'catalogue.modifier_option.upsert',
  'catalogue.product_modifier.set', 'catalogue.recipe.set', 'promotion.upsert',
  'loyalty.program.upsert', 'loyalty.account.enrol', 'loyalty.points.earn',
  'loyalty.points.redeem', 'loyalty.points.adjust', 'workforce.tip.allocate',
  'workforce.tip.payout', 'workforce.tip.payout.reverse', 'support.report.create',
  'export.bundle.create', 'accounting.ap.invoice.upsert', 'accounting.ap.invoice.approve',
  'accounting.ap.payment.post', 'accounting.ap.payment.reverse',
  'accounting.bank_account.upsert', 'accounting.bank_statement.import',
  'accounting.bank.reconcile', 'accounting.tax_code.upsert',
  'accounting.tax_return.prepare', 'accounting.payroll_run.create',
  'accounting.payroll_run.prepare', 'accounting.payroll_run.finalise',
  'accounting.budget.upsert'
]));

export const ALLOWED_QUERIES = Object.freeze(new Set([
  'accounting.records',
  'drawer.open_shifts',
  'workforce.tip_payouts',
  'bootstrap', 'menu.list', 'menu.availability', 'menu.modifiers', 'menu.promotions', 'expenses.list', 'expense.get',
  'accounting.accounts.list', 'tabs.list', 'tab.get', 'sales.list',
  'reports.sales_summary', 'reports.stock', 'reports.cashup', 'reports.post_close_corrections',
  'control.templates.list', 'control.checklists.list', 'control.checklist.get',
  'control.incidents.list', 'workforce.roster', 'workforce.attendance.list',
  'workforce.attendance.current', 'sale.get', 'shift.current', 'cashup.summary',
  'stock.list', 'stock.lot_expiry', 'stock.lot_balances', 'suppliers.list', 'purchase_orders.list', 'purchase_order.get',
  'customers.list', 'vouchers.list', 'staff.list', 'audit.search', 'outbox.status', 'outbox.bundle.get', 'loyalty.programs.list', 'loyalty.account.get',
  'accounting.trial_balance', 'support.reports.list'
]));

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
});

const AMBIGUOUS_ERROR_CODES = new Set([
  'AUTH_REQUIRED', 'AUTH_INVALID', 'SESSION_EXPIRED', 'SESSION_REVOKED',
  'DEVICE_REVOKED', 'DEVICE_UNKNOWN', 'OPERATION_EXECUTING',
  'SERVICE_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'DISK_UNAVAILABLE',
  'UNKNOWN_OUTCOME', 'RECOVERY_REQUIRED', 'INTERNAL_ERROR'
]);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ADMIN_DURABILITY_PROFILES = new Set(['single_host', 'synchronous_one_standby']);
const BACKUP_FILE_RE = /^[^\\/:*?"<>|]+\.(blbkup|blb)$/i;
const SETUP_BODY_KEYS = new Set(['label']);
const VERIFY_BODY_KEYS = new Set(['file_name']);
const RESTORE_DRILL_BODY_KEYS = new Set(['file_name', 'authorized_by', 'reason', 'confirm']);
const DURABILITY_BODY_KEYS = new Set(['profile']);
const SWITCHOVER_BODY_KEYS = new Set(['confirm', 'reason']);
const CLOUD_SYNC_CONFIG_BODY_KEYS = new Set(['enabled', 'receiver_url', 'schedule_mode', 'daily_at', 'batch_limit', 'signing_key_id']);
const CLOUD_SYNC_TRANSPORTS = new Set(['disabled', 'local_test', 'approved']);
const CLOUD_SYNC_RUN_STATES = new Set(['disabled', 'not_primary', 'not_configured', 'busy', 'ok', 'failed']);

function adminRequestBody(value, allowed, name) {
  if (!plainObject(value)) {
    throw new LegacyBarLocalError('VALIDATION_FAILED', `${name} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', `The local administration field "${key}" is not accepted.`);
    }
  }
  return value;
}

function ambiguousStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function invalidCloudSyncStatus(detail) {
  return new LegacyBarLocalError('INVALID_RESPONSE', `The local service returned an unverified cloud synchronisation status${detail ? ` (${detail})` : ''}.`);
}

// The local authority is the only source of cloud-sync truth. Accept a status
// only when its counts and transport are well formed so the till never shows
// an invented "synced" or "pending" figure.
function validateCloudSyncStatus(value) {
  if (!plainObject(value) || typeof value.available !== 'boolean'
    || !CLOUD_SYNC_TRANSPORTS.has(value.transport)
    || typeof value.signing_secret_configured !== 'boolean') {
    throw invalidCloudSyncStatus();
  }
  if (value.available !== true) return value;
  for (const field of ['configured', 'enabled']) {
    if (typeof value[field] !== 'boolean') throw invalidCloudSyncStatus(field);
  }
  for (const field of [
    'pending_events', 'unbatched_events', 'prepared_batches', 'acknowledged_batches', 'failed_batches'
  ]) {
    const count = value[field];
    if (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count < 0)) {
      throw invalidCloudSyncStatus(field);
    }
  }
  for (const field of [
    'acknowledged_watermark', 'oldest_pending_sequence', 'batch_limit'
  ]) {
    const number = value[field];
    if (number !== undefined && number !== null && (!Number.isSafeInteger(number) || number < 0)) {
      throw invalidCloudSyncStatus(field);
    }
  }
  if (value.receiver_url !== undefined && value.receiver_url !== null && typeof value.receiver_url !== 'string') {
    throw invalidCloudSyncStatus('receiver_url');
  }
  if (value.latest_batch !== undefined && value.latest_batch !== null && !plainObject(value.latest_batch)) {
    throw invalidCloudSyncStatus('latest_batch');
  }
  return value;
}

// Accept both the command outcome refusal (`error` nested) and the HTTP error
// envelope (fields at the top level). Returns null for a body without a machine
// code so callers never invent a terminal result from an unknown shape.
function serviceFailure(body, status) {
  if (!plainObject(body)) return null;
  const nested = plainObject(body.error) ? body.error : body;
  const code = typeof nested.code === 'string' && nested.code.length > 0 ? nested.code : null;
  if (code === null) return null;
  const hasRetryFlag = typeof nested.retry_same_operation === 'boolean';
  const hasMessage = typeof nested.message === 'string' && nested.message.length > 0;
  return {
    code,
    message: hasMessage ? nested.message : 'The local Bar service refused the request.',
    has_message: hasMessage,
    has_retry_flag: hasRetryFlag,
    retry_same_operation: hasRetryFlag ? nested.retry_same_operation : ambiguousStatus(status),
    requires_manager: nested.requires_manager === true,
    operation_id: typeof body.operation_id === 'string' ? body.operation_id : null,
    correlation_id: typeof body.correlation_id === 'string' ? body.correlation_id : null
  };
}

function validReceipt(receipt, intent, operationId) {
  if (!plainObject(receipt)) return false;
  if (receipt.operation_id !== operationId || receipt.outcome !== 'committed_local') return false;
  for (const field of ['authority_id', 'authority_epoch', 'business_id', 'outlet_id', 'device_id']) {
    if (receipt[field] !== intent[field]) return false;
  }
  return Number.isSafeInteger(receipt.commit_sequence) && receipt.commit_sequence > 0
    && typeof receipt.actor_staff_id === 'string' && UUID_RE.test(receipt.actor_staff_id)
    && typeof receipt.business_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(receipt.business_date)
    && typeof receipt.server_committed_at === 'string' && !Number.isNaN(Date.parse(receipt.server_committed_at))
    && receipt.cloud_status === 'integration_disabled';
}

export class LegacyBarLocalError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'LegacyBarLocalError';
    this.code = code;
    this.status = options.status || 0;
    this.retry_same_operation = options.retry_same_operation === true;
    this.operation_id = options.operation_id || null;
    this.outcome_unknown = options.outcome_unknown === true;
  }
}

function fingerprint(value) {
  const normalized = String(value || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new LegacyBarLocalError('TLS_PIN_REQUIRED', 'A SHA-256 certificate fingerprint is required for the Legacy Bar local service.');
  }
  return normalized;
}

function endpoint(value, pinnedFingerprint) {
  let url;
  try { url = new URL(value); } catch {
    throw new LegacyBarLocalError('SERVICE_URL_INVALID', 'The local Bar service address is invalid.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new LegacyBarLocalError('SERVICE_URL_INVALID', 'The local Bar service address must not include credentials, a path, query or fragment.');
  }
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname.toLowerCase())) {
    throw new LegacyBarLocalError('TLS_REQUIRED', 'Legacy POS requires HTTPS with a pinned certificate for LAN connections.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LegacyBarLocalError('SERVICE_URL_INVALID', 'The local Bar service must use HTTP loopback or HTTPS.');
  }
  if (url.protocol === 'https:' && !pinnedFingerprint) {
    throw new LegacyBarLocalError('TLS_PIN_REQUIRED', 'A pinned server certificate is required for HTTPS pairing.');
  }
  return url;
}

function machineCode(body, status) {
  const nested = body && typeof body.error === 'object' ? body.error : body;
  return nested && typeof nested.code === 'string' ? nested.code : `HTTP_${status}`;
}

function message(body) {
  const nested = body && typeof body.error === 'object' ? body.error : body;
  return nested && typeof nested.message === 'string' ? nested.message : 'The local Bar service refused the request.';
}

export function createLegacyBarLocalTransport(options) {
  const pin = options.certificateFingerprint ? fingerprint(options.certificateFingerprint) : null;
  const base = endpoint(options.baseUrl, pin);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? Math.max(1000, Math.min(options.timeoutMs, 120000)) : 15000;
  const agent = base.protocol === 'https:'
    ? new https.Agent({
      keepAlive: true,
      rejectUnauthorized: false,
      checkServerIdentity(_host, cert) {
        const actual = String(cert && cert.fingerprint256 || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
        return actual === pin ? undefined : new Error('TLS_FINGERPRINT_MISMATCH');
      }
    })
    : new http.Agent({ keepAlive: true });

  function request(method, pathname, options = {}) {
    return new Promise((resolve, reject) => {
      const client = base.protocol === 'https:' ? https : http;
      const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), 'utf8');
      if (body && body.length > MAX_RESPONSE_BYTES) {
        reject(new LegacyBarLocalError('REQUEST_TOO_LARGE', 'The local Bar request exceeds the supported size.'));
        return;
      }
      const headers = {
        accept: 'application/json',
        'x-correlation-id': randomUuid(),
        ...(options.deviceToken ? { 'x-bar-device-token': options.deviceToken } : {}),
        ...(options.deviceId ? { 'x-bar-device-id': options.deviceId } : {}),
        ...(options.sessionToken ? { authorization: `Bearer ${options.sessionToken}` } : {}),
        ...(body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {})
      };
      const requestUrl = new URL(pathname, base);
      if (options.query !== undefined) {
        if (!plainObject(options.query)) {
          reject(new LegacyBarLocalError('VALIDATION_FAILED', 'Request query parameters must be a plain object.'));
          return;
        }
        for (const [key, value] of Object.entries(options.query)) {
          if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key) || (typeof value !== 'string' && typeof value !== 'number') || !String(value).length) {
            reject(new LegacyBarLocalError('VALIDATION_FAILED', 'A request query parameter is invalid.'));
            return;
          }
          requestUrl.searchParams.set(key, String(value));
        }
      }
      const req = client.request(requestUrl, { method, agent, headers }, (res) => {
        // Do not rely solely on Node's hostname verifier: this protocol trusts
        // an owner-confirmed certificate pin, including self-signed service
        // certificates, and must verify it before accepting any response body.
        if (base.protocol === 'https:') {
          const cert = res.socket && typeof res.socket.getPeerCertificate === 'function'
            ? res.socket.getPeerCertificate()
            : null;
          const actual = String(cert && cert.fingerprint256 || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
          if (actual !== pin) {
            req.destroy(new LegacyBarLocalError('TLS_FINGERPRINT_MISMATCH', 'The local Bar service certificate does not match the paired fingerprint.', {
              retry_same_operation: true,
              outcome_unknown: method === 'POST'
            }));
            return;
          }
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new LegacyBarLocalError('RESPONSE_TOO_LARGE', 'The local Bar service response exceeds the supported size.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(raw); } catch {
            reject(new LegacyBarLocalError('INVALID_RESPONSE', 'The local Bar service returned an invalid response.', { status: res.statusCode }));
            return;
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new LegacyBarLocalError('REQUEST_TIMEOUT', 'The local Bar request timed out.')));
      req.on('error', (error) => {
        const code = error.code === 'TLS_FINGERPRINT_MISMATCH' || error.message === 'TLS_FINGERPRINT_MISMATCH'
          ? 'TLS_FINGERPRINT_MISMATCH'
          : error.code === 'REQUEST_TIMEOUT' || error.message === 'REQUEST_TIMEOUT'
            ? 'UNKNOWN_OUTCOME'
            : 'SERVICE_UNAVAILABLE';
        reject(error instanceof LegacyBarLocalError ? error : new LegacyBarLocalError(code, code === 'TLS_FINGERPRINT_MISMATCH'
          ? 'The local Bar service certificate does not match the paired fingerprint.'
          : 'The local Bar service could not be reached.', { retry_same_operation: true, outcome_unknown: method === 'POST' }));
      });
      if (body) req.write(body);
      req.end();
    });
  }

  return Object.freeze({ request, close: () => agent.destroy(), fingerprint: pin, baseUrl: base.origin });
}

function validateScope(scope) {
  for (const field of ['authority_id', 'business_id', 'outlet_id', 'device_id']) {
    if (!isUuid(scope[field])) throw new LegacyBarLocalError('AUTHORITY_CONFIG_INVALID', `${field} must be a UUID.`);
  }
  if (!Number.isSafeInteger(scope.authority_epoch) || scope.authority_epoch < 1) {
    throw new LegacyBarLocalError('AUTHORITY_CONFIG_INVALID', 'authority_epoch must be a positive integer.');
  }
  if (typeof scope.deviceToken !== 'string' || scope.deviceToken.length < 20) {
    throw new LegacyBarLocalError('DEVICE_CREDENTIAL_UNAVAILABLE', 'The paired device credential is missing.');
  }
}

/** Complete a single-use pairing code and return main-process-only profile material. */
export async function completeLegacyBarPairing(options) {
  const transport = options.transport || createLegacyBarLocalTransport(options);
  const pairingCode = String(options.pairingCode || '');
  const deviceName = String(options.deviceName || '').trim();
  const provisioningId = String(options.provisioningId || '');
  const deviceToken = String(options.deviceToken || '');
  if (!/^\d{6,12}$/.test(pairingCode) || deviceName.length < 1 || deviceName.length > 120
    || !isUuid(provisioningId) || !/^bld_[A-Za-z0-9_-]{32,}$/.test(deviceToken)) {
    if (!options.transport) transport.close();
    throw new LegacyBarLocalError('VALIDATION_FAILED', 'A valid one-time pairing code and device name are required.');
  }
  try {
    const response = await transport.request('POST', '/v1/pairing/complete', {
      body: {
        pairing_code: pairingCode,
        name: deviceName,
        platform: 'legacy',
        provisioning_id: provisioningId,
        device_token: deviceToken,
        certificate_fingerprint: transport.fingerprint
      }
    });
    const body = response.body;
    if (response.status !== 201 || !body || body.ok !== true || body.outcome !== 'device_paired') {
      throw new LegacyBarLocalError(machineCode(body, response.status), message(body), { status: response.status });
    }
    if (!isUuid(body.authority_id) || !isUuid(body.business_id) || !isUuid(body.outlet_id)
      || !isUuid(body.device_id) || !Number.isSafeInteger(body.authority_epoch) || body.authority_epoch < 1) {
      throw new LegacyBarLocalError('PAIRING_RESPONSE_INVALID', 'The Bar service did not return a complete authority identity.');
    }
    if (transport.fingerprint && fingerprint(body.server_certificate_fingerprint) !== transport.fingerprint) {
      throw new LegacyBarLocalError('TLS_FINGERPRINT_MISMATCH', 'The paired service identity differs from the pinned certificate.');
    }
    return Object.freeze({
      profile: Object.freeze({
        authority_mode: INTENT_AUTHORITY_MODE,
        base_url: transport.baseUrl,
        certificate_fingerprint: transport.fingerprint,
        authority_id: body.authority_id,
        authority_epoch: body.authority_epoch,
        business_id: body.business_id,
        outlet_id: body.outlet_id,
        device_id: body.device_id
      }),
      deviceToken,
      transport
    });
  } catch (error) {
    if (!options.transport) transport.close();
    throw error;
  }
}

export class LegacyBarLocalClient {
  constructor(options) {
    validateScope(options.scope);
    if (!options.journal || typeof options.journal.createIntent !== 'function') {
      throw new LegacyBarLocalError('RECOVERY_REQUIRED', 'A durable Legacy Bar intent journal is required.');
    }
    this.scope = Object.freeze({ ...options.scope });
    this.transport = options.transport || createLegacyBarLocalTransport(options);
    this.journal = options.journal;
    this.sessionToken = null;
    this.sessionId = null;
  }

  async login(staffId, pin) {
    let body;
    if (staffId && typeof staffId === 'object' && !Array.isArray(staffId)) {
      const email = typeof staffId.email === 'string' ? staffId.email.trim().toLowerCase() : '';
      const password = typeof staffId.password === 'string' ? staffId.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'Enter the owner email and password.');
      }
      body = { email, password, outlet_id: this.scope.outlet_id };
    } else {
      if (!isUuid(staffId) || typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'Enter a valid local staff identity and numeric PIN.');
      }
      body = { staff_id: staffId, pin, outlet_id: this.scope.outlet_id };
    }
    const response = await this.transport.request('POST', '/v1/sessions', {
      deviceToken: this.scope.deviceToken,
      body
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || !plainObject(response.body)) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status), failure ? failure.message : message(response.body), { status: response.status });
    }
    const responseBody = response.body;
    if (responseBody.ok !== true
      || responseBody.authority_epoch !== this.scope.authority_epoch
      || responseBody.business_id !== this.scope.business_id
      || responseBody.outlet_id !== this.scope.outlet_id) {
      throw new LegacyBarLocalError('WRONG_AUTHORITY', 'The local login response does not match this till’s committed authority scope.', { status: response.status });
    }
    if (typeof responseBody.session_token !== 'string' || responseBody.session_token.length < 20
      || !isUuid(responseBody.session_id) || !plainObject(responseBody.staff)) {
      throw new LegacyBarLocalError('LOGIN_RESPONSE_INVALID', 'The local service did not return a complete staff session.', { status: response.status });
    }
    this.sessionToken = responseBody.session_token;
    this.sessionId = responseBody.session_id;
    return responseBody;
  }

  async logout() {
    if (!this.sessionToken) return { ok: true, outcome: 'already_logged_out' };
    try {
      await this.transport.request('POST', '/v1/sessions/revoke', {
        sessionToken: this.sessionToken,
        deviceToken: this.scope.deviceToken,
        deviceId: this.scope.device_id,
        body: { session_id: this.sessionId }
      });
    } finally {
      this.sessionToken = null;
      this.sessionId = null;
    }
    return { ok: true, outcome: 'logged_out' };
  }

  async startPairing(options = {}) {
    this.#requireSession();
    if (!plainObject(options)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Pairing options must be a plain object.');
    }
    const request = {};
    if (options.ttl_seconds !== undefined) {
      if (!Number.isInteger(options.ttl_seconds) || options.ttl_seconds < 60 || options.ttl_seconds > 900) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'ttl_seconds must be an integer between 60 and 900.');
      }
      request.ttl_seconds = options.ttl_seconds;
    }
    const response = await this.transport.request('POST', '/v1/pairing/start', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      body: request
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : 'INVALID_RESPONSE', failure ? failure.message : 'The local service did not start pairing.', { status: response.status });
    }
    const body = response.body;
    if (!plainObject(body) || body.ok !== true
      || typeof body.pairing_code !== 'string' || !/^\d{6,12}$/.test(body.pairing_code)
      || !Number.isSafeInteger(body.expires_in) || body.expires_in < 1) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an invalid pairing code response.', { status: response.status });
    }
    return { ok: true, pairing_code: body.pairing_code, expires_in: body.expires_in,
      server_certificate_fingerprint: typeof body.server_certificate_fingerprint === 'string' ? body.server_certificate_fingerprint : null,
      server_addresses: Array.isArray(body.server_addresses) ? body.server_addresses.filter(value => typeof value === 'string' && /^https:\/\//.test(value)).slice(0, 32) : [] };
  }

  async adminStatus() {
    const body = await this.#adminRequest('GET', '/v1/admin/status');
    const status = body.status;
    if (!plainObject(status)
      || !plainObject(status.service) || !plainObject(status.network) || !plainObject(status.replication)
      || !plainObject(status.backup) || !plainObject(status.update) || !plainObject(status.devices)
      || !plainObject(status.database) || typeof status.database.reachable !== 'boolean') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an incomplete administration status.');
    }
    return body;
  }

  async adminBackups() {
    const body = await this.#adminRequest('GET', '/v1/admin/backup');
    if (body.command !== 'backup-list' || !Array.isArray(body.packages)
      || (body.latest !== null && !plainObject(body.latest))) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified backup list.');
    }
    return body;
  }

  async adminRunBackup(request = {}) {
    const input = adminRequestBody(request, SETUP_BODY_KEYS, 'Backup request');
    let label = null;
    if (input.label !== undefined && input.label !== null) {
      if (typeof input.label !== 'string') {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'Backup label must be text.');
      }
      label = input.label.trim();
      if (label.length < 1 || label.length > 120) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'Backup label must be between 1 and 120 characters.');
      }
    }
    const body = await this.#adminRequest('POST', '/v1/admin/backup', label ? { label } : {});
    if (body.command !== 'backup' || !plainObject(body.backup)
      || typeof body.backup.file_name !== 'string' || !BACKUP_FILE_RE.test(body.backup.file_name)) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service did not return a verifiable backup result.');
    }
    return body;
  }

  async adminVerifyBackup(request) {
    const input = adminRequestBody(request, VERIFY_BODY_KEYS, 'Backup verification request');
    if (typeof input.file_name !== 'string') {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'A backup file name is required.');
    }
    const fileName = input.file_name.trim();
    if (fileName.length < 1 || fileName.length > 255 || !BACKUP_FILE_RE.test(fileName)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Enter the basename of a .blbkup or .blb backup package.');
    }
    const body = await this.#adminRequest('POST', '/v1/admin/backup/verify', { file_name: fileName });
    if (body.command !== 'backup-verify' || body.file_name !== fileName
      || body.integrity_verified !== true || typeof body.restore_verified !== 'boolean') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service return did not prove backup integrity for that exact package.');
    }
    return body;
  }

  async adminRestoreDrill(request) {
    const input = adminRequestBody(request, RESTORE_DRILL_BODY_KEYS, 'Restore drill request');
    if (input.confirm !== 'RESTORE_DRILL') {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Type RESTORE_DRILL to confirm a restore drill.');
    }
    if (typeof input.file_name !== 'string' || !BACKUP_FILE_RE.test(input.file_name.trim())) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Choose the basename of a .blbkup or .blb backup package.');
    }
    const fileName = input.file_name.trim();
    if (fileName.length < 1 || fileName.length > 255) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Enter the basename of a .blbkup or .blb backup package.');
    }
    if (typeof input.authorized_by !== 'string' || input.authorized_by.trim().length < 3 || input.authorized_by.trim().length > 120) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'The authorising owner or manager name must be between 3 and 120 characters.');
    }
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.trim().length > 500) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'A restore drill reason of 8 to 500 characters is required.');
    }
    const body = await this.#adminRequest('POST', '/v1/admin/backup/restore-drill', {
      confirm: 'RESTORE_DRILL',
      file_name: fileName,
      authorized_by: input.authorized_by.trim(),
      reason: input.reason.trim()
    });
    if (body.command !== 'backup-restore-drill' || body.status !== 'verified'
      || body.file_name !== fileName || !plainObject(body.verification)
      || typeof body.evidence_path !== 'string' || body.pitr_available !== false) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service did not return verified, timestamped restore drill evidence.');
    }
    return body;
  }

  async adminReplicationStatus() {
    const body = await this.#adminRequest('GET', '/v1/admin/replication');
    if (body.command !== 'replication-status'
      || !plainObject(body.replication) || !plainObject(body.config)) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an incomplete replication status.');
    }
    return body;
  }

  async adminSetDurability(request) {
    const input = adminRequestBody(request, DURABILITY_BODY_KEYS, 'Durability request');
    if (!ADMIN_DURABILITY_PROFILES.has(input.profile)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Durability profile must be single_host or synchronous_one_standby.');
    }
    const body = await this.#adminRequest('POST', '/v1/admin/replication/durability', { profile: input.profile });
    if (body.command !== 'replication-durability' || body.profile !== input.profile) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service did not confirm the requested durability profile.');
    }
    return body;
  }

  async adminSwitchover(request) {
    const input = adminRequestBody(request, SWITCHOVER_BODY_KEYS, 'Switchover request');
    if (input.confirm !== 'SWITCHOVER') {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Switchover confirmation must be the exact value SWITCHOVER.');
    }
    if (typeof input.reason !== 'string') {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'A switchover reason is required.');
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Switchover reason must be between 3 and 500 characters.');
    }
    this.#requireSession();
    const response = await this.transport.request('POST', '/v1/admin/replication/switchover', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      body: { confirm: 'SWITCHOVER', reason }
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status === 409 && plainObject(response.body) && plainObject(response.body.recovery)) {
      const recovery = response.body.recovery;
      const guidance = typeof recovery.message === 'string' ? recovery.message : 'Keep all clients stopped and complete manual recovery.';
      throw new LegacyBarLocalError(failure ? failure.code : 'REPLICATION_SWITCHOVER_FAILED',
        `${failure ? failure.message : 'The local replication switchover did not complete.'} ${guidance}`,
        { status: response.status, retry_same_operation: false });
    }
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status),
        failure ? failure.message : message(response.body), { status: response.status });
    }
    const body = response.body;
    if (!plainObject(body) || body.ok !== true || body.command !== 'replication-switchover'
      || !plainObject(body.promoted) || typeof body.client_repoint_required !== 'boolean') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service did not return a verified switchover result.');
    }
    return body;
  }

  async adminUpdateStatus() {
    const body = await this.#adminRequest('GET', '/v1/admin/update');
    if (body.command !== 'update-status' || typeof body.service_version !== 'string'
      || typeof body.update_available !== 'boolean' || typeof body.automatic_install_supported !== 'boolean') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an incomplete update status.');
    }
    return body;
  }

  /**
   * Cloud-sync status from the local authority. Only a receiver `ingested`
   * acknowledgement advances the acknowledged watermark; a saved local export
   * is not an upload and is not shown as accepted.
   */
  async adminCloudSyncStatus() {
    const body = await this.#adminRequest('GET', '/v1/admin/cloud-sync');
    if (body.command !== 'cloud-sync-status') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified cloud synchronisation response.');
    }
    return { ...body, status: validateCloudSyncStatus(body.status) };
  }

  async adminCloudSyncConfig(request) {
    const input = adminRequestBody(request, CLOUD_SYNC_CONFIG_BODY_KEYS, 'Cloud synchronisation configuration');
    const payload = {};
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'Cloud synchronisation enabled must be true or false.');
      }
      payload.enabled = input.enabled;
    }
    if (input.receiver_url !== undefined) {
      if (input.receiver_url !== null && typeof input.receiver_url !== 'string') {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'The receiver URL must be text or empty.');
      }
      let receiverUrl = input.receiver_url === null ? null : input.receiver_url.trim();
      if (receiverUrl !== null) {
        if (receiverUrl.length < 1 || receiverUrl.length > 500) {
          throw new LegacyBarLocalError('VALIDATION_FAILED', 'The receiver URL must be between 1 and 500 characters.');
        }
        let parsed;
        try { parsed = new URL(receiverUrl); } catch {
          throw new LegacyBarLocalError('VALIDATION_FAILED', 'The receiver URL must be a valid http or https address.');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new LegacyBarLocalError('VALIDATION_FAILED', 'The receiver URL must use http or https.');
        }
        receiverUrl = parsed.toString();
      }
      payload.receiver_url = receiverUrl;
    }
    if (input.schedule_mode !== undefined) {
      if (input.schedule_mode !== 'fifteen_minutes' && input.schedule_mode !== 'daily') {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'The schedule must be fifteen_minutes or daily.');
      }
      payload.schedule_mode = input.schedule_mode;
    }
    if (input.daily_at !== undefined && input.daily_at !== null) {
      if (typeof input.daily_at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.daily_at)) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'The daily sync time must use 24-hour HH:MM, for example 23:30.');
      }
      payload.daily_at = input.daily_at;
    }
    if (input.batch_limit !== undefined) {
      if (!Number.isInteger(input.batch_limit) || input.batch_limit < 1 || input.batch_limit > 1000) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'The batch limit must be a whole number between 1 and 1000.');
      }
      payload.batch_limit = input.batch_limit;
    }
    if (input.signing_key_id !== undefined) {
      if (input.signing_key_id !== null && (typeof input.signing_key_id !== 'string'
        || input.signing_key_id.trim().length < 1 || input.signing_key_id.trim().length > 120)) {
        throw new LegacyBarLocalError('VALIDATION_FAILED', 'The signing key identifier must be text between 1 and 120 characters, or empty.');
      }
      payload.signing_key_id = input.signing_key_id === null ? null : input.signing_key_id.trim();
    }
    const body = await this.#adminRequest('POST', '/v1/admin/cloud-sync/config', payload);
    if (body.command !== 'cloud-sync-config') {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified cloud synchronisation configuration response.');
    }
    return { ...body, status: validateCloudSyncStatus(body.status) };
  }

  /**
   * Requests one bounded upload pass. A failed pass is a reported operational
   * result with its durable status, not a fabricated success and not an
   * unverifiable refusal.
   */
  async adminCloudSyncRun(request = {}) {
    const input = adminRequestBody(request, new Set(['final']), 'Cloud synchronisation run request');
    if (input.final !== undefined && typeof input.final !== 'boolean') {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'final must be true or false.');
    }
    this.#requireSession();
    const response = await this.transport.request('POST', '/v1/admin/cloud-sync/run', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      body: input.final === true ? { final: true } : {}
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status),
        failure ? failure.message : message(response.body), { status: response.status });
    }
    if (!plainObject(response.body) || response.body.command !== 'cloud-sync-run'
      || !CLOUD_SYNC_RUN_STATES.has(response.body.status)
      || (response.body.ok !== undefined && typeof response.body.ok !== 'boolean')) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified cloud synchronisation run result.');
    }
    return {
      ...response.body,
      status_detail: response.body.status_detail === undefined || response.body.status_detail === null
        ? null
        : validateCloudSyncStatus(response.body.status_detail)
    };
  }

  async #adminRequest(method, pathname, body) {
    this.#requireSession();
    const response = await this.transport.request(method, pathname, {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      ...(body === undefined ? {} : { body })
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status),
        failure ? failure.message : message(response.body), { status: response.status });
    }
    if (!plainObject(response.body) || response.body.ok !== true) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified administration response.');
    }
    return response.body;
  }

  async query(name, filters = {}) {
    this.#requireSession();
    this.#assertAllowedQuery(name);
    if (!plainObject(filters)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Query filters must be a plain object.');
    }
    const response = await this.transport.request('POST', `/v1/queries/${encodeURIComponent(name)}`, {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      body: { contract_version: 1, authority_id: this.scope.authority_id, authority_epoch: this.scope.authority_epoch, filters }
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status), failure ? failure.message : message(response.body), { status: response.status });
    }
    const body = response.body;
    if (!plainObject(body) || body.ok !== true || (body.query !== undefined && body.query !== name)) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified query response.', { status: response.status });
    }
    return body;
  }

  async events(after = 0, limit = 200) {
    this.#requireSession();
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'The local menu event cursor is invalid.');
    }
    const response = await this.transport.request('GET', '/v1/events', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      query: { after: String(after), limit: String(limit) }
    });
    const body = response.body;
    const failure = serviceFailure(body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(body, response.status), failure ? failure.message : message(body), { status: response.status });
    }
    if (!plainObject(body) || body.ok !== true || !Array.isArray(body.events)
      || !Number.isSafeInteger(body.next_cursor) || body.next_cursor < 0
      || typeof body.gap_detected !== 'boolean'
      || !body.scope
      || body.scope.business_id !== this.scope.business_id
      || body.scope.outlet_id !== this.scope.outlet_id
      || body.scope.device_id !== this.scope.device_id) {
      throw new LegacyBarLocalError('EVENT_FEED_INVALID', 'The local Bar event feed is incomplete or outside this paired device scope.');
    }
    for (const [index, event] of body.events.entries()) {
      if (!plainObject(event) || !Number.isSafeInteger(event.commit_sequence) || event.commit_sequence < 0
        || !Number.isSafeInteger(event.event_index) || event.event_index < 0
        || typeof event.event_type !== 'string' || event.event_type.length > 120) {
        throw new LegacyBarLocalError('EVENT_FEED_INVALID', `The local Bar event at position ${index} is malformed.`);
      }
    }
    if (body.gap_detected && (!Number.isSafeInteger(body.retention_floor_sequence) || body.retention_floor_sequence < 0)) {
      throw new LegacyBarLocalError('EVENT_FEED_INVALID', 'The incomplete local event feed has no safe full-refresh cursor.');
    }
    if (!body.gap_detected && body.next_cursor < after) {
      throw new LegacyBarLocalError('EVENT_FEED_INVALID', 'The local menu event cursor moved backwards.');
    }
    return body;
  }

  async healthReady() {
    this.#requireSession();
    const response = await this.transport.request('GET', '/v1/health/ready', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id
    });
    if (!response.body || typeof response.body.ready !== 'boolean' || !Array.isArray(response.body.blockers)
      || response.body.authority_id !== this.scope.authority_id
      || response.body.authority_epoch !== this.scope.authority_epoch
      || response.body.business_id !== this.scope.business_id
      || response.body.outlet_id !== this.scope.outlet_id) {
      throw new LegacyBarLocalError('READINESS_INVALID', 'The local service returned an invalid readiness response.', { status: response.status });
    }
    return response.body;
  }

  async requestApproval(command, payload, pin, options = {}) {
    this.#requireSession();
    this.#assertAllowedCommand(command);
    if (!plainObject(payload)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'Approval payload must be an object.');
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'Enter the approving manager’s numeric PIN.');
    if (!plainObject(options) || (options.operationId !== undefined && !isUuid(options.operationId))) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Approval operation identity is invalid.');
    }
    const envelope = {
      contract_version: 1,
      authority_id: this.scope.authority_id,
      authority_epoch: this.scope.authority_epoch,
      business_id: this.scope.business_id,
      outlet_id: this.scope.outlet_id,
      device_id: this.scope.device_id,
      operation_id: options.operationId || randomUuid(),
      command,
      payload_version: 1,
      payload,
      expected_versions: options.expectedVersions || {},
      dependencies: options.dependencies || [],
      client_occurred_at: new Date().toISOString()
    };
    const capability = APPROVAL_CAPABILITY_BY_COMMAND[command];
    if (!capability) throw new LegacyBarLocalError('VALIDATION_FAILED', 'This local workflow has no registered approval capability.');
    const response = await this.transport.request('POST', '/v1/approvals', {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id,
      body: { operation: envelope, capability, pin, target_type: command }
    });
    const failure = serviceFailure(response.body, response.status);
    if (response.status < 200 || response.status >= 300 || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status), failure ? failure.message : message(response.body), { status: response.status });
    }
    const body = response.body;
    if (!plainObject(body) || body.ok !== true || !isUuid(body.approval_id)
      || body.operation_hash !== operationPayloadHash(envelope)) {
      throw new LegacyBarLocalError('APPROVAL_SCOPE_MISMATCH', 'The local authority did not prove that approval is bound to this exact operation.');
    }
    return { approval_id: body.approval_id, operation_id: envelope.operation_id, expires_in: body.expires_in };
  }

  async command(command, payload, options = {}) {
    this.#requireSession();
    this.#assertAllowedCommand(command);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'A registered command and object payload are required.');
    }
    if (!plainObject(options)) {
      throw new LegacyBarLocalError('VALIDATION_FAILED', 'Command options must be a plain object.');
    }
    const operationId = options.operationId || randomUuid();
    if (!isUuid(operationId)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'operationId must be a UUID.');
    const envelope = {
      contract_version: 1,
      authority_id: this.scope.authority_id,
      authority_epoch: this.scope.authority_epoch,
      business_id: this.scope.business_id,
      outlet_id: this.scope.outlet_id,
      device_id: this.scope.device_id,
      operation_id: operationId,
      command,
      payload_version: 1,
      payload,
      expected_versions: options.expectedVersions || {},
      dependencies: options.dependencies || [],
      client_occurred_at: new Date().toISOString()
    };
    const hash = operationPayloadHash(envelope);
    const prior = this.journal.getIntent(operationId);
    if (prior && prior.payload_hash !== hash) {
      throw new IntentJournalError('IDEMPOTENCY_PAYLOAD_CONFLICT', 'This operation ID already belongs to a different local command.');
    }
    if (prior && (prior.device_id !== this.scope.device_id || prior.authority_id !== this.scope.authority_id
      || prior.authority_epoch !== this.scope.authority_epoch || prior.business_id !== this.scope.business_id
      || prior.outlet_id !== this.scope.outlet_id)) {
      throw new LegacyBarLocalError('WRONG_AUTHORITY', 'The saved operation belongs to a different authority or device.', { operation_id: operationId });
    }
    if (prior && prior.state === 'committed') {
      return { ok: true, outcome: 'committed_local', replayed: true, operation_id: operationId, receipt: prior.receipt, result: prior.result };
    }
    if (prior && prior.state === 'refused') {
      return { ok: false, outcome: 'refused', replayed: true, operation_id: operationId, error: prior.error };
    }
    const unresolved = this.journal.listOpenIntents().find((intent) => intent.operation_id !== operationId);
    if (unresolved) {
      throw new LegacyBarLocalError('UNRESOLVED_OPERATION', 'Resolve the earlier local operation with its original ID before starting another operation.', {
        operation_id: unresolved.operation_id, retry_same_operation: true
      });
    }
    if (!prior) this.journal.createIntent({ operationId, envelope, payloadHash: hash, authorityMode: INTENT_AUTHORITY_MODE });
    return this.#dispatch(operationId);
  }

  async retry(operationId) {
    const intent = this.#requireScopedIntent(operationId);
    if (intent.state === 'committed') return { ok: true, outcome: 'committed_local', replayed: true, operation_id: operationId, receipt: intent.receipt, result: intent.result };
    if (intent.state === 'refused') return { ok: false, outcome: 'refused', operation_id: operationId, error: intent.error };
    this.#requireSession();
    return this.#dispatch(operationId);
  }

  /**
   * Resolve an unresolved operation from the authority's own record without
   * re-submitting it. The journal only moves to a terminal state when the
   * service returns a receipt or refusal that proves this exact operation.
   */
  async resolve(operationId) {
    this.#requireSession();
    if (!isUuid(operationId)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'operationId must be a UUID.');
    const intent = this.#requireScopedIntent(operationId);
    if (intent.state === 'committed') return { ok: true, outcome: 'committed_local', replayed: true, resolved: true, operation_id: operationId, receipt: intent.receipt, result: intent.result };
    if (intent.state === 'refused') return { ok: false, outcome: 'refused', replayed: true, resolved: true, operation_id: operationId, error: intent.error };
    const status = await this.getOperation(operationId);
    if (status.status === 'committed') {
      const receipt = status.receipt;
      if (!validReceipt(receipt, intent, operationId) || !plainObject(status.result)) {
        throw new LegacyBarLocalError('RECEIPT_INVALID', 'The local service did not prove this operation committed under the paired authority. Keep this operation and retry the same ID.', {
          operation_id: operationId, retry_same_operation: true, outcome_unknown: true
        });
      }
      this.journal.markCommitted(operationId, { receipt, result: status.result });
      return { ok: true, outcome: 'committed_local', replayed: true, resolved: true, operation_id: operationId, receipt, result: status.result };
    }
    if (status.status === 'refused') {
      const refusal = status.error;
      if (!plainObject(refusal) || typeof refusal.code !== 'string' || refusal.code.length < 1
        || typeof refusal.message !== 'string' || refusal.message.length < 1
        || refusal.retry_same_operation === true) {
        throw new LegacyBarLocalError('REFUSAL_INVALID', 'The local service returned an unverified refusal. Keep this operation and retry the same ID.', {
          operation_id: operationId, retry_same_operation: true, outcome_unknown: true
        });
      }
      const error = { code: refusal.code, message: refusal.message, retry_same_operation: false, requires_manager: refusal.requires_manager === true };
      this.journal.markRefused(operationId, error);
      return { ok: false, outcome: 'refused', replayed: true, resolved: true, operation_id: operationId, error };
    }
    return { ok: true, outcome: 'executing', resolved: false, operation_id: operationId, status: 'executing' };
  }

  async getOperation(operationId) {
    this.#requireSession();
    if (!isUuid(operationId)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'operationId must be a UUID.');
    const response = await this.transport.request('GET', `/v1/operations/${encodeURIComponent(operationId)}`, {
      sessionToken: this.sessionToken,
      deviceToken: this.scope.deviceToken,
      deviceId: this.scope.device_id
    });
    // A refused operation record carries an `error` field inside a successful
    // status response. That is the outcome being queried, not an HTTP failure.
    const succeeded = response.status >= 200 && response.status < 300
      && plainObject(response.body) && response.body.ok === true;
    const failure = succeeded ? null : serviceFailure(response.body, response.status);
    if (!succeeded || failure) {
      throw new LegacyBarLocalError(failure ? failure.code : machineCode(response.body, response.status), failure ? failure.message : message(response.body), { status: response.status, operation_id: operationId });
    }
    const body = response.body;
    if (!plainObject(body)
      || (body.operation_id !== undefined && body.operation_id !== operationId)
      || !['executing', 'committed', 'refused'].includes(body.status)) {
      throw new LegacyBarLocalError('INVALID_RESPONSE', 'The local service returned an unverified operation status.', { status: response.status, operation_id: operationId });
    }
    return body;
  }

  #requireScopedIntent(operationId) {
    if (!isUuid(operationId)) throw new LegacyBarLocalError('VALIDATION_FAILED', 'operationId must be a UUID.');
    const intent = this.journal.getIntent(operationId);
    if (!intent) throw new LegacyBarLocalError('OPERATION_NOT_FOUND', 'The original local operation is not in this till journal.', { operation_id: operationId });
    if (intent.device_id !== this.scope.device_id || intent.authority_id !== this.scope.authority_id
      || intent.authority_epoch !== this.scope.authority_epoch || intent.business_id !== this.scope.business_id
      || intent.outlet_id !== this.scope.outlet_id) {
      throw new LegacyBarLocalError('WRONG_AUTHORITY', 'The saved operation belongs to a different authority or device.', { operation_id: operationId });
    }
    return intent;
  }

  #requireSession() {
    if (!this.sessionToken) throw new LegacyBarLocalError('AUTH_REQUIRED', 'Log in to the local Bar authority first.');
  }

  #assertAllowedCommand(command) {
    if (typeof command !== 'string' || !ALLOWED_COMMANDS.has(command)) {
      throw new LegacyBarLocalError('COMMAND_NOT_REGISTERED', 'This command is not registered for local Bar authority.');
    }
  }

  #assertAllowedQuery(name) {
    if (typeof name !== 'string' || !ALLOWED_QUERIES.has(name)) {
      throw new LegacyBarLocalError('QUERY_NOT_REGISTERED', 'This query is not registered for local Bar authority.');
    }
  }

  async #dispatch(operationId) {
    const intent = this.journal.getIntent(operationId);
    if (!intent) throw new LegacyBarLocalError('OPERATION_NOT_FOUND', 'The original local operation is missing.', { operation_id: operationId });
    this.journal.beginAttempt(operationId);
    try {
      const response = await this.transport.request('POST', '/v1/commands', {
        sessionToken: this.sessionToken,
        deviceToken: this.scope.deviceToken,
        deviceId: this.scope.device_id,
        body: intent.envelope
      });
      const body = response.body;
      const failure = serviceFailure(body, response.status);
      const terminalRefusal = failure
        && plainObject(body)
        && body.ok !== true
        && body.outcome === 'refused'
        && failure.has_retry_flag
        && failure.retry_same_operation === false
        && failure.has_message
        && !AMBIGUOUS_ERROR_CODES.has(failure.code)
        && !ambiguousStatus(response.status)
        && (failure.operation_id === null || failure.operation_id === operationId);
      if (terminalRefusal) {
        const error = {
          code: failure.code,
          message: failure.message,
          retry_same_operation: false,
          requires_manager: failure.requires_manager
        };
        this.journal.markRefused(operationId, error);
        return {
          ok: false,
          outcome: 'refused',
          replayed: false,
          operation_id: operationId,
          error,
          correlation_id: failure.correlation_id
        };
      }
      if (response.status >= 200 && response.status < 300 && plainObject(body)
        && body.ok === true && body.outcome === 'committed_local') {
        const receiptMatches = body.operation_id === operationId
          && validReceipt(body.receipt, intent, operationId)
          && plainObject(body.result);
        if (receiptMatches) {
          this.journal.markCommitted(operationId, body);
          return body;
        }
        this.journal.markUncertain(operationId, { code: 'RECEIPT_INVALID', message: 'The service response did not prove this operation committed under the paired authority.' });
        throw new LegacyBarLocalError('RECEIPT_INVALID', 'The local service returned an unverified receipt. Keep this operation and retry the same operation ID after checking its status.', {
          status: response.status, retry_same_operation: true, operation_id: operationId, outcome_unknown: true
        });
      }
      const uncertain = ambiguousStatus(response.status)
        || !plainObject(body)
        || body.outcome === 'executing'
        || (failure !== null && (failure.retry_same_operation || AMBIGUOUS_ERROR_CODES.has(failure.code)))
        || (failure !== null && !failure.has_retry_flag);
      const code = failure ? failure.code : machineCode(body, response.status);
      const text = failure ? failure.message : message(body);
      if (uncertain) {
        this.journal.markUncertain(operationId, { code, message: text });
        throw new LegacyBarLocalError(code, text, { status: response.status, retry_same_operation: true, operation_id: operationId, outcome_unknown: true });
      }
      // An unexpected but non-ambiguous envelope is still not proof of a
      // terminal refusal; keep the original intent for same-ID recovery.
      this.journal.markUncertain(operationId, { code, message: text });
      throw new LegacyBarLocalError(code, text, { status: response.status, retry_same_operation: true, operation_id: operationId, outcome_unknown: true });
    } catch (error) {
      if (error instanceof LegacyBarLocalError && error.operation_id === operationId && error.outcome_unknown) throw error;
      // beginAttempt was durable before send. A failed checkpoint must not
      // erase the original operation ID or turn an ambiguous send into refusal.
      try { this.journal.markUncertain(operationId, { code: error.code || 'SERVICE_UNAVAILABLE', message: error.message || 'Local outcome is unknown.' }); } catch {}
      throw new LegacyBarLocalError(error.code || 'UNKNOWN_OUTCOME', error.message || 'The local outcome is unknown; retry the same operation.', {
        status: error.status,
        retry_same_operation: true,
        operation_id: operationId,
        outcome_unknown: true
      });
    }
  }
}
