import { useState, useEffect, useCallback } from 'react'
import { Activity, Server, Wifi, WifiOff, CheckCircle, AlertTriangle, AlertCircle, RefreshCw, Monitor } from 'lucide-react'

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function StatusDot({ stale, failed }) {
  if (failed) return <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
  if (stale) return <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
  return <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
}

function StatCard({ label, value, color = 'text-white', icon: Icon }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-3">
      {Icon && <div className="p-2 bg-gray-700 rounded-lg"><Icon size={16} className={color} /></div>}
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </div>
  )
}

export default function FleetHealth() {
  const [devices, setDevices] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rollup, sum] = await Promise.all([
        window.api.admin.getFleetHealthRollup(),
        window.api.admin.getFleetHealthSummary()
      ])
      setDevices(rollup || [])
      setSummary(sum)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err?.message || 'Failed to load fleet health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [load])

  // Group devices by lodge
  const byLodge = devices.reduce((acc, d) => {
    const key = d.lodge_name || d.lodge_id?.slice(0, 8) || 'Unknown'
    if (!acc[key]) acc[key] = { lodge_id: d.lodge_id, devices: [] }
    acc[key].devices.push(d)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Fleet Health</h2>
          {lastRefresh && (
            <span className="text-xs text-gray-500">Updated {timeAgo(lastRefresh)}</span>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total Devices" value={summary.total_devices} icon={Server} color="text-white" />
          <StatCard label="Healthy" value={summary.healthy_devices} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Stale (>10m)" value={summary.stale_devices} icon={AlertTriangle} color="text-amber-400" />
          <StatCard label="Failed" value={summary.failed_devices} icon={WifiOff} color="text-red-400" />
          <StatCard label="Lodges Reporting" value={summary.total_lodges} icon={Monitor} color="text-blue-400" />
        </div>
      )}

      {/* Device list grouped by lodge */}
      {loading && devices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <div className="animate-pulse">Loading fleet health...</div>
        </div>
      ) : error ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 flex items-center gap-1.5 mx-auto text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <Server size={32} className="mx-auto mb-3 opacity-40" />
          <p>No devices reporting yet.</p>
          <p className="text-xs text-gray-600 mt-1">Devices will appear here once they publish health reports.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byLodge).map(([lodgeName, { lodge_id, devices: lodgeDevices }]) => (
            <div key={lodge_id || lodgeName} className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{lodgeName}</span>
                  <span className="text-xs text-gray-500">{lodgeDevices.length} device{lodgeDevices.length !== 1 ? 's' : ''}</span>
                </div>
                {lodgeDevices.some(d => d.failed_queue > 0) && (
                  <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Issues detected</span>
                )}
              </div>
              <div className="divide-y divide-gray-700">
                {lodgeDevices.map(d => (
                  <div key={d.device_id} className="flex items-center gap-3 px-4 py-2.5">
                    <StatusDot stale={d.stale} failed={d.failed_queue > 0} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-200 font-mono text-xs">{d.device_id?.slice(0, 12)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.client_type === 'desktop' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                          {d.client_type || 'unknown'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
                        <span>Last sync: {timeAgo(d.last_sync_at)}</span>
                        <span>Reported: {timeAgo(d.reported_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-center">
                        <p className={`font-mono ${d.pending_queue > 0 ? 'text-amber-400' : 'text-gray-500'}`}>{d.pending_queue || 0}</p>
                        <p className="text-[10px] text-gray-600">Pending</p>
                      </div>
                      <div className="text-center">
                        <p className={`font-mono ${d.failed_queue > 0 ? 'text-red-400' : 'text-gray-500'}`}>{d.failed_queue || 0}</p>
                        <p className="text-[10px] text-gray-600">Failed</p>
                      </div>
                      <div className="text-center">
                        <p className={`font-mono ${d.unresolved > 0 ? 'text-orange-400' : 'text-gray-500'}`}>{d.unresolved || 0}</p>
                        <p className="text-[10px] text-gray-600">Unresolved</p>
                      </div>
                      <div className="text-center">
                        {d.sync_ready ? (
                          <Wifi size={12} className="text-green-400 mx-auto" />
                        ) : (
                          <WifiOff size={12} className="text-red-400 mx-auto" />
                        )}
                        <p className="text-[10px] text-gray-600">Ready</p>
                      </div>
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
