import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, UtensilsCrossed } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listRestaurantMenu } from '../lib/api'
import { isBarHospitalityMode } from '../lib/productShell'
import { money } from '../lib/format'
import EmptyState from '../components/EmptyState'

export default function RestaurantMenu() {
  const { user } = useAuth()
  const barOnly = isBarHospitalityMode(user?.hospitality_mode)
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setItems(await listRestaurantMenu(user.lodge_id)) }
    catch (loadError) { setError(loadError?.message || 'Products could not load.') }
    finally { setLoading(false) }
  }, [user.lodge_id])
  useEffect(() => { load() }, [load])
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query])

  return <div className="min-h-screen bg-gray-950 pb-24">
    <header className="bg-gray-900 px-4 pb-4 pt-12">
      <h1 className="text-lg font-bold text-white">{barOnly ? 'Bar Products' : 'Menu & Products'}</h1>
      <p className="mt-1 text-xs text-gray-400">{barOnly ? 'Live drinks, snacks and simple-food catalogue' : 'Live restaurant and bar catalogue'}</p>
      <div className="relative mt-4"><Search size={15} className="absolute left-3 top-3 text-gray-500"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={barOnly ? 'Find a drink or product' : 'Find a menu item'} className="w-full rounded-xl border border-gray-700 bg-gray-800 py-2.5 pl-9 pr-3 text-sm text-white"/></div>
    </header>
    <main className="space-y-2 px-4 py-4">
      {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {!loading && filtered.length === 0 ? <EmptyState icon={UtensilsCrossed} title={barOnly ? 'No bar products' : 'No menu items'} message="Products published to the POS catalogue appear here."/> : filtered.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-800 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{item.name}</p><p className="mt-1 text-xs text-gray-500">{item.category || 'Other'}{item.prep_time_minutes ? ` · ${item.prep_time_minutes} min` : ''}</p></div><div className="text-right"><p className="text-sm font-bold text-white">{money(item.price)}</p><p className={`mt-1 text-[10px] font-semibold uppercase ${item.is_available ? 'text-emerald-300' : 'text-rose-300'}`}>{item.is_available ? 'Available' : 'Unavailable'}</p></div></div>)}
    </main>
  </div>
}
