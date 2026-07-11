import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Tag, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { Modal } from './shared/Modal'
import { ConfirmDialog } from './shared/ConfirmDialog'
import { useSettings } from '../app-context'

const emptyForm = {
  code: '', description: '', discount_type: 'percentage', discount_value: '',
  valid_from: '', valid_to: '', min_nights: '1', max_discount_amount: '',
  usage_limit: '', applies_to_room_types: [], active: true
}

function formatCurrency(amount, currency = 'P') {
  return `${currency}${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PromoCodes() {
  const { settings } = useSettings()
  const currency = settings?.currency || 'P'
  const [codes, setCodes] = useState([])
  const [roomTypes, setRoomTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showValidate, setShowValidate] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [validateCode, setValidateCode] = useState('')
  const [validateRoomType, setValidateRoomType] = useState('')
  const [validateNights, setValidateNights] = useState('1')
  const [validationResult, setValidationResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [codesData, rtData] = await Promise.all([
        window.api.promoCodes.getAll(),
        window.api.roomTypes.getAll().catch(() => [])
      ])
      setCodes(Array.isArray(codesData) ? codesData : [])
      setRoomTypes(Array.isArray(rtData) ? rtData : [])
    } catch (err) {
      setError(err?.message || 'Failed to load promo codes')
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
  const openEdit = (pc) => {
    setEditing(pc.id)
    setForm({
      code: pc.code || '',
      description: pc.description || '',
      discount_type: pc.discount_type || 'percentage',
      discount_value: pc.discount_value || '',
      valid_from: pc.valid_from || '',
      valid_to: pc.valid_to || '',
      min_nights: pc.min_nights || '1',
      max_discount_amount: pc.max_discount_amount || '',
      usage_limit: pc.usage_limit || '',
      applies_to_room_types: Array.isArray(pc.applies_to_room_types) ? pc.applies_to_room_types : [],
      active: pc.active !== false
    })
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.code.trim()) { setError('Promo code is required'); return }
    if (!form.discount_value || Number(form.discount_value) <= 0) { setError('Discount value is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        discount_value: Number(form.discount_value) || 0,
        min_nights: Number(form.min_nights) || 1,
        max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
        usage_limit: form.usage_limit ? Number(form.usage_limit) : null
      }
      if (editing) {
        await window.api.promoCodes.update(editing, payload)
      } else {
        await window.api.promoCodes.create(payload)
      }
      setShowModal(false)
      load()
      setSuccess(editing ? 'Promo code updated.' : 'Promo code created.')
    } catch (err) {
      setError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (pc) => {
    setConfirmDialog({
      title: `Delete code "${pc.code}"?`,
      message: 'This permanently removes the promo code.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          await window.api.promoCodes.delete(pc.id)
          load()
          setSuccess('Promo code deleted.')
        } catch (err) {
          setError(err?.message || 'Delete failed')
        }
      }
    })
  }

  const handleValidate = async () => {
    if (!validateCode.trim()) return
    setValidationResult(null)
    try {
      const result = await window.api.promoCodes.validate(validateCode.trim(), validateRoomType || null, Number(validateNights) || 1)
      setValidationResult(result)
    } catch (err) {
      setValidationResult({ valid: false, error: err?.message || 'Validation failed' })
    }
  }

  const toggleRoomType = (rtId) => {
    setForm((prev) => ({
      ...prev,
      applies_to_room_types: prev.applies_to_room_types.includes(rtId)
        ? prev.applies_to_room_types.filter((id) => id !== rtId)
        : [...prev.applies_to_room_types, rtId]
    }))
  }

  if (loading) return (
    <div className="bb-page">
      <div className="bb-page-header"><p className="bb-section-kicker">HOTEL REVENUE</p><h1 className="bb-page-header-title">Promo Codes</h1></div>
      <div className="flex items-center justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-[#174c3a] border-t-transparent" /></div>
    </div>
  )

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">HOTEL REVENUE</p>
          <h1 className="bb-page-header-title">Promo Codes</h1>
          <p className="bb-page-header-subtitle">{codes.length} promo code{codes.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setValidateCode(''); setValidationResult(null); setShowValidate(true) }} className="btn-secondary"><CheckCircle size={14} /> Validate</button>
          <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Add Promo Code</button>
        </div>
      </div>

      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

      {codes.length === 0 ? (
        <div className="bb-card flex flex-col items-center justify-center py-16 text-center">
          <Tag size={40} className="mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No promo codes yet</p>
          <p className="mt-1 text-xs text-slate-400">Create promotional codes for discounts and special offers.</p>
          <button onClick={openAdd} className="mt-4 btn-primary"><Plus size={14} /> Add First Promo Code</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {codes.map((pc) => (
            <div key={pc.id} className="bb-card group relative p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-slate-800">{pc.code}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{pc.description || 'No description'}</p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(pc)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(pc)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-lg font-bold text-emerald-700">
                  {pc.discount_type === 'percentage' ? `${pc.discount_value}%` : formatCurrency(pc.discount_value, currency)}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pc.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {pc.active ? <CheckCircle size={10} /> : <XCircle size={10} />}
                  {pc.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
                {pc.valid_from && <span>From: {pc.valid_from}</span>}
                {pc.valid_to && <span>To: {pc.valid_to}</span>}
                {pc.min_nights > 1 && <span>Min {pc.min_nights} nights</span>}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                Used: {pc.usage_count || 0}{pc.usage_limit ? ` / ${pc.usage_limit}` : ' (unlimited)'}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Promo Code' : 'Add Promo Code'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Code <span className="text-red-400">*</span></label>
                <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. SUMMER20" required />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Discount Type</label>
                <select className="input" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat Amount</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  {form.discount_type === 'percentage' ? 'Discount %' : `Discount (${currency})`} <span className="text-red-400">*</span>
                </label>
                <input className="input" type="number" min="0" step="0.01" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Max Discount Amount</label>
                <input className="input" type="number" min="0" step="0.01" value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })} placeholder="Unlimited" />
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Min Nights</label>
                <input className="input" type="number" min="1" value={form.min_nights} onChange={(e) => setForm({ ...form, min_nights: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Usage Limit</label>
                <input className="input" type="number" min="1" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} placeholder="Unlimited" />
              </div>
            </div>
            {roomTypes.length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Applies To Room Types</label>
                <div className="flex flex-wrap gap-1.5">
                  {roomTypes.map((rt) => (
                    <button key={rt.id} type="button" onClick={() => toggleRoomType(rt.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${form.applies_to_room_types.includes(rt.id) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                      {rt.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700"><AlertTriangle size={14} />{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Promo Code'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showValidate && (
        <Modal title="Validate Promo Code" onClose={() => setShowValidate(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Promo Code</label>
              <input className="input" value={validateCode} onChange={(e) => setValidateCode(e.target.value.toUpperCase())} placeholder="Enter code" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Room Type</label>
                <select className="input" value={validateRoomType} onChange={(e) => setValidateRoomType(e.target.value)}>
                  <option value="">Any</option>
                  {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Nights</label>
                <input className="input" type="number" min="1" value={validateNights} onChange={(e) => setValidateNights(e.target.value)} />
              </div>
            </div>
            <button onClick={handleValidate} className="btn-primary w-full">Validate</button>
            {validationResult && (
              <div className={`rounded-xl border p-3 text-sm ${validationResult.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                <div className="flex items-center gap-2 font-semibold">
                  {validationResult.valid ? <CheckCircle size={14} /> : <XCircle size={14} />}
                  {validationResult.valid ? 'Valid Promo Code' : 'Invalid'}
                </div>
                {validationResult.valid ? (
                  <div className="mt-1 text-xs space-y-0.5">
                    <p>Discount: {validationResult.discount_type === 'percentage' ? `${validationResult.discount_value}%` : formatCurrency(validationResult.discount_value, currency)}</p>
                    {validationResult.max_discount_amount && <p>Max discount: {formatCurrency(validationResult.max_discount_amount, currency)}</p>}
                  </div>
                ) : (
                  <p className="mt-1 text-xs">{validationResult.error}</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog open={!!confirmDialog} title={confirmDialog?.title} message={confirmDialog?.message} confirmLabel={confirmDialog?.confirmLabel} onCancel={() => setConfirmDialog(null)} onConfirm={confirmDialog?.onConfirm} />
    </div>
  )
}
