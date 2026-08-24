import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, TrendingUp, Search } from 'lucide-react'
import { useSettings } from '../../app-context'
import { isBarOnlyMode } from '../../../../shared/propertyTypes'
import { unpackTransport } from '../../transportUnpack'

const SEVERITY_COLORS = {
  ok: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  watch: 'bg-amber-100 text-amber-700 border-amber-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200'
}

export default function RestaurantRecipeVariance() {
  const { settings } = useSettings()
  const barOnly = isBarOnlyMode(settings)
  const [report, setReport] = useState([])
  const [preparationLosses, setPreparationLosses] = useState([])
  const [preparationLossIngredients, setPreparationLossIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [sourceComplete, setSourceComplete] = useState(false)
  const [startDate, setStartDate] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { loadReport() }, [])

  async function loadReport() {
    if (startDate > endDate) {
      setError('The start date must be on or before the end date.')
      return
    }
    try {
      setLoading(true)
      setError('')
      const pos = window.api?.pos
      if (typeof pos?.getRecipePreparationLosses !== 'function' || typeof pos?.getRecipePreparationLossIngredientSummary !== 'function') {
        throw new Error('This report needs the latest desktop update. Close every Tsa Bonno window and reopen the app, then try again.')
      }
      const [data, losses, ingredients] = await Promise.all([
        pos.getRecipeVarianceReport(startDate, endDate).then(unpackTransport),
        pos.getRecipePreparationLosses(startDate, endDate).then(unpackTransport),
        pos.getRecipePreparationLossIngredientSummary(startDate, endDate).then(unpackTransport)
      ])
      const reportReady = Array.isArray(data) && data._source === 'server' && data._complete === true
      const lossesReady = Array.isArray(losses) && losses._source === 'server' && losses._complete === true
      const ingredientsReady = Array.isArray(ingredients) && ingredients._source === 'server' && ingredients._complete === true
      setSourceComplete(reportReady && lossesReady && ingredientsReady)
      setReport(Array.isArray(data) ? data : [])
      setPreparationLosses(Array.isArray(losses) ? losses : [])
      setPreparationLossIngredients(Array.isArray(ingredients) ? ingredients : [])
      if (!(reportReady && lossesReady && ingredientsReady)) setError('Variance evidence is unavailable until the server confirms complete report sources. No cached or estimated cost is shown as financial truth.')
    } catch (err) {
      console.error('Failed to load variance report:', err)
      setError(err.message || 'Could not load recipe variance.')
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
  const totalPreparationLoss = preparationLosses.reduce((sum, row) => sum + (Number(row.preparation_loss_cost) || 0), 0)

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{barOnly ? 'Drink & Prep Variance' : 'Recipe Variance Report'}</h1>
          <p className="text-sm text-gray-500 mt-1">{barOnly ? 'Compare expected cocktail and prepared-portion use with actual bar stock movement.' : 'Theoretical vs actual ingredient usage analysis'}</p>
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

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="restaurant-native-kpis">
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{sourceComplete ? `P ${totalVarianceValue.toFixed(2)}` : 'Unavailable'}</div>
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

          <section className="bb-card overflow-hidden">
            <div className="border-b border-amber-100 bg-amber-50 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle size={18} /> Preparation loss</h2>
                  <p className="mt-1 text-xs text-amber-800">Cancelled food and cocktails whose ingredients were already prepared. The sale revenue is voided, but the ingredients remain consumed. This is operational waste, not financial revenue.</p>
                </div>
                <div className="text-right">
              <div className="text-lg font-bold text-amber-900">{sourceComplete ? `P ${totalPreparationLoss.toFixed(2)}` : 'Unavailable'}</div>
                  <div className="text-xs text-amber-800">{sourceComplete ? `${preparationLosses.length} cancellation${preparationLosses.length === 1 ? '' : 's'}` : 'Unavailable'}</div>
                </div>
              </div>
            </div>
            {preparationLosses.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No recipe-based preparation losses were recorded for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium text-gray-600">Date / receipt</th>
                      <th className="px-4 py-3 font-medium text-gray-600">Prepared items</th>
                      <th className="px-4 py-3 font-medium text-gray-600">Reason</th>
                      <th className="px-4 py-3 font-medium text-gray-600">Operator / approved by</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Frozen recipe cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preparationLosses.map((loss, index) => (
                      <tr key={`${loss.receipt_number || loss.order_number || 'loss'}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3"><div>{loss.business_date}</div><div className="text-xs text-gray-500">{loss.receipt_number || loss.order_number || 'Receipt unavailable'}</div></td>
                        <td className="px-4 py-3 font-medium text-gray-800">{loss.item_names}</td>
                        <td className="px-4 py-3 text-gray-600">{loss.reason}</td>
                        <td className="px-4 py-3 text-gray-600"><div>{loss.operator_name}</div><div className="text-xs text-gray-500">Approved by {loss.approved_by_name}</div></td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">{sourceComplete && Number.isFinite(Number(loss.preparation_loss_cost)) ? `P ${Number(loss.preparation_loss_cost).toFixed(2)}` : 'Unavailable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">Cost is taken from the recipe stock movement recorded at the time of sale, not from today’s recipe price. Investigate preparation losses; do not make a stock adjustment from this report.</p>
          </section>

          <section className="bb-card overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-4">
              <h2 className="font-semibold text-gray-900">Preparation loss by ingredient</h2>
              <p className="mt-1 text-xs text-gray-500">Physical quantity lost and its share of recipe consumption in this period. For example, 2 L lost out of 18 L used in recipes is 11.11%. This is not a percentage of stock bought: purchases, opening stock and closing counts are tracked separately.</p>
            </div>
            {preparationLossIngredients.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No ingredient quantity was lost through prepared-item cancellations for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left"><tr>
                    <th className="px-4 py-3 font-medium text-gray-600">Ingredient</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Lost in preparation</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Total recipe use</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Loss share</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {preparationLossIngredients.map((ingredient, index) => (
                      <tr key={`${ingredient.inventory_item_name}-${ingredient.unit}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{ingredient.inventory_item_name}</td>
                        <td className="px-4 py-3 text-right text-amber-800">{sourceComplete && Number.isFinite(Number(ingredient.preparation_loss_quantity)) ? `${Number(ingredient.preparation_loss_quantity).toFixed(2)} ${ingredient.unit}` : 'Unavailable'}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{sourceComplete && Number.isFinite(Number(ingredient.total_recipe_quantity)) ? `${Number(ingredient.total_recipe_quantity).toFixed(2)} ${ingredient.unit}` : 'Unavailable'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">{sourceComplete && Number.isFinite(Number(ingredient.loss_percentage)) ? `${Number(ingredient.loss_percentage).toFixed(2)}%` : 'Unavailable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

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
                      {row.variance_value != null ? `P ${Math.abs(Number(row.variance_value)).toFixed(2)}` : '-'}
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
          <p className="restaurant-native-financial-warning">Variance is an investigation signal, not an automatic stock adjustment. Confirm counts, waste and recipe setup before changing stock.</p>
        </div>
      )}
    </div>
  )
}
