import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, BarChart3, Clock, Package, RefreshCw, ShoppingCart, Users, Utensils } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getManagerPosSnapshot, getManagerPosTransactions, listInventory } from '../lib/api'
import { isBarHospitalityMode, isRestaurantProductFamily } from '../lib/productShell'
import { money } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

const KpiCard = ({ icon: Icon, label, value, sub, color = 'slate', to }) => {
  const inner = (
    <div className={`rounded-xl border border-${color}-200 bg-${color}-50 p-3`}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`h-4 w-4 text-${color}-500`} />}
        <span className="text-xs font-semibold text-slate-600">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  )
  return to ? <Link to={to} className="block hover:ring-1 hover:ring-slate-300 rounded-xl">{inner}</Link> : inner
}

export default function RestaurantOwner() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [posSnapshot, setPosSnapshot] = useState(null)
  const [posTransactions, setPosTransactions] = useState([])
  const [lowStockCount, setLowStockCount] = useState(0)
  const [loadError, setLoadError] = useState('')

  // Server product_family on the session is authoritative — not client settings inference.
  const restaurantMode = isRestaurantProductFamily(user?.product_family)
  const barOnly = restaurantMode && isBarHospitalityMode(user?.hospitality_mode)

  const loadData = useCallback(async () => {
    if (!user?.lodge_id) return
    setLoading(true)
    setLoadError('')
    try {
      const [posSnap, transactions, inventory] = await Promise.all([
        getManagerPosSnapshot(user.lodge_id),
        getManagerPosTransactions(user.lodge_id, { limit: 20 }),
        listInventory(user.lodge_id)
      ])

      setPosSnapshot(posSnap)
      setPosTransactions(Array.isArray(transactions?.transactions) ? transactions.transactions : [])
      setLowStockCount(Array.isArray(inventory) ? inventory.filter((i) => (i.current_stock || 0) <= (i.reorder_level || 0) && (i.reorder_level || 0) > 0).length : null)
      setLastUpdated(new Date().toISOString())
    } catch (error) {
      setPosSnapshot(null)
      setPosTransactions([])
      setLowStockCount(null)
      setLoadError(error?.message || 'Bar owner data could not be loaded from the server.')
    } finally {
      setLoading(false)
    }
  }, [user?.lodge_id])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') loadData() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadData])

  const kpis = useMemo(() => {
    const todaySales = posSnapshot?.net_sales
    const todayOrders = posSnapshot?.sale_count
    const avgOrder = todayOrders > 0 ? todaySales / todayOrders : 0
    return { todaySales, todayOrders, avgOrder }
  }, [posSnapshot])

  const snapshotReady = posSnapshot?.complete === true
  const paymentMix = useMemo(() => {
    if (!Array.isArray(posTransactions) || posTransactions.length === 0) return []
    const counts = {}
    posTransactions.filter((t) => snapshotReady && t.financial_complete === true && t.tender_detail_complete === true).forEach((t) => {
      const m = t.payment_breakdown?.[0]?.method || 'tender unavailable'
      counts[m] = (counts[m] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [posTransactions, snapshotReady])
  if (!restaurantMode) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <Utensils className="h-10 w-10 text-slate-400" />
        <p className="text-sm text-slate-600">This page is for restaurant properties only.</p>
        <Link to="/" className="text-sm font-semibold text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{barOnly ? 'Bar Owner' : 'Restaurant Owner'}</h1>
          <p className="text-xs text-slate-500">Today's {barOnly ? 'bar' : 'restaurant'} overview</p>
        </div>
        <div className="flex items-center gap-2">
          <DataFreshness lastUpdated={lastUpdated} />
          <button onClick={loadData} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loadError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{loadError} Monetary totals remain unavailable until the live source reconnects.</div>}
      {posSnapshot && !snapshotReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The server returned an incomplete POS snapshot. Financial totals are withheld until all source rows are resolved.</div>}

      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={ShoppingCart} label="POS Sales" value={snapshotReady ? money(kpis.todaySales) : 'Unavailable'} color="green" to="/pos" />
        <KpiCard icon={BarChart3} label="Completed sales" value={snapshotReady ? kpis.todayOrders : 'Unavailable'} sub={snapshotReady ? `Avg ${money(kpis.avgOrder)}` : 'Server confirmation required'} color="blue" to="/pos" />
        <KpiCard icon={AlertTriangle} label="Outstanding" value="Not in Bar view" sub="Lodging receivables are outside this workspace" color="amber" />
        <KpiCard icon={Package} label="Low Stock" value={lowStockCount === null ? 'Unavailable' : lowStockCount} color={lowStockCount > 0 ? 'red' : 'slate'} to="/inventory" />
      </div>

      {paymentMix.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-700">Payment Mix Today</h3>
          <div className="space-y-1.5">
            {paymentMix.map(([method, count]) => (
              <div key={method} className="flex items-center justify-between text-xs">
                <span className="capitalize text-slate-600">{method.replace(/_/g, ' ')}</span>
                <span className="font-semibold text-slate-900">{count} orders</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {posTransactions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-700">Recent Transactions</h3>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {posTransactions.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{t.items_count || '?'} items</span>
                <span className="font-semibold text-slate-900">{snapshotReady && t.financial_complete === true ? money(t.total) : 'Unavailable'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MobileBoundaryNotice />
    </div>
  )
}
