import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Key,
  ShieldCheck,
  Sparkles,
  Hash,
  Lock,
  RefreshCw
} from 'lucide-react'
import { useAccess, useAuth, useSettings } from '../app-context'
import {
  APP_FEATURES,
  FEATURE_LABELS,
  canAccessCapability
} from '../../../shared/accessControl'
import {
  MONTHLY_USAGE_RESET_COPY,
  SUBSCRIPTION_PLAN_ORDER,
  countMonthlyUsageBookings,
  getFeatureRequiredPlan,
  getPlanRecommendation,
  getEffectiveUsageLimits,
  getUsageLimitStatus,
  formatPlanLimits,
  normalizeSubscriptionPlan,
  buildUpgradeRequestDescription
} from '../../../shared/subscriptionPlans'
import {
  ENTERPRISE_ADDON_STATUS,
  isEnterpriseAddonEnabled
} from '../../../shared/enterpriseAddons'
import {
  getCommercialPackageCatalog,
  getCommercialPackageDisplayName,
  getAdvertisedEnterpriseAddons
} from '../../../shared/commercialPackages'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { isCommercialFeatureIncluded } from '../../../shared/commercialAccess.js'
import UsageLimitIndicator from './shared/UsageLimitIndicator'
import {
  PostTrialImpactPreview,
  TrialFeatureLabel,
  getTrialTargetPlan
} from './shared/EntitlementPresentation'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_HOTEL_PRODUCT = BUILD_PRODUCT.id === 'hotel'
const IS_POS_PRODUCT = BUILD_PRODUCT.id === 'hospitality-pos'
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(currency, value) {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return `${currency || 'BWP'} ${amount.toFixed(2)}`
}

function humanStatus(status) {
  if (!status) return 'Not stated'
  return String(status).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function paymentBadge(status) {
  if (!status) return <span className="text-sm text-gray-500">Not stated</span>
  const map = {
    active: 'bg-green-100 text-green-700',
    free: 'bg-blue-100 text-blue-700',
    trial: 'bg-blue-100 text-blue-700',
    grace_period: 'bg-amber-100 text-amber-700',
    overdue: 'bg-amber-100 text-amber-700',
    pending: 'bg-amber-100 text-amber-700',
    draft: 'bg-slate-100 text-slate-700',
    posted: 'bg-blue-100 text-blue-700',
    issued: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-red-100 text-red-700',
    written_off: 'bg-red-100 text-red-700',
    suspended: 'bg-red-100 text-red-700',
    cancelled: 'bg-red-100 text-red-700',
    expired: 'bg-red-100 text-red-700',
    offline_lease_expired: 'bg-red-100 text-red-700'
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${map[String(status).toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
      {humanStatus(status)}
    </span>
  )
}

function invoiceStatus(invoice) {
  if (invoice?.status) return invoice.status
  const balance = invoice?.balance_due
  if (balance !== null && balance !== undefined && Number(balance) <= 0) return 'paid'
  return 'issued'
}

function getRecommendedUpgradePlan(currentPlan) {
  const normalizedPlan = normalizeSubscriptionPlan(currentPlan)
  if (IS_HOTEL_PRODUCT || IS_POS_PRODUCT) return null
  if (normalizedPlan === 'Starter') return 'Standard'
  if (normalizedPlan === 'Standard') return 'Pro'
  return null
}

function StatusHero({ licenseStatus, selectedTargetPackage = null, currentPackage = null }) {
  if (!licenseStatus) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm" data-testid="subscription-status-loading">
        <p className="text-sm text-gray-500">Checking your subscription…</p>
      </div>
    )
  }

  const trial = licenseStatus.status === 'trial'
  const licensed = licenseStatus.status === 'licensed'
  const expired = licenseStatus.expired === true
  const subscriptionState = String(licenseStatus.subscription_state || licenseStatus.payment_status || licenseStatus.status || '').toLowerCase()
  const planLabel = licensed
    ? getCommercialPackageDisplayName({
        productId: BUILD_PRODUCT.id,
        commercialPackageKey: licenseStatus.commercial_package_key,
        plan: licenseStatus.plan || 'Starter'
      })
    : 'Trial'
  const tone = licensed ? 'green' : expired ? 'red' : 'blue'
  const toneClasses = {
    green: 'from-green-700 via-emerald-700 to-teal-700 text-white',
    blue: 'from-blue-700 via-cyan-700 to-sky-700 text-white',
    red: 'from-red-700 via-rose-700 to-orange-700 text-white'
  }

  return (
    <section className={`rounded-3xl bg-gradient-to-br p-6 shadow-sm ${toneClasses[tone]}`} aria-labelledby="subscription-status-heading">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {licensed ? <ShieldCheck size={13} /> : expired ? <AlertTriangle size={13} /> : <Clock size={13} />}
            {licensed ? 'Subscription active' : expired ? 'Action required' : 'Trial'}
          </div>
          <h2 id="subscription-status-heading" className="mt-4 text-2xl font-bold">
            {licensed
              ? `${planLabel} is active`
              : expired
                ? 'Access is paused until this property is activated'
                : `${licenseStatus.daysLeft || 0} day${licenseStatus.daysLeft === 1 ? '' : 's'} left in your trial`}
          </h2>
          <p className="mt-2 text-sm text-white/85">
            {licensed
              ? subscriptionState === 'grace_period'
                ? 'Your property is still running, but a payment needs attention before the grace period ends.'
                : 'Your property is licensed. The subscription controls the modules available to this property.'
              : expired
                ? subscriptionState === 'offline_lease_expired'
                  ? 'Reconnect to refresh the subscription and restore access. Do not activate a second key while a refresh is pending.'
                  : 'The trial has ended. Activate a purchased subscription to restore access.'
                : 'The trial opens the full feature set so you can test the workflows before choosing a package.'}
          </p>
          {trial && (
            <div className="mt-4">
              <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white/95">
                <span>{licenseStatus.daysLeft ?? '—'} day{Number(licenseStatus.daysLeft) === 1 ? '' : 's'} left</span>
                <span className="text-white/55">·</span>
                <span>Preview after trial: {selectedTargetPackage?.displayName || selectedTargetPackage?.name || 'No package selected · access pauses'}</span>
              </div>
              <p className="mt-2 text-xs text-white/75">Choosing a package only sets a preview and request target. It does not activate or charge anything.</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:min-w-[320px] lg:max-w-md">
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Current plan</p>
            <p className="mt-1 text-lg font-bold">{planLabel}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Current price</p>
            <p className="mt-1 text-sm font-semibold">{licensed ? currentPackage?.priceLabel || 'See your invoice' : 'No paid plan active'}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Standing</p>
            <div className="mt-2">{paymentBadge(licenseStatus.payment_status || licenseStatus.subscription_state || licenseStatus.status)}</div>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Next payment / renewal</p>
            <p className="mt-1 text-sm font-semibold">{fmtDate(licenseStatus.next_due_date)}</p>
          </div>
        </div>
      </div>
      {(licenseStatus.grace_period_ends_at || licenseStatus.offline_valid_until) && (
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/15 pt-4 text-xs text-white/75">
          {licenseStatus.grace_period_ends_at && <span>Payment grace period ends {fmtDate(licenseStatus.grace_period_ends_at)}</span>}
          {licenseStatus.offline_valid_until && <span>Offline access is safe until {fmtDate(licenseStatus.offline_valid_until)}</span>}
        </div>
      )}
    </section>
  )
}

function BillingHistory({ canManageSubscription, billingState, onRetry }) {
  if (!canManageSubscription) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="billing-history-restricted">
        <p className="text-sm font-semibold text-amber-800">Billing details are restricted</p>
        <p className="mt-1 text-sm text-amber-700">Your role can review the plan, but only finance, manager, or admin-level users can view subscription invoices.</p>
      </div>
    )
  }

  if (billingState.status === 'loading' || billingState.status === 'idle') {
    return <p className="text-sm text-gray-500" data-testid="billing-history-loading">Loading subscription invoices…</p>
  }

  if (billingState.status === 'unavailable') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="billing-history-unavailable">
        <p className="text-sm font-semibold text-amber-800">Subscription invoices are temporarily unavailable</p>
        <p className="mt-1 text-sm text-amber-700">{billingState.message || 'Reconnect to the internet and try again. Your property plan above is still the last known status.'}</p>
        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800"><RefreshCw size={14} /> Try again</button>
      </div>
    )
  }

  if (billingState.status === 'error') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="billing-history-error">
        <p className="text-sm font-semibold text-red-800">We could not load subscription invoices</p>
        <p className="mt-1 text-sm text-red-700">{billingState.message || 'Please try again when you are online. No billing information was changed.'}</p>
        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800"><RefreshCw size={14} /> Try again</button>
      </div>
    )
  }

  if (billingState.status === 'empty') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="billing-history-empty">
        <p className="text-sm font-semibold text-slate-800">No subscription invoices yet</p>
        <p className="mt-1 text-sm text-slate-600">Invoices will appear here after Tsa Bonno records a subscription charge for this property.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="billing-history-list">
      {billingState.rows.slice(0, 12).map((invoice) => {
        const status = invoiceStatus(invoice)
        const total = invoice.total ?? invoice.amount
        const balance = invoice.balance_due
        const packageKey = invoice.commercial_package_key || invoice.commercial_package_name || invoice.package_name
        return (
          <article key={invoice.id || invoice.invoice_number} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-gray-800">{invoice.invoice_number || 'Subscription invoice'}</p>
                  {paymentBadge(status)}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {invoice.package_name || getCommercialPackageDisplayName({ productId: BUILD_PRODUCT.id, commercialPackageKey: packageKey, plan: invoice.commercial_package_key }) || 'Tsa Bonno subscription'}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-base font-semibold text-gray-800">{formatMoney(invoice.currency, total)}</p>
                <p className="mt-1 text-xs text-gray-500">Balance due: {formatMoney(invoice.currency, balance)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-xs text-gray-500">
              <span>Issued {fmtDate(invoice.issued_at || invoice.issued_date)}</span>
              {invoice.due_date && <span>Due {fmtDate(invoice.due_date)}</span>}
              {(invoice.paid_at || invoice.paid_date) && <span>Paid {fmtDate(invoice.paid_at || invoice.paid_date)}</span>}
            </div>
          </article>
        )
      })}
      {billingState.rows.length > 12 && <p className="text-xs text-gray-500">Showing the 12 most recent invoices.</p>}
    </div>
  )
}

export default function SubscriptionAccessPanel() {
  const { settings } = useSettings()
  const { user } = useAuth()
  const access = useAccess()
  const [searchParams] = useSearchParams()
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState(null)
  const [billingState, setBillingState] = useState({ status: 'idle', rows: [], message: '' })
  const [billingRefreshToken, setBillingRefreshToken] = useState(0)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeSending, setUpgradeSending] = useState(false)
  const [upgradeSent, setUpgradeSent] = useState(false)
  // This selection is only a preview/request target. It never activates a license.
  // The request selector is keyed by the commercial key: value={requestedPackageKey}.
  const [requestedPackageKey, setRequestedPackageKey] = useState(null)
  const [lodgeIdCopied, setLodgeIdCopied] = useState(false)
  const [usageCounts, setUsageCounts] = useState({ monthlyBookings: 0, rooms: 0, users: 0 })
  const [usageSource, setUsageSource] = useState('cache')
  const [lastUsageSyncAt, setLastUsageSyncAt] = useState(null)
  const requestedFeatureFromRoute = searchParams.get('feature') || ''

  const lodgeId = settings?.lodge_id || access?.entitlement?.lodge_id
  const canManageSubscription = canAccessCapability(access, 'settings.manage_subscription')
  const entitlementExpired = licenseStatus?.expired === true
  const licensedPlan = normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')
  const isEnterprisePlan = licensedPlan === 'Enterprise'
  const licensedPlanIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(licensedPlan)
  const enterpriseAddons = Array.isArray(licenseStatus?.enterprise_addons)
    ? licenseStatus.enterprise_addons
    : Array.isArray(access?.entitlement?.enterprise_addons)
      ? access.entitlement.enterprise_addons
      : []
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const commercialPackages = useMemo(() => getCommercialPackageCatalog(BUILD_PRODUCT.id), [])
  const currentCommercialPackageKey = licenseStatus?.commercial_package_key || access?.entitlement?.commercial_package_key || null
  const currentCommercialPackage = licenseStatus?.status === 'licensed'
    ? commercialPackages.find((plan) => currentCommercialPackageKey
      ? plan.commercialPackageKey === currentCommercialPackageKey
      : plan.internalPlan === licensedPlan) || null
    : null
  const selectedCommercialPackage = requestedPackageKey
    ? commercialPackages.find((plan) => plan.commercialPackageKey === requestedPackageKey) || null
    : null
  const eligibleAddons = useMemo(
    () => IS_HOTEL_PRODUCT ? getAdvertisedEnterpriseAddons(propertyType, BUILD_PRODUCT.id) : [],
    [propertyType]
  )
  const commercialEntitlement = licenseStatus || access?.entitlement || null

  const isFeatureEnabled = (featureName) => {
    if (entitlementExpired) return false
    if (IS_POS_PRODUCT && !isCommercialFeatureIncluded(
      BUILD_PRODUCT.id,
      currentCommercialPackageKey,
      featureName,
      enterpriseAddons,
      commercialEntitlement,
      commercialEntitlement?.lodge_id || lodgeId || null
    )) return false
    const effectiveFeatures = licenseStatus?.effective_features || {}
    if (Object.prototype.hasOwnProperty.call(effectiveFeatures, featureName)) {
      return effectiveFeatures[featureName] !== false
    }
    if (licenseStatus?.status === 'trial') return true
    const requiredPlan = getFeatureRequiredPlan(featureName)
    return licensedPlanIndex >= SUBSCRIPTION_PLAN_ORDER.indexOf(requiredPlan)
  }

  const refreshStatus = async ({ forceFresh = false } = {}) => {
    if (!lodgeId || !window.api?.trial?.getStatus) return
    const nextStatus = await window.api.trial.getStatus(lodgeId, { forceFresh: forceFresh === true }).catch(() => null)
    setLicenseStatus(nextStatus)
    return nextStatus
  }

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [lodgeId])

  useEffect(() => {
    let active = true
    const loadBillingHistory = async () => {
      if (!lodgeId || !canManageSubscription) {
        setBillingState({ status: 'restricted', rows: [], message: '' })
        return
      }
      if (!window.api?.trial?.getCommercialBillingHistory) {
        setBillingState({ status: 'unavailable', rows: [], message: 'The installed app does not support subscription invoice history yet.' })
        return
      }
      setBillingState({ status: 'loading', rows: [], message: '' })
      try {
        const response = await window.api.trial.getCommercialBillingHistory(lodgeId, BUILD_PRODUCT.id)
        if (!active) return
        if (response?.unavailable || response?.available === false) {
          setBillingState({ status: 'unavailable', rows: [], message: response.error || '' })
          return
        }
        if (response?.success === false) {
          setBillingState({ status: 'error', rows: [], message: response.error || '' })
          return
        }
        const rows = Array.isArray(response?.rows) ? response.rows : []
        setBillingState({ status: rows.length ? 'success' : 'empty', rows, message: '' })
      } catch (error) {
        if (!active) return
        setBillingState({
          status: navigator.onLine === false ? 'unavailable' : 'error',
          rows: [],
          message: error?.message || ''
        })
      }
    }
    loadBillingHistory().catch(() => {})
    return () => { active = false }
  }, [billingRefreshToken, canManageSubscription, lodgeId])

  useEffect(() => {
    if (!licenseStatus) return
    const currentKey = licenseStatus?.commercial_package_key || access?.entitlement?.commercial_package_key
    if (currentKey && commercialPackages.some((plan) => plan.commercialPackageKey === currentKey)) {
      setRequestedPackageKey(currentKey)
      return
    }
    // A trial has full access, so its plan is not a paid fallback. Use the
    // explicit future target when the server provides one.
    if (licenseStatus?.status === 'trial') {
      const trialTarget = getTrialTargetPlan({ entitlement: licenseStatus, fallback: null })
      const persistedPackageKey = lodgeId ? localStorage.getItem(`tsa-bonno:trial-target:${BUILD_PRODUCT.id}:${lodgeId}`) : null
      const trialPackage = (trialTarget && commercialPackages.find((plan) => plan.internalPlan === trialTarget))
        || (persistedPackageKey && commercialPackages.find((plan) => plan.commercialPackageKey === persistedPackageKey))
      if (trialPackage) setRequestedPackageKey(trialPackage.commercialPackageKey)
      return
    }
    const recommendedPlan = getRecommendedUpgradePlan(licenseStatus?.plan)
    const fallback = recommendedPlan || normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')
    const fallbackPackage = commercialPackages.find((plan) => plan.internalPlan === fallback)
      || commercialPackages[commercialPackages.length - 1]
    if (fallbackPackage) setRequestedPackageKey(fallbackPackage.commercialPackageKey)
  }, [access?.entitlement?.commercial_package_key, commercialPackages, licenseStatus?.commercial_package_key, licenseStatus?.plan, licenseStatus?.status, lodgeId])

  useEffect(() => {
    if (licenseStatus?.status !== 'trial' || !lodgeId || !requestedPackageKey) return
    localStorage.setItem(`tsa-bonno:trial-target:${BUILD_PRODUCT.id}:${lodgeId}`, requestedPackageKey)
  }, [licenseStatus?.status, lodgeId, requestedPackageKey])

  useEffect(() => {
    if (searchParams.get('upgrade') !== '1') return
    const requestedPlan = searchParams.get('requestedPlan')
    if (!requestedPlan) return
    const target = commercialPackages.find((plan) => plan.internalPlan === normalizeSubscriptionPlan(requestedPlan))
    if (target) setRequestedPackageKey(target.commercialPackageKey)
    setUpgradeOpen(true)
  }, [commercialPackages, searchParams])

  useEffect(() => {
    let active = true
    const loadUsage = async () => {
      if (window.api?.usage?.getSnapshot) {
        const snapshot = await window.api.usage.getSnapshot({ forceRemoteRefresh: navigator.onLine === true }).catch(() => null)
        if (snapshot && !snapshot.error) {
          if (!active) return
          setUsageCounts(snapshot.usage || { monthlyBookings: 0, rooms: 0, users: 0 })
          setUsageSource(snapshot.source || 'cache')
          setLastUsageSyncAt(snapshot.lastUsageSyncAt || null)
          return
        }
      }
      if (!window.api?.bookings?.getAll || !window.api?.rooms?.getAll || !window.api?.users?.getAll) return
      const [bookings, rooms, users] = await Promise.all([
        window.api.bookings.getAll().catch(() => []),
        window.api.rooms.getAll().catch(() => []),
        window.api.users.getAll().catch(() => [])
      ])
      const monthlyBookings = countMonthlyUsageBookings(bookings || [], new Date())
      if (!active) return
      setUsageCounts({
        monthlyBookings,
        rooms: Array.isArray(rooms) ? rooms.length : 0,
        users: Array.isArray(users) ? users.length : 0
      })
      setUsageSource('cache')
      setLastUsageSyncAt(null)
    }
    loadUsage().catch(() => {})
    return () => { active = false }
  }, [])

  const enabledFeatures = useMemo(
    () => APP_FEATURES.filter((featureName) => isFeatureEnabled(featureName)),
    [entitlementExpired, licenseStatus, licensedPlanIndex, currentCommercialPackageKey]
  )
  const usageLimits = getEffectiveUsageLimits(licenseStatus || {}, licenseStatus?.plan || 'Starter')
  const bookingsUsageStatus = getUsageLimitStatus({
    used: usageCounts.monthlyBookings,
    limit: usageLimits.monthlyBookings,
    grace: usageLimits.monthlyBookingsGrace
  })
  const rawUsageRecommendation = getPlanRecommendation({
    plan: licenseStatus?.plan || 'Starter',
    bookingsUsage: usageCounts.monthlyBookings,
    roomsUsage: usageCounts.rooms,
    usersUsage: usageCounts.users,
    limits: usageLimits
  })
  const usageRecommendation = rawUsageRecommendation.recommendedPlan === 'Enterprise'
    ? {
        ...rawUsageRecommendation,
        label: IS_HOTEL_PRODUCT ? 'Hotel package' : 'Pro is the highest LodgingOS package',
        recommendedPlan: IS_HOTEL_PRODUCT && !isEnterprisePlan ? 'Enterprise' : null,
        reason: IS_HOTEL_PRODUCT
          ? 'HotelOS is quoted as a separate Tsa Bonno product.'
          : 'Pro is the highest LodgingOS package. Contact Tsa Bonno if your operation needs HotelOS.'
      }
    : rawUsageRecommendation

  const handleActivate = async () => {
    if (!licenseKey.trim()) return
    setActivateMsg(null)
    setActivating(true)
    try {
      const response = await window.api.trial.activateKey(lodgeId, licenseKey.trim())
      if (response?.success === false) {
        setActivateMsg({ type: 'error', text: response.error || 'Activation failed.' })
      } else {
        setActivateMsg({ type: 'success', text: `Activation complete. ${response.plan || 'License'} is now active.` })
        setLicenseKey('')
        const nextStatus = await access?.refreshEntitlement?.({ forceFresh: true })
        if (nextStatus) setLicenseStatus(nextStatus)
        else await refreshStatus({ forceFresh: true })
      }
    } catch (error) {
      setActivateMsg({ type: 'error', text: error.message || 'Activation failed.' })
    } finally {
      setActivating(false)
    }
  }

  const handleUpgradeRequest = async () => {
    setUpgradeSending(true)
    try {
      const lodgeName = settings?.lodge_name || settings?.company_name || ''
      if (!selectedCommercialPackage?.commercialPackageKey) throw new Error('Choose a package to preview before requesting a change.')
      await window.api.subscriptionRequests.submit({
        source: 'desktop_app',
        request_type: 'plan_upgrade',
        lodge_id: lodgeId || null,
        company_name: settings?.company_name || lodgeName,
        property_name: lodgeName,
        contact_name: user?.full_name || user?.name || '',
        contact_email: user?.email || '',
        property_type: propertyType,
        operating_profile: settings?.operating_profile || null,
        product_id: BUILD_PRODUCT.id,
        commercial_package_key: selectedCommercialPackage.commercialPackageKey,
        current_plan: licenseStatus?.plan || 'Starter',
        requested_plan: selectedCommercialPackage.internalPlan,
        notes: buildUpgradeRequestDescription({
          lodgeName,
          currentPlan: licenseStatus?.plan || 'Starter',
          requestedPlan: selectedCommercialPackage.internalPlan,
          requestedFeature: requestedFeatureFromRoute || undefined,
          requestedFeatureKey: requestedFeatureFromRoute || undefined,
          notes: [
            requestedFeatureFromRoute ? `Requested feature: ${requestedFeatureFromRoute}` : '',
            upgradeMsg
          ].filter(Boolean).join('\n')
        })
      })
      setUpgradeSent(true)
      setUpgradeMsg('')
      setTimeout(() => {
        setUpgradeSent(false)
        setUpgradeOpen(false)
      }, 2500)
    } finally {
      setUpgradeSending(false)
    }
  }

  const copyLodgeId = () => {
    navigator.clipboard.writeText(lodgeId || '').then(() => {
      setLodgeIdCopied(true)
      setTimeout(() => setLodgeIdCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="space-y-5 pb-8">
      <StatusHero licenseStatus={licenseStatus} selectedTargetPackage={selectedCommercialPackage} currentPackage={currentCommercialPackage} />

      {licenseStatus?.status === 'trial' && (
        <PostTrialImpactPreview
          entitlement={licenseStatus}
          targetPlan={selectedCommercialPackage?.internalPlan}
          targetPackage={selectedCommercialPackage}
          productId={BUILD_PRODUCT.id}
          propertyType={propertyType}
          usage={usageCounts}
        />
      )}

      {licenseStatus?.status !== 'licensed' && <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="activation-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 id="activation-heading" className="text-lg font-semibold text-gray-800">Activate a purchased plan</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">A package preview does not become your paid plan until Tsa Bonno approves and activates it.</p>
          </div>
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">No paid plan active</div>
        </div>

        {canManageSubscription && licenseStatus?.status !== 'licensed' && (
          <div className="mt-5 rounded-2xl border border-gray-200 p-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500" htmlFor="activation-key">Already have a purchased activation key?</label>
            <p className="mt-1 text-xs text-gray-500">Activation changes access only after the key is checked by Tsa Bonno. A package preview below never activates a license.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1"><Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input id="activation-key" className="input pl-8 font-mono tracking-wider uppercase" placeholder="BB-XXXX-XXXX-XXXX" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value.toUpperCase())} maxLength={17} /></div>
              <button type="button" onClick={handleActivate} disabled={activating || !licenseKey.trim()} className="btn-primary whitespace-nowrap">{activating ? 'Checking key…' : 'Activate purchased key'}</button>
            </div>
            {activateMsg && <p className={`mt-3 flex items-center gap-2 text-sm ${activateMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`} role="status">{activateMsg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{activateMsg.text}</p>}
          </div>
        )}
      </section>}

      <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="usage-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 id="usage-heading" className="text-lg font-semibold text-gray-800">Usage</h3><p className="mt-1 text-sm text-gray-500">A compact view of the limits that can affect new records. Your existing records are not deleted when a limit is reached.</p></div>{usageSource === 'cache' && <span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">May be out of date offline</span>}</div>

        {IS_POS_PRODUCT ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">POS packages are feature bundles. They do not use the Lodge &amp; Camp room, user, or monthly booking caps. Commercial POS packages are feature bundles rather than capacity tiers.</div> : isEnterprisePlan || IS_HOTEL_PRODUCT ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{IS_HOTEL_PRODUCT ? 'HotelOS is quoted separately and does not use the Lodge & Camp capacity ladder.' : 'This package does not use the Lodge & Camp capacity ladder.'}</div> : (
          <>
            <div className="mt-4 flex flex-wrap gap-2"><UsageLimitIndicator label="Bookings this month" used={usageCounts.monthlyBookings} limit={usageLimits.monthlyBookings} grace={usageLimits.monthlyBookingsGrace} /><UsageLimitIndicator label="Rooms" used={usageCounts.rooms} limit={usageLimits.rooms} /><UsageLimitIndicator label="Users" used={usageCounts.users} limit={usageLimits.users} /></div>
            <p className="mt-3 text-xs text-slate-500">{MONTHLY_USAGE_RESET_COPY}{lastUsageSyncAt ? ` Last refreshed ${fmtDate(lastUsageSyncAt)}.` : ''}</p>
            {['warning', 'critical', 'grace', 'blocked'].includes(bookingsUsageStatus.state) && <p className={`mt-2 text-xs ${bookingsUsageStatus.state === 'blocked' ? 'text-rose-700' : bookingsUsageStatus.state === 'grace' ? 'text-fuchsia-700' : 'text-amber-700'}`}>{bookingsUsageStatus.state === 'blocked' ? 'New booking creation is blocked until usage is reduced or the plan is upgraded.' : bookingsUsageStatus.state === 'grace' ? 'You are using grace bookings. Upgrade before the grace allowance runs out.' : 'Booking usage is getting close to the monthly limit.'}</p>}
            {(bookingsUsageStatus.isAbovePlan || usageCounts.rooms > (usageLimits.rooms ?? Infinity) || usageCounts.users > (usageLimits.users ?? Infinity)) && <p className="mt-2 text-xs text-rose-700">This property is above the {normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')} limits. Existing records remain available; new records may be restricted.</p>}
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Recommended next step</p><p className="mt-1 text-sm font-semibold text-slate-900">{usageRecommendation.label}</p><p className="mt-1 text-xs text-slate-600">{usageRecommendation.reason || usageRecommendation.details}</p>{usageRecommendation.recommendedPlan && usageRecommendation.label !== 'Best fit / Enterprise' && <button type="button" onClick={() => setUpgradeOpen(true)} className="mt-3 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700">Preview {usageRecommendation.recommendedPlan}</button>}</div>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="billing-history-heading">
        <div className="mb-4 flex items-start gap-3"><CreditCard size={18} className="mt-0.5 text-green-600" /><div><h3 id="billing-history-heading" className="text-lg font-semibold text-gray-800">Invoices &amp; payments</h3><p className="mt-1 text-sm text-gray-500">Subscription invoices for this property and this Tsa Bonno product. Guest booking invoices are not shown here.</p></div></div>
        <BillingHistory canManageSubscription={canManageSubscription} billingState={billingState} onRetry={() => setBillingRefreshToken((value) => value + 1)} />
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm" aria-labelledby="change-plan-heading">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h3 id="change-plan-heading" className="text-lg font-semibold text-gray-800">Change plan</h3><p className="mt-1 max-w-2xl text-sm text-gray-500">Choose a package to preview what it includes, then send a request. Selecting a card does not activate a plan, remove access, or charge the property.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"><Sparkles size={14} /> Preview and request only</span></div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {commercialPackages.map((plan) => {
            const limits = IS_LODGE_PRODUCT ? formatPlanLimits(plan.internalPlan) : null
            const isCurrent = currentCommercialPackageKey ? currentCommercialPackageKey === plan.commercialPackageKey : normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter') === plan.internalPlan
            const isSelected = requestedPackageKey === plan.commercialPackageKey
            return <button key={plan.commercialPackageKey} type="button" aria-pressed={isSelected} onClick={() => setRequestedPackageKey(plan.commercialPackageKey)} className={`rounded-2xl border p-4 text-left transition-all ${isSelected ? 'border-emerald-300 bg-emerald-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}>
              <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-gray-800">{plan.displayName || plan.name}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{plan.priceLabel}</p></div><div className="flex flex-col items-end gap-1">{isCurrent && <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-green-700">Current</span>}{isSelected && <span className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">Preview selected</span>}</div></div>
              <p className="mt-3 text-sm font-medium text-gray-800">{plan.headline}</p><p className="mt-2 text-sm text-gray-500">{plan.summary}</p>{IS_HOTEL_PRODUCT ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Configured by hotel quotation</p> : IS_POS_PRODUCT ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Feature bundle · no capacity limits</p> : <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{limits.bookings} · {limits.rooms} · {limits.users}</p>}<p className="mt-3 text-xs text-gray-500">{plan.modules.slice(0, 3).join(' · ')}</p><p className="mt-3 text-[11px] font-medium text-slate-500">{plan.upgradeNudge}</p>
            </button>
          })}
        </div>

        {canManageSubscription ? <div className="mt-5">{!upgradeOpen ? <button type="button" onClick={() => setUpgradeOpen(true)} className="w-full border-2 border-dashed border-green-300 py-3 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50 rounded-2xl flex items-center justify-center gap-2"><ArrowUpCircle size={16} /> Request this package</button> : <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4"><div><p className="text-sm font-semibold text-green-800">Request a package change</p><p className="mt-1 text-xs text-green-700">This sends a request to Tsa Bonno for review. Your current plan remains active until an approved activation is completed.</p></div>{upgradeSent ? <p className="text-sm text-green-700" role="status">Request sent. Tsa Bonno will follow up shortly.</p> : <><div className="grid gap-3 sm:grid-cols-[0.95fr_1.05fr]"><div><label className="text-xs font-semibold uppercase tracking-wide text-green-800" htmlFor="requested-package">Package to preview/request</label><select id="requested-package" className="input mt-2 text-sm" value={requestedPackageKey || ''} onChange={(event) => setRequestedPackageKey(event.target.value)}>{commercialPackages.map((plan) => <option key={plan.commercialPackageKey} value={plan.commercialPackageKey}>{plan.displayName || plan.name}</option>)}</select></div><div className="rounded-2xl border border-green-200 bg-white/75 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-green-800">Selected preview</p><p className="mt-1 text-sm font-semibold text-slate-800">{selectedCommercialPackage?.displayName || 'Choose a package'}</p><p className="mt-1 text-xs text-slate-500">{selectedCommercialPackage?.summary || 'No change is made by selecting a package.'}</p></div></div><textarea className="input h-24 resize-none text-sm" placeholder="Optional notes: expected usage, number of outlets, reporting needs, or anything else Tsa Bonno should know…" value={upgradeMsg} onChange={(event) => setUpgradeMsg(event.target.value)} /><div className="flex gap-2"><button type="button" onClick={() => setUpgradeOpen(false)} className="btn-secondary flex-1 text-sm">Cancel</button><button type="button" onClick={handleUpgradeRequest} disabled={upgradeSending || !selectedCommercialPackage} className="btn-primary flex-1 text-sm">{upgradeSending ? 'Sending…' : 'Send request for review'}</button></div></>}</div>}</div> : <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-800">Plan changes are restricted</p><p className="mt-1 text-sm text-amber-700">Your role can review access, but only finance, manager, or admin-level users can request or activate a property subscription change.</p></div>}

        {IS_HOTEL_PRODUCT && <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-sm font-semibold text-indigo-800">Need a HotelOS quotation?</p><p className="mt-1 text-sm text-indigo-700">HotelOS and optional hotel services are quoted separately for each property.</p><button type="button" onClick={() => { window.location.hash = '#/subscription-builder' }} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"><Sparkles size={15} /> Open Package Builder</button></div>}
      </section>

      <details className="rounded-2xl bg-white shadow-sm" data-testid="technical-access-details">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 text-base font-semibold text-gray-800 [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><Lock size={16} className="text-slate-500" /> Technical / access details</span><span className="text-xs font-normal text-slate-500">Features, optional services, and installation ID</span></summary>
        <div className="space-y-5 border-t border-slate-100 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription expiry</p><p className="mt-2 text-sm font-semibold text-slate-800">{fmtDate(licenseStatus?.expires_at)}</p></div>
            <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grace period ends</p><p className="mt-2 text-sm font-semibold text-slate-800">{fmtDate(licenseStatus?.grace_period_ends_at)}</p></div>
            <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offline access safe until</p><p className="mt-2 text-sm font-semibold text-slate-800">{fmtDate(licenseStatus?.offline_valid_until)}</p></div>
          </div>
          <div><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-base font-semibold text-gray-800">Feature access</h4><p className="mt-1 text-sm text-gray-500">{enabledFeatures.length} of {APP_FEATURES.length} controlled modules currently unlocked for this property.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-700"><Sparkles size={15} /> {licenseStatus?.status === 'licensed' ? getCommercialPackageDisplayName({ productId: BUILD_PRODUCT.id, commercialPackageKey: licenseStatus?.commercial_package_key, plan: licenseStatus?.plan || 'Starter' }) : 'Trial'}</span></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{APP_FEATURES.map((featureName) => { const enabled = isFeatureEnabled(featureName); return <div key={featureName} className={`rounded-2xl border p-4 ${enabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-words font-semibold leading-5 text-gray-800">{FEATURE_LABELS[featureName]}</p><TrialFeatureLabel feature={featureName} entitlement={licenseStatus} selectedTargetPlan={selectedCommercialPackage?.internalPlan} /><p className="mt-1 text-xs leading-5 text-gray-500">{enabled ? 'Included in the current access' : entitlementExpired ? 'Locked until a subscription is activated' : 'Upgrade or override required'}</p></div>{enabled ? <CheckCircle2 size={16} className="mt-1 flex-shrink-0 text-green-600" /> : <Lock size={16} className="mt-1 flex-shrink-0 text-gray-400" />}</div></div> })}</div></div>

          {IS_HOTEL_PRODUCT && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-sm font-semibold text-slate-800">Optional hotel services</h4><p className="mt-1 text-xs text-slate-500">These services are quoted and activated separately for the Hotel product.</p></div><span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{enterpriseAddons.length} active</span></div><div className="mt-4 grid gap-3 md:grid-cols-2">{eligibleAddons.map((addon) => { const enabled = isEnterpriseAddonEnabled(addon.key, enterpriseAddons); const requestable = addon.status === ENTERPRISE_ADDON_STATUS.requestable; return <div key={addon.key} className={`rounded-2xl border bg-white p-3 ${enabled ? 'border-green-200' : requestable ? 'border-amber-200' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{addon.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{addon.description}</p></div>{enabled ? <CheckCircle2 size={16} className="mt-1 flex-shrink-0 text-green-600" /> : requestable ? <ArrowUpCircle size={16} className="mt-1 flex-shrink-0 text-amber-600" /> : <Clock size={16} className="mt-1 flex-shrink-0 text-slate-400" />}</div><p className={`mt-3 text-xs font-semibold ${enabled ? 'text-green-700' : requestable ? 'text-amber-700' : 'text-slate-500'}`}>{enabled ? 'Activated for this property' : requestable ? 'Available by request' : 'Planned for a later rollout'}</p></div> })}{eligibleAddons.length === 0 && <p className="text-sm text-slate-500">No optional hotel services are currently relevant to this property type.</p>}</div></div>}

          <div><div className="flex items-center gap-2"><Hash size={16} className="text-gray-500" /><h4 className="text-base font-semibold text-gray-800">Installation identity</h4></div><p className="mt-1 text-sm text-gray-500">Share this ID with Tsa Bonno when requesting a new key or investigating property access issues.</p><div className="mt-4 flex items-center gap-2"><code className="flex-1 truncate rounded-xl bg-gray-100 px-3 py-3 font-mono text-xs text-gray-600">{lodgeId || '—'}</code><button type="button" onClick={copyLodgeId} className="rounded-xl bg-gray-100 p-3 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700" title="Copy installation ID" aria-label="Copy installation ID">{lodgeIdCopied ? <CheckCircle2 size={15} className="text-green-600" /> : <Copy size={15} />}</button></div></div>
        </div>
      </details>
    </div>
  )
}
