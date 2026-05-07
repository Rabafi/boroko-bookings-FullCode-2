import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import {
  Calendar,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import { isMissingRpcError, readSessionCache, rpc, writeSessionCache } from '../lib/publicApi.js'
import LodgeHeader from '../components/LodgeHeader.jsx'
import RoomCard from '../components/RoomCard.jsx'

const LODGE_SHELL_TTL_MS = 10 * 60 * 1000
const LODGE_MEDIA_TTL_MS = 30 * 60 * 1000
const ROOM_RESULTS_TTL_MS = 2 * 60 * 1000

function buildWhatsAppUrl(number) {
  const digits = String(number || '').replace(/[^\d]/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

function sanitizeWebsiteUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export default function LodgePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const resultsRef = useRef(null)

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
      return
    }

    const roomList = Array.isArray(data.rooms) ? data.rooms : []
    writeSessionCache(roomCacheKey, roomList)
    setRooms(roomList)
    setLoadingRooms(false)
  }

  function handleBook(room) {
    navigate(`/${slug}/book`, {
      state: {
        lodge,
        room,
        checkIn,
        checkOut,
        nights: rooms ? Number(room.nights) : 1
      }
    })
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
    <div className="min-h-screen bg-transparent">
      <LodgeHeader lodge={lodge} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-10 sm:pb-10">
        <section className="surface-card overflow-hidden rounded-[32px]">
            {lodge?.hero_image ? (
              <div className="relative h-[210px] sm:h-[280px]">
                <img
                  src={lodge.hero_image}
                  alt={lodge.lodge_name}
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,7,3,0.10)_0%,rgba(12,7,3,0.72)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-9">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-white">
                      <Sparkles size={12} />
                      {lodge?.booking_tagline || 'Reserve your stay'}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold text-white/85">
                      <ShieldCheck size={13} />
                      Reservations available online
                    </span>
                  </div>

                  <h2 className="font-display mt-4 max-w-2xl text-[2rem] leading-tight text-white sm:mt-5 sm:text-5xl">
                    Stay at {lodge?.lodge_name}
                  </h2>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/82 sm:mt-4 sm:text-base sm:leading-8">
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

                <h2 className="font-display mt-5 max-w-2xl text-[2rem] leading-tight text-[var(--text)] sm:mt-6 sm:text-5xl">
                  Stay at {lodge?.lodge_name}.
                </h2>

                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted)] sm:mt-5 sm:text-base sm:leading-8">
                  {lodge?.booking_description || 'Choose your dates and see available rooms.'}
                </p>
              </div>
            )}

            <div className="border-t border-[var(--line)] px-5 py-5 sm:px-9">
              <div className="flex flex-wrap gap-3 text-sm text-[var(--muted)]">
                {location && (
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2">
                    <MapPin size={14} />
                    {location}
                  </span>
                )}
                {lodge?.phone && (
                  <a href={`tel:${lodge.phone}`} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)]">
                    <Phone size={14} />
                    {lodge.phone}
                  </a>
                )}
                {whatsappUrl && (
                  <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 font-semibold text-emerald-800 transition-colors hover:bg-emerald-100">
                    <MessageCircle size={14} />
                    WhatsApp
                  </a>
                )}
                {lodge?.email && (
                  <a href={`mailto:${lodge.email}`} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)]">
                    <Mail size={14} />
                    Email lodge
                  </a>
                )}
                {websiteUrl && (
                  <a href={websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-strong)]">
                    <Globe size={14} />
                    Visit website
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
                className="brand-button w-full rounded-2xl px-6 py-3 text-sm font-extrabold transition-transform hover:-translate-y-0.5 lg:min-w-[180px] lg:w-auto"
              >
                <span className="inline-flex items-center gap-2">
                  <Search size={15} />
                  {loadingRooms ? 'Checking…' : 'Search rooms'}
                </span>
              </button>
            </div>
          </form>
        </section>

        <div ref={resultsRef}>
          {roomError && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {roomError}
            </div>
          )}

          {loadingRooms && (
            <div className="mt-8 text-center">
              <div className="inline-flex rounded-full border border-[var(--line)] bg-white px-5 py-3 text-sm font-semibold text-[var(--muted)] shadow-sm">
                Checking availability…
              </div>
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
            <section className="mt-8">
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

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {rooms.map((room) => (
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
      </main>

      {hasContact && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-[rgba(255,253,249,0.96)] px-4 py-3 backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-6xl gap-3 sm:flex sm:items-center">
            {whatsappUrl && (
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-emerald-600 px-4 py-3 text-center text-sm font-extrabold text-white sm:flex-1">
                WhatsApp
              </a>
            )}
            {lodge?.phone && (
              <a href={`tel:${lodge.phone}`} className="brand-button rounded-2xl px-4 py-3 text-center text-sm font-extrabold sm:flex-1">
                Call lodge
              </a>
            )}
            {lodge?.email && (
              <a href={`mailto:${lodge.email}`} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-center text-sm font-extrabold text-[var(--text)] sm:flex-1">
                Email
              </a>
            )}
          </div>
        </div>
      )}

      <footer className={`px-4 py-10 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)] ${hasContact ? 'pb-28 md:pb-10' : ''}`}>
        Online reservations
      </footer>
    </div>
  )
}
