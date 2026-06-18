import { useState, useCallback } from 'react'
import { Search, Building2, Home, Receipt, LifeBuoy, Users, Server, X } from 'lucide-react'

const TYPE_ICONS = {
  company: Building2,
  lodge: Home,
  invoice: Receipt,
  ticket: LifeBuoy,
  lead: Users,
  device: Server
}

const TYPE_COLORS = {
  company: 'text-blue-400',
  lodge: 'text-purple-400',
  invoice: 'text-green-400',
  ticket: 'text-amber-400',
  lead: 'text-cyan-400',
  device: 'text-red-400'
}

const TYPE_NAV_MAP = {
  lodge: 'companies',
  license: 'licensing',
  ticket: 'tickets',
  lead: 'leads',
  device: 'fleet',
  invoice: 'finance'
}

export default function GlobalSearch({ onNavigate, onOpenCompany, companies = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async () => {
    if (query.trim().length < 2) return
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const res = await window.api.admin.globalSearch(query.trim())
      setResults(res?.results || [])
    } catch (e) { setError(e?.message || 'Search failed'); setResults([]) }
    setLoading(false)
  }, [query])

  const onKeyDown = (e) => { if (e.key === 'Enter') search() }

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Search className="text-purple-400" size={20} />
        <h2 className="text-white font-semibold text-lg">Global Search</h2>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search companies, invoices, tickets, leads, devices..."
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg pl-9 pr-3 py-2.5 focus:border-purple-500 focus:outline-none" />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setSearched(false) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X size={12} />
            </button>
          )}
        </div>
        <button onClick={search} disabled={loading || query.trim().length < 2}
          className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50">
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 text-red-300 text-xs">{error}</div>
      )}

      {/* Results */}
      {!loading && searched && results.length === 0 && !error && (
        <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">
          <Search size={32} className="mx-auto mb-3 opacity-40" />
          <p>No results for "{query}"</p>
        </div>
      )}

      {Object.entries(grouped).map(([type, items]) => {
        const Icon = TYPE_ICONS[type] || Search
        return (
          <div key={type} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon size={14} className={TYPE_COLORS[type]} />
              <span className="text-xs font-semibold text-gray-400 uppercase">{type}s ({items.length})</span>
            </div>
            <div className="bg-gray-800 rounded-xl divide-y divide-gray-700">
              {items.map((item, i) => (
                <div key={i} onClick={() => {
                  // Deep-link: if result has a lodge_id, open Client360 directly
                  if (item.lodge_id && onOpenCompany) {
                    const match = companies.find(c => c.lodge_id === item.lodge_id)
                    if (match) { onOpenCompany(match); return }
                  }
                  if (onNavigate) onNavigate(TYPE_NAV_MAP[item.type] || 'companies')
                }}
                  className="px-4 py-3 hover:bg-gray-750 cursor-pointer transition-colors">
                  <p className="text-sm text-white font-medium">{item.title}</p>
                  <p className="text-[11px] text-gray-500">{item.subtitle}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
