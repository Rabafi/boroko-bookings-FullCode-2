import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Info,
  Send,
  Sparkles,
  XCircle
} from 'lucide-react'
import CollectionsCard from './shared/CollectionsPanel'
import DailyBriefingCard from './shared/DailyBriefingCard'
import { ShieldAlert, RefreshCw, ChevronDown, ChevronUp, Clock, User, FileText } from 'lucide-react'

function InvestigationPanel({ alert, onBack, onAction }) {
  if (!alert) return null

  return (
    <div className="bb-card overflow-hidden p-0 border-l-4 border-l-slate-800 bg-white">
       <div className="flex items-center justify-between bg-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
             <button onClick={onBack} className="hover:bg-slate-700 p-1.5 rounded-full transition"><ChevronDown size={18}/></button>
             <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Investigation View</p>
                <p className="mt-0.5 text-lg font-black">{alert.guest || alert.user}</p>
             </div>
          </div>
          <div className="flex gap-2">
             <span className="rounded bg-rose-500/20 px-2 py-1 text-xs font-bold text-rose-300">Risk: {alert.risk_score}</span>
          </div>
       </div>
       
       <div className="p-5">
          <h3 className="text-sm font-bold text-slate-900">Issue: {alert.reason}</h3>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-1">Rule: {alert.type.replace(/_/g, ' ')}</p>
          
          <div className="mt-6">
             <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Timeline & Evidence</h4>
             <div className="relative border-l-2 border-slate-100 ml-3 space-y-4 pb-4 mt-2">
                {alert.evidence?.map((ev, i) => (
                   <div key={i} className="relative pl-4">
                      <div className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-white bg-slate-300" />
                      <p className="text-sm text-slate-700">{ev}</p>
                   </div>
                ))}
                <div className="relative pl-4">
                   <div className="absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-white bg-rose-400" />
                   <p className="text-sm font-bold text-rose-700">Flagged by Watchdog</p>
                   <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Clock size={10}/> {new Date(alert.timestamp).toLocaleString()}</p>
                </div>
             </div>
          </div>
          
          <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
             <button onClick={() => onAction(`Lock user ${alert.user}`)} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition">Lock User</button>
             <button onClick={() => onAction(`Reverse payment for booking ${alert.booking_id}`)} className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-100 transition">Reverse Payment</button>
             <button onClick={() => onAction(`Flag booking ${alert.booking_id}`)} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 transition">Flag Booking</button>
             <button onClick={() => onAction(`Dismiss alert for booking ${alert.booking_id}`)} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition">Dismiss</button>
          </div>
       </div>
    </div>
  )
}

function FraudAlertsCard({ result, busy, onRefresh, onInvestigate }) {
  const clusters = result?.clusters || []
  const summary = result?.summary || { total_alerts: 0, critical: 0, high: 0, medium: 0, low: 0 }
  const [expanded, setExpanded] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)

  if (clusters.length === 0 && !busy && result) return null

  if (selectedAlert) {
     return <InvestigationPanel alert={selectedAlert} onBack={() => setSelectedAlert(null)} onAction={(msg) => { setSelectedAlert(null); onInvestigate(msg); }} />
  }

  const getBadgeColor = (sev) => {
    if (sev === 'critical') return 'bg-rose-600 text-white border-rose-700'
    if (sev === 'high') return 'bg-rose-100 text-rose-700 border-rose-200'
    if (sev === 'medium') return 'bg-orange-100 text-orange-700 border-orange-200'
    return 'bg-amber-100 text-amber-700 border-amber-200'
  }

  const getDotColor = (sev) => {
    if (sev === 'critical') return 'bg-rose-600'
    if (sev === 'high') return 'bg-rose-500'
    if (sev === 'medium') return 'bg-orange-400'
    return 'bg-amber-400'
  }

  return (
    <div className="bb-card overflow-hidden p-0 border-l-4 border-l-rose-500">
      <div className="flex items-center justify-between bg-gradient-to-r from-rose-50 to-orange-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-800/70">Financial Alerts</p>
            <p className="mt-0.5 text-lg font-black text-rose-900">{summary.total_alerts} Suspicious Activities</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="flex items-center gap-1 rounded-full bg-white/50 px-3 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-white transition disabled:opacity-50"
        >
          <RefreshCw size={10} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {clusters.length > 0 && (
        <div className="border-t border-rose-100">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-rose-50/50 transition"
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-rose-600 flex gap-2">
              {summary.critical > 0 && <span>🔴 {summary.critical} Critical</span>}
              {summary.high > 0 && <span>🟠 {summary.high} High</span>}
              {summary.medium > 0 && <span>🟡 {summary.medium} Medium</span>}
            </span>
            {expanded ? <ChevronUp size={14} className="text-rose-400" /> : <ChevronDown size={14} className="text-rose-400" />}
          </button>

          {expanded && (
            <div className="max-h-80 overflow-y-auto border-t border-rose-100 bg-slate-50/50 p-4 space-y-4">
              {clusters.map((cluster, ci) => (
                <div key={ci} className="mb-2">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeColor(cluster.severity)}`}>
                      RISK {cluster.risk_score}
                    </span>
                    <span className="text-xs font-bold text-slate-700">{cluster.user}</span>
                  </div>
                  <div className="space-y-2 pl-2 border-l-2 border-rose-100 ml-3">
                    {cluster.alerts.map((a, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 p-3 bg-white rounded-xl shadow-sm border border-slate-100 hover:border-rose-300 transition cursor-pointer group" onClick={() => setSelectedAlert(a)}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${getDotColor(a.severity)}`} />
                            <p className="text-xs font-bold text-slate-900 truncate">{a.reason || a.type.replace(/_/g, ' ').toUpperCase()}</p>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-snug mt-1 truncate">
                             Booking {a.booking_id} • Guest: {a.guest}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedAlert(a) }}
                          className="shrink-0 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-[10px] font-bold text-slate-600 opacity-0 group-hover:opacity-100 transition hover:bg-slate-100"
                        >
                          Investigate
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function nowIso() {
  return new Date().toISOString()
}

function safeString(value) {
  return String(value ?? '').trim()
}

function formatMoney(currency, value) {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

// ─── Collections Intelligence Widget ─────────────────────────────────────────
function BucketPill({ label, count, total, currency, color }) {
  const colors = {
    red: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-sky-200 bg-sky-50 text-sky-700'
  }
  return (
    <div className={`rounded-2xl border px-4 py-3 ${colors[color] || colors.blue}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 text-xl font-black">{count}</p>
      <p className="mt-0.5 text-xs font-semibold opacity-80">{formatMoney(currency, total)}</p>
    </div>
  )
}

function CollectionsWidget({ result, currency }) {
  const bd = result?.breakdown || {}
  const rows = Array.isArray(result?.all_rows) ? result.all_rows : []
  const bucketLabel = { overdue: 'Overdue', due_today: 'Due Today', future: 'Upcoming' }
  const bucketColor = { overdue: 'red', due_today: 'amber', future: 'blue' }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-rose-600 to-orange-500 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Collections Intelligence</p>
          <p className="mt-0.5 text-2xl font-black text-white">{formatMoney(currency, result?.total_outstanding || 0)}</p>
          <p className="text-[11px] text-white/80">{result?.unpaid_count || 0} unpaid bookings</p>
        </div>
        <TrendingDown size={36} className="text-white/30" />
      </div>

      {/* Buckets */}
      <div className="grid grid-cols-3 gap-3 p-4">
        {['overdue','due_today','future'].map((k) => (
          <BucketPill
            key={k}
            label={bucketLabel[k]}
            count={bd[k]?.count || 0}
            total={bd[k]?.total || 0}
            currency={currency}
            color={bucketColor[k]}
          />
        ))}
      </div>

      {/* Table */}
      {rows.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="grid grid-cols-4 gap-2 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
            <span>Guest</span><span>Room</span><span>Status</span><span className="text-right">Balance</span>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
            {rows.slice(0, 15).map((row) => (
              <div key={row.id} className="grid grid-cols-4 gap-2 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <span className="truncate text-xs font-semibold text-slate-800">{row.guest}</span>
                <span className="text-xs text-slate-500">{row.room_number ? `Rm ${row.room_number}` : '—'}</span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full w-fit ${
                  row.bucket === 'overdue' ? 'bg-rose-100 text-rose-700' :
                  row.bucket === 'due_today' ? 'bg-amber-100 text-amber-700' :
                  'bg-sky-100 text-sky-700'
                }`}>{row.bucket === 'due_today' ? 'Today' : row.bucket}</span>
                <span className="text-right text-xs font-bold text-rose-600">{formatMoney(currency, row.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OpsAi() {
  const currency = 'P'
  const location = useLocation()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  const [fraudAlerts, setFraudAlerts] = useState(null)
  const [fraudBusy, setFraudBusy] = useState(false)
  const hasProcessedInitialRef = useRef(false)

  const loadFraudAlerts = useCallback(async () => {
    setFraudBusy(true)
    try {
      const res = await window.api.ai.turn({ message: 'Run detect_payment_anomalies tool now.', model: 'gemini-2.5-flash' })
      if (res?.toolResult?.tool === 'detect_payment_anomalies') {
        setFraudAlerts(res.toolResult.result)
      }
    } catch (e) {} finally { setFraudBusy(false) }
  }, [])

  useEffect(() => { loadFraudAlerts() }, [loadFraudAlerts])

  useEffect(() => {
    if (!window.api?.ai?.onAlert) return
    const unsub = window.api.ai.onAlert((payload) => {
      if (payload?.type === 'fraud_alert') {
         loadFraudAlerts() // Reload to get fresh alerts
         setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'ai',
            text: `⚠️ **${payload.severity.toUpperCase()} ALERT**: ${payload.message} (${payload.count} items)`,
            at: nowIso()
         }])
      }
    })
    return () => unsub()
  }, [loadFraudAlerts])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  const quickActions = useMemo(() => ([
    { label: "What needs my attention?", prompt: "What needs my attention right now?" },
    { label: "Today's revenue", prompt: "What's today's revenue?" },
    { label: "Collections summary", prompt: "Give me the full unpaid collections summary." },
    { label: "Unpaid bookings", prompt: "Show unpaid bookings." }
  ]), [])

  const send = useCallback(async (prompt) => {
    const text = safeString(prompt ?? draft)
    if (!text || busy) return
    setError('')
    setDraft('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text, at: nowIso() }])
    setBusy(true)

    try {
      const result = await window.api.ai.turn({ message: text, model: 'gemini-2.5-flash' })
      if (!result?.success) throw new Error(result?.error || 'AI request failed')

      const aiMsg = {
        id: crypto.randomUUID(),
        role: 'ai',
        text: result.assistantText || '',
        at: nowIso(),
        proposal: result.proposal || null,
        toolResult: result.toolResult || null
      }
      setMessages((prev) => [...prev, aiMsg])
    } catch (e) {
      setError(e?.message || 'AI request failed.')
    } finally {
      setBusy(false)
    }
  }, [draft, busy])

  useEffect(() => {
    if (location.state?.initialPrompt && !hasProcessedInitialRef.current) {
      hasProcessedInitialRef.current = true
      // Clear state from router cleanly
      navigate(location.pathname, { replace: true, state: {} })
      send(location.state.initialPrompt)
    }
  }, [location, navigate, send])

  const confirmProposal = async (proposal) => {
    if (!proposal?.id || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await window.api.ai.execute({ proposalId: proposal.id })
      if (!res?.success) throw new Error(res?.error || 'Action failed')
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'ai',
        text: `Done. ${String(res.tool || proposal.tool).replace(/_/g, ' ')} completed.`,
        at: nowIso(),
        toolResult: { tool: res.tool || proposal.tool, result: res.result || res }
      }])
    } catch (e) {
      setError(e?.message || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const renderToolWidget = (toolResult) => {
    if (!toolResult?.tool) return null
    const tool = toolResult.tool
    const result = toolResult.result || {}

    if (tool === 'get_today_revenue') {
      return (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Net collected</p>
            <p className="mt-1 text-lg font-semibold text-emerald-900">{formatMoney(currency, result.total_collected || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment count</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{Number(result.payment_count || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{String(result.date || '').slice(0, 10) || 'Today'}</p>
          </div>
        </div>
      )
    }

    if (tool === 'get_unpaid_summary') {
      return <CollectionsWidget result={result} currency={currency} />
    }

    if (tool === 'detect_payment_anomalies') {
      const summary = result?.summary || {}
      return (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-white overflow-hidden">
           <div className="bg-rose-50 px-4 py-3 flex items-center gap-3">
              <ShieldAlert size={16} className="text-rose-600" />
              <p className="text-xs font-bold text-rose-800">Anomaly Detection Complete</p>
           </div>
           <div className="p-4 flex gap-4 text-sm font-semibold">
              <span className="text-rose-700">{summary.high || 0} High Risk</span>
              <span className="text-orange-600">{summary.medium || 0} Medium Risk</span>
           </div>
        </div>
      )
    }

    if (tool === 'list_unpaid_bookings') {
      const rows = Array.isArray(result.unpaid) ? result.unpaid : []
      return (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top unpaid</p>
            <p className="text-xs font-semibold text-slate-600">{rows.length} shown</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-600">No unpaid bookings found.</div>
            ) : rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.guest}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.room_number ? `Room ${row.room_number}` : 'Room —'} · {row.status} · {row.check_in} → {row.check_out}
                  </p>
                </div>
                <div className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  Due {formatMoney(currency, row.balance || 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
        {JSON.stringify(result, null, 2)}
      </pre>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Operations Agent</p>
          <h1 className="bb-page-header-title mt-2">Boroko Ops AI</h1>
          <p className="bb-page-header-subtitle">Ask questions, generate reports, and execute safe actions with confirmations.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            <Sparkles size={14} /> Tool-safe mode
          </div>
        </div>
      </div>

      <DailyBriefingCard onAction={send} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: Collections Card + shortcuts */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── Financial Alerts Card ── */}
          <FraudAlertsCard 
             result={fraudAlerts} 
             busy={fraudBusy} 
             onRefresh={loadFraudAlerts} 
             onInvestigate={(msg) => send(msg)} 
          />

          {/* ── Collections Intelligence Card ── */}
          <CollectionsCard currency={currency} onSendToChat={send} />

          <div className="bb-card p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <BarChart3 size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Quick prompts</p>
                <p className="mt-1 text-xs text-slate-500">One-tap operations questions the AI can answer fast.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {quickActions.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => send(q.prompt)}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  <span className="truncate">{q.label}</span>
                  <span className="text-xs font-semibold text-slate-400">Run</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bb-card p-5 border-l-4 border-l-amber-500">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <AlertTriangle size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Safety</p>
                <p className="mt-1 text-xs text-slate-600">
                  Actions require confirmation. Payments and booking state changes use the same RPC contracts as the Front Desk system.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Chat + action cards */}
        <div className="lg:col-span-3 bb-card overflow-hidden p-0 flex flex-col min-h-[560px]">
          <div className="border-b border-slate-200/80 bg-white/70 px-5 py-4">
            <p className="text-sm font-semibold text-slate-900">Conversation</p>
            <p className="mt-1 text-xs text-slate-500">Responses can include report widgets and action cards.</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-white">
            {messages.length === 0 && (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Ask me like your operations manager.</p>
                    <p className="mt-1 text-xs text-slate-600">
                      I can answer questions, generate snapshots, and propose safe actions for your approval.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`h-9 w-9 rounded-2xl flex items-center justify-center ${
                  m.role === 'user' ? 'bg-slate-900 text-white' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {m.role === 'user' ? <Send size={15} /> : <Info size={16} />}
                </div>

                <div className={`max-w-[86%] rounded-3xl border px-4 py-3 ${
                  m.role === 'user'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-white text-slate-800'
                }`}>
                  {m.text ? <p className="text-sm leading-6 whitespace-pre-wrap break-words">{m.text}</p> : null}

                  {m.toolResult ? renderToolWidget(m.toolResult) : null}

                  {m.proposal ? (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Action ready</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-950">{String(m.proposal.tool || '').replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-xs text-emerald-900/80 break-words">
                            {JSON.stringify(m.proposal.params || {})}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => confirmProposal(m.proposal)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                        >
                          <CheckCircle2 size={14} />
                          Confirm
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200/80 bg-slate-50 px-5 py-4">
            {error ? (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                <span className="whitespace-pre-wrap break-words flex-1">{error}</span>
                <button type="button" onClick={() => setError('')} className="p-1 rounded-lg hover:bg-rose-100 shrink-0">
                  <XCircle size={14} />
                </button>
              </div>
            ) : null}
            <form
              onSubmit={(e) => { e.preventDefault(); send() }}
              className="flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="input flex-1"
                placeholder="Ask: today’s revenue, unpaid bookings, overdue checkouts…"
              />
              <button
                type="submit"
                disabled={busy}
                className="btn-primary justify-center"
              >
                {busy ? 'Working…' : (
                  <>
                    <Send size={15} />
                    Send
                  </>
                )}
              </button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              Tip: actions are proposed first, then confirmed. This prevents accidental financial changes.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

