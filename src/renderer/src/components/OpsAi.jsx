import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Copy,
  Search,
  ThumbsDown,
  ThumbsUp,
  Info,
  MapPin,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  TrendingDown,
  XCircle
} from 'lucide-react'
import { ShieldAlert, RefreshCw, ChevronDown, ChevronUp, Clock } from 'lucide-react'

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
             <button onClick={() => onAction(`Where do I manage user access for ${alert.user}?`)} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition">Find User Controls</button>
             <button onClick={() => onAction(`How do I review or correct a payment for booking ${alert.booking_id}?`)} className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-100 transition">Find Payment Review</button>
             <button onClick={() => onAction(`Where do I review booking ${alert.booking_id}?`)} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 transition">Find Booking</button>
             <button onClick={() => onAction(`How do I handle a financial alert?`)} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition">Get Guidance</button>
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

const AI_HISTORY_KEY = 'bb_ai_threads_v1'
const AI_FEEDBACK_KEY = 'bb_ai_feedback_v1'

function createThread(title = 'New chat') {
  const now = nowIso()
  return { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, messages: [] }
}

function loadThreads() {
  try {
    const raw = localStorage.getItem(AI_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {}
  return [createThread()]
}

function safeString(value) {
  return String(value ?? '').trim()
}

function formatMoney(currency, value) {
  const amount = Number(value)
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`
}

function openGuideTarget(navigate, route, state = null) {
  if (!route) return
  navigate(route, state ? { state } : undefined)
}

function loadFeedback() {
  try {
    return JSON.parse(localStorage.getItem(AI_FEEDBACK_KEY) || '{}')
  } catch {
    return {}
  }
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

function DeltaText({ delta, percent, direction, suffix = '' }) {
  const value = Number(delta || 0)
  const cls = direction === 'up' ? 'text-emerald-700' : direction === 'down' ? 'text-rose-700' : 'text-slate-500'
  const sign = value > 0 ? '+' : ''
  const pct = percent == null ? '' : ` (${percent > 0 ? '+' : ''}${percent}%)`
  return <p className={`mt-1 text-[11px] font-semibold ${cls}`}>{sign}{value}{suffix}{pct} vs yesterday</p>
}

function CollectionsWidget({ result, currency, onOpenBooking, onCollectPayment }) {
  const bd = result?.breakdown || {}
  const rows = Array.isArray(result?.all_rows) ? result.all_rows : []
  const comparison = result?.comparison || null
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
          {comparison?.outstanding ? <p className="mt-1 text-[11px] font-semibold text-white/80">{formatMoney(currency, comparison.outstanding.delta || 0)} vs yesterday</p> : null}
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
                <div className="min-w-0">
                  <span className="truncate text-xs font-semibold text-slate-800">{row.guest}</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => onOpenBooking?.(row.id)} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100">Open</button>
                    <button type="button" onClick={() => onCollectPayment?.(row.id)} className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100">Collect</button>
                  </div>
                </div>
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
  const [threads, setThreads] = useState(() => loadThreads())
  const [currentThreadId, setCurrentThreadId] = useState(() => loadThreads()[0]?.id || createThread().id)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  const [fraudAlerts, setFraudAlerts] = useState(null)
  const [fraudBusy, setFraudBusy] = useState(false)
  const [attentionPulse, setAttentionPulse] = useState(null)
  const [pulseBusy, setPulseBusy] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [sidebarTab, setSidebarTab] = useState('chats')
  const [topicQuery, setTopicQuery] = useState('')
  const [feedback, setFeedback] = useState(() => loadFeedback())
  const [sessionContext, setSessionContext] = useState(null)
  const hasProcessedInitialRef = useRef(false)

  const currentThread = useMemo(() => {
    const found = threads.find((thread) => thread.id === currentThreadId)
    return found || threads[0] || createThread()
  }, [threads, currentThreadId])

  const messages = currentThread?.messages || []
  const uiContext = useMemo(() => ({
    sourceRoute: location.state?.sourceRoute || null,
    screenLabel: location.state?.sourceLabel || null,
    activeTabLabel: location.state?.activeTabLabel || location.state?.activeTab || null,
    activeBookingId: location.state?.activeBookingId || location.state?.reviewBookingId || location.state?.focusBookingId || location.state?.collectPaymentBookingId || null,
    activeGuestName: location.state?.activeGuestName || location.state?.prefillName || null,
    roomNumber: location.state?.roomNumber || null
  }), [location.state])
  const effectiveUiContext = useMemo(() => ({ ...(sessionContext || {}), ...(uiContext || {}) }), [sessionContext, uiContext])

  useEffect(() => {
    try {
      localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(threads.slice(0, 24)))
    } catch {}
  }, [threads])

  useEffect(() => {
    try {
      localStorage.setItem(AI_FEEDBACK_KEY, JSON.stringify(feedback))
    } catch {}
  }, [feedback])

  useEffect(() => {
    if (!threads.some((thread) => thread.id === currentThreadId)) {
      setCurrentThreadId(threads[0]?.id || createThread().id)
    }
  }, [threads, currentThreadId])

  useEffect(() => {
    if (uiContext.sourceRoute || uiContext.screenLabel || uiContext.activeBookingId || uiContext.activeGuestName || uiContext.roomNumber) {
      setSessionContext((prev) => ({ ...(prev || {}), ...uiContext }))
    }
  }, [uiContext])

  const appendMessagesToThread = useCallback((threadId, nextMessages) => {
    setThreads((prev) => prev.map((thread) => {
      if (thread.id !== threadId) return thread
      const merged = [...thread.messages, ...nextMessages]
      const firstUser = merged.find((item) => item.role === 'user')?.text || thread.title
      const title = firstUser.length > 42 ? `${firstUser.slice(0, 42).trim()}...` : firstUser
      return {
        ...thread,
        title: title || thread.title,
        updatedAt: nowIso(),
        messages: merged.slice(-80)
      }
    }))
  }, [])

  const createNewThread = useCallback(() => {
    const thread = createThread()
    setThreads((prev) => [thread, ...prev].slice(0, 24))
    setCurrentThreadId(thread.id)
    setDraft('')
    setError('')
  }, [])

  const loadFraudAlerts = useCallback(async () => {
    setFraudBusy(true)
    try {
      const res = await window.api.ai.turn({ message: 'Run detect_payment_anomalies tool now.', model: null, threadId: currentThreadId })
      if (res?.toolResult?.tool === 'detect_payment_anomalies') {
        setFraudAlerts(res.toolResult.result)
      }
    } catch (e) {} finally { setFraudBusy(false) }
  }, [currentThreadId])

  useEffect(() => { loadFraudAlerts() }, [loadFraudAlerts])

  const loadAttentionPulse = useCallback(async () => {
    setPulseBusy(true)
    try {
      const res = await window.api.ai.turn({
        message: 'What needs my attention right now?',
        model: null,
        route: effectiveUiContext.sourceRoute || location.pathname,
        threadId: `${currentThreadId}:pulse`,
        uiContext: effectiveUiContext
      })
      if (res?.toolResult?.tool === 'get_attention') setAttentionPulse(res.toolResult.result)
    } catch (_) {
    } finally {
      setPulseBusy(false)
    }
  }, [currentThreadId, effectiveUiContext, location.pathname])

  useEffect(() => { loadAttentionPulse() }, [loadAttentionPulse])

  useEffect(() => {
    let alive = true
    window.api?.ai?.catalog?.().then((res) => {
      if (alive && res?.success && Array.isArray(res.items)) setCatalog(res.items)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!window.api?.ai?.onAlert) return
    const unsub = window.api.ai.onAlert((payload) => {
      if (payload?.type === 'fraud_alert') {
         loadFraudAlerts() // Reload to get fresh alerts
         appendMessagesToThread(currentThreadId, [{
            id: crypto.randomUUID(),
            role: 'ai',
            text: `⚠️ **${payload.severity.toUpperCase()} ALERT**: ${payload.message} (${payload.count} items)`,
            at: nowIso()
         }])
      }
    })
    return () => unsub()
  }, [appendMessagesToThread, currentThreadId, loadFraudAlerts])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  const quickActions = useMemo(() => ([
    { label: "What needs my attention?", prompt: "What needs my attention right now?" },
    { label: "What can I do here?", prompt: "What can I do here?" },
    { label: "Find booking steps", prompt: "How do I create a booking?" },
    { label: "Find payment steps", prompt: "Where do I record a payment?" },
    { label: "Fix failed sync", prompt: "How do I fix failed sync?" },
    { label: "Add stock", prompt: "How do I add stock?" },
    { label: "Collections", prompt: "Give me the full unpaid collections summary." },
    { label: "Daily briefing", prompt: "Give me the daily briefing." }
  ]), [])

  const groupedCatalog = useMemo(() => catalog.reduce((acc, item) => {
    const query = safeString(topicQuery).toLowerCase()
    const haystack = `${item.title || ''} ${item.summary || ''} ${item.category || ''}`.toLowerCase()
    if (query && !haystack.includes(query)) return acc
    const key = item.category || 'Other'
    acc[key] ||= []
    acc[key].push(item)
    return acc
  }, {}), [catalog, topicQuery])

  const send = useCallback(async (prompt) => {
    const text = safeString(prompt ?? draft)
    if (!text || busy) return
    setError('')
    setDraft('')
    appendMessagesToThread(currentThreadId, [{ id: crypto.randomUUID(), role: 'user', text, at: nowIso() }])
    setBusy(true)

    try {
      const result = await window.api.ai.turn({ message: text, model: null, route: effectiveUiContext.sourceRoute || location.pathname, threadId: currentThreadId, uiContext: effectiveUiContext })
      if (!result?.success) throw new Error(result?.error || 'AI request failed')

      const aiMsg = {
        id: crypto.randomUUID(),
        role: 'ai',
        text: result.assistantText || '',
        at: nowIso(),
        proposal: result.proposal || null,
        toolResult: result.toolResult || null,
        localHelp: result.localHelp || null,
        localIntent: result.localIntent || null
      }
      appendMessagesToThread(currentThreadId, [aiMsg])
    } catch (e) {
      setError(e?.message || 'AI request failed.')
    } finally {
      setBusy(false)
    }
  }, [appendMessagesToThread, busy, currentThreadId, draft, effectiveUiContext, location.pathname])

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
      appendMessagesToThread(currentThreadId, [{
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

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''))
      setError('')
    } catch (e) {
      setError('Could not copy that summary right now.')
    }
  }

  const setMessageFeedback = (messageId, value) => {
    if (!messageId) return
    setFeedback((prev) => ({ ...prev, [messageId]: value }))
  }

  const getRelatedPrompts = (message) => {
    const tool = message?.toolResult?.tool
    const localHelp = message?.localHelp
    if (tool === 'lookup_booking') return ['Show unpaid bookings.', 'Where do I record a payment?', 'How do I check out a guest?']
    if (tool === 'get_handover_report') return ['Give me the daily briefing.', 'What needs my attention right now?', 'When was the last backup?']
    if (tool === 'get_sync_impact') return ['How do I fix failed sync?', 'What needs my attention right now?', 'Give me the daily briefing.']
    if (tool === 'get_maintenance_satisfaction_risk') return ['Show shift handover report.', 'What needs my attention right now?', 'How do I use Maintenance?']
    if (tool === 'get_operational_cleanliness_audit') return ['Show overdue checkouts.', 'Where do I record a payment?', 'How do I check out a guest?']
    if (tool === 'get_room_rate') return ['Which rooms are available tonight?', 'How do I create a booking?', 'Show occupancy forecast for this week.']
    if (tool === 'get_room_availability') return ['Balance for room 12.', 'How do I create a booking?', 'Show occupancy forecast for this week.']
    if (localHelp?.mode === 'playbook') return localHelp.suggestions || []
    if (Array.isArray(localHelp?.suggestions) && localHelp.suggestions.length) return localHelp.suggestions
    return []
  }

  const openBooking = useCallback((bookingId) => {
    if (!bookingId) return
    navigate('/bookings', { state: { reviewBookingId: bookingId } })
  }, [navigate])

  const collectPayment = useCallback((bookingId) => {
    if (!bookingId) return
    navigate('/bookings', { state: { collectPaymentBookingId: bookingId } })
  }, [navigate])

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
            {result.trend?.narrative ? <p className="mt-1 text-[11px] font-semibold text-emerald-800">{result.trend.narrative}</p> : null}
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
      return <CollectionsWidget result={result} currency={currency} onOpenBooking={openBooking} onCollectPayment={collectPayment} />
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
                  <div className="px-4 py-4 text-sm text-slate-600">No unpaid bookings found. Try the daily briefing or room availability if you were checking the next task for the desk.</div>
                ) : rows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.guest}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.room_number ? `Room ${row.room_number}` : 'Room —'} · {row.status} · {row.check_in} → {row.check_out}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => openBooking(row.id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Open booking</button>
                        <button type="button" onClick={() => collectPayment(row.id)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Collect payment</button>
                      </div>
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

    if (tool === 'get_attention') {
      const maintenance = Array.isArray(result.maintenance_open) ? result.maintenance_open : []
      const lowStock = Array.isArray(result.low_stock) ? result.low_stock : []
      const items = Array.isArray(result.items) ? result.items : []
      const stats = result.stats || {}
      return (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Arrivals</p>
              <p className="mt-1 text-lg font-semibold text-amber-950">{Number(stats.arrivals_today || stats.check_ins_today || 0)}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700">Overdue</p>
              <p className="mt-1 text-lg font-semibold text-orange-950">{Number(result.overdue_count || 0)}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Unpaid</p>
              <p className="mt-1 text-lg font-semibold text-rose-950">{Number(result.unpaid_count || 0)}</p>
              <p className="mt-1 text-[11px] font-semibold text-rose-800">{formatMoney(currency, result.unpaid_total || 0)}</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Low stock</p>
              <p className="mt-1 text-lg font-semibold text-sky-950">{lowStock.length}</p>
            </div>
          </div>
          {items.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attention queue</p>
              </div>
              <div className="divide-y divide-slate-100">
                {items.slice(0, 6).map((item) => (
                  <div key={`${item.kind}-${item.title}`} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                    </div>
                    {item.action ? (
                      <button type="button" onClick={() => send(item.action)} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        Ask
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Nothing urgent is standing out right now. A daily briefing or shift handover report is the next best snapshot.
            </div>
          )}
          {!!maintenance.length || !!result.sync_health?.failed ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Maintenance</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{maintenance.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sync failed</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{Number(result.sync_health?.failed || 0)}</p>
              </div>
            </div>
          ) : null}
        </div>
      )
    }

    if (tool === 'get_daily_briefing') {
      const headline = Array.isArray(result.headline) ? result.headline : []
      const insights = Array.isArray(result.insights) ? result.insights : []
      const actions = Array.isArray(result.actions) ? result.actions : []
      const comparison = result.comparison || {}
      return (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="bg-slate-900 px-4 py-3 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">Daily briefing</p>
              <p className="mt-1 text-lg font-black">{headline.length ? headline.join(' • ') : 'Operations snapshot ready'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Occupancy</p><p className="mt-1 text-lg font-bold text-slate-900">{Number(result.occupancy || 0)}%</p>{comparison.occupancy ? <DeltaText {...comparison.occupancy} suffix="%" /> : null}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Revenue</p><p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(currency, result.revenue_today || 0)}</p>{comparison.revenue ? <p className={`mt-1 text-[11px] font-semibold ${comparison.revenue.direction === 'up' ? 'text-emerald-700' : comparison.revenue.direction === 'down' ? 'text-rose-700' : 'text-slate-500'}`}>{formatMoney(currency, comparison.revenue.delta || 0)} vs yesterday</p> : null}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Outstanding</p><p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(currency, result.outstanding || 0)}</p>{comparison.outstanding ? <p className={`mt-1 text-[11px] font-semibold ${comparison.outstanding.direction === 'down' ? 'text-emerald-700' : comparison.outstanding.direction === 'up' ? 'text-rose-700' : 'text-slate-500'}`}>{formatMoney(currency, comparison.outstanding.delta || 0)} vs yesterday</p> : null}</div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Sync</p><p className="mt-1 text-lg font-bold text-slate-900">{result.sync_health?.failed ? `${result.sync_health.failed} failed` : 'Healthy'}</p></div>
            </div>
          </div>
          {insights.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">What stands out</p>
              <div className="mt-2 space-y-2">
                {insights.slice(0, 4).map((item) => <p key={item} className="text-sm text-slate-700">{item}</p>)}
              </div>
            </div>
          ) : null}
          {actions.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Suggested follow-ups</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.slice(0, 4).map((item) => (
                  <button key={item.type} type="button" onClick={() => send(item.label)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )
    }

    if (tool === 'get_overdue_checkouts') {
      const rows = Array.isArray(result.bookings) ? result.bookings : []
      return (
        <div className="mt-3 overflow-hidden rounded-2xl border border-orange-200 bg-white">
          <div className="border-b border-orange-100 bg-orange-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">{rows.length} overdue checkout{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">No overdue checkouts found.</div> : rows.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.guest}</p>
                  <p className="text-xs text-slate-500">Room {row.room || '-'} · {String(row.check_out || '').slice(0, 10)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => openBooking(row.id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Open booking</button>
                    <button type="button" onClick={() => collectPayment(row.id)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Collect payment</button>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">{formatMoney(currency, row.balance || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'lookup_booking') {
      const rows = Array.isArray(result.bookings) ? result.bookings : []
      if (result.needs_query) {
        return (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Please include a room number, booking number, invoice number, or guest name so I can find the right booking.
          </div>
        )
      }
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{rows.length} booking result{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">No matching booking found.</div> : rows.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{row.guest}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Room {row.room_number || '-'} · {row.status} · {row.check_in} → {row.check_out}</p>
                    {row.is_active_stay ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">Current in-house stay</p> : null}
                  </div>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">{formatMoney(currency, row.outstanding || 0)}</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">Total {formatMoney(currency, row.total_amount + row.charges_total)} · Paid {formatMoney(currency, row.amount_paid)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => openBooking(row.id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Open booking</button>
                  <button type="button" onClick={() => collectPayment(row.id)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100">Collect payment</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_revenue_comparison') {
      const series = Array.isArray(result.series) ? result.series : []
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue trend</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{formatMoney(currency, result.weekly_total || 0)}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.direction === 'up' ? 'bg-emerald-50 text-emerald-700' : result.direction === 'down' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{result.direction || 'flat'}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {series.slice(-8).map((row) => (
              <div key={row.date} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-500">{String(row.date).slice(5)}</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{formatMoney(currency, row.total || 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_room_availability') {
      const rows = Array.isArray(result.rooms) ? result.rooms : []
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{result.available_count || 0} available room{result.available_count === 1 ? '' : 's'}</p>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {rows.length === 0 ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">No rooms matched that search. Try another room number or check all rooms.</div> : rows.slice(0, 12).map((row) => (
              <div key={row.room_id || row.room_number} className={`rounded-xl border px-3 py-2 ${row.available ? 'border-emerald-200 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}>
                <p className="text-sm font-bold text-slate-900">Room {row.room_number || '-'}</p>
                <p className="text-xs text-slate-600">{row.room_type || 'Room'}</p>
                <p className={`mt-1 text-xs font-semibold ${row.available ? 'text-emerald-700' : 'text-orange-700'}`}>{row.available ? 'Available' : 'Occupied'}</p>
                {!row.available ? (
                  <button type="button" onClick={() => send(`Balance for room ${row.room_number}.`)} className="mt-2 rounded-full border border-orange-200 bg-white px-3 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-50">
                    View stay
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'search_guest') {
      const rows = Array.isArray(result.guests) ? result.guests : []
      if (result.needs_query) {
        return (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Please include a guest name, phone number, or email so I can narrow the search.
          </div>
        )
      }
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{rows.length} guest result{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.phone || 'No phone'} · {row.email || 'No email'}</p>
                <p className="mt-1 text-xs font-semibold text-slate-700">{row.stays_count} stay{row.stays_count === 1 ? '' : 's'} · Last visit {row.last_visit || 'N/A'}{row.blacklisted ? ' · Blacklisted' : ''}</p>
                {Array.isArray(row.open_bookings) && row.open_bookings.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.open_bookings.map((booking) => (
                      <button key={booking.id} type="button" onClick={() => openBooking(booking.id)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
                        {booking.status} · Room {booking.room_number || '-'} · {formatMoney(currency, booking.balance || 0)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_occupancy_forecast') {
      const series = Array.isArray(result.series) ? result.series : []
      const trend = result.comparison?.first_vs_last || null
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Occupancy forecast</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Average {Number(result.average_rate || 0)}%</p>
            </div>
            {trend ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trend.direction === 'up' ? 'bg-emerald-50 text-emerald-700' : trend.direction === 'down' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{trend.delta > 0 ? '+' : ''}{trend.delta}% over range</span> : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {series.slice(0, 8).map((row) => (
              <div key={row.date} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-500">{String(row.date).slice(5)}</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{row.rate || 0}%</p>
                <p className="text-[11px] text-slate-500">{row.occupied || 0}/{row.total || 0} rooms</p>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_low_stock_overview') {
      const rows = Array.isArray(result.items) ? result.items : []
      return (
        <div className="mt-3 rounded-2xl border border-sky-200 bg-white overflow-hidden">
          <div className="border-b border-sky-100 bg-sky-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">{rows.length} low stock item{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                  <p className="text-xs text-slate-500">Reorder at {row.reorder_level} {row.unit || ''}</p>
                </div>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{row.current_stock} left</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_pending_online_requests') {
      const rows = Array.isArray(result.requests) ? result.requests : []
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{rows.length} pending online request{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">No online booking requests are waiting right now.</div> : rows.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{row.guest}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.check_in} to {row.check_out} · Room {row.room_number || '-'}</p>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_backup_status') {
      return (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Backups</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{Number(result.total_backups || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Newest backup</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{result.newest_backup?.name || 'No backup found'}</p>
            <p className="mt-1 text-xs text-slate-500">{result.newest_backup?.createdAt || result.newest_backup?.created_at || ''}</p>
            <p className={`mt-2 text-xs font-semibold ${result.status === 'ok' ? 'text-emerald-700' : result.status === 'stale' ? 'text-amber-700' : 'text-rose-700'}`}>
              {result.status === 'ok' ? 'Backup looks healthy.' : result.status === 'stale' ? 'Backup is present but getting old.' : 'No recent backup found.'}
            </p>
          </div>
        </div>
      )
    }

    if (tool === 'get_sync_impact') {
      const failed = Array.isArray(result.failed) ? result.failed : []
      return (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Failed items</p>
              <p className="mt-1 text-lg font-semibold text-rose-950">{Number(result.failed_count || 0)}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Pending items</p>
              <p className="mt-1 text-lg font-semibold text-amber-950">{Number(result.pending_count || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Financial at risk</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatMoney(currency, result.financial_amount_at_risk || 0)}</p>
            </div>
          </div>
          {result.narrative ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              {result.narrative}
            </div>
          ) : null}
          {failed.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top failed items</p>
              </div>
              <div className="divide-y divide-slate-100">
                {failed.slice(0, 5).map((item, index) => (
                  <div key={`${item._queue_id || item.id || index}`} className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{item.table || 'Sync item'}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.displayError || item.error || item.message || 'Needs review in System Health.'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )
    }

    if (tool === 'get_maintenance_satisfaction_risk') {
      const items = Array.isArray(result.items) ? result.items : []
      return (
        <div className="mt-3 space-y-3">
          <div className={`rounded-2xl border px-4 py-3 ${result.risk_level === 'high' ? 'border-rose-200 bg-rose-50' : result.risk_level === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">Guest satisfaction risk</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{Number(result.count || 0)} occupied room issue{Number(result.count || 0) === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Rooms with active guests</p>
            </div>
            <div className="divide-y divide-slate-100">
              {items.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">No open maintenance issues are currently affecting in-house guests.</div> : items.map((item) => (
                <div key={`${item.ticket_id || item.booking_id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.guest} · Room {item.room_number || '-'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.issue}</p>
                  </div>
                  <button type="button" onClick={() => openBooking(item.booking_id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">Open booking</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (tool === 'get_operational_cleanliness_audit') {
      const missedCheckIns = Array.isArray(result.missed_check_ins) ? result.missed_check_ins : []
      const missedCheckOuts = Array.isArray(result.missed_check_outs) ? result.missed_check_outs : []
      const renderAuditList = (title, rows, actionLabel) => (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">Nothing flagged here right now.</div> : rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.guest} · Room {row.room_number || '-'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{row.check_in} to {row.check_out}{row.balance != null ? ` · Due ${formatMoney(currency, row.balance || 0)}` : ''}</p>
                </div>
                <button type="button" onClick={() => openBooking(row.id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">{actionLabel}</button>
              </div>
            ))}
          </div>
        </div>
      )
      return (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operational audit flags</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{Number(result.total_flags || 0)}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {renderAuditList('Missed check-ins', missedCheckIns, 'Review booking')}
            {renderAuditList('Missed check-outs', missedCheckOuts, 'Review booking')}
          </div>
        </div>
      )
    }

    if (tool === 'get_room_rate') {
      const rows = Array.isArray(result.rooms) ? result.rooms : []
      return (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{rows.length} room rate{rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? <div className="px-4 py-4 text-sm text-slate-600">No room rates matched that search. Try a room number or a room type like double or family.</div> : rows.map((row) => (
              <div key={row.id || `${row.room_number}-${row.room_type}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.room_number ? `Room ${row.room_number}` : row.room_type}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{row.room_type}</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{formatMoney(row.currency || currency, row.default_rate || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (tool === 'get_handover_report') {
      const arrivalsToday = Array.isArray(result.arrivals_today) ? result.arrivals_today : []
      const departuresToday = Array.isArray(result.departures_today) ? result.departures_today : []
      const arrivalsTomorrow = Array.isArray(result.arrivals_tomorrow) ? result.arrivals_tomorrow : []
      const dirtyRooms = Array.isArray(result.dirty_rooms) ? result.dirty_rooms : []
      const maintenance = Array.isArray(result.maintenance_open) ? result.maintenance_open : []
      const onlineRequests = Array.isArray(result.pending_online_requests) ? result.pending_online_requests : []
      const formatGuestLines = (rows) => rows.map((row) => `- ${row.guest || 'Guest'}${row.room_number ? ` · Room ${row.room_number}` : ''}`).join('\n') || '- None'
      const formatRoomLines = (rows) => rows.map((row) => `- Room ${row.room_number || '-'}${row.label ? ` · ${row.label}` : ''}`).join('\n') || '- None'
      const formatMaintenanceLines = (rows) => rows.map((row) => `- ${row.title || 'Maintenance ticket'}${row.room_number ? ` · Room ${row.room_number}` : ''}${row.priority ? ` · ${row.priority}` : ''}`).join('\n') || '- None'
      const whatsappText = [
        'Tsa Bonno shift handover',
        `Arrivals today: ${arrivalsToday.length}`,
        formatGuestLines(arrivalsToday),
        `Departures today: ${departuresToday.length}`,
        formatGuestLines(departuresToday),
        `Tomorrow arrivals: ${arrivalsTomorrow.length}`,
        formatGuestLines(arrivalsTomorrow),
        `Dirty rooms: ${dirtyRooms.length}`,
        formatRoomLines(dirtyRooms),
        `Open maintenance: ${maintenance.length}`,
        formatMaintenanceLines(maintenance),
        `Pending online requests: ${onlineRequests.length}`,
        formatGuestLines(onlineRequests),
        `Sync pending: ${result.sync_health?.pending || 0}`,
        `Sync failed: ${result.sync_health?.failed || 0}`
      ].join('\n')
      const markdownText = [
        '# Tsa Bonno Shift Handover',
        `- Arrivals today: ${arrivalsToday.length}`,
        `- Departures today: ${departuresToday.length}`,
        `- Tomorrow arrivals: ${arrivalsTomorrow.length}`,
        `- Dirty rooms: ${dirtyRooms.length}`,
        `- Open maintenance: ${maintenance.length}`,
        `- Pending online requests: ${onlineRequests.length}`,
        `- Sync pending: ${result.sync_health?.pending || 0}`,
        `- Sync failed: ${result.sync_health?.failed || 0}`,
        '',
        '## Arrivals today',
        formatGuestLines(arrivalsToday),
        '',
        '## Departures today',
        formatGuestLines(departuresToday),
        '',
        '## Tomorrow arrivals',
        formatGuestLines(arrivalsTomorrow),
        '',
        '## Dirty rooms',
        formatRoomLines(dirtyRooms),
        '',
        '## Open maintenance',
        formatMaintenanceLines(maintenance)
      ].join('\n')
      const renderMiniList = (title, rows, renderLine) => (
        <details className="rounded-xl border border-slate-200 bg-slate-50" open={rows.length > 0}>
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-700">{title} <span className="text-slate-400">({rows.length})</span></summary>
          <div className="border-t border-slate-200 px-3 py-2">
            {rows.length === 0 ? <p className="text-xs text-slate-500">Nothing to hand over here.</p> : (
              <div className="space-y-1.5">
                {rows.slice(0, 6).map((row, index) => (
                  <p key={row.id || `${title}-${index}`} className="text-xs text-slate-700">{renderLine(row)}</p>
                ))}
              </div>
            )}
          </div>
        </details>
      )
      return (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Arrivals</p><p className="mt-1 text-lg font-semibold text-slate-900">{arrivalsToday.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Departures</p><p className="mt-1 text-lg font-semibold text-slate-900">{departuresToday.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Dirty rooms</p><p className="mt-1 text-lg font-semibold text-slate-900">{dirtyRooms.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tomorrow arrivals</p><p className="mt-1 text-lg font-semibold text-slate-900">{arrivalsTomorrow.length}</p></div>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {renderMiniList('Arrivals today', arrivalsToday, (row) => `${row.guest || 'Guest'}${row.room_number ? ` · Room ${row.room_number}` : ''}`)}
            {renderMiniList('Departures today', departuresToday, (row) => `${row.guest || 'Guest'}${row.room_number ? ` · Room ${row.room_number}` : ''}`)}
            {renderMiniList('Tomorrow arrivals', arrivalsTomorrow, (row) => `${row.guest || 'Guest'}${row.room_number ? ` · Room ${row.room_number}` : ''}`)}
            {renderMiniList('Dirty rooms', dirtyRooms, (row) => `Room ${row.room_number || '-'}${row.label ? ` · ${row.label}` : ''}`)}
            {renderMiniList('Open maintenance', maintenance, (row) => `${row.title || 'Maintenance ticket'}${row.room_number ? ` · Room ${row.room_number}` : ''}${row.priority ? ` · ${row.priority}` : ''}`)}
            {renderMiniList('Online requests', onlineRequests, (row) => `${row.guest || 'Guest'}${row.room_number ? ` · Room ${row.room_number}` : ''}`)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => copyText(whatsappText)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Copy size={12} /> Copy WhatsApp
            </button>
            <button type="button" onClick={() => copyText(markdownText)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Copy size={12} /> Copy email
            </button>
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

  const renderLocalHelpWidget = (localHelp) => {
    if (!localHelp) return null
    const best = localHelp.bestMatch
    const matches = Array.isArray(localHelp.matches) ? localHelp.matches : []
    const suggestions = Array.isArray(localHelp.suggestions) ? localHelp.suggestions : []

    if (localHelp.mode === 'disambiguation') {
      return (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">Choose one</p>
          <div className="mt-3 grid gap-2">
            {suggestions.map((item) => {
              const label = typeof item === 'string' ? item : item.label
              const prompt = typeof item === 'string' ? item : item.prompt
              const description = typeof item === 'string' ? '' : item.description
              return (
              <button key={label} type="button" onClick={() => send(prompt)} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-semibold text-amber-900 hover:bg-amber-100">
                <div>{label}</div>
                {description ? <div className="mt-1 text-[11px] font-normal text-amber-800">{description}</div> : null}
              </button>
            )})}
          </div>
        </div>
      )
    }

    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-200 bg-white">
        {best ? (
          <div className="bg-emerald-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Local guide · {localHelp.confidence || 'low'} confidence</p>
                <p className="mt-1 truncate text-sm font-black text-emerald-950">{best.title}</p>
                <p className="mt-1 text-xs text-emerald-900/80">{best.summary}</p>
              </div>
              {best.route ? (
                <button type="button" onClick={() => openGuideTarget(navigate, best.route, best.state || null)} className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
                  <MapPin size={12} /> Open
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {best?.steps?.length ? (
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Steps</p>
            <ol className="mt-2 space-y-1.5 text-sm text-slate-700">
              {best.steps.slice(0, 6).map((step, index) => <li key={step} className="flex gap-2"><span className="font-bold text-slate-400">{index + 1}.</span><span>{step}</span></li>)}
            </ol>
          </div>
        ) : null}
        {matches.length > 1 ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Related</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {matches.slice(1, 4).map((match) => (
                <button key={match.id} type="button" onClick={() => send(`How do I use ${match.title}?`)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  {match.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {suggestions.length ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 4).map((item) => (
                <button key={item} type="button" onClick={() => send(item)} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                  {item} <ArrowRight size={12} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-104px)] min-h-0 w-full max-w-7xl flex-col gap-3 overflow-hidden">
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700/70">Local App Assistant</p>
            <h1 className="mt-0.5 text-xl font-black leading-tight text-slate-950">Tsa Bonno Assistant</h1>
            <p className="mt-0.5 max-w-3xl truncate text-xs text-slate-500">Find any feature, get app instructions, and read live summaries. It will not change records.</p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <Sparkles size={14} /> Runs locally
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-5">
        {/* Left: quick guide shortcuts */}
        <div className="min-h-0 space-y-3 overflow-hidden lg:col-span-2">
          <div className="bb-card flex min-h-0 flex-col overflow-hidden p-3">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {[
                { id: 'chats', label: 'Chats', icon: MessageSquare },
                { id: 'prompts', label: 'Prompts', icon: BarChart3 },
                { id: 'topics', label: 'Topics', icon: Info }
              ].map((tab) => {
                const Icon = tab.icon
                const active = sidebarTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSidebarTab(tab.id)}
                    className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition ${active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <Icon size={13} />
                    <span className="truncate">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-hidden">
              {sidebarTab === 'chats' ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">Chat history</p>
                      <p className="text-xs text-slate-500">Stored only on this device.</p>
                    </div>
                    <button type="button" onClick={createNewThread} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <Plus size={12} /> New
                    </button>
                  </div>
                  <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {threads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setCurrentThreadId(thread.id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${thread.id === currentThreadId ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <p className="truncate text-xs font-semibold text-slate-900">{thread.title || 'New chat'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{new Date(thread.updatedAt || thread.createdAt || Date.now()).toLocaleString()}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {sidebarTab === 'prompts' ? (
                <div>
                  <p className="text-sm font-semibold text-slate-900">Quick prompts</p>
                  <p className="mt-1 text-xs text-slate-500">Fast local answers for common tasks.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {quickActions.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => send(q.prompt)}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
                      >
                        <span className="min-w-0 truncate">{q.label}</span>
                        <ArrowRight size={12} className="shrink-0 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {sidebarTab === 'topics' ? (
                <div className="flex h-full min-h-0 flex-col">
                  <p className="text-sm font-semibold text-slate-900">Browse topics</p>
                  <p className="mt-1 text-xs text-slate-500">Everything the assistant already knows about the app.</p>
                  <label className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <Search size={14} className="text-slate-400" />
                    <input
                      value={topicQuery}
                      onChange={(e) => setTopicQuery(e.target.value)}
                      placeholder="Search topics"
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none"
                    />
                  </label>
                  <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {Object.entries(groupedCatalog).length === 0 ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">No topics match that search yet.</div> : Object.entries(groupedCatalog).map(([category, items]) => (
                      <div key={category}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{category}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {items.map((item) => (
                            <button key={item.id} type="button" onClick={() => send(`How do I use ${item.title}?`)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              {item.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="bb-card border-l-4 border-l-amber-500 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Read-only by design</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  The local assistant gives directions, opens the right screen, and reads summaries. It does not create bookings, record payments, or change guest statuses.
                </p>
              </div>
            </div>
          </div>

          {attentionPulse?.items?.length ? (
            <div className="bb-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Operations pulse</p>
                  <p className="mt-1 text-xs text-slate-500">A quiet local watchlist from this device.</p>
                </div>
                <button type="button" onClick={loadAttentionPulse} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <RefreshCw size={12} className={pulseBusy ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {attentionPulse.items.slice(0, 4).map((item, index) => (
                  <button
                    key={`${item.kind || 'pulse'}-${index}`}
                    type="button"
                    onClick={() => item.action ? send(item.action) : null}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-semibold text-slate-900">{item.title}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${item.severity === 'high' ? 'bg-rose-100 text-rose-700' : item.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.severity}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{item.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {fraudAlerts?.summary?.total_alerts > 0 ? (
            <FraudAlertsCard
               result={fraudAlerts}
               busy={fraudBusy}
               onRefresh={loadFraudAlerts}
               onInvestigate={(msg) => send(msg)}
            />
          ) : null}
        </div>

        {/* Right: Chat + guide cards */}
        <div className="bb-card flex min-h-0 flex-col overflow-hidden p-0 lg:col-span-3">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/70 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Conversation</p>
                <p className="mt-1 text-xs text-slate-500">Ask with typos, follow-ups, or rough descriptions. Answers stay local and read-only.</p>
              </div>
              <p className="shrink-0 text-[11px] font-semibold text-slate-400">{messages.length} message{messages.length === 1 ? '' : 's'}</p>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-4 py-3">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Ask me to find anything in the app.</p>
                    <p className="mt-1 text-xs text-slate-600">
                      I can explain steps, open the right screen, and show read-only live summaries. I will not change records.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`h-8 w-8 shrink-0 rounded-xl flex items-center justify-center ${
                  m.role === 'user' ? 'bg-slate-900 text-white' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {m.role === 'user' ? <Send size={15} /> : <Info size={16} />}
                </div>

                <div className={`max-w-[86%] rounded-2xl border px-3 py-2.5 ${
                  m.role === 'user'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-white text-slate-800'
                }`}>
                  {m.text ? <p className="text-sm leading-5 whitespace-pre-wrap break-words">{m.text}</p> : null}

                  {m.toolResult ? renderToolWidget(m.toolResult) : null}
                  {m.localHelp ? renderLocalHelpWidget(m.localHelp) : null}

                  {m.proposal ? (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Cloud action proposal</p>
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

                  {m.role === 'ai' ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button type="button" onClick={() => setMessageFeedback(m.id, 'up')} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${feedback[m.id] === 'up' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                        <ThumbsUp size={12} /> Helpful
                      </button>
                      <button type="button" onClick={() => setMessageFeedback(m.id, 'down')} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${feedback[m.id] === 'down' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                        <ThumbsDown size={12} /> Not helpful
                      </button>
                      {getRelatedPrompts(m).slice(0, 3).map((prompt) => (
                        <button key={`${m.id}-${prompt}`} type="button" onClick={() => send(prompt)} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100">
                          {prompt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-slate-200/80 bg-slate-50 px-4 py-2.5">
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
                placeholder="Ask: add stok, recieve payment, what can I do here..."
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
            <p className="mt-1.5 truncate text-[11px] text-slate-500">
              Tip: ask for directions in plain language. The assistant will guide you to the screen instead of doing the work for you.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

