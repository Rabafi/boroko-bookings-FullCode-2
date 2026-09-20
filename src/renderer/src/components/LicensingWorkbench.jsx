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
  getPlanUsageLimits,
  getSubscriptionPlan,
  normalizeSubscriptionPlan
} from '../../../shared/subscriptionPlans'
import { formatLocalDate } from '../utils/localDate'
import { getCommercialAddonOffers, getCommercialOffers, isCommercialSelectionEligible } from '../../../shared/commercialEntitlements'
import { formatCommercialMoney } from '../../../shared/commercialPackages'
import { getProductFamilyLabel, resolveProductFamily } from '../../../shared/productIdentity'
import { ErrorNotice } from './shared/ErrorNotice'

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

const ADDON_OVERRIDE_GROUPS = [
  {
    key: 'website_online_payments',
    label: 'Website + Online Payments',
    description: 'Direct booking website readiness, online payment setup, and payment confirmation plumbing.',
    features: ['custom_website', 'payment_gateway', 'advanced_booking_engine']
  },
  {
    key: 'guest_experience',
    label: 'Guest Experience Suite',
    description: 'Guest portal, guest messaging, and richer guest profiles.',
    features: ['guest_portal', 'guest_messaging', 'guest_crm']
  },
  {
    key: 'revenue_distribution',
    label: 'Revenue & Distribution Suite',
    description: 'Channel manager, revenue manager, advanced rates, promo codes, and deeper reports.',
    features: ['channel_manager', 'advanced_rates', 'rate_calendar', 'promo_codes', 'advanced_reports']
  },
  {
    key: 'enterprise_operations',
    label: 'Enterprise Operations Suite',
    description: 'Multi-property, multi-outlet POS, group operations, and operational compliance.',
    features: ['multi_property', 'multi_outlet_pos', 'group_operations', 'operations_compliance']
  }
]

function normalizePlanName(plan) {
  return normalizeSubscriptionPlan(plan)
}

function getCompanyProductId(company, license = null) {
  return license?.product_id || resolveProductFamily(company?.property_type || company?.business_type || license?.business_type)
}

function getCompanyOperatingProfile(company, license = null) {
  const configured = company?.operating_profile?.hospitality_mode
    || company?.operating_profile
    || license?.operating_profile
    || null
  // This is the same conservative default used by the server for older
  // hospitality settings rows. It intentionally never exposes Bar-only SKUs
  // unless the persisted company profile says bar_only.
  return configured || (getCompanyProductId(company, license) === 'hospitality-pos' ? 'restaurant_bar' : null)
}

function getEligibleCommercialOffers({ productId, operatingProfile }) {
  return getCommercialOffers(productId).filter((offer) => isCommercialSelectionEligible({
    productId,
    commercialPackageKey: offer.commercialPackageKey,
    operatingProfile
  }))
}

function getEligibleCommercialAddons({ productId, propertyType, operatingProfile, commercialPackageKey }) {
  return getCommercialAddonOffers(productId, propertyType)
    .filter((addon) => !addon.eligiblePackageKeys || addon.eligiblePackageKeys.includes(commercialPackageKey))
    .filter((addon) => !addon.eligibleOperatingProfiles || addon.eligibleOperatingProfiles.length === 0 || addon.eligibleOperatingProfiles.includes(operatingProfile))
}

function getCompanyOffer(company, license = null) {
  const offers = getEligibleCommercialOffers({
    productId: getCompanyProductId(company, license),
    operatingProfile: getCompanyOperatingProfile(company, license)
  })
  return offers.find((offer) => offer.commercialPackageKey === license?.commercial_package_key)
    || offers.find((offer) => offer.internalPlan === normalizePlanName(license?.subscription_plan))
    || offers[0]
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

function getAssignmentLabel(company, license) {
  const state = String(license?.subscription_state || license?.payment_status || '').toLowerCase()
  if (state === 'trial' || String(license?.payment_status || '').toLowerCase() === 'trial') return 'Trial'
  if (!license?.commercial_package_key) return `${normalizePlanName(license?.subscription_plan)} (legacy)`
  return getCompanyOffer(company, license)?.displayName || normalizePlanName(license?.subscription_plan)
}

function lodgeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function assignmentKey(lodgeId, productId) {
  return `${lodgeKey(lodgeId)}::${String(productId || '').trim().toLowerCase()}`
}

function selectedAddonKeys(license) {
  const snapshot = license?.commercial_pricing_snapshot?.selection?.selected_addon_keys
  if (Array.isArray(snapshot)) return [...new Set(snapshot.map((key) => String(key).trim()).filter(Boolean))]
  if (Array.isArray(license?.selected_addon_keys)) return [...new Set(license.selected_addon_keys.map((key) => String(key).trim()).filter(Boolean))]
  return []
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
    const key = assignmentKey(license.lodge_id, license.product_id || resolveProductFamily(license.business_type))
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
  const countsByPackage = useMemo(() => {
    return (licenses || []).reduce((accumulator, license) => {
      if (!isAssignedLicense(license)) return accumulator
      const productId = license.product_id || 'lodge-camp'
      const packageKey = license.commercial_package_key
        || (productId === 'lodge-camp' ? normalizePlanName(license.subscription_plan).toLowerCase() : '')
      const key = `${productId}:${packageKey}`
      accumulator[key] = (accumulator[key] || 0) + 1
      return accumulator
    }, {})
  }, [licenses])

  const productCatalogs = [
    ['lodge-camp', 'LodgingOS'],
    ['hotel', 'HotelOS'],
    ['hospitality-pos', 'Restaurant & Bar POS']
  ].map(([productId, label]) => ({ productId, label, offers: getCommercialOffers(productId) }))

  return (
    <div className="space-y-5">
      {productCatalogs.map(({ productId, label, offers }) => (
        <section key={productId} className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{label}</h3>
            <p className="text-sm text-gray-400">Product-specific packages and included workflows.</p>
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
          {offers.map((offer) => {
            const limits = productId === 'lodge-camp' ? getPlanUsageLimits(offer.internalPlan) : null
            const included = (offer.includedFeatures || []).slice(0, 8)
            return <div key={`${productId}:${offer.commercialPackageKey}`} className={`rounded-2xl border p-5 ${PLAN_COLORS[offer.internalPlan] || PLAN_COLORS.Pro}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-white">{offer.displayName}</p>
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {formatCommercialMoney(offer.priceBwp)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-300">{offer.salesCopy}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-900 text-gray-300">
                {countsByPackage[`${productId}:${offer.commercialPackageKey}`] || 0} clients
              </span>
            </div>
            {limits && <div className="mt-4 rounded-2xl border border-white/5 bg-black/10 p-3 text-xs text-gray-300">{limits.rooms} rooms · {limits.users} users · {limits.monthlyBookings} bookings/month</div>}
            <div className="mt-4 space-y-2">
              {included.map((feature) => (
                <div key={feature} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">{FEATURE_LABELS[feature] || feature.replace(/_/g, ' ')}</span>
                  <span className="text-green-300">Included</span>
                </div>
              ))}
              {(offer.includedFeatures || []).length > included.length && <p className="text-xs text-gray-500">+ {(offer.includedFeatures || []).length - included.length} more included workflows</p>}
            </div>
            </div>
          })}
          </div>
        </section>
      ))}
    </div>
  )
}

function AssignmentDesk({ companies, licenses, onRefresh, prefill, clearPrefill }) {
  const [editingLicense, setEditingLicense] = useState(null)
  const [form, setForm] = useState({
    lodge_id: '',
    lodge_name: '',
    business_type: 'lodge',
    operating_profile: null,
    product_id: 'lodge-camp',
    commercial_package_key: 'starter',
    subscription_plan: 'Starter',
    payment_status: 'active',
    monthly_fee: '',
    currency: 'BWP',
    selected_addon_keys: [],
    expires_at: '',
    next_due_date: '',
    notes: '',
    duration: ''
  })
  const [saving, setSaving] = useState(false)
  const [assignmentOperationId, setAssignmentOperationId] = useState(() => crypto.randomUUID())
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingUserRemediation, setPendingUserRemediation] = useState(null)
  const [remediationUsers, setRemediationUsers] = useState([])
  const [keepUserIds, setKeepUserIds] = useState([])
  const [remediating, setRemediating] = useState(false)

  useEffect(() => {
    if (prefill) {
      setForm((prev) => ({
        ...prev,
        ...prefill
      }))
      setFilter(prefill.lodge_name || '')
      setAssignmentOperationId(crypto.randomUUID())
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
      license: activeLicenses.get(assignmentKey(company.lodge_id, getCompanyProductId(company))) || null
    })).filter(({ company, license }) => {
      const needle = filter.trim().toLowerCase()
      if (!needle) return true
      return String(company.lodge_name || '').toLowerCase().includes(needle)
        || String(license?.license_key || '').toLowerCase().includes(needle)
    })
  }, [companies, filter, licenses])

  const startCreate = (company) => {
    const productId = getCompanyProductId(company)
    const offer = getCompanyOffer(company)
    setEditingLicense(null)
    setError('')
    setNotice('')
    setAssignmentOperationId(crypto.randomUUID())
    setForm({
      lodge_id: company?.lodge_id || '',
      lodge_name: company?.lodge_name || '',
      business_type: company?.business_type || 'lodge',
      operating_profile: getCompanyOperatingProfile(company),
      product_id: productId,
      commercial_package_key: offer?.commercialPackageKey || '',
      subscription_plan: offer?.internalPlan || 'Starter',
      payment_status: 'active',
      monthly_fee: '',
      currency: 'BWP',
      selected_addon_keys: [],
      expires_at: '',
      next_due_date: '',
      notes: '',
      duration: ''
    })
  }

  const startEdit = (license) => {
    const company = companyById.get(lodgeKey(license.lodge_id))
    const productId = getCompanyProductId(company, license)
    const offer = getCompanyOffer(company, license)
    const clearStaleExpiry = shouldClearStaleExpiry(license)
    setEditingLicense(license)
    setError('')
    setNotice(clearStaleExpiry ? 'This active assignment had an expired hard expiry date. Saving will clear that stale expiry and keep billing on the next due date.' : '')
    setAssignmentOperationId(crypto.randomUUID())
    setForm({
      lodge_id: license.lodge_id || '',
      lodge_name: license.lodge_name || company?.lodge_name || '',
      business_type: company?.business_type || license.business_type || 'lodge',
      operating_profile: getCompanyOperatingProfile(company, license),
      product_id: productId,
      commercial_package_key: offer?.commercialPackageKey || '',
      subscription_plan: offer?.internalPlan || normalizePlanName(license.subscription_plan),
      payment_status: license.payment_status || 'active',
      monthly_fee: license.monthly_fee ?? '',
      currency: license.currency || 'BWP',
      selected_addon_keys: selectedAddonKeys(license),
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
    const operationId = assignmentOperationId || crypto.randomUUID()
    if (!assignmentOperationId) setAssignmentOperationId(operationId)
    try {
      if (editingLicense) {
        if (String(editingLicense.id || '').startsWith('entitlement:')) {
          throw new Error('This assignment was recovered from entitlement data but no editable license row was returned. Refresh licenses, then open Supabase if this still appears.')
        }
        const result = await window.api.admin.assignCommercialSubscription({
          operation_id: operationId,
          license_id: editingLicense.id,
          lodge_id: form.lodge_id,
          lodge_name: form.lodge_name,
          product_id: form.product_id,
          commercial_package_key: form.commercial_package_key,
          subscription_plan: form.subscription_plan,
          payment_status: form.payment_status,
          monthly_fee: Number(form.monthly_fee || 0),
          currency: form.currency,
          selected_addon_keys: form.selected_addon_keys,
          expires_at: form.expires_at || null,
          next_due_date: form.next_due_date || null,
          notes: form.notes || null,
          activation_reason: form.notes
        })
        if (!result?.success) throw new Error(result?.error || 'Could not update license assignment')
        if (result?.status === 'pending_remediation' || result?.pending_remediation === true) {
          const blockerCopy = (result.blockers || []).map((item) => item.message).filter(Boolean).join(' ')
          setNotice(`${form.subscription_plan} is selected as the target package, but the current license was not changed yet. Complete the listed remediation and save again. ${blockerCopy}`.trim())
          const userBlocker = (result.blockers || []).find((item) => item.code === 'users_over_limit')
          if (userBlocker) {
            const users = await window.api.admin.getCompanyUsers(form.lodge_id).catch(() => [])
            setRemediationUsers((users || []).filter((user) => String(user.status || 'active').toLowerCase() === 'active'))
            setKeepUserIds([])
            setPendingUserRemediation({ ...userBlocker, targetPackageKey: form.commercial_package_key })
          }
          setAssignmentOperationId(crypto.randomUUID())
          return
        }
        setNotice('License assignment updated.')
      } else {
        const existing = buildAssignedLicenseMap(licenses).get(assignmentKey(form.lodge_id, form.product_id))
        if (existing && !existing._product_inferred) {
          startEdit(existing)
          throw new Error('This lodge already has an active assignment. I opened the existing license for editing instead.')
        }
        const result = await window.api.admin.assignCommercialSubscription({
            operation_id: operationId,
            lodge_id: form.lodge_id,
            lodge_name: form.lodge_name,
            business_type: form.business_type,
            product_id: form.product_id,
            commercial_package_key: form.commercial_package_key,
            subscription_plan: form.subscription_plan,
            payment_status: form.payment_status,
            monthly_fee: Number(form.monthly_fee || 0),
            currency: form.currency,
            selected_addon_keys: form.selected_addon_keys,
            expires_at: form.expires_at || null,
            next_due_date: form.next_due_date || null,
            notes: form.notes || null,
            activation_reason: form.notes
        })
        if (!result?.success) throw new Error(result?.error || 'Could not generate license')
        if (result?.status === 'pending_remediation' || result?.pending_remediation === true) {
          const blockerCopy = (result.blockers || []).map((item) => item.message).filter(Boolean).join(' ')
          setNotice(`${form.subscription_plan} is accepted as the target package, but activation is pending remediation. No users or records were changed. ${blockerCopy}`.trim())
          const userBlocker = (result.blockers || []).find((item) => item.code === 'users_over_limit')
          if (userBlocker) {
            const users = await window.api.admin.getCompanyUsers(form.lodge_id).catch(() => [])
            setRemediationUsers((users || []).filter((user) => String(user.status || 'active').toLowerCase() === 'active'))
            setKeepUserIds([])
            setPendingUserRemediation({ ...userBlocker, targetPackageKey: form.commercial_package_key })
          }
          setAssignmentOperationId(crypto.randomUUID())
          return
        }
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

  const applyUserRemediation = async () => {
    const required = Number(pendingUserRemediation?.limit || 0)
    if (keepUserIds.length !== required) return setError(`Select exactly ${required} active account(s) to retain.`)
    if (String(form.notes || '').trim().length < 8) return setError('Keep the assignment reason at 8 characters or longer before applying remediation.')
    setRemediating(true)
    setError('')
    try {
      const result = await window.api.admin.applyCommercialUserRemediation({
        lodge_id: form.lodge_id,
        product_id: form.product_id,
        target_package_key: pendingUserRemediation.targetPackageKey,
        keep_user_ids: keepUserIds,
        reason: form.notes.trim()
      })
      if (!result?.success) throw new Error(result?.error || 'Could not apply user remediation')
      setPendingUserRemediation(null)
      setRemediationUsers([])
      setKeepUserIds([])
      setAssignmentOperationId(crypto.randomUUID())
      setNotice(`${result.suspended_users || 0} overflow account(s) were suspended, not deleted, and their sessions were revoked. Save the assignment again to activate the selected package.`)
    } catch (err) { setError(err?.message || 'Could not apply user remediation') }
    finally { setRemediating(false) }
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
                      <span className="text-xs bg-gray-900 text-gray-300 px-2 py-1 rounded-full">{getProductFamilyLabel(getCompanyProductId(company, license))} · {getAssignmentLabel(company, license)}</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${statusTone(license.subscription_state || license.payment_status)}`}>{getLicenseStatusLabel(license)}</span>
                      <span className="text-xs bg-gray-900 text-gray-400 px-2 py-1 rounded-full">Due {fmtDate(license.next_due_date)}</span>
                    </>
                  ) : (
                    <span className="text-xs bg-red-500/15 text-red-300 px-2 py-1 rounded-full">No active assignment</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => (license?._product_inferred ? startCreate(company) : license ? startEdit(license) : startCreate(company))}
                className="text-sm bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-xl"
              >
                {license?._product_inferred ? 'Migrate assignment' : license ? 'Edit assignment' : 'Assign license'}
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
          <ErrorNotice className="rounded-xl border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </ErrorNotice>
        )}

        {notice && (
          <div className="rounded-xl border border-green-700 bg-green-950/40 px-3 py-2 text-sm text-green-300">
            {notice}
          </div>
        )}

        {pendingUserRemediation && (
          <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-4">
            <p className="font-semibold text-amber-200">Choose the {pendingUserRemediation.limit} account(s) that remain active</p>
            <p className="mt-1 text-xs leading-5 text-amber-200/70">All other active accounts will be suspended—not deleted—and their desktop/PWA sessions will be revoked. Starter must retain exactly one Admin owner.</p>
            <div className="mt-3 space-y-2">{remediationUsers.map((user) => {
              const checked = keepUserIds.includes(user.id)
              return <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-900/60 bg-black/20 px-3 py-2 text-sm text-gray-200"><input type="checkbox" checked={checked} onChange={() => setKeepUserIds((current) => checked ? current.filter((id) => id !== user.id) : current.length < Number(pendingUserRemediation.limit || 0) ? [...current, user.id] : current)} /><span className="flex-1">{user.name || user.email || user.id}</span><span className="text-xs uppercase text-gray-500">{user.role}</span></label>
            })}</div>
            <button type="button" onClick={applyUserRemediation} disabled={remediating || keepUserIds.length !== Number(pendingUserRemediation.limit || 0)} className="mt-3 w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{remediating ? 'Applying safely…' : `Suspend overflow and retain ${pendingUserRemediation.limit}`}</button>
          </div>
        )}

        <div>
          <label className="text-xs text-gray-400 block mb-1">Client</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white"
            value={form.lodge_id}
            onChange={(event) => {
              const company = companyById.get(lodgeKey(event.target.value))
              setAssignmentOperationId((current) => current || crypto.randomUUID())
              setForm((current) => ({
                ...current,
                lodge_id: company?.lodge_id || '',
                lodge_name: company?.lodge_name || '',
                business_type: company?.business_type || 'lodge',
                operating_profile: getCompanyOperatingProfile(company),
                product_id: getCompanyProductId(company),
                commercial_package_key: getCompanyOffer(company)?.commercialPackageKey || '',
                subscription_plan: getCompanyOffer(company)?.internalPlan || 'Starter',
                selected_addon_keys: []
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
            <label className="text-xs text-gray-400 block mb-1">App family</label>
            <div className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white">{getProductFamilyLabel(form.product_id)}</div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Entitlement package</label>
            <select className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.commercial_package_key} onChange={(event) => {
              const offer = getEligibleCommercialOffers({ productId: form.product_id, operatingProfile: form.operating_profile })
                .find((item) => item.commercialPackageKey === event.target.value)
              setForm((current) => {
                const selected_addon_keys = current.selected_addon_keys.filter((addonKey) => getEligibleCommercialAddons({
                  productId: current.product_id,
                  propertyType: current.business_type,
                  operatingProfile: current.operating_profile,
                  commercialPackageKey: event.target.value
                }).some((addon) => addon.addonKey === addonKey))
                return { ...current, commercial_package_key: event.target.value, subscription_plan: offer?.internalPlan || current.subscription_plan, selected_addon_keys }
              })
            }}>
              {getEligibleCommercialOffers({ productId: form.product_id, operatingProfile: form.operating_profile }).map((offer) => (
                <option key={offer.commercialPackageKey} value={offer.commercialPackageKey}>{offer.displayName} — {formatCommercialMoney(offer.priceBwp)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Payment status</label>
            <select className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white" value={form.payment_status} onChange={(event) => setForm((current) => ({ ...current, payment_status: event.target.value }))}>
              {['active', 'free', 'trial', 'overdue', 'suspended', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          {getEligibleCommercialAddons({ productId: form.product_id, propertyType: form.business_type, operatingProfile: form.operating_profile, commercialPackageKey: form.commercial_package_key }).length > 0 && (
            <div className="col-span-2 rounded-xl border border-gray-700 bg-gray-900/70 p-3">
              <p className="text-xs text-gray-400 mb-2">Commercial add-ons</p>
              <div className="grid md:grid-cols-2 gap-2">
                {getEligibleCommercialAddons({ productId: form.product_id, propertyType: form.business_type, operatingProfile: form.operating_profile, commercialPackageKey: form.commercial_package_key }).map((addon) => {
                  const checked = form.selected_addon_keys.includes(addon.addonKey)
                  return (
                    <label key={addon.addonKey} className="flex items-start gap-2 rounded-lg border border-gray-700 px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          selected_addon_keys: event.target.checked
                            ? [...new Set([...current.selected_addon_keys, addon.addonKey])]
                            : current.selected_addon_keys.filter((key) => key !== addon.addonKey)
                        }))}
                      />
                      <span>
                        <span className="block text-sm text-white">{addon.displayName} <span className="text-emerald-300">— {formatCommercialMoney(addon.annualPriceBwp || addon.oneTimePriceBwp)}{addon.annualPriceBwp ? '/year' : ''}</span></span>
                        <span className="block text-[11px] text-gray-500">{addon.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
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
          <label className="text-xs text-gray-400 block mb-1">Assignment reason and notes (minimum 8 characters)</label>
          <textarea required minLength="8" className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white h-24 resize-none" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
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

function LegacyOverrideDesk({ companies, licenses }) {
  const [selectedLodge, setSelectedLodge] = useState('')
  const [flags, setFlags] = useState({})
  const [overrideDetails, setOverrideDetails] = useState({})
  const [loading, setLoading] = useState(false)
  const [savingFeature, setSavingFeature] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideExpiresAt, setOverrideExpiresAt] = useState('')
  const [overrideReviewAt, setOverrideReviewAt] = useState('')

  const activeLicenseByAssignment = useMemo(() => {
    return buildAssignedLicenseMap(licenses)
  }, [licenses])

  const selectedPlan = useMemo(() => {
    const company = (companies || []).find((entry) => lodgeKey(entry.lodge_id) === lodgeKey(selectedLodge))
    return normalizePlanName(activeLicenseByAssignment.get(assignmentKey(selectedLodge, getCompanyProductId(company)))?.subscription_plan)
  }, [activeLicenseByAssignment, companies, selectedLodge])

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

  const saveAddonGroup = async (group, enabled) => {
    if (!selectedLodge) return
    setSavingFeature(group.key)
    const metadata = {
      reason: overrideReason.trim() || `Command Central ${enabled ? 'enabled' : 'disabled'} ${group.label}`,
      expires_at: overrideExpiresAt ? `${overrideExpiresAt}T23:59:59` : null,
      review_at: overrideReviewAt ? `${overrideReviewAt}T23:59:59` : null,
      addon_group: group.key
    }
    try {
      await Promise.all(group.features.map((featureName) => (
        enabled
          ? window.api.admin.setLodgeFeature(selectedLodge, featureName, true, metadata)
          : window.api.admin.clearLodgeFeature(selectedLodge, featureName)
      )))
      setFlags((current) => {
        const next = { ...current }
        for (const featureName of group.features) {
          if (enabled) next[featureName] = true
          else delete next[featureName]
        }
        return next
      })
      setOverrideDetails((current) => {
        const next = { ...current }
        for (const featureName of group.features) {
          if (enabled) {
            next[featureName] = {
              ...(current[featureName] || {}),
              feature_name: featureName,
              enabled: true,
              reason: metadata.reason,
              expires_at: metadata.expires_at,
              review_at: metadata.review_at
            }
          } else {
            delete next[featureName]
          }
        }
        return next
      })
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
          <Sparkles size={18} className="text-purple-300" />
          <h3 className="text-lg font-semibold text-white">Add-on Testing</h3>
        </div>

        {!selectedLodge ? (
          <p className="text-sm text-gray-500">Choose a client to enable or disable add-on bundles for testing.</p>
        ) : loading ? (
          <p className="text-sm text-gray-500">Loading add-ons…</p>
        ) : (
          <div className="grid gap-3">
            {ADDON_OVERRIDE_GROUPS.map((group) => {
              const enabledCount = group.features.filter((feature) => flags[feature] === true).length
              const fullyEnabled = enabledCount === group.features.length
              return (
                <div key={group.key} className="rounded-2xl border border-gray-700 bg-gray-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{group.label}</p>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{group.description}</p>
                      <p className="mt-2 text-xs text-gray-500">{enabledCount}/{group.features.length} module flags enabled</p>
                    </div>
                    <button
                      onClick={() => saveAddonGroup(group, !fullyEnabled)}
                      disabled={savingFeature === group.key}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        fullyEnabled ? 'bg-green-500/15 text-green-300' : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {savingFeature === group.key ? 'Saving…' : fullyEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {group.features.map((feature) => (
                      <span key={feature} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        flags[feature] === true ? 'bg-green-500/15 text-green-300' : 'bg-gray-700/70 text-gray-400'
                      }`}>
                        {FEATURE_LABELS[feature] || feature.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
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

function OverrideDesk({ companies, licenses }) {
  const [selectedLodge, setSelectedLodge] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [referencePackageKey, setReferencePackageKey] = useState('')
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [limitDrafts, setLimitDrafts] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const company = useMemo(() => (companies || []).find((row) => lodgeKey(row.lodge_id) === lodgeKey(selectedLodge)) || null, [companies, selectedLodge])
  const products = useMemo(() => {
    if (!selectedLodge) return []
    const result = new Set((licenses || []).filter((row) => lodgeKey(row.lodge_id) === lodgeKey(selectedLodge)).map((row) => row.product_id).filter(Boolean))
    result.add(getCompanyProductId(company))
    return [...result]
  }, [company, licenses, selectedLodge])
  const assigned = useMemo(() => buildAssignedLicenseMap(licenses), [licenses])
  const activeLicense = assigned.get(assignmentKey(selectedLodge, selectedProduct)) || null
  const productOffers = useMemo(() => getCommercialOffers(selectedProduct), [selectedProduct])
  const referenceOffer = productOffers.find((offer) => offer.commercialPackageKey === referencePackageKey)
    || productOffers.find((offer) => offer.commercialPackageKey === activeLicense?.commercial_package_key)
    || productOffers[0]
    || null
  const selectedPlan = normalizePlanName(referenceOffer?.internalPlan || activeLicense?.subscription_plan || 'Starter')
  const baseFeatures = useMemo(() => new Set(referenceOffer?.includedFeatures || []), [referenceOffer])
  const featureKeys = useMemo(() => {
    const result = new Set()
    getCommercialOffers(selectedProduct).forEach((offer) => (offer.includedFeatures || []).forEach((key) => {
      if (/^[a-z][a-z0-9_.-]*$/.test(String(key || ''))) result.add(key)
    }))
    getCommercialAddonOffers(selectedProduct, company?.property_type || company?.business_type).forEach((addon) => (addon.includedFeatures || []).forEach((key) => result.add(key)))
    if (selectedProduct === 'lodge-camp') FEATURE_ORDER.forEach((key) => result.add(key))
    return [...result].sort((a, b) => (FEATURE_LABELS[a] || a).localeCompare(FEATURE_LABELS[b] || b))
  }, [company?.business_type, company?.property_type, selectedProduct])
  const activeOverrides = useMemo(() => {
    const result = new Map()
    const now = Date.now()
    for (const row of overrides) {
      if (row.revoked_at || (row.expires_at && new Date(row.expires_at).getTime() <= now)) continue
      const key = row.feature_key ? `feature:${row.feature_key}` : `limit:${row.limit_key}`
      if (!result.has(key)) result.set(key, row)
    }
    return result
  }, [overrides])
  const baseLimits = selectedProduct === 'lodge-camp' ? getPlanUsageLimits(selectedPlan) : null
  const limitDefinitions = useMemo(() => baseLimits ? [
    ['users', 'Active users', baseLimits.users],
    ['rooms', 'Rooms', baseLimits.rooms],
    ['monthly_bookings', 'Bookings per check-in month', baseLimits.monthlyBookings],
    ['booking_grace', 'Monthly booking grace', baseLimits.monthlyBookingsGrace]
  ] : [], [baseLimits])

  useEffect(() => { setSelectedProduct(products[0] || '') }, [products])
  useEffect(() => {
    const offers = getCommercialOffers(selectedProduct)
    const currentKey = activeLicense?.commercial_package_key
    setReferencePackageKey(offers.some((offer) => offer.commercialPackageKey === currentKey) ? currentKey : offers[0]?.commercialPackageKey || '')
  }, [activeLicense?.commercial_package_key, selectedLodge, selectedProduct])

  const reload = async () => {
    if (!selectedLodge || !selectedProduct) return
    setLoading(true)
    setError('')
    try {
      const rows = await window.api.admin.getCommercialEntitlementOverrides(selectedLodge, selectedProduct)
      setOverrides(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setOverrides([])
      setError(err?.message || 'Could not load commercial overrides')
    } finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [selectedLodge, selectedProduct])
  useEffect(() => {
    setLimitDrafts(Object.fromEntries(limitDefinitions.map(([key, , fallback]) => [key, String(activeOverrides.get(`limit:${key}`)?.limit_value ?? fallback ?? '')])))
  }, [activeOverrides, limitDefinitions])

  const envelope = () => {
    if (reason.trim().length < 8) throw new Error('Enter a reason of at least 8 characters before changing an entitlement.')
    return {
      lodge_id: selectedLodge,
      product_id: selectedProduct,
      reason: reason.trim(),
      expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null
    }
  }
  const runMutation = async (key, action, successMessage) => {
    setSavingKey(key); setError(''); setNotice('')
    try {
      const result = await action()
      if (!result?.success) throw new Error(result?.error || 'The override was not saved')
      setNotice(successMessage)
      await reload()
    } catch (err) { setError(err?.message || 'The override was not saved') }
    finally { setSavingKey('') }
  }
  const revoke = (row, label) => runMutation(
    row.feature_key ? `feature:${row.feature_key}` : `limit:${row.limit_key}`,
    () => window.api.admin.revokeCommercialEntitlementOverride({ ...envelope(), override_id: row.id }),
    `${label} now inherits the package default.`
  )
  const saveFeature = (feature, enabled) => runMutation(
    `feature:${feature}`,
    () => window.api.admin.setCommercialEntitlementOverride({ ...envelope(), feature_key: feature, enabled }),
    `${FEATURE_LABELS[feature] || feature.replace(/_/g, ' ')} is explicitly ${enabled ? 'enabled' : 'disabled'} for ${getProductFamilyLabel(selectedProduct)}.`
  )
  const saveLimit = (key, label) => {
    const value = Number(limitDrafts[key])
    if (!Number.isInteger(value) || value < 0) return setError(`${label} must be a non-negative whole number.`)
    return runMutation(
      `limit:${key}`,
      () => window.api.admin.setCommercialEntitlementOverride({ ...envelope(), limit_key: key, limit_value: value }),
      `${label} is now ${value} for this property.`
    )
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
      <div className="flex items-center gap-2"><SlidersHorizontal size={18} className="text-purple-300" /><h3 className="text-lg font-semibold text-white">Commercial Entitlement Control</h3></div>
      <p className="mt-1 text-sm text-gray-400">Package defaults stay intact. Exceptions are product-scoped, audited, expiring, and reversible.</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <select value={selectedLodge} onChange={(event) => setSelectedLodge(event.target.value)} className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white"><option value="">Choose a client…</option>{(companies || []).map((row) => <option key={row.lodge_id} value={row.lodge_id}>{row.lodge_name || row.company_name}</option>)}</select>
        <select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)} disabled={!selectedLodge} className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white disabled:opacity-50">{products.map((product) => <option key={product} value={product}>{getProductFamilyLabel(product)}</option>)}</select>
        <select value={referencePackageKey} onChange={(event) => setReferencePackageKey(event.target.value)} disabled={!selectedProduct} className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white disabled:opacity-50"><option value="">Package defaults to compare…</option>{productOffers.map((offer) => <option key={offer.commercialPackageKey} value={offer.commercialPackageKey}>{offer.displayName}{offer.commercialPackageKey === activeLicense?.commercial_package_key ? ' (currently active)' : ''}</option>)}</select>
      </div>
      {selectedLodge && selectedProduct && referenceOffer && <p className="mt-2 text-xs text-gray-500">Comparing against {referenceOffer.displayName} defaults. This selector does not change the live licence; saved overrides remain attached to this client and product.</p>}
      {selectedLodge && selectedProduct && <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.35fr]"><div><label className="mb-1 block text-xs text-gray-400">Mandatory reason (minimum 8 characters)</label><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Business reason for this exception or revocation" className="w-full rounded-xl border border-gray-700 bg-black/20 px-3 py-2 text-sm text-white" /></div><div><label className="mb-1 block text-xs text-gray-400">Optional expiry</label><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="w-full rounded-xl border border-gray-700 bg-black/20 px-3 py-2 text-sm text-white" /></div></div>}
      {error && <ErrorNotice className="mt-3 rounded-xl border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</ErrorNotice>}
      {notice && <p className="mt-3 rounded-xl border border-green-800 bg-green-950/30 px-3 py-2 text-sm text-green-300">{notice}</p>}
    </section>

    {selectedLodge && selectedProduct === 'lodge-camp' && <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
      <div className="flex items-center gap-2"><Users size={18} className="text-blue-300" /><h3 className="text-lg font-semibold text-white">Numeric Allowances</h3></div>
      <p className="mt-1 text-xs text-gray-500">For example, set Active users to 3 to let this Starter property create and retain a third account.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{limitDefinitions.map(([key, label, fallback]) => {
        const row = activeOverrides.get(`limit:${key}`)
        return <div key={key} className="rounded-2xl border border-gray-700 bg-gray-900/80 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{label}</p><p className="mt-1 text-xs text-gray-500">Package default: {fallback}{row ? ' · overridden' : ''}</p>{row?.reason && <p className="mt-2 text-xs text-gray-500">{row.reason}{row.expires_at ? ` · ends ${fmtDate(row.expires_at)}` : ''}</p>}</div>{row && <button onClick={() => revoke(row, label)} disabled={savingKey === `limit:${key}`} className="text-xs font-semibold text-amber-300">Use default</button>}</div><div className="mt-3 flex gap-2"><input type="number" min="0" step="1" value={limitDrafts[key] ?? ''} onChange={(event) => setLimitDrafts((current) => ({ ...current, [key]: event.target.value }))} className="min-w-0 flex-1 rounded-xl border border-gray-700 bg-black/20 px-3 py-2 text-sm text-white" /><button onClick={() => saveLimit(key, label)} disabled={savingKey === `limit:${key}`} className="rounded-xl bg-purple-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingKey === `limit:${key}` ? 'Saving…' : 'Save override'}</button></div></div>
      })}</div>
    </section>}

    <section className="rounded-2xl border border-gray-700 bg-gray-800 p-5">
      <div className="flex items-center gap-2"><Sparkles size={18} className="text-purple-300" /><h3 className="text-lg font-semibold text-white">Every Product Feature</h3></div>
      <p className="mt-1 text-xs text-gray-500">Only the selected product's catalogue is shown. Roles, tenancy, audit, security, ledgers, and product identity are never overrideable.</p>
      {!selectedLodge ? <p className="mt-4 text-sm text-gray-500">Choose a client to manage feature exceptions.</p> : loading ? <p className="mt-4 text-sm text-gray-500">Loading authoritative overrides…</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{featureKeys.map((feature) => {
        const row = activeOverrides.get(`feature:${feature}`)
        const baseEnabled = baseFeatures.has(feature) || (selectedProduct === 'lodge-camp' && PLAN_FLAGS[selectedPlan]?.[feature] === true)
        const effective = row ? row.enabled !== false : baseEnabled
        return <div key={feature} className="rounded-2xl border border-gray-700 bg-gray-900/80 p-4"><p className="font-semibold text-white">{FEATURE_LABELS[feature] || feature.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-gray-500">Package: {baseEnabled ? 'Enabled' : 'Disabled'} · Effective: {effective ? 'Enabled' : 'Disabled'}{row ? ' · overridden' : ''}</p>{row?.reason && <p className="mt-2 text-xs text-gray-500">{row.reason}{row.expires_at ? ` · ends ${fmtDate(row.expires_at)}` : ''}</p>}<div className="mt-3 flex flex-wrap gap-2"><button onClick={() => saveFeature(feature, true)} disabled={savingKey === `feature:${feature}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${row?.enabled === true ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-300'}`}>Force on</button><button onClick={() => saveFeature(feature, false)} disabled={savingKey === `feature:${feature}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${row?.enabled === false ? 'bg-red-500/20 text-red-300' : 'bg-gray-700 text-gray-300'}`}>Force off</button>{row && <button onClick={() => revoke(row, FEATURE_LABELS[feature] || feature)} disabled={savingKey === `feature:${feature}`} className="rounded-full px-3 py-1.5 text-xs font-semibold text-amber-300">Use package default</button>}</div></div>
      })}</div>}
    </section>
  </div>
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
