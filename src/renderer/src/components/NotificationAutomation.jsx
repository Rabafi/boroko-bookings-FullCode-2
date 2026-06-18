import { useState, useEffect, useCallback } from 'react'
import { Bell, Play, Pause, RefreshCw, AlertTriangle, CheckCircle, Clock, ChevronRight, Settings, Zap } from 'lucide-react'

const SEVERITY_COLORS = {
  info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/20 text-red-300 border-red-500/30'
}

const RULE_LABELS = {
  trial_ending: { label: 'Trial Ending', desc: 'Alerts when a company trial is within 3 days of expiry' },
  trial_expired: { label: 'Trial Expired', desc: 'Alerts when a company trial has expired' },
  invoice_overdue: { label: 'Invoice Overdue', desc: 'Alerts when an invoice is 7+ days past due' },
  sync_failure: { label: 'Sync Failure', desc: 'Alerts when a device reports sync errors' },
  license_expiring: { label: 'License Expiring', desc: 'Alerts when a license expires within 7 days' },
  support_urgent: { label: 'Urgent Support Ticket', desc: 'Alerts on open urgent/critical support tickets' },
  lead_followup_overdue: { label: 'Lead Follow-up Overdue', desc: 'Alerts when a scheduled lead follow-up has passed' }
}

export default function NotificationAutomation() {
  const [rules, setRules] = useState([])
  const [events, setEvents] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [evaluating, setEvaluating] = useState(false)
  const [tab, setTab] = useState('rules')
  const [filterRule, setFilterRule] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, s] = await Promise.all([
        window.api.admin.getNotificationRules(),
        window.api.admin.getNotificationEventSummary()
      ])
      setRules(Array.isArray(r) ? r : [])
      setSummary(s)
    } catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  const loadEvents = useCallback(async () => {
    try {
      const opts = { limit: 100 }
      if (filterRule) opts.ruleKey = filterRule
      const ev = await window.api.admin.getNotificationEvents(opts)
      setEvents(Array.isArray(ev) ? ev : [])
    } catch (e) { setError(e?.message || 'Failed to load events') }
  }, [filterRule])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'events') loadEvents() }, [tab, loadEvents])

  const evaluateAll = async () => {
    setEvaluating(true)
    try {
      const result = await window.api.admin.evaluateAllRules()
      await Promise.all([load(), loadEvents()])
    } finally { setEvaluating(false) }
  }

  const evaluateOne = async (ruleKey) => {
    setEvaluating(true)
    try {
      await window.api.admin.evaluateRule(ruleKey)
      await Promise.all([load(), loadEvents()])
    } finally { setEvaluating(false) }
  }

  const toggleRule = async (rule) => {
    await window.api.admin.upsertNotificationRule({
      ...rule,
      enabled: !rule.enabled
    })
    await load()
  }

  const markDispatched = async (ids) => {
    await window.api.admin.markEventsDispatched(ids)
    await loadEvents()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Notification Automation</h2>
        </div>
        <button onClick={evaluateAll} disabled={evaluating}
          className="text-xs px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 flex items-center gap-2">
          <Play size={12} />
          {evaluating ? 'Evaluating...' : 'Run All Rules'}
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={() => { setError(null); load() }} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Active Rules</p>
            <p className="text-2xl font-bold text-white">{summary.active_rules}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Total Events</p>
            <p className="text-2xl font-bold text-white">{summary.total_events}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Undispatched</p>
            <p className={`text-2xl font-bold ${summary.undispatched > 0 ? 'text-amber-400' : 'text-green-400'}`}>{summary.undispatched}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Events (7d)</p>
            <p className="text-2xl font-bold text-white">{Object.values(summary.events_by_rule_7d || {}).reduce((a, b) => a + b, 0)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {['rules', 'events'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors ${tab === t ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t === 'rules' ? 'Alert Rules' : 'Event Log'}
          </button>
        ))}
      </div>

      {/* Rules tab */}
      {tab === 'rules' && (
        <div className="space-y-2">
          {loading ? (
            <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500 animate-pulse">Loading rules...</div>
          ) : rules.length === 0 ? (
            <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">No rules found.</div>
          ) : (
            rules.map(rule => {
              const meta = RULE_LABELS[rule.rule_key] || { label: rule.rule_key, desc: '' }
              return (
                <div key={rule.rule_key} className={`bg-gray-800 rounded-xl p-4 flex items-center gap-4 border transition-colors ${rule.enabled ? 'border-gray-700' : 'border-gray-800 opacity-60'}`}>
                  <button onClick={() => toggleRule(rule)}
                    className={`w-10 h-6 rounded-full flex items-center transition-colors ${rule.enabled ? 'bg-purple-600 justify-end' : 'bg-gray-700 justify-start'}`}>
                    <div className="w-4 h-4 bg-white rounded-full mx-1" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{meta.label}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${SEVERITY_COLORS[rule.severity]}`}>{rule.severity}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">{meta.desc}</p>
                    <p className="text-[10px] text-gray-600 mt-1">Cooldown: {rule.cooldown_minutes}min | Channel: {rule.channel}</p>
                  </div>
                  <button onClick={() => evaluateOne(rule.rule_key)} disabled={evaluating || !rule.enabled}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1">
                    <Play size={10} /> Run
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Events tab */}
      {tab === 'events' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilterRule('')}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!filterRule ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
              All Rules
            </button>
            {rules.map(r => (
              <button key={r.rule_key} onClick={() => setFilterRule(r.rule_key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filterRule === r.rule_key ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {RULE_LABELS[r.rule_key]?.label || r.rule_key}
              </button>
            ))}
          </div>

          <div className="bg-gray-800 rounded-xl overflow-hidden">
            {events.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No events found.</div>
            ) : (
              <div className="divide-y divide-gray-700 max-h-[500px] overflow-y-auto">
                {events.map(ev => (
                  <div key={ev.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-750">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${ev.dispatched ? 'bg-green-400' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{ev.entity_label || ev.entity_type}</p>
                      <p className="text-[10px] text-gray-500">{RULE_LABELS[ev.rule_key]?.label || ev.rule_key} | {new Date(ev.created_at).toLocaleString()}</p>
                    </div>
                    {!ev.dispatched && (
                      <button onClick={() => markDispatched([ev.id])}
                        className="text-[10px] text-green-400 hover:text-green-300">Dismiss</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
