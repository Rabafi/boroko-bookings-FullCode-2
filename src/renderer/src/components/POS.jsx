import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, ShoppingCart, X, ChevronDown, ChevronUp, Scan } from 'lucide-react'
import { Modal } from './shared/Modal'
import { useSettings } from '../app-context'

const MENU_CATEGORIES = ['Food', 'Drinks', 'Other']

const today = () => new Date().toISOString().split('T')[0]

function fmt(v) {
  return Number(v || 0).toFixed(2)
}

export default function POS() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'

  const [tab, setTab] = useState('terminal') // terminal | menu | history

  // Menu items
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(false)

  // Current order (terminal)
  const [orderItems, setOrderItems] = useState([])
  const [customerType, setCustomerType] = useState('room') // room | walkin
  const [rooms, setRooms] = useState([])
  const [selectedRoom, setSelectedRoom] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash') // cash | card
  const [submitting, setSubmitting] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)

  // Barcode scanner
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)
  const [barcodeFlash, setBarcodeFlash] = useState(null) // null | { name, found }

  // Order history
  const [orders, setOrders] = useState([])
  const [histStart, setHistStart] = useState(today())
  const [histEnd, setHistEnd] = useState(today())
  const [expandedOrder, setExpandedOrder] = useState(null)

  // Inventory items (for depletion linking)
  const [inventoryItems, setInventoryItems] = useState([])

  // Menu item form modal
  const [menuModal, setMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [menuForm, setMenuForm] = useState({
    name: '', category: 'Food', price: '', barcode: '',
    inventory_item_id: '', depletion_qty: '1'
  })
  const [menuSaving, setMenuSaving] = useState(false)
  const [menuError, setMenuError] = useState('')

  useEffect(() => {
    loadMenu()
    loadRooms()
    window.api.inventory.getItems().then((d) => setInventoryItems(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'history') loadOrders()
  }, [tab, histStart, histEnd])

  // ── Barcode scanner listener (only active on terminal tab) ──────────────────
  useEffect(() => {
    if (tab !== 'terminal') return

    const handleKeyDown = (e) => {
      // Don't hijack input fields — let user type normally in text inputs
      const activeTag = document.activeElement?.tagName
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return

      if (e.key === 'Enter') {
        const code = barcodeBufferRef.current.trim()
        barcodeBufferRef.current = ''
        if (barcodeTimerRef.current) {
          clearTimeout(barcodeTimerRef.current)
          barcodeTimerRef.current = null
        }
        if (code.length >= 4) {
          const found = menuItems.find((m) => m.barcode === code && m.is_available)
          if (found) {
            addToOrder(found)
            setBarcodeFlash({ name: found.name, found: true })
          } else {
            setBarcodeFlash({ name: code, found: false })
          }
          setTimeout(() => setBarcodeFlash(null), 2500)
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key
        // Reset buffer if no follow-up within 80ms (scanners fire much faster than humans type)
        if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
        barcodeTimerRef.current = setTimeout(() => {
          barcodeBufferRef.current = ''
        }, 80)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current)
      barcodeBufferRef.current = ''
    }
  }, [tab, menuItems])

  const loadMenu = async () => {
    setMenuLoading(true)
    const data = await window.api.pos.getMenuItems().catch(() => [])
    setMenuItems(data || [])
    setMenuLoading(false)
  }

  const loadRooms = async () => {
    const data = await window.api.rooms.getAll().catch(() => [])
    setRooms((data || []).filter((r) => r.status !== 'maintenance'))
  }

  const loadOrders = async () => {
    const data = await window.api.pos.getOrders(histStart, histEnd).catch(() => [])
    setOrders(data || [])
  }

  // ── Terminal ────────────────────────────────────────────────────────────────

  const addToOrder = (item) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.menu_item_id === item.id)
      if (existing) {
        return prev.map((i) =>
          i.menu_item_id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      }
      return [...prev, { menu_item_id: item.id, item_name: item.name, unit_price: item.price, quantity: 1 }]
    })
  }

  const updateQty = (idx, delta) => {
    setOrderItems((prev) => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + delta }
      if (updated[idx].quantity <= 0) updated.splice(idx, 1)
      return updated
    })
  }

  const orderTotal = orderItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)

  const completeOrder = async () => {
    if (orderItems.length === 0) return
    if (customerType === 'room' && !selectedRoom) { alert('Select a room first.'); return }
    if (customerType === 'walkin' && !walkInName.trim()) { alert('Enter the guest name.'); return }

    setSubmitting(true)
    try {
      const result = await window.api.pos.createOrder({
        room_id: customerType === 'room' ? selectedRoom : null,
        walk_in_name: customerType === 'walkin' ? walkInName.trim() : null,
        items: orderItems,
        notes: orderNotes.trim() || null,
        payment_method: customerType === 'room' ? 'folio' : paymentMethod
      })
      if (result?.success) {
        setOrderItems([])
        setWalkInName('')
        setOrderNotes('')
        setPaymentMethod('cash')
        setOrderSuccess(true)
        setTimeout(() => setOrderSuccess(false), 3000)
      } else {
        alert(result?.error || 'Failed to complete order. Please try again.')
      }
    } catch (err) {
      alert(err.message || 'Failed to complete order. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Menu management ─────────────────────────────────────────────────────────

  const openCreateMenu = () => {
    setEditingItem(null)
    setMenuForm({ name: '', category: 'Food', price: '', barcode: '', inventory_item_id: '', depletion_qty: '1' })
    setMenuError('')
    setMenuModal(true)
  }

  const openEditMenu = (item) => {
    setEditingItem(item)
    setMenuForm({
      name: item.name,
      category: item.category,
      price: String(item.price),
      barcode: item.barcode || '',
      inventory_item_id: item.inventory_item_id || '',
      depletion_qty: item.depletion_qty != null ? String(item.depletion_qty) : '1'
    })
    setMenuError('')
    setMenuModal(true)
  }

  const handleMenuSubmit = async (e) => {
    e.preventDefault()
    setMenuError('')
    setMenuSaving(true)
    try {
      const payload = { ...menuForm, price: parseFloat(menuForm.price) }
      if (editingItem) {
        await window.api.pos.updateMenuItem(editingItem.id, { ...payload, is_available: editingItem.is_available })
      } else {
        await window.api.pos.createMenuItem(payload)
      }
      setMenuModal(false)
      loadMenu()
    } catch (err) {
      setMenuError(err.message || 'Save failed. Please try again.')
    } finally {
      setMenuSaving(false)
    }
  }

  const toggleAvailable = async (item) => {
    try {
      await window.api.pos.updateMenuItem(item.id, { ...item, is_available: !item.is_available })
      loadMenu()
    } catch (err) {
      alert(err.message || 'Failed to update item.')
    }
  }

  const deleteMenuItem = async (item) => {
    if (!confirm(`Delete "${item.name}"?`)) return
    try {
      await window.api.pos.deleteMenuItem(item.id)
      loadMenu()
    } catch (err) {
      alert(err.message || 'Failed to delete item.')
    }
  }

  const menuByCategory = MENU_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = menuItems.filter((m) => m.category === cat)
    return acc
  }, {})

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Point of Sale</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bar & Kitchen orders</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['terminal', 'Terminal'], ['menu', 'Menu Items'], ['history', 'History']].map(([v, l]) => (
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

      {/* ── Terminal ── */}
      {tab === 'terminal' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Menu items panel */}
          <div className="xl:col-span-2 space-y-5">
            {/* Barcode scanner feedback banner */}
            {barcodeFlash && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 ${
                barcodeFlash.found
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-700'
              }`}>
                <Scan size={16} />
                {barcodeFlash.found
                  ? `✓ Scanned: ${barcodeFlash.name} added to order`
                  : `✗ Barcode "${barcodeFlash.name}" not found in menu`}
              </div>
            )}

            {menuLoading ? (
              <p className="text-gray-400 text-sm">Loading menu...</p>
            ) : (
              MENU_CATEGORIES.map((cat) => {
                const items = menuByCategory[cat].filter((m) => m.is_available)
                if (items.length === 0) return null
                return (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{cat}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => addToOrder(item)}
                          className="bg-white rounded-xl p-3 text-left shadow-sm hover:shadow-md hover:ring-2 hover:ring-green-400 transition-all border border-gray-100"
                        >
                          <p className="font-medium text-gray-800 text-sm truncate">{item.name}</p>
                          <p className="text-green-700 font-semibold text-sm mt-0.5">
                            {currency} {fmt(item.price)}
                          </p>
                          {item.barcode && (
                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                              <Scan size={10} /> {item.barcode}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
            {menuItems.filter((m) => m.is_available).length === 0 && !menuLoading && (
              <div className="bg-white rounded-xl p-10 text-center text-gray-400 shadow-sm">
                <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No menu items yet. Go to Menu Items tab to add them.</p>
              </div>
            )}

            {/* Barcode scanner hint */}
            {menuItems.some((m) => m.barcode && m.is_available) && (
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Scan size={12} /> Barcode scanner ready — click outside inputs and scan
              </p>
            )}
          </div>

          {/* Order panel */}
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col h-fit sticky top-6">
            <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <ShoppingCart size={16} /> Current Order
            </h2>

            {/* Customer type */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs mb-3">
              <button
                onClick={() => setCustomerType('room')}
                className={`flex-1 py-1.5 transition-colors ${customerType === 'room' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Room Guest
              </button>
              <button
                onClick={() => setCustomerType('walkin')}
                className={`flex-1 py-1.5 transition-colors ${customerType === 'walkin' ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Walk-in
              </button>
            </div>

            {customerType === 'room' ? (
              <select
                className="input mb-3 text-sm"
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
              >
                <option value="">Select room...</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room_number} — {r.room_type}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  className="input mb-2 text-sm"
                  placeholder="Guest name..."
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                />
                {/* Payment method for walk-in */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs mb-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`flex-1 py-1.5 transition-colors ${paymentMethod === 'cash' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`flex-1 py-1.5 transition-colors ${paymentMethod === 'card' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    💳 Card Swipe
                  </button>
                </div>
              </>
            )}

            {/* Order items */}
            <div className="flex-1 space-y-2 min-h-[80px] mb-3">
              {orderItems.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  Tap items or scan barcodes to add them
                </p>
              ) : (
                orderItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{item.item_name}</p>
                      <p className="text-xs text-gray-400">{currency} {fmt(item.unit_price)} ea</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQty(idx, -1)}
                        className="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 text-sm font-bold flex items-center justify-center"
                      >−</button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(idx, 1)}
                        className="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-600 text-sm font-bold flex items-center justify-center"
                      >+</button>
                    </div>
                    <span className="text-sm font-semibold text-gray-800 w-16 text-right shrink-0">
                      {currency} {fmt(item.quantity * item.unit_price)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {orderItems.length > 0 && (
              <>
                <textarea
                  className="input text-sm mb-3 resize-none"
                  rows={2}
                  placeholder="Notes (optional)..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                />
                <div className="border-t border-gray-100 pt-3 mb-3">
                  <div className="flex justify-between font-bold text-gray-800">
                    <span>Total</span>
                    <span>{currency} {fmt(orderTotal)}</span>
                  </div>
                  {customerType === 'room' && selectedRoom ? (
                    <p className="text-xs text-green-600 mt-1">Will be added to room booking folio</p>
                  ) : customerType === 'walkin' && (
                    <p className="text-xs text-blue-600 mt-1">
                      {paymentMethod === 'cash' ? '💵 Cash payment' : '💳 Card swipe'}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOrderItems([])}
                    className="btn-secondary flex-1 flex items-center justify-center gap-1"
                  >
                    <X size={14} /> Clear
                  </button>
                  <button
                    onClick={completeOrder}
                    disabled={submitting}
                    className="btn-primary flex-1"
                  >
                    {submitting ? 'Processing...' : 'Complete Order'}
                  </button>
                </div>
              </>
            )}

            {orderSuccess && (
              <div className="mt-3 p-3 bg-green-50 rounded-lg text-xs text-green-700 text-center">
                ✅ Order completed successfully
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Menu Management ── */}
      {tab === 'menu' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={openCreateMenu} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Add Menu Item
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">Item</th>
                  <th className="px-5 py-3 text-left">Category</th>
                  <th className="px-5 py-3 text-left">Barcode</th>
                  <th className="px-5 py-3 text-left">Stock Link</th>
                  <th className="px-5 py-3 text-right">Price</th>
                  <th className="px-5 py-3 text-center">Available</th>
                  <th className="px-5 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {menuItems.map((item) => {
                  const linkedInv = item.inventory_item_id
                    ? inventoryItems.find((i) => i.id === item.inventory_item_id)
                    : null
                  return (
                  <tr key={item.id} className={`hover:bg-gray-50 ${!item.is_available ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3 font-medium text-gray-800">{item.name}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs font-mono">
                      {item.barcode || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {linkedInv ? (
                        <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
                          📦 {linkedInv.name} ×{item.depletion_qty || 1}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">
                      {currency} {fmt(item.price)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => toggleAvailable(item)}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${item.is_available ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${item.is_available ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEditMenu(item)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteMenuItem(item)} className="p-1.5 text-red-400 hover:bg-red-50 rounded">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
                {menuItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                      No menu items yet. Add your first item.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <div>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-500">From</label>
              <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={histStart} onChange={(e) => setHistStart(e.target.value)} />
              <label className="text-gray-500">To</label>
              <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={histEnd} onChange={(e) => setHistEnd(e.target.value)} />
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {orders.length === 0 ? (
              <p className="px-5 py-12 text-center text-gray-400 text-sm">No orders in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left">Time</th>
                    <th className="px-5 py-3 text-left">Customer</th>
                    <th className="px-5 py-3 text-left">Payment</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-center">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orders.map((o) => (
                    <>
                      <tr
                        key={o.id}
                        className={`hover:bg-gray-50 cursor-pointer ${o.status === 'voided' ? 'opacity-50' : ''}`}
                        onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}
                      >
                        <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                          {new Date(o.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-gray-800">
                          {o.walk_in_name
                            ? o.walk_in_name
                            : o.room_id
                            ? 'Room Guest'
                            : '—'}
                        </td>
                        <td className="px-5 py-3">
                          {o.payment_method === 'cash' && <span className="text-xs text-gray-600">💵 Cash</span>}
                          {o.payment_method === 'card' && <span className="text-xs text-gray-600">💳 Card</span>}
                          {o.payment_method === 'folio' && <span className="text-xs text-green-600">📋 Folio</span>}
                          {!o.payment_method && <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            o.status === 'completed' ? 'bg-green-100 text-green-700' :
                            o.status === 'voided' ? 'bg-red-100 text-red-600' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{o.status}</span>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-800">
                          {currency} {fmt(o.total)}
                        </td>
                        <td className="px-5 py-3 text-center text-gray-400">
                          {expandedOrder === o.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                      </tr>
                      {expandedOrder === o.id && (
                        <tr key={`${o.id}-exp`}>
                          <td colSpan={6} className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
                                  <th className="text-left py-1 pr-4">Item</th>
                                  <th className="text-center py-1 pr-4">Qty</th>
                                  <th className="text-right py-1 pr-4">Unit Price</th>
                                  <th className="text-right py-1">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(o.pos_order_items || []).map((li) => (
                                  <tr key={li.id} className="border-t border-gray-100">
                                    <td className="py-1 pr-4 text-gray-700">{li.item_name}</td>
                                    <td className="py-1 pr-4 text-center text-gray-600">{li.quantity}</td>
                                    <td className="py-1 pr-4 text-right text-gray-600">{currency} {fmt(li.unit_price)}</td>
                                    <td className="py-1 text-right font-medium text-gray-800">{currency} {fmt(li.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {o.notes && (
                              <p className="mt-2 text-xs text-gray-500 italic border-t border-gray-100 pt-2">
                                📝 {o.notes}
                              </p>
                            )}
                            {o.status !== 'voided' && (
                              <button
                                onClick={async () => {
                                  if (!confirm('Void this order?')) return
                                  try { await window.api.pos.voidOrder(o.id) } catch {}
                                  loadOrders()
                                }}
                                className="mt-2 text-xs text-red-500 hover:text-red-700"
                              >
                                Void Order
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Menu Item Modal */}
      {menuModal && (
        <Modal
          title={editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
          onClose={() => { if (!menuSaving) setMenuModal(false) }}
          size="sm"
        >
          <form onSubmit={handleMenuSubmit} className="space-y-4">
            {menuError && (
              <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">
                {menuError}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                className="input"
                value={menuForm.name}
                onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })}
                required
                placeholder="e.g. Beef Stew, Castle Lager"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  className="input"
                  value={menuForm.category}
                  onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })}
                >
                  {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price ({currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={menuForm.price}
                  onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value })}
                  required
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Barcode <span className="text-gray-400 font-normal">(optional — scan or type)</span>
              </label>
              <div className="relative">
                <Scan size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  className="input pl-9 font-mono"
                  value={menuForm.barcode}
                  onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })}
                  placeholder="Scan barcode or enter manually"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Click this field and scan with your barcode scanner to auto-fill.
              </p>
            </div>

            {/* Inventory depletion link */}
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inventory Stock Link <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                className="input"
                value={menuForm.inventory_item_id}
                onChange={(e) => setMenuForm({ ...menuForm, inventory_item_id: e.target.value })}
              >
                <option value="">— No inventory link —</option>
                {inventoryItems.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name} ({inv.unit}) — {inv.current_stock} in stock
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                When this item is sold, it will automatically deduct stock.
              </p>
              {menuForm.inventory_item_id && (
                <div className="mt-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units depleted per sale</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input"
                    value={menuForm.depletion_qty}
                    onChange={(e) => setMenuForm({ ...menuForm, depletion_qty: e.target.value })}
                    placeholder="1"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    e.g. 1 for a full bottle, 0.5 for a half-measure
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMenuModal(false)}
                disabled={menuSaving}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button type="submit" disabled={menuSaving} className="btn-primary flex-1">
                {menuSaving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
