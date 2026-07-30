import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { Plus, Pencil, Trash2, CreditCard, AlertTriangle, RefreshCw, Calendar, Clock } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useSettings, useFeatures } from '../app-context'

const RateCalendar = lazy(() => import('./RateCalendar'))
const RevenueManager = lazy(() => import('./RevenueManager'))
const PromoCodes = lazy(() => import('./PromoCodes'))
const BookingEngine = lazy(() => import('./BookingEngine'))

const emptyForm = {
  name: '',
  description: '',
  room_type_id: '',
  rate_amount: '',
  rate_type: 'per_night',
  valid_from: '',
  valid_to: '',
  min_stay: '1',
  max_stay: '',
  days_of_week: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  corporate_account_id: '',
  status: 'active'
}

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' }
]

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function RatePlans() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [plans, setPlans] = useState([])
  const [roomTypes, setRoomTypes] = useState([])
  const [corporateAccounts, setCorporateAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const features = useFeatures()
  const hasAdvancedRates = features?.advanced_rates === true
  const [activeTab, setActiveTab] = useState('plans')

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam) setActiveTab(tabParam)
  }, [searchParams])

  const tabs = [
    { key: 'plans', label: 'Rate Plans' },
    ...(hasAdvancedRates ? [
      { key: 'calendar', label: 'Rate Calendar' },
      { key: 'revenue', label: 'Revenue Manager' },
      { key: 'promo-codes', label: 'Promo Codes' },
      { key: 'booking-engine', label: 'Booking Engine' }
    ] : [])
  ]

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [plansData, rtData, corpData] = await Promise.all([
        window.api.ratePlans.getAll(),
        window.api.roomTypes.getAll().catch(() => []),
        window.api.corporateAccounts.getAll().catch(() => [])
      ])
      setPlans(Array.isArray(plansData) ? plansData : [])
      setRoomTypes(Array.isArray(rtData) ? rtData : [])
      setCorporateAccounts(Array.isArray(corpData) ? corpData : [])
    } catch (err) {
      setError(err?.message || 'Failed to load rate plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setError(''); setShowModal(true) }
  const openEdit = (p) => {
    setEditing(p.id)
    setForm({
      name: p.name || '',
      description: p.description || '',
      room_type_id: p.room_type_id || '',
      rate_amount: p.rate_amount || '',
      rate_type: p.rate_type || 'per_night',
      valid_from: p.valid_from || '',
      valid_to: p.valid_to || '',
      min_stay: p.min_stay || '1',
      max_stay: p.max_stay || '',
      days_of_week: Array.isArray(p.days_of_week) ? p.days_of_week : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      corporate_account_id: p.corporate_account_id || '',
      status: p.status || 'active'
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Rate plan name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, rate_amount: Number(form.rate_amount) || 0, min_stay: Number(form.min_stay) || 1, max_stay: form.max_stay ? Number(form.max_stay) : null, room_type_id: form.room_type_id || null, corporate_account_id: form.corporate_account_id || null }
      if (editing) {
        await window.api.ratePlans.update(editing, payload)
      } else {
        await window.api.ratePlans.create(payload)
      }
      setShowModal(false)
      load()
      setSuccess(editing ? 'Rate plan updated.' : 'Rate plan created.')
    } catch (err) {
      setError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (p) => {
    setConfirmDialog({
      title: `Delete "${p.name}"?`,
      message: 'This permanently removes the rate plan.',
      confirmLabel: 'Delete',
      onConfirm: async () => { setConfirmDialog(null); try { await window.api.ratePlans.delete(p.id); load(); setSuccess('Rate plan deleted.') } catch (err) { setError(err?.message || 'Delete failed') } }
    })
  }

  const toggleDay = (day) => {
    setForm((prev) => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day) ? prev.days_of_week.filter((d) => d !== day) : [...prev.days_of_week, day]
    }))
  }

  if (loading) return (
    <div className="bb-page">
      <div className="bb-page-header"><p className="bb-section-kicker">HOTEL REVENUE</p><h1 className="bb-page-header-title">Rate Plans</h1></div>
      <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
    </div>
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="bb-page-header">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/70">Rate Management</p>
          <h1 className="bb-page-header-title mt-2">Rate Plans</h1>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setSearchParams({ tab: key }, { replace: true }) }}
              className={`px-4 py-2 text-xs font-semibold transition-colors ${
                activeTab === key
                  ? 'border-b-2 border-emerald-600 text-emerald-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'plans' && (
        <>
          <div className="bb-page-header">
            <div>
              <p className="bb-section-kicker">HOTEL REVENUE</p>
              <h1 className="bb-page-header-title">Rate Plans</h1>
              <p className="bb-page-header-subtitle">{plans.length} rate plan{plans.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Rate Plan</button>
          </div>

          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

          {plans.length === 0 ? (
            <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
              <CreditCard size={40} className="mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">No rate plans yet</p>
              <p className="mt-1 text-xs text-slate-400">Create seasonal, corporate, or package rate plans for your rooms.</p>
              <button onClick={openAdd} className="mt-4 btn-primary"><Plus size={14} /> Add First Rate Plan</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => {
                const rt = roomTypes.find((r) => r.id === p.room_type_id)
                return (
                  <div key={p.id} className="bb-card group relative p-5">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold text-slate-800 truncate">{p.name}</h3>
                        {rt && <p className="mt-0.5 text-xs text-slate-500">{rt.name}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <p className="text-[10px] font-semibold uppercase text-slate-400">Rate</p>
                        <p className="text-sm font-bold text-slate-800">{formatCurrency(p.rate_amount, currency)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <p className="text-[10px] font-semibold uppercase text-slate-400">Type</p>
                        <p className="text-sm font-bold text-slate-800 capitalize">{(p.rate_type || 'per_night').replace('_', ' ')}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
                      {p.valid_from && <span className="flex items-center gap-1"><Calendar size={10} />{p.valid_from}</span>}
                      {p.valid_to && <span>- {p.valid_to}</span>}
                      {p.min_stay > 1 && <span className="flex items-center gap-1"><Clock size={10} />Min {p.min_stay} nights</span>}
                    </div>
                    <div className="mt-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.status || 'active'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {showModal && (
            <Modal title={editing ? 'Edit Rate Plan' : 'Add Rate Plan'} onClose={() => setShowModal(false)}>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Name <span className="text-red-400">*</span></label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekend Special" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Room Type</label>
                    <select className="input" value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
                      <option value="">All Room Types</option>
                      {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Rate Type</label>
                    <select className="input" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}>
                      <option value="per_night">Per Night</option>
                      <option value="per_person">Per Person</option>
                      <option value="package">Package</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Rate Amount ({currency})</label>
                    <input className="input" type="number" min="0" step="0.01" value={form.rate_amount} onChange={(e) => setForm({ ...form, rate_amount: e.target.value })} required />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Corporate Account</label>
                    <select className="input" value={form.corporate_account_id} onChange={(e) => setForm({ ...form, corporate_account_id: e.target.value })}>
                      <option value="">None</option>
                      {corporateAccounts.map((ca) => <option key={ca.id} value={ca.id}>{ca.company_name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Valid From</label>
                    <input className="input" type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Valid To</label>
                    <input className="input" type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Min Stay (nights)</label>
                    <input className="input" type="number" min="1" value={form.min_stay} onChange={(e) => setForm({ ...form, min_stay: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Max Stay</label>
                    <input className="input" type="number" min="1" value={form.max_stay} onChange={(e) => setForm({ ...form, max_stay: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Days of Week</label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map(({ key, label }) => (
                      <button key={key} type="button" onClick={() => toggleDay(key)} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${form.days_of_week.includes(key) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700"><AlertTriangle size={14} className="shrink-0" />{error}</div>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Rate Plan'}</button>
                </div>
              </form>
            </Modal>
          )}

          <ConfirmDialog open={!!confirmDialog} title={confirmDialog?.title} message={confirmDialog?.message} confirmLabel={confirmDialog?.confirmLabel} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialog?.onConfirm} />
        </>
      )}
      {activeTab === 'calendar' && <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><RateCalendar /></Suspense>}
      {activeTab === 'revenue' && <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><RevenueManager /></Suspense>}
      {activeTab === 'promo-codes' && <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><PromoCodes /></Suspense>}
      {activeTab === 'booking-engine' && <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}><BookingEngine /></Suspense>}
    </div>
  )
}
