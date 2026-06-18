import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Trash2, Info, AlertTriangle, AlertCircle, CheckCircle, Zap, RefreshCw, Play } from 'lucide-react'
import Pagination, { usePagination } from './shared/Pagination'
import { useToast } from './shared/Toast'
import { DarkConfirmDialog } from './shared/DarkConfirmDialog'
import { timeAgo as sharedTimeAgo } from '../utils/timeAgo'

const TYPE_CONFIG = {
  info:              { icon: Info,         color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  warning:           { icon: AlertTriangle, color: 'text-amber-400',  bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  error:             { icon: AlertCircle,  color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20' },
  success:           { icon: CheckCircle,  color: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
  action_required:   { icon: Zap,          color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20' }
}

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

const timeAgo = sharedTimeAgo

function InboxTab({ onOpenCompany, companies }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState({ unread_only: false, type: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const toast = useToast()
  const [confirmCleanup, setConfirmCleanup] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, count] = await Promise.all([
        window.api.admin.getNotifications({ unread_only: filter.unread_only, type: filter.type || null, limit: 100 }),
        window.api.admin.getUnreadCount()
      ])
      setNotifications(data || [])
      setUnreadCount(count || 0)
    } catch (err) { setError(err?.message || 'Failed to load') }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])
  const { page, setPage, totalPages, paginated } = usePagination(notifications)

  const markAllRead = async () => { await window.api.admin.markNotificationsRead(null); load() }
  const markSelectedRead = async (ids) => { await window.api.admin.markNotificationsRead(ids); load() }
  const deleteOld = () => setConfirmCleanup(true)
  const confirmDeleteOld = async () => {
    const result = await window.api.admin.cleanupNotifications(90)
    toast.success(`Deleted ${result?.count || 0} old notifications`)
    setConfirmCleanup(false)
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={markAllRead} disabled={unreadCount === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-40">
            <CheckCheck size={13} /> Mark all read
          </button>
          <button onClick={deleteOld}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-red-400 transition-colors">
            <Trash2 size={13} /> Cleanup old
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilter(f => ({ ...f, unread_only: false }))}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!filter.unread_only ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>All</button>
        <button onClick={() => setFilter(f => ({ ...f, unread_only: true }))}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filter.unread_only ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>Unread ({unreadCount})</button>
        <div className="w-px h-5 bg-gray-700" />
        {['info', 'warning', 'error', 'success', 'action_required'].map(t => {
          const cfg = TYPE_CONFIG[t]
          return (
            <button key={t} onClick={() => setFilter(f => ({ ...f, type: f.type === t ? '' : t }))}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors border ${filter.type === t ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-white'}`}>
              {t.replace(/_/g, ' ')}
            </button>
          )
        })}
      </div>
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-gray-500 animate-pulse">Loading notifications...</div>
        ) : error ? (
          <div className="px-6 py-16 text-center">
            <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-white underline">Retry</button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <Bell size={32} className="mx-auto mb-3 opacity-40" />
            <p>No notifications.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {paginated.map(n => {
              const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.info
              const Icon = cfg.icon
              const isUnread = !n.read_at
              return (
                <div key={n.id} className={`flex items-start gap-3 px-5 py-3 transition-colors ${isUnread ? 'bg-gray-750' : ''} hover:bg-gray-700`}>
                  <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.bg}`}><Icon size={14} className={cfg.color} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm ${isUnread ? 'text-white font-medium' : 'text-gray-300'}`}>{n.title}</p>
                      <div className="flex items-center gap-2">
                        {isUnread && <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />}
                        <p className="text-xs text-gray-500 shrink-0">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                    {n.body && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {n.lodge_name && <button onClick={() => { const c = companies.find(co => co.lodge_name === n.lodge_name || co.lodge_id === n.lodge_id); if (c && onOpenCompany) onOpenCompany(c) }} className="text-[10px] text-purple-400 bg-gray-700 px-1.5 py-0.5 rounded hover:text-purple-300 hover:underline">{n.lodge_name}</button>}
                      {n.entity_type && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{n.entity_type}</span>}
                    </div>
                  </div>
                  {isUnread && (
                    <button onClick={() => markSelectedRead([n.id])} className="text-xs text-gray-500 hover:text-purple-400 transition-colors shrink-0 mt-1" title="Mark as read">
                      <CheckCheck size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      <DarkConfirmDialog open={confirmCleanup} title="Cleanup old notifications?" message="Delete all notifications older than 90 days. This cannot be undone." confirmLabel="Delete" onConfirm={confirmDeleteOld} onCancel={() => setConfirmCleanup(false)} />
    </div>
  )
}

function RulesTab() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [evaluating, setEvaluating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.admin.getNotificationRules()
      setRules(Array.isArray(r) ? r : [])
    } catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const evaluateAll = async () => {
    setEvaluating(true)
    try { await window.api.admin.evaluateAllRules(); await load() }
    finally { setEvaluating(false) }
  }

  const evaluateOne = async (ruleKey) => {
    setEvaluating(true)
    try { await window.api.admin.evaluateRule(ruleKey); await load() }
    finally { setEvaluating(false) }
  }

  const toggleRule = async (rule) => {
    await window.api.admin.upsertNotificationRule({ ...rule, enabled: !rule.enabled })
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{rules.filter(r => r.enabled).length} of {rules.length} rules active</p>
        <button onClick={evaluateAll} disabled={evaluating}
          className="text-xs px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 flex items-center gap-2">
          <Play size={12} /> {evaluating ? 'Evaluating...' : 'Run All Rules'}
        </button>
      </div>
      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={() => { setError(null); load() }} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}
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
    </div>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [rules, setRules] = useState([])
  const [filterRule, setFilterRule] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const opts = { limit: 100 }
      if (filterRule) opts.ruleKey = filterRule
      const ev = await window.api.admin.getNotificationEvents(opts)
      setEvents(Array.isArray(ev) ? ev : [])
    } catch (e) { setError(e?.message || 'Failed to load events') }
    setLoading(false)
  }, [filterRule])

  useEffect(() => {
    window.api.admin.getNotificationRules().then(r => setRules(Array.isArray(r) ? r : []))
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  const markDispatched = async (ids) => { await window.api.admin.markEventsDispatched(ids); await loadEvents() }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterRule('')}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${!filterRule ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>All Rules</button>
        {rules.map(r => (
          <button key={r.rule_key} onClick={() => setFilterRule(r.rule_key)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filterRule === r.rule_key ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {RULE_LABELS[r.rule_key]?.label || r.rule_key}
          </button>
        ))}
      </div>
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Loading events...</div>
        ) : events.length === 0 ? (
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
                  <button onClick={() => markDispatched([ev.id])} className="text-[10px] text-green-400 hover:text-green-300">Dismiss</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Notifications({ onOpenCompany, companies = [] }) {
  const [tab, setTab] = useState('inbox')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Bell className="text-purple-400" size={20} />
        <h2 className="text-white font-semibold text-lg">Notifications</h2>
      </div>
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {[['inbox', 'Inbox'], ['rules', 'Rules'], ['events', 'Events']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors ${tab === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'inbox' && <InboxTab onOpenCompany={onOpenCompany} companies={companies} />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'events' && <EventsTab />}
    </div>
  )
}
