import { useLocation, useParams, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { CheckCircle, Moon } from 'lucide-react'

export default function SuccessPage() {
  const { slug } = useParams()
  const { state } = useLocation()
  const booking = state?.booking

  if (!booking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-stone-500 mb-4">Nothing to show here.</p>
          <Link to={`/${slug}`} className="text-amber-600 hover:underline text-sm font-medium">
            ← Back to rooms
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">

        {/* Success header */}
        <div className="bg-emerald-600 px-6 py-8 text-center">
          <CheckCircle size={48} className="text-white mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-white">Booking Request Sent!</h1>
          <p className="text-emerald-100 mt-1 text-sm">
            {booking.lodge_name} will confirm within 24 hours.
          </p>
        </div>

        <div className="p-6 space-y-5">

          {/* Reference number */}
          <div className="text-center bg-stone-50 rounded-xl py-4 px-6 border border-stone-200">
            <div className="text-xs text-stone-400 uppercase tracking-widest mb-1">Booking Reference</div>
            <div className="text-3xl font-bold text-stone-900 tracking-wide font-mono">
              {booking.reference}
            </div>
            <div className="text-xs text-stone-400 mt-1">Save this number for your records</div>
          </div>

          {/* Booking summary */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">Property</span>
              <span className="font-medium text-stone-900">{booking.lodge_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">Room</span>
              <span className="font-medium text-stone-900">
                {booking.room_number} ({booking.room_type})
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">Check-in</span>
              <span className="font-medium text-stone-900">
                {booking.check_in ? format(new Date(booking.check_in), 'd MMM yyyy') : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">Check-out</span>
              <span className="font-medium text-stone-900">
                {booking.check_out ? format(new Date(booking.check_out), 'd MMM yyyy') : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500 flex items-center gap-1">
                <Moon size={12} /> Nights
              </span>
              <span className="font-medium text-stone-900">{booking.nights}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-stone-100 pt-3">
              <span className="text-stone-500">Estimated total</span>
              <span className="font-bold text-stone-900">
                {booking.currency}{Number(booking.total_amount).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Guest */}
          <div className="bg-stone-50 rounded-xl p-4 text-sm">
            <div className="text-stone-400 text-xs mb-1">Confirmation will be sent to</div>
            <div className="font-medium text-stone-800">{booking.guest_name}</div>
            <div className="text-stone-500">{booking.guest_email}</div>
          </div>

          {/* What happens next */}
          <div className="text-sm text-stone-600 space-y-2">
            <p className="font-medium text-stone-800">What happens next?</p>
            <ol className="list-decimal list-inside space-y-1 text-stone-500">
              <li>The lodge reviews your request</li>
              <li>They confirm or contact you within 24 hours</li>
              <li>Payment details will be provided at confirmation</li>
            </ol>
          </div>

          <Link
            to={`/${slug}`}
            className="block w-full text-center bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            Back to {booking.lodge_name}
          </Link>
        </div>
      </div>

      <p className="mt-6 text-xs text-stone-400">Powered by Boroko Bookings</p>
    </div>
  )
}
