import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Banknote, CircleDollarSign, CreditCard, HandCoins, RefreshCw, WalletCards } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSettings } from '../../app-context'

const today = () => new Date().toISOString().slice(0, 10)
const money = (value, currency) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${currency} ${numeric.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Unavailable'
}
const parseTenderRows = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export default function RestaurantFinanceOverview() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({ orders: [], drawer: null, pendingCashups: [], settlements: [], deposits: [], tips: [], expenses: [] })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const date = today()
    try {
      const results = await Promise.allSettled([
        window.api?.pos?.getOrders?.(date, date),
        window.api?.pos?.getOpenCashDrawer?.(),
        window.api?.pos?.getPendingCashupSubmissions?.(),
        window.api?.pos?.getSettlements?.(date),
        window.api?.pos?.getReservationDeposits?.(90),
        window.api?.pos?.getTipBalances?.(30),
        window.api?.expenses?.getAll?.(date, date, 'all'),
      ])
      const value = (index, fallback) => results[index]?.status === 'fulfilled' ? (results[index].value ?? fallback) : fallback
      const readComplete = (index) => results[index]?.status === 'fulfilled'
        && results[index].value?._available !== false
        && results[index].value?._source === 'server'
        && results[index].value?._complete === true
      setData({
        orders: Array.isArray(value(0, [])) ? value(0, []) : [],
        drawer: value(1, null),
        pendingCashups: value(2, {})?.success === false ? [] : (value(2, {})?.submissions || []),
        pendingCashupsAvailable: results[2]?.status === 'fulfilled' && value(2, {})?.success !== false,
        settlements: Array.isArray(value(3, [])) ? value(3, []) : [],
        deposits: Array.isArray(value(4, [])) ? value(4, []) : [],
        tips: Array.isArray(value(5, [])) ? value(5, []) : [],
        expenses: Array.isArray(value(6, [])) ? value(6, []) : [],
        settlementsAvailable: readComplete(3),
        depositsAvailable: readComplete(4),
        tipsAvailable: readComplete(5),
        expensesAvailable: readComplete(6),
      })
      if (results.some((result) => result.status === 'rejected') || [3, 4, 5, 6].some((index) => !readComplete(index))) setError('Some finance signals could not be loaded. Refresh before relying on this overview.')
    } catch (loadError) {
      setError(loadError?.message || 'Finance overview could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => {
    const snapshotReady = data.orders?._source === 'server' && data.orders?._complete === true
    const tenderReady = snapshotReady && data.orders?._tender_complete === true
    const completed = data.orders.filter((order) => ['completed', 'settled'].includes(String(order.status || '').toLowerCase()))
    const sales = snapshotReady ? completed.reduce((sum, order) => sum + Number(order.total || order.total_amount || 0), 0) : null
    const cash = tenderReady ? completed.reduce((sum, order) => sum + parseTenderRows(order.payment_breakdown)
      .filter((row) => String(row?.method || row?.type || '').toLowerCase() === 'cash')
      .reduce((rowSum, row) => rowSum + Number(row.amount || 0), 0), 0) : null
    const expenses = data.expensesAvailable ? data.expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0) : null
    const heldDeposits = data.depositsAvailable ? data.deposits.filter((row) => String(row.status || 'held').toLowerCase() === 'held').reduce((sum, row) => sum + Number(row.amount || 0), 0) : null
    const tipsOwed = data.tipsAvailable ? data.tips.reduce((sum, row) => sum + Number(row.available || 0), 0) : null
    const settlementVariance = data.settlementsAvailable ? data.settlements.reduce((sum, row) => sum + Math.abs(Number(row.variance_amount || 0)), 0) : null
    return { sales, cash, expenses, heldDeposits, tipsOwed, settlementVariance, snapshotReady }
  }, [data])

  const actions = [
    ['Cash-ups & drawers', data.pendingCashupsAvailable === false ? 'Unavailable until cash-up evidence loads' : `${data.pendingCashups.length} waiting for review`, 'cashups'],
    ['Sales & payments', 'Review receipts, tenders, voids and exceptions', 'sales'],
    ['Settlements', summary.settlementVariance == null ? 'Unavailable until settlement evidence loads' : summary.settlementVariance ? `${money(summary.settlementVariance, currency)} variance recorded today` : 'Reconcile card, mobile money and provider batches', 'settlements'],
    ['Customer funds', `${money(summary.heldDeposits, currency)} held reservation deposits`, 'customer-funds'],
    ['Expenses', `${money(summary.expenses, currency)} recorded today`, 'expenses'],
    ['Tips & payouts', `${money(summary.tipsOwed, currency)} available to pay`, 'tips'],
    ['Daily close', data.drawer ? 'Drawer is open — complete close controls before end of day' : 'Review end-of-day blockers and evidence', 'daily-close'],
    ['Owner review', 'Digest, exported evidence and financial review', 'owner-review'],
  ]

  return <div className="restaurant-native-page max-w-6xl">
    <div className="restaurant-native-hero">
      <div><h1>Finance overview</h1><p>One controlled view of today’s sales, customer money, cash accountability, spend and close status.</p></div>
      <button onClick={load} disabled={loading} className="bb-btn-outline flex items-center gap-2 px-4 text-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
    </div>
    {error && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}
    <section className="restaurant-native-kpis mb-6">
      {[[CircleDollarSign, 'Recorded sales', summary.sales], [Banknote, 'Cash sales', summary.cash], [CreditCard, 'Held deposits', summary.heldDeposits], [HandCoins, 'Tips available', summary.tipsOwed]].map(([Icon, label, value]) => <article key={label} className="bb-card p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon size={16} />{label}</div><strong className="mt-2 block text-xl text-slate-800">{loading ? '—' : money(value, currency)}</strong></article>)}
    </section>
    {!loading && !summary.snapshotReady && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">POS sales and cash totals are unavailable until the server confirms a complete financial snapshot. Operational balances remain separate.</p>}
    <section className="grid gap-3 md:grid-cols-2">
      {actions.map(([label, detail, tab]) => <button key={tab} type="button" onClick={() => navigate(`/restaurant/finance-close?tab=${tab}`)} className="bb-card flex items-center justify-between gap-4 p-4 text-left transition hover:border-emerald-300 hover:shadow-sm"><span><strong className="block text-sm text-slate-800">{label}</strong><small className="mt-1 block text-xs text-slate-500">{detail}</small></span><ArrowRight size={17} className="shrink-0 text-emerald-700" /></button>)}
    </section>
    <p className="mt-5 flex items-center gap-2 text-xs text-slate-500"><WalletCards size={14} />Financial actions remain separately authorised and server-audited; this overview never changes a balance.</p>
  </div>
}
