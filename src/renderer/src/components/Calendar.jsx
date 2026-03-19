import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  parseISO,
  isWithinInterval
} from 'date-fns'

const STATUS_COLORS = {
  confirmed: 'bg-blue-400',
  checked_in: 'bg-green-500',
  checked_out: 'bg-gray-300',
  cancelled: 'bg-red-300'
}

const STATUS_TEXT = {
  confirmed: 'text-blue-700',
  checked_in: 'text-green-700',
  checked_out: 'text-gray-500',
  cancelled: 'text-red-500'
}

export default function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [tooltip, setTooltip] = useState(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  useEffect(() => {
    loadData()
  }, [currentMonth])

  const loadData = async () => {
    const start = format(monthStart, 'yyyy-MM-dd')
    const end = format(monthEnd, 'yyyy-MM-dd')
    const [r, b] = await Promise.all([
      window.api.rooms.getAll(),
      window.api.bookings.getByDateRange(start, end)
    ])
    setRooms(r)
    setBookings(b)
  }

  // For each room + day, find which booking is active
  const cellData = useMemo(() => {
    const map = {}
    for (const room of rooms) {
      map[room.id] = {}
      for (const day of days) {
        const dayStr = format(day, 'yyyy-MM-dd')
        const booking = bookings.find(
          (b) =>
            b.room_id === room.id &&
            dayStr >= b.check_in &&
            dayStr < b.check_out
        )
        map[room.id][dayStr] = booking || null
      }
    }
    return map
  }, [rooms, bookings, days])

  const occupiedCount = (day) => {
    const dayStr = format(day, 'yyyy-MM-dd')
    return rooms.filter((r) => cellData[r.id]?.[dayStr]).length
  }

  const isToday = (day) => isSameDay(day, new Date())

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Occupancy Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">{rooms.length} rooms · {format(currentMonth, 'MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-semibold text-gray-700 min-w-[140px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="ml-2 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-sm ${color}`} />
            <span className="text-gray-500 capitalize">{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      {/* Occupancy Summary Row */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
        <div className="flex border-b border-gray-100">
          <div className="w-28 flex-shrink-0 px-3 py-2 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-r border-gray-100">
            Rooms
          </div>
          <div className="flex-1 overflow-x-auto">
            <div className="flex">
              {days.map((day) => (
                <div
                  key={day}
                  className={`flex-none text-center px-1 py-2 border-r border-gray-100 last:border-r-0 ${
                    isToday(day) ? 'bg-green-50' : ''
                  }`}
                  style={{ width: `${Math.max(32, Math.floor(800 / days.length))}px` }}
                >
                  <p className="text-xs text-gray-400">{format(day, 'EEE')[0]}</p>
                  <p className={`text-xs font-medium ${isToday(day) ? 'text-green-600 font-bold' : 'text-gray-600'}`}>
                    {format(day, 'd')}
                  </p>
                  {rooms.length > 0 && (
                    <p className="text-xs text-gray-400">{occupiedCount(day)}/{rooms.length}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Room rows */}
        {rooms.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            No rooms configured. Add rooms first.
          </div>
        ) : (
          rooms.map((room) => (
            <div key={room.id} className="flex border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50">
              {/* Room label */}
              <div className="w-28 flex-shrink-0 px-3 py-2 border-r border-gray-100 bg-gray-50/50">
                <p className="text-xs font-bold text-gray-700">Rm {room.room_number}</p>
                <p className="text-xs text-gray-400">{room.room_type}</p>
              </div>
              {/* Day cells */}
              <div className="flex-1 overflow-x-auto">
                <div className="flex">
                  {days.map((day) => {
                    const dayStr = format(day, 'yyyy-MM-dd')
                    const booking = cellData[room.id]?.[dayStr]
                    const isCheckIn = booking && booking.check_in === dayStr
                    const isCheckOut = booking && booking.check_out === format(day, 'yyyy-MM-dd')
                    return (
                      <div
                        key={dayStr}
                        className={`flex-none border-r border-gray-100 last:border-r-0 relative ${
                          isToday(day) ? 'bg-green-50/50' : ''
                        }`}
                        style={{ width: `${Math.max(32, Math.floor(800 / days.length))}px`, height: '40px' }}
                        onMouseEnter={(e) => {
                          if (booking) {
                            setTooltip({ booking, x: e.clientX, y: e.clientY })
                          }
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {booking && (
                          <div
                            className={`absolute inset-y-1 ${
                              isCheckIn ? 'left-1 right-0 rounded-l-sm' : 'left-0 right-0'
                            } ${STATUS_COLORS[booking.status]} opacity-80 cursor-pointer`}
                            title={`${booking.customer_name} | ${booking.check_in} → ${booking.check_out}`}
                          >
                            {isCheckIn && (
                              <span className="absolute left-1 top-1/2 -translate-y-1/2 text-white text-xs font-medium truncate max-w-[60px] leading-none">
                                {booking.customer_name?.split(' ')[0]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <p className="font-semibold">{tooltip.booking.customer_name}</p>
          <p className="text-gray-300">
            {tooltip.booking.check_in} → {tooltip.booking.check_out}
          </p>
          <p className="text-gray-300 capitalize">{tooltip.booking.status?.replace('_', ' ')}</p>
          <p className="text-gray-300">P {Number(tooltip.booking.total_amount || 0).toFixed(2)}</p>
        </div>
      )}

      {/* Bookings this month list */}
      {bookings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-700 text-sm">
              Bookings in {format(currentMonth, 'MMMM yyyy')} ({bookings.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-5 py-2 text-left">Guest</th>
                  <th className="px-5 py-2 text-left">Room</th>
                  <th className="px-5 py-2 text-left">Check In</th>
                  <th className="px-5 py-2 text-left">Check Out</th>
                  <th className="px-5 py-2 text-left">Status</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-medium text-gray-800">{b.customer_name}</td>
                    <td className="px-5 py-2.5 text-gray-600">Room {b.room_number}</td>
                    <td className="px-5 py-2.5 text-gray-600">{b.check_in}</td>
                    <td className="px-5 py-2.5 text-gray-600">{b.check_out}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs font-medium capitalize ${STATUS_TEXT[b.status]}`}>
                        {b.status?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-800">
                      P {Number(b.total_amount || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
