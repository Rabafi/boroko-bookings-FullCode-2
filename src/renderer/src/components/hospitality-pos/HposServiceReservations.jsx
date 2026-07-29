import { useCallback, useEffect, useState } from 'react'
import { Check, Edit3, ListPlus, RefreshCw, Trash2, Users, X } from 'lucide-react'
import { HposButton, HposNotice, HposPageHero } from './HposUi'
import { useAccess } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl'

const blank = { customerName: '', customerPhone: '', partySize: '2', quotedWaitMinutes: '20', notes: '' }
const reservationBlank = () => ({ customerName: '', customerPhone: '', partySize: '2', date: new Date().toLocaleDateString('en-CA'), time: '19:00', duration: '90', notes: '' })
const activeReservationStatuses = ['cancelled', 'completed', 'no_show', 'seated']

export default function HposServiceReservations() {
  const access = useAccess()
  const canRunService = canAccessCapability(access, 'pos.service')
  const [reservations, setReservations] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  const [reservationDraft, setReservationDraft] = useState(reservationBlank)
  const [reservationOpen, setReservationOpen] = useState(false)
  const [reservationFull, setReservationFull] = useState(false)
  const [draft, setDraft] = useState(blank)
  const [tableChoice, setTableChoice] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const day = new Date().toLocaleDateString('en-CA')
      const [reservationRows, waitlistRows, tableRows] = await Promise.all([
        window.api?.pos?.getRestaurantReservations?.(day, day),
        window.api?.pos?.getRestaurantWaitlist?.(undefined, true),
        window.api?.pos?.getTablesWithStatus?.()
      ])
      setReservations(Array.isArray(reservationRows) ? reservationRows : [])
      setWaitlist(Array.isArray(waitlistRows) ? waitlistRows : [])
      setTables(Array.isArray(tableRows) ? tableRows.filter((row) => row.status === 'available') : [])
    } catch (cause) {
      setError(cause?.message || 'Could not refresh guest flow.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 15000)
    return () => clearInterval(timer)
  }, [load])

  const openWalkIn = (entry = {}) => {
    setEditing(entry)
    setDraft({
      customerName: entry.customer_name || '', customerPhone: entry.customer_phone || '',
      partySize: String(entry.party_size || 2), quotedWaitMinutes: String(entry.quoted_wait_minutes || 20), notes: entry.notes || ''
    })
  }

  const saveReservation = async () => {
    if (!reservationDraft.customerName.trim()) return setError('Guest name is required.')
    setBusy('reservation-save')
    setError('')
    try {
      const result = await window.api.pos.createRestaurantReservation({
        customer_name: reservationDraft.customerName.trim(), customer_phone: reservationDraft.customerPhone.trim() || null,
        party_size: Number(reservationDraft.partySize), reservation_date: reservationDraft.date,
        reservation_time: reservationDraft.time, duration_minutes: Number(reservationDraft.duration), source: 'phone', notes: reservationDraft.notes.trim() || null
      })
      if (result?.success === false && result.code === 'reservation_capacity_full') {
        setReservationFull(true)
        return setNotice(`${result.message} Add the caller to the reservation waitlist instead.`)
      }
      if (result?.success === false) throw new Error(result.error || 'Could not create the reservation.')
      setReservationOpen(false); setReservationFull(false); setReservationDraft(reservationBlank())
      setNotice('Phone reservation created for the shared guest list.')
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not create the reservation.')
    } finally {
      setBusy('')
    }
  }

  const addReservationWaitlist = async () => {
    setBusy('reservation-waitlist-save')
    setError('')
    try {
      const result = await window.api.pos.createRestaurantWaitlistEntry({
        customer_name: reservationDraft.customerName.trim(), customer_phone: reservationDraft.customerPhone.trim() || null,
        party_size: Number(reservationDraft.partySize), notes: reservationDraft.notes.trim() || null,
        waitlist_type: 'reservation', requested_reservation_date: reservationDraft.date,
        requested_reservation_time: reservationDraft.time, requested_duration_minutes: Number(reservationDraft.duration)
      })
      if (result?.success === false) throw new Error(result.error || 'Could not add the reservation waitlist request.')
      setReservationOpen(false); setReservationFull(false); setReservationDraft(reservationBlank())
      setNotice('Caller added to the shared reservation waitlist. The on-duty team can offer an opening.')
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not add the reservation waitlist request.')
    } finally {
      setBusy('')
    }
  }

  const saveWaitlist = async () => {
    if (!draft.customerName.trim()) return setError('Guest name is required.')
    setBusy('waitlist-save')
    setError('')
    try {
      const payload = { customer_name: draft.customerName.trim(), customer_phone: draft.customerPhone.trim() || null, party_size: Number(draft.partySize), quoted_wait_minutes: Number(draft.quotedWaitMinutes), notes: draft.notes.trim() || null }
      const result = editing?.id
        ? await window.api.pos.updateRestaurantWaitlistEntry(editing.id, payload)
        : await window.api.pos.createRestaurantWaitlistEntry(payload)
      if (result?.success === false) throw new Error(result.error)
      setNotice(editing?.id ? 'Walk-in updated and recorded.' : 'Party added to the live waitlist.')
      setEditing(null)
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not save the walk-in.')
    } finally {
      setBusy('')
    }
  }

  const seat = async (kind, entry) => {
    const tableId = tableChoice[`${kind}:${entry.id}`]
    if (!tableId) return setError('Choose an available table first.')
    setBusy(entry.id)
    setError('')
    try {
      const result = kind === 'reservation'
        ? await window.api.pos.serviceRestaurantReservationAction(entry.id, 'seated', [tableId])
        : await window.api.pos.seatRestaurantWaitlistEntry(entry.id, tableId)
      if (result?.success === false) throw new Error(result.error)
      setNotice(`${entry.customer_name} was seated.`)
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not seat this party.')
    } finally {
      setBusy('')
    }
  }

  const reservationAction = async (entry, action) => {
    setBusy(entry.id)
    setError('')
    try {
      const result = await window.api.pos.serviceRestaurantReservationAction(entry.id, action, [])
      if (result?.success === false) throw new Error(result.error)
      setNotice(`${entry.customer_name} marked ${action.replace('_', ' ')}.`)
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not update this reservation.')
    } finally {
      setBusy('')
    }
  }

  const remove = async (entry) => {
    const reason = window.prompt(`Remove ${entry.customer_name} from the waitlist. This is recorded; it is not deleted.`, 'Guest left')
    if (!reason?.trim()) return
    setBusy(entry.id)
    setError('')
    try {
      const result = await window.api.pos.removeRestaurantWaitlistEntry(entry.id, reason.trim())
      if (result?.success === false) throw new Error(result.error)
      setNotice(`${entry.customer_name} was removed from the live list with a recorded reason.`)
      await load()
    } catch (cause) {
      setError(cause?.message || 'Could not remove this walk-in.')
    } finally {
      setBusy('')
    }
  }

  const select = (key) => <select className="rounded-lg border border-[#d9ccd3] bg-white px-2 py-2 text-sm font-medium text-[#342d31]" value={tableChoice[key] || ''} onChange={(event) => setTableChoice({ ...tableChoice, [key]: event.target.value })}>
    <option value="">Choose table…</option>
    {tables.map((table) => <option key={table.id} value={table.id}>{table.name || table.table_number}</option>)}
  </select>
  const activeReservations = reservations.filter((entry) => !activeReservationStatuses.includes(entry.status))
  const liveWaitlist = waitlist.filter((entry) => entry.waitlist_type !== 'reservation')
  const reservationWaitlist = waitlist.filter((entry) => entry.waitlist_type === 'reservation')

  return <div className="hpos-page-frame">
    <HposPageHero eyebrow="Front-of-house service" title="Reservations & waitlist" description="Create phone reservations for the shared guest list, manage arrivals and add walk-ins. Table setup and policy remain in Manage." actions={<div className="flex gap-2"><HposButton icon={RefreshCw} onClick={load} disabled={loading}>Refresh</HposButton>{canRunService && <><HposButton onClick={() => { setReservationDraft(reservationBlank()); setReservationFull(false); setReservationOpen(true) }}>Add reservation</HposButton><HposButton tone="primary" icon={ListPlus} onClick={() => openWalkIn()}>Add walk-in</HposButton></>}</div>} />
    {!canRunService && <HposNotice tone="error">Your role can view guest flow but cannot change reservations or the waitlist.</HposNotice>}
    {error && <HposNotice tone="error">{error}</HposNotice>}
    {notice && <HposNotice>{notice}</HposNotice>}

    <section className="mt-5 rounded-[18px] border border-[#e5d9df] bg-[#fffdfb] p-5 shadow-[0_10px_28px_rgba(57,38,46,.07)]">
      <h2 className="flex items-center gap-2 text-lg font-bold text-[#352a31]"><Users size={18} />Live waitlist ({liveWaitlist.length})</h2>
      <p className="mt-1 text-sm text-[#665860]">Edit guest details before seating. Removing a guest records why they left; it never deletes history.</p>
      <div className="mt-4 space-y-3">
        {liveWaitlist.length ? liveWaitlist.map((entry) => <article key={entry.id} className="rounded-[14px] border border-[#eadde3] bg-[#fff8f5] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><strong className="text-[#342b31]">{entry.customer_name}</strong><p className="text-sm text-[#5e535a]">{entry.party_size} guests · quoted {entry.quoted_wait_minutes || '—'} min · {entry.customer_phone || 'No phone'}</p>{entry.notes && <p className="mt-1 text-xs text-[#70636a]">{entry.notes}</p>}</div>
            {canRunService && <div className="flex flex-wrap gap-2">{select(`waitlist:${entry.id}`)}<button onClick={() => seat('waitlist', entry)} disabled={busy === entry.id} className="rounded-lg bg-[#376d5b] px-3 py-2 text-sm font-semibold text-white"><Check size={14} className="mr-1 inline" />Seat</button><button onClick={() => openWalkIn(entry)} className="rounded-lg bg-[#f4ece8] px-3 py-2 text-sm font-semibold text-[#4f3c48]" title="Edit walk-in details"><Edit3 size={14} className="mr-1 inline" />Edit</button><button onClick={() => remove(entry)} className="rounded-lg bg-[#fff0eb] px-3 py-2 text-sm font-semibold text-[#a84430]" title="Record why this guest left; history is retained"><Trash2 size={14} className="mr-1 inline" />Remove</button></div>}
          </div>
        </article>) : <p className="py-5 text-center text-sm text-[#665860]">No parties waiting right now.</p>}
      </div>
    </section>

    {reservationWaitlist.length > 0 && <section className="mt-5 rounded-[18px] border border-[#e5d9df] bg-[#fffdfb] p-5 shadow-[0_10px_28px_rgba(57,38,46,.07)]"><h2 className="text-lg font-bold text-[#352a31]">Reservation waitlist ({reservationWaitlist.length})</h2><p className="mt-1 text-sm text-[#665860]">These callers requested a full slot. This is a shared house list, not a promise of a table.</p><div className="mt-4 space-y-3">{reservationWaitlist.map((entry) => <article key={entry.id} className="rounded-[14px] border border-[#eadde3] bg-[#fff8f5] p-4"><strong className="text-[#342b31]">{entry.customer_name}</strong><p className="text-sm text-[#5e535a]">{entry.requested_reservation_date} · {entry.requested_reservation_time?.slice(0, 5)} · {entry.party_size} guests · {entry.customer_phone || 'No phone'}</p>{entry.notes && <p className="mt-1 text-xs text-[#70636a]">{entry.notes}</p>}</article>)}</div></section>}

    <section className="mt-5 rounded-[18px] border border-[#e5d9df] bg-[#fffdfb] p-5 shadow-[0_10px_28px_rgba(57,38,46,.07)]">
      <h2 className="text-lg font-bold text-[#352a31]">Today’s reservations</h2>
      <div className="mt-4 space-y-3">
        {activeReservations.length ? activeReservations.map((entry) => <article key={entry.id} className="rounded-[14px] border border-[#eadde3] bg-[#fff8f5] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-[#342b31]">{entry.reservation_time?.slice(0, 5)} · {entry.customer_name}</strong><p className="text-sm text-[#5e535a]">{entry.party_size} guests · {entry.status}</p></div>
            {canRunService && <div className="flex flex-wrap gap-2">{select(`reservation:${entry.id}`)}<button onClick={() => seat('reservation', entry)} disabled={busy === entry.id} className="rounded-lg bg-[#376d5b] px-3 py-2 text-sm font-semibold text-white">Seat</button>{entry.status === 'booked' && <button onClick={() => reservationAction(entry, 'confirmed')} className="rounded-lg bg-[#f4ece8] px-3 py-2 text-sm font-semibold text-[#4f3c48]">Confirm arrival</button>}<button onClick={() => reservationAction(entry, 'no_show')} className="rounded-lg bg-[#f4ece8] px-3 py-2 text-sm font-semibold text-[#4f3c48]">No-show</button></div>}
          </div>
        </article>) : <p className="py-5 text-center text-sm text-[#665860]">No active reservations today.</p>}
      </div>
    </section>

    {editing && <div className="hpos-modal-backdrop"><section className="hpos-service-dialog" role="dialog" aria-modal="true"><button onClick={() => setEditing(null)} className="hpos-service-dialog__close"><X size={18} /></button><p className="hpos-eyebrow">Live guest flow</p><h2>{editing.id ? 'Edit walk-in' : 'Add to waitlist'}</h2><div className="hpos-service-form"><label>Guest name<input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} /></label><label>Phone<input value={draft.customerPhone} onChange={(event) => setDraft({ ...draft, customerPhone: event.target.value })} /></label><label>Party size<input type="number" min="1" value={draft.partySize} onChange={(event) => setDraft({ ...draft, partySize: event.target.value })} /></label><label>Quoted wait (minutes)<input type="number" min="1" value={draft.quotedWaitMinutes} onChange={(event) => setDraft({ ...draft, quotedWaitMinutes: event.target.value })} /></label><label>Notes<input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label></div><footer><HposButton onClick={() => setEditing(null)}>Cancel</HposButton><HposButton tone="primary" onClick={saveWaitlist} disabled={busy === 'waitlist-save'}>{busy === 'waitlist-save' ? 'Saving…' : 'Save walk-in'}</HposButton></footer></section></div>}
    {reservationOpen && <div className="hpos-modal-backdrop"><section className="hpos-service-dialog" role="dialog" aria-modal="true"><button onClick={() => setReservationOpen(false)} className="hpos-service-dialog__close"><X size={18} /></button><p className="hpos-eyebrow">Phone booking</p><h2>Add reservation</h2><p className="mt-1 text-sm text-[#665860]">Reservations belong to the shared guest list. The team on duty assigns the table and server at arrival.</p><div className="hpos-service-form"><label>Guest name<input value={reservationDraft.customerName} onChange={(event) => setReservationDraft({ ...reservationDraft, customerName: event.target.value })} /></label><label>Phone<input value={reservationDraft.customerPhone} onChange={(event) => setReservationDraft({ ...reservationDraft, customerPhone: event.target.value })} /></label><label>Party size<input type="number" min="1" value={reservationDraft.partySize} onChange={(event) => setReservationDraft({ ...reservationDraft, partySize: event.target.value })} /></label><label>Date<input type="date" min={new Date().toLocaleDateString('en-CA')} value={reservationDraft.date} onChange={(event) => setReservationDraft({ ...reservationDraft, date: event.target.value })} /></label><label>Time<input type="time" value={reservationDraft.time} onChange={(event) => setReservationDraft({ ...reservationDraft, time: event.target.value })} /></label><label>Duration (minutes)<input type="number" min="15" step="15" value={reservationDraft.duration} onChange={(event) => setReservationDraft({ ...reservationDraft, duration: event.target.value })} /></label><label>Notes<input value={reservationDraft.notes} onChange={(event) => setReservationDraft({ ...reservationDraft, notes: event.target.value })} /></label></div>{reservationFull && <HposNotice tone="error">That slot is full. You can save this caller to the reservation waitlist; it is not a confirmed booking.</HposNotice>}<footer><HposButton onClick={() => setReservationOpen(false)}>Cancel</HposButton>{reservationFull ? <HposButton tone="primary" onClick={addReservationWaitlist} disabled={busy === 'reservation-waitlist-save'}>{busy === 'reservation-waitlist-save' ? 'Saving…' : 'Add to reservation waitlist'}</HposButton> : <HposButton tone="primary" onClick={saveReservation} disabled={busy === 'reservation-save'}>{busy === 'reservation-save' ? 'Checking…' : 'Create reservation'}</HposButton>}</footer></section></div>}
  </div>
}
