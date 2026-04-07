import { useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Moon, Users, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import LodgeHeader from '../components/LodgeHeader.jsx'

const EMAIL_FUNCTION_URL = import.meta.env.VITE_CONFIRMATION_EMAIL_FUNCTION_URL

export default function BookingPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()

  // Guard: if navigated directly without state, go back to lodge page
  if (!state?.lodge || !state?.room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-stone-500 mb-4">No room selected.</p>
          <Link to={`/${slug}`} className="text-amber-600 hover:underline text-sm font-medium">
            ← Back to rooms
          </Link>
        </div>
      </div>
    )
  }

  const { lodge, room, checkIn, checkOut, nights } = state

  const [form, setForm] = useState({
    guest_first_name: '',
    guest_last_name: '',
    guest_email: '',
    guest_phone: '',
    adults: 1,
    children: 0,
    notes: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { data, error: rpcError } = await supabase.rpc('create_online_booking', {
      p_slug: slug,
      payload: {
        room_id: room.id,
        check_in: checkIn,
        check_out: checkOut,
        guest_first_name: form.guest_first_name.trim(),
        guest_last_name: form.guest_last_name.trim(),
        guest_email: form.guest_email.trim().toLowerCase(),
        guest_phone: form.guest_phone.trim(),
        adults: Number(form.adults),
        children: Number(form.children),
        notes: form.notes.trim()
      }
    })

    if (rpcError || !data?.success) {
      setSubmitting(false)
      setError(data?.error || rpcError?.message || 'Something went wrong. Please try again.')
      return
    }

    // Fire-and-forget: trigger confirmation email via Edge Function
    if (EMAIL_FUNCTION_URL) {
      fetch(EMAIL_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: data.booking_id, guest_email: data.guest_email })
      }).catch(() => {
        // Non-critical — booking is already saved regardless of email failure
      })
    }

    navigate(`/${slug}/success`, { state: { booking: data }, replace: true })
  }

  const totalAmount = Number(room.rate_per_night) * nights

  return (
    <div className="min-h-screen bg-stone-50">
      <LodgeHeader lodge={lodge} />

      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Back link */}
        <Link
          to={`/${slug}`}
          className="inline-flex items-center gap-1.5 text-stone-500 hover:text-stone-700 text-sm mb-6"
        >
          <ArrowLeft size={15} />
          Back to rooms
        </Link>

        {/* Booking summary */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden mb-6">
          {room.photo && (
            <img
              src={room.photo}
              alt={room.room_number}
              className="w-full h-40 object-cover"
            />
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  {room.room_type}
                </span>
                <h2 className="text-xl font-bold text-stone-900 mt-1">{room.room_number}</h2>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-stone-900">
                  {lodge.currency}{totalAmount.toLocaleString()}
                </div>
                <div className="text-xs text-stone-400">estimated total</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-xs text-stone-400 mb-0.5">Check-in</div>
                <div className="font-semibold text-stone-800 text-sm">
                  {format(new Date(checkIn), 'd MMM yyyy')}
                </div>
              </div>
              <div className="bg-stone-50 rounded-xl p-3">
                <div className="text-xs text-stone-400 mb-0.5">Check-out</div>
                <div className="font-semibold text-stone-800 text-sm">
                  {format(new Date(checkOut), 'd MMM yyyy')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3 text-sm text-stone-500">
              <span className="flex items-center gap-1">
                <Moon size={13} />
                {nights} night{nights !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <Users size={13} />
                Up to {room.max_occupancy} guests
              </span>
            </div>
          </div>
        </div>

        {/* Notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-800">
          <strong>Request to book:</strong> This is a booking request. The lodge will confirm your reservation within 24 hours and contact you by email.
        </div>

        {/* Guest form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-5">
          <h3 className="font-bold text-stone-900 text-lg">Your details</h3>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                First name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="guest_first_name"
                value={form.guest_first_name}
                onChange={handleChange}
                required
                autoComplete="given-name"
                placeholder="Thabo"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Last name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="guest_last_name"
                value={form.guest_last_name}
                onChange={handleChange}
                required
                autoComplete="family-name"
                placeholder="Modise"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Email address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="guest_email"
              value={form.guest_email}
              onChange={handleChange}
              required
              autoComplete="email"
              placeholder="thabo@example.com"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
            />
            <p className="text-xs text-stone-400 mt-1">Your confirmation will be sent here.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Phone number
            </label>
            <input
              type="tel"
              name="guest_phone"
              value={form.guest_phone}
              onChange={handleChange}
              autoComplete="tel"
              placeholder="+267 71 234 567"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Adults</label>
              <select
                name="adults"
                value={form.adults}
                onChange={handleChange}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              >
                {Array.from({ length: room.max_occupancy }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Children</label>
              <select
                name="children"
                value={form.children}
                onChange={handleChange}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              >
                {[0, 1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Special requests <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Early check-in, dietary needs, etc."
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-60 text-white font-bold py-3.5 px-4 rounded-xl transition-colors text-base"
          >
            {submitting ? 'Sending request…' : 'Send booking request'}
          </button>

          <p className="text-center text-xs text-stone-400">
            No payment required now. The lodge will contact you to confirm.
          </p>
        </form>
      </main>

      <footer className="text-center text-xs text-stone-400 py-8">
        Powered by Boroko Bookings
      </footer>
    </div>
  )
}
