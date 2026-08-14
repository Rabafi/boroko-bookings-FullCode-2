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
      if (result?.success === false) throw new Error(result.error || 'Failed to generate digest')
      setDigest(result?.digest || result?.summary || result)
    } catch (err) {
      console.error('Failed to generate digest:', err)
      setError(err.message || 'Failed to generate digest')
    } finally {
      setLoading(false)
    }
  }

  const s = digest?.summary || digest || {}
  const financialReady = s.financial_complete === true && [s.total_revenue, s.total_orders, s.avg_order]
    .every((value) => Number.isFinite(Number(value)))

  return (
    <div className="restaurant-native-page max-w-5xl">
      <div className="restaurant-native-hero">
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
        <div className="restaurant-native-empty">
          <div className="text-gray-300 mb-3">
            <TrendingUp size={48} className="mx-auto" />
          </div>
          <p className="text-gray-500 text-lg mb-2">No digest generated yet</p>
          <p className="text-gray-400 text-sm">Click "Generate Digest" to create today's performance snapshot</p>
        </div>
      )}

      {loading && (
        <div className="restaurant-native-loading restaurant-native-panel p-12 text-center">
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
          <div className="restaurant-native-kpis">
            <MetricCard icon={Wallet} label="Revenue" value={financialReady ? `P ${Number(s.total_revenue).toFixed(2)}` : 'Unavailable'} color="emerald" />
            <MetricCard icon={ShoppingCart} label="Orders" value={financialReady ? s.total_orders : 'Unavailable'} color="blue" />
            <MetricCard icon={TrendingUp} label="Avg Order" value={financialReady ? `P ${Number(s.avg_order).toFixed(2)}` : 'Unavailable'} color="purple" />
            <MetricCard icon={Users} label="Customers" value={s.total_customers == null ? 'Unavailable' : s.total_customers} color="indigo" />
          </div>
          {!financialReady && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Revenue and order totals are unavailable until the server certifies a complete POS source. This digest is not a financial statement.</div>}

          {/* Operational status */}
          <div className="restaurant-native-kpis">
            <StatusCard icon={AlertTriangle} label="Active Alerts" value={s.active_alerts || 0} warn={s.active_alerts > 0} />
            <StatusCard icon={Package} label="Low Stock" value={s.low_stock_items || 0} warn={s.low_stock_items > 0} />
            <StatusCard icon={ClipboardCheck} label="Open Checklists" value={s.open_checklists || 0} warn={s.open_checklists > 0} />
            <StatusCard icon={ShoppingCart} label="Pending Orders" value={s.pending_orders || 0} warn={s.pending_orders > 0} />
          </div>

          {/* Expense summary */}
          {s.expenses_complete === true && Number.isFinite(Number(s.total_expenses)) && (
            <div className="bb-card p-5">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Expenses</h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Expenses</span>
                <span className="text-lg font-bold text-red-600">P {Number(s.total_expenses).toFixed(2)}</span>
              </div>
              {financialReady && Number(s.total_revenue) > 0 && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                  <span className="text-sm text-gray-500">Net (Revenue - Expenses)</span>
                  <span className={`text-lg font-bold ${(Number(s.total_revenue) - Number(s.total_expenses)) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    P {(Number(s.total_revenue) - Number(s.total_expenses)).toFixed(2)}
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
