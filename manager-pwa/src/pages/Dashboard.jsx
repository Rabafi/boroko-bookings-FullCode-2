import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, CalendarClock, CreditCard, FileText, MessageSquare, Package, RefreshCw, ShoppingCart, TrendingUp, Wrench } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { useInbox } from '../contexts/InboxContext'
import { getDashboardSnapshot, getFinancialActivityFeed, getSupportRequests, listBookings } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { readCacheEntry } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

const TONE = {
  red: 'bg-red-950/50 text-red-300',
  amber: 'bg-amber-950/50 text-amber-300',
  blue: 'bg-blue-950/50 text-blue-300',
  green: 'bg-green-950/50 text-green-300',
  purple: 'bg-purple-950/50 text-purple-300',
  slate: 'bg-gray-900 text-gray-300'
}

function KpiCard({ label, value, sub, accent = 'text-white', to, onClick }) {
  const className = 'bg-gray-800 rounded-2xl p-3 text-left active:scale-[0.98] transition-transform'
  const body = (
    <>
      <p className={`text-xl font-bold ${accent}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </>
  )

  if (to) return <Link to={to} className={className}>{body}</Link>
  return <button type="button" onClick={onClick} className={`w-full ${className}`}>{body}</button>
}

function MetricSkeleton() {
  return <div className="bg-gray-800 rounded-2xl p-3 animate-pulse h-[72px]" />
}

function AttentionRow({ item }) {
  const Icon = item.icon
  return (
    <Link to={item.to} className="flex items-start gap-3 rounded-2xl bg-gray-900 px-3 py-2.5 active:scale-[0.99] transition-transform">
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${TONE[item.tone] || TONE.slate}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white">{item.title}</p>
          <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            {item.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-400">{item.sub}</p>
      </div>
    </Link>
  )
}

function QuickLink({ to, icon: Icon, label, sub }) {
  return (
    <Link to={to} className="rounded-2xl bg-gray-800 px-3 py-2.5 active:scale-[0.98] transition-transform">
      <Icon size={16} className="text-green-300" />
      <p className="mt-1.5 text-sm font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>
    </Link>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { can, features, isEnabled } = useFeatures()
  const { unreadCount: inboxUnreadCount } = useInbox()
  const pwaEnabled = Object.keys(features).length > 0 && features.pwa === true
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [bookings, setBookings] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [requestFeed, setRequestFeed] = useState([])
  const today = new Date().toISOString().slice(0, 10)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [snapshot, _feed, requests, bookingRows] = await Promise.all([
        getDashboardSnapshot(user.lodge_id),
        getFinancialActivityFeed(user.lodge_id, 5).catch(() => []),
        getSupportRequests(user.lodge_id, 6).catch(() => []),
        listBookings(user.lodge_id).catch(() => [])
      ])
      setData(snapshot)
      setRequestFeed(Array.isArray(requests) ? requests : [])
      setBookings(Array.isArray(bookingRows) ? bookingRows : [])
      setLastUpdated(readCacheEntry(user.lodge_id, 'dashboard', null)?.updatedAt || null)
    } catch (error) {
      setLoadError(error?.message || 'Dashboard could not load.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', load)
    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('online', load)
    }
  }, [])

  const todayArrivals = useMemo(
    () => bookings.filter((booking) => booking.check_in === today && booking.status !== 'cancelled'),
    [bookings, today]
  )
  const todayDepartures = useMemo(
    () => bookings.filter((booking) => booking.check_out === today && booking.status !== 'cancelled'),
    [bookings, today]
  )
  const pendingOnline = useMemo(
    () => bookings.filter((booking) => booking.source === 'online' && booking.status === 'pending'),
    [bookings]
  )
  const overdueCheckouts = useMemo(
    () => bookings.filter((booking) => booking.status === 'checked_in' && booking.check_out < today),
    [bookings, today]
  )

  const attentionItems = useMemo(() => {
    const items = []

    if (overdueCheckouts.length > 0) {
      items.push({
        id: 'overdue-checkouts',
        icon: AlertTriangle,
        tone: 'red',
        label: 'Checkout',
        title: `${overdueCheckouts.length} overdue checkout${overdueCheckouts.length === 1 ? '' : 's'}`,
        sub: `${guestLabel(overdueCheckouts[0])} ${overdueCheckouts.length > 1 ? `and ${overdueCheckouts.length - 1} more` : ''}`,
        to: '/alerts?filter=overdue'
      })
    }

    if (Number(data?.urgentMaintenanceCount || 0) > 0) {
      items.push({
        id: 'urgent-maintenance',
        icon: Wrench,
        tone: 'red',
        label: 'Maintenance',
        title: `${data.urgentMaintenanceCount} urgent maintenance issue${data.urgentMaintenanceCount === 1 ? '' : 's'}`,
        sub: 'Open Alerts to review priority work.',
        to: '/alerts?filter=maintenance'
      })
    }

    if (pendingOnline.length > 0) {
      items.push({
        id: 'pending-online',
        icon: CalendarClock,
        tone: 'amber',
        label: 'Online',
        title: `${pendingOnline.length} online request${pendingOnline.length === 1 ? '' : 's'} waiting`,
        sub: `${guestLabel(pendingOnline[0])} needs front desk confirmation.`,
        to: '/bookings?filter=pending_online'
      })
    }

    ;(data?.topBalances || []).slice(0, 1).forEach((booking) => {
      items.push({
        id: `balance-${booking.id}`,
        icon: CreditCard,
        tone: 'amber',
        label: 'Balance',
        title: guestLabel(booking),
        sub: `Outstanding ${money(booking.balance)} \u2022 ${shortDate(booking.check_in)}`,
        to: '/money?focus=outstanding'
      })
    })

    ;(data?.lowStock || []).slice(0, 1).forEach((item) => {
      items.push({
        id: `stock-${item.id}`,
        icon: Package,
        tone: 'blue',
        label: 'Stock',
        title: item.name || 'Low stock item',
        sub: `${item.current_stock ?? item.quantity ?? 0} left \u2022 reorder at ${item.reorder_level}`,
        to: '/alerts?filter=stock'
      })
    })

    if (pwaEnabled && inboxUnreadCount > 0) {
      items.push({
        id: 'inbox-unread',
        icon: BellRing,
        tone: 'blue',
        label: 'Inbox',
        title: `${inboxUnreadCount} unread message${inboxUnreadCount === 1 ? '' : 's'}`,
        sub: 'Front desk has replied.',
        to: '/control'
      })
    }

    return items.slice(0, 5)
  }, [data, overdueCheckouts, pendingOnline, pwaEnabled, inboxUnreadCount])

  const openAlertCount = useMemo(() => {
    return (
      overdueCheckouts.length +
      Number(data?.openMaintenanceCount || 0) +
      Number(data?.unpaidCount || 0) +
      Number(data?.lowStockCount || 0)
    )
  }, [data, overdueCheckouts])

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-3 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400">Welcome back</p>
          <h1 className="text-lg font-bold text-white truncate">{user.name}</h1>
          <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-0.5" />
        </div>
        <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {loadError && (
          <div className="bg-red-950/40 border border-red-900 rounded-2xl px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        )}

        <div className="bg-gray-800 rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Needs attention</p>
            <Link to="/alerts" className="text-xs text-green-400">See all</Link>
          </div>
          <div className="space-y-1.5">
            {attentionItems.map((item) => <AttentionRow key={item.id} item={item} />)}
            {!loading && attentionItems.length === 0 && (
              <div className="rounded-xl bg-gray-900 px-3 py-3 text-sm text-green-400 text-center">
                All clear \u2022 nothing needs attention
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => <MetricSkeleton key={index} />)
            : (
              <>
                <KpiCard
                  label="Occupancy"
                  value={`${data?.occupancyPercent || 0}%`}
                  sub={`${data?.occupied || 0}/${data?.totalRooms || 0} rooms`}
                  accent="text-green-300"
                  to="/rooms"
                />
                <KpiCard
                  label="Arrivals today"
                  value={todayArrivals.length}
                  to="/bookings?filter=arrivals"
                />
                <KpiCard
                  label="Departures today"
                  value={todayDepartures.length}
                  to="/bookings?filter=departures"
                />
                <KpiCard
                  label="Outstanding"
                  value={money(data?.outstandingTotal)}
                  accent={Number(data?.outstandingTotal || 0) > 0 ? 'text-yellow-300' : 'text-green-300'}
                  to="/money?focus=outstanding"
                />
              </>
            )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <QuickLink to="/alerts?filter=all" icon={AlertTriangle} label="Alerts" sub={`${openAlertCount} open`} />
          <QuickLink to="/money?focus=outstanding" icon={TrendingUp} label="Money" sub="Balances and audit" />
          {can('pos.reports') && isEnabled('pos') && <QuickLink to="/pos" icon={ShoppingCart} label="POS Sales" sub="Live sales and history" />}
          {pwaEnabled && <QuickLink to="/control" icon={MessageSquare} label="Inbox" sub={inboxUnreadCount > 0 ? `${inboxUnreadCount} unread` : 'Front desk chat'} />}
          {can('reports.view') ? (
            <QuickLink to="/reports" icon={FileText} label="Reports" sub="Full snapshot" />
          ) : (
            <QuickLink to="/bookings" icon={CalendarClock} label="Bookings" sub="Calendar and list" />
          )}
        </div>

        <MobileBoundaryNotice compact>
          Mobile is for visibility and requests. Front desk still executes booking and money changes on desktop.
        </MobileBoundaryNotice>
      </div>
    </div>
  )
}

function guestLabel(booking) {
  return booking?.guest_name || booking?.customer_name || 'Guest'
}
