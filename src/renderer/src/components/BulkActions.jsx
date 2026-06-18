import { useState, useEffect, useCallback } from 'react'
import { CheckSquare, Trash2, Send, AlertTriangle, X, RefreshCw, Filter } from 'lucide-react'
import { callAdminApi } from '../utils/adminApi'

const ENTITY_TYPES = [
  { id: 'ticket', label: 'Support Tickets', fetchKey: 'getSupportTickets', statusField: 'status', labelField: 'title' },
  { id: 'lead', label: 'Marketing Leads', fetchKey: 'getMarketingLeads', statusField: 'stage', labelField: 'contact_name' }
]

const STATUS_OPTIONS = {
  ticket: ['open', 'in_progress', 'resolved', 'closed'],
  lead: ['new', 'contacted', 'demo_scheduled', 'proposal_sent', 'won', 'lost']
}

export default function BulkActions() {
  const [entityType, setEntityType] = useState('lead')
  const [rows, setRows] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [action, setAction] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [message, setMessage] = useState('')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const entityMeta = ENTITY_TYPES.find(e => e.id === entityType)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedIds([])
    setAction('')
    setNewStatus('')
    setMessage('')
    setResult(null)
    setConfirmOpen(false)
    try {
      const data = await callAdminApi(entityMeta.fetchKey, [{}], {})
      if (data?.ok === false || data?.success === false) throw new Error(data.error || 'Failed to load')
      setRows(Array.isArray(data) ? data : (data?.leads || data?.tickets || []))
    } catch (e) { setError(e?.message || 'Failed to load'); setRows([]) }
    setLoading(false)
  }, [entityType, entityMeta])

  useEffect(() => { load() }, [load])

  const toggleRow = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const selectVisible = () => setSelectedIds(rows.map(r => r.id))
  const clearSelection = () => setSelectedIds([])

  const execute = async () => {
    setExecuting(true)
    setResult(null)
    try {
      let res
      if (action === 'status') {
        res = await callAdminApi('bulkUpdateStatus', [entityType, selectedIds, newStatus])
      } else if (action === 'delete') {
        res = await callAdminApi('bulkDelete', [entityType, selectedIds])
      } else if (action === 'notify') {
        res = await callAdminApi('bulkNotify', [entityType, selectedIds, message])
      }
      setResult(res)
      await load()
    } catch (e) { setResult({ ok: false, error: e.message }) }
    setExecuting(false)
    setConfirmOpen(false)
  }

  const getRowLabel = (row) => {
    if (entityType === 'lead') return `${row.contact_name || 'Unknown'} — ${row.lodge_name || ''}`
    if (entityType === 'ticket') return row.title || 'Untitled ticket'
    return row.id
  }

  const getRowMeta = (row) => {
    if (entityType === 'lead') return `${row.stage || row.status || 'new'} | ${row.email || ''}`
    if (entityType === 'ticket') return `${row.priority || 'Normal'} | ${row.status || 'open'}`
    return ''
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckSquare className="text-purple-400" size={20} />
          <h2 className="text-white font-semibold text-lg">Bulk Actions</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={selectVisible} disabled={loading || rows.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50">
            Select All ({rows.length})
          </button>
          <button onClick={clearSelection} disabled={selectedIds.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50">
            Clear ({selectedIds.length})
          </button>
          <button onClick={load} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1">
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

      {/* Entity type selector */}
      <div className="flex gap-2">
        {ENTITY_TYPES.map(et => (
          <button key={et.id} onClick={() => setEntityType(et.id)}
            className={`text-xs px-4 py-2 rounded-lg transition-colors ${entityType === et.id ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {et.label}
          </button>
        ))}
      </div>

      {/* Action bar — visible when items selected */}
      {selectedIds.length > 0 && (
        <div className="bg-purple-950/30 border border-purple-900/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-purple-300">
            <CheckSquare size={12} />
            <span className="font-semibold">{selectedIds.length} selected</span>
          </div>
          {!confirmOpen ? (
            <div className="flex flex-wrap gap-2">
              <select value={action} onChange={e => { setAction(e.target.value); setNewStatus(''); setMessage('') }}
                className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5">
                <option value="">Choose action...</option>
                <option value="status">Update Status</option>
                {entityType === 'lead' && <option value="delete">Soft Delete</option>}
                <option value="notify">Send Notification</option>
              </select>
              {action === 'status' && (
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5">
                  <option value="">New status...</option>
                  {(STATUS_OPTIONS[entityType] || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {action === 'notify' && (
                <input type="text" value={message} onChange={e => setMessage(e.target.value)}
                  placeholder="Notification message..."
                  className="flex-1 text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5" />
              )}
              <button onClick={() => setConfirmOpen(true)}
                disabled={!action || (action === 'status' && !newStatus) || (action === 'notify' && !message.trim())}
                className="text-xs px-4 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 flex items-center gap-1">
                {action === 'delete' ? <Trash2 size={10} /> : action === 'notify' ? <Send size={10} /> : <CheckSquare size={10} />}
                Execute
              </button>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-xs text-amber-300 font-semibold">Confirm bulk action</span>
              </div>
              <p className="text-xs text-gray-300">
                {action === 'status' && `Update ${selectedIds.length} ${entityType}(s) to "${newStatus}"`}
                {action === 'delete' && `Soft-delete ${selectedIds.length} ${entityType}(s) — they will be marked as lost/dropped`}
                {action === 'notify' && `Send notification to ${selectedIds.length} ${entityType}(s)`}
              </p>
              <div className="flex gap-2">
                <button onClick={execute} disabled={executing}
                  className={`text-xs px-4 py-1.5 rounded-lg text-white transition-colors disabled:opacity-50 ${action === 'delete' ? 'bg-red-600 hover:bg-red-500' : 'bg-purple-600 hover:bg-purple-500'}`}>
                  {executing ? 'Executing...' : 'Confirm'}
                </button>
                <button onClick={() => setConfirmOpen(false)}
                  className="text-xs px-4 py-1.5 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {result && (
            <div className={`text-xs p-2 rounded-lg ${result.ok ? 'bg-green-950/30 text-green-300' : 'bg-red-950/30 text-red-300'}`}>
              {result.ok ? `Done. ${result.updated || result.deleted || result.notified || 0} items affected.` : (result.error || 'Failed')}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-gray-500 animate-pulse">Loading {entityMeta.label.toLowerCase()}...</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            <CheckSquare size={32} className="mx-auto mb-3 opacity-40" />
            <p>No {entityMeta.label.toLowerCase()} found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={selectedIds.length === rows.length && rows.length > 0}
                    onChange={() => selectedIds.length === rows.length ? clearSelection() : selectVisible()}
                    className="rounded border-gray-600" />
                </th>
                <th className="px-4 py-3 text-left">{entityType === 'lead' ? 'Contact' : 'Subject'}</th>
                <th className="px-4 py-3 text-left">{entityType === 'lead' ? 'Lodge' : 'Priority'}</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">{entityType === 'lead' ? 'Source' : 'Category'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {rows.map(row => (
                <tr key={row.id} className={`hover:bg-gray-750 ${selectedIds.includes(row.id) ? 'bg-purple-950/20' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.includes(row.id)}
                      onChange={() => toggleRow(row.id)}
                      className="rounded border-gray-600" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium text-xs">{getRowLabel(row)}</p>
                    <p className="text-[10px] text-gray-500">{getRowMeta(row)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-300">
                    {entityType === 'lead' ? (row.lodge_name || '—') : (row.priority || 'Normal')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      entityType === 'lead'
                        ? (row.stage === 'won' ? 'bg-green-500/20 text-green-300' : row.stage === 'lost' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300')
                        : (row.status === 'resolved' || row.status === 'closed' ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-300')
                    }`}>
                      {entityType === 'lead' ? (row.stage || row.status || 'new') : (row.status || 'open')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-gray-500">
                    {entityType === 'lead' ? (row.source || '—') : (row.category || '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
