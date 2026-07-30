import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CreditCard, DoorClosed, DoorOpen, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSettings } from '../app-context'
import { formatLocalDate, localToday } from '../utils/localDate'

const DAYS_SHOWN = 14

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return formatLocalDate(d)
}

function daysBetween(start, end) {
  return Math.round(
    (new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000
  )
}

function rangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false
  return startA < endB && endA > startB
}

function todayStr() {
  return localToday()
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} is taking too long to load.`)), ms)
    })
  ])
}

const STATUS = {
  confirmed: { bar: 'bg-blue-500', text: 'text-white' },
  checked_in: { bar: 'bg-green-500', text: 'text-white' },
  checked_out: { bar: 'bg-gray-400', text: 'text-white' },
  cancelled: { bar: 'bg-red-400', text: 'text-white' }
}

const HOUSEKEEPING = {
  clean: {
    label: 'Clean',
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200'
  },
  dirty: {
    label: 'Dirty',
    badge: 'bg-rose-100 text-rose-700 border border-rose-200'
  },
  in_progress: {
    label: 'In Progress',
    badge: 'bg-amber-100 text-amber-700 border border-amber-200'
  }
}

const PAYMENT_STATUS_LABELS = {
  paid: 'Paid',
  partial: 'Part Paid',
  unpaid: 'Unpaid'
}

function bookingOutstandingAmount(booking) {
  return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
}

function formatMoney(currency, amount) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`
}

function Row({ label, value, valueClassName = 'text-gray-800' }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 flex-shrink-0 text-gray-400">{label}</span>
      <span className={`${valueClassName} font-medium`}>{value}</span>
    </div>
  )
}

function RoomRow({ room, bookings, locks, days, today, currency, onSelect }) {
  const viewStart = days[0]
  const viewEnd = addDays(days[days.length - 1], 1)
  const housekeeping = HOUSEKEEPING[room.housekeeping_status || 'clean'] || HOUSEKEEPING.clean
  const activeBooking = bookings.find((booking) => ['confirmed', 'checked_in'].includes(booking.status) && booking.check_in <= today && booking.check_out > today)
  const dueNow = activeBooking ? bookingOutstandingAmount(activeBooking) : 0

  return (
    <div className="flex border-b border-gray-100 transition-colors hover:bg-gray-50/40">
      <div className="w-52 flex-shrink-0 border-r border-gray-100 px-4 py-2">
        <p className="text-sm font-semibold text-gray-800">Room {room.room_number}</p>
        <p className="text-xs text-gray-400">{room.room_type}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${housekeeping.badge}`}>
            {housekeeping.label}
          </span>
          {room.status === 'reserved' && (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
              Reserved
            </span>
          )}
        </div>
        {room.status === 'maintenance' && (
          <span className="mt-1 block text-xs font-medium text-orange-500">Maintenance</span>
        )}
        {dueNow > 0 && (
          <span className="mt-1 block text-[11px] font-semibold text-rose-600">
            Due now: {formatMoney(currency, dueNow)}
          </span>
        )}
      </div>

      <div className="relative flex-1" style={{ height: 52 }}>
        <div className="pointer-events-none absolute inset-0 flex">
          {days.map((day) => (
            <div
              key={day}
              className={`flex-1 border-r border-gray-100 ${day === today ? 'bg-green-50' : ''}`}
            />
          ))}
        </div>

        {room.status === 'maintenance' && (
          <div className="pointer-events-none absolute inset-0 bg-orange-50/60" />
        )}

        {bookings.map((booking) => {
          const visibleStart = booking.check_in > viewStart ? booking.check_in : viewStart
          const visibleEnd = booking.check_out < viewEnd ? booking.check_out : viewEnd
          const startOff = daysBetween(viewStart, visibleStart)
          const duration = daysBetween(visibleStart, visibleEnd)

          if (startOff >= DAYS_SHOWN || duration <= 0) return null

          const left = `${(startOff / DAYS_SHOWN) * 100}%`
          const width = `${(Math.min(duration, DAYS_SHOWN - startOff) / DAYS_SHOWN) * 100}%`
          const { bar, text } = STATUS[booking.status] || STATUS.confirmed
          const hasBalanceDue = bookingOutstandingAmount(booking) > 0 && booking.status !== 'cancelled'

          return (
            <div
              key={booking.id}
              className={`absolute top-2 bottom-2 flex cursor-pointer items-center rounded-md px-2 shadow-sm transition-opacity hover:opacity-85 ${bar} ${text} ${hasBalanceDue ? 'ring-2 ring-rose-200 ring-inset' : ''}`}
              style={{ left, width, zIndex: 1 }}
              onClick={() => onSelect(booking)}
              title={`${booking.customer_name} • ${booking.check_in} → ${booking.check_out}`}
            >
              <span className="truncate text-xs font-medium">
                {booking.customer_name}
                {hasBalanceDue ? ' · Due' : ''}
              </span>
            </div>
          )
        })}

        {locks.map((lock) => {
          const visibleStart = lock.startDate > viewStart ? lock.startDate : viewStart
          const visibleEnd = lock.endDate < viewEnd ? lock.endDate : viewEnd
          const startOff = daysBetween(viewStart, visibleStart)
          const duration = daysBetween(visibleStart, visibleEnd)

          if (startOff >= DAYS_SHOWN || duration <= 0) return null

          const left = `${(startOff / DAYS_SHOWN) * 100}%`
          const width = `${(Math.min(duration, DAYS_SHOWN - startOff) / DAYS_SHOWN) * 100}%`

          return (
            <div
              key={lock.lockId}
              className="absolute top-1 bottom-1 flex items-center rounded-md border border-amber-300 bg-amber-100/90 px-2 text-amber-900 shadow-sm"
              style={{ left, width, zIndex: 2 }}
              title={`Held by another front desk • ${lock.startDate} → ${lock.endDate}`}
            >
              <span className="truncate text-[11px] font-semibold">Held</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BookingPopup({ booking, currency, today, actionLoading, onClose, onOpenBooking, onCollectPayment, onStatusChange }) {
  const nights = Math.max(0, daysBetween(booking.check_in, booking.check_out))
  const total = Number(booking.total_amount || 0)
  const charges = Number(booking.charges_total || 0)
  const paid = Number(booking.amount_paid || 0)
  const outstanding = bookingOutstandingAmount(booking)
  const housekeeping = HOUSEKEEPING[booking.housekeeping_status || 'clean'] || HOUSEKEEPING.clean
  const statusLabels = {
    confirmed: 'Confirmed',
    checked_in: 'Checked In',
    checked_out: 'Checked Out',
    cancelled: 'Cancelled'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[26rem] rounded-xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800">{booking.customer_name}</h3>
            <p className="text-sm text-gray-400">{booking.customer_phone || ''}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 text-2xl leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <Row label="Room" value={`${booking.room_number} — ${booking.room_type}`} />
          <Row label="Check-in" value={booking.check_in} />
          <Row label="Check-out" value={`${booking.check_out} (${nights} night${nights !== 1 ? 's' : ''})`} />
          <Row label="Guests" value={`${booking.adults} adult${booking.adults !== 1 ? 's' : ''}${booking.children > 0 ? `, ${booking.children} child${booking.children !== 1 ? 'ren' : ''}` : ''}`} />
          <Row label="Status" value={statusLabels[booking.status] || booking.status} />
          <Row label="Ready" value={housekeeping.label} />
          <Row label="Room Total" value={formatMoney(currency, total)} />
          <Row label="Extras" value={formatMoney(currency, charges)} />
          <Row label="Paid" value={formatMoney(currency, paid)} />
          <Row label="Balance" value={formatMoney(currency, outstanding)} valueClassName={outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'} />
          <Row label="Payment" value={PAYMENT_STATUS_LABELS[booking.payment_status] || booking.payment_status || 'Unpaid'} />
          {booking.notes ? <Row label="Notes" value={booking.notes} /> : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => onOpenBooking(booking)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ExternalLink size={15} /> Open Booking
          </button>
          {outstanding > 0 && booking.status !== 'cancelled' ? (
            <button
              onClick={() => onCollectPayment(booking)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <CreditCard size={15} /> Collect Payment
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm font-semibold text-emerald-700">
              Fully Settled
            </div>
          )}
          {booking.status === 'confirmed' ? (
            <button
              onClick={() => onStatusChange(booking, 'checked_in')}
              disabled={actionLoading || booking.check_in > today}
              title={booking.check_in > today ? `Check-in date is ${booking.check_in}` : undefined}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <DoorOpen size={15} /> {actionLoading ? 'Working…' : 'Check In'}
            </button>
          ) : null}
          {booking.status === 'checked_in' ? (
            <button
              onClick={() => onStatusChange(booking, 'checked_out')}
              disabled={actionLoading || outstanding > 0}
              title={outstanding > 0 ? `Settle ${formatMoney(currency, outstanding)} before checkout.` : 'Check out guest'}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white transition-colors ${
                outstanding > 0
                  ? 'cursor-not-allowed bg-slate-300 text-slate-600'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <DoorClosed size={15} /> {actionLoading ? 'Working…' : 'Check Out'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function RoomGrid() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const today = todayStr()
  const [viewStart, setViewStart] = useState(today)
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [warning, setWarning] = useState('')
  const [statusActionLoading, setStatusActionLoading] = useState(false)
  const [meshStatus, setMeshStatus] = useState({ activeLocks: [], peerCount: 0 })

  const viewEnd = addDays(viewStart, DAYS_SHOWN)
  const days = Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(viewStart, index))

  const loadBoard = async (cancelSignal) => {
    setLoading(true)
    setWarning('')
    try {
      const [cachedRoomResult, cachedBookingResult] = await Promise.allSettled([
        window.api.rooms.getCached?.() || window.api.rooms.getAll(),
        window.api.bookings.getCachedByDateRange?.(viewStart, viewEnd) || window.api.bookings.getByDateRange(viewStart, viewEnd)
      ])
      if (cancelSignal?.cancelled) return

      const cachedRooms = cachedRoomResult.status === 'fulfilled' && Array.isArray(cachedRoomResult.value)
        ? cachedRoomResult.value
        : []
      const cachedBookings = cachedBookingResult.status === 'fulfilled' && Array.isArray(cachedBookingResult.value)
        ? cachedBookingResult.value
        : []

      if (cachedRooms.length > 0) {
        setRooms(cachedRooms)
        setBookings(cachedBookings)
        setLoading(false)
      }

      const [roomResult, bookingResult] = await Promise.allSettled([
        withTimeout(window.api.rooms.getAll(), cachedRooms.length > 0 ? 3500 : 8000, 'Rooms'),
        withTimeout(window.api.bookings.getByDateRange(viewStart, viewEnd), cachedRooms.length > 0 ? 3500 : 8000, 'Bookings')
      ])
      if (cancelSignal?.cancelled) return

      if (roomResult.status === 'fulfilled' && Array.isArray(roomResult.value)) {
        setRooms(roomResult.value)
      }
      if (bookingResult.status === 'fulfilled' && Array.isArray(bookingResult.value)) {
        setBookings(bookingResult.value)
      }

      if (cachedRooms.length === 0 && roomResult.status === 'rejected') {
        setWarning(roomResult.reason?.message || 'Rooms could not be loaded.')
      }
    } catch (error) {
      if (!cancelSignal?.cancelled) {
        setWarning(error?.message || 'Could not refresh the live room board.')
      }
    } finally {
      if (!cancelSignal?.cancelled) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const cancelSignal = { cancelled: false }
    loadBoard(cancelSignal)
    return () => {
      cancelSignal.cancelled = true
    }
  }, [viewStart, viewEnd])

  useEffect(() => {
    let cancelled = false
    const loadMeshStatus = async () => {
      const status = await window.api?.sync?.getStatus?.().catch(() => null)
      if (!cancelled) setMeshStatus(status?.mesh || { activeLocks: [], peerCount: 0 })
    }
    loadMeshStatus()
    const unsubscribe = window.api?.sync?.onStatusChanged?.((status) => {
      setMeshStatus(status?.mesh || { activeLocks: [], peerCount: 0 })
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const prev = () => setViewStart(addDays(viewStart, -DAYS_SHOWN))
  const next = () => setViewStart(addDays(viewStart, DAYS_SHOWN))
  const goToday = () => setViewStart(today)

  const rangeLabel = (() => {
    const start = new Date(viewStart + 'T12:00:00')
    const end = new Date(addDays(viewStart, DAYS_SHOWN - 1) + 'T12:00:00')
    const format = (date) => date.toLocaleDateString('en-BW', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${format(start)} – ${format(end)}`
  })()

  const arrivalsToday = bookings.filter((booking) => booking.check_in === today && booking.status !== 'cancelled').length
  const departuresToday = bookings.filter((booking) => booking.check_out === today && booking.status !== 'cancelled').length
  const occupiedTonight = new Set(
    bookings
      .filter((booking) => ['confirmed', 'checked_in'].includes(booking.status) && booking.check_in <= today && booking.check_out > today)
      .map((booking) => booking.room_id)
  ).size
  const vacantTonight = Math.max(rooms.length - occupiedTonight, 0)
  const dueTonight = bookings
    .filter((booking) => ['confirmed', 'checked_in'].includes(booking.status) && booking.check_in <= today && booking.check_out > today)
    .reduce((sum, booking) => sum + bookingOutstandingAmount(booking), 0)
  const housekeepingCounts = useMemo(() => rooms.reduce((counts, room) => {
    const status = room.housekeeping_status || 'clean'
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, { clean: 0, dirty: 0, in_progress: 0 }), [rooms])

  const openBooking = (booking) => {
    setSelected(null)
    navigate('/bookings', { state: { focusBookingId: booking.id } })
  }

  const collectPayment = (booking) => {
    setSelected(null)
    navigate('/bookings', { state: { collectPaymentBookingId: booking.id } })
  }

  const handleStatusChange = async (booking, status) => {
    if (!booking?.id) return
    if (status === 'checked_in' && booking) {
      if (booking.check_in > today) {
        setWarning(`Cannot check in before the check-in date (${booking.check_in}).`)
        return
      }
    }
    if (status === 'checked_out') {
      const outstanding = bookingOutstandingAmount(booking)
      if (outstanding > 0) {
        setWarning(`Cannot check out ${booking.customer_name || 'this guest'} until the full balance is paid. Outstanding: ${formatMoney(currency, outstanding)}.`)
        return
      }
    }

    setStatusActionLoading(true)
    setWarning('')
    try {
      const result = await window.api.bookings.updateStatus(booking.id, status)
      if (result?.success === false) {
        setWarning(result.error || 'Could not update booking status.')
        return
      }
      setSelected(null)
      await loadBoard({ cancelled: false })
    } catch (error) {
      setWarning(error?.message || 'Could not update booking status.')
    } finally {
      setStatusActionLoading(false)
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Live Room Board</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Front-desk view for room assignment, arrivals, departures, and live availability. {rangeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100"
            title="Previous 2 weeks"
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <button
            onClick={goToday}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm transition-colors hover:bg-gray-50"
          >
            Today
          </button>
          <button
            onClick={next}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100"
            title="Next 2 weeks"
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      <div className="bb-compact-stat-grid mb-3">
        <div className="bb-compact-stat border-emerald-100 bg-emerald-50/80 text-emerald-800">
          <p className="bb-compact-stat__label">Occupied Tonight</p>
          <p className="bb-compact-stat__value text-emerald-950">{occupiedTonight}</p>
        </div>
        <div className="bb-compact-stat border-sky-100 bg-sky-50/80 text-sky-800">
          <p className="bb-compact-stat__label">Vacant Tonight</p>
          <p className="bb-compact-stat__value text-sky-950">{vacantTonight}</p>
        </div>
        <div className="bb-compact-stat border-blue-100 bg-blue-50/80 text-blue-800">
          <p className="bb-compact-stat__label">Arrivals Today</p>
          <p className="bb-compact-stat__value text-blue-950">{arrivalsToday}</p>
        </div>
        <div className="bb-compact-stat border-amber-100 bg-amber-50/80 text-amber-800">
          <p className="bb-compact-stat__label">Departures Today</p>
          <p className="bb-compact-stat__value text-amber-950">{departuresToday}</p>
        </div>
        <div className="bb-compact-stat border-rose-100 bg-rose-50/80 text-rose-800">
          <p className="bb-compact-stat__label">Outstanding</p>
          <p className="bb-compact-stat__value text-rose-950">{formatMoney(currency, dueTonight)}</p>
        </div>
        <div className="bb-compact-stat border-emerald-100 bg-emerald-50/80 text-emerald-800">
          <p className="bb-compact-stat__label">Clean Rooms</p>
          <p className="bb-compact-stat__value text-emerald-950">{housekeepingCounts.clean || 0}</p>
        </div>
        <div className="bb-compact-stat border-orange-100 bg-orange-50/80 text-orange-800">
          <p className="bb-compact-stat__label">Need Attention</p>
          <p className="bb-compact-stat__value text-orange-950">{(housekeepingCounts.dirty || 0) + (housekeepingCounts.in_progress || 0)}</p>
        </div>
      </div>

      {warning ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warning}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-4 text-xs text-gray-600">
        {[
          { color: 'bg-blue-500', label: 'Confirmed' },
          { color: 'bg-green-500', label: 'Checked In' },
          { color: 'bg-gray-400', label: 'Checked Out' },
          { color: 'bg-orange-100 border border-orange-200', label: 'Maintenance' },
          { color: 'bg-rose-100 border border-rose-200', label: 'Balance Due' },
          { color: 'bg-amber-100 border border-amber-300', label: 'Local Mesh Hold' },
          { color: 'bg-green-50 border border-green-200', label: 'Today' }
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded ${color}`} />
            {label}
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="sticky top-0 z-10 flex border-b-2 border-gray-200 bg-gray-50">
          <div className="w-52 flex-shrink-0 border-r border-gray-200 px-4 py-2.5 text-xs font-semibold uppercase text-gray-500">
            Room
          </div>
          {days.map((day) => {
            const date = new Date(day + 'T12:00:00')
            const isToday = day === today
            return (
              <div
                key={day}
                className={`flex-1 border-r border-gray-100 py-2 text-center ${isToday ? 'bg-green-100' : ''}`}
              >
                <p className={`text-xs font-semibold leading-tight ${isToday ? 'text-green-700' : 'text-gray-500'}`}>
                  {date.toLocaleDateString('en-BW', { weekday: 'short' })}
                </p>
                <p className={`text-xs leading-tight ${isToday ? 'font-bold text-green-600' : 'text-gray-400'}`}>
                  {date.getDate()}
                </p>
                <p className="text-xs leading-none text-gray-300">
                  {date.toLocaleDateString('en-BW', { month: 'short' })}
                </p>
              </div>
            )
          })}
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
        ) : rooms.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No rooms found. Add rooms first in the Rooms section.
          </div>
        ) : (
          rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              bookings={bookings.filter((booking) => booking.room_id === room.id)}
              locks={(meshStatus.activeLocks || []).filter((lock) => (
                lock.sourceNodeId !== meshStatus.nodeId &&
                String(lock.roomId) === String(room.id) &&
                rangesOverlap(lock.startDate, lock.endDate, viewStart, viewEnd)
              ))}
              days={days}
              today={today}
              currency={currency}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {!loading && rooms.length > 0 ? (
        <div className="mt-4 flex gap-6 text-sm text-gray-500">
          <span><span className="font-semibold text-gray-800">{occupiedTonight}</span> / {rooms.length} rooms occupied tonight</span>
          <span><span className="font-semibold text-gray-800">{vacantTonight}</span> available</span>
          <span><span className="font-semibold text-gray-800">{(housekeepingCounts.dirty || 0) + (housekeepingCounts.in_progress || 0)}</span> need housekeeping attention</span>
        </div>
      ) : null}

      {selected ? (
        <BookingPopup
          booking={selected}
          currency={currency}
          today={today}
          actionLoading={statusActionLoading}
          onClose={() => setSelected(null)}
          onOpenBooking={openBooking}
          onCollectPayment={collectPayment}
          onStatusChange={handleStatusChange}
        />
      ) : null}
    </div>
  )
}
