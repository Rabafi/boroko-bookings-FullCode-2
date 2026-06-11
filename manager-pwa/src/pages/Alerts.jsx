import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { supabase } from '../lib/supabase'
import { normalizeMaintenanceTicket } from '../lib/maintenance'
import { RefreshCw, AlertTriangle, Wrench, CreditCard, Package, Check, XCircle, Menu } from 'lucide-react'
import { listBookings, listInventory, listMaintenanceTickets } from '../lib/api'
import { money, shortDateTime } from '../lib/format'
import { sendFrontDeskRequest } from '../lib/frontDeskRequests'
import { getNotificationSettings, readCacheEntry, removePwaNotification, subscribeRuntimeEvent, upsertPwaNotification } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'
import { useToast } from '../App'

const FILTERS = [
  ['all', 'All'],
  ['overdue', 'Checkout'],
  ['maintenance', 'Maintenance'],
  ['balances', 'Balances'],
  ['stock', 'Stock'],
  ['demand', 'Demand']
]

function normalizeFilter(value) {
  return FILTERS.some(([id]) => id === value) ? value : 'all'
}

function balanceForBooking(booking) {
  return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
}

function AlertCard({ icon: Icon, iconColor, title, sub, badge, badgeColor = 'bg-orange-500', action, actionLabel, actionColor = 'bg-orange-700 hover:bg-orange-600' }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleAction = async () => {
    setLoading(true)
    try {
      const result = await action()
      if (result !== false) setDone(true)
    } finally {
      setLoading(false)
    }
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
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState({ overdue: [], unpaid: [], maintenance: [], lowStock: [], blockedDemand: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [notificationSettings, setNotificationSettings] = useState(() => getNotificationSettings())
  const today = new Date().toISOString().slice(0, 10)
  const previousCountRef = useRef(0)
  const activeFilter = normalizeFilter(searchParams.get('filter'))

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const lid = user.lodge_id

    try {
      const [bookings, maintenanceRows, stockRows, blockedRes] = await Promise.all([
        listBookings(lid).catch(() => []),
        listMaintenanceTickets(lid).catch(() => []),
        isEnabled('inventory') ? listInventory(lid).catch(() => []) : Promise.resolve([]),
        supabase
          .from('rejected_online_bookings')
          .select('id, room_id, rejection_reason, check_in, check_out, attempted_at, guest_name')
          .eq('lodge_id', lid)
          .eq('rejection_reason', 'maintenance')
          .gte('attempted_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('attempted_at', { ascending: false })
          .then((res) => res)
          .catch(() => ({ data: [] }))
      ])

      const d = {
        overdue: (bookings || []).filter((booking) => booking.status === 'checked_in' && booking.check_out < today),
        unpaid: (bookings || []).filter((booking) => ['unpaid', 'partial'].includes(booking.payment_status) && booking.status !== 'cancelled'),
        maintenance: (maintenanceRows || []).filter((item) => item.status === 'open').map(normalizeMaintenanceTicket),
        lowStock: (stockRows || []).filter(item => {
        const stock = Number(item.current_stock ?? item.quantity ?? 0)
        const reorder = Number(item.reorder_level ?? 0)
        return reorder > 0 && stock <= reorder
        }),
        blockedDemand: blockedRes.data || []
      }
      setData(d)
      const totalCount = d.overdue.length + d.unpaid.length + d.maintenance.length + d.lowStock.length + d.blockedDemand.length
      onCountChange?.(totalCount)
      const cacheTimes = [
        readCacheEntry(lid, 'bookings', null)?.updatedAt,
        readCacheEntry(lid, 'maintenance', null)?.updatedAt,
        readCacheEntry(lid, 'inventory', null)?.updatedAt
      ].filter(Boolean).sort()
      setLastUpdated(cacheTimes.at(-1) || new Date().toISOString())
    } catch (error) {
      setLoadError(error?.message || 'Alerts could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id, today, isEnabled, onCountChange])

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

  const sectionCounts = useMemo(() => ({
    all: data.overdue.length + data.maintenance.length + data.unpaid.length + data.lowStock.length + data.blockedDemand.length,
    overdue: data.overdue.length,
    maintenance: data.maintenance.length,
    balances: data.unpaid.length,
    stock: data.lowStock.length,
    demand: data.blockedDemand.length
  }), [data])

  const showSection = (section) => activeFilter === 'all' || activeFilter === section

  function changeFilter(id) {
    const next = new URLSearchParams(searchParams)
    if (id === 'all') next.delete('filter')
    else next.set('filter', id)
    setSearchParams(next, { replace: true })
  }

  const requestFollowUp = useCallback(async ({ kind, title, description, priority = 'Normal', referenceId }) => {
    try {
      const result = await sendFrontDeskRequest({
        user,
        title,
        description,
        priority,
        context: { kind, referenceId }
      })
      showToast({
        title: result?.queued ? 'Request saved offline' : 'Request sent',
        message: result?.queued
          ? 'It will reach front desk automatically when the device reconnects.'
          : 'Front desk can now review this request on desktop.',
        tone: result?.queued ? 'queued' : 'success'
      })
      return true
    } catch (error) {
      showToast({
        title: 'Request was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
      return false
    }
  }, [showToast, user])

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
          <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-1" />
        </div>
        <div className="flex items-center gap-2">
          <Link to="/more" className="p-2 text-gray-400 hover:text-white" aria-label="More tools"><Menu size={18} /></Link>
          <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => changeFilter(id)}
              className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${activeFilter === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}
            >
              {label}
              <span className="ml-1 opacity-70">{sectionCounts[id] || 0}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : loadError ? (
          <p className="text-red-300 text-sm text-center pt-12">{loadError}</p>
        ) : allClear ? (
          <EmptyState
            icon={Check}
            title="All clear"
            message="No overdue checkouts, unpaid balances, urgent maintenance, low stock, or blocked demand needs manager attention right now."
            action={<Link to="/more" className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Open More tools</Link>}
          />
        ) : (
          <>
            {showSection('maintenance') && data.maintenance.length > 0 && (
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
            {showSection('overdue') && data.overdue.length > 0 && (
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
                    action={() => requestFollowUp({
                      kind: 'overdue-checkout',
                      referenceId: b.id,
                      title: 'Overdue checkout follow-up',
                      description: `Please follow up ${b.guest_name || 'this guest'}. Checkout was due on ${b.check_out}. Confirm whether the guest has left, needs an extension, or needs billing updated.`,
                      priority: 'High'
                    })}
                    actionLabel="Ask front desk to follow up"
                    actionColor="bg-red-700 hover:bg-red-600"
                  />
                ))}
              </div>
            )}

            {/* Open Maintenance */}
            {showSection('maintenance') && data.maintenance.length > 0 && (
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
                    action={() => requestFollowUp({
                      kind: 'maintenance',
                      referenceId: m.id,
                      title: 'Maintenance follow-up request',
                      description: `Please follow up maintenance ticket "${m.title || m.issue || 'Maintenance'}". Priority is ${m.priority || 'normal'}. Confirm room impact, next action, and whether the room should stay blocked.`,
                      priority: m.priority === 'urgent' ? 'High' : 'Normal'
                    })}
                    actionLabel="Ask front desk for status"
                  />
                ))}
              </div>
            )}

            {/* Unpaid bookings */}
            {showSection('balances') && data.unpaid.length > 0 && (
              <div>
                <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wide mb-2">💰 Unpaid Bookings ({data.unpaid.length})</p>
                {data.unpaid.slice(0, 5).map(b => {
                  const balance = balanceForBooking(b)
                  return (
                    <AlertCard
                      key={b.id}
                      icon={CreditCard}
                      iconColor="bg-yellow-900/60 text-yellow-400"
                      title={b.guest_name || 'Guest'}
                      sub={`Balance owed: P ${balance.toLocaleString()} · Check-in: ${b.check_in}`}
                      badge={b.payment_status}
                      badgeColor="bg-yellow-700"
                      action={() => requestFollowUp({
                        kind: 'unpaid-balance',
                        referenceId: b.id,
                        title: 'Balance follow-up request',
                        description: `Please follow up ${b.guest_name || 'this guest'} about the outstanding balance of ${money(balance)}. Check-in date: ${b.check_in}. Confirm collection plan or update invoice notes on desktop.`,
                        priority: 'High'
                      })}
                      actionLabel="Ask front desk to collect"
                      actionColor="bg-yellow-700 hover:bg-yellow-600"
                    />
                  )
                })}
                {data.unpaid.length > 5 && (
                  <p className="text-xs text-gray-500 text-center mt-2">
                    +{data.unpaid.length - 5} more - <Link to="/money?focus=outstanding" className="text-green-400">open Money</Link>
                  </p>
                )}
              </div>
            )}

            {/* Low stock */}
            {showSection('stock') && isEnabled('inventory') && data.lowStock.length > 0 && (
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
                    action={() => requestFollowUp({
                      kind: 'low-stock',
                      referenceId: item.id,
                      title: 'Low stock follow-up request',
                      description: `Please check stock for "${item.name}". Current stock is ${item.current_stock ?? item.quantity ?? 0}; reorder level is ${item.reorder_level}. Add any purchase or adjustment on desktop.`,
                      priority: 'Normal'
                    })}
                    actionLabel="Ask front desk to check stock"
                    actionColor="bg-blue-700 hover:bg-blue-600"
                  />
                ))}
              </div>
            )}

            {/* Blocked online booking attempts (maintenance) — last 7 days */}
            {showSection('demand') && data.blockedDemand.length > 0 && (
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
                      action={() => requestFollowUp({
                        kind: 'blocked-demand',
                        referenceId: roomId,
                        title: 'Blocked online demand follow-up',
                        description: `Please review Room ${roomId}. It has ${attemptCount} blocked online booking attempt${attemptCount === 1 ? '' : 's'} while under maintenance. Latest attempt was ${shortDateTime(latest.attempted_at)}${latest.check_in ? ` for ${latest.check_in} to ${latest.check_out}` : ''}. Confirm whether maintenance should remain blocking online requests.`,
                        priority: 'High'
                      })}
                      actionLabel="Ask front desk to review room"
                      actionColor="bg-purple-700 hover:bg-purple-600"
                    />
                  )
                })}
              </div>
            )}
            {sectionCounts[activeFilter] === 0 && activeFilter !== 'all' && (
              <EmptyState
                icon={Check}
                title="No alerts in this filter"
                message="Switch back to all alerts or use More tools for reports, guests, staff, inventory, and support."
                action={<button type="button" onClick={() => changeFilter('all')} className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Show all alerts</button>}
                secondary={<Link to="/more" className="rounded-xl bg-gray-800 px-4 py-2 text-xs font-semibold text-white">More tools</Link>}
              />
            )}
          </>
        )}
        {!loading && !loadError && (
          <MobileBoundaryNotice compact>
            Review exceptions and send a front-desk nudge from mobile. Desktop remains the place for checkout, payment, stock, and room-state changes.
          </MobileBoundaryNotice>
        )}
      </div>
    </div>
  )
}
