import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Filter,
  Layers3,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users
} from 'lucide-react'
import { FEATURE_LABELS } from '../../../shared/accessControl'
import {
  SUBSCRIPTION_PLAN_ORDER,
  getAllSubscriptionPlans,
  getSubscriptionPlan,
  normalizeSubscriptionPlan
} from '../../../shared/subscriptionPlans'
import { formatLocalDate } from '../utils/localDate'

const PLAN_FLAGS = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, pos: false, inventory: false,
    supplies: false, import: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, pos: false, inventory: false,
    supplies: false, import: true
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, pos: true, inventory: true,
    supplies: true, import: true
  }
}

const PLAN_COLORS = {
  Starter: 'border-gray-700 bg-gray-800/60',
  Standard: 'border-blue-700 bg-blue-950/30',
  Pro: 'border-purple-700 bg-purple-950/30'
}

const FEATURE_ORDER = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies']

function normalizePlanName(plan) {
  return normalizeSubscriptionPlan(plan)
}

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusTone(status) {
  const raw = String(status || '').toLowerCase()
  if (raw === 'active' || raw === 'licensed') return 'bg-green-500/15 text-green-300'
  if (raw === 'trial') return 'bg-blue-500/15 text-blue-300'
  if (raw === 'grace_period') return 'bg-amber-500/15 text-amber-300'
  if (raw === 'overdue') return 'bg-amber-500/15 text-amber-300'
  if (raw === 'suspended') return 'bg-red-500/15 text-red-300'
  if (raw === 'cancelled' || raw === 'expired') return 'bg-red-500/15 text-red-300'
  return 'bg-gray-500/15 text-gray-300'
}

function getLicenseStatusLabel(license) {
  return String(license?.subscription_state || license?.payment_status || 'active').replace(/_/g, ' ')
}

function lodgeKey(value) {
  return String(value || '').trim().toLowerCase()
}

const UNASSIGNED_LICENSE_STATES = new Set(['cancelled', 'expired', 'superseded', 'deleted', 'inactive'])

function isAssignedLicense(license) {
  if (!license || !lodgeKey(license.lodge_id) || license.is_active === false) return false
  const state = String(license.subscription_state || license.payment_status || 'active').toLowerCase()
  return !UNASSIGNED_LICENSE_STATES.has(state)
}

function licenseSortTime(license) {
  const value = license?.updated_at || license?.issued_at || license?.created_at || license?.expires_at || license?.next_due_date
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function pickPreferredLicense(current, candidate) {
  if (!current) return candidate
  const currentPlanRank = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizePlanName(current.subscription_plan))
  const candidatePlanRank = SUBSCRIPTION_PLAN_ORDER.indexOf(normalizePlanName(candidate.subscription_plan))
  if (candidatePlanRank !== currentPlanRank) return candidatePlanRank > currentPlanRank ? candidate : current
  return licenseSortTime(candidate) >= licenseSortTime(current) ? candidate : current
}

function buildAssignedLicenseMap(licenses = []) {
  const map = new Map()
  ;(licenses || []).forEach((license) => {
    if (!isAssignedLicense(license)) return
    const key = lodgeKey(license.lodge_id)
    map.set(key, pickPreferredLicense(map.get(key), license))
  })
  return map
}

function isPastDate(value) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time < Date.now()
}

function shouldClearStaleExpiry(license) {
  if (!license || !isPastDate(license.expires_at)) return false
  const state = String(license.subscription_state || license.payment_status || 'active').toLowerCase()
  const paymentStatus = String(license.payment_status || '').toLowerCase()
  return ['active', 'licensed', 'trial', 'free', 'grace_period', 'overdue'].includes(state) ||
    ['active', 'trial', 'free', 'overdue'].includes(paymentStatus)
}

function parseUpgradeRequest(description = '') {
  const text = String(description || '')
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const read = (prefix) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() || ''
  return {
    requestedPlan: read('Requested plan:'),
    blockedFeature: read('Blocked feature:'),
    businessNeed: read('Business need:')
  }
}

function PlanCatalog({ licenses }) {
  const countsByPlan = useMemo(() => {
    return (licenses || []).reduce((accumulator, license) => {
      if (!isAssignedLicense(license)) return accumulator
      const plan = normalizePlanName(license.subscription_plan)
      accumulator[plan] = (accumulator[plan] || 0) + 1
      return accumulator
    }, {})
  }, [licenses])

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-3 gap-4">
        {getAllSubscriptionPlans().map((plan) => (
          <div key={plan.name} className={`rounded-2xl border p-5 ${PLAN_COLORS[plan.name]}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-white">{plan.name}</p>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {plan.badge}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-300">{plan.headline}</p>
                <p className="mt-1 text-sm text-gray-400">{plan.summary}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-900 text-gray-300">
                {countsByPlan[plan.name] || 0} clients
              </span>
            </div>
            <div className="mt-4 rounded-2xl border border-white/5 bg-black/10 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Best For</p>
              <p className="mt-2 text-sm text-gray-300">{plan.audience}</p>
            </div>
            <div className="mt-4 space-y-2">
              {FEATURE_ORDER.map((feature) => (
                <div key={feature} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">{FEATURE_LABELS[feature]}</span>
                  <span className={PLAN_FLAGS[plan.name][feature] ? 'text-green-300' : 'text-gray-600'}>
                    {PLAN_FLAGS[plan.name][feature] ? 'Included' : 'Locked'}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-gray-500">{plan.upgradeNudge}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function AssignmentDesk({ companies, licenses, onRefresh, prefill, clearPrefill }) {
  const [editingLicense, setEditingLicense] = useState(null)
  const [form, setForm] = useState({
    lodge_id: '',
    lodge_name: '',
    business_type: 'lodge',
    subscription_plan: 'Starter',
    payment_status: 'active',
    monthly_fee: '',
    currency: 'BWP',
    expires_at: '',
    next_due_date: '',
    notes: '',
    duration: ''
  })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (prefill) {
      setForm((prev) => ({
        ...prev,
        ...prefill
      }))
      setFilter(prefill.lodge_name || '')
      clearPrefill()
    }
  }, [prefill, clearPrefill])

  const companyById = useMemo(() => {
    return new Map((companies || []).map((company) => [lodgeKey(company.lodge_id), company]))
  }, [companies])

  const currentAssignments = useMemo(() => {
    const activeLicenses = buildAssignedLicenseMap(licenses)

    return (companies || []).map((company) => ({
      company,
      license: activeLicenses.get(lodgeKey(company.lodge_id)) || null
    })).filter(({ company, license }) => {
      const needle = filter.trim().toLowerCase()
      if (!needle) return true
      return String(company.lodge_name || '').toLowerCase().includes(needle)
        || String(license?.license_key || '').toLowerCase().includes(needle)
    })
  }, [companies, filter, licenses])

  const startCreate = (company) => {
    setEditingLicense(null)
    setError('')
    setNotice('')
    setForm({
      lodge_id: company?.lodge_id || '',
      lodge_name: company?.lodge_name || '',
      business_type: company?.business_type || 'lodge',
      subscription_plan: 'Starter',
      payment_status: 'active',
      monthly_fee: '',
      currency: 'BWP',
      expires_at: '',
      next_due_date: '',
      notes: '',
      duration: ''
    })
  }

  const startEdit = (license) => {
    const company = companyById.get(lodgeKey(license.lodge_id))
    const clearStaleExpiry = shouldClearStaleExpiry(license)
    setEditingLicense(license)
    setError('')
    setNotice(clearStaleExpiry ? 'This active assignment had an expired hard expiry date. Saving will clear that stale expiry and keep billing on the next due date.' : '')
    setForm({
      lodge_id: license.lodge_id || '',
      lodge_name: license.lodge_name || company?.lodge_name || '',
      business_type: company?.business_type || license.business_type || 'lodge',
      subscription_plan: normalizePlanName(license.subscription_plan),
      payment_status: license.payment_status || 'active',
      monthly_fee: license.monthly_fee ?? '',
      currency: license.currency || 'BWP',
      expires_at: clearStaleExpiry ? '' : license.expires_at ? String(license.expires_at).slice(0, 10) : '',
      next_due_date: license.next_due_date ? String(license.next_due_date).slice(0, 10) : '',
      notes: license.notes || '',
      duration: ''
    })
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    setSaving(true)
    try {
      if (editingLicense) {
        if (String(editingLicense.id || '').startsWith('entitlement:')) {
          throw new Error('This assignment was recovered from entitlement data but no editable license row was returned. Refresh licenses, then open Supabase if this still appears.')
        }
        const result = await window.api.admin.updateLicense(editingLicense.id, {
          lodge_id: form.lodge_id,
          lodge_name: form.lodge_name,
          subscription_plan: form.subscription_plan,
          payment_status: form.payment_status,
          monthly_fee: Number(form.monthly_fee || 0),
          currency: form.currency,
          expires_at: form.expires_at || null,
          next_due_date: form.next_due_date || null,
          notes: form.notes || null
        })
        if (!result?.success) throw new Error(result?.error || 'Could not update license assignment')
        setNotice('License assignment updated.')
      } else {
        const existing = buildAssignedLicenseMap(licenses).get(lodgeKey(form.lodge_id))
        if (existing) {
          startEdit(existing)
          throw new Error('This lodge already has an active assignment. I opened the existing license for editing instead.')
        }
        const result = await window.api.admin.issueSubscriptionContract({
          license: {
            lodge_id: form.lodge_id,
            lodge_name: form.lodge_name,
            business_type: form.business_type,
            subscription_plan: form.subscription_plan,
            payment_status: form.payment_status,
            monthly_fee: Number(form.monthly_fee || 0),
            currency: form.currency,
            expires_at: form.expires_at || null,
            next_due_date: form.next_due_date || null,
            notes: form.notes || null
          }
        })
        if (!result?.success) throw new Error(result?.error || 'Could not generate license')
        const issuedKey = result?.license?.license_key || result?.license_key
        setNotice(`Generated ${form.subscription_plan} license${issuedKey ? `: ${issuedKey}` : '.'}`)
      }
      setEditingLicense(null)
      startCreate(null)
      await onRefresh()
    } catch (err) {
      setError(err?.message || 'Could not save license assignment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-5">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
        <div className="p-5 border-b border-gray-700 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Assignments</h3>
            <p className="text-sm text-gray-400 mt-1">See each client’s live subscription and jump straight into license editing.</p>
          </div>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter clients or keys…"
            className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white min-w-[220px]"
          />
        </div>

        <div className="divide-y divide-gray-700">
          {currentAssignments.map(({ company, license }) => (
            <div key={company.lodge_id} className="p-5 flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-white">{company.lodge_name}</p>
                <p className="text-xs text-gray-500 mt-1">{company.lodge_id}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {license ? (
                    <>
                      <span className="text-xs bg-gray-900 text-gray-300 px-2 py-1 rounded-full">{normalizePlanName(license.subscription_plan)}</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${statusTone(license.subscription_state || license.payment_status)}`}>{getLicenseStatusLabel(license)}</span>
                      <span className="text-xs bg-gray-900 text-gray-400 px-2 py-1 rounded-full">Due {fmtDate(license.next_due_date)}</span>
                    </>
                  ) : (
                    <span className="text-xs bg-red-500/15 text-red-300 px-2 py-1 rounded-full">No active assignment</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => (license ? startEdit(license) : startCreate(company))}
                className="text-sm bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-xl"
              >
                {license ? 'Edit assignment' : 'Assign license'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="bg-gray-800 rounded-2xl border border-gray-700 p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{editingLicense ? 'Edit assignment' : 'Create assignment'}</h3>
          <p className="text-sm text-gray-400 mt-1">Generate a fresh key or update an existing subscription record for a client.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-green-700 bg-green-950/40 px-3 py-2 text-sm text-green-300">
            {notice}
          </div>
        )}

        <div>
          <label className="text-xs text-gray-400 block mb-1">Client</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
            value={form.lodge_id}
            onChange={(event) => {
              const company = companyById.get(lodgeKey(event.target.value))
              setForm((current) => ({
                ...current,
                lodge_id: company?.lodge_id || '',
                lodge_name: company?.lodge_name || '',
                business_type: company?.business_type || 'lodge'
              }))
            }}
            required
          >
            <option value="">Select client…</option>
            {(companies || []).map((company) => (
              <option key={company.lodge_id} value={company.lodge_id}>{company.lodge_name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Plan</label>
            <select className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.subscription_plan} onChange={(event) => setForm((current) => ({ ...current, subscription_plan: event.target.value }))}>
              {SUBSCRIPTION_PLAN_ORDER.map((planName) => (
                <option key={planName} value={planName}>
                  {planName} - {getSubscriptionPlan(planName).headline}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Payment status</label>
            <select className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.payment_status} onChange={(event) => setForm((current) => ({ ...current, payment_status: event.target.value }))}>
              {['active', 'free', 'trial', 'overdue', 'suspended', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Monthly fee</label>
            <input className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.monthly_fee} onChange={(event) => setForm((current) => ({ ...current, monthly_fee: event.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Currency</label>
            <input className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Duration</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
              value={form.duration}
              onChange={(e) => {
                const dur = e.target.value
                const d = new Date()
                let nextVal = ''
                if (dur === 'monthly') d.setMonth(d.getMonth() + 1)
                else if (dur === 'quarterly') d.setMonth(d.getMonth() + 3)
                else if (dur === 'half_year') d.setMonth(d.getMonth() + 6)
                else if (dur === 'yearly') d.setFullYear(d.getFullYear() + 1)

                if (dur) nextVal = formatLocalDate(d)

                setForm(f => ({
                  ...f,
                  duration: dur,
                  next_due_date: nextVal || f.next_due_date
                }))
              }}
            >
              <option value="">Manual Selection</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="half_year">Half-Year</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Next due date</label>
            <input type="date" className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.next_due_date} onChange={(event) => setForm((current) => ({ ...current, next_due_date: event.target.value, duration: '' }))} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Expiry date</label>
            <input type="date" className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.expires_at} onChange={(event) => setForm((current) => ({ ...current, expires_at: event.target.value, duration: '' }))} />
            {form.expires_at && (
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, expires_at: '' }))}
                className="mt-1 text-xs text-gray-400 hover:text-gray-200"
              >
                Clear expiry
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Notes</label>
          <textarea className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white h-24 resize-none" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </div>

        <div className="flex gap-3">
          {editingLicense && (
            <button type="button" onClick={() => { setEditingLicense(null); startCreate(null) }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 py-2.5 rounded-xl">
              Cancel edit
            </button>
          )}
          <button type="submit" disabled={saving} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl font-semibold">
            {saving ? 'Saving…' : editingLicense ? 'Save assignment' : 'Generate and assign key'}
          </button>
        </div>
      </form>
    </div>
  )
}

function OverrideDesk({ companies, licenses }) {
  const [selectedLodge, setSelectedLodge] = useState('')
  const [flags, setFlags] = useState({})
  const [overrideDetails, setOverrideDetails] = useState({})
  const [loading, setLoading] = useState(false)
  const [savingFeature, setSavingFeature] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideExpiresAt, setOverrideExpiresAt] = useState('')
  const [overrideReviewAt, setOverrideReviewAt] = useState('')

  const activeLicenseByLodge = useMemo(() => {
    return buildAssignedLicenseMap(licenses)
  }, [licenses])

  const selectedPlan = useMemo(() => normalizePlanName(activeLicenseByLodge.get(lodgeKey(selectedLodge))?.subscription_plan), [activeLicenseByLodge, selectedLodge])

  useEffect(() => {
    if (!selectedLodge) return
    setLoading(true)
    window.api.admin.getLodgeFeatures(selectedLodge).then((rows) => {
      const nextFlags = {}
      const nextDetails = {}
        ; (rows || []).forEach((row) => {
          nextFlags[row.feature_name] = row.enabled
          nextDetails[row.feature_name] = row
        })
      setFlags(nextFlags)
      setOverrideDetails(nextDetails)
    }).finally(() => setLoading(false))
  }, [selectedLodge])

  const saveOverride = async (featureName, enabled) => {
    if (!selectedLodge) return
    setSavingFeature(featureName)
    const baseValue = PLAN_FLAGS[selectedPlan]?.[featureName] === true
    const metadata = {
      reason: overrideReason.trim() || null,
      expires_at: overrideExpiresAt ? `${overrideExpiresAt}T23:59:59` : null,
      review_at: overrideReviewAt ? `${overrideReviewAt}T23:59:59` : null
    }
    try {
      if (enabled === baseValue) {
        await window.api.admin.clearLodgeFeature(selectedLodge, featureName)
        setFlags((current) => {
          const next = { ...current }
          delete next[featureName]
          return next
        })
        setOverrideDetails((current) => {
          const next = { ...current }
          delete next[featureName]
          return next
        })
      } else {
        await window.api.admin.setLodgeFeature(selectedLodge, featureName, enabled, metadata)
        setFlags((current) => ({ ...current, [featureName]: enabled }))
        setOverrideDetails((current) => ({
          ...current,
          [featureName]: {
            ...(current[featureName] || {}),
            feature_name: featureName,
            enabled,
            reason: metadata.reason,
            expires_at: metadata.expires_at,
            review_at: metadata.review_at
          }
        }))
      }
    } finally {
      setSavingFeature('')
    }
  }

  return (
    <div className="grid xl:grid-cols-[0.8fr_1.2fr] gap-5">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5">
        <h3 className="text-lg font-semibold text-white">Override Target</h3>
        <p className="text-sm text-gray-400 mt-1">Pick a client, then override only the features that differ from the assigned plan.</p>
        <select
          className="w-full mt-4 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
          value={selectedLodge}
          onChange={(event) => setSelectedLodge(event.target.value)}
        >
          <option value="">Select client…</option>
          {(companies || []).map((company) => (
            <option key={company.lodge_id} value={company.lodge_id}>{company.lodge_name}</option>
          ))}
        </select>

        {selectedLodge && (
          <div className="mt-4 rounded-2xl bg-gray-900 p-4 border border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Assigned plan</p>
            <p className="text-lg font-semibold text-white mt-1">{selectedPlan}</p>
            <p className="text-sm text-gray-400 mt-2">Overrides are stored only when a feature differs from the plan baseline.</p>
            <div className="mt-4 grid gap-3">
              <input
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Reason for the next override"
                className="w-full bg-black/20 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={overrideExpiresAt}
                  onChange={(event) => setOverrideExpiresAt(event.target.value)}
                  className="w-full bg-black/20 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
                />
                <input
                  type="date"
                  value={overrideReviewAt}
                  onChange={(event) => setOverrideReviewAt(event.target.value)}
                  className="w-full bg-black/20 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
                />
              </div>
              <p className="text-xs text-gray-500">Reason and dates apply to the next override you save. Leave them blank if the exception should just be immediate.</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal size={18} className="text-purple-300" />
          <h3 className="text-lg font-semibold text-white">Feature Overrides</h3>
        </div>

        {!selectedLodge ? (
          <p className="text-sm text-gray-500">Choose a client to view and manage overrides.</p>
        ) : loading ? (
          <p className="text-sm text-gray-500">Loading overrides…</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {FEATURE_ORDER.map((feature) => {
              const baseEnabled = PLAN_FLAGS[selectedPlan]?.[feature] === true
              const effectiveEnabled = Object.prototype.hasOwnProperty.call(flags, feature) ? flags[feature] : baseEnabled
              const overrideActive = Object.prototype.hasOwnProperty.call(flags, feature)
              const detail = overrideDetails[feature] || null
              return (
                <div key={feature} className="rounded-2xl border border-gray-700 bg-gray-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{FEATURE_LABELS[feature]}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Base: {baseEnabled ? 'Enabled' : 'Disabled'}{overrideActive ? ' · overridden' : ''}
                      </p>
                      {overrideActive && (detail?.reason || detail?.expires_at || detail?.review_at) && (
                        <p className="text-xs text-gray-500 mt-2">
                          {detail?.reason ? `Reason: ${detail.reason}` : 'Temporary exception'}
                          {detail?.expires_at ? ` · Ends ${fmtDate(detail.expires_at)}` : ''}
                          {detail?.review_at ? ` · Review ${fmtDate(detail.review_at)}` : ''}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => saveOverride(feature, !effectiveEnabled)}
                      disabled={savingFeature === feature}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold ${effectiveEnabled ? 'bg-green-500/15 text-green-300' : 'bg-gray-700 text-gray-300'
                        }`}
                    >
                      {savingFeature === feature ? 'Saving…' : effectiveEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ClientHealthDesk({ companies, licenses, tickets, onApprove }) {
  const today = new Date()
  const activeLicenses = Array.from(buildAssignedLicenseMap(licenses).values())
  const assignedLodgeIds = new Set(activeLicenses.map((license) => lodgeKey(license.lodge_id)))

  const expiringSoon = activeLicenses.filter((license) => license.expires_at && new Date(license.expires_at) > today && (new Date(license.expires_at) - today) < 30 * 864e5)
  const overdue = activeLicenses.filter((license) => ['overdue', 'grace_period', 'suspended'].includes(String(license.subscription_state || license.payment_status || '').toLowerCase()))
  const unlicensed = (companies || []).filter((company) => !assignedLodgeIds.has(lodgeKey(company.lodge_id)))
  const openUpgrades = (tickets || []).filter((ticket) => ticket.status !== 'resolved' && ticket.category === 'Upgrade Request')

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
          <p className="text-2xl font-bold text-white">{activeLicenses.length}</p>
          <p className="text-sm text-gray-400 mt-1">Live assignments</p>
        </div>
        <div className="rounded-2xl border border-amber-700 bg-amber-950/20 p-5">
          <p className="text-2xl font-bold text-amber-300">{expiringSoon.length}</p>
          <p className="text-sm text-amber-200/70 mt-1">Expiring in 30 days</p>
        </div>
        <div className="rounded-2xl border border-red-700 bg-red-950/20 p-5">
          <p className="text-2xl font-bold text-red-300">{overdue.length + unlicensed.length}</p>
          <p className="text-sm text-red-200/70 mt-1">Immediate follow-up</p>
        </div>
        <div className="rounded-2xl border border-purple-700 bg-purple-950/20 p-5">
          <p className="text-2xl font-bold text-purple-300">{openUpgrades.length}</p>
          <p className="text-sm text-purple-200/70 mt-1">Open upgrade requests</p>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={17} className="text-amber-300" />
            <h3 className="text-lg font-semibold text-white">Renewal Radar</h3>
          </div>
          <div className="space-y-3">
            {expiringSoon.slice(0, 8).map((license) => (
              <div key={license.id} className="rounded-xl bg-gray-900 border border-gray-700 p-4">
                <p className="font-semibold text-white">{license.lodge_name}</p>
                <p className="text-sm text-gray-400 mt-1">{normalizePlanName(license.subscription_plan)} · expires {fmtDate(license.expires_at)}</p>
              </div>
            ))}
            {expiringSoon.length === 0 && <p className="text-sm text-gray-500">No licenses expiring in the next 30 days.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={17} className="text-red-300" />
            <h3 className="text-lg font-semibold text-white">Needs Attention</h3>
          </div>
          <div className="space-y-3">
            {unlicensed.slice(0, 6).map((company) => (
              <div key={company.lodge_id} className="rounded-xl bg-gray-900 border border-gray-700 p-4">
                <p className="font-semibold text-white">{company.lodge_name}</p>
                <p className="text-sm text-red-300 mt-1">No active license assignment</p>
              </div>
            ))}
            {overdue.slice(0, 6).map((license) => (
              <div key={license.id} className="rounded-xl bg-gray-900 border border-gray-700 p-4">
                <p className="font-semibold text-white">{license.lodge_name}</p>
                <p className="text-sm text-amber-300 mt-1">Payment is overdue · due {fmtDate(license.next_due_date)}</p>
              </div>
            ))}
            {unlicensed.length === 0 && overdue.length === 0 && <p className="text-sm text-gray-500">Everything looks healthy right now.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-purple-700 bg-purple-950/20 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={17} className="text-purple-300" />
          <h3 className="text-lg font-semibold text-white">Upgrade Pipeline</h3>
        </div>
        <div className="space-y-3">
          {openUpgrades.slice(0, 8).map((ticket) => {
            const parsed = parseUpgradeRequest(ticket.description)
            return (
              <div key={ticket.id} className="rounded-xl bg-gray-900 border border-purple-900/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{ticket.lodge_name || ticket.lodge_id}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {parsed.requestedPlan && (
                        <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                          {parsed.requestedPlan}
                        </span>
                      )}
                      {parsed.blockedFeature && (
                        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                          {parsed.blockedFeature}
                        </span>
                      )}
                    </div>
                    {parsed.businessNeed && (
                      <p className="mt-3 text-sm text-purple-100/85">{parsed.businessNeed}</p>
                    )}
                  </div>
                  <span className="rounded-full bg-purple-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
                    {String(ticket.status || 'open').replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={() => onApprove(ticket)}
                    className="mt-2 text-[10px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded-md font-bold uppercase tracking-wider"
                  >
                    Approve & License
                  </button>
                </div>
              </div>
            )
          })}
          {openUpgrades.length === 0 && <p className="text-sm text-gray-500">No open upgrade opportunities right now.</p>}
        </div>
      </div>
    </div>
  )
}

export default function LicensingWorkbench({ companies, licenses, tickets, onRefresh }) {
  const [tab, setTab] = useState('plans')
  const [prefill, setPrefill] = useState(null)

  const handleApprove = (ticket) => {
    const parsed = parseUpgradeRequest(ticket.description)
    setPrefill({
      lodge_id: ticket.lodge_id,
      lodge_name: ticket.lodge_name || ticket.lodge_id,
      subscription_plan: parsed.requestedPlan || 'Standard',
      notes: `Approved upgrade request: ${ticket.id}. ${parsed.businessNeed || ''}`
    })
    setTab('assignments')
  }

  const tabs = [
    { key: 'plans', label: 'Plans', icon: Layers3 },
    { key: 'assignments', label: 'Assignments', icon: CreditCard },
    { key: 'overrides', label: 'Overrides', icon: SlidersHorizontal },
    { key: 'health', label: 'Client Health', icon: ShieldCheck }
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Licensing Workbench</h2>
          <p className="text-sm text-gray-400 mt-1">Manage the full subscription lifecycle from plan definition through overrides and renewal risk.</p>
        </div>
        <button onClick={onRefresh} className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-2 rounded-xl border border-gray-700 text-sm">
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'
              }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'plans' && <PlanCatalog licenses={licenses} />}
      {tab === 'assignments' && <AssignmentDesk companies={companies} licenses={licenses} onRefresh={onRefresh} prefill={prefill} clearPrefill={() => setPrefill(null)} />}
      {tab === 'overrides' && <OverrideDesk companies={companies} licenses={licenses} />}
      {tab === 'health' && <ClientHealthDesk companies={companies} licenses={licenses} tickets={tickets} onApprove={handleApprove} />}
    </div>
  )
}
