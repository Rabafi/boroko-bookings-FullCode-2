import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { getReportsSnapshot, getDashboardSnapshot, listBookings, listRooms, listStaff } from '../lib/api'
import { RefreshCw, Lock } from 'lucide-react'
import { format } from 'date-fns'
import { readCacheEntry } from '../lib/runtime'
import { shortDateTime } from '../lib/format'
import { MONTHLY_USAGE_RESET_COPY, countMonthlyUsageBookings, getPlanRecommendation, getPlanUsageLimits, getUsageLimitStatus } from '@shared/subscriptionPlans'
import { isRestaurantProductFamily } from '../lib/productShell'

function StatRow({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0">
      <div>
        <p className="text-sm text-gray-300">{label}</p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
      <p className={`text-base font-bold ${color}`}>{value}</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-4 mb-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{title}</p>
      {children}
    </div>
  )
}

function ComparisonBar({ current, previous, label, formatValue, accent = 'green' }) {
  const max = Math.max(Math.abs(current || 0), Math.abs(previous || 0), 1)
  const currentPct = Math.min(((current || 0) / max) * 100, 100)
  const previousPct = Math.min(((previous || 0) / max) * 100, 100)
  const diff = (current || 0) - (previous || 0)
  const diffPct = previous ? Math.round((diff / Math.abs(previous)) * 100) : null
  const trendUp = diff > 0
  const trendDown = diff < 0
  const accentColors = {
    green: { bar: 'bg-green-500', track: 'bg-green-900/40', text: 'text-green-400' },
    blue: { bar: 'bg-blue-500', track: 'bg-blue-900/40', text: 'text-blue-400' },
    red: { bar: 'bg-red-500', track: 'bg-red-900/40', text: 'text-red-400' },
    amber: { bar: 'bg-amber-500', track: 'bg-amber-900/40', text: 'text-amber-400' },
    cyan: { bar: 'bg-cyan-500', track: 'bg-cyan-900/40', text: 'text-cyan-400' },
    indigo: { bar: 'bg-indigo-500', track: 'bg-indigo-900/40', text: 'text-indigo-400' }
  }
  const colors = accentColors[accent] || accentColors.green

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-300">{label}</p>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${colors.text}`}>{formatValue(current)}</span>
          {diffPct !== null && (
            <span className={`text-[10px] font-semibold ${trendUp ? 'text-green-400' : trendDown ? 'text-red-400' : 'text-gray-500'}`}>
              {trendUp ? `+${diffPct}%` : trendDown ? `${diffPct}%` : '—'}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        <div className={`flex-1 h-2 rounded-full ${colors.track} overflow-hidden`}>
          <div className={`h-full rounded-full ${colors.bar} transition-all`} style={{ width: `${currentPct}%` }} />
        </div>
        <div className={`flex-1 h-2 rounded-full bg-gray-700/40 overflow-hidden`}>
          <div className="h-full rounded-full bg-gray-500/50 transition-all" style={{ width: `${previousPct}%` }} />
        </div>
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-gray-500">This month</span>
        <span className="text-[9px] text-gray-600">Last month: {formatValue(previous)}</span>
      </div>
    </div>
  )
}

function RevenueMixBar({ segments, total }) {
  if (!total || total <= 0) return null
  return (
    <div className="mt-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-700/30">
        {segments.map((seg) => {
          const pct = Math.max(((seg.value || 0) / total) * 100, 0)
          if (pct <= 0) return null
          return (
            <div
              key={seg.label}
              className={`h-full ${seg.color} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: P ${Math.round(seg.value || 0).toLocaleString()}`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {segments.filter((s) => (s.value || 0) > 0).map((seg) => (
          <div key={seg.label} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${seg.color}`} />
            <span className="text-[10px] text-gray-400">{seg.label}</span>
            <span className="text-[10px] text-gray-500">P {Math.round(seg.value || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Reports() {
  const { user } = useAuth()
  const { isEnabled } = useFeatures()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [usage, setUsage] = useState({ monthlyBookings: 0, rooms: 0, users: 0, plan: 'Starter' })
  // Server product_family on the session is authoritative.
  const restaurantMode = isRestaurantProductFamily(user?.product_family)
  const now = new Date()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const today = new Date()
      const [snapshot, dashboard, bookings, rooms, staff] = await Promise.all([
        getReportsSnapshot(user.lodge_id, {
          today: format(today, 'yyyy-MM-dd'),
          forceFresh: true
        }),
        getDashboardSnapshot(user.lodge_id).catch(() => null),
        listBookings(user.lodge_id).catch(() => []),
        listRooms(user.lodge_id).catch(() => []),
        listStaff(user.lodge_id).catch(() => [])
      ])
      setData(snapshot)
      const plan = dashboard?.entitlement?.plan || user?.plan || 'Starter'
      setUsage({
        monthlyBookings: countMonthlyUsageBookings(bookings || [], new Date()),
        rooms: Array.isArray(rooms) ? rooms.length : 0,
        users: Array.isArray(staff) ? staff.length : 0,
        plan
      })
      setLastUpdated(readCacheEntry(user.lodge_id, 'reports_snapshot', null)?.updatedAt || null)
    } catch (e) {
      console.error('Reports load error:', e)
      setLoadError(e?.message || 'Reports could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id, user?.plan, user?.product_family])

  useEffect(() => { load() }, [load])

  if (!isEnabled('reports')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 px-6 text-center pb-24">
        <Lock size={40} className="text-gray-600 mb-4" />
        <h2 className="text-white font-bold text-lg mb-2">Reports Locked</h2>
        <p className="text-gray-400 text-sm">Upgrade to Standard or Pro to access reports.</p>
      </div>
    )
  }

  const fmt = (n) => `P ${Number(n || 0).toLocaleString()}`
  const pct = (n) => `${n}%`
  const maintenanceTotal = Number(data?.maintenanceCosts || 0)
  const retainedThisMonth = Number(data?.monthRetainedRevenue || 0)
  const retainedLastMonth = Number(data?.lastMonthRetainedRevenue || 0)
  const expenseTotal = Number(data?.monthExpenses || 0) + maintenanceTotal
  const reportsUsingOfflineData = (typeof navigator !== 'undefined' && navigator.onLine === false) || (data?.source && data.source !== 'server')
  const offlineDataLabel = `Offline data (last synced: ${lastUpdated ? shortDateTime(lastUpdated) : 'unknown'})`
  const usageLimits = getPlanUsageLimits(usage.plan)
  const usageStatus = getUsageLimitStatus({ used: usage.monthlyBookings, limit: usageLimits.monthlyBookings, grace: usageLimits.monthlyBookingsGrace })
  const usageRecommendation = getPlanRecommendation({ plan: usage.plan, usage, limits: usageLimits })
  const totalRevenue = (data?.monthRev || 0) + (data?.posRevenue || 0) + (data?.conferenceRevenue || 0) + (data?.poolRevenue || 0)
  const totalLastMonthRevenue = (data?.lastMonthRev || 0)

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Reports</h1>
          <p className="text-xs text-gray-400">{format(now, 'MMMM yyyy')}</p>
          <p className="text-[11px] text-gray-500 mt-1">{typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline cache' : lastUpdated ? `Updated ${shortDateTime(lastUpdated)}` : 'Live data'}</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {loading ? (
        <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="px-4 py-4">
          {loadError && (
            <div className="mb-3 rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-3">
              <p className="text-sm text-red-200">{loadError}</p>
            </div>
          )}
          {reportsUsingOfflineData && (
            <div className="mb-3 rounded-2xl border border-amber-900/60 bg-amber-950/30 px-4 py-3">
              <p className="text-sm font-semibold text-amber-200">{offlineDataLabel}</p>
              <p className="mt-1 text-xs text-amber-300">{restaurantMode ? 'Revenue, expenses, and sales figures are using offline or cached data and should not be treated as final until live sync resumes.' : 'Revenue, expenses, and occupancy figures are using offline or cached data and should not be treated as final until live sync resumes.'}</p>
            </div>
          )}
          <Section title={`Subscription Usage · ${usage.plan}`}>
            <StatRow label={restaurantMode ? 'Orders this month' : 'Bookings this month'} value={`${usage.monthlyBookings}/${usageLimits.monthlyBookings ?? 'unlimited'}`} sub={usageLimits.monthlyBookingsGrace ? `Grace +${usageLimits.monthlyBookingsGrace}` : ''} color={usageStatus.state === 'blocked' ? 'text-rose-300' : usageStatus.state === 'critical' || usageStatus.state === 'grace' ? 'text-amber-300' : 'text-white'} />
            {!restaurantMode && <StatRow label="Rooms" value={`${usage.rooms}/${usageLimits.rooms ?? 'unlimited'}`} />}
            <StatRow label="Users" value={`${usage.users}/${usageLimits.users ?? 'unlimited'}`} />
            <p className="mt-2 text-[11px] text-gray-500">{MONTHLY_USAGE_RESET_COPY}</p>
            <p className="mt-1 text-[11px] text-blue-300">{usageRecommendation.label}</p>
          </Section>
          {!data ? (
            <div className="rounded-2xl bg-gray-800 px-4 py-6 text-sm text-gray-400">
              Reports data is not available yet on this device.
            </div>
          ) : (
            <>
          {!restaurantMode && (
          <div className="bg-green-900/30 border border-green-700/40 rounded-2xl p-4 mb-3">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Live Now</p>
            <div className="flex items-center justify-between">
              <div><p className="text-3xl font-bold text-white">{data.currentOcc}<span className="text-lg text-gray-400">/{data.totalRooms}</span></p><p className="text-xs text-gray-400">Rooms occupied</p></div>
              <div className="text-right"><p className="text-2xl font-bold text-green-400">{data.totalRooms > 0 ? Math.round((data.currentOcc / data.totalRooms) * 100) : 0}%</p><p className="text-xs text-gray-400">Occupancy</p></div>
            </div>
          </div>
          )}

          {restaurantMode && (
          <div className="bg-green-900/30 border border-green-700/40 rounded-2xl p-4 mb-3">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Today's Summary</p>
            <div className="flex items-center justify-between">
              <div><p className="text-3xl font-bold text-white">{fmt(data.todayRev || 0)}</p><p className="text-xs text-gray-400">Sales today</p></div>
              <div className="text-right"><p className="text-2xl font-bold text-green-400">{fmt(data.posRevenue || 0)}</p><p className="text-xs text-gray-400">POS revenue</p></div>
            </div>
          </div>
          )}

          <Section title="Trends">
            {!restaurantMode && (
              <ComparisonBar
                label="Occupancy"
                current={data.monthOcc}
                previous={data.lastMonthOcc}
                formatValue={(v) => `${v}%`}
                accent="green"
              />
            )}
            <ComparisonBar
              label={restaurantMode ? 'Sales' : 'Cash Collected'}
              current={restaurantMode ? (data.posRevenue || 0) : data.monthRev}
              previous={restaurantMode ? 0 : data.lastMonthRev}
              formatValue={fmt}
              accent="blue"
            />
            {isEnabled('expenses') && (
              <ComparisonBar
                label="Expenses"
                current={expenseTotal}
                previous={0}
                formatValue={fmt}
                accent="red"
              />
            )}
          </Section>

          {isEnabled('pos') && !restaurantMode && totalRevenue > 0 && (
            <Section title="Revenue Mix">
              <p className="text-xs text-gray-500 mb-1">Breakdown of total revenue this month</p>
              <RevenueMixBar
                segments={[
                  { label: 'Accommodation', value: data.monthRev, color: 'bg-green-500' },
                  { label: 'POS', value: data.posRevenue, color: 'bg-blue-500' },
                  { label: 'Conference', value: data.conferenceRevenue, color: 'bg-indigo-500' },
                  { label: 'Day Use', value: data.poolRevenue, color: 'bg-cyan-500' }
                ]}
                total={totalRevenue}
              />
              <p className="mt-2 text-xs text-gray-400">Total: {fmt(totalRevenue)}</p>
            </Section>
          )}

          <Section title={restaurantMode ? 'Revenue' : 'Cash Collected'}>
            <p className="text-xs text-gray-500 mb-2">{restaurantMode ? 'Actual payments received from sales.' : 'Actual payments received · not total booking value. Fees kept from refunds are shown separately.'}</p>
            <StatRow label="Today" value={fmt(data.todayRev)} color="text-emerald-400" />
            <StatRow label="This Week" value={fmt(data.weekRev)} color="text-emerald-400" />
            <StatRow label="This Month" value={fmt(data.monthRev)} color="text-emerald-400" />
            {!restaurantMode && <StatRow label="Refunds (this month)" value={fmt(data.monthRefunds)} color="text-rose-300" />}
            {!restaurantMode && (
            <StatRow
              label="Fees kept from refunds (this month)"
              value={fmt(retainedThisMonth)}
              sub={Number(data.monthRetainedCount || 0) > 0 ? `${Number(data.monthRetainedCount || 0)} cancelled booking${Number(data.monthRetainedCount || 0) === 1 ? '' : 's'}` : 'No fees kept'}
              color="text-amber-300"
            />
            )}
            {!restaurantMode && <StatRow label="Last Month" value={fmt(data.lastMonthRev)} color="text-gray-300" />}
            {!restaurantMode && <StatRow label="Refunds (last month)" value={fmt(data.lastMonthRefunds)} color="text-gray-400" />}
            {!restaurantMode && (
            <StatRow
              label="Fees kept from refunds (last month)"
              value={fmt(retainedLastMonth)}
              sub={Number(data.lastMonthRetainedCount || 0) > 0 ? `${Number(data.lastMonthRetainedCount || 0)} cancelled booking${Number(data.lastMonthRetainedCount || 0) === 1 ? '' : 's'}` : 'No fees kept'}
              color="text-amber-300"
            />
            )}
            {isEnabled('pos') && <StatRow label="POS Revenue (this month)" value={fmt(data.posRevenue)} color="text-blue-400" />}
            {!restaurantMode && isEnabled('conference') && data.conferenceRevenue > 0 && <StatRow label="Conference (this month)" value={fmt(data.conferenceRevenue)} color="text-indigo-400" />}
            {!restaurantMode && isEnabled('pool') && data.poolRevenue > 0 && <StatRow label="Day Use (this month)" value={fmt(data.poolRevenue)} color="text-cyan-400" />}
          </Section>

          {!restaurantMode && (
          <Section title="Occupancy Rate">
            <StatRow label="This Month" value={pct(data.monthOcc)} color={data.monthOcc >= 70 ? 'text-green-400' : data.monthOcc >= 40 ? 'text-yellow-400' : 'text-red-400'} />
            <StatRow label="Last Month" value={pct(data.lastMonthOcc)} color="text-gray-300" />
          </Section>
          )}

          {isEnabled('expenses') && (
            <Section title="Expenses (this month)">
              <StatRow label="Manual Expenses" value={fmt(data.monthExpenses)} color="text-red-400" />
              {!restaurantMode && <StatRow label="Maintenance Repairs" value={fmt(maintenanceTotal)} color="text-rose-300" sub="Read-only repair costs" />}
              <StatRow label="Total Expenses" value={fmt(expenseTotal)} color="text-red-400" />
              <StatRow
                label="Net Cash (All Revenue − Expenses)"
                value={fmt(totalRevenue - expenseTotal)}
                color={totalRevenue >= expenseTotal ? 'text-green-400' : 'text-red-400'}
              />
            </Section>
          )}

          {!restaurantMode && (
          <Section title="Outstanding Payments">
            <StatRow label="Unpaid / Partial Bookings" value={data.unpaidCount} color={data.unpaidCount > 0 ? 'text-yellow-400' : 'text-gray-500'} sub="Includes fully unpaid and partially paid" />
            <StatRow label="Amount Outstanding" value={fmt(data.unpaidTotal)} color={data.unpaidTotal > 0 ? 'text-red-400' : 'text-gray-500'} />
          </Section>
          )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
