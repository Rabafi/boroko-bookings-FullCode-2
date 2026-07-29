import { useState, useEffect } from 'react'
import { Wallet, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

export default function RestaurantCashDrawer() {
  const [drawer, setDrawer] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [floatAmount, setFloatAmount] = useState('')
  const [closingTotal, setClosingTotal] = useState('')
  const [declaredTotal, setDeclaredTotal] = useState('')
  const [notes, setNotes] = useState('')
  const [todaySales, setTodaySales] = useState({ cash: 0, card: 0, other: 0, total: 0 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadDrawer() }, [])

  async function loadDrawer() {
    try {
      setLoading(true)
      setError('')
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
      setClosingTotal(current => current || cash.toFixed(2))
      const failures = [d, h, orders].filter(result => result.status === 'rejected')
      if (failures.length > 0) setError('Some cash-up information could not be refreshed. Do not close the drawer until all totals are visible.')
    } catch (err) {
      console.error('Failed to load cash drawer:', err)
      setError(err.message || 'Could not load the cash drawer.')
    } finally {
      setLoading(false)
    }
  }

  async function openDrawer() {
    if (floatAmount === '' || Number(floatAmount) < 0) {
      setError('Enter a valid opening float of zero or more.')
      return
    }
    try {
      setSaving(true)
      setError('')
      setNotice('')
      const result = await window.api.pos.openCashDrawerSession({ openingFloat: Number(floatAmount) || 0 })
      if (result?.success === false) throw new Error(result.error || 'Could not open the drawer.')
      setFloatAmount('')
      setNotice('Cash drawer opened. The float is now recorded against this session.')
      await loadDrawer()
    } catch (err) {
      console.error('Failed to open drawer:', err)
      setError(err.message || 'Could not open the drawer.')
    } finally {
      setSaving(false)
    }
  }

  async function closeDrawer() {
    if (!drawer?.id) return
    if (closingTotal === '' || Number(closingTotal) < 0 || declaredTotal === '' || Number(declaredTotal) < 0) {
      setError('Enter both the POS cash movement and the physical cash count before closing.')
      return
    }
    if (!window.confirm(`Close this drawer with P ${Number(declaredTotal).toFixed(2)} physically counted? This records the cash-up and cannot be treated as a draft.`)) return
    try {
      setSaving(true)
      setError('')
      setNotice('')
      const result = await window.api.pos.closeCashDrawerSession({
        sessionId: drawer.id,
        closingTotal: Number(closingTotal) || 0,
        declaredTotal: Number(declaredTotal),
        notes: notes.trim() || undefined
      })
      if (result?.success === false) throw new Error(result.error || 'Could not close the drawer.')
      setClosingTotal('')
      setDeclaredTotal('')
      setNotes('')
      setNotice(`Drawer closed${result?.variance != null ? ` with a P ${Number(result.variance).toFixed(2)} variance` : ''}.`)
      await loadDrawer()
    } catch (err) {
      console.error('Failed to close drawer:', err)
      setError(err.message || 'Could not close the drawer.')
    } finally {
      setSaving(false)
    }
  }

  const expectedCash = (Number(drawer?.opening_float || 0) + Number(closingTotal || todaySales.cash || 0)).toFixed(2)
  const variance = declaredTotal ? (Number(declaredTotal) - Number(expectedCash)).toFixed(2) : null

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Drawer</h1>
          <p className="text-sm text-gray-500 mt-1">Open, manage, and close cash drawer sessions</p>
        </div>
        <button onClick={loadDrawer} className="bb-btn-outline flex items-center gap-2 px-4 text-sm"><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      {loading ? (
        <div className="restaurant-native-loading">
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
                <div className="restaurant-native-kpis mb-4">
                  <div>
                    <div className="text-xs text-gray-500">Float</div>
                    <div className="font-medium">P {Number(drawer.opening_float || 0).toFixed(2)}</div>
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
                    <div className="font-bold text-emerald-600">P {expectedCash}</div>
                  </div>
                </div>

                {/* Expected cash breakdown */}
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Current POS estimate</h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Float: </span>
                      <span className="font-medium">P {Number(drawer.opening_float || 0).toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">+ POS cash movement: </span>
                      <span className="font-medium">P {todaySales.cash.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">= Expected: </span>
                      <span className="font-bold">P {expectedCash}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs text-gray-400 mt-2">
                    <div>Card: P {todaySales.card.toFixed(2)}</div>
                    <div>Other: P {todaySales.other.toFixed(2)}</div>
                    <div>Total Sales: P {todaySales.total.toFixed(2)}</div>
                  </div>
                  <p className="restaurant-native-financial-warning mt-3">This is an on-screen estimate from loaded POS orders. The cash-up saved by the server uses the cash movement and physical count entered below.</p>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium text-sm mb-2">Close Drawer</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">POS cash movement *</label>
                      <input type="number" min="0" step="0.01" placeholder="Cash sales / net movement" value={closingTotal} onChange={e => setClosingTotal(e.target.value)} className="bb-input w-full mt-1" />
                      <p className="mt-1 text-[10px] text-gray-400">Cash sales or other net cash movement for this drawer session.</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Physical cash counted *</label>
                      <input type="number" min="0" step="0.01" placeholder="Actual cash in drawer" value={declaredTotal} onChange={e => setDeclaredTotal(e.target.value)} className="bb-input w-full mt-1" />
                    </div>
                    <div className="flex items-end">
                      <button onClick={closeDrawer} disabled={saving || closingTotal === '' || declaredTotal === ''} className="bb-btn-primary w-full">{saving ? 'Closing…' : 'Close Drawer'}</button>
                    </div>
                  </div>
                  {variance != null && (
                    <div className={`mt-2 text-sm flex items-center gap-1 ${Number(variance) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(variance) !== 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                      Variance: P {variance} {Number(variance) === 0 ? '(balanced)' : Number(variance) > 0 ? '(over)' : '(short)'}
                    </div>
                  )}
                  <label className="mt-3 block text-xs text-gray-500">Cash-up note (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} className="bb-input mt-1 w-full" rows={2} placeholder="Explain variance, safe drop, or handover detail" />
                </div>
              </div>
            </>
          ) : (
            <div className="bb-card p-5">
              <h2 className="font-semibold mb-3">Open New Drawer</h2>
              <div className="flex gap-3">
                <input type="number" min="0" step="0.01" placeholder="Opening float amount" value={floatAmount} onChange={e => setFloatAmount(e.target.value)} className="bb-input" />
                <button onClick={openDrawer} disabled={saving || floatAmount === ''} className="bb-btn-primary px-5">{saving ? 'Opening…' : 'Open Drawer'}</button>
              </div>
            </div>
          )}

          <div className="bb-card">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Recent Cash-Ups ({history.length})</h2>
            </div>
            {history.length === 0 ? (
              <div className="restaurant-native-empty">No cash-up history</div>
            ) : (
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {history.slice(0, 20).map(c => (
                  <div key={c.id} className="px-4 py-3 flex justify-between text-sm">
                    <div>
                      <div className="font-medium">{c.closed_at ? new Date(c.closed_at).toLocaleDateString() : '-'}</div>
                      <div className="text-xs text-gray-500">Float: P {Number(c.opening_float || 0).toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div>Closing: P {Number(c.closing_total || 0).toFixed(2)}</div>
                      {c.variance != null && (
                        <div className={`text-xs ${Number(c.variance) !== 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          Variance: P {Number(c.variance).toFixed(2)}
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
