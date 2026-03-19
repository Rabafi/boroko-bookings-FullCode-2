import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { RefreshCw, X, Check, Plus, Search, DoorOpen, DoorClosed, CreditCard } from 'lucide-react'
import { format, parseISO } from 'date-fns'

const STATUS_COLOR = {
  confirmed:   'bg-blue-900/50 text-blue-300',
  checked_in:  'bg-green-900/50 text-green-300',
  checked_out: 'bg-gray-800 text-gray-400',
  cancelled:   'bg-red-900/30 text-red-400',
  no_show:     'bg-yellow-900/30 text-yellow-400',
}
const PAY_COLOR = {
  paid:    'bg-green-900/50 text-green-400',
  partial: 'bg-yellow-900/50 text-yellow-400',
  pending: 'bg-red-900/30 text-red-400',
}

function BookingSheet({ booking, onClose, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState('')
  const [payAmount, setPayAmount] = useState('')

  const updateStatus = async (status) => {
    setSaving(true)
    await supabase.from('bookings').update({ status }).eq('id', booking.id)
    setSaving(false); setDone(status)
    setTimeout(() => { onUpdate(); onClose() }, 800)
  }

  const markPaid = async () => {
    const amt = parseFloat(payAmount) || booking.total_amount
    const newPaid = (Number(booking.amount_paid) || 0) + amt
    const payStatus = newPaid >= booking.total_amount ? 'paid' : 'partial'
    setSaving(true)
    await supabase.from('bookings').update({ amount_paid: newPaid, payment_status: payStatus }).eq('id', booking.id)
    setSaving(false); setDone('paid')
    setTimeout(() => { onUpdate(); onClose() }, 800)
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500'
  const nights = booking.check_in && booking.check_out
    ? Math.round((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">{booking.guest_name || 'Guest'}</h2>
            <p className="text-xs text-gray-400">{nights} night{nights !== 1 ? 's' : ''} · Check-in {format(parseISO(booking.check_in), 'd MMM')} → {format(parseISO(booking.check_out), 'd MMM')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500"><X size={20} /></button>
        </div>

        {/* Details */}
        <div className="bg-gray-800 rounded-xl p-3 mb-4 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-gray-400">Status</span><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[booking.status]}`}>{booking.status}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Total</span><span className="text-white font-semibold">P {Number(booking.total_amount || 0).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Paid</span><span className="text-green-400">P {Number(booking.amount_paid || 0).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Balance</span><span className="text-yellow-400">P {Math.max(0, Number(booking.total_amount || 0) - Number(booking.amount_paid || 0)).toLocaleString()}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-400">Payment</span><span className={`px-2 py-0.5 rounded-full text-xs ${PAY_COLOR[booking.payment_status]}`}>{booking.payment_status}</span></div>
        </div>

        {/* Status actions */}
        {booking.status === 'confirmed' && (
          <button onClick={() => updateStatus('checked_in')} disabled={saving} className="w-full bg-green-700 hover:bg-green-600 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 mb-3 disabled:opacity-60">
            {done === 'checked_in' ? <><Check size={16} /> Done!</> : <><DoorOpen size={16} /> Check In Guest</>}
          </button>
        )}
        {booking.status === 'checked_in' && (
          <button onClick={() => updateStatus('checked_out')} disabled={saving} className="w-full bg-blue-700 hover:bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 mb-3 disabled:opacity-60">
            {done === 'checked_out' ? <><Check size={16} /> Done!</> : <><DoorClosed size={16} /> Check Out Guest</>}
          </button>
        )}

        {/* Payment */}
        {booking.payment_status !== 'paid' && (
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1"><CreditCard size={12} /> Record Payment</p>
            <input className={inp} type="number" placeholder={`Amount (balance: P ${Math.max(0, booking.total_amount - (booking.amount_paid || 0))})`} value={payAmount} onChange={e => setPayAmount(e.target.value)} />
            <button onClick={markPaid} disabled={saving} className="w-full mt-2 bg-emerald-700 hover:bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
              {done === 'paid' ? '✓ Payment Recorded!' : saving ? 'Saving…' : 'Mark Payment Received'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function NewBookingSheet({ onClose, onCreated, lodgeId }) {
  const [form, setForm] = useState({ guest_name: '', room_number: '', check_in: '', check_out: '', total_amount: '', payment_method: 'cash', notes: '' })
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('rooms').select('id, room_number, rate_per_night').eq('lodge_id', lodgeId).order('room_number')
      .then(({ data }) => setRooms(data || []))
  }, [lodgeId])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const inp = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

  const submit = async () => {
    if (!form.guest_name || !form.room_number || !form.check_in || !form.check_out) { setError('Fill in all required fields.'); return }
    setSaving(true); setError('')
    const room = rooms.find(r => String(r.room_number) === String(form.room_number))
    if (!room) { setError('Room not found.'); setSaving(false); return }
    const nights = Math.round((new Date(form.check_out) - new Date(form.check_in)) / 86400000)
    const total = form.total_amount || (room.rate_per_night * nights)
    const { error: err } = await supabase.from('bookings').insert({
      lodge_id: lodgeId, room_id: room.id, guest_name: form.guest_name,
      check_in: form.check_in, check_out: form.check_out,
      total_amount: Number(total), amount_paid: 0, payment_status: 'pending',
      payment_method: form.payment_method, status: 'confirmed', notes: form.notes
    })
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false); onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-t-3xl p-5 max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">New Booking</h2>
          <button onClick={onClose} className="p-2 text-gray-500"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs text-gray-400 block mb-1">Guest Name *</label><input className={inp} placeholder="Full name" value={form.guest_name} onChange={e => set('guest_name', e.target.value)} /></div>
          <div><label className="text-xs text-gray-400 block mb-1">Room *</label>
            <select className={inp} value={form.room_number} onChange={e => set('room_number', e.target.value)}>
              <option value="">Select room…</option>
              {rooms.map(r => <option key={r.id} value={r.room_number}>Room {r.room_number} (P{r.rate_per_night}/night)</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-400 block mb-1">Check-in *</label><input className={inp} type="date" value={form.check_in} onChange={e => set('check_in', e.target.value)} /></div>
            <div><label className="text-xs text-gray-400 block mb-1">Check-out *</label><input className={inp} type="date" value={form.check_out} onChange={e => set('check_out', e.target.value)} /></div>
          </div>
          <div><label className="text-xs text-gray-400 block mb-1">Total Amount (auto-calculated if blank)</label><input className={inp} type="number" placeholder="Leave blank to auto-calculate" value={form.total_amount} onChange={e => set('total_amount', e.target.value)} /></div>
          <div><label className="text-xs text-gray-400 block mb-1">Payment Method</label>
            <select className={inp} value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
              {['cash', 'card', 'transfer', 'mobile_money'].map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div><label className="text-xs text-gray-400 block mb-1">Notes</label><textarea className={`${inp} h-16 resize-none`} placeholder="Special requests…" value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={submit} disabled={saving} className="w-full bg-green-700 hover:bg-green-600 text-white py-3 rounded-xl font-semibold disabled:opacity-60">
            {saving ? 'Creating…' : 'Create Booking'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Bookings() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [tab, setTab] = useState('today')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('bookings').select('*').eq('lodge_id', user.lodge_id).order('check_in', { ascending: false })
    setBookings(data || [])
    setLoading(false)
  }, [user.lodge_id])

  useEffect(() => { load() }, [load])

  const filtered = bookings.filter(b => {
    const matchSearch = !search || (b.guest_name || '').toLowerCase().includes(search.toLowerCase())
    if (tab === 'today') return matchSearch && (b.check_in === today || b.check_out === today) && b.status !== 'cancelled'
    if (tab === 'upcoming') return matchSearch && b.check_in > today && b.status === 'confirmed'
    return matchSearch
  })

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="bg-gray-900 px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-white">Bookings</h1>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 text-gray-400 hover:text-white"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-1.5 rounded-xl"><Plus size={15} /> New</button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-2 mb-3">
          {[['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${tab === id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}>{label}</button>
          ))}
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Search guest name…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-12"><div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500 text-sm text-center pt-12">No bookings found.</p>
        ) : filtered.map(b => (
          <button key={b.id} onClick={() => setSelected(b)} className="w-full bg-gray-800 rounded-2xl p-4 text-left active:scale-[0.98] transition-transform">
            <div className="flex items-start justify-between mb-2">
              <p className="text-white font-semibold text-sm">{b.guest_name || 'Guest'}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[b.status]}`}>{b.status.replace('_', ' ')}</span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-xs">{b.check_in} → {b.check_out}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PAY_COLOR[b.payment_status]}`}>{b.payment_status}</span>
            </div>
            <p className="text-gray-500 text-xs mt-1">P {Number(b.total_amount || 0).toLocaleString()}</p>
          </button>
        ))}
      </div>

      {selected && <BookingSheet booking={selected} onClose={() => setSelected(null)} onUpdate={load} />}
      {showNew && <NewBookingSheet lodgeId={user.lodge_id} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
    </div>
  )
}
