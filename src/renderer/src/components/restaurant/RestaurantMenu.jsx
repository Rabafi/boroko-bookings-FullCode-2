import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'

export default function RestaurantMenu() {
  const [menuItems, setMenuItems] = useState([])
  const [modifierGroups, setModifierGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('items')
  const [editingItem, setEditingItem] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', category: '', price: '', cost_price: '', unit: 'portion', is_available: true })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [items, groups] = await Promise.all([
        window.api.pos.getMenuItems(),
        window.api.pos.getModifierGroups()
      ])
      setMenuItems(Array.isArray(items) ? items : [])
      setModifierGroups(Array.isArray(groups) ? groups : [])
    } catch (err) {
      console.error('Failed to load menu data:', err)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditingItem(null)
    setForm({ name: '', category: '', price: '', cost_price: '', unit: 'portion', is_available: true })
    setShowForm(true)
  }

  function openEdit(item) {
    setEditingItem(item)
    setForm({
      name: item.name || '',
      category: item.category || '',
      price: item.price ?? item.selling_price ?? '',
      cost_price: item.cost_price ?? '',
      unit: item.unit || 'portion',
      is_available: item.is_available !== false
    })
    setShowForm(true)
  }

  async function saveItem() {
    if (!form.name.trim()) return
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      price: Number(form.price) || 0,
      cost_price: Number(form.cost_price) || null,
      unit: form.unit || 'portion',
      is_available: form.is_available
    }
    try {
      if (editingItem) {
        await window.api.pos.updateMenuItem(editingItem.id, payload)
      } else {
        await window.api.pos.createMenuItem(payload)
      }
      setShowForm(false)
      setEditingItem(null)
      await loadData()
    } catch (err) {
      console.error('Failed to save item:', err)
    }
  }

  async function deleteItem(id) {
    if (!confirm('Delete this menu item?')) return
    try {
      await window.api.pos.deleteMenuItem(id)
      await loadData()
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  const categories = [...new Set(menuItems.map(i => i.category).filter(Boolean))]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu & Modifiers</h1>
          <p className="text-sm text-gray-500 mt-1">Manage menu items, pricing, and modifier groups</p>
        </div>
        <div className="flex gap-2">
          {tab === 'items' && (
            <button onClick={openNew} className="bb-btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> Add Item
            </button>
          )}
          <button onClick={loadData} className="bb-btn-outline text-sm">Refresh</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {['items', 'modifiers'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'items' ? `Menu Items (${menuItems.length})` : `Modifier Groups (${modifierGroups.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : tab === 'items' ? (
        menuItems.length === 0 ? (
          <div className="bb-card p-12 text-center">
            <p className="text-gray-500 text-lg mb-2">No menu items</p>
            <p className="text-gray-400 text-sm">Click "Add Item" to create your first menu item</p>
          </div>
        ) : (
          <div className="space-y-4">
            {categories.length > 0 && categories.map(cat => (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{cat}</h3>
                <div className="divide-y bb-card">
                  {menuItems.filter(i => i.category === cat).map(item => (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{item.name}</span>
                          {item.is_available === false && (
                            <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Unavailable</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {item.unit || 'portion'} {item.cost_price != null ? `| Cost: $${Number(item.cost_price).toFixed(2)}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-sm">${Number(item.price ?? item.selling_price ?? 0).toFixed(2)}</span>
                        <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                        <button onClick={() => deleteItem(item.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {categories.length === 0 && (
              <div className="divide-y bb-card">
                {menuItems.map(item => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{item.name}</span>
                        {item.is_available === false && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Unavailable</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {item.unit || 'portion'} {item.category ? `| ${item.category}` : ''} {item.cost_price != null ? `| Cost: $${Number(item.cost_price).toFixed(2)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">${Number(item.price ?? item.selling_price ?? 0).toFixed(2)}</span>
                      <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                      <button onClick={() => deleteItem(item.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        /* Modifier groups tab */
        modifierGroups.length === 0 ? (
          <div className="bb-card p-12 text-center">
            <p className="text-gray-500 text-lg mb-2">No modifier groups</p>
            <p className="text-gray-400 text-sm">Set up modifier groups in POS &gt; Setup &gt; Modifiers</p>
          </div>
        ) : (
          <div className="space-y-4">
            {modifierGroups.map((group) => (
              <div key={group.id} className="bb-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{group.name}</h3>
                  <div className="flex gap-2 text-xs">
                    {group.min_selections != null && (
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Min: {group.min_selections}</span>
                    )}
                    {group.max_selections != null && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Max: {group.max_selections}</span>
                    )}
                  </div>
                </div>
                {group.applies_to_categories?.length > 0 && (
                  <div className="text-xs text-gray-500 mb-2">Applies to: {group.applies_to_categories.join(', ')}</div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {(group.options || []).map((opt, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm flex justify-between">
                      <span>{opt.name || opt}</span>
                      {opt.price != null && <span className="text-gray-500">${Number(opt.price).toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingItem ? 'Edit Menu Item' : 'Add Menu Item'}</h2>
              <button onClick={() => { setShowForm(false); setEditingItem(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Classic Burger" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Category</label>
                  <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bb-input w-full mt-1" placeholder="e.g. Food" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Unit</label>
                  <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="bb-input w-full mt-1" placeholder="portion" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Selling Price</label>
                  <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="bb-input w-full mt-1" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Cost Price</label>
                  <input type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="bb-input w-full mt-1" placeholder="0.00" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_available} onChange={e => setForm({ ...form, is_available: e.target.checked })} />
                Available for sale
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setEditingItem(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveItem} disabled={!form.name.trim()} className="bb-btn-primary flex-1">{editingItem ? 'Save Changes' : 'Add Item'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
