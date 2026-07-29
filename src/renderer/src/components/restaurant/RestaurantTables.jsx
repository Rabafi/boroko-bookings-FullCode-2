import { useCallback, useEffect, useState } from 'react'
import { Edit3, MapPinned, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'

const EMPTY_DRAFT = { name: '', seats: '4', area: 'Main dining' }

export default function RestaurantTables() {
  const access = useAccess()
  const canManageTables = canAccessCapability(access, 'pos.manage')
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadTables = useCallback(async () => {
    setLoading(true); setError('')
    try { setTables(await window.api?.pos?.getTablesWithStatus?.() || []) }
    catch (cause) { setError(cause?.message || 'Could not load the table setup.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadTables() }, [loadTables])

  const startCreate = () => { setEditing({}); setDraft(EMPTY_DRAFT); setError(''); setNotice('') }
  const startEdit = (table) => { setEditing(table); setDraft({ name: table.name || table.table_number || '', seats: String(table.seats || 4), area: table.area || 'Main dining' }); setError(''); setNotice('') }
  const closeEditor = () => { if (!saving) setEditing(null) }
  const save = async () => {
    if (!draft.name.trim()) return setError('Give the table a name that staff and guests will recognise.')
    if (!Number.isInteger(Number(draft.seats)) || Number(draft.seats) < 1) return setError('Seats must be a whole number of at least 1.')
    setSaving(true); setError('')
    try {
      const result = await window.api?.pos?.saveTable?.({ id: editing?.id, name: draft.name.trim(), table_number: draft.name.trim(), seats: Number(draft.seats), area: draft.area.trim() || null, active: true })
      if (!result?.success) throw new Error(result?.error || 'Could not save this table.')
      setEditing(null); setNotice(`${draft.name.trim()} is ready for the live floor.`); await loadTables()
    } catch (cause) { setError(cause?.message || 'Could not save this table.') }
    finally { setSaving(false) }
  }
  const archive = async (table) => {
    if (table.status && table.status !== 'available') return setError('Resolve the running check or reservation before archiving this table.')
    if (!window.confirm(`Archive ${table.name || table.table_number}? It will not be available for new transactions.`)) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.api?.pos?.saveTable?.({ ...table, name: table.name || table.table_number, active: false })
      if (!result?.success) throw new Error(result?.error || 'Could not archive this table.')
      setNotice(`${table.name || table.table_number} was archived.`); await loadTables()
    } catch (cause) { setError(cause?.message || 'Could not archive this table.') }
    finally { setSaving(false) }
  }

  return <div className="restaurant-native-page">
    <div className="restaurant-native-hero"><div><h1 className="text-2xl font-bold text-gray-900">Table setup</h1><p className="mt-1 text-sm text-gray-500">Name tables, set seats and organise service areas. Day-to-day transactions happen from the live Floor plan in the sidebar.</p></div><div className="flex gap-2"><button onClick={loadTables} className="bb-btn-outline text-sm flex items-center gap-1.5" disabled={loading}><RefreshCw size={14}/>Refresh</button>{canManageTables && <button onClick={startCreate} className="bb-btn-primary text-sm flex items-center gap-1.5"><Plus size={14}/>Add table</button>}</div></div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    {!canManageTables && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your role can view this configuration but cannot change tables. Ask a manager to update the floor setup.</div>}
    {loading ? <div className="restaurant-native-loading"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent"/></div> : tables.length === 0 ? <div className="restaurant-native-empty"><MapPinned size={28} className="mx-auto mb-3 text-slate-400"/><p className="text-lg text-gray-600">No tables configured</p><p className="mt-1 text-sm text-gray-400">Add the first table here, then it will appear on the live Floor plan.</p></div> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{tables.map((table) => <article key={table.id} className="bb-card flex items-center justify-between gap-4 p-4"><div><p className="font-bold text-slate-900">{table.name || table.table_number}</p><p className="mt-1 text-sm text-slate-500">{table.seats || 4} seats · {table.area || 'Main dining'}</p><p className="mt-1 text-xs text-slate-400">Live status: {table.status || 'available'}</p></div>{canManageTables && <div className="flex shrink-0 gap-1"><button type="button" onClick={() => startEdit(table)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Edit ${table.name || table.table_number}`}><Edit3 size={16}/></button><button type="button" onClick={() => archive(table)} disabled={saving || (table.status && table.status !== 'available')} className="rounded-md p-2 text-red-700 hover:bg-red-50 disabled:opacity-35" aria-label={`Archive ${table.name || table.table_number}`}><Trash2 size={16}/></button></div>}</article>)}</div>}
    {editing && <div className="hpos-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeEditor()}><section className="hpos-service-dialog" role="dialog" aria-modal="true" aria-labelledby="table-setup-title"><button type="button" className="hpos-service-dialog__close" onClick={closeEditor} disabled={saving} aria-label="Close"><X size={18}/></button><p className="hpos-eyebrow">Manager configuration</p><h2 id="table-setup-title">{editing.id ? 'Edit table' : 'Add table'}</h2><p>These details control how the table appears to staff on the live Floor plan.</p><div className="hpos-service-form"><label>Table name<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="For example, Patio 4"/></label><label>Seats<input type="number" min="1" step="1" value={draft.seats} onChange={(event) => setDraft({ ...draft, seats: event.target.value })}/></label><label>Service area<input value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value })} placeholder="Main dining"/></label></div><footer><button className="bb-btn-outline" onClick={closeEditor} disabled={saving}>Cancel</button><button className="bb-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save table'}</button></footer></section></div>}
  </div>
}
