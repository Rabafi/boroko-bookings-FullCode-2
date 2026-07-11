import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, TrendingUp, Search } from 'lucide-react'

const SEVERITY_COLORS = {
  ok: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  watch: 'bg-amber-100 text-amber-700 border-amber-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200'
}

export default function RestaurantRecipeVariance() {
  const [report, setReport] = useState([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')

  useEffect(() => { loadReport() }, [])

  async function loadReport() {
    try {
      setLoading(true)
      const data = await window.api.pos.getRecipeVarianceReport(startDate, endDate)
      setReport(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load variance report:', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = report.filter(r =>
    r.inventory_item_name?.toLowerCase().includes(search.toLowerCase())
  )

  const totalVarianceValue = report.reduce((sum, r) => sum + Math.abs(Number(r.variance_value) || 0), 0)
  const highVarianceCount = report.filter(r => r.severity === 'high' || r.severity === 'critical').length
  const watchCount = report.filter(r => r.severity === 'watch').length
  const unlinkedCount = report.filter(r => !r.linked_recipes || r.linked_recipes.length === 0).length

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipe Variance Report</h1>
          <p className="text-sm text-gray-500 mt-1">Theoretical vs actual ingredient usage analysis</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500">From</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bb-input ml-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">To</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bb-input ml-1" />
          </div>
          <button onClick={loadReport} className="bb-btn-primary text-sm">Load</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">${totalVarianceValue.toFixed(2)}</div>
              <div className="text-xs text-gray-500">Total Variance Value</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{highVarianceCount}</div>
              <div className="text-xs text-gray-500">High / Critical Items</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{watchCount}</div>
              <div className="text-xs text-gray-500">Watch Items</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-gray-500">{unlinkedCount}</div>
              <div className="text-xs text-gray-500">Unlinked Items</div>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search ingredients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bb-input w-full pl-10"
            />
          </div>

          {/* Variance table */}
          <div className="bb-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Ingredient</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Current Stock</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Theoretical Use</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Variance</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Value</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Severity</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Linked Recipes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-12 text-center text-gray-500">
                      {report.length === 0 ? 'No variance data for this period' : 'No matching ingredients'}
                    </td>
                  </tr>
                ) : filtered.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.inventory_item_name}</div>
                      <div className="text-xs text-gray-400">{row.unit}</div>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(row.current_stock || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{Number(row.theoretical_quantity || 0).toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${
                      row.variance_quantity > 0 ? 'text-red-600' : row.variance_quantity < 0 ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                      {row.variance_quantity != null ? Number(row.variance_quantity).toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {row.variance_value != null ? `$${Math.abs(Number(row.variance_value)).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full border ${SEVERITY_COLORS[row.severity] || 'bg-gray-100'}`}>
                        {row.severity || 'ok'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                      {row.linked_recipes?.map(r => r.recipe_name || r.menu_item).filter(Boolean).join(', ') || 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
