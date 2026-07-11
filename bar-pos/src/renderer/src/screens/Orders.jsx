import { useState, useEffect } from 'react'
import { Search, X, RotateCcw, ArrowLeft } from 'lucide-react'

const CURRENCY = 'P'
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Orders({ user }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadOrders() }, [])

  async function loadOrders() {
    setLoading(true)
    try {
      const items = await window.barAPI.getOrders({})
      setOrders(items)
    } catch { setOrders([]) }
    finally { setLoading(false) }
  }

  const filtered = search.trim()
    ? orders.filter(o =>
        o.id?.toLowerCase().includes(search.toLowerCase()) ||
        (o.items || []).some(i => (i.item_name || '').toLowerCase().includes(search.toLowerCase()))
      )
    : orders

  async function handleVoid(orderId) {
    if (!voidReason.trim()) return
    setBusy(true)
    try {
      await window.barAPI.voidOrder(orderId, voidReason, user?.id)
      setSelectedOrder(null)
      setVoidReason('')
      loadOrders()
    } catch (err) {
      alert('Void failed: ' + (err?.message || ''))
    } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b border-stone-800">
          <h1 className="text-base font-semibold">Orders</h1>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders..." className="w-full pl-8 pr-3 py-1.5 text-xs" />
          </div>
          <button onClick={loadOrders} className="btn-ghost text-xs px-2 py-1">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-stone-500">{orders.length} total</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-stone-600 text-sm">
              {search ? 'No matching orders' : 'No orders yet'}
            </div>
          ) : (
            <div className="p-3 space-y-1.5">
              {filtered.map(order => {
                const itemCount = (order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)
                return (
                  <div
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                      ${order.status === 'voided' ? 'bg-red-900/10 opacity-60' : 'hover:bg-stone-800/40 bg-stone-800/20'}
                      ${selectedOrder?.id === order.id ? 'ring-1 ring-brand-700' : ''}
                    `}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-200 truncate">
                        {(order.items || []).map(i => i.item_name).join(', ') || 'Order'}
                      </div>
                      <div className="text-[10px] text-stone-600 font-mono">
                        {order.id?.slice(0, 8)} — {new Date(order.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono text-stone-200">P{fmt(order.total)}</div>
                      <div className="text-[10px] text-stone-600">{itemCount} item{itemCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div>
                      {(order.payments || []).map(p => (
                        <span key={p.method} className="badge-stone text-[10px]">{p.method}</span>
                      ))}
                    </div>
                    {order.status === 'voided' && (
                      <span className="badge-red text-[10px]">Voided</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Void detail panel */}
      {selectedOrder && selectedOrder.status !== 'voided' && (
        <div className="w-80 bg-stone-900/50 border-l border-stone-800 p-4 shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Void Order</h2>
            <button onClick={() => { setSelectedOrder(null); setVoidReason('') }} className="text-stone-500 hover:text-stone-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-sm text-stone-400 mb-4">
            <p>Total: <span className="text-stone-200 font-mono">P{fmt(selectedOrder.total)}</span></p>
            <p>Items: {(selectedOrder.items || []).map(i => `${i.item_name} x${i.quantity}`).join(', ')}</p>
            <p>Time: {new Date(selectedOrder.created_at).toLocaleString()}</p>
          </div>

          <div className="input-group">
            <label>Reason for void</label>
            <textarea
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder="Customer changed mind, wrong item..."
              rows={3}
              className="w-full resize-none"
            />
          </div>

          <button
            onClick={() => handleVoid(selectedOrder.id)}
            disabled={busy || !voidReason.trim()}
            className="btn-danger w-full mt-4"
          >
            {busy ? 'Voiding...' : 'Void Order'}
          </button>
        </div>
      )}
    </div>
  )
}
