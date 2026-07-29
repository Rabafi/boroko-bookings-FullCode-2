import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, ChefHat, CircleDollarSign, RefreshCw, ShoppingCart } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getManagerPosSnapshot, getManagerPosTransactions } from '../lib/api'
import { money, shortDateTime, titleCase } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'
import { isBarHospitalityMode } from '../lib/productShell'

function localDate() {
  return new Date().toISOString().slice(0, 10)
}

const MODES = {
  service: { title: 'Service Watch', subtitle: 'Open tables, tabs, and current service flow', icon: ChefHat },
  'cash-close': { title: 'Cash & Close', subtitle: 'Live sales, cash, returns, and close readiness', icon: CircleDollarSign }
}

export default function RestaurantOperations({ mode }) {
  const { user } = useAuth()
  const barOnly = isBarHospitalityMode(user?.hospitality_mode)
  const baseConfig = MODES[mode] || MODES.service
  const config = barOnly && mode === 'service' ? { ...baseConfig, title: 'Open Bar Tabs', subtitle: 'Open tabs and current bar settlement flow' } : baseConfig
  const Icon = config.icon
  const [snapshot, setSnapshot] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const day = localDate()
      const [nextSnapshot, openOrders] = await Promise.all([
        getManagerPosSnapshot(user.lodge_id, { startDate: day, endDate: day, forceFresh: true }),
        getManagerPosTransactions(user.lodge_id, { startDate: day, endDate: day, status: mode === 'service' ? 'open' : 'posted', limit: 30 })
      ])
      setSnapshot(nextSnapshot)
      setTransactions(openOrders.transactions || [])
      setUpdatedAt(new Date().toISOString())
    } catch (loadError) {
      setError(loadError?.message || `${config.title} could not load.`)
    } finally {
      setLoading(false)
    }
  }, [config.title, mode, user.lodge_id])

  useEffect(() => { load() }, [load])

  const cashTotal = useMemo(() => (snapshot?.by_payment || []).find((row) => String(row.method).toLowerCase() === 'cash')?.amount || 0, [snapshot])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">{config.title}</h1><p className="mt-1 text-xs text-gray-400">{config.subtitle}</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label={`Refresh ${config.title}`}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div></header>
      <main className="space-y-4 px-4 py-4">
        {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
        <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Net sales today</p><p className="mt-1 text-xl font-bold text-emerald-200">{money(snapshot?.net_sales)}</p></div><div className="rounded-2xl bg-gray-800 p-4"><p className="text-xs text-gray-400">Open service</p><p className="mt-1 text-xl font-bold text-amber-200">{Number(snapshot?.open_count || 0)}</p></div></div>
        {mode === 'cash-close' ? (
          <><section className="rounded-2xl bg-gray-800 p-4"><div className="flex items-center gap-2"><Banknote size={17} className="text-emerald-300" /><h2 className="text-sm font-semibold text-white">Cash position</h2></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Cash recorded</p><p className="mt-1 font-bold text-white">{money(cashTotal)}</p></div><div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Returns</p><p className="mt-1 font-bold text-rose-300">{money(snapshot?.returns_total)}</p></div><div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Discounts</p><p className="mt-1 font-bold text-amber-200">{money(snapshot?.discount_total)}</p></div><div className="rounded-xl bg-gray-900 p-3"><p className="text-xs text-gray-500">Posted sales</p><p className="mt-1 font-bold text-white">{Number(snapshot?.sale_count || 0)}</p></div></div></section><section className="rounded-2xl bg-gray-800 p-4"><p className="text-sm font-semibold text-white">Close readiness</p><p className="mt-2 text-sm text-gray-400">{Number(snapshot?.open_count || 0) === 0 ? 'No open POS orders are reported for today.' : `${snapshot.open_count} open POS order${Number(snapshot.open_count) === 1 ? '' : 's'} still need service or settlement.`}</p></section></>
        ) : (
          <section><div className="mb-3 flex items-center gap-2"><Icon size={17} className="text-orange-300" /><h2 className="text-sm font-semibold text-white">Open service tickets</h2></div>{!loading && transactions.length === 0 ? <EmptyState icon={ShoppingCart} title="No open tickets" message="Open tables and tabs appear here while service is in progress." /> : <div className="space-y-2">{transactions.map((transaction) => <div key={transaction.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{transaction.table_name || transaction.tab_name || transaction.walk_in_name || transaction.receipt_number || 'Open order'}</p><p className="mt-1 text-xs text-gray-500">{transaction.outlet_name} · {shortDateTime(transaction.created_at)}</p></div><p className="text-sm font-bold text-white">{money(transaction.total)}</p></div><p className="mt-2 text-xs text-gray-400">{(transaction.items || []).map((item) => `${item.quantity}× ${item.item_name}`).join(' · ') || titleCase(transaction.service_mode || 'service')}</p></div>)}</div>}</section>
        )}
        <MobileBoundaryNotice compact>These are live manager views. Starting sales, voids, discounts, returns, and settlement stay in the server-authorized POS terminal and cash-up workflow.</MobileBoundaryNotice>
      </main>
    </div>
  )
}
