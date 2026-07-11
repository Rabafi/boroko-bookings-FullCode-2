import { useCallback, useEffect, useState } from 'react'
import { Calendar, AlertTriangle, RefreshCw, Tag, Save, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useSettings } from '../app-context'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay()
  const days = []
  for (let i = 0; i < startPad; i++) days.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d)
  return days
}

export default function RateCalendar() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [roomTypes, setRoomTypes] = useState([])
  const [selectedRoomType, setSelectedRoomType] = useState('')
  const [calendarData, setCalendarData] = useState({ entries: [], restrictions: [] })
  const [seasonLabels, setSeasonLabels] = useState([])
  const [promoCodes, setPromoCodes] = useState([])
  const [conflicts, setConflicts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editCell, setEditCell] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [showSeasonModal, setShowSeasonModal] = useState(false)
  const [showPromoPanel, setShowPromoPanel] = useState(false)
  const [seasonForm, setSeasonForm] = useState({ name: '', color: '#6366f1', start_date: '', end_date: '' })
  const [saving, setSaving] = useState(false)

  const dateStr = (d) => d ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` : ''

  const load = useCallback(async () => {
    if (!selectedRoomType) return
    setLoading(true)
    setError('')
    try {
      const startDate = dateStr(1)
      const endDate = dateStr(new Date(viewYear, viewMonth + 1, 0).getDate())
      const [cal, seasons, codes] = await Promise.all([
        window.api.rateCalendar.get(selectedRoomType, startDate, endDate),
        window.api.seasonLabels.getAll().catch(() => []),
        window.api.promoCodes.getAll().catch(() => [])
      ])
      setCalendarData(cal || { entries: [], restrictions: [] })
      setSeasonLabels(Array.isArray(seasons) ? seasons : [])
      setPromoCodes(Array.isArray(codes) ? codes : [])
      window.api.rateCalendar.getConflicts(selectedRoomType, startDate, endDate).then(setConflicts).catch(() => null)
    } catch (err) {
      setError(err?.message || 'Failed to load rate calendar')
    } finally {
      setLoading(false)
    }
  }, [selectedRoomType, viewYear, viewMonth])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.api.roomTypes.getAll().then((data) => {
      setRoomTypes(Array.isArray(data) ? data : [])
      if (!selectedRoomType && data?.length > 0) setSelectedRoomType(data[0].id)
    }).catch(() => setRoomTypes([]))
  }, [])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) } else { setViewMonth((m) => m - 1) } }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) } else { setViewMonth((m) => m + 1) } }

  const handleCellClick = (day) => {
    if (!day) return
    const entry = calendarData.entries?.find((e) => {
      const eDate = typeof e.date === 'string' ? e.date.split('T')[0] : e.date
      return eDate === dateStr(day)
    })
    setEditAmount(entry?.rate_amount ? String(entry.rate_amount) : '')
    setEditCell(dateStr(day))
  }

  const handleSaveRate = async () => {
    if (!editCell || !selectedRoomType) return
    setSaving(true)
    setError('')
    try {
      await window.api.rateCalendar.setEntry(selectedRoomType, editCell, Number(editAmount) || 0, currency)
      setEditCell(null)
      load()
      setSuccess('Rate updated.')
    } catch (err) {
      setError(err?.message || 'Failed to save rate')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSeason = async (e) => {
    e.preventDefault()
    if (!seasonForm.name.trim() || !seasonForm.start_date || !seasonForm.end_date) {
      setError('Season name, start, and end date required'); return
    }
    setSaving(true)
    try {
      await window.api.seasonLabels.create(seasonForm)
      setShowSeasonModal(false)
      setSeasonForm({ name: '', color: '#6366f1', start_date: '', end_date: '' })
      load()
      setSuccess('Season label created.')
    } catch (err) {
      setError(err?.message || 'Failed to create season label')
    } finally {
      setSaving(false)
    }
  }

  const grid = getCalendarGrid(viewYear, viewMonth)
  const getEntryForDay = (day) => day ? calendarData.entries?.find((e) => (typeof e.date === 'string' ? e.date.split('T')[0] : e.date) === dateStr(day)) : null
  const getRestrictionForDay = (day) => day ? calendarData.restrictions?.find((r) => (typeof r.date === 'string' ? r.date.split('T')[0] : r.date) === dateStr(day)) : null
  const getSeasonForDay = (day) => {
    if (!day) return null
    const ds = dateStr(day)
    return seasonLabels.find((s) => ds >= s.start_date && ds <= s.end_date)
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">HOTEL REVENUE</p>
          <h1 className="bb-page-header-title">Rate Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="input max-w-[200px]" value={selectedRoomType} onChange={(e) => setSelectedRoomType(e.target.value)}>
            <option value="">Select Room Type</option>
            {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
          </select>
          <button onClick={() => setShowSeasonModal(true)} className="btn-secondary"><Tag size={14} /> Add Season</button>
          <button onClick={() => setShowPromoPanel(true)} className="btn-secondary"><Calendar size={14} /> Promo Codes</button>
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
        </div>
      </div>

      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

      {conflicts && (conflicts.multiple_entries_per_day?.length > 0 || conflicts.days_without_restrictions?.length > 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> Rate Conflicts Detected</div>
          {conflicts.multiple_entries_per_day?.length > 0 && <p className="mt-1 text-xs">{conflicts.multiple_entries_per_day.length} day(s) with multiple rate entries</p>}
          {conflicts.days_without_restrictions?.length > 0 && <p className="text-xs">{conflicts.days_without_restrictions.length} day(s) without restrictions</p>}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
      ) : !selectedRoomType ? (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <Calendar size={40} className="mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">Select a room type</p>
          <p className="mt-1 text-xs text-slate-400">Choose a room type above to view and manage rates.</p>
        </div>
      ) : (
        <div className="bb-card">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="btn-secondary"><ChevronLeft size={16} /></button>
            <h2 className="text-lg font-bold text-slate-800">{MONTHS[viewMonth]} {viewYear}</h2>
            <button onClick={nextMonth} className="btn-secondary"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden">
            {DAYS.map((d) => <div key={d} className="bg-slate-50 px-2 py-1.5 text-center text-[10px] font-semibold uppercase text-slate-500">{d}</div>)}
            {grid.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} className="bg-white p-2 min-h-[80px]" />
              const entry = getEntryForDay(day)
              const restriction = getRestrictionForDay(day)
              const season = getSeasonForDay(day)
              const isToday = day === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear()
              return (
                <div
                  key={day}
                  onClick={() => handleCellClick(day)}
                  className={`bg-white p-2 min-h-[80px] cursor-pointer hover:bg-slate-50 transition-colors relative ${isToday ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                  style={season ? { borderLeft: `3px solid ${season.color}` } : {}}
                >
                  <span className="text-xs font-semibold text-slate-600">{day}</span>
                  {entry && <p className="mt-1 text-xs font-bold text-slate-800">{formatCurrency(entry.rate_amount, entry.currency || currency)}</p>}
                  {entry?.is_override && <span className="text-[8px] text-amber-600 font-semibold">OVERRIDE</span>}
                  {restriction?.stop_sell && <span className="block text-[8px] text-red-600 font-semibold">STOP SELL</span>}
                  {restriction?.closed_to_arrival && <span className="block text-[8px] text-orange-600 font-semibold">CTA</span>}
                  {season && <span className="block text-[8px] mt-0.5 font-medium" style={{ color: season.color }}>{season.name}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editCell && (
        <Modal title={`Set Rate for ${editCell}`} onClose={() => setEditCell(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Rate Amount ({currency})</label>
              <input className="input" type="number" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} autoFocus />
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700"><AlertTriangle size={14} />{error}</div>}
            <div className="flex gap-3">
              <button onClick={() => setEditCell(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSaveRate} disabled={saving} className="btn-primary flex-1"><Save size={14} /> {saving ? 'Saving...' : 'Save Rate'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showSeasonModal && (
        <Modal title="Add Season Label" onClose={() => setShowSeasonModal(false)}>
          <form onSubmit={handleSaveSeason} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Season Name</label>
              <input className="input" value={seasonForm.name} onChange={(e) => setSeasonForm({ ...seasonForm, name: e.target.value })} placeholder="e.g. Peak Season" required />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Color</label>
              <input className="input h-10 w-full" type="color" value={seasonForm.color} onChange={(e) => setSeasonForm({ ...seasonForm, color: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Start Date</label>
                <input className="input" type="date" value={seasonForm.start_date} onChange={(e) => setSeasonForm({ ...seasonForm, start_date: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">End Date</label>
                <input className="input" type="date" value={seasonForm.end_date} onChange={(e) => setSeasonForm({ ...seasonForm, end_date: e.target.value })} required />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowSeasonModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Add Season'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showPromoPanel && (
        <Modal title="Promo Codes" onClose={() => setShowPromoPanel(false)} large>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {promoCodes.length === 0 && <p className="text-sm text-slate-500">No promo codes defined.</p>}
            {promoCodes.map((pc) => (
              <div key={pc.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">{pc.code}</span>
                  <span className={`text-xs font-semibold ${pc.active ? 'text-emerald-600' : 'text-slate-400'}`}>{pc.active ? 'Active' : 'Inactive'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{pc.description}</p>
                <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
                  <span>{pc.discount_type === 'percentage' ? `${pc.discount_value}%` : formatCurrency(pc.discount_value)}</span>
                  {pc.valid_from && <span>{pc.valid_from} - {pc.valid_to || '∞'}</span>}
                  <span>Used: {pc.usage_count || 0}{pc.usage_limit ? ` / ${pc.usage_limit}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
