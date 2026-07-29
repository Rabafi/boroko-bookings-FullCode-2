import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X, Package } from 'lucide-react'

export default function RestaurantCombos() {
  const [combos, setCombos] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', basePrice: '', category: '', active: true, availableFrom: '', availableTo: '', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })
  const [slots, setSlots] = useState([{ slotName: 'Main', minSelections: 1, maxSelections: 1, required: true, items: [] }])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      setError('')
      const [c, m] = await Promise.allSettled([
        window.api.pos.getRestaurantCombos(),
        window.api.pos.getMenuItems()
      ])
      setCombos(Array.isArray(c.value) ? c.value : [])
      setMenuItems(Array.isArray(m.value) ? m.value : [])
      if ([c, m].some(result => result.status === 'rejected')) setError('Some combo information could not be loaded.')
    } catch (err) {
      console.error('Failed to load combos:', err)
      setError(err.message || 'Could not load combos.')
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditing(null)
    setForm({ name: '', description: '', basePrice: '', category: '', active: true, availableFrom: '', availableTo: '', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })
    setSlots([{ slotName: 'Main', minSelections: 1, maxSelections: 1, required: true, items: [] }])
    setShowForm(true)
  }

  function openEdit(combo) {
    setEditing(combo)
    setForm({ name: combo.name || '', description: combo.description || '', basePrice: String(combo.base_price || ''), category: combo.category || '', active: combo.active, availableFrom: combo.available_from || '', availableTo: combo.available_to || '', daysOfWeek: combo.days_of_week || [0, 1, 2, 3, 4, 5, 6] })
    setSlots([])
    setShowForm(true)
  }

  async function saveCombo() {
    if (!form.name.trim()) return
    if (!editing) {
      const invalidSlot = slots.some(slot => !slot.slotName.trim() || slot.minSelections < 0 || slot.maxSelections < slot.minSelections || !slot.items.some(item => item.menuItemId))
      if (slots.length === 0 || invalidSlot) {
        setError('Every new combo needs a named choice slot, valid minimum/maximum choices, and at least one menu item.')
        return
      }
    }
    try {
      setSaving(true)
      setError('')
      setNotice('')
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        description: form.description.trim() || null,
        base_price: Number(form.basePrice) || 0,
        category: form.category.trim() || null,
        active: form.active,
        ...(!editing ? {
          available_from: form.availableFrom || null,
          available_to: form.availableTo || null,
          days_of_week: form.daysOfWeek,
          slots: slots.map((s, slotIndex) => ({
          slot_name: s.slotName,
          min_selections: s.minSelections,
          max_selections: s.maxSelections,
          required: s.required,
          sort_order: slotIndex,
          items: s.items.map(i => ({
            menu_item_id: i.menuItemId,
            price_delta: i.priceDelta || 0,
            default_selected: i.defaultSelected || false
          }))
        }))
        } : {})
      }
      const result = await window.api.pos.saveRestaurantCombo(payload)
      if (result?.success === false) throw new Error(result.error || 'Could not save combo.')
      setShowForm(false)
      setEditing(null)
      setNotice(`Combo ${editing ? 'updated' : 'created'}.`)
      await loadData()
    } catch (err) {
      console.error('Failed to save combo:', err)
      setError(err.message || 'Could not save combo.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCombo(comboId) {
    if (!confirm('Delete this combo?')) return
    try {
      setError('')
      setNotice('')
      const result = await window.api.pos.deleteRestaurantCombo(comboId)
      if (result?.success === false || result === false) throw new Error(result?.error || 'Could not delete combo.')
      setNotice('Combo deleted.')
      await loadData()
    } catch (err) {
      console.error('Failed to delete combo:', err)
      setError(err.message || 'Could not delete combo.')
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
    <div className="restaurant-native-page max-w-6xl">
      <div className="restaurant-native-hero">
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

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : combos.length === 0 ? (
          <div className="restaurant-native-empty">
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
                <span className="text-lg font-bold text-emerald-600">P {Number(combo.base_price || 0).toFixed(2)}</span>
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
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Available for sale
              </label>
              {!editing && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">Selling window (optional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs">From<input type="time" value={form.availableFrom} onChange={event => setForm({ ...form, availableFrom: event.target.value })} className="bb-input mt-1 w-full" /></label>
                    <label className="text-xs">To<input type="time" value={form.availableTo} onChange={event => setForm({ ...form, availableTo: event.target.value })} className="bb-input mt-1 w-full" /></label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, dayIndex) => <label key={day} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={form.daysOfWeek.includes(dayIndex)} onChange={event => setForm(current => ({ ...current, daysOfWeek: event.target.checked ? [...current.daysOfWeek, dayIndex].sort() : current.daysOfWeek.filter(value => value !== dayIndex) }))} />{day}</label>)}
                  </div>
                </div>
              )}
            </div>

            {/* Slots */}
            <div className="border-t pt-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Choice Slots</h3>
                {!editing && <button onClick={addSlot} className="text-xs text-[#174c3a] hover:underline flex items-center gap-1"><Plus size={12} /> Add Slot</button>}
              </div>
              {editing && <p className="restaurant-native-financial-warning">Pricing and availability can be updated here. Existing choice slots are preserved because this list endpoint does not return their full item configuration.</p>}
              {!editing && (
              <div className="space-y-3">
                {slots.map((slot, si) => (
                  <div key={si} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input value={slot.slotName} onChange={e => updateSlot(si, 'slotName', e.target.value)} className="bb-input flex-1 text-sm" placeholder="Slot name (e.g. Main, Side, Drink)" />
                      <input type="number" min="1" value={slot.minSelections} onChange={e => updateSlot(si, 'minSelections', Number(e.target.value))} className="bb-input w-16 text-sm" title="Min" />
                      <input type="number" min="1" value={slot.maxSelections} onChange={e => updateSlot(si, 'maxSelections', Number(e.target.value))} className="bb-input w-16 text-sm" title="Max" />
                      <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={slot.required} onChange={e => updateSlot(si, 'required', e.target.checked)} />Required</label>
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
                          <label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={item.defaultSelected} onChange={e => updateSlotItem(si, ii, 'defaultSelected', e.target.checked)} />Default</label>
                          <button onClick={() => removeSlotItem(si, ii)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
                        </div>
                      ))}
                      <button onClick={() => addSlotItem(si)} className="text-xs text-[#174c3a] hover:underline">+ Add option</button>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveCombo} disabled={!form.name.trim() || saving} className="bb-btn-primary flex-1">{saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Combo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
