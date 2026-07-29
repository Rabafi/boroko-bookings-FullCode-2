import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

export default function RestaurantChecklists() {
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [newType, setNewType] = useState('daily_opening')
  const [newItems, setNewItems] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [completingId, setCompletingId] = useState(null)

  useEffect(() => { loadChecklists() }, [])

  async function loadChecklists() {
    try {
      setLoading(true)
      setError('')
      const data = await window.api.pos.getChecklists ? await window.api.pos.getChecklists() : []
      setChecklists(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load checklists:', err)
      setError(err.message || 'Could not load checklists.')
    } finally {
      setLoading(false)
    }
  }

  async function createChecklist() {
    const items = newItems.split('\n').filter(l => l.trim()).map(l => ({ label: l.trim() }))
    if (items.length === 0) return
    try {
      setSaving(true)
      setError('')
      setNotice('')
      const result = await window.api.pos.createChecklist({ checklistType: newType, items })
      if (result?.success === false) throw new Error(result.error || 'Could not create checklist.')
      setNewItems('')
      setNotice('Checklist created and ready for the team.')
      await loadChecklists()
    } catch (err) {
      console.error('Failed to create checklist:', err)
      setError(err.message || 'Could not create checklist.')
    } finally {
      setSaving(false)
    }
  }

  async function completeItem(itemId) {
    try {
      setCompletingId(itemId)
      setError('')
      const result = await window.api.pos.completeChecklistItem({ itemId })
      if (result?.success === false) throw new Error(result.error || 'Could not complete checklist item.')
      await loadChecklists()
    } catch (err) {
      console.error('Failed to complete item:', err)
      setError(err.message || 'Could not complete checklist item.')
    } finally {
      setCompletingId(null)
    }
  }

  return (
    <div className="restaurant-native-page max-w-5xl">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Checklists</h1>
          <p className="text-sm text-gray-500 mt-1">Opening, closing, and operational checklists</p>
        </div>
        <button type="button" onClick={loadChecklists} className="restaurant-checklists-refresh" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'is-spinning' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="bb-card p-5 mb-6">
        <h2 className="font-semibold mb-3">Create Checklist</h2>
        <div className="flex gap-3 mb-3">
          <select value={newType} onChange={e => setNewType(e.target.value)} className="bb-input">
            <option value="daily_opening">Daily Opening</option>
            <option value="daily_closing">Daily Closing</option>
            <option value="cleaning">Cleaning</option>
            <option value="equipment">Equipment Check</option>
          </select>
        </div>
        <textarea
          placeholder="One item per line..."
          value={newItems}
          onChange={e => setNewItems(e.target.value)}
          className="bb-input w-full h-24 mb-3"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{newItems.split('\n').filter(line => line.trim()).length} task(s)</span>
          <button onClick={createChecklist} className="bb-btn-primary px-5" disabled={!newItems.trim() || saving}>
            {saving ? 'Creating…' : 'Create Checklist'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="restaurant-native-loading min-h-[140px]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          </div>
        ) : checklists.length === 0 ? (
        <div className="restaurant-native-empty">No checklists yet</div>
        ) : checklists.map(cl => {
          const completed = (cl.items || []).filter(i => i.is_completed).length
          const total = (cl.items || []).length
          const pct = total > 0 ? Math.round(completed / total * 100) : 0
          return (
            <div key={cl.id} className="bb-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold capitalize">{cl.checklist_type?.replace(/_/g, ' ')}</h3>
                  <span className="text-xs text-gray-500">{cl.created_at ? new Date(cl.created_at).toLocaleDateString() : ''}</span>
                </div>
                <div className="text-sm font-medium">{completed}/{total} ({pct}%)</div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="space-y-2">
                {(cl.items || []).map(item => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${item.is_completed ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      <span className={`text-sm ${item.is_completed ? 'line-through text-gray-400' : ''}`}>{item.item_label || item.text || item.description}</span>
                    </div>
                    {!item.is_completed && (
                      <button onClick={() => completeItem(item.id)} disabled={completingId === item.id} className="bb-btn-outline min-h-0 px-3 py-1 text-xs">
                        {completingId === item.id ? 'Saving…' : 'Complete'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
