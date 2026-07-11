import { useState, useEffect } from 'react'
import { Plus, Search, Minus, Beer, Wine, GlassWater, Package } from 'lucide-react'

const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const CATEGORY_ICONS = { Beer: Beer, Wine: Wine, Spirits: GlassWater, Cocktails: GlassWater, Default: Package }

export default function Inventory({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'Beer', unit: 'bottle', current_stock: 0, reorder_level: 0, unit_cost: 0 })
  const [busy, setBusy] = useState(false)
  const [adjustId, setAdjustId] = useState(null)
  const [adjustDelta, setAdjustDelta] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')

  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    setLoading(true)
    try {
      const data = await window.barAPI.getInventory()
      setItems(data)
    } catch { setItems([]) }
    finally { setLoading(false) }
  }

  const filtered = search.trim()
    ? items.filter(i => (i.name || '').toLowerCase().includes(search.toLowerCase()))
    : items

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await window.barAPI.createInventoryItem({ ...form, current_stock: Number(form.current_stock), reorder_level: Number(form.reorder_level), unit_cost: Number(form.unit_cost) })
      setShowForm(false)
      setForm({ name: '', category: 'Beer', unit: 'bottle', current_stock: 0, reorder_level: 0, unit_cost: 0 })
      loadItems()
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  async function handleAdjust(id) {
    if (adjustDelta === 0) return
    setBusy(true)
    try {
      await window.barAPI.adjustStock(id, adjustDelta, adjustReason || 'Manual adjustment')
      setAdjustId(null)
      setAdjustDelta(0)
      setAdjustReason('')
      loadItems()
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b border-stone-800">
          <h1 className="text-base font-semibold">Stock</h1>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stock..." className="w-full pl-8 pr-3 py-1.5 text-xs" />
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> Add Item
          </button>
          <span className="text-xs text-stone-500">{items.length} items</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-600 text-sm">No stock items</div>
          ) : (
            <div className="grid gap-2">
              {filtered.map(item => {
                const Icon = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.Default
                const lowStock = item.current_stock <= item.reorder_level && item.reorder_level > 0
                return (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-stone-800/20 hover:bg-stone-800/40">
                    <Icon className="w-5 h-5 text-stone-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-200">{item.name}</div>
                      <div className="text-[10px] text-stone-600">{item.category} — {item.unit || 'unit'}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-mono ${lowStock ? 'text-red-400' : 'text-stone-200'}`}>
                        {fmt(item.current_stock)}
                        {item.reorder_level > 0 && <span className="text-[10px] text-stone-600 ml-1">/ {item.reorder_level}</span>}
                      </div>
                      {item.unit_cost > 0 && <div className="text-[10px] text-stone-600">P{fmt(item.unit_cost)}/ea</div>}
                    </div>
                    <button onClick={() => { setAdjustId(item.id); setAdjustDelta(0); setAdjustReason('') }} className="btn-ghost text-xs px-2 py-1">
                      <Minus className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-sm font-semibold">Add Stock Item</h2>
              <button onClick={() => setShowForm(false)} className="text-stone-500 hover:text-stone-300"><Package className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body space-y-3">
                <div className="input-group">
                  <label>Name</label>
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. St Louis Lager" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="input-group">
                    <label>Category</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      <option>Beer</option><option>Spirits</option><option>Wine</option><option>Cocktails</option><option>Soft Drinks</option><option>Snacks</option><option>Other</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Unit</label>
                    <input type="text" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="bottle, can, case" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="input-group">
                    <label>Stock</label>
                    <input type="number" value={form.current_stock} onChange={e => setForm({ ...form, current_stock: e.target.value })} min="0" step="1" />
                  </div>
                  <div className="input-group">
                    <label>Reorder at</label>
                    <input type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} min="0" step="1" />
                  </div>
                  <div className="input-group">
                    <label>Cost (P)</label>
                    <input type="number" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} min="0" step="0.01" />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowForm(false)} className="btn-ghost text-xs">Cancel</button>
                <button type="submit" disabled={busy} className="btn-primary text-xs">{busy ? 'Adding...' : 'Add Item'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock adjust modal */}
      {adjustId && (
        <div className="modal-overlay" onClick={() => setAdjustId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-sm font-semibold">Adjust Stock</h2>
              <button onClick={() => setAdjustId(null)} className="text-stone-500 hover:text-stone-300"><X className="w-4 h-4" /></button>
            </div>
            <div className="modal-body space-y-3">
              <div className="input-group">
                <label>Quantity change</label>
                <input type="number" value={adjustDelta} onChange={e => setAdjustDelta(Number(e.target.value))} placeholder="Positive to add, negative to remove" />
              </div>
              <div className="input-group">
                <label>Reason</label>
                <input type="text" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="e.g. Stock delivery, spillage, wastage" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setAdjustId(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => handleAdjust(adjustId)} disabled={busy || adjustDelta === 0} className="btn-primary text-xs">
                {busy ? 'Saving...' : 'Adjust'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
