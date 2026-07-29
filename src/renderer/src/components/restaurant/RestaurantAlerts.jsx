import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

export default function RestaurantAlerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active')
  const [error, setError] = useState('')
  const [resolvingId, setResolvingId] = useState(null)

  useEffect(() => { loadAlerts() }, [])

  async function loadAlerts() {
    try {
      setLoading(true)
      setError('')
      // The Active/Resolved/All filters need the complete, authorised history.
      // getActiveAlerts deliberately omits resolved rows and would make the
      // latter two filters appear broken after an operator resolves an alert.
      const data = await window.api.pos.getExceptionAlerts()
      setAlerts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load alerts:', err)
      setError(err.message || 'Could not load restaurant alerts.')
    } finally {
      setLoading(false)
    }
  }

  async function resolveAlert(alertId) {
    if (!window.confirm('Mark this alert resolved? Confirm that the underlying issue has already been handled.')) return
    try {
      setResolvingId(alertId)
      setError('')
      const result = await window.api.pos.resolveAlert(alertId)
      if (result?.success === false) throw new Error(result.error || 'Could not resolve alert.')
      await loadAlerts()
    } catch (err) {
      console.error('Failed to resolve alert:', err)
      setError(err.message || 'Could not resolve alert.')
    } finally {
      setResolvingId(null)
    }
  }

  const filtered = alerts.filter(a => {
    if (filter === 'active') return !a.is_resolved
    if (filter === 'resolved') return a.is_resolved
    return true
  })

  const severityColor = (s) => {
    switch (s) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200'
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-200'
      case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200'
      case 'low': return 'bg-blue-100 text-blue-700 border-blue-200'
      default: return 'bg-gray-100 text-gray-600 border-gray-200'
    }
  }

  return (
    <div className="restaurant-native-page max-w-5xl">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">Stock, cash, and operational alerts</p>
        </div>
        <div className="restaurant-native-segmented">
          {['active', 'resolved', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === f ? 'bg-[#174c3a] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={loadAlerts} className="restaurant-secondary-action px-3" title="Refresh alerts" aria-label="Refresh alerts">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="restaurant-native-loading">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
          <div className="restaurant-native-empty">
          <p className="text-gray-500 text-lg mb-2">{filter === 'active' ? 'No active alerts' : 'No alerts'}</p>
          <p className="text-gray-400 text-sm">All clear</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(alert => (
            <div key={alert.id} className={`bb-card p-4 border-l-4 ${
              alert.is_resolved ? 'border-gray-300 opacity-60' :
              alert.severity === 'critical' ? 'border-red-500' :
              alert.severity === 'high' ? 'border-orange-500' :
              alert.severity === 'medium' ? 'border-amber-500' : 'border-blue-500'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${severityColor(alert.severity)}`}>
                      {alert.severity || 'info'}
                    </span>
                    <span className="text-xs text-gray-500">{alert.alert_type}</span>
                    {alert.entity_type && <span className="text-xs text-gray-400">• {alert.entity_type}</span>}
                  </div>
                  <p className="text-sm">{alert.message}</p>
                  <span className="text-xs text-gray-400 mt-1 block">
                    {alert.created_at ? new Date(alert.created_at).toLocaleString() : ''}
                  </span>
                </div>
                {!alert.is_resolved && (
                  <button onClick={() => resolveAlert(alert.id)} disabled={resolvingId === alert.id} className="bb-btn-outline text-xs ml-4">
                    {resolvingId === alert.id ? 'Resolving…' : 'Resolve'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
