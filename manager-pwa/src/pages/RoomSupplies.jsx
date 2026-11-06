import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listRoomSuppliesPwa } from '../lib/api'
import { shortDateTime } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

/** @typedef {{id: string, name: string, category?: string | null, unit?: string | null, current_stock?: number | string | null, reorder_level?: number | string | null, is_active?: boolean, updated_at?: string | null}} RoomSupplyItemExpectedView */
/** @typedef {{supply_item_id: string, quantity_on_hand?: number | string | null}} RoomSupplyStockExpectedView */

export default function RoomSupplies() {
  // AppShell renders this route only after its authenticated-user guard.
  const { user } = /** @type {{user: NonNullable<ReturnType<typeof useAuth>['user']>}} */ (useAuth())
  const [items, setItems] = useState(/** @type {RoomSupplyItemExpectedView[]} */ ([]))
  const [roomStock, setRoomStock] = useState(/** @type {RoomSupplyStockExpectedView[]} */ ([]))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(/** @type {string | null} */ (null))
  const load = useCallback(async () => { setLoading(true); setError(''); try { const next = await listRoomSuppliesPwa(user.lodge_id); setItems(/** @type {RoomSupplyItemExpectedView[]} */ (next.items)); setRoomStock(/** @type {RoomSupplyStockExpectedView[]} */ (next.roomStock)); setUpdatedAt(new Date().toISOString()) } catch (loadError) { setError((/** @type {{message?: string} | null | undefined} */ (loadError))?.message || 'Room supplies could not load.') } finally { setLoading(false) } }, [user.lodge_id])
  useEffect(() => { load() }, [load])
  const roomsByItem = useMemo(() => roomStock.reduce((/** @type {Record<string, number>} */ totals, row) => ({ ...totals, [row.supply_item_id]: (totals[row.supply_item_id] || 0) + Number(row.quantity_on_hand || 0) }), /** @type {Record<string, number>} */ ({})), [roomStock])
  return <div className="min-h-screen bg-gray-950 pb-24"><header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Room Supplies</h1><p className="mt-1 text-xs text-gray-400">Live store-room and in-room consumable balances</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh room supplies"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div></header><main className="space-y-3 px-4 py-4">{error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}{!loading && items.length === 0 ? <EmptyState icon={Package} title="No room supplies" message="Supply items configured at Front Desk will appear here." /> : items.map((item) => { const store = Number(item.current_stock || 0); const room = Number(roomsByItem[item.id] || 0); const low = store <= Number(item.reorder_level || 0); return <div key={item.id} className="rounded-2xl bg-gray-800 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{item.name}</p><p className="mt-1 text-xs text-gray-500">{item.category || 'General'} · {item.unit || 'unit'}{item.is_active === false ? ' · Inactive' : ''}</p></div><p className={`shrink-0 text-sm font-bold ${low ? 'text-amber-200' : 'text-emerald-200'}`}>{store} store</p></div><p className="mt-2 text-xs text-gray-400">In rooms: {room} · Reorder at {Number(item.reorder_level || 0)}{item.updated_at ? ` · Updated ${shortDateTime(item.updated_at)}` : ''}</p></div> })}<MobileBoundaryNotice compact>Balances are live. Purchasing, adjusting, loading, using, returning, and stock-taking room supplies remain in the audited desktop inventory workflow.</MobileBoundaryNotice></main></div>
}
