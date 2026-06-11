import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MailWarning,
  RefreshCw,
  Shield,
  TrendingDown,
  XCircle,
  Zap
} from 'lucide-react'
import { localToday } from '../../utils/localDate'

function fmt(currency, val) {
  return `${currency} ${Number(val || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── PaymentPreviewModal ──────────────────────────────────────────────────────
function PaymentPreviewModal({ preview, currency, onConfirm, onAdjust, onCancel, executing }) {
  const isHighValue = preview?.high_value
  const [hvConfirmed, setHvConfirmed] = useState(false)
  const canConfirm = !isHighValue || hvConfirmed

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className={`px-6 py-5 ${isHighValue ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-emerald-600 to-teal-600'}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20">
              {isHighValue ? <AlertTriangle size={20} className="text-white" /> : <Zap size={20} className="text-white" />}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
                {isHighValue ? 'High-Value Operation' : 'Confirm Collection'}
              </p>
              <p className="text-2xl font-black text-white">{fmt(currency, preview?.total)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-white/80 text-xs">
            <span><strong className="text-white">{preview?.count}</strong> bookings</span>
            <span className="capitalize"><strong className="text-white">{preview?.method}</strong></span>
          </div>
        </div>

        {/* Item list */}
        <div className="max-h-52 overflow-y-auto divide-y divide-slate-50 border-b border-slate-100">
          {(preview?.items || []).map((item) => (
            <div key={item.booking_id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
              <div className={`h-2 w-2 rounded-full shrink-0 ${
                item.bucket === 'overdue' ? 'bg-rose-500' :
                item.bucket === 'due_today' ? 'bg-amber-500' : 'bg-sky-400'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">{item.guest}</p>
                <p className="text-[10px] text-slate-400">{item.room_number ? `Rm ${item.room_number}` : ''} · {item.bucket === 'due_today' ? 'Due today' : item.bucket}</p>
              </div>
              <span className="text-xs font-bold text-slate-800 shrink-0">{fmt(currency, item.amount)}</span>
            </div>
          ))}
        </div>

        {/* High-value gate */}
        {isHighValue && (
          <div className="mx-5 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <Shield size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-800">High-value operation above {fmt(currency, preview?.high_value_threshold)}</p>
                <p className="text-[10px] text-amber-700 mt-0.5">Please confirm you have authorised this collection.</p>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hvConfirmed}
                onChange={(e) => setHvConfirmed(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 text-amber-600"
              />
              <span className="text-xs font-semibold text-amber-800">I authorise this high-value collection</span>
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="p-5 space-y-2">
          <button
            type="button"
            id="btn-confirm-execute"
            onClick={onConfirm}
            disabled={!canConfirm || executing}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-40"
          >
            {executing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {executing ? 'Processing…' : '✅ Confirm & Execute'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onAdjust}
              disabled={executing}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
            >
              ✏️ Adjust Selection
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={executing}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition disabled:opacity-40"
            >
              ❌ Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ExecutionFeed ────────────────────────────────────────────────────────────
function ExecutionFeed({ log, total, currency }) {
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log])

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Executing · {log.filter(l => l.type !== 'started').length} / {total}</p>
        </div>
      </div>
      <div className="max-h-52 overflow-y-auto p-4 space-y-1.5 font-mono text-[11px]">
        {log.map((entry, i) => {
          if (entry.type === 'started') return (
            <p key={i} className="text-slate-400">✔ Found {entry.total} unpaid bookings</p>
          )
          if (entry.type === 'processing') return (
            <p key={i} className="text-sky-300">→ Processing <strong>{entry.guest}</strong> ({fmt(currency, entry.amount)})</p>
          )
          if (entry.type === 'success') return (
            <p key={i} className="text-emerald-400">✔ Payment recorded — {entry.guest}</p>
          )
          if (entry.type === 'error') return (
            <p key={i} className="text-rose-400">⚠ Failed: {entry.guest} — {entry.error}</p>
          )
          if (entry.type === 'skipped') return (
            <p key={i} className="text-slate-500">⊘ Skipped: {entry.guest}</p>
          )
          if (entry.type === 'complete') return (
            <p key={i} className="text-emerald-300 mt-2 border-t border-white/10 pt-2">
              ✔ Done · {entry.success_count} paid · {entry.error_count} failed · {entry.skip_count} skipped
            </p>
          )
          return null
        })}
        <div ref={endRef} />
      </div>
    </div>
  )
}

// ─── BatchResultSummary ───────────────────────────────────────────────────────
function BatchResultSummary({ result, currency, onRetryFailed, onDismiss }) {
  const failed = (result?.results || []).filter(r => r.status === 'error')
  const hasErrors = failed.length > 0

  return (
    <div className={`rounded-2xl border overflow-hidden ${hasErrors ? 'border-amber-200' : 'border-emerald-200'}`}>
      <div className={`px-4 py-3 ${hasErrors ? 'bg-amber-50' : 'bg-emerald-50'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasErrors
              ? <AlertTriangle size={16} className="text-amber-600" />
              : <CheckCircle2 size={16} className="text-emerald-600" />
            }
            <p className={`text-xs font-bold ${hasErrors ? 'text-amber-800' : 'text-emerald-800'}`}>
              Batch Complete
            </p>
          </div>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
            <XCircle size={14} />
          </button>
        </div>
        <div className="mt-2 flex gap-4 text-[11px]">
          <span className="text-emerald-700 font-semibold">✅ {result?.success_count} successful</span>
          {result?.skip_count > 0 && <span className="text-slate-500">⊘ {result?.skip_count} skipped</span>}
          {hasErrors && <span className="text-rose-600 font-semibold">⚠ {result?.error_count} failed</span>}
        </div>
      </div>
      {hasErrors && (
        <div className="border-t border-amber-100 divide-y divide-amber-50">
          {failed.slice(0, 3).map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2">
              <span className="text-[10px] text-rose-600 flex-1 truncate">{r.guest} — {r.error}</span>
            </div>
          ))}
          <div className="px-4 py-2 flex gap-2">
            <button
              onClick={onRetryFailed}
              className="text-[11px] font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1"
            >
              <RefreshCw size={11} /> Retry Failed
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CollectionsCard (main export) ───────────────────────────────────────────
export default function CollectionsCard({ currency = 'P', onSendToChat }) {
  const [summary, setSummary] = useState(null)
  const [loadBusy, setLoadBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [method, setMethod] = useState('cash')

  // Preview flow state
  const [phase, setPhase] = useState('idle') // idle | previewing | executing | done
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [execLog, setExecLog] = useState([])
  const [batchResult, setBatchResult] = useState(null)

  const load = useCallback(async () => {
    setLoadBusy(true)
    setLoadError('')
    try {
      const res = await window.api.ai.collections.preview({ booking_ids: [], method })
      if (!res?.success) throw new Error(res?.error || 'Failed.')
      setSummary(res)
      setSelectedIds((res.items || []).map(i => i.booking_id))
    } catch (e) {
      setLoadError(e?.message || 'Failed to load.')
    } finally {
      setLoadBusy(false)
    }
  }, [method])

  useEffect(() => { load() }, [load])

  // Subscribe to progress events
  useEffect(() => {
    const unsub = window.api.ai.collections.onProgress((data) => {
      setExecLog(prev => [...prev, data])
    })
    return unsub
  }, [])

  const handleCollectAll = async () => {
    if (previewBusy || selectedIds.length === 0) return
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const res = await window.api.ai.collections.preview({ booking_ids: selectedIds, method })
      if (!res?.success) throw new Error(res?.error || 'Preview failed.')
      setPreview(res)
      setPhase('previewing')
    } catch (e) {
      setPreviewError(e?.message || 'Preview failed.')
    } finally {
      setPreviewBusy(false)
    }
  }

  const handleConfirmExecute = async () => {
    if (!preview) return
    setPhase('executing')
    setExecLog([])
    try {
      const res = await window.api.ai.collections.execute({
        items: preview.items,
        method: preview.method
      })
      setBatchResult(res)
      setPhase('done')
      await load()
    } catch (e) {
      setBatchResult({ success: false, error: e?.message })
      setPhase('done')
    }
  }

  const handleRetryFailed = async () => {
    if (!batchResult) return
    const failedItems = (batchResult.results || [])
      .filter(r => r.status === 'error')
      .map(r => ({ booking_id: r.booking_id, guest: r.guest, amount: r.amount }))
    if (!failedItems.length) return
    setPhase('executing')
    setExecLog([])
    try {
      const res = await window.api.ai.collections.execute({ items: failedItems, method })
      setBatchResult(res)
      setPhase('done')
      await load()
    } catch (e) {
      setBatchResult({ success: false, error: e?.message })
    }
  }

  const todayStr = localToday()
  const overdueTotal = (summary?.items || []).filter(i => i.bucket === 'overdue').reduce((s, i) => s + i.amount, 0)
  const todayTotal = (summary?.items || []).filter(i => i.bucket === 'due_today').reduce((s, i) => s + i.amount, 0)
  const futureTotal = (summary?.items || []).filter(i => i.bucket === 'future').reduce((s, i) => s + i.amount, 0)
  const overdueCount = (summary?.items || []).filter(i => i.bucket === 'overdue').length
  const todayCount = (summary?.items || []).filter(i => i.bucket === 'due_today').length
  const futureCount = (summary?.items || []).filter(i => i.bucket === 'future').length

  return (
    <>
      {/* Preview Modal */}
      {phase === 'previewing' && preview && (
        <PaymentPreviewModal
          preview={preview}
          currency={currency}
          executing={false}
          onConfirm={handleConfirmExecute}
          onAdjust={() => { setPhase('idle'); setPreview(null) }}
          onCancel={() => { setPhase('idle'); setPreview(null) }}
        />
      )}

      <div className="bb-card overflow-hidden p-0">
        {/* Gradient header */}
        <div className="flex items-start justify-between bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 px-5 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Collections Intelligence</p>
            {loadBusy ? (
              <div className="mt-2 flex items-center gap-2 text-white/70">
                <Loader2 size={15} className="animate-spin" />
                <span className="text-xs">Loading…</span>
              </div>
            ) : summary ? (
              <>
                <p className="mt-1 text-3xl font-black text-white tracking-tight">{fmt(currency, summary.total)}</p>
                <p className="mt-0.5 text-[11px] text-white/80">{summary.count} unpaid bookings</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-white/60">{loadError || 'No data'}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <TrendingDown size={30} className="text-white/20" />
            <button
              type="button"
              onClick={load}
              disabled={loadBusy}
              className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-white/30 transition disabled:opacity-50"
            >
              <RefreshCw size={10} className={loadBusy ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {/* Bucket pills */}
        {summary && (
          <div className="grid grid-cols-3 gap-2 p-4">
            {[
              { label: 'Overdue', count: overdueCount, total: overdueTotal, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
              { label: 'Due Today', count: todayCount, total: todayTotal, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
              { label: 'Upcoming', count: futureCount, total: futureTotal, cls: 'border-sky-200 bg-sky-50 text-sky-700' }
            ].map(({ label, count, total, cls }) => (
              <div key={label} className={`rounded-2xl border px-3 py-3 ${cls}`}>
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-70">{label}</p>
                <p className="mt-1 text-lg font-black">{count}</p>
                <p className="text-[10px] font-semibold opacity-80">{fmt(currency, total)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Unpaid table (collapsible) */}
        {summary && summary.count > 0 && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition"
            >
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                Unpaid Bookings — {summary.count}
                {selectedIds.length !== summary.count && (
                  <span className="ml-2 text-emerald-600">({selectedIds.length} selected)</span>
                )}
              </span>
              {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
            </button>

            {expanded && (
              <div className="max-h-52 overflow-y-auto border-t border-slate-100 divide-y divide-slate-50">
                {/* Select all */}
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === summary.count}
                    onChange={(e) => setSelectedIds(e.target.checked ? summary.items.map(i => i.booking_id) : [])}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                  />
                  <span className="text-[10px] font-bold uppercase text-slate-500">Select all</span>
                </div>
                {(summary.items || []).map((item) => (
                  <div key={item.booking_id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.booking_id)}
                      onChange={(e) => setSelectedIds(prev =>
                        e.target.checked ? [...prev, item.booking_id] : prev.filter(x => x !== item.booking_id)
                      )}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">{item.guest}</p>
                      <p className="text-[10px] text-slate-500">{item.room_number ? `Rm ${item.room_number}` : '—'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                      item.bucket === 'overdue' ? 'bg-rose-100 text-rose-700' :
                      item.bucket === 'due_today' ? 'bg-amber-100 text-amber-700' :
                      'bg-sky-100 text-sky-700'
                    }`}>{item.bucket === 'due_today' ? 'today' : item.bucket}</span>
                    <span className="shrink-0 text-xs font-bold text-rose-600">{fmt(currency, item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Execution feed */}
        {(phase === 'executing' || (phase === 'done' && execLog.length > 0)) && (
          <div className="p-4 border-t border-slate-100">
            <ExecutionFeed log={execLog} total={preview?.count || 0} currency={currency} />
          </div>
        )}

        {/* Batch result */}
        {phase === 'done' && batchResult && (
          <div className="px-4 pb-4">
            <BatchResultSummary
              result={batchResult}
              currency={currency}
              onRetryFailed={handleRetryFailed}
              onDismiss={() => { setPhase('idle'); setBatchResult(null); setExecLog([]) }}
            />
          </div>
        )}

        {/* Action bar */}
        {summary && phase === 'idle' && (
          <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
            {previewError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {previewError}
              </div>
            )}

            {/* Method selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Method:</span>
              {['cash', 'card', 'transfer'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase transition ${
                    method === m
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-400'
                  }`}
                >{m}</button>
              ))}
            </div>

            {/* Collect All CTA */}
            <button
              type="button"
              id="btn-collect-all"
              disabled={previewBusy || selectedIds.length === 0}
              onClick={handleCollectAll}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {previewBusy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {previewBusy ? 'Generating preview…' : `✅ Collect All (${selectedIds.length})`}
            </button>

            {/* Secondary actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onSendToChat?.('Send payment reminders to all guests with unpaid bookings')}
                className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <MailWarning size={12} /> 📩 Remind
              </button>
              <button
                type="button"
                onClick={() => { setExpanded(true); onSendToChat?.('Show unpaid bookings with full details') }}
                className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowRight size={12} /> 🔍 Review
              </button>
            </div>

            <p className="text-[10px] text-slate-400 text-center">
              Preview shown before any payment is processed.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
