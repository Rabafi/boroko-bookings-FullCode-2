import { useState, useEffect } from 'react'
import { Plus, Pencil, X } from 'lucide-react'

export default function RestaurantCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' })

  useEffect(() => { loadCustomers() }, [])

  async function loadCustomers() {
    try {
      setLoading(true)
      const data = await window.api.pos.getCustomers()
      setCustomers(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load customers:', err)
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setEditingCustomer(null)
    setForm({ name: '', phone: '', email: '', notes: '' })
    setShowForm(true)
  }

  function openEdit(c) {
    setEditingCustomer(c)
    setForm({ name: c.name || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '' })
    setShowForm(true)
  }

  async function saveCustomer() {
    if (!form.name.trim()) return
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, notes: form.notes.trim() || null }
      if (editingCustomer) payload.id = editingCustomer.id
      await window.api.pos.saveCustomer(payload)
      setShowForm(false)
      setEditingCustomer(null)
      await loadCustomers()
    } catch (err) {
      console.error('Failed to save customer:', err)
    }
  }

  const filtered = customers.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers & Loyalty</h1>
          <p className="text-sm text-gray-500 mt-1">Customer directory, loyalty points, and account balances</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openNew} className="bb-btn-primary text-sm flex items-center gap-1.5">
            <Plus size={14} /> Add Customer
          </button>
          <button onClick={loadCustomers} className="bb-btn-outline text-sm">Refresh</button>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="w-80 flex-shrink-0">
          <input
            type="text"
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bb-input w-full mb-4"
          />
          <div className="bb-card divide-y max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No customers found</div>
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition ${selected?.id === c.id ? 'bg-emerald-50' : ''}`}
              >
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-gray-500">{c.phone || c.email || ''}</div>
                <div className="flex gap-3 mt-1 text-xs">
                  <span className="text-amber-600">{c.loyalty_points || 0} pts</span>
                  <span className="text-gray-400">${Number(c.total_spent || 0).toFixed(2)} spent</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {selected ? (
            <div className="bb-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <button onClick={() => openEdit(selected)} className="bb-btn-outline text-xs flex items-center gap-1"><Pencil size={12} /> Edit</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <div className="text-xs text-gray-500">Phone</div>
                  <div className="text-sm">{selected.phone || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Email</div>
                  <div className="text-sm">{selected.email || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Visits</div>
                  <div className="text-sm font-medium">{selected.visit_count || 0}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Last Order</div>
                  <div className="text-sm">{selected.last_order_at ? new Date(selected.last_order_at).toLocaleDateString() : '-'}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-amber-50 rounded-lg p-4">
                  <div className="text-xs text-amber-600 mb-1">Loyalty Points</div>
                  <div className="text-2xl font-bold text-amber-700">{selected.loyalty_points || 0}</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-xs text-blue-600 mb-1">Total Spent</div>
                  <div className="text-2xl font-bold text-blue-700">${Number(selected.total_spent || 0).toFixed(2)}</div>
                </div>
              </div>
              {selected.notes && (
                <div className="mt-4 text-sm text-gray-600 bg-gray-50 rounded p-3">
                  {selected.notes}
                </div>
              )}
            </div>
          ) : (
            <div className="bb-card p-12 text-center text-gray-500">
              Select a customer to view details
            </div>
          )}
        </div>
      </div>

      {/* Customer form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingCustomer ? 'Edit Customer' : 'Add Customer'}</h2>
              <button onClick={() => { setShowForm(false); setEditingCustomer(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bb-input w-full mt-1" placeholder="Customer name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Email</label>
                  <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bb-input w-full mt-1" rows={2} placeholder="e.g. loyalty member" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowForm(false); setEditingCustomer(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={saveCustomer} disabled={!form.name.trim()} className="bb-btn-primary flex-1">{editingCustomer ? 'Save Changes' : 'Add Customer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
