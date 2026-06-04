import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, CalendarClock, CreditCard, FileText, MessageSquare, Package, RefreshCw, TrendingUp, Wrench, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { createSupportTicket, getDashboardSnapshot, getFinancialActivityFeed, getSupportRequests, listBookings } from '../lib/api'
import { money, shortDate, shortDateTime } from '../lib/format'
import { buildPwaNotificationSourceKey, getSession, readCacheEntry, upsertPwaNotification } from '../lib/runtime'
import { useToast } from '../App'

const TONE = {
  red: 'bg-red-950/50 text-red-300',
  amber: 'bg-amber-950/50 text-amber-300',
  blue: 'bg-blue-950/50 text-blue-300',
  green: 'bg-green-950/50 text-green-300',
  purple: 'bg-purple-950/50 text-purple-300',
  slate: 'bg-gray-900 text-gray-300'
}

function KpiCard({ label, value, sub, accent = 'text-white', to, onClick }) {
  const className = 'bg-gray-800 rounded-2xl p-4 text-left active:scale-[0.98] transition-transform'
  const body = (
    <>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </>
  )

  if (to) return <Link to={to} className={className}>{body}</Link>
  return <button type="button" onClick={onClick} className={`w-full ${className}`}>{body}</button>
}

function MetricSkeleton() {
  return <div className="bg-gray-800 rounded-2xl p-4 animate-pulse h-[92px]" />
}

function DrilldownSheet({ title, rows, onClose, renderRow }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-t-3xl p-5 pb-28 w-full max-h-[85vh] overflow-y-auto overscroll-contain shadow-[0_-20px_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500"><X size={20} /></button>
        </div>
        <div className="space-y-2">
          {rows.map(renderRow)}
          {rows.length === 0 && <p className="text-sm text-gray-500">Nothing to show here.</p>}
        </div>
      </div>
    </div>
  )
}

function AttentionRow({ item }) {
  const Icon = item.icon
  return (
    <Link to={item.to} className="flex items-start gap-3 rounded-2xl bg-gray-900 px-3 py-3 active:scale-[0.99] transition-transform">
      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE[item.tone] || TONE.slate}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white">{item.title}</p>
          <span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            {item.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">{item.sub}</p>
      </div>
    </Link>
  )
}

function QuickLink({ to, icon: Icon, label, sub }) {
  return (
    <Link to={to} className="rounded-2xl bg-gray-800 px-3 py-3 active:scale-[0.98] transition-transform">
      <Icon size={17} className="text-green-300" />
      <p className="mt-2 text-sm font-semibold text-white">{label}</p>
      <p className="mt-1 text-xs text-gray-500">{sub}</p>
    </Link>
  )
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const { can } = useFeatures()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [activity, setActivity] = useState([])
  const [bookings, setBookings] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [sheet, setSheet] = useState(null)
  const [requestFeed, setRequestFeed] = useState([])
  const [deskNote, setDeskNote] = useState('')
  const [sendingDeskRequest, setSendingDeskRequest] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [snapshot, feed, requests, bookingRows] = await Promise.all([
        getDashboardSnapshot(user.lodge_id),
        getFinancialActivityFeed(user.lodge_id, 5).catch(() => []),
        getSupportRequests(user.lodge_id, 6).catch(() => []),
        listBookings(user.lodge_id).catch(() => [])
      ])
      setData(snapshot)
      setActivity(feed)
      setRequestFeed(Array.isArray(requests) ? requests : [])
      setBookings(Array.isArray(bookingRows) ? bookingRows : [])
      setLastUpdated(readCacheEntry(user.lodge_id, 'dashboard', null)?.updatedAt || null)
    } catch (error) {
      setLoadError(error?.message || 'Dashboard could not load.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

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
  const deskResponses = useMemo(
    () => requestFeed.filter((request) => String(request.status || 'open') !== 'open' || String(request.admin_notes || '').trim()),
    [requestFeed]
  )

  const openAlertCount =
    overdueCheckouts.length +
    Number(data?.openMaintenanceCount || 0) +
    Number(data?.unpaidCount || 0) +
    Number(data?.lowStockCount || 0)

  const confidenceLabel = typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'Offline cache'
    : lastUpdated ? `Live • updated ${shortDateTime(lastUpdated)}` : 'Live'

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
        to: '/alerts'
      })
    }

    if (pendingOnline.length > 0) {
      items.push({
        id: 'pending-online',
        icon: CalendarClock,
        tone: 'amber',
        label: 'Online',
        title: `${pendingOnline.length} online request${pendingOnline.length === 1 ? '' : 's'} waiting`,
        sub: `${guestLabel(pendingOnline[0])} needs front desk confirmation on desktop.`,
        to: '/bookings'
      })
    }

    if (Number(data?.urgentMaintenanceCount || 0) > 0) {
      items.push({
        id: 'urgent-maintenance',
        icon: Wrench,
        tone: 'red',
        label: 'Maintenance',
        title: `${data.urgentMaintenanceCount} urgent maintenance issue${data.urgentMaintenanceCount === 1 ? '' : 's'}`,
        sub: 'Open Alerts to review priority work before rooms are sold.',
        to: '/alerts'
      })
    }

    ;(data?.topBalances || []).slice(0, 2).forEach((booking) => {
      items.push({
        id: `balance-${booking.id}`,
        icon: CreditCard,
        tone: 'amber',
        label: 'Balance',
        title: guestLabel(booking),
        sub: `Outstanding ${money(booking.balance)} • ${shortDate(booking.check_in)}`,
        to: '/money'
      })
    })

    ;(data?.lowStock || []).slice(0, 1).forEach((item) => {
      items.push({
        id: `stock-${item.id}`,
        icon: Package,
        tone: 'blue',
        label: 'Stock',
        title: item.name || 'Low stock item',
        sub: `${item.current_stock ?? item.quantity ?? 0} left • reorder at ${item.reorder_level}`,
        to: '/alerts'
      })
    })

    deskResponses.slice(0, 1).forEach((request) => {
      items.push({
        id: `desk-${request.id}`,
        icon: BellRing,
        tone: 'blue',
        label: 'Desk',
        title: request.title,
        sub: request.admin_notes || `Status changed to ${request.status || 'open'}.`,
        to: '/control'
      })
    })

    return items.slice(0, 5)
  }, [data, deskResponses, overdueCheckouts, pendingOnline])

  const session = getSession()
  const timelineItems = useMemo(() => [
    ...todayArrivals.slice(0, 2).map((booking) => ({
      id: `arr-${booking.id}`,
      kind: booking.source === 'online' && booking.status === 'pending' ? 'online request' : 'arrival',
      label: guestLabel(booking),
      sub: `Room ${booking.room_number || 'TBD'} • ${shortDate(booking.check_in)}`
    })),
    ...activity
      .filter((item) => !session?.started_at || item.created_at >= session.started_at)
      .slice(0, 2)
      .map((item) => ({
        id: item.id,
        kind: item.type ? String(item.type).replace(/_/g, ' ') : 'activity',
        label: item.title,
        sub: item.sub || shortDateTime(item.created_at)
      }))
  ].slice(0, 3), [activity, session?.started_at, todayArrivals])

  async function sendDeskRequest() {
    const description = deskNote.trim()
    if (!description) return

    setSendingDeskRequest(true)
    const title = 'Manager desk message'
    const category = 'Front Desk Request'
    const priority = 'Normal'
    const now = new Date().toISOString()

    try {
      const result = await createSupportTicket(user.lodge_id, {
        lodge_name: user.lodge_display_name,
        title,
        description,
        category,
        priority
      })
      upsertPwaNotification(user.lodge_id, {
        sourceKey: buildPwaNotificationSourceKey('frontdesk-request', title, description, category, priority),
        title: `Sent to front desk: ${title}`,
        message: description,
        tone: 'info',
        category: 'frontDeskRequest',
        href: '/control',
        meta: {
          requestTitle: title,
          requestBody: description,
          deskResponse: '',
          requestStatus: 'open',
          requestCategory: category,
          requestPriority: priority,
          sentAt: now,
          updatedAt: now
        }
      })
      if (!result?.queued) setDeskNote('')
      showToast({
        title: result?.queued ? 'Request saved offline' : 'Request sent',
        message: result?.queued
          ? 'It will reach front desk automatically when the internet returns.'
          : 'Front desk can now see this request on the desktop dashboard.',
        tone: result?.queued ? 'queued' : 'success'
      })
    } catch (error) {
      showToast({
        title: 'Request was not sent',
        message: error?.message || 'Please try again.',
        tone: 'error'
      })
    } finally {
      setSendingDeskRequest(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-5 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400">Welcome back</p>
          <h1 className="text-lg font-bold text-white truncate">{user.name}</h1>
          <p className="text-xs text-green-400 capitalize mt-1">{user.role} • {user.lodge_display_name}</p>
          <p className="text-[11px] text-gray-500 mt-1">{confidenceLabel}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={logout} className="text-xs text-red-400">Sign out</button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loadError && (
          <div className="bg-red-950/40 border border-red-900 rounded-2xl px-4 py-3 text-sm text-red-200">
            {loadError}
          </div>
        )}

        <div className="rounded-2xl border border-green-900/50 bg-green-950/20 px-4 py-3">
          <p className="text-sm font-semibold text-green-100">Today + action queue</p>
          <p className="mt-1 text-xs text-green-300/80">
            Mobile is for visibility and requests. Front desk still executes booking and money changes on desktop.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {loading
            ? Array.from({ length: 6 }).map((_, index) => <MetricSkeleton key={index} />)
            : (
              <>
                <KpiCard
                  label="Today Arrivals"
                  value={todayArrivals.length}
                  onClick={() => setSheet({ title: 'Today Arrivals', rows: todayArrivals, type: 'booking' })}
                />
                <KpiCard
                  label="Today Departures"
                  value={todayDepartures.length}
                  onClick={() => setSheet({ title: 'Today Departures', rows: todayDepartures, type: 'booking' })}
                />
                <KpiCard
                  label="Occupancy"
                  value={`${data?.occupancyPercent || 0}%`}
                  sub={`${data?.occupied || 0}/${data?.totalRooms || 0} rooms`}
                  accent="text-green-300"
                  to="/rooms"
                />
                <KpiCard
                  label="Outstanding"
                  value={money(data?.outstandingTotal)}
                  accent={Number(data?.outstandingTotal || 0) > 0 ? 'text-yellow-300' : 'text-green-300'}
                  to="/money"
                />
                <KpiCard
                  label="Open Alerts"
                  value={openAlertCount}
                  sub={openAlertCount > 0 ? 'Needs review' : 'All clear'}
                  accent={openAlertCount > 0 ? 'text-amber-300' : 'text-green-300'}
                  to="/alerts"
                />
                <KpiCard
                  label="Online Requests"
                  value={pendingOnline.length}
                  sub="Pending desktop confirmation"
                  accent={pendingOnline.length > 0 ? 'text-amber-300' : 'text-green-300'}
                  onClick={() => setSheet({ title: 'Online Requests', rows: pendingOnline, type: 'booking' })}
                />
              </>
            )}
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Needs attention</p>
              <p className="mt-1 text-xs text-gray-500">The highest-priority items to nudge or review first.</p>
            </div>
            <Link to="/alerts" className="shrink-0 text-xs text-green-400">See all</Link>
          </div>
          <div className="space-y-2">
            {attentionItems.map((item) => <AttentionRow key={item.id} item={item} />)}
            {!loading && attentionItems.length === 0 && (
              <div className="rounded-2xl bg-gray-900 px-3 py-4 text-sm text-gray-500">
                No urgent follow-up right now.
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white flex items-center gap-2"><MessageSquare size={16} className="text-green-300" /> Message front desk</p>
              <p className="mt-1 text-xs text-gray-500">Send a simple request without changing records from mobile.</p>
            </div>
            <Link to="/control" className="text-xs text-green-400">Tracker</Link>
          </div>
          <textarea
            className="mt-3 w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-white text-sm h-24 resize-none"
            placeholder="Ask front desk to follow up..."
            value={deskNote}
            onChange={(event) => setDeskNote(event.target.value)}
            maxLength={500}
          />
          <button
            type="button"
            onClick={sendDeskRequest}
            disabled={sendingDeskRequest || !deskNote.trim()}
            className="mt-3 w-full rounded-xl bg-green-700 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sendingDeskRequest ? 'Sending...' : 'Send to front desk'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <QuickLink to="/alerts" icon={AlertTriangle} label="Alerts" sub={`${openAlertCount} open`} />
          <QuickLink to="/money" icon={TrendingUp} label="Money" sub="Balances and audit" />
          <QuickLink to="/control" icon={MessageSquare} label="Control" sub="Requests and sync" />
          {can('reports.view') ? (
            <QuickLink to="/reports" icon={FileText} label="Reports" sub="Full snapshot" />
          ) : (
            <QuickLink to="/bookings" icon={CalendarClock} label="Bookings" sub="Calendar and list" />
          )}
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Today timeline</p>
            <span className="text-xs text-gray-500">{session?.started_at ? shortDateTime(session.started_at) : 'This session'}</span>
          </div>
          <div className="space-y-2">
            {timelineItems.map((item) => (
              <div key={item.id} className="rounded-xl bg-gray-900 px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">{item.kind}</p>
                <p className="mt-1 text-sm font-semibold text-white">{item.label}</p>
                <p className="mt-1 text-xs text-gray-400">{item.sub}</p>
              </div>
            ))}
            {timelineItems.length === 0 && <p className="text-sm text-gray-500">Nothing notable has happened yet today.</p>}
          </div>
        </div>
      </div>

      {sheet && (
        <DrilldownSheet
          title={sheet.title}
          rows={sheet.rows}
          onClose={() => setSheet(null)}
          renderRow={(row) => (
            <div key={row.id} className="bg-gray-800 rounded-xl px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{guestLabel(row)}</p>
                {row.source === 'online' && row.status === 'pending' && (
                  <span className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    Waiting for front desk
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {`${shortDate(row.check_in)}${row.check_out ? ` -> ${shortDate(row.check_out)}` : ''}`}
              </p>
              {row.room_number && <p className="text-[11px] text-gray-500 mt-1">Room {row.room_number}</p>}
              {row.manager_arrival_note && <p className="text-[11px] text-amber-300 mt-2">{row.manager_arrival_note}</p>}
            </div>
          )}
        />
      )}
    </div>
  )
}

function guestLabel(booking) {
  return booking?.guest_name || booking?.customer_name || 'Guest'
}
