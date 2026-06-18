import { useState, useEffect, useCallback } from 'react'
import { DollarSign, TrendingUp, AlertTriangle, RefreshCw, Users, CreditCard } from 'lucide-react'
import { safeLoadAll, hasPartialFailures, getFailureSummary } from '../utils/safeLoad'
import { callAdminApi } from '../utils/adminApi'

const LOAD_LABELS = ['MRR/ARR', 'Revenue', 'Lodge Finances', 'Collections', 'Revenue by Method']

export default function AccountingDashboard() {
  const [mrr, setMrr] = useState(null)
  const [revenue, setRevenue] = useState(null)
  const [lodgeFin, setLodgeFin] = useState(null)
  const [collections, setCollections] = useState(null)
  const [revenueByMethod, setRevenueByMethod] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [loadWarnings, setLoadWarnings] = useState(null)
  const [tab, setTab] = useState('overview')
  const [revenueDays, setRevenueDays] = useState(90)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadWarnings(null)
    try {
      const { data, errors } = await safeLoadAll(
        callAdminApi('getMrrSummary', [], { mrr: 0, arr: 0, lodge_count: 0, trials_active: 0, by_plan: {} }),
        callAdminApi('getRevenueSummary', [revenueDays], { total_revenue: 0, payment_count: 0, avg_daily: 0, daily: [] }),
        callAdminApi('getLodgeFinancialSummary', [], { lodges: [] }),
        callAdminApi('getCollectionsQueue', [], { queue: [] }),
        callAdminApi('getRevenueByMethod', [revenueDays], { methods: [] })
      )
      const [m, r, lf, cq, rbm] = data
      setMrr(m)
      setRevenue(r)
      setLodgeFin(lf)
      setCollections(cq)
      setRevenueByMethod(rbm)
      const unavailable = data
        .map((item, i) => item?.unavailable ? LOAD_LABELS[i] : null)
        .filter(Boolean)
      if (hasPartialFailures(errors) || unavailable.length > 0) {
        const failureSummary = getFailureSummary(errors, LOAD_LABELS)
        const unavailableSummary = unavailable.length ? `Unavailable bridge: ${unavailable.join(', ')}` : null
        setLoadWarnings([failureSummary, unavailableSummary].filter(Boolean).join(' | '))
      }
    } catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [revenueDays])

  useEffect(() => { load() }, [load])

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  const totalOutstanding = lodgeFin?.lodges?.reduce((sum, l) => sum + (Number(l.total_outstanding) || 0), 0) || 0
  const collectionsTotal = collections?.queue?.reduce((sum, l) => sum + (Number(l.total_outstanding) || 0), 0) || 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Accounting Overview</h2>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {loadWarnings && !error && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
          <p className="text-amber-300 text-xs flex-1">{loadWarnings}</p>
          <button onClick={load} className="text-xs text-amber-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* MRR/ARR summary */}
      {mrr && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">MRR</p>
            <p className="text-2xl font-bold text-green-400">{fmt(mrr.mrr)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">ARR</p>
            <p className="text-2xl font-bold text-green-400">{fmt(mrr.arr)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Active Lodges</p>
            <p className="text-2xl font-bold text-white">{mrr.lodge_count}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3">
            <p className="text-[10px] uppercase text-gray-400 font-semibold">Active Trials</p>
            <p className="text-2xl font-bold text-blue-400">{mrr.trials_active}</p>
          </div>
        </div>
      )}

      {/* MRR by plan */}
      {mrr?.by_plan && Object.keys(mrr.by_plan).length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">MRR by Plan</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(mrr.by_plan).map(([plan, val]) => (
              <div key={plan} className="bg-gray-750 border border-gray-700 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase">{plan}</p>
                <p className="text-sm font-bold text-white">{fmt(val)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {['overview', 'lodges', 'revenue', 'collections', 'methods'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors capitalize ${tab === t ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t === 'methods' ? 'By Method' : t}
          </button>
        ))}
      </div>

      {/* Lodge financial summary tab */}
      {tab === 'lodges' && (
        <div className="space-y-3">
          {lodgeFin?.lodges?.length > 0 ? (
            <>
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 mb-2">Total Outstanding: <span className="text-amber-400">{fmt(totalOutstanding)}</span></p>
              </div>
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Lodge</th>
                      <th className="px-4 py-3 text-right">Bookings</th>
                      <th className="px-4 py-3 text-right">Revenue</th>
                      <th className="px-4 py-3 text-right">Collected</th>
                      <th className="px-4 py-3 text-right">Outstanding</th>
                      <th className="px-4 py-3 text-right">Unpaid</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {lodgeFin.lodges.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-750">
                        <td className="px-4 py-3 text-white text-xs">{row.lodge_name || 'Unknown'}</td>
                        <td className="px-4 py-3 text-right text-xs text-gray-300">{row.total_bookings}</td>
                        <td className="px-4 py-3 text-right text-xs text-gray-300">{fmt(row.total_revenue)}</td>
                        <td className="px-4 py-3 text-right text-xs text-green-300">{fmt(row.total_collected)}</td>
                        <td className="px-4 py-3 text-right text-xs text-amber-300">{fmt(row.total_outstanding)}</td>
                        <td className="px-4 py-3 text-right text-xs text-red-300">{row.unpaid_count}</td>
                        <td className="px-4 py-3 text-right text-xs text-green-300">{row.paid_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">No lodge data available.</div>
          )}
        </div>
      )}

      {/* Revenue tab */}
      {tab === 'revenue' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select value={revenueDays} onChange={e => setRevenueDays(Number(e.target.value))}
              className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last year</option>
            </select>
          </div>
          {revenue && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-[10px] uppercase text-gray-400 font-semibold">Total Revenue</p>
                  <p className="text-xl font-bold text-green-400">{fmt(revenue.total_revenue)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-[10px] uppercase text-gray-400 font-semibold">Payments</p>
                  <p className="text-xl font-bold text-white">{revenue.payment_count}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-[10px] uppercase text-gray-400 font-semibold">Avg Daily</p>
                  <p className="text-xl font-bold text-white">{fmt(revenue.avg_daily)}</p>
                </div>
              </div>
              {revenue.daily?.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-400 mb-2">Daily Revenue</p>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {revenue.daily.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-700/50">
                        <span className="text-gray-400">{new Date(d.date).toLocaleDateString()}</span>
                        <span className="text-white font-medium">{fmt(d.total)}</span>
                        <span className="text-gray-500">{d.payment_count} payments</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Collections tab */}
      {tab === 'collections' && (
        <div className="space-y-3">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-1">Total Outstanding: <span className="text-amber-400">{fmt(collectionsTotal)}</span></p>
            <p className="text-[10px] text-gray-500">{collections?.queue?.length || 0} lodges with unpaid balances</p>
          </div>
          {collections?.queue?.length > 0 ? (
            <div className="space-y-3">
              {collections.queue.map((lodge, i) => (
                <div key={i} className="bg-gray-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{lodge.lodge_name || 'Unknown'}</p>
                      <p className="text-[10px] text-gray-500">{lodge.booking_count} unpaid booking{lodge.booking_count !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-400">{fmt(lodge.total_outstanding)}</p>
                      <p className="text-[10px] text-red-400">up to {lodge.max_days_overdue} days overdue</p>
                    </div>
                  </div>
                  {lodge.bookings?.length > 0 && (
                    <div className="divide-y divide-gray-700">
                      {lodge.bookings.map((b, j) => (
                        <div key={j} className="px-4 py-2 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-white font-medium">{b.booking_number}</span>
                            <span className="text-gray-500 ml-2">{b.guest_name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-amber-300 font-mono">{fmt(b.balance)}</span>
                            <span className="text-gray-500">{b.days_overdue}d overdue</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">
              <Users size={32} className="mx-auto mb-3 opacity-40" />
              <p>No outstanding balances. All clear!</p>
            </div>
          )}
        </div>
      )}

      {/* Revenue by Method tab */}
      {tab === 'methods' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select value={revenueDays} onChange={e => setRevenueDays(Number(e.target.value))}
              className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5">
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>
          {revenueByMethod?.methods?.length > 0 ? (
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Payments</th>
                    <th className="px-4 py-3 text-right">Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {revenueByMethod.methods.map((m, i) => (
                    <tr key={i} className="hover:bg-gray-750">
                      <td className="px-4 py-3 text-white text-xs flex items-center gap-2">
                        <CreditCard size={12} className="text-gray-400" />
                        {m.method}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-green-300 font-medium">{fmt(m.total)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-300">{m.payment_count}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-300">{fmt(m.total / Math.max(1, m.payment_count))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">No payment method data available.</div>
          )}
        </div>
      )}

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-2">Revenue Snapshot</p>
            <p className="text-lg font-bold text-green-400">{fmt(revenue?.total_revenue)} (last {revenueDays}d)</p>
            <p className="text-[11px] text-gray-500 mt-1">{revenue?.payment_count || 0} payments | avg {fmt(revenue?.avg_daily)}/day</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-2">Outstanding Balances</p>
            <p className="text-lg font-bold text-amber-400">{fmt(totalOutstanding)}</p>
            <p className="text-[11px] text-gray-500 mt-1">{lodgeFin?.lodges?.filter(l => l.total_outstanding > 0).length || 0} lodges with balance</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-2">Subscription Base</p>
            <p className="text-lg font-bold text-white">{mrr?.lodge_count || 0} paying lodges</p>
            <p className="text-[11px] text-gray-500 mt-1">{mrr?.trials_active || 0} active trials</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-2">Collection Rate</p>
            <p className="text-lg font-bold text-white">
              {lodgeFin?.lodges?.length ? Math.round((lodgeFin.lodges.reduce((s, l) => s + Number(l.total_collected || 0), 0) / Math.max(1, lodgeFin.lodges.reduce((s, l) => s + Number(l.total_revenue || 0), 1))) * 100) : 0}%
            </p>
            <p className="text-[11px] text-gray-500 mt-1">collected vs billed</p>
          </div>
        </div>
      )}
    </div>
  )
}
