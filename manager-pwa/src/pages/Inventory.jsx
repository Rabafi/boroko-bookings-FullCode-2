import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listInventory } from '../lib/api'
import { money } from '../lib/format'

export default function Inventory() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await listInventory(user.lodge_id).catch(() => [])
    setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Inventory</h1>
            <p className="text-xs text-gray-400">Stock levels, low-stock alerts, and replenishment</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        <div className="rounded-2xl border border-blue-900 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">
          Inventory is view-only in the manager mobile app. Use the front desk or desktop to adjust stock.
        </div>
        {items.map((item) => {
          const low = Number(item.reorder_level || 0) > 0 && Number(item.current_stock || 0) <= Number(item.reorder_level || 0)
          return (
            <div key={item.id} className={`rounded-2xl p-4 ${low ? 'bg-red-950/30 border border-red-900' : 'bg-gray-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{item.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{item.category || 'Inventory'} • {item.unit || 'unit'}</p>
                  <p className={`text-xs mt-2 ${low ? 'text-red-300' : 'text-gray-500'}`}>
                    {low ? <><AlertTriangle size={12} className="inline mr-1" />Low stock</> : `Reorder at ${item.reorder_level || 0}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">{item.current_stock || 0}</p>
                  <p className="text-xs text-gray-500">{item.unit}</p>
                  {Number(item.latest_unit_cost || 0) > 0 && <p className="text-xs text-gray-400 mt-1">{money(item.latest_unit_cost)}</p>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
