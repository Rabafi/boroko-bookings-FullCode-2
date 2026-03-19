import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { RefreshCw, X, Check, Wrench, Sparkles } from 'lucide-react'

const STATUS_CONFIG = {
  clean:       { label: 'Clean',       bg: 'bg-green-800/60',  border: 'border-green-600',  dot: 'bg-green-400' },
  dirty:       { label: 'Dirty',       bg: 'bg-yellow-800/40', border: 'border-yellow-600', dot: 'bg-yellow-400' },
  in_progress: { label: 'Cleaning',    bg: 'bg-blue-800/40',   border: 'border-blue-600',   dot: 'bg-blue-400' },
  out_of_service: { label: 'OOS',      bg: 'bg-gray-800/60',   border: 'border-gray-600',   dot: 'bg-gray-500' },
  occupied:    { label: 'Occupied',    bg: 'bg-red-800/40',    border: 'border-red-600',    dot: 'bg-red-400' },
}

function RoomSheet({ room, booking, onClose, onUpdate }) {
  const [hk, setHk] = useState(room.housekeeping_status || 'clean')
  const [notes, setNotes] = useState(room.housekeeping_notes || '')
  const [maint, setMaint] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState('')

  const saveHousekeeping = async () => {
    setSaving(true)
    await supabase.from('rooms').update({ housekeeping_status: hk, housekeeping_notes: notes }).eq('id', room.id)
    setSaving(false); setDone('hk')
    setTimeout(() => { onUpdate(); onClose() }, 800)
  }

  const raiseMaintenance = async () => {
    if (!maint.trim()) return
    setSaving(true)
    await supabase.from('maintenance_tickets').insert({ room_id: room.id, lodge_id: room.lodge_id, issue: maint, status: 'open', priority: 'normal' })
    setSaving(false); setDone('maint')
    setTimeout(() => { setMaint(''); setDone('') }, 1500)
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Room {room.room_number}</h2>
            <p className="text-xs text-gray-400">{room.room_type} · {room.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500"><X size={20} /></button>
        </div>

        {/* Current booking */}
        {booking && (
          <div className="bg-gray-800 rounded-xl p-3 mb-4">
            <p className="text-xs text-gray-400 mb-1">Current Guest</p>
            <p className="text-sm font-semibold text-white">{booking.guest_name || 'Guest'}</p>
            <p className="text-xs text-gray-400">Checkout: {booking.check_out}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
              booking.payment_status === 'paid' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
            }`}>{booking.payment_status}</span>
          </div>
        )}

        {/* Housekeeping */}
        <div className="mb-4">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><Sparkles size={12} /> Housekeeping</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {['clean', 'dirty', 'in_progress', 'out_of_service'].map(s => (
              <button
                key={s}
                onClick={() => setHk(s)}
                className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                  hk === s ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].border} text-white` : 'bg-gray-800 border-gray-700 text-gray-400'
                }`}
              >{STATUS_CONFIG[s].label}</button>
            ))}
          </div>
          <input className={inp} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <button
            onClick={saveHousekeeping}
            disabled={saving}
            className="w-full mt-2 bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {done === 'hk' ? <><Check size={16} /> Saved!</> : saving ? 'Saving…' : 'Update Housekeeping'}
          </button>
        </div>

        {/* Maintenance */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><Wrench size={12} /> Raise Maintenance Ticket</p>
          <textarea
            className={`${inp} h-20 resize-none`}
            placeholder="Describe the issue…"
            value={maint}
            onChange={e => setMaint(e.target.value)}
          />
          <button
            onClick={raiseMaintenance}
            disabled={saving || !maint.trim()}
            className="w-full mt-2 bg-orange-700 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {done === 'maint' ? <><Check size={16} /> Ticket Raised!</> : 'Raise Ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Rooms() {
  const { user } = useAuth()
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const [r, b] = await Promise.all([
      supabase.from('rooms').select('*').eq('lodge_id', user.lodge_id).order('room_number'),
      supabase.from('bookings').select('*').eq('lodge_id', user.lodge_id).eq('status', 'checked_in')
    ])
    setRooms(r.data || [])
    setBookings(b.data || [])
    setLoading(false)
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const getStatus = (room) => {
    const booking = bookings.find(b => b.room_id === room.id)
    if (booking) return 'occupied'
    return room.housekeeping_status || 'clean'
  }

  const getBooking = (room) => bookings.find(b => b.room_id === room.id)

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="bg-gray-900 px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Rooms</h1>
          <p className="text-xs text-gray-400">{rooms.length} total · {bookings.length} occupied</p>
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 flex gap-3 overflow-x-auto no-scrollbar">
        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full ${v.dot}`} />
            <span className="text-xs text-gray-400">{v.label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="px-4 py-2">
        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {rooms.map(room => {
              const status = getStatus(room)
              const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.clean
              return (
                <button
                  key={room.id}
                  onClick={() => setSelected(room)}
                  className={`${cfg.bg} border ${cfg.border} rounded-2xl p-3 text-left transition-all active:scale-95`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-bold text-sm">{room.room_number}</span>
                    <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                  </div>
                  <p className="text-gray-400 text-xs truncate">{room.room_type || 'Room'}</p>
                  <p className="text-gray-500 text-[10px] mt-0.5">{cfg.label}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Room detail sheet */}
      {selected && (
        <RoomSheet
          room={selected}
          booking={getBooking(selected)}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}
