import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { getReportsSnapshot } from '../lib/api'
import { RefreshCw, Lock, TrendingUp, TrendingDown, Percent, DollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { readCacheEntry } from '../lib/runtime'
import { shortDateTime } from '../lib/format'

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

export default function Reports() {
  const { user } = useAuth()
  const { isEnabled } = useFeatures()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [loadError, setLoadError] = useState('')
  const now = new Date()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const today = new Date()
      const snapshot = await getReportsSnapshot(user.lodge_id, {
        today: format(today, 'yyyy-MM-dd'),
        forceFresh: true
      })
      setData(snapshot)
      setLastUpdated(readCacheEntry(user.lodge_id, 'reports_snapshot', null)?.updatedAt || null)
    } catch (e) {
      console.error('Reports load error:', e)
      setLoadError(e?.message || 'Reports could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id])

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
          {!data ? (
            <div className="rounded-2xl bg-gray-800 px-4 py-6 text-sm text-gray-400">
              Reports data is not available yet on this device.
            </div>
          ) : (
            <>
          {/* Live */}
          <div className="bg-green-900/30 border border-green-700/40 rounded-2xl p-4 mb-3">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Live Now</p>
            <div className="flex items-center justify-between">
              <div><p className="text-3xl font-bold text-white">{data.currentOcc}<span className="text-lg text-gray-400">/{data.totalRooms}</span></p><p className="text-xs text-gray-400">Rooms occupied</p></div>
              <div className="text-right"><p className="text-2xl font-bold text-green-400">{data.totalRooms > 0 ? Math.round((data.currentOcc / data.totalRooms) * 100) : 0}%</p><p className="text-xs text-gray-400">Occupancy</p></div>
            </div>
          </div>

          <Section title="Cash Collected">
            <p className="text-xs text-gray-500 mb-2">Actual payments received · not total booking value</p>
            <StatRow label="Today" value={fmt(data.todayRev)} color="text-emerald-400" />
            <StatRow label="This Week" value={fmt(data.weekRev)} color="text-emerald-400" />
            <StatRow label="This Month" value={fmt(data.monthRev)} color="text-emerald-400" />
            <StatRow label="Refunds (this month)" value={fmt(data.monthRefunds)} color="text-rose-300" />
            <StatRow label="Last Month" value={fmt(data.lastMonthRev)} color="text-gray-300" />
            <StatRow label="Refunds (last month)" value={fmt(data.lastMonthRefunds)} color="text-gray-400" />
            {isEnabled('pos') && <StatRow label="POS Revenue (this month)" value={fmt(data.posRevenue)} color="text-blue-400" />}
            {isEnabled('conference') && data.conferenceRevenue > 0 && <StatRow label="Conference (this month)" value={fmt(data.conferenceRevenue)} color="text-indigo-400" />}
            {isEnabled('pool') && data.poolRevenue > 0 && <StatRow label="Pool / Day Use (this month)" value={fmt(data.poolRevenue)} color="text-cyan-400" />}
          </Section>

          <Section title="Occupancy Rate">
            <StatRow label="This Month" value={pct(data.monthOcc)} color={data.monthOcc >= 70 ? 'text-green-400' : data.monthOcc >= 40 ? 'text-yellow-400' : 'text-red-400'} />
            <StatRow label="Last Month" value={pct(data.lastMonthOcc)} color="text-gray-300" />
          </Section>

          {isEnabled('expenses') && (
            <Section title="Expenses (this month)">
              <StatRow label="Total Expenses" value={fmt(data.monthExpenses)} color="text-red-400" />
              <StatRow
                label="Net Cash (All Revenue − Expenses)"
                value={fmt(data.monthRev + data.posRevenue + data.conferenceRevenue + data.poolRevenue - data.monthExpenses)}
                color={(data.monthRev + data.posRevenue + data.conferenceRevenue + data.poolRevenue) >= data.monthExpenses ? 'text-green-400' : 'text-red-400'}
              />
            </Section>
          )}

          <Section title="Outstanding Payments">
            <StatRow label="Unpaid / Partial Bookings" value={data.unpaidCount} color={data.unpaidCount > 0 ? 'text-yellow-400' : 'text-gray-500'} sub="Includes fully unpaid and partially paid" />
            <StatRow label="Amount Outstanding" value={fmt(data.unpaidTotal)} color={data.unpaidTotal > 0 ? 'text-red-400' : 'text-gray-500'} />
          </Section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
