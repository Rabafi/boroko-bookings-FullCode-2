import { useState, useEffect, useCallback } from 'react'
import { CalendarCheck, AlertTriangle, RefreshCw, ChevronRight, Receipt, Server, LifeBuoy, Users, Clock } from 'lucide-react'

const TASK_ICONS = {
  overdue_bookings: Receipt,
  trials_ending: Clock,
  failed_devices: Server,
  urgent_tickets: LifeBuoy,
  lead_followups: Users,
  recent_payments: Receipt
}

const TASK_COLORS = {
  overdue_bookings: 'text-red-400',
  trials_ending: 'text-amber-400',
  failed_devices: 'text-red-400',
  urgent_tickets: 'text-orange-400',
  lead_followups: 'text-blue-400',
  recent_payments: 'text-green-400'
}

const TASK_BG = {
  overdue_bookings: 'bg-red-950/30 border-red-900/40',
  trials_ending: 'bg-amber-950/30 border-amber-900/40',
  failed_devices: 'bg-red-950/30 border-red-900/40',
  urgent_tickets: 'bg-orange-950/30 border-orange-900/40',
  lead_followups: 'bg-blue-950/30 border-blue-900/40',
  recent_payments: 'bg-green-950/30 border-green-900/40'
}

export default function AdminToday() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.admin.getAdminToday()
      setData(result)
    } catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const fmt = (n) => `$${Number(n || 0).toLocaleString()}`

  const sections = [
    { key: 'overdue_bookings', title: 'Overdue Bookings', data: data?.overdue_bookings, count: data?.summary?.overdue_bookings_count, extra: data?.summary?.overdue_bookings_total ? fmt(data.summary.overdue_bookings_total) + ' total' : null },
    { key: 'trials_ending', title: 'Trials Ending (3 days)', data: data?.trials_ending, count: data?.summary?.trials_ending_count },
    { key: 'failed_devices', title: 'Failed Devices (24h)', data: data?.failed_devices, count: data?.summary?.failed_devices_count },
    { key: 'urgent_tickets', title: 'Urgent Tickets', data: data?.urgent_tickets, count: data?.summary?.urgent_tickets_count },
    { key: 'lead_followups', title: 'Lead Follow-ups Due', data: data?.lead_followups, count: data?.summary?.lead_followups_count },
    { key: 'recent_payments', title: 'Recent Payments (24h)', data: data?.recent_payments, count: data?.summary?.recent_payments_count, extra: data?.summary?.recent_payments_total ? fmt(data.summary.recent_payments_total) + ' collected' : null }
  ]

  const totalAttention = (data?.summary?.overdue_bookings_count || 0) +
    (data?.summary?.failed_devices_count || 0) +
    (data?.summary?.urgent_tickets_count || 0) +
    (data?.summary?.lead_followups_count || 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarCheck className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Today's Admin Dashboard</h2>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {loading && !data && (
        <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500 animate-pulse">Loading today's data...</div>
      )}

      {/* Attention banner */}
      {data && totalAttention > 0 && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">{totalAttention} items need your attention</p>
            <p className="text-[11px] text-amber-400/70">
              {data.summary.overdue_bookings_count || 0} overdue bookings,
              {data.summary.failed_devices_count || 0} failed devices,
              {data.summary.urgent_tickets_count || 0} urgent tickets,
              {data.summary.lead_followups_count || 0} lead follow-ups
            </p>
          </div>
        </div>
      )}

      {/* Task sections */}
      <div className="space-y-3">
        {sections.map(({ key, title, data: items, count, extra }) => {
          const Icon = TASK_ICONS[key]
          const isEmpty = !items || items.length === 0
          return (
            <div key={key} className={`rounded-xl border overflow-hidden ${isEmpty ? 'bg-gray-800 border-gray-700' : TASK_BG[key]}`}>
              <button onClick={() => toggle(key)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors">
                <Icon size={16} className={TASK_COLORS[key]} />
                <span className="text-sm font-medium text-white flex-1 text-left">{title}</span>
                {extra && <span className="text-[10px] text-gray-400 mr-2">{extra}</span>}
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${count > 0 ? 'bg-white/10 text-white' : 'text-gray-500'}`}>{count || 0}</span>
                <ChevronRight size={14} className={`text-gray-500 transition-transform ${expanded[key] ? 'rotate-90' : ''}`} />
              </button>
              {expanded[key] && items && items.length > 0 && (
                <div className="border-t border-white/5 bg-black/20 max-h-64 overflow-y-auto">
                  {items.map((item, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 border-b border-white/5 last:border-0 hover:bg-white/5">
                      <div className="flex-1 min-w-0">
                        {key === 'overdue_bookings' && (
                          <>
                            <p className="text-xs text-white font-medium">#{item.booking_number} — {item.lodge_name}</p>
                            <p className="text-[10px] text-gray-500">{fmt(item.balance)} overdue {item.days_overdue}d | {item.payment_status}</p>
                          </>
                        )}
                        {key === 'trials_ending' && (
                          <>
                            <p className="text-xs text-white font-medium">{item.lodge_name}</p>
                            <p className="text-[10px] text-gray-500">Expires in {item.days_left} days</p>
                          </>
                        )}
                        {key === 'failed_devices' && (
                          <>
                            <p className="text-xs text-white font-medium">{item.lodge_name} — {item.device_id} ({item.client_type})</p>
                            <p className="text-[10px] text-gray-500">{item.issue_type}: {item.failed_queue_count} failed, reconciliation={item.reconciliation_state}</p>
                          </>
                        )}
                        {key === 'urgent_tickets' && (
                          <>
                            <p className="text-xs text-white font-medium">{item.title}</p>
                            <p className="text-[10px] text-gray-500">{item.company_name} | {item.priority} | {item.status}</p>
                          </>
                        )}
                        {key === 'lead_followups' && (
                          <>
                            <p className="text-xs text-white font-medium">{item.contact_name} — {item.lodge_name}</p>
                            <p className="text-[10px] text-gray-500">Follow-up was {Math.abs(item.days_overdue)}d ago</p>
                          </>
                        )}
                        {key === 'recent_payments' && (
                          <>
                            <p className="text-xs text-white font-medium">{fmt(item.amount)} — {item.method}</p>
                            <p className="text-[10px] text-gray-500">Booking #{item.booking_number || 'N/A'} | {item.lodge_name || 'Unknown'}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
