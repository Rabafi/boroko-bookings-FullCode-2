// @ts-check
const MAX_ACTIVITY_ROWS = 40

/** @typedef {{id: string, type: unknown, title: unknown, sub: unknown, amount: unknown, created_at: unknown, source: unknown}} ActivityItem */
/** @typedef {{key: string, label: string, value: number | null, format: 'money' | 'number' | 'percent', trend?: number | null, tone: string}} PerformanceMetric */

/** @param {unknown} value @returns {number} */
function numeric(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) return undefined
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readDirectField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} row @returns {unknown} */
function dateValue(row) {
  return readField(row, 'created_at') || readField(row, 'updated_at') || readField(row, 'completed_at') || (readField(row, 'date') ? String(readField(row, 'date')) + 'T12:00:00' : null)
}

/** @param {unknown} value @param {string} [fallback] @returns {string} */
function displayType(value, fallback = 'Activity') {
  return String(value || fallback)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** @param {string} prefix @param {unknown} row @param {number} index @returns {string} */
function compactId(prefix, row, index) {
  return prefix + ':' + (readField(row, 'id') || readField(row, 'receipt_number') || dateValue(row) || index)
}

/** @param {unknown} row @param {string} prefix @param {number} index @param {Record<string, unknown>} [overrides] @returns {ActivityItem | null} */
function toActivity(row, prefix, index, overrides = {}) {
  const createdAt = dateValue(row)
  if (!createdAt) return null
  return {
    id: compactId(prefix, row, index),
    type: overrides.type || prefix,
    title: overrides.title || displayType(readField(row, 'event_type') || readField(row, 'action') || prefix),
    sub: overrides.sub || '',
    amount: Object.prototype.hasOwnProperty.call(overrides, 'amount') ? overrides.amount : null,
    created_at: createdAt,
    source: overrides.source || prefix
  }
}

/**
 * Builds one chronological, tenant-scoped activity list from existing
 * server-backed reads. Amounts only come from authoritative financial
 * audit/POS/expense rows; operational events intentionally carry null amounts.
 * @param {{activity?: unknown, bookings?: unknown, expenses?: unknown, inventory?: unknown, maintenance?: unknown, quotations?: unknown, conference?: unknown, dayUse?: unknown, posTransactions?: unknown}} [input]
 * @param {number} [limit]
 * @returns {ActivityItem[]}
 */
export function mergePerformanceActivity({
  activity = [],
  bookings = [],
  expenses = [],
  inventory = [],
  maintenance = [],
  quotations = [],
  conference = [],
  dayUse = [],
  posTransactions = []
} = {}, limit = 24) {
  const rows = [
    ...(Array.isArray(activity) ? /** @type {unknown[]} */ (activity) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'activity', index, {
        title: readDirectField(rawRow, 'title') || displayType(readDirectField(rawRow, 'type') || 'activity'),
        sub: readDirectField(rawRow, 'sub') || '',
        amount: Object.prototype.hasOwnProperty.call(rawRow, 'amount') ? readDirectField(rawRow, 'amount') : null,
        source: readDirectField(rawRow, 'source') || 'server_activity'
      })
    }),
    ...(Array.isArray(posTransactions) ? /** @type {unknown[]} */ (posTransactions) : []).map((rawRow, index) => {
      const isReturn = String(readDirectField(rawRow, 'transaction_type') || '').toLowerCase() === 'return' || numeric(readDirectField(rawRow, 'total')) < 0
      return toActivity(rawRow, 'pos', index, {
        type: isReturn ? 'pos_return' : 'pos_sale',
        title: isReturn ? 'POS return' : 'POS sale',
        sub: [readDirectField(rawRow, 'receipt_number'), readDirectField(rawRow, 'outlet_name'), readDirectField(rawRow, 'cashier_name')].filter(Boolean).join(' • ') || 'Posted transaction',
        amount: numeric(readDirectField(rawRow, 'total')),
        source: 'pos_transactions'
      })
    }),
    ...(Array.isArray(bookings) ? /** @type {unknown[]} */ (bookings) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'booking', index, {
      type: 'booking',
      title: 'Booking activity',
      sub: [readDirectField(rawRow, 'guest_name') || readDirectField(rawRow, 'customer_name') || 'Guest', readDirectField(rawRow, 'room_number') ? 'Room ' + readDirectField(rawRow, 'room_number') : null, displayType(readDirectField(rawRow, 'status') || 'updated')].filter(Boolean).join(' • '),
      source: 'bookings'
      })
    }),
    ...(Array.isArray(expenses) ? /** @type {unknown[]} */ (expenses) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'expense', index, {
      type: 'expense',
      title: 'Expense recorded',
      sub: [readDirectField(rawRow, 'category'), readDirectField(rawRow, 'description')].filter(Boolean).join(' • ') || 'Operating expense',
      amount: -Math.abs(numeric(readDirectField(rawRow, 'amount'))),
      source: 'expenses'
      })
    }),
    ...(Array.isArray(inventory) ? /** @type {unknown[]} */ (inventory) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'inventory', index, {
      type: 'inventory',
      title: readDirectField(rawRow, 'name') || readDirectField(rawRow, 'item_name') || 'Inventory updated',
      sub: 'Stock ' + (readDirectField(rawRow, 'current_stock') ?? readDirectField(rawRow, 'quantity') ?? '—') + (readDirectField(rawRow, 'reorder_level') ? ' • reorder at ' + readDirectField(rawRow, 'reorder_level') : ''),
      source: 'inventory'
      })
    }),
    ...(Array.isArray(maintenance) ? /** @type {unknown[]} */ (maintenance) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'maintenance', index, {
      type: 'maintenance',
      title: readDirectField(rawRow, 'title') || 'Maintenance ticket',
      sub: [displayType(readDirectField(rawRow, 'priority') || 'normal'), displayType(readDirectField(rawRow, 'status') || 'open')].join(' • '),
      source: 'maintenance'
      })
    }),
    ...(Array.isArray(quotations) ? /** @type {unknown[]} */ (quotations) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'quotation', index, {
      type: 'quotation',
      title: 'Quotation activity',
      sub: [readDirectField(rawRow, 'quotation_number') || 'Quotation', displayType(readDirectField(rawRow, 'status') || 'updated')].join(' • '),
      source: 'quotations'
      })
    }),
    ...(Array.isArray(conference) ? /** @type {unknown[]} */ (conference) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'conference', index, {
      type: 'conference',
      title: 'Conference / venue activity',
      sub: [readDirectField(rawRow, 'event_name') || readDirectField(rawRow, 'name') || 'Venue booking', readDirectField(rawRow, 'status') ? displayType(readDirectField(rawRow, 'status')) : null].filter(Boolean).join(' • '),
      source: 'conference'
      })
    }),
    ...(Array.isArray(dayUse) ? /** @type {unknown[]} */ (dayUse) : []).map((rawRow, index) => {
      return toActivity(rawRow, 'day_use', index, {
      type: 'day_use',
      title: 'Day-use activity',
      sub: [readDirectField(rawRow, 'guest_name') || readDirectField(rawRow, 'customer_name') || 'Day-use guest', readDirectField(rawRow, 'status') ? displayType(readDirectField(rawRow, 'status')) : null].filter(Boolean).join(' • '),
      source: 'day_use'
      })
    })
  ].filter((row) => row !== null)
  const validRows = rows

  const unique = new Map()
  validRows.forEach((row) => {
    if (!unique.has(row.id)) unique.set(row.id, row)
  })
  return [...unique.values()]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, Math.min(Math.max(Number(limit) || 24, 1), MAX_ACTIVITY_ROWS))
}

/** @param {unknown} current @param {unknown} previous @returns {number | null} */
export function calculateTrend(current, previous) {
  const currentValue = numeric(current)
  const previousValue = numeric(previous)
  if (previousValue === 0) return currentValue === 0 ? 0 : null
  return Math.round(((currentValue - previousValue) / Math.abs(previousValue)) * 100)
}

/** @param {{restaurantMode?: unknown, reports?: unknown, dashboard?: unknown, pos?: unknown, bookings?: unknown, inventory?: unknown, maintenance?: unknown, staff?: unknown}} [input] @returns {PerformanceMetric[]} */
export function buildPerformanceMetrics({ restaurantMode = false, reports = {}, dashboard = {}, pos = {}, bookings = [], inventory = [], maintenance = [], staff = [] } = {}) {
  const lowStock = (Array.isArray(inventory) ? /** @type {unknown[]} */ (inventory) : []).filter((rawItem) => {
    const reorder = numeric(readDirectField(rawItem, 'reorder_level'))
    return reorder > 0 && numeric(readDirectField(rawItem, 'current_stock') ?? readDirectField(rawItem, 'quantity')) <= reorder
  }).length
  const activeStaff = (Array.isArray(staff) ? /** @type {unknown[]} */ (staff) : []).filter((rawMember) => {
    const lastActivity = readDirectField(rawMember, 'last_activity_at') || readDirectField(rawMember, 'last_sign_in_at')
    // Keep the original Date constructor coercion at this untrusted API boundary.
    return lastActivity && Date.now() - Reflect.construct(Date, [lastActivity]).getTime() <= 24 * 60 * 60 * 1000
  }).length

  if (restaurantMode) {
    const posComplete = readField(pos, 'complete') === true
    const sales = posComplete ? numeric(readDirectField(pos, 'net_sales')) : null
    return [
      { key: 'sales', label: 'Net sales', value: sales, format: 'money', trend: null, tone: 'green' },
      { key: 'orders', label: 'Completed orders', value: posComplete ? numeric(readDirectField(pos, 'sale_count')) : null, format: 'number', tone: 'blue' },
      { key: 'averageSale', label: 'Average sale', value: posComplete ? numeric(readDirectField(pos, 'average_sale')) : null, format: 'money', tone: 'cyan' },
      { key: 'returns', label: 'Returns', value: posComplete ? numeric(readDirectField(pos, 'returns_total')) : null, format: 'money', tone: 'rose' },
      { key: 'openChecks', label: 'Open checks / tabs', value: numeric(readDirectField(pos, 'open_count')), format: 'number', tone: 'amber' },
      { key: 'lowStock', label: 'Low stock items', value: lowStock, format: 'number', tone: lowStock > 0 ? 'amber' : 'green' },
      { key: 'activeStaff', label: 'Active staff (24h)', value: activeStaff, format: 'number', tone: 'blue' }
    ]
  }

  const occupancy = numeric(readDirectField(reports, 'monthOcc') ?? readDirectField(dashboard, 'occupancyPercent'))
  return [
    { key: 'occupancy', label: 'Occupancy', value: occupancy, format: 'percent', trend: calculateTrend(occupancy, readDirectField(reports, 'lastMonthOcc')), tone: occupancy >= 70 ? 'green' : occupancy >= 40 ? 'amber' : 'rose' },
    { key: 'revenue', label: 'Cash collected', value: numeric(readDirectField(reports, 'monthRev') ?? readDirectField(dashboard, 'monthRevenue')), format: 'money', trend: calculateTrend(readDirectField(reports, 'monthRev'), readDirectField(reports, 'lastMonthRev')), tone: 'green' },
    { key: 'arrivals', label: 'Arrivals', value: (Array.isArray(bookings) ? /** @type {unknown[]} */ (bookings) : []).filter((rawBooking) => readDirectField(rawBooking, 'check_in') === readDirectField(reports, 'today')).length, format: 'number', tone: 'blue' },
    { key: 'departures', label: 'Departures', value: (Array.isArray(bookings) ? /** @type {unknown[]} */ (bookings) : []).filter((rawBooking) => readDirectField(rawBooking, 'check_out') === readDirectField(reports, 'today')).length, format: 'number', tone: 'blue' },
    { key: 'outstanding', label: 'Outstanding', value: numeric(readDirectField(reports, 'unpaidTotal') ?? readDirectField(dashboard, 'outstandingTotal')), format: 'money', tone: 'amber' },
    { key: 'maintenance', label: 'Open maintenance', value: (Array.isArray(maintenance) ? /** @type {unknown[]} */ (maintenance) : []).filter((rawTicket) => readDirectField(rawTicket, 'status') !== 'resolved').length, format: 'number', tone: 'amber' },
    { key: 'lowStock', label: 'Low stock items', value: lowStock, format: 'number', tone: lowStock > 0 ? 'amber' : 'green' },
    { key: 'activeStaff', label: 'Active staff (24h)', value: activeStaff, format: 'number', tone: 'blue' }
  ]
}

/** @param {unknown} value @param {string} [format] @returns {string} */
export function formatPerformanceValue(value, format = 'number') {
  if (value === null || value === undefined) return 'Unavailable'
  const amount = numeric(value)
  if (format === 'money') return 'P ' + amount.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (format === 'percent') return Math.round(amount) + '%'
  return Math.round(amount).toLocaleString('en-BW')
}

