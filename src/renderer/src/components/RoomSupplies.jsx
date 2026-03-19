import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Save, ShoppingBag } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../App'

const SUPPLY_CATEGORIES = ['Bathroom', 'Linen', 'Kitchen', 'Other']
const SUPPLY_UNITS = ['roll', 'piece', 'bar', 'sachet', 'ml', 'L', 'kg', 'pack', 'sheet', 'pair']

function fmt(v, dp = 2) {
  return Number(v || 0).toFixed(dp)
}

// Get Monday of the week for a given date string
function getMondayStr(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function thisMonday() {
  return getMondayStr(new Date().toISOString().split('T')[0])
}

function monthStart() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function RoomSupplies() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('capture') // capture | items | report

  // Supply items
  const [supplyItems, setSupplyItems] = useState([])
  const [rooms, setRooms] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)

  // Item form modal
  const [itemModal, setItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState({ name: '', category: 'Bathroom', unit: 'roll' })
  const [itemSaving, setItemSaving] = useState(false)

  // Purchase modal
  const [purchaseModal, setPurchaseModal] = useState(false)
  const [purchaseItem, setPurchaseItem] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState({ date: today(), quantity_purchased: '', total_cost: '', notes: '' })
  const [purchaseSaving, setPurchaseSaving] = useState(false)

  // Weekly capture
  const [weekStart, setWeekStart] = useState(thisMonday())
  const [allocations, setAllocations] = useState({}) // { `${roomId}_${supplyItemId}`: units_used }
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  // Report
  const [reportStart, setReportStart] = useState(monthStart())
  const [reportEnd, setReportEnd] = useState(today())
  const [reportData, setReportData] = useState([])
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    loadSupplyItems()
    loadRooms()
  }, [])

  useEffect(() => {
    if (tab === 'capture') loadWeekAllocations()
  }, [weekStart, tab])

  useEffect(() => {
    if (tab === 'report') loadReport()
  }, [tab, reportStart, reportEnd])

  const loadSupplyItems = async () => {
    setLoadingItems(true)
    const data = await window.api.supplies.getItems().catch(() => [])
    setSupplyItems(data || [])
    setLoadingItems(false)
  }

  const loadRooms = async () => {
    const data = await window.api.rooms.getAll().catch(() => [])
    setRooms((data || []).sort((a, b) => a.room_number - b.room_number))
  }

  const loadWeekAllocations = async () => {
    const data = await window.api.supplies.getWeekAllocations(weekStart).catch(() => [])
    const map = {}
    for (const a of data) {
      map[`${a.room_id}_${a.supply_item_id}`] = String(a.units_used)
    }
    setAllocations(map)
  }

  const loadReport = async () => {
    setReportLoading(true)
    const data = await window.api.supplies.getAllocations(reportStart, reportEnd).catch(() => [])
    setReportData(data || [])
    setReportLoading(false)
  }

  // ── Item CRUD ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingItem(null)
    setItemForm({ name: '', category: 'Bathroom', unit: 'roll' })
    setItemModal(true)
  }

  const openEdit = (item) => {
    setEditingItem(item)
    setItemForm({ name: item.name, category: item.category, unit: item.unit })
    setItemModal(true)
  }

  const handleItemSubmit = async (e) => {
    e.preventDefault()
    setItemSaving(true)
    try {
      if (editingItem) {
        await window.api.supplies.updateItem(editingItem.id, itemForm)
      } else {
        await window.api.supplies.createItem(itemForm)
      }
      setItemModal(false)
      loadSupplyItems()
    } catch (err) {
      alert(err.message || 'Failed to save item. Please try again.')
    } finally {
      setItemSaving(false)
    }
  }

  const deleteItem = async (item) => {
    if (!confirm(`Delete "${item.name}"? All purchase history and allocations will be lost.`)) return
    try {
      await window.api.supplies.deleteItem(item.id)
      loadSupplyItems()
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
      await window.api.supplies.addPurchase({
        item_id: purchaseItem.id,
        ...purchaseForm,
        quantity_purchased: parseFloat(purchaseForm.quantity_purchased),
        total_cost: parseFloat(purchaseForm.total_cost)
      })
      setPurchaseModal(false)
      loadSupplyItems()
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

  // ── Weekly capture ───────────────────────────────────────────────────────────

  const setAlloc = (roomId, supplyItemId, value) => {
    setAllocations((prev) => ({ ...prev, [`${roomId}_${supplyItemId}`]: value }))
  }

  const getAlloc = (roomId, supplyItemId) => {
    return allocations[`${roomId}_${supplyItemId}`] || ''
  }

  const saveCapture = async () => {
    setSaving(true)
    try {
      const rows = []
      for (const room of rooms) {
        for (const item of supplyItems) {
          const val = parseFloat(getAlloc(room.id, item.id))
          if (val > 0) {
            rows.push({
              supply_item_id: item.id,
              room_id: room.id,
              units_used: val,
              unit_cost: Number(item.latest_unit_cost) || 0,
              total_cost: val * (Number(item.latest_unit_cost) || 0)
            })
          }
        }
      }
      await window.api.supplies.saveAllocations(weekStart, rows)
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 3000)
    } catch (err) {
      alert(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────────

  const reportByRoom = reportData.reduce((acc, a) => {
    const key = a.room_number || a.room_id
    if (!acc[key]) acc[key] = { room_number: a.room_number, total: 0, items: {} }
    acc[key].total += Number(a.total_cost)
    acc[key].items[a.supply_name] = (acc[key].items[a.supply_name] || 0) + Number(a.total_cost)
    return acc
  }, {})

  const reportByItem = reportData.reduce((acc, a) => {
    const key = a.supply_name
    if (!acc[key]) acc[key] = { name: key, unit: a.supply_unit, total_units: 0, total_cost: 0 }
    acc[key].total_units += Number(a.units_used)
    acc[key].total_cost += Number(a.total_cost)
    return acc
  }, {})

  const grandTotal = reportData.reduce((s, a) => s + Number(a.total_cost), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Room Supplies</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track supply usage and cost per room
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['capture', 'Weekly Capture'], ['items', 'Supply Items'], ['report', 'Cost Report']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`px-4 py-2 transition-colors ${tab === v ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Weekly Capture ── */}
      {tab === 'capture' && (
        <div>
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-500 font-medium">Week of</label>
              <input
                type="date"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={weekStart}
                onChange={(e) => setWeekStart(getMondayStr(e.target.value))}
              />
              <span className="text-xs text-gray-400">(auto-snaps to Monday)</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {savedMsg && (
                <span className="text-sm text-green-600 font-medium">✅ Saved!</span>
              )}
              <button
                onClick={saveCapture}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save size={15} /> {saving ? 'Saving...' : 'Save Week'}
              </button>
            </div>
          </div>

          {supplyItems.length === 0 || rooms.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-10 text-center text-gray-400">
              <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {supplyItems.length === 0
                  ? 'No supply items yet. Go to Supply Items tab to add them.'
                  : 'No rooms found.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-auto">
              <table className="text-sm min-w-full">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left sticky left-0 bg-gray-50 z-10 min-w-[120px]">Room</th>
                    {supplyItems.map((item) => (
                      <th key={item.id} className="px-3 py-3 text-center min-w-[110px]">
                        <div>{item.name}</div>
                        <div className="text-gray-400 font-normal normal-case">
                          {item.latest_unit_cost > 0
                            ? `${currency} ${fmt(item.latest_unit_cost, 4)}/${item.unit}`
                            : `(no cost set)`}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right min-w-[90px]">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rooms.map((room) => {
                    const rowTotal = supplyItems.reduce((s, item) => {
                      const units = parseFloat(getAlloc(room.id, item.id)) || 0
                      return s + units * (Number(item.latest_unit_cost) || 0)
                    }, 0)
                    return (
                      <tr key={room.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white">
                          Room {room.room_number}
                          <p className="text-xs text-gray-400 font-normal">{room.room_type}</p>
                        </td>
                        {supplyItems.map((item) => (
                          <td key={item.id} className="px-3 py-2 text-center">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                              value={getAlloc(room.id, item.id)}
                              onChange={(e) => setAlloc(room.id, item.id, e.target.value)}
                              placeholder="0"
                            />
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-semibold text-gray-800">
                          {rowTotal > 0 ? `${currency} ${fmt(rowTotal)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="px-4 py-2 font-semibold text-gray-700 sticky left-0 bg-gray-50">Totals</td>
                    {supplyItems.map((item) => {
                      const colTotal = rooms.reduce((s, room) => {
                        return s + (parseFloat(getAlloc(room.id, item.id)) || 0)
                      }, 0)
                      return (
                        <td key={item.id} className="px-3 py-2 text-center text-xs text-gray-500">
                          {colTotal > 0 ? `${fmt(colTotal, 0)} ${item.unit}s` : '—'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right font-bold text-gray-800">
                      {currency} {fmt(
                        rooms.reduce((rs, room) =>
                          rs + supplyItems.reduce((is, item) =>
                            is + (parseFloat(getAlloc(room.id, item.id)) || 0) * (Number(item.latest_unit_cost) || 0), 0), 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Supply Items ── */}
      {tab === 'items' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Add Supply Item
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loadingItems ? (
              <p className="px-5 py-10 text-center text-gray-400 text-sm">Loading...</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left">Item</th>
                    <th className="px-5 py-3 text-left">Category</th>
                    <th className="px-5 py-3 text-left">Unit</th>
                    <th className="px-5 py-3 text-right">Latest Unit Cost</th>
                    <th className="px-5 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {supplyItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{item.name}</td>
                      <td className="px-5 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-600">{item.unit}</td>
                      <td className="px-5 py-3 text-right">
                        {item.latest_unit_cost > 0 ? (
                          <span className="font-semibold text-green-700">
                            {currency} {fmt(item.latest_unit_cost, 4)}/{item.unit}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">No purchase recorded</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openPurchase(item)}
                            className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                          >
                            + Purchase
                          </button>
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors"
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
                  ))}
                  {supplyItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-gray-400">
                        <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
                        No supply items yet. Add your first item.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Cost Report ── */}
      {tab === 'report' && (
        <div>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-500">From</label>
              <input
                type="date"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={reportStart}
                onChange={(e) => setReportStart(e.target.value)}
              />
              <label className="text-gray-500">To</label>
              <input
                type="date"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={reportEnd}
                onChange={(e) => setReportEnd(e.target.value)}
              />
            </div>
            {grandTotal > 0 && (
              <div className="ml-auto bg-green-50 text-green-800 rounded-lg px-4 py-2 text-sm font-semibold">
                Total Supply Cost: {currency} {fmt(grandTotal)}
              </div>
            )}
          </div>

          {reportLoading ? (
            <p className="text-gray-400 text-sm text-center py-10">Loading...</p>
          ) : reportData.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-10 text-center text-gray-400">
              No allocation data for this period.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Cost per room */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-700 mb-4">Cost per Room</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Room</th>
                      <th className="px-3 py-2 text-right">Supply Cost</th>
                      <th className="px-3 py-2 text-right">% of Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.entries(reportByRoom)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([key, row]) => (
                        <tr key={key} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-800">Room {row.room_number}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">
                            {currency} {fmt(row.total)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">
                            {grandTotal > 0 ? Math.round((row.total / grandTotal) * 100) : 0}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td className="px-3 py-2 font-bold text-gray-800">Total</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800">
                        {currency} {fmt(grandTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Cost per supply item */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-semibold text-gray-700 mb-4">Cost by Supply Item</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Supply Item</th>
                      <th className="px-3 py-2 text-right">Units Used</th>
                      <th className="px-3 py-2 text-right">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.values(reportByItem)
                      .sort((a, b) => b.total_cost - a.total_cost)
                      .map((row) => (
                        <tr key={row.name} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {fmt(row.total_units, 0)} {row.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">
                            {currency} {fmt(row.total_cost)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Item Modal */}
      {itemModal && (
        <Modal
          title={editingItem ? 'Edit Supply Item' : 'Add Supply Item'}
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
                placeholder="e.g. Toilet Paper, Body Wash, Hand Towel"
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
                  {SUPPLY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                <select
                  className="input"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                >
                  {SUPPLY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
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
            <p className="text-xs text-gray-500">
              The unit cost is automatically calculated from the pack/bulk cost. For example: buying
              a 20-roll pack for P10 → P0.50 per roll.
            </p>
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
                  Qty ({purchaseItem.unit}s) *
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  className="input"
                  value={purchaseForm.quantity_purchased}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity_purchased: e.target.value })}
                  required
                  placeholder="e.g. 20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Cost ({currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input"
                  value={purchaseForm.total_cost}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, total_cost: e.target.value })}
                  required
                  placeholder="e.g. 10.00"
                />
              </div>
            </div>
            {unitCostPreview() && (
              <div className="bg-green-50 rounded-lg p-3 text-sm">
                <p className="text-green-800">
                  Auto unit cost: <strong>{currency} {unitCostPreview()}</strong> per {purchaseItem.unit}
                </p>
                <p className="text-green-600 text-xs mt-0.5">
                  This becomes the rate used for room charge calculations.
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
                placeholder="Supplier, receipt number, etc."
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
    </div>
  )
}
