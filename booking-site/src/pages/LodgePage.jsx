import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import { Search, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import LodgeHeader from '../components/LodgeHeader.jsx'
import RoomCard from '../components/RoomCard.jsx'

export default function LodgePage() {
  const { slug } = useParams()
  const navigate = useNavigate()

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

  // Load lodge profile on mount
  useEffect(() => {
    async function fetchLodge() {
      setLoadingLodge(true)
      const { data, error } = await supabase.rpc('get_lodge_public_profile', { p_slug: slug })
      setLoadingLodge(false)
      if (error || !data?.found) {
        setLodgeError(data?.error || 'This lodge could not be found.')
        return
      }
      setLodge(data)
      // Update page title
      document.title = `Book a Room — ${data.lodge_name}`
    }
    fetchLodge()
  }, [slug])

  async function handleSearch(e) {
    e.preventDefault()
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setRoomError('Please select valid check-in and check-out dates.')
      return
    }
    setLoadingRooms(true)
    setRoomError(null)
    setRooms(null)
    setSearched(true)

    const { data, error } = await supabase.rpc('get_available_rooms', {
      p_slug: slug,
      p_check_in: checkIn,
      p_check_out: checkOut
    })

    setLoadingRooms(false)

    if (error || !data?.success) {
      setRoomError(data?.error || 'Could not load available rooms. Please try again.')
      return
    }

    setRooms(data.rooms || [])
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

  const nights = checkIn && checkOut ? Math.max(0,
    Math.floor((new Date(checkOut) - new Date(checkIn)) / 86400000)
  ) : 0

  // --- Render states ---

  if (loadingLodge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-stone-500 text-sm animate-pulse">Loading…</div>
      </div>
    )
  }

  if (lodgeError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🏕️</div>
          <h1 className="text-xl font-bold text-stone-900 mb-2">Property not found</h1>
          <p className="text-stone-500 text-sm">{lodgeError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <LodgeHeader lodge={lodge} />

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* Date search card */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-8">
          <h2 className="font-semibold text-stone-800 mb-4 flex items-center gap-2">
            <Calendar size={18} className="text-amber-600" />
            When are you staying?
          </h2>
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs text-stone-500 mb-1 font-medium">Check-in</label>
              <input
                type="date"
                value={checkIn}
                min={today}
                onChange={e => {
                  setCheckIn(e.target.value)
                  if (e.target.value >= checkOut) {
                    setCheckOut(format(addDays(new Date(e.target.value), 1), 'yyyy-MM-dd'))
                  }
                  setSearched(false)
                  setRooms(null)
                }}
                required
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-stone-500 mb-1 font-medium">Check-out</label>
              <input
                type="date"
                value={checkOut}
                min={checkIn ? format(addDays(new Date(checkIn), 1), 'yyyy-MM-dd') : tomorrow}
                onChange={e => { setCheckOut(e.target.value); setSearched(false); setRooms(null) }}
                required
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-stone-50"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={loadingRooms}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
              >
                <Search size={15} />
                {loadingRooms ? 'Searching…' : 'Search rooms'}
              </button>
            </div>
          </form>

          {nights > 0 && (
            <p className="mt-3 text-xs text-stone-400">
              {nights} night{nights !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Room results */}
        {roomError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-6">
            {roomError}
          </div>
        )}

        {loadingRooms && (
          <div className="text-center py-16 text-stone-400 text-sm animate-pulse">
            Checking availability…
          </div>
        )}

        {!loadingRooms && searched && rooms && rooms.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">😔</div>
            <p className="text-stone-600 font-medium">No rooms available for those dates.</p>
            <p className="text-stone-400 text-sm mt-1">Try different dates or contact the lodge directly.</p>
            {lodge.phone && (
              <a href={`tel:${lodge.phone}`} className="inline-block mt-4 text-amber-600 hover:underline text-sm">
                📞 {lodge.phone}
              </a>
            )}
          </div>
        )}

        {!loadingRooms && rooms && rooms.length > 0 && (
          <>
            <p className="text-sm text-stone-500 mb-4">
              {rooms.length} room{rooms.length !== 1 ? 's' : ''} available · {nights} night{nights !== 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {rooms.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  currency={lodge.currency}
                  nights={nights}
                  onBook={handleBook}
                />
              ))}
            </div>
          </>
        )}

        {!searched && (
          <div className="text-center py-16 text-stone-400">
            <div className="text-4xl mb-3">🗓️</div>
            <p className="text-sm">Select your dates and search to see available rooms.</p>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-stone-400 py-8">
        Powered by Boroko Bookings
      </footer>
    </div>
  )
}
