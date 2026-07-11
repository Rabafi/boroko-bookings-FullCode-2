import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ArrowRightLeft, Merge, Split, XCircle, ExternalLink, RefreshCw, LayoutGrid } from 'lucide-react'

export default function RestaurantTables() {
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTable, setSelectedTable] = useState(null)
  const [actionMenu, setActionMenu] = useState(null)
  const [transferTarget, setTransferTarget] = useState('')
  const [waiterName, setWaiterName] = useState('')
  const [viewMode, setViewMode] = useState('grid')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const loadTables = useCallback(async () => {
    try {
      setLoading(true)
      const data = await window.api.pos.getTablesWithStatus()
      setTables(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load tables:', err)
      setError(err.message || 'Could not load table status. Refresh and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTables() }, [loadTables])

  async function openTable(table) {
    const name = waiterName.trim()
    if (!name) return
    try {
      setError('')
      await window.api.pos.openTableSession({
        table_name: table.table_number || table.name,
        waiter_name: name
      })
      setActionMenu(null)
      setWaiterName('')
      await loadTables()
    } catch (err) {
      console.error('Failed to open table:', err)
      setError(err.message || 'Could not open the table.')
    }
  }

  async function closeTable(table) {
    if (!window.confirm(`Force-close ${table.table_number || table.name}? Use this only after the bill has been resolved.`)) return
    try {
      setError('')
      const tab = await window.api.pos.getActiveTableTab(table.table_number || table.name)
      if (tab?.id) {
        await window.api.pos.closeTab(tab.id)
      }
      setActionMenu(null)
      await loadTables()
    } catch (err) {
      console.error('Failed to close table:', err)
      setError(err.message || 'Could not close the table.')
    }
  }

  async function transferTable(table) {
    if (!transferTarget.trim()) return
    try {
      setError('')
      const tab = await window.api.pos.getActiveTableTab(table.table_number || table.name)
      if (tab?.id) {
        await window.api.pos.overrideTableTab({
          action: 'transfer',
          source_tab_id: tab.id,
          target_table_name: transferTarget.trim()
        })
      }
      setActionMenu(null)
      setTransferTarget('')
      await loadTables()
    } catch (err) {
      console.error('Failed to transfer table:', err)
      setError(err.message || 'Could not transfer the table.')
    }
  }

  function goToPOS(table) {
    navigate('/pos', { state: { tableName: table.table_number || table.name } })
  }

  const statusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      case 'occupied': case 'running': return 'bg-amber-100 text-amber-700 border-amber-200'
      case 'reserved': return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'needs_attention': return 'bg-red-100 text-red-700 border-red-200'
      default: return 'bg-gray-100 text-gray-600 border-gray-200'
    }
  }

  const availableTables = tables.filter(t => t.status === 'available' || !t.status)
  const occupiedTables = tables.filter(t => t.status === 'occupied' || t.status === 'running')
  const otherTables = tables.filter(t => !['available', 'occupied', 'running'].includes(t.status) && t.status)

  const tablesByArea = useMemo(() => {
    const groups = {}
    for (const t of tables) {
      const area = t.area || 'Main Floor'
      if (!groups[area]) groups[area] = []
      groups[area].push(t)
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [tables])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
          <p className="text-sm text-gray-500 mt-1">Floor plan, table status, and quick actions</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button onClick={() => setViewMode('grid')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}>Grid</button>
            <button onClick={() => setViewMode('area')} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'area' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}>By Area</button>
          </div>
          <button onClick={() => navigate('/pos')} className="bb-btn-outline text-sm flex items-center gap-1.5">
            <ExternalLink size={14} /> Open POS
          </button>
          <button onClick={loadTables} className="bb-btn-outline text-sm flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-emerald-700">{availableTables.length}</div>
          <div className="text-xs text-emerald-600">Available</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{occupiedTables.length}</div>
          <div className="text-xs text-amber-600">Occupied</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{otherTables.length}</div>
          <div className="text-xs text-gray-600">Reserved / Other</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : tables.length === 0 ? (
        <div className="bb-card p-12 text-center">
          <p className="text-gray-500 text-lg mb-2">No tables configured</p>
          <p className="text-gray-400 text-sm">Set up tables in POS &gt; Setup &gt; Tables</p>
        </div>
      ) : viewMode === 'area' ? (
        <div className="space-y-6">
          {tablesByArea.map(([area, areaTables]) => (
            <div key={area}>
              <div className="mb-3 flex items-center gap-2">
                <LayoutGrid size={16} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-700">{area}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{areaTables.length} tables</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {areaTables.map((table) => {
                  const isOccupied = table.status === 'occupied' || table.status === 'running'
                  const tableName = table.table_number || table.name
                  return (
                    <div key={table.id || tableName} className="relative">
                      <div
                        onClick={() => setActionMenu(actionMenu === tableName ? null : tableName)}
                        className={`bb-card p-4 border-2 cursor-pointer hover:shadow-md transition-shadow ${statusColor(table.status || 'available')}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-lg font-bold">Table {tableName}</span>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/60">
                            {table.seats || table.capacity || '?'} seats
                          </span>
                        </div>
                        <div className="text-xs opacity-75">
                          {isOccupied
                            ? `Occupied${table.elapsed ? ` - ${table.elapsed}` : ''}`
                            : table.status === 'reserved' ? 'Reserved' : 'Available'}
                        </div>
                        {table.waiter && (
                          <div className="text-xs mt-1 opacity-75">Waiter: {table.waiter}</div>
                        )}
                      </div>
                      {actionMenu === tableName && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 space-y-1">
                          {!isOccupied ? (
                            <>
                              <input type="text" placeholder="Waiter name" value={waiterName} onChange={e => setWaiterName(e.target.value)} className="w-full text-xs border rounded px-2 py-1.5 mb-1" onClick={e => e.stopPropagation()} />
                              <button onClick={(e) => { e.stopPropagation(); openTable(table) }} disabled={!waiterName.trim()} className="w-full text-left text-xs px-3 py-2 rounded hover:bg-emerald-50 text-emerald-700 flex items-center gap-2 disabled:opacity-40"><Plus size={12} /> Open Table</button>
                            </>
                          ) : (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); goToPOS(table) }} className="w-full text-left text-xs px-3 py-2 rounded hover:bg-blue-50 text-blue-700 flex items-center gap-2"><ExternalLink size={12} /> Go to POS</button>
                              <div className="px-2 py-1"><input type="text" placeholder="Target table name" value={transferTarget} onChange={e => setTransferTarget(e.target.value)} className="w-full text-xs border rounded px-2 py-1.5" onClick={e => e.stopPropagation()} /></div>
                              <button onClick={(e) => { e.stopPropagation(); transferTable(table) }} disabled={!transferTarget.trim()} className="w-full text-left text-xs px-3 py-2 rounded hover:bg-amber-50 text-amber-700 flex items-center gap-2 disabled:opacity-40"><ArrowRightLeft size={12} /> Transfer</button>
                              <button onClick={(e) => { e.stopPropagation(); closeTable(table) }} className="w-full text-left text-xs px-3 py-2 rounded hover:bg-red-50 text-red-700 flex items-center gap-2"><XCircle size={12} /> Force Close</button>
                            </>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setActionMenu(null) }} className="w-full text-left text-xs px-3 py-2 rounded hover:bg-gray-50 text-gray-500">Cancel</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {tables.map((table) => {
            const isOccupied = table.status === 'occupied' || table.status === 'running'
            const tableName = table.table_number || table.name
            return (
              <div key={table.id || tableName} className="relative">
                <div
                  onClick={() => setActionMenu(actionMenu === tableName ? null : tableName)}
                  className={`bb-card p-4 border-2 cursor-pointer hover:shadow-md transition-shadow ${statusColor(table.status || 'available')}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg font-bold">Table {tableName}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/60">
                      {table.seats || table.capacity || '?'} seats
                    </span>
                  </div>
                  <div className="text-xs opacity-75">
                    {isOccupied
                      ? `Occupied${table.elapsed ? ` - ${table.elapsed}` : ''}`
                      : table.status === 'reserved' ? 'Reserved' : 'Available'}
                  </div>
                  {table.waiter && (
                    <div className="text-xs mt-1 opacity-75">Waiter: {table.waiter}</div>
                  )}
                </div>

                {/* Action dropdown */}
                {actionMenu === tableName && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 space-y-1">
                    {!isOccupied ? (
                      <>
                        <input
                          type="text"
                          placeholder="Waiter name"
                          value={waiterName}
                          onChange={e => setWaiterName(e.target.value)}
                          className="w-full text-xs border rounded px-2 py-1.5 mb-1"
                          onClick={e => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); openTable(table) }}
                          disabled={!waiterName.trim()}
                          className="w-full text-left text-xs px-3 py-2 rounded hover:bg-emerald-50 text-emerald-700 flex items-center gap-2 disabled:opacity-40"
                        >
                          <Plus size={12} /> Open Table
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); goToPOS(table) }}
                          className="w-full text-left text-xs px-3 py-2 rounded hover:bg-blue-50 text-blue-700 flex items-center gap-2"
                        >
                          <ExternalLink size={12} /> Go to POS
                        </button>
                        <div className="px-2 py-1">
                          <input
                            type="text"
                            placeholder="Target table name"
                            value={transferTarget}
                            onChange={e => setTransferTarget(e.target.value)}
                            className="w-full text-xs border rounded px-2 py-1.5"
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); transferTable(table) }}
                          disabled={!transferTarget.trim()}
                          className="w-full text-left text-xs px-3 py-2 rounded hover:bg-amber-50 text-amber-700 flex items-center gap-2 disabled:opacity-40"
                        >
                          <ArrowRightLeft size={12} /> Transfer
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); closeTable(table) }}
                          className="w-full text-left text-xs px-3 py-2 rounded hover:bg-red-50 text-red-700 flex items-center gap-2"
                        >
                          <XCircle size={12} /> Force Close
                        </button>
                      </>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionMenu(null) }}
                      className="w-full text-left text-xs px-3 py-2 rounded hover:bg-gray-50 text-gray-500"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
