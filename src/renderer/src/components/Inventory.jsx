import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, AlertTriangle, TrendingUp, Package } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../App'

const CATEGORIES = ['Bar', 'Kitchen', 'Other']
const UNITS = ['bottle', 'can', 'kg', 'g', 'L', 'ml', 'piece', 'pack', 'box', 'roll']

const today = () => new Date().toISOString().split('T')[0]

function fmt(v, dp = 2) {
  return Number(v || 0).toFixed(dp)
}

export default function Inventory() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('stock') // stock | purchases

  const [items, setItems] = useState([])
  const [catFilter, setCatFilter] = useState('all')
  const [loading, setLoading] = useState(false)

  // Item form modal
  const [itemModal, setItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState({ name: '', category: 'Bar', unit: 'bottle', reorder_level: '' })
  const [itemSaving, setItemSaving] = useState(false)

  // Purchase modal
  const [purchaseModal, setPurchaseModal] = useState(false)
  const [purchaseItem, setPurchaseItem] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState({ date: today(), quantity_purchased: '', total_cost: '', notes: '' })
  const [purchaseSaving, setPurchaseSaving] = useState(false)
  const [purchaseHistory, setPurchaseHistory] = useState([])
  const [historyItemId, setHistoryItemId] = useState(null)

  // Adjust stock modal
  const [adjustModal, setAdjustModal] = useState(false)
  const [adjustItem, setAdjustItem] = useState(null)
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustNotes, setAdjustNotes] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  useEffect(() => { loadItems() }, [])

  useEffect(() => {
    if (tab === 'purchases' && historyItemId) loadPurchases(historyItemId)
  }, [tab])

  const loadItems = async () => {
    setLoading(true)
    const data = await window.api.inventory.getItems().catch(() => [])
    setItems(data || [])
    setLoading(false)
  }

  const loadPurchases = async (itemId) => {
    const data = await window.api.inventory.getPurchases(itemId).catch(() => [])
    setPurchaseHistory(data || [])
  }

  // ── Item CRUD ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingItem(null)
    setItemForm({ name: '', category: 'Bar', unit: 'bottle', reorder_level: '' })
    setItemModal(true)
  }

  const openEdit = (item) => {
    setEditingItem(item)
    setItemForm({
      name: item.name,
      category: item.category,
      unit: item.unit,
      reorder_level: String(item.reorder_level)
    })
    setItemModal(true)
  }

  const handleItemSubmit = async (e) => {
    e.preventDefault()
    setItemSaving(true)
    try {
      const payload = { ...itemForm, reorder_level: parseFloat(itemForm.reorder_level) || 0 }
      if (editingItem) {
        await window.api.inventory.updateItem(editingItem.id, payload)
      } else {
        await window.api.inventory.createItem(payload)
      }
      setItemModal(false)
      loadItems()
    } catch (err) {
      alert(err.message || 'Failed to save item. Please try again.')
    } finally {
      setItemSaving(false)
    }
  }

  const deleteItem = async (item) => {
    if (!confirm(`Delete "${item.name}"? This will also delete all purchase history.`)) return
    try {
      await window.api.inventory.deleteItem(item.id)
      loadItems()
    } catch (err) {
      alert(err.message || 'Failed to delete item.')
    }
  }

  // ── Purchase ─────────────────────────────────────────────────────────────────

  const openPurchase = (item) => {
    setPurchaseItem(item)
    setPurchaseForm({ date: today(), quantity_purchased: '', total_cost: '', notes: '' })
    setPurchaseModal(true)
  }

  const handlePurchaseSubmit = async (e) => {
    e.preventDefault()
    setPurchaseSaving(true)
    try {
      await window.api.inventory.addPurchase({
        item_id: purchaseItem.id,
        ...purchaseForm,
        quantity_purchased: parseFloat(purchaseForm.quantity_purchased),
        total_cost: parseFloat(purchaseForm.total_cost)
      })
      setPurchaseModal(false)
      loadItems()
    } catch (err) {
      alert(err.message || 'Failed to record purchase. Please try again.')
    } finally {
      setPurchaseSaving(false)
    }
  }

  const unitCostPreview = () => {
    const qty = parseFloat(purchaseForm.quantity_purchased)
    const cost = parseFloat(purchaseForm.total_cost)
    if (qty > 0 && cost > 0) return (cost / qty).toFixed(4)
    return null
  }

  // ── Adjust stock ─────────────────────────────────────────────────────────────

  const openAdjust = (item) => {
    setAdjustItem(item)
    setAdjustDelta('')
    setAdjustNotes('')
    setAdjustModal(true)
  }

  const handleAdjustSubmit = async (e) => {
    e.preventDefault()
    setAdjustSaving(true)
    try {
      await window.api.inventory.adjustStock(adjustItem.id, parseFloat(adjustDelta), adjustNotes)
      setAdjustModal(false)
      loadItems()
    } catch (err) {
      alert(err.message || 'Failed to adjust stock. Please try again.')
    } finally {
      setAdjustSaving(false)
    }
  }

  const filtered = items.filter((i) => catFilter === 'all' || i.category === catFilter)
  const lowStockCount = items.filter((i) => i.current_stock <= i.reorder_level).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {items.length} items
            {lowStockCount > 0 && (
              <span className="ml-2 text-red-500 font-medium">· {lowStockCount} low stock</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[['stock', 'Stock'], ['purchases', 'Purchases']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setTab(v)}
                className={`px-4 py-2 transition-colors ${tab === v ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {/* ── Stock Tab ── */}
      {tab === 'stock' && (
        <>
          {/* Category filter */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm mb-5 w-fit">
            <button
              onClick={() => setCatFilter('all')}
              className={`px-3 py-2 transition-colors ${catFilter === 'all' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`px-3 py-2 transition-colors ${catFilter === c ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <p className="px-5 py-10 text-center text-gray-400 text-sm">Loading...</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left">Item</th>
                    <th className="px-5 py-3 text-left">Category</th>
                    <th className="px-5 py-3 text-left">Unit</th>
                    <th className="px-5 py-3 text-right">In Stock</th>
                    <th className="px-5 py-3 text-right">Reorder At</th>
                    <th className="px-5 py-3 text-right">Unit Cost</th>
                    <th className="px-5 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((item) => {
                    const isLow = item.current_stock <= item.reorder_level
                    return (
                      <tr key={item.id} className={`hover:bg-gray-50 ${isLow ? 'bg-red-50/40' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {isLow && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                            <p className="font-medium text-gray-800">{item.name}</p>
                          </div>
                          {isLow && (
                            <p className="text-xs text-red-500 mt-0.5 ml-5">Low stock — reorder needed</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{item.unit}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>
                          {fmt(item.current_stock, 1)} {item.unit}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-500">
                          {fmt(item.reorder_level, 1)} {item.unit}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-600">
                          {item.latest_unit_cost > 0
                            ? `${currency} ${fmt(item.latest_unit_cost, 4)}`
                            : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openPurchase(item)}
                              className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Record Purchase"
                            >
                              + Stock
                            </button>
                            <button
                              onClick={() => openAdjust(item)}
                              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Adjust Stock"
                            >
                              Adjust
                            </button>
                            <button
                              onClick={() => openEdit(item)}
                              className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteItem(item)}
                              className="p-1.5 text-red-400 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                        <Package size={32} className="mx-auto mb-2 opacity-30" />
                        No inventory items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Purchases Tab ── */}
      {tab === 'purchases' && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={historyItemId || ''}
              onChange={async (e) => {
                setHistoryItemId(e.target.value)
                if (e.target.value) await loadPurchases(e.target.value)
                else setPurchaseHistory([])
              }}
            >
              <option value="">All items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            {!historyItemId && (
              <button
                onClick={async () => {
                  // Load all purchases by loading each item's purchases
                  const all = []
                  for (const item of items) {
                    const p = await window.api.inventory.getPurchases(item.id).catch(() => [])
                    all.push(...p.map((x) => ({ ...x, item_name: item.name, item_unit: item.unit })))
                  }
                  all.sort((a, b) => new Date(b.date) - new Date(a.date))
                  setPurchaseHistory(all)
                }}
                className="btn-secondary text-sm"
              >
                Load All
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  {!historyItemId && <th className="px-5 py-3 text-left">Item</th>}
                  <th className="px-5 py-3 text-right">Qty Purchased</th>
                  <th className="px-5 py-3 text-right">Total Cost</th>
                  <th className="px-5 py-3 text-right">Unit Cost (auto)</th>
                  <th className="px-5 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {purchaseHistory.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-600">{p.date}</td>
                    {!historyItemId && (
                      <td className="px-5 py-3 font-medium text-gray-800">{p.item_name}</td>
                    )}
                    <td className="px-5 py-3 text-right text-gray-800">
                      {fmt(p.quantity_purchased, 1)} {p.item_unit || ''}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">
                      {currency} {fmt(p.total_cost)}
                    </td>
                    <td className="px-5 py-3 text-right text-green-700 font-medium">
                      {currency} {fmt(p.unit_cost, 4)}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{p.notes || '—'}</td>
                  </tr>
                ))}
                {purchaseHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                      {historyItemId ? 'No purchases recorded for this item.' : 'Select an item or click Load All.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Item Modal */}
      {itemModal && (
        <Modal
          title={editingItem ? 'Edit Item' : 'Add Inventory Item'}
          onClose={() => setItemModal(false)}
          size="sm"
        >
          <form onSubmit={handleItemSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                className="input"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                required
                placeholder="e.g. Castle Lager, Cooking Oil"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  className="input"
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                <select
                  className="input"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reorder Level ({itemForm.unit})
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="input"
                value={itemForm.reorder_level}
                onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })}
                placeholder="Alert when stock falls below this"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setItemModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={itemSaving} className="btn-primary flex-1">
                {itemSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Purchase Modal */}
      {purchaseModal && purchaseItem && (
        <Modal
          title={`Record Purchase — ${purchaseItem.name}`}
          onClose={() => setPurchaseModal(false)}
          size="sm"
        >
          <form onSubmit={handlePurchaseSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input
                type="date"
                className="input"
                value={purchaseForm.date}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity ({purchaseItem.unit}) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="input"
                  value={purchaseForm.quantity_purchased}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_purchased: e.target.value })}
                  required
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Cost ({currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={purchaseForm.total_cost}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, total_cost: e.target.value })}
                  required
                  placeholder="0.00"
                />
              </div>
            </div>
            {unitCostPreview() && (
              <div className="bg-green-50 rounded-lg p-3 text-sm">
                <p className="text-green-800">
                  Auto unit cost: <strong>{currency} {unitCostPreview()}</strong> per {purchaseItem.unit}
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                className="input"
                value={purchaseForm.notes}
                onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                placeholder="Supplier, invoice number, etc."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setPurchaseModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={purchaseSaving} className="btn-primary flex-1">
                {purchaseSaving ? 'Saving...' : 'Record Purchase'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Adjust Stock Modal */}
      {adjustModal && adjustItem && (
        <Modal
          title={`Adjust Stock — ${adjustItem.name}`}
          onClose={() => setAdjustModal(false)}
          size="sm"
        >
          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">
              Current stock: <strong>{fmt(adjustItem.current_stock, 1)} {adjustItem.unit}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Adjustment ({adjustItem.unit}) *
              </label>
              <input
                type="number"
                step="0.1"
                className="input"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                required
                placeholder="Use negative to reduce, e.g. -5"
              />
              {adjustDelta && (
                <p className="text-xs text-gray-500 mt-1">
                  New stock: {fmt(Math.max(0, Number(adjustItem.current_stock) + Number(adjustDelta)), 1)} {adjustItem.unit}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input
                type="text"
                className="input"
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="e.g. Waste, spillage, stocktake correction"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setAdjustModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="submit" disabled={adjustSaving} className="btn-primary flex-1">
                {adjustSaving ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
