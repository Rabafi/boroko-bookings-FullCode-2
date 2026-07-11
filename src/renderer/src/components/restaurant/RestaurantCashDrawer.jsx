import { useState, useEffect } from 'react'
import { Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react'

export default function RestaurantCashDrawer() {
  const [drawer, setDrawer] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [floatAmount, setFloatAmount] = useState('')
  const [closingTotal, setClosingTotal] = useState('')
  const [declaredTotal, setDeclaredTotal] = useState('')
  const [todaySales, setTodaySales] = useState({ cash: 0, card: 0, other: 0, total: 0 })

  useEffect(() => { loadDrawer() }, [])

  async function loadDrawer() {
    try {
      setLoading(true)
      const [d, h, orders] = await Promise.allSettled([
        window.api.pos.getOpenCashDrawer(),
        window.api.pos.getCashups ? window.api.pos.getCashups() : Promise.resolve([]),
        window.api.pos.getOrders(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10))
      ])
      setDrawer(d.value || null)
      setHistory(Array.isArray(h.value) ? h.value : [])

      const todayOrders = Array.isArray(orders.value) ? orders.value : []
      const cash = todayOrders.filter(o => (o.payment_method || '').toLowerCase() === 'cash').reduce((s, o) => s + (o.total || o.amount || 0), 0)
      const card = todayOrders.filter(o => (o.payment_method || '').toLowerCase() === 'card').reduce((s, o) => s + (o.total || o.amount || 0), 0)
      const other = todayOrders.filter(o => !['cash', 'card'].includes((o.payment_method || '').toLowerCase())).reduce((s, o) => s + (o.total || o.amount || 0), 0)
      setTodaySales({ cash, card, other, total: cash + card + other })
    } catch (err) {
      console.error('Failed to load cash drawer:', err)
    } finally {
      setLoading(false)
    }
  }

  async function openDrawer() {
    try {
      await window.api.pos.openCashDrawerSession({ openingFloat: Number(floatAmount) || 0 })
      setFloatAmount('')
      await loadDrawer()
    } catch (err) {
      console.error('Failed to open drawer:', err)
    }
  }

  async function closeDrawer() {
    if (!drawer?.id) return
    try {
      await window.api.pos.closeCashDrawerSession({
        sessionId: drawer.id,
        closingTotal: Number(closingTotal) || 0,
        declaredTotal: declaredTotal ? Number(declaredTotal) : undefined
      })
      setClosingTotal('')
      setDeclaredTotal('')
      await loadDrawer()
    } catch (err) {
      console.error('Failed to close drawer:', err)
    }
  }

  const expectedCash = (Number(drawer?.opening_float || 0) + todaySales.cash).toFixed(2)
  const variance = declaredTotal ? (Number(declaredTotal) - Number(expectedCash)).toFixed(2) : null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Drawer</h1>
          <p className="text-sm text-gray-500 mt-1">Open, manage, and close cash drawer sessions</p>
        </div>
        <button onClick={loadDrawer} className="bb-btn-outline text-sm">Refresh</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {drawer ? (
            <>
              <div className="bb-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Wallet size={18} className="text-emerald-600" /> Open Drawer
                  </h2>
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <CheckCircle2 size={14} /> Active
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-gray-500">Float</div>
                    <div className="font-medium">${Number(drawer.opening_float || 0).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Opened</div>
                    <div className="font-medium text-sm">{drawer.opened_at ? new Date(drawer.opened_at).toLocaleTimeString() : '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Cashier</div>
                    <div className="font-medium text-sm">{drawer.cashier_name || 'Current user'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Expected Cash</div>
                    <div className="font-bold text-emerald-600">${expectedCash}</div>
                  </div>
                </div>

                {/* Expected cash breakdown */}
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Expected Cash Breakdown</h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Float: </span>
                      <span className="font-medium">${Number(drawer.opening_float || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">+ Cash Sales: </span>
                      <span className="font-medium">${todaySales.cash.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">= Expected: </span>
                      <span className="font-bold">${expectedCash}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs text-gray-400 mt-2">
                    <div>Card: ${todaySales.card.toFixed(2)}</div>
                    <div>Other: ${todaySales.other.toFixed(2)}</div>
                    <div>Total Sales: ${todaySales.total.toFixed(2)}</div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium text-sm mb-2">Close Drawer</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Closing Total (counted)</label>
                      <input type="number" placeholder="Total counted" value={closingTotal} onChange={e => setClosingTotal(e.target.value)} className="bb-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Declared Cash (optional)</label>
                      <input type="number" placeholder="Cash counted" value={declaredTotal} onChange={e => setDeclaredTotal(e.target.value)} className="bb-input w-full mt-1" />
                    </div>
                    <div className="flex items-end">
                      <button onClick={closeDrawer} className="bb-btn-primary w-full">Close Drawer</button>
                    </div>
                  </div>
                  {variance != null && (
                    <div className={`mt-2 text-sm flex items-center gap-1 ${Number(variance) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(variance) !== 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                      Variance: ${variance} {Number(variance) === 0 ? '(balanced)' : Number(variance) > 0 ? '(over)' : '(short)'}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="bb-card p-5">
              <h2 className="font-semibold mb-3">Open New Drawer</h2>
              <div className="flex gap-3">
                <input type="number" placeholder="Opening float amount" value={floatAmount} onChange={e => setFloatAmount(e.target.value)} className="bb-input" />
                <button onClick={openDrawer} className="bb-btn-primary">Open Drawer</button>
              </div>
            </div>
          )}

          <div className="bb-card">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Recent Cash-Ups ({history.length})</h2>
            </div>
            {history.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No cash-up history</div>
            ) : (
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {history.slice(0, 20).map(c => (
                  <div key={c.id} className="px-4 py-3 flex justify-between text-sm">
                    <div>
                      <div className="font-medium">{c.closed_at ? new Date(c.closed_at).toLocaleDateString() : '-'}</div>
                      <div className="text-xs text-gray-500">Float: ${Number(c.opening_float || 0).toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div>Closing: ${Number(c.closing_total || 0).toFixed(2)}</div>
                      {c.variance != null && (
                        <div className={`text-xs ${Number(c.variance) !== 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          Variance: ${Number(c.variance).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
