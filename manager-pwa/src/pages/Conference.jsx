import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { FRONT_DESK_ONLY_MESSAGE, listConferenceBookings } from '../lib/api'
import { money, shortDate, titleCase } from '../lib/format'

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
            <h1 className="text-lg font-bold text-white">Conference</h1>
            <p className="text-xs text-gray-400">Venue bookings and event deposits</p>
          </div>
          <button onClick={load} className="p-2 text-gray-400"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-3 rounded-xl border border-yellow-800 bg-yellow-950/40 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Front Desk only</p>
          <p className="mt-1 text-sm text-yellow-100">{FRONT_DESK_ONLY_MESSAGE}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {bookings.map((booking) => (
          <div key={booking.id} className="bg-gray-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{booking.client_name}</p>
                <p className="text-xs text-gray-400 mt-1">{shortDate(booking.booking_date)} • {booking.start_time} - {booking.end_time}</p>
                <p className="text-xs text-gray-500 mt-1">{titleCase(booking.setup_type)} • {money(booking.total_amount)}</p>
                <p className="text-xs text-gray-500 mt-1">Deposit {money(booking.deposit_paid)} • {titleCase(booking.payment_status || 'unpaid')}</p>
              </div>
            </div>
          </div>
        ))}
        {!loading && bookings.length === 0 && <p className="text-sm text-gray-500">No conference bookings found.</p>}
      </div>
    </div>
  )
}
