import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, Clock, Package, RefreshCw, ShoppingCart, Users, Utensils } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useFeatures } from '../contexts/FeaturesContext'
import { getDashboardSnapshot, getManagerPosSnapshot, getManagerPosTransactions, listInventory, getSettings } from '../lib/api'
import { money } from '../lib/format'
import { readCacheEntry } from '../lib/runtime'
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
  const { can, isEnabled } = useFeatures()
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [settings, setSettings] = useState(null)
  const [posSnapshot, setPosSnapshot] = useState(null)
  const [posTransactions, setPosTransactions] = useState([])
  const [lowStockCount, setLowStockCount] = useState(0)
  const [activeAlerts, setActiveAlerts] = useState([])

  const restaurantMode = useMemo(() => {
    const pt = settings?.property_type || settings?.business_type || 'lodge'
    return pt === 'restaurant' || pt === 'pos_only'
  }, [settings])

  const loadData = async () => {
    if (!user?.lodge_id) return
    setLoading(true)
    try {
      const [settingsData, posSnap, transactions, inventory] = await Promise.all([
        getSettings(user.lodge_id).catch(() => null),
        getManagerPosSnapshot(user.lodge_id).catch(() => null),
        getManagerPosTransactions(user.lodge_id, { limit: 20 }).catch(() => []),
        listInventory(user.lodge_id).catch(() => [])
      ])

      setSettings(settingsData)
      setPosSnapshot(posSnap)
      setPosTransactions(Array.isArray(transactions) ? transactions : [])
      setLowStockCount(
        Array.isArray(inventory)
          ? inventory.filter((i) => (i.current_stock || 0) <= (i.reorder_level || 0) && (i.reorder_level || 0) > 0).length
          : 0
      )
      setLastUpdated(new Date().toISOString())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [user?.lodge_id])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') loadData() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [user?.lodge_id])

  const kpis = useMemo(() => {
    const todaySales = posSnapshot?.today_sales ?? 0
    const todayOrders = posSnapshot?.today_orders ?? 0
    const avgOrder = todayOrders > 0 ? todaySales / todayOrders : 0
    const outstanding = posSnapshot?.outstanding ?? 0
    return { todaySales, todayOrders, avgOrder, outstanding }
  }, [posSnapshot])

  const paymentMix = useMemo(() => {
    if (!Array.isArray(posTransactions) || posTransactions.length === 0) return []
    const counts = {}
    posTransactions.forEach((t) => {
      const m = t.payment_method || 'unknown'
      counts[m] = (counts[m] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [posTransactions])

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
          <h1 className="text-lg font-bold text-slate-900">Restaurant Owner</h1>
          <p className="text-xs text-slate-500">Today's overview</p>
        </div>
        <div className="flex items-center gap-2">
          <DataFreshness lastUpdated={lastUpdated} />
          <button onClick={loadData} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={ShoppingCart} label="POS Sales" value={money(kpis.todaySales)} color="green" to="/pos" />
        <KpiCard icon={BarChart3} label="Orders" value={kpis.todayOrders} sub={`Avg ${money(kpis.avgOrder)}`} color="blue" to="/pos" />
        <KpiCard icon={AlertTriangle} label="Outstanding" value={money(kpis.outstanding)} color="amber" />
        <KpiCard icon={Package} label="Low Stock" value={lowStockCount} color={lowStockCount > 0 ? 'red' : 'slate'} to="/inventory" />
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
                <span className="font-semibold text-slate-900">{money(t.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MobileBoundaryNotice />
    </div>
  )
}
