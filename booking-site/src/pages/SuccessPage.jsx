import { useLocation, useParams, Link, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { format } from 'date-fns'
import { CheckCircle2, CalendarPlus, Copy, Check, Mail, Moon, ShieldCheck } from 'lucide-react'
import { trackBookingRequest } from '../lib/analytics.js'
import { buildCalendarUrl } from '../lib/utils.js'
import { readSessionState } from '../lib/hooks.js'
import SeoMeta from '../components/SeoMeta.jsx'

const SUCCESS_BOOKING_KEY = 'success-booking-data'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--line)] active:scale-95"
      type="button"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function SuccessPage() {
  const { slug } = useParams()
  const { state } = useLocation()
  const headingRef = useRef(null)

  const [booking, setBooking] = useState(() => {
    // Prefer React Router state
    if (state?.booking) return state.booking
    // Fallback to sessionStorage
    return readSessionState(SUCCESS_BOOKING_KEY)
  })

  useEffect(() => {
    if (booking?.booking_id) {
      trackBookingRequest(slug, booking.room_id, booking.booking_id, booking.total_amount)
    }
  }, [slug, booking])

  // Persist to sessionStorage so it survives refresh
  useEffect(() => {
    if (booking) {
      try {
        window.sessionStorage.setItem(SUCCESS_BOOKING_KEY, JSON.stringify(booking))
      } catch {
        // ignore
      }
    }
  }, [booking])

  // Focus heading on mount for screen readers
  useEffect(() => {
    if (headingRef.current) {
      headingRef.current.setAttribute('tabIndex', '-1')
      headingRef.current.focus()
    }
  }, [])

  if (!booking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-sm rounded-[32px] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">Nothing to show here.</p>
          <Link to={`/${slug}`} className="mt-4 inline-block text-sm font-bold text-[var(--brand)] hover:underline">
            Back to rooms
          </Link>
        </div>
      </div>
    )
  }

  const calendarUrl = buildCalendarUrl(booking)
  const stayLabel = booking.booking_type === 'full_lodge'
    ? 'Full Lodge'
    : Number(booking.room_count || 0) > 1
      ? `${booking.room_count} rooms`
      : booking.room_number
  const stayType = booking.booking_type === 'full_lodge'
    ? 'Exclusive use'
    : Number(booking.room_count || 0) > 1
      ? 'Multi-room stay'
      : booking.room_type
  const stayDescription = stayType ? `${stayLabel} (${stayType})` : stayLabel

  return (
    <div className="min-h-screen overflow-x-hidden bg-transparent px-4 py-8 sm:py-12">
      <SeoMeta
        title={`Booking Request Sent — ${booking.lodge_name}`}
        description={`Your reservation request for ${stayLabel} at ${booking.lodge_name} has been received. Reference: ${booking.reference}.`}
        noindex
      />
      <div className="mx-auto max-w-2xl">
        <div className="surface-card overflow-hidden rounded-[34px]">
          <div className="bg-[linear-gradient(135deg,#245640_0%,#2e6c51_100%)] px-6 py-8 text-center text-white sm:px-8 sm:py-10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 sm:h-16 sm:w-16">
              <CheckCircle2 size={36} className="sm:h-[42px] sm:w-[42px]" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/70">Request Received</p>
            <h1 ref={headingRef} className="font-display mt-3 text-[1.75rem] sm:text-4xl" tabIndex={-1}>
              Booking request sent
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/90">
              {booking.lodge_name} has received your stay request and should confirm or contact you within 24 hours.
            </p>
          </div>

          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-5">
              <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface-soft)] px-5 py-5 text-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Booking Reference</p>
                <div className="mt-2 break-words text-[1.75rem] font-extrabold tracking-[0.18em] text-[var(--text)] sm:text-3xl">
                  {booking.reference}
                </div>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <CopyButton text={booking.reference} />
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">Keep this reference in case you need to follow up.</p>
              </div>

              <div className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Booking Summary</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Property</span>
                    <span className="break-words font-semibold text-[var(--text)] text-right">{booking.lodge_name}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Stay</span>
                    <span className="break-words font-semibold text-[var(--text)] text-right">{stayDescription}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Check-in</span>
                    <span className="font-semibold text-[var(--text)]">{booking.check_in ? format(new Date(booking.check_in), 'd MMM yyyy') : '—'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Check-out</span>
                    <span className="font-semibold text-[var(--text)]">{booking.check_out ? format(new Date(booking.check_out), 'd MMM yyyy') : '—'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="inline-flex items-center gap-1 text-[var(--muted)]"><Moon size={13} aria-hidden="true" /> Nights</span>
                    <span className="font-semibold text-[var(--text)]">{booking.nights}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-[var(--line)] pt-3">
                    <span className="text-[var(--muted)]">Estimated total</span>
                    <span className="text-lg font-extrabold text-[var(--text)]">
                      {booking.currency}{Number(booking.total_amount).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-5">
              <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface-soft)] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Confirmation Contact</p>
                <div className="mt-4 flex items-start gap-3">
                  <div className="rounded-full bg-white p-2 text-[var(--brand)]">
                    <Mail size={16} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--text)]">{booking.guest_name}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{booking.guest_email}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">What Happens Next</p>
                <div className="mt-4 space-y-4 text-sm text-[var(--muted)]">
                  <div className="flex gap-3">
                    <span className="font-display text-2xl text-[var(--brand)]">1</span>
                    <p>The lodge reviews your dates and room request.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-display text-2xl text-[var(--brand)]">2</span>
                    <p>You receive confirmation or a follow-up message within 24 hours.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="font-display text-2xl text-[var(--brand)]">3</span>
                    <p>Payment details are shared once the reservation is confirmed.</p>
                  </div>
                </div>
              </div>

              {calendarUrl && (
                <a
                  href={calendarUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-5 py-3 text-center text-sm font-extrabold text-[var(--text)] transition-colors hover:bg-[var(--surface-soft)] active:scale-[0.98]"
                >
                  <CalendarPlus size={16} aria-hidden="true" />
                  Add to Google Calendar
                </a>
              )}

              <div className="rounded-[24px] border border-[var(--line)] bg-[var(--brand-soft)] p-5 text-sm text-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={18} className="mt-0.5 text-[var(--success)]" aria-hidden="true" />
                  <p>Your request has already been saved. Even if email delivery is delayed, the property can still see your booking reference in Tsa Bonno LodgingOS.</p>
                </div>
              </div>

              <Link
                to={`/${slug}`}
                className="brand-button block break-words rounded-2xl px-5 py-3 text-center text-sm font-extrabold active:scale-[0.98]"
              >
                Back to {booking.lodge_name}
              </Link>
            </section>
          </div>
        </div>

        <p className="mt-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Reservation request received
        </p>
      </div>
    </div>
  )
}
