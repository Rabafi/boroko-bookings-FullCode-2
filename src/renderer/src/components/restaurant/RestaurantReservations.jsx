import { useState, useEffect } from 'react'
import { Plus, X, Clock, Users, Phone, CalendarDays, MessageCircle, Check, Armchair, CircleOff, Edit3, Trash2 } from 'lucide-react'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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

function ReservationTablePicker({ reservationId, tables, selectedIds, onChange }) {
  const selected = Array.isArray(selectedIds) ? selectedIds : []
  const selectedSeats = tables
    .filter((table) => selected.includes(table.id))
    .reduce((total, table) => total + Number(table.seats || 0), 0)
  const toggleTable = (tableId) => onChange(
    selected.includes(tableId)
      ? selected.filter((id) => id !== tableId)
      : [...selected, tableId]
  )
  return <fieldset className="restaurant-reservation-table-picker">
    <legend>Seat at table(s)</legend>
    <div>{tables.map((table) => <label key={table.id}><input type="checkbox" checked={selected.includes(table.id)} onChange={() => toggleTable(table.id)} /> {table.table_number || table.name} <small>{table.seats || 0} seats</small></label>)}</div>
    <small>{selected.length ? `${selected.length} table${selected.length === 1 ? '' : 's'} selected · ${selectedSeats} seats` : 'Select one or more tables. Combine tables only when the party needs the capacity.'}</small>
  </fieldset>
}

export default function RestaurantReservations() {
  const [reservations, setReservations] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(localDateKey())
  const [showForm, setShowForm] = useState(false)
  const [showWaitlistForm, setShowWaitlistForm] = useState(false)
  const [editingWaitlist, setEditingWaitlist] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [tableChoice, setTableChoice] = useState({})
  const [form, setForm] = useState({ customerName: '', customerPhone: '', partySize: '2', date: localDateKey(), time: '19:00', duration: '90', source: 'walk_in', notes: '' })
  const [waitlistForm, setWaitlistForm] = useState({ customerName: '', customerPhone: '', partySize: '2', quotedWaitMinutes: '20', notes: '' })

  useEffect(() => { loadData(selectedDate) }, [selectedDate])

  async function loadData(date = selectedDate) {
    try {
      setLoading(true)
      setError('')
      const [res, wl, tableRows] = await Promise.allSettled([
        window.api.pos.getRestaurantReservations(date, date),
        window.api.pos.getRestaurantWaitlist(),
        window.api.pos.getTablesWithStatus()
      ])
      setReservations(Array.isArray(res.value) ? res.value : [])
      setWaitlist(Array.isArray(wl.value) ? wl.value : [])
      setTables(Array.isArray(tableRows.value) ? tableRows.value : [])
      if ([res, wl, tableRows].some(result => result.status === 'rejected')) setError('Some floor information could not be refreshed. Try again before seating a party.')
    } catch (err) {
      console.error('Failed to load reservations:', err)
      setError(err.message || 'Could not load reservations and waitlist.')
    } finally {
      setLoading(false)
    }
  }

  async function createReservation() {
    if (!form.customerName.trim()) return
    try {
      setError('')
      setNotice('')
      setBusyId('reservation-create')
      const result = await window.api.pos.createRestaurantReservation({
        customer_name: form.customerName.trim(),
        customer_phone: form.customerPhone.trim() || null,
        party_size: Number(form.partySize) || 2,
        reservation_date: form.date,
        reservation_time: form.time,
        duration_minutes: Number(form.duration) || 90,
        source: form.source,
        notes: form.notes.trim() || null
      })
      if (result?.success === false) throw new Error(result.error || 'Could not create reservation.')
      setShowForm(false)
      setSelectedDate(form.date)
      setForm({ customerName: '', customerPhone: '', partySize: '2', date: form.date, time: '19:00', duration: '90', source: 'walk_in', notes: '' })
      setNotice('Reservation created.')
      await loadData(form.date)
    } catch (err) {
      console.error('Failed to create reservation:', err)
      setError(err.message || 'Could not create reservation. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function updateReservation(id, status) {
    try {
      setError('')
      setNotice('')
      setBusyId(id)
      if (status === 'cancelled') {
        await window.api.pos.cancelRestaurantReservation(id, 'Cancelled by staff')
      } else if (status === 'no_show') {
        await window.api.pos.markRestaurantReservationNoShow(id, 'No-show')
      } else {
        const result = await window.api.pos.updateRestaurantReservation(id, { status })
        if (result?.success === false) throw new Error(result.error || 'Could not update reservation.')
      }
      setNotice(`Reservation marked ${status.replace('_', ' ')}.`)
      await loadData(selectedDate)
    } catch (err) {
      console.error('Failed to update reservation:', err)
      setError(err.message || 'Could not update reservation. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function openWhatsApp(reservation, kind = 'confirmation') {
    const phone = String(reservation.customer_phone || '').replace(/[^0-9]/g, '')
    if (!phone) return
    const time = reservation.reservation_time?.slice(0, 5) || 'your reserved time'
    const message = kind === 'ready'
      ? `Hello ${reservation.customer_name}, your table is ready. We look forward to welcoming you.`
      : `Hello ${reservation.customer_name}, this confirms your table reservation for ${reservation.reservation_date} at ${time} for ${reservation.party_size} guests. Please let us know if your plans change.`
    window.api.shell.openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`)
  }

  async function createWaitlistEntry() {
    if (!waitlistForm.customerName.trim()) return
    try {
      setBusyId('waitlist-create')
      setError('')
      setNotice('')
      const payload = {
        customer_name: waitlistForm.customerName.trim(),
        customer_phone: waitlistForm.customerPhone.trim() || null,
        party_size: Number(waitlistForm.partySize) || 2,
        quoted_wait_minutes: Number(waitlistForm.quotedWaitMinutes) || null,
        notes: waitlistForm.notes.trim() || null
      }
      const result = editingWaitlist
        ? await window.api.pos.updateRestaurantWaitlistEntry(editingWaitlist.id, payload)
        : await window.api.pos.createRestaurantWaitlistEntry(payload)
      if (result?.success === false) throw new Error(result.error || 'Could not save the waitlist entry.')
      setShowWaitlistForm(false)
      setEditingWaitlist(null)
      setWaitlistForm({ customerName: '', customerPhone: '', partySize: '2', quotedWaitMinutes: '20', notes: '' })
      setNotice(editingWaitlist ? 'Walk-in updated and recorded.' : 'Party added to the active waitlist.')
      await loadData(selectedDate)
    } catch (err) {
      console.error('Failed to create waitlist entry:', err)
      setError(err.message || 'Could not save the waitlist entry. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function openEditWaitlist(entry) {
    setEditingWaitlist(entry)
    setWaitlistForm({
      customerName: entry.customer_name || '',
      customerPhone: entry.customer_phone || '',
      partySize: String(entry.party_size || 2),
      quotedWaitMinutes: String(entry.quoted_wait_minutes || 20),
      notes: entry.notes || ''
    })
    setShowWaitlistForm(true)
  }

  async function removeWaitlistEntry(entry) {
    const reason = window.prompt(`Remove ${entry.customer_name} from the waitlist. This is recorded and does not delete history.`, 'Guest left')
    if (!reason?.trim()) return
    try {
      setBusyId(entry.id)
      setError('')
      setNotice('')
      const result = await window.api.pos.removeRestaurantWaitlistEntry(entry.id, reason.trim())
      if (result?.success === false) throw new Error(result.error || 'Could not remove this walk-in.')
      setNotice('Walk-in removed from the live waitlist with the reason recorded.')
      await loadData(selectedDate)
    } catch (err) {
      setError(err.message || 'Could not remove this walk-in. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function seatParty(kind, id) {
    const selectedTables = tableChoice[id]
    const selectedTableIds = Array.isArray(selectedTables) ? selectedTables : selectedTables ? [selectedTables] : []
    if (selectedTableIds.length === 0) return
    try {
      setBusyId(id)
      setError('')
      setNotice('')
      const result = kind === 'waitlist'
        ? await window.api.pos.seatRestaurantWaitlistEntry(id, selectedTableIds[0])
        : await window.api.pos.seatRestaurantReservation(id, selectedTableIds)
      if (result?.success === false) throw new Error(result.error || 'Could not seat party.')
      setNotice('Party seated and table assignment recorded.')
      setTableChoice(current => ({ ...current, [id]: '' }))
      await loadData(selectedDate)
    } catch (err) {
      setError(err.message || 'Could not seat party.')
    } finally {
      setBusyId(null)
    }
  }

  const todayRes = reservations.filter(r => r.reservation_date === selectedDate)
  const grouped = STATUSES.reduce((acc, s) => {
    acc[s] = todayRes.filter(r => r.status === s)
    return acc
  }, {})
  const availableTables = tables.filter(table => !table.status || table.status === 'available' || table.status === 'reserved')

  return (
    <div className="restaurant-native-page">
      <div className="restaurant-native-hero">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reservations & Waitlist</h1>
          <p className="text-sm text-gray-500 mt-1">Manage table reservations and walk-in waitlist</p>
        </div>
        <div className="restaurant-reservation-hero-actions">
          <label className="restaurant-reservation-date-control">
            <CalendarDays size={14} />
            <span>Service date</span>
            <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="min-h-0 border-0 bg-transparent p-0" />
          </label>
          <button type="button" onClick={() => { setEditingWaitlist(null); setWaitlistForm({ customerName: '', customerPhone: '', partySize: '2', quotedWaitMinutes: '20', notes: '' }); setShowWaitlistForm(true) }} className="restaurant-reservation-hero-button is-waitlist">
            <Users size={14} /> Waitlist
          </button>
          <button type="button" onClick={() => setShowForm(true)} className="restaurant-reservation-hero-button is-create">
            <Plus size={14} /> New Reservation
          </button>
        </div>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

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
                    <div className="mt-3 flex flex-wrap gap-2">
                      <select value={tableChoice[w.id] || ''} onChange={event => setTableChoice(current => ({ ...current, [w.id]: event.target.value }))} className="bb-input min-w-[130px] flex-1 text-xs">
                        <option value="">Choose table</option>
                        {availableTables.map(table => <option key={table.id} value={table.id}>Table {table.table_number || table.name}</option>)}
                      </select>
                      <button type="button" onClick={() => seatParty('waitlist', w.id)} disabled={!tableChoice[w.id] || busyId === w.id} className="restaurant-reservation-action is-seat"><Armchair size={13} />{busyId === w.id ? 'Seating…' : 'Seat'}</button>
                      {w.customer_phone && <button type="button" onClick={() => openWhatsApp(w, 'ready')} className="restaurant-reservation-action is-whatsapp" title="Tell the customer their table is ready"><MessageCircle size={13} /> WhatsApp</button>}
                      <button type="button" onClick={() => openEditWaitlist(w)} disabled={busyId === w.id} className="restaurant-reservation-action" title="Edit walk-in details"><Edit3 size={13} /> Edit walk-in</button>
                      <button type="button" onClick={() => removeWaitlistEntry(w)} disabled={busyId === w.id} className="restaurant-reservation-action is-cancel" title="Record why this guest left; history is retained"><Trash2 size={13} /> Remove from waitlist</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reservations by status */}
          <div className="restaurant-native-kpis">
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
              <div className="restaurant-native-empty">
                <CalendarDays size={32} className="mx-auto mb-3 text-gray-300" />
                <p>No reservations for {new Date(`${selectedDate}T12:00:00`).toLocaleDateString()}</p>
              </div>
            ) : todayRes.map(r => (
              <div key={r.id} className="bb-card restaurant-reservation-card">
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
                <div className="restaurant-reservation-actions">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100'}`}>
                    {r.status?.replace('_', ' ')}
                  </span>
                  {r.status === 'booked' && (
                    <>
                      <button type="button" onClick={() => updateReservation(r.id, 'confirmed')} disabled={busyId === r.id} className="restaurant-reservation-action is-confirm"><Check size={13} />{busyId === r.id ? 'Saving…' : 'Confirm'}</button>
                      <button type="button" onClick={() => updateReservation(r.id, 'cancelled')} disabled={busyId === r.id} className="restaurant-reservation-action is-cancel"><CircleOff size={13} /> Cancel</button>
                    </>
                  )}
                  {r.status === 'confirmed' && (
                    <>
                      <ReservationTablePicker reservationId={r.id} tables={availableTables} selectedIds={tableChoice[r.id]} onChange={(ids) => setTableChoice(current => ({ ...current, [r.id]: ids }))} />
                      <button type="button" onClick={() => seatParty('reservation', r.id)} disabled={!Array.isArray(tableChoice[r.id]) || tableChoice[r.id].length === 0 || busyId === r.id} className="restaurant-reservation-action is-seat"><Armchair size={13} />{busyId === r.id ? 'Seating…' : 'Seat'}</button>
                      <button type="button" onClick={() => updateReservation(r.id, 'cancelled')} disabled={busyId === r.id} className="restaurant-reservation-action is-cancel"><CircleOff size={13} /> Cancel</button>
                    </>
                  )}
                  {r.status === 'seated' && <button type="button" onClick={() => updateReservation(r.id, 'completed')} disabled={busyId === r.id} className="restaurant-reservation-action is-confirm"><Check size={13} />{busyId === r.id ? 'Saving…' : 'Complete'}</button>}
                  {['booked', 'confirmed'].includes(r.status) && (
                    <button type="button" onClick={() => updateReservation(r.id, 'no_show')} disabled={busyId === r.id} className="restaurant-reservation-action is-no-show">No show</button>
                  )}
                  {r.customer_phone && !['cancelled', 'no_show', 'completed'].includes(r.status) && (
                    <button type="button" onClick={() => openWhatsApp(r, r.status === 'waiting' ? 'ready' : 'confirmation')} className="restaurant-reservation-action is-whatsapp"><MessageCircle size={13} /> WhatsApp</button>
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
              <button onClick={createReservation} disabled={!form.customerName.trim() || busyId === 'reservation-create'} className="bb-btn-primary flex-1">{busyId === 'reservation-create' ? 'Creating…' : 'Create Reservation'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Waitlist Modal */}
      {showWaitlistForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{editingWaitlist ? 'Edit Walk-in' : 'Add to Waitlist'}</h2>
              <button onClick={() => { setShowWaitlistForm(false); setEditingWaitlist(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
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
                <label className="text-xs font-medium text-gray-600">Quoted wait (minutes)</label>
                <input type="number" min="1" value={waitlistForm.quotedWaitMinutes} onChange={e => setWaitlistForm({ ...waitlistForm, quotedWaitMinutes: e.target.value })} className="bb-input w-full mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Notes</label>
                <input value={waitlistForm.notes} onChange={e => setWaitlistForm({ ...waitlistForm, notes: e.target.value })} className="bb-input w-full mt-1" placeholder="Special requests..." />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowWaitlistForm(false); setEditingWaitlist(null) }} className="bb-btn-outline flex-1">Cancel</button>
              <button onClick={createWaitlistEntry} disabled={!waitlistForm.customerName.trim() || busyId === 'waitlist-create'} className="bb-btn-primary flex-1">{busyId === 'waitlist-create' ? 'Saving…' : editingWaitlist ? 'Save Walk-in' : 'Add to Waitlist'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
