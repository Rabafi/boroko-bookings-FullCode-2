import { useState, useEffect, useCallback } from 'react'
import { Rocket, Clock, CheckCircle, AlertTriangle, AlertCircle, RefreshCw, Calendar, Plus, Pause, Play, ArrowUp, X } from 'lucide-react'
import Pagination, { usePagination } from './shared/Pagination'
import { useToast } from './shared/Toast'
import { timeAgo as sharedTimeAgo } from '../utils/timeAgo'
import { DarkConfirmDialog } from './shared/DarkConfirmDialog'

const timeAgo = sharedTimeAgo

function timeUntil(dateStr) {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const days = Math.floor(diff / 864e5)
  if (days > 0) return `in ${days}d`
  const hrs = Math.floor(diff / 36e5)
  return `in ${hrs}h`
}

const FEATURE_STATUS = {
  active:    { icon: CheckCircle,   color: 'text-green-400',  bg: 'bg-green-500/10',  label: 'Active' },
  scheduled: { icon: Clock,         color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'Scheduled' },
  expired:   { icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'Expired' }
}

const RELEASE_STATUS_COLORS = {
  draft:        'bg-gray-500/20 text-gray-300',
  rolling_out:  'bg-amber-500/20 text-amber-300',
  full:         'bg-green-500/20 text-green-300',
  paused:       'bg-blue-500/20 text-blue-300',
  retired:      'bg-red-500/20 text-red-300'
}

const CHANNEL_COLORS = {
  stable: 'bg-green-500/20 text-green-300',
  beta:   'bg-amber-500/20 text-amber-300',
  dev:    'bg-blue-500/20 text-blue-300'
}

function FeaturesTab() {
  const [confirmRelease, setConfirmRelease] = useState(null)
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expiring, setExpiring] = useState(false)
  const [filter, setFilter] = useState('all')
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { const data = await window.api.admin.getScheduledReleases(); setReleases(data || []) }
    catch (err) { setError(err?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const counts = releases.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
  const filtered = filter === 'all' ? releases : releases.filter(r => r.status === filter)
  const { page, setPage, totalPages, paginated } = usePagination(filtered)

  const runExpiry = async () => {
    setExpiring(true)
    const result = await window.api.admin.expireOverdueFeatures()
    toast.success(`Expired ${result?.count || 0} overdue feature(s)`)
    load()
    setExpiring(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{releases.length} feature releases</p>
        <div className="flex items-center gap-2">
          <button onClick={runExpiry} disabled={expiring}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50">
            <Clock size={13} className={expiring ? 'animate-spin' : ''} /> Expiry Check
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {['all', 'active', 'scheduled', 'expired'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${filter === s ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)} ({s === 'all' ? releases.length : (counts[s] || 0)})
          </button>
        ))}
      </div>
      {loading ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500 animate-pulse">Loading...</div>
      ) : error ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-400 opacity-60" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-white underline">Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-gray-800 rounded-xl px-6 py-16 text-center text-gray-500">
          <Rocket size={32} className="mx-auto mb-3 opacity-40" /><p>No feature releases.</p>
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
                <th className="px-4 py-3 text-left">Granted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {paginated.map((r, i) => {
                const st = FEATURE_STATUS[r.status] || FEATURE_STATUS.active
                const Icon = st.icon
                return (
                  <tr key={`${r.lodge_id}-${r.feature_name}`} className={`hover:bg-gray-750 ${i % 2 === 1 ? 'bg-gray-800/60' : ''}`}>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}><Icon size={12} /> {st.label}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-300">{r.lodge_name || r.lodge_id?.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-xs text-purple-300 font-medium">{r.feature_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-48 truncate">{r.reason || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.expires_at ? <div><span className="text-gray-300">{new Date(r.expires_at).toLocaleDateString()}</span><span className={`ml-1.5 text-[10px] ${r.status === 'expired' ? 'text-red-400' : 'text-amber-400'}`}>{timeUntil(r.expires_at)}</span></div> : <span className="text-gray-600">—</span>}
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
      <DarkConfirmDialog
        open={!!confirmRelease}
        title={`Start rollout of ${confirmRelease?.version || ''}?`}
        message="This will begin rolling out the release to devices based on the rollout percentage. You can pause or adjust at any time."
        confirmLabel="Start Rollout"
        onConfirm={() => { if (confirmRelease) { setStatus(confirmRelease.version, confirmRelease.action); setConfirmRelease(null) } }}
        onCancel={() => setConfirmRelease(null)}
      />
    </div>
  )
}

function AppVersionsTab() {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newRelease, setNewRelease] = useState({ version: '', release_notes: '', channel: 'stable', force_update: false, min_version: '' })
  const [creating, setCreating] = useState(false)
  const [editingVersion, setEditingVersion] = useState(null)
  const [rolloutPct, setRolloutPct] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { const r = await window.api.admin.getReleases(); setReleases(Array.isArray(r) ? r : []) }
    catch (e) { setError(e?.message || 'Failed to load') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newRelease.version.trim()) return
    setCreating(true)
    try { await window.api.admin.createRelease(newRelease); setShowCreate(false); setNewRelease({ version: '', release_notes: '', channel: 'stable', force_update: false, min_version: '' }); await load() }
    finally { setCreating(false) }
  }

  const updateRollout = async (version) => {
    await window.api.admin.updateRelease(version, { rollout_pct: rolloutPct })
    setEditingVersion(null)
    await load()
  }

  const setStatus = async (version, status) => { await window.api.admin.updateRelease(version, { status }); await load() }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{releases.length} app versions</p>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(!showCreate)}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors flex items-center gap-1">
            <Plus size={12} /> New Release
          </button>
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>
      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-3 flex items-center gap-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">{error}</p>
          <button onClick={load} className="text-xs text-red-400 hover:text-white underline">Retry</button>
        </div>
      )}
      {showCreate && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400">New Release</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] text-gray-500 block mb-1">Version *</label>
              <input type="text" value={newRelease.version} onChange={e => setNewRelease(f => ({ ...f, version: e.target.value }))} placeholder="1.4.0" className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2" /></div>
            <div><label className="text-[10px] text-gray-500 block mb-1">Channel</label>
              <select value={newRelease.channel} onChange={e => setNewRelease(f => ({ ...f, channel: e.target.value }))} className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2">
                <option value="stable">Stable</option><option value="beta">Beta</option><option value="dev">Dev</option>
              </select></div>
          </div>
          <div><label className="text-[10px] text-gray-500 block mb-1">Release Notes</label>
            <textarea value={newRelease.release_notes} onChange={e => setNewRelease(f => ({ ...f, release_notes: e.target.value }))} className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 h-20" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] text-gray-500 block mb-1">Min Version</label>
              <input type="text" value={newRelease.min_version} onChange={e => setNewRelease(f => ({ ...f, min_version: e.target.value }))} placeholder="1.3.0" className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2" /></div>
            <div className="flex items-end"><label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={newRelease.force_update} onChange={e => setNewRelease(f => ({ ...f, force_update: e.target.checked }))} className="rounded border-gray-600" /> Force update</label></div>
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={creating || !newRelease.version.trim()} className="text-xs px-4 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50">{creating ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setShowCreate(false)} className="text-xs px-4 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancel</button>
          </div>
        </div>
      )}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 animate-pulse">Loading releases...</div>
        ) : releases.length === 0 ? (
          <div className="p-8 text-center text-gray-500"><Rocket size={32} className="mx-auto mb-3 opacity-40" /><p>No releases yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-700">
            {releases.map(rel => (
              <div key={rel.id} className="px-4 py-4 hover:bg-gray-750">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono font-bold text-white">v{rel.version}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${RELEASE_STATUS_COLORS[rel.status]}`}>{rel.status}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${CHANNEL_COLORS[rel.channel]}`}>{rel.channel}</span>
                  {rel.force_update && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">forced</span>}
                </div>
                {rel.release_notes && <p className="text-[11px] text-gray-400 mb-2 line-clamp-2">{rel.release_notes}</p>}
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[10px] text-gray-500 w-16">Rollout</span>
                  <div className="flex-1 bg-gray-700 rounded-full h-2"><div className="bg-purple-500 rounded-full h-2 transition-all" style={{ width: `${rel.rollout_pct}%` }} /></div>
                  <span className="text-xs text-white font-mono w-10 text-right">{rel.rollout_pct}%</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {editingVersion === rel.version ? (
                    <>
                      <input type="number" min="0" max="100" value={rolloutPct} onChange={e => setRolloutPct(Number(e.target.value))} className="w-20 text-xs bg-gray-700 border border-gray-600 text-white rounded px-2 py-1" />
                      <button onClick={() => updateRollout(rel.version)} className="text-[10px] text-green-400 hover:text-green-300">Save</button>
                      <button onClick={() => setEditingVersion(null)} className="text-[10px] text-gray-500 hover:text-gray-300">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingVersion(rel.version); setRolloutPct(rel.rollout_pct) }} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"><ArrowUp size={10} /> Adjust</button>
                  )}
                  {rel.status === 'draft' && <button onClick={() => setConfirmRelease({ version: rel.version, action: 'rolling_out' })} className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"><Play size={10} /> Start</button>}
                  {rel.status === 'rolling_out' && <>
                    <button onClick={() => setStatus(rel.version, 'full')} className="text-[10px] text-green-400 hover:text-green-300">Full Release</button>
                    <button onClick={() => setStatus(rel.version, 'paused')} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Pause size={10} /> Pause</button>
                  </>}
                  {rel.status === 'paused' && <button onClick={() => setStatus(rel.version, 'rolling_out')} className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"><Play size={10} /> Resume</button>}
                  {(rel.status === 'rolling_out' || rel.status === 'paused') && <button onClick={() => setStatus(rel.version, 'retired')} className="text-[10px] text-red-400 hover:text-red-300">Retire</button>}
                </div>
                <p className="text-[10px] text-gray-600 mt-2">Created {new Date(rel.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Releases() {
  const [tab, setTab] = useState('features')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Rocket className="text-purple-400" size={20} />
        <h2 className="text-white font-semibold text-lg">Releases</h2>
      </div>
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {[['features', 'Features'], ['versions', 'App Versions']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors ${tab === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'features' && <FeaturesTab />}
      {tab === 'versions' && <AppVersionsTab />}
    </div>
  )
}
