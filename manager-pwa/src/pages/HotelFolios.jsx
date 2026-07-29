import { useCallback, useEffect, useState } from 'react'
import { WalletCards, ChevronRight, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getHotelFolioLines, listHotelFolios } from '../lib/api'
import { money, shortDateTime, titleCase } from '../lib/format'
import DataFreshness from '../components/DataFreshness'
import EmptyState from '../components/EmptyState'
import MobileBoundaryNotice from '../components/MobileBoundaryNotice'

function FolioDetail({ folio, lines, loading, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] border border-white/10 bg-gray-950 px-4 pb-8 pt-4" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-700" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">{titleCase(folio.folio_type || 'guest')} folio</p>
            <h2 className="mt-1 text-lg font-bold text-white">{folio.folio_number || 'Folio'}</h2>
            <p className="mt-1 text-sm text-gray-400">{folio.label || folio.guest_name || 'Hotel folio'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Close folio"><X size={18} /></button>
        </div>
        <div className="mt-4 rounded-2xl bg-gray-900 p-4"><p className="text-xs text-gray-500">Current balance</p><p className="mt-1 text-2xl font-bold text-amber-200">{money(folio.balance)}</p></div>
        <div className="mt-4 space-y-2">
          {loading ? <p className="py-8 text-center text-sm text-gray-500">Loading folio lines…</p> : null}
          {!loading && lines.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No folio lines have been posted.</p> : null}
          {lines.map((line) => (
            <div key={line.id} className="rounded-2xl bg-gray-900 px-3 py-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{line.description || titleCase(line.line_type || 'folio line')}</p><p className="mt-1 text-xs text-gray-500">{shortDateTime(line.created_at)}</p></div><p className={`text-sm font-bold ${Number(line.amount || 0) < 0 ? 'text-emerald-300' : 'text-white'}`}>{money(line.amount)}</p></div>
            </div>
          ))}
        </div>
        <MobileBoundaryNotice compact>Folio viewing is live on mobile. Posting charges, payments, transfers, and settlements remains in the controlled front-desk workflow.</MobileBoundaryNotice>
      </div>
    </div>
  )
}

export default function HotelFolios() {
  const { user } = useAuth()
  const [folios, setFolios] = useState([])
  const [selected, setSelected] = useState(null)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [lineLoading, setLineLoading] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setFolios(await listHotelFolios(user.lodge_id))
      setUpdatedAt(new Date().toISOString())
    } catch (loadError) {
      setError(loadError?.message || 'Hotel folios could not load.')
    } finally {
      setLoading(false)
    }
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const openFolio = async (folio) => {
    setSelected(folio)
    setLines([])
    setLineLoading(true)
    try {
      setLines(await getHotelFolioLines(user.lodge_id, folio.id))
    } catch (lineError) {
      setError(lineError?.message || 'Folio lines could not load.')
    } finally {
      setLineLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Folios</h1><p className="mt-1 text-xs text-gray-400">Live guest and company folio balances</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300" aria-label="Refresh folios"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div></header>
      <main className="space-y-3 px-4 py-4">
        {error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
        {!loading && folios.length === 0 ? <EmptyState icon={WalletCards} title="No active folios" message="Guest folios appear here after the hotel front-desk workflow opens them." /> : null}
        {folios.map((folio) => (
          <button key={folio.id} type="button" onClick={() => openFolio(folio)} className="flex w-full items-center gap-3 rounded-2xl bg-gray-800 px-3 py-3 text-left active:scale-[0.99]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-950/50 text-amber-300"><WalletCards size={18} /></div>
            <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold text-white">{folio.folio_number || 'Folio'}</p><p className="shrink-0 text-sm font-bold text-amber-200">{money(folio.balance)}</p></div><p className="mt-1 truncate text-xs text-gray-500">{folio.label || titleCase(folio.folio_type || 'guest')} · {titleCase(folio.status || 'open')}</p></div>
            <ChevronRight size={16} className="shrink-0 text-gray-600" />
          </button>
        ))}
      </main>
      {selected ? <FolioDetail folio={selected} lines={lines} loading={lineLoading} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}
