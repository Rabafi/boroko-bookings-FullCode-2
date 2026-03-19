import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { supabase } from '../lib/supabase'
import { RefreshCw, Lock, TrendingUp, TrendingDown, Percent, DollarSign } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns'

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
  const now = new Date()

  const load = useCallback(async () => {
    setLoading(true)
    const lid = user.lodge_id
    const todayStr = format(now, 'yyyy-MM-dd')
    const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
    const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
    const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')

    const [rooms, bookings, expenses, posOrders] = await Promise.all([
      supabase.from('rooms').select('id').eq('lodge_id', lid),
      supabase.from('bookings').select('check_in, check_out, total_amount, amount_paid, payment_status, status').eq('lodge_id', lid),
      isEnabled('expenses') ? supabase.from('expenses').select('amount, date').eq('lodge_id', lid).gte('date', monthStart).lte('date', monthEnd) : Promise.resolve({ data: [] }),
      isEnabled('pos') ? supabase.from('pos_orders').select('total, created_at').eq('lodge_id', lid).gte('created_at', monthStart).neq('status', 'voided') : Promise.resolve({ data: [] })
    ])

    const totalRooms = (rooms.data || []).length
    const allBookings = bookings.data || []

    const revForPeriod = (start, end) => allBookings
      .filter(b => b.check_in >= start && b.check_in <= end && b.status !== 'cancelled')
      .reduce((s, b) => s + Number(b.amount_paid || 0), 0)

    const occupancyForPeriod = (start, end) => {
      const occ = allBookings.filter(b => b.status === 'checked_in' && b.check_in <= end && b.check_out >= start).length
      const days = Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1
      return totalRooms > 0 && days > 0 ? Math.round((occ / (totalRooms * days)) * 100) : 0
    }

    const unpaidBookings = allBookings.filter(b => ['pending', 'partial'].includes(b.payment_status) && b.status !== 'cancelled')
    const unpaidTotal = unpaidBookings.reduce((s, b) => s + Math.max(0, Number(b.total_amount || 0) - Number(b.amount_paid || 0)), 0)
    const monthExpenses = (expenses.data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
    const posRevenue = (posOrders.data || []).reduce((s, o) => s + Number(o.total || 0), 0)

    setData({
      todayRev: revForPeriod(todayStr, todayStr),
      weekRev: revForPeriod(weekStart, todayStr),
      monthRev: revForPeriod(monthStart, monthEnd),
      lastMonthRev: revForPeriod(lastMonthStart, lastMonthEnd),
      monthOcc: occupancyForPeriod(monthStart, monthEnd),
      lastMonthOcc: occupancyForPeriod(lastMonthStart, lastMonthEnd),
      currentOcc: allBookings.filter(b => b.status === 'checked_in').length,
      totalRooms,
      unpaidTotal,
      unpaidCount: unpaidBookings.length,
      monthExpenses,
      posRevenue
    })
    setLoading(false)
  }, [user.lodge_id, isEnabled])

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
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {loading ? (
        <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : data && (
        <div className="px-4 py-4">
          {/* Live */}
          <div className="bg-green-900/30 border border-green-700/40 rounded-2xl p-4 mb-3">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Live Now</p>
            <div className="flex items-center justify-between">
              <div><p className="text-3xl font-bold text-white">{data.currentOcc}<span className="text-lg text-gray-400">/{data.totalRooms}</span></p><p className="text-xs text-gray-400">Rooms occupied</p></div>
              <div className="text-right"><p className="text-2xl font-bold text-green-400">{totalRooms > 0 ? Math.round((data.currentOcc / data.totalRooms) * 100) : 0}%</p><p className="text-xs text-gray-400">Occupancy</p></div>
            </div>
          </div>

          <Section title="Revenue">
            <StatRow label="Today" value={fmt(data.todayRev)} color="text-emerald-400" />
            <StatRow label="This Week" value={fmt(data.weekRev)} color="text-emerald-400" />
            <StatRow label="This Month" value={fmt(data.monthRev)} color="text-emerald-400" />
            <StatRow label="Last Month" value={fmt(data.lastMonthRev)} color="text-gray-300" />
            {isEnabled('pos') && <StatRow label="POS Revenue (this month)" value={fmt(data.posRevenue)} color="text-blue-400" />}
          </Section>

          <Section title="Occupancy Rate">
            <StatRow label="This Month" value={pct(data.monthOcc)} color={data.monthOcc >= 70 ? 'text-green-400' : data.monthOcc >= 40 ? 'text-yellow-400' : 'text-red-400'} />
            <StatRow label="Last Month" value={pct(data.lastMonthOcc)} color="text-gray-300" />
          </Section>

          {isEnabled('expenses') && (
            <Section title="Expenses (this month)">
              <StatRow label="Total Expenses" value={fmt(data.monthExpenses)} color="text-red-400" />
              <StatRow label="Net (Revenue - Expenses)" value={fmt(data.monthRev - data.monthExpenses)} color={data.monthRev >= data.monthExpenses ? 'text-green-400' : 'text-red-400'} />
            </Section>
          )}

          <Section title="Outstanding Payments">
            <StatRow label="Unpaid / Partial Bookings" value={data.unpaidCount} color={data.unpaidCount > 0 ? 'text-yellow-400' : 'text-gray-500'} />
            <StatRow label="Amount Outstanding" value={fmt(data.unpaidTotal)} color={data.unpaidTotal > 0 ? 'text-red-400' : 'text-gray-500'} />
          </Section>
        </div>
      )}
    </div>
  )
}
