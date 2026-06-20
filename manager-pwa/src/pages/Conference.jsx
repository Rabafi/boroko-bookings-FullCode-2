import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { FRONT_DESK_ONLY_MESSAGE, listConferenceBookings } from '../lib/api'
import { money, shortDate, titleCase } from '../lib/format'

const EVENT_TYPE_LABELS = {
  conference: 'Conference', meeting: 'Meeting', party: 'Party', wedding: 'Wedding',
  corporate: 'Corporate', pool_party: 'Pool Party', braai: 'Braai', reception: 'Reception', other: 'Other'
}
const SCOPE_LABELS = { venue_only: 'Venue Only', venue_with_rooms: 'Venue + Rooms', exclusive_lodge: 'Entire Lodge' }
const STATUS_COLORS = {
  draft: 'bg-gray-700 text-gray-300', reserved: 'bg-blue-900 text-blue-300',
  confirmed: 'bg-indigo-900 text-indigo-300', active: 'bg-green-900 text-green-300',
  completed: 'bg-emerald-900 text-emerald-300', cancelled: 'bg-red-900 text-red-300'
}
const PAYMENT_COLORS = {
  unpaid: 'bg-gray-700 text-gray-400', partial: 'bg-amber-900 text-amber-300', paid: 'bg-green-900 text-green-300'
}

export default function Conference() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await listConferenceBookings(user.lodge_id).catch(() => [])
    setBookings(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [user.lodge_id])

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Events & Venues</h1>
            <p className="text-xs text-gray-400">All event and venue bookings</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-3 rounded-xl border border-yellow-800 bg-yellow-950/40 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Front Desk only</p>
          <p className="mt-1 text-sm text-yellow-100">{FRONT_DESK_ONLY_MESSAGE}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {bookings.map((b) => {
          const isEvent = b.event_type || b.reservation_scope || b.event_name
          return (
            <div key={b.id} className="bg-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{b.event_name || b.client_name}</p>
                  <p className="text-xs text-gray-400 mt-1">{shortDate(b.booking_date)} · {b.start_time} - {b.end_time}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {isEvent && (
                      <span className="inline-block rounded-full bg-purple-900 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                        {EVENT_TYPE_LABELS[b.event_type] || b.event_type || 'Event'}
                      </span>
                    )}
                    {isEvent && (
                      <span className="inline-block rounded-full bg-teal-900 px-2 py-0.5 text-[10px] font-medium text-teal-300">
                        {SCOPE_LABELS[b.reservation_scope] || b.reservation_scope || 'Venue'}
                      </span>
                    )}
                    {b.status && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[b.status] || 'bg-gray-700 text-gray-400'}`}>
                        {titleCase(b.status)}
                      </span>
                    )}
                    {b.payment_status && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_COLORS[b.payment_status] || 'bg-gray-700 text-gray-400'}`}>
                        {titleCase(b.payment_status)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-gray-500">Total</p>
                  <p className="font-semibold text-white">{money(b.total_amount)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Paid</p>
                  <p className="font-semibold text-white">{money(b.amount_paid || b.deposit_paid)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Balance</p>
                  <p className="font-semibold text-white">{money(Math.max(0, (b.total_amount || 0) - (b.amount_paid || b.deposit_paid || 0)))}</p>
                </div>
              </div>
              {b.room_name && <p className="text-[10px] text-gray-500 mt-2">Room: {b.room_name}</p>}
              {b.company && <p className="text-[10px] text-gray-500">Company: {b.company}</p>}
            </div>
          )
        })}
        {!loading && bookings.length === 0 && <p className="text-sm text-gray-500">No events found.</p>}
      </div>
    </div>
  )
}
