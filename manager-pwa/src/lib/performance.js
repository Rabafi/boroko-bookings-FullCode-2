const MAX_ACTIVITY_ROWS = 40

function numeric(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function dateValue(row) {
  return row?.created_at || row?.updated_at || row?.completed_at || (row?.date ? String(row.date) + 'T12:00:00' : null)
}

function displayType(value, fallback = 'Activity') {
  return String(value || fallback)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactId(prefix, row, index) {
  return prefix + ':' + (row?.id || row?.receipt_number || dateValue(row) || index)
}

function toActivity(row, prefix, index, overrides = {}) {
  const createdAt = dateValue(row)
  if (!createdAt) return null
  return {
    id: compactId(prefix, row, index),
    type: overrides.type || prefix,
    title: overrides.title || displayType(row?.event_type || row?.action || prefix),
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
    ...(Array.isArray(activity) ? activity : []).map((row, index) => toActivity(row, 'activity', index, {
      title: row.title || displayType(row.type || 'activity'),
      sub: row.sub || '',
      amount: Object.prototype.hasOwnProperty.call(row, 'amount') ? row.amount : null,
      source: row.source || 'server_activity'
    })),
    ...(Array.isArray(posTransactions) ? posTransactions : []).map((row, index) => {
      const isReturn = String(row.transaction_type || '').toLowerCase() === 'return' || numeric(row.total) < 0
      return toActivity(row, 'pos', index, {
        type: isReturn ? 'pos_return' : 'pos_sale',
        title: isReturn ? 'POS return' : 'POS sale',
        sub: [row.receipt_number, row.outlet_name, row.cashier_name].filter(Boolean).join(' • ') || 'Posted transaction',
        amount: numeric(row.total),
        source: 'pos_transactions'
      })
    }),
    ...(Array.isArray(bookings) ? bookings : []).map((row, index) => toActivity(row, 'booking', index, {
      type: 'booking',
      title: 'Booking activity',
      sub: [row.guest_name || row.customer_name || 'Guest', row.room_number ? 'Room ' + row.room_number : null, displayType(row.status || 'updated')].filter(Boolean).join(' • '),
      source: 'bookings'
    })),
    ...(Array.isArray(expenses) ? expenses : []).map((row, index) => toActivity(row, 'expense', index, {
      type: 'expense',
      title: 'Expense recorded',
      sub: [row.category, row.description].filter(Boolean).join(' • ') || 'Operating expense',
      amount: -Math.abs(numeric(row.amount)),
      source: 'expenses'
    })),
    ...(Array.isArray(inventory) ? inventory : []).map((row, index) => toActivity(row, 'inventory', index, {
      type: 'inventory',
      title: row.name || row.item_name || 'Inventory updated',
      sub: 'Stock ' + (row.current_stock ?? row.quantity ?? '—') + (row.reorder_level ? ' • reorder at ' + row.reorder_level : ''),
      source: 'inventory'
    })),
    ...(Array.isArray(maintenance) ? maintenance : []).map((row, index) => toActivity(row, 'maintenance', index, {
      type: 'maintenance',
      title: row.title || 'Maintenance ticket',
      sub: [displayType(row.priority || 'normal'), displayType(row.status || 'open')].join(' • '),
      source: 'maintenance'
    })),
    ...(Array.isArray(quotations) ? quotations : []).map((row, index) => toActivity(row, 'quotation', index, {
      type: 'quotation',
      title: 'Quotation activity',
      sub: [row.quotation_number || 'Quotation', displayType(row.status || 'updated')].join(' • '),
      source: 'quotations'
    })),
    ...(Array.isArray(conference) ? conference : []).map((row, index) => toActivity(row, 'conference', index, {
      type: 'conference',
      title: 'Conference / venue activity',
      sub: [row.event_name || row.name || 'Venue booking', row.status ? displayType(row.status) : null].filter(Boolean).join(' • '),
      source: 'conference'
    })),
    ...(Array.isArray(dayUse) ? dayUse : []).map((row, index) => toActivity(row, 'day_use', index, {
      type: 'day_use',
      title: 'Day-use activity',
      sub: [row.guest_name || row.customer_name || 'Day-use guest', row.status ? displayType(row.status) : null].filter(Boolean).join(' • '),
      source: 'day_use'
    }))
  ].filter(Boolean)

  const unique = new Map()
  rows.forEach((row) => {
    if (!unique.has(row.id)) unique.set(row.id, row)
  })
  return [...unique.values()]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, Math.min(Math.max(Number(limit) || 24, 1), MAX_ACTIVITY_ROWS))
}

export function calculateTrend(current, previous) {
  const currentValue = numeric(current)
  const previousValue = numeric(previous)
  if (previousValue === 0) return currentValue === 0 ? 0 : null
  return Math.round(((currentValue - previousValue) / Math.abs(previousValue)) * 100)
}

export function buildPerformanceMetrics({ restaurantMode = false, reports = {}, dashboard = {}, pos = {}, bookings = [], inventory = [], maintenance = [], staff = [] } = {}) {
  const lowStock = (Array.isArray(inventory) ? inventory : []).filter((item) => {
    const reorder = numeric(item.reorder_level)
    return reorder > 0 && numeric(item.current_stock ?? item.quantity) <= reorder
  }).length
  const activeStaff = (Array.isArray(staff) ? staff : []).filter((member) => {
    const lastActivity = member.last_activity_at || member.last_sign_in_at
    return lastActivity && Date.now() - new Date(lastActivity).getTime() <= 24 * 60 * 60 * 1000
  }).length

  if (restaurantMode) {
    const posComplete = pos?.complete === true
    const sales = posComplete ? numeric(pos.net_sales) : null
    return [
      { key: 'sales', label: 'Net sales', value: sales, format: 'money', trend: null, tone: 'green' },
      { key: 'orders', label: 'Completed orders', value: posComplete ? numeric(pos.sale_count) : null, format: 'number', tone: 'blue' },
      { key: 'averageSale', label: 'Average sale', value: posComplete ? numeric(pos.average_sale) : null, format: 'money', tone: 'cyan' },
      { key: 'returns', label: 'Returns', value: posComplete ? numeric(pos.returns_total) : null, format: 'money', tone: 'rose' },
      { key: 'openChecks', label: 'Open checks / tabs', value: numeric(pos.open_count), format: 'number', tone: 'amber' },
      { key: 'lowStock', label: 'Low stock items', value: lowStock, format: 'number', tone: lowStock > 0 ? 'amber' : 'green' },
      { key: 'activeStaff', label: 'Active staff (24h)', value: activeStaff, format: 'number', tone: 'blue' }
    ]
  }

  const occupancy = numeric(reports.monthOcc ?? dashboard.occupancyPercent)
  return [
    { key: 'occupancy', label: 'Occupancy', value: occupancy, format: 'percent', trend: calculateTrend(occupancy, reports.lastMonthOcc), tone: occupancy >= 70 ? 'green' : occupancy >= 40 ? 'amber' : 'rose' },
    { key: 'revenue', label: 'Cash collected', value: numeric(reports.monthRev ?? dashboard.monthRevenue), format: 'money', trend: calculateTrend(reports.monthRev, reports.lastMonthRev), tone: 'green' },
    { key: 'arrivals', label: 'Arrivals', value: (Array.isArray(bookings) ? bookings : []).filter((booking) => booking.check_in === reports.today).length, format: 'number', tone: 'blue' },
    { key: 'departures', label: 'Departures', value: (Array.isArray(bookings) ? bookings : []).filter((booking) => booking.check_out === reports.today).length, format: 'number', tone: 'blue' },
    { key: 'outstanding', label: 'Outstanding', value: numeric(reports.unpaidTotal ?? dashboard.outstandingTotal), format: 'money', tone: 'amber' },
    { key: 'maintenance', label: 'Open maintenance', value: (Array.isArray(maintenance) ? maintenance : []).filter((ticket) => ticket.status !== 'resolved').length, format: 'number', tone: 'amber' },
    { key: 'lowStock', label: 'Low stock items', value: lowStock, format: 'number', tone: lowStock > 0 ? 'amber' : 'green' },
    { key: 'activeStaff', label: 'Active staff (24h)', value: activeStaff, format: 'number', tone: 'blue' }
  ]
}

export function formatPerformanceValue(value, format = 'number') {
  if (value === null || value === undefined) return 'Unavailable'
  const amount = numeric(value)
  if (format === 'money') return 'P ' + amount.toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (format === 'percent') return Math.round(amount) + '%'
  return Math.round(amount).toLocaleString('en-BW')
}

