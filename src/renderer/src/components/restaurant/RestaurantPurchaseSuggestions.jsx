import { useState, useEffect } from 'react'
import { ShoppingCart, AlertTriangle, CheckCircle2, Package } from 'lucide-react'

export default function RestaurantPurchaseSuggestions() {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])

  useEffect(() => { loadSuggestions() }, [])

  async function loadSuggestions() {
    try {
      setLoading(true)
      const data = await window.api.pos.getLowStockPurchaseSuggestions()
      setSuggestions(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load suggestions:', err)
    } finally {
      setLoading(false)
    }
  }

  function toggleSelect(idx) {
    if (selected.includes(idx)) {
      setSelected(selected.filter(i => i !== idx))
    } else {
      setSelected([...selected, idx])
    }
  }

  function selectAll() {
    if (selected.length === suggestions.length) {
      setSelected([])
    } else {
      setSelected(suggestions.map((_, i) => i))
    }
  }

  async function convertToPo() {
    if (selected.length === 0) return
    const selectedSuggestions = selected.map(i => suggestions[i])
    const supplierId = selectedSuggestions[0]?.supplier_id
    if (!supplierId) {
      alert('Selected items must have a preferred supplier assigned')
      return
    }
    try {
      await window.api.pos.convertPurchaseSuggestionsToPo(supplierId, selectedSuggestions, 'Auto-created from low-stock suggestions')
      setSelected([])
      await loadSuggestions()
    } catch (err) {
      console.error('Failed to convert to PO:', err)
    }
  }

  const totalEstCost = selected.reduce((sum, i) => sum + (Number(suggestions[i].suggested_quantity) * Number(suggestions[i].last_unit_cost || 0)), 0)

  const grouped = suggestions.reduce((acc, s, i) => {
    const key = s.supplier_name || 'No Supplier'
    if (!acc[key]) acc[key] = []
    acc[key].push({ ...s, _idx: i })
    return acc
  }, {})

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Suggestions</h1>
          <p className="text-sm text-gray-500 mt-1">Low-stock items ready to convert into purchase orders</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadSuggestions} className="bb-btn-outline text-sm">Refresh</button>
          {selected.length > 0 && (
            <button onClick={convertToPo} className="bb-btn-primary text-sm flex items-center gap-1.5">
              <ShoppingCart size={14} /> Create PO ({selected.length} items, ~${totalEstCost.toFixed(2)})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="bb-card p-12 text-center">
          <Package size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 text-lg mb-2">No low-stock suggestions</p>
          <p className="text-gray-400 text-sm">All items are above their reorder levels</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{suggestions.length}</div>
              <div className="text-xs text-gray-500">Low Stock Items</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{Object.keys(grouped).length}</div>
              <div className="text-xs text-gray-500">Suppliers</div>
            </div>
            <div className="bb-card p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">${totalEstCost.toFixed(2)}</div>
              <div className="text-xs text-gray-500">Estimated Cost ({selected.length} items)</div>
            </div>
          </div>

          {/* Select all */}
          <div className="flex items-center justify-between">
            <button onClick={selectAll} className="text-sm text-[#174c3a] hover:underline">
              {selected.length === suggestions.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Suggestions by supplier */}
          {Object.entries(grouped).map(([supplier, items]) => (
            <div key={supplier} className="bb-card">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="font-semibold text-sm">{supplier}</h3>
              </div>
              <div className="divide-y">
                {items.map(item => (
                  <div key={item._idx} className={`p-4 flex items-center gap-4 cursor-pointer transition ${selected.includes(item._idx) ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => toggleSelect(item._idx)}>
                    <input type="checkbox" checked={selected.includes(item._idx)} onChange={() => toggleSelect(item._idx)} className="rounded" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.inventory_item_name}</div>
                      <div className="text-xs text-gray-500">
                        Current: {Number(item.current_stock).toFixed(1)} | Reorder at: {Number(item.reorder_level).toFixed(1)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-sm">Order {Number(item.suggested_quantity).toFixed(1)}</div>
                      {item.last_unit_cost && (
                        <div className="text-xs text-gray-500">@ ${Number(item.last_unit_cost).toFixed(2)} ea</div>
                      )}
                    </div>
                    <div className="text-right min-w-[80px]">
                      {item.last_unit_cost && (
                        <div className="font-medium text-sm">${(Number(item.suggested_quantity) * Number(item.last_unit_cost)).toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
