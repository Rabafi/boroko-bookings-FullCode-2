const SESSION_KEY = 'tsa_bonno_bar_owner_session_v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KEY_ID = /^[A-Za-z0-9._:-]{1,120}$/
const MONEY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const QUANTITY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/

/** @typedef {{key_id: string, authority_id: string, business_id: string, business_name: string, active: boolean, revoked: boolean, stale: boolean, last_ingested_at: string|null, max_ingested_sequence: string|null}} BarOwnerLink */
/** @typedef {{event_type: string, operation_id: string, commit_sequence: string, business_date: string, sale_id: string|null, receipt_number: string|null, receipt_series: string|null, status: string|null, subtotal: string|null, discount: string|null, tax: string|null, tip: string|null, total: string|null, original_sale_id: string|null, items_count: number, received_at: string}} BarOwnerTransaction */
/** @typedef {{gross_sales: string, returns: string, voids: string, other_corrections_signed: string, net_sales: string, committed_sales: number, tax: string, tips: string}} BarOwnerTotals */
/** @typedef {{business_date: string, gross_sales: string, signed_adjustments: string, net_sales: string, committed_sales: number}} BarOwnerDay */
/** @typedef {{bar: {key_id: string, business_id: string, outlet_id: string}, period: {from: string, to: string}, complete: boolean, totals: BarOwnerTotals|null, by_day: BarOwnerDay[], transactions: BarOwnerTransaction[], last_ingested_at: string|null, max_ingested_sequence: string|null, received_at: string, stale: boolean}} BarOwnerSales */
/** @typedef {{event_type: string, operation_id: string, commit_sequence: string, business_date: string, product_id: string, sku: string|null, delta: string, quantity: string, received_at: string}} BarOwnerStockMovement */
/** @typedef {{event_type: string, operation_id: string, commit_sequence: string, business_date: string, cashup_id: string, shift_id: string, counted_cash: string, expected_cash: string, variance: string, status: string|null, received_at: string}} BarOwnerCashup */
/** @typedef {{bar: {key_id: string, business_id: string, outlet_id: string}, period: {from: string, to: string}, complete: boolean, truncated: boolean, summary: {stock_movement_count: number, cashup_count: number, submitted_variance_total: string}|null, stock_movements: BarOwnerStockMovement[], cashups: BarOwnerCashup[], last_ingested_at: string|null, max_ingested_sequence: string|null, received_at: string, stale: boolean}} BarOwnerOperations */

const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const requiredString = (value, pattern) => typeof value === 'string' && pattern.test(value)
const nullableString = (value, pattern) => value === null || requiredString(value, pattern)

function baseUrl() {
  const value = import.meta.env.VITE_BAR_OWNER_API_URL?.trim()
  if (!value) throw new Error('The Bar owner sync service is not configured for this Manager app.')
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The Bar owner sync service address is invalid.')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, '').toLowerCase())) {
    throw new Error('The Bar owner sync service must use HTTPS.')
  }
  return url.toString().replace(/\/$/, '')
}

export function getBarOwnerSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    return record(value) && typeof value.token === 'string' && value.token.length >= 40 ? value : null
  } catch { return null }
}

export function setBarOwnerSession(token, email) {
  if (typeof token !== 'string' || token.length < 40 || typeof email !== 'string') throw new Error('The owner service returned an invalid session.')
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, email, saved_at: new Date().toISOString() }))
}

export function clearBarOwnerSession() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* Storage may be unavailable in a restricted browser. */ }
}

/** @param {string} path @param {{method?: string, body?: unknown, token?: string|null}} [options] */
async function request(path, { method = 'GET', body, token = null } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      redirect: 'error',
      credentials: 'omit',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } catch {
    throw new Error('The Bar owner sync service could not be reached. Check connectivity and retry; local Bar trading is unaffected.')
  }
  let result
  try { result = await response.json() } catch { throw new Error('The Bar owner sync service returned an unreadable response.') }
  if (!response.ok || !record(result) || result.ok !== true) {
    if (response.status === 401) clearBarOwnerSession()
    throw new Error(record(result) && typeof result.message === 'string' ? result.message : 'The Bar owner sync request was refused.')
  }
  return result
}

/** @param {unknown} value */
function parseLinks(value) {
  if (!Array.isArray(value)) throw new Error('The owner service returned an invalid Bar list.')
  return value.map((entry) => {
    if (!record(entry) || !requiredString(entry.key_id, KEY_ID) || !requiredString(entry.authority_id, UUID)
      || !requiredString(entry.business_id, UUID) || typeof entry.business_name !== 'string'
      || typeof entry.active !== 'boolean' || typeof entry.revoked !== 'boolean' || typeof entry.stale !== 'boolean'
      || !nullableString(entry.last_ingested_at, /^\d{4}-\d\d-\d\dT/)
      || !nullableString(entry.max_ingested_sequence, /^[0-9]+$/)) throw new Error('The owner service returned an invalid Bar link.')
    return /** @type {BarOwnerLink} */ (entry)
  })
}

function validMoney(value) { return requiredString(value, MONEY) }

/** @param {unknown} value */
function parseSales(value) {
  if (!record(value) || value.ok !== true || value.complete !== true || typeof value.stale !== 'boolean' || !record(value.bar) || !record(value.period)
    || !requiredString(value.bar.key_id, UUID) || !requiredString(value.bar.business_id, UUID) || !requiredString(value.bar.outlet_id, UUID)
    || !requiredString(value.period.from, DATE) || !requiredString(value.period.to, DATE)
    || !nullableString(value.last_ingested_at, /^\d{4}-\d\d-\d\dT/)
    || !nullableString(value.max_ingested_sequence, /^[0-9]+$/) || !requiredString(value.received_at, /^\d{4}-\d\d-\d\dT/)
    || !record(value.totals) || !Array.isArray(value.by_day) || !Array.isArray(value.transactions)) {
    throw new Error('The received Bar sales projection is incomplete or has an unsupported shape. Financial totals are withheld.')
  }
  const totals = value.totals
  for (const field of ['gross_sales', 'returns', 'voids', 'other_corrections_signed', 'net_sales', 'tax', 'tips']) {
    if (!validMoney(totals[field])) throw new Error('The received Bar sales projection contains an invalid amount. Financial totals are withheld.')
  }
  if (!Number.isInteger(totals.committed_sales) || totals.committed_sales < 0) throw new Error('The received Bar sales projection contains an invalid sale count.')
  const byDay = value.by_day.map((day) => {
    if (!record(day) || !requiredString(day.business_date, DATE) || !validMoney(day.gross_sales)
      || !validMoney(day.signed_adjustments) || !validMoney(day.net_sales)
      || !Number.isInteger(day.committed_sales) || day.committed_sales < 0) throw new Error('The received Bar chart data is incomplete.')
    return /** @type {BarOwnerDay} */ (day)
  })
  const transactions = value.transactions.map((row) => {
    if (!record(row) || !['sale.committed', 'sale.returned', 'sale.voided', 'sale.corrected_after_close'].includes(row.event_type)
      || !requiredString(row.operation_id, UUID) || !requiredString(row.commit_sequence, /^[0-9]+$/)
      || !requiredString(row.business_date, DATE) || !nullableString(row.sale_id, UUID)
      || !nullableString(row.original_sale_id, UUID) || !Number.isInteger(row.items_count) || row.items_count < 0
      || !requiredString(row.received_at, /^\d{4}-\d\d-\d\dT/)
      || !nullableString(row.total, MONEY) || !nullableString(row.tax, MONEY) || !nullableString(row.tip, MONEY)) {
      throw new Error('The received Bar transaction history is incomplete.')
    }
    return /** @type {BarOwnerTransaction} */ (row)
  })
  return /** @type {BarOwnerSales} */ ({ ...value, by_day: byDay, transactions })
}

/** @param {unknown} value */
function parseOperations(value) {
  if (!record(value) || value.ok !== true || typeof value.complete !== 'boolean' || typeof value.truncated !== 'boolean'
    || typeof value.stale !== 'boolean' || !record(value.bar) || !record(value.period)
    || !requiredString(value.bar.key_id, KEY_ID) || !requiredString(value.bar.business_id, UUID) || !requiredString(value.bar.outlet_id, UUID)
    || !requiredString(value.period.from, DATE) || !requiredString(value.period.to, DATE)
    || !nullableString(value.last_ingested_at, /^\d{4}-\d\d-\d\dT/) || !nullableString(value.max_ingested_sequence, /^[0-9]+$/)
    || !requiredString(value.received_at, /^\d{4}-\d\d-\d\dT/)) {
    throw new Error('The received Bar operations projection is incomplete. Stock and cash-up figures are withheld.')
  }
  if (!value.complete || value.summary === null) throw new Error('The received Bar operations projection is incomplete or exceeds its 500-event limit. Narrow the date range; figures are withheld.')
  if (!record(value.summary) || !Number.isInteger(value.summary.stock_movement_count) || value.summary.stock_movement_count < 0
    || !Number.isInteger(value.summary.cashup_count) || value.summary.cashup_count < 0 || !validMoney(value.summary.submitted_variance_total)
    || !Array.isArray(value.stock_movements) || !Array.isArray(value.cashups)) {
    throw new Error('The received Bar operations projection has an invalid summary.')
  }
  const stockMovements = value.stock_movements.map((row) => {
    if (!record(row) || typeof row.event_type !== 'string' || !row.event_type.startsWith('stock.')
      || !requiredString(row.operation_id, UUID) || !requiredString(row.commit_sequence, /^[0-9]+$/)
      || !requiredString(row.business_date, DATE) || !requiredString(row.product_id, UUID)
      || !nullableString(row.sku, /^[A-Za-z0-9._:/-]{1,120}$/) || !requiredString(row.delta, QUANTITY)
      || !requiredString(row.quantity, QUANTITY) || !requiredString(row.received_at, /^\d{4}-\d\d-\d\dT/)) {
      throw new Error('The received stock movement history is incomplete.')
    }
    return /** @type {BarOwnerStockMovement} */ (row)
  })
  const cashups = value.cashups.map((row) => {
    if (!record(row) || !['cashup.submitted', 'cashup.reviewed', 'cashup.reopened'].includes(row.event_type)
      || !requiredString(row.operation_id, UUID) || !requiredString(row.commit_sequence, /^[0-9]+$/)
      || !requiredString(row.business_date, DATE) || !requiredString(row.cashup_id, UUID) || !requiredString(row.shift_id, UUID)
      || !validMoney(row.counted_cash) || !validMoney(row.expected_cash) || !validMoney(row.variance)
      || !nullableString(row.status, /^[a-z_]{1,40}$/) || !requiredString(row.received_at, /^\d{4}-\d\d-\d\dT/)) {
      throw new Error('The received cash-up history is incomplete.')
    }
    return /** @type {BarOwnerCashup} */ (row)
  })
  if (stockMovements.length !== value.summary.stock_movement_count || cashups.filter((row) => row.event_type === 'cashup.submitted').length !== value.summary.cashup_count) {
    throw new Error('The Bar operations summary does not match its received records.')
  }
  return /** @type {BarOwnerOperations} */ ({ ...value, stock_movements: stockMovements, cashups })
}

export async function registerBarOwner(email, password) {
  return request('/v1/register', { method: 'POST', body: { email, password } })
}

export async function loginBarOwner(email, password) {
  const result = await request('/v1/login', { method: 'POST', body: { email, password } })
  setBarOwnerSession(result.token, result.email)
  return getBarOwnerSession()
}

export async function getBarOwnerBars(token) {
  return parseLinks((await request('/v1/owner/bars', { token })).bars)
}

export async function createBarOwnerEnrollment(token) {
  const result = await request('/v1/owner/enrollment', { method: 'POST', token, body: {} })
  if (typeof result.enrollment_code !== 'string' || !/^bol_[A-Za-z0-9_-]{40,100}$/.test(result.enrollment_code)
    || !Number.isInteger(result.expires_in) || result.expires_in < 1 || result.expires_in > 600) throw new Error('The owner service returned an invalid connection code.')
  return { code: result.enrollment_code, expiresIn: result.expires_in }
}

export async function approveBarOwnerLink(token, keyId) {
  if (!requiredString(keyId, KEY_ID)) throw new Error('The Bar connection identifier is invalid.')
  await request(`/v1/owner/links/${encodeURIComponent(keyId)}/approve`, { method: 'POST', token, body: {} })
}

export async function revokeBarOwnerLink(token, keyId) {
  if (!requiredString(keyId, KEY_ID)) throw new Error('The Bar connection identifier is invalid.')
  await request(`/v1/owner/links/${encodeURIComponent(keyId)}/revoke`, { method: 'POST', token, body: {} })
}

export async function getBarOwnerSales(token, keyId, from, to) {
  if (!requiredString(keyId, KEY_ID) || !requiredString(from, DATE) || !requiredString(to, DATE) || from > to) throw new Error('Choose a valid Bar and date range.')
  return parseSales(await request(`/v1/owner/bars/${encodeURIComponent(keyId)}/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }))
}

export async function getBarOwnerOperations(token, keyId, from, to) {
  if (!requiredString(keyId, KEY_ID) || !requiredString(from, DATE) || !requiredString(to, DATE) || from > to) throw new Error('Choose a valid Bar and date range.')
  return parseOperations(await request(`/v1/owner/bars/${encodeURIComponent(keyId)}/operations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }))
}
