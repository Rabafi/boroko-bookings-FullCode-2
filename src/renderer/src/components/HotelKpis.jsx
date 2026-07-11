import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, CalendarDays, DoorOpen, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { useSettings } from '../app-context'

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Metric({ icon: Icon, label, value, note }) {
  return (
    <div className="bb-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-[#174c3a]">
          <Icon size={20} />
        </div>
      </div>
      {note && <p className="mt-3 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default function HotelKpis({ embedded = false }) {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.hotel.getKpis(days)
      setData(result)
    } catch (err) {
      console.error('Failed to load hotel KPIs:', err)
      setError(err?.message || 'Failed to load hotel KPIs')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  return (
    <div className={embedded ? '' : 'bb-page'}>
      {!embedded && (
        <div className="bb-page-header">
          <div>
            <p className="bb-section-kicker">HOTEL REPORTING</p>
            <h1 className="bb-page-header-title">Hotel KPIs</h1>
            <p className="bb-page-header-subtitle">Occupancy, ADR, RevPAR, arrivals, departures, and no-shows.</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="input w-36" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>Next 7 days</option>
              <option value={14}>Next 14 days</option>
              <option value={30}>Next 30 days</option>
            </select>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : error ? (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="mb-3 text-red-400" />
          <p className="text-sm font-semibold text-red-600">{error}</p>
          <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={DoorOpen} label="Occupancy" value={`${data?.occupancyPercent || 0}%`} note={`${data?.occupiedRoomNights || 0} of ${data?.roomNightsAvailable || 0} room nights`} />
            <Metric icon={TrendingUp} label="ADR (est.)" value={formatCurrency(data?.adr, currency)} note="Based on current booking totals, not final accounting." />
            <Metric icon={BarChart3} label="RevPAR (est.)" value={formatCurrency(data?.revPar, currency)} note="Estimated room revenue divided by available room nights." />
            <Metric icon={Users} label="No-Shows" value={data?.noShows || 0} note={`${data?.arrivals || 0} arrivals and ${data?.departures || 0} departures in range`} />
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            KPI revenue values are estimates from current booking cache. Final revenue, payments, refunds, and liabilities remain database-authoritative through financial reports.
          </div>

          <div className="bb-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <CalendarDays size={18} className="text-[#174c3a]" />
                <h2 className="text-base font-bold text-slate-800">Daily Pickup</h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-right">Occ.</th>
                    <th className="px-4 py-3 text-right">Occupied</th>
                    <th className="px-4 py-3 text-right">Available</th>
                    <th className="px-4 py-3 text-right">Arrivals</th>
                    <th className="px-4 py-3 text-right">Departures</th>
                    <th className="px-4 py-3 text-right">No-Shows</th>
                    <th className="px-4 py-3 text-right">Revenue Est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.daily || []).map((day) => (
                    <tr key={day.date}>
                      <td className="px-4 py-3 font-medium text-slate-700">{day.date}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.occupancyPercent}%</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.occupiedRooms}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.availableRooms}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.arrivals}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.departures}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{day.noShows}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(day.estimatedRoomRevenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
