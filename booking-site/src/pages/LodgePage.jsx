import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import {
  ArrowDown,
  Calendar,
  Globe,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react'
import { isMissingRpcError, readSessionCache, rpc, writeSessionCache } from '../lib/publicApi.js'
import { trackSearch, trackSelectRoom } from '../lib/analytics.js'
import { captureException } from '../lib/errorTracker.js'
import { buildWhatsAppUrl, sanitizeWebsiteUrl, isValidSlug } from '../lib/utils.js'
import { useFocusOnMount } from '../lib/hooks.js'
import SeoMeta, { setLodgeSchema } from '../components/SeoMeta.jsx'
import LodgeHeader from '../components/LodgeHeader.jsx'
import RoomCard from '../components/RoomCard.jsx'
import FaqSection from '../components/FaqSection.jsx'

function SkeletonCard() {
  return (
    <article className="surface-card flex h-full flex-col overflow-hidden rounded-[28px]">
      <div className="skeleton h-56 w-full" />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-8 w-32" />
          </div>
          <div className="skeleton h-10 w-20" />
        </div>
        <div className="mt-4 flex gap-2">
          <div className="skeleton h-6 w-28" />
          <div className="skeleton h-6 w-20" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--line)] pt-5">
          <div className="skeleton h-8 w-28" />
          <div className="skeleton h-10 w-32" />
        </div>
      </div>
    </article>
  )
}

const LODGE_SHELL_TTL_MS = 10 * 60 * 1000
const LODGE_MEDIA_TTL_MS = 30 * 60 * 1000
const ROOM_RESULTS_TTL_MS = 2 * 60 * 1000

export default function LodgePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const resultsRef = useRef(null)
  const headingRef = useRef(null)

  useFocusOnMount(headingRef, [slug])

  if (!isValidSlug(slug)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-md rounded-[32px] p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-soft)] text-3xl">🏕️</div>
          <h1 className="font-display text-3xl text-[var(--text)]">Property not found</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">The link you followed is invalid.</p>
        </div>
      </div>
    )
  }

  const [lodge, setLodge] = useState(null)
  const [lodgeError, setLodgeError] = useState(null)
  const [loadingLodge, setLoadingLodge] = useState(true)

  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

  const [checkIn, setCheckIn] = useState(today)
  const [checkOut, setCheckOut] = useState(tomorrow)
  const [rooms, setRooms] = useState(null)
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [roomError, setRoomError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [sortBy, setSortBy] = useState('recommended')
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const shellCacheKey = `lodge-shell:${slug}`
    const mediaCacheKey = `lodge-media:${slug}`
    const cachedShell = readSessionCache(shellCacheKey, LODGE_SHELL_TTL_MS)
    const cachedMedia = readSessionCache(mediaCacheKey, LODGE_MEDIA_TTL_MS)
    const hasCachedShell = Boolean(cachedShell?.found)
    let active = true
    let mediaRequested = false
    let timeoutId = null
    let idleId = null

    async function fetchMedia() {
      const { data, error } = await rpc(
        'get_lodge_public_media',
        { p_slug: slug },
        { signal: controller.signal }
      )

      if (!active || error || !data?.found) return

      writeSessionCache(mediaCacheKey, data)
      setLodge((current) => (current ? { ...current, ...data } : current))
    }

    function scheduleMediaFetch(source = null) {
      if (
        cachedMedia?.hero_image ||
        cachedMedia?.logo ||
        cachedShell?.hero_image ||
        cachedShell?.logo ||
        source?.hero_image ||
        source?.logo ||
        mediaRequested
      ) return
      mediaRequested = true

      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(() => {
          fetchMedia()
        }, { timeout: 1500 })
        return
      }

      timeoutId = window.setTimeout(() => {
        fetchMedia()
      }, 120)
    }

    if (hasCachedShell) {
      setLodge({ ...cachedShell, ...(cachedMedia || {}) })
      setLodgeError(null)
      setLoadingLodge(false)
      document.title = `Reservations — ${cachedShell.lodge_name}`
      scheduleMediaFetch(cachedShell)
    } else {
      setLoadingLodge(true)
      setLodge(null)
    }

    async function fetchLodgeShell() {
      let { data, error } = await rpc(
        'get_lodge_public_profile_shell',
        { p_slug: slug },
        { signal: controller.signal }
      )

      if ((error || !data?.found) && isMissingRpcError(error)) {
        const legacyResult = await rpc(
          'get_lodge_public_profile',
          { p_slug: slug },
          { signal: controller.signal }
        )
        data = legacyResult.data
        error = legacyResult.error
      }

      if (!active) return

      if (error || !data?.found) {
        if (!hasCachedShell) {
          setLoadingLodge(false)
          setLodgeError(data?.error || error?.message || 'This lodge could not be found.')
        }
        captureException(error || new Error('Lodge shell not found'), { slug })
        return
      }

      writeSessionCache(shellCacheKey, data)
      if (data?.hero_image || data?.logo) {
        writeSessionCache(mediaCacheKey, {
          hero_image: data.hero_image || '',
          logo: data.logo || ''
        })
      }
      setLodge((current) => ({ ...(current || {}), ...data, ...(cachedMedia || {}) }))
      setLodgeError(null)
      setLoadingLodge(false)
      document.title = `Reservations — ${data.lodge_name}`
      setLodgeSchema(data)
      scheduleMediaFetch(data)
    }

    fetchLodgeShell()

    return () => {
      active = false
      controller.abort()
      if (timeoutId) window.clearTimeout(timeoutId)
      if (idleId && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [slug])

  async function handleSearch(event) {
    event.preventDefault()

    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setRoomError('Please select valid check-in and check-out dates.')
      return
    }

    setRoomError(null)
    setSearched(true)
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    const roomCacheKey = `rooms:${slug}:${checkIn}:${checkOut}`
    const cachedRooms = readSessionCache(roomCacheKey, ROOM_RESULTS_TTL_MS)
    const hasCachedRooms = Array.isArray(cachedRooms)

    if (hasCachedRooms) {
      setRooms(cachedRooms)
      setLoadingRooms(false)
    } else {
      setRooms(null)
      setLoadingRooms(true)
    }

    let { data, error } = await rpc('get_available_rooms_summary', {
      p_slug: slug,
      p_check_in: checkIn,
      p_check_out: checkOut
    })

    if ((error || !data?.success) && isMissingRpcError(error)) {
      const legacyResult = await rpc('get_available_rooms', {
        p_slug: slug,
        p_check_in: checkIn,
        p_check_out: checkOut
      })
      data = legacyResult.data
      error = legacyResult.error
    }

    if (error || !data?.success) {
      setLoadingRooms(false)
      if (!hasCachedRooms) {
        setRoomError(data?.error || error?.message || 'Could not load available rooms. Please try again.')
      }
      captureException(error || new Error('Room search failed'), { slug, checkIn, checkOut })
      return
    }

    const roomList = Array.isArray(data.rooms) ? data.rooms : []
    writeSessionCache(roomCacheKey, roomList)
    setRooms(roomList)
    setLoadingRooms(false)
    trackSearch(slug, checkIn, checkOut, roomList.length)
  }

  function handleBook(room) {
    trackSelectRoom(slug, room.id, room.room_type, Number(room.nights || 1), Number(room.total_price || 0))
    const nights = rooms ? Number(room.nights) : 1
    const bookingState = {
      lodge,
      room,
      checkIn,
      checkOut,
      nights
    }
    navigate(
      `/${slug}/book?roomId=${encodeURIComponent(room.id)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`,
      {
        state: bookingState
      }
    )
  }

  const nights = checkIn && checkOut
    ? Math.max(0, Math.floor((new Date(checkOut) - new Date(checkIn)) / 86400000))
    : 0

  if (loadingLodge) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--muted)] shadow-sm">
          Loading property…
        </div>
      </div>
    )
  }

  if (lodgeError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
        <div className="surface-card max-w-md rounded-[32px] p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-soft)] text-3xl">🏕️</div>
          <h1 className="font-display text-3xl text-[var(--text)]">Property not found</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{lodgeError}</p>
        </div>
      </div>
    )
  }

  const location = [lodge?.city, lodge?.country].filter(Boolean).join(', ')
  const websiteUrl = sanitizeWebsiteUrl(lodge?.website)
  const hasContact = lodge?.phone || lodge?.email || websiteUrl || lodge?.whatsapp_number
  const whatsappUrl = buildWhatsAppUrl(lodge?.whatsapp_number)

  return (
    <div className="min-h-screen overflow-x-hidden bg-transparent">
      {!online && (
        <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">
          You appear to be offline. Some features may not work until your connection is restored.
        </div>
      )}
      <SeoMeta
        title={lodge?.lodge_name}
        description={lodge?.booking_description || `Book your stay at ${lodge?.lodge_name}. Browse available rooms and send a reservation request.`}
        ogImage={lodge?.hero_image || lodge?.logo}
        canonicalPath={`/${slug}`}
      />
      <a href="#search-results" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-white">
        Skip to search results
      </a>
      <LodgeHeader lodge={lodge} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:py-10 sm:pb-10">
        <section className="surface-card overflow-hidden rounded-[32px]">
            {lodge?.hero_image ? (
              <div className="relative overflow-hidden h-[240px] sm:h-[300px] md:h-[360px]">
                <img
                  src={lodge.hero_image}
                  alt={lodge.lodge_name}
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,7,3,0.15)_0%,rgba(12,7,3,0.55)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-white backdrop-blur-sm">
                      <Sparkles size={12} />
                      {lodge?.booking_tagline || 'Reserve your stay'}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur-sm">
                      <ShieldCheck size={13} />
                      Reservations available online
                    </span>
                  </div>

                  <h2 ref={headingRef} className="font-display mt-4 max-w-2xl break-words text-[1.75rem] leading-tight text-white sm:mt-5 sm:text-[2.5rem] md:text-5xl" tabIndex={-1}>
                    Stay at {lodge?.lodge_name}
                  </h2>

                  <p className="mt-3 max-w-2xl break-words text-sm leading-6 text-white/90 sm:mt-4 sm:text-base sm:leading-8">
                    {lodge?.booking_description || 'Choose your dates and see available rooms.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-9">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--brand-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                    <Sparkles size={12} />
                    {lodge?.booking_tagline || 'Direct stay requests'}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                    <ShieldCheck size={13} />
                    Send your stay request online
                  </span>
                </div>

                <h2 className="font-display mt-5 max-w-2xl break-words text-[1.75rem] leading-tight text-[var(--text)] sm:mt-6 sm:text-[2.5rem] md:text-5xl">
                  Stay at {lodge?.lodge_name}.
                </h2>

                <p className="mt-4 max-w-2xl break-words text-sm leading-7 text-[var(--muted)] sm:mt-5 sm:text-base sm:leading-8">
                  {lodge?.booking_description || 'Choose your dates and see available rooms.'}
                </p>
              </div>
            )}

            <div className="border-t border-[var(--line)] px-5 py-4 sm:px-9 sm:py-5">
              <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)] sm:gap-3 sm:text-sm">
                {location && (
                  <span className="inline-flex items-center gap-1.5 break-words rounded-full bg-white px-3 py-1.5 sm:px-4 sm:py-2">
                    <MapPin size={13} />
                    {location}
                  </span>
                )}
                {lodge?.phone && (
                  <a href={`tel:${lodge.phone}`} className="inline-flex items-center gap-1.5 break-words rounded-full bg-white px-3 py-1.5 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)] sm:px-4 sm:py-2">
                    <Phone size={13} />
                    {lodge.phone}
                  </a>
                )}
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-words rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 sm:px-4 sm:py-2">
                    <MessageCircle size={13} />
                    WhatsApp
                  </a>
                )}
                {lodge?.email && (
                  <a href={`mailto:${lodge.email}`} className="inline-flex items-center gap-1.5 break-words rounded-full bg-white px-3 py-1.5 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)] sm:px-4 sm:py-2">
                    <Mail size={13} />
                    Email
                  </a>
                )}
                {websiteUrl && (
                  <a href={websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-words rounded-full bg-white px-3 py-1.5 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)] sm:px-4 sm:py-2">
                    <Globe size={13} />
                    Website
                  </a>
                )}
              </div>
            </div>
        </section>

        <section className="surface-card mt-8 rounded-[32px] p-5 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Search Availability</p>
              <h3 className="font-display mt-2 text-3xl text-[var(--text)]">Pick your stay dates</h3>
            </div>
            {nights > 0 && (
              <div className="rounded-2xl bg-[var(--surface-strong)] px-4 py-3 text-right">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Stay length</div>
                <div className="mt-1 text-lg font-extrabold text-[var(--text)]">{nights} night{nights !== 1 ? 's' : ''}</div>
              </div>
            )}
          </div>

          <form onSubmit={handleSearch} className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Check-in</label>
              <input
                type="date"
                value={checkIn}
                min={today}
                onChange={(event) => {
                  setCheckIn(event.target.value)
                  if (event.target.value >= checkOut) {
                    setCheckOut(format(addDays(new Date(event.target.value), 1), 'yyyy-MM-dd'))
                  }
                  setSearched(false)
                  setRooms(null)
                }}
                required
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Check-out</label>
              <input
                type="date"
                value={checkOut}
                min={checkIn ? format(addDays(new Date(checkIn), 1), 'yyyy-MM-dd') : tomorrow}
                onChange={(event) => {
                  setCheckOut(event.target.value)
                  setSearched(false)
                  setRooms(null)
                }}
                required
                className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--line-strong)] focus:shadow-[0_0_0_4px_rgba(154,91,31,0.10)]"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={loadingRooms}
                className="brand-button w-full rounded-2xl px-6 py-3 text-sm font-extrabold transition-transform hover:-translate-y-0.5 active:scale-[0.98] lg:min-w-[180px] lg:w-auto"
              >
                <span className="inline-flex items-center gap-2">
                  {loadingRooms ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <Search size={15} />
                      Search rooms
                    </>
                  )}
                </span>
              </button>
            </div>
          </form>
        </section>

        <div ref={resultsRef} id="search-results" aria-live="polite" aria-atomic="false">
          {roomError && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {roomError}
            </div>
          )}

          {loadingRooms && (
            <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {!loadingRooms && searched && rooms && rooms.length === 0 && (
            <div className="surface-card mt-8 rounded-[32px] p-6 text-center sm:p-8">
              <h3 className="font-display text-3xl text-[var(--text)]">No rooms for those dates</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                Try different dates, or contact the lodge directly to ask about alternatives.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {lodge?.phone && (
                  <a href={`tel:${lodge.phone}`} className="brand-button inline-flex rounded-2xl px-5 py-3 text-sm font-extrabold">
                    Call the lodge
                  </a>
                )}
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noreferrer" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-extrabold text-emerald-800">
                    WhatsApp the lodge
                  </a>
                )}
              </div>
            </div>
          )}

          {!loadingRooms && rooms && rooms.length > 0 && (
            <section className="mt-8" aria-label="Available rooms">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Available Rooms</p>
                <h3 className="font-display mt-2 text-3xl text-[var(--text)]">
                  {rooms.length} room{rooms.length !== 1 ? 's' : ''} ready for your dates
                </h3>
              </div>
              <p className="text-sm text-[var(--muted)]">
                Rates shown below are estimated for {nights} night{nights !== 1 ? 's' : ''}.
              </p>
            </div>

            {rooms.length > 1 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {[
                  { key: 'recommended', label: 'Recommended', icon: Sparkles },
                  { key: 'price', label: 'Lowest price', icon: ArrowDown },
                  { key: 'guests', label: 'Most guests', icon: Users },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSortBy(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${sortBy === key ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] bg-white text-[var(--muted)] hover:bg-[var(--surface-soft)]'}`}
                    aria-pressed={sortBy === key}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {[...rooms]
                .sort((a, b) => {
                  if (sortBy === 'price') return Number(a.rate_per_night || 0) - Number(b.rate_per_night || 0)
                  if (sortBy === 'guests') return Number(b.max_occupancy || 0) - Number(a.max_occupancy || 0)
                  return 0
                })
                .map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  currency={lodge.currency}
                  nights={nights}
                  onBook={handleBook}
                />
              ))}
            </div>
            </section>
          )}
        </div>

        {!searched && (
          <div className="surface-card mt-8 rounded-[32px] p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--brand)]">
              <Calendar size={26} />
            </div>
            <h3 className="font-display text-3xl text-[var(--text)]">Start with your dates</h3>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Choose check-in and check-out to view rooms available for your stay.
            </p>
          </div>
        )}

        {(lodge?.booking_check_in_from || lodge?.booking_check_out_until || lodge?.booking_cancellation_policy || lodge?.booking_payment_terms || lodge?.booking_house_rules) && (
          <section className="surface-card mt-8 rounded-[32px] p-5 sm:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">Policies & Information</p>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {(lodge?.booking_check_in_from || lodge?.booking_check_out_until) && (
                <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Check-in & Check-out</p>
                  <div className="mt-2 space-y-1 text-sm text-[var(--text)]">
                    {lodge?.booking_check_in_from && (
                      <p><span className="font-semibold">Check-in:</span> {lodge.booking_check_in_from}</p>
                    )}
                    {lodge?.booking_check_out_until && (
                      <p><span className="font-semibold">Check-out:</span> {lodge.booking_check_out_until}</p>
                    )}
                  </div>
                </div>
              )}
              {lodge?.booking_cancellation_policy && (
                <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Cancellation Policy</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--text)]">{lodge.booking_cancellation_policy}</p>
                </div>
              )}
              {lodge?.booking_payment_terms && (
                <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Payment Terms</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--text)]">{lodge.booking_payment_terms}</p>
                </div>
              )}
              {lodge?.booking_house_rules && (
                <div className="rounded-2xl bg-[var(--surface-soft)] p-4 sm:col-span-2 lg:col-span-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">House Rules / Guest Notes</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--text)]">{lodge.booking_house_rules}</p>
                </div>
              )}
            </div>
          </section>
        )}

        <FaqSection lodge={lodge} />
      </main>

      {hasContact && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(255,253,249,0.96)] px-4 py-2.5 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            {whatsappUrl && (
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 py-2.5 text-xs font-extrabold text-white active:scale-[0.98] transition-transform">
                <MessageCircle size={16} />
                <span className="truncate">WhatsApp</span>
              </a>
            )}
            {lodge?.phone && (
              <a href={`tel:${lodge.phone}`} className="brand-button flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-extrabold active:scale-[0.98] transition-transform">
                <Phone size={16} />
                <span className="truncate">Call</span>
              </a>
            )}
            {lodge?.email && (
              <a href={`mailto:${lodge.email}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-2 py-2.5 text-xs font-extrabold text-[var(--text)] active:scale-[0.98] transition-transform">
                <Mail size={16} />
                <span className="truncate">Email</span>
              </a>
            )}
          </div>
        </div>
      )}

      <footer className={`px-4 py-10 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)] ${hasContact ? 'pb-24 md:pb-10' : ''}`}>
        Online reservations
      </footer>
    </div>
  )
}
