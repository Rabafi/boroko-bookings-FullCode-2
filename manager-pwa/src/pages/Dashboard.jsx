import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Users, DoorOpen, DoorClosed, TrendingUp, AlertTriangle, RefreshCw, LogOut } from 'lucide-react'
import { format } from 'date-fns'

function KPICard({ label, value, sub, icon: Icon, color = 'text-white', bg = 'bg-gray-800' }) {
  return (
    <div className={`${bg} rounded-2xl p-4 flex items-center gap-4`}>
      <div className="flex-shrink-0">
        <Icon size={24} className={color} />
      </div>
      <div className="min-w-0">
        <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
        <p className="text-xs text-gray-400 truncate">{label}</p>
        {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function OccupancyBar({ occupied, total }) {
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold text-white">Live Occupancy</p>
        <span className={`text-sm font-bold ${pct >= 90 ? 'text-red-400' : pct >= 60 ? 'text-yellow-400' : 'text-green-400'}`}>{pct}%</span>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-2">{occupied} of {total} rooms occupied</p>
    </div>
  )
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    const lid = user.lodge_id
    const [rooms, bookings, expenses, maintenance] = await Promise.all([
      supabase.from('rooms').select('id, housekeeping_status').eq('lodge_id', lid),
      supabase.from('bookings').select('id, status, check_in, check_out, total_amount, amount_paid, payment_status').eq('lodge_id', lid),
      supabase.from('expenses').select('amount').eq('lodge_id', lid).gte('date', today.slice(0, 7) + '-01'),
      supabase.from('maintenance_tickets').select('id, status').eq('lodge_id', lid).eq('status', 'open')
    ])

    const allRooms = rooms.data || []
    const allBookings = bookings.data || []

    const occupied = allBookings.filter(b => b.status === 'checked_in').length
    const checkInsToday = allBookings.filter(b => b.check_in === today && b.status === 'confirmed').length
    const checkOutsToday = allBookings.filter(b => b.check_out === today && b.status === 'checked_in').length
    const overdueCheckouts = allBookings.filter(b => b.check_out < today && b.status === 'checked_in').length
    const unpaidCount = allBookings.filter(b => ['pending', 'partial'].includes(b.payment_status) && b.status !== 'cancelled').length
    const revenueToday = allBookings
      .filter(b => b.check_in === today || b.check_out === today)
      .reduce((s, b) => s + (Number(b.amount_paid) || 0), 0)
    const monthExpenses = (expenses.data || []).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const openMaintenance = (maintenance.data || []).length

    // Today's arrivals
    const todayArrivals = allBookings.filter(b => b.check_in === today && b.status === 'confirmed')

    setData({ total: allRooms.length, occupied, checkInsToday, checkOutsToday, overdueCheckouts, unpaidCount, revenueToday, monthExpenses, openMaintenance, todayArrivals })
    setLoading(false)
  }, [user.lodge_id, today])

  useEffect(() => { load() }, [load])

  const fmt = (n) => `P ${Number(n || 0).toLocaleString()}`

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}</p>
          <h1 className="text-lg font-bold text-white">{user.name}</h1>
          <p className="text-xs text-green-400 capitalize">{user.role} · {format(new Date(), 'EEE, d MMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-400 hover:text-white">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={logout} className="p-2 text-gray-500 hover:text-red-400">
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : data ? (
          <>
            {/* Alerts strip */}
            {(data.overdueCheckouts > 0 || data.openMaintenance > 0 || data.unpaidCount > 0) && (
              <div className="bg-red-900/30 border border-red-700/40 rounded-2xl px-4 py-3 flex flex-wrap gap-3">
                {data.overdueCheckouts > 0 && <span className="text-xs text-red-300 flex items-center gap-1"><AlertTriangle size={13} /> {data.overdueCheckouts} overdue checkout{data.overdueCheckouts > 1 ? 's' : ''}</span>}
                {data.openMaintenance > 0 && <span className="text-xs text-orange-300 flex items-center gap-1"><AlertTriangle size={13} /> {data.openMaintenance} maintenance open</span>}
                {data.unpaidCount > 0 && <span className="text-xs text-yellow-300 flex items-center gap-1"><AlertTriangle size={13} /> {data.unpaidCount} unpaid booking{data.unpaidCount > 1 ? 's' : ''}</span>}
              </div>
            )}

            {/* Occupancy */}
            <OccupancyBar occupied={data.occupied} total={data.total} />

            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-3">
              <KPICard label="Check-ins Today" value={data.checkInsToday} icon={DoorOpen} color="text-green-400" />
              <KPICard label="Check-outs Today" value={data.checkOutsToday} icon={DoorClosed} color="text-blue-400" />
              <KPICard label="Revenue Today" value={fmt(data.revenueToday)} icon={TrendingUp} color="text-emerald-400" />
              <KPICard label="Month Expenses" value={fmt(data.monthExpenses)} icon={TrendingUp} color="text-red-400" />
            </div>

            {/* Today's arrivals */}
            {data.todayArrivals.length > 0 && (
              <div className="bg-gray-800 rounded-2xl p-4">
                <p className="text-sm font-semibold text-white mb-3">Today's Arrivals ({data.todayArrivals.length})</p>
                <div className="space-y-2">
                  {data.todayArrivals.slice(0, 5).map(b => (
                    <div key={b.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-gray-200">{b.guest_name || 'Guest'}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        b.payment_status === 'paid' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
                      }`}>{b.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-500 text-sm text-center pt-12">Could not load data. Check your connection.</p>
        )}
      </div>
    </div>
  )
}
