import { useState, useEffect } from 'react'

export default function RestaurantStock() {
  const [items, setItems] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStock()
  }, [])

  async function loadStock() {
    try {
      setLoading(true)
      const [allItems, low] = await Promise.all([
        window.api.inventory.getItems(),
        window.api.inventory.getLowStock()
      ])
      setItems(Array.isArray(allItems) ? allItems : [])
      setLowStock(Array.isArray(low) ? low : [])
    } catch (err) {
      console.error('Failed to load stock:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Control</h1>
          <p className="text-sm text-gray-500 mt-1">Inventory levels, adjustments, and wastage tracking</p>
        </div>
        <button onClick={loadStock} className="bb-btn-outline text-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <>
          {lowStock.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-red-700 mb-3">Low Stock Alert ({lowStock.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStock.map((item) => (
                  <div key={item.id} className="bb-card p-4 border-l-4 border-red-400">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-sm text-red-600">
                      {item.current_stock ?? 0} remaining (reorder at {item.reorder_level ?? 0})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bb-card">
            <div className="p-4 border-b">
              <h2 className="font-semibold">All Items ({items.length})</h2>
            </div>
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No inventory items</div>
              ) : items.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-xs text-gray-500">{item.category || 'Uncategorized'}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${(item.current_stock ?? 0) <= 0 ? 'text-red-600' : (item.current_stock ?? 0) <= (item.reorder_level ?? 0) ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {item.current_stock ?? 0} {item.unit || ''}
                    </div>
                    {item.unit_cost != null && (
                      <div className="text-xs text-gray-500">${Number(item.unit_cost).toFixed(2)}/{item.unit || 'unit'}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
