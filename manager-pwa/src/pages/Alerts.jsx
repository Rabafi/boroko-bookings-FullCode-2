import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { supabase } from '../lib/supabase'
import { normalizeMaintenanceTicket } from '../lib/maintenance'
import { RefreshCw, AlertTriangle, Wrench, CreditCard, Package, Check, XCircle, MessageSquare } from 'lucide-react'
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

function AlertRow({ icon: Icon, iconColor, title, sub, badge, badgeColor = 'bg-orange-500', onFollowUp, followUpLabel = 'Ask front desk', disabled }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleAction = async () => {
    if (!onFollowUp) return
    setLoading(true)
    try {
      const result = await onFollowUp()
      if (result !== false) setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-gray-900 px-3 py-2.5">
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          {badge && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badgeColor} text-white`}>{badge}</span>}
        </div>
        {sub && <p className="mt-0.5 text-[11px] text-gray-400 line-clamp-2">{sub}</p>}
      </div>
      {onFollowUp && !done && (
        <button
          onClick={handleAction}
          disabled={loading || disabled}
          className="shrink-0 mt-0.5 p-1.5 rounded-lg bg-green-700/80 text-white hover:bg-green-600 disabled:opacity-50"
          aria-label={followUpLabel}
        >
          <MessageSquare size={14} />
        </button>
      )}
      {done && <span className="shrink-0 mt-0.5 text-green-400 text-xs">✓</span>}
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

  const blockedByRoom = data.blockedDemand.reduce((acc, attempt) => {
    const key = attempt.room_id || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(attempt)
    return acc
  }, {})

  const allAlerts = useMemo(() => {
    const alerts = []
    data.overdue.forEach((b) => {
      alerts.push({
        id: `overdue-${b.id}`,
        section: 'overdue',
        icon: AlertTriangle,
        iconColor: 'bg-red-900/60 text-red-400',
        title: b.guest_name || 'Guest',
        sub: `Checkout due: ${b.check_out}`,
        badge: 'Overdue',
        badgeColor: 'bg-red-600',
        sort: 0,
        followUp: () => requestFollowUp({
          kind: 'overdue-checkout', referenceId: b.id, title: 'Overdue checkout follow-up',
          description: `Please follow up ${b.guest_name || 'this guest'}. Checkout was due on ${b.check_out}.`, priority: 'High'
        })
      })
    })
    data.maintenance.forEach((m) => {
      alerts.push({
        id: `maint-${m.id}`,
        section: 'maintenance',
        icon: Wrench,
        iconColor: 'bg-orange-900/60 text-orange-400',
        title: m.title,
        sub: `Raised: ${new Date(m.created_at).toLocaleDateString()}`,
        badge: m.priority,
        badgeColor: m.priority === 'urgent' ? 'bg-red-600' : 'bg-orange-600',
        sort: m.priority === 'urgent' ? 0 : 1,
        followUp: () => requestFollowUp({
          kind: 'maintenance', referenceId: m.id, title: 'Maintenance follow-up request',
          description: `Please follow up maintenance ticket "${m.title || m.issue || 'Maintenance'}".`, priority: m.priority === 'urgent' ? 'High' : 'Normal'
        })
      })
    })
    data.unpaid.slice(0, 5).forEach((b) => {
      const balance = balanceForBooking(b)
      alerts.push({
        id: `unpaid-${b.id}`,
        section: 'balances',
        icon: CreditCard,
        iconColor: 'bg-yellow-900/60 text-yellow-400',
        title: b.guest_name || 'Guest',
        sub: `Balance: P ${balance.toLocaleString()} \u2022 Check-in: ${b.check_in}`,
        badge: b.payment_status,
        badgeColor: 'bg-yellow-700',
        sort: 2,
        followUp: () => requestFollowUp({
          kind: 'unpaid-balance', referenceId: b.id, title: 'Balance follow-up request',
          description: `Please follow up ${b.guest_name || 'this guest'} about the outstanding balance of ${money(balance)}.`, priority: 'High'
        })
      })
    })
    data.lowStock.forEach((item) => {
      alerts.push({
        id: `stock-${item.id}`,
        section: 'stock',
        icon: Package,
        iconColor: 'bg-blue-900/60 text-blue-400',
        title: item.name,
        sub: `Stock: ${item.current_stock ?? item.quantity ?? 0} (reorder at ${item.reorder_level})`,
        badge: 'Low Stock',
        badgeColor: 'bg-blue-700',
        sort: 3,
        followUp: () => requestFollowUp({
          kind: 'low-stock', referenceId: item.id, title: 'Low stock follow-up request',
          description: `Please check stock for "${item.name}". Current stock is ${item.current_stock ?? item.quantity ?? 0}.`, priority: 'Normal'
        })
      })
    })
    Object.entries(blockedByRoom).forEach(([roomId, attempts]) => {
      const latest = attempts[0]
      const attemptCount = attempts.length
      alerts.push({
        id: `demand-${roomId}`,
        section: 'demand',
        icon: XCircle,
        iconColor: 'bg-purple-900/60 text-purple-400',
        title: latest.guest_name ? `Last attempt: ${latest.guest_name}` : `Room blocked \u2022 ${attemptCount} attempts`,
        sub: `${attemptCount} blocked attempt${attemptCount === 1 ? '' : 's'} \u2022 Latest: ${shortDateTime(latest.attempted_at)}`,
        badge: 'Under Maintenance',
        badgeColor: 'bg-purple-700',
        sort: 4,
        followUp: () => requestFollowUp({
          kind: 'blocked-demand', referenceId: roomId, title: 'Blocked online demand follow-up',
          description: `Please review Room ${roomId}. It has ${attemptCount} blocked online booking attempts while under maintenance.`, priority: 'High'
        })
      })
    })
    return alerts.sort((a, b) => a.sort - b.sort)
  }, [data, blockedByRoom, requestFollowUp])

  const filteredAlerts = useMemo(() => {
    if (activeFilter === 'all') return allAlerts
    return allAlerts.filter((a) => a.section === activeFilter)
  }, [allAlerts, activeFilter])

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-2 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Alerts</h1>
          <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-0.5" />
      </div>

      <div className="flex-1 px-4 py-3 space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => changeFilter(id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeFilter === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}
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
            action={<Link to="/more" className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Open Menu</Link>}
          />
        ) : (
          <div className="space-y-1.5">
            {filteredAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                icon={alert.icon}
                iconColor={alert.iconColor}
                title={alert.title}
                sub={alert.sub}
                badge={alert.badge}
                badgeColor={alert.badgeColor}
                onFollowUp={alert.followUp}
              />
            ))}
            {filteredAlerts.length === 0 && activeFilter !== 'all' && (
              <EmptyState
                icon={Check}
                title="No alerts in this filter"
                message="Switch back to all alerts or use Menu for reports, guests, staff, inventory, and support."
                action={<button type="button" onClick={() => changeFilter('all')} className="rounded-xl bg-green-700 px-4 py-2 text-xs font-semibold text-white">Show all alerts</button>}
                secondary={<Link to="/more" className="rounded-xl bg-gray-800 px-4 py-2 text-xs font-semibold text-white">Menu</Link>}
              />
            )}
          </div>
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
