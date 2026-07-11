import { useState, useEffect } from 'react'
import { Plus, X, Clock, Users, Phone, CalendarDays, MessageCircle } from 'lucide-react'

const STATUSES = ['booked', 'confirmed', 'waiting', 'seated', 'completed', 'cancelled', 'no_show']
const STATUS_COLORS = {
  booked: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  waiting: 'bg-amber-100 text-amber-700',
  seated: 'bg-purple-100 text-purple-700',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-orange-100 text-orange-600'
}

export default function RestaurantReservations() {
  const [reservations, setReservations] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('today')
  const [showForm, setShowForm] = useState(false)
  const [showWaitlistForm, setShowWaitlistForm] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ customerName: '', customerPhone: '', partySize: '2', date: new Date().toISOString().slice(0, 10), time: '19:00', duration: '90', source: 'walk_in', notes: '' })
  const [waitlistForm, setWaitlistForm] = useState({ customerName: '', customerPhone: '', partySize: '2', notes: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    try {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const [res, wl] = await Promise.allSettled([
        window.api.pos.getRestaurantReservations(today, today),
        window.api.pos.getRestaurantWaitlist()
      ])
      setReservations(Array.isArray(res.value) ? res.value : [])
      setWaitlist(Array.isArray(wl.value) ? wl.value : [])
    } catch (err) {
      console.error('Failed to load reservations:', err)
    } finally {
      setLoading(false)
    }
  }

  async function createReservation() {
    if (!form.customerName.trim()) return
    try {
      setError('')
      await window.api.pos.createRestaurantReservation({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || null,
        partySize: Number(form.partySize) || 2,
        reservationDate: form.date,
        reservationTime: form.time,
        durationMinutes: Number(form.duration) || 90,
        source: form.source,
        notes: form.notes.trim() || null
      })
      setShowForm(false)
      setForm({ customerName: '', customerPhone: '', partySize: '2', date: new Date().toISOString().slice(0, 10), time: '19:00', duration: '90', source: 'walk_in', notes: '' })
      await loadData()
    } catch (err) {
      console.error('Failed to create reservation:', err)
      setError(err.message || 'Could not create reservation. Please try again.')
    }
  }

  async function updateReservation(id, status) {
    try {
      setError('')
      if (status === 'cancelled') {
        await window.api.pos.cancelRestaurantReservation(id, 'Cancelled by staff')
      } else if (status === 'no_show') {
        await window.api.pos.markRestaurantReservationNoShow(id, 'No-show')
      } else {
        await window.api.pos.updateRestaurantReservation(id, { status })
      }
      await loadData()
    } catch (err) {
      console.error('Failed to update reservation:', err)
      setError(err.message || 'Could not update reservation. Please try again.')
    }
  }

  function openWhatsApp(reservation, kind = 'confirmation') {
    const phone = String(reservation.customer_phone || '').replace(/[^0-9]/g, '')
    if (!phone) return
    const time = reservation.reservation_time?.slice(0, 5) || 'your reserved time'
    const message = kind === 'ready'
      ? `Hello ${reservation.customer_name}, your table is ready at Boroko Restaurant. We look forward to welcoming you.`
      : `Hello ${reservation.customer_name}, this confirms your table reservation at Boroko Restaurant for ${reservation.reservation_date} at ${time} for ${reservation.party_size} guests. Please let us know if your plans change.`
    window.api.shell.openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`)
  }

  async function createWaitlistEntry() {
    if (!waitlistForm.customerName.trim()) return
    try {
      await window.api.pos.createRestaurantWaitlistEntry({
        customerName: waitlistForm.customerName.trim(),
        customerPhone: waitlistForm.customerPhone.trim() || null,
        partySize: Number(waitlistForm.partySize) || 2,
        notes: waitlistForm.notes.trim() || null
      })
      setShowWaitlistForm(false)
      setWaitlistForm({ customerName: '', customerPhone: '', partySize: '2', notes: '' })
      await loadData()
    } catch (err) {
      console.error('Failed to create waitlist entry:', err)
      setError(err.message || 'Could not add the party to the waitlist. Please try again.')
    }
  }

  const todayRes = reservations.filter(r => r.reservation_date === new Date().toISOString().slice(0, 10))
  const grouped = STATUSES.reduce((acc, s) => {
    acc[s] = todayRes.filter(r => r.status === s)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservations & Waitlist</h1>
          <p className="text-sm text-gray-500 mt-1">Manage table reservations and walk-in waitlist</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowWaitlistForm(true)} className="bb-btn-outline text-sm flex items-center gap-1.5">
            <Users size={14} /> Waitlist
          </button>
          <button onClick={() => setShowForm(true)} className="bb-btn-primary text-sm flex items-center gap-1.5">
            <Plus size={14} /> New Reservation
          </button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Waitlist */}
          {waitlist.length > 0 && (
            <div className="bb-card p-5">
              <h2 className="font-semibold text-sm text-gray-700 mb-3">Active Waitlist ({waitlist.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {waitlist.map(w => (
                  <div key={w.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{w.customer_name}</span>
                      <span className="text-xs text-amber-600">{w.party_size} pax</span>
                    </div>
                    {w.customer_phone && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                        <Phone size={10} /> {w.customer_phone}
                      </div>
                    )}
                    {w.quoted_wait_minutes && (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock size={10} /> ~{w.quoted_wait_minutes} min wait
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reservations by status */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {STATUSES.filter(s => !['cancelled', 'no_show'].includes(s)).map(s => (
              <div key={s} className="text-center">
                <div className={`text-2xl font-bold ${s === 'seated' ? 'text-purple-600' : s === 'confirmed' ? 'text-emerald-600' : 'text-gray-700'}`}>
                  {grouped[s]?.length || 0}
                </div>
                <div className="text-xs text-gray-500 capitalize">{s.replace('_', ' ')}</div>
              </div>
            ))}
          </div>

          {/* Reservation list */}
          <div className="space-y-3">
            {todayRes.length === 0 ? (
              <div className="bb-card p-12 text-center text-gray-500">
                <CalendarDays size={32} className="mx-auto mb-3 text-gray-300" />
                <p>No reservations today</p>
              </div>
            ) : todayRes.map(r => (
              <div key={r.id} className="bb-card p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center min-w-[60px]">
                    <div className="text-lg font-bold text-gray-800">{r.reservation_time?.slice(0, 5)}</div>
                    <div className="text-[10px] text-gray-400">{r.duration_minutes}min</div>
                  </div>
                  <div>
                    <div className="font-medium">{r.customer_name}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span className="flex items-center gap-1"><Users size={10} /> {r.party_size} pax</span>
                      {r.customer_phone && <span className="flex items-center gap-1"><Phone size={10} /> {r.customer_phone}</span>}
                    </div>
                    {r.notes && <div className="text-xs text-amber-600 mt-0.5">{r.notes}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100'}`}>
                    {r.status?.replace('_', ' ')}
                  </span>
                  {r.status === 'booked' && (
                    <>
                      <button onClick={() => updateReservation(r.id, 'confirmed')} className="text-xs text-emerald-600 hover:underline">Confirm</button>
                      <button onClick={() => updateReservation(r.id, 'cancelled')} className="text-xs text-red-500 hover:underline">Cancel</button>
                    </>
                  )}
                  {r.status === 'confirmed' && (
                    <>
                      <button onClick={() => updateReservation(r.id, 'seated')} className="text-xs text-purple-600 hover:underline">Seat</button>
                      <button onClick={() => updateReservation(r.id, 'cancelled')} className="text-xs text-red-500 hover:underline">Cancel</button>
                    </>
                  )}
                  {['booked', 'confirmed'].includes(r.status) && (
                    <button onClick={() => updateReservation(r.id, 'no_show')} className="text-xs text-orange-500 hover:underline">No Show</button>
                  )}
                  {r.customer_phone && !['cancelled', 'no_show', 'completed'].includes(r.status) && (
                    <button onClick={() => openWhatsApp(r, r.status === 'waiting' ? 'ready' : 'confirmation')} className="text-xs text-green-700 hover:underline inline-flex items-center gap-1"><MessageCircle size={12} /> WhatsApp</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Reservation Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">New Reservation</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Customer Name *</label>
                <input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} className="bb-input w-full mt-1" placeholder="Name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone</label>
                  <input value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Party Size *</label>
                  <input type="number" min="1" value={form.partySize} onChange={e => setForm({ ...form, partySize: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Time *</label>
                  <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Duration (min)</label>
                  <input type="number" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Source</label>
                  <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="bb-input w-full mt-1">
                    <option value="walk_in">Walk-in</option>
                    <option value="phone">Phone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="online">Online</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bb-input w-full mt-1" rows={2} placeholder="Special requests..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={createReservation} disabled={!form.customerName.trim()} className="bb-btn-primary flex-1">Create Reservation</button>
            </div>
          </div>
        </div>
      )}

      {/* Waitlist Modal */}
      {showWaitlistForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Add to Waitlist</h2>
              <button onClick={() => setShowWaitlistForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Customer Name *</label>
                <input value={waitlistForm.customerName} onChange={e => setWaitlistForm({ ...waitlistForm, customerName: e.target.value })} className="bb-input w-full mt-1" placeholder="Name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone</label>
                  <input value={waitlistForm.customerPhone} onChange={e => setWaitlistForm({ ...waitlistForm, customerPhone: e.target.value })} className="bb-input w-full mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Party Size *</label>
                  <input type="number" min="1" value={waitlistForm.partySize} onChange={e => setWaitlistForm({ ...waitlistForm, partySize: e.target.value })} className="bb-input w-full mt-1" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <input value={waitlistForm.notes} onChange={e => setWaitlistForm({ ...waitlistForm, notes: e.target.value })} className="bb-input w-full mt-1" placeholder="Special requests..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowWaitlistForm(false)} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={createWaitlistEntry} disabled={!waitlistForm.customerName.trim()} className="bb-btn-primary flex-1">Add to Waitlist</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
