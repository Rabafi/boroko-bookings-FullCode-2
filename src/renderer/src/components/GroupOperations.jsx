import { useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut, UserCheck, Gift, RefreshCw, AlertTriangle, Users, ArrowLeft } from 'lucide-react'
import { ConfirmDialog } from './shared/ConfirmDialog'

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function BlockDetail({ blockId, blockName, onBack }) {
  const [pickup, setPickup] = useState(null)
  const [roomingLists, setRoomingLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [processing, setProcessing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const pickData = await window.api.groupOperations.getPickup(blockId)
      setPickup(pickData)
      if (window.api.roomingLists?.getAll) {
        try {
          const lists = await window.api.roomingLists.getAll()
          const filtered = Array.isArray(lists) ? lists.filter(l => l.group_block_id === blockId) : []
          setRoomingLists(filtered)
        } catch (roomingErr) {
          setError((prev) => prev || roomingErr?.message || 'Could not load rooming lists')
          setRoomingLists([])
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to load group data')
      setPickup(null)
    } finally {
      setLoading(false)
    }
  }, [blockId])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t) } }, [success])

  const handleCheckin = () => {
    setConfirmDialog({
      title: 'Check In Group',
      message: `Check in all roomed-up bookings for "${blockName}"?`,
      onConfirm: async () => {
        setProcessing(true)
        setError('')
        try {
          const result = await window.api.groupOperations.checkinBlock(blockId)
          setSuccess(`Checked in ${result?.checked_in_count || 0} guests`)
          load()
        } catch (err) { setError(err?.message || 'Check-in failed') }
        setProcessing(false)
        setConfirmDialog(null)
      }
    })
  }

  const handleCheckout = () => {
    setConfirmDialog({
      title: 'Check Out Group',
      message: `Check out all checked-in guests for "${blockName}"?`,
      onConfirm: async () => {
        setProcessing(true)
        setError('')
        try {
          const result = await window.api.groupOperations.checkoutBlock(blockId)
          setSuccess(`Checked out ${result?.checked_out_count || 0} guests`)
          load()
        } catch (err) { setError(err?.message || 'Check-out failed') }
        setProcessing(false)
        setConfirmDialog(null)
      }
    })
  }

  const handleReleaseUnsold = () => {
    setConfirmDialog({
      title: 'Release Unsold Rooms',
      message: `Release all unbooked rooms for "${blockName}" back to inventory?`,
      onConfirm: async () => {
        setProcessing(true)
        setError('')
        try {
          const result = await window.api.groupOperations.releaseUnsold(blockId)
          setSuccess(`Released ${result?.released_count || 0} rooms`)
          load()
        } catch (err) { setError(err?.message || 'Release failed') }
        setProcessing(false)
        setConfirmDialog(null)
      }
    })
  }

  const handleProcessRoomingList = async (listId) => {
    setProcessing(true)
    setError('')
    try {
      const result = await window.api.groupOperations.createFromRoomingList(listId)
      setSuccess(`Created ${result?.created || 0} bookings from rooming list`)
      load()
    } catch (err) { setError(err?.message || 'Rooming list processing failed') }
    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="animate-spin w-6 h-6 text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-4">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{success}</div>}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-1.5 border rounded hover:bg-gray-50" title="Back to blocks">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="w-5 h-5" /> {blockName}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleCheckin} disabled={processing} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"><LogIn className="w-4 h-4 inline mr-1" />Check In</button>
          <button onClick={handleCheckout} disabled={processing} className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"><LogOut className="w-4 h-4 inline mr-1" />Check Out</button>
          <button onClick={handleReleaseUnsold} disabled={processing} className="px-3 py-1.5 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50"><Gift className="w-4 h-4 inline mr-1" />Release Unsold</button>
          <button onClick={load} disabled={processing} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"><RefreshCw className="w-4 h-4 inline mr-1" />Refresh</button>
        </div>
      </div>

      {!pickup && !error && (
        <div className="p-6 text-center text-sm text-gray-500 border rounded bg-white">No pickup data for this block.</div>
      )}

      {pickup && pickup.success === false && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {pickup.error || 'Could not load pickup for this group block.'}
        </div>
      )}

      {pickup && pickup.success !== false && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Rooms Requested</div><div className="text-lg font-semibold">{pickup.rooms_requested || 0}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Rooms Used</div><div className="text-lg font-semibold">{pickup.rooms_used || 0}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Rooms Remaining</div><div className="text-lg font-semibold">{pickup.rooms_remaining || 0}</div></div>
          <div className="p-3 bg-white border rounded"><div className="text-xs text-gray-500">Pickup %</div><div className="text-lg font-semibold">{pickup.pickup_pct || 0}%</div></div>
        </div>
      )}

      {pickup && pickup.pickup_pct < 50 && pickup.success !== false && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Low pickup rate ({pickup.pickup_pct}%). Consider releasing unsold rooms.
        </div>
      )}

      {roomingLists.length > 0 && (
        <div className="bg-white border rounded">
          <div className="p-3 border-b font-semibold text-sm">Rooming Lists</div>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">{['Import', 'Total', 'Processed', 'Failed', 'Status', ''].map(h => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {roomingLists.map(rl => (
                <tr key={rl.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">{rl.import_name}</td>
                  <td className="p-2">{rl.total_rows}</td>
                  <td className="p-2">{rl.processed_rows}</td>
                  <td className="p-2">{rl.failed_rows}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${rl.status === 'completed' ? 'bg-green-100 text-green-700' : rl.status === 'partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'}`}>{rl.status}</span></td>
                  <td className="p-2">
                    {rl.status === 'pending' && (
                      <button onClick={() => handleProcessRoomingList(rl.id)} disabled={processing} className="text-blue-600 hover:underline text-xs"><UserCheck className="w-3 h-3 inline mr-1" />Process</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </div>
  )
}

export default function GroupOperations({ blockId: propBlockId, blockName: propBlockName, onClose }) {
  const [blocks, setBlocks] = useState([])
  const [selected, setSelected] = useState(propBlockId ? { id: propBlockId, name: propBlockName || 'Group block' } : null)
  const [loading, setLoading] = useState(!propBlockId)
  const [error, setError] = useState('')

  const loadBlocks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let rows = []
      if (window.api.groupOperations?.getAll) {
        rows = await window.api.groupOperations.getAll()
      } else if (window.api.groupBlocks?.getAll) {
        rows = await window.api.groupBlocks.getAll()
      }
      setBlocks(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setError(err?.message || 'Failed to load group blocks')
      setBlocks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!propBlockId) loadBlocks()
  }, [propBlockId, loadBlocks])

  if (selected?.id) {
    return (
      <div className="bb-page">
        <BlockDetail
          blockId={selected.id}
          blockName={selected.name || selected.group_name || selected.block_name || 'Group block'}
          onBack={propBlockId ? onClose : () => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="bb-page space-y-5">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">ENTERPRISE</p>
          <h1 className="bb-page-header-title">Group Operations</h1>
          <p className="bb-page-header-subtitle">Group check-in, checkout, pickup, and rooming-list processing</p>
        </div>
        <button onClick={loadBlocks} className="btn-ghost p-2" title="Refresh"><RefreshCw size={15} /></button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center p-12"><RefreshCw className="animate-spin w-6 h-6 text-gray-400" /></div>
      ) : blocks.length === 0 ? (
        <div className="bb-card p-10 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-600 font-semibold">No group blocks found</p>
          <p className="text-xs text-slate-400 mt-1">Create a group block first, then return here for check-in and pickup operations.</p>
        </div>
      ) : (
        <section className="bb-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Dates</th>
                <th className="text-left p-3">Rooms</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Revenue</th>
                <th className="text-left p-3" />
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id} className="border-b hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-900">{b.name || b.group_name || b.block_name || b.id}</td>
                  <td className="p-3 text-slate-600">{b.check_in || '—'} → {b.check_out || '—'}</td>
                  <td className="p-3 text-slate-600">{b.rooms_requested ?? b.rooms_booked ?? '—'}</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">{b.status || 'unknown'}</span></td>
                  <td className="p-3 text-slate-600">{b.total_revenue != null ? formatCurrency(b.total_revenue) : '—'}</td>
                  <td className="p-3">
                    <button
                      onClick={() => setSelected({ id: b.id, name: b.name || b.group_name || b.block_name || 'Group block' })}
                      className="text-blue-600 hover:underline text-xs font-semibold"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
