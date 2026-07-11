import { useState, useEffect } from 'react'

export default function RestaurantChecklists() {
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [newType, setNewType] = useState('daily_opening')
  const [newItems, setNewItems] = useState('')

  useEffect(() => { loadChecklists() }, [])

  async function loadChecklists() {
    try {
      setLoading(true)
      const data = await window.api.pos.getChecklists ? await window.api.pos.getChecklists() : []
      setChecklists(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load checklists:', err)
    } finally {
      setLoading(false)
    }
  }

  async function createChecklist() {
    const items = newItems.split('\n').filter(l => l.trim()).map(l => ({ text: l.trim() }))
    if (items.length === 0) return
    try {
      await window.api.pos.createChecklist({ checklistType: newType, items })
      setNewItems('')
      await loadChecklists()
    } catch (err) {
      console.error('Failed to create checklist:', err)
    }
  }

  async function completeItem(itemId) {
    try {
      await window.api.pos.completeChecklistItem({ itemId })
      await loadChecklists()
    } catch (err) {
      console.error('Failed to complete item:', err)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Checklists</h1>
          <p className="text-sm text-gray-500 mt-1">Opening, closing, and operational checklists</p>
        </div>
        <button onClick={loadChecklists} className="bb-btn-outline text-sm">Refresh</button>
      </div>

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
        <button onClick={createChecklist} className="bb-btn-primary" disabled={!newItems.trim()}>
          Create Checklist
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
          </div>
        ) : checklists.length === 0 ? (
          <div className="bb-card p-8 text-center text-gray-500">No checklists yet</div>
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
                      <button onClick={() => completeItem(item.id)} className="text-xs text-emerald-600 hover:underline">
                        Complete
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
