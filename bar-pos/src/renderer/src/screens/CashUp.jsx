import { useState, useEffect } from 'react'
import { Clock, DollarSign } from 'lucide-react'

const CURRENCY = 'P'
const fmt = (v) => Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CashUp({ user, settings }) {
  const [todaySales, setTodaySales] = useState([])
  const [cashUps, setCashUps] = useState([])
  const [loading, setLoading] = useState(true)
  const [floatAmount, setFloatAmount] = useState(0)
  const [countedAmount, setCountedAmount] = useState(0)
  const [declaredAmount, setDeclaredAmount] = useState(0)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastCashUp, setLastCashUp] = useState(null)
  const [success, setSuccess] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [sales, cups, last] = await Promise.all([
        window.barAPI.getTodaySales().catch(() => []),
        window.barAPI.getCashups({}).catch(() => []),
        window.barAPI.getLastCashup('main').catch(() => null)
      ])
      setTodaySales(sales)
      setCashUps(cups)
      setLastCashUp(last)
      if (last) setFloatAmount(last.counted_amount || 0)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  const cashSales = todaySales
    .filter(o => (o.payments || []).some(p => p.method === 'cash'))
    .reduce((sum, o) => sum + Number(o.total || 0), 0)

  const cardSales = todaySales
    .filter(o => (o.payments || []).some(p => p.method !== 'cash'))
    .reduce((sum, o) => sum + Number(o.total || 0), 0)

  const totalSales = todaySales.reduce((sum, o) => sum + Number(o.total || 0), 0)
  const orderCount = todaySales.length
  const expectedCash = lastCashUp ? (lastCashUp.counted_amount || 0) + cashSales : floatAmount + cashSales
  const variance = countedAmount > 0 ? countedAmount - expectedCash : 0

  async function handleClose() {
    if (countedAmount <= 0) { alert('Enter the counted cash amount'); return }
    setBusy(true)
    try {
      await window.barAPI.createCashup({
        float_amount: floatAmount,
        counted_amount: countedAmount,
        declared_amount: declaredAmount || countedAmount,
        expected_amount: expectedCash,
        variances: [{ type: 'cash', expected: expectedCash, actual: countedAmount, variance }],
        notes: notes || null,
        outlet_id: 'main',
        lodge_id: 'local',
        user_id: user?.id
      })
      setSuccess(`Cash up closed — P${fmt(countedAmount)} counted, P${fmt(variance >= 0 ? variance : -variance)} ${variance >= 0 ? 'over' : 'short'}`)
      setCountedAmount(0)
      setDeclaredAmount(0)
      setNotes('')
      loadData()
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) { alert('Close failed: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-stone-800">
        <h1 className="text-base font-semibold">Cash Up</h1>
        <button onClick={loadData} className="btn-ghost text-xs px-2 py-1"><Clock className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {success && (
          <div className="bg-brand-900/30 border border-brand-800/40 rounded-lg px-4 py-3 text-sm text-brand-300 mb-4">
            {success}
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="kpi-card">
            <div className="kpi-label">Today's Sales</div>
            <div className="kpi-value text-lg">P{fmt(totalSales)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Orders</div>
            <div className="kpi-value text-lg">{orderCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Cash</div>
            <div className="kpi-value text-lg text-amber-400">P{fmt(cashSales)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Card/Mobile</div>
            <div className="kpi-value text-lg text-brand-400">P{fmt(cardSales)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Close out form */}
          <div className="card space-y-4">
            <h2 className="text-sm font-medium text-stone-300">Close Cash Drawer</h2>

            <div className="input-group">
              <label>Opening float</label>
              <input type="number" value={floatAmount} onChange={e => setFloatAmount(Number(e.target.value))} min="0" step="0.01" />
            </div>

            <div className="input-group">
              <label>Expected cash in drawer</label>
              <div className="text-lg font-mono text-stone-200">P{fmt(expectedCash)}</div>
              <p className="text-[10px] text-stone-600">Float + cash sales</p>
            </div>

            <div className="input-group">
              <label>Counted cash amount</label>
              <input type="number" value={countedAmount} onChange={e => setCountedAmount(Number(e.target.value))} min="0" step="0.01" placeholder="Actual cash in drawer" />
            </div>

            {countedAmount > 0 && (
              <div className={`px-3 py-2 rounded-lg text-sm ${variance === 0 ? 'bg-brand-900/20 text-brand-400' : variance > 0 ? 'bg-amber-900/20 text-amber-400' : 'bg-red-900/20 text-red-400'}`}>
                {variance === 0 ? 'Balanced' : `Variance: P${fmt(Math.abs(variance))} ${variance > 0 ? 'over' : 'short'}`}
              </div>
            )}

            <div className="input-group">
              <label>Declared amount (optional)</label>
              <input type="number" value={declaredAmount} onChange={e => setDeclaredAmount(Number(e.target.value))} min="0" step="0.01" placeholder="What you declare" />
            </div>

            <div className="input-group">
              <label>Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about today..." />
            </div>

            <button onClick={handleClose} disabled={busy || countedAmount <= 0} className="btn-primary w-full">
              {busy ? 'Closing...' : 'Close & Record'}
            </button>
          </div>

          {/* Cash up history */}
          <div>
            <h2 className="text-sm font-medium text-stone-300 mb-3">Recent Closes</h2>
            {loading ? (
              <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : cashUps.length === 0 ? (
              <p className="text-sm text-stone-600">No closes yet today</p>
            ) : (
              <div className="space-y-1.5">
                {cashUps.slice(0, 10).map(cu => {
                  const diff = Number(cu.counted_amount || 0) - Number(cu.expected_amount || 0)
                  return (
                    <div key={cu.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-stone-800/15 text-xs">
                      <div>
                        <div className="font-mono text-stone-400">{new Date(cu.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div className="text-[10px] text-stone-600">Float: P{fmt(cu.float_amount)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-stone-200">P{fmt(cu.counted_amount)}</div>
                        <div className={`text-[10px] font-mono ${diff === 0 ? 'text-brand-500' : diff > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                          {diff === 0 ? 'Balanced' : `${diff > 0 ? '+' : ''}P${fmt(diff)}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
