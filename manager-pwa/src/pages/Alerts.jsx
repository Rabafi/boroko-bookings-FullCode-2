import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { supabase } from '../lib/supabase'
import { normalizeMaintenanceTicket } from '../lib/maintenance'
import { RefreshCw, AlertTriangle, Wrench, CreditCard, Package, Check, XCircle } from 'lucide-react'
import { getNotificationSettings, removePwaNotification, subscribeRuntimeEvent, upsertPwaNotification } from '../lib/runtime'

function AlertCard({ icon: Icon, iconColor, title, sub, badge, badgeColor = 'bg-orange-500', action, actionLabel, actionColor = 'bg-orange-700 hover:bg-orange-600' }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleAction = async () => {
    setLoading(true)
    await action()
    setDone(true)
    setLoading(false)
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconColor}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white">{title}</p>
            {badge && <span className={`${badgeColor} text-white text-xs px-2 py-0.5 rounded-full shrink-0`}>{badge}</span>}
          </div>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
      {action && !done && (
        <button onClick={handleAction} disabled={loading} className={`w-full mt-3 ${actionColor} text-white py-2 rounded-xl text-xs font-semibold disabled:opacity-60`}>
          {loading ? 'Working…' : actionLabel}
        </button>
      )}
      {done && <p className="text-green-400 text-xs mt-2 text-center">✓ Done</p>}
    </div>
  )
}

export default function Alerts({ onCountChange }) {
  const { user } = useAuth()
  const { isEnabled } = useFeatures()
  const [data, setData] = useState({ overdue: [], unpaid: [], maintenance: [], lowStock: [], blockedDemand: [] })
  const [loading, setLoading] = useState(true)
  const [notificationSettings, setNotificationSettings] = useState(() => getNotificationSettings())
  const today = new Date().toISOString().slice(0, 10)
  const previousCountRef = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    const lid = user.lodge_id

    const [overdueRes, unpaidRes, maintRes, stockRes, blockedRes] = await Promise.all([
      supabase.from('bookings').select('id, guest_name, check_out, room_id').eq('lodge_id', lid).eq('status', 'checked_in').lt('check_out', today),
      supabase.from('bookings').select('id, guest_name, total_amount, charges_total, amount_paid, payment_status, check_in').eq('lodge_id', lid).in('payment_status', ['unpaid', 'partial']).neq('status', 'cancelled').order('check_in'),
      supabase.from('maintenance_tickets').select('id, title, issue, priority, room_id, created_at, status, description, notes').eq('lodge_id', lid).eq('status', 'open').order('created_at', { ascending: false }),
      isEnabled('inventory') ? supabase.from('inventory_items').select('id, name, quantity, current_stock, reorder_level').eq('lodge_id', lid) : Promise.resolve({ data: [] }),
      supabase
        .from('rejected_online_bookings')
        .select('id, room_id, rejection_reason, check_in, check_out, attempted_at, guest_name')
        .eq('lodge_id', lid)
        .eq('rejection_reason', 'maintenance')
        .gte('attempted_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('attempted_at', { ascending: false })
    ])

    const d = {
      overdue: overdueRes.data || [],
      unpaid: unpaidRes.data || [],
      maintenance: (maintRes.data || []).map(normalizeMaintenanceTicket),
      lowStock: (stockRes.data || []).filter(item => {
        const stock = Number(item.current_stock ?? item.quantity ?? 0)
        const reorder = Number(item.reorder_level ?? 0)
        return reorder > 0 && stock <= reorder
      }),
      blockedDemand: blockedRes.data || []
    }
    setData(d)
    const totalCount = d.overdue.length + d.unpaid.length + d.maintenance.length + d.lowStock.length + d.blockedDemand.length
    onCountChange?.(totalCount)
    setLoading(false)
  }, [user.lodge_id, today, isEnabled])

  useEffect(() => { load() }, [load])

  useEffect(() => subscribeRuntimeEvent('boroko:pwa-notification-settings', setNotificationSettings), [])

  useEffect(() => {
    const urgentCount = data.overdue.length + data.maintenance.filter((item) => item.priority === 'urgent').length
    if (notificationSettings.urgentAlerts !== false && urgentCount > 0) {
      const body = data.overdue.length > 0
        ? `${data.overdue.length} overdue checkout${data.overdue.length === 1 ? '' : 's'} need attention`
        : `${urgentCount} urgent issue${urgentCount === 1 ? '' : 's'} need attention`
      upsertPwaNotification(user.lodge_id, {
        sourceKey: 'urgent-alerts',
        title: 'Urgent lodge attention needed',
        message: body,
        tone: 'error',
        category: 'urgent',
        href: '/alerts'
      })
    } else {
      removePwaNotification(user.lodge_id, 'urgent-alerts')
    }
    previousCountRef.current = urgentCount
  }, [data, notificationSettings.urgentAlerts, user.lodge_id])

  useEffect(() => {
    if (notificationSettings.balances !== false && data.unpaid.length > 0) {
      upsertPwaNotification(user.lodge_id, {
        sourceKey: 'balances',
        title: 'Outstanding balances need follow-up',
        message: `${data.unpaid.length} booking${data.unpaid.length === 1 ? '' : 's'} still have unpaid or partial balances.`,
        tone: 'warn',
        category: 'balances',
        href: '/alerts'
      })
    } else {
      removePwaNotification(user.lodge_id, 'balances')
    }
    if (notificationSettings.maintenance !== false && data.maintenance.length > 0) {
      upsertPwaNotification(user.lodge_id, {
        sourceKey: 'maintenance',
        title: 'Maintenance board has open work',
        message: `${data.maintenance.length} maintenance ticket${data.maintenance.length === 1 ? '' : 's'} are still open.`,
        tone: data.maintenance.some((item) => item.priority === 'urgent') ? 'error' : 'warn',
        category: 'maintenance',
        href: '/alerts'
      })
    } else {
      removePwaNotification(user.lodge_id, 'maintenance')
    }
  }, [data.maintenance, data.unpaid.length, notificationSettings.balances, notificationSettings.maintenance, user.lodge_id])

  const allClear = !loading && data.overdue.length === 0 && data.maintenance.length === 0 && data.unpaid.length === 0 && data.lowStock.length === 0 && data.blockedDemand.length === 0

  // Group blocked demand attempts by room_id
  const blockedByRoom = data.blockedDemand.reduce((acc, attempt) => {
    const key = attempt.room_id || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(attempt)
    return acc
  }, {})

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Alerts</h1>
          <p className="text-xs text-gray-400">Items needing attention</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : allClear ? (
          <div className="flex flex-col items-center justify-center pt-20 text-center">
            <div className="w-16 h-16 bg-green-900/40 rounded-full flex items-center justify-center mb-4">
              <Check size={32} className="text-green-400" />
            </div>
            <p className="text-white font-semibold">All Clear!</p>
            <p className="text-gray-400 text-sm mt-1">No alerts at this time.</p>
          </div>
        ) : (
          <>
            {data.maintenance.length > 0 && (
              <div className="bg-gray-800 rounded-2xl p-4">
                <p className="text-sm font-semibold text-white mb-3">Maintenance Priority Board</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['Urgent', data.maintenance.filter((m) => m.priority === 'urgent').length, 'text-red-300'],
                    ['High', data.maintenance.filter((m) => m.priority === 'high').length, 'text-orange-300'],
                    ['Open', data.maintenance.filter((m) => m.status === 'open').length, 'text-yellow-300']
                  ].map(([label, value, tone]) => (
                    <div key={label} className="bg-gray-900 rounded-xl px-3 py-3">
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className={`text-lg font-bold mt-1 ${tone}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overdue checkouts */}
            {data.overdue.length > 0 && (
              <div>
                <p className="text-xs text-red-400 font-semibold uppercase tracking-wide mb-2">⚠️ Overdue Checkouts ({data.overdue.length})</p>
                {data.overdue.map(b => (
                  <AlertCard
                    key={b.id}
                    icon={AlertTriangle}
                    iconColor="bg-red-900/60 text-red-400"
                    title={b.guest_name || 'Guest'}
                    sub={`Should have checked out: ${b.check_out}`}
                    badge="Overdue"
                    badgeColor="bg-red-600"
                  />
                ))}
              </div>
            )}

            {/* Open Maintenance */}
            {data.maintenance.length > 0 && (
              <div>
                <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide mb-2">🔧 Open Maintenance ({data.maintenance.length})</p>
                {data.maintenance.map(m => (
                  <AlertCard
                    key={m.id}
                    icon={Wrench}
                    iconColor="bg-orange-900/60 text-orange-400"
                    title={m.title}
                    sub={`Raised: ${new Date(m.created_at).toLocaleDateString()}`}
                    badge={m.priority}
                    badgeColor={m.priority === 'urgent' ? 'bg-red-600' : 'bg-orange-600'}
                  />
                ))}
              </div>
            )}

            {/* Unpaid bookings */}
            {data.unpaid.length > 0 && (
              <div>
                <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wide mb-2">💰 Unpaid Bookings ({data.unpaid.length})</p>
                {data.unpaid.slice(0, 5).map(b => {
                  const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
                  return (
                    <AlertCard
                      key={b.id}
                      icon={CreditCard}
                      iconColor="bg-yellow-900/60 text-yellow-400"
                      title={b.guest_name || 'Guest'}
                      sub={`Balance owed: P ${balance.toLocaleString()} · Check-in: ${b.check_in}`}
                      badge={b.payment_status}
                      badgeColor="bg-yellow-700"
                    />
                  )
                })}
                {data.unpaid.length > 5 && <p className="text-xs text-gray-500 text-center mt-2">+{data.unpaid.length - 5} more — see Bookings tab</p>}
              </div>
            )}

            {/* Low stock */}
            {isEnabled('inventory') && data.lowStock.length > 0 && (
              <div>
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-2">📦 Low Stock ({data.lowStock.length})</p>
                {data.lowStock.map(item => (
                  <AlertCard
                    key={item.id}
                    icon={Package}
                    iconColor="bg-blue-900/60 text-blue-400"
                    title={item.name}
                    sub={`Stock: ${item.current_stock ?? item.quantity ?? 0} (reorder at ${item.reorder_level})`}
                    badge="Low Stock"
                    badgeColor="bg-blue-700"
                  />
                ))}
              </div>
            )}

            {/* Blocked online booking attempts (maintenance) — last 7 days */}
            {data.blockedDemand.length > 0 && (
              <div>
                <p className="text-xs text-purple-400 font-semibold uppercase tracking-wide mb-2">🚫 Blocked Demand — Under Maintenance ({data.blockedDemand.length} attempt{data.blockedDemand.length === 1 ? '' : 's'}, last 7 days)</p>
                {Object.entries(blockedByRoom).map(([roomId, attempts]) => {
                  const latest = attempts[0]
                  const attemptCount = attempts.length
                  const latestDate = new Date(latest.attempted_at).toLocaleDateString()
                  const latestTime = new Date(latest.attempted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  return (
                    <AlertCard
                      key={roomId}
                      icon={XCircle}
                      iconColor="bg-purple-900/60 text-purple-400"
                      title={latest.guest_name ? `Last attempt: ${latest.guest_name}` : `Room blocked — ${attemptCount} attempt${attemptCount === 1 ? '' : 's'}`}
                      sub={`${attemptCount} blocked attempt${attemptCount === 1 ? '' : 's'} · Latest: ${latestDate} ${latestTime}${latest.check_in ? ` · Requested: ${latest.check_in} → ${latest.check_out}` : ''}`}
                      badge="Under Maintenance"
                      badgeColor="bg-purple-700"
                    />
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
