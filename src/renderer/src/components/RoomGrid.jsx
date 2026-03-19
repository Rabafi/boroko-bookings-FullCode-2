import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DAYS_SHOWN = 14

// ── Date helpers ──────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function daysBetween(start, end) {
  return Math.round(
    (new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000
  )
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS = {
  confirmed:   { bar: 'bg-blue-500',   text: 'text-white' },
  checked_in:  { bar: 'bg-green-500',  text: 'text-white' },
  checked_out: { bar: 'bg-gray-400',   text: 'text-white' },
  cancelled:   { bar: 'bg-red-400',    text: 'text-white' }
}

// ── Room row ──────────────────────────────────────────────────────────────────
function RoomRow({ room, bookings, days, today, onSelect }) {
  const viewStart = days[0]
  const viewEnd   = addDays(days[days.length - 1], 1) // exclusive end

  return (
    <div className="flex border-b border-gray-100 hover:bg-gray-50/40 transition-colors">
      {/* Room label */}
      <div className="w-44 flex-shrink-0 border-r border-gray-100 px-4 flex flex-col justify-center py-2">
        <p className="text-sm font-semibold text-gray-800">Room {room.room_number}</p>
        <p className="text-xs text-gray-400">{room.room_type}</p>
        {room.status === 'maintenance' && (
          <span className="text-xs text-orange-500 font-medium">🔧 Maintenance</span>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 relative" style={{ height: 52 }}>
        {/* Background day cells */}
        <div className="absolute inset-0 flex pointer-events-none">
          {days.map((day) => (
            <div
              key={day}
              className={`flex-1 border-r border-gray-100 ${day === today ? 'bg-green-50' : ''}`}
            />
          ))}
        </div>

        {/* Maintenance overlay — full width red tint */}
        {room.status === 'maintenance' && (
          <div className="absolute inset-0 bg-orange-50/60 pointer-events-none" />
        )}

        {/* Booking blocks */}
        {bookings.map((b) => {
          const bStart = b.check_in  > viewStart ? b.check_in  : viewStart
          const bEnd   = b.check_out < viewEnd   ? b.check_out : viewEnd

          const startOff = daysBetween(viewStart, bStart)
          const duration = daysBetween(bStart, bEnd)

          if (startOff >= DAYS_SHOWN || duration <= 0) return null

          const left  = `${(startOff / DAYS_SHOWN) * 100}%`
          const width = `${(Math.min(duration, DAYS_SHOWN - startOff) / DAYS_SHOWN) * 100}%`
          const { bar, text } = STATUS[b.status] || STATUS.confirmed

          return (
            <div
              key={b.id}
              className={`absolute top-2 bottom-2 rounded-md flex items-center px-2 cursor-pointer shadow-sm hover:opacity-85 transition-opacity ${bar} ${text}`}
              style={{ left, width, zIndex: 1 }}
              onClick={() => onSelect(b)}
              title={`${b.customer_name}  •  ${b.check_in} → ${b.check_out}`}
            >
              <span className="text-xs font-medium truncate">{b.customer_name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Booking detail popup ──────────────────────────────────────────────────────
function BookingPopup({ booking: b, onClose }) {
  const nights = Math.max(0, daysBetween(b.check_in, b.check_out))
  const statusLabels = {
    confirmed:   '🔵 Confirmed',
    checked_in:  '🟢 Checked In',
    checked_out: '⚫ Checked Out',
    cancelled:   '🔴 Cancelled'
  }
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">{b.customer_name}</h3>
            <p className="text-sm text-gray-400">{b.customer_phone || ''}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2"
          >
            &times;
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <Row label="Room"      value={`${b.room_number}  —  ${b.room_type}`} />
          <Row label="Check-in"  value={b.check_in} />
          <Row label="Check-out" value={`${b.check_out}  (${nights} night${nights !== 1 ? 's' : ''})`} />
          <Row label="Guests"    value={`${b.adults} adult${b.adults !== 1 ? 's' : ''}${b.children > 0 ? `, ${b.children} child${b.children !== 1 ? 'ren' : ''}` : ''}`} />
          <Row label="Status"    value={statusLabels[b.status] || b.status} />
          <Row label="Total"     value={`P ${Number(b.total_amount || 0).toFixed(2)}`} />
          {b.notes && <Row label="Notes" value={b.notes} />}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-20 flex-shrink-0">{label}</span>
      <span className="text-gray-800 font-medium">{value}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RoomGrid() {
  const today = todayStr()
  const [viewStart, setViewStart] = useState(today)
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const viewEnd = addDays(viewStart, DAYS_SHOWN)
  const days    = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(viewStart, i))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.api.rooms.getAll(),
      window.api.bookings.getByDateRange(viewStart, viewEnd)
    ]).then(([r, b]) => {
      if (!cancelled) {
        setRooms(r || [])
        setBookings(b || [])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [viewStart])

  const prev   = () => setViewStart(addDays(viewStart, -DAYS_SHOWN))
  const next   = () => setViewStart(addDays(viewStart, DAYS_SHOWN))
  const goToday = () => setViewStart(today)

  // Date range label
  const rangeLabel = (() => {
    const s = new Date(viewStart + 'T12:00:00')
    const e = new Date(addDays(viewStart, DAYS_SHOWN - 1) + 'T12:00:00')
    const fmt = (d) => d.toLocaleDateString('en-BW', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${fmt(s)}  –  ${fmt(e)}`
  })()

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Room Grid</h1>
          <p className="text-sm text-gray-500 mt-0.5">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Previous 2 weeks"
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <button
            onClick={goToday}
            className="px-4 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Today
          </button>
          <button
            onClick={next}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Next 2 weeks"
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-600">
        {[
          { color: 'bg-blue-500',  label: 'Confirmed' },
          { color: 'bg-green-500', label: 'Checked In' },
          { color: 'bg-gray-400',  label: 'Checked Out' },
          { color: 'bg-green-50 border border-green-200', label: 'Today' }
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded ${color}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        {/* Column headers */}
        <div className="flex border-b-2 border-gray-200 bg-gray-50 sticky top-0 z-10">
          <div className="w-44 flex-shrink-0 border-r border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">
            Room
          </div>
          {days.map((day) => {
            const d = new Date(day + 'T12:00:00')
            const isToday = day === today
            return (
              <div
                key={day}
                className={`flex-1 py-2 text-center border-r border-gray-100 ${isToday ? 'bg-green-100' : ''}`}
              >
                <p className={`text-xs font-semibold leading-tight ${isToday ? 'text-green-700' : 'text-gray-500'}`}>
                  {d.toLocaleDateString('en-BW', { weekday: 'short' })}
                </p>
                <p className={`text-xs leading-tight ${isToday ? 'text-green-600 font-bold' : 'text-gray-400'}`}>
                  {d.getDate()}
                </p>
                <p className="text-gray-300 text-xs leading-none">
                  {d.toLocaleDateString('en-BW', { month: 'short' })}
                </p>
              </div>
            )
          })}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading...</div>
        ) : rooms.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            No rooms found. Add rooms first in the Rooms section.
          </div>
        ) : (
          rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              bookings={bookings.filter((b) => b.room_id === room.id)}
              days={days}
              today={today}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {/* Stats bar */}
      {!loading && rooms.length > 0 && (
        <div className="mt-4 flex gap-6 text-sm text-gray-500">
          {(() => {
            const occupied = new Set(
              bookings
                .filter((b) => ['confirmed', 'checked_in'].includes(b.status) && b.check_in <= today && b.check_out > today)
                .map((b) => b.room_id)
            ).size
            return (
              <>
                <span><span className="font-semibold text-gray-800">{occupied}</span> / {rooms.length} rooms occupied tonight</span>
                <span><span className="font-semibold text-gray-800">{rooms.length - occupied}</span> available</span>
              </>
            )
          })()}
        </div>
      )}

      {/* Popup */}
      {selected && <BookingPopup booking={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
