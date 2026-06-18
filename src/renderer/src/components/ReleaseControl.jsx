import { useState, useEffect, useCallback } from 'react'
import { Rocket, Clock, CheckCircle, AlertTriangle, AlertCircle, RefreshCw, Calendar } from 'lucide-react'
import Pagination, { usePagination } from './shared/Pagination'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function timeUntil(dateStr) {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `in ${days}d`
}

const STATUS_STYLE = {
  active:   { icon: CheckCircle,   color: 'text-green-400',  bg: 'bg-green-500/10',  label: 'Active' },
  scheduled:{ icon: Clock,         color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'Scheduled' },
  expired:  { icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'Expired' }
}

export default function ReleaseControl() {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expiring, setExpiring] = useState(false)
  const [filter, setFilter] = useState('all') // all | active | scheduled | expired

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.api.admin.getScheduledReleases()
      setReleases(data || [])
    } catch (err) {
      setError(err?.message || 'Failed to load releases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = releases.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})

  const filtered = filter === 'all' ? releases : releases.filter(r => r.status === filter)
  const { page, setPage, totalPages, paginated } = usePagination(filtered)

  const runExpiry = async () => {
    setExpiring(true)
    const result = await window.api.admin.expireOverdueFeatures()
    alert(`Expired ${result?.count || 0} overdue feature(s)`)
    load()
    setExpiring(false)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Feature Release Viewer</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runExpiry}
            disabled={expiring}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50"
          >
            <Clock size={13} className={expiring ? 'animate-spin' : ''} /> Run Expiry Check
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {['all', 'active', 'scheduled', 'expired'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              filter === s
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)} ({s === 'all' ? releases.length : (counts[s] || 0)})
          </button>
        ))}
      </div>

      {/* Release list */}
      {loading ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <div className="animate-pulse">Loading releases...</div>
        </div>
      ) : error ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 flex items-center gap-1.5 mx-auto text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : releases.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <Rocket size={32} className="mx-auto mb-3 opacity-40" />
          <p>No scheduled releases.</p>
          <p className="text-xs text-gray-600 mt-1">Set expiry dates on feature flags to schedule releases.</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Lodge</th>
                <th className="px-4 py-3 text-left">Feature</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Expires</th>
                <th className="px-4 py-3 text-left">Review</th>
                <th className="px-4 py-3 text-left">Granted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {paginated.map((r, i) => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE.active
                const Icon = st.icon
                return (
                  <tr key={`${r.lodge_id}-${r.feature_name}`} className={`hover:bg-gray-750 ${i % 2 === 1 ? 'bg-gray-800/60' : ''}`}>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                        <Icon size={12} /> {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-300">{r.lodge_name || r.lodge_id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-purple-300 font-medium">{r.feature_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-48 truncate">{r.reason || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.expires_at ? (
                        <div>
                          <span className="text-gray-300">{new Date(r.expires_at).toLocaleDateString()}</span>
                          <span className={`ml-1.5 text-[10px] ${r.status === 'expired' ? 'text-red-400' : 'text-amber-400'}`}>
                            {timeUntil(r.expires_at)}
                          </span>
                        </div>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.review_at ? (
                        <div className="flex items-center gap-1">
                          <Calendar size={10} className="text-gray-500" />
                          <span className="text-gray-300">{new Date(r.review_at).toLocaleDateString()}</span>
                        </div>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(r.granted_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
