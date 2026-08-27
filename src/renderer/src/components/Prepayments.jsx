import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, CheckCircle2, CreditCard, Download, FileText, History, Link2, Plus, Printer, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, Undo2, Wallet } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useAccess, useAuth, useSettings } from '../app-context'
import { canAccessCapability, normalizeAppRole } from '../../../shared/accessControl'
import { getFeatureRequiredPlan, normalizeSubscriptionPlan, SUBSCRIPTION_PLAN_ORDER } from '../../../shared/subscriptionPlans'
import { Modal } from './shared/Modal'

const PAYMENT_METHODS = [
  ['cash', 'Cash'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank transfer'],
  ['mobile_money', 'Mobile money'],
  ['other', 'Other']
]

const emptyReceipt = { amount: '', method: 'cash', reference: '', notes: '' }

function money(currency, value) {
  return `${currency} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function numericAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function amountLabel(currency, value, unavailableLabel = 'Unavailable') {
  const amount = numericAmount(value)
  return amount === null ? unavailableLabel : money(currency, amount)
}

function newOperationKey(scope) {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${scope}:${uuid}`
}

function localDate(date) {
  const value = date instanceof Date ? date : new Date(date)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function hasFeature(access, featureKey) {
  const entitlementFeatures = access?.entitlement?.effective_features
  if (Object.prototype.hasOwnProperty.call(entitlementFeatures || {}, featureKey)) return entitlementFeatures[featureKey] !== false
  if (Object.prototype.hasOwnProperty.call(access?.features || {}, featureKey)) return access.features[featureKey] !== false
  if (access?.entitlement?.expired === true) return false
  const plan = normalizeSubscriptionPlan(access?.entitlement?.plan || access?.subscription_plan || 'Starter')
  return SUBSCRIPTION_PLAN_ORDER.indexOf(plan) >= SUBSCRIPTION_PLAN_ORDER.indexOf(getFeatureRequiredPlan(featureKey))
}

function entryEffect(entry) {
  if (['receipt', 'adjustment_in', 'reversal_in'].includes(entry?.entry_type)) return 1
  if (['booking_allocation', 'refund', 'adjustment_out', 'reversal_out'].includes(entry?.entry_type)) return -1
  return 0
}

function pendingResult(result) {
  return result?.offline === true || result?.queued === true || result?._pending_sync === true
}

function summaryBalanceLabel(currency, row) {
  const amount = numericAmount(row?.balance)
  if (row?._pending_sync === true || row?._confirmed_balance === false) return amount === null ? 'Pending confirmation' : `Pending · ${money(currency, amount)}`
  return amountLabel(currency, amount)
}

function serverResponseRows(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.rows)) return value.rows
  return null
}

function serverResponseData(value) {
  if (value?.data && typeof value.data === 'object') return value.data
  return value
}

function isCancelledBookingCredit(entry) {
  return entry?.method === 'customer_credit_transfer' && entry?.entry_type === 'adjustment_in'
}

function entryLabel(entry) {
  if (isCancelledBookingCredit(entry)) return 'Credit from cancelled booking'
  return {
    receipt: 'Advance payment received',
    booking_allocation: 'Applied to booking',
    refund: 'Credit refunded',
    adjustment_in: 'Credit added',
    adjustment_out: 'Credit removed',
    reversal_in: 'Credit restored',
    reversal_out: 'Credit reversed'
  }[entry?.entry_type] || String(entry?.entry_type || 'Credit activity').replaceAll('_', ' ')
}

export default function Prepayments() {
  const location = useLocation()
  const navigate = useNavigate()
  const access = useAccess()
  const { user } = useAuth()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const role = normalizeAppRole(access?.role || user?.role)
  const basicEnabled = hasFeature(access, 'prepayments_basic')
  const managementTier = hasFeature(access, 'prepayments_management')
  const advancedTier = hasFeature(access, 'prepayments_advanced')
  const canViewReports = canAccessCapability(access, 'prepayments.reconcile')
  const canSearchPortfolio = managementTier && canViewReports
  const canExport = managementTier && canAccessCapability(access, 'prepayments.export')
  const canRecord = basicEnabled && canAccessCapability(access, 'prepayments.receive')
  const starterRefundAuthority = ['admin', 'super_admin'].includes(role)
  const canRefund = basicEnabled && canAccessCapability(access, 'prepayments.refund') && canAccessCapability(access, 'prepayments.reverse') && (managementTier || starterRefundAuthority)
  const canViewAdvancedReports = advancedTier && canAccessCapability(access, 'prepayments.age')
  const canViewPaymentConfig = advancedTier && canAccessCapability(access, 'prepayments.configure') && ['admin', 'super_admin'].includes(role)
  const canMatch = advancedTier && canAccessCapability(access, 'prepayments.match')
  const activeTier = advancedTier ? 'Pro' : managementTier ? 'Standard' : 'Starter'

  const [customers, setCustomers] = useState(null)
  const [summary, setSummary] = useState(null)
  const [portfolio, setPortfolio] = useState({ status: 'idle', data: null, error: '' })
  const [baseStatus, setBaseStatus] = useState({ customers: 'loading', summary: 'loading' })
  const [baseError, setBaseError] = useState({ customers: '', summary: '' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedData, setSelectedData] = useState({ status: 'idle', balance: null, balanceState: 'unavailable', history: null, bookings: null, allBookings: null })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveForm, setReceiveForm] = useState(emptyReceipt)
  const [receiveOperationKey, setReceiveOperationKey] = useState(null)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)

  const [applyEntry, setApplyEntry] = useState(false)
  const [applyForm, setApplyForm] = useState({ bookingId: '', amount: '', notes: '' })
  const [applyOperationKey, setApplyOperationKey] = useState(null)
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash', reference: '', notes: '' })
  const [refundOperationKey, setRefundOperationKey] = useState(null)
  const reverseIntentRef = useRef(new Map())
  const [reconciliation, setReconciliation] = useState({ status: 'idle', data: null, error: '' })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advanced, setAdvanced] = useState({ status: 'idle', aging: null, matching: null, config: null, errors: {} })
  const [configForm, setConfigForm] = useState({ aging_threshold_days: '30,60,90', matching_tolerance: '0.01', suggestion_window_days: '365' })
  const [configOperationKey, setConfigOperationKey] = useState(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [exportResult, setExportResult] = useState(null)
  const [exporting, setExporting] = useState('')

  const loadBase = useCallback(async () => {
    setBaseStatus({ customers: 'loading', summary: 'loading' })
    setBaseError({ customers: '', summary: '' })
    setPortfolio(canSearchPortfolio ? { status: 'loading', data: null, error: '' } : { status: 'locked', data: null, error: '' })
    const searchTerm = canSearchPortfolio ? search.trim() || null : null
    const [customersResult, summaryResult, portfolioResult] = await Promise.allSettled([
      window.api.customers.getAll(),
      window.api.customerCredit.getSummary(searchTerm, 100, 0),
      canSearchPortfolio && window.api?.prepayments?.getPortfolio ? window.api.prepayments.getPortfolio(null) : Promise.resolve(null)
    ])
    if (customersResult.status === 'fulfilled' && Array.isArray(customersResult.value)) {
      setCustomers(customersResult.value)
      setBaseStatus((current) => ({ ...current, customers: 'ready' }))
    } else {
      setCustomers(null)
      setBaseStatus((current) => ({ ...current, customers: 'unavailable' }))
      setBaseError((current) => ({ ...current, customers: customersResult.reason?.message || 'Customer records are unavailable.' }))
    }
    if (summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value)) {
      setSummary(summaryResult.value)
      setBaseStatus((current) => ({ ...current, summary: 'ready' }))
    } else {
      setSummary(null)
      setBaseStatus((current) => ({ ...current, summary: 'unavailable' }))
      setBaseError((current) => ({ ...current, summary: summaryResult.reason?.message || 'Deposit balances are unavailable.' }))
    }
    if (canSearchPortfolio) {
      if (portfolioResult.status === 'fulfilled' && portfolioResult.value?.success !== false && !portfolioResult.value?.error) {
        setPortfolio({ status: 'ready', data: portfolioResult.value, error: '' })
      } else {
        setPortfolio({ status: 'unavailable', data: null, error: portfolioResult.reason?.message || portfolioResult.value?.error || 'The server portfolio is unavailable.' })
      }
    }
  }, [canSearchPortfolio, search])

  const loadCustomer = useCallback(async (customer) => {
    if (!customer?.id) return
    setSelected(customer)
    setError('')
    setSelectedData({ status: 'loading', balance: null, balanceState: 'unavailable', history: null, bookings: null, allBookings: null })
    const [balanceResult, historyResult, bookingsResult] = await Promise.allSettled([
      window.api.customerCredit.getBalance(customer.id),
      window.api.customerCredit.getHistory(customer.id, 100, 0),
      window.api.customers.getBookings(customer.id)
    ])
    if (balanceResult.status === 'fulfilled' && balanceResult.value?.success !== false) {
      const value = numericAmount(balanceResult.value?.balance)
      setSelectedData((current) => ({ ...current, balance: value, balanceState: pendingResult(balanceResult.value) ? 'pending' : value === null ? 'unavailable' : 'confirmed' }))
    }
    if (historyResult.status === 'fulfilled' && Array.isArray(historyResult.value)) {
      setSelectedData((current) => ({ ...current, history: historyResult.value }))
    } else {
      setError(historyResult.reason?.message || 'The deposit ledger is unavailable.')
    }
    if (bookingsResult.status === 'fulfilled' && Array.isArray(bookingsResult.value)) {
      const customerBookings = bookingsResult.value
      const outstandingBookings = customerBookings.filter((booking) => {
        const total = numericAmount(booking.total_amount)
        const charges = numericAmount(booking.charges_total) || 0
        const paid = numericAmount(booking.amount_paid)
        if (total === null || paid === null) return false
        return !['cancelled', 'checked_out'].includes(booking.status) && total + charges - paid > 0.009
      })
      setSelectedData((current) => ({ ...current, bookings: outstandingBookings, allBookings: customerBookings }))
    }
    setSelectedData((current) => ({ ...current, status: 'ready' }))
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  useEffect(() => {
    const targetCustomerId = location.state?.customerId
    if (!targetCustomerId || !Array.isArray(customers) || customers.length === 0) return
    const customer = customers.find((row) => String(row.id) === String(targetCustomerId))
    if (!customer) return
    loadCustomer(customer)
    if (location.state?.openReceive === true && canRecord) openReceiveModal()
    navigate(location.pathname, { replace: true, state: {} })
  }, [canRecord, customers, loadCustomer, location.pathname, location.state, navigate])

  const customerRows = useMemo(() => {
    const balances = new Map((Array.isArray(summary) ? summary : []).map((row) => [row.customer_id, row]))
    const needle = search.trim().toLowerCase()
    return (Array.isArray(customers) ? customers : [])
      .filter((customer) => !canSearchPortfolio || !needle || [customer.name, customer.phone, customer.email].some((value) => String(value || '').toLowerCase().includes(needle)))
      .map((customer) => ({ ...customer, credit: balances.get(customer.id) || null }))
      .sort((a, b) => {
        const left = numericAmount(a.credit?.balance)
        const right = numericAmount(b.credit?.balance)
        return (right === null ? -Infinity : right) - (left === null ? -Infinity : left) || String(a.name || '').localeCompare(String(b.name || ''))
      })
  }, [canSearchPortfolio, customers, search, summary])

  const refreshSelected = async () => {
    await loadBase()
    if (selected) await loadCustomer(selected)
  }

  const allBookings = Array.isArray(selectedData.allBookings) ? selectedData.allBookings : []
  const bookings = Array.isArray(selectedData.bookings) ? selectedData.bookings : null
  const bookingById = useMemo(() => new Map(allBookings.map((booking) => [String(booking.id), booking])), [allBookings])
  const balance = selectedData.balance
  const selectedBalanceUsable = selectedData.balanceState !== 'unavailable' && numericAmount(balance) !== null
  const canAllocate = canRecord && selectedBalanceUsable && Number(balance) > 0 && Array.isArray(bookings) && bookings.length > 0

  const openLinkedInvoice = (bookingId) => {
    if (!bookingId) return
    navigate('/invoices', {
      state: {
        viewBookingId: bookingId
      }
    })
  }

  function openReceiveModal() {
    setReceiveOperationKey(newOperationKey('customer-credit:receipt'))
    setReceiveOpen(true)
  }

  const closeReceiveModal = () => {
    setReceiveOpen(false)
    setReceiveOperationKey(null)
  }

  const receive = async (event) => {
    event.preventDefault()
    if (!selected) return
    const amount = numericAmount(receiveForm.amount)
    if (amount === null || amount <= 0) {
      setError('Enter a positive deposit amount.')
      return
    }
    const idempotencyKey = receiveOperationKey || newOperationKey('customer-credit:receipt')
    setReceiveOperationKey(idempotencyKey)
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.record({
        customerId: selected.id,
        amount,
        method: receiveForm.method,
        reference: receiveForm.reference,
        notes: receiveForm.notes,
        recordedBy: user?.id || null,
        idempotencyKey
      })
      if (result?.success === false) throw new Error(result.error)
      const resultBalance = numericAmount(result?.balance)
      const pending = pendingResult(result)
      const receiptData = {
        id: result.entry_id,
        receipt_number: result.receipt_number || (pending ? `PRE-PENDING-${String(result.entry_id || idempotencyKey).slice(0, 6).toUpperCase()}` : null),
        customer: selected,
        amount,
        method: receiveForm.method,
        reference: receiveForm.reference,
        notes: receiveForm.notes,
        balance: resultBalance,
        balanceState: pending ? 'pending' : resultBalance === null ? 'unavailable' : 'confirmed',
        offline: pending,
        created_at: new Date().toISOString()
      }
      setReceipt(receiptData)
      closeReceiveModal()
      setReceiveForm(emptyReceipt)
      setSuccess(pending ? 'Deposit saved locally and queued for server confirmation.' : resultBalance === null ? 'Deposit recorded; the new balance is not available yet.' : 'Deposit recorded successfully.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not record the deposit. Retry with the same operation if the result was ambiguous.')
    } finally {
      setSaving(false)
    }
  }

  const applyCredit = async (event) => {
    event.preventDefault()
    const booking = bookings?.find((row) => String(row.id) === String(applyForm.bookingId))
    const amount = numericAmount(applyForm.amount)
    if (!booking || amount === null || amount <= 0) return
    const idempotencyKey = applyOperationKey || newOperationKey('customer-credit:allocation')
    setApplyOperationKey(idempotencyKey)
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.applyToBooking({
        customerId: selected.id,
        bookingId: booking.id,
        amount,
        notes: applyForm.notes,
        recordedBy: user?.id || null,
        expectedBookingUpdatedAt: booking.updated_at || null,
        idempotencyKey
      })
      if (result?.success === false) throw new Error(result.error)
      setApplyEntry(false)
      setApplyOperationKey(null)
      setApplyForm({ bookingId: '', amount: '', notes: '' })
      setSuccess(pendingResult(result) ? 'Allocation queued for server confirmation.' : 'Deposit allocated to the booking through the server ledger.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not allocate the deposit. Retry with the same operation if the result was ambiguous.')
    } finally {
      setSaving(false)
    }
  }

  const refundCredit = async (event) => {
    event.preventDefault()
    const amount = numericAmount(refundForm.amount)
    if (amount === null || amount <= 0) return
    const idempotencyKey = refundOperationKey || newOperationKey('customer-credit:refund')
    setRefundOperationKey(idempotencyKey)
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.refund({
        customerId: selected.id,
        amount,
        method: refundForm.method,
        reference: refundForm.reference,
        notes: refundForm.notes,
        requestedBy: user?.id || null,
        approvedBy: user?.id || null,
        idempotencyKey
      })
      if (result?.success === false) throw new Error(result.error)
      setRefundOpen(false)
      setRefundOperationKey(null)
      setRefundForm({ amount: '', method: 'cash', reference: '', notes: '' })
      setSuccess(pendingResult(result) ? 'Refund queued for server confirmation.' : 'Customer deposit refund recorded with authorization.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not refund the deposit. Retry with the same operation if the result was ambiguous.')
    } finally {
      setSaving(false)
    }
  }

  const reverseEntry = async (entry) => {
    if (!entry?.id) return
    let intent = reverseIntentRef.current.get(entry.id)
    if (!intent) {
      const reason = window.prompt('Reason for reversing this entry:')
      if (!reason?.trim()) return
      intent = { reason: reason.trim(), idempotencyKey: newOperationKey('customer-credit:reverse') }
      reverseIntentRef.current.set(entry.id, intent)
    } else if (!window.confirm('Retry this reversal with the same reason and operation key?')) {
      reverseIntentRef.current.delete(entry.id)
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await window.api.customerCredit.reverse({ entryId: entry.id, notes: intent.reason, recordedBy: user?.id || null, idempotencyKey: intent.idempotencyKey })
      if (result?.success === false) throw new Error(result.error)
      reverseIntentRef.current.delete(entry.id)
      setSuccess(pendingResult(result) ? 'Reversal queued for server confirmation.' : 'Credit entry reversed with a compensating server transaction.')
      await refreshSelected()
    } catch (err) {
      setError(err.message || 'Could not reverse this entry. Retry to reuse the same operation key.')
    } finally {
      setSaving(false)
    }
  }

  const loadReconciliation = async () => {
    if (!managementTier || !canViewReports || !window.api?.prepayments?.getReconciliation) return
    setReconciliation({ status: 'loading', data: null, error: '' })
    try {
      const endDate = localDate(new Date())
      const start = new Date()
      start.setDate(start.getDate() - 29)
      const result = await window.api.prepayments.getReconciliation(`${localDate(start)}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`)
      if (result?.success === false || result?.error) throw new Error(result.error || 'Server reconciliation was unavailable.')
      setReconciliation({ status: 'ready', data: serverResponseData(result), error: '' })
    } catch (err) {
      setReconciliation({ status: 'unavailable', data: null, error: err.message || 'Server reconciliation was unavailable.' })
    }
  }

  const loadAdvanced = useCallback(async () => {
    if (!advancedTier) return
    setAdvanced({ status: 'loading', aging: null, matching: null, config: null, errors: {} })
    const tasks = []
    if (canViewAdvancedReports && window.api?.prepayments?.getAging) tasks.push(['aging', window.api.prepayments.getAging(null)])
    if (canMatch && window.api?.prepayments?.getMatchingSuggestions) tasks.push(['matching', window.api.prepayments.getMatchingSuggestions(50)])
    if ((canViewPaymentConfig || canViewAdvancedReports) && window.api?.prepayments?.getConfig) tasks.push(['config', window.api.prepayments.getConfig()])
    if (tasks.length === 0) {
      setAdvanced({ status: 'ready', aging: null, matching: null, config: null, errors: {} })
      return
    }
    const results = await Promise.allSettled(tasks.map(([, task]) => task))
    const next = { status: 'ready', aging: null, matching: null, config: null, errors: {} }
    results.forEach((result, index) => {
      const key = tasks[index][0]
      if (result.status === 'fulfilled' && result.value?.success !== false && !result.value?.error) next[key] = result.value
      else next.errors[key] = result.reason?.message || result.value?.error || 'Server response unavailable.'
    })
    setAdvanced(next)
  }, [advancedTier, canMatch, canViewAdvancedReports, canViewPaymentConfig])

  useEffect(() => {
    if (advancedOpen && advancedTier) loadAdvanced()
  }, [advancedOpen, advancedTier, loadAdvanced])

  const exportReport = async () => {
    if (!canExport || !window.api?.prepayments?.export) {
      setError('Server-backed Guest Deposits export is not available for this licence.')
      return
    }
    const endDate = localDate(new Date())
    const start = new Date()
    start.setDate(start.getDate() - 29)
    setExporting('server')
    setError('')
    setExportResult(null)
    try {
      const result = await window.api.prepayments.export(`${localDate(start)}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`)
      if (result?.canceled === true || result?.cancelled === true) {
        setExportResult(null)
        return
      }
      if (result?.success === false) throw new Error(result.error || 'Export was not completed.')
      setExportResult(result)
      const fileName = result?.fileName || result?.filename || 'selected file'
      const rowCount = numericAmount(result?.rowCount)
      setSuccess(`Authoritative Guest Deposits export saved to ${fileName}${rowCount === null ? '' : ` (${rowCount} rows)`}.`)
    } catch (err) {
      setError(err.message || 'The server-backed export could not be completed.')
    } finally {
      setExporting('')
    }
  }

  const saveConfig = async (event) => {
    event.preventDefault()
    if (!canViewPaymentConfig || !window.api?.prepayments?.setConfig) return
    const thresholdTokens = configForm.aging_threshold_days.split(',').map((value) => value.trim())
    const thresholds = thresholdTokens.map((value) => Number(value))
    if (thresholdTokens.length === 0 || thresholdTokens.some((value) => !/^\d+$/.test(value)) || thresholds.some((value) => !Number.isInteger(value) || value <= 0)) {
      setError('Enter positive whole-number ageing thresholds, separated by commas.')
      return
    }
    if (thresholds.length !== 3 || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])) {
      setError('Provide exactly three strictly ascending, unique ageing thresholds.')
      return
    }
    const tolerance = numericAmount(configForm.matching_tolerance)
    const suggestionWindow = Number(configForm.suggestion_window_days)
    if (tolerance === null || tolerance < 0 || !Number.isInteger(suggestionWindow) || suggestionWindow < 1) {
      setError('Enter a valid matching tolerance and a positive whole-number suggestion window.')
      return
    }
    const idempotencyKey = configOperationKey || newOperationKey('prepayments:config')
    setConfigOperationKey(idempotencyKey)
    setSavingConfig(true)
    setError('')
    try {
      const result = await window.api.prepayments.setConfig({
        config: {
          aging_threshold_days: thresholds,
          matching_tolerance: tolerance,
          suggestion_window_days: suggestionWindow
        },
        idempotencyKey
      })
      if (result?.success === false || result?.error) throw new Error(result.error || 'Configuration was not saved.')
      setConfigOperationKey(null)
      setSuccess('Guest Deposits guidance thresholds saved with an audited server operation.')
      await loadAdvanced()
    } catch (err) {
      setError(err.message || 'Configuration could not be saved. Retry with the same operation key.')
    } finally {
      setSavingConfig(false)
    }
  }

  const reconciliationData = serverResponseData(reconciliation.data)
  const portfolioData = serverResponseData(portfolio.data)
  const portfolioRows = serverResponseRows(portfolioData?.customers) || []
  const agingData = serverResponseData(advanced.aging)
  const agingRows = serverResponseRows(agingData?.buckets) || []
  const alertRows = serverResponseRows(agingData?.alerts) || serverResponseRows(agingData?.alert_output) || serverResponseRows(agingData?.threshold_alerts) || []
  const matchingData = serverResponseData(advanced.matching)
  const matchingRows = serverResponseRows(matchingData?.suggestions) || []
  const matchingAlertRows = serverResponseRows(matchingData?.alerts) || []
  const configData = serverResponseData(advanced.config)?.config || serverResponseData(advanced.config)

  useEffect(() => {
    if (!configData) return
    const thresholds = Array.isArray(configData.aging_threshold_days) ? configData.aging_threshold_days.join(',') : ''
    setConfigForm({
      aging_threshold_days: thresholds,
      matching_tolerance: configData.matching_tolerance === null || configData.matching_tolerance === undefined ? '' : String(configData.matching_tolerance),
      suggestion_window_days: configData.suggestion_window_days === null || configData.suggestion_window_days === undefined ? '' : String(configData.suggestion_window_days)
    })
  }, [configData])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-slate-900">Guest Deposits</h1><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{activeTier} tier</span></div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{activeTier === 'Starter' ? 'Guest Deposits Lite: receive money before dates are confirmed, issue a receipt, review the ledger, and allocate it when the server confirms a booking.' : 'Hold customer money without reserving a room, then allocate it when dates are confirmed. Balances and ledger entries remain server-authoritative.'}</p>
        </div>
        <button onClick={refreshSelected} className="btn-secondary flex items-center gap-2"><RefreshCw size={15} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
      {baseStatus.summary === 'unavailable' && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>Deposit balances unavailable.</strong> Records remain visible, but no missing balance is treated as zero. Reconnect or refresh before posting a financial action.</div>}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="bb-card overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input className={`input w-full pl-9 ${!canSearchPortfolio ? 'cursor-not-allowed bg-slate-50' : ''}`} value={search} disabled={!canSearchPortfolio} onChange={(event) => setSearch(event.target.value)} placeholder={canSearchPortfolio ? 'Search deposit portfolio…' : 'Portfolio search is Standard'} title={!canSearchPortfolio ? 'Upgrade to Standard for portfolio search and reconciliation.' : undefined} />
            </div>
            {!canSearchPortfolio && <p className="mt-2 text-xs text-slate-500">Starter keeps the customer deposit list and ledger readable. Standard adds portfolio search, reconciliation, and exports.</p>}
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {baseStatus.customers === 'loading' ? <p className="p-5 text-sm text-slate-500">Loading customer deposit records…</p> : baseStatus.customers === 'unavailable' ? <p className="p-5 text-sm text-rose-700">{baseError.customers || 'Customer records are unavailable.'}</p> : customerRows.length === 0 ? <p className="p-5 text-sm text-slate-500">No customer deposit records found.</p> : customerRows.map((customer) => (
              <button key={customer.id} onClick={() => loadCustomer(customer)} className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected?.id === customer.id ? 'bg-emerald-50' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{customer.name}</p>
                    <p className="truncate text-xs text-slate-500">{customer.phone || customer.email || 'No contact details'}</p>
                  </div>
                  <span className={`text-right text-xs font-bold ${customer.credit?._pending_sync || customer.credit?._confirmed_balance === false ? 'text-amber-700' : 'text-slate-700'}`}>{summaryBalanceLabel(currency, customer.credit)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          {!selected ? (
            <div className="bb-card p-10 text-center text-slate-500">Select a customer to manage their Guest Deposits ledger.</div>
          ) : (
            <>
              <div className="bb-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">{selected.name}</p>
                    <p className={`mt-1 text-3xl font-bold ${selectedData.balanceState === 'pending' ? 'text-amber-700' : 'text-emerald-700'}`}>{selectedData.balanceState === 'pending' ? amountLabel(currency, balance, 'Pending confirmation') : amountLabel(currency, balance)}</p>
                    <p className="mt-1 text-xs text-slate-500">{selectedData.balanceState === 'pending' ? 'Local work is pending server confirmation; do not treat it as settled.' : selectedData.balanceState === 'unavailable' ? 'The authoritative balance is unavailable. Refresh before posting financial work.' : 'Confirmed customer credit available for allocation or authorized refund.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canRecord && <button onClick={openReceiveModal} className="btn-primary flex items-center gap-2"><Plus size={15} /> Receive deposit</button>}
                    {canAllocate && <button onClick={() => { setApplyOperationKey(newOperationKey('customer-credit:allocation')); setApplyEntry(true) }} className="btn-secondary flex items-center gap-2"><Link2 size={15} /> Allocate to booking</button>}
                    {canRefund && selectedBalanceUsable && Number(balance) > 0 && <button onClick={() => { setRefundOperationKey(newOperationKey('customer-credit:refund')); setRefundOpen(true) }} className="btn-secondary flex items-center gap-2 text-rose-700"><Undo2 size={15} /> Authorized refund</button>}
                  </div>
                </div>
                {!basicEnabled && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Guest Deposits actions are unavailable for this licence. Existing records remain readable; request the Starter package to post new work.</p>}
                {basicEnabled && !canRecord && <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Your role can review this ledger but cannot receive deposits. A user with payment-record authority must post the transaction.</p>}
                {canRefund && <p className="mt-3 text-xs text-slate-500"><ShieldCheck size={13} className="mr-1 inline" />Refunds and reversals are restricted to server-enforced payment authority and require an auditable reason.</p>}
              </div>

              <div className="bb-card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><History size={17} /><h2 className="font-semibold text-slate-800">Credit ledger</h2></div>
                {selectedData.history === null ? <p className="p-6 text-sm text-rose-700">Deposit ledger unavailable. Reconnect before treating the customer balance as settled.</p> : selectedData.history.length === 0 ? <p className="p-6 text-sm text-slate-500">No deposit activity for this customer.</p> : (
                  <div className="divide-y divide-slate-100">
                    {selectedData.history.map((entry) => {
                      const sign = entryEffect(entry)
                      const isReversal = ['reversal_in', 'reversal_out'].includes(entry.entry_type)
                      const entryAmount = numericAmount(entry.amount)
                      return (
                        <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{entryLabel(entry)}</p>
                            <p className="mt-1 text-xs text-slate-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Timestamp unavailable'} · {String(entry.method || 'internal').replaceAll('_', ' ')}</p>
                            {(entry.reference || entry.notes) && <p className="mt-1 text-xs text-slate-500">{entry.reference || entry.notes}</p>}
                            {entry.booking_id && (
                              <button
                                type="button"
                                onClick={() => openLinkedInvoice(entry.booking_id)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                              >
                                <FileText size={13} />
                                Open {bookingById.get(String(entry.booking_id))?.invoice_number || 'linked invoice'}
                              </button>
                            )}
                            {entry.entry_type === 'receipt' && (
                              <button
                                type="button"
                                onClick={() => setReceipt({
                                  id: entry.id,
                                  receipt_number: entry.receipt_number,
                                  customer: selected,
                                  amount: entryAmount,
                                  method: entry.method || 'other',
                                  reference: entry.reference || '',
                                  notes: entry.notes || '',
                                  balance,
                                  balanceState: entry._pending_sync ? 'pending' : selectedData.balanceState,
                                  offline: entry._pending_sync === true,
                                  created_at: entry.created_at
                                })}
                                className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                              >
                                Open receipt
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-right font-bold ${sign > 0 ? 'text-emerald-700' : sign < 0 ? 'text-rose-700' : 'text-slate-400'}`}>{sign > 0 ? '+' : sign < 0 ? '−' : ''}{amountLabel(currency, entryAmount)}</span>
                            {canRefund && sign !== 0 && !isReversal && !entry.reversed && (
                              <button disabled={saving} onClick={() => reverseEntry(entry)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Reverse entry"><RotateCcw size={15} /></button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {managementTier && <div className="bb-card space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><BarChart3 size={17} /><h2 className="font-semibold text-slate-800">Standard management</h2></div>
                    <p className="mt-1 text-xs text-slate-500">Server-backed portfolio, reconciliation, and export controls. These projections never replace the customer-credit ledger.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={loadReconciliation} disabled={reconciliation.status === 'loading'} className="btn-secondary flex items-center gap-2"><RefreshCw size={14} /> {reconciliation.status === 'loading' ? 'Reconciling…' : 'Reconcile 30 days'}</button>
                    <button onClick={() => exportReport()} disabled={!canExport || exporting === 'server'} className="btn-secondary flex items-center gap-2"><Download size={14} /> {exporting === 'server' ? 'Preparing…' : 'Export server data'}</button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolio liability</p><span className="text-xs text-slate-500">{portfolio.status === 'ready' && portfolioData?.financial_certified === true ? 'Server-certified' : 'Server response'}</span></div>
                    {portfolio.status === 'loading' ? <p className="mt-3 text-sm text-slate-500">Loading portfolio projection…</p> : portfolio.status === 'unavailable' ? <p className="mt-3 text-sm text-rose-700">{portfolio.error || 'Portfolio projection unavailable.'}</p> : portfolio.status !== 'ready' ? <p className="mt-3 text-sm text-slate-500">Portfolio projection is not available.</p> : <>
                      <p className="mt-2 text-2xl font-bold text-slate-800">{amountLabel(currency, portfolioData?.total_liability)}</p>
                      <p className="mt-1 text-xs text-slate-500">{numericAmount(portfolioData?.customer_count) === null ? 'Customer count unavailable' : `${portfolioData.customer_count} customers with server-confirmed credit`}</p>
                      {portfolioRows.length > 0 && <div className="mt-3 divide-y divide-slate-100">{portfolioRows.slice(0, 6).map((row) => <div key={row.customer_id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="truncate text-slate-600">{row.customer_name || 'Customer name unavailable'}</span><span className="font-semibold text-slate-800">{amountLabel(currency, row.balance)}</span></div>)}</div>}
                      {portfolioRows.length === 0 && <p className="mt-3 text-xs text-slate-500">No server-confirmed portfolio balances.</p>}
                    </>}
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reconciliation</p>{reconciliationData?.financial_certified === true && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} /> Certified source</span>}</div>
                    {reconciliation.status === 'idle' ? <p className="mt-3 text-sm text-slate-500">Run the 30-day server reconciliation when you need a ledger projection.</p> : reconciliation.status === 'loading' ? <p className="mt-3 text-sm text-slate-500">Loading reconciliation projection…</p> : reconciliation.status === 'unavailable' ? <p className="mt-3 text-sm text-rose-700">{reconciliation.error || 'Reconciliation unavailable.'}</p> : <div className="mt-3 grid grid-cols-2 gap-3 text-xs">{[['Receipts', reconciliationData?.receipts], ['Allocations', reconciliationData?.allocations], ['Refunds', reconciliationData?.refunds], ['Reversals out', reconciliationData?.reversal_out]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">{label}</span><p className="mt-1 font-semibold text-slate-800">{amountLabel(currency, value)}</p></div>)}<p className="col-span-2 text-slate-500">{numericAmount(reconciliationData?.entry_count) === null ? 'Entry count unavailable' : `${reconciliationData.entry_count} ledger entries in the server projection.`}</p></div>}
                  </div>
                </div>
                {exportResult && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><strong>CSV export saved.</strong> {exportResult.fileName || exportResult.filename || 'File name unavailable'} · {numericAmount(exportResult.rowCount) === null ? 'Row count unavailable' : `${exportResult.rowCount} rows`}{exportResult.financialCertified === true ? ' · Server-certified source' : ''}</div>}
                {!canExport && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Your role can review management projections but does not have the server export capability.</p>}
              </div>}

              {managementTier && !advancedTier && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-800"><strong>Pro controls are locked.</strong> Your deposit records remain readable and Standard management stays available. Upgrade to Pro for server-backed ageing, matching suggestions, and configurable guidance thresholds.</div>}

              {advancedTier && <div className="bb-card space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><Settings2 size={17} /><h2 className="font-semibold text-slate-800">Pro controls</h2></div>
                    <p className="mt-1 text-xs text-slate-500">Ageing and matching are read-only server projections. Suggestions are advisory; only the existing allocation action can mutate the ledger.</p>
                  </div>
                  <button onClick={() => setAdvancedOpen(true)} disabled={advanced.status === 'loading'} className="btn-secondary flex items-center gap-2"><RefreshCw size={14} /> {advanced.status === 'loading' ? 'Loading…' : 'Load Pro controls'}</button>
                </div>
                {advanced.status === 'idle' && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Load the authoritative ageing, matching, and guidance configuration projections.</p>}
                {advanced.status === 'loading' && <p className="text-sm text-slate-500">Loading Pro projections from the server…</p>}
                {advanced.errors && Object.entries(advanced.errors).map(([key, message]) => <p key={key} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{key} is unavailable: {message}</p>)}
                {(advanced.status === 'ready' || advanced.status === 'loading') && <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2"><BarChart3 size={15} /><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ageing dashboard</p></div>
                    {canViewAdvancedReports ? <>{agingRows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No server-confirmed ageing balances.</p> : <div className="mt-3 space-y-2">{agingRows.map((row) => <div key={row.bucket} className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-600">{row.bucket || 'Age bucket unavailable'} <span className="text-slate-400">({row.customer_count ?? 'count unavailable'})</span></span><span className="font-semibold text-slate-800">{amountLabel(currency, row.balance)}</span></div>)}</div>}{agingData?.alerts !== undefined || agingData?.alert_output !== undefined || agingData?.threshold_alerts !== undefined ? <div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-600">Server-derived alerts</p>{alertRows.length === 0 ? <p className="mt-1 text-xs text-slate-500">No active threshold alerts returned.</p> : <div className="mt-2 space-y-2">{alertRows.map((alert, index) => { const alertAmount = alert.balance ?? alert.amount; return <div key={alert.id || `${alert.bucket || 'alert'}-${index}`} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><strong>{alert.title || alert.code || alert.type || alert.bucket || 'Threshold alert'}</strong>{alert.message && <span> · {alert.message}</span>}{alertAmount !== undefined && <span> · {amountLabel(currency, alertAmount)}</span>}</div> })}</div>}</div> : null}</> : <p className="mt-3 text-xs text-slate-500">Ageing capability is not available for this role.</p>}
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2"><Link2 size={15} /><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matching suggestions</p></div>
                    {canMatch ? <>{matchingRows.length === 0 ? <p className="mt-3 text-xs text-slate-500">No advisory matches returned by the server.</p> : <div className="mt-3 space-y-2">{matchingRows.slice(0, 5).map((row) => <div key={`${row.customer_id}-${row.booking_id}`} className="rounded-lg bg-slate-50 p-2 text-xs"><p className="font-semibold text-slate-700">{row.customer_name || 'Customer unavailable'}</p><p className="mt-1 text-slate-500">{row.booking_number || row.booking_id || 'Booking unavailable'} · Suggested {amountLabel(currency, row.suggested_amount)}</p><p className="mt-1 text-amber-700">Advisory only — not applied.</p></div>)}</div>}{matchingData?.alerts !== undefined && <div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-600">Matching alerts</p>{matchingAlertRows.length === 0 ? <p className="mt-1 text-xs text-slate-500">No active matching alerts returned.</p> : <div className="mt-2 space-y-2">{matchingAlertRows.map((alert, index) => <div key={alert.id || `${alert.type || 'alert'}-${index}`} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><strong>{alert.type || 'Matching alert'}</strong>{alert.message && <span> · {alert.message}</span>}</div>)}</div>}</div>}</> : <p className="mt-3 text-xs text-slate-500">Matching capability is not available for this role.</p>}
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2"><AlertTriangle size={15} /><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guidance thresholds</p></div>
                    {configData ? <div className="mt-3 space-y-2 text-xs text-slate-600"><p>Ageing days: <strong>{Array.isArray(configData.aging_threshold_days) ? configData.aging_threshold_days.join(', ') : 'Unavailable'}</strong></p><p>Matching tolerance: <strong>{amountLabel(currency, configData.matching_tolerance)}</strong></p><p>Suggestion window: <strong>{configData.suggestion_window_days ?? 'Unavailable'} days</strong></p>{canViewPaymentConfig ? <form onSubmit={saveConfig} className="mt-3 space-y-2 border-t border-slate-100 pt-3"><Field label="Ageing thresholds (days, comma separated)"><input className="input w-full text-xs" value={configForm.aging_threshold_days} onChange={(event) => setConfigForm({ ...configForm, aging_threshold_days: event.target.value })} /></Field><Field label={`Matching tolerance (${currency})`}><input className="input w-full text-xs" type="number" min="0" step="0.01" value={configForm.matching_tolerance} onChange={(event) => setConfigForm({ ...configForm, matching_tolerance: event.target.value })} /></Field><Field label="Suggestion window (days)"><input className="input w-full text-xs" type="number" min="1" step="1" value={configForm.suggestion_window_days} onChange={(event) => setConfigForm({ ...configForm, suggestion_window_days: event.target.value })} /></Field><button disabled={savingConfig} className="btn-primary w-full text-xs">{savingConfig ? 'Saving…' : 'Save thresholds'}</button></form> : <p className="mt-2 text-amber-700">Admin authority is required to change thresholds.</p>}</div> : <p className="mt-3 text-xs text-slate-500">Configuration projection unavailable.</p>}
                  </div>
                </div>}
                <p className="text-xs text-slate-500">No separate server alert feed is exposed in the current preload; threshold configuration is shown as operator guidance only.</p>
              </div>}
            </>
          )}
        </section>
      </div>

      {receiveOpen && <Modal title="Receive Guest Deposit" onClose={closeReceiveModal} size="sm">
        <form onSubmit={receive} className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">This records money as customer credit. It does not reserve a room or guarantee availability.</p>
          <Field label={`Amount (${currency})`}><input className="input w-full" required type="number" min="0.01" step="0.01" value={receiveForm.amount} onChange={(e) => setReceiveForm({ ...receiveForm, amount: e.target.value })} /></Field>
          <MethodSelect value={receiveForm.method} onChange={(method) => setReceiveForm({ ...receiveForm, method })} />
          <Field label="Reference / POP number"><input className="input w-full" value={receiveForm.reference} onChange={(e) => setReceiveForm({ ...receiveForm, reference: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input min-h-20 w-full" value={receiveForm.notes} onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={closeReceiveModal} className="btn-secondary flex-1">Cancel</button><button disabled={saving} className="btn-primary flex-1">{saving ? 'Recording…' : 'Record deposit'}</button></div>
        </form>
      </Modal>}

      {applyEntry && <Modal title="Allocate Deposit to Booking" onClose={() => { setApplyEntry(false); setApplyOperationKey(null) }} size="sm">
        <form onSubmit={applyCredit} className="space-y-4">
          <p className="text-sm text-slate-600">Available server balance: <strong>{amountLabel(currency, balance, selectedData.balanceState === 'pending' ? 'Pending confirmation' : 'Unavailable')}</strong></p>
          <Field label="Booking"><select required className="input w-full" value={applyForm.bookingId} onChange={(e) => setApplyForm({ ...applyForm, bookingId: e.target.value })}><option value="">Select booking…</option>{bookings?.map((booking) => { const total = numericAmount(booking.total_amount); const charges = numericAmount(booking.charges_total) || 0; const paid = numericAmount(booking.amount_paid); const due = total === null || paid === null ? null : total + charges - paid; return <option key={booking.id} value={booking.id}>{booking.invoice_number || booking.id.slice(0, 8)} · {booking.check_in || 'Date unavailable'} · Due {amountLabel(currency, due)}</option> })}</select></Field>
          <Field label={`Amount (${currency})`}><input required className="input w-full" type="number" min="0.01" step="0.01" max={selectedBalanceUsable ? balance : undefined} value={applyForm.amount} onChange={(e) => setApplyForm({ ...applyForm, amount: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input min-h-20 w-full" value={applyForm.notes} onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={() => { setApplyEntry(false); setApplyOperationKey(null) }} className="btn-secondary flex-1">Cancel</button><button disabled={saving || !selectedBalanceUsable} className="btn-primary flex-1">{saving ? 'Allocating…' : 'Allocate deposit'}</button></div>
        </form>
      </Modal>}

      {refundOpen && <Modal title="Authorized Deposit Refund" onClose={() => { setRefundOpen(false); setRefundOperationKey(null) }} size="sm">
        <form onSubmit={refundCredit} className="space-y-4">
          <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">This records money leaving the property. Confirm the external refund before posting it. Server authority and an auditable reason are required.</p>
          <Field label={`Amount (${currency})`}><input required className="input w-full" type="number" min="0.01" step="0.01" max={selectedBalanceUsable ? balance : undefined} value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} /></Field>
          <MethodSelect value={refundForm.method} onChange={(method) => setRefundForm({ ...refundForm, method })} />
          <Field label="Refund reference"><input required className="input w-full" value={refundForm.reference} onChange={(e) => setRefundForm({ ...refundForm, reference: e.target.value })} /></Field>
          <Field label="Reason"><textarea required className="input min-h-20 w-full" value={refundForm.notes} onChange={(e) => setRefundForm({ ...refundForm, notes: e.target.value })} /></Field>
          <div className="flex gap-2"><button type="button" onClick={() => { setRefundOpen(false); setRefundOperationKey(null) }} className="btn-secondary flex-1">Cancel</button><button disabled={saving || !selectedBalanceUsable} className="btn-primary flex-1 bg-rose-600 hover:bg-rose-700">{saving ? 'Recording…' : 'Record refund'}</button></div>
        </form>
      </Modal>}

      {receipt && <AdvanceReceipt receipt={receipt} currency={currency} settings={settings} onClose={() => setReceipt(null)} />}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>
}

function MethodSelect({ value, onChange }) {
  return <Field label="Payment method"><select className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
}

function AdvanceReceipt({ receipt, currency, settings, onClose }) {
  const print = () => window.api.receipts.printCurrent({ silent: false }).catch(() => null)
  const receiptNumber = receipt.receipt_number || `PRE-PENDING-${String(receipt.id).slice(0, 6).toUpperCase()}`
  const save = () => window.api.receipts.savePDF({
    guestName: receipt.customer.name,
    invoiceNumber: receiptNumber,
    documentType: 'prepayment',
    defaultFilename: `${receiptNumber}-${receipt.customer.name}`,
    receipt: {
      receiptNumber,
      customerName: receipt.customer.name,
      amount: numericAmount(receipt.amount),
      currency,
      method: receipt.method,
      reference: receipt.reference || '',
      notes: receipt.notes || '',
      balance: numericAmount(receipt.balance),
      balanceState: receipt.balanceState || 'unavailable',
      createdAt: receipt.created_at,
      provisional: receipt.offline === true,
      lodgeName: settings?.lodge_name || settings?.company_name || 'Lodge',
      companyName: settings?.company_name || '',
      address: settings?.address || '',
      phone: settings?.phone || '',
      email: settings?.email || '',
      website: settings?.website || '',
      logo: settings?.logo || ''
    }
  }).catch(() => null)
  return <Modal title="Guest Deposit Receipt" onClose={onClose} size="lg">
    <div id="printable-receipt" className="mx-auto min-h-[297mm] w-full max-w-[210mm] space-y-8 bg-white p-8 sm:p-12 print:min-h-0 print:w-[210mm] print:max-w-none print:p-[16mm]">
      {receipt.offline && <div className="rounded-lg bg-amber-50 p-3 text-center text-xs font-semibold text-amber-800">PROVISIONAL — PENDING SERVER CONFIRMATION</div>}
      <div className="text-center">
        <h2 className="text-2xl font-bold">{settings?.lodge_name || settings?.company_name || 'Lodge'}</h2>
        <p className="text-sm text-slate-500">{settings?.address || ''}</p>
        <h3 className="mt-8 text-xl font-semibold">Guest Deposit Receipt</h3>
        <p className="mt-1 text-sm text-slate-500">{receiptNumber}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm">
        <div><span className="text-slate-500">Customer</span><p className="font-semibold">{receipt.customer.name}</p></div>
        <div><span className="text-slate-500">Date</span><p className="font-semibold">{new Date(receipt.created_at).toLocaleString()}</p></div>
        <div><span className="text-slate-500">Method</span><p className="font-semibold">{receipt.method.replaceAll('_', ' ')}</p></div>
        <div><span className="text-slate-500">Reference</span><p className="font-semibold">{receipt.reference || '—'}</p></div>
      </div>
      <div className="rounded-xl bg-emerald-50 p-5 text-center"><p className="text-sm text-emerald-700">Amount received</p><p className="text-3xl font-bold text-emerald-800">{amountLabel(currency, receipt.amount)}</p><p className="mt-2 text-sm text-emerald-700">Remaining customer credit: {receipt.balanceState === 'pending' ? 'Pending server confirmation' : amountLabel(currency, receipt.balance)}</p>{receipt.balanceState === 'unavailable' && <p className="mt-1 text-xs text-amber-800">The authoritative balance is unavailable; it was not treated as zero.</p>}</div>
      {receipt.notes && <div className="rounded-xl border border-slate-200 p-4 text-sm"><span className="text-slate-500">Notes</span><p className="mt-1 text-slate-800">{receipt.notes}</p></div>}
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-900">This payment is held as customer credit. It does not reserve accommodation or guarantee room availability until a booking is confirmed.</p>
      <div className="flex justify-end gap-2 print:hidden"><button onClick={save} className="btn-secondary flex items-center gap-2"><Download size={15} /> Save PDF</button><button onClick={print} className="btn-primary flex items-center gap-2"><Printer size={15} /> Print</button></div>
    </div>
  </Modal>
}
