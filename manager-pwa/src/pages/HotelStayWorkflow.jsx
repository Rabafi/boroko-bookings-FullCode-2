import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { completeHotelStayWorkflow, completeHotelWorkflowStep, getHotelWorkflowChecklist, listBookings } from '../lib/api'
import EmptyState from '../components/EmptyState'
import DataFreshness from '../components/DataFreshness'

/** @typedef {'checkin' | 'checkout'} HotelWorkflowDirection */
/** @typedef {{id: string, room_number?: string | null}} HotelWorkflowRoomExpectedView */
/** @typedef {{id: string, customer_name?: string | null, guest_name?: string | null, customer?: {name?: string | null} | null, room?: HotelWorkflowRoomExpectedView | null, check_in: string, check_out: string, status: string}} HotelWorkflowBookingExpectedView */
/** @typedef {{id: string, step_label: string, completed: boolean, required: boolean}} HotelWorkflowChecklistItemExpectedView */
/** @typedef {{items: HotelWorkflowChecklistItemExpectedView[], ready_to_check_in: boolean, ready_to_check_out: boolean}} HotelWorkflowChecklistExpectedView */
/** @param {HotelWorkflowBookingExpectedView} booking @returns {string} */
function guestName(booking) { return booking.customer_name || booking.guest_name || booking.customer?.name || 'Guest' }

export default function HotelStayWorkflow() {
  // AppShell renders this route only after its authenticated-user guard.
  const { user } = /** @type {{user: NonNullable<ReturnType<typeof useAuth>['user']>}} */ (useAuth())
  const [direction, setDirection] = useState(/** @type {HotelWorkflowDirection} */ ('checkin'))
  const [bookings, setBookings] = useState(/** @type {HotelWorkflowBookingExpectedView[]} */ ([]))
  const [selected, setSelected] = useState(/** @type {HotelWorkflowBookingExpectedView | null} */ (null))
  const [checklist, setChecklist] = useState(/** @type {HotelWorkflowChecklistExpectedView | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(/** @type {string | null} */ (null))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // listBookings can return persisted cache JSON without validation. This
      // is the existing booking view expected by this screen.
      const rows = /** @type {HotelWorkflowBookingExpectedView[]} */ (await listBookings(user.lodge_id, { forceFresh: true }))
      setBookings((rows || []).filter((booking) => direction === 'checkin' ? ['confirmed', 'pending'].includes(booking.status) : booking.status === 'checked_in'))
      setUpdatedAt(new Date().toISOString())
    } catch (loadError) { setError((/** @type {{message?: string} | null | undefined} */ (loadError))?.message || 'Hotel stays could not load.') } finally { setLoading(false) }
  }, [direction, user.lodge_id])

  useEffect(() => { setSelected(null); setChecklist(null); load() }, [load])

  /** @param {HotelWorkflowBookingExpectedView} booking */
  const selectStay = async (booking) => {
    setSelected(booking); setChecklist(null); setError('')
    try {
      // RPC JSON remains unvalidated; retain the page's expected view only.
      setChecklist(/** @type {HotelWorkflowChecklistExpectedView} */ (await getHotelWorkflowChecklist(user.lodge_id, booking.id, direction)))
    } catch (checklistError) { setError((/** @type {{message?: string} | null | undefined} */ (checklistError))?.message || 'Checklist could not load.') }
  }

  /** @param {string} stepId */
  const completeStep = async (stepId) => {
    setSaving(true); setError('')
    try { await completeHotelWorkflowStep(user.lodge_id, stepId, direction); setChecklist(/** @type {HotelWorkflowChecklistExpectedView} */ (await getHotelWorkflowChecklist(user.lodge_id, /** @type {HotelWorkflowBookingExpectedView} */ (selected).id, direction))) } catch (stepError) { setError((/** @type {{message?: string} | null | undefined} */ (stepError))?.message || 'Step could not be completed.') } finally { setSaving(false) }
  }

  const completeStay = async () => {
    setSaving(true); setError('')
    try { await completeHotelStayWorkflow(user.lodge_id, /** @type {HotelWorkflowBookingExpectedView} */ (selected).id, direction); setSelected(null); setChecklist(null); await load() } catch (completeError) { setError((/** @type {{message?: string} | null | undefined} */ (completeError))?.message || 'Stay could not be completed.') } finally { setSaving(false) }
  }

  /** @param {HotelWorkflowDirection} value */
  const tabClass = (value) => `flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${direction === value ? 'bg-amber-700 text-white' : 'bg-gray-800 text-gray-400'}`
  return <div className="min-h-screen bg-gray-950 pb-24"><header className="bg-gray-900 px-4 pb-4 pt-12"><div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold text-white">Check-in / Out</h1><p className="mt-1 text-xs text-gray-400">Server-authorized hotel stay workflow</p><DataFreshness updatedAt={updatedAt} loading={loading} error={error} className="mt-1" /></div><button type="button" onClick={load} className="rounded-full bg-white/5 p-2 text-gray-300"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button></div><div className="mt-4 flex gap-2"><button onClick={() => setDirection('checkin')} className={tabClass('checkin')}>Check-in</button><button onClick={() => setDirection('checkout')} className={tabClass('checkout')}>Check-out</button></div></header><main className="space-y-3 px-4 py-4">{error ? <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}{!selected && !loading && bookings.length === 0 ? <EmptyState icon={direction === 'checkin' ? LogIn : LogOut} title={`No stays ready for ${direction === 'checkin' ? 'check-in' : 'check-out'}`} message="Eligible hotel stays appear here from the live booking ledger." /> : null}{!selected && bookings.map((booking) => <button key={booking.id} type="button" onClick={() => selectStay(booking)} className="flex w-full items-center gap-3 rounded-2xl bg-gray-800 px-4 py-3 text-left"><div className="rounded-xl bg-amber-950/50 p-2 text-amber-300">{direction === 'checkin' ? <LogIn size={17} /> : <LogOut size={17} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{guestName(booking)}</p><p className="mt-1 text-xs text-gray-500">{booking.room?.room_number ? `Room ${booking.room.room_number}` : 'Room pending'} · {booking.check_in} – {booking.check_out}</p></div><ChevronRight size={16} className="text-gray-600" /></button>)}{selected ? <section className="rounded-2xl bg-gray-800 p-4"><button onClick={() => { setSelected(null); setChecklist(null) }} className="text-xs font-semibold text-amber-300">← Back to stays</button><h2 className="mt-3 text-base font-bold text-white">{guestName(selected)}</h2><p className="mt-1 text-xs text-gray-500">Complete the required checklist before final {direction === 'checkin' ? 'check-in' : 'check-out'}.</p><div className="mt-4 space-y-2">{(checklist?.items || []).map((item) => <button key={item.id} disabled={saving || item.completed} onClick={() => completeStep(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${item.completed ? 'bg-emerald-950/40 text-emerald-200' : 'bg-gray-900 text-white'}`}><CheckCircle2 size={17} /><span className="flex-1 text-sm font-medium">{item.step_label}</span><span className="text-xs">{item.completed ? 'Done' : item.required ? 'Required' : 'Optional'}</span></button>)}</div><button disabled={saving || !checklist?.ready_to_check_in && direction === 'checkin' || !checklist?.ready_to_check_out && direction === 'checkout'} onClick={completeStay} className="mt-4 w-full rounded-xl bg-amber-700 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : `Complete ${direction === 'checkin' ? 'check-in' : 'check-out'}`}</button></section> : null}</main></div>
}
