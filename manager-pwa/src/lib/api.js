import { signInWithSupabaseAuth, supabase } from './supabase'
import { assertCapability, getStoredEntitlement, normalizeSessionUser, storeEntitlement } from './access'
import { getSubscriptionPlan } from '@shared/subscriptionPlans'
import { titleCase } from './format'
import {
  appendIssueLog,
  createQueuedOperation,
  enqueueOfflineOperation,
  getOfflineQueue,
  readIssueLog,
  getRuntimeMeta,
  mutateCachedList,
  queryWithCache,
  setOfflineQueue,
  setRuntimeMeta,
  writeCacheEntry
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

const PWA_PLAN_REQUIRED_MESSAGE = `Manager mobile app access is available on the ${getSubscriptionPlan('Pro').name} plan for this lodge because ${getSubscriptionPlan('Pro').pitch.toLowerCase()}. Ask Command Central to upgrade or enable an override.`
export const FRONT_DESK_ONLY_MESSAGE = 'This action is only available in the Front Desk system.'
const READ_ONLY_MANAGER_MESSAGE = 'This screen is view only in the manager mobile app. Use the front desk for changes.'
const MAX_FINANCIAL_AMOUNT = 1000000
const queueFlushLocks = new Map()

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

function guestName(record) {
  return record?.guest_name || record?.customer_name || record?.name || 'Guest'
}

function ensureSuccess(result, error, fallbackMessage) {
  if (error) throw new Error(error.message || fallbackMessage)
  if (result?.success === false) throw new Error(result.error || fallbackMessage)
  return result
}

function addDays(base, days) {
  const value = new Date(base)
  value.setDate(value.getDate() + days)
  return value
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function rejectFrontDeskOnlyAction() {
  throw new Error(FRONT_DESK_ONLY_MESSAGE)
}

function upsertById(list, record) {
  const index = list.findIndex((entry) => entry.id === record.id)
  if (index === -1) return [record, ...list]
  list[index] = { ...list[index], ...record }
  return list
}

function removeById(list, id) {
  return list.filter((entry) => entry.id !== id)
}

function computePaymentStatus(totalAmount, amountPaid) {
  const total = Number(totalAmount || 0)
  const paid = Number(amountPaid || 0)
  if (paid <= 0) return 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

function normalizeMoney(value, fieldLabel, { max = MAX_FINANCIAL_AMOUNT, allowBlank = false } = {}) {
  if (allowBlank && (value === '' || value === null || value === undefined)) return 0
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error(`${fieldLabel} must be a valid amount.`)
  if (amount < 0) throw new Error(`${fieldLabel} cannot be negative.`)
  if (amount > max) throw new Error(`${fieldLabel} is too large. Please review the value.`)
  return Math.round(amount * 100) / 100
}

async function safeSelect(queryBuilder, fallback = []) {
  const { data, error } = await queryBuilder
  if (error) throw new Error(error.message)
  return data || fallback
}

function getErrorMessage(error, fallback = 'Unexpected issue') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error?.message === 'string' && error.message) return error.message
  return fallback
}

function describeReadError(scope, error, fallbackMessage = '') {
  const message = getErrorMessage(error, fallbackMessage || `Could not load ${scope.toLowerCase()}.`)
  if (/access denied|permission denied|not authorized|not allowed/i.test(message)) {
    return `${scope} is not available for this account.`
  }
  if (/network|failed to fetch|fetch failed|offline|timeout|timed out/i.test(message)) {
    return `${scope} could not reach the server. Check the connection and try again.`
  }
  if (/schema cache|function .* does not exist|could not find the function|pgrst/i.test(message)) {
    return `${scope} is not ready on this lodge yet. Apply the latest database migrations and try again.`
  }
  if (/session|expired|jwt/i.test(message)) {
    return `${scope} could not load because the session expired. Please sign in again.`
  }
  return message || fallbackMessage || `Could not load ${scope.toLowerCase()}.`
}

function describeMutationError(scope, error, fallbackMessage = '') {
  const message = getErrorMessage(error, fallbackMessage || `Could not save ${scope.toLowerCase()}.`)
  if (/access denied|permission denied|not authorized|not allowed/i.test(message)) {
    return `You do not have permission to save ${scope.toLowerCase()}.`
  }
  if (/network|failed to fetch|fetch failed|offline|timeout|timed out/i.test(message)) {
    return `Could not reach the server while saving ${scope.toLowerCase()}. Check your connection and try again.`
  }
  if (/schema cache|function .* does not exist|could not find the function|pgrst/i.test(message)) {
    return `${scope} is not ready on this lodge yet. Apply the latest database migrations and try again.`
  }
  if (/session|expired|jwt/i.test(message)) {
    return `Could not save ${scope.toLowerCase()} because the session expired. Please sign in again.`
  }
  return message || fallbackMessage || `Could not save ${scope.toLowerCase()}.`
}

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

async function readRpcJson(rpcName, params, fallbackMessage) {
  const { data, error } = await supabase.rpc(rpcName, params)
  if (error) throw new Error(error.message || fallbackMessage)
  return data
}

async function buildDashboardSnapshotLegacy(lodgeId, today = formatDate(new Date())) {
  const monthStart = today.slice(0, 7) + '-01'
  const todayDate = new Date(`${today}T00:00:00`)
  const monthEnd = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0))
  const monthEndExclusive = formatDate(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1))
  const nextWeek = formatDate(addDays(today, 7))
  const previousWeek = Array.from({ length: 7 }, (_, index) => formatDate(addDays(today, index - 6)))

  const [rooms, bookings, payments, expenses, maintenance, inventory, quotations, conference, dayUse] = await Promise.all([
    safeSelect(supabase.from('rooms').select('*').eq('lodge_id', lodgeId).order('room_number')),
    safeSelect(supabase.from('bookings').select('*').eq('lodge_id', lodgeId).order('check_in', { ascending: false })),
    safeSelect(supabase.from('payments').select('amount, paid_at').eq('lodge_id', lodgeId).gte('paid_at', monthStart).lt('paid_at', monthEndExclusive), []),
    safeSelect(supabase.from('expenses').select('id, amount, date, category, description').eq('lodge_id', lodgeId).gte('date', monthStart)),
    safeSelect(supabase.from('maintenance_tickets').select('*').eq('lodge_id', lodgeId).order('created_at', { ascending: false })),
    safeSelect(supabase.from('inventory_items').select('*').eq('lodge_id', lodgeId).order('name')),
    safeSelect(supabase.from('quotations').select('*').eq('lodge_id', lodgeId).order('created_at', { ascending: false })),
    safeSelect(supabase.from('conference_bookings').select('*').eq('lodge_id', lodgeId).gte('booking_date', today).lte('booking_date', nextWeek).order('booking_date')),
    safeSelect(supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId).gte('date', monthStart))
  ])

  const occupied = bookings.filter((booking) => booking.status === 'checked_in').length
  const openMaintenance = maintenance.filter((ticket) => ticket.status === 'open')
  const lowStock = inventory.filter((item) => Number(item.reorder_level || 0) > 0 && Number(item.current_stock ?? item.quantity ?? 0) <= Number(item.reorder_level || 0))
  const unpaidBookings = bookings.filter((booking) => !['cancelled', 'checked_out'].includes(booking.status) && ['partial', 'unpaid'].includes(String(booking.payment_status || '').toLowerCase()))
  const outstandingTotal = unpaidBookings.reduce((sum, booking) => {
    const total = Number(booking.total_amount || 0) + Number(booking.charges_total || 0)
    const paid = Number(booking.amount_paid || 0)
    return sum + Math.max(0, total - paid)
  }, 0)
  const upcomingArrivals = bookings
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
    return paidAt >= monthStart && paidAt < monthEndExclusive
  })
  const monthGrossCollected = monthPayments
    .filter((payment) => Number(payment.amount || 0) > 0)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const monthRefunds = monthPayments
    .filter((payment) => Number(payment.amount || 0) < 0)
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0)
  const monthRevenue = monthGrossCollected - monthRefunds
  const maintenanceCosts = maintenanceCostsForRange(maintenance, monthStart, monthEnd)

  const revenueTrend = previousWeek.map((day) => {
    const amount = payments
      .filter((payment) => String(payment.paid_at || '').slice(0, 10) === day)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    return { day, amount }
  })

  const occupancyTrend = previousWeek.map((day) => {
    const active = bookings.filter((booking) => booking.status !== 'cancelled' && booking.check_in <= day && booking.check_out > day).length
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
    quotationsOpenCount: quotations.filter((quotation) => ['draft', 'sent', 'accepted'].includes(quotation.status)).length,
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
      .slice(0, 5)
  }
}

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

  const [rooms, bookings, payments, expenses, posOrders, conferenceBookings, poolDayUse] = await Promise.all([
    safeSelect(supabase.from('rooms').select('id').eq('lodge_id', lodgeId), []),
    safeSelect(supabase.from('bookings').select('id, check_in, check_out, total_amount, charges_total, amount_paid, payment_status, status').eq('lodge_id', lodgeId), []),
    safeSelect(supabase.from('payments').select('booking_id, amount, paid_at, type').eq('lodge_id', lodgeId).gte('paid_at', reportCashStart).lte('paid_at', reportCashEnd), []),
    safeSelect(supabase.from('expenses').select('amount, date').eq('lodge_id', lodgeId).gte('date', monthStart).lte('date', monthEnd), []),
    safeSelect(supabase.from('pos_orders').select('total, created_at').eq('lodge_id', lodgeId).gte('created_at', monthStart).neq('status', 'voided'), []),
    safeSelect(supabase.from('conference_bookings').select('total_amount, payment_status').eq('lodge_id', lodgeId).gte('booking_date', monthStart).lte('booking_date', monthEnd).neq('payment_status', 'cancelled'), []),
    safeSelect(supabase.from('pool_day_use').select('total').eq('lodge_id', lodgeId).gte('date', monthStart).lte('date', monthEnd), [])
  ])

  const totalRooms = rooms.length
  const revForPeriod = (start, end) => payments
    .filter((payment) => {
      const paidAt = String(payment.paid_at || '').slice(0, 10)
      return paidAt >= start && paidAt <= end
    })
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)

  const refundsForPeriod = (start, end) => payments
    .filter((payment) => {
      const paidAt = String(payment.paid_at || '').slice(0, 10)
      return paidAt >= start && paidAt <= end && Number(payment.amount || 0) < 0
    })
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0)
  const cancelledBookingIds = new Set(
    bookings
      .filter((booking) => String(booking.status || '') === 'cancelled')
      .map((booking) => booking.id)
      .filter(Boolean)
  )
  const retainedForPeriod = (start, end) => {
    let retained = 0
    let count = 0
    const seenBookingIds = new Set()
    for (const payment of payments) {
      const paidAt = String(payment.paid_at || '').slice(0, 10)
      if (paidAt < start || paidAt > end) continue
      const amount = Number(payment.amount || 0)
      if (amount <= 0) continue
      if (String(payment.type || '').toLowerCase() === 'refund') continue
      if (!cancelledBookingIds.has(payment.booking_id)) continue
      retained += amount
      if (payment.booking_id && !seenBookingIds.has(payment.booking_id)) {
        seenBookingIds.add(payment.booking_id)
        count += 1
      }
    }
    return { retained, count }
  }
  const monthRetained = retainedForPeriod(monthStart, monthEnd)
  const lastMonthRetained = retainedForPeriod(lastMonthStart, lastMonthEnd)

  const occupancyForPeriod = (start, end) => {
    const occ = bookings.filter((booking) => booking.status === 'checked_in' && booking.check_in <= end && booking.check_out >= start).length
    const days = Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1
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
    posRevenue: posOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    conferenceRevenue: conferenceBookings.reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0),
    poolRevenue: poolDayUse.reduce((sum, entry) => sum + Number(entry.total || 0), 0)
  }
}

async function buildNightAuditLegacy(lodgeId, date) {
  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`
  const [bookings, posOrders, payments, expenses] = await Promise.all([
    listBookings(lodgeId, { forceFresh: true }),
    safeSelect(supabase.from('pos_orders').select('*, pos_order_items(*)').eq('lodge_id', lodgeId).eq('status', 'completed').gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }), []),
    safeSelect(supabase.from('payments').select('amount, paid_at, type').eq('lodge_id', lodgeId).gte('paid_at', dayStart).lte('paid_at', dayEnd), []),
    safeSelect(supabase.from('expenses').select('amount, date').eq('lodge_id', lodgeId).gte('date', date).lte('date', date), [])
  ])
  const checkIns = bookings
    .filter((booking) => booking.check_in === date && booking.status !== 'cancelled')
    .sort((left, right) => String(left.room_number || '').localeCompare(String(right.room_number || '')))
  const checkOuts = bookings
    .filter((booking) => booking.check_out === date && booking.status !== 'cancelled')
    .sort((left, right) => String(left.room_number || '').localeCompare(String(right.room_number || '')))
  const newBookings = bookings
    .filter((booking) => {
      const createdAt = String(booking.created_at || '')
      return createdAt >= dayStart && createdAt <= dayEnd
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
  const outstanding = bookings
    .filter((booking) => ['confirmed', 'checked_in'].includes(booking.status) && booking.payment_status !== 'paid')
    .sort((left, right) => String(left.check_in || '').localeCompare(String(right.check_in || '')))

  const grossCollected = payments
    .filter((payment) => Number(payment.amount || 0) > 0)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const refundsIssued = payments
    .filter((payment) => Number(payment.amount || 0) < 0 || String(payment.type || '').toLowerCase() === 'refund')
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0)
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

async function fetchSettingsRecord(lodgeId) {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('lodge_id', lodgeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

async function fetchEntitlementRpc(lodgeId) {
  const { data, error } = await supabase.rpc('get_lodge_entitlement', { p_lodge_id: lodgeId })
  if (error) throw error
  return data
}

async function fetchFeatureOverrides(lodgeId) {
  const rows = await safeSelect(
    supabase.from('lodge_features').select('feature_name, enabled').eq('lodge_id', lodgeId),
    []
  )
  return rows.reduce((acc, row) => {
    if (!row?.feature_name) return acc
    acc[row.feature_name] = row.enabled !== false
    return acc
  }, {})
}

async function executeCreateBooking(payload) {
  const { data, error } = await supabase.rpc('create_booking', payload)
  ensureSuccess(data, error, 'Could not create booking')
  return data
}

async function executeUpdateBookingStatus(payload) {
  const { data, error } = await supabase.rpc('update_booking_status', payload)
  ensureSuccess(data, error, 'Could not update booking status')
  return data
}

async function executeUpdateBookingPayment(payload) {
  const { data, error } = await supabase.rpc('update_booking_payment', payload)
  ensureSuccess(data, error, 'Could not record payment')
  return data
}

async function executeCreateCustomer(payload) {
  const { data, error } = await supabase.rpc('create_customer', { payload })
  ensureSuccess(data, error, 'Could not create customer')
  return data
}

async function executeSaveExpense(expense, mode) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_expense', { payload: expense })
    ensureSuccess(data, error, 'Could not create expense')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_expense', {
      p_id: expense.id,
      p_lodge_id: expense.lodge_id,
      payload: expense
    })
    ensureSuccess(data, error, 'Could not update expense')
    return data
  }
  const { data, error } = await supabase.rpc('delete_expense', {
    p_id: expense.id,
    p_lodge_id: expense.lodge_id
  })
  ensureSuccess(data, error, 'Could not delete expense')
  return data
}

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

async function executeMaintenance(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_maintenance_ticket', { payload })
    ensureSuccess(data, error, 'Could not create maintenance ticket')
    return data
  }
  const { data, error } = await supabase.rpc('resolve_maintenance_ticket', {
    p_id: String(payload.id),
    p_lodge_id: String(payload.lodge_id)
  })
  ensureSuccess(data, error, 'Could not resolve maintenance ticket')
  return data
}

async function executeHousekeeping(payload) {
  const { data, error } = await supabase.rpc('update_room_housekeeping', payload)
  ensureSuccess(data, error, 'Could not update housekeeping')
  return data
}

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

async function executeDayUse(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('add_pool_day_use', { payload })
    ensureSuccess(data, error, 'Could not create day-use entry')
    return data
  }
  const { data, error } = await supabase.rpc('delete_pool_day_use', {
    p_id: payload.id,
    p_lodge_id: payload.lodge_id
  })
  ensureSuccess(data, error, 'Could not delete day-use entry')
  return data
}

async function executeInventory(mode, payload) {
  if (mode === 'create') {
    const { data, error } = await supabase.rpc('create_inventory_item', { payload })
    ensureSuccess(data, error, 'Could not create inventory item')
    return data
  }
  if (mode === 'update') {
    const { data, error } = await supabase.rpc('update_inventory_item', {
      p_id: payload.id,
      p_lodge_id: payload.lodge_id,
      payload
    })
    ensureSuccess(data, error, 'Could not update inventory item')
    return data
  }
  if (mode === 'delete') {
    const { data, error } = await supabase.rpc('delete_inventory_item', {
      p_id: payload.id,
      p_lodge_id: payload.lodge_id
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
    p_id: payload.id,
    p_lodge_id: payload.lodge_id,
    p_delta: payload.delta,
    p_notes: payload.notes || ''
  })
  ensureSuccess(data, error, 'Could not adjust stock')
  return data
}

async function executeSupport(payload) {
  const { data, error } = await supabase.rpc('create_support_ticket', {
    payload: {
      lodge_id: payload.lodge_id,
      lodge_name: payload.lodge_name || null,
      title: payload.title,
      description: payload.description,
      category: payload.category || 'General',
      priority: payload.priority || 'Normal'
    }
  })
  ensureSuccess(data, error, 'Could not create support request')
  return data
}

async function queueOrRun({ lodgeId, type, label, payload, execute, optimistic }) {
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
    enqueueOfflineOperation(lodgeId, createQueuedOperation(type, label, payload))
    return { success: true, queued: true }
  }
  return execute()
}

async function getSettings(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'settings',
    fallback: null,
    fetcher: () => fetchSettingsRecord(lodgeId)
  })
}

export async function getEntitlement(lodgeId) {
  try {
    const entitlement = await fetchEntitlementRpc(lodgeId)
    if (entitlement) {
      storeEntitlement(lodgeId, entitlement)
      writeCacheEntry(lodgeId, 'entitlement', entitlement)
      return entitlement
    }
  } catch {
    // Fallback below.
  }

  const settings = await getSettings(lodgeId).catch(() => null)
  const features = await fetchFeatureOverrides(lodgeId).catch(() => ({}))
  const fallback = {
    success: true,
    status: 'active',
    expired: false,
    plan: 'Starter',
    lodge_id: lodgeId,
    lodge_name: settings?.lodge_name || settings?.company_name || 'Your Lodge',
    effective_features: {
      ...STARTER_FEATURE_FLAGS,
      ...features
    }
  }
  storeEntitlement(lodgeId, fallback)
  writeCacheEntry(lodgeId, 'entitlement', fallback)
  return fallback
}

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
          throw new Error(describeReadError('Dashboard', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

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
          throw new Error(describeReadError('Reports', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

export async function listRooms(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'rooms',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('rooms').select('*').eq('lodge_id', lodgeId).order('room_number'), [])
  })
}

export async function listBookings(lodgeId, options = {}) {
  return queryWithCache({
    lodgeId,
    key: 'bookings',
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: () => safeSelect(supabase.from('bookings').select('*').eq('lodge_id', lodgeId).order('check_in', { ascending: false }), [])
  })
}

async function listCustomers(lodgeId) {
  return queryWithCache({
    lodgeId,
    key: 'customers',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('customers').select('*').eq('lodge_id', lodgeId).order('name'), [])
  })
}

export async function getBookingPayments(lodgeId, bookingId) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_booking_payments', {
    p_booking_id: bookingId,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  return data || []
}

export async function listMaintenanceTickets(lodgeId, options = {}) {
  return queryWithCache({
    lodgeId,
    key: 'maintenance',
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: () => safeSelect(supabase.from('maintenance_tickets').select('*').eq('lodge_id', lodgeId).order('created_at', { ascending: false }), [])
  })
}

function maintenanceTicketDate(ticket = {}) {
  return String(ticket.reported_date || ticket.created_at || ticket.date || '').slice(0, 10)
}

function maintenanceCostsForRange(rows = [], startDate, endDate) {
  return (rows || [])
    .filter((row) => {
      const day = maintenanceTicketDate(row)
      return (!startDate || day >= startDate) && (!endDate || day <= endDate)
    })
    .reduce((sum, row) => sum + Number(row.total_cost || 0), 0)
}

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
      mutateCachedList(lodgeId, 'maintenance', (rows) => upsertById(rows, { ...ticket, queued_offline: true, created_at: new Date().toISOString() }))
    }
  })
}

export async function listQuotations(lodgeId) {
  assertCapability('quotations.view')
  return queryWithCache({
    lodgeId,
    key: 'quotations',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('quotations').select('*').eq('lodge_id', lodgeId).order('created_at', { ascending: false }), [])
  })
}

export async function listExpenses(lodgeId, start, end, options = {}) {
  assertCapability('expenses.view')
  return queryWithCache({
    lodgeId,
    key: `expenses:${start || 'all'}:${end || 'all'}`,
    fallback: [],
    forceFresh: options.forceFresh === true,
    fetcher: async () => {
      let query = supabase.from('expenses').select('*').eq('lodge_id', lodgeId)
      if (start) query = query.gte('date', start)
      if (end) query = query.lte('date', end)
      return safeSelect(query.order('date', { ascending: false }), [])
    }
  })
}

export async function listGuests(lodgeId) {
  assertCapability('guests.view')
  return listCustomers(lodgeId)
}

export async function getGuestHistory(lodgeId, customerId) {
  assertCapability('guests.view')
  return safeSelect(
    supabase.from('bookings').select('*').eq('lodge_id', lodgeId).eq('customer_id', customerId).order('check_in', { ascending: false }),
    []
  )
}

export async function listStaff(lodgeId) {
  assertCapability('staff.view')
  return queryWithCache({
    lodgeId,
    key: 'staff',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('users').select('id, name, email, role, status, created_at, lodge_id, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, invite_sent_at, password_updated_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, allowed_outlet_ids, capability_overrides').eq('lodge_id', lodgeId).order('name'), [])
  })
}

export async function listConferenceBookings(lodgeId, start, end) {
  assertCapability('conference.view')
  return queryWithCache({
    lodgeId,
    key: 'conference',
    fallback: [],
    fetcher: async () => {
      let query = supabase.from('conference_bookings').select('*').eq('lodge_id', lodgeId)
      if (start) query = query.gte('booking_date', start)
      if (end) query = query.lte('booking_date', end)
      return safeSelect(query.order('booking_date', { ascending: false }).order('start_time'), [])
    }
  })
}

export async function listDayUseEntries(lodgeId, start, end) {
  assertCapability('pool.view')
  return queryWithCache({
    lodgeId,
    key: 'dayuse',
    fallback: [],
    fetcher: async () => {
      let query = supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId)
      if (start) query = query.gte('date', start)
      if (end) query = query.lte('date', end)
      return safeSelect(query.order('date', { ascending: false }).order('created_at', { ascending: false }), [])
    }
  })
}

export async function listInventory(lodgeId) {
  assertCapability('inventory.view')
  return queryWithCache({
    lodgeId,
    key: 'inventory',
    fallback: [],
    fetcher: () => safeSelect(supabase.from('inventory_items').select('*').eq('lodge_id', lodgeId).order('name'), [])
  })
}

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
        if (error) throw new Error(error.message)
        return (data || [])
          .map((invoice) => ({
            ...invoice,
            invoice_id: invoice.invoice_id || null,
            booking_id: invoice.booking_id,
            invoice_number: invoice.invoice_number,
            issued_at: invoice.issued_at || null,
            due_date: invoice.due_date || invoice.check_in || null,
            invoice_notes: invoice.notes || '',
            customer_name: invoice.guest_name || 'Guest',
            status: invoice.booking_status,
            total_amount: Number(invoice.total_amount || 0),
            charges_total: Number(invoice.charges_total || 0),
            amount_paid: Number(invoice.amount_paid || 0),
            balance_due: Math.max(0, Number(invoice.balance_due || 0)),
            payment_count: Number(invoice.payment_count || 0),
            nights:
              invoice.check_in && invoice.check_out
                ? Math.max(0, Math.ceil((new Date(invoice.check_out) - new Date(invoice.check_in)) / 86400000))
                : 0
          }))
          .sort((left, right) =>
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
        return bookings
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
              nights: Math.max(0, Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000))
            }
          })
          .filter(Boolean)
          .sort((left, right) =>
            String(right.issued_at || right.created_at || '').localeCompare(String(left.issued_at || left.created_at || ''))
          )
      }
    }
  })
}

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
          throw new Error(describeReadError('Night audit', fallbackError, getErrorMessage(rpcError)))
        }
      }
    }
  })
}

export async function getRefundHistory(lodgeId, limit = 20) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_refund_approval_log', {
    p_lodge_id: lodgeId,
    p_booking_id: null,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

async function getInvoiceDeliveryHistory(lodgeId, limit = 20) {
  assertCapability('invoices.view')
  const { data, error } = await supabase.rpc('get_invoice_delivery_history', {
    p_lodge_id: lodgeId,
    p_booking_id: null,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

async function getFinancialValidationAlerts(lodgeId, limit = 10) {
  assertCapability('dashboard.view')
  try {
    const { data, error } = await supabase.rpc('get_financial_validation_alerts', {
      p_lodge_id: lodgeId,
      p_limit: Math.min(Math.max(Number(limit) || 10, 1), 50)
    })
    if (error) throw new Error(error.message)
    return Array.isArray(data) ? data : []
  } catch (error) {
    recordPwaIssue(lodgeId, 'validation-alerts.load', error, { source: 'validation-alerts', severity: 'warn' })
    throw new Error(describeReadError('Validation alerts', error, 'Could not load validation alerts.'))
  }
}

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
    safeSelect(supabase.from('bookings').select('id, guest_name, room_number, created_at, status, invoice_number').eq('lodge_id', lodgeId).order('created_at', { ascending: false }).limit(limit), [])
  ])

  const activity = [
    ...auditRows.map((row) => ({
      id: `audit:${row.id}`,
      type: row.action || 'financial_event',
      title: titleCase(String(row.action || 'financial event').replace(/_/g, ' ')),
      sub: row.booking_id ? `Booking ${row.booking_id.slice(0, 8)}` : 'Financial record',
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

export async function getSupportRequests(lodgeId, limit = 20) {
  const { data, error } = await supabase.rpc('get_lodge_support_tickets', {
    p_lodge_id: lodgeId,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

export async function createSupportTicket(lodgeId, payload) {
  return queueOrRun({
    lodgeId,
    type: 'support/create',
    label: 'Create support request',
    payload: { ...payload, lodge_id: lodgeId },
    execute: () => executeSupport({ ...payload, lodge_id: lodgeId }),
    optimistic: null
  })
}

export function getQueueStatus(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  return {
    count: queue.length,
    items: queue
  }
}

async function performOfflineQueueFlush(lodgeId) {
  if (isOfflineMode()) {
    return { processed: 0, remaining: getOfflineQueue(lodgeId).length }
  }

  const queue = [...getOfflineQueue(lodgeId)]
  const queuedIds = new Set(queue.map((item) => item.id))
  let processed = 0
  const remaining = []

  for (const item of queue) {
    try {
      if (BLOCKED_PWA_MUTATION_TYPES.has(item.type)) {
        remaining.push({
          ...item,
          blocked: true,
          lastError: FRONT_DESK_ONLY_MESSAGE,
          lastAttemptedAt: new Date().toISOString()
        })
        continue
      }
      switch (item.type) {
        case 'room/housekeeping':
          await executeHousekeeping(item.payload)
          break
        case 'maintenance/create':
          await executeMaintenance('create', item.payload)
          break
        case 'maintenance/resolve':
          await executeMaintenance('resolve', item.payload)
          break
        case 'expense/create':
          await executeSaveExpense(item.payload, 'create')
          break
        case 'expense/update':
          await executeSaveExpense(item.payload, 'update')
          break
        case 'expense/delete':
          await executeSaveExpense(item.payload, 'delete')
          break
        case 'dayuse/create':
          await executeDayUse('create', item.payload)
          break
        case 'dayuse/delete':
          await executeDayUse('delete', item.payload)
          break
        case 'inventory/create':
          await executeInventory('create', item.payload)
          break
        case 'inventory/update':
          await executeInventory('update', item.payload)
          break
        case 'inventory/delete':
          await executeInventory('delete', item.payload)
          break
        case 'inventory/purchase':
          await executeInventory('purchase', item.payload)
          break
        case 'inventory/adjust':
          await executeInventory('adjust', item.payload)
          break
        case 'support/create':
          await executeSupport(item.payload)
          break
        default:
          remaining.push(item)
          continue
      }
      processed += 1
    } catch (error) {
      remaining.push({ ...item, lastError: error.message, lastAttemptedAt: new Date().toISOString() })
    }
  }

  const latestQueue = getOfflineQueue(lodgeId)
  const enqueuedDuringFlush = latestQueue.filter((item) => !queuedIds.has(item.id))
  const nextQueue = [...remaining, ...enqueuedDuringFlush]

  setOfflineQueue(lodgeId, nextQueue)
  setRuntimeMeta(lodgeId, 'last-sync', { processed, remaining: nextQueue.length })

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

function normalizeManagerCandidate(row = {}, email = '') {
  const user = normalizeSessionUser({ ...row, email: row.email || email })
  return {
    ...user,
    authenticated: row.authenticated === true,
    pwa_enabled: row.pwa_enabled === true,
    pwa_password_set_at: row.pwa_password_set_at || null,
    pwa_disabled_reason: row.pwa_disabled_reason || '',
    pwa_feature_enabled: row.pwa_feature_enabled !== false,
    plan: row.pwa_plan || row.plan || 'Starter',
    session_token: typeof row.session_token === 'string' && row.session_token ? row.session_token : null,
    session_expires_at: row.session_expires_at || null,
    session_type: row.session_type || null
  }
}

function extractManagerCandidates(data, email = '') {
  const rows = []
  const pushRow = (value) => {
    if (value && typeof value === 'object') {
      rows.push(normalizeManagerCandidate(value, email))
    }
  }

  if (Array.isArray(data)) {
    data.forEach(pushRow)
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.lodges)) data.lodges.forEach(pushRow)
    if (Array.isArray(data.options)) data.options.forEach(pushRow)
    if (Array.isArray(data.users)) data.users.forEach(pushRow)
    if (data.user) pushRow(data.user)
    if (data.session) pushRow(data.session)
    if (data.lodge_id || data.role || data.name || data.id) pushRow(data)
  }

  return rows.filter((row) => row.lodge_id)
}

export async function authenticateManager(identifier, password, lodgeId = null) {
  const email = identifier.trim().toLowerCase()
  let data
  let error

  try {
    await signInWithSupabaseAuth(email, password)
    const result = await supabase.rpc('authenticate_manager_from_supabase', {
      p_lodge_id: lodgeId
    })
    data = result.data
    error = result.error

    if (error && /could not find the function|schema cache|authenticate_manager_from_supabase/i.test(error.message || '')) {
      const legacy = await supabase.rpc('authenticate_manager', {
        p_email: email,
        p_password: password,
        p_lodge_id: lodgeId
      })
      data = legacy.data
      error = legacy.error
    }
  } catch (authError) {
    const legacy = await supabase.rpc('authenticate_manager', {
      p_email: email,
      p_password: password,
      p_lodge_id: lodgeId
    })
    data = legacy.data
    error = legacy.error || authError
  }

  if (error) {
    throw new Error('Login failed. Please try again.')
  }

  const rows = extractManagerCandidates(data, email)
  if (rows.length === 0) {
    throw new Error('That email or mobile app password is incorrect.')
  }

  const authedRows = rows.filter((row) => row.authenticated === true)
  if (authedRows.length === 0) {
    throw new Error('That email or mobile app password is incorrect.')
  }

  const enabledRows = authedRows.filter((row) => row.pwa_enabled === true)
  if (enabledRows.length === 0) {
    throw new Error(authedRows[0]?.pwa_disabled_reason || 'Manager mobile app access is disabled for this account.')
  }

  const entitledRows = enabledRows.filter((row) => row.pwa_feature_enabled !== false)
  if (entitledRows.length === 0) {
    const planError = new Error(PWA_PLAN_REQUIRED_MESSAGE)
    planError.code = 'pwa_plan_required'
    throw planError
  }

  if (!lodgeId && entitledRows.length > 1) {
    return { lodges: entitledRows }
  }

  const selected = lodgeId
    ? entitledRows.find((row) => row.lodge_id === String(lodgeId).trim().toLowerCase())
    : entitledRows[0]

  if (!selected) {
    throw new Error('That lodge is no longer available for this account.')
  }
  if (!selected.session_token) {
    throw new Error('The server did not issue a valid mobile app session.')
  }

  return { user: selected }
}

export async function validateManagerSession(sessionToken = null) {
  const { data, error } = await supabase.rpc('validate_app_session', {
    p_session_token: sessionToken
  })
  if (error) throw error

  const rows = extractManagerCandidates(data)
  const row = rows[0] || null
  if (!row || row.session_type !== 'pwa') return null
  return {
    ...row,
    session_token: sessionToken || row.session_token || null
  }
}

export async function logoutManagerSession(sessionToken = null) {
  const { data, error } = await supabase.rpc('revoke_app_session', {
    p_session_token: sessionToken
  })
  if (error) throw error
  return data
}
