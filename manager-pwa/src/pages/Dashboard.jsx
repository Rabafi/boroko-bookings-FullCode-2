// @ts-check
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, BellRing, CalendarClock, CreditCard, FileText, MessageSquare, Package, RefreshCw, ShoppingCart, TrendingUp, Utensils, Wrench } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { useInbox } from '../contexts/InboxContext'
import { getDashboardSnapshot, getManagerPosSnapshot, listBookings, listInventory } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { readCacheEntry } from '../lib/runtime'
import DataFreshness from '../components/DataFreshness'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'
import { isBarHospitalityMode, isRestaurantProductFamily } from '../lib/productShell'

/** @typedef {{id: string|number, check_in: string, check_out: string, status: string, source?: string|null, guest_name?: string|null, customer_name?: string|null, balance?: number|null}} DashboardBookingExpectedView */
/** @typedef {{id: string|number, name?: string|null, current_stock?: number|null, quantity?: number|null, reorder_level?: number|null}} DashboardInventoryExpectedView */
/** @typedef {Partial<Omit<import('../lib/api').DashboardSnapshotExpectedData, 'topBalances'|'lowStock'|'lowStockCount'>> & {topBalances?: unknown[], lowStock?: unknown[], posComplete?: boolean, posError?: string, posRevenue?: number|null, todayOrderCount?: number|null, openCheckCount?: number|null, lowStockCount?: number|null, asOf?: string|null}} DashboardDataExpectedView */
/** @typedef {{id: string, icon: import('react').ComponentType<import('lucide-react').LucideProps>, tone: keyof typeof TONE, label: string, title: string, sub: string, to: string}} AttentionItem */

const TONE = {
  red: 'bg-red-950/50 text-red-300',
  amber: 'bg-amber-950/50 text-amber-300',
  blue: 'bg-blue-950/50 text-blue-300',
  green: 'bg-green-950/50 text-green-300',
  purple: 'bg-purple-950/50 text-purple-300',
  slate: 'bg-gray-900 text-gray-300'
}

/** @param {{label: string, value: import('react').ReactNode, sub?: string, accent?: string, to?: string, onClick?: () => void}} props */
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

/** @param {{item: AttentionItem}} props */
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

/** @param {{to: string, icon: import('react').ComponentType<import('lucide-react').LucideProps>, label: string, sub: string}} props */
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
  const { user: routeUser } = useAuth()
  /** AppShell's authenticated route guard establishes a non-null session here; the source view remains nullable and this assertion does not validate its contents. @type {NonNullable<typeof routeUser> & {name: string|null, product_family: string|null}} */
  const user = /** @type {NonNullable<typeof routeUser> & {name: string|null, product_family: string|null}} */ (routeUser)
  const { can, features, isEnabled } = useFeatures()
  const { unreadCount: inboxUnreadCount } = useInbox()
  const pwaEnabled = Object.keys(features).length > 0 && features.pwa === true
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(/** @type {DashboardDataExpectedView|null} */ (null))
  const [bookings, setBookings] = useState(/** @type {DashboardBookingExpectedView[]} */ ([]))
  const [lastUpdated, setLastUpdated] = useState(/** @type {string|null} */ (null))
  const [loadError, setLoadError] = useState('')
  // Authority: server product_family on the session, not a client-inferred mode.
  const restaurantMode = isRestaurantProductFamily(user?.product_family)
  // isBarHospitalityMode string-coerces all inputs; preserve the raw session value and its runtime coercion.
  const barOnly = restaurantMode && isBarHospitalityMode(/** @type {string|null|undefined} */ (user?.hospitality_mode))
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), /** @type {Record<string, string>} */ ({}))
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    if (barOnly) {
      const message = 'This Bar is not linked to a verified local sync projection yet. No cloud POS or stock records are shown here.'
      setData({ posComplete: false, posError: message, posRevenue: null, todayOrderCount: null, openCheckCount: null, lowStockCount: null, lowStock: [], asOf: null })
      setBookings([])
      setLastUpdated(null)
      setLoadError(message)
      setLoading(false)
      return
    }
    try {
      const [snapshotResult, bookingRows] = restaurantMode
        ? await Promise.all([
            Promise.allSettled([
              getManagerPosSnapshot(user.lodge_id),
              listInventory(user.lodge_id)
            ]).then(([posResult, inventoryResult]) => {
              const pos = posResult.status === 'fulfilled' ? posResult.value : null
              // The inventory SELECT/cache result is expected to use this row view; cached JSON is not validated here.
              const inventory = inventoryResult.status === 'fulfilled' ? /** @type {DashboardInventoryExpectedView[]} */ (inventoryResult.value) : null
              const posComplete = pos?.complete === true
              const lowStock = (Array.isArray(inventory) ? inventory : []).filter((item) => {
                const reorder = Number(item.reorder_level || 0)
                return reorder > 0 && Number(item.current_stock || 0) <= reorder
              })
              return {
                posComplete,
                posError: posResult.status === 'rejected' ? (posResult.reason?.message || 'POS snapshot unavailable.') : (posComplete ? '' : 'POS snapshot incomplete.'),
                posRevenue: posComplete ? Number(pos.net_sales || 0) : null,
                todayOrderCount: posComplete ? Number(pos.sale_count || 0) : null,
                openCheckCount: posComplete ? Number(pos.open_count || 0) : null,
                lowStockCount: Array.isArray(inventory) ? lowStock.length : null,
                lowStock: lowStock.slice(0, 5),
                asOf: pos?.as_of || new Date().toISOString()
              }
            }),
            Promise.resolve([])
          ])
        : await Promise.all([
        getDashboardSnapshot(user.lodge_id),
            listBookings(user.lodge_id).catch(() => [])
          ])
      // getDashboardSnapshot's expected structure and the local POS summary share this consumer view; unknown arrays remain unknown.
      const snapshot = /** @type {DashboardDataExpectedView|null} */ (snapshotResult)
      setData(snapshot)
      if (restaurantMode && snapshot?.posError) setLoadError(snapshot.posError)
      // BOOKING_LIST_SELECT supplies these fields; the cache may hold unvalidated JSON.
      setBookings(/** @type {DashboardBookingExpectedView[]} */ (Array.isArray(bookingRows) ? bookingRows : []))
      setLastUpdated(
        restaurantMode
          ? snapshot?.asOf || null
          : /** @type {{updatedAt?: string|null}|null} */ (readCacheEntry(user.lodge_id, 'dashboard', null))?.updatedAt || null
      )
    } catch (error) {
      setData(null)
      setBookings([])
      setLoadError((/** @type {{message?: string}|null|undefined} */ (error))?.message || 'Dashboard could not load.')
    }
    setLoading(false)
  }, [barOnly, restaurantMode, user.lodge_id])

  useEffect(() => { load() }, [load])

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
  }, [load])

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
    const items = /** @type {AttentionItem[]} */ ([])

    if (!restaurantMode && overdueCheckouts.length > 0) {
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

    if (!restaurantMode && Number(data?.urgentMaintenanceCount || 0) > 0) {
      items.push({
        id: 'urgent-maintenance',
        icon: Wrench,
        tone: 'red',
        label: 'Maintenance',
        title: `${data?.urgentMaintenanceCount} urgent maintenance issue${data?.urgentMaintenanceCount === 1 ? '' : 's'}`,
        sub: 'Open Alerts to review priority work.',
        to: '/alerts?filter=maintenance'
      })
    }

    if (!restaurantMode && pendingOnline.length > 0) {
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

    if (!restaurantMode) {
      ;(/** @type {DashboardBookingExpectedView[]} */ (data?.topBalances || [])).slice(0, 1).forEach((booking) => {
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
    }

      ;(/** @type {DashboardInventoryExpectedView[]} */ (data?.lowStock || [])).slice(0, 1).forEach((item) => {
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
        sub: restaurantMode ? 'Manager has replied.' : 'Front desk has replied.',
        to: '/control'
      })
    }

    return items.slice(0, 5)
  }, [data, overdueCheckouts, pendingOnline, pwaEnabled, inboxUnreadCount, restaurantMode])

  const openAlertCount = useMemo(() => {
    return (
      overdueCheckouts.length +
      (restaurantMode ? 0 : Number(data?.openMaintenanceCount || 0)) +
      (restaurantMode ? 0 : Number(data?.unpaidCount || 0)) +
      Number(data?.lowStockCount || 0)
    )
  }, [data, overdueCheckouts, restaurantMode])

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
            {!loading && attentionItems.length === 0 && !loadError && (!restaurantMode || data?.posComplete === true) && (
              <div className="rounded-xl bg-gray-900 px-3 py-3 text-sm text-green-400 text-center">
                All clear \u2022 nothing needs attention
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => <MetricSkeleton key={index} />)
            : restaurantMode ? (
              <>
                <KpiCard
                  label="POS Sales Today"
                  value={data?.posComplete ? money(data.posRevenue) : 'Unavailable'}
                  accent="text-green-300"
                  to={barOnly ? undefined : '/pos'}
                />
                <KpiCard
                  label="Orders Today"
                  value={data?.posComplete ? data.todayOrderCount : 'Unavailable'}
                  sub={data?.posComplete ? 'Completed sales' : 'Server confirmation required'}
                  to={barOnly ? undefined : '/pos'}
                />
                <KpiCard
                  label={barOnly ? 'Open tabs' : 'Open checks'}
                  value={data?.posComplete ? data.openCheckCount : 'Unavailable'}
                  accent={data?.posComplete && Number(data?.openCheckCount || 0) > 0 ? 'text-yellow-300' : 'text-green-300'}
                  to={barOnly ? undefined : '/restaurant/floor'}
                />
                <KpiCard
                  label="Low Stock"
                  value={data?.lowStockCount === null ? 'Unavailable' : data?.lowStockCount}
                  sub="Items below reorder level"
                  to={barOnly ? undefined : '/alerts?filter=stock'}
                />
              </>
            ) : (
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
          {!barOnly && <QuickLink to="/money?focus=outstanding" icon={TrendingUp} label="Money" sub="Balances and audit" />}
          {can('pos.reports') && isEnabled('pos') && !barOnly && <QuickLink to="/pos" icon={ShoppingCart} label="POS Sales" sub="Live sales and history" />}
          {restaurantMode && (!barOnly || features?.owner_mobile_view === true) && <QuickLink to="/restaurant-owner" icon={Utensils} label={barOnly ? 'Bar Owner' : 'Owner View'} sub="Today's overview" />}
          {pwaEnabled && <QuickLink to="/control" icon={MessageSquare} label="Inbox" sub={inboxUnreadCount > 0 ? `${inboxUnreadCount} unread` : restaurantMode ? 'Manager chat' : 'Front desk chat'} />}
          {restaurantMode ? (
            !barOnly && <QuickLink to="/inventory" icon={Package} label="Inventory" sub="Stock and menu items" />
          ) : can('reports.view') ? (
            <QuickLink to="/reports" icon={FileText} label="Reports" sub="Full snapshot" />
          ) : (
            <QuickLink to="/bookings" icon={CalendarClock} label="Bookings" sub="Calendar and list" />
          )}
        </div>

        <MobileBoundaryNotice compact>
          {restaurantMode
            ? (barOnly ? 'Only records received from a verified local Bar sync will appear here. Trading remains on the Bar computer.' : 'Mobile is for visibility and alerts. POS and stock changes are managed on the main terminal.')
            : 'Mobile is for visibility and requests. Front desk still executes booking and money changes on desktop.'
          }
        </MobileBoundaryNotice>
      </div>
    </div>
  )
}

/** @param {DashboardBookingExpectedView|null|undefined} booking */
function guestLabel(booking) {
  return booking?.guest_name || booking?.customer_name || 'Guest'
}
