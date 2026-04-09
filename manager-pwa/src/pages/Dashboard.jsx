import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Briefcase, CalendarClock, CreditCard, RefreshCw, TrendingUp, Wrench, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { getDashboardSnapshot, getFinancialActivityFeed } from '../lib/api'
import { money, shortDate, shortDateTime } from '../lib/format'
import { getSession, readCacheEntry } from '../lib/runtime'

function MetricCard({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function MetricSkeleton() {
  return <div className="bg-gray-800 rounded-2xl p-4 animate-pulse h-[88px]" />
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

export default function Dashboard() {
  const { user, logout } = useAuth()
  const { can } = useFeatures()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [activity, setActivity] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [sheet, setSheet] = useState(null)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [snapshot, feed] = await Promise.all([
        getDashboardSnapshot(user.lodge_id),
        getFinancialActivityFeed(user.lodge_id, 8).catch(() => [])
      ])
      setData(snapshot)
      setActivity(feed)
      setLastUpdated(readCacheEntry(user.lodge_id, 'dashboard', null)?.updatedAt || null)
    } catch (error) {
      setLoadError(error?.message || 'Dashboard could not load.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])
  const dailySummary = useMemo(() => {
    const arrivals = (data?.upcomingArrivals || []).filter((booking) => booking.check_in === new Date().toISOString().slice(0, 10)).length
    const departures = (data?.upcomingArrivals || []).filter((booking) => booking.check_out === new Date().toISOString().slice(0, 10)).length
    return {
      arrivals,
      departures,
      urgentIssues: Number(data?.urgentMaintenanceCount || 0) + Number(data?.unpaidCount || 0),
      occupied: Number(data?.occupied || 0)
    }
  }, [data])
  const session = getSession()
  const changesSinceLogin = useMemo(
    () => activity.filter((item) => session?.started_at && item.created_at > session.started_at).slice(0, 4),
    [activity, session?.started_at]
  )
  const occupancyDays = data?.occupancyTrend || []
  const confidenceLabel = typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'Offline cache'
    : lastUpdated ? `Live • updated ${shortDateTime(lastUpdated)}` : 'Live'
  const timelineItems = [
    ...(data?.upcomingArrivals || []).slice(0, 3).map((booking) => ({ id: `arr-${booking.id}`, kind: booking.manager_arrival_status === 'awaiting_front_desk_confirmation' ? 'online request' : 'arrival', label: guestLabel(booking), sub: booking.manager_arrival_note || `Arrival • ${shortDate(booking.check_in)}` })),
    ...(activity.filter((item) => item.type === 'refund_approved').slice(0, 2).map((item) => ({ id: item.id, kind: 'refund', label: item.title, sub: shortDateTime(item.created_at) }))),
    ...(data?.topBalances || []).slice(0, 2).map((booking) => ({ id: `bal-${booking.id}`, kind: 'balance', label: guestLabel(booking), sub: `Balance ${money(booking.balance)}` }))
  ].slice(0, 6)

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-400">Welcome back</p>
          <h1 className="text-lg font-bold text-white">{user.name}</h1>
          <p className="text-xs text-green-400 capitalize mt-1">{user.role} • {user.lodge_display_name}</p>
          <p className="text-[11px] text-gray-500 mt-1">{confidenceLabel}</p>
        </div>
        <div className="flex items-center gap-2">
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
        {data?.urgentMaintenanceCount > 0 && (
          <div className="bg-red-950/40 border border-red-900 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm text-red-200">
            <AlertTriangle size={16} />
            {data.urgentMaintenanceCount} urgent maintenance issue{data.urgentMaintenanceCount === 1 ? '' : 's'} needs attention.
          </div>
        )}

        <div className="bg-gray-800 rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Manager Briefing</p>
              <p className="text-2xl font-bold text-white mt-2">{money(data?.monthRevenue || 0)}</p>
              <p className="text-xs text-gray-500 mt-1">Net cash month to date • refunds already deducted</p>
              <p className="text-[11px] text-gray-600 mt-1">Use this as your quick health check before drilling into money, arrivals, or requests.</p>
            </div>
            <Link to="/audit" className="text-xs text-green-400">Open audit</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {loading
              ? Array.from({ length: 4 }).map((_, index) => <MetricSkeleton key={index} />)
              : (
                <>
                  <button onClick={() => setSheet({ title: 'Today Arrivals', rows: (data?.upcomingArrivals || []).filter((booking) => booking.check_in === new Date().toISOString().slice(0, 10)), type: 'booking' })}><MetricCard label="Today Arrivals" value={dailySummary.arrivals} /></button>
                  <button onClick={() => setSheet({ title: 'Today Departures', rows: (data?.upcomingArrivals || []).filter((booking) => booking.check_out === new Date().toISOString().slice(0, 10)), type: 'booking' })}><MetricCard label="Today Departures" value={dailySummary.departures} /></button>
                  <button onClick={() => setSheet({ title: 'Refunds This Month', rows: activity.filter((item) => item.type === 'refund_approved'), type: 'activity' })}><MetricCard label="Refunds This Month" value={money(data?.monthRefunds)} accent="text-rose-300" /></button>
                  <button onClick={() => setSheet({ title: 'Urgent Follow-up', rows: [...(data?.topBalances || []), ...(data?.lowStock || [])], type: 'mixed' })}><MetricCard label="Urgent Follow-up" value={dailySummary.urgentIssues} accent={dailySummary.urgentIssues > 0 ? 'text-yellow-300' : 'text-green-300'} /></button>
                </>
              )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Today Timeline</p>
            <span className="text-xs text-gray-500">Rolling activity</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {timelineItems.map((item) => (
              <div key={item.id} className="min-w-[170px] bg-gray-900 rounded-xl px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">{item.kind}</p>
                <p className="text-sm font-semibold text-white mt-1">{item.label}</p>
                <p className="text-xs text-gray-400 mt-1">{item.sub}</p>
              </div>
            ))}
            {timelineItems.length === 0 && <p className="text-sm text-gray-500">Nothing notable has happened yet today.</p>}
          </div>
        </div>

        <div className="bg-gray-800 rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400">Owner Snapshot</p>
              <p className="text-3xl font-bold text-white mt-2">{data?.occupancyPercent || 0}%</p>
              <p className="text-xs text-gray-500 mt-1">Current occupancy • {data?.occupied || 0}/{data?.totalRooms || 0} rooms</p>
            </div>
            <div className="w-28 h-28 rounded-full border-8 border-green-900/50 flex items-center justify-center">
              <span className="text-xl font-bold text-green-300">{data?.occupancyPercent || 0}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <MetricCard label="Month Gross Cash" value={money(data?.monthGrossCollected)} sub={`Refunds ${money(data?.monthRefunds)}`} accent="text-green-300" />
            <MetricCard label="Month Expenses" value={money(data?.monthExpenses)} accent="text-red-300" />
            <MetricCard label="Outstanding" value={money(data?.outstandingTotal)} accent="text-yellow-300" />
            <MetricCard label="Month Net Cash" value={money(data?.monthNet)} sub={`After refunds ${money(data?.monthRefunds)}`} accent={Number(data?.monthNet || 0) >= 0 ? 'text-green-300' : 'text-red-300'} />
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">What Changed Since Last Login</p>
            <span className="text-xs text-gray-500">{session?.started_at ? shortDateTime(session.started_at) : 'This session'}</span>
          </div>
          <div className="space-y-2">
            {changesSinceLogin.map((item) => (
              <div key={item.id} className="bg-gray-900 rounded-xl px-3 py-3">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="text-xs text-gray-400 mt-1">{item.sub}</p>
              </div>
            ))}
            {changesSinceLogin.length === 0 && <p className="text-sm text-gray-500">No new major changes since you signed in.</p>}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">7-Day Occupancy Outlook</p>
            <Link to="/bookings" className="text-xs text-green-400">Bookings</Link>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {occupancyDays.map((day) => (
              <div key={day.day} className="bg-gray-900 rounded-xl px-2 py-3 text-center">
                <p className="text-[11px] text-gray-500">{shortDate(day.day).slice(0, 6)}</p>
                <p className="text-sm font-bold text-white mt-1">{day.percent}%</p>
                <div className="mt-2 h-2 rounded-full bg-gray-800 overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.max(4, Number(day.percent || 0))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link to="/money" className="bg-gray-800 rounded-2xl p-4">
            <TrendingUp size={18} className="text-green-300" />
            <p className="text-sm font-semibold text-white mt-3">Money</p>
            <p className="text-xs text-gray-400 mt-1">Cash, refunds, balances, and quotes in one view</p>
          </Link>
          <Link to="/control" className="bg-gray-800 rounded-2xl p-4">
            <Briefcase size={18} className="text-blue-300" />
            <p className="text-sm font-semibold text-white mt-3">Control</p>
            <p className="text-xs text-gray-400 mt-1">Sync health, request tracking, and support</p>
          </Link>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2"><CalendarClock size={16} className="text-green-300" /> Upcoming Arrivals</p>
            <Link to="/bookings" className="text-xs text-green-400">Bookings</Link>
          </div>
          <p className="mb-3 text-xs text-gray-500">Online requests stay clearly marked here until front desk confirms them in the desktop app.</p>
          <div className="space-y-2">
            {(data?.upcomingArrivals || []).map((booking) => (
              <div key={booking.id} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{booking.guest_name || booking.customer_name || 'Guest'}</p>
                    {booking.manager_arrival_status === 'awaiting_front_desk_confirmation' && (
                      <span className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        Online request
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{shortDate(booking.check_in)} • Room {booking.room_number || 'TBD'}</p>
                  <p className={`text-[11px] mt-1 ${booking.manager_arrival_status === 'awaiting_front_desk_confirmation' ? 'text-amber-300' : 'text-gray-500'}`}>
                    {booking.manager_arrival_note}
                  </p>
                </div>
                <span className="text-xs text-yellow-300">{money(Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)))}</span>
              </div>
            ))}
            {(!data?.upcomingArrivals || data.upcomingArrivals.length === 0) && <p className="text-sm text-gray-500">No arrivals in the next 7 days.</p>}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2"><CreditCard size={16} className="text-yellow-300" /> Top Balances</p>
            <Link to="/invoices" className="text-xs text-green-400">Invoices</Link>
          </div>
          <div className="space-y-2">
            {(data?.topBalances || []).map((booking) => (
              <div key={booking.id} className="bg-gray-900 rounded-xl px-3 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{booking.guest_name || booking.customer_name || 'Guest'}</p>
                  <p className="text-xs text-gray-400 mt-1">{shortDate(booking.check_in)} → {shortDate(booking.check_out)}</p>
                </div>
                <span className="text-xs text-red-300 font-semibold">{money(booking.balance)}</span>
              </div>
            ))}
            {(!data?.topBalances || data.topBalances.length === 0) && <p className="text-sm text-gray-500">No outstanding balances right now.</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link to="/alerts" className="bg-gray-800 rounded-2xl p-4">
            <Wrench size={18} className="text-orange-300" />
            <p className="text-sm font-semibold text-white mt-3">Alerts</p>
            <p className="text-xs text-gray-400 mt-1">{data?.openMaintenanceCount || 0} open maintenance</p>
          </Link>
          {can('inventory.view') ? (
            <Link to="/inventory" className="bg-gray-800 rounded-2xl p-4">
              <AlertTriangle size={18} className="text-blue-300" />
              <p className="text-sm font-semibold text-white mt-3">Low Stock</p>
              <p className="text-xs text-gray-400 mt-1">{data?.lowStockCount || 0} items need buying</p>
            </Link>
          ) : (
            <Link to="/control" className="bg-gray-800 rounded-2xl p-4">
              <AlertTriangle size={18} className="text-blue-300" />
              <p className="text-sm font-semibold text-white mt-3">Control</p>
              <p className="text-xs text-gray-400 mt-1">Sync, plan, and support</p>
            </Link>
          )}
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">Recent Lodge Activity</p>
            <Link to="/money" className="text-xs text-green-400">Money</Link>
          </div>
          <div className="space-y-2">
            {activity.map((item) => (
              <div key={item.id} className="bg-gray-900 rounded-xl px-3 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-xs text-gray-400 mt-1">{item.sub}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{shortDateTime(item.created_at)}</p>
                </div>
                {item.amount !== null && (
                  <span className={`text-xs font-semibold ${Number(item.amount) < 0 ? 'text-rose-300' : 'text-green-300'}`}>
                    {money(item.amount)}
                  </span>
                )}
              </div>
            ))}
            {activity.length === 0 && <p className="text-sm text-gray-500">No recent activity yet.</p>}
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
                <p className="text-sm font-semibold text-white">
                  {sheet.type === 'activity'
                    ? row.title
                    : sheet.type === 'mixed'
                      ? mixedItemLabel(row)
                      : guestLabel(row)}
                </p>
                {sheet.type === 'booking' && row.manager_arrival_status === 'awaiting_front_desk_confirmation' && (
                  <span className="rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    Waiting for front desk
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {sheet.type === 'activity'
                  ? row.sub
                  : sheet.type === 'mixed'
                    ? mixedItemSub(row)
                    : `${shortDate(row.check_in)}${row.check_out ? ` → ${shortDate(row.check_out)}` : ''}`}
              </p>
              {sheet.type === 'booking' && row.manager_arrival_note && (
                <p className={`text-[11px] mt-2 ${row.manager_arrival_status === 'awaiting_front_desk_confirmation' ? 'text-amber-300' : 'text-gray-500'}`}>
                  {row.manager_arrival_note}
                </p>
              )}
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

function mixedItemLabel(row) {
  if (row?.room_number || row?.check_in || row?.customer_name || row?.guest_name) {
    return guestLabel(row)
  }
  return row?.name || row?.title || 'Follow-up item'
}

function mixedItemSub(row) {
  if (row?.room_number || row?.check_in || row?.customer_name || row?.guest_name) {
    const base = `${shortDate(row.check_in)}${row.check_out ? ` → ${shortDate(row.check_out)}` : ''}`
    const detail = row?.manager_arrival_note || `Balance ${money(row.balance)}`
    return `${base} • ${detail}`
  }
  const stock = row?.current_stock != null ? `${row.current_stock} ${row.unit || 'units'} left` : 'Needs attention'
  return `${row?.category || 'Stock'} • ${stock}`
}
