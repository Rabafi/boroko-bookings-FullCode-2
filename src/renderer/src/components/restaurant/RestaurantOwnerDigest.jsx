import { useState } from 'react'
import { RefreshCw, TrendingUp, ShoppingCart, Users, AlertTriangle, Package, ClipboardCheck, Wallet } from 'lucide-react'

export default function RestaurantOwnerDigest() {
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function generateDigest() {
    try {
      setLoading(true)
      setError(null)
      const result = await window.api.pos.generateOwnerDigest()
      setDigest(result)
    } catch (err) {
      console.error('Failed to generate digest:', err)
      setError(err.message || 'Failed to generate digest')
    } finally {
      setLoading(false)
    }
  }

  const s = digest?.summary || digest || {}

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Owner Digest</h1>
          <p className="text-sm text-gray-500 mt-1">Daily performance snapshot for the restaurant owner</p>
        </div>
        <button onClick={generateDigest} disabled={loading} className="bb-btn-primary flex items-center gap-2">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {loading ? 'Generating...' : 'Generate Digest'}
        </button>
      </div>

      {error && (
        <div className="mb-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">{error}</div>
      )}

      {!digest && !loading && (
        <div className="bb-card p-12 text-center">
          <div className="text-gray-300 mb-3">
            <TrendingUp size={48} className="mx-auto" />
          </div>
          <p className="text-gray-500 text-lg mb-2">No digest generated yet</p>
          <p className="text-gray-400 text-sm">Click "Generate Digest" to create today's performance snapshot</p>
        </div>
      )}

      {loading && (
        <div className="bb-card p-12 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent mx-auto mb-4" />
          <p className="text-gray-500">Compiling daily performance data...</p>
        </div>
      )}

      {digest && !loading && (
        <div className="space-y-6">
          {/* Date header */}
          {s.date && (
            <div className="text-center text-sm text-gray-500">
              Report for <span className="font-semibold text-gray-700">{s.date}</span>
              {s.generated_at && <span className="ml-2 text-gray-400">generated at {new Date(s.generated_at).toLocaleTimeString()}</span>}
            </div>
          )}

          {/* Revenue metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard icon={Wallet} label="Revenue" value={`$${Number(s.total_revenue || 0).toFixed(2)}`} color="emerald" />
            <MetricCard icon={ShoppingCart} label="Orders" value={s.total_orders || 0} color="blue" />
            <MetricCard icon={TrendingUp} label="Avg Order" value={`$${Number(s.avg_order || 0).toFixed(2)}`} color="purple" />
            <MetricCard icon={Users} label="Customers" value={s.total_customers || 0} color="indigo" />
          </div>

          {/* Operational status */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatusCard icon={AlertTriangle} label="Active Alerts" value={s.active_alerts || 0} warn={s.active_alerts > 0} />
            <StatusCard icon={Package} label="Low Stock" value={s.low_stock_items || 0} warn={s.low_stock_items > 0} />
            <StatusCard icon={ClipboardCheck} label="Open Checklists" value={s.open_checklists || 0} warn={s.open_checklists > 0} />
            <StatusCard icon={ShoppingCart} label="Pending Orders" value={s.pending_orders || 0} warn={s.pending_orders > 0} />
          </div>

          {/* Expense summary */}
          {s.total_expenses != null && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Expenses</h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Expenses</span>
                <span className="text-lg font-bold text-red-600">${Number(s.total_expenses || 0).toFixed(2)}</span>
              </div>
              {s.total_revenue > 0 && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                  <span className="text-sm text-gray-500">Net (Revenue - Expenses)</span>
                  <span className={`text-lg font-bold ${(Number(s.total_revenue || 0) - Number(s.total_expenses || 0)) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    ${(Number(s.total_revenue || 0) - Number(s.total_expenses || 0)).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Staff summary */}
          {s.staff_on_duty != null && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Staff</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500">On Duty</div>
                  <div className="text-xl font-bold text-gray-800">{s.staff_on_duty}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Cash Drawer</div>
                  <div className="text-xl font-bold text-gray-800">{s.cash_drawer_status || 'N/A'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Top items */}
          {Array.isArray(s.top_items) && s.top_items.length > 0 && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Top Selling Items</h3>
              <div className="space-y-2">
                {s.top_items.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                      {item.name || item.item_name}
                    </span>
                    <span className="text-gray-500">{item.quantity_sold || item.count || 0} sold</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alerts list */}
          {Array.isArray(s.alerts) && s.alerts.length > 0 && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Active Alerts</h3>
              <div className="space-y-2">
                {s.alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                    <span>{alert.message || alert}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, color }) {
  const colors = {
    emerald: 'text-emerald-600 bg-emerald-50',
    blue: 'text-blue-600 bg-blue-50',
    purple: 'text-purple-600 bg-purple-50',
    indigo: 'text-indigo-600 bg-indigo-50'
  }
  return (
    <div className={`bb-card p-4 text-center ${colors[color] || ''}`}>
      <Icon size={18} className="mx-auto mb-2 opacity-60" />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function StatusCard({ icon: Icon, label, value, warn }) {
  return (
    <div className={`bb-card p-4 text-center ${warn ? 'bg-amber-50' : 'bg-emerald-50'}`}>
      <Icon size={18} className={`mx-auto mb-2 ${warn ? 'text-amber-500' : 'text-emerald-500'}`} />
      <div className={`text-xl font-bold ${warn ? 'text-amber-700' : 'text-emerald-700'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
