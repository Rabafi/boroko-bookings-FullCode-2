import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { StatusBadge } from './shared/StatusBadge'

const TABS = [
  ['linen', 'Linen & Laundry'],
  ['lost_found', 'Lost & Found'],
  ['incidents', 'Incidents'],
  ['visitors', 'Visitors'],
  ['emergency', 'Emergency'],
  ['handover', 'Shift Handover']
]

export default function OperationsCompliance() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('linen')
  const [linenDashboard, setLinenDashboard] = useState(null)
  const [lostFoundDashboard, setLostFoundDashboard] = useState(null)
  const [incidentDashboard, setIncidentDashboard] = useState(null)
  const [visitorDashboard, setVisitorDashboard] = useState(null)
  const [evacuationList, setEvacuationList] = useState([])
  const [shiftHandovers, setShiftHandovers] = useState([])

  const [warnings, setWarnings] = useState([])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setWarnings([])
    try {
      const labels = ['Linen', 'Lost & Found', 'Incidents', 'Visitors', 'Emergency list', 'Shift handover']
      const results = await Promise.allSettled([
        window.api.operationsCompliance.getLinenDashboard(),
        window.api.operationsCompliance.getLostFoundDashboard(),
        window.api.operationsCompliance.getIncidentDashboard(),
        window.api.operationsCompliance.getVisitorDashboard(),
        window.api.operationsCompliance.getEvacuationList(),
        window.api.operationsCompliance.getShiftHandoverHistory()
      ])
      const partial = []
      const apply = (idx, setter, isList = false) => {
        const r = results[idx]
        if (r.status === 'fulfilled') {
          const value = r.value
          if (value?.warning || value?.stale) partial.push(`${labels[idx]}: ${value.warning || 'cached'}`)
          if (isList) {
            if (Array.isArray(value)) setter(value)
            else if (value?.cached) {
              setter(value.cached)
              partial.push(`${labels[idx]}: showing cached data`)
            } else setter([])
          } else {
            setter(value)
          }
        } else {
          const reason = r.reason
          if (reason?.cached) {
            setter(isList ? reason.cached : reason.cached)
            partial.push(`${labels[idx]}: ${reason.message || 'cached'}`)
          } else {
            if (isList) setter([])
            else setter(null)
            partial.push(`${labels[idx]}: ${reason?.message || 'failed to load'}`)
          }
        }
      }
      apply(0, setLinenDashboard)
      apply(1, setLostFoundDashboard)
      apply(2, setIncidentDashboard)
      apply(3, setVisitorDashboard)
      apply(4, setEvacuationList, true)
      apply(5, setShiftHandovers, true)
      if (partial.length) setWarnings(partial)
      if (partial.length === labels.length) {
        setError('All operations compliance sections failed to load')
      }
    } catch (err) {
      setError(err?.message || 'Failed to load operations data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const linenCards = useMemo(() => {
    if (!linenDashboard) return []
    return [
      { label: 'Total Items', value: linenDashboard.total_items || 0, color: 'text-slate-800' },
      { label: 'In Laundry', value: linenDashboard.in_laundry || 0, color: 'text-blue-600' },
      { label: 'Damaged', value: linenDashboard.damaged || 0, color: 'text-red-600' },
      { label: 'Missing', value: linenDashboard.missing || 0, color: 'text-amber-600' }
    ]
  }, [linenDashboard])

  if (loading) {
    return (
      <div className="bb-page">
        <div className="bb-page-header">
          <p className="bb-section-kicker">OPERATIONS</p>
          <h1 className="bb-page-header-title">Operations Compliance</h1>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="bb-section-kicker">OPERATIONS</p>
            <h1 className="bb-page-header-title">Operations Compliance</h1>
          </div>
          <button onClick={loadData} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bb-card p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-xs text-red-600 font-medium">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-slate-500 mt-1 hover:underline">Dismiss</button>
        </div>
      )}
      {warnings.length > 0 && !error && (
        <div className="bb-card p-4 mb-4 border-amber-200 bg-amber-50">
          <p className="text-xs text-amber-800 font-medium mb-1">Partial load warnings</p>
          <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`whitespace-nowrap px-4 py-2 text-xs font-semibold transition-colors ${activeTab === key ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'linen' && (
        <div>
          {linenCards.length > 0 && (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
              {linenCards.map((card) => (
                <div key={card.label} className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </section>
          )}
          <section className="bb-card p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-3">Linen & Laundry Dashboard</h2>
            <p className="text-xs text-slate-500">Use the stocktake RPC to perform inventory updates. Damaged linen can be reported and charged to guest bookings.</p>
          </section>
        </div>
      )}

      {activeTab === 'lost_found' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Lost & Found Dashboard</h2>
          {lostFoundDashboard ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
              {[
                { label: 'Open Items', value: lostFoundDashboard.open_items || 0, color: 'text-amber-600' },
                { label: 'Closed Items', value: lostFoundDashboard.closed_items || 0, color: 'text-emerald-600' },
                { label: 'Aging >30 Days', value: lostFoundDashboard.aging_over_30_days || 0, color: 'text-red-600' },
                { label: 'Total', value: lostFoundDashboard.total_items || 0, color: 'text-slate-800' }
              ].map((card) => (
                <div key={card.label} className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Dashboard data not available</p>
          )}
          <p className="text-xs text-slate-500">Use the claim RPC to mark items as claimed, returned, or disposed.</p>
        </section>
      )}

      {activeTab === 'incidents' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Incident Dashboard</h2>
          {incidentDashboard ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
              {[
                { label: 'Open', value: incidentDashboard.open_incidents || 0, color: 'text-red-600' },
                { label: 'Critical', value: incidentDashboard.critical_open || 0, color: 'text-red-800' },
                { label: 'High', value: incidentDashboard.high_open || 0, color: 'text-orange-600' },
                { label: 'Medium', value: incidentDashboard.medium_open || 0, color: 'text-amber-600' },
                { label: 'Low', value: incidentDashboard.low_open || 0, color: 'text-blue-600' },
                { label: 'Resolved', value: incidentDashboard.resolved_count || 0, color: 'text-emerald-600' }
              ].map((card) => (
                <div key={card.label} className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Dashboard data not available</p>
          )}
        </section>
      )}

      {activeTab === 'visitors' && (
        <section className="bb-card p-5">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Visitor Register</h2>
          {visitorDashboard ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
              {[
                { label: 'Active', value: visitorDashboard.active_visitors || 0, color: 'text-blue-600' },
                { label: 'Today', value: visitorDashboard.today_visitors || 0, color: 'text-emerald-600' },
                { label: 'Checked Out', value: visitorDashboard.checked_out || 0, color: 'text-slate-500' },
                { label: 'Total', value: visitorDashboard.total_visitors || 0, color: 'text-slate-800' }
              ].map((card) => (
                <div key={card.label} className="bb-card p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Dashboard data not available</p>
          )}
        </section>
      )}

      {activeTab === 'emergency' && (
        <section className="bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <AlertTriangle size={18} className="text-red-600" />
            <h2 className="text-sm font-bold text-slate-800">Emergency / Evacuation List</h2>
            <span className="ml-auto rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{evacuationList.length}</span>
          </div>
          {evacuationList.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-xs text-slate-400">No persons currently on property</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-5 py-2.5">Type</th>
                    <th className="px-5 py-2.5">Room</th>
                    <th className="px-5 py-2.5">Phone</th>
                    <th className="px-5 py-2.5">Party Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {evacuationList.map((person, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-800">{person.name}</td>
                      <td className="px-5 py-3"><StatusBadge status={person.person_type} size="sm" /></td>
                      <td className="px-5 py-3 text-slate-600">{person.room_number || '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{person.phone || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{person.party_size || 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'handover' && (
        <section className="bb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <CheckCircle size={18} className="text-slate-600" />
            <h2 className="text-sm font-bold text-slate-800">Shift Handover Log</h2>
          </div>
          {shiftHandovers.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-xs text-slate-400">No shift handover records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-2.5">Date</th>
                    <th className="px-5 py-2.5">Shift</th>
                    <th className="px-5 py-2.5">Outgoing</th>
                    <th className="px-5 py-2.5">Incoming</th>
                    <th className="px-5 py-2.5">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {shiftHandovers.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 text-slate-600">{h.shift_date}</td>
                      <td className="px-5 py-3"><StatusBadge status={h.shift_type} size="sm" /></td>
                      <td className="px-5 py-3 text-slate-600">{h.outgoing_name || '—'}</td>
                      <td className="px-5 py-3 text-slate-600">{h.incoming_name || '—'}</td>
                      <td className="px-5 py-3">{h.handover_completed ? <CheckCircle size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-slate-300" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
