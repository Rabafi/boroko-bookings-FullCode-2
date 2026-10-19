// @ts-check
import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, BarChart3, Clock, DollarSign } from 'lucide-react'
/** Exact display fields constructed by get_daily_briefing in aiOrchestrator.js. */
/** Metrics passed through from PostgREST may arrive as numeric strings; this type does not coerce them. */
/** @typedef {number | string} BriefingNumericValue */
/** @typedef {{occupancy: BriefingNumericValue, revenue_today: BriefingNumericValue, outstanding: number, check_ins: number, check_outs: number, overdue_checkouts: number, unpaid_bookings: number, maintenance_open: number, fraud_alerts: {critical: BriefingNumericValue, high: BriefingNumericValue}, insights: string[], revenue_change: BriefingNumericValue, occupancy_change: BriefingNumericValue, actions: {type: string, label: string, priority: string}[]}} DailyBriefingResult */
/** @typedef {{toolResult?: {tool?: string, result: DailyBriefingResult}}} DailyBriefingResponseReadView */

/** @param {unknown} value */
function formatMoney(value) {
  return `P ${Number(value || 0).toFixed(2)}`
}

/** @param {{onAction?: (label: string) => void}} props */
export default function DailyBriefingCard({ onAction }) {
  const [briefing, setBriefing] = useState(/** @type {DailyBriefingResult | null} */ (null))
  const [busy, setBusy] = useState(false)

  const loadBriefing = useCallback(async () => {
    setBusy(true)
    try {
      // Source-backed compile-time view of the exact tool response constructed by aiOrchestrator.
      // This is an assumption about the existing producer, not runtime validation.
      const res = await window.api.ai.turn({ message: 'Generate daily briefing', model: 'gemini-2.5-flash' })
      if ((/** @type {DailyBriefingResponseReadView} */ (res))?.toolResult?.tool === 'get_daily_briefing') {
        setBriefing((/** @type {DailyBriefingResponseReadView} */ (res)).toolResult.result)
      }
    } catch (e) {
      console.error('Failed to load daily briefing:', e)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    loadBriefing()
  }, [loadBriefing])

  if (!briefing && !busy) return null

  const {
    revenue_today = 0,
    outstanding = 0,
    occupancy = 0,
    check_ins = 0,
    check_outs = 0,
    overdue_checkouts = 0,
    unpaid_bookings = 0,
    maintenance_open = 0,
    fraud_alerts = { critical: 0, high: 0 },
    insights = [],
    revenue_change = 0,
    occupancy_change = 0
  } = briefing || {}

  /** @param {BriefingNumericValue} value */
  const renderTrend = (value) => {
    // The assertion only lets TypeScript model JavaScript's existing relational coercion.
    if ((/** @type {number} */ (value)) > 0) return <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md"><TrendingUp size={10}/> +{value}%</span>
    if ((/** @type {number} */ (value)) < 0) return <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md"><TrendingDown size={10}/> {value}%</span>
    return <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-md">--</span>
  }

  return (
    <div className="bb-card overflow-hidden p-0 border border-slate-200">
      <div className="flex items-center justify-between bg-slate-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400">
            <Sparkles size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Executive Briefing</p>
            <p className="mt-0.5 text-xl font-black text-white">Today's Overview</p>
          </div>
        </div>
        <button
          onClick={loadBriefing}
          disabled={busy}
          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-white/20 transition disabled:opacity-50"
        >
          <RefreshCw size={10} className={busy ? 'animate-spin' : ''} /> {busy ? 'Generating...' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 border-b border-slate-100 bg-white">
        <div className="p-4 flex flex-col justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 flex justify-between">Occupancy {renderTrend(occupancy_change)}</p>
          <p className="mt-2 text-2xl font-black text-slate-800">{occupancy}%</p>
        </div>
        <div className="p-4 flex flex-col justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 flex justify-between">Revenue {renderTrend(revenue_change)}</p>
          <p className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(revenue_today)}</p>
        </div>
        <div className="p-4 flex flex-col justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 flex justify-between">Outstanding <AlertTriangle size={12} className={outstanding > 5000 ? 'text-rose-500' : 'text-slate-300'} /></p>
          <p className={`mt-2 text-2xl font-black ${outstanding > 5000 ? 'text-rose-600' : 'text-slate-800'}`}>{formatMoney(outstanding)}</p>
        </div>
        <div className="p-4 flex flex-col justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 flex justify-between">Movement <ArrowRight size={12} className="text-slate-300" /></p>
          <p className="mt-2 text-lg font-black text-slate-800">
             <span className="text-emerald-600">{check_ins} In</span> / <span className="text-orange-500">{check_outs} Out</span>
          </p>
        </div>
      </div>

      <div className="bg-slate-50 border-b border-slate-100 px-4 py-2.5 flex flex-wrap gap-2 text-xs font-semibold">
        {overdue_checkouts > 0 && <span className="flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-rose-700 border border-rose-200"><Clock size={12} /> {overdue_checkouts} Overdue Checkouts</span>}
        {unpaid_bookings > 0 && <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-orange-700 border border-orange-200"><DollarSign size={12} /> {unpaid_bookings} Unpaid Bookings</span>}
        {((/** @type {number} */ (fraud_alerts.critical)) > 0 || (/** @type {number} */ (fraud_alerts.high)) > 0) && <span className="flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-white shadow-sm border border-rose-700 animate-pulse"><ShieldAlert size={12} /> {/** @type {number} */ (fraud_alerts.critical) + /** @type {number} */ (fraud_alerts.high)} Fraud Alerts</span>}
        {maintenance_open > 0 && <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-amber-700 border border-amber-200"><AlertTriangle size={12} /> {maintenance_open} Open Maintenance</span>}
        {overdue_checkouts === 0 && unpaid_bookings === 0 && fraud_alerts.critical === 0 && fraud_alerts.high === 0 && <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 border border-emerald-200"><CheckCircle2 size={12} /> All clear</span>}
      </div>

      <div className="bg-white p-5 flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-500 mb-2 flex items-center gap-2"><Sparkles size={12}/> AI Insights</p>
          {insights.map((insight, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              <p className="text-sm font-semibold text-slate-700 leading-snug">{insight}</p>
            </div>
          ))}
        </div>
        
        {briefing != null && (briefing.actions?.length ?? 0) > 0 && (
           <div className="w-full md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6 space-y-2 flex flex-col justify-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-500 mb-1 flex items-center gap-2 animate-pulse">⚡ Suggested Actions</p>
              {briefing.actions.map((act, i) => {
                 let bg = 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                 let icon = <ArrowRight size={14}/>
                 if (act.priority === 'critical') {
                    bg = 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700 border-2'
                 } else if (act.priority === 'high') {
                    bg = 'bg-orange-50 border-orange-200 hover:bg-orange-100 text-orange-700'
                 }
                 
                 if (act.type === 'fix_unpaid') icon = <DollarSign size={14}/>
                 if (act.type === 'resolve_overdue') icon = <Clock size={14}/>
                 if (act.type === 'investigate_fraud') icon = <ShieldAlert size={14}/>
                 
                 return (
                   <button 
                      key={i} 
                      onClick={() => onAction && onAction(act.label)}
                      className={`relative w-full rounded-xl px-4 py-2.5 text-xs font-bold text-left shadow-sm transition border flex items-center justify-between group ${bg}`}
                   >
                      <span className="flex items-center gap-2 truncate pr-2">{icon} <span className="truncate">{act.label}</span></span>
                      {act.priority === 'critical' && <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[8px] text-white animate-bounce">!</span>}
                      {act.priority === 'critical' && <span className="hidden group-hover:inline absolute right-2 text-[10px] bg-white px-1.5 rounded text-rose-600 shadow">Recommended</span>}
                   </button>
                 )
              })}
           </div>
        )}
      </div>
    </div>
  )
}
