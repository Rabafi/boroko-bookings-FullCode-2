import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Database, Download, HardDrive,
  RefreshCw, RotateCcw, ShieldCheck, Trash2, Wifi, Play,
  Clock, XCircle, AlertCircle, Info
} from 'lucide-react'

// ─── Pill helpers ──────────────────────────────────────────────────────────────

function StatusPill({ ok, label, warn }) {
  const cls = ok
    ? 'bg-green-100 text-green-700'
    : warn
      ? 'bg-amber-100 text-amber-800'
      : 'bg-red-100 text-red-800'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function formatAge(ms) {
  if (ms == null) return 'unknown'
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatTs(ts) {
  if (!ts) return null
  try { return new Date(ts).toLocaleString('en-GB') } catch { return ts }
}

function HumanContext({ details, rooms, customers }) {
  if (!details || typeof details !== 'object') return null

  // Flatten common payload structures
  const flattened = { 
    ...(details.data?.payload || {}),
    ...(details.data || {}),
    ...(details.payload || {}), 
    ...details 
  }
  
  const findRoom = (id) => rooms.find(r => r.id === Number(id) || r.id === String(id))
  const findCustomer = (id) => customers.find(c => c.id === Number(id) || c.id === String(id))

  const entries = Object.entries(flattened)
    .filter(([key, val]) => {
      const skipKeys = [
        'payload', 'data', 'lodge_id', 'created_at', 'updated_at', 
        '_queue_id', 'type', 'at', 'id', 'p_id', 'p_lodge_id', 'operation', 'scope'
      ]
      if (val === null || val === undefined || val === '') return false
      if (typeof val === 'object' && !Array.isArray(val)) return false
      if (skipKeys.includes(key.toLowerCase())) return false
      return true
    })
    .map(([key, val]) => {
      let label = key.replace(/_/g, ' ').replace(/^p /, '')
      label = label.charAt(0).toUpperCase() + label.slice(1)
      
      let displayVal = val
      if (key.toLowerCase().includes('room_id')) {
        const r = findRoom(val)
        if (r) displayVal = `Room ${r.room_number}`
      } else if (key.toLowerCase().includes('customer_id')) {
        const c = findCustomer(val)
        if (c) displayVal = c.name
      } else if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('rate') || key.toLowerCase().includes('total') || key.toLowerCase().includes('balance')) {
        if (!isNaN(val)) displayVal = Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })
      }

      return { label, value: String(displayVal) }
    })

  if (entries.length === 0) return null

  return (
    <div className="mt-2 space-y-1 rounded-lg bg-white/60 p-2.5 ring-1 ring-black/5 shadow-sm">
      {entries.map((entry, i) => (
        <div key={i} className="flex justify-between gap-4 text-[11px] leading-relaxed">
          <span className="font-semibold text-slate-500 shrink-0">{entry.label}</span>
          <span className="text-slate-900 text-right truncate max-w-[200px] font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// Sanitize a raw sync error string for display to front-desk operators.
// Strips UUIDs and maps known technical patterns to plain English.
function sanitizeForOperator(raw) {
  if (!raw) return 'Unknown sync failure'
  const msg = String(raw)
  if (/room.*conflict|no_overlapping_bookings/i.test(msg)) return 'Room conflict — this room was already booked for the selected dates.'
  if (/idempotency.*required/i.test(msg)) return 'Operation requires a retry key — retry this item.'
  if (/authenticated.*required|authentication.*required|session.*required/i.test(msg)) return 'Session expired — sign in again, then retry.'
  if (/lodge.*role|permission denied|insufficient.*privilege/i.test(msg)) return 'Permission denied — check the account role in Settings.'
  if (/unique.*violation|duplicate key/i.test(msg)) return 'Duplicate record — this item may already exist on the server.'
  if (/not found/i.test(msg)) return 'Record not found on server — it may have been deleted remotely.'
  if (/overpay/i.test(msg)) return 'Payment would exceed the booking total — adjust and retry.'
  if (/below zero/i.test(msg)) return 'Adjustment would reduce paid balance below zero.'
  const cleaned = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned
}

// Human-readable labels for sync queue operation names shown to operators.
const SYNC_OP_LABEL = {
  create_booking:           'New booking',
  create_booking_record:    'New booking',
  update_booking:           'Update booking',
  update_booking_status:    'Booking status change',
  update_booking_payment:   'Payment',
  create_customer:          'New guest',
  update_customer:          'Update guest',
  update_customer_blacklist:'Update guest blacklist',
  create_room:              'New room',
  update_room:              'Update room',
  update_room_housekeeping: 'Housekeeping update',
  create_quotation:         'New quotation',
  update_quotation:         'Update quotation',
  mark_quotation_sent:      'Quotation sent',
  convert_quotation:        'Quotation conversion',
  create_user:              'New staff account',
  update_user_profile:      'Staff profile update',
  set_user_password:        'Password change',
  delete_user:              'Remove staff account',
  add_booking_charge:       'Booking charge',
  void_pos_order:           'POS void',
}

function syncOpLabel(table) {
  return SYNC_OP_LABEL[table] || table || 'Unknown operation'
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SystemHealthPanel() {
  const navigate = useNavigate()
  const [health, setHealth]               = useState(null)
  const [globalSettings, setGlobalSettings] = useState(null)
  const [sessionUser, setSessionUser]     = useState(null)
  const [syncDetails, setSyncDetails]     = useState({ pending: [], failed: [], faults: [], cacheFreshness: {} })
  const [reconciliation, setReconciliation] = useState(null)
  const [validation, setValidation]       = useState(null)
  const [validationRuns, setValidationRuns] = useState([])
  const [validationAlerts, setValidationAlerts] = useState([])
  const [criticalErrors, setCriticalErrors] = useState([])
  const [deviceHealthRollup, setDeviceHealthRollup] = useState({ available: false, devices: [] })
  const [loading, setLoading]             = useState(false)
  const [actionBusy, setActionBusy]       = useState('')
  const [flash, setFlash]                 = useState(null)
  const [rendererErrors, setRendererErrors] = useState([])
  const [rooms, setRooms]                 = useState([])
  const [customers, setCustomers]         = useState([])
  // Track current pending count so post-sync polling can detect when items drain
  const pendingCountRef = useRef(0)

  const load = async () => {
    setLoading(true)
    try {
      const [
        systemHealth, settingsSnapshot, validatedUser, details,
        reconciliationSummary, validationSummary, validationHistory,
        nextRendererErrors, nextValidationAlerts, nextCriticalErrors,
        nextDeviceHealthRollup, nextRooms, nextCustomers
      ] = await Promise.all([
        window.api.settings.getSystemHealth().catch((e) => ({ error: e.message })),
        window.api.settings.get().catch(() => null),
        window.api.auth.validateSession().catch(() => null),
        window.api.sync.getDetails().catch((e) => ({ error: e.message, pending: [], failed: [], faults: [], cacheFreshness: {} })),
        window.api.reports.financialReconciliation().catch((e) => ({ error: e.message, summary: {} })),
        window.api.reports.financialValidation().catch((e) => ({ error: e.message, totals: {} })),
        window.api.reports.financialValidationRuns(10).catch(() => []),
        window.api.app?.getRendererErrors?.(6).catch(() => []) || Promise.resolve([]),
        window.api.reports.financialValidationAlerts?.(8).catch(() => []) || Promise.resolve([]),
        window.api.reports.criticalErrors?.(8).catch(() => []) || Promise.resolve([]),
        window.api.sync.getDeviceHealthRollup().catch(() => ({ available: false, devices: [] })),
        window.api.rooms.getAll().catch(() => []),
        window.api.customers.getAll().catch(() => [])
      ])
      setHealth(systemHealth || null)
      setGlobalSettings(settingsSnapshot || null)
      setSessionUser(validatedUser || null)
      const nextPending = Array.isArray(details?.pending) ? details.pending : []
      pendingCountRef.current = nextPending.length
      setSyncDetails({
        pending:        nextPending,
        failed:         Array.isArray(details?.failed) ? details.failed : [],
        faults:         Array.isArray(details?.faults) ? details.faults : [],
        cacheFreshness: details?.cacheFreshness && typeof details.cacheFreshness === 'object' ? details.cacheFreshness : {},
        cacheStale:     details?.cacheStale || { active: false, names: [] },
        syncMeta:       details?.syncMeta || {},
        syncInProgress: details?.syncInProgress || false,
        replayAuthReady: details?.replayAuthReady !== false,
        financialPendingBookingIds: Array.isArray(details?.financialPendingBookingIds) ? details.financialPendingBookingIds : [],
        financialFailedBookingIds:  Array.isArray(details?.financialFailedBookingIds)  ? details.financialFailedBookingIds  : [],
        unresolvedLocal: details?.unresolvedLocal || null,
        error: details?.error || ''
      })
      setReconciliation(reconciliationSummary || null)
      setValidation(validationSummary || null)
      setValidationRuns(Array.isArray(validationHistory) ? validationHistory : [])
      setRendererErrors(Array.isArray(nextRendererErrors) ? nextRendererErrors : [])
      setValidationAlerts(Array.isArray(nextValidationAlerts) ? nextValidationAlerts : [])
      setCriticalErrors(Array.isArray(nextCriticalErrors) ? nextCriticalErrors : [])
      setDeviceHealthRollup(nextDeviceHealthRollup || { available: false, devices: [] })
      setRooms(Array.isArray(nextRooms) ? nextRooms : [])
      setCustomers(Array.isArray(nextCustomers) ? nextCustomers : [])
    } catch (error) {
      pushFlash('error', error?.message || 'Could not refresh system health.')
    } finally {
      setLoading(false)
    }
  }

  // Initial load + subscribe to real-time sync status events so the panel
  // auto-refreshes whenever the background sync loop emits a status change
  // (this mirrors what App.jsx, Layout.jsx, and POS.jsx already do).
  useEffect(() => {
    load()

    if (!window.api?.sync?.onStatusChanged) return
    const unsubscribe = window.api.sync.onStatusChanged(() => {
      // A status-changed event fires when sync starts, processes an item, or
      // finishes. Reload the full health snapshot so all counters stay current.
      load()
    })
    return () => unsubscribe?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pushFlash = (type, text) => {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 4000)
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  const runSyncNow = async () => {
    setActionBusy('run-sync')
    try {
      const result = await window.api.sync.runNow().catch((e) => ({ success: false, error: e.message }))
      if (result?.success === false) {
        pushFlash('error', result.error || 'Could not run sync right now.')
        return
      }
      pushFlash('success', 'Sync running… status will update automatically.')
      // runNow() fires the sync asynchronously — poll until items drain or
      // sync finishes (up to ~15 s). The onStatusChanged subscription above
      // will also update the panel reactively while we poll here.
      const previousPending = pendingCountRef.current
      const pollIntervalMs = 1500
      const maxAttempts = 10 // 10 × 1.5 s = 15 s max
      let attempts = 0
      const poll = async () => {
        if (attempts >= maxAttempts) return
        attempts++
        await load()
        const currentPending = pendingCountRef.current
        // Stop polling once pending items have drained or count changed meaningfully
        if (currentPending < previousPending || currentPending === 0) return
        await new Promise((res) => setTimeout(res, pollIntervalMs))
        await poll()
      }
      // Wait a short moment before first poll so the sync engine can start
      await new Promise((res) => setTimeout(res, 800))
      await poll()
    } finally {
      setActionBusy('')
    }
  }

  const retryFailed = async () => {
    setActionBusy('retry')
    try {
      const result = await window.api.sync.retryFailed().catch((e) => ({ success: false, error: e.message }))
      if (result?.success === false) {
        pushFlash('error', result.error || 'Could not retry failed sync items.')
        return
      }
      pushFlash('success', `Moved ${result.retried || 0} failed item(s) back into the sync queue.`)
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const retryFailedItem = async (queueId) => {
    if (!queueId) return
    setActionBusy(`retry:${queueId}`)
    try {
      const result = await window.api.sync.retryFailed([queueId]).catch((e) => ({ success: false, error: e.message }))
      if (result?.success === false) {
        pushFlash('error', result.error || 'Could not retry this failed sync item.')
        return
      }
      pushFlash('success', 'Moved that failed item back into the sync queue.')
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const clearFailed = async () => {
    setActionBusy('clear')
    try {
      const result = await window.api.sync.clearFailed().catch((e) => ({ success: false, error: e.message }))
      if (result?.success === false) {
        pushFlash('error', result.error || 'Could not clear failed sync items.')
        return
      }
      const alertCount = Number(result.integrityAlertsRecorded || 0)
      const msg = alertCount > 0
        ? `Cleared ${result.removed || 0} item(s). Warning: ${alertCount} integrity alert(s) were recorded because remote persistence is still unconfirmed.`
        : `Cleared ${result.removed || 0} failed item(s).`
      pushFlash(alertCount > 0 ? 'error' : 'success', msg)
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const dismissFault = async (faultId) => {
    setActionBusy(`fault:${faultId}`)
    try {
      await window.api.sync.clearHealthFault(faultId).catch(() => null)
      setSyncDetails((prev) => ({
        ...prev,
        faults: (prev.faults || []).filter((f) => f.id !== faultId)
      }))
    } finally {
      setActionBusy('')
    }
  }

  const runValidationNow = async () => {
    setActionBusy('validation')
    try {
      const result = await window.api.reports.runFinancialValidation().catch((e) => ({ success: false, error: e.message }))
      if (result?.success === false) {
        pushFlash('error', result.error || 'Could not run financial validation right now.')
        return
      }
      pushFlash('success', 'Financial validation snapshot recorded.')
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const exportSupportBundle = async () => {
    setActionBusy('support-bundle')
    try {
      const result = await window.api.reports.saveSupportBundle?.(25).catch((e) => ({ success: false, error: e.message }))
      if (!result?.success) {
        pushFlash('error', result?.error || 'Could not export a support bundle right now.')
        return
      }
      pushFlash('success', `Support bundle saved to ${result.filePath}`)
    } finally {
      setActionBusy('')
    }
  }

  const clearErrorHistory = async () => {
    setActionBusy('clear-errors')
    try {
      const [criticalResult, rendererResult] = await Promise.all([
        window.api.reports.clearCriticalErrors?.().catch((e) => ({ success: false, error: e.message })) || Promise.resolve({ success: true }),
        window.api.app?.clearRendererErrors?.().catch((e) => ({ success: false, error: e.message })) || Promise.resolve({ success: true })
      ])
      if (criticalResult?.success === false || rendererResult?.success === false) {
        pushFlash('error', 'Could not clear all error history.')
        return
      }
      setCriticalErrors([])
      setRendererErrors([])
      pushFlash('success', 'Critical and screen error history cleared.')
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const sendReportToCommandCentral = async () => {
    setActionBusy('send-report')
    try {
      const issues = []
      if (failedCount > 0) issues.push(`${failedCount} sync item${failedCount === 1 ? '' : 's'} failed and need review`)
      if (pendingCount > 0) issues.push(`${pendingCount} item${pendingCount === 1 ? '' : 's'} are still waiting to sync`)
      if (cacheStale) issues.push('fresh server data is still catching up after a refresh problem')
      if (!financeRpcOk) issues.push('the finance contract check needs attention')
      if (!contractAllOk) issues.push('one or more replay-critical RPCs are missing')
      if (financeMismatchCount > 0) issues.push(`${financeMismatchCount} finance mismatch${financeMismatchCount === 1 ? '' : 'es'} were detected`)
      if (invoiceGapCount > 0) issues.push(`${invoiceGapCount} invoice issue${invoiceGapCount === 1 ? '' : 's'} were detected`)
      if (validationAlerts.length > 0) issues.push(`${validationAlerts.length} recent validation alert${validationAlerts.length === 1 ? '' : 's'} were logged`)
      if (criticalErrors.length > 0) issues.push(`${criticalErrors.length} recent critical app error${criticalErrors.length === 1 ? '' : 's'} were logged`)
      if (rendererErrors.length > 0) issues.push(`${rendererErrors.length} recent screen/app error${rendererErrors.length === 1 ? '' : 's'}`)
      if (!diagnosticsOk) issues.push('profile diagnostics need review')
      if (faults.length > 0) issues.push(`${faults.length} system integrity fault${faults.length === 1 ? '' : 's'} recorded`)
      if (financialFailedCount > 0) issues.push(`${financialFailedCount} financial operation(s) dead-lettered`)
      if (reconciliationLocalOnly) issues.push('financial reconciliation could not be verified (offline at time of check)')

      const plainLanguageSummary = issues.length > 0
        ? issues.map((issue) => `- ${issue}`).join('\n')
        : '- Staff requested a review of system health even though no current issues were detected.'

      const description = [
        'A staff member asked Command Central to review this lodge health report.',
        '',
        'Plain-language summary:',
        plainLanguageSummary,
        '',
        'Quick counts:',
        `- Failed sync items: ${failedCount}`,
        `- Pending sync items: ${pendingCount}`,
        `- Financial failed: ${financialFailedCount}`,
        `- Finance mismatches: ${financeMismatchCount}`,
        `- Invoice issues: ${invoiceGapCount}`,
        `- Health faults: ${faults.length}`,
        `- Validation alerts: ${validationAlerts.length}`,
        `- Critical app errors: ${criticalErrors.length}`,
        `- Renderer errors: ${rendererErrors.length}`,
        '',
        `Reporter: ${sessionUser?.name || sessionUser?.email || 'Unknown user'}`,
        `Lodge: ${globalSettings?.lodge_name || health?.lodge_name || 'Unknown'}`,
        `Lodge ID: ${globalSettings?.lodge_id || health?.lodge_id || 'Unknown'}`,
      ].join('\n')

      await window.api.admin.createSupportTicket({
        lodge_id: globalSettings?.lodge_id || health?.lodge_id || 'unknown',
        lodge_name: globalSettings?.lodge_name || health?.lodge_name || '',
        title: `System Health Review Request${criticalErrors.length > 0 || faults.length > 0 || failedCount > 0 ? ' - Issues Detected' : ''}`,
        description,
        category: 'Technical Support',
        priority: criticalErrors.length > 0 || faults.length > 0 || financialFailedCount > 0 ? 'High' : failedCount > 0 ? 'Normal' : 'Low'
      })
      pushFlash('success', 'System health report sent to Command Central.')
    } catch (error) {
      pushFlash('error', error?.message || 'Could not send the system health report right now.')
    } finally {
      setActionBusy('')
    }
  }

  // ─── Derived state ───────────────────────────────────────────────────────────

  const financeRpcOk       = health?.finance?.payments_rpc?.ok
  const contractAllOk      = health?.finance?.contract?.allOk !== false && health?.finance?.contract?.ok !== false
  const contractProbes     = health?.finance?.contract?.probes || {}
  const diagnosticsOk      = !health?.diagnostics?.error
  const cacheStale         = syncDetails?.cacheStale?.active === true
  const pendingCount       = Number(syncDetails?.pending?.length || health?.sync?.pending || 0)
  const failedCount        = Number(syncDetails?.failed?.length || health?.sync?.failed || 0)
  const faults             = syncDetails?.faults || []
  const blockingFaults     = faults.filter((f) => ['queue_corrupt', 'cache_corrupt'].includes(f.type))
  const manualReviewFaults = faults.filter((f) => ['financial_dead_letter_cleared', 'ghost_update'].includes(f.type))
  const driftFaults        = faults.filter((f) => ['booking_drift', 'quotation_drift', 'pos_drift', 'customer_drift', 'room_drift'].includes(f.type))
  const infoFaults         = faults.filter((f) => !blockingFaults.includes(f) && !manualReviewFaults.includes(f) && !driftFaults.includes(f))
  const manualClearFaults  = faults.filter((f) => ['financial_dead_letter_cleared', 'dead_letter_cleared'].includes(f.type))
  const ghostFaults        = faults.filter((f) => f.type === 'ghost_update')
  const convergenceFaults  = faults.filter((f) => ['booking_drift', 'quotation_drift', 'pos_drift', 'ghost_update'].includes(f.type))
  const integrityRiskFaults = faults.filter((f) => ['financial_dead_letter_cleared', 'dead_letter_cleared', 'ghost_update', 'booking_drift', 'quotation_drift', 'pos_drift'].includes(f.type))
  const unresolvedLocal    = syncDetails?.unresolvedLocal || null
  const syncMeta           = syncDetails?.syncMeta || {}
  const syncRunning        = syncDetails?.syncInProgress === true || health?.sync?.syncInProgress === true
  const replayAuthReady    = syncDetails?.replayAuthReady !== false
  const lastSyncAt         = syncDetails?.syncMeta?.lastSyncFinishedAt || health?.sync?.lastSuccessfulSyncAt || null
  const lastSyncOutcome    = syncMeta?.lastSyncOutcome || null
  const lastSyncError      = syncMeta?.lastSyncError || ''
  const syncState          = syncRunning ? 'Syncing' : failedCount > 0 ? 'Failed' : 'Idle'
  const cacheFreshness     = syncDetails?.cacheFreshness || {}
  const staleCaches        = Object.entries(cacheFreshness).filter(([, m]) => m.stale).map(([k]) => k)
  const needsAttention     = failedCount > 0 || pendingCount > 0 || cacheStale || blockingFaults.length > 0 || integrityRiskFaults.length > 0 || lastSyncOutcome === 'partial' || lastSyncOutcome === 'failed'
  const reconciliationSummary   = reconciliation?.summary || {}
  const reconciliationLocalOnly = reconciliation?.local_only === true || reconciliation?.valid === false
  const reconciliationValid     = reconciliation?.valid === true
  const validationTotals        = validation?.totals || {}
  const financeMismatchCount    = Number(reconciliationSummary.paymentMismatches || 0) + Number(reconciliationSummary.chargeMismatches || 0)
  const invoiceGapCount         = Number(reconciliationSummary.invoiceGaps || 0) + Number(reconciliationSummary.orphanInvoices || 0)
  const financialFailedBookingIds  = syncDetails?.financialFailedBookingIds  || []
  const financialPendingBookingIds = syncDetails?.financialPendingBookingIds || []
  const financialFailedCount    = financialFailedBookingIds.length
  const financialPendingCount   = financialPendingBookingIds.length
  const localStateAcknowledged = unresolvedLocal?.total === 0 && health?.online === true && replayAuthReady && pendingCount === 0

  const getFailedItemBookingId = (item) => (
    item?.data?.p_booking_id || item?.data?.payload?.id || item?.data?.payload?.booking_id || item?.data?.p_id || null
  )

  /**
   * Returns domain-aware action metadata (label, route, state) for a sync queue item or fault.
   * This ensures POS failures lead to POS, and Booking failures lead to Bookings.
   */
  const getSyncItemAction = (item) => {
    // POS Orders
    if (item.table === 'create_pos_order' || item.scope === 'pos' || item.type?.startsWith('pos_')) {
      return {
        label: 'Review POS Order',
        route: '/pos',
        state: { tab: 'history' }
      }
    }

    // Booking Payments
    if (item.table === 'update_booking_payment') {
      const bid = getFailedItemBookingId(item)
      return bid ? {
        label: 'Collect Payment',
        route: '/bookings',
        state: { collectPaymentBookingId: bid }
      } : null
    }

    // Generic Bookings
    const bookingId = getFailedItemBookingId(item) || (item.context && item.context.booking_id) || (typeof item.scope === 'string' && item.scope.startsWith('booking:') ? item.scope.slice(8) : null)
    if (bookingId) {
      return {
        label: 'Review Booking',
        route: '/bookings',
        state: { reviewBookingId: bookingId }
      }
    }

    return null
  }

  const getFaultBookingId = (fault) => {
    if (fault?.context?.booking_id) return fault.context.booking_id
    if (typeof fault?.scope === 'string' && fault.scope.startsWith('booking:')) {
      return fault.scope.slice('booking:'.length) || null
    }
    return null
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">System Health</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sync recency, finance RPC readiness, reconciliation, backup availability, and profile diagnostics.
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              This device only — does not reflect PWA/browser queue state
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button type="button" onClick={runSyncNow} disabled={actionBusy === 'run-sync'}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-60">
            <Play size={14} />
            {actionBusy === 'run-sync' ? 'Running…' : 'Run Sync Now'}
          </button>
          <button type="button" onClick={exportSupportBundle} disabled={actionBusy === 'support-bundle'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            <Download size={14} />
            {actionBusy === 'support-bundle' ? 'Saving…' : 'Export Bundle'}
          </button>
          <button type="button" onClick={sendReportToCommandCentral} disabled={actionBusy === 'send-report'}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60">
            <ShieldCheck size={14} />
            {actionBusy === 'send-report' ? 'Sending…' : 'Send To Command Central'}
          </button>
          <button type="button" onClick={clearErrorHistory} disabled={actionBusy === 'clear-errors'}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-60">
            <Trash2 size={14} />
            {actionBusy === 'clear-errors' ? 'Clearing…' : 'Clear Error History'}
          </button>
        </div>
      </div>

      {/* Flash */}
      {flash && (
        <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${flash.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {flash.text}
        </div>
      )}

      {/* P0-4: Blocking fault alerts */}
      {blockingFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <XCircle size={18} className="mt-0.5 shrink-0 text-red-700" />
              <div>
                <p className="text-sm font-bold text-red-900">
                  {fault.type === 'queue_corrupt' ? 'Sync Queue Corruption Detected' : 'Cache Corruption Detected'}
                </p>
                <p className="mt-1 text-sm text-red-800/80">{fault.message}</p>
                <p className="mt-1 text-xs text-red-700/70">{formatTs(fault.at)}</p>
              </div>
            </div>
            <button type="button" onClick={() => dismissFault(fault.id)}
              disabled={actionBusy === `fault:${fault.id}`}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60">
              {actionBusy === `fault:${fault.id}` ? '…' : 'Dismiss'}
            </button>
          </div>
        </div>
      ))}

      {/* Convergence Drift alerts (booking_drift, quotation_drift, pos_drift) */}
      {driftFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Convergence Drift</p>
                <p className="text-sm font-bold text-amber-900">
                  {fault.type === 'quotation_drift' ? 'Post-Sync Quotation Drift Detected'
                    : fault.type === 'pos_drift' ? 'Post-Sync POS Order Drift Detected'
                    : 'Post-Sync Booking Drift Detected'}
                </p>
                <p className="mt-1 text-sm text-amber-800/80">{fault.message}</p>
                <p className="mt-1 text-xs text-amber-700/70">{formatTs(fault.at)}</p>
              </div>
            </div>
            <button type="button" onClick={() => dismissFault(fault.id)}
              disabled={actionBusy === `fault:${fault.id}`}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-50 disabled:opacity-60">
              {actionBusy === `fault:${fault.id}` ? '…' : 'Dismiss'}
            </button>
          </div>
        </div>
      ))}

      {ghostFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-rose-300 bg-rose-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-700" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-0.5">Manual Review Required</p>
                <p className="text-sm font-bold text-rose-900">Server Mismatch Detected During Replay</p>
                <p className="mt-1 text-sm text-rose-800/80">{fault.message}</p>
                <p className="mt-1 text-xs text-rose-700/70">{formatTs(fault.at)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {getSyncItemAction(fault) && (
                <button type="button"
                  onClick={() => {
                    const action = getSyncItemAction(fault)
                    navigate(action.route, { state: action.state })
                  }}
                  className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-50">
                  {getSyncItemAction(fault).label}
                </button>
              )}
              <button type="button" onClick={() => dismissFault(fault.id)}
                disabled={actionBusy === `fault:${fault.id}`}
                className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-50 disabled:opacity-60">
                {actionBusy === `fault:${fault.id}` ? '…' : 'Dismiss'}
              </button>
            </div>
          </div>
        </div>
      ))}

      {manualClearFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-0.5">Manual Review Required</p>
                <p className="text-sm font-bold text-red-900">Manual Clear Left Integrity Unproven</p>
                <p className="mt-1 text-sm text-red-800/80">{fault.message}</p>
                <p className="mt-1 text-xs text-red-700/70">{formatTs(fault.at)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {getSyncItemAction(fault) && (
                <button type="button"
                  onClick={() => {
                    const action = getSyncItemAction(fault)
                    navigate(action.route, { state: action.state })
                  }}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50">
                  {getSyncItemAction(fault).label}
                </button>
              )}
              <button type="button" onClick={() => dismissFault(fault.id)}
                disabled={actionBusy === `fault:${fault.id}`}
                className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60">
                {actionBusy === `fault:${fault.id}` ? '…' : 'Dismiss'}
              </button>
            </div>
          </div>
        </div>
      ))}


      {/* Info faults (muted/gray) */}
      {infoFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Info size={16} className="mt-0.5 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-700">{fault.message || fault.type}</p>
                <p className="mt-0.5 text-xs text-slate-500">{fault.type} · {fault.scope} · {formatTs(fault.at)}</p>
              </div>
            </div>
            <button type="button" onClick={() => dismissFault(fault.id)}
              disabled={actionBusy === `fault:${fault.id}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60">
              {actionBusy === `fault:${fault.id}` ? '…' : 'Dismiss'}
            </button>
          </div>
        </div>
      ))}

      {/* Unresolved Local State card */}
      {unresolvedLocal && (
        <div className={`rounded-2xl border px-5 py-4 ${localStateAcknowledged ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <Database size={16} className={`mt-0.5 shrink-0 ${localStateAcknowledged ? 'text-slate-400' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${localStateAcknowledged ? 'text-slate-600' : 'text-amber-900'}`}>
                {unresolvedLocal.total > 0
                  ? `Unresolved Local State (${unresolvedLocal.total} record${unresolvedLocal.total === 1 ? '' : 's'})`
                  : localStateAcknowledged
                    ? 'All local state acknowledged'
                    : 'Local state acknowledgement not yet proven'}
              </p>
              {unresolvedLocal.total > 0 && (
                <div className="mt-2 space-y-1">
                  {[
                    { key: 'bookings', label: 'Bookings' },
                    { key: 'customers', label: 'Customers' },
                    { key: 'rooms', label: 'Rooms' },
                    { key: 'users', label: 'Users' },
                    { key: 'quotations', label: 'Quotations' },
                    { key: 'posOrders', label: 'POS Orders' }
                  ].filter(({ key }) => (unresolvedLocal[key]?.count ?? 0) > 0).map(({ key, label }) => (
                    <div key={key} className="text-xs text-amber-800">
                      <span className="font-medium">{label}:</span> {unresolvedLocal[key].count} unresolved
                      {unresolvedLocal[key].ids?.length > 0 && (
                        <span className="ml-1 text-amber-700/70">({unresolvedLocal[key].ids.slice(0, 3).map(id => String(id).slice(0, 8)).join(', ')}{unresolvedLocal[key].ids.length > 3 ? '…' : ''})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {unresolvedLocal.total === 0 && !localStateAcknowledged && (
                <p className="mt-1 text-xs text-amber-800/80">
                  Queue is not yet in a state where this device can prove local changes are fully acknowledged remotely.
                  {!health?.online && ' App is offline.'}
                  {health?.online && !replayAuthReady && ' Replay is paused until an authenticated session is restored.'}
                  {pendingCount > 0 && ' Pending queue items still exist.'}
                </p>
              )}
              {localStateAcknowledged && (
                <p className="mt-0.5 text-xs text-slate-500">(this device only)</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* General attention banner */}
      {needsAttention && !blockingFaults.length && (
        <div className={`rounded-2xl px-5 py-4 shadow-sm ${failedCount > 0 ? 'border border-red-200 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${failedCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
                {failedCount > 0
                  ? 'Some operations need manual review before staff can trust the latest data.'
                  : manualClearFaults.length > 0
                    ? 'Some failed items were cleared manually, so remote persistence is still unproven.'
                    : ghostFaults.length > 0
                      ? 'Replay found server/local mismatch that needs review before the data can be trusted.'
                      : convergenceFaults.length > 0
                        ? 'Replay completed, but the refreshed server state differs from prior local assumptions.'
                  : cacheStale
                    ? 'Fresh data is still retrying after a refresh failure.'
                    : 'The app is still syncing local work to the server.'}
              </p>
              <p className={`mt-1 text-sm ${failedCount > 0 ? 'text-red-800/80' : 'text-amber-800/80'}`}>
                {failedCount > 0 && `${failedCount} failed item${failedCount === 1 ? '' : 's'} parked for review. `}
                {manualClearFaults.length > 0 && `${manualClearFaults.length} manually-cleared item${manualClearFaults.length === 1 ? '' : 's'} still require verification. `}
                {ghostFaults.length > 0 && `${ghostFaults.length} replay mismatch alert${ghostFaults.length === 1 ? '' : 's'} detected. `}
                {convergenceFaults.length > 0 && !ghostFaults.length && `${convergenceFaults.length} convergence alert${convergenceFaults.length === 1 ? '' : 's'} logged. `}
                {pendingCount > 0 && `${pendingCount} pending item${pendingCount === 1 ? '' : 's'} still syncing. `}
                {cacheStale && `${syncDetails?.cacheStale?.names?.join(', ') || 'Booking'} data may still be catching up.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {failedCount > 0 && (
                <button type="button" onClick={retryFailed} disabled={actionBusy === 'retry'}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60">
                  <RotateCcw size={13} />
                  {actionBusy === 'retry' ? 'Retrying…' : 'Retry Failed Items'}
                </button>
              )}
              <button type="button" onClick={load} disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Refresh Health
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P0-2: Sync-in-progress banner */}
      {syncRunning && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="animate-spin text-blue-600" />
            <p className="text-sm font-semibold text-blue-900">
              Sync replay is currently running — queue is draining. Counts will update when finished.
            </p>
          </div>
        </div>
      )}

      {/* P0-5: Auth not ready banner */}
      {!replayAuthReady && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <AlertCircle size={16} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-900">
              Queue replay is paused — no authenticated session detected. Log in to allow sync replay.
            </p>
          </div>
        </div>
      )}

      {/* P1-10: Financial sync risk banner */}
      {(financialFailedCount > 0 || financialPendingCount > 0) && (
        <div className={`rounded-2xl px-5 py-4 shadow-sm ${financialFailedCount > 0 ? 'border border-red-300 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
          <p className={`text-sm font-bold ${financialFailedCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
            Financial Sync Risk
          </p>
          {financialFailedCount > 0 && (
            <p className="mt-1 text-sm text-red-800/80">
              {financialFailedCount} financial operation{financialFailedCount === 1 ? '' : 's'} are dead-lettered.
              The affected booking balances may be incorrect until resolved.
            </p>
          )}
          {financialPendingCount > 0 && (
            <p className="mt-1 text-sm text-amber-800/80">
              {financialPendingCount} financial operation{financialPendingCount === 1 ? '' : 's'} are pending sync.
              Balances shown in the app may not yet reflect server truth.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {financialFailedBookingIds.slice(0, 6).map((id) => (
              <button key={id} type="button"
                onClick={() => navigate('/bookings', { state: { reviewBookingId: id } })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-50">
                Open booking {String(id).slice(0, 8)}…
              </button>
            ))}
            {financialPendingBookingIds.slice(0, 4).map((id) => (
              <button key={id} type="button"
                onClick={() => navigate('/bookings', { state: { reviewBookingId: id } })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-50">
                Pending: {String(id).slice(0, 8)}…
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top stat cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Connectivity + sync recency */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200" data-testid="system-health-sync-card">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Wifi size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Sync Status</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{syncState}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Pending</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{pendingCount}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Failed</p>
              <p className={`mt-1 text-lg font-bold ${failedCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>{failedCount}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            {syncRunning
              ? 'Sync is running now.'
              : pendingCount > 0
                ? 'Pending items are waiting to be sent.'
                : 'No sync activity is running right now.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Last successful sync: {lastSyncAt ? formatTs(lastSyncAt) : 'No successful sync recorded yet'}
          </p>
          {lastSyncError && (
            <p className="mt-1 text-xs text-red-600">{lastSyncError}</p>
          )}
        </div>

        {/* Finance contract */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200" data-testid="system-health-failed-queue">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><ShieldCheck size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Finance Contract</p>
              <p className={`mt-1 text-lg font-bold ${financeRpcOk && contractAllOk ? 'text-gray-900' : 'text-red-700'}`}>
                {financeRpcOk && contractAllOk ? 'All RPCs Ready' : 'RPC Unavailable'}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">{health?.finance?.payments_rpc?.message || 'Not checked yet.'}</p>
          {!contractAllOk && health?.finance?.contract?.message && (
            <p className="mt-1 text-xs text-red-700">{health.finance.contract.message}</p>
          )}
        </div>

        {/* Failed sync */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-2 text-amber-600"><AlertTriangle size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Failed Sync Queue</p>
              <p className={`mt-1 text-lg font-bold ${failedCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>{failedCount}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Review items that could not sync and check the reason shown below.</p>
          {financialFailedCount > 0 && (
            <p className="mt-1 text-xs font-semibold text-red-700">{financialFailedCount} financial operation{financialFailedCount === 1 ? '' : 's'} affected</p>
          )}
        </div>

        {/* Reconciliation */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-rose-50 p-2 text-rose-600"><Database size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Reconciliation</p>
              {reconciliationLocalOnly ? (
                <p className="mt-1 text-lg font-bold text-amber-600">Not Verified</p>
              ) : (
                <p className="mt-1 text-lg font-bold text-gray-900">{financeMismatchCount + invoiceGapCount}</p>
              )}
            </div>
          </div>
          {reconciliationLocalOnly ? (
            <p className="mt-3 text-xs font-semibold text-amber-700">Cannot verify — offline at time of check. Run again when connected.</p>
          ) : (
            <p className="mt-3 text-sm text-gray-500">Booking, payment, folio, and invoice mismatches.</p>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">

        {/* Left column */}
        <div className="space-y-6">

          {/* Sync Recovery */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Sync Recovery</h3>
                <p className="mt-1 text-xs text-gray-500">Operations that failed repeated sync attempts. See the reason under each item, then retry or open the booking to resolve.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={retryFailed} disabled={actionBusy === 'retry' || !syncDetails?.failed?.length}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60">
                  <RotateCcw size={13} />
                  {actionBusy === 'retry' ? 'Retrying…' : 'Retry All Failed'}
                </button>
                <button type="button" onClick={clearFailed} disabled={actionBusy === 'clear' || !syncDetails?.failed?.length}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60">
                  {actionBusy === 'clear' ? 'Clearing…' : 'Clear Failed'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {!syncDetails?.failed?.length ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                  No failed sync items right now.
                </div>
              ) : (
                syncDetails.failed.slice(0, 8).map((item) => {
                  const isFinancial = item.isFinancial
                  const isAutoRetryable = item.isAutoRetryable !== false
                  const retryLabel = isAutoRetryable
                    ? item.autoRetryEligible
                      ? 'Auto-retry eligible now'
                      : item.nextAutoRetryAt
                        ? `Auto-retry at ${formatTs(item.nextAutoRetryAt)}`
                        : 'Auto-retry armed'
                    : 'Manual retry required'
                  return (
                    <div
                      key={item._queue_id}
                      className={`rounded-xl border p-4 ${isFinancial ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}
                      data-testid="system-health-failed-item"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusPill ok={false} label={(item.type || 'op').toUpperCase()} />
                          <span className="text-sm font-semibold text-gray-900">{syncOpLabel(item.table)}</span>
                          {isFinancial && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Financial</span>}
                        </div>
                        <span className="text-xs text-gray-400">
                          {item.lastAttemptedAt ? formatTs(item.lastAttemptedAt) : 'Not attempted recently'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-red-700">{sanitizeForOperator(item.lastError)}</p>
                      {/* P1-11: retry classification */}
                      <p className={`mt-1 text-xs font-medium ${isAutoRetryable ? 'text-blue-600' : 'text-amber-700'}`}>
                        {retryLabel}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-500">Queue ID: {item._queue_id || '—'}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {getSyncItemAction(item) && (
                            <button type="button"
                              onClick={() => {
                                const action = getSyncItemAction(item)
                                navigate(action.route, { state: action.state })
                              }}
                              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50">
                              {getSyncItemAction(item).label}
                            </button>
                          )}
                          <button type="button" onClick={() => retryFailedItem(item._queue_id)}
                            disabled={actionBusy === `retry:${item._queue_id}`}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60">
                            <RotateCcw size={12} />
                            {actionBusy === `retry:${item._queue_id}` ? 'Retrying…' : 'Retry This Item'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Pending queue */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200" data-testid="system-health-pending-queue">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Pending Sync Queue</h3>
                <p className="mt-1 text-xs text-gray-500">Local operations still waiting to reach the server.</p>
              </div>
              <StatusPill ok={pendingCount === 0} label={pendingCount === 0 ? 'Clear' : `${pendingCount} pending`} warn={pendingCount > 0 && failedCount === 0} />
            </div>
            <div className="mt-4 space-y-3">
              {!syncDetails?.pending?.length ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No pending sync items right now.
                </div>
              ) : (
                syncDetails.pending.slice(0, 6).map((item) => (
                  <div key={item._queue_id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" data-testid="system-health-pending-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusPill ok={false} label={(item.type || 'op').toUpperCase()} warn />
                        <span className="text-sm font-semibold text-gray-900">{syncOpLabel(item.table)}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {item.createdAt ? formatTs(item.createdAt) : 'Queued locally'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-1 font-semibold ${item.isFinancial ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                        {item.isFinancial ? 'Financial' : 'Operational'}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                        Dependency: {item.dependencyState || 'unknown'}
                      </span>
                      {item._depends_on && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                          Waits on {item._depends_on}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* P0-4: Non-blocking faults */}
          {faults.filter((f) => !['queue_corrupt', 'cache_corrupt'].includes(f.type)).length > 0 && (
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Integrity Alerts</h3>
                  <p className="mt-1 text-xs text-gray-500">Structural issues detected and logged during operation.</p>
                </div>
                <StatusPill ok={false} label={`${faults.length} logged`} />
              </div>
              <div className="mt-4 space-y-3">
                {faults.filter((f) => !['queue_corrupt', 'cache_corrupt'].includes(f.type)).slice(0, 8).map((fault) => {
                  const isHighRisk = ['financial_dead_letter_cleared', 'ghost_update'].includes(fault.type) || fault.severity === 'error'
                  const bookingId = getFaultBookingId(fault)
                  return (
                  <div key={fault.id} className={`rounded-xl px-4 py-3 ${isHighRisk ? 'border border-red-200 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`text-sm font-semibold ${isHighRisk ? 'text-red-900' : 'text-amber-900'}`}>{fault.type?.replace(/_/g, ' ')}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${isHighRisk ? 'text-red-700/80' : 'text-amber-700/80'}`}>{formatTs(fault.at)}</span>
                        {getSyncItemAction(fault) && (
                          <button type="button"
                            onClick={() => {
                              const action = getSyncItemAction(fault)
                              navigate(action.route, { state: action.state })
                            }}
                            className={`rounded border bg-white px-2 py-0.5 text-[11px] font-medium ${isHighRisk ? 'border-red-300 text-red-800 hover:bg-red-50' : 'border-amber-300 text-amber-800 hover:bg-amber-50'}`}>
                            {getSyncItemAction(fault).label}
                          </button>
                        )}
                        <button type="button" onClick={() => dismissFault(fault.id)}
                          disabled={actionBusy === `fault:${fault.id}`}
                          className={`rounded border bg-white px-2 py-0.5 text-[11px] font-medium ${isHighRisk ? 'border-red-300 text-red-800 hover:bg-red-50' : 'border-amber-300 text-amber-800 hover:bg-amber-50'}`}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <p className={`mt-1 text-sm ${isHighRisk ? 'text-red-800/80' : 'text-amber-800/80'}`}>{fault.message}</p>
                  </div>
                )})}
              </div>
            </div>
          )}

        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Sync metadata + contract */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h3 className="text-sm font-semibold text-gray-900" data-testid="system-health-sync-detail">Sync Status Detail</h3>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Last sync finished</span>
                <span className="font-medium text-gray-800 text-right">{formatTs(lastSyncAt) || 'Not recorded'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Last outcome</span>
                <StatusPill
                  ok={lastSyncOutcome === 'success' || lastSyncOutcome === 'empty'}
                  warn={lastSyncOutcome === 'partial'}
                  label={lastSyncOutcome || 'unknown'}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Replay auth ready</span>
                <StatusPill ok={replayAuthReady} label={replayAuthReady ? 'Yes' : 'Not yet'} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Sync in progress</span>
                <StatusPill ok={!syncRunning} warn={syncRunning} label={syncRunning ? 'Running' : 'Idle'} />
              </div>
              {lastSyncError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{lastSyncError}</p>
              )}
            </div>

            {/* P0-7: RPC contract probes */}
            {health?.finance?.contract && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-900">Replay RPC Contract</h4>
                  <StatusPill ok={contractAllOk} label={contractAllOk ? 'All Ready' : 'Missing RPCs'} />
                </div>
                {!contractAllOk && (
                  <p className="mt-2 text-xs text-red-700">{health.finance.contract.message}</p>
                )}
                <div className="mt-3 grid gap-1">
                  {Object.entries(contractProbes).map(([name, probe]) => (
                    <div key={name} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5">
                      <span className="text-xs font-mono text-gray-700">{name}</span>
                      <StatusPill ok={probe.ok} label={probe.ok ? 'OK' : 'Missing'} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* P1-9: Cache freshness */}
          {Object.keys(cacheFreshness).length > 0 && (
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Cache Freshness</h3>
                  <p className="mt-1 text-xs text-gray-500">Last time each local cache was refreshed from Supabase.</p>
                </div>
                {staleCaches.length > 0 && (
                  <StatusPill ok={false} warn label={`${staleCaches.length} stale`} />
                )}
              </div>
              <div className="mt-4 grid gap-1.5">
                {Object.entries(cacheFreshness).map(([name, meta]) => (
                  <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${meta.stale ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{name}</span>
                      {meta.source === 'remote' && (
                        <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">remote</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {meta.stale && <AlertTriangle size={12} className="text-amber-500" />}
                      <span className={`text-xs ${meta.stale ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>
                        {meta.updatedAt ? formatAge(meta.cacheAgeMs) : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financial reconciliation */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Financial Reconciliation</h3>
                <p className="mt-1 text-xs text-gray-500">Cross-check booking snapshots against payment, folio, and invoice data.</p>
              </div>
              {/* P0-3: never show green when offline */}
              {reconciliationLocalOnly ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  Cannot verify offline
                </span>
              ) : !reconciliationValid ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                  Not run yet
                </span>
              ) : (
                <StatusPill 
                  ok={financeMismatchCount + invoiceGapCount + Number(reconciliationSummary.pendingRefunds || 0) === 0} 
                  label={financeMismatchCount + invoiceGapCount + Number(reconciliationSummary.pendingRefunds || 0) === 0 ? 'Clear' : `${financeMismatchCount + invoiceGapCount + Number(reconciliationSummary.pendingRefunds || 0)} issues`} 
                />
              )}
            </div>

            {reconciliationLocalOnly ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                <div className="flex items-start gap-3">
                  <Info size={16} className="mt-0.5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Cannot verify financial agreement — offline</p>
                    <p className="mt-1 text-xs text-amber-800/80">
                      {reconciliation?.message || 'Reconciliation requires an internet connection. Connect and refresh to run a real check.'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    ['Payment mismatches', reconciliationSummary.paymentMismatches],
                    ['Charge mismatches', reconciliationSummary.chargeMismatches],
                    ['Invoice gaps', reconciliationSummary.invoiceGaps],
                    ['Orphan invoices', reconciliationSummary.orphanInvoices],
                    ['Pending Refunds', reconciliationSummary.pendingRefunds],
                  ].map(([label, val]) => (
                    <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{label}</p>
                      <p className={`mt-2 text-2xl font-bold ${Number(val) > 0 ? (label === 'Pending Refunds' ? 'text-amber-700' : 'text-red-700') : 'text-gray-900'}`}>{val || 0}</p>
                    </div>
                  ))}
                </div>
                {(reconciliation?.paymentMismatches || []).slice(0, 2).map((item) => (
                  <div key={`pay-${item.booking_id}`} className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="text-sm font-semibold text-rose-900">Payment mismatch · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                    <p className="mt-1 text-sm text-rose-800/80">Booking shows {Number(item.booking_amount_paid || 0).toFixed(2)} but payment ledger totals {Number(item.payment_ledger_total || 0).toFixed(2)}.</p>
                  </div>
                ))}
                {(reconciliation?.chargeMismatches || []).slice(0, 2).map((item) => (
                  <div key={`charge-${item.booking_id}`} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">Charge mismatch · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                    <p className="mt-1 text-sm text-amber-800/80">Booking shows {Number(item.booking_charges_total || 0).toFixed(2)} but active charges total {Number(item.charge_ledger_total || 0).toFixed(2)}.</p>
                  </div>
                ))}
                {(reconciliation?.pendingRefunds || []).slice(0, 3).map((item) => (
                  <div key={`refund-p-${item.id}`} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-amber-900">Pending Refund · {item.invoice_number}</p>
                      <span className="text-xs font-bold text-amber-700">{item.amount_to_refund.toFixed(2)}</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-800/80">Cancelled booking for {item.customer_name}. Balance needs to be returned to guest.</p>
                  </div>
                ))}
                {financeMismatchCount + invoiceGapCount + Number(reconciliationSummary.pendingRefunds || 0) === 0 && reconciliationValid && (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No reconciliation mismatches or pending refunds detected.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Validation snapshot */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Validation Snapshot</h3>
                <p className="mt-1 text-xs text-gray-500">Recent refund and charge-void activity surfaced for finance review.</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  ok={(validationTotals.recent_refunds || 0) + (validationTotals.recent_charge_voids || 0) === 0}
                  warn={(validationTotals.recent_refunds || 0) + (validationTotals.recent_charge_voids || 0) > 0}
                  label={`${validationTotals.recent_refunds || 0} refunds · ${validationTotals.recent_charge_voids || 0} voids`}
                />
                <button type="button" onClick={runValidationNow} disabled={actionBusy === 'validation'}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60">
                  <RefreshCw size={12} className={actionBusy === 'validation' ? 'animate-spin' : ''} />
                  {actionBusy === 'validation' ? 'Running…' : 'Run Now'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(validation?.recentRefunds || []).map((item, index) => (
                <div key={`refund-${item.booking_id || index}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">Refund recorded</p>
                  <p className="mt-1 text-sm text-gray-600">Booking {String(item.booking_id || '').slice(0, 8)} · {Number(item.amount_delta || 0).toFixed(2)} · {formatTs(item.created_at) || 'Time unknown'}</p>
                </div>
              ))}
              {(validation?.recentChargeVoids || []).map((item, index) => (
                <div key={`void-${item.booking_id || index}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">Charge voided</p>
                  <p className="mt-1 text-sm text-gray-600">Booking {String(item.booking_id || '').slice(0, 8)} · {Number(item.amount_delta || 0).toFixed(2)} · {item.reason || 'No reason recorded'}</p>
                </div>
              ))}
              {(validation?.recentRefunds || []).length === 0 && (validation?.recentChargeVoids || []).length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No recent refunds or charge voids in the sampled audit window.
                </div>
              )}
            </div>

            {/* Validation alerts */}
            <div className="mt-5 border-t border-gray-100 pt-4" data-testid="system-health-validation-alerts">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Validation Alerts</h4>
                <StatusPill ok={validationAlerts.length === 0} label={validationAlerts.length === 0 ? 'No alerts' : `${validationAlerts.length} logged`} />
              </div>
              <div className="mt-3 space-y-3">
                {validationAlerts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No recent validation alerts were logged.
                  </div>
                ) : (
                  validationAlerts.slice(0, 5).map((entry, index) => (
                    <div
                      key={`${entry.id || entry.detected_at || 'alert'}-${index}`}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                      data-testid="system-health-validation-alert"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-900">{entry.alert_type || entry.type || 'Validation alert'}</p>
                        <span className="text-xs text-amber-700/80">{formatTs(entry.detected_at) || 'Time unknown'}</span>
                      </div>
                      <p className="mt-1 text-sm text-amber-800/80">{entry.message || entry.summary || 'Validation alert captured for finance review.'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Validation run history */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Validation Run History</h4>
                <StatusPill ok={validationRuns.length > 0} warn={validationRuns.length === 0} label={validationRuns.length > 0 ? `${validationRuns.length} logged` : 'No runs yet'} />
              </div>
              <div className="mt-3 space-y-3">
                {validationRuns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No validation runs have been recorded yet.
                  </div>
                ) : (
                  validationRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {String(run.trigger_source || 'manual').replace(/_/g, ' ')} run
                        </p>
                        <span className="text-xs text-gray-400">{formatTs(run.created_at) || 'Time unknown'}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        Payment mismatches {Number(run.summary?.totals?.payment_mismatches || 0)} · Charge mismatches {Number(run.summary?.totals?.charge_mismatches || 0)} · Invoice gaps {Number(run.summary?.totals?.invoice_gaps || 0)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        By {run.triggered_by_name || 'System'}{run.local_only ? ' · local-only snapshot' : ''}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Critical error log */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Critical Error Log</h3>
                <p className="mt-1 text-xs text-gray-500">Operation-level failures recorded by the desktop app with support context.</p>
              </div>
              <StatusPill ok={criticalErrors.length === 0} label={criticalErrors.length === 0 ? 'Quiet' : `${criticalErrors.length} recent`} />
            </div>
            <div className="mt-4 space-y-3">
              {criticalErrors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No critical desktop errors were logged recently.
                </div>
              ) : (
                criticalErrors.map((entry, index) => {
                  const isFinancial = entry.scope?.toLowerCase().includes('financial') || entry.operation?.toLowerCase().includes('financial')
                  const isCritical = isFinancial || entry.severity === 'error' || entry.scope?.includes('db_init')
                  const tone = isCritical ? 'rose' : 'amber'
                  return (
                    <div key={`${entry.at || entry.operation || 'critical'}-${index}`} className={`rounded-xl border border-${tone}-200 bg-${tone}-50 px-4 py-3`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-semibold text-${tone}-900`}>{entry.scope || entry.operation || 'system'}</p>
                          {!isCritical && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Warning</span>}
                        </div>
                        <span className={`text-xs text-${tone}-700/80`}>{formatTs(entry.at) || 'Time unknown'}</span>
                      </div>
                      <p className={`mt-1 text-sm text-${tone}-800/80`}>{entry.message || 'No message recorded.'}</p>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <details className={`mt-2 text-xs text-${tone}-800/80`}>
                          <summary className={`cursor-pointer font-medium text-${tone}-900`}>Show details</summary>
                          <HumanContext details={entry.details} rooms={rooms} customers={customers} />
                        </details>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Recent app errors */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Recent App Errors</h3>
                <p className="mt-1 text-xs text-gray-500">Renderer crash context for when the recovery screen appears.</p>
              </div>
              <StatusPill ok={rendererErrors.length === 0} label={rendererErrors.length === 0 ? 'No recent crashes' : `${rendererErrors.length} logged`} />
            </div>
            <div className="mt-4 space-y-3">
              {rendererErrors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No recent renderer crashes were logged on this machine.
                </div>
              ) : (
                rendererErrors.map((entry, index) => (
                  <div key={`${entry.at || 'crash'}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{entry.message || 'Unknown renderer error'}</p>
                      <span className="text-xs text-gray-400">{formatTs(entry.at) || 'Not recorded'}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Route: {entry.route || 'Unknown route'}</p>
                    {entry.componentStack && (
                      <details className="mt-2 text-xs text-gray-600">
                        <summary className="cursor-pointer font-medium text-gray-700">Show component stack</summary>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-[11px] leading-5 text-gray-600 ring-1 ring-gray-200">{entry.componentStack}</pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Profile diagnostics */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><CheckCircle2 size={18} /></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Profile Diagnostics</h3>
                <p className="mt-1 text-xs text-gray-500">Current lodge linkage and auth profile health.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <div className="flex items-center justify-between gap-3">
                <span>Diagnostics status</span>
                <StatusPill ok={diagnosticsOk} label={diagnosticsOk ? 'Healthy' : 'Review'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Lodge ID</span>
                <span className="font-mono text-xs text-gray-500">{health?.lodge_id || '—'}</span>
              </div>
              <p className="rounded-xl bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-600">
                {health?.diagnostics?.error || health?.diagnostics?.message || 'Profile diagnostics loaded successfully.'}
              </p>
            </div>
          </div>

          {/* Backup snapshot */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><HardDrive size={18} /></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Backup Snapshot</h3>
                <p className="mt-1 text-xs text-gray-500">Recent local backup state on this machine.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(health?.backups?.backups || []).slice(0, 5).map((backup) => (
                <div key={backup.name} className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <p className="font-medium text-gray-900">{backup.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatTs(backup.created)}</p>
                </div>
              ))}
              {!health?.backups?.backups?.length && (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No local backups found yet.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Cross-Device Sync Health */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Wifi size={18} /></div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Cross-Device Sync Health</h3>
            <p className="text-xs text-gray-500">Health reports published by each device for this lodge</p>
          </div>
        </div>
        {!deviceHealthRollup?.available ? (
          <p className="text-sm text-gray-500">Cross-device health unavailable (offline or not reported)</p>
        ) : deviceHealthRollup.devices.length === 0 ? (
          <p className="text-sm text-gray-500">No device health reports found</p>
        ) : (
          <div className="space-y-3">
            {deviceHealthRollup.devices.map((device) => {
              const isDegraded = device.failed_queue_count > 0 || device.unresolved_local_count > 0 || device.stale
              return (
                <div key={device.device_id} className={`rounded-xl border p-4 ${isDegraded ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-600 uppercase">{device.client_type}</span>
                      <span className="ml-2 text-xs text-slate-400">{String(device.device_id || '').slice(0, 24)}</span>
                    </div>
                    <span className="text-xs text-slate-500">{formatTs(device.reported_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-700">
                    <span>Pending: <strong>{device.pending_queue_count}</strong></span>
                    <span>Failed: <strong className={device.failed_queue_count > 0 ? 'text-red-700' : ''}>{device.failed_queue_count}</strong></span>
                    <span>Unresolved: <strong className={device.unresolved_local_count > 0 ? 'text-amber-700' : ''}>{device.unresolved_local_count}</strong></span>
                    <span>Reconciliation: <strong>{device.reconciliation_state}</strong></span>
                  </div>
                  {Array.isArray(device.top_fault_types) && device.top_fault_types.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500">Faults: {device.top_fault_types.join(', ')}</div>
                  )}
                  {device.stale && (
                    <div className="mt-2 text-xs text-amber-700 font-medium">Report is stale (&gt;10 min old) — may not reflect current state</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
