import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, CircleAlert, RefreshCw, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  getDashboardSnapshot,
  getFinancialActivityFeed,
  getManagerPosSnapshot,
  getManagerPosTransactions,
  getReportsSnapshot,
  listBookings,
  listConferenceBookings,
  listDayUseEntries,
  listExpenses,
  listInventory,
  listMaintenanceTickets,
  listQuotations,
  listStaff
} from '../lib/api'
import { businessDate, money, shortDateTime } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import { isBarHospitalityMode, isRestaurantProductFamily } from '../lib/productShell'
import { buildPerformanceMetrics, formatPerformanceValue, mergePerformanceActivity } from '../lib/performance'

const TONE = {
  green: 'text-emerald-300',
  blue: 'text-sky-300',
  cyan: 'text-cyan-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300'
}

function sourceLabel(source) {
  return String(source || 'activity')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function PerformanceCard({ metric }) {
  const TrendIcon = metric.trend === null || metric.trend === undefined ? null : metric.trend >= 0 ? TrendingUp : TrendingDown
  const trendTone = metric.trend === null || metric.trend === undefined ? 'text-gray-500' : metric.trend >= 0 ? 'text-emerald-400' : 'text-rose-400'
  return (
    <div className="rounded-2xl bg-gray-800 p-3">
      <p className="text-[11px] text-gray-400">{metric.label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={'text-xl font-bold ' + (TONE[metric.tone] || 'text-white')}>
          {formatPerformanceValue(metric.value, metric.format)}
        </p>
        {TrendIcon && (
          <span className={'flex items-center gap-0.5 text-[10px] font-semibold ' + trendTone}>
            <TrendIcon size={12} />
            {metric.trend === null ? 'New' : Math.abs(metric.trend) + '%'}
          </span>
        )}
      </div>
    </div>
  )
}

function ActivityRow({ item }) {
  const hasAmount = item.amount !== null && item.amount !== undefined
  const amount = Number(item.amount || 0)
  return (
    <div className="flex items-start gap-3 border-b border-gray-800 py-3 last:border-0">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-emerald-300">
        <Activity size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-white">{item.title}</p>
          <span className="shrink-0 text-[10px] text-gray-500">{shortDateTime(item.created_at)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-400">{item.sub || 'Recorded activity'}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-gray-500">{sourceLabel(item.source)}</span>
          {hasAmount && <span className={'text-[11px] font-semibold ' + (amount < 0 ? 'text-rose-300' : 'text-emerald-300')}>{money(amount)}</span>}
        </div>
      </div>
    </div>
  )
}

function FailureNotice({ failures }) {
  if (failures.length === 0) return null
  return (
    <div className="rounded-2xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
      <p className="font-semibold">Some detail sources are unavailable</p>
      <p className="mt-1 text-amber-300/80">Available values remain visible. Reconnect or refresh to retry: {failures.join(', ')}.</p>
    </div>
  )
}

export default function Performance() {
  const { user } = useAuth()
  const restaurantMode = isRestaurantProductFamily(user?.product_family)
  const barOnly = restaurantMode && isBarHospitalityMode(user?.hospitality_mode)
  const today = businessDate()
  const monthStart = today.slice(0, 7) + '-01'
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [failures, setFailures] = useState([])
  const [reloadVersion, setReloadVersion] = useState(0)

  const load = useCallback(() => setReloadVersion((version) => version + 1), [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setLoadError('')
      const taskFactories = [
        ['reports', () => getReportsSnapshot(user.lodge_id, { today, forceFresh: true })],
        ['dashboard', () => getDashboardSnapshot(user.lodge_id)],
        ['activity', () => getFinancialActivityFeed(user.lodge_id, 40)],
        ['bookings', () => restaurantMode ? Promise.resolve([]) : listBookings(user.lodge_id, { forceFresh: true })],
        ['expenses', () => listExpenses(user.lodge_id, monthStart, today)],
        ['inventory', () => listInventory(user.lodge_id)],
        ['maintenance', () => listMaintenanceTickets(user.lodge_id, { forceFresh: true })],
        ['quotations', () => listQuotations(user.lodge_id)],
        ['conference', () => restaurantMode ? Promise.resolve([]) : listConferenceBookings(user.lodge_id, monthStart, today)],
        ['dayUse', () => restaurantMode ? Promise.resolve([]) : listDayUseEntries(user.lodge_id, monthStart, today)],
        ['staff', () => listStaff(user.lodge_id)],
        ['pos', () => restaurantMode ? getManagerPosSnapshot(user.lodge_id, { startDate: monthStart, endDate: today, forceFresh: true }) : Promise.resolve(null)],
        ['posTransactions', () => restaurantMode ? getManagerPosTransactions(user.lodge_id, { startDate: monthStart, endDate: today, limit: 40 }) : Promise.resolve(null)]
      ]
      const results = await Promise.all(taskFactories.map(async ([key, factory]) => {
        try {
          return { key, value: await factory() }
        } catch (error) {
          return { key, error: error?.message || 'unavailable' }
        }
      }))
      if (cancelled) return
      const values = {}
      const nextFailures = []
      results.forEach((result) => {
        values[result.key] = result.value
        if (result.error) nextFailures.push(result.key)
      })
      const criticalFailure = !values.reports && !values.dashboard
      setSnapshot(values)
      setFailures(nextFailures)
      setLastUpdated(values.pos?.as_of || new Date().toISOString())
      if (criticalFailure) setLoadError('Performance data could not be loaded. Check the connection and try again.')
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [monthStart, restaurantMode, reloadVersion, today, user.lodge_id])

  const metrics = useMemo(() => buildPerformanceMetrics({
    restaurantMode,
    reports: { ...(snapshot?.reports || {}), today },
    dashboard: snapshot?.dashboard || {},
    pos: snapshot?.pos || {},
    bookings: snapshot?.bookings || [],
    inventory: snapshot?.inventory || [],
    maintenance: snapshot?.maintenance || [],
    staff: snapshot?.staff || []
  }), [restaurantMode, snapshot, today])

  const activity = useMemo(() => mergePerformanceActivity({
    activity: snapshot?.activity || [],
    bookings: snapshot?.bookings || [],
    expenses: snapshot?.expenses || [],
    inventory: snapshot?.inventory || [],
    maintenance: snapshot?.maintenance || [],
    quotations: snapshot?.quotations || [],
    conference: snapshot?.conference || [],
    dayUse: snapshot?.dayUse || [],
    posTransactions: snapshot?.posTransactions?.transactions || []
  }, 30), [snapshot])

  const productLabel = restaurantMode ? (barOnly ? 'Bar' : 'Restaurant') : user?.product_family === 'hotel' ? 'Hotel' : 'Lodging'
  const posComplete = snapshot?.pos?.complete !== false && snapshot?.pos?.complete !== undefined
  const reportComplete = snapshot?.reports?.financial_truth === 'server_confirmed' || snapshot?.reports?.source === 'server'

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pb-4 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">{productLabel} manager workspace</p>
            <h1 className="mt-1 text-lg font-bold text-white">Activity & performance</h1>
            <DataFreshness updatedAt={lastUpdated} loading={loading} error={loadError} className="mt-1" />
          </div>
          <button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh performance">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">
        {loadError && <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{loadError}</div>}
        <FailureNotice failures={failures} />
        <section className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 px-4 py-3">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-300" />
            <div>
              <p className="text-sm font-semibold text-emerald-100">Server-backed operating view</p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-200/70">Financial totals come from the lodge or POS report contracts. Operational rows show recent activity and are never treated as a substitute for a ledger.</p>
            </div>
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Current performance</p>
              <p className="text-xs text-gray-500">{monthStart} to {today}</p>
            </div>
            <BarChart3 size={17} className="text-gray-500" />
          </div>
          {loading && !snapshot ? (
            <div className="grid grid-cols-2 gap-2">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-gray-800" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">{metrics.map((metric) => <PerformanceCard key={metric.key} metric={metric} />)}</div>
          )}
        </section>
        {restaurantMode && snapshot?.pos && !posComplete && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            POS detail is incomplete, so monetary sales and return totals remain marked for reconciliation.
          </div>
        )}
        {!restaurantMode && snapshot?.reports && !reportComplete && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            Some lodging report values are cached or estimated. Confirm live reports before making financial decisions.
          </div>
        )}
        <section className="rounded-2xl bg-gray-800 p-4">
          <div className="mb-1 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Recent activity</p>
              <p className="text-xs text-gray-500">Bookings, money, stock, work orders, quotes, and {restaurantMode ? 'POS transactions' : 'operational events'}</p>
            </div>
            <Activity size={17} className="text-gray-500" />
          </div>
          {activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No activity is available for this period.</p>
          ) : (
            <div>{activity.map((item) => <ActivityRow key={item.id} item={item} />)}</div>
          )}
        </section>
        <p className="text-[11px] leading-relaxed text-gray-500">Read-only manager/admin visibility. Changes, payments, refunds, stock adjustments, and POS settlement continue to use their existing guarded workflows.</p>
      </div>
    </div>
  )
}

