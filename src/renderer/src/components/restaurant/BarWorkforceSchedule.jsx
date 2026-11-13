// @ts-check
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccess, useAuth, useSettings } from '../../app-context'
import { canAccessCapability } from '../../../../shared/accessControl.js'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { ErrorNotice } from '../shared/ErrorNotice'
import { createBarLocalWorkforceScheduleApi } from './barLocalWorkforceScheduleApi.js'

const iso = (value) => value.toISOString().slice(0, 10)
const mondayOf = (value) => {
  const date = new Date(`${value}T12:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return iso(date)
}
const addDays = (value, amount) => {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return iso(date)
}
const initialForm = (date) => ({ staffId: '', date, label: 'Day shift', start: '10:00', end: '18:00', role: 'Bartender', notes: '' })

export default function BarWorkforceSchedule() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const access = useAccess()
  const localAuthority = user?.localAuthority === true || settings?.authority_mode === 'bar_local'
  const canManageLocal = canAccessCapability(access, 'staff.manage')
  const localScope = useMemo(() => ({
    businessId: String(settings?.lodge_id || user?.lodge_id || ''),
    outletId: String(settings?.outlet_id || ''),
    staffId: String(user?.id || '')
  }), [settings?.lodge_id, settings?.outlet_id, user?.id, user?.lodge_id])
  const localApi = useMemo(() => {
    if (!localAuthority) return null
    try { return createBarLocalWorkforceScheduleApi(window.api?.barLocal, localScope) }
    catch { return null }
  }, [localAuthority, localScope])
  const [weekStart, setWeekStart] = useState(() => mondayOf(iso(new Date())))
  const [rows, setRows] = useState([])
  const [staff, setStaff] = useState([])
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const weekEnd = addDays(weekStart, 6)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (localAuthority) {
        if (!localApi) throw new Error('The local Bar, outlet or operator scope could not be confirmed.')
        const snapshot = await localApi.load(window.localStorage, weekStart, weekEnd)
        setRows(snapshot.rows)
        setStaff(snapshot.staff)
        setPending(snapshot.pending)
        return
      }
      const [scheduleRows, users] = await Promise.all([
        window.api.staffScheduling.getScheduleRange(weekStart, weekEnd),
        window.api.users.getAll()
      ])
      setRows(Array.isArray(scheduleRows) ? scheduleRows : [])
      setStaff((Array.isArray(users) ? users : []).filter((user) => user.status !== 'suspended' && user.status !== 'inactive'))
    } catch (cause) {
      setError(cause?.message || 'Could not load the bar roster. Check the connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [localApi, localAuthority, weekEnd, weekStart])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    if (!form?.staffId || !form.date || !form.start || !form.end) return
    if (form.end <= form.start) {
      setError('Shift end time must be later than its start time.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (localAuthority) {
        if (!canManageLocal || !localApi) throw new Error('Your local staff-management permission or session could not be verified.')
        await localApi.schedule(window.localStorage, {
          staff_id: form.staffId, work_date: form.date, starts_at: form.start, ends_at: form.end,
          role_label: form.role, notes: form.notes
        })
        setForm(null)
        await load()
        return
      }
      const result = await window.api.staffScheduling.upsertSchedule(
        form.staffId, form.date, form.label.trim(), form.start, form.end, form.role.trim(), form.notes.trim()
      )
      if (result?.success === false) throw new Error(result.error || 'The shift could not be saved.')
      setForm(null)
      await load()
    } catch (cause) {
      setError(cause?.message || 'The shift could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`Remove ${row.staff_name || 'this staff member'} from ${row.schedule_date}?`)) return
    const cancelReason = localAuthority ? window.prompt('Why is this roster shift being cancelled?') : ''
    if (localAuthority && (cancelReason === null || !cancelReason.trim())) return
    setSaving(true)
    setError('')
    try {
      if (localAuthority) {
        if (!canManageLocal || !localApi) throw new Error('Your local staff-management permission or session could not be verified.')
        await localApi.cancel(window.localStorage, row, cancelReason)
        await load()
        return
      }
      const result = await window.api.staffScheduling.deleteEntry(row.id)
      if (result?.success === false) throw new Error(result.error || 'The roster entry could not be removed.')
      await load()
    } catch (cause) {
      setError(cause?.message || 'The roster entry could not be removed.')
    } finally {
      setSaving(false)
    }
  }

  const retryPending = async () => {
    if (!localAuthority || !localApi || !pending || saving) return
    setSaving(true); setError('')
    try { await localApi.retry(window.localStorage); await load() }
    catch (cause) { setError(cause?.message || 'The same saved roster operation remains unresolved.') }
    finally { setSaving(false) }
  }

  return <div className="space-y-4">
    <section className="bb-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><CalendarDays size={20}/>Weekly bar roster</h2><p className="mt-1 text-sm text-slate-500">Plan cashier, bartender and supervisor cover. Published entries are server-scoped to this business.</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="bb-btn-secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16}/>Previous</button>
          <button className="bb-btn-secondary" onClick={() => setWeekStart(mondayOf(iso(new Date())))}>This week</button>
          <button className="bb-btn-secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next<ChevronRight size={16}/></button>
          <button className="bb-btn-secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>Refresh</button>
        </div>
      </div>
      {error && <ErrorNotice className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</ErrorNotice>}
      {localAuthority && pending && <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">A roster change is unresolved. Retry the exact saved operation before making another change. <button className="ml-2 rounded bg-amber-800 px-3 py-1 font-semibold text-white" onClick={() => void retryPending()} disabled={saving}>Retry same operation</button></div>}
    </section>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      {days.map((date) => {
        const dayRows = rows.filter((row) => row.schedule_date === date)
        return <article key={date} className="bb-card min-h-48 p-3">
          <div className="mb-3 flex items-start justify-between gap-2"><div><strong className="block text-sm text-slate-900">{new Date(`${date}T12:00:00`).toLocaleDateString('en-BW', { weekday: 'short' })}</strong><small className="text-slate-500">{date}</small></div>{(!localAuthority || canManageLocal) && <button className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50" onClick={() => setForm(initialForm(date))} aria-label={`Add shift on ${date}`} disabled={Boolean(pending)}><Plus size={17}/></button>}</div>
          {loading ? <p className="text-xs text-slate-400">Loading…</p> : dayRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">No one rostered.</p> : <div className="space-y-2">{dayRows.map((row) => <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs"><div className="flex items-start justify-between gap-2"><strong className="text-slate-800">{row.staff_name}</strong>{(!localAuthority || canManageLocal) && <button className="text-slate-400 hover:text-red-600" onClick={() => remove(row)} disabled={saving || Boolean(pending)} aria-label="Remove roster entry"><Trash2 size={13}/></button>}</div><p className="mt-1 font-semibold text-emerald-700">{String(row.start_time || '').slice(0,5)}–{String(row.end_time || '').slice(0,5)}</p><p className="mt-1 text-slate-500">{row.role_at_shift || row.shift_label || 'Bar shift'}</p></div>)}</div>}
        </article>
      })}
    </section>

    {form && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="Add roster shift"><form onSubmit={save} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-xl font-black text-slate-900">Add bar shift</h2><p className="text-sm text-slate-500">Times are validated before the roster is saved.</p></div><button type="button" onClick={() => setForm(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2 text-xs font-bold text-slate-600">Staff member<select required className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}><option value="">Choose staff member</option>{staff.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Date<input required type="date" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}/></label><label className="text-xs font-bold text-slate-600">Shift label<input required className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}/></label><label className="text-xs font-bold text-slate-600">Starts<input required type="time" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}/></label><label className="text-xs font-bold text-slate-600">Ends<input required type="time" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })}/></label><label className="sm:col-span-2 text-xs font-bold text-slate-600">Role on shift<select className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{['Bartender','Cashier','Bar supervisor','Stock controller','Owner / manager'].map((role) => <option key={role}>{role}</option>)}</select></label><label className="sm:col-span-2 text-xs font-bold text-slate-600">Notes<textarea rows="2" className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label></div><button className="bb-btn-primary mt-5 w-full justify-center" disabled={saving || !form.staffId || (localAuthority && (Boolean(pending) || !canManageLocal))}>{saving ? 'Saving…' : 'Save roster shift'}</button></form></div>}
  </div>
}
