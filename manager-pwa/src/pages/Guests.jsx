import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Search, Users, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getGuestHistory, getGuestLifetimeCount, getGuestLifetimeSummary } from '../lib/api'
import { bookingStatusClass, money, shortDate, titleCase } from '../lib/format'

const PAGE_SIZE = 50

function GuestStatusBadge({ status }) {
  const styles = {
    new: 'bg-blue-900/50 text-blue-300',
    returning: 'bg-green-900/50 text-green-300',
    frequent: 'bg-purple-900/50 text-purple-300',
    outstanding_balance: 'bg-red-900/50 text-red-300'
  }
  const labels = {
    new: 'New',
    returning: 'Returning',
    frequent: 'Frequent',
    outstanding_balance: 'Outstanding'
  }
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status] || 'bg-gray-800 text-gray-400'}`}>
      {labels[status] || status}
    </span>
  )
}

function GuestSummaryCard({ guest, isExpanded, onToggle }) {
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (isExpanded && history.length === 0) {
      setHistoryLoading(true)
      try {
        const rows = await getGuestHistory(guest.lodge_id || '', guest.customer_id)
        setHistory(rows)
      } catch {
        setHistory([])
      }
      setHistoryLoading(false)
    }
  }, [isExpanded, history.length, guest])

  useEffect(() => { loadHistory() }, [loadHistory])

  return (
    <div className="bg-gray-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">{guest.customer_name}</p>
              <GuestStatusBadge status={guest.guest_status} />
              {guest.is_blacklisted && <span className="shrink-0 rounded-full bg-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-300">Blocked</span>}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{guest.customer_phone || 'No phone'} · {guest.customer_email || 'No email'}</p>
          </div>
          <div className="shrink-0 mt-0.5 text-gray-400">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
          <span>{guest.total_stays} stay{guest.total_stays === 1 ? '' : 's'}</span>
          {guest.last_stay_date && <span>Last: {shortDate(guest.last_stay_date)}</span>}
          {guest.upcoming_stay_date && <span className="text-green-400">Upcoming: {shortDate(guest.upcoming_stay_date)}</span>}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-700 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-900 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase">Total Value</p>
              <p className="text-sm font-bold text-white">{money(guest.accommodation_value)}</p>
            </div>
            <div className="bg-gray-900 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase">Paid</p>
              <p className="text-sm font-bold text-green-400">{money(guest.payments_received)}</p>
            </div>
            <div className="bg-gray-900 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase">Outstanding</p>
              <p className={`text-sm font-bold ${guest.outstanding_balance > 0 ? 'text-red-400' : 'text-gray-400'}`}>{money(guest.outstanding_balance)}</p>
            </div>
            <div className="bg-gray-900 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase">Avg Stay</p>
              <p className="text-sm font-bold text-white">{money(guest.average_completed_stay_value)}</p>
            </div>
          </div>

          {guest.pos_charges > 0 && (
            <div className="bg-gray-900 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase">POS Charges (linked)</p>
              <p className="text-sm font-bold text-blue-400">{money(guest.pos_charges)}</p>
            </div>
          )}

          {guest.is_blacklisted && (
            <div className="rounded-xl bg-red-900/30 border border-red-800/40 px-3 py-2">
              <p className="text-xs font-semibold text-red-300">Blacklisted{guest.blacklist_reason ? `: ${guest.blacklist_reason}` : ''}</p>
            </div>
          )}

          {guest.outstanding_balance > 0 && (
            <div className="rounded-xl bg-amber-900/30 border border-amber-800/40 px-3 py-2">
              <p className="text-xs font-semibold text-amber-300">Outstanding balance of {money(guest.outstanding_balance)} needs follow-up</p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2">Booking History</p>
            {historyLoading ? (
              <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : history.length > 0 ? (
              <div className="space-y-1.5">
                {history.map((booking) => (
                  <div key={booking.id} className="bg-gray-900 rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">Room {booking.room_number || '—'}</p>
                        <p className="text-[10px] text-gray-500">{shortDate(booking.check_in)} → {shortDate(booking.check_out)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${bookingStatusClass(booking.status)}`}>
                          {titleCase(booking.status)}
                        </span>
                        <span className="text-xs text-white">{money(booking.total_amount)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No booking history found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Guests() {
  const { user } = useAuth()
  const [guests, setGuests] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const load = useCallback(async ({ reset = false } = {}) => {
    setLoading(true)
    setLoadError('')
    try {
      const offset = reset ? 0 : page * PAGE_SIZE
      const [rows, count] = await Promise.all([
        getGuestLifetimeSummary(user.lodge_id, { search: debouncedSearch, limit: PAGE_SIZE, offset }),
        getGuestLifetimeCount(user.lodge_id, { search: debouncedSearch })
      ])
      if (reset) {
        setGuests(rows)
        setPage(0)
      } else {
        setGuests((current) => [...current, ...rows])
      }
      setTotalCount(count)
      setHasMore(rows.length >= PAGE_SIZE)
    } catch (error) {
      setLoadError(error?.message || 'Guests could not load.')
    }
    setLoading(false)
  }, [user.lodge_id, debouncedSearch, page])

  useEffect(() => { load({ reset: true }) }, [debouncedSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Guests</h1>
            <p className="text-xs text-gray-400">{totalCount} guest{totalCount === 1 ? '' : 's'} · Lifetime intelligence</p>
          </div>
          <button onClick={() => load({ reset: true })} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-3 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white"
            placeholder="Search by name, phone, or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loadError && (
          <div className="rounded-2xl border border-red-900/60 bg-red-950/40 px-4 py-3">
            <p className="text-sm text-red-200">{loadError}</p>
          </div>
        )}

        {!loading && guests.length === 0 && !loadError && (
          <div className="text-center py-12">
            <Users size={28} className="mx-auto text-gray-600 mb-3" />
            <p className="text-sm font-semibold text-white">{debouncedSearch ? 'No matching guests' : 'No guests yet'}</p>
            <p className="text-xs text-gray-500 mt-1">{debouncedSearch ? 'Try a different search term.' : 'Guests will appear here after their first booking.'}</p>
          </div>
        )}

        {guests.map((guest) => (
          <GuestSummaryCard
            key={guest.customer_id}
            guest={guest}
            isExpanded={expanded === guest.customer_id}
            onToggle={() => setExpanded(expanded === guest.customer_id ? null : guest.customer_id)}
          />
        ))}

        {hasMore && !loading && guests.length > 0 && (
          <button
            type="button"
            onClick={() => { setPage((p) => p + 1); load() }}
            className="w-full rounded-2xl bg-gray-800 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Load more guests
          </button>
        )}

        {loading && guests.length === 0 && (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        )}
      </div>
    </div>
  )
}
