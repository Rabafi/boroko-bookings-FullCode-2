import { useState, useEffect } from 'react'
import { Save, Plus, X, Beer, Package } from 'lucide-react'

const CATEGORIES = ['Beers', 'Spirits', 'Cocktails', 'Wines', 'Shots', 'Soft Drinks', 'Snacks']
const EMOJI_MAP = { Beers: '🍺', Spirits: '🥃', Cocktails: '🍹', Wines: '🍷', Shots: '🔴', 'Soft Drinks': '🥤', Snacks: '🥨' }

export default function SettingsScreen({ user, settings, onSettingsChange }) {
  const [barName, setBarName] = useState(settings?.bar_name || 'My Bar')
  const [defaults, setDefaults] = useState({ outlet_id: settings?.outlet_id || 'main', currency: settings?.currency || 'BWP' })
  const [menuItems, setMenuItems] = useState([])
  const [showMenuItemForm, setShowMenuItemForm] = useState(false)
  const [menuForm, setMenuForm] = useState({ name: '', category: 'Beers', price: 0, inventory_item_id: '', depletion_qty: 1, emoji: '🍺' })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { loadMenuItems() }, [])

  async function loadMenuItems() {
    try {
      const items = await window.barAPI.getMenuItems()
      setMenuItems(items)
    } catch { setMenuItems([]) }
  }

  async function handleSaveSettings() {
    setBusy(true)
    try {
      await window.barAPI.saveSettings({ bar_name: barName, ...defaults })
      onSettingsChange({ bar_name: barName, ...defaults })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  async function handleAddMenuItem(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await window.barAPI.createMenuItem({
        name: menuForm.name,
        category: menuForm.category,
        price: Number(menuForm.price),
        inventory_item_id: menuForm.inventory_item_id || null,
        depletion_qty: Number(menuForm.depletion_qty),
        emoji: menuForm.emoji,
        is_available: true
      })
      setShowMenuItemForm(false)
      setMenuForm({ name: '', category: 'Beers', price: 0, inventory_item_id: '', depletion_qty: 1, emoji: '🍺' })
      loadMenuItems()
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  async function handleToggleAvailability(item) {
    try {
      await window.barAPI.updateMenuItem(item.id, { is_available: !item.is_available })
      loadMenuItems()
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
  }

  async function handleDeleteItem(id) {
    try {
      await window.barAPI.deleteMenuItem(id)
      loadMenuItems()
    } catch (err) { alert('Failed: ' + (err?.message || '')) }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-stone-800">
        <h1 className="text-base font-semibold">Settings</h1>
        {saved && <span className="badge-green text-[10px]">Saved</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 max-w-2xl">
        {/* Bar info */}
        <section className="card space-y-4">
          <h2 className="text-sm font-medium text-stone-300">Bar Info</h2>
          <div className="input-group">
            <label>Bar Name</label>
            <input type="text" value={barName} onChange={e => setBarName(e.target.value)} />
          </div>
          <button onClick={handleSaveSettings} disabled={busy} className="btn-primary text-xs">
            <Save className="w-3.5 h-3.5" /> {busy ? 'Saving...' : 'Save Settings'}
          </button>
        </section>

        {/* Menu items */}
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-300">Menu Items</h2>
            <button onClick={() => setShowMenuItemForm(true)} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" /> Add Drink
            </button>
          </div>

          {menuItems.length === 0 ? (
            <p className="text-sm text-stone-600 py-4 text-center">No menu items yet. Add your first drink.</p>
          ) : (
            <div className="space-y-1">
              {menuItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-stone-800/20 hover:bg-stone-800/40 text-sm">
                  <span className="text-lg">{item.emoji || '🍺'}</span>
                  <span className={`flex-1 ${item.is_available ? 'text-stone-200' : 'text-stone-600 line-through'}`}>
                    {item.name}
                  </span>
                  <span className="text-xs text-stone-500 font-mono">{item.category}</span>
                  <span className="text-xs font-mono text-stone-200">P{Number(item.price || 0).toFixed(2)}</span>
                  <button onClick={() => handleToggleAvailability(item)} className={`text-[10px] px-2 py-0.5 rounded ${item.is_available ? 'text-stone-500 hover:text-red-400' : 'text-brand-500 hover:text-brand-400'}`}>
                    {item.is_available ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => handleDeleteItem(item.id)} className="text-stone-600 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Database stats */}
        <section className="card space-y-3">
          <h2 className="text-sm font-medium text-stone-300">System</h2>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <span className="w-2 h-2 rounded-full bg-brand-500" />
            Fully offline — no internet connection needed
          </div>
          <div className="text-xs text-stone-600">
            User: {user?.name} ({user?.role})
          </div>
        </section>
      </div>

      {/* Add menu item modal */}
      {showMenuItemForm && (
        <div className="modal-overlay" onClick={() => setShowMenuItemForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-sm font-semibold">Add Drink</h2>
              <button onClick={() => setShowMenuItemForm(false)} className="text-stone-500 hover:text-stone-300"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleAddMenuItem}>
              <div className="modal-body space-y-3">
                <div className="input-group">
                  <label>Name</label>
                  <input type="text" value={menuForm.name} onChange={e => setMenuForm({ ...menuForm, name: e.target.value })} required placeholder="e.g. St Louis Lager" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="input-group">
                    <label>Category</label>
                    <select value={menuForm.category} onChange={e => setMenuForm({ ...menuForm, category: e.target.value, emoji: EMOJI_MAP[e.target.value] || '🍺' })}>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Price (P)</label>
                    <input type="number" value={menuForm.price} onChange={e => setMenuForm({ ...menuForm, price: e.target.value })} min="0" step="0.01" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="input-group">
                    <label>Emoji</label>
                    <input type="text" value={menuForm.emoji} onChange={e => setMenuForm({ ...menuForm, emoji: e.target.value })} placeholder="🍺" maxLength={4} />
                  </div>
                  <div className="input-group">
                    <label>Depletion qty</label>
                    <input type="number" value={menuForm.depletion_qty} onChange={e => setMenuForm({ ...menuForm, depletion_qty: e.target.value })} min="1" step="1" />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowMenuItemForm(false)} className="btn-ghost text-xs">Cancel</button>
                <button type="submit" disabled={busy} className="btn-primary text-xs">{busy ? 'Adding...' : 'Add to Menu'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
