import { useState, useEffect, useCallback } from 'react'
import { Server, AlertTriangle, RefreshCw, Send, Wifi, WifiOff, CheckCircle, Activity, Monitor, X, Clock, AlertCircle } from 'lucide-react'
import { useToast } from './shared/Toast'
import { timeAgo as sharedTimeAgo } from '../utils/timeAgo'
import { DarkConfirmDialog } from './shared/DarkConfirmDialog'

const timeAgo = sharedTimeAgo

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

function DeviceDrawer({ device, onClose }) {
  if (!device) return null
  const isStale = device.last_successful_sync_at && (Date.now() - new Date(device.last_successful_sync_at).getTime() > 24 * 60 * 60 * 1000)
  const hasIssues = device.failed_queue_count > 0 || device.reconciliation_state === 'mismatch'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} tabIndex={-1} autoFocus>
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
            <div><p className="text-[10px] text-gray-500 uppercase">Device ID</p><p className="text-xs text-white font-mono break-all">{device.device_id}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Lodge</p><p className="text-xs text-white">{device.lodge_name || device.lodge_id}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Client Type</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${device.client_type === 'desktop' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>{device.client_type}</span>
            </div>
            <div><p className="text-[10px] text-gray-500 uppercase">Reconciliation</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${device.reconciliation_state === 'clear' ? 'bg-green-500/20 text-green-300' : device.reconciliation_state === 'mismatch' ? 'bg-red-500/20 text-red-300' : 'bg-gray-500/20 text-gray-300'}`}>{device.reconciliation_state}</span>
            </div>
          </div>
          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Sync Health</p>
            <div className="grid grid-cols-3 gap-2">
              <div className={`rounded-lg p-2 text-center ${device.pending_queue_count > 0 ? 'bg-amber-950/30 border border-amber-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className="text-lg font-bold text-white">{device.pending_queue_count}</p><p className="text-[9px] text-gray-400">Pending</p>
              </div>
              <div className={`rounded-lg p-2 text-center ${device.failed_queue_count > 0 ? 'bg-red-950/30 border border-red-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className={`text-lg font-bold ${device.failed_queue_count > 0 ? 'text-red-400' : 'text-white'}`}>{device.failed_queue_count}</p><p className="text-[9px] text-gray-400">Failed</p>
              </div>
              <div className={`rounded-lg p-2 text-center ${device.unresolved_local_count > 0 ? 'bg-amber-950/30 border border-amber-900/40' : 'bg-gray-750 border border-gray-700'}`}>
                <p className="text-lg font-bold text-white">{device.unresolved_local_count}</p><p className="text-[9px] text-gray-400">Unresolved</p>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-700 pt-3">
            <p className="text-[10px] text-gray-500 uppercase mb-2">Status</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Auth Ready</span>
                {device.replay_auth_ready ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={12} /> Ready</span> : <span className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> Not Ready</span>}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Last Sync</span>
                <span className={isStale ? 'text-amber-400' : 'text-white'}>{device.last_successful_sync_at ? new Date(device.last_successful_sync_at).toLocaleString() : 'Never'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Heartbeat</span>
                <span className={isStale ? 'text-amber-400' : 'text-white'}>{device.reported_at ? new Date(device.reported_at).toLocaleString() : 'Never'}</span>
              </div>
            </div>
          </div>
          {device.top_fault_types?.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <p className="text-[10px] text-gray-500 uppercase mb-2">Fault Types</p>
              <div className="flex flex-wrap gap-1">{device.top_fault_types.map((f, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">{f}</span>)}</div>
            </div>
          )}
          {hasIssues && (
            <div className="bg-amber-950/30 border border-amber-900/40 rounded-lg p-3">
              <p className="text-xs text-amber-300">
                {device.failed_queue_count > 0 && `${device.failed_queue_count} failed sync(s). `}
                {device.reconciliation_state === 'mismatch' && 'Reconciliation mismatch. '}
                {isStale && 'Device offline >24h.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ onOpenDevice }) {
  const [devices, setDevices] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rollup, sum] = await Promise.all([window.api.admin.getFleetHealthRollup(), window.api.admin.getFleetHealthSummary()])
      setDevices(rollup || [])
      setSummary(sum)
    } catch (err) { setError(err?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(load, 60000); return () => clearInterval(i) }, [load])

  const byLodge = devices.reduce((acc, d) => {
    const key = d.lodge_name || d.lodge_id?.slice(0, 8) || 'Unknown'
    if (!acc[key]) acc[key] = { lodge_id: d.lodge_id, devices: [] }
    acc[key].devices.push(d)
    return acc
  }, {})

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total" value={summary.total_devices} icon={Server} />
          <StatCard label="Healthy" value={summary.healthy_devices} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Stale (>24h)" value={summary.stale_devices} icon={AlertTriangle} color="text-amber-400" />
          <StatCard label="Failed" value={summary.failed_devices} icon={WifiOff} color="text-red-400" />
          <StatCard label="Lodges" value={summary.total_lodges} icon={Monitor} color="text-blue-400" />
        </div>
      )}
      {loading && devices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500 animate-pulse">Loading fleet...</div>
      ) : error ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-white underline">Retry</button>
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <Server size={32} className="mx-auto mb-3 opacity-40" /><p>No devices reporting yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byLodge).map(([lodgeName, { lodge_id, devices: lodgeDevices }]) => (
            <div key={lodge_id || lodgeName} className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white cursor-pointer hover:text-purple-300 transition-colors" onClick={() => { const c = companies.find(co => co.lodge_name === lodgeName || co.lodge_id === devices[0]?.lodge_id); if (c && onOpenCompany) onOpenCompany(c) }}>{lodgeName}</span>
                  <span className="text-xs text-gray-500">{lodgeDevices.length} device{lodgeDevices.length !== 1 ? 's' : ''}</span>
                </div>
                {lodgeDevices.some(d => d.failed_queue > 0) && <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Issues</span>}
              </div>
              <div className="divide-y divide-gray-700">
                {lodgeDevices.map(d => (
                  <div key={d.device_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-750 cursor-pointer" onClick={() => onOpenDevice(d)}>
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${d.failed_queue > 0 ? 'bg-red-500 animate-pulse' : d.stale ? 'bg-amber-500' : 'bg-green-500'}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-200 font-mono text-xs">{d.device_id?.slice(0, 12)}</span>
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${d.client_type === 'desktop' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>{d.client_type || 'unknown'}</span>
                      <p className="text-[10px] text-gray-500 mt-0.5">Last sync: {timeAgo(d.last_sync_at)}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-center"><p className={`font-mono ${d.pending_queue > 0 ? 'text-amber-400' : 'text-gray-500'}`}>{d.pending_queue || 0}</p><p className="text-[10px] text-gray-600">Pending</p></div>
                      <div className="text-center"><p className={`font-mono ${d.failed_queue > 0 ? 'text-red-400' : 'text-gray-500'}`}>{d.failed_queue || 0}</p><p className="text-[10px] text-gray-600">Failed</p></div>
                      <div className="text-center"><p className={`font-mono ${d.unresolved > 0 ? 'text-orange-400' : 'text-gray-500'}`}>{d.unresolved || 0}</p><p className="text-[10px] text-gray-600">Unresolved</p></div>
                      <div className="text-center">{d.sync_ready ? <Wifi size={12} className="text-green-400 mx-auto" /> : <WifiOff size={12} className="text-red-400 mx-auto" />}<p className="text-[10px] text-gray-600">Ready</p></div>
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

function DevicesTab({ onOpenDevice }) {
  const [syncStatus, setSyncStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await window.api.admin.getSyncQueueStatus()
      if (s?.ok === false) throw new Error(s.error || 'Sync queue status is unavailable')
      setSyncStatus(s)
    }
    catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const devices = syncStatus?.devices || []
  const clientTypes = devices.reduce((acc, d) => { const ct = d.client_type || 'unknown'; acc[ct] = (acc[ct] || 0) + 1; return acc }, {})
  const reconStates = devices.reduce((acc, d) => { const rs = d.reconciliation_state || 'unknown'; acc[rs] = (acc[rs] || 0) + 1; return acc }, {})

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}
      {loading ? (
        <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500 animate-pulse">Loading devices...</div>
      ) : devices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-500">No device data.</div>
      ) : (
        <>
          <div className="bg-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Lodge</th>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-center">Reconciliation</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-center">Auth</th>
                  <th className="px-4 py-3 text-right">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {devices.map((d, i) => (
                  <tr key={i} className="hover:bg-gray-750 cursor-pointer" onClick={() => onOpenDevice(d)}>
                    <td className="px-4 py-3 text-white text-xs">{d.lodge_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-300">{d.device_id}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${d.client_type === 'desktop' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>{d.client_type}</span></td>
                    <td className="px-4 py-3 text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${d.reconciliation_state === 'clear' ? 'bg-green-500/20 text-green-300' : d.reconciliation_state === 'mismatch' ? 'bg-red-500/20 text-red-300' : 'bg-gray-500/20 text-gray-300'}`}>{d.reconciliation_state}</span></td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">{d.pending_queue_count}</td>
                    <td className="px-4 py-3 text-right text-xs"><span className={d.failed_queue_count > 0 ? 'text-red-400 font-semibold' : 'text-gray-400'}>{d.failed_queue_count}</span></td>
                    <td className="px-4 py-3 text-center">{d.replay_auth_ready ? <span className="text-green-400 text-[10px]">Ready</span> : <span className="text-red-400 text-[10px]">Not Ready</span>}</td>
                    <td className="px-4 py-3 text-right text-[10px] text-gray-500">{d.last_successful_sync_at ? new Date(d.last_successful_sync_at).toLocaleString() : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 mb-3">Client Types</p>
              <div className="flex flex-wrap gap-2">{Object.entries(clientTypes).map(([ct, count]) => (
                <span key={ct} className="text-[10px] px-2 py-1 rounded-full bg-gray-750 border border-gray-700 text-white">{ct} ({count})</span>
              ))}</div>
            </div>
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 mb-3">Reconciliation</p>
              <div className="flex flex-wrap gap-2">{Object.entries(reconStates).map(([rs, count]) => (
                <span key={rs} className={`text-[10px] px-2 py-1 rounded-full border ${rs === 'clear' ? 'bg-green-950/30 border-green-900/40 text-green-300' : rs === 'mismatch' ? 'bg-red-950/30 border-red-900/40 text-red-300' : 'bg-gray-750 border-gray-700 text-white'}`}>{rs} ({count})</span>
              ))}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PushTab() {
  const [pushVersion, setPushVersion] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [pushing, setPushing] = useState(false)

  const pushUpdate = async () => {
    if (!pushVersion.trim()) return
    setPushing(true)
    try { await window.api.admin.pushUpdateNotification(pushVersion.trim(), pushMessage.trim(), false); setPushVersion(''); setPushMessage('') }
    finally { setPushing(false) }
  }

  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-4">
      <p className="text-xs font-semibold text-gray-400">Push App Update Notification</p>
      <div><label className="text-xs text-gray-400 block mb-1">Version</label>
        <input type="text" value={pushVersion} onChange={e => setPushVersion(e.target.value)} placeholder="e.g. 1.4.0" className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2" /></div>
      <div><label className="text-xs text-gray-400 block mb-1">Message (optional)</label>
        <textarea value={pushMessage} onChange={e => setPushMessage(e.target.value)} placeholder="What's new..." className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 h-20" /></div>
      <button onClick={() => setConfirmPush(true)} disabled={pushing || !pushVersion.trim()}
        className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
        <Send size={12} /> {pushing ? 'Pushing...' : 'Push to All Lodges'}
      </button>
      <DarkConfirmDialog open={confirmPush} title="Push update to all lodges?" message={`This will send a "${pushForm.version}" update notification to every connected device. This action cannot be undone.`} confirmLabel="Push Update" onConfirm={() => { setConfirmPush(false); pushUpdate() }} onCancel={() => setConfirmPush(false)} />
    </div>
  )
}

export default function Fleet({ onOpenCompany, companies = [] }) {
  const [tab, setTab] = useState('overview')
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [confirmPush, setConfirmPush] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Server className="text-purple-400" size={20} />
        <h2 className="text-white font-semibold text-lg">Fleet</h2>
      </div>
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {[['overview', 'Overview'], ['devices', 'Devices'], ['push', 'Push']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors ${tab === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab onOpenDevice={setSelectedDevice} />}
      {tab === 'devices' && <DevicesTab onOpenDevice={setSelectedDevice} />}
      {tab === 'push' && <PushTab />}
      {selectedDevice && <DeviceDrawer device={selectedDevice} onClose={() => setSelectedDevice(null)} />}
    </div>
  )
}
