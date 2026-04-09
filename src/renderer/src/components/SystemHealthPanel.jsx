import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Database, Download, HardDrive, RefreshCw, RotateCcw, ShieldCheck, Wifi } from 'lucide-react'

function StatusPill({ ok, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
      {label}
    </span>
  )
}

export default function SystemHealthPanel() {
  const navigate = useNavigate()
  const [health, setHealth] = useState(null)
  const [syncDetails, setSyncDetails] = useState({ pending: [], failed: [] })
  const [reconciliation, setReconciliation] = useState(null)
  const [validation, setValidation] = useState(null)
  const [validationRuns, setValidationRuns] = useState([])
  const [validationAlerts, setValidationAlerts] = useState([])
  const [criticalErrors, setCriticalErrors] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [flash, setFlash] = useState(null)
  const [rendererErrors, setRendererErrors] = useState([])

  const load = async () => {
    setLoading(true)
    try {
      const [systemHealth, details, reconciliationSummary, validationSummary, validationHistory, nextRendererErrors, nextValidationAlerts, nextCriticalErrors] = await Promise.all([
        window.api.settings.getSystemHealth().catch((e) => ({ error: e.message })),
        window.api.sync.getDetails().catch((e) => ({ error: e.message, pending: [], failed: [] })),
        window.api.reports.financialReconciliation().catch((e) => ({ error: e.message, summary: {} })),
        window.api.reports.financialValidation().catch((e) => ({ error: e.message, totals: {} })),
        window.api.reports.financialValidationRuns(10).catch(() => []),
        window.api.app?.getRendererErrors?.(6).catch(() => []) || Promise.resolve([]),
        window.api.reports.financialValidationAlerts?.(8).catch(() => []) || Promise.resolve([]),
        window.api.reports.criticalErrors?.(8).catch(() => []) || Promise.resolve([])
      ])
      setHealth(systemHealth || null)
      setSyncDetails({
        pending: Array.isArray(details?.pending) ? details.pending : [],
        failed: Array.isArray(details?.failed) ? details.failed : [],
        cacheStale: details?.cacheStale || { active: false, names: [] },
        error: details?.error || ''
      })
      setReconciliation(reconciliationSummary || null)
      setValidation(validationSummary || null)
      setValidationRuns(Array.isArray(validationHistory) ? validationHistory : [])
      setRendererErrors(Array.isArray(nextRendererErrors) ? nextRendererErrors : [])
      setValidationAlerts(Array.isArray(nextValidationAlerts) ? nextValidationAlerts : [])
      setCriticalErrors(Array.isArray(nextCriticalErrors) ? nextCriticalErrors : [])
    } catch (error) {
      pushFlash('error', error?.message || 'Could not refresh system health.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const pushFlash = (type, text) => {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 3000)
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
      pushFlash('success', `Cleared ${result.removed || 0} failed item(s).`)
      await load()
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

  const financeRpcOk = health?.finance?.payments_rpc?.ok
  const diagnosticsOk = !health?.diagnostics?.error
  const cacheStale = syncDetails?.cacheStale?.active === true
  const pendingCount = Number(syncDetails?.pending?.length || health?.sync?.pending || 0)
  const failedCount = Number(syncDetails?.failed?.length || health?.sync?.failed || 0)
  const needsAttention = failedCount > 0 || pendingCount > 0 || cacheStale
  const reconciliationSummary = reconciliation?.summary || {}
  const validationTotals = validation?.totals || {}
  const financeMismatchCount = Number(reconciliationSummary.paymentMismatches || 0) + Number(reconciliationSummary.chargeMismatches || 0)
  const invoiceGapCount = Number(reconciliationSummary.invoiceGaps || 0) + Number(reconciliationSummary.orphanInvoices || 0)
  const getFailedItemBookingId = (item) => (
    item?.data?.p_booking_id
    || item?.data?.payload?.id
    || item?.data?.payload?.booking_id
    || item?.data?.p_id
    || null
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">System Health</h2>
          <p className="mt-1 text-sm text-gray-500">
            Check sync backlog, finance RPC readiness, backup availability, and profile diagnostics.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type="button"
          onClick={exportSupportBundle}
          disabled={actionBusy === 'support-bundle'}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <Download size={14} />
          {actionBusy === 'support-bundle' ? 'Saving…' : 'Export Support Bundle'}
        </button>
      </div>

      {flash && (
        <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${flash.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {flash.text}
        </div>
      )}

      {needsAttention && (
        <div className={`rounded-2xl px-5 py-4 shadow-sm ${
          failedCount > 0
            ? 'border border-red-200 bg-red-50'
            : 'border border-amber-200 bg-amber-50'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${failedCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
                {failedCount > 0
                  ? 'Some operations need manual review before staff can trust the latest data.'
                  : cacheStale
                    ? 'Fresh data is still retrying after a refresh failure.'
                    : 'The app is still syncing local work to the server.'}
              </p>
              <p className={`mt-1 text-sm ${failedCount > 0 ? 'text-red-800/80' : 'text-amber-800/80'}`}>
                {failedCount > 0 && `${failedCount} failed item${failedCount === 1 ? '' : 's'} parked for review. `}
                {pendingCount > 0 && `${pendingCount} pending item${pendingCount === 1 ? '' : 's'} still syncing. `}
                {cacheStale && `${syncDetails?.cacheStale?.names?.join(', ') || 'Booking'} data may still be catching up.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {failedCount > 0 && (
                <button
                  type="button"
                  onClick={retryFailed}
                  disabled={actionBusy === 'retry'}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-50 disabled:opacity-60"
                >
                  <RotateCcw size={13} />
                  {actionBusy === 'retry' ? 'Retrying…' : 'Retry Failed Items'}
                </button>
              )}
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                Refresh Health
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Wifi size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Connectivity</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{health?.online ? 'Online' : 'Offline'}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Pending sync: {health?.sync?.pending ?? 0}</p>
          {cacheStale && (
            <p className="mt-2 text-xs text-amber-700">
              Fresh {syncDetails?.cacheStale?.names?.join(', ') || 'booking'} data is still retrying after a refresh failure.
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><ShieldCheck size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Finance Contract</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{financeRpcOk ? 'Ready' : 'Needs attention'}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">{health?.finance?.payments_rpc?.message || 'Not checked yet.'}</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-2 text-amber-600"><AlertTriangle size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Failed Sync</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{health?.sync?.failed ?? 0}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Review, retry, or clear dead-lettered operations.</p>
          {cacheStale && (
            <p className="mt-2 text-xs text-amber-700">{syncDetails?.cacheStale?.lastError || 'A cache refresh is being retried in the background.'}</p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><HardDrive size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Backups</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{health?.backups?.backups?.length || 0} recent</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Latest local backup snapshots available on this machine.</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-rose-50 p-2 text-rose-600"><Database size={18} /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Reconciliation</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{financeMismatchCount + invoiceGapCount}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-500">Booking, payment, folio, and invoice mismatches that still need review.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Sync Recovery</h3>
              <p className="mt-1 text-xs text-gray-500">These entries failed repeated sync attempts and were parked locally.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={retryFailed}
                disabled={actionBusy === 'retry' || !syncDetails?.failed?.length}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60"
              >
                <RotateCcw size={13} />
                {actionBusy === 'retry' ? 'Retrying…' : 'Retry Failed'}
              </button>
              <button
                type="button"
                onClick={clearFailed}
                disabled={actionBusy === 'clear' || !syncDetails?.failed?.length}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
              >
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
              syncDetails.failed.slice(0, 8).map((item) => (
                <div key={item._queue_id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill ok={false} label={(item.type || 'op').toUpperCase()} />
                      <span className="text-sm font-semibold text-gray-900">{item.table || 'Unknown operation'}</span>
                    </div>
                    <span className="text-xs text-gray-400">{item.lastAttemptedAt ? new Date(item.lastAttemptedAt).toLocaleString('en-GB') : 'Not attempted recently'}</span>
                  </div>
                  <p className="mt-2 text-sm text-red-700">{item.lastError || 'Unknown sync failure'}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-500">Queue ID: {item._queue_id || '—'}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {getFailedItemBookingId(item) && (
                        <button
                          type="button"
                          onClick={() => navigate('/bookings', {
                            state: item.table === 'update_booking_payment'
                              ? { collectPaymentBookingId: getFailedItemBookingId(item) }
                              : { reviewBookingId: getFailedItemBookingId(item) }
                          })}
                          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                          Open in Bookings
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => retryFailedItem(item._queue_id)}
                        disabled={actionBusy === `retry:${item._queue_id}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60"
                      >
                        <RotateCcw size={12} />
                        {actionBusy === `retry:${item._queue_id}` ? 'Retrying…' : 'Retry This Item'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Financial Reconciliation</h3>
                <p className="mt-1 text-xs text-gray-500">Cross-check booking snapshots against payment, folio, and invoice data.</p>
              </div>
              <StatusPill ok={financeMismatchCount + invoiceGapCount === 0} label={financeMismatchCount + invoiceGapCount === 0 ? 'Clear' : `${financeMismatchCount + invoiceGapCount} issues`} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Payment mismatches</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{reconciliationSummary.paymentMismatches || 0}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Charge mismatches</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{reconciliationSummary.chargeMismatches || 0}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Invoice gaps</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{reconciliationSummary.invoiceGaps || 0}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Orphan invoices</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{reconciliationSummary.orphanInvoices || 0}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(reconciliation?.paymentMismatches || []).slice(0, 2).map((item) => (
                <div key={`pay-${item.booking_id}`} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <p className="text-sm font-semibold text-rose-900">Payment mismatch · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                  <p className="mt-1 text-sm text-rose-800/80">Booking shows {Number(item.booking_amount_paid || 0).toFixed(2)} but payment ledger totals {Number(item.payment_ledger_total || 0).toFixed(2)}.</p>
                </div>
              ))}
              {(reconciliation?.chargeMismatches || []).slice(0, 2).map((item) => (
                <div key={`charge-${item.booking_id}`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-900">Charge mismatch · {item.invoice_number || String(item.booking_id).slice(0, 8)}</p>
                  <p className="mt-1 text-sm text-amber-800/80">Booking shows {Number(item.booking_charges_total || 0).toFixed(2)} but active charges total {Number(item.charge_ledger_total || 0).toFixed(2)}.</p>
                </div>
              ))}
              {(reconciliation?.invoiceGaps || []).slice(0, 2).map((item) => (
                <div key={`gap-${item.booking_id}`} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-900">Invoice gap · {String(item.booking_id).slice(0, 8)}</p>
                  <p className="mt-1 text-sm text-blue-800/80">{item.missing_invoice_number ? 'Missing invoice number.' : 'Invoice number exists but no invoice row was found.'}</p>
                </div>
              ))}
              {financeMismatchCount + invoiceGapCount === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No reconciliation mismatches detected in the current live snapshot.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Validation Snapshot</h3>
                <p className="mt-1 text-xs text-gray-500">Recent refund and charge-void activity surfaced for finance review.</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill ok={(validationTotals.recent_refunds || 0) + (validationTotals.recent_charge_voids || 0) === 0} label={`${validationTotals.recent_refunds || 0} refunds · ${validationTotals.recent_charge_voids || 0} voids`} />
                <button
                  type="button"
                  onClick={runValidationNow}
                  disabled={actionBusy === 'validation'}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60"
                >
                  <RefreshCw size={12} className={actionBusy === 'validation' ? 'animate-spin' : ''} />
                  {actionBusy === 'validation' ? 'Running…' : 'Run Now'}
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(validation?.recentRefunds || []).map((item, index) => (
                <div key={`refund-${item.booking_id || index}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">Refund recorded</p>
                  <p className="mt-1 text-sm text-gray-600">Booking {String(item.booking_id || '').slice(0, 8)} · {Number(item.amount_delta || 0).toFixed(2)} · {item.created_at ? new Date(item.created_at).toLocaleString('en-GB') : 'Time unknown'}</p>
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
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Validation Alerts</h4>
                  <p className="mt-1 text-xs text-gray-500">Specific reconciliation exceptions captured by the app or server snapshot.</p>
                </div>
                <StatusPill ok={validationAlerts.length === 0} label={validationAlerts.length === 0 ? 'No alerts' : `${validationAlerts.length} logged`} />
              </div>
              <div className="mt-3 space-y-3">
                {validationAlerts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                    No recent validation alerts were logged.
                  </div>
                ) : (
                  validationAlerts.slice(0, 5).map((entry, index) => (
                    <div key={`${entry.id || entry.detected_at || 'alert'}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-900">{entry.alert_type || entry.type || 'Validation alert'}</p>
                        <span className="text-xs text-amber-700/80">
                          {entry.detected_at ? new Date(entry.detected_at).toLocaleString('en-GB') : 'Time unknown'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-amber-800/80">{entry.message || entry.summary || entry.lastError || 'Validation alert captured for finance review.'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Validation Run History</h4>
                  <p className="mt-1 text-xs text-gray-500">Daily startup and scheduled checks recorded by the app.</p>
                </div>
                <StatusPill ok={validationRuns.length > 0} label={validationRuns.length > 0 ? `${validationRuns.length} logged` : 'No runs yet'} />
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
                        <span className="text-xs text-gray-400">{run.created_at ? new Date(run.created_at).toLocaleString('en-GB') : 'Time unknown'}</span>
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
                criticalErrors.map((entry, index) => (
                  <div key={`${entry.at || entry.operation || 'critical'}-${index}`} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-rose-900">{entry.scope || entry.operation || 'critical.error'}</p>
                      <span className="text-xs text-rose-700/80">
                        {entry.at ? new Date(entry.at).toLocaleString('en-GB') : 'Time unknown'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-rose-800/80">{entry.message || 'No message recorded.'}</p>
                    {(entry.lodge_id || entry.user_id) && (
                      <p className="mt-1 text-xs text-rose-700/70">
                        Lodge: {entry.lodge_id || '—'} · User: {entry.user_id || '—'}
                      </p>
                    )}
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <details className="mt-2 text-xs text-rose-800/80">
                        <summary className="cursor-pointer font-medium text-rose-900">Show context</summary>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-[11px] leading-5 text-rose-800 ring-1 ring-rose-100">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Recent App Errors</h3>
                <p className="mt-1 text-xs text-gray-500">Useful when the recovery screen appears and you need the latest renderer crash context.</p>
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
                      <span className="text-xs text-gray-400">
                        {entry.at ? new Date(entry.at).toLocaleString('en-GB') : 'Time not recorded'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Route: {entry.route || 'Unknown route'}
                    </p>
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

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Pending Sync Queue</h3>
                <p className="mt-1 text-xs text-gray-500">Recent local operations still waiting to reach the server.</p>
              </div>
              <StatusPill ok={pendingCount === 0} label={pendingCount === 0 ? 'Clear' : `${pendingCount} pending`} />
            </div>
            <div className="mt-4 space-y-3">
              {!syncDetails?.pending?.length ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No pending sync items right now.
                </div>
              ) : (
                syncDetails.pending.slice(0, 6).map((item) => (
                  <div key={item._queue_id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusPill ok={false} label={(item.type || 'op').toUpperCase()} />
                        <span className="text-sm font-semibold text-gray-900">{item.table || 'Queued operation'}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB') : 'Queued locally'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      Queue ID: {item._queue_id || '—'}
                    </p>
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

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><Database size={18} /></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Backup Snapshot</h3>
                <p className="mt-1 text-xs text-gray-500">Recent local backup state on this machine.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(health?.backups?.backups || []).slice(0, 5).map((backup) => (
                <div key={backup.name} className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <p className="font-medium text-gray-900">{backup.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{new Date(backup.created).toLocaleString('en-GB')}</p>
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
    </div>
  )
}
