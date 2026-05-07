import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  Moon,
  Phone,
  Users
} from 'lucide-react'
import { isMissingRpcError, readSessionCache, rpc, writeSessionCache } from '../lib/publicApi.js'
import LodgeHeader from '../components/LodgeHeader.jsx'

const EMAIL_FUNCTION_URL = import.meta.env.VITE_CONFIRMATION_EMAIL_FUNCTION_URL
const ROOM_MEDIA_TTL_MS = 30 * 60 * 1000

function buildWhatsAppUrl(number) {
  const digits = String(number || '').replace(/[^\d]/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

function clampGuestCount(value, max) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(numeric, Math.max(0, max)))
}

function toGuestBookingError(message) {
  const text = String(message || '').toLowerCase()
  if (!text) return 'Something went wrong. Please try again.'
  if (text.includes('available') || text.includes('already booked') || text.includes('overlap') || text.includes('conflict')) {
    return 'That room is no longer available for those dates. Please choose different dates.'
  }
  if (text.includes('guest') || text.includes('email') || text.includes('phone') || text.includes('date') || text.includes('required') || text.includes('invalid')) {
    return 'Please review your booking details and try again.'
  }
  return 'We could not send your booking request right now. Please try again or contact the lodge directly.'
}

export default function BookingPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()

  if (!state?.lodge || !state?.room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-sm rounded-[30px] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No room selected.</p>
          <Link to={`/${slug}`} className="mt-4 inline-block text-sm font-bold text-[var(--brand)] hover:underline">
            Back to rooms
          </Link>
        </div>
      </div>
    )
  }

  const { lodge, room, checkIn, checkOut, nights } = state
  const initialRoomPhotos = Array.isArray(room.photos) && room.photos.length > 0
    ? room.photos
    : (room.photo ? [room.photo] : [])

  const [roomPhotos, setRoomPhotos] = useState(initialRoomPhotos)
  const [photoIdx, setPhotoIdx] = useState(0)
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
  const [lastSubmitTime, setLastSubmitTime] = useState(0)
  const SUBMIT_COOLDOWN_MS = 2000 // Prevent rapid resubmission

  useEffect(() => {
    setRoomPhotos(initialRoomPhotos)
    setPhotoIdx(0)
  }, [room.id, room.photo, room.photo_count])

  useEffect(() => {
    const maxOccupancy = Number(room?.max_occupancy || 0)
    const adults = clampGuestCount(form.adults, Math.max(1, maxOccupancy))
    const maxChildren = Math.max(0, maxOccupancy - adults)
    const children = clampGuestCount(form.children, maxChildren)

    if (adults !== Number(form.adults) || children !== Number(form.children)) {
      setForm((current) => ({
        ...current,
        adults,
        children
      }))
    }
  }, [form.adults, form.children, room?.max_occupancy])

  useEffect(() => {
    if (!room?.id) return undefined

    const mediaCacheKey = `room-media:${slug}:${room.id}`
    const cachedMedia = readSessionCache(mediaCacheKey, ROOM_MEDIA_TTL_MS)
    const cachedPhotos = Array.isArray(cachedMedia?.photos) ? cachedMedia.photos.filter(Boolean) : []

    if (cachedPhotos.length > 0) {
      setRoomPhotos(cachedPhotos)
      if (!room.photo_count || cachedPhotos.length >= room.photo_count) {
        return undefined
      }
    }

    if (!room.photo_count || room.photo_count <= Math.max(initialRoomPhotos.length, cachedPhotos.length)) {
      return undefined
    }

    const controller = new AbortController()
    let active = true

    async function fetchRoomMedia() {
      const { data, error: mediaError } = await rpc(
        'get_public_room_media',
        { p_slug: slug, p_room_id: room.id },
        { signal: controller.signal }
      )

      if (!active) return
      if (mediaError && isMissingRpcError(mediaError)) return
      if (mediaError || !data?.success) return

      const photos = Array.isArray(data.photos) ? data.photos.filter(Boolean) : []
      if (photos.length === 0) return

      writeSessionCache(mediaCacheKey, { photos })
      setRoomPhotos(photos)
    }

    fetchRoomMedia()

    return () => {
      active = false
      controller.abort()
    }
  }, [initialRoomPhotos.length, room.id, room.photo_count, slug])

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    // Rate limit: prevent rapid resubmission
    const now = Date.now()
    if (now - lastSubmitTime < SUBMIT_COOLDOWN_MS) {
      setError('Please wait a moment before sending another request.')
      return
    }

    const totalGuests = Number(form.adults) + Number(form.children)
    if (totalGuests < 1) {
      setError('Please select at least 1 guest before sending your request.')
      return
    }

    if (totalGuests > Number(room.max_occupancy || 0)) {
      setError(`This room supports up to ${room.max_occupancy} guests. Please reduce the number of adults or children.`)
      return
    }

    setLastSubmitTime(now)
    setSubmitting(true)

    const { data, error: rpcError } = await rpc('create_online_booking', {
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
      setError(toGuestBookingError(data?.error || rpcError?.message))
      return
    }

    if (EMAIL_FUNCTION_URL) {
      fetch(EMAIL_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: data.booking_id, guest_email: data.guest_email })
      }).catch(() => {})
    }

    navigate(`/${slug}/success`, { state: { booking: data }, replace: true })
  }

  const totalAmount = Number(room.rate_per_night) * nights
  const hasContact = lodge?.phone || lodge?.email || lodge?.whatsapp_number
  const whatsappUrl = buildWhatsAppUrl(lodge?.whatsapp_number)
  const maxOccupancy = Math.max(1, Number(room?.max_occupancy || 1))
  const selectedAdults = clampGuestCount(form.adults, maxOccupancy)
  const maxChildren = Math.max(0, maxOccupancy - selectedAdults)

  return (
    <div className="min-h-screen bg-transparent">
      <LodgeHeader lodge={lodge} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-32 sm:px-6 sm:py-8 lg:pb-8">
        <Link
          to={`/${slug}`}
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          <ArrowLeft size={15} />
          Back to rooms
        </Link>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] xl:gap-8">
          <aside className="space-y-5">
            <div className="surface-card overflow-hidden rounded-[32px]">
              {roomPhotos.length > 0 && (
                <div className="group relative">
                  <img
                    src={roomPhotos[photoIdx]}
                    alt={`${room.room_number} — photo ${photoIdx + 1}`}
                    className="h-64 w-full object-cover"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

                  {roomPhotos.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPhotoIdx((index) => (index - 1 + roomPhotos.length) % roomPhotos.length)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotoIdx((index) => (index + 1) % roomPhotos.length)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                        {roomPhotos.map((_, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setPhotoIdx(index)}
                            className={`h-1.5 rounded-full transition-all ${index === photoIdx ? 'w-5 bg-white' : 'w-1.5 bg-white/55 hover:bg-white/80'}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex rounded-full border border-[var(--line-strong)] bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
                      {room.room_type}
                    </span>
                    <h2 className="font-display mt-3 text-[1.9rem] text-[var(--text)] sm:text-3xl">{room.room_number}</h2>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-strong)] px-3.5 py-3 text-right sm:px-4">
                    <div className="text-xl font-extrabold text-[var(--text)] sm:text-2xl">
                      {lodge.currency}{totalAmount.toLocaleString()}
                    </div>
                    <div className="text-xs font-medium text-[var(--muted)]">estimated total</div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Check-in</div>
                    <div className="mt-1 text-sm font-semibold text-[var(--text)]">{format(new Date(checkIn), 'd MMM yyyy')}</div>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Check-out</div>
                    <div className="mt-1 text-sm font-semibold text-[var(--text)]">{format(new Date(checkOut), 'd MMM yyyy')}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-sm text-[var(--muted)]">
                  <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-soft)] px-3 py-1.5">
                    <Moon size={14} />
                    {nights} night{nights !== 1 ? 's' : ''}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-soft)] px-3 py-1.5">
                    <Users size={14} />
                    Up to {room.max_occupancy} guests
                  </span>
                </div>

                {Array.isArray(room.amenities) && room.amenities.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Room amenities</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {room.amenities.map((amenity) => (
                        <span key={amenity} className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                          {amenity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {(lodge?.booking_payment_terms || lodge?.booking_cancellation_policy) && (
              <div className="surface-card rounded-[28px] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Before You Send</p>
                <div className="mt-4 space-y-4 text-sm text-[var(--muted)]">
                  {lodge?.booking_payment_terms && (
                    <div>
                      <p className="font-semibold text-[var(--text)]">Payment terms</p>
                      <p className="mt-1 leading-7">{lodge.booking_payment_terms}</p>
                    </div>
                  )}
                  {lodge?.booking_cancellation_policy && (
                    <div>
                      <p className="font-semibold text-[var(--text)]">Cancellation</p>
                      <p className="mt-1 leading-7">{lodge.booking_cancellation_policy}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {hasContact && (
              <div className="soft-card rounded-[28px] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Need Help Before Sending?</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {whatsappUrl && (
                    <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">
                      <MessageCircle size={14} />
                      WhatsApp
                    </a>
                  )}
                  {lodge?.phone && (
                    <a href={`tel:${lodge.phone}`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold text-[var(--text)]">
                      <Phone size={14} />
                      Call lodge
                    </a>
                  )}
                  {lodge?.email && (
                    <a href={`mailto:${lodge.email}`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold text-[var(--text)] sm:col-span-2">
                      <Mail size={14} />
                      Email lodge
                    </a>
                  )}
                </div>
              </div>
            )}
          </aside>

          <section className="booking-sticky-summary p-5 sm:p-8">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Guest Details</p>
                <h3 className="font-display mt-2 text-[2rem] text-[var(--text)] sm:text-3xl">Complete your request</h3>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-[var(--line)] bg-[var(--surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">
                {format(new Date(checkIn), 'd MMM')} to {format(new Date(checkOut), 'd MMM yyyy')} · Room {room.room_number}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {nights} night{nights !== 1 ? 's' : ''} · estimated total {lodge.currency}{totalAmount.toLocaleString()}
              </p>
            </div>

            {error && (
              <div className="mt-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">First name</label>
                  <input
                    type="text"
                    name="guest_first_name"
                    value={form.guest_first_name}
                    onChange={handleChange}
                    required
                    autoComplete="given-name"
                    maxLength={100}
                    placeholder="Thabo"
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Last name</label>
                  <input
                    type="text"
                    name="guest_last_name"
                    value={form.guest_last_name}
                    onChange={handleChange}
                    required
                    autoComplete="family-name"
                    maxLength={100}
                    placeholder="Modise"
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Email address</label>
                <input
                  type="email"
                  name="guest_email"
                  value={form.guest_email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                  maxLength={160}
                  placeholder="thabo@example.com"
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Phone number</label>
                <input
                  type="tel"
                  name="guest_phone"
                  value={form.guest_phone}
                  onChange={handleChange}
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  minLength={7}
                  maxLength={32}
                  pattern="^[+0-9()\\-\\s]{7,32}$"
                  title="Enter a valid phone number using digits, spaces, +, parentheses, or hyphens."
                  placeholder="+267 71 234 567"
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Adults</label>
                  <select
                    name="adults"
                    value={form.adults}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  >
                    {Array.from({ length: maxOccupancy }, (_, index) => index + 1).map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Children</label>
                  <select
                    name="children"
                    value={form.children}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  >
                    {Array.from({ length: maxChildren + 1 }, (_, index) => index).map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Special requests</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={4}
                  maxLength={2000}
                  placeholder="Early check-in, dietary notes, arrival time, transport arrangements, or anything else the lodge should know."
                  className="w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                />
              </div>

              {lodge?.booking_house_rules && (
                <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                  <p className="font-semibold text-[var(--text)]">Guest notes</p>
                  <p className="mt-1">{lodge.booking_house_rules}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="brand-button w-full rounded-2xl px-5 py-4 text-base font-extrabold transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-65"
              >
                {submitting ? 'Sending request…' : 'Send booking request'}
              </button>
            </form>
          </section>
        </div>
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(255,253,249,0.97)] px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Estimated total</p>
            <p className="truncate text-lg font-extrabold text-[var(--text)]">
              {lodge.currency}{totalAmount.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
            className="brand-button rounded-2xl px-5 py-3 text-sm font-extrabold"
          >
            Complete request
          </button>
        </div>
      </div>
    </div>
  )
}
