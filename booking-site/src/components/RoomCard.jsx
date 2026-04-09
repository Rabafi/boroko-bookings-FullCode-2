import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Users, Moon, ChevronLeft, ChevronRight, X, Maximize2, CheckCircle2 } from 'lucide-react'

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

function Lightbox({ photos, startIdx, roomName, onClose }) {
  const [idx, setIdx] = useState(startIdx)

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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div className="relative flex h-full w-full items-center justify-center px-6 py-12 sm:px-12" onClick={(event) => event.stopPropagation()}>
        <img
          src={photos[idx]}
          alt={`${roomName} — photo ${idx + 1}`}
          className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-2xl"
          draggable={false}
          loading="eager"
          decoding="async"
        />

        {photos.length > 1 && (
          <>
            <button onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/25" aria-label="Previous photo">
              <ChevronLeft size={22} />
            </button>
            <button onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/25" aria-label="Next photo">
              <ChevronRight size={22} />
            </button>
          </>
        )}

        <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25" aria-label="Close">
          <X size={20} />
        </button>

        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
          {photos.length > 1 && (
            <div className="flex gap-2">
              {photos.map((_, photoIndex) => (
                <button
                  key={photoIndex}
                  onClick={() => setIdx(photoIndex)}
                  className={`h-1.5 rounded-full transition-all ${photoIndex === idx ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
                  aria-label={`Photo ${photoIndex + 1}`}
                />
              ))}
            </div>
          )}
          <span className="text-xs text-white/75">
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

  if (!photos || photos.length === 0) {
    return (
      <div className="flex h-56 w-full items-center justify-center bg-[var(--surface-strong)] text-sm text-[var(--muted)]">
        No photo available
      </div>
    )
  }

  return (
    <>
      <div className="group relative h-56 w-full overflow-hidden bg-[var(--surface-strong)]">
        <img
          src={photos[idx]}
          alt={`${roomName} — photo ${idx + 1}`}
          className="h-full w-full cursor-zoom-in object-cover transition duration-500 group-hover:scale-[1.03]"
          onClick={() => setLightboxOpen(true)}
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

        <button
          onClick={() => setLightboxOpen(true)}
          className="absolute left-3 top-3 rounded-full bg-black/35 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="View full size"
        >
          <Maximize2 size={14} />
        </button>

        {photos.length > 1 && (
          <>
            <button
              onClick={(event) => {
                event.stopPropagation()
                setIdx((current) => (current - 1 + photos.length) % photos.length)
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Previous photo"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                setIdx((current) => (current + 1) % photos.length)
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Next photo"
            >
              <ChevronRight size={16} />
            </button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {photos.map((_, photoIndex) => (
                <button
                  key={photoIndex}
                  onClick={(event) => {
                    event.stopPropagation()
                    setIdx(photoIndex)
                  }}
                  className={`h-1.5 rounded-full transition-all ${photoIndex === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'}`}
                  aria-label={`Photo ${photoIndex + 1}`}
                />
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
            <h3 className="font-display mt-3 text-2xl text-[var(--text)]">
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
            <Users size={14} />
            Up to {room.max_occupancy} guests
          </span>
          {nights > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5">
              <Moon size={14} />
              {nights} night{nights !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {highlights.map((highlight) => (
            <span
              key={highlight}
              className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
            >
              {highlight}
            </span>
          ))}
        </div>

        {Array.isArray(room.amenities) && room.amenities.length > 0 && (
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Room amenities</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {room.amenities.map((amenity) => (
                <span
                  key={amenity}
                  className="inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                >
                  {amenity}
                </span>
              ))}
            </div>
          </div>
        )}

        {room.description ? (
          <p className="mt-4 flex-1 text-sm leading-7 text-[var(--muted)]">
            {room.description}
          </p>
        ) : (
          <p className="mt-4 flex-1 text-sm leading-7 text-[var(--muted)]">
            Clean, comfortable accommodation prepared for guest reservations through the lodge.
          </p>
        )}

        <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
          <div className="flex items-start gap-2 text-sm text-[var(--muted)]">
            <CheckCircle2 size={16} className="mt-0.5 text-[var(--success)]" />
            <div>
              <p className="font-semibold text-[var(--text)]">Reservation request</p>
              <p className="mt-1">Send your stay request to the lodge team and they confirm availability with you.</p>
            </div>
          </div>
        </div>

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
          >
            Request This Room
          </button>
        </div>
      </div>
    </article>
  )
}
