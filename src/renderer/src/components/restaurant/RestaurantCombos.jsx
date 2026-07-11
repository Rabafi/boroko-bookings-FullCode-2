import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X, Package } from 'lucide-react'

export default function RestaurantCombos() {
  const [combos, setCombos] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', basePrice: '', category: '', active: true })
  const [slots, setSlots] = useState([{ slotName: 'Main', minSelections: 1, maxSelections: 1, required: true, items: [] }])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [c, m] = await Promise.allSettled([
        window.api.pos.getRestaurantCombos(),
        window.api.pos.getMenuItems()
      ])
      setCombos(Array.isArray(c.value) ? c.value : [])
      setMenuItems(Array.isArray(m.value) ? m.value : [])
    } catch (err) {
      console.error('Failed to load combos:', err)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditing(null)
    setForm({ name: '', description: '', basePrice: '', category: '', active: true })
    setSlots([{ slotName: 'Main', minSelections: 1, maxSelections: 1, required: true, items: [] }])
    setShowForm(true)
  }

  function openEdit(combo) {
    setEditing(combo)
    setForm({ name: combo.name || '', description: combo.description || '', basePrice: String(combo.base_price || ''), category: combo.category || '', active: combo.active })
    setSlots([{ slotName: 'Main', minSelections: 1, maxSelections: 1, required: true, items: [] }])
    setShowForm(true)
  }

  async function saveCombo() {
    if (!form.name.trim()) return
    try {
      await window.api.pos.saveRestaurantCombo({
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        description: form.description.trim() || null,
        basePrice: Number(form.basePrice) || 0,
        category: form.category.trim() || null,
        active: form.active,
        slots: slots.map(s => ({
          slotName: s.slotName,
          minSelections: s.minSelections,
          maxSelections: s.maxSelections,
          required: s.required,
          items: s.items.map(i => ({
            menuItemId: i.menuItemId,
            priceDelta: i.priceDelta || 0,
            defaultSelected: i.defaultSelected || false
          }))
        }))
      })
      setShowForm(false)
      setEditing(null)
      await loadData()
    } catch (err) {
      console.error('Failed to save combo:', err)
    }
  }

  async function deleteCombo(comboId) {
    if (!confirm('Delete this combo?')) return
    try {
      await window.api.pos.deleteRestaurantCombo(comboId)
      await loadData()
    } catch (err) {
      console.error('Failed to delete combo:', err)
    }
  }

  function addSlot() {
    setSlots([...slots, { slotName: '', minSelections: 1, maxSelections: 1, required: true, items: [] }])
  }

  function updateSlot(idx, field, value) {
    const updated = [...slots]
    updated[idx] = { ...updated[idx], [field]: value }
    setSlots(updated)
  }

  function removeSlot(idx) {
    setSlots(slots.filter((_, i) => i !== idx))
  }

  function addSlotItem(slotIdx) {
    const updated = [...slots]
    updated[slotIdx].items = [...updated[slotIdx].items, { menuItemId: '', priceDelta: 0, defaultSelected: false }]
    setSlots(updated)
  }

  function updateSlotItem(slotIdx, itemIdx, field, value) {
    const updated = [...slots]
    updated[slotIdx].items = [...updated[slotIdx].items] 
    updated[slotIdx].items[itemIdx] = { ...updated[slotIdx].items[itemIdx], [field]: value }
    setSlots(updated)
  }

  function removeSlotItem(slotIdx, itemIdx) {
    const updated = [...slots]
    updated[slotIdx].items = updated[slotIdx].items.filter((_, i) => i !== itemIdx)
    setSlots(updated)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Combos & Meal Deals</h1>
          <p className="text-sm text-gray-500 mt-1">Create burger meals, lunch specials, family platters, and bundled offers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="bb-btn-outline text-sm">Refresh</button>
          <button onClick={openNew} className="bb-btn-primary text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Combo
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : combos.length === 0 ? (
        <div className="bb-card p-12 text-center">
          <Package size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 text-lg mb-2">No combos yet</p>
          <p className="text-gray-400 text-sm mb-4">Create your first combo to bundle menu items together</p>
          <button onClick={openNew} className="bb-btn-primary">Create Combo</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {combos.map(combo => (
            <div key={combo.id} className="bb-card p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{combo.name}</h3>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(combo)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => deleteCombo(combo.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
              {combo.description && <p className="text-sm text-gray-500 mb-2">{combo.description}</p>}
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-emerald-600">${Number(combo.base_price || 0).toFixed(2)}</span>
                {combo.category && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{combo.category}</span>}
              </div>
              <div className={`mt-2 text-xs ${combo.active ? 'text-emerald-600' : 'text-gray-400'}`}>
                {combo.active ? 'Active' : 'Inactive'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Combo Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editing ? 'Edit Combo' : 'New Combo'}</h2>
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-xs font-medium text-gray-600">Combo Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Burger Meal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Base Price *</label>
                  <input type="number" step="0.01" value={form.basePrice} onChange={e => setForm({ ...form, basePrice: e.target.value })} className="bb-input w-full mt-1" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Category</label>
                  <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Lunch Specials" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bb-input w-full mt-1" />
              </div>
            </div>

            {/* Slots */}
            <div className="border-t pt-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Choice Slots</h3>
                <button onClick={addSlot} className="text-xs text-[#174c3a] hover:underline flex items-center gap-1"><Plus size={12} /> Add Slot</button>
              </div>
              <div className="space-y-3">
                {slots.map((slot, si) => (
                  <div key={si} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input value={slot.slotName} onChange={e => updateSlot(si, 'slotName', e.target.value)} className="bb-input flex-1 text-sm" placeholder="Slot name (e.g. Main, Side, Drink)" />
                      <input type="number" min="1" value={slot.minSelections} onChange={e => updateSlot(si, 'minSelections', Number(e.target.value))} className="bb-input w-16 text-sm" title="Min" />
                      <input type="number" min="1" value={slot.maxSelections} onChange={e => updateSlot(si, 'maxSelections', Number(e.target.value))} className="bb-input w-16 text-sm" title="Max" />
                      <button onClick={() => removeSlot(si)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                    </div>
                    <div className="space-y-1">
                      {slot.items.map((item, ii) => (
                        <div key={ii} className="flex items-center gap-2">
                          <select value={item.menuItemId} onChange={e => updateSlotItem(si, ii, 'menuItemId', e.target.value)} className="bb-input flex-1 text-sm">
                            <option value="">Select menu item...</option>
                            {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <input type="number" step="0.01" value={item.priceDelta} onChange={e => updateSlotItem(si, ii, 'priceDelta', Number(e.target.value))} className="bb-input w-20 text-sm" placeholder="+/-" />
                          <button onClick={() => removeSlotItem(si, ii)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
                        </div>
                      ))}
                      <button onClick={() => addSlotItem(si)} className="text-xs text-[#174c3a] hover:underline">+ Add option</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveCombo} disabled={!form.name.trim()} className="bb-btn-primary flex-1">{editing ? 'Save Changes' : 'Create Combo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
