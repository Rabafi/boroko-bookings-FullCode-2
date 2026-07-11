import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, Check, Edit3, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Modal } from './shared/Modal'

const RULE_TYPES = ['availability', 'pricing', 'restriction', 'upsell']
const UPSELL_TYPES = ['room_upgrade', 'addon_service', 'package']

const emptyRule = {
  name: '',
  rule_type: 'pricing',
  priority: 100,
  conditions: '{}',
  actions: '{}',
  active: true
}

const emptyUpsell = {
  name: '',
  description: '',
  upsell_type: 'addon_service',
  price_adjustment: 0,
  sort_order: 100,
  conditions: '{}',
  active: true
}

function toJsonText(value, fallback = '{}') {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value || JSON.parse(fallback), null, 2)
  } catch {
    return fallback
  }
}

function parseJsonField(value, label) {
  try {
    return value?.trim() ? JSON.parse(value) : {}
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function formatMoney(amount, currency = 'BWP') {
  return `${currency} ${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusClass(active) {
  return active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
}

export default function BookingEngine() {
  const [rules, setRules] = useState([])
  const [upsells, setUpsells] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [ruleModal, setRuleModal] = useState(null)
  const [upsellModal, setUpsellModal] = useState(null)
  const [ruleForm, setRuleForm] = useState(emptyRule)
  const [upsellForm, setUpsellForm] = useState(emptyUpsell)
  const [preview, setPreview] = useState({
    room_type_id: '',
    check_in: '',
    check_out: '',
    guests: 2,
    rooms: 1,
    promo_code: ''
  })
  const [previewResult, setPreviewResult] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  const activeRuleCount = useMemo(() => rules.filter((rule) => rule.active !== false).length, [rules])
  const activeUpsellCount = useMemo(() => upsells.filter((upsell) => upsell.active !== false).length, [upsells])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ruleRows, upsellRows] = await Promise.all([
        window.api.bookingEngine.getRules().catch(() => []),
        window.api.bookingEngine.getUpsellsList().catch(() => [])
      ])
      setRules(Array.isArray(ruleRows) ? ruleRows : [])
      setUpsells(Array.isArray(upsellRows) ? upsellRows : [])
    } catch (err) {
      setError(err?.message || 'Failed to load booking engine')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!success) return undefined
    const timer = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(timer)
  }, [success])

  const openRule = (rule = null) => {
    setError('')
    setRuleModal(rule || {})
    setRuleForm(rule ? {
      name: rule.name || '',
      rule_type: rule.rule_type || 'pricing',
      priority: Number(rule.priority ?? 100),
      conditions: toJsonText(rule.conditions),
      actions: toJsonText(rule.actions),
      active: rule.active !== false
    } : emptyRule)
  }

  const openUpsell = (upsell = null) => {
    setError('')
    setUpsellModal(upsell || {})
    setUpsellForm(upsell ? {
      name: upsell.name || '',
      description: upsell.description || '',
      upsell_type: upsell.upsell_type || 'addon_service',
      price_adjustment: Number(upsell.price_adjustment || 0),
      sort_order: Number(upsell.sort_order ?? 100),
      conditions: toJsonText(upsell.conditions),
      active: upsell.active !== false
    } : emptyUpsell)
  }

  const saveRule = async (event) => {
    event.preventDefault()
    if (!ruleForm.name.trim()) { setError('Rule name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: ruleForm.name.trim(),
        rule_type: ruleForm.rule_type,
        priority: Number(ruleForm.priority) || 0,
        conditions: parseJsonField(ruleForm.conditions, 'Conditions'),
        actions: parseJsonField(ruleForm.actions, 'Actions'),
        active: Boolean(ruleForm.active)
      }
      if (ruleModal?.id) await window.api.bookingEngine.updateRule(ruleModal.id, payload)
      else await window.api.bookingEngine.createRule(payload)
      setRuleModal(null)
      setSuccess('Booking rule saved')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save booking rule')
    } finally {
      setSaving(false)
    }
  }

  const saveUpsell = async (event) => {
    event.preventDefault()
    if (!upsellForm.name.trim()) { setError('Upsell name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: upsellForm.name.trim(),
        description: upsellForm.description.trim(),
        upsell_type: upsellForm.upsell_type,
        price_adjustment: Number(upsellForm.price_adjustment) || 0,
        sort_order: Number(upsellForm.sort_order) || 0,
        conditions: parseJsonField(upsellForm.conditions, 'Conditions'),
        active: Boolean(upsellForm.active)
      }
      if (upsellModal?.id) await window.api.bookingEngine.updateUpsell(upsellModal.id, payload)
      else await window.api.bookingEngine.createUpsell(payload)
      setUpsellModal(null)
      setSuccess('Booking upsell saved')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to save booking upsell')
    } finally {
      setSaving(false)
    }
  }

  const deleteRule = async (rule) => {
    if (!rule?.id) return
    setError('')
    try {
      await window.api.bookingEngine.deleteRule(rule.id)
      setSuccess('Booking rule deleted')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to delete booking rule')
    }
  }

  const deleteUpsell = async (upsell) => {
    if (!upsell?.id) return
    setError('')
    try {
      await window.api.bookingEngine.deleteUpsell(upsell.id)
      setSuccess('Booking upsell deleted')
      load()
    } catch (err) {
      setError(err?.message || 'Failed to delete booking upsell')
    }
  }

  const runPreview = async (event) => {
    event.preventDefault()
    if (!preview.room_type_id || !preview.check_in || !preview.check_out) {
      setError('Room type, check-in, and check-out are required')
      return
    }
    setPreviewing(true)
    setError('')
    setPreviewResult(null)
    try {
      const request = {
        room_type_id: preview.room_type_id,
        check_in: preview.check_in,
        check_out: preview.check_out,
        guests: Number(preview.guests) || 1,
        rooms: Number(preview.rooms) || 1,
        promo_code: preview.promo_code || null
      }
      const [price, availability, availableUpsells] = await Promise.all([
        window.api.bookingEngine.calculatePrice(request),
        window.api.bookingEngine.checkAvailability(request),
        window.api.bookingEngine.getUpsells(request)
      ])
      setPreviewResult({ price, availability, upsells: Array.isArray(availableUpsells) ? availableUpsells : [] })
    } catch (err) {
      setError(err?.message || 'Failed to calculate booking preview')
    } finally {
      setPreviewing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="bb-page">
      <div className="bb-page-header">
        <div>
          <p className="bb-section-kicker">HOTEL DIRECT BOOKING</p>
          <h1 className="bb-page-header-title">Booking Engine</h1>
        </div>
        <button type="button" onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
      </div>

      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"><AlertTriangle size={14} className="inline-block mr-2" />{error}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="bb-card">
          <p className="text-xs font-semibold uppercase text-slate-500">Active Rules</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{activeRuleCount}</p>
          <p className="mt-1 text-sm text-slate-500">{rules.length} configured</p>
        </div>
        <div className="bb-card">
          <p className="text-xs font-semibold uppercase text-slate-500">Active Upsells</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{activeUpsellCount}</p>
          <p className="mt-1 text-sm text-slate-500">{upsells.length} configured</p>
        </div>
        <div className="bb-card">
          <p className="text-xs font-semibold uppercase text-slate-500">Preview Mode</p>
          <p className="mt-2 text-lg font-bold text-slate-900">Price, availability, upsells</p>
          <p className="mt-1 text-sm text-slate-500">No booking or payment is created</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <section className="bb-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Rules</h2>
                <p className="text-sm text-slate-500">Pricing, restrictions, availability, and upsell logic.</p>
              </div>
              <button type="button" onClick={() => openRule()} className="btn-primary"><Plus size={14} /> Rule</button>
            </div>
            <div className="space-y-3">
              {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">No booking rules configured</div>
              ) : rules.map((rule) => (
                <div key={rule.id || rule.name} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{rule.name}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(rule.active !== false)}`}>{rule.active !== false ? 'Active' : 'Inactive'}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{rule.rule_type}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Priority {rule.priority ?? 100}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openRule(rule)} className="btn-secondary"><Edit3 size={14} /></button>
                    <button type="button" onClick={() => deleteRule(rule)} className="btn-secondary text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bb-card">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Upsells</h2>
                <p className="text-sm text-slate-500">Room upgrades, packages, and add-on services.</p>
              </div>
              <button type="button" onClick={() => openUpsell()} className="btn-primary"><Plus size={14} /> Upsell</button>
            </div>
            <div className="space-y-3">
              {upsells.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">No upsells configured</div>
              ) : upsells.map((upsell) => (
                <div key={upsell.id || upsell.name} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{upsell.name}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(upsell.active !== false)}`}>{upsell.active !== false ? 'Active' : 'Inactive'}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{upsell.upsell_type}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatMoney(upsell.price_adjustment)} adjustment</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openUpsell(upsell)} className="btn-secondary"><Edit3 size={14} /></button>
                    <button type="button" onClick={() => deleteUpsell(upsell)} className="btn-secondary text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="bb-card h-fit">
          <div className="mb-4 flex items-center gap-2">
            <Calculator size={18} className="text-emerald-700" />
            <h2 className="text-lg font-bold text-slate-900">Booking Preview</h2>
          </div>
          <form onSubmit={runPreview} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Room Type ID</label>
              <input className="input" value={preview.room_type_id} onChange={(e) => setPreview({ ...preview, room_type_id: e.target.value })} placeholder="room type uuid" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Check-in</label>
                <input className="input" type="date" value={preview.check_in} onChange={(e) => setPreview({ ...preview, check_in: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Check-out</label>
                <input className="input" type="date" value={preview.check_out} onChange={(e) => setPreview({ ...preview, check_out: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Guests</label>
                <input className="input" type="number" min="1" value={preview.guests} onChange={(e) => setPreview({ ...preview, guests: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Rooms</label>
                <input className="input" type="number" min="1" value={preview.rooms} onChange={(e) => setPreview({ ...preview, rooms: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Promo Code</label>
              <input className="input" value={preview.promo_code} onChange={(e) => setPreview({ ...preview, promo_code: e.target.value })} />
            </div>
            <button type="submit" disabled={previewing} className="btn-primary w-full justify-center">
              {previewing ? <RefreshCw size={14} className="animate-spin" /> : <Calculator size={14} />}
              Calculate
            </button>
          </form>

          {previewResult && (
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Total</span>
                <span className="font-bold text-slate-900">{formatMoney(previewResult.price?.total_amount || previewResult.price?.total || 0, previewResult.price?.currency || 'BWP')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Available</span>
                <span className={previewResult.availability?.available === false ? 'font-bold text-red-700' : 'font-bold text-emerald-700'}>{previewResult.availability?.available === false ? 'No' : 'Yes'}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Upsells</span>
                <p className="mt-1 text-slate-500">{previewResult.upsells.length} match this stay</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {ruleModal !== null && (
        <Modal title={ruleModal?.id ? 'Edit Rule' : 'Add Rule'} onClose={() => setRuleModal(null)}>
          <form onSubmit={saveRule} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input className="input" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <select className="input" value={ruleForm.rule_type} onChange={(e) => setRuleForm({ ...ruleForm, rule_type: e.target.value })}>
                  {RULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Priority</label>
                <input className="input" type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Conditions JSON</label>
              <textarea className="input min-h-[110px] font-mono text-xs" value={ruleForm.conditions} onChange={(e) => setRuleForm({ ...ruleForm, conditions: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Actions JSON</label>
              <textarea className="input min-h-[110px] font-mono text-xs" value={ruleForm.actions} onChange={(e) => setRuleForm({ ...ruleForm, actions: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={ruleForm.active} onChange={(e) => setRuleForm({ ...ruleForm, active: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRuleModal(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary"><Check size={14} /> Save</button>
            </div>
          </form>
        </Modal>
      )}

      {upsellModal !== null && (
        <Modal title={upsellModal?.id ? 'Edit Upsell' : 'Add Upsell'} onClose={() => setUpsellModal(null)}>
          <form onSubmit={saveUpsell} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input className="input" value={upsellForm.name} onChange={(e) => setUpsellForm({ ...upsellForm, name: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Description</label>
              <input className="input" value={upsellForm.description} onChange={(e) => setUpsellForm({ ...upsellForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <select className="input" value={upsellForm.upsell_type} onChange={(e) => setUpsellForm({ ...upsellForm, upsell_type: e.target.value })}>
                  {UPSELL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Price Adjustment</label>
                <input className="input" type="number" step="0.01" value={upsellForm.price_adjustment} onChange={(e) => setUpsellForm({ ...upsellForm, price_adjustment: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Sort Order</label>
              <input className="input" type="number" value={upsellForm.sort_order} onChange={(e) => setUpsellForm({ ...upsellForm, sort_order: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Conditions JSON</label>
              <textarea className="input min-h-[110px] font-mono text-xs" value={upsellForm.conditions} onChange={(e) => setUpsellForm({ ...upsellForm, conditions: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={upsellForm.active} onChange={(e) => setUpsellForm({ ...upsellForm, active: e.target.checked })} />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUpsellModal(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary"><Check size={14} /> Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
