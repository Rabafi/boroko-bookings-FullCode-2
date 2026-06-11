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

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), ms)
    })
  ])
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
  if (/room.*conflict|no_overlapping_bookings/i.test(msg)) return 'Room already booked for those dates.'
  if (/idempotency.*required/i.test(msg)) return 'This change needs another try.'
  if (/authenticated.*required|authentication.*required|session.*required/i.test(msg)) return 'Sign in again, then try once more.'
  if (/lodge.*role|permission denied|insufficient.*privilege/i.test(msg)) return 'Permission needed. Check the account role.'
  if (/unique.*violation|duplicate key/i.test(msg)) return 'This item may already exist.'
  if (/not found/i.test(msg)) return 'This item was not found online.'
  if (/monthly booking creation limit/i.test(msg)) return 'Booking could not sync because the monthly booking creation limit has been reached.'
  if (/selected check-in month/i.test(msg)) return 'Booking could not sync because the selected check-in month has reached the plan limit.'
  if (/above the current plan booking limit|booking limit.*after a downgrade|above.*plan booking limit/i.test(msg)) return 'Booking could not sync because this lodge is above the current plan limit after downgrade.'
  if (/monthly booking limit reached/i.test(msg)) return 'Booking could not sync because the monthly booking creation limit has been reached.'
  if (/room limit reached/i.test(msg)) return 'Room creation could not sync because this lodge has reached the plan room limit. Upgrade, then retry or clear the failed item.'
  if (/user limit reached/i.test(msg)) return 'Staff user creation could not sync because this lodge has reached the plan user limit. Upgrade, then retry or clear the failed item.'
  if (/above the current plan room limit|room limit.*after a downgrade|above.*plan room limit/i.test(msg)) return 'Room creation could not sync because this lodge is above the current plan room limit after a downgrade. Upgrade or reduce rooms, then retry.'
  if (/above the current plan user limit|user limit.*after a downgrade|above.*plan user limit/i.test(msg)) return 'Staff user creation could not sync because this lodge is above the current plan user limit after a downgrade. Upgrade or reduce staff users, then retry.'
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
  update_customer_blacklist:'Guest flag update',
  create_room:              'New room',
  update_room:              'Update room',
  update_room_housekeeping: 'Housekeeping update',
  create_quotation:         'New quote',
  update_quotation:         'Update quote',
  mark_quotation_sent:      'Quote sent',
  convert_quotation:        'Convert quote',
  convert_quotation_to_booking: 'Quote to booking',
  create_user:              'New staff account',
  update_user_profile:      'Update staff profile',
  set_user_password:        'Reset password',
  delete_user:              'Remove staff account',
  add_booking_charge:       'Add charge',
  void_pos_order:           'Remove sale',
  create_inventory_item:    'New inventory product',
}

function syncOpLabel(table) {
  return SYNC_OP_LABEL[table] || table || 'Unknown operation'
}

const PLAIN_LABEL_OVERRIDES = {
  payments_rpc: 'Payments',
  bookings_rpc: 'Bookings',
  customers_rpc: 'Guests',
  rooms_rpc: 'Rooms',
  users_rpc: 'Staff',
  quotations_rpc: 'Quotes',
  pos_rpc: 'Sales',
  db_init: 'Database',
  replay_auth: 'Sign-in',
  manager_mobile_app: 'Manager mobile app',
  inventory_rpc: 'Inventory',
  inventory_item: 'Inventory',
}

function plainLabel(value) {
  if (value == null) return 'Item'
  const raw = String(value).trim()
  if (!raw) return 'Item'
  const override = PLAIN_LABEL_OVERRIDES[raw.toLowerCase()]
  if (override) return override
  return raw
    .replace(/_/g, ' ')
    .replace(/\brpc\b/gi, '')
    .replace(/\bpos\b/gi, 'sale')
    .replace(/\bdb\b/gi, 'database')
    .replace(/\bauth\b/gi, 'sign-in')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function plainStatusLabel(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  const labels = {
    ok: 'Clear',
    good: 'Clear',
    clear: 'Clear',
    ready: 'Ready',
    success: 'Clear',
    done: 'Clear',
    complete: 'Clear',
    completed: 'Clear',
    matched: 'Clear',
    match: 'Clear',
    balanced: 'Clear',
    pending: 'Waiting',
    waiting: 'Waiting',
    in_progress: 'Waiting',
    partial: 'Partly matched',
    mismatch: 'Needs review',
    mismatched: 'Needs review',
    needs_review: 'Needs review',
    failed: 'Needs review',
    bad: 'Needs review',
    error: 'Needs review',
    warning: 'Needs review',
    degraded: 'Needs review',
    stale: 'Out of date',
    blocked: 'Blocked',
    unknown: 'Unknown'
  }
  return labels[raw] || plainLabel(value)
}

function plainOutcomeLabel(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  const labels = {
    success: 'Success',
    empty: 'Nothing to send',
    partial: 'Partly sent',
    failed: 'Needs review',
    unknown: 'Unknown'
  }
  return labels[raw] || plainLabel(value)
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
  const [meshStatus, setMeshStatus]       = useState({ enabled: false, running: false, peerCount: 0, activeLocks: [] })
  // Track current pending count so post-sync polling can detect when items drain
  const pendingCountRef = useRef(0)

  const load = async () => {
    setLoading(true)
    try {
      const [
        systemHealth, settingsSnapshot, validatedUser, details,
        reconciliationSummary, validationSummary, validationHistory,
        nextRendererErrors, nextValidationAlerts, nextCriticalErrors,
        nextDeviceHealthRollup, nextRooms, nextCustomers, nextSyncStatus
      ] = await Promise.all([
        withTimeout(window.api.settings.getSystemHealth().catch((e) => ({ error: e.message })), 8000, { error: 'System health is taking too long to load.' }),
        withTimeout(window.api.settings.get().catch(() => null), 8000, null),
        withTimeout(window.api.auth.validateSession().catch(() => null), 8000, null),
        withTimeout(window.api.sync.getDetails().catch((e) => ({ error: e.message, pending: [], failed: [], faults: [], cacheFreshness: {} })), 8000, { error: 'Sync details are taking too long to load.', pending: [], failed: [], faults: [], cacheFreshness: {} }),
        withTimeout(window.api.reports.financialReconciliation().catch((e) => ({ error: e.message, summary: {} })), 8000, { error: 'Money check is unavailable offline.', summary: {} }),
        withTimeout(window.api.reports.financialValidation().catch((e) => ({ error: e.message, totals: {} })), 8000, { error: 'Money validation is unavailable offline.', totals: {} }),
        withTimeout(window.api.reports.financialValidationRuns(10).catch(() => []), 8000, []),
        withTimeout(window.api.app?.getRendererErrors?.(6).catch(() => []) || Promise.resolve([]), 8000, []),
        withTimeout(window.api.reports.financialValidationAlerts?.(8).catch(() => []) || Promise.resolve([]), 8000, []),
        withTimeout(window.api.reports.criticalErrors?.(8).catch(() => []) || Promise.resolve([]), 8000, []),
        withTimeout(window.api.sync.getDeviceHealthRollup().catch(() => ({ available: false, devices: [] })), 8000, { available: false, devices: [] }),
        withTimeout(window.api.rooms.getAll().catch(() => []), 8000, []),
        withTimeout(window.api.customers.getAll().catch(() => []), 8000, []),
        withTimeout(window.api.sync.getStatus().catch(() => null), 8000, null)
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
        groupedCounts:  details?.groupedCounts || {},
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
      setMeshStatus(nextSyncStatus?.mesh || { enabled: false, running: false, peerCount: 0, activeLocks: [] })
    } catch (error) {
      pushFlash('error', error?.message || 'Could not refresh the status page.')
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
        pushFlash('error', result.error || 'Could not start sending right now.')
        return
      }
      pushFlash('success', 'Sending now. This page will update automatically.')
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
        pushFlash('error', result.error || 'Could not try again right now.')
        return
      }
      pushFlash('success', `Moved ${result.retried || 0} item(s) back into the list.`)
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
        pushFlash('error', result.error || 'Could not try again for this item.')
        return
      }
      pushFlash('success', 'Moved that item back into the list.')
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
        pushFlash('error', result.error || 'Could not clear the items needing review.')
        return
      }
      const alertCount = Number(result.integrityAlertsRecorded || 0)
      const msg = alertCount > 0
        ? `Cleared ${result.removed || 0} item(s). Warning: ${alertCount} issue alert(s) were saved because the online copy is not confirmed yet.`
        : `Cleared ${result.removed || 0} item(s) needing review.`
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
        pushFlash('error', result.error || 'Could not run the money check right now.')
        return
      }
      pushFlash('success', 'Money check recorded.')
      await load()
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
        pushFlash('error', 'Could not clear all history.')
        return
      }
      setCriticalErrors([])
      setRendererErrors([])
      pushFlash('success', 'Important issue history cleared.')
      await load()
    } finally {
      setActionBusy('')
    }
  }

  const sendReportToCommandCentral = async () => {
    setActionBusy('send-report')
    try {
      const issues = []
      if (failedCount > 0) issues.push(`${failedCount} item${failedCount === 1 ? '' : 's'} need review`)
      if (pendingCount > 0) issues.push(`${pendingCount} item${pendingCount === 1 ? '' : 's'} are still waiting to send`)
      if (cacheStale) issues.push('fresh data is still catching up after a refresh problem')
      if (!financeRpcOk) issues.push('the money check needs attention')
      if (!contractAllOk) issues.push('one or more required online checks are missing')
      if (financeMismatchCount > 0) issues.push(`${financeMismatchCount} money difference${financeMismatchCount === 1 ? '' : 's'} were found`)
      if (invoiceGapCount > 0) issues.push(`${invoiceGapCount} invoice issue${invoiceGapCount === 1 ? '' : 's'} were found`)
      if (validationAlerts.length > 0) issues.push(`${validationAlerts.length} recent money alert${validationAlerts.length === 1 ? '' : 's'} were saved`)
      if (criticalErrors.length > 0) issues.push(`${criticalErrors.length} recent important app issue${criticalErrors.length === 1 ? '' : 's'} were saved`)
      if (rendererErrors.length > 0) issues.push(`${rendererErrors.length} recent screen issue${rendererErrors.length === 1 ? '' : 's'} were saved`)
      if (!diagnosticsOk) issues.push('the account check needs review')
      if (faults.length > 0) issues.push(`${faults.length} issue${faults.length === 1 ? '' : 's'} were recorded`)
      if (financialFailedCount > 0) issues.push(`${financialFailedCount} money item${financialFailedCount === 1 ? '' : 's'} could not be sent`)
      if (reconciliationLocalOnly) issues.push('the money check could not be verified because the app was offline')

      const plainLanguageSummary = issues.length > 0
        ? issues.map((issue) => `- ${issue}`).join('\n')
        : '- Staff requested a review of this status page even though no current issues were detected.'

      const bundleResult = await window.api.reports.getSupportBundle?.(25).catch(() => null)
      const bundleJson = bundleResult?.bundle ? JSON.stringify(bundleResult.bundle, null, 2) : null

      const description = [
        'A staff member asked for a review of this lodge health report.',
        '',
        'Plain-language summary:',
        plainLanguageSummary,
        '',
        'Quick counts:',
        `- Items needing review: ${failedCount}`,
        `- Items still sending: ${pendingCount}`,
        `- Money items needing review: ${financialFailedCount}`,
        `- Money differences: ${financeMismatchCount}`,
        `- Invoice issues: ${invoiceGapCount}`,
        `- Problems: ${faults.length}`,
        `- Money alerts: ${validationAlerts.length}`,
        `- Important app issues: ${criticalErrors.length}`,
        `- Screen issues: ${rendererErrors.length}`,
        '',
        `Reporter: ${sessionUser?.name || sessionUser?.email || 'Unknown user'}`,
        `Lodge: ${globalSettings?.lodge_name || health?.lodge_name || 'Unknown'}`,
        `Lodge reference: ${globalSettings?.lodge_id || health?.lodge_id || 'Unknown'}`,
        bundleJson ? ['', '```json', bundleJson, '```'].join('\n') : ''
      ].filter(Boolean).join('\n')

      await window.api.admin.createSupportTicket({
        lodge_id: globalSettings?.lodge_id || health?.lodge_id || 'unknown',
        lodge_name: globalSettings?.lodge_name || health?.lodge_name || '',
        title: `Health Review Request${criticalErrors.length > 0 || faults.length > 0 || failedCount > 0 ? ' - Issues Found' : ''}`,
        description,
        category: 'Technical Support',
        priority: criticalErrors.length > 0 || faults.length > 0 || financialFailedCount > 0 ? 'High' : failedCount > 0 ? 'Normal' : 'Low'
      })
      pushFlash('success', 'Health report sent for review.')
    } catch (error) {
      pushFlash('error', error?.message || 'Could not send the report right now.')
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
  const syncState          = syncRunning ? 'Sending' : failedCount > 0 ? 'Needs review' : 'Ready'
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
  const groupedCounts          = syncDetails?.groupedCounts || {}
  const missingParentCount     = Number(groupedCounts.missing_parent || 0)
  const blockedDependencyCount = Number(groupedCounts.blocked_dependencies || 0)
  const financialRiskCount     = Number(groupedCounts.financial_risk_items || 0)
  const localStateAcknowledged = unresolvedLocal?.total === 0 && health?.online === true && replayAuthReady && pendingCount === 0
  const meshPeerCount          = Number(meshStatus?.peerCount || 0)
  const meshLockCount          = Number(meshStatus?.activeLockCount || meshStatus?.activeLocks?.length || 0)
  const meshLastError          = String(meshStatus?.lastError || '').trim()
  const meshAutoStandby        = /missing lodge_mesh_secret/i.test(meshLastError)
  const meshStateLabel         = meshStatus?.running ? 'Running' : meshStatus?.enabled ? 'Starting' : meshAutoStandby ? 'Standby' : meshLastError ? 'Needs setup' : 'Off'

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

    // Inventory items
    if (item.table === 'create_inventory_item') {
      return {
        label: 'Review Inventory',
        route: '/inventory',
        state: {}
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
          <h2 className="text-lg font-bold text-gray-900">Health Check</h2>
          <p className="mt-1 text-sm text-gray-500">
            Recent activity, money checks, backups, and account status.
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
            {actionBusy === 'run-sync' ? 'Checking…' : 'Run Sync Now'}
          </button>
          <button type="button" onClick={sendReportToCommandCentral} disabled={actionBusy === 'send-report'}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60">
            <ShieldCheck size={14} />
            {actionBusy === 'send-report' ? 'Sending…' : 'Send Report'}
          </button>
          <button type="button" onClick={clearErrorHistory} disabled={actionBusy === 'clear-errors'}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-60">
            <Trash2 size={14} />
            {actionBusy === 'clear-errors' ? 'Clearing…' : 'Clear History'}
          </button>
        </div>
      </div>

      {/* Flash */}
      {flash && (
        <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${flash.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {flash.text}
        </div>
      )}

      {/* Blocking issues */}
      {blockingFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <XCircle size={18} className="mt-0.5 shrink-0 text-red-700" />
              <div>
                <p className="text-sm font-bold text-red-900">
                  {fault.type === 'queue_corrupt' ? 'Saved changes issue found' : 'Saved data issue found'}
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

      {/* Data mismatch alerts */}
      {driftFaults.map((fault) => (
        <div key={fault.id} className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Data mismatch</p>
                <p className="text-sm font-bold text-amber-900">
                  {fault.type === 'quotation_drift' ? 'Quotation changed after save'
                    : fault.type === 'pos_drift' ? 'POS order changed after save'
                    : 'Booking changed after save'}
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
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-0.5">Needs review</p>
                <p className="text-sm font-bold text-rose-900">Online copy and this computer do not match</p>
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
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-0.5">Needs review</p>
                <p className="text-sm font-bold text-red-900">A manual clear still needs checking</p>
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


      {/* Info items */}
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

      {/* Saved changes card — only shown when there are actual open items or when all are confirmed */}
      {unresolvedLocal && (unresolvedLocal.total > 0 || localStateAcknowledged) && (
        <div className={`rounded-2xl border px-5 py-4 ${localStateAcknowledged ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <Database size={16} className={`mt-0.5 shrink-0 ${localStateAcknowledged ? 'text-slate-400' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${localStateAcknowledged ? 'text-slate-600' : 'text-amber-900'}`}>
                {unresolvedLocal.total > 0
                  ? `Saved changes still open (${unresolvedLocal.total} item${unresolvedLocal.total === 1 ? '' : 's'})`
                  : 'All saved changes confirmed'}
              </p>
              {unresolvedLocal.total > 0 && (
                <div className="mt-2 space-y-1">
                  {[
                    { key: 'bookings', label: 'Bookings' },
                    { key: 'customers', label: 'Customers' },
                    { key: 'rooms', label: 'Rooms' },
                    { key: 'users', label: 'Users' },
                    { key: 'quotations', label: 'Quotations' },
                    { key: 'posOrders', label: 'POS Orders' },
                    { key: 'conferenceBookings', label: 'Conference Bookings' },
                    { key: 'poolDayUse', label: 'Day Use Entries' },
                    { key: 'inventoryItems', label: 'Inventory' }
                  ].filter(({ key }) => (unresolvedLocal[key]?.count ?? 0) > 0).map(({ key, label }) => (
                    <div key={key} className="text-xs text-amber-800">
                      <span className="font-medium">{label}:</span> {unresolvedLocal[key].count} still open
                      {unresolvedLocal[key].ids?.length > 0 && (
                        <span className="ml-1 text-amber-700/70">({unresolvedLocal[key].ids.slice(0, 3).map(id => String(id).slice(0, 8)).join(', ')}{unresolvedLocal[key].ids.length > 3 ? '…' : ''})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {localStateAcknowledged && (
                <p className="mt-0.5 text-xs text-slate-500">(this device only)</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Attention banner */}
      {needsAttention && !blockingFaults.length && (
        <div className={`rounded-2xl px-5 py-4 shadow-sm ${failedCount > 0 ? 'border border-red-200 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${failedCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
                {failedCount > 0
                  ? 'Some items need review before staff can trust the latest data.'
                  : manualClearFaults.length > 0
                    ? 'Manual Clear Left Integrity Unproven'
                    : ghostFaults.length > 0
                      ? 'Server Mismatch Detected During Replay'
                      : convergenceFaults.length > 0
                        ? 'The refreshed data is different from what this device expected.'
                  : cacheStale
                    ? 'Fresh data is still retrying after a refresh problem.'
                    : 'The app is still sending saved changes.'}
              </p>
              <p className={`mt-1 text-sm ${failedCount > 0 ? 'text-red-800/80' : 'text-amber-800/80'}`}>
                {failedCount > 0 && `${failedCount} item${failedCount === 1 ? '' : 's'} need review. `}
                {manualClearFaults.length > 0 && `${manualClearFaults.length} manually cleared item${manualClearFaults.length === 1 ? '' : 's'} still need checking. integrity alert(s) were recorded because remote persistence is still unconfirmed. `}
                {ghostFaults.length > 0 && `${ghostFaults.length} mismatch alert${ghostFaults.length === 1 ? '' : 's'} detected. `}
                {convergenceFaults.length > 0 && !ghostFaults.length && `${convergenceFaults.length} data mismatch alert${convergenceFaults.length === 1 ? '' : 's'} saved. `}
                {pendingCount > 0 && `${pendingCount} item${pendingCount === 1 ? '' : 's'} still sending. `}
                {cacheStale && `${syncDetails?.cacheStale?.names?.join(', ') || 'Booking'} data may still be catching up.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {failedCount > 0 && (
                <button type="button" onClick={retryFailed} disabled={actionBusy === 'retry'}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60">
                  <RotateCcw size={13} />
                  {actionBusy === 'retry' ? 'Retrying…' : 'Try Again for All'}
                </button>
              )}
              <button type="button" onClick={load} disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Refresh
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
              The app is sending saved changes now. Counts will update when it finishes.
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
              Sending is paused until you sign in again.
            </p>
          </div>
        </div>
      )}

      {/* P1-10: Financial sync risk banner */}
      {(financialFailedCount > 0 || financialPendingCount > 0) && (
        <div className={`rounded-2xl px-5 py-4 shadow-sm ${financialFailedCount > 0 ? 'border border-red-300 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
          <p className={`text-sm font-bold ${financialFailedCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
            Money check
          </p>
          {financialFailedCount > 0 && (
            <p className="mt-1 text-sm text-red-800/80">
              {financialFailedCount} money-related item{financialFailedCount === 1 ? '' : 's'} need review.
              The related balances may be off until resolved.
            </p>
          )}
          {financialPendingCount > 0 && (
            <p className="mt-1 text-sm text-amber-800/80">
              {financialPendingCount} money-related item{financialPendingCount === 1 ? '' : 's'} are still sending.
              Balances shown here may not be final yet.
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
                Waiting: {String(id).slice(0, 8)}…
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Status</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{syncState}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Waiting</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{pendingCount}</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Needs review</p>
              <p className={`mt-1 text-lg font-bold ${failedCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>{failedCount}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
              {syncRunning
              ? 'The app is sending changes now.'
              : pendingCount > 0
                ? 'Some items are still waiting to send.'
                : 'Nothing is sending right now.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Last successful send: {lastSyncAt ? formatTs(lastSyncAt) : 'No successful send recorded yet'}
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Money checks</p>
              <p className={`mt-1 text-lg font-bold ${financeRpcOk && contractAllOk ? 'text-gray-900' : 'text-red-700'}`}>
                {financeRpcOk && contractAllOk ? 'Ready' : 'Needs attention'}
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Needs review</p>
              <p className={`mt-1 text-lg font-bold ${failedCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>{failedCount}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Review items that could not be sent and check the reason shown below.</p>
          {financialFailedCount > 0 && (
            <p className="mt-1 text-xs font-semibold text-red-700">{financialFailedCount} money-related item{financialFailedCount === 1 ? '' : 's'} affected</p>
          )}
        </div>

        {/* Reconciliation */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-rose-50 p-2 text-rose-600"><Database size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Money check</p>
              {reconciliationLocalOnly ? (
                <p className="mt-1 text-lg font-bold text-amber-600">Not Verified</p>
              ) : (
                <p className="mt-1 text-lg font-bold text-gray-900">{financeMismatchCount + invoiceGapCount}</p>
              )}
            </div>
          </div>
          {reconciliationLocalOnly ? (
            <p className="mt-3 text-xs font-semibold text-amber-700">Cannot verify while offline. Run again when connected.</p>
          ) : (
                <p className="mt-3 text-sm text-gray-500">Booking, payment, and invoice differences.</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Local Mesh</h3>
            <p className="mt-1 text-xs text-gray-500">Nearby front-desk computers on this lodge network.</p>
          </div>
          <StatusPill
            ok={meshStatus?.running && !meshLastError}
            warn={Boolean(meshLastError) && !meshAutoStandby}
            label={meshStateLabel}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-gray-50 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Peers</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{meshPeerCount}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Room holds</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{meshLockCount}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">Last merge</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{meshStatus?.lastQueueMergeAt ? formatTs(meshStatus.lastQueueMergeAt) : 'Not yet'}</p>
          </div>
        </div>
        {meshLastError && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {meshAutoStandby
              ? 'Local Mesh will start automatically when this lodge has mesh credentials available.'
              : meshLastError}
          </div>
        )}
        {Array.isArray(meshStatus?.peers) && meshStatus.peers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {meshStatus.peers.slice(0, 6).map((peer) => (
              <span key={peer.nodeId} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                {String(peer.nodeId).slice(0, 8)} · {formatTs(peer.lastSeenAt)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Sync categories</h3>
            <p className="mt-1 text-xs text-gray-500">Grouped counts for blocked, risky, failed, and waiting items.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Missing parent', value: missingParentCount, tone: missingParentCount > 0 ? 'text-red-700' : 'text-gray-900' },
            { label: 'Blocked dependencies', value: blockedDependencyCount, tone: blockedDependencyCount > 0 ? 'text-amber-700' : 'text-gray-900' },
            { label: 'Financial risk items', value: financialRiskCount, tone: financialRiskCount > 0 ? 'text-red-700' : 'text-gray-900' },
            { label: 'Failed items', value: failedCount, tone: failedCount > 0 ? 'text-red-700' : 'text-gray-900' },
            { label: 'Pending items', value: pendingCount, tone: pendingCount > 0 ? 'text-amber-700' : 'text-gray-900' }
          ].map((group) => (
            <div key={group.label} className="rounded-xl bg-gray-50 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{group.label}</p>
              <p className={`mt-1 text-lg font-bold ${group.tone}`}>{group.value}</p>
            </div>
          ))}
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
                <h3 className="text-sm font-semibold text-gray-900">Items that need review</h3>
                <p className="mt-1 text-xs text-gray-500">These changes did not send cleanly. Check the reason under each item, then try again or open the booking.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={retryFailed} disabled={actionBusy === 'retry' || !syncDetails?.failed?.length}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60">
                  <RotateCcw size={13} />
                  {actionBusy === 'retry' ? 'Retrying…' : 'Try Again for All'}
                </button>
                <button type="button" onClick={clearFailed} disabled={actionBusy === 'clear' || !syncDetails?.failed?.length}
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60">
                  {actionBusy === 'clear' ? 'Clearing…' : 'Clear Items'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {!syncDetails?.failed?.length ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                  No items need review right now.
                </div>
              ) : (
                syncDetails.failed.slice(0, 8).map((item) => {
                  const isFinancial = item.isFinancial
                  const isAutoRetryable = item.isAutoRetryable !== false
                  const retryLabel = isAutoRetryable
                    ? item.autoRetryEligible
                      ? 'Ready to try again'
                      : item.nextAutoRetryAt
                        ? `Will try again at ${formatTs(item.nextAutoRetryAt)}`
                        : 'Will try again automatically'
                    : 'Try again manually'
                  return (
                    <div
                      key={item._queue_id}
                      className={`rounded-xl border p-4 ${isFinancial ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}
                      data-testid="system-health-failed-item"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusPill ok={false} label={plainLabel(item.type || 'change')} />
                          <span className="text-sm font-semibold text-gray-900">{syncOpLabel(item.table)}</span>
                          {isFinancial && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Money</span>}
                        </div>
                        <span className="text-xs text-gray-400">
                          {item.lastAttemptedAt ? formatTs(item.lastAttemptedAt) : 'Not tried recently'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-red-700">{sanitizeForOperator(item.displayError || item.lastError)}</p>
                      {item.dependencyLabel && item.dependencyCategory !== 'none' && (
                        <p className={`mt-1 text-xs font-medium ${item.dependencyCategory === 'missing_parent' ? 'text-red-700' : 'text-amber-700'}`}>
                          {item.dependencyLabel}
                        </p>
                      )}
                      {/* P1-11: retry classification */}
                      <p className={`mt-1 text-xs font-medium ${isAutoRetryable ? 'text-blue-600' : 'text-amber-700'}`}>
                        {retryLabel}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-500">Reference: {item._queue_id || '—'}</p>
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
                            {actionBusy === `retry:${item._queue_id}` ? 'Retrying…' : 'Try Again'}
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
                <h3 className="text-sm font-semibold text-gray-900">Items still sending</h3>
                <p className="mt-1 text-xs text-gray-500">Changes on this device are still on their way.</p>
              </div>
              <StatusPill ok={pendingCount === 0} label={pendingCount === 0 ? 'Clear' : `${pendingCount} waiting`} warn={pendingCount > 0 && failedCount === 0} />
            </div>
            <div className="mt-4 space-y-3">
              {!syncDetails?.pending?.length ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No items are waiting to send right now.
                </div>
              ) : (
                syncDetails.pending.slice(0, 6).map((item) => (
                  <div key={item._queue_id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" data-testid="system-health-pending-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusPill ok={false} label={plainLabel(item.type || 'change')} warn />
                        <span className="text-sm font-semibold text-gray-900">{syncOpLabel(item.table)}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {item.createdAt ? formatTs(item.createdAt) : 'Saved on this computer'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className={`rounded-full px-2 py-1 font-semibold ${item.isFinancial ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                        {item.isFinancial ? 'Money' : 'General'}
                      </span>
                      <span className={`rounded-full px-2 py-1 font-semibold ${item.dependencyCategory === 'missing_parent' ? 'bg-red-100 text-red-800' : item.dependencyCategory === 'blocked_dependencies' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                        {item.dependencyLabel || `Dependency: ${item.dependencyState || 'unknown'}`}
                      </span>
                      {item._depends_on && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                          Waits for {item._depends_on}
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
                  <h3 className="text-sm font-semibold text-gray-900">Other issues</h3>
                  <p className="mt-1 text-xs text-gray-500">Issues found while the app was running.</p>
                </div>
                <StatusPill ok={false} label={`${faults.length} saved`} />
              </div>
              <div className="mt-4 space-y-3">
                {faults.filter((f) => !['queue_corrupt', 'cache_corrupt'].includes(f.type)).slice(0, 8).map((fault) => {
                  const isHighRisk = ['financial_dead_letter_cleared', 'ghost_update'].includes(fault.type) || fault.severity === 'error'
                  const bookingId = getFaultBookingId(fault)
                  return (
                  <div key={fault.id} className={`rounded-xl px-4 py-3 ${isHighRisk ? 'border border-red-200 bg-red-50' : 'border border-amber-200 bg-amber-50'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`text-sm font-semibold ${isHighRisk ? 'text-red-900' : 'text-amber-900'}`}>{plainLabel(fault.type)}</p>
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
            <h3 className="text-sm font-semibold text-gray-900" data-testid="system-health-sync-detail">Status details</h3>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Last send finished</span>
                <span className="font-medium text-gray-800 text-right">{formatTs(lastSyncAt) || 'Not recorded'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Last result</span>
                <StatusPill
                  ok={lastSyncOutcome === 'success' || lastSyncOutcome === 'empty'}
                  warn={lastSyncOutcome === 'partial'}
                  label={plainOutcomeLabel(lastSyncOutcome)}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Can send</span>
                <StatusPill ok={replayAuthReady} label={replayAuthReady ? 'Yes' : 'Not yet'} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">Sending now</span>
                <StatusPill ok={!syncRunning} warn={syncRunning} label={syncRunning ? 'Sending' : 'Idle'} />
              </div>
              {lastSyncError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{lastSyncError}</p>
              )}
            </div>

            {/* Connection checks */}
            {health?.finance?.contract && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-900">Connection checks</h4>
                  <StatusPill ok={contractAllOk} label={contractAllOk ? 'Ready' : 'Needs attention'} />
                </div>
                {!contractAllOk && (
                  <p className="mt-2 text-xs text-red-700">{health.finance.contract.message}</p>
                )}
                <div className="mt-3 grid gap-1">
                  {Object.entries(contractProbes).map(([name, probe]) => (
                    <div key={name} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5">
                      <span className="text-xs font-medium text-gray-700">{plainLabel(name)}</span>
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
                  <h3 className="text-sm font-semibold text-gray-900">Last updated</h3>
                  <p className="mt-1 text-xs text-gray-500">Last time each saved list was refreshed online.</p>
                </div>
                {staleCaches.length > 0 && (
                  <StatusPill ok={false} warn label={`${staleCaches.length} out of date`} />
                )}
              </div>
              <div className="mt-4 grid gap-1.5">
                {Object.entries(cacheFreshness).map(([name, meta]) => (
                  <div key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 ${meta.stale ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{plainLabel(name)}</span>
                      {meta.source === 'remote' && (
                        <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">online</span>
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
                <h3 className="text-sm font-semibold text-gray-900">Money check</h3>
                <p className="mt-1 text-xs text-gray-500">Cross-check bookings against payments and invoice totals.</p>
              </div>
              {/* P0-3: never show green when offline */}
              {reconciliationLocalOnly ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  Cannot verify financial agreement — offline
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
                    <p className="text-sm font-semibold text-amber-900">Cannot check money totals while offline</p>
                    <p className="mt-1 text-xs text-amber-800/80">
                      {reconciliation?.message || 'This check needs an internet connection. Connect and refresh to run it again.'}
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
                    ['Missing invoices', reconciliationSummary.invoiceGaps],
                    ['Unlinked invoices', reconciliationSummary.orphanInvoices],
                    ['Refunds waiting', reconciliationSummary.pendingRefunds],
                  ].map(([label, val]) => (
                    <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">{label}</p>
                      <p className={`mt-2 text-2xl font-bold ${Number(val) > 0 ? (label === 'Refunds waiting' ? 'text-amber-700' : 'text-red-700') : 'text-gray-900'}`}>{val || 0}</p>
                    </div>
                  ))}
                </div>
                {(reconciliation?.paymentMismatches || []).slice(0, 2).map((item) => (
                  <div key={`pay-${item.booking_id}`} className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="text-sm font-semibold text-rose-900">Payment difference · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                    <p className="mt-1 text-sm text-rose-800/80">Booking shows {Number(item.booking_amount_paid || 0).toFixed(2)} but payment total is {Number(item.payment_ledger_total || 0).toFixed(2)}.</p>
                  </div>
                ))}
                {(reconciliation?.chargeMismatches || []).slice(0, 2).map((item) => (
                  <div key={`charge-${item.booking_id}`} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">Charge difference · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                    <p className="mt-1 text-sm text-amber-800/80">Booking shows {Number(item.booking_charges_total || 0).toFixed(2)} but active charges total {Number(item.charge_ledger_total || 0).toFixed(2)}.</p>
                  </div>
                ))}
                {(reconciliation?.pendingRefunds || []).slice(0, 3).map((item) => (
                  <div key={`refund-p-${item.id}`} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-amber-900">Refund waiting · {item.invoice_number}</p>
                      <span className="text-xs font-bold text-amber-700">{item.amount_to_refund.toFixed(2)}</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-800/80">Cancelled booking for {item.customer_name}. Money still needs to be returned to the guest.</p>
                  </div>
                ))}
                {financeMismatchCount + invoiceGapCount + Number(reconciliationSummary.pendingRefunds || 0) === 0 && reconciliationValid && (
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No money differences or waiting refunds detected.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Validation snapshot */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Recent money activity</h3>
                <p className="mt-1 text-xs text-gray-500">Recent refunds and removed charges.</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  ok={(validationTotals.recent_refunds || 0) + (validationTotals.recent_charge_voids || 0) === 0}
                  warn={(validationTotals.recent_refunds || 0) + (validationTotals.recent_charge_voids || 0) > 0}
                  label={`${validationTotals.recent_refunds || 0} refunds · ${validationTotals.recent_charge_voids || 0} removed`}
                />
                <button type="button" onClick={runValidationNow} disabled={actionBusy === 'validation'}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60">
                  <RefreshCw size={12} className={actionBusy === 'validation' ? 'animate-spin' : ''} />
                  {actionBusy === 'validation' ? 'Running…' : 'Check Now'}
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
                  <p className="text-sm font-semibold text-gray-900">Charge removed</p>
                  <p className="mt-1 text-sm text-gray-600">Booking {String(item.booking_id || '').slice(0, 8)} · {Number(item.amount_delta || 0).toFixed(2)} · {item.reason || 'No reason recorded'}</p>
                </div>
              ))}
              {(validation?.recentRefunds || []).length === 0 && (validation?.recentChargeVoids || []).length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No recent refunds or removed charges were found.
                </div>
              )}
            </div>

            {/* Validation alerts */}
            <div className="mt-5 border-t border-gray-100 pt-4" data-testid="system-health-validation-alerts">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Validation Alerts</h4>
                <StatusPill ok={validationAlerts.length === 0} label={validationAlerts.length === 0 ? 'No alerts' : `${validationAlerts.length} saved`} />
              </div>
              <div className="mt-3 space-y-3">
                {validationAlerts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No recent alerts were found.
                  </div>
                ) : (
                  validationAlerts.slice(0, 5).map((entry, index) => (
                    <div
                      key={`${entry.id || entry.detected_at || 'alert'}-${index}`}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                      data-testid="system-health-validation-alert"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-900">{entry.alert_type || entry.type || 'Alert'}</p>
                        <span className="text-xs text-amber-700/80">{formatTs(entry.detected_at) || 'Time unknown'}</span>
                      </div>
                      <p className="mt-1 text-sm text-amber-800/80">{entry.message || entry.summary || 'Alert saved for review.'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Validation run history */}
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Check history</h4>
                <StatusPill ok={validationRuns.length > 0} warn={validationRuns.length === 0} label={validationRuns.length > 0 ? `${validationRuns.length} saved` : 'No checks yet'} />
              </div>
              <div className="mt-3 space-y-3">
                {validationRuns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No checks have been recorded yet.
                  </div>
                ) : (
                  validationRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {String(run.trigger_source || 'manual').replace(/_/g, ' ')} check
                        </p>
                        <span className="text-xs text-gray-400">{formatTs(run.created_at) || 'Time unknown'}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        Payment mismatches {Number(run.summary?.totals?.payment_mismatches || 0)} · Charge mismatches {Number(run.summary?.totals?.charge_mismatches || 0)} · Missing invoices {Number(run.summary?.totals?.invoice_gaps || 0)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        By {run.triggered_by_name || 'System'}{run.local_only ? ' · this computer only' : ''}
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
                <p className="mt-1 text-xs text-gray-500">Important desktop issues with helpful details.</p>
              </div>
              <StatusPill ok={criticalErrors.length === 0} label={criticalErrors.length === 0 ? 'No issues' : `${criticalErrors.length} saved`} />
            </div>
            <div className="mt-4 space-y-3">
              {criticalErrors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No important desktop issues were found recently.
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
                          <p className={`text-sm font-semibold text-${tone}-900`}>{plainLabel(entry.scope || entry.operation || 'system')}</p>
                          {!isCritical && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Note</span>}
                        </div>
                        <span className={`text-xs text-${tone}-700/80`}>{formatTs(entry.at) || 'Time unknown'}</span>
                      </div>
                      <p className={`mt-1 text-sm text-${tone}-800/80`}>{entry.message || 'No message recorded.'}</p>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <details className={`mt-2 text-xs text-${tone}-800/80`}>
                          <summary className={`cursor-pointer font-medium text-${tone}-900`}>Show more</summary>
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
                <h3 className="text-sm font-semibold text-gray-900">Recent crashes</h3>
                <p className="mt-1 text-xs text-gray-500">Crash details for when the app needs recovery.</p>
              </div>
              <StatusPill ok={rendererErrors.length === 0} label={rendererErrors.length === 0 ? 'No recent crashes' : `${rendererErrors.length} saved`} />
            </div>
            <div className="mt-4 space-y-3">
              {rendererErrors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No recent crashes were found on this computer.
                </div>
              ) : (
                rendererErrors.map((entry, index) => (
                  <div key={`${entry.at || 'crash'}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">{entry.message || 'Unknown app issue'}</p>
                      <span className="text-xs text-gray-400">{formatTs(entry.at) || 'Not recorded'}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Screen: {entry.route || 'Unknown screen'}</p>
                    {entry.componentStack && (
                      <details className="mt-2 text-xs text-gray-600">
                        <summary className="cursor-pointer font-medium text-gray-700">Show crash details</summary>
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
                <h3 className="text-sm font-semibold text-gray-900">Account check</h3>
                <p className="mt-1 text-xs text-gray-500">Checks that this lodge account is linked correctly.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <div className="flex items-center justify-between gap-3">
                <span>Check status</span>
                <StatusPill ok={diagnosticsOk} label={diagnosticsOk ? 'Healthy' : 'Review'} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Lodge reference</span>
                <span className="font-mono text-xs text-gray-500">{health?.lodge_id || '—'}</span>
              </div>
              <p className="rounded-xl bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-600">
                {health?.diagnostics?.error || health?.diagnostics?.message || 'Account check loaded successfully.'}
              </p>
            </div>
          </div>

          {/* Backup snapshot */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><HardDrive size={18} /></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Backups</h3>
                <p className="mt-1 text-xs text-gray-500">Recent backups saved on this computer.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {health?.backup_health && (
                <div className={`rounded-xl border px-3 py-3 text-sm ${
                  health.backup_health.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  <p className="font-semibold">{health.backup_health.ok ? 'Backups are set up correctly' : 'Backups need attention'}</p>
                  {Array.isArray(health.backup_health.warnings) && health.backup_health.warnings.length > 0 && (
                    <p className="mt-1 text-xs">{health.backup_health.warnings.join(' ')}</p>
                  )}
                </div>
              )}
              {(health?.backups?.backups || []).slice(0, 5).map((backup) => (
                <div key={backup.name} className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <p className="font-medium text-gray-900">{backup.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatTs(backup.created)}</p>
                </div>
              ))}
              {!health?.backups?.backups?.length && (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No backups found yet.
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
            <h3 className="text-sm font-bold text-gray-900">Other devices</h3>
            <p className="text-xs text-gray-500">Status reports from each device for this lodge</p>
          </div>
        </div>
        {!deviceHealthRollup?.available ? (
          <p className="text-sm text-gray-500">No reports are available right now.</p>
        ) : deviceHealthRollup.devices.length === 0 ? (
          <p className="text-sm text-gray-500">No reports from other devices found</p>
        ) : (
          <div className="space-y-3">
            {deviceHealthRollup.devices.map((device) => {
              const isDegraded = device.failed_queue_count > 0 || device.unresolved_local_count > 0 || device.stale
              return (
                <div key={device.device_id} className={`rounded-xl border p-4 ${isDegraded ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-600 uppercase">{plainLabel(device.client_type)}</span>
                      <span className="ml-2 text-xs text-slate-400">{String(device.device_id || '').slice(0, 24)}</span>
                    </div>
                    <span className="text-xs text-slate-500">{formatTs(device.reported_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-700">
                    <span>Waiting: <strong>{device.pending_queue_count}</strong></span>
                    <span>Needs review: <strong className={device.failed_queue_count > 0 ? 'text-red-700' : ''}>{device.failed_queue_count}</strong></span>
                    <span>Open: <strong className={device.unresolved_local_count > 0 ? 'text-amber-700' : ''}>{device.unresolved_local_count}</strong></span>
                    <span>Match: <strong>{plainStatusLabel(device.reconciliation_state)}</strong></span>
                  </div>
                  {Array.isArray(device.top_fault_types) && device.top_fault_types.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500">Issues: {device.top_fault_types.map((type) => plainLabel(type)).join(', ')}</div>
                  )}
                  {device.stale && (
                    <div className="mt-2 text-xs text-amber-700 font-medium">This report is over 10 minutes old, so it may not match what is happening now.</div>
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
