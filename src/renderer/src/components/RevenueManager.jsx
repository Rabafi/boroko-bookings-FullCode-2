import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Calendar, Edit3, Plus, Star, ChevronDown, ChevronUp } from 'lucide-react'
import { useSettings } from '../app-context'

const todayStr = () => new Date().toISOString().slice(0, 10)
const weekLater = () => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) }

function ForecastRow({ entry, onEdit }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 text-gray-600 text-sm">{entry.date}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-24 bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(entry.forecast_occupancy_pct || 0, 100)}%` }} />
          </div>
          <span className="text-sm font-medium">{entry.forecast_occupancy_pct || 0}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {entry.forecast_adr ? `P${Number(entry.forecast_adr).toFixed(2)}` : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{entry.notes || '-'}</td>
      <td className="px-4 py-3">
        <button onClick={() => onEdit(entry)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
      </td>
    </tr>
  )
}

function ForecastForm({ initial, onSave, onCancel, loading }) {
  const [occupancy, setOccupancy] = useState(initial?.forecast_occupancy_pct || '')
  const [adr, setAdr] = useState(initial?.forecast_adr || '')
  const [notes, setNotes] = useState(initial?.notes || '')

  const handleSave = () => {
    onSave(initial?.date || todayStr(), Number(occupancy), Number(adr), notes)
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
      <h3 className="font-semibold text-gray-700 mb-3">Edit Forecast for {initial?.date || todayStr()}</h3>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Occupancy %</label>
            <input type="number" value={occupancy} onChange={e => setOccupancy(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">ADR</label>
            <input type="number" value={adr} onChange={e => setAdr(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" rows={2} />
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">Save</button>
          <button onClick={onCancel} className="text-gray-500 px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function CompetitorNoteForm({ onSave, onCancel, loading }) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')

  const handleSave = () => {
    if (!name.trim()) return
    onSave(name.trim(), null, Number(rate) || 0, '')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200 flex items-center gap-3">
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Competitor name" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      <input type="number" value={rate} onChange={e => setRate(e.target.value)} placeholder="Rate" className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      <button onClick={handleSave} disabled={loading} className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">Add</button>
      <button onClick={onCancel} className="text-gray-500 text-sm">Cancel</button>
    </div>
  )
}

function RecommendationCard({ rec }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 border-l-4 border-l-amber-400">
      <h4 className="font-medium text-gray-800 text-sm">{rec.action}</h4>
      <p className="text-xs text-gray-500 mt-1">{rec.reason}</p>
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
        <span>Current: {rec.current_value}%</span>
        <span>Threshold: {rec.trigger_threshold}%</span>
      </div>
    </div>
  )
}

export default function RevenueManager() {
  const { settings } = useSettings()
  const [tab, setTab] = useState('forecast')
  const [forecast, setForecast] = useState([])
  const [competitorNotes, setCompetitorNotes] = useState([])
  const [demandEvents, setDemandEvents] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editEntry, setEditEntry] = useState(null)
  const [showCompetitorForm, setShowCompetitorForm] = useState(false)
  const [showDemandForm, setShowDemandForm] = useState(false)

  const loadForecast = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.revenueManager.getForecast(todayStr(), weekLater())
      setForecast(result?.entries || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadCompetitorNotes = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.revenueManager.getCompetitorNotes()
      setCompetitorNotes(result?.notes || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadDemandEvents = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.revenueManager.getDemandEvents(todayStr(), weekLater())
      setDemandEvents(result?.events || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadRecommendations = async () => {
    setLoading(true); setError('')
    try {
      const result = await window.api.revenueManager.getRecommendations()
      setRecommendations(result?.recommendations || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    loadForecast()
    loadCompetitorNotes()
    loadDemandEvents()
    loadRecommendations()
  }, [])

  const handleUpsertForecast = async (date, occupancyPct, adr, notes) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      await window.api.revenueManager.upsertForecast(date, occupancyPct, adr, notes)
      setSuccess('Forecast saved'); setEditEntry(null)
      loadForecast()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleCreateCompetitorNote = async (name, roomTypeId, rate, notes) => {
    setLoading(true); setError(''); setSuccess('')
    try {
      await window.api.revenueManager.createCompetitorNote(name, roomTypeId, rate, notes)
      setSuccess('Note added'); setShowCompetitorForm(false)
      loadCompetitorNotes()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleCreateDemandEvent = async () => {
    setLoading(true); setError(''); setSuccess('')
    try {
      const name = prompt('Event name:')
      if (!name) { setLoading(false); return }
      const date = prompt('Event date (YYYY-MM-DD):')
      if (!date) { setLoading(false); return }
      const impact = prompt('Expected impact (high/medium/low):')
      await window.api.revenueManager.createDemandEvent(name, date, impact || null, '')
      setSuccess('Event created'); setShowDemandForm(false)
      loadDemandEvents()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Revenue Manager</h1>
        <p className="text-gray-500 text-sm mt-0.5">Forecast, competitor tracking, demand events, and recommendations</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>}
      {success && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">&#10003; {success}</div>}

      <div className="flex gap-2 mb-6">
        {[
          { key: 'forecast', label: 'Forecast', icon: BarChart3 },
          { key: 'competitors', label: 'Competitors', icon: TrendingUp },
          { key: 'events', label: 'Demand Events', icon: Calendar },
          { key: 'recommendations', label: 'Recommendations', icon: Star }
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${tab === t.key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'forecast' && (
        <div className="space-y-4">
          {editEntry && <ForecastForm initial={editEntry} onSave={handleUpsertForecast} onCancel={() => setEditEntry(null)} loading={loading} />}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Occupancy</th>
                  <th className="px-4 py-3 text-left">ADR</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {forecast.map(e => <ForecastRow key={e.id || e.date} entry={e} onEdit={setEditEntry} />)}
                {forecast.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No forecast entries. Click Edit on a date to add one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'competitors' && (
        <div className="space-y-3">
          <button onClick={() => setShowCompetitorForm(true)} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 font-medium">
            <Plus size={14} /> Add Note
          </button>
          {showCompetitorForm && <CompetitorNoteForm onSave={handleCreateCompetitorNote} onCancel={() => setShowCompetitorForm(false)} loading={loading} />}
          {competitorNotes.map(n => (
            <div key={n.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-800">{n.competitor_name}</p>
                  <p className="text-sm text-gray-500">Rate: P{Number(n.noted_rate || 0).toFixed(2)}</p>
                </div>
                <p className="text-xs text-gray-400">{new Date(n.noted_at).toLocaleDateString()}</p>
              </div>
              {n.notes && <p className="text-xs text-gray-500 mt-2">{n.notes}</p>}
            </div>
          ))}
          {competitorNotes.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">No competitor notes.</p>}
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-3">
          <button onClick={handleCreateDemandEvent} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 font-medium">
            <Plus size={14} /> Add Event
          </button>
          {demandEvents.map(e => (
            <div key={e.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-800">{e.event_name}</p>
                  <p className="text-sm text-gray-500">{e.event_date}</p>
                </div>
                {e.expected_impact && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    e.expected_impact === 'high' ? 'bg-red-100 text-red-700' :
                    e.expected_impact === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-700'
                  }`}>{e.expected_impact}</span>
                )}
              </div>
              {e.notes && <p className="text-xs text-gray-500 mt-2">{e.notes}</p>}
            </div>
          ))}
          {demandEvents.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">No demand events.</p>}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-3">
          {recommendations.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">No recommendations available.</p>}
          {recommendations.map((r, i) => <RecommendationCard key={i} rec={r} />)}
        </div>
      )}
    </div>
  )
}
