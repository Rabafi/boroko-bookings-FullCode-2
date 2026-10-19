// @ts-check
import { signInWithSupabaseAuth, supabase } from './supabase'
import { assertCapability, getStoredEntitlement, normalizeSessionUser, storeEntitlement } from './access'
import { normalizeSupportTickets } from '@shared/supportThreads'
import { titleCase } from './format'
import {
  appendIssueLog,
  createQueuedOperation,
  enqueueOfflineOperationVerified,
  friendlyPwaQueueError,
  getOfflineQueue,
  readIssueLog,
  getRuntimeMeta,
  mutateCachedList,
  queryWithCache,
  setOfflineQueue,
  removeOfflineOperation,
  setRuntimeMeta
} from './runtime'

function isOfflineMode() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

const STARTER_FEATURE_FLAGS = {
  reports: false,
  expenses: false,
  staff: false,
  pwa: false,
  audit: false,
  conference: false,
  pool: false,
  import: false,
  pos: false,
  inventory: false,
  supplies: false
}

const PWA_PLAN_REQUIRED_MESSAGE = 'Manager mobile app access is not included or active for this business. Check the package and renewal status, or ask Command Central to review the entitlement.'
export const FRONT_DESK_ONLY_MESSAGE = 'This action is only available in the Front Desk system.'
const READ_ONLY_MANAGER_MESSAGE = 'This screen is view only in the manager mobile app. Use the front desk for changes.'
const MAX_FINANCIAL_AMOUNT = 1000000
const queueFlushLocks = new Map()
const ENTITLEMENT_CACHE_MAX_AGE_MS = 5 * 60_000

/** @typedef {Record<string, unknown>} PwaRecord */
/** @typedef {Record<string, unknown> & {id?: unknown}} IdentifiedPwaRecord */
/** @typedef {Record<string, unknown> & {client_operation_id?: string | null, operation_id?: string | null}} QueuePayload */
/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) return undefined
  // Preserve optional property reads on primitive values, including the
  // original primitive receiver observed by inherited getters.
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readDirectField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} receiver @param {string} key @param {unknown[]} args @param {string} expression @returns {unknown} */
function callDirectMethod(receiver, key, args, expression) {
  const method = readDirectField(receiver, key)
  if (typeof method !== 'function') throw new TypeError(`${expression} is not a function`)
  return Reflect.apply(method, receiver, args)
}

/** @param {unknown} value @returns {Record<PropertyKey, unknown>} */
function spreadEnumerableProperties(value) {
  /** @type {Record<PropertyKey, unknown>} */
  const copy = {}
  if (value === null || value === undefined) return copy
  const source = Object(value)
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor?.enumerable) {
      Object.defineProperty(copy, key, {
        value: Reflect.get(source, key, source),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
  return copy
}

const BLOCKED_PWA_MUTATION_TYPES = new Set([
  'booking/create',
  'booking/status',
  'booking/payment',
  'quotation/create',
  'quotation/update',
  'quotation/markSent',
  'quotation/convert',
  'conference/create',
  'conference/update',
  'conference/delete'
])

/** @param {PwaRecord | null | undefined} record @returns {unknown} */
function guestName(record) {
  return readField(record, 'guest_name') || readField(record, 'customer_name') || readField(record, 'name') || 'Guest'
}

/** @param {RegExp} pattern @param {unknown} value @returns {boolean} */
function testPattern(pattern, value) {
  return Reflect.apply(RegExp.prototype.test, pattern, [value])
}

/** @param {unknown} message @returns {Error} */
function errorWithMessage(message) {
  return Reflect.construct(Error, [message])
}

/** @param {unknown} value @returns {unknown} */
function lowerCaseValue(value) {
  const method = readField(value, 'toLowerCase')
  if (typeof method !== 'function') throw new TypeError('message.toLowerCase is not a function')
  return Reflect.apply(method, value, [])
}

/**
 * Error-like objects may expose a stateful message getter. Preserve the
 * baseline's two reads and return the second truthy value without claiming it
 * is a validated string; RegExp and Error constructors retain their native
 * coercion behavior at their existing call sites.
 * @param {unknown} error @param {unknown} [fallback] @returns {unknown}
 */
function friendlyErrorMessage(error, fallback = 'Unexpected issue') {
  const raw = (() => {
    if (!error) return fallback
    if (typeof error === 'string') return error
    if (error instanceof Error && error.message) return error.message
    const messageType = readField(error, 'message')
    if (typeof messageType === 'string') return readField(error, 'message') || fallback
    return fallback
  })()
  if (testPattern(/cannot execute .* in a read-only transaction|read-only transaction/i, raw)) {
    return 'This mobile view is review-and-request only. Ask front desk to complete the record change on desktop.'
  }
  if (testPattern(/violates row-level security|new row violates row-level security|permission denied for table/i, raw)) {
    return 'This record is not available for mobile changes. Ask front desk to complete it on desktop.'
  }
  return raw || fallback
}

/** @param {unknown} error @param {string} [fallback] @returns {unknown} */
export function getFriendlyErrorMessage(error, fallback = 'Unexpected issue') {
  return friendlyErrorMessage(error, fallback)
}

/** @param {string} lodgeId */
export async function listHotelRatePlans(lodgeId) {
  assertCapability('rate_plans.view')
  return safeSelect(
    supabase
      .from('rate_plans')
      .select('id, name, description, rate_amount, rate_type, currency, valid_from, valid_to, min_stay, max_stay, days_of_week, corporate_account_id, status, updated_at')
      .eq('lodge_id', lodgeId)
      .order('name')
      .limit(300)
  )
}

/** @param {string} lodgeId */
export async function listCorporateAccountsPwa(lodgeId) {
  assertCapability('corporate_accounts.view')
  return safeSelect(
    supabase
      .from('corporate_accounts')
      .select('id, company_name, contact_name, contact_email, contact_phone, credit_limit, payment_terms_days, status, updated_at')
      .eq('lodge_id', lodgeId)
      .order('company_name')
      .limit(300)
  )
}

/** @param {string} lodgeId */
export async function listRoomSuppliesPwa(lodgeId) {
  assertCapability('supplies.view')
  const [items, roomStock] = await Promise.all([
    safeSelect(
      supabase
        .from('supply_items')
        .select('id, name, category, unit, current_stock, reorder_level, latest_unit_cost, is_active, updated_at')
        .eq('lodge_id', lodgeId)
        .order('category')
        .order('name')
        .limit(500)
    ),
    safeSelect(
      supabase
        .from('room_supply_room_stock')
        .select('id, supply_item_id, room_id, quantity_on_hand, reorder_level, updated_at')
        .eq('lodge_id', lodgeId)
        .limit(1000)
    )
  ])
  return { items, roomStock }
}

/** @param {unknown} result @param {unknown} error @param {string} fallbackMessage @returns {unknown} */
function ensureSuccess(result, error, fallbackMessage) {
  if (error) throw errorWithMessage(friendlyErrorMessage(error, fallbackMessage))
  if (readField(result, 'success') === false) throw errorWithMessage(friendlyErrorMessage(readField(result, 'error'), fallbackMessage))
  return result
}

/** @param {string | number | Date} base @param {number} days @returns {Date} */
function addDays(base, days) {
  const value = new Date(base)
  value.setDate(value.getDate() + days)
  return value
}

/** @param {string | number | Date} value @returns {string} */
function formatDate(value) {
  /** @type {Record<string, string>} */
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Gaborone',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** @param {IdentifiedPwaRecord[]} list @param {IdentifiedPwaRecord} record @returns {IdentifiedPwaRecord[]} */
function upsertById(list, record) {
  const index = list.findIndex((entry) => entry.id === record.id)
  if (index === -1) return [record, ...list]
  list[index] = { ...list[index], ...record }
  return list
}

/** @param {IdentifiedPwaRecord[]} list @param {unknown} id @returns {IdentifiedPwaRecord[]} */
function removeById(list, id) {
  return list.filter((entry) => entry.id !== id)
}

/** @param {unknown} totalAmount @param {unknown} amountPaid @returns {'unpaid' | 'paid' | 'partial'} */
function computePaymentStatus(totalAmount, amountPaid) {
  const total = Number(totalAmount || 0)
  const paid = Number(amountPaid || 0)
  if (paid <= 0) return 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

/** @param {unknown} value @param {string} fieldLabel @param {{max?: number, allowBlank?: boolean}} [options] @returns {number} */
function normalizeMoney(value, fieldLabel, { max = MAX_FINANCIAL_AMOUNT, allowBlank = false } = {}) {
  if (allowBlank && (value === '' || value === null || value === undefined)) return 0
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error(`${fieldLabel} must be a valid amount.`)
  if (amount < 0) throw new Error(`${fieldLabel} cannot be negative.`)
  if (amount > max) throw new Error(`${fieldLabel} is too large. Please review the value.`)
  return Math.round(amount * 100) / 100
}

/**
 * Supabase's client here has no generated database schema types. These calls
 * are table/set-returning reads, so the response envelope is a row array;
 * individual column values remain unknown until existing code narrows them.
 * @param {PromiseLike<{data: unknown, error: unknown}>} queryBuilder
 * @param {PwaRecord[]} [fallback]
 * @returns {Promise<PwaRecord[]>}
 */
async function safeSelect(queryBuilder, fallback = []) {
  const { data, error } = await queryBuilder
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load data.'))
  return /** @type {PwaRecord[]} */ (data || fallback)
}

/**
 * @param {() => {range: (from: number, to: number) => PromiseLike<{data: unknown, error: unknown}>}} buildQuery
 * @param {PwaRecord[]} [fallback]
 * @param {{pageSize?: number, maxRows?: number}} [options]
 * @returns {Promise<PwaRecord[]>}
 */
async function safeSelectPaged(buildQuery, fallback = [], { pageSize = 1000, maxRows = 10000 } = {}) {
  const rows = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1)
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load data.'))
    const page = /** @type {PwaRecord[]} */ (data || [])
    rows.push(...page)
    if (page.length < to - from + 1) break
  }
  return rows.length > 0 ? rows : fallback
}

const INVENTORY_ITEM_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at, updated_at, sku, barcode, is_active'
const INVENTORY_ITEM_LEGACY_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at'
const DAY_USE_LIST_SELECT = 'id, date, resource_key, resource_name, start_time, end_time, status, total, adults, children, notes, created_at, updated_at, deposit_amount, balance_due, fee_per_adult, fee_per_child, flat_fee, hourly_rate, package_fee, pricing_mode, created_by'
const BOOKING_LIST_SELECT = 'id, customer_id, room_id, check_in, check_out, adults, children, total_amount, status, payment_status, amount_paid, charges_total, deposit_amount, notes, is_exclusive_event, invoice_number, created_at, updated_at, created_by, payment_method, source, quotation_id, event_daily_rate, customer:customers(name), room:rooms(room_number)'
const CONFERENCE_BOOKING_SELECT = 'id, booking_date, start_time, end_time, client_name, company, attendees, setup_type, room_name, includes_catering, catering_notes, total_amount, deposit_paid, payment_status, payment_method, notes, created_at, lodge_id, event_name, event_type, reservation_scope, status, adults, children, amount_paid, balance_due, currency'
const QUOTATION_SELECT = 'id, customer_id, customer_name, customer_phone, quotation_type, event_name, event_daily_rate, room_id, room_name, check_in, check_out, adults, children, subtotal, tax_amount, total_amount, currency, notes, status, valid_until, quotation_number, created_at, updated_at, created_by, lodge_id, parent_quotation_id, converted_booking_id'
const QUOTATION_LEGACY_SELECT = 'id, customer_id, customer_name, customer_phone, room_id, room_name, check_in, check_out, adults, children, subtotal, tax_amount, total_amount, currency, notes, status, valid_until, quotation_number, created_at, updated_at, created_by, lodge_id, parent_quotation_id, converted_booking_id'

/** @param {PwaRecord} [row] @returns {PwaRecord} */
function normalizeBookingRelations(row = {}) {
  const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer
  const room = Array.isArray(row.room) ? row.room[0] : row.room
  return {
    ...row,
    customer_name: row.customer_name || customer?.name || null,
    guest_name: row.guest_name || customer?.name || null,
    room_number: row.room_number || room?.room_number || null
  }
}

/** @param {unknown} error @returns {boolean} */
function isMissingInventoryCompatibilityColumnError(error) {
  return /column\s+inventory_items\.(barcode|is_active|sku|updated_at)\s+does\s+not\s+exist/i.test(String(readField(error, 'message') || ''))
}

/**
 * The client has no generated database types. Both branches are exact table
 * select queries, so their response envelope is a row array; column values
 * remain unknown.
 * @param {string} lodgeId
 * @param {{orderByCategory?: boolean}} [options]
 * @returns {Promise<PwaRecord[]>}
 */
async function safeInventorySelect(lodgeId, { orderByCategory = false } = {}) {
  /** @param {string} columns */
  const buildQuery = (columns) => {
    let query = supabase.from('inventory_items').select(columns).eq('lodge_id', lodgeId)
    if (orderByCategory) query = query.order('category')
    return query.order('name').limit(500)
  }
  const primary = await buildQuery(INVENTORY_ITEM_SELECT)
  if (!primary.error) {
    /** The exact table select guarantees an array envelope; row values remain unknown. */
    const rows = /** @type {unknown} */ (primary.data || [])
    return /** @type {PwaRecord[]} */ (rows)
  }
  if (!isMissingInventoryCompatibilityColumnError(primary.error)) {
    throw errorWithMessage(friendlyErrorMessage(primary.error, 'Could not load inventory.'))
  }
  const legacy = await buildQuery(INVENTORY_ITEM_LEGACY_SELECT)
  if (legacy.error) throw errorWithMessage(friendlyErrorMessage(legacy.error, 'Could not load inventory.'))
  /** This response envelope follows the exact legacy select list above; columns stay unknown. */
  const legacyRowsSource = /** @type {unknown} */ (legacy.data || [])
  const legacyRows = /** @type {Array<PwaRecord & {updated_at?: unknown, created_at?: unknown, sku?: unknown, barcode?: unknown, is_active?: unknown}>} */ (legacyRowsSource)
  return legacyRows.map((row) => ({
    ...row,
    updated_at: row.updated_at || row.created_at || null,
    sku: null,
    barcode: null,
    is_active: true
  }))
}

/** @param {unknown} error @returns {boolean} */
function isMissingQuotationCompatibilityColumnError(error) {
  return /column\s+quotations\.(quotation_type|event_name|event_daily_rate)\s+does\s+not\s+exist/i.test(String(readField(error, 'message') || ''))
}

/**
 * Both paths use table select queries; rows are records but their database
 * values are not runtime-validated here.
 * @param {string} lodgeId
 * @returns {Promise<PwaRecord[]>}
 */
async function safeQuotationSelect(lodgeId) {
  /** @param {string} columns */
  const buildQuery = (columns) => supabase
    .from('quotations')
    .select(columns)
    .eq('lodge_id', lodgeId)
    .order('created_at', { ascending: false })
    .limit(200)

  const primary = await buildQuery(QUOTATION_SELECT)
  if (!primary.error) {
    /** The exact table select guarantees an array envelope; row values remain unknown. */
    const rows = /** @type {unknown} */ (primary.data || [])
    return /** @type {PwaRecord[]} */ (rows)
  }
  if (!isMissingQuotationCompatibilityColumnError(primary.error)) {
    throw errorWithMessage(friendlyErrorMessage(primary.error, 'Could not load quotations.'))
  }

  const legacy = await buildQuery(QUOTATION_LEGACY_SELECT)
  if (legacy.error) throw errorWithMessage(friendlyErrorMessage(legacy.error, 'Could not load quotations.'))
  /** This response envelope follows the exact legacy select list above; columns stay unknown. */
  const legacyRowsSource = /** @type {unknown} */ (legacy.data || [])
  const legacyRows = /** @type {Array<PwaRecord & {created_at?: unknown, id?: unknown, customer_id?: unknown, customer_name?: unknown, customer_phone?: unknown, room_id?: unknown, room_name?: unknown, check_in?: unknown, check_out?: unknown, adults?: unknown, children?: unknown, subtotal?: unknown, tax_amount?: unknown, total_amount?: unknown, currency?: unknown, notes?: unknown, status?: unknown, valid_until?: unknown, quotation_number?: unknown, updated_at?: unknown, created_by?: unknown, lodge_id?: unknown, parent_quotation_id?: unknown, converted_booking_id?: unknown}>} */ (legacyRowsSource)
  return legacyRows.map((row) => ({
    ...row,
    quotation_type: 'room',
    event_name: null,
    event_daily_rate: null
  }))
}

/** @param {unknown} error @param {unknown} [fallback] @returns {unknown} */
function getErrorMessage(error, fallback = 'Unexpected issue') {
  return friendlyErrorMessage(error, fallback)
}

/** @param {string} scope @param {unknown} error @param {unknown} [fallbackMessage] @returns {unknown} */
function describeReadError(scope, error, fallbackMessage = '') {
  const message = getErrorMessage(error, fallbackMessage || `Could not load ${scope.toLowerCase()}.`)
  if (testPattern(/access denied|permission denied|not authorized|not allowed/i, message)) {
    return `${scope} is not available for this account.`
  }
  if (testPattern(/network|failed to fetch|fetch failed|offline|timeout|timed out/i, message)) {
    return `${scope} could not reach the server. Check the connection and try again.`
  }
  if (testPattern(/schema cache|function .* does not exist|could not find the function|pgrst/i, message)) {
    return `${scope} is not ready on this lodge yet. Apply the latest database migrations and try again.`
  }
  if (testPattern(/session|expired|jwt/i, message)) {
    return `${scope} could not load because the session expired. Please sign in again.`
  }
  return message || fallbackMessage || `Could not load ${scope.toLowerCase()}.`
}

/** @param {string} scope @param {unknown} error @param {unknown} [fallbackMessage] @returns {unknown} */
function describeMutationError(scope, error, fallbackMessage = '') {
  const message = getErrorMessage(error, fallbackMessage || `Could not save ${scope.toLowerCase()}.`)
  if (testPattern(/access denied|permission denied|not authorized|not allowed/i, message)) {
    return `You do not have permission to save ${scope.toLowerCase()}.`
  }
  if (testPattern(/network|failed to fetch|fetch failed|offline|timeout|timed out/i, message)) {
    return `Could not reach the server while saving ${scope.toLowerCase()}. Check your connection and try again.`
  }
  if (testPattern(/schema cache|function .* does not exist|could not find the function|pgrst/i, message)) {
    return `${scope} is not ready on this lodge yet. Apply the latest database migrations and try again.`
  }
  if (testPattern(/session|expired|jwt/i, message)) {
    return `Could not save ${scope.toLowerCase()} because the session expired. Please sign in again.`
  }
  return message || fallbackMessage || `Could not save ${scope.toLowerCase()}.`
}

/** @param {string} lodgeId @param {string} scope @param {unknown} error @param {{fallbackError?: unknown, severity?: string, [key: string]: unknown}} [context] */
function recordPwaIssue(lodgeId, scope, error, context = {}) {
  const message = getErrorMessage(error)
  const detail = context?.fallbackError
    ? `Primary: ${message} | Fallback: ${getErrorMessage(context.fallbackError)}`
    : message
  return appendIssueLog(lodgeId, {
    scope,
    severity: context?.severity || 'error',
    message,
    detail,
    context
  })
}

/** @param {string} rpcName @param {Record<string, unknown>} params @param {string} fallbackMessage @returns {Promise<unknown>} */
async function readRpcJson(rpcName, params, fallbackMessage) {
  const { data, error } = await supabase.rpc(rpcName, params)
  if (error) throw errorWithMessage(friendlyErrorMessage(error, fallbackMessage))
  return data
}

/** @param {string} lodgeId @param {string} [today] */
async function buildDashboardSnapshotLegacy(lodgeId, today = formatDate(new Date())) {
  const monthStart = today.slice(0, 7) + '-01'
  const todayDate = new Date(`${today}T00:00:00`)
  const monthEnd = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0))
  const monthEndExclusive = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1))
  const nextWeek = formatDate(addDays(today, 7))
  const previousWeek = Array.from({ length: 7 }, (_, index) => formatDate(addDays(today, index - 6)))

  const [rooms, bookings, payments, creditCashFlows, expenses, maintenance, inventory, quotations, conference, dayUse] = await Promise.all([
    safeSelect(supabase.from('rooms').select('id, room_number, room_type, rate_per_night, max_occupancy, status, amenities, description, photo, photos, lodge_id, created_at, updated_at, housekeeping_status, housekeeping_notes').eq('lodge_id', lodgeId).order('room_number').limit(200)),
    listBookings(lodgeId, { forceFresh: true }),
    safeSelect(supabase.from('payments').select('amount, paid_at, method, type').eq('lodge_id', lodgeId).gte('paid_at', monthStart).lt('paid_at', monthEndExclusive), []),
    safeSelect(supabase.rpc('get_customer_credit_cash_flow', {
      p_lodge_id: lodgeId,
      p_start_at: `${monthStart}T00:00:00`,
      p_end_at: `${monthEndExclusive}T00:00:00`
    }), []),
    safeSelect(supabase.from('expenses').select('id, amount, date, category, description').eq('lodge_id', lodgeId).gte('date', monthStart).limit(200)),
    listMaintenanceTickets(lodgeId, { forceFresh: true }),
    safeInventorySelect(lodgeId),
    safeSelect(supabase.from('quotations').select('id, customer_id, customer_name, customer_phone, room_id, room_name, check_in, check_out, adults, children, subtotal, tax_amount, total_amount, currency, notes, status, valid_until, quotation_number, created_at, updated_at, created_by, lodge_id, parent_quotation_id, converted_booking_id').eq('lodge_id', lodgeId).order('created_at', { ascending: false }).limit(200)),
    safeSelect(supabase.from('conference_bookings').select(CONFERENCE_BOOKING_SELECT).eq('lodge_id', lodgeId).gte('booking_date', today).lte('booking_date', nextWeek).order('booking_date').limit(50)),
    safeSelect(supabase.from('pool_day_use').select(DAY_USE_LIST_SELECT).eq('lodge_id', lodgeId).gte('date', monthStart).limit(200))
  ])

  // Booking fields below come from BOOKING_LIST_SELECT and
  // normalizeBookingRelations. This expected consumer shape does not validate
  // unversioned persisted cache data returned by queryWithCache.
  const reportBookings = /** @type {(PwaRecord & {check_in: string, check_out: string, status: string | null, payment_status: string | null, source: string})[]} */ (bookings)
  // The consumer reads only status and priority selected from
  // maintenance_tickets. As above, this expected shape is not runtime
  // validation for stale or persisted cache data.
  const reportMaintenance = /** @type {(PwaRecord & {status: string | null, priority: string | null})[]} */ (maintenance)
  const occupied = reportBookings.filter((booking) => booking.status === 'checked_in').length
  const openMaintenance = reportMaintenance.filter((ticket) => ticket.status !== 'resolved')
  const lowStock = inventory.filter((item) => Number(item.reorder_level || 0) > 0 && Number(item.current_stock ?? item.quantity ?? 0) <= Number(item.reorder_level || 0))
  const unpaidBookings = reportBookings.filter((booking) => !/** @type {Array<string | null>} */ (['cancelled', 'checked_out']).includes(booking.status) && ['partial', 'unpaid'].includes(String(booking.payment_status || '').toLowerCase()))
  const outstandingTotal = unpaidBookings.reduce((sum, booking) => {
    const total = Number(booking.total_amount || 0) + Number(booking.charges_total || 0)
    const paid = Number(booking.amount_paid || 0)
    return sum + Math.max(0, total - paid)
  }, 0)
  const upcomingArrivals = reportBookings
    .filter((booking) => booking.status !== 'cancelled' && booking.check_in >= today && booking.check_in <= nextWeek)
    .map((booking) => ({
      ...booking,
      manager_arrival_status:
        booking.source === 'online' && booking.status === 'pending'
          ? 'awaiting_front_desk_confirmation'
          : booking.status,
      manager_arrival_note:
        booking.source === 'online' && booking.status === 'pending'
          ? 'Online request waiting for front desk confirmation.'
          : booking.status === 'confirmed'
            ? 'Confirmed and ready for front desk preparation.'
            : booking.status === 'checked_in'
              ? 'Guest is already checked in.'
              : booking.status === 'checked_out'
                ? 'Guest has already checked out.'
                : 'Active booking.'
    }))
    .sort((left, right) => String(left.check_in).localeCompare(String(right.check_in)))
    .slice(0, 6)
  const monthExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const monthPayments = payments.filter((payment) => {
    const paidAt = String(payment.paid_at || '').slice(0, 10)
    return paidAt >= monthStart &&
      paidAt < monthEndExclusive &&
      !['customer_credit', 'customer_credit_transfer'].includes(String(payment.method || '').toLowerCase())
  })
  const monthCreditReceipts = creditCashFlows
    .filter((entry) => entry.entry_type === 'receipt')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const monthCreditRefunds = creditCashFlows
    .filter((entry) => entry.entry_type === 'refund')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const monthGrossCollected = monthPayments
    .filter((payment) => Number(payment.amount || 0) > 0)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), monthCreditReceipts)
  const monthRefunds = monthPayments
    .filter((payment) => Number(payment.amount || 0) < 0)
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), monthCreditRefunds)
  const monthRevenue = monthGrossCollected - monthRefunds
  const maintenanceCosts = maintenanceCostsForRange(reportMaintenance, monthStart, monthEnd)

  const revenueTrend = previousWeek.map((day) => {
    const amount = payments
      .filter((payment) =>
        String(payment.paid_at || '').slice(0, 10) === day &&
        !['customer_credit', 'customer_credit_transfer'].includes(String(payment.method || '').toLowerCase())
      )
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    const creditAmount = creditCashFlows
      .filter((entry) => String(entry.created_at || '').slice(0, 10) === day)
      .reduce((sum, entry) => sum + (entry.entry_type === 'receipt' ? Number(entry.amount || 0) : -Number(entry.amount || 0)), 0)
    return { day, amount: amount + creditAmount }
  })

  const occupancyTrend = previousWeek.map((day) => {
    const active = reportBookings.filter((booking) => booking.status !== 'cancelled' && booking.check_in <= day && booking.check_out > day).length
    return {
      day,
      occupied: active,
      percent: rooms.length > 0 ? Math.round((active / rooms.length) * 100) : 0
    }
  })

  return {
    totalRooms: rooms.length,
    occupied,
    occupancyPercent: rooms.length > 0 ? Math.round((occupied / rooms.length) * 100) : 0,
    openMaintenanceCount: openMaintenance.length,
    urgentMaintenanceCount: openMaintenance.filter((ticket) => ticket.priority === 'urgent').length,
    lowStockCount: lowStock.length,
    unpaidCount: unpaidBookings.length,
    outstandingTotal,
    monthExpenses,
    maintenanceCosts,
    monthGrossCollected,
    monthRefunds,
    monthRevenue,
    monthNet: monthRevenue - monthExpenses,
    upcomingArrivals,
    conferenceUpcoming: conference.slice(0, 4),
    quotationsOpenCount: quotations.filter((quotation) => ['draft', 'sent', 'accepted'].some((status) => status === quotation.status)).length,
    dayUseRevenue: dayUse.reduce((sum, entry) => sum + Number(entry.total || 0), 0),
    lowStock: lowStock.slice(0, 5),
    revenueTrend,
    occupancyTrend,
    topBalances: unpaidBookings
      .map((booking) => ({
        ...booking,
        balance: Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
      }))
      .sort((left, right) => right.balance - left.balance)
      .slice(0, 5),
    source: 'legacy_estimate',
    financial_truth: 'estimated_until_server_reconciled'
  }
}

/** @param {string} lodgeId @param {string} [today] @returns {Promise<Record<string, unknown>>} */
async function buildReportsSnapshotLegacy(lodgeId, today = formatDate(new Date())) {
  const todayDate = new Date(`${today}T00:00:00`)
  const weekStart = formatDate(addDays(todayDate, -(todayDate.getDay() === 0 ? 6 : todayDate.getDay() - 1)))
  const monthStart = today.slice(0, 7) + '-01'
  const monthEnd = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0))
  const lastMonthDate = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1)
  const lastMonthStart = formatDate(lastMonthDate)
  const lastMonthEnd = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth(), 0))
  const reportCashStart = `${lastMonthStart}T00:00:00`
  const reportCashEnd = `${monthEnd}T23:59:59`

  const [rooms, bookings, payments, creditCashFlows, refundApprovals, expenses, posOrders, conferenceBookings, poolDayUse] = await Promise.all([
    safeSelect(supabase.from('rooms').select('id').eq('lodge_id', lodgeId), []),
    safeSelectPaged(() => supabase.from('bookings').select('id, check_in, check_out, total_amount, charges_total, amount_paid, payment_status, status').eq('lodge_id', lodgeId), []),
    safeSelect(supabase.from('payments').select('booking_id, amount, paid_at, type, method').eq('lodge_id', lodgeId).gte('paid_at', reportCashStart).lte('paid_at', reportCashEnd), []),
    safeSelect(supabase.rpc('get_customer_credit_cash_flow', {
      p_lodge_id: lodgeId,
      p_start_at: reportCashStart,
      p_end_at: reportCashEnd
    }), []),
    safeSelect(supabase.from('refund_approval_log').select('booking_id, retained_amount, created_at').eq('lodge_id', lodgeId).gte('created_at', reportCashStart).lte('created_at', reportCashEnd), []),
    safeSelect(supabase.from('expenses').select('amount, date').eq('lodge_id', lodgeId).gte('date', monthStart).lte('date', monthEnd), []),
    safeSelect(supabase.from('pos_orders').select('total, created_at, payment_method, event_booking_id, booking_id').eq('lodge_id', lodgeId).gte('created_at', monthStart).neq('status', 'voided'), []),
    safeSelect(supabase.from('conference_bookings').select('total_amount, payment_status').eq('lodge_id', lodgeId).gte('booking_date', monthStart).lte('booking_date', monthEnd).neq('payment_status', 'cancelled'), []),
    safeSelect(supabase.from('pool_day_use').select('total').eq('lodge_id', lodgeId).gte('date', monthStart).lte('date', monthEnd), [])
  ])

  const totalRooms = rooms.length
  // This direct table select returns PostgreSQL DATE columns. The checked-in
  // schema at supabase/migrations/20260526101632_baseline_20260526_remote_schema.sql
  // declares both fields NOT NULL; unlike cache and RPC paths, these selected
  // date values have a concrete string contract.
  const bookingDateRows = /** @type {Array<PwaRecord & {check_in: string, check_out: string}>} */ (bookings)
  /** @param {string} start @param {string} end */
  const revForPeriod = (start, end) => payments
    .filter((payment) => {
      const paidAt = String(payment.paid_at || '').slice(0, 10)
      return paidAt >= start &&
        paidAt <= end &&
        !['customer_credit', 'customer_credit_transfer'].includes(String(payment.method || '').toLowerCase())
    })
    .reduce((sum, payment) => sum + Number(payment.amount || 0), creditCashFlows
      .filter((entry) => {
        const createdAt = String(entry.created_at || '').slice(0, 10)
        return createdAt >= start && createdAt <= end
      })
      .reduce((sum, entry) => sum + (entry.entry_type === 'receipt' ? Number(entry.amount || 0) : -Number(entry.amount || 0)), 0))

  /** @param {string} start @param {string} end */
  const refundsForPeriod = (start, end) => payments
    .filter((payment) => {
      const paidAt = String(payment.paid_at || '').slice(0, 10)
      return paidAt >= start &&
        paidAt <= end &&
        Number(payment.amount || 0) < 0 &&
        String(payment.method || '').toLowerCase() !== 'customer_credit_transfer'
    })
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), creditCashFlows
      .filter((entry) => {
        const createdAt = String(entry.created_at || '').slice(0, 10)
        return entry.entry_type === 'refund' && createdAt >= start && createdAt <= end
      })
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  /** @param {string} start @param {string} end */
  const retainedForPeriod = (start, end) => {
    let retained = 0
    let count = 0
    const seenBookingIds = new Set()
    const rows = refundApprovals.length > 0
      ? refundApprovals
      : payments.filter((payment) => String(payment.type || '').toLowerCase() === 'retention_fee')
    for (const row of rows) {
      const recognizedAt = String(row.created_at || row.paid_at || '').slice(0, 10)
      if (recognizedAt < start || recognizedAt > end) continue
      const amount = Math.max(0, Number(row.retained_amount ?? row.amount ?? 0))
      if (amount <= 0) continue
      retained += amount
      if (row.booking_id && !seenBookingIds.has(row.booking_id)) {
        seenBookingIds.add(row.booking_id)
        count += 1
      }
    }
    return { retained, count }
  }
  const monthRetained = retainedForPeriod(monthStart, monthEnd)
  const lastMonthRetained = retainedForPeriod(lastMonthStart, lastMonthEnd)

  /** @param {string} start @param {string} end */
  const occupancyForPeriod = (start, end) => {
    const occ = bookingDateRows.filter((booking) => booking.status === 'checked_in' && booking.check_in <= end && booking.check_out >= start).length
    const days = Math.ceil((+new Date(end) - +new Date(start)) / 86400000) + 1
    return totalRooms > 0 && days > 0 ? Math.round((occ / (totalRooms * days)) * 100) : 0
  }

  const unpaidBookings = bookings.filter((booking) =>
    booking.status !== 'cancelled' &&
    (booking.payment_status === 'partial' || booking.payment_status === 'unpaid' || !booking.payment_status)
  )

  return {
    todayRev: revForPeriod(today, today),
    weekRev: revForPeriod(weekStart, today),
    monthRev: revForPeriod(monthStart, monthEnd),
    lastMonthRev: revForPeriod(lastMonthStart, lastMonthEnd),
    monthRefunds: refundsForPeriod(monthStart, monthEnd),
    lastMonthRefunds: refundsForPeriod(lastMonthStart, lastMonthEnd),
    monthRetainedRevenue: monthRetained.retained,
    lastMonthRetainedRevenue: lastMonthRetained.retained,
    monthRetainedCount: monthRetained.count,
    lastMonthRetainedCount: lastMonthRetained.count,
    monthOcc: occupancyForPeriod(monthStart, monthEnd),
    lastMonthOcc: occupancyForPeriod(lastMonthStart, lastMonthEnd),
    currentOcc: bookings.filter((booking) => booking.status === 'checked_in').length,
    totalRooms,
    unpaidTotal: unpaidBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)), 0),
    unpaidCount: unpaidBookings.length,
    monthExpenses: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    posRevenue: posOrders
      .filter((order) => String(order.payment_method || '').toLowerCase() !== 'folio')
      .reduce((sum, order) => sum + Number(order.total || 0), 0),
    conferenceRevenue: conferenceBookings.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0),
    poolRevenue: poolDayUse.reduce((sum, entry) => sum + Number(entry.total || 0), 0),
    source: 'legacy_estimate',
    financial_truth: 'estimated_until_server_reconciled'
  }
}

/** @param {string} lodgeId @param {string} date */
async function buildNightAuditLegacy(lodgeId, date) {
  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`
  const [bookings, posOrders, payments, creditCashFlows, expenses] = await Promise.all([
    listBookings(lodgeId, { forceFresh: true }),
    safeSelect(supabase.from('pos_orders').select('*, pos_order_items(*)').eq('lodge_id', lodgeId).eq('status', 'completed').gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }), []),
    safeSelect(supabase.from('payments').select('amount, paid_at, type, method').eq('lodge_id', lodgeId).gte('paid_at', dayStart).lte('paid_at', dayEnd), []),
    safeSelect(supabase.rpc('get_customer_credit_cash_flow', {
      p_lodge_id: lodgeId,
      p_start_at: dayStart,
      p_end_at: dayEnd
    }), []),
    safeSelect(supabase.from('expenses').select('amount, date').eq('lodge_id', lodgeId).gte('date', date).lte('date', date), [])
  ])
  // Fields read by this legacy audit come from BOOKING_LIST_SELECT. This
  // expected consumer shape does not validate unversioned localStorage data.
  const auditBookings = /** @type {(PwaRecord & {check_in: string, check_out: string, status: string | null, payment_status: string | null, created_at: string | null})[]} */ (bookings)
  const checkIns = auditBookings
    .filter((booking) => booking.check_in === date && booking.status !== 'cancelled')
    .sort((left, right) => String(left.room_number || '').localeCompare(String(right.room_number || '')))
  const checkOuts = auditBookings
    .filter((booking) => booking.check_out === date && booking.status !== 'cancelled')
    .sort((left, right) => String(left.room_number || '').localeCompare(String(right.room_number || '')))
  const newBookings = auditBookings
    .filter((booking) => {
      const createdAt = String(booking.created_at || '')
      return createdAt >= dayStart && createdAt <= dayEnd
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
  const outstanding = auditBookings
    .filter((booking) => /** @type {Array<string | null>} */ (['confirmed', 'checked_in']).includes(booking.status) && booking.payment_status !== 'paid')
    .sort((left, right) => String(left.check_in || '').localeCompare(String(right.check_in || '')))

  const grossCollected = payments
    .filter((payment) => Number(payment.amount || 0) > 0 && !['customer_credit', 'customer_credit_transfer'].includes(String(payment.method || '').toLowerCase()))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), creditCashFlows.filter((entry) => entry.entry_type === 'receipt').reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  const refundsIssued = payments
    .filter((payment) => (Number(payment.amount || 0) < 0 || String(payment.type || '').toLowerCase() === 'refund') && String(payment.method || '').toLowerCase() !== 'customer_credit_transfer')
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), creditCashFlows.filter((entry) => entry.entry_type === 'refund').reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  const expensesTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)

  return {
    date,
    check_ins: checkIns,
    check_outs: checkOuts,
    new_bookings: newBookings,
    pos_orders: posOrders,
    pos_revenue: posOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    gross_collected: grossCollected,
    refunds_issued: refundsIssued,
    net_collected: grossCollected - refundsIssued,
    expenses_total: expensesTotal,
    outstanding,
    outstanding_total: outstanding.reduce((sum, booking) => sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)), 0)
  }
}

/** @param {string} lodgeId */
async function fetchSettingsRecord(lodgeId) {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('lodge_id', lodgeId)
    .maybeSingle()
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load lodge settings.'))
  return data || null
}

/** @param {string} lodgeId */
async function fetchEntitlementRpc(lodgeId) {
  // src/lib/supabase.js creates the client without a generated Database type;
  // this RPC's upstream SDK `data` is therefore `any` and remains unvalidated.
  const { data, error } = await supabase.rpc('get_lodge_entitlement', { p_lodge_id: lodgeId })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load lodge access.'))
  return data
}

/** @param {string} lodgeId */
async function fetchFeatureOverrides(lodgeId) {
  const rows = await safeSelect(
    supabase.from('lodge_features').select('feature_name, enabled').eq('lodge_id', lodgeId),
    []
  )
  return rows.reduce((acc, row) => {
    if (!row?.feature_name) return acc
    // This exact select reads the NOT NULL text feature_name column from
    // public.lodge_features; the assertion affects types only and leaves the
    // original property-key coercion and getter reads intact.
    acc[/** @type {string} */ (row.feature_name)] = row.enabled !== false
    return acc
  }, /** @type {Record<string, boolean>} */ ({}))
}

/** @param {Record<string, unknown>} payload */
async function executeCreateCustomer(payload) {
  const { data, error } = await supabase.rpc('create_customer', { payload })
  ensureSuccess(data, error, 'Could not create customer')
  return data
}

/** @param {unknown} expense @param {'create' | 'update' | 'delete'} mode */
async function executeSaveExpense(expense, mode) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_expense', { payload: expense })
    ensureSuccess(data, error, 'Could not create expense')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_expense', {
      p_id: readDirectField(expense, 'id'),
      p_lodge_id: readDirectField(expense, 'lodge_id'),
      payload: expense
    })
    ensureSuccess(data, error, 'Could not update expense')
    return data
  }
  const { data, error } = await supabase.rpc('delete_expense', {
    p_id: readDirectField(expense, 'id'),
    p_lodge_id: readDirectField(expense, 'lodge_id')
  })
  ensureSuccess(data, error, 'Could not delete expense')
  return data
}

/** @param {'create' | 'update' | 'mark_sent' | 'convert'} mode @param {Record<string, unknown>} payload */
async function executeSaveQuotation(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_quotation', { payload })
    ensureSuccess(data, error, 'Could not create quotation')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_quotation', {
      p_id: payload.id,
      p_lodge_id: payload.lodge_id,
      payload
    })
    ensureSuccess(data, error, 'Could not update quotation')
    return data
  }
  if (mode === 'mark_sent') {
    const { data, error } = await supabase.rpc('mark_quotation_sent', {
      p_id: payload.id,
      p_lodge_id: payload.lodge_id
    })
    ensureSuccess(data, error, 'Could not mark quotation as sent')
    return data
  }
  const { data, error } = await supabase.rpc('convert_quotation_to_booking', payload)
  ensureSuccess(data, error, 'Could not convert quotation')
  return data
}

/** @param {'create' | 'resolve'} mode @param {unknown} payload */
async function executeMaintenance(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_maintenance_ticket', { payload })
    ensureSuccess(data, error, 'Could not create maintenance ticket')
    return data
  }
  const { data, error } = await supabase.rpc('resolve_maintenance_ticket', {
    p_id: String(readDirectField(payload, 'id')),
    p_lodge_id: String(readDirectField(payload, 'lodge_id'))
  })
  ensureSuccess(data, error, 'Could not resolve maintenance ticket')
  return data
}

/** @param {unknown} payload */
async function executeHousekeeping(payload) {
  const { data, error } = await supabase.rpc('update_room_housekeeping', payload)
  ensureSuccess(data, error, 'Could not update housekeeping')
  return data
}

/** @param {'create' | 'update' | 'delete'} mode @param {Record<string, unknown>} payload */
async function executeConference(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_conference_booking', { payload })
    ensureSuccess(data, error, 'Could not create conference booking')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_conference_booking', {
      p_id: payload.id,
      p_lodge_id: payload.lodge_id,
      payload
    })
    ensureSuccess(data, error, 'Could not update conference booking')
    return data
  }
  const { data, error } = await supabase.rpc('delete_conference_booking', {
    p_id: payload.id,
    p_lodge_id: payload.lodge_id
  })
  ensureSuccess(data, error, 'Could not delete conference booking')
  return data
}

/** @param {'create' | 'delete'} mode @param {unknown} payload */
async function executeDayUse(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('add_pool_day_use', { payload })
    ensureSuccess(data, error, 'Could not create day-use entry')
    return data
  }
  const { data, error } = await supabase.rpc('delete_pool_day_use', {
    p_id: readDirectField(payload, 'id'),
    p_lodge_id: readDirectField(payload, 'lodge_id')
  })
  ensureSuccess(data, error, 'Could not delete day-use entry')
  return data
}

/** @param {'create' | 'update' | 'delete' | 'purchase' | 'adjust'} mode @param {unknown} payload */
async function executeInventory(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_inventory_item', { payload })
    ensureSuccess(data, error, 'Could not create inventory item')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_inventory_item', {
      p_id: readDirectField(payload, 'id'),
      p_lodge_id: readDirectField(payload, 'lodge_id'),
      payload
    })
    ensureSuccess(data, error, 'Could not update inventory item')
    return data
  }
  if (mode === 'delete') {
    const { data, error } = await supabase.rpc('delete_inventory_item', {
      p_id: readDirectField(payload, 'id'),
      p_lodge_id: readDirectField(payload, 'lodge_id')
    })
    ensureSuccess(data, error, 'Could not delete inventory item')
    return data
  }
  if (mode === 'purchase') {
    const { data, error } = await supabase.rpc('add_inventory_purchase', { payload })
    ensureSuccess(data, error, 'Could not record inventory purchase')
    return data
  }
  const { data, error } = await supabase.rpc('adjust_inventory_stock', {
    p_item_id: readDirectField(payload, 'id'),
    p_lodge_id: readDirectField(payload, 'lodge_id'),
    p_delta: readDirectField(payload, 'delta'),
    p_notes: readDirectField(payload, 'notes') || '',
    p_adjustment_id: readDirectField(payload, 'adjustment_id') || crypto.randomUUID()
  })
  ensureSuccess(data, error, 'Could not adjust stock')
  return data
}

/** @param {unknown} payload @param {unknown} [operationId] */
async function executeSupport(payload, operationId = null) {
  const { data, error } = await supabase.rpc('create_support_ticket', {
    payload: {
      lodge_id: readDirectField(payload, 'lodge_id'),
      lodge_name: readDirectField(payload, 'lodge_name') || null,
      title: readDirectField(payload, 'title'),
      description: readDirectField(payload, 'description'),
      category: readDirectField(payload, 'category') || 'General',
      priority: readDirectField(payload, 'priority') || 'Normal',
      source: readDirectField(payload, 'source') || 'manager_pwa',
      sender_type: readDirectField(payload, 'sender_type') || readDirectField(payload, 'requester_surface') || 'manager_pwa',
      sender_name: readDirectField(payload, 'sender_name') || readDirectField(payload, 'requester_name') || '',
      sender_role: readDirectField(payload, 'sender_role') || readDirectField(payload, 'requester_role') || '',
      sender_user_id: readDirectField(payload, 'sender_user_id') || readDirectField(payload, 'requester_user_id') || '',
      sender_surface: readDirectField(payload, 'sender_surface') || readDirectField(payload, 'requester_surface') || 'manager_pwa',
      requester_name: readDirectField(payload, 'requester_name') || readDirectField(payload, 'sender_name') || '',
      requester_role: readDirectField(payload, 'requester_role') || readDirectField(payload, 'sender_role') || '',
      requester_user_id: readDirectField(payload, 'requester_user_id') || readDirectField(payload, 'sender_user_id') || '',
      operation_id: operationId || readDirectField(payload, 'client_operation_id') || readDirectField(payload, 'operation_id') || null
    }
  })
  ensureSuccess(data, error, 'Could not create support request')
  return data
}

/** @param {unknown} payload @param {unknown} [operationId] */
async function executeSupportMessage(payload, operationId = null) {
  const { data, error } = await supabase.rpc('add_lodge_support_ticket_message', {
    p_ticket_id: readDirectField(payload, 'ticket_id'),
    p_lodge_id: readDirectField(payload, 'lodge_id'),
    p_body: readDirectField(payload, 'body'),
    p_sender_type: readDirectField(payload, 'sender_type') || 'manager_pwa',
    p_sender_name: readDirectField(payload, 'sender_name') || 'Manager Mobile App',
    p_sender_role: readDirectField(payload, 'sender_role') || 'manager',
    p_sender_user_id: readDirectField(payload, 'sender_user_id') || '',
    p_sender_surface: readDirectField(payload, 'sender_surface') || 'manager_pwa',
    p_metadata: readDirectField(payload, 'metadata') || {},
    p_status: readDirectField(payload, 'status') || null,
    p_operation_id: operationId || readDirectField(payload, 'client_operation_id') || readDirectField(payload, 'operation_id') || null
  })
  ensureSuccess(data, error, 'Could not add request message')
  return data
}

/** @param {unknown} type @returns {boolean} */
function isSupportOperation(type) {
  return type === 'support/create' || type === 'support/message'
}

/** @param {unknown} error @returns {boolean} */
function isTransportFailure(error) {
  const message = lowerCaseValue(friendlyErrorMessage(error, ''))
  return testPattern(/failed to fetch|network|timeout|timed out|connection reset|econn|err_connection|503|502|504/, message)
}

/** @param {{lodgeId: string, type: string, label: string, payload: QueuePayload, execute: (payload: QueuePayload, operationId: string | null) => Promise<unknown>, optimistic?: (() => unknown) | null}} input */
async function queueOrRun({ lodgeId, type, label, payload, execute, optimistic }) {
  const supportOperation = isSupportOperation(type)
  const queueItem = createQueuedOperation(type, label, payload)
  const operationId = supportOperation
    ? payload?.client_operation_id || payload?.operation_id || queueItem.id
    : null
  const executionPayload = supportOperation
    ? { ...payload, client_operation_id: operationId }
    : payload
  if (supportOperation) {
    // The PWA queue ID is the idempotency key. If a caller supplied an
    // operation ID, preserve it as the queue ID so offline and online paths
    // use the same server operation.
    // A support operation always falls back to the generated string ID, so
    // operationId is non-null here; retain the constructor ID if the branch
    // invariant is ever changed.
    if (operationId !== null) queueItem.id = operationId
    queueItem.payload = executionPayload
    // Write-ahead persistence is part of the support mutation contract. A
    // storage failure throws before the RPC is even attempted.
    try {
      enqueueOfflineOperationVerified(lodgeId, queueItem)
    } catch (error) {
      throw friendlyPwaQueueError(error, label)
    }
  }
  if (isOfflineMode()) {
    if (BLOCKED_PWA_MUTATION_TYPES.has(type)) {
      appendIssueLog(lodgeId, {
        scope: type,
        severity: 'warn',
        message: `"${label}" attempted while offline — not saved`,
        detail: FRONT_DESK_ONLY_MESSAGE,
        context: { type, label, payload }
      })
      throw new Error(`${label} requires an internet connection and cannot be saved offline. Use Front Desk when back online.`)
    }
    if (optimistic) optimistic()
    if (!supportOperation) {
      try {
        enqueueOfflineOperationVerified(lodgeId, queueItem)
      } catch (error) {
        throw friendlyPwaQueueError(error, label)
      }
    }
    return { success: true, queued: true, operation_id: operationId }
  }
  try {
    const result = await execute(executionPayload, operationId)
    if (supportOperation) removeOfflineOperation(lodgeId, operationId)
    return result
  } catch (error) {
    // A support RPC is safe to retain after an ambiguous transport failure:
    // the same queue item ID will replay the exact request and the server
    // returns the original ticket/message rather than creating another row.
    if (supportOperation && isTransportFailure(error)) {
      return { success: true, queued: true, operation_id: operationId, transport_recovered: true }
    }
    throw error
  }
}

/** @param {string} lodgeId */
async function getSettings(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'settings',
    fallback: null,
    fetcher: () => fetchSettingsRecord(lodgeId)
  })
}

export { getSettings }

/** @param {string} lodgeId @param {{forceFresh?: boolean}} [options] */
export async function getEntitlement(lodgeId, options = {}) {
  return queryWithCache({
    lodgeId,
    key: 'entitlement',
    fallback: getStoredEntitlement(lodgeId),
    forceFresh: options.forceFresh === true,
    maxAgeMs: ENTITLEMENT_CACHE_MAX_AGE_MS,
    fetcher: async () => {
      try {
        const entitlement = await fetchEntitlementRpc(lodgeId)
        if (entitlement && entitlement.success !== false && entitlement.entitlement_unverified !== true) {
          storeEntitlement(lodgeId, entitlement)
          return entitlement
        }
      } catch {
        // A transport failure may use a still-valid server-issued offline lease.
      }

      const cached = getStoredEntitlement(lodgeId)
      if (cached && cached.expired !== true) {
        return { ...cached, source: 'offline_lease', offline: true }
      }

      // Do not synthesize a plan or feature set when entitlement verification
      // failed.  Callers can render a locked state and ask the operator to
      // reconnect/verify instead of granting accidental access.
      return {
        success: false,
        status: 'unverified',
        expired: true,
        entitlement_unverified: true,
        lodge_id: lodgeId,
        plan: null,
        effective_features: { ...STARTER_FEATURE_FLAGS }
      }
    }
  })
}

/** @param {string} lodgeId */
export async function getDashboardSnapshot(lodgeId) {
  assertCapability('dashboard.view')
  return queryWithCache({
    lodgeId,
    key: 'dashboard',
    fallback: null,
    fetcher: async () => {
      const today = formatDate(new Date())
      try {
        const snapshot = await readRpcJson(
          'get_manager_dashboard_snapshot',
          { p_lodge_id: lodgeId, p_today: today },
          'Could not load dashboard snapshot'
        )
        if (!snapshot || typeof snapshot !== 'object') {
          throw new Error('Dashboard snapshot was empty.')
        }
        return snapshot
      } catch (rpcError) {
        try {
          return await buildDashboardSnapshotLegacy(lodgeId, today)
        } catch (fallbackError) {
          recordPwaIssue(lodgeId, 'dashboard.load', rpcError, { fallbackError, source: 'dashboard' })
          throw errorWithMessage(describeReadError('Dashboard', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

/** @param {string} lodgeId @param {{today?: string, forceFresh?: boolean}} [options] */
export async function getReportsSnapshot(lodgeId, options = {}) {
  assertCapability('dashboard.view')
  const today = options.today || formatDate(new Date())
  const todayDate = new Date(`${today}T00:00:00`)
  const monthStart = `${today.slice(0, 7)}-01`
  const monthEnd = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0))
  return queryWithCache({
    lodgeId,
    key: 'reports_snapshot',
    fallback: null,
    forceFresh: options.forceFresh === true,
    fetcher: async () => {
      try {
        const snapshot = await readRpcJson(
          'get_reports_snapshot',
          { p_lodge_id: lodgeId, p_today: today },
          'Could not load reports snapshot'
        )
        if (!snapshot || typeof snapshot !== 'object') {
          throw new Error('Reports snapshot was empty.')
        }
        const maintenanceRows = await listMaintenanceTickets(lodgeId, { forceFresh: options.forceFresh === true }).catch(() => [])
        return {
          ...snapshot,
          maintenanceCosts: maintenanceCostsForRange(maintenanceRows, monthStart, monthEnd),
          source: 'server'
        }
      } catch (rpcError) {
        try {
          const snapshot = await buildReportsSnapshotLegacy(lodgeId, today)
          if (typeof snapshot.maintenanceCosts !== 'number') {
            const maintenanceRows = await listMaintenanceTickets(lodgeId, { forceFresh: options.forceFresh === true }).catch(() => [])
            return {
              ...snapshot,
              maintenanceCosts: maintenanceCostsForRange(maintenanceRows, monthStart, monthEnd),
              source: 'fallback'
            }
          }
          return { ...snapshot, source: 'fallback' }
        } catch (fallbackError) {
          recordPwaIssue(lodgeId, 'reports.load', rpcError, { fallbackError, source: 'reports' })
          throw errorWithMessage(describeReadError('Reports', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

/** @param {string} lodgeId @param {{startDate?: string, endDate?: string, outletId?: string | null, forceFresh?: boolean}} [options] */
export async function getManagerPosSnapshot(lodgeId, options = {}) {
  assertCapability('pos.reports')
  const today = formatDate(new Date())
  const startDate = options.startDate || today
  const endDate = options.endDate || today
  const outletId = options.outletId || null
  const snapshot = await queryWithCache({
    lodgeId,
    key: `pos_snapshot:${startDate}:${endDate}:${outletId || 'all'}`,
    fallback: null,
    forceFresh: options.forceFresh === true,
    maxAgeMs: 30_000,
    allowStaleOnError: false,
    fetcher: async () => {
      const snapshot = await readRpcJson(
        'get_manager_pos_snapshot',
        {
          p_lodge_id: lodgeId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_outlet_id: outletId
        },
        'Could not load the POS sales snapshot.'
      )
      return snapshot
    }
  })
  const datasetStatus = String(readField(snapshot, 'dataset_status') || '').toLowerCase()
  const offline = isOfflineMode()
  const serverComplete = !offline
    && readField(snapshot, 'complete') === true
    && (readField(snapshot, 'source_coverage_complete') === undefined || readField(snapshot, 'source_coverage_complete') === true)
    && (!datasetStatus || datasetStatus === 'certified')
  return {
    ...Object(snapshot),
    source: offline ? 'server_cache' : 'server',
    financial_truth: serverComplete ? 'server_confirmed' : offline ? 'server_stale' : 'server_incomplete',
    complete: serverComplete,
    dataset_status: datasetStatus || (serverComplete ? 'certified' : offline ? 'stale' : 'incomplete')
  }
}

/** @param {string} lodgeId @param {{startDate?: string, endDate?: string, outletId?: string | null, status?: string, transactionType?: string, search?: string, limit?: number, offset?: number, forceFresh?: boolean}} [options] */
export async function getManagerPosTransactions(lodgeId, options = {}) {
  assertCapability('pos.reports')
  const today = formatDate(new Date())
  const data = await readRpcJson(
    'get_manager_pos_transactions',
    {
      p_lodge_id: lodgeId,
      p_start_date: options.startDate || today,
      p_end_date: options.endDate || today,
      p_outlet_id: options.outletId || null,
      p_status: options.status || 'posted',
      p_transaction_type: options.transactionType || 'all',
      p_search: options.search || null,
      p_limit: Math.min(Math.max(Number(options.limit) || 30, 1), 100),
      p_offset: Math.max(Number(options.offset) || 0, 0)
    },
    'Could not load POS transaction history.'
  )
  return {
    total_count: Number(readField(data, 'total_count') || 0),
    limit: Number(readField(data, 'limit') || options.limit || 30),
    offset: Number(readField(data, 'offset') || options.offset || 0),
    transactions: Array.isArray(readField(data, 'transactions')) ? readField(data, 'transactions') : []
  }
}

/** @param {string} lodgeId */
export async function listRooms(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'rooms',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('rooms').select('id, room_number, room_type, rate_per_night, max_occupancy, status, amenities, description, photo, photos, lodge_id, created_at, updated_at, housekeeping_status, housekeeping_notes').eq('lodge_id', lodgeId).order('room_number').limit(200), [])
  })
}

/**
 * @param {string} lodgeId
 * @param {{forceFresh?: boolean}} [options]
 * @returns {Promise<unknown>}
 */
export async function listBookings(lodgeId, options = {}) {
  // BOOKING_LIST_SELECT and normalizeBookingRelations produce the online rows.
  // queryWithCache may instead return unversioned persisted JSON without
  // runtime validation, so this storage boundary remains unknown.
  return queryWithCache({
    lodgeId,
    key: 'bookings',
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: async () => {
      const rows = await safeSelectPaged(
        () => supabase.from('bookings').select(BOOKING_LIST_SELECT).eq('lodge_id', lodgeId).order('check_in', { ascending: false }),
        []
      )
      return rows.map(normalizeBookingRelations)
    }
  })
}

/** @param {string} lodgeId */
async function listCustomers(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'customers',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('customers').select('id, name, email, phone, id_number, nationality, created_at, updated_at, is_blacklisted, blacklist_reason, lodge_id').eq('lodge_id', lodgeId).order('name').limit(500), [])
  })
}

/** @param {string} lodgeId @param {string} bookingId */
export async function getBookingPayments(lodgeId, bookingId) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_booking_payments', {
    p_booking_id: bookingId,
    p_lodge_id: lodgeId
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load booking payments.'))
  return data || []
}

/**
 * @param {string} lodgeId
 * @param {{forceFresh?: boolean}} [options]
 * @returns {Promise<unknown>}
 */
export async function listMaintenanceTickets(lodgeId, options = {}) {
  // The exact maintenance_tickets SELECT produces row objects. queryWithCache
  // may instead return unversioned persisted JSON without runtime validation,
  // so this storage boundary remains unknown.
  return queryWithCache({
    lodgeId,
    key: 'maintenance',
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: () => safeSelect(
      supabase
        .from('maintenance_tickets')
        .select('id, room_id, title, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, created_at')
        .eq('lodge_id', lodgeId)
        .order('created_at', { ascending: false })
        .limit(200),
      []
    )
  })
}

/** @param {unknown} [ticket] @returns {string} */
function maintenanceTicketDate(ticket = {}) {
  return String(readDirectField(ticket, 'reported_date') || readDirectField(ticket, 'created_at') || readDirectField(ticket, 'date') || '').slice(0, 10)
}

/** @param {unknown} rows @param {string} startDate @param {string} endDate @returns {unknown} */
function maintenanceCostsForRange(rows = [], startDate, endDate) {
  /** @type {(row: unknown) => boolean} */
  const inDateRange = (row) => {
      const day = maintenanceTicketDate(row)
      return (!startDate || day >= startDate) && (!endDate || day <= endDate)
  }
  const filtered = callDirectMethod(rows || [], 'filter', [inDateRange], '(rows || []).filter')
  /** @type {(sum: number, row: unknown) => number} */
  const addCost = (sum, row) => sum + Number(readDirectField(row, 'total_cost') || 0)
  return callDirectMethod(filtered, 'reduce', [addCost, 0], '(rows || []).filter(...).reduce')
}

/** @param {string} lodgeId @param {Record<string, unknown>} payload */
export async function createMaintenance(lodgeId, payload) {
  assertCapability('maintenance.view')
  const ticket = {
    ...payload,
    id: payload.id || crypto.randomUUID(),
    lodge_id: lodgeId,
    title: payload.title || payload.issue || '',
    issue: payload.issue || payload.title || '',
    description: payload.description || '',
    priority: payload.priority || 'medium',
    status: payload.status || 'open'
  }
  return queueOrRun({
    lodgeId,
    type: 'maintenance/create',
    label: 'Create maintenance ticket',
    payload: ticket,
    execute: () => executeMaintenance('create', ticket),
    optimistic: () => {
      mutateCachedList(lodgeId, 'maintenance', (rows) => {
        // listMaintenanceTickets caches selected rows; local cache contents
        // are not validated. This assertion records the expected list input
        // for the existing optimistic upsert only.
        const expectedRows = /** @type {IdentifiedPwaRecord[]} */ (rows)
        return upsertById(expectedRows, { ...ticket, queued_offline: true, created_at: new Date().toISOString() })
      })
    }
  })
}

/** @param {string} lodgeId */
export async function listQuotations(lodgeId) {
  assertCapability('quotations.view')
  return queryWithCache({
    lodgeId,
    key: 'quotations',
    fallback: [],
    fetcher: () => safeQuotationSelect(lodgeId)
  })
}

/** @param {string} lodgeId @param {string} start @param {string} end */
export async function listExpenses(lodgeId, start, end) {
  assertCapability('expenses.view')
  // Expenses are a financial source read. Do not silently turn a failed server
  // read into a stale local estimate; the caller must show the operator that
  // the source is unavailable and keep the value out of a financial total.
  const rows = await safeSelectPaged(() => {
    let query = supabase.from('expenses').select('id, date, category, description, amount, outlet_id, created_at, updated_at, status, operation_id, journal_entry_id').eq('lodge_id', lodgeId)
    if (start) query = query.gte('date', start)
    if (end) query = query.lte('date', end)
    return query.order('date', { ascending: false }).order('id', { ascending: false })
  }, [])
  Object.defineProperties(rows, {
    _source: { value: 'server', enumerable: false, configurable: true },
    _complete: { value: true, enumerable: false, configurable: true }
  })
  return rows
}

/** @param {string} lodgeId */
export async function listGuests(lodgeId) {
  assertCapability('guests.view')
  return listCustomers(lodgeId)
}

/** @param {string} lodgeId @param {string} customerId */
export async function getGuestHistory(lodgeId, customerId) {
  assertCapability('guests.view')
  const rows = await safeSelect(
    supabase.from('bookings').select(BOOKING_LIST_SELECT).eq('lodge_id', lodgeId).eq('customer_id', customerId).order('check_in', { ascending: false }).limit(200),
    []
  )
  return rows.map(normalizeBookingRelations)
}

/** @param {string} lodgeId @param {{search?: string, limit?: number, offset?: number}} [options] */
export async function getGuestLifetimeSummary(lodgeId, { search = '', limit = 50, offset = 0 } = {}) {
  assertCapability('guests.view')
  const { data, error } = await supabase.rpc('get_guest_lifetime_summary', {
    p_lodge_id: lodgeId,
    p_search: search || null,
    p_limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
    p_offset: Math.max(Number(offset) || 0, 0)
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load guest summaries.'))
  return Array.isArray(data) ? data : []
}

/** @param {string} lodgeId @param {{search?: string}} [options] */
export async function getGuestLifetimeCount(lodgeId, { search = '' } = {}) {
  assertCapability('guests.view')
  const { data, error } = await supabase.rpc('get_guest_lifetime_count', {
    p_lodge_id: lodgeId,
    p_search: search || null
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not count guests.'))
  return Number(data || 0)
}

/** @param {string} lodgeId */
export async function listStaff(lodgeId) {
  assertCapability('staff.view')
  return queryWithCache({
    lodgeId,
    key: 'staff',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('users').select('id, name, email, role, status, created_at, lodge_id, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, invite_sent_at, password_updated_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, allowed_outlet_ids, capability_overrides').eq('lodge_id', lodgeId).order('name').limit(200), [])
  })
}

/** @param {string} lodgeId @param {string} start @param {string} end */
export async function listConferenceBookings(lodgeId, start, end) {
  assertCapability('conference.view')
  return queryWithCache({
    lodgeId,
    key: 'conference',
    fallback: [],
    fetcher: async () => {
      let query = supabase.from('conference_bookings').select(CONFERENCE_BOOKING_SELECT).eq('lodge_id', lodgeId)
      if (start) query = query.gte('booking_date', start)
      if (end) query = query.lte('booking_date', end)
      return safeSelect(query.order('booking_date', { ascending: false }).order('start_time').limit(200), [])
    }
  })
}

/** @param {string} lodgeId @param {string} start @param {string} end */
export async function listDayUseEntries(lodgeId, start, end) {
  assertCapability('pool.view')
  return queryWithCache({
    lodgeId,
    key: 'dayuse',
    fallback: [],
    fetcher: async () => {
      let query = supabase.from('pool_day_use').select(DAY_USE_LIST_SELECT).eq('lodge_id', lodgeId)
      if (start) query = query.gte('date', start)
      if (end) query = query.lte('date', end)
      return safeSelect(query.order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500), [])
    }
  })
}

/** @param {string} lodgeId */
export async function listInventory(lodgeId) {
  assertCapability('inventory.view')
  return queryWithCache({
    lodgeId,
    key: 'inventory',
    fallback: [],
    fetcher: () => safeInventorySelect(lodgeId)
  })
}

/** @param {string} lodgeId @param {{forceFresh?: boolean, startDate?: string, endDate?: string}} [options] */
export async function listInvoices(lodgeId, options = {}) {
  assertCapability('invoices.view')
  return queryWithCache({
    lodgeId,
    key: 'invoice_summary_v2',
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: async () => {
      try {
        const { data, error } = await supabase.rpc('get_invoice_summary', {
          p_lodge_id: lodgeId,
          p_booking_id: null
        })
        if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load invoices.'))
        // The Supabase client has no generated Database generic, so RPC `data`
        // is upstream any. The SQL function returns a row set; keep each row's
        // fields unknown while constructing our own result records.
        const invoiceRows = /** @type {PwaRecord[]} */ ((data || [])
          .map(/** @param {unknown} invoice @returns {PwaRecord} */ (invoice) => ({
            ...Object(invoice),
            invoice_id: readDirectField(invoice, 'invoice_id') || null,
            booking_id: readDirectField(invoice, 'booking_id'),
            invoice_number: readDirectField(invoice, 'invoice_number'),
            issued_at: readDirectField(invoice, 'issued_at') || null,
            due_date: readDirectField(invoice, 'due_date') || readDirectField(invoice, 'check_in') || null,
            invoice_notes: readDirectField(invoice, 'notes') || '',
            customer_name: readDirectField(invoice, 'guest_name') || 'Guest',
            status: readDirectField(invoice, 'booking_status'),
            total_amount: Number(readDirectField(invoice, 'total_amount') || 0),
            charges_total: Number(readDirectField(invoice, 'charges_total') || 0),
            amount_paid: Number(readDirectField(invoice, 'amount_paid') || 0),
            balance_due: Math.max(0, Number(readDirectField(invoice, 'balance_due') || 0)),
            payment_count: Number(readDirectField(invoice, 'payment_count') || 0),
            nights:
              readDirectField(invoice, 'check_in') && readDirectField(invoice, 'check_out')
                ? Math.max(0, Math.ceil((Reflect.construct(Date, [readDirectField(invoice, 'check_out')]) - Reflect.construct(Date, [readDirectField(invoice, 'check_in')])) / 86400000))
                : 0
          })))
        return invoiceRows.sort((left, right) =>
            String(right.issued_at || right.created_at || '').localeCompare(String(left.issued_at || left.created_at || ''))
          )
      } catch {
        const [bookings, invoices] = await Promise.all([
          listBookings(lodgeId, { forceFresh: true }),
          safeSelect(
            supabase
              .from('invoices')
              .select('id, booking_id, lodge_id, invoice_number, issued_at, due_date, notes, created_at')
              .eq('lodge_id', lodgeId)
              .not('booking_id', 'is', null)
              .order('issued_at', { ascending: false }),
            []
          )
        ])

        const byBooking = new Map(invoices.filter((invoice) => invoice?.booking_id).map((invoice) => [invoice.booking_id, invoice]))
        // Fields read by this fallback come from BOOKING_LIST_SELECT. This
        // expected consumer shape does not validate unversioned cache data.
        const invoiceBookings = /** @type {(PwaRecord & {check_in: string, check_out: string, status: string | null, payment_status: string | null, created_at: string | null})[]} */ (bookings)
        return /** @type {PwaRecord[]} */ (invoiceBookings
          .map((booking) => {
            const invoice = byBooking.get(booking.id)
            const invoiceNumber = invoice?.invoice_number || booking.invoice_number
            if (!invoiceNumber) return null
            const totalAmount = Number(booking.total_amount || 0)
            const chargesTotal = Number(booking.charges_total || 0)
            const amountPaid = Number(booking.amount_paid || 0)
            return {
              ...booking,
              booking_id: booking.id,
              invoice_id: invoice?.id || null,
              invoice_number: invoiceNumber,
              issued_at: invoice?.issued_at || booking.created_at || null,
              due_date: invoice?.due_date || booking.check_in || null,
              invoice_notes: invoice?.notes || '',
              customer_name: booking.guest_name || 'Guest',
              balance_due: Math.max(0, totalAmount + chargesTotal - amountPaid),
              // Subtraction applies native Date's number-hint primitive
              // conversion. The intersection types model that numeric operand;
              // Reflect.construct and native coercion remain unchanged.
              nights: Math.max(0, Math.ceil((/** @type {Date & number} */ (Reflect.construct(Date, [booking.check_out])) - /** @type {Date & number} */ (Reflect.construct(Date, [booking.check_in]))) / 86400000))
            }
          })
          .filter(Boolean)).sort((left, right) =>
            String(right.issued_at || right.created_at || '').localeCompare(String(left.issued_at || left.created_at || ''))
          )
      }
    }
  })
}

/** @param {string} lodgeId @param {string | null} [bookingId] */
export async function listHotelFolios(lodgeId, bookingId = null) {
  assertCapability('folios.view')
  const { data, error } = await supabase.rpc('get_hotel_folios', {
    p_lodge_id: lodgeId,
    p_booking_id: bookingId || null
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load hotel folios.'))
  return Array.isArray(data) ? data : []
}

/** @param {string} lodgeId @param {string} folioId */
export async function getHotelFolioLines(lodgeId, folioId) {
  assertCapability('folios.view')
  const { data, error } = await supabase.rpc('get_folio_line_items', {
    p_lodge_id: lodgeId,
    p_folio_id: folioId
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load folio lines.'))
  return Array.isArray(data) ? data : []
}

/** @param {string} name @param {Record<string, unknown>} args @param {string} fallback @returns {Promise<unknown>} */
async function hotelWorkflowRpc(name, args, fallback) {
  // The untyped RPC name resolves to upstream SDK `any` because the shared
  // Supabase client has no generated Database function schema.
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw errorWithMessage(friendlyErrorMessage(error, fallback))
  if (data?.success === false) throw new Error(data.error || fallback)
  return data || {}
}

/** @param {string} lodgeId @param {string} bookingId @param {'checkin' | 'checkout'} direction */
export async function getHotelWorkflowChecklist(lodgeId, bookingId, direction) {
  assertCapability(direction === 'checkout' ? 'checkout.manage' : 'checkin.manage')
  return hotelWorkflowRpc(
    direction === 'checkout' ? 'get_checkout_checklist' : 'get_checkin_checklist',
    { p_booking_id: bookingId, p_lodge_id: lodgeId },
    'Could not load the hotel workflow checklist.'
  )
}

/** @param {string} lodgeId @param {string} stepId @param {'checkin' | 'checkout'} direction */
export async function completeHotelWorkflowStep(lodgeId, stepId, direction) {
  assertCapability(direction === 'checkout' ? 'checkout.manage' : 'checkin.manage')
  return hotelWorkflowRpc(
    direction === 'checkout' ? 'complete_checkout_step' : 'complete_checkin_step',
    { p_step_id: stepId, p_lodge_id: lodgeId, p_completed_by: null, p_data: null },
    'Could not complete this hotel workflow step.'
  )
}

/** @param {string} lodgeId @param {string} bookingId @param {'checkin' | 'checkout'} direction */
export async function completeHotelStayWorkflow(lodgeId, bookingId, direction) {
  assertCapability(direction === 'checkout' ? 'checkout.manage' : 'checkin.manage')
  return hotelWorkflowRpc(
    direction === 'checkout' ? 'complete_hotel_checkout' : 'complete_hotel_checkin',
    { p_lodge_id: lodgeId, p_booking_id: bookingId },
    direction === 'checkout' ? 'Could not complete hotel check-out.' : 'Could not complete hotel check-in.'
  )
}

/** @param {string} lodgeId */
export async function getHotelNightAuditChecks(lodgeId) {
  assertCapability('night_audit.checks')
  return hotelWorkflowRpc(
    'run_night_audit_checks',
    { p_lodge_id: lodgeId },
    'Could not run hotel night-audit checks.'
  )
}

/** @param {string} lodgeId */
export async function listRestaurantTables(lodgeId) {
  assertCapability('pos.reports')
  return safeSelect(supabase.from('pos_tables').select('id, outlet_id, name, area, seats, active, updated_at').eq('lodge_id', lodgeId).eq('active', true).order('area').order('name'), [])
}

/** @param {string} lodgeId */
export async function listRestaurantPrepTickets(lodgeId) {
  assertCapability('pos.reports')
  return safeSelect(supabase.from('pos_prep_tickets').select('id, outlet_id, station, status, table_name, tab_name, waiter_name, notes, items, created_at, updated_at').eq('lodge_id', lodgeId).in('status', ['new', 'preparing', 'ready']).order('created_at'), [])
}

/** @param {string} lodgeId @param {string} ticketId @param {string} status */
export async function updateRestaurantPrepTicket(lodgeId, ticketId, status) {
  assertCapability('pos.reports')
  return hotelWorkflowRpc('update_pos_prep_ticket_status', { p_ticket_id: ticketId, p_status: status, p_lodge_id: lodgeId, p_operation_id: `pwa-ticket:${ticketId}:${String(status || '').toLowerCase()}` }, 'Could not update the kitchen ticket.')
}

/** @param {string} lodgeId */
export async function listRestaurantMenu(lodgeId) {
  assertCapability('pos.reports')
  return safeSelect(supabase.from('pos_menu_items').select('id, name, category, price, is_available, barcode, prep_time_minutes, dietary_flags, outlet_id').eq('lodge_id', lodgeId).order('category').order('name').limit(500), [])
}

/** @param {string} lodgeId @param {string} date */
export async function getNightAudit(lodgeId, date) {
  assertCapability('audit.view')
  return queryWithCache({
    lodgeId,
    key: `night_audit:${date}`,
    fallback: null,
    forceFresh: true,
    fetcher: async () => {
      try {
        const snapshot = await readRpcJson(
          'get_night_audit_summary',
          { p_lodge_id: lodgeId, p_audit_date: date },
          'Could not run the night audit'
        )
        if (!snapshot || typeof snapshot !== 'object') {
          throw new Error('Night audit response was empty.')
        }
        return snapshot
      } catch (rpcError) {
        try {
          return await buildNightAuditLegacy(lodgeId, date)
        } catch (fallbackError) {
          recordPwaIssue(lodgeId, 'night-audit.load', rpcError, { fallbackError, date, source: 'night-audit' })
          throw errorWithMessage(describeReadError('Night audit', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

/** @param {string} lodgeId @param {number} [limit] */
export async function getRefundHistory(lodgeId, limit = 20) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_refund_approval_log', {
    p_lodge_id: lodgeId,
    p_booking_id: null,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load refund history.'))
  return Array.isArray(data) ? data : []
}

/** @param {string} lodgeId @param {string} [search] @param {number} [limit] @param {number} [offset] */
export async function getCustomerCreditSummaryPwa(lodgeId, search = '', limit = 50, offset = 0) {
  if (!lodgeId) throw new Error('A lodge is required to load customer credit summary.')
  assertCapability('prepayments.view', { lodgeId })
  // The shared client has no generated Database function schema, so the SDK
  // types this RPC response as `any`; the array check below is the existing
  // runtime behavior and does not validate row fields.
  const { data, error } = await supabase.rpc('get_customer_credit_summary', {
    p_lodge_id: lodgeId,
    p_search: search || null,
    p_limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
    p_offset: Math.max(Number(offset) || 0, 0)
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load customer credit summary.'))
  if (!Array.isArray(data)) throw new Error('The authoritative customer credit summary response was unavailable or malformed.')
  return data
}

/** @param {string} lodgeId @param {number} [limit] */
async function getInvoiceDeliveryHistory(lodgeId, limit = 20) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_invoice_delivery_history', {
    p_lodge_id: lodgeId,
    p_booking_id: null,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load invoice delivery history.'))
  return Array.isArray(data) ? data : []
}

/** @param {string} lodgeId @param {number} [limit] */
async function getFinancialValidationAlerts(lodgeId, limit = 10) {
  assertCapability('dashboard.view')
  try {
    const { data, error } = await supabase.rpc('get_financial_validation_alerts', {
      p_lodge_id: lodgeId,
      p_limit: Math.min(Math.max(Number(limit) || 10, 1), 50)
    })
    if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load validation alerts.'))
    return Array.isArray(data) ? data : []
  } catch (error) {
    recordPwaIssue(lodgeId, 'validation-alerts.load', error, { source: 'validation-alerts', severity: 'warn' })
    throw errorWithMessage(describeReadError('Validation alerts', error, 'Could not load validation alerts.'))
  }
}

/** @param {string} lodgeId @param {number} [limit] */
export async function getFinancialActivityFeed(lodgeId, limit = 20) {
  assertCapability('dashboard.view')
  const [auditRows, deliveryRows, refundRows, maintenanceRows, bookings] = await Promise.all([
    safeSelect(
      supabase.rpc('get_financial_audit_log', {
        p_lodge_id: lodgeId,
        p_booking_id: null,
        p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
        p_offset: 0
      }),
      []
    ),
    getInvoiceDeliveryHistory(lodgeId, limit).catch(() => []),
    getRefundHistory(lodgeId, limit).catch(() => []),
    safeSelect(supabase.from('maintenance_tickets').select('id, room_id, title, priority, status, created_at').eq('lodge_id', lodgeId).order('created_at', { ascending: false }).limit(limit), []),
    safeSelect(
      supabase
        .from('bookings')
        .select('id, customer_id, room_id, created_at, status, invoice_number, customer:customers(name), room:rooms(room_number)')
        .eq('lodge_id', lodgeId)
        .order('created_at', { ascending: false })
        .limit(limit),
      []
    ).then((rows) => rows.map(normalizeBookingRelations))
  ])

  const activity = [
    ...auditRows.map((row) => ({
      id: `audit:${row.id}`,
      type: row.action || 'financial_event',
      title: titleCase(String(row.action || 'financial event').replace(/_/g, ' ')),
      sub: readDirectField(row, 'booking_id')
        ? `Booking ${callDirectMethod(readDirectField(row, 'booking_id'), 'slice', [0, 8], 'row.booking_id.slice')}`
        : 'Financial record',
      amount: Number(row.amount_delta || 0),
      created_at: row.created_at
    })),
    ...deliveryRows.map((row) => ({
      id: `delivery:${row.id}`,
      type: row.delivery_type || 'invoice_delivery',
      title: titleCase(String(row.delivery_type || 'invoice delivery').replace(/_/g, ' ')),
      sub: `${row.invoice_number || 'Invoice'}${row.recipient ? ` • ${row.recipient}` : ''}`,
      amount: null,
      created_at: row.created_at
    })),
    ...refundRows.map((row) => ({
      id: `refund:${row.id}`,
      type: 'refund_approved',
      title: 'Refund Approved',
      sub: `${row.invoice_number || 'Invoice'}${row.approved_by_name ? ` • ${row.approved_by_name}` : ''}`,
      amount: -Math.abs(Number(row.refund_amount || 0)),
      created_at: row.created_at
    })),
    ...maintenanceRows.map((row) => ({
      id: `maintenance:${row.id}`,
      type: 'maintenance_ticket',
      title: row.title || 'Maintenance ticket',
      sub: `Priority ${titleCase(row.priority || 'normal')} • ${titleCase(row.status || 'open')}`,
      amount: null,
      created_at: row.created_at
    })),
    ...bookings.map((row) => ({
      id: `booking:${row.id}`,
      type: 'booking_created',
      title: 'Booking Created',
      sub: `${guestName(row)}${row.room_number ? ` • Room ${row.room_number}` : ''}`,
      amount: null,
      created_at: row.created_at
    }))
  ]

  return activity
    .filter((row) => row.created_at)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, limit)
}

/** @param {string} lodgeId @param {number} [limit] @param {{forceFresh?: boolean}} [options] */
export async function getSupportRequests(lodgeId, limit = 20, options = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  return queryWithCache({
    lodgeId,
    key: `support_requests:${safeLimit}`,
    fallback: [],
    forceFresh: options.forceFresh === true,
    maxAgeMs: 60_000,
    fetcher: async () => {
      const { data, error } = await supabase.rpc('get_lodge_support_tickets', {
        p_lodge_id: lodgeId,
        p_limit: safeLimit
      })
      if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not load support requests.'))
      return normalizeSupportTickets(data)
    }
  })
}

/** @param {string} lodgeId @param {string} ticketId @param {'manager' | 'front_desk'} [audience] @param {string | null} [messageId] */
export async function markSupportRequestRead(lodgeId, ticketId, audience = 'manager', messageId = null) {
  const { data, error } = await supabase.rpc('mark_lodge_support_ticket_read', {
    p_ticket_id: ticketId,
    p_lodge_id: lodgeId,
    p_audience: audience,
    p_message_id: messageId || null
  })
  ensureSuccess(data, error, 'Could not update inbox read state')
  return data
}

/** @param {string} lodgeId @param {QueuePayload} payload */
export async function createSupportTicket(lodgeId, payload) {
  const carriedPayload = { ...payload, lodge_id: lodgeId }
  return queueOrRun({
    lodgeId,
    type: 'support/create',
    label: 'Create support request',
    payload: carriedPayload,
    execute: (executionPayload, operationId) => executeSupport(executionPayload, operationId),
    optimistic: null
  })
}

/** @param {string} lodgeId @param {string} ticketId @param {Record<string, unknown>} [payload] */
export async function addSupportTicketMessage(lodgeId, ticketId, payload = {}) {
  const carriedPayload = {
    ...payload,
    ticket_id: ticketId,
    lodge_id: lodgeId
  }
  return queueOrRun({
    lodgeId,
    type: 'support/message',
    label: 'Send request message',
    payload: carriedPayload,
    execute: (executionPayload, operationId) => executeSupportMessage(executionPayload, operationId),
    optimistic: null
  })
}

/** @param {string} lodgeId @returns {{count: unknown, items: unknown}} */
export function getQueueStatus(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  return {
    count: readDirectField(queue, 'length'),
    items: queue
  }
}

/** @param {string} lodgeId */
async function performOfflineQueueFlush(lodgeId) {
  if (isOfflineMode()) {
    return { processed: 0, remaining: readDirectField(getOfflineQueue(lodgeId), 'length') }
  }

  // Persisted JSON is not validated. Keep rows unknown; the iterable assertion
  // only describes the current flush operation and malformed non-iterables
  // retain the existing native spread TypeError.
  const queue = [.../** @type {Iterable<unknown>} */ (getOfflineQueue(lodgeId))]
  /** @type {Map<unknown, unknown>} */
  const snapshotById = new Map()
  for (const item of queue) snapshotById.set(readDirectField(item, 'id'), item)
  let processed = 0
  /** @type {unknown[]} */
  const remaining = []

  for (const item of queue) {
    try {
      const blockedType = readDirectField(item, 'type')
      if (typeof blockedType === 'string' && BLOCKED_PWA_MUTATION_TYPES.has(blockedType)) {
        remaining.push({
          ...spreadEnumerableProperties(item),
          blocked: true,
          lastError: FRONT_DESK_ONLY_MESSAGE,
          lastAttemptedAt: new Date().toISOString()
        })
        continue
      }
      switch (readDirectField(item, 'type')) {
        case 'room/housekeeping':
          await executeHousekeeping(readDirectField(item, 'payload'))
          break
        case 'maintenance/create':
          await executeMaintenance('create', readDirectField(item, 'payload'))
          break
        case 'maintenance/resolve':
          await executeMaintenance('resolve', readDirectField(item, 'payload'))
          break
        case 'expense/create':
          await executeSaveExpense(readDirectField(item, 'payload'), 'create')
          break
        case 'expense/update':
          await executeSaveExpense(readDirectField(item, 'payload'), 'update')
          break
        case 'expense/delete':
          await executeSaveExpense(readDirectField(item, 'payload'), 'delete')
          break
        case 'dayuse/create':
          await executeDayUse('create', readDirectField(item, 'payload'))
          break
        case 'dayuse/delete':
          await executeDayUse('delete', readDirectField(item, 'payload'))
          break
        case 'inventory/create':
          await executeInventory('create', readDirectField(item, 'payload'))
          break
        case 'inventory/update':
          await executeInventory('update', readDirectField(item, 'payload'))
          break
        case 'inventory/delete':
          await executeInventory('delete', readDirectField(item, 'payload'))
          break
        case 'inventory/purchase':
          await executeInventory('purchase', readDirectField(item, 'payload'))
          break
        case 'inventory/adjust':
          await executeInventory('adjust', {
            ...spreadEnumerableProperties(readDirectField(item, 'payload')),
            adjustment_id: readField(readDirectField(item, 'payload'), 'adjustment_id') || readDirectField(item, 'id')
          })
          break
        case 'support/create':
          await executeSupport(readDirectField(item, 'payload'), readDirectField(item, 'id'))
          break
        case 'support/message':
          await executeSupportMessage(readDirectField(item, 'payload'), readDirectField(item, 'id'))
          break
        default:
          remaining.push(item)
          continue
      }
      processed += 1
    } catch (error) {
      remaining.push({ ...spreadEnumerableProperties(item), lastError: readDirectField(error, 'message'), lastAttemptedAt: new Date().toISOString() })
    }
  }

  const latestQueue = getOfflineQueue(lodgeId)
  const changedDuringFlush = /** @type {unknown[]} */ (callDirectMethod(latestQueue, 'filter', [/** @param {unknown} item */ (item) => {
    const before = snapshotById.get(readDirectField(item, 'id'))
    return !before || JSON.stringify(before) !== JSON.stringify(item)
  }], 'latestQueue.filter'))
  /** @type {Map<unknown, unknown>} */
  const mergedById = new Map()
  for (const item of remaining) mergedById.set(readDirectField(item, 'id'), item)
  for (const item of changedDuringFlush) mergedById.set(readDirectField(item, 'id'), item)
  const nextQueue = [...mergedById.values()]

  setOfflineQueue(lodgeId, nextQueue)
  setRuntimeMeta(lodgeId, 'last-sync', { processed, remaining: nextQueue.length, updatedAt: new Date().toISOString() })

  await Promise.allSettled([
    listBookings(lodgeId),
    listRooms(lodgeId),
    listMaintenanceTickets(lodgeId),
    listCustomers(lodgeId),
    listQuotations(lodgeId).catch(() => []),
    listInventory(lodgeId).catch(() => []),
    getSettings(lodgeId).catch(() => null)
  ])

  return { processed, remaining: nextQueue.length }
}

/** @param {string} lodgeId */
export async function flushOfflineQueue(lodgeId) {
  const key = String(lodgeId || 'global').trim().toLowerCase()
  const existing = queueFlushLocks.get(key)
  if (existing) return existing

  const task = performOfflineQueueFlush(lodgeId).finally(() => {
    queueFlushLocks.delete(key)
  })
  queueFlushLocks.set(key, task)
  return task
}

/** @param {string} lodgeId */
export async function getControlSnapshot(lodgeId) {
  const [settings, entitlement, validationAlerts] = await Promise.all([
    getSettings(lodgeId).catch(() => null),
    getEntitlement(lodgeId).catch(() => getStoredEntitlement(lodgeId)),
    getFinancialValidationAlerts(lodgeId, 5).catch(() => [])
  ])
  const queue = getQueueStatus(lodgeId)
  const lastSync = getRuntimeMeta(lodgeId, 'last-sync', null)
  return {
    online: !isOfflineMode(),
    settings,
    entitlement,
    queue,
    lastSync,
    validationAlerts,
    recentIssues: readIssueLog(lodgeId, 8)
  }
}

/** @param {unknown} row @param {string} [email] @returns {PwaRecord} */
function normalizeManagerCandidate(row = {}, email = '') {
  const user = normalizeSessionUser({ ...Object(row), email: readField(row, 'email') || email })
  return {
    ...user,
    authenticated: readField(row, 'authenticated') === true,
    pwa_enabled: readField(row, 'pwa_enabled') === true,
    pwa_password_set_at: readField(row, 'pwa_password_set_at') || null,
    pwa_disabled_reason: readField(row, 'pwa_disabled_reason') || '',
    pwa_feature_enabled: readField(row, 'pwa_feature_enabled') === true,
    plan: readField(row, 'pwa_plan') || readField(row, 'plan') || 'Starter',
    session_token: typeof readField(row, 'session_token') === 'string' && readField(row, 'session_token') ? readField(row, 'session_token') : null,
    session_expires_at: readField(row, 'session_expires_at') || null,
    session_type: readField(row, 'session_type') || null
  }
}

/** @param {unknown} data @param {string} [email] @returns {PwaRecord[]} */
function extractManagerCandidates(data, email = '') {
  /** @type {PwaRecord[]} */
  const rows = []
  /** @param {unknown} value */
  const pushRow = (value) => {
    if (value && typeof value === 'object') {
      rows.push(normalizeManagerCandidate(value, email))
    }
  }

  /** @param {unknown} record @param {string} key @param {(value: unknown) => void} visit */
  const forEachArrayField = (record, key, visit) => {
    if (!Array.isArray(readField(record, key))) return
    // Keep the baseline's second field read and invoke its actual forEach with
    // the same receiver, so stateful getters/custom objects retain behavior.
    const values = readDirectField(record, key)
    const forEach = readDirectField(values, 'forEach')
    if (typeof forEach !== 'function') throw new TypeError(`dataRecord.${key}.forEach is not a function`)
    Reflect.apply(forEach, values, [visit])
  }

  if (Array.isArray(data)) {
    data.forEach(pushRow)
  } else if (data && typeof data === 'object') {
    forEachArrayField(data, 'lodges', pushRow)
    forEachArrayField(data, 'options', pushRow)
    forEachArrayField(data, 'users', pushRow)
    forEachArrayField(data, 'memberships', pushRow)
    if (readField(data, 'user')) pushRow(readField(data, 'user'))
    if (readField(data, 'session')) pushRow(readField(data, 'session'))
    if (readField(data, 'lodge_id') || readField(data, 'role') || readField(data, 'name') || readField(data, 'id')) pushRow(data)
  }

  const byLodge = new Map()
  rows
    .filter((row) => row.lodge_id)
    .forEach((row) => {
      const lodgeId = String(row.lodge_id).trim().toLowerCase()
      if (!byLodge.has(lodgeId)) byLodge.set(lodgeId, row)
    })
  return [...byLodge.values()]
}

/** @param {unknown} row @returns {boolean} */
export function isManagerPwaMembershipSelectable(row) {
  return readField(row, 'pwa_enabled') === true && readField(row, 'pwa_feature_enabled') === true
}

/** @param {unknown} row @returns {unknown} */
export function getManagerPwaMembershipBlockReason(row) {
  if (readField(row, 'pwa_feature_enabled') !== true) return PWA_PLAN_REQUIRED_MESSAGE
  if (readField(row, 'pwa_enabled') !== true) return readField(row, 'pwa_disabled_reason') || 'Manager mobile access is disabled for this business.'
  return ''
}

/** @param {unknown} rows @returns {PwaRecord[]} */
/** @param {PwaRecord[]} rows @returns {PwaRecord[]} */
function assertMembershipsAvailable(rows) {
  if (rows.length === 0) {
    throw new Error('That email or password is incorrect, or this account has no manager access.')
  }
  return rows
}

/**
 * After Supabase Auth password verification, list company memberships only.
 * Does not mint a lodge-scoped PWA session.
 */
/** @returns {Promise<PwaRecord[]>} */
export async function listManagerPwaMemberships() {
  const { data, error } = await supabase.rpc('list_manager_pwa_memberships')
  if (error) {
    throw errorWithMessage(friendlyErrorMessage(error, 'Could not load businesses for this account.'))
  }
  return extractManagerCandidates(data)
}

/**
 * Mint a lodge-scoped PWA session for one explicitly selected company.
 * Relies on the existing Supabase Auth session — password is not re-sent.
 */
/** @param {unknown} lodgeId */
export async function issueManagerPwaSession(lodgeId) {
  if (!lodgeId) {
    throw new Error('Select a business before continuing.')
  }

  const { data, error } = await supabase.rpc('issue_manager_pwa_session', {
    p_lodge_id: lodgeId
  })
  if (error) {
    throw errorWithMessage(friendlyErrorMessage(error, 'Could not open a manager session for that business.'))
  }

  const rows = extractManagerCandidates(data)
  const selected = rows.find((row) => row.lodge_id === String(lodgeId).trim().toLowerCase())
  if (!selected) {
    throw new Error('That business is no longer available for this account.')
  }
  if (!isManagerPwaMembershipSelectable(selected)) {
    const reason = getManagerPwaMembershipBlockReason(selected)
    const planError = errorWithMessage(reason)
    if (selected.pwa_enabled === true && selected.pwa_feature_enabled !== true) {
      /** @type {Error & {code: string}} */ (planError).code = 'pwa_plan_required'
    }
    throw planError
  }
  if (!selected.session_token || selected.authenticated !== true) {
    throw new Error('The server did not issue a valid mobile app session.')
  }
  return { user: selected }
}

/**
 * Sign in with email/password, then either:
 * - return { memberships } when more than one company is linked, or
 * - issue a session immediately when exactly one company is linked.
 * Password is not retained for a later chooser step. Disabled or unentitled
 * memberships remain visible so the account owner can understand the access
 * state; issue_manager_pwa_session remains the final server-side gate.
 */
/** @param {string} identifier @param {string} password */
export async function authenticateManager(identifier, password) {
  const email = identifier.trim().toLowerCase()

  try {
    await signInWithSupabaseAuth(email, password)
  } catch {
    throw new Error('Login failed. Please try again.')
  }

  let memberships
  try {
    memberships = await listManagerPwaMemberships()
  } catch {
    // Older databases may not have the split membership RPC yet.
    try {
      const legacy = await supabase.rpc('authenticate_manager_from_supabase', { p_lodge_id: null })
      if (legacy.error) throw legacy.error
      memberships = extractManagerCandidates(legacy.data, email)
    } catch {
      throw new Error('Login failed. Please try again.')
    }
  }

  const available = assertMembershipsAvailable(memberships)

  if (available.length > 1) {
    return { memberships: available, user: null }
  }

  const only = available[0]
  try {
    const issued = await issueManagerPwaSession(only.lodge_id)
    return { ...issued, memberships: available }
  } catch (issueError) {
    // Compatibility: older issue path via authenticate_manager_from_supabase(lodge_id).
    if (/** @type {{code?: unknown} | null | undefined} */ (issueError)?.code === 'pwa_plan_required' || only.pwa_enabled !== true) throw issueError
    const legacy = await supabase.rpc('authenticate_manager_from_supabase', {
      p_lodge_id: only.lodge_id
    })
    if (legacy.error) {
      throw errorWithMessage(friendlyErrorMessage(legacy.error, 'Could not open a manager session.'))
    }
    const rows = extractManagerCandidates(legacy.data, email)
    const selected = rows.find((row) => row.lodge_id === only.lodge_id && row.authenticated === true && row.session_token)
    if (!selected?.session_token) {
      throw new Error('The server did not issue a valid mobile app session.')
    }
    if (!isManagerPwaMembershipSelectable(selected)) {
      const reason = getManagerPwaMembershipBlockReason(selected)
      const accessError = errorWithMessage(reason)
      if (selected.pwa_enabled === true && selected.pwa_feature_enabled !== true) {
        /** @type {Error & {code: string}} */ (accessError).code = 'pwa_plan_required'
      }
      throw accessError
    }
    return { user: selected, memberships: available }
  }
}

/** @param {string | null} [sessionToken] */
export async function validateManagerSession(sessionToken = null) {
  const { data, error } = await supabase.rpc('validate_app_session', {
    p_session_token: sessionToken
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not validate this mobile session.'))

  const rows = extractManagerCandidates(data)
  const row = rows[0] || null
  if (!row || row.session_type !== 'pwa') return null
  return {
    ...row,
    session_token: sessionToken || row.session_token || null
  }
}

/** @param {string | null} [sessionToken] */
export async function refreshManagerSession(sessionToken = null) {
  const { data, error } = await supabase.rpc('refresh_pwa_app_session', {
    p_session_token: sessionToken
  })
  if (error) {
    if (/could not find the function|schema cache|refresh_pwa_app_session/i.test(error.message || '')) {
      return null
    }
    throw errorWithMessage(friendlyErrorMessage(error, 'Could not refresh this mobile session.'))
  }

  const rows = extractManagerCandidates(data)
  const row = rows[0] || null
  if (!row || row.session_type !== 'pwa') return null
  return {
    ...row,
    session_token: row.session_token || sessionToken || null
  }
}

/** @param {string | null} [sessionToken] */
export async function logoutManagerSession(sessionToken = null) {
  const { data, error } = await supabase.rpc('revoke_app_session', {
    p_session_token: sessionToken
  })
  if (error) throw errorWithMessage(friendlyErrorMessage(error, 'Could not sign out this mobile session.'))
  if (data && data.success === false) throw new Error('The mobile session could not be revoked.')
  return data
}
