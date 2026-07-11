import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { CalendarDays, Hotel, Users, Tag, CheckCircle2, Clock, CreditCard } from 'lucide-react'
import { rpc } from '../lib/publicApi.js'
import { useGuestPortal } from './GuestPortalSession.jsx'

export default function GuestBookingView() {
  const { token } = useGuestPortal()
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcErr } = await rpc('get_guest_portal_booking_details', { p_token: token })
        if (cancelled) return
        if (rpcErr) { setError(rpcErr.message); return }
        if (!data || data.success === false) { setError(data?.error || 'Could not load booking.'); return }
        setBooking(data.booking)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-14 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )
  }

  if (!booking || !booking.booking_id) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
        <Hotel className="mx-auto mb-3 h-10 w-10 text-[var(--muted)]" />
        <p className="text-sm text-[var(--muted)]">No booking linked to your account.</p>
      </div>
    )
  }

  const statusColors = {
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
    completed: 'bg-sky-50 text-sky-700 border-sky-200',
    'in-house': 'bg-indigo-50 text-indigo-700 border-indigo-200'
  }
  const statusClass = statusColors[booking.status] || 'bg-gray-50 text-gray-700 border-gray-200'

  return (
    <div className="space-y-5">
      <div className="surface-card rounded-[24px] overflow-hidden">
        <div className="bg-gradient-to-r from-[var(--brand)] to-[var(--brand-strong)] px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Booking Reference</p>
          <p className="font-display mt-1 text-xl font-bold text-white">{booking.booking_reference || 'N/A'}</p>
        </div>

        <div className="divide-y divide-[var(--line)] px-6 py-4">
          <div className="flex items-center gap-4 py-3">
            <CalendarDays className="h-5 w-5 shrink-0 text-[var(--brand)]" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Check-in</p>
              <p className="font-semibold text-[var(--text)]">{booking.check_in ? format(new Date(booking.check_in), 'EEE, MMM d, yyyy') : '—'}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 py-3">
            <CalendarDays className="h-5 w-5 shrink-0 text-[var(--brand)]" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Check-out</p>
              <p className="font-semibold text-[var(--text)]">{booking.check_out ? format(new Date(booking.check_out), 'EEE, MMM d, yyyy') : '—'}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 py-3">
            <Hotel className="h-5 w-5 shrink-0 text-[var(--brand)]" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Room</p>
              <p className="font-semibold text-[var(--text)]">
                {[booking.room_type, booking.room_number].filter(Boolean).join(' — ') || '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 py-3">
            <Tag className="h-5 w-5 shrink-0 text-[var(--brand)]" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">Status</p>
              <span className={`mt-0.5 inline-block rounded-full border px-3 py-0.5 text-xs font-semibold capitalize ${statusClass}`}>
                {booking.status || '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="surface-card rounded-[24px] divide-y divide-[var(--line)]">
        <div className="flex items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold text-[var(--text)]">Total Amount</span>
          <span className="font-display text-lg font-bold text-[var(--text)]">
            {booking.total_amount != null ? `$${Number(booking.total_amount).toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold text-[var(--text)]">Amount Paid</span>
          <span className="font-display text-lg font-bold text-[var(--success)]">
            {booking.amount_paid != null ? `$${Number(booking.amount_paid).toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold text-[var(--text)]">Balance Due</span>
          <span className={`font-display text-lg font-bold ${Number(booking.balance) > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
            {booking.balance != null ? `$${Number(booking.balance).toFixed(2)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
