import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Users, Moon, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useSwipe, useFocusTrap } from '../lib/hooks.js'

function buildRoomHighlights(room) {
  const amenityTags = Array.isArray(room?.amenities)
    ? room.amenities.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (amenityTags.length > 0) return amenityTags.slice(0, 5)

  const text = String(room?.description || '').toLowerCase()
  const tags = []
  if (text.includes('balcony')) tags.push('Balcony')
  if (text.includes('garden')) tags.push('Garden view')
  if (text.includes('wifi') || text.includes('wi-fi')) tags.push('Wi-Fi')
  if (text.includes('breakfast')) tags.push('Breakfast')
  if (text.includes('bath')) tags.push('Bath')
  if (text.includes('shower')) tags.push('Hot shower')
  if (text.includes('family')) tags.push('Family friendly')
  if (text.includes('workspace') || text.includes('desk')) tags.push('Work desk')
  if (room?.max_occupancy >= 4) tags.push('Good for groups')
  if (tags.length === 0) {
    tags.push(room?.max_occupancy >= 3 ? 'Spacious stay' : 'Comfort stay')
  }
  return tags.slice(0, 4)
}

/**
 * If the image is served from Supabase Storage, append resize/format parameters.
 * Otherwise return the original URL unchanged.
 */
export function optimizeImageUrl(url, width) {
  if (!url || typeof url !== 'string') return url
  try {
    const parsed = new URL(url)
    // Supabase Storage transformer endpoint
    if (parsed.pathname.includes('/storage/v1/object/')) {
      parsed.searchParams.set('width', String(width))
      parsed.searchParams.set('format', 'webp')
      return parsed.toString()
    }
  } catch {
    // ignore malformed URLs
  }
  return url
}

export function Lightbox({ photos, startIdx, roomName, onClose }) {
  const [idx, setIdx] = useState(startIdx)
  const lightboxRef = useFocusTrap(true)

  const prev = useCallback(() => setIdx((i) => (i - 1 + photos.length) % photos.length), [photos.length])
  const next = useCallback(() => setIdx((i) => (i + 1) % photos.length), [photos.length])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') prev()
      if (event.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, prev, next])

  const lightboxSwipe = useSwipe({ onLeft: next, onRight: prev })

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div
        ref={lightboxRef}
        className="relative flex h-full w-full items-center justify-center px-6 py-12 sm:px-12 select-none"
        onClick={(event) => event.stopPropagation()}
        {...lightboxSwipe}
      >
        <img
          src={optimizeImageUrl(photos[idx], 1200)}
          srcSet={`${optimizeImageUrl(photos[idx], 800)} 800w, ${optimizeImageUrl(photos[idx], 1200)} 1200w`}
          sizes="100vw"
          alt={`${roomName} — photo ${idx + 1}`}
          className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-2xl"
          draggable={false}
          loading="eager"
          decoding="async"
        />

        {photos.length > 1 && (
          <>
            <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3.5 text-white transition-colors hover:bg-white/25 active:bg-white/30" aria-label="Previous photo" type="button">
              <ChevronLeft size={24} />
            </button>
            <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3.5 text-white transition-colors hover:bg-white/25 active:bg-white/30" aria-label="Next photo" type="button">
              <ChevronRight size={24} />
            </button>
          </>
        )}

        <button onClick={onClose} className="absolute right-2 top-2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/25 active:bg-white/30" aria-label="Close" type="button">
          <X size={24} />
        </button>

        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
          {photos.length > 1 && (
            <div className="flex gap-2">
              {photos.map((_, photoIndex) => (
                <button
                  key={photoIndex}
                  onClick={() => setIdx(photoIndex)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${photoIndex === idx ? 'bg-white/90' : 'bg-white/20 hover:bg-white/40'}`}
                  aria-label={`Photo ${photoIndex + 1}`}
                  type="button"
                >
                  <span className={`block rounded-full ${photoIndex === idx ? 'h-2 w-2 bg-[var(--brand)]' : 'h-1.5 w-1.5 bg-white/80'}`} />
                </button>
              ))}
            </div>
          )}
          <span className="text-xs text-white/80">
            {roomName} · {idx + 1} / {photos.length}
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PhotoCarousel({ photos, roomName }) {
  const [idx, setIdx] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const goPrev = useCallback(() => setIdx((current) => (current - 1 + photos.length) % photos.length), [photos.length])
  const goNext = useCallback(() => setIdx((current) => (current + 1) % photos.length), [photos.length])

  const swipe = useSwipe({ onLeft: goNext, onRight: goPrev })

  if (!photos || photos.length === 0) {
    return (
      <div className="flex h-56 w-full items-center justify-center bg-[var(--surface-strong)] text-sm text-[var(--muted)]">
        No photo available
      </div>
    )
  }

  return (
    <>
      <div
        className="group relative h-56 w-full max-w-full overflow-hidden bg-[var(--surface-strong)] select-none"
        {...swipe}
      >
        <img
          src={optimizeImageUrl(photos[idx], 800)}
          srcSet={`${optimizeImageUrl(photos[idx], 400)} 400w, ${optimizeImageUrl(photos[idx], 800)} 800w`}
          sizes="(max-width: 640px) 100vw, 50vw"
          alt={`${roomName} — photo ${idx + 1}`}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          onClick={() => setLightboxOpen(true)}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

        {photos.length > 1 && (
          <div className="absolute right-2 top-2 z-10 rounded-full bg-black/50 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
            {photos.length} photos
          </div>
        )}

        {photos.length > 1 && (
          <>
            {/* Mobile: always visible arrows. Desktop: hidden until hover. */}
            <button
              onClick={(event) => {
                event.stopPropagation()
                goPrev()
              }}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white opacity-100 transition-opacity active:bg-black/60 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Previous photo"
              type="button"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                goNext()
              }}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2.5 text-white opacity-100 transition-opacity active:bg-black/60 sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Next photo"
              type="button"
            >
              <ChevronRight size={18} />
            </button>

            {/* Dots with large touch targets */}
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
              {photos.map((_, photoIndex) => (
                <button
                  key={photoIndex}
                  onClick={(event) => {
                    event.stopPropagation()
                    setIdx(photoIndex)
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${photoIndex === idx ? 'bg-white/90' : 'bg-black/30 hover:bg-black/50'}`}
                  aria-label={`Photo ${photoIndex + 1}`}
                  type="button"
                >
                  <span className={`block rounded-full ${photoIndex === idx ? 'h-2 w-2 bg-[var(--brand)]' : 'h-1.5 w-1.5 bg-white/70'}`} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {lightboxOpen && (
        <Lightbox
          photos={photos}
          startIdx={idx}
          roomName={roomName}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  )
}

export default function RoomCard({ room, currency, nights, onBook }) {
  const photos = Array.isArray(room.photos) && room.photos.length > 0
    ? room.photos
    : (room.photo ? [room.photo] : [])
  const highlights = buildRoomHighlights(room)

  return (
    <article className="surface-card flex h-full flex-col overflow-hidden rounded-[28px]">
      <PhotoCarousel photos={photos} roomName={room.room_number} />

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full border border-[var(--line-strong)] bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
              {room.room_type}
            </span>
            <h3 className="font-display mt-3 break-words text-2xl text-[var(--text)]">
              {room.room_number}
            </h3>
          </div>
          <div className="rounded-2xl bg-[var(--surface-strong)] px-4 py-3 text-right">
            <div className="text-2xl font-extrabold text-[var(--text)]">
              {currency}{Number(room.rate_per_night).toLocaleString()}
            </div>
            <div className="text-xs font-medium text-[var(--muted)]">per night</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm text-[var(--muted)]">
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5">
            <Users size={14} aria-hidden="true" />
            Up to {room.max_occupancy} guests
          </span>
          {nights > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5">
              <Moon size={14} aria-hidden="true" />
              {nights} night{nights !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {highlights.slice(0, 3).map((highlight) => (
            <span
              key={highlight}
              className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
            >
              {highlight}
            </span>
          ))}
        </div>

        {room.description ? (
          <p className="mt-4 line-clamp-3 flex-1 text-sm leading-7 text-[var(--muted)]">
            {room.description}
          </p>
        ) : (
          <p className="mt-4 flex-1 text-sm leading-7 text-[var(--muted)]">
            Clean, comfortable accommodation prepared for guest reservations through the lodge.
          </p>
        )}

        <div className="mt-5 flex items-end justify-between gap-3 border-t border-[var(--line)] pt-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Estimated stay total</p>
            <p className="mt-1 text-lg font-extrabold text-[var(--text)]">
              {currency}{Number(room.total_price || 0).toLocaleString()}
            </p>
          </div>

          <button
            onClick={() => onBook(room)}
            className="brand-button rounded-2xl px-5 py-3 text-sm font-extrabold transition-transform hover:-translate-y-0.5"
            aria-label={`Request ${room.room_number} for ${nights} night${nights !== 1 ? 's' : ''}`}
          >
            Request This Room
          </button>
        </div>
      </div>
    </article>
  )
}
