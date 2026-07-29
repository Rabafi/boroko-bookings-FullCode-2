import { useState, useEffect } from 'react'
import { Clock, AlertTriangle, ChefHat } from 'lucide-react'

export default function RestaurantKitchenAnalytics() {
  const [report, setReport] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [stationFilter, setStationFilter] = useState('all')
  const [stations, setStations] = useState([])
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [stationFilter])

  async function loadData() {
    if (startDate > endDate) {
      setError('The start date must be on or before the end date.')
      return
    }
    try {
      setLoading(true)
      setError('')
      const [r, t, stationRows] = await Promise.allSettled([
        window.api.pos.getKitchenTimingReport(startDate, endDate, null, stationFilter === 'all' ? null : stationFilter),
        window.api.pos.getTickets(),
        window.api.pos.getStations?.() || Promise.resolve([])
      ])
      setReport(Array.isArray(r.value) ? r.value : [])
      setTickets(Array.isArray(t.value) ? t.value : [])
      setStations((Array.isArray(stationRows.value) ? stationRows.value : []).filter(station => station.enabled !== false))
      if ([r, t, stationRows].some(result => result.status === 'rejected')) setError('Some kitchen timing information could not be loaded.')
    } catch (err) {
      console.error('Failed to load kitchen analytics:', err)
      setError(err.message || 'Could not load kitchen analytics.')
    } finally {
      setLoading(false)
    }
  }

  const ticketsInRange = tickets.filter(ticket => {
    const date = String(ticket.created_at || '').slice(0, 10)
    return date && date >= startDate && date <= endDate && (stationFilter === 'all' || ticket.station === stationFilter)
  })
  const activeTickets = ticketsInRange.filter(t => t.status === 'pending' || t.status === 'preparing' || t.status === 'new')
  const slowTickets = ticketsInRange.filter(t => {
    if (!t.created_at) return false
    const mins = (Date.now() - new Date(t.created_at).getTime()) / 60000
    return mins > 15 && t.status !== 'served'
  })

  const totalTickets = report.reduce((s, r) => s + (Number(r.total_tickets) || 0), 0)
  const avgPrep = report.length > 0 ? report.reduce((s, r) => s + (Number(r.avg_prep_minutes) || 0), 0) / report.length : 0
  const busiestStation = [...report].sort((a, b) => (Number(b.total_tickets) || 0) - (Number(a.total_tickets) || 0))[0]

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kitchen Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Timing, bottlenecks, and station performance</p>
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

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="restaurant-native-kpis">
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{totalTickets}</div>
              <div className="text-xs text-gray-500">Total Tickets</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{activeTickets.length}</div>
              <div className="text-xs text-gray-500">Active Tickets</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{avgPrep.toFixed(1)}m</div>
              <div className="text-xs text-gray-500">Avg Prep Time</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{slowTickets.length}</div>
              <div className="text-xs text-gray-500">Slow Tickets (15m+)</div>
            </div>
          </div>

          {/* Slow tickets alert */}
          {slowTickets.length > 0 && (
            <div className="bb-card p-5 border-l-4 border-red-400">
              <h3 className="font-semibold text-sm text-red-700 mb-2 flex items-center gap-2">
                <AlertTriangle size={14} /> Slow Tickets Requiring Attention
              </h3>
              <div className="space-y-2">
                {slowTickets.slice(0, 5).map(t => {
                  const mins = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 60000)
                  return (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <span>{t.table_number || t.table_name || 'Takeaway'} - {t.items?.length || 0} items</span>
                      <span className="text-red-600 font-medium">{mins}m</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Station filter */}
          <div className="restaurant-native-segmented">
            {[{ id: 'all', name: 'All stations' }, ...stations].map(s => (
              <button key={s.id} onClick={() => setStationFilter(s.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${stationFilter === s.id ? 'bg-[#174c3a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s.name || s.id}
              </button>
            ))}
          </div>

          {/* Station breakdown */}
          <div className="bb-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Station</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Total Tickets</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Ready</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Served</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Avg Prep (min)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-4 py-12 text-center text-gray-500">No timing data for this period</td>
                  </tr>
                ) : report.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium capitalize">{row.station || 'Unknown'}</td>
                    <td className="px-4 py-3 text-right">{row.total_tickets}</td>
                    <td className="px-4 py-3 text-right">{row.ready_count}</td>
                    <td className="px-4 py-3 text-right">{row.served_count}</td>
                    <td className="px-4 py-3 text-right">{row.avg_prep_minutes?.toFixed(1) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {busiestStation && (
            <div className="bb-card p-4 bg-blue-50 border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700">
                <ChefHat size={16} />
                <span className="text-sm font-medium">
                  Busiest station: <strong>{busiestStation.station}</strong> with {busiestStation.total_tickets} tickets
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
