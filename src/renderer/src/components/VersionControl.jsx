import { useState, useEffect, useCallback } from 'react'
import { Server, AlertTriangle, RefreshCw, Send, Wifi, WifiOff, X, Clock, CheckCircle, AlertCircle } from 'lucide-react'

function DeviceDrawer({ device, onClose }) {
  if (!device) return null
  const isStale = device.last_successful_sync_at && (Date.now() - new Date(device.last_successful_sync_at).getTime() > 24 * 60 * 60 * 1000)
  const hasIssues = device.failed_queue_count > 0 || device.reconciliation_state === 'mismatch'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-purple-400" />
            <h3 className="text-white font-semibold text-sm">Device Details</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Device ID</p>
              <p className="text-xs text-white font-mono break-all">{device.device_id}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Lodge</p>
              <p className="text-xs text-white">{device.lodge_name || device.lodge_id}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Client Type</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${device.client_type === 'desktop' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
                {device.client_type}
              </span>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Reconciliation</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                device.reconciliation_state === 'clear' ? 'bg-green-500/20 text-green-300' :
                device.reconciliation_state === 'mismatch' ? 'bg-red-500/20 text-red-300' :
                'bg-gray-500/20 text-gray-300'
              }`}>{device.reconciliation_state}</span>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Sync Health</p>
            <div className="grid grid-cols-3 gap-2">
              <div className={`rounded-lg p-2 text-center ${device.pending_queue_count > 0 ? 'bg-amber-950/30 border border-amber-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className="text-lg font-bold text-white">{device.pending_queue_count}</p>
                <p className="text-[9px] text-gray-400">Pending</p>
              </div>
              <div className={`rounded-lg p-2 text-center ${device.failed_queue_count > 0 ? 'bg-red-950/30 border border-red-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className={`text-lg font-bold ${device.failed_queue_count > 0 ? 'text-red-400' : 'text-white'}`}>{device.failed_queue_count}</p>
                <p className="text-[9px] text-gray-400">Failed</p>
              </div>
              <div className={`rounded-lg p-2 text-center ${device.unresolved_local_count > 0 ? 'bg-amber-950/30 border border-amber-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className="text-lg font-bold text-white">{device.unresolved_local_count}</p>
                <p className="text-[9px] text-gray-400">Unresolved</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Status</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Auth Ready</span>
                {device.replay_auth_ready ? (
                  <span className="flex items-center gap-1 text-green-400"><CheckCircle size={12} /> Ready</span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> Not Ready</span>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Last Successful Sync</span>
                <span className={isStale ? 'text-amber-400' : 'text-white'}>
                  {device.last_successful_sync_at ? new Date(device.last_successful_sync_at).toLocaleString() : 'Never'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Last Heartbeat</span>
                <span className={isStale ? 'text-amber-400' : 'text-white'}>
                  {device.reported_at ? new Date(device.reported_at).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>
          </div>

          {device.top_fault_types?.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <p className="text-[10px] text-gray-500 uppercase mb-2">Fault Types</p>
              <div className="flex flex-wrap gap-1">
                {device.top_fault_types.map((f, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">{f}</span>
                ))}
              </div>
            </div>
          )}

          {hasIssues && (
            <div className="bg-amber-950/30 border border-amber-900/40 rounded-lg p-3">
              <p className="text-xs text-amber-300">
                {device.failed_queue_count > 0 && `${device.failed_queue_count} failed sync operation(s) need attention. `}
                {device.reconciliation_state === 'mismatch' && 'Financial reconciliation mismatch detected. '}
                {isStale && 'Device hasn\'t synced in over 24 hours.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VersionControl() {
  const [syncStatus, setSyncStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pushVersion, setPushVersion] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [pushing, setPushing] = useState(false)
  const [tab, setTab] = useState('devices')
  const [selectedDevice, setSelectedDevice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await window.api.admin.getSyncQueueStatus()
      setSyncStatus(s)
    } catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const pushUpdate = async () => {
    if (!pushVersion.trim()) return
    setPushing(true)
    try {
      await window.api.admin.pushUpdateNotification(pushVersion.trim(), pushMessage.trim(), false)
      setPushVersion('')
      setPushMessage('')
    } finally { setPushing(false) }
  }

  const devices = syncStatus?.devices || []
  const staleCount = syncStatus?.stale_count || 0
  const totalCount = syncStatus?.total_devices || 0

  // Derive client_type distribution
  const clientTypes = devices.reduce((acc, d) => {
    const ct = d.client_type || 'unknown'
    acc[ct] = (acc[ct] || 0) + 1
    return acc
  }, {})

  // Derive reconciliation state distribution
  const reconStates = devices.reduce((acc, d) => {
    const rs = d.reconciliation_state || 'unknown'
    acc[rs] = (acc[rs] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Deep Fleet Health</h2>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Total Devices</p>
          <p className="text-2xl font-bold text-white">{totalCount}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Stale (24h+)</p>
          <p className={`text-2xl font-bold ${staleCount > 0 ? 'text-red-400' : 'text-green-400'}`}>{staleCount}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Online</p>
          <p className="text-2xl font-bold text-green-400">{totalCount - staleCount}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {['devices', 'distribution', 'push'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors capitalize ${tab === t ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Devices tab */}
      {tab === 'devices' && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          {devices.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No device data.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Lodge</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-center">Reconciliation</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-right">Unresolved</th>
                  <th className="px-4 py-3 text-center">Auth</th>
                  <th className="px-4 py-3 text-right">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {devices.map((d, i) => (
                  <tr key={i} className="hover:bg-gray-750 cursor-pointer" onClick={() => setSelectedDevice(d)}>
                    <td className="px-4 py-3 text-white text-xs">{d.lodge_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-300">{d.device_id}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${d.client_type === 'desktop' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
                        {d.client_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        d.reconciliation_state === 'clear' ? 'bg-green-500/20 text-green-300' :
                        d.reconciliation_state === 'mismatch' ? 'bg-red-500/20 text-red-300' :
                        'bg-gray-500/20 text-gray-300'
                      }`}>{d.reconciliation_state}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">{d.pending_queue_count}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={d.failed_queue_count > 0 ? 'text-red-400 font-semibold' : 'text-gray-400'}>{d.failed_queue_count}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">{d.unresolved_local_count}</td>
                    <td className="px-4 py-3 text-center">
                      {d.replay_auth_ready ? (
                        <span className="text-green-400 text-[10px]">Ready</span>
                      ) : (
                        <span className="text-red-400 text-[10px]">Not Ready</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[10px] text-gray-500">
                      {d.last_successful_sync_at ? new Date(d.last_successful_sync_at).toLocaleString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Distribution tab */}
      {tab === 'distribution' && (
        <div className="space-y-3">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-3">Client Type Distribution</p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(clientTypes).map(([ct, count]) => (
                <div key={ct} className="bg-gray-750 border border-gray-700 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-gray-400 uppercase">{ct}</p>
                  <p className="text-sm font-bold text-white">{count} devices</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-3">Reconciliation State</p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(reconStates).map(([rs, count]) => (
                <div key={rs} className={`rounded-lg px-3 py-2 border ${
                  rs === 'clear' ? 'bg-green-950/30 border-green-900/40' :
                  rs === 'mismatch' ? 'bg-red-950/30 border-red-900/40' :
                  'bg-gray-750 border-gray-700'
                }`}>
                  <p className="text-[10px] text-gray-400 uppercase">{rs}</p>
                  <p className="text-sm font-bold text-white">{count} devices</p>
                </div>
              ))}
            </div>
          </div>
          {devices.some(d => d.top_fault_types?.length > 0) && (
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 mb-3">Top Fault Types</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(devices.reduce((acc, d) => {
                  (d.top_fault_types || []).forEach(f => { acc[f] = (acc[f] || 0) + 1 })
                  return acc
                }, {})).sort((a, b) => b[1] - a[1]).map(([fault, count]) => (
                  <span key={fault} className="text-[10px] px-2 py-1 rounded-full bg-red-500/20 text-red-300">{fault} ({count})</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Push tab */}
      {tab === 'push' && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <p className="text-xs font-semibold text-gray-400">Push App Update Notification</p>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Version</label>
            <input type="text" value={pushVersion} onChange={e => setPushVersion(e.target.value)}
              placeholder="e.g. 1.4.0"
              className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Message (optional)</label>
            <textarea value={pushMessage} onChange={e => setPushMessage(e.target.value)}
              placeholder="What's new in this version..."
              className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 h-20" />
          </div>
          <button onClick={pushUpdate} disabled={pushing || !pushVersion.trim()}
            className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
            <Send size={12} />
            {pushing ? 'Pushing...' : 'Push to All Lodges'}
          </button>
        </div>
      )}

      {selectedDevice && <DeviceDrawer device={selectedDevice} onClose={() => setSelectedDevice(null)} />}
    </div>
  )
}
