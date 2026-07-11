import { useState, useEffect } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, ClipboardCheck, Wallet, TrendingUp, Users } from 'lucide-react'

export default function RestaurantDailyClose() {
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState({
    openTables: 0,
    pendingTickets: 0,
    drawerOpen: false,
    drawer: null,
    activeShifts: 0,
    unresolvedAlerts: 0,
    lowStock: 0,
    todaySales: 0,
    todayOrders: 0,
    checklistsComplete: true
  })
  const [digest, setDigest] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadStatus() }, [])

  async function loadStatus() {
    try {
      setLoading(true)
      const [tables, tickets, drawer, shifts, alerts, lowStock, todayOrders] = await Promise.allSettled([
        window.api.pos.getTables(),
        window.api.pos.getTickets(),
        window.api.pos.getOpenCashDrawer(),
        window.api.pos.getActiveShifts(),
        window.api.pos.getActiveAlerts(),
        window.api.inventory.getLowStock(),
        window.api.pos.getOrders(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10))
      ])
      const openTables = Array.isArray(tables.value) ? tables.value.filter(t => t.status === 'occupied' || t.status === 'running').length : 0
      const pendingTickets = Array.isArray(tickets.value) ? tickets.value.filter(t => t.status === 'pending' || t.status === 'preparing').length : 0
      const drawerOpen = !!drawer.value?.id
      const activeShifts = Array.isArray(shifts.value) ? shifts.value.length : 0
      const unresolvedAlerts = Array.isArray(alerts.value) ? alerts.value.filter(a => !a.is_resolved).length : 0
      const lowStockCount = Array.isArray(lowStock.value) ? lowStock.value.length : 0
      const orders = Array.isArray(todayOrders.value) ? todayOrders.value : []
      const todaySales = orders.reduce((sum, o) => sum + (o.total || o.amount || 0), 0)
      setChecks({
        openTables, pendingTickets, drawerOpen, drawer: drawer.value,
        activeShifts, unresolvedAlerts, lowStock: lowStockCount,
        todaySales, todayOrders: orders.length, checklistsComplete: true
      })
    } catch (err) {
      console.error('Failed to load daily close status:', err)
      setError(err.message || 'Could not load end-of-day checks.')
    } finally {
      setLoading(false)
    }
  }

  async function generateDigest() {
    try {
      setGenerating(true)
      const result = await window.api.pos.generateOwnerDigest()
      setDigest(result)
    } catch (err) {
      console.error('Failed to generate digest:', err)
      setError(err.message || 'Could not generate the owner digest.')
    } finally {
      setGenerating(false)
    }
  }

  const blockers = []
  if (checks.openTables > 0) blockers.push(`${checks.openTables} open table(s)`)
  if (checks.pendingTickets > 0) blockers.push(`${checks.pendingTickets} pending kitchen ticket(s)`)
  if (checks.drawerOpen) blockers.push('Cash drawer still open')
  if (checks.activeShifts > 0) blockers.push(`${checks.activeShifts} active shift(s)`)
  if (checks.unresolvedAlerts > 0) blockers.push(`${checks.unresolvedAlerts} unresolved alert(s)`)

  const ready = !loading && blockers.length === 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daily Close</h1>
        <p className="text-sm text-gray-500 mt-1">End-of-day readiness check, sales summary, and owner digest</p>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Readiness banner */}
          <div className={`bb-card p-6 border-2 ${ready ? 'border-emerald-400 bg-emerald-50' : 'border-amber-400 bg-amber-50'}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-lg ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                {ready ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              </div>
              <div>
                <h2 className="text-lg font-bold">{ready ? 'Ready to Close' : 'Not Ready'}</h2>
                <p className="text-sm text-gray-600">
                  {ready ? 'All checks passed. Safe to close for the day.' : 'Resolve the following before closing:'}
                </p>
              </div>
            </div>
            {blockers.length > 0 && (
              <ul className="mt-3 space-y-1.5 ml-13">
                {blockers.map((b, i) => (
                  <li key={i} className="text-sm text-amber-700 flex items-center gap-2">
                    <XCircle size={14} className="text-amber-500 shrink-0" /> {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Today's sales summary */}
          <div className="bb-card p-5">
            <h3 className="font-semibold text-sm text-gray-700 mb-3">Today&apos;s Sales Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-emerald-50 rounded-lg p-4 text-center">
                <TrendingUp size={18} className="mx-auto mb-1 text-emerald-500" />
                <div className="text-xl font-bold text-emerald-700">${Number(checks.todaySales).toFixed(2)}</div>
                <div className="text-xs text-gray-500">Total Revenue</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <Wallet size={18} className="mx-auto mb-1 text-blue-500" />
                <div className="text-xl font-bold text-blue-700">{checks.todayOrders}</div>
                <div className="text-xs text-gray-500">Orders</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 text-center">
                <Users size={18} className="mx-auto mb-1 text-purple-500" />
                <div className="text-xl font-bold text-purple-700">${checks.todayOrders > 0 ? (checks.todaySales / checks.todayOrders).toFixed(2) : '0.00'}</div>
                <div className="text-xs text-gray-500">Avg Order</div>
              </div>
            </div>
          </div>

          {/* Cash drawer summary */}
          {checks.drawerOpen && checks.drawer && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Cash Drawer</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Opening Float</div>
                  <div className="font-semibold">${Number(checks.drawer.opening_float || 0).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Opened At</div>
                  <div className="font-semibold text-sm">{checks.drawer.opened_at ? new Date(checks.drawer.opened_at).toLocaleTimeString() : '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Status</div>
                  <div className="font-semibold text-amber-600">Open - Close before daily close</div>
                </div>
              </div>
            </div>
          )}

          {/* Status grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Open Tables', value: checks.openTables, ok: checks.openTables === 0 },
              { label: 'Kitchen Pending', value: checks.pendingTickets, ok: checks.pendingTickets === 0 },
              { label: 'Cash Drawer', value: checks.drawerOpen ? 'Open' : 'Closed', ok: !checks.drawerOpen },
              { label: 'Active Shifts', value: checks.activeShifts, ok: checks.activeShifts === 0 },
              { label: 'Unresolved Alerts', value: checks.unresolvedAlerts, ok: checks.unresolvedAlerts === 0 },
              { label: 'Low Stock Items', value: checks.lowStock, ok: checks.lowStock === 0 }
            ].map((c, i) => (
              <div key={i} className={`bb-card p-4 text-center border ${c.ok ? 'border-emerald-200' : 'border-amber-200'}`}>
                <div className={`text-2xl font-bold ${c.ok ? 'text-emerald-600' : 'text-amber-600'}`}>{c.value}</div>
                <div className="text-xs text-gray-500 mt-1 flex items-center justify-center gap-1">
                  {c.ok ? <CheckCircle2 size={12} className="text-emerald-500" /> : <AlertTriangle size={12} className="text-amber-500" />}
                  {c.label}
                </div>
              </div>
            ))}
          </div>

          {/* Owner digest */}
          <div className="bb-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Owner Digest</h2>
                <p className="text-sm text-gray-500">Generate a daily summary for the owner</p>
              </div>
              <button onClick={generateDigest} disabled={generating} className="bb-btn-primary">
                {generating ? 'Generating...' : 'Generate Digest'}
              </button>
            </div>
            {digest?.summary && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">${Number(digest.summary.total_revenue || 0).toFixed(2)}</div>
                  <div className="text-[10px] text-gray-500">Revenue</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">{digest.summary.total_orders || 0}</div>
                  <div className="text-[10px] text-gray-500">Orders</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">{digest.summary.active_alerts || 0}</div>
                  <div className="text-[10px] text-gray-500">Alerts</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">{digest.summary.low_stock_items || 0}</div>
                  <div className="text-[10px] text-gray-500">Low Stock</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
