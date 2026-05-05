import { useEffect, useState, useCallback, useRef } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  DollarSign,
  ShieldAlert,
  Sparkles,
  Loader2,
  ExternalLink,
  X,
  ShieldCheck
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function fmt(val) {
  return `P ${Number(val || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const ACTION_HANDLERS = {
  fix_unpaid: {
    preview: () => window.api.ai.collections.preview({}),
    execute: (payload) => window.api.ai.collections.execute(payload),
    subscribe: (cb) => window.api.ai.collections.onProgress(cb),
    normalize: (data) => {
      const items = (data?.items || []).map(b => ({
        id: b.booking_id || b.id,
        guest: b.guest || 'Guest',
        room: b.room_number || b.room || null,
        balance: b.amount || b.balance || 0,
        bucket: b.bucket || null,
        status: b.status || null,
        check_in: b.check_in || null,
        check_out: b.check_out || null
      }))
      return { items, total: data?.total || 0, count: data?.count || items.length }
    },
    buildPayload: (selectedIds, items) => ({
      items: items.filter(i => selectedIds.includes(i.id)),
      method: 'cash'
    })
  },
  resolve_overdue: {
    preview: () => window.api.ai.overdue.preview({}),
    execute: (payload) => window.api.ai.overdue.execute(payload),
    subscribe: (cb) => window.api.ai.overdue.onProgress(cb),
    normalize: (data) => {
      const items = (data?.bookings || []).map(b => ({
        id: b.id,
        guest: b.guest || 'Guest',
        room: b.room || null,
        balance: b.balance || 0,
        check_in: b.check_in || null,
        check_out: b.check_out || null,
        status: b.status || null
      }))
      return { items, total: items.reduce((s, i) => s + i.balance, 0), count: data?.count || items.length }
    },
    buildPayload: (selectedIds) => ({ booking_ids: [...new Set(selectedIds)] })
  },
  investigate_fraud: {
    preview: () => window.api.ai.turn({ message: 'Run detect_payment_anomalies tool now.', model: 'gemini-2.5-flash' }),
    execute: null,
    subscribe: null,
    normalize: (data) => ({ items: [], total: 0, count: 0, fraudData: data }),
    buildPayload: null
  }
}

function FeedItem({ item }) {
  const Icon =
    item.status === 'success' ? CheckCircle2 :
    item.status === 'error'   ? XCircle :
    item.status === 'warn'    ? AlertTriangle :
                                Loader2

  const color =
    item.status === 'success' ? 'text-emerald-600' :
    item.status === 'error'   ? 'text-rose-600' :
    item.status === 'warn'    ? 'text-amber-600' :
                                'text-slate-400'

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
      <Icon size={15} className={`shrink-0 ${color} ${item.status === 'loading' ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 truncate">{item.label}</p>
        {item.sub && <p className="text-xs text-slate-400 mt-0.5">{item.sub}</p>}
      </div>
      {item.amount && (
        <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg">{fmt(item.amount)}</span>
      )}
    </div>
  )
}

function CollectionsPreview({ items, total, count, selectedIds, toggleSelect, selectAll, clearAll, allSelected, selectedTotal, onConfirm, onCancel, busy, executing }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Total Outstanding</p>
          <p className="text-2xl font-black text-emerald-800 mt-0.5">{fmt(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Selected</p>
          <p className="text-2xl font-black text-emerald-700 mt-0.5">{selectedIds.length}/{count}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={selectAll}
          className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-600 hover:text-emerald-800 transition"
        >
          Select all
        </button>
        <span className="text-slate-300">|</span>
        <button
          type="button"
          onClick={clearAll}
          className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 hover:text-slate-600 transition"
        >
          Clear all
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
        {items.slice(0, 20).map(r => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={selectedIds.includes(r.id)}
              onChange={() => toggleSelect(r.id)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{r.guest}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.room ? `Room ${r.room}` : ''}{r.room && r.bucket ? ' · ' : ''}{r.bucket === 'overdue' ? 'Overdue' : r.bucket === 'due_today' ? 'Due today' : r.bucket || ''}
              </p>
            </div>
            <span className="shrink-0 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">{fmt(r.balance)}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-4 py-6 text-sm text-center text-slate-400">No unpaid bookings found.</div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck size={12} className="text-slate-300" />
        All actions are processed securely using verified financial operations
      </p>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={executing || busy || selectedIds.length === 0}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy || executing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Confirm & Collect {fmt(selectedTotal)}
        </button>
        <button
          onClick={onCancel}
          disabled={executing}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <X size={15} />
          Cancel
        </button>
      </div>
    </div>
  )
}

function OverduePreview({ items, count, selectedIds, toggleSelect, selectAll, clearAll, allSelected, onConfirm, onCancel, busy, executing }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700">Overdue Checkouts</p>
          <p className="text-2xl font-black text-orange-800 mt-0.5">{count} rooms</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600">Selected</p>
          <p className="text-2xl font-black text-orange-700 mt-0.5">{selectedIds.length}/{count}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={selectAll}
          className="text-[10px] font-bold uppercase tracking-[0.15em] text-orange-600 hover:text-orange-800 transition"
        >
          Select all
        </button>
        <span className="text-slate-300">|</span>
        <button
          type="button"
          onClick={clearAll}
          className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 hover:text-slate-600 transition"
        >
          Clear all
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
        {items.slice(0, 20).map(r => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={selectedIds.includes(r.id)}
              onChange={() => toggleSelect(r.id)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{r.guest}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.room ? `Room ${r.room}` : ''}{r.check_out ? ` · Was due ${r.check_out.slice(0, 10)}` : ''}
              </p>
            </div>
            {r.balance > 0 && (
              <span className="shrink-0 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">{fmt(r.balance)} owed</span>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="px-4 py-6 text-sm text-center text-slate-400">No overdue checkouts found.</div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck size={12} className="text-slate-300" />
        All actions are processed securely using verified financial operations
      </p>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={executing || busy || selectedIds.length === 0}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-700 disabled:opacity-50"
        >
          {busy || executing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Check Out {selectedIds.length} {selectedIds.length === 1 ? 'Room' : 'Rooms'}
        </button>
        <button
          onClick={onCancel}
          disabled={executing}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <X size={15} />
          Cancel
        </button>
      </div>
    </div>
  )
}

function FraudPreview({ data, onOpenInAi, onCancel }) {
  const summary = data?.summary || {}
  const clusters = data?.clusters || []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Critical', value: summary.critical || 0, color: 'bg-rose-50 border-rose-200 text-rose-800' },
          { label: 'High Risk', value: summary.high || 0, color: 'bg-orange-50 border-orange-200 text-orange-800' },
          { label: 'Medium', value: summary.medium || 0, color: 'bg-amber-50 border-amber-200 text-amber-800' },
          { label: 'Low', value: summary.low || 0, color: 'bg-slate-50 border-slate-200 text-slate-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-xl border px-3 py-2 ${color}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-black mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
        {clusters.slice(0, 5).map((cluster, i) => (
          <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{cluster.user || 'Unknown user'}</p>
              <p className="text-xs text-slate-400 mt-0.5">{cluster.alerts?.length || 0} alert{cluster.alerts?.length !== 1 ? 's' : ''} · {cluster.severity}</p>
            </div>
            <span className={`shrink-0 text-xs font-black px-2.5 py-1 rounded-lg ${
              cluster.severity === 'critical' ? 'bg-rose-600 text-white' :
              cluster.severity === 'high'     ? 'bg-orange-500 text-white' :
                                                'bg-slate-200 text-slate-700'
            }`}>
              {cluster.risk_score}
            </span>
          </div>
        ))}
        {clusters.length === 0 && (
          <div className="px-4 py-6 text-sm text-center text-slate-400">No active fraud clusters.</div>
        )}
      </div>

      <p className="text-xs text-slate-500 text-center">Fraud investigations require human review. Open in Ops AI for full forensic tools.</p>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onOpenInAi}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <ShieldAlert size={15} />
          Investigate in Ops AI
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <X size={15} />
          Dismiss
        </button>
      </div>
    </div>
  )
}

function ResultSummary({ feed, onRetryFailed, onDone }) {
  const successCount = feed.filter(f => f.status === 'success').length
  const errorCount = feed.filter(f => f.status === 'error').length
  const allOk = errorCount === 0 && successCount > 0

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border px-4 py-4 flex items-center gap-4 ${allOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        {allOk
          ? <CheckCircle2 size={24} className="text-emerald-600 shrink-0" />
          : <AlertTriangle size={24} className="text-amber-600 shrink-0" />
        }
        <div>
          <p className="text-sm font-black text-slate-900">
            {allOk ? 'Completed successfully' : 'Completed with warnings'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {successCount} succeeded · {errorCount} failed
          </p>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 px-3 py-1">
        {feed.map((item, i) => <FeedItem key={item.id || i} item={item} />)}
      </div>

      <div className="flex gap-2">
        {errorCount > 0 && (
          <button
            onClick={onRetryFailed}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 transition hover:bg-amber-100"
          >
            <XCircle size={15} />
            Retry {errorCount} Failed
          </button>
        )}
        <button
          onClick={onDone}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white transition ${
            allOk ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-900 hover:bg-slate-800'
          } ${errorCount > 0 ? '' : 'w-full'}`}
        >
          <CheckCircle2 size={15} />
          Done
        </button>
      </div>
    </div>
  )
}

export default function InlineAiExecutionPanel({ action, onClose, onRefreshData }) {
  const navigate = useNavigate()
  const panelRef = useRef(null)
  const executingRef = useRef(false)
  const autoCloseRef = useRef(null)

  const [phase, setPhase] = useState('loading')
  const [normalized, setNormalized] = useState({ items: [], total: 0, count: 0 })
  const [rawData, setRawData] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [feed, setFeed] = useState([])
  const [error, setError] = useState(null)
  const [finalResult, setFinalResult] = useState(null)

  const actionType = action?.type
  const handler = ACTION_HANDLERS[actionType]

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(normalized.items.map(i => i.id))
  }, [normalized.items])

  const clearAll = useCallback(() => {
    setSelectedIds([])
  }, [])

  useEffect(() => {
    if (!action || !handler) return
    setPhase('loading')
    setNormalized({ items: [], total: 0, count: 0 })
    setRawData(null)
    setSelectedIds([])
    setFeed([])
    setError(null)
    setFinalResult(null)
    executingRef.current = false
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current)
      autoCloseRef.current = null
    }

    let cancelled = false

    handler.preview()
      .then(res => {
        if (cancelled) return
        if (!res?.success && res?.error) {
          setError(res.error)
          setPhase('error')
          return
        }
        const norm = handler.normalize(res)
        setRawData(res)
        if (actionType === 'investigate_fraud') {
          setNormalized(norm)
          setPhase('preview')
          return
        }
        const eligibleIds = norm.items
          .filter(i => {
            if (actionType === 'fix_unpaid') return i.balance > 0.01 && i.status !== 'cancelled' && i.status !== 'checked_out'
            if (actionType === 'resolve_overdue') return i.status === 'checked_in' || i.status === 'confirmed'
            return true
          })
          .map(i => i.id)
        setNormalized(norm)
        setSelectedIds([...new Set(eligibleIds)])
        if (eligibleIds.length === 0) {
          setPhase('empty')
        } else {
          setPhase('preview')
        }
      })
      .catch(e => {
        if (cancelled) return
        setError(e?.message || 'Failed to load preview')
        setPhase('error')
      })

    return () => { cancelled = true }
  }, [action, actionType])

  useEffect(() => {
    if (!actionType || actionType === 'investigate_fraud') return
    if (!handler?.subscribe) return

    const unsubscribe = handler.subscribe((event) => {
      if (!event) return
      const id = `${event.type}-${event.booking_id || event.index || ''}-${event.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      if (event.type === 'started') return
      if (event.type === 'complete') return
      if (event.type === 'processing') {
        const match = normalized.items.find(i => i.id === event.booking_id)
        setFeed(prev => {
          const next = [...prev, {
            id,
            label: match?.guest || `Booking ${String(event.booking_id || '').slice(-6)}`,
            status: 'loading',
            sub: 'Processing\u2026',
            timestamp: event.timestamp || Date.now()
          }]
          return next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        })
        return
      }
      if (event.type === 'success') {
        const match = normalized.items.find(i => i.id === event.booking_id)
        const amount = match?.balance || event.amount || 0
        setFeed(prev => {
          const next = [...prev, {
            id,
            label: match?.guest || `Booking ${String(event.booking_id || '').slice(-6)}`,
            status: 'success',
            sub: actionType === 'fix_unpaid' ? 'Payment recorded' : 'Checked out',
            amount: actionType === 'fix_unpaid' ? amount : undefined,
            timestamp: event.timestamp || Date.now()
          }]
          return next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        })
        return
      }
      if (event.type === 'error') {
        const match = normalized.items.find(i => i.id === event.booking_id)
        setFeed(prev => {
          const next = [...prev, {
            id,
            label: match?.guest || `Booking ${String(event.booking_id || '').slice(-6)}`,
            status: 'error',
            sub: event.error || 'Failed',
            timestamp: event.timestamp || Date.now()
          }]
          return next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        })
        return
      }
      if (event.type === 'skipped') {
        const match = normalized.items.find(i => i.id === event.booking_id)
        setFeed(prev => {
          const next = [...prev, {
            id,
            label: match?.guest || `Booking ${String(event.booking_id || '').slice(-6)}`,
            status: 'warn',
            sub: event.reason || 'Skipped',
            timestamp: event.timestamp || Date.now()
          }]
          return next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        })
        return
      }
    })

    return () => { unsubscribe?.() }
  }, [actionType, normalized.items])

  const handleConfirm = useCallback(async () => {
    if (!handler || phase === 'executing' || executingRef.current) return
    if (!handler.execute) {
      navigate('/ai', { state: { initialPrompt: action?.label || '' } })
      onClose?.()
      return
    }

    const uniqueIds = [...new Set(selectedIds)]
    if (uniqueIds.length === 0) {
      setError('No bookings selected')
      setPhase('error')
      return
    }

    setSelectedIds(uniqueIds)
    executingRef.current = true
    setPhase('executing')
    setFeed([])
    setError(null)

    try {
      const payload = handler.buildPayload(uniqueIds, normalized.items)
      const result = await handler.execute(payload)

      if (!result?.success && result?.error) {
        setError(result.error)
        setPhase('error')
        executingRef.current = false
        return
      }

      setFinalResult(result)

      const ipcSuccessCount = (result.results || []).filter(r => r.status === 'paid' || r.status === 'checked_out').length
      const ipcErrorCount = (result.results || []).filter(r => r.status === 'error').length
      const ipcSkippedCount = (result.results || []).filter(r => r.status === 'skipped').length

      if (feed.length === 0) {
        const items = normalized.items.filter(i => uniqueIds.includes(i.id))
        items.forEach((i, idx) => {
          const matchResult = (result.results || []).find(r => r.booking_id === i.id)
          let status = 'success'
          let sub = actionType === 'fix_unpaid' ? 'Payment recorded' : 'Checked out'
          if (matchResult) {
            if (matchResult.status === 'error') { status = 'error'; sub = matchResult.error || 'Failed' }
            else if (matchResult.status === 'skipped') { status = 'warn'; sub = matchResult.reason || 'Skipped' }
          }
          setFeed(prev => {
            const next = [...prev, {
              id: `sync-${i.id}-${Date.now() + idx}`,
              label: i.guest,
              status,
              sub,
              amount: actionType === 'fix_unpaid' ? i.balance : undefined,
              timestamp: Date.now() + idx
            }]
            return next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          })
        })
      }

      setPhase('result')
      if (onRefreshData) onRefreshData()
    } catch (e) {
      setError(e?.message || 'Execution failed')
      setPhase('error')
    } finally {
      executingRef.current = false
    }
  }, [handler, phase, selectedIds, normalized.items, actionType, feed.length, navigate, action, onClose, onRefreshData])

  const handleRetryFailed = useCallback(() => {
    if (!finalResult) return
    const failedIds = [...new Set(
      (finalResult.results || [])
        .filter(r => r.status === 'error')
        .map(r => r.booking_id)
        .filter(Boolean)
    )]
    if (failedIds.length === 0) return
    setSelectedIds(failedIds)
    setPhase('preview')
    setError(null)
    setFinalResult(null)
    setFeed([])
  }, [finalResult])

  useEffect(() => {
    if (phase === 'result') {
      const successCount = feed.filter(f => f.status === 'success').length
      const errorCount = feed.filter(f => f.status === 'error').length
      if (successCount > 0 && errorCount === 0) {
        autoCloseRef.current = setTimeout(() => {
          autoCloseRef.current = null
          onClose()
        }, 1200)
      }
    }
    return () => {
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current)
        autoCloseRef.current = null
      }
    }
  }, [phase, feed, onClose])

  const handleOpenInAi = useCallback(() => {
    navigate('/ai', { state: { initialPrompt: action?.label || 'investigate fraud alerts' } })
    onClose?.()
  }, [navigate, action, onClose])

  const theme = {
    fix_unpaid:        { icon: DollarSign,  bg: 'bg-emerald-600', label: 'Collect Payments' },
    resolve_overdue:   { icon: Clock,       bg: 'bg-orange-600',  label: 'Check Out Rooms' },
    investigate_fraud: { icon: ShieldAlert, bg: 'bg-rose-600',    label: 'Fraud Intelligence' },
  }[actionType] || { icon: Sparkles, bg: 'bg-slate-800', label: action?.label || 'Action' }

  const ThemeIcon = theme.icon
  const allSelected = normalized.items.length > 0 && selectedIds.length === normalized.items.length
  const selectedTotal = normalized.items
    .filter(i => selectedIds.includes(i.id))
    .reduce((s, i) => s + i.balance, 0)

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-end justify-center p-4 sm:p-6 bg-slate-950/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'executing') onClose?.() }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-[28px] border border-white/70 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.28)] overflow-hidden"
        style={{ animation: 'slideUp 220ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        <div className={`flex items-center justify-between px-5 py-4 ${theme.bg}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/15">
              <ThemeIcon size={18} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
                {phase === 'loading' ? 'Loading\u2026' :
                 phase === 'empty' ? 'All Clear' :
                 phase === 'preview' ? 'Confirm Action' :
                 phase === 'executing' ? 'Executing\u2026' :
                 phase === 'result' ? 'Complete' :
                 phase === 'error' ? 'Error' : ''}
              </p>
              <p className="text-base font-black text-white">{theme.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenInAi}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-white/25 transition"
              title="Open full AI workspace"
            >
              <ExternalLink size={11} />
              Ops AI
            </button>
            {phase !== 'executing' && (
              <button
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-5">
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 size={28} className="animate-spin text-slate-400" />
              <p className="text-sm font-semibold text-slate-500">Loading preview\u2026</p>
            </div>
          )}

          {phase === 'empty' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <CheckCircle2 size={36} className="text-emerald-500" />
              <p className="text-sm font-semibold text-slate-700">Nothing to process</p>
              <p className="text-xs text-slate-400 text-center">Everything is up to date \u2014 no action needed right now.</p>
              <button
                onClick={onClose}
                className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                <CheckCircle2 size={14} />
                Done
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6 gap-3">
                <AlertTriangle size={36} className="text-rose-500" />
                <p className="text-sm font-semibold text-slate-700">Something went wrong</p>
                <p className="text-xs text-slate-400 text-center max-w-xs">{error || 'An unexpected error occurred.'}</p>
              </div>
              <button
                onClick={() => {
                  setError(null)
                  setPhase('loading')
                  const evt = new CustomEvent('bb_ai_action', { detail: action })
                  window.dispatchEvent(evt)
                  onClose?.()
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Loader2 size={14} />
                Retry
              </button>
            </div>
          )}

          {phase === 'preview' && !error && actionType === 'fix_unpaid' && (
            <CollectionsPreview
              items={normalized.items}
              total={normalized.total}
              count={normalized.count}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
              selectAll={selectAll}
              clearAll={clearAll}
              allSelected={allSelected}
              selectedTotal={selectedTotal}
              onConfirm={handleConfirm}
              onCancel={onClose}
              busy={false}
              executing={phase === 'executing'}
            />
          )}

          {phase === 'preview' && !error && actionType === 'resolve_overdue' && (
            <OverduePreview
              items={normalized.items}
              count={normalized.count}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
              selectAll={selectAll}
              clearAll={clearAll}
              allSelected={allSelected}
              onConfirm={handleConfirm}
              onCancel={onClose}
              busy={false}
              executing={phase === 'executing'}
            />
          )}

          {phase === 'preview' && !error && actionType === 'investigate_fraud' && rawData && (
            <FraudPreview
              data={rawData?.toolResult?.result || rawData?.fraudData || rawData}
              onOpenInAi={handleOpenInAi}
              onCancel={onClose}
            />
          )}

          {phase === 'executing' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Loader2 size={15} className="animate-spin text-slate-400" />
                <p className="text-sm font-semibold text-slate-500">Processing {selectedIds.length} {selectedIds.length === 1 ? 'item' : 'items'}\u2026</p>
              </div>
              <div className="rounded-xl border border-slate-100 px-3 py-1 max-h-64 overflow-y-auto">
                {feed.map((item) => <FeedItem key={item.id} item={item} />)}
                {feed.length === 0 && (
                  <div className="py-6 text-sm text-center text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Working on it\u2026
                  </div>
                )}
              </div>
            </div>
          )}

          {phase === 'result' && (
            <ResultSummary
              feed={feed}
              onRetryFailed={handleRetryFailed}
              onDone={onClose}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}