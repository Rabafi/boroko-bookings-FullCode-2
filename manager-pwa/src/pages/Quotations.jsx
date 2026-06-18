import { useEffect, useState } from 'react'
import { Building2, BedDouble, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { FRONT_DESK_ONLY_MESSAGE, listQuotations } from '../lib/api'
import { bookingStatusClass, money, shortDate, titleCase } from '../lib/format'

export default function Quotations() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [quotations, setQuotations] = useState([])
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const quotationRows = await listQuotations(user.lodge_id).catch(() => [])
    setQuotations(quotationRows)
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  const filtered = quotations.filter((quotation) => {
    const query = search.toLowerCase()
    return !query
      || quotation.customer_name?.toLowerCase().includes(query)
      || quotation.event_name?.toLowerCase().includes(query)
      || quotation.quotation_number?.toLowerCase().includes(query)
  })

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Quotations</h1>
            <p className="text-xs text-gray-400">Offers, approvals, and booking conversion</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" placeholder="Search quotations…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="mt-3 rounded-xl border border-yellow-800 bg-yellow-950/40 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Front Desk only</p>
          <p className="mt-1 text-sm text-yellow-100">{FRONT_DESK_ONLY_MESSAGE}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {filtered.map((quotation) => (
          <div key={quotation.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{quotation.customer_name || 'Guest'}</p>
                <p className="text-xs text-gray-400 mt-1">{quotation.quotation_number || 'Draft quotation'} • {shortDate(quotation.valid_until || quotation.created_at)}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                  {quotation.quotation_type === 'exclusive_event'
                    ? <><Building2 size={12} className="text-indigo-400" /> Full Lodge{quotation.event_name ? ` · ${quotation.event_name}` : ''}</>
                    : <><BedDouble size={12} /> {quotation.room_name || 'Room not locked'}</>}
                  <span>• {money(quotation.total_amount, quotation.currency || 'BWP')}</span>
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${bookingStatusClass(quotation.status)}`}>{titleCase(quotation.status)}</span>
            </div>
            <div className="mt-3 rounded-xl border border-yellow-800 bg-yellow-950/30 px-3 py-2">
              <p className="text-xs text-yellow-100">Quotation creation, edits, sending, and conversion are available from the Front Desk system only.</p>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && <p className="text-sm text-gray-500">No quotations found.</p>}
      </div>
    </div>
  )
}
