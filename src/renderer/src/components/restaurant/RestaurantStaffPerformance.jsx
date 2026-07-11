import { useState, useEffect } from 'react'
import { Users, TrendingUp, AlertTriangle, Clock, Award } from 'lucide-react'

export default function RestaurantStaffPerformance() {
  const [shifts, setShifts] = useState([])
  const [orders, setOrders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [s, o, a] = await Promise.allSettled([
        window.api.pos.getShiftHistory(startDate, endDate),
        window.api.pos.getOrders(startDate, endDate),
        window.api.pos.getActiveAlerts()
      ])
      setShifts(Array.isArray(s.value) ? s.value : [])
      setOrders(Array.isArray(o.value) ? o.value : [])
      setAlerts(Array.isArray(a.value) ? a.value : [])
    } catch (err) {
      console.error('Failed to load staff performance:', err)
    } finally {
      setLoading(false)
    }
  }

  // Aggregate staff metrics from orders
  const staffMetrics = {}
  orders.forEach(order => {
    const staff = order.staff_name || order.waiter || order.cashier || 'Unknown'
    if (!staffMetrics[staff]) {
      staffMetrics[staff] = { name: staff, orders: 0, sales: 0, voids: 0, discounts: 0 }
    }
    staffMetrics[staff].orders++
    staffMetrics[staff].sales += Number(order.total || order.amount || 0)
    if (order.is_voided) staffMetrics[staff].voids++
    if (order.discount_amount > 0) staffMetrics[staff].discounts++
  })

  // Shift metrics
  const shiftMetrics = {}
  shifts.forEach(shift => {
    const staff = shift.staff_name || shift.user_name || 'Unknown'
    if (!shiftMetrics[staff]) {
      shiftMetrics[staff] = { name: staff, shifts: 0, hours: 0 }
    }
    shiftMetrics[staff].shifts++
    if (shift.clock_in && shift.clock_out) {
      shiftMetrics[staff].hours += (new Date(shift.clock_out) - new Date(shift.clock_in)) / 3600000
    }
  })

  // Merge metrics
  const allStaff = new Set([...Object.keys(staffMetrics), ...Object.keys(shiftMetrics)])
  const staffList = Array.from(allStaff).map(name => ({
    name,
    orders: staffMetrics[name]?.orders || 0,
    sales: staffMetrics[name]?.sales || 0,
    voids: staffMetrics[name]?.voids || 0,
    discounts: staffMetrics[name]?.discounts || 0,
    shifts: shiftMetrics[name]?.shifts || 0,
    hours: shiftMetrics[name]?.hours || 0,
    avgOrder: staffMetrics[name]?.orders > 0 ? (staffMetrics[name].sales / staffMetrics[name].orders) : 0
  })).sort((a, b) => b.sales - a.sales)

  const topSeller = staffList[0]
  const highVoidStaff = staffList.filter(s => s.voids > 2)
  const totalSales = staffList.reduce((s, st) => s + st.sales, 0)
  const totalOrders = staffList.reduce((s, st) => s + st.orders, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Performance</h1>
          <p className="text-sm text-gray-500 mt-1">Sales, orders, voids, and staff accountability</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500">From</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bb-input ml-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">To</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bb-input ml-1" />
          </div>
          <button onClick={loadData} className="bb-btn-primary text-sm">Load</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Leaderboard */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bb-card p-4 text-center">
              <Award size={20} className="mx-auto mb-1 text-amber-500" />
              <div className="text-lg font-bold">{topSeller?.name || '-'}</div>
              <div className="text-xs text-gray-500">Top Seller (${topSeller?.sales?.toFixed(2) || '0'})</div>
            </div>
            <div className="bb-card p-4 text-center">
              <TrendingUp size={20} className="mx-auto mb-1 text-emerald-500" />
              <div className="text-xl font-bold">${totalSales.toFixed(2)}</div>
              <div className="text-xs text-gray-500">Total Sales ({staffList.length} staff)</div>
            </div>
            <div className="bb-card p-4 text-center">
              <Users size={20} className="mx-auto mb-1 text-blue-500" />
              <div className="text-xl font-bold">{totalOrders}</div>
              <div className="text-xs text-gray-500">Total Orders</div>
            </div>
            <div className="bb-card p-4 text-center">
              <AlertTriangle size={20} className="mx-auto mb-1 text-red-500" />
              <div className="text-xl font-bold">{highVoidStaff.length}</div>
              <div className="text-xs text-gray-500">High Void Staff</div>
            </div>
          </div>

          {/* Risk panel */}
          {highVoidStaff.length > 0 && (
            <div className="bb-card p-5 border-l-4 border-red-400">
              <h3 className="font-semibold text-sm text-red-700 mb-2">Staff Requiring Attention</h3>
              <div className="flex flex-wrap gap-2">
                {highVoidStaff.map(s => (
                  <span key={s.name} className="bg-red-50 text-red-700 text-xs px-2 py-1 rounded">
                    {s.name}: {s.voids} voids
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Staff table */}
          <div className="bb-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Staff</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Shifts</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Hours</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Orders</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Sales</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Avg Order</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Voids</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Discounts</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {staffList.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center text-gray-500">No staff data for this period</td>
                  </tr>
                ) : staffList.map((staff, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{staff.name}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{staff.shifts}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{staff.hours.toFixed(1)}h</td>
                    <td className="px-4 py-3 text-right text-gray-600">{staff.orders}</td>
                    <td className="px-4 py-3 text-right font-medium">${staff.sales.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">${staff.avgOrder.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right ${staff.voids > 2 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{staff.voids}</td>
                    <td className={`px-4 py-3 text-right ${staff.discounts > 3 ? 'text-amber-600 font-medium' : 'text-gray-600'}`}>{staff.discounts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
