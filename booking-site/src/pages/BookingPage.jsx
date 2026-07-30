import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router'
import { format } from 'date-fns'
import {
  AlertCircle,
  ArrowLeft,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MessageCircle,
  Moon,
  Phone,
  Users
} from 'lucide-react'
import { isMissingRpcError, rpc, queueConfirmationEmail } from '../lib/publicApi.js'
import { captureException } from '../lib/errorTracker.js'
import { trackBeginCheckout, trackBookingRequest } from '../lib/analytics.js'
import SeoMeta from '../components/SeoMeta.jsx'
import LodgeHeader from '../components/LodgeHeader.jsx'
import { Lightbox, optimizeImageUrl } from '../components/RoomCard.jsx'
import { computeStayTotal, isCampsiteUnit, normalizeRateMode } from '../../../src/shared/accommodation.js'
import {
  buildWhatsAppUrl,
  buildCalendarUrl,
  isValidSlug
} from '../lib/utils.js'
import {
  useSwipe,
  useKeyboardVisibility,
  useFocusTrap,
  useSessionForm,
  useSessionState,
  readSessionState,
  clearSessionState
} from '../lib/hooks.js'

const ROOM_MEDIA_TTL_MS = 30 * 60 * 1000
const BOOKING_FORM_KEY = 'booking-form-data'
const BOOKING_STATE_KEY = 'booking-state'

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

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

function validatePhone(phone) {
  const re = /^[+\d()\s-]{7,32}$/
  return re.test(phone)
}

/**
 * Build booking state to persist so the page survives a refresh.
 */
function buildBookingState({ lodge, room, rooms, bookingType, checkIn, checkOut, nights }) {
  return {
    lodge: {
      id: lodge?.id,
      slug: lodge?.slug,
      lodge_name: lodge?.lodge_name,
      currency: lodge?.currency,
      phone: lodge?.phone,
      email: lodge?.email,
      whatsapp_number: lodge?.whatsapp_number,
      website: lodge?.website,
      logo: lodge?.logo,
      hero_image: lodge?.hero_image,
      booking_payment_terms: lodge?.booking_payment_terms,
      booking_cancellation_policy: lodge?.booking_cancellation_policy,
      booking_house_rules: lodge?.booking_house_rules
    },
    room: {
      id: room?.id,
      room_number: room?.room_number,
      room_type: room?.room_type,
      total_price: room?.total_price,
      rate_per_night: room?.rate_per_night,
      accommodation_kind: room?.accommodation_kind,
      capacity_adults: room?.capacity_adults,
      capacity_children: room?.capacity_children,
      max_tents: room?.max_tents,
      max_vehicles: room?.max_vehicles,
      rate_mode: room?.rate_mode,
      rate_per_person: room?.rate_per_person,
      rate_per_tent: room?.rate_per_tent,
      rate_per_vehicle: room?.rate_per_vehicle,
      max_occupancy: room?.max_occupancy,
      photo: room?.photo,
      photos: room?.photos,
      photo_count: room?.photo_count,
      amenities: room?.amenities,
      description: room?.description
    },
    rooms: Array.isArray(rooms) ? rooms.map((entry) => ({
      id: entry?.id,
      room_number: entry?.room_number,
      room_type: entry?.room_type,
      total_price: entry?.total_price,
      rate_per_night: entry?.rate_per_night,
      accommodation_kind: entry?.accommodation_kind,
      capacity_adults: entry?.capacity_adults,
      capacity_children: entry?.capacity_children,
      max_tents: entry?.max_tents,
      max_vehicles: entry?.max_vehicles,
      rate_mode: entry?.rate_mode,
      rate_per_person: entry?.rate_per_person,
      rate_per_tent: entry?.rate_per_tent,
      rate_per_vehicle: entry?.rate_per_vehicle,
      max_occupancy: entry?.max_occupancy,
      photo: entry?.photo,
      photos: entry?.photos,
      photo_count: entry?.photo_count,
      amenities: entry?.amenities,
      description: entry?.description
    })) : undefined,
    bookingType,
    checkIn,
    checkOut,
    nights
  }
}

export default function BookingPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [searchParams] = useSearchParams()
  const formRef = useRef(null)
  const headingRef = useRef(null)

  if (!isValidSlug(slug)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-sm rounded-[30px] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">Invalid property link.</p>
        </div>
      </div>
    )
  }

  // ── Reconstruct state from multiple sources ───────────────────────────────
  const rawState = useMemo(() => {
    // 1. Prefer React Router state
    if (state?.lodge && (state?.room || Array.isArray(state?.rooms))) {
      return state
    }
    // 2. Fallback to sessionStorage
    const cached = readSessionState(BOOKING_STATE_KEY)
    if (cached?.lodge && (cached?.room || Array.isArray(cached?.rooms))) {
      return cached
    }
    // 3. Fallback to URL params (minimal)
    return null
  }, [state])

  // Persist incoming state to sessionStorage so it survives refreshes
  useSessionState(BOOKING_STATE_KEY, rawState)

  const [lodge, setLodge] = useState(rawState?.lodge || null)
  const [room, setRoom] = useState(rawState?.room || null)
  const [rooms, setRooms] = useState(Array.isArray(rawState?.rooms) ? rawState.rooms : [])
  const [bookingType, setBookingType] = useState(rawState?.bookingType || null)
  const [checkIn, setCheckIn] = useState(rawState?.checkIn || '')
  const [checkOut, setCheckOut] = useState(rawState?.checkOut || '')
  const [nights, setNights] = useState(rawState?.nights || 1)

  // If we have a room ID in URL but no state, we can't fully reconstruct.
  // Show a graceful fallback with a link back to search.
  const roomIdFromUrl = searchParams.get('roomId')
  const selectedRooms = useMemo(() => {
    if (Array.isArray(rooms) && rooms.length > 0) return rooms
    return room ? [room] : []
  }, [rooms, room])
  const effectiveBookingType = bookingType || (selectedRooms.length > 1 ? 'multi_room' : 'room')
  const isMultiRoom = selectedRooms.length > 1 || effectiveBookingType === 'multi_room'
  const isFullLodge = effectiveBookingType === 'full_lodge'
  const hasState = Boolean(lodge && selectedRooms.length > 0 && room)
  const hasUrlHint = Boolean(roomIdFromUrl)

  // Restore photos from URL hint or cached room
  const initialRoomPhotos = useMemo(() => {
    if (!room) return []
    return Array.isArray(room.photos) && room.photos.length > 0
      ? room.photos
      : (room.photo ? [room.photo] : [])
  }, [room])

  const [roomPhotos, setRoomPhotos] = useState(initialRoomPhotos)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const lightboxRef = useFocusTrap(lightboxOpen)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [lastSubmitTime, setLastSubmitTime] = useState(0)
  const SUBMIT_COOLDOWN_MS = 2000
  const keyboardOpen = useKeyboardVisibility()

  // Form fields with sessionStorage persistence
  const [form, setForm] = useSessionForm(BOOKING_FORM_KEY, {
    guest_first_name: '',
    guest_last_name: '',
    guest_email: '',
    guest_phone: '',
    adults: 1,
    children: 0,
    tents: 0,
    vehicles: 0,
    notes: ''
  })

  // Inline validation state
  const [touched, setTouched] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})

  const photoPrev = useCallback(() => setPhotoIdx((i) => (i - 1 + roomPhotos.length) % roomPhotos.length), [roomPhotos.length])
  const photoNext = useCallback(() => setPhotoIdx((i) => (i + 1) % roomPhotos.length), [roomPhotos.length])
  const photoSwipe = useSwipe({ onLeft: photoNext, onRight: photoPrev })

  // Reconstruct state when URL hints or sessionStorage are available
  useEffect(() => {
    // If we already have state, do nothing
    if (hasState) return

    if (!hasUrlHint) return

    // We can't reconstruct full lodge/room from just URL params alone
    // without fetching. But we should at least show a "back to search" fallback.
    // The component below handles the empty state.
  }, [hasState, hasUrlHint])

  useEffect(() => {
    if (hasState) {
      trackBeginCheckout(slug, room.id, room.total_price)
    }
  }, [slug, hasState, room?.id, room?.total_price])

  useEffect(() => {
    setRoomPhotos(initialRoomPhotos)
    setPhotoIdx(0)
  }, [room?.id, room?.photo, room?.photo_count, initialRoomPhotos.length])

  // Auto-clamp guest counts when max_occupancy changes
  useEffect(() => {
    if (!hasState) return
    const maxOccupancy = selectedRooms.reduce((sum, entry) => sum + Number(entry?.max_occupancy || 0), 0) || Number(room?.max_occupancy || 0)
    const adults = clampGuestCount(form.adults, Math.max(1, maxOccupancy))
    const maxChildren = Math.max(0, maxOccupancy - adults)
    const children = clampGuestCount(form.children, maxChildren)
    const campsite = selectedRooms.find((entry) => isCampsiteUnit(entry))
    const tents = campsite ? clampGuestCount(form.tents, Number(campsite.max_tents || 0)) : 0
    const vehicles = campsite ? clampGuestCount(form.vehicles, Number(campsite.max_vehicles || 0)) : 0

    if (adults !== Number(form.adults) || children !== Number(form.children) || tents !== Number(form.tents) || vehicles !== Number(form.vehicles)) {
      setForm((current) => ({
        ...current,
        adults,
        children,
        tents,
        vehicles
      }))
    }
  }, [form.adults, form.children, room?.max_occupancy, selectedRooms, hasState, setForm])

  // Fetch room media if missing
  useEffect(() => {
    if (!hasState || !room?.id) return

    const mediaCacheKey = `room-media:${slug}:${room.id}`
    const cachedMedia = readSessionState(mediaCacheKey)
    const cachedPhotos = Array.isArray(cachedMedia?.photos) ? cachedMedia.photos.filter(Boolean) : []

    if (cachedPhotos.length > 0) {
      setRoomPhotos(cachedPhotos)
      if (!room.photo_count || cachedPhotos.length >= room.photo_count) {
        return
      }
    }

    if (!room.photo_count || room.photo_count <= Math.max(initialRoomPhotos.length, cachedPhotos.length)) {
      return
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

      try {
        window.sessionStorage.setItem(mediaCacheKey, JSON.stringify({ photos }))
      } catch {
        // ignore
      }
      setRoomPhotos(photos)
    }

    fetchRoomMedia()

    return () => {
      active = false
      controller.abort()
    }
  }, [hasState, initialRoomPhotos.length, room?.id, room?.photo_count, room?.photo, slug])

  // Validate a single field
  function validateField(name, value) {
    switch (name) {
      case 'guest_email':
        return value.trim() ? (validateEmail(value) ? '' : 'Please enter a valid email address.') : 'Email is required.'
      case 'guest_phone':
        return value.trim() ? (validatePhone(value) ? '' : 'Please enter a valid phone number.') : 'Phone number is required.'
      case 'guest_first_name':
        return value.trim() ? '' : 'First name is required.'
      case 'guest_last_name':
        return value.trim() ? '' : 'Last name is required.'
      default:
        return ''
    }
  }

  // Validate entire form
  function validateForm() {
    const errors = {}
    const fields = ['guest_first_name', 'guest_last_name', 'guest_email', 'guest_phone']
    for (const name of fields) {
      const err = validateField(name, form[name])
      if (err) errors[name] = err
    }
    return errors
  }

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    if (touched[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: validateField(name, value) }))
    }
  }

  function handleBlur(event) {
    const { name, value } = event.target
    setTouched((prev) => ({ ...prev, [name]: true }))
    setFieldErrors((prev) => ({ ...prev, [name]: validateField(name, value) }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    // Validate all fields
    setTouched({
      guest_first_name: true,
      guest_last_name: true,
      guest_email: true,
      guest_phone: true
    })
    const errors = validateForm()
    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      const firstErrorField = document.querySelector('[aria-invalid="true"]')
      if (firstErrorField) {
        firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' })
        firstErrorField.focus()
      }
      return
    }

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

    const totalCapacity = selectedRooms.reduce((sum, entry) => sum + Number(entry?.max_occupancy || 0), 0) || Number(room.max_occupancy || 0)
    if (totalGuests > totalCapacity) {
      setError(`${isMultiRoom || isFullLodge ? 'This request' : 'This room'} supports up to ${totalCapacity} guests. Please reduce the number of adults or children.`)
      return
    }

    setLastSubmitTime(now)
    setSubmitting(true)

    let remainingAdults = Number(form.adults)
    let remainingChildren = Number(form.children)
    const roomLines = selectedRooms.map((entry, index) => {
      const capacity = Math.max(1, Number(entry.max_occupancy || 1))
      const adults = Math.max(index === 0 ? 1 : 0, Math.min(remainingAdults, capacity))
      remainingAdults = Math.max(0, remainingAdults - adults)
      const children = Math.max(0, Math.min(remainingChildren, Math.max(0, capacity - adults)))
      remainingChildren = Math.max(0, remainingChildren - children)
      return {
        room_id: entry.id,
        adults,
        children,
        tents: isCampsiteUnit(entry) ? Number(form.tents) || 0 : 0,
        vehicles: isCampsiteUnit(entry) ? Number(form.vehicles) || 0 : 0
      }
    }).filter((entry) => entry.room_id)

    const { data, error: rpcError } = await rpc('create_online_booking', {
      p_slug: slug,
      payload: {
        booking_type: effectiveBookingType,
        room_id: selectedRooms[0]?.id || room.id,
        rooms: roomLines,
        check_in: checkIn,
        check_out: checkOut,
        guest_first_name: form.guest_first_name.trim(),
        guest_last_name: form.guest_last_name.trim(),
        guest_email: form.guest_email.trim().toLowerCase(),
        guest_phone: form.guest_phone.trim(),
        adults: Number(form.adults),
        children: Number(form.children),
        tents: Number(form.tents),
        vehicles: Number(form.vehicles),
        notes: form.notes.trim()
      }
    })

    if (rpcError || !data?.success) {
      setSubmitting(false)
      const errMsg = data?.error || rpcError?.message
      captureException(new Error(errMsg || 'Booking RPC failed'), { slug, roomId: room.id, bookingType: effectiveBookingType })
      setError(toGuestBookingError(errMsg))
      return
    }

    if (data.confirmation_token) {
      queueConfirmationEmail({
        booking_id: data.booking_id,
        guest_email: data.guest_email,
        confirmation_token: data.confirmation_token
      })
    }

    // Clear form persistence after successful submission
    clearSessionState(BOOKING_FORM_KEY)
    clearSessionState(BOOKING_STATE_KEY)

    trackBookingRequest(slug, room.id, data.booking_id, data.total_amount)
    navigate(`/${slug}/success`, { state: { booking: data }, replace: true })
  }

  // Focus heading on mount for screen reader users
  useEffect(() => {
    if (headingRef.current) {
      headingRef.current.setAttribute('tabIndex', '-1')
      headingRef.current.focus()
    }
  }, [])

  if (!hasState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-sm rounded-[30px] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            {hasUrlHint
              ? 'Your booking session may have expired. Please return to the room list and select your dates again.'
              : 'No room selected.'}
          </p>
          <Link to={`/${slug}`} className="mt-4 inline-block text-sm font-bold text-[var(--brand)] hover:underline">
            Back to rooms
          </Link>
        </div>
      </div>
    )
  }

  const campsite = selectedRooms.find((entry) => isCampsiteUnit(entry))
  const hasContact = lodge?.phone || lodge?.email || lodge?.whatsapp_number
  const whatsappUrl = buildWhatsAppUrl(lodge?.whatsapp_number)
  const maxOccupancy = Math.max(1, selectedRooms.reduce((sum, entry) => sum + Number(entry?.max_occupancy || 0), 0) || Number(room?.max_occupancy || 1))
  const selectedAdults = clampGuestCount(form.adults, maxOccupancy)
  const maxChildren = Math.max(0, maxOccupancy - selectedAdults)
  const campsiteRateMode = normalizeRateMode(campsite?.rate_mode)
  const maxTents = Math.max(0, Number(campsite?.max_tents || 0))
  const maxVehicles = Math.max(0, Number(campsite?.max_vehicles || 0))
  const totalAmount = campsite
    ? computeStayTotal(campsite, { nights, adults: selectedAdults, children: Number(form.children), tents: Number(form.tents), vehicles: Number(form.vehicles) })
    : Number(room.total_price || 0)
  const stayLabel = isFullLodge ? 'Full lodge' : isMultiRoom ? `${selectedRooms.length} rooms` : `Room ${room.room_number}`
  const roomTitle = isFullLodge ? 'Full Lodge' : isMultiRoom ? `${selectedRooms.length} rooms` : room.room_number
  const roomTypeLabel = isFullLodge ? 'Exclusive use' : isMultiRoom ? 'Multi-room stay' : room.room_type

  return (
    <div className="min-h-screen overflow-x-hidden bg-transparent">
      <SeoMeta
        title={`Book ${roomTitle} — ${lodge.lodge_name}`}
        description={`Request a reservation for ${roomTitle} at ${lodge.lodge_name}. ${nights} night${nights !== 1 ? 's' : ''} from ${format(new Date(checkIn), 'd MMM yyyy')}.`}
        ogImage={roomPhotos[0] || lodge.hero_image}
        canonicalPath={`/${slug}/book`}
      />
      <a href="#booking-form" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-white">
        Skip to booking form
      </a>
      <LodgeHeader lodge={lodge} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:pb-8">
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
                <div className="group relative select-none" {...photoSwipe}>
                  <img
                    src={optimizeImageUrl(roomPhotos[photoIdx], 800)}
                    srcSet={`${optimizeImageUrl(roomPhotos[photoIdx], 400)} 400w, ${optimizeImageUrl(roomPhotos[photoIdx], 800)} 800w`}
                    sizes="100vw"
                    alt={`${room.room_number} — photo ${photoIdx + 1}`}
                    className="h-64 w-full max-w-full cursor-zoom-in object-cover"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    draggable={false}
                    onClick={() => setLightboxOpen(true)}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

                  {roomPhotos.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={photoPrev}
                        className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white opacity-100 transition-opacity active:bg-black/60 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Previous photo"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={photoNext}
                        className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white opacity-100 transition-opacity active:bg-black/60 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Next photo"
                      >
                        <ChevronRight size={18} />
                      </button>
                      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                        {roomPhotos.map((_, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setPhotoIdx(index)}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${index === photoIdx ? 'bg-white/90' : 'bg-black/30 hover:bg-black/50'}`}
                            aria-label={`Photo ${index + 1}`}
                          >
                            <span className={`block rounded-full ${index === photoIdx ? 'h-2 w-2 bg-[var(--brand)]' : 'h-1.5 w-1.5 bg-white/70'}`} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {lightboxOpen && (
                <div ref={lightboxRef}>
                  <Lightbox
                    photos={roomPhotos}
                    startIdx={photoIdx}
                    roomName={room.room_number}
                    onClose={() => setLightboxOpen(false)}
                  />
                </div>
              )}

              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex rounded-full border border-[var(--line-strong)] bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
                      {roomTypeLabel}
                    </span>
                    <h2 className="font-display mt-3 break-words text-[1.9rem] text-[var(--text)] sm:text-3xl">{roomTitle}</h2>
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
                    Up to {maxOccupancy} guests
                  </span>
                </div>

                {isMultiRoom && !isFullLodge && (
                  <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Selected rooms</p>
                    <div className="mt-3 space-y-2">
                      {selectedRooms.map((entry) => (
                        <div key={entry.id} className="flex justify-between gap-3 text-sm">
                          <span className="font-semibold text-[var(--text)]">{entry.room_number}</span>
                          <span className="text-right text-[var(--muted)]">{entry.room_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(room.amenities) && room.amenities.length > 0 && !isMultiRoom && !isFullLodge && (
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

          <section id="booking-form" className="booking-sticky-summary p-5 sm:p-8" ref={formRef}>
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Guest Details</p>
                <h3 ref={headingRef} className="font-display mt-2 text-[2rem] text-[var(--text)] sm:text-3xl" tabIndex={-1}>
                  Complete your request
                </h3>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-[var(--line)] bg-[var(--surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">
                {format(new Date(checkIn), 'd MMM')} to {format(new Date(checkOut), 'd MMM yyyy')} · {stayLabel}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {nights} night{nights !== 1 ? 's' : ''} · estimated total {lodge.currency}{totalAmount.toLocaleString()}
              </p>
            </div>

            <div aria-live="polite" aria-atomic="true">
              {error && (
                <div className="mt-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="guest_first_name">
                    First name
                  </label>
                  <input
                    id="guest_first_name"
                    type="text"
                    name="guest_first_name"
                    value={form.guest_first_name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                    autoComplete="given-name"
                    maxLength={100}
                    placeholder="Thabo"
                    aria-invalid={!!fieldErrors.guest_first_name}
                    aria-describedby={fieldErrors.guest_first_name ? 'fn-error' : undefined}
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  />
                  {fieldErrors.guest_first_name && (
                    <p id="fn-error" className="mt-1 text-xs text-red-600">{fieldErrors.guest_first_name}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="guest_last_name">
                    Last name
                  </label>
                  <input
                    id="guest_last_name"
                    type="text"
                    name="guest_last_name"
                    value={form.guest_last_name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                    autoComplete="family-name"
                    maxLength={100}
                    placeholder="Modise"
                    aria-invalid={!!fieldErrors.guest_last_name}
                    aria-describedby={fieldErrors.guest_last_name ? 'ln-error' : undefined}
                    className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                  />
                  {fieldErrors.guest_last_name && (
                    <p id="ln-error" className="mt-1 text-xs text-red-600">{fieldErrors.guest_last_name}</p>
                  )}
                </div>
              </div>

              {campsite && (campsiteRateMode === 'tent' || campsiteRateMode === 'composite') && (
                <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="tents">Tents</label>
                  <input id="tents" name="tents" type="number" min={0} max={maxTents} value={form.tents} onChange={handleChange} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Maximum {maxTents} tent{maxTents === 1 ? '' : 's'}.</p>
                </div>
              )}
              {campsite && (campsiteRateMode === 'vehicle' || campsiteRateMode === 'composite') && (
                <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="vehicles">Vehicles</label>
                  <input id="vehicles" name="vehicles" type="number" min={0} max={maxVehicles} value={form.vehicles} onChange={handleChange} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Maximum {maxVehicles} vehicle{maxVehicles === 1 ? '' : 's'}.</p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="guest_email">
                  Email address
                </label>
                <input
                  id="guest_email"
                  type="email"
                  name="guest_email"
                  value={form.guest_email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  autoComplete="email"
                  maxLength={160}
                  placeholder="thabo@example.com"
                  aria-invalid={!!fieldErrors.guest_email}
                  aria-describedby={fieldErrors.guest_email ? 'email-error' : undefined}
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                />
                {fieldErrors.guest_email && (
                  <p id="email-error" className="mt-1 text-xs text-red-600">{fieldErrors.guest_email}</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="guest_phone">
                  Phone number
                </label>
                <input
                  id="guest_phone"
                  type="tel"
                  name="guest_phone"
                  value={form.guest_phone}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  minLength={7}
                  maxLength={32}
                  pattern="[+0-9()\\s-]{7,32}"
                  title="Enter a valid phone number using digits, spaces, +, parentheses, or hyphens."
                  placeholder="+267 71 234 567"
                  aria-invalid={!!fieldErrors.guest_phone}
                  aria-describedby={fieldErrors.guest_phone ? 'phone-error' : undefined}
                  className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
                />
                {fieldErrors.guest_phone && (
                  <p id="phone-error" className="mt-1 text-xs text-red-600">{fieldErrors.guest_phone}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="adults">
                    Adults
                  </label>
                  <div className="flex items-center rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)]">
                    <button
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, adults: Math.max(1, Number(c.adults) - 1) }))}
                      disabled={Number(form.adults) <= 1}
                      className="flex h-11 w-11 items-center justify-center rounded-l-2xl text-lg font-bold text-[var(--text)] transition hover:bg-[var(--surface-strong)] disabled:opacity-40"
                      aria-label="Decrease adults"
                    >
                      −
                    </button>
                    <input
                      id="adults"
                      name="adults"
                      type="number"
                      min={1}
                      max={maxOccupancy}
                      value={form.adults}
                      onChange={handleChange}
                      className="h-11 w-full bg-transparent text-center text-sm font-semibold text-[var(--text)] outline-none"
                      readOnly
                    />
                    <button
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, adults: Math.min(maxOccupancy, Number(c.adults) + 1) }))}
                      disabled={Number(form.adults) >= maxOccupancy}
                      className="flex h-11 w-11 items-center justify-center rounded-r-2xl text-lg font-bold text-[var(--text)] transition hover:bg-[var(--surface-strong)] disabled:opacity-40"
                      aria-label="Increase adults"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="children">
                    Children
                  </label>
                  <div className="flex items-center rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)]">
                    <button
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, children: Math.max(0, Number(c.children) - 1) }))}
                      disabled={Number(form.children) <= 0}
                      className="flex h-11 w-11 items-center justify-center rounded-l-2xl text-lg font-bold text-[var(--text)] transition hover:bg-[var(--surface-strong)] disabled:opacity-40"
                      aria-label="Decrease children"
                    >
                      −
                    </button>
                    <input
                      id="children"
                      name="children"
                      type="number"
                      min={0}
                      max={maxChildren}
                      value={form.children}
                      onChange={handleChange}
                      className="h-11 w-full bg-transparent text-center text-sm font-semibold text-[var(--text)] outline-none"
                      readOnly
                    />
                    <button
                      type="button"
                      onClick={() => setForm((c) => ({ ...c, children: Math.min(maxChildren, Number(c.children) + 1) }))}
                      disabled={Number(form.children) >= maxChildren}
                      className="flex h-11 w-11 items-center justify-center rounded-r-2xl text-lg font-bold text-[var(--text)] transition hover:bg-[var(--surface-strong)] disabled:opacity-40"
                      aria-label="Increase children"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[var(--text)]" htmlFor="notes">
                  Special requests
                </label>
                <textarea
                  id="notes"
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
                className="brand-button w-full rounded-2xl px-5 py-4 text-base font-extrabold transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-65"
              >
                <span className="inline-flex items-center gap-2">
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Sending request…
                    </>
                  ) : (
                    'Send booking request'
                  )}
                </span>
              </button>
            </form>
          </section>
        </div>
      </main>

      <div className={`safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(255,253,249,0.97)] px-4 py-2.5 backdrop-blur transition-transform duration-300 lg:hidden ${keyboardOpen ? 'translate-y-full' : 'translate-y-0'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Estimated total</p>
            <p className="truncate text-base font-extrabold text-[var(--text)]">
              {lodge.currency}{totalAmount.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById('booking-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="brand-button rounded-xl px-4 py-2.5 text-sm font-extrabold active:scale-[0.98] transition-transform"
          >
            Complete request
          </button>
        </div>
      </div>
    </div>
  )
}
