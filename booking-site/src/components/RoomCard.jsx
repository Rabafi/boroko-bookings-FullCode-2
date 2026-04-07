import { Users, Moon } from 'lucide-react'

export default function RoomCard({ room, currency, nights, onBook }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-stone-200 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      {/* Photo */}
      {room.photo ? (
        <img
          src={room.photo}
          alt={room.room_number}
          className="w-full h-48 object-cover"
        />
      ) : (
        <div className="w-full h-48 bg-stone-100 flex items-center justify-center">
          <span className="text-stone-400 text-sm">No photo</span>
        </div>
      )}

      <div className="p-5 flex flex-col flex-1">
        {/* Room type badge */}
        <span className="inline-block text-xs font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full mb-2 w-fit">
          {room.room_type}
        </span>

        <h3 className="font-bold text-stone-900 text-lg leading-tight mb-1">
          {room.room_number}
        </h3>

        <div className="flex items-center gap-3 text-sm text-stone-500 mb-3">
          <span className="flex items-center gap-1">
            <Users size={14} />
            Up to {room.max_occupancy} guests
          </span>
        </div>

        {room.description && (
          <p className="text-sm text-stone-600 mb-4 leading-relaxed flex-1">
            {room.description}
          </p>
        )}

        <div className="mt-auto pt-3 border-t border-stone-100">
          <div className="flex items-end justify-between mb-3">
            <div>
              <span className="text-2xl font-bold text-stone-900">
                {currency}{Number(room.rate_per_night).toLocaleString()}
              </span>
              <span className="text-stone-500 text-sm"> / night</span>
            </div>
            {nights > 0 && (
              <span className="text-sm text-stone-500 flex items-center gap-1">
                <Moon size={13} />
                {nights} night{nights !== 1 ? 's' : ''} = {currency}{Number(room.total_price).toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={() => onBook(room)}
            className="w-full bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
          >
            Book This Room
          </button>
        </div>
      </div>
    </div>
  )
}
