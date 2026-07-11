import { useState, useEffect } from 'react'
import { Plus, Pencil, X, CheckCircle2, Package } from 'lucide-react'

export default function RestaurantPurchasing() {
  const [suppliers, setSuppliers] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('orders')
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [showPOForm, setShowPOForm] = useState(false)
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '', email: '', category: '' })
  const [poForm, setPoForm] = useState({ supplier_id: '', notes: '', items: [{ description: '', quantity: '', unit_cost: '' }] })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [s, o] = await Promise.all([
        window.api.pos.getSuppliers(),
        window.api.pos.getPurchaseOrders ? window.api.pos.getPurchaseOrders() : Promise.resolve([])
      ])
      setSuppliers(Array.isArray(s) ? s : [])
      setOrders(Array.isArray(o) ? o : [])
    } catch (err) {
      console.error('Failed to load purchasing data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) return
    try {
      await window.api.pos.createSupplier({
        name: supplierForm.name.trim(),
        contact_person: supplierForm.contact_person.trim() || null,
        phone: supplierForm.phone.trim() || null,
        email: supplierForm.email.trim() || null,
        category: supplierForm.category.trim() || null
      })
      setShowSupplierForm(false)
      setSupplierForm({ name: '', contact_person: '', phone: '', email: '', category: '' })
      await loadData()
    } catch (err) {
      console.error('Failed to save supplier:', err)
    }
  }

  async function savePO() {
    if (!poForm.items.some(i => i.description.trim())) return
    try {
      await window.api.pos.createPurchaseOrder({
        supplier_id: poForm.supplier_id || null,
        notes: poForm.notes.trim() || null,
        items: poForm.items.filter(i => i.description.trim()).map(i => ({
          description: i.description.trim(),
          quantity: Number(i.quantity) || 1,
          unit_cost: Number(i.unit_cost) || 0
        }))
      })
      setShowPOForm(false)
      setPoForm({ supplier_id: '', notes: '', items: [{ description: '', quantity: '', unit_cost: '' }] })
      await loadData()
    } catch (err) {
      console.error('Failed to create PO:', err)
    }
  }

  async function approveOrder(orderId) {
    try {
      await window.api.pos.approvePurchaseOrder(orderId)
      await loadData()
    } catch (err) {
      console.error('Failed to approve order:', err)
    }
  }

  async function receiveOrder(orderId) {
    try {
      await window.api.pos.receivePurchaseOrder(orderId)
      await loadData()
    } catch (err) {
      console.error('Failed to receive order:', err)
    }
  }

  const statusBadge = (s) => {
    const colors = {
      draft: 'bg-gray-100 text-gray-600',
      pending: 'bg-amber-100 text-amber-700',
      approved: 'bg-blue-100 text-blue-700',
      received: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-red-100 text-red-700'
    }
    return colors[s] || 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchasing</h1>
          <p className="text-sm text-gray-500 mt-1">Suppliers, purchase orders, and receiving</p>
        </div>
        <div className="flex gap-2">
          {tab === 'suppliers' ? (
            <button onClick={() => { setShowSupplierForm(true); setSupplierForm({ name: '', contact_person: '', phone: '', email: '', category: '' }) }} className="bb-btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> Add Supplier
            </button>
          ) : (
            <button onClick={() => { setShowPOForm(true); setPoForm({ supplier_id: '', notes: '', items: [{ description: '', quantity: '', unit_cost: '' }] }) }} className="bb-btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> New PO
            </button>
          )}
          <button onClick={loadData} className="bb-btn-outline text-sm">Refresh</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {['orders', 'suppliers'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'orders' ? `Purchase Orders (${orders.length})` : `Suppliers (${suppliers.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : tab === 'orders' ? (
        orders.length === 0 ? (
          <div className="bb-card p-12 text-center">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-lg mb-2">No purchase orders</p>
            <p className="text-gray-400 text-sm">Click "New PO" to create a purchase order</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(o => (
              <div key={o.id} className="bb-card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">#{String(o.id).slice(0, 8)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusBadge(o.status)}`}>{o.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {o.supplier?.name || o.supplier_name || 'No supplier'} {o.created_at ? `- ${new Date(o.created_at).toLocaleDateString()}` : ''}
                      {o.total ? ` - $${Number(o.total).toFixed(2)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.status === 'draft' && (
                      <button onClick={() => approveOrder(o.id)} className="bb-btn-primary text-xs">Approve</button>
                    )}
                    {o.status === 'approved' && (
                      <button onClick={() => receiveOrder(o.id)} className="bb-btn-primary text-xs bg-emerald-600 hover:bg-emerald-700">Receive</button>
                    )}
                  </div>
                </div>
                {o.items?.length > 0 && (
                  <div className="mt-2 pt-2 border-t divide-y text-sm">
                    {o.items.map((item, i) => (
                      <div key={i} className="py-1.5 flex justify-between text-gray-600">
                        <span>{item.description || item.name || 'Item'}</span>
                        <span>{item.quantity} x ${Number(item.unit_cost || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        suppliers.length === 0 ? (
          <div className="bb-card p-12 text-center">
            <p className="text-gray-500 text-lg mb-2">No suppliers configured</p>
            <p className="text-gray-400 text-sm">Click "Add Supplier" to add your first supplier</p>
          </div>
        ) : (
          <div className="divide-y bb-card">
            {suppliers.map(s => (
              <div key={s.id} className="px-4 py-3">
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {[s.contact_person, s.phone, s.email, s.category].filter(Boolean).join(' | ')}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Supplier form modal */}
      {showSupplierForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Add Supplier</h2>
              <button onClick={() => setShowSupplierForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name *</label>
                <input value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} className="bb-input w-full mt-1" placeholder="Supplier name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Contact Person</label>
                  <input value={supplierForm.contact_person} onChange={e => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone</label>
                  <input value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Email</label>
                  <input value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Category</label>
                  <input value={supplierForm.category} onChange={e => setSupplierForm({ ...supplierForm, category: e.target.value })} className="bb-input w-full mt-1" placeholder="produce, meat..." />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowSupplierForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveSupplier} disabled={!supplierForm.name.trim()} className="bb-btn-primary flex-1">Save Supplier</button>
            </div>
          </div>
        </div>
      )}

      {/* PO form modal */}
      {showPOForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Purchase Order</h2>
              <button onClick={() => setShowPOForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Supplier</label>
                <select value={poForm.supplier_id} onChange={e => setPoForm({ ...poForm, supplier_id: e.target.value })} className="bb-input w-full mt-1">
                  <option value="">Select supplier (optional)</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <input value={poForm.notes} onChange={e => setPoForm({ ...poForm, notes: e.target.value })} className="bb-input w-full mt-1" placeholder="Order notes" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Line Items</label>
                  <button onClick={() => setPoForm({ ...poForm, items: [...poForm.items, { description: '', quantity: '', unit_cost: '' }] })} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12} /> Add Line</button>
                </div>
                <div className="space-y-2">
                  {poForm.items.map((item, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={item.description} onChange={e => { const updated = [...poForm.items]; updated[i] = { ...updated[i], description: e.target.value }; setPoForm({ ...poForm, items: updated }) }} className="bb-input flex-1" placeholder="Description" />
                      <input value={item.quantity} onChange={e => { const updated = [...poForm.items]; updated[i] = { ...updated[i], quantity: e.target.value }; setPoForm({ ...poForm, items: updated }) }} type="number" className="bb-input w-16" placeholder="Qty" />
                      <input value={item.unit_cost} onChange={e => { const updated = [...poForm.items]; updated[i] = { ...updated[i], unit_cost: e.target.value }; setPoForm({ ...poForm, items: updated }) }} type="number" step="0.01" className="bb-input w-24" placeholder="Unit cost" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPOForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={savePO} disabled={!poForm.items.some(i => i.description.trim())} className="bb-btn-primary flex-1">Create PO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
