import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getGuestHistory, listGuests } from '../lib/api'
import { bookingStatusClass, money, shortDate, titleCase } from '../lib/format'

export default function Guests() {
  const { user } = useAuth()
  const [guests, setGuests] = useState([])
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [history, setHistory] = useState([])

  const load = async () => {
    const data = await listGuests(user.lodge_id).catch(() => [])
    setGuests(data)
  }

  useEffect(() => { load() }, [user.lodge_id])

  const filtered = guests.filter((guest) => {
    const query = search.toLowerCase()
    return !query || guest.name?.toLowerCase().includes(query) || guest.phone?.includes(query) || guest.email?.toLowerCase().includes(query)
  })

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <h1 className="text-lg font-bold text-white">Guests</h1>
        <p className="text-xs text-gray-400">History, contact details, and blacklist protection</p>
        <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white mt-3" placeholder="Search guests…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <div className="px-4 py-4 space-y-3">
        {filtered.map((guest) => (
          <div key={guest.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{guest.name}</p>
                <p className="text-xs text-gray-400 mt-1">{guest.phone || 'No phone'} • {guest.email || 'No email'}</p>
                {guest.is_blacklisted && <p className="text-xs text-red-400 mt-2">Blacklisted • {guest.blacklist_reason || 'No reason recorded'}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => {
                    if (expanded === guest.id) {
                      setExpanded(null)
                      setHistory([])
                      return
                    }
                    setExpanded(guest.id)
                    setHistory(await getGuestHistory(user.lodge_id, guest.id).catch(() => []))
                  }}
                  className="p-2 text-gray-400"
                >
                  {expanded === guest.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            </div>

            {expanded === guest.id && (
              <div className="mt-3 space-y-2">
                {history.map((booking) => (
                  <div key={booking.id} className="bg-gray-900 rounded-xl px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Room {booking.room_number || '—'}</p>
                        <p className="text-xs text-gray-400 mt-1">{shortDate(booking.check_in)} → {shortDate(booking.check_out)}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${bookingStatusClass(booking.status)}`}>
                        {titleCase(booking.status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-gray-400">Total</span>
                      <span className="text-white">{money(booking.total_amount)}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && <p className="text-sm text-gray-500">No booking history found.</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
