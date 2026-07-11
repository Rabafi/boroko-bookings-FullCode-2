import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export default function RestaurantStations() {
  const [stations, setStations] = useState([])
  const [loading, setLoading] = useState(true)
  const [editStation, setEditStation] = useState(null)
  const [stationEditorOpen, setStationEditorOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('kitchen')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  const loadStations = async () => {
    setLoading(true)
    try {
      const data = await window.api.pos.getStations?.()
      setStations(Array.isArray(data) ? data : [])
    } catch { setStations([]) }
    setLoading(false)
  }

  useEffect(() => { loadStations() }, [])

  const openNew = () => {
    setEditStation(null)
    setFormName('')
    setFormType('kitchen')
    setSaveError('')
    setStationEditorOpen(true)
  }

  const openEdit = (station) => {
    setEditStation(station)
    setFormName(station.name || '')
    setFormType(station.type || 'kitchen')
    setSaveError('')
    setStationEditorOpen(true)
  }

  const saveStation = async () => {
    if (!formName.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await window.api.pos.saveStation?.({
        id: editStation?.id || null,
        name: formName.trim(),
        type: formType,
        enabled: editStation?.enabled !== false
      })
      if (res?.success) {
        setEditStation(null)
        setFormName('')
        setStationEditorOpen(false)
        setLastSavedAt(new Date())
        await loadStations()
      } else {
        setSaveError(res?.error || 'Save failed. Please try again.')
      }
    } catch (err) {
      setSaveError(err.message || 'Station configuration requires an internet connection.')
    } finally { setSaving(false) }
  }

  const toggleEnabled = async (station) => {
    try {
      const res = await window.api.pos.saveStation?.({
        ...station,
        enabled: !station.enabled
      })
      if (res?.success) {
        setLastSavedAt(new Date())
        await loadStations()
      }
    } catch (err) {
      setSaveError(err.message || 'Station configuration requires an internet connection.')
    }
  }

  const deleteStation = async (id) => {
    if (!confirm('Delete this station?')) return
    try {
      const res = await window.api.pos.deleteStation?.(id)
      if (res?.success) {
        setLastSavedAt(new Date())
        await loadStations()
      }
    } catch (err) {
      setSaveError(err.message || 'Station configuration requires an internet connection.')
    }
  }

  return (
    <div className="space-y-6">
      {isOffline && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <WifiOff size={16} />
          <span>Station configuration requires an internet connection. Changes made offline will not be saved.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Kitchen Stations</h2>
          <p className="text-sm text-slate-500">Configure kitchen, bar, and prep stations for ticket routing.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastSavedAt && (
            <span className="text-xs text-slate-400">Last saved {lastSavedAt.toLocaleTimeString()}</span>
          )}
          <button onClick={openNew} disabled={isOffline} className="rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#143f31] disabled:opacity-50 disabled:cursor-not-allowed">+ New Station</button>
        </div>
      </div>

      {saveError && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {stationEditorOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{editStation ? 'Edit Station' : 'New Station'}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
              <input type="text" className="input w-full" placeholder="e.g. Grill Station" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="min-w-[140px]">
              <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
              <select className="input w-full" value={formType} onChange={(e) => setFormType(e.target.value)}>
                <option value="kitchen">Kitchen</option>
                <option value="bar">Bar</option>
                <option value="prep">Prep</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button onClick={saveStation} disabled={saving || !formName.trim() || isOffline} className="rounded-xl bg-[#174c3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#143f31] disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setEditStation(null); setFormName(''); setSaveError(''); setStationEditorOpen(false) }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading stations...</div>
      ) : stations.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">No stations configured. Kitchen and bar are used by default.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((station) => (
            <div key={station.id} className={`rounded-xl border p-4 ${station.enabled ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{station.name}</p>
                  <p className="mt-0.5 text-xs capitalize text-slate-500">{station.type}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${station.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {station.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openEdit(station)} disabled={isOffline} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">Edit</button>
                <button onClick={() => toggleEnabled(station)} disabled={isOffline} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                  {station.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => deleteStation(station.id)} disabled={isOffline} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
